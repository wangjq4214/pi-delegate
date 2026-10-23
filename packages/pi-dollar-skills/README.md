# pi-dollar-skills

[English](README.md) | [简体中文](README.zh-CN.md)

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

This package is private/unpublished. These commands do not install it or change your global settings. Do not load both source and bundle at once.

## Interaction

Type `$`, keep typing to filter names, then use the editor's normal selection keys (normally arrows, Tab or Enter). Accepting a candidate does not submit. Continue composing, then submit normally:

```text
用 $grimoire-review 和 $grimoire-test 检查这些修改
```

- References start at the beginning of text or after whitespace; names match loaded skills exactly. Ordinary closing punctuation is accepted after a reference.
- Fenced/inline code and escaped dollar signs are literal. Unknown names are left unchanged. Use `\$skill-name` or inline code to quote a known name without loading it.
- Multiple distinct skills load in first-reference order; repeated references load once per submission. Full files are read fresh on submission, including frontmatter. Paths and relative-reference directories accompany each file. The original request and images pass through to Pi.
- Slash commands and `!` shell requests retain host semantics; dollar injection applies to ordinary prompts. Manual `/skill:name` still works, although hidden from suggestions.
- Available skills come from Pi's current session, including configured/package skills. Skill loading and automatic model matching remain unchanged; no settings are rewritten.
- A read failure stops submission instead of sending partial skill context. In the interactive editor an empty draft is restored without overwriting newer text. Images are not restored to the editor by this extension; if the host consumed an attachment before the failure, reattach it when retrying.
- Uses the host autocomplete composition API. It does not replace the native/Open TUI editor, patch prototypes, or alter installed Pi files. `/reload` uses Pi's normal extension/UI teardown.

## Development and evidence

```sh
bun run --filter @wangjq4214/pi-dollar-skills typecheck
bun run --filter @wangjq4214/pi-dollar-skills test
bun run --filter @wangjq4214/pi-dollar-skills build
```

Tests cover parsing, non-destructive completion, real SDK/resource/extension submission into an offline provider (including images and failure handling), and actual native/Open TUI editor key paths. The editor tests control terminal scheduling and the UI mounting bridge; they are not a pixel/IME test of a live terminal. Open TUI is a test collaborator, not a package runtime dependency. Actual terminal appearance and IME behavior require a local smoke test.

No npm publication or user configuration changes are part of this feature. See [spec 0015](../../.grimoire/spec/0015-dollar-skill-invocation.md) and [ADR 0026](../../.grimoire/adr/0026-independent-dollar-skill-extension.md).

## License

[MIT](../../LICENSE).
