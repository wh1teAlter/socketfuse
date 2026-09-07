# 降级与 Worker

## 默认内联 Worker

默认情况下，SocketFuse 会创建一个构建产出的内联 SharedWorker，由它持有 socket。这是零配置方案，
适用于应用 CSP 允许 `data:` Worker 源码的场景。

`fallback: 'direct'` 是默认值。仅在 SharedWorker 支持、构造、加载或初始化失败时，它才会
使用直接的页面本地 WebSocket。网络、认证、心跳或服务端关闭失败不会切换到其他 transport。
不合法的 Worker 控制响应是错误，而非静默降级的理由。选定 SharedWorker 后，生命周期恢复
只会重建该共享 transport，绝不会改为 direct。

需要严格的单连接策略时，请设为 `fallback: 'error'`：

```ts
const ws = createWebSocket(url, { fallback: 'error', id: 'critical-feed' })
```

## 自定义 Worker

CSP 禁止 `data:`、需要自定义协议适配器或部署策略要求静态资源时，请使用稳定的同源 Worker URL。

```ts
const ws = createWebSocket(url, {
  id: 'events',
  worker: () => new SharedWorker('/assets/socketfuse-worker.js'),
})
```

自定义 Worker 只允许 fallback:error（默认）；显式 fallback:direct 在创建时拒绝。这样 Worker 初始化失败不会丢失应用协议。hello/welcome 只检查能力，选择提交后 attach 才建立连接需求；后续失败不能改为 direct。

该 Worker 必须调用 `exposeSharedWebSocketWorker()`。所有需要共享的 SPA 必须使用完全一致的
Worker URL 和 origin。SocketFuse 不会创建 Blob URL，也不会从 CDN 加载 Worker 源码。

有关 CSP、cookie、SameSite 和 `Origin: null` 的影响，请参阅
[兼容性与安全](../reference/compatibility-and-security)。
