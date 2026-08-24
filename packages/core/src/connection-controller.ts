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
} from './types'
import type { NormalizedWebSocketConfig } from './config'
import { addSocketListener, browserWebSocketFactory, SOCKET_CONNECTING, SOCKET_OPEN, type WebSocketFactory, type WebSocketLike } from './socket'
import { ConnectionStateMachine, readyStateFor, statusFor } from './connection-state'
import { AuthRevisionRegister, EndpointRevisionRegister } from './revision'
import { encodeWithAdapter, OrderedProtocol } from './protocol'
import { BackpressureTracker } from './backpressure'
import { CONTROL_PROTOCOL_MAJOR } from './constants'
import { assertEncodedMessageSize } from './bytes'
import { HeartbeatController } from './heartbeat'
import { toWwsError, WwsError } from './errors'
import { ReconnectPolicy } from './reconnect'
import { stableHash } from './structured'
import { OutboundQueue } from './queue'

export interface ConnectionSink<Incoming> {
  readonly id: string
  readonly onState?: (snapshot: ConnectionSnapshot, reasonCode?: string) => void
  readonly onOpen?: (snapshot: ConnectionSnapshot) => void
  readonly onMessage?: (data: Incoming, receivedAt: number, replayed?: boolean) => void
  readonly onOverflow?: (event: { readonly direction: 'inbound' | 'replay', readonly strategy: 'drop-newest' | 'drop-oldest', readonly droppedMessages: number, readonly droppedBytes: number }) => void
  readonly onClose?: (event: SafeCloseInfo & { readonly willReconnect: boolean }) => void
  readonly onError?: (error: WwsError) => void
}

export interface ConnectionControllerOptions<Incoming, Outgoing, Auth> {
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>
  readonly socketFactory?: WebSocketFactory
  readonly now?: () => number
  readonly random?: () => number
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** Called once an ownerless controller has completed intentional idle close. */
  readonly onIdle?: (controller: ConnectionController<Incoming, Outgoing, Auth>) => void
}

interface OpenWaiter {
  readonly resolve: (snapshot: ConnectionSnapshot) => void
  readonly reject: (error: WwsError) => void
}

function safeCloseInfo(event: { readonly code?: number, readonly wasClean?: boolean }): SafeCloseInfo {
  const code = event.code ?? 1006
  return { code, terminal: code === 1000, wasClean: event.wasClean ?? code === 1000 }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength)
    return false
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index])
      return false
  }
  return true
}

function createOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `wws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  }
  catch {
    return ''
  }
}

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
  private readonly machine = new ConnectionStateMachine()
  private readonly queue: OutboundQueue
  private readonly backpressure: BackpressureTracker
  private readonly retry: ReconnectPolicy
  private readonly orderedProtocol: OrderedProtocol<Incoming, Outgoing, Auth>
  private readonly endpoint: EndpointRevisionRegister
  private readonly auth: AuthRevisionRegister<Auth>
  private readonly sinks = new Map<string, ConnectionSink<Incoming>>()
  private readonly waiters: OpenWaiter[] = []
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void
  private readonly socketFactory: WebSocketFactory
  private socket: WebSocketLike | null = null
  private socketCleanups: (() => void)[] = []
  private heartbeat: HeartbeatController | undefined
  private connectTimer: TimerHandle | undefined
  private retryTimer: TimerHandle | undefined
  private idleTimer: TimerHandle | undefined
  private flushTimer: TimerHandle | undefined
  private connectedAt = 0
  private nextRetryDelay: number | null = null
  private lastSafeCloseCode: number | null = null
  private lastError: WwsError | null = null
  private intentionalClose = false
  private forceReconnect = false
  private activeAttempt = 0
  private authReady: { readonly attempt: number, readonly promise: Promise<void> } | undefined
  private idleNotified = false
  private idleCloseRequested = false
  private disposed = false
  private outgoingTail: Promise<void> = Promise.resolve()

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

  get state(): ConnectionState {
    return this.machine.state
  }

  get status(): WebSocketStatus {
    return statusFor(this.state)
  }

  get readyState(): ReadyState {
    return readyStateFor(this.state)
  }

  get connected(): boolean {
    return this.state === 'open'
  }

  get attachedClientCount(): number {
    return this.sinks.size
  }

  get endpointRevision(): number {
    return this.endpoint.revision
  }

  get endpointUrl(): string {
    return this.endpoint.value
  }

  get queueMessages(): number {
    return this.queue.size
  }

  get queueBytes(): number {
    return this.queue.bytes
  }

  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0
  }

  get outboundHighWater(): boolean {
    return this.backpressure.isHighWater
  }

  get retryAttempt(): number {
    return this.retry.attempt
  }

  get retryDelay(): number | null {
    return this.nextRetryDelay
  }

  get lastErrorCode(): string | null {
    return this.lastError?.code ?? null
  }

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

  attach(sink: ConnectionSink<Incoming>): void {
    this.assertUsable()
    if (!this.sinks.has(sink.id) && this.sinks.size >= this.options.config.shared.limits.maxClientsPerConnection)
      throw new WwsError('RESOURCE_LIMIT_EXCEEDED', 'Maximum clients for this connection has been reached')
    this.sinks.set(sink.id, sink)
    this.idleNotified = false
    this.idleCloseRequested = false
    if (this.idleTimer !== undefined) {
      this.clearTimer(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  detach(clientId: string): void {
    this.sinks.delete(clientId)
    this.queue.removeOwner(clientId)
    if (this.sinks.size === 0)
      this.scheduleIdleClose()
  }

  open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (signal?.aborted)
      return Promise.reject(new WwsError('ABORTED', 'Open wait was aborted'))
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
          reject(new WwsError('ABORTED', 'Open wait was aborted'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
    if (this.socket === null && this.retryTimer === undefined)
      this.startSocket()
    return promise
  }

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
    this.rejectWaiters(new WwsError('CLIENT_DISCONNECTED', 'Connection was closed'))
    this.queue.clear()
  }

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
          throw new WwsError('SEND_WHILE_DISCONNECTED', 'Cannot send while the connection is not open', { retryable: true })
        return this.enqueue(ownerId, encoded, messageId, options.idempotencyKey)
      }
      const highWater = this.backpressure.update(this.socket.bufferedAmount)
      if (highWater) {
        if (!queueAllowed || (!this.options.config.shared.queue.whenBackpressured && queueSetting !== true))
          throw new WwsError('BACKPRESSURE', 'Socket bufferedAmount is above the high-water mark', { retryable: true })
        return this.enqueue(ownerId, encoded, messageId, options.idempotencyKey)
      }
      this.socket.send(encoded)
      return { bufferedAmount: this.socket.bufferedAmount, messageId, status: 'accepted' as const }
    })
    this.outgoingTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  async updateAuth(value: Auth, revision: number): Promise<RevisionReceipt> {
    this.assertUsable()
    if (!this.options.config.adapter.capabilities.auth || this.options.config.adapter.createAuth === undefined)
      throw new WwsError('CAPABILITY_UNSUPPORTED', 'The selected protocol does not support auth updates')
    const receipt = this.auth.update(value, revision)
    if (receipt.status === 'applied' && this.isAttemptActive())
      await this.reconnect('AUTH_REVISION_UPDATED')
    return receipt
  }

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

  async updateUrl(url: string, revision: number): Promise<RevisionReceipt> {
    this.assertUsable()
    let parsed: URL
    try {
      parsed = new URL(url)
    }
    catch (cause) {
      throw new WwsError('INVALID_OPTIONS', 'url must be a valid absolute URL', { cause })
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
      throw new WwsError('INVALID_OPTIONS', 'url must use ws: or wss:')
    const receipt = this.endpoint.update(parsed.href, revision)
    if (receipt.status === 'applied' && this.isAttemptActive())
      await this.reconnect('ENDPOINT_UPDATED')
    return receipt
  }

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

  dispose(): void {
    if (this.disposed)
      return
    this.close()
    this.disposed = true
    for (const id of [...this.sinks.keys()])
      this.detach(id)
    this.clearAllTimers()
  }

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

  private enqueue(ownerId: string, data: SocketData, messageId: string, idempotencyKey?: string): SendReceipt {
    const result = this.queue.enqueue(ownerId, data, messageId, idempotencyKey)
    return { messageId, position: result.position, status: 'queued' }
  }

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
      this.fail(new WwsError('SOCKET_ERROR', 'Unable to construct WebSocket', { cause, retryable: true }))
      return
    }
    this.socket = socket
    socket.binaryType = this.options.config.shared.binaryType
    this.socketCleanups = [
      addSocketListener(socket, 'open', () => this.handleOpen(socket, attempt)),
      addSocketListener(socket, 'message', (event: { readonly data: SocketData }) => this.handleMessage(socket, attempt, event.data)),
      addSocketListener(socket, 'error', () => this.handleError(new WwsError('SOCKET_ERROR', 'WebSocket reported an error', { retryable: true }), socket, attempt)),
      addSocketListener(socket, 'close', (event: { readonly code: number, readonly wasClean: boolean }) => this.handleClose(socket, attempt, event)),
    ]
    this.connectTimer = this.setTimer(() => {
      if (this.isCurrentAttempt(socket, attempt) && this.state !== 'open') {
        this.lastError = new WwsError('CONNECTION_TIMEOUT', 'WebSocket connection timed out', { retryable: true })
        socket.close(1000)
      }
    }, this.options.config.shared.connectionTimeout)
  }

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
      const error = toWwsError(cause, 'AUTH_FAILED', 'Protocol auth frame failed', { fatal: true, retryable: false })
      if (this.isCurrentAttempt(socket, attempt)) {
        this.handleError(error)
        this.lastError = error
        socket.close(4001)
      }
      throw error
    }
  }

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

  private async handleMessage(socket: WebSocketLike, attempt: number, data: SocketData): Promise<void> {
    if (!this.isCurrentAttempt(socket, attempt))
      return
    try {
      const frame = await this.orderedProtocol.process(data, { now: this.now(), receivedAt: this.now() })
      await this.handleFrame(socket, attempt, frame)
    }
    catch (cause) {
      this.handleError(toWwsError(cause, 'PROTOCOL_ERROR', 'Protocol frame processing failed', { retryable: false }))
    }
  }

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
      const error = new WwsError('PROTOCOL_ERROR', 'Protocol rejected the connection', { fatal: true })
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

  private handleError(error: WwsError, socket?: WebSocketLike, attempt?: number): void {
    if (socket !== undefined && attempt !== undefined && !this.isCurrentAttempt(socket, attempt))
      return
    this.lastError = error
    for (const sink of this.sinks.values())
      sink.onError?.(error)
  }

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
        this.rejectWaiters(new WwsError('RETRY_EXHAUSTED', 'Reconnect retry budget was exhausted', { fatal: true }))
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
        this.rejectWaiters(new WwsError(info.terminal ? 'CLOSE_NOT_RETRYABLE' : 'CLIENT_DISCONNECTED', 'WebSocket closed'))
      }
    }
    for (const sink of this.sinks.values())
      sink.onClose?.({ ...info, willReconnect })
    this.intentionalClose = false
    this.forceReconnect = false
    if (this.idleCloseRequested && this.sinks.size === 0)
      this.notifyIdle()
  }

  private fail(error: WwsError): void {
    this.handleError(error)
    if (this.socket !== null)
      this.cleanupSocket()
    if (this.state !== 'failed')
      this.transition('failed', error.code)
    this.emitState(error.code)
    this.rejectWaiters(error)
  }

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
          this.handleError(toWwsError(cause, 'SOCKET_ERROR', 'Queued message send failed', { retryable: true }))
          return false
        }
      })
    }
    flush()
  }

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

  private handleHeartbeatTimeout(): void {
    const error = new WwsError('HEARTBEAT_TIMEOUT', 'Heartbeat timed out', { retryable: true })
    this.handleError(error)
    this.lastError = error
    this.socket?.close(4000)
  }

  private transition(next: ConnectionState, reasonCode?: string): void {
    const transition = this.machine.transition(next)
    if (transition.previous !== transition.state)
      this.emitState(reasonCode)
  }

  private emitState(reasonCode?: string): void {
    const snapshot = this.snapshot()
    for (const sink of this.sinks.values())
      sink.onState?.(snapshot, reasonCode)
  }

  private resolveWaiters(): void {
    const waiters = this.waiters.splice(0)
    const snapshot = this.snapshot()
    for (const waiter of waiters)
      waiter.resolve(snapshot)
  }

  private rejectWaiters(error: WwsError): void {
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters)
      waiter.reject(error)
  }

  private cleanupSocket(): void {
    for (const cleanup of this.socketCleanups)
      cleanup()
    this.socketCleanups = []
    this.socket = null
  }

  private isCurrentAttempt(socket: WebSocketLike, attempt: number): boolean {
    return this.socket === socket && this.activeAttempt === attempt
  }

  private notifyIdle(): void {
    if (this.idleNotified)
      return
    this.idleNotified = true
    this.options.onIdle?.(this)
  }

  private isAttemptActive(): boolean {
    return this.socket !== null && (this.state === 'connecting' || this.state === 'handshaking' || this.state === 'open')
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined)
      this.clearTimer(this.connectTimer)
    this.connectTimer = undefined
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== undefined)
      this.clearTimer(this.retryTimer)
    this.retryTimer = undefined
    this.nextRetryDelay = null
  }

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

  private assertUsable(): void {
    if (this.disposed)
      throw new WwsError('CLIENT_DISPOSED', 'Connection controller has been disposed')
  }
}
