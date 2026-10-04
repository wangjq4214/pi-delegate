# Concurrency scheduling and delegated cost visibility

**Spec ID:** 0007
**Status:** Draft
**Date:** 2026-10-04
**Sources:** The settled refinement conversation: the user requested a simple concurrent-task limit with waiting tasks and token/cost visibility, accepted the recommended scheduling/accounting/UI scope, and selected the usage format `↑8.2k ↓1.1k R20k W0 · $0.04`. [ADR 0006](../adr/0006-runtime-concurrency-and-delegated-usage.md).

## Source and coordination boundary

- **H-scheduling — Accepted recommendation:** Default concurrency is 4, configurable at startup, with no runtime adjustment in this increment. Synchronous and background delegations share one runtime-local FIFO pool; the parent agent is excluded. Initialization occupies a slot. Queued work does not spawn a child. Release capacity only after owned execution-resource cleanup on every terminal path. Queued work can be cancelled without launching it. Waiting/initialization do not count as task-running time or pressure. Background acknowledgement stays immediate and can report `queued`; synchronous invocation waits through admission and execution. Model/thinking and other invocation inputs remain captured at submission rather than being recaptured after the wait.
- **H-usage — Accepted recommendation:** Show each task's latest reported usage and a current-runtime cumulative delegated total. Include completed, failed and cancelled consumption; terminal-row expiry does not erase the total. Branch navigation cancels/invalidates tasks under the existing ownership contract but preserves already-consumed runtime usage. Session replacement/reload resets the total. Aggregate all available usage-bearing child session records, including auxiliary Pi usage, without counting streaming snapshots, final readback, repeated queries or completion delivery twice. Preserve the boundary from Pi parent-session totals. Only visibility is added, not automatic budget cancellation.
- **H-format — User correction:** Use `↑8.2k ↓1.1k R20k W0 · $0.04` for usage, without the proposed inline `est.` prefix. Input/output mean model tokens, not network bytes; follow Pi's separate input/output/cache categories. Cost remains the host/provider estimate, with estimation and partial/unavailable-data limitations explained in documentation rather than adding `est.` to the compact row.
- **A — Architecture:** [ADR 0006](../adr/0006-runtime-concurrency-and-delegated-usage.md), Proposed, records the shared admission boundary, runner/background/UI ownership, snapshot reconciliation, runtime accumulation and separate accounting. [ADRs 0002](../adr/0002-session-owned-background-delegation.md), [0003](../adr/0003-per-delegation-soft-pressure.md), [0004](../adr/0004-task-addressed-runtime-steering.md) and [0005](../adr/0005-per-task-model-selection.md), Completed, remain applicable.
- **B — Existing contracts:** [Spec 0002](./0002-session-owned-background-delegation.md) supplies background ownership, cancellation, query/completion and separate usage; [spec 0003](./0003-subagent-soft-pressure.md) supplies advisory pressure; [spec 0004](./0004-agent-status-ui.md) supplies visual-only above-input placement, identity, execution time/turns, pressure acknowledgement, theme, width and 5-second terminal retention; [spec 0005](./0005-background-runtime-steering.md) supplies readiness and receipt semantics; [spec 0006](./0006-per-task-model-selection.md) supplies captured and child-confirmed startup configuration and its aligned metadata row.
- **L — Repository evidence:** [src/delegate.ts](../../src/delegate.ts) currently starts both invocation modes without a concurrency admission boundary, sums usage from assistant/tool-result messages, reconciles final entries and retains streaming/tool-result observations on failure. [src/background.ts](../../src/background.ts) owns tasks and results but currently reports every nonterminal task as `running`; usage is exposed with terminal results. [src/status.ts](../../src/status.ts) renders initialization, model/thinking, activity and terminal rows, but has no usage ledger or display. [src/pressure.ts](../../src/pressure.ts) starts its task clock on observed `agent_start`; [src/configuration.ts](../../src/configuration.ts) captures invocation configuration before execution. [Docs/runtime](../../docs/runtime.md) describes current ownership and potentially partial failure-path usage; [the roadmap](../../docs/roadmap.md) lists this increment as unimplemented.
- **V — Host-source evidence:** Installed Pi 1.0.0 `node_modules/@earendil-works/pi-ai/dist/types.d.ts` defines `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, optional reasoning/cache splits and cost; reasoning is a subset of output. `dist/models.js` computes cost using model rates and cache/tier pricing. `node_modules/@earendil-works/pi-coding-agent/dist/core/usage-totals.js` and `dist/modes/interactive/components/footer.js` account for standalone usage entries, assistant/tool-result messages and usage-bearing compaction/branch-summary entries. Host `docs/extensions.md`, `docs/tui.md` and `examples/extensions/widget-placement.ts` establish the existing widget integration. This is source-inspection feasibility evidence, not new runtime verification.

Selected endpoint: **one spec**, with the associated live ADR recording and compatibility references in the affected UI contracts. No slice, tickets, implementation plan, production/test changes or runtime/UI QA are authorized. The spec consumes settled requirements and established solution choices only: organize, express and sequence them, but do not invent or revise domain facts, requirements, constraints, acceptance semantics, architecture or unconfirmed assumptions. Trace meaningful assertions to the handoff or sources. A needed new fact/decision returns to refine for clarification and live recording before drafting resumes; formatting and execution ordering do not authorize filling semantic gaps. Results return to refine at this endpoint.

This spec authorizes the queued phase, capacity/aggregate information and per-task usage in addition to the baseline UI fields allowed by specs 0004 and 0006. Their unchanged presentation, pressure and lifecycle constraints remain in force. It also extends terminal usage collection beyond the currently inspected message-only categories; that improvement is not claimed as existing behavior.

## Requirements

### R1 — Shared startup-configured concurrency

- Provide a startup-configurable positive-integer maximum concurrency, defaulting to **4**. The effective value applies to this extension's delegations in the current parent session/runtime, not to the parent agent, other sessions or provider-wide requests.
- Synchronous and background tasks share the same capacity; neither path may bypass the limit or receive a separate allowance.
- Count acquired execution slots from admission through child initialization, original-task execution and completion of owned execution-resource cleanup. Initialization and a child still being cleaned up consume capacity even if no provider request is currently running.
- Never exceed the effective limit. Do not infer released capacity from `agent_end`, `agent_settled`, an assistant's final text or an outcome notification alone.
- Startup configuration must be usable and documented. The public spelling/storage mechanism is an implementation detail; this contract does not add runtime reconfiguration.

**Trace:** H-scheduling; A; L for the shared registration/runner seam.

### R2 — FIFO waiting and accurate task phases

- Admit eligible queued work in submission order, skipping work that has been cancelled or invalidated. Do not add priority, preemption or a separate synchronous fast lane.
- When no slot is available, retain the accepted invocation inputs in `queued` state without launching a Pi child or performing child initialization. A queued task has no child-task turns, running time or child usage.
- Distinguish `queued`, `initializing` and `running`: waiting for admission; admitted child startup/configuration; and actual original-task execution respectively. Later thinking/tool/finishing activity can retain its existing finer-grained UI meaning.
- Keep a background acknowledgement nonblocking with its scope-local `taskId`. Acknowledgement and subsequent `delegate_status` views must expose the applicable phase rather than falsely describing waiting or initialization as original-task execution. A task need not visibly pass through every phase if an immediate transition occurs.
- A synchronous invocation waits for capacity, then its child outcome and cleanup; it does not turn into background work or return an acceptance-only result.
- Capture task inputs and inherited/requested model/thinking configuration at submission. Changes to the parent's configuration while waiting must not alter the queued invocation. Child effective configuration remains unconfirmed until the existing verification boundary succeeds.

**Trace:** H-scheduling; A; B/specs 0002 and 0006; L for the current overbroad background `running` view.

### R3 — Cancellation, invalidation and release

- Cancelling a queued synchronous invocation or explicitly cancelling a queued background task must settle it as cancelled without first launching a child. Removed work must not subsequently acquire capacity.
- Preserve cancellation ownership: ordinary parent-turn cancellation does not cancel already-accepted background work, including queued background work. Synchronous work remains owned by its invocation.
- Apply existing background exit/reload/session-replacement/branch-navigation invalidation to queued as well as admitted background work. Existing synchronous shutdown/call cancellation remains applicable. Old-scope queued work must not start or deliver results into the replacement scope.
- On every admitted success, failure or cancellation path, complete runner-owned cleanup before returning the slot. Release it once and allow the next eligible FIFO task to proceed without a leaked or duplicate slot.
- Queue/admission races with cancellation or teardown must not start an invalidated child or leave a synchronous call / background cancellation waiting indefinitely for a queue entry that will never run.
- Preserve existing terminal outcomes, available output/usage, explicit cancellation cleanup and background query/completion delivery. Admission is not a new result-delivery owner.

**Trace:** H-scheduling; A; B/spec 0002 and existing synchronous ownership.

### R4 — Existing execution clock, pressure and readiness

- Waiting for admission and child initialization must not advance original-task elapsed time, completed-turn counts or pressure thresholds. Start/count them at the existing observed original-task boundary.
- Once original-task execution starts, provider/tool waiting still counts as running time under the existing contract. Scheduling must not reset or duplicate the task's pressure stages.
- Retain advisory pressure and acknowledgement-based UI semantics. Neither a full pool, extended queue residence nor displayed cost introduces a timeout or automatic cancellation.
- Queued and initializing background tasks are not steer-ready. Preserve existing `not_ready` rejection and do not buffer rejected manual instructions for later startup or convert them into a new prompt. Running phase alone is not a substitute for the existing runner-owned readiness checks.
- Keep the runner's transport/control ownership, exact startup model selection and no-fallback verification intact.

**Trace:** H-scheduling; H-usage; A; B/specs 0003, 0004, 0005 and 0006.

### R5 — Per-task latest usage and authoritative reconciliation

- Maintain the latest available usage for each delegated task, independently of UI rows and background query/result delivery. Preserve the raw host categories and cost values; compact display is not the stored accounting precision.
- Cumulative streaming updates replace the current in-progress snapshot; they are not successive charges. Include completed-message usage and available pending tool-result usage without duplicating the nested usage the host already included in those results.
- When terminal child entries are readable, use their authoritative usage total to reconcile/replace the observed snapshot rather than adding it on top. Include all available usage-bearing child records: assistant messages, tool-result messages, standalone usage entries, and compaction/branch-summary entries with usage.
- Preserve `cacheRead` / `cacheWrite` separately from `input`. Do not add optional reasoning again to `output`, or optional cache-write subsets again to `cacheWrite`.
- On failure/cancellation that prevents authoritative collection, retain the available observed usage rather than resetting it. Disclose that such totals may be partial and that unreported provider usage cannot be recovered.
- Update visibility when usage is reported or reconciled; do not manufacture token/cost increments from text length, elapsed time or lack of events. This contract sets no per-token update or numerical refresh-latency SLA.

**Trace:** H-usage; H-format; A; L for current event/readback accounting; V for additional record categories and subset semantics.

### R6 — Runtime cumulative delegated total and accounting boundary

- Aggregate this runtime's synchronous and background task usage into an explicitly identified **delegated total**. Include currently reported consumption and retained consumption of completed, failed and cancelled tasks.
- Reconcile by replacing each task's contribution with its latest authoritative snapshot. Repeated queries, UI renders, background completion delivery and final readback must not increase consumption merely because the same data was observed again.
- Preserve the cumulative total when a terminal row disappears after 5 seconds. Continue to make that total visible even when no child rows remain, once delegated consumption has been recorded.
- Branch navigation continues to invalidate/cancel background work and clear its task presentation under the existing contract, but must not erase that runtime's accumulated usage. Available late usage from cleanup of those same-runtime tasks remains attributable to their original contributions without resurrecting task rows or handles.
- Session replacement or extension reload starts a new runtime total. Do not persist/reconstruct this total across those boundaries, or let old-runtime observations populate the replacement runtime. Shutdown ends the owning total's lifetime.
- Keep delegated totals clearly separate from Pi's parent-session totals. Synchronous terminal usage continues to be reported through the existing tool result. Background usage remains separately reported and must not become a top-level `usage` charge on status/cancel queries or completion messages.
- Do not calculate a combined parent-plus-delegated figure by adding these aggregates: synchronous delegation is already represented through host tool-result accounting, while background usage is separate.

**Trace:** H-usage; A; B/spec 0002 and ADR 0002's existing accounting boundary.

### R7 — Compact Agents capacity and usage presentation

- Extend the existing above-input Agents area for both synchronous and background tasks; do not replace Pi's footer or add an interactive task panel.
- Show current occupied capacity against the maximum, plus the queued count. Occupied capacity includes initialization and admitted work still undergoing cleanup, not just active model requests.
- Show the separately labelled cumulative delegated usage and a per-task usage metadata row alongside the existing model/thinking and activity rows.
- Use the user-selected field order and compact format: **`↑8.2k ↓1.1k R20k W0 · $0.04`**. `↑` maps to `usage.input`, `↓` to `usage.output`, `R` to `usage.cacheRead`, `W` to `usage.cacheWrite`, and `$` to `usage.cost.total`. Keep cache categories explicit; do not relabel the line as network upload/download bytes or add an inline `est.` prefix.
- Align the added per-task metadata with the existing `│  model: ... · thinking: ...` row and retain the final `└─` activity/outcome row. Show `queued` / `initializing` accurately, without showing captured model/thinking values as confirmed child configuration.
- Preserve stable session-local numeric identity across waiting/startup/execution, title behavior, English turn labels, acknowledged pressure, current-activity-only display, semantic theme colors, spacing, sanitization and terminal-column width bounds. Narrow layouts may truncate compact content under the existing width contract rather than overflow.
- Preserve whole-task terminal visibility for 5 seconds, including final available usage, before removing its rows. Removing rows is not removing accounting or a still-queryable background result.
- Document that `$` is Pi's reported/calculated estimate, not the supplier invoice; subscription/custom-provider pricing can differ or report zero. Explain input/cache categories, provider-dependent update availability, partial failure/cancellation totals and separation from parent-session totals outside the compact numeric line.
- Keep non-TUI delegation and structured status/usage functional without a widget. UI state must not own admission, child lifetime or the ledger.

Illustrative accommodating-width excerpt; the other three active task rows are omitted, and aggregate values can include earlier tasks no longer shown:

```text
  Agents · active: 4/4 · queued: 1
    Delegated total · ↑24.1k ↓3.2k R80k W0 · $0.13

  1  Review errors · 32s · 2 turns · pressure: none
    │  model: provider/model · thinking: high
    │  ↑8.2k ↓1.1k R20k W0 · $0.04
    └─ toolcall · read

  5  Check tests · 0s · 0 turns · pressure: none
    │  model: unconfirmed · thinking: unconfirmed
    │  ↑0 ↓0 R0 W0 · $0.00
    └─ queued
