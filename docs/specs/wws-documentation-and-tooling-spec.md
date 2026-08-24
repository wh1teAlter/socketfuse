# WWS 文档站与工具链收敛规格

- 状态：已确认并实现，code-review 通过
- 版本：v1.1 draft 1
- 日期：2026-08-20
- 适用范围：WWS v1 实现完成后的文档、工程与发布验证增量
- 关联：[WWS v1 技术与产品规格](./wws-v1-spec.md)

本文是对 v1 规格第 4 节、T001、T014、T015、T016 的增量修订。若与原规格冲突，以本文为准；WebSocket 运行时行为、公开 API 和既有 v1 非目标不在本次变更范围内。

## 1. 目标与非目标

### 1.1 目标

- 将 Playground 收敛为 VitePress 文档站的 `/playground` 页面，不保留独立应用包。
- 将文档站扩展为标准库文档的信息架构：导航、分区侧边栏、页面目录、本地搜索、指南、协议、API 与参考页。
- 用 TypeDoc 生成公开 API 参考，避免手写类型与源码漂移。
- 移除 `@antfu/eslint-config` 与 `@arethetypeswrong/core` 的直接依赖。
- 将依赖声明下沉到实际拥有者；pnpm catalog 只保留至少被两个 workspace 直接使用的版本。
- 保留真实 tarball 消费验证，替代 ATTW 的 package-entry 类型检查职责。

### 1.2 非目标

- 不修改 `wws` 的公开运行时 API、WebSocket/SharedWorker 语义或浏览器兼容基线。
- 不增加 Vue/React 等框架绑定；Vue 仅用于 VitePress 文档的交互 Playground。
- 不发布文档、npm 包、tag 或 GitHub Release。
- 不引入 API Extractor、`tsd`、Turborepo、UnoCSS 或额外的 UI 组件库。
- 不将 `ws` 引入生产包或浏览器运行时代码。

## 2. 包拓扑与归属

迁移后 workspace 必须只有以下私有包：

```text
packages/
├── core/  # 私有共享运行时和单元测试
├── wws/   # 唯一公开 npm 包
├── docs/  # VitePress 文档站、TypeDoc 和 /playground
└── test/  # Playwright、测试 WebSocket server、tarball consumer 验证
```

`packages/playground` 必须删除。其浏览器交互代码迁移到 `packages/docs/.vitepress/theme/components/` 或同等的 docs 私有目录；不得再拥有单独的 `package.json`、Vite 配置、构建或开发服务器。

本次变更后，`packages/docs` 是唯一的交互演示宿主，且通过 workspace 依赖引用公开包 `wws`。Playground 示例只能 import `wws`、`wws/protocol` 或 `wws/worker` 公共入口，禁止 import `@wws/core` 或测试专用模块。

## 3. 依赖治理

### 3.1 基本规则

- 每个第三方依赖必须出现在实际执行、编译或运行它的 workspace `package.json` 中。
- 根 `package.json` 只保留根脚本、根 ESLint 配置和 Changesets 实际需要的开发依赖；不得作为各 package 构建、文档、测试工具的依赖仓库。
- 生产依赖与开发依赖必须区分。私有 docs/test 的浏览器构建运行依赖可以声明在相应私有 package 中；公开 `wws` 必须维持零第三方 runtime dependency。
- workspace 内部引用必须使用 `workspace:*`。
- 只有至少两个 workspace **直接声明** 的版本才可放进默认 `catalog`。被传递依赖使用不计入此规则。
- catalog 使用标准 `catalog:` 引用，不再维护仅为开发工具准备的 `catalog:dev`。
- 所有直接依赖版本在迁移后必须只有一个来源：要么 package 内显式版本，要么 catalog；不得同时存在。

### 3.2 允许的 catalog

迁移后默认 catalog 仅应包含下列直接复用的工具：

```yaml
catalog:
  typescript: ^6.0.3
  tsdown: ^0.22.14
```

其中 TypeScript 采用标准 `typescript` 包，移除 `@typescript/native` 及 `npm:@typescript/typescript6` alias。若安装解析结果需要一个补丁版本差异，允许在实施时更新上述版本，但不得改变“标准 TypeScript + 仅重复依赖入 catalog”的原则。

### 3.3 依赖所有权

