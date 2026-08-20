# WWS v1 技术与产品规格

- 状态：Draft / to-spec 已完成，待进入 to-tickets
- 版本：v1 draft 1
- 日期：2026-08-19
- 前置调研：[SharedWorker WebSocket 方案调研与决策清单](../planning/01-sharedworker-websocket-grill.md)

## 1. 规范语言

本文中的“必须（MUST）”“不得（MUST NOT）”“应该（SHOULD）”“不应该（SHOULD NOT）”和“可以（MAY）”表示实现与验收强度。除明确标为 SHOULD/MAY 的项目外，所有规范都属于 v1 发布门槛。

## 2. 产品定义

WWS 是浏览器端、framework-agnostic、SharedWorker-first 的 WebSocket 传输库。对于同源、同一浏览器 profile 和同一存储分区中的页面，它按照显式连接 id 复用物理 WebSocket，同时提供直接 WebSocket 降级、连接恢复、消息广播、有界排队和可观测性。

v1 的发布名确认为 wws，许可证暂定为 MIT。许可证在本规格对齐时仍可调整，不影响运行时设计。

### 2.1 核心目标

- 同一 SharedWorker 实例内，相同连接 id 和相同共享配置最多存在一个物理 WebSocket。
- 不同页面可以独立发送和消费消息，页面退出不会错误关闭其他页面仍在使用的连接。
- SharedWorker 不可用或初始化失败时，调用方可以选择每页直连或显式失败。
- 核心覆盖现代 WebSocket 客户端的传输能力，但不把特定服务端协议冒充为通用 WebSocket 行为。
- 所有共享状态、失败语义和资源上限必须明确、可诊断、可测试。

### 2.2 非目标

v1 不提供：

- WebSocket 服务端。
- 跨 origin、跨浏览器 profile、普通/无痕窗口之间的连接共享。
- 所有页面关闭后的后台常驻连接。
- Socket.IO、Centrifuge、STOMP 或 graphql-ws 的内置兼容实现。
- exactly-once 投递、离线历史补偿或服务端消息恢复；这些能力需要服务端协议支持。
- Service Worker transport。
- BroadcastChannel/Web Locks leader-election transport。
- React、Vue、Nuxt、RxJS 等框架绑定。
- Node.js WebSocket 客户端运行时。
- CommonJS、IIFE 或 UMD 发布物。

## 3. 平台与兼容性

### 3.1 主通道

SharedWorker transport 必须使用原生 WebSocket。默认 inline 模式使用自包含 classic data: SharedWorker；custom 模式推荐使用同源 module SharedWorker。支持基线为：

- Chromium/Edge 当前稳定版本。
- Firefox 当前稳定版本。
- Safari/iOS Safari 16+。
- 支持所选 Worker 模式的更新移动浏览器和 WebView。

CI 的真实浏览器 E2E 必须覆盖 Playwright Chromium、Firefox 和 WebKit 当前稳定版本。移动浏览器支持以兼容性文档和 direct fallback 为主，不得仅凭 User-Agent 推断。

### 3.2 降级通道

direct transport 必须使用原生 WebSocket，并复用与 SharedWorker transport 相同的连接状态机、adapter、重连、心跳、队列和错误语义。它只改变物理连接的所有者和共享范围：

- shared-worker：跨同源页面共享。
- direct：只在当前页面 JavaScript realm 内共享。

### 3.3 SSR 与非浏览器环境

- 所有公开入口在模块求值阶段不得访问 window、document、self、navigator、SharedWorker 或 WebSocket。
- 在 Node.js/SSR 中 import 必须成功。
- 在无浏览器能力的环境实际创建或连接 client 时，必须抛出 ENVIRONMENT_UNSUPPORTED。
- WWS 不承诺在 Node.js 中建立 WebSocket。

## 4. Monorepo 与发布边界

仓库必须使用 pnpm 10 workspace，不引入 npm、Yarn 或 Turborepo。

    packages/
    ├── wws/          # 唯一 v1 公开包
    ├── core/         # 私有状态机、控制协议、队列与连接池
    ├── test/         # 私有跨包、E2E 辅助和 tarball consumer 测试
    ├── docs/         # 私有 VitePress/TypeDoc 工程
    └── playground/   # 私有多 tab 交互与性能示例

### 4.1 pnpm 约束

- 根目录必须包含 pnpm-workspace.yaml 和唯一 pnpm-lock.yaml。
- 根 package.json 必须固定 packageManager 为实现时采用的 pnpm 10 精确版本。
- 仓库开发与 CI Node.js 基线为 ^22.18.0 或 >=24.11.0。
- 共享工具版本必须通过 pnpm catalog 管理。
- 内部依赖必须使用 workspace 协议。
- CI 安装必须使用 pnpm install --frozen-lockfile。
- 根脚本必须至少提供 lint、typecheck、test、test:e2e、build、docs:check、release:verify 和 check。
- TypeScript 使用 catalog 中的 @typescript/native；所有正式源码开启 strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes、verbatimModuleSyntax 和 isolatedModules。

### 4.2 公开入口

wws 必须为 ESM-only，并提供：

    wws
    wws/protocol
    wws/worker

- 根入口导出页面 client、事件、状态、错误和内置协议 selector。
- protocol 导出业务协议 adapter 契约和内置 adapter。
- worker 导出 createSharedWebSocketRuntime 与 exposeSharedWebSocketWorker。
- 公开包必须生成 TypeScript declarations 和 sourcemap。
- 公开包必须声明 sideEffects: false。
- 私有 @wws/core 必须 bundle 进公开入口，公开 tarball 不得引用私有 workspace 包。
- v1 核心运行时应该保持零第三方 runtime dependency。

### 4.3 构建与发行验证

- tsdown 必须以 browser platform、ESM、ES2022 target 构建多入口和声明文件。
- tsdown 必须执行 publint 与 arethetypeswrong 验证，profile 使用 ESM-only。
- release:verify 必须 pack 真实 tarball，在临时 Vite consumer 中安装并验证 import、类型、构建和 Worker 加载。
- Changesets 管理公开包版本；提交信息使用 Conventional Commits。
- 未经明确授权不得自动 publish、创建 tag 或 GitHub Release。

## 5. 运行时架构

### 5.1 拓扑

    Page client A ─┐
    Page client B ─┼─ MessagePort ─ SharedWorker runtime
    Page client C ─┘                   ├─ pool[key A] ─ WebSocket A
                                      └─ pool[key B] ─ WebSocket B

