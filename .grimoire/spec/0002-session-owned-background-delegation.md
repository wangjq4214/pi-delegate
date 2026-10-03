# Session-owned background delegation

**Spec ID:** 0002
**Status:** Implemented
**Date:** 2026-10-03
**Sources:** User request for nonblocking background agents and completion delivery; user confirmation of the initial defaults and all four boundary recommendations during refinement; [ADR 0002](../adr/0002-session-owned-background-delegation.md); unchanged RPC/inheritance contracts in [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md) and [spec 0001](./0001-rpc-subagent-delegation.md).

## Requirements

### R1 — Opt-in execution and synchronous compatibility

- Preserve synchronous delegation as the default. Existing task/context calls continue to wait for final child results, propagate call cancellation, and retain their output and usage behavior.
- Explicitly opting into background execution returns a task identifier without waiting for the child's final answer. The parent can proceed with unrelated work while the child runs.
- A background acknowledgement identifies accepted background work, not successful child completion. Startup, inheritance, RPC, and model failures must remain explicit outcomes rather than successful task results.
- Exact option and task-management tool names are implementation details. `background: true` is an illustrative interface, not a fixed schema.

**Trace:** ADR 0002, initial Decision; existing synchronous implementation in `src/delegate.ts` and `src/output.ts`.

### R2 — Unchanged child and inheritance boundaries

- Each task uses a fresh Pi RPC child/session, with explicit task text and optional supplementary context rather than automatic full-parent-conversation copying.
- Preserve conventional tool/configuration reinitialization, parent activation/discoverability state, and explicit failure for unreconstructible tools. Do not introduce parent-proxied tool execution.
- Delegation and its background task-management capabilities remain parent-only and unavailable to launched children, including through discovery or nested tool execution.

**Trace:** Unchanged decisions carried forward by ADR 0002 from ADR 0001 and spec 0001's Parent-only delegation and Tool inheritance contracts.

### R3 — Model-visible completion delivery

- Deliver the task identifier, terminal status, and available result to the originating parent agent. A UI-only notification does not satisfy delivery.
- If the parent is busy, queue completion as follow-up work without interrupting its current work. If the parent is idle, automatically trigger a turn to process completion.
- Distinguish `completed`, `incomplete`, `failed`, and `cancelled`; report non-success outcomes as well as success. Preserve the distinction between generation-length incompleteness and presentation truncation, and provide available diagnostics/partial output rather than claiming success.
- When the existing result representation supplies a full-output file path, expose that path with the result so the parent can retrieve the full text.

**Trace:** ADR 0002, initial Decision; existing status and output representation in `src/delegate.ts`, `src/output.ts`, and `README.md`.

### R4 — Queryable task state and results

- The parent can query status and available results by the returned task identifier within the originating task-ownership scope.
- Clearing the host's queued completion message must not discard the task result; querying the task remains a way to obtain its status/result without depending on that message being processed.
- Status before completion must not be represented as a completed final answer. Queryable results and completion messages refer to the same task and outcome.

**Trace:** ADR 0002, Boundary decisions confirmed on 2026-10-03, result-query recommendation accepted by the user.

### R5 — Cancellation ownership

- Accepted background work belongs to its originating session/runtime rather than its initiating parent turn. Ordinary parent-turn completion or cancellation does not automatically cancel it.
- Provide explicit cancellation by task identifier. Cancelling an active background task terminates its child, releases owned execution resources, and reports cancellation rather than success.
- Synchronous cancellation remains tied to the synchronous delegation call as before.

**Trace:** ADR 0002, initial Decision; unchanged synchronous cancellation in spec 0001.

### R6 — Teardown and branch isolation

- On Pi exit, session replacement, or extension reload, cancel owned background tasks and clean up owned execution resources. Do not migrate tasks into a replacement runtime or deliver their results there.
- Navigating through `/tree` to another branch cancels current background tasks. Their completion must not trigger work in the destination branch.
- Completion racing with shutdown, reload, replacement, or branch change must respect these ownership boundaries; cleanup must not wake a closing runtime or inject old-scope results into a new scope.
- Completion and failure also release child-process and initialization resources. Preserve the existing distinction between disposable initialization resources and any full-output file intended for result retrieval.

**Trace:** ADR 0002, initial lifecycle decisions and confirmed branch-navigation boundary; existing resource ownership in `src/delegate.ts` and `src/output.ts`.

