# 连接作用域 Worker 业务扩展规格

> 状态：accepted。依据 [ADR 0004](../../docs/adr/0004-connection-scoped-worker-extensions.md) 与
> [ADR 0005](../../docs/adr/0005-worker-owned-attempt-preparation.md)。术语以 [CONTEXT.md](../../CONTEXT.md) 为准。
> 本文档同时是实施方案：每个决策都给出接口、插入点与逻辑伪代码，实现时按 §Implementation Decisions 逐条落地。

## Problem Statement

应用把「所有标签页共同需要的逻辑」放在页面里，会被迫处理三类本不属于业务的复杂度：

1. **入站重复消息**：服务端重发或断线补发的同一条业务帧会广播到每个标签页，每页各自判重。判重结果无法共享，N 个标签页做 N 次相同判断，且重复帧仍然完整穿过 `MessagePort` 并消耗每页的投递额度。
2. **重连前的凭据刷新**：endpoint 上的 token 需要在下一次连接尝试前刷新。当前只能由某个候选页面在 `onBeforeReconnect` 内完成，于是应用必须应对候选页面被冻结、被回收、提交过期等纯属机制的失败模式，而这些与「刷新一个 token」毫无关系。
3. **共享的连接期状态**：服务端在连接建立后的首帧告知服务器时间，后续每帧携带递增时间戳，ping/pong 也需要携带。这份时钟对整条共享连接只有一个真值，但放在页面里就变成每页一份，且无法保证一致。

execution key 不解决这三者。key 决定「哪个标签页执行副作用」，而这里要决定的是「哪些帧值得派发」与「下一次连接用什么参数」——不同的问题。用 key 表达入站过滤，帧依然会广播到全部页面并消耗额度。

## Solution

应用在自己的 SharedWorker 文件中提供**连接作用域业务扩展**，由 Worker 按共享连接执行一次：

- **入站过滤**：在帧 fan-out 给任何标签页之前判定「继续派发或整条丢弃」。丢弃发生在投递之前，因此不消耗任何页面的投递额度。
- **连接尝试准备**：在下一次物理连接尝试前提交 endpoint 与延迟，不需要选择候选页面，因此不受页面冻结影响。
- **连接生命周期回调**：给出「共享连接建立」与「物理 socket 打开」的明确时机，让扩展知道何时重建自己的状态（SharedWorker 可被浏览器整体回收，状态必须可重建）。

页面职责不变：在主线程创建 client、声明初始配置、注册本页面的事件响应。页面声明式 JSON 配置仍是默认路径，不被取代。

同时修复审查发现的 P0/P1 级缺陷 F-001：逻辑 `close()` 永久占用 Worker 端口额度，最终使新标签页静默失去连接共享。

## User Stories

