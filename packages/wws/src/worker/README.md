# `wws/src/worker`

该目录提供 inline Worker 的启动入口和生成 artifact。`entry.ts` 只安装 `@wws/core` Worker runtime；`source.generated.ts` 由构建脚本生成，不能手工编辑。

生成结果必须是单一 browser IIFE、无 workspace import，并可通过稳定 `data:` URL 构造 SharedWorker。应用需要自定义 Worker 时应使用 `wws/worker` 的 runtime API。
