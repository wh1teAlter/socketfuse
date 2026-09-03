/**
 * 拥有 SharedWorker 端口、连接池与 Worker 级资源限制。
 *
 * hello 是 attach 的事务边界：只有配置重建、controller.attach 和 client 提交都成功，
 * 端口才成为已附着 client；任一失败都必须回滚临时连接和端口 timer。
 */
import type { BeforeReconnectReason, ClientVisibility, JsonProtocolOptions, NormalizedRestoreOptions, ProtocolAdapter, SafeCloseInfo, TimerHandle, WorkerResourceLimits } from '../shared/types'
import type { WebSocketFactory } from '../transport/socket'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, type HelloRequest, isClientControlMessage, type WorkerControlMessage } from './control'
import { type NormalizedWebSocketConfig, normalizeRestoreOptions, normalizeWebSocketOptions, type SharedConnectionConfig } from '../config/normalize'
import { ConnectionController, type ConnectionSink, type ReconnectPlan, type ReconnectPlanOverride } from '../connection/controller'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_LEASE_OPTIONS, DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { isSocketFuseError, SocketFuseError, toSafePublicError, toSocketFuseError } from '../shared/errors'
import { createJsonProtocolAdapter, rawProtocol, validateProtocolAdapter } from '../protocol/adapter'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'
import { normalizeEndpointUrl, safeEndpointOrigin } from '../shared/endpoint'
import { ReconnectCoordinator } from '../transport/reconnect-coordinator'
import { ExclusiveKeyRegistry } from './exclusive-keys'

/** 自定义 Worker runtime 使用的最小 MessagePort 能力面。 */
export interface MessagePortLike {
  /** 发送结构化克隆控制消息。 */
  postMessage: (message: unknown) => void
  /** 开始接收事件。 */
  start?: () => void
  /** 关闭端口并释放其消息通道。 */
  close?: () => void
  /** 注册消息或消息解析错误监听。 */
  addEventListener?: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  /** 移除已注册监听。 */
  removeEventListener?: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  /** 不支持 addEventListener 时的消息回调。 */
  onmessage?: ((event: { readonly data: unknown }) => void) | null
  /** 不支持 addEventListener 时的消息错误回调。 */
  onmessageerror?: ((event: { readonly data: unknown }) => void) | null
}

/** 入站过滤判定：继续派发或整条丢弃。 */
export type InboundDecision = 'deliver' | 'drop'

/**
 * 扩展准备一次连接尝试时收到的有界上下文。
 *
 * 能力刻意最小化：只能覆盖下一次尝试的 endpoint 与延迟，不能触碰参与共享
 * fingerprint 的配置，否则多标签页的配置冲突检测会失效。
 */
export interface AttemptPreparationContext {
  /** 从一开始计数的本次重连序号。 */
  readonly attempt: number
  /** 未覆盖时使用的退避延迟。 */
  readonly defaultDelay: number
  /** 当前重连的安全原因。 */
  readonly reason: BeforeReconnectReason
  /** 已移除服务端 reason 文本的安全 close 信息。 */
  readonly close: SafeCloseInfo
  /** 总期限到达或计划失效时终止。 */
  readonly signal: AbortSignal
  /** 覆盖下一次尝试使用的固定 URL。 */
  readonly setOptions: (options: { readonly url: string }) => void
  /** 覆盖从提交到下一次尝试的等待时间。 */
  readonly setDelay: (delay: number) => void
}

/** 传给扩展工厂与回调的连接身份；不含完整 endpoint、query 或凭据。 */
export interface ConnectionExtensionContext {
  /** 共享连接的业务 id。 */
  readonly connectionId: string
  /** endpoint 的 origin，与 diagnostics 同口径。 */
  readonly endpointOrigin: string
  /** 当前物理连接尝试计数。 */
  readonly attempt: number
}

/**
 * 一条共享连接的业务扩展实例。
 *
 * 扩展在 Worker 内按连接运行一次，用于所有标签页共同需要的逻辑。所有回调都必须
 * 快速返回：Worker 是全部标签页共享的单线程，阻塞会放大为全局延迟。
 */
export interface ConnectionExtension {
  /** 物理 socket 打开时调用；用于初始化或重置连接期状态。异常只记诊断。 */
  readonly onSocketOpen?: (context: ConnectionExtensionContext) => void
  /**
   * 判定一条已解码业务帧是否派发给标签页。
   *
   * 必须同步：Worker 是全部标签页共享的单线程。返回 `drop` 的帧在 fan-out 之前
   * 被丢弃，因此不消耗任何标签页的投递额度；抛出时按 `deliver` 放行，因为静默
   * 丢弃全局消息比重复投递严重得多。
   */
  readonly filterInbound?: (data: unknown, context: ConnectionExtensionContext) => InboundDecision
  /**
   * 准备下一次物理连接尝试；提供该方法即由扩展接管，页面 hook 不再参与该连接。
   *
   * 允许异步，但受计划总期限（`autoReconnect.hookTimeout`）约束；超时或抛出时
   * 沿用当前 endpoint 与默认退避。
   */
  readonly prepareAttempt?: (context: AttemptPreparationContext) => void | Promise<void>
  /** 连接条目释放时调用；用于释放扩展自有资源。 */
  readonly dispose?: () => void
}

/** 扩展工厂：每条共享连接调用一次，返回该连接独占的实例。 */
export type ConnectionExtensionFactory = (context: ConnectionExtensionContext) => ConnectionExtension

