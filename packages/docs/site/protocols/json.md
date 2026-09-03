# JSON 协议

服务端使用 JSON 帧表达应用层心跳时，可使用声明式 JSON 协议。

```ts
const ws = createWebSocket(url, {
  id: 'orders',
  protocol: {
    type: 'json',
    heartbeat: {
      ping: { messageType: 'ping' },
      pong: { messageType: 'pong' },
      serverPing: { messageType: 'server-ping' },
      serverPong: { messageType: 'server-pong' },
    },
  },
  heartbeat: { interval: 25_000, pongTimeout: 5_000 },
})
```

匹配器键支持点号与方括号路径，例如 `meta.code` 和 `items[0].kind`，值将做结构化比较。
`messageType` 没有特殊含义，只是示例；任意字段或嵌套路径都可匹配。识别出的 heartbeat/ignore
控制帧不会到达 `onMessage` 和 `ws.data`。认证、session 与业务 ready 仍由应用普通消息处理。
