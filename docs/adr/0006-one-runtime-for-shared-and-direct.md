---
status: accepted
---

# shared 与 direct 使用同一连接运行时

两条 transport 当前分别实现连接池、回放、控制等待与错误传播，已经产生可观察的语义差异。本决策把这些所有权移入同一个不依赖页面或 Worker 启动环境的 runtime：SharedWorker 接入浏览器提供的端口，direct 通过页面内原生 MessageChannel 接入页面共享的 runtime。两者共用控制协议、资源边界与生命周期，只有共享域和部署能力不同。

继续同步修补两套实现不能消除后续漂移；手写同步 loopback 又会恢复回调重入和对象别名问题。选择原生 MessageChannel 的代价是 direct 也承担异步控制、结构化克隆与投递额度；这是明确接受的一致性成本。custom Worker 部署禁止自动降级，因为页面无法重建其扩展与协议注册。

模块迁移、状态机和验收见[重设计规格](../specs/runtime-correctness-redesign.md)。
