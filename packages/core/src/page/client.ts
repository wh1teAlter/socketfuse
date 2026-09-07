/**
 * 稳定页面 client 拥有本地 waiter、业务 handler 和浏览器生命周期。
 * 每次参与使用新端口；消息回放、共享连接和协议处理属于 runtime，页面不维护第二套池或 replay。
 */
import type { BeforeReconnectHandler, ClientVisibility, ConnectionDiagnostics, ConnectionSnapshot, ConnectionState, CreateWebSocketOptions, MessageHandlerContext, MessageHandlerOptions, ReconnectRequestOptions, SendOptions, SendReceipt, SocketFuseMessageEvent, Transport, WebSocketClient, WorkerMode } from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { TransportSelector } from '../transport/shared-worker'
import type { WorkerControlMessage } from '../runtime/control'
import type { ReconnectPlan } from '../connection/controller'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'
import { OperationBudget, type PortTransport } from '../transport/port'
import { SocketFuseError, toSafePublicError } from '../shared/errors'
import { readyStateFor, statusFor } from '../connection/state'
import { beginPreparation } from '../shared/preparation'
import { safeEndpointOrigin } from '../shared/endpoint'
import { observeCallback } from '../shared/callbacks'

/** 页面动态业务回调，不等待其 Promise 才继续派发。 */
type Handler<Incoming> = (event: SocketFuseMessageEvent<Incoming>, context: Readonly<MessageHandlerContext>) => void | Promise<void>

/** 一个待打开调用独立拥有取消监听和预算。 */
interface OpenWaiter {
  /** 当前尝试成功。 */
  readonly resolve: (snapshot: ConnectionSnapshot) => void
  /** 当前尝试失败、取消或离开。 */
  readonly reject: (error: SocketFuseError) => void
  /** 取消监听与额度的幂等清理。 */
  readonly cleanup: () => void
}

/** attach 前的有界发送记录，post 后必须立即释放 data 引用。 */
interface WaitingSend {
  /** 只有尚未 post 时持有的不可变输入快照。 */
  data: unknown
  /** 本次有界排队选择。 */
  readonly options: SendOptions | undefined
  /** 操作预算释放。 */
  readonly release: () => void
  /** 接纳结果。 */
  readonly resolve: (receipt: SendReceipt) => void
  /** 安全错误结果。 */
  readonly reject: (error: SocketFuseError) => void
}

/** 当前参与期记录；退出后从不复活。 */
interface Participation {
  /** 端口与请求的不可复用身份。 */
  readonly id: string
  /** 页面 waiter、发送和端口请求的共享预算。 */
  readonly budget: OperationBudget
  /** 当前页面业务 handler 的参与期取消信号。 */
  readonly abort: AbortController
  /** 只有当前参与期的 open 调用。 */
  readonly waiters: Set<OpenWaiter>
  /** attach 前的唯一有界输入表。 */
  readonly sends: WaitingSend[]
  /** 当前端口，初始化完成才赋值。 */
  port: PortTransport | undefined
  /** 是否已经开始初始化。 */
  started: boolean
  /** 是否已经提交 attach。 */
  attached: boolean
  /** 是否停止本地派发。 */
  closed: boolean
  /** 合并同一连接需求确认，避免并发 open 放大维护请求。 */
  demanding: Promise<void> | undefined
  /** 有界远端 detach 的完成信号，供 close 调用合并。 */
  readonly finished: Promise<void>
  /** 成功结束参与期。 */
  readonly finish: () => void
  /** 本地已结束，但 detach 确认失败。 */
  readonly failFinish: (error: SocketFuseError) => void
}

/** 一次资格授权对应的本地协作取消信号。 */
interface Grant {
  /** 是否已向页面报告本资格可用。 */
  reported: boolean
  /** 该资格属于哪个条目。 */
  readonly epoch: string
  /** 不复用的授权代际。 */
  readonly generation: number
  /** 先 abort 旧资格，再安装新资格。 */
  readonly abort: AbortController
}

/** 创建页面观察事件，不把任意输入展开到事件顶层。 */
function eventWith<T extends Event>(type: string, properties: Record<string, unknown>): T {
  // 只暴露白名单属性的页面观察事件。
  const event = new Event(type)
  for (const [key, value] of Object.entries(properties))
    Object.defineProperty(event, key, { value, enumerable: true })
  return event as T
}

/** 生成不包含业务信息的参与期身份。 */
function participationId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

/** 根据当前页面环境读取活性，SSR import 不访问 document。 */
function pageVisibility(): ClientVisibility {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'hidden' : 'visible'
}

/** EventTarget 的 SSR import 占位，实际创建仍由公开 facade 校验页面 realm。 */
const Target: typeof EventTarget = typeof EventTarget === 'undefined' ? class {} as typeof EventTarget : EventTarget

