# WWS Repository Structure Specification

- Status: Approved for implementation
- Date: 2026-08-25
- Scope: repository file organization only

## 1. Objective

Make the repository navigable by runtime ownership and engineering purpose. A contributor should be able to locate connection logic, transports, Worker code, public API code, documentation source, browser tests, and release verification without knowing historical filenames.

This refactor MUST preserve the public package contract and runtime behavior. It is not an opportunity to redesign the control protocol, public API, connection state machine, lifecycle behavior, or dependency set.

## 2. Workspace boundaries

The repository keeps exactly four workspaces:

```text
packages/
├── core/   # private connection engine and runtimes
├── wws/    # public npm package and browser environment facade
├── docs/   # VitePress site, generated API docs, and playground
└── test/   # browser E2E, WebSocket test server, and release verification
```

No new package is introduced. In particular, the playground remains a documentation page and `ws` remains a test-only dependency.

## 3. Target layout

### 3.1 Core

```text
packages/core/src/
├── connection/
│   ├── controller.ts
│   ├── controller.test.ts
│   ├── state.ts
│   ├── state.test.ts
│   ├── reconnect.ts
│   ├── reconnect.test.ts
│   ├── heartbeat.ts
│   ├── queue.ts
│   ├── queue.test.ts
│   ├── backpressure.ts
│   ├── backpressure.test.ts
│   ├── revision.ts
│   └── revision.test.ts
├── config/
│   ├── normalize.ts
│   └── normalize.test.ts
├── page/
│   ├── client.ts
│   └── client.test.ts
├── protocol/
│   ├── adapter.ts
│   └── adapter.test.ts
├── transport/
│   ├── direct.ts
│   ├── shared-worker.ts
│   └── socket.ts
├── worker/
│   ├── control.ts
│   ├── runtime.ts
│   └── runtime.test.ts
├── shared/
│   ├── bytes.ts
│   ├── constants.ts
│   ├── errors.ts
│   ├── structured.ts
│   ├── structured.test.ts
│   └── types.ts
└── index.ts
```

Tests stay next to the implementation they exercise. No barrel files are added below `src/`; cross-feature imports point at their defining module so dependency direction remains visible.

### 3.2 Public package

```text
packages/wws/src/
├── api/
│   └── create-websocket.ts
├── worker/
│   ├── entry.ts
│   └── source.generated.ts
├── index.ts
├── protocol.ts
└── worker.ts
```

`index.ts`, `protocol.ts`, and `worker.ts` are public export boundaries. `createWebSocket` implementation belongs in `api/create-websocket.ts`. Public types continue to be re-exported from core rather than duplicated in a presentation-only type file. The generated inline Worker source is clearly named and colocated with its source entry.

### 3.3 Documentation

```text
packages/docs/
├── site/
│   ├── .vitepress/
│   │   ├── config.ts
│   │   ├── env.d.ts
│   │   └── theme/
│   ├── api/
│   │   ├── index.md
│   │   └── generated/
│   ├── guide/
│   ├── playground.md
│   ├── playground/
│   │   ├── components/
│   │   ├── composables/
│   │   └── workers/
│   ├── protocols/
│   ├── reference/
│   └── index.md
├── package.json
├── tsconfig.json
├── tsconfig.typedoc.json
└── typedoc.json
```

All published site content lives under the explicit VitePress source root `site/`. Playground implementation is owned by its page, not by the global theme. TypeDoc writes to `site/api/generated`. Generated API Markdown remains checked in under its new location.

### 3.4 Test workspace

```text
packages/test/
├── e2e/
│   └── specs/
│       └── playground.spec.ts
├── release/
│   └── verify-release.mjs
├── server/
│   └── ws-server.mjs
├── package.json
├── playwright.config.ts
└── tsconfig.json
```

The test workspace has no placeholder `src/` entry. A support helper is introduced only if more than one spec actually shares it.

## 4. Dependency direction

The intended direction is:

```text
shared
  ↓
config / protocol / connection
  ↓
transport / worker / page
  ↓
wws public facade
```

The following constraints are normative:

