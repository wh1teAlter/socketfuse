# Diagnostics and errors

`ws.diagnostics()` exposes safe operational data: transport, logical/physical
state, stable hashes, endpoint origin, retry, queue, buffered amount,
attached-client count and last safe error/close codes.

It intentionally excludes auth values, URL query strings, message payloads and
internal error stacks. This makes diagnostics suitable for application metrics
without turning it into a data-exfiltration channel.

## Errors

Errors are `WwsError` values with a stable `code`, human message, retryability
and fatality flags. Important setup errors include `WORKER_UNSUPPORTED`,
`WORKER_CONSTRUCTION_FAILED`, `WORKER_INIT_TIMEOUT`,
`CONNECTION_CONFIG_CONFLICT` and
`ADAPTER_NOT_REGISTERED`. Runtime send errors include
`SEND_WHILE_DISCONNECTED`, `BACKPRESSURE` and `RESOURCE_LIMIT_EXCEEDED`.

Use `isWwsError()` for a type guard, and prefer the `code` over matching the
human-readable message. The full code union is generated in
[WwsErrorCode](../api/generated/index/type-aliases/WwsErrorCode.md).
