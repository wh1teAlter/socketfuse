# GitHub Actions 与发布维护

本目录负责 PR 质量检查、版本 PR 与 npm 发布。贡献者开发步骤见 [CONTRIBUTING.md](../../CONTRIBUTING.md)；本文供维护 CI、版本和发布账户的维护者使用。workflow 不负责文档部署、自动 review、git tag 或 GitHub Release。

## 当前 workflow

| 文件 | 触发方式 | 行为 |
| --- | --- | --- |
| [ci.yml](ci.yml) | 非 draft pull request | 提供 `verify` job；业务 PR 完整验证，App 创建的专用版本 PR 执行静态与 tarball 验收 |
| [release.yml](release.yml) | push 到 main | 检查 Changeset 和版本变化，创建版本 PR，或发布通过身份检查的版本提交 |
| [release.yml](release.yml) | `workflow_dispatch` | 仅执行发布前检查，不发布 |

普通 PR 的 `verify` 依次运行静态检查、单测、构建、文档与 tarball 验收，确认跟踪的内联 Worker 产物没有漂移后，再运行三浏览器 E2E。以 `changeset-release/main` 为分支且作者匹配配置 App 的 PR，执行静态检查与发布包验收。draft PR 转为 ready 后才运行检查。

分支保护应要求 `verify` 通过。各步骤在同一 job 中顺序构建，避免多个任务改写同一个 `dist`。

## 自动发布流程

1. 业务 PR 为用户可见改动添加 Changeset，合并到 main。
2. release workflow 使用 GitHub App token 创建或更新 `chore(release): version socketfuse` PR，分支为 `changeset-release/main`。
3. 维护者审核版本、CHANGELOG、Changeset 消费结果与验收。版本 PR 不包含业务源码改动。
4. PR 合并后，workflow 校验已合并 PR 的 App 作者、标题、目标和专用分支，以及版本提交文件白名单。
5. 受保护的 `npm` environment 中重新验收实际 tarball，校验摘要，然后通过 OIDC 发布同一文件到 `latest`。

Version Packages PR 允许修改公开包的 package.json、CHANGELOG 和 Changeset 说明。退出预发布模式时，Changesets 还会删除处于 `exit` 状态的 `.changeset/pre.json`。

发布只针对 `socketfuse`。当前仓库版本见 [package.json](../../packages/socketfuse/package.json)，已发布版本和标签以 npm 为准：

```sh
npm view socketfuse dist-tags --json
```

## 从 beta 转为正式版

维护者执行 `pnpm changeset pre exit`，将状态变更和指向 1.0.0 的 major Changeset 一起提交。合并到 main 后，版本 PR 汇总 beta 归档和本次说明、更新包版本并清理预发布状态。维护者审核并合并该 PR 后，发布 job 校验版本号并将已验收的 tarball 发布到 npm 的 `latest` 标签。

beta 阶段若获维护者明确授权，可单独消费 Changeset 并手动将验收过的单包 tarball 发布到 `beta`。该例外仅适用于预发布版本。正式版由上述 Version Packages PR 和受保护的发布 job 完成。

## 发布包验收

[verify-release.mjs](../../packages/test/release/verify-release.mjs) 使用独占临时目录执行一次 pack/prepack，对解包结果运行 publint、消费者类型检查、Vite 构建和 SSR import，核验文件白名单、包名、版本与 SHA-256。验收不要求事先存在 dist。

设置 `SOCKETFUSE_VERIFIED_TARBALL` 可导出验收通过的原 tarball；目标文件及其 `.sha256` 必须不存在。导出不执行发布。workflow 在发布前再次校验摘要，避免验收后重新打包出另一份产物。

## GitHub 与 npm 账户配置

workflow 使用 pnpm `10.34.9`、Node `22.18.0`，发布 job 安装 npm `11.5.1`。

| 配置位置 | 名称 | 用途 |
| --- | --- | --- |
| GitHub Actions variable | `RELEASE_APP_ID` | 创建版本 PR 的 GitHub App ID |
| GitHub Actions variable | `RELEASE_APP_SLUG` | 验证版本 PR 作者的 App slug |
| GitHub Actions secret | `RELEASE_APP_PRIVATE_KEY` | 为该 App 签发短期 token |
| GitHub environment | `npm` | 限制 main，并按需要配置人工审核 |
| npm Trusted Publisher | 仓库 `wh1teAlter/socketfuse`、workflow `release.yml`、environment `npm` | 授权受保护 job 通过 OIDC 发布 |

App 只授予当前仓库 Contents 与 Pull requests 的读写权限。版本 job 不持久化默认 checkout 凭据，Changesets Action 使用 App token，以便新 PR 能触发 CI；不能退回内置 `GITHUB_TOKEN` 创建版本 PR。

workflow 不保存长期 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN`，也不使用 `pnpm -r publish` 或 `changeset publish`。自动发布凭据由 GitHub OIDC 与 npm Trusted Publishing 提供。
