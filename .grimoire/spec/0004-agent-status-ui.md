# Minimal agent status UI

**Spec ID:** 0004
**Status:** Draft
**Date:** 2026-10-03
**Revised:** 2026-10-16
**Sources:** The original settled refinement conversation and its presentation follow-ups; the 2026-10-16 user request to restyle the above-input delegate UI using `packages/pi-open-tui/` as a visual reference and hide it when the last agent disappears, followed by approval of H-refresh/H-icons below and the spec-only route.

## Source and coordination boundary

- **H — Settled handoff:** Show synchronous and background child agents above the Pi terminal input; exclude the parent. Use session-local increasing numeric labels without reuse, a title, elapsed task-running time, completed turns with English labels, current activity, and the highest successfully submitted pressure stage. Titles are supplied by the parent, falling back to a shortened first task line without an extra model call. Terminal rows show their existing outcome for 5 seconds, then disappear. Do not add other information.
- **H-pressure — Final clarification:** `pressure: none / warning / urgent` reflects the highest stage whose child RPC steering request has been accepted. Eligibility, pending submission, acceptance, model consumption, and compliance are not interchangeable.
- **H-presentation — Settled follow-up (2026-10-04):** The user requested more distance from the screen edges, clearer color distinction for execution status, and integration with Pi's theme configuration. The user then explicitly invoked `grimoire-spec` and accepted the proposed scope and defaults: adjust only the above-input Agents area; leave 2 terminal columns on each side and 1 blank line between it and adjacent content/input, counting host-provided spacing rather than duplicating it; allow reduced horizontal spacing on narrow terminals; retain English status text with the semantic color mapping in R8; keep titles in normal text color and time/turns/separators secondary; follow the active Pi theme, including switching and custom-theme hot reload, without hard-coded RGB or separate extension theme configuration. Preserve execution, pressure acknowledgement, and 5-second retention. Selected endpoint: revise this spec only, with no slice, implementation plan, production/test changes, or QA execution.
- **B — Existing lifecycle contracts:** [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md), Superseded in its exclusively synchronous lifecycle by [ADR 0002](../adr/0002-session-owned-background-delegation.md), Completed; [spec 0002](./0002-session-owned-background-delegation.md), Implemented. Fresh RPC children, parent-only delegation, inheritance, synchronous cancellation, background ownership, result delivery/query, and cleanup remain unchanged.
- **P — Existing pressure contract:** [ADR 0003](../adr/0003-per-delegation-soft-pressure.md), Completed; [spec 0003](./0003-subagent-soft-pressure.md), Implemented, establishes task-running time, completed assistant-plus-tools turns, two advisory pressure stages, and the distinction between RPC acceptance and model consumption/compliance.
- **L — Inspected implementation:** [src/delegate.ts](../../packages/pi-delegate/src/delegate.ts) supplies both invocation paths, the shared `runDelegation` runner, and terminal outcomes; [src/rpc.ts](../../packages/pi-delegate/src/rpc.ts) supplies task event subscriptions and success/error responses to steering; [src/pressure.ts](../../packages/pi-delegate/src/pressure.ts) observes actual task onset and `turn_end` and reserves stages before asynchronous steering; [src/background.ts](../../packages/pi-delegate/src/background.ts) supplies background task/result ownership; [README.md](../../packages/pi-delegate/README.md) documents these contracts.
- **V — Baseline presentation inspection (before the follow-up implementation):** [src/status.ts](../../packages/pi-delegate/src/status.ts) renders the existing aboveEditor widget without horizontal spacing or theme styling; [tests/status.test.ts](../../packages/pi-delegate/tests/status.test.ts) covers state, lifecycle, metadata sanitization, and width bounds; [tests/fixtures/status-ui.ts](../../packages/pi-delegate/tests/fixtures/status-ui.ts) uses the installed host's widget adapter and terminal renderer. Installed Pi 1.0.0 reference sources: `node_modules/@earendil-works/pi-coding-agent/docs/tui.md` (Apply themes correctly), `docs/themes.md`, `dist/core/extensions/types.d.ts` (`setWidget` theme callback and `ui.theme`), and `dist/modes/interactive/interactive-mode.js` (host-provided leading widget spacing). These establish available host integration, not acceptance of the new presentation behavior.

The selected permission is to write and verify this one spec, not production code, tests, tickets, or an implementation plan. Consume only settled requirements and established choices; do not invent domain facts, acceptance semantics, architecture, or unconfirmed assumptions. Return any needed new decision to refine before continuing. Formatting and sequencing do not authorize filling semantic gaps.

The 2026-10-04 permission is to revise and verify this same spec at the spec-only endpoint. The prior implementation verification at the end of this document is historical evidence for R1–R6; it neither verifies R7–R8 nor authorizes their implementation. No blocking gap or ADR conflict was found for the accepted presentation-only delta.

**Subsequent execution authorization (2026-10-04):** After the spec-only revision, the user invoked `grimoire-loop` to implement R7–R8 under the default plan, implementation, testing, review/check, assessment/fixes, final verification, and formatting workflow. This supersedes the revision's spec-only execution exclusions for that bounded change, not its requirements or existing lifecycle contracts. See the dated presentation verification below for evidence and limitations.

Spec 0003 excludes new parent pressure telemetry from that feature's scope. This separately authorized UI feature adds pressure visibility without changing the pressure policy or invalidating that earlier scope boundary. No ADR conflict was identified.

