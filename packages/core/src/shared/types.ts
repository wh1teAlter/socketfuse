/**
 * SocketFuse 跨运行时的公开类型契约。
 *
 * 这里不拥有连接或页面生命周期，只定义页面、Worker 和协议适配器必须共同遵守的
 * 数据形状、单位和调用阶段；上层模块不得通过重复定义这些类型改变其语义。
 */
import type { SocketFuseError } from './errors'

/** 浏览器原生 WebSocket 与 raw 协议可收发的 payload 类型。 */
export type SocketData = string | Blob | ArrayBuffer | ArrayBufferView
/** 兼容浏览器和测试注入时钟的定时器句柄。 */
export type TimerHandle = number | ReturnType<typeof setTimeout>

/** 由详细连接状态推导出的紧凑 VueUse 风格状态。 */
export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED'

/** 页面逻辑 client 的详细生命周期状态。 */
export type ConnectionState
  = | 'idle'
    | 'connecting'
    | 'handshaking'
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

/** 选定协议适配器实现的能力集合。 */
export interface ProtocolCapabilities {
  /** 是否能根据 revision 生成认证帧。 */
  readonly auth: boolean
  /** 是否能生成和识别应用层心跳帧。 */
  readonly heartbeat: boolean
  /** 是否能安全处理二进制 WebSocket payload。 */
  readonly binary: boolean
}

/** 多标签页共享的重连策略；所有时间字段单位均为毫秒。 */
export interface ReconnectOptions {
  /** 最大重试次数；`Infinity` 表示不设上限，默认值为 `Infinity`。 */
  retries: number
  /** 指数退避的起始延迟，默认值为 `1000`。 */
  initialDelay: number
  /** 单次重试允许的最大延迟，默认值为 `30000`。 */
  maxDelay: number
  /** 每次重试的指数乘数，默认值为 `2`。 */
  factor: number
  /** 取值范围为 `0` 到 `1` 的随机抖动比例，默认值为 `0.2`。 */
  jitter: number
  /** 连接连续保持 open 多久后重置重试计数，默认值为 `30000`。 */
  stableThreshold: number
}

/** 多标签页共享的应用层心跳策略；时间字段单位均为毫秒。 */
export interface HeartbeatOptions {
  /** `pong` 要求应答，`activity` 则以任意入站活动续命。 */
  mode: 'pong' | 'activity'
  /** 两次心跳发送之间的间隔。 */
  interval: number
  /** `pong` 模式等待应答的最长时间。 */
  pongTimeout: number
  /** 发送给服务端的原生 WebSocket payload。 */
  message: SocketData
  /** 在 `pong` 模式下被视为应答的原生 payload。 */
  responseMessage: SocketData
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
  /** Worker 可接受的 MessagePort 总数上限。 */
  maxPorts: number
  /** 单个 page-to-Worker 控制 envelope 的最大结构化克隆字节数。 */
  maxControlEnvelopeBytes: number
  /** 端口建立后未完成 hello 时的回收时限，单位为毫秒。 */
  unattachedPortTimeoutMs: number
}

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
  /** 随排队消息保留的业务幂等键；SocketFuse 不将其解释为服务端 Ack。 */
  idempotencyKey?: string
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

