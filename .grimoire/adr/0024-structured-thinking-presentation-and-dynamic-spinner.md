# Structured thinking presentation and dynamic spinner

**Status:** Completed
**Date:** 2026-10-14
**Partially superseded by:** [ADR 0025](./0025-shared-open-tui-ui-refresh-ownership.md) (2026-10-16), for the independently owned 80ms thinking ticker. The stream-independent animation requirement and native label integration boundary remain in force.
**Provenance:** Preserved from [PR #2 at 413a7b0](https://github.com/wangjq4214/pi-delegate/blob/413a7b065dc26fd63cdfc363fd7fecfa2ca1fe30/.grimoire/adr/0024-structured-thinking-presentation-and-dynamic-spinner.md). Its original Completed status and implementation descriptions concern that PR branch, not proof that its implementation exists on the current local branch. Supersession metadata and this provenance/revision note were added during refinement.
**Presentation revision:** The accepted 2026-10-16 title-tree refinement in [Spec 0014](../spec/0014-structured-thinking-block-presentation.md) replaces the historical preview-row, guide-word title detection, configuration and completion-presentation requirements below. These historical examples are not the current acceptance contract. No title-tree implementation or QA is claimed by this note.

## Context

Pi coding agent exposes a collapsed thinking component (`HiddenThinkingComponent`) with a native label target. Upstream `pi-open-tui` introduced a baseline `thinkingPeek` mechanism to preview raw trailing thought text inside this label.

However, several usability and visual issues were identified in practice:
1. **Delta-dependent animation:** The spinner glyph and elapsed timer only progressed when an assistant stream delta arrived. When models entered prolonged deep reasoning or paused between chunk transmissions, the spinner froze completely, creating the misleading impression that the agent or connection had hung.
2. **Markdown formatting noise:** Raw thinking streams frequently contain markdown syntax (headings like `#`, code fences ```` ``` ````, inline backticks, blockquotes `>`, and bullet lists `-`, `*`, `1.`), which cluttered narrow single- and double-line previews and wasted terminal width.
3. **Absence of structured phase context:** Complex thinking processes progress through phases (such as planning, analysis, verification), but users only saw disconnected trailing text fragments without higher-level milestone context.
4. **Transient settlement clearing:** Upon task settlement (`agent_settled`), a legacy 300ms timer completely cleared the label back to native text, discarding duration telemetry and leaving the collapsed block without historical reasoning summary.

## Decision

- **Autonomous interval ticker (Dynamic Spinner):** Decouple spinner animation and elapsed duration updates from incoming stream chunks. Introduce an internal ticker (`DEFAULT_TICKER_INTERVAL_MS = 80ms`) active during the `thinking` phase that advances the spinner frame and updates duration continuously. Stop the ticker immediately upon transition to `done` or `idle`.
- **Heuristic milestone and phase extraction:** Parse cumulative thinking text during streaming to detect headings (`#{1,6}`), step/phase markers (`Step`, `Phase`, `\u6b65\u9aa4`, `\u9636\u6bb5`), and reasoning guide words (`Planning`, `Analyzing`, `Checking`, `Reviewing`, `Evaluating`, `Refining`, `Summary`, `\u89c4\u5212`, `\u5206\u6790`, `\u68c0\u67e5`, `\u5ba1\u67e5`, `\u8bc4\u4f30`, `\u6784\u601d`, `\u603b\u7ed3`). Chinese entries are shown as Unicode escapes. Extract the latest active milestone (up to 40 characters) and display it as a badge.
- **Markdown preview sanitization:** Provide `sanitizeThinkingPreview` to strip markdown formatting tokens and collapse embedded whitespace before terminal width clipping and wrapping.
- **Structured two-line and single-line layout:**
  - In 2-line mode (`lines: 2`): Row 1 displays prefix, dynamic spinner, elapsed duration, and milestone badge (e.g. `⠋ think 14.2s [Analyze code]`); Row 2 displays the sanitized thought tail.
  - In 1-line mode (`lines: 1`): An inline arrangement of prefix, spinner, elapsed duration, milestone badge, and clipped tail.
- **Persistent completion summary:** When thinking ends (answer text arrives, `messageEnd`, or settlement fallback), freeze elapsed duration and render a permanent summary label (e.g. `✔ (14.2s · Analyze code)`) on the collapsed thinking component. Preserve this label through settlement, clearing it only when the next message or task starts, or on session reset.
- **Strict host non-invasiveness and configuration preservation:** Confine all presentation updates to Pi's existing `ThinkingLabelTarget.setHiddenThinkingLabel` API bridge without wrapping or monkey-patching Assistant message components or transcript rails. Maintain existing `thinkingPeek.lines: 0 | 1 | 2` configuration schema without breaking changes.

## Consequences

- Continuous, lively visual feedback reassures the user that reasoning is proceeding even during stream stalls.
- Reasoning milestones and clean preview text provide immediate semantic insight into the model's progress.
- Collapsed thinking blocks retain durable duration and phase provenance after completion.
- No changes to saved configuration schemas or public tool boundaries are required.
- Detailed requirements and acceptance criteria are recorded in [Spec 0014](../spec/0014-structured-thinking-block-presentation.md).
