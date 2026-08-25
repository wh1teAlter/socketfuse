# Custom adapter

A `ProtocolAdapter` implements encode, decode and frame classification for a
nonstandard protocol. Adapter functions cannot cross a `MessagePort`, so custom
adapters must be registered in the Worker entry, not created independently in
each page.

```ts
import { exposeSharedWebSocketWorker } from 'wws/worker'
import { orderProtocol } from './order-protocol'

exposeSharedWebSocketWorker({ protocols: [orderProtocol] })
```

Then create the client with the same adapter identity/version and custom Worker
URL. If the Worker cannot resolve that registered adapter, connection setup
fails with `ADAPTER_NOT_REGISTERED`. See the generated
[ProtocolAdapter API](../api/generated/protocol/interfaces/ProtocolAdapter.md)
for its full contract.
