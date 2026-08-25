/**
 * 将 direct 或 SharedWorker transport 呈现为稳定的页面 WebSocketClient。
 * 页面生命周期、监听器、回放和 revision 属于本模块；物理 socket 所有权仍在 transport
 * 与 connection 层，且任何用户 handler 都在页面侧异步隔离执行。
 */
import type {
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ConnectionState,
  CreateWebSocketOptions,
  NormalizedRestoreOptions,
  ProtocolCapabilities,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  Transport,
  WebSocketClient,
  WebSocketStatus,
  WorkerMode,
  WwsCloseEvent,
  WwsDiagnosticEvent,
  WwsMessageEvent,
  WwsOverflowEvent,
  WwsStateChangeEvent,
} from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { ConnectionSink } from '../connection/controller'
import type { ClientTransport } from '../transport/direct'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'
import { toSafePublicError, toWwsError, WwsError } from '../shared/errors'
import { readyStateFor, statusFor } from '../connection/state'

/** 动态消息 handler 的页面本地签名。 */
type MessageHandler<Incoming> = (event: WwsMessageEvent<Incoming>) => void

/** SSR import 时使用的空 EventTarget 基类；页面 realm 使用原生 EventTarget。 */
const EventTargetBase: typeof EventTarget = typeof EventTarget === 'undefined'
  ? class {
    /** SSR 占位监听方法，不持有回调。 */
    addEventListener(): void {}

    /** SSR 占位移除方法。 */
    removeEventListener(): void {}

    /** SSR 占位派发方法，始终表示未处理。 */
    dispatchEvent(): boolean { return false }
  } as unknown as typeof EventTarget
  : EventTarget

/** 只保留可公开的原始值详情，丢弃对象、凭据和 payload。 */
function sanitizeDetails(details: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | undefined {
  if (details === undefined)
    return undefined
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
      safe[key] = value
  }
  return safe
}

/** 将本地错误转换为页面 callback 可见的安全错误。 */
function sanitizeError(error: WwsError): WwsError {
  const details = sanitizeDetails(error.details)
  return toSafePublicError(new WwsError(error.code, error.message, details === undefined
    ? { fatal: error.fatal, retryable: error.retryable }
    : { details, fatal: error.fatal, retryable: error.retryable }))
}

/** 创建带解码数据、时间和 transport 的 message 事件。 */
function createMessageEvent<Incoming>(data: Incoming, receivedAt: number, transport: Exclude<Transport, 'pending'>, replayed: boolean): WwsMessageEvent<Incoming> {
  const event = new Event('message') as WwsMessageEvent<Incoming>
  Object.defineProperties(event, {
    data: { value: data },
    receivedAt: { value: receivedAt },
    replayed: { value: replayed },
    transport: { value: transport },
  })
  return event
}

/** 创建不暴露 close reason 的页面 close 事件。 */
function createCloseEvent(event: { readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }): WwsCloseEvent {
  const result = new Event('close') as WwsCloseEvent
  Object.defineProperties(result, {
    code: { value: event.code },
    terminal: { value: event.terminal },
    wasClean: { value: event.wasClean },
    willReconnect: { value: event.willReconnect },
  })
  return result
}

/** 创建携带已脱敏 WwsError 的 error 事件。 */
function createErrorEvent(error: WwsError): Event {
  const event = new Event('error')
  Object.defineProperty(event, 'error', { value: error })
  Object.defineProperty(event, 'detail', { value: error })
  return event
}

/** 估算页面本地 replay 项的结构化克隆字节数。 */
function estimateValueBytes(value: unknown): number {
  return estimateStructuredCloneBytes(value)
}

/** 将未知诊断值收敛为有限数，非法时返回零。 */
function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 将未知诊断值收敛为有限数或 null。 */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 将未知诊断值收敛为字符串。 */
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 将未知诊断状态收敛为 ConnectionState。 */
function stateValue(value: unknown, fallback: ConnectionState): ConnectionState {
  return typeof value === 'string' ? value as ConnectionState : fallback
}