同一个 SharedWorker runtime 可以维护多个连接 id。WWS 不得把“同源只允许一条连接”写死为全局约束。

### 5.2 页面职责

页面运行时必须负责：

- transport 初始化与版本握手。
- 逻辑 client 生命周期和页面内监听器。
- open/close/reconnect/dispose、AbortSignal 和调用超时。
- page lease 心跳与 pageshow/pagehide/visibility 恢复。
- 可选的页面 suspend/restore 感知与当前 client 入站消息回放。
- endpoint/auth revision 的本地最新状态与恢复重放。
- EventTarget 和 onMessage handler。
- direct transport 的页面内连接池。
- 把 Worker 诊断转换为公开、脱敏的事件。

### 5.3 Worker 职责

Worker runtime 必须负责：

- 连接 id 到 ConnectionController 的连接池。
- 共享配置指纹与冲突检测。
- WebSocket 构造、连接超时、协议握手、重连与心跳。
- adapter 执行、消息解码、分类和广播。
- 有界发送队列与 bufferedAmount 水位。
- 每个 client 的 suspend/restore 状态、有界回放缓冲和溢出计数。
- client lease、异常消失回收和空闲关闭。
- 控制协议运行时校验、稳定错误码和脱敏诊断。

## 6. 连接身份与共享配置

### 6.1 连接 id

调用方必须显式提供非空 id。它用于区分用户、租户或业务连接，例如：

    realtime:tenant-a:user-42

id：

- 不得包含 access token、cookie、签名 URL 或其他凭据。
- 不作为授权依据。
- 默认不得原样写入日志；诊断使用稳定 hash。
- 在同一个 Worker 中只标识一个共享配置。

### 6.2 共享配置指纹

Worker 必须对以下规范化静态配置计算稳定指纹：

- 有序 subprotocol 列表。
- adapter id、major version 和 sharedConfig。
- binaryType。
- reconnect、heartbeat、queue、backpressure 和 idle/lease 中影响共享行为的选项。
- resource limits 和 idle grace。

endpoint 使用独立的 revisioned register；当前 endpoint hash 可以进入有效配置诊断，但不进入静态指纹。auth 值、auth revision、client id 和本地 listener 也不进入静态指纹。

相同 id 提交不同指纹时：

- Worker 必须拒绝后加入的 client。
- 必须返回 CONNECTION_CONFIG_CONFLICT。
- 不得使用 first-tab-wins、last-tab-wins 或静默合并。
- 既有连接和既有 client 不受影响。

首次 attach 的 URL 视为 endpoint revision 0：

- Worker 尚无该 key 时，保存 URL 与 revision 0。
- Worker 当前也是 revision 0 且 URL 不同时，返回 CONNECTION_CONFIG_CONFLICT。
- Worker 已有更高 endpoint revision 时，允许带旧初始 URL 的新页面 attach，并向它返回当前 endpoint revision；旧值不得覆盖新值。
- updateUrl 使用第 12 节的 revision 规则。

### 6.3 Worker 实例身份

- 实际共享边界由浏览器的 SharedWorker 脚本 URL 和浏览器实现决定。
- 所有希望共享连接的页面必须使用相同、同源、稳定的 Worker URL。
- v1 不依赖 SharedWorker options.name 区分协议版本。
- 控制协议 major 发生破坏性变化时，应用必须部署新的 Worker URL。

## 7. 公开页面 API

以下类型是规范性 API 形状；具体辅助类型可在不改变语义的前提下拆分。

### 7.1 创建

    interface CreateWebSocketOptions<
      Incoming = SocketData,
      Outgoing = SocketData,
      Auth = unknown,
    > {
      id: string
      protocols?: string | readonly string[]
      worker?: () => SharedWorker
      protocol?:
        | 'raw'
        | JsonProtocolOptions
        | ProtocolAdapter<Incoming, Outgoing, Auth>
      fallback?: 'direct' | 'error'
      immediate?: boolean
      autoClose?: boolean
      autoReconnect?: boolean | Partial<ReconnectOptions>
      connectionTimeout?: number
      binaryType?: 'arraybuffer' | 'blob'
      heartbeat?: false | Partial<HeartbeatOptions>
      queue?: boolean | Partial<QueueOptions>
      backpressure?: Partial<BackpressureOptions>
      lease?: Partial<LeaseOptions>
      lifecycle?: LifecycleOptions
      limits?: Partial<ResourceLimits>
      idleGraceMs?: number
      logger?: WwsLogger
      onConnected?: (
        client: WebSocketClient<Incoming, Outgoing, Auth>,
        snapshot: ConnectionSnapshot,
      ) => void
      onDisconnected?: (
        client: WebSocketClient<Incoming, Outgoing, Auth>,
        event: WwsCloseEvent,
      ) => void
      onError?: (
        client: WebSocketClient<Incoming, Outgoing, Auth>,
        error: WwsError,
      ) => void
      onMessage?: (
        client: WebSocketClient<Incoming, Outgoing, Auth>,
        event: WwsMessageEvent<Incoming>,
      ) => void
    }

    interface LifecycleOptions {
      restore?: boolean | RestoreOptions
    }

    interface RestoreOptions {
      replay?: boolean
      maxMessages?: number
      maxBytes?: number
    }

    function createWebSocket<Incoming, Outgoing, Auth = unknown>(
      url: string | URL,
      options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
    ): WebSocketClient<Incoming, Outgoing, Auth>

规则：

- fallback 默认 direct。
- immediate 默认 true。
- autoClose 默认 true；页面卸载时只 detach 当前逻辑 client，不直接关闭其他 tab 使用的共享连接。
- autoReconnect 默认 true，是重连总开关；false 时意外断开进入 closed，不创建重连 timer。
- autoReconnect 对象只接受可结构化克隆的 retries、initialDelay、maxDelay、factor、jitter 和 stableThreshold，不接受函数。
- connectionTimeout 默认 10,000 ms。
- binaryType 默认 arraybuffer。
- lifecycle.restore 默认 false；它是当前逻辑 client 的本地行为，不参与同 id 的共享配置冲突指纹。
- lifecycle.restore: true 启用页面隐藏/冻结后的自动暂停与重新激活后的恢复，但默认不回放暂停期间错过的消息。
- lifecycle.restore: { replay: true } 等价于启用 restore 并额外启用有界消息回放，默认上限为 256 条或 4 MiB，以先到者为准。
- restore 回放不需要业务注册额外事件；回放消息照常进入 onMessage() 和 message 事件，并带 replayed: true 标记。
- 未传 worker 时使用 WWS 内置、内容稳定的 data: SharedWorker，workerMode 为 inline。
- 传入 worker factory 时使用调用方创建的 SharedWorker，workerMode 为 custom；factory 只在浏览器中、选择 shared-worker transport 时执行。
- 未传 protocol 时使用 raw；protocol: 'raw' 与省略等价。
- 声明式 JSON 直接传 protocol: { type: 'json', ... }，不通过 json()、createJsonProtocol() 等工厂生成。
- inline 模式只接受 raw 或声明式 JSON protocol。
- 自定义 ProtocolAdapter 对象必须与 custom worker 一起使用，并在 Worker 入口静态注册。
- options 必须在创建时验证；非法值同步抛出 INVALID_OPTIONS。
- 自定义 ProtocolAdapter 对象留在页面用于 direct transport；传给 Worker 的只能是 adapter id/version 和可结构化克隆的配置。

