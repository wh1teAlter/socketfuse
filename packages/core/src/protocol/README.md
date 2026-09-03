# protocol

此模块定义消息协议适配器：原生 raw、声明式 JSON 以及在自定义 Worker 中静态注册的 adapter。

adapter 的函数只在 Worker 中执行，不能跨 `MessagePort` 传输。其 id、版本与共享配置构成共享连接身份的一部分，因此同一 `id` 不能静默混用不同协议行为。

raw 的顶层 heartbeat 由 connection 严格比较 payload；JSON/custom 继续由 adapter 生成和分类。浏览器原生 WebSocket Ping/Pong 不暴露到本模块。

应用代码从 `socketfuse/protocol` 导入 `rawProtocol` 和 `ProtocolAdapter` 契约。