export class PageWebSocketClient<Incoming, Outgoing, Auth> extends EventTargetBase implements WebSocketClient<Incoming, Outgoing, Auth> {
  /** 最近一次业务消息；未收到时为 null。 */
  private currentData: Incoming | null = null
  /** 当前页面逻辑状态。 */
  private currentState: ConnectionState = 'idle'
  /** 当前实际 transport，可能在允许的初始化降级后变化。 */
  private currentTransport: Transport
  /** 当前 Worker 部署方式。 */
  private currentWorkerMode: WorkerMode
  /** client 是否已永久释放。 */
  private disposed = false
  /** 页面 sink 是否已附着到 transport。 */
  private attached = false
  /** 页面是否处于 freeze/hidden 挂起阶段。 */
  private suspended = false
  /** 每次注册使用独立 token，允许同一函数重复注册和独立移除。 */
  private readonly handlers = new Map<symbol, MessageHandler<Incoming>>()
  /** 页面本地 restore 与 replay 边界。 */
  private readonly restore: Readonly<NormalizedRestoreOptions>
  /** direct transport 挂起时的有限页面 replay 队列。 */
  private readonly replay: { data: Incoming, receivedAt: number, bytes: number }[] = []
  /** replay 队列当前估算字节数。 */
  private replayBytes = 0
  /** 页面本地累计溢出次数，仅用于诊断。 */
  private overflowCount = 0
  /** 生命周期事件监听清理函数，由 dispose 统一释放。 */
  private lifecycleCleanups: (() => void)[] = []
  /** Worker 重建时需要重放的最新 endpoint revision。 */
  private latestEndpoint: { revision: number, url: string } | undefined
  /** Worker 重建时需要重放的最新 auth revision。 */
  private latestAuth: { revision: number, value: Auth | undefined } | undefined
  /** 页面是否曾显式或 immediate 请求连接。 */
  private hadDemand = false
  /** 合并并发 restore 事件的恢复 promise。 */
  private recovery: Promise<void> | undefined

  /** 创建稳定页面 client，并安装可选生命周期监听。 */
  constructor(
    readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>,
    private clientTransport: ClientTransport<Incoming, Outgoing, Auth>,
    readonly options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
    readonly clientId: string,
    private readonly recreateSharedTransport?: () => ClientTransport<Incoming, Outgoing, Auth>,
  ) {
    super()
    this.currentTransport = clientTransport.kind
    this.currentWorkerMode = clientTransport.workerMode
    this.restore = config.local.lifecycle
    if (options.onMessage !== undefined)
      this.onMessage(event => options.onMessage?.(this, event))
    this.installLifecycle()
  }

  /** 返回最近一条业务消息。 */
  get data(): Incoming | null {
    return this.currentData
  }

  /** 返回 VueUse 风格紧凑状态。 */
  get status(): WebSocketStatus {
    return statusFor(this.currentState)
  }

  /** 返回详细连接状态。 */
  get state(): ConnectionState {
    return this.currentState
  }

  /** 返回原生 WebSocket 兼容 readyState。 */
  get readyState(): 0 | 1 | 2 | 3 {
    return readyStateFor(this.currentState)
  }

  /** 返回当前实际 transport。 */
  get transport(): Transport {
    return this.currentTransport
  }

  /** 返回当前 Worker 部署方式。 */
  get workerMode(): WorkerMode {
    return this.currentWorkerMode
  }

  /** 返回协议能力快照。 */
  get capabilities(): ProtocolCapabilities {
    return this.clientTransport.capabilities
  }

