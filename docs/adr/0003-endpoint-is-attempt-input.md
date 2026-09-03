---
status: accepted
---

# Endpoint 是连接尝试输入

完整 endpoint 属于一次连接尝试，不属于共享配置身份；相同 `id` 与相同共享配置表示调用方明确要求复用现有连接，后来页面传入的 URL 不覆盖存活连接，下一次 URL 只能由 Worker 当前重连计划选中的页面提交。继续比较完整初始 URL 会让 fresh token、游标等 query 天然冲突，而按 origin/path 猜测身份又会阻止合法的 host/path 轮换，因此共享意图只由调用方显式选择的 `id` 表达。

## Consequences

- URL query、path 或 host 的差异都不触发共享配置冲突；`id` 复用错误由应用命名负责。
- 当同一 `id` 已有连接条目时，新页面的初始化 URL 不替换当前 endpoint；条目释放后创建的新连接使用新创建者传入的 URL。
- endpoint 仍不得进入 fingerprint、logger、控制响应或 diagnostics；diagnostics 只保留当前 origin。
