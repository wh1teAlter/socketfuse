# 诊断与错误

`diagnostics()` 返回最近接收的安全样本，并触发一次合并后台刷新。`observedAt` 是本页收到样本的时间，`connectionEpoch` 标识条目，`attempt` 是该 epoch 的物理尝试数，`retriesUsed`、`retriesRemaining`、`retryReserved` 独立表示预算。

其他字段包括 transport、逻辑/物理状态、稳定哈希、当前 endpoint origin、队列、缓冲量、参与数和最近安全关闭码/错误码。它不含 endpoint 路径或查询、认证值、业务 payload、内部异常文本或堆栈。

`SocketFuseError` 只接受稳定 code 和 fatal/retryable 标记，message 由库映射，不支持 details/cause。应用即使抛出一个自制 SocketFuseError，也会在外部调用边界按阶段重建；不会把任意错误文本或元数据发往其他页面。

常见错误有 `CONNECTION_CONFIG_CONFLICT`、`ADAPTER_NOT_REGISTERED`、`WORKER_DISCONNECTED`、`RESOURCE_LIMIT_EXCEEDED`、`MESSAGE_TOO_LARGE`、`BACKPRESSURE`。`PROTOCOL_CONTRACT_VIOLATION` 表示同步协议返回 thenable，为终止性错误。

重连的 `RETRY_EXHAUSTED` 不等于 fatal；不同计数请求冲突报 `RECONNECT_IN_PROGRESS`，旧计划报 `STALE_RECONNECT_PLAN`，未结算准备来源饱和报 `PREPARATION_BUSY`。发送已 post 后丢失确认可能报 `SEND_OUTCOME_UNKNOWN`，不能据此断言服务器未收到。

优先匹配 `code`，不要匹配文本。完整联合见 [SocketFuseErrorCode](../api/generated/index/type-aliases/SocketFuseErrorCode.md)。
