---
status: accepted
---

# 协议转换同步完成，异步准备显式拥有生命周期

异步 encode/decode/classify 把不受取消约束的 Promise 串接在资源额度之前；旧连接的处理既可能污染新连接，也可能永远阻塞后续帧。本决策要求协议转换与心跳帧生成同步完成，原生入站统一使用 ArrayBuffer；页面需要 Blob 时只在派发表示层转换。异步能力保留在确有外部 I/O 需求的重连准备和页面业务 handler 中。

相比增加协议任务 deadline、并发队列和跨代际恢复规则，这一破坏性变更删除 OrderedProtocol 与 outgoingTail 所管理的异步状态。需要异步加解密或解压的应用在库外处理原生 payload；库内 adapter 不承担任意异步业务执行。准备 hook 仍须有取消事务和未结算任务上限，不能把 AbortSignal 当作强制终止。

具体错误策略、二进制表示与迁移见[重设计规格](../specs/runtime-correctness-redesign.md)。
