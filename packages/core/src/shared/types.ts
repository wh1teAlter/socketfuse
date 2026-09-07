/**
 * SocketFuse 跨运行时的公开类型契约。
 *
 * 这里不拥有连接或页面生命周期，只定义页面、Worker 和协议适配器必须共同遵守的
 * 数据形状、单位和调用阶段；上层模块不得通过重复定义这些类型改变其语义。
 */
import type { SocketFuseError } from './errors'

/** 浏览器原生 WebSocket 与 raw 协议可收发的 payload 类型。 */
export type SocketData = string | Blob | ArrayBuffer | ArrayBufferView
/** 可同步形成共享 fingerprint 的 raw 心跳 payload；Blob 内容无法同步参与身份计算。 */
export type HeartbeatPayload = string | ArrayBuffer | ArrayBufferView
/** 兼容浏览器和测试注入时钟的定时器句柄。 */
export type TimerHandle = number | ReturnType<typeof setTimeout>

/** 由详细连接状态推导出的紧凑 VueUse 风格状态。 */
export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED'

/** 页面逻辑 client 的详细生命周期状态。 */
export type ConnectionState
  = | 'idle'
    | 'connecting'
    | 'open'
    | 'reconnecting'
    | 'closing'
    | 'closed'
    | 'failed'

/** 与原生 WebSocket `readyState` 对齐的数值状态。 */
export type ReadyState = 0 | 1 | 2 | 3
/** 当前为页面 client 选定的传输通道。 */
export type Transport = 'pending' | 'shared-worker' | 'direct'
/** 选定传输通道所使用的 Worker 部署方式。 */
export type WorkerMode = 'inline' | 'custom' | 'none'
/** Worker 选主时使用的页面执行活性状态。 */
export type ClientVisibility = 'visible' | 'hidden' | 'frozen'

/** 多标签页共享的重连策略；所有时间字段单位均为毫秒。 */
export interface ReconnectOptions {
  /** 最大重试次数；`Infinity` 表示不设上限，默认值为 `Infinity`。 */
  maxRetries: number
  /** 是否启用断线等引擎触发的自动恢复；显式恢复始终单独按预算判断。 */
  automatic: boolean
  /** 指数退避的起始延迟，默认值为 `1000`。 */
  initialDelay: number
  /** 单次重试允许的最大延迟，默认值为 `30000`。 */
  maxDelay: number
  /** 每次重试的指数乘数，默认值为 `2`。 */
  factor: number
  /** 取值范围为 `0` 到 `1` 的随机抖动比例，默认值为 `0.2`。 */
  jitter: number
  /** 连接连续保持 open 多久后重置重试计数，默认值为 `30000`。 */
  stableThreshold: number | false
  /** 整个重连计划的总准备时间，默认值为 `10000`。 */
  hookTimeout: number
}

/** 多标签页共享的应用层心跳策略；时间字段单位均为毫秒。 */
export interface HeartbeatOptions {
  /** `pong` 要求应答，`activity` 则以任意入站活动续命。 */
  mode: 'pong' | 'activity'
  /** 两次心跳发送之间的间隔。 */
  interval: number
  /** 等待心跳应答或活动的最长时间；省略时只发送保活帧，不主动断线。 */
  pongTimeout?: number
  /** raw 协议发送给服务端的原生 payload；其他协议不得设置。 */
  message?: HeartbeatPayload
  /** raw 协议在 `pong` 模式下识别的原生 payload；其他协议不得设置。 */
  responseMessage?: HeartbeatPayload
}

/** 多标签页共享且有边界的出站队列策略。 */
export interface QueueOptions {
  /** socket 未连接时是否允许入队，默认值为 `false`。 */
  whenDisconnected: boolean
  /** `bufferedAmount` 超过高水位时是否允许入队，默认值为 `false`。 */
  whenBackpressured: boolean
  /** 队列可持有的最大消息数，默认值为 `100`。 */
  maxMessages: number
  /** 编码后队列可持有的最大字节数，默认值为 1 MiB。 */
  maxBytes: number
}

