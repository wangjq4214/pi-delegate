# Delegation working directory and bundled worktree skill

**Spec ID:** 0008
**Status:** Draft
**Date:** 2026-10-05
**Sources:** The settled refinement conversation: the user selected adding `cwd`, excluded scope-conflict warnings and permission/sandbox capabilities from this increment, then confirmed "一起提供，剩下的按照推荐就可以" for the bundled skill and recommended defaults. [ADR 0007](../adr/0007-external-worktree-lifecycle-and-parent-integration.md), [ADR 0008](../adr/0008-generic-per-delegation-working-directory.md), and [ADR 0009](../adr/0009-bundled-worktree-skill-without-plugin-git-management.md).

## Source and coordination boundary

- **H-cwd — Accepted defaults:** Optional `cwd`; omission uses the parent's working directory. Resolve relative paths against the parent's working directory at submission, not after a queue wait. Require an existing accessible directory without requiring a Git repository or worktree. Do not create it or fall back on an invalid override. Apply the same behavior to synchronous and background delegation and return the effective working directory. Load project context from the selected directory through normal Pi initialization, retain tool reconstruction/validation, and follow Pi's native project-trust rules.
- **H-skill — Accepted distribution and workflow:** Provide the worktree skill in the same package. The parent uses it to prepare independent workspaces, pass `cwd`, and manage cleanup. Use an explicit commit baseline without automatically stashing, committing, or copying the main workspace's uncommitted changes. Request a commit/patch, modification summary, performed/omitted checks, and unfinished work. The parent reviews actual changes, integrates and validates them before cleanup; preserve failed or unmerged workspaces.
- **H-boundary — User-selected exclusions:** The plugin must not own worktree creation, removal or Git merging. Do not add declared-scope conflict warnings, tool-permission policies, path-access enforcement or an OS sandbox in this increment. `cwd` is directory selection, not an access restriction.
- **A — Architecture:** ADRs 0007–0009, Proposed, establish external workspace management, generic directory selection and package distribution. [ADR 0002](../adr/0002-session-owned-background-delegation.md), Completed, continues to own background lifecycle/result delivery; [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md), Superseded in part, remains the source for fresh RPC children, local tool reconstruction and parent-only delegation.
- **B — Existing contracts:** [Spec 0001](./0001-rpc-subagent-delegation.md) supplies reconstruction and registration guarantees; [spec 0002](./0002-session-owned-background-delegation.md) supplies background ownership, query/completion, cancellation and cleanup; [spec 0007](./0007-concurrency-scheduling-and-cost-visibility.md) supplies invocation capture and queue/admission boundaries. This spec replaces only the mandatory same-directory clause with an optional override as authorized by ADR 0008. It does not reopen the other contracts.
- **L — Repository evidence:** [src/delegate.ts](../../src/delegate.ts) currently has internal `DelegationOptions.cwd`, starts RPC children with it, but exposes no public override and always supplies `ctx.cwd`. [src/inheritance.ts](../../src/inheritance.ts) resolves parent resource sources, replays startup configuration, supplies approval flags from the parent trust state, and validates the child's tool registry/activation. [src/background.ts](../../src/background.ts) retains captured execution options and exposes child results through its existing owner. [package.json](../../package.json) declares an extension but no skill resource. [Runtime documentation](../../docs/runtime.md) describes existing initialization, cleanup and security limits. These are current integration points, not evidence that this feature is implemented.
- **V — Host documentation:** Installed Pi `docs/skills.md` and `docs/packages.md` describe skill discovery and package resource declarations; `docs/configuration.md` and `docs/security.md` describe working-directory discovery and native trust, including CLI overrides and noninteractive behavior. The inspected global installation is Pi 1.0.2; repository development dependencies are Pi 1.0.0. This drafting evidence is not runtime verification of either version's new behavior.

Selected endpoint: **one requirements spec**. No slice, tickets, implementation plan, production/test changes or runtime QA are authorized by this refinement stage. Consume settled requirements and established solution choices only; organize and express them without inventing or revising domain facts, requirements, constraints, acceptance semantics, architecture or unconfirmed assumptions. Trace meaningful assertions to this handoff or sources. If a needed new fact or decision emerges, suspend and return it to refine for clarification and qualifying live recording before resuming. Formatting and execution ordering do not authorize filling semantic gaps. Return results to refine at this endpoint.

## Requirements

### R1 — Generic optional directory selection

