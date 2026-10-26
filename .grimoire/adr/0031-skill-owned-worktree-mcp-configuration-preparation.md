# Skill-owned preparation of local MCP configuration in worktrees

**Status:** Completed
**Date:** 2026-10-26

## Context

The user reported that delegation into a new worktree can fail when the parent project uses an untracked `.pi/mcp.json`. Read-only inspection of `../harbor` found a local MCP configuration defining `codegraph`, with `.pi/` ignored by Git. A worktree created from a commit does not include that ignored file. The current bundled worktree skill has no local MCP configuration preparation step, while child initialization requires inherited tools to be reconstructed and validated. The reported failure has not been reproduced in this refinement.

[ADR 0007](./0007-external-worktree-lifecycle-and-parent-integration.md) and [ADR 0009](./0009-bundled-worktree-skill-without-plugin-git-management.md) keep workspace preparation with the parent following the bundled skill. [Spec 0008](../spec/0008-delegation-cwd-and-bundled-worktree-skill.md) preserves native target-directory discovery/trust and prohibits implicit transfer of the main workspace's uncommitted changes.

The refinement offered A, explicit configuration preparation in the worktree skill, or B, automatic parent MCP configuration inheritance in the delegate runtime. The user selected A. Sources: this refinement conversation; `packages/pi-delegate/skills/delegate-worktree/SKILL.md`; `packages/pi-delegate/src/inheritance.ts`; `packages/pi-delegate/src/child.ts`; and installed Pi MCP/project-trust documentation.

## Decision

- Keep preparation of missing worktree-local MCP configuration with the parent agent following the bundled `delegate-worktree` skill, not automatic inheritance in the delegate runtime.
- Explicitly prepare the parent's `.pi/mcp.json` in the selected worktree when it is missing there. Do not overwrite an existing target configuration, copy the whole `.pi/` directory, or commit the configuration to Git.
- Check target-directory trust and relative-path semantics as part of preparation. Do not treat copying the file as proof that its servers will load or operate against the intended workspace.
- Treat this as a narrow, explicit runtime-configuration preparation step, not authorization to transfer arbitrary uncommitted source changes. Retain the other baseline-preservation and parent-owned workspace/integration boundaries.

## Consequences

- Projects need not track a personal/local MCP configuration merely to use this worktree workflow.
- Generic `delegate.cwd` behavior and child tool reconstruction/validation remain unchanged. Arbitrary directory overrides do not gain automatic configuration inheritance.
- Existing target configuration is preserved. Configuration incompatibility, trust, or path issues still require explicit handling; the selected approach does not promise to eliminate every MCP startup failure.
- The bounded task uses a settled handoff without a new spec or ticket set. At initial recording, the bundled skill had not been amended and no implementation or runtime verification had been performed. The implementation evidence below records subsequent delivery; the existing runtime architecture is not superseded.

## Implementation evidence (2026-10-26)

- `packages/pi-delegate/skills/delegate-worktree/SKILL.md` now includes an explicit pre-delegation MCP preparation step: missing-only copying, exclusive creation, preservation of existing configuration, local-only Git handling, path/trust checks, and unchanged inherited-tool validation. Its baseline guidance distinguishes this runtime setup from transfer of dirty source changes. No delegate runtime source was changed.
- `packages/pi-delegate/tests/delegate.integration.test.ts` exercises a disposable Git repository with an ignored project MCP configuration and a path containing spaces. A real Pi RPC child fails before original-task execution without that file; after explicit preparation, a fresh child reconstructs and calls the local stdio MCP server. The test also checks no user-level fallback, unchanged main workspace/source configuration, no unrelated settings or dirty-source copying, an untracked/ignored target configuration, and non-overwriting exclusive-copy behavior. `tests/worktree-skill.test.ts` guards the packaged instructions.
- From `packages/pi-delegate`, `bun test tests/delegate.integration.test.ts tests/worktree-skill.test.ts tests/worktree-handoff.integration.test.ts tests/cwd.test.ts` passed: 52 passed, 1 POSIX-only permissions test skipped on Windows, 0 failed. Package `bun run typecheck`, scoped Biome checks, and `git diff --check` passed after test formatting.
- Evidence uses deterministic local provider/MCP fixtures, not a live `../harbor` run or a claim that a model always follows skill instructions. No changes were made to that repository. Full-workspace tests and cross-platform execution were not performed for this bounded skill change.
