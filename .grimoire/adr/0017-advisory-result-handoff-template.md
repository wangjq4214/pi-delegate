# Advisory result handoff without result validation or acceptance ownership

**Status:** Testing
**Date:** 2026-10-12

## Context

The [roadmap](../../packages/pi-delegate/docs/roadmap.md#2-reviewable-traceable-result-handoff) recommends an optional lightweight result template before result schemas. Task discovery already makes work inspectable; the next selected increment helps the parent find completed/unfinished work, changes, artifacts, check evidence and decisions in child reports.

In refinement, the user selected the lightweight handoff candidate and then confirmed the recommendations with “Write the spec as recommended” (translated): opt-in per delegation, unchanged default free-text behavior, a prompt-level reporting convention rather than mandatory result validation, and the existing execution/output channels. The selected endpoint is a requirements specification, not implementation or QA.

Sources:

- The accepted refinement conversation summarized above.
- [delegate.ts](../../packages/pi-delegate/src/delegate.ts): explicit task/context prompt submission and final child text collection, with outcome derived from execution/stop reason rather than report content.
- [Usage — terminal outcomes](../../packages/pi-delegate/docs/usage.md#terminal-outcomes): `completed` means a final answer, not successful acceptance.
- [ADR 0016](./0016-unified-scope-local-task-discovery.md): task records expose available results without becoming execution owners or validators; execution and completion delivery remain distinct.
- [ADR 0007](./0007-external-worktree-lifecycle-and-parent-integration.md) and the [bundled worktree skill](../../packages/pi-delegate/skills/delegate-worktree/SKILL.md): review and integration belong to the parent; reports point to actual artifacts and are not verification.

## Decision

- Offer the handoff as an optional per-delegation prompt convention. Existing calls that omit it retain free-text behavior. Do not introduce a global reporting policy in this increment.
- Request an honest, reviewable report from the child, but do not parse or enforce the report structure, automatically retry for missing sections, or create a second structured report representation.
- Preserve explicit task-specific output requirements when they conflict with the generic template. The template does not expand task permissions or authorize additional file edits, commits or artifact creation.
- Keep execution completion distinct from acceptance. Template compliance or noncompliance does not determine execution outcome. The parent remains responsible for examining artifacts, evaluating evidence, integration and necessary validation.
- Deliver the child's available text through existing synchronous returns, background completion/query and task-panel result presentation, preserving current diagnostics and truncation. Do not synthesize a complete handoff when failure, cancellation or generation limits leave none.

The public option and report content belong in the requirements contract, not in this architecture record. This is additive and supersedes no existing lifecycle, ownership or worktree decision.

## Consequences

- Ordinary delegation can request the same reviewable reporting discipline already used by the worktree workflow, without requiring Git or a separate result protocol.
- The plugin can guarantee that the reporting request is included in the submitted task, not that a model consumes it, follows it or reports true facts.
- Format compliance and child-reported checks are not evidence of requirements acceptance. Result schemas and automated validation remain outside the selected increment.
- Failure/cancellation output can lack a final report, and a completed task can lack template sections; both remain inspectable according to existing result availability and execution semantics.

## Requirements contract

[Spec 0010 — Lightweight result handoff template](../spec/0010-lightweight-result-handoff-template.md) expresses the accepted public option, reporting content, result-channel boundaries and future acceptance scenarios. At authoring time this record was Proposed: no implementation or runtime verification had started.

## Implementation evidence (2026-10-12)

- Implemented as the optional `delegate.resultFormat: "handoff"` parameter: `packages/pi-delegate/src/result-format.ts` holds the type, the `"handoff"`-only literal schema, the strict validator and the advisory prompt construction; `packages/pi-delegate/src/delegate.ts` carries the option through public argument preparation, prepared-input rejection and shared-runner submission. Omission reproduces the original task/context prompt exactly.
- The convention stays prompt text: no parser, structural validation, format-derived status, repair turn or second report representation. Outcome mapping, result storage, truncation metadata, full-output files and task-panel presentation are unchanged.
- Verification: `bun run test` — repository 6 passed; pi-delegate 542 passed with 1 POSIX-only permissions test skipped on Windows; pi-open-tui 220 passed. `bun run build`, workspace `bun run typecheck`, `bun run check` and `git diff --check` passed. Real Pi public opt-in tests through the built extension covered omitted and selected prompting.
- **Pending:** user acceptance of the delivered behavior. `Testing` records automated verification only; it does not establish model compliance/truthfulness or requirements acceptance.

Plan: `.grimoire/plans/0001-lightweight-result-handoff-template.md`.
