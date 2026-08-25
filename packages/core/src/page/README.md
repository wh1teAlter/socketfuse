# page

此模块将 transport 包装为稳定的页面 `WebSocketClient`，拥有 EventTarget、动态 `onMessage`、页面隐藏/恢复、listener 清理和最新 endpoint/auth revision 的重放。

它不直接拥有共享 socket；`close` 仅释放当前逻辑 client，`dispose` 才是不可恢复终态。恢复只提供有界、尽力而为的消息回放，不是可靠投递。

应用代码通过 `createWebSocket` 获得该行为，不直接实例化页面 client。
