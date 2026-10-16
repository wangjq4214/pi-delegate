# pi-open-tui

[English](README.md) | [简体中文](README.zh-CN.md)

A polished terminal interface for the [Pi](https://pi.dev) coding agent. It brings the strongest ideas from pi-haiku, pi-claude-code-tui, and pi-zentui into one configurable extension.

## Highlights

- **Native Pi header** retained without a custom Logo or command-tip panel
- **Responsive footer** with Git state, detected runtime, context usage, token counts, cost, and extension status
- **Framed editor** with block, bar, and underline cursor styles
- **Project awareness** for 50+ runtimes and detailed Git states, including ahead/behind, staged, modified, untracked, stashed, and detached HEAD
- **Turn telemetry** for TPS, time to first token (TTFT), duration, stalls, tokens, and list-price rate
- **Thinking peek**: a bounded title tree in Pi's collapsed thinking label, with a spinner matching Workline and a retained duration summary
- **Compact tools and codemode activity** with expandable native details, reliable statuses and observed child-call progress
- **Interactive settings** through `/open-tui`, available in English and Simplified Chinese

## Requirements

- Pi 1.0 or later; compact tool presentation needs Pi 1.1.0's public renderer API. Older hosts retain native tools with a capability notice
- A terminal with UTF-8 and color support
- A [Nerd Font](https://www.nerdfonts.com/font-downloads) for the full icon set (optional; portable Unicode icons are built in)

## Installation

### Local setup

From the [workspace root](../../README.md):

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run --filter @wangjq4214/pi-open-tui build
```

Rolldown emits `dist/index.js`, a source map, and `dist/LICENSE`. Pi SDKs remain external. The manifest and publication files target the bundle, while development loads source directly.

### Load source for development

```sh
bun run --filter @wangjq4214/pi-open-tui dev
```

This starts Pi in the package directory. Use `/reload` after changing source. To load both packages from the workspace root using an installed Pi CLI:

```sh
pi -e ./packages/pi-delegate/src/index.ts -e ./packages/pi-open-tui/src/index.ts
```

### Validate the bundle or install locally

```sh
bun run --filter @wangjq4214/pi-open-tui start
# With Pi CLI installed, after building:
pi install /absolute/path/to/checkout/packages/pi-open-tui
```

`start` requires a build. `build:watch` rebuilds the bundle; use `/reload` in Pi afterward. Install this scoped package with `pi install npm:@wangjq4214/pi-open-tui`. `npm:pi-open-tui` refers to the upstream package, not this copy. Do not load both copies in one session.

## Font and icons

Download any patched font from the official [Nerd Fonts downloads page](https://www.nerdfonts.com/font-downloads) or [latest GitHub release](https://github.com/ryanoasis/nerd-fonts/releases/latest). Install it, select that font in your terminal profile, and restart the terminal.

The default `auto` mode checks the terminal environment, not the installed font file. It uses Nerd Font icons in interactive UTF-8 TTYs, including terminals running through a runner or subshell. If icons appear as boxes or incorrect symbols, open `/open-tui` and choose one of these modes under **Appearance**:

- `nerd`: force Nerd Font icons after configuring a Nerd Font in the terminal
- `unicode`: portable Unicode icons (folder, branch, laptop, bulb, plug, hourglass, ...) that render without a patched font; emoji glyphs use the terminal's emoji fallback
- `ascii`: use plain-text icons with no patched font required
- `auto`: use Nerd Font icons in interactive UTF-8 TTYs; use portable Unicode icons for SSH sessions (the client terminal controls the font and usually has no Nerd Font); use ASCII for non-interactive output, `TERM=dumb`, or an explicitly non-UTF-8 locale

If the font is installed but `auto` still selects ASCII, choose `nerd` explicitly. In VS Code, Windows Terminal, and similar apps, configure the font in the terminal profile rather than only installing it in the operating system. If your SSH client terminal does ship a Nerd Font and you want the full icon set over SSH, set the mode to `nerd` explicitly.

## Configuration

Run `/open-tui` to open **General**, **Appearance**, **Footer**, **Telemetry**, **Tools**, and **User / Skill** settings. User/Skill and Tool presentation have separate controls; Appearance no longer has a shared message-layout toggle. Settings are stored in `~/.pi/agent/open-tui.json`. This example is the new-install baseline:

```json
{
  "enabled": true,
  "inlineFooter": false,
  "toolPresentation": true,
  "settingsLanguage": "en",
  "cursorStyle": "bar",
  "editorBorderStyle": "minimal",
  "messageLayout": "compact",
  "userMessageLayout": "compact",
  "toolMessageLayout": "compact",
  "userBoxBorder": {
    "enabled": false, "style": "bold", "colorMode": "theme",
    "top": { "enabled": false }, "bottom": { "enabled": false },
    "left": { "enabled": true }, "right": { "enabled": false }
  },
  "toolBoxBorder": {
    "enabled": false, "style": "double", "colorMode": "status",
    "top": { "enabled": true }, "bottom": { "enabled": false },
    "left": { "enabled": true }, "right": { "enabled": false }
  },
  "workline": {
    "marquee": true,
    "attachToBorder": false
  },
  "icons": {
    "mode": "auto"
  },
  "footerSegments": {
    "cwd": true,
    "hostname": false,
    "sessionName": false,
    "gitBranch": true,
    "gitStatus": true,
    "gitCommit": false,
    "runtime": true,
    "context": true,
    "tokens": true,
    "cost": true,
    "extensionStatuses": true,
    "capitalizeProviderName": true
  },
  "telemetry": {
    "enabled": true,
    "tps": true,
    "ttft": true,
    "duration": true,
    "tokens": true,
    "stalls": true,
    "cost": true
  },
  "thinkingPeek": {
    "lines": 1
  }
}
```

Upgrades/startup/reload do not rewrite an existing file or replace its effective preferences with the new defaults. Missing or wrongly typed known fields in existing files use the historical defaults, including Normal layout, block cursor, Surround editor and attached Workline; unknown legacy fields are retained. Legacy `messageLayout` is an in-memory fallback for absent independent layout fields. New installations alone receive the baseline above. Read/JSON errors warn and use fallback defaults. Explicit settings edits use same-filesystem replacement; failed saves leave the old file intact, apply only to the current session and report that they were not saved.

Key options:

| Option | Values | Notes |
| --- | --- | --- |
| `settingsLanguage` | `en`, `zh` | Changes the `/open-tui` interface language |
| `inlineFooter` | `true`, `false` | Moves the two main Footer rows into the editor's top and bottom borders; defaults to `false`. Extension status rows remain below the editor |
| `toolPresentation` | `true`, `false` | Tools → Enhanced presentation; defaults to `true`. Disable for native Tool content; compression and decorative style are separate controls |
| `cursorStyle` | `block`, `bar`, `underline` | `bar` and `underline` require terminal cursor-shape support |
| `editorBorderStyle` | `surround`, `minimal` | Appearance → Editor border; Minimal is the new-install default; existing preferences retain their prior behavior. Minimal keeps only horizontal borders with unchanged text inset. Changes apply immediately and are saved; working status and inline footer remain supported |
| `userMessageLayout` | `normal`, `compact` | Legacy-compatible User layout state; User / Skill → Enabled combines this with the frame switch. Off restores native messages/Skills; On applies that group’s saved style. New-install default `compact` |
| `toolMessageLayout` | `normal`, `compact` | Tools → Compression: Off / On; controls compact Tool shells and successful-preview hiding while enhanced; new-install default `compact` |
| `messageLayout` | `normal`, `compact` | Legacy fallback for absent independent layout fields; no shared UI toggle |
| `userBoxBorder` | Enabled, style, theme/static color, four edge enabled/char controls | User-owned style preferences; the single User / Skill enable switch also updates this frame state. Saved default frame flag is false, with compact left-rail presentation still enabled |
| `workline.marquee` | Boolean | Appearance → Workline marquee; defaults to `true`. Sweeps a highlight across the working message without scrolling it. Turning it off keeps status/time updates and Pi's native spinner |
| `workline.attachToBorder` | Boolean | Appearance → Workline attached to border; new-install default is `false`. Set to `false` for a row above the editor with one blank row above and below the visible Workline; never moves Workline into the footer |
| `icons.mode` | `auto`, `nerd`, `unicode`, `ascii` | Controls footer, Workline, tool presentation and telemetry icons |
| `footerSegments` | Boolean flags | Shows or hides individual footer data |
| `footerSegments.capitalizeProviderName` | Boolean | Capitalizes the first character of the provider name in the footer; set it to `false` to keep the provider's original casing |
| `telemetry` | Boolean flags | Enables telemetry and its individual measurements |
| `thinkingPeek.lines` | Legacy storage: `0`, `1`, `2` | Off (`0`) / On (`1` or `2`); title-only tree, latest four titles |
| `toolBoxBorder` | Enabled, style, status/static color, four edge enabled/char controls | Tools frame; disabled by default. Saved default: `double`, `status`, top/left on, bottom/right off. Fixed colors use theme tokens such as `muted` or `accent` |

In **Tools**, the first three rows are **Enhanced presentation**, **Compression**, and **Border style**. The first two are independent On/Off switches; Border style cycles Off, Single, Bold, Double, Dashed and Custom. Off hides all subsequent border controls without erasing their stored choices. **User / Skill** has one **Enabled** switch combining layout and frame activation: Off restores native User/Skill presentation and hides every other setting; On exposes the saved style, colors and edges. Existing compact rails count as enabled without a startup rewrite; explicit User styling edits activate that group’s configured frame. Both groups retain independent four-edge/symbol controls. Fixed-color inputs appear only in fixed mode; stored colors can also affect compact rails, with legacy dormant Tool colors preserved until an explicit Tool presentation edit. Symbol/color inputs use Enter to save, Esc to cancel and empty to reset; symbols must occupy one visible column. Right edges remain optional and off by default.

`sessionName` appears only when the session has a name. `hostname` shows the short host name (first label of the machine's host name, e.g. `mba` from `mba.example.com`) with a server icon. `gitCommit` independently controls the short hash and tag in detached HEAD state; `gitBranch` controls the branch name or `HEAD` label. Disabling `extensionStatuses` hides the entire extension status line, including MCP status. Each status keeps the colours its extension applied with `ctx.ui.theme.fg()`. A status without colours renders in the muted theme colour.

With `inlineFooter` enabled, the two normal Footer rows are rendered inside the editor frame to save vertical space. The top border places the Git branch on the left and CWD first in the right-hand group; the session title appears on the left too when `sessionName` is enabled. The native Pi header and extension status rows remain separate; narrow terminals truncate lower-priority Footer data first, keeping the right-hand statistics and the border corner.

Top-row data compacts before it is truncated: CWD has priority 0, hostname 1, session name 2, Git 3, and runtime/context 4 (higher survives longer; equal priorities shed earlier items first). The inline border fits its left and right groups separately. Bottom-row statistics survive before the model label.

Git supports unborn branches, simultaneous ahead/behind counts, stashes and detached HEAD. Snapshots refresh on session start, branch changes, tool completion, settled runs and settings changes. Reads are single-flight and pending requests coalesce; superseded results and old-session results cannot overwrite newer state. This is not a general filesystem watcher: edits made outside Pi are observed at the next refresh trigger.

Runtime markers are checked in the current working directory, including suffixes such as `.csproj`, `.fsproj` and `.cabal`. Detection retains first-match precedence across project types; standalone `.kt` or `.kotlin-version` markers identify Kotlin. Gradle Kotlin DSL keeps the Java/JVM label because it does not establish the project language. C-only source markers select C; mixed C/C++ sources or generic Make/CMake markers alone retain the C++ fallback.

The single **Workline** merges Pi's editor working message with elapsed run time. A run ends at `agent_settled`, not each low-level `agent_end`: retries, compaction and queued continuations keep the same timer and do not publish a premature result. The final status and duration remain until the next run, session replacement/reload, or successful tree navigation.

| Outcome | Label | Unicode / ASCII icon | Color |
| --- | --- | --- | --- |
| Observed normal completion | `done` | `✓` / `+` | Success |
| Observed interruption | `interrupted` | `■` / `!` | Warning |
| Observed failure | `failed` | `✗` / `x` | Error |
| Insufficient outcome evidence | `ended` | `•` / `-` | Muted |

Nerd Font mode also uses four distinct glyphs. `done` describes normal host completion, not proof that the user's task succeeded. A failed tool call alone does not make the run failed. Unresolved length-truncated responses and recovery cancellations without decisive evidence show neutral `ended`. Pi 1.1.0's public `agent_settled.aborted` flag also identifies retry or post-loop before-settle cancellation as `interrupted`; older hosts without that flag retain the earlier lifecycle-evidence limitation. This is not exhaustive final-cause diagnosis.

The footer no longer shows a second working/result timer, regardless of `inlineFooter`. Both Workline switches apply immediately and are saved. Native retry/compaction status messages keep their own meaning, styling and display priority; narrow borders may compact or truncate the Workline to fit.

## Compact message layout

Use **User / Skill → Enabled** and **Tools → Compression** independently in `/open-tui`. New installations retain compact left rails (`compact`), while existing files keep their prior effective choices without rewriting. User Off restores native User and Skill cards and hides styling controls; User On applies its own saved style. For the original Tool shell, turn Compression Off and select Border style Off. Changing either category does not change the other; Assistant output is unchanged.

User rails use `┃` (`|` in explicit ASCII mode), theme `userMessageText`, an unpainted gap and a `userMessageBg` body with one inner margin and one padding row above/below. Skill cards use an `accent` rail without shell background/top/bottom padding, preserving actual native content, click/shortcut expansion and code/paragraph spacing. Tool rails follow execution status. Host-owned message gaps stay unpainted; images retain native display behavior.

With **Tools → Enhanced presentation** and **Compression** both On, completed successful output/diff/third-party result previews stay hidden until expansion. Tool-result warnings, truncation/limit notices and saved full-output paths also stay folded until expansion, including notices supplied only as metadata. Summaries, expansion hints and codemode activity/errors remain visible; real failure previews and global capability notices are not hidden. Only `toolMessageLayout` controls compression, including with a decorative frame enabled. Turn Enhanced presentation Off for native Tool content; also turn Compression Off and Border style Off for the original shell. Overall Enabled disables the enhancements.

Optional frames override that category's rail/native shell and support four edges, independent presets/characters and colors. Tool frames enclose call/results as one card; User frames preserve native Markdown/transformers and prompt-zone markers, and Skill frames compose real controls. Tool frames retain public renderer composition; User/Skill adaptation remains reversible and instance-local, restoring native rendering on mode-off/disable/cleanup and warning/falling back on incompatible hosts. Tests target Pi 1.1.0, not future hosts or actual terminal/font fidelity. See the [layout checklist](docs/development.md#compact-message-layout-verification).

## Tool presentation

On Pi 1.1.0, every tool call receives unified status/name/argument summaries, a small actual-output/error preview (successful output is hidden when Tools → Compression is On) and measured elapsed time when available: native tools, editing/search extensions, delegate tools, computer-use, MCP and other extensions. Newly encountered tools do not need a styling allowlist entry or dedicated renderer. Verified native contracts add target/command summaries and edit diff previews; unknown schemas use bounded generic argument summaries instead of guessing semantics from a familiar name. Status follows host error evidence, not words such as “error” in output. Historical calls without timing do not acquire a synthetic duration. Expand with Pi's normal tool-expansion shortcut (shown on the card) for available arguments/results; images and their show/hide control, host truncation notices and saved full-output paths remain accessible.

Specialized third-party call/result components remain usable alongside the unified summary, including their own compact view, controls, images, interactions and important metadata. They are composed as actual components rather than flattened into text or silently cut to the generic preview budget; their native compact bodies may therefore occupy additional space in Tools with Compression Off. Tools → Compression hides successful result components until expansion, while keeping their controls and details available there. Expansion also exposes complete available generic arguments and returned text, so a specialized renderer that only shows metadata cannot hide the rest of the generic preview.

Codemode stays one parent card. Unified child rows cover all **observed** tool names, including unfamiliar/extension/MCP calls. Its compact view emphasizes observed activity: running/error/cancelled records have priority, selected rows retain call order, and overall status counts remain visible. With Tools → Compression On, the separate `Hidden …` overflow notice stays folded; expand for all available records. Counts are not a completion percentage or a prediction of final work. Parent timing is script wall time, never a sum of concurrent child durations. A successful script can contain failed/cancelled children; neither those children nor script success alone determine the Workline's Agent-run outcome. Actual script output remains previewed except for completed successes in Tools → Compression, and available model-call identity, status and cost remain visible in child records.

Expansion shows the complete available script and parent content plus host-provided child records. **Child arguments/errors are host summaries and may already be truncated; raw child results are not additionally retained.** If a script reads files but returns only a count, expansion cannot recover those files. Parent images, host truncation and full-output file access retain the normal host behavior; expansion cannot restore content omitted by the host.

Disable **Tools → Enhanced presentation** (`toolPresentation: false`) to return to native tool content (turn Compression Off and select Border style Off for the original shell); the overall Enabled switch also disables this enhancement. Older hosts without the public renderer API keep native tools and warn that enhanced presentation is unavailable. This changes presentation only, not execution, permissions, transcripts or model-facing results. Live-terminal density, scrolling, images and IME behavior still require the [interactive checklist](docs/development.md#tool-presentation-verification).

## Cursor rendering

`bar` and `underline` keep real, non-blinking terminal cursor shapes; they are not simulated with cell-consuming characters. `block` keeps Pi's software block and hides the real cursor while the editor owns focus. Cursor markers remain available for IME positioning; focused overlays retain their own cursor ownership.

Open TUI installs a reversible, instance-scoped runtime compatibility adapter. It deduplicates cursor visibility commands during renders and, in regular mode, ends synchronized output only after final cursor positioning. It does not modify Pi source/installed files or globally intercept stdout. Disabling/reloading the extension restores its method adaptations and the captured hardware-cursor preference. If the host seam is unavailable, it warns and retains native output rather than claiming flicker prevention.

Recorded-output integration tests now cover the pinned Pi TUI 1.1.0 (earlier evidence covered 1.0.0 and the inspected installed 1.0.4). The adapter uses a non-public rendering method, so future hosts need verification. Actual visual results depend on terminal/tmux synchronized-output support; real terminal flicker and Chinese IME placement still require interactive verification. See the [cursor smoke checklist](docs/development.md#cursor-output-verification).

## Turn telemetry

After each settled agent run, attached-to-border mode retains the transient telemetry notification without adding blank rows. Detached mode combines telemetry with the outcome and run duration in the same Workline row, with no separate notification; the result remains until the next run or session reset. Both modes respect telemetry settings; the detached row truncates to the available width. Tool-call turns are combined into that result:

```text
> TPS 42.5 tok/s | ~ TTFT 1.2s | + 29.7s | ↑ 567 | ↓ 1.2k | ! stall 1x / 4.3s | $ $3.60/M
```

TPS is calculated from all provider-reported assistant output tokens divided by the total generation time across the run. Timing starts at `turn_start` and ends at the assistant `message_end`, so it includes TTFT, hidden reasoning, buffering, and stalls; tool execution between turns is excluded. Runs without output tokens or measurable generation time show `TPS —`.

The `$ / M` value is the model's list-price rate from `usage.cost.total`, not the cumulative session cost shown in the footer. Every telemetry field can be toggled from the **Telemetry** tab.

## Thinking peek

When Pi's **Hide thinking** setting is enabled, Open TUI replaces the collapsed `Thinking...` label with a **title-only tree**. **General → Thinking titles** in `/open-tui` is simply **On / Off**.

- One status root shows thinking and measured elapsed time; up to the **latest four titles** appear below it, oldest first (**five rows total** at most). A new title evicts the oldest; consecutive duplicate titles do not add nodes. There is no extra overflow row and no raw reasoning-body preview.
- Titles come only from explicit Markdown headings, step/phase titles or standalone whole-line bold titles such as `**Analyzing voting dynamics**` in actual thinking. No keywords or numbering are needed for bold titles. Ordinary prose, partial inline bold and quoted/code examples are not treated as progress, and no model-generated summary is requested. If no title exists, show status/time only; non-reasoning models keep native behavior.
- The active title has a spinner. Earlier titles are not checked off: a title transition is not proof of task completion. Each assistant message starts a fresh tree; it is not a cross-tool task plan.
- Think samples the normal Workline spinner through its native renderer during the editor lifecycle, matching the host's actual animation speed (including custom speeds), not just a refresh constant. Both use the same ASCII phase fallback for the standard spinner; explicit custom host frames are preserved. There is no new animation timer or host timer patch. Elapsed measurements remain independent; missing/special native indicators retain the existing fallback.
- When thinking ends, collapse to a single latest-title/frozen-duration summary, for example `💡 ✓ Verify boundaries · 18.4s`. Cancellation, failure and uncertain endings use distinct interrupted/failed/neutral marks based on reliable message evidence, never an unconditional success check. The mark describes this thinking segment, not successful task acceptance. The summary stays on its own message when later user/assistant messages arrive, even if the final answer has no thinking. Each new message still starts a fresh tree/timer. Disabling the feature or explicit session/UI teardown restores native labels.
- Truncate titles by display-column width, preserving status and elapsed time first. Native expansion still exposes the full original reasoning, including content omitted from the tree.

```text
💡 Thinking · 14.2s
├─ Analyze constraints
├─ Compare approaches
├─ Check compatibility
└─ ⠹ Verify boundaries
```

Examples use portable Unicode icons; Nerd Font mode and ASCII icons/connectors follow the existing icon setting. There is no one/two-line selection or configurable title-count budget. For compatibility, `thinkingPeek.lines` remains the storage key: `0` means Off, `1` and `2` both mean On. Panel edits save `0`/`1` and retain unrelated/unknown preferences. Existing enabled/disabled choices and the enabled default are preserved, without a startup rewrite.

Workline, enhanced-tool elapsed display and thinking animation share one demand-driven UI scheduler. Due updates are aligned and render requests are coalesced; no dynamic consumers means no periodic wakeups. Consumers keep independent measurements and appropriate cadences. This does not poll Git/runtime data on animation ticks or take over native/third-party timers. Reduced redundant refresh work is an implementation goal, not a measured CPU-performance guarantee.

Thinking labels use an isolated host-component compatibility bridge. Missing/incompatible components or viewport information retain the native label and warn once per session. Only the pinned development host is covered by automated integration tests; live terminal/font/IME and other host-version compatibility still need separate verification.

## Development

From the workspace root:

```sh
bun run --filter @wangjq4214/pi-open-tui typecheck
bun run --filter @wangjq4214/pi-open-tui test
bun run check
```

See the [development guide](docs/development.md) for source/bundle debugging, Node inspector setup, and publication previews. Both packages build automatically through `prepack` before packing/publishing. Detailed docs are maintained in English.

## Documentation

- [Development guide](docs/development.md) — setup, verification, debugging, and maintenance boundaries.
- [Roadmap](docs/roadmap.md) — prioritized capability candidates and TODOs.

The detailed documentation is maintained in English.

## Acknowledgements

This project builds on several Pi community packages:

- **[pi-haiku](https://github.com/nnocte/pi-haiku)** — two-line footer structure and working timer
- **[pi-claude-code-tui](https://github.com/Phoobobo/pi-claude-code-tui)** — rounded editor border technique
- **[pi-zentui](https://github.com/lmilojevicc/pi-zentui)** — Starship-style footer segments, runtime detection, session lifecycle, and settings UI pattern
- **[pi-tps](https://github.com/monotykamary/pi-tps)** — turn timing, stall detection, and conservative TPS measurement

Runtime detection and Git porcelain parsing borrow structure from `pi-zentui`.

Special thanks to the **[LINUX DO](https://linux.do)** community for its support.

## License

[MIT](../../LICENSE)
