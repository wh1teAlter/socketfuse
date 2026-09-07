# 降级与 Worker

## 默认内联 Worker

默认情况下，SocketFuse 使用稳定 `data:` URL 创建内联 SharedWorker。相同构建产物无需单独部署 Worker 文件；浏览器和 CSP 必须允许该部署方式。库不创建 Blob URL，也不从 CDN 加载 Worker 源码。

内联模式默认 `fallback: 'direct'`。只有 SharedWorker API 不可用、构造、加载或初始化超时时才允许选择页面内 direct。网络故障、心跳超时、服务端关闭和无效控制响应都不会使已选 transport 改为另一种接入。

必须依赖跨页面共享时，显式禁用降级：

```ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'critical-feed',
  fallback: 'error',
})
```

direct 共用相同 runtime 和资源限制，但共享范围仅限当前页面 realm；页面主线程阻塞也会影响其运行。选定 shared 后，生命周期恢复使用新的端口参与期重建 shared，不会转成 direct。

## 自定义 Worker

CSP 禁止 `data:`、需要自定义协议或部署要求静态资源时，提供稳定的同源 Worker URL。以下示例适用于支持 Worker URL 构建的工具：

```ts
// worker.ts
import { exposeSharedWebSocketWorker } from 'socketfuse/worker'

exposeSharedWebSocketWorker()
```

```ts
// page.ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events',
  worker: () => new SharedWorker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
})
```

Worker 文件应由应用构建和部署。所有需要共享的页面使用一致的 Worker URL、名称和浏览器分区；部署后应避免同时存活的页面意外引用不同 Worker 资源。

自定义 Worker 的 fallback 默认且只能为 `'error'`。显式 `'direct'` 在创建时拒绝，初始化失败也不会丢弃自定义协议逻辑后继续运行。需要注册协议和收到标志时，参阅 [Worker 共享处理](./worker-extensions)。

## CSP 与服务端

检查 CSP 的 Worker 源和连接目标是否允许实际部署地址。Worker 发出的 WebSocket 握手可能涉及不同的 Origin 表现，cookie 与 SameSite 也由浏览器策略决定。应针对目标环境验证服务端 origin 白名单与认证；不要放宽认证来掩盖部署问题。详见[兼容性与安全](../reference/compatibility-and-security)。
