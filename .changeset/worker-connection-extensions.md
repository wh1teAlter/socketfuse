---
"socketfuse": minor
---

新增连接作用域 Worker 业务扩展：自定义 Worker 可通过 `createSharedWebSocketRuntime({ createExtension })` 为每条共享连接提供一个实例，用 `filterInbound` 在派发前一次性过滤入站帧（被丢弃的帧不消耗任何标签页的投递额度），用 `prepareAttempt` 在重连前异步刷新 endpoint 与延迟而不依赖任何页面活跃，并通过 `onSocketOpen`/`dispose` 获得连接期状态的重建与释放时机。扩展仅能覆盖 endpoint 与 delay；参与共享 fingerprint 的配置仍是多标签页启动期共识。扩展状态在浏览器回收 SharedWorker 后丢失，语义为 at-least-once，不提供 exactly-once。

修复逻辑 `close()` 永久占用 Worker 端口额度的缺陷：反复打开关闭标签页不再累积消耗 `maxPorts`，因此不会在额度耗尽后让新标签页静默降级为独立的 direct 连接。
