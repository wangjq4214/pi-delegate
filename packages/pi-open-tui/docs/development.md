# Development

## Import boundary

This package imports [OldSuns/pi-open-tui](https://github.com/OldSuns/pi-open-tui/tree/766ccab7b40df6fb9682a105a05d3838803c3d4b), version 0.3.11, commit `766ccab7b40df6fb9682a105a05d3838803c3d4b`.

- `src/` contains the imported upstream source modules with intentional local behavior changes, relocated into the standard package layout. The Node test suite uses imports updated to `../src/` and covers local behavior changes, including deterministic host-lifecycle regressions. The upstream MIT copyright and permission notices are retained in the [root license](../../../LICENSE), alongside this project's copyright notice; there is no package-level license file.
- The upstream `.gitignore` is retained within the package. GitHub issue and pull-request templates live in the workspace root `.github/` and are adapted for both packages and shared tooling; no package-level `.github/` is kept.
- Package metadata retains the existing `@wangjq4214/pi-open-tui` scope and publishes publicly. Pi SDK development dependencies are pinned to 1.0.0, matching delegate. TypeScript comes from the workspace root. Node types are pinned to the existing workspace resolution (26.6.4) to avoid mixing incompatible Node declarations with Bun's types.
- The workspace uses one `bun.lock`; the upstream npm lockfile is not imported. npm-specific `allowScripts` metadata is omitted; no new dependency lifecycle-script permissions are granted.
- Documentation and `AGENTS.md` use workspace commands. The standalone application scaffold is removed; Rolldown now bundles the imported extension.
- The packages remain independent. This is a Pi extension, not a standalone application or an extraction of delegate's UI.
- The custom Logo/model/CWD/command-tip header and its dedicated helpers are removed locally. Open TUI never overrides the host header, leaving Pi's native header in place; footer, editor, settings, thinking peek and telemetry remain available. This is not a measured performance claim.
- Editor border styles are a local addition: Surround retains the rounded frame; Minimal replaces corners and side rails with horizontal endpoints and spaces while preserving content width, mouse coordinates, colors, working status and inline footer. `/open-tui` Appearance settings apply and persist the choice; old or invalid configuration defaults to Surround.
- Workline outcomes are a local addition: full-run settlement owns timing and publication; structured public host evidence distinguishes completed, interrupted, failed and neutral ended results with distinct glyphs, labels and colors. No Pi execution hooks or private state are patched. Pi 1.0.0 lacks an authoritative final outcome, including an observability gap for cancellation during post-loop before-settle handlers; see the README for conservative fallback and limits.
- Configuration/Git reliability are local changes: known-field validation with legacy-field retention, same-filesystem replacement and visible save failures; porcelain-v2 branch/stash/change parsing; independent branch/commit switches; single-flight latest-only project refreshes after tools and settlement. Run outcomes and telemetry definitions are unchanged.
- Runtime suffix markers are explicit. Gradle Kotlin DSL retains Java/JVM precedence; C-only source evidence disambiguates C from the historical C++ Make/CMake fallback. Version probes accept both stdout and stderr.
- Thinking-label component-tree adaptation lives in `thinking-label.ts` with cycle protection, message-scoped caching/reset, and a once-per-session warning on unavailable compatibility. The editor owns frame geometry; footer content computes only the requested plain/inline layout and does not collect extension statuses for inline borders.
- Cursor output adaptation is a local runtime change isolated in `cursor-output.ts`: it resolves Pi's stable TUI reference to the current renderer, installs reversible instance wrappers, preserves bounded output and opaque terminal strings, delays regular-mode sync-end until cursor positioning completes, and deduplicates render-time visibility commands in both modes. It never patches host files, global prototypes or stdout. Block hides the editor's real cursor; bar/underline retain real shapes. Terminal restart and editor invalidation rebind the adapter before mode-switch output, including fullscreen transcript exit without terminal restart. Capability failure warns and falls back to native cursor output; this is not a guarantee for future host implementations.

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

For run outcomes, check both Workline placements and Nerd/Unicode/ASCII icon modes. Verify normal completion (`done`), provider failure (`failed`), an observable streaming/tool-phase abort (`interrupted`), and ambiguous recovery cancellation or unresolved truncation (`ended`). Confirm the timer continues through retry/compaction/continuations without an early successful status, native special statuses retain priority, and `/new`, resume/fork/reload and successful tree navigation clear the retained result. The leading icons must differ without relying on color. Tests using the actual pinned host and a deterministic provider are lifecycle integration evidence, not live terminal/font or external-provider verification.

## Cursor output verification

Automated tests use actual Pi TUI renderers and the host's stable forwarding reference with a recording terminal, not a live display. `cursor-output.test.ts` covers fragmented CSI, opaque OSC/DCS/APC/PM/SOS payloads, bounded streaming, cursor-only frames, exceptions, cache invalidation and restoration/other-wrapper ownership. `cursor-output.integration.test.ts` covers both modes, all three styles, both Workline placements, transcript growth/shrink, marker coordinates, focused overlays, style preview, forced repaint/resize, normal mode switching, transcript exit without terminal restart, repeated editor factories and unsupported-seam warning/fallback. Error tests include a partially emitted fullscreen terminal write; sync-end recovery remains best-effort if further terminal writes also fail. The package test command includes both files.

To exercise another installed host without changing its files, from this package directory run (replace the module root):

```sh
OPEN_TUI_CURSOR_HOST_MODULES=/path/to/global/node_modules node --test tests/cursor-output.integration.test.ts
```

Output tests passed against the pinned Pi TUI 1.0.0 and the locally inspected installed 1.0.4. They do not prove actual visual or IME behavior. Before acceptance, load the freshly built bundle once (do not also load source/upstream/another installed copy), and record the terminal version plus any tmux/SSH layer:

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
