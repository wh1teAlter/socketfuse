# WWS v1 Review Remediation Specification

- Status: Implemented and code-reviewed
- Date: 2026-08-24
- Scope: confirmed findings in `docs/review/1.md` and `docs/review/2.md`
- Base specifications: [WWS v1](./wws-v1-spec.md), [documentation and tooling](./wws-documentation-and-tooling-spec.md)

This is a narrow corrective amendment to WWS v1. It takes precedence wherever
the base specification is ambiguous or conflicts with the rules below. WWS has
not been published, so breaking internal and public type changes are allowed
when they produce the simpler, safer final design. It does **not** add RPC,
topics, `subscribe()`, server acknowledgements, a new transport, framework
bindings, or publishing work.

## 1. Confirmed scope and exclusions

Every confirmed runtime, lifecycle, resource, security, documentation, typing,
and test-isolation defect in the review inputs is in scope. The v1 section
23.3 browser E2E matrix is part of this repair, not a later aspiration.

The following review claims are not defects and MUST NOT cause a change:

- Same-origin clients using the same `id` receive the same business messages.
  That is the explicit sharing contract.
- Relative source names and bundled `sourcesContent` in sourcemaps are not a
  private runtime dependency leak. Published JavaScript and declarations MUST
  not import `@wws/core`; source-map content remains enabled for debugging.
- A no-transform re-export is not required to manufacture a separate JS map.
- Release verification remains real tarball + NodeNext type consumer + Node ESM
  import as defined in the documentation/tooling specification. This amendment
  does not reintroduce a Vite consumer, ATTW, or a Vite dependency.

## 2. Final resource and control-plane model

### 2.1 Worker-level limits

`maxPortsPerWorker`, `unattachedPortTimeoutMs`, and
`maxControlEnvelopeBytes` protect one SharedWorker control plane. They are not
per-connection settings and MUST NOT appear in
`createWebSocket(...).limits`, the shared-config fingerprint, or a page
`hello` request.

The worker API instead exposes static runtime configuration:

```ts
interface WorkerResourceLimits {
  maxPorts: number                 // default 256
  unattachedPortTimeoutMs: number  // default 5_000
  maxControlEnvelopeBytes: number  // default 2 MiB
}

createSharedWebSocketRuntime({ workerLimits?: Partial<WorkerResourceLimits> })
```

The inline Worker uses these secure defaults. Applications needing different
Worker-level limits supply a custom Worker factory and configure its runtime
once; later pages cannot change an already-running Worker.

`CreateWebSocketOptions.limits` becomes the connection-only shape:

```ts
interface ConnectionLimits {
  maxClientsPerConnection: number  // default 64
  maxEncodedMessageBytes: number   // default 1 MiB
}
```

Those values remain normalized and part of the shared-config fingerprint.

### 2.2 Exact control-message validation

Every incoming MessagePort payload first passes a bounded,
structured-clone-aware size check and then an exact runtime parser. The parser
uses an allowlist: required fields must have valid type/range, optional fields
must have valid type/range, and unknown fields are rejected.

For `hello`, the Worker MUST normalize the URL, shared configuration, protocol
descriptor, and restore configuration; resolve raw/JSON descriptors or verify a
static custom adapter; recompute canonical configuration and fingerprint; and
reject supplied canonical/fingerprint mismatches with
`INVALID_CONTROL_MESSAGE`. Only the normalized Worker-owned result is used
afterwards. A malformed port is isolated from healthy clients.

The byte estimator recursively accounts for strings, object keys, arrays,
plain records, Maps, Sets, ArrayBuffers, views, Blobs, Dates, and RegExps while
tracking cycles/shared references. Binary values use true byte length. It
stops when the limit is exceeded. JSON stringification is not an estimator;
unsupported/unmeasurable values are rejected conservatively.

### 2.3 Control protocol and safe errors

The unreleased control protocol remains major `1`, but its source is rewritten
to this final model with no compatibility shim. A custom Worker and page package
MUST come from the same WWS release. A genuine mismatch remains deterministic
`PROTOCOL_VERSION_MISMATCH`.

Worker-to-page errors contain only `code`, `retryable`, `fatal`, and explicitly
whitelisted primitive diagnostics. They never contain raw `Error.message`,
`cause`, stack, server or adapter payload, auth, or full endpoint URL. The page
maps code to WWS-owned safe public text before emitting an error, invoking
`onError`, or calling `logger`. The direct path applies the same public-boundary
sanitization.

### 2.4 Bounded Worker-to-page fan-out

Each Worker delivery has a monotonic per-client `deliveryId` and byte count. An
attached non-suspended page has at most 256 unreceipted deliveries or 4 MiB of
unreceipted payload. `SharedWorkerTransport` sends `receipt(deliveryId)` as
soon as the page runtime receives the control message and **before** local sink
dispatch. Receipt never waits for or observes an `onMessage`/EventTarget
handler.

At exhausted credit, the Worker drops only that client's new business messages,
aggregates count/bytes, and sends bounded `overflow` after later receipt frees
credit. Replay drop-oldest loss is surfaced through the same event.
`SharedWorkerTransport` converts it to public `WwsOverflowEvent` with inbound
or replay direction. Slow/suspended pages never delay other clients or the
physical connection.

