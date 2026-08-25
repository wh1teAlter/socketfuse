# transport

此模块实现页面到连接引擎的两种通道：当前 realm 内的 direct 连接池，以及到 SharedWorker 的 `MessagePort` 控制通道；同时定义最小原生 WebSocket 适配面。

两种 transport 必须提供相同的 client 语义。direct 仅在 Worker API 缺失或构造/初始化失败且允许 fallback 时选择；选中 shared transport 后，网络或恢复失败不能切换为 direct。

应用代码通过 `WebSocketClient.transport` 观察结果，不直接创建 transport。
