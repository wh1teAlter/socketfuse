# 05 — 完成 execution key 的冻结与生命周期安全

**What to build:** 每条业务帧仍广播到所有 attached 页面，但带相同 key 的 handler 只允许当前 Worker 授权页面开始执行；页面冻结、租约失活或 detach 时安全转移开始执行权。

**Blocked by:** None — 领域上可独立实现；为减少同文件冲突，落地时建议排在 01–04 之后

**Status:** completed

## Scope

- `onMessage(handler, { key })` 记录同一页面上该 key 的全部回调；一次被授权的消息到达时按既有注册顺序调用这些回调。
- gate 只作用于 keyed handler 的“开始调用”，不改变业务帧广播、EventTarget message、credit、overflow 或 unkeyed handler 行为。
- Worker 使用独立 `KEY_GRANTED` / `KEY_REVOKED` 控制帧维护每个页面的持有集合；业务 envelope 不附带 key 所有权。
- 相同 key 先到先得；首次选主偏好 visible，同可见性按 FIFO；后注册和 hidden 不抢占健康持有者。
- close、dispose、端口失败、明确 freeze 与 lease 失活撤销并转移；仅进入 hidden 不主动转移。
- 页面 held set 只接受 Worker 权威控制帧，不本地推断；但收到 freeze 时必须立即保守阻止新 keyed handler 开始，并 abort 当前 grant 的 signal。
- resume 后不能复用 freeze 前的本地授权，必须等待新的 `KEY_GRANTED`，以阻止 MessagePort 中滞留消息按旧权威执行。
- handler context 暴露 grant 对应的 `AbortSignal`；revoke/freeze 只阻止后续开始并通知协作取消，不宣称能强制终止已运行的 JavaScript。
- 未 open/已 close 页面只缓存本地 handler intent，不 attach、不注册 key、不参与持有；重新 open 后按当前 intent 注册。
- `maxExclusiveKeys` 限制 Worker 中不同 key 数量；超限以 `RESOURCE_LIMIT_EXCEEDED` 拒绝该次注册、回滚 desired registration，且不使 `open()` 失败。
- direct fallback 中每个实例本地持有自身 key，并明确不提供跨标签页独占保证。

## Invariants

- 库只保证同一 grant epoch 下某个 key 最多一个页面开始新 handler，不保证业务幂等、exactly-once、事务或已开始异步 handler 的强制终止。
- 所有 attached 页面仍接收并可维护本地视图；不能把 execution key 实现成 Worker 定向投递。
- 后注册者永不覆盖活跃持有者；所有权变更只能由 Worker 的显式 revoke/grant 顺序驱动。
- key 名称和 held 状态只出现在必要控制面/公开观测 API，不与每帧额度记账耦合。

## Acceptance

- [x] keyed/unkeyed/EventTarget 同时存在时，每页都收到消息，只有 keyed callbacks 跨页面单点开始。
- [x] 同一页面相同 key 的多个回调均被记录和执行，不发生后注册覆盖。
- [x] visible/FIFO、后注册不抢占、hidden 不转移、close/freeze/lease 转移均有确定性测试。
- [x] freeze 后排队的旧消息不能在 resume 时依赖 stale held set 执行；新 grant 使用新的 AbortSignal。
- [x] unopened/closed 页面不占 key；重新 open 后重新参与竞选。
- [x] 超过 `maxExclusiveKeys` 不污染 Worker key 表、不留下页面 desired key，也不阻断连接打开。
- [x] Chromium、Firefox、WebKit 多标签页测试证明广播未改变、单点开始和冻结/关闭转移成立。

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `git diff --check`
