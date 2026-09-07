---
layout: home
title: SocketFuse
hero:
  name: SocketFuse
  text: 多个标签页，一个 WebSocket
  tagline: 以 SharedWorker 为首选共享连接、心跳与重连预算，让页面专注业务回调。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 打开演练场
      link: /playground
    - theme: alt
      text: GitHub
      link: https://github.com/wh1teAlter/socketfuse
features:
  - title: 同源连接共享
    details: 相同 id 与共享配置复用物理连接，每个页面拥有自己的 client 和生命周期。
  - title: Worker 协议处理
    details: 自定义收到标志、控制消息和业务投影按物理帧处理，页面回调彼此独立。
  - title: 统一恢复预算
    details: 自动恢复、页面和 Worker 主动重连共用次数，显式豁免不重置预算。
  - title: 有界投递与回放
    details: 队列、端口和生命周期缓存有明确容量；接纳、送达与业务成功分别定义。
---

## 从一个页面开始

```sh
pnpm add socketfuse@beta
```

```ts
import { createWebSocket } from 'socketfuse'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events:user-42',
  protocol: { type: 'json' },
  immediate: false,
})

ws.onMessage(event => console.log(event.data))
await ws.open()
await ws.sendMessage({ type: 'subscribe', channel: 'notifications' })
```

替换为你的服务地址；在另一个同源标签页使用相同 `id`、共享配置和 Worker 部署，即可加入已有连接。应用不再使用 client 时调用 `dispose()`。

项目处于 beta 阶段，升级可能包含破坏性调整。本文档随 main 更新，中文内容为维护基准；已发布版本见 [npm](https://www.npmjs.com/package/socketfuse)，升级说明见 [CHANGELOG](https://github.com/wh1teAlter/socketfuse/blob/main/packages/socketfuse/CHANGELOG.md)。仓库 README 提供 [English](https://github.com/wh1teAlter/socketfuse/blob/main/README.md) 和[简体中文](https://github.com/wh1teAlter/socketfuse/blob/main/README.zh-CN.md)。

## 按场景阅读

| 想做什么 | 从这里开始 |
| --- | --- |
| 接入应用、注册回调、发送和清理 | [快速开始](./guide/getting-started) |
| 解释连接复用与配置冲突 | [连接共享](./guide/connection-sharing) |
| 配置重连次数、心跳、队列和背压 | [可靠性](./guide/reliability) |
| 在 Worker 中定义协议收到标志和控制消息 | [Worker 共享处理](./guide/worker-extensions) |
| 处理页面隐藏、冻结与回放 | [生命周期与回放](./guide/lifecycle-and-replay) |
| 配置静态 Worker、CSP 和降级 | [降级与 Worker](./guide/fallback-and-worker) |
| 查看完整类型与默认值 | [API 参考](./api/)和[配置参考](./reference/configuration) |

## 使用前了解

`sendMessage()` 成功只表示本地接纳或入队；`dispatchKey` 只保证每帧选择一个接收者；回放只保留有界内存中的业务投影。认证、游标、幂等和可靠送达由应用协议维护。

三个公开入口可在 SSR 中安全导入，创建 client 必须在浏览器页面执行。自定义 Worker 不允许 direct fallback；内联模式仅在明确的初始化失败时可降级。详见[兼容性与安全](./reference/compatibility-and-security)。