1. 作为多标签页应用开发者，我希望入站消息去重在共享连接上只做一次，从而不必在每个标签页重复实现判重。
2. 作为多标签页应用开发者，我希望被判为重复的帧不投递给任何标签页，从而不消耗页面的投递额度与端口带宽。
3. 作为多标签页应用开发者，我希望去重逻辑与 wire format 解码分离，从而修改判重规则时不影响编解码。
4. 作为业务开发者，我希望在 Worker 内维护一份服务器时钟，从而所有标签页看到一致的时间基准。
5. 作为业务开发者，我希望 ping 帧能携带当前最新的服务器时间戳，从而服务端可以校验时序。
6. 作为业务开发者，我希望时间戳的语义完全由我定义，库不解释也不校验它。
7. 作为业务开发者，我希望在下一次连接尝试前刷新 endpoint 上的凭据，而不必依赖任何页面处于活跃状态。
8. 作为业务开发者，我希望凭据刷新可以是异步的，从而能调用真实的 token 接口。
9. 作为业务开发者，我希望凭据刷新超时后连接仍按原 endpoint 与默认退避继续，从而不会因刷新失败彻底断连。
10. 作为运维人员，我希望恢复时间不随标签页数量放大，从而多开标签页不会拖慢重连。
11. 作为应用维护者，我希望创建 Worker 的标签页被冻结或关闭后，共享逻辑继续正常运行，从而不出现「第一个标签页决定所有人命运」。
12. 作为应用维护者，我希望所有标签页都被冻结期间共享连接仍然存活，从而恢复时不需要重建连接。
13. 作为扩展作者，我希望在共享连接建立时收到回调，从而初始化我的去重表与时钟。
14. 作为扩展作者，我希望在每次物理 socket 打开时收到回调，从而在重连后重置连接期状态。
15. 作为扩展作者，我希望明确知道 Worker 可能被浏览器回收、我的状态会丢失，从而设计成可重建而非依赖永续。
16. 作为扩展作者，我希望入站过滤是同步的，从而不会因为我的代码拖慢所有标签页的消息投递。
17. 作为扩展作者，我希望我的过滤函数抛错时消息按放行处理，从而一个 bug 不会导致全局消息静默丢失。
18. 作为扩展作者，我希望我的准备函数抛错时 endpoint 不被修改，从而失败是安全的。
19. 作为扩展作者，我希望我的异常文本不跨端口传播到其他标签页，从而不泄漏内部实现细节。
20. 作为页面开发者，我希望不使用扩展时一切行为与现在完全一致，从而升级不产生破坏。
21. 作为页面开发者，我希望继续用 `onBeforeReconnect` 在页面里准备重连，从而内联 Worker 的零配置路径仍然可用。
22. 作为页面开发者，我希望当 Worker 提供了准备扩展时，页面 hook 不再被调用，从而不出现两个提交源导致的竞态。
23. 作为使用内联 Worker 的开发者，我希望只用声明式 JSON 配置就能完成常见场景，从而不必部署 Worker 文件。
24. 作为需要页面副作用单点执行的开发者，我希望 execution key 仍然可用，从而「只弹一次通知」这类需求仍有解。
25. 作为架构评审者，我希望文档说明入站过滤与 execution key 各自适用的场景，从而团队不会误用。
26. 作为长期运行 SPA 的用户，我希望反复打开关闭标签页后新标签页仍能共享连接，从而不会退化成每页一条连接（F-001）。
27. 作为安全审计者，我希望扩展不能读取或修改共享配置指纹，从而多标签页配置冲突检测仍然可信。
28. 作为安全审计者，我希望扩展只能修改 endpoint 与延迟，不能修改 heartbeat、queue、limits 等共享参数。
29. 作为安全审计者，我希望完整 endpoint 与 query 不因新增扩展而进入诊断、日志或控制回显。
30. 作为库维护者，我希望新增能力不引入新的提交路径，从而 endpoint 的唯一写入点仍是当前有效计划。

## Implementation Decisions

### D1 — 新增公开类型：连接作用域扩展工厂

`socketfuse/worker` 新增导出。扩展是**工厂**而非单例：每条共享连接调用一次，返回该连接独占的扩展实例，使状态天然按连接隔离。

```ts
/** 传给扩展工厂的连接身份；不含完整 endpoint、query 与凭据。 */
interface ConnectionExtensionContext {
  readonly connectionId: string        // 业务 id
  readonly endpointOrigin: string      // 仅 origin，与 diagnostics 同口径
  readonly attempt: number             // 当前物理连接尝试计数
}

/** 入站过滤判定结果。 */
type InboundDecision = 'deliver' | 'drop'

/** 连接尝试准备上下文；能力最小化，只允许改 endpoint 与 delay。 */
interface AttemptPreparationContext {
  readonly attempt: number
  readonly defaultDelay: number
  readonly reason: BeforeReconnectReason   // 复用既有安全原因码
  readonly close: SafeCloseInfo
  readonly signal: AbortSignal             // 计划失效/超时即 abort
  readonly setOptions: (options: { readonly url: string }) => void
  readonly setDelay: (delay: number) => void
}

/** 一条共享连接的业务扩展实例。 */
interface ConnectionExtension {
  /** 物理 socket 打开时调用；用于重置连接期状态。同步、不得抛出。 */
  readonly onSocketOpen?: (context: ConnectionExtensionContext) => void
  /** 每条已解码业务帧的过滤判定。必须同步；抛出按 'deliver' 降级。 */
  readonly filterInbound?: (data: unknown, context: ConnectionExtensionContext) => InboundDecision
  /** 准备下一次连接尝试；允许异步，受计划总期限约束。 */
  readonly prepareAttempt?: (context: AttemptPreparationContext) => void | Promise<void>
  /** 连接条目释放时调用；用于释放扩展自有资源。 */
  readonly dispose?: () => void
}

/** 扩展工厂：每条共享连接调用一次。 */
type ConnectionExtensionFactory = (context: ConnectionExtensionContext) => ConnectionExtension
```

