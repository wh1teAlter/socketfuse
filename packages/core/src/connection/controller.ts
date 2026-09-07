/**
 * 拥有单一物理 WebSocket、尝试代际、出站 FIFO、心跳与共享重连预算。
 * 页面参与、连接池和协议业务扩展由上层 runtime 拥有；本模块只通知一个内部观察者。
 */
import type { BeforeReconnectReason, ConnectionDiagnostics, ConnectionSnapshot, ConnectionState, HeartbeatContext, ProtocolAdapter, ProtocolFrame, ReconnectSource, SafeCloseInfo, SendOptions, SendReceipt, SocketData, TimerHandle, Transport } from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import { addSocketListener, browserWebSocketFactory, SOCKET_CLOSED, SOCKET_OPEN, type WebSocketFactory, type WebSocketLike } from './socket'
import { normalizeEndpointUrl, safeEndpointOrigin } from '../shared/endpoint'
import { decodeAndClassify, encodeWithAdapter } from '../protocol/adapter'
import { calculateReconnectDelay, ReconnectPolicy } from './reconnect'
import { CONTROL_PROTOCOL_MAJOR } from '../shared/constants'
import { assertEncodedMessageSize } from '../shared/bytes'
import { invokeSynchronous } from '../shared/callbacks'
import { BackpressureTracker } from './backpressure'
import { SocketFuseError } from '../shared/errors'
import { readyStateFor, statusFor } from './state'
import { stableHash } from '../shared/structured'
import { HeartbeatController } from './heartbeat'
import { OutboundQueue } from './queue'

/** 一次只交给一个准备来源的不可变重连计划；不含 endpoint 或业务 payload。 */
export interface ReconnectPlan {
  /** 同一连接内唯一计划身份。 */
  readonly id: string
  /** 创建该计划的连接条目身份。 */
  readonly connectionEpoch: string
  /** 被替代的物理尝试。 */
  readonly originAttempt: number
  /** 下一次实际物理尝试编号。 */
  readonly attempt: number
  /** 安全触发来源。 */
  readonly source: ReconnectSource
  /** 是否在启动时消耗预算。 */
  readonly countAsRetry: boolean
  /** 接纳时已启动的计数重连次数。 */
  readonly retriesUsed: number
  /** 未覆盖时的退避毫秒。 */
  readonly defaultDelay: number
  /** 整个计划准备的绝对截止时间。 */
  readonly deadline: number
  /** 安全原因枚举。 */
  readonly reason: BeforeReconnectReason
  /** 不包含服务端 reason 的关闭信息。 */
  readonly close: SafeCloseInfo
}

/** 当前准备来源可一次性覆盖的尝试输入。 */
export interface ReconnectPlanOverride {
  /** 下一尝试的绝对 ws/wss URL；不得进入日志或响应。 */
  readonly url?: string
  /** 从提交时刻开始等待的整数毫秒。 */
  readonly delay?: number
}

/** 显式重连必须关联调用方实际观察过的尝试或计划。 */
export interface ReconnectObservation {
  /** 观察到的连接条目身份。 */
  readonly connectionEpoch: string
  /** 观察到的物理尝试。 */
  readonly attempt: number
  /** 观察时尚在进行的计划；未观察到计划时为 null。 */
  readonly planId: string | null
}

/** 连接唯一内部观察者；不会持有或等待页面业务回调。 */
export interface ConnectionObserver<Decoded> {
  /** 当前安全状态发生改变。 */
  readonly onState?: (snapshot: ConnectionSnapshot, reasonCode?: string) => void
  /** 原生打开后同步初始化连接协议，成功返回前不发布可用状态。 */
  readonly onInitializeOpen?: (attempt: number) => void
  /** 协议初始化成功后的可用连接通知。 */
  readonly onOpen?: (snapshot: ConnectionSnapshot) => void
  /** 解码后的 data/control 帧，供 runtime 在 fan-out 前处理。 */
  readonly onFrame?: (frame: ProtocolFrame<Decoded>, receivedAt: number, attempt: number) => void
  /** 一次物理尝试结束的唯一通知，包括未成功打开的尝试。 */
  readonly onClose?: (close: SafeCloseInfo & { readonly willReconnect: boolean }, attempt: number) => void
  /** 库生成的安全错误。 */
  readonly onError?: (error: SocketFuseError) => void
  /** 接管准备；返回 false 时使用默认 URL/delay。 */
  readonly onPrepare?: (plan: Readonly<ReconnectPlan>) => boolean
  /** 准备已提交或计划已取消；先使本地准备事务失效。 */
  readonly onPreparationEnd?: (planId: string) => void
  /** 原生 socket 已确认关闭，可由 runtime 判定空闲回收。 */
  readonly onStopped?: () => void
}

/** 当前连接所选的唯一心跳生成来源；调度仍只有 connection 一套。 */
export interface HeartbeatGenerators<Decoded, Outgoing> {
  /** 同步生成主动 ping。 */
  readonly createPing?: (context: HeartbeatContext) => Outgoing
  /** 同步生成服务端 ping 的回复。 */
  readonly createPong?: (frame: ProtocolFrame<Decoded>, context: HeartbeatContext) => Outgoing
}

