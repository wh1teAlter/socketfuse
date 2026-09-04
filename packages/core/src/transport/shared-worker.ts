/** 通过 MessagePort 连接页面 client 与 SharedWorker runtime，并维护控制请求与 credit。 */
import type {
  ClientVisibility,
  ConnectionDiagnostics,
  ConnectionSnapshot,
  SendOptions,
  SendReceipt,
  TimerHandle,
} from '../shared/types'
import type { ReconnectPlanOverride } from '../connection/controller'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { ClientTransport, ClientTransportSink } from './direct'
import type { MessagePortLike } from '../worker/runtime'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, isWorkerControlMessage } from '../worker/control'
import { createSafePublicError, SocketFuseError } from '../shared/errors'
import { CONTROL_PROTOCOL_MAJOR } from '../shared/constants'

export interface SharedWorkerLike {
  /** Worker 端口；由 transport 独占其控制消息生命周期。 */
  readonly port: MessagePortLike
}

export interface SharedWorkerTransportOptions<Incoming, Outgoing> {
  /** 页面创建的 SharedWorker 实例。 */
  readonly worker: SharedWorkerLike
  /** 与 Worker hello 对齐的规范化配置。 */
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing>
  /** 当前页面逻辑 client id。 */
  readonly clientId: string
  /** inline 或 custom Worker 来源。 */
  readonly mode: 'inline' | 'custom'
  /** 仅在 allowlist 允许的 Worker 初始化失败后惰性创建 direct fallback。 */
  readonly createFallback?: () => ClientTransport<Incoming, Outgoing>
  /** hello 请求超时，单位为毫秒。 */
  readonly initTimeout?: number
  /** 注入 lease 报活周期定时器；仅供测试控制时间推进。 */
  readonly setInterval?: (callback: () => void, delay: number) => TimerHandle
  /** 与注入的 `setInterval` 配对的清除函数。 */
  readonly clearInterval?: (handle: TimerHandle) => void
}

interface PendingRequest {
  /** 控制请求成功回调。 */
  readonly resolve: (value: ControlResponseValue) => void
  /** 控制请求失败回调。 */
  readonly reject: (error: SocketFuseError) => void
  /** 请求超时 timer。 */
  readonly timer: TimerHandle
}

