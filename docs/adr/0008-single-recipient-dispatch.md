---
status: accepted
---

# key 保证单接收者分派，不承诺跨页互斥执行

Worker 可以唯一选择某帧的接收者，但在页面停顿、租约回收及端口消息排队并存时，不能撤回已经投递的消息，也不能强制停止页面副作用。本决策以 dispatch key 替换 execution key：runtime 为每条实时帧记录至多一个参与期的分派资格，页面再以参与期、grant 代际及过期检查拒绝失效投递。

仅补 revoke 或本地 TTL 不能把它变为强互斥。使用跨页锁并一直等旧页面释放会牺牲失活转移能力，也不是本库原来的连接共享职责。因此公开保证限定为单接收者选择与尽力抑制过期执行；replay 只进入普通 handler，跨消息或跨 Worker 实例的副作用一致性由应用在其事务边界保证。库不增加内置通用 Ack、业务去重或锁服务；应用在 Worker 内自定义协议回复的能力见 [ADR 0009](0009-worker-protocol-actions-and-retry-budget.md)，不改变这里的分派契约。

本决策替代旧 execution-key 规格中“启动资格唯一”的契约，不否定其普通消息广播、候选顺序和连接所有权原则。接口与时序见[重设计规格](../specs/runtime-correctness-redesign.md)。