/** 共享 WebSocket 的 `bufferedAmount` 背压阈值，单位为字节。 */
export interface BackpressureOptions {
  /** 达到此值后拒绝或按队列策略处理新发送。 */
  highWaterMarkBytes: number
  /** 下降到此值后恢复队列冲刷；必须小于高水位。 */
  lowWaterMarkBytes: number
}

/** 共享页面 client 的活性租约；时间字段单位均为毫秒。 */
export interface LeaseOptions {
  /** 页面向 Worker 报活的间隔。 */
  interval: number
  /** Worker 判定异常页面已失活并回收端口的时限。 */
  timeout: number
}

/** 仅属于一条共享物理 WebSocket 的资源上限。 */
export interface ConnectionLimits {
  /** 同一连接可同时附着的逻辑 client 上限。 */
  maxClientsPerConnection: number
  /** 单条编码出站消息允许的最大字节数。 */
  maxEncodedMessageBytes: number
}

/** 保护一个 SharedWorker 控制平面的静态资源上限。 */
export interface WorkerResourceLimits {
  /** 每端口尚未确认的投递数量上限。 */
  maxDeliveryMessages: number
  /** 每端口投递总字节与单个业务 envelope 上限。 */
  maxDeliveryBytes: number
  /** Worker 可接受的 MessagePort 总数上限。 */
  maxPorts: number
  /** 单个 page-to-Worker 控制 envelope 的最大结构化克隆字节数。 */
  maxControlEnvelopeBytes: number
  /** 端口建立后未完成 hello 时的回收时限，单位为毫秒。 */
  unattachedPortTimeoutMs: number
  /** 一个 Worker 内允许注册的不同 dispatch key 总数。 */
  maxDispatchKeys: number
}

/** 动态消息 handler 的可选执行约束。 */
export interface MessageHandlerOptions {
  /**
   * 为每帧选择一个页面接收者的非空业务 key；最长 1024 字符。
   *
   * 资格按帧绑定且过期尽力抑制，不保证跨页面副作用互斥；异步 handler 只能通过 `AbortSignal` 协作取消，
   * 浏览器无法强制终止，因此交接窗口内旧 holder 的副作用仍可能与新 holder 重叠。
   */
  readonly dispatchKey?: string
}

/** 每次业务 handler 调用收到的页面本地上下文。 */
export interface MessageHandlerContext {
  /** 分派资格撤销或当前参与期结束时终止的协作式信号。 */
  readonly signal: AbortSignal
}

/** 重连计划可公开给页面的安全原因。 */
export type BeforeReconnectReason = 'explicit' | 'socket-close' | 'socket-error' | 'connection-timeout' | 'heartbeat-timeout'

/** 当前重连计划允许页面覆盖的 WebSocket 配置。 */
export interface BeforeReconnectOptions {
  /** 下一次连接尝试使用的绝对 `ws:` 或 `wss:` URL 字符串；最长 16384 字符。 */
  readonly url: string
}

/** 页面准备一次重连计划时收到的有界上下文。 */
export interface BeforeReconnectContext {
  /** epoch 内下一次物理尝试编号；首次连接为 1，首次重连为 2，与计数预算独立。 */
  readonly attempt: number
  /** 未覆盖时使用的指数退避延迟。 */
  readonly defaultDelay: number
  /** 触发本计划的安全来源。 */
  readonly source: ReconnectSource
  /** 当前计划是否消耗重连预算。 */
  readonly countAsRetry: boolean
  /** 接纳本计划时已启动的计数重连数。 */
  readonly retriesUsed: number
  /** 已移除 reason 文本的安全 close 信息。 */
  readonly close: SafeCloseInfo
  /** 当前准备权成功提交、超时、冻结、转移或计划失效时终止。 */
  readonly signal: AbortSignal
  /** 当前重连的安全原因。 */
  readonly reason: BeforeReconnectReason
  /** 覆盖当前计划下一次连接使用的固定 URL。 */
  readonly setOptions: (options: BeforeReconnectOptions) => void
  /** 覆盖从成功提交到下一次连接尝试的等待时间。 */
  readonly setDelay: (delay: number) => void
}

