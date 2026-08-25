# 快速开始

安装 `wws` 后，为每个需要参与共享连接的页面创建一个 client。

```ts
import { createWebSocket } from 'wws'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events:tenant-a',
})

const removeMessageHandler = ws.onMessage((event) => {
  console.log(event.data, event.replayed)
})

await ws.open()
await ws.sendMessage(JSON.stringify({ type: 'subscribe', topic: 'orders' }))

removeMessageHandler()
await ws.dispose()
```

## 零配置

`protocol: 'raw'`、内联 SharedWorker、重连、有界资源限制以及 `fallback: 'direct'`
均为默认值。唯一必填的选项是 `id`。

WebSocket 服务器需要协商子协议时，请使用 `protocols`：

```ts
const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events:tenant-a',
  protocols: ['json.v2'],
})
```

## 打开与关闭

`createWebSocket()` 只创建页面 client。使用默认 `immediate` 选项时，它会立即开始打开；
设为 `immediate: false` 可让第一次 `open()` 显式执行。`close()` 会关闭本页的逻辑参与；
`dispose()` 还会移除监听器并永久释放 client。

完整 client 契约请参阅 [`WebSocketClient`](../api/generated/index/interfaces/WebSocketClient.md)。
