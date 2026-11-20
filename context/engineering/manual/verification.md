---
schema: plugydown.context.document/v1
id: engineering.verification
description: 按改动边界选择源码单测、浏览器验证、文档构建和 tarball 验收。
kind: guide
domain: engineering
code:
  paths:
    - CONTRIBUTING.md
    - package.json
    - packages/docs/package.json
    - packages/test/playwright.config.ts
    - packages/test/release/README.md
    - .github/workflows/ci.yml
---

# 开发验证

修改连接引擎时先运行与源码相邻的单测。跨标签页共享、生命周期和降级涉及平台行为，使用 Playwright 通过演练场和本地 WebSocket 服务，在 Chromium、Firefox 和 WebKit 中验证。若相同端口已有服务，应先确认它属于当前工作树。

修改公开 API 时同步中英文入口、模块 README 与中文 TSDoc。文档站从公开入口生成 API 参考，内联 Worker 也由构建生成；修改生成器的输入，再用构建检查产物。

最终按根贡献指南串行执行 lint、类型检查、单测、构建、文档检查、tarball 验收、E2E 和 diff 检查。构建与发布包验收会使用同一份 dist，并行执行可能使结果失真。`pnpm release:verify` 会对实际打包内容运行消费者类型检查、Vite 构建和 SSR import，可发现仓库内导入无法暴露的入口或打包错误。
