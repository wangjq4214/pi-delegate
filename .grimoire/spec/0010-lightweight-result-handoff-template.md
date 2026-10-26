# Lightweight result handoff template

**Spec ID:** 0010
**Status:** Implemented
**Date:** 2026-10-12
**Sources:** Accepted refinement handoff H1–H3 below; [roadmap — Reviewable, traceable result handoff](../../packages/pi-delegate/docs/roadmap.md#2-reviewable-traceable-result-handoff); [ADR 0017](../adr/0017-advisory-result-handoff-template.md).

## Source and coordination boundary

- **H1 — Selected outcome:** After comparing roadmap candidates, the user requested the first recommendation, the lightweight result handoff template, with “Implement recommendation 1 and check whether anything needs discussion” (translated). This refers to the recommendation, not the roadmap's already delivered task-listing item. The goal is to make child results easier for the parent to review and take over.
- **H2 — Accepted recommendations:** The coordinator proposed an optional per-call `resultFormat: "handoff"`, unchanged free-text behavior when omitted, identical synchronous/background behavior, and no custom templates, global setting or JSON schema. The report covers completion/unfinished work, changes, existing artifacts, performed/omitted checks, blockers and parent decisions. It is a prompt convention: no parsing, structural enforcement, format-triggered failure/retry or second structured report. Explicit task output requirements prevail; the template grants no extra modification/commit/artifact permissions. Failure, cancellation and truncation preserve existing available output without fabricated reports. The user accepted these recommendations with “Write the spec as recommended” (translated).
- **H3 — Endpoint, permissions and knowledge boundary:** Produce one spec after recording qualifying durable choices. No ticket decomposition, implementation plan, production/test edits or QA execution. Consume settled requirements and established choices; organize, express, decompose or sequence them without inventing domain facts, requirements, constraints, architecture, acceptance semantics or unconfirmed assumptions. Trace material assertions to this handoff or verified sources. A needed new fact or decision returns to refinement before artifact work resumes; formatting is not permission to fill semantic gaps. Return at the spec-only endpoint.
- **K — Durable boundary:** [ADR 0017](../adr/0017-advisory-result-handoff-template.md), Testing, records advisory reporting, unchanged execution/acceptance ownership and existing result channels. It supersedes no existing decision. [ADR 0016](../adr/0016-unified-scope-local-task-discovery.md) retains results independently of presentation/message delivery. [ADR 0007](../adr/0007-external-worktree-lifecycle-and-parent-integration.md) retains parent-owned review/integration and external workspace lifecycle.
- **S — Inspected surfaces:** [delegate.ts](../../packages/pi-delegate/src/delegate.ts) declares delegation inputs, submits task/context through RPC and collects final child text; [background.ts](../../packages/pi-delegate/src/background.ts) passes execution options to the shared runner and retains/delivers available results; [output.ts](../../packages/pi-delegate/src/output.ts) supplies bounded previews and full-output files; [tasks.ts](../../packages/pi-delegate/src/tasks.ts) exposes result records to queries/presentation. [Usage](../../packages/pi-delegate/docs/usage.md) documents terminal outcomes and delivery/truncation semantics. The [worktree skill](../../packages/pi-delegate/skills/delegate-worktree/SKILL.md) already requests reviewable artifacts and honest check reports in its narrower parent workflow.

No blocking decision or ADR conflict remains in this scope. Exact heading wording, prompt phrasing and internal helper/module organization are implementation details, not additional reporting or enforcement contracts.

## Requirements

### R1 — Explicit per-delegation opt-in

- Add the optional public `delegate` parameter `resultFormat`, whose only supported explicit value in this increment is `"handoff"`.
- Omission preserves existing free-text prompting/result behavior; do not implicitly enable the template for coding, worktree or background tasks.
- Apply the same selection semantics to synchronous and background execution. A selected queued task must retain its selection through admission and startup.
- Invalid explicit values follow existing invalid-delegation-input rejection behavior rather than silently selecting handoff or free text. No other format is introduced by this increment.
- Keep existing task, context, cwd, model/thinking, pressure and execution-mode semantics intact. The option is a reporting request, not a different task type or execution mode.

**Trace:** H2; K/ADR 0017; S/delegate and background input/runner boundary.

### R2 — Include the reporting convention in the child task

- When selected, include the lightweight handoff instructions in the task submitted through the existing child prompt path, alongside the supplied task/context. Do not replace or discard their content.
- Do not modify the parent's instructions, copy its conversation, or use result selection to activate additional tools.
- The generic template is subordinate to explicit task-specific output requirements. For example, “return only JSON” remains authoritative even when handoff is selected; the generic template must not instruct the child to violate that requirement.
- Treat submission as a request, not evidence of model consumption or compliance. Neither inherited input handling nor model behavior becomes a new enforcement guarantee.

**Trace:** H2; K/ADR 0017; S/delegate task/context submission.

### R3 — Reviewable, honest report content

For a task that has no conflicting explicit output requirement, the instructions request a concise, readable report containing the following content. Stable grouping is useful; literal heading spelling or a machine-readable layout is not required.

| Report part | Requested content |
| --- | --- |
| Completion | Completed work and main conclusions; unfinished work or remaining scope stated separately. |
| Changes | Changed file paths with short descriptions; explicitly state no file changes when applicable. |
| Deliverables | Available commit references, patch paths or other artifact paths; explicitly state when none are available. |
| Verification | Checks actually performed, their commands and results; checks not performed and the reasons. |
| Blockers and decisions | Blockers and decisions needed from the parent; include options/recommendation when applicable, or state that none are needed. |

- Support modification, investigation/review and testing tasks without requiring a Git repository or file edits.
- Request factual reporting: unknown information is unknown, unperformed checks are unperformed, and unavailable artifacts are unavailable. Do not request invented paths, results or completion claims to fill a section.
- The template does not authorize extra file edits, commits, patch generation or other artifact creation. Any such action needs authorization from the task's actual scope, not from this reporting option.
- A report is a navigation aid to the child's work and evidence, not an integration artifact by itself or proof that the reported work/checks are correct.

**Trace:** H1–H2; roadmap template content; K/ADR 0017; S/worktree reporting precedent.

### R4 — Advisory format, unchanged outcome and acceptance boundaries

- Do not parse or structurally validate the child report, add a compliance-derived execution status, or classify an otherwise completed task as failed because sections are missing.
- Do not automatically retry, resume or run an additional model request to repair report format.
- Preserve `completed`, `incomplete`, `failed` and `cancelled`, existing stop-reason mapping and `isError` behavior. `completed` means the child produced a final answer, not requirements acceptance, template compliance or passing tests.
- Preserve current available output/diagnostics for failures, cancellations and generation limits. A final handoff can be absent or partial; do not synthesize one or extend output recovery guarantees beyond the existing runner.
- Keep artifact inspection, task acceptance, integration and necessary validation with the parent.

**Trace:** H2; K/ADR 0017; S/delegate outcome mapping and Usage terminal outcomes.

### R5 — Existing result channels and presentation

- Carry the child's reported text through the existing synchronous result, background completion message, retained task query and task-panel result view, with their established notices, envelopes and availability rules.
- Do not create a second parsed report object or a separate report-delivery protocol. This increment does not require new query, listing or panel metadata for report compliance.
- Preserve existing preview/truncation metadata, full-output path and full-output-file lifetime. Presentation truncation is not generation incompleteness or format failure.
- Preserve execution/completion-delivery separation, scope lifetime, cancellation/cleanup ownership and usage accounting. Reading or presenting a handoff must not launch additional work or duplicate accounting.

**Trace:** H2; K/ADRs 0017 and 0016; S/output, tasks, background and Usage.

### R6 — Discoverable usage and limitations

- Describe `resultFormat: "handoff"` in the public tool parameter information and package usage documentation, including a representative opt-in call and the unchanged omission behavior.
- Explain the requested report parts, precedence of explicit output requirements, lack of additional action permissions, advisory/nonvalidated behavior and the distinction between execution completion and acceptance.
- Documentation must not imply that the template guarantees honest reporting, passing checks, a commit/patch, or a complete report on cancellation/failure.

**Trace:** H1–H2; R1–R5; S/current public parameter and usage surfaces.

## Solution

Expose one optional reporting selection on the existing parent-only `delegate` tool and propagate it with the task's captured inputs to the shared runner. For opt-in tasks, submit the reporting convention through the existing task/context prompt boundary. Keep result collection, outcome classification, records and all downstream result presentation text-based and unchanged in ownership.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Public delegation input | Parent caller → accepted delegation | Optional `resultFormat: "handoff"`; existing task/context and execution inputs | Valid selection propagated for either execution mode; omission retains current behavior. |
| Child task submission | Shared runner → child prompt processing | Original task/context plus the selected advisory reporting instructions | A submitted reporting request with task-specific-output precedence; no compliance guarantee. |
| Child final output | Child → runner/result formatter | Available final text and existing execution/stop information, possibly absent/partial on failure | Existing outcome and available output, without format validation, repair or fabricated reports. |
| Result access | Retained result → initiating call, background delivery/query, task-panel view | Existing result text, metadata and scope ownership | Existing on-demand/delivery presentation, truncation and accounting; no second report representation. |

## End-to-End Tests

These are required future verification scenarios, not results already obtained. Controlled child/provider fixtures can prove submitted instructions and plugin behavior; they do not establish that arbitrary models follow the convention or report truthfully.

### E1 — Existing caller omits selection

- **Given:** A caller submits a valid task/context with no `resultFormat`.
- **When:** Synchronous or background delegation runs to its normal terminal outcome.
- **Then:** No handoff instructions are added; the existing prompt/result behavior and corresponding execution/delivery semantics remain unchanged.

### E2 — Opt-in synchronous handoff

- **Given:** A valid synchronous call selects `resultFormat: "handoff"`, and a controlled child returns a report covering completed/unfinished work, changed paths, available artifacts, performed/omitted checks and blockers/decisions.
- **When:** The child receives its task and produces a final answer.
- **Then:** The submitted task retains the original task/context and requests all R3 content and boundaries. The initiating call returns the child text through the existing result formatter, with the normal outcome and usage. The plugin does not create extra artifacts or a parsed report.

### E3 — Queued background selection and query recovery

- **Given:** An opted-in background task is accepted while capacity is occupied.
- **When:** It later starts, returns a final report, and the parent accesses its completion and retained result, including through the task-panel Result view.
- **Then:** The selection survives queueing and produces the same reporting instructions as synchronous execution. Existing completion/query/panel paths expose the available report, without requiring a new protocol or charging queries again. Clearing a completion message does not remove the queryable result.

### E4 — Analysis-only task and no deliverables

- **Given:** An opted-in task permits analysis only and a controlled child reports no changed files, no artifacts and a check that was not run for a stated reason.
- **When:** The task completes.
- **Then:** The submitted convention permits these honest no-change/unavailable disclosures and does not authorize edits, commits or artifact generation. The plugin preserves the returned text without filling in missing artifacts or claiming that the omitted check passed.

### E5 — Explicit output requirement takes precedence

- **Given:** A task selects handoff but explicitly requires only JSON output.
- **When:** It is submitted and a controlled child returns the requested JSON rather than template sections.
- **Then:** The submitted convention makes the explicit task output requirement authoritative. The JSON is returned normally, without wrapping it in fabricated report sections, failing format validation or asking for a repair turn.

### E6 — Child does not follow the template

- **Given:** An opted-in controlled child produces a normal final answer containing only free text or an incomplete set of report sections.
- **When:** The runner collects the result.
- **Then:** Normal stop-reason mapping determines the outcome; a normal final answer remains `completed`. No format parser, retry, repair request or acceptance claim is introduced.

### E7 — Failure, cancellation and generation limits

- **Given:** An opted-in task has a startup/execution failure, is cancelled, or ends because of the generation length limit.
- **When:** The existing result path handles the outcome and owned-resource cleanup.
- **Then:** Existing status, error/diagnostic and available-output rules are preserved. A missing or partial final report is not replaced with an invented complete handoff, and no implicit continuation occurs.

### E8 — Large report and truncation

- **Given:** An opted-in controlled child returns a normally completed report exceeding existing presentation limits.
- **When:** The result is formatted and accessed through existing result channels.
- **Then:** Existing preview, truncation metadata and full-output-file access remain available; the full file contains the child's text. Display truncation does not change the completed outcome or count as template noncompliance.

### E9 — Invalid explicit selection

- **Given:** A caller supplies a `resultFormat` value other than the supported `"handoff"`.
- **When:** The caller invokes delegation.
- **Then:** The public input is rejected under existing invalid-input behavior, without child startup or background acceptance and without silently falling back to another format.

## Decisions

- **Opt-in, one built-in convention:** Accepted H2 preserves existing callers and avoids a global reporting policy; the proposed public spelling `resultFormat: "handoff"` is the selected interface for this spec.
- **Prompt convention instead of schema/enforcement:** H2 and ADR 0017 distinguish a useful report from structural correctness or truthful evidence. Template noncompliance is not an execution failure.
- **Task-specific output and permissions prevail:** H2 prevents generic reporting instructions from overriding a task's actual deliverable or authorizing side effects.
- **Existing text/result channels:** H2 and ADRs 0017/0016 avoid a competing representation or delivery owner; the parent still evaluates acceptance and artifacts.

## Test Plan

- Verify the actual submitted task in controlled execution, both opted in and omitted, including synchronous/background parity and delayed admission. Do not treat the presence of a well-formatted fixture answer alone as proof that the instructions were submitted.
- Exercise public input validation, template/explicit-output precedence instructions, absent/partial reports and noncompliant final answers without enforcing compliance.
- Reuse applicable result-channel and lifecycle checks for query recovery, panel presentation, failure/cancellation, generation limits, truncation/full-output access and nonduplicated accounting.
- Check public usage/tool descriptions against R1–R6. Distinguish fixture/protocol verification from optional real-model observations; model compliance and truthfulness are not deterministic acceptance gates.

## Out of Scope

- JSON/result schemas, structural validators, compliance scores or acceptance automation.
- Custom templates, global enablement, task-type auto-selection or additional explicit format values.
- Automatic retry, extra reporting turns, implicit continuation or format repair.
- Plugin-created commits/patches/artifacts, Git/worktree management or automatic integration.
- A second structured report object, separate report tool or report-specific task-panel workflow.
- Expanded partial-output recovery, full execution transcripts/export, runtime observability, blocker pause/resume or execution budgets.

The selected endpoint at authoring time was this requirements contract only: creating it made no implementation, runtime verification or test-pass claim.

## Implementation evidence (2026-10-12)

Implemented and automatically verified. Evidence, including command results and the real-Pi opt-in tests, is recorded in [ADR 0017 — Implementation evidence](../adr/0017-advisory-result-handoff-template.md#implementation-evidence-2026-10-12) and `.grimoire/plans/0001-lightweight-result-handoff-template.md`; this section does not restate them.

- R1–R6 are implemented as specified: the `"handoff"`-only optional parameter, unchanged omission, queued-background selection retention, advisory prompt content with explicit-output precedence, no parsing/validation/repair, existing text result channels and updated public documentation.
- E1–E9 are covered by controlled RPC tests, real Pi/provider opt-in tests, panel rendering checks and existing result/lifecycle regression coverage.
- User acceptance of the delivered behavior is still pending. `Implemented` records code and automated verification, not model compliance/truthfulness and not requirements acceptance.
