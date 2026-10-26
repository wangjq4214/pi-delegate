---
name: delegate-worktree
description: Prepare independent Git worktrees for delegated modifications with pi-delegate cwd, then review and integrate actual changes before cleanup. Use for parallel coding tasks that need separate working files.
---

# Delegate work in independent worktrees

This is a parent-agent workflow, not a plugin hook. `delegate.cwd` selects any existing usable directory, including non-Git directories. The plugin never creates/removes worktrees or merges Git changes. Worktrees separate working files, but share Git repository state. Neither cwd nor this skill provides scope-conflict warnings, permission enforcement, filesystem confinement or an OS sandbox.

Follow the user's scope and write permissions. Do not perform repository/workspace operations that the user has excluded.

## 1. Establish a baseline without altering the main workspace

Inspect repository state with `git status --short` and `git worktree list --porcelain`. Resolve the selected baseline to a definite commit with `git rev-parse --verify '<baseline>^{commit}'` (for example HEAD). Record the full commit ID, main workspace path and its dirty state. Verify that the task's prerequisites exist in that commit.

Do not automatically stash, commit, reset, or copy the main workspace's uncommitted source changes. They are not part of the baseline. If the task needs those changes, report the dependency and pause for explicit parent/user handling rather than inventing a transfer policy. The narrowly scoped local MCP preparation in section 2a is runtime setup, not a source-change transfer. A missing Git repository or commit blocks this worktree workflow, not generic cwd delegation.

## 2. Prepare one workspace per independent modification task

Choose unique task branches and absolute workspace paths, preferably outside the main working tree. Check for existing branches/paths; do not overwrite them. Quote paths, including paths with spaces. Create each worktree from the recorded commit:

```sh
git worktree add -b <unique-task-branch> "<absolute-workspace>" <baseline-commit>
```

Check `git -C "<absolute-workspace>" rev-parse HEAD` and `git worktree list --porcelain`. Record each branch, path and baseline. Verify the main workspace's status is unchanged. Coordinate shared dependencies and likely integration conflicts yourself; independent working files do not guarantee conflict-free integration.

## 2a. Prepare local MCP configuration before delegation

A new worktree contains committed files, not the main workspace's ignored/untracked `.pi/mcp.json`. If the parent uses project-local MCP servers, missing configuration can prevent the child from reconstructing inherited tools and cause initialization failure. `delegate.cwd` does not automatically inherit the parent's MCP configuration.

- Inspect the source `<main>/.pi/mcp.json` and target `<workspace>/.pi/mcp.json` without disclosing credentials in the handoff or report. If no source file exists, there is nothing to copy; do not invent configuration.
- If the target already exists, preserve it unchanged. Check whether it can reconstruct the inherited MCP tools; report any incompatibility and pause for explicit handling rather than overwriting or merging it.
- If the source exists and the target is missing, explicitly copy only `.pi/mcp.json` into the worktree within the user's write permissions. Create the target `.pi` directory if needed and use exclusive creation so an intervening target creation fails without overwrite. Do not follow a source/target symlink into a shared configuration file or directory; pause for explicit handling instead. Do not copy the whole `.pi/` directory, settings, extensions, or unrelated uncommitted files. Keep the source unchanged.
- Keep the prepared file local: do not stage or commit it, force-add an ignored file, or include it in a task patch. Check `git -C "<absolute-workspace>" check-ignore -- .pi/mcp.json`; if it is not ignored, resolve local exclusion explicitly within the user's permissions before proceeding, without changing tracked ignore rules or the main workspace implicitly.
- Review path-dependent `command`, `args`, and `cwd` values before starting a server. Relative server `cwd` resolves from the child session directory; copied arguments or absolute paths may still reference the main workspace or unavailable files. Confirm the intended worktree resources exist. If adaptation is needed but its meaning is unclear, report the dependency and pause rather than silently rebasing paths or directing task writes to the main workspace.
- Verify the target project's native Pi trust decision permits loading `.pi/mcp.json`. Parent trust alone does not authorize a different directory, and RPC cannot show the built-in trust prompt. Respect explicit startup trust overrides; do not blindly add `--approve` or change trust settings to make startup succeed. If approval is missing, pause for explicit handling.
- Check MCP availability from the target directory using native Pi MCP inspection (for example `pi mcp list` in an already trusted target). Confirm the required project servers are loaded, not merely that unrelated user-level servers connect. Record only preparation/availability results and unresolved prerequisites in the handoff, not configuration secrets. Recheck that the main workspace's status and source configuration are unchanged.

