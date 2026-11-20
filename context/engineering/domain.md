---
schema: plugydown.context.document/v1
id: engineering
description: 定位 workspace 职责、仓库开发约定、验证与单包发布流程。
kind: domain
domain: engineering
code:
  paths:
    - AGENTS.md
    - CONTRIBUTING.md
    - pnpm-workspace.yaml
    - package.json
---

# 开发与交付

`packages/core` 提供私有引擎，`packages/socketfuse` 是唯一可发布包，`packages/docs` 维护中文指南与演练场，`packages/test` 提供跨浏览器与发布包验收。

开发任务使用 Plugydown Context 按改动范围查找知识，再核对当前源码和相邻 README。协作与注释约定见根目录 `AGENTS.md`，搭建环境和贡献步骤见 `CONTRIBUTING.md`。

- 调整公开 API、生成内容或选择测试层级，见[开发验证](manual/verification.md)。
- 准备 Changeset、审核版本 PR 或排查发布产物，见[正式版发布](manual/release.md)。
