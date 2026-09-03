# worker

此模块拥有 SharedWorker 控制协议、端口资源和共享连接池。它验证来自页面的每个控制 envelope，重建共享配置，并向每个端口有界派发事件。

Worker 不等待页面的 `onMessage` handler；页面 receipt 只归还传输 credit，不构成业务确认。端口、未附着 timer、lease 和连接池条目都必须在失败与 dispose 时释放。

连接作用域业务扩展由应用通过 `createExtension` 工厂提供，每条共享连接实例化一次。入站过滤在 fan-out 之前判定，因此被丢弃的帧不消耗任何页面的投递额度；准备函数存在时由它接管重连计划，页面候选机制不再参与该连接。扩展是业务代码：其异常一律隔离，不影响连接状态机，异常文本也不跨端口传播。每帧回调必须同步——Worker 是全部标签页共享的单线程，阻塞会放大为全局延迟，破坏「不等待页面」不变量。扩展状态在 Worker 被浏览器回收后丢失，`onSocketOpen` 只提供重建时机。

execution key 的候选与 holder、以及 reconnect plan 的候选选择属于本模块。Worker 只发送 grant/revoke 或 plan 控制帧，不把持有信息附在业务消息上，也不跨 MessagePort 执行页面函数。可见性只影响下一次选择；明确 freeze、端口移除和 lease 失效必须撤销当前授权。

自定义 Worker 应从 `socketfuse/worker` 调用 `exposeSharedWebSocketWorker`，而不是导入此私有路径。
