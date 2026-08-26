# 协议

SocketFuse 将 transport 共享与消息语义分离。默认原始协议会原样转发 WebSocket 数据；JSON 协议增加
声明式 ready、auth 和 heartbeat 帧；无法通过声明式表达的协议可使用自定义适配器。

- [原始协议](./raw)
- [JSON 协议](./json)
- [自定义适配器](./custom-adapter)

所选协议属于共享配置的一部分。使用相同 `id` 的标签页必须选择等价的协议行为。
