# Runtime and safety

[Back to README](../README.md) · [Usage](usage.md) · [Development](development.md) · [Roadmap](roadmap.md)

pi-delegate uses a fresh Pi RPC child for every task. This document explains what is inherited, who owns the execution, and which guarantees the extension does not provide.

## Process model

Each admitted invocation launches a separate Pi CLI process in RPC mode and creates a new in-memory session. Child sessions are not reused, and the parent's full conversation is not transferred. Only the explicit task and optional supplementary context are supplied as task input.

The child uses the CLI from the installed Pi host package:

- A Node.js host uses the current Node executable.
- A Bun host requires `node` on `PATH`.

RPC control commands have a 40-second response timeout. Inherited-tool initialization waits up to 30 seconds for missing tools to become available. The model task itself has no fixed timeout; [soft pressure](usage.md#soft-pressure) is advisory rather than a hard execution budget.

## Concurrency scheduling

Synchronous and background tasks share a runtime-local FIFO pool, excluding the parent. The default maximum is **4**. Set `PI_DELEGATE_CONCURRENCY` to a positive safe integer before Pi starts; it is read when the extension registers and cannot be adjusted at runtime. Invalid values fail extension registration rather than silently removing the limit.

POSIX shell example:

```sh
PI_DELEGATE_CONCURRENCY=1 pi --extension ./src/index.ts
```

PowerShell example:

```powershell
$env:PI_DELEGATE_CONCURRENCY = "1"
pi --extension ./src/index.ts
```

Excess tasks remain `queued` with captured invocation/model/thinking inputs and no child process. Admitted tasks are `initializing` until observed original-task execution makes them `running`. Initialization and owned cleanup both occupy capacity; settlement alone does not release it. Queued cancellation settles without launching a child. Background acceptance remains immediate and independent of ordinary parent-turn cancellation; synchronous calls wait through admission, execution and cleanup.

Queue residence and initialization do not advance execution clocks, turns or soft pressure, and are not steer-ready. Scheduling adds no timeout, priority, preemption or automatic cost-budget cancellation.

## Tool and configuration inheritance

The child follows normal initialization rather than executing tools through parent-process proxies.

Inheritance includes:

- The parent's working directory and environment.
- Project-trust state, current model, and thinking level.
- Extensions loaded through conventional configuration discovery, explicit extension paths, and observable tool/command source paths.
- Available extension CLI flags that can be replayed.
- The full inherited tool set, followed by restoration of the parent's active subset.
- Discoverable tools, including those reachable through `tool_search` and `codemode`.

MCP reconnects using the same configuration. Parent connections, caches, arbitrary in-memory configuration, and closure state are not shared.

After initialization, the extension checks inherited tool availability, schema, exposure, namespace, and activation state. Tools that cannot be reconstructed fail explicitly: they are not silently omitted, and execution does not fall back to parent proxies.

Model/thinking inheritance is a plain invocation snapshot with independent optional overrides. The runner uses exact RPC `set_model` (not fuzzy CLI model patterns), then `set_thinking_level` and `get_state` after tool initialization and before original-task submission. Pi adjusts thinking capabilities and checks child-local auth configuration. Results distinguish requested and confirmed effective startup values; the visual-only Agents list consumes confirmed data. Model selection/readback failures never execute the task on a fallback model. No resolved credentials are copied, and no task overrides are persisted to user/project defaults.

Keep configuration files stable during child startup. Unobservable host-private flags and arbitrary runtime state are outside the inheritance contract.

## Parent-only delegation

The child loads this extension, but does not register `delegate`, `delegate_status`, `delegate_cancel`, or `delegate_steer`. These capabilities are unavailable through direct model declarations, tool search, and nested `codemode` calls.

This is a tool-registration boundary, not an operating-system sandbox. A child with shell access still has process-level capabilities and can launch other processes.

## Task ownership and cleanup

### Synchronous tasks

The initiating delegation call owns the child. Cancelling that call or shutting down the parent session terminates the child and cleans up owned initialization resources.

### Background tasks

Accepted background work belongs to the originating session/runtime, not the initiating parent turn. Ordinary parent-turn completion or cancellation does not cancel it.

Explicit `delegate_cancel` cancels running work and waits for cleanup. Exit, session replacement/forking, extension reload, and branch-changing `/tree` navigation cancel background tasks and invalidate their IDs.

Results are not migrated into a replacement runtime or delivered to a destination branch. To avoid navigation races, tasks are cancelled before navigation; even if navigation is later cancelled, those tasks are not resurrected.

Background execution is asynchronous work inside the current Pi session, not a persistent service that survives Pi exit.

### Completed and failed tasks

Normal completion and failure also release the child process and temporary initialization snapshot.

Usage is collected from final child entries when available. If cancellation or a transport failure prevents collection, results retain usage already observed in message events and the latest cumulative streaming update. Unreported provider usage cannot be recovered; these failure-path totals can be partial. Streaming updates, final messages, and final entries are not added together twice.

The authoritative readback includes assistant/tool-result messages, standalone usage entries and usage-bearing compaction/branch-summary entries. Nested tool usage already included in a tool result is not counted again; reasoning and cache-write subsets are not extra output/cache charges.

### Delegated usage visibility

The Agents area shows latest task usage and an explicitly labelled cumulative **Delegated total**, separate from Pi's parent-session totals. Contributions are replaced by new snapshots, not charged again on queries, completion delivery or final readback. Completed, failed and cancelled consumption survives the five-second row expiry. Branch navigation removes task handles/rows but retains consumed usage, including available late cleanup reconciliation. Session replacement/reload creates a fresh total; no cross-runtime usage history is persisted.

The compact format is `↑8.2k ↓1.1k R20k W0 · $0.04`: ↑ is model input tokens, ↓ is output tokens, R is cache-read tokens and W is cache-write tokens. These are not network bytes, and cache tokens are separate from input. Display rounding does not change stored accounting precision.

The dollar value is Pi's provider-reported/calculated **estimate**, not the supplier invoice. Subscription and custom-provider pricing may differ or report zero. Updates depend on provider/host reporting; failure/cancellation totals may be partial and unreported consumption cannot be recovered. Do not add delegated totals to parent totals: synchronous usage is already represented through host tool-result accounting, whereas background usage is separately reported. The ledger and scheduling work without the TUI widget.

Full-output files are separate result artifacts and intentionally survive this cleanup so callers can retrieve truncated text. See [large output](usage.md#large-output).

## Runtime steering control

The background task owner resolves scope-local IDs and receives only a narrow `steer(message)` capability. The execution runner continues to own the process, transport, readiness observations and cleanup. Manual steering and pressure await RPC outcomes through the same task-local serial submission boundary; stdin write serialization alone would not order asynchronous Pi input handlers.

Readiness begins only after initialization and original-task start. Cancellation/invalidation disables controls synchronously, and `agent_settled` closes control before result collection/cleanup completes. Low-level `agent_end` may precede continuation and does not close it. Pending local submissions recheck closure before sending; an already-submitted host handler can finish after settlement without reopening the control or triggering a replacement run.

Manual text uses non-slash-prefixed raw RPC `steer`, preserving trusted handlers and host consumption mode. The prefix is not a sandbox against trusted handlers. The handling receipt is distinct from queue residence, transcript injection and eventual provider input. A control timeout has an uncertain submission outcome and is never automatically retried; it is not a new delivery/completion SLA. Manual-operation failures are separate from task outcomes; underlying transport/execution failures remain governed by normal delegation lifecycle. See [steering usage and receipt fields](usage.md#steering-an-active-background-task).

## Completion delivery

Background outcomes remain available for task queries independently of the host's completion-message queue. The extension delivers pending outcomes when the originating parent can process them, using a model-visible follow-up message and idle turn triggering.

The message API does not provide a durable acknowledgement of model consumption. Delivery does not promise exactly-once inference; querying the task is the recovery path if a completion message is cleared or not processed.

## Child UI requests

For synchronous tasks:

- Supported RPC `select`, `confirm`, and `input` requests are forwarded to the parent's UI.
- Requests are cancelled when no UI is available.
- Pending forwarded dialogs are cancelled when their delegation returns, including child failure and normal completion; this does not change the task's outcome.
- Multiline `editor` requests are cancelled because the parent extension API cannot abort an open editor safely.
- Child notifications are forwarded with a subagent label.

For background tasks, `select`, `confirm`, `input`, and `editor` requests receive cancellation or refusal instead of opening blocking parent dialogs.

Refusing an individual request does not automatically cancel the whole task. Whether the child can continue determines its eventual outcome.

## Workspace and security boundaries

Parent and child agents access the same workspace. There is no worktree isolation, file locking, or operating-system sandbox provided by this extension.

Coordinate modification scopes when multiple agents can write files. A prompt such as "analyze only" is an instruction, not an enforced filesystem permission.

Tools and environment inherited by a child may carry substantial authority. Excluding delegation tools prevents recursive tool access through this extension, not arbitrary process actions.

## Compatibility and verification

The implementation is validated with Pi 1.0.0. That evidence does not establish compatibility with every Pi version.

Tests exercise real Pi RPC processes, inheritance and MCP reconstruction, lifecycle boundaries, and deterministic local model providers. TUI runtime integration is covered, but full terminal rendering and keyboard/picker end-to-end behavior are not claimed. Tests requiring external model credentials are not part of the current verification.

See the [development guide](development.md#testing) for verification commands and test boundaries.