/** 页面本地的重连计划准备函数。 */
export type BeforeReconnectHandler = (context: Readonly<BeforeReconnectContext>) => void | Promise<void>

/** 页面启用生命周期恢复后，在挂起期间使用的本地回放缓冲配置。 */
export interface RestoreOptions {
  /** 恢复时是否通过 `onMessage` 重放缓冲消息，默认值为 `false`。 */
  replay?: boolean
  /** 可缓冲的最大消息数，默认值为 `256`。 */
  maxMessages?: number
  /** 可缓冲的最大 payload 字节数，默认值为 4 MiB。 */
  maxBytes?: number
}

/** 页面本地的浏览器 freeze/restore 集成；默认关闭。 */
export interface LifecycleOptions {
  /** 是否启用恢复；对象形式额外指定有限回放边界。 */
  restore?: boolean | RestoreOptions
}

/** Worker 与页面都使用的恢复配置规范化结果。 */
export interface NormalizedRestoreOptions {
  /** 是否订阅浏览器挂起与恢复事件。 */
  enabled: boolean
  /** 恢复时是否派发已缓冲消息。 */
  replay: boolean
  /** 缓冲消息数上限。 */
  maxMessages: number
  /** 缓冲 payload 字节数上限。 */
  maxBytes: number
}

/** 控制一次 `sendMessage` 调用的页面本地选项。 */
export interface SendOptions {
  /** 覆盖本次发送是否可按共享队列策略入队。 */
  queue?: boolean
}

/** `sendMessage` 的本地接纳结果；它绝不是服务端投递回执。 */
export type SendReceipt
  = | {
    /** 已直接交给原生 socket 的本地接纳结果。 */
    readonly status: 'accepted'
    /** SocketFuse 本地消息标识。 */
    readonly messageId: string
    /** 原生 socket 当前 bufferedAmount，单位为字节。 */
    readonly bufferedAmount: number
  }
  | {
    /** 已进入有界出站队列的本地接纳结果。 */
    readonly status: 'queued'
    /** SocketFuse 本地消息标识。 */
    readonly messageId: string
    /** 消息在 FIFO 队列中的位置。 */
    readonly position: number
  }

/** `open()` 成功 resolve 时返回的不可变连接快照。 */
export interface ConnectionSnapshot {
  /** 当前详细生命周期状态。 */
  readonly state: ConnectionState
  /** 由详细状态推导的紧凑状态。 */
  readonly status: WebSocketStatus
  /** 原生 WebSocket 兼容的数值状态。 */
  readonly readyState: ReadyState
  /** 当前 socket 所属传输通道。 */
  readonly transport: Transport
  /** 当前连接条目身份；只有相同 epoch 内才可比较 attempt。 */
  readonly connectionEpoch: string
  /** 当前快照版本，只在相同 epoch 内递增。 */
  readonly revision: number
  /** 当前唯一重连计划；新尝试成功或失败后清空。 */
  readonly planId: string | null
  /** 当前 epoch 内包含首次及不计数尝试的单调计数。 */
  readonly attempt: number
  /** 最近一次成功打开的 Unix 时间戳，单位为毫秒；未打开时为 `0`。 */
  readonly connectedAt: number
}

/** 派发给页面监听器的业务消息；协议控制帧不会出现在这里。 */
export interface SocketFuseMessageEvent<Data> extends Event {
  /** 协议适配器解码后的应用 payload。 */
  readonly data: Data
  /** Worker 或 direct transport 接收消息的 Unix 时间戳，单位为毫秒。 */
  readonly receivedAt: number
  /** 实际接收消息的已选定传输通道。 */
  readonly transport: Exclude<Transport, 'pending'>
  /** 是否由页面生命周期恢复回放，而非实时派发。 */
  readonly replayed: boolean
}

