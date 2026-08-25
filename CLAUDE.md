# Claude 在 WWS 中的工作说明

开始任何任务前必须阅读并遵守根目录 [AGENTS.md](./AGENTS.md)。它是本仓库唯一的协作、架构边界、中文 TSDoc、README 同步与验证规范来源。

额外执行要点：

- 公开包是 `wws`，不是 scoped package；只维护 `wws`、`wws/protocol`、`wws/worker` 三个公开入口。
- 优先最小、可验证的实现；没有明确复用场景时不引入抽象、配置或新目录。
- 代码、注释、README 与生成的 API 文档必须同步；不要手改由 TypeDoc 或 inline Worker 生成器拥有的内容。
- 保留用户现有工作树和历史 review 证据，完成后报告实际执行过的验证命令及结果。
