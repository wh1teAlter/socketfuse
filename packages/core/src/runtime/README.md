# runtime

本模块拥有共享连接池、端口参与期、分派接收者、投递额度与回放、连接扩展和准备事务。SharedWorker 的 MessagePort 和页面内 direct MessageChannel 都接入同一实现。

## 职责与接口

内部 `createConnectionRuntime` 接受端口，协调连接需求和回收；没有单独 npm 入口。自定义 Worker 通过 `socketfuse/worker` 的 runtime API 部署，以 `defineWorkerProtocol` 配对注册同步 adapter 和连接扩展。

协议处理在向页面投递前每物理帧执行一次。回放仅保存业务投影快照；分派资格按帧选择，lease 与页面检查抑制过期执行，不承诺异步副作用互斥。异步准备独立于页面业务 handler，受总期限和未结算额度限制。

## 依赖与边界

runtime 依赖 config、protocol、connection 和 shared，不依赖页面业务对象或 Worker 全局。每个连接条目拥有一个 controller，controller 不保存页面接收者。连接池和端口生命周期位于这里，使两种 transport 复用相同语义。

握手只协商版本和能力，attach 才表达参与需求。同一 id 的完整共享配置冲突必须拒绝；socket 关闭确认前不能回收条目再创建第二条连接。控制错误仅携带 code/fatal/retryable；Worker 不等待页面业务 handler。
