---
schema: plugydown.context.document/v1
id: engineering.release
description: 说明 Changeset、版本 PR 身份、实际 tarball 与 OIDC 发布之间的关系。
kind: guide
domain: engineering
code:
  paths:
    - .changeset/config.json
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - packages/test/release/verify-release.mjs
---

# 正式版发布

面向用户的改动为 `socketfuse` 添加 Changeset。业务 PR 合并到 main 后，由受限 GitHub App 创建或更新版本 PR，集中消费 Changeset 并更新版本和 CHANGELOG。版本 PR 的专用验收依赖 App 身份；正式发布还会校验合并目标、标题、分支与文件白名单。

版本 PR 合并后，受保护的 `npm` environment 验收实际 tarball 并校验摘要，然后通过 OIDC 发布同一个文件。手动触发 release workflow 只运行预检。排查发布问题时，先定位失败发生在版本 PR 创建、身份校验、产物验收还是 npm 授权阶段。所需账户配置见仓库的 `.github/workflows/README.md`。