- `connection` MUST NOT import `page` or `worker`.
- `shared` MUST NOT import another core feature directory.
- `worker` MAY depend on connection, protocol, config, transport primitives, and shared modules.
- `page` owns page lifecycle and public client behavior.
- `wws` owns browser environment detection, Worker construction, fallback selection, and public exports.
- docs MUST consume public `wws` entry points, not private core internals.
- test-only dependencies, including `ws` and `@types/ws`, MUST remain in `packages/test`.

## 5. Path migration

| Existing path | Target path |
| --- | --- |
| `core/src/connection-controller.ts` | `core/src/connection/controller.ts` |
| `core/src/connection-state.ts` | `core/src/connection/state.ts` |
| `core/src/reconnect.ts` | `core/src/connection/reconnect.ts` |
| `core/src/heartbeat.ts` | `core/src/connection/heartbeat.ts` |
| `core/src/queue.ts` | `core/src/connection/queue.ts` |
| `core/src/backpressure.ts` | `core/src/connection/backpressure.ts` |
| `core/src/revision.ts` | `core/src/connection/revision.ts` |
| `core/src/config.ts` | `core/src/config/normalize.ts` |
| `core/src/page-client.ts` | `core/src/page/client.ts` |
| `core/src/protocol.ts` | `core/src/protocol/adapter.ts` |
| `core/src/direct-transport.ts` | `core/src/transport/direct.ts` |
| `core/src/shared-worker-transport.ts` | `core/src/transport/shared-worker.ts` |
| `core/src/socket.ts` | `core/src/transport/socket.ts` |
| `core/src/control.ts` | `core/src/worker/control.ts` |
| `core/src/worker-runtime.ts` | `core/src/worker/runtime.ts` |
| `core/src/{bytes,constants,errors,structured,types}.ts` | `core/src/shared/` |
| `wws/src/inline-worker-entry.ts` | `wws/src/worker/entry.ts` |
| `wws/src/inline-worker-source.generated.ts` | `wws/src/worker/source.generated.ts` |
| `docs/{content and .vitepress}` | `docs/site/` |
| `docs/playground.md` | `docs/site/playground.md` |
| `docs/.vitepress/theme/components/playground/*` | `docs/site/playground/{components,composables,workers}/` |
| `test/e2e/playground.spec.ts` | `test/e2e/specs/playground.spec.ts` |
| `test/scripts/verify-release.mjs` | `test/release/verify-release.mjs` |

The exact existing WebSocket server filename is retained while moving it into `test/server/`.

## 6. Compatibility requirements

These public imports MUST remain valid and equivalent:

```ts
import { createWebSocket } from 'wws'
import { rawProtocol } from 'wws/protocol'
import { exposeSharedWebSocketWorker } from 'wws/worker'
```

The npm package name remains `wws`. Export maps, emitted declarations, inline Worker behavior, `CONTROL_PROTOCOL_MAJOR`, error codes, API names, defaults, and TypeScript inference MUST NOT change as part of the refactor.

## 7. Generated and ignored output

- `packages/wws/src/worker/source.generated.ts` is generated by the existing inline Worker build script and is committed.
- `packages/docs/site/api/generated` is generated by TypeDoc and is committed.
- VitePress cache and build output remain ignored and MUST resolve under `packages/docs/site/.vitepress/`.
- Build configuration, documentation links, release verification, and Playwright web-server commands MUST contain no stale source paths.

## 8. Out of scope

- Renaming `docs/planning` or `docs/review`, or rewriting historical links.
- Modifying `docs/review/1.md` or `docs/review/2.md`.
- Splitting `shared/types.ts` by type category without a concrete ownership problem.
- Adding feature barrels, a separate playground package, architecture enforcement dependencies, or new runtime abstractions.
- Any protocol, API, lifecycle, reliability, or dependency change unrelated to moved paths.

## 9. Acceptance gates

The refactor is complete when:

1. The target source trees are present and the old source paths are absent.
2. Repository search finds no stale operational references to old paths, excluding immutable historical review evidence and generated source links that TypeDoc will replace.
3. Public entry points and the packed consumer verification are unchanged in behavior.
4. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:check`, `pnpm release:verify`, and `git diff --check` pass.
5. `pnpm test:e2e` passes in Chromium, Firefox, and WebKit.
6. A final code review finds no dependency inversion, accidental public export change, stale generator path, or unowned file introduced by the migration.
