# 发布验收模块

`verify-release.mjs` 打包 `socketfuse` 并在独立临时消费者中检查 tarball 白名单、CHANGELOG、入口文件、source map 路径、私有 workspace import、TypeScript 类型、Vite 构建和 SSR import。

脚本拥有临时目录的创建与清理，不修改 workspace 依赖或发布产物；任何额外 artifact、绝对路径或私有引用都会使验收失败。
