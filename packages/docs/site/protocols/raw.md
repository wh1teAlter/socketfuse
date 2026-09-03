# 原始协议

`raw` 是默认协议。入站和出站值都是原生 WebSocket 数据：字符串、`Blob`、`ArrayBuffer`
或类型化数组视图。

```ts
const ws = createWebSocket('wss://api.example.com/raw', {
  id: 'raw-events',
  protocol: 'raw',
})
```

原生 `open` 事件触发时，socket 即视为 open。可以通过顶层 `heartbeat` 开启应用层字符串或
二进制 ping/pong：

```ts
const ws = createWebSocket('wss://api.example.com/raw', {
  id: 'raw-heartbeat',
  heartbeat: { interval: 25_000, pongTimeout: 5_000 },
})
```

默认发送 `ping`、识别 `pong`；省略 `pongTimeout` 时只发送保活帧，不会因缺少业务 pong 主动断线。
自定义二进制心跳可使用 `ArrayBuffer` 或类型化数组视图；`Blob` 内容无法同步参与共享 fingerprint，
因此只可作为普通 raw 消息，不能作为 heartbeat 配置。
浏览器原生 WebSocket Ping/Pong 不对 JavaScript 暴露，若服务端使用该机制则保持 heartbeat 关闭。
