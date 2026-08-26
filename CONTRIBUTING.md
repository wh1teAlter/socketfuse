# 贡献指南

## 环境与常用命令

使用 Node `^22.18.0 || >=24.11.0` 与仓库声明的 pnpm 10.34.5。

```sh
pnpm install
pnpm dev
pnpm playground:server
```

`pnpm check` 运行 lint、类型检查、单元测试、构建、文档构建与发布包验收；`pnpm test:e2e` 单独运行
Chromium、Firefox、WebKit 的浏览器测试。提交 hook 只执行全仓类型检查和暂存文件 ESLint 修复，不能替代 CI。

## Changeset

改动公开 API、运行时行为、兼容性、错误语义或 npm 包内容时，在业务 PR 中运行：

```sh
pnpm changeset
pnpm changeset:status
```

为 `socketfuse` 选择准确的 major、minor 或 patch，并用面向使用者的中文描述变更。仅文档、测试、CI 和仓库维护
改动通常不需要 Changeset。不要直接修改 `packages/socketfuse/package.json` 的版本或 `CHANGELOG.md`。`pnpm
changeset:version` 会修改版本、写入 CHANGELOG 并删除已消费的 Changeset；它只供维护者在隔离 worktree 排查
版本结果，绝不能在业务工作树运行或提交其结果。

## Pull Request 门禁

普通 PR 的 required check 应配置为 `verify`。它首先执行 ESLint 与全仓 typecheck，然后顺序执行其余质量校验
和三浏览器 `pnpm test:e2e`，避免同一提交因并行构建争用 `packages/socketfuse/dist`。Changesets 生成的 Version
Packages PR 也执行 ESLint 与全仓 typecheck，再运行 `pnpm release:verify` 验收最终 tarball，不重复运行浏览器
测试。本地可用 `HUSKY=0` 跳过 hook，但不能绕过 required check。

## 版本与发布

Changeset 合并到 main 后，`.github/workflows/release.yml` 使用 Changesets Action 创建或更新
`chore(release): version socketfuse` PR。维护者需要审核版本级别、`packages/socketfuse/CHANGELOG.md`、发布包元数据以及
`verify` 结果。版本 PR 合并后，workflow 会校验该 PR 的身份和文件白名单，然后只构建并发布 `packages/socketfuse`；
不会重复运行已在业务 PR 中通过的浏览器测试。

当前首发版本为 `socketfuse@0.0.1-beta.1`，并发布到 npm 的 `beta` dist-tag；它不会覆盖 `latest`。仓库没有本地
`release` 脚本；不要手工执行 publish，也不要使用 `pnpm -r publish` 或 `changeset publish`。发布使用 npm CLI 11.5.1 的
Trusted Publishing 支持与 GitHub OIDC；pnpm 继续负责依赖、workspace 和所有验证命令。仓库 workflow 不保存
`NPM_TOKEN` 或 `NODE_AUTH_TOKEN`。

## 首次发布配置

以下操作属于 npm/GitHub 账户配置，源码不能自动完成：

1. 首次创建或发布 npm 包 `socketfuse`。首发应以 `0.0.1-beta.1` 发布到 `beta` dist-tag；若 npm 尚不允许为未存在
   的包配置 Trusted Publisher，使用一次性 granular token 手工完成首发，随后立即撤销 token。
2. 在 npm 包设置中添加 GitHub Actions Trusted Publisher：owner `wh1teAlter`、repository `socketfuse`、workflow
   `release.yml`、environment `npm`，并允许 `npm publish`。
3. 创建并安装一个最小权限 GitHub App，授予当前仓库 Contents 与 Pull requests 的读写权限；在仓库 Actions
   variables 中配置其 App ID 为 `RELEASE_APP_ID`，并在 Actions secrets 中配置私钥为
   `RELEASE_APP_PRIVATE_KEY`，同时在 Actions variables 中配置该 App slug 为 `RELEASE_APP_SLUG`。Version
   Packages PR 必须由此 App 创建，才能触发 `verify`；内置 `GITHUB_TOKEN` 创建的 PR 不会触发新的 workflow
   run。发布 workflow 会校验 PR 标题、专用分支、该 App 身份与文件白名单，拒绝手工版本提交。
4. 在 GitHub 创建受保护的 `npm` environment，限制 main 并按需要增加人工审核。
5. 在 main branch protection 中将 `verify` 设置为 required check。
6. 验证 OIDC 发布成功后，在 npm 启用“要求 2FA 且禁止 token”，撤销不再使用的自动化 token。

`workflow_dispatch` 只运行发布前校验，不会发布，也不能绕过 Version Packages PR。