/** 构造物理控制器所需的协议、配置、内部观察者与可控平台边界。 */
export interface ConnectionControllerOptions<Decoded, Outgoing> {
  /** 配置与初始 endpoint；连接控制器不读取页面本地选项。 */
  readonly config: NormalizedWebSocketConfig
  /** 当前连接静态注册的同步协议实现。 */
  readonly adapter: ProtocolAdapter<Decoded, Outgoing>
  /** 连接唯一内部观察者。 */
  readonly observer?: ConnectionObserver<Decoded>
  /** runtime 为条目分配的 epoch。 */
  readonly connectionEpoch: string
  /** 可注入测试或 Worker 的原生 socket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 单位为毫秒的时钟。 */
  readonly now?: () => number
  /** 重连抖动源。 */
  readonly random?: () => number
  /** 可注入 timer 工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 对应的 timer 释放函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
}

/** 在原生 close 确认前始终保留的 socket 所有权记录。 */
interface Attempt {
  /** epoch 内单调身份。 */
  readonly number: number
  /** 当前 socket；仅工厂调用中或构造失败时为空。 */
  socket: WebSocketLike | undefined
  /** 已结束的尝试不再接收 data/open/error；仍等待 close 回收。 */
  ended: boolean
  /** 防止反复调用 native close。 */
  closeRequested: boolean
  /** 原生监听解绑函数。 */
  cleanups: (() => void)[]
}

/** 计划身份覆盖准备、等待与 connecting；一次提交不会提前删除身份。 */
interface ActivePlan {
  /** 对外只读计划描述。 */
  readonly info: Readonly<ReconnectPlan>
  /** 当前计划处理阶段。 */
  phase: 'preparing' | 'waiting' | 'connecting'
  /** 提交后可以启动的最早时刻。 */
  startAt: number
}

/** 比较 raw 心跳 wire 字节；原生入站固定 ArrayBuffer，不存在 Blob await。 */
function sameWire(left: SocketData, right: SocketData): boolean {
  if (typeof left === 'string' || typeof right === 'string')
    return left === right
  if (left instanceof Blob || right instanceof Blob)
    return false
  // 仅比较左侧 wire 的可见字节。
  const a = left instanceof ArrayBuffer ? new Uint8Array(left) : new Uint8Array(left.buffer, left.byteOffset, left.byteLength)
  // 右侧视图同样不包含 backing buffer 的其他区域。
  const b = right instanceof ArrayBuffer ? new Uint8Array(right) : new Uint8Array(right.buffer, right.byteOffset, right.byteLength)
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** 生成不含配置或 payload 的本地操作身份。 */
function operationId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'socketfuse-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

/** 单 socket 状态机；连接需求来自 runtime，不保存页面对象或逐 client sink。 */
export class ConnectionController<Decoded, Outgoing> {
  /** 安全物理状态。 */
  private stateValue: ConnectionState = 'idle'
  /** 当前 endpoint，只有计划提交可修改。 */
  private endpoint: string
  /** 当前原生尝试；关闭确认前禁止创建替代 socket。 */
  private current: Attempt | undefined
  /** 已调用 socket 工厂次数。 */
  private attemptNumber = 0
  /** 安全快照的变化版本。 */
  private revision = 0
  /** runtime 是否还有参与需求。 */
  private demand = false
  /** 永久释放标记。 */
  private disposed = false
  /** 不允许显式请求复活的协议终态。 */
  private fatal = false
  /** 当前唯一计划。 */
  private plan: ActivePlan | undefined
  /** 计划准备或退避的唯一 timer。 */
  private planTimer: TimerHandle | undefined
  /** 当前原生建连 timer。 */
  private connectTimer: TimerHandle | undefined
  /** 当前连续稳定窗口 timer。 */
  private stableTimer: TimerHandle | undefined
  /** 当前队列唯一唤醒 timer。 */
  private flushTimer: TimerHandle | undefined
  /** 当前尝试的心跳调度者。 */
  private heartbeat: HeartbeatController | undefined
  /** runtime 安装的连接状态型生成来源。 */
  private generators: HeartbeatGenerators<Decoded, Outgoing> | undefined
  /** 上次打开时间，仅用于安全快照。 */
  private connectedAt = 0
  /** 最近安全错误。 */
  private lastError: SocketFuseError | undefined
  /** 最近安全 close code。 */
  private lastCloseCode: number | null = null
  /** 编码后的有界业务 FIFO。 */
  private readonly queue: OutboundQueue
  /** 跨尝试保留已用计数的预算。 */
  private readonly retry: ReconnectPolicy
  /** 原生高低水位迟滞。 */
  private readonly backpressure: BackpressureTracker
  /** 工厂调用栈内的后继启动必须交给 timer，避免零退避构造失败无限递归。 */
  private starting = false
  /** 当前时钟。 */
  private readonly now: () => number
  /** timer 工厂。 */
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle
  /** timer 释放函数。 */
  private readonly clearTimer: (handle: TimerHandle) => void

  /** 创建尚未启动、没有参与需求的物理控制器。 */
  constructor(readonly options: ConnectionControllerOptions<Decoded, Outgoing>) {
    this.endpoint = options.config.url
    this.queue = new OutboundQueue(options.config.shared.queue.maxMessages, options.config.shared.queue.maxBytes)
    this.retry = new ReconnectPolicy(options.config.shared.reconnect)
    this.backpressure = new BackpressureTracker(options.config.shared.backpressure)
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
    this.clearTimer = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle))
  }

