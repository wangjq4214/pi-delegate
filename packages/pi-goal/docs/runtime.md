# Runtime and safety

[Back to README](../README.md) · [Usage](usage.md) · [Development](development.md) · [Roadmap](roadmap.md)

Goal owns authorization, decomposition, evidence acceptance, continuation decisions, and durable progress. Delegate owns child execution. This document explains that boundary and the limits of persistence, cancellation, and independent review.

## Integration and execution ownership

Goal consumes delegate's supported public `/api` entry rather than importing its internal runner or creating another executor. Both extensions must be loaded in the same parent session. Extension load order does not matter once loading is complete; a missing or incompatible runtime is an error, not a reason to fall back to a private import.

Goal's worker and reviewer submissions use the existing synchronous delegate capability, task records, FIFO admission, child execution owners, and usage accounting. They share capacity with ordinary delegate calls. The supplied abort signal owns cancellation; an ephemeral task ID is a query handle, not ownership or durable execution. Repeated status reads do not charge usage again.

See delegate's [public consumer API](../../pi-delegate/docs/api.md) and [runtime guide](../../pi-delegate/docs/runtime.md) for execution contracts, tool reconstruction, concurrency configuration, and process cleanup. Goal does not currently expose a supported public programmatic consumer API of its own; its commands and parent tools are described in [Usage](usage.md).

Each worker/reviewer runs in a fresh child session. Goal explicitly supplies its saved cwd and the relevant task context; it does not copy the parent's full conversation or reconnect an old child on resume. Reviewer sessions are separate from worker sessions.

Goal returns immediately when loaded in a delegate child. Its tool names are declared parent-only through delegate's public integration, including discoverable and codemode access. This prevents recursive orchestration through those registered capabilities; it is not an operating-system restriction on arbitrary subprocess creation.

## Draft confirmation and activation

`/goal <objective>` begins a session-local draft, not an active goal. The current parent clarifies the request through ordinary user-driven chat. Drafting does not authorize goal dispatches, run automatic goal continuation, or claim that normal chat usage is covered by an unapproved execution allowance.

`goal_propose` copies and freezes the proposed objective, criteria, explicit positive allowance, and cwd. The runtime presents those values in its native Start/Cancel interaction. Model text, structured approval fields, and conversational assent cannot approve the proposal. Pending confirmation is bound to the current draft and cwd; replacing it or receiving invalidating input aborts the old confirmation.

Confirmation and activation remain inside one live cancellable tool invocation. After Start, the runtime rechecks proposal identity and cwd, creates the journal, and persists the initial coordinator charge before returning authority to sibling or nested tools. Work/review are blocked while activation is still settling. There is no detached approval callback waiting for an unrelated idle event.

The first admitted coordinator uses that existing charge. Ordinary direct-turn and native-boundary paths must not charge it twice or allow a worker to consume an uncharged initial coordination. Aborting or pausing during activation revokes scheduling; if journal creation has already committed, the record may remain paused rather than being erased. Cancel before activation does not create an active goal.

## Continuation and dispatch allowance

One explicitly supplied positive safe integer bounds coordinator, worker, and reviewer dispatches together. There is no implicit unlimited setting or automatic per-child reset. A dispatch is recorded and charged before execution; unsuccessful attempts still consume capacity. Past runs remain represented in the checkpoint history when an explicit resume establishes a new run allowance.

The initial coordinator and each goal-requested coordinator continuation consume units. Existing host/model/tool turns inside an already admitted run are not separate units. Consequently, allowance does not bound exact provider-request counts, tokens, spending, or total elapsed time. Per-worker time/turn budgets are independently enforced by delegate on observed execution thresholds, not by this goal counter.

While the runtime still owns an active goal, goal context supplies the objective, criteria, work items, checkpoint, run allowance, recovery requirement, and recent attempts. Native settlement hooks can request an explicitly metered coordinator continuation after a completed parent run. Goal does not change ordinary background delegate completion into unsolicited messages or idle-parent wake-up.

Exhaustion pauses without an extra model wrap-up. Completion, pause, unresolved blockers, abort, or scope teardown revoke continuation authority. Pending admissions and late results must not restart a stopped goal. The coordinator is instructed not to bypass the goal boundary using ordinary delegation or self-performed implementation; that instruction is not an OS-level permission system.

## State and evidence

Durable state distinguishes three concepts:

| Concept | Meaning |
| --- | --- |
| Goal | Stable ID/cwd, objective/criteria, active/paused/complete status, checkpoint, stop reason, allowance, and review. |
| Work item | Logical work with stable item ID, title, acceptance condition, pending/accepted status, evidence, and artifact references. |
| Attempt | A distinct coordinator, worker, or reviewer dispatch, with its execution status, available summary, task ID, usage, and partial-output indicator where available. |

Goal status and child status are not interchangeable. A worker can be completed while its item remains pending; cancelled, failed, incomplete, and interrupted attempts are not converted into accepted work. A saved active goal is not proof that a runtime still owns it.

Plans are flat upserts, not dependency graphs. Objective, criteria, ID, and cwd are immutable in the current durable schema. Item changes and new work invalidate previous review. Explicit parent acceptance requires actual evidence; the runtime stores the assessment but does not prove that every model-written evidence statement is true.

