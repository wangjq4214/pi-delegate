# Independent User/Skill and Tool card presentation with configurable four-sided borders

**Spec ID:** 0013
**Status:** Draft
**Date:** 2026-10-13
**Sources:** Accepted refinement contract H1–H5 below; [ADR 0023](../adr/0023-independent-user-and-tool-presentation-configuration.md); [ADR 0020](../adr/0020-instance-local-user-message-layout-adaptation.md); [ADRs 0018](../adr/0018-public-host-tool-renderer-composition.md) and [0019](../adr/0019-universal-tool-presentation-with-specialized-composition.md); [Spec 0011](./0011-open-tui-tool-call-presentation.md).

## Source and coordination boundary

- **H1 — Historical contract:** This spec originally covered Tool call/result cards with top, bottom and left borders, line presets (`single`, `bold`, `double`, `dashed`, `custom`), per-edge visibility/character overrides, and status/static colors. The right edge was explicitly excluded.
- **H2 — Independent scopes:** The user requested “Separate User message and Tool call configuration, allowing each to configure capabilities similar to the current Tool call settings” (translated). They also explicitly required “User message configuration must also cover skills” (translated). User configuration therefore covers ordinary User messages and Skill invocation cards; Tool configuration covers calls/results independently.
- **H3 — Four edges:** The user requested a Tool right border, then answered “Supported” (translated) when asked whether User/Skill should also support all four edges independently. This replaces H1's permanently open right edge and expands the former Tool-only scope. Assistant presentation is not included.
- **H4 — Defaults and upgrade preservation:** The user clarified “Use my current configuration as the defaults” (translated), then explicitly required “Upgrades must not change user configuration” (translated). New installations use the captured current configuration as their default baseline; upgrades preserve existing configuration and effective appearance rather than adopting that baseline.
- **H5 — Endpoint:** The user selected spec-only (“Use the spec-only endpoint” (translated)). Revise the continuing spec and necessary related knowledge/cross-references only. Do not create tickets or an implementation plan, edit production/tests, install dependencies, run implementation QA, stage or commit.
- **Coordination knowledge boundary:** Consume settled requirements and established choices from this handoff and the verified sources; organize and express them without inventing domain facts, requirements, acceptance semantics, architecture or unconfirmed assumptions. A needed new fact or decision returns to refinement before artifact work resumes. Return at the spec-only endpoint.
- **Inspected sources:** [config.ts](../../packages/pi-open-tui/src/config.ts) owns defaults, normalization and persistence; [settings-command.ts](../../packages/pi-open-tui/src/settings-command.ts) currently splits `messageLayout`, Tool enhancement and Tool borders across tabs; [user-message-layout.ts](../../packages/pi-open-tui/src/user-message-layout.ts) applies compact presentation to User and Skill components; [tool-presentation.ts](../../packages/pi-open-tui/src/tool-presentation.ts) (`frame`) also uses the same `messageLayout` for Tool rails; [message-layout.ts](../../packages/pi-open-tui/src/message-layout.ts) implements current rails/three-sided frames and display-column handling. These reads are source evidence, not implementation acceptance or a test run.
- **Default snapshot source:** `C:/Users/Derek Wang/.pi/agent/open-tui.json`, read and rechecked on 2026-10-13. Section R5 embeds its values so later work does not depend on rereading that personal file or on subsequent local edits. The snapshot is not permission to modify the personal file.

## Requirements

### R1 — Separate configuration ownership and discoverable settings

- Expose User/Skill presentation settings separately from Tool call/result presentation settings in `/open-tui`.
- User/Skill changes must not implicitly alter Tool presentation. Tool changes must not implicitly alter User/Skill presentation. Skill cards belong to the User side, not an omitted case or a Tool setting.
- Replace the ambiguous shared Appearance message-layout control with clearly scoped configuration. A renamed UI backed by the same shared behavior switch is insufficient.
- Provide each group with its own presentation selection and border controls. Retain the Tool enhancement/native escape hatch from Spec 0011; do not confuse it with merely enabling/disabling decorative borders.
- Settings refinement: Tools must begin with independent enhancement and compression On/Off switches, followed by a border-style selector including Off; when Off, hide all subsequent border options without deleting saved preferences. User/Skill must combine its layout/frame activation into one enable switch: Off restores native presentation and hides all other options; On exposes that group’s style/edge/color controls. Preserve the existing effective appearance until an explicit settings edit.
- Labels must identify the affected scope and effects; settings text must support the existing English and Chinese languages. Exact tab titles, tab ordering and config key spelling are not prescribed.
- Existing global enable and icon settings may still apply globally; category independence does not mean removing those established global controls.

