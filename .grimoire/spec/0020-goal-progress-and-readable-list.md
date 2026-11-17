# Goal progress, readable inspection, and selective delegate presentation

**Spec ID:** 0020
**Status:** Draft
**Date:** 2026-11-15

## Sources and refinement handoff

- **C1 — Selected outcomes:** In this refinement conversation, the user selected lightweight goal progress presentation and a readable goal list from the [goal roadmap](../../packages/pi-goal/docs/roadmap.md), rather than the full first-release candidate set.
- **C2 — Presentation request:** The user wants goal use to replace delegate's execution-monitor UI with goal status identifying the executing subagent. The refinement proposal is a compact above-editor goal view, human-readable list/details, and presentation-only suppression rather than disabling execution or tracking.
- **C3 — Explicit suppression scope:** Asked whether only goal-owned worker/reviewer rows should be hidden while ordinary delegate tasks remain visible, the user answered affirmatively. Do not hide the entire Agents area or unrelated delegations merely because a goal is active.
- **C4 — Original endpoint and permissions:** The original refinement selected Spec → tickets, without implementation, implementation plans, runtime tests/QA, publication, staging, commits, or CONTEXT/ADR recording. C6 below governs the current visual amendment.
- **C5 — Visual refinement and approved direction:** In the subsequent UI discussion, the user supplied a screenshot showing a long instruction/path-heavy objective, separate worker/item/UUID/review rows and delegate capacity/usage below. The user requested subtle animation and some color, explicitly accepted moving UUID out of the permanent view, and then approved the complete proposed direction: a short goal title, a compact three-row layout, omission of routine not-yet-reviewed text, activity-only animation and theme-based localized emphasis.
- **C6 — Current selected endpoint and permissions:** The user approved amending this existing spec only, without new tickets, implementation, implementation planning or runtime QA. CONTEXT/ADR writes remain unauthorized. C5 narrows the original R2 requirement to show exact task identity permanently: identity stays exact and inspectable in details, not in the compact view.
- **P1 — Existing goal contract:** [Spec 0019](./0019-bounded-goals-on-delegate.md), especially R1–R6, establishes separate coordination/execution ownership, finite allowance, acceptance versus execution, independent review, global persistence and deliberate recovery. R7 establishes runtime-owned start confirmation, which this feature does not change.
- **P2 — Original goal baseline:** [README](../../packages/pi-goal/README.md), [usage](../../packages/pi-goal/docs/usage.md), [runtime](../../packages/pi-goal/docs/runtime.md), [entry point](../../packages/pi-goal/src/index.ts), [controller](../../packages/pi-goal/src/controller.ts), [model](../../packages/pi-goal/src/model.ts) and [store](../../packages/pi-goal/src/store.ts). At the original refinement, commands notified JSON; saved goals had accepted/pending items, attempts, allowance, stop reasons and review. Store listing already separated valid goals from record errors. This is historical baseline evidence, not a claim about current command formatting; see P5.
- **P3 — Original delegate baseline:** [public consumer API guide](../../packages/pi-delegate/docs/api.md), [public API](../../packages/pi-delegate/src/api.ts), [shared execution path](../../packages/pi-delegate/src/delegate.ts), [task records](../../packages/pi-delegate/src/tasks.ts) and [Agents widget](../../packages/pi-delegate/src/status.ts). At the original refinement, API execution mounted ordinary Agents rows and taskId reached goal's durable attempt on terminal return; invocation-specific suppression and early observation were not yet declared. This explains the original integration requirements, not the current capability set; P5 observes the current goal consumer.
- **P4 — Applicable responsibility constraints:** [ADR 0016](../adr/0016-unified-scope-local-task-discovery.md) separates non-visual records from presentation and preserves synchronous ownership; [ADR 0021](../adr/0021-query-only-background-result-retrieval.md) retains query-only background results; [ADR 0006](../adr/0006-runtime-concurrency-and-delegated-usage.md) separates accounting from expiring views; [ADR 0010](../adr/0010-independent-workspace-packages.md) establishes package independence. ADR 0006 is Proposed; current source and public documentation establish the implemented accounting boundary, not its status alone.
- **P5 — Current visual baseline inspected for this amendment:** [progress-view.ts](../../packages/pi-goal/src/progress-view.ts) renders the full objective with clipping, separate count/allowance, activity, item and exact taskId rows, plus a review row even before assessment; refresh is event-driven. [presentation.ts](../../packages/pi-goal/src/presentation.ts) already formats readable human list/status output but does not display the current live taskId in human current-goal details. [index.ts](../../packages/pi-goal/src/index.ts) supplies `presentation: "consumer"` and `onProgress` to delegate, and its current structured report includes dispatch activity. These observations support a presentation amendment, not a new executor or replacement of completed baseline integration.
- **P6 — Refresh ownership boundary:** [ADR 0025](../adr/0025-shared-open-tui-ui-refresh-ownership.md) governs scheduling of open-tui-owned consumers and excludes ownership of host/third-party timers. It does not require goal to depend on open-tui or use its private scheduler. This amendment retains R4.5 package independence and R5 lifecycle ownership.

