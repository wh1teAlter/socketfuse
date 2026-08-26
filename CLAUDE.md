# Claude 在 WWS 中的工作说明

开始任何任务前必须阅读并遵守根目录 [AGENTS.md](./AGENTS.md)。它是本仓库唯一的协作、架构边界、中文 TSDoc、README 同步与验证规范来源。

额外执行要点：

- 公开包是 `wws`，不是 scoped package；只维护 `wws`、`wws/protocol`、`wws/worker` 三个公开入口。
- 优先最小、可验证的实现；没有明确复用场景时不引入抽象、配置或新目录。
- 代码、注释、README 与生成的 API 文档必须同步；不要手改由 TypeDoc 或 inline Worker 生成器拥有的内容。
- 保留用户现有工作树和历史 review 证据，完成后报告实际执行过的验证命令及结果。
- 面向用户的改动要提交 Changeset，但不能直接修改版本或 CHANGELOG；不得在本地或递归发布 workspace。
- 发布只能由 Version Packages PR 合并后的 main workflow 使用 npm Trusted Publishing 完成，仓库中不得引入
  长期 npm 发布 token。
- Version Packages PR 必须使用配置的最小权限 GitHub App token 创建，以便触发专用发布包验收；不能用内置
  `GITHUB_TOKEN` 代替。发布前必须校验 App 身份、版本 PR 标题、专用分支和文件白名单，不能发布手工版本提交。
