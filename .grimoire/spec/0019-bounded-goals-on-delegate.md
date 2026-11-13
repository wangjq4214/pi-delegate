# Bounded goals built on pi-delegate

**Spec ID:** 0019
**Status:** Implemented
**Date:** 2026-11-13

**Amendment:** Conversational creation and runtime-owned confirmation are implemented and verified below under “R7 implementation verification”. The 2026-11-13 baseline evidence remains historical and does not by itself verify R7.

## Sources and coordination contract

- **C1 — Initial request:** The user requested a goal package inspired by [tmonk/pi-goal-x](https://github.com/tmonk/pi-goal-x), depending on the existing `packages/pi-delegate/`.
- **C2 — Accepted product boundary:** The user accepted an independent `packages/pi-goal/`; the parent agent coordinates delegated work rather than doing all work through an automatic continuation prompt. Goal owns decomposition, progress, continuation decisions and completion assessment. Delegate owns execution. Persist goals, progress and checkpoints, require explicit recovery after restart, and include independent completion review in the first increment. Keep the first increment free of general DAG orchestration, multi-level agents and a complex dashboard. The selected endpoint is one spec, not implementation or tickets.
- **C3 — Accepted integration and controls:** The user accepted a formal public package interface in delegate, without deep-importing internals or creating duplicate task managers; pausing stops scheduling and cancels the goal's current children while retaining effects and available results; starting/resuming requires an explicitly supplied finite autonomous allowance covering execution and review, without automatic replenishment per child.
- **C4 — Storage amendment:** The user requested persistence inspired by Pi's session saving format, under the user's global `.pi` directory, not the working directory.
- **C5 — Accepted creation interaction:** The user rejected requiring handwritten JSON and accepted `/goal <natural-language objective>`, discussion with the current parent agent to organize the objective and acceptance conditions, and questions only for necessary missing information, including an explicit finite allowance. Before execution, runtime-owned confirmation shows the objective, conditions, allowance and working directory with Start/Cancel actions. Model-generated structured draft data is not user authorization. Changing the draft invalidates earlier confirmation. Confirmation activates the existing execution/persistence/review flow rather than a new executor. Draft discussion is ordinary chat with normal model usage, not goal-authorized autonomous execution.
- **C6 — Amendment permissions:** The user selected updating this existing spec only. No production edits, implementation plan, tickets, tests, release, commit or CONTEXT/ADR recording are authorized by this amendment.
- **P1 — Inspected Pi documentation:** Installed host `docs/session-format.md`, `docs/sessions.md` and `docs/environment-variables.md` under `C:/Users/Derek Wang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`. These document JSONL, a versioned header, typed timestamped entries, session working-directory association, default storage under `~/.pi/agent/sessions/`, and `PI_CODING_AGENT_DIR` overriding the default `~/.pi/agent` root. The upstream [session-format reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md) is background, not a pinned compatibility promise.
- **P2 — Existing package surfaces:** [delegate manifest](../../packages/pi-delegate/package.json), [entry point](../../packages/pi-delegate/src/index.ts), [registration/runtime composition](../../packages/pi-delegate/src/delegate.ts), [task records](../../packages/pi-delegate/src/tasks.ts), [execution contracts](../../packages/pi-delegate/src/delegation.ts), [background owner](../../packages/pi-delegate/src/background.ts), [usage guide](../../packages/pi-delegate/docs/usage.md) and [runtime guide](../../packages/pi-delegate/docs/runtime.md). The inspected manifest declares version 0.5.1, pins development host dependencies to Pi 1.1.0, and has no public `exports` map. Its runtime is composed inside extension registration rather than exposed as a supported consumer API.
- **P3 — Existing responsibility constraints:** [session-owned background execution](../adr/0002-session-owned-background-delegation.md), as amended by [query-only background results](../adr/0021-query-only-background-result-retrieval.md); [shared runtime admission and accounting](../adr/0006-runtime-concurrency-and-delegated-usage.md); [execution budgets](../adr/0022-opt-in-task-execution-budgets.md); [status-only waiting](../adr/0029-explicit-waiting-with-status-only-responses.md); [independent workspace packages](../adr/0010-independent-workspace-packages.md); and the [delegate roadmap boundaries](../../packages/pi-delegate/docs/roadmap.md). ADR 0006 has Proposed status; current source and documentation, not that status alone, establish existing admission/accounting behavior.
- **P4 — Creation surfaces inspected before this amendment's implementation:** [goal entry point](../../packages/pi-goal/src/index.ts), [controller](../../packages/pi-goal/src/controller.ts) and [README](../../packages/pi-goal/README.md). At amendment inspection, the `/goal` creation branch parsed user-supplied JSON and immediately called `GoalController.create()` before requesting the initial coordinator turn. The controller already validated the objective, acceptance conditions and explicit positive integer allowance and owned execution authorization. These observations establish the amendment's starting point, not an implemented draft/confirmation flow. P2 describes the original pre-implementation snapshot; the dated implementation section records the subsequently added public delegate API.

Under `grimoire-refine`, this artifact consumes the settled requirements above. It does not authorize new domain/architecture decisions, CONTEXT/ADR recording, production edits, ticket slicing, implementation planning, tests or releases. A newly discovered material semantic gap must return to refinement rather than be filled by an implementation assumption.

## Requirements

### R1. Separate goal coordination from delegated execution

1. Add goal as the independent workspace package `packages/pi-goal/`, depending on the existing delegate package through a supported public package interface. Do not copy its runner, deep-import its internal files or create a competing task manager.
2. The parent agent coordinates the objective: derive bounded work units, supply explicit task context, inspect outcomes, update progress, and choose further work, completion review or a blocker requiring the user. Work units and independent review run through delegate.
3. Provide user-accessible ways to create/start a goal, inspect its objective and progress, pause it, and explicitly resume a saved goal. Creation must follow R7's natural-language draft and explicit confirmation flow. Other command aliases and presentation remain unspecified; a complex dashboard is not required.
4. A persisted goal must retain its objective and acceptance conditions, logical work items and progress, available outcome/evidence summaries, checkpoints, stop reasons, review results and allowance state. Distinguish logical goal work items from transient delegate task handles and distinct execution attempts.
5. A child reporting `completed` does not itself satisfy a work item's acceptance conditions or complete the goal. Preserve the meanings of failed, incomplete and cancelled results instead of translating them into success.

**Basis:** C1–C3; P2–P3.

### R2. One supported delegate integration boundary

1. Expose a supported package entry point for goal to submit work, observe task state and available results, and cancel work it owns. Exchange explicit task/context, working directory, applicable invocation settings and cancellation ownership; return task identity, execution state, available output, reported usage and stop/failure information. Exact exported names and transport plumbing are implementation details, not a second orchestration design.
2. Goal submissions and ordinary delegate tool calls in the same owning runtime must use the same task records, admission control, execution owners and delegated accounting. Loading goal together with delegate must not duplicate tool registrations, schedulers or usage charges.
3. Preserve ordinary synchronous and background calls. Background completion must remain query-only: no unsolicited result messages or idle-parent wake-up are added to delegate. Goal's explicitly authorized continuation is owned by goal, not a change to every background task's delivery policy.
4. If background observation is used, waiting returns status; report retrieval remains separate. Goal may use the supported integration boundary to obtain results without repeatedly injecting full reports into parent context.
5. Preserve fresh-child execution, explicit context transfer, tool reconstruction and the existing parent-only delegation boundary. Loading inherited goal code in a child must not let that child acquire the parent's goal, start its continuation loop or recursively orchestrate more workers.
6. A missing or incompatible public integration must be reported; do not silently replace it with an internal import or a separate executor. Exact supported host/package versions require implementation verification; P1 does not establish compatibility with the pinned host in P2.

**Basis:** C2–C3; P2–P3. The public interface is a required additive change, not an already implemented feature.

### R3. Global, session-inspired persistence

1. Store all goal-owned durable/runtime storage outside the working directory: records, checkpoints and any goal-specific indexes, locks or auxiliary persistence. Use the user-level Pi agent root, defaulting to `~/.pi/agent`, with goals under its own `goals/` namespace. Respect the host's resolved global agent root, including `PI_CODING_AGENT_DIR`; do not derive this location from `cwd`, a project-local `.pi/`, or a session-directory override.
2. Reference Pi's JSONL representation: a versioned header carrying goal identity, creation time and working-directory association, followed by typed, identified, timestamped records sufficient to reconstruct saved state and attempts. Parent-entry links may express ordering/checkpoint ancestry; borrowing this representation does not require a goal branching editor.
3. Keep a goal-specific schema and version. Do not label a goal journal as a native Pi session, mix it into `sessions/`, require Pi's session loader to parse it, or edit native session files to make global goal storage work.
4. Associate each record with a stable goal ID and its work directory. Global storage must not make the same goal silently run against whichever directory happens to be open. Directory grouping and timestamp-plus-ID filenames may follow Pi's convention; their exact spelling is not a public contract, and header identity must not rely on filename decoding alone.
5. Persist essential progress and available result/evidence summaries, not merely a live task ID or a temporary output-file path. If referenced files or evidence are later unavailable, disclose that limitation rather than presenting the reference as verified evidence.
6. Loading must not silently overwrite another goal, discard previously committed progress, or interpret unreadable/unsupported state as permission to launch fresh work. Interrupted writes and competing access must not turn one saved goal into duplicate active execution. The persistence mechanism must surface an actionable error or recovery-needed state when it cannot safely reconstruct ownership/progress.
7. The prohibition on project-local storage concerns goal bookkeeping, not files that the authorized delegated work is meant to create or edit in the project. Persistence failures must not silently fall back to a project-local directory.

**Basis:** C2–C4 and the verified representation/root conventions in P1. This adopts the storage amendment, not pi-goal-x's project-local goal layout.

### R4. Explicit, bounded continuation

1. Starting or resuming autonomous work requires an explicit positive finite allowance. There is no implicit unlimited setting or unspecified numeric default in this contract. Show the effective allowance and remaining capacity to the user and coordinator.
2. The allowance is shared across the goal's automatic execution and independent review, not separately replenished for each child. Charge each goal-initiated worker or reviewer dispatch against that allowance before admitting more work; goal-triggered coordinator continuations must not provide an unmetered route around the bound.
3. Completion of one child, rejection by a reviewer, or a failed/incomplete attempt does not reset the allowance. Persist consumed capacity and attempts so reload/recovery cannot silently grant fresh work. A user-authorized start/resume establishes its explicitly supplied allowance; retain prior run history.
4. When there is no remaining capacity to dispatch the next needed work or review, pause with an allowance-exhausted reason and save progress. Do not add an unbudgeted model call merely to produce a wrap-up, retry a reviewer or restate a blocker.
5. Keep this goal-level bound distinct from delegate's per-task time/turn execution budgets, advisory pressure and reported usage. None supplies an exact token, monetary, provider-request or process-stop ceiling for the whole goal.
6. Continue only while this runtime still owns the active goal and the goal is authorized to run. Completion, pause, unresolved blockers needing user input and scope teardown prevent further goal-driven dispatches. A late result or old continuation must not restart a stopped goal or a replacement runtime.

**Basis:** C2–C3; P3. Dispatch accounting implements the accepted finite continuation boundary; it does not redefine delegate's within-task turn counting.

### R5. Pause, teardown and deliberate recovery

1. User pause immediately revokes permission to schedule further goal work and requests cancellation of the goal's queued/running workers and reviewers. Wait for the existing execution owner's cleanup before treating those children as settled; cancellation is not an instantaneous process-stop guarantee.
2. Pause only the selected goal's work. It must not cancel unrelated ordinary delegations or another independently owned goal. Preserve already applied edits, external effects, available partial output/usage and honest attempt status; cancellation is not rollback.
3. Exit, reload, session replacement or branch navigation retain delegate's existing invalidation/cancellation rules. Global goal records survive, but live execution and branch/runtime task handles do not become persistent services.
4. After restart or invalidation, saved unfinished work must be inspectable but must not resume automatically. Explicit resume supplies an allowance and rechecks the actual work directory, available artifacts/results, unresolved blockers and previous attempt state before dispatching more work.
5. Do not claim to reconnect a dead child process or reuse an invalid task handle. An interrupted or ambiguous attempt is not automatically replayed: inspect the current effects and remaining work before creating a fresh bounded attempt. A missing work directory or unverifiable required state is a visible blocker, not permission to substitute the current directory.

**Basis:** C2–C4; P2–P3. Durable goal state does not change delegate's session-local execution lifetime.

### R6. Independent completion review

1. Before marking a goal complete, obtain an independent assessment through a fresh delegated reviewer, separate from the worker that produced the result. Supply the objective, acceptance conditions, relevant attempt summaries and artifact/evidence references explicitly; do not depend on copying the entire parent's conversation.
2. Review must assess the objective and evidence, not merely the worker's reported terminal status. Retain an interpretable pass/reject outcome and its reasons/evidence in the global record.
3. Only an affirmative review of the current objective and relevant result state permits completion. A rejected, failed, cancelled, missing or no-longer-current review cannot mark the goal complete. If the work or acceptance conditions change, a prior review must not be reused as approval of the new state.
4. On review rejection, the coordinator may choose further bounded work when allowance remains, or expose a blocker/pause. Review failure or allowance exhaustion leaves the goal unfinished; there is no implicit bypass or unlimited repair loop.
5. Review and its cancellation belong to the goal's allowance and ownership controls. Independent review is not an OS sandbox or proof of filesystem isolation; do not present instructional restrictions as enforced security guarantees.

**Basis:** C2–C3; P3's distinction between task termination, advisory handoff and acceptance.

### R7. Conversational creation with runtime-owned start confirmation

1. Accept `/goal <natural-language objective>` as the creation entry. Users must not need to author JSON or an internal schema. Structured tool parameters and the existing JSONL journal remain internal representations; replacing the input interaction does not require replacing them.
2. Use the current parent agent to organize the objective and acceptance conditions through ordinary conversation. Ask about consequential ambiguities or missing required information rather than requiring a complete initial specification or introducing a separate requirements agent. The user can revise the draft before starting.
3. Draft discussion must not activate the goal, dispatch goal workers/reviewers or enter goal-driven automatic continuation. It is ordinary user-driven chat with normal model usage, not usage claimed to be covered by an as-yet-unapproved execution allowance.
4. Obtain an explicitly supplied positive finite allowance before offering a valid start. Ask when it is missing; do not silently insert a numeric default or unlimited authorization. Explain that it covers goal-initiated coordination, worker and reviewer dispatches, not a count of chat turns or an exact provider-request/cost cap. Preserve R4's shared accounting once execution begins.
5. Before creation activates execution, show the current objective, acceptance conditions, explicit allowance and working directory in a runtime-owned confirmation interaction with Start and Cancel actions. The runtime must obtain the user's affirmative action for that displayed draft. A model-supplied field such as `confirmed: true`, a tool call, or the model's interpretation of conversational assent must not substitute for that action. Missing or unavailable confirmation leaves the draft non-executing.
6. Bind confirmation to the displayed draft and working directory. Any change to the objective, acceptance conditions, allowance or working directory invalidates prior confirmation and requires fresh confirmation of the changed values. Cancel or dismissal must not launch work or queue goal-driven continuation; stale confirmation must not start a changed draft.
7. After valid confirmation, validate and activate the confirmed values through the existing goal controller, global persistence and supported delegate integration. Preserve active-goal ownership checks, idle-parent admission, allowance charging, pause/recovery controls and mandatory independent review. Do not introduce a parallel executor or relax R1–R6 to support the new input flow.
8. Any model-facing draft-submission capability is parent-only and conveys proposed structured values, not execution authority. Keep the runtime's confirmation decision separate from draft generation and enforce the boundary in code rather than prompt instructions alone. This amendment does not prescribe tool names, a draft journal schema or exact confirmation-widget APIs.

**Basis:** C5–C6; P4. The creation interaction is newly required; the original spec did not require handwritten JSON.

## Solution and necessary seams

Goal is the opt-in coordination layer; delegate remains the execution layer. Goal persists its own state in global storage and coordinates fresh bounded attempts through delegate's new supported interface. This contract does not prescribe internal class boundaries, event names or a scheduling algorithm.

For creation, the accepted flow is natural-language request → ordinary parent-agent discussion → structured draft → runtime-owned Start/Cancel confirmation → existing execution lifecycle. The parent proposes the draft; the runtime owns confirmation and activation. For example, `/goal Fix the parser regression and keep existing tests passing` enters discussion, not execution. Once the user supplies an allowance, the confirmation presents the resulting objective, conditions, allowance and actual working directory. Only the user's Start action crosses into autonomous execution. Draft-storage details and exact host UI calls are not part of this requirements contract.

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Goal controls | User/parent → goal | Objective, acceptance conditions, explicit allowance, pause/resume intent | Inspectable progress, remaining allowance, review/stop reasons; no hidden autonomous start |
| Draft discussion | User ↔ current parent agent | Natural-language objective, clarifications, revised conditions and explicit allowance | An editable structured proposal; no active goal or goal-driven dispatch |
| Draft submission | Parent agent → goal runtime | Proposed objective, acceptance conditions and allowance | Validated draft for display; no model-granted execution authority; parent-only reachability |
| Start confirmation | User ↔ goal runtime → existing goal controller | Displayed draft and working directory, explicit user Start/Cancel action | Activation only for the confirmed values; invalidation on changes; cancellation without execution |
| Public execution capability | Goal → delegate runtime | Explicit work/context/cwd/settings and owned cancellation | Shared admission/task identity, status/results, available usage and cleanup; unchanged ordinary calls |
| Goal journal | Goal ↔ user-global Pi storage | Goal-specific version/identity/cwd and typed progress/attempt records | Recoverable state outside the project; errors instead of silent replacement/local fallback |
| Independent review | Coordinator → fresh delegated reviewer | Current criteria and relevant evidence | Assessment bound to current goal/result state, consuming the same allowance |
| Runtime boundary | Host/delegate lifecycle → goal | Scope invalidation and terminal observations | Revoked dispatch authority, owned cleanup and saved unfinished state; explicit recovery only |

## End-to-End Tests

### A. Create, execute and independently complete
- **Given:** A goal with acceptance conditions, an explicit allowance sufficient for the exercised dispatches, and a usable delegate integration.
- **When:** The parent coordinates a bounded work unit, retrieves the worker result, and requests independent review of the resulting evidence.
- **Then:** Both attempts use the shared delegate runtime and consume the goal allowance. A worker's `completed` result alone leaves the goal unfinished; affirmative current review permits completion. Progress, attempts and review are inspectable from the global record.

### B. No project-local bookkeeping, including root overrides
- **Given:** A clean project directory and a user-global Pi root, tested both with the default and a configured `PI_CODING_AGENT_DIR`.
- **When:** A goal is created, progresses, pauses and is loaded again.
- **Then:** Goal records and any auxiliary goal storage exist only under that global root's `goals/` namespace; no project-local goal file, `.pi/` metadata, lock or checkpoint appears. Native Pi session files are not rewritten to store the goal. A global storage error is reported without a local fallback.

### C. Recover without reviving or blindly replaying work
- **Given:** A saved unfinished goal with an interrupted attempt, existing project changes and a now-invalid delegate handle.
- **When:** Pi restarts, then the user explicitly resumes with a finite allowance.
- **Then:** Loading alone dispatches nothing. Resume checks the stored working directory and actual effects, explains the interrupted attempt, and uses fresh execution only for reassessed remaining work. Launching Pi from another project does not silently redirect the goal there; a missing work directory blocks execution.

### D. Pause races with worker/reviewer settlement
- **Given:** Goal-owned queued/running work or review alongside an unrelated ordinary delegation.
- **When:** The user pauses while a child result or continuation is arriving.
- **Then:** No further goal dispatch is admitted, goal-owned children are cancelled through delegate and cleanup is observed, available results/effects remain, and late completion cannot restart or incorrectly complete the goal. The unrelated delegation retains its own lifecycle.

### E. Exhaust the shared allowance before review
- **Given:** A finite allowance with only enough remaining capacity for the worker but not the required subsequent review.
- **When:** The worker returns success.
- **Then:** The goal pauses unfinished with an exhausted-allowance reason. Neither review nor an extra wrap-up/repair model call runs without renewed explicit authorization. Reloading does not replenish consumed capacity, and individual child completion does not reset it.

### F. Reject or invalidate a completion assessment
- **Given:** A worker claims success but the independent reviewer finds an unmet acceptance condition, fails, is cancelled, or assessed an earlier result state.
- **When:** The coordinator processes that assessment.
- **Then:** The goal remains unfinished with the available assessment/error reason saved. Further work/review respects remaining allowance and pause controls; missing evidence is disclosed instead of treated as approval.

### G. Co-load goal and delegate without duplicate runtime ownership
- **Given:** Both packages loaded in the parent and ordinary synchronous/background delegate calls already supported.
- **When:** Goal dispatches work and the user also invokes ordinary delegate tools.
- **Then:** Registration, task discovery, admission and usage have one shared owner, with no double charge or duplicated execution. Background results remain query-only; waiting remains status-only. A delegated child cannot inherit authority to operate the parent's goal loop.

### H. Unsafe journal recovery does not launch work
- **Given:** Goal records with an interrupted write, an unsupported version or competing ownership, and previously committed progress.
- **When:** The records are inspected or resume is requested.
- **Then:** Valid saved progress is not silently replaced. Unsafe reconstruction produces a visible error/recovery-needed state and no duplicate or newly inferred execution. Missing external evidence remains visibly unavailable.

### I. Natural-language request through confirmed execution
- **Given:** An idle parent, usable delegate integration and no active goal.
- **When:** The user enters `/goal Fix the parser regression and keep existing tests passing`, resolves any necessary questions, supplies an explicit allowance and chooses Start on the runtime confirmation.
- **Then:** The user never authors JSON. The current parent organizes the objective and acceptance conditions. No goal worker, reviewer or autonomous continuation runs during discussion. The confirmation displays those values, the allowance and actual working directory. Start activates the confirmed goal through the existing controller and execution flow, with R4 accounting and R6 review still required.

### J. Missing allowance, cancellation or dismissal does not start work
- **Given:** A natural-language draft whose allowance has not been supplied, or a complete draft awaiting confirmation.
- **When:** The user has not provided an allowance, chooses Cancel, or dismisses confirmation without choosing Start.
- **Then:** Missing allowance prompts a question rather than a default. There is no active goal, goal worker/reviewer dispatch or queued goal-driven continuation from that draft. Ordinary clarification remains ordinary chat and is not represented as already covered by goal execution allowance.

### K. Revised draft cannot reuse old confirmation
- **Given:** A draft displayed for confirmation.
- **When:** The objective, acceptance conditions, allowance or working directory changes, and an old confirmation action is subsequently received.
- **Then:** That action cannot activate the revised draft. A new confirmation must display and authorize the changed values before execution can start.

### L. Model output cannot manufacture user authorization
- **Given:** A draft-submission capability available to the parent agent, with no valid affirmative runtime confirmation.
- **When:** The model submits structured data claiming approval, interprets a chat reply as permission, or attempts activation while user confirmation is unavailable.
- **Then:** No goal execution or automatic continuation starts. Only the runtime-owned affirmative user action for the displayed draft grants activation. Delegated children cannot reach the parent-only draft-submission capability, including through discovery or codemode.

## Decisions and limits

- **Separate package and responsibility ownership:** C1–C3. The new goal layer, not delegate's general task runtime, owns autonomous coordination. Existing package independence is preserved; this does not make goal depend on pi-open-tui.
- **Formal package interface, shared runtime:** C3 and P2. Current internal runner types are inspection evidence, not a supported API to consume unchanged.
- **Global session-inspired journal:** C4 and P1. Use JSONL/header/typed-record conventions with a distinct goal schema and namespace. Global persistence is not native session import compatibility, arbitrary goal-tree navigation or durable child execution.
- **Finite explicit authorization and mandatory review:** C2–C3 and C5. No numeric allowance default is prescribed. C5 now establishes the natural-language `/goal` creation entry and explicit Start/Cancel confirmation; other command aliases, exported identifiers and journal field spellings remain implementation details.
- **Conversational draft, program-controlled authorization:** C5. Use the current parent rather than a separate requirements agent. Model-generated structure is acceptable; model-generated user approval is not. Reuse the existing execution core after confirmation. No assumption about a particular host confirmation API or durable draft representation is required to state this contract.
- **Compatibility limitation:** The global host documentation inspected for the format may describe a newer host than delegate's pinned Pi 1.1.0. Implementation must verify its actual supported host; do not transplant pi-goal-x's host API assumptions.
- **Knowledge recording:** CONTEXT/ADR writes remain unauthorized. The settled cross-package ownership, global-persistence and runtime-owned start-authorization choices are preserved in this selected spec; separate knowledge-store recording remains Pending, blocked on user authorization. This does not block completion of the spec amendment.

## Verification guidance

The scenarios above define required observable behavior, not automatically verified outcomes. Implementation verification must cover the published/built package interface as well as source loading, actual-host lifecycle behavior, global-path resolution on supported platforms, and unchanged delegate regression behavior. Use isolated temporary user roots for storage tests; do not write acceptance fixtures into the user's real goal store. At the refinement endpoint no runtime checks had been run; the dated implementation section below records subsequent evidence and its limits, without claiming manual terminal acceptance, broader host-version compatibility or live-provider verification.

For the R7 amendment, verify scenarios I–L at the actual parent-agent/host confirmation boundary, not only through mocked model text or controller unit calls. Include draft changes and delayed confirmation, cancellation/dismissal, missing allowance, model-supplied approval and child tool reachability. The existing idle-parent, active-goal ownership, dispatch accounting, pause/recovery and independent-review scenarios remain regression obligations. No runtime tests or manual confirmation-UI checks had been run at the spec-only amendment stage; the R7 implementation verification section below records the subsequently authorized execution evidence.

## Out of Scope

- Production implementation, implementation plans, tickets, package publication/release automation, staging or commits in this refinement endpoint.
- Cloning all pi-goal-x commands, settings, task modes, storage machinery or UI.
- General workflow/DAG engines, recursive agent trees, a complex goal dashboard, or moving orchestration into ordinary delegate calls.
- Background work surviving process exit, automatic cross-session resumption, silent replay of interrupted work, or automatic task-result delivery/wake-up added to delegate.
- Project-local goal bookkeeping, mandatory copying of full conversations, or claiming that referenced temporary output files are durable goal records.
- Plugin-managed Git worktrees/merges, side-effect rollback, enforced auditor sandboxing, and exact token/cost/provider-billing ceilings.

## Implementation verification — 2026-11-13

**Historical baseline only:** This section records implementation before C5/R7. It does not establish the amended creation interaction, confirmation authorization or scenarios I–L. R7 was pending at the spec-only amendment stage; its subsequent implementation and authorization are recorded separately below.

The user's subsequent explicit `grimoire-loop` invocation authorized implementation and quality gates, superseding only this document's earlier refinement-endpoint prohibition on implementation/planning/tests. Product exclusions, no publication/commit, and the separate CONTEXT/ADR authorization gate remain unchanged.

Implemented in `packages/pi-goal/` with delegate's supported `/api` entry. Goal remains a private local workspace package and must be loaded alongside delegate; npm dependency installation alone does not load a Pi extension. The implementation plan is saved locally at `.grimoire/plans/0027-bounded-goals-on-delegate.md` (existing ignore policy applies).

| Requirement | Implemented behavior and verification |
| --- | --- |
| R1 | Baseline `controller.ts`, `index.ts` and command/tool contracts; controller tests and actual-host creation → work → explicit evidence acceptance → independent review. Worker completion alone remains pending. The amended R1.3 creation entry depends on R7 and is not covered by this historical verification. |
| R2 | Delegate `api.ts`/`api-service.ts` reuse registration's execution, records, admission and accounting; API registration, published-files-only declarations/import, source/built co-load in both orders, shared query/usage and direct/search/codemode child-exclusion tests. Ordinary delegate regressions pass. |
| R3 | `model.ts`/`store.ts` implement global-root JSONL checkpoints and exclusive ownership; isolated storage fault/collision/permission/corruption tests and actual-host default/override roots with no project bookkeeping. A missing global store lists empty without creating local files. |
| R4 | One explicitly supplied finite allowance charges coordinator, worker and reviewer dispatches; core and native-host tests cover exhaustion, no reset/reload autorun, ordinary continuation, and source/built pending-boundary pause with no new request/attempt/child. |
| R5 | Synchronous authority revocation, owned AbortSignal cancellation and cleanup, explicit recovery/cwd/artifact reinspection, before/committed navigation invalidation and late-result guards; controller fault injection, real process-exit recovery, host pause/navigation/reload/shutdown and unrelated-background isolation. Shared runner retains available bounded manual-cancellation text and already collected final-output previews/paths. |
| R6 | Fresh delegated reviewer, explicit current approval gate and regular-file evidence fingerprints; rejection/error/partial/malformed output, changed evidence, late approval and pause-during-completion-commit regressions. Directory artifacts are explicitly unsupported rather than inaccurately fingerprinted. |

Joint Code Risk and Intent Check initially found four blockers: pause during completion persistence, nested directory evidence freshness, irrevocable returned continuation, and manual-cancellation output loss. Each was fixed and its affected paths reassessed; regressions demonstrated failure before correction and passing behavior afterward. Native testing additionally corrected the mistaken assumption that a pre-proposal `context.canContinue:false` forbids adding a continuation. Final integrated verification caught and fixed loss of an already formatted output preview/path when cancellation occurs during graceful cleanup; the existing RPC regression now passes without weakening its assertions.

Final commands from the repository root, after production fixes and formatting:

- `bun run check`, `bun run typecheck`, `bun run build`, and `git diff --check`: passed.
- `env -u PI_DELEGATE_CHILD -u PI_DELEGATE_SNAPSHOT bun run test`: passed, **1,211 tests passed and 2 platform skips, zero failures**. Counts: root 65; delegate 711 + 1 skip; dollar-skills 21; goal 64 + 1 skip; open-tui 350.
- Goal's 18 actual pinned Pi 1.1.0 RPC scenarios exercise real fresh worker/reviewer processes, source and built entries, global persistence, shared public API, registration exclusion, stopping/recovery and pending-boundary revocation. Tests use deterministic local providers and temporary user roots, not paid providers or the user's goal store.

Evidence is limited to the tested local environment: Bun 1.4.1 / Node 26.13.0, delegate/goal's pinned Pi 1.1.0, and the independently pinned existing workspace packages. The two skips are POSIX-only permissions cases on Windows; Windows ACL privacy, live-provider behavior, manual terminal keyboard/IME acceptance and other host versions are not claimed. Goal allowance is a dispatch bound, not a ceiling on native within-run tool/model turns, spending or process-stop timing. No release, commit, ticket, CONTEXT or ADR write was performed.

## R7 implementation verification — conversational creation amendment

The user's new explicit `grimoire-loop` invocation authorized implementation, tests, joint code-risk/intent assessment, fixes, affected rechecks, final integrated verification and formatting for R7. It supersedes C6's spec-only execution restriction for this implementation turn, not the separate CONTEXT/ADR permission gate, product boundaries, or no-release/no-commit limits. The existing local plan at `.grimoire/plans/0027-bounded-goals-on-delegate.md` was extended rather than creating an unrelated plan.

Implemented in [creation.ts](../../packages/pi-goal/src/creation.ts) and the existing goal entry point. The current parent discusses the natural-language request; `goal_propose` submits copied, immutable values to native Start/Cancel confirmation. Confirmation and awaited creation remain inside one live cancellable tool invocation. The initial coordinator allowance is persisted before returning control to sibling/nested tools; native boundary admission reuses that charge, while `turn_start` consumes the handoff for direct mixed-batch/codemode continuation. Work/review cannot dispatch while activation is still settling. The `/goal` command retains idle-parent admission, and no second executor, detached approval/idle callback, journal schema or ordinary delegate delivery change was added.

| Requirement / scenario | Current implementation and evidence |
| --- | --- |
| R1.3, R7.1–2 / I | Natural-language command and current-parent draft context; actual pinned-host source/built creation, follow-up allowance and both extension co-load orders. No handwritten JSON is required; JSON with a claimed approval is not a creation shortcut. |
| R7.3 / I–J | Draft state is session-local and non-executing. Held native confirmation asserts no journal, worker/reviewer or goal continuation; missing allowance prompts ordinary clarification with no default or automatic drafting loop. Normal clarification model usage remains distinct from execution allowance. |
| R7.4–5 / I–J, L | Positive safe-integer validation, displayed objective/conditions/allowance/cwd and exact native Start/Cancel result. Unit/adapter tests reject missing/invalid allowance, invented approval fields, unavailable UI, transport failure and non-Start responses. Native Cancel/dismissal produces no execution or extra drafting generation. |
| R7.6 / J–L | Frozen copied snapshots, identity/cwd binding and invalidation on changes. Native steering changes allowance while confirmation is held; the late old Start cannot activate either draft. Native pause/abort and source/built initial-admission revocation tests pass. Controlled adapter tests hold real creation/persistence, revoke authority before completion, and verify paused durable state, no dispatch and released leases. |
| R7.7, R4 / I, L | Existing controller/journal/delegate ownership and independent review retained. Source/built mixed-tool and parent-codemode creation with allowance 1 cannot start a worker; allowance 3 produces exactly coordinator/worker/reviewer without double-charging the initial coordinator. Direct-turn and concurrent-activation adapter cases cover the two handoff paths and the activation guard. |
| R7.8 / L, G | `goal_propose` joins the existing parent-only declaration. Actual fresh children cannot register, discover or call goal tools, including through search and codemode; source/built shared-runtime integration remains passing. |
| R1–R6 / A–H | Existing controller/storage tests and all 18 prior actual-host integration/lifecycle scenarios were retained or migrated to the confirmed natural-language entry, including exhaustion, independent review, pause isolation, recovery and global roots. |

Joint assessment and affected rechecks found and resolved two consequential admission defects. First, a real-host counterexample showed detached approved activation could survive native abort during a later `agent_settled` handler; live-tool activation removes that inactive authorization window. Second, real mixed-tool and codemode counterexamples spent allowance 1 on a worker before initial coordinator accounting; precharging before returning authority, tracking the first native turn and guarding concurrent work/review close that bypass without double-charging. Both paths have concrete failing-before-correction evidence and passing affected tests. Final coordinator rechecks reconciled the Code Risk findings and Intent Check gaps; no confirmed blocker remains. Controlled persistence-cancellation cases also close the review's outstanding adapter-evidence gap.

Final verification after the production/accounting corrections, test updates and touched-file formatting:

- `bun run check`, `bun run typecheck`, `bun run build` and `git diff --check`: passed.
- `env -u PI_DELEGATE_CHILD -u PI_DELEGATE_SNAPSHOT bun run test`: passed, **1,323 passed, 2 platform skips, zero failures**. Counts: root 65; delegate 711 + 1 skip; dollar-skills 21; goal 176 + 1 skip; open-tui 350.
- Goal includes 32 draft-lifecycle cases, 57 adapter cases and 41 actual pinned Pi 1.1.0 RPC scenarios (23 new creation cases plus 18 migrated baseline scenarios), alongside existing controller/storage coverage. Tests use deterministic local providers and isolated temporary user roots, not paid providers or the user's goal store.

Evidence is limited to the tested pinned host and local environment. RPC confirmation payloads/actions and lifecycle behavior are verified; manual terminal rendering, keyboard/IME acceptance, live-provider interpretation and other host versions are not claimed. The two skips remain POSIX-only permissions cases on Windows; Windows ACL privacy is not established. Goal allowance remains a dispatch bound, not a token/cost/provider-request/process-stop ceiling. No release, commit, ticket, CONTEXT or ADR write was performed; separate knowledge-store recording remains Pending on user authorization. The unrelated `.omnidiff.toml` was left unchanged.
