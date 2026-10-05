# External worktree lifecycle and parent-owned integration

**Status:** Proposed
**Date:** 2026-10-04

## Context

The user wants to pursue safe parallel modification but explicitly does not want pi-delegate to provide worktree-specific support. The proposed alternative is a worktree skill, passing a workspace path to delegated work, reporting the resulting modifications, and leaving integration to the parent agent.

[The roadmap](../../docs/roadmap.md) lists optional Git worktree isolation and returning a diff for parent review and merge as capability candidates, not an agreed interface or release commitment. The current implementation exposes no per-task working-directory parameter: `src/delegate.ts` supplies `ctx.cwd` to the runner, which starts the child process with that directory.

Sources:

- This refinement conversation: the user's explicit exclusion of plugin worktree support and requested parent-owned merge workflow.
- `docs/roadmap.md`: safe parallel modification candidates and the distinction between prompts, tool restrictions and an operating-system sandbox.
- `src/delegate.ts`: public task parameters and child-process working-directory selection.
- `src/inheritance.ts` and [ADR 0001](./0001-rpc-subagents-and-parent-only-delegation.md): conventional initialization, resource-path replay and the existing same-directory inheritance contract.
- [ADR 0002](./0002-session-owned-background-delegation.md): delegation runtime ownership and cleanup.

## Decision

- Keep worktree-specific lifecycle management outside the pi-delegate plugin. Do not introduce plugin-owned worktree creation, removal or Git merge operations for this workflow.
- Keep review and integration of delegated modifications with the parent agent rather than implementing automatic merging inside the plugin.

At initial recording, these established the requested architectural boundaries without approval of an exact path interface. Whether path injection meant task/context instructions only or an optional generic child working-directory parameter was unresolved. The skill's detailed lifecycle and the exact modification-report contract are also not settled by this record.

## Consequences

- A skill/agent workflow must provide the worktree orchestration needed by this approach; plugin runtime cleanup does not imply worktree cleanup.
- Plugin task execution and result delivery remain distinct from Git workspace management and integration.
- Merely placing a path in task text does not change the child-process working directory in the current implementation. This distinction must be resolved before claiming directory-local execution for the proposed workflow.
- Neither instructions nor Git worktrees establish an operating-system sandbox.
- No existing working-directory inheritance decision is superseded by this record. Any agreed directory override must explicitly reconcile that contract and initialization behavior.
- No spec, tickets, implementation plan, production changes or runtime verification have been authorized or produced in this refinement round.

## Follow-up (2026-10-04)

The user subsequently selected the optional generic `cwd` parameter, recorded in [ADR 0008](./0008-generic-per-delegation-working-directory.md). That decision resolves the path-interface question without changing this record's external-worktree lifecycle or parent-integration boundaries. At that point, the skill's detailed lifecycle and modification-report contract were still unsettled.

Later in the same refinement conversation, the user accepted the recommended skill lifecycle and modification-report defaults and selected distributing the skill with the extension; see [ADR 0009](./0009-bundled-worktree-skill-without-plugin-git-management.md). These selections retain this record's runtime/skill/parent boundaries. Detailed ordinary requirements are handed off to the selected spec stage rather than introduced as additional architecture decisions here.

## Requirements contract (2026-10-05)

[Spec 0008 — Delegation working directory and bundled worktree skill](../spec/0008-delegation-cwd-and-bundled-worktree-skill.md) now expresses the accepted workflow and directory handoff. It retains the boundary between plugin execution, skill-managed workspaces and parent integration. This is a requirements draft, not implementation or runtime verification.
