# Unified scope-local task discovery with background-only controls

**Status:** Testing
**Date:** 2026-10-08
**Supersedes:** [0004-task-addressed-runtime-steering](./0004-task-addressed-runtime-steering.md), only its exclusion of public synchronous task handles. Its background-only steering, runner ownership, readiness, receipt, sequencing and lifecycle decisions remain in force.

## Context

The user requested refinement of “Task listing and details” in [the roadmap](../../packages/pi-delegate/docs/roadmap.md). The recommended design makes synchronous and background delegations discoverable and inspectable together, while preserving the existing execution ownership and background-only independent controls. The user accepted the recommendations with “其他的按照推荐就行”, required a floating TUI panel, and suggested using `packages/pi-open-tui/` as a visual reference.

Existing Agents rows cover both execution modes, but task-addressed query/control currently belongs to background tasks. The visual owner contains execution observations and removes terminal rows after five seconds. A task discovery capability must not depend on those rows or on completion-message delivery.

Sources:

- The refinement conversation: the recommended scope, identity, query, retention and responsibility boundaries, and the user's acceptance and floating-panel requirement.
- [ADR 0002](./0002-session-owned-background-delegation.md): background scope, completion delivery, query recovery and invalidation.
- [ADR 0004](./0004-task-addressed-runtime-steering.md): background-only public steering and runner-owned control readiness/transport.
- [ADR 0006](./0006-runtime-concurrency-and-delegated-usage.md): shared admission and separately retained delegated accounting.
- [ADR 0010](./0010-independent-workspace-packages.md) and [pi-open-tui package guidelines](../../packages/pi-open-tui/AGENTS.md): no dependency between the packages.
- [delegate.ts](../../packages/pi-delegate/src/delegate.ts), [background.ts](../../packages/pi-delegate/src/background.ts) and [status.ts](../../packages/pi-delegate/src/status.ts): current execution, background ownership and visual-state boundaries.
- [settings-command.ts](../../packages/pi-open-tui/src/settings-command.ts): an existing custom overlay with themed panel, tab/list navigation and close/focus restoration.

## Decision

- Provide discovery and detail access for accepted synchronous and background delegations in the current session/branch ownership scope. Introduce query identifiers for synchronous tasks without making synchronous execution independent of its initiating invocation.
- Keep independent task-addressed cancellation and manual steering background-only for this increment. Preserve synchronous initiating-call cancellation and result return; do not add synchronous completion messages or implicitly resume terminal work.
- Use a non-visual task-record boundary as the shared source for list/detail tools and the TUI. It records identities, execution observations and available results; it is not a new execution owner, RPC controller or accounting ledger.
- Preserve runner ownership of child processes, transport, readiness and cleanup, synchronous invocation ownership, background ownership of accepted background work and completion delivery, and the existing usage ledger. Reading records, rendering and repeated queries do not charge usage again.
- Use taskId as the exact query/control identity. Correlate it explicitly with the existing session-local, monotonically increasing, non-reused numeric UI label. Display order, row expiry and abbreviated presentation must not change the operation target.
- Add bounded summary listing and extend the existing detail query rather than create competing detail interfaces. Retrieve result bodies on demand; listing does not inject full results, task/context bodies or execution transcripts into the parent context.
- Retain accepted task records and available results until their existing scope is invalidated, independently of the five-second visual row lifetime. Do not introduce automatic terminal-record TTL/count eviction or cross-session persistence. Pagination bounds response size, not record lifetime.
- Keep execution outcome and completion-message delivery separate. Delivery failure does not rewrite a completed execution as failed or remove its queryable result; successful message submission does not establish parent-model consumption.
- Present TUI management in an on-demand floating overlay while preserving the compact above-editor Agents area. Closing the overlay does not cancel work. Referencing pi-open-tui's presentation does not introduce a dependency, shared runtime or required installation of that package; the established package-independence boundary remains applicable.

Ordinary interface fields, pagination parameters, panel layout and keybindings belong in the requirements handoff or a separately selected spec. This record does not settle those remaining presentation details.

## Consequences

- Both humans and the parent agent can rediscover tasks without remembering each background ID, including after a visual terminal row expires.
- Synchronous query handles extend ADR 0004's former handle exclusion, but do not extend its steering boundary or alter synchronous lifetime.
- Task observations must remain available without TUI rendering. Late callbacks must not repopulate a replacement/destination scope, and selected task identity must survive live list updates.
- Scope-lifetime retention has a memory cost. Bounded previews and on-demand artifact access limit response/rendering size but are not a fixed total-memory guarantee.
- Existing background query/result/accounting behavior must remain compatible while richer metadata and synchronous read access are introduced.
- At initial recording, the selected endpoint was discussion with authorized knowledge recording; no spec, slice, implementation plan, production/test change or QA execution had been selected or performed. Inspected source and installed host documentation establish integration references, not implemented or verified behavior for this increment.

## Requirements drafting authorization (2026-10-08)

After the recording-stage discussion, the user invoked `grimoire-spec` and confirmed the proposed single-overlay list/detail/action flow and spec-only endpoint. [Spec 0009 — Task listing, unified details and floating task panel](../spec/0009-task-listing-details-and-floating-panel.md) expresses the accepted contract and future acceptance scenarios. This authorization does not start implementation, change this ADR's Proposed status or establish runtime/UI verification.
