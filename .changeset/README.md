# Changesets

面向用户的 `wws` 行为、公开 API、兼容性或发布包内容发生变化时，运行 `pnpm changeset` 并提交生成的
Markdown。仅文档、测试、CI 和仓库维护改动可以不写 Changeset。

Changeset 只描述变更与版本级别；main 上的 release workflow 负责创建 Version Packages PR。不要在业务
PR 中直接修改 `packages/wws/package.json` 的版本或 `CHANGELOG.md`。
