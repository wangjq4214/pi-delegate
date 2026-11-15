# Live goal progress with selective delegate UI replacement

**Ticket ID:** T0002
**Source:** [Spec 0020](../../spec/0020-goal-progress-and-readable-list.md), R1–R2, R4–R5, widget/API portions of R6 and E1–E2/E5–E8; [set relationships](./README.md).
**Status:** Todo

## Goal

While goal work or review is running, users see a compact goal-level view identifying the actual subagent, without duplicate goal-owned rows in delegate's Agents widget and without hiding unrelated work or changing execution/accounting.

## Affected Surfaces

- Goal [entry point](../../../packages/pi-goal/src/index.ts), [controller](../../../packages/pi-goal/src/controller.ts) observation/presentation integration and live view lifecycle; durable [model](../../../packages/pi-goal/src/model.ts) remains authoritative for goal progress rather than UI phases.
- Delegate [public API](../../../packages/pi-delegate/src/api.ts), [service](../../../packages/pi-delegate/src/api-service.ts), [shared invocation path](../../../packages/pi-delegate/src/delegate.ts), [task records](../../../packages/pi-delegate/src/tasks.ts) and [compact Agents view](../../../packages/pi-delegate/src/status.ts).
- Public built API declarations/import compatibility, source/built co-loading and focused goal/delegate presentation/lifecycle/accounting tests.
- Goal README/usage/runtime and delegate public API guidance for changed presentation guarantees.

## Approach

Deliver the supported in-flight task-identity/phase and invocation-scoped presentation exchange together with its goal-view consumer. Existing API execute returns taskId terminally; do not assume an early callback or row suppression is already supported. Exact public names/transport are implementation choices within Spec R4–R5, not a new authorization or execution protocol.

Compose goal-owned live observations with existing acceptance, allowance, authority, stop/recovery and review state. Suppress only the compact row for the exact presentation-managed invocation before it is shown. Preserve non-visual task records, all on-demand queries/panel visibility, shared admission/ledger and invocation-signal ownership. Keep progress projections ephemeral and guard old-scope observations.

Keep the API seam and actual replacement view in one deliverable: splitting off a generic enabling ticket would leave the requested user outcome incomplete. Do not import delegate internals into goal, manipulate delegate's widget key or globally mute its status owner.

## Dependencies and Coordination

- **Blocked by:** None. Existing state plus the public extension owned by this ticket supplies the outcome; T0001's human command output is not an API dependency.
- **Blocks:** None.
- **Coordination risks:** Coordinate goal entry/tests/docs and shared semantic formatting with T0001; prefer sequential delivery to reduce overlapping edits. Within this ticket, verify the public producer/consumer exchange and source/built declarations as one contract. Scope suppression to exact invocation identity so parallel/unrelated work cannot inherit it.

## Acceptance

- [ ] A lightweight TUI view above the editor shows goal objective, accepted/total counts, remaining dispatch allowance and current activity, updating while synchronous worker/reviewer execution is still pending. It does not infer acceptance/completion from worker success. **R1, R2.1/R2.5.**
- [ ] The worker item and exact real subagent taskId are correlated as soon as available through the supported public boundary. Review is identified separately. Queue/init/run/coordination/cleanup phases reflect observations; pre-acceptance failures/cancellation and unavailable details do not invent accepted IDs or live processes. **R2.2–R2.3, R5.1.**
- [ ] Pause/blocker, exhaustion, recovery/reinspection and latest review outcome are visible when relevant. Rejected/error/stale review stays unfinished; only the existing current-review gate permits completion. Paused/completed/invalidated state leaves no false running-child indicator. **R2.4/R2.6; E2/E5/E6.**
- [ ] Goal worker/reviewer compact Agents rows are suppressed from initial display through their ordinary terminal retention, without a flash. Ordinary synchronous/background tasks and API consumers retain default rows/retention while a goal runs, even with matching titles. **R4.1–R4.2.**
- [ ] Hidden goal tasks remain discoverable/queryable through delegate list/status and `/delegates`; available reports/errors remain available. Synchronous tasks do not gain independent cancellation/steering. Goal never clears delegate's widget or hides unrelated tasks. **R4.3/R4.5.**
- [ ] Admission, execution, signal cancellation, cleanup, results and shared accounting stay unchanged. Repeated observations/redraws do not charge usage or allowance, exclude hidden tasks' consumed usage or trigger extra model calls/messages. Shared indicators remain truthful. **R1.4, R4.4, R5.5.**
- [ ] The public extension supports existing default API clients and verifies source/built package imports/declarations and both extension load orders. Unsupported required capability produces a visible compatibility error rather than global muting/private imports; no second runtime or pi-open-tui dependency is introduced. **R4.5, R5.4.**
- [ ] Observer/view failure or disposal cannot dispatch duplicate work or grant evidence acceptance. Pause/abort, navigation, replacement, reload/shutdown and late observations/results cannot repopulate a replacement view or restore authority. Disposal alone is not execution cancellation; actual pause continues through existing goal-owned signals and waits for cleanup. **R5.2–R5.3.**
- [ ] Non-TUI execution/records/structured inspection work without mounting the widget. Ordinary background results remain query-only. **R5.5.**
- [ ] Live rendering is Unicode/display-width safe at normal/narrow widths, treats objective/item/error text as untrusted text, follows the active host theme and releases view-owned timers/subscriptions. Precise styling/cadence/retention are not new product guarantees. **R6.1–R6.2, E8.**
- [ ] Goal guidance explains live phases, subagent identity, saved/live and accepted/executed distinctions, allowance and selective replacement. Delegate API guidance documents public observation/presentation lifetime, default compatibility and continued query/panel visibility. Claims match verified behavior. **R6.3.**
- [ ] Verification covers Spec E1/E2/E5/E6/E7 and widget portion of E8, including queued/running/review/cancelled/failed outcomes, cleanup holds, early rejection, matching-title unrelated tasks, accounting and late old-scope callbacks. Use isolated roots and deterministic actual-host source/built scenarios; distinguish those results from manual terminal/IME/provider evidence. **Spec verification guidance.**

## Out of Scope

Readable human command output (T0001); global delegate UI disable, hiding on-demand records/panel, inherited child-dialog suppression, full transcript/output/thinking streaming, workflow engines, durable UI state/schema migration, execution surviving restart, review bypass, allowance changes, automatic background delivery, publication or broader host-version promises. Ticket creation itself does not authorize implementation or QA.
