# Development guide

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Roadmap](roadmap.md)

## Local setup

Use Git, the workspace's Bun 1.4.1 toolchain, and Node.js 22.19 or later (`node` must be on `PATH` for host tests and delegated children). Goal and delegate pin Pi 1.1.0 as a development dependency. Their wildcard host peer dependencies do not establish compatibility with other Pi versions.

The workspace root is two levels above this package. Shared tooling, Git hooks and `bun.lock` live there; goal retains its own Pi manifest. See the [workspace overview](../../../README.md) and [delegate development guide](../../pi-delegate/docs/development.md).

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
```

Build before testing or loading built entries. Goal imports `@wangjq4214/pi-delegate/api`, which resolves to delegate's generated `dist/api.js`; source loading still needs that dependency built. For a targeted build, build delegate first, then goal:

```sh
bun run --filter @wangjq4214/pi-delegate build
bun run --filter @wangjq4214/pi-goal build
```

`bun run hooks:install` explicitly installs the shared Git hooks. There is no automatic `postinstall` hook. Blocked transitive lifecycle scripts do not need to be automatically trusted for these checks and tests.

## Running the extension locally

Load **both** delegate and goal. Installing an npm dependency makes its code available; it does not load that dependency as a Pi extension.

With Pi CLI available, run from the repository root:

```sh
# Source entries (build delegate's public API first):
pi --extension ./packages/pi-delegate/src/index.ts --extension ./packages/pi-goal/src/index.ts

# Built entries (build both packages first):
pi --extension ./packages/pi-delegate/dist/index.js --extension ./packages/pi-goal/dist/index.js
```

To use the workspace-installed Pi executable instead, these commands run in goal's package directory:

```sh
bun run --cwd packages/pi-goal pi --extension ../pi-delegate/src/index.ts --extension ./src/index.ts
bun run --cwd packages/pi-goal pi --extension ../pi-delegate/dist/index.js --extension ./dist/index.js
```

Pi loads TypeScript directly. Use `/reload` after source changes, or rebuild before reloading built entries. Do not load an installed duplicate alongside an explicit entry. Both co-load orders are covered by host integration tests; listing delegate first makes the dependency visible in local examples.

Goal's `dev` and `start` scripts load only goal's source and built entry respectively. They are not complete two-extension launch commands unless delegate is already loaded through host configuration. The `pi.extensions` manifest entry points to `./dist/index.js`.

Rolldown builds a Node.js ESM extension with a source map and emits `dist/LICENSE` from the workspace license. Node built-ins, Pi host modules and delegate imports stay external. Goal's TypeScript configuration maps delegate's `/api` import to source for type checking; that mapping does not replace the runtime build prerequisite.

### Package and integration boundaries

`@wangjq4214/pi-goal` is a **private local workspace package**. Its version and `files` list do not imply a public release or registry installation workflow. It has no `prepack` or `build:watch` script; do not copy delegate's publishing assumptions here. The private workspace root is not itself a Pi extension package.

Goal has no public programmatic API or exported library subpath. Its source exports are implementation details. In contrast, delegate exposes the supported `@wangjq4214/pi-delegate/api` boundary used by goal to share execution, admission, records and accounting with the loaded delegate extension. Do not replace that boundary with imports of delegate's private executor internals or a goal-owned child runner. See [delegate runtime and safety](../../pi-delegate/docs/runtime.md).

## Development commands

Run these from the repository root. These are contributor commands, not a claim that they have been run for a documentation change.

| Command | Purpose |
| --- | --- |
| `bun run build` | Build all workspace packages sequentially. |
| `bun run --filter @wangjq4214/pi-goal build` | Build goal after delegate's API has been built. |
| `bun run --filter @wangjq4214/pi-goal typecheck` | Type-check goal source and tests. |
| `bun run --filter @wangjq4214/pi-goal test` | Run goal tests from its package directory; build prerequisites first. |
| `bun run check` | Non-writing repository Biome checks; warnings fail. |
| `bun run check:fix .` | Apply safe Biome fixes and organize imports. |
| `bun run format` | Apply repository formatting. |
| `bun run typecheck` | Type-check repository tests and all workspace packages. |
| `bun run test` | Run repository tests and each package's test script. |
| `bun run hooks:install` | Install or update the shared Lefthook hooks. |

Goal has no package-local `check`, `check:fix` or `format` script; use the root scripts. `check:fix` accepts individual paths and does not use `--unsafe`. Bare `bun test` belongs inside `packages/pi-goal`; use the root `test` script for workspace-wide verification.

## Testing

For code changes, a full verification sequence from the root is:

```sh
bun run build
bun run check
bun run typecheck
bun run test
git diff --check
```

Run from an ordinary parent environment, not a delegated child shell with inherited `PI_DELEGATE_CHILD` or `PI_DELEGATE_SNAPSHOT`. For a POSIX shell, the recorded integrated verification uses `env -u PI_DELEGATE_CHILD -u PI_DELEGATE_SNAPSHOT bun run test`; clear those variables using the native shell equivalent elsewhere.

### Test ownership

All paths below are relative to `packages/pi-goal/`:

| File | Main coverage |
| --- | --- |
| `tests/creation.test.ts` | Session-local draft lifecycle, explicit allowance, immutable proposals, runtime approval, invalidation and single-use consumption. |
| `tests/creation.adapter.test.ts` | Extension adapter confirmation, unavailable/failed UI, late callbacks, abort/cwd/lifecycle races, durable activation and initial coordinator admission/accounting; read-only human inspection, structured-result compatibility and storage/error presentation. |
| `tests/creation.host.test.ts` | Actual pinned-host source/built confirmation flows, Cancel/dismissal, changed drafts, pause/abort, and mixed-tool/codemode initial accounting. |
| `tests/controller.test.ts` | Shared finite allowance, work versus acceptance, independent review, artifact changes, cancellation, recovery/reinspection and persistence races. |
| `tests/store.test.ts` | Journal validation, checkpoints, exclusive leases, process-exit recovery, corruption/torn writes, permissions, collisions and storage failures without project-local fallback. |
| `tests/host.integration.test.ts` | Source/built co-loading in both orders, real worker/reviewer execution through the shared public delegate runtime, bounded continuation, global roots and fail-closed integration/storage cases. |
| `tests/host.lifecycle.test.ts` | Owned-child cancellation without cancelling unrelated background work, navigation, shutdown/restart and revocation of pending native boundary continuation. |
| `tests/presentation.test.ts` | Human summaries/details, acceptance/allowance/saved-live semantics, terminal-text safety, and real pinned-host notification wrapping/theme invalidation without manual TUI acceptance. |
| `tests/inspection.host.test.ts` | Actual source/built RPC list/status output without delegate, exact saved lookup, mixed damaged/valid records and no model dispatch or journal mutation. |

`tests/fixtures/host.ts` launches Pi 1.1.0 in RPC mode with isolated temporary home/agent/session roots, explicit extension lists and real fresh child processes. Built-mode cases require existing build output and fail if entries are missing; tests do not build it for you.

`tests/fixtures/host-provider.ts` supplies deterministic local model events without HTTP transport or paid-provider credentials. `host-api.ts` defines the shared API probe; `host-api-source.ts` and `host-api-built.ts` bind it to delegate's source and package `/api` entries. These are fixture extensions, not standalone test files. They exercise integration and child tool exclusion without using the user's goal store.

Changes crossing the delegate boundary also need delegate regressions; goal-only tests do not replace those. See [delegate testing](../../pi-delegate/docs/development.md#testing).

### Verification limits

The [bounded-goals specification](../../../.grimoire/spec/0019-bounded-goals-on-delegate.md) records historical baseline and later conversational-creation evidence separately. Those results are not fresh verification of a later working tree; avoid copying stale test counts into current claims.

Deterministic pinned-host tests verify RPC confirmation payloads/actions, lifecycle behavior and source/built integration. They do **not** establish manual TUI rendering or keyboard/IME acceptance, live-provider interpretation, other host-version compatibility, or Windows ACL privacy. The recorded workspace verification has two POSIX-only permission skips on Windows; goal's store permission case is one of them. A skip is not a passing privacy guarantee.

Goal allowance bounds dispatches, not tokens, cost, provider-request counts or exact process-stop timing. Test success must not be presented as a stronger resource or sandbox guarantee.

Biome does not check Markdown formatting. For documentation-only changes, inspect headings and examples, verify relative links, and run `git diff --check`; a test-suite run is not implied.

## Repository layout

```text
packages/pi-goal/
  README.md                     Goal overview and entry links
  docs/                         Usage, runtime, development, roadmap
  src/index.ts                  Pi extension adapter and lifecycle wiring
  src/creation.ts               Session-local drafts and confirmation authority
  src/controller.ts             Bounded execution and durable state transitions
  src/model.ts                  Goal state types and validation
  src/store.ts                  Global JSONL journals and exclusive leases
  tests/                        Unit, adapter and actual-host tests
    fixtures/                   RPC harness, deterministic provider and API probes
  package.json                  Private Pi workspace manifest
  rolldown.config.mjs            Extension bundle and license emission
  tsconfig.json                 Shared compiler options and delegate API type mapping