/** 当前页面逻辑 client 的关闭通知。 */
export interface SocketFuseCloseEvent extends Event {
  /** 经安全化后暴露的 WebSocket close code。 */
  readonly code: number
  /** 原生 close 事件是否标记为 clean。 */
  readonly wasClean: boolean
  /** 是否已进入不会再次打开的终态。 */
  readonly terminal: boolean
  /** 当前共享连接是否将自行发起重连。 */
  readonly willReconnect: boolean
}

/** 页面逻辑状态改变时的详细通知。 */
export interface SocketFuseStateChangeEvent extends Event {
  /** 迁移前状态。 */
  readonly previous: ConnectionState
  /** 迁移后状态。 */
  readonly state: ConnectionState
  /** 发生迁移时当前选定的传输通道。 */
  readonly transport: Transport
  /** 关联的物理连接尝试计数。 */
  readonly attempt: number
  /** 可安全暴露的状态迁移原因码。 */
  readonly reasonCode?: string
}

/** 当前页面 dispatch key 持有状态实际变化时的通知。 */
export interface SocketFuseDispatchOwnerChangeEvent extends Event {
  /** 发生变化的 dispatch key。 */
  readonly key: string
  /** 当前页面是否得到该 key 的 Worker 授权。 */
  readonly held: boolean
}

/** 出站队列、入站 credit 或回放缓冲触及边界时的通知。 */
export interface SocketFuseOverflowEvent extends Event {
  /** 发生溢出的数据方向。 */
  readonly direction: 'outbound' | 'inbound' | 'replay'
  /** 为保持有界内存所采用的丢弃策略。 */
  readonly strategy: 'reject-newest' | 'drop-newest' | 'drop-oldest'
  /** 本次通知累计丢弃的消息数。 */
  readonly droppedMessages: number
  /** 本次通知累计丢弃的字节数。 */
  readonly droppedBytes: number
}

/** 传给可选 logger 的已脱敏运行事件。 */
export interface SocketFuseDiagnosticEvent {
  /** 诊断事件类别。 */
  readonly type: string
  /** 产生事件的 Unix 时间戳，单位为毫秒。 */
  readonly timestamp: number
  /** 可公开的稳定错误或原因码。 */
  readonly code?: string
}

/** 接收已脱敏诊断的回调；不能被当作业务消息监听器。 */
export type SocketFuseLogger = (event: Readonly<SocketFuseDiagnosticEvent>) => void

/** 一个逻辑 client 与物理连接的已脱敏瞬时指标。 */
export interface ConnectionDiagnostics {
  /** 页面当前选择的传输状态。 */
  readonly transport: Transport
  /** 当前页面逻辑 client 状态。 */
  readonly logicalState: ConnectionState
  /** 物理 socket 状态。 */
  readonly physicalState: ConnectionState
  /** SharedWorker 实例 id 的稳定 hash；direct 时为 `null`。 */
  readonly workerInstanceHash: string | null
  /** 已协商的控制协议 major 版本。 */
  readonly controlProtocolMajor: number
  /** 连接 `id` 的稳定 hash，不暴露原值。 */
  readonly idHash: string
  /** 共享配置的稳定 fingerprint。 */
  readonly configFingerprint: string
  /** endpoint 的 origin；不含 path、query 或凭据。 */
  readonly endpointOrigin: string
  /** 共享连接条目身份；回收重建后发生变化。 */
  readonly connectionEpoch: string
  /** 当前 epoch 内实际调用 socket 工厂的次数。 */
  readonly attempt: number
  /** 已启动的计数重连次数。 */
  readonly retriesUsed: number
  /** 扣除已用及预留后剩余的计数次数。 */
  readonly retriesRemaining: number
  /** 已接纳但未启动的计数预留。 */
  readonly retryReserved: 0 | 1
  /** 页面收到本样本的 Unix 毫秒时刻；runtime 内样本为 0。 */
  readonly observedAt: number
  /** 下次重试延迟，单位为毫秒；没有计划时为 `null`。 */
  readonly nextRetryDelay: number | null
  /** 最近一次可安全公开的 close code；未知时为 `null`。 */
  readonly lastSafeCloseCode: number | null
  /** 附着到该物理连接的逻辑 client 数量。 */
  readonly attachedClientCount: number
  /** 当前出站队列消息数。 */
  readonly queueMessages: number
  /** 当前出站队列编码后字节数。 */
  readonly queueBytes: number
  /** 原生 socket 当前 bufferedAmount，单位为字节。 */
  readonly bufferedAmount: number
  /** 是否已处于出站高水位。 */
  readonly outboundHighWater: boolean
  /** 最近可公开错误码；无错误时为 `null`。 */
  readonly lastErrorCode: string | null
}

