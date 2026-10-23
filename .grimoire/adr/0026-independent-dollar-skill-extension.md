# Keep dollar skill invocation in an independent extension

**Status:** Completed
**Date:** 2026-10-23

## Context

The user requested a new extension with Codex-like skill interaction: remove skills from `/` suggestions and select/inject them through `$`. They confirmed the proposed interaction, including full instruction injection at submission and multiple skills in one message.

The confirmed solution boundary is an independent extension using public Pi APIs, without modifying Pi itself or replacing the Open TUI editor. This follows the repository's independent-package direction in [ADR 0010](./0010-independent-workspace-packages.md) and the host-extension separation in [ADR 0011](./0011-import-upstream-open-tui-extension.md). Those records do not themselves prescribe this new feature.

Read-only inspection of installed Pi 1.4.0 found `ctx.ui.addAutocompleteProvider()` for composing autocomplete behavior, `pi.getCommands()` for skill metadata, and the `input` transform hook. The shipped `github-issue-autocomplete.ts` and `input-transform.ts` examples demonstrate those extension seams. This is feasibility evidence for that installation, not a compatibility guarantee for every Pi version or the workspace's older SDK pins.

## Decision

- Keep this capability in a new independent extension rather than fold it into pi-delegate or make it depend on Open TUI.
- Use public host extension APIs; do not modify host source or installed files, or replace the active editor to implement this capability.
- Treat hiding skill command suggestions as a discovery change, not unloading skills or removing Pi's automatic skill-matching capability.

These boundaries preserve the user's existing editor and keep skill interaction independently usable.

## Consequences

- The extension must work with the native editor and coexist with Open TUI through the host's composition seams.
- Implementation must verify required APIs against its actual supported host versions; the current Open TUI peer range is not evidence of support for this new extension.
- This record approves boundaries, not an implemented or tested feature. Detailed interaction and acceptance criteria belong in [spec 0015](../spec/0015-dollar-skill-invocation.md).
