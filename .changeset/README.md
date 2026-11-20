# Changesets

本目录保存 `socketfuse` 的结构化发布说明。普通贡献者只新增待消费条目；版本生成与发布由维护者处理。

## 添加说明

```sh
pnpm changeset
pnpm changeset:status
```

公开 API、运行时行为、兼容性、依赖或发布内容改变时，为 `socketfuse` 选择合适的 major、minor 或 patch。说明用中文描述用户可见行为，破坏性变更包含迁移提示。纯文档、测试和 CI 维护通常不需要 Changeset。

只有 `socketfuse` 可发布；core、docs、test 都是忽略版本管理的私有 workspace。不要在业务 PR 中顺带修改包版本或 CHANGELOG。

## 文件职责

| 路径 | 用途 |
| --- | --- |
| `config.json` | Changesets 配置、唯一公开包与忽略列表 |
| `*.md`（不含 README） | 尚未消费的变更说明 |
| `pre.json` | 预发布期间记录模式与标签，转正后删除 |
| `pre/*.md` | Changesets 3 在 beta 中已经消费、留待正式版汇总的条目 |

在 beta 模式运行 `pnpm changeset:version` 后，工具更新版本与 CHANGELOG，并将条目移入 `pre/`，下一个 beta 不会重复消费它。`pre/` 与 `pre.json` 都需要跟踪；CHANGELOG 不能替代这些数据。

正式退出 beta 时，由维护者执行 `pnpm changeset pre exit`，并提交目标版本的 Changeset。合并到 main 后，由自动创建的版本 PR 运行 `pnpm changeset:version`。工具会将归档条目纳入正式版发布记录并清理已消费文件，不要提前删除归档。

版本消费后没有待处理条目时，`changeset:status` 仍可能因相对基线存在包改动而返回非零；应核对版本差异和归档，不要为了让命令成功而重复添加发布说明。

Version Packages PR 与正式版发布流程见 [workflow 文档](../.github/workflows/README.md)，贡献流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
