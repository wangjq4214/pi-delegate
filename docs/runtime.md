# Runtime and safety

[Back to README](../README.md) · [Usage](usage.md) · [Development](development.md) · [Roadmap](roadmap.md)

pi-delegate uses a fresh Pi RPC child for every task. This document explains what is inherited, who owns the execution, and which guarantees the extension does not provide.

## Process model

Each invocation launches a separate Pi CLI process in RPC mode and creates a new in-memory session. Child sessions are not reused, and the parent's full conversation is not transferred. Only the explicit task and optional supplementary context are supplied as task input.

The child uses the CLI from the installed Pi host package:

- A Node.js host uses the current Node executable.
- A Bun host requires `node` on `PATH`.

RPC control commands have a 40-second response timeout. Inherited-tool initialization waits up to 30 seconds for missing tools to become available. The model task itself has no fixed timeout; [soft pressure](usage.md#soft-pressure) is advisory rather than a hard execution budget.

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

Keep configuration files stable during child startup. Unobservable host-private flags and arbitrary runtime state are outside the inheritance contract.

## Parent-only delegation

The child loads this extension, but does not register `delegate`, `delegate_status`, or `delegate_cancel`. These capabilities are unavailable through direct model declarations, tool search, and nested `codemode` calls.

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

Full-output files are separate result artifacts and intentionally survive this cleanup so callers can retrieve truncated text. See [large output](usage.md#large-output).

## Completion delivery

Background outcomes remain available for task queries independently of the host's completion-message queue. The extension delivers pending outcomes when the originating parent can process them, using a model-visible follow-up message and idle turn triggering.

The message API does not provide a durable acknowledgement of model consumption. Delivery does not promise exactly-once inference; querying the task is the recovery path if a completion message is cleared or not processed.

## Child UI requests

For synchronous tasks:

- Supported RPC `select`, `confirm`, and `input` requests are forwarded to the parent's UI.
- Requests are cancelled when no UI is available.
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
