# Usage guide

[Back to README](../README.md) · [Runtime and safety](runtime.md) · [Development](development.md) · [Roadmap](roadmap.md)

This guide describes the model-callable tools provided by pi-delegate. Load the extension using the [installation instructions](../README.md#installation).

## Tools

The parent agent receives five tools:

| Tool | Purpose |
| --- | --- |
| `delegate` | Start a fresh subagent and wait for its outcome, or accept a background task. |
| `delegate_list` | Discover bounded synchronous/background summaries in the current session/branch. |
| `delegate_status` | Retrieve either mode's metadata, observed progress, and available result. |
| `delegate_cancel` | Cancel a background task and wait for execution-resource cleanup. |
| `delegate_steer` | Submit additional plain-text instructions to an active background task. |

Children do not register any of these tools or the parent-only `/delegates` task-panel command. Apart from these parent capabilities, there is only an internal child-initialization command.

## Starting a task

### Parameters

| Parameter | Required | Meaning |
| --- | --- | --- |
| `task` | Yes | Task text. Empty or whitespace-only text is rejected. |
| `context` | No | Supplementary context. The parent's complete conversation is not copied. |
| `cwd` | No | Existing child startup directory; relative to the parent's invocation cwd. Omitted uses parent cwd. |
| `title` | No | Short TUI display title. Defaults to the first line of `task`; summaries may shorten it, but details retain the full sanitized supplied title. |
| `background` | No | Set to `true` to return a background task ID instead of waiting. Defaults to synchronous execution. |
| `model` | No | Exact configured `{ "provider": "...", "id": "..." }` identity; omitted inherits the current parent model. |
| `thinkingLevel` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; omitted independently inherits the current parent level. |
| `pressure` | No | Per-task warning and urgent finish-reminder thresholds. Omitted fields use defaults. |

### Per-task working directory and worktrees

```json
{
  "task": "Implement and test the requested change; return a reviewable commit or patch",
  "cwd": "../task workspace",
  "context": "Baseline commit and acceptance criteria go here"
}
```

Both modes resolve cwd to an absolute path at submission, before queueing. Explicit non-string values (including `null`), blank paths, missing paths, non-directory paths or inaccessible paths fail explicitly; the plugin never creates a target or falls back to the parent directory. Startup rechecks the selected path if it became unusable while queued. Directory selection does not change the parent's cwd or restrict filesystem access.

After observed child spawn, synchronous results expose `details.cwd`; background terminal query/completion results expose `details.result.cwd`. These are absolute startup paths, retained on later failure/cancellation, not a claim that initialization succeeded or the task completed. Queued cancellation and pre-spawn failure have no effective cwd metadata.

The selected directory drives normal Pi project/context discovery. Inherited resource paths retain their parent/startup meaning. A different directory uses native target project trust (with explicit parent CLI `--approve`/`--no-approve` overrides replayed); the parent's directory-specific trust decision is not transferred. Incompatible tool reconstruction fails before task execution. See [runtime inheritance](runtime.md#tool-and-configuration-inheritance).

Loading the package through normal Pi package discovery also provides the `delegate-worktree` skill; no separate skill installation is needed. Load `/skill:delegate-worktree` for independent Git workspaces, a definite commit baseline, reviewable child artifacts and parent-owned integration/validation before cleanup. Loading only the extension file does not load package skills. Failed or unmerged workspaces remain inspectable; the plugin never manages Git worktrees or merges.

### Per-task model and thinking selection

```json
{
  "task": "Analyze this module",
  "model": { "provider": "anthropic", "id": "claude-sonnet-4-20250514" },
  "thinkingLevel": "low"
}
```

Both fields work independently in synchronous and background mode. Omitted values are captured from the parent at invocation time, not from a target model's saved defaults. Unknown/partial model identities and malformed inputs fail before background acceptance. IDs containing slashes or colons are exact IDs, not CLI patterns or thinking suffixes.

After inherited tools initialize, the runner selects the exact model, applies the requested level using Pi's native capability adjustment, and reads back the configuration before submitting the task. Unavailable child providers/models/auth configuration fail explicitly without fallback. Overrides do not change the parent's selection or saved defaults.

Terminal synchronous results expose `details.configuration.requested` and, when startup was confirmed, `details.configuration.effective`; each contains `model: { provider, id }` and `thinkingLevel`. Background query/completion results carry these under `details.result.configuration`. The effective level can differ from the request (for example, a non-reasoning model uses `off`). Pre-confirmation failures have no effective value; later execution failures/cancellation retain confirmed startup values. This is startup configuration, not proof of provider consumption or immutable routing during execution.

### Synchronous execution

```json
{
  "task": "Review error handling in src/ and report findings with file paths",
  "context": "Analyze only; do not modify files",
  "title": "Review error handling"
}
```

The call waits for capacity, then remains pending through child execution and cleanup. See [startup concurrency configuration](runtime.md#concurrency-scheduling). Cancelling the initiating call cancels its child. Each invocation creates a new process and a fresh in-memory session; previous child conversations are not reused.

An accepted synchronous task has an exact query ID, discoverable while the initiating call is pending through `delegate_list` and returned as `details.taskId` in its final result. Querying does not shorten the initiating call, change its cancellation ownership, deliver a background completion message, or charge usage again. Independent `delegate_cancel` and `delegate_steer` calls against a synchronous ID are explicitly rejected.

### Background execution

Background mode is supported only in long-lived TUI and RPC parent sessions. Requests from one-shot print or JSON mode fail explicitly.

```json
{
  "task": "Analyze test coverage and report gaps",
  "context": "Analyze only; do not modify files",
  "title": "Analyze test coverage",
  "background": true
}
```

The call immediately returns `details.taskId` and its applicable `details.status`: `queued`, `initializing`, or `running`. This acknowledges acceptance, not child readiness or successful completion. The parent can continue other work while waiting, initialization and execution proceed.

When the child reaches a terminal outcome, the extension sends a model-visible `pi-delegate:completed` message with the task ID, outcome, and available output:

- While the parent is busy, completion remains queued in the extension until current and already queued work has finished.
- When the parent is idle, delivery triggers a turn to process the result.
- Failed, cancelled, and incomplete outcomes are delivered as well as completed ones.

This is not merely a UI notification. Delivery is not a durable acknowledgement that the model consumed the result, and exactly-once model processing is not guaranteed.

## Discovering tasks and unified details

Call `delegate_list` without remembered IDs:

```json
{ "group": "all", "offset": 0, "limit": 20 }
```

`group` is `all` (default), `active`, or `finished`; `offset` defaults to 0; `limit` defaults to 20 and accepts integers from 1 to 100. The response contains `tasks`, `total`, and `nextOffset` when another page exists. Active tasks appear first in acceptance order; finished tasks appear newest first. Offsets describe a live list, not a frozen snapshot, so retain exact task IDs rather than treating row positions as identity when ordering changes.

Each bounded summary contains `taskId`, its non-reused session-local numeric `label`, title, execution `mode`, status/phase, execution elapsed seconds, completed turns, current activity, `resultAvailable`, `cancelling`, and applicable controls. Listing does not include task/context bodies, transcripts, result bodies, thinking content or tool arguments. Empty scopes and filters return an empty list.

Pass an exact discovered ID to `delegate_status`:

```json
{ "taskId": "<exact taskId>" }
```

Both modes return metadata in the model-visible text and `details.task`: summary identity/progress; selected and confirmed effective startup cwd; requested and confirmed effective model/thinking; current tools (including concurrent/nested tools); resolved pressure policy and highest RPC-accepted stage; available usage; completion-delivery observation; and control availability/reasons. Missing effective fields are unconfirmed, not success. Cwd is startup configuration, not a continuously observed directory or sandbox. Elapsed time excludes queue/initialization, and tool calls do not add turns.

| Field | Meaning |
| --- | --- |
| `details.taskId`, `details.status` | Exact identity and current phase or terminal outcome. |
| `details.task` | Unified scope-local task metadata and observations. |
| `details.result` | Available final metadata: outcome, session/stop reason, errors, truncation and full-output path. |
| `details.usage` | Available child token/cost usage; failure/cancellation values can be partial. |
| `details.accounting` | Mode-specific accounting reminder. |
| `details.deliveryError` | Background completion-delivery error, if observed. |

Available output follows the existing [preview and full-file rules](#large-output). No final result is invented while a task is active. Failed/cancelled queries have `isError: true`; unknown or invalidated IDs fail explicitly. A completion-delivery failure does not change execution status or remove the retained result. `submitted` only means the host message call returned successfully, not that a model consumed it.

All records/results remain discoverable through the originating session/branch scope, independent of five-second compact-row expiry or completion-message clearing. There is no TTL/count eviction or cross-session persistence. Exit, session replacement/forking, reload, and branch-changing navigation invalidate IDs; records are not moved to another session or branch. Paging limits responses, not retention.

Background usage is separate from Pi's parent-session totals. Synchronous usage is reported through the initiating result. Listing, querying, panel viewing and manual controls never return top-level task usage or charge it again.

## Cancelling background tasks

Pass the exact background ID to `delegate_cancel`. It waits for owned child-process and initialization-resource cleanup; queued/initializing work is cancellable even before steering is ready. Cancelling an already finished task preserves its existing result. It does not cancel the parent turn, restart terminal work, remove the selected workspace, or undo file changes/external effects. Synchronous IDs are read-only; cancel the initiating synchronous call instead.

## Steering an active background task

Call `delegate_steer` with the existing background ID (not its numeric TUI label):

```json
{
  "taskId": "<taskId returned by delegate>",
  "message": "Focus only on src/rpc.ts; finish with a report of current findings and unfinished work."
}
```

This adds instructions to the same child and original task without cancelling/restarting it. It never falls back to `prompt` or implicitly starts idle/terminal work. It does not interrupt an in-flight provider request or associated tools; queued text is eligible after the current assistant turn’s tools finish and before a subsequent provider request, subject to continued execution and the host’s steering mode.

Readiness requires successful inherited-tool initialization **and original-task start**. `running` alone is insufficient. While queued, during initialization or before task start, `not_ready` returns immediately: the rejected instruction is not buffered or submitted later. A later explicit call can use the same active ID.

Steering results are operation receipts, not task outcomes:

| `details.status` | Meaning |
| --- | --- |
| `accepted` + `details.disposition: "queued"` | Pi queued the instruction, possibly after a trusted handler transformed it. It may already have drained, been cleared, or missed further execution. |
| `accepted` + `details.disposition: "handled"` | A trusted Pi input handler consumed this submission rather than placing it in the steering queue. |
| `not_ready` | Initialization/original-task start is not complete; no readiness waiting or buffering. |
| `unknown_task`, `terminal`, `cancelling`, `closing`, `closed` | The ID or execution is unavailable in the current owning session/branch. |
| `failed` | This steering operation failed; it alone does not fail/cancel a healthy task. |
| `uncertain` | The 40-second control-response timeout expired. Host preprocessing may still finish; **do not automatically retry**. |

Every receipt includes `details.taskId`; unsuccessful receipts include `details.error` and `isError: true`. No top-level task usage is attached. Neither `queued` nor `handled` confirms durable queue residence, provider/model consumption, execution, compliance, or a final result. Query and completion messaging remain the ordinary result channels.

Manual instructions and automatic pressure share one task-local submission boundary that waits for the preceding RPC outcome. This is not a priority policy or a model-consumption guarantee. After an uncertain timeout, the earlier host preprocessing may still run. Slash-leading caller text is prefixed as instruction text, while trusted host input handling and host steering mode remain intact.

Controls close on `agent_settled` (not low-level `agent_end`), cancellation, ownership invalidation and cleanup—even if public status still says `running` during result collection. Settlement can race an already-submitted handler: even a late successful receipt may be unconsumed and cannot reopen the task. Ordinary parent-turn completion/cancellation leaves accepted background work and its active control intact. Synchronous task IDs remain read-only; enforced filesystem permissions are not provided.

## Terminal outcomes

Synchronous results expose the outcome in `details.status`. Background results use the same outcome names.

| Status | Child stop reason | Interpretation | `isError` |
| --- | --- | --- | --- |
| `completed` | `stop` | The child produced a final answer. | `false` |
| `incomplete` | `length` | Generation reached its length limit; the available text may be unfinished. | `false` |
| `failed` | `error`, startup/inheritance/RPC failure, or another invalid outcome | Execution failed; available diagnostics and output are retained. | `true` |
| `cancelled` | `aborted` or initiating-call/task cancellation | Execution was cancelled. | `true` |

`incomplete` does not automatically continue and is not treated as a run error. Available session, stop-reason, diagnostic, and usage data are retained for non-success outcomes; unavailable session/stop-reason fields are omitted, and usage that could not be obtained is zero.

### Large output

Final text uses Pi's default display limits: **50 KB or 2,000 lines**, whichever is reached first.

Oversized output includes a preview of complete leading lines, truncation metadata, and a path to the full UTF-8 output file. An oversized first line may leave no preview. Use `read` to retrieve the file.

Presentation truncation is independent of generation incompleteness: a normally finished answer can remain `completed` while `details.truncation` indicates that its display was truncated.

Full-output files outlive child-process and initialization cleanup. Delete them when no longer needed, or leave them to the system's temporary-file maintenance.

## Soft pressure

Configure two stages on each `delegate` call. The policy applies to both synchronous and background tasks and does not affect other tasks.

```json
{
  "task": "Review error handling and report findings and unfinished work",
  "pressure": {
    "warning": { "afterSeconds": 180, "afterTurns": 15 },
    "urgent": { "afterSeconds": 360, "afterTurns": 30 }
  }
}
```

| Stage | Default trigger | Intended reminder |
| --- | --- | --- |
| `warning` | 300 seconds **or** 20 completed turns | Focus on the core goal, stop expanding scope, and prepare a final report. |
| `urgent` | 600 seconds **or** 40 completed turns | Finish exploration promptly, summarize available results, and state remaining work or blockers. |

### Validation and counting

- A stage becomes eligible when either threshold is reached (`>=`). Each stage sends at most one reminder, even if both thresholds are reached.
- Defaults apply field by field when `pressure`, a stage, or an individual field is omitted. Setting only `warning.afterSeconds: 180` keeps the default 20-turn warning threshold.
- `afterSeconds` must be a positive finite number; fractions are allowed. `afterTurns` must be a positive finite integer. `0` and `null` do not disable pressure.
- After defaults are filled in, `urgent.afterSeconds` must exceed `warning.afterSeconds`, and `urgent.afterTurns` must exceed `warning.afterTurns`.
- Invalid policies fail before child startup, including background calls. Values are not silently sorted, rewritten, or replaced with defaults.
- Timing starts at actual task execution, excluding queue residence and process/tool initialization. Model calls, tools, and waiting time count.
- One turn is a completed assistant response plus all associated tool execution. Individual, parallel, or nested tool calls do not add extra turns.

### Delivery guarantees

Reminders are sent through RPC `steer`. They can be consumed after the current turn's tools finish and before a subsequent model request; they do not interrupt an in-flight model request or tool.

RPC acceptance or queuing does not prove model consumption or compliance. Inherited extension input handling may process or rewrite the reminder.

Pressure is advisory: even after both stages, the extension does not automatically kill the child, disable tools, or change the task's outcome. There is no guaranteed maximum runtime or turn count. Explicit cancellation and normal cleanup still apply.

## Floating task panel

Run `/delegates` in TUI mode. This opens a single theme-aware native Pi overlay, without requiring or importing pi-open-tui. It uses the same records, exact identities, observations and background controls as the tools; closing the panel is not task cancellation.

- **List:** All / Active / Finished filters, live status/results and stable exact-ID selection. `↑/↓` selects, `Tab` / `Shift+Tab` changes filter, `Enter` opens details, and `Esc` / `q` closes.
- **Details:** Overview / Result tabs (`Tab`); `↑/↓` and `PgUp/PgDn` scroll metadata or available output. Long results retain their full-output path. `Esc` / `q` returns to the list.
- **Background controls:** `c` opens an exact-task cancellation confirmation, including the no-rollback warning; `Enter` confirms. `s` opens plain-text instruction composition only when the original task is steer-ready; `Enter` submits and `Esc` discards. Unicode and literal `q` are input text in composition. Synchronous tasks show a read-only reason, not enabled actions.
- **Receipts:** in-flight operations stay responsive; their status/receipt is shown without pretending that queued/handled steering was consumed. Uncertain operations are not automatically retried. If readiness or execution changes during confirmation/composition, the action rechecks availability before dispatch.
- **Lifecycle:** live redraws preserve the task identity rather than reselecting by row index. Theme/resize changes reflow content; very short terminals show resize guidance. Closing disposes only panel resources and restores host focus. Scope invalidation closes the panel and suppresses stale callbacks.

Outside TUI mode, use `delegate_list` / `delegate_status`; the command reports that the overlay requires TUI. Automated component/native-overlay evidence is not a full real-terminal keyboard, fullscreen or IME acceptance claim; see [testing boundaries](development.md#testing).

## TUI status display

In TUI mode, a compact list above the input shows synchronous and background children, not the parent.

Each child has:

- A session-local increasing numeric label that is not reused.
- Its supplied `title`, or a shortened first task line without an extra model call.
- Actual task-running seconds and English `turn` / `turns` labels.
- `pressure: none / warning / urgent`.
- A separate `│  model: provider/id · thinking: level` row showing confirmed startup configuration; before confirmation it says `unconfirmed`. The `│` aligns with the activity connector and `model` aligns with activity text. Thinking metadata does not imply observed thinking activity.
- An aligned `│  ↑... ↓... R... W... · $...` usage row; see [usage accounting and estimate limits](runtime.md#delegated-usage-visibility).
- A subordinate line with only current observed activity, such as `thinking…` or `toolcall · read`. With concurrent tools, the most recent name is followed by `(+N)` for the others; details list all current names.

The heading shows occupied/maximum capacity and queued count, followed by a separately labelled Delegated total. The list does not display thinking content, tool arguments, results, or roles. Queued and initializing phases are explicit and excluded from time/turn counts; elapsed execution time continues during provider/tool waits.

Pressure advances only after the child's RPC accepts that stage's steering request; it does not indicate consumption or compliance.

Terminal outcomes remain visible for 5 seconds and are then removed from the UI only. Both modes' records/results stay discoverable and queryable while their scope remains valid. Branch changes clear task rows/callbacks but retain cumulative delegated usage. Session replacement/reload and shutdown end the owning total.

The Agents area has 2-column horizontal insets when space permits and a 1-line gap above and below, counting Pi's existing widget spacing rather than doubling it. Insets shrink on narrow terminals before consuming space needed for identity and summary metadata.

Colors follow Pi's active theme, including theme switches and host-supported custom-theme hot reload, without separate extension color settings. English status text remains visible alongside color:

- Running/thinking/tool activity uses `accent`; completed uses `success`, incomplete uses `warning`, and failed uses `error`.
- Queued, initializing, finishing, and cancelled states use `muted`. Titles use normal text color; time, turns, and separators use secondary styling.
- Pressure independently uses `dim` for none, `warning` for warning, and `error` for urgent. Urgent pressure does not mean the task failed.

Narrow terminals preserve space for the numeric label, time, turns, and pressure where possible, shortening the title first. Extremely narrow output is truncated to terminal width. RPC, print, and JSON execution do not depend on this component.

The numeric UI label does not replace the exact `taskId` used for queries, steering and cancellation.
