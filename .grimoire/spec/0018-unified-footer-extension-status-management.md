# Unified Footer extension status management

**Spec ID:** 0018
**Status:** Draft
**Date:** 2026-11-10
**Sources:** Accepted refinement contract H1–H4 below; inspected source and existing constraints S1–S4.

## Source and coordination boundary

- **H1 — Scope:** After installing `pi-usage`, the user reported a three-row bottom status area and asked to bring third-party extension additions under `packages/pi-open-tui/` management. The user selected the recommended scope: unify Footer status items published through `setStatus()`, including future extensions using that interface; do not take over independent Widgets or whole-Footer replacements.
- **H2 — Accepted behavior:** The user accepted a two-row default with third-party statuses placed in the second row; automatic discovery in `/open-tui`; per-item visibility, row and priority controls; priority-based folding with a `+N` indicator and full content available through a panel instead of automatic extra rows; preservation of extension colors, data updates and meaning; and default preference for existing built-in information over newly discovered third-party statuses. No per-extension adapter is required for generic coverage.
- **H3 — Compatibility clarification:** The user accepted two further rules: new installations default to the unified two-row layout, while existing users retain their effective display until explicitly enabling the unified layout in `/open-tui`; with `inlineFooter`, logical row one maps to the top editor border and row two to the bottom border, including third-party statuses and overflow indication, without an additional status row.
- **H4 — Endpoint and permissions:** The user selected one Spec only, with no tickets, implementation plan, code changes or QA execution, and no CONTEXT/ADR changes. Refine executes the spec specialist inline with this handoff. Consume settled requirements and established choices only; organize and express them without inventing domain facts, requirements, constraints, acceptance semantics, architecture or unconfirmed assumptions. Trace meaningful claims to this contract or verified sources. Return any needed new fact or decision to refinement before resuming artifact work. Do not retrospectively record invented choices or invoke downstream workflows. Return at the Spec endpoint.
- **S1 — Current Footer:** [footer.ts](../../packages/pi-open-tui/src/footer.ts) reads `footerData.getExtensionStatuses()`, sorts status keys, sanitizes their text while retaining styles, and wraps them into separate rows after the two main rows. In inline mode, the main rows enter the editor borders but extension status rows remain separate. This is evidence of the current behavior, not acceptance of the new behavior.
- **S2 — Configuration and UI:** [config.ts](../../packages/pi-open-tui/src/config.ts), [settings-command.ts](../../packages/pi-open-tui/src/settings-command.ts), and the [README](../../packages/pi-open-tui/README.md#configuration) expose `inlineFooter` and the aggregate `footerSegments.extensionStatuses` switch, but not per-status layout controls. Existing configuration handling preserves unknown fields and existing preferences; explicit edits persist through the current settings mechanism. Read-only inspection of the user's `~/.pi/agent/open-tui.json` found `inlineFooter: false` and `extensionStatuses: true`.
- **S3 — Host and example producer:** Installed Pi documentation at `C:/Users/Derek Wang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` describes `setStatus(key, text)` and clearing with `undefined`, with those statuses supplied to a custom Footer. It documents Widgets and whole-Footer replacement as separate interfaces. Installed `@narumitw/pi-usage` 0.69.2 at `C:/Users/Derek Wang/.pi/agent/npm/node_modules/@narumitw/pi-usage/` documents a text-only `usage` status item; `src/usage.ts` publishes it through `ctx.ui.setStatus(STATUS_KEY, value)`. This is local inspection evidence, not a portability guarantee for every version or a live UI test.
- **S4 — Existing constraints:** [ADR 0023](../adr/0023-independent-user-and-tool-presentation-configuration.md) requires preservation of existing configuration and effective presentation on upgrade. [ADR 0025](../adr/0025-shared-open-tui-ui-refresh-ownership.md) excludes taking over third-party timers or external-data polling. [Package guidelines](../../packages/pi-open-tui/AGENTS.md) require package independence and aligned English/Chinese README documentation. [CONTEXT](../CONTEXT.md) defines the existing shared UI refresh ownership, not a general third-party UI manager.

## Requirements

### R1 — Generic discovery and presentation ownership

- While Open TUI owns the Footer, automatically consume all current status entries provided through Pi's standard `setStatus()` channel. Coverage must not depend on a producer-name allowlist, importing `pi-usage`, or adding a dedicated adapter for each new extension.
- Treat the host-provided status key as the item identity available for management. The interface supplies keyed text, not verified package identity or structured usage fields; do not infer these from the key or content.
- Reflect publication, replacement and clearing of status values. Clearing a host status must remove its current Footer content and its contribution to overflow; do not retain an old value as though it were still published.
- Own presentation only. Do not change third-party fetching, refresh intervals, timers, credentials, commands or reported usage semantics. Hiding an item must not disable its producer.

**Trace:** H1–H2, S1–S3; S4/ADR 0025.

### R2 — Unified two-row layout

- With unified layout active and `inlineFooter` disabled, keep Footer presentation within the existing two main rows. New, longer or more numerous extension statuses must not create a third Footer row or wrap onto additional rows.
- Newly discovered third-party items default to the second logical row. Preserve the existing built-in information's priority by default rather than allowing new statuses to displace it first.
- Respect configured item visibility, row and priority. When a selected row cannot accommodate all eligible content, fold lower-priority third-party items instead of automatically increasing height. Folded content remains accessible under R4.
- Account for separators, styling and the overflow indicator within the available display-column width. Preserve existing width-safe handling of built-in content; the two-row contract does not promise that all built-in information can remain visible at every width.
- The row budget describes the Footer, not unrelated Widgets, Workline, dialogs or transcript content.

**Trace:** H1–H2; S1–S2/current Footer boundaries and width handling.

### R3 — Item management in `/open-tui`

- Automatically list discovered status items in `/open-tui` without requiring manual registration. Expose independently editable visibility, logical row (first or second), and priority for each item.
- Changes must affect the managed Footer and use the existing Open TUI preference persistence behavior. Successfully saved choices must survive reload and apply to the same status key when it is published again; changes must not alter another item's preference.
- Preserve the existing aggregate extension-status switch as a visibility control, rather than silently turning a previously disabled status group back on. Per-item controls do not override an explicit group-wide hide.
- Expose explicit activation of unified layout for existing users. Do not require them to edit JSON merely to enable the feature or manage discovered items.

**Trace:** H2–H3; S2/settings persistence and aggregate visibility; S4/ADR 0023.

### R4 — Visible overflow and recoverable content

- Indicate priority-folded status items with `+N`, where `N` is the number of eligible current status items omitted for lack of space, not characters, rows, inactive producers or intentionally hidden items.
- Provide a discoverable panel entry through `/open-tui` for viewing the full currently published content of folded items. It must remain reachable even when terminal width leaves insufficient room for a useful Footer indicator; do not add a row to solve that case.
- The panel must identify items by their available status keys and expose content omitted by Footer compaction. It may use normal panel navigation/scrolling to make long content accessible rather than applying the same Footer clipping limit.
- Preserve producer-applied colors and text meaning. Retain the existing terminal-control sanitization boundary; full-content access does not authorize executing arbitrary terminal control sequences or reconstructing data the producer never published.
- Do not parse percentages, balances or quota text to create provider-specific abbreviations, new units or inferred urgency. Generic priority is a presentation preference, not a claim about the status's business meaning.

**Trace:** H2; S1/status style and sanitization handling; S3/text-only producer contract.

### R5 — Existing-user preservation and inline mode

- New installations default to unified layout. Existing installations must retain their current effective layout on upgrade/startup/reload until the user explicitly enables unified layout in `/open-tui`; do not rewrite old files or implicitly change their display merely because the new preference is absent.
- Before that opt-in, existing separate extension-status rows and their wrapping behavior remain compatible. The no-extra-row requirement applies after unified layout activation, not retroactively to legacy behavior.
- Preserve unrelated preferences and the existing aggregate status visibility choice when enabling unified layout. A successful explicit save persists the selection through the current configuration mechanism.
- With unified layout and `inlineFooter` both enabled, logical row one occupies the editor's top border and logical row two its bottom border. Apply status placement, priorities and overflow within those border budgets; do not also emit extension status rows below the editor.
- Changing inline mode changes where the two logical rows are rendered, not the producer's data or the item's configured logical-row selection. Folded details remain accessible through the panel in either mode.

**Trace:** H3; S1–S2/inline behavior and persistence; S4/ADR 0023. This requirement preserves, rather than supersedes, that ADR.

## Solution and integration contracts

Integrate keyed third-party status text into Open TUI's existing Footer layout and settings ownership. Producers remain data owners; the host status collection remains the input. The unified mode shares two logical rows with built-in content and exposes preferences plus full-content viewing through `/open-tui`. Legacy layout remains the effective choice for existing users until explicit activation.

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Status publication | Third-party extensions → Pi → Open TUI Footer | Current keyed text, including styles; host clearing/replacement behavior | Generic discovery and presentation without per-producer integration or semantic parsing |
| Item preferences | `/open-tui` ↔ Open TUI configuration | Explicit visibility, logical row, priority and layout activation choices | Immediate presentation changes and existing successful-save/reload behavior without changing unrelated preferences |
| Layout | Built-in Footer content + eligible statuses → regular Footer or editor borders | Available display width, two logical rows and effective preferences | Bounded presentation, default built-in preference, priority folding and no extra status row in unified mode |
| Detail access | Current status collection + folded-item identities → panel | Available published text and keys | Recoverable full content independent of Footer clipping, without a provider query or invented data |

Exact configuration key spelling, priority control representation, tie-breaking among equal priorities, panel component structure and module organization are implementation details, not additional approved product requirements. They must remain consistent with the observable contracts above. No new numeric refresh cadence or performance threshold is established.

## End-to-End Tests

### E1 — A new installation receives usage without an extra row
- **Given:** A new installation with Open TUI owning the Footer and enough width for its normal built-in content plus a short published `usage` status.
- **When:** A producer publishes that status through `setStatus()`.
- **Then:** Unified layout is active by default; the item is automatically listed in `/open-tui`, appears in the second Footer row, and does not create a third row. Its supplied text and colors are retained.

### E2 — Unfamiliar extensions require no integration work
- **Given:** Unified layout is active and two unrelated, previously unseen status keys are published.
- **When:** The user opens `/open-tui`, hides one item, moves the other to row one, changes its priority and successfully saves.
- **Then:** Both were discovered without an allowlist or provider adapter; each change affects the intended item independently. After reload and republication of the same keys, the saved preferences still apply. Hidden-item publication continues without being shown in the Footer.

### E3 — Overflow remains bounded and inspectable
- **Given:** Built-in content plus several eligible third-party statuses cannot fit the selected row, and the row can display an overflow indicator.
- **When:** The Footer renders or the terminal becomes narrower.
- **Then:** Default settings preserve built-in information ahead of third-party items; lower-priority status items fold, `+N` reports the omitted eligible items, and no third row appears. Opening the detail panel exposes their full available text, including content not shown in the Footer. Intentionally hidden items do not inflate `N`.
- **Also verify:** At widths too small for a useful indicator, the Footer remains width-bounded and the panel remains accessible through `/open-tui` without relying on that indicator.

### E4 — Producer updates and clears remain authoritative
- **Given:** A visible or folded status already exists in unified layout.
- **When:** Its producer replaces its text and later clears it with `undefined`.
- **Then:** Subsequent Footer and panel views reflect the replacement, then remove the current cleared value and its overflow contribution. Open TUI does not request provider data or take over the producer's refresh timer to accomplish layout management.

### E5 — Existing users explicitly opt in
- **Given:** An existing configuration predating unified layout, with separate extension rows and unrelated saved presentation preferences.
- **When:** The extension is upgraded or reloaded without an explicit settings edit.
- **Then:** Its effective legacy layout and saved configuration remain unchanged.
- **When:** The user explicitly enables unified layout in `/open-tui` and successfully saves.
- **Then:** Status items join the two main rows, unrelated preferences remain unchanged, and the selected layout survives reload. A previously disabled aggregate extension-status switch remains disabled rather than being reset.

### E6 — Inline borders use the same logical rows
- **Given:** Unified layout is active with status items assigned to both logical rows, including enough content to cause overflow.
- **When:** The user enables `inlineFooter` and changes terminal width.
- **Then:** First-row items occupy the top border, second-row items occupy the bottom border, and priorities/overflow fit the border budgets without a separate extension-status row below the editor. Full folded content remains available in the panel. Returning to regular Footer mode retains each item's logical-row preference.

### E7 — Presentation preserves text, style and scope
- **Given:** Status text contains producer colors, plain text, wide/combining characters and terminal-control content; a separate extension also owns an independent Widget.
- **When:** Unified layout renders, folds and displays the status in its detail panel.
- **Then:** Text meaning and supported colors survive safe rendering; display widths and the two-row budget are respected; unsafe controls do not escape the existing sanitization boundary. The Widget is not claimed as managed content or counted against the Footer's two rows.

## Decisions

- **Generic status channel, not a `pi-usage` adapter:** H1–H2 select future coverage through the same public status interface. S3 confirms the reported producer uses that channel.
- **Bounded rows with recoverable overflow:** H2 selects two rows, item priorities, `+N` and a full-content panel instead of automatic line growth or silent content loss.
- **Explicit adoption for existing users:** H3 resolves the compatibility question consistently with ADR 0023; new defaults do not overwrite existing effective presentation.
- **Logical rows shared with inline borders:** H3 extends the accepted layout to the existing inline mode rather than silently ignoring it or adding separate status rows.
- **Presentation ownership only:** H2 and ADR 0025 preserve producer data semantics and refresh ownership. This Spec does not extend the shared UI scheduler to external timers.

## Verification boundary and handoff

Verify status publication through the supported host boundary, `/open-tui` edits and detail access, successful-save/reload behavior, legacy/new-install configuration cases, and both regular and inline rendering. Include width and style fixtures and a live terminal check with `pi-usage` plus an unfamiliar status producer; provider network access is not needed to establish generic layout behavior with representative published text.

This refinement performed read-only source/configuration inspection and document verification only. It did not run tests, exercise the live terminal layout, modify installed packages or establish implementation completion. No blocking product choice remains. The host exposes status keys, not reliable package ownership; content already omitted by a producer cannot be recovered by this feature.

The selected endpoint is one Spec. CONTEXT/ADR writes were explicitly excluded. The accepted presentation-ownership and compatibility decisions are captured here; any separate durable knowledge recording remains pending authorization, not a blocker for this Spec. Do not create tickets, implement, or run QA without a subsequent user invocation.

## Out of Scope

- Managing arbitrary third-party Widgets, overlays, headers, or extensions that replace the entire Footer; resolving competing whole-Footer ownership.
- Editing `pi-usage`, using its provider-specific read-only API, changing its queries or credentials, or interpreting its billing values.
- Redesigning tool/message/Workline presentation, changing third-party timers, or coupling Open TUI to `pi-delegate`.
- A general extension installer, a registry of installed package identities, additional configurable Footer rows, or a per-provider status adapter framework.
- Implementation planning, ticket decomposition, code/test edits, dependency changes, QA execution, and CONTEXT/ADR updates in this refinement.