### 7.2 Client

    type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED'

    interface WebSocketClient<Incoming, Outgoing, Auth> extends EventTarget {
      readonly data: Incoming | null
      readonly status: WebSocketStatus
      readonly state: ConnectionState
      readonly readyState: ReadyState
      readonly transport: 'pending' | 'shared-worker' | 'direct'
      readonly workerMode: 'inline' | 'custom' | 'none'
      readonly capabilities: ProtocolCapabilities

      open(options?: { signal?: AbortSignal }): Promise<ConnectionSnapshot>
      close(): Promise<void>
      sendMessage(data: Outgoing, options?: SendOptions): Promise<SendReceipt>
      onMessage(
        handler: (event: WwsMessageEvent<Incoming>) => void,
      ): () => void
      updateAuth(auth: Auth, options: { revision: number }): Promise<RevisionReceipt>
      clearAuth(options: { revision: number }): Promise<RevisionReceipt>
      updateUrl(url: string | URL, options: { revision: number }): Promise<RevisionReceipt>
      reconnect(options?: { reason?: string }): Promise<void>
      diagnostics(): Readonly<ConnectionDiagnostics>
      dispose(): Promise<void>
    }

语义：

- createWebSocket 返回一个稳定的 WebSocketClient 实例，文档示例统一命名为 ws；实例状态变化不会替换该对象。
- data 是当前逻辑 client 收到的最近一条业务消息；初始为 null，ping/pong/ready/ignore 等内部帧不得覆盖它。它是只读快照 getter，不是 Vue Ref。
- status 提供与 VueUse 相似的简单状态；state 提供 WWS 的详细状态。两者都必须通过 client 属性读取，解构普通值不会获得响应式更新。
- open 幂等；多个等待者共享同一次连接尝试。它在 protocol 宣告连接 ready 后 resolve。
- open 的 AbortSignal 只取消该调用者的等待和当前 client 的新增 demand，不得取消其他 client 仍需要的共享连接。
- close 幂等，只释放当前逻辑 client 的连接需求，不接受 WebSocket code/reason，也不关闭其他 client 仍在使用的物理连接。
- close 清理当前实例的待发队列；保留实例事件/onMessage handler，实例之后可以再次 open。
- dispose 是终态且幂等，移除当前 client 的队列所有权；之后调用方法返回 CLIENT_DISPOSED。
- reconnect 明确重启共享物理连接并影响相同 id 的所有 client；所有 client 都收到状态和 diagnostic 事件。
- 不提供 getWebSocket。物理对象不在页面线程，任意页面都不得直接修改或关闭它。
- onMessage 可以在实例生命周期内动态调用任意次数；每个 handler 独立接收后续业务消息，并返回幂等的取消注册函数。
- 同一 handler 重复注册视为不同注册，每个返回值只取消对应注册。
- onMessage handler 只接收注册完成后的消息，不因初次注册回放 data；启用 lifecycle.restore.replay 后的恢复回放属于显式配置的后续消息，需要读取最近值时直接访问 ws.data。
- handler 在消息分发期间新增时从下一条消息生效；取消后不得再接收新消息。
- 单个 handler 抛错不得阻止其他 handler、EventTarget listener 或 transport 状态机。
- options.onConnected/onDisconnected/onError/onMessage 是实例事件 API 的创建期便捷配置；onMessage 语义与 ws.onMessage 相同。

### 7.3 状态

    type ConnectionState =
      | 'idle'
      | 'connecting'
      | 'handshaking'
      | 'open'
      | 'reconnecting'
      | 'closing'
      | 'closed'
      | 'failed'

    type ReadyState = 0 | 1 | 2 | 3

readyState 映射遵循浏览器 WebSocket：connecting/handshaking/reconnecting 为 0，open 为 1，closing 为 2，idle/closed/failed 为 3。

status 映射为：connecting/handshaking/reconnecting → CONNECTING，open → OPEN，其余 → CLOSED。

逻辑 client 已 close 时必须显示 CLOSED，即使其他 client 仍使物理连接保持 open。

### 7.4 事件

Client 必须支持 addEventListener/removeEventListener，并发出：

- statechange：包含前后状态、transport、attempt 和原因码。
- open：协议已 ready。
- message：包含 data、receivedAt、transport 和 replayed。
- close：包含 code、wasClean、terminal 和 willReconnect；默认不暴露未经清理的 reason。
- error：包含 WwsError。
- diagnostic：包含结构化、脱敏诊断事件。
- overflow：包含队列方向、策略和计数，不包含 payload。

事件 listener 抛出的异常不得破坏 transport 状态机或阻止其他 listener。

## 8. Worker 入口与业务协议 adapter

### 8.1 默认 inline Worker

未提供 worker factory 时，WWS 必须使用构建时生成、自包含且内容稳定的 data: URL 创建 classic SharedWorker：

- 相同 WWS 版本的 data: URL 字符串值必须完全相同，使同一存储分区中的 tab 能复用 Worker。
- 不得使用 URL.createObjectURL() 生成默认 Blob URL，因为不同 tab 会得到不同 constructor URL。
- inline Worker 必须内置完整 runtime、raw 协议和声明式 JSON adapter，不得在运行时从 CDN 导入脚本。
- inline Worker 具有 opaque origin；文档必须显著说明 WebSocket Origin: null、Cookie/SameSite、CSP worker-src 和 Trusted Types 限制。
- inline 初始化因 CSP、Trusted Types 或浏览器行为失败时，按 fallback 规则处理。
- socket 建连或鉴权失败不得被误判为 inline 初始化失败，也不得因此切换 direct。
- workerMode 必须为 inline。

### 8.2 自定义 Worker 入口

