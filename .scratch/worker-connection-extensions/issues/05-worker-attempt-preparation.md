# 05 — Worker 内连接尝试准备：不依赖任何页面刷新 endpoint

**What to build:** 扩展可以在下一次物理连接尝试前异步准备该次尝试的 endpoint 与延迟——典型用途是刷新 URL 上的凭据。准备在 Worker 内完成，**不需要选择候选页面**，因此不受页面被冻结、被回收或提交过期的影响，恢复时间也不随标签页数量放大。

提供该能力的扩展存在时，重连计划直接交给它，页面 `onBeforeReconnect` 不再参与该连接的计划——同一个计划只允许一个准备来源，避免两个提交源竞态。未提供时完全回退到既有的页面候选机制，内联 Worker 的零配置路径不受影响。

动态范围**仅限 endpoint 与 delay**。`heartbeat`、`queue`、`limits` 等共享参数参与配置指纹，是多标签页共识的一部分，运行时单方面修改会使「相同 `id` 必须相同共享配置」失效，因此不开放。

```ts
interface AttemptPreparationContext {
  readonly attempt: number
  readonly defaultDelay: number
  readonly reason: BeforeReconnectReason   // 复用既有安全原因码
  readonly close: SafeCloseInfo
  readonly signal: AbortSignal             // 计划超时或失效即 abort
  readonly setOptions: (options: { readonly url: string }) => void
  readonly setDelay: (delay: number) => void
}

interface ConnectionExtension {
  /** 允许异步；受计划总期限约束。 */
  readonly prepareAttempt?: (context: AttemptPreparationContext) => void | Promise<void>
}
```

**不新增提交路径**：仍复用 connection 既有的「计划分发返回是否被接管」契约与 `commitReconnectPlan` 的四道守卫（未 dispose、计划代际匹配、delay 非负有限、URL 为绝对 `ws:`/`wss:`）。

**Blocked by:** 01 — 复用收敛后的 endpoint 校验，避免第三处副本；03 — 扩展工厂与生命周期是准备 hook 的载体

**Status:** ready-for-agent

- [ ] 网络断开、连接超时、心跳超时与显式 reconnect 都会调用扩展的准备函数
- [ ] 首次 `open()` 不调用准备函数
- [ ] 准备函数成功返回后，URL 与 delay 一次性原子生效于下一次尝试
- [ ] 准备函数只提交 URL、只提交 delay、或都不提交，均正确回退到未覆盖的默认值
- [ ] 准备函数超过计划总期限（复用 `autoReconnect.hookTimeout`）时沿用当前 endpoint 与默认退避，且只创建一次物理连接
- [ ] 准备函数抛出异常时 endpoint 不被修改，连接仍按默认计划继续
- [ ] 超时或计划失效后调用 setter 以 `STALE_RECONNECT_PLAN` 拒绝，不影响已提交的计划
- [ ] 扩展提供准备函数时，页面 `onBeforeReconnect` 不被调用；未提供时页面候选机制行为与现状完全一致
- [ ] 提交非法 URL（非绝对、非 ws/wss、超长）以 `INVALID_OPTIONS` 拒绝且不改 endpoint
- [ ] 准备函数的异常文本与内部计划 id 不进入诊断、日志或跨端口回显
- [ ] 连接在准备期间被显式 close 或 dispose 时，迟到的准备结果不改变任何状态，也不产生未捕获异常