/** 声明式 JSON 协议接受的 JSON 基元。 */
export type JsonPrimitive = null | boolean | number | string
/** 声明式模板与 matcher 接受的 JSON 结构值。 */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** matcher 的键为点/方括号字段路径，值按 JSON 结构比较。 */
export type JsonMatcher = Readonly<Record<string, JsonValue>>

/** 声明式 JSON ping/pong 模板与匹配器。 */
export interface JsonHeartbeatTemplate {
  /** 客户端主动发送的 ping 帧。 */
  readonly ping: JsonValue
  /** 用于识别服务端 pong 的匹配器。 */
  readonly pong: JsonMatcher
  /** 可选的服务端 ping 匹配器。 */
  readonly serverPing?: JsonMatcher
  /** 收到 serverPing 后返回的 pong 帧。 */
  readonly serverPong?: JsonValue
}

/** 同一 `id` 的每个标签页共享的声明式 JSON 协议定义。 */
export interface JsonProtocolOptions {
  /** 固定为 JSON 协议选择器。 */
  readonly type: 'json'
  /** 该协议的应用层心跳定义。 */
  readonly heartbeat?: JsonHeartbeatTemplate
  /** 被协议消费、不会派发给业务的入站帧匹配器。 */
  readonly ignore?: readonly JsonMatcher[]
}

/** 传给协议适配器操作的基础时间上下文。 */
export interface ProtocolContext {
  /** 操作发生时的 Unix 时间戳，单位为毫秒。 */
  readonly now: number
}

/** 调用适配器 `encode` 时附加的上下文。 */
export interface EncodeContext extends ProtocolContext {
  /** SocketFuse 本地分配的发送标识；不代表服务端确认。 */
  readonly messageId: string
}

/** 调用适配器 `decode` 时附加的上下文。 */
export interface DecodeContext extends ProtocolContext {
  /** 收到原始 socket payload 的 Unix 时间戳，单位为毫秒。 */
  readonly receivedAt: number
}

/** 调用适配器 `classify` 时附加的上下文。 */
export interface ClassifyContext extends ProtocolContext {
  /** 收到原始 socket payload 的 Unix 时间戳，单位为毫秒。 */
  readonly receivedAt: number
}

/** 调用适配器心跳工厂时附加的上下文。 */
export interface HeartbeatContext extends ProtocolContext {
  /** 当前物理连接尝试计数。 */
  readonly attempt: number
}

/** 提供给适配器重连决策的已脱敏 close 信息。 */
export interface SafeCloseInfo {
  /** 原生 WebSocket close code。 */
  readonly code: number
  /** close 是否为 clean。 */
  readonly wasClean: boolean
  /** SocketFuse 是否已判定当前连接进入终态。 */
  readonly terminal: boolean
}

/** 将业务数据与协议控制帧分开的分类结果。 */
export type ProtocolFrame<Data>
  = | {
    /** 应派发给业务 handler 的数据帧。 */
    readonly type: 'data' | 'control'
    /** 解码后的业务值。 */
    readonly data: Data
  }
  | {
    /** 服务端 ping 控制帧。 */
    readonly type: 'ping'
    /** 解码后的 ping 数据。 */
    readonly data: Data
  }
  | {
    /** 客户端已收到 pong。 */
    readonly type: 'pong'
  }
  | {
    /** 已消费但不应派发的协议帧。 */
    readonly type: 'ignore'
  }
  | {
    /** 不可恢复的协议错误。 */
    readonly type: 'fatal'
    /** 可选稳定原因码，不含原始异常文本。 */
    readonly code?: string
  }

