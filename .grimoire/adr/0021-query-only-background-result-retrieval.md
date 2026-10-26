# Query-only background result retrieval

**Status:** Completed
**Date:** 2026-10-12
**Supersedes:** [ADR 0002](./0002-session-owned-background-delegation.md), only its automatic model-visible completion delivery, busy-parent follow-up queueing and idle-parent wake-up decisions; and [ADR 0016](./0016-unified-scope-local-task-discovery.md), only its retained automatic completion-delivery responsibility and observations. Execution ownership, task discovery, scope-lifetime result retention, cancellation, steering and accounting boundaries remain unchanged.

## Context

The user requested removing delegate's automatic completion message because models commonly retrieve results themselves, causing duplicate result retrieval and wasting parent context. Current background execution stores results in `packages/pi-delegate/src/background.ts` and automatically delivers them through `pi.sendMessage` with `customType: "pi-delegate:completed"`, `deliverAs: "followUp"` and `triggerTurn: true` in `packages/pi-delegate/src/delegate.ts`. Existing `delegate_list` and `delegate_status` provide discovery and on-demand detail/result access independently of automatic delivery.

Sources:

- User request in the refinement conversation: “Remove delegate's automatic completion messages: most models retrieve results themselves, so the duplicate retrieval wastes context” (translated).
- ADR 0002 and ADR 0016: existing completion-delivery and task-discovery boundaries.
- `packages/pi-delegate/src/background.ts`, `packages/pi-delegate/src/delegate.ts` and `packages/pi-delegate/src/tasks.ts`: current storage, delivery and delivery-observation paths.
- `packages/pi-delegate/docs/usage.md`: existing synchronous return, background delivery and query contracts.

## Decision

- Remove automatic background terminal-outcome messages to the parent model rather than replace them with a smaller automatic completion notification. Background completion no longer queues follow-up work or wakes an idle parent.
- Retrieve background results on demand through task discovery and detail queries. Retain terminal status, available output and usage in the originating ownership scope, including failed, cancelled and incomplete outcomes.
- Preserve synchronous delegation's direct result return and existing background execution, independent cancellation/steering, scope invalidation and usage-accounting boundaries. This changes the result-delivery policy, not the child execution lifecycle.

## Consequences

- Automatic delivery no longer duplicates results obtained by model-initiated queries or consumes parent context with unsolicited result bodies.
- An idle parent will not resume solely because a background task finishes; results await an explicit query. Queries themselves can still be repeated; this decision does not promise exactly-once retrieval or consumption.
- Tool descriptions, user-facing documentation, delivery observations and existing delivery/wake-up tests must stop promising automatic completion delivery when this decision is implemented. Historical delivery requirements and evidence remain historical, not evidence for the new policy.
- This record establishes the selected direction only. No implementation or verification of the new behavior has occurred in this refinement turn.

## Realization and verification (2026-10-12)

The refinement-only caveat above records the initial stage. The user subsequently invoked `grimoire-loop`, authorizing implementation and verification. The completion callback, pending-delivery timer/queue, parent-idle context retention and delivery-only lifecycle hooks have been removed. Task details and the panel no longer expose automatic-delivery state or errors; model-facing descriptions, both READMEs, usage/runtime guides and the worktree skill now specify query-only background results. Specs 0002 and 0009 carry policy-update notices without erasing historical evidence.

Verification on Bun 1.4.1 / Pi 1.1.0: the formatted pi-delegate suite passed with 548 tests, 1 POSIX-only skip and 0 failures (6194 assertions). Registration tests cover completed, incomplete, failed and cancelled results with idle and busy/queued parents; real RPC and TUI-mode runtime tests verify no automatic messages/wake-up, explicit result retrieval, cancellation and scope cleanup. Existing synchronous, pressure, configuration, cwd, handoff, inheritance, accounting and panel regressions pass. Root `bun run typecheck`, root `bun run check`, the pi-delegate build and `git diff --check` passed. Six targeted actual-host configuration/cwd tests also passed using the built `dist/index.js` entry, including background query results with no completion messages.

Inline review/check found no remaining confirmed blockers for this policy change. Verification covers extension/runtime behavior, not manual terminal keyboard/IME E2E or a new host-version compatibility promise. The independent pi-open-tui test suite was not part of this change's behavioral verification.
