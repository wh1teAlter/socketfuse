# SocketFuse 协作与实现约定

## 目标与边界

SocketFuse 是浏览器端、SharedWorker-first 的同源多标签页 WebSocket 共享库。公开包名为 `socketfuse`，公开入口固定为 `socketfuse`、`socketfuse/protocol` 与 `socketfuse/worker`。Worker 只负责控制协议、连接所有权与事件派发，绝不等待页面业务处理器。

除非任务明确授权，不新增框架绑定、RPC/request、topic、服务端 Ack、独立 playground 包、运行时依赖或抽象层。不能用“将来可能复用”作为新增类型、类、配置或目录的理由。

## 工作方式

1. 先阅读与改动范围相邻的 `README.md`、规格和 tickets；以公开 API、运行时语义、依赖或模块职责为边界安排工作。
2. 需要新抽象、结构调整或刻意简化时，先在变更说明或对应 README 写清：现有复用能力为何不足、选择的意图、以及必须保持的不变量。未获批准不得扩大范围。
3. 新建模块，或改变模块职责、公开 API、依赖或使用方式时，同步创建或更新该模块的 `README.md`。README 只描述职责、公开 API、依赖、使用方式和边界，不复制内部实现。
4. 保持依赖方向：`shared` → `config/protocol/connection` → `runtime` → `transport/worker` → `page` → `socketfuse` public facade。`connection` 不得依赖 `runtime`、`page` 或 `worker`；原生 socket 能力面属于 connection。runtime 拥有连接池与参与期，两种 transport 共用它；docs 只依赖公开 `socketfuse` 入口；`ws` 及其类型只留在 `packages/test`。
5. 保护现有工作树。不得重置、覆盖或删除无关改动；不得修改 `docs/review/1.md` 与 `docs/review/2.md`。
6. 面向用户的 `socketfuse` 改动必须提交 Changeset；不得在业务 PR 中直接改版本或 CHANGELOG。只有 release workflow
   创建的 Version Packages PR 可以消费 Changeset，只有该 PR 合并后的版本提交可以发布。
7. 唯一可发布 workspace 是 `socketfuse`。不得本地发布、递归发布或在 workflow 中使用长期 npm token；Trusted
   Publishing 必须由 `.github/workflows/release.yml`、受保护的 `npm` environment 与 OIDC 完成。
8. Version Packages PR 必须使用最小权限 GitHub App token 创建，以触发专用发布包验收；不得退回内置
   `GITHUB_TOKEN`，否则 GitHub 不会触发新的 pull request workflow。发布前必须同时校验该 App 身份、标题、
   专用分支与文件白名单，手工版本提交必须拒绝。

第 6–8 条描述常规自动发布流程。beta 阶段仅在维护者明确授权时，允许单独手动消费 Changeset、生成版本与 CHANGELOG，并进行单包发布；该授权不改变现有 workflow 的 Version Packages PR 身份校验，也不允许递归发布或增加长期 npm token。具体操作与限制见 [workflow README](.github/workflows/README.md)。

## 中文文档与注释

- 根 `README.md` 是默认英文入口，`README.zh-CN.md` 为中文维护基准，两者内容与示例同步；CONTRIBUTING、产品指南、模块文档和源码注释以中文为准。公开 npm README 使用英文并链接仓库中文说明。
- 每个源码文件在 import 前放中文文件头，说明内容、责任和设计意图；它描述当前状态，不写迁移历史或规范章节编号。Vue SFC 在 `<script setup>` 内、import 前放同等说明。
- 每个命名函数、方法、类、接口、类型别名和枚举前写中文 TSDoc。公开 API 必须说明参数、返回值、失败方式与允许调用的阶段。
- 模块常量、模块状态、类字段，以及单位、约束、所有权或生命周期不明显的类型字段，必须在声明前说明用途。具有独立业务语义的局部变量前写中文单行注释；循环变量、catch 变量、简单索引、明确测试的 `actual`/`expected` 与纯语法解构可以省略。
- 对事务提交/回滚、路径包含、凭据脱敏、artifact 冲突、模块生命周期、平台降级、并发和非显然算法，注释解释“为什么”及必须保持的不变量。生成器边界只注释关键协议，不复述生成代码。
- 注释不能替代命名、类型或测试；不得保留与当前代码不一致的说明。

## 运行时不变量

- 相同 `id` 与共享配置在同一 SharedWorker 中最多拥有一个物理 WebSocket；冲突必须显式失败，不能静默采用先到或后到配置。
- `id` 不是授权边界，token、查询凭据、payload 与内部异常文本不得跨 Worker 边界、进入诊断或日志。
- `sendMessage()` 成功仅代表本地 accepted/queued，不代表服务端收到；背压、队列、端口投递和生命周期回放始终有边界。
- SharedWorker 不可用时只允许在明确的构造/初始化失败上降级到 direct；选定 shared transport 后的网络或恢复失败不得悄悄切换为 direct。
- 公开入口在 SSR/Node import 时安全；实际创建页面 client 必须在浏览器页面 realm 中完成。

## 验证

改动后按风险运行相关检查；涉及公开包、运行时、docs 或目录时，最终运行：

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

使用 pnpm workspace 命令，不把局部依赖提升到根目录；catalog 只用于多个 workspace 重复使用的依赖。
本地 `lint` 必须只读；自动修复只允许通过 `lint:fix` 或 lint-staged。
