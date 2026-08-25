# 诊断与错误

`ws.diagnostics()` 提供安全的运行数据：transport、逻辑/物理状态、稳定哈希、endpoint origin、
重试、队列、缓冲量、已连接 client 数和最近一次安全错误/关闭码。

它刻意不包含认证值、URL 查询字符串、消息 payload 和内部错误堆栈。这样诊断可用于应用指标，
而不会成为数据外泄通道。

这一边界同样适用于 Worker 错误：其他标签页只会收到稳定的 WWS 错误码、WWS 所有的公开文本及
明确安全的原始值详情。适配器异常、服务端 payload、endpoint 路径、认证和 cause 都不会跨越
`MessagePort` 传播。

## 错误

错误是带有稳定 `code`、可读消息、可重试性与致命性标记的 `WwsError`。重要的建立错误包括
`WORKER_UNSUPPORTED`、`WORKER_CONSTRUCTION_FAILED`、`WORKER_INIT_TIMEOUT`、
`CONNECTION_CONFIG_CONFLICT` 与 `ADAPTER_NOT_REGISTERED`。运行时发送错误包括
`SEND_WHILE_DISCONNECTED`、`BACKPRESSURE` 和 `RESOURCE_LIMIT_EXCEEDED`。

请使用 `isWwsError()` 作为类型守卫，并优先使用 `code`，不要匹配可读消息。完整代码联合类型请参阅
生成的 [WwsErrorCode](../api/generated/index/type-aliases/WwsErrorCode.md)。