/** 自定义 Worker runtime 的依赖、时钟与静态协议注册。 */
export interface SharedWebSocketRuntimeOptions {
  /** 连接作用域业务扩展工厂；每条共享连接调用一次。 */
  readonly createExtension?: ConnectionExtensionFactory
  /** 在 Worker 内静态注册的 custom adapter。 */
  readonly protocols?: readonly ProtocolAdapter<unknown, unknown>[]
  /** 可注入的 WebSocket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 当前时间源，单位为 Unix 毫秒。 */
  readonly now?: () => number
  /** 可注入的 timer 工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 与注入 timer 配对的清理函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** runtime 静态资源上限，只能在首个页面连接前设置。 */
  readonly workerLimits?: Partial<WorkerResourceLimits>
}

interface RuntimeClient {
  /** 页面 port 所有权。 */
  readonly port: MessagePortLike
  /** 页面逻辑 client id。 */
  readonly clientId: string
  /** 所属共享连接 id。 */
  readonly connectionId: string
  /** 连接 controller 的事件 sink。 */
  readonly sink: ConnectionSink<unknown>
  /** 最近 lease 报活时间，单位为 Unix 毫秒。 */
  lastLeaseAt: number
  /** 是否暂停实时派发。 */
  suspended: boolean
  /** 挂起期间的有界 replay 队列。 */
  replay: { data: unknown, receivedAt: number, bytes: number }[]
  /** replay 队列当前估算字节数。 */
  replayBytes: number
  /** replay 溢出的消息累计数。 */
  replayDroppedMessages: number
  /** replay 溢出的字节累计数。 */
  replayDroppedBytes: number
  /** 当前页面请求的 restore 边界。 */
  readonly restore: Readonly<NormalizedRestoreOptions>
  /** 下一条 Worker→page delivery 的单调序号。 */
  nextDeliveryId: number
  /** 尚未收到 receipt 的 delivery 与估算字节。 */
  readonly outstandingDeliveries: Map<number, number>
  /** outstanding delivery 当前总字节数。 */
  outstandingBytes: number
  /** credit 满时待通知的入站丢弃数。 */
  inboundDroppedMessages: number
  /** credit 满时待通知的入站丢弃字节。 */
  inboundDroppedBytes: number
  /** Worker 最近收到的页面执行活性。 */
  visibility: ClientVisibility
}

interface ConnectionEntry {
  /** 共享配置 canonical，用于冲突检测。 */
  readonly canonical: string
  /** Worker 重建物理连接所需配置。 */
  readonly config: NormalizedWebSocketConfig<unknown, unknown>
  /** 该 id 唯一的物理连接 controller。 */
  readonly controller: ConnectionController<unknown, unknown>
  /** 该共享连接作用域内的 execution key 仲裁器。 */
  readonly exclusiveKeys: ExclusiveKeyRegistry
  /** 页面候选与 connection plan 之间的有界协调器。 */
  readonly reconnect: ReconnectCoordinator
  /** 该连接独占的业务扩展；未配置工厂时为 undefined。 */
  readonly extension: ConnectionExtension | undefined
}

/** SharedWorker 端 runtime：接受页面 port 并拥有共享物理连接。 */
export interface SharedWebSocketRuntime {
  /** Worker 实例 id，仅用于安全诊断关联。 */
  readonly instanceId: string
  /** 接受一个新页面 port；失败时关闭端口。 */
  connect: (port: MessagePortLike) => void
  /** 停止 lease、关闭端口并销毁所有 controller。 */
  dispose: () => void
}

/** 组合 custom adapter 的 Worker 注册 key。 */
function adapterKey(id: string, version: number): string {
  return `${id}@${version}`
}

/** 生成 Worker 实例或测试请求使用的 id。 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 校验正安全整数 Worker 限制。 */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new SocketFuseError('INVALID_OPTIONS', `${field} must be a positive safe integer`)
  return value
}

/** 校验正有限 Worker 限制。 */
function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new SocketFuseError('INVALID_OPTIONS', `${field} must be a positive finite number`)
  return value
}

/** 规范化 Worker 级资源限制，限制在 runtime 生命周期内保持不变。 */
function normalizeWorkerLimits(value: Partial<WorkerResourceLimits> | undefined): Readonly<WorkerResourceLimits> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw new SocketFuseError('INVALID_OPTIONS', 'workerLimits must be an options object')
  return Object.freeze({
    maxControlEnvelopeBytes: positiveInteger(value?.maxControlEnvelopeBytes ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxControlEnvelopeBytes, 'workerLimits.maxControlEnvelopeBytes'),
    maxExclusiveKeys: positiveInteger(value?.maxExclusiveKeys ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxExclusiveKeys, 'workerLimits.maxExclusiveKeys'),
    maxPorts: positiveInteger(value?.maxPorts ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxPorts, 'workerLimits.maxPorts'),
    unattachedPortTimeoutMs: positiveNumber(value?.unattachedPortTimeoutMs ?? DEFAULT_WORKER_RESOURCE_LIMITS.unattachedPortTimeoutMs, 'workerLimits.unattachedPortTimeoutMs'),
  })
}

