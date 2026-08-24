# Guide

WWS is a browser library that gives same-origin tabs one logical WebSocket
connection. It puts the physical socket inside a `SharedWorker`; every tab gets
its own `WebSocketClient` proxy and local event handlers.

The default path is deliberately small: provide a URL and stable `id`, call
`open()`, then use `onMessage()` and `sendMessage()`.

## What is shared

The socket, reconnect policy, queue, heartbeat, lease and protocol adapter are
shared. A page's listeners, latest `data`, lifecycle replay buffer and client
object are local to that page.

## Start here

- [Getting started](./getting-started) for the smallest usable client.
- [Connection sharing](./connection-sharing) for `id` and conflict rules.
- [Reliability](./reliability) for queues, backpressure and reconnects.
- [Fallback and Worker](./fallback-and-worker) for deployment choices.
