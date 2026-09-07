# 诊断与错误

## 读取诊断

`diagnostics()` 同步返回最近收到的安全样本，并合并触发后台刷新；它不是等待最新 Worker 响应的 Promise。`observedAt` 表示本页收到样本的时间。

```ts
const sample = ws.diagnostics()
console.log(sample.transport, sample.attempt, sample.retriesRemaining)
```

| 字段组 | 含义 |
| --- | --- |
| `transport`、`logicalState`、`physicalState` | 页面接入方式和逻辑/物理状态 |
| `connectionEpoch`、`attempt` | 连接条目身份与该条目的物理尝试数 |
| `retriesUsed`、`retriesRemaining`、`retryReserved` | 已用、剩余与预留重连预算 |
| `queueMessages`、`queueBytes`、`bufferedAmount` | 库队列和原生发送缓冲 |
| `attachedClientCount`、`endpointOrigin` | 参与者数量与当前 endpoint origin |
| `lastSafeCloseCode`、`lastErrorCode` | 最近安全关闭码和库错误码 |

诊断不包含 endpoint 路径或查询、认证值、业务 payload、内部异常文本或堆栈。溢出情况通过 `overflow` 事件报告。

## 根据错误码处理

Promise 方法通过 rejection 失败，创建配置和同步注册 API 可能同步抛错。异步连接与协议错误还可通过 `onError` 或 `error` 事件观察。使用 `code` 分支判断，避免匹配英文 message。

| 错误码 | 含义与处理方向 |
| --- | --- |
| `CONNECTION_CONFIG_CONFLICT` | 同一 id 的共享配置不同；对齐配置或使用独立 id |
| `ADAPTER_NOT_REGISTERED` | custom 描述符没有匹配注册项；核对 Worker 的 id、version 和静态配置 |
| `WORKER_DISCONNECTED` | 已选通道失联；恢复仍使用原 transport |
| `RESOURCE_LIMIT_EXCEEDED` | 端口、注册或待决操作达到额度；减少并发和保留资源 |
| `MESSAGE_TOO_LARGE` | 超过相应消息预算；缩小消息或调整正确作用域的上限 |
| `BACKPRESSURE` | 原生发送缓冲达到阈值；按队列策略等待或处理失败 |
| `RETRY_EXHAUSTED` | 计数预算耗尽；不等于 fatal，也不会先关闭健康 socket |
| `RECONNECT_IN_PROGRESS` | 已有计划使用不同计数策略；当前计划保持不变 |
| `STALE_RECONNECT_PLAN` | 请求或 setter 不再属于有效计划 |
| `PREPARATION_BUSY` | 未结算准备调用已达到上限；取消不会强制结束应用 Promise |
| `PROTOCOL_CONTRACT_VIOLATION` | 同步协议 hook 返回 thenable；属于终止性错误 |
| `SEND_OUTCOME_UNKNOWN` | 发送提交后失去确认；无法断言消息未发送，不应盲目重发 |

`SocketFuseError` 的 message 由稳定 code 映射，构造选项只接受 fatal/retryable 标记，不支持任意 details/cause。应用抛出的自制错误也会按调用阶段重新映射，不把原文发送给其他页面。

完整联合见 [SocketFuseErrorCode](../api/generated/index/type-aliases/SocketFuseErrorCode.md)，重连与发送边界见[可靠性](../guide/reliability)。