- Add an optional string parameter named `cwd` to `delegate`. When absent, retain the invocation's parent working directory.
- Interpret an absolute directory path as the selected location. Resolve a relative path against the parent invocation's working directory, not the extension installation directory, a later parent directory, or a child shell command's directory.
- Select a concrete absolute startup directory at submission and retain that selection through queueing and admission.
- Require an existing directory that the child process can use as its working directory. Missing paths, non-directory paths and inaccessible startup directories must produce an explicit failure rather than executing the original task elsewhere.
- Do not create a directory, initialize a repository, or create a worktree as a side effect of supplying `cwd`. A usable non-Git directory is valid.
- Do not silently replace an invalid override with the parent directory. If a selected directory disappears or becomes unusable before admitted startup, report failure rather than changing the selection.

**Trace:** H-cwd; H-boundary; ADR 0008; L/current runner startup.

### R2 — Per-task ownership and mode parity

- Apply R1 to both synchronous and background delegations through the existing execution paths. Background selection is not deferred until the task leaves the queue.
- Two delegations may select different directories without changing each other's inputs or the parent's working directory. Do not use process-global directory changes as task selection.
- Preserve existing fresh-child, concurrency/admission, model/thinking, pressure, cancellation, terminal outcome and background delivery behavior except for the selected startup directory and associated metadata.
- Directory selection does not create a new owner for task execution or workspace lifecycle.

**Trace:** H-cwd; H-boundary; ADRs 0002 and 0008; B; L/background captured options.

### R3 — Initialization and reconstruction remain explicit

- Use the selected directory as the child's actual startup directory so normal Pi context and project-resource discovery operate from that location, subject to the existing startup configuration and native trust behavior.
- Preserve the meaning of inherited parent resource paths. Selecting another directory must not reinterpret an observed parent extension path or an original relative CLI resource as a resource in the target workspace.
- Continue reconstructing the inherited tool sources locally, restoring activation/discoverability and excluding delegation capabilities. Do not introduce tool proxies or silently reduce the inherited tool set because directory discovery changed.
- Continue explicit initialization failure when the reconstruction/validation contract cannot be satisfied; do not run the original task with an unvalidated fallback configuration.
- Follow Pi's native project-trust rules and startup-configuration semantics rather than adding a new plugin permission or approval system. Directory selection does not promise trusted content, filesystem confinement or identical project-local configuration across different directories.

**Trace:** H-cwd; H-boundary; B/spec 0001; L/inheritance; V/configuration and security. Existing approval-flag replay is an affected integration point to verify, not proof that changing only process startup is sufficient.

### R4 — Effective directory in results

- Make the effective absolute startup directory available in result metadata for tasks that start a child, in both invocation modes. Report the selected execution location, not merely the caller's original relative input.
- Preserve that information through the existing background terminal result, query and completion-delivery paths so the parent can associate a result with its workspace.
- Retain existing failure/cancellation diagnostics. Do not imply that a child used a directory when it never started; a resolved intended path may be described as a selection rather than observed execution.
- Document the directory parameter, resolution/error behavior and returned metadata. The exact metadata field layout is an implementation detail compatible with existing result structure.

**Trace:** H-cwd; ADR 0008; B/spec 0002; L/result delivery.

### R5 — A discoverable skill in the same package

- Provide one worktree workflow skill alongside the extension and expose its resource through the package's normal Pi skill-loading mechanism. Users must not need a separate installation or a manual copy into a personal skill directory.
- Supply the skill's normal metadata and complete workflow instructions so a parent agent can discover and load it through the host's supported skill mechanisms.
- Keep it an agent-executed workflow, not an extension hook that automatically performs Git operations when delegation begins or ends.
- The skill must explain the distinction between generic `cwd` execution and skill-managed Git workspaces, including the absence of conflict warnings, permission enforcement and sandbox guarantees.

**Trace:** H-skill; H-boundary; ADR 0009; L/package manifest; V/skills and packages.

### R6 — Workspace preparation preserves the main workspace

- The parent uses the skill to prepare a separate worktree for each task whose modifications need independent working files, records the selected commit baseline and workspace location, and supplies the workspace path as `delegate.cwd`.
- Establish the baseline as a definite Git commit before preparing the task workspace. Do not silently treat the main workspace's uncommitted files as part of that baseline.
- Do not automatically stash, commit, or copy the main workspace's uncommitted changes to prepare delegated work. If those changes are required by the task, report that need for explicit parent handling rather than inventing a transfer policy.
- Express the selected workspace and baseline in the self-contained task/context handoff. The parent's conversation is still not copied automatically.
- Skill workspace preparation requires the Git/repository prerequisites for a worktree. Their absence is a workflow blocker, not a reason to add a Git prerequisite to the generic `cwd` parameter.

**Trace:** H-skill; ADRs 0007 and 0009; B/explicit task-context contract.

### R7 — Reviewable modifications, not only a narrative