需要同源 Origin/Cookie、严格 CSP、自定义 adapter 或稳定微前端部署时，应用提供显式 Worker 入口：

    import { exposeSharedWebSocketWorker } from 'wws/worker'
    import { chatProtocol } from './chat-protocol'

    exposeSharedWebSocketWorker({
      controlProtocolVersion: 1,
      protocols: {
        chat: chatProtocol,
      },
    })

页面创建示例：

    const client = createWebSocket('wss://api.example.com/realtime', {
      id: 'realtime:tenant-a:user-42',
      worker: () => new SharedWorker(
        new URL('./wws.worker.ts', import.meta.url),
        { type: 'module' },
      ),
      protocol: chatProtocol,
    })

Worker 脚本必须：

- 同源部署并返回正确 JavaScript MIME。
- 允许应用通过 CSP worker-src 加载。
- 在多个独立 SPA/微前端场景使用由 shell 统一部署的固定 URL。
- workerMode 必须为 custom。

### 8.3 声明式 JSON 配置

    interface JsonProtocolOptions {
      type: 'json'
      id?: string
      version?: number
      ready?: JsonMatcher
      auth?: JsonAuthTemplate
      heartbeat?: JsonHeartbeatTemplate
      ignore?: readonly JsonMatcher[]
    }

规则：

- id 默认 json，version 默认 1。
- 所有 matcher/template 都必须由 JSON 值、字段路径和占位符构成，必须可结构化克隆。
- 配置中出现函数、symbol、DOM 对象或循环引用时同步返回 INVALID_OPTIONS。
- 字段路径、matcher、template 和占位符的完整语法必须在 to-tickets 前固化，并有 runtime validation 与 golden test。
- 同一 id/version 的不同 JSON 配置必须产生不同 sharedConfig 指纹，不能错误复用。

### 8.4 Adapter 基础契约

    interface ProtocolAdapter<Incoming, Outgoing, Auth = unknown> {
      readonly id: string
      readonly version: number
      readonly capabilities: ProtocolCapabilities
      readonly sharedConfig?: Readonly<Record<string, unknown>>
      readonly readyWhen?: 'socket-open' | 'adapter-frame'

      encode(data: Outgoing, context: EncodeContext): MaybePromise<SocketData>
      decode(data: SocketData, context: DecodeContext): MaybePromise<Incoming>
      classify(
        data: Incoming,
        context: ClassifyContext,
      ): MaybePromise<ProtocolFrame<Incoming>>

      createAuth?(auth: Auth, context: AuthContext): MaybePromise<Outgoing | readonly Outgoing[]>
      createPing?(context: HeartbeatContext): MaybePromise<Outgoing>
      createPong?(ping: ProtocolFrame<Incoming>, context: HeartbeatContext): MaybePromise<Outgoing>
      shouldReconnect?(close: SafeCloseInfo): boolean
    }

ProtocolFrame 至少支持：

- data：普通业务消息。
- ready：业务握手/鉴权完成。
- ping：服务端应用层 ping。
- pong：客户端 ping 的响应。
- ignore：内部帧，不交付页面。
- fatal：协议或鉴权终止错误。

规则：

- Adapter 函数在 Worker 主通道和页面 direct 通道中执行，不通过 MessagePort 传函数。
- decode/classify 即使异步也必须保持服务端帧到达顺序。
- adapter id 必须为稳定、小写标识；version 必须为正安全整数。
- sharedConfig 必须可结构化克隆，并与 id/version 一起参与共享配置指纹；同 id/version 但不同字段映射或心跳模板不得错误复用。
- adapter 抛错必须转换为 ENCODE_FAILED、DECODE_FAILED 或 PROTOCOL_ERROR，不得逃逸破坏 Worker。
- Adapter 不得依赖 DOM；Worker 入口必须可以独立构建。

### 8.5 内置协议

v1 必须提供：

1. protocol: 'raw'
   - 支持 string、Blob、ArrayBuffer 和 ArrayBufferView 出站。
   - 入站以 string、Blob 或 ArrayBuffer 广播给同 id 的所有已连接 client。
   - WebSocket open 即 ready。
   - 不提供 auth 或 heartbeat 能力。

2. protocol: JsonProtocolOptions
   - JSON encode/decode。
   - 可以声明纯数据 ping/pong 模板与 ready/auth frame 判定。
   - 配置必须可结构化克隆，不接受从页面传入的函数。
   - 必须直接传声明式对象，例如 protocol: { type: 'json', ready: { type: 'ready' } }；不得要求调用方先执行协议工厂。

复杂协议必须使用应用自定义 Worker adapter。

## 9. 控制协议

page-to-worker 控制协议是私有但版本化的 discriminated union。所有 envelope 必须包含：

- protocolMajor。
- message type。
- clientId。
- operationId（需要匹配控制操作时）。
- id（attach 后的连接消息，表示共享连接身份）。

### 9.1 握手

握手顺序：

1. 页面构造 Worker 并 start MessagePort。
2. 页面发送 hello，包含 control protocol major、client capability 和 adapter selector。
3. Worker 在运行时校验 hello。
4. Worker 返回 welcome，包含 worker instance id、protocol major 和已注册 adapter。
5. 页面发送 attach 与共享配置。
6. Worker 返回 attached 或稳定错误。

默认初始化超时为 5,000 ms。超时从 Worker 构造成功开始，到 attached 成功结束。

### 9.2 运行时校验

- Worker 必须校验所有来自页面的消息，不信任任意同源脚本。
- 页面必须校验所有 Worker 响应。
- 未知 type、缺失字段、非法数字、非预期状态和过大控制消息必须返回 INVALID_CONTROL_MESSAGE 或关闭该 client port。
- 单个恶意/错误 client 不得使其他 client 或 Worker runtime 崩溃。
- messageerror 必须进入恢复或失败路径，不得只写 console。

### 9.3 版本

- v1 control protocol major 为 1。
- major 不匹配返回 PROTOCOL_VERSION_MISMATCH。
- minor 向后兼容字段必须可忽略。
- Worker URL 必须随不兼容 major 更新，避免旧 Worker 与新页面无限失败。

## 10. 生命周期与页面恢复

### 10.1 物理连接状态机

    idle
      └─ demand → connecting
                      ├─ socket open → handshaking → open
                      └─ failure → reconnecting → connecting
    open
      ├─ unexpected close → reconnecting
      ├─ reconnect → closing → connecting
      └─ no clients after grace → closing → idle
    any retryable path ─ retry exhausted → failed

