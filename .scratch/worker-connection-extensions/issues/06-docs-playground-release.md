# 06 — 文档、Playground、三浏览器验收与 Changeset

**What to build:** 使用者能从公开文档回答「什么放 Worker 扩展、什么用 execution key」，并能在 playground 中亲眼验证扩展对全部标签页同时生效。三浏览器 E2E 从公开入口验收该行为，Changeset 准确描述新增能力。

关键文档判断（团队最容易误用的一点）：**纯数据处理**（去重、过滤、共享服务端时钟）用连接作用域扩展，它在 Worker 内一次生效、不消耗页面投递额度；**必须在页面 realm 完成的副作用**（弹通知、写存储、路由跳转）用 execution key，Worker 内没有 DOM，扩展无法替代。

同时需要如实表达两个边界，避免过度承诺：
- 扩展状态是 **at-least-once**。SharedWorker 可被浏览器回收，去重表与时钟随之丢失，`onSocketOpen` 只提供重建时机，库不持久化状态。
- 声明式 JSON 心跳的 ping 是**静态**值；需要每次实时生成（例如携带当前服务端时间戳）必须使用 custom adapter，而 custom adapter 要求自定义 Worker。这两条路径互斥，文档需给出选择方式。

**Blocked by:** 02, 04, 05 — 文档与验收必须描述最终落地的行为

**Status:** ready-for-agent

- [ ] 使用指引新增一节说明入站过滤与 execution key 的选择边界，含各自适用场景
- [ ] 文档给出动态 ping 示例（custom adapter 内实时生成 payload），并说明它与内联 Worker 零配置路径互斥
- [ ] 文档说明扩展状态在 Worker 被回收后丢失，语义为 at-least-once，不是 exactly-once
- [ ] 文档说明扩展只能动态更新 endpoint 与 delay，其余共享参数为启动期共识
- [ ] Worker 模块 README 说明扩展职责与「Worker 不等待页面 handler」不变量的关系
- [ ] 协议文档说明适配器保持无状态，跨帧业务状态归扩展
- [ ] Playground 可通过参数开启演示扩展，直观展示过滤对全部标签页同时生效
- [ ] Chromium、Firefox、WebKit 验证两标签页共享连接下扩展过滤对全部标签页生效
- [ ] 顺带修正 `MessageHandlerOptions.key` 的 TSDoc：「至多由一个页面执行」→「至多授权一个页面启动」（审查 F-006，公开 API 上的过度承诺）
- [ ] 提交面向使用者的 Changeset，准确描述新增扩展能力与端口额度修复
- [ ] 不手工修改版本号或 CHANGELOG
- [ ] 生成产物经正式构建流程重新生成，不手工编辑
