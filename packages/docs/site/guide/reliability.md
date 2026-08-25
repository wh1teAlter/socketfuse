# Reliability

## State and reconnecting

`state` reflects the logical connection (`idle`, `connecting`, `open`,
`reconnecting`, `closed` and related transitional states). `status` maps it to
the familiar `CONNECTING`, `OPEN` or `CLOSED` form; `readyState` mirrors native
WebSocket numeric values. Listen to `statechange`, `open`, `close` and `error`
when rendering UI.

Reconnect is enabled by default. Configure it with `autoReconnect`, or call
`reconnect({ reason })` for an explicit new attempt. Retry delay grows from the
configured initial delay with factor and jitter, then resets after a stable
connection. A terminal close code or protocol decision does not retry.

## Queues and backpressure

`sendMessage()` returns a local acceptance receipt. It does not mean the server
processed a message and WWS has no server Ack protocol.

```ts
const receipt = await ws.sendMessage(payload, { queue: true })
// { status: 'accepted', messageId, bufferedAmount }
// or { status: 'queued', messageId, position }
```

Queueing is opt-in per message or through `queue`. The FIFO queue is bounded by
message and byte limits. When disconnected or above the high-water mark, an
unqueueable send rejects with `SEND_WHILE_DISCONNECTED` or `BACKPRESSURE`.
WWS resumes flushing below the low-water mark; it never grows the queue without
a bound.

## Heartbeats

WWS heartbeats are adapter-defined application messages. Raw protocol has no
heartbeat capability, so `heartbeat` with `protocol: 'raw'` is rejected during
configuration. Declarative JSON and custom adapters can describe ping/pong
frames. Heartbeats are shared connection behavior, so all tabs see the same
resulting reconnect. Select `heartbeat: false` when the server owns liveness,
or configure interval/pong timeout only after confirming the server protocol.

## Slow pages and overflow

Worker-to-page delivery is bounded independently for every tab: at most 256
unreceived messages or 4 MiB. The page runtime sends its receipt before it runs
your `onMessage` handler, so a slow handler never holds the Worker hostage.
When a tab exhausts that credit, only its newest inbound messages are dropped;
healthy tabs continue receiving the broadcast and the affected tab receives an
`overflow` event once delivery resumes. This is intentionally not application
delivery acknowledgement.