packages/pi-delegate/           Shared execution runtime and public /api boundary
.grimoire/                      Requirements and architecture records
package.json                    Root build/check/test orchestration
bun.lock                        Shared dependency lockfile
```

### Goal source ownership

- `index.ts` registers the command and parent-only tools, connects native confirmation and host lifecycle/boundary hooks, and obtains delegate's public client. Delegated children return before registration. Keep host admission wiring here, not in the journal.
- `creation.ts` owns non-persistent draft/proposal identity, immutable displayed values, runtime approval, invalidation and single-use consumption. Model text cannot manufacture user approval.
- `controller.ts` owns run authority, finite dispatch accounting, serialized mutations, work/acceptance/review transitions, artifact checks, stopping and recovery reinspection. Delegate remains the executor.
- `model.ts` defines persisted goal structures and strict validation. Schema changes affect recovery compatibility, not just TypeScript callers.
- `store.ts` owns global journal creation/parsing/checkpoints, durable writes, leases and explicit dead-owner recovery. Storage failures must not silently redirect bookkeeping into the project.

## Documentation changes

Keep contributor workflows here, command/tool details in [usage](usage.md), lifecycle and safety guarantees in [runtime](runtime.md), and proposed work in [roadmap](roadmap.md). Roadmap candidates are not current features. Detailed guides are maintained in English.

Consult relevant `.grimoire/` specifications and architectural decisions before changing behavior or integration contracts. For shared Git-hook behavior and partial-staging caveats, see [delegate's Git hooks guide](../../pi-delegate/docs/development.md#git-hooks).
