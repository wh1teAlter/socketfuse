/** 通过 MessagePort 连接页面 client 与 SharedWorker runtime，并维护控制请求与 credit。 */
import type {
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ProtocolCapabilities,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  TimerHandle,
} from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { ConnectionSink } from '../connection/controller'
import type { MessagePortLike } from '../worker/runtime'
import type { ClientTransport } from './direct'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, isWorkerControlMessage } from '../worker/control'
import { createSafePublicError, WwsError } from '../shared/errors'
import { CONTROL_PROTOCOL_MAJOR } from '../shared/constants'

export interface SharedWorkerLike {
  /** Worker 端口；由 transport 独占其控制消息生命周期。 */
  readonly port: MessagePortLike
}

export interface SharedWorkerTransportOptions<Incoming, Outgoing, Auth> {
  /** 页面创建的 SharedWorker 实例。 */
  readonly worker: SharedWorkerLike
  /** 与 Worker hello 对齐的规范化配置。 */
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>
  /** 当前页面逻辑 client id。 */
  readonly clientId: string
  /** inline 或 custom Worker 来源。 */
  readonly mode: 'inline' | 'custom'
  /** 仅在 allowlist 允许的 Worker 初始化失败后惰性创建 direct fallback。 */
  readonly createFallback?: () => ClientTransport<Incoming, Outgoing, Auth>
  /** hello 请求超时，单位为毫秒。 */
  readonly initTimeout?: number
}

interface PendingRequest {
  /** 控制请求成功回调。 */
  readonly resolve: (value: ControlResponseValue) => void
  /** 控制请求失败回调。 */
  readonly reject: (error: WwsError) => void
  /** 请求超时 timer。 */
  readonly timer: TimerHandle
}

/** 只允许在 Worker 尚未确认实例身份时降级的错误码集合。 */
function canFallbackFromWorkerError(error: unknown, workerInstanceId: string | null): boolean {
  if (workerInstanceId !== null)
    return false
  if (!(error instanceof WwsError))
    return true
  return [
    'ADAPTER_NOT_REGISTERED',
    'PROTOCOL_VERSION_MISMATCH',
    'WORKER_CONSTRUCTION_FAILED',
    'WORKER_DISCONNECTED',
    'WORKER_INIT_TIMEOUT',
    'WORKER_LOAD_FAILED',
    'WORKER_UNSUPPORTED',
  ].includes(error.code)
}

/** 生成控制请求 id。 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 将 Worker 控制错误转换为页面安全错误。 */
function deserializeError(value: ControlError): WwsError {
  return createSafePublicError(value.code, { fatal: value.fatal, retryable: value.retryable })
}

/** 将任意 hello 失败归一化为 Worker 初始化错误。 */
function toInitError(error: unknown): WwsError {
  if (error instanceof WwsError)
    return error
  return new WwsError('WORKER_LOAD_FAILED', 'SharedWorker initialization failed', { cause: error })
}

/** 构造尚未收到 Worker diagnostics 时的安全初始快照。 */
function emptyDiagnostics<Incoming, Outgoing, Auth>(
  config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>,
  workerInstanceId: string | null,
): Readonly<ConnectionDiagnostics> {
  return Object.freeze({
    attachedClientCount: 0,
    bufferedAmount: 0,
    configFingerprint: config.configFingerprint,
    controlProtocolMajor: CONTROL_PROTOCOL_MAJOR,
    endpointOrigin: new URL(config.url).origin,
    idHash: '',
    lastErrorCode: null,
    lastSafeCloseCode: null,
    logicalState: 'idle',
    nextRetryDelay: null,
    outboundHighWater: false,
    physicalState: 'idle',
    queueBytes: 0,
    queueMessages: 0,
    retryAttempt: 0,
    transport: 'shared-worker',
    workerInstanceHash: workerInstanceId,
  })
}

export class SharedWorkerTransport<Incoming, Outgoing, Auth = unknown> implements ClientTransport<Incoming, Outgoing, Auth> {
  /** transport 自己拥有的控制端口。 */
  private readonly port: MessagePortLike
  /** requestId 到待决请求的映射。 */
  private readonly requests = new Map<string, PendingRequest>()
  /** 页面 sink，在 attach 后才允许事件派发。 */
  private sink: ConnectionSink<Incoming> | undefined
  /** 当前 Worker hello promise，保证同一端口只发一个 hello。 */
  private helloPromise: Promise<void> | undefined
  /** 是否已经切换到明确允许的 direct fallback。 */
  private fallbackActive = false
  /** 是否已释放端口和请求。 */
  private disposed = false
  /** Worker 实例 id，确认后用于阻止隐式实例切换。 */
  private workerInstanceId: string | null = null
  /** 页面活性 lease timer。 */
  private leaseTimer: TimerHandle | undefined
  /** 最近一次 Worker diagnostics。 */
  private diagnosticsSnapshot: Readonly<ConnectionDiagnostics> | undefined
  /** 初始化失败后惰性创建的 direct fallback。 */
  private fallback: ClientTransport<Incoming, Outgoing, Auth> | undefined

