# Roadmap

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Development](development.md) · [Delegate roadmap](../../pi-delegate/docs/roadmap.md)

Make bounded goals easier to revise, observe, and manage while keeping the parent responsible for coordination and delegate responsible for execution. Prioritize everyday goal management over feature parity with another orchestration runtime.

This document records future capability candidates and their suggested priority, not current features, fixed interfaces, implementation authorization, or release commitments. Agree on each candidate's behavior and lifecycle before implementation.

Current capabilities and limitations are documented in the [README](../README.md); requirements and verification evidence remain in [Spec 0019](../../../.grimoire/spec/0019-bounded-goals-on-delegate.md). Remove delivered candidates from this roadmap rather than accumulating a completed-feature inventory. Removal does not imply new verification or user acceptance.

## Comparison baseline

These candidates follow a source comparison with [pi-goal-x 0.34.1](https://github.com/tmonk/pi-goal-x/tree/b0fc15e). The main differences concern product usability and long-running goal management, not a missing execution loop. Goal already supports conversational creation with runtime-owned confirmation, delegated work, explicit evidence acceptance, mandatory independent review, finite dispatch allowances, global persistence, and deliberate recovery.

The comparison was source-based, not a live-provider or manual TUI verification. Upstream capabilities are inspiration, not requirements or evidence that the current spec is unmet.

## Prioritized candidates

### 1. Confirmed goal revisions and work-item lifecycle

**Value:** Adapt an existing goal when requirements change without starting over or retaining obsolete work items indefinitely.

Today, saved objectives and acceptance conditions are immutable. Plans support flat work-item upserts, with pending/accepted states, but no explicit removal, skip, or reopen operation. Upstream offers confirmed goal revisions and a richer task lifecycle.

- [ ] Discuss and confirm changes to an existing goal's objective, acceptance conditions, and plan before applying them.
- [ ] Preserve still-applicable progress and evidence, with an interpretable history of what changed and why.
- [ ] Support withdrawing or skipping obsolete work items with reasons, and explicitly reopening work that needs reassessment.
- [ ] Define when a revision invalidates item acceptance or independent review, and how it interacts with active work, pause, and recovery.

**Boundaries:** Revising a goal must not silently authorize new execution, replenish allowance, reuse stale approval, or turn skipped work into accepted evidence. Changes to the currently immutable durable contract require an explicit schema/compatibility design, not an incidental extension of plan upserts. Removing an item must not erase its attempts or external effects.

### 2. Lightweight progress presentation

**Value:** Make the current goal understandable without reading raw status JSON.

Upstream provides compact and expanded dashboards with task progress, activity, usage, and review state. Current goal status/list commands primarily expose JSON; durable records already contain useful progress and allowance data.

- [ ] Show the objective, current work item or dispatch, accepted/remaining item counts, and remaining allowance in a compact view.
- [ ] Surface pause/blocker reasons and the latest independent-review outcome.
- [ ] Offer an on-demand bounded view of recent attempts and evidence, with honest elapsed-time and reported-usage indicators where available.

**Boundaries:** Start with a lightweight presentation, not a complex dashboard. A child finishing is not item acceptance; accepted-item counts are not proof that the goal is complete. Saved active state is not proof of a live process. Distinguish cumulative usage from context occupancy, dispatch allowance from model turns, and missing observations from zero usage. Reuse existing execution state rather than creating a second task manager.

### 3. Independent reviewer configuration

**Value:** Choose an appropriate independent assessment model without changing worker configuration.

Workers already accept explicit model and thinking selections. Review currently has no separate configuration entry, whereas upstream exposes reviewer provider/model/thinking settings.

- [ ] Allow explicit reviewer provider, model, and thinking-level selection.
- [ ] Expose the effective reviewer configuration and define validation, defaults, precedence, and capture timing.
- [ ] Retain the effective settings with the review attempt so its outcome remains interpretable.

**Boundaries:** Review remains mandatory, fresh, independent, current-state-bound, and charged to the shared goal allowance. Configuration must not add an audit-disable or completion-bypass path. Review instructions are not enforced read-only filesystem protection.

## Later candidates

These follow the revision, visibility, and reviewer improvements above.

### Multiple-goal selection and archival

- [ ] Provide a readable goal picker and explicit focus/unfocus or equivalent controls instead of requiring users to copy saved IDs.
- [ ] Offer confirmed archival and distinguish open, paused, completed, and archived records in listings.

**Boundaries:** Multiple saved goals and manual pause/resume switching already exist. Selection is not execution authorization; switching must not silently resume work, grant allowance, or leave an old goal scheduling. Archival must not silently delete history or cancel unrelated delegations. Keep goal bookkeeping under the global agent root.

### Recovery diagnostics and assisted repair

- [ ] Provide an actionable health report for damaged journals, uncertain ownership, missing evidence, and working-directory mismatches.
- [ ] Evaluate narrowly scoped, confirmed repair operations with backups and explicit descriptions of preserved or unavailable state.

**Boundaries:** Current storage already fails closed on corruption and can reclaim a demonstrably dead same-host owner during explicit resume. Diagnostics must preserve that behavior. Repair is not automatic execution recovery, blind task replay, project relocation, or permission to steal a live/uncertain lease. Keep unsupported damage visible rather than silently rewriting history.

### Installation, publishing, and configuration usability

- [ ] Prepare a supported install path that explains the delegate dependency and how both extensions are loaded.
- [ ] Evaluate inclusion in package/tag publishing, with built-package compatibility and co-loading verification.
- [ ] Add settings presentation only for concrete configuration needs, with explicit source, scope, precedence, and validation.

**Boundaries:** Goal remains a private local workspace package until publication is separately authorized and verified. Installing an npm dependency does not automatically load its Pi extension. Configuration must not introduce project-local goal bookkeeping, incompatible hidden defaults, or a duplicate delegate runtime.

## Further evaluation

- [ ] **Subtasks and ordered plans:** evaluate a bounded hierarchy or an explicit ordered mode when flat work items are insufficient. Upstream's Sisyphus ordering is primarily prompt discipline, not evidence of an enforced dependency engine. Define whether ordering is advisory or enforced before promising it; neither requires a general DAG scheduler.
- [ ] **Long-run context efficiency:** measure checkpoint/context size before adding bounded summaries, post-compaction resynchronization, or prompt-cache adaptations. Current state is already reinjected into coordinator context and workers start fresh; upstream's long-session optimizations are not automatically missing requirements here. Preserve access to full acceptance conditions and disclose omitted evidence.
- [ ] **Transient-provider recovery:** evaluate explicit, bounded delay/backoff after native retries only if a demonstrated need remains. Native immediate retries and compaction belong to the host. Any goal-driven retry must respect allowance, cancellation, ownership, and uncertain prior effects; do not copy an unlimited retry default.

## Not prioritized

Revisiting these requires an explicit scope and architecture decision, not an incidental addition to a candidate above.

- **Default-unlimited execution, silent allowance renewal, or starting without runtime-owned confirmation:** retain explicit finite authorization.
- **Disabling or bypassing independent completion review:** retain the current evidence and approval gates.
- **Project-local goal bookkeeping:** retain global goal-specific JSONL storage and working-directory binding.
- **Automatic cross-session resume or replay of interrupted attempts:** require deliberate resume and inspection of actual effects.
- **Complex dashboards, general workflow/DAG engines, recursive agent teams, or another executor/task manager:** keep coordination in goal and execution in delegate's supported public runtime.
- **Automatic delivery of ordinary background delegate results or idle-parent wake-up:** preserve delegate's query-only contract.
- **Plugin-managed worktrees/merges, rollback guarantees, auditor sandbox claims, or exact token/cost ceilings:** do not imply controls the runtime does not supply.

Start with **confirmed goal revisions and work-item lifecycle**, then **lightweight progress presentation** and **independent reviewer configuration**. These address the largest daily-use gaps without weakening the current execution and safety boundaries.