Attempt summaries retain at most a 32,000-character prefix plus a truncation notice. They are not full transcripts, a durable copy of every delegate output artifact, or proof that referenced files still exist. Unavailable or truncated evidence requires inspection, not inferred success.

## Independent completion review

Before review, the goal must have at least one work item and every item must have explicit acceptance evidence. Goal starts a fresh delegated reviewer with the objective, acceptance conditions, item evidence/artifact references, and worker-attempt summaries. It asks the reviewer to inspect actual artifacts, report reasons/evidence, and not implement fixes.

Only a completed, non-partial reviewer result with explanatory content and a final nonempty line exactly `<approved/>` can approve. An approval marker alone, malformed output, rejection, error, or cancellation cannot complete the goal. The approval must match the current work revision and live runtime authority, including when pause races with persistence.

Registered artifact paths must resolve to existing regular files; directories are rejected. Goal hashes registered files before and after review and rejects approval if those fingerprints change or the files become unavailable. This is a targeted freshness check, not a full-workspace snapshot, a transactional filesystem lock, or proof that unregistered files and external systems did not change. The reviewer still has to assess the actual objective and criteria.

Review consumes the same allowance as work and coordination. Rejection permits further bounded work or a visible blocker, never an unlimited repair loop or bypass. There is currently no separate reviewer model/budget parameter; normal delegate inheritance applies.

Independent review is not enforced read-only execution or a security sandbox. Reviewer tools can carry the same authority as other inherited tools. Instructions to avoid modifications are instructions, not filesystem protection.

## Persistence and recovery

All goal-owned bookkeeping lives under the resolved global agent root:

```text
~/.pi/agent/goals/
  <goal-id>.jsonl
  <goal-id>.jsonl.lock
```

`getAgentDir()` resolves the root, including `PI_CODING_AGENT_DIR`. A session-directory override does not relocate goals. No goal journal, checkpoint, lock, or fallback is written into the project. Authorized work can still create or edit project files; that is distinct from goal bookkeeping.

The journal has a goal-specific versioned header containing identity, timestamp, and cwd, followed by typed, identified, timestamped, parent-linked full-state checkpoints. It borrows Pi's JSONL representation but is not a native Pi session and is not stored in or loaded through `sessions/`.

Commits are serialized, validate state transitions, verify the held lease and journal, append a checkpoint, and synchronize it before advancing in-memory state. Ownership or write uncertainty makes further commits unsafe rather than silently replacing history. Unreadable versions, malformed records, and torn tails fail closed. Listing reports record errors separately; an absent global store lists empty without creating a project-local substitute.

A per-goal exclusive lease prevents simultaneous active owners. Explicit resume can reclaim a demonstrably dead same-host process owner; live, foreign, or uncertain ownership is rejected. It is not safe to remove a lock merely because a saved record looks old. The store can retain the last valid checkpoint in a recovery error; there is no automatic journal repair, migration, or project-relocation command.

After restart or scope invalidation, nothing resumes automatically. Explicit resume:

1. Acquires the saved goal and verifies its directory exists and matches the current cwd by resolved path.
2. Rejects completed goals and checks registered evidence files are available.
3. Marks ambiguous running attempts interrupted, retaining known summaries and effects.
4. Records the new explicit allowance and requires actual reinspection before further work, acceptance, or review.

The parent inspects files, tests, previous effects, and unresolved blockers, then records findings through `goal_reinspect`. This records the assessment; it does not reconnect a dead process or validate the truth of a report automatically. Missing required state is a blocker, not permission to silently substitute another directory or replay an attempt.

Records can contain sensitive task text, evidence, paths, output summaries, and usage. The implementation requests restrictive POSIX creation modes for directories/files; do not infer Windows ACL isolation from those modes. Back up records before manual recovery and avoid publishing them as innocuous project metadata.

## Pause, teardown, and side effects

Pause synchronously revokes scheduling authority before awaiting journal writes or cleanup. It aborts goal-owned queued/running work through the existing delegate owner, waits for settlement, persists available outcomes, and releases the lease. Cancellation is not an instantaneous process-stop guarantee.

If a returned native continuation is still pending admission, goal also revokes that boundary through host abort. Ordinary unrelated delegate children retain their own ownership; goal pause does not cancel them. Current operations are serialized, so goal does not dispatch a parallel pool of item workers of its own.

Abort, branch navigation, reload, session replacement, and shutdown invalidate the runtime. Global records survive, but live handles, children, and authorization do not become persistent services. Late callbacks/results must not restore authority or complete a replacement run.

Already applied edits, external effects, and available partial output/usage remain; pause is not rollback. Registered artifact checks, shared cwd, and independent review do not provide worktree isolation, conflict prevention, enforced access controls, or automatic merge management. Coordinate write scopes with any other work in the same project.

## Compatibility and verification

Current implementation evidence targets Pi 1.1.0, deterministic local providers, and isolated temporary user roots. It covers source/built co-loading, public delegate integration, native RPC confirmation and lifecycle behavior, and actual fresh workers/reviewers. This does not establish compatibility with every host or provider.

Manual terminal rendering, keyboard/IME acceptance, live-provider interpretation, and Windows ACL privacy are not claimed. See [Testing](development.md#testing) for commands and coverage boundaries. Future candidates in the [roadmap](roadmap.md) are not current guarantees.
