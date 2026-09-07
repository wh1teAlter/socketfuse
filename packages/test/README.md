# 测试 workspace

此私有 workspace 验证公开包的浏览器行为和发布产物，并提供本地 WebSocket 测试服务。它不作为 npm 产品发布。

| 模块 | 职责 |
| --- | --- |
| [e2e](e2e/README.md) | Playwright 三浏览器、多标签页验收 |
| [server](server/README.md) | 本地 ws 回显、广播、关闭和连接计数 |
| [release](release/README.md) | 实际 tarball 的入口、类型、依赖、source map 与 SSR 验收 |

## 命令

在仓库根目录执行：

```sh
pnpm --filter @socketfuse/test exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm release:verify
pnpm playground:server
```

这些命令按需要分别运行。E2E 与发布验收都可能构建公开包，应串行执行。具体的全仓顺序见 [贡献指南](../../CONTRIBUTING.md)。

`ws` 和 `@types/ws` 只存在于本 workspace。测试通过公开包和服务端统计观察行为，不把 namespace 或控制 HTTP 端点加入产品协议，也不依赖私有 core 实现。
