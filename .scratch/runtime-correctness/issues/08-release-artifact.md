# 08 — 从无 dist 验收并发布同一产物

**What to build:** 从无 dist 验收并发布同一产物，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 01。

**Status:** completed

- [x] release:verify 独立 pack/prepack，publint 对实际解包产物运行；不存在先验未构建 dist。
- [x] 受保护 job 只发布已验收 tarball，校验新目录、唯一文件、包名、版本与摘要。
- [x] 保留 App/OIDC/版本 PR 门禁；无本地发布或长期 token；无 dist 隔离验收通过。

