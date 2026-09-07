# 01 — 统一输入与安全错误

**What to build:** 统一输入与安全错误，使相应公开行为与已批准运行时规格一致。

**Blocked by:** None — can start immediately。

**Status:** completed

- [x] 页面与 runtime 共用毫秒、endpoint、共享配置约束；无 fragment/userinfo。
- [x] clone/retained 计费覆盖 backing buffer、循环图及双端校验；queue 保存紧凑自有数据。
- [x] 错误无任意 details/cause，外部 throw 按阶段重映射；logger 与回调失败不影响其他消费者。

