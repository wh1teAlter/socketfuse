# 配置

`CreateWebSocketOptions` 有意分为共享设置与页面本地设置，以避免相同共享 `id` 静默合并
不兼容的 socket 行为。

## 共享设置

`protocols`、`protocol`、`autoReconnect`、`connectionTimeout`、`binaryType`、`heartbeat`、`queue`、
`backpressure`、`lease`、`limits` 与 `idleGraceMs` 描述共享物理连接。复用 `id` 时若不一致，会产生
`CONNECTION_CONFIG_CONFLICT`。初始固定字符串 URL 是连接尝试输入，不参与 fingerprint；页面函数或
getter 不能作为初始化 URL，业务应先在库外求值，并在重连 hook 中为当前 plan 提交新 URL。

## 页面本地设置

`immediate`、`autoClose`、`fallback`、`worker`、`lifecycle`、`logger`、`onConnected`、
`onDisconnected`、`onError` 与初始 `onMessage` 仅属于创建它的标签页；运行时注册的
`onMessage()` / `onBeforeReconnect()` 也只在本页执行。因此某个标签页可选择加入恢复回放，
而不影响其他标签页。

`limits` 仅包含连接限制：`maxClientsPerConnection` 与 `maxEncodedMessageBytes`，二者都会参与
共享指纹。自定义 Worker 作者需通过 `createSharedWebSocketRuntime({ workerLimits })` 一次性配置
Worker 级控制平面限制：`maxPorts`、`maxControlEnvelopeBytes`、`maxExclusiveKeys` 与 `unattachedPortTimeoutMs`。
这些静态 Worker 限制绝不从页面接收，也不会导致连接冲突。

默认值和所有精确选项字段请参阅生成的
[CreateWebSocketOptions](../api/generated/index/interfaces/CreateWebSocketOptions.md)。
