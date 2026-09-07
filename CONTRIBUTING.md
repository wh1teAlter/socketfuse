# 参与贡献

欢迎通过问题复现、文档改进、测试和代码贡献帮助完善 SocketFuse。项目文档以中文维护；英文项目介绍见 [README.md](README.md)，中文介绍见 [README.zh-CN.md](README.zh-CN.md)。

- [报告问题与提出建议](#报告问题与提出建议)
- [搭建开发环境](#搭建开发环境)
- [仓库结构](#仓库结构)
- [开发与验证](#开发与验证)
- [文档维护](#文档维护)
- [Changeset 与版本](#changeset-与版本)
- [提交 Pull Request](#提交-pull-request)

## 报告问题与提出建议

先搜索[已有 issue](https://github.com/wh1teAlter/socketfuse/issues)，确认是否已有复现或讨论。提交问题时请包含：

- 使用的 SocketFuse 版本、浏览器及版本、构建工具。
- 最小复现仓库或可独立运行的示例，以及预期行为与实际行为。
- 标签页数量、`transport`、Worker 部署方式及相关共享配置。
- 若涉及恢复、背压或回放，给出连接、隐藏、冻结、断开与重开的准确顺序。

请使用测试凭据和脱敏数据，不要把 token、带认证信息的 URL 或生产 payload 放入公开 issue。

小范围修复和文档改进可直接提交 PR。新增公开 API、调整模块职责或改变运行时语义时，请先通过 issue 说明场景、方案和需要保持的不变量。重构应解释现有复用能力为何不足，并与对应修复或功能关联。范围与依赖约定见 [AGENTS.md](AGENTS.md)，术语见 [CONTEXT.md](CONTEXT.md)。

## 搭建开发环境

需要 Git、Node.js `^22.18.0 || >=24.11.0` 和 pnpm `10.34.5`；版本要求以根 [package.json](package.json) 为准。使用 pnpm workspace 安装依赖。

Fork 仓库并克隆自己的副本，然后在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @socketfuse/test exec playwright install chromium firefox webkit
```

首次构建会生成公开包、内联 Worker 和 API 文档。Linux 上若缺少浏览器系统依赖，可使用 Playwright 的 `install --with-deps`。

在两个终端分别启动文档站和本地 WebSocket 服务：

```sh
# 终端一：http://127.0.0.1:4173
pnpm dev
```

```sh
# 终端二：ws://127.0.0.1:8787/socket
pnpm playground:server
```

访问 `http://127.0.0.1:4173/playground`，在两个同源标签页使用相同连接配置观察共享行为。修改 core 或公开包后，需要重新构建它们再验证演练场；文档开发服务器不会代替库构建。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| [packages/socketfuse](packages/socketfuse/README.md) | 唯一公开 npm 包、三个入口和内联 Worker 产物 |
| [packages/core](packages/core/README.md) | 私有连接引擎、runtime、transport 和页面 client |
| [packages/docs](packages/docs/README.md) | 中文 VitePress 文档、生成 API 和内嵌演练场 |
| [packages/test](packages/test/README.md) | 三浏览器 E2E、本地 ws 服务和发布包验收 |
| [.changeset](.changeset/README.md) | 待消费变更说明及 beta 已消费条目 |
| [.github/workflows](.github/workflows/README.md) | PR 验证、版本 PR 和受保护发布流程 |

应用示例只依赖 `socketfuse`、`socketfuse/protocol`、`socketfuse/worker`。不要把局部开发依赖提升到根；`ws` 及其类型仅放在 `packages/test`。

## 开发与验证

源码使用 TypeScript，测试使用 Vitest 与 Playwright，格式与静态检查使用 ESLint。中文文件头、TSDoc、所有权说明和模块 README 要求以 [AGENTS.md](AGENTS.md) 为准。

| 命令 | 用途 |
| --- | --- |
| `pnpm lint` | 只读 ESLint 检查 |
| `pnpm lint:fix` | 显式自动修复格式与可修复规则 |
| `pnpm typecheck` | 全 workspace 类型检查 |
| `pnpm test` / `pnpm test:watch` | 单元测试 / 监听模式 |
| `pnpm build` | 构建 core、公开包与文档站 |
| `pnpm docs:check` | 生成 API 并构建文档，检查站内链接 |
| `pnpm release:verify` | 独立打包后验收实际 tarball |
| `pnpm test:e2e` | Chromium、Firefox、WebKit 浏览器验证 |

开发中可运行相关用例，例如：

```sh
pnpm --filter @socketfuse/core test src/connection/reconnect.test.ts
```

修复运行时缺陷时，优先加入能复现原问题的回归测试；验证公开行为、状态和资源释放。shared/direct 共用的行为应覆盖两种接入，浏览器生命周期行为还应通过 E2E 验证。

涉及公开包、运行时、文档或目录的变更，提交前按以下顺序**串行**执行：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
pnpm release:verify
pnpm test:e2e
git diff --check
```

`pnpm check` 包含前六项，之后仍需执行 E2E 和 diff 检查。不要同时运行多个构建或验收命令，它们会操作相同的 `dist`。E2E 会启动或复用 4173/8787 服务，运行前确认这些端口上的服务属于当前工作树。

`pnpm install` 会安装 Husky hook。提交时执行全仓 typecheck，并由 lint-staged 对暂存源码和 JSON 执行 ESLint 修复；hook 不运行完整测试，也不验证提交消息格式。详见 [.husky/README.md](.husky/README.md)。

## 文档维护

- 根 `README.md` 为默认英文入口，`README.zh-CN.md` 为中文版本。涉及功能、示例和边界时先校准中文，再同步英文。
- 产品指南、模块 README、CONTRIBUTING 和源码注释以中文为准。公开 npm 包的英文 README 链接到仓库中文说明。
- README 介绍价值、安装和最小示例；详细配置进入文档站，贡献步骤放在本文，发布账户配置放在 workflow README。
- 示例使用当前公开 API。涉及旧版兼容时说明版本边界，不把 main 的新契约描述为所有已发布版本的行为。
- TypeDoc 的 `site/api/generated/` 由构建生成；修改源码 TSDoc，不手工编辑生成 Markdown。
- 移动或删除文档时同步检查所有引用，保持语言切换与相对路径有效。

## Changeset 与版本

修改公开行为、API、兼容性、依赖或发布内容时，为唯一公开包 `socketfuse` 添加 Changeset：

```sh
pnpm changeset
pnpm changeset:status
```

说明应使用中文，描述用户能观察到的变化；破坏性调整应包含迁移信息。仅文档、测试、CI 和仓库维护变更通常不需要 Changeset。不要在业务 PR 中顺带 bump 版本或修改 CHANGELOG。

当前使用 Changesets 3 的 beta 模式。版本生成后，已消费说明会移到 `.changeset/pre/`；它们用于退出 beta 时生成正式版记录，需要保留并提交。具体文件职责见 [.changeset/README.md](.changeset/README.md)。

版本管理由维护者负责。常规自动流程创建 Version Packages PR，并在合并后发布已验收 tarball；beta 阶段维护者明确授权的手动版本准备与发布属于单独的发布操作，不改变普通 PR 规则，也不绕过现有 CI 的版本 PR 身份校验。流程与当前限制见 [workflow 文档](.github/workflows/README.md)。

## 提交 Pull Request

以 `main` 为目标分支。PR 标题应简洁描述变化，可采用 `fix:`、`feat:`、`docs:`、`refactor:` 等前缀；这是推荐格式，仓库没有 commitlint。

PR 描述请写清具体问题、修改后的行为、验证结果和兼容性影响；有对应 issue 时关联它。尚未完成的工作可以先开 draft PR，准备验收时再转为 ready。

提交前检查：

- [ ] 变更聚焦同一目的，未覆盖无关工作树改动。
- [ ] 缺陷修复或新增行为具有适当的回归证据。
- [ ] 公开 API、模块 README 与相关中英文说明已同步。
- [ ] 需要发布说明时已添加 Changeset，版本与 CHANGELOG 未混入业务改动。
- [ ] 串行检查已完成，PR 如实记录未通过或未运行的项目。
- [ ] 生成的内联 Worker 与源码一致，未提交 dist、API 生成目录或测试报告。

当前非 draft PR 的检查 job 为 `verify`。普通 PR 执行完整质量检查和 E2E；符合 App 身份的版本 PR 执行静态与发布包验收。分支保护应要求该检查通过。贡献代码按项目 [MIT 许可证](packages/socketfuse/LICENSE) 发布。