- The skill instructs the child to return its workspace location and commit baseline, a reviewable commit/reference or patch artifact, a changed-file summary, performed and omitted checks, blockers and unfinished work.
- The change artifact must cover the modifications being handed over, including relevant newly added files; a textual summary alone is not an integration artifact.
- Pass the child's available report through the existing result channels. The plugin is not required to generate Git diffs, commit changes or enforce a structured report schema.
- The parent inspects actual changes and the available verification evidence before integrating them. A report claiming success is not itself verification.
- If failure or cancellation prevents a complete report, retain the available existing diagnostics/output and the workspace for parent inspection; do not fabricate a complete report or erase partial work.

**Trace:** H-skill; H-boundary; ADR 0007; B/existing non-success results.

### R8 — Parent-owned integration and cleanup

- The parent, following the skill, owns review, integration, conflict handling and post-integration validation. The plugin must not automatically merge delegated modifications.
- Clean up a skill-managed workspace only after the parent has reviewed, integrated and validated the work. Keep failed or unmerged workspaces available for inspection and further parent action.
- Child completion, failure, cancellation and plugin runtime teardown still clean up the plugin's owned process/initialization resources, but must not remove the externally prepared workspace as part of that cleanup.
- Workspace preservation does not make background tasks persistent across Pi shutdown, reload or ownership invalidation; existing task lifecycle and ID semantics remain unchanged.

**Trace:** H-skill; H-boundary; ADRs 0002, 0007 and 0009.

## Solution

Extend the public delegation input to select the existing runner's startup directory, retaining submission-time selection across admission. Keep parent resource reconstruction distinct from child directory discovery so changing the execution directory does not rebase inherited tool sources. Keep results associated with their selected startup directory through the existing synchronous/background owners.

Expose the worktree skill as a package resource. Its instructions guide the parent through workspace preparation, explicit task/context handoff, reviewable child reporting, parent-owned integration/validation and subsequent cleanup. No plugin-owned Git lifecycle or permission subsystem is introduced.

The mandatory same-directory statement in spec 0001 and the current runtime documentation must be read with this explicit override contract; all unchanged inheritance and lifecycle guarantees still apply. Native trust remains a host initialization contract, not a new directory-based sandbox or a promise that every target project will reconstruct successfully.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Invocation and admission | Parent tool call → captured task execution | Optional `cwd`, parent invocation directory, existing task inputs | Absolute per-task startup selection retained through queueing; explicit invalid-directory failure |
| Initialization | Captured parent resources + selected directory → fresh RPC child | Stable inherited resource meanings, normal discovery/trust, validated inherited tools | Original task starts in the selected directory only after existing initialization succeeds |
| Result ownership | Runner → synchronous caller / background owner → parent | Effective startup directory and existing outcome/output | Workspace-associated result metadata through ordinary return, query and completion paths |
| Package resources | Package manifest → Pi skill discovery → parent | Bundled skill metadata and complete instructions | Worktree workflow available with the extension through normal skill loading |
| Workspace/task handoff | Parent following skill → delegated child | Prepared worktree, definite baseline, explicit task/context and `cwd` | Reviewable change artifact and available report; no automatic main-workspace state transfer |
| Integration and cleanup | Child workspace/report → parent following skill | Actual changes and verification evidence | Parent-owned integration/validation before workspace cleanup; failed/unmerged work retained separately from process cleanup |

## End-to-End Tests

### Default directory and generic non-Git override

- **Given:** A parent in directory P and a separate usable non-Git directory Q, each with distinguishable files.
- **When:** A task without `cwd` and a task with absolute `cwd` Q perform relative file operations through real child tools.
- **Then:** The default task operates from P, the override task operates from Q, result metadata identifies each startup directory, and the parent's directory remains P. No Git setup is performed for Q.

### Relative selection remains stable while queued

- **Given:** A parent invocation in P, a valid relative target Q and occupied concurrency capacity.
- **When:** A task is submitted with relative `cwd`, waits in the existing queue, and the parent's later directory context changes before admission.
- **Then:** The admitted child uses the directory resolved from P at submission, not a newly rebased target; the same rule holds in synchronous and background modes.

### Invalid or no-longer-usable target

- **Given:** A missing path, a file rather than a directory, an inaccessible directory, or a selected directory that becomes unusable before startup.
- **When:** Delegation attempts to start the original task with that override.
- **Then:** It reports failure without creating the target, starting the original task in the parent directory or claiming execution in a directory that was never used. Existing task/capacity cleanup still completes.

### Target discovery without rebasing inherited resources

- **Given:** A parent with reconstructible tools from parent/CLI resource paths, a target with distinguishable context, and native Pi trust/startup configuration appropriate to the case.
- **When:** Delegation starts in the target directory.
- **Then:** Context discovery and protected project-resource loading follow the target directory and Pi's native trust semantics; inherited resources keep their original meaning, child delegation tools remain unavailable, and normal tool validation completes before original-task execution. An incompatible reconstruction fails explicitly rather than executing with a reduced tool set.

