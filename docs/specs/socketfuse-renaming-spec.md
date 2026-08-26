# SocketFuse 品牌与包名迁移规格

## 目标

将尚未发布的 WWS 完整更名为 SocketFuse，以 `socketfuse` 作为唯一 npm 包名和模块导入前缀。迁移完成后，不保留 `wws` 包、导入别名或公开 API 兼容层。

## 命名契约

| 范围 | 迁移后名称 |
| --- | --- |
| 产品名称 | SocketFuse |
| npm 包名与主入口 | `socketfuse` |
| 公开子入口 | `socketfuse/protocol`、`socketfuse/worker` |
| 私有 workspace | `@socketfuse/core`、`@socketfuse/docs`、`@socketfuse/test` |
| 发布包目录 | `packages/socketfuse` |
| 错误公开 API | `SocketFuseError`、`isSocketFuseError`、`SOCKET_FUSE_ERROR_CODES` |
| GitHub 仓库 | `wh1teAlter/socketfuse` |
| 内部可见标识 | `socketfuse-…`、`socketfuse-release-…` |

## 保持不变的契约

- `createWebSocket`、`WebSocketClient`、配置、协议、连接状态机及 SharedWorker-first 行为保持不变。
- 错误码字符串、控制协议版本与跨 Worker 消息语义保持不变；仅公开错误类、判定函数和常量的标识符更名。
- 唯一可发布包仍只有 `socketfuse`；私有 workspace 不发布，也不会成为运行时依赖。
- 发布线继续使用 `0.0.x-beta.n` 和 npm `beta` dist-tag；npm Trusted Publishing 继续使用 GitHub Actions OIDC。

## 迁移边界与不变量

此仓库及 npm 包均未正式发布，因此允许破坏性变更。不得为了兼容旧名称新增别名、重导出、双目录、双包或双发布链路。

模块依赖方向继续为 `shared` → `config/protocol/connection` → `transport/worker/page` → `socketfuse` public facade。私有实现只能由公开包在构建时打包；文档、测试和发布验收只能导入 `socketfuse` 公开入口。

生成的 inline Worker 与 TypeDoc 输出不手工编辑：前者由构建脚本重新生成，后者保持为构建时生成、Git 不跟踪的文档输入。

## 外部系统迁移

GitHub 仓库重命名、npm 包首发、npm Trusted Publisher 配置属于外部状态，不能由仓库代码替代。代码迁移合并并通过本地验收后，维护者应：

1. 将 GitHub 仓库重命名为 `socketfuse`，并更新本地 `origin`；确认 GitHub App、`npm` Environment 和 required check 仍对新仓库有效。
2. 使用一次性 granular npm token 首发 `socketfuse@0.0.1-beta.1`，显式禁用仅在 GitHub Actions 中可用的 provenance，并固定 beta tag：

   ```sh
   npm publish ./packages/socketfuse --access public --tag beta --provenance=false
   ```

3. 立即撤销该 token；在 npm 的 `socketfuse` 包设置中配置 GitHub Trusted Publisher：owner `wh1teAlter`、repository `socketfuse`、workflow `.github/workflows/release.yml`、environment `npm`。

后续发布只能由受保护的 GitHub `npm` Environment 通过 OIDC 完成，不能恢复本地或长期 token 发布。