  /** 绑定端口监听并启动 MessagePort。 */
  constructor(readonly options: SharedWorkerTransportOptions<Incoming, Outgoing, Auth>) {
    this.port = options.worker.port
    const onMessage = (event: { readonly data: unknown }): void => this.handleMessage(event.data)
    const onMessageError = (): void => this.handleDisconnect(new WwsError('WORKER_DISCONNECTED', 'SharedWorker port reported a message error', { retryable: true }))
    if (this.port.addEventListener !== undefined) {
      this.port.addEventListener('message', onMessage)
      this.port.addEventListener('messageerror', onMessageError)
    }
    else {
      this.port.onmessage = onMessage
      this.port.onmessageerror = onMessageError
    }
    this.port.start?.()
  }

  /** 返回当前实际使用的 transport 类型。 */
  get kind(): 'direct' | 'shared-worker' {
    return this.fallbackActive ? 'direct' : 'shared-worker'
  }

  /** 返回 Worker 部署模式；fallback 后为 none。 */
  get workerMode(): 'none' | 'inline' | 'custom' {
    return this.fallbackActive ? 'none' : this.options.mode
  }

  /** 返回当前协议能力，fallback 后取 direct adapter。 */
  get capabilities(): ProtocolCapabilities {
    return this.fallbackActive && this.fallback !== undefined
      ? this.fallback.capabilities
      : this.options.config.adapter.capabilities
  }

  /** 绑定页面 sink 并后台发起 hello。 */
  attach(sink: ConnectionSink<Incoming>): void {
    this.sink = sink
    if (this.fallbackActive) {
      this.fallback?.attach(sink)
      return
    }
    void this.ensureHello().catch((error) => {
      if (this.options.createFallback !== undefined)
        void this.activateFallback(error).catch(value => this.sink?.onError?.(toInitError(value)))
      else
        this.sink?.onError?.(toInitError(error))
    })
  }