**Trace:** H2; ADR 0023; settings-command.ts; both current presentation paths.

### R2 — Comparable border capabilities for User, Skill and Tool

- Both configuration groups support independently enabled top, bottom, left and right edges. Every edge supports its own character override.
- Provide the existing line style/weight presets (`single`, `bold`, `double`, `dashed`, `custom`) for both groups. Support custom symbols without losing the ability to use preset glyphs on non-overridden edges.
- Right edges are optional, not mandatory closure. Users can select a left rail, a three-sided open frame, a complete frame, or other supported edge combinations through the independent edge controls.
- When adjoining edges are enabled, preset corners/junctions connect without gaps. Custom symbols remain subject to display-column-safe validation; exact override/junction representation is an implementation detail.
- User settings apply to both ordinary User messages and Skill invocation cards, including border visibility, line style, characters and color customization. Their content-specific renderers and interactions remain distinct under R4.
- Tool framing remains one visual unit around the call header and result output, not two separately closed cards or a new transcript entry.

**Trace:** H1–H3; existing edge/character controls; ADR 0023; original single-card Tool requirement.

### R3 — Color semantics

- Each group has independent configurable border/rail color, including fixed theme-color selection.
- Tool borders retain status-based coloring for running, successful and failed calls, as well as fixed-color mode. Use reliable host execution status, not output-text inference.
- User/Skill customization must not derive its colors from an unrelated Tool's execution state. Preserve current User/Skill theme colors in the default appearance under R5.
- Fixed Tool color applies when fixed-color mode is selected, not while status-based coloring is active. Scope/mode labels must not imply otherwise.

**Trace:** H1–H2; tool-presentation.ts status/static handling; user-message-layout.ts User/Skill theme handling; Spec 0011's status-evidence requirements.

### R4 — Content, interactions and layout safety

- Preserve User Markdown/content transformation and native message markers, Skill content and click-to-expand/collapse behavior, and the Tool detailed renderers, controls, images and important metadata required by Spec 0011.
- Assistant output and thinking preview are not restyled by either category's settings. This is presentation-only work: do not mutate transcript/model-facing content, tool execution, permissions or outcomes.
- Enabled edges fit inside the available terminal columns. Account for the width of both vertical edges and any content inset before rendering/wrapping the body; right edges must not be pushed out of the frame by long text.
- Keep right edges and corners aligned after content expansion and terminal resize. Use display-column-aware widths for Chinese, wide/combining characters and emoji; do not assume JavaScript string length equals visible width.
- Border decoration must not corrupt image protocol rows or remove access to images. Preserve native image behavior rather than treating protocol payloads as ordinary padded text.
- Maintain correct mouse/focus routing after adding top/left/right insets so Skill and specialized Tool controls remain usable.
- Retain unsupported-host/native fallback, restoration on mode-off/disable/cleanup, and public Tool versus instance-local User integration boundaries from ADRs 0018–0020. New decoration does not authorize private Tool-component patches.

**Trace:** H1's width safety; H2–H3; ADRs 0018–0020; Spec 0011 R3/R4; inspected User/Skill and frame composition.

### R5 — New default baseline is the captured current configuration

- Use the following snapshot as the new-install default baseline. Its legacy field names describe the source configuration, not a requirement to retain the shared `messageLayout` key in the new independent schema.
- Translate that baseline into independent User/Skill and Tool settings without changing its effective appearance: both currently use compact left-rail presentation; the Tool decorative box is disabled. In non-ASCII mode, the current visible rail is `┃`; explicit ASCII mode uses `|`. User rail uses `userMessageText`, Skill rail uses `accent`, and Tool rail follows execution status.
- Preserve the captured Tool box options even though its box is disabled: double line, status colors, top on, bottom off, left on, no explicit character overrides. Do not activate a double-line frame merely because `style` is `double`.
- New right-edge options default to off for both groups, matching the captured appearance's lack of a right border. User/Skill defaults must not introduce top/bottom borders or change current User/Skill spacing.
- Preserve the rest of the captured default values below, including bar cursor, minimal editor border and Workline not attached to the border. This baseline does not authorize unrelated new functionality.

```json
{
  "enabled": true,
  "inlineFooter": false,
  "settingsLanguage": "en",
  "cursorStyle": "bar",
  "editorBorderStyle": "minimal",
  "icons": { "mode": "auto" },
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
  "workline": { "marquee": true, "attachToBorder": false },
  "thinkingPeek": { "lines": 1 },
  "toolPresentation": true,
  "messageLayout": "compact",
  "toolBoxBorder": {
    "enabled": false,
    "style": "double",
    "colorMode": "status",
    "top": { "enabled": true },
    "bottom": { "enabled": false },
    "left": { "enabled": true }
  }
}
```