/** 只允许在 Worker 尚未确认实例身份时降级的错误码集合。 */
function canFallbackFromWorkerError(error: unknown, workerInstanceId: string | null): boolean {
  if (workerInstanceId !== null)
    return false
  if (!(error instanceof SocketFuseError))
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
function deserializeError(value: ControlError): SocketFuseError {
  return createSafePublicError(value.code, { fatal: value.fatal, retryable: value.retryable })
}

/** 将任意 hello 失败归一化为 Worker 初始化错误。 */
function toInitError(error: unknown): SocketFuseError {
  if (error instanceof SocketFuseError)
    return error
  return new SocketFuseError('WORKER_LOAD_FAILED', 'SharedWorker initialization failed', { cause: error })
}

/** 构造尚未收到 Worker diagnostics 时的安全初始快照。 */
function emptyDiagnostics<Incoming, Outgoing>(
  config: NormalizedWebSocketConfig<Incoming, Outgoing>,
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

/** 读取当前页面可见性；SSR 或未知状态按 visible 处理。 */
function pageVisibility(): ClientVisibility {
  if (typeof document === 'undefined')
    return 'visible'
  return document.visibilityState === 'hidden' || document.hidden ? 'hidden' : 'visible'
}

export class SharedWorkerTransport<Incoming, Outgoing> implements ClientTransport<Incoming, Outgoing> {
  /** transport 自己拥有的控制端口。 */
  private readonly port: MessagePortLike
  /** requestId 到待决请求的映射。 */
  private readonly requests = new Map<string, PendingRequest>()
  /** 页面 sink，在 attach 后才允许事件派发。 */
  private sink: ClientTransportSink<Incoming> | undefined
  /** 当前页面是否已向 Worker 提交逻辑 client attach。 */
  private attached = false
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
  private fallback: ClientTransport<Incoming, Outgoing> | undefined
  /** 页面希望注册并在重新 hello 后恢复的 execution keys。 */
  private readonly exclusiveKeys = new Set<string>()
  /** Worker 已明确授予当前端口的 execution keys。 */
  private readonly heldKeys = new Set<string>()
  /** Worker 当前指派给本端口、尚未完成或撤销的 reconnect plans。 */
  private readonly activeReconnectPlans = new Set<string>()
  /** 最近上报给 Worker 选主的页面活性。 */
  private visibility: ClientVisibility = pageVisibility()
  /** 页面是否声明了自动重连 hook。 */
  private reconnectHook = false

  /** 绑定端口监听并启动 MessagePort。 */
  constructor(readonly options: SharedWorkerTransportOptions<Incoming, Outgoing>) {
    this.port = options.worker.port
    const onMessage = (event: { readonly data: unknown }): void => this.handleMessage(event.data)
    const onMessageError = (): void => this.handleDisconnect(new SocketFuseError('WORKER_DISCONNECTED', 'SharedWorker port reported a message error', { retryable: true }))
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

  /** 绑定页面 sink 并后台发起 hello。 */
  attach(sink: ClientTransportSink<Incoming>): void {
    this.sink = sink
    this.attached = true
    for (const key of this.heldKeys)
      sink.onKeyChange?.(key, true)
    if (this.fallbackActive) {
      this.fallback?.attach(sink)
      return
    }
    void this.ensureHello().catch((error) => {
      if (!this.attached)
        return
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
      throw new SocketFuseError('ABORTED', 'Open wait was aborted')
    try {
      await this.ensureHello()
    }
    catch (error) {
      await this.activateFallback(error)
    }
    if (!this.attached)
      throw new SocketFuseError('CLIENT_DISCONNECTED', 'Client is not attached')
    if (this.fallbackActive) {
      if (this.sink !== undefined)
        this.fallback?.attach(this.sink)
      if (this.fallback === undefined)
        throw toInitError(new SocketFuseError('WORKER_DISCONNECTED', 'SharedWorker initialization failed'))
      return this.fallback.open(signal)
    }
    await this.syncRegistrations()
    if (!this.attached)
      throw new SocketFuseError('CLIENT_DISCONNECTED', 'Client is not attached')
    const snapshot = await this.request({ requestId: createId(), type: 'open' }) as ConnectionSnapshot
    if (!this.attached)
      throw new SocketFuseError('CLIENT_DISCONNECTED', 'Client is no longer attached')
    return snapshot
  }

  /** 请求 detach 当前页面 client。 */
  async close(): Promise<void> {
    this.attached = false
    if (this.fallbackActive) {
      await this.fallback?.close()
      this.revokeWorkerAuthority()
      return
    }
    if (this.helloPromise === undefined) {
      this.revokeWorkerAuthority()
      return
    }
    try {
      // hello 仍在进行时必须先等待其结果，确保 Worker 按 hello→close 顺序提交；
      // 初始化失败则端口已经不再附着，不能再发送一个会无谓等待超时的 close 请求。
      await this.helloPromise
    }
    catch {
      this.resetHello()
      this.revokeWorkerAuthority()
      return
    }
    try {
      await this.request({ requestId: createId(), type: 'close' })
    }
    finally {
      // 无论 Worker 是否及时确认 close，页面都不能继续依据旧 grant/plan
      // 执行；下一次 open 会重新 hello 并等待新的权威控制帧。
      this.resetHello()
      this.revokeWorkerAuthority()
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

  /** 向 Worker 注册 execution key 候选，重复注册保持幂等。 */
  async registerExclusiveKey(key: string): Promise<void> {
    if (this.exclusiveKeys.has(key))
      return
    this.exclusiveKeys.add(key)
    // onMessage 可以在 open 前注册；此时只记录页面意图，避免未附着页面
    // 提前占用 Worker 的候选与 lease。真正的注册由 attach/open 后同步。
    if (!this.attached)
      return
    await this.ensureReady()
    if (!this.attached)
      return
    if (!this.exclusiveKeys.has(key))
      return
    if (this.fallbackActive) {
      await this.requireFallback().registerExclusiveKey(key)
      return
    }
    try {
      await this.request({ key, requestId: createId(), type: 'register-key' })
    }
    catch (error) {
      // 资源上限拒绝时回滚页面 desired set；否则后续 open 会重复失败并
      // 阻断连接。调用方仍通过 error 路径获得 RESOURCE_LIMIT_EXCEEDED。
      this.exclusiveKeys.delete(key)
      throw error
    }
  }

  /** 从 Worker 注销 execution key 候选。 */
  async unregisterExclusiveKey(key: string): Promise<void> {
    if (!this.exclusiveKeys.delete(key))
      return
    if (this.fallbackActive) {
      await this.requireFallback().unregisterExclusiveKey(key)
      return
    }
    if (this.workerInstanceId !== null)
      await this.request({ key, requestId: createId(), type: 'unregister-key' })
  }

  /** 缓存并向已 hello Worker 上报页面执行活性。 */
  setVisibility(visibility: ClientVisibility): void {
    this.visibility = visibility
    if (this.fallbackActive) {
      this.fallback?.setVisibility(visibility)
      return
    }
    if (this.workerInstanceId !== null)
      this.post({ type: 'visibility', visibility })
  }

  /** 更新页面对 Worker reconnect plan 的候选资格。 */
  async setReconnectHook(enabled: boolean): Promise<void> {
    this.reconnectHook = enabled
    if (!this.attached)
      return
    await this.ensureReady()
    if (!this.attached)
      return
    if (this.fallbackActive) {
      await this.requireFallback().setReconnectHook(enabled)
      return
    }
    await this.request({ enabled, requestId: createId(), type: 'set-reconnect-hook' })
  }

  /** 向 Worker 原子提交当前页面拥有的 reconnect plan 草案。 */
  async completeReconnectPlan(planId: string, override: Readonly<ReconnectPlanOverride>): Promise<void> {
    if (!this.attached)
      throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer active')
    await this.ensureReady()
    if (this.fallbackActive) {
      try {
        await this.requireFallback().completeReconnectPlan(planId, override)
      }
      finally {
        this.activeReconnectPlans.delete(planId)
      }
      return
    }
    try {
      await this.request({
        ...(override.delay === undefined ? {} : { delay: override.delay }),
        planId,
        requestId: createId(),
        type: 'complete-reconnect-plan',
        ...(override.url === undefined ? {} : { url: override.url }),
      })
    }
    finally {
      this.activeReconnectPlans.delete(planId)
    }
  }

  /** 告知 Worker 当前页面 hook 失败并转交计划。 */
  async rejectReconnectPlan(planId: string): Promise<void> {
    if (!this.attached)
      throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer active')
    await this.ensureReady()
    if (this.fallbackActive) {
      try {
        await this.requireFallback().rejectReconnectPlan(planId)
      }
      finally {
        this.activeReconnectPlans.delete(planId)
      }
      return
    }
    try {
      await this.request({ planId, requestId: createId(), type: 'reject-reconnect-plan' })
    }
    finally {
      this.activeReconnectPlans.delete(planId)
    }
  }

  /** 请求共享物理连接重连。 */
  async reconnect(): Promise<void> {
    await this.ensureReady()
    if (this.fallbackActive) {
      await this.requireFallback().reconnect()
      return
    }
    await this.request({ requestId: createId(), type: 'reconnect' })
  }

  /** 验证 Worker 实例未在生命周期恢复期间静默更换。 */
  async probe(): Promise<string> {
    this.assertUsable()
    await this.ensureHello()
    if (this.fallbackActive)
      throw new SocketFuseError('WORKER_DISCONNECTED', 'SharedWorker transport is no longer selected')
    const value = await this.request({ requestId: createId(), type: 'probe' }, 1_000)
    if (value === null || typeof value !== 'object' || !('workerInstanceId' in value) || typeof value.workerInstanceId !== 'string')
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE', 'SharedWorker probe returned an invalid response')
    if (this.workerInstanceId !== null && this.workerInstanceId !== value.workerInstanceId)
      throw new SocketFuseError('WORKER_DISCONNECTED', 'SharedWorker instance changed', { retryable: true })
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
    this.attached = false
    if (this.fallbackActive) {
      this.disposed = true
      this.revokeWorkerAuthority()
      this.exclusiveKeys.clear()
      this.reconnectHook = false
      this.resetHello()
      this.fallback?.dispose()
      return
    }
    this.resetHello()
    // 即使端口刚创建且尚未 hello，也应立即释放，不能等待 Worker 的
    // unattached timeout 才回收控制平面额度。
    try {
      this.port.postMessage({ requestId: createId(), type: 'dispose' })
    }
    catch {
      // A failed port still gets closed below.
    }
    this.port.close?.()
    this.rejectAll(new SocketFuseError('CLIENT_DISPOSED', 'SharedWorker transport was disposed'))
    this.revokeWorkerAuthority()
    this.exclusiveKeys.clear()
    this.reconnectHook = false
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
      visibility: this.visibility,
    }, this.options.initTimeout ?? 5_000).then((value) => {
      if (value === null || typeof value !== 'object' || !('workerInstanceId' in value))
        throw new SocketFuseError('INVALID_CONTROL_MESSAGE', 'SharedWorker returned an invalid welcome response')
      this.workerInstanceId = String(value.workerInstanceId)
      const start = this.options.setInterval ?? ((callback, delay) => globalThis.setInterval(callback, delay))
      this.leaseTimer = start(() => this.post({ type: 'lease' }), this.options.config.shared.lease.interval)
    })
    return this.helloPromise
  }

  /** 清除 hello/lease 状态，使后续 open 能重新握手。 */
  private resetHello(): void {
    if (this.leaseTimer !== undefined)
      (this.options.clearInterval ?? (handle => globalThis.clearInterval(handle)))(this.leaseTimer)
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
      return Promise.reject(new SocketFuseError('INVALID_CONTROL_MESSAGE', 'Control request is missing requestId'))
    const promise = new Promise<ControlResponseValue>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.requests.delete(message.requestId)
        reject(new SocketFuseError(message.type === 'hello' ? 'WORKER_INIT_TIMEOUT' : 'WORKER_DISCONNECTED', 'SharedWorker request timed out', { retryable: true }))
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
      this.handleDisconnect(new SocketFuseError('WORKER_DISCONNECTED', 'Unable to post to SharedWorker', { cause, retryable: true }))
    }
  }

  /** 校验并分派 Worker 控制消息，receipt 在业务 handler 前发送以释放 credit。 */
  private handleMessage(value: unknown): void {
    if (!isWorkerControlMessage(value)) {
      this.handleDisconnect(new SocketFuseError('INVALID_CONTROL_MESSAGE', 'SharedWorker sent an invalid control message'))
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
    if (!this.attached)
      return
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
    else if (value.type === 'key-granted')
      this.setKeyHeld(value.key, true)
    else if (value.type === 'key-revoked') {
      if (this.heldKeys.has(value.key))
        this.setKeyHeld(value.key, false)
      else
        this.sink?.onKeyBarrier?.(value.key)
    }
    else if (value.type === 'before-reconnect') {
      this.activeReconnectPlans.add(value.plan.id)
      this.sink?.onBeforeReconnect?.(value.plan)
    }
    else if (value.type === 'abort-reconnect') {
      this.activeReconnectPlans.delete(value.planId)
      this.sink?.onReconnectAbort?.(value.planId)
    }
  }

  /** 缓存 Worker 返回的 diagnostics 快照。 */
  private setDiagnostics(value: ControlResponseValue): void {
    if (value === null || typeof value !== 'object' || !('logicalState' in value))
      return
    this.diagnosticsSnapshot = value as ConnectionDiagnostics
  }

  /** 处理端口断开并拒绝全部待决请求。 */
  private handleDisconnect(error: SocketFuseError): void {
    this.rejectAll(error)
    this.revokeWorkerAuthority()
    this.sink?.onError?.(error)
  }

  /** 统一清理所有待决请求及其 timer。 */
  private rejectAll(error: SocketFuseError): void {
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
    this.revokeWorkerAuthority()
    this.port.close?.()
    if (this.sink !== undefined)
      this.fallback.attach(this.sink)
    this.fallback.setVisibility(this.visibility)
    for (const key of this.exclusiveKeys)
      await this.fallback.registerExclusiveKey(key)
    await this.fallback.setReconnectHook(this.reconnectHook)
  }

  /** fresh hello 后恢复页面仍声明的 execution key 与 reconnect hook。 */
  private async syncRegistrations(): Promise<void> {
    if (this.fallbackActive || !this.attached)
      return
    for (const key of [...this.exclusiveKeys]) {
      if (!this.attached)
        return
      try {
        await this.request({ key, requestId: createId(), type: 'register-key' })
      }
      catch (error) {
        if (error instanceof SocketFuseError && error.code === 'RESOURCE_LIMIT_EXCEEDED') {
          // desired set 中移除超限 key，使 open 仍可建立连接；该注册失败
          // 通过页面既有 error sink 报告，而不是重复阻断后续 open。
          this.exclusiveKeys.delete(key)
          this.sink?.onError?.(error)
          continue
        }
        throw error
      }
    }
    if (this.reconnectHook && this.attached)
      await this.request({ enabled: true, requestId: createId(), type: 'set-reconnect-hook' })
  }

  /** 只在实际 grant/revoke 变化时更新缓存并通知页面。 */
  private setKeyHeld(key: string, held: boolean): void {
    const changed = held ? !this.heldKeys.has(key) : this.heldKeys.has(key)
    if (!changed)
      return
    if (held)
      this.heldKeys.add(key)
    else
      this.heldKeys.delete(key)
    this.sink?.onKeyChange?.(key, held)
  }

  /** Worker 失联或 transport 切换时撤销全部 Worker 权威状态，禁止页面继续本地推断。 */
  private revokeWorkerAuthority(): void {
    for (const key of [...this.heldKeys])
      this.setKeyHeld(key, false)
    for (const planId of this.activeReconnectPlans)
      this.sink?.onReconnectAbort?.(planId)
    this.activeReconnectPlans.clear()
  }

  /** 返回已创建的 fallback，否则抛出 Worker disconnected。 */
  private requireFallback(): ClientTransport<Incoming, Outgoing> {
    if (this.fallback === undefined)
      throw new SocketFuseError('WORKER_DISCONNECTED', 'Direct fallback is not configured')
    return this.fallback
  }

  /** 拒绝已 dispose transport 的后续调用。 */
  private assertUsable(): void {
    if (this.disposed)
      throw new SocketFuseError('CLIENT_DISPOSED', 'SharedWorker transport has been disposed')
  }
}
