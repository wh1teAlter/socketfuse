# 跨标签页单点执行、重连生命周期与协议边界规格

> 状态：accepted。文件名沿用最初讨论入口；endpoint 模板、连接变量 register 与协议驱动重连延迟均不实现。
> 实现必须以本规格为准，不以当前工作树中的旧实现反推契约。

## Problem Statement

SocketFuse 已把同源多标签页的物理 WebSocket 收敛到 SharedWorker，但一条入站业务帧仍会让每个页面的 handler 重复执行副作用。页面进入后台、冻结或异常退出时，应用层自建的选主也无法可靠转移。

自动重连由 Worker 单点执行，但动态 endpoint getter 只能存在于页面业务中。页面如果在普通断开回调中异步更新 URL，会与 Worker 的退避 timer 竞态。与此同时，现有首次退避计算、应用层 heartbeat 的 activity 模式和重叠 timeout 存在正确性缺口，raw 字符串 ping/pong 也被配置校验阻止。

现有库还把 auth、认证 revision、协议 ready 与凭据帧顺序建模为 SocketFuse 自身能力。这些属于应用协议状态，不属于通用 WebSocket 共享库。`SendOptions.idempotencyKey` 只被保存而没有任何去重或幂等语义，`ProtocolCapabilities` 也包含未被执行或可直接由 adapter 方法推导的声明；继续保留会让调用方误判库的保证。

## Solution

为动态 `onMessage` handler 增加可选 execution key。Worker 只仲裁哪个逻辑 client 持有 key，入站帧仍广播给全部页面；页面根据 Worker 权威下发的持有集合决定是否调用 keyed handler。持有页冻结、关闭、端口断开或租约失效时，Worker 选择新的候选页。

由 Worker 为每次重新建连创建有代际编号的 reconnect plan。注册了 `onBeforeReconnect` 的候选页面可在总准备期限内重新运行自己的配置 getter，并原子覆盖下一次连接使用的 URL 与重连延迟。Worker 始终拥有 socket 与计划；页面函数不会跨 MessagePort，也不能修改连接身份、协议或资源策略。

保留应用层 heartbeat 与浏览器原生 WebSocket Ping/Pong 的边界：heartbeat 默认关闭；显式开启后默认发送字符串 `ping` 并识别字符串 `pong`。只有显式设置 `pongTimeout` 才会因缺少响应关闭并自动重连。

SocketFuse 不提供入站去重或幂等检查。它只把业务帧派发到各标签页，并按 execution key gate handler 调用；服务端重发、断线补发、游标推进与副作用幂等由应用使用稳定消息 ID 和自身事务边界处理。

## User Stories

