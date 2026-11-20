---
schema: plugydown.context.document/v1
id: socket-runtime
description: 定位公开入口、连接所有权、Worker 协议和页面投递边界。
kind: domain
domain: socket-runtime
code:
  paths:
    - packages/socketfuse/src/index.ts
    - packages/socketfuse/src/protocol.ts
    - packages/socketfuse/src/worker.ts
    - packages/core/README.md
    - CONTEXT.md
---

# 运行时与公开契约

应用从 `socketfuse` 创建页面 client，从 `socketfuse/protocol` 获取协议适配器契约，在自定义 Worker 中从 `socketfuse/worker` 装配协议和 runtime。公开包打包私有 core，应用只依赖公开入口。

- 涉及多个页面是否复用同一物理连接、降级条件或重开行为，先看[连接所有权](design/connection-ownership.md)。
- 涉及单帧处理次数、跨页分派、发送回执或回放，先看[消息投递](design/message-delivery.md)。

仓库根目录的 `CONTEXT.md` 定义了共享域、参与期、重连预算和业务投影等术语。
