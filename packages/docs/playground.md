---
title: Playground
---

# Playground

Use this page to inspect WWS connection sharing from two same-origin tabs. The
default `ws://localhost:8787` endpoint is only the local E2E/demo service; use
your own WebSocket URL outside local development.

<ClientOnly>
  <PlaygroundPanel />
  <template #fallback>
    <p>Loading the browser-only playground…</p>
  </template>
</ClientOnly>

The connection is created only after **Connect**. Open another tab with the
same URL and `id` to see one SharedWorker-owned physical connection. Select
`direct` to observe the intentional construction/initialization fallback, or
`error` to surface that failure without opening another physical socket.
