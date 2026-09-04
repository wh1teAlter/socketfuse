# 02 — 回收逻辑 close 后的 Worker 端口额度

**What to build:** 反复打开与关闭标签页的长生命周期应用，不再累积占用 Worker 的 MessagePort 额度。当前只调用 `close()`（页面卸载时 `autoClose` 的默认路径，以及 playground 的断开按钮）而不调用 `dispose()` 的端口会**永久**占用 `maxPorts`；额度耗尽后新标签页的 hello 超时，并按 `fallback` 静默降级为每页独立的 direct 连接——库的核心承诺「同一 `id` 最多复用一个物理 WebSocket」由此失效。

修复后：已 close 的端口在 lease 超时后归还额度，新标签页仍能加入共享连接。

原设计意图（防止大量未计数通道绕过 Worker 控制平面上限）必须保留——只把「永久占用」改为「按 lease 超时回收」，而不是 close 时立即释放。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 逻辑 close 后的端口在 lease 超时后被关闭并归还 `maxPorts` 额度
- [x] close 后立刻重新 open 的端口不被回收，且不重复占用额度
- [x] 未 hello 的端口仍按 `unattachedPortTimeoutMs` 回收（现有行为不变）
- [x] `dispose` 仍立即释放额度（现有行为不变）
- [x] 现有那条断言「close 后新端口被拒」的测试改为断言「lease 超时后额度被回收」——它把缺陷固化成了预期，是该问题长期存在的原因
- [x] 新增测试：N 次 attach→close（不 dispose）且超过 lease 超时后，新端口仍能成功 hello
- [x] 回收路径不影响其他健康端口的投递
