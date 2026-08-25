# 原始协议

`raw` 是默认协议。入站和出站值都是原生 WebSocket 数据：字符串、`Blob`、`ArrayBuffer`
或类型化数组视图。

```ts
const ws = createWebSocket('wss://api.example.com/raw', {
  id: 'raw-events',
  protocol: 'raw',
})
```

原生 `open` 事件触发时，socket 即视为 ready。原始模式不支持协议级认证更新或 ping/pong 模板；
当服务端在 WebSocket 消息之外处理认证和保活时，它仍是实用的基础模式。
