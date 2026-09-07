/**
 * 统一运行时拥有端口参与期、共享连接池、连接协议扩展与资源回收。
 * 同一实现可位于 SharedWorker 或页面 MessageChannel 后方，绝不等待页面业务回调。
 */
import type { ProtocolAdapter, ProtocolFrame, TimerHandle, WorkerResourceLimits } from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { WebSocketFactory } from '../connection/socket'
import { bindWorkerProtocol, type ConnectionExtension, type ConnectionExtensionContext, type ConnectionExtensionFactory, type FrameResult, isWorkerProtocolRegistration, type WorkerProtocolRegistration } from './protocol'
import { type Attached, type AttachRequest, type ClientControlMessage, exactKeys, isClientControlMessage, isResourceLimits, listenPort, type MessagePortLike, type WorkerControlMessage } from './control'
import { createJsonProtocolAdapter, rawProtocol, validateProtocolAdapter } from '../protocol/adapter'
import { estimateStructuredCloneBytes, stableHash, stableSerialize } from '../shared/structured'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { ConnectionController, type ReconnectPlan } from '../connection/controller'
import { normalizeEndpointUrl, safeEndpointOrigin } from '../shared/endpoint'
import { isSocketFuseErrorCode, SocketFuseError } from '../shared/errors'
import { invokeSynchronous, observeCallback } from '../shared/callbacks'
import { ReconnectCoordinator } from './reconnect-coordinator'
import { DispatchOwnerRegistry } from './dispatch-owners'
import { beginPreparation } from '../shared/preparation'
import { ParticipantDelivery } from './delivery'

/** runtime 的静态部署能力；页面不能通过控制消息修改。 */
export interface ConnectionRuntimeOptions {
  /** 配对的自定义协议与扩展注册；相同 id/version 重复立即拒绝。 */
  readonly protocols?: readonly WorkerProtocolRegistration[]
  /** raw/JSON 连接的通用扩展工厂；自定义协议在自己的注册项提供工厂。 */
  readonly createExtension?: ConnectionExtensionFactory
  /** 可注入原生 socket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 当前时间源。 */
  readonly now?: () => number
  /** 抖动随机源。 */
  readonly random?: () => number
  /** 可控 timer 工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 对应清理函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** 静态资源限制；welcome 告知页面实际值。 */
  readonly workerLimits?: Partial<WorkerResourceLimits>
}

/** 所有接入位置共用的运行时最小接口。 */
export interface ConnectionRuntime {
  /** 当前实例身份，不是授权能力。 */
  readonly instanceId: string
  /** 接收一个新原生端口，先握手再附着。 */
  readonly connect: (port: MessagePortLike) => void
  /** 释放所有参与者并关闭物理连接。 */
  readonly dispose: () => void
}

/** 一个原生端口永远只拥有一次参与期。 */
interface Session {
  /** 端口能力。 */
  readonly port: MessagePortLike
  /** 当前握手/参与阶段。 */
  phase: 'new' | 'welcomed' | 'attached' | 'closed'
  /** 附着后固定的参与期身份。 */
  id: string
  /** 完整 attach 输入，在成功提交后不保留 URL 或 payload。 */
  entry: Entry | undefined
  /** 原生监听清理。 */
  cleanup: () => void
  /** 未附着或 lease 的唯一到期 timer。 */
  timer: TimerHandle | undefined
  /** 当前 lease 的绝对截止时刻。 */
  expiresAt: number
  /** 最近已确认的 lease 序号。 */
  leaseSequence: number
  /** 当前活性记录。 */
  visibility: 'visible' | 'hidden' | 'frozen'
  /** 本参与期唯一 delivery/replay 状态。 */
  delivery: ParticipantDelivery | undefined
}

/** 一条共享连接的全部上层所有权。 */
interface Entry {
  /** 已比较的共享 canonical。 */
  readonly canonical: string
  /** 无生命周期的规范化配置。 */
  readonly config: NormalizedWebSocketConfig
  /** 该条目唯一的物理控制器。 */
  readonly controller: ConnectionController<unknown, unknown>
  /** 当前参与期集合。 */
  readonly sessions: Map<string, Session>
  /** 本连接分派接收者。 */
  readonly dispatch: DispatchOwnerRegistry
  /** 本连接页面准备候选。 */
  readonly coordinator: ReconnectCoordinator
  /** 每条连接独享的应用扩展。 */
  readonly extension: ConnectionExtension | undefined
  /** 不引用连接对象的未结算来源 token。 */
  readonly preparationSource: object
  /** 当前准备事务，计划提交前或取消时必须解除。 */
  preparation: { readonly planId: string, cancel?: () => void } | undefined
  /** 最后参与者离开后的宽限 timer。 */
  idleTimer: TimerHandle | undefined
  /** 已进入原生关闭后的最终回收阶段。 */
  reclaiming: boolean
  /** 防止扩展重复 dispose。 */
  disposed: boolean
}

