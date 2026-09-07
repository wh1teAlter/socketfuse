# worker

本模块是 SharedWorker 部署入口，暴露统一 runtime 并把 onconnect 端口交给它。控制校验、连接池、session、分派、回放、扩展和准备均由 runtime 拥有；这里不维护第二套生命周期。

自定义 Worker 从 socketfuse/worker 调用 createSharedWebSocketRuntime 或 exposeSharedWebSocketWorker；自定义协议用 defineWorkerProtocol 配对注册 adapter 与连接扩展。协议函数同步执行，页面业务 handler 不在 Worker 中执行或等待；扩展准备是唯一有期限的异步 hook。

本模块依赖 runtime，不依赖 page。错误通过安全控制响应输出，应用异常文本不能跨端口。