/** 向有界 replay 队列追加消息，必要时按 oldest-first 丢弃。 */
function pushReplay(client: RuntimeClient, data: unknown, receivedAt: number, maxMessages: number, maxBytes: number): void {
  const bytes = estimateStructuredCloneBytes(data, maxBytes)
  while (client.replay.length >= maxMessages || client.replayBytes + bytes > maxBytes) {
    const removed = client.replay.shift()
    if (removed === undefined)
      break
    client.replayBytes -= removed.bytes
    client.replayDroppedBytes += removed.bytes
    client.replayDroppedMessages++
  }
  if (bytes > maxBytes) {
    client.replayDroppedBytes += bytes
    client.replayDroppedMessages++
    return
  }
  client.replay.push({ bytes, data, receivedAt })
  client.replayBytes += bytes
}

/** Worker→page delivery 的数量上限，防止慢页面无限积压。 */
const MAX_OUTSTANDING_DELIVERIES = 256
/** Worker→page delivery 的字节上限，单位为字节。 */
const MAX_OUTSTANDING_DELIVERY_BYTES = 4 * 1024 * 1024

/** 从共享协议描述解析 Worker 内的 adapter 实现。 */
function resolveAdapter(
  shared: SharedConnectionConfig,
  adapters: ReadonlyMap<string, ProtocolAdapter<unknown, unknown>>,
): ProtocolAdapter<unknown, unknown> {
  if (shared.protocol.kind === 'raw')
    return rawProtocol as ProtocolAdapter<unknown, unknown>
  if (shared.protocol.kind === 'json')
    return createJsonProtocolAdapter(shared.protocol.sharedConfig as never) as ProtocolAdapter<unknown, unknown>
  const adapter = adapters.get(adapterKey(shared.protocol.id, shared.protocol.version))
  if (adapter === undefined)
    throw new SocketFuseError('ADAPTER_NOT_REGISTERED', 'Custom protocol adapter is not registered in this Worker')
  return adapter
}

/** 根据 hello 重建 Worker 侧规范化配置并校验 canonical/fingerprint。 */
function createWorkerConfig(
  message: HelloRequest,
  adapters: ReadonlyMap<string, ProtocolAdapter<unknown, unknown>>,
): { readonly config: NormalizedWebSocketConfig<unknown, unknown>, readonly restore: Readonly<NormalizedRestoreOptions> } {
  const adapter = resolveAdapter(message.shared, adapters)
  const protocol = message.shared.protocol.kind === 'raw'
    ? 'raw'
    : message.shared.protocol.kind === 'json'
      ? message.shared.protocol.sharedConfig as unknown as JsonProtocolOptions
      : adapter
  const normalized = normalizeWebSocketOptions(message.url, {
    autoReconnect: message.shared.reconnect === false ? false : message.shared.reconnect,
    backpressure: message.shared.backpressure,
    binaryType: message.shared.binaryType,
    connectionTimeout: message.shared.connectionTimeout,
    heartbeat: message.shared.heartbeat,
    id: message.id,
    idleGraceMs: message.shared.idleGraceMs,
    lease: message.shared.lease,
    limits: message.shared.limits,
    protocol,
    protocols: message.shared.protocols,
    queue: message.shared.queue,
    worker: () => null as unknown as SharedWorker,
  }) as NormalizedWebSocketConfig<unknown, unknown>
  if (normalized.configCanonical !== message.configCanonical || normalized.configFingerprint !== message.configFingerprint)
    throw new SocketFuseError('INVALID_CONTROL_MESSAGE', 'Hello configuration does not match its canonical fingerprint')
  return { config: normalized, restore: normalizeRestoreOptions({ restore: message.restore.enabled
    ? { maxBytes: message.restore.maxBytes, maxMessages: message.restore.maxMessages, replay: message.restore.replay }
    : false }) }
}

/**
 * 执行一段业务扩展代码并吞掉其异常。
 *
 * 扩展由应用提供，其失败不得影响连接状态机、其他标签页或 Worker 控制平面；
 * 异常文本也绝不跨端口传播。但失败必须可观测，否则扩展的 bug 会静默改变全局
 * 投递行为；调用方通过 `onFailure` 把它转成已脱敏诊断。
 *
 * @param run 待执行的扩展回调。
 * @param onFailure 捕获到异常时调用；只接收稳定错误码，不接收原始异常。
 * @returns 回调返回值；抛出时返回 undefined。
 */
function runExtension<Value>(run: () => Value, onFailure?: () => void): Value | undefined {
  try {
    return run()
  }
  catch {
    onFailure?.()
    return undefined
  }
}

/**
 * 让扩展在 Worker 内准备一次连接尝试，并在总期限内原子提交。
 *
 * 不新增提交路径：仍复用 controller 的 `commitReconnectPlan` 及其代际守卫。总期限
 * 到达、扩展抛出或迟到提交都沿用当前 endpoint 与默认退避，绝不部分应用草案。
 *
 * @param extension 该连接的业务扩展。
 * @param holder 延迟持有 controller 的引用，避免构造期循环依赖。
 * @param plan connection 创建的当前重连计划。
 * @param config 该连接的规范化配置，用于读取 hook 总期限。
 * @returns 固定为 `true`，表示扩展已接管本次提交。
 */
