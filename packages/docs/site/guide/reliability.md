# 可靠性

## 状态与重连

`state` 反映逻辑连接状态（`idle`、`connecting`、`open`、`reconnecting`、`closed` 及相关
过渡状态）。`status` 将它映射到熟悉的 `CONNECTING`、`OPEN` 或 `CLOSED` 形式；`readyState`
镜像原生 WebSocket 数值。渲染 UI 时可监听 `statechange`、`open`、`close` 与 `error`。

重连默认启用。可通过 `autoReconnect` 配置，或调用 `reconnect({ reason })` 发起明确的新尝试。
重试延迟会从配置的初始延迟开始，按系数和抖动增长，并在连接稳定后重置。终止性关闭码或协议
决定不会重试。

## 队列与背压

`sendMessage()` 返回本地接纳回执，不代表服务器已处理消息；WWS 没有服务端 Ack 协议。

```ts
const receipt = await ws.sendMessage(payload, { queue: true })
// { status: 'accepted', messageId, bufferedAmount }
// 或 { status: 'queued', messageId, position }
```

可按消息或通过 `queue` 启用排队。FIFO 队列同时受消息数和字节数限制。断开连接或超过
高水位线时，不能入队的发送会以 `SEND_WHILE_DISCONNECTED` 或 `BACKPRESSURE` 拒绝。WWS 会在
低水位线以下恢复清空队列，绝不会让队列无上限增长。

## 心跳

WWS 心跳是由适配器定义的应用消息。原始协议没有心跳能力，因此将 `heartbeat` 与
`protocol: 'raw'` 一起使用会在配置阶段被拒绝。声明式 JSON 和自定义适配器可以描述
ping/pong 帧。心跳是共享连接行为，因此所有标签页都会看到相同的重连结果。服务端负责保活时，
请选择 `heartbeat: false`；配置 interval/pong timeout 前应先确认服务端协议。

## 慢页面与溢出

Worker 到页面的投递会为每个标签页独立限流：最多 256 条未确认消息或 4 MiB。页面 runtime 会在
运行你的 `onMessage` 处理器前先发送回执，因此慢处理器不会阻塞 Worker。某个标签页耗尽额度时，
只会丢弃该页最新的入站消息；健康标签页仍会继续收到广播，受影响的标签页会在投递恢复后收到
`overflow` 事件。这刻意不是应用层的投递确认。