  /** 返回安全详细状态。 */
  get state(): ConnectionState {
    return this.stateValue
  }

  /** 返回是否已经没有需要等待 close 的原生 socket。 */
  get stopped(): boolean {
    return this.current === undefined
  }

  /** 返回当前完整 endpoint，仅供连接内部准备提交，不得投递给页面。 */
  get endpointUrl(): string {
    return this.endpoint
  }

  /** 安装一次连接级心跳来源；必须在首次需求前完成。 */
  setHeartbeatGenerators(value: HeartbeatGenerators<Decoded, Outgoing> | undefined): void {
    if (this.attemptNumber !== 0)
      throw new SocketFuseError('INTERNAL_STATE_ERROR')
    this.generators = value
    // 当前共享心跳配置，不读取页面本地表示。
    const heartbeat = this.options.config.shared.heartbeat
    if (heartbeat !== false && (value !== undefined || this.options.config.shared.protocol.kind !== 'raw')
      && (value ?? this.options.adapter).createPing === undefined)
      throw new SocketFuseError('INVALID_OPTIONS')
  }

  /** 建立或撤销连接需求；同 epoch 的后续恢复始终经过计数计划。 */
  setDemand(needed: boolean): ConnectionSnapshot {
    if (this.disposed)
      throw new SocketFuseError('CLIENT_DISPOSED')
    this.demand = needed
    if (!needed) {
      // 开始过的计划仍保留身份，后续 open 不能重复启动它。
      const connectingPlan = this.plan?.phase === 'connecting'
      this.cancelPlan()
      if (connectingPlan)
        this.close()
      return this.snapshot()
    }
    if (this.fatal)
      throw this.lastError ?? new SocketFuseError('PROTOCOL_ERROR', { fatal: true })
    if (this.current?.ended === false || this.plan !== undefined)
      return this.snapshot()
    if (this.attemptNumber === 0)
      this.startSocket()
    else
      this.requestReconnect('demand', true)
    return this.snapshot()
  }

  /** 当前尝试能否继续执行同步协议效果。 */
  isCurrentAttempt(number: number): boolean {
    return !this.disposed && this.current?.number === number && !this.current.ended
  }

  /** 返回与当前 epoch/attempt 绑定的安全状态，不暴露 endpoint。 */
  snapshot(): ConnectionSnapshot {
    return Object.freeze({ state: this.state, status: statusFor(this.state), readyState: readyStateFor(this.state),
      transport: 'pending', connectionEpoch: this.options.connectionEpoch, attempt: this.attemptNumber,
      connectedAt: this.connectedAt, revision: this.revision, planId: this.plan?.info.id ?? null })
  }

  /** 返回安全诊断；参与者计数和页面观测时间由上层填写。 */
  diagnostics(transport: Transport = 'pending', workerInstanceHash: string | null = null): ConnectionDiagnostics {
    return { transport, workerInstanceHash, logicalState: this.state, physicalState: this.state,
      connectionEpoch: this.options.connectionEpoch, attempt: this.attemptNumber, observedAt: 0,
      controlProtocolMajor: CONTROL_PROTOCOL_MAJOR, idHash: stableHash(this.options.config.id),
      configFingerprint: this.options.config.configFingerprint, endpointOrigin: safeEndpointOrigin(this.endpoint),
      retriesUsed: this.retry.used, retriesRemaining: this.retry.remaining, retryReserved: this.retry.reserved,
      nextRetryDelay: this.plan === undefined ? null : Math.max(0, this.plan.startAt - this.now()),
      lastSafeCloseCode: this.lastCloseCode, attachedClientCount: 0,
      queueMessages: this.queue.size, queueBytes: this.queue.bytes, bufferedAmount: this.current?.socket?.bufferedAmount ?? 0,
      outboundHighWater: this.backpressure.isHighWater, lastErrorCode: this.lastError?.code ?? null }
  }

