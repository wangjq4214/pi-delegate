# Task listing, unified details and floating task panel

**Spec ID:** 0009
**Status:** Draft
**Date:** 2026-10-08
**Sources:** [Roadmap — Task listing and details](../../packages/pi-delegate/docs/roadmap.md#1-task-listing-and-details); accepted refinement handoff H1–H3 below; [ADR 0016](../adr/0016-unified-scope-local-task-discovery.md).

## Source and coordination boundary

- **H1 — Accepted task-center scope:** The coordinator recommended listing and inspecting both synchronous and background delegations, introducing read-only synchronous task identifiers, retaining independent cancellation/manual steering for background tasks only, adding `delegate_list`, extending `delegate_status`, correlating numeric UI labels with taskId, and sharing non-visual task records across tools and TUI without transferring execution/accounting ownership. The user accepted with “其他的按照推荐就行”. The same accepted handoff preserves compact Agents rows, scope-lifetime record retention without TTL/count eviction, summary pagination, on-demand result access, and separate execution/delivery outcomes.
- **H2 — Floating-panel requirement:** The user required a floating TUI panel and suggested `packages/pi-open-tui/` as a style reference. The coordinator proposed theme-based padding/background/title/selection/hints, a single overlay with list-to-detail navigation rather than split panes or stacked dialogs, All/Active/Finished list filters, Overview/Result detail tabs, stable selection by taskId, inline cancellation confirmation and instruction composition, and close/focus restoration. The user invoked `grimoire-spec` and replied “确认” to that proposal.
- **H3 — Selected endpoint and knowledge boundary:** One spec, no slice, implementation plan, production/test edits or execution/QA. Consume only settled requirements and established choices; organize and express them without inventing domain facts, requirements, architecture, acceptance semantics or unconfirmed assumptions. Return any needed new material choice to refinement before resuming. Formatting or sequencing does not authorize filling semantic gaps.
- **A — Recorded decision:** [ADR 0016](../adr/0016-unified-scope-local-task-discovery.md), Proposed, records H1's responsibility/identity/retention boundaries and the floating-overlay/package-independence choice. It supersedes only [ADR 0004](../adr/0004-task-addressed-runtime-steering.md)'s exclusion of public synchronous task handles; the existing background-only steering contract remains applicable.
- **B — Existing contracts:** [Spec 0001](./0001-rpc-subagent-delegation.md) and [spec 0002](./0002-session-owned-background-delegation.md) establish synchronous ownership, fresh children, parent-only delegation, background scope, cancellation, query/completion and output behavior. [Spec 0003](./0003-subagent-soft-pressure.md) and [spec 0004](./0004-agent-status-ui.md) establish task-running time, completed turns, acknowledged pressure, theme/width safety and five-second visual retention. [Spec 0005](./0005-background-runtime-steering.md) establishes readiness, receipts and control closure. [Spec 0006](./0006-per-task-model-selection.md), [spec 0007](./0007-concurrency-scheduling-and-cost-visibility.md) and [spec 0008](./0008-delegation-cwd-and-bundled-worktree-skill.md) establish requested/effective startup configuration, admission/usage and selected/effective cwd semantics. [CONTEXT.md](../CONTEXT.md) has no additional domain definitions.
- **L — Inspected surfaces:** [delegate.ts](../../packages/pi-delegate/src/delegate.ts) connects validation, captured inputs, admission, runner events, synchronous/background ownership, accounting and lifecycle hooks. [background.ts](../../packages/pi-delegate/src/background.ts) owns background IDs/results/controllers, controls and completion delivery. [status.ts](../../packages/pi-delegate/src/status.ts) currently stores presentation observations only when bound to TUI and expires terminal rows. [inheritance.ts](../../packages/pi-delegate/src/inheritance.ts) filters parent-only tools during reconstruction. [Usage](../../packages/pi-delegate/docs/usage.md) and [Runtime](../../packages/pi-delegate/docs/runtime.md) document current behavior and limitations.
- **V — Presentation reference, not a dependency:** [pi-open-tui settings-command.ts](../../packages/pi-open-tui/src/settings-command.ts) uses a themed Box, Text, SelectList, tab navigation, compact layout and `ctx.ui.custom(..., { overlay: true })`. [Package guidelines](../../packages/pi-open-tui/AGENTS.md) and [ADR 0010](../adr/0010-independent-workspace-packages.md) prohibit dependencies between the packages. Installed Pi documentation inspected during refinement describes custom overlays, completion-callback disposal/focus, theme invalidation, terminal-column width handling and focused input/IME behavior. These are feasibility references, not UI acceptance evidence.

This specification explicitly extends older no-public-synchronous-handle clauses only for discovery and read-only queries. It does not extend synchronous execution lifetime or manual controls. No unresolved ADR conflict remains for the accepted scope. Exact overlay dimensions, pagination schema/page-size constants and component/module names are implementation details; this contract prescribes their observable boundaries, not unconfirmed numerical thresholds. The illustrative command name `/delegates` is not a mandated spelling.

## Requirements

### R1 — Discover accepted tasks in both execution modes

- Provide a parent-only task listing capability named `delegate_list`, without requiring a taskId as input. List accepted synchronous and background delegations in the current session/branch ownership scope, including queued, initializing, running and terminal work.
- Preserve existing pre-acceptance validation/failure behavior. A delegation rejected before task acceptance is not represented as accepted execution; a later startup or execution failure remains discoverable with its terminal outcome.
- Give each accepted task an exact query identifier and mode (`synchronous` or `background`). Background acknowledgement continues to return taskId without waiting; the terminal synchronous result includes its query identifier, and the initiating invocation still waits for and returns that result as before. A concurrently available list can discover a pending synchronous task.
- Preserve `completed`, `incomplete`, `failed` and `cancelled` meanings. Completed means a child final answer, not requirements acceptance or passing tests.
- Listing/detail state must exist independently of TUI mounting, including in supported non-TUI execution. Do not extend background support to one-shot print/JSON mode.
- Children cannot register, discover or invoke the new listing capability or other delegation-management capabilities; maintain existing reconstruction and parent-only reachability.

**Trace:** H1; ADR 0016; B/specs 0001–0002; L/delegate and inheritance.

### R2 — Exact identity and correlated numeric labels

- Make taskId the exact identifier for queries and supported controls. Preserve current background identifiers and their scope semantics.
- Expose the corresponding session-local numeric label in records, listing and details; TUI lists, detail headers and compact Agents rows refer to that same label for the same task.
- Retain monotonically increasing, non-reused labels within a session. Row expiry, filtering, sorting or branch-local record clearing must not renumber surviving tasks or reuse earlier labels within that session.
- A display abbreviation, numeric label or row index must not silently substitute for an exact taskId in public tool operations.
- Keep selected task identity stable while the live list changes. An action targets the selected exact identifier, not whichever task later occupies its row position.
- Retain parent-supplied title and first-task-line fallback without an extra model call. Presentation shortening must not destroy the task identity or make the actual title inaccessible in details.

**Trace:** H1–H2; ADR 0016; B/spec 0004 R2.

### R3 — Bounded summary listing and navigation

- List summaries, not full task/context text, result bodies, tool arguments, thinking content or accumulated transcripts.
- Each summary exposes identity/label/title/mode, execution status, elapsed task-running time, completed turns, current observed activity, whether a result is available, cancellation-in-progress and applicable control/readiness information.
- Support unfiltered, active and terminal task groupings. Active includes queued/initializing/running work until a terminal result exists, including cancellation/cleanup that has not yet produced its terminal outcome.
- Default listing prioritizes nonterminal tasks, followed by recently ended tasks. Use predictable ordering within groups and retain identity when ordering changes; exact tie-breaking is not prescribed.
- Bound individual responses and provide a way to request subsequent summaries when more matching records exist. Do not silently equate a bounded page with the complete task set. With an unchanged task set, paging must allow all matching records to be reached.
- Empty results must be distinguishable from a failed query. Filtering and pagination are observations, not actions that launch, cancel, steer, forget or charge tasks.
- Do not inject list updates automatically into the parent context or require repeated polling for ordinary background completion.

**Trace:** H1; ADR 0016; roadmap discovery requirement.

### R4 — Unified details through the existing query capability

- Extend `delegate_status({ taskId })` to query either mode in the owning scope without starting or waiting for task completion. Do not add a competing detail tool.
- Preserve existing background query result, outcome, usage/accounting, delivery-error and result-access behavior while adding metadata. New synchronous query metadata is additive; ordinary synchronous return/output/accounting remains unchanged.
- Details include identity, label, title, mode, execution status, requested/selected startup inputs, confirmed effective startup information when available, elapsed task-running time, completed turns, current activity/tools, pressure, available usage, available result/diagnostics and applicable control/delivery information.
- Requested model/thinking configuration is distinct from confirmed effective startup configuration. Report absence/unconfirmed values rather than presenting the request as confirmation. Preserve confirmed values through later failure/cancellation. Startup confirmation is not proof of provider consumption or immutable subsequent routing.
- Distinguish the selected absolute cwd captured at submission from effective absolute startup cwd observed after child spawn. A queued cancellation or pre-spawn failure must not claim effective cwd. Do not reinterpret selected cwd as the child's continuously observed current directory or a filesystem sandbox.
- Unknown, foreign or invalidated identifiers fail explicitly. A query must not create a replacement task or recover old-scope execution into the current scope.

**Trace:** H1; ADR 0016; B/specs 0002, 0006 and 0008; L/background result representation.

### R5 — Consistent execution observations and unknowns

- Use the established actual-task-onset time boundary, excluding queue residence and child/inherited-tool initialization. Elapsed time advances during provider/tool waits after onset, and stops at the established execution settlement/termination boundary rather than continuing on terminal records.
- Use completed assistant-plus-associated-tools turns. Streaming or unfinished tools do not complete a turn; parallel/nested tools do not independently add turns. Retain English `1 turn` / `N turns` labels.
- Retain the distinction between public execution phase, observed activity such as finishing, cancellation-in-progress and control readiness. Public `running` alone is not permission to steer.
- Show only observed current activity; do not infer thinking or a hung task from silence/time. Tool details expose current tool names without arguments. Represent concurrent tools without falsely asserting that a single displayed tool is the only one executing.
- Details expose configured pressure thresholds and the highest successfully accepted pressure stage (`none`, `warning`, `urgent`). Eligibility, local reservation, pending request or failed submission do not advance the acknowledged stage. Acceptance is not consumption/compliance, and pressure remains advisory.
- Clear obsolete current-tool/activity observations on settlement/termination and retain final duration/turn/pressure information for queries after visual expiry.
- Use the same observations in tools, compact rows and floating details; do not maintain contradictory independent execution counters in each view.

**Trace:** H1; ADR 0016; B/specs 0003–0005; L/status observation behavior.

### R6 — Available results, diagnostics and accounting

- Make available terminal output and result metadata accessible from details independently of summary listing and completion delivery. Before a result is available, say so rather than fabricating a final answer or live output stream.
- Preserve existing output/diagnostic availability on failure, incompleteness and cancellation, including bounded startup diagnostics where currently applicable. Do not fabricate diagnostics or usage that the runner/provider could not obtain.
- Preserve the difference between generation incompleteness and display truncation. Expose preview/truncation metadata and full-output file path when the existing result formatter supplies them; retain existing full-output artifact lifetime separately from execution-resource cleanup.
- Show latest available task usage and existing accounting limitations. Live/failure/cancellation usage may be partial; cost is an estimate, not an invoice.
- Listing, queries, overlay rendering and action receipts must not duplicate consumption accounting. Background queries retain separate usage and no new top-level charge; synchronous initiating-call accounting and the cumulative delegated ledger remain unchanged.
- Retain available result text as reported output, not validation that child-reported modifications or checks are correct.

**Trace:** H1; ADR 0016; B/specs 0001–0002 and 0007; L/output and usage contracts.

### R7 — Execution outcome independent of completion delivery

- Preserve background automatic completion delivery to the originating parent, including busy-parent follow-up and idle-parent turn triggering, for every existing terminal outcome.
- Expose available completion-delivery information separately from execution status. An observed delivery failure preserves the actual execution outcome, result and query access.
- Clearing/unprocessed completion messages or a delivery exception must not remove discoverability or result access. Successful submission is not durable parent-model consumption or exactly-once processing.
- Synchronous tasks do not gain background completion messages; their results still return through the original invocation. Delivery information is inapplicable rather than a falsely pending notification.
- Opening, viewing, refreshing or closing the task overlay does not itself trigger parent inference or alter background completion ownership.

**Trace:** H1–H2; ADRs 0002 and 0016; L/background deliveryError and retained results.

### R8 — Floating task-list presentation

- Provide an on-demand user command to open a floating task-management panel in TUI mode, above existing terminal content rather than replacing the compact Agents area or introducing a second terminal renderer.
- Use one overlay interaction with list-to-detail navigation, not a mandatory side-by-side layout or a stack of management dialogs. Listing offers All/Active/Finished filters corresponding to R3.
- Present each list item as a compact task title/identity row and secondary execution metadata row. Keep identifiers, mode and status distinguishable at narrow widths; wrap/shorten metadata safely and keep needed detail accessible.
- Use the pi-open-tui settings overlay as a visual/interaction reference: padded panel background, emphasized title/selection, understated descriptions/hints, keyboard navigation and narrow-terminal compact presentation. Exact borders, dimensions and glyphs in conversation sketches are illustrative, not fixed geometry.
- Follow Pi's current theme with semantic colors. Status colors supplement explicit text; do not hard-code a palette or introduce a separate extension theme. Visible content must redraw correctly on supported theme changes and resize events.
- Fit lines by visible terminal columns, not string length. Sanitize untrusted titles/tool names and other metadata so escape/control sequences cannot inject terminal styling or hidden lines. Render result content through a safe text/Markdown presentation path rather than replay arbitrary terminal control sequences.
- Do not import pi-open-tui's internal components, add a package dependency/shared runtime, require its installation or modify that package for this feature.

**Trace:** H2; ADR 0016; V/settings-command and package-independence guidance; B/spec 0004 theme/width/sanitization contract.

### R9 — Detail navigation and single-overlay controls

- Enter opens the selected task's details. Details provide Overview and Result tabs. Overview presents R4–R7 information; Result provides a scrollable available-result view with truncation/full-output-path information when applicable.
- Use Tab to move list filters/detail tabs as appropriate, Up/Down for selection or scrollable content, and Esc to return to the previous task-panel page or close from the list. Visible hints reflect the current page and available actions. No new global shortcut is required.
- Show independent cancellation and instruction actions only for eligible background tasks. For synchronous tasks, show read-only inspection and preserve initiating-call cancellation. Terminal tasks do not offer active execution controls. Queued/initializing background tasks remain cancellable without steering readiness; instruction actions display the not-ready reason. Cancelling/settled work displays the applicable control-closure reason.
- Cancellation confirmation and instruction composition remain within the same overlay. Before cancellation, show task identity/title and explain that cancellation does not roll back file changes or external side effects.
- After confirmed cancellation, show cancellation/cleanup progress without freezing redraw/input for the entire panel. Preserve the existing guarantee that successful cancellation completion waits for owned execution-resource cleanup. Cancelling an already finished background task preserves its existing result.
- Instruction composition accepts plain text and uses existing `delegate_steer` semantics. Display its actual receipt, including queued versus handled acceptance, readiness/terminal rejection and uncertain timeout without automatic retry or execution/compliance claims.
- In the instruction input page, `q` is ordinary text, not a close action. Esc abandons composition/returns to the previous page rather than sending it. Focus and cursor handling must preserve text-entry/IME operation.
- Revalidate exact identity, scope, terminal state, cancellation and readiness when an action is submitted. Task completion or invalidation between rendering and action must return the real rejection/result; it must not target another row or implicitly restart a child.

**Trace:** H1–H2; ADR 0016; B/specs 0002 and 0005; V/custom overlay/input guidance.

### R10 — Overlay and compact-row lifecycle

- Keep the existing compact above-editor Agents area, execution/usage display and five-second terminal-row retention. A record remaining in the floating panel does not keep its compact terminal row visible indefinitely.
- Update an open overlay from task observations while preserving selected taskId and usable navigation/scroll state. Do not rebuild its identity from current row positions or inject refresh messages into parent model context.
- Closing the overlay restores normal editor focus and does not cancel, steer or forget any task. Finish the interaction through the host's supported completion/disposal boundary and release panel-owned subscriptions/timers.
- Invalidate or close the old overlay when its owning scope is invalidated. Old observation callbacks and pending actions cannot repopulate or control a replacement/destination scope.
- Task discovery/query must remain functional without the overlay; opening it is not a prerequisite for recording execution.

**Trace:** H1–H2; ADR 0016; B/spec 0004 visual retention; V/overlay lifetime reference.

### R11 — Scope-lifetime retention without execution migration

- Retain accepted task records and available results until their session/branch scope is invalidated, independently of compact-row expiry or message processing. Do not introduce terminal TTL/count eviction; paging bounds returned information, not record retention.
- Preserve existing background invalidation/cancellation on branch navigation, session replacement, extension reload and exit, and suppress old completion delivery into the destination/closing runtime. Old identifiers fail explicitly and records are not reconstructed as live tasks in a replacement scope.
- Preserve synchronous invocation ownership and cancellation; adding records does not introduce independent background lifetime, public manual steering or independent task-addressed cancellation for synchronous work.
- Public task-addressed cancel/steer requests for synchronous identifiers reject explicitly without aborting the initiating call, granting a control or converting the task to background work.
- Guard recording against late old-scope observations/results so they cannot reappear after invalidation. Keep owned execution cleanup and the existing usage ledger's retained/late reconciliation rules separate from record visibility.
- Do not delete externally selected workspaces or change full-output artifact cleanup as part of forgetting scope-local records.

**Trace:** H1; ADRs 0002, 0006 and 0016; B/specs 0002, 0007 and 0008.

### R12 — Public guidance and compatibility

- Document listing, summary/detail separation, numeric-label/taskId mapping, synchronous read-only access, background-only controls, floating-panel entry/navigation and record lifetime.
- Explain requested versus confirmed configuration, advisory/accepted pressure, partial usage/estimated cost, completed-versus-accepted work and delivery-versus-execution outcomes.
- Preserve package-independent loading and existing delegation defaults, background acknowledgement, synchronous returns, accounting and result retrieval. Update tool descriptions and parent-only inheritance filtering consistently with the new capability.
- Keep English/Chinese package README guidance aligned where new public entry points are introduced; detailed requirements/documentation may remain English as in the existing package.

**Trace:** H1–H2; B/current public usage/runtime contracts and package documentation conventions.

## Solution

Provide a scope-local, non-visual record of accepted delegations and their observed state, correlated with exact taskId and existing numeric labels. Feed it from the established validation/admission/runner/owner boundaries so it exists in TUI and non-TUI modes. Tools and presentation read the same record rather than recovering task information from expiring widget rows.

The record boundary does not launch children, replace the runner's RPC ownership, change synchronous lifetime, own background delivery or become the usage ledger. Existing owners expose only the applicable narrow operations; read-only synchronous handles do not grant controls. Keep output artifacts and accounting governed by their established contracts.

Expose bounded summaries through `delegate_list` and enriched detail/result access through `delegate_status`. Use Pi's native custom overlay for a single list/detail/confirmation/composition flow, with the pi-open-tui settings panel as a presentation reference only. Keep compact Agents presentation as an independently expiring view of the same task observations.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Acceptance/identity | Validated invocation → task records and execution owner | Accepted mode/title, captured configuration/cwd, owning scope | Exact query identity, correlated numeric label, stable metadata before queue/execution; no invented accepted task for a rejected call |
| Execution observations | Admission/shared runner → task records → tools/Agents/overlay | Actual onset/settlement, phase, completed-turn/tool events, effective startup confirmation and pressure receipts | Consistent state/time/turn/activity/configuration across views, explicit unknowns and no cross-task leakage |
| Query/list boundary | Parent tools → current-scope records | Exact identifier or grouping/page request | Bounded summaries or on-demand details/results without launch, control, inference or duplicate charging |
| Synchronous return | Record/runner → initiating synchronous invocation | Existing final result/output/usage and correlated identifier | Additive read identity while retaining call-owned cancellation, blocking return and no background notification |
| Background operations | Panel/tool → background owner → runner-owned narrow controls | Exact scoped taskId, action text/confirmation, current readiness/lifetime | Existing cleanup-aware cancellation and truthful steering receipts; no synchronous control or terminal restart |
| Result and delivery | Runner/background delivery → records/query/result page | Available output/diagnostics/artifact metadata and observed delivery outcome | Retained result access independent of notification, separate execution/delivery facts |
| Accounting | Runner/owners → existing usage ledger and task records | Latest cumulative snapshots/final reconciliation | Existing separate delegated accounting and display-only observations, including established late cleanup reconciliation |
| Terminal interaction | User command → Pi custom overlay → current-scope records/operations | TUI mode, active theme/width/focus, keyboard input and live observations | Padded floating list/detail flow, bounded scrolling, stable selection, close/focus restoration and disposed subscriptions |
| Scope lifecycle | Session/runtime/branch boundaries → records, overlay and existing owners | Existing invalidation/closing events and possibly late old callbacks | Forgotten old handles/views, guarded actions/observations, preserved execution cleanup and no result migration |
| Parent-only reconstruction | Tool registration/inheritance → fresh child initialization | Updated delegation capability set | Listing/control unavailable to children, including through discovery/nested calls |

## End-to-End Tests

These are required future acceptance scenarios, not executed tests or claims that the feature exists.

### T1 — Rediscover queued, active and ended work in both modes (R1–R4)
- **Given:** Controlled synchronous/background tasks with distinguishable titles, occupied admission capacity and terminal outcomes covering completed/incomplete/failed/cancelled.
- **When:** The parent lists without remembered IDs and queries selected returned IDs, including while a synchronous call is pending.
- **Then:** Accepted tasks in both modes are discoverable with correct phases/modes/identities; terminal details correspond to the original results. A pre-acceptance rejection is not mislabeled accepted execution. Synchronous final returns remain call-owned and carry query identity without background delivery.

### T2 — Bounded listing, filtering and stable selection (R2–R3, R8–R10)
- **Given:** Enough records to require multiple pages, an unchanged-set paging case and a separate open-overlay case with live completion/new acceptance.
- **When:** The parent walks pages/filters and the user selects a task while the live list updates.
- **Then:** The unchanged set is fully reachable through bounded summaries with no result/context/transcript leakage; filters/order match the contract. The selected action/details still target the same exact taskId despite sorting/insertion changes. Empty selection is not reported as a transport/query failure.

### T3 — Headless details and requested/effective startup facts (R1, R4–R5)
- **Given:** A long-lived RPC parent without TUI, a task held in queue, one cancelled before spawn, one failing before configuration confirmation and one started with adjusted thinking level.
- **When:** Tasks are listed/queried before and after admission/termination.
- **Then:** Query metadata exists without mounting UI; selected cwd/requested model are not effective confirmation. Spawned startup cwd and confirmed configuration are retained through later failure/cancellation; adjusted effective thinking differs truthfully from the request.

### T4 — Time, turns, concurrent tools and pressure acknowledgement (R5)
- **Given:** Separate initialization/task-onset holds, an assistant response with parallel/nested tools, held pressure receipts and a provider with no thinking events.
- **When:** Tools and receipts complete and execution settles before final result collection ends.
- **Then:** Initialization/queue time is excluded, time advances during actual execution waits and freezes at settlement; one complete response-plus-tools increments one turn. Concurrent tool names are represented, no thinking is inferred, accepted pressure advances only on successful receipt, and tools/compact rows/overlay agree. Settlement/readiness/finishing are not conflated with public running.

### T5 — Result recovery after row expiry and delivery failure (R6–R7, R10–R11)
- **Given:** A completed background task with recognizable output, tested with a cleared completion message and an observed delivery exception, plus an oversized result using the existing full-output artifact behavior.
- **When:** More than five seconds pass after terminal availability and the parent/user rediscovers and opens the task result.
- **Then:** The compact row is gone but listing/details/result remain available. Delivery error is separate from completed execution. Truncation metadata/path remain usable; no model-consumption claim or result deletion occurs.

### T6 — Floating navigation, theme, resize and focus (R8–R10)
- **Given:** Pi TUI with only pi-delegate installed, normal and narrow terminal sizes, wide-character titles and an active theme change.
- **When:** The user opens the command, navigates filters/details/Overview/Result, scrolls output, resizes/changes theme and closes the panel.
- **Then:** A single floating panel remains usable above existing content with correct current-theme styling and width bounds; compact Agents behavior remains intact. Details stay identifiable and closing restores editor focus without cancelling work or triggering inference. pi-open-tui is not required.

### T7 — Cancellation confirmation, cleanup progress and races (R9–R11)
- **Given:** Queued/active background tasks, a synchronous task and a controlled cleanup hold; also a background task ending between detail rendering and cancellation submission.
- **When:** The user confirms cancellation in the overlay while cleanup is held, navigates/closes the panel and tests the terminal race.
- **Then:** Confirmation identifies the task and warns against rollback assumptions. Progress can redraw while cleanup proceeds; cancellation completion waits for owned cleanup. Synchronous independent controls are unavailable; the terminal race preserves the real finished result. No workspace rollback/removal or accidental neighboring-task cancellation occurs.

### T8 — Instruction input, receipts and terminal race (R9)
- **Given:** Background work tested before readiness, during running, after settlement and with queued/handled/uncertain receipt outcomes, plus a synchronous task.
- **When:** The user composes text including `q` and non-ASCII input, submits or abandons it, and exercises completion racing submission.
- **Then:** q is typed normally, cursor/focus support input, Esc does not submit abandoned text. Actual readiness/receipt outcomes are shown without restart, buffering rejected input, automatic uncertain retry or consumption/compliance claim. Synchronous manual steering stays unavailable.

### T9 — Scope invalidation while the overlay/action is active (R4, R10–R11)
- **Given:** An open old-scope panel with selected task, pending control/observation and background execution, with available late usage reconciliation.
- **When:** Branch navigation, session replacement, reload or shutdown invalidates ownership and old callbacks settle.
- **Then:** Old records/handles/views are unavailable, the old overlay is invalidated/closed, old work cannot repopulate or trigger destination inference, and actions cannot control new-scope tasks. Existing background cleanup and accounting-retention rules remain intact; no task persistence or workspace deletion is introduced.

### T10 — Accounting, output and parent-only compatibility (R1, R6–R7, R12)
- **Given:** Known synchronous/background usage, ordinary/truncated/failure outputs and reconstructed children with tool discovery/nested-call access.
- **When:** Queries, pagination, result viewing and completion delivery are repeated, and a child attempts to discover/use delegation management.
- **Then:** Consumption is not counted repeatedly, synchronous initiating-result accounting is unchanged, background queries remain separate/no extra top-level charge, and output/diagnostic limits remain consistent. Children cannot reach the management capabilities. Public usage guidance matches the available tools and panel.

## Decisions

- **Choice:** Inspect both modes, control only background tasks. **Reason/source:** H1 and ADR 0016 resolve the mismatch between both-mode Agents display and background-only discovery without changing synchronous lifetime/control.
- **Choice:** Shared non-visual records, not UI-owned history or a new execution manager. **Reason/source:** H1 and ADR 0016 preserve execution/accounting ownership while making headless discovery and post-row-expiry recovery possible.
- **Choice:** Exact taskId with explicit numeric-label mapping. **Reason/source:** H1–H2 and ADR 0016 prevent live ordering/expiry from changing the operation target.
- **Choice:** Scope-lifetime retention and bounded summary paging, not automatic eviction or durable history. **Reason/source:** H1 and ADR 0016 preserve result recovery within existing ownership at the acknowledged memory cost.
- **Choice:** Single native floating overlay with list/detail/action pages and pi-open-tui-inspired presentation only. **Reason/source:** User requirement H2, ADR 0016 and existing package-independence guidance.
- **Choice:** One requirements contract, no slice or implementation work at this endpoint. **Reason/source:** H3; tool and panel behavior share the same identity/state/control/lifecycle acceptance boundaries.

## Test Plan

- Exercise task discovery/detail flows through a real supported Pi RPC parent using deterministic local providers/controlled child fixtures. Unit snapshots alone do not establish headless execution ownership or query recovery.
- Exercise the real TUI overlay's rendering, keyboard focus/input, scrolling, theme invalidation, resizing, action races and disposal. Include regular and fullscreen terminal behavior where supported; do not claim full keyboard/terminal E2E from SDK-mode tests alone.
- Include untrusted ANSI/control metadata and result text, Unicode/combining/wide characters, multiple simultaneous tools, large output and cancelled/failed partial usage.
- Re-run affected baseline lifecycle, admission, pressure, configuration/cwd, output, steering, usage and inheritance checks during implementation. Verify documentation claims against actual interfaces.
- No new performance, refresh-latency, memory-ceiling or provider-billing threshold is promised. This spec-writing stage runs no feature tests or QA; future reports must distinguish source feasibility, automated integration evidence and manual terminal evidence.

## Out of Scope

- Independent task-addressed synchronous cancellation, public synchronous manual steering, or background lifetime/completion messaging for synchronous work.
- Cross-session history, persistent task service, execution surviving exit/reload, or reconstruction/resumption of invalidated handles.
- Full live output/transcript streaming, recent-event logs, tool arguments or child thinking-content display.
- Result handoff templates/schemas, parent acceptance automation, automatic arbitrary retries, pause/resume and new execution budgets.
- Plugin-owned worktrees/merges/rollback, filesystem confinement or workspace cleanup.
- A pi-open-tui dependency/shared runtime, modifications to that package, or a second terminal renderer.
- Slice/ticket creation, implementation planning, production/test changes and execution/QA at this selected endpoint.
