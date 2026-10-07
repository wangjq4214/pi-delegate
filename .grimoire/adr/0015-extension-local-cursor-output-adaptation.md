# Adapt cursor output within the Open TUI extension runtime

**Status:** Testing
**Date:** 2026-10-07

## Context

The user wants `packages/pi-open-tui/` to avoid a cursor briefly appearing on the Workline and refresh-induced editor cursor flicker across block, bar, and underline styles, without modifying Pi host source or installed files. Retaining the real bar appearance, IME positioning, overlay focus, style switching, and cleanup behavior matters.

Read-only inspection of the workspace Pi TUI 1.0.0 and installed Pi TUI 1.0.4 found that regular-mode rendering ends synchronized output before final hardware-cursor positioning. Fullscreen rendering performs cursor positioning and visibility handling before ending synchronized output. These ordering differences establish a candidate fix, not proof of the cause or visual behavior in the user's terminal. Current extension source uses hardware cursors for both bar and underline; the software-underline completion claim in `CURSOR-FLICKER-RESEARCH.md` does not describe the inspected checkout.

The editor factory exposes the active TUI and terminal instances. Automatic rendering calls the protected `doRender()` method directly, so wrapping public `requestRender()` or `renderNow()` alone does not cover those frames. Cursor visibility methods write directly to stdout rather than through `terminal.write()`.

Sources: `packages/pi-open-tui/src/editor.ts`, `packages/pi-open-tui/tests/editor.test.ts`, and both inspected pi-tui installations' `dist/tui.js`, `dist/tui-main-screen.js`, `dist/tui-alt-screen.js`, `dist/terminal.js`, and declarations. Workspace host files are under `packages/pi-open-tui/node_modules/@earendil-works/pi-tui/`; the installed host is under `C:/Users/Derek Wang/.bun/install/global/node_modules/@earendil-works/pi-tui/`. The user explicitly approved the extension-local runtime adaptation boundary on 2026-10-07 after its non-public API and verification limitations were explained.

## Decision

- Permit Open TUI to wrap the active TUI instance's internal rendering method and associated terminal output/visibility methods at runtime. Do not modify host source, installed files, or global prototypes. Restore the extension's adaptations when it is disabled, unloaded, or its owning lifecycle ends.
- Keep this an instance-scoped compatibility adapter, not a replacement terminal renderer or a global stdout interceptor. This preserves the independent host-extension boundary in [ADR 0011](./0011-import-upstream-open-tui-extension.md).
- Use the discussed regular-mode candidate: synchronously withhold the premature synchronized-output end sequence until the original render has completed final cursor positioning and visibility handling. Preserve output order and bounded streaming rather than concatenate the whole frame or defer completion to a microtask. Fullscreen already has the observed final-position-before-commit ordering.
- Address redundant visibility commands separately through visibility-state tracking. Positioning must still occur when required; suppressing a repeated show instruction must not suppress cursor movement caused by text rendering. Lifecycle changes that invalidate knowledge of terminal state need explicit handling.
- Retain host cursor-marker positioning for IME and preserve real bar/underline appearance as the candidate direction. Do not replace the bar with a cell-consuming character merely to avoid the runtime adapter. Software block display and overlay cursor ownership still need correct visibility handling.

## Consequences

- The user accepts runtime adaptation of host behavior, not a claim that the solution uses only stable public extension APIs. `doRender()` is protected and accessible in the inspected JavaScript, but this seam may change in future host versions.
- Implementation needs compatibility checks and reliable restoration, including exceptional rendering, cursor-only frames, reload, style changes, screen/terminal lifecycle transitions, and interactions with other extensions.
- Correct output ordering and visibility deduplication are separate obligations; neither alone establishes that Workline cursor leakage and editor flicker are both resolved.
- Actual terminal and intermediary synchronized-output support affects results. ANSI-stream evidence cannot establish visual correctness or real Chinese IME candidate-window behavior; these require separate interactive verification.
- This record was created before implementation. It approves the architectural boundary and candidate approach, not a completed visual fix or universal terminal compatibility guarantee; implementation evidence is recorded below.

## Implementation evidence (2026-10-07)

- Implemented in `packages/pi-open-tui/src/cursor-output.ts` and `src/editor.ts`; the adapter resolves the stable host reference, restores owned instance patches, rebinds at terminal start and public editor invalidation, streams bounded ESC-form control handling, commits regular frames after final cursor handling, and deduplicates visibility without dropping movement. Block retains its software appearance with a hidden real editor cursor; bar and underline retain real shapes.
- Added `tests/cursor-output.test.ts` and `tests/cursor-output.integration.test.ts` to the package runner. Updated three existing lifecycle/telemetry fixtures to provide the required terminal seam without changing their assertions. Aligned bilingual READMEs and development notes describe the compatibility boundary and pending manual checks.
- Current-tree automated results: Open TUI **220/220** tests; included cursor-output tests **39/39** against pinned Pi TUI 1.0.0; separate installed Pi TUI 1.0.4 integration **25/25**; full workspace typecheck; Open TUI build; root Biome check; root repository integration **6/6**; tracked whitespace check. Package metadata formatting required no changes; source/test automatic formatting remains disabled by the existing imported-source convention.
- Independent review/check found a first-frame transcript-exit ordering defect, fixed through editor invalidation before the start-less first render. Follow-up review verified that fix and partial-write sync-end recovery, found no new scoped blockers, and independently passed **39/39**, installed-host **25/25**, package typecheck and whitespace checks. Recovery cannot be guaranteed if the terminal refuses further writes.
- Built artifact: `packages/pi-open-tui/dist/index.js`, SHA-256 `ce3059da86dd81b177162e61cb50275b82a5b06a0efb971521d2d1ad37a80a48`. No host source/install files, dependencies, global prototypes/stdout or user configuration were modified; the pre-existing research file was left unchanged.
- **Pending required evidence:** actual terminal Workline/editor visual behavior, Chinese IME candidate positioning, interactive overlays/style changes, reload/disable/exit restoration, and fullscreen transcript exit. See `packages/pi-open-tui/docs/development.md#cursor-output-verification`. `Testing` does not establish overall acceptance; wait for user feedback on this artifact before completion.

Plan: `.grimoire/plans/0018-open-tui-cursor-output-adaptation.md`. The unrelated full pi-delegate runtime suite was not rerun; shared workspace typecheck and affected root integration were verified.