1. 作为多标签页应用开发者，我希望相同 execution key 的 handler 在共享连接下只由一个页面执行，从而避免重复副作用。
2. 作为页面状态维护者，我希望每条入站帧仍广播到全部已附着页面，从而让未持有 key 的页面继续维护本地视图。
3. 作为普通消息消费者，我希望不带 key 的 handler 保持每页执行，从而不改变现有展示逻辑。
4. 作为一个页面，我希望同 key 的多个本地 handler 一起随页面持有权启停，从而可以拆分同一执行职责的处理代码。
5. 作为后注册页面，我希望当前持有者不被抢占，从而避免两个页面在交接点重叠执行。
6. 作为等待页面，我希望持有者离开后按注册先后获得执行权，并在相同可见性级别内保持 FIFO。
7. 作为前台页面，我希望 Worker 在新选主时优先选择可见候选，从而降低后台冻结导致的停顿概率。
8. 作为后台页面，我希望仅仅变为 hidden 不会立刻失去持有权，从而避免用户切换标签时频繁抖动。
9. 作为被冻结页面，我希望立即失去所持有的全部 execution keys，从而让仍可运行的页面接管副作用。
10. 作为意外冻结或被丢弃的页面，我希望 Worker 通过 lease 失效最终回收我的 key，从而保证活性。
11. 作为恢复页面，我希望只相信 Worker 的 grant/revoke 控制帧，从而不会以过期持有状态执行消息。
12. 作为 direct fallback 使用者，我希望每个 client 都持有自己的 keys，同时清楚该模式不提供跨标签页独占。
13. 作为资源受限 Worker 的维护者，我希望限制不同 execution key 的总数，从而防止控制平面无界增长。
14. 作为调用方，我希望通过 `holdsKey()` 与 `keychange` 观察当前页面是否持有 key，从而调整界面与业务状态。
15. 作为异步 handler 作者，我希望 key 被撤销时收到 AbortSignal，从而停止仍在执行的旧持有者副作用并缩短交接重叠窗口。
16. 作为动态 endpoint 使用者，我希望初始化函数只接收已经求值的固定 URL 字符串，从而让函数与秘密不进入 Worker 配置。
17. 作为动态 endpoint 使用者，我希望在重新建连前由一个候选页面重新运行自己的 getter，从而为下一次尝试提供新 URL。
18. 作为共享连接使用者，我希望一次重连只有一个页面能够提交配置，从而避免多标签页竞态。
19. 作为重连 hook 作者，我希望看到安全的原因、重试序号和默认延迟，从而决定如何准备下一次尝试。
20. 作为重连 hook 作者，我希望通过 `setOptions({ url })` 与 `setDelay()` 原子覆盖当前计划，从而保证下一次尝试使用同一批决策。
21. 作为异步 getter 使用者，我希望 hook 有明确的准备窗口和 AbortSignal，从而处理超时、冻结和计划被替代。
22. 作为共享连接使用者，我希望候选页提前失活或失败时在总期限内自动转给下一个页面，期限到达则采用默认计划，从而不被挂起页面永久阻断。
23. 作为共享连接使用者，我希望全部 hook 候选失败时仍按原 URL 和默认退避继续，从而维持基础自动恢复。
24. 作为安全审计者，我希望 URL query、页面异常文本和业务 payload 不出现在控制面回显、日志或诊断中。
25. 作为 heartbeat 使用者，我希望显式开启后默认使用应用层字符串 ping/pong，从而覆盖常见服务器协议。
26. 作为使用浏览器原生 WebSocket Ping/Pong 的应用，我希望保持 heartbeat 关闭，从而不重复实现浏览器网络栈已经处理的协议控制帧。
27. 作为只想发保活消息的应用，我希望不配置 `pongTimeout` 时不会因缺少业务 pong 被库主动断开。
28. 作为需要存活检测的应用，我希望显式配置 `pongTimeout` 后，缺少 pong 或 activity 能关闭连接并进入同一重连计划流程。
29. 作为 raw 协议使用者，我希望固定字符串或二进制 heartbeat 能工作，且被识别的 pong 不进入业务 handler。
30. 作为 JSON/custom 协议使用者，我希望 adapter 继续负责分类 ping/pong 和生成响应，从而不把协议知识塞进 Worker runtime。
31. 作为运维人员，我希望首次自动重连确实使用 `initialDelay`，后续才按 factor 指数增长。
32. 作为旧 API 使用者，我接受 beta 阶段移除公开 `updateUrl()` 与 `URL` 对象输入，以换取唯一、明确的 endpoint 更新路径。
33. 作为通用库使用者，我希望凭据、认证、业务 ready、Ack 与游标不被 SocketFuse 建模，从而能完整控制自己的应用协议。
34. 作为消息消费者，我希望库不伪装成幂等层：每帧仍正常派发，是否为重复业务消息以及副作用是否安全由应用判断。
35. 作为 adapter 作者，我希望 JSON/custom heartbeat 仍能按任意字段（包括 `messageType`）生成和匹配 ping/pong，而无需声明重复 capability。
36. 作为安全审计者，我希望显式 `reconnect()` 不接受会跨 Worker 或进入日志的任意业务 reason 文本。
37. 作为动态 endpoint 使用者，我希望不同标签页生成不同 query 时仍能按相同 `id` 加入既有连接，后来页面的 URL 也不能静默覆盖当前连接。

## Implementation Decisions

### Handler execution