```

The exact capacity-heading wording, abbreviation/rounding algorithm and startup-setting name are implementation details; the selected usage field order/symbols, accounting meaning and existing metadata alignment are contractual.

**Trace:** H-scheduling; H-usage; H-format; B/specs 0004 and 0006; V for Pi usage and widget semantics.

## Solution

Place a FIFO capacity-admission boundary on the shared parent-runtime execution path before the runner starts initialization. It must cover both invocation modes while leaving their cancellation signals and ownership distinct. Keep the runner responsible for process/RPC startup, original-task boundaries, usage observation, result collection and cleanup; admission must not release capacity before that cleanup completes.

Use runner-produced latest usage snapshots and authoritative terminal reconciliation as the common data source for terminal background results, task rows and a runtime accounting owner independent of visual retention. Task presentation/handles can be invalidated on a branch boundary while same-runtime consumed usage remains retained. Replacement/reload must invalidate the accounting scope as well as the execution/UI scopes so old callbacks cannot charge a new runtime. Specific class/file names and callback signatures are not prescribed.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Invocation admission | `delegate` sync path / background owner → shared capacity boundary | Captured task/configuration, effective startup limit and the owning cancellation signal | FIFO waiting without child startup; a slot covering initialization through cleanup; cancellation-aware settlement |
| Execution lifecycle | Admission ↔ shared runner | Slot acquired before initialization; runner-owned cancellation/cleanup | Accurate initialization/task-start/terminal observations and capacity release only after cleanup, on all paths |
| Background ownership | Existing task registry ↔ scheduled execution | Immediate scope-local task ID, independently owned signal, existing invalidation/readiness rules | Accurate phase for query, queued cancellation, and unchanged eventual result/completion delivery with available terminal usage |
| Usage source | Runner / child events and entries → runtime accounting and task views | Cumulative versus committed usage semantics; authoritative final readback or available partial fallback | Latest per-task raw usage and replacement-based aggregate updates without recharging observations |
| Scope lifetime | Branch/runtime lifecycle → execution, ledger and visual owners | Branch cancellation within one runtime versus replacement/reload of the runtime | Branch-local handle/row invalidation with retained consumption; complete isolation/reset for a replacement runtime |
| TUI presentation | Capacity/usage/configuration observations → `AgentStatus` widget | Task-local identity and truthful phase/configuration/usage; active theme and available width | Capacity, queue count, selected usage format and independently retained delegated total; no execution/accounting ownership |
| Host accounting | Sync result / background query-completion → Pi | Existing top-level synchronous usage; separately labelled background details | No duplicate usage charge and no misleading combined parent-plus-delegated total |

**Trace:** H-scheduling; H-usage; A; B; L. These are correctness/ownership exchanges, not a required implementation sequence or module plan.

## End-to-End Tests

The following are required verification scenarios for later authorized execution, not tests run at the spec-only endpoint.

### Shared limit, initialization and FIFO progression

- **Given:** The default limit of 4, with synchronous and background requests submitted in a known order; admitted fixture children can be held in initialization, execution and cleanup.
- **When:** More tasks are submitted than available slots, then a held task finishes or fails.
- **Then:** No more than four tasks hold execution slots; initialization/cleanup consume them. Excess tasks remain queued with no spawned child. The next eligible FIFO task initializes only after cleanup releases a slot. Background acceptance is immediate; synchronous calls remain pending until their own outcome.

### Startup override

- **Given:** A parent runtime started with the concurrency setting overridden to 1.
- **When:** Synchronous and background delegations are submitted together.
- **Then:** They share one slot rather than separate per-mode pools or the default four slots; eligible excess work waits and proceeds in FIFO order through the same cleanup boundary.

### Queued cancellation and pressure/readiness isolation

- **Given:** An occupied pool and queued synchronous/background work with captured model/thinking and pressure configuration.
- **When:** The queued synchronous call is cancelled, another queued background task is explicitly cancelled, a manual steer targets waiting work, and the parent model changes before a remaining task is admitted.
- **Then:** Cancelled queued tasks never start and settle under their existing cancellation contracts; steering returns `not_ready` without buffering. Waiting tasks have zero execution time/turns and no pressure submissions. The admitted remaining task uses its captured configuration and begins pressure only at actual original-task execution.

### Live and final usage without duplicate consumption

- **Given:** A fixture child publishes cumulative stream snapshots, completed assistant/tool-result usage with host-aggregated nested usage, and readable final entries including standalone/compaction usage.
- **When:** The UI observes updates, background status is queried repeatedly, final entries are reconciled, and completion is delivered.
- **Then:** Task and aggregate contributions follow replacement semantics; each final usage-bearing record contributes once. Cache categories stay separate, reasoning/cache subsets are not added again, and final values match the authoritative entries rather than stream-plus-entry addition. The task/total render in the selected `↑... ↓... R... W... · $...` format.

### Partial failure/cancellation and capacity recovery

- **Given:** A running child with reported assistant/tool-result usage and a held follower in the queue.
- **When:** Cancellation or transport failure prevents final-entry retrieval.
- **Then:** Available reported usage survives in the failed/cancelled result and runtime total, with documented partial-data limits. Cleanup completes, exactly one slot is released, and the follower proceeds. Failure does not reset consumed usage or add a new charge through a query.

### Row expiry, branch navigation and runtime reset

- **Given:** Completed consumption plus running/queued background work in one runtime.
- **When:** Terminal rows expire, then branch navigation invalidates work, then the session/runtime is replaced or reloaded.
- **Then:** Five-second row expiry leaves the delegated total visible. Navigation cancels queued/running background work and prevents late startup/result delivery while retaining available consumed usage in the same runtime, including cleanup reconciliation without row/handle resurrection. Replacement/reload starts a fresh total; old callbacks cannot repopulate rows, launch invalidated queued work or charge the new runtime.

### Host accounting and presentation compatibility

- **Given:** Synchronous and background delegations in TUI and RPC modes, including narrow-width/theme rendering fixtures.
- **When:** Usage becomes available and terminal results/queries/completions are processed.
- **Then:** Synchronous usage remains a host tool-result charge; background observations stay separately reported without a new top-level charge. The widget labels the aggregate as delegated rather than combined host usage, preserves model/usage/activity alignment and the baseline width/theme/pressure/retention contract, and is not required for RPC execution/status.

**Trace:** R1–R7; existing host integration fixtures in `tests/` establish available testing surfaces, not verification of this increment.

## Decisions and exclusions

- **Shared FIFO pool including initialization/cleanup:** Chosen to bound concurrent child resources without a complex scheduler; H-scheduling and ADR 0006. Default 4 and startup-only configurability are the accepted first-increment requirements.
- **Replacement snapshots and full available terminal child usage:** Chosen to expose actual reported consumption without double-counting cumulative stream updates or omitting auxiliary usage; H-usage, ADR 0006 and installed-host evidence V.
- **Runtime total independent of branch-local presentation:** Chosen so consumed work is not forgotten when rows disappear or tasks are cancelled during navigation; H-usage and ADR 0006. No cross-runtime persistence is added.
- **Exact compact usage symbols without inline `est.`:** User-selected H-format. Documentation still explains estimation, subscription/custom-provider differences and partial data; changing the prefix is not changing the accounting meaning.
- **Preserved separate host accounting:** Required by H-usage and ADR 0002; delegated totals must not be added to host totals that already include synchronous results.
- **Out of scope:** Runtime concurrency adjustment; priority/preemption or cross-runtime scheduling; hard token/cost budgets and automatic budget cancellation; a new interactive task panel/listing capability; supplier billing reconciliation or guaranteed per-token usage updates. Existing workspace/isolation/security limitations are unchanged.

## Completion and limitations

This document is a requirements contract, not a claim of implementation. No blocking domain/architecture choice or unconfirmed semantic assumption remains in the settled scope. Startup-setting spelling, internal types/modules, heading wording and compact abbreviation/rounding are reversible implementation details within the stated outcomes, not authorization to alter admission or accounting semantics.

Only installed Pi 1.0.0 source interfaces have been inspected. Scheduling correctness, teardown races, full-record usage reconciliation and new UI behavior require the later executable evidence above; no cross-version compatibility, provider invoice accuracy, unavailable-usage recovery, implementation/test result or runtime/UI QA is claimed at this endpoint.
