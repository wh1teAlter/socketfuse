# WWS 文档站与工具链收敛票据

- 阶段：code-review
- 来源：[WWS 文档站与工具链收敛规格](../specs/wws-documentation-and-tooling-spec.md)
- 关联基线：[WWS v1 实现票据](./02-wws-v1-tickets.md)
- 状态：D001–D007 已完成，code-review 通过

本文仅拆分已确认的增量规格，不改动 WWS v1 的公开运行时 API 或 SharedWorker/WebSocket 语义。所有票据完成前不得发布、创建 tag 或 GitHub Release。

## 1. 交付顺序

```text
D001 依赖归属与 pnpm catalog 收敛
  └─ D002 显式 ESLint Flat Config
       ├─ D003 TypeDoc 与 NodeNext tarball 类型门禁
       └─ D004 VitePress 信息架构与主题配置
            └─ D005 文档内嵌 Playground
                 └─ D006 E2E / CI / 根脚本迁移
                      └─ D007 删除独立 Playground 与收尾审计
```

D003 与 D004 在 D001/D002 完成后可并行。D005 依赖 D004；D006 依赖 D003/D005；D007 只能在所有验证通过后执行，避免删掉仍被 E2E 或根脚本引用的 package。

## 2. 票据

### D001 依赖归属、标准 TypeScript 与 catalog 收敛

- 目标：让每一项直接依赖归属到实际拥有它的 workspace，并使 catalog 只维护多 workspace 直接复用的版本。
- 依赖：无。
- 涉及文件：根/各 package 的 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- 实现范围：
  - 移除根目录中只被单一 package 使用的 Vite、VitePress、Playwright、`ws`、`@types/ws`、rolldown、publint、Vitest 等直接依赖。
  - 为 core、wws、docs、test 声明各自的 TypeScript；移除 `@typescript/native` 与 TypeScript alias，统一使用标准 `typescript`。
  - 将 TypeDoc/VitePress/Vue/vue-tsc 下沉 docs；将 Playwright/`ws`/Node 类型下沉 test；将 rolldown/publint 下沉 wws。
  - catalog 只保留 `typescript` 与 `tsdown`，且只能使用标准 `catalog:` 语法；单点的 Vitest 改为 core 包内显式版本。
  - 保持公开 `wws` 的零第三方 runtime dependency 与 `workspace:*` 内部依赖规则。
- 测试：`pnpm install --lockfile-only` 后 `pnpm install --frozen-lockfile`；`pnpm why` 检查直接依赖归属。
- 验收：规格 3.1–3.3；`ws` 与 `@types/ws` 只在 `@wws/test` 直接声明；根目录不再承载局部工具。
- 完成定义：lockfile 可复现、无 catalog:dev、无遗留的 TypeScript alias，且 package scripts 所需二进制都由所属 package 可解析。

### D002 显式 ESLint Flat Config

- 目标：用 WWS 自有 Flat Config 取代 `@antfu/eslint-config`，规则组织参考 `fe-tripo-tools`，但不引入未使用能力或无关格式迁移。
- 依赖：D001。
- 涉及文件：`eslint.config.mjs`、根 `package.json`、`pnpm-lock.yaml`。
- 实现范围：
  - 使用 `@eslint/js`、`typescript-eslint`、`@stylistic/eslint-plugin`、import-lite/perfectionist/unused-imports/jsonc/Vue/globals 插件，并由根 Flat Config 显式提供 `eslint-plugin-vue` 的 required peer `vue-eslint-parser`。
  - 针对 core/wws、docs Vue、test Node、Worker 源码配置恰当 globals。
  - 忽略 dist、VitePress cache、Playwright 输出、coverage 与构建生成的 inline Worker source。
  - 保持两空格、单引号、无分号、尾逗号；`lint` 仅检查，`lint:fix` 显式执行修复。
  - 移除 `@antfu/eslint-config` 与 `eslint-plugin-format` 的所有直接引用。
