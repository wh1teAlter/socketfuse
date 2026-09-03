# Runtime review

- **P1** `onMessage({key})` / `onBeforeReconnect()` 在未 open 或已 close 时仍触发 Worker hello（`page/client.ts:308-365`，`shared-worker.ts:273-320`）：未打开页可占 key，关闭页可重新附着。注册应仅缓存，open 后再同步；补两种时序测试。
- **P1** key 超限失败后仍残留 desired set；随后 `open()` 重试注册并被同一错误阻断（`shared-worker.ts:200-220,273-286`），违反“超限不影响连接”。应回滚失败，且不应 reject open；补超限后 open/无 key 收帧测试。

验证：64 tests、typecheck 通过；未构建 dist。

## Resolution

- P1 已让 SharedWorkerTransport 在未 attach 时只缓存 key/hook 意图，`open()` 后才向 Worker
  同步；close/dispose 会撤销页面权威状态并忽略后续事件。
- `RESOURCE_LIMIT_EXCEEDED` 在同步注册与 open 重放时都会回滚 desired key；open 继续建立连接，
  错误通过页面既有安全 error sink 报告。
- 第二轮 review 继续修复了三项边界：hidden 页面返回时先 probe Worker 权威、grant 投递失败递归
  回收时不重复扣减全局 key 配额、WebSocket 构造异常也进入统一 reconnect plan。最终命令结果以
  本轮串行验收记录为准。
