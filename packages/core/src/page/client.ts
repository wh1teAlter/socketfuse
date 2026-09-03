/**
 * 将 direct 或 SharedWorker transport 呈现为稳定的页面 WebSocketClient。
 * 页面生命周期、监听器、回放和执行授权属于本模块；物理 socket 所有权仍在 transport
 * 与 connection 层，且任何用户 handler 都在页面侧异步隔离执行。
 */
import type {
  BeforeReconnectContext,
  BeforeReconnectHandler,
  ClientVisibility,
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ConnectionState,
  CreateWebSocketOptions,
  MessageHandlerContext,
  MessageHandlerOptions,
  NormalizedRestoreOptions,
  SendOptions,
  SendReceipt,
  SocketFuseCloseEvent,
  SocketFuseDiagnosticEvent,
  SocketFuseKeyChangeEvent,
  SocketFuseMessageEvent,
  SocketFuseOverflowEvent,
  SocketFuseStateChangeEvent,
  Transport,
  WebSocketClient,
  WebSocketStatus,
  WorkerMode,
} from '../shared/types'
import type { ReconnectPlan, ReconnectPlanOverride } from '../connection/controller'
import type { ClientTransport, ClientTransportSink } from '../transport/direct'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import { SocketFuseError, toSafePublicError, toSocketFuseError } from '../shared/errors'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'
import { readyStateFor, statusFor } from '../connection/state'
import { CONTROL_PROTOCOL_MAJOR } from '../shared/constants'
import { normalizeEndpointUrl } from '../shared/endpoint'

/** 动态消息 handler 的页面本地签名。 */
type MessageHandler<Incoming> = (event: SocketFuseMessageEvent<Incoming>, context: Readonly<MessageHandlerContext>) => unknown

/** 页面本地 handler 及其可选 execution key。 */
interface MessageHandlerEntry<Incoming> {
  /** 页面本地 handler。 */
  readonly handler: MessageHandler<Incoming>
  /** 省略时每页执行，否则由 Worker grant gate。 */
  readonly key?: string
}

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
function sanitizeError(error: SocketFuseError): SocketFuseError {
  const details = sanitizeDetails(error.details)
  return toSafePublicError(new SocketFuseError(error.code, error.message, details === undefined
    ? { fatal: error.fatal, retryable: error.retryable }
    : { details, fatal: error.fatal, retryable: error.retryable }))
}

/** 创建带解码数据、时间和 transport 的 message 事件。 */
function createMessageEvent<Incoming>(data: Incoming, receivedAt: number, transport: Exclude<Transport, 'pending'>, replayed: boolean): SocketFuseMessageEvent<Incoming> {
  const event = new Event('message') as SocketFuseMessageEvent<Incoming>
  Object.defineProperties(event, {
    data: { value: data },
    receivedAt: { value: receivedAt },
    replayed: { value: replayed },
    transport: { value: transport },
  })
  return event
}

/** 创建不暴露 close reason 的页面 close 事件。 */
function createCloseEvent(event: { readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }): SocketFuseCloseEvent {
  const result = new Event('close') as SocketFuseCloseEvent
  Object.defineProperties(result, {
    code: { value: event.code },
    terminal: { value: event.terminal },
    wasClean: { value: event.wasClean },
    willReconnect: { value: event.willReconnect },
  })
  return result
}

/** 创建携带已脱敏 SocketFuseError 的 error 事件。 */
function createErrorEvent(error: SocketFuseError): Event {
  const event = new Event('error')
  Object.defineProperty(event, 'error', { value: error })
  Object.defineProperty(event, 'detail', { value: error })
  return event
}

/** 创建 execution key 实际授权变化事件。 */
function createKeyChangeEvent(key: string, held: boolean): SocketFuseKeyChangeEvent {
  const event = new Event('keychange') as SocketFuseKeyChangeEvent
  Object.defineProperties(event, {
    held: { value: held },
    key: { value: key },
  })
  return event
}

