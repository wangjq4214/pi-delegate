# pi-goal

A bounded goal coordinator built on pi-delegate. The parent plans and assesses evidence; fresh delegate workers execute bounded work and a separate reviewer assesses completion. Inspired by [pi-goal-x](https://github.com/tmonk/pi-goal-x), not a port of its runtime or project-local storage.

This is a **private local workspace package**, not yet included in npm/tag publishing. It has a runtime dependency on delegate's new public consumer API. Both extensions must be loaded in the same parent session; installing an npm dependency does not automatically load its Pi extension.

## Local setup

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/pi-delegate build
bun run --cwd packages/pi-goal build
```

Start Pi in the project you want to work on, loading both extensions (replace the checkout path):

```sh
pi -e /absolute/checkout/packages/pi-delegate/dist/index.js -e /absolute/checkout/packages/pi-goal/dist/index.js
```

For source development, load both `src/index.ts` paths instead. Build delegate first because the goal import resolves its supported public `/api` package entry. Co-loading order does not matter once extension loading is complete.

## Commands

Create and start only when the parent is idle, with explicit acceptance criteria and a finite allowance:

```text
/goal {"objective":"Fix the parser regression","criteria":["The supplied reproduction passes","Existing parser tests pass"],"allowance":12}
/goal status
/goal list
/goal status <goal-id>
/goal pause
/goal resume <goal-id> 8
```

The numbers are examples, not defaults. `/goal list` lists globally saved records; a saved `active` status is **not proof of a live process**. Start/resume never silently replaces another active goal; pause it first.

### Allowance and stopping

The allowance counts goal-initiated coordinator checkpoints, worker dispatches and independent reviewer dispatches together. An initial coordinator dispatch consumes a unit. Each extension-requested continuation consumes another; worker completion does not replenish the allowance. Existing within-run host/tool turns are not individual allowance units, so this is not a total provider-request, token, cost or wall-clock ceiling. Optional per-worker delegate time/turn budgets remain separate.

When the next dispatch cannot fit, goal pauses without an extra model wrap-up. A worker may use the last unit, leaving no capacity for mandatory review; that goal remains unfinished. Only explicit user resume establishes a new allowance, retaining past attempts. Rejection/error never grants unlimited retries.

Pause revokes new scheduling immediately, requests cancellation of only goal-owned children and waits for delegate cleanup. It does not roll back edits or external effects. Abort, branch navigation, reload and session shutdown stop owned work; they do not turn it into a background service. Ordinary unrelated delegations keep their own controls and query-only results.

## Agent tools

| Tool | Responsibility |
| --- | --- |
| `goal_status` | Read current runtime state or a saved global goal by ID. |
| `goal_plan` | Upsert logical work items with acceptance conditions and a checkpoint. |
| `goal_work` | Run one planned item through the shared delegate runtime, optionally selecting model/thinking level and a per-worker time/turn budget. |
| `goal_accept` | Record the parent's explicit evidence assessment and relevant artifact paths; does not complete the goal. |
| `goal_reinspect` | Record actual file/test/effect inspection after manual recovery, before new work. |
| `goal_review` | Ask a fresh independent reviewer to assess the current objective, conditions and evidence; required for completion. |
| `goal_block` | Pause with a concrete blocker requiring user action. |

Worker `completed` is only an execution outcome. The parent must assess evidence, and every item must have explicit acceptance evidence before completion review. The independent reviewer returns reasons/evidence and an exact final `<approved/>` or `<disapproved/>` line. Failure, cancellation, partial/malformed output or outdated evidence cannot complete the goal. Artifact paths must name existing regular files; directory artifacts are rejected rather than compared using incomplete directory timestamps. Registered files are fingerprinted around review to detect changes during assessment. Review instructions are **not an enforced read-only sandbox**.

Goal tools are parent-only and excluded from delegated children, including discoverable/codemode tool access. The runtime capability shares delegate's existing task discovery, admission, usage accounting and cleanup rather than starting another executor. API invocations are synchronous and cancellation belongs to their supplied signal; ordinary delegate background tasks still do not wake the parent or automatically deliver reports.

## Global persistence and recovery

Goal bookkeeping is stored under:

```text
~/.pi/agent/goals/
  <goal-id>.jsonl
  <goal-id>.jsonl.lock   # only while an owner holds the journal
```

`getAgentDir()` resolves the root, including `PI_CODING_AGENT_DIR`. A session-directory override does not move goals. No goal metadata, checkpoint or lock is saved under project-local `.pi/` or elsewhere in the working directory; project files that the work is intended to modify are unaffected by this storage rule. Storage errors never fall back to project-local files.

The format references Pi sessions: a goal-specific versioned JSONL header with ID, timestamp and cwd, followed by typed, identified, timestamped parent-linked checkpoints. This is **not a native Pi session file**; goals do not go in `sessions/` or mutate session transcripts. Checkpoints retain objective, criteria, items, summaries/evidence, attempts, allowance, stop reasons and review results rather than depending only on ephemeral delegate handles/output files. Records may contain sensitive task/result data; treat the global directory accordingly.

After restart, saved goals are inspectable but nothing resumes automatically. Resume from the original working directory with a finite allowance. Goal checks the directory and registered artifacts, marks ambiguous previous attempts interrupted, then requires the parent to inspect actual current files/tests and effects and call `goal_reinspect` before new work/review. No dead child process is reconnected and interrupted work is never blindly replayed. Missing evidence or a missing/mismatched cwd blocks execution rather than substituting another project.

Exclusive per-goal leases prevent simultaneous owners. Explicit resume may reclaim a demonstrably dead process owner on the same host; live, foreign or uncertain owners are rejected. Malformed versions, torn tails and conflicts fail closed; list reports damaged records separately. The store preserves the last valid checkpoint in its recovery error instead of silently rewriting history. Automatic journal repair and project relocation are not provided; inspect/back up damaged records before manual intervention.

## Verification and boundaries

```sh
bun run --cwd packages/pi-goal test
bun run --cwd packages/pi-goal typecheck
```

Tests use isolated temporary user roots and controlled outcomes. See [Spec 0019](../../.grimoire/spec/0019-bounded-goals-on-delegate.md) for the requirements and implementation evidence. Pinned-host tests do not establish other host versions, live-provider behavior or manual terminal keyboard/IME acceptance. POSIX mode privacy tests are skipped on Windows; Windows ACL isolation is not claimed.

No general DAG engine, recursive agent teams, automatic worktree/merge management, OS sandbox or exact provider-billing cap is supplied.