/**
 * 定义一个应用协议的编码与控制帧语义。
 *
 * 适配器函数在连接 runtime 内同步执行，custom 只在自定义 Worker 注册，不能跨 `MessagePort`。`id`、`version` 与
 * `sharedConfig` 共同构成共享连接身份；相同连接 id 的不同协议身份必须被拒绝。
 *
 * @typeParam Incoming 解码与分类后的连接协议值；扩展可将它投影为不同的页面业务类型。
 * @typeParam Outgoing `sendMessage` 接受的业务值。
 */
export interface ProtocolAdapter<Incoming, Outgoing> {
  /** 在 Worker 注册表中查找适配器的稳定 id。 */
  readonly id: string
  /** 参与共享配置冲突检测的正整数版本。 */
  readonly version: number
  /** 参与共享身份的可结构化克隆静态配置；不得含页面秘密。 */
  readonly sharedConfig?: Readonly<Record<string, unknown>>
  /** 编码一次 `sendMessage`；失败会以 `ENCODE_FAILED` 拒绝调用。 */
  encode: (data: Outgoing, context: EncodeContext) => SocketData
  /** 解码一个原始 socket payload；失败会以 `DECODE_FAILED` 处理。 */
  decode: (data: SocketData, context: DecodeContext) => Incoming
  /** 将已解码 payload 分类为业务帧或协议控制帧。 */
  classify: (data: Incoming, context: ClassifyContext) => ProtocolFrame<Incoming>
  /** 生成主动心跳帧；缺失时不支持 SocketFuse heartbeat。 */
  createPing?: (context: HeartbeatContext) => Outgoing
  /** 对分类出的服务端 ping 生成响应；缺失时不自动回复。 */
  createPong?: (ping: ProtocolFrame<Incoming>, context: HeartbeatContext) => Outgoing
  /** 根据已脱敏 close 信息决定是否允许重连；缺失时使用默认策略。 */
  shouldReconnect?: (close: SafeCloseInfo) => boolean
}

/** raw、声明式 JSON 或已在 custom Worker 注册的协议选择。 */
export type ProtocolSelector
  = | 'raw'
    | JsonProtocolOptions
    | CustomProtocolDescriptor

/** 页面引用 Worker 静态注册协议的纯数据描述；函数与凭据不得放入该配置。 */
export interface CustomProtocolDescriptor {
  /** 自定义静态协议类型。 */
  readonly type: 'custom'
  /** 与 Worker 注册项一致的协议 id。 */
  readonly id: string
  /** 与 Worker 注册项一致的正整数版本。 */
  readonly version: number
  /** 参与共享身份的静态非秘密配置。 */
  readonly sharedConfig?: Readonly<Record<string, unknown>>
}

/** 页面和 Worker 显式重连的一次计划输入，不改变共享配置或已用预算。 */
export interface ReconnectRequestOptions {
  /** 默认 true；false 豁免本次计数但不补充以前的预算。 */
  readonly countAsRetry?: boolean
}

/** 引擎、页面、Worker 协议或恢复参与需求的安全触发来源。 */
export type ReconnectSource = 'automatic' | 'page' | 'worker' | 'demand'

/**
 * 页面 client 及其共享物理连接的创建配置。
 *
 * 只能在浏览器页面 realm 调用 `createWebSocket` 时传入。会改变物理 socket 的字段
 * 必须在同一 `id` 下完全一致；页面本地字段不参与共享 fingerprint。无效配置在创建
 * 阶段同步抛出 `SocketFuseError`；只有内联 Worker 初始化失败按 `fallback` 决定拒绝或降级。
 */