This spec adds presentation requirements to Spec 0019; it does not supersede its execution, authorization, storage or evidence contracts. The historical default that every accepted task appears in compact Agents is narrowed only for explicit consumer-managed presentation described here. Discovery, details and accounting remain unchanged.

Under `grimoire-refine`, artifact work consumes only settled conversation requirements and verified source contracts. It may organize and decompose them, but must not invent or revise domain facts, acceptance semantics, architecture or unconfirmed assumptions. A needed material decision returns to clarification. Artifact permission does not authorize CONTEXT/ADR recording. Tickets return to refinement; they do not start implementation or QA.

## Requirements

### R1 — Shared, truthful progress semantics

1. Derive presentation from existing goal state and delegate execution observations; do not introduce a second scheduler, execution owner, task manager or authoritative progress store. Presentation phases are projections, not new durable goal statuses.
2. Distinguish goal, logical work item, dispatch attempt and transient delegate task identity. Accepted/total counts reflect actual item acceptance, not successful child exits. Every-item acceptance alone is not goal completion; current affirmative independent review remains mandatory.
3. Distinguish the currently owned live runtime from saved state. A saved `active` record, saved running attempt or remembered taskId is not proof of a currently executing process. Unknown or unavailable observations must not be rendered as execution, success, zero consumption or approval.
4. Remaining allowance comes from the existing run's allowance and consumed dispatches. Identify it as dispatch allowance, not remaining model turns, tokens, cost or time. Inspection and redraw must not consume or renew allowance.
5. No current goal/draft, no plan yet, no current child, no review yet, and unavailable runtime observations have explicit, non-misleading representations in inspection. The compact view may omit routine absence-of-review text under R7, but must not imply approval or hide a relevant unknown activity state. Current draft inspection must not imply execution was authorized.

**Trace:** C1–C2; P1 R1/R4/R6/R7; P2.

### R2 — Compact live goal progress

1. In the TUI, provide a lightweight above-editor goal progress view. It shows a concise objective summary, accepted/total item counts, remaining dispatch allowance, and current goal activity without requiring raw JSON inspection. R7 specifies the visual hierarchy; full objective text remains available in details.
2. Identify the current worker's logical item in the compact view. Make the executing subagent's exact observed taskId available through current goal details rather than a permanent UUID row (R3.6, R7). Identify independent review as review, not ordinary implementation work. Before delegate accepts a task or publishes its identity, show the real pending state without inventing a taskId or asserting that a child has started.
3. Distinguish coordination, waiting/admission or initialization, worker execution, independent review, and stopping/cleanup when those observations apply. Queued work is not running; a cancellation request is not completed cleanup. If finer observations are unavailable, disclose that limitation rather than infer a phase.
4. Surface pause/blocker reasons, recovery/reinspection requirements and the latest available independent-review outcome. A terminal worker remains distinct from pending evidence assessment; rejected or stale review cannot appear as completion.
5. Reflect changes during a pending synchronous worker/reviewer call, not only after its terminal result returns. Planning, acceptance, allowance changes and final goal outcomes update from the same authoritative state used by existing tools.
6. The view represents the current runtime's goal, not an implicitly focused globally saved goal. It must not revive old live execution after invalidation. Paused/completed state may be displayed honestly, but must not leave a running subagent indicator behind. R7–R8 constrain the visual treatment without creating a new execution contract; terminal-state retention is not newly prescribed.

