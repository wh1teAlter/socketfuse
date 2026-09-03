# page

此模块将 transport 包装为稳定的页面 `WebSocketClient`，拥有 EventTarget、动态 `onMessage`、execution key gate、页面重连 hook、页面隐藏/恢复和 listener 清理。

页面只通过 transport 的 grant 获得执行权；key revoke 或明确 freeze 会保守停止执行并 abort 对应 handler context。页面从 hidden 返回时会先 gate keyed handler 并验证 Worker 端口，防止 lease 已转移后继续使用旧授权；恢复后只接受同一 Worker 的已确认状态或新端口 grant。重连 hook 只修改本地草案，成功返回后由 transport 原子提交。

它不直接拥有共享 socket；`close` 仅释放当前逻辑 client，`dispose` 才是不可恢复终态。恢复只提供有界、尽力而为的消息回放，不是可靠投递。

应用代码通过 `createWebSocket` 获得该行为，不直接实例化页面 client。
