# Roadmap

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Development](development.md)

Unchecked items are unimplemented capability candidates, listed in suggested priority order. Tool names are illustrative; behavior and interfaces should be agreed before implementation. This list is not a release commitment.

If parallel code modification by multiple subagents becomes the primary use case, move workspace isolation earlier in the priority order.

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
- [ ] **Safe parallel modification:** allow declared file-modification scopes and warn about scope conflicts across tasks.
  - Offer optional Git worktree isolation and return a diff for the parent to review and merge.
  - Evaluate tool-permission controls. Distinguish read-only prompts, tool-exposure restrictions, and an operating-system sandbox; the first two are not guarantees of enforced isolation.
- [ ] **Verifiable, traceable results:** offer optional result templates/schemas covering changed files, performed and omitted checks, blockers, unfinished work, and artifact/diff/log paths.
  - Provide access to execution records for verification. Structural validation of a result is not verification that the task was completed correctly.
