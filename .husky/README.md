# Husky Hooks

本目录只承载本地 Git 提交防线。`pre-commit` 在非 CI 环境先运行全仓类型检查，再让 lint-staged 对已暂存
源码与 JSON 执行 ESLint 修复；单元测试、构建和浏览器 E2E 由显式命令与 GitHub Actions 承担。

`pnpm install` 通过根 `prepare` 安装 hook。紧急情况下可以设置 `HUSKY=0` 跳过本地 hook，但 PR 的
`quality` 与 `e2e` 门禁仍必须通过。`.husky/_/` 是 Husky 生成目录，不应提交。
