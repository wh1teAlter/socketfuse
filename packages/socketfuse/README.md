# SocketFuse

`socketfuse` 是发布到 npm 的浏览器 WebSocket 共享库：同源页面通过 SharedWorker 复用物理连接，Worker 不可用时可按策略使用当前页面的 direct WebSocket。当前首发版本为 `0.0.1-beta.1`，发布到 npm 的 `beta` dist-tag。

## 公开入口

- `socketfuse`：`createWebSocket`、client 类型、状态、事件、错误与配置类型。
- `socketfuse/protocol`：`rawProtocol` 和自定义 `ProtocolAdapter` 契约。
- `socketfuse/worker`：自定义 SharedWorker 入口的 `createSharedWebSocketRuntime` 与 `exposeSharedWebSocketWorker`。

## 使用

```ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/events', { id: 'events:user-42' })
ws.onMessage(event => console.log(event.data))
await ws.open()
```

只有 `id` 是必填配置。`sendMessage` 的成功代表本地 accepted/queued，不是服务器 Ack；`onMessage` 可在创建后动态添加。详细配置和限制见文档站。

## 依赖与边界

此包将私有 `@socketfuse/core` 打包进产物，不暴露其 workspace 路径，也没有运行时第三方依赖。浏览器页面 realm 才能创建 client；SSR/Node 只能安全 import。SharedWorker 的构造/初始化失败可选择 direct 或 error，选定后的连接故障不会静默换 transport。

## 构建与发布

`pnpm --filter socketfuse build` 生成三个公开入口，`pnpm --filter socketfuse lint:package` 检查发布元数据与实际产物，
根目录 `pnpm release:verify` 还会验证真实 tarball、消费者类型、Vite 构建与 SSR import。发布由 main 上的
Version Packages PR 触发，不能从本地直接执行；仓库只发布 `socketfuse`，不会递归发布私有 workspace。
