# 发布验收模块

`verify-release.mjs` 打包 `socketfuse` 并在独立临时消费者中检查 tarball 白名单、CHANGELOG、入口文件、source map 路径、私有 workspace import、TypeScript 类型、Vite 构建和 SSR import。

脚本先 pack/prepack 构建，再对实际解压包运行 publint 和消费者验收，因此不要求预存 dist。临时目录由本次运行独占并最终清理；任何额外 artifact、绝对路径或私有引用都会失败。设置 SOCKETFUSE_VERIFIED_TARBALL 可在全部验收后以不覆盖方式导出同一个 tarball；受保护发布 job 直接发布它，不再次 prepack。
