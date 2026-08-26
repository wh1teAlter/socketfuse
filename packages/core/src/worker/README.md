# worker

此模块拥有 SharedWorker 控制协议、端口资源和共享连接池。它验证来自页面的每个控制 envelope，重建共享配置，并向每个端口有界派发事件。

Worker 不等待页面的 `onMessage` handler；页面 receipt 只归还传输 credit，不构成业务确认。端口、未附着 timer、lease 和连接池条目都必须在失败与 dispose 时释放。

自定义 Worker 应从 `socketfuse/worker` 调用 `exposeSharedWebSocketWorker`，而不是导入此私有路径。