  /** 接纳或加入唯一计划；先检查预算，成功后才替代健康连接。 */
  requestReconnect(source: ReconnectSource, countAsRetry = true, observed?: ReconnectObservation, reason: BeforeReconnectReason = 'explicit', close: SafeCloseInfo = { code: 1000, terminal: false, wasClean: true }): Readonly<ReconnectPlan> {
    if (this.disposed || !this.demand)
      throw new SocketFuseError(this.disposed ? 'CLIENT_DISPOSED' : 'CLIENT_DISCONNECTED')
    if (this.fatal)
      throw this.lastError ?? new SocketFuseError('PROTOCOL_ERROR', { fatal: true })
    if (observed !== undefined) {
      // 接纳请求前观察当前计划，合并操作不重新计费。
      const currentPlan = this.plan?.info
      if (observed.connectionEpoch !== this.options.connectionEpoch
        || (observed.planId !== null && observed.planId !== currentPlan?.id)
        || (observed.attempt !== this.attemptNumber && observed.attempt !== currentPlan?.originAttempt))
        throw new SocketFuseError('STALE_RECONNECT_PLAN')
    }
    if (this.plan !== undefined) {
      if (this.plan.info.countAsRetry !== countAsRetry)
        throw new SocketFuseError('RECONNECT_IN_PROGRESS')
      return this.plan.info
    }
    this.retry.settleStable(this.now())
    // 按下一次计数重试计算默认等待，单位毫秒。
    const defaultDelay = countAsRetry ? calculateReconnectDelay(this.options.config.shared.reconnect, this.retry.used + 1, this.options.random) : 0
    this.retry.reserve(countAsRetry)
    // 接纳时固定的计划元数据，不随后续请求改变计数方式。
    const info: Readonly<ReconnectPlan> = Object.freeze({ id: operationId(), connectionEpoch: this.options.connectionEpoch,
      originAttempt: this.attemptNumber, attempt: this.attemptNumber + 1, source, countAsRetry, retriesUsed: this.retry.used,
      defaultDelay,
      deadline: this.now() + this.options.config.shared.reconnect.hookTimeout, reason, close })
    // 当前计划引用，用于提交前后的身份守卫。
    const plan: ActivePlan = { info, phase: 'preparing', startAt: this.now() + info.defaultDelay }
    this.plan = plan
    this.setState('reconnecting')
    // 状态通知可以回收最后参与者；未提交的替代不能废掉仍健康的空闲 socket。
    if (this.plan !== plan) {
      if (this.current?.ended === false && this.current.socket?.readyState === SOCKET_OPEN)
        this.setState('open')
      return info
    }
    this.retry.endOpen(this.now())
    this.clearHandle('stableTimer')
    // 被新计划替代的物理尝试，关闭确认前继续拥有 socket。
    const previous = this.current
    if (previous !== undefined && !previous.ended)
      this.endAttempt(previous, close, true)
    if (this.plan !== plan) {
      if (previous !== undefined)
        this.requestSocketClose(previous)
      return info
    }
    this.planTimer = this.setTimer(() => {
      this.planTimer = undefined
      if (this.plan === plan && plan.phase === 'preparing')
        this.commitPlan(plan, {})
    }, Math.max(0, info.deadline - this.now()))
    if (this.options.observer?.onPrepare?.(info) !== true && this.plan === plan && plan.phase === 'preparing')
      this.commitPlan(plan, {})
    if (previous !== undefined)
      this.requestSocketClose(previous)
    return info
  }

  /** 当前准备来源的原子提交；绝对期限不依赖 timer 是否已被调度。 */
  commitReconnectPlan(planId: string, override: Readonly<ReconnectPlanOverride> = {}): void {
    // 当前计划引用，用于提交前后的身份守卫。
    const plan = this.plan
    if (plan?.info.id !== planId || plan.phase !== 'preparing' || this.now() >= plan.info.deadline)
      throw new SocketFuseError('STALE_RECONNECT_PLAN')
    this.commitPlan(plan, override)
  }

  /** 准备失败/忙时采用默认值；仍只影响当前未提交计划。 */
  useDefaultPlan(planId: string): void {
    // 当前计划引用，用于提交前后的身份守卫。
    const plan = this.plan
    if (plan?.info.id === planId && plan.phase === 'preparing')
      this.commitPlan(plan, {})
  }

  /** 同步接纳页面业务值；成功只说明 native accepted 或本地 queued。 */
  send(ownerId: string, data: Outgoing, options?: SendOptions, stillOwned: () => boolean = () => true): SendReceipt {
    if (this.disposed || !this.demand || !stillOwned())
      throw new SocketFuseError('CLIENT_DISCONNECTED')
    if (this.fatal)
      throw this.lastError ?? new SocketFuseError('PROTOCOL_ERROR', { fatal: true })
    // 只用于本地接纳跟踪的不透明消息身份。
    const messageId = operationId()
    // 本次同步编码结果，不能延迟绑定到下一尝试。
    let encoded: SocketData
    try {
      encoded = encodeWithAdapter(this.options.adapter, data, { messageId, now: this.now() })
    }
    catch (error) {
      this.protocolFailure(error)
      throw error
    }
    assertEncodedMessageSize(encoded, this.options.config.shared.limits.maxEncodedMessageBytes)
    if (this.disposed || !this.demand || !stillOwned())
      throw new SocketFuseError('CLIENT_DISCONNECTED')
    // 捕获本次操作的物理尝试，外部调用后仍须检查身份。
    const current = this.current
    // 原生已打开且未结束的尝试才能直接发送。
    const open = current !== undefined && !current.ended && current.socket?.readyState === SOCKET_OPEN
    // 当前原生缓冲区是否要求暂停业务发送。
    const backpressured = open && this.backpressure.update(current.socket?.bufferedAmount ?? 0)
    if (this.queue.size === 0 && open && !backpressured) {
      this.nativeSend(current, encoded)
      return { status: 'accepted', messageId, bufferedAmount: current.socket?.bufferedAmount ?? 0 }
    }
    // 本次发送的队列选择优先于共享默认策略。
    const allowed = options?.queue ?? (open ? this.options.config.shared.queue.whenBackpressured : this.options.config.shared.queue.whenDisconnected)
    if (!allowed)
      throw new SocketFuseError(open ? 'BACKPRESSURE' : 'SEND_WHILE_DISCONNECTED')
    // 容量检查与快照完成后才公开本地排队接纳。
    const queued = this.queue.enqueue(ownerId, encoded, messageId)
    this.flushQueue()
    return { status: 'queued', messageId, position: queued.position }
  }

