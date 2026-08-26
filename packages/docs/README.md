# SocketFuse 文档站

此 workspace 使用 VitePress 构建 SocketFuse 的产品文档、生成 API 文档与 Playground。所有站点源文件位于 `site/`，`site/playground.md` 是 Playground 页面，相关 Vue 组件、composable 与测试 Worker 位于其相邻目录。

## 命令

```sh
pnpm --filter @socketfuse/docs dev
pnpm --filter @socketfuse/docs build
pnpm --filter @socketfuse/docs api
```

`api` 由源码 TSDoc 生成 `site/api/generated`；该目录是已忽略的构建产物，不应直接编辑或提交。`dev` 与 `build` 会在启动站点前自动执行生成，因此干净克隆无需预先保留 API Markdown。文档示例只能依赖公开 `socketfuse` 入口，不能导入 `@socketfuse/core`。
