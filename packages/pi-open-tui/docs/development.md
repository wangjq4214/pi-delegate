# Development

## Import boundary

This package imports [OldSuns/pi-open-tui](https://github.com/OldSuns/pi-open-tui/tree/766ccab7b40df6fb9682a105a05d3838803c3d4b), version 0.3.11, commit `766ccab7b40df6fb9682a105a05d3838803c3d4b`.

- `src/` contains the imported upstream source modules with intentional local behavior changes, relocated into the standard package layout. The Node test suite uses imports updated to `../src/` and covers local behavior changes, including deterministic host-lifecycle regressions. The upstream MIT copyright and permission notices are retained in the [root license](../../../LICENSE), alongside this project's copyright notice; there is no package-level license file.
- The upstream `.gitignore` is retained within the package. GitHub issue and pull-request templates live in the workspace root `.github/` and are adapted for both packages and shared tooling; no package-level `.github/` is kept.
- Package metadata retains the existing `@wangjq4214/pi-open-tui` scope and publishes publicly. Pi SDK development dependencies are pinned to 1.1.0, matching delegate. TypeScript comes from the workspace root. Node types are pinned to the existing workspace resolution (26.6.4) to avoid mixing incompatible Node declarations with Bun's types.
- The workspace uses one `bun.lock`; the upstream npm lockfile is not imported. npm-specific `allowScripts` metadata is omitted; no new dependency lifecycle-script permissions are granted.
- Documentation and `AGENTS.md` use workspace commands. The standalone application scaffold is removed; Rolldown now bundles the imported extension.
- The packages remain independent. This is a Pi extension, not a standalone application or an extraction of delegate's UI.
- The custom Logo/model/CWD/command-tip header and its dedicated helpers are removed locally. Open TUI never overrides the host header, leaving Pi's native header in place; footer, editor, settings, thinking peek and telemetry remain available. This is not a measured performance claim.
- Editor border styles are a local addition: Surround retains the rounded frame; Minimal replaces corners and side rails with horizontal endpoints and spaces while preserving content width, mouse coordinates, colors, working status and inline footer. `/open-tui` Appearance settings apply and persist the choice; old or invalid configuration defaults to Surround.
- Workline outcomes are a local addition: full-run settlement owns timing and publication; structured public host evidence distinguishes completed, interrupted, failed and neutral ended results with distinct glyphs, labels and colors. No Pi execution hooks or private state are patched. The 1.1.0 upgrade consumes the public `agent_settled.aborted` flag for retry and post-loop before-settle cancellation; older hosts without the flag retain the earlier observability gap. See the README for conservative fallback and limits.
- Configuration/Git reliability are local changes: known-field validation with legacy-field retention (including nested fields during settings-panel edits), same-filesystem replacement and visible save failures; porcelain-v2 branch/stash/change parsing; independent branch/commit switches; single-flight latest-only project refreshes after tools and settlement. Run outcomes and telemetry definitions are unchanged.
- Runtime suffix markers are explicit. Gradle Kotlin DSL retains Java/JVM precedence; C-only source evidence disambiguates C from the historical C++ Make/CMake fallback. Version probes accept both stdout and stderr.
- Thinking-label adaptation remains in `thinking-label.ts` with cycle protection and message-scoped targeting. `peek.ts` extracts explicit headings, step/phase titles and standalone whole-line `**bold titles**`, rejecting partial inline bold and quoted/code examples; it formats a title-only chronological tree (latest four titles, no body preview). `peek-controller.ts` owns message-level timing, truthful end states, immediate settlement, reset and once-per-session warnings. Message transitions reset only current title/timer/target state, retaining completed summaries on their own native components; disablement/explicit session teardown can still restore native labels even after a plain answer. No historical measurement reconstruction or retained component map is introduced. Native expanded reasoning is unchanged; editor lifecycle invalidation refits frozen summaries after resize or target replacement. `thinkingPeek.lines` is retained only for legacy storage (0 Off, 1/2 On), with a binary settings control and no startup rewrite.
- `ui-refresh.ts` owns one demand-driven periodic scheduling source shared by Workline, enhanced tools and thinking. A common cadence origin aligns due updates (Workline/thinking elapsed presentation 250ms, tool elapsed 500ms), batching duplicate render channels and stopping when idle. Think samples the normal native Workline spinner through the editor render lifecycle rather than advancing a competing frame clock; `spinner.ts` shares the standard ASCII rotation-phase fallback with Workline and preserves custom native frames. Native frame requests drive matching animation even when their period differs from the shared elapsed subscriptions; no additional periodic source or host timer interception is introduced. Public tool invalidation still dirties native caches; Pi coalesces its own frame requests. Measurements/outcomes remain consumer-owned; shared `formatDuration` supports explicit precision policies. Git/runtime snapshots stay under `LatestRefresh`, and host/third-party timers remain untouched. This is not a quantified CPU or terminal-FPS claim.
- Cursor output adaptation is a local runtime change isolated in `cursor-output.ts`: it uses the shared `host-patches.ts` forwarding-reference and reversible instance-patch primitives, preserves bounded output and opaque terminal strings, delays regular-mode sync-end until cursor positioning completes, and deduplicates render-time visibility commands in both modes. It never patches host files, global prototypes or stdout. Block hides the editor's real cursor; bar/underline retain real shapes. Terminal restart and editor invalidation rebind the adapter before mode-switch output, including fullscreen transcript exit without terminal restart. Capability failure warns and falls back to native cursor output; this is not a guarantee for future host implementations.
- Compact tool presentation is a local addition using Pi 1.1.0's public resolver composition API. `tool-presentation.ts` owns renderer composition and live state; `tool-presentation-policy.ts` owns pure summaries, child selection, output previews and notices. Together they provide generic coverage for every tool name, including future tools without dedicated renderers; native identity/schema checks select optimizations only. Specialized components remain in the component tree with their mouse/focus/input routing, shared state and native `lastComponent` continuity. The extension owns session-scoped live timing only and preserves available expanded details. Codemode child summaries remain parent-owned metadata, not a raw nested-result archive or additional transcript entries. Older hosts lacking the API keep native presentation with a notice.
- User/Skill and Tool presentation settings are independent local additions. New installations use compact rails, bar cursor, minimal editor and detached Workline; existing files normalize against historical defaults and are not rewritten on startup/reload. `messageLayout` is retained solely as a legacy fallback for omitted `userMessageLayout`/`toolMessageLayout`. Both categories have optional four-edge frames with independent glyph/color choices. `message-layout.ts` owns frame geometry/input translation; `user-message-layout.ts` remains a reversible User/Skill instance adapter, preserving native Markdown/OSC133 markers and real Skill MouseRegion/content. Tool rendering uses public self-shell composition. `host-adapters.ts` retains cursor-inner/User-outer binding and reverse-order cleanup, with one mounted scan per frame rather than per refresh. No host installation, global prototype, Assistant, execution or transcript changes are introduced.

The imported extension and tests are excluded from Biome formatting, lint, and import organization through a narrowly scoped root override. This intentionally preserves the upstream snapshot rather than introducing a mass rewrite. Package metadata and workspace integration tests remain checked by Biome; imported code is verified by TypeScript and its upstream tests.

## Setup and checks

From the workspace root:

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run build
bun run typecheck
bun run check
bun run test
```

For this package only:

```sh
bun run --filter @wangjq4214/pi-open-tui build
bun run --filter @wangjq4214/pi-open-tui typecheck
bun run --filter @wangjq4214/pi-open-tui test
```

`build` uses Rolldown to emit Node.js ESM at `dist/index.js` with a source map. Node built-ins and Pi host SDKs remain external. The manifest loads this bundle, while `dev` explicitly loads `src/index.ts`. Each package build also emits `dist/LICENSE` from the root license so distribution retains the notices without a package-level source license file. Tests retain the upstream `node --test` runner and require Node.js 22.19 or later. Use root `bun run test` to also execute repository integration tests and the delegate suite in its own working directory.

## Interactive verification

From the workspace root:

```sh
bun run --filter @wangjq4214/pi-open-tui dev
# Or load the source explicitly:
bun run --cwd packages/pi-open-tui pi --extension ./src/index.ts
```

Source changes take effect after Pi's `/reload`. The `dev` script runs Pi in this package directory, which is also its working directory. To work on another project, start your installed Pi CLI in that directory with `pi -e /absolute/path/to/checkout/packages/pi-open-tui/src/index.ts`. Do not load both upstream `pi-open-tui` and this local copy, or both source and installed bundles, in the same session. Disable duplicate resources with `pi config` before testing.

In a UTF-8 terminal, verify the native Pi header (no custom Logo or command-tip panel), footer, framed editor, `/open-tui` settings tabs and language switch, icon modes, inline footer, turn telemetry, and thinking peek. Settings are written to `~/.pi/agent/open-tui.json`, the same location used upstream; existing settings are reused. Thinking peek needs a reasoning model and Pi's Hide thinking option. Automated tests do not establish end-to-end terminal or provider compatibility.

For run outcomes, check both Workline placements and Nerd/Unicode/ASCII icon modes. Verify normal completion (`done`), provider failure (`failed`), streaming/tool/retry-wait/before-settle aborts on Pi 1.1.0 (`interrupted`), and insufficient evidence or unresolved truncation (`ended`). Confirm the timer continues through retry/compaction/continuations without an early successful status, native special statuses retain priority, and `/new`, resume/fork/reload and successful tree navigation clear the retained result. The leading icons must differ without relying on color. Tests using the actual pinned host and a deterministic provider are lifecycle integration evidence, not live terminal/font or external-provider verification.

## Thinking titles and shared refresh verification

`peek.test.ts` and `peek-controller.test.ts` cover explicit title extraction, code/prose rejection, streamed-heading identity, the four-title window, control-sequence/Unicode width safety, time-prioritized clipping, message-local terminal evidence, frozen time and native fallback/recovery. `thinking-label.test.ts` renders the actual pinned collapsed Assistant component in regular/fullscreen modes and preserves native expanded content. `ui-refresh.test.ts` observes a single periodic source, aligned 250/500ms demand, render-channel deduplication, idle teardown, reset-during-dispatch and skipped obsolete frames. Entry-point and tool integration tests exercise shared ownership, independent elapsed intervals, real public tool invalidation, feature disable/re-enable and editor replacement. Native shell timer cleanup remains independently tested.

H8 follow-up regressions include screenshot-style bold titles streamed character-by-character, malformed/inline/quoted/code negatives, and actual pinned-host Workline/Think frames in both TUI modes and all three explicit icon modes. The real native indicator runs at 80ms (default), 37ms and 140ms against the unchanged 250ms elapsed subscription; tests compare displayed frames/rotation phase, exercise repeated renders and both Workline placements, preserve original expanded reasoning and verify frozen thinking with a still-running Workline. Fullscreen fixtures start the actual alternate screen before drawing; a collapsed summary plus a native answer remains two distinct visible rows.

Before visual acceptance, load the new bundle once in both TUI modes with a reasoning model. Inspect long/missing/rapidly streamed titles, the five-row running bound and one-row final summary; interrupt/error the current message and verify its mark is not a task-success assertion. Expand/collapse, resize a frozen summary, change icons/theme/language and check typing/scroll/IME stability. Use disposable legacy configurations (0/1/2) to confirm binary settings and unchanged startup file bytes. Automated source/timer/recorded-frame evidence does not establish live terminal/font/IME acceptance or a measured CPU improvement.

## Tool presentation verification

`tool-presentation.integration.test.ts` uses the real Pi 1.1.0 resource loader, extension resolver and ToolExecutionComponent in both TUI modes, plus a real codemode sandbox with controlled nested-tool execution. It covers universal generic styling across tool-source categories, missing renderers, unfamiliar schemas, history and late registration without allowlist changes; specialized default/self-shell components with actual mouse/focus/input dispatch, shared state, invalidation and native `lastComponent`; compact/expanded details, host error evidence, diff/image controls, truncation paths, width/theme/icon changes, isolated clocks, native shell timer cleanup and caught-child/parent-error separation. Tool-source fixtures exercise the presentation seam, not real MCP transport or computer-use dispatch. The suite does not establish full AgentSession permissions/accounting or external model/image-provider E2E behavior.

Before acceptance, load the freshly built bundle in a live terminal and record host/terminal versions and any tmux/SSH layer:

1. In both regular and fullscreen modes, inspect native and generic success/error cards (editing/search, delegate, computer-use, MCP and a new unfamiliar tool), long Chinese/combining/emoji arguments, expansion/collapse, theme/icon changes and resize. Confirm errors and saved-output paths are discoverable, images retain show/hide behavior, and specialized renderer controls remain usable beside the unified summary.
2. Run codemode with dynamic/concurrent calls, caught child failure/cancellation and a later parent error. Inspect ordered activity, hidden-status counts, output and full-script expansion; verify unrelated simultaneous parent cards do not share records or clocks.
3. While output streams, scroll and type Chinese with an IME. Check density, stable scrolling, input/cursor ownership and absence of new flicker. Disable/re-enable tool presentation and Open TUI, navigate branches, start/resume sessions and reload; verify native rendering and cleanup.

This manual checklist remains pending; recorded terminal frames alone are not visual acceptance.

## Compact message layout verification

The actual-host presentation tests cover Normal/Compact transitions, independent tool-content selection, User/Tool outer padding versus the one-line message gap, unchanged Assistant output, native User Markdown/transformers and code whitespace, background-free accent skill rails, skill shell padding removal, native skill content/click expansion, partial-bind rollback and skill restoration across renderer replacement, prompt-zone markers, history/late component discovery, detached-component cleanup, narrow widths, theme changes, opaque image rows and unsupported-host fallback. Both regular and fullscreen mounted layouts are exercised. Specialized default/self renderers retain their mouse/focus/input behavior in both layouts. Cursor integration tests additionally exercise both adapters together across repeated mode switches and cleanup.

Live-terminal visual verification remains pending. Load the freshly built bundle and:

1. Toggle User / Skill → Enabled and Tools → Enhanced presentation / Compression independently. User Off must restore native User/Skill cards and show only the enable switch; Tool settings must not change. Tool Compression must not toggle enhancement or style. With Border style Off, only the first three Tool rows are selectable; Assistant remains unchanged.
2. Enable User / Skill and select an active Tool border style. Test top/bottom/left/right, presets and symbol overrides, theme/fixed User colors and status/fixed Tool colors. Set Tool style Off and confirm remaining border rows disappear; disable User and confirm only its enable row remains. Expand/collapse Skills by mouse and shortcut with a right edge enabled; inspect tools/codemode, error/diff output, specialized controls and images. Content/interaction and interior whitespace must remain usable.
3. Test Chinese/emoji/combining text, narrow resize, light/dark themes and Unicode/ASCII icons. Check that User and Tool use the same `┃` rail (`|` in ASCII mode); the User rail and following one-space gap stay outside its background, with one additional space of left padding inside the background on every row. User content has exactly one blank row above and below, both carrying the rail and the same background as its body; Tool framing stays compact. Check selection, scroll stability and IME input.
4. Switch TUI modes, navigate history/branches, resume, disable/re-enable and reload; User/Skill and cursor adapters must restore native ownership. Using disposable config directories, compare complete and partial legacy-file bytes/preferences before/after upgrade/start/reload without settings edits, and verify first explicit single-category edits persist without changing the other category. New-install defaults alone should match the documented baseline.

These automated fixtures establish host integration, not actual terminal/font/IME visual acceptance or support for untested future host versions.

## Cursor output verification

Automated tests use actual Pi TUI renderers and the host's stable forwarding reference with a recording terminal, not a live display. `cursor-output.test.ts` covers fragmented CSI, opaque OSC/DCS/APC/PM/SOS payloads, bounded streaming, cursor-only frames, exceptions, cache invalidation and restoration/other-wrapper ownership. `cursor-output.integration.test.ts` covers both modes, all three styles, both Workline placements, transcript growth/shrink, marker coordinates, focused overlays, style preview, forced repaint/resize, normal mode switching, transcript exit without terminal restart, repeated editor factories and unsupported-seam warning/fallback. Error tests include a partially emitted fullscreen terminal write; sync-end recovery remains best-effort if further terminal writes also fail. The package test command includes both files.

To exercise another installed host without changing its files, from this package directory run (replace the module root):

```sh
OPEN_TUI_CURSOR_HOST_MODULES=/path/to/global/node_modules node --test tests/cursor-output.integration.test.ts
```

Output tests now pass against the pinned Pi TUI 1.1.0; earlier evidence covered 1.0.0 and the locally inspected installed 1.0.4. They do not prove actual visual or IME behavior. Before acceptance, load the freshly built bundle once (do not also load source/upstream/another installed copy), and record the terminal version plus any tmux/SSH layer:

1. In both regular and fullscreen mode, test block, bar and underline with Workline attached and detached while the assistant streams. No transient cursor should appear on Workline, and editor cursors should not pulse with refreshes. Bar remains a real thin bar; underline remains a real terminal underline; block has no second real cursor.
2. Type Chinese with an IME, plus wide/combining/emoji text. Candidate windows should follow the input position, including line ends and wrapped lines. Verify input content and cursor navigation remain correct.
3. Open/close an input dialog and `/open-tui`; preview all styles, return focus, resize, and switch Pi's TUI mode. Dialog cursor ownership must remain correct and no stale editor preview should leak through another overlay.
4. Disable/re-enable Open TUI, `/reload`, `/new`, and exit. Check that the native editor and shell cursor are restored and no synchronized-output mode remains stuck.

If any scenario fails, retain the exact bundle/version and reproduction. Optionally capture `PI_TUI_WRITE_LOG` on a separate Pi run for ANSI diagnosis; recorded commands alone are not approval of visual correctness. This checklist remains pending until actual terminal/IME feedback is supplied.

## Bundle debugging and packaging

From the workspace root:

```sh
bun run --filter @wangjq4214/pi-open-tui build
bun run --filter @wangjq4214/pi-open-tui start
```

For iterative bundle testing, run `bun run --filter @wangjq4214/pi-open-tui build:watch` in a second terminal and `/reload` in Pi after each rebuild. `dev` does not need the watcher because it loads source.

For both extensions together, use your installed Pi CLI from the workspace root (the package scripts use the pinned development host):

```sh
pi -e ./packages/pi-delegate/src/index.ts -e ./packages/pi-open-tui/src/index.ts
```

For Node debugger breakpoints, run from `packages/pi-open-tui` and attach VS Code or another inspector client to the local debug port:

```sh
node --inspect=127.0.0.1:9229 --enable-source-maps ./node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js -e ./dist/index.js
```

Build first. Use `--inspect-brk` instead of `--inspect` to pause before startup. Never expose the inspector on a public interface.

Both packages define `prepack: bun run build`. Preview their publication contents without publishing:

```sh
npm pack --dry-run --workspace @wangjq4214/pi-delegate
npm pack --dry-run --workspace @wangjq4214/pi-open-tui
```

Verify `dist/index.js`, `dist/index.js.map`, `dist/LICENSE`, and each package’s additional resources. The UI source directory is not a publication entry. Both scoped packages publish publicly; the repository root remains private. Rolldown does not replace `typecheck` or tests; run all workspace checks before releasing.

## Maintenance

Keep both READMEs aligned for user-facing changes and preserve the upstream MIT notice and acknowledgements. Before updating the snapshot, record the new commit, compare upstream source/tests/license, rerun workspace checks, and explicitly document any local behavior changes. Do not silently refactor imported source during synchronization.
