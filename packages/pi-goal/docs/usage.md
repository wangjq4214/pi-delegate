# Usage guide

[Back to README](../README.md) · [Runtime and safety](runtime.md) · [Development](development.md) · [Roadmap](roadmap.md)

This guide covers user commands and parent-agent tools. Load both goal and delegate using the [local setup instructions](../README.md#local-setup). Goal is currently a private local workspace package, not an npm-installable release.

## Create and confirm a goal

While the parent is idle, describe the desired outcome in ordinary language:

```text
/goal Fix the parser regression, add a reproduction test, and keep the existing parser tests passing. Allow at most 12 goal dispatches.
```

The current parent discusses the objective and acceptance conditions, asking about consequential ambiguity or missing information. You do not need to write JSON or a task schema. If you omit the allowance, supply it in a follow-up; there is no numeric default or unlimited setting.

Draft discussion is ordinary chat with normal model usage. It must not activate the goal, launch workers/reviewers, or enter goal-driven automatic continuation.

When the draft is ready, the agent calls `goal_propose`. A runtime-owned **Start / Cancel** selection displays:

- The objective and acceptance conditions.
- The explicitly supplied allowance.
- The working directory in which the goal will run.

Only choosing **Start** authorizes that displayed draft. Chat assent such as “go ahead”, a model-generated approval field, or submitting the proposal is not authorization. Confirmation requires a dialog-capable TUI or a participating RPC client; unavailable or unanswered confirmation does not silently start execution.

Cancel or dismiss the selection to abandon the proposal. New input, draft changes, pause, abort, or scope teardown invalidate pending confirmation; a late response cannot start an outdated proposal. `/goal pause` also discards a pending draft. Drafts are session-local and are not saved as active goals.

## Commands

| Command | Behavior |
| --- | --- |
| `/goal <natural-language objective>` | Begin draft discussion while the parent is idle. |
| `/goal` or `/goal status` | Show current draft, goal state, runtime activity, and reinspection status. |
| `/goal list` | List globally saved goals and report damaged records separately. |
| `/goal status <goal-id>` | Read a saved record without starting it. |
| `/goal pause` | Revoke goal scheduling, cancel owned work, wait for cleanup, and discard any draft. |
| `/goal resume <goal-id> <allowance>` | Explicitly resume a saved unfinished goal with a new positive integer allowance. |

Status and list use readable native notifications, with the host's Unicode wrapping and active theme rather than a dedicated dashboard. `/goal list` shows objective summaries, copyable exact IDs, saved status, accepted/total item counts and working directories. Damaged records appear separately without hiding valid goals; overall store errors are not reported as an empty list.

Copy an ID into `/goal status <goal-id>` for objective, acceptance conditions, individual work-item progress, dispatch allowance, stop/recovery information and the latest current/stale review assessment. These are saved observations, not proof of a live process or ownership. Worker completion is not item acceptance, and all items accepted does not itself complete the goal. Missing run/review data is labelled unavailable rather than zero or approval.

`/goal` and `/goal status` distinguish a non-executing draft, current runtime coordination authority and recovery reinspection requirements. They do not observe live subagent activity. Inspection does not start/resume work, acquire execution ownership, repair journals or renew allowance. Display text escapes terminal controls and embedded newlines; list objectives and detail review/checkpoint summaries may be explicitly truncated, but lookup IDs are not abbreviated. Model-facing `goal_status` remains structured JSON with `runtimeActive` and `reinspectionRequired` where applicable.

Pause an active goal before starting or resuming another. Start and resume require an idle parent; saved-goal inspection does not authorize execution. Current commands do not provide goal revision, archival, or a goal picker; those are [roadmap candidates](roadmap.md).

## Allowance and stopping

The allowance is a positive safe integer shared by goal-initiated dispatches:

| Dispatch | Charge |
| --- | --- |
| Initial coordinator | One unit. |
| Each extension-requested coordinator continuation | One unit. |
| Each worker attempt | One unit. |
| Each independent reviewer attempt | One unit. |

Planning, status reads, evidence acceptance, and reinspection are not separate dispatch charges. Existing within-run host/tool turns are not individually counted either. This is **not** a total model-request, token, monetary, wall-clock, or process-stop ceiling.

For example, an allowance of three can fund an initial coordinator, one worker, and one reviewer if no additional coordinator dispatch is needed. It does not promise that every goal can complete in that sequence. Reserve capacity for mandatory review; using the last unit on a worker can leave accepted work unfinished.

Capacity is charged before dispatch. Failure, incomplete output, cancellation, or reviewer rejection does not replenish it. If the next needed dispatch cannot fit, goal pauses with an allowance-exhausted reason, saving progress without another model wrap-up. Explicit user resume supplies a new allowance while preserving earlier attempt history.

Optional worker execution budgets limit a single delegate invocation and remain separate from the goal allowance. See [worker parameters](#goal_work) and delegate's [execution-budget reference](../../pi-delegate/docs/usage.md#optional-execution-budget).

## Agent workflow and tools

These are model-callable parent tools, not additional slash commands. Delegated children cannot register, discover, or invoke them through goal's parent-only tool integration.

The normal execution flow is:

1. Plan bounded logical work items with explicit acceptance conditions.
2. Run one item through `goal_work`, supplying the task and relevant context.
3. Inspect actual results, tests, and artifacts; record acceptance with `goal_accept` only when justified.
4. Continue bounded work, or request independent `goal_review` after all items are accepted.
5. Use `goal_block` when a user decision or other blocker prevents safe continuation.

Worker `completed` means an execution outcome, not acceptance. The coordinator must not bypass goal allowance using ordinary delegate calls, shell-spawned workers, or self-performed implementation.

### Tool reference

| Tool | Parameters | Responsibility |
| --- | --- | --- |
| `goal_propose` | `draftId`, `objective`, nonempty `criteria`, `allowance` | Submit the current draft for native Start/Cancel confirmation. The draft ID comes from current draft context, not a user-authored schema. |
| `goal_status` | Optional `id` | Read the current report or a saved goal by exact ID. |
| `goal_plan` | Nonempty `items: [{ id, title, acceptance }]`, `checkpoint` | Upsert logical work items and a progress checkpoint; does not execute or accept them. |
| `goal_work` | `itemId`, `task`, optional settings below | Run one already planned item through delegate. |
| `goal_accept` | `itemId`, `evidence: string[]`, `artifacts: string[]` | Record the parent's evidence assessment and relevant files. Requires nonempty evidence; does not complete the goal. |
| `goal_review` | `{}` | Run a fresh independent reviewer after all items have acceptance evidence. |
| `goal_reinspect` | `evidence: string[]`, `artifacts: string[]` | Record actual recovery findings before resumed work, acceptance, or review. Requires nonempty evidence. |
| `goal_block` | `reason` | Pause with a concrete blocker, preserving progress and effects. |

Work-item IDs use 1–80 ASCII letters, digits, underscores, or hyphens, and must be distinct within a plan call. Titles, acceptance conditions, and checkpoints must be nonblank. Upserts preserve existing items omitted from the call; they are not a replacement or deletion operation. Changing an item's title or acceptance condition resets it to pending and invalidates prior goal review.

### goal_work

| Parameter | Required | Meaning |
| --- | --- | --- |
| `itemId` | Yes | Exact ID of a planned work item. |
| `task` | Yes | Nonblank bounded task instructions. |
| `context` | No | Additional explicit context; the parent's entire conversation is not copied. |
| `budget` | No | `{ maxSeconds?, maxTurns? }` for this worker only. Seconds must be positive and finite; turns a positive integer. Omitted dimensions are unlimited. |
| `model` | No | Exact `{ provider, id }` selection supported by delegate; omission inherits the current parent selection. |
| `thinkingLevel` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; omission inherits the parent level, subject to native model capability adjustment. |

The goal's saved cwd is supplied automatically; there is no per-item cwd override or background flag. The tool waits for the synchronous delegate invocation, including admission and cleanup. Workers share delegate's runtime capacity with ordinary delegations. Goal supplies the overall objective, criteria, and selected item as context alongside any additional instructions.

Example agent parameters, after planning an item named `parser-fix`:

```json
{
  "itemId": "parser-fix",
  "task": "Fix the parser regression, add the reproduction test, and run the parser test suite. Report changed files, commands, results, and unfinished work.",
  "context": "Keep unrelated parser behavior unchanged; do not commit or release.",
  "budget": { "maxSeconds": 180, "maxTurns": 12 }
}
```

This worker budget is an example, not a default. Cancellation retains available partial output and reported usage where possible; it does not roll back edits.

### Evidence and independent review

After inspecting the real outputs, the parent can record evidence such as:

```json
{
  "itemId": "parser-fix",
  "evidence": [
    "Inspected the reproduction assertion and parser changes; the targeted test command passed."
  ],
  "artifacts": ["src/parser.ts", "tests/parser.test.ts"]
}
```

This is an illustrative assessment, not proof that those files or checks exist in your project. Use actual findings and paths. Both arrays must be supplied; `artifacts` may be empty when there are no file references. Supplied artifact paths resolve against the goal cwd and must identify existing regular files. Directories are rejected. Register relevant files so recovery can detect missing evidence and review can check for changes during assessment.

Every item must be explicitly accepted before review. The reviewer receives the objective, criteria, items/evidence, and worker-attempt summaries, and is instructed to inspect actual artifacts without implementing fixes. It must provide reasons/evidence and finish with an exact nonempty line of `<approved/>` or `<disapproved/>`; an approval marker alone is insufficient.

Only affirmative, completed, non-partial review of the current state can complete the goal. Rejection, failure, cancellation, malformed output, changed registered files during review, or revoked authority leaves it unfinished. The parent may choose further bounded work while capacity remains or expose a blocker. There is no review bypass or separately configurable reviewer model yet.

Tool responses contain JSON text and structured details. Current-runtime reports expose `draft`, `state`, `runtimeActive`, and `reinspectionRequired` where applicable; saved-ID queries return the saved state and current runtime activity for that ID. Errors set `isError` and include the current report. Durable attempt summaries are bounded, not full transcripts; inspect actual files and delegate results when a summary is truncated or incomplete.

## Pause and recovery

Pause stops new scheduling immediately and requests cancellation of only goal-owned children. Wait for cleanup before treating those children as settled. Existing edits and external effects remain. Abort, reload, branch navigation, session replacement, and shutdown invalidate execution rather than creating a persistent background service.

After restart, inspect saved state and resume deliberately from its original working directory:

```text
/goal list
/goal status <goal-id>
/goal resume <goal-id> 8
```

The ID is a placeholder and eight is an example allowance. Resume checks the cwd and registered artifacts, marks ambiguous running attempts interrupted, and requires the parent to inspect actual files/tests and previous effects, then call `goal_reinspect`. Resuming is not permission to replay an interrupted task blindly or reconnect a dead child. Completed goals cannot be resumed.

See [persistence and recovery](runtime.md#persistence-and-recovery) for storage and ownership details.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Delegate integration unavailable or incompatible | Load both extensions once, build delegate's public `/api` entry first, and use the supported workspace versions. Installing the dependency alone does not load delegate. |
| Parent is busy or another goal is active | Wait for idle; pause the existing goal before starting/resuming another. |
| Confirmation unavailable, cancelled, or stale | Use a dialog-capable TUI or participating RPC client; submit a current draft and choose Start. Do not bypass confirmation with JSON or chat assent. |
| Allowance exhausted | Inspect retained progress and explicitly resume with another finite allowance if further work is authorized. |
| Recovery reinspection required | Inspect current files, tests, artifacts, and previous effects, then record findings with `goal_reinspect`. |
| Saved cwd mismatches or evidence is missing | Return to the saved project and investigate missing files. Do not substitute the current directory or claim unavailable evidence is verified. |
| Journal corruption or ownership conflict | Stop competing owners, preserve/back up the record, and investigate the reported error. Do not delete uncertain locks or automatically rewrite the journal. There is no repair command yet. |

All goal bookkeeping lives outside the project under the resolved global agent root. Treat records as sensitive task/result data. Read [runtime and safety](runtime.md) before relying on cancellation, review, or storage as an isolation guarantee.