`SharedWebSocketRuntimeOptions` 增加一个可选字段 `createExtension?: ConnectionExtensionFactory`。其余六个既有字段不变。

**为何是工厂**：`ConnectionEntry` 按 `id` 建立且可被 `removeIdleConnection` 回收后重建。工厂让「连接重建 → 状态重置」成为结构保证，而非依赖扩展作者自觉。

### D2 — 入站过滤的插入点与分层约束

过滤必须在 `handleFrame` 的 `data` 分支、fan-out 循环**之前**。这是唯一能同时满足「每帧每连接一次」与「不消耗投递额度」的位置：额度记账在 `deliver()` 内，而 `deliver` 只在 fan-out 之后被 sink 触发。

**分层约束（必须遵守）**：`connection` 不得依赖 `worker`（AGENTS.md）。因此过滤函数以 `ConnectionControllerOptions` 的可选回调注入，由 `worker/runtime` 在构造 controller 时传入。`connection` 只认识一个 `(data) => boolean` 形状，不认识「扩展」这个概念。

```
ConnectionControllerOptions 新增：
  readonly shouldDeliverInbound?: (data: Incoming) => boolean

handleFrame 的 data 分支（在既有 raw-heartbeat 比较之后、fan-out 之前）：

  if frame.type !== 'data'            -> return        // 既有
  if state !== 'open'                 -> return        // 既有
  if raw heartbeat response matches   -> ack; return   // 既有

  // 新增：入站过滤
  if shouldDeliverInbound is defined:
      try:
          deliver = shouldDeliverInbound(frame.data)
      catch:
          deliver = true                        // 抛出按放行降级
          record diagnostic: code=EXTENSION_FILTER_FAILED
      if deliver is false:
          return                                // 整条丢弃，零额度、零端口投递

  for sink in sinks: sink.onMessage(frame.data, now)    // 既有
```

**降级方向必须是「放行」**：静默丢弃全局消息是比重复投递严重得多的故障。

### D3 — Worker 内连接尝试准备，复用既有接管契约

`ConnectionController.dispatchReconnectPlan` 已有 boolean 接管契约：`onReconnectPlan` 返回 `true` 表示上层异步接管提交，返回 `false`/抛出则 controller 立即用默认值提交。**不新增提交路径**，只在 `worker/runtime` 里改变「谁接管」。

```
worker/runtime 构造 controller 时：

  onReconnectPlan: plan =>
      if extension?.prepareAttempt is defined:
          return startWorkerPreparation(plan)      // 扩展接管，返回 true
      return reconnect.start(plan)                  // 既有页面候选路径

startWorkerPreparation(plan):
      abort = new AbortController()
      draft = {}                                    // { url?, delay? }
      timer = setTimeout(() => {
          abort.abort()
          commitIfCurrent(plan.id, {})              // 超时用默认计划
      }, hookTimeout)                               // 复用 autoReconnect.hookTimeout

      context = frozen {
          attempt, defaultDelay, reason, close, signal: abort.signal,
          setOptions: ({url}) => {
              if abort.signal.aborted -> throw STALE_RECONNECT_PLAN
              draft.url = normalizeReconnectUrl(url)   // 复用页面侧同一校验
          },
          setDelay: (delay) => {
              if abort.signal.aborted -> throw STALE_RECONNECT_PLAN
              if not finite non-negative -> throw INVALID_OPTIONS
              draft.delay = delay
          },
      }

      run async:
          try:
              await extension.prepareAttempt(context)
              if abort.signal.aborted -> return          // 已超时/已失效
              clearTimeout(timer); abort.abort()
              commitIfCurrent(plan.id, draft)            // URL+delay 原子提交
          catch error:
              if abort.signal.aborted -> return
              clearTimeout(timer); abort.abort()
              record diagnostic: code=EXTENSION_PREPARE_FAILED   // 不含异常文本
              commitIfCurrent(plan.id, {})               // 失败沿用原 endpoint
      return true

commitIfCurrent(planId, override):
      try: controller.commitReconnectPlan(planId, override)
      catch: swallow        // 计划已被 close/dispose 取代，不得冒泡为未捕获异常
```

