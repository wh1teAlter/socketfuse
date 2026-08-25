# E2E 测试服务

该目录提供仅供 Playwright 使用的本地 `ws` echo/control server。`namespace` 隔离并发测试，`/stats` 观察连接和消息计数，`/control` 触发 close/broadcast。

服务不实现 WWS 协议，不承载生产凭据或业务 payload；`ws` 与 `@types/ws` 的依赖仅保留在 `packages/test`。
