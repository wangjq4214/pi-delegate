# Explicit waiting with status-only responses

**Status:** Completed
**Date:** 2026-10-25

## Context

During refinement of the first delegation roadmap candidate, the user narrowed the need to letting the parent agent wait and receive status: “Are those additions really necessary? Status alone should suffice; this only needs to let the parent agent wait” (translated). The discussion had considered both a separate lightweight-query mode and returning result bodies directly from a wait. Neither is needed for the selected waiting responsibility.

Sources:

- The refinement conversation quoted above, following the user's selection of the first candidate.
- [Delegation roadmap](../../packages/pi-delegate/docs/roadmap.md#1-explicit-waiting-and-incremental-queries): explicit waiting and incremental queries are candidates, not an inseparable feature contract.
- [ADR 0021](./0021-query-only-background-result-retrieval.md): background results remain explicitly queried, without unsolicited completion delivery or idle-parent wake-up.
- [ADR 0016](./0016-unified-scope-local-task-discovery.md): task observations and result access do not acquire execution or accounting ownership.

## Decision

- Treat explicit waiting as an observation capability that lets the parent wait for task state, not as a new result-delivery or execution owner.
- Return task status from waiting, without attaching child result bodies. The parent retrieves a report separately through the existing `delegate_status` capability when needed.
- Do not bundle a new lightweight-detail-query mode or revision/cursor protocol into this increment. Their later addition is not a commitment; it would require a demonstrated need and a separate decision.
- Preserve the existing query-only background-result policy and current full-query behavior. This is an additive waiting capability, not a replacement for existing result retrieval.

## Consequences

- Waiting can reduce repeated polling without repeatedly delivering reports to the parent context.
- Waiting completion and report retrieval remain separate operations; obtaining a report may require a subsequent explicit query. Task termination is not evidence that the user's requirements were fulfilled.
- Exact request/response fields, wait conditions, timeout values and lifecycle/error cases were not yet settled at initial recording. The subsequently accepted requirements are recorded in [Spec 0016](../spec/0016-explicit-status-only-delegation-waiting.md); that contract, not earlier unconfirmed suggestions, governs the increment.
- This record preserves the settled responsibility boundary only. At initial recording no spec/ticket endpoint had yet been selected. The user subsequently selected one spec without tickets or implementation planning; that refinement stage did not authorize implementation or claim runtime verification.

## Realization and verification (2026-10-25)

The user's subsequent explicit `grimoire-loop` invocation authorized implementation of [Spec 0016](../spec/0016-explicit-status-only-delegation-waiting.md). Waiting now observes existing task records, defaults to any/30 seconds with optional all and a 120-second maximum, and returns statuses without reports or top-level child usage. Existing result queries, execution owners and lifecycle cleanup remain separate; no lightweight-query mode or cursor protocol was introduced.

The spec's dated evidence section maps all five requirement groups to deterministic tests, public registration/lifecycle checks and actual Pi RPC source/built-entry scenarios, including child direct/search/codemode exclusion. Workspace tests, check, typecheck and build passed; the strengthened final fixture was reverified in source and built modes. Inline review/check found no remaining confirmed blockers. Evidence is local to the pinned Pi 1.1.0 host and deterministic providers, not manual terminal/IME acceptance or a broader compatibility claim.
