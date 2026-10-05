# Generic per-delegation working directory

**Status:** Proposed
**Date:** 2026-10-04
**Supersedes:** [0001-rpc-subagents-and-parent-only-delegation](./0001-rpc-subagents-and-parent-only-delegation.md) (mandatory same-working-directory clause only; its other boundaries remain applicable as amended by ADR 0002)

## Context

[ADR 0007](./0007-external-worktree-lifecycle-and-parent-integration.md) records the user's exclusion of plugin-owned worktree lifecycle management and the parent agent's responsibility for integration. The remaining path-interface question was whether to provide a generic working-directory override or rely entirely on paths in task instructions.

The user selected adding `cwd` after the refinement recommendation of an optional generic parameter. The distinction matters because the current `src/delegate.ts` always passes `ctx.cwd` to the runner, and the runner uses that value to start the child process. Task/context text does not change the process working directory.

Sources:

- This refinement conversation: the recommended optional generic `cwd` and the user's response, "增加一个cwd".
- `src/delegate.ts`: public tool parameters, `DelegationOptions.cwd`, invocation construction and RPC process startup.
- `src/inheritance.ts`: parent resource-path reconstruction and inherited-tool validation.
- [ADR 0001](./0001-rpc-subagents-and-parent-only-delegation.md) and [ADR 0002](./0002-session-owned-background-delegation.md): existing working-directory and initialization contract.
- [ADR 0007](./0007-external-worktree-lifecycle-and-parent-integration.md): external worktree lifecycle and parent-owned integration.

## Decision

- Add an optional generic `cwd` parameter to delegation so a task can select its child-process working directory. It is an execution-directory selection, not merely a path inserted into task/context text.
- Retain the parent's working directory when the override is omitted, preserving the existing default.
- Do not make directory selection a worktree-specific API. Keep worktree creation, removal and Git integration outside the plugin as decided in ADR 0007.

Only the mandatory same-working-directory part of ADR 0001 is replaced. The runtime lifecycle established in ADR 0002 and the external-worktree boundary in ADR 0007 are not superseded.

## Consequences

- An externally prepared worktree can be used as a delegated task's startup directory without plugin-owned Git operations.
- Per-task directory selection must not mutate the parent's working directory.
- Resource reconstruction, project configuration/context discovery and project trust may depend on directory selection; at initial recording their exact behavior for an override still needed reconciliation.
- Relative-path interpretation, validation/error behavior and working-directory result metadata were not settled at initial recording.
- `cwd` is not a filesystem access restriction or an operating-system sandbox. Scope-conflict warnings and permission controls were still under discussion at initial recording.
- This is a recorded design choice, not an implemented feature. No spec, tickets, implementation plan, production changes or runtime tests had been produced at initial recording.

## Follow-up (2026-10-04)

The user subsequently excluded scope-conflict warnings, permission controls and an OS sandbox from the current delivery scope, then accepted the recommended working-directory defaults and skill handoff with "一起提供，剩下的按照推荐就可以". [ADR 0009](./0009-bundled-worktree-skill-without-plugin-git-management.md) records the additive skill-distribution decision. The accepted ordinary directory-validation, result-metadata and workflow requirements are retained in the refinement handoff for the selected spec stage, not new architectural commitments here.

The accepted directory resolution, validation, initialization and result requirements are now expressed in [spec 0008](../spec/0008-delegation-cwd-and-bundled-worktree-skill.md), drafted on 2026-10-05. This adds the requirements reference without changing the recorded architectural decision or its Proposed status.