export interface CreateWebSocketOptions<Incoming = SocketData, Outgoing = SocketData> {
  /** 同源标签页共享连接的稳定业务 identity；不能为空、最长 1024 字符，且不得包含凭据。 */
  id: string
  /** 原生 WebSocket subprotocol token 或有序 token 列表；默认不传。 */
  protocols?: string | readonly string[]
  /** 页面本地 custom SharedWorker 工厂；默认使用内置 inline Worker。 */
  worker?: () => SharedWorker
  /** 消息协议；默认 raw 适配器。自定义 adapter 必须同时静态注册在 Worker。 */
  protocol?: ProtocolSelector
  /** 内联 Worker 初始化失败策略，默认 `direct`；custom 仅允许 `error`。 */
  fallback?: 'direct' | 'error'
  /** 创建后是否立即异步打开；页面本地，默认 `true`。 */
  immediate?: boolean
  /** 普通页面卸载时是否自动 detach；页面本地，默认 `true`。 */
  autoClose?: boolean
  /** 共享重连策略；省略使用指数退避默认值，关闭自动恢复请设 `automatic: false`。 */
  reconnect?: Partial<ReconnectOptions>
  /** 共享 socket 建连超时，单位毫秒，默认 `10000`。 */
  connectionTimeout?: number
  /** raw 入站在本页面的二进制表示，默认 `arraybuffer`，不参与共享配置冲突判断。 */
  binaryType?: 'arraybuffer' | 'blob'
  /** 共享应用层心跳策略；默认关闭。 */
  heartbeat?: boolean | Partial<HeartbeatOptions>
  /** 共享有界出站队列策略；默认不允许离线或背压入队。 */
  queue?: boolean | Partial<QueueOptions>
  /** 共享原生 socket `bufferedAmount` 阈值。 */
  backpressure?: Partial<BackpressureOptions>
  /** 共享 client 活性租约。 */
  lease?: Partial<LeaseOptions>
  /** 页面本地 freeze/restore 处理；默认关闭。 */
  lifecycle?: LifecycleOptions
  /** 共享物理连接资源上限；不含 Worker 级控制平面上限。 */
  limits?: Partial<ConnectionLimits>
  /** 最后一个 client 离开后关闭物理 socket 前的宽限期，单位毫秒，默认 `5000`。 */
  idleGraceMs?: number
  /** 接收已脱敏运行诊断的页面本地 sink。 */
  logger?: SocketFuseLogger
  /** 逻辑 client open 后调用的页面本地回调。 */
  onConnected?: (client: WebSocketClient<Incoming, Outgoing>, snapshot: ConnectionSnapshot) => void
  /** 逻辑 client close 后调用的页面本地回调。 */
  onDisconnected?: (client: WebSocketClient<Incoming, Outgoing>, event: SocketFuseCloseEvent) => void
  /** 收到已脱敏 `SocketFuseError` 时调用的页面本地回调。 */
  onError?: (client: WebSocketClient<Incoming, Outgoing>, error: SocketFuseError) => void
  /** 初始业务消息回调；创建后仍可通过 `onMessage` 动态增加。 */
  onMessage?: (client: WebSocketClient<Incoming, Outgoing>, event: SocketFuseMessageEvent<Incoming>) => void
}

/**
 * SharedWorker 所有或 direct WebSocket 的页面本地代理。
 *
 * 所有方法仅能在 `createWebSocket` 成功返回后调用。除 `diagnostics` 外，异步方法会以
 * `SocketFuseError` reject；调用方应按稳定 `code` 判断失败，而不是匹配 message。
 *
 * @typeParam Incoming `onMessage` 派发的解码业务 payload。
 * @typeParam Outgoing `sendMessage` 接受的应用值。
 */
