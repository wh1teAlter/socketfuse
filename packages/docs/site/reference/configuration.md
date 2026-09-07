# 配置

共享配置由 `protocols`、`protocol`、`reconnect`、`connectionTimeout`、`heartbeat`、`queue`、`backpressure`、`lease`、`limits`、`idleGraceMs` 组成。相同 id 的完整 canonical 不一致会显式报 `CONNECTION_CONFIG_CONFLICT`，不以 hash 相等代替完整比较。

初始 URL 是绝对 ws/wss 字符串，不允许 userinfo 或 fragment，不参与共享指纹。后来页面的 URL 不覆盖存量连接；重连准备可原子更新当前 endpoint。getter 在应用中求值，再传给库。

页面本地配置包括 `binaryType`、`immediate`、`autoClose`、`fallback`、`worker`、`lifecycle`、logger 和回调。raw 二进制在 runtime 中固定 ArrayBuffer，`binaryType: 'blob'` 只转换本页的展示值，不造成配置冲突；JSON/custom 不接受该覆盖。

`reconnect` 使用 `automatic`、`maxRetries`、`initialDelay`、`maxDelay`、`factor`、`jitter`、`stableThreshold`、`hookTimeout`。旧 `autoReconnect` 被拒绝。所有毫秒配置必须是平台范围内的整数；容量必须是安全整数。具体默认值与计数规则见 [可靠性](../guide/reliability)。

`limits` 为连接共享限制：`maxClientsPerConnection` 和 `maxEncodedMessageBytes`。自定义 Worker 的静态 `workerLimits` 有 `maxPorts`、`maxControlEnvelopeBytes`、`maxDispatchKeys`、`unattachedPortTimeoutMs`、`maxDeliveryMessages`、`maxDeliveryBytes`，不从页面消息接收。握手告知页面实际静态限制，未完成 attach 不保留共享 id。

运行时注册的 onMessage/onBeforeReconnect 只属于本页。完整字段和默认值见 [CreateWebSocketOptions](../api/generated/index/interfaces/CreateWebSocketOptions.md)。
