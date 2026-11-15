# pi-goal

Coordinate bounded goals through fresh pi-delegate workers, with durable progress and mandatory independent completion review.

The parent discusses the objective, plans work, and assesses evidence; delegate executes bounded work and a separate reviewer checks completion. Inspired by [pi-goal-x](https://github.com/tmonk/pi-goal-x), not a port of its runtime or project-local storage.

This is a **private local workspace package**, not yet included in npm/tag publishing. Both goal and delegate must be loaded in the same parent session; installing an npm dependency does not automatically load its Pi extension.

## Features

- **Conversational creation:** describe an objective in natural language, clarify acceptance conditions with the current parent, and authorize the displayed draft through native Start/Cancel confirmation.
- **Bounded continuation:** explicitly supply a finite allowance shared by coordinator, worker, and reviewer dispatches; no numeric default or automatic replenishment.
- **Evidence-based progress:** keep logical work items distinct from execution attempts; worker completion alone is not acceptance.
- **Independent completion review:** a fresh reviewer must approve the current objective and evidence before the goal completes.
- **Global persistence and deliberate recovery:** save goal-specific JSONL records under the global Pi agent root; resume explicitly after inspecting actual effects.
- **Shared delegate runtime:** use delegate's supported public API, admission, task records, cancellation, and usage accounting instead of another executor.

## Requirements

- Git and Bun 1.4.1 or later for local setup.
- Node.js 22.19 or later; `node` must be available on `PATH` when a Bun-hosted Pi launches delegate children.
- A compatible Pi host. Current implementation evidence targets Pi 1.1.0; other host versions are not currently verified.
- Both workspace extensions, plus a dialog-capable TUI or participating RPC client for creation confirmation.

## Local setup

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/pi-delegate build
bun run --cwd packages/pi-goal build
```

Start Pi in the project you want to work on, loading both extensions (replace the checkout path):

```sh
pi -e /absolute/checkout/packages/pi-delegate/dist/index.js -e /absolute/checkout/packages/pi-goal/dist/index.js
```

For source development, load both `src/index.ts` paths instead. Build delegate first even for source loading because goal imports its supported public `/api` package entry. Co-loading order does not matter once extension loading is complete; avoid loading installed and explicit copies of the same extension together.

See the [development guide](docs/development.md) for source-loading examples, checks, test coverage, and repository layout. There is no published goal installation command yet.

## Commands

Begin a goal discussion while the parent is idle:

```text
/goal Fix the parser regression, add a reproduction test, and keep the parser tests passing. Allow at most 12 goal dispatches.
```

The parent organizes the objective and acceptance conditions, asking about necessary ambiguity or missing information. If an allowance is missing, supply it in a follow-up. Draft discussion is ordinary chat, not goal-authorized execution. Only choosing **Start** in the native selection authorizes the displayed objective, conditions, allowance, and cwd; chat assent or model-generated approval is not a substitute.

```text
/goal status
/goal list
/goal status <goal-id>
/goal pause
/goal resume <goal-id> 8
```

The numbers are examples, not defaults. Status/list show readable native notifications: saved-goal summaries retain exact IDs and working directories, and status details explain item acceptance, dispatch allowance, stop/recovery reasons and independent review. A saved `active` status is not proof of a live process. Inspection never starts or resumes work; start/resume never silently replaces an active goal, so pause it first. There is no live goal dashboard yet.

The allowance counts goal-initiated coordinator checkpoints, worker dispatches, and independent reviewer dispatches together, not individual within-run host/model/tool turns. It is not an exact token, provider-request, cost, or wall-clock cap. Exhaustion saves progress and pauses without an extra wrap-up. A worker may use the last unit, leaving the goal unfinished because mandatory review cannot run.

See [Usage](docs/usage.md) for the complete command/tool reference, worker options, evidence examples, and troubleshooting.

## Agent tools

The parent receives `goal_propose`, `goal_status`, `goal_plan`, `goal_work`, `goal_accept`, `goal_review`, `goal_reinspect`, and `goal_block`. Goal tools are excluded from delegated children, including discoverable/codemode access.

Workers and reviewers use synchronous calls through the shared delegate runtime. Worker `completed` is only an execution outcome; the parent must assess actual evidence and every item must be accepted before independent completion review. Registered artifacts must be existing regular files, not directories. Review rejection, failure, partial/malformed output, stale evidence, or revoked authority cannot complete the goal.

## Global persistence and recovery

Goal bookkeeping lives under `~/.pi/agent/goals/`, respecting the host-resolved agent root including `PI_CODING_AGENT_DIR`. Journals are goal-specific, not native Pi sessions; no goal metadata or locks are saved in the project or moved by a session-directory override.

After restart or scope invalidation, nothing resumes automatically. Resume from the saved cwd with a finite allowance, inspect current files/tests and previous effects, then record findings through `goal_reinspect` before further work or review. There is no reconnection to dead children, blind task replay, automatic journal repair, or project relocation.

Pause revokes scheduling immediately, cancels only goal-owned children, and waits for delegate cleanup. Edits and external effects remain. Abort, branch navigation, reload, session replacement, and shutdown invalidate live execution, not durable goal records. Ordinary unrelated delegate tasks retain their own ownership and query-only background results.

## Verification and boundaries

Goal does not provide an OS sandbox, enforced read-only review, automatic worktrees/merges, side-effect rollback, general DAG engine, recursive agent teams, or exact provider-billing cap. Saved objectives and criteria are currently immutable; task plans are flat upserts. Proposed additions belong in the [roadmap](docs/roadmap.md), not the current feature list.

Tests use deterministic local providers and isolated temporary user roots. Pinned-host tests do not establish manual terminal keyboard/IME acceptance, live-provider behavior, other host versions, or Windows ACL isolation. See [Testing](docs/development.md#testing) and [Spec 0019](../../.grimoire/spec/0019-bounded-goals-on-delegate.md) for evidence and limits.

## Documentation

- [Usage guide](docs/usage.md) — creation, commands, agent tools, allowance, evidence, recovery, and troubleshooting.
- [Runtime and safety](docs/runtime.md) — shared execution ownership, confirmation, continuation, persistence, review, and cancellation boundaries.
- [Development guide](docs/development.md) — setup, source/built loading, checks, tests, and source ownership.
- [Roadmap](docs/roadmap.md) — prioritized capability candidates, not implemented guarantees or release commitments.

Documentation is maintained in English. Delegate's [public consumer API](../pi-delegate/docs/api.md) documents the integration consumed by goal; goal does not expose a separate supported programmatic API.

## License

[MIT](../../LICENSE).
