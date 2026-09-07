# E2E 测试

`specs/` 使用 Playwright 在 Chromium、Firefox 和 WebKit 中验证公开演练场，覆盖多标签页连接共享、业务广播、dispatchKey 交接、心跳、回放、Worker 重建、降级和资源释放，以及 Worker 收到标志与混合重连预算。

## 运行

在仓库根目录执行：

```sh
pnpm --filter @socketfuse/test exec playwright install chromium firefox webkit
pnpm test:e2e
```

[Playwright 配置](../playwright.config.ts) 会启动或复用 4173 端口的文档服务器和 8787 端口的 WebSocket 测试服务。已有服务必须来自当前工作树；不要与另一个构建或 release:verify 并发执行。

## 测试边界

用例通过页面上的公开 API 行为和 [测试服务](../server/README.md) 的 namespace/control HTTP 接口观察物理连接。每个场景独立隔离 namespace，并释放页面与浏览器上下文。

恢复测试需观察新物理连接和恢复后的消息，不能仅凭旧的 OPEN 显示判定成功。BFCache/freeze 用例通过派发生命周期事件覆盖处理路径，不代表所有浏览器的真实缓存准入和后台调度策略都被模拟。

失败报告位于已忽略的 `packages/test/test-results/`；`playwright-report/` 在启用 HTML reporter 时生成，均不提交。
