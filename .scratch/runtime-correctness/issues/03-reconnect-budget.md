# 03 — 统一恢复预算与不可覆盖计划

**What to build:** 统一恢复预算与不可覆盖计划，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 01、02。

**Status:** completed

- [x] 初次免费，计数实际启动扣数，不计数不清零；automatic 与 maxRetries 独立。
- [x] 先预留再替代健康 socket；计划覆盖准备、关闭、退避和 connecting，重复加入，冲突/过期拒绝。
- [x] 连续当前 open 才重置；stableThreshold:false 禁用；attempt 与 epoch/预算独立。
- [x] 旧 socket 未确认关闭时不启动第二 socket；背压业务 FIFO 排空和取消 owner 后唤醒。

