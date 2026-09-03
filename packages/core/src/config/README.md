# config

此模块把 `createWebSocket` 选项规范化为共享物理连接配置与页面本地配置，并生成可重复比较的 canonical/fingerprint。初始化 URL 只接受固定字符串；动态 getter 与 URL query 不进入共享 fingerprint。

它依赖 `shared` 与 `protocol`，不拥有 socket 或页面生命周期。相同 `id` 的共享字段必须规范化为相同结果；本地监听器、恢复与 fallback 选项不能参与共享冲突判断。

没有独立公开入口；调用方使用 `socketfuse` 的 `CreateWebSocketOptions`，内部 runtime 使用规范化结果。

heartbeat 默认关闭；显式开启时 raw 可使用严格字符串/二进制 ping-pong，只有配置 `pongTimeout` 才启用存活超时。
