# Extension-owned multi-skill presentation

**Status:** Testing
**Date:** 2026-10-23

## Context

The user reported that, when invoking multiple skills in one message, only the first appears as a Pi skill card and later skill instructions appear inside the ordinary User message. Read-only inspection found that `packages/pi-dollar-skills/src/skills.ts` prepends multiple skill blocks to one message, while the installed Pi host's `parseSkillBlock()` and interactive User rendering recognize one leading skill block and render the remainder as ordinary User text.

The user accepted extension-owned cards matching Pi's native skill appearance and expand/collapse interaction, without requiring Pi's internal native component, and explicitly required Open TUI compatibility. The independent-extension and public-API boundaries in [ADR 0026](./0026-independent-dollar-skill-extension.md) remain unchanged.

Sources: this refinement conversation; `packages/pi-dollar-skills/src/skills.ts`; installed Pi `dist/core/agent-session.js` and `dist/modes/interactive/interactive-mode.js` under `C:/Users/Derek Wang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`. Host observations are local evidence, not a version-wide compatibility guarantee.

## Decision

- Permit extension-owned skill cards with Pi-native-style appearance and expand/collapse behavior; reuse of Pi's internal native skill component is not required.
- Keep the capability independently usable with native Pi and compatible with Open TUI, without making Open TUI a runtime prerequisite or replacing its active editor.
- Retain ADR 0026's public host API boundary and prohibition on modifying Pi source or installation files. Acceptance of native-style cards does not authorize private host-component coupling.

## Consequences

- Presentation work must address both native Pi and Open TUI rather than treating compatibility with either as evidence for the other.
- Display changes must preserve full skill instruction delivery, the surrounding request and attachments. Separate cards are a presentation choice, not permission to lose model-bound context.
- Interactive multi-skill submissions use one custom session message and the public message-renderer API, composing Pi's publicly exported `SkillInvocationMessageComponent` and `UserMessageComponent`. This keeps snapshots, the request and images together through queued delivery while allowing Open TUI to recognize the native component shapes. It does not require a private import or Open TUI runtime dependency.
- Pi converts this custom message to one model-facing User message. Session entries and input-hook semantics are nevertheless custom-message semantics; single-skill and non-TUI submissions retain ordinary input transformation. Integration differences and the lack of migration for older entries are documented in the package READMEs.
- Implementation evidence is in `packages/pi-dollar-skills/src/skill-message.ts` and `src/index.ts`; `tests/host.integration.test.ts` and `tests/skill-message.test.ts` cover provider delivery, native cards and the actual Open TUI layout adapter on regular/fullscreen host renderers. Real-terminal appearance and IME behavior still require local smoke testing.