非法状态转换必须在开发诊断中报告 INTERNAL_STATE_ERROR，并保持可控终态。

### 10.2 client demand

- 只有至少一个 connected client 时才有连接需求。
- 最后一个 client close/dispose/lease-expire 后，Worker 等待 idleGraceMs，默认 5,000 ms。
- 宽限期内出现新 client 时复用现有连接并取消关闭。
- 宽限期结束后关闭 WebSocket、取消 timer 并清除无主队列。
- 空闲关闭是 intentional，不得触发重连。

### 10.3 page lease

默认：

- heartbeat interval：20,000 ms。
- lease timeout：60,000 ms。

页面必须周期发送 lease。正常 close/dispose/pagehide 应尽力发送 detach，但正确性不得依赖 beforeunload。

- 启用 lifecycle.restore 的页面在 visibilitychange、pagehide 或可用的 freeze 信号后，尽力向 Worker 发送 suspend；在重新 visible、pageshow 或可用的 resume 信号后发送 restore。
- suspend/restore 是 best-effort 控制消息；Worker 不得等待页面 handler，也不得把页面 visibility 当作授权或连接关闭信号。
- suspend 后 lease 仍然有效；若页面冻结导致 lease 超时，Worker 必须按异常消失清理 client。恢复页面随后可以重新握手并重新 attach，但不保证取回已清理的回放缓冲。

Worker 在 lease 过期时必须：

- 清除该 client 拥有的待发队列。
- 重新计算连接 demand。

### 10.4 恢复

- 页面在 pageshow 和从 hidden/frozen 恢复时必须 probe 原 port。
- probe 超时或 worker instance id 改变时，页面必须重建 transport、重新握手并重放最新 endpoint/auth revision。
- Worker 重启后所有内存态可能丢失，页面重放必须幂等。
- lifecycle.restore 启用时，Worker 在 suspend 期间停止向该 client 派发；replay 启用时将消息按物理连接到达顺序放入该 client 的有界回放缓冲，恢复后先回放再派发新消息。
- 回放缓冲溢出时按固定 drop-oldest 策略丢弃旧消息并记录计数；恢复后通过 overflow/diagnostic 暴露，不阻塞其他 client。
- lifecycle.restore 未启用或 replay 未启用时，暂停期间消息不回放；恢复只保证恢复之后的新实时消息。
- Worker 重启、lease 过期、页面终止或回放缓冲超限后，不得声称补齐冻结、终止或断线期间的消息。
- bfcache 恢复必须有真实浏览器测试。

## 11. 连接、重连与关闭

### 11.1 默认参数

    connectionTimeout: 10_000
    initialDelay:       1_000
    maxDelay:          30_000
    factor:                 2
    jitter:               0.2
    stableThreshold:   30_000
    retries:          Infinity
    nonRetryableCodes:   [1000]

实际延迟：

    base = min(maxDelay, initialDelay * factor^(attempt - 1))
    delay = base * uniform(1 - jitter, 1 + jitter)

测试必须可以注入 clock 与 random，生产实现不得依赖可预测 jitter 做安全用途。

### 11.2 规则

- 每次连接尝试在 connectionTimeout 内未 open 必须主动关闭并进入重试决策。
- adapter-ready 模式在 socket open 后进入 handshaking；握手也必须有同一或独立的有限超时。
- 连续 open 达 stableThreshold 后重置 retry attempt。
- 默认服务端 code 1000 是 terminal；本地 reconnect 和仍有 demand 的 url/auth 更新除外。
- adapter.shouldReconnect 可以收窄或扩展 close code 策略，但必须在 Worker 静态注册。
- retries 耗尽进入 failed，发出 RETRY_EXHAUSTED；显式 open/reconnect 重置 retry budget。
- error 事件后仍以 close 事件作为该连接尝试的最终状态依据，避免重复重连。

## 12. 鉴权与动态 endpoint

浏览器 WebSocket 不能设置任意握手 Header。WWS 必须明确支持以下外部方式：

- 同源 cookie。
- URL/query（不推荐放长期秘密）。
- WebSocket subprotocol。
- adapter 的首帧鉴权。

### 12.1 Revision

- updateAuth、clearAuth 和 updateUrl 必须携带正安全整数 revision；初始 URL 保留 revision 0。
- revision 大于 Worker 当前值才应用；较小 revision 返回 stale，不覆盖现值。
- auth 的相等 revision 返回 stale。endpoint 的相等 revision 与当前 URL 相同则幂等，与当前 URL 不同则返回 CONNECTION_CONFIG_CONFLICT。
- 页面恢复只重放本地最新 revision。
- auth 只保存在内存中，不进入连接 id、持久化存储、日志或 diagnostics。
- URL 完整值参与实际连接和共享配置一致性；diagnostics 只能暴露 origin 或 hash，不暴露 query。

### 12.2 更新行为

- adapter 支持在线 auth refresh 时，可以不重连；否则应用 auth 更新必须以受控方式重启连接。
- URL 更新必须关闭旧连接并建立新连接。
- 更新期间状态为 reconnecting，不得启用 direct transport。
- clearAuth 必须清除该连接 id 的待发业务队列并按 adapter 策略终止或重新握手。

## 13. 发送、队列与投递语义

### 13.1 sendMessage receipt

    type SendReceipt =
      | { status: 'accepted'; messageId: string; bufferedAmount: number }
      | { status: 'queued'; messageId: string; position: number }

sendMessage 返回的是本地 transport receipt：

- accepted 表示已调用原生 WebSocket.send。
- queued 表示进入 WWS 内存队列。
- 两者都不表示服务端收到、处理或持久化。
- 服务端确认属于应用业务协议；WWS v1 不提供对应抽象。
- 编码失败、断线且未启用队列、背压且未启用队列、超限等失败统一通过 Promise rejection 返回 WwsError，不返回 rejected receipt。
- messageId 由 WWS 为本地发送生成，仅用于日志关联和队列跟踪，不等于服务端确认标识。

### 13.2 默认策略

    interface QueueOptions {
      whenDisconnected: boolean
      whenBackpressured: boolean
      maxMessages: number
      maxBytes: number
    }

    interface SendOptions {
      queue?: boolean
      idempotencyKey?: string
    }

- 断线发送默认拒绝 SEND_WHILE_DISCONNECTED。
- 背压发送默认拒绝 BACKPRESSURE。
- createWebSocket 的 queue 省略或为 false 时不排队；queue: true 同时启用断线和背压排队，并使用默认上限。
- 实例可通过 queue.whenDisconnected 和 queue.whenBackpressured 分别启用两个场景；二者默认 false。
- 单次 SendOptions.queue: true 在两个场景中都启用排队；false 强制本次不排队；省略时继承实例设置。
- 显式排队 SHOULD 携带 idempotencyKey；文档必须说明重放风险。
- 队列只在内存中，刷新所有页面或 Worker 终止后丢失。

