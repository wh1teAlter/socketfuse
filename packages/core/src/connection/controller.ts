/**
 * 拥有一条物理 WebSocket 的连接状态机。
 *
 * 该模块只处理连接尝试、重连、心跳、队列和背压，不知道页面或
 * Worker 的实现；所有外部观察通过 `ConnectionSink` 派发且不等待业务 handler。
 */
import type {
  BeforeReconnectReason,
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ConnectionState,
  ProtocolFrame,
  ReadyState,
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
import { CONTROL_PROTOCOL_MAJOR, MAX_ENDPOINT_LENGTH } from '../shared/constants'
import { ConnectionStateMachine, readyStateFor, statusFor } from './state'
import { encodeWithAdapter, OrderedProtocol } from '../protocol/adapter'
import { SocketFuseError, toSocketFuseError } from '../shared/errors'
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
  /** 原生 socket open 通知。 */
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

export interface ConnectionControllerOptions<Incoming, Outgoing> {
  /** 物理连接与 adapter 的规范化配置。 */
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing>
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
  readonly onIdle?: (controller: ConnectionController<Incoming, Outgoing>) => void
  /** 自动重连 plan 创建后交给上层协调器；返回 true 表示异步接管提交。 */
  readonly onReconnectPlan?: (plan: Readonly<ReconnectPlan>) => boolean
  /** 显式 close/reconnect 使等待中的 plan 失效时通知协调器。 */
  readonly onReconnectPlanCancel?: (planId: string) => void
}

/** connection 层创建且不包含 endpoint 秘密的重连计划。 */
export interface ReconnectPlan {
  /** 仅用于同一 controller 内提交校验的不透明代际 id。 */
  readonly id: string
  /** 从一开始计数的自动重连序号。 */
  readonly attempt: number
  /** 未覆盖时使用的退避延迟。 */
  readonly defaultDelay: number
  /** 当前断开的安全分类。 */
  readonly reason: BeforeReconnectReason
  /** 不含服务端 reason 文本的 close 信息。 */
  readonly close: SafeCloseInfo
}

/** 上层协调器对当前重连计划的一次原子覆盖。 */
export interface ReconnectPlanOverride {
  /** 下一次尝试使用的固定 URL。 */
  readonly url?: string
  /** 从提交到尝试的等待时间。 */
  readonly delay?: number
}

interface OpenWaiter {
  /** 原生 socket open 后返回连接快照。 */
  readonly resolve: (snapshot: ConnectionSnapshot) => void
  /** 终态、关闭或 abort 时拒绝。 */
  readonly reject: (error: SocketFuseError) => void
  /** waiter 完成时移除外部 AbortSignal 监听。 */
  cleanup?: () => void
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

/** 生成本地发送和重连计划使用的操作 id。 */
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

/** 将原生二进制 payload 转为字节视图；文本与其他值返回 undefined。 */
async function socketBytes(value: unknown): Promise<Uint8Array | undefined> {
  if (value instanceof ArrayBuffer)
    return new Uint8Array(value)
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof Blob !== 'undefined' && value instanceof Blob)
    return new Uint8Array(await value.arrayBuffer())
  return undefined
}

/** 比较心跳原生 payload；文本不与二进制互转，二进制按线上的字节比较。 */
async function socketDataEquals(left: unknown, right: SocketData): Promise<boolean> {
  if (typeof left === 'string' || typeof right === 'string')
    return left === right
  const [leftBytes, rightBytes] = await Promise.all([socketBytes(left), socketBytes(right)])
  return leftBytes !== undefined && rightBytes !== undefined && bytesEqual(leftBytes, rightBytes)
}

/** 独占一条物理 WebSocket 及其全部连接状态。 */
export class ConnectionController<Incoming, Outgoing> {
  /** 物理连接状态机。 */
  private readonly machine = new ConnectionStateMachine()
  /** 所有页面 owner 共享的有界出站队列。 */
  private readonly queue: OutboundQueue
  /** 原生 bufferedAmount 高低水位跟踪器。 */
  private readonly backpressure: BackpressureTracker
  /** 物理连接重试预算与退避策略。 */
  private readonly retry: ReconnectPolicy
  /** 保证异步协议解码顺序的处理器。 */
  private readonly orderedProtocol: OrderedProtocol<Incoming, Outgoing>
  /** 当前物理连接使用的固定 endpoint；仅 plan 提交可以更新。 */
  private endpoint: string
  /** client id 到事件 sink 的所有权映射。 */
  private readonly sinks = new Map<string, ConnectionSink<Incoming>>()
  /** 等待当前物理连接 open 的调用。 */
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
  /** 当前建连超时 timer。 */
  private connectTimer: TimerHandle | undefined
  /** 当前重连退避 timer。 */
  private retryTimer: TimerHandle | undefined
  /** owner 归零后的宽限关闭 timer。 */
  private idleTimer: TimerHandle | undefined
  /** 背压队列冲刷 timer。 */
  private flushTimer: TimerHandle | undefined
  /** 最近一次原生 socket open 时间，单位为 Unix 毫秒。 */
  private connectedAt = 0
  /** 已计划的下次重试延迟，单位为毫秒。 */
  private nextRetryDelay: number | null = null
  /** 等待 Worker/direct coordinator 提交的当前重连计划。 */
  private reconnectPlan: Readonly<ReconnectPlan> | undefined
  /** 生成 plan id 的单调代际。 */
  private reconnectPlanGeneration = 0
  /** 最近安全 close code。 */
  private lastSafeCloseCode: number | null = null
  /** 最近本地 SocketFuse 错误；跨边界前必须脱敏。 */
  private lastError: SocketFuseError | null = null
  /** close 是否由当前控制器主动发起。 */
  private intentionalClose = false
  /** 当前 socket close 后是否必须进入显式重连计划。 */
  private explicitReconnectPending = false
  /** 区分过期 socket 回调的单调尝试 id。 */
  private activeAttempt = 0
  /** onIdle 是否已经为当前空闲周期通知。 */
  private idleNotified = false
  /** 当前关闭是否由 owner 归零触发。 */
  private idleCloseRequested = false
  /** controller 是否已永久释放。 */
  private disposed = false
  /** 串行化异步 encode，保持 sendMessage 调用顺序。 */
  private outgoingTail: Promise<void> = Promise.resolve()

  /** 创建拥有单一物理 WebSocket 的连接控制器。 */
  constructor(readonly options: ConnectionControllerOptions<Incoming, Outgoing>) {
    this.queue = new OutboundQueue(options.config.shared.queue.maxMessages, options.config.shared.queue.maxBytes)
    this.backpressure = new BackpressureTracker(options.config.shared.backpressure)
    this.retry = new ReconnectPolicy(options.config.shared.reconnect === false
      ? { factor: 2, hookTimeout: 10_000, initialDelay: 0, jitter: 0, maxDelay: 0, retries: 0, stableThreshold: 0 }
      : options.config.shared.reconnect, options.random)
    this.orderedProtocol = new OrderedProtocol(options.config.adapter)
    this.endpoint = options.config.url
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

  /** 当前物理连接是否已经 open。 */
  get connected(): boolean {
    return this.state === 'open'
  }

  /** 当前附着的逻辑 client 数。 */
  get attachedClientCount(): number {
    return this.sinks.size
  }

  /** 当前 endpoint 完整 URL；不得进入跨端口 diagnostics。 */
  get endpointUrl(): string {
    return this.endpoint
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
      endpointOrigin: safeOrigin(this.endpoint),
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

  /** 打开或等待物理连接 open；abort、终态和关闭会 reject。 */
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
      const waiter: OpenWaiter = { reject, resolve }
      this.waiters.push(waiter)
      if (signal !== undefined) {
        const onAbort = (): void => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0)
            this.waiters.splice(index, 1)
          waiter.cleanup?.()
          reject(new SocketFuseError('ABORTED', 'Open wait was aborted'))
        }
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort)
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
    if (this.socket === null && this.retryTimer === undefined && this.reconnectPlan === undefined)
      this.startSocket()
    return promise
  }

  /** 主动关闭物理连接并清空出站队列。 */
  close(): void {
    if (this.disposed)
      return
    this.intentionalClose = true
    this.explicitReconnectPending = false
    this.cancelReconnectPlan()
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
    this.assertOwnerAttached(ownerId)
    const messageId = createOperationId()
    const queueSetting = options.queue
    const queueAllowed = queueSetting === true
      || (queueSetting !== false && (this.options.config.shared.queue.whenDisconnected || this.options.config.shared.queue.whenBackpressured))
    const operation = this.outgoingTail.then(async () => {
      this.assertUsable()
      this.assertOwnerAttached(ownerId)
      const encoded = await encodeWithAdapter(this.options.config.adapter, data, { messageId, now: this.now() })
      this.assertUsable()
      this.assertOwnerAttached(ownerId)
      assertEncodedMessageSize(encoded, this.options.config.shared.limits.maxEncodedMessageBytes)
      if (this.socket === null || this.state !== 'open') {
        if (!queueAllowed || (!this.options.config.shared.queue.whenDisconnected && queueSetting !== true))
          throw new SocketFuseError('SEND_WHILE_DISCONNECTED', 'Cannot send while the connection is not open', { retryable: true })
        return this.enqueue(ownerId, encoded, messageId)
      }
      const highWater = this.backpressure.update(this.socket.bufferedAmount)
      if (highWater) {
        if (!queueAllowed || (!this.options.config.shared.queue.whenBackpressured && queueSetting !== true))
          throw new SocketFuseError('BACKPRESSURE', 'Socket bufferedAmount is above the high-water mark', { retryable: true })
        return this.enqueue(ownerId, encoded, messageId)
      }
      this.socket.send(encoded)
      return { bufferedAmount: this.socket.bufferedAmount, messageId, status: 'accepted' as const }
    })
    this.outgoingTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** 清空退避并请求一次显式物理重连计划。 */
  async reconnect(): Promise<void> {
    this.assertUsable()
    this.retry.reset()
    this.intentionalClose = false
    this.lastError = null
    this.explicitReconnectPending = true
    this.cancelReconnectPlan()
    this.clearRetryTimer()
    if (this.socket !== null) {
      this.transition('closing', 'RECONNECT_REQUESTED')
      this.socket.close(1000)
      return
    }
    this.explicitReconnectPending = false
    const plan = this.createReconnectPlan(1, 0, 'explicit', { code: 1000, terminal: false, wasClean: true }, 'RECONNECT_REQUESTED')
    this.dispatchReconnectPlan(plan)
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

  /** 原子提交当前重连计划；旧代际或非法覆盖不会改变 endpoint/timer。 */
  commitReconnectPlan(id: string, override: Readonly<ReconnectPlanOverride> = {}): void {
    this.assertUsable()
    const plan = this.reconnectPlan
    if (plan === undefined || plan.id !== id)
      throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer active')
    const delay = override.delay ?? plan.defaultDelay
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0)
      throw new SocketFuseError('INVALID_OPTIONS', 'Reconnect delay must be a non-negative finite number')
    let endpoint = this.endpoint
    if (override.url !== undefined)
      endpoint = this.normalizeEndpoint(override.url)
    this.reconnectPlan = undefined
    if (endpoint !== this.endpoint) {
      this.endpoint = endpoint
    }
    this.scheduleReconnect(delay)
  }

  /** 将一条已编码消息放入有界 FIFO 队列。 */
  private enqueue(ownerId: string, data: SocketData, messageId: string): SendReceipt {
    const result = this.queue.enqueue(ownerId, data, messageId)
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
      socket = this.socketFactory(this.endpoint, this.options.config.shared.protocols, this.options.config.shared.binaryType)
    }
    catch (cause) {
      this.handleSocketConstructionFailure(new SocketFuseError('SOCKET_ERROR', 'Unable to construct WebSocket', { cause, retryable: true }))
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

  /** 处理原生 socket open，并立即进入 SocketFuse open 状态。 */
  private handleOpen(socket: WebSocketLike, attempt: number): void {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    this.connectedAt = this.now()
    this.retry.recordOpen(this.connectedAt)
    this.becomeOpen(socket, attempt)
  }

  /** 将当前尝试标记为 open，启动心跳、冲刷队列并通知所有 sink。 */
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
    this.heartbeat?.acknowledge('activity')
    if (frame.type === 'pong') {
      this.heartbeat?.acknowledge('pong')
      return
    }
    if (frame.type === 'ping') {
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
      && this.options.config.shared.protocol.kind === 'raw'
      && await socketDataEquals(frame.data, heartbeat.responseMessage as SocketData)) {
      this.heartbeat?.acknowledge('pong')
      return
    }
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
    const protocolAllowsRetry = this.explicitReconnectPending
      || (!this.lastError?.fatal && (this.lastError?.retryable === true
        || (this.options.config.adapter.shouldReconnect?.(info) ?? !info.terminal)))
    const explicitAttempt = this.explicitReconnectPending
    const shouldRetry = (explicitAttempt || !this.intentionalClose)
      && this.sinks.size > 0
      && (explicitAttempt || this.options.config.shared.reconnect !== false)
      && protocolAllowsRetry
    let willReconnect = false
    let planToDispatch: Readonly<ReconnectPlan> | undefined
    const reconnectInfo = { ...info, terminal: false }
    if (explicitAttempt && shouldRetry) {
      willReconnect = true
      this.explicitReconnectPending = false
      planToDispatch = this.createReconnectPlan(1, 0, 'explicit', reconnectInfo, 'RECONNECT_REQUESTED')
    }
    else if (shouldRetry) {
      const decision = this.retry.decide(this.now(), true)
      if (decision.allowed) {
        willReconnect = true
        planToDispatch = this.createReconnectPlan(
          decision.attempt,
          decision.delay,
          this.reconnectReason(),
          reconnectInfo,
          this.lastError?.code ?? 'SOCKET_CLOSED',
        )
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
    const closeInfo = { ...info, terminal: !willReconnect }
    for (const sink of this.sinks.values())
      sink.onClose?.({ ...closeInfo, willReconnect })
    if (planToDispatch !== undefined)
      this.dispatchReconnectPlan(planToDispatch)
    this.intentionalClose = false
    this.explicitReconnectPending = false
    if (this.idleCloseRequested && this.sinks.size === 0)
      this.notifyIdle()
  }

  /** 在 socket 构造失败且没有 close 事件时进入统一自动重连计划。 */
  private handleSocketConstructionFailure(error: SocketFuseError): void {
    this.handleError(error)
    if (this.socket !== null)
      this.cleanupSocket()
    const close = { code: 1006, terminal: false, wasClean: false }
    this.lastSafeCloseCode = close.code
    const protocolAllowsRetry = !error.fatal
      && error.retryable
      && (this.options.config.adapter.shouldReconnect?.(close) ?? true)
    if (!this.intentionalClose
      && this.sinks.size > 0
      && this.options.config.shared.reconnect !== false
      && protocolAllowsRetry) {
      const decision = this.retry.decide(this.now(), true)
      if (decision.allowed) {
        const plan = this.createReconnectPlan(decision.attempt, decision.delay, 'socket-error', close, error.code)
        this.dispatchReconnectPlan(plan)
        return
      }
      const exhausted = new SocketFuseError('RETRY_EXHAUSTED', 'Reconnect retry budget was exhausted', { fatal: true })
      if (this.state !== 'failed')
        this.transition('failed', exhausted.code)
      this.emitState(exhausted.code)
      this.rejectWaiters(exhausted)
      return
    }
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

  /** 把 plan 交给上层候选协调器；无人接管或异常时立即采用默认值。 */
  private dispatchReconnectPlan(plan: Readonly<ReconnectPlan>): void {
    // onClose 会同步进入页面 callback；callback 可能在此处先显式 close/reconnect，
    // 因而必须再次确认 plan 仍是 controller 权威的当前代际，不能把已取消计划交给协调器。
    if (this.reconnectPlan?.id !== plan.id)
      return
    let accepted = false
    try {
      accepted = this.options.onReconnectPlan?.(plan) === true
    }
    catch {
      accepted = false
    }
    if (!accepted && this.reconnectPlan?.id === plan.id)
      this.commitReconnectPlan(plan.id)
  }

  /** 建立唯一的当前重连计划，并在提交前保持 endpoint 与 timer 不变。 */
  private createReconnectPlan(
    attempt: number,
    defaultDelay: number,
    reason: BeforeReconnectReason,
    close: SafeCloseInfo,
    reasonCode: string,
  ): Readonly<ReconnectPlan> {
    this.nextRetryDelay = defaultDelay
    this.transition('reconnecting', reasonCode)
    this.emitState(reasonCode)
    const plan = Object.freeze({
      attempt,
      close,
      defaultDelay,
      id: `${++this.reconnectPlanGeneration}:${createOperationId()}`,
      reason,
    })
    this.reconnectPlan = plan
    return plan
  }

  /** 使当前 plan 失效，并让 transport abort 页面准备函数。 */
  private cancelReconnectPlan(): void {
    const plan = this.reconnectPlan
    if (plan === undefined)
      return
    this.reconnectPlan = undefined
    this.options.onReconnectPlanCancel?.(plan.id)
  }

  /** 安装已验证计划的单一退避 timer。 */
  private scheduleReconnect(delay: number): void {
    this.nextRetryDelay = delay
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined
      this.nextRetryDelay = null
      this.transition('connecting', 'RETRY')
      this.emitState('RETRY')
      this.startSocket()
    }, delay)
  }

  /** 将内部错误与 close 收敛为不含服务端文本的公开重连原因。 */
  private reconnectReason(): BeforeReconnectReason {
    if (this.lastError?.code === 'HEARTBEAT_TIMEOUT')
      return 'heartbeat-timeout'
    if (this.lastError?.code === 'CONNECTION_TIMEOUT')
      return 'connection-timeout'
    if (this.lastError?.code === 'SOCKET_ERROR')
      return 'socket-error'
    return 'socket-close'
  }

  /** 校验 plan 提交的 endpoint，但不把完整 URL写入错误详情。 */
  private normalizeEndpoint(value: string): string {
    if (typeof value !== 'string')
      throw new SocketFuseError('INVALID_OPTIONS', 'url must be a fixed string')
    if (value.length > MAX_ENDPOINT_LENGTH)
      throw new SocketFuseError('INVALID_OPTIONS', `url must be at most ${MAX_ENDPOINT_LENGTH} characters`)
    let parsed: URL
    try {
      parsed = new URL(value)
    }
    catch {
      throw new SocketFuseError('INVALID_OPTIONS', 'url must be an absolute ws: or wss: URL')
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
      throw new SocketFuseError('INVALID_OPTIONS', 'url must use ws: or wss:')
    if (parsed.href.length > MAX_ENDPOINT_LENGTH)
      throw new SocketFuseError('INVALID_OPTIONS', `url must be at most ${MAX_ENDPOINT_LENGTH} characters after normalization`)
    return parsed.href
  }

  /** 按 adapter 能力创建心跳 controller；未配置则返回 undefined。 */
  private createHeartbeat(): HeartbeatController | undefined {
    const configured = this.options.config.shared.heartbeat
    if (configured === false)
      return undefined
    const socket = this.socket
    const attempt = this.activeAttempt
    if (socket === null)
      return undefined
    const adapter = this.options.config.adapter
    if (this.options.config.shared.protocol.kind === 'raw') {
      return new HeartbeatController(configured, {
        clearTimeout: this.clearTimer,
        onTimeout: () => this.handleHeartbeatTimeout(),
        send: async () => {
          if (this.isCurrentAttempt(socket, attempt) && this.state === 'open')
            socket.send(configured.message as SocketData)
        },
        setTimeout: this.setTimer,
      })
    }
    if (adapter.createPing === undefined)
      return undefined
    return new HeartbeatController(configured, {
      clearTimeout: this.clearTimer,
      onTimeout: () => this.handleHeartbeatTimeout(),
      send: async () => {
        const value = await adapter.createPing?.({ attempt: this.retry.attempt, now: this.now() })
        if (value === undefined)
          return
        const encoded = await encodeWithAdapter(adapter, value, { messageId: createOperationId(), now: this.now() })
        if (this.isCurrentAttempt(socket, attempt) && this.state === 'open')
          socket.send(encoded)
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

  /** resolve 当前等待原生 socket open 的所有调用。 */
  private resolveWaiters(): void {
    const waiters = this.waiters.splice(0)
    const snapshot = this.snapshot()
    for (const waiter of waiters) {
      waiter.cleanup?.()
      waiter.resolve(snapshot)
    }
  }

  /** reject 当前等待连接的所有 open waiter。 */
  private rejectWaiters(error: SocketFuseError): void {
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      waiter.cleanup?.()
      waiter.reject(error)
    }
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

  /** 拒绝已经脱离当前 controller 的页面继续完成异步发送。 */
  private assertOwnerAttached(ownerId: string): void {
    if (!this.sinks.has(ownerId))
      throw new SocketFuseError('CLIENT_DISCONNECTED', 'Message owner is no longer attached')
  }
}
