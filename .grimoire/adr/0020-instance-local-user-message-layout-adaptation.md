# Instance-local User message layout adaptation

**Status:** Testing
**Date:** 2026-10-12

## Context

The user accepted an optional compact layout for User and Tool messages while retaining normal Assistant output and space between messages. Inspection of Pi 1.1.0 found public tool renderer composition with self-rendered shells, but no public replacement renderer for ordinary User messages. Custom-message renderer registration does not cover ordinary User messages.

The coordinator proposed a recoverable adapter limited to the current TUI instance, with no installed-file or global-prototype changes, native fallback on incompatible hosts, and restoration on mode-off, disable and reload. The user explicitly accepted this compatibility approach with “Accepted” (translated).

Sources: the accepted conversation; `packages/pi-open-tui/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`; the inspected host's `dist/modes/interactive/components/user-message.js`; and [ADR 0018](./0018-public-host-tool-renderer-composition.md).

## Decision

- Permit an isolated, reversible instance-local compatibility adapter for ordinary User message layout until a suitable public host seam is available. Preserve native message content, Markdown transformation and terminal message markers; change presentation only.
- Do not modify Pi source or installation files, global prototypes, transcript/model-facing messages, or Assistant presentation. Restore native User rendering on mode-off, disable and cleanup. Incompatibility must warn and retain native rendering without interrupting execution.
- Tool presentation continues through the public renderer API. This User-specific permission does not relax ADR 0018's prohibition on private tool-component patches or authorize additional cursor/output adaptation.

## Consequences

- User layout depends on inspected non-public component structure and requires host-version compatibility verification. Shape/capability checks and native fallback are necessary; the decision does not promise compatibility with every future host.
- Ordinary layout preferences and acceptance details remain in the task contract and package documentation, not this architectural record. Actual terminal/font appearance still requires interactive evidence.