/** 读取 Worker 选主需要的页面执行活性。 */
function pageVisibility(): ClientVisibility {
  if (typeof document === 'undefined')
    return 'visible'
  return document.visibilityState === 'hidden' || document.hidden ? 'hidden' : 'visible'
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

/** 将 transport 包装为稳定、页面本地且可观察的公开 client。 */
export class PageWebSocketClient<Incoming, Outgoing> extends EventTargetBase implements WebSocketClient<Incoming, Outgoing> {
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
  private readonly handlers = new Map<symbol, MessageHandlerEntry<Incoming>>()
  /** 每个 execution key 的页面本地 handler 引用数。 */
  private readonly keyReferences = new Map<string, number>()
  /** Worker 控制帧确认的当前持有集合。 */
  private readonly heldKeys = new Set<string>()
  /** freeze 前已注册 key 的 revoke 屏障；屏障前到达的旧 grant 必须忽略。 */
  private readonly frozenKeyBarriers = new Set<string>()
  /** 屏障期间到达、需等同一端口 probe 成功后才能应用的候选 grant。 */
  private readonly deferredKeyGrants = new Set<string>()
  /** 页面进入后台后可能错过 lease 回收；每次状态不确定都会推进该代际。 */
  private authorityGeneration = 0
  /** 最近一次经存活 Worker/transport 验证的授权代际。 */
  private validatedAuthorityGeneration = 0
  /** 每次 key grant 对应一个新的协作式中止域。 */
  private readonly keySignals = new Map<string, AbortController>()
  /** 无 key handler 在 client dispose 前共享的存活域。 */
  private readonly lifetimeSignal = new AbortController()
  /** 当前页面唯一的重连准备 hook。 */
  private beforeReconnectHandler: BeforeReconnectHandler | undefined
  /** plan id 到页面 hook AbortController。 */
  private readonly reconnectSignals = new Map<string, AbortController>()
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
  /** 页面是否曾显式或 immediate 请求连接。 */
  private hadDemand = false
  /** 合并并发 restore 事件的恢复 promise。 */
  private recovery: Promise<void> | undefined

  /** 创建稳定页面 client，并安装可选生命周期监听。 */
  constructor(
    readonly config: NormalizedWebSocketConfig<Incoming, Outgoing>,
    private clientTransport: ClientTransport<Incoming, Outgoing>,
    readonly options: CreateWebSocketOptions<Incoming, Outgoing>,
    readonly clientId: string,
    private readonly recreateSharedTransport?: () => ClientTransport<Incoming, Outgoing>,
  ) {
    super()
    this.currentTransport = clientTransport.kind
    this.currentWorkerMode = clientTransport.workerMode
    this.restore = config.local.lifecycle
    // direct transport 的初始可见性不能依赖构造默认值；SharedWorker transport
    // 也在 hello 前只缓存该状态，不会因此提前附着页面。
    this.clientTransport.setVisibility(pageVisibility())
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

  /** 附着页面 sink 并等待连接 ready；失败以安全 SocketFuseError reject。 */
  async open(options?: { signal?: AbortSignal }): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (!this.attached) {
      if (pageVisibility() === 'hidden')
        this.authorityGeneration++
      this.clientTransport.attach(this.createSink())
      this.attached = true
    }
    const snapshot = await this.sanitizePublicPromise(this.clientTransport.open(options?.signal))
    if (!this.attached)
      throw new SocketFuseError('CLIENT_DISCONNECTED', 'Client is no longer attached')
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
    // close 请求跨端口确认前就停止旧 grant，避免已排队消息继续启动副作用。
    this.revokeLocalKeyAuthority()
    try {
      await this.sanitizePublicPromise(this.clientTransport.close())
    }
    finally {
      // close 是页面的逻辑边界；即使 Worker 没有及时确认，旧 transport
      // 也不能阻止后续 open 或继续暴露旧的持有状态。
      this.attached = false
      this.hadDemand = false
      this.frozenKeyBarriers.clear()
      this.deferredKeyGrants.clear()
      this.validatedAuthorityGeneration = this.authorityGeneration
      this.setState('closed', 'CLIENT_DISCONNECTED')
    }
  }

  /** 发送业务值；返回值只代表本地 accepted/queued，失败以 SocketFuseError reject。 */
  sendMessage(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    this.assertUsable()
    if (!this.attached)
      return Promise.reject(new SocketFuseError('CLIENT_DISCONNECTED', 'Client is not open'))
    return this.sanitizePublicPromise(this.clientTransport.send(data, options))
  }

  /** 动态注册页面消息 handler，并返回只移除本次注册的函数。 */
  onMessage(handler: MessageHandler<Incoming>, options: MessageHandlerOptions = {}): () => void {
    this.assertUsable()
    if (typeof handler !== 'function')
      throw new SocketFuseError('INVALID_OPTIONS', 'onMessage handler must be a function')
    const key = options.key
    if (key !== undefined && (typeof key !== 'string' || key.trim().length === 0 || key.length > 1_024))
      throw new SocketFuseError('INVALID_OPTIONS', 'onMessage key must be a non-empty string of at most 1024 characters')
    const token = Symbol('onMessage')
    this.handlers.set(token, key === undefined ? { handler } : { handler, key })
    if (key !== undefined) {
      const references = this.keyReferences.get(key) ?? 0
      this.keyReferences.set(key, references + 1)
      // transport 会对已成功或正在进行的注册去重；每次新增 handler 都再次
      // 表达意图，使先前因资源上限被回滚的同 key 注册可以显式重试。
      void this.clientTransport.registerExclusiveKey(key).catch(error => this.handleTransportError(error))
    }
    let removed = false
    return () => {
      if (removed)
        return
      removed = true
      this.handlers.delete(token)
      if (key === undefined)
        return
      const references = (this.keyReferences.get(key) ?? 1) - 1
      if (references > 0) {
        this.keyReferences.set(key, references)
        return
      }
      this.keyReferences.delete(key)
      this.deferredKeyGrants.delete(key)
      void this.clientTransport.unregisterExclusiveKey(key).catch(error => this.handleTransportError(error))
    }
  }

  /** 只查询 transport 控制帧维护的页面持有集合。 */
  holdsKey(key: string): boolean {
    return this.heldKeys.has(key)
  }

  /** 注册或替换当前页面唯一的自动重连准备 hook。 */
  onBeforeReconnect(handler: BeforeReconnectHandler): () => void {
    this.assertUsable()
    if (typeof handler !== 'function')
      throw new SocketFuseError('INVALID_OPTIONS', 'onBeforeReconnect handler must be a function')
    if (this.beforeReconnectHandler !== undefined && this.beforeReconnectHandler !== handler)
      this.abortLocalReconnectPlans(true)
    this.beforeReconnectHandler = handler
    void this.clientTransport.setReconnectHook(true).catch(error => this.handleTransportError(error))
    let removed = false
    return () => {
      if (removed || this.beforeReconnectHandler !== handler)
        return
      removed = true
      this.abortLocalReconnectPlans(false)
      this.beforeReconnectHandler = undefined
      void this.clientTransport.setReconnectHook(false).catch(error => this.handleTransportError(error))
    }
  }

  /** 在 client 未 dispose 时请求物理连接重连。 */
  reconnect(): Promise<void> {
    this.assertUsable()
    if (!this.attached)
      return Promise.reject(new SocketFuseError('CLIENT_DISCONNECTED', 'Client is not open'))
    return this.sanitizePublicPromise(this.clientTransport.reconnect())
  }

  /** 返回不含 URL path/query、凭据或 payload 的诊断快照。 */
  diagnostics(): Readonly<ConnectionDiagnostics> {
    const base = this.clientTransport.diagnostics()
    return Object.freeze({
      attachedClientCount: numberValue(base.attachedClientCount),
      bufferedAmount: numberValue(base.bufferedAmount),
      configFingerprint: stringValue(base.configFingerprint),
      controlProtocolMajor: CONTROL_PROTOCOL_MAJOR,
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
    this.lifetimeSignal.abort()
    for (const controller of this.keySignals.values())
      controller.abort()
    for (const controller of this.reconnectSignals.values())
      controller.abort()
    this.reconnectSignals.clear()
    this.keySignals.clear()
    this.heldKeys.clear()
    this.frozenKeyBarriers.clear()
    this.deferredKeyGrants.clear()
    this.validatedAuthorityGeneration = this.authorityGeneration
    this.keyReferences.clear()
    this.handlers.clear()
    this.clientTransport.dispose()
    this.setState('closed', 'CLIENT_DISPOSED')
  }

  /** 创建 transport 事件到页面 client 的 sink。 */
  private createSink(): ClientTransportSink<Incoming> {
    return {
      id: this.clientId,
      onClose: event => this.handleClose(event),
      onError: error => this.handleError(error),
      onMessage: (data, receivedAt, replayed) => this.handleMessage(data, receivedAt, replayed),
      onKeyBarrier: key => this.handleKeyBarrier(key),
      onKeyChange: (key, held) => this.handleKeyChange(key, held),
      onBeforeReconnect: plan => this.handleBeforeReconnect(plan),
      onReconnectAbort: planId => this.abortReconnectPlan(planId),
      onOverflow: event => this.dispatchRemoteOverflow(event),
      onOpen: snapshot => this.handleOpen(snapshot),
      onState: (snapshot, reasonCode) => this.handleState(snapshot, reasonCode),
    }
  }

  /** 应用 transport 授权变化，并在 revoke 时 abort 旧 grant 的在途 handler。 */
  private handleKeyChange(key: string, held: boolean): void {
    if (!held) {
      this.frozenKeyBarriers.delete(key)
      this.deferredKeyGrants.delete(key)
    }
    else if (this.frozenKeyBarriers.has(key)) {
      this.deferredKeyGrants.add(key)
      return
    }
    if (held === this.heldKeys.has(key))
      return
    if (held) {
      this.heldKeys.add(key)
      this.keySignals.set(key, new AbortController())
    }
    else {
      this.heldKeys.delete(key)
      this.keySignals.get(key)?.abort()
      this.keySignals.delete(key)
    }
    this.dispatchEvent(createKeyChangeEvent(key, held))
  }

  /** 消费 Worker 的明确 revoke 屏障，并丢弃屏障前积压的 grant。 */
  private handleKeyBarrier(key: string): void {
    this.frozenKeyBarriers.delete(key)
    this.deferredKeyGrants.delete(key)
  }

  /** 保守撤销全部本地 grant；重新执行必须等待 transport 新的明确授权。 */
  private revokeLocalKeyAuthority(): void {
    this.deferredKeyGrants.clear()
    for (const key of [...this.heldKeys]) {
      this.heldKeys.delete(key)
      this.keySignals.get(key)?.abort()
      this.keySignals.delete(key)
      this.dispatchEvent(createKeyChangeEvent(key, false))
    }
  }

  /** 在页面 realm 执行被选中的 hook，并在成功返回后一次性提交本地草案。 */
  private handleBeforeReconnect(plan: Readonly<ReconnectPlan>): void {
    const handler = this.beforeReconnectHandler
    if (handler === undefined) {
      void this.clientTransport.rejectReconnectPlan(plan.id).catch(error => this.handleTransportError(error))
      return
    }
    const abort = new AbortController()
    this.reconnectSignals.set(plan.id, abort)
    const draft: { delay?: number, url?: string } = {}
    const context: Readonly<BeforeReconnectContext> = Object.freeze({
      attempt: plan.attempt,
      close: plan.close,
      defaultDelay: plan.defaultDelay,
      reason: plan.reason,
      setDelay: (delay: number): void => {
        if (abort.signal.aborted)
          throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer active')
        if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0)
          throw new SocketFuseError('INVALID_OPTIONS', 'Reconnect delay must be a non-negative finite number')
        draft.delay = delay
      },
      setOptions: (options: { readonly url: string }): void => {
        if (abort.signal.aborted)
          throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer active')
        if (options === null || typeof options !== 'object' || Object.keys(options).some(key => key !== 'url'))
          throw new SocketFuseError('INVALID_OPTIONS', 'Reconnect options only accept url')
        draft.url = normalizeEndpointUrl(options.url, 'Reconnect url')
      },
      signal: abort.signal,
    })
    void this.runBeforeReconnectHandler(handler, plan.id, context, draft, abort)
  }

  /** 隔离 hook 异常，成功时原子提交，失败时只发送无异常文本的 reject。 */
  private async runBeforeReconnectHandler(
    handler: BeforeReconnectHandler,
    planId: string,
    context: Readonly<BeforeReconnectContext>,
    draft: ReconnectPlanOverride,
    abort: AbortController,
  ): Promise<void> {
    try {
      await handler(context)
      if (abort.signal.aborted)
        return
      await this.clientTransport.completeReconnectPlan(planId, draft)
    }
    catch (error) {
      if (abort.signal.aborted)
        return
      try {
        await this.clientTransport.rejectReconnectPlan(planId)
      }
      catch {
        // Worker 已转移或提交的 plan 不再需要二次失败通知。
      }
      const code = error instanceof SocketFuseError && (error.code === 'INVALID_OPTIONS' || error.code === 'STALE_RECONNECT_PLAN')
        ? error.code
        : 'INTERNAL_STATE_ERROR'
      this.handleError(new SocketFuseError(code, 'onBeforeReconnect handler failed', { cause: error }))
    }
    finally {
      // 成功提交或失败转移后，context 已不再拥有当前 plan；把 signal
      // 置为 aborted 也能让 handler 持有的延迟 setter 明确拒绝过期写入。
      if (!abort.signal.aborted)
        abort.abort()
      if (this.reconnectSignals.get(planId) === abort)
        this.reconnectSignals.delete(planId)
    }
  }

  /** 响应 Worker/direct coordinator 的撤销并中止当前页面异步 getter。 */
  private abortReconnectPlan(planId: string): void {
    this.reconnectSignals.get(planId)?.abort()
    this.reconnectSignals.delete(planId)
  }

  /** 终止本页面旧 hook 持有的计划；替换时显式拒绝以免旧 handler 稍后提交。 */
  private abortLocalReconnectPlans(reject: boolean): void {
    const planIds = [...this.reconnectSignals.keys()]
    for (const planId of planIds)
      this.abortReconnectPlan(planId)
    if (reject) {
      for (const planId of planIds)
        void this.clientTransport.rejectReconnectPlan(planId).catch(() => undefined)
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
      this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR', 'onConnected callback failed', { cause }))
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
    for (const entry of [...this.handlers.values()]) {
      if (entry.key !== undefined
        && (!this.heldKeys.has(entry.key) || this.frozenKeyBarriers.has(entry.key)))
        continue
      const signal = entry.key === undefined
        ? this.lifetimeSignal.signal
        : this.keySignals.get(entry.key)?.signal
      if (signal === undefined)
        continue
      try {
        const result = entry.handler(event, Object.freeze({ signal })) as unknown
        void Promise.resolve(result).catch(cause => this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR', 'onMessage handler failed', { cause })))
      }
      catch (cause) {
        this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR', 'onMessage handler failed', { cause }))
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
      this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR', 'onDisconnected callback failed', { cause }))
    }
  }

  /** 脱敏错误后派发 error/diagnostic，并隔离 logger 与 callback。 */
  private handleError(error: SocketFuseError): void {
    const publicError = sanitizeError(error)
    this.dispatchEvent(createErrorEvent(publicError))
    const diagnosticEvent = new Event('diagnostic')
    Object.defineProperty(diagnosticEvent, 'diagnostic', {
      value: Object.freeze({ code: publicError.code, timestamp: Date.now(), type: 'error' }),
    })
    this.dispatchEvent(diagnosticEvent)
    const diagnostic: SocketFuseDiagnosticEvent = publicError.details === undefined
      ? { code: publicError.code, timestamp: Date.now(), type: 'error' }
      : { code: publicError.code, details: publicError.details, timestamp: Date.now(), type: 'error' }
    this.options.logger?.(diagnostic)
    try {
      this.options.onError?.(this, publicError)
    }
    catch {
      // 用户错误回调不能反向影响 transport。
    }
  }

  /** 更新逻辑状态并仅在实际变化时派发 statechange。 */
  private setState(state: ConnectionState, reasonCode?: string, snapshot?: ConnectionSnapshot): void {
    const previous = this.currentState
    this.currentState = state
    if (previous === state)
      return
    const event = new Event('statechange') as SocketFuseStateChangeEvent
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
      this.clientTransport.setVisibility(force ? 'frozen' : 'hidden')
      if (this.attached)
        this.authorityGeneration++
      if (force) {
        // 浏览器可能在 Worker revoke 返回前冻结页面；先本地撤销只会减少
        // 执行，恢复后仍必须由新的 grant 才能再次开始 keyed handler。
        if (this.clientTransport.kind === 'shared-worker') {
          for (const key of this.keyReferences.keys())
            this.frozenKeyBarriers.add(key)
        }
        this.revokeLocalKeyAuthority()
        this.abortLocalReconnectPlans(false)
      }
      if (!this.restore.enabled || !this.attached)
        return
      if (force || document.visibilityState === 'hidden' || document.hidden) {
        this.suspended = true
        this.clientTransport.suspend?.()
      }
    }
    const restore = (): void => {
      const authorityNeedsValidation = this.attached
        && this.authorityGeneration !== this.validatedAuthorityGeneration
      if (authorityNeedsValidation && this.clientTransport.kind === 'shared-worker') {
        // hidden 页面可能在后台被浏览器冻结，随后由 Worker lease 回收。返回
        // 前先建立内部 gate，只有同一端口 probe 或新端口 grant 能解除不确定性。
        for (const key of this.keyReferences.keys())
          this.frozenKeyBarriers.add(key)
      }
      this.clientTransport.setVisibility(pageVisibility())
      if (!authorityNeedsValidation && (!this.restore.enabled || !this.suspended))
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
    const authorityGeneration = this.authorityGeneration
    const wasSuspended = this.suspended
    const authorityNeedsValidation = authorityGeneration !== this.validatedAuthorityGeneration
    if (!wasSuspended && !authorityNeedsValidation)
      return
    try {
      await this.clientTransport.probe?.()
    }
    catch (error) {
      try {
        await this.recreateTransport()
      }
      catch (recoveryError) {
        this.handleError(recoveryError instanceof SocketFuseError
          ? recoveryError
          : new SocketFuseError('WORKER_DISCONNECTED', 'SharedWorker recovery failed', { cause: error ?? recoveryError, retryable: true }))
        return
      }
    }
    // 验证期间若页面再次进入后台，旧 probe 不能解除新一代授权不确定性，
    // 也不能提前恢复 Worker replay。下一次 visible 会继续完成该事务。
    if (this.authorityGeneration !== authorityGeneration)
      return
    this.validatedAuthorityGeneration = authorityGeneration
    const deferredGrants = [...this.deferredKeyGrants]
      .filter(key => this.frozenKeyBarriers.has(key) && this.keyReferences.has(key))
    this.frozenKeyBarriers.clear()
    this.deferredKeyGrants.clear()
    for (const key of deferredGrants)
      this.handleKeyChange(key, true)
    this.suspended = false
    this.clientTransport.restore?.()
    if (wasSuspended && this.restore.replay) {
      const entries = this.replay.splice(0)
      this.replayBytes = 0
      for (const entry of entries)
        this.dispatchMessage(entry.data, entry.receivedAt, true)
    }
  }

  /** 重建已失效 SharedWorker transport，并重放 key、hook 与连接需求。 */
  private async recreateTransport(): Promise<void> {
    if (this.clientTransport.kind !== 'shared-worker' || this.recreateSharedTransport === undefined)
      return
    const oldTransport = this.clientTransport
    oldTransport.dispose()
    // 新 Worker/port 不可能携带旧端口 freeze 前的 grant，清除旧屏障后
    // 仍只接受 replacement 明确下发的新授权。
    this.frozenKeyBarriers.clear()
    this.deferredKeyGrants.clear()
    this.revokeLocalKeyAuthority()
    const replacement = this.recreateSharedTransport()
    this.clientTransport = replacement
    this.currentTransport = replacement.kind
    this.currentWorkerMode = replacement.workerMode
    replacement.attach(this.createSink())
    this.attached = true
    replacement.setVisibility(pageVisibility())
    for (const key of this.keyReferences.keys())
      await replacement.registerExclusiveKey(key)
    await replacement.setReconnectHook(this.beforeReconnectHandler !== undefined)
    if (this.hadDemand)
      await this.sanitizePublicPromise(replacement.open())
  }

  /** 将 transport reject 统一裁剪为页面安全 SocketFuseError。 */
  private async sanitizePublicPromise<Value>(promise: Promise<Value>): Promise<Value> {
    try {
      return await promise
    }
    catch (error) {
      const value = error instanceof SocketFuseError
        ? error
        : toSocketFuseError(error, 'INTERNAL_STATE_ERROR', 'WebSocket operation failed')
      throw sanitizeError(value)
    }
  }

  /** 将 transport 后台控制失败送入既有安全错误路径。 */
  private handleTransportError(error: unknown): void {
    this.handleError(error instanceof SocketFuseError
      ? error
      : toSocketFuseError(error, 'INTERNAL_STATE_ERROR', 'Transport control operation failed'))
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
  private dispatchOverflow(bytes: number, strategy: SocketFuseOverflowEvent['strategy']): void {
    const event = new Event('overflow') as SocketFuseOverflowEvent
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
    const overflow = new Event('overflow') as SocketFuseOverflowEvent
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
      throw new SocketFuseError('CLIENT_DISPOSED', 'WebSocket client has been disposed')
  }
}
