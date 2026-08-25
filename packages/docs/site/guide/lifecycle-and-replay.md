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
freeze/resume signals. A BFCache `pagehide` suspends the current page rather
than detaching it; an ordinary `pagehide` detaches automatically unless
`autoClose: false` is set. While suspended, neither direct nor SharedWorker
transport dispatches live messages. With replay enabled, they are buffered
locally/per-port and later reach normal `onMessage` listeners in FIFO order
with `event.replayed === true`.

The Worker only dispatches events; it never waits for page handlers. This
preserves the physical connection's throughput even if a tab is busy.

## Boundaries

Replay is disabled by default and bounded. On overflow, the oldest buffered
entry is discarded and an `overflow` event is emitted. On restore, WWS probes a
selected SharedWorker and recreates only that shared transport when the Worker
is gone, then reapplies the newest endpoint/auth revisions. Worker restart, a
missed lease, page termination and a server-side reconnect are still not
reliable message recovery boundaries. Use application-level cursors or durable
delivery when messages must not be lost.
