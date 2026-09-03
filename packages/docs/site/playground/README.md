# 演练场页面模块

该目录为 `/playground` 页面提供交互实现：`components` 负责表单、指标与消息呈现，`composables` 负责页面本地 client 生命周期，`workers` 提供只供 E2E 验证 restart 的自定义 SharedWorker。

组件采用 props down / events up；composable 是唯一持有 `WebSocketClient` 的位置。指标中“物理连接数”由当前页面观测到的 `physicalState` 映射为 `0` 或 `1`，“共享页面数”来自 Worker 的 `attachedClientCount`。后者跨 `MessagePort` 异步返回，因此仅在页面参与连接期间由 composable 低频刷新；页面断开后必须停止刷新，避免展示过期的共享快照。

页面同时注册普通 handler 与 `playground:single-execution` keyed handler：所有标签页的消息列表都会更新，但“独占执行数”每帧只在 holder 页面增加。`onBeforeReconnect` 会重新读取 URL 输入并用零延迟提交当前计划，方便直接观察 endpoint 刷新和 hook 次数。

此页面仅展示公开 API，不能成为独立 package 或生产 Worker 模板。
