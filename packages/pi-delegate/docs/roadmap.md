# Roadmap

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Development](development.md)

Make delegation easier to wait for, understand, and take over—not a general multi-agent orchestration platform. Prioritize lower parent-context overhead and reliable handoffs over more autonomous agents.

This document records future capability candidates and their suggested priority, not current features, fixed interfaces, implementation authorization, or release commitments. Tool names below are illustrative. Agree on each candidate's behavior and lifecycle before implementation.

<!-- Preserve inbound links from historical specs/ADRs without retaining delivered checklist items. -->
<a id="todo"></a>
<a id="1-task-listing-and-details"></a>
<a id="2-reviewable-traceable-result-handoff"></a>
<a id="5-optional-execution-budgets"></a>
<a id="1-explicit-waiting-and-incremental-queries"></a>

Delivered capabilities are documented in [Usage](usage.md) and [Runtime and safety](runtime.md); their decisions and requirements remain in the [grimoire](../../../.grimoire/). Remove delivered candidates from this roadmap rather than accumulating a completed-feature inventory. Removal does not imply new verification or user acceptance; see [verification boundaries](development.md#testing).

Status-only [explicit waiting](usage.md#explicit-waiting) is documented as current behavior. A separate lightweight-query mode or revision/cursor protocol is not scheduled; neither is required by the waiting contract.

## Prioritized candidates

### 1. Bounded execution observability

**Value:** Help the parent decide whether to keep waiting, steer, or cancel using observed activity rather than guesses.

- [ ] Expose the latest observed event time and start time/duration of each currently executing tool, including concurrent tools.
- [ ] Offer an on-demand, bounded recent-event view: phase transitions, tool start/end events, steering receipts, and termination reasons.
- [ ] Make a compact event timeline available in `/delegates`, using the same observations as tool queries.
- [ ] Define event retention, truncation, and unavailable-data indicators without retaining unbounded transcripts.

**Boundaries:** Silence means no recently observed event, not a proven hang. A steering receipt does not prove model consumption or compliance. Do not expose raw thinking, tool arguments, or full tool output by default, or continuously inject event streams into parent context. Keep observation separate from execution ownership.

### 2. Explicit help and decision handoff

**Value:** Let a child identify a decision it cannot safely make instead of guessing or burying the blocker in a final report.

- [ ] Provide a machine-readable way to report a question, options, recommendation, and impact of proceeding without an answer.
- [ ] Indicate whether other work can continue while the question remains unresolved.
- [ ] Surface unresolved questions through task queries and the task panel, with an explicit way to correlate answers and resolution.
- [ ] Let the parent answer a still-active, steer-ready child through steering; use an explicit new delegation when the original task has ended.

**Boundaries:** Start with reliable blocker reporting, not implicit pause/resume. A needs-decision indicator must not pretend execution is suspended. Do not add blocking background dialogs, automatic parent wake-up, or change the refusal/cancellation behavior of unsupported background UI requests without a separate interaction contract.

### 3. Explicit follow-up delegation

**Value:** Make “verify the second finding” or “continue the unfinished part” cheaper to hand off without reconstructing all context manually.

- [ ] Support creating a fresh task explicitly associated with an earlier task.
- [ ] Let the parent select the summary, artifact references, and additional instructions to carry forward.
- [ ] Show the predecessor/follow-up relationship in task details so a sequence of handoffs is traceable.
- [ ] Define behavior for unavailable predecessor records and missing or changed artifacts; disclose missing context instead of silently substituting it.

**Boundaries:** A follow-up starts a new child session, not a resumed old execution. Do not automatically copy the full transcript, retry failures, or treat previous reports as verified facts. Previous file changes and external side effects remain; the parent decides whether repeating work is safe. Task relationships do not introduce cross-session persistence or a dependency scheduler.

### 4. Reusable task presets

**Value:** Reduce repeated setup for review, research, and implementation tasks without introducing an agent-team framework.

- [ ] Explore named presets for model, thinking level, budget, result format, and task guidance.
- [ ] Allow explicit invocation overrides and expose the resolved configuration.
- [ ] Define configuration source, precedence, validation, and capture timing before adding runtime configuration.
- [ ] Prefer bundled skills for instruction-only workflows; add runtime support only where deterministic configuration resolution provides additional value.

**Boundaries:** Presets reuse configuration, not identities, child sessions, or permissions. A “read-only review” instruction is not enforced filesystem protection. Do not silently change the parent model, saved defaults, or existing calls that omit a preset.

## Later candidates

These remain worth evaluating, but come after the core observation and handoff improvements.

- [ ] **Optional structured results:** evaluate schemas when there is a concrete machine-consumption need beyond the advisory handoff template. Keep structural validation separate from artifact verification and task acceptance; do not make every task comply with a mandatory format or automatically run repair turns.
- [ ] **Opt-in execution-record export:** build on bounded observations with explicit content selection, retention, sensitive-data handling, and cleanup rules. Exporting a record is not durable execution or cross-session resume; startup diagnostics alone are not a full execution record.
- [ ] **Token/cost policies:** evaluate advisory thresholds or observed-usage stop policies after defining partial/delayed usage behavior. Estimated pricing and missing provider reports cannot support an exact supplier-billing ceiling.

## Not prioritized

Revisiting these requires an explicit scope and architecture decision, not an incidental addition to one of the candidates above.

- **Recursive delegation and multi-level agent trees:** avoid multiplying resource and ownership complexity.
- **General workflow/DAG orchestration or autonomous agent teams:** keep task relationships and presets lightweight; the parent coordinates work.
- **Plugin-owned worktree creation or automatic merging:** retain generic working-directory selection, the bundled skill, and parent-owned workspace management, review, integration, and validation.
- **Automatic retries of arbitrary failed or incomplete tasks:** prior execution may already have changed files or caused external side effects.
- **Execution surviving exit or cross-session resume:** avoid turning the session-owned plugin into a persistent task service.
- **Automatic copying of the entire parent conversation:** keep task context explicit and bounded.
- **Automatic background completion messages or idle-parent wake-up:** preserve query-only results; reduce polling through explicit waiting instead.

## Decision references

The candidates above are recorded proposals, not new implemented guarantees or replacements for existing decisions:

- [Query-only background result retrieval](../../../.grimoire/adr/0021-query-only-background-result-retrieval.md) — no unsolicited completion delivery or wake-up.
- [Task-addressed runtime steering](../../../.grimoire/adr/0004-task-addressed-runtime-steering.md) — active-task control and receipt boundaries.
- [Advisory result handoff](../../../.grimoire/adr/0017-advisory-result-handoff-template.md) — reports and format compliance are not acceptance.
- [Bundled worktree skill](../../../.grimoire/adr/0009-bundled-worktree-skill-without-plugin-git-management.md) — Git lifecycle and integration remain outside the runtime.

Start with **bounded execution observability**: it improves routine delegation while preserving the current execution and ownership boundaries.
