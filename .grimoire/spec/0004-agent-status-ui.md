# Minimal agent status UI

**Spec ID:** 0004
**Status:** Draft
**Date:** 2026-10-03
**Sources:** The settled refinement conversation: the user requested a compact agent list without preset roles, accepted the recommended display/lifecycle behavior, required English turn labels and pressure visibility, accepted RPC acknowledgement as the pressure-display boundary, and explicitly invoked `grimoire-spec` for a spec-only endpoint.

## Source and coordination boundary

- **H — Settled handoff:** Show synchronous and background child agents above the Pi terminal input; exclude the parent. Use session-local increasing numeric labels without reuse, a title, elapsed task-running time, completed turns with English labels, current activity, and the highest successfully submitted pressure stage. Titles are supplied by the parent, falling back to a shortened first task line without an extra model call. Terminal rows show their existing outcome for 5 seconds, then disappear. Do not add other information.
- **H-pressure — Final clarification:** `pressure: none / warning / urgent` reflects the highest stage whose child RPC steering request has been accepted. Eligibility, pending submission, acceptance, model consumption, and compliance are not interchangeable.
- **B — Existing lifecycle contracts:** [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md), Superseded in its exclusively synchronous lifecycle by [ADR 0002](../adr/0002-session-owned-background-delegation.md), Completed; [spec 0002](./0002-session-owned-background-delegation.md), Implemented. Fresh RPC children, parent-only delegation, inheritance, synchronous cancellation, background ownership, result delivery/query, and cleanup remain unchanged.
- **P — Existing pressure contract:** [ADR 0003](../adr/0003-per-delegation-soft-pressure.md), Implementing; [spec 0003](./0003-subagent-soft-pressure.md), Draft, establishes task-running time, completed assistant-plus-tools turns, two advisory pressure stages, and the distinction between RPC acceptance and model consumption/compliance.
- **L — Inspected implementation:** [src/delegate.ts](../../src/delegate.ts) supplies both invocation paths, the shared `runDelegation` runner, and terminal outcomes; [src/rpc.ts](../../src/rpc.ts) supplies task event subscriptions and success/error responses to steering; [src/pressure.ts](../../src/pressure.ts) observes actual task onset and `turn_end` and reserves stages before asynchronous steering; [src/background.ts](../../src/background.ts) supplies background task/result ownership; [README.md](../../README.md) documents these contracts.

The selected permission is to write and verify this one spec, not production code, tests, tickets, or an implementation plan. Consume only settled requirements and established choices; do not invent domain facts, acceptance semantics, architecture, or unconfirmed assumptions. Return any needed new decision to refine before continuing. Formatting and sequencing do not authorize filling semantic gaps.

Spec 0003 excludes new parent pressure telemetry from that feature's scope. This separately authorized UI feature adds pressure visibility without changing the pressure policy or invalidating that earlier scope boundary. No ADR conflict was identified.

## Requirements

### R1 — Compact terminal placement and coverage

- Display one compact status list in a fixed area above the Pi terminal input.
- Include child agents launched by this extension in both synchronous and background mode. Do not include the parent agent.
- Do not use or introduce preset roles such as `Explore`, `Plan`, or role-based identities.
- The first row for each child contains only its numeric label, task title, elapsed running time, completed-turn count, and pressure state. A subordinate row shows current activity or the terminal outcome.
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
- Use English labels: `1 turn` and `N turns` for other counts, including `0 turns`. Do not use a Chinese suffix such as `轮`.
- Elapsed time progresses while the child remains running, including during a long provider/tool wait without new events. Terminal rows retain the final observed duration and completed-turn count rather than continuing to accrue running time.
- Initialization is not evidence of task running time, completed task turns, or thinking. Do not count initialization activity as task execution.

**Trace:** H and the user's English-label correction; P for the accepted counting/time definitions. No numerical refresh-rate SLA or particular duration format is specified.

### R4 — Current activity, not a log

