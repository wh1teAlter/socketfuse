---
status: accepted
---

# Worker 扩展优先准备连接尝试，页面 hook 作为回退

当应用在 Worker 内提供了连接尝试准备扩展时，重连计划直接交给它，不再选择候选页面；只有没有该扩展时才回退到 ADR 0001 的页面候选机制。endpoint 轮换与凭据刷新本质是连接级决策，让它在 Worker 内完成可以整体跳过候选选择、可见性偏好与候选转移，从而消除「恢复时间随候选页面数放大」和「候选页面中途冻结」这两类竞态。

同一个计划只允许一个准备来源：扩展存在即页面 hook 不参与该计划的提交，避免出现两个提交源——这正是 ADR 0003 要求「endpoint 只能由当前有效计划提交」的初衷。

## Consequences

- 动态范围仅限 endpoint 与 delay。`heartbeat`、`queue`、`limits` 等共享参数参与 canonical/fingerprint，是多标签页共识的一部分；运行时单方面修改会使「相同 `id` 必须相同共享配置」失效，因此不开放。
- 扩展准备允许异步（凭据刷新天然异步），但复用 `autoReconnect.hookTimeout` 作为整个计划的总期限；超时沿用当前 endpoint 与默认退避。
- 提交仍走 `ConnectionController.commitReconnectPlan` 的既有守卫：未 dispose、计划代际匹配、delay 为非负有限数、URL 为绝对 `ws:`/`wss:`。不新增第二条提交路径。
- 页面 `onBeforeReconnect` 保持公开可用，内联 Worker 场景仍依赖它；它降级为回退路径而非被删除。
- 扩展抛错或超时不改变 endpoint，也不把异常文本跨端口传播，只上报稳定原因码。
