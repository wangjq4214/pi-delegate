# pi-open-tui

[English](README.md) | [简体中文](README.zh-CN.md)

A polished terminal interface for the [Pi](https://pi.dev) coding agent. It brings the strongest ideas from pi-haiku, pi-claude-code-tui, and pi-zentui into one configurable extension.

## Highlights

- **Native Pi header** retained without a custom Logo or command-tip panel
- **Responsive footer** with Git state, detected runtime, context usage, token counts, cost, and extension status
- **Framed editor** with block, bar, and underline cursor styles
- **Project awareness** for 50+ runtimes and detailed Git states, including ahead/behind, staged, modified, untracked, stashed, and detached HEAD
- **Turn telemetry** for TPS, time to first token (TTFT), duration, stalls, tokens, and list-price rate
- **Thinking peek**: an inline ticker replaces Pi's hidden `Thinking...` label with the tail of the model's reasoning while it works
- **Interactive settings** through `/open-tui`, available in English and Simplified Chinese

## Requirements

- Pi 1.0 or later
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

Run `/open-tui` to open the settings dialog. It provides **General**, **Appearance**, **Footer**, and **Telemetry** tabs. Settings are stored in `~/.pi/agent/open-tui.json`:

```json
{
  "enabled": true,
  "inlineFooter": false,
  "settingsLanguage": "en",
  "cursorStyle": "block",
  "editorBorderStyle": "surround",
  "workline": {
    "marquee": true,
    "attachToBorder": true
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

Missing or wrongly typed known fields use their defaults; unknown legacy fields are retained. Read/JSON errors produce a warning and use defaults. Saves replace the file on the same filesystem instead of overwriting it in place. If saving fails, changes still apply for the current session, a warning explains that they were not saved, and the previous configuration remains intact.

Key options:

| Option | Values | Notes |
| --- | --- | --- |
| `settingsLanguage` | `en`, `zh` | Changes the `/open-tui` interface language |
| `inlineFooter` | `true`, `false` | Moves the two main Footer rows into the editor's top and bottom borders; defaults to `false`. Extension status rows remain below the editor |
| `cursorStyle` | `block`, `bar`, `underline` | `bar` and `underline` require terminal cursor-shape support |
| `editorBorderStyle` | `surround`, `minimal` | Appearance → Editor border; Surround is the default. Minimal keeps only horizontal borders with unchanged text inset. Changes apply immediately and are saved; working status and inline footer remain supported |
| `workline.marquee` | Boolean | Appearance → Workline marquee; defaults to `true`. Sweeps a highlight across the working message without scrolling it. Turning it off keeps status/time updates and Pi's native spinner |
| `workline.attachToBorder` | Boolean | Appearance → Workline attached to border; defaults to `true`. Set to `false` for a row above the editor with one blank row above and below the visible Workline; never moves Workline into the footer |
| `icons.mode` | `auto`, `nerd`, `unicode`, `ascii` | Controls footer, Workline and telemetry icons |
| `footerSegments` | Boolean flags | Shows or hides individual footer data |
| `footerSegments.capitalizeProviderName` | Boolean | Capitalizes the first character of the provider name in the footer; set it to `false` to keep the provider's original casing |
| `telemetry` | Boolean flags | Enables telemetry and its individual measurements |
| `thinkingPeek.lines` | `0`, `1`, `2` | Off, one-line, or two-line hidden thinking preview |

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

Nerd Font mode also uses four distinct glyphs. `done` describes normal host completion, not proof that the user's task succeeded. A failed tool call alone does not make the run failed. Unresolved length-truncated responses and recovery cancellations without decisive evidence show neutral `ended`. Pi 1.0.0 does not attach an outcome to settlement: results reflect current-run public lifecycle evidence, not exhaustive final-cause diagnosis. In particular, cancellation by another extension during a post-loop `agent_before_settle` handler can be indistinguishable from normal completion or failure.

The footer no longer shows a second working/result timer, regardless of `inlineFooter`. Both Workline switches apply immediately and are saved. Native retry/compaction status messages keep their own meaning, styling and display priority; narrow borders may compact or truncate the Workline to fit.

## Turn telemetry

After each settled agent run, attached-to-border mode retains the transient telemetry notification without adding blank rows. Detached mode combines telemetry with the outcome and run duration in the same Workline row, with no separate notification; the result remains until the next run or session reset. Both modes respect telemetry settings; the detached row truncates to the available width. Tool-call turns are combined into that result:

```text
> TPS 42.5 tok/s | ~ TTFT 1.2s | + 29.7s | ↑ 567 | ↓ 1.2k | ! stall 1x / 4.3s | $ $3.60/M
```

TPS is calculated from all provider-reported assistant output tokens divided by the total generation time across the run. Timing starts at `turn_start` and ends at the assistant `message_end`, so it includes TTFT, hidden reasoning, buffering, and stalls; tool execution between turns is excluded. Runs without output tokens or measurable generation time show `TPS —`.

The `$ / M` value is the model's list-price rate from `usage.cost.total`, not the cumulative session cost shown in the footer. Every telemetry field can be toggled from the **Telemetry** tab.

## Thinking peek

When Pi's **Hide thinking** setting is enabled, pi-open-tui shows a compact ticker in the native hidden thinking block's `Thinking...` position. The `/open-tui` setting offers three modes: **Off**, **1 line**, and **2 lines**.

- while the model is reasoning, the current thinking tail streams by with a spinner (`~ think ⠋ …`);
- when the answer starts, it settles on a check mark (`~ think ✓`);
- in 2-line mode, the previous and latest thinking lines share the same text indentation; if the latest line overflows, both rows follow its newest tail as tokens arrive instead of retaining the previous line;
- after the task settles, the native `Thinking...` label is restored.

```text
~ think ⠋ previous thought
          latest thought
```

The ticker appears only once the model actually streams reasoning, so non-reasoning models never show it. Pi's own Hide thinking toggle controls visibility; changing it takes effect immediately. Each row is truncated by *visible* width, so CJK-wide thinking text cannot overflow. Configure it from **General → Thinking peek** in `/open-tui`, or via `thinkingPeek.lines` in `open-tui.json`.

Thinking peek uses an isolated host-component compatibility bridge. If the host tree or terminal width is unavailable/incompatible, it falls back to the native label and warns once per session instead of interrupting event handling. Only the pinned development host is covered by lifecycle tests; other host versions still need verification.

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
