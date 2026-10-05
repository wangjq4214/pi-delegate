# Session-owned background delegation with completion delivery

**Status:** Completed
**Date:** 2026-10-03
**Supersedes:** [0001-rpc-subagents-and-parent-only-delegation](./0001-rpc-subagents-and-parent-only-delegation.md)

## Context

The user requested a background agent mode that does not block the main agent and delivers the result to the main agent after completion. In the refinement conversation, the user explicitly accepted retaining synchronous delegation, opt-in background execution, queued completion while the parent is busy, automatic wake-up while it is idle, and session-owned cancellation and cleanup boundaries.

ADR 0001 established fresh RPC children, parent-only delegation, tool reinitialization, and an exclusively synchronous lifecycle. This decision supersedes that exclusivity and extends the lifecycle; its RPC, registration, inheritance, fresh-session, and explicit task/context decisions remain unchanged. Existing synchronous calls keep their behavior.

Later amendment (2026-10-04): [ADR 0008](./0008-generic-per-delegation-working-directory.md) replaces the mandatory same-working-directory clause retained from ADR 0001 with an optional generic per-task `cwd`, retaining the parent's directory by default. This does not supersede the lifecycle decisions in this record.

Sources:

- User request and subsequent confirmation of the recommended defaults in the refinement conversation.
- [ADR 0001](./0001-rpc-subagents-and-parent-only-delegation.md).
- `src/delegate.ts`: current synchronous result delivery and shutdown cleanup.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`: extension message-injection API.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`: idle turn triggering and queued follow-up delivery in Pi 1.0.0.

## Decision

- Preserve synchronous delegation and make background execution an explicit opt-in. The exact option name is not settled; `background: true` was an illustrative interface.
- In background mode, return a task identifier without waiting for the child's final answer, so the parent can continue working while the child runs independently.
- Deliver the task identifier, terminal status, and available result to the parent agent through model-visible completion messaging, not merely a user-interface notification.
- If the parent is busy, queue the completion as follow-up work without interrupting its current work. If it is idle, automatically trigger a parent turn to process the completion.
- Notify the parent of failed, cancelled, and incomplete results as well as successful completion, preserving their distinct meanings.
- Background tasks belong to the current Pi session/runtime, not to the originating parent turn. Ordinary parent-turn completion or cancellation does not automatically cancel a background task. Provide explicit background-task cancellation.
- On exit, session replacement, or extension reload, terminate owned background tasks and clean up their resources. Do not migrate tasks or route their results into a replacement session/runtime.
- Background mode is session-local asynchronous execution, not a persistent service that survives Pi exit.

### Boundary decisions confirmed on 2026-10-03

The user accepted all four boundary recommendations during spec refinement:

- In addition to automatic completion messaging, let the parent query task status and results by task identifier. This provides recovery when the host's notification queue is cleared.
- Preserve available child token/cost usage with the task result. This version does not automatically include background usage in Pi's parent-session totals; disclose that limitation. Synchronous usage accounting remains unchanged.
- Do not open blocking selection, confirmation, input, or editor dialogs for background children. Respond with cancellation/refusal to the individual UI request, without automatically classifying the whole task as cancelled; the child determines whether it can continue.
- Switching to another branch through `/tree` cancels current background tasks, preventing old-branch results from triggering work in the new branch.
- Support background delegation in long-lived TUI and RPC parent sessions. Do not promise background execution in one-shot print/JSON mode.

These decisions settle the accounting, background-interaction, branch-navigation, and parent-mode gaps noted when this ADR was first recorded. Query and cancellation capability names remain implementation details.

These choices fulfill the user's nonblocking execution and eventual result-delivery intent while retaining existing synchronous callers and bounding ownership to the parent session.

## Consequences

- The extension must own background work beyond the initiating tool call's return; the old tool result cannot be the eventual result-delivery channel.
- Result delivery must distinguish the originating runtime from a replacement runtime and avoid completion-triggered work during teardown.
- Existing synchronous output/status semantics provide a reference for background results; exact task-management interfaces and delivery/retrieval details still require a requirements contract.
- Custom completion messages do not automatically carry the delegated usage accounting currently returned by the synchronous tool result. The confirmed boundary decisions above require preserving available task usage separately and disclosing that background usage is not automatically included in Pi's parent-session totals.
- Local API/source inspection establishes feasibility in Pi 1.0.0, not implemented or tested background behavior. The confirmed parent-mode and branch-navigation policies above require real-host verification during implementation.

## Realization and verification (2026-10-03)

The source-inspection caveat above describes proposal-stage evidence. Implementation now exists in `src/background.ts`, `src/delegate.ts` and `src/inheritance.ts`, with the requirements contract and verification recorded in [spec 0002](../spec/0002-session-owned-background-delegation.md#implementation-verification-2026-10-03).

Real Pi 1.0.0 RPC and SDK TUI-mode tests verify independent background execution, model-visible busy/idle result delivery, query recovery, explicit cancellation, UI request refusal, separate usage, reload/replacement/shutdown cleanup, and branch-navigation isolation. Review-found eventless-idle and navigation-window defects were corrected and regression-tested. Final post-format tests (86 passed, 0 failed), typecheck, Biome check and diff whitespace check passed.

Completion is scoped to the extension/runtime contract. Terminal rendering/input E2E and host versions other than Pi 1.0.0 are not claimed. Conservative pre-navigation cancellation also applies if navigation is subsequently cancelled; background work is not resurrected. Task usage remains separate from parent-session totals as decided above.
