# Goal progress, readable inspection, and selective delegate presentation

**Spec ID:** 0020
**Status:** Draft
**Date:** 2026-11-15

## Sources and refinement handoff

- **C1 — Selected outcomes:** In this refinement conversation, the user selected lightweight goal progress presentation and a readable goal list from the [goal roadmap](../../packages/pi-goal/docs/roadmap.md), rather than the full first-release candidate set.
- **C2 — Presentation request:** The user wants goal use to replace delegate's execution-monitor UI with goal status identifying the executing subagent. The refinement proposal is a compact above-editor goal view, human-readable list/details, and presentation-only suppression rather than disabling execution or tracking.
- **C3 — Explicit suppression scope:** Asked whether only goal-owned worker/reviewer rows should be hidden while ordinary delegate tasks remain visible, the user answered affirmatively. Do not hide the entire Agents area or unrelated delegations merely because a goal is active.
- **C4 — Selected endpoint and permissions:** The user selected Spec → tickets. This turn authorizes these artifacts, not implementation, implementation plans, runtime tests/QA, publication, staging, commits, or CONTEXT/ADR recording.
- **P1 — Existing goal contract:** [Spec 0019](./0019-bounded-goals-on-delegate.md), especially R1–R6, establishes separate coordination/execution ownership, finite allowance, acceptance versus execution, independent review, global persistence and deliberate recovery. R7 establishes runtime-owned start confirmation, which this feature does not change.
- **P2 — Current goal surfaces:** [README](../../packages/pi-goal/README.md), [usage](../../packages/pi-goal/docs/usage.md), [runtime](../../packages/pi-goal/docs/runtime.md), [entry point](../../packages/pi-goal/src/index.ts), [controller](../../packages/pi-goal/src/controller.ts), [model](../../packages/pi-goal/src/model.ts) and [store](../../packages/pi-goal/src/store.ts). Commands currently notify JSON; saved goals have accepted/pending items, attempts, allowance, stop reasons and review. Store listing already separates valid goals from record errors.
- **P3 — Current delegate surfaces:** [public consumer API guide](../../packages/pi-delegate/docs/api.md), [public API](../../packages/pi-delegate/src/api.ts), [shared execution path](../../packages/pi-delegate/src/delegate.ts), [task records](../../packages/pi-delegate/src/tasks.ts) and [Agents widget](../../packages/pi-delegate/src/status.ts). API execution currently mounts ordinary Agents rows; taskId reaches goal's durable attempt on terminal return. The current API does not declare invocation-specific compact-row suppression or an early execution-observation callback. New live identity/presentation exchange requires a supported public integration change, not an assumption that those capabilities already exist.
- **P4 — Applicable responsibility constraints:** [ADR 0016](../adr/0016-unified-scope-local-task-discovery.md) separates non-visual records from presentation and preserves synchronous ownership; [ADR 0021](../adr/0021-query-only-background-result-retrieval.md) retains query-only background results; [ADR 0006](../adr/0006-runtime-concurrency-and-delegated-usage.md) separates accounting from expiring views; [ADR 0010](../adr/0010-independent-workspace-packages.md) establishes package independence. ADR 0006 is Proposed; current source and public documentation establish the implemented accounting boundary, not its status alone.

This spec adds presentation requirements to Spec 0019; it does not supersede its execution, authorization, storage or evidence contracts. The historical default that every accepted task appears in compact Agents is narrowed only for explicit consumer-managed presentation described here. Discovery, details and accounting remain unchanged.

Under `grimoire-refine`, artifact work consumes only settled conversation requirements and verified source contracts. It may organize and decompose them, but must not invent or revise domain facts, acceptance semantics, architecture or unconfirmed assumptions. A needed material decision returns to clarification. Artifact permission does not authorize CONTEXT/ADR recording. Tickets return to refinement; they do not start implementation or QA.

## Requirements

### R1 — Shared, truthful progress semantics

