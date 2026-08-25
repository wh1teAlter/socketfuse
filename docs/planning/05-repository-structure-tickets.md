# WWS Repository Structure Tickets

- Status: Approved for implementation
- Date: 2026-08-25
- Specification: [WWS Repository Structure Specification](../specs/wws-repository-structure-spec.md)

## Execution rules

- This ticket set changes file ownership and paths only. Runtime semantics and public API are frozen for the duration of the work.
- Complete tickets in order so imports always move toward the final dependency direction.
- Preserve unrelated working-tree changes and do not modify `docs/review/1.md` or `docs/review/2.md`.
- Run a focused typecheck or test after each workspace boundary; run all gates after T005.

## T001 — Reorganize core by runtime ownership

- Dependencies: none.
- Move core implementation and colocated tests into `connection`, `config`, `page`, `protocol`, `transport`, `worker`, and `shared`.
- Update all core-relative imports and the root `src/index.ts` exports.
- Do not add subdirectory barrels or change exported symbols.
- Verify with `pnpm --filter @wws/core typecheck` and `pnpm --filter @wws/core test`.
- Done when the core target tree matches the specification and no old flat module path remains.

## T002 — Separate public facade implementation from exports

- Dependencies: T001.
- Move `createWebSocket` implementation from `packages/wws/src/index.ts` to `src/api/create-websocket.ts`; leave the root entry as public exports only.
- Move inline Worker entry and generated source to `src/worker/`, and update the generator input/output and imports.
- Preserve the `wws`, `wws/protocol`, and `wws/worker` export maps and their symbol sets.
- Verify with both package typechecks and builds.
- Done when the public entry files are declarative boundaries and inline Worker generation succeeds at the new paths.

## T003 — Establish an explicit documentation source root

- Dependencies: T002.
- Move VitePress content and configuration under `packages/docs/site/`.
- Move playground page code out of the global theme into page-owned `components`, `composables`, and `workers` directories.
- Configure all VitePress commands to use `site`; configure TypeDoc output as `site/api/generated`; update TypeScript includes and local links/imports.
- Do not change page content, navigation information architecture, or playground behavior.
- Verify with docs typecheck and build.
- Done when only package/build configuration remains at the docs package root and `/playground` still renders from `site/playground.md`.

## T004 — Make test purposes visible in the test workspace

- Dependencies: T003.
- Move browser specs to `e2e/specs`, the WebSocket fixture server to `server`, and release verification to `release`.
- Update package scripts, Playwright configuration, relative fixture paths, and any repository references.
- Remove the empty `src/index.ts` and the empty `src` directory; do not invent support helpers for a single spec.
- Verify with test-workspace typecheck and release verification.
- Done when every test file's directory states its purpose and all commands resolve their new paths.

## T005 — Regenerate outputs and remove stale references

- Dependencies: T001–T004.
- Regenerate the inline Worker source and TypeDoc Markdown at their final locations.
- Search configs, scripts, Markdown, source, and tests for stale operational paths. Historical review evidence may retain old path mentions; active documentation and generated API links may not.
- Confirm dependency manifests and pnpm catalogs are unchanged unless a moved tool requires a path-only script update.
- Done when the old source directories are absent and repository path checks are clean.

## T006 — Verification and code review

- Dependencies: T005.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:check`, `pnpm release:verify`, `git diff --check`, and `pnpm test:e2e`.
- Review import direction, public export parity, generated source provenance, packed tarball contents, docs routes, Playwright startup, and preservation of unrelated changes.
- Fix every confirmed issue within this specification and rerun affected gates.
- Done when all commands pass and the review has no unresolved findings.