/** 页面业务代理；一个稳定实例可以拥有先后不同的端口参与期。 */
export class PageWebSocketClient<Incoming, Outgoing> extends Target implements WebSocketClient<Incoming, Outgoing> {
  /** 最后真正派发的业务数据，暂停收到的帧不会更新它。 */
  private currentData: Incoming | null = null
  /** 本地状态不与端口的可回收身份混用。 */
  private currentState: ConnectionState = 'idle'
  /** 稳定、一次性选定的 transport。 */
  private selected: Transport = 'pending'
  /** 当前选定部署方式。 */
  private mode: WorkerMode
  /** 当前或等待旧端口回收后开始的参与期。 */
  private current: Participation | undefined
  /** 至多一个等待远端清理的旧参与期。 */
  private retiring: Participation | undefined
  /** 合并生命周期推进，不按每次调用无限追加 Promise tail。 */
  private driving: Promise<void> | undefined
  /** 永久终态。 */
  private disposed = false
  /** 通道失效后保留恢复意图，显式 close/dispose 才撤销。 */
  private wanted = false
  /** 浏览器生命周期暂停门。 */
  private suspended = false
  /** 明确 freeze 时的活性门。 */
  private frozen = false
  /** 动态 handler 注册项，不按函数引用去重。 */
  private readonly handlers = new Set<{ readonly handler: Handler<Incoming>, readonly key: string | undefined }>()
  /** 本地注册意图，参与期重建时重新提交。 */
  private readonly keys = new Map<string, number>()
  /** 当前参与期最近确认的授权。 */
  private readonly grants = new Map<string, Grant>()
  /** 当前唯一页面准备 hook。 */
  private reconnectHook: BeforeReconnectHandler | undefined
  /** 未结算准备来源 token，不引用 client。 */
  private readonly preparationSource = {}
  /** 当前页面准备授权。 */
  private preparation: { readonly planId: string, cancel?: () => void } | undefined
  /** 当前最新版本快照。 */
  private snapshotValue: ConnectionSnapshot | undefined
  /** 两种 transport 均为最近接收的安全诊断样本。 */
  private diagnostic: ConnectionDiagnostics
  /** 至多一个后台诊断刷新。 */
  private refreshing = false
  /** 最近安全失败，供 open waiter 在 closed 快照时使用。 */
  private lastError: SocketFuseError | undefined
  /** EventTarget 包装保留原监听身份、capture 与取消清理。 */
  private readonly eventListeners = new Map<string, Map<EventListenerOrEventListenerObject, Map<boolean, { listener: EventListener, cleanup: () => void }>>>()
  /** 同一恢复窗口只执行一次 probe 和重建。 */
  private restoring: { readonly participation: Participation, readonly revision: number } | undefined
  /** 暂停与显式退出使旧恢复结果失效，不复用旧窗口的授权。 */
  private lifecycleRevision = 0
  /** 当前参与期已通知 open 的物理尝试。 */
  private notifiedAttempt = 0
  /** 浏览器事件解绑。 */
  private readonly cleanups: (() => void)[] = []

  /** 构造本地代理但不创建端口或保留共享 id。 */
  constructor(readonly config: NormalizedWebSocketConfig, private readonly options: CreateWebSocketOptions<Incoming, Outgoing>, private readonly selectTransport: TransportSelector) {
    super()
    this.mode = config.local.workerMode
    this.diagnostic = { transport: 'pending', logicalState: 'idle', physicalState: 'idle', workerInstanceHash: null,
      connectionEpoch: '', attempt: 0, observedAt: 0, controlProtocolMajor: CONTROL_PROTOCOL_MAJOR,
      idHash: stableHash(config.id), configFingerprint: config.configFingerprint, endpointOrigin: safeEndpointOrigin(config.url),
      retriesUsed: 0, retriesRemaining: config.shared.reconnect.maxRetries, retryReserved: 0, nextRetryDelay: null,
      lastSafeCloseCode: null, attachedClientCount: 0, queueMessages: 0, queueBytes: 0, bufferedAmount: 0, outboundHighWater: false, lastErrorCode: null }
    if (options.onMessage !== undefined)
      this.onMessage(event => options.onMessage?.(this, event))
    this.bindLifecycle()
  }

