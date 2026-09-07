# runtime

本模块拥有共享连接池、端口参与期、分派接收者、投递额度与回放、连接扩展和准备事务。SharedWorker 和 direct 的原生 MessageChannel 都接入同一实现；旧 direct 池与页面 replay 不再作为独立语义来源。

现有 connection 复用不足以统一端口和池生命周期，因此把已有 Worker 所有权迁入这里。runtime 依赖 config、protocol、connection 和 shared，不依赖页面业务对象或 Worker 全局。一个条目只有一个 controller 和内部 observer；controller 不保存页面 sink。

控制版本先握手再 attach，错误只发送 code/fatal/retryable。同 id 完整 canonical 冲突必须拒绝；socket 关闭确认前不能回收条目再建第二连接。Worker 不等待页面业务 handler；异步准备只在单一总期限和未结算额度内运行。

协议处理在 fan-out 前每物理帧一次执行；replay 仅保存库拥有的业务投影快照。每帧分派 stamp 固定接收资格，lease 与本地检查抑制过期执行，不承诺跨页面副作用互斥。