### Directory metadata survives both result routes

- **Given:** Synchronous and background tasks that have started children in selected directories.
- **When:** They complete, fail or are cancelled and the parent retrieves their available outcomes through the ordinary return, background query and completion paths.
- **Then:** Available effective startup-directory metadata remains associated with the correct task without replacing existing status, output, usage or ownership semantics.

### Skill is available through the package

- **Given:** A supported Pi setup loading this package with normal skill discovery enabled and without an independently installed copy of the skill.
- **When:** The parent discovers and loads the bundled worktree skill.
- **Then:** Complete workflow instructions are available alongside the extension; no manual skill-file copying or plugin-triggered Git operation is needed.

### Parallel worktrees and an unchanged dirty main workspace

- **Given:** A Git repository, a definite baseline commit and existing uncommitted changes in the main workspace.
- **When:** The parent follows the skill to prepare two independent task worktrees and delegates using their respective paths.
- **Then:** Each child starts in its assigned worktree; preparation has not stashed, committed or copied the main workspace's uncommitted changes. Each handoff identifies its baseline and workspace, and the parent's original working directory is unchanged.

### Report, review, integration and cleanup

- **Given:** A completed child modification that includes an added file and available check results.
- **When:** The child returns the skill-requested commit/patch and report, and the parent follows the integration workflow.
- **Then:** The artifact permits inspection of the actual modifications, including the added file; performed/omitted checks and remaining work are visible. The parent reviews and integrates actual changes, handles any conflicts and validates integration before workspace cleanup. Plugin result collection does not itself merge or remove the worktree.

### Failed or unmerged work remains inspectable

- **Given:** A task that leaves partial modifications and fails or is cancelled, or completed work that the parent has not integrated.
- **When:** Existing task process/initialization cleanup completes.
- **Then:** The worktree remains inspectable with available diagnostics and artifacts. Missing final reports are not fabricated. Workspace retention does not preserve an invalidated background task ID or keep its child alive.

## Decisions

- **Choice:** One small spec covering the directory capability and its bundled workflow handoff. **Source:** The user's acceptance of the recommended spec-only endpoint. No independent approval/lifecycle split was selected.
- **Choice:** Generic optional `cwd`, retaining the parent-directory default. **Source:** H-cwd and ADR 0008; replaces only the older mandatory same-directory clause.
- **Choice:** Submission-time relative resolution and explicit directory failure instead of creation/fallback. **Source:** The recommended defaults accepted by the user, H-cwd.
- **Choice:** Normal Pi initialization/trust plus existing reconstruction validation, not a new permission system. **Source:** H-cwd, H-boundary, existing spec 0001 and native host documentation.
- **Choice:** Distribute an agent-executed skill with the extension while keeping Git management out of plugin runtime. **Source:** H-skill and ADRs 0007/0009.
- **Choice:** Definite commit baseline, no implicit handling of main-workspace uncommitted changes, parent review/integration/validation and delayed cleanup. **Source:** H-skill and the user's acceptance of the recommended defaults.
- **Choice:** Commit/patch plus an available human/model-readable report rather than plugin-generated diffs or schema enforcement. **Source:** H-skill, H-boundary and the original requested parent-merge workflow.

## Verification guidance

Use real Pi RPC and package discovery for directory/context/tool-loading guarantees rather than only checking a runner option. Exercise both invocation modes and the queue boundary. Include supported-platform directory paths with spaces and distinct parent/target context, and a reconstruction failure case. Check effective native trust behavior under the actual child startup configuration, including the existing approval-flag replay seam.

Use a temporary Git repository with a known commit and dirty main workspace to exercise the skill handoff, artifact completeness and preservation/cleanup ordering. Evaluate both the written skill instructions and their resulting workflow: instructions are not an OS enforcement guarantee. Deterministic fixtures can cover metadata and lifecycle routing, but do not by themselves establish real-host discovery or Git workflow correctness.

This draft defines future verification criteria. No new runtime tests, implementation or QA have been performed in this refinement stage. Host evidence is version-scoped as described in V; do not claim compatibility with unverified host versions.

## Out of Scope

- Plugin-owned Git worktree creation, removal, branch management, commit generation, diff generation or merging.
- Declared file-modification scopes, scope-overlap warnings, file locks or automatic merge-conflict prediction.
- New tool allowlists, read-only enforcement, filesystem path-access restrictions, permission dialogs or an OS sandbox.
- Automatic stashing, committing or copying main-workspace uncommitted changes into delegated workspaces.
- Structured result-schema validation or plugin verification of the child's correctness.
- Persistent background execution, task migration or recovery of task IDs after the existing ownership scope ends.
- A new TUI task panel or working-directory display requirement; the accepted directory visibility is result metadata.
