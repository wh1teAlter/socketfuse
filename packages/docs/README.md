# 文档 workspace

此私有 workspace 用 VitePress 构建中文产品指南、公开 API 参考和内嵌演练场。应用示例及演练场只依赖三个公开 `socketfuse` 入口，不导入私有 core。

## 内容入口

| 路径 | 职责 |
| --- | --- |
| `site/index.md` | 产品首页和阅读导航 |
| `site/guide/` | 从安装到共享连接、恢复与 Worker 扩展的使用指南 |
| `site/protocols/` | raw、JSON 和自定义同步 adapter |
| `site/reference/` | 配置、事件、诊断与部署边界 |
| `site/api/` | API 导航；`generated/` 由 TypeDoc 生成 |
| `site/playground.md`、`site/playground/` | 浏览器演练场页面及其实现 |
| `site/.vitepress/` | 中文导航、搜索、主题与构建配置 |

## 开发

首次克隆后在根目录安装并构建公开包，详见 [贡献指南](../../CONTRIBUTING.md)。随后可运行：

```sh
pnpm --filter @socketfuse/docs dev
pnpm --filter @socketfuse/docs api
pnpm --filter @socketfuse/docs build
```

开发地址是 `http://127.0.0.1:4173`。手动使用 `/playground` 时另开终端执行根命令 `pnpm playground:server`；WebSocket 服务属于测试 workspace。

## 维护约定

中文指南与源码 TSDoc 是文档维护基准。根 README 提供中英文入口，npm README 使用英文并链接中文说明；更新公开行为时应同步这些入口，避免翻译产生另一套契约。

`api` 从三个公开入口生成 `site/api/generated/`。`dev` 和 `build` 会先执行它；不要手工编辑或提交生成 Markdown。GitHub 上没有生成文件，阅读完整类型需启动或构建站点。

修改页面路径时同时更新侧栏和交叉引用。根目录的 `pnpm docs:check` 会生成 API 并构建站点，检查站内链接；根 README、贡献指南和模块 README 的相对文件链接仍需单独检查。
