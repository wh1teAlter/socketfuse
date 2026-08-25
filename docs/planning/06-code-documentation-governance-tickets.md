# WWS 代码与模块文档治理 Tickets

- 状态：Approved for implementation
- 日期：2026-08-25
- 规格：[代码与模块文档治理规格](../specs/wws-code-documentation-governance-spec.md)

## T001 — 建立持久协作规则

- 创建根 `AGENTS.md` 与 `CLAUDE.md`，将中文 TSDoc、README 同步、最小范围、依赖方向与验证要求写成可执行规则。
- 不增加 lint 依赖或自动注释工具；语义正确性由代码审查和现有类型/测试门禁共同保证。
- 完成条件：两个入口都存在，Claude 入口明确指向唯一权威的 `AGENTS.md`。

## T002 — 注释 core 领域与公开契约

- 为 `shared`、`config`、`protocol`、`connection`、`transport`、`page`、`worker` 的手写源码补充中文文件头、声明 TSDoc、字段/状态说明和关键不变量。
- 重点说明控制协议校验、共享连接身份、revision、队列/背压、Worker→页面 credit、生命周期恢复和错误脱敏。
- 完成条件：不改变运行时流程；公开 TypeDoc 输入覆盖参数、返回值、失败和调用阶段。

## T003 — 注释包边界、脚本、测试和文档站源码

- 为公开 facade、inline Worker generator、构建配置、测试服务器、release verifier、Playwright helpers、VitePress 配置和 Playground Vue/composable 文件补充中文说明。
- 生成器只记录 artifact 边界；测试说明断言保护的行为；Vue 保持 props-down/events-up 与现有组件拆分，不添加状态层。
- 完成条件：所有手写文件有文件头，脚本里的路径/凭据/临时目录/清理不变量清楚。

## T004 — 同步模块 README 与根文档

- 为规格列出的模块增加或更新 README，统一描述职责、依赖、使用与边界。
- 更新根 README 指向协作和模块入口，不复制内部流程。
- 完成条件：README 与实际目录、公开入口和依赖方向一致。

## T005 — 生成、验证与复审

- 通过现有 build/docs 命令生成 inline Worker 和 API Markdown。
- 执行完整门禁与 Chromium、Firefox、WebKit E2E。
- 复审注释准确性、README 边界、公开 API TSDoc、生成器所有权和未授权范围扩大；修复确认的问题。