  /** 协议回复只在当前 open 尝试立即发送；不进入任何队列或后续 socket。 */
  sendControl(attempt: number, data: Outgoing): void {
    if (!this.isCurrentAttempt(attempt) || this.current?.socket?.readyState !== SOCKET_OPEN)
      throw new SocketFuseError('CLIENT_DISCONNECTED')
    // 捕获本次操作的物理尝试，外部调用后仍须检查身份。
    const current = this.current
    // 本次同步编码结果，不能延迟绑定到下一尝试。
    let encoded: SocketData
    try {
      encoded = encodeWithAdapter(this.options.adapter, data, { messageId: operationId(), now: this.now() })
    }
    catch (error) {
      this.protocolFailure(error)
      throw error
    }
    assertEncodedMessageSize(encoded, this.options.config.shared.limits.maxEncodedMessageBytes)
    if (!this.isCurrentAttempt(attempt))
      throw new SocketFuseError('CLIENT_DISCONNECTED')
    if (this.backpressure.update(current.socket?.bufferedAmount ?? 0))
      throw new SocketFuseError('BACKPRESSURE')
    this.nativeSend(current, encoded)
  }

  /** 删除离开者尚未发送的数据；移除队首后再次唤醒同一 drain。 */
  removeOwner(ownerId: string): void {
    this.queue.removeOwner(ownerId)
    this.flushQueue()
  }

  /** 报告安全协议失败；同步契约违例属于不可重试条目终态。 */
  protocolFailure(error: unknown): void {
    // 仅沿库生成的稳定错误码传播失败。
    const safe = error instanceof SocketFuseError ? error : new SocketFuseError('PROTOCOL_ERROR')
    // 先固定安全失败，随后 close 观察者和 waiter 才能看到真正的终止原因。
    this.reportError(safe)
    if (safe.fatal) {
      this.fatal = true
      this.cancelPlan()
      // 捕获本次操作的物理尝试，外部调用后仍须检查身份。
      const current = this.current
      this.setState('failed', safe.code)
      if (current !== undefined) {
        this.endAttempt(current, { code: 4002, wasClean: false, terminal: true }, false)
        this.requestSocketClose(current)
      }
    }
  }

  /** 空闲期限到达时停止连接；保留 socket 所有权直至原生 close。 */
  close(): void {
    this.cancelPlan()
    this.queue.clear()
    // 捕获本次操作的物理尝试，外部调用后仍须检查身份。
    const current = this.current
    if (current === undefined) {
      this.setState(this.fatal ? 'failed' : 'closed')
      this.options.observer?.onStopped?.()
      return
    }
    this.setState(this.fatal ? 'failed' : 'closing')
    this.endAttempt(current, { code: 1000, wasClean: true, terminal: this.fatal }, false)
    this.requestSocketClose(current)
  }

