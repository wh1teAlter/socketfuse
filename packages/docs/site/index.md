---
layout: home
title: SocketFuse
hero:
  name: SocketFuse
  text: 在浏览器标签页之间共享 WebSocket 连接
  tagline: 以 SharedWorker 为首选，并提供 direct WebSocket 降级。
---

# 快速开始

```ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/realtime', {
  id: 'chat:tenant-a:user-42',
  onMessage: (_client, event) => {
    renderMessage(event.data)
  },
})

await ws.open()
await ws.sendMessage(JSON.stringify({ type: 'join', room: 'general' }))
```

`id` 是显式的共享标识。同源标签页使用相同的 `id`、初始 URL 和共享配置时，会接入
同一个物理 WebSocket。`lifecycle`、本地监听器及其他页面本地选项不会导致配置冲突。
后续 endpoint 与认证值的变更通过单调递增的 revision 在共享连接上排序，而不会成为
静态指纹的一部分。

## 消息处理

`onMessage` 可随时注册和移除。每次注册彼此独立，抛出异常的处理器不会阻止其他
处理器运行。最新业务消息可从 `ws.data` 获取；ready、ping、pong 等协议帧不会覆盖它。

`sendMessage()` 会解析为下列任一回执：

```json
[
  { "status": "accepted", "messageId": "<id>", "bufferedAmount": 0 },
  { "status": "queued", "messageId": "<id>", "position": 1 }
]
```

这些回执只描述本地接纳结果。SocketFuse v1 不实现服务端 Ack、请求关联或 `request()`
辅助方法。队列需显式启用：`queue: true` 会在断开和背压状态下启用 FIFO 内存队列，
默认上限为 100 条消息和 1 MiB。

## 协议与认证

默认使用原始 WebSocket 数据。声明式 JSON 配置可直接传入：

```ts
const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events',
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

await ws.updateAuth({ token: 'short-lived-token' }, { revision: 1 })
```

匹配器键使用点号或方括号路径，例如 `meta.code` 和 `items[0].kind`。对于复杂协议，
请在自定义 Worker 入口中注册 `ProtocolAdapter`；适配器函数不能跨越 `MessagePort`。

## 降级与诊断

只有 Worker API 支持、构造、加载和初始化握手错误可以使用 `fallback: 'direct'`。
网络故障、认证错误、心跳超时和服务端关闭码始终留在已选 transport 上处理。

```ts
const ws = createWebSocket(url, {
  id: 'critical-feed',
  fallback: 'error',
  immediate: false,
})

ws.addEventListener('diagnostic', () => console.log(ws.diagnostics()))
```

诊断信息包含 transport、状态、origin、稳定的 id/配置哈希、重试、队列和溢出计数。
认证值、URL 查询字符串、payload 与内部堆栈均不会暴露。

## 生命周期恢复

恢复默认关闭。当隐藏或冻结的页面应停止接收实时消息时，可按页面启用：

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  lifecycle: { restore: { replay: true, maxMessages: 256, maxBytes: 4 * 1024 * 1024 } },
})
```

回放受上限约束，并走正常的 `onMessage` 路径，且 `event.replayed === true`。发生
溢出时会丢弃最早缓存的消息并派发 `overflow`。启用恢复的页面会探测已选 SharedWorker；
若 Worker 已重启，页面会重建该共享 transport，并在重新打开请求前回放最新的 endpoint/
认证 revision。这是尽力而为的 transport 恢复，并非持久化业务消息恢复：Worker 重启、
租约过期和页面终止仍可能导致消息丢失。

## Worker 部署

默认内联 Worker 使用构建产出的稳定 `data:` 源码。若 CSP、Cookie/SameSite 或
`Origin: null` 有要求，应改为部署自定义的同源 Worker URL：

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  worker: () => new SharedWorker('/socketfuse-worker.js'),
  protocol: 'raw',
})
```

自定义 Worker 必须调用 `exposeSharedWebSocketWorker()`，并静态注册所有自定义适配器。
需要共享连接的 SPA 必须使用完全一致的 Worker URL。SocketFuse 不会创建 Blob URL，也不会从 CDN
加载 Worker 代码。

## 兼容性

Chromium/Edge、Firefox 和 Safari 16+ 是目标 SharedWorker 基线。SharedWorker 不可用时，
direct 降级会保持 API 与错误语义，但共享范围仅限当前 JavaScript realm。Node/SSR 中导入
是安全的，但创建连接需要浏览器 WebSocket API。