function startExtensionPreparation(
  extension: ConnectionExtension,
  holder: { current?: ConnectionController<unknown, unknown> },
  plan: Readonly<ReconnectPlan>,
  config: NormalizedWebSocketConfig<unknown, unknown>,
  timers: Pick<SharedWebSocketRuntimeOptions, 'clearTimeout' | 'setTimeout'> = {},
  onFailure?: () => void,
): boolean {
  const setTimer = timers.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
  const clearTimer = timers.clearTimeout ?? (handle => globalThis.clearTimeout(handle))
  const abort = new AbortController()
  const draft: { url?: string, delay?: number } = {}
  /** 计划已被 close/dispose 取代时提交会抛出；过期计划不得冒泡为未捕获异常。 */
  const commit = (override: Readonly<ReconnectPlanOverride>): void => {
    try {
      holder.current?.commitReconnectPlan(plan.id, override)
    }
    catch {
      // 计划已失效，无需再改变任何状态。
    }
  }
  const deadline = config.shared.reconnect === false ? 10_000 : config.shared.reconnect.hookTimeout
  const timer = setTimer(() => {
    if (abort.signal.aborted)
      return
    abort.abort()
    commit({})
  }, deadline)
  /** 期限外写入必须被显式拒绝，避免扩展误以为草案已生效。 */
  const assertActive = (): void => {
    if (abort.signal.aborted)
      throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer active')
  }
  const context: Readonly<AttemptPreparationContext> = Object.freeze({
    attempt: plan.attempt,
    close: plan.close,
    defaultDelay: plan.defaultDelay,
    reason: plan.reason,
    setDelay: (delay: number): void => {
      assertActive()
      if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0)
        throw new SocketFuseError('INVALID_OPTIONS', 'Reconnect delay must be a non-negative finite number')
      draft.delay = delay
    },
    setOptions: (options: { readonly url: string }): void => {
      assertActive()
      if (options === null || typeof options !== 'object' || Object.keys(options).some(key => key !== 'url'))
        throw new SocketFuseError('INVALID_OPTIONS', 'Reconnect options only accept url')
      draft.url = normalizeEndpointUrl(options.url, 'Reconnect url')
    },
    signal: abort.signal,
  })
  void (async () => {
    try {
      await extension.prepareAttempt?.(context)
      if (abort.signal.aborted)
        return
      clearTimer(timer)
      abort.abort()
      commit(draft)
    }
    catch {
      // 扩展失败不得修改 endpoint，也不把异常文本跨端口传播；但失败必须可观测。
      if (abort.signal.aborted)
        return
      clearTimer(timer)
      abort.abort()
      onFailure?.()
      commit({})
    }
  })()
  return true
}

/** 将任意异常裁剪为可跨端口的稳定 ControlError。 */
function serializeError(error: unknown): ControlError {
  const value = isSocketFuseError(error) ? error : toSocketFuseError(error, 'INTERNAL_STATE_ERROR', 'Worker operation failed')
  const safe = toSafePublicError(value)
  return { code: safe.code, fatal: safe.fatal, retryable: safe.retryable }
}

/**
 * 创建不安装全局 onconnect 的 Worker-side runtime。
 *
 * @param options Worker 内静态 adapter、socket 工厂、时钟和资源上限；创建后资源上限
 * 不能通过页面控制消息放宽。
 * @returns 可手动连接 port、查询 instanceId 并最终 dispose 的 runtime。
 * @throws `SocketFuseError`，当静态 adapter 或 Worker 资源上限无效时。
 */
