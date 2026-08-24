# WWS Review Remediation Tickets

- Phase: `implement` → `code-review`
- Status: Completed
- Source: [Review Remediation Specification](../specs/wws-review-remediation-spec.md)
- Review inputs: [review 1](../review/1.md), [review 2](../review/2.md)
- Relationship: this is a corrective increment over the already implemented
  T001–T016 and D001–D007 tickets. It replaces no public product scope and
  adds no new public messaging API.

## 1. Delivery order

```text
R001 Contract, configuration, and type correction
  ├─ R002 Control-plane validation, limits, and safe errors
  │    └─ R004 Shared Worker transport, credit, and recovery
  ├─ R003 Connection-attempt and pool lifecycle correctness
  │    └─ R004 Shared Worker transport, credit, and recovery
  └─ R005 Direct selection and page lifecycle parity
       └─ R004 Shared Worker transport, credit, and recovery

R002 + R003 + R004 + R005
  └─ R006 Core regression and contract coverage
       ├─ R007 Documentation and examples
       └─ R008 Isolated browser E2E matrix and final gates
```

Implementation is intentionally arranged by ownership boundary rather than by
the order findings appeared in the review. Each runtime ticket includes its
focused regression tests; R006 closes coverage holes that span those boundaries.
R007 and R008 may begin after their dependent runtime semantics stabilize.

## 2. Tickets

### R001 — Final contracts, connection limits, and JSON inference

- Dependencies: none.
- AC: AC-003, AC-009, AC-013, AC-017, AC-019, AC-023.
- Files: `packages/core/src/types.ts`, `constants.ts`, `config.ts`,
  `protocol.ts`, `bytes.ts`, `packages/wws/src/index.ts`, exported Worker
  types, plus focused config/protocol/type tests.
- Implementation:
  - Split `ResourceLimits` into page connection limits
    (`maxClientsPerConnection`, `maxEncodedMessageBytes`) and Worker static
    limits (`maxPorts`, `maxControlEnvelopeBytes`,
    `unattachedPortTimeoutMs`).
  - Remove Worker-only values from page options, normalized shared config,
    fingerprint, and hello payload; expose `workerLimits` on custom Worker
    runtime creation with secure inline defaults.
  - Preserve `CONTROL_PROTOCOL_MAJOR === 1`; adopt the final protocol shape
    directly with no legacy compatibility code.
  - Make declarative JSON protocol select
    `WebSocketClient<JsonValue, JsonValue, unknown>` automatically. Raw stays
    `SocketData`, and custom adapters retain their inferred generics.
  - Keep raw heartbeat unsupported, including a normalization regression test.
- Tests:
  - configuration/fingerprint tests proving Worker static limits do not cause
    connection conflict and connection limits do;
  - Worker limits normalization and invalid option ranges;
  - compile-time tests for raw, JSON, and custom adapter inference;
  - raw heartbeat rejection.
- Done when: types, config, and docs-facing exports admit exactly the final
  model; no code path reads a per-page Worker limit.

### R002 — Harden the control plane and Worker boundary

- Dependencies: R001.
- AC: AC-012, AC-017, AC-018.
- Files: `packages/core/src/control.ts`, `structured.ts`, `worker-runtime.ts`,
  `errors.ts`, `bytes.ts`, corresponding Worker/runtime tests.
- Implementation:
  - Replace shallow type guards with exact parsers for all page and Worker
    controls. Reject unknown fields and invalid ids, URLs, revisions, options,
    and request payload shape.
  - In the Worker, reconstruct/normalize hello configuration and restore data,
    recompute canonical/fingerprint, and accept only a matching static custom
    protocol registration.
  - Implement bounded recursive structured-clone size measurement. Account for
    binary data accurately and conservatively reject cycles/unmeasurable values
    rather than allowing them through.
  - Apply static Worker limits before hello. Correctly reclaim unattached ports
    on timeout, failure, and runtime disposal.
  - Replace cross-port raw error messages with code-derived stable safe public
    messages plus primitive allowlisted diagnostics only.
- Tests:
  - typed array, ArrayBuffer, Blob, Map, Set, nested and cyclic control
    envelopes at/below/above the limit;
  - forged canonical/fingerprint, unknown fields, NaN/negative revisions,
    invalid restore/shared options, and custom adapter mismatch;
  - max-port exhaustion followed by unattached timeout reclaim;
  - adapter/server-style error containing a secret never reaches a second
    client, EventTarget, callback, or logger.