  /** 附着页面 sink 并等待连接 ready；失败以安全 WwsError reject。 */
  async open(options?: { signal?: AbortSignal }): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (!this.attached) {
      this.clientTransport.attach(this.createSink())
      this.attached = true
    }
    const snapshot = await this.sanitizePublicPromise(this.clientTransport.open(options?.signal))
    this.hadDemand = true
    if (snapshot.state === 'open' && this.currentState !== 'open')
      this.handleOpen(snapshot)
    else
      this.handleState(snapshot)
    return snapshot
  }

  /** 关闭当前逻辑 client；重复调用保持幂等。 */
  async close(): Promise<void> {
    if (this.disposed)
      return
    this.clientTransport.close()
    this.attached = false
    this.hadDemand = false
    this.setState('closed', 'CLIENT_DISCONNECTED')
  }

  /** 发送业务值；返回值只代表本地 accepted/queued，失败以 WwsError reject。 */
  sendMessage(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    this.assertUsable()
    if (!this.attached)
      return Promise.reject(new WwsError('CLIENT_DISCONNECTED', 'Client is not open'))
    return this.sanitizePublicPromise(this.clientTransport.send(data, options))
  }

  /** 动态注册页面消息 handler，并返回只移除本次注册的函数。 */
  onMessage(handler: MessageHandler<Incoming>): () => void {
    this.assertUsable()
    if (typeof handler !== 'function')
      throw new WwsError('INVALID_OPTIONS', 'onMessage handler must be a function')
    const token = Symbol('onMessage')
    this.handlers.set(token, handler)
    return () => {
      this.handlers.delete(token)
    }
  }

  /** 提交单调认证 revision；仅协议支持 auth 时可调用。 */
  updateAuth(value: Auth, options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    return this.sanitizePublicPromise(this.clientTransport.updateAuth(value, options.revision)).then((receipt) => {
      if (receipt.status === 'applied')
        this.latestAuth = { revision: receipt.revision, value }
      return receipt
    })
  }

  /** 清除认证并提交单调 revision。 */
  clearAuth(options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    return this.sanitizePublicPromise(this.clientTransport.clearAuth(options.revision)).then((receipt) => {
      if (receipt.status === 'applied')
        this.latestAuth = { revision: receipt.revision, value: undefined }
      return receipt
    })
  }

  /** 更新 endpoint 并提交单调 revision。 */
  updateUrl(url: string | URL, options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    const value = url instanceof URL ? url.href : url
    return this.sanitizePublicPromise(this.clientTransport.updateUrl(value, options.revision)).then((receipt) => {
      if (receipt.status === 'applied')
        this.latestEndpoint = { revision: receipt.revision, url: value }
      return receipt
    })
  }

  /** 在 client 未 dispose 时请求物理连接重连。 */
  reconnect(options?: { reason?: string }): Promise<void> {
    this.assertUsable()
    return this.sanitizePublicPromise(this.clientTransport.reconnect(options?.reason))
  }

  /** 返回不含 URL path/query、凭据或 payload 的诊断快照。 */
  diagnostics(): Readonly<ConnectionDiagnostics> {
    const base = this.clientTransport.diagnostics()
    return Object.freeze({
      attachedClientCount: numberValue(base.attachedClientCount),
      bufferedAmount: numberValue(base.bufferedAmount),
      configFingerprint: stringValue(base.configFingerprint),
      controlProtocolMajor: 1,
      endpointOrigin: stringValue(base.endpointOrigin),
      idHash: stableHash(this.config.id),
      lastErrorCode: base.lastErrorCode === null ? null : stringValue(base.lastErrorCode),
      lastSafeCloseCode: numberOrNull(base.lastSafeCloseCode),
      logicalState: this.currentState,
      nextRetryDelay: numberOrNull(base.nextRetryDelay),
      outboundHighWater: Boolean(base.outboundHighWater),
      physicalState: stateValue(base.physicalState, this.currentState),
      queueBytes: numberValue(base.queueBytes),
      queueMessages: numberValue(base.queueMessages),
      retryAttempt: numberValue(base.retryAttempt),
      transport: this.currentTransport,
      workerInstanceHash: base.workerInstanceHash === null ? null : stringValue(base.workerInstanceHash),
    })
  }

  /** 永久释放事件、transport、handlers 和生命周期监听。 */
  async dispose(): Promise<void> {
    if (this.disposed)
      return
    this.disposed = true
    for (const cleanup of this.lifecycleCleanups)
      cleanup()
    this.lifecycleCleanups = []
    this.handlers.clear()
    this.clientTransport.dispose()
    this.setState('closed', 'CLIENT_DISPOSED')
  }

  /** 创建 transport 事件到页面 client 的 sink。 */
  private createSink(): ConnectionSink<Incoming> {
    return {
      id: this.clientId,
      onClose: event => this.handleClose(event),
      onError: error => this.handleError(error),
      onMessage: (data, receivedAt, replayed) => this.handleMessage(data, receivedAt, replayed),
      onOverflow: event => this.dispatchRemoteOverflow(event),
      onOpen: snapshot => this.handleOpen(snapshot),
      onState: (snapshot, reasonCode) => this.handleState(snapshot, reasonCode),
    }
  }

  /** 接收 transport 状态快照并更新页面状态。 */
  private handleState(snapshot: ConnectionSnapshot, reasonCode?: string): void {
    this.currentTransport = this.clientTransport.kind
    this.currentWorkerMode = this.clientTransport.workerMode
    this.setState(snapshot.state, reasonCode, snapshot)
  }

  /** 派发 open 事件并隔离 onConnected callback 异常。 */
  private handleOpen(snapshot: ConnectionSnapshot): void {
    this.setState('open', 'READY', snapshot)
    this.dispatchEvent(new Event('open'))
    try {
      this.options.onConnected?.(this, snapshot)
    }
    catch (cause) {
      this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onConnected callback failed', { cause }))
    }
  }

  /** 根据挂起与回放状态接收一条业务消息。 */
  private handleMessage(data: Incoming, receivedAt: number, replayed = false): void {
    this.currentData = data
    if (replayed) {
      this.dispatchMessage(data, receivedAt, true)
      return
    }
    if (this.suspended) {
      if (this.restore.replay)
        this.pushReplay(data, receivedAt)
      return
    }
    this.dispatchMessage(data, receivedAt, false)
  }

  /** 依次调用动态 handlers 后派发 EventTarget message 事件。 */
  private dispatchMessage(data: Incoming, receivedAt: number, replayed: boolean): void {
    const event = createMessageEvent(data, receivedAt, this.clientTransport.kind, replayed)
    for (const handler of [...this.handlers.values()]) {
      try {
        handler(event)
      }
      catch (cause) {
        this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onMessage handler failed', { cause }))
      }
    }
    this.dispatchEvent(event)
  }

  /** 派发安全 close 事件并隔离 onDisconnected callback。 */
  private handleClose(event: { readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }): void {
    if (!event.willReconnect)
      this.setState('closed', 'SOCKET_CLOSED')
    const closeEvent = createCloseEvent(event)
    this.dispatchEvent(closeEvent)
    try {
      this.options.onDisconnected?.(this, closeEvent)
    }
    catch (cause) {
      this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onDisconnected callback failed', { cause }))
    }
  }

  /** 脱敏错误后派发 error/diagnostic，并隔离 logger 与 callback。 */
  private handleError(error: WwsError): void {
    const publicError = sanitizeError(error)
    this.dispatchEvent(createErrorEvent(publicError))
    const diagnosticEvent = new Event('diagnostic')
    Object.defineProperty(diagnosticEvent, 'diagnostic', {
      value: Object.freeze({ code: publicError.code, timestamp: Date.now(), type: 'error' }),
    })
    this.dispatchEvent(diagnosticEvent)
    const diagnostic: WwsDiagnosticEvent = publicError.details === undefined
      ? { code: publicError.code, timestamp: Date.now(), type: 'error' }
      : { code: publicError.code, details: publicError.details, timestamp: Date.now(), type: 'error' }
    this.options.logger?.(diagnostic)
    try {
      this.options.onError?.(this, publicError)
    }
    catch {
      // User callback errors cannot affect the transport.
    }
  }

  /** 更新逻辑状态并仅在实际变化时派发 statechange。 */
  private setState(state: ConnectionState, reasonCode?: string, snapshot?: ConnectionSnapshot): void {
    const previous = this.currentState
    this.currentState = state
    if (previous === state)
      return
    const event = new Event('statechange') as WwsStateChangeEvent
    Object.defineProperties(event, {
      attempt: { value: snapshot?.attempt ?? 0 },
      previous: { value: previous },
      reasonCode: { value: reasonCode },
      state: { value: state },
      transport: { value: this.currentTransport },
    })
    this.dispatchEvent(event)
  }

  /** 安装 visibility、BFCache 和 Page Lifecycle 恢复监听。 */
  private installLifecycle(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined')
      return
    const suspend = (force = false): void => {
      if (!this.restore.enabled || !this.attached)
        return
      if (force || document.visibilityState === 'hidden' || document.hidden) {
        this.suspended = true
        this.clientTransport.suspend?.()
      }
    }
    const restore = (): void => {
      if (!this.restore.enabled)
        return
      void this.restoreLifecycle()
    }
    const pagehide = (event: PageTransitionEvent): void => {
      if (event.persisted && this.restore.enabled) {
        suspend(true)
        return
      }
      if (this.config.local.autoClose)
        void this.close()
    }
    const visibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !document.hidden)
        restore()
      else
        suspend()
    }
    document.addEventListener('visibilitychange', visibilityChange)
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('pageshow', restore)
    const freeze = (): void => suspend(true)
    document.addEventListener('freeze', freeze)
    document.addEventListener('resume', restore)
    this.lifecycleCleanups.push(
      () => document.removeEventListener('visibilitychange', visibilityChange),
      () => window.removeEventListener('pagehide', pagehide),
      () => window.removeEventListener('pageshow', restore),
      () => document.removeEventListener('freeze', freeze),
      () => document.removeEventListener('resume', restore),
    )
  }

  /** 合并并发恢复事件，保证同一时刻只有一条 Worker 恢复事务。 */
  private async restoreLifecycle(): Promise<void> {
    if (this.recovery !== undefined)
      return this.recovery
    this.recovery = this.performRestoreLifecycle().finally(() => {
      this.recovery = undefined
    })
    return this.recovery
  }

  /** probe Worker，必要时重建 transport，并恢复有限消息回放。 */
  private async performRestoreLifecycle(): Promise<void> {
    const wasSuspended = this.suspended
    if (!wasSuspended)
      return
    this.suspended = false
    try {
      await this.clientTransport.probe?.()
    }
    catch (error) {
      try {
        await this.recreateTransport()
      }
      catch (recoveryError) {
        this.handleError(recoveryError instanceof WwsError
          ? recoveryError
          : new WwsError('WORKER_DISCONNECTED', 'SharedWorker recovery failed', { cause: error ?? recoveryError, retryable: true }))
        return
      }
    }
    this.clientTransport.restore?.()
    if (wasSuspended && this.restore.replay) {
      const entries = this.replay.splice(0)
      this.replayBytes = 0
      for (const entry of entries)
        this.dispatchMessage(entry.data, entry.receivedAt, true)
    }
  }

  /** 重建已失效 SharedWorker transport 并按 endpoint→auth→open 顺序重放状态。 */
  private async recreateTransport(): Promise<void> {
    if (this.clientTransport.kind !== 'shared-worker' || this.recreateSharedTransport === undefined)
      return
    const oldTransport = this.clientTransport
    oldTransport.dispose()
    const replacement = this.recreateSharedTransport()
    this.clientTransport = replacement
    this.currentTransport = replacement.kind
    this.currentWorkerMode = replacement.workerMode
    replacement.attach(this.createSink())
    this.attached = true
    if (this.latestEndpoint !== undefined)
      await replacement.updateUrl(this.latestEndpoint.url, this.latestEndpoint.revision)
    if (this.latestAuth !== undefined) {
      if (this.latestAuth.value === undefined)
        await replacement.clearAuth(this.latestAuth.revision)
      else
        await replacement.updateAuth(this.latestAuth.value, this.latestAuth.revision)
    }
    if (this.hadDemand)
      await this.sanitizePublicPromise(replacement.open())
  }

  /** 将 transport reject 统一裁剪为页面安全 WwsError。 */
  private async sanitizePublicPromise<Value>(promise: Promise<Value>): Promise<Value> {
    try {
      return await promise
    }
    catch (error) {
      const value = error instanceof WwsError
        ? error
        : toWwsError(error, 'INTERNAL_STATE_ERROR', 'WebSocket operation failed')
      throw sanitizeError(value)
    }
  }

  /** 向有界页面 replay 队列追加消息，溢出时丢弃最旧项。 */
  private pushReplay(data: Incoming, receivedAt: number): void {
    const bytes = estimateValueBytes(data)
    if (bytes > this.restore.maxBytes) {
      this.overflowCount++
      this.dispatchOverflow(bytes, 'drop-oldest')
      return
    }
    while (this.replay.length >= this.restore.maxMessages || this.replayBytes + bytes > this.restore.maxBytes) {
      const removed = this.replay.shift()
      if (removed === undefined)
        break
      this.replayBytes -= removed.bytes
      this.overflowCount++
      this.dispatchOverflow(removed.bytes, 'drop-oldest')
    }
    this.replay.push({ bytes, data, receivedAt })
    this.replayBytes += bytes
  }

  /** 派发页面本地 replay overflow。 */
  private dispatchOverflow(bytes: number, strategy: WwsOverflowEvent['strategy']): void {
    const event = new Event('overflow') as WwsOverflowEvent
    Object.defineProperties(event, {
      direction: { value: 'replay' },
      droppedBytes: { value: bytes },
      droppedMessages: { value: 1 },
      strategy: { value: strategy },
    })
    this.dispatchEvent(event)
  }

  /** 将 Worker 入站或 replay credit 溢出转换为页面事件。 */
  private dispatchRemoteOverflow(event: { readonly direction: 'inbound' | 'replay', readonly strategy: 'drop-newest' | 'drop-oldest', readonly droppedMessages: number, readonly droppedBytes: number }): void {
    const overflow = new Event('overflow') as WwsOverflowEvent
    Object.defineProperties(overflow, {
      direction: { value: event.direction },
      droppedBytes: { value: event.droppedBytes },
      droppedMessages: { value: event.droppedMessages },
      strategy: { value: event.strategy },
    })
    this.dispatchEvent(overflow)
  }

  /** 拒绝已 dispose client 的后续公开操作。 */
  private assertUsable(): void {
    if (this.disposed)
      throw new WwsError('CLIENT_DISPOSED', 'WebSocket client has been disposed')
  }
}
