---
"socketfuse": minor
---

统一 shared-worker/direct 的连接运行时、MessageChannel 投递与资源限制，修复尝试代际、参与期恢复、队列、准备事务、lease 与错误脱敏问题。

破坏性 API 调整：自定义协议只在 Worker 通过 defineWorkerProtocol 配对注册同步 adapter 和连接扩展；以 onFrame 的 consume/broadcast、一次 reply、可选 reconnect 替代 filterInbound。业务可定义收到标志和连接作用域心跳，回放不重复执行协议。以 reconnect 配置和 maxRetries 统一所有重连来源，countAsRetry:false 只豁免本次计数。key/holdsKey/keychange 改为 dispatchKey/isDispatchOwner/dispatchownerchange，明确单接收者分派不保证副作用互斥。SocketFuseError 移除任意文本、details/cause；发送确认丢失使用 SEND_OUTCOME_UNKNOWN。

发布验收先打包并检查实际 tarball，受保护工作流发布同一个已验证 artifact。
