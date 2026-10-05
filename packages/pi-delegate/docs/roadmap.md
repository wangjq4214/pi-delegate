# Roadmap

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Development](development.md)

Unchecked items are unimplemented capability candidates, listed in suggested priority order. Tool names are illustrative; behavior and interfaces should be agreed before implementation. This list is not a release commitment.

## TODO

- [x] **Runtime steering:** `delegate_steer({ taskId, message })` lets the parent supply new context, narrow scope, or request a final report without cancelling and restarting a running task.
  - Distinguish RPC acceptance from model consumption or execution. Do not promise to interrupt an in-flight model request or tool.
- [ ] **Task listing and details:** expose a capability such as `delegate_list` to list running and terminal tasks in the current session scope.
  - Include title, elapsed time, turns, current tool, pressure, usage, and result details. Establish an explicit relationship between TUI numeric labels and `taskId`.
  - Add a TUI task panel for inspecting results, cancelling work, and sending additional instructions.
- [x] **Per-task model selection:** allow a delegation to override the model and thinking level, retaining parent inheritance by default, to balance task complexity, speed, and cost.
- [x] **Concurrency scheduling and cost visibility:** support a maximum concurrency limit with excess tasks queued, distinguishing `queued / initializing / running`.
  - Aggregate subtask token/cost usage while maintaining a clear boundary from Pi's parent-session totals and avoiding duplicate accounting.
  - Evaluate explicit, opt-in hard budget policies when needed. Preserve soft pressure as advisory rather than silently turning it into forced timeouts.
- [x] **Per-task working directory and bundled worktree workflow:** optional `delegate.cwd` selects an existing directory, resolved against the parent cwd at submission and retained through queueing. Started-child results include the absolute startup directory.
  - The bundled `delegate-worktree` skill guides the parent through independent Git worktrees from explicit commit baselines, reviewable child artifacts, and parent-owned review, integration and validation before cleanup. It does not automatically stash, commit or copy dirty main-workspace changes; failed or unmerged workspaces remain inspectable.
  - The plugin does not manage Git worktrees or merging, warn about scope conflicts, enforce tool permissions, or provide a sandbox. See [working-directory usage](usage.md#per-task-working-directory-and-worktrees) and [workspace boundaries](runtime.md#workspace-and-security-boundaries).
- [ ] **Verifiable, traceable results:** offer optional result templates/schemas covering changed files, performed and omitted checks, blockers, unfinished work, and artifact/diff/log paths.
  - Provide access to execution records for verification. Structural validation of a result is not verification that the task was completed correctly.
  - [x] **Startup failure diagnostics:** automatically expose a bounded child-stderr tail and startup step through existing synchronous/background failure results, without persisting a stderr artifact. Diagnostics may contain sensitive information; see [runtime and privacy limits](runtime.md#completed-and-failed-tasks). This does not implement full execution records or result schemas.
