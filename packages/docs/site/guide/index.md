# 指南

SocketFuse 是一个浏览器库，让同源标签页共享一个物理 WebSocket 连接。它将 socket 放入
`SharedWorker`；每个标签页都会获得自己的 `WebSocketClient` 代理和本地事件处理器。

默认路径刻意保持精简：提供 URL 和稳定的 `id`，调用 `open()`，然后使用 `onMessage()`
与 `sendMessage()`。

## 共享的内容

socket、重连策略、队列、心跳、租约和协议适配器会被共享。页面的监听器、最新 `data`、
生命周期回放缓冲区和 client 对象则仅属于当前页面。

## 从这里开始

- [快速开始](./getting-started)：创建最小可用 client。
- [连接共享](./connection-sharing)：了解 `id` 与冲突规则。
- [可靠性](./reliability)：了解队列、背压与重连。
- [Worker 共享处理](./worker-extensions)：自定义收到标志、协议投影与重连前刷新凭据。
- [降级与 Worker](./fallback-and-worker)：了解部署选择。
