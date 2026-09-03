# 03 — 连接作用域扩展工厂与生命周期回调

**What to build:** 应用可以在自己的 SharedWorker 文件中提供一个**连接作用域业务扩展**工厂，由 Worker 按共享连接调用一次，得到该连接独占的扩展实例。扩展在物理 socket 打开时收到通知（用于初始化或重置连接期状态，例如服务端时钟），在连接条目释放时收到通知（用于释放自有资源）。

这是后续两个能力（入站过滤、连接尝试准备）的载体。本 ticket 完成后扩展还不具备过滤或准备能力，但工厂调用、按连接隔离、以及生命周期时机都可端到端验证。

**为何是工厂而非单例**：连接条目按 `id` 建立，空闲回收后可被重建。工厂让「连接重建 → 状态重置」成为结构保证，而不依赖扩展作者自觉。

以下类型形状来自设计阶段的原型，它比文字更精确地表达了能力边界（上下文只暴露连接身份与 origin，不含完整 endpoint、query 或凭据）：

```ts
interface ConnectionExtensionContext {
  readonly connectionId: string
  readonly endpointOrigin: string   // 仅 origin，与 diagnostics 同口径
  readonly attempt: number
}

interface ConnectionExtension {
  readonly onSocketOpen?: (context: ConnectionExtensionContext) => void
  readonly dispose?: () => void
}

type ConnectionExtensionFactory = (context: ConnectionExtensionContext) => ConnectionExtension
```

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `socketfuse/worker` 的 runtime 选项接受可选的扩展工厂，其余既有选项行为不变
- [ ] 每条共享连接调用工厂恰好一次；两条不同 `id` 的连接得到两个独立实例
- [ ] 同一连接上多个标签页 attach 不会重复调用工厂
- [ ] `onSocketOpen` 在物理 socket 打开时、且在向标签页 fan-out 之前调用
- [ ] 重连成功后 `onSocketOpen` 再次调用，`attempt` 递增
- [ ] 连接条目被空闲回收时 `dispose` 被调用；重建后工厂再次调用，得到全新实例
- [ ] 扩展回调抛出异常时只记录已脱敏诊断，不影响连接状态机，也不跨端口传播异常文本
- [ ] 上下文只暴露连接身份与 endpoint origin，不含完整 URL、query 或共享配置指纹
- [ ] 不提供扩展时，所有既有行为与测试完全不变
- [ ] `connection` 层不因此依赖 `worker` 层（回调以 controller 选项注入）