/** 产生不携带业务信息的实例与 epoch 身份。 */
function runtimeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'runtime-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

/** 仅将稳定错误字段发送给页面。 */
function controlError(error: SocketFuseError): { code: SocketFuseError['code'], fatal: boolean, retryable: boolean } {
  return { code: error.code, fatal: error.fatal, retryable: error.retryable }
}

/** 校验扩展 hook 类型；应用状态可以保留在闭包或自己的实例中。 */
function validateExtension(value: ConnectionExtension | undefined): void {
  if (value === undefined)
    return
  if (value === null || typeof value !== 'object' || 'filterInbound' in value)
    throw new SocketFuseError('INVALID_OPTIONS')
  for (const key of ['onSocketOpen', 'onSocketClose', 'onFrame', 'createPing', 'createPong', 'prepareAttempt', 'dispose'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'function')
      throw new SocketFuseError('INVALID_OPTIONS')
  }
}

/** 仅用于提取畸形控制记录的有界请求身份，不展开任意 payload。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 完整结果校验在任何 Ack、投影或重连效果之前。 */
function isFrameDelivery(value: unknown): value is FrameResult<unknown, unknown>['delivery'] {
  return (exactKeys(value, ['type']) && value.type === 'consume')
    || (exactKeys(value, ['type', 'data']) && value.type === 'broadcast')
}

