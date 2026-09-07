# 兼容性与安全

## 浏览器与 SSR 基线

SocketFuse 面向提供 SharedWorker、MessageChannel、structuredClone 和现代 ESM 能力的浏览器页面。CI 使用 Chromium、Firefox 与 WebKit；这不等于每个历史版本、移动平台和 WebView 都具备相同支持。请在目标浏览器验证 Worker、CSP 与后台生命周期。内联部署的 SharedWorker 缺失时，
`fallback: 'direct'` 会保持 client API，但物理连接共享仅限单个 JavaScript realm。
`fallback: 'error'` 会拒绝这一降级。

导入 `socketfuse`、`socketfuse/protocol` 和 `socketfuse/worker` 对 SSR 是安全的；创建 client 则要求浏览器**页面** realm 同时具备 `window` 和
`document`。即使 Node runtime 提供全局 `WebSocket` 也不够：`createWebSocket()` 会在那里抛出
`ENVIRONMENT_UNSUPPORTED`，且绝不会打开 direct 降级 socket。请只在浏览器生命周期代码中创建
client，绝不能在服务端渲染期间创建。

## 部署策略

内联 Worker 使用 `data:` 源码。CSP 禁止它时需要静态、同源的自定义 Worker。一些服务器会将
Worker 的 WebSocket 流量视为 `Origin: null`；发布前请针对 Worker 上下文验证 origin 白名单、
cookie 策略和认证。

发送到 WebSocket endpoint 的 cookie 仍遵循浏览器凭据与 SameSite 规则。不要将 `id` 用作访问
控制；应在服务端认证中包含租户/用户身份，并验证每条消息的授权。

同一 Worker 的 id 只是复用标识。同源脚本可能接入同一连接，业务权限必须由应用和服务端隔离；credentials 不能放进共享 descriptor 或诊断字段。URL/发送输入可以进入连接 runtime，只有应用选定的业务投影作为 message 投递；控制响应、diagnostics 和 logger 均不回显 payload 或内部异常。
