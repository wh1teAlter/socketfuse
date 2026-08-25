# 兼容性与安全

## 浏览器与 SSR 基线

WWS 的目标是具备 SharedWorker 的 Chromium/Edge、Firefox 与 Safari 16+。SharedWorker 缺失时，
`fallback: 'direct'` 会保持 client API，但物理连接共享仅限单个 JavaScript realm。
`fallback: 'error'` 会拒绝这一降级。

导入 `wws` 对 SSR 是安全的；创建 client 则要求浏览器**页面** realm 同时具备 `window` 和
`document`。即使 Node runtime 提供全局 `WebSocket` 也不够：`createWebSocket()` 会在那里抛出
`ENVIRONMENT_UNSUPPORTED`，且绝不会打开 direct 降级 socket。请只在浏览器生命周期代码中创建
client，绝不能在服务端渲染期间创建。

## 部署策略

内联 Worker 使用 `data:` 源码。CSP 禁止它时需要静态、同源的自定义 Worker。一些服务器会将
Worker 的 WebSocket 流量视为 `Origin: null`；发布前请针对 Worker 上下文验证 origin 白名单、
cookie 策略和认证。

发送到 WebSocket endpoint 的 cookie 仍遵循浏览器凭据与 SameSite 规则。不要将 `id` 用作访问
控制；应在服务端认证中包含租户/用户身份，并验证每条消息的授权。
