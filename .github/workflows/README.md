# GitHub Actions

本目录只负责仓库质量门禁与 npm 发布，不承担文档部署、自动 review、自动生成 Changeset、git tag 或
GitHub Release。

- `ci.yml`：只验证 PR，提供一个 `verify` required check。所有 PR 都先执行 ESLint 与全仓 typecheck；业务 PR
  再在同一个 runner 顺序执行其余质量检查与三浏览器 E2E，自动生成的 Version Packages PR 则只执行发布包验收，
  避免重复安装浏览器和运行 E2E。
- `release.yml`：main 上消费人工 Changeset 形成 Version Packages PR；版本 PR 合并后在 `npm` environment
  中以 OIDC 发布唯一公开包 `socketfuse`。手工触发只执行 preflight。

workflow 使用 pnpm 10.34.5 管理 monorepo，并在发布 job 中安装 npm 11.5.1 以满足 Trusted Publishing 的
最低要求。不得向 workflow 添加长期 `NPM_TOKEN`、`NODE_AUTH_TOKEN` 或递归 publish。

## 仓库与 npm 配置

发布不使用个人 npm token。仓库管理员需要在 GitHub Actions 配置中设置 `RELEASE_APP_ID`、
`RELEASE_APP_SLUG` 两个 Variables，以及 `RELEASE_APP_PRIVATE_KEY` Secret；它们对应一个只拥有当前仓库
Contents、Pull requests 读写权限的 GitHub App。Version job checkout 不持久化默认只读凭据，确保 Changesets
Action 推送专用分支时只使用该 App token。

还需要在 GitHub 创建受保护的 `npm` Environment（仅 main，按需人工审批），并在 npm 的 `socketfuse` 包设置中把
GitHub owner `wh1teAlter`、repository `socketfuse`、workflow `.github/workflows/release.yml` 和 environment `npm`
设为 Trusted Publisher。npm 因而通过 OIDC 颁发一次性发布凭据；仓库不保存 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN`。

已发布基线为 `0.1.0-beta.2`，基线时 `beta` 与 `latest` 均指向它。release workflow 后续固定发布到
`beta`，不自动移动 `latest`。发布前验证 Version Packages PR 的标题、专用分支、App 身份和文件白名单；`ci.yml` 也要求作者为该 App 的 bot，
不能仅凭同名分支跳过浏览器测试。该 PR 只能消费 `.changeset/*.md` 并修改 `packages/socketfuse/package.json`、
`packages/socketfuse/CHANGELOG.md`。因此发布 job 无需重跑浏览器测试。验收在独占临时目录执行一次 pack/prepack，
核验实际解包内容、包名、版本和 SHA-256；publint 不再次 pack。所有检查通过后导出原 tarball，
发布前再次验证摘要，再用 `npm publish <tarball>` 发布同一文件。