1. Derive presentation from existing goal state and delegate execution observations; do not introduce a second scheduler, execution owner, task manager or authoritative progress store. Presentation phases are projections, not new durable goal statuses.
2. Distinguish goal, logical work item, dispatch attempt and transient delegate task identity. Accepted/total counts reflect actual item acceptance, not successful child exits. Every-item acceptance alone is not goal completion; current affirmative independent review remains mandatory.
3. Distinguish the currently owned live runtime from saved state. A saved `active` record, saved running attempt or remembered taskId is not proof of a currently executing process. Unknown or unavailable observations must not be rendered as execution, success, zero consumption or approval.
4. Remaining allowance comes from the existing run's allowance and consumed dispatches. Identify it as dispatch allowance, not remaining model turns, tokens, cost or time. Inspection and redraw must not consume or renew allowance.
5. No current goal/draft, no plan yet, no current child, no review yet, and unavailable runtime observations have explicit, non-misleading empty/unknown representations. Current draft inspection must not imply execution was authorized.

**Trace:** C1–C2; P1 R1/R4/R6/R7; P2.

### R2 — Compact live goal progress

1. In the TUI, provide a lightweight above-editor goal progress view. It shows the objective, accepted/total item counts, remaining dispatch allowance, and current goal activity without requiring raw JSON inspection.
2. Identify the current worker's logical item and the executing subagent's exact taskId once observed. Identify independent review as review, not ordinary implementation work. Before delegate accepts a task or publishes its identity, show the real pending state without inventing a taskId or asserting that a child has started.
3. Distinguish coordination, waiting/admission or initialization, worker execution, independent review, and stopping/cleanup when those observations apply. Queued work is not running; a cancellation request is not completed cleanup. If finer observations are unavailable, disclose that limitation rather than infer a phase.
4. Surface pause/blocker reasons, recovery/reinspection requirements and the latest available independent-review outcome. A terminal worker remains distinct from pending evidence assessment; rejected or stale review cannot appear as completion.
5. Reflect changes during a pending synchronous worker/reviewer call, not only after its terminal result returns. Planning, acceptance, allowance changes and final goal outcomes update from the same authoritative state used by existing tools.
6. The view represents the current runtime's goal, not an implicitly focused globally saved goal. It must not revive old live execution after invalidation. Paused/completed state may be displayed honestly, but must not leave a running subagent indicator behind. Exact row count, typography and terminal-state retention are reversible presentation details, not a new execution contract.

**Trace:** C1–C2; P1; P2–P3. Timing/retention details are deliberately not borrowed from delegate's five-second terminal-row policy.

### R3 — Readable goal list and status

1. `/goal list` presents readable saved-goal summaries rather than raw state JSON as its primary human output. Each valid record includes objective summary, a copyable exact goal ID, saved status, accepted/total item counts and saved working directory. Do not dump attempt reports, full evidence or journal bodies into list summaries.
2. `/goal` and `/goal status` provide readable current goal/draft inspection. `/goal status <goal-id>` provides readable saved detail, including objective, acceptance conditions, item progress, allowance state when present, stop/recovery information when known, and latest available review outcome. Show a clear no-current-goal/draft result when appropriate.
3. Saved details explicitly state that they are saved observations, not a live execution guarantee. Only current-runtime observations can establish live activity. Do not claim that another session's record is locally owned, paused by this runtime, or safe to resume solely from its saved status.
4. An empty global store has a clear empty-list result. Damaged/unreadable goal records appear separately with their identity and error, while valid goals remain inspectable. An overall store access error remains a visible error rather than a false empty list. An invalid/missing goal ID produces an honest lookup/validation error, not a fabricated goal.
5. List/status remain read-only: no focus change, selection-driven execution, lease takeover, automatic recovery, repair, allowance grant or new journal writes. Existing model-facing structured goal tool results remain usable; human formatting must not force models to parse the new display or silently remove existing structured fields.

**Trace:** C1–C2; P1 R3–R5/R7; P2.

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

## Solution and necessary seams

Use goal's existing durable model and current runtime authority for goal-level progress. Obtain task identity and execution observations through an additive, supported delegate integration while the invocation is in flight. The goal-owned view presents these observations alongside item acceptance and allowance; delegate retains non-visual records, scheduling, execution, controls and accounting. Only the compact row for an explicitly presentation-managed invocation is suppressed.

