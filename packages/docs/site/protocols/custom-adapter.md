# 自定义适配器

`ProtocolAdapter<Decoded, Outgoing>` 只负责同步 wire 编码、解码、分类和无状态心跳转换。跨帧状态放在每连接实例化的扩展闭包内，避免一个静态 adapter 的状态被多条连接共用。

```ts
import { defineWorkerProtocol, exposeSharedWebSocketWorker } from 'socketfuse/worker'
import { orderProtocol } from './order-protocol'

exposeSharedWebSocketWorker({
  protocols: [defineWorkerProtocol({ adapter: orderProtocol })],
})
```

页面使用纯数据 `{ type: 'custom', id, version, sharedConfig }` 和自定义 `worker` 工厂。所有值必须与 Worker 注册匹配；不存在报 `ADAPTER_NOT_REGISTERED`，相同共享 id 的其他配置冲突报 `CONNECTION_CONFIG_CONFLICT`。函数不能通过端口传递，旧的页面函数 adapter 不再接受。

`encode` 必须返回合法 SocketData；入站原生二进制固定为 ArrayBuffer。`decode`、`classify`、`encode`、`createPing`、`createPong`、`shouldReconnect` 都必须同步，thenable 会终止连接。普通 throw 按调用阶段映射安全错误，不传播异常文本。`classify` 必须返回有效 data/control/ping/pong/ignore/fatal 结构。

有状态的心跳、业务收到标志、投影和重连通过 [连接扩展](../guide/worker-extensions) 配对注册。扩展可以产生与 Decoded 不同的页面 Incoming 类型。自定义 Worker 不能降级到 direct，以免初始化失败时丢掉这些语义。
