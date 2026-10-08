# Roadmap

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Development](development.md)

Prioritize reliable delegation: tasks should be easy to find and manage, results should be reviewable, and failures or blockers should be straightforward for the parent to take over. Expanding into a general multi-agent orchestration platform is not the current direction.

Unchecked items below are unimplemented capability candidates, listed in suggested priority order. Tool names are illustrative; behavior and interfaces should be agreed before implementation. This list is not a release commitment.

## Prioritized candidates

### 1. Task listing and details

Implemented in the current source: `delegate_list`, unified `delegate_status`, read-only synchronous IDs and the native `/delegates` floating panel. Automated RPC/component/native-overlay checks cover this increment; real regular/fullscreen terminal and IME acceptance remains pending. See [verification boundaries](development.md#testing).

- [x] Expose a capability such as `delegate_list` to list queued, active, and terminal tasks in the current session/branch scope, without requiring the caller to remember each `taskId`.
- [x] Provide consistent task details: title, `taskId`, cwd, model, elapsed time, turns, current tool, pressure, usage, and available result. Distinguish requested configuration from confirmed effective configuration.
- [x] Establish an explicit relationship between TUI numeric labels and `taskId`; provide a TUI task panel for inspecting results, cancelling work, and sending additional instructions.
- [x] Keep execution outcome distinct from completion-message delivery failure. Task discovery and result access should not depend on the short-lived terminal status row.

### 2. Reviewable, traceable result handoff

- [ ] Offer an optional lightweight result template covering completed and unfinished work, changed files, commit/patch/artifact paths, performed checks and their results, omitted checks and their reasons, blockers, and decisions needed from the parent.
- [ ] Consider optional result schemas after the template workflow is established. Structural validation is not evidence that reported changes or checks are correct.
- [ ] Preserve the distinction between execution completion and task acceptance: `completed` means the child produced a final answer, not that requirements were satisfied or tests passed. The parent remains responsible for inspecting actual artifacts, integration, and necessary validation.

### 3. Bounded execution observability

- [ ] Expose the latest observed event time and current tool start time to help distinguish ongoing work from a lack of observable progress.
- [ ] Offer an on-demand, bounded recent-event view covering phase transitions, tool start/end events, steering receipts, and termination reasons, rather than continuously injecting full transcripts into the parent context.
- [ ] Consider opt-in execution-record export with explicit retention and sensitive-data handling. Existing startup diagnostics are not a full execution record.
- [ ] Report observed facts and unknowns: silence alone does not prove a hung task, and a steering receipt does not prove model consumption or compliance.

### 4. Explicit help and blocker handoff

- [ ] Let a child explicitly report a decision it needs from the parent, including the question, options, recommendation, and impact of proceeding without an answer.
- [ ] Make the handoff actionable for the parent without introducing blocking background dialogs. Preserve the existing refusal/cancellation behavior for unsupported background UI requests unless a separate interaction contract is agreed.
- [ ] Start with reliable blocker reporting, not implicit pause/resume. A still-active, steer-ready task can receive a decision through steering; an already terminal task requires an explicit follow-up delegation rather than pretending its execution is still open.

### 5. Optional execution budgets

- [ ] Consider explicit, opt-in maximum execution-time and completed-turn limits, separate from advisory soft pressure. Define timing/counting and cancellation semantics before implementation.
- [ ] On a limit-triggered stop, record the reason, retain available output and usage, and complete owned execution-resource cleanup. Cancellation does not roll back file changes or external side effects.
- [ ] Evaluate token/cost policies later. Delayed or missing usage and estimated pricing prevent a promise of an exact supplier-billing ceiling.

The recommended next increment is **a lightweight result handoff template**: make work manageable and its output reviewable before adding more execution controls.

## Delivered foundations

- [x] **Runtime steering:** `delegate_steer({ taskId, message })` lets the parent supply new context, narrow scope, or request a final report without cancelling and restarting a running task.
  - Distinguish RPC acceptance from model consumption or execution. Do not promise to interrupt an in-flight model request or tool.
- [x] **Per-task model selection:** allow a delegation to override the model and thinking level, retaining parent inheritance by default, to balance task complexity, speed, and cost.
- [x] **Concurrency scheduling and cost visibility:** support a maximum concurrency limit with excess tasks queued, distinguishing `queued / initializing / running`.
  - Aggregate subtask token/cost usage while maintaining a clear boundary from Pi's parent-session totals and avoiding duplicate accounting. Soft pressure remains advisory, not a forced timeout.
- [x] **Per-task working directory and bundled worktree workflow:** optional `delegate.cwd` selects an existing directory, resolved against the parent cwd at submission and retained through queueing. Started-child results include the absolute startup directory.
  - The bundled `delegate-worktree` skill guides the parent through independent Git worktrees from explicit commit baselines, reviewable child artifacts, and parent-owned review, integration and validation before cleanup. It does not automatically stash, commit or copy dirty main-workspace changes; failed or unmerged workspaces remain inspectable.
  - The plugin does not manage Git worktrees or merging, warn about scope conflicts, enforce tool permissions, or provide a sandbox. See [working-directory usage](usage.md#per-task-working-directory-and-worktrees) and [workspace boundaries](runtime.md#workspace-and-security-boundaries).
- [x] **Startup failure diagnostics:** automatically expose a bounded child-stderr tail and startup step through existing synchronous/background failure results, without persisting a stderr artifact. Diagnostics may contain sensitive information; see [runtime and privacy limits](runtime.md#completed-and-failed-tasks). This does not implement full execution records or result schemas.

## Not prioritized

These are not part of the current recommended increments; revisiting them requires an explicit scope and architecture decision.

- **Recursive delegation and multi-level agent trees:** preserve the clear parent-only delegation boundary rather than multiplying resource and ownership complexity.
- **Plugin-owned worktree creation or automatic merging:** retain the generic `cwd` capability, bundled skill, and parent-owned review/integration workflow.
- **Automatic retries of arbitrary failed tasks:** execution may already have changed files or caused external side effects; retrying is not inherently safe.
- **Execution surviving exit or cross-session resume:** this would introduce durable task-service concerns beyond the current session-owned runtime.
- **Automatic copying of the entire parent conversation:** keep explicit task context as the default instead of increasing cost and unrelated context implicitly.