**Trace:** H4; verified personal configuration snapshot; current compact rails and Tool frame precedence. Unused new User option values are not inferred from the Tool's saved double-line setting; only preservation of the existing default User/Skill appearance is prescribed.

### R6 — Upgrades do not change existing user configuration

- Installing/upgrading, starting or reloading the extension must not overwrite, automatically rewrite or backfill an existing configuration file to introduce new defaults or independent keys. Without an explicit settings change, the existing file remains unchanged.
- Preserve effective existing preferences and appearance, including unrelated settings, unknown retained fields, disabled states, saved custom characters, fixed/status colors and dormant border choices.
- Interpret legacy settings compatibly without requiring an automatic file migration. Existing `messageLayout` must continue to reproduce its former User/Skill and Tool effects until the user explicitly changes category settings. Preserve the former priority of an enabled Tool box over the compact Tool rail.
- Partial legacy configurations must retain their pre-upgrade interpretation. Missing fields in an existing file must not silently acquire changed new-install defaults that alter its previous appearance/preferences. In particular, absence of the new right-edge options must not create a right border.
- Once the user explicitly changes one category's settings, the change may be persisted through the normal settings workflow, but must not change the other category's effective settings or unrelated preferences. Subsequent restarts must retain that independent choice.
- The captured new default baseline applies to installations without an existing configuration, not as an upgrade policy for users who already have one. Persistence/save-failure feedback remains consistent with the existing settings workflow.

**Trace:** H4's explicit upgrade constraint; ADR 0023; config.ts normalization/persistence and existing legacy fields; Spec 0011 R7.

## Solution

Separate the User/Skill and Tool preference contracts while preserving their established renderer integration boundaries. Both consume comparable edge/style/color options; User and Skill retain their own content and interaction handling, while Tool calls/results retain public renderer composition and single-card ownership. New-install defaults translate the embedded baseline into independent presentation choices. Legacy configuration is interpreted compatibly without a startup rewrite or applying the changed default baseline to existing users. Internal schema, helper reuse and module organization are not mandated.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Settings ownership | `/open-tui` → independent User/Skill and Tool preferences | Clearly scoped controls and explicit user changes | Changes only the selected group; preserves other preferences and normal save feedback |
| Configuration compatibility | Existing config/new-install snapshot → effective preferences | Legacy fields, partial files, new independent selections and file-existence distinction | Old appearance without rewriting existing files; captured defaults only for new installations |
| User/Skill presentation | User-side preferences → User and Skill components | Content, theme, available width and native interactions/markers | Comparable four-edge customization for both component types; intact Skill expansion and User content |
| Tool presentation | Tool-side preferences + public host renderer chain → call/result card | Existing renderers, execution evidence, detailed content, theme and width | Independent four-edge card decoration and status/static colors with preserved renderer capabilities |
| Frame geometry/input | Selected edges/symbols + real component → rendered rows and input routing | Display-column widths, resize, expansion and opaque image rows | Width-safe borders/corners and usable child interactions without flattening content |

## End-to-End Tests

These are future acceptance scenarios, not tests run during refinement.

### E1 — Independent User/Skill and Tool settings
- **Given:** A transcript contains ordinary User messages, a Skill invocation card, Tool call/results and an Assistant reply.
- **When:** The user changes User-side line style, edge selection and color, then independently changes Tool-side settings.
- **Then:** The first change affects ordinary User and Skill cards only; the second affects Tool cards only. Assistant presentation/content is unchanged. Reload retains both independent selections.

### E2 — Optional four-edge frames and custom characters
- **Given:** Each group has its four-edge controls available.
- **When:** Enable all edges, then disable right/bottom independently; configure a right-edge symbol and a symbol on another edge.
- **Then:** User, Skill and Tool presentations honor their own edge/symbol choices; full-frame preset corners connect, open configurations omit disabled edges, and Tool call/result sections form one card. Existing presets/custom overrides remain usable.

### E3 — Skill interactions and specialized Tool content
- **Given:** A Skill card can expand/collapse and a Tool renderer has controls, detailed content or imagery.
- **When:** Apply four-sided decoration and activate the original controls, including after resizing.
- **Then:** Skill content/expansion and Tool functionality remain accessible; input coordinates remain correct, image rows are not corrupted, and presentation does not replace execution or transcript content.

