# WWS 代码与模块文档治理规格

- 状态：Approved for implementation
- 日期：2026-08-25
- 范围：协作指南、源码中文 TSDoc、模块 README 与文档生成输入

## 1. 目标

让维护者无需追溯实现历史，即可从文件头、声明注释和相邻 README 理解 WWS 的职责边界、调用阶段、失败语义、资源所有权与不可破坏的不变量。文档必须服务当前代码，不得制造新的运行时抽象、依赖或行为。

## 2. 协作入口

仓库根目录必须同时存在：

- `AGENTS.md`：所有编码代理共用的权威协作规则、架构边界、中文注释要求和验证命令。
- `CLAUDE.md`：Claude 的短入口，显式要求遵守 `AGENTS.md`，不得复制并漂移同一套规则。

两者都必须覆盖：最小范围原则、README 同步条件、依赖方向、凭据与错误脱敏、SharedWorker 降级边界、禁止等待业务 handler，以及保护现有工作树。

## 3. 源码注释

### 3.1 通用规则

- 所有手写 TS、MJS 与 Vue `<script setup>` 源文件都必须在 import 前有中文文件头，说明该文件负责什么及为何由该边界拥有。
- 每个命名函数、方法、类、接口、类型别名和枚举都必须有中文 TSDoc。
- 模块常量、模块状态、类字段以及约束、单位、所有权或生命周期不明显的类型字段必须在声明前说明。
- 有独立业务语义的局部变量必须有中文单行说明；循环变量、catch 变量、简单索引、明确的测试 `actual`/`expected` 与纯语法解构可省略。
- 注释只写当前状态，不包含迁移历史、任务编号或过期实现细节。

### 3.2 公开契约

公开 API 的 TSDoc 必须说明：参数含义、返回值、失败方式和允许调用的阶段。尤其覆盖：

- `createWebSocket` 的页面 realm 前置条件、同步构造失败与 `immediate` 行为；
- `WebSocketClient` 的 `open`、`close`、`sendMessage`、revision 更新、`reconnect`、`diagnostics`、`dispose`；
- protocol adapter 的 Worker 注册前提和异步编解码失败；
- custom Worker runtime 的端口所有权、控制协议和 dispose 生命周期。

### 3.3 风险边界

事务提交/回滚、路径包含、凭据脱敏、artifact 冲突、模块生命周期、平台降级、并发及非显然算法的说明必须解释选择原因及不变量。inline Worker 生成器只注释源入口、IIFE artifact 和输出路径之间的协议；生成文件由生成器写入，不能手改。

## 4. README 边界

当模块新增或职责、依赖、公开 API、使用方式发生变化时，必须在该模块创建或同步 README。此次至少覆盖：

- `packages/core` 及其 `connection`、`config`、`protocol`、`page`、`transport`、`worker`、`shared` 子模块；
- `packages/wws`；
- `packages/docs` 和其 playground 模块；
- `packages/test`。

每份 README 必须简洁描述职责、公开 API（内部模块明确无公开 API）、依赖方向、使用方式与不变量。它不得逐行复述实现或替代生成 API 文档。

## 5. 非目标

- 不改变 `wws` 的公共导入路径、API、协议、默认值或运行时行为。
- 不新增 lint 依赖、运行时依赖、代码生成器、架构检查框架、独立文档包或新的业务抽象。
- 不手改 TypeDoc 输出；以源码 TSDoc 为唯一输入并通过既有命令重新生成。
- 不翻译或重写现有产品文档的内容，除非为 README/注释边界准确性所必需。

## 6. 验收

1. `AGENTS.md` 与 `CLAUDE.md` 存在并互不矛盾。
2. 全部手写源码拥有中文文件头；命名声明和需要解释的状态/字段符合第 3 节。
3. 模块 README 覆盖第 4 节范围且与当前依赖方向一致。
4. inline Worker 与 TypeDoc 均由既有生成链路产出，生成输出反映公开 TSDoc。
5. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check`、`pnpm release:verify`、`pnpm test:e2e` 与 `git diff --check` 通过。
6. code review 不得发现未解释的公共调用阶段、资源所有权、平台降级、控制协议或文档与当前行为不一致。
