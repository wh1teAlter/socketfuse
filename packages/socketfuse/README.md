# SocketFuse

[![npm beta](https://img.shields.io/npm/v/socketfuse/beta?label=npm%20beta)](https://www.npmjs.com/package/socketfuse)

[English](https://github.com/wh1teAlter/socketfuse/blob/main/README.md) · [简体中文](https://github.com/wh1teAlter/socketfuse/blob/main/README.zh-CN.md)

Share one physical WebSocket across same-origin browser tabs using SharedWorker. Each page keeps its own client, callbacks, and lifecycle. Framework agnostic, with TypeScript types and no third-party runtime dependencies.

SocketFuse is in beta; upgrades may include breaking changes. See the [changelog](https://github.com/wh1teAlter/socketfuse/blob/main/packages/socketfuse/CHANGELOG.md). Chinese documentation is the source of truth.

## Install

```sh
pnpm add socketfuse@beta
```

## Quick start

Run this in a browser page:

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

Replace the URL with your server. Tabs using the same `id`, shared configuration, and Worker deployment join the same connection. Your server defines the application messages. Call `close()` to leave and later reopen, or `dispose()` to permanently release the client when it is no longer needed.

## Public entry points

| Entry | Purpose |
| --- | --- |
| `socketfuse` | `createWebSocket`, client types, configuration, events, and errors |
| `socketfuse/protocol` | `rawProtocol` and the synchronous `ProtocolAdapter` contract |
| `socketfuse/worker` | `defineWorkerProtocol`, `createSharedWebSocketRuntime`, and `exposeSharedWebSocketWorker` |

This package bundles the private core implementation; applications should use only these public entry points.

## Behavior and boundaries

- `sendMessage()` confirms local acceptance or queueing, not server delivery.
- Worker extensions process application receipts and protocol frames once per physical frame. Page callbacks run independently.
- Page, Worker, and automatic reconnection share one retry budget. Explicit exemptions do not reset it.
- `dispatchKey` selects one recipient per frame; it is not a cross-tab lock.
- Inline Worker initialization failures may fall back to page-local direct transport. Custom Workers always fail explicitly; later network failures never switch the selected transport.
- All entry points are safe to import in SSR or Node. Creating a client requires a browser page.

## Documentation and contributing

[Project overview](https://github.com/wh1teAlter/socketfuse#readme) · [中文文档](https://github.com/wh1teAlter/socketfuse/blob/main/packages/docs/site/guide/index.md) · [Contributing](https://github.com/wh1teAlter/socketfuse/blob/main/CONTRIBUTING.md) · [Issues](https://github.com/wh1teAlter/socketfuse/issues)

In the repository, `pnpm --filter socketfuse build` generates the public entry points and inline Worker. `pnpm release:verify` validates the actual tarball, consumer types, bundling, and SSR imports. Maintainer release procedures are documented in the [workflow guide](https://github.com/wh1teAlter/socketfuse/blob/main/.github/workflows/README.md).

## License

[MIT](https://github.com/wh1teAlter/socketfuse/blob/main/packages/socketfuse/LICENSE)
