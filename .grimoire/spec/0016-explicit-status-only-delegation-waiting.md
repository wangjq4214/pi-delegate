# Explicit status-only delegation waiting

**Spec ID:** 0016
**Status:** Implemented
**Date:** 2026-10-25
**Sources:** Accepted refinement handoff H1–H3 below; [ADR 0029](../adr/0029-explicit-waiting-with-status-only-responses.md); existing discovery and result-retrieval contracts.

## Accepted contract and source boundary

- **H1 — Purpose and payload:** The user selected the first delegation roadmap candidate, then narrowed it to “只有状态就够了吧 这就是让主agent等等就够了吧？” The accepted responsibility split is `delegate_wait` for waiting and status, and existing `delegate_status` for reports. Do not attach report bodies to wait responses, add a separate lightweight-query mode or revision/cursor protocol, or promise those capabilities later.
- **H2 — Confirmed wait rules:** The coordinator proposed one or more exact taskIds; default return when any selected task ends, with an option to wait for all; failure/cancellation also count as ending. Default timeout is 30 seconds, maximum 120 seconds; timeout returns current state without cancelling tasks. Already-ended tasks participate immediately; unknown IDs error; cancelling a wait does not cancel background tasks; scope invalidation ends obsolete waits using existing cleanup boundaries. The user accepted with “可以”.
- **H3 — Endpoint and permissions:** The user selected one spec. No tickets, implementation plan, production/test changes, implementation or QA execution are authorized at this endpoint. Draft only settled requirements and established choices; return any new material semantic gap to refinement rather than inventing a rule.
- **A — Existing policies:** [ADR 0016](../adr/0016-unified-scope-local-task-discovery.md) and [spec 0009](./0009-task-listing-details-and-floating-panel.md) establish both-mode discovery, exact identity, scope-local records, background-only independent controls and consumption-free observations. [ADR 0021](../adr/0021-query-only-background-result-retrieval.md) supersedes their historical automatic-delivery clauses: no unsolicited background completion messages or idle-parent wake-up. [ADR 0029](../adr/0029-explicit-waiting-with-status-only-responses.md) records the status-only waiting boundary.
- **L — Inspected surfaces:** [tasks.ts](../../packages/pi-delegate/src/tasks.ts) owns shared records, snapshots, subscriptions and generation invalidation; [delegate.ts](../../packages/pi-delegate/src/delegate.ts) wires registration, queries, execution owners and accounting; [background.ts](../../packages/pi-delegate/src/background.ts) owns accepted background execution and cleanup; [task-query.ts](../../packages/pi-delegate/src/task-query.ts) currently projects full results; [inheritance.ts](../../packages/pi-delegate/src/inheritance.ts) excludes delegation-management capabilities from children. These sources establish integration constraints, not implemented wait behavior or new host-version verification.

