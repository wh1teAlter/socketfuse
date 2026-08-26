# SocketFuse 测试工程

该私有 workspace 按测试目的分为：

- `e2e/specs`：Playwright 浏览器行为测试；
- `server`：仅供测试的本地 `ws` echo/control server；
- `release`：真实 tarball 的类型、入口、source map 和依赖边界验证。

`ws` 与 `@types/ws` 只能保留在这里。测试服务器不承载产品协议；其 namespace 和控制端点仅用于观察物理连接、触发 close/broadcast。运行 `pnpm --filter @socketfuse/test test:e2e` 或 `release:verify`。

手动调试文档站的 `/playground` 时，可运行 `pnpm playground:server` 启动本地回显服务；它监听
`ws://127.0.0.1:8787/socket`，仅用于开发与测试。
