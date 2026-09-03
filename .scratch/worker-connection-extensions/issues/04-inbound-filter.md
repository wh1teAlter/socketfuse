# 04 — 入站过滤：在共享连接上一次性丢弃不需要派发的帧

**What to build:** 扩展可以对每条已解码的业务帧判定「继续派发」或「整条丢弃」。判定在共享连接上每帧只发生一次，丢弃发生在投递给任何标签页**之前**——因此被丢弃的帧既不穿过 `MessagePort`，也不消耗任何标签页的投递额度。

这让应用可以用一份 Worker 内的逻辑实现入站去重：服务端重发或断线补发的同一条业务帧，只需判重一次，所有标签页同时生效。相比 execution key（全量广播后再 gate handler，帧照样过端口、照样吃额度），这是资源层面的实质收益。

过滤只决定「是否派发」，不改写 payload。它不承诺服务端 exactly-once——Worker 可被浏览器回收，去重表随之丢失，语义是 at-least-once。

```ts
type InboundDecision = 'deliver' | 'drop'

interface ConnectionExtension {
  /** 必须同步：Worker 是所有标签页共享的单线程，await 会放大为全局延迟。 */
  readonly filterInbound?: (data: unknown, context: ConnectionExtensionContext) => InboundDecision
}
```

**降级方向必须是「放行」**：静默丢弃全局消息比重复投递严重得多。

**Blocked by:** 03 — 扩展工厂与生命周期是过滤 hook 的载体

**Status:** ready-for-agent

- [ ] 返回 `drop` 的帧不投递给任何已附着标签页
- [ ] 返回 `drop` 的帧不消耗任何标签页的投递额度（灌入超过额度上限的帧量，其中部分被丢弃，健康标签页仍收到全部应派发的帧）
- [ ] 返回 `deliver` 的帧行为与现状完全一致，仍广播给全部标签页
- [ ] 过滤函数每帧每连接只被调用一次，与标签页数量无关
- [ ] 过滤函数抛出异常时该帧按 `deliver` 放行，并记录一条已脱敏诊断
- [ ] 协议控制帧（ping/pong/ignore/fatal）不进入过滤函数——它们本就不派发给业务
- [ ] 处于挂起状态的标签页，其回放缓冲只收到通过过滤的帧
- [ ] 不提供 `filterInbound` 时，投递行为与现状完全一致
- [ ] 过滤函数不能改写 payload（签名只返回判定，不返回数据）