- 测试：`pnpm lint`；对 `eslint.config.mjs`、package JSON、TS、Vue SFC 执行 ESLint。
- 验收：规格 3.4；lint 不产生文件写入；`pnpm lint:fix` 可修复排序/格式但不需用作 CI。
- 完成定义：全仓 lint 通过，且 diff 不包含仅为适配分号风格的全库重写。

### D003 TypeDoc API 参考与 tarball consumer 类型门禁

- 目标：让 API 文档由公开入口生成，并以真实 tarball + NodeNext consumer 覆盖 ESM 类型入口解析。
- 依赖：D001、D002。
- 涉及文件：`packages/docs/package.json`、TypeDoc 配置/脚本、`packages/docs/api/generated/`、`packages/wws/tsdown.config.ts`、`scripts/verify-release.mjs`、`packages/test` 的 consumer fixture（若需要）。
- 实现范围：
  - docs 通过 `typedoc` 与 `typedoc-plugin-markdown` 生成 `wws`、`wws/protocol`、`wws/worker` 的 API Markdown。
  - docs `predev`、`prebuild` 自动刷新 generated 内容；API index 与 sidebar 可导航到三组入口。
  - 从 wws tsdown 配置中移除 `attw`，移除 ATTW 直接依赖；保留 publint 验证。
  - release verify 真实 pack tgz，检查发布列表，创建临时独立 consumer，安装 tgz，使用 NodeNext `tsc --noEmit` 编译三个入口的类型样例，并 Node ESM import `wws`。
- 测试：`pnpm docs:api`、`pnpm docs:check`、`pnpm release:verify`。
- 验收：规格 4；生成的 API 文档不要求手工编辑；tarball consumer 不依赖 workspace paths 或根 `node_modules`。
- 完成定义：ATTW 已完全移除，且发布门禁清楚区分 TypeDoc/API 可读性、publint/metadata 与 tgz NodeNext 类型消费。

### D004 VitePress 信息架构与手写文档

- 目标：把单页说明扩展为可导航、可搜索、具有组件库级信息架构的文档站。
- 依赖：D001、D002。
- 涉及文件：`packages/docs/.vitepress/config.ts`、theme 配置、首页及 guide/protocols/api/reference Markdown。
- 实现范围：
  - 配置顶部导航、按 section 的 sidebar、二三级 outline、本地搜索、MIT footer。
  - 建立规格 5.1 的所有最小页面，迁移现有内容并补全交叉链接。
  - 手写文档覆盖 sharing/config conflict、状态与事件、可靠性、queue/backpressure、心跳、revision、restore/replay、fallback、Worker 部署、CSP/Cookie/SameSite/Origin、诊断、错误、SSR、兼容性与 v1 非目标。
  - docs 保持英文；规划与规格保持中文。
- 测试：`pnpm docs:check`；构建输出路由存在性检查；链接检查（可由 VitePress build 和可解析链接实现）。
- 验收：规格 5.1；每个导航、sidebar 页面有可用标题与清晰上/下文链接。
- 完成定义：首页不再承担全部参考内容，读者能从导航或搜索抵达任何 API/配置主题。

### D005 文档内嵌 Playground

- 目标：将独立 Playground 的实际交互能力作为 `/playground` 的 VitePress 子页面交付。
- 依赖：D003、D004。
- 涉及文件：`packages/docs/.vitepress/theme/`、`packages/docs/playground.md`、docs 样式与类型配置、原 `packages/playground/src`（迁移源）。
- 实现范围：
  - 用 Vue 组件承载 URL/id/fallback/replay/模拟 Worker 失败、connect/disconnect、send、新 tab、metrics、消息与错误显示。
  - 通过 `<ClientOnly>` 确保 VitePress SSG 不实例化 Worker/WebSocket；只有用户 Connect 时创建 `createWebSocket` client。
  - 组件只 import `wws` 公共 API，支持现有 E2E 可访问的语义化控件、标签与稳定 DOM 标识。
  - 页面说明默认示例服务仅用于本地调试，生产使用需填写自己的 WebSocket URL。