### R7 — Nonblocking background UI

- Do not open blocking selection, confirmation, input, or editor dialogs for background children. Return cancellation/refusal for the individual UI request instead.
- Refusing that request does not by itself classify the entire task as cancelled. The child's subsequent execution determines the terminal outcome.
- Existing synchronous UI behavior is unchanged.

**Trace:** ADR 0002, confirmed background-interaction boundary; synchronous UI forwarding in `src/delegate.ts`.

### R8 — Usage transparency

- Preserve available child token/cost usage with the task result.
- This version does not automatically include background usage in Pi's parent-session totals. Clearly disclose this limitation rather than implying that parent totals include background work.
- Synchronous delegated usage accounting remains unchanged.

**Trace:** ADR 0002, confirmed accounting boundary.

### R9 — Supported lifetime

- Support background execution in long-lived TUI and RPC parent sessions. This is asynchronous work within the current Pi session, not a persistent service surviving Pi exit.
- Do not promise background execution in one-shot print/JSON mode.

**Trace:** ADR 0002, initial ownership decision and confirmed parent-mode boundary.

## Solution

Retain the existing fresh-child RPC and inheritance architecture. For an opted-in background call, extension-owned work continues after the initiating tool returns its task identifier. The parent can query or explicitly cancel that work. Child completion is determined from its run outcome, not merely acceptance of an RPC prompt.

Deliver the resulting task status and available output through Pi's model-visible message-injection facility: follow-up delivery when the parent is busy, and turn triggering when it is idle. Result availability for queries is independent of the host completion-message queue. Apply session/runtime and branch ownership to both execution and completion delivery. Background UI requests receive cancellation/refusal rather than modal forwarding.

Local Pi 1.0.0 source inspection supports `ExtensionAPI.sendMessage` with turn triggering and follow-up delivery. Its invocation is not a durable acknowledgement that the model consumed a result; the query fallback addresses a cleared notification queue without promising exactly-once inference. Internal task storage, module organization, and exact public field/tool names are not prescribed.

### Relationship to the existing contract

Spec 0001 remains the implemented synchronous baseline. Its wait-for-completion, no-background-handle, and parent-call cancellation clauses continue to govern synchronous calls. This spec extends those clauses only for explicitly selected background calls under ADR 0002. Fresh sessions, parent-only reachability, tool inheritance, explicit task/context, failure reporting, and owned-resource cleanup remain applicable to both modes. This draft does not claim background behavior is already implemented.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Delegation entry | Parent model → extension | Explicit task/context, mode choice, initiating-call lifecycle | Existing synchronous final result or background task identifier without waiting for a final answer |
| Task query/cancellation | Parent model → background-task owner | Task identifier in originating scope; query or cancellation request | Observable task status, available result/usage, or explicit cancellation and cleanup |
| Child reconstruction and RPC | Task owner → fresh Pi child | Parent tool/config inputs, activation/discoverability, explicit task/context | Validated child capabilities, run outcome and diagnostics; owned child cleanup |
| Completion injection | Task owner → parent Pi runtime/model | Task identity, outcome/output, current parent state and valid ownership scope | Busy-parent follow-up or idle-parent turn trigger with model-visible result |
| Ownership lifecycle | Parent session/runtime and branch events → task owner | Exit/reload/replacement or actual `/tree` branch change | Task cancellation, cleanup, and suppression of delivery into a closing or different scope |
| Background UI | RPC child → extension UI adapter | Selection/confirmation/input/editor request | Individual cancellation/refusal without a blocking parent dialog or forced whole-task cancellation |
| Result/accounting representation | Child result → query/completion surfaces | Available text, diagnostics, usage, truncation/full-output references | Correlated outcome and available data; explicit parent-total accounting limitation |

## End-to-End Tests

### T1 — Parent proceeds before child completion (R1, R2)

- **Given:** A long-lived parent and a background child held before its final answer.
- **When:** The parent opts into background delegation and then performs an unrelated action.
- **Then:** The initiating call returns a task identifier and the unrelated action proceeds while the child is still pending; acceptance is not reported as successful task completion.

### T2 — Busy-parent follow-up and idle-parent wake (R3)

- **Given:** An accepted background task with an identifiable result, tested once with a busy parent and once with an idle parent.
- **When:** The child completes.
- **Then:** Busy-parent work is not interrupted and the result becomes follow-up model input; the idle parent starts a turn without another user prompt. In each case the parent receives the task identifier, status, and result, not just a UI notification.

