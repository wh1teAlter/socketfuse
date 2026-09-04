# Changelog

## 0.1.0-beta.2

### Minor Changes

- 1e45d71: 新增跨标签页 handler execution key、带 AbortSignal 的持有权交接，以及 Worker 权威的 `onBeforeReconnect` 计划 hook。初始化 endpoint 只接受固定字符串并排除于共享 fingerprint；断线、连接/心跳超时和显式 `reconnect()` 共用可原子更新 URL/delay 的计划。
  
  移除未发布 beta API 中的 auth/revision、adapter ready、capabilities、`SendOptions.idempotencyKey` 和公开 reconnect reason。credential、session、业务 ready、Ack、cursor 与幂等由应用协议维护。heartbeat 默认关闭；raw 支持字符串及可同步 fingerprint 的二进制 ping/pong，JSON/custom adapter 自行定义线上格式，只有显式 `pongTimeout` 才触发存活重连。
- 406146e: 新增连接作用域 Worker 业务扩展：自定义 Worker 可通过 `createSharedWebSocketRuntime({ createExtension })` 为每条共享连接提供一个实例，用 `filterInbound` 在派发前一次性过滤入站帧（被丢弃的帧不消耗任何标签页的投递额度），用 `prepareAttempt` 在重连前异步刷新 endpoint 与延迟而不依赖任何页面活跃，并通过 `onSocketOpen`/`dispose` 获得连接期状态的重建与释放时机。扩展仅能覆盖 endpoint 与 delay；参与共享 fingerprint 的配置仍是多标签页启动期共识。扩展状态在浏览器回收 SharedWorker 后丢失，语义为 at-least-once，不提供 exactly-once。
  
  修复逻辑 `close()` 永久占用 Worker 端口额度的缺陷：反复打开关闭标签页不再累积消耗 `maxPorts`，因此不会在额度耗尽后让新标签页静默降级为独立的 direct 连接。

### Patch Changes

- 3def510: 修复原型不是 `Object.prototype` 的入站 payload 在 SharedWorker 下被整帧丢弃的缺陷。投递额度会计此前把「无法精确估算」当作「超过上限」，因此自定义适配器 `decode` 返回类实例、`Error` 或容器内含这类值时，无论 payload 多小都只会收到 `overflow` 而收不到消息，同一份代码在 `direct` 降级路径下却正常。现在业务 payload 按自有可枚举属性计入额度，真正不可结构化克隆的函数与 symbol 仍视为超限。页面本地 restore 回放缓冲存在同一缺陷，一并修复。
  
  补充文档：Worker 到页面的 4 MiB 既是未确认投递总额度，也是单条消息硬上限——单帧超限会被直接丢弃且不随额度恢复重投，需要更大 payload 时应在应用协议内分片；该限制只作用于 SharedWorker 通道，`direct` 不受投递额度与单帧上限约束。同时说明 close code 1000 是唯一被视为终态、默认不重连的关闭码，以及如何用适配器 `shouldReconnect` 覆盖。

## 0.0.1-beta.1

### 首个 Beta 版本

- 发布基于 SharedWorker 的同源多标签页 WebSocket 连接共享能力，包含连接复用、协议适配、重连、队列与背压、
  生命周期恢复、诊断和 direct 降级。