- Show only the current activity below the child's summary, for example `thinking…` or `toolcall · read` / `toolcall · bash`.
- For observed tool execution, display the tool name without arguments. Do not display thinking content, result bodies, or accumulated activity history.
- Do not infer `thinking` from elapsed time, silence, or a generic running state when no thinking event is observed.
- Activity observations must belong to the same child and must not leak into another child's row. Later execution or termination updates must not leave an obsolete activity represented as current.
- Exact presentation for initialization, other observed activities, and simultaneous tool calls is an implementation detail within these constraints; it cannot claim unobserved thinking or add an activity log.

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

## Solution

Present the parent's existing delegated child executions as a compact terminal status list. Correlate invocation metadata, actual task start, completed-turn and activity observations, acknowledged pressure submissions, and the runner's final outcome with the same numeric UI identity. Observe both existing execution modes without changing who owns them or how their results reach the parent.

Use the same time/turn meanings as the pressure contract, but distinguish a pressure stage's reserved/eligible state from successful RPC acceptance. Rendering and 5-second terminal retention remain bounded to the originating ownership scope. This contract does not prescribe a new module layout, timer implementation, host widget API, or an additional status-query tool.

Representative layout (illustrative titles, durations, and spacing; not new default thresholds):

```text
Agents
├─ 1  Check error handling  · 12s · 3 turns · pressure: none
│  └─ thinking…
├─ 2  Analyze test coverage ·  6m · 21 turns · pressure: warning
│  └─ toolcall · read
└─ 3  Summarize interfaces  · 11m · 42 turns · pressure: urgent
   └─ completed
```

### Necessary seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Invocation identity/title | Parent delegation entry → status display | Same child invocation, optional parent title, task text, startup ordering | Session-local non-reused numeric identity and title fallback for both modes (R1–R2) |
| Task execution observations | Shared runner / child RPC events → status state | Actual task onset, completed-turn boundary, current observable thinking/tool activity for that child | Initialization-excluding elapsed time, correct completed counts, and current activity without content/argument exposure (R3–R4) |
| Pressure acknowledgement | Existing task-local pressure submission / RPC response → status state | Stage and successful child steering acknowledgement, distinguished from reservation/failure | Highest accepted stage for that task, without claiming model consumption or changing pressure behavior (R5) |
| Outcome/ownership | Existing runner and synchronous/background owners → display lifecycle | Four terminal outcomes and scope invalidation/teardown | Final row for 5 seconds, visual-only removal, and no stale cross-scope updates (R6) |
| Terminal presentation | Correlated status state → Pi terminal UI | Current rows within the owning TUI session | Compact fixed display above input; no role labels or extra information (R1–R6) |

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
- **Then:** TUI presentation retains numeric identity and contains only the contracted fields/activity/outcome, with no roles, token/cost statistics, arguments, result body, or activity history. RPC/non-TUI execution, synchronous result returns, and background query/delivery remain functional without requiring a terminal display.

## Decisions

- **Choice:** One spec, no tickets/slice or implementation stage. **Source:** User accepted the recommendation and explicitly invoked spec after the settled handoff; one shared child status contract covers both execution modes.
- **Choice:** Fixed above-input list, numeric identities without preset roles, parent-supplied/fallback titles, current activity only, and 5-second terminal retention. **Source:** H; the user accepted the recommendations.
- **Choice:** English singular/plural turn labels, not Chinese. **Source:** User's explicit correction, “3轮这种还是要用英文”. This does not require task titles themselves to be translated.
- **Choice:** Reuse task-running time and completed-turn definitions rather than introduce another counting meaning. **Source:** H and P.
- **Choice:** Pressure reflects RPC acceptance of the highest successfully submitted stage, not eligibility or obedience. **Source:** H-pressure, explicitly confirmed by the user with “可以”; consistent with P's delivery limitations.
- **Choice:** Preserve existing execution, ownership, inheritance, result, and pressure-policy boundaries. **Source:** B, P, and H's minimal-display scope.

## Test Plan and limitations

