# connection

此模块只拥有一个物理 WebSocket 的状态机、连接尝试、重连、心跳、发送队列、背压和 endpoint/auth revision。

它不依赖 `page` 或 `worker`。调用者通过 `ConnectionSink` 接收状态与业务帧；sink 的慢速处理不能改变 socket 的推进与 Worker 的资源边界。

发送成功只代表本地 accepted 或 queued，不代表服务器确认。过期连接尝试和旧 revision 不能覆盖新状态。