**Model/thinking extension (2026-10-04):** In a later refinement, the user accepted per-task model selection, requested model/thinking visibility in this same Agents area, refined the metadata row to `│  model: ... · thinking: ...` aligned with the activity text after `└─ `, and explicitly invoked `grimoire-spec`. [Spec 0006 — Per-task model selection and Agents UI configuration visibility](./0006-per-task-model-selection.md) is the authoritative contract for that separately authorized startup-configuration feature. It extends the original allowed-field restriction only with a dedicated configuration row; the first summary and current activity/outcome remain. R1–R8, counting, acknowledged pressure, theme, spacing and 5-second retention otherwise remain unchanged. **Implementation update (2026-10-04):** implementation, tests and verification of that startup-selection/metadata follow-up were subsequently authorized and completed. [Spec 0006 § Implementation Verification](./0006-per-task-model-selection.md#implementation-verification-2026-10-04) is the evidence and limitation record; the historical R1–R6 and R7–R8 verification below remains scoped to those features.

**Concurrency/usage extension (2026-10-04):** The user accepted runtime-local FIFO concurrency scheduling, queued/initializing/running visibility, per-task usage and a cumulative delegated total, with usage formatted as `↑8.2k ↓1.1k R20k W0 · $0.04`. [Spec 0007 — Concurrency scheduling and delegated cost visibility](./0007-concurrency-scheduling-and-cost-visibility.md) remains authoritative for scheduling and accounting. Its original requirement to keep the aggregate visible without child rows is superseded by R10 below; accumulated consumption is still retained independently of presentation. Other counting, acknowledged-pressure, model confirmation, theme/width/spacing and 5-second task-row-retention contracts remain unchanged.

- **H-refresh — Approved restyling and empty-panel behavior (2026-10-16):** The user requested a prettier delegate UI above input, suggested `packages/pi-open-tui/` as a visual reference, and wanted the UI to disappear when the final agent disappears. The user then accepted the recommendation: compact vertical rails rather than a heavy full enclosing border; prominent titles/current activity with secondary metadata; retain model/thinking, time, English turns, pressure, per-task usage and delegated total; keep the existing 5-second terminal retention, then hide the entire panel including heading, aggregate and panel-owned blank space when the last row expires. Hiding must not clear accounting: a later task in the same runtime brings the panel back with retained cumulative usage. Borrow visual style only, without a dependency on `pi-open-tui`. Selected endpoint: revise this existing UI spec only; no tickets, implementation plan, production/test edits or QA execution.
- **H-icons — Approved visual preview (2026-10-16):** After asking to see the expected UI and whether it includes icons/colors, the user accepted the preview and recommendation: a few ordinary Unicode symbols, no required Nerd Font, running/tool activity in the theme's accent role, completed in success, incomplete/warning pressure in warning, failed/urgent pressure in error, and secondary rails/model/usage/time styling. Keep normal title color and status text rather than relying on icons/colors alone. Blue/green/yellow/red in the conversational legend illustrate semantic roles, not fixed RGB requirements. The preview allows pressure to be grouped with per-task usage; exact row placement remains illustrative. This relaxes the earlier first-summary-row pressure placement in R1/spec 0006 R6, but not pressure visibility or acknowledgement meaning. The existing spec-only endpoint remains selected.
- **H-rail — User-directed visual correction (2026-10-16):** After the live multi-agent demonstration, the user requested the side line use the current Open TUI Git branch color and originate at the `#` marker. The inspected normal-branch renderer in [Open TUI footer](../../packages/pi-open-tui/src/footer.ts) uses Pi's `mdLink` role. Use that live semantic color for the `#` root and connectors, place `│`/`└` directly below `#`, and remove the summary-row rail to the left of the task icon. This supersedes the earlier muted outer rail/illustration only; task icon/outcome/pressure colors, metadata alignment, lifecycle and package independence remain unchanged. This request authorizes the bounded follow-up implementation and checks.
- **H-label — User-directed color correction:** The user then requested that the number after `#` share the `#` color. Apply `mdLink` to the whole `#<label>` as one label; keep task-title, status-icon and pressure colors unchanged.
- **V-refresh — Current evidence:** [AgentStatus](../../packages/pi-delegate/src/status.ts) currently keeps the widget mounted/rendered when cumulative usage exists even without rows, while terminal rows expire after 5 seconds. [Open TUI's compact-layout documentation](../../packages/pi-open-tui/README.md#compact-message-layout) and [message rails](../../packages/pi-open-tui/src/message-layout.ts) supply the visual reference, not a new configuration/runtime contract.
- **Current precedence and knowledge boundary:** H-refresh and R9–R10 govern this revision. R10 supersedes only spec 0007 R6's empty-panel visibility sentence and its “Row expiry, branch navigation and runtime reset” scenario's expectation of a still-visible total. Accounting retention, contribution replacement, runtime reset and separate parent/delegated totals remain governed by [ADR 0006](../adr/0006-runtime-concurrency-and-delegated-usage.md). R9 extends the decorative rail placement illustrated by spec 0006 R7 while preserving its metadata/activity text alignment and confirmation semantics. Package independence is already established by [ADR 0010](../adr/0010-independent-workspace-packages.md) and [ADR 0011](../adr/0011-import-upstream-open-tui-extension.md); no architectural decision changes. There is no qualifying new CONTEXT/ADR update: the delta is ordinary presentation requirements plus preservation of existing boundaries. No unconfirmed semantic assumptions or blocking decisions remain. Earlier execution authorizations and verification below do not authorize or verify this revision.

**Subsequent execution authorization (2026-10-16):** The user explicitly invoked `grimoire-loop` after approving the icon/color preview. For this bounded reversible UI change, the selected route is implementation → targeted verification → report, without a separate plan file or independent review/check stage. This authorizes the scoped status renderer, regression tests and associated usage/runtime documentation; prior spec-only execution exclusions are historical, not a restriction on this invocation.

## Requirements

### R1 — Compact terminal placement and coverage

- Display one compact status list in a fixed area above the Pi terminal input.
- Include child agents launched by this extension in both synchronous and background mode. Do not include the parent agent.
- Do not use or introduce preset roles such as `Explore`, `Plan`, or role-based identities.
- The first row for each child contains its numeric label, task title, elapsed running time and completed-turn count, with decorative rail/icon styling as specified in R9. Keep the acknowledged pressure state visible for that same task; R9 allows grouping it with usage rather than fixing it to the first row. A subordinate row shows current activity or the terminal outcome. The separately authorized [spec 0006](./0006-per-task-model-selection.md#r6--modelthinking-visibility-in-the-existing-agents-ui) adds a dedicated model/thinking configuration row between them, with its effective-value semantics defined there; [spec 0007 R7](./0007-concurrency-scheduling-and-cost-visibility.md#r7--compact-agents-capacity-and-usage-presentation) adds capacity, delegated total and per-task usage. These additions remain visible while the panel is present (R9–R10).
- This is terminal UI scope; existing non-TUI delegation remains operational without requiring this display.

**Trace:** H; B for existing execution modes.

### R2 — Numeric identity and title

- Number children `1`, `2`, `3`, and so on in startup order within the current session. Do not reuse an assigned number within that session when an earlier row disappears.
- The numeric label is a UI identity. Preserve existing background task IDs and their query/cancellation semantics; the display does not replace them.
- Allow the parent to provide a display title when delegating. If omitted, use the first line of task text shortened for display. Do not call another model to generate the title.
- Title truncation and narrow-terminal layout are presentation details; they must not cause a child to be confused with another row or add hidden task/context content to the display.

**Trace:** H; B/L for existing background IDs. Exact public title-field naming and truncation length are not prescribed.

### R3 — Running time and English completed-turn labels

- Start elapsed running time at actual child-task onset, excluding child-process and inherited-tool initialization. Include provider execution, tools, and waiting during the task.
- Display completed execution turns: one completed assistant response with its associated tools/results is one turn. Streaming responses and still-running associated tools do not complete a turn; individual, parallel, or nested tools do not add turns separately.
- Use English labels: `1 turn` and `N turns` for other counts, including `0 turns`. Do not use Chinese turn suffixes (for example, Unicode escape `\u8f6e`).
- Elapsed time progresses while the child remains running, including during a long provider/tool wait without new events. Terminal rows retain the final observed duration and completed-turn count rather than continuing to accrue running time.
- Initialization is not evidence of task running time, completed task turns, or thinking. Do not count initialization activity as task execution.

**Trace:** H and the user's English-label correction; P for the accepted counting/time definitions. No numerical refresh-rate SLA or particular duration format is specified.

### R4 — Current activity, not a log

- Show only the current activity on the child's activity row, for example `thinking…` or `toolcall · read` / `toolcall · bash`.
- For observed tool execution, display the tool name without arguments. Do not display thinking content, result bodies, or accumulated activity history.
- Do not infer `thinking` from elapsed time, silence, or a generic running state when no thinking event is observed.
- Activity observations must belong to the same child and must not leak into another child's row. Later execution or termination updates must not leave an obsolete activity represented as current.
- Activity wording for initialization, other observed activities, and simultaneous tool calls remains an implementation detail within these constraints and R8's agreed color mapping; it cannot claim unobserved thinking or add an activity log.

**Trace:** H. This contract specifies observed status labels, not access to hidden chain-of-thought.

### R5 — Acknowledged pressure visibility

- Display `pressure: none`, `pressure: warning`, or `pressure: urgent` for every row.
- `none` means no stage has yet received successful child RPC acceptance. `warning` means warning has received successful acceptance and urgent has not. `urgent` means urgent has received successful acceptance.
- Update the indicator only after a successful response to that task's pressure-steering submission. Merely crossing a time/turn threshold, reserving a stage for deduplication, queuing local work, or writing a request is insufficient.
- A pending, rejected, failed, or timed-out submission does not advance the visible stage. Preserve the highest previously accepted stage; accepted urgent never regresses to warning.
- The indicator means submission accepted, not that the model consumed or obeyed the instruction. It must not introduce a compliance claim or reinterpret the terminal outcome.
- Each task's pressure display is independent. Observing it must not send additional reminders, change thresholds, trigger cancellation, or alter the existing soft-pressure policy.

**Trace:** H-pressure; P's advisory/acknowledgement distinction. L's `TaskPressure.issued` is reserved before steering succeeds and therefore is not sufficient evidence for this indicator.

### R6 — Terminal retention and ownership

- Show the existing terminal outcome as `completed`, `incomplete`, `failed`, or `cancelled` on the subordinate row instead of obsolete running activity.
- Keep the terminal row visible for 5 seconds after its terminal outcome becomes available, then remove it. Removal is visual only: do not discard a background result still queryable under its existing contract.
- Preserve numbering of remaining rows; disappearance of an earlier row does not renumber active children or permit reuse of its number within the session.
- Bound rows, observations, and display timers to their owning session/runtime. Session replacement, extension reload, shutdown, and existing background branch invalidation must not let old-child updates repopulate the replacement/destination display.
- Preserve existing synchronous cancellation, session-owned background lifetime, background completion delivery/query, result meanings, usage accounting, and resource cleanup. UI activity/retention is not an alternative execution owner or result channel.

**Trace:** H for terminal retention; B/P for lifecycle and outcome boundaries.

### R7 — Breathing room within the Agents area

- Apply spacing only to the extension's existing above-input Agents area; do not change Pi's overall interface layout.
- At widths that accommodate the contracted content and spacing, inset the heading and child rows by 2 terminal columns from the left edge and reserve 2 terminal columns at the right edge. Measure and truncate content within the remaining width, not the full terminal width.
- While the Agents area is visible, keep 1 blank line between it and the adjacent content above, and 1 blank line between it and the input below. Count spacing supplied by Pi as part of these gaps; do not add another blank line where the host already supplies one. When the panel is hidden, it contributes no spacing of its own (R10).
- On narrow terminals, horizontal spacing may shrink to avoid consuming columns needed for numeric identity and status. Every rendered line must still fit the supplied terminal width; spacing does not relax R2's identity or R1–R6's content boundaries.

**Trace:** H-presentation for approved spacing and scope; V for the existing rendering surface and host spacing. No fixed narrow-width breakpoint was selected.

### R8 — Semantic status colors that follow Pi's active theme

- Keep the existing English activity/outcome and pressure text. Color is supplementary, not the only way to identify status, and does not change its execution or acknowledgement meaning.
- Style activity/outcome text with the active Pi theme's semantic foreground roles:

| Activity/outcome | Pi theme role |
| --- | --- |
| `running…`, `thinking…`, `toolcall · <tool name>` | `accent` |
| `completed` | `success` |
| `incomplete` | `warning` |
| `failed` | `error` |
| `initializing…`, `finishing…`, `cancelled` | `muted` |

- Independently style the pressure indicator according to its highest accepted stage: `none` uses `dim`, `warning` uses `warning`, and `urgent` uses `error`. Threshold eligibility or a pending/failed steering submission must not change either its text or color (R5). An urgent pressure color is not a failed task outcome.
- Keep task titles in the theme's normal text color. Render time, completed-turn counts, and separators with secondary theme styling so they do not compete with activity/outcome and pressure emphasis.
- Reuse the active theme supplied by Pi. Do not hard-code RGB colors, add a separate extension theme configuration, or change Pi's selected theme.
- After a Pi theme switch or supported hot reload of the active custom theme, already-visible running and retained terminal rows must use the new theme on the host's next redraw; another delegation or task event must not be required to replace stale colors. Follow the host's existing theme-loading and hot-reload behavior rather than introduce a separate configuration watcher.
- Styling must preserve terminal-column width handling and metadata sanitization. Titles/tool names remain unable to inject terminal styling or hidden lines; colors do not add data, history, or execution behavior.

**Trace:** H-presentation for the mapping, visual hierarchy, theme integration, and unchanged behavior; V for the host's semantic styling and theme integration interfaces. Semantic roles are required, not particular RGB hues or a new contrast threshold.

### R9 — Lightweight rail styling with retained information

- Restyle only the existing above-input Agents panel, borrowing the compact vertical-rail visual language of `packages/pi-open-tui/`. Use a lightweight rail to group each task's summary/configuration/usage/activity; do not add a heavy full enclosing box.
- The branch originates at the summary's `#`: show the status icon before `#<label>` without an outer summary rail, and align the subordinate `│` and final `└` with that `#` column, including multi-digit labels. Style the entire `#<label>` (symbol and digits) and connectors with the active Pi theme's `mdLink` role, matching Open TUI's normal Git branch name/icon color. Metadata remains secondary; root/rail color does not encode task outcome or pressure. H-rail overrides the earlier muted rail appearance.
- Make task titles and current activity/outcomes easy to distinguish from secondary model/thinking, time, turn and usage metadata. Preserve R8's normal title color, semantic activity/outcome roles and independently acknowledged pressure styling; keep metadata and separators visually subordinate.
- Retain the existing capacity/queue heading, clearly labelled delegated total, numeric identity, title, elapsed time, English completed turns, pressure, model/thinking confirmation, per-task usage and current activity/outcome. A cosmetic change must not hide these fields at accommodating widths or change their meanings. Keep configuration/usage metadata text aligned with activity content (including an optional icon); preserve the spec 0007 usage field order and symbols.
- Apply R7's width-aware insets/gaps, R8's live Pi theme integration and existing sanitization to the new rails too. Narrow terminals may reduce spacing/truncate under the existing contract rather than overflow; decorative rails must not displace the numeric identity/status merely to retain ornamentation.
- The visual reference does not create a package/runtime/configuration dependency: delegate must render and perform its lifecycle normally whether or not `pi-open-tui` is installed or enabled. No import of its internal presentation components or requirement to load its settings is introduced.
- Use a small ordinary-Unicode icon vocabulary without requiring Nerd Font/private-use glyphs. Icons are supplementary to truthful status text and follow the active Pi semantic theme, not a separate palette:

| Icon / use | Theme role / meaning |
| --- | --- |
| `●` executing task indicator | `accent`; do not use it to claim observed thinking |
| `◷` queued label/count | `muted`; queue residence is not execution |
| `⚙` observed tool activity | `accent`; retain `toolcall · <tool name>` without arguments |
| `✓` completed | `success`; keep the existing `completed` outcome text |
| `!` incomplete | `warning`; keep `incomplete`, not a new failed outcome |
| `×` failed | `error`; keep `failed` |
| `Σ` delegated total | Secondary styling; keep the explicit delegated-total label |

- Existing initializing/finishing/cancelled labels keep their R8 roles; the preview does not require inventing icons or new outcome meanings for them. Header capacity numbers retain spec 0007's occupied-slot meaning even when decorated with `●`, including initialization/cleanup.
- Keep pressure text/color independent of the task icon/outcome. It may remain on the summary or be grouped with that task's usage as illustrated; this is not permission to omit it. Metadata aligns with the start of activity content, including an optional activity icon, under the same narrow-width constraints.

**Trace:** H-refresh and H-icons for the approved rail/icon style, hierarchy, retained information and independent operation; H-presentation/R7–R8 and specs 0006/0007 for unchanged field meanings; V-refresh for the reference. Exact heading wording, rail glyph variants and reversible typography within these constraints remain implementation details; the icon/color meanings above are contractual.

### R10 — Hide the entire panel when no displayed task remains

- Show the panel while at least one task row is displayed: queued, initializing, executing/finishing, or a terminal task still within the existing 5-second retention. Zero running tasks alone is not a reason to hide queued or retained rows.
- Keep all four terminal outcomes visible for the existing 5 seconds. When the final displayed row is removed, hide the entire Agents panel: heading, capacity/queue summary, delegated total, rails and panel-owned padding/blank lines. Cumulative usage alone must not keep the panel visible.
- With no task rows, capacity or usage observations must not recreate an empty panel. This includes late same-runtime cleanup/accounting updates after rows have expired or been cleared. Preserve existing invalidation rules preventing stale cross-scope task rows from reappearing.
- Hiding/removing the panel is visual only. Do not reset accumulated delegated usage, discard queryable task results, cancel work, alter admission/cleanup, or transfer ledger ownership to the renderer. A later delegation in the same runtime shows the panel again with the preserved cumulative delegated total, including prior consumption plus any newly reported consumption.
- Session replacement/reload retains its existing fresh-runtime total behavior; preserving consumption here does not introduce persistence across runtime boundaries. Non-TUI usage/status remains independent of widget visibility.
- This explicitly replaces spec 0007 R6's requirement to keep the total visible without child rows and the corresponding row-expiry acceptance expectation. It does not replace that spec's accounting-retention contract or ADR 0006. R7's visible-panel gaps must not remain as an empty widget footprint; unrelated host layout remains unchanged.

**Trace:** H-refresh for complete disappearance, unchanged retention and later reappearance with retained usage; R6 and ADR 0006 for visual/accounting/result separation. No new retention duration or rendering-latency SLA is introduced.

## Solution

Present the parent's existing delegated child executions as a compact terminal status list. Correlate invocation metadata, actual task start, completed-turn and activity observations, acknowledged pressure submissions, and the runner's final outcome with the same numeric UI identity. Observe both existing execution modes without changing who owns them or how their results reach the parent.

Use the same time/turn meanings as the pressure contract, but distinguish a pressure stage's reserved/eligible state from successful RPC acceptance. Rendering and 5-second terminal retention remain bounded to the originating ownership scope. This contract does not prescribe a new module layout, timer implementation, host widget API, or an additional status-query tool.

For the presentation follow-up, keep the existing status state and ownership contract while adding width-aware spacing within the Agents area and deriving activity/outcome and pressure styles from the current Pi theme. Integrate with host-provided widget spacing and theme redraws so neither blank-line gaps nor old colors accumulate. The same rows and existing execution events drive both textual status and its color; pressure color is based on acknowledgement, not eligibility.

Representative approved accommodating-width layout (surrounding Pi content, values and exact heading wording are illustrative; R7 defines spacing, R8 semantic colors, R9 rails/icons/hierarchy and R10 visibility). Configuration/usage text aligns with the start of activity content, including its icon where present; pressure remains visible for its task but its row placement is illustrative:

```text
[Existing Pi content]

  Agents   ● 1/4 active · ◷ 0 queued
    Σ Delegated total · ↑24.1k ↓3.2k R80k W0 · $0.13

  ● #3  Check status panel · 12s · 3 turns
    │   model: provider/model · thinking: high
    │   ↑8.2k ↓1.1k R20k W0 · $0.04 · pressure: none
    └─  ⚙ toolcall · bash

  ✓ #4  Add regression tests · 28s · 5 turns
    │   model: provider/model · thinking: high
    │   ↑6.1k ↓0.8k R12k W0 · $0.02 · pressure: none
    └─  completed

[Pi input]
```

The aggregate can include earlier tasks no longer shown. After the final displayed task's retention expires, none of this panel, its heading/aggregate or its spacing remains; unrelated host spacing is not removed.

### Necessary seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Invocation identity/title | Parent delegation entry → status display | Same child invocation, optional parent title, task text, startup ordering | Session-local non-reused numeric identity and title fallback for both modes (R1–R2) |
| Task execution observations | Shared runner / child RPC events → status state | Actual task onset, completed-turn boundary, current observable thinking/tool activity for that child | Initialization-excluding elapsed time, correct completed counts, and current activity without content/argument exposure (R3–R4) |
| Pressure acknowledgement | Existing task-local pressure submission / RPC response → status state | Stage and successful child steering acknowledgement, distinguished from reservation/failure | Highest accepted stage for that task, without claiming model consumption or changing pressure behavior (R5) |
| Outcome/ownership | Existing runner and synchronous/background owners → display lifecycle | Four terminal outcomes and scope invalidation/teardown | Final row for 5 seconds, visual-only removal, and no stale cross-scope updates (R6) |
| Terminal presentation | Correlated status state → Pi terminal UI | Current rows, available terminal width, and existing host widget spacing within the owning TUI session | Compact above-input rail display with non-duplicated gaps, horizontal insets, width bounds, contracted metadata, and no panel or panel-owned space when there are no rows (R1–R10; specs 0006/0007 supply configuration/usage meanings) |
| Active theme | Pi theme configuration / host redraw → Agents presentation | Current semantic foreground roles and host theme switch/hot-reload redraws | Activity/outcome and acknowledged-pressure styling, normal titles, secondary metadata, and no stale colors on already-visible rows (R8) |
| Usage retention / panel visibility | Runtime usage ledger and capacity observations → visual owner | Retained cumulative snapshots independent of current task rows; existing runtime lifetime | Aggregate shown with task rows, no empty panel from usage/capacity-only updates, and preserved consumption when later tasks make the panel reappear (R10; ADR 0006) |

## End-to-End Tests

These are future acceptance scenarios, not executed tests or an implementation plan.

### T1 — Both modes, numeric identities, and title fallback (R1–R2)
- **Given:** A Pi TUI session with a controlled synchronous child and background children; the parent supplies a title to one and omits it for another.
- **When:** Children start and continue executing, and an earlier terminal row subsequently disappears before another child starts.
- **Then:** The fixed list above input includes both modes but not the parent, uses increasing numbers without reuse or renumbering, uses the supplied title and shortened first-task-line fallback, and shows no role label. Existing background IDs still work for query/cancellation.

### T2 — Initialization, provider/tool waits, and completed turns (R3)
- **Given:** Child initialization is held separately from task onset; after onset, one assistant response has multiple/parallel/nested tools, including a held tool.
- **When:** Initialization completes, the actual task begins, provider/tool waits occur, and then all tools associated with the response finish.
- **Then:** Initialization contributes neither time nor turns. Running/waiting time progresses after onset. The count stays unchanged while the response or its tools are incomplete and advances exactly once at completion. Labels include `0 turns`, `1 turn`, and `2 turns`, never a Chinese turn suffix.

### T3 — Observed activity replaces previous activity without exposing content (R4)
- **Given:** A child emits observed thinking activity, then starts an identifiable tool; another child runs concurrently. A separate provider emits no thinking events.
- **When:** Activity changes and tools finish or the child terminates.
- **Then:** The relevant subordinate row updates to the observed current activity/tool name rather than appending a log, without tool arguments or thinking content. Other rows remain independent, obsolete activity is not left current, and the provider without thinking events is not falsely labelled thinking.

### T4 — Pressure eligibility versus accepted submission (R5)
- **Given:** A child crosses warning while its steering response is held; then warning is accepted. Later urgent is submitted, tested separately with a held response, rejection/timeout, and success.
- **When:** Those submission outcomes are published while the child remains in the same ownership scope.
- **Then:** Eligibility/reservation/pending warning leaves `none`; warning acceptance changes it to `warning`. Pending or unsuccessful urgent leaves `warning`; accepted urgent changes it to `urgent` and does not regress. No display claims consumption/compliance or sends another reminder. A concurrent child retains its own independent state.

### T5 — Four terminal outcomes and visual-only expiry (R3, R6)
- **Given:** Controlled children produce each of completed, incomplete, failed, and cancelled; one completed child has a retained queryable background result.
- **When:** The final outcome becomes available and the 5-second retention interval elapses.
- **Then:** Each row replaces running activity with its exact terminal outcome, freezes final duration/count, remains for the retention interval, and disappears afterward. The background result remains queryable until its existing scope is invalidated. Pressure alone does not determine the terminal status.

### T6 — Ownership invalidation and stale-update races (R6)
- **Given:** Active or retained rows, pending pressure acknowledgements, activity updates, and retention timers in an originating session/runtime; running background work for a branch-navigation case.
- **When:** Session replacement, reload, shutdown, or existing branch invalidation occurs, including a late event/acknowledgement/timer from the previous scope.
- **Then:** Old rows and callbacks do not repopulate the replacement/destination display. Existing child cancellation, cleanup, and result-delivery isolation are preserved; the UI does not resurrect owned execution.

### T7 — Presentation stays minimal and execution remains compatible (R1–R6)
- **Given:** A representative TUI session at normal and narrow terminal widths, plus existing RPC/non-TUI delegation paths.
- **When:** Status is rendered and changes while delegation continues.
- **Then:** TUI presentation retains numeric identity and contains only the contracted fields/activity/outcome and the configuration/usage additions separately authorized by specs 0006/0007, with no roles, arguments, result body, or activity history. RPC/non-TUI execution, synchronous result returns, and background query/delivery remain functional without requiring a terminal display.

### T8 — Spacing in the real host and after resize (R1–R2, R7)
- **Given:** A Pi TUI session with existing content above the input, synchronous/background child rows, and a terminal width that accommodates the rows plus the agreed spacing.
- **When:** The Agents area is shown and the terminal is resized between wider and narrow widths, including titles/tool names with wide and combining characters.
- **Then:** At accommodating widths, heading and rows have 2-column left/right insets; the displayed area has 1 blank line above and below, counting host spacing without duplication. Narrow rendering may reduce horizontal spacing rather than sacrifice identity/status columns to fixed insets; existing narrow-width truncation constraints still apply. No line exceeds the host-supplied width and Pi's other UI areas are not relaid out.

### T9 — Status and acknowledged-pressure colors remain independent (R3–R6, R8)
- **Given:** A Pi TUI session with a theme whose relevant semantic roles are distinguishable, and controlled children that expose the listed initialization, running, thinking, tool, finishing, and four terminal states. Warning/urgent steering acknowledgements can be held, rejected, and accepted independently of task outcomes.
- **When:** Activity and outcomes change, and the pressure submission outcomes are published.
- **Then:** Visible English labels and foreground roles match R8's mapping; titles use normal text color and time/turns/separators remain secondary. Pressure text/color advances only on successful acknowledgement. In particular, a completed child with accepted urgent pressure shows `completed` in `success` and pressure in `error` without being reclassified as failed. Retained outcomes freeze time/turns and disappear after the existing 5 seconds; metadata cannot inject styling or hidden lines.

### T10 — Existing rows follow theme changes (R6, R8)
- **Given:** Running child rows and terminal rows still within their retention interval, with an active Pi theme and no new child task event during the theme change.
- **When:** The user switches Pi's theme, tested with light/dark and custom palettes, or edits the active custom theme at a location Pi supports for hot reload.
- **Then:** On the next host redraw, already-visible rows use the current semantic-role colors rather than cached previous colors, without creating a new delegation. Their text, identity, time/turn meaning, pressure acknowledgements, outcomes, and retention ownership remain unchanged; styling does not change the selected Pi theme or require separate extension configuration.

### T11 — Compact visual hierarchy and independent operation (R7–R9)

- **Given:** The same controlled synchronous/background task states with model/thinking, usage and acknowledged pressure, tested both without Open TUI and with it enabled.
- **When:** Tasks change activity/outcome, the active Pi theme changes, and the terminal is resized through accommodating/narrow widths, including wide/combining metadata.
- **Then:** The panel uses lightweight task rails and the R9 Unicode icons without a heavy enclosing box or a Nerd Font prerequisite; titles/activity are distinct from secondary metadata, all contracted fields remain available at accommodating widths, and configuration/usage align with the start of activity content. Icons follow the same observed state and semantic theme roles as their labels; status/outcome and pressure remain readable in text without relying on color or icons. Theme changes, sanitization and column bounds remain correct. Delegate requires no Open TUI package or settings; both cases retain the same status/lifecycle meanings. Inspect the composed host frame for gaps, not only isolated renderer output.

### T12 — Final retained row removes the complete panel (R6, R10)

- **Given:** A runtime with nonzero delegated usage and tasks producing completed/incomplete/failed/cancelled outcomes; exercise synchronous and background modes, including a queryable background result.
- **When:** One row expires while another remains, then the final displayed terminal row reaches its existing 5-second expiry.
- **Then:** Removing an earlier row does not hide the remaining panel or renumber tasks. The final row remains through its retention interval; after expiry, the heading, aggregate, capacity summary, rails and panel-owned blank space all disappear from the composed host frame. The surrounding content/input resumes its normal no-widget layout. Cumulative usage and queryable results remain intact.

### T13 — Usage-only updates do not resurrect the panel; later work does (R10)

- **Given:** A hidden panel after final-row expiry or existing scope-local row clearing, with retained consumption in the same runtime.
- **When:** Capacity/usage-only observations arrive, including late same-runtime cleanup usage, followed later by a new delegation.
- **Then:** Observations alone leave the panel absent while retaining/reconciling usage. The new task makes the panel visible again with its valid session-local identity, preserved prior total and any new consumption, counted once. Existing replacement/reload starts a fresh runtime total; old callbacks cannot populate the new display or ledger. No result is discarded or execution cancelled merely because the panel is hidden.

### T14 — Queued and retained work are not mistaken for an empty panel (R6, R10)

- **Given:** Queued/initializing tasks or only terminal rows still inside their 5-second retention, with no task currently executing its model.
- **When:** Capacity/activity changes and redraws occur before those rows are removed.
- **Then:** The panel stays visible with truthful phase/configuration/usage data. It disappears only once no displayed rows remain, not merely when the executing count becomes zero.

## Decisions

- **Choice:** One spec, no tickets/slice or implementation stage. **Source:** User accepted the recommendation and explicitly invoked spec after the settled handoff; one shared child status contract covers both execution modes.
- **Choice:** Fixed above-input list, numeric identities without preset roles, parent-supplied/fallback titles, current activity only, and 5-second terminal retention. **Source:** H; the user accepted the recommendations.
- **Choice:** English singular/plural turn labels, not Chinese. **Source:** User's explicit correction, “Labels such as 3 turns should still be in English” (translated). This does not require task titles themselves to be translated.
- **Choice:** Reuse task-running time and completed-turn definitions rather than introduce another counting meaning. **Source:** H and P.
- **Choice:** Pressure reflects RPC acceptance of the highest successfully submitted stage, not eligibility or obedience. **Source:** H-pressure, explicitly confirmed by the user with “Yes” (translated); consistent with P's delivery limitations.
- **Choice:** Preserve existing execution, ownership, inheritance, result, and pressure-policy boundaries. **Source:** B, P, and H's minimal-display scope.
- **Choice:** Revise the existing shared UI spec rather than create another spec or tickets; stop at spec-only. **Source:** H-presentation; the user explicitly invoked `grimoire-spec` and accepted the recommended route for this bounded presentation change.
- **Choice:** 2-column horizontal insets, reducible on narrow terminals, and 1-line vertical gaps counting existing host spacing. **Source:** H-presentation; approved defaults address the user's screen-edge concern without changing Pi's overall layout.
- **Choice:** Use R8's semantic color mapping and visual hierarchy, preserve text labels, and follow active Pi theme changes without separate theme configuration or hard-coded RGB. **Source:** H-presentation; V establishes that Pi exposes the necessary theme integration. This is presentation only, not a change to execution or pressure policy.
- **Choice:** Revise this UI spec only with lightweight rails and row-driven whole-panel visibility, preserving ledger consumption; no tickets or execution stage. **Source:** H-refresh, accepted by the user's “Yes” (translated) after the recommendation. R10 explicitly supersedes spec 0007's total-only display requirement, not ADR 0006's retained accounting; package independence is unchanged.
- **Choice:** Add ordinary Unicode status/activity icons with Pi semantic colors and retained text, without a required Nerd Font; allow the preview's pressure/usage grouping. **Source:** H-icons, explicitly accepted by the user. This is a presentation-only amendment to R9/T11, not a new domain/architecture decision.

## Test Plan and limitations

- Future verification should correlate controlled real child execution with the visible parent TUI, including real thinking/tool event handling, both modes, and successful/unsuccessful steering responses. A mocked renderer alone cannot establish terminal placement or actual host-event availability.
- Use controlled time and event ordering for initialization exclusion, completed assistant-plus-tools counts, pressure acknowledgements, and the 5-second retention boundary; do not invent a refresh-rate or reminder-delivery SLA.
- Include terminal rendering evidence for normal/narrow layouts and verify that stale subscriptions/timers cannot update an invalidated display. Record the actual Pi host/version verified rather than promising all-version compatibility.
- For R7, inspect the composed host frame, not only the widget's isolated line array: Pi supplies leading widget spacing. Verify resize and Unicode/ANSI column measurement after insets are applied, without counting ANSI bytes as display columns.
- For R8, pair semantic-role assertions with visible host rendering under representative light, dark, and custom themes. Change the theme while rows already exist and the child produces no new event; include supported custom-theme hot reload. User palettes determine concrete colors, so this revision does not promise every custom palette distinguishes roles visually or add a contrast SLA.
- The dated verification below records earlier R1–R8 implementation evidence and its limits; it does not verify R9–R10. No production/test changes, executable tests or manual UI QA are performed at the 2026-10-16 spec-only endpoint.
- No blocking requirement decision remains. Exact title-field naming, title shortening length, duration formatting, layout details not fixed by R7–R10, simultaneous-tool wording, and internal implementation remain unprescribed within the settled semantics. No unconfirmed architectural assumption is required by this draft.
- **2026-10-16 spec-only verification scope (historical):** The drafting pass established requirements, traceability and links only. Subsequent implementation authorization and automated evidence for R9–R10/T11–T14 are recorded below; that evidence does not substitute for physical-terminal visual/font/input acceptance.

## Out of Scope

- Preset agent roles/identities, parent-agent rows, result bodies, tool arguments, thinking content, or an activity-history log. Token/cost statistics are limited to the separately authorized spec 0007 fields; this revision does not add accounting categories.
- Extra model calls to generate titles; translating user/task titles merely because turn/status labels are English.
- Changing pressure defaults, triggers, submission frequency, cancellation policy, or claiming reminder consumption/compliance.
- Replacing background task IDs/results, discarding queryable results when rows expire, extending child lifetime, or migrating old execution/status into another ownership scope.
- Changes to Pi's overall interface layout or selected theme; a separate extension palette/configuration system; hard-coded RGB status colors. This revision adjusts only the existing Agents area's presentation.
- A separate web/desktop UI, tickets, implementation plans, production changes, or QA execution in this selected spec-only endpoint.

## Implementation verification (2026-10-03)

For the original R1–R6 feature, the subsequent user-authorized grimoire-loop superseded the original spec-only write boundary. That authorization does not start implementation of the 2026-10-04 presentation revision (R7–R8). Implementation is in `src/status.ts` and `src/delegate.ts`; plan: `.grimoire/plans/0007-agent-status-ui.md`. The requirements contract and Draft status are preserved; the following records bounded evidence, not a claim of complete manual terminal E2E acceptance.

- **R1–R2:** Both public invocation paths reach one aboveEditor widget, with optional `title`, first-line fallback and session-local numeric identity. Installed Pi 1.0.0 InteractiveMode widget-adapter methods and pi-tui main-screen rendering are exercised using an in-memory terminal transport and input sentinel. Deterministic tests cover width bounds and title truncation; normal widths reserve time/turn/pressure fields before titles.
- **R3–R4:** Task-only RPC subscription starts after initialization; observed agent_start starts elapsed time, turn_end advances completed turns, and settlement freezes duration. Controlled clocks exercise provider/tool waits, parallel/nested tool names, English singular/plural labels, all four terminal outcomes and exact five-second visual expiry. Real Pi 1.0.0 AgentSession/ExtensionRunner plus a credential-free RPC child verify observed thinking events and a provider with no thinking events; thinking content and result bodies are absent from widget frames.
- **R5:** Controlled real runner/JSONL transport tests hold warning and urgent RPC replies; pending stages do not advance display, successful warning/urgent do, rejected urgent preserves warning. Deterministic tests verify independent tasks, highest accepted stage and late old-scope acknowledgement rejection. Display does not change pressure policy. A distinct new UI end-to-end 40-second RPC timeout scenario was not run; the same rejected request path cannot call the acknowledgement callback.
- **R6:** Deterministic tests cover stale handles/timers, replacement generation, preserved branch numbering, session reset and shutdown deactivation. Both background success/failure results remain queryable after real five-second visual expiry. Existing full-suite real-host lifecycle tests remain passing; widget-visible reload/tree-navigation races are not claimed as separate interactive E2E evidence.
- **Verification:** Post-format `bun test`: 262 passed, 0 failed (14 files). Final typecheck, Biome check and whitespace results are recorded in the plan verification record.
- **Review/assessment:** Reviewed tracked changes and complete new production/tests/fixtures/artifacts. Corrected long-title pressure clipping at ordinary widths, stale widget/timer scope handling, shutdown deactivation and obsolete thinking activity. No confirmed blocker remains in the inspected scope.
- **Limitations:** No manual visual/input E2E, full InteractiveMode startup, fullscreen rendering, real external-provider credentials, or host versions other than Pi 1.0.0 were tested. Extremely narrow terminals truncate contracted fields to fit; large child lists may exceed the visible terminal viewport. Required broad terminal acceptance remains bounded by these evidence gaps, so this verification note does not promote the spec status.

## Presentation implementation verification (2026-10-04)

The subsequent user invocation of `grimoire-loop` authorized implementation of R7–R8 after the spec-only revision. The same local plan, `.grimoire/plans/0007-agent-status-ui.md`, was revised and persisted before production edits. This addendum records the presentation follow-up only; earlier requirements, lifecycle semantics, evidence limits, and Draft status are preserved.

- **R7 / T8 — Match at the composed-host boundary:** `src/status.ts` reserves up to 2 columns on both sides before title truncation, reduces those insets when summary/identity space is constrained, and adds only the bottom blank line because Pi supplies the top spacer. `tests/status.presentation.test.ts` exercises the real Pi 1.0.0 widget adapter and pi-tui composed frame with content/input sentinels: exact single-line gaps, 2-column insets at accommodating widths, resize-width sequences, Unicode/ANSI column bounds, 0/1/2-column inset reduction, width-zero handling, and visual removal.
- **R8 / T9 — Match:** The same presentation tests assert real theme foreground roles for all listed activity/outcome states, normal titles, secondary metadata, independent acknowledged-pressure roles, and sanitized title/tool metadata. `tests/status.integration.test.ts` now asserts themed pressure/outcome frames through real runner/controlled RPC transport in both invocation modes with held, accepted, and rejected steering replies. The existing state and integration suites still cover frozen outcomes, exact 5-second expiry, and queryable background results after visual expiry. No observer, execution, pressure-policy, or result-owner production code changed.
- **R8 / T10 — Match at the live theme/TUI boundary:** With task time fixed and no refresh timers or new task events, tests keep the same running and retained widget rows while switching light, dark, system, and custom themes. A temporary active custom theme file is then edited and reloaded by Pi's actual filesystem watcher. Both themed frames and actual writes from the running pi-tui renderer update; text and widget identity remain unchanged. Production styling is computed on each render from Pi's injected live Theme proxy, without a plugin watcher, palette, or settings change.
- **Review/check/assessment:** Inspected complete production/test/documentation changes, the complete new presentation test, accepted spec delta, and applicable host interfaces. No confirmed blocker, material design deviation, or extra runtime behavior remains in the scoped follow-up. An initial width-one test assertion was corrected to ignore pi-tui's own trailing ANSI reset; no acceptance requirement was weakened. Formatting and import-order findings were handled by scoped Biome automation.
- **Final post-format evidence (`D:/Code/pi-delegate`):** `bun test`: **265 passed, 0 failed**, 2,522 assertions across 15 files (48.94s); `bun run typecheck`: passed; `bun run check`: passed, 36 files checked; `git diff --check`: passed. Relative Markdown source links were checked. Formatting/import organization ran only on the four changed TypeScript files.
- **Limitations:** Executable evidence uses installed Pi 1.0.0 widget methods, theme engine/watcher, real runner/credential-free child fixtures, and actual main-screen pi-tui rendering with an in-memory terminal transport and host-equivalent theme redraw binding. Full InteractiveMode startup, fullscreen/input interaction, a physical terminal/manual visual E2E, and other Pi versions were not tested. Concrete colors remain user-palette-dependent; extremely narrow truncation and large-list viewport limitations are unchanged. This scoped addendum does not claim global manual E2E acceptance or promote the spec status.

## Rail/icon and empty-panel implementation verification (2026-10-16)

- **Route/scope:** Explicit loop invocation authorized implementation and tests without a new plan artifact. Production changes are confined to [AgentStatus](../../packages/pi-delegate/src/status.ts); the renderer remains a visual observer, with no accounting, scheduler, result-owner or Open TUI production dependency changes. Usage/runtime docs describe the new presentation and visibility rule.
- **R9 / T11 — Automated presentation evidence:** Updated status/presentation tests cover ordinary Unicode badges/tool icons, semantic foreground roles, independent pressure styling, normal titles/secondary metadata, sanitization, numeric identity, configuration/activity alignment and narrow/resize column bounds. Real Pi 1.1.0 theme switching and custom-theme file hot reload update already-visible rows/icons without task events. Delegate is exercised standalone; the Open TUI workspace suite is verified separately, not as a joint physical-terminal visual session.
- **R10 / T12–T14 — Automated lifecycle evidence:** Controlled time covers all four outcomes, exact five-second row expiry, zero/nonzero totals, queued/retained-only visibility, no widget from usage/capacity-only observations, stale callbacks and same-runtime reappearance with retained consumption. The composed real-host widget/TUI test verifies an empty widget map and return to the host's own no-panel frame, including after scope clearing/late usage; host-owned default spacing is preserved. Scheduling-runtime coverage checks retained late cleanup consumption without resurrecting rows and shows it on later work.
- **Both invocation modes/results:** Real runner/controlled RPC + Pi widget tests verify final panel removal in sync/background mode with accepted/rejected pressure submissions; background results remain queryable after expiry. Existing real background TUI and concurrent-startup/configuration integration cases pass with the updated layout.
- **Test correction:** The initial new integration assertion hard-coded an unpadded two-line host frame. Direct host inspection showed that Pi retains its own default spacer/padding after the public widget-clear operation; the corrected test compares with the same host's captured empty-widget baseline and asserts zero registered widgets. This does not leave renderer-owned blank rows or change the host layout contract.
- **Final post-format evidence (`D:/Code/pi-delegate`):** `bun run test` passed: root **6 passed**; delegate **630 passed, 1 POSIX-only permissions test skipped on Windows**; Open TUI **312 passed**. `bun run typecheck`, `bun run check` (109 files), and `bun run --filter @wangjq4214/pi-delegate build` passed. Scoped Biome formatting touched only changed TypeScript files; final whitespace/link checks passed.
- **Limitations:** No full interactive startup/input, physical-terminal font/visual acceptance, joint enabled-Open-TUI terminal session or cross-version coverage is claimed. The Open TUI suite passes separately; a combined enabled-peer visual check remains unverified. Draft status is retained rather than claiming full manual acceptance.

**H-rail follow-up:** Moved the rail directly below `#` and switched the root/connectors to Pi's live `mdLink` role, matching Open TUI's normal Git branch presentation. Regression assertions cover `#`/`│`/`└` column alignment for single/multi-digit labels, narrow widths, theme switching and custom-theme hot reload of the connector color. Post-format targeted status/presentation/scheduling/runner checks: **23 passed, 0 failed** across 4 files; workspace typecheck/lint and delegate build passed. The full workspace totals above predate this follow-up; the full suite was not rerun for this bounded visual delta.