### 13.3 队列上限

默认每个连接 id：

    maxMessages: 100
    maxBytes:    1 MiB

- 两个上限任一达到时拒绝新消息；不得静默淘汰旧消息。
- 编码后单条消息默认上限为 1 MiB；超限拒绝 MESSAGE_TOO_LARGE，不得进入队列或调用原生 send。
- 队列按进入顺序 FIFO flush。
- 每项记录 owner clientId、编码后字节数、idempotency key 和创建顺序。
- client close、detach/lease-expire、连接 id 改变或 dispose 时，必须清除该 client 拥有的队列项。
- clearAuth 必须清除该连接 id 下所有 client 的业务队列项。
- adapter encode 失败的消息不得进入队列。
- Blob 使用 size；ArrayBuffer/ArrayBufferView 使用 byteLength；string 使用 UTF-8 字节数。

### 13.4 二进制

- 必须支持 string、Blob、ArrayBuffer 和 ArrayBufferView。
- 同一入站 ArrayBuffer/Blob fan-out 给多个 port 时不得使用会导致后续接收方看到 detached buffer 的错误 transfer。
- binaryType 是共享配置；相同 key 不同 binaryType 必须冲突。
- 文档必须说明多 tab 广播大二进制 payload 的结构化克隆成本。

### 13.5 顺序

- 服务端入站帧必须按单个物理 WebSocket 的到达顺序完成 decode/classify 和页面投递。
- 同一 client 的出站调用按 Worker 接收顺序排序。
- 不同 tab 没有共享 wall-clock 顺序保证；Worker 实际接收控制消息的顺序是唯一可观察总序。
- reconnect ready 后必须先 flush 业务发送队列；WWS 不管理应用层订阅的恢复。
- flush 期间的新业务发送必须排在既有队列之后，不能绕过旧消息。

## 14. 背压与慢消费者

原生 WebSocket 没有真正的入站背压。WWS 必须清楚区分：

1. 出站 socket backpressure：通过 bufferedAmount 近似控制。
2. Worker 到页面 fan-out：通过有界 credit 控制。
3. 页面应用消费：通过 onMessage/EventTarget 同步分发；v1 不提供 AsyncIterable 或应用处理确认。

默认出站水位：

    highWaterMarkBytes: 1 MiB
    lowWaterMarkBytes:  256 KiB

- bufferedAmount 达高水位时，sendMessage 根据单次 queue 覆盖或实例 queue.whenBackpressured 排队，否则 reject BACKPRESSURE。
- flush 必须等待降到低水位，避免 busy loop。
- 每个 page client 默认最多 256 个尚未由页面运行时确认接收的投递或 4 MiB，以先到的上限为准；确认只表示页面运行时已收到并开始分发，不表示业务 handler 已处理完成。
- 启用 lifecycle.restore 且 client 处于 suspended 时，回放缓冲使用同一默认 256 条/4 MiB 上限；达到上限后固定丢弃最旧消息并记录计数。
- 未启用回放或 client credit 耗尽时，Worker 必须丢弃该 client 后续的新入站消息、记录计数，并在可以投递时发出 INBOUND_OVERFLOW / overflow 事件；不得在 Worker 中无限积压。其他健康 client 不受影响。
- EventTarget 和 onMessage 均属于 best-effort 消费，不提供应用处理级背压或跨 Worker/页面终止的可靠重放保证。
- Worker 向页面派发消息时只等待页面运行时的接收确认，不等待任何 onMessage handler 或 EventTarget listener 返回。

## 15. 心跳

WebSocket 浏览器 API 不暴露 RFC ping frame，v1 心跳只能是 adapter 定义的应用层消息。

- raw 协议默认不启用心跳。
- heartbeat: false 是默认值。
- heartbeat: true 等价于 message: 'ping'、responseMessage: 'pong'、interval: 25,000 ms、pongTimeout: 10,000 ms。
- adapter 提供 createPing 且调用方启用后，默认 interval 为 25,000 ms、timeout 为 10,000 ms。
- pong 模式只有 adapter 分类出的 pong 才确认；activity 模式可以由任意有效入站帧续期。
- pong 超时必须以 HEARTBEAT_TIMEOUT 关闭当前 socket，并进入正常重连，不得切换 direct。
- adapter 分类出的 server ping 必须可以生成 pong，且 ping/pong 默认不交付业务 listener。
- 每个物理连接只能有一套 heartbeat timer，不得按 tab 重复发送。

## 16. 业务消息分发

v1 没有公开 subscribe()、topic 路由或由 WWS 生成的服务端订阅帧。

- adapter classify 为 data 的每条业务消息，必须按到达顺序广播给同一连接 id 下所有处于 open 状态的逻辑 client。
- 每个收到消息的 client 必须先更新 data，再按注册顺序调用 onMessage handler 和派发 message 事件。
- 同一 client 的一个业务帧只能更新一次 data，并向每个已注册 onMessage handler 投递一次。
- 应用如使用服务端自定义频道、topic 或订阅协议，必须自行通过 sendMessage() 发送对应业务帧，并在 onMessage() 中按业务字段筛选。
- WWS 不推断、合并、重放或撤销应用层订阅帧；服务端必须继续按身份和操作授权。

## 17. 请求/确认非目标

v1 不提供 request()、sendWithAck()、协议 correlation 或服务端 ack 抽象。应用如需请求响应、确认、超时、取消或幂等，必须通过自己的业务帧、sendMessage() 与 onMessage() 实现；WWS 只保证其通用传输语义。

## 18. Transport 选择与降级

### 18.1 判定

SharedWorker 可用不能只通过全局属性检测。shared-worker transport 成功必须满足：

1. SharedWorker API 存在。
2. inline constructor 或 custom worker factory 构造成功。
3. Worker 脚本执行且 MessagePort 可启动。
4. hello/welcome/attach 在 5 秒内完成。
5. control protocol 与 adapter 匹配。

### 18.2 允许触发 direct 的错误

fallback: direct 时，只有以下错误可以选择 direct：

- WORKER_UNSUPPORTED。
- WORKER_CONSTRUCTION_FAILED。
- WORKER_LOAD_FAILED。
- WORKER_INIT_TIMEOUT。
- WORKER_DISCONNECTED，且重新创建/握手失败。
- PROTOCOL_VERSION_MISMATCH。
- ADAPTER_NOT_REGISTERED。