| 依赖类别 | 归属 | 规则 |
| --- | --- | --- |
| `eslint`、Flat Config 所直接 import 的插件、Changesets | 根目录 | 根 lint / changeset 脚本和根配置的真实所有者 |
| `typescript` | 根目录、core、wws、docs、test | 通过 catalog 直接声明；根 ESLint 的 TypeScript parser 也是实际使用方 |
| `tsdown` | core、wws | 通过 catalog；只用于库构建 |
| `vitest` | core | 包内显式声明；根脚本只委托执行，不再将单点依赖放入 catalog |
| `rolldown`、`publint` | wws | inline Worker 生成和公开包 metadata 验证的唯一所有者 |
| `vitepress`、`vue`、`vue-tsc`、`typedoc`、`typedoc-plugin-markdown` | docs | 文档、Vue Playground、类型参考的唯一所有者 |
| `@playwright/test`、`ws`、`@types/ws`、`@types/node` | test | 浏览器 E2E、Node 测试服务、临时 tarball consumer 的唯一所有者 |

`vite` 不得作为根或独立 Playground 的直接依赖保留；VitePress 或测试工具的传递依赖不构成直接依赖声明理由。

### 3.4 ESLint

根 ESLint 必须改为显式 Flat Config，结构参考 `fe-tripo-tools`，但仅引入 WWS 实际使用的能力：

- `@eslint/js`、`typescript-eslint`、`@stylistic/eslint-plugin`；
- `eslint-plugin-import-lite`、`eslint-plugin-perfectionist`、`eslint-plugin-unused-imports`；
- `eslint-plugin-jsonc`；
- `eslint-plugin-vue` 与其 required peer `vue-eslint-parser`，仅覆盖 docs Playground 的 `.vue` 文件；parser 由 Flat Config 显式提供并用于 Vue SFC 解析；
- `globals`，按 browser/worker/node 配置不同路径的运行时全局变量。

必须移除 `@antfu/eslint-config` 和 `eslint-plugin-format`。忽略范围必须覆盖构建输出、VitePress cache、Playwright 输出及构建生成的 inline Worker source。

本次不进行无功能的全库格式迁移：代码格式维持当前两空格、单引号、无分号、尾逗号的风格。`lint` 必须为只读检查；`lint:fix` 才允许修复格式或排序。

## 4. 发布验证与类型文档

### 4.1 TypeDoc

`packages/docs` 必须使用 `typedoc` 与 `typedoc-plugin-markdown` 从以下公开入口生成 API 参考：

```text
wws
wws/protocol
wws/worker
```

生成内容必须位于 docs 私有的 generated 目录，并由 docs 的 `predev` 与 `prebuild` 生命周期自动刷新；生成物不得作为手工维护的文档源。VitePress sidebar 必须能导航到每个入口对应的 API 文档。

TypeDoc 的职责是解释公开类型、泛型、函数、选项、事件和错误契约。它不验证 npm `exports` 在消费者 TypeScript 配置下是否可解析。

### 4.2 替代 ATTW 的发布门禁

必须移除 `@arethetypeswrong/core` 的直接依赖和 tsdown 的 `attw` 配置。保留 `publint`，由 `wws` package 的构建或发布验证使用，以检查发布文件和 package metadata。

`release:verify` 必须：

1. 构建并 `pnpm pack` 真实 `wws` tarball；
2. 确认 tarball 不含私有 workspace runtime、源码绝对路径和无关构建产物；
3. 在临时独立 consumer 安装该 tarball；
4. 使用 test workspace 所拥有的标准 TypeScript，以 `module` / `moduleResolution: NodeNext` 运行 `tsc --noEmit`；
5. 在同一个 consumer 编译 `import 'wws'`、`import 'wws/protocol'`、`import 'wws/worker'` 的类型使用样例；
6. 在 Node ESM 环境 import `wws`，确认 SSR-safe module evaluation 不访问浏览器全局。

该组合的边界是明确的：TypeDoc 负责 API 可读性，真实 tgz consumer 负责本项目承诺的 ESM TypeScript 解析路径，publint 负责 package metadata。它不声称覆盖 ATTW 的全部历史 TypeScript/模块模式矩阵；WWS v1 本身只承诺 ESM-only 和 NodeNext 消费。

## 5. 文档站与 Playground

### 5.1 信息架构

文档站使用 VitePress 2 默认主题能力，不额外引入 UI 框架。必须配置：

- 顶部导航：Guide、API、Protocols、Reference、Playground；
- 分区侧边栏，当前项清晰高亮；
- 右侧页面目录，至少展示二、三级标题；
- 本地搜索；
- 首页 footer 与 MIT 许可证信息。

文档默认使用英文；本仓库的规划/规格继续使用中文。v1.1 不实现中英双语或 i18n 路由。