### T3 — Terminal outcomes and output representation (R3, R4)

- **Given:** Tasks whose final child outcomes include normal stop, generation length limit, model/RPC failure, and child cancellation.
- **When:** The outcomes are collected and queried/delivered.
- **Then:** They are distinguishable as completed, incomplete, failed, and cancelled, with available output/diagnostics. Prompt acceptance is not success. Presentation truncation does not change a completed generation into incomplete; full-output references remain usable when supplied by the result representation.

### T4 — Query after queued completion is cleared (R4)

- **Given:** A task has completed while its completion message is queued behind parent work.
- **When:** The host clears that queue and the parent queries the returned task identifier in the originating scope.
- **Then:** The completed outcome and available result remain obtainable despite the removed message. Querying before completion does not claim a final answer.

### T5 — Parent-turn cancellation versus task cancellation (R5)

- **Given:** An accepted background task that is still running.
- **When:** The parent finishes or cancels an ordinary turn; in a separate run, the parent explicitly cancels the task by identifier.
- **Then:** The first task remains running and can produce a result. Explicit task cancellation terminates its child, cleans owned execution resources, and reports cancellation to the still-valid originating scope.

### T6 — Teardown and completion races (R6)

- **Given:** Running background work in an originating runtime, including a controlled completion race.
- **When:** Pi exits, reloads extensions, or replaces the session.
- **Then:** Owned children and initialization resources are cleaned up; completion does not wake a closing runtime, migrate the task, or inject the old result into a replacement runtime.

### T7 — Branch navigation isolation (R6)

- **Given:** Background work started in the current branch, including completion concurrent with navigation.
- **When:** `/tree` navigates to another branch.
- **Then:** Current background work is cancelled/cleaned up, and its old-branch completion does not trigger destination-branch work.

### T8 — Background dialog refusal is not whole-task cancellation (R7)

- **Given:** A background child that requests selection, confirmation, input, or an editor and can handle the refused request.
- **When:** The request reaches the parent extension.
- **Then:** No blocking dialog is opened; the individual request receives cancellation/refusal. A child that continues successfully may still produce a completed task rather than being automatically classified as cancelled.

### T9 — Available usage and disclosed totals (R8)

- **Given:** A background child with known available token/cost usage.
- **When:** Its result is queried or presented.
- **Then:** The task result preserves that usage and discloses that Pi parent-session totals do not automatically include background usage. Existing synchronous usage behavior remains unchanged.

### T10 — Synchronous and child-boundary regression (R1, R2, R7, R8)

- **Given:** Existing synchronous calls and representative reconstructible active/deferred tools.
- **When:** Delegation runs without background opt-in, and when a background child inspects or discovers available tools.
- **Then:** Synchronous calls still wait, return their existing output/usage, propagate cancellation, and retain UI behavior. Children retain the inheritance contract and cannot reach delegation or its task-management capabilities; unreconstructible inheritance fails explicitly.

### T11 — Long-lived parent modes (R9)

- **Given:** A real Pi long-lived TUI parent and, separately, a real Pi long-lived RPC parent.
- **When:** Background work is accepted, the initiating parent turn settles, and the child subsequently completes.
- **Then:** Work survives ordinary turn settlement, and completion follows the busy/idle policies in each supported parent mode without requiring another user prompt.

## Decisions

- **Choice:** One spec with no tickets/slice. **Source:** User-selected spec-only endpoint; one feature shares a task lifecycle and delivery contract.
- **Choice:** Retain synchronous default with explicit background opt-in and session-owned work. **Source:** ADR 0002, initial Decision and user confirmation.
- **Choice:** Model-visible follow-up/wake behavior, result query fallback, separate available usage, background dialog refusal, branch cancellation, and long-lived TUI/RPC support. **Source:** ADR 0002 and the user's acceptance of all four boundary recommendations.
- **Choice:** Preserve RPC, fresh sessions, conventional inheritance, and parent-only reachability. **Source:** ADR 0002's scoped supersession of ADR 0001.

## Test Plan

