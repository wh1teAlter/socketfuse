# 10 — 完整串行验收与双轴代码审查

**What to build:** 完整串行验收与双轴代码审查，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 09。

**Status:** completed

- [x] 按 lint → typecheck → test → build → docs:check → release:verify → test:e2e → diff 串行运行并记录真实结果。
- [x] Standards 与 Spec 独立只读审查，主审查人逐条复现、修正或记录排除依据。
- [x] F01–F22 及新增需求全部可追溯；所需修正和相关复验完成才关闭任务。

