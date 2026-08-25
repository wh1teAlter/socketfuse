# JSON protocol

Use the declarative JSON protocol when a server sends JSON frames for readiness,
auth and heartbeat.

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

Matcher keys support dot and bracket paths such as `meta.code` and
`items[0].kind`. Values are structurally compared. `$auth` and `$auth.path`
placeholders resolve from the most recent auth revision. Protocol frames are
handled internally; only application data reaches `onMessage` and `ws.data`.