提交仍由 `commitReconnectPlan` 的四道既有守卫把关：未 dispose、plan id 与当前代际一致、delay 非负有限、URL 为绝对 `ws:`/`wss:`。

**互斥语义**：扩展提供 `prepareAttempt` 时，`ReconnectCoordinator` 完全不参与该连接的计划，页面 `onBeforeReconnect` 不会被调用。页面若已注册 hook，仍可注册成功（不报错），但对该连接无效——需在文档中明示。

### D4 — 生命周期回调时机

- `onSocketOpen`：在 `ConnectionController.becomeOpen` 通知 sink 之后调用，保证扩展先于页面观察到 open？**否——顺序相反**：扩展在 sink 通知**之前**调用，因为扩展可能需要重置时钟，而页面收到 open 后可能立刻发消息。以 controller 新增可选回调 `onSocketOpen?: () => void` 注入，同样不让 `connection` 认识扩展。
- `dispose`：在 `removeIdleConnection` 删除条目、`controller.dispose()` 之后调用。
- 两者都同步、都用 try/catch 包裹，抛出只记诊断，不影响连接状态机。

### D5 — F-001 端口额度回收（独立于扩展，可先行落地）

根因：`scheduleLeaseSweep` 只遍历 `clients`，而逻辑 `close` 已把 port 从 `clients` 删除，故 sweep 永远看不到它；`unattachedPortTimeoutMs` 的 timer 又已在 hello 成功时清除。结果端口永久占用 `maxPorts`。

```
新增模块状态：
  closedPorts: Map<MessagePortLike, number>     // port -> 进入 close 的时间戳

detach(port, closePort, releasePort):
      ... 既有逻辑 ...
      if releasePort:
          ... 既有释放 ...
          closedPorts.delete(port)              // 真正释放时一并清理
      else if client was attached:
          closedPorts.set(port, now())          // 登记为「已 close 仍占额度」

hello 成功提交 client 后：
      closedPorts.delete(port)                  // 重新 open，不再是待回收状态

lease sweep 每轮追加：
      for (port, closedAt) of closedPorts:
          if now() - closedAt > graceForClosedPort:
              detach(port, true)                // 关闭并释放额度

其中 graceForClosedPort 取该连接的 lease.timeout；无法定位连接时取
DEFAULT_LEASE_OPTIONS.timeout。
```

保留原设计意图（防止大量未计数通道绕过 `maxPorts`），只把「永久占用」改为「按 lease 超时回收」。

**同时必须修改** `runtime.test.ts` 中断言「close 后新端口被拒」的测试——它把缺陷固化成了预期，是该问题长期存在的原因。改为断言「lease 超时后额度被回收」。

### D6 — 错误码

复用现有 `SOCKET_FUSE_ERROR_CODES`，不新增公开错误码。扩展失败以诊断事件上报，`code` 取既有 `INTERNAL_STATE_ERROR`；诊断 `details` 只含白名单原始值，不含异常文本或 stack。

理由：新增公开错误码会进入稳定契约，而扩展失败对页面不可操作（页面无法修复 Worker 内的业务 bug），不值得占用错误码空间。

### D7 — 文档同步

- `packages/core/src/worker/README.md`：扩展的职责与「不等待页面」不变量的关系。
- `packages/docs/site/guide/` 新增一节：**入站过滤 vs execution key 的选择边界**——纯数据处理（去重、过滤、共享时钟）用扩展；页面副作用（通知、存储、路由）用 key。
- `packages/docs/site/protocols/custom-adapter.md`：说明 adapter 保持无状态、状态归扩展。
- 顺带修 F-006：`MessageHandlerOptions.key` 的 TSDoc「至多由一个页面**执行**」→「至多授权一个页面**启动**」。

## Testing Decisions

**好测试的标准**：只断言公开行为——从 `createSharedWebSocketRuntime` 注入、从 `SharedWorkerTransport` 的 sink 观测。不读取 `closedPorts`、`extension` 等私有字段，不断言 timer 句柄。

