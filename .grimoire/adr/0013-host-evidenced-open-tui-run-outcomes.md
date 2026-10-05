# Use host-evidenced outcomes at full Open TUI run settlement

**Status:** Completed
**Date:** 2026-10-05

## Context

The user requested the Trustworthy run outcomes capability in `packages/pi-open-tui/docs/roadmap.md`. The existing `src/index.ts` stops the Workline timer at each `agent_end`, and `src/workline.ts` presents any saved duration as successful `done`. This can misrepresent interruption, failure, or a loop that will automatically retry or continue.

The pinned Pi 1.0.0 public extension API distinguishes low-level `agent_end` from full-run `agent_settled`. `AgentSettledEvent` carries no outcome. Boundary events expose an outcome, but `agent_before_settle` can precede another continuation and can be skipped on cancellation. The inspected host also maps assistant stop reasons other than `aborted` and `error` to a completed activity outcome, so that outcome alone does not resolve truncation. Some cancellation or truncation cases cannot be reliably classified through this public API.

Sources: `packages/pi-open-tui/src/index.ts`, `src/workline.ts`, and `src/state.ts`; the installed pinned host's `dist/core/extensions/types.d.ts` (`AgentEndEvent`, `AgentBeforeSettleEvent`, `AgentSettledEvent`, and `TurnEndEvent`) and `dist/core/agent-session.js` (`_dispatchTurnEndBoundary`, `_runAgentPrompt`, and `_runBeforeSettleBoundary`). Installed-host paths are relative to `packages/pi-open-tui/node_modules/@earendil-works/pi-coding-agent/`. The user explicitly accepted the refinement recommendations and their conservative API limitation on 2026-10-05.

## Decision

- Publish a final Workline result at `agent_settled`, not at each low-level `agent_end`. Treat `agent_before_settle.outcome` as provisional rather than an irrevocable final result.
- Use reliable public host lifecycle evidence to distinguish completed, interrupted, and failed runs. If the evidence cannot reliably determine the result, use a neutral ended result rather than implying success or guessing interruption/failure.
- A failed tool call does not independently establish failure of the agent run. Do not classify outcomes by interpreting message text or merely observing that activity stopped.
- Completion describes the host run ending normally, not proof that the user's task or desired real-world result was achieved.
- Keep one elapsed-time interval through the full run, including automatic retries, compaction, and continuations, until `agent_settled`. Native retry/compaction indicators retain their semantics and presentation priority.
- Scope outcome evidence and retained results to the current run and session; reset them at new-run and session boundaries so prior evidence cannot determine a later result.

## Consequences

- Workline can report terminal outcomes without treating every stopped loop as successful or exposing premature success during recovery.
- Conservatively neutral results are intentional where the supported public host API lacks decisive evidence; the extension does not promise complete cancellation/truncation diagnosis.
- This remains an Open TUI presentation change, not a change to Pi execution, retries, compaction, or a dependency on pi-delegate. The existing independent-package boundary in [ADR 0011](./0011-import-upstream-open-tui-extension.md) remains unchanged.
- The user also requires a distinct leading icon for each outcome, in addition to distinct text and color. The agreed display contract and layout/telemetry preservation requirements remain in the refinement handoff; exact glyphs and internal state representation are implementation details, not new architectural commitments.
- Implementation and executable verification have not started. This record does not mark the roadmap item complete.

## Implementation evidence (2026-10-05)

The pending-work statement above describes the record before implementation. The decision is now realized in `packages/pi-open-tui/src/run-outcome.ts`, `src/index.ts`, `src/state.ts`, `src/workline.ts`, and `src/icons.ts`; `src/telemetry.ts` resets measurement state at session boundaries without changing its measurement definitions.

- The UI suite passed **152/152**, including **10 actual pinned Pi 1.0.0 lifecycle tests** with a deterministic in-process provider/tool, plus outcome/timing/reset and icon/layout/width regressions. Real tool-phase interruption uses the captured public operation signal; retry-wait cancellation and unresolved length are neutral.
- Root workspace typecheck, UI build, root Biome check, whitespace check and **6/6** repository integration tests passed. Independent review/check found zero blockers; its advisory telemetry-reset regression was added and passed before final integrated verification.
- Pi 1.0.0's absence of an authoritative settlement outcome remains intentional scope. The real-host test confirms that normal completion and cancellation during post-loop before-settle can expose identical evidence: inferred completed/failed status cannot diagnose that invisible late cancellation. Bilingual READMEs and development guidance explicitly state this limit; no claim of exhaustive cancellation/truncation detection or task success is made.
- Automated evidence does not establish live terminal/font/IME or external-provider compatibility. Actual-host compaction-provider recovery and the unrelated full delegate runtime suite were not run; native compaction semantics are unchanged and timing/priority are covered by source inspection and deterministic regression tests.

Execution details: `.grimoire/plans/0017-trustworthy-run-outcomes.md`. The roadmap capability is marked complete with the host observability limit retained.