最小页面集合如下：

```text
index.md
guide/
  index.md
  getting-started.md
  connection-sharing.md
  reliability.md
  lifecycle-and-replay.md
  fallback-and-worker.md
protocols/
  index.md
  raw.md
  json.md
  custom-adapter.md
api/
  index.md
  generated/                 # TypeDoc 生成
reference/
  configuration.md
  events-and-client.md
  diagnostics-and-errors.md
  compatibility-and-security.md
playground.md
```

手写文档必须覆盖：`id + shared config` 复用/冲突规则、状态/事件、队列与背压、重连、心跳、auth/URL revision、lifecycle restore/replay、direct/error fallback、inline/custom Worker、CSP/Cookie/SameSite/`Origin: null`、诊断脱敏、错误码、SSR 与兼容性，以及 v1 不提供 subscribe/request/Ack 的边界。

### 5.2 Playground

`/playground` 是文档子页而非独立应用，必须提供现有多 tab 调试能力：

- URL、connection `id`、fallback、模拟 Worker 初始化失败、replay 开关；
- Connect / Disconnect、send、打开新 tab；
- transport、status、Worker attached client count、消息数、错误显示；
- 真实消息通过 `onMessage` 展示，并显示 replay 标记。

交互组件必须在 `<ClientOnly>` 中渲染，模块加载与 VitePress SSG 不得创建 Worker 或 WebSocket。只有用户点击 Connect 后才可创建 client。文档构建不依赖测试 WebSocket server；运行时默认 URL 可以指向本地示例地址，但必须在页面上说明它需要用户自己的 WebSocket 服务。

## 6. 根脚本、CI 与测试迁移

- 根 `dev` 必须启动 docs 开发服务，Playground 位于 `/playground`。
- 根 `build` 必须按 `core → wws → docs` 顺序构建，不再构建独立 Playground。
- 根 `test` 与 `test:watch` 必须委托给实际拥有 Vitest 的 package；根目录不直接依赖或执行 Vitest。
- 根 `docs:check` 必须构建 docs，并因此触发 TypeDoc 生成。
- Playwright web server 改为 docs 服务；E2E URL 改为 `/playground`，继续覆盖 Chromium、Firefox、WebKit 的跨 tab 单物理连接和 direct/error fallback。
- Node `ws` server 继续存在于 `packages/test/server`，只做 E2E echo 与连接统计，绝不进入 docs 或公开包构建输入。
- CI 仍以 `pnpm install --frozen-lockfile` 开始，并运行 `pnpm check` 与 `pnpm test:e2e`。

## 7. 验收条件

- `packages/playground` 不存在，`/playground` 在 docs dev 与 docs build 中均可访问。
- 文档具备导航、侧边栏、页面目录和本地搜索；所有最小页面存在且链接无死链。
- Playground 仅使用 `wws` 公共 API，SSR 构建期间不访问浏览器全局。
- `@antfu/eslint-config`、`@arethetypeswrong/core`、`@typescript/native`、`eslint-plugin-format` 不再是任何 workspace 的直接依赖。
- `ws` 和 `@types/ws` 仅由 `@wws/test` 直接声明。
- 根目录不再直接声明局部构建、文档、浏览器测试或 WebSocket server 依赖；catalog 仅含被至少两个 workspace 直接使用的依赖。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check`、`pnpm release:verify`、`pnpm check` 与 `pnpm test:e2e` 全部通过。
- `release:verify` 的真实 tarball consumer 对三个公开入口通过 NodeNext 类型检查和 Node ESM import。

## 8. 迁移风险与处理

| 风险 | 处理 |
| --- | --- |
| VitePress SSR 访问浏览器 API | Playground 组件仅在 ClientOnly 内实例化 client；示例模块不产生副作用 |
| TypeDoc 暴露内部类型或生成不稳定路径 | 入口限定为 `wws` 三个公共入口；generated 目录自动覆盖 |
| 删除 ATTW 降低类型入口覆盖面 | 以真实 tgz + NodeNext `tsc` 覆盖 v1 承诺的 ESM 解析模式，并保留 publint |
| 独立 Playground 删除后 E2E 失效 | 先迁移 URL/服务再删除 package；三浏览器测试作为删除验收门禁 |
| Flat Config 造成无关格式改动 | 保持既有代码风格，lint/check 与 lint:fix 分离 |
| 依赖下沉导致 root 脚本找不到二进制 | 根脚本只调用 workspace scripts 或 `pnpm --filter ... exec`，不依赖 hoisting |
