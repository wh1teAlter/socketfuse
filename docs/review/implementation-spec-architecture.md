# 架构 review

- **P1** `worker/runtime.ts:478`、`transport/direct.ts:134`：endpoint 被重连 plan 覆盖后，`hasEndpointOverride` 跳过新页面的初始 URL 冲突检查，使任意 URL 的同 id 页面可静默复用，违反“初始 URL 一致、冲突显式失败”。应保存不可变 initial URL 并始终校验。
- **P2** `worker/exclusive-keys.test.ts:6`、`test/e2e/specs/playground.spec.ts:111`：缺少 holder close、lease 失效、hidden 不抢占及 SharedWorker 同页多 handler/权威 regrant；三浏览器转移矩阵未完整落地。请补 runtime/page/E2E 用例。

## Resolution

- 用户后续批准的 ADR 0003 与 accepted spec 明确把 endpoint 定义为单次尝试输入，不属于共享身份；
  因此前一条 P1 的“初始 URL 必须一致”前提已失效。最终实现允许同 `id`、同共享配置、不同 URL
  加入既有连接，后来页面不能覆盖当前 endpoint；连接条目释放后由新创建者提供初始 URL。
- P2 已补 Worker runtime 的 hidden、close、lease 失效、freeze stale-grant 屏障与权威恢复用例；
  同页多 handler、AbortSignal 与 direct 边界由 page client 单测覆盖，三浏览器结果以最终验收为准。