/** 创建尚无端口与 socket 的运行时；同一 id 始终由同一条目持有，直到原生关闭确认。 */
export function createConnectionRuntime(options: ConnectionRuntimeOptions = {}): ConnectionRuntime {
  // runtime 级资源上限，与单条连接的共享配置分离。
  const limits = Object.freeze({ ...DEFAULT_WORKER_RESOURCE_LIMITS, ...options.workerLimits })
  if (!isResourceLimits(limits))
    throw new SocketFuseError('INVALID_OPTIONS')
  // 静态协议注册表，不从页面接收可执行代码。
  const registrations = new Map<string, WorkerProtocolRegistration>()
  for (const registration of options.protocols ?? []) {
    if (!isWorkerProtocolRegistration(registration))
      throw new SocketFuseError('INVALID_OPTIONS')
    // 协议 id 与版本组成的注册查找键。
    const key = registration.descriptor.id + ':' + registration.descriptor.version
    if (registrations.has(key))
      throw new SocketFuseError('INVALID_OPTIONS')
    registrations.set(key, registration)
  }
  // 包括尚未 attach 的有界端口集合。
  const ports = new Set<Session>()
  // 本 runtime 唯一的物理连接所有权表。
  const connections = new Map<string, Entry>()
  // 租约与准备截止时间共用的毫秒时钟。
  const now = options.now ?? Date.now
  // 本 runtime 拥有的可注入 timer 工厂。
  const setTimer = options.setTimeout ?? ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay))
  // 只清理本 runtime 创建的 timer。
  const clearTimer = options.clearTimeout ?? ((handle: TimerHandle) => globalThis.clearTimeout(handle))
  // 区分 Worker 重启的非秘密实例身份。
  const instanceId = runtimeId()
  // 终结后禁止创建端口和连接条目。
  let disposed = false

  /** 清空当前端口的期限 timer。 */
  const clearSessionTimer = (session: Session): void => {
    // 解除引用后才清理旧参与期 timer。
    const timer = session.timer
    session.timer = undefined
    if (timer !== undefined)
      clearTimer(timer)
  }

  /** 在参与者为空且 socket 已结束时完成条目回收。 */
  const reclaim = (entry: Entry): void => {
    if (!entry.reclaiming || entry.sessions.size !== 0 || !entry.controller.stopped || entry.disposed)
      return
    entry.disposed = true
    if (connections.get(entry.config.id) === entry)
      connections.delete(entry.config.id)
    entry.coordinator.dispose()
    // 先移除准备权威，再执行可能重入的 abort。
    const preparation = entry.preparation
    entry.preparation = undefined
    preparation?.cancel?.()
    entry.controller.dispose()
    observeCallback(() => entry.extension?.dispose?.())
  }

  /** 在无需求之后启动唯一 idle 宽限，不因协议回复延长条目寿命。 */
  const scheduleIdle = (entry: Entry): void => {
    if (entry.idleTimer !== undefined || entry.disposed || entry.sessions.size > 0)
      return
    entry.idleTimer = setTimer(() => {
      entry.idleTimer = undefined
      if (entry.sessions.size !== 0 || entry.disposed)
        return
      entry.reclaiming = true
      entry.controller.close()
      reclaim(entry)
    }, entry.config.shared.idleGraceMs)
  }

  /** 所有端口退出共用的幂等路径；先移除候选权威，再释放所有保留数据。 */
  function dropSession(session: Session, responseId?: string): void {
    if (session.phase === 'closed')
      return
    session.phase = 'closed'
    clearSessionTimer(session)
    // 当前参与期所属的唯一连接条目。
    const entry = session.entry
    session.entry = undefined
    if (entry !== undefined) {
      entry.sessions.delete(session.id)
      // 最后需求先撤销，候选离开触发默认准备时已无权启动 socket。
      if (entry.sessions.size === 0)
        entry.controller.setDemand(false)
      entry.dispatch.removeClient(session.id)
      entry.coordinator.unregister(session.id)
      session.delivery?.dispose()
      session.delivery = undefined
      entry.controller.removeOwner(session.id)
      if (entry.sessions.size === 0) {
        scheduleIdle(entry)
      }
    }
    ports.delete(session)
    session.cleanup()
    try {
      if (responseId !== undefined)
        session.port.postMessage({ type: 'response', requestId: responseId, ok: true, value: null } satisfies WorkerControlMessage)
    }
    catch { /* 远端无法收到确认时由其短控制期限结算。 */ }
    session.port.close?.()
  }

  /** 向原生端口发送；失败回收由同一个幂等离开路径处理。 */
  const post = (session: Session, message: WorkerControlMessage): boolean => {
    if (session.phase === 'closed')
      return false
    try {
      session.port.postMessage(message)
      return true
    }
    catch {
      dropSession(session)
      return false
    }
  }

  /** 只向仍然存活的参与者发布当前条目事件。 */
  const eachSession = (entry: Entry, send: (session: Session) => void): void => {
    for (const session of [...entry.sessions.values()]) {
      if (session.phase !== 'attached')
        continue
      if (now() >= session.expiresAt) {
        dropSession(session)
        continue
      }
      send(session)
    }
  }

  /** 安全错误广播不携带应用 throw 值。 */
  const report = (entry: Entry, error: SocketFuseError): void => {
    eachSession(entry, session => post(session, { type: 'error', sessionId: session.id, error: controlError(error) }))
  }

  /** 从 controller 当前状态构造扩展上下文，不能捕获初始 endpoint origin。 */
  const context = (entry: Entry, attempt = entry.controller.snapshot().attempt): ConnectionExtensionContext => Object.freeze({
    connectionId: entry.config.id, connectionEpoch: entry.controller.options.connectionEpoch,
    endpointOrigin: safeEndpointOrigin(entry.controller.endpointUrl), attempt,
  })

  /** 条目生命周期 hook 同步隔离，thenable 属于协议契约违例。 */
  const lifecycle = (entry: Entry, hook: ConnectionExtension['onSocketOpen'], attempt: number): void => {
    if (hook === undefined)
      return
    try {
      invokeSynchronous(() => hook(context(entry, attempt)), 'PROTOCOL_ERROR')
    }
    catch (error) {
      entry.controller.protocolFailure(error)
    }
  }

  /** 结束当前准备引用在前，abort 用户信号在后。 */
  const cancelPreparation = (entry: Entry, planId: string): void => {
    // 先移除准备权威，再执行可能重入的 abort。
    const preparation = entry.preparation
    if (preparation?.planId === planId) {
      entry.preparation = undefined
      preparation.cancel?.()
    }
    entry.coordinator.cancel(planId)
  }

  /** Worker 工厂存在准备 hook 时独占该计划，不因忙或异常转交页面。 */
  const prepare = (entry: Entry, plan: ReconnectPlan): boolean => {
    // 当前连接独占的 Worker 准备或帧处理能力。
    const hook = entry.extension?.prepareAttempt
    if (hook === undefined)
      return entry.coordinator.start(plan)
    // 先移除准备权威，再执行可能重入的 abort。
    const preparation: NonNullable<Entry['preparation']> = { planId: plan.id }
    entry.preparation = preparation
    try {
      // 同步 hook 执行前发布的取消句柄。
      const cancel = beginPreparation(entry.preparationSource, plan, hook, {
        now, setTimeout: setTimer, clearTimeout: clearTimer,
        isCurrent: () => entry.preparation === preparation && !entry.disposed,
        onFailure: error => report(entry, error),
        onStart: (cancel) => {
          preparation.cancel = cancel
        },
        onComplete: (override) => {
          if (entry.preparation !== preparation || entry.disposed)
            return
          entry.preparation = undefined
          try {
            if (override === undefined)
              entry.controller.useDefaultPlan(plan.id)
            else
              entry.controller.commitReconnectPlan(plan.id, override)
          }
          catch {
            // 当前计划已取消或到期，不向新尝试报告旧调用结果。
          }
        },
      })
      if (entry.preparation === preparation)
        preparation.cancel = cancel
      else
        cancel()
    }
    catch {
      if (entry.preparation === preparation) {
        entry.preparation = undefined
        report(entry, new SocketFuseError('PREPARATION_BUSY'))
        entry.controller.useDefaultPlan(plan.id)
      }
    }
    return true
  }

  /** 每个 data/control 物理帧只处理一次，先校验并快照整个结果再执行效果。 */
  const frame = (entry: Entry, incoming: ProtocolFrame<unknown>, receivedAt: number, attempt: number): void => {
    if (incoming.type !== 'data' && incoming.type !== 'control')
      return
    // 经严格校验后才允许提交的协议动作或控制响应。
    let result: FrameResult<unknown, unknown>
    // 库拥有的独立业务投影快照，后续协议效果不能修改它。
    let projected: unknown
    try {
      // 当前连接独占的 Worker 准备或帧处理能力。
      const hook = entry.extension?.onFrame
      result = hook === undefined
        ? { delivery: incoming.type === 'control' ? { type: 'consume' } : { type: 'broadcast', data: incoming.data } }
        : invokeSynchronous(() => hook(incoming, context(entry, attempt)), 'PROTOCOL_ERROR')
      if (!exactKeys(result, ['delivery'], ['reply', 'reconnect']) || !isFrameDelivery(result.delivery)
        || (result.reconnect !== undefined && (!exactKeys(result.reconnect, [], ['countAsRetry']) || (result.reconnect.countAsRetry !== undefined && typeof result.reconnect.countAsRetry !== 'boolean'))))
        throw new SocketFuseError('PROTOCOL_ERROR')
      // 固定决策字段，后续 encode hook 不能通过修改返回对象改变事务。
      result = { delivery: { ...result.delivery }, ...(Object.hasOwn(result, 'reply') ? { reply: result.reply } : {}), ...(result.reconnect === undefined ? {} : { reconnect: { ...result.reconnect } }) }
      if (result.delivery.type === 'broadcast') {
        if (estimateStructuredCloneBytes(result.delivery.data, limits.maxDeliveryBytes) > limits.maxDeliveryBytes)
          throw new SocketFuseError('MESSAGE_TOO_LARGE')
        // 所有页面使用同一库拥有快照；扩展复用对象或修改 buffer 不会改变旧 replay。
        projected = structuredClone(result.delivery.data)
        if (estimateStructuredCloneBytes(projected, limits.maxDeliveryBytes) > limits.maxDeliveryBytes)
          throw new SocketFuseError('MESSAGE_TOO_LARGE')
      }
    }
    catch (error) {
      if (entry.controller.isCurrentAttempt(attempt))
        entry.controller.protocolFailure(error)
      return
    }
    if (!entry.controller.isCurrentAttempt(attempt))
      return
    if (Object.hasOwn(result, 'reply')) {
      try {
        entry.controller.sendControl(attempt, result.reply)
      }
      catch (error) {
        if (entry.controller.isCurrentAttempt(attempt))
          entry.controller.protocolFailure(error)
      }
    }
    if (!entry.controller.isCurrentAttempt(attempt))
      return
    if (result.delivery.type === 'broadcast') {
      // 单页 credit/replay 不足只影响该页，不能撤销 Ack 或阻止其他协议效果。
      eachSession(entry, session => session.delivery?.deliver(projected, receivedAt, entry.dispatch.grantsForClient(session.id)))
    }
    if (result.reconnect !== undefined && entry.controller.isCurrentAttempt(attempt)) {
      try {
        entry.controller.requestReconnect('worker', result.reconnect.countAsRetry ?? true, { connectionEpoch: entry.controller.options.connectionEpoch, attempt, planId: null })
      }
      catch (error) {
        report(entry, error instanceof SocketFuseError ? error : new SocketFuseError('PROTOCOL_ERROR'))
      }
    }
  }

  /** 安装附着或 lease 的唯一绝对期限；旧 timer 无法回收新续期。 */
  const armSession = (session: Session, duration: number): void => {
    clearSessionTimer(session)
    session.expiresAt = now() + duration
    // 本次续租确定的绝对失效时刻。
    const deadline = session.expiresAt
    session.timer = setTimer(() => {
      if (session.phase !== 'closed' && session.expiresAt === deadline) {
        session.timer = undefined
        dropSession(session)
      }
    }, duration)
  }

  /** 构造未启动条目；所有扩展/协议验证成功后才允许 attach 提交需求。 */
  const createEntry = (request: AttachRequest, url: string): Entry => {
    // 新连接条目的不可复用身份。
    const epoch = runtimeId()
    // 工厂只接收安全连接元数据，不接收完整 endpoint。
    const initialContext = Object.freeze({ connectionId: request.id, connectionEpoch: epoch, endpointOrigin: safeEndpointOrigin(url), attempt: 0 })
    // 与当前注册扩展成对的协议转换实现。
    let adapter: ProtocolAdapter<unknown, unknown>
    // 每条连接独立的应用协议状态。
    let extension: ConnectionExtension | undefined
    if (request.shared.protocol.kind === 'custom') {
      // 与页面静态协议描述精确匹配的 Worker 注册项。
      const registration = registrations.get(request.shared.protocol.id + ':' + request.shared.protocol.version)
      if (registration === undefined || stableSerialize(registration.descriptor) !== stableSerialize(request.shared.protocol))
        throw new SocketFuseError('ADAPTER_NOT_REGISTERED')
      // 同一注册项绑定出的 adapter 与扩展，禁止交叉重配。
      const bound = bindWorkerProtocol(registration, initialContext)
      adapter = bound.adapter
      extension = bound.extension
    }
    else {
      adapter = request.shared.protocol.kind === 'raw'
        ? rawProtocol as ProtocolAdapter<unknown, unknown>
        : createJsonProtocolAdapter(request.shared.protocol.sharedConfig as never) as ProtocolAdapter<unknown, unknown>
      extension = options.createExtension === undefined ? undefined : invokeSynchronous(() => options.createExtension?.(initialContext), 'PROTOCOL_ERROR')
    }
    try {
      validateProtocolAdapter(adapter)
      validateExtension(extension)
      if (disposed)
        throw new SocketFuseError('CLIENT_DISPOSED')
    }
    catch (error) {
      observeCallback(() => extension?.dispose?.())
      throw error
    }
    // 只把规范化共享策略交给物理引擎。
    const config: NormalizedWebSocketConfig = Object.freeze({ id: request.id, url, shared: request.shared,
      configCanonical: request.configCanonical, configFingerprint: stableHash(request.shared),
      local: { binaryType: 'arraybuffer', autoClose: true, fallback: 'error', immediate: false, lifecycle: request.restore, logger: undefined, workerMode: 'custom' } as const })
    // 该连接当前已提交的参与者集合。
    const sessions = new Map<string, Session>()
    // controller 的 observer 在 entry 提交需求后才会运行。
    let entry = undefined as unknown as Entry
    // 唯一物理引擎，创建时尚不提交连接需求。
    const controller = new ConnectionController({ config, adapter, connectionEpoch: epoch, now,
      setTimeout: setTimer, clearTimeout: clearTimer, ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
      ...(options.random === undefined ? {} : { random: options.random }),
      observer: {
        onState: (snapshot, reasonCode) => eachSession(entry, session => post(session, { type: 'state', sessionId: session.id, snapshot, ...(isSocketFuseErrorCode(reasonCode) ? { reasonCode } : {}) })),
        onInitializeOpen: attempt => lifecycle(entry, extension?.onSocketOpen, attempt),
        onOpen: (snapshot) => {
          if (controller.isCurrentAttempt(snapshot.attempt))
            eachSession(entry, session => post(session, { type: 'open', sessionId: session.id, snapshot }))
        },
        onFrame: (incoming, receivedAt, attempt) => frame(entry, incoming, receivedAt, attempt),
        onClose: (close, attempt) => {
          lifecycle(entry, extension?.onSocketClose, attempt)
          eachSession(entry, session => post(session, { type: 'close', sessionId: session.id, connectionEpoch: epoch, attempt, ...close }))
        },
        onError: error => report(entry, error),
        onPrepare: plan => prepare(entry, plan),
        onPreparationEnd: planId => cancelPreparation(entry, planId),
        onStopped: () => reclaim(entry),
      },
    })
    // 每个实时帧的单接收者资格选择器。
    const dispatch = new DispatchOwnerRegistry({
      onGrant: (sessionId, key, generation) => {
        // 本次控制或资格通知涉及的端口参与期。
        const session = sessions.get(sessionId)
        if (session !== undefined)
          post(session, { type: 'key-granted', sessionId, connectionEpoch: epoch, key, generation })
      },
      onRevoke: (sessionId, key) => {
        // 本次控制或资格通知涉及的端口参与期。
        const session = sessions.get(sessionId)
        if (session !== undefined && session.phase !== 'closed')
          post(session, { type: 'key-revoked', sessionId, key })
      },
    })
    // 本连接唯一的页面准备授权协调者。
    const coordinator = new ReconnectCoordinator({ now, setTimeout: setTimer, clearTimeout: clearTimer,
      onAssign: (sessionId, plan) => {
        // 本次控制或资格通知涉及的端口参与期。
        const session = sessions.get(sessionId)
        if (session === undefined || !post(session, { type: 'before-reconnect', sessionId, plan }))
          throw new SocketFuseError('WORKER_DISCONNECTED')
      },
      onAbort: (sessionId, planId) => {
        // 本次控制或资格通知涉及的端口参与期。
        const session = sessions.get(sessionId)
        if (session !== undefined)
          post(session, { type: 'abort-reconnect', sessionId, planId })
      },
      onCommit: (planId, override) => controller.commitReconnectPlan(planId, override),
      onDefault: planId => controller.useDefaultPlan(planId),
    })
    entry = { canonical: request.configCanonical, config, controller, sessions, dispatch, coordinator, extension,
      preparationSource: {}, preparation: undefined, idleTimer: undefined, reclaiming: false, disposed: false }
    try {
      // 扩展心跳组整体接管生成，不能与 adapter 混合调用。
      const hasGenerators = extension?.createPing !== undefined || extension?.createPong !== undefined
      controller.setHeartbeatGenerators(hasGenerators
        ? {
            ...(extension?.createPing === undefined ? {} : { createPing: () => extension.createPing?.(context(entry)) }),
            ...(extension?.createPong === undefined ? {} : { createPong: (incoming: ProtocolFrame<unknown>) => extension.createPong?.(incoming, context(entry)) }),
          }
        : undefined)
    }
    catch (error) {
      observeCallback(() => extension?.dispose?.())
      throw error
    }
    return entry
  }

  /** 当前全 runtime 不同 dispatch key 的静态额度。 */
  const keyCount = (): number => [...connections.values()].reduce((total, entry) => total + entry.dispatch.size, 0)

  /** attach 确认只包含安全快照；参与数由 runtime 补充。 */
  const attached = (session: Session, entry: Entry): Attached => ({ kind: 'attached', sessionId: session.id,
    snapshot: entry.controller.snapshot(), diagnostics: { ...entry.controller.diagnostics(), attachedClientCount: entry.sessions.size } })

  /** 握手后的附着原子提交，失败不保留空参与者或无扩展 socket。 */
  const attach = (session: Session, request: AttachRequest): Attached => {
    if (session.phase !== 'welcomed' || [...ports].some(port => port !== session && port.id === request.sessionId))
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE')
    // 严格校验后的初始 endpoint，不参与共享身份。
    const url = normalizeEndpointUrl(request.url)
    if (stableSerialize(request.shared) !== request.configCanonical)
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE')
    // 当前参与期所属的唯一连接条目。
    let entry = connections.get(request.id)
    if (entry !== undefined && entry.canonical !== request.configCanonical)
      throw new SocketFuseError('CONNECTION_CONFIG_CONFLICT')
    if ((entry?.sessions.size ?? 0) >= request.shared.limits.maxClientsPerConnection)
      throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED')
    if (entry === undefined) {
      entry = createEntry(request, url)
      // 扩展工厂可同步重入 dispose 或关闭此端口，未提交条目必须回滚。
      if (disposed || session.phase !== 'welcomed' || !ports.has(session) || connections.has(request.id)) {
        entry.controller.dispose()
        observeCallback(() => entry?.extension?.dispose?.())
        throw new SocketFuseError('CLIENT_DISCONNECTED')
      }
      connections.set(request.id, entry)
    }
    if (entry.idleTimer !== undefined)
      clearTimer(entry.idleTimer)
    entry.idleTimer = undefined
    entry.reclaiming = false
    session.id = request.sessionId
    session.phase = 'attached'
    session.entry = entry
    session.visibility = request.visibility
    session.delivery = new ParticipantDelivery(session.id, entry.controller.options.connectionEpoch, request.restore, limits, message => post(session, message))
    entry.sessions.set(session.id, session)
    armSession(session, entry.config.shared.lease.timeout)
    for (const key of request.dispatchKeys) {
      if (!entry.dispatch.has(key) && keyCount() >= limits.maxDispatchKeys)
        post(session, { type: 'error', sessionId: session.id, error: controlError(new SocketFuseError('RESOURCE_LIMIT_EXCEEDED')) })
      else
        entry.dispatch.register(session.id, key, session.visibility)
      // 同步 post 失败会回收参与期，后续注册和需求提交必须停止。
      if (session.phase !== 'attached' || session.entry !== entry)
        throw new SocketFuseError('CLIENT_DISCONNECTED')
    }
    if (request.reconnectHook)
      entry.coordinator.register(session.id, session.visibility)
    try {
      entry.controller.setDemand(true)
    }
    catch (error) {
      // 预算用尽仍保留参与意图，以便页面显式提出不计数恢复。
      report(entry, error instanceof SocketFuseError ? error : new SocketFuseError('SOCKET_ERROR'))
    }
    return attached(session, entry)
  }

  /** 所有控制输入同步处理；开放网络与页面 Promise 都不占 runtime 请求等待表。 */
  const receive = (session: Session, value: unknown): void => {
    if (session.phase === 'closed')
      return
    // 只有通过控制协议校验的消息才进入状态操作。
    let request: ClientControlMessage | undefined
    try {
      if (now() >= session.expiresAt) {
        dropSession(session)
        return
      }
      if (estimateStructuredCloneBytes(value, limits.maxControlEnvelopeBytes) > limits.maxControlEnvelopeBytes)
        throw new SocketFuseError('MESSAGE_TOO_LARGE')
      if (!isClientControlMessage(value))
        throw new SocketFuseError('INVALID_CONTROL_MESSAGE')
      request = value
      if (request.type === 'hello') {
        if (session.phase !== 'new' || request.protocolMajor !== CONTROL_PROTOCOL_MAJOR)
          throw new SocketFuseError('PROTOCOL_VERSION_MISMATCH')
        session.phase = 'welcomed'
        armSession(session, limits.unattachedPortTimeoutMs)
        post(session, { type: 'response', requestId: request.requestId, ok: true, value: { kind: 'welcome', instanceId, protocolMajor: CONTROL_PROTOCOL_MAJOR, limits } })
        return
      }
      if (request.type === 'attach') {
        // 经严格校验后才允许提交的协议动作或控制响应。
        const result = attach(session, request)
        post(session, { type: 'response', requestId: request.requestId, ok: true, value: result })
        return
      }
      // 当前参与期所属的唯一连接条目。
      const entry = session.entry
      if (session.phase !== 'attached' || entry === undefined || request.sessionId !== session.id)
        throw new SocketFuseError('CLIENT_DISCONNECTED')
      // 经严格校验后才允许提交的协议动作或控制响应。
      let result: Attached | ReturnType<typeof entry.controller.send> | ReturnType<typeof entry.controller.diagnostics> | null = null
      switch (request.type) {
        case 'detach':
          dropSession(session, request.requestId)
          return
        case 'demand':
          entry.controller.setDemand(true)
          result = attached(session, entry)
          break
        case 'send':
          result = entry.controller.send(session.id, request.data, request.options, () => session.phase === 'attached')
          break
        case 'register-key':
          if (!entry.dispatch.has(request.key) && keyCount() >= limits.maxDispatchKeys)
            throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED')
          entry.dispatch.register(session.id, request.key, session.visibility)
          break
        case 'unregister-key':
          entry.dispatch.unregister(session.id, request.key)
          break
        case 'set-reconnect-hook':
          if (request.enabled) entry.coordinator.register(session.id, session.visibility)
          else entry.coordinator.unregister(session.id)
          break
        case 'reconnect':
          entry.controller.requestReconnect('page', request.countAsRetry, request.observed)
          break
        case 'complete-reconnect-plan':
          entry.coordinator.accept(session.id, request.planId, { ...(request.url === undefined ? {} : { url: request.url }), ...(request.delay === undefined ? {} : { delay: request.delay }) })
          break
        case 'reject-reconnect-plan':
          entry.coordinator.reject(session.id, request.planId)
          break
        case 'diagnostics':
          result = { ...entry.controller.diagnostics(), attachedClientCount: entry.sessions.size }
          break
        case 'lease':
          if (request.sequence <= session.leaseSequence)
            return
          session.leaseSequence = request.sequence
          armSession(session, entry.config.shared.lease.timeout)
          post(session, { type: 'lease-confirmed', sessionId: session.id, sequence: request.sequence, connectionEpoch: entry.controller.options.connectionEpoch, grants: entry.dispatch.grantsForClient(session.id) })
          return
        case 'receipt':
          session.delivery?.receipt(request.deliveryId)
          return
        case 'visibility':
          session.visibility = request.visibility
          entry.dispatch.setVisibility(session.id, request.visibility)
          entry.coordinator.setVisibility(session.id, request.visibility)
          return
        case 'suspend':
          session.delivery?.suspend()
          return
        case 'restore':
          session.delivery?.resume()
          return
      }
      if ('requestId' in request)
        post(session, { type: 'response', requestId: request.requestId, ok: true, value: result })
    }
    catch (error) {
      // 边界失败只使用稳定错误码，不回传输入或 throw 文本。
      const safe = error instanceof SocketFuseError ? error : new SocketFuseError('INVALID_CONTROL_MESSAGE')
      // 仅向可确认的当前请求发送安全失败结果。
      const requestId = request !== undefined && 'requestId' in request
        ? request.requestId
        : exactKeys(value, ['type', 'requestId'], Object.keys(isPlainObject(value) ? value : {})) && typeof value.requestId === 'string' && value.requestId.length <= 256 ? value.requestId : undefined
      if (requestId !== undefined)
        post(session, { type: 'response', requestId, ok: false, error: controlError(safe) })
      if (session.phase !== 'attached' || safe.code === 'INVALID_CONTROL_MESSAGE')
        dropSession(session)
    }
  }

  return Object.freeze({ instanceId,
    /** 新端口只有未附着限时资源，不预先保留共享 id。 */
    connect(port: MessagePortLike): void {
      if (disposed || ports.size >= limits.maxPorts) {
        port.close?.()
        return
      }
      // 本次控制或资格通知涉及的端口参与期。
      const session: Session = { port, id: '', phase: 'new', entry: undefined, cleanup: () => undefined, timer: undefined,
        expiresAt: now() + limits.unattachedPortTimeoutMs, leaseSequence: 0, visibility: 'visible', delivery: undefined }
      ports.add(session)
      armSession(session, limits.unattachedPortTimeoutMs)
      session.cleanup = listenPort(port, value => receive(session, value), () => dropSession(session))
    },
    /** 先停止参与与计划，再关闭 socket，应用扩展按条目只释放一次。 */
    dispose(): void {
      if (disposed)
        return
      disposed = true
      for (const session of [...ports])
        dropSession(session)
      for (const entry of connections.values()) {
        if (entry.idleTimer !== undefined)
          clearTimer(entry.idleTimer)
        entry.idleTimer = undefined
        entry.reclaiming = true
        entry.controller.dispose()
        reclaim(entry)
      }
    },
  })
}