### E4 — New installation matches the captured default
- **Given:** No existing Open TUI configuration file.
- **When:** The upgraded extension initializes and renders User, Skill and Tool messages.
- **Then:** Effective settings match R5's snapshot translated into independent categories. The compact left-rail appearance remains, with no new top/bottom/right User/Skill borders and no Tool double-line box. Bar cursor, minimal editor border, detached Workline and the remaining captured preferences match the baseline.

### E5 — Existing customized configuration survives upgrade untouched
- **Given:** Existing configurations include the captured baseline, normal and compact modes, enabled/disabled Tool boxes, custom glyphs, fixed/status colors, disabled enhancement and unrelated/unknown preferences.
- **When:** Upgrade, start and reload without editing settings.
- **Then:** Existing configuration bytes and effective preferences remain unchanged; dormant box options stay dormant, active legacy boxes keep their priority, no right border appears, and new-install defaults do not replace user choices.

### E6 — Partial legacy configuration does not receive changed defaults
- **Given:** A valid existing partial legacy file omits fields whose new defaults differ from the previous defaults, as well as all new independent/right-edge fields.
- **When:** The upgraded extension loads it without settings edits.
- **Then:** Its former effective appearance/preferences are retained, no migration writes occur, and missing fields do not acquire the captured new-install baseline merely because it is now the default.

### E7 — First explicit independent edit and save feedback
- **Given:** A legacy file still drives both groups compatibly.
- **When:** The user explicitly changes one category, saves and restarts; separately exercise a failed save through the normal settings path.
- **Then:** The selected category changes and persists on successful save, while the other category and unrelated preferences remain equivalent to their prior settings. Failed saves retain the existing persistence feedback and do not masquerade as a successful persisted upgrade.

### E8 — Colors, width, fallback and lifecycle
- **Given:** Long Chinese/emoji/combining-character content, a narrow terminal, ASCII/non-ASCII modes, User/Skill cards and running/completed/failed Tool calls.
- **When:** Toggle right edges, expand content, resize/change theme, switch Tool status/fixed color mode, disable the extension or use an unsupported host.
- **Then:** Frames stay within available columns; right edges/corners align on text rows; status-based Tool colors and independent fixed selections work; User/Skill colors do not follow Tool status. Existing native fallback and cleanup/restoration remain intact, without private Tool-component patches.

## Decisions

- **Independent User/Skill versus Tool settings:** H2 and ADR 0023 replace the shared behavior control; Skill belongs to the User-side scope.
- **Four optional edges:** H3 replaces the earlier three-sided-only geometry, rather than enabling a right edge by default.
- **Captured active configuration as new defaults:** H4 and the verified snapshot replace repository-default assumptions. Saved double-line settings must not be confused with the currently visible compact rail.
- **No upgrade override or automatic rewrite:** H4 separates adoption of new defaults from compatibility for existing users, including partial legacy files.
- **One continuing contract:** Expand Spec 0013 rather than split User/Skill, Tool geometry, defaults and upgrade compatibility into separate specs; they share the same configuration-change lifecycle. Spec 0011 continues to govern universal Tool coverage, content preservation and host integration.

## Verification guidance and limitations

- Check actual settings-to-renderer integration and persistence, not just frame string snapshots. Include ordinary User and Skill components with real expansion/input routing, Tool call/result pairing, specialized renderer capabilities and legacy/new-install config cases.
- Verify existing-file bytes before/after upgrade/start/reload and semantic preference equality; include the partial-file case to catch changed fallback defaults.
- Use supported-host and incompatible-host fixtures for the ADR boundaries, plus live terminal checks for width, corners, scrolling, image display and Skill interaction. Automated source inspection alone does not prove font/terminal appearance.
- Exact new schema names, inactive User option defaults not affecting the captured appearance, control grouping/ordering, and custom-corner encoding remain implementation details. No live preview redesign, additional Skill-only settings group, new User execution-state semantics or numeric performance threshold is assumed as an accepted requirement.
- The requirements contract is complete for the selected endpoint; production/test changes and QA are not performed or claimed.

## Out of Scope

- Assistant message or thinking-preview restyling; changing model-facing content, execution, permissions, usage or transcript ownership.
- Private Tool-component patches, installed host-file changes, global prototype changes or dependencies between Open TUI and pi-delegate.
- Interactive border dragging/mouse resizing, a new raw nested-result archive, or changes to Spec 0011's codemode data/outcome semantics.
- Automatically replacing existing users' preferences with the new default snapshot.
- Ticket decomposition, implementation planning, code/test edits, dependency installation or QA execution in this spec-only stage.