export interface WebSocketClient<Incoming = SocketData, Outgoing = SocketData> extends EventTarget {
  /** 最近一次已派发业务 payload；首条消息前为 `null`。 */
  readonly data: Incoming | null
  /** 紧凑的 `CONNECTING`、`OPEN` 或 `CLOSED` 状态。 */
  readonly status: WebSocketStatus
  /** 页面逻辑 client 的详细生命周期状态。 */
  readonly state: ConnectionState
  /** 原生 WebSocket 兼容的数值 readyState。 */
  readonly readyState: ReadyState
  /** 当前选定的 transport。 */
  readonly transport: Transport
  /** inline、custom 或 direct/no Worker 部署方式。 */
  readonly workerMode: WorkerMode
  /**
   * 在未 dispose 阶段打开逻辑 client；并发调用共享同一次物理 open。
   *
   * @param options 可选 AbortSignal；仅取消当前等待者，不会关闭其他 client 的共享连接。
   * @returns 原生 socket 打开时的连接快照。
   * @throws `ABORTED`、`CONNECTION_TIMEOUT`、协议或 transport 的安全错误。
   */
  open: (options?: { signal?: AbortSignal }) => Promise<ConnectionSnapshot>
  /**
   * 关闭当前页面的逻辑参与，但不 dispose 实例；close 后允许再次 `open`。
   *
   * @returns detach 完成的 Promise。
   * @throws transport 控制失败时以 `SocketFuseError` reject。
   */
  close: () => Promise<void>
  /**
   * 在已经 open 表达参与需求且未 close/dispose 阶段提交业务消息，或按配置有界入队。
   *
   * @param data 由选定 adapter 接受的业务值。
   * @param options 本次发送的队列覆盖。
   * @returns 本地 `accepted` 或 `queued` 回执；不代表服务器已收到。
   * @throws `CLIENT_DISCONNECTED`、`SEND_OUTCOME_UNKNOWN`、背压、队列/大小限制或编码错误。
   */
  sendMessage: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  /**
   * 在 client 存活阶段添加一个页面本地业务消息 handler。
   *
   * @param handler 接收业务帧与回放标记的回调；抛出不会阻塞其他 handler 或 Worker。
   * @param options 可选 dispatch key；省略时继续在每个收到帧的页面执行。
   * @returns 幂等移除函数；dispose 后仍可安全调用。
   */
  onMessage: (handler: (event: SocketFuseMessageEvent<Incoming>, context: Readonly<MessageHandlerContext>) => void | Promise<void>, options?: MessageHandlerOptions) => () => void
  /**
   * 查询当前页面是否持有指定 dispatch key。
   *
   * @param key 要查询的业务 key。
   * @returns 最近经本地 lease 检查的分派资格；不是跨页面副作用执行锁，回放不使用该资格。
   */
  isDispatchOwner: (key: string) => boolean
  /**
   * 注册当前 client 唯一的重连准备 hook，Worker 扩展准备存在时不参与。
   *
   * @param handler 可异步更新当前计划 URL 与 delay 的页面函数。
   * @returns 幂等注销函数；新注册会替换当前页面旧 hook。
   */
  onBeforeReconnect: (handler: BeforeReconnectHandler) => () => void
  /**
   * 在 client 已参与且未 close/dispose 时接纳或加入共享重连计划。
   *
   * @param options 是否占用共享重试预算，默认计数；不计数不重置已用次数。
   * @returns 重连请求被接纳后的 Promise，不代表 socket 已 open。
   * @throws 失去参与、预算耗尽、计数策略冲突、过期计划、终止性协议或 transport 错误。
   */
  reconnect: (options?: ReconnectRequestOptions) => Promise<void>
  /**
   * 返回当前已脱敏运行指标；任意 client 状态均可调用。
   *
   * @returns 不含 URL query、业务 payload 或内部堆栈的最近异步样本；observedAt 为本页接收时刻。
   */
  diagnostics: () => Readonly<ConnectionDiagnostics>
  /**
   * 永久释放该页面 client、handler 与 transport 参与；dispose 后不能再次 open。
   *
   * @returns 本地清理与 detach 完成的 Promise。
   * @throws transport 清理异常会以安全 `SocketFuseError` reject，但本地终态仍保持 dispose。
   */
  dispose: () => Promise<void>
}