  /** 完成 hello 后打开共享物理连接。 */
  async open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (signal?.aborted)
      throw new WwsError('ABORTED', 'Open wait was aborted')
    try {
      await this.ensureHello()
    }
    catch (error) {
      await this.activateFallback(error)
    }
    if (this.fallbackActive) {
      if (this.sink !== undefined)
        this.fallback?.attach(this.sink)
      if (this.fallback === undefined)
        throw toInitError(new WwsError('WORKER_DISCONNECTED', 'SharedWorker initialization failed'))
      return this.fallback.open(signal)
    }
    return await this.request({ requestId: createId(), type: 'open' }) as ConnectionSnapshot
  }

  /** 请求 detach 当前页面 client。 */
  close(): void {
    if (this.fallbackActive) {
      this.fallback?.close()
      return
    }
    if (this.helloPromise !== undefined) {
      void this.request({ requestId: createId(), type: 'close' }).catch(() => undefined)
      // A following open must issue a fresh hello even when it races the
      // best-effort close request. MessagePort ordering keeps close before
      // that new hello in the Worker.
      this.resetHello()
    }
  }

  /** 发送业务值并等待 Worker 本地接纳回执。 */
  async send(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().send(data, options)
    const requestId = createId()
    const message: ClientControlMessage = options === undefined
      ? { data, requestId, type: 'send' }
      : { data, options, requestId, type: 'send' }
    return await this.request(message) as SendReceipt
  }

  /** 提交认证 revision 到 Worker。 */
  async updateAuth(value: Auth, revision: number): Promise<RevisionReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().updateAuth(value, revision)
    return await this.request({ auth: value, requestId: createId(), revision, type: 'update-auth' }) as RevisionReceipt
  }

  /** 提交清除认证 revision 到 Worker。 */
  async clearAuth(revision: number): Promise<RevisionReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().clearAuth(revision)
    return await this.request({ requestId: createId(), revision, type: 'clear-auth' }) as RevisionReceipt
  }

  /** 提交 endpoint revision 到 Worker。 */
  async updateUrl(url: string, revision: number): Promise<RevisionReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().updateUrl(url, revision)
    return await this.request({ requestId: createId(), revision, type: 'update-url', url }) as RevisionReceipt
  }

  /** 请求共享物理连接重连。 */
  async reconnect(reason?: string): Promise<void> {
    await this.ensureReady()
    if (this.fallbackActive) {
      await this.requireFallback().reconnect(reason)
      return
    }
    const message: ClientControlMessage = reason === undefined
      ? { requestId: createId(), type: 'reconnect' }
      : { reason, requestId: createId(), type: 'reconnect' }
    await this.request(message)
  }

  /** 验证 Worker 实例未在生命周期恢复期间静默更换。 */
  async probe(): Promise<string> {
    this.assertUsable()
    await this.ensureHello()
    if (this.fallbackActive)
      throw new WwsError('WORKER_DISCONNECTED', 'SharedWorker transport is no longer selected')
    const value = await this.request({ requestId: createId(), type: 'probe' }, 1_000)
    if (value === null || typeof value !== 'object' || !('workerInstanceId' in value) || typeof value.workerInstanceId !== 'string')
      throw new WwsError('INVALID_CONTROL_MESSAGE', 'SharedWorker probe returned an invalid response')
    if (this.workerInstanceId !== null && this.workerInstanceId !== value.workerInstanceId)
      throw new WwsError('WORKER_DISCONNECTED', 'SharedWorker instance changed', { retryable: true })
    return value.workerInstanceId
  }

  /** 通知 Worker 暂停当前页面的实时派发。 */
  suspend(): void {
    if (this.fallbackActive) {
      this.fallback?.suspend?.()
      return
    }
    this.post({ type: 'suspend' })
  }

  /** 通知 Worker 恢复派发并按边界回放。 */
  restore(): void {
    if (this.fallbackActive) {
      this.fallback?.restore?.()
      return
    }
    this.post({ type: 'restore' })
  }

  /** 脱离指定页面 client。 */
  detach(clientId: string): void {
    if (this.fallbackActive) {
      this.fallback?.detach(clientId)
      return
    }
    this.close()
  }

  /** 返回最近安全诊断快照，并异步请求更新。 */
  diagnostics(): Readonly<Record<string, unknown>> {
    if (this.fallbackActive)
      return this.fallback?.diagnostics() ?? {}
    if (this.helloPromise !== undefined)
      void this.request({ requestId: createId(), type: 'diagnostics' }).then(value => this.setDiagnostics(value)).catch(() => undefined)
    return this.diagnosticsSnapshot ?? emptyDiagnostics(this.options.config, this.workerInstanceId)
  }

  /** 幂等释放端口、lease timer 和待决请求。 */
  dispose(): void {
    if (this.disposed)
      return
    if (this.fallbackActive) {
      this.disposed = true
      this.fallback?.dispose()
      return
    }
    if (this.leaseTimer !== undefined)
      globalThis.clearInterval(this.leaseTimer)
    this.leaseTimer = undefined
    // This also releases a newly-created but never-attached port without
    // waiting for the Worker's unattached-port timeout.
    try {
      this.port.postMessage({ requestId: createId(), type: 'dispose' })
    }
    catch {
      // A failed port still gets closed below.
    }
    this.port.close?.()
    this.rejectAll(new WwsError('CLIENT_DISPOSED', 'SharedWorker transport was disposed'))
    this.disposed = true
    this.fallback?.dispose()
  }

  /** 建立一次 hello；成功后开始 lease 报活。 */
  private ensureHello(): Promise<void> {
    this.assertUsable()
    if (this.fallbackActive)
      return Promise.resolve()
    if (this.helloPromise !== undefined)
      return this.helloPromise
    const requestId = createId()
    this.helloPromise = this.request({
      clientId: this.options.clientId,
      configCanonical: this.options.config.configCanonical,
      configFingerprint: this.options.config.configFingerprint,
      id: this.options.config.id,
      protocolMajor: CONTROL_PROTOCOL_MAJOR,
      requestId,
      restore: this.options.config.local.lifecycle,
      shared: this.options.config.shared,
      type: 'hello',
      url: this.options.config.url,
    }, this.options.initTimeout ?? 5_000).then((value) => {
      if (value === null || typeof value !== 'object' || !('workerInstanceId' in value))
        throw new WwsError('INVALID_CONTROL_MESSAGE', 'SharedWorker returned an invalid welcome response')
      this.workerInstanceId = String(value.workerInstanceId)
      this.leaseTimer = globalThis.setInterval(() => this.post({ type: 'lease' }), this.options.config.shared.lease.interval)
    })
    return this.helloPromise
  }

  /** 清除 hello/lease 状态，使后续 open 能重新握手。 */
  private resetHello(): void {
    if (this.leaseTimer !== undefined)
      globalThis.clearInterval(this.leaseTimer)
    this.leaseTimer = undefined
    this.helloPromise = undefined
    this.workerInstanceId = null
  }

  /** 确保 hello 成功，必要时只在初始化失败边界激活 fallback。 */
  private async ensureReady(): Promise<void> {
    try {
      await this.ensureHello()
    }
    catch (error) {
      await this.activateFallback(error)
    }
  }

  /** 发送一个带超时的控制请求。 */
  private request(message: ClientControlMessage, timeout = 10_000): Promise<ControlResponseValue> {
    if (!('requestId' in message))
      return Promise.reject(new WwsError('INVALID_CONTROL_MESSAGE', 'Control request is missing requestId'))
    const promise = new Promise<ControlResponseValue>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.requests.delete(message.requestId)
        reject(new WwsError(message.type === 'hello' ? 'WORKER_INIT_TIMEOUT' : 'WORKER_DISCONNECTED', 'SharedWorker request timed out', { retryable: true }))
      }, timeout)
      this.requests.set(message.requestId, { reject, resolve, timer })
    })
    this.post(message)
    return promise
  }

  /** 投递控制消息；post 失败按 Worker disconnected 处理。 */
  private post(message: ClientControlMessage): void {
    try {
      this.port.postMessage(message)
    }
    catch (cause) {
      this.handleDisconnect(new WwsError('WORKER_DISCONNECTED', 'Unable to post to SharedWorker', { cause, retryable: true }))
    }
  }

  /** 校验并分派 Worker 控制消息，receipt 在业务 handler 前发送以释放 credit。 */
  private handleMessage(value: unknown): void {
    if (!isWorkerControlMessage(value)) {
      this.handleDisconnect(new WwsError('INVALID_CONTROL_MESSAGE', 'SharedWorker sent an invalid control message'))
      return
    }
    if (value.type === 'response') {
      const request = this.requests.get(value.requestId)
      if (request === undefined)
        return
      globalThis.clearTimeout(request.timer)
      this.requests.delete(value.requestId)
      if (value.ok)
        request.resolve(value.value)
      else
        request.reject(deserializeError(value.error))
      return
    }
    if (value.type === 'state')
      this.sink?.onState?.(value.snapshot, value.reasonCode)
    else if (value.type === 'open')
      this.sink?.onOpen?.(value.snapshot)
    else if (value.type === 'message')
      this.post({ deliveryId: value.deliveryId, type: 'receipt' })
    if (value.type === 'message')
      this.sink?.onMessage?.(value.data as Incoming, value.receivedAt, value.replayed)
    else if (value.type === 'close')
      this.sink?.onClose?.(value)
    else if (value.type === 'error')
      this.sink?.onError?.(deserializeError(value.error))
    else if (value.type === 'overflow')
      this.sink?.onOverflow?.({
        direction: value.direction,
        droppedBytes: value.droppedBytes,
        droppedMessages: value.droppedMessages,
        strategy: value.direction === 'replay' ? 'drop-oldest' : 'drop-newest',
      })
  }

  /** 缓存 Worker 返回的 diagnostics 快照。 */
  private setDiagnostics(value: ControlResponseValue): void {
    if (value === null || typeof value !== 'object' || !('logicalState' in value))
      return
    this.diagnosticsSnapshot = value as ConnectionDiagnostics
  }

  /** 处理端口断开并拒绝全部待决请求。 */
  private handleDisconnect(error: WwsError): void {
    this.rejectAll(error)
    this.sink?.onError?.(error)
  }

  /** 统一清理所有待决请求及其 timer。 */
  private rejectAll(error: WwsError): void {
    for (const request of this.requests.values()) {
      globalThis.clearTimeout(request.timer)
      request.reject(error)
    }
    this.requests.clear()
  }

  /** 只在 Worker 初始化尚未确认实例时创建 direct fallback。 */
  private async activateFallback(error: unknown): Promise<void> {
    if (this.fallbackActive)
      return
    if (!canFallbackFromWorkerError(error, this.workerInstanceId))
      throw error
    if (this.options.createFallback === undefined)
      throw toInitError(error)
    this.fallback = this.options.createFallback()
    this.fallbackActive = true
    this.rejectAll(toInitError(error))
    this.port.close?.()
    if (this.sink !== undefined)
      this.fallback.attach(this.sink)
  }

  /** 返回已创建的 fallback，否则抛出 Worker disconnected。 */
  private requireFallback(): ClientTransport<Incoming, Outgoing, Auth> {
    if (this.fallback === undefined)
      throw new WwsError('WORKER_DISCONNECTED', 'Direct fallback is not configured')
    return this.fallback
  }

  /** 拒绝已 dispose transport 的后续调用。 */
  private assertUsable(): void {
    if (this.disposed)
      throw new WwsError('CLIENT_DISPOSED', 'SharedWorker transport has been disposed')
  }
}