- Done when: no Worker action relies on page-supplied normalized data and one
  malformed port cannot alter or exhaust healthy clients.

### R003 — Correct physical attempt, auth, and pool lifetimes

- Dependencies: R001.
- AC: AC-005, AC-007, AC-008, AC-009, AC-010, AC-017.
- Files: `packages/core/src/connection-controller.ts`,
  `connection-state.ts`, `protocol.ts`, `worker-runtime.ts`, related core
  tests.
- Implementation:
  - Make one deadline cover native connection and adapter handshake. Convert
    adapter `fatal` to terminal sanitized protocol failure.
  - Give socket attempts identity/generation. URL revisions, auth restarts, and
    explicit reconnect cancel the old attempt and ignore its late callbacks.
  - Send current adapter auth before ready even for `readyWhen: 'socket-open'`;
    keep it before adapter-frame readiness too.
  - Route explicit reconnect during backoff through `reconnecting ->
    connecting`; eliminate illegal direct-to-open transitions.
  - Remove idle Worker entries only after their controller's idle close has
    completed; ensure stale timers cannot delete a replacement entry.
- Tests:
  - handshake timeout and fatal frame reject open without timer leak;
  - URL update while connecting and handshaking closes/ignores old socket and
    uses the new endpoint;
  - JSON auth-only first frame is sent before open;
  - explicit reconnect during retry backoff succeeds without
    `INTERNAL_STATE_ERROR`;
  - final client detach releases Worker pool state and permits fresh config.
- Done when: every connection attempt reaches a legal terminal/retry state and
  idle connection metadata has the same bounded lifetime as its socket.

### R004 — Shared transport credit, overflow, and restart recovery

- Dependencies: R002, R003, R005.
- AC: AC-007, AC-012, AC-014, AC-015, AC-017, AC-023.
- Files: `packages/core/src/control.ts`, `worker-runtime.ts`,
  `shared-worker-transport.ts`, `page-client.ts`, `connection-controller.ts`,
  corresponding integration fixtures/tests.
- Implementation:
  - Add delivery ids and receipt controls. Bound outstanding Worker-to-page
    delivery count/bytes and coalesce per-client inbound overflow until credit
    is available.
  - Deliver public overflow events for both credit loss and lifecycle replay
    loss; never await a user handler in Worker or transport code.
  - Add a bounded probe and changed-instance detection for restore-enabled
    SharedWorker clients. Recreate only the shared transport when necessary,
    then replay current endpoint/auth-or-clear revisions and prior demand.
  - Keep the public PageWebSocketClient object stable while its internal
    transport changes. Do not select direct after a selected SharedWorker fails
    during recovery.
- Tests:
  - a non-reading page hits count and byte credit but healthy pages continue;
    receipt is emitted before sink handler invocation;
  - `overflow` reaches page event consumers with correct direction/count/bytes;
  - simulated Worker/port loss rebuilds transport and replays endpoint/auth;
  - replay preserves arrival order and does not claim recovery after lease
    expiration.
- Done when: every Worker→page path is bounded and restart/BFCache recovery is
  independently observable without new public API.

### R005 — Browser environment, lazy fallback, and lifecycle parity

- Dependencies: R001, R002.
- AC: AC-004, AC-007, AC-015, AC-016, AC-018, AC-019, AC-023.
- Files: `packages/wws/src/index.ts`, `packages/core/src/direct-transport.ts`,
  `shared-worker-transport.ts`, `page-client.ts`, and unit/package tests.
- Implementation:
  - Reject `createWebSocket()` outside a browser page realm before creating a
    direct fallback, including Node versions exposing global `WebSocket`.
  - Create DirectTransport lazily only on an allowlisted Worker initialization
    failure. Remove `INVALID_CONTROL_MESSAGE` from the fallback allowlist.
  - Ensure `fallback: 'error'` can create/dispose/recreate identical ids without
    a leaked direct-pool conflict.
  - Apply suspended dispatch semantics equally in direct and shared modes.
  - Consume `autoClose`: ordinary non-BFCache pagehide detaches current client;
    BFCache pagehide suspends restore-enabled client; `autoClose: false` only
    disables ordinary automatic detach.
  - Change page message order to data → `onMessage` snapshot → EventTarget
    message, retaining handler exception isolation.
