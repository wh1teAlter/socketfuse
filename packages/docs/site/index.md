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

`id` 是显式的共享标识。同源标签页使用相同的 `id` 和共享配置时，会接入同一个物理
WebSocket。初始化 endpoint 只接受已经求值的固定字符串，但不参与共享 fingerprint；后来页面
传入的不同 URL 不冲突、也不覆盖存量连接。`lifecycle`、本地监听器及其他页面本地选项不会导致配置冲突。

## 消息处理

`onMessage` 可随时注册和移除。每次注册彼此独立，抛出异常的处理器不会阻止其他
处理器运行。最新业务消息可从 `ws.data` 获取；ping、pong、ignore 等协议控制帧不会覆盖它。

需要确认、游标写入等单点副作用时，为 handler 声明 execution key：

```ts
ws.onMessage(async (event, { signal }) => {
  await persistCursor(event.data, { signal })
}, { key: 'cursor-writer' })
```

每一帧仍广播给全部页面，普通 handler 与 `message` 事件不受影响。SharedWorker 只让一个
健康页面持有相同 key；freeze、离开或 lease 失效后自动交接。页面可通过 `holdsKey()` 与
`keychange` 观察 Worker 权威状态。

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

## 协议与应用状态

默认使用原始 WebSocket 数据。声明式 JSON 配置可直接传入：

```ts
const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events',
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

await ws.open()
await ws.sendMessage({ messageType: 'authenticate', token: await freshToken() })
```

匹配器键使用点号或方括号路径，例如 `meta.code` 和 `items[0].kind`。对于复杂协议，
请在自定义 Worker 入口中注册 `ProtocolAdapter`；适配器函数不能跨越 `MessagePort`。

## 降级与诊断

只有 Worker API 支持、构造、加载和初始化握手错误可以使用 `fallback: 'direct'`。
网络故障、心跳超时和服务端关闭码始终留在已选 transport 上处理。

```ts
const ws = createWebSocket(url, {
  id: 'critical-feed',
  fallback: 'error',
  immediate: false,
})

ws.addEventListener('diagnostic', () => console.log(ws.diagnostics()))
```

诊断信息包含 transport、状态、origin、稳定的 id/配置哈希、重试、队列和溢出计数。
URL 查询字符串、payload 与内部堆栈均不会暴露。credential、session、业务 ready、Ack、cursor
与消息幂等由应用维护；SocketFuse 不提供 dedupe 或 exactly-once。

## 动态重连配置

业务 getter 留在页面并显式求值。首次 `open()` 不运行 hook；此后的断线、连接/心跳超时和
显式 `reconnect()` 都通过同一计划。动态 endpoint 场景应设置 `immediate: false`，注册 hook 后再调用 `open()`。

```ts
const getConnectionOptions = async () => ({
  url: `wss://api.example.com/events?token=${await freshToken()}`,
})

const initial = await getConnectionOptions()
const ws = createWebSocket(initial.url, { id: 'events:user-42', immediate: false })

ws.onBeforeReconnect(async (context) => {
  context.setOptions(await getConnectionOptions())
  context.setDelay(250)
})
await ws.open()
```

Worker 每个 plan 只选择一个 visible 优先、同级 FIFO 的候选页面。hook 失败、冻结或离开会
abort `context.signal` 并在同一总截止时间的剩余预算内转给下一候选；全部失败或到期时仍使用原 URL 与默认延迟。

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
若 Worker 已重启，页面会重建该共享 transport，并在重新打开请求前恢复 execution key、重连 hook
与连接需求。这是尽力而为的 transport 恢复，并非持久化业务消息恢复：Worker 重启、
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
