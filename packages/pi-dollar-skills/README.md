# pi-dollar-skills

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

An independent Pi extension for Codex-style skill selection. `/` keeps ordinary commands but hides skill candidates; `$` offers skills by name and description. Selecting a skill inserts `$skill-name` without sending. Submission injects the full skill file and its location into model context.

## Try it

Tested against Pi 1.4.0. Requires the public `addAutocompleteProvider` and custom trigger-character APIs. Older hosts without that UI API receive a warning; no editor patch is attempted. Host SDK peers are provided by Pi, not bundled.

From this repository root, preserving the current working directory:

```sh
pi -e ./packages/pi-dollar-skills/src/index.ts
# Or build and load the bundle:
bun run --filter @wangjq4214/pi-dollar-skills build
pi -e ./packages/pi-dollar-skills/dist/index.js
```

The package is configured for public npm publication. Initial publication and Trusted Publisher setup are maintainer prerequisites, not actions performed by these commands. After publication, install with `pi install npm:@wangjq4214/pi-dollar-skills`. Do not load both source and bundle at once.

## Interaction

Type `$`, keep typing to filter names, then use the editor's normal selection keys (normally arrows, Tab or Enter). Accepting a candidate does not submit. Continue composing, then submit normally:

```text
Use $grimoire-review and $grimoire-test to inspect these changes
```

- References start at the beginning of text or after whitespace; names match loaded skills exactly. Ordinary closing punctuation is accepted after a reference.
- Fenced/inline code and escaped dollar signs are literal. Unknown names are left unchanged. Use `\$skill-name` or inline code to quote a known name without loading it.
- Multiple distinct skills load in first-reference order; repeated references load once per submission. Full files are read fresh on submission, including frontmatter. Paths and relative-reference directories accompany each file. The original request and images pass through to Pi.
- Interactive multi-skill submissions show a separate native Pi skill card for each skill and a separate native User body. Click a card in fullscreen mode to expand it independently, or use Pi's normal expand-tools shortcut (normally Ctrl+O) to expand/collapse all. Open TUI's compact layout and User-box borders continue to apply to these native components.
- New multi-skill UI entries store the submitted snapshots, so replay does not reread changed skill files. Existing older transcript entries are not rewritten. Keep the extension loaded when resuming; without its renderer Pi falls back to showing the full stored content.
- Slash commands and `!` shell requests retain host semantics; dollar injection applies to ordinary prompts. Manual `/skill:name` still works, although hidden from suggestions.
- Available skills come from Pi's current session, including configured/package skills. Skill loading and automatic model matching remain unchanged; no settings are rewritten.
- A read failure stops submission instead of sending partial skill context. In the interactive editor an empty draft is restored without overwriting newer text. Images are not restored to the editor by this extension; if the host consumed an attachment before the failure, reattach it when retrying.
- Uses the host autocomplete composition API. It does not replace the native/Open TUI editor, patch prototypes, or alter installed Pi files. `/reload` uses Pi's normal extension/UI teardown.

## Integration notes

Interactive prompts with multiple distinct skills use one public custom session message, composed from Pi's publicly exported skill/User components. Pi converts its complete instructions, request and images into one model-facing User message, including when queued as steering or follow-up. The host's `before_agent_start` event identifies an idle submission as `messageType: "custom"`, and the extension consumes that input (`handled`). Extensions that require ordinary User-only input hooks or session entries must account for this. Single-skill prompts and non-TUI modes retain ordinary input transformation. No Open TUI runtime dependency or private host-component import is added.

## Development and evidence

```sh
bun run --filter @wangjq4214/pi-dollar-skills typecheck
bun run --filter @wangjq4214/pi-dollar-skills test
bun run --filter @wangjq4214/pi-dollar-skills build
```

Tests cover parsing, non-destructive completion, real SDK/resource/extension submission into an offline provider (including images, failure handling, steering/follow-up and RPC), actual native/Open TUI editor key paths, native multi-card rendering/click/global expansion, snapshot replay, and Open TUI layout adaptation on regular/fullscreen host renderers (including borders, theme/padding/width changes and cleanup). Terminal scheduling and UI mounting are controlled; these are not pixel/IME tests of a live terminal. Open TUI is a test collaborator, not a package runtime dependency. Actual terminal appearance and IME behavior require a local smoke test.

Runtime contracts are in [spec 0015](../../.grimoire/spec/0015-dollar-skill-invocation.md) and [ADR 0026](../../.grimoire/adr/0026-independent-dollar-skill-extension.md). Public publication is separately authorized by [ADR 0030](../../.grimoire/adr/0030-public-workspace-trusted-publishing.md); see the repository [release guide](../../docs/releasing.md). No account configuration or actual publication is performed by this implementation.

## License

[MIT](../../LICENSE).
