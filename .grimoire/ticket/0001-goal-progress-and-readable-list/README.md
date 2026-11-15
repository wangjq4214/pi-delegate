# Goal progress and readable inspection

**Source:** [Spec 0020](../../spec/0020-goal-progress-and-readable-list.md), based on the settled refinement conversation and [Spec 0019](../../spec/0019-bounded-goals-on-delegate.md).
**Ticket folder:** `.grimoire/ticket/0001-goal-progress-and-readable-list/`
**Status:** Todo

## Overview

Deliver readable goal inspection and a compact live goal view that replaces only goal-owned worker/reviewer rows in delegate's Agents widget. Ordinary delegate work remains visible. Preserve execution, task discovery, accounting, finite authorization, independent review, global journals and deliberate recovery.

The user selected Spec → tickets only. These tickets are execution inputs, not implementation authorization or proof of acceptance. No implementation plan, production/test edit, runtime QA, release, staging/commit or CONTEXT/ADR mutation is part of this refinement endpoint.

## Delivery Surfaces

- Goal command output and human-readable presentation derived from current/durable state.
- Goal live above-editor view, attempt-to-task correlation and lifecycle disposal.
- Delegate public consumer API, invocation-scoped compact-row policy and existing task observations; no new execution owner or ledger.
- Goal/delegate documentation and focused unit/adapter/actual-host acceptance coverage within each delivery ticket.

## Requirement Coverage

| Spec outcome | Owner | Verification |
| --- | --- | --- |
| R1.1–R1.5: truthful counts, saved/live separation, allowance and empty/unknown semantics | T0001 for commands; T0002 for live progress | E3–E4 and command assertions; E1–E2/E5–E7 for live behavior |
| R2.1–R2.6: in-flight goal progress, subagent identity and review/stop/recovery display | T0002 | E1–E2/E5–E6 |
| R3.1–R3.5: readable list/current/saved status, errors, read-only and structured compatibility | T0001 | E3–E4; command/non-TUI portion of E7 |
| R4.1–R4.5: selective row replacement, ordinary-task visibility, query/accounting preservation | T0002 | E1–E2/E5/E7 |
| R5.1–R5.5: public live observations, invocation scope, disposal and compatibility | T0002 | E5–E7; view-disposal portion of E8 |
| R6.1–R6.2: Unicode/width/theme/text safety and resource disposal | T0001 for command output; T0002 for widget | E8 on both surfaces |
| R6.3: accurate goal/delegate guidance | T0001 for command guidance; T0002 for live progress/public API | Interface-to-documentation check within each ticket |

Every numbered requirement is assigned above; shared semantic requirements are verified on each distinct user surface rather than assigned to an unowned final QA phase.

## Dependencies

There are no blocking edges between the two tickets. T0001 uses existing goal/store/structured query state. T0002 owns its required public delegate extension and live view together; it does not depend on a new command formatter or a separate preparatory API ticket. Its producer/consumer seam is verified inside one coherent delivery unit.

The dependency graph therefore contains two independent nodes and is acyclic. Recommended sequencing below reduces shared-file conflicts, not a semantic dependency.

## Coordination

| Tickets | Risk | Strategy |
| --- | --- | --- |
| T0001, T0002 | Both may edit goal `src/index.ts`, human presentation helpers, goal tests and docs | Prefer sequential delivery; if parallel, agree ownership of command handlers versus execution/view hooks and reconcile shared formatting semantics before integration |
| T0001, T0002 | Counts, saved/live labels, allowance terminology and review state can diverge | Both consume Spec 0020 R1; reuse suitable formatting without requiring a separate refactor or introducing a new state owner |
| T0002 internal cross-package work | Source behavior may diverge from public built API/types; suppression may precede usable replacement | Deliver supported exchange and goal view together; verify source/built loading and in-flight replacement before claiming completion |

## Recommended Order

1. **T0001 — Readable goal list and status:** independently useful inspection over existing state.
2. **T0002 — Live goal progress with selective delegate replacement:** coupled cross-package live presentation and isolation.

Parallel execution is possible with the coordination above. Do not publish a global mute or a hidden goal task without the corresponding usable goal progress surface as an intermediate completed outcome.

## Ticket Index

| Ticket | File | Outcome |
| --- | --- | --- |
| T0001 | [T0001-readable-goal-list-and-status.md](./T0001-readable-goal-list-and-status.md) | Read-only human summaries/details with exact IDs, correct state semantics and record-error visibility |
| T0002 | [T0002-live-goal-progress-and-selective-delegate-ui.md](./T0002-live-goal-progress-and-selective-delegate-ui.md) | In-flight goal/subagent progress replacing only owned compact rows through the public delegate boundary |

## Refinement Handoff and Knowledge Boundary

- **Intent:** Show goal-level progress instead of duplicated low-level monitoring; make saved/current goals understandable without JSON.
- **Settled scope:** Compact above-editor goal progress; readable list/status; only goal-owned worker/reviewer compact rows suppressed; ordinary delegate tasks and all task queries remain available.
- **Constraints:** Spec 0020 R1–R6 and Spec 0019's authorization/execution/storage/review contracts; no pi-open-tui dependency, global mute, second runtime or durable UI bookkeeping.
- **Unresolved requirements:** None blocking. Precise layout, refresh cadence, retention and exported API names remain implementation details, not unconfirmed new product requirements. Return newly discovered semantic gaps to refinement.
- **Knowledge recording:** No CONTEXT/ADR write permission. Candidate consumer-scoped presentation ownership remains Pending in Spec 0020, not persisted as an ADR. Pending knowledge recording does not block ticket delivery.
- **Artifact boundary:** Consume settled requirements and established solution choices only. Organize/decompose/sequence them without inventing or revising domain facts, acceptance semantics, architecture or assumptions. Trace changes to sources; suspend for clarification if a new material choice is needed. Do not retrospectively invent a contract and record it as settled knowledge.
- **Next route:** Recommend user invocation of `grimoire-loop` on this ticket set when implementation is desired. This refinement does not start it.