- Tests:
  - SSR/Node creation throws before socket construction for immediate and lazy
    clients;
  - fallback:error pool regression, malformed Worker response does not direct
    fallback, and ordinary socket fault stays shared;
  - shared/direct suspension parity with replay on/off;
  - synthetic pagehide/pageshow behavior, autoClose false, and handler/event
    ordering.
- Done when: transport selection is single-shot and page lifecycle behavior is
  consistent regardless of transport.

### R006 — Complete core regression and contract coverage

- Dependencies: R002–R005.
- AC: AC-001 through AC-019 and AC-023.
- Files: all affected `packages/core/src/*.test.ts`, reusable fake
  MessagePort/WebSocket/clock fixtures, package-consumer type tests.
- Implementation:
  - Turn the focused ticket tests into a single direct/shared lifecycle contract
    suite wherever both transports must agree.
  - Cover resource cleanup, error sanitization, overflow, auth/URL revisions,
    state transitions, and disposal races with deterministic injected clocks
    and sockets.
  - Add release-consumer type assertions for JSON inference and all three public
    entry imports. Retain the agreed NodeNext/Node ESM verification scope only.
- Tests: the suite itself is the deliverable and runs via `pnpm test` and
  `pnpm release:verify`.
- Done when: every confirmed non-browser finding has a regression test that
  would fail against the reviewed implementation, with no test relying on real
  timing/network or process-global state.

### R007 — Correct public documentation and examples

- Dependencies: R001, R004, R005.
- AC: AC-007, AC-009, AC-012, AC-015, AC-018, AC-019.
- Files: `README.md`, `packages/docs/index.md`, reliability/lifecycle/fallback
  guides, configuration/reference pages, generated API input comments where
  needed.
- Implementation:
  - Correct raw examples to use string/binary data or explicit JSON protocol.
  - State raw heartbeat is unavailable; describe JSON/custom adapter heartbeat
    capability.
  - Document Worker static limits, connection limits, overflow best effort,
    credit semantics, restore/replay limitations, BFCache behavior, and safe
    error boundary.
  - Preserve previously agreed docs architecture and do not add an independent
    playground or new dependencies.
- Tests: docs build, internal links, and any existing example type/build checks.
- Done when: a reader can use all shown examples without a raw-payload type or
  runtime error, and docs make no reliability guarantee beyond implementation.

### R008 — Isolated cross-browser E2E matrix and final gates

- Dependencies: R004–R007.
- AC: AC-001, AC-004, AC-005, AC-007, AC-009, AC-012 through AC-016, AC-021,
  AC-022.
- Files: `packages/test/server/ws-server.mjs`, `packages/test/e2e/*`, Playwright
  helpers/config, root verification scripts only where an existing gate needs
  the expanded suite.
- Implementation:
  - Namespace ws-server connection statistics and control operations per test;
    use test-local baseline-delta assertions.
  - Add realistic browser coverage for 2, 3, and 20 pages, close/reload,
    BFCache/pageshow fallback, Worker restart, normal fault no-direct fallback,
    direct/error initialization fallback, reconnect, text/Blob/ArrayBuffer/view
    echo, broadcast ordering, and resource release.
  - Keep runs stable across Chromium, Firefox, and WebKit; use documented
    visibility/pageshow fallback for engine-specific lifecycle limits.
  - Run complete repository verification and record any platform-specific
    capability assertion rather than silently skipping it.
- Tests: `pnpm test:e2e`, then `pnpm check`, and `git diff --check`.
- Done when: repeat/parallel execution has no shared-stat pollution and the
  required browser behavior is a CI gate rather than a manual review claim.

## 3. Explicitly out of scope

- Changing the unreleased control protocol major from 1 or maintaining a
  compatibility layer for the reviewed protocol implementation.
- Adding `subscribe`, request/Ack/RPC APIs, a new transport, framework binding,
  Vite consumer verification, ATTW, or sourcemap source-content removal.
- Publishing `wws`, creating tags, releases, or changing package version.

## 4. Implement-phase completion rule

Implementation is complete only when R001–R008 are done, all focused and final
gates pass, documentation matches the final behavior, and code review finds no
unresolved confirmed finding from either review input. Any newly discovered
public-semantic disagreement returns to `grill-with-docs`/`to-spec` before a
code change is made.
