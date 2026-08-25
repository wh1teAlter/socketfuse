# wws

`wws` 通过 SharedWorker 在同源浏览器标签页之间共享一个原生 WebSocket。公开 API 与
框架无关，提供稳定 client、动态 `onMessage` 处理器和 `sendMessage` 回执。

```ts
import { createWebSocket } from 'wws'

const ws = createWebSocket('wss://api.example.com/realtime', {
  id: 'realtime:user-42',
  onMessage: (_client, event) => {
    console.log('message', event.data, event.replayed)
  },
})

await ws.open()
await ws.sendMessage(JSON.stringify({ type: 'presence', online: true }))
```

默认使用零配置的内联 SharedWorker；仅在 Worker 构造或初始化握手失败时通过
`fallback: 'direct'` 降级。不能接受第二条物理连接时，请使用 `fallback: 'error'`。
连接 id 不是授权边界；认证仍应由服务端和应用协议适配器负责。

原始模式只接受原生 WebSocket 数据（`string`、`Blob`、`ArrayBuffer` 或类型化数组视图）。
发送 JSON 对象前请选择 `protocol: { type: 'json' }`。原始模式有意不提供 WWS 心跳支持。

请参阅[文档](packages/docs/site/index.md)、[演练场](packages/docs/site/playground.md)、
[技术规格](docs/specs/wws-v1-spec.md)与[实现 tickets](docs/planning/02-wws-v1-tickets.md)。

工程入口：

- [AGENTS.md](AGENTS.md) 与 [CLAUDE.md](CLAUDE.md)：协作、注释、README 与验证约定。
- [@wws/core](packages/core/README.md)：私有运行时引擎及依赖边界。
- [wws](packages/wws/README.md)：发布包公开入口。
- [文档站](packages/docs/README.md)：VitePress、TypeDoc 与 Playground。
- [测试工程](packages/test/README.md)：E2E、测试服务和发布验收。
