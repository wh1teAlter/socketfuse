---
"socketfuse": minor
---

新增跨标签页 handler execution key、带 AbortSignal 的持有权交接，以及 Worker 权威的 `onBeforeReconnect` 计划 hook。初始化 endpoint 只接受固定字符串并排除于共享 fingerprint；断线、连接/心跳超时和显式 `reconnect()` 共用可原子更新 URL/delay 的计划。

移除未发布 beta API 中的 auth/revision、adapter ready、capabilities、`SendOptions.idempotencyKey` 和公开 reconnect reason。credential、session、业务 ready、Ack、cursor 与幂等由应用协议维护。heartbeat 默认关闭；raw 支持字符串及可同步 fingerprint 的二进制 ping/pong，JSON/custom adapter 自行定义线上格式，只有显式 `pongTimeout` 才触发存活重连。
