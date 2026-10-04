# Usage guide

[Back to README](../README.md) · [Runtime and safety](runtime.md) · [Development](development.md) · [Roadmap](roadmap.md)

This guide describes the model-callable tools provided by pi-delegate. Load the extension using the [installation instructions](../README.md#installation).

## Tools

The parent agent receives three tools:

| Tool | Purpose |
| --- | --- |
| `delegate` | Start a fresh subagent and wait for its outcome, or accept a background task. |
| `delegate_status` | Retrieve a background task's state and available result. |
| `delegate_cancel` | Cancel a background task and wait for execution-resource cleanup. |

Children do not register any of these tools. Apart from an internal child-initialization command, the extension does not register user commands.

## Starting a task

### Parameters

| Parameter | Required | Meaning |
| --- | --- | --- |
| `task` | Yes | Task text. Empty or whitespace-only text is rejected. |
| `context` | No | Supplementary context. The parent's complete conversation is not copied. |
| `title` | No | Short TUI display title. Defaults to the shortened first line of `task`. |
| `background` | No | Set to `true` to return a background task ID instead of waiting. Defaults to synchronous execution. |
| `pressure` | No | Per-task warning and urgent finish-reminder thresholds. Omitted fields use defaults. |

### Synchronous execution

```json
{
  "task": "Review error handling in src/ and report findings with file paths",
  "context": "Analyze only; do not modify files",
  "title": "Review error handling"
}
```

The call remains pending until the child finishes or fails. Cancelling the initiating call cancels its child. Each invocation creates a new process and a fresh in-memory session; previous child conversations are not reused.

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

The call immediately returns `details.taskId` and `details.status: "running"`. This acknowledges acceptance, not child readiness or successful completion. The parent can continue other work while initialization and execution proceed.

When the child reaches a terminal outcome, the extension sends a model-visible `pi-delegate:completed` message with the task ID, outcome, and available output:

- While the parent is busy, completion remains queued in the extension until current and already queued work has finished.
- When the parent is idle, delivery triggers a turn to process the result.
- Failed, cancelled, and incomplete outcomes are delivered as well as completed ones.

This is not merely a UI notification. Delivery is not a durable acknowledgement that the model consumed the result, and exactly-once model processing is not guaranteed.

## Querying and cancelling background tasks

Use the ID returned by the background call:

```json
{ "taskId": "<taskId returned by delegate>" }
```

Pass this object to `delegate_status` to query, or to `delegate_cancel` to cancel.

- Queries return the current state and any available output. A running state is not a final answer.
- Terminal results remain queryable in their originating session/branch scope, even if a completion message was cleared or not processed.
- `delegate_cancel` waits for child-process and initialization-resource cleanup. Cancelling an already finished task preserves its result.
- Failed and cancelled task queries have `isError: true`. Unknown or invalidated IDs fail explicitly.
- Exit, session replacement/forking, extension reload, and branch-changing `/tree` navigation invalidate task IDs. See [task ownership](runtime.md#task-ownership-and-cleanup).

### Background result fields

| Field | Meaning |
| --- | --- |
| `details.taskId` | Background task identifier. |
| `details.status` | `running` or one of the four terminal outcomes below. |
| `details.result` | Available child-result metadata, including session/stop reason, errors, truncation, and full-output path when present. |
| `details.usage` | Available child token and cost usage. |
| `details.accounting` | Reminder that background usage is separate from Pi's parent-session totals. |
| `details.deliveryError` | Completion-delivery error, when one was observed. |

Background usage is reported separately and is **not automatically included in Pi's parent-session totals**. Query and cancellation tools do not return top-level usage, preventing duplicate accounting. Synchronous usage reporting is unchanged.

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
- Timing starts at actual task execution, excluding process/tool initialization. Model calls, tools, and waiting time count.
- One turn is a completed assistant response plus all associated tool execution. Individual, parallel, or nested tool calls do not add extra turns.

### Delivery guarantees

Reminders are sent through RPC `steer`. They can be consumed after the current turn's tools finish and before a subsequent model request; they do not interrupt an in-flight model request or tool.

RPC acceptance or queuing does not prove model consumption or compliance. Inherited extension input handling may process or rewrite the reminder.

Pressure is advisory: even after both stages, the extension does not automatically kill the child, disable tools, or change the task's outcome. There is no guaranteed maximum runtime or turn count. Explicit cancellation and normal cleanup still apply.

## TUI status display

In TUI mode, a compact list above the input shows synchronous and background children, not the parent.

Each child has:

- A session-local increasing numeric label that is not reused.
- Its supplied `title`, or a shortened first task line without an extra model call.
- Actual task-running seconds and English `turn` / `turns` labels.
- `pressure: none / warning / urgent`.
- A subordinate line with only current observed activity, such as `thinking…` or `toolcall · read`.

The list does not display thinking content, tool arguments, results, roles, tokens, or costs. Initialization is excluded from time/turn counts, and elapsed time continues during tool waits.

Pressure advances only after the child's RPC accepts that stage's steering request; it does not indicate consumption or compliance.

Terminal outcomes remain visible for 5 seconds and are then removed from the UI only. Background results stay queryable while their scope remains valid. Scope changes, reload, and shutdown clear old displays and callbacks.

Narrow terminals preserve space for the numeric label, time, turns, and pressure where possible, shortening the title first. Extremely narrow output is truncated to terminal width. RPC, print, and JSON execution do not depend on this component.

The numeric UI label does not replace the background `taskId` used for queries and cancellation.