不允许触发 transport 降级：

- SOCKET_ERROR。
- CONNECTION_TIMEOUT。
- HEARTBEAT_TIMEOUT。
- AUTH_FAILED。
- CONNECTION_CONFIG_CONFLICT。
- DECODE_FAILED。
- 服务端 close 或网络离线。

### 18.3 一致性

- transport 从 pending 选择为 shared-worker 或 direct 后，client 生命周期内不得自动来回切换。
- direct fallback 必须发 diagnostic，transport 和 workerMode 属性必须可见；direct 时 workerMode 为 none。
- direct 必须保持公开 API 和状态/错误语义；唯一差异是共享范围。
- fallback: error 遇到 Worker 初始化错误时进入 failed。
- 不得静默启用 BroadcastChannel/Web Locks/localStorage 选主。

## 19. 错误模型

WwsError 必须包含：

    interface WwsError extends Error {
      readonly name: 'WwsError'
      readonly code: WwsErrorCode
      readonly retryable: boolean
      readonly fatal: boolean
      readonly details?: Readonly<Record<string, unknown>>
      readonly cause?: unknown
    }

公开稳定错误码至少包括：

- INVALID_OPTIONS、ENVIRONMENT_UNSUPPORTED、CLIENT_DISPOSED、CLIENT_DISCONNECTED、ABORTED。
- WORKER_UNSUPPORTED、WORKER_CONSTRUCTION_FAILED、WORKER_LOAD_FAILED、WORKER_INIT_TIMEOUT、WORKER_DISCONNECTED。
- PROTOCOL_VERSION_MISMATCH、ADAPTER_NOT_REGISTERED、INVALID_CONTROL_MESSAGE、CONNECTION_CONFIG_CONFLICT。
- CONNECTION_TIMEOUT、SOCKET_ERROR、CLOSE_NOT_RETRYABLE、RETRY_EXHAUSTED、HEARTBEAT_TIMEOUT。
- AUTH_FAILED、STALE_REVISION。
- SEND_WHILE_DISCONNECTED、QUEUE_FULL、QUEUE_BYTES_EXCEEDED、BACKPRESSURE。
- MESSAGE_TOO_LARGE、RESOURCE_LIMIT_EXCEEDED。
- ENCODE_FAILED、DECODE_FAILED、PROTOCOL_ERROR、CAPABILITY_UNSUPPORTED。
- INBOUND_OVERFLOW、INTERNAL_STATE_ERROR。

规则：

- 稳定 code 可用于程序判断；message 不属于稳定 API。
- Worker 内部异常必须脱敏后通过控制协议传递。
- error 事件不得包含 token、完整 URL query、任意页面绝对路径或 Worker 堆栈。
- 库默认不得 console.log；logger 是页面端显式 opt-in。

## 20. Diagnostics

ConnectionDiagnostics 至少包含：

- transport、logical state、physical state。
- worker instance hash 与 control protocol major。
- id hash、config fingerprint 和 endpoint origin。
- retry attempt、next retry delay、last safe close code。
- attached client count。
- queue message/byte count。
- bufferedAmount、outbound high-water state。
- 最近一次安全错误 code。

不得包含：

- auth/token/cookie。
- 完整 endpoint query、fragment 或签名参数。
- 原始业务 payload。
- 原始连接 id。
- 未经清理的 CloseEvent.reason。
- 绝对本地路径或内部堆栈。

诊断快照必须深度只读或返回副本，调用方不得改变运行时状态。

## 21. 安全要求

- SharedWorker 是资源共享机制，不是同源内部权限边界。
- Worker 必须假设任意同源脚本可能连接 MessagePort 并发送畸形控制消息。
- 服务端必须继续按身份和操作逐项授权。
- custom worker factory 允许应用使用 TrustedScriptURL/CSP 策略；WWS 不拼接调用方提供的不受信任 Worker URL。
- inline Worker 使用 WWS 构建时生成的固定 data: URL，不拼接用户输入。
- URL、reason、adapter error 和服务端 payload 不得直接写日志。
- 队列、control message 和 client 数必须有资源上限，避免同源误用导致无限内存。
- clientId/operationId 应使用 crypto.randomUUID 或等价高质量随机值；它们不是凭据。
- auth 永不持久化到 localStorage、sessionStorage、IndexedDB 或 Cache API。

### 21.1 默认资源限制

以下默认值必须可通过静态共享配置收紧或放宽，并参与配置指纹：

    maxPortsPerWorker:              256
    maxClientsPerConnection:         64
    maxEncodedMessageBytes:        1 MiB
    maxControlEnvelopeBytes:       2 MiB
    unattachedPortTimeoutMs:       5,000

- 超限必须返回稳定错误或关闭违规 port，不得影响既有健康 client。
- maxPortsPerWorker 在 hello 前也生效；未完成 attach 的 port 必须在超时后清理。
- Blob、buffer 和 string 按第 13 节统一计算字节数。
- maxEncodedMessageBytes 的拒绝不得先把消息加入 socket 或离线队列。

## 22. 性能与资源验收

默认验收档位：

- 典型 3 tab，压力 20 tab。
- 每个物理连接典型 100 msg/s，压力 1,000 msg/s。
- 典型 payload 1 KiB；单消息压力 payload 64 KiB。
- 出站队列 100 条/1 MiB 双上限。

验收要求：

- 20 个同源页面、相同 key/config 只能观察到一个服务端物理连接。
- 消息和队列内存必须受配置上限约束；关闭页面后资源在 lease + idle grace 边界内回收。
- 1,000 msg/s、1 KiB、20 tab 广播场景不得出现乱序、跨 client 漏投或无限内存增长。
- 64 KiB 二进制广播必须保持内容一致且无 detached buffer。
- release:verify 必须记录 client 与 worker 入口 gzip 大小；v1 SHOULD 分别不超过 20 KiB 和 25 KiB（不含应用 adapter）。
- 性能测试结果只比较固定环境，不把不稳定 wall-clock 阈值作为唯一正确性断言。

## 23. 测试规格

### 23.1 单元测试

Vitest fake clock/random 必须覆盖：

