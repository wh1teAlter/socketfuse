# 04 — 一套 runtime 与可重建参与期

**What to build:** 一套 runtime 与可重建参与期，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 01、02、03。

**Status:** completed

- [x] shared 与 direct 都经过原生端口、同一连接池和同一控制 parser；connection 无页面/Worker 依赖。
- [x] hello/welcome 与 attach 分离；只提交一次 transport；custom Worker 禁止 direct。
- [x] close/reopen/Worker 恢复使用新端口与 session，池按 idle 生命周期回收且保留单 socket。
- [x] page open 独立 waiter；维护消息不被用户 pending 额度堵塞；发送未知结果不自动重发。