**Trace:** C1–C2, C5–C6; P1; P2–P3, P5. Timing/retention details are deliberately not borrowed from delegate's five-second terminal-row policy.

### R3 — Readable goal list and status

1. `/goal list` presents readable saved-goal summaries rather than raw state JSON as its primary human output. Each valid record includes objective summary, a copyable exact goal ID, saved status, accepted/total item counts and saved working directory. Do not dump attempt reports, full evidence or journal bodies into list summaries.
2. `/goal` and `/goal status` provide readable current goal/draft inspection. `/goal status <goal-id>` provides readable saved detail, including objective, acceptance conditions, item progress, allowance state when present, stop/recovery information when known, and latest available review outcome. Show a clear no-current-goal/draft result when appropriate.
3. Saved details explicitly state that they are saved observations, not a live execution guarantee. Only current-runtime observations can establish live activity. Do not claim that another session's record is locally owned, paused by this runtime, or safe to resume solely from its saved status.
4. An empty global store has a clear empty-list result. Damaged/unreadable goal records appear separately with their identity and error, while valid goals remain inspectable. An overall store access error remains a visible error rather than a false empty list. An invalid/missing goal ID produces an honest lookup/validation error, not a fabricated goal.
5. List/status remain read-only: no focus change, selection-driven execution, lease takeover, automatic recovery, repair, allowance grant or new journal writes. Existing model-facing structured goal tool results remain usable; human formatting must not force models to parse the new display or silently remove existing structured fields.
6. Current human goal details (`/goal` or `/goal status`) expose the complete objective and the exact current subagent taskId once observed, together with its role and observed activity. Before acceptance/identity observation, disclose that identity is unavailable; do not substitute a shortened UUID or a previous attempt's ID as current. Saved details remain saved observations under R3.3. Removing the permanent UUID row must not require users to parse raw JSON or search task titles to inspect the executing subagent.

**Trace:** C1–C2, C5–C6; P1 R3–R5/R7; P2, P5.

### R4 — Selective replacement of compact delegate rows

1. Goal's worker and reviewer invocations use consumer-managed presentation: omit their per-task rows from delegate's compact above-editor Agents widget, including queued, active and short-lived terminal rows. Do not first flash an ordinary row and remove it after terminal return.
2. Ordinary synchronous/background delegate calls and API consumers that do not request replacement retain their existing compact presentation and retention behavior, including while a goal is active. Suppression follows exact invocation/task identity, not title matching, current row order or a runtime-global mute flag.
3. Goal-owned hidden tasks remain ordinary accepted delegate records, inspectable through existing list/status tools and `/delegates`. Do not hide them from the on-demand delegate panel, erase records/results, suppress errors, or grant independent synchronous task controls.
4. Shared admission, child execution, invocation-signal cancellation, owned cleanup, result return and exactly-once usage accounting remain unchanged. Hiding a row must not remove consumed usage from the delegated aggregate or create a second accounting charge in goal. Shared capacity/usage indicators must remain truthful even when some tasks are not rendered as rows.
5. Use delegate's supported public consumer boundary for task-specific presentation intent and live identity/state observation. Goal must not deep-import delegate UI internals, impersonate its widget key, clear its entire view, or create another executor. No pi-open-tui dependency is introduced.

**Trace:** C2–C3; P1 R2/R5; P3–P4.

### R5 — Public observation and lifecycle contract