- Future verification should correlate controlled real child execution with the visible parent TUI, including real thinking/tool event handling, both modes, and successful/unsuccessful steering responses. A mocked renderer alone cannot establish terminal placement or actual host-event availability.
- Use controlled time and event ordering for initialization exclusion, completed assistant-plus-tools counts, pressure acknowledgements, and the 5-second retention boundary; do not invent a refresh-rate or reminder-delivery SLA.
- Include terminal rendering evidence for normal/narrow layouts and verify that stale subscriptions/timers cannot update an invalidated display. Record the actual Pi host/version verified rather than promising all-version compatibility.
- Current source inspection establishes the existing execution/pressure boundaries, not that this UI exists or passes its acceptance scenarios. No implementation, test authoring/execution, or UI QA was performed in this spec-only stage.
- No blocking requirement decision remains. Exact title-field naming, title shortening length, duration formatting, layout details, simultaneous-tool presentation, and internal implementation remain unprescribed within the settled semantics. No unconfirmed architectural assumption is required by this draft.

## Out of Scope

- Preset agent roles/identities, parent-agent rows, token/cost statistics, result bodies, tool arguments, thinking content, or an activity-history log.
- Extra model calls to generate titles; translating user/task titles merely because turn/status labels are English.
- Changing pressure defaults, triggers, submission frequency, cancellation policy, or claiming reminder consumption/compliance.
- Replacing background task IDs/results, discarding queryable results when rows expire, extending child lifetime, or migrating old execution/status into another ownership scope.
- A separate web/desktop UI, tickets, implementation plans, production changes, or QA execution in this selected spec-only endpoint.

## Implementation verification (2026-10-03)

The subsequent user-authorized grimoire-loop superseded the historical spec-only write boundary above. Implementation is in `src/status.ts` and `src/delegate.ts`; plan: `.grimoire/plans/0007-agent-status-ui.md`. The requirements contract and Draft status are preserved; the following records bounded evidence, not a claim of complete manual terminal E2E acceptance.

- **R1–R2:** Both public invocation paths reach one aboveEditor widget, with optional `title`, first-line fallback and session-local numeric identity. Installed Pi 1.0.0 InteractiveMode widget-adapter methods and pi-tui main-screen rendering are exercised using an in-memory terminal transport and input sentinel. Deterministic tests cover width bounds and title truncation; normal widths reserve time/turn/pressure fields before titles.
- **R3–R4:** Task-only RPC subscription starts after initialization; observed agent_start starts elapsed time, turn_end advances completed turns, and settlement freezes duration. Controlled clocks exercise provider/tool waits, parallel/nested tool names, English singular/plural labels, all four terminal outcomes and exact five-second visual expiry. Real Pi 1.0.0 AgentSession/ExtensionRunner plus a credential-free RPC child verify observed thinking events and a provider with no thinking events; thinking content and result bodies are absent from widget frames.
- **R5:** Controlled real runner/JSONL transport tests hold warning and urgent RPC replies; pending stages do not advance display, successful warning/urgent do, rejected urgent preserves warning. Deterministic tests verify independent tasks, highest accepted stage and late old-scope acknowledgement rejection. Display does not change pressure policy. A distinct new UI end-to-end 40-second RPC timeout scenario was not run; the same rejected request path cannot call the acknowledgement callback.
- **R6:** Deterministic tests cover stale handles/timers, replacement generation, preserved branch numbering, session reset and shutdown deactivation. Both background success/failure results remain queryable after real five-second visual expiry. Existing full-suite real-host lifecycle tests remain passing; widget-visible reload/tree-navigation races are not claimed as separate interactive E2E evidence.
- **Verification:** Post-format `bun test`: 262 passed, 0 failed (14 files). Final typecheck, Biome check and whitespace results are recorded in the plan verification record.
- **Review/assessment:** Reviewed tracked changes and complete new production/tests/fixtures/artifacts. Corrected long-title pressure clipping at ordinary widths, stale widget/timer scope handling, shutdown deactivation and obsolete thinking activity. No confirmed blocker remains in the inspected scope.
- **Limitations:** No manual visual/input E2E, full InteractiveMode startup, fullscreen rendering, real external-provider credentials, or host versions other than Pi 1.0.0 were tested. Extremely narrow terminals truncate contracted fields to fit; large child lists may exceed the visible terminal viewport. Required broad terminal acceptance remains bounded by these evidence gaps, so this verification note does not promote the spec status.