- 物理连接所有权永远属于 Worker；本特性转移的是 execution key 持有权或 reconnect plan 准备权。
- `onMessage(handler, { key })` 保持同步返回幂等取消函数。省略 key 时行为不变；同一页面相同 key 的所有 handler 共同受一个页面级持有状态控制，handler 类型允许 `void | Promise<void>`。
- handler 接收只读 `{ signal }` context。带 key 的 handler 在 grant 时获得新 signal，revoke 时先 abort；无 key handler 的 signal 仅在逻辑 client dispose 时 abort。库不能强制中止已开始的 Promise，这不是 exactly-once。
- Worker 对每个共享连接维护 holder 与候选顺序。新候选不抢占；新选主先 visible 后 hidden，各组 FIFO；frozen 不可选。hidden 不主动转移，freeze、close、dispose、端口失败和 lease 失效撤销该页全部 keys。
- 未 open 或已经 close 的页面只缓存本地注册意图，不 attach Worker、不占 key、也不成为 hook 候选；再次 open 后再同步。
- 页面 held set 只由独立 `KEY_GRANTED`/`KEY_REVOKED` 帧维护。明确 freeze 时页面必须先保守停止启动 keyed handler 并 abort 旧 signal，恢复后仍须等待 Worker 新 grant，防止 thaw 后处理冻结前排队消息。
- 每帧继续广播给所有已附着 client；delivery credit、overflow、replay、普通 handler 与 `message` 事件不变。key gate 只包围 handler 调用。
- direct transport 将每个 client 视为其 keys 的 holder；保证不跨页面。
- `maxExclusiveKeys` 统计 Worker 内所有连接的不同 key。超限以 `RESOURCE_LIMIT_EXCEEDED` 报告并回滚失败意图，不得阻断 open、连接、普通 handler 或既有 holder。

### Endpoint and reconnect

- `createWebSocket` 和重连计划中的 URL 只接受绝对 `ws:`/`wss:` 字符串。getter 由业务在库外调用；模板、getter 参数、连接变量、`setVar`、`clearVar` 与 `varchange` 均不实现。
- 完整 endpoint 是单次连接尝试输入，不进入共享 canonical/fingerprint。同 `id` 与同共享配置表示主动加入现有连接；后来页面传入的不同 URL 不冲突、也不覆盖当前 endpoint。连接条目释放后的新创建者提供下一次初始 URL。
- 移除 `updateUrl()`。运行中 URL 只能由当前 reconnect plan 的 `setOptions({ url })` 原子更新，避免两套写入路径。
- 每个逻辑 client 最多注册一个 `onBeforeReconnect`。Worker 按 visible 优先、组内 FIFO 选择一个候选，不广播执行 hook。
- 自动重试、heartbeat timeout 与显式 `reconnect()` 都创建 reconnect plan；显式重连默认 delay 为零。初次 `open()` 不调用 hook。公开 `reconnect()` 不接受任意业务 reason。
- plan 包含不可猜测 id、重连序号、安全原因、默认延迟、安全 close 信息和总准备 deadline。`autoReconnect.hookTimeout` 限制整个 plan，不因候选转移重新计时。
- hook context 只暴露 `attempt`、`reason`、安全 `close`、`defaultDelay`、`signal`、`setOptions({ url })` 与 `setDelay(ms)`。setter 只改页面草案，handler 成功返回后一次性提交。
- 候选异常、freeze、detach、lease 失效或注销时，在剩余 deadline 内选择下一候选；总 deadline 到期或全部失败时沿用当前 URL 与默认 delay。旧 owner、旧 plan 或过期提交以 `STALE_RECONNECT_PLAN` 拒绝。
- `setOptions` 第一版只接受 URL；`setDelay` 接受非负有限数，多次调用最后一次生效。二者不能修改 `id`、protocol、fallback、heartbeat、queue、lease、limits 或 Worker 配置。
- 第一次自动重连使用 `initialDelay`，第 N 次使用受 `maxDelay` 与 jitter 约束的 `initialDelay * factor^(N-1)`；稳定 open 后重置。

