# Readable goal list and status

**Ticket ID:** T0001
**Source:** [Spec 0020](../../spec/0020-goal-progress-and-readable-list.md), R1, R3, command portions of R6 and E3–E4/E7–E8; [set relationships](./README.md).
**Status:** Done

## Goal

Users can list saved goals and inspect current/saved goal progress without raw JSON as the primary human output, without changing execution authority or existing structured model-facing results.

## Affected Surfaces

- [Goal command entry](../../../packages/pi-goal/src/index.ts): `/goal`, `/goal status`, `/goal list`, `/goal status <goal-id>` human output.
- Presentation over existing [model](../../../packages/pi-goal/src/model.ts), [controller](../../../packages/pi-goal/src/controller.ts), draft and [store](../../../packages/pi-goal/src/store.ts) observations; retain their existing ownership/schema.
- Goal command/adapter and presentation tests; [README](../../../packages/pi-goal/README.md) and [usage](../../../packages/pi-goal/docs/usage.md).

## Approach

Format existing current/draft and saved observations for humans, keeping structured tool payloads separate. Reuse the store's valid-goals/per-record-errors split and preserve visible overall failures. Keep exact goal IDs usable for existing saved lookup. Do not couple command delivery to a new live task-observation capability or build a picker as a shortcut to readable output.

This direction does not freeze formatting-helper names, layout or incidental file extraction. Apply Spec 0020's artifact/knowledge boundary; return any needed new semantics to refinement rather than filling them in.

## Dependencies and Coordination

- **Blocked by:** None; existing goal/store state is sufficient for this outcome.
- **Blocks:** None. T0002 may share formatting but does not require a new command API.
- **Coordination risks:** Shared goal entry/tests/docs with T0002. Prefer T0001 first, or separate command-handler ownership from live-view hooks. Keep acceptance counts, dispatch allowance and saved/live labels consistent across both.

## Acceptance

- [ ] `/goal list` provides objective summaries, copyable exact goal IDs, saved status, accepted/total counts and saved cwd; it does not dump evidence, attempt reports or journal bodies. **R3.1.**
- [ ] `/goal` and `/goal status` readably expose current goal/draft state or a clear empty result. `/goal status <id>` includes objective/conditions, item progress, known run allowance, stop/recovery information and review outcome without implying that saved data is live. **R1.3–R1.5, R3.2–R3.3.**
- [ ] Worker completion does not inflate accepted counts; accepted/total items alone do not imply goal completion. Missing review, run data or live observations have honest empty/unknown labels. Allowance is described as dispatch capacity, not tokens, turns, cost or elapsed time. **R1.1–R1.5.**
- [ ] Empty stores, corrupt individual records, overall store-access errors and invalid/missing lookup IDs are visibly distinguished. Valid goals remain visible alongside damaged-record errors. **R3.4.**
- [ ] Repeated list/status calls do not launch work, focus/select a goal, acquire execution ownership, repair/write journals, renew allowance or resume a saved goal. Existing structured goal tools retain usable fields and semantics, including without a widget. **R3.5; command portion of E7.**
- [ ] Normal/narrow widths, Chinese/Unicode objectives and paths, long exact IDs and control-containing text are rendered safely and readably; lookup identity is not made ambiguous by clipping. TUI styling follows the active theme without a pi-open-tui dependency. **R6.1–R6.2, E8.**
- [ ] Goal human-command guidance matches implemented output and explains saved versus live, executed versus accepted, dispatch allowance and visible record errors. Do not advertise unimplemented live UI or other roadmap items. **Command portion of R6.3.**
- [ ] Verification exercises Spec E3/E4 plus current draft/empty cases, non-mutating inspection, structured compatibility and command rendering portions of E7/E8. Record actual checks and distinguish renderer/adapter/RPC evidence from manual terminal/IME acceptance; use isolated temporary agent roots. **Spec verification guidance.**

## Out of Scope

Live widget and delegate row suppression (T0002); picker, focus switching, archival, objective revisions, repair, schema changes, new execution authorization, publication and general dashboard features. Ticket creation itself does not authorize implementation or QA.