- 测试：docs SSG build；浏览器手动 smoke；D006 的 Playwright。
- 验收：规格 5.2；`/playground` 可以在同源新 tab 内展示共享连接，并准确显示 direct/error fallback。
- 完成定义：文档构建在没有 WebSocket server 的环境中通过，且不会产生 SSR 浏览器全局访问错误。

### D006 根脚本、E2E、CI 与文档站服务迁移

- 目标：让根工作流和真实浏览器测试以 docs（含 `/playground`）为唯一交互宿主。
- 依赖：D003、D005。
- 涉及文件：根 `package.json`、`packages/test/playwright.config.ts`、`packages/test/e2e/`、`.github/workflows/ci.yml`、相关 README 链接。
- 实现范围：
  - 根 `dev` 改为 docs dev；根 build 使用 core → wws → docs；根 test/test:watch 委托给拥有 Vitest 的 package。
  - Playwright web server 改用 docs server，所有 E2E 访问 `/playground`；保留 Chrome/Firefox/WebKit 的共享连接与 direct/error fallback 覆盖。
  - `ws` server 保留在 test package，仅为 E2E echo/metrics 提供服务；并避免浏览器项目并发互相广播。
  - CI 持续运行 frozen install、check、test:e2e；README 链接指向 docs 新路径。
- 测试：`pnpm test:e2e`；`pnpm check`。
- 验收：规格 6；三浏览器在 docs Playground 上全绿，根脚本不依赖 root-hoisted 局部二进制。
- 完成定义：从新 clone 通过根命令能完整验证 docs、库和 E2E。

### D007 删除独立 Playground 与最终依赖审计

- 目标：安全移除不再被引用的独立 Playground package，并验证迁移没有遗留重复依赖或入口。
- 依赖：D006。
- 涉及文件：`packages/playground/`、workspace/package 配置、文档与测试引用、lockfile。
- 实现范围：
  - 经引用搜索确认后删除 `packages/playground`。
  - 移除其 workspace 脚本、Vite 配置、类型配置与专属构建产物。
  - 审计根和各 workspace 的 dependencies、catalog 与 lockfile，确认符合 D001 的归属规则。
- 测试：`rg` 无独立 Playground 路径/包名引用；`pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test:e2e`。
- 验收：规格 2、3、6、7；`packages/playground` 不存在，docs `/playground` 是唯一演示入口。
- 完成定义：所有构建、测试、发布验证全绿，tarball 仍只含公开包应有文件。

## 3. 验证矩阵

| 门禁 | 主要票据 | 目的 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | D001, D007 | lockfile 和依赖所有权可复现 |
| `pnpm lint` | D002 | 显式 Flat Config 全仓检查 |
| `pnpm typecheck` | D001, D005 | 标准 TypeScript 与 docs Vue 类型正确 |
| `pnpm test` | D001, D006 | core contract 保持不回归 |
| `pnpm docs:api` / `pnpm docs:check` | D003, D004, D005 | API 生成、信息架构、SSG 安全 |
| `pnpm release:verify` | D003 | publint、真实 tgz、NodeNext 三入口类型消费、SSR import |
| `pnpm test:e2e` | D005, D006 | 三浏览器 docs Playground、跨 tab 和 fallback |
| `pnpm check` | D006, D007 | 汇总 lint/type/unit/build/docs/release 门禁 |

## 4. 全局完成定义

- 仅在 D001–D007 全部完成并通过验证矩阵后，增量 implement 阶段才可标记完成。
- 所有示例与 Playground 必须使用公开 `wws` 入口；不因文档迁移扩大运行时 API。
- 任何对公开 API、SharedWorker 策略或发布格式的新改变，都必须回到 to-spec，不在本票据内隐式决定。
- code-review 必须在 implement 完成、用户确认实现结果后进行，并同时按本增量规格和现有 WWS v1 规格审查。
