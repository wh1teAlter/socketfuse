/**
 * 拥有一条物理 WebSocket 的连接状态机。
 *
 * 该模块只处理连接尝试、协议握手、重连、心跳、队列、背压和 revision，不知道页面或
 * Worker 的实现；所有外部观察通过 `ConnectionSink` 派发且不等待业务 handler。
 */
import type {
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ConnectionState,
  ProtocolFrame,
  ReadyState,
  RevisionReceipt,
  SafeCloseInfo,
  SendOptions,
  SendReceipt,
  SocketData,
  TimerHandle,
  Transport,
  WebSocketStatus,
} from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import { addSocketListener, browserWebSocketFactory, SOCKET_CONNECTING, SOCKET_OPEN, type WebSocketFactory, type WebSocketLike } from '../transport/socket'
import { AuthRevisionRegister, EndpointRevisionRegister } from './revision'
import { ConnectionStateMachine, readyStateFor, statusFor } from './state'
import { encodeWithAdapter, OrderedProtocol } from '../protocol/adapter'
import { SocketFuseError, toSocketFuseError } from '../shared/errors'
import { CONTROL_PROTOCOL_MAJOR } from '../shared/constants'
import { assertEncodedMessageSize } from '../shared/bytes'
import { BackpressureTracker } from './backpressure'
import { HeartbeatController } from './heartbeat'
import { stableHash } from '../shared/structured'
import { ReconnectPolicy } from './reconnect'
import { OutboundQueue } from './queue'

export interface ConnectionSink<Incoming> {
  /** 页面逻辑 client id。 */
  readonly id: string
  /** 详细状态变化通知。 */
  readonly onState?: (snapshot: ConnectionSnapshot, reasonCode?: string) => void
  /** 连接 ready 通知。 */
  readonly onOpen?: (snapshot: ConnectionSnapshot) => void
  /** 解码后的业务消息通知；controller 不等待 handler。 */
  readonly onMessage?: (data: Incoming, receivedAt: number, replayed?: boolean) => void
  /** 有界入站或回放缓冲的溢出通知。 */
  readonly onOverflow?: (event: { readonly direction: 'inbound' | 'replay', readonly strategy: 'drop-newest' | 'drop-oldest', readonly droppedMessages: number, readonly droppedBytes: number }) => void
  /** 安全 close 信息通知。 */
  readonly onClose?: (event: SafeCloseInfo & { readonly willReconnect: boolean }) => void
  /** 本地连接错误通知；跨 Worker 前仍需脱敏。 */
  readonly onError?: (error: SocketFuseError) => void
}

export interface ConnectionControllerOptions<Incoming, Outgoing, Auth> {
  /** 物理连接与 adapter 的规范化配置。 */
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>
  /** 可选测试 socket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 当前时间源，单位为 Unix 毫秒。 */
  readonly now?: () => number
  /** 重连抖动随机源。 */
  readonly random?: () => number
  /** 可注入 timer 工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 与注入 timer 配对的清理函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** 无 owner controller 完成主动 idle close 后调用一次。 */
  readonly onIdle?: (controller: ConnectionController<Incoming, Outgoing, Auth>) => void
}

interface OpenWaiter {
  /** ready 后返回连接快照。 */
  readonly resolve: (snapshot: ConnectionSnapshot) => void
  /** 终态、关闭或 abort 时拒绝。 */
  readonly reject: (error: SocketFuseError) => void
}

/** 将原生 close 事件裁剪为不含 reason 的安全信息。 */
function safeCloseInfo(event: { readonly code?: number, readonly wasClean?: boolean }): SafeCloseInfo {
  const code = event.code ?? 1006
  return { code, terminal: code === 1000, wasClean: event.wasClean ?? code === 1000 }
}

/** 按字节比较两个二进制视图。 */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength)
    return false
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index])
      return false
  }
  return true
}

