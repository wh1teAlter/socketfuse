# 自定义适配器

`ProtocolAdapter` 为非标准协议实现编码、解码和帧分类。适配器函数不能跨越 `MessagePort`，
因此自定义适配器必须在 Worker 入口注册，不能在每个页面中独立创建。

```ts
import { exposeSharedWebSocketWorker } from 'socketfuse/worker'
import { orderProtocol } from './order-protocol'

exposeSharedWebSocketWorker({ protocols: [orderProtocol] })
```

随后，请使用相同的适配器标识/版本和自定义 Worker URL 创建 client。Worker 无法解析已注册适配器时，
连接建立会以 `ADAPTER_NOT_REGISTERED` 失败。完整契约请参阅生成的
[ProtocolAdapter API](../api/generated/protocol/interfaces/ProtocolAdapter.md)。

## 适配器不保存跨帧状态

适配器只描述 wire format：编码、解码、把帧分类为业务帧或控制帧。**跨帧的业务状态不属于它**——
去重表、共享的服务端时钟这类连接期状态应放进
[连接作用域扩展](../guide/worker-extensions)，否则同一个接口会同时承担格式规则与业务状态机两种
生命周期，并让参与共享指纹的 `sharedConfig` 语义变得不确定。

`createPing` 是例外中的合理用法：它每个心跳周期调用一次，可以读取扩展维护的状态来实时生成
payload（例如携带当前服务端时间戳）。声明式 JSON 协议的 `heartbeat.ping` 是静态值，做不到这一点。