## 3. Connection ownership and lifecycle corrections

### 3.1 Reclamation

Detaching a port always clears its unattached timer, removes it from the Worker
port set, and closes it when requested, including before `hello` completes.
When the last connection client leaves, the existing idle grace applies; after
it, the controller is intentionally stopped and that exact Worker pool entry is
removed. Timer callbacks are identity guarded, so an old entry cannot delete a
new entry using the same `id`.

### 3.2 Environment and fallback ownership

`createWebSocket()` requires a browser page realm (window and document) before
creating any transport. Node may expose global `WebSocket`, but client creation
there throws `ENVIRONMENT_UNSUPPORTED` and never constructs direct transport.

Direct fallback is lazy: it is constructed only if an allowlisted Worker
initialization failure occurs and fallback is `direct`. `fallback: 'error'`
never registers a direct-pool entry. `INVALID_CONTROL_MESSAGE` is not an
allowlisted fallback reason. Once a transport is selected, socket, auth,
heartbeat, protocol, and network failures never switch to direct.

### 3.3 Attempt state machine

One attempt deadline covers native connection and adapter-frame handshake and
clears only once the protocol is ready. An adapter `fatal` frame becomes a
sanitized terminal `PROTOCOL_ERROR`, closes the attempt, and rejects waiters.

Attempts have identity. Endpoint updates, auth-driven restarts, and explicit
reconnect cancel old attempts, ignore late events, and create one controlled
new attempt. A URL update during `connecting`/`handshaking` therefore cannot
complete against the old endpoint. Explicit and timed retry use exactly:

```text
reconnecting -> connecting -> handshaking? -> open
```

Explicit reconnect cancels backoff then enters `connecting`; it cannot jump
`reconnecting -> open`. For an adapter with `createAuth`, the latest auth frame
is sent before reporting ready for both socket-open and adapter-frame modes;
encoding failure is controlled `AUTH_FAILED`.

### 3.4 Page lifecycle, BFCache, and Worker restart

The public client owns a mutable internal transport reference and factory; its
public object identity is stable. On a restore-enabled lifecycle recovery, it
probes the existing SharedWorker port. Failed probe or changed Worker instance
means: dispose old shared transport, make/attach a new one using original mode,
idempotently replay newest endpoint/auth-or-clear revision, restore state, and
reopen only if the client previously had demand.

Recovery does not select direct after shared transport was selected. Direct and
shared have parity while suspended: neither dispatches; `replay` determines only
whether bounded local entries are retained for later delivery.

`autoClose` is independent from restore. On non-BFCache pagehide
(`persisted === false`), `autoClose !== false` best-effort detaches only the
current logical client. On BFCache pagehide (`persisted === true`), a
restore-enabled client suspends rather than detaches. `autoClose: false` only
disables ordinary automatic detach; it never alters explicit close/dispose or
restore suspension.

### 3.5 Page dispatch order

For each business message the required ordering is:

```text
data update -> onMessage handler snapshot in registration order -> message event
```

Handler exceptions are isolated and reported safely; later handlers and the
EventTarget event still run.

## 4. Public type and documentation corrections

`protocol: { type: 'json', ... }` selects an overload returning
`WebSocketClient<JsonValue, JsonValue, unknown>` without explicit generics.
Raw remains `SocketData`; custom adapter generics are inferred from its adapter.

Raw protocol has no heartbeat capability. Supplying heartbeat with raw is
rejected. Documentation and the v1 heartbeat rule state heartbeat requires a
JSON/custom adapter that declares classification and ping/pong capability.

Quick starts either send raw string/binary data or select JSON before sending
objects; examples must type-check and run as written.

## 5. Verification requirements

Core tests MUST cover recursive control-size accounting (typed arrays,
ArrayBuffers, Blobs, Map/Set, cycles); strict control parsing and forged
canonical/fingerprint; port cleanup, Worker limits, idle entry deletion, and
timer identity; safe secret-containing adapter errors; delivery credit/receipt
and observable overflow; Node with global WebSocket but no page realm; lazy
fallback; handshake/fatal/auth/URL/backoff races; Worker recreation and
revision replay; direct/shared suspension parity; autoClose/BFCache; JSON
overload types; and onMessage-before-message ordering.

The test WebSocket server MUST isolate counters by caller-provided namespace.
Every Playwright test creates a unique namespace and asserts its own baseline
delta, never a process-global count.

Across Chromium, Firefox, and WebKit, Playwright MUST cover isolated 2, 3, and
20-page sharing; close/reload; BFCache/pageshow restore; Worker restart;
ordinary socket failure without direct fallback; direct/error init fallback;
reconnect; text/Blob/ArrayBuffer/typed-array echo; broadcast order; and
resource cleanup. Browser-specific unavailable signals use documented
visibility/pageshow fallback rather than silently skipping behavior.

## 6. Acceptance mapping

These repairs fulfil AC-001 through AC-023, especially AC-005 (reclamation),
AC-007 (restart recovery), AC-009 (attempt/heartbeat), AC-012 (bounded fan-out),
AC-015/016 (fallback), AC-017/018 (malformed control and sanitization), and
AC-021/022 (browser/full-pipeline verification).