- 所有状态转换和非法转换。
- 退避、jitter、稳定窗口和最大重试。
- connection/handshake/heartbeat timeout。
- 配置规范化与冲突指纹。
- auth/endpoint revision。
- lifecycle.restore suspend/restore、回放顺序、replayed 标记和溢出。
- client 生命周期与连接 demand 计数。
- 队列 FIFO、条数/字节上限、owner 清理。
- bufferedAmount 高低水位。
- adapter encode/decode/classify 与错误隔离。
- control protocol runtime validation。
- diagnostics 脱敏。

### 23.2 集成测试

必须使用可注入 WebSocket/MessagePort-like 边界覆盖：

- 多 client 单连接、不同 key 多连接。
- attach/detach/lease expiry/idle grace。
- reconnect 后 auth 恢复和业务队列 flush。
- lifecycle.restore 在 SharedWorker/direct 中的暂停、恢复、回放和 lease 过期边界。
- Worker runtime dispose 清理所有 timer/socket。
- direct 与 shared-worker 的 contract test 套件完全相同。

### 23.3 真实浏览器 E2E

Playwright + 真实 ws 测试服务必须覆盖：

- 一个 BrowserContext 中 2、3、20 个 page 的物理连接计数。
- 页面关闭、刷新、崩溃近似、bfcache/pageshow。
- lifecycle.restore 在 visibilitychange、pageshow/BFCache 和可用 freeze/resume 信号下的行为；不支持 freeze/resume 的浏览器验证 visibility/pageshow 兜底。
- Worker URL/MIME/构造/协议版本错误与 direct/error fallback。
- 网络断开、服务端重启、close code 和重连。
- text/Blob/ArrayBuffer/typed array。
- 同一 id 的消息广播与跨 client 顺序。
- Worker 重启后的 client 恢复。
- 普通 socket 故障不会触发 direct。

若某 Playwright engine 不支持目标 SharedWorker 能力，测试必须明确验证 direct fallback，不能无说明 skip。

### 23.4 Tarball consumer

必须 pack 公开包并在干净临时工程验证：

- ESM import 和 TypeScript NodeNext/Bundler resolution。
- 根、protocol、worker 三个 exports。
- Vite production build。
- inline Worker 跨 tab 复用，以及 custom Worker 入口打包与同源加载。
- SSR build/import 不访问浏览器全局。
- tarball 不含私有 workspace 依赖、源码绝对路径或无关文件。

## 24. 文档与 Playground

v1 文档必须包含：

- 五分钟 quick start。
- Worker 部署、CSP、MIME、Trusted Types 和固定 URL 指南。
- 单 SPA 与多 SPA/微前端部署差异。
- 连接 id 与配置冲突说明。
- 鉴权限制和 adapter 示例。
- 重连、心跳、队列、背压和投递语义。
- direct/error fallback 与 transport 监控。
- 浏览器兼容矩阵。
- 错误码与 diagnostics。
- raw、JSON 和自定义 adapter 示例。

Playground 必须：

- 可一键打开多个同源页面。
- 展示 tab 数、物理连接数、transport、状态和队列。
- 支持模拟服务端关闭、丢 pong、断网/恢复和 Worker 初始化失败。
- 不把 demo-only 协议耦合进核心。

## 25. 规范性验收清单

- AC-001：相同 key/config 的 20 tab 只有一个物理连接。
- AC-002：不同 key 各自建立一个物理连接。
- AC-003：相同 key/config conflict 拒绝后加入者且不影响既有连接。
- AC-004：任意单 tab close/dispose 不影响仍有 demand 的其他 tab。
- AC-005：最后 client 离开后在 idle grace 内关闭并清理资源。
- AC-006：异常消失的 client 在 lease timeout 后清理队列。
- AC-007：页面/Worker 恢复重放最新 endpoint/auth revision；启用 lifecycle.restore.replay 时按顺序回放有界消息，否则不声称补偿冻结、终止或断线期间的消息。
- AC-008：重连、连接超时、jitter、stable threshold 和 retry exhaustion 符合公式。
- AC-009：心跳是每物理连接一份；timeout 重连但不降级。
- AC-010：断线默认拒绝，显式队列受 100 条/1 MiB 上限和 owner 生命周期约束。
- AC-011：sendMessage receipt 不表示服务端收到、处理、确认或持久化。
- AC-012：bufferedAmount、Worker-to-page 入站投递和 lifecycle.restore 回放缓冲都有有界溢出行为，且不等待 handler。
- AC-013：string/Blob/ArrayBuffer/ArrayBufferView 内容和顺序正确。
- AC-014：业务消息按到达顺序广播给同一 id 的 open client；应用层订阅帧不由 WWS 合并或恢复。
- AC-015：只允许 Worker 初始化类错误触发 direct；网络/鉴权/心跳错误不得触发。
- AC-016：fallback: error 不建立 direct socket。
- AC-017：Worker/control/adapter 畸形消息只隔离相关 client，不崩溃 runtime。
- AC-018：auth、URL query、payload、连接 id 和内部堆栈不出现在日志/诊断。
- AC-019：所有公开入口 SSR-safe、ESM-only、类型与 exports 验证通过。
- AC-020：真实 tarball 在 Vite consumer 中能构建并加载应用 Worker。
- AC-021：Chromium、Firefox、WebKit E2E 或明确 fallback 验证通过。
- AC-022：lint、typecheck、unit、integration、E2E、build、docs 和 release verify 全部通过。
- AC-023：lifecycle.restore 仅影响当前 client；不同 tab 可独立开启或关闭，且不造成配置冲突。

## 26. v1 已采用的默认决策

除非在本阶段对齐时调整，v1 采用：

- SharedWorker 是主 transport。
- fallback 默认为 direct，并支持严格 error。
- 不实现 leader election fallback。
- framework-agnostic 单一公开包，不首发 React/Vue adapter。
- raw + declarative JSON + 自定义 Worker adapter。
- 不内置 Socket.IO/graphql-ws/STOMP 等协议。
- 默认使用稳定 data: URL 的零配置 inline Worker，并支持 custom Worker 工厂覆盖。
- ESM-only、现代浏览器、SSR-safe import。
- 断线默认拒绝，有界队列需显式 opt-in。
- 单 SPA 和同源多 SPA均可共享；多 SPA必须统一 Worker URL。
- 采用第 22 节默认性能档位。
- 包名 wws，许可证暂定 MIT。

## 27. 阶段门

本规格得到确认后，to-spec 完成。下一阶段 to-tickets 必须：

- 每个 ticket 映射一个或多个 AC。
- 明确依赖、涉及包、文件边界、测试和完成定义。
- 先搭建可验证骨架，再实现纯 core、Worker、页面 client、fallback、文档和发行验证。
- 在 tickets 再次对齐前不得进入 implement。