/** 生成本地 send/auth 操作使用的 id。 */
function createOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `socketfuse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 只保留 endpoint origin，拒绝向诊断暴露 path/query/凭据。 */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  }
  catch {
    return ''
  }
}

/** 比较心跳原生 payload，不做隐式文本或二进制转换。 */
function socketDataEquals(left: unknown, right: SocketData): boolean {
  if (typeof left === 'string' || typeof right === 'string')
    return left === right
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer)
    return bytesEqual(new Uint8Array(left), new Uint8Array(right))
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right))
    return bytesEqual(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), new Uint8Array(right.buffer, right.byteOffset, right.byteLength))
  return left === right
}

export class ConnectionController<Incoming, Outgoing, Auth = unknown> {
  /** 物理连接状态机。 */
  private readonly machine = new ConnectionStateMachine()
  /** 所有页面 owner 共享的有界出站队列。 */
  private readonly queue: OutboundQueue
  /** 原生 bufferedAmount 高低水位跟踪器。 */
  private readonly backpressure: BackpressureTracker
  /** 物理连接重试预算与退避策略。 */
  private readonly retry: ReconnectPolicy
  /** 保证异步协议解码顺序的处理器。 */
  private readonly orderedProtocol: OrderedProtocol<Incoming, Outgoing, Auth>
  /** 当前 endpoint 与单调 revision。 */
  private readonly endpoint: EndpointRevisionRegister
  /** 当前认证值与单调 revision。 */
  private readonly auth: AuthRevisionRegister<Auth>
  /** client id 到事件 sink 的所有权映射。 */
  private readonly sinks = new Map<string, ConnectionSink<Incoming>>()
  /** 等待当前物理连接 ready 的 open 调用。 */
  private readonly waiters: OpenWaiter[] = []
  /** 当前时间源。 */
  private readonly now: () => number
  /** 当前 timer 工厂。 */
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle
  /** 当前 timer 清理函数。 */
  private readonly clearTimer: (handle: TimerHandle) => void
  /** 原生 WebSocket 工厂。 */
  private readonly socketFactory: WebSocketFactory
  /** 当前物理 socket；一次只能拥有一个。 */
  private socket: WebSocketLike | null = null
  /** 当前 socket 的事件解绑函数。 */
  private socketCleanups: (() => void)[] = []
  /** 当前应用层心跳 controller。 */
  private heartbeat: HeartbeatController | undefined
  /** 当前建连/握手超时 timer。 */
  private connectTimer: TimerHandle | undefined
  /** 当前重连退避 timer。 */
  private retryTimer: TimerHandle | undefined
  /** owner 归零后的宽限关闭 timer。 */
  private idleTimer: TimerHandle | undefined
  /** 背压队列冲刷 timer。 */
  private flushTimer: TimerHandle | undefined
  /** 最近一次 ready 时间，单位为 Unix 毫秒。 */
  private connectedAt = 0
  /** 已计划的下次重试延迟，单位为毫秒。 */
  private nextRetryDelay: number | null = null
  /** 最近安全 close code。 */
  private lastSafeCloseCode: number | null = null
  /** 最近本地 SocketFuse 错误；跨边界前必须脱敏。 */
  private lastError: SocketFuseError | null = null
  /** close 是否由当前控制器主动发起。 */
  private intentionalClose = false
  /** close 完成后是否必须立即开始显式重连。 */
  private forceReconnect = false
  /** 区分过期 socket 回调的单调尝试 id。 */
  private activeAttempt = 0
  /** adapter-frame ready 前必须完成的 auth promise。 */
  private authReady: { readonly attempt: number, readonly promise: Promise<void> } | undefined
  /** onIdle 是否已经为当前空闲周期通知。 */
  private idleNotified = false
  /** 当前关闭是否由 owner 归零触发。 */
  private idleCloseRequested = false
  /** controller 是否已永久释放。 */
  private disposed = false
  /** 串行化异步 encode，保持 sendMessage 调用顺序。 */
  private outgoingTail: Promise<void> = Promise.resolve()

  /** 创建拥有单一物理 WebSocket 的连接控制器。 */
  constructor(readonly options: ConnectionControllerOptions<Incoming, Outgoing, Auth>) {
    this.queue = new OutboundQueue(options.config.shared.queue.maxMessages, options.config.shared.queue.maxBytes)
    this.backpressure = new BackpressureTracker(options.config.shared.backpressure)
    this.retry = new ReconnectPolicy(options.config.shared.reconnect === false
      ? { factor: 2, initialDelay: 0, jitter: 0, maxDelay: 0, retries: 0, stableThreshold: 0 }
      : options.config.shared.reconnect, options.random)
    this.orderedProtocol = new OrderedProtocol(options.config.adapter)
    this.endpoint = new EndpointRevisionRegister(options.config.url)
    this.auth = new AuthRevisionRegister<Auth>()
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
    this.clearTimer = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle))
    this.socketFactory = options.socketFactory ?? browserWebSocketFactory
  }

  /** 返回当前详细物理连接状态。 */
  get state(): ConnectionState {
    return this.machine.state
  }

  /** 返回 VueUse 风格紧凑状态。 */
  get status(): WebSocketStatus {
    return statusFor(this.state)
  }

  /** 返回原生 WebSocket 兼容 readyState。 */
  get readyState(): ReadyState {
    return readyStateFor(this.state)
  }

  /** 当前物理连接是否已经 ready。 */
  get connected(): boolean {
    return this.state === 'open'
  }

  /** 当前附着的逻辑 client 数。 */
  get attachedClientCount(): number {
    return this.sinks.size
  }

  /** 当前 endpoint revision。 */
  get endpointRevision(): number {
    return this.endpoint.revision
  }

  /** 当前 endpoint 完整 URL；不得进入跨端口 diagnostics。 */
  get endpointUrl(): string {
    return this.endpoint.value
  }

  /** 出站队列消息数。 */
  get queueMessages(): number {
    return this.queue.size
  }

  /** 出站队列编码字节数。 */
  get queueBytes(): number {
    return this.queue.bytes
  }

  /** 当前 socket bufferedAmount。 */
  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0
  }

  /** 当前是否处于出站高水位。 */
  get outboundHighWater(): boolean {
    return this.backpressure.isHighWater
  }

  /** 当前连续重试次数。 */
  get retryAttempt(): number {
    return this.retry.attempt
  }

  /** 已计划的下次重试延迟。 */
  get retryDelay(): number | null {
    return this.nextRetryDelay
  }

  /** 最近安全错误码。 */
  get lastErrorCode(): string | null {
    return this.lastError?.code ?? null
  }

  /** 构造不暴露 endpoint path/query、凭据或 payload 的诊断快照。 */
  diagnostics(transport: Exclude<Transport, 'pending'>, workerInstanceHash: string | null = null): Readonly<ConnectionDiagnostics> {
    return Object.freeze({
      attachedClientCount: this.attachedClientCount,
      bufferedAmount: this.bufferedAmount,
      configFingerprint: this.options.config.configFingerprint,
      controlProtocolMajor: CONTROL_PROTOCOL_MAJOR,
      endpointOrigin: safeOrigin(this.endpoint.value),
      idHash: stableHash(this.options.config.id),
      lastErrorCode: this.lastErrorCode,
      lastSafeCloseCode: this.lastSafeCloseCode,
      logicalState: this.state,
      nextRetryDelay: this.retryDelay,
      outboundHighWater: this.outboundHighWater,
      physicalState: this.state,
      queueBytes: this.queueBytes,
      queueMessages: this.queueMessages,
      retryAttempt: this.retryAttempt,
      transport,
      workerInstanceHash,
    })
  }

  /** 附着一个逻辑 client；超出资源上限时同步抛出。 */
  attach(sink: ConnectionSink<Incoming>): void {
    this.assertUsable()
    if (!this.sinks.has(sink.id) && this.sinks.size >= this.options.config.shared.limits.maxClientsPerConnection)
      throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED', 'Maximum clients for this connection has been reached')
    this.sinks.set(sink.id, sink)
    this.idleNotified = false
    this.idleCloseRequested = false
    if (this.idleTimer !== undefined) {
      this.clearTimer(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  /** 脱离 client 并在最后一个 owner 离开后安排 idle close。 */
  detach(clientId: string): void {
    this.sinks.delete(clientId)
    this.queue.removeOwner(clientId)
    if (this.sinks.size === 0)
      this.scheduleIdleClose()
  }

  /** 打开或等待物理连接 ready；abort、终态和关闭会 reject。 */
  open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (signal?.aborted)
      return Promise.reject(new SocketFuseError('ABORTED', 'Open wait was aborted'))
    if (this.state === 'open')
      return Promise.resolve(this.snapshot())
    if (this.state === 'failed' || this.state === 'closed')
      this.machine.transition('connecting')
    else if (this.state === 'idle')
      this.machine.transition('connecting')
    this.emitState()
    const promise = new Promise<ConnectionSnapshot>((resolve, reject) => {
      this.waiters.push({ reject, resolve })
      if (signal !== undefined) {
        const onAbort = (): void => {
          const index = this.waiters.findIndex(waiter => waiter.resolve === resolve)
          if (index >= 0)
            this.waiters.splice(index, 1)
          reject(new SocketFuseError('ABORTED', 'Open wait was aborted'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
    if (this.socket === null && this.retryTimer === undefined)
      this.startSocket()
    return promise
  }

  /** 主动关闭物理连接并清空出站队列。 */
  close(): void {
    if (this.disposed)
      return
    this.intentionalClose = true
    this.clearRetryTimer()
    this.clearConnectTimer()
    this.heartbeat?.stop()
    if (this.socket !== null && (this.socket.readyState === SOCKET_OPEN || this.socket.readyState === SOCKET_CONNECTING)) {
      this.transition('closing', 'CLIENT_DISCONNECTED')
      this.socket.close(1000)
    }
    else if (this.state !== 'idle' && this.state !== 'closed') {
      this.transition('closed', 'CLIENT_DISCONNECTED')
    }
    this.rejectWaiters(new SocketFuseError('CLIENT_DISCONNECTED', 'Connection was closed'))
    this.queue.clear()
  }

  /** 串行编码并本地发送或排队，不承诺服务端 Ack。 */
  async send(ownerId: string, data: Outgoing, options: SendOptions = {}): Promise<SendReceipt> {
    this.assertUsable()
    const messageId = createOperationId()
    const queueSetting = options.queue
    const queueAllowed = queueSetting === true
      || (queueSetting !== false && (this.options.config.shared.queue.whenDisconnected || this.options.config.shared.queue.whenBackpressured))
    const operation = this.outgoingTail.then(async () => {
      const encoded = await encodeWithAdapter(this.options.config.adapter, data, { messageId, now: this.now() })
      assertEncodedMessageSize(encoded, this.options.config.shared.limits.maxEncodedMessageBytes)
      if (this.socket === null || this.state !== 'open') {
        if (!queueAllowed || (!this.options.config.shared.queue.whenDisconnected && queueSetting !== true))
          throw new SocketFuseError('SEND_WHILE_DISCONNECTED', 'Cannot send while the connection is not open', { retryable: true })
        return this.enqueue(ownerId, encoded, messageId, options.idempotencyKey)
      }
      const highWater = this.backpressure.update(this.socket.bufferedAmount)
      if (highWater) {
        if (!queueAllowed || (!this.options.config.shared.queue.whenBackpressured && queueSetting !== true))
          throw new SocketFuseError('BACKPRESSURE', 'Socket bufferedAmount is above the high-water mark', { retryable: true })
        return this.enqueue(ownerId, encoded, messageId, options.idempotencyKey)
      }
      this.socket.send(encoded)
      return { bufferedAmount: this.socket.bufferedAmount, messageId, status: 'accepted' as const }
    })
    this.outgoingTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** 应用认证 revision；协议不支持时 reject。 */
  async updateAuth(value: Auth, revision: number): Promise<RevisionReceipt> {
    this.assertUsable()
    if (!this.options.config.adapter.capabilities.auth || this.options.config.adapter.createAuth === undefined)
      throw new SocketFuseError('CAPABILITY_UNSUPPORTED', 'The selected protocol does not support auth updates')
    const receipt = this.auth.update(value, revision)
    if (receipt.status === 'applied' && this.isAttemptActive())
      await this.reconnect('AUTH_REVISION_UPDATED')
    return receipt
  }

  /** 清除认证 revision，并移除可能携带旧身份的队列项。 */
  async clearAuth(revision: number): Promise<RevisionReceipt> {
    this.assertUsable()
    const receipt = this.auth.update(undefined, revision)
    if (receipt.status === 'applied') {
      this.queue.clear()
      if (this.isAttemptActive())
        await this.reconnect('AUTH_CLEARED')
    }
    return receipt
  }

  /** 应用 endpoint revision；仅 ws/wss URL 可被接受。 */
  async updateUrl(url: string, revision: number): Promise<RevisionReceipt> {
    this.assertUsable()
    let parsed: URL
    try {
      parsed = new URL(url)
    }
    catch (cause) {
      throw new SocketFuseError('INVALID_OPTIONS', 'url must be a valid absolute URL', { cause })
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
      throw new SocketFuseError('INVALID_OPTIONS', 'url must use ws: or wss:')
    const receipt = this.endpoint.update(parsed.href, revision)
    if (receipt.status === 'applied' && this.isAttemptActive())
      await this.reconnect('ENDPOINT_UPDATED')
    return receipt
  }

  /** 清空退避并请求一次显式物理重连。 */
  async reconnect(reason = 'RECONNECT_REQUESTED'): Promise<void> {
    this.assertUsable()
    this.retry.reset()
    this.intentionalClose = false
    this.lastError = null
    this.forceReconnect = true
    this.clearRetryTimer()
    if (this.socket !== null) {
      this.transition('closing', reason)
      this.socket.close(1000)
      return
    }
    if (this.state === 'closed' || this.state === 'failed' || this.state === 'idle' || this.state === 'reconnecting')
      this.transition('connecting', reason)
    this.emitState(reason)
    this.startSocket()
  }

  /** 释放 controller、所有 owner、socket 与 timers。 */
  dispose(): void {
    if (this.disposed)
      return
    this.close()
    this.disposed = true
    for (const id of [...this.sinks.keys()])
      this.detach(id)
    this.clearAllTimers()
  }

  /** 返回当前物理连接快照；transport 会由上层覆盖。 */
  snapshot(): ConnectionSnapshot {
    return {
      attempt: this.retry.attempt,
      connectedAt: this.connectedAt,
      readyState: this.readyState,
      state: this.state,
      status: this.status,
      transport: 'direct',
    }
  }

  /** 将一条已编码消息放入有界 FIFO 队列。 */
  private enqueue(ownerId: string, data: SocketData, messageId: string, idempotencyKey?: string): SendReceipt {
    const result = this.queue.enqueue(ownerId, data, messageId, idempotencyKey)
    return { messageId, position: result.position, status: 'queued' }
  }

  /** 创建物理 socket、绑定本尝试监听器并设置连接 deadline。 */
  private startSocket(): void {
    if (this.disposed || this.socket !== null || this.sinks.size === 0)
      return
    this.intentionalClose = false
    this.lastError = null
    const attempt = ++this.activeAttempt
    this.retry.recordAttempt()
    let socket: WebSocketLike
    try {
      socket = this.socketFactory(this.endpoint.value, this.options.config.shared.protocols, this.options.config.shared.binaryType)
    }
    catch (cause) {
      this.fail(new SocketFuseError('SOCKET_ERROR', 'Unable to construct WebSocket', { cause, retryable: true }))
      return
    }
    this.socket = socket
    socket.binaryType = this.options.config.shared.binaryType
    this.socketCleanups = [
      addSocketListener(socket, 'open', () => this.handleOpen(socket, attempt)),
      addSocketListener(socket, 'message', (event: { readonly data: SocketData }) => this.handleMessage(socket, attempt, event.data)),
      addSocketListener(socket, 'error', () => this.handleError(new SocketFuseError('SOCKET_ERROR', 'WebSocket reported an error', { retryable: true }), socket, attempt)),
      addSocketListener(socket, 'close', (event: { readonly code: number, readonly wasClean: boolean }) => this.handleClose(socket, attempt, event)),
    ]
    this.connectTimer = this.setTimer(() => {
      if (this.isCurrentAttempt(socket, attempt) && this.state !== 'open') {
        this.lastError = new SocketFuseError('CONNECTION_TIMEOUT', 'WebSocket connection timed out', { retryable: true })
        socket.close(1000)
      }
    }, this.options.config.shared.connectionTimeout)
  }

  /** 处理 socket open，并按协议 ready 模式完成 auth/handshake。 */
  private handleOpen(socket: WebSocketLike, attempt: number): void {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    this.connectedAt = this.now()
    this.retry.recordOpen(this.connectedAt)
    if (this.options.config.adapter.readyWhen === 'adapter-frame') {
      this.transition('handshaking', 'SOCKET_OPEN')
      this.emitState('SOCKET_OPEN')
      this.authReady = { attempt, promise: this.sendAuth(socket, attempt) }
      return
    }
    void this.sendAuth(socket, attempt).then(() => this.becomeOpen(socket, attempt)).catch(() => undefined)
  }

  /** 在 ready 前发送当前认证 revision 的 protocol 帧。 */
  private async sendAuth(socket: WebSocketLike, attempt: number): Promise<void> {
    const createAuth = this.options.config.adapter.createAuth
    if (createAuth === undefined || this.auth.value === undefined)
      return
    try {
      const values = await createAuth(this.auth.value, { now: this.now(), revision: this.auth.revision })
      if (!this.isCurrentAttempt(socket, attempt))
        return
      const list = Array.isArray(values) ? values : [values]
      for (const value of list) {
        const encoded = await encodeWithAdapter(this.options.config.adapter, value, { messageId: createOperationId(), now: this.now() })
        if (!this.isCurrentAttempt(socket, attempt))
          return
        socket.send(encoded)
      }
    }
    catch (cause) {
      const error = toSocketFuseError(cause, 'AUTH_FAILED', 'Protocol auth frame failed', { fatal: true, retryable: false })
      if (this.isCurrentAttempt(socket, attempt)) {
        this.handleError(error)
        this.lastError = error
        socket.close(4001)
      }
      throw error
    }
  }

  /** 将当前尝试标记为 ready，启动心跳、冲刷队列并通知所有 sink。 */
  private becomeOpen(socket: WebSocketLike = this.socket as WebSocketLike, attempt: number = this.activeAttempt): void {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    this.clearConnectTimer()
    if (this.state !== 'open')
      this.transition('open', 'READY')
    this.emitState('READY')
    this.resolveWaiters()
    this.heartbeat = this.createHeartbeat()
    this.heartbeat?.start()
    this.flushQueue()
    for (const sink of this.sinks.values())
      sink.onOpen?.(this.snapshot())
  }

  /** 顺序处理一条原始入站 payload。 */
  private async handleMessage(socket: WebSocketLike, attempt: number, data: SocketData): Promise<void> {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    try {
      const frame = await this.orderedProtocol.process(data, { now: this.now(), receivedAt: this.now() })
      await this.handleFrame(socket, attempt, frame)
    }
    catch (cause) {
      this.handleError(toSocketFuseError(cause, 'PROTOCOL_ERROR', 'Protocol frame processing failed', { retryable: false }))
    }
  }

  /** 根据协议帧执行握手、心跳、控制帧或业务 fan-out。 */
  private async handleFrame(socket: WebSocketLike, attempt: number, frame: ProtocolFrame<Incoming>): Promise<void> {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    if (frame.type === 'ready') {
      const authReady = this.authReady
      if (authReady?.attempt === attempt) {
        try {
          await authReady.promise
        }
        catch {
          return
        }
      }
      this.becomeOpen(socket, attempt)
      return
    }
    if (frame.type === 'pong') {
      this.heartbeat?.acknowledge('pong')
      return
    }
    if (frame.type === 'ping') {
      this.heartbeat?.acknowledge('activity')
      const createPong = this.options.config.adapter.createPong
      if (createPong !== undefined) {
        const value = await createPong(frame, { attempt: this.retry.attempt, now: this.now() })
        const encoded = await encodeWithAdapter(this.options.config.adapter, value, { messageId: createOperationId(), now: this.now() })
        if (this.isCurrentAttempt(socket, attempt))
          socket.send(encoded)
      }
      return
    }
    if (frame.type === 'fatal') {
      const error = new SocketFuseError('PROTOCOL_ERROR', 'Protocol rejected the connection', { fatal: true })
      this.handleError(error)
      this.lastError = error
      this.rejectWaiters(error)
      socket.close(4002)
      return
    }
    if (frame.type !== 'data')
      return
    if (this.state !== 'open')
      return
    const heartbeat = this.options.config.shared.heartbeat
    if (heartbeat !== false
      && !this.options.config.adapter.capabilities.heartbeat
      && socketDataEquals(frame.data, heartbeat.responseMessage)) {
      this.heartbeat?.acknowledge('pong')
      return
    }
    this.heartbeat?.acknowledge('activity')
    for (const sink of this.sinks.values())
      sink.onMessage?.(frame.data, this.now())
  }

  /** 记录错误并通知 sink；不等待页面 handler。 */
  private handleError(error: SocketFuseError, socket?: WebSocketLike, attempt?: number): void {
    if (socket !== undefined && attempt !== undefined && !this.isCurrentAttempt(socket, attempt))
      return
    this.lastError = error
    for (const sink of this.sinks.values())
      sink.onError?.(error)
  }

  /** 清理当前 socket 并根据 retry/terminal 策略安排后续状态。 */
  private handleClose(socket: WebSocketLike, attempt: number, event: { readonly code: number, readonly wasClean: boolean }): void {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    this.clearConnectTimer()
    this.heartbeat?.stop()
    this.heartbeat = undefined
    this.cleanupSocket()
    const info = safeCloseInfo(event)
    this.lastSafeCloseCode = info.code
    const protocolAllowsRetry = this.forceReconnect
      || (!this.lastError?.fatal && (this.lastError?.retryable === true
        || (this.options.config.adapter.shouldReconnect?.(info) ?? !info.terminal)))
    const forcedAttempt = this.forceReconnect
    const shouldRetry = (forcedAttempt || !this.intentionalClose)
      && this.sinks.size > 0
      && this.options.config.shared.reconnect !== false
      && protocolAllowsRetry
    let willReconnect = false
    if (forcedAttempt) {
      willReconnect = true
      this.forceReconnect = false
      this.transition('connecting', 'RECONNECT_REQUESTED')
      this.emitState('RECONNECT_REQUESTED')
      this.startSocket()
    }
    else if (shouldRetry) {
      const decision = this.retry.decide(this.now(), true)
      if (decision.allowed) {
        willReconnect = true
        this.nextRetryDelay = decision.delay
        this.transition('reconnecting', this.lastError?.code ?? 'SOCKET_CLOSED')
        this.emitState(this.lastError?.code ?? 'SOCKET_CLOSED')
        this.retryTimer = this.setTimer(() => {
          this.retryTimer = undefined
          this.nextRetryDelay = null
          this.transition('connecting', 'RETRY')
          this.emitState('RETRY')
          this.startSocket()
        }, decision.delay)
      }
      else {
        this.transition('failed', 'RETRY_EXHAUSTED')
        this.emitState('RETRY_EXHAUSTED')
        this.rejectWaiters(new SocketFuseError('RETRY_EXHAUSTED', 'Reconnect retry budget was exhausted', { fatal: true }))
      }
    }
    else {
      if (this.lastError?.fatal) {
        if (this.state !== 'failed')
          this.transition('failed', this.lastError.code)
        this.emitState(this.lastError.code)
        this.rejectWaiters(this.lastError)
      }
      else if (this.state !== 'closed' && this.state !== 'idle')
        this.transition('closed', info.terminal ? 'CLOSE_NOT_RETRYABLE' : this.lastError?.code)
      if (!this.lastError?.fatal) {
        this.emitState(info.terminal ? 'CLOSE_NOT_RETRYABLE' : this.lastError?.code)
        this.rejectWaiters(new SocketFuseError(info.terminal ? 'CLOSE_NOT_RETRYABLE' : 'CLIENT_DISCONNECTED', 'WebSocket closed'))
      }
    }
    for (const sink of this.sinks.values())
      sink.onClose?.({ ...info, willReconnect })
    this.intentionalClose = false
    this.forceReconnect = false
    if (this.idleCloseRequested && this.sinks.size === 0)
      this.notifyIdle()
  }

  /** 在 socket 构造失败等无 close 事件路径进入终态。 */
  private fail(error: SocketFuseError): void {
    this.handleError(error)
    if (this.socket !== null)
      this.cleanupSocket()
    if (this.state !== 'failed')
      this.transition('failed', error.code)
    this.emitState(error.code)
    this.rejectWaiters(error)
  }

  /** 在低水位时按 FIFO 冲刷队列；高水位时保持队列并重试。 */
  private flushQueue(): void {
    if (this.flushTimer !== undefined)
      this.clearTimer(this.flushTimer)
    const flush = (): void => {
      this.flushTimer = undefined
      if (this.socket === null || this.state !== 'open')
        return
      if (this.backpressure.update(this.socket.bufferedAmount)) {
        this.flushTimer = this.setTimer(flush, 16)
        return
      }
      this.queue.drain((item) => {
        try {
          this.socket?.send(item.data)
          return true
        }
        catch (cause) {
          this.handleError(toSocketFuseError(cause, 'SOCKET_ERROR', 'Queued message send failed', { retryable: true }))
          return false
        }
      })
    }
    flush()
  }

  /** 按 adapter 能力创建心跳 controller；未配置则返回 undefined。 */
  private createHeartbeat(): HeartbeatController | undefined {
    const configured = this.options.config.shared.heartbeat
    if (configured === false)
      return undefined
    const adapter = this.options.config.adapter
    if (adapter.createPing === undefined) {
      if (configured.message === undefined)
        return undefined
      return new HeartbeatController(configured, {
        clearTimeout: this.clearTimer,
        onTimeout: () => this.handleHeartbeatTimeout(),
        send: async () => {
          if (this.socket === null)
            return
          this.socket.send(configured.message)
        },
        setTimeout: this.setTimer,
      })
    }
    return new HeartbeatController(configured, {
      clearTimeout: this.clearTimer,
      onTimeout: () => this.handleHeartbeatTimeout(),
      send: async () => {
        if (this.socket === null)
          return
        const value = await adapter.createPing?.({ attempt: this.retry.attempt, now: this.now() })
        if (value !== undefined)
          this.socket.send(await encodeWithAdapter(adapter, value, { messageId: createOperationId(), now: this.now() }))
      },
      setTimeout: this.setTimer,
    })
  }

  /** 最后一个 owner 离开后按宽限期关闭，避免短暂页面切换抖动。 */
  private scheduleIdleClose(): void {
    if (this.idleTimer !== undefined)
      return
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = undefined
      if (this.sinks.size === 0) {
        this.idleCloseRequested = true
        this.close()
        if (this.socket === null)
          this.notifyIdle()
      }
    }, this.options.config.shared.idleGraceMs)
  }

  /** 将心跳超时转换为可重试连接错误并关闭 socket。 */
  private handleHeartbeatTimeout(): void {
    const error = new SocketFuseError('HEARTBEAT_TIMEOUT', 'Heartbeat timed out', { retryable: true })
    this.handleError(error)
    this.lastError = error
    this.socket?.close(4000)
  }

  /** 通过状态机执行迁移并在变化时通知 sink。 */
  private transition(next: ConnectionState, reasonCode?: string): void {
    const transition = this.machine.transition(next)
    if (transition.previous !== transition.state)
      this.emitState(reasonCode)
  }

  /** 向所有 sink 派发当前快照。 */
  private emitState(reasonCode?: string): void {
    const snapshot = this.snapshot()
    for (const sink of this.sinks.values())
      sink.onState?.(snapshot, reasonCode)
  }

  /** resolve 当前 ready 的所有 open waiter。 */
  private resolveWaiters(): void {
    const waiters = this.waiters.splice(0)
    const snapshot = this.snapshot()
    for (const waiter of waiters)
      waiter.resolve(snapshot)
  }

  /** reject 当前等待连接的所有 open waiter。 */
  private rejectWaiters(error: SocketFuseError): void {
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters)
      waiter.reject(error)
  }

  /** 解绑当前 socket 监听器并释放 socket 引用。 */
  private cleanupSocket(): void {
    for (const cleanup of this.socketCleanups)
      cleanup()
    this.socketCleanups = []
    this.socket = null
  }

  /** 判断回调是否仍属于当前物理连接尝试。 */
  private isCurrentAttempt(socket: WebSocketLike, attempt: number): boolean {
    return this.socket === socket && this.activeAttempt === attempt
  }

  /** 每个空闲周期仅通知一次 Worker/direct pool 回收回调。 */
  private notifyIdle(): void {
    if (this.idleNotified)
      return
    this.idleNotified = true
    this.options.onIdle?.(this)
  }

  /** 判断当前是否存在可重连的活跃 socket 尝试。 */
  private isAttemptActive(): boolean {
    return this.socket !== null && (this.state === 'connecting' || this.state === 'handshaking' || this.state === 'open')
  }

  /** 清理连接 deadline timer。 */
  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined)
      this.clearTimer(this.connectTimer)
    this.connectTimer = undefined
  }

  /** 清理重连 timer 及其公开延迟。 */
  private clearRetryTimer(): void {
    if (this.retryTimer !== undefined)
      this.clearTimer(this.retryTimer)
    this.retryTimer = undefined
    this.nextRetryDelay = null
  }

  /** 清理 controller 生命周期拥有的全部 timer。 */
  private clearAllTimers(): void {
    this.clearConnectTimer()
    this.clearRetryTimer()
    if (this.idleTimer !== undefined)
      this.clearTimer(this.idleTimer)
    if (this.flushTimer !== undefined)
      this.clearTimer(this.flushTimer)
    this.idleTimer = undefined
    this.flushTimer = undefined
    this.heartbeat?.stop()
  }

  /** 拒绝 dispose 后的连接操作。 */
  private assertUsable(): void {
    if (this.disposed)
      throw new SocketFuseError('CLIENT_DISPOSED', 'Connection controller has been disposed')
  }
}
