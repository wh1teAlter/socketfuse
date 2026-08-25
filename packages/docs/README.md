# WWS 文档站

此 workspace 使用 VitePress 构建 WWS 的产品文档、生成 API 文档与 Playground。所有站点源文件位于 `site/`，`site/playground.md` 是 Playground 页面，相关 Vue 组件、composable 与测试 Worker 位于其相邻目录。

## 命令

```sh
pnpm --filter @wws/docs dev
pnpm --filter @wws/docs build
pnpm --filter @wws/docs api
```

`api` 由源码 TSDoc 生成 `site/api/generated`；不要直接编辑该输出。文档示例只能依赖公开 `wws` 入口，不能导入 `@wws/core`。
