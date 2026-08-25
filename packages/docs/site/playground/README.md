# 演练场页面模块

该目录为 `/playground` 页面提供交互实现：`components` 负责表单、指标与消息呈现，`composables` 负责页面本地 client 生命周期，`workers` 提供只供 E2E 验证 restart 的自定义 SharedWorker。

组件采用 props down / events up；composable 是唯一持有 `WebSocketClient` 的位置。此页面仅展示公开 API，不能成为独立 package 或生产 Worker 模板。