1. The public integration must associate task acceptance/identity and available phase observations with the originating goal attempt while synchronous execution is pending. Publish only observed identities/states, and distinguish rejection or cancellation before acceptance from an accepted task. Do not recover correlation by searching task titles.
2. Consumer-managed presentation and observation must be scoped to the invocation and existing runtime lifetime. Observing, unsubscribing or disposing presentation does not itself cancel, resume, restart or take ownership of execution. UI failures must not produce duplicate dispatch or change a completed child into accepted goal evidence.
3. Pause/abort, branch invalidation, session replacement, reload and shutdown must release old view resources and prevent late observations/results from repopulating a replacement goal/runtime. Goal pause continues to cancel only its owned work through existing execution signals; unrelated delegate rows and work remain unaffected.
4. Extend the supported public API compatibly for existing consumers and both source/built package loading. Unsupported required presentation/observation capability must be reported rather than silently globally muting Agents or bypassing the public boundary. Exact exported names, optional-field spelling and observation transport remain implementation details to be verified, not prescribed here.
5. Non-TUI loading must not require mounting a widget to record/observe tasks, execute goal work or use existing structured inspection. No UI-only polling/refresh may inject extra model messages, launch model calls, or change delegate's query-only background-result contract.

**Trace:** C2–C4; P1 R2/R5; P3–P4.

### R6 — Usable rendering and accurate guidance

1. Human views remain readable at normal and narrow terminal widths, respect display width for Unicode/Chinese text, and treat task/objective/path/error contents as text rather than terminal control instructions. Clipping/wrapping must not replace the exact identity needed for status lookup with an ambiguous abbreviation.
2. Apply the active host theme to TUI views and release presentation-owned subscriptions/timers on disposal. Do not add a complex dashboard or make pi-open-tui a prerequisite.
3. Update goal usage/runtime guidance to explain progress phases, saved versus live state, accepted versus executed work, dispatch allowance and selective Agents replacement. Update delegate consumer API guidance for the new public integration, including default compatibility and task visibility. Documentation must not claim the feature is delivered before implementation/verification.

**Trace:** C1–C3; P2–P4 and existing themed/width-aware presentation conventions.

### R7 — Compact visual hierarchy

1. Replace the instruction-heavy heading with a concise display title derived from the existing objective. The title is a presentation summary, not an objective/criteria edit or a new authorization. Keep the full original objective available in human details (R3.6); do not make extra model calls to generate a title.
2. Use a stable three-row normal layout at sufficient terminal width: goal title with accepted/total count; current activity with logical item ID/title when applicable; remaining/total dispatch allowance as secondary metadata. Combine worker status and item information instead of separate label-only rows. Use lightweight grouping rather than a full enclosing box or dashboard.
3. Do not permanently show the subagent UUID or a routine `Review: not yet assessed` row. Details retain exact observed identity and explicit review absence. During review, make the activity unmistakably independent review. Rejected/stale review, blockers, recovery requirements and relevant failures remain visible rather than being removed as cosmetic noise.
4. The three-row layout describes the ordinary sufficiently wide view, not a hard cap that hides important state. Narrow layouts may reflow safely; actionable exceptional states may add concise information. Keep animation frames from changing layout height or shifting the task text.
5. Keep shared Agents capacity and cumulative usage visually secondary. They remain delegate-owned shared statistics, not goal-only usage or a second goal task list. This amendment does not require merging them into goal's three rows, relocating delegate's widget, duplicating accounting or changing unrelated task presentation.

**Trace:** C5–C6; P5; R1–R6. The example below illustrates hierarchy, not an exact width, fixed column position or additional persisted title field:

```text
◆ Goal · Pane workspace                                  3/5 accepted
  ⠹ Running · T0004 · Pane commands, input safety and exit lifecycle
  16/18 dispatches left
```

### R8 — Restrained motion and theme-based color

1. Add one small animated activity indicator near the current activity label, using a restrained spinner such as Braille frames. Advance it during observed ongoing activity, including worker execution and independent review, even when no new task event arrives. Its motion indicates activity, not percentage complete or evidence acceptance. Pending/admission, initialization, execution, review and cleanup labels must retain their distinct truthful meanings.
2. Stop activity animation for paused/inactive, completed or failed goals and non-executing drafts; use static state symbols instead. A terminal child awaiting assessment must not keep a child-running animation. Stop presentation-owned periodic work when there is no animation demand, and dispose it on the existing lifecycle boundaries in R5.3. Late ticks must not repaint a replaced runtime.
3. Apply localized emphasis through the active host theme, not hard-coded RGB: an accent/purple-like goal marker, cyan-like active-state emphasis, prominent accepted/total figures, warning/yellow-like pause or low-allowance indications, error/red-like failures and success/green-like actual completion. Task text retains normal foreground; paths, IDs and auxiliary usage remain muted. Color intent must adapt to the theme rather than requiring particular hues in every theme.
4. Text and static symbols must distinguish state without color or motion alone. Do not tint entire blocks uniformly, flash text, scroll titles, or introduce fabricated progress bars. Only the small activity indicator moves; the rest of the layout stays stable between actual content changes.
5. Animation is display-only: it must not poll external execution to invent state, dispatch model work, renew allowance, mutate accepted counts or alter authorization. Keep timely event-driven state changes; do not delay pause/completion/failure display until an animation tick. Preserve package independence and presentation-resource ownership; no open-tui dependency or private refresh import is required (P6).

