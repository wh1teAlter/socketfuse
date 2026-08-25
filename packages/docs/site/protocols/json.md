# JSON 协议

服务端使用 JSON 帧表达就绪、认证和心跳时，请使用声明式 JSON 协议。

```ts
const ws = createWebSocket(url, {
  id: 'orders',
  protocol: {
    type: 'json',
    ready: { status: 'ready' },
    auth: { template: { type: 'auth', token: '$auth' } },
    heartbeat: {
      ping: { type: 'ping' },
      pong: { type: 'pong' },
      serverPing: { type: 'server-ping' },
      serverPong: { type: 'server-pong' },
    },
  },
})
```

匹配器键支持点号与方括号路径，例如 `meta.code` 和 `items[0].kind`，值将做结构化比较。
`$auth` 与 `$auth.path` 占位符从最新认证 revision 中解析。协议帧由内部处理；只有应用数据会
到达 `onMessage` 和 `ws.data`。