### Application protocol boundary

- 删除 `updateAuth()`、`clearAuth()`、`RevisionReceipt`、revision register、`JsonAuthTemplate`、`AuthContext`、`ProtocolAdapter.createAuth`、全部 `Auth` 泛型、auth 控制帧和认证重放，不提供兼容别名。
- 删除 adapter-frame ready：`JsonProtocolOptions.ready`、`ProtocolFrame` 的 `ready`、`readyWhen` 与 `handshaking` 状态。`open()`/`onConnected` 只表示原生 socket open；认证、session、订阅与业务 ready 由应用消息和应用状态维护。
- 删除 `ProtocolCapabilities`、client `capabilities` 与 adapter `capabilities`。heartbeat 由 JSON 配置或 `createPing` 直接验证；未满足时在配置阶段返回 `INVALID_OPTIONS`。随 auth/capability 删除不再可达的 `AUTH_FAILED`、`STALE_REVISION` 与 `CAPABILITY_UNSUPPORTED` 一并删除。
- 删除 `SendOptions.idempotencyKey`；当前字段没有任何行为。SocketFuse 不增加入站 checker、dedupe cache 或幂等 hook；业务消息 ID、重复判断与副作用事务均在应用 handler 内。
- adapter 只保留静态、无凭据的 encode/decode/classify、可选 ping/pong、重连许可、稳定 id/version 与 sharedConfig。内置 JSON 的完整配置已参与 fingerprint，不再开放自定义 adapter id/version。

### Heartbeat and module boundaries

- heartbeat 默认关闭；`heartbeat: true` 使用默认 interval 与应用层 `ping`/`pong`，`pongTimeout` 默认不存在。
- 顶层 heartbeat 拥有 timing；raw 额外拥有字符串/二进制 ping/pong payload。JSON/custom 的 wire format 由 JSON matcher 或 `createPing`/`classify`/`createPong` 决定，raw payload 字段在这两种协议下必须拒绝而非静默忽略。raw heartbeat 的二进制配置使用可同步参与共享 fingerprint 的 `ArrayBuffer` 或类型化数组视图；`Blob` 仍可作为普通 raw 消息。
- JSON matcher 不预设字段名，`messageType` 或任意嵌套字段均可用于 ping/pong。识别出的控制帧不进入业务 handler。
- 配置 `pongTimeout` 后，pong 模式只由匹配 pong 确认，activity 模式由任意成功解码并分类的入站活动确认。每周期只允许一个待决 timeout，等待响应时不叠加 timer。
- 浏览器原生 WebSocket Ping/Pong 不暴露给 JavaScript，不新增 `native` 模式；服务端使用原生控制帧时保持 `heartbeat: false`。
- 控制协议主版本递增，inline/custom Worker 与页面必须同步理解新的 key、visibility、plan 与删除后的严格消息形状。
- 新抽象限于 connection 的 reconnect plan 与 Worker 的候选选择；connection 不依赖 page/worker，Worker 不执行页面函数或等待业务 handler。

## Acceptance Checklist (§8)

### Execution key

- [ ] 相同 `id` 的两页共享一个物理 socket；每帧仍到达两页，keyed handler 只由当前 holder 启动，无 key handler 与 `message` 事件逐页执行。
- [ ] 同 key 先注册者不被后注册抢占；visible 优先、同级 FIFO 只用于下一次选择，hidden 不主动转移。
- [ ] close、dispose、端口失败、显式 freeze 与 lease 失效均 revoke 并转移；未 open/已 close 页不参与仲裁。
- [ ] freeze 后排队消息不能以旧授权在 thaw 后启动 keyed handler；regrant 使用新的 AbortSignal。
- [ ] `maxExclusiveKeys` 超限回滚失败意图，不影响 open、普通 handler、既有 key 或连接。

### Endpoint and reconnect

