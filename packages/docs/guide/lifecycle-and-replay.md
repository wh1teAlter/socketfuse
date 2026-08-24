# Lifecycle and replay

Browser pages can be hidden, frozen, restored from back/forward cache, or
terminated. WWS can coordinate a best-effort local pause and replay buffer for
the first three states.

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  lifecycle: {
    restore: { replay: true, maxMessages: 256, maxBytes: 4 * 1024 * 1024 },
  },
})
```

## How it works

With restore enabled, WWS observes visibility, pagehide/pageshow and browser
freeze/resume signals. While the page is suspended, incoming messages are
buffered locally. On restore, they reach normal `onMessage` listeners in FIFO
order with `event.replayed === true`.

The Worker only dispatches events; it never waits for page handlers. This
preserves the physical connection's throughput even if a tab is busy.

## Boundaries

Replay is disabled by default and bounded. On overflow, the oldest buffered
entry is discarded and an `overflow` event is emitted. Worker restart, a missed
lease, page termination and a server-side reconnect are not reliable recovery
boundaries. Use application-level cursors or durable delivery when messages
must not be lost.
