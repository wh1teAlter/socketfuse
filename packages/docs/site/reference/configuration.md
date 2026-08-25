# Configuration

`CreateWebSocketOptions` splits deliberately into shared and page-local
settings. This protects a shared `id` from silently combining incompatible
socket behavior.

## Shared settings

The initial `url`, `protocols`, `protocol`, `autoReconnect`,
`connectionTimeout`, `binaryType`, `heartbeat`, `queue`, `backpressure`,
`lease`, `limits` and `idleGraceMs` describe the physical connection. A
mismatch on a reused `id` produces `CONNECTION_CONFIG_CONFLICT`. Later URL
changes use the shared endpoint revision register rather than the static
configuration fingerprint.

## Page-local settings

`immediate`, `autoClose`, `fallback`, `worker`, `lifecycle`, `logger`, `onConnected`,
`onDisconnected`, `onError` and `onMessage` belong only to the creating tab.
This lets a tab opt into restore replay without affecting other tabs.

`limits` contains connection limits only: `maxClientsPerConnection` and
`maxEncodedMessageBytes`; both participate in the shared fingerprint. Custom
Worker authors configure Worker-wide control-plane limits once through
`createSharedWebSocketRuntime({ workerLimits })`: `maxPorts`,
`maxControlEnvelopeBytes`, and `unattachedPortTimeoutMs`. These static Worker
limits are never accepted from a page and do not create connection conflicts.

Read the generated [CreateWebSocketOptions](../api/generated/index/interfaces/CreateWebSocketOptions.md)
for defaults and all exact option fields.