**seam：单一，零新增。** 全部经 `createSharedWebSocketRuntime(options)` 观测，它已是 `runtime.test.ts` 中 8 处在用的注入点，也是新 API 的真实入口。

| 待验证行为 | 观测方式 | 既有先例 |
|---|---|---|
| 过滤丢弃帧对所有 tab 生效 | 两个 transport 的 `onMessage` 序列 | runtime.test.ts 广播测试 |
| 丢弃帧不消耗投递额度 | 灌 257 帧含部分被过滤，健康页仍全收 | runtime.test.ts 额度测试 |
| 过滤函数抛错按放行降级 | 帧仍到达全部 tab | 新断言，同 seam |
| 扩展改写下次连接 URL | `socketFactory: (url) => urls.push(url)` | runtime.test.ts 现成手法 |
| 扩展优先，页面 hook 不被调用 | 页面 `onBeforeReconnect` 未触发 | runtime.test.ts 转移测试 |
| 扩展超时回退默认计划 | 注入 `setTimeout` + 断言沿用原 URL | runtime.test.ts fake timer |
| 扩展抛错不改 endpoint | 同上 | 同上 |
| `onSocketOpen` 在重连后再次触发 | 回调调用序列 | 新断言，同 seam |
| 每连接一个扩展实例 | 工厂调用次数与连接数一致 | 新断言，同 seam |
| F-001 额度回收 | N 次 attach→close 后新端口可 hello | runtime.test.ts:910（**需改**） |

**E2E 补 1 条**（三浏览器）：两 tab 共享连接下，Worker 过滤对全部 tab 同时生效。走 `playground.spec.ts` 既有 namespace + stats 模式，playground 以 URL 参数开启一个演示扩展。

**不新增类级单测**：新语义只在「Worker + 多端口 + 真实控制协议」组合下成立，降到 `ExclusiveKeyRegistry` 那种类级会变成断言实现细节。

## Out of Scope

- 修改除 endpoint/delay 之外的共享配置（heartbeat、queue、backpressure、lease、limits）。它们参与 canonical/fingerprint，是多标签页共识，运行时单方面修改会使配置冲突检测失效。
- 让 Worker 补全或声明配置、页面只传 `id`。Worker 现在会完整重算 canonical 并硬比对，让 Worker 改变 canonical 会使比对必然失败。
- 库内置去重、幂等、服务端 Ack、exactly-once。ADR 0002 已将其划归应用。
- 扩展状态的持久化（IndexedDB 等）。Worker 被回收即状态丢失，由 `onSocketOpen` 提供重建时机。
- 删除 execution key。它是页面副作用单点执行的唯一机制。
- 出站方向的扩展 hook（改写发送内容）。当前无需求，YAGNI。
- 运行时加载外部 JSON 配置文件。
- 修复审查中的 F-002（入站 4 MiB 单帧上限）、F-003（模块环）；它们进 beta.2。

## Further Notes

- **SharedWorker 生命周期已实测确认**（真实 Chromium + CDP `Page.setWebLifecycleState`）：创建者页面被冻结、被关闭、甚至所有页面全部冻结时，Worker 内的定时器与消息处理均持续运行。SharedWorker 属于 origin 而非创建页面，「谁先创建」在架构上是无关变量。这是本方案成立的前提。
- 但浏览器**有权**在内存压力或全部页面进入 BFCache 时终止 SharedWorker。库已有 `probe()` 校验 `workerInstanceId` 并重建 transport，且有 E2E 覆盖。因此扩展状态是 **at-least-once 语义，不是 exactly-once**，文档必须如实表达。
- `classify` 每帧每连接只跑一次（`OrderedProtocol` 是 controller 的单一字段），且 adapter 实例跨重连存活（`startSocket` 不重建它）。因此现有 custom adapter 的 `classify` 返回 `ignore` **已经能实现去重**——本规格的价值在于把这份状态从「无状态的格式规则」里搬出来，让接口职责单一，而非提供一个原本不可能的能力。
- Worker 是所有标签页共享的单线程。每帧扩展若引入 `await` 或重计算，会直接放大为全局延迟，破坏「Worker 不等待页面」不变量。这是 `filterInbound` 强制同步的唯一理由。