- Use controlled child fixtures to hold settlement until after the parent acknowledgement and unrelated action. Check event ordering rather than inventing a latency threshold.
- Exercise startup/initialization failures, RPC process exit, model error, length-limited output, cancellation, and presentation truncation using existing fixture patterns in `tests/delegate.test.ts`, `tests/rpc.test.ts`, and `tests/output.test.ts`.
- Extend real Pi integration evidence for busy/idle completion, queue clearing/query recovery, ordinary parent abort, explicit cancellation, and teardown/branch races. Unit mocks of `sendMessage` alone do not establish delivery to the model or turn triggering.
- Verify all background UI request kinds and a child that continues after refusal. Re-run existing registration, inheritance, synchronous result/usage, and cleanup regression coverage.
- Verify TUI behavior as well as RPC behavior in the supported Pi 1.0.0 host. Record the actual host/version and evidence; existing synchronous tests do not establish background compatibility or compatibility with every Pi version.

## Out of Scope

- Persistent background execution after Pi exit or task migration/recovery across session replacement or extension reload.
- Promised background execution in one-shot print/JSON parent mode.
- Automatic inclusion of background usage in Pi's parent-session totals for this version.
- Blocking background child dialogs, child-session reuse, automatic full-parent-transcript transfer, or parent-proxied inherited tool execution.
- Exactly-once model processing or durable host acknowledgement of completion messages; cleared-message recovery is through task queries in the originating scope.

## Contract Boundaries

No unresolved blocking behavioral choice remains from the confirmed refinement. Exact option/tool names, internal task representation, and module layout remain implementation details, not unconfirmed requirements. The selected endpoint is this requirements draft only; no implementation or background verification has been performed.

## Implementation Verification (2026-10-03)

The Contract Boundaries paragraph above describes the original spec-only refinement stage. The user subsequently invoked `grimoire-loop`, authorizing planning, implementation, test authoring/execution, review/check, related fixes, final verification and formatting. Background behavior is now implemented; this dated section records the execution evidence without changing the original requirements.

Implementation: `src/background.ts` owns scope-local task IDs/controllers/results and pending delivery; `src/delegate.ts` adds `background: true`, `delegate_status`, `delegate_cancel`, model-visible completion and lifecycle hooks; `src/inheritance.ts` excludes all three parent-only capabilities from children. README documents the interfaces, cancellation and accounting limitations.

| Requirements | Evidence |
| --- | --- |
| R1, R3, R4, R5, R7, R8 | `tests/background.integration.test.ts`: real Pi RPC parent/children prove early acknowledgement, unrelated parent work, busy/idle model consumption, query recovery, parent abort versus explicit cancellation, individual modal refusal and separate usage totals |
| R2 | `tests/inheritance.test.ts`, actual background child registry inspection, and unchanged real inheritance/MCP/codemode regressions in `tests/delegate.integration.test.ts` |
| R3 terminal result/output representation | `tests/background.test.ts` plus unchanged runner/output tests in `tests/rpc.test.ts`, `tests/output.test.ts` and `tests/delegate.integration.test.ts`; evidence composes the registry with its unchanged execution/formatting boundary |
| R6 | `tests/background.lifecycle.test.ts`: actual SDK reload, runtime newSession/dispose, and acceptance during gated asynchronous tree navigation; registry tests cover completion/invalidation ordering |
| R9 | `tests/background.tui.test.ts`: actual Pi SDK `bindExtensions({mode: "tui"})`, gated RPC children, busy-parent ordering and idle automatic model turn; RPC mode verified separately; print/JSON rejection in registry/tool tests |

Read-only review/check initially reproduced two defects: delivery stranded after eventless idle transitions, and tasks accepted during asynchronous navigation surviving branch commit. Fixes add pending-delivery retries and navigation-commit invalidation. Real RPC abort/clear_queue and actual SDK navigation-window regressions pass; follow-up review/check found zero confirmed blockers.

Final post-format checks: `bun test` (86 passed, 0 failed, 701 assertions), `bun run typecheck`, `bun run check`, and `git diff --check` passed on Bun 1.4.1 / Pi 1.0.0. Tests use local deterministic providers and isolated real processes, without external model credentials or service requests.

Limits: TUI evidence exercises the real runtime API, not InteractiveMode terminal rendering/keyboard/picker E2E. The exact manual-compaction/late-handler sequence is covered by source tracing and event-independent delivery retry evidence, not a dedicated real-host automated compaction test. No compatibility claim beyond the verified host version, no persistent task service, and no exactly-once model-processing guarantee is added.
