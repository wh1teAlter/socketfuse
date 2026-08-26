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