  /** 注册独立观察者并隔离同步抛错和异步 rejection；遵守原生 once/capture/signal 语义。 */
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (callback === null || (typeof options === 'object' && options.signal?.aborted))
      return
    // 监听身份包含 capture，与原生 EventTarget 的移除规则一致。
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false
    // 按事件类型索引原始监听函数。
    const callbacks = this.eventListeners.get(type) ?? new Map()
    // 同一函数不同 capture 的注册分别管理。
    const captures = callbacks.get(callback) ?? new Map()
    if (captures.has(capture))
      return
    // 本次等待或监听的调用方取消信号。
    const signal = typeof options === 'object' ? options.signal : undefined
    // 单次监听在执行应用回调前先解除。
    const once = typeof options === 'object' && options.once === true
    /** 按原始函数身份清理包装监听。 */
    const remove = (): void => this.removeEventListener(type, callback, capture)
    /** 隔离同步抛出和异步拒绝的原生监听包装。 */
    const listener: EventListener = (event) => {
      if (once)
        remove()
      observeCallback(() => typeof callback === 'function' ? callback.call(this, event) : callback.handleEvent(event), () => {
        if (type !== 'error' && type !== 'diagnostic')
          this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR'))
      })
    }
    captures.set(capture, { listener, cleanup: () => signal?.removeEventListener('abort', remove) })
    callbacks.set(callback, captures)
    this.eventListeners.set(type, callbacks)
    super.addEventListener(type, listener, options)
    signal?.addEventListener('abort', remove, { once: true })
  }

  /** 使用原函数和 capture 删除包装观察者，同时释放 AbortSignal 引用。 */
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    if (callback === null)
      return
    // 监听身份包含 capture，与原生 EventTarget 的移除规则一致。
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false
    // 按事件类型索引原始监听函数。
    const callbacks = this.eventListeners.get(type)
    // 同一函数不同 capture 的注册分别管理。
    const captures = callbacks?.get(callback)
    // 本次独立注册的身份，不能按业务函数去重。
    const registration = captures?.get(capture)
    if (registration === undefined)
      return
    captures?.delete(capture)
    if (captures?.size === 0)
      callbacks?.delete(callback)
    if (callbacks?.size === 0)
      this.eventListeners.delete(type)
    registration.cleanup()
    super.removeEventListener(type, registration.listener, capture)
  }

  /** 返回最后派发的数据。 */
  get data(): Incoming | null {
    return this.currentData
  }

  /** 返回紧凑状态。 */
  get status(): WebSocketClient['status'] {
    return statusFor(this.currentState)
  }

  /** 返回页面参与状态。 */
  get state(): ConnectionState {
    return this.currentState
  }

  /** 返回原生兼容状态。 */
  get readyState(): WebSocketClient['readyState'] {
    return readyStateFor(this.currentState)
  }

  /** 返回已提交的 transport 选择。 */
  get transport(): Transport {
    return this.selected
  }

  /** 返回部署方式。 */
  get workerMode(): WorkerMode {
    return this.mode
  }

  /** 打开当前参与期；取消只移除此 waiter，不撤销已表达的连接需求。 */
  async open(options?: { signal?: AbortSignal }): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (options?.signal?.aborted)
      throw new SocketFuseError('ABORTED')
    this.wanted = true
    // 当前参与意图；不存在时才创建新的端口身份。
    let participation = this.current
    if (participation === undefined) {
      participation = this.newParticipation()
      this.current = participation
      this.snapshotValue = undefined
      this.lastError = undefined
      this.notifiedAttempt = 0
      this.setState('connecting')
      if (this.current !== participation || participation.closed)
        throw new SocketFuseError(this.disposed ? 'CLIENT_DISPOSED' : 'CLIENT_DISCONNECTED')
    }
    if (participation.attached && this.state === 'open' && this.snapshotValue !== undefined)
      return this.snapshotValue
    // 本次操作独占额度的幂等归还函数。
    const release = participation.budget.reserve()
    // 捕获当前参与期，异步返回不能覆盖另一个参与期。
    const current = participation
    // 只属于本次 open 调用的等待结果。
    const promise = new Promise<ConnectionSnapshot>((resolve, reject) => {
      // 本次等待或监听的调用方取消信号。
      const signal = options?.signal
      // 独立控制取消监听的生命周期，不用未初始化 waiter 和回调互相引用。
      const listenerLifetime = new AbortController()
      // 本次 open 独立的结算与取消资源。
      const waiter: OpenWaiter = { resolve, reject, cleanup: () => {
        release()
        listenerLifetime.abort()
      } }
      /** AbortSignal 只结算自己的等待，不关闭共享连接需求。 */
      const onAbort = (): void => {
        current.waiters.delete(waiter)
        waiter.cleanup()
        reject(new SocketFuseError('ABORTED'))
      }
      current.waiters.add(waiter)
      signal?.addEventListener('abort', onAbort, { once: true, signal: listenerLifetime.signal })
      if (signal?.aborted)
        onAbort()
    })
    if (participation.attached && participation.demanding === undefined && (this.state === 'closed' || this.state === 'failed')) {
      participation.demanding = participation.port?.request({ type: 'demand' }, true).then((value) => {
        if (this.current === current && value !== null && 'kind' in value && value.kind === 'attached')
          this.applySnapshot(current, value.snapshot)
      }).catch(error => this.rejectWaiters(current, this.safe(error))).finally(() => {
        current.demanding = undefined
      })
    }
    this.drive()
    return promise
  }

  /** 立即停止本地派发，远端 detach 确认在短期限内完成；实例仍可再次 open。 */
  async close(): Promise<void> {
    this.lifecycleRevision++
    this.wanted = false
    // 捕获当前参与期，异步返回不能覆盖另一个参与期。
    const current = this.current
    if (current === undefined)
      return this.retiring?.finished
    this.current = undefined
    current.closed = true
    if (current.started)
      this.retiring = current
    else
      current.finish()
    this.endLocalParticipation(current)
    if (this.current === undefined)
      this.setState('closed')
    this.drive()
    return current.finished
  }

  /** 有 open 意图才允许发送；attach 前输入有界保留，post 后未知结果不得自动重发。 */
  async sendMessage(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    this.assertUsable()
    // 捕获当前参与期，异步返回不能覆盖另一个参与期。
    const current = this.current
    if (current === undefined || current.closed)
      throw new SocketFuseError('CLIENT_DISCONNECTED')
    if (options !== undefined && (options === null || typeof options !== 'object' || Object.keys(options).some(key => key !== 'queue') || (options.queue !== undefined && typeof options.queue !== 'boolean')))
      throw new SocketFuseError('INVALID_OPTIONS')
    // 端口已协商的控制消息字节上限，握手前使用默认值。
    const limit = current.port?.limits.maxControlEnvelopeBytes ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxControlEnvelopeBytes
    // 在保留或克隆数据前检查整个输入的内存预算。
    const bytes = estimateStructuredCloneBytes({ data, options }, limit)
    if (bytes > limit)
      throw new SocketFuseError('MESSAGE_TOO_LARGE')
    // 本次操作独占额度的幂等归还函数。
    const release = current.budget.reserve(bytes)
    try {
      if (current.attached && current.port !== undefined)
        return current.port.send(data, options, release)
      // 当前公开观察快照，不能据此假设网络已收到消息。
      const snapshot = structuredClone(data)
      return new Promise<SendReceipt>((resolve, reject) => current.sends.push({ data: snapshot, options: options === undefined ? undefined : { ...options }, release, resolve, reject }))
    }
    catch (error) {
      release()
      throw this.safe(error)
    }
  }

  /** 添加一个本地 handler；dispatchKey 只处理该帧已选中的实时资格。 */
  onMessage(handler: Handler<Incoming>, options?: MessageHandlerOptions): () => void {
    this.assertUsable()
    if (typeof handler !== 'function' || (options !== undefined && (options === null || typeof options !== 'object' || Object.keys(options).some(key => key !== 'dispatchKey'))))
      throw new SocketFuseError('INVALID_OPTIONS')
    // 本地 handler 请求的实时分派资格。
    const key = options?.dispatchKey
    if (key !== undefined && (typeof key !== 'string' || key.trim().length === 0 || key.length > 1024))
      throw new SocketFuseError('INVALID_OPTIONS')
    // 本次独立注册的身份，不能按业务函数去重。
    const registration = { handler, key }
    this.handlers.add(registration)
    if (key !== undefined) {
      // 同一 key 的本地注册引用数，最后一次移除才撤销远端候选。
      const count = this.keys.get(key) ?? 0
      this.keys.set(key, count + 1)
      if (count === 0)
        this.control({ type: 'register-key', key })
    }
    return () => {
      if (!this.handlers.delete(registration) || key === undefined)
        return
      // 同一 key 的本地注册引用数，最后一次移除才撤销远端候选。
      const count = (this.keys.get(key) ?? 1) - 1
      if (count > 0) {
        this.keys.set(key, count)
        return
      }
      this.keys.delete(key)
      this.revoke(key)
      this.control({ type: 'unregister-key', key })
    }
  }

  /** 只反映当前参与期经本地 lease 检查的最近资格，不能用作任意副作用执行锁。 */
  isDispatchOwner(key: string): boolean {
    return !this.disposed && !this.frozen && !this.suspended && this.current?.port?.authorityValid() === true
      && this.grants.has(key) && !this.grants.get(key)?.abort.signal.aborted
  }

  /** 注册或替换唯一页面准备 hook；Worker 扩展存在时该页不会被选中。 */
  onBeforeReconnect(handler: BeforeReconnectHandler): () => void {
    this.assertUsable()
    if (typeof handler !== 'function')
      throw new SocketFuseError('INVALID_OPTIONS')
    this.cancelPreparation()
    this.reconnectHook = handler
    this.control({ type: 'set-reconnect-hook', enabled: true })
    return () => {
      if (this.reconnectHook !== handler)
        return
      this.reconnectHook = undefined
      this.cancelPreparation()
      this.control({ type: 'set-reconnect-hook', enabled: false })
    }
  }

  /** 接纳或加入当前观察状态对应的计划，不等待新网络连接 open。 */
  async reconnect(options?: ReconnectRequestOptions): Promise<void> {
    this.assertUsable()
    // 捕获当前参与期，异步返回不能覆盖另一个参与期。
    const current = this.current
    // 当前公开观察快照，不能据此假设网络已收到消息。
    const snapshot = this.snapshotValue
    if (current?.attached !== true || current.port === undefined || snapshot === undefined)
      throw new SocketFuseError('CLIENT_DISCONNECTED')
    if (options !== undefined && (options === null || typeof options !== 'object' || Object.keys(options).some(key => key !== 'countAsRetry') || (options.countAsRetry !== undefined && typeof options.countAsRetry !== 'boolean')))
      throw new SocketFuseError('INVALID_OPTIONS')
    await current.port.request({ type: 'reconnect', countAsRetry: options?.countAsRetry ?? true,
      observed: { connectionEpoch: snapshot.connectionEpoch, attempt: snapshot.attempt, planId: snapshot.planId } })
  }

  /** 返回两种接入一致的最近缓存诊断，observedAt 表示实际收到样本的时刻。 */
  diagnostics(): Readonly<ConnectionDiagnostics> {
    // 捕获当前参与期，异步返回不能覆盖另一个参与期。
    const current = this.current
    if (current?.attached === true && current.port !== undefined && !this.refreshing) {
      this.refreshing = true
      void current.port.request({ type: 'diagnostics' }, true).then((value) => {
        if (this.current === current && value !== null && 'physicalState' in value)
          this.updateDiagnostics(current, value)
      }).catch(() => undefined).finally(() => {
        this.refreshing = false
      })
    }
    return Object.freeze({ ...this.diagnostic, transport: this.selected, logicalState: this.state })
  }

  /** 永久结束本地实例；清理失败可以 reject，但绝不恢复参与。 */
  async dispose(): Promise<void> {
    if (this.disposed)
      return this.retiring?.finished
    this.disposed = true
    for (const cleanup of this.cleanups)
      cleanup()
    this.cleanups.length = 0
    this.handlers.clear()
    this.keys.clear()
    this.reconnectHook = undefined
    try {
      await this.close()
    }
    finally {
      for (const [type, callbacks] of this.eventListeners) {
        for (const [callback, captures] of callbacks) {
          for (const capture of captures.keys())
            this.removeEventListener(type, callback, capture)
        }
      }
    }
  }

  /** 构造不持有端口的下一参与期，只保留一个可合并生命周期意图。 */
  private newParticipation(): Participation {
    // 仅结算本参与期远端退出完成。
    let finish!: () => void
    // 保留远端退出失败，同时允许新参与意图继续。
    let failFinish!: (error: SocketFuseError) => void
    // 退出过程的合并 Promise，不拥有下一参与期。
    const finished = new Promise<void>((resolve, reject) => {
      finish = resolve
      failFinish = reject
    })
    void finished.catch(() => undefined)
    return { id: participationId(), budget: new OperationBudget(), abort: new AbortController(), waiters: new Set(), sends: [],
      port: undefined, started: false, attached: false, closed: false, demanding: undefined, finished, finish, failFinish }
  }

  /** 至多一个初始化/关闭过渡；旧 finally 只能清理它自己的参与期。 */
  private drive(): void {
    if (this.driving !== undefined)
      return
    // 单个生命周期推进过程，避免无限串联 Promise。
    const drive = this.advance()
    this.driving = drive
    void drive.finally(() => {
      if (this.driving === drive)
        this.driving = undefined
      if (this.retiring !== undefined || (this.current !== undefined && !this.current.started))
        this.drive()
    }).catch(error => this.handleError(this.safe(error)))
  }

  /** 串行回收旧参与，再开始最新意图；中途 close 取消尚未启动的 send/waiter。 */
  private async advance(): Promise<void> {
    while (true) {
      // 已停止本地派发、仍等待有界 detach 的旧参与期。
      const retiring = this.retiring
      if (retiring !== undefined) {
        try {
          await retiring.port?.close()
          retiring.finish()
        }
        catch (error) {
          retiring.failFinish(this.safe(error))
        }
        finally {
          retiring.port?.destroy()
          retiring.port = undefined
          if (this.retiring === retiring)
            this.retiring = undefined
        }
        continue
      }
      // 捕获当前参与期，异步返回不能覆盖另一个参与期。
      const current = this.current
      if (current === undefined || current.started || this.disposed)
        return
      current.started = true
      try {
        // 当前参与期新建并完成握手的端口。
        const port = await this.selectTransport({ sessionId: current.id, budget: current.budget,
          onMessage: message => this.receive(current, message),
          onFailure: error => this.channelFailed(current, error),
          onSelected: (kind, mode) => {
            this.selected = kind
            this.mode = mode
          },
        })
        current.port = port
        if (this.current !== current || current.closed) {
          this.retiring = current
          continue
        }
        // attach 发出时的注册意图快照，完成后与最新意图对账。
        const attachingKeys = new Set(this.keys.keys())
        // attach 时是否拥有页面准备 hook。
        const attachingHook = this.reconnectHook !== undefined
        // runtime 接纳当前参与期后的权威状态。
        const attached = await port.attach(this.config, this.frozen ? 'frozen' : pageVisibility(), [...attachingKeys], attachingHook)
        if (this.current !== current || current.closed) {
          this.retiring = current
          continue
        }
        current.attached = true
        // attach 等待期间的注册变化必须在同一有序端口上补齐。
        for (const key of attachingKeys) {
          if (!this.keys.has(key))
            this.control({ type: 'unregister-key', key })
        }
        for (const key of this.keys.keys()) {
          if (!attachingKeys.has(key))
            this.control({ type: 'register-key', key })
        }
        if (attachingHook !== (this.reconnectHook !== undefined))
          this.control({ type: 'set-reconnect-hook', enabled: this.reconnectHook !== undefined })
        this.updateDiagnostics(current, attached.diagnostics)
        if (!this.applySnapshot(current, attached.snapshot))
          continue
        this.notifyOpen(current)
        if (this.suspended)
          port.notify({ type: 'suspend' })
        for (const sending of current.sends.splice(0)) {
          // 本条实际派发或发送的数据引用。
          const data = sending.data
          sending.data = undefined
          void port.send(data, sending.options, sending.release).then(sending.resolve, error => sending.reject(this.safe(error)))
        }
        if (this.state === 'closed' || this.state === 'failed')
          this.rejectWaiters(current, this.lastError ?? new SocketFuseError('CLOSE_NOT_RETRYABLE'))
      }
      catch (error) {
        if (this.current === current) {
          this.current = undefined
          current.closed = true
          this.endLocalParticipation(current, this.safe(error))
          this.setState('closed')
          this.handleError(this.safe(error))
        }
        current.port?.destroy()
        current.port = undefined
        current.finish()
        if (this.retiring === current)
          this.retiring = undefined
      }
    }
  }

  /** 停止本地回调和准备，先清引用再 abort，避免回调重入清掉新参与期。 */
  private endLocalParticipation(current: Participation, reason = new SocketFuseError(this.disposed ? 'CLIENT_DISPOSED' : 'CLIENT_DISCONNECTED')): void {
    this.cancelPreparation()
    this.revokeAll()
    this.rejectWaiters(current, reason)
    for (const sending of current.sends.splice(0)) {
      sending.data = undefined
      sending.release()
      sending.reject(reason)
    }
    current.port?.invalidateAuthority()
    current.abort.abort()
  }

  /** 通道失效后清掉本参与期，不对已 post 发送做自动补发或 direct 降级。 */
  private channelFailed(current: Participation, error: SocketFuseError): void {
    if (this.current !== current || current.closed)
      return
    this.lastError = error
    this.current = undefined
    current.closed = true
    this.endLocalParticipation(current, error)
    current.finish()
    this.setState('closed')
    this.handleError(error)
  }

  /** 拒绝指定参与期的全部等待者，不改变其他参与或连接需求。 */
  private rejectWaiters(current: Participation, error: SocketFuseError): void {
    // 先取得独立结算集合，回调重入不会改写遍历。
    const waiters = [...current.waiters]
    current.waiters.clear()
    for (const waiter of waiters) {
      waiter.cleanup()
      waiter.reject(error)
    }
  }

  /** 采用当前参与期的最新 epoch/版本；旧状态不能覆盖新状态。 */
  private applySnapshot(current: Participation, snapshot: ConnectionSnapshot): boolean {
    if (this.current !== current || current.closed)
      return false
    // 提交新观察值前保留的旧值，用于去重和失效处理。
    const previous = this.snapshotValue
    if (previous !== undefined && (previous.connectionEpoch !== snapshot.connectionEpoch || previous.revision > snapshot.revision))
      return false
    this.snapshotValue = Object.freeze({ ...snapshot, transport: this.selected })
    this.setState(snapshot.state)
    if (this.current !== current || current.closed)
      return false
    if (snapshot.state === 'open') {
      // 先取得独立结算集合，回调重入不会改写遍历。
      const waiters = [...current.waiters]
      current.waiters.clear()
      for (const waiter of waiters) {
        waiter.cleanup()
        waiter.resolve(this.snapshotValue)
      }
    }
    return this.current === current && !current.closed
  }

  /** 每参与期每物理尝试只通知一次 open，后加入的页面也有打开通知。 */
  private notifyOpen(current: Participation): void {
    // 当前公开观察快照，不能据此假设网络已收到消息。
    const snapshot = this.snapshotValue
    if (this.current !== current || current.closed || snapshot?.state !== 'open' || snapshot.attempt <= this.notifiedAttempt)
      return
    this.notifiedAttempt = snapshot.attempt
    this.dispatchEvent(eventWith('open', { snapshot }))
    if (this.current === current && !current.closed)
      observeCallback(() => this.options.onConnected?.(this, snapshot), () => this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR')))
  }

  /** 记录样本接收时间；同步 diagnostics 不假装读取另一个 realm 的即时状态。 */
  private updateDiagnostics(current: Participation, diagnostic: ConnectionDiagnostics): void {
    this.diagnostic = { ...diagnostic, transport: this.selected, logicalState: this.state, observedAt: Date.now(),
      workerInstanceHash: this.selected === 'shared-worker' && current.port !== undefined ? stableHash(current.port.instanceId) : null }
  }

  /** 处理当前端口的有序事件，业务 handler 从不返回给 runtime 执行。 */
  private receive(current: Participation, message: WorkerControlMessage): void {
    if (this.current !== current || current.closed || message.type === 'response')
      return
    switch (message.type) {
      case 'state':
        this.applySnapshot(current, message.snapshot)
        break
      case 'open':
        if (!this.applySnapshot(current, message.snapshot))
          break
        this.notifyOpen(current)
        break
      case 'error':
        this.handleError(new SocketFuseError(message.error.code, { fatal: message.error.fatal, retryable: message.error.retryable }))
        break
      case 'close':
      {
        if (this.snapshotValue !== undefined && (message.connectionEpoch !== this.snapshotValue.connectionEpoch || message.attempt < this.snapshotValue.attempt))
          break
        this.rejectWaiters(current, this.lastError ?? new SocketFuseError('CLOSE_NOT_RETRYABLE', { fatal: message.terminal, retryable: message.willReconnect }))
        // 只暴露白名单属性的页面观察事件。
        const event = eventWith<Parameters<NonNullable<CreateWebSocketOptions<Incoming, Outgoing>['onDisconnected']>>[1]>('close', { code: message.code, wasClean: message.wasClean, terminal: message.terminal, willReconnect: message.willReconnect })
        this.dispatchEvent(event)
        observeCallback(() => this.options.onDisconnected?.(this, event), () => this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR')))
        break
      }
      case 'message':
        this.dispatchMessage(current, message)
        break
      case 'overflow':
        this.dispatchEvent(eventWith('overflow', { direction: message.direction, strategy: message.strategy, droppedMessages: message.droppedMessages, droppedBytes: message.droppedBytes }))
        break
      case 'key-granted':
        this.grant(message.key, message.connectionEpoch, message.generation)
        break
      case 'key-revoked':
        this.revoke(message.key)
        break
      case 'lease-confirmed':
      {
        // 权威 probe 返回的完整资格集合。
        const granted = new Set(message.grants.map(stamp => stamp.key))
        for (const key of [...this.grants.keys()]) {
          if (!granted.has(key))
            this.revoke(key)
        }
        for (const stamp of message.grants)
          this.grant(stamp.key, message.connectionEpoch, stamp.generation)
        break
      }
      case 'before-reconnect':
        this.prepare(current, message.plan)
        break
      case 'abort-reconnect':
        if (this.preparation?.planId === message.planId) this.cancelPreparation()
        break
    }
  }

  /** 验证每帧资格，再更新 data；暂停和 replay 绝不补跑 keyed handler。 */
  private dispatchMessage(current: Participation, message: Extract<WorkerControlMessage, { type: 'message' }>): void {
    if (this.suspended || message.connectionEpoch !== this.snapshotValue?.connectionEpoch)
      return
    // 本条实际派发或发送的数据引用。
    const data = this.config.shared.protocol.kind === 'raw' && this.config.local.binaryType === 'blob' && message.data instanceof ArrayBuffer
      ? new Blob([message.data]) as Incoming
      : message.data as Incoming
    this.currentData = data
    // 只暴露白名单属性的页面观察事件。
    const event = eventWith<SocketFuseMessageEvent<Incoming>>('message', { data, receivedAt: message.receivedAt, replayed: message.replayed, transport: this.selected })
    for (const registration of [...this.handlers]) {
      if (this.current !== current || current.closed)
        break
      if (!this.handlers.has(registration))
        continue
      // 本次等待或监听的调用方取消信号。
      let signal = current.abort.signal
      if (registration.key !== undefined) {
        // 本地 handler 请求的实时分派资格。
        const key = registration.key
        // 当前 key 对应的 epoch、代际与协作取消信号。
        const grant = this.grants.get(key)
        if (message.replayed || grant === undefined || !this.isDispatchOwner(key)
          || grant.epoch !== message.connectionEpoch || !message.dispatch.some(stamp => stamp.key === key && stamp.generation === grant.generation))
          continue
        signal = grant.abort.signal
      }
      observeCallback(() => registration.handler(event, Object.freeze({ signal })), () => this.handleError(new SocketFuseError('INTERNAL_STATE_ERROR')))
    }
    if (this.current === current && !current.closed)
      this.dispatchEvent(event)
  }

  /** 更新本参与期资格，先停止旧信号；相同资格的 lease 确认不会创建新 signal。 */
  private grant(key: string, epoch: string, generation: number): void {
    if (!this.keys.has(key) || this.frozen || this.snapshotValue?.connectionEpoch !== epoch)
      return
    // 提交新观察值前保留的旧值，用于去重和失效处理。
    const previous = this.grants.get(key)
    if (previous?.epoch === epoch && previous.generation === generation) {
      if (!previous.reported && this.isDispatchOwner(key)) {
        previous.reported = true
        this.dispatchEvent(eventWith('dispatchownerchange', { key, held: true }))
      }
      return
    }
    this.revoke(key)
    // 当前 key 对应的 epoch、代际与协作取消信号。
    const grant = { epoch, generation, abort: new AbortController(), reported: false }
    this.grants.set(key, grant)
    grant.reported = this.isDispatchOwner(key)
    if (grant.reported)
      this.dispatchEvent(eventWith('dispatchownerchange', { key, held: true }))
  }

  /** 先移除旧授权，再通知和 abort，避免同步重入误删新资格。 */
  private revoke(key: string): void {
    // 提交新观察值前保留的旧值，用于去重和失效处理。
    const previous = this.grants.get(key)
    if (previous === undefined)
      return
    this.grants.delete(key)
    previous.abort.abort()
    this.dispatchEvent(eventWith('dispatchownerchange', { key, held: false }))
  }

  /** 生命周期屏障一次撤销当前所有资格。 */
  private revokeAll(): void {
    for (const key of [...this.grants.keys()]) this.revoke(key)
  }

  /** 执行当前授权的有界页面准备，不把业务函数交给 Worker。 */
  private prepare(current: Participation, plan: ReconnectPlan): void {
    if (this.reconnectHook === undefined || this.frozen || current.port === undefined) {
      this.control({ type: 'reject-reconnect-plan', planId: plan.id })
      return
    }
    this.cancelPreparation()
    // 仅属于当前授权计划的准备记录。
    const preparation: NonNullable<PageWebSocketClient<Incoming, Outgoing>['preparation']> = { planId: plan.id }
    this.preparation = preparation
    try {
      // 事务发布取消能力后才执行用户准备 hook。
      const cancel = beginPreparation(this.preparationSource, plan, this.reconnectHook, {
        onFailure: error => this.handleError(error),
        onStart: (cancel) => {
          preparation.cancel = cancel
        },
        isCurrent: () => this.preparation === preparation && this.current === current && !current.closed,
        onComplete: (override) => {
          if (this.preparation !== preparation || this.current !== current || current.closed)
            return
          this.preparation = undefined
          this.control(override === undefined ? { type: 'reject-reconnect-plan', planId: plan.id } : { type: 'complete-reconnect-plan', planId: plan.id, ...override })
        },
      })
      if (this.preparation === preparation)
        preparation.cancel = cancel
      else
        cancel()
    }
    catch {
      if (this.preparation === preparation)
        this.preparation = undefined
      this.control({ type: 'reject-reconnect-plan', planId: plan.id })
      this.handleError(new SocketFuseError('PREPARATION_BUSY'))
    }
  }

  /** 先解除当前准备，再 abort 其信号。 */
  private cancelPreparation(): void {
    // 仅属于当前授权计划的准备记录。
    const preparation = this.preparation
    this.preparation = undefined
    if (preparation !== undefined)
      this.control({ type: 'reject-reconnect-plan', planId: preparation.planId })
    preparation?.cancel?.()
  }

  /** 为动态注册意图发送短控制请求，未参与时只保留本地意图。 */
  private control(message: Parameters<PortTransport['request']>[0]): void {
    // 捕获当前参与期，异步返回不能覆盖另一个参与期。
    const current = this.current
    if (current?.attached !== true || current.port === undefined)
      return
    void current.port.request(message).catch((error) => {
      if (this.current === current && !current.closed)
        this.handleError(this.safe(error))
    })
  }

  /** 所有公开 Promise 方法把阶段失败转换为 rejection；同步注册 API 仍可抛出。 */
  private assertUsable(): void {
    if (this.disposed) throw new SocketFuseError('CLIENT_DISPOSED')
  }

  /** 未知内部控制错误只映射稳定码，不携带异常文本。 */
  private safe(error: unknown): SocketFuseError {
    return error instanceof SocketFuseError ? toSafePublicError(error) : new SocketFuseError('INTERNAL_STATE_ERROR')
  }

  /** 记录安全错误；logger/onError 自身失败不递归报告，拒绝 Promise 也被消费。 */
  private handleError(error: SocketFuseError): void {
    // 只记录并通知脱敏后的稳定错误。
    const safe = toSafePublicError(error)
    this.lastError = safe
    this.dispatchEvent(eventWith('error', { error: safe }))
    // 日志只接收固定字段，不携带异常文本或业务值。
    const diagnostic = Object.freeze({ code: safe.code, timestamp: Date.now(), type: 'error' })
    this.dispatchEvent(eventWith('diagnostic', { diagnostic }))
    observeCallback(() => this.options.logger?.(diagnostic))
    observeCallback(() => this.options.onError?.(this, safe))
  }

  /** 当前状态先提交，再发布页面通知。 */
  private setState(state: ConnectionState): void {
    // 提交新观察值前保留的旧值，用于去重和失效处理。
    const previous = this.currentState
    this.currentState = state
    if (previous !== state)
      this.dispatchEvent(eventWith('statechange', { previous, state, transport: this.selected, attempt: this.snapshotValue?.attempt ?? 0 }))
  }

  /** 把页面 freeze/restore 汇入同一参与期恢复路径，不保留页面 replay。 */
  private bindLifecycle(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined')
      return
    /** 注册属于稳定 client 的浏览器监听并记录清理。 */
    const listen = (target: EventTarget, type: string, callback: (event: Event) => void): void => {
      target.addEventListener(type, callback)
      this.cleanups.push(() => target.removeEventListener(type, callback))
    }
    /** 页面暂停先建立本地门，Worker 是否收到 suspend 不影响此处安全。 */
    const suspend = (): void => {
      this.lifecycleRevision++
      this.suspended = true
      this.revokeAll()
      this.current?.port?.notify({ type: 'suspend' })
    }
    /** 恢复时先确认 authority，失联则重建同一选定 transport 的新参与期。 */
    const restore = (): void => {
      this.frozen = false
      // 捕获当前参与期，异步返回不能覆盖另一个参与期。
      const current = this.current
      // 本恢复窗口的生命周期代际，后续暂停使它失效。
      const revision = this.lifecycleRevision
      if (current?.port === undefined) {
        this.suspended = false
        if (this.wanted && !this.disposed)
          void this.open().catch(error => this.handleError(this.safe(error)))
        return
      }
      if (this.restoring?.participation === current && this.restoring.revision === revision)
        return
      // 合并同一参与期同一恢复窗口的 probe。
      const restoring = { participation: current, revision }
      this.restoring = restoring
      current.port.invalidateAuthority()
      this.revokeAll()
      current.port.notify({ type: 'visibility', visibility: pageVisibility() })
      void current.port.probe().then(() => {
        if (this.current === current && !current.closed && this.wanted && this.lifecycleRevision === revision && !this.frozen) {
          this.suspended = false
          current.port?.notify({ type: 'restore' })
        }
      }).catch(async (error) => {
        if (this.safe(error).code === 'ABORTED' || this.lifecycleRevision !== revision || !this.wanted || this.disposed || (this.current !== undefined && this.current !== current))
          return
        // 先完成旧参与期清理，再尝试重新参与。
        const closing = this.close().catch(() => undefined)
        // 内部 close 后的代际；显式退出或再次暂停会取消重建。
        const reopeningRevision = this.lifecycleRevision
        this.wanted = true
        await closing
        if (this.lifecycleRevision !== reopeningRevision || !this.wanted || this.disposed || this.current !== undefined)
          return
        this.suspended = false
        await this.open().catch(error => this.handleError(this.safe(error)))
      }).finally(() => {
        if (this.restoring === restoring)
          this.restoring = undefined
      })
    }
    listen(document, 'visibilitychange', () => {
      this.current?.port?.notify({ type: 'visibility', visibility: pageVisibility() })
      if (pageVisibility() === 'visible')
        restore()
      else if (this.config.local.lifecycle.enabled)
        suspend()
    })
    listen(document, 'freeze', () => {
      this.lifecycleRevision++
      this.frozen = true
      this.revokeAll()
      this.cancelPreparation()
      this.current?.port?.invalidateAuthority()
      this.current?.port?.notify({ type: 'visibility', visibility: 'frozen' })
      if (this.config.local.lifecycle.enabled)
        suspend()
    })
    listen(document, 'resume', restore)
    listen(window, 'pageshow', (event) => {
      if ((event as PageTransitionEvent).persisted) restore()
    })
    listen(window, 'pagehide', (event) => {
      if ((event as PageTransitionEvent).persisted) {
        if (!this.config.local.lifecycle.enabled && this.config.local.autoClose) {
          void this.close().catch(() => undefined)
          return
        }
        this.lifecycleRevision++
        this.frozen = true
        this.revokeAll()
        this.cancelPreparation()
        this.current?.port?.invalidateAuthority()
        this.current?.port?.notify({ type: 'visibility', visibility: 'frozen' })
        if (this.config.local.lifecycle.enabled)
          suspend()
      }
      else if (this.config.local.autoClose)
        void this.close().catch(() => undefined)
    })
  }
}
