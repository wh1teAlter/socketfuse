# 01 — 把 endpoint URL 校验收敛到 shared 层

**What to build:** 页面提交重连 URL 与 connection 提交 endpoint 时，使用同一份校验实现，得到完全一致的接受/拒绝行为与错误码。当前这份逻辑在页面侧与 connection 侧各有一份副本，Worker 侧扩展提交 URL 会成为第三处；先收敛到 `shared`，后续 ticket 直接复用。

对使用者而言行为零变化：同样的非绝对 URL、非 `ws:`/`wss:` scheme、超长 URL 仍以 `INVALID_OPTIONS` 拒绝，正常 URL 仍被规范化后接受。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `shared` 提供唯一的 endpoint 校验函数，接受绝对 `ws:`/`wss:` 字符串并返回规范化结果
- [ ] 页面侧重连 URL 校验与 connection 侧 endpoint 校验都改为调用它，两处副本删除
- [ ] 超长（超过 `MAX_ENDPOINT_LENGTH`）在规范化前后都被拒绝，与现状一致
- [ ] 错误仍为 `INVALID_OPTIONS`，且错误详情不含完整 URL 或 query
- [ ] 依赖方向不倒置：`shared` 不引入对 `config`/`protocol`/`connection` 的依赖
- [ ] 既有测试全绿，无需修改断言（行为未变）