**Trace:** C5–C6; P5–P6; R1, R4.5, R5 and R6. Exact spinner sequence/cadence and any low-allowance highlighting threshold are not prescribed; low allowance must not be mislabeled as exhaustion.

## Solution and necessary seams

Use goal's existing durable model and current runtime authority for goal-level progress. Obtain task identity and execution observations through an additive, supported delegate integration while the invocation is in flight. The goal-owned view presents these observations alongside item acceptance and allowance; delegate retains non-visual records, scheduling, execution, controls and accounting. Only the compact row for an explicitly presentation-managed invocation is suppressed.

Readable commands are inspection paths over the same state, not a picker or a new goal owner. Human formatting and model-facing structured observations remain distinct. No journal schema migration or persistent UI bookkeeping is required by this contract.

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Goal progress | Existing controller/draft/store → human views | Goal identity, authority, saved progress, allowance, reasons and review | Consistent counts/status; saved/live separation; no new dispatch authority |
| Invocation presentation | Goal → supported delegate API → compact Agents | Invocation-specific replacement intent captured before row display | Hidden goal worker/reviewer rows; unchanged ordinary rows, records and ledger |
| Live task observations | Delegate acceptance/records → goal attempt/view | Exact accepted task identity and observed phase within the owning invocation/scope | In-flight subagent correlation without title matching or terminal-return delay |
| Human inspection | User commands → goal/store and current runtime observations | Current inspection or exact saved goal ID; real observed activity when locally owned | Readable summaries/details, complete objective, exact observed current taskId and separate record errors without mutation |
| Existing machine inspection | Parent tools → goal/delegate records | Existing structured query contracts | Usable structured observations with no new charge or automatic delivery |
| Lifecycle | Host/goal/delegate boundaries → view resources | Pause, cancellation/cleanup, invalidation and late callbacks | Honest stopping/terminal state, disposed old views and unrelated-task isolation |
| Visual refresh | Observed goal activity + active host theme → compact presentation | Animation demand, state transitions and owning runtime lifetime | Stable themed frames; demand-only animation; immediate state invalidation; no execution/accounting effects |

## End-to-End Tests

These describe required future acceptance, not checks executed in this refinement turn.

### E1 — Worker progress without duplicate Agents rows (R1–R2, R4–R5)
- **Given:** A confirmed goal, a planned item and an unrelated ordinary delegate task, with controlled queue/initialization/execution holds.
- **When:** Goal dispatches its worker and the user observes the TUI before the synchronous invocation returns.
- **Then:** The goal view shows real pending/admission and later actual activity and logical item; current goal details expose the exact observed subagent identity without a permanent UUID row. The goal task never appears as a compact Agents row; the unrelated task does. Both accepted tasks remain discoverable in delegate tools and the on-demand panel. Finishing the worker alone does not increment accepted items or complete the goal.

### E2 — Acceptance, review, rejection and completion (R1–R2, R4)
- **Given:** A worker result pending evidence assessment and allowance sufficient for the exercised path.
- **When:** The parent accepts evidence, runs independent review, and exercises rejected/error/stale review and current approval cases.
- **Then:** Counts change only on actual acceptance; review has distinct in-flight presentation and no compact delegate row. Rejected/error/stale review leaves the goal unfinished. Only current valid approval permits completion; no stale running-child indicator remains.

