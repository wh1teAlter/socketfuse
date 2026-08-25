# `wws/src/api`

该目录承载发布包的页面 facade。`create-websocket.ts` 负责校验浏览器 realm、规范化选项、选择 inline/custom SharedWorker，并仅在 Worker 构造或初始化失败且配置允许时创建 direct fallback。

它依赖 `@wws/core` 的公开内部能力和生成的 Worker artifact；业务代码应从 `wws` 导入 `createWebSocket`，不直接引用此目录。网络连接故障不会触发 transport 偷换。