- [ ] 初始化拒绝 URL 对象/getter/Promise/模板，只接受固定绝对 ws/wss 字符串。
- [ ] 同 id、同共享配置、不同 URL 可加入现有连接；后来 URL 不覆盖 endpoint；不同共享配置仍显式冲突。
- [ ] 自动、heartbeat timeout 与显式 reconnect 都通过唯一 plan；显式 reconnect 默认 delay 为零，首次 open 不调用 hook。
- [ ] URL/delay 只在候选 hook 成功后原子提交；异常、冻结、注销与 stale completion 不更新连接。
- [ ] `hookTimeout` 是 plan 总 deadline，候选数增加不会线性放大最坏等待时间。
- [ ] 第一次自动重连使用 `initialDelay`，后续指数增长并按稳定窗口重置。

### Protocol boundary and heartbeat

- [ ] 公开类型、导出、源码、控制帧、生成 Worker、文档与 tarball 中不存在 auth/revision/`$auth`/adapter-ready API。
- [ ] `open` 只代表原生 socket open；应用可在 `onConnected` 后发送普通认证帧并自行维护业务 ready。
- [ ] 不存在 `ProtocolCapabilities`/client `capabilities`、`SendOptions.idempotencyKey`、`CAPABILITY_UNSUPPORTED` 或公开 reconnect reason。
- [ ] 库没有入站 checker/dedupe/idempotency API；服务端重复帧仍派发，应用可在 handler 内自行过滤。
- [ ] raw 默认字符串 ping/pong 与二进制按 wire bytes 工作；未配置 `pongTimeout` 不主动断线。
- [ ] JSON `{ messageType: 'ping' }`/`{ messageType: 'pong' }` 与任意嵌套 matcher 可工作；custom adapter 不回落到 raw 比较。
- [ ] pong/activity timeout 不重叠，识别出的控制帧不进入业务 handler，timeout 进入同一 plan。

### Security and delivery