### E3 — Readable global list and exact saved lookup (R1, R3, R6)
- **Given:** Goals from different working directories with active/paused/complete saved states, distinguishable counts and Unicode objectives/paths.
- **When:** The user lists goals and copies an exact ID into `/goal status <goal-id>`.
- **Then:** Summaries/details expose the required human-readable fields without report dumps or raw JSON dependence; exact lookup identifies the intended record. Saved active/attempt state is not presented as confirmed live execution. No goal starts, changes focus, acquires an execution lease or gains allowance.

### E4 — Empty, damaged and unavailable records (R3)
- **Given:** An absent store, mixed valid/corrupt records, an overall store-access failure and invalid/missing lookup IDs in separate cases.
- **When:** The user lists or inspects goals.
- **Then:** Empty, partial-success-with-record-errors and overall failure are distinguished. Valid records remain visible beside per-record errors. No repair, replacement journal, project-local bookkeeping or execution is inferred.

### E5 — Allowance exhaustion, pause and cleanup (R1–R2, R4–R5)
- **Given:** Controlled goal work/review and an unrelated delegation, tested with allowance exhaustion and a cleanup hold.
- **When:** The allowance runs out or the user pauses during queue/execution/cleanup and results arrive late.
- **Then:** The view explains exhaustion/pause and distinguishes cancellation requested from settled cleanup. No extra model wrap-up or fresh dispatch runs. Unrelated task UI/execution remain intact, consumed usage is retained exactly once, and late approval cannot falsely complete/restart the goal.

### E6 — Restart and scope invalidation (R1–R2, R5)
- **Given:** An active goal view and pending observations, tested across branch navigation, replacement, reload/shutdown and a later restart with saved records.
- **When:** The old scope ends and old callbacks settle, then the user inspects saved progress.
- **Then:** Old live indicators/subscriptions cannot populate the replacement scope; global records remain inspectable as saved state without automatic resume or live task reconnection. Explicit resume/reinspection retain Spec 0019's existing requirements.

### E7 — Public API, non-TUI and accounting compatibility (R3–R5)
- **Given:** Existing API consumers, an invocation opting into presentation replacement, ordinary synchronous/background calls, a non-TUI parent, and separately built/source extension entries in both load orders.
- **When:** Tasks execute and are repeatedly observed, including pre-acceptance failure/cancellation, provider failure and unknown phase data.
- **Then:** Existing consumers keep default presentation/behavior. Goal receives only real accepted identity and available observations through the public entry. Query results, cancellation ownership and shared accounting remain unchanged; no UI is required for records. Unknowns/errors remain explicit; no automatic background result messages or duplicate model/usage charges occur. Unsupported integration is visible, not an internal-import fallback.

### E8 — Width, theme and untrusted display text (R6)
- **Given:** Normal/narrow TUI widths, Unicode/Chinese and multiline/control-containing objective/path/error text, and a theme change.
- **When:** Live progress and readable commands render and the owning view is disposed.
- **Then:** Content remains width-safe and text-only, exact goal identity remains recoverable for lookup, active theme changes apply, and disposed resources do not continue updating. Record automated renderer evidence separately from manual terminal/IME evidence.

### E9 — Compact hierarchy and on-demand exact identity (R2–R3, R7)
- **Given:** A running goal with a long instruction/path-heavy objective, a known logical item and observed taskId, alongside delegate's shared statistics and an unrelated task.
- **When:** The user views progress at a sufficient width, then opens `/goal status` while the worker is still pending; repeat before task identity is observed and at narrow widths.
- **Then:** The ordinary goal view uses three rows with a concise title, accepted count, combined activity/item and dispatch allowance; it contains neither a permanent UUID nor a routine not-yet-reviewed row. Human details retain the complete objective, exact observed taskId and explicit unavailable/review-absent states without raw JSON. Narrow rendering remains safe. Delegate statistics stay secondary, truthful and delegate-owned; unrelated task visibility and accounting remain unchanged.