The broader [roadmap candidate](../../packages/pi-delegate/docs/roadmap.md#1-explicit-waiting-and-incremental-queries) is not an additional requirements source: H1 deliberately narrows this increment to waiting. Existing behavior remains authoritative where this additive contract does not change it.

## Requirements

### R1 — Explicit waiting over selected tasks

- Add a parent-only tool named `delegate_wait`, accepting one or more exact taskIds in the current session/branch ownership scope. It observes already-accepted tasks; it does not create or restart work.
- Support both synchronous and background records, as existing listing/detail queries do. Waiting on a synchronous record does not extend its lifetime or transfer cancellation from its initiating invocation.
- Default to returning when **any** selected task has ended; allow an explicit **all** condition requiring every selected task to have ended.
- Use the existing terminal outcomes `completed`, `incomplete`, `failed` and `cancelled`. Each satisfies the ended condition; `completed` is not requirements acceptance. Queued, initializing, running or cancellation-in-progress without an available terminal result does not satisfy it.
- Evaluate already-terminal records immediately. Under any, an already-terminal selected task satisfies the condition without waiting for another completion; under all, wait only while selected records remain nonterminal.
- Fix the selected task set for the invocation. New tasks and unrelated record updates do not change that set or satisfy its condition. Concurrent completions must not be lost between initial observation and continued waiting.

**Trace:** H1–H2; A/both-mode scope and status meanings; L/tasks and execution publication.

### R2 — Bounded wait, not an execution budget

- Allow a caller-selected finite wait duration in seconds, defaulting to **30 seconds** and permitting no more than **120 seconds**. Reject invalid timeout values rather than silently accepting an unbounded wait or increasing the ceiling.
- Measure the timeout for this waiting invocation, independently of child task-running time. Waiting while selected tasks are queued or initializing consumes the wait timeout too.
- Return when the requested condition is observed or the timeout expires. Timeout returns currently observed task statuses and explicitly identifies timeout as the reason; it is not a task failure or cancellation.
- Reaching timeout must not cancel, steer, restart, remove or change the budget/pressure of selected tasks. A later wait may observe the same tasks again.

**Trace:** H2; ADR 0029/observation-only ownership.

### R3 — Return status, retrieve reports separately

- A successful wait or timeout response identifies why it returned and the selected tasks' exact IDs and observed statuses. Keep the response scoped to the selected tasks, not the complete task history.
- Keep wait outcome distinct from task outcome: an ended failed/cancelled/incomplete task can satisfy the wait condition without claiming task success; a timeout can leave tasks running.
- Include no child result bodies, partial reports, startup diagnostic bodies, task/context bodies, raw thinking, tool arguments/outputs or execution transcripts in the wait response, including any structured tool-result details.
- Report retrieval remains an explicit subsequent `delegate_status` call. Waiting does not mark a report read, consume/delete it or change retention. Existing full-query defaults, result formatting and available diagnostics remain unchanged.
- This contract specifies the observable information, not exact parameter/property spellings beyond the tool name. Clear descriptions must expose any/all behavior, timeout defaults/ceiling and the status-only/report-retrieval split to the parent model.

**Trace:** H1–H2; ADRs 0021 and 0029; L/task-query existing full-result projection.

### R4 — Identity, cancellation and scope lifetime

- Validate selected IDs against current-scope records. Unknown, foreign or already-invalidated IDs fail explicitly; do not silently drop invalid IDs and wait on a different subset. Display labels or abbreviated IDs do not substitute for exact taskIds.
- Aborting the waiting invocation ends that wait and releases its observation resources. It must not abort accepted background tasks. Preserve synchronous initiating-call cancellation separately.
- Session/branch invalidation, reload or shutdown ends obsolete waits promptly through the established scope boundary, rather than leaving them until timeout or attaching them to a replacement scope. Report invalidation/cancellation distinctly from a satisfied condition; do not fabricate old or destination task state.
- Existing lifecycle invalidation may cancel and clean up tasks through their owners. The wait's observation-only rule does not prevent that existing cleanup or attribute it to cancelling the wait.
- Release wait-owned subscriptions, timeout handles and abort listeners on every exit, including immediate satisfaction, validation failure, timeout, cancellation, invalidation and completion races. Multiple concurrent waits observe independently; ending one does not dispose another or change execution admission.

**Trace:** H2; ADRs 0016, 0021 and 0029; L/records, background ownership and registration lifecycle.

### R5 — Preserve delegation boundaries

- The new management tool must remain unavailable to reconstructed child agents through registration, discovery, inherited active tools or nested access, consistently with the existing delegation tool set.
- Waiting acquires no child execution/admission lease and does not own RPC, task controllers or process cleanup. It observes the same records as existing queries, without a second task/execution store.
- Do not add top-level consumption charges or duplicate existing synchronous/background usage accounting for waits. Background completion remains silent/query-only; an explicit wait returning is not an unsolicited completion message or automatic wake-up.
- Preserve existing `delegate`, list/status, cancellation, steering, result retention and task-panel behavior. No Open TUI dependency or new task-panel behavior is required.
- Update parent-facing tool descriptions and relevant package usage guidance to describe explicit waiting and separate report retrieval without claiming automatic completion delivery or new host-version compatibility.

**Trace:** H1; A/existing ownership, parent-only and query-only policies; L/inheritance, execution and query seams.

## Solution

Expose a bounded, cancellable observation over the existing scope-local task records. Return only status information when the selected terminal condition is satisfied or waiting expires; use existing detail queries for reports. Keep execution, cleanup, admission and accounting with their existing owners. Module layout and exact wire-field names are implementation details, not new requirements.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Parent invocation | Registered `delegate_wait` → current-scope observation | Exact selected IDs, any/all condition, timeout, invocation cancellation | Validated bounded waiting; explicit return reason and selected task statuses, no report bodies |
| Task observations | Existing acceptance/progress/terminal publication → wait condition | Shared record identity, current status and available terminal result | Consistent initial and subsequent checks; no missed terminal transition or dependency on TUI mounting |
| Lifetime | Scope invalidation and invocation abort → active waits | Originating scope identity and cancellation boundary | Obsolete waits end and dispose their own resources, without taking over execution cleanup |
| Report retrieval | Wait response → existing `delegate_status` | Exact taskId when the parent wants a report | Existing retained result/diagnostic access, unchanged defaults and accounting |
| Child reconstruction | Parent management-tool registration → inheritance exclusion | New management tool identity | Wait capability remains parent-only, with existing child-tool inheritance preserved |

## End-to-End Tests

These are future acceptance scenarios, not executed tests.

### T1 — Wait once, then explicitly retrieve the report (R1–R3, R5)
- **Given:** A supported long-lived parent session and a controlled background task with recognizable report text.
- **When:** The parent invokes `delegate_wait` without condition/timeout overrides and the child ends before the default timeout, then calls `delegate_status`.
- **Then:** Waiting returns on the default any condition with correct ID/status and return reason, without the report in text or structured details. The explicit status query returns the retained report. No automatic message/wake-up or duplicate usage charge occurs.

### T2 — Any/all, initial terminal states and terminal outcomes (R1, R3)
- **Given:** Selected synchronous/background records covering queued, initializing, running and terminal states, with completed/incomplete/failed/cancelled outcomes.
- **When:** Any/all waits run with an initially terminal record, a mix of terminal and active records, and controlled concurrent completions; an unrelated task also ends.
- **Then:** Any can return immediately for an already-terminal selected record; all waits for every selected record. Each terminal outcome counts, cancellation-in-progress alone does not, and unrelated completion cannot satisfy the condition. Returned status snapshots match the selected IDs; synchronous invocation ownership is unchanged.

### T3 — Default/custom timeout without task cancellation (R2–R3)
- **Given:** Selected work held in queue/initialization/execution past the wait deadline.
- **When:** The parent waits with the default 30-second timeout and valid custom timeouts including the 120-second ceiling, then later queries or waits again. Invalid values are submitted separately.
- **Then:** Each wait times out with current statuses and a distinguishable timeout reason, without affecting task state or budgets. Later observation still works. Malformed/nonfinite/over-ceiling values fail without starting a wait. Controlled clock tests may verify long deadlines without wall-clock sleeps.

### T4 — Exact IDs and no silently reduced set (R1, R4)
- **Given:** Valid selected tasks plus an unknown/foreign/old-scope ID, including a case where a valid selected task is already terminal.
- **When:** The parent submits the mixed selection or an invalid empty selection.
- **Then:** The request fails explicitly rather than reporting success for just the valid subset or creating work. Numeric labels/abbreviations do not resolve as exact IDs; existing tasks remain unaffected.

### T5 — Abort, independent concurrent waits and lifecycle invalidation (R4–R5)
- **Given:** Two waits over active background work and controlled scope/session/reload/shutdown boundaries.
- **When:** One waiting invocation is aborted; in a separate case its originating scope is invalidated while waiting, including races with task completion and timeout.
- **Then:** Aborting one wait leaves the other wait and accepted background work intact. Scope invalidation ends old waits without migrating them to destination records, while existing owners perform their normal cleanup. Every exit releases wait-owned resources once and cannot later publish another result.

### T6 — Public-tool and parent-only integration (R3, R5)
- **Given:** A real supported Pi parent runtime, deterministic child fixtures, full/truncated/failure reports and reconstructed children with discovery/nested-tool access.
- **When:** The parent waits and retrieves results; children attempt to discover or invoke waiting; existing list/status/control flows are exercised.
- **Then:** Waiting works without TUI mounting, leaks no reports through either result channel, adds no execution lease/consumption charge and remains unavailable to children. Existing query output, control ownership, retained results and query-only completion remain compatible.

## Decisions

- **Status-only wait, separate report retrieval:** H1 and ADR 0029; waiting solves polling, not report delivery. The user rejected adding more query mechanisms to solve this bounded need.
- **Default any, optional all; 30-second default/120-second ceiling:** H2's explicit recommendation and user confirmation. These are task-contract values, not new execution budgets.
- **One spec, no slice or implementation plan:** H3; the feature shares one identity/observation/lifecycle contract and needs no separate delivery coordination at this endpoint.

## Test Plan

Use focused observation/clock tests for terminal-condition and deadline boundaries, plus actual-host public-tool integration using deterministic local providers and gated children. Cover initial-check/subscription, completion/timeout/abort/invalidation races and resource disposal. Extend affected registration, task-record, lifecycle, inheritance and query/accounting regressions; test both source and built entry where the existing harness supports them. Verify docs and parent-visible tool descriptions against the implemented interface. This spec stage runs no tests and establishes no new terminal, provider-service or host-version compatibility evidence.

## Out of Scope

- Lightweight-detail-query modes, revision/cursor queries, event timelines, live output streaming, and future commitments to add them.
- Returning child report bodies from waiting, automatic completion notifications or idle-parent wake-up.
- Execution control through waiting, new budgets/pressure policies, retries, continuation/resume, recursive delegation or workflow scheduling.
- Cross-session persistence, resurrecting invalidated IDs, changing record retention, new TUI panels or Open TUI changes.
- Tickets, implementation planning, production/test changes, execution and QA at this endpoint.

## Implementation authorization and evidence (2026-10-25)

After the spec-only refinement endpoint above, the user explicitly invoked `grimoire-loop`, authorizing implementation and enabled verification. The earlier phase's no-code/no-QA exclusions remain historical endpoint restrictions, not prohibitions on that subsequent invocation. Feature scope is unchanged.

The loop used implement → test → inline review/check → integrated verification and formatting, without a separate plan or ticket set. `src/task-wait.ts` owns bounded observation over existing records; registration and child exclusion are additive. The wire fields are `taskIds`, `condition` and `timeoutSeconds`; responses contain `reason` and `tasks[{taskId,status}]` only. Positive fractional timeouts are supported, duplicate IDs count once, and cancelled/invalidated waits return empty task snapshots.

| Criterion | Evidence |
| --- | --- |
| R1: selected tasks, any/all and all terminal outcomes | Deterministic task-wait tests; real RPC with pending synchronous/background tasks and already-cancelled queued work |
| R2: bounded independent timeout | Controlled-clock tests for the 30-second default, fractional waits and 120-second ceiling; actual-host timeout without stopping children |
| R3: status-only payload and separate reports | Exact text/details projection assertions, failed-task public wait, retained full-query report/usage checks and direct parent-model invocation |
| R4: identity, abort, races and invalidation | Unknown/mixed-ID tests; independent waits, cleanup, completion/timeout/abort/invalidation races; registration hooks for before-tree, committed tree, shutdown and session-start invalidation |
| R5: unchanged ownership/accounting and parent-only access | Existing regression suite; inheritance validation and actual children attempting direct, tool-search and codemode access; updated paired READMEs and usage/runtime/roadmap |

Verification on Bun 1.4.1 / Node 24.22.1 with pinned Pi 1.1.0:

- Root `bun run check`, `bun run typecheck` and `bun run build`: passed.
- Root `bun run test`: passed across repository tests and all workspaces; delegate reported **684 pass, 1 POSIX-only skip, 0 fail**.
- Built entry: `PI_DELEGATE_TEST_ENTRY="$PWD/dist/index.js" bun test ./tests/task-center.integration.test.ts ./tests/delegate.integration.test.ts` from the delegate package: **36 pass, 0 fail**.
- After strengthening the task-center fixture to actively test child direct/search/codemode exclusion, refreshed root check/typecheck, the affected four-file source subset (**89 pass, 0 fail**) and the built task-center scenario (**1 pass, 86 assertions, 0 fail**). Production code and other test suites were unchanged by that fixture-only addition.
- Full changed-source/test/document inspection and inline review/check: no confirmed blockers or outstanding scoped requirements; `git diff --check` passed.

This establishes automated local behavior, not external model-service, new host-version, real-terminal/fullscreen or IME compatibility. No UI behavior was added and no such manual acceptance is claimed. No Git staging, commit, release or package publication was performed.
