---
schema: plugydown.context.document/v1
id: socket-runtime.connection-ownership
description: 解释页面、transport、runtime 与原生 WebSocket 的所有权及降级时机。
kind: architecture
domain: socket-runtime
code:
  paths:
    - packages/socketfuse/src/api/create-websocket.ts
    - packages/core/src/transport/shared-worker.ts
    - packages/core/src/transport/direct.ts
    - packages/core/src/runtime/host.ts
    - packages/core/src/connection/README.md
    - packages/core/src/page/README.md
---

# 连接所有权

三个公开入口支持 SSR 导入。调用 `createWebSocket` 需要页面 realm。逻辑 client 在 `open()` 时建立参与期；`close()` 结束该页的参与，此后可重新打开，`dispose()` 永久释放 client。

SharedWorker 端口和 direct 的 MessageChannel 都把参与期交给同一套 runtime 实现。runtime 按 `id` 查找连接条目，校验完整共享配置，再把页面附着到条目。加入方的初始 URL 不参与共享身份，也不会替换现有 endpoint。配置冲突报 `CONNECTION_CONFIG_CONFLICT`。`id` 只表达复用意图，鉴权由应用协议承担。

每个条目由一个 connection controller 管理原生 socket、连接尝试和重连预算。旧 socket 确认关闭后才能启动替代连接。调整尝试或背压时从 connection 层入手；参与者、连接池和端口回收由 runtime 协调。

内联 Worker 只在首次选择 transport 时，遇到受支持的构造、加载、平台或初始化超时错误，才按策略尝试 direct。握手成功即固定选择，随后网络失败与重开沿用该 transport。自定义 Worker 初始化失败会显式报错。direct 的共享范围限于当前页面中的同一包实例。
