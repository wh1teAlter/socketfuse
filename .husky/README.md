# 本地 Git hooks

`pnpm install` 通过根 `prepare` 安装 Husky。`pre-commit` 在非 CI 环境先运行全仓 typecheck，再调用 lint-staged 对已暂存的源码和 JSON 执行 ESLint 修复。Markdown 不在 lint-staged 文件模式内，提交消息也没有格式校验。

hook 不执行单测、构建或浏览器 E2E，不能代替 [贡献指南](../CONTRIBUTING.md) 中的串行验收。`HUSKY=0` 只跳过本地 hook，不改变 PR 的 `verify` 检查或分支保护要求。

`.husky/_/` 是 Husky 生成目录，不应编辑或提交。