  /** 永久停止控制器；原生关闭确认仍负责解除最后监听。 */
  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.demand = false
    this.close()
  }

  /** 更新快照版本后通知唯一观察者，调用方负责在外部返回后检查代际。 */
  private setState(state: ConnectionState, reasonCode?: string): void {
    this.stateValue = state
    this.revision++
    this.options.observer?.onState?.(this.snapshot(), reasonCode)
  }

  /** 清理一个控制器拥有的 timer，先解除引用再调用平台清理。 */
  private clearHandle(field: 'planTimer' | 'connectTimer' | 'stableTimer' | 'flushTimer'): void {
    // 先解除字段引用，再清理原 timer。
    const handle = this[field]
    this[field] = undefined
    if (handle !== undefined)
      this.clearTimer(handle)
  }

  /** 提交全部有效覆盖后结束准备；计划自身仍保留至建连成功/失败。 */
  private commitPlan(plan: ActivePlan, override: Readonly<ReconnectPlanOverride>): void {
    // 准备提交前完整校验的新 endpoint，不进入快照。
    const url = override.url === undefined ? this.endpoint : normalizeEndpointUrl(override.url)
    // 下一尝试的等待毫秒数，必须在提交时仍属于当前计划。
    const delay = override.delay ?? plan.info.defaultDelay
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 2_147_483_647)
      throw new SocketFuseError('INVALID_OPTIONS')
    if (this.plan !== plan || plan.phase !== 'preparing' || !this.demand || this.disposed)
      throw new SocketFuseError('STALE_RECONNECT_PLAN')
    this.endpoint = url
    plan.phase = 'waiting'
    plan.startAt = this.now() + delay
    this.clearHandle('planTimer')
    this.options.observer?.onPreparationEnd?.(plan.info.id)
    if (this.plan === plan)
      this.advancePlan()
  }

  /** 有需求、退避到期且旧 socket 已关闭才启动一次预留尝试。 */
  private advancePlan(): void {
    // 当前计划引用，用于提交前后的身份守卫。
    const plan = this.plan
    if (plan === undefined || plan.phase !== 'waiting' || this.current !== undefined || !this.demand || this.disposed)
      return
    this.clearHandle('planTimer')
    // 下一尝试的等待毫秒数，必须在提交时仍属于当前计划。
    const delay = plan.startAt - this.now()
    if (delay > 0 || this.starting) {
      this.planTimer = this.setTimer(() => {
        this.planTimer = undefined
        this.advancePlan()
      }, Math.max(0, delay))
      return
    }
    plan.phase = 'connecting'
    this.retry.start(plan.info.countAsRetry)
    this.startSocket()
  }

  /** 取消计划先移除内部引用，防止 abort 回调同步创建的新计划被旧 cleanup 清掉。 */
  private cancelPlan(): void {
    // 当前计划引用，用于提交前后的身份守卫。
    const plan = this.plan
    this.plan = undefined
    this.clearHandle('planTimer')
    this.retry.cancel()
    if (plan !== undefined)
      this.options.observer?.onPreparationEnd?.(plan.info.id)
  }

  /** 唯一 socket 工厂调用点；任何替代均须先经过 current 为空的守卫。 */
  private startSocket(): void {
    if (this.current !== undefined || !this.demand || this.disposed || this.fatal)
      return
    // 捕获本次操作的物理尝试，外部调用后仍须检查身份。
    const current: Attempt = { number: ++this.attemptNumber, socket: undefined, ended: false, closeRequested: false, cleanups: [] }
    this.current = current
    this.backpressure.reset()
    this.stateValue = 'connecting'
    this.starting = true
    try {
      current.socket = (this.options.socketFactory ?? browserWebSocketFactory)(this.endpoint, this.options.config.shared.protocols, 'arraybuffer')
      current.socket.binaryType = 'arraybuffer'
      current.cleanups = [
        addSocketListener(current.socket, 'open', () => this.opened(current)),
        addSocketListener<{ data: SocketData }>(current.socket, 'message', event => this.receive(current, event.data)),
        addSocketListener(current.socket, 'error', () => this.socketFailure(current, new SocketFuseError('SOCKET_ERROR', { retryable: true }), 'socket-error')),
        addSocketListener<{ code?: number, wasClean?: boolean }>(current.socket, 'close', event => this.closed(current, event)),
      ]
      this.setState('connecting')
      if (current.ended || this.disposed) {
        this.requestSocketClose(current)
        return
      }
      this.connectTimer = this.setTimer(() => {
        this.connectTimer = undefined
        this.socketFailure(current, new SocketFuseError('CONNECTION_TIMEOUT', { retryable: true }), 'connection-timeout')
      }, this.options.config.shared.connectionTimeout)
      if (current.socket.readyState === SOCKET_OPEN)
        this.opened(current)
      else if (current.socket.readyState === SOCKET_CLOSED)
        this.closed(current, {})
    }
    catch {
      this.socketFailure(current, new SocketFuseError('SOCKET_ERROR', { retryable: true }), 'socket-error')
      if (current.socket === undefined)
        this.releaseSocket(current)
    }
    finally {
      this.starting = false
    }
  }

  /** 先完成协议初始化，再提交可用状态；失败的初始化不能结算页面 open。 */
  private opened(current: Attempt): void {
    if (!this.isCurrentAttempt(current.number) || this.state === 'open')
      return
    this.clearHandle('connectTimer')
    this.cancelPlan()
    if (!this.isCurrentAttempt(current.number))
      return
    this.options.observer?.onInitializeOpen?.(current.number)
    if (!this.isCurrentAttempt(current.number))
      return
    this.connectedAt = this.now()
    this.retry.recordOpen(this.connectedAt)
    // 连续健康 open 的预算重置窗口；false 永不自动补充。
    const threshold = this.options.config.shared.reconnect.stableThreshold
    if (threshold !== false) {
      this.stableTimer = this.setTimer(() => {
        this.stableTimer = undefined
        if (this.isCurrentAttempt(current.number) && this.state === 'open' && this.retry.settleStable(this.now()))
          this.setState('open')
      }, threshold)
    }
    this.setState('open')
    if (!this.isCurrentAttempt(current.number))
      return
    this.options.observer?.onOpen?.(this.snapshot())
    if (!this.isCurrentAttempt(current.number))
      return
    this.startHeartbeat(current)
    this.flushQueue()
  }

  /** 解码和分类同步完成；每个原生帧最多通知 runtime 一次。 */
  private receive(current: Attempt, data: SocketData): void {
    if (!this.isCurrentAttempt(current.number))
      return
    try {
      // 当前共享心跳配置，不读取页面本地表示。
      const heartbeat = this.options.config.shared.heartbeat
      if (heartbeat !== false && this.options.config.shared.protocol.kind === 'raw' && sameWire(data, heartbeat.responseMessage as SocketData)) {
        this.heartbeat?.acknowledge('activity')
        this.heartbeat?.acknowledge('pong')
        return
      }
      // 原生接收时刻，回放保留该时间。
      const receivedAt = this.now()
      // 同步解码并严格分类后的单个物理帧。
      const frame = decodeAndClassify(this.options.adapter, data, { now: receivedAt, receivedAt })
      if (!this.isCurrentAttempt(current.number))
        return
      this.heartbeat?.acknowledge('activity')
      if (frame.type === 'pong')
        this.heartbeat?.acknowledge('pong')
      else if (frame.type === 'ping') {
        // 本连接选定的唯一生成器来源。
        const generator = (this.generators ?? this.options.adapter).createPong
        if (generator !== undefined) {
          // 当前尝试的即时协议回复，不跨尝试排队。
          const reply = invokeSynchronous(() => generator(frame, { attempt: current.number, now: this.now() }), 'PROTOCOL_ERROR')
          if (this.isCurrentAttempt(current.number))
            this.sendControl(current.number, reply)
        }
      }
      else if (frame.type === 'fatal')
        this.protocolFailure(new SocketFuseError('PROTOCOL_ERROR', { fatal: true }))
      else if (frame.type !== 'ignore')
        this.options.observer?.onFrame?.(frame, receivedAt, current.number)
    }
    catch (error) {
      if (this.isCurrentAttempt(current.number))
        this.protocolFailure(error)
    }
  }

  /** 启动唯一同步心跳调度者，计时器不能发送到另一尝试。 */
  private startHeartbeat(current: Attempt): void {
    // 引擎拥有的心跳时序策略。
    const options = this.options.config.shared.heartbeat
    if (options === false)
      return
    this.heartbeat = new HeartbeatController(options, {
      now: this.now, setTimeout: this.setTimer, clearTimeout: this.clearTimer,
      send: () => {
        if (!this.isCurrentAttempt(current.number))
          return
        try {
          // 本连接选定的唯一生成器来源。
          const generator = (this.generators ?? this.options.adapter).createPing
          // 本次心跳的出站协议值，由当前 adapter 编码。
          const data = this.options.config.shared.protocol.kind === 'raw' && this.generators === undefined
            ? options.message as Outgoing
            : invokeSynchronous(() => generator?.({ attempt: current.number, now: this.now() }) as Outgoing, 'PROTOCOL_ERROR')
          if (this.isCurrentAttempt(current.number))
            this.sendControl(current.number, data)
        }
        catch (error) {
          if (this.isCurrentAttempt(current.number))
            this.protocolFailure(error)
        }
      },
      onTimeout: () => this.socketFailure(current, new SocketFuseError('HEARTBEAT_TIMEOUT', { retryable: true }), 'heartbeat-timeout'),
    })
    this.heartbeat.start()
  }

  /** 原生发送失败统一结束当前尝试；绝不返回本地 accepted。 */
  private nativeSend(current: Attempt, data: SocketData): void {
    try {
      if (!this.isCurrentAttempt(current.number) || current.socket?.readyState !== SOCKET_OPEN)
        throw new Error()
      current.socket.send(data)
      if (!this.isCurrentAttempt(current.number) || current.socket.readyState !== SOCKET_OPEN)
        throw new Error()
    }
    catch {
      // 原生异常只转换为固定安全码。
      const error = new SocketFuseError('SOCKET_ERROR', { retryable: true })
      this.socketFailure(current, error, 'socket-error')
      throw error
    }
  }

  /** 业务 FIFO 的唯一推进函数；高水位入队本身会安装唤醒。 */
  private flushQueue(): void {
    this.clearHandle('flushTimer')
    // 捕获本次操作的物理尝试，外部调用后仍须检查身份。
    const current = this.current
    if (current === undefined || !this.isCurrentAttempt(current.number) || current.socket?.readyState !== SOCKET_OPEN)
      return
    while (this.queue.size > 0 && this.isCurrentAttempt(current.number) && !this.backpressure.update(current.socket.bufferedAmount)) {
      // 未成功发送前保留的 FIFO 队首。
      const item = this.queue.peek()
      if (item === undefined)
        break
      try {
        this.nativeSend(current, item.data)
      }
      catch {
        break
      }
      // 同步平台注入可能使 owner 离开，不能把已换成下一项的队首错误移除。
      if (this.queue.peek() === item)
        this.queue.shift()
    }
    if (this.queue.size > 0 && this.isCurrentAttempt(current.number) && this.flushTimer === undefined)
      this.flushTimer = this.setTimer(() => {
        this.flushTimer = undefined
        this.flushQueue()
      }, 25)
  }

  /** 决定引擎自动恢复许可；应用抛错按默认许可，异步违约终止。 */
  private allowsAutomatic(close: SafeCloseInfo): boolean {
    if (!this.demand || this.disposed || this.fatal || !this.options.config.shared.reconnect.automatic)
      return false
    // 适配器对安全关闭元数据的同步恢复决策。
    const decide = this.options.adapter.shouldReconnect
    if (decide === undefined)
      return close.code !== 1000
    try {
      // 恢复决策必须为真正的 boolean。
      const result = invokeSynchronous(() => decide(close), 'PROTOCOL_ERROR')
      if (typeof result !== 'boolean')
        throw new SocketFuseError('PROTOCOL_ERROR')
      return result
    }
    catch (error) {
      this.protocolFailure(error)
      return !this.fatal && close.code !== 1000
    }
  }

  /** 网络错误和超时都通过同一计数计划恢复，不因随后 close 再建一次计划。 */
  private socketFailure(current: Attempt, error: SocketFuseError, reason: BeforeReconnectReason): void {
    if (!this.isCurrentAttempt(current.number))
      return
    this.reportError(error)
    this.finishAttempt(current, { code: 1006, wasClean: false, terminal: false }, reason)
    this.requestSocketClose(current)
  }

  /** 自发 close 或原生关闭确认只结算当前记录；旧回调不得影响新尝试。 */
  private closed(current: Attempt, event: { code?: number, wasClean?: boolean }): void {
    if (this.current !== current)
      return
    // 忽略服务端 reason，只保留安全关闭信息。
    const close: SafeCloseInfo = { code: Number.isInteger(event.code) ? event.code as number : 1006, wasClean: event.wasClean === true, terminal: this.fatal }
    if (!current.ended)
      this.finishAttempt(current, close, 'socket-close')
    this.releaseSocket(current)
  }

  /** 结束失败/断开的尝试，并在通知页面前固定下一计划。 */
  private finishAttempt(current: Attempt, close: SafeCloseInfo, reason: BeforeReconnectReason): void {
    if (!this.isCurrentAttempt(current.number))
      return
    if (this.plan?.phase === 'connecting')
      this.cancelPlan()
    // 当前关闭是否可创建计数自动恢复计划。
    const automatic = this.allowsAutomatic(close)
    if (!this.isCurrentAttempt(current.number))
      return
    if (automatic) {
      try {
        this.requestReconnect('automatic', true, undefined, reason, close)
        return
      }
      catch (error) {
        this.reportError(error instanceof SocketFuseError ? error : new SocketFuseError('PROTOCOL_ERROR'))
      }
    }
    this.setState(this.fatal ? 'failed' : 'closed', this.lastError?.code ?? 'CLOSE_NOT_RETRYABLE')
    this.endAttempt(current, { ...close, terminal: this.fatal }, false)
  }

  /** 一次性失效尝试和其计时器；原生 close 所有权仍由 current 保留。 */
  private endAttempt(current: Attempt, close: SafeCloseInfo, willReconnect: boolean): void {
    if (this.current !== current || current.ended)
      return
    current.ended = true
    this.retry.endOpen(this.now())
    this.clearHandle('connectTimer')
    this.clearHandle('stableTimer')
    this.clearHandle('flushTimer')
    this.heartbeat?.stop()
    this.heartbeat = undefined
    this.lastCloseCode = close.code
    this.options.observer?.onClose?.({ ...close, willReconnect }, current.number)
  }

  /** 发起原生关闭；不伪造关闭完成或因超时遗弃仍存活的 socket。 */
  private requestSocketClose(current: Attempt): void {
    if (this.current !== current || current.closeRequested || current.socket === undefined)
      return
    if (current.socket.readyState === SOCKET_CLOSED) {
      this.releaseSocket(current)
      return
    }
    current.closeRequested = true
    try {
      current.socket.close(1000)
    }
    catch {
      // 关闭失败仍保留所有权，等待原生 close；不能创建第二条物理连接。
      this.reportError(new SocketFuseError('SOCKET_ERROR', { retryable: true }))
    }
  }

  /** 确认关闭后解除监听，再推进等待该 socket 的计划或空闲回收。 */
  private releaseSocket(current: Attempt): void {
    if (this.current !== current)
      return
    for (const cleanup of current.cleanups)
      cleanup()
    current.cleanups = []
    this.current = undefined
    if (this.state === 'closing')
      this.setState(this.fatal ? 'failed' : 'closed')
    this.advancePlan()
    if (this.current === undefined)
      this.options.observer?.onStopped?.()
  }

  /** 只保存并通知库内安全错误，不保存底层异常文本。 */
  private reportError(error: SocketFuseError): void {
    this.lastError = error
    this.options.observer?.onError?.(error)
  }
}
