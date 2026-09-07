# 配置

`createWebSocket(url, options)` 将选项分为共享连接配置与页面本地配置。共享字段不同会报 `CONNECTION_CONFIG_CONFLICT`；页面回调和显示方式可各自设置。

## URL 与共享身份

`id` 为非空字符串，最长 1024 字符。初始 URL 必须为绝对 `ws:`/`wss:` 字符串，最长 16384 字符，不允许 userinfo 或 fragment。URL 不参与共享身份；后来页面的 URL 不覆盖存量连接，动态 endpoint 由重连准备 hook 提交。

共享配置比较规范化后的完整内容，不仅比较哈希。相同 `id` 下的以下字段必须一致：

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `protocols` | `[]` | 原生 WebSocket 子协议协商 |
| `protocol` | `'raw'` | raw、JSON 或 custom 协议描述符 |
| `connectionTimeout` | `10_000` ms | 原生 socket 的建连期限 |
| `reconnect` | 自动恢复、无限重试 | 所有恢复入口共用的预算和退避 |
| `heartbeat` | `false` | 应用层保活；超时需显式配置 |
| `queue` | 断线和背压入队均关闭 | 启用后默认最多 100 条、1 MiB |
| `backpressure` | 高水位 1 MiB、低水位 256 KiB | 原生 `bufferedAmount` 迟滞阈值 |
| `lease` | 间隔 `20_000` ms、期限 `60_000` ms | 页面活性与端口回收 |
| `limits` | 64 个 client、1 MiB 编码出站消息 | 单连接资源上限 |
| `idleGraceMs` | `5_000` ms | 最后一个参与者离开后的回收宽限 |

## 重连与心跳

`reconnect` 默认值：

| 字段 | 默认值 |
| --- | --- |
| `automatic` | `true` |
| `maxRetries` | `Infinity` |
| `initialDelay` / `maxDelay` | `1_000` / `30_000` ms |
| `factor` / `jitter` | `2` / `0.2` |
| `stableThreshold` | `30_000` ms；`false` 禁用稳定后重置 |
| `hookTimeout` | `10_000` ms，总准备期限 |

首次物理尝试不计数，之后由计数策略决定。`maxRetries: 3, stableThreshold: false` 表示同一连接条目生命周期最多三次计数重连；显式 `countAsRetry: false` 不受该次数限制，也不补充预算。详见[可靠性](../guide/reliability)。

显式开启 heartbeat 后，默认间隔为 `25_000` ms、模式为 `pong`。未配置 `pongTimeout` 时不会按心跳响应判超时。raw 默认发送 `ping` 并匹配 `pong`；JSON/custom 的消息语义由协议定义。

所有毫秒配置必须为平台范围内整数，容量为安全整数；`maxRetries` 另外允许 `Infinity`。旧 `autoReconnect` 选项已移除。

## 页面本地选项

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `immediate` | `true` | 创建后在后台开始参与 |
| `autoClose` | `true` | 页面离开时自动分离 |
| `binaryType` | `'arraybuffer'` | raw 的本页二进制表示，可选 `'blob'` |
| `worker` | 内联 SharedWorker 工厂 | 自定义 Worker 部署入口 |
| `fallback` | 内联 `'direct'`；自定义 `'error'` | 首次初始化失败策略 |
| `lifecycle.restore` | 关闭 | 启用暂停与可选内存回放 |
| `logger`、回调 | 未设置 | 本页错误观察与业务处理 |

raw 在 runtime 内使用 ArrayBuffer，`binaryType: 'blob'` 只转换本页收到的业务表示，JSON/custom 不接受该覆盖。自定义 Worker 禁止显式 `fallback: 'direct'`。回放启用后的默认容量为 256 条、4 MiB。

## Worker 静态资源限制

自定义 Worker 创建 runtime 时设置 `workerLimits`，页面不能通过控制消息放宽它。握手会告知页面实际限制；仅握手不会创建共享连接。

| 字段 | 默认值 |
| --- | --- |
| `maxPorts` | 256 |
| `maxControlEnvelopeBytes` | 2 MiB |
| `maxDispatchKeys` | 1024 |
| `unattachedPortTimeoutMs` | `5_000` ms |
| `maxDeliveryMessages` | 256 |
| `maxDeliveryBytes` | 4 MiB |

`limits.maxEncodedMessageBytes` 限制编码后的**出站**消息；`maxDeliveryBytes` 限制页面投递的单个 envelope 与未确认总量。它们不是 decode 前的入站 wire 大小限制。

完整类型与字段约束见 [CreateWebSocketOptions](../api/generated/index/interfaces/CreateWebSocketOptions.md) 和 [WorkerResourceLimits](../api/generated/worker/interfaces/WorkerResourceLimits.md)。
