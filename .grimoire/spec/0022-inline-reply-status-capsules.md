# Inline Assistant reply status capsules

**Spec ID:** 0022  
**Status:** Draft  
**Date:** 2026-11-20  
**Sources:** Accepted refinement discussion: inline rendering, four solid-color capsules, default-off switch with model guidance, three icon modes, and typed markers with model-written labels. The latest refinement supersedes the earlier fixed-label compatibility requirement. The ANSI/PowerShell preview establishes the visual intent, not host integration behavior.

## Requirements

- Render explicit status markers in the Assistant reply body at their original positions. Use a compact, filled capsule with rounded ends: the ends, padding, label and optional icon share one continuous background. Leave adjacent explanation text in its normal Markdown style. Do not add a footer widget, separate summary, or extra transcript message.
- Keep four status categories: **Success** (green), **Failure** (red), **Warning** (yellow), and **Needs your action** (blue). The explicit category selects the color and optional icon; the model supplies a short label in the reply's language. The capsule shows the label, not the category key. Maintain readable contrast under the active theme and guide the model to use labels that communicate the result or required action even without an icon. A status describes what the model reports, not an independent verification by Open TUI or a change to the host's run outcome. An action label does not pause execution or open a dialog.
- Add a default-off control in Open TUI Features. Enablement both requests explicit status markers from the model and renders recognized markers. Disablement stops adding that guidance and restores ordinary Markdown presentation, including for existing replies. The transform never rewrites the saved reply or strips markers from the conversation sent to the model.
- Offer three icon choices, independent of whether capsules are enabled: **Text** (ordinary characters such as `✓` and `!`), **Nerd Font** (Nerd Font status glyphs), and **None** (label only, without icon space). All three retain the filled capsule and its semantic color. Text and None must not depend on a Nerd Font for the capsule ends or show missing-glyph boxes in place of the ends.
- During streaming, render a marker only once it is complete. Leave replies without recognized markers, code blocks, quoted examples and other message types unchanged. Keep the capsule together when wrapping if it fits on a line, and keep the output readable and within the available terminal width even when it does not.

## Solution and integration contracts

Use explicit Markdown markers of the form `**[category: label]**`, with a shared set of category keys regardless of the reply language. The model guidance uses only this format and asks for short, meaningful labels without presenting unverified work as successful.

| Category key | Example marker | Capsule in Text icon mode |
| --- | --- | --- |
| `success` | `**[success: Tests passed 3/3]**` | Green, `✓ Tests passed 3/3` |
| `failure` | `**[failure: Build failed]**` | Red, `× Build failed` |
| `warning` | `**[warning: End-to-end tests not run]**` | Yellow, `! End-to-end tests not run` |
| `action` | `**[action: Confirm the release version]**` | Blue, `→ Confirm the release version` |

The same category can display different labels in different markers. Only typed markers can render as capsules. Old fixed-label markers such as `**[Success]**` and `**[成功]**` remain ordinary Markdown even when capsules are enabled. Do not migrate or rewrite saved replies.

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Preferences and guidance | Open TUI Features → rendering and model instructions | Independent enablement and icon choice; the existing Open TUI settings mechanism | One switch governs display and guidance for typed markers only; icon choice changes presentation only |
| Reply rendering | Pi Assistant Markdown → Open TUI transform → terminal | Complete typed markers in Assistant body Markdown | Category selects style; label supplies visible text; unaffected content passes through |

Pi 1.1.0, the [workspace development pin](../../packages/pi-open-tui/package.json), exposes `registerMarkdownTransformer`; the inspected SDK declares message type, streaming state and available width, and the native Assistant component calls it for body Markdown. This is the public integration seam, not evidence that the complete capsule styling has already been verified through it. A host without the usable capability keeps native presentation. The [User layout adapter](../adr/0020-instance-local-user-message-layout-adaptation.md) remains unchanged and does not provide an Assistant patching exception. Preserve existing preferences on upgrade, consistent with [ADR 0023](../adr/0023-independent-user-and-tool-presentation-configuration.md).

## End-to-End Tests

- **Enable and render:** Start with no capsule setting and confirm normal rendering and no capsule guidance. Enable the feature and confirm guidance recommends only the typed form. Stream a reply containing all four example markers and a second success marker with a different label. A partial marker does not form a capsule; the completed markers render in place with the expected color, icon and exact label without the category prefix. The two success markers share a style but show different text. Repeat with a Chinese reply using the same category keys and labels in the reply's language. Confirm the filled background is continuous, adjacent prose and list structure are preserved, and unmarked prose, quoted markers, code examples and equivalent User or thinking content remain unchanged.
- **Switch icon modes:** Render the same marked reply in Text, Nerd Font and None. Verify the three distinct icon behaviors, unchanged labels and colors, and no unused icon space in None. In an actual terminal without a Nerd Font, verify that Text and None do not show missing-glyph boxes at either end. Check the wrap boundary with a narrow viewport and wide-character text.
- **Disable and inspect history:** Open a saved reply containing a typed marker and old fixed-label markers in English and Chinese. With the feature on, only the typed marker renders as a capsule. Turn the feature off and confirm that all markers display as ordinary Markdown and the next run receives no capsule guidance. Re-enable the feature and reopen the reply: only the typed marker renders as a capsule, and the saved message text is unchanged. Confirm that an action marker does not open a dialog or pause a run.

## Out of Scope

Automatic severity inference, evidence verification, run or tool status changes, user-action workflows, and changes to Footer status, Workline, or thinking presentation.
