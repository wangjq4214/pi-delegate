# Roadmap

[Back to README](../README.md) · [Development](development.md)

Only unimplemented capabilities belong here. Priorities, scope, and defaults below are proposals, not implementation authorization or release commitments. Current behavior is documented in the [README](../README.md).

Removing implemented items does not close their outstanding live-terminal checks: see [tools](development.md#tool-presentation-verification), [User/Skill layout](development.md#compact-message-layout-verification), [thinking and refresh](development.md#thinking-titles-and-shared-refresh-verification), and [cursor/IME](development.md#cursor-output-verification).

## Implementation boundaries

- Preserve existing preferences and unknown configuration fields; no startup/reload rewrite or automatic preset application. User/Skill and Tool settings remain independent.
- Keep this package independent of pi-delegate. Presentation must not change execution, permissions, transcripts, or model-facing content.
- Prefer public host APIs. The existing reversible User/Skill adapter is a limited compatibility exception, not permission to add arbitrary private patches; see [ADR 0020](../../../.grimoire/adr/0020-instance-local-user-message-layout-adaptation.md) and [ADR 0023](../../../.grimoire/adr/0023-independent-user-and-tool-presentation-configuration.md).
- New panels need keyboard access, English/Chinese labels, narrow-width handling, theme/icon support, and safe cleanup. Custom terminal UI must be guarded by TUI mode, not merely `hasUI`.

## P1 — Highest-value next work

### 1. Extension status folding and filtering

- [ ] Bound extension-status rows; allow visibility, ordering, and pinning by exact status key.
- [ ] Show an overflow count and offer an on-demand, scrollable view of complete current statuses, including keys and entries hidden by preferences.

**Why next:** `renderExtensionStatusLines` in `src/footer.ts` currently sorts keys alphabetically and wraps every non-empty status. One verbose extension can therefore consume many rows; only a global visibility switch exists.

**Implementation sequence:**
1. Add validated status-display preferences in `src/config.ts` and controls in `src/settings-command.ts`. Preserve the current unlimited behavior for existing configurations; choose any bounded new-install default explicitly.
2. Add a pure selection/layout policy before rendering: hidden keys are excluded from the compact view, pinned visible keys come first, explicit order follows, and remaining keys use a deterministic fallback. Reserve room for overflow; pinning gives priority, not permission to exceed the row budget.
3. Expose the current footer status source to an on-demand viewer through `src/footer.ts` and `src/index.ts`. Read host status data, not transcript text; do not introduce a second task-state store or polling timer.

**Acceptance:** the compact view stays within its budget even when pinned entries overflow; omitted/partially shown entries remain recoverable. Preserve supported extension colors and control-sequence sanitization. Test empty/removed/late keys, long Chinese/emoji text, very narrow widths, and both inline and standalone footers in `tests/footer.test.ts` plus panel integration tests. Never infer task severity or completion from arbitrary status text.

### 2. Page-local settings reset and capability diagnostics

- [ ] Reset the current settings page with a confirmation or cancellable preview.
- [ ] Add an on-demand diagnostic view for configuration location/save state, requested/resolved icon mode, TUI mode, and observed presentation capabilities/fallbacks.

**Why next:** configuration validation and safe replacement already exist, as does clearing an individual border symbol/color. The missing work is page-level recovery and a consolidated explanation of why a feature is unavailable.

**Implementation sequence:**
1. Define explicit page-to-field ownership in `src/settings-command.ts`; reset only owned known fields against the documented current defaults in `src/config.ts`. Preserve unknown fields, unrelated pages, and the other message category; do not confuse an explicit reset with legacy-load normalization.
2. Reuse the existing save/apply path in `src/index.ts`, including session-only warnings after save failure and deferred editor replacement until the settings overlay closes.
3. Collect read-only diagnostic facts from `src/icons.ts`, `src/host-adapters.ts`, `src/tool-presentation.ts`, and their existing capability checks. Report unavailable observations as unknown; do not claim to detect installed fonts, actual IME correctness, or terminal flicker.

**Acceptance:** cancellation changes nothing; reset survives reload when saved and leaves the old file intact on write failure. Extend `tests/config.test.ts` and `tests/settings-command.test.ts` for independent User/Tool reset, unknown fields, legacy files, and failed writes. Diagnostics must not dump credentials or arbitrary environment variables; any future copy/export action must redact local paths by default.

## P2 — Build on existing measurements and settings

### 3. Layout presets and temporary focus mode

- [ ] Offer Minimal, Standard, Diagnostic, and Presentation setting bundles with a visible change preview.
- [ ] Add a temporary focus toggle that never saves its overrides and restores the underlying preferences on exit.

**Scope proposal:** Minimal reduces decorative/status density; Standard uses the documented normal baseline; Diagnostic exposes useful footer/telemetry fields; Presentation hides this extension's CWD, hostname, session name, thinking titles, and extension statuses. Presentation is not a privacy/redaction guarantee: Git labels, native header/transcript, tool arguments, and other extensions can still reveal sensitive information.

**Implementation sequence:**
1. Build explicit field patches on top of current configuration, not whole-file replacement. Reuse P1 reset/preview behavior; do not change language, icon/font preference, or unrelated User/Tool styling implicitly.
2. Separate base preferences from effective session configuration in `src/index.ts`. Apply a temporary focus override at read time rather than saving then restoring a stale snapshot. Proposed edit behavior: explicit settings edits update the base; exiting focus reveals those edits.
3. Clear temporary mode on disable, reload, and session replacement. Reuse existing editor/footer/presentation update hooks and shared refresh ownership; applying a named persistent preset remains an explicit save action.

**Acceptance:** repeated toggles do not drift or write the file; reset/preset/edit interactions do not resurrect old values. Test save failures, disable/re-enable, overlay focus restoration, and both Workline placements. Final preset field lists and focus lifecycle must be agreed before implementation.

### 4. Recent-run telemetry viewer

- [ ] Show recent settled outcomes, elapsed run duration, TTFT, TPS, and output tokens in an on-demand current-session view.
- [ ] Keep bounded in-memory records only; proposed initial cap: 20 runs.

**Why feasible:** `src/index.ts` already combines `RunOutcomeTracker` and `TurnTelemetryTracker` at `agent_settled`, but retains only the latest Workline result. The trackers should remain measurement owners; a small history store owns retention, and the viewer owns formatting.

**Implementation sequence:**
1. Append one scalar record per settled run, after outcome and telemetry calculation, never at each `agent_end`. Record outcome/duration even when telemetry is unavailable. Keep the current TPS/TTFT definitions; add availability metadata where numeric normalization currently loses the distinction between missing usage and measured zero.
2. Evict oldest records at the cap. Clear on session replacement/reload and successful tree navigation, matching current result boundaries rather than mixing branches. Proposed collection policy: only while Open TUI and telemetry are enabled; no reconstruction of earlier history.
3. Add a keyboard-accessible viewer via the settings command surface. Do not retain prompts, tool content, reasoning, assistant messages, or a cross-session database; do not create transcript entries.

**Acceptance:** retries/compaction/continuations produce one record, duplicate settlement cannot append twice, and missing telemetry displays as unavailable rather than fabricated zero. Extend `tests/telemetry.test.ts` and `tests/run-outcome.integration.test.ts` for aborted/no-output runs, eviction, session/tree reset, and disablement. Opening the viewer must not change Workline notification behavior.

## P3 — Additional feasible customization

### 5. Footer information priorities

- [ ] Let users choose which top-row information survives first when horizontal space runs out.

**Why useful:** `renderFooterContent` in `src/footer.ts` hardcodes CWD/hostname/session/Git/runtime/context priorities. Visibility switches cannot express “keep the branch, drop runtime first”.

**Small first version:** configure shrink/drop priorities for existing segments only; preserve current order, row placement, inline left/right groups, and bottom-row model/statistics behavior. Avoid a general layout DSL or drag-and-drop editor.

**Implementation:** validate priorities in `src/config.ts`, expose them in Footer settings, and feed the existing fitting helpers. Omitted preferences retain today's layout; P1 page reset restores its priorities too. This item can ship independently of telemetry.

**Acceptance:** deterministic tie-breaking; compact before dropping; no over-width rows or lost border corners at tiny widths. Extend `tests/footer.test.ts` and editor/inline integration coverage. Presets should not silently alter these priorities until their mappings are explicitly defined.

## Host-dependent exploration — not ready for implementation

### 6. Long user-message folding and attachment summaries

- [ ] Investigate reversible per-message folding with an explicit hidden-content indicator.
- [ ] Investigate compact attachment summaries that retain attachment discovery and native image access.
- [ ] Consider queued/steering/follow-up badges only where reliable host metadata exists; review copy/edit/resend actions and shortcut ownership separately.

Basic User/Skill colors, spacing, rails, frames, and independent settings are not remaining work. The missing capability is per-message expansion/interaction state, not another theme or display-Markdown transformation.

**Gate:** identify a supported host seam for ordinary User messages, stable message identity, expansion state, and keyboard/mouse routing. The current layout-only adapter does not establish that contract. Prefer an upstream public extension point over enlarging the private adapter; do not rewrite user messages into custom entries.

**Acceptance before promotion:** prototype history/resume, streamed/new messages, images, narrow resize, and regular/fullscreen interaction with unchanged stored/model-facing content. All hidden content must remain recoverable. No implementation estimate or delivery commitment until the host contract is settled.

## Suggested delivery order and verification

1. Ship status folding/viewer first; reset/diagnostics can proceed independently.
2. Follow with presets/focus after reset/preview semantics are defined. Recent-run history can proceed independently against the existing settlement lifecycle.
3. Add footer priorities if demand remains after presets; keep user-message folding behind host/API discovery.

For each implementation, extend the named unit/integration tests and run the package `typecheck` and `test` scripts. UI changes additionally require the [live-terminal checks](development.md#interactive-verification): regular/fullscreen, narrow resize, theme/icon changes, scrolling, keyboard/IME focus, disable/re-enable, and reload. Automated frames do not establish visual acceptance.

This revision is based on source and test inspection, not new live-terminal acceptance. It removes implemented entries and narrows User-message work to the missing interactions; it does not change production code or mark pending verification complete.
