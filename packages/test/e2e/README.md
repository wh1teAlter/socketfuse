# E2E 测试模块

`specs/` 使用 Playwright 在 Chromium、Firefox 和 WebKit 中验证 Playground 的连接共享、消息广播、生命周期回放、Worker 重建、revision 恢复、降级和资源释放。

测试只依赖公开 `wws` 入口，并通过相邻 `server/` 的 namespace/control HTTP 接口观察物理连接；不把测试控制消息加入产品协议。