/** 单调 endpoint/auth revision 更新的结果。 */
export type RevisionReceipt
  = | {
    /** 新 revision 已应用。 */
    readonly status: 'applied'
    /** 生效的正安全整数 revision。 */
    readonly revision: number
  }
  | {
    /** revision 早于当前值，状态未改变。 */
    readonly status: 'stale'
    /** 当前已知 revision。 */
    readonly revision: number
  }
  | {
    /** revision 与当前值相同，状态未改变。 */
    readonly status: 'unchanged'
    /** 已存在的 revision。 */
    readonly revision: number
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
  /** 当前物理连接尝试的单调计数。 */
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
  /** 只含原始值白名单的附加信息；不含凭据与 payload。 */
  readonly details?: Readonly<Record<string, unknown>>
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
  /** 当前重连尝试次数。 */
  readonly retryAttempt: number
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

/** `$auth` 或 `$auth.` 开头的字符串会在生成认证帧时从 auth 数据替换。 */
export interface JsonAuthTemplate {
  /** 可含 auth 占位符的认证业务帧模板。 */
  readonly template: JsonValue
}

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
  /** 可选的稳定适配器 id；默认使用内置 JSON id。 */
  readonly id?: string
  /** 可选的适配器 major 版本；变更会触发共享配置冲突。 */
  readonly version?: number
  /** 将入站帧标记为 ready 的匹配器。 */
  readonly ready?: JsonMatcher
  /** 根据最新 auth revision 生成认证帧的模板。 */
  readonly auth?: JsonAuthTemplate
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

/** 调用适配器认证帧工厂时附加的上下文。 */
export interface AuthContext extends ProtocolContext {
  /** 当前被应用的认证 revision。 */
  readonly revision: number
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
    readonly type: 'data'
    /** 解码后的业务值。 */
    readonly data: Data
  }
  | {
    /** 表示协议握手已完成。 */
    readonly type: 'ready'
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

/** 允许协议适配器同步或异步完成的结果包装。 */
export type MaybePromise<Value> = Value | Promise<Value>

/**
 * 定义一个应用协议的编码与控制帧语义。
 *
 * 适配器函数只能在 custom Worker 内执行，不能跨 `MessagePort`。`id`、`version`、
 * capabilities、ready 语义与 `sharedConfig` 共同构成共享连接身份；相同 `id` 的
 * 不同身份必须被拒绝，不能静默复用。
 *
 * @typeParam Incoming 解码后派发给页面监听器的业务 payload。
 * @typeParam Outgoing `sendMessage` 接受的业务值。
 * @typeParam Auth `updateAuth` 接受的带 revision 认证值。
 */
export interface ProtocolAdapter<Incoming, Outgoing, Auth = unknown> {
  /** 在 Worker 注册表中查找适配器的稳定 id。 */
  readonly id: string
  /** 参与共享配置冲突检测的正整数版本。 */
  readonly version: number
  /** 声明可用的 auth、heartbeat 与 binary 能力。 */
  readonly capabilities: ProtocolCapabilities
  /** 参与共享身份的可结构化克隆静态配置；不得含页面秘密。 */
  readonly sharedConfig?: Readonly<Record<string, unknown>>
  /** socket open 即 ready，或必须等待 adapter 分类出的 ready 帧。 */
  readonly readyWhen?: 'socket-open' | 'adapter-frame'
  /** 编码一次 `sendMessage`；失败会以 `ENCODE_FAILED` 拒绝调用。 */
  encode: (data: Outgoing, context: EncodeContext) => MaybePromise<SocketData>
  /** 解码一个原始 socket payload；失败会以 `DECODE_FAILED` 处理。 */
  decode: (data: SocketData, context: DecodeContext) => MaybePromise<Incoming>
  /** 将已解码 payload 分类为业务帧或协议控制帧。 */
  classify: (data: Incoming, context: ClassifyContext) => MaybePromise<ProtocolFrame<Incoming>>
  /** 在 open 前根据最新 auth revision 生成认证帧；缺失时不支持 auth 更新。 */
  createAuth?: (auth: Auth, context: AuthContext) => MaybePromise<Outgoing | readonly Outgoing[]>
  /** 生成主动心跳帧；缺失时不支持 SocketFuse heartbeat。 */
  createPing?: (context: HeartbeatContext) => MaybePromise<Outgoing>
  /** 对分类出的服务端 ping 生成响应；缺失时不自动回复。 */
  createPong?: (ping: ProtocolFrame<Incoming>, context: HeartbeatContext) => MaybePromise<Outgoing>
  /** 根据已脱敏 close 信息决定是否允许重连；缺失时使用默认策略。 */
  shouldReconnect?: (close: SafeCloseInfo) => boolean
}

/** raw、声明式 JSON 或已在 custom Worker 注册的协议选择。 */
export type ProtocolSelector<Incoming, Outgoing, Auth>
  = | 'raw'
    | JsonProtocolOptions
    | ProtocolAdapter<Incoming, Outgoing, Auth>

/**
 * 页面 client 及其共享物理连接的创建配置。
 *
 * 只能在浏览器页面 realm 调用 `createWebSocket` 时传入。会改变物理 socket 的字段
 * 必须在同一 `id` 下完全一致；页面本地字段不参与共享 fingerprint。无效配置在创建
 * 阶段同步抛出 `SocketFuseError`，Worker 构造/握手失败按 `fallback` 决定拒绝或降级。
 */
export interface CreateWebSocketOptions<Incoming = SocketData, Outgoing = SocketData, Auth = unknown> {
  /** 同源标签页共享连接的稳定业务 identity；不能为空，且不得包含凭据。 */
  id: string
  /** 原生 WebSocket subprotocol token 或有序 token 列表；默认不传。 */
  protocols?: string | readonly string[]
  /** 页面本地 custom SharedWorker 工厂；默认使用内置 inline Worker。 */
  worker?: () => SharedWorker
  /** 消息协议；默认 raw 适配器。自定义 adapter 必须同时静态注册在 Worker。 */
  protocol?: ProtocolSelector<Incoming, Outgoing, Auth>
  /** Worker 构造或初始化失败时的页面本地策略；默认 `direct`。 */
  fallback?: 'direct' | 'error'
  /** 创建后是否立即异步打开；页面本地，默认 `true`。 */
  immediate?: boolean
  /** 普通页面卸载时是否自动 detach；页面本地，默认 `true`。 */
  autoClose?: boolean
  /** 共享重连策略；`true` 或省略使用指数退避默认值。 */
  autoReconnect?: boolean | Partial<ReconnectOptions>
  /** 共享 socket open 与 adapter handshake 共用的超时，单位毫秒，默认 `10000`。 */
  connectionTimeout?: number
  /** 共享二进制接收表示，默认 `arraybuffer`。 */
  binaryType?: 'arraybuffer' | 'blob'
  /** 共享心跳策略；默认关闭，且必须由协议 adapter 声明支持。 */
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
  onConnected?: (client: WebSocketClient<Incoming, Outgoing, Auth>, snapshot: ConnectionSnapshot) => void
  /** 逻辑 client close 后调用的页面本地回调。 */
  onDisconnected?: (client: WebSocketClient<Incoming, Outgoing, Auth>, event: SocketFuseCloseEvent) => void
  /** 收到已脱敏 `SocketFuseError` 时调用的页面本地回调。 */
  onError?: (client: WebSocketClient<Incoming, Outgoing, Auth>, error: SocketFuseError) => void
  /** 初始业务消息回调；创建后仍可通过 `onMessage` 动态增加。 */
  onMessage?: (client: WebSocketClient<Incoming, Outgoing, Auth>, event: SocketFuseMessageEvent<Incoming>) => void
}

/**
 * SharedWorker 所有或 direct WebSocket 的页面本地代理。
 *
 * 所有方法仅能在 `createWebSocket` 成功返回后调用。除 `diagnostics` 外，异步方法会以
 * `SocketFuseError` reject；调用方应按稳定 `code` 判断失败，而不是匹配 message。
 *
 * @typeParam Incoming `onMessage` 派发的解码业务 payload。
 * @typeParam Outgoing `sendMessage` 接受的应用值。
 * @typeParam Auth `updateAuth` 接受的带 revision 认证值。
 */
export interface WebSocketClient<Incoming = SocketData, Outgoing = SocketData, Auth = unknown> extends EventTarget {
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
  /** 选定协议 adapter 声明的能力。 */
  readonly capabilities: ProtocolCapabilities
  /**
   * 在未 dispose 阶段打开逻辑 client；并发调用共享同一次物理 open。
   *
   * @param options 可选 AbortSignal；仅取消当前等待者，不会关闭其他 client 的共享连接。
   * @returns socket 与协议均 ready 时的连接快照。
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
   * 在已创建且未 dispose 阶段提交一条业务消息，或在配置允许时将其有界入队。
   *
   * @param data 由选定 adapter 接受的业务值。
   * @param options 本次发送的队列覆盖和业务幂等键。
   * @returns 本地 `accepted` 或 `queued` 回执；不代表服务器已收到。
   * @throws `SEND_WHILE_DISCONNECTED`、`BACKPRESSURE`、队列/大小限制或编码错误。
   */
  sendMessage: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  /**
   * 在 client 存活阶段添加一个页面本地业务消息 handler。
   *
   * @param handler 接收业务帧与回放标记的回调；抛出不会阻塞其他 handler 或 Worker。
   * @returns 幂等移除函数；dispose 后仍可安全调用。
   */
  onMessage: (handler: (event: SocketFuseMessageEvent<Incoming>) => void) => () => void
  /**
   * 以更大的单调 revision 应用认证数据；仅在 adapter 声明 auth 能力时可用。
   *
   * @param auth 不会写入诊断或跨 client 暴露的认证值。
   * @param options 共享 auth register 的正整数 revision。
   * @returns applied、stale 或 unchanged revision 回执。
   * @throws `CAPABILITY_UNSUPPORTED`、`CLIENT_DISPOSED` 或 transport 错误。
   */
  updateAuth: (auth: Auth, options: { revision: number }) => Promise<RevisionReceipt>
  /**
   * 以更大的 revision 清除认证与该页面拥有的待发业务数据。
   *
   * @param options 共享 auth register 的正整数 revision。
   * @returns applied、stale 或 unchanged revision 回执。
   * @throws `CAPABILITY_UNSUPPORTED`、`CLIENT_DISPOSED` 或 transport 错误。
   */
  clearAuth: (options: { revision: number }) => Promise<RevisionReceipt>
  /**
   * 以更大的 revision 更新共享 endpoint；必要时取消旧连接尝试并重连。
   *
   * @param url 新的绝对 `ws:` 或 `wss:` URL。
   * @param options 共享 endpoint register 的正整数 revision。
   * @returns applied、stale 或 unchanged revision 回执。
   * @throws `INVALID_OPTIONS`、`CLIENT_DISPOSED` 或 transport 错误。
   */
  updateUrl: (url: string | URL, options: { revision: number }) => Promise<RevisionReceipt>
  /**
   * 在 client 未 dispose 时显式开始新的共享连接尝试。
   *
   * @param options 可安全记录的调用原因；不会作为服务端 payload 发送。
   * @returns 重连请求被接纳后的 Promise，不代表 socket 已 open。
   * @throws `CLIENT_DISPOSED` 或 transport 控制错误。
   */
  reconnect: (options?: { reason?: string }) => Promise<void>
  /**
   * 返回当前已脱敏运行指标；任意 client 状态均可调用。
   *
   * @returns 不含 auth、URL query、业务 payload 或内部堆栈的快照。
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
