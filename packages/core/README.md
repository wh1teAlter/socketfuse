# @socketfuse/core

`@socketfuse/core` 是 SocketFuse 的私有浏览器连接引擎。它定义共享连接的状态机、协议适配、控制协议、Worker runtime、页面 client 与 direct fallback；不会作为 npm 公共依赖发布。

## 职责

- `shared` 提供跨模块类型、稳定错误码、默认常量、字节计算与结构化克隆工具。
- `config` 将页面选项规范化为可比较的共享配置与本地配置。
- `protocol` 定义 raw、JSON 与自定义 Worker 协议适配器。
- `connection` 只管理物理 WebSocket 生命周期、重连、心跳、队列、背压与 revision。
- `transport` 把页面 client 接到 direct 或 SharedWorker 通道。
- `runtime` 验证控制消息、拥有连接池、session、分派、回放和连接扩展。
- `worker` 只负责 SharedWorker 部署与端口接入。
- `page` 把 transport 呈现为稳定的 `WebSocketClient` 对象与浏览器生命周期行为。

## 依赖

依赖只能沿 `shared → config/protocol/connection → runtime → transport/worker → page → facade` 流动。`connection` 不依赖页面或 Worker；Worker 不调用页面业务 handler；页面代码不向 Worker 发送函数。

## 使用

公开包 `socketfuse` 会打包此模块。应用代码应从 `socketfuse`、`socketfuse/protocol` 或 `socketfuse/worker` 导入，不直接依赖 `@socketfuse/core`。

## 不变量

同一 Worker 中，相同 `id` 和共享配置只拥有一个物理 socket；冲突必须失败。控制消息、诊断和错误跨端口时不携带凭据、业务 payload 或内部异常文本。