### E10 — Motion follows real activity and stops with its owner (R1–R2, R5, R8)
- **Given:** Controlled worker/reviewer execution held without new progress events, plus draft, pending/admission, initialization, terminal-result-assessment, pause, cleanup and completed/failed cases.
- **When:** The view is rendered across animation ticks and actual state transitions, then disposed or replaced while an old tick is pending.
- **Then:** Worker/review activity visibly animates without new task events and without shifting surrounding text or height. Labels do not mistake queued/initializing/cleanup work for running execution. Drafts, inactive/paused, completed/failed goals and ended-child assessment do not retain a running-child animation. State transitions apply without waiting for a tick; idle/disposed presentation stops its periodic work, and late ticks cannot repopulate a new scope. No model call, external polling, allowance charge, evidence acceptance or execution change is caused by animation.

### E11 — Restrained color, exceptions and truthful completion (R1–R2, R6–R8)
- **Given:** Running/reviewing, paused, recovery-required, failed, review-rejected/stale and truly completed goals, with theme changes and Unicode text.
- **When:** The user observes each state, including low/exhausted allowance and all-items-accepted-but-review-pending cases.
- **Then:** Goal marker, activity, counts and warning/error/success states use localized current-theme emphasis; task text remains normal and auxiliary metadata muted. Labels/static symbols remain understandable without color or animation. Important blocker/review/recovery information remains visible even if it needs concise extra space. All-items-accepted alone never receives goal-completion treatment. There is no flashing, scrolling title, whole-block tint or invented progress percentage. Verify actual terminal glyph/color/motion readability separately from automated renderer evidence.

## Decisions and boundaries

- **Selective replacement, not global mute:** C3 explicitly resolves the visibility scope. On-demand delegate inspection is unchanged; only goal-owned compact rows are replaced.
- **Original delivery slices; current spec-only amendment:** The original progress/replacement and readable-command slices remain independent outcomes. C6 selects an amendment to this existing contract for one bounded visual improvement; no new tickets, ticket updates, implementation plan or execution are authorized.
- **No new runtime or storage ownership:** P1 and P4 remain binding. Public integration details are implementation choices within R4–R5; inventing a new scheduler, journal status or authorization path is not.
- **Assumptions/limitations:** R7–R8 now settle the compact hierarchy, three-row normal layout, detail-only UUID, restrained animation and semantic color direction. Exact title-shortening algorithm, glyph sequence, refresh cadence and terminal-view retention remain reversible implementation details, bounded by source-derived display text, no additional model calls, width safety and honest state. No new journal field, shared dashboard or cross-package refresh dependency is selected. No performance threshold, exact cost/token ceiling, live-provider compatibility or broader Pi-version support is established; these artifacts do not claim runtime verification.
- **Knowledge recording:** No CONTEXT/ADR edits are authorized. The earlier candidate durable rule that consumer-owned presentation can replace only its own compact rows while shared execution/records/accounting remain authoritative remains unpersisted pending authorization. This visual amendment adds task-specific requirements rather than a new domain concept or durable architecture decision, so no new qualifying recording batch is needed. Pending earlier recording does not block this spec-only endpoint.

## Verification guidance

Cover human output and deterministic renderer behavior, in-flight public API observation, default consumer compatibility, source/built co-loading, goal-owned versus unrelated task isolation, shared accounting and lifecycle races. For the visual amendment, cover E9–E11, including animation advancing without new task events, static terminal/paused states, resource cleanup, detail lookup of full objective/exact taskId, theme changes and three-row normal layout. Use controlled local providers and isolated temporary agent roots for implementation-time automation. Verify terminal width/theme/Unicode, Braille glyph rendering, actual motion/readability and keyboard/IME behavior where actual terminal interaction is exercised; distinguish manual evidence from RPC/adapter tests. No implementation tests or QA are run at this artifact-writing stage.

## Out of Scope

- Installation/publication/release work, separate reviewer configuration, or other first-release candidates not selected here.
- Objective/criteria revision, skip/reopen lifecycle, archival, picker/focus switching or automatic saved-goal execution.
- Recovery repair, schema migration, project-local UI/goal bookkeeping or reconnecting dead subagents.
- Full transcripts/live output/thinking display, complex dashboards, DAG engines, recursive teams or a duplicate delegate runtime.
- A global delegate UI off switch, hiding unrelated tasks, removing goal tasks from delegate queries/panel, or changing inherited child UI/confirmation forwarding.
- Changes to mandatory review, finite authorization, cleanup/cancellation ownership, query-only background delivery or usage-accounting semantics.
- Production/test edits, implementation planning, runtime QA, publication, staging/commits and CONTEXT/ADR mutation in this refinement endpoint.

