# 私有连接引擎

`@socketfuse/core` 实现 SocketFuse 的共享连接和页面行为，由公开包打包使用，不单独发布到 npm。应用代码应从 `socketfuse`、`socketfuse/protocol` 或 `socketfuse/worker` 导入。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| [shared](src/shared/README.md) | 基础类型、默认值、安全错误、字节计费和回调隔离 |
| [config](src/config/README.md) | 规范化共享配置与页面本地选项 |
| [protocol](src/protocol/README.md) | raw、JSON 和同步 custom adapter |
| [connection](src/connection/README.md) | 单物理 socket、尝试、重连预算、心跳、FIFO 与背压 |
| [runtime](src/runtime/README.md) | 连接池、参与期、控制协议、分派、投递、回放和扩展 |
| [transport](src/transport/README.md) | SharedWorker 与页面 MessageChannel 接入 |
| [worker](src/worker/README.md) | SharedWorker 部署与端口接入 |
| [page](src/page/README.md) | 稳定 client、本地回调与浏览器生命周期 |

## 依赖与边界

依赖方向为 `shared → config/protocol/connection → runtime → transport/worker → page → public facade`。connection 不依赖 runtime、page 或 worker；runtime 是共享连接池和回放的唯一所有者，direct 与 shared 共用它。

相同共享域内，同一 `id` 和共享配置至多拥有一个物理 socket，配置冲突显式失败。Worker 不等待页面业务 handler。URL 和业务值只沿必要的连接输入与消息投递路径传递，控制响应、诊断和日志不回显凭据、payload 或内部异常文本。

## 开发

修改实现前，用 Plugydown Context 插件查找与本次改动有关的连接所有权、降级或投递契约。见[运行时知识入口](../../context/socket-runtime/domain.md)。

```sh
pnpm --filter @socketfuse/core typecheck
pnpm --filter @socketfuse/core test
pnpm --filter @socketfuse/core build
```

单测与源码相邻，共享夹具位于 [test/](test/README.md)。浏览器与发布包验收属于 [测试 workspace](../test/README.md)。修改后按根 [贡献指南](../../CONTRIBUTING.md) 进行完整串行验证。