This is parent-owned worktree preparation, not a plugin copy hook or a blanket exception for dirty source changes. Keep inherited-tool validation intact: if required MCP tools still cannot be reconstructed, report the initialization failure rather than disabling MCP or reducing the tool set to make the task run.

## 3. Submit an explicit handoff

Pass the absolute workspace as `delegate.cwd`, not only in task text. Include in the self-contained task/context:

- Goal, acceptance criteria, permitted changes, relevant files and constraints.
- Workspace path, task branch and full baseline commit.
- Required checks and any unavailable prerequisites.
- Instructions not to modify the main workspace, manage other worktrees, merge into the parent branch, or clean up the workspace.
- A request for a reviewable artifact and the report below.

The parent's conversation is not copied. For background work keep the originating Pi session alive and retain task IDs. cwd is resolved at submission; an invalid directory fails without creation or fallback. After a child starts, synchronous result metadata `details.cwd` identifies its absolute startup path; background terminal queries carry it at `details.result.cwd`. The initial background acknowledgement is not an effective-directory result. Queued cancellation and pre-spawn failures have no effective cwd metadata.

## 4. Require actual change artifacts and an honest report

Ask the child to return:

1. Workspace path, task branch and baseline commit.
2. A reviewable commit/reference (prefer a task-branch commit if authorized) or a patch artifact covering all handed-over modifications, including relevant newly added files and binary changes.
3. Changed-file summary and rationale.
4. Checks performed with commands/results, checks omitted with reasons, blockers and unfinished work.

A narrative alone is not an integration artifact. A plain unstaged `git diff` omits untracked files. If committing is authorized, stage only task changes, inspect the staged diff, commit on the task branch and return the commit ID. If using a patch, deliberately include new files and binary content, inspect the resulting artifact, and leave the workspace intact; staging changes for `git diff --cached --binary` needs the corresponding permission. Do not claim missing checks passed.

If the child fails or is cancelled, retain available output/diagnostics and inspect the workspace for partial changes. A final report may be absent: never fabricate one. Plugin process/snapshot cleanup does not delete the worktree, undo edits, or preserve task IDs after session shutdown/reload/navigation.

## 5. Parent review and integration

Inspect actual changes relative to the recorded baseline, including added files and any remaining uncommitted work. For a commit inspect `git show --stat <commit>` and `git diff --binary <baseline> <commit>`; also check workspace status. For a patch read the artifact and verify it corresponds to the intended changes. Evaluate acceptance and check evidence independently; the child's success claim is not verification.

Integrate only reviewed changes using the repository's appropriate commit/patch workflow (for example cherry-picking reviewed task commits). Confirm the destination branch and working-tree readiness. Do not overwrite unrelated dirty parent changes; pause if safe integration requires explicit handling. Handle conflicts deliberately, retaining the source workspace until resolved. Run relevant tests/checks on the combined integrated result; child-only checks do not establish integrated correctness.

## 6. Cleanup only after review, integration and validation

Confirm that all intended work is integrated and validated and no uncommitted/unmerged changes remain in the task workspace. Then remove only that workspace:

```sh
git worktree remove "<absolute-workspace>"
```

Do not force removal to bypass dirty-state warnings. Delete a task branch only after verifying its changes are preserved and branch deletion is authorized. Keep failed, cancelled, unmerged or integration-unverified workspaces for inspection/further parent action. Report retained paths, artifacts, validation and remaining work. Never equate child completion with permission to remove a workspace.