## Implementation evidence — visual amendment

The user's subsequent explicit `grimoire-loop` invocation authorized implementation, targeted verification, joint Code Risk / Intent Check, affected fixes, formatting and reporting for C5/R7–R8 and the related current-details requirement R3.6. This supersedes C6's spec-only restriction for this execution turn, not product exclusions or the separate CONTEXT/ADR authorization gate. The bounded presentation change used the Direct path without a Plan artifact or new/updated tickets. Spec status remains Draft; automated evidence is not manual terminal acceptance.

Implemented in [progress-view.ts](../../packages/pi-goal/src/progress-view.ts) and [presentation.ts](../../packages/pi-goal/src/presentation.ts), with existing command/report wiring. Goal/controller schema, delegate execution, public integration, accounting and authorization were not changed. Shared Agents statistics retain their existing delegate-owned secondary presentation rather than being copied into goal's rows.

| Scoped outcome | Implementation and evidence |
| --- | --- |
| R7 / E9 — Compact hierarchy | Three-row ordinary layout, source-derived first-clause title capped by display width, combined activity/item, secondary dispatch allowance, no permanent UUID or routine absent-review row. Narrow widths may use another header row; important exceptions remain visible. `visual-progress.test.ts` checks normal/narrow layouts, dotted paths/versions, Unicode/control escaping, original-state immutability and full objective in details. |
| R3.6 / E9 — Exact human inspection | Current `/goal` / `/goal status` details show the exact observed subagent ID and worker/reviewer activity, or explicit unavailable identity. Saved attempts never establish live activity. Updated `creation.adapter.test.ts` checks the real command handler during held execution and existing navigation/shutdown disposal; structured reports remain unchanged. |
| R8 / E10 — Restrained motion and lifetime | A 120ms unreferenced presentation timer advances only an observed running worker/reviewer spinner, without cloning authoritative history on ticks. Queue/initialization, assessment, cleanup, pause and terminal states stay static. Deterministic cancelled/late-tick tests and a real-clock test cover demand, immediate stop, rebinding, disposal and current-theme rendering. Temporarily removing the stale-callback guard caused the cancelled-callback test to fail on an extra redraw; restoring it returned all ten new visual tests to passing. No mutation remains. |
| R8 / E11 — Color and honest outcomes | Active host theme tokens emphasize the marker/counts, cool activity foreground, warnings/errors and actual current-reviewed completion; task titles remain normal and metadata muted. All-items-accepted and stale approval do not get completion styling. Blockers/recovery/review failures retain visible text. No flashing, scrolling title or fabricated progress percentage was introduced. |

Verification on the resulting source/built tree:

- `bun run check` and `bun run typecheck`: passed across the workspace.
- `bun run build`: passed; goal was rebuilt again after the final behavioral/formatting changes.
- `env -u PI_DELEGATE_CHILD -u PI_DELEGATE_SNAPSHOT bun run --filter @wangjq4214/pi-goal test`: **224 passed, 1 platform skip, 0 failures**, across 12 files. This includes all ten new visual tests, existing controller/store/adapter tests, actual pinned Pi 1.1.0 source/built RPC integration and lifecycle tests. The skip is the existing POSIX-permissions case on Windows.
- After the restored test mutation, all ten visual tests passed again. Joint inline Code Risk and Intent Check inspected the complete production/test/documentation diff, including the new test file, and the affected controller/command/delegate presentation boundaries; no confirmed blocker was found.
- `git diff --check`: passed. No full runtime suite for the other unchanged workspace packages was run for this bounded goal presentation increment.

Remaining evidence limits: actual terminal font/Braille appearance, light/dark-theme contrast, motion comfort, and keyboard/IME/user visual acceptance were not manually exercised. Renderer, real-clock and RPC/adapter checks do not substitute for those observations. Title shortening is deliberately deterministic rather than a semantic model-generated name. Existing terminal-state retention is unchanged. No commit, release, CONTEXT/ADR write or modification to the unrelated `.omnidiff.toml` was performed.
