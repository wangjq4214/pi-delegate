# Dollar skill selection and injection

**Spec ID:** 0015
**Status:** Implemented
**Date:** 2026-10-23
**Sources:** The user requested a new extension where `/` does not list skills and `$` injects skills, described it as Codex-like, and confirmed the proposed interaction and multi-skill support. Architectural boundaries are recorded in [ADR 0026](../adr/0026-independent-dollar-skill-extension.md).

## Requirements

1. Deliver the capability as a new independent Pi extension, usable without pi-delegate or Open TUI.
2. In the interactive editor, `/` command suggestions must omit skill entries while retaining ordinary commands. Hiding suggestions must not unload skills or remove Pi's automatic skill-matching capability.
3. Typing `$` must offer available skills with their names and descriptions. Continuing to type a skill name must filter the candidates.
4. Accepting a candidate must insert a `$skill-name` reference into the editor, allowing the user to continue composing the request. Selection alone must not submit the request.
5. Skill references must work both at the start of a message and within its prose, for example `用 $grimoire-review 检查这些修改`.
6. Submitting a message containing a skill reference must load the corresponding skill's full instructions and inject them into the context delivered to the model, along with its location so relative references can be resolved. Merely passing the name or asking the model to locate the skill does not satisfy this requirement.
7. A single message must support references to multiple skills. Each referenced skill's instructions and location must reach the model together with the user's request.
8. Preserve the user's surrounding request and attached images while preparing skill context.
9. Do not modify Pi host source or installed files, or replace the active editor. The capability must coexist with both the native editor and Open TUI through public host extension APIs.

Requirements 1–7 and 9 trace to the confirmed conversation proposal. Requirement 8 preserves the original input through the confirmed injection behavior; injection is not permission to discard the user's request or attachments.

## Solution

Compose skill discovery with the host's existing autocomplete behavior: remove skill candidates from slash suggestions and supply skill candidates for `$` references. Accepted candidates remain readable references while the user edits. At submission, resolve referenced skills and include their complete instructions and locations in model-bound context without losing the surrounding request.

Use the skills available to the current Pi session rather than treating hiding slash suggestions as disabling the skill resource system. Public autocomplete composition and input preparation are the established extension seams; this contract does not prescribe incidental helper calls, a replacement editor, or a separate terminal renderer.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Skill discovery | Pi session → extension | Available skill identity, description and source location | Candidate metadata and resolution to the corresponding instructions |
| Autocomplete composition | Active editor / host provider ↔ extension | Current text, cursor and existing suggestions | Filtered slash suggestions, `$` skill candidates and insertion of the selected reference |
| Submission preparation | User input → extension → Pi/model context | Request text, skill references and optional images | Full referenced instructions with locations, retaining the user's request and images |
| Editor coexistence | Pi / Open TUI ↔ extension | Host-managed active editor | Skill interaction without replacing that editor |

## End-to-End Tests

### Slash discovery excludes only skills

- **Given:** An interactive session has available skills and ordinary slash commands.
- **When:** The user opens `/` command suggestions.
- **Then:** Skill entries are absent and ordinary commands remain available.
- **And:** The skills remain loaded and available to Pi's existing automatic matching mechanism.

### Dollar selection and continued composition

- **Given:** The session exposes multiple skills with names and descriptions.
- **When:** The user types `$`, then part of a skill name.
- **Then:** The editor offers skill candidates with names and descriptions and filters them according to the typed name.
- **When:** The user accepts a candidate.
- **Then:** A `$skill-name` reference is inserted, the user can continue typing, and no request has been submitted.

### Full injection on submission

- **Given:** An available skill has known instruction text and a source location.
- **When:** The user submits `$skill-name` followed by a request.
- **Then:** The actual model-bound context contains the full skill instructions, its location and the request, rather than just the reference or an instruction to find the file.

### Inline reference

- **Given:** `grimoire-review` is an available fixture skill.
- **When:** The user submits `用 $grimoire-review 检查这些修改`.
- **Then:** Its full instructions and location reach the model and the surrounding review request is preserved.

### Multiple skills and attachments

- **Given:** Two distinct available skills have distinguishable instructions and locations.
- **When:** The user submits one message containing references to both skills, surrounding prose and an attached image.
- **Then:** Both complete skill instruction sets and locations reach the model together with the user's request and image.

### Native editor and Open TUI coexistence

- **Given:** The extension is enabled first with the native editor, then in a session also using Open TUI.
- **When:** The user performs slash discovery, dollar selection, continued editing and submission in each session.
- **Then:** The same skill behavior is available without replacing the active editor or changing host source/install files.

## Decisions and Evidence

- **Independent extension and host boundary:** Confirmed by the user; see [ADR 0026](../adr/0026-independent-dollar-skill-extension.md). Existing packages remain independent under [ADR 0010](../adr/0010-independent-workspace-packages.md) and [ADR 0011](../adr/0011-import-upstream-open-tui-extension.md).
- **Full injection at submission, including inline and multiple references:** Confirmed conversation behavior, not a promise of complete Codex UI or syntax parity.
- **Discovery versus loading:** Installed Pi's `docs/skills.md` distinguishes command discovery from skill loading and documents `enableSkillCommands`. Hiding the menu is not evidence that skills have been disabled.
- **Public integration feasibility:** Read-only inspection of installed `@earendil-works/pi-coding-agent` 1.4.0 found `ctx.ui.addAutocompleteProvider()`, `pi.getCommands()` and the `input` transform hook in `dist/core/extensions/types.d.ts`. `dist/core/agent-session.js` supplies skill metadata through `getCommands()`. The shipped `examples/extensions/github-issue-autocomplete.ts` and `examples/extensions/input-transform.ts` demonstrate autocomplete composition and input transformation. `@earendil-works/pi-tui/dist/autocomplete.d.ts` includes autocomplete trigger-character support.
- **Evidence location:** The installed packages inspected above are under `C:/Users/Derek Wang/.bun/install/global/node_modules/@earendil-works/`. This is local feasibility evidence, not a portable dependency or a minimum-version commitment.

## Verification and Limitations

- Exercise the user's input through the editor and submission path, and inspect model-bound context. A unit test that returns a transformed string alone does not establish that submission delivers the instructions correctly.
- Verify autocomplete, normal editing and submission with both native Pi and Open TUI. These checks must not rely on replacing the editor under test.
- The workspace Open TUI package currently pins development SDKs to 1.1.0, while inspected installed Pi is 1.4.0. Supported versions must be verified against the APIs actually used; this spec does not claim the feature works across Open TUI's entire peer-dependency range.
- No unconfirmed assumption is used as an acceptance criterion. This contract defines the confirmed interaction, not every behavior of Codex.

## Out of Scope

- Implementing or modifying production code in this spec-only stage, creating implementation plans, or starting QA execution.
- Replacing Pi's editor, rewriting the Open TUI UI, or modifying host source/install files.
- Exhaustive Codex feature parity beyond the confirmed skill interaction.

This artifact does not authorize publishing a package or modifying the user's installed configuration.
