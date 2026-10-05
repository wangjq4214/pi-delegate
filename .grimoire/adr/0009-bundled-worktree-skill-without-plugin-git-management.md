# Bundle a worktree skill without plugin-owned Git management

**Status:** Proposed
**Date:** 2026-10-04

## Context

[ADR 0007](./0007-external-worktree-lifecycle-and-parent-integration.md) keeps worktree lifecycle management outside the plugin runtime and integration with the parent agent. [ADR 0008](./0008-generic-per-delegation-working-directory.md) adds a generic optional child working-directory selection.

The remaining distribution choice was whether the worktree skill should be provided with pi-delegate or maintained separately. The user selected providing it together and accepted the recommended defaults with "一起提供，剩下的按照推荐就可以". This follows the explicit exclusion of scope-conflict warnings, permission controls and an OS sandbox from the current delivery scope.

Sources:

- This refinement conversation: the recommendation to distribute the skill with the package while keeping Git operations out of plugin code, and the user's acceptance.
- `package.json`: the current Pi manifest declares the extension but no skill resource.
- Installed Pi `docs/skills.md` and `docs/packages.md`: skills are instructions/supporting resources and can be distributed alongside extensions in a Pi package.
- ADRs 0007 and 0008: the existing runtime/skill/parent responsibility boundaries.

## Decision

- Provide the worktree skill alongside the pi-delegate extension and distribute it through the same Pi package.
- Keep the skill as a parent-agent workflow rather than plugin runtime orchestration. Bundling it does not introduce plugin-owned worktree creation, removal or Git merge operations.
- Use the generic `cwd` capability as the handoff from an externally prepared worktree to delegated execution. Keep review, integration and workspace lifecycle decisions with the parent agent following the skill.

This distribution decision is additive to ADRs 0007 and 0008 and does not supersede their responsibility boundaries.

## Consequences

- The package's skill resource must be discoverable through normal Pi skill loading, alongside the extension.
- Users receive the worktree workflow without a separate skill installation, while the plugin runtime remains independent of worktree-specific Git management.
- Runtime process/snapshot cleanup must not be confused with skill-managed workspace cleanup.
- Accepted path-validation, modification-report and worktree-lifecycle requirements belong in the selected requirements contract rather than additional context definitions or ADRs.

## Requirements contract (2026-10-05)

[Spec 0008 — Delegation working directory and bundled worktree skill](../spec/0008-delegation-cwd-and-bundled-worktree-skill.md) covers package discoverability and the parent/child workspace-reporting workflow alongside the generic directory capability. The skill and plugin changes remain unimplemented; this record stays Proposed.
