# Protocols

WWS separates transport sharing from message semantics. The default raw
protocol forwards WebSocket data unchanged. The JSON protocol adds declarative
ready, auth and heartbeat frames. A custom adapter is for protocols that cannot
be expressed declaratively.

- [Raw protocol](./raw)
- [JSON protocol](./json)
- [Custom adapter](./custom-adapter)

The selected protocol is part of the shared configuration. Tabs with the same
`id` must select equivalent protocol behavior.
