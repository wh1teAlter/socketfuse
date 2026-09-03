# 03 — 统一所有重连入口的 reconnect plan 生命周期

**What to build:** 让 Worker 用同一套 generation-safe reconnect plan 管理网络断开、连接超时、heartbeat 超时和显式 `reconnect()`，并由一个健康页面在总截止时间内原子提交该次尝试的 URL 与 delay。

**Blocked by:** 01 — 删除应用协议状态；02 — 明确 URL 是连接尝试输入

**Status:** completed

## Scope

- 首次 `open()` 不触发 hook；此后的网络断开、连接超时、heartbeat 超时和显式 `reconnect()` 全部创建 reconnect plan。
- 公开 `reconnect()` 不接受任意 reason；显式重连仍走 plan，默认 delay 为 `0`。
- 自动重连使用已确认的 retry/backoff 公式计算 `attempt`、`reason` 和 `defaultDelay`，并保持稳定期后的 attempt 重置语义。
- 每个 plan 只选择一个 attached、活跃且可用的页面候选执行 `onBeforeReconnect`；冻结、detach、lease 失效、注销、异常时按候选顺序转移。
- hook context 只暴露稳定 reason、attempt、defaultDelay、`AbortSignal`、`setOptions({ url })` 和 `setDelay(ms)`。
- `hookTimeout` 是整个 plan 的单一总截止时间；候选切换复用剩余时间，不为每个候选重置计时器。
- 仅当前 generation/current owner 的完成结果可提交；URL 与 delay 在 hook 成功完成后一次性原子提交。
- 所有候选失败或总截止时间耗尽时回退到 plan 初始 URL 与默认 delay。

## Invariants

- hook 在页面执行，Worker 不执行函数；物理连接创建和 reconnect timer 始终由 Worker/controller 权威管理。
- `setOptions()` 只接受固定 URL 字符串，且只修改当前 plan 草稿；不能写入共享配置或未来 plan。
- abort、过期、重复完成、旧 owner 和旧 generation 的提交都不能改变 endpoint、delay 或 timer。
- hook 异常内容、完整 URL、query 与内部 plan id 不进入 diagnostics、logger 或跨页面错误回显。
- reconnect plan 不等待业务认证、业务 ready、Ack、游标或 handler 完成。

## Acceptance

- [x] 四类重连入口均走相同 plan 状态机；首次 open 不调用 hook。
- [x] 显式 reconnect 的默认 delay 为 0，但页面可通过同一 hook 覆盖 URL 和 delay。
- [x] 多页面场景每个 generation 最多一个候选同时拥有提交权，候选失活后能在剩余预算内转移。
- [x] 总 hookTimeout 不因候选切换延长；耗尽后使用默认计划且只创建一次物理连接。
- [x] URL 与 delay 原子生效；partial、late、duplicate 和 stale completion 全部被忽略。
- [x] retry attempt、backoff、jitter 边界和稳定期重置都有确定性单元测试。

## Verification

- `pnpm typecheck`
- `pnpm test`
- `git diff --check`
