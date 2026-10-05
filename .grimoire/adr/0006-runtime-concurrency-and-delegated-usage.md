# Runtime-local concurrency scheduling and delegated usage accounting

**Status:** Proposed
**Date:** 2026-10-04

## Context

The user asked how to realize "Concurrency scheduling and cost visibility" from [the roadmap](../../packages/pi-delegate/docs/roadmap.md), suggesting a simple concurrency limit with waiting tasks and UI token/cost visibility. Refinement recommended a runtime-local FIFO admission boundary shared by synchronous and background delegations, initialization counted against the limit, no child process while queued, cancellation-aware waiting, and slot release only after execution-resource cleanup. It also recommended task usage snapshots and a separate cumulative delegated total that retains consumed usage after terminal rows disappear or branch navigation cancels work.

The user accepted the recommendations with "其他的按照你推荐进行" and specified the usage presentation as `↑8.2k ↓1.1k R20k W0 · $0.04`, without an inline `est.` prefix. The selected endpoint is one requirements spec, not implementation or QA. Numeric defaults and UI formatting are ordinary requirements for that spec rather than separate architecture decisions.

Existing boundaries remain applicable: [ADR 0002](./0002-session-owned-background-delegation.md) establishes session-owned background work, branch invalidation and separate background accounting; [ADR 0003](./0003-per-delegation-soft-pressure.md) keeps pressure advisory; [ADR 0004](./0004-task-addressed-runtime-steering.md) keeps transport and readiness in the runner; [ADR 0005](./0005-per-task-model-selection.md) captures startup configuration at invocation acceptance.

Sources:

- This refinement conversation: the initial request, the recommended rules and accounting/UI scope, and the user's acceptance and format correction.
- `src/delegate.ts`: synchronous and background registration paths, shared execution runner, child initialization/cleanup, message-event usage accumulation and final-entry readback.
- `src/background.ts`: background execution ownership, result retention, query/cancellation, completion delivery and branch/runtime invalidation.
- `src/status.ts` and [spec 0004](../spec/0004-agent-status-ui.md): visual-only Agents rows, initialization-excluding time, theme/width behavior and 5-second terminal retention.
- `src/configuration.ts` and [spec 0006](../spec/0006-per-task-model-selection.md): invocation snapshots and verified model/thinking metadata.
- Installed Pi 1.0.0 `node_modules/@earendil-works/pi-ai/dist/types.d.ts` and `dist/models.js`: usage categories, reasoning as an output subset, and model-rate cost calculation.
- Installed Pi 1.0.0 `node_modules/@earendil-works/pi-coding-agent/dist/core/usage-totals.js` and `dist/modes/interactive/components/footer.js`: host totals include usage entries, assistant/tool-result messages and usage-bearing compaction/branch-summary entries.

These sources establish existing behavior and available integration points, not implemented scheduling or verified new cost visibility.

## Decision

- Use one concurrency admission boundary for this extension's synchronous and background delegations in the current parent session/runtime. Exclude the parent agent and other runtimes; do not introduce a cross-process or provider-wide scheduler.
- Admit waiting work in FIFO order without priority or preemption. Queued work retains captured task inputs but does not launch a child process. Child initialization occupies a slot, and that slot remains occupied until the runner has finished its owned execution-resource cleanup on success, failure or cancellation.
- Preserve execution ownership: synchronous waiting/execution belongs to the invocation; accepted background waiting/execution belongs to the existing background owner. Explicit cancellation and ownership invalidation must settle queued work without first starting it, and must prevent invalidated work from launching later. The scheduler does not own RPC transport, result delivery or UI.
- Preserve invocation-time configuration snapshots and existing readiness/pressure boundaries. Queue residence is not child initialization or original-task execution, does not advance running-time/turn pressure, and does not make steering ready.
- Maintain per-task latest usage snapshots with final authoritative reconciliation rather than additive counting of every stream update. Include all available usage-bearing child session records in the terminal total, not only assistant/tool-result messages. Repeated queries, completion delivery, entry readback and UI rendering are observations of consumption, not new consumption.
- Aggregate only delegated task usage into a clearly identified runtime-local cumulative total. Include consumed usage from completed, failed and cancelled tasks. Keep that accumulated consumption after the corresponding UI row expires and after branch navigation invalidates task handles; reset the cumulative total when the owning session/runtime is replaced or reloaded.
- Keep this delegated total separate from Pi's parent-session total. Synchronous delegated usage continues through the synchronous tool result; background usage remains separately reported as in ADR 0002. Do not add the delegated aggregate to the host parent total or expose background query/completion results as a new top-level charge.
- Treat displayed cost as the Pi/provider usage cost estimate, not a supplier invoice or a guarantee of actual subscription/custom-provider expenditure. Retain reported partial usage on cancellation/transport failure and disclose that unavailable provider data cannot be recovered. Visibility does not introduce automatic budget cancellation; pressure remains advisory.

This is additive to ADRs 0002–0005, not a supersession of their lifecycle, accounting, steering or model-selection boundaries. [Spec 0007 — Concurrency scheduling and delegated cost visibility](../spec/0007-concurrency-scheduling-and-cost-visibility.md) defines the startup concurrency setting, authorized UI additions and representative verification scenarios.

## Consequences

- A limit bounds child initialization and cleanup as well as model execution; queued tasks do not cause an uncontrolled burst of child processes or MCP reconnections.
- Background acceptance remains immediate even when capacity is unavailable, but task acknowledgement/query must distinguish queued and initializing work from original-task execution.
- Fair admission and exactly-once slot release must survive cancellation, failures and concurrent ownership invalidation; a task settling its model run is not yet evidence that its resources have been released.
- The visual owner cannot be the accounting ledger: expiring a row or clearing branch-local presentation must not erase consumption. Late old-runtime callbacks must not charge a replacement runtime, while cleanup of tasks cancelled within the same runtime must preserve their available usage in that runtime's total.
- Full terminal accounting needs the host's additional usage-bearing entry categories. Live snapshots can remain incomplete until the host/provider publishes data or final entries can be read.
- The selected endpoint is requirements drafting only. No scheduler, production/test changes, implementation plan, runtime tests or UI QA have been authorized or performed for this increment; host-source evidence is scoped to installed Pi 1.0.0.
