# 快速开始

SocketFuse 是浏览器页面使用的 WebSocket 共享库。先准备一个能接受业务消息的 WebSocket 服务；示例中的订阅结构由服务端协议决定。

## 安装

```sh
pnpm add socketfuse
```

也可使用 `npm install socketfuse` 或 `yarn add socketfuse`。升级前阅读 [CHANGELOG](https://github.com/wh1teAlter/socketfuse/blob/main/packages/socketfuse/CHANGELOG.md)。

## 创建与发送

以下代码在浏览器页面中运行。`id` 是唯一必填选项，JSON 协议让对象直接用于发送和接收：

```ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events:user-42',
  protocol: { type: 'json' },
  immediate: false,
  onError: (_client, error) => console.error(error.code),
})

const unsubscribe = ws.onMessage((event) => {
  console.log(event.data, { replayed: event.replayed })
})

await ws.open()
const receipt = await ws.sendMessage({ type: 'subscribe', channel: 'notifications' })
console.log(receipt.status)
```

`receipt.status` 为 `accepted` 或 `queued`，只说明本地接纳结果，不是服务端 Ack。队列默认关闭，启用方式与上限见[可靠性](./reliability)。

在第二个同源标签页中使用相同 `id`、共享配置和 Worker 部署，即可复用连接。两个页面的普通 `onMessage` 都会被调用。共享条件和冲突规则见[连接共享](./connection-sharing)。

## 回调的两种注册方式

创建选项中的 `onMessage` 接收 `(client, event)`；动态 `ws.onMessage` 接收 `(event, context)` 并返回移除函数。不要混用两个签名：

```ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'raw-events:user-42',
  onMessage: (_client, event) => console.log(event.data),
})

const unsubscribe = ws.onMessage((event, { signal }) => {
  if (!signal.aborted)
    console.log(event.data)
})
```

每次动态注册独立存在，重复注册不会去重。共享协议回复应放进 [Worker 扩展](./worker-extensions)；页面通知等单接收者分派使用 `dispatchKey`。

## 打开、退出与清理

`immediate` 默认是 `true`，创建后在后台开始参与连接；设为 `false` 时由首次 `open()` 启动。`open()` 等待当前尝试的结果，失败通过 Promise rejection 返回，不会无限等待直到某次自动恢复成功。

```ts
// 暂时退出本页参与，其他页面继续使用共享连接。
await ws.close()
await ws.open()

// 页面永久停止使用这个 client。
unsubscribe()
await ws.dispose()
```

关闭最后一个 client 后，物理连接按空闲宽限策略回收。`dispose()` 之后不能重新打开。SSR 应用可导入三个公开入口，但只在浏览器生命周期中创建 client。

## 默认行为

- 省略 `protocol` 时采用 raw，只发送和接收 WebSocket 原生数据。
- 默认使用内联 SharedWorker；明确的初始化失败允许 direct fallback。
- 自动重连开启，默认重试预算无限；心跳和生命周期回放默认关闭。
- 队列默认不缓存断线或背压发送；所有接入仍受资源限制。

服务端需要 WebSocket 子协议时使用 `protocols: ['json.v2']`；它是原生协议协商，与解析 payload 的 `protocol` 分开。完整选项见[配置参考](../reference/configuration)。