export function createSharedWebSocketRuntime(options: SharedWebSocketRuntimeOptions = {}): SharedWebSocketRuntime {
  const workerLimits = normalizeWorkerLimits(options.workerLimits)
  const adapters = new Map<string, ProtocolAdapter<unknown, unknown>>()
  for (const adapter of options.protocols ?? []) {
    validateProtocolAdapter(adapter)
    adapters.set(adapterKey(adapter.id, adapter.version), adapter)
  }
  const connections = new Map<string, ConnectionEntry>()
  const clients = new Map<MessagePortLike, RuntimeClient>()
  const clientsById = new Map<string, RuntimeClient>()
  const connectedPorts = new Set<MessagePortLike>()
  const unattachedTimers = new Map<MessagePortLike, TimerHandle>()
  /** 正在回收的坏端口；阻止撤销通知再次递归回收同一端口。 */
  const detachingPorts = new Set<MessagePortLike>()
  /**
   * 已逻辑 close 但仍占用 maxPorts 的端口及其进入时间。
   *
   * 逻辑 close 保留额度，使页面可以立即重新 open；但页面卸载的默认路径只调用
   * close，此后端口既不在 clients 中（lease sweep 看不到），未 hello timer 也已
   * 清除，因此必须单独登记并按 lease 宽限期回收，否则额度会永久流失。
   */
  const closedPorts = new Map<MessagePortLike, { closedAt: number, leaseTimeout: number }>()
  const now = options.now ?? Date.now
  const instanceId = createId()
  let leaseTimer: TimerHandle | undefined
  let disposed = false

  /** 动态统计所有连接当前不同 execution key，避免授权投递失败的递归回收重复记账。 */
  const countExclusiveKeys = (): number => {
    let count = 0
    for (const entry of connections.values())
      count += entry.exclusiveKeys.size
    return count
  }

  /** 将页面 port 从 client、连接 owner 和 Worker 资源集合中释放。 */
  const detach = (port: MessagePortLike, closePort: boolean, releasePort = closePort): void => {
    if (detachingPorts.has(port)) {
      if (closePort)
        port.close?.()
      return
    }
    detachingPorts.add(port)
    const client = clients.get(port)
    try {
      if (client !== undefined) {
        const entry = connections.get(client.connectionId)
        // 先删除路由，再触发 key/reconnect 撤销回调；坏端口不能再次收到
        // 自己的 revoke/abort 通知并递归进入 detach。
        clients.delete(port)
        clientsById.delete(client.clientId)
        entry?.exclusiveKeys.removeClient(client.clientId)
        entry?.reconnect.unregister(client.clientId)
        entry?.controller.detach(client.clientId)
        if (!releasePort) {
          closedPorts.set(port, {
            closedAt: now(),
            leaseTimeout: entry?.config.shared.lease.timeout ?? DEFAULT_LEASE_OPTIONS.timeout,
          })
        }
      }
      if (releasePort) {
        connectedPorts.delete(port)
        closedPorts.delete(port)
        const timer = unattachedTimers.get(port)
        if (timer !== undefined)
          (options.clearTimeout ?? globalThis.clearTimeout)(timer)
        unattachedTimers.delete(port)
      }
      if (closePort)
        port.close?.()
    }
    finally {
      detachingPorts.delete(port)
    }
  }

  /** 只移除仍由指定 controller 拥有且没有 client 的连接项。 */
  const removeIdleConnection = (id: string, controller: ConnectionController<unknown, unknown>): void => {
    const entry = connections.get(id)
    if (entry?.controller !== controller || controller.attachedClientCount !== 0)
      return
    connections.delete(id)
    entry.reconnect.dispose()
    controller.dispose()
    runExtension(() => entry.extension?.dispose?.())
  }

  /** 周期回收 lease 超时的页面 client。 */
  const scheduleLeaseSweep = (): void => {
    if (disposed)
      return
    leaseTimer = (options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => {
      leaseTimer = undefined
      const current = now()
      for (const [port, client] of clients) {
        const entry = connections.get(client.connectionId)
        if (entry !== undefined && current - client.lastLeaseAt > entry.config.shared.lease.timeout)
          detach(port, true)
      }
      // 已 close 的端口不再出现在 clients 中，必须单独回收其 maxPorts 额度。
      for (const [port, closed] of [...closedPorts]) {
        if (current - closed.closedAt > closed.leaseTimeout)
          detach(port, true)
      }
      scheduleLeaseSweep()
    }, 1_000)
  }

  /** 向页面安全投递控制消息；端口失败即回收 client。 */
  const post = (port: MessagePortLike, message: WorkerControlMessage): void => {
    try {
      port.postMessage(message)
    }
    catch {
      detach(port, true)
    }
  }

  /** 在 credit 恢复后一次性通知累计入站丢弃。 */
  const flushInboundOverflow = (client: RuntimeClient): void => {
    if (client.inboundDroppedMessages === 0)
      return
    post(client.port, {
      direction: 'inbound',
      droppedBytes: client.inboundDroppedBytes,
      droppedMessages: client.inboundDroppedMessages,
      type: 'overflow',
    })
    client.inboundDroppedBytes = 0
    client.inboundDroppedMessages = 0
  }

  /** 在数量与字节 credit 内投递消息，并登记待回收 delivery。 */
  const deliver = (client: RuntimeClient, data: unknown, receivedAt: number, replayed: boolean): boolean => {
    const bytes = estimateStructuredCloneBytes(data, MAX_OUTSTANDING_DELIVERY_BYTES)
    if (client.outstandingDeliveries.size >= MAX_OUTSTANDING_DELIVERIES
      || client.outstandingBytes + bytes > MAX_OUTSTANDING_DELIVERY_BYTES) {
      if (replayed) {
        client.replayDroppedMessages++
        client.replayDroppedBytes += bytes
      }
      else {
        client.inboundDroppedMessages++
        client.inboundDroppedBytes += bytes
        if (client.outstandingDeliveries.size === 0)
          flushInboundOverflow(client)
      }
      return false
    }
    const deliveryId = ++client.nextDeliveryId
    client.outstandingDeliveries.set(deliveryId, bytes)
    client.outstandingBytes += bytes
    post(client.port, { data, deliveryId, receivedAt, replayed, type: 'message' })
    return true
  }

  /** 回复成功的 request。 */
  const respond = (port: MessagePortLike, requestId: string, value: ControlResponseValue): void => {
    post(port, { ok: true, requestId, type: 'response', value })
  }

  /** 回复已脱敏失败的 request。 */
  const reject = (port: MessagePortLike, requestId: string, error: unknown): void => {
    post(port, { error: serializeError(error), ok: false, requestId, type: 'response' })
  }

  /** 取得已经完成 hello 的 client 和连接项。 */
  const ensureAttached = (port: MessagePortLike): { client: RuntimeClient, entry: ConnectionEntry } => {
    const client = clients.get(port)
    if (client === undefined)
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE', 'Port is not attached')
    const entry = connections.get(client.connectionId)
    if (entry === undefined)
      throw new SocketFuseError('INTERNAL_STATE_ERROR', 'Connection entry is missing')
    return { client, entry }
  }

  /** 创建 controller 到当前页面 port 的事件 sink。 */
  const createSink = (port: MessagePortLike, message: HelloRequest): ConnectionSink<unknown> => ({
    id: message.clientId,
    onClose: event => post(port, { ...event, type: 'close' }),
    onError: error => post(port, { error: serializeError(error), type: 'error' }),
    onMessage: (data, receivedAt) => {
      const client = clients.get(port)
      if (client === undefined)
        return
      if (!client.suspended) {
        deliver(client, data, receivedAt, false)
        return
      }
      const restore = client.restore
      if (!restore.replay)
        return
      pushReplay(client, data, receivedAt, restore.maxMessages, restore.maxBytes)
    },
    onOpen: snapshot => post(port, { snapshot: { ...snapshot, transport: 'shared-worker' }, type: 'open' }),
    onState: (snapshot, reasonCode) => {
      const sharedSnapshot = { ...snapshot, transport: 'shared-worker' as const }
      post(port, reasonCode === undefined
        ? { snapshot: sharedSnapshot, type: 'state' }
        : { reasonCode, snapshot: sharedSnapshot, type: 'state' })
    },
  })

  /** 以 attach→client commit 顺序完成 hello 事务，失败时完整回滚。 */
  const handleHello = (port: MessagePortLike, message: HelloRequest): void => {
    if (message.protocolMajor !== CONTROL_PROTOCOL_MAJOR) {
      reject(port, message.requestId, new SocketFuseError('PROTOCOL_VERSION_MISMATCH', 'Control protocol version mismatch', { fatal: true }))
      detach(port, true)
      return
    }
    let createdEntry: ConnectionEntry | undefined
    try {
      if (!connectedPorts.has(port)) {
        if (connectedPorts.size >= workerLimits.maxPorts) {
          detach(port, true)
          throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED', 'Maximum Worker ports has been reached')
        }
        connectedPorts.add(port)
      }
      const workerConfig = createWorkerConfig(message, adapters)
      const existingClient = clientsById.get(message.clientId)
      if (existingClient !== undefined && existingClient.port !== port)
        throw new SocketFuseError('INVALID_CONTROL_MESSAGE', 'Client id is already attached')
      let entry = connections.get(message.id)
      if (entry !== undefined && entry.canonical !== message.configCanonical)
        throw new SocketFuseError('CONNECTION_CONFIG_CONFLICT', 'Connection id already uses a different shared configuration')
      if (entry === undefined) {
        const config = workerConfig.config
        /** 扩展与诊断共用的安全连接身份；只暴露 origin，不含 path、query 与凭据。 */
        const extensionContext = (attempt: number): ConnectionExtensionContext => ({
          attempt,
          connectionId: message.id,
          endpointOrigin: safeEndpointOrigin(config.url),
        })
        /**
         * 向该连接当前附着的全部页面报告一次扩展失败。
         *
         * 扩展不属于任何单个端口，因此失败必须广播；只发送稳定错误码，
         * 不含异常文本、stack 或 endpoint，避免内部细节跨端口泄漏。
         */
        const reportExtensionFailure = (): void => {
          const failure: ControlError = { code: 'INTERNAL_STATE_ERROR', fatal: false, retryable: false }
          for (const client of clients.values()) {
            if (client.connectionId === message.id)
              post(client.port, { error: failure, type: 'error' })
          }
        }
        /** 扩展是业务代码；其异常绝不能影响连接状态机或其他标签页。 */
        const extension = options.createExtension === undefined
          ? undefined
          : runExtension(() => options.createExtension?.(extensionContext(0)), reportExtensionFailure)
        /** reconnect 回调只会在 controller 构造完成并开始连接后触发。 */
        const controllerHolder: { current?: ConnectionController<unknown, unknown> } = {}
        const reconnect = new ReconnectCoordinator({
          ...(options.clearTimeout === undefined ? {} : { clearTimeout: options.clearTimeout }),
          onAbort: (clientId, planId) => {
            const target = clientsById.get(clientId)
            if (target !== undefined)
              post(target.port, { planId, type: 'abort-reconnect' })
          },
          onAssign: (clientId, plan) => {
            const target = clientsById.get(clientId)
            if (target !== undefined)
              post(target.port, { plan, type: 'before-reconnect' })
          },
          onCommit: (planId, override) => {
            const current = controllerHolder.current
            if (current === undefined)
              throw new SocketFuseError('INTERNAL_STATE_ERROR', 'Worker reconnect controller is unavailable')
            current.commitReconnectPlan(planId, override)
          },
          ...(options.setTimeout === undefined ? {} : { setTimeout: options.setTimeout }),
          timeout: config.shared.reconnect === false ? 10_000 : config.shared.reconnect.hookTimeout,
        })
        const controller = new ConnectionController({
          ...(options.clearTimeout === undefined ? {} : { clearTimeout: options.clearTimeout }),
          config,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.setTimeout === undefined ? {} : { setTimeout: options.setTimeout }),
          ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
          onIdle: idleController => removeIdleConnection(message.id, idleController),
          // 扩展提供准备函数时由它接管整个计划；否则回退到页面候选协调器。
          onReconnectPlan: plan => extension?.prepareAttempt === undefined
            ? reconnect.start(plan)
            : startExtensionPreparation(extension, controllerHolder, plan, config, {
                ...(options.clearTimeout === undefined ? {} : { clearTimeout: options.clearTimeout }),
                ...(options.setTimeout === undefined ? {} : { setTimeout: options.setTimeout }),
              }, reportExtensionFailure),
          onReconnectPlanCancel: planId => reconnect.cancel(planId),
          ...(extension?.onSocketOpen === undefined
            ? {}
            : { onSocketOpen: (attempt: number) => runExtension(() => extension.onSocketOpen?.(extensionContext(attempt)), reportExtensionFailure) }),
          ...(extension?.filterInbound === undefined
            ? {}
            : {
                // 过滤异常按放行降级：静默丢弃全局消息比重复投递严重得多。
                shouldDeliverInbound: (data: unknown) =>
                  runExtension(() => extension.filterInbound?.(data, extensionContext(controllerHolder.current?.retryAttempt ?? 0)), reportExtensionFailure) !== 'drop',
              }),
        })
        controllerHolder.current = controller
        const exclusiveKeys = new ExclusiveKeyRegistry({
          onGrant: (clientId, key) => {
            const target = clientsById.get(clientId)
            if (target !== undefined)
              post(target.port, { key, type: 'key-granted' })
          },
          onRevoke: (clientId, key) => {
            const target = clientsById.get(clientId)
            if (target !== undefined)
              post(target.port, { key, type: 'key-revoked' })
          },
        })
        entry = { canonical: message.configCanonical, config, controller, exclusiveKeys, extension, reconnect }
        createdEntry = entry
        connections.set(message.id, entry)
      }
      detach(port, false, false)
      const sink = createSink(port, message)
      const client: RuntimeClient = {
        clientId: message.clientId,
        connectionId: message.id,
        lastLeaseAt: now(),
        port,
        replay: [],
        replayBytes: 0,
        replayDroppedBytes: 0,
        replayDroppedMessages: 0,
        restore: workerConfig.restore,
        sink,
        suspended: false,
        inboundDroppedBytes: 0,
        inboundDroppedMessages: 0,
        nextDeliveryId: 0,
        outstandingBytes: 0,
        outstandingDeliveries: new Map(),
        visibility: message.visibility,
      }
      entry.controller.attach(sink)
      clients.set(port, client)
      clientsById.set(client.clientId, client)
      // 端口重新 open，不再是待回收的已 close 端口。
      closedPorts.delete(port)
      const unattachedTimer = unattachedTimers.get(port)
      if (unattachedTimer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(unattachedTimer)
      unattachedTimers.delete(port)
      respond(port, message.requestId, { attached: true, workerInstanceId: instanceId })
    }
    catch (error) {
      // controller.attach 必须先于 RuntimeClient 提交；如果资源上限拒绝 attach，
      // 临时连接必须同时释放，失败 hello 不能占用 client slot 或留下池中孤儿。
      if (createdEntry !== undefined && createdEntry.controller.attachedClientCount === 0) {
        connections.delete(message.id)
        createdEntry.controller.dispose()
        runExtension(() => createdEntry?.extension?.dispose?.())
      }
      reject(port, message.requestId, error)
      detach(port, true)
    }
  }

  /** 处理已 hello 端口的请求、lease、挂起、回放和 delivery receipt。 */
  const handleOperation = async (port: MessagePortLike, message: Exclude<ClientControlMessage, HelloRequest>): Promise<void> => {
    if (message.type === 'dispose') {
      detach(port, true)
      return
    }
    if (message.type === 'lease') {
      const client = clients.get(port)
      if (client !== undefined)
        client.lastLeaseAt = now()
      return
    }
    if (message.type === 'suspend') {
      const client = clients.get(port)
      if (client !== undefined)
        client.suspended = true
      return
    }
    if (message.type === 'restore') {
      const client = clients.get(port)
      if (client !== undefined) {
        client.suspended = false
        for (const item of client.replay)
          deliver(client, item.data, item.receivedAt, true)
        client.replay = []
        client.replayBytes = 0
        if (client.replayDroppedMessages > 0) {
          post(port, { direction: 'replay', droppedBytes: client.replayDroppedBytes, droppedMessages: client.replayDroppedMessages, type: 'overflow' })
          client.replayDroppedBytes = 0
          client.replayDroppedMessages = 0
        }
      }
      return
    }
    if (message.type === 'visibility') {
      const client = clients.get(port)
      if (client !== undefined) {
        client.visibility = message.visibility
        const entry = connections.get(client.connectionId)
        entry?.exclusiveKeys.setVisibility(client.clientId, message.visibility)
        entry?.reconnect.setVisibility(client.clientId, message.visibility)
        if (message.visibility === 'frozen' && entry !== undefined) {
          // 即使当前不是 holder，也发送每个候选 key 的 revoke 屏障。这样
          // thaw 后排队的旧 grant 必先经过 revoke，不能恢复冻结前权威。
          for (const key of entry.exclusiveKeys.keysForClient(client.clientId))
            post(client.port, { key, type: 'key-revoked' })
        }
      }
      return
    }
    if (message.type === 'receipt') {
      const client = clients.get(port)
      if (client !== undefined) {
        const bytes = client.outstandingDeliveries.get(message.deliveryId)
        if (bytes !== undefined) {
          client.outstandingDeliveries.delete(message.deliveryId)
          client.outstandingBytes -= bytes
          flushInboundOverflow(client)
        }
      }
      return
    }
    try {
      const { client, entry } = ensureAttached(port)
      switch (message.type) {
        case 'open':
          entry.controller.attach(client.sink)
          {
            const snapshot = await entry.controller.open()
            // close/dispose 可能在 open waiter 等待期间先提交；旧 client 不能
            // 在脱离后收到成功响应，也不能把新 hello 的页面误认为仍在 open。
            if (clients.get(port) !== client)
              throw new SocketFuseError('CLIENT_DISCONNECTED', 'Client is no longer attached')
            respond(port, message.requestId, { ...snapshot, transport: 'shared-worker' })
          }
          break
        case 'close':
          // 逻辑 close 只释放 client/connection 参与，不释放仍可重新 open 的
          // MessagePort。端口继续计入 maxPorts，避免大量可发消息的未计数通道
          // 绕过 Worker 控制平面上限；只有 dispose/坏端口才释放该额度。
          detach(port, false, false)
          respond(port, message.requestId, null)
          break
        case 'send':
          respond(port, message.requestId, await entry.controller.send(client.clientId, message.data, message.options))
          break
        case 'register-key': {
          if (!entry.exclusiveKeys.has(message.key) && countExclusiveKeys() >= workerLimits.maxExclusiveKeys)
            throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED', 'Maximum exclusive keys has been reached')
          entry.exclusiveKeys.register(client.clientId, message.key, client.visibility)
          respond(port, message.requestId, null)
          break
        }
        case 'unregister-key':
          entry.exclusiveKeys.unregister(client.clientId, message.key)
          respond(port, message.requestId, null)
          break
        case 'set-reconnect-hook':
          if (message.enabled)
            entry.reconnect.register(client.clientId, client.visibility)
          else
            entry.reconnect.unregister(client.clientId)
          respond(port, message.requestId, null)
          break
        case 'complete-reconnect-plan':
          entry.reconnect.accept(client.clientId, message.planId, {
            ...(message.delay === undefined ? {} : { delay: message.delay }),
            ...(message.url === undefined ? {} : { url: message.url }),
          })
          respond(port, message.requestId, null)
          break
        case 'reject-reconnect-plan':
          entry.reconnect.reject(client.clientId, message.planId)
          respond(port, message.requestId, null)
          break
        case 'reconnect':
          await entry.controller.reconnect()
          respond(port, message.requestId, null)
          break
        case 'diagnostics':
          respond(port, message.requestId, entry.controller.diagnostics('shared-worker', stableHash(instanceId)))
          break
        case 'probe':
          respond(port, message.requestId, { attached: true, workerInstanceId: instanceId })
          break
      }
    }
    catch (error) {
      reject(port, message.requestId, error)
    }
  }

  /** 接受一个新端口，安装严格 parser，并设置未 hello 回收 timer。 */
  const connect = (port: MessagePortLike): void => {
    if (disposed) {
      port.close?.()
      return
    }
    if (connectedPorts.size >= workerLimits.maxPorts) {
      port.close?.()
      return
    }
    connectedPorts.add(port)
    const onMessage = (event: { readonly data: unknown }): void => {
      if (estimateStructuredCloneBytes(event.data, workerLimits.maxControlEnvelopeBytes) > workerLimits.maxControlEnvelopeBytes) {
        detach(port, true)
        return
      }
      if (!isClientControlMessage(event.data)) {
        const record = event.data as { readonly requestId?: unknown }
        if (typeof record?.requestId === 'string')
          reject(port, record.requestId, new SocketFuseError('INVALID_CONTROL_MESSAGE', 'Invalid control message'))
        else
          detach(port, true)
        return
      }
      if (event.data.type === 'hello')
        handleHello(port, event.data)
      else
        void handleOperation(port, event.data)
    }
    const onMessageError = (): void => detach(port, true)
    if (port.addEventListener !== undefined) {
      port.addEventListener('message', onMessage)
      port.addEventListener('messageerror', onMessageError)
    }
    else {
      port.onmessage = onMessage
      port.onmessageerror = onMessageError
    }
    port.start?.()
    const timer = (options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => detach(port, true), workerLimits.unattachedPortTimeoutMs)
    unattachedTimers.set(port, timer)
  }

  scheduleLeaseSweep()

  return {
    connect,
    /** 幂等销毁 runtime 拥有的所有 timer、端口与物理连接。 */
    dispose(): void {
      if (disposed)
        return
      disposed = true
      if (leaseTimer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(leaseTimer)
      for (const port of [...clients.keys()])
        detach(port, true)
      for (const port of [...connectedPorts])
        detach(port, true)
      for (const entry of connections.values()) {
        entry.reconnect.dispose()
        entry.controller.dispose()
        runExtension(() => entry.extension?.dispose?.())
      }
      connections.clear()
    },
    instanceId,
  }
}

/** `exposeSharedWebSocketWorker` 接受的最小 SharedWorker global scope。 */
export interface SharedWorkerGlobalLike {
  /** 当前 Worker 的连接入口。 */
  onconnect: ((event: { readonly ports: readonly MessagePortLike[] }) => void) | null
}

/**
 * 创建 runtime 并在 SharedWorker global scope 安装 onconnect。
 *
 * @param options Worker runtime 依赖和静态资源上限。
 * @param scope 可选的测试/自定义 global scope；省略时使用当前 Worker globalThis。
 * @returns 已安装连接入口的 runtime。
 * @throws `SocketFuseError`，当 runtime 选项无效时。
 */
export function exposeSharedWebSocketWorker(options: SharedWebSocketRuntimeOptions = {}, scope?: SharedWorkerGlobalLike): SharedWebSocketRuntime {
  const target = scope ?? globalThis as unknown as SharedWorkerGlobalLike
  const runtime = createSharedWebSocketRuntime(options)
  target.onconnect = (event): void => {
    const port = event.ports[0]
    if (port !== undefined)
      runtime.connect(port)
  }
  return runtime
}