- [ ] endpoint path/query、payload、hook 异常文本与 plan id 不进入 fingerprint、logger、diagnostics、错误控制响应或非候选页回显。
- [ ] 字符串 endpoint 与无 key `onMessage` 行为不变；本次获准的 beta 删除不提供运行时兼容层。
- [ ] 文档站、模块 README、playground、生成 API、release tarball/SSR 验收与 Changeset 同步。
- [ ] Chromium、Firefox、WebKit 覆盖广播、key 转移、freeze/lease、reconnect plan 和 heartbeat。
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check`、`pnpm release:verify`、`pnpm test:e2e` 与 `git diff --check` 全绿，构建 dist 的命令不并行运行。

## Testing Decisions

- 测试只断言公开行为、控制边界和状态顺序，不读取私有 map 或 timer 实现。
- 连接控制器 seam 验证 native-open、首次退避、统一 plan、URL/delay 原子覆盖、过期 plan、raw ping/pong、可选 timeout、activity 与不重叠 timer。
- Worker runtime seam 验证 URL 不属于共享冲突、广播不变、key 单持有、同页多 handler、visible/FIFO、freeze/lease/detach 转移、资源上限、hook 总 deadline 与 stale plan。
- 页面 client seam 验证注册只在 open 后同步、handler gate、权威 held set、freeze 保守停止、`holdsKey`、`keychange`、新 signal、hook 草案与异常隔离。
- 协议测试验证 auth/ready/capability 已完全删除，JSON `messageType` heartbeat、任意 matcher、custom adapter 与 raw wire 比较各走唯一分支。
- Playwright 在 Chromium、Firefox、WebKit 验证两页广播、keyed 单一执行、关闭/freeze/lease 交接，以及 hook 更新下一次 URL/delay。
- 安全测试验证完整 URL、任意业务 reconnect reason、hook 异常与 payload 不出现在 fingerprint、diagnostics、logger、控制错误或响应。
- 发布验收从真实 tarball 验证删除后的公开类型、三入口、SSR import、生成 Worker 与无私有 workspace 泄漏。

## Out of Scope

- endpoint 模板、Worker 内 getter、连接变量 register、`setVar`、`clearVar`、`varchange`。
- 协议帧驱动的重连延迟指令。
- 入站 checker、dedupe cache、幂等 hook、业务消息 ID、服务端 Ack、RPC/request、topic 与持久化。
- 把 execution key 当作分布式锁或授权边界。
- 向浏览器 WebSocket API 增加不可用的原生 ping/pong 控制帧接口。
- hook 修改共享连接身份、protocol、队列、背压、租约或资源上限。

## Deletion and Revision Matrix

| Area | Delete | Revise / retain |
| --- | --- | --- |
| Public facade | Auth 泛型、auth/revision exports、`capabilities`、`idempotencyKey`、reconnect reason | 固定 URL、`sendMessage`、key API、reconnect hook |
| shared | auth/ready/capability 类型与对应错误码 | async handler/signal、稳定 reconnect reason、heartbeat 分层类型 |
| config | auth/capability/ready canonical 字段 | endpoint 排除于共享身份；按 raw/JSON/custom 校验 heartbeat |
| protocol | auth template、placeholder、ready 分类 | encode/decode、data/ping/pong/ignore/fatal、任意 JSON matcher |
| connection | revision register、authReady/sendAuth、handshaking | native-open 状态机、统一 plan、heartbeat/queue/backpressure |
| transport | auth 方法、认证重放、任意 reconnect reason | key/hook 只在 attach 后同步；stale plan 防护 |
| worker control | auth 帧、revision receipt、capability/ready schema | 新 control major 下的 exact-key parser 与安全原因码 |
| worker runtime | auth 路由、完整初始 URL 冲突 | 同 id 共享配置冲突、attempt endpoint、key/reconnect 仲裁 |
| docs/tests | auth/revision/ready/idempotency 示例与断言 | 外部 getter、应用消息边界、三种 heartbeat 与迁移说明 |
| generated/release | 手写 inline Worker、直接改版本或 CHANGELOG | 生成脚本、现有 Changeset、真实 tarball 验收 |

预计涉及文件：

- `packages/core/src/shared/{types,errors}.ts` 与 `packages/core/src/index.ts`；
- `packages/core/src/config/{normalize,README}.ts|md`；
- `packages/core/src/protocol/{adapter,README}.ts|md`；
- `packages/core/src/connection/{controller,state,queue,revision,README}.ts|md`；
- `packages/core/src/transport/{direct,shared-worker,README}.ts|md`；
- `packages/core/src/worker/{control,runtime,README}.ts|md`；
- `packages/core/src/page/{client,README}.ts|md`；
- `packages/socketfuse/src/{index,protocol}.ts`、`packages/socketfuse/src/api/create-websocket.ts`；
- 对应测试、docs、playground、三浏览器 E2E、release verify、生成 Worker 与 Changeset。

## Implementation Order After Approval

1. 重建 tickets：协议/auth 边界删除；endpoint/reconnect 生命周期；heartbeat 分层；key freeze 正确性；docs/playground/release。
2. 先删除 auth/ready/capability/revision 纵切面，使公开类型、connection 与控制协议同时形成可编译边界。
3. 收敛 endpoint 身份与 reconnect plan，统一自动/显式路径并改为总 deadline。
4. 调整 heartbeat wire/timing 分层，补 raw、JSON `messageType` 与 custom adapter 测试。
5. 补 key freeze 的本地保守 gate、Worker 转移和三浏览器验收。
6. 同步 README/docs/playground/Changeset，并通过生成脚本重建 inline Worker。
7. 依次运行完整验证，最后执行 standards/spec 双轴 code-review。

## Further Notes

- 无 holder 窗口中的 keyed handler 不执行且不补偿；重复业务消息也不会由库过滤。恢复、游标与幂等由业务封装。
- 页面 getter 的正确性、凭据来源和耗时由业务负责。库只保证在有效准备窗口内成功提交的 reconnect plan 原子应用。
- hook 总等待受单个 plan deadline 限制；候选越多不会线性增加最坏恢复时间。可见性偏好是优化，正确性依赖 freeze、lease 与 plan generation。
- `id` 仍只是共享复用标识，execution key 与 reconnect plan 都不是授权机制。
