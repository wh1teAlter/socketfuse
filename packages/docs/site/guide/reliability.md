# 可靠性

## 状态与重连

`state` 反映逻辑连接状态（`idle`、`connecting`、`open`、`reconnecting`、`closed` 及相关
过渡状态）。`status` 将它映射到熟悉的 `CONNECTING`、`OPEN` 或 `CLOSED` 形式；`readyState`
镜像原生 WebSocket 数值。渲染 UI 时可监听 `statechange`、`open`、`close` 与 `error`。

重连默认启用。可通过 `autoReconnect` 配置，或调用无参数 `reconnect()` 发起明确的新尝试。
重试延迟会从配置的初始延迟开始，按系数和抖动增长，并在连接稳定后重置。终止性关闭码或协议
决定不会重试。

`autoReconnect.hookTimeout`（默认 10 秒）限制整个重连 plan 的总准备窗口，候选转移不会重新计时。
`setDelay` 表示 hook 成功提交后再等待多少毫秒；所有候选失败或总期限到达时仍使用当前 URL 和默认退避。

## 队列与背压

`sendMessage()` 返回本地接纳回执，不代表服务器已处理消息；SocketFuse 没有服务端 Ack 协议。

```ts
const receipt = await ws.sendMessage(payload, { queue: true })
// { status: 'accepted', messageId, bufferedAmount }
// 或 { status: 'queued', messageId, position }
```

可按消息或通过 `queue` 启用排队。FIFO 队列同时受消息数和字节数限制。断开连接或超过
高水位线时，不能入队的发送会以 `SEND_WHILE_DISCONNECTED` 或 `BACKPRESSURE` 拒绝。SocketFuse 会在
低水位线以下恢复清空队列，绝不会让队列无上限增长。

## 心跳

SocketFuse heartbeat 是应用消息，默认关闭。`heartbeat: true` 会按默认间隔发送 raw 字符串 `ping`
并严格识别、消费字符串 `pong`；没有显式 `pongTimeout` 时只做保活，不会因缺少 pong 主动断线。
需要存活检测时配置 `pongTimeout`，`mode: 'pong'` 等待匹配响应，`mode: 'activity'` 接受任意有效
入站活动。等待响应期间不会叠加 timeout。声明式 JSON 与 custom adapter 继续负责协议分类和响应。

浏览器 WebSocket 实现会在网络栈处理 RFC 6455 原生 Ping/Pong，JavaScript API 不能发送或监听
这些控制帧；服务端使用原生控制帧保活时保持 `heartbeat: false`，不需要额外兼容开关。

## 慢页面与溢出

Worker 到页面的投递会为每个标签页独立限流：最多 256 条未确认消息或 4 MiB。页面 runtime 会在
运行你的 `onMessage` 处理器前先发送回执，因此慢处理器不会阻塞 Worker。某个标签页耗尽额度时，
只会丢弃该页最新的入站消息；健康标签页仍会继续收到广播，受影响的标签页会在投递恢复后收到
`overflow` 事件。这刻意不是应用层的投递确认。
