# Universal tool presentation with specialized renderer composition

**Status:** Testing
**Date:** 2026-10-12
**Partially supersedes:** [ADR 0018](./0018-public-host-tool-renderer-composition.md), only its treatment of unknown schemas and specialized third-party renderers as a reason to retain an entirely unenhanced presentation.

## Context

The current Open TUI presentation resolver recognizes eight host-native tools and returns other renderers unchanged. The user rejected this coverage boundary: “All other tool calls must be covered too, not just these” (translated). They accepted the coordinator's “generic styling fallback + tool-specific enhancements” (translated) proposal with “Yes” (translated), selecting revision of Spec 0011 without implementation or ticket decomposition.

The accepted scope includes native tools, editing/search extensions, delegate tools, computer-use, MCP and other extension tools, including future tools without adding their names to a styling allowlist. Existing third-party renderers may carry useful output, images, controls or important metadata; universal styling must not discard these capabilities. Unknown schemas must not be interpreted using a familiar tool name alone.

Sources: the accepted conversation above; `packages/pi-open-tui/src/tool-presentation.ts` (`nativeRenderers`, renderer resolver and `compose`); `packages/pi-open-tui/src/index.ts` (registration and execution lifecycle); and [ADR 0018](./0018-public-host-tool-renderer-composition.md).

## Decision

- Provide a universal presentation layer for every tool call presented by the supported host when enhanced tool presentation is enabled. Tool/schema recognition selects additional tool-specific enhancements, not eligibility for basic styling.
- Use generic summaries of available arguments/results when semantics are unknown. Do not guess targets, commands, outcomes or meaningful result interpretations from tool names or arbitrary output.
- Compose with existing host and extension renderers so detailed output, images, controls, interactions and important metadata remain accessible. A specialized renderer is not an exemption from unified presentation, and unified presentation is not permission to flatten it into text or discard its capabilities.
- Preserve ADR 0018's public renderer API, presentation-only integration, independent-package boundary, unsupported-host fallback and native-presentation settings escape hatch.
- Apply unified child-row presentation to all host-observed codemode child records, while preserving parent ownership, outcome distinctions and the already accepted prohibition on additional raw child-result retention. Universal coverage does not create records or results absent from the host.

## Consequences

- Newly encountered tools receive generic styling without a per-name implementation prerequisite; dedicated optimizations may still rely on verified schemas.
- Requirements and acceptance scenarios for coverage, third-party capability preservation and codemode child rows belong in [Spec 0011](../spec/0011-open-tui-tool-call-presentation.md). The existing recognized-native-only implementation is not evidence of universal coverage.
- This supersedes only the exclusion-by-fallback interpretation of ADR 0018; its conservative semantic handling and other boundaries remain in force.
- No specific internal component design, new execution behavior, package coupling, full child-result archive or completed implementation/verification is established by this record.
