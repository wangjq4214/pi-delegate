---
name: delegate-worktree
description: Prepare independent Git worktrees for delegated modifications with pi-delegate cwd, then review and integrate actual changes before cleanup. Use for parallel coding tasks that need separate working files.
---

# Delegate work in independent worktrees

This is a parent-agent workflow, not a plugin hook. `delegate.cwd` selects any existing usable directory, including non-Git directories. The plugin never creates/removes worktrees or merges Git changes. Worktrees separate working files, but share Git repository state. Neither cwd nor this skill provides scope-conflict warnings, permission enforcement, filesystem confinement or an OS sandbox.

Follow the user's scope and write permissions. Do not perform repository/workspace operations that the user has excluded.

## 1. Establish a baseline without altering the main workspace

Inspect repository state with `git status --short` and `git worktree list --porcelain`. Resolve the selected baseline to a definite commit with `git rev-parse --verify '<baseline>^{commit}'` (for example HEAD). Record the full commit ID, main workspace path and its dirty state. Verify that the task's prerequisites exist in that commit.

Do not automatically stash, commit, reset, or copy the main workspace's uncommitted changes. They are not part of the baseline. If the task needs those changes, report the dependency and pause for explicit parent/user handling rather than inventing a transfer policy. A missing Git repository or commit blocks this worktree workflow, not generic cwd delegation.

## 2. Prepare one workspace per independent modification task

Choose unique task branches and absolute workspace paths, preferably outside the main working tree. Check for existing branches/paths; do not overwrite them. Quote paths, including paths with spaces. Create each worktree from the recorded commit:

```sh
git worktree add -b <unique-task-branch> "<absolute-workspace>" <baseline-commit>
```

Check `git -C "<absolute-workspace>" rev-parse HEAD` and `git worktree list --porcelain`. Record each branch, path and baseline. Verify the main workspace's status is unchanged. Coordinate shared dependencies and likely integration conflicts yourself; independent working files do not guarantee conflict-free integration.

## 3. Submit an explicit handoff

Pass the absolute workspace as `delegate.cwd`, not only in task text. Include in the self-contained task/context:

- Goal, acceptance criteria, permitted changes, relevant files and constraints.
- Workspace path, task branch and full baseline commit.
- Required checks and any unavailable prerequisites.
- Instructions not to modify the main workspace, manage other worktrees, merge into the parent branch, or clean up the workspace.
- A request for a reviewable artifact and the report below.

The parent's conversation is not copied. For background work keep the originating Pi session alive and retain task IDs. cwd is resolved at submission; an invalid directory fails without creation or fallback. After a child starts, synchronous result metadata `details.cwd` identifies its absolute startup path; background terminal queries/completion messages carry it at `details.result.cwd`. The initial background acknowledgement is not an effective-directory result. Queued cancellation and pre-spawn failures have no effective cwd metadata.

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