Readable commands are inspection paths over the same state, not a picker or a new goal owner. Human formatting and model-facing structured observations remain distinct. No journal schema migration or persistent UI bookkeeping is required by this contract.

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Goal progress | Existing controller/draft/store → human views | Goal identity, authority, saved progress, allowance, reasons and review | Consistent counts/status; saved/live separation; no new dispatch authority |
| Invocation presentation | Goal → supported delegate API → compact Agents | Invocation-specific replacement intent captured before row display | Hidden goal worker/reviewer rows; unchanged ordinary rows, records and ledger |
| Live task observations | Delegate acceptance/records → goal attempt/view | Exact accepted task identity and observed phase within the owning invocation/scope | In-flight subagent correlation without title matching or terminal-return delay |
| Human inspection | User commands → goal/store | Current inspection or exact saved goal ID | Readable summaries/details and separate record errors without mutation |
| Existing machine inspection | Parent tools → goal/delegate records | Existing structured query contracts | Usable structured observations with no new charge or automatic delivery |
| Lifecycle | Host/goal/delegate boundaries → view resources | Pause, cancellation/cleanup, invalidation and late callbacks | Honest stopping/terminal state, disposed old views and unrelated-task isolation |

## End-to-End Tests

These describe required future acceptance, not checks executed in this refinement turn.

### E1 — Worker progress without duplicate Agents rows (R1–R2, R4–R5)
- **Given:** A confirmed goal, a planned item and an unrelated ordinary delegate task, with controlled queue/initialization/execution holds.
- **When:** Goal dispatches its worker and the user observes the TUI before the synchronous invocation returns.
- **Then:** The goal view shows real pending/admission and later actual subagent identity/activity. The goal task never appears as a compact Agents row; the unrelated task does. Both accepted tasks remain discoverable in delegate tools and the on-demand panel. Finishing the worker alone does not increment accepted items or complete the goal.

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

## Decisions and boundaries

- **Selective replacement, not global mute:** C3 explicitly resolves the visibility scope. On-demand delegate inspection is unchanged; only goal-owned compact rows are replaced.
- **One presentation increment, two delivery slices:** Progress plus replacement share the same in-flight identity/lifetime contract and belong together. Readable commands are a separate verifiable outcome over existing saved/current state. Ticket ordering coordinates shared files without inventing a data dependency.
- **No new runtime or storage ownership:** P1 and P4 remain binding. Public integration details are implementation choices within R4–R5; inventing a new scheduler, journal status or authorization path is not.
- **Assumptions/limitations:** Precise styling, row count, refresh cadence and terminal-view retention are unspecified reversible details. No performance threshold, exact cost/token ceiling, live-provider compatibility or broader Pi-version support is established by this spec. These artifacts do not claim runtime verification.
- **Knowledge recording:** No CONTEXT/ADR edits are authorized. The candidate durable rule that consumer-owned presentation can replace only its own compact rows while shared execution/records/accounting remain authoritative is retained here, unpersisted to the knowledge store pending authorization. This does not block the selected Spec → tickets endpoint.

## Verification guidance

Cover human output and deterministic renderer behavior, in-flight public API observation, default consumer compatibility, source/built co-loading, goal-owned versus unrelated task isolation, shared accounting and lifecycle races. Use controlled local providers and isolated temporary agent roots for implementation-time automation. Verify terminal width/theme/Unicode and keyboard/IME behavior where actual terminal interaction is exercised; distinguish manual evidence from RPC/adapter tests. No implementation tests or QA are run at this artifact-writing stage.

## Out of Scope

- Installation/publication/release work, separate reviewer configuration, or other first-release candidates not selected here.
- Objective/criteria revision, skip/reopen lifecycle, archival, picker/focus switching or automatic saved-goal execution.
- Recovery repair, schema migration, project-local UI/goal bookkeeping or reconnecting dead subagents.
- Full transcripts/live output/thinking display, complex dashboards, DAG engines, recursive teams or a duplicate delegate runtime.
- A global delegate UI off switch, hiding unrelated tasks, removing goal tasks from delegate queries/panel, or changing inherited child UI/confirmation forwarding.
- Changes to mandatory review, finite authorization, cleanup/cancellation ownership, query-only background delivery or usage-accounting semantics.
- Production/test edits, implementation planning, runtime QA, publication, staging/commits and CONTEXT/ADR mutation in this refinement endpoint.
