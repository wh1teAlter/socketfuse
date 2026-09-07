# 运行时正确性实施记录

本地任务基线为 `b5710058681e97ace11804c3065f222927167244`。本目录负责记录已授权方案的规格、决策细化、任务依赖与真实验收状态；历史 `docs/review/` 不作修改。

工作流为 grill-with-docs → to-spec → to-tickets → implement → code-review。规格见 [spec.md](spec.md)，具体状态转移与控制消息见 [design.md](design.md)，每张任务独立位于 issues。沿用仓库已有本地文件 tracker，不创建远端 issue。

最终审查比较固定基线及全部当前改动，由 Standards/Spec 两个独立审查人审查，主审查人逐条复现后修正。验收命令只由主代理串行执行。
