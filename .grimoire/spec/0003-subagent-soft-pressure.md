# Subagent soft pressure

**Spec ID:** 0003
**Status:** Implemented
**Date:** 2026-10-03
**Sources:** The settled refinement handoff in this conversation: the user accepted Option A, the recommended defaults, reminders only, and the spec-only endpoint by replying “按照推荐”; [ADR 0003](../adr/0003-per-delegation-soft-pressure.md). Baseline and installed-host references are identified below.

## Source boundary

- **H — Accepted handoff:** Parent-configured, task-local pressure; two independently configurable time/turn stages with per-value defaults; OR and inclusive threshold semantics; one reminder per stage; warning/urgent meanings; task-running time and completed-turn definitions; identical policy for synchronous/background execution; soft steering rather than hard termination. This handoff supplies the ordinary numerical and counting requirements, not a new architectural decision made by this spec.
- **A3 — New decision:** [ADR 0003 — Per-delegation soft pressure](../adr/0003-per-delegation-soft-pressure.md), Completed. Establishes policy ownership, advisory pressure, child-conversation steering, and preservation of existing lifecycle/result boundaries.
- **B — Existing contracts:** [ADR 0002](../adr/0002-session-owned-background-delegation.md), Completed, and [spec 0002](./0002-session-owned-background-delegation.md), Implemented, establish background ownership, delivery, cancellation, and results. [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md) and [spec 0001](./0001-rpc-subagent-delegation.md) retain the fresh-RPC-child, inheritance, parent-only delegation, and synchronous contracts. Their exclusively synchronous lifecycle is superseded by ADR 0002, not restored here.
- **L — Current implementation baseline:** [src/delegate.ts](../../src/delegate.ts) supplies the shared `runDelegation` runner, initialization-before-task submission, settlement/result collection, four terminal statuses, and both mode entry paths. [src/child.ts](../../src/child.ts) supplies initialization; [src/rpc.ts](../../src/rpc.ts) supplies JSONL transport, `agent_settled` observation, cancellation, and shutdown; [src/background.ts](../../src/background.ts) supplies background ownership and result delivery/query. [README.md](../../README.md) documents the existing modes, explicit cancellation, and absence of a fixed model-task time limit.
- **P — Installed Pi 1.0.0 contract:** [RPC steer](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md#steer), [JSON/RPC agent and turn events](../../node_modules/@earendil-works/pi-coding-agent/docs/json.md#agent-and-turn-events), and [RPC run lifecycle](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc.md#run-lifecycle). Local runtime corroboration: [RPC mode](../../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js), which forwards session events and calls `session.steer`, and [agent-core types](../../node_modules/@earendil-works/pi-agent-core/dist/types.d.ts), which define `turn_end` and the post-tool steering boundary. Host version is recorded in the installed [package metadata](../../node_modules/@earendil-works/pi-coding-agent/package.json).

These sources describe settled requirements, existing behavior, and host feasibility separately. Existing implementation/verification of specs 0001–0002 is not evidence that soft pressure is implemented or tested.

## Requirements

### R1 — Parent-owned, invocation-local configuration

- The parent agent can configure pressure when invoking `delegate`. Configuration belongs to that task, not to an exclusively global setting and not to a choice made by the subagent.
- Each of the two stages has independently configurable elapsed-time and completed-turn thresholds. Each omitted value uses its own corresponding default, including when all configuration is omitted.
- A supplied value does not replace other omitted values. One invocation cannot alter another invocation's effective policy or reminder state.
- Public field names and the interface's time unit are not prescribed here; the conceptual durations and counts below are the requirements.

### Confirmed validation boundary (2026-10-03)

The implementation checkpoint asked how to validate custom policies; the user replied “可以” to the recommended rules:

- Supplied time thresholds must be positive finite numbers, and supplied turn thresholds must be positive integers. `0` and `null` are not disabling values.
- After per-value default resolution, urgent time and turn thresholds must each be strictly greater than their warning counterparts. Do not reorder, normalize, or silently replace contradictory settings.
- Invalid policy configuration is reported explicitly as `failed`, with the erroneous setting identified, before any child process is started. This applies to both synchronous and background calls.

### R2 — Two stages, inclusive OR triggers, and deduplication

| Stage | Default elapsed running time | Default completed turns | Trigger |
| --- | --- | --- | --- |
| Warning | 5 minutes | 20 | Elapsed time reaches its effective threshold **OR** completed turns reach their effective threshold |
| Urgent | 10 minutes | 40 | Elapsed time reaches its effective threshold **OR** completed turns reach their effective threshold |

- For each stage, “reaches” means `>=`, not strictly greater and not requiring both thresholds.
- While the task is running, reaching either threshold triggers that stage's reminder through the delivery boundary in R6.
- Each stage reminds at most once per delegation. Time and turn triggers for the same stage, whether observed together or separately, do not produce two reminders. Later threshold observations do not make that stage recurring.
- The two stages retain independent thresholds and reminder state; this is not one configurable total budget.

### R3 — Required reminder intent

- **Warning:** Instruct the child to prioritize the core goal, stop expanding scope, and prepare a report.
- **Urgent:** Instruct the child to promptly end exploration, consolidate current findings/results, and clearly disclose unfinished work and blockers rather than continuing merely for completeness.
- Exact wording is not fixed. Acceptance concerns the instruction's meaning, not a literal text string or proof that the child obeyed it.

### R4 — Elapsed task-running time

- Start elapsed running time when the actual child task begins, excluding child-process and inherited-tool initialization.
- Include provider execution, tool execution, and waiting during that task. Elapsed time is not limited to time actively generating tokens or executing code.
- A background acknowledgement or the start of child initialization is not the task-running start boundary. Initialization/control-command timeouts in the baseline do not become pressure thresholds or hard model-task limits.

### R5 — Completed execution turns

- One execution turn is one completed assistant response together with its associated tool calls and results.
- Individual tools, nested tools, and parallel calls are not additional execution turns. An assistant response that is still streaming or whose associated tools are still running has not completed that turn.
- Use task execution, not initialization work, as the counting scope. Child `turn_end` is the installed Pi event contract for a completed assistant response and its resulting tools; `message_end`, tool events, and `agent_settled` are not interchangeable turn counters.

### R6 — Soft, model-visible delivery with host limitations

- Submit pressure to the running child's conversation through Pi RPC `steer`; a parent-only UI notification does not satisfy the pressure requirement.
- Steering is eligible for model-visible injection after the current assistant turn has finished executing its tools and before a subsequent provider request. It does not interrupt an in-flight provider request or tool, and it does not skip the current response's associated tools.
- Threshold eligibility, RPC acceptance/queueing, model-input delivery, and model compliance are distinct. A successful steering response is not proof that the model consumed the reminder or that it remains queued; Pi can report a steer as handled by an input handler.
- Pressure does not guarantee a hard maximum runtime, a hard maximum turn count, or successful compliance. No numerical reminder-delivery timing SLA is specified.
- Reaching thresholds must not automatically abort, kill, or impose coercive tool restrictions on the child.

### R7 — Same policy, existing ownership in both modes

- Apply R1–R6 to synchronous and background delegation alike.
- Policy, elapsed-time/turn observations, and reminder state belong to the executing child task and its existing lifecycle. Background pressure is not ended merely because the initiating parent turn completes or is cancelled.
- Preserve synchronous call cancellation and background explicit task cancellation. Preserve session/runtime cleanup and background branch isolation; pressure must not keep an owned child alive or route activity into a replacement ownership scope.

### R8 — Preserve terminal and result semantics

- A reminder alone does not change the task's terminal status. Preserve `completed`, `incomplete`, `failed`, and `cancelled` and the existing distinction between generation-length incompleteness and presentation truncation.
- A child that consolidates unfinished work into its final report in response to pressure is not automatically classified as `incomplete` or `cancelled` merely because it received a reminder or reports unfinished work. The existing run/result semantics determine the status.
- Preserve ordinary settlement, result collection, synchronous return, background completion/query delivery, available usage, and owned-resource cleanup. Pressure is not a replacement completion or cancellation channel.

### Traceability

| Requirements | Settled source or verified boundary | Representative verification |
| --- | --- | --- |
| R1 | H and confirmed validation checkpoint: parent invocation, Option A, per-value defaults, isolation, and invalid-policy rejection; A3 Decision | T3, T4, T11 |
| R2 | H: defaults, `>=`, OR, two independent stages, once per stage | T1, T2, T3, T5 |
| R3 | H: warning and urgent meanings; A3: instruction to finish | T1, T2, T6 |
| R4 | H: actual-task onset and inclusive running time; L: initialization precedes task submission | T1, T6, T7 |
| R5 | H: completed assistant-plus-tools definition; P: `turn_end` definition | T2, T8 |
| R6 | H and A3: soft steering/no hard limits; P: steer queueing and post-tool boundary | T6, T9 |
| R7 | H and A3: same policy for both modes; B and L: existing ownership/cancellation/cleanup | T4, T9, T10 |
| R8 | H and A3: no status change solely from pressure, preserve results; B and L: terminal/result contract | T9, T10 |

## Solution

Extend the existing per-delegation execution contract with the parent's effective two-stage policy and child-local reminder state. Resolve omitted thresholds from the four corresponding defaults. Observe elapsed task-running time and completed assistant turns in the scope of the actual child task, and submit each triggered stage's instruction through RPC steering without converting it into a termination budget.

The existing synchronous entry and background owner both reach `runDelegation`. This is the verified common execution boundary, not a prescription to introduce a particular module, timer, schema, or event-listener implementation. Initialization remains distinct from task execution; task settlement and resource ownership continue to follow the baseline. The installed host exposes the turn and steering contracts needed for pressure, but source inspection does not establish new feature behavior or delivery latency.

**Trace:** R1–R8; A3's Decision and Consequences; L's shared runner; P's runtime/event definitions.

### Necessary seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Invocation policy | Parent `delegate` call → child task execution | Stage-specific optional elapsed-time/turn values for this invocation | Task-local effective thresholds with per-value defaults; no policy/state leakage to another call (R1–R2) |
| Initialization versus task onset | Child initialization → actual task execution | Existing initialization handshake and the actual task's beginning | Running-time/count scope that excludes startup/tool initialization (R4–R5) |
| Execution observations | Child RPC session events and elapsed task time → pressure evaluation | Completed assistant-plus-tools boundary and elapsed running time for the same task | Independent inclusive OR eligibility and once-per-stage reminder state (R2, R4–R5) |
| Reminder injection | Task execution owner → running child Pi conversation | Due stage and the corresponding instruction meaning | RPC steering with post-tool/pre-provider visibility opportunity, not interruption, consumption acknowledgement, or guaranteed compliance (R3, R6) |
| Ownership and outcome | Pressure activity ↔ existing synchronous/background lifecycle and result collection | Task settlement, explicit cancellation, and ownership invalidation | Pressure bounded by existing task ownership, unchanged terminal/result meanings and cleanup (R7–R8) |

These are correctness/ownership contracts, not new prescribed module boundaries or parent telemetry interfaces.

## End-to-End Tests

The following are acceptance scenarios for future verification, not executed tests or an implementation plan. Cases use conceptual elapsed durations/counts, not a proposed public schema. In all cases involving a due stage, distinguish the stage's trigger/submission from later model-input delivery; do not assert an immediate next-provider-request or wall-clock delivery guarantee.

### T1 — Default elapsed-time pressure without enough turns (R2–R4)

- **Given:** The parent delegates without pressure overrides; the initialized child remains running with fewer than 20 completed turns through the warning threshold and fewer than 40 through the urgent threshold.
- **When:** Elapsed task-running time is below, then reaches, 5 minutes; later it reaches 10 minutes.
- **Then:** Before 5 minutes the warning time condition is false. At 5 minutes warning is due without waiting for 20 turns. At 10 minutes urgent is due without waiting for 40 turns. Each reminder conveys its R3 meaning through R6's steering boundary rather than ending the task.

### T2 — Default turn pressure before enough time (R2, R3, R5)

- **Given:** A child completes controlled assistant turns while elapsed time stays below 5 minutes for the warning check and below 10 minutes for the urgent check.
- **When:** Its completed-turn count moves from 19 to 20, and later from 39 to 40.
- **Then:** Warning is due at 20 and urgent at 40, not one turn later and not dependent on reaching the elapsed-time defaults. Instructions have the respective warning/urgent meanings.

### T3 — Independent overrides and per-value defaults (R1–R2)

- **Given:** The parent supplies a warning elapsed threshold of 6 minutes and an urgent turn threshold of 45, omitting warning turns and urgent elapsed time. These are representative ordinary overrides, not validation limits.
- **When:** That child runs through controlled time/turn observations.
- **Then:** Its effective warning thresholds are 6 minutes OR 20 completed turns; urgent thresholds are 10 minutes OR 45 completed turns. Each supplied value changes only its corresponding threshold. A fully omitted policy still has T1/T2's defaults.

### T4 — Invocation isolation across both modes (R1, R7)

- **Given:** Concurrent delegations use different ordinary policies, including a synchronous task and a background task with omitted values.
- **When:** One task reaches its custom thresholds and the parent proceeds after the background acknowledgement.
- **Then:** Each child's pressure follows its own effective policy/state. Custom values and already-issued reminders do not affect the other call. The background child continues to receive eligible pressure independently of ordinary initiating-parent-turn completion/cancellation. Synchronous result waiting and background acknowledgement/result delivery keep their existing roles.

### T5 — Time/turn overlap and subsequent observations (R2)

- **Given:** A running task whose warning stage has not yet triggered.
- **When:** Both warning conditions become true together, or time triggers warning first and turns reach the warning threshold later; subsequent observations remain above those thresholds.
- **Then:** Warning produces at most one reminder, not one per trigger source or observation. Repeat the overlap check for urgent to establish its separate once-only state; issuing warning does not make urgent already issued.

### T6 — A long provider/tool wait delays visibility, not elapsed time (R3, R4, R6)

- **Given:** After actual task onset, a controlled provider request or tool execution stays in flight while a time threshold is reached.
- **When:** Pressure becomes due and the in-flight work later finishes, with the child continuing to a supported steering boundary.
- **Then:** That running/waiting time counts. Pressure neither interrupts the provider/tool nor skips the current response's tools. A queued reminder can enter model input at a post-tool/pre-provider boundary with its R3 meaning. Queue acceptance alone is not treated as model consumption, and no fixed visibility delay is asserted.

### T7 — Initialization is outside the pressure clock (R4–R5)

- **Given:** A child initialization phase is held separately from the actual task, within the existing initialization lifecycle.
- **When:** Initialization completes and the actual task begins; controlled elapsed time and turn observations then reach the task's thresholds.
- **Then:** Initialization time and initialization activity do not contribute to task pressure. A background task's earlier acknowledgement does not start the running-time count. Runtime pressure uses the actual task's elapsed time, including its subsequent provider/tool waits.

### T8 — Tools are not turns (R5)

- **Given:** The child has 19 completed turns and its next assistant response invokes multiple tools, including nested and parallel calls, with elapsed time below the warning threshold.
- **When:** The assistant response finishes streaming but one associated tool remains pending; then all its associated tools/results finish.
- **Then:** The pending turn does not trigger the 20-turn condition. Completion adds one turn and reaches 20, regardless of tool count or execution shape. Tool updates/results and assistant message completion alone do not each add turns.

### T9 — Pressure does not impose termination or a status (R6–R8)

- **Given:** A child has received warning and urgent pressure but deliberately continues, including a controlled long-running tool or further assistant turns.
- **When:** Runtime/turn counts exceed both thresholds; in separate cases the parent explicitly cancels the synchronous call or cancels the background task by identifier.
- **Then:** Threshold crossings alone do not terminate the child, restrict its tools, or classify it as cancelled/incomplete. No hard runtime/turn maximum is claimed. Explicit cancellation still terminates owned execution and reports cancellation under the baseline. The same checks apply in both modes.

### T10 — Normal outcomes, reports, and ownership cleanup remain authoritative (R7–R8)

- **Given:** Pressured tasks subsequently produce normal-stop reports (including reports disclosing unfinished work/blockers), length-limited output, model/RPC failures, or cancellation. Separate running background tasks encounter exit, reload, session replacement, or branch navigation.
- **When:** The existing runner collects outcomes or the existing owner invalidates tasks.
- **Then:** Terminal status follows the existing outcome contract, not reminder issuance or unfinished-work wording. Synchronous output/usage, background completion/query/result/usage, and presentation truncation retain their meanings. Child and initialization resources are cleaned up; pressure does not keep execution alive, wake a closing runtime, or migrate into a replacement scope/branch.

### T11 — Invalid custom configuration is rejected before launch (R1 validation)

- **Given:** A parent invocation supplies a nonpositive/nonfinite time, a nonpositive/fractional turn count, a null setting, or urgent thresholds not strictly greater than warning after applying omitted defaults.
- **When:** It requests synchronous or background delegation.
- **Then:** The request fails explicitly with the invalid setting identified before a child is started. It does not silently reorder, coerce, substitute defaults, or return a successful background acknowledgement. Valid fractional-second thresholds and valid partial overrides remain supported.

## Decisions

- **Choice:** One spec for both existing execution modes, without slices/tickets. **Source:** H's selected spec-only endpoint and single task-local pressure contract.
- **Choice:** Parent invocation ownership and independently configurable two-stage thresholds with per-value defaults. **Source:** H's accepted Option A and A3 Decision. R2's ordinary default values come from H, not an invented global policy.
- **Choice:** Advisory child-conversation steering rather than hard budgets, termination, or tool restrictions. **Source:** H and A3; P verifies the available steering boundary and its limits.
- **Choice:** Retain existing RPC, inheritance, mode, ownership, cancellation, and outcome contracts. **Source:** A3 and B; L confirms the existing common runner and result surfaces.

## Verification guidance and limitations

- Future evidence should control actual task onset, elapsed observations, assistant-turn completion, and provider/tool holds so T1–T8 establish threshold and event ordering without relying on long real-time sleeps or inventing a timing SLA. No particular production timer mechanism is required by this guidance.
- Distinguish transport submission/queueing from reminder text reaching provider/model input in a real Pi host. A controlled child transport alone cannot establish model visibility; a compliant model answer alone cannot establish counting or deduplication. Inspect reminder meaning rather than require literal wording.
- Cover both modes and the existing result/cancellation/ownership paths in T4 and T9–T10. Record the host/version actually verified; installed Pi 1.0.0 source evidence does not promise all-version compatibility or new soft-pressure E2E behavior.
- This refinement only read local sources and wrote/read back this requirements draft. No code, tests, plan, tickets, or downstream implementation/QA are authorized or performed. **(2026-10-04: scoped to the original spec-only stage; implementation and verification were subsequently authorized — see [Implementation Verification](#implementation-verification-2026-10-04).)**

## Out of scope and open boundaries

- Automatic cancellation/kill at pressure thresholds, hard time/turn budgets, guaranteed completion/compliance, coercive tool restrictions, a third tier, recurring reminders, special zero/null disabling modes, new parent pressure notifications/telemetry fields, or a numerical timing SLA are not part of the accepted contract.
- This feature does not revise the existing background lifetime, result-delivery, usage-accounting, child inheritance, or cancellation boundaries.
- Exact public field names, interface time units, internal module layout, and timer implementation remain unprescribed. Conceptual examples above do not select them.
- The user settled custom-policy validation at the implementation checkpoint on 2026-10-03: use the Confirmed validation boundary under R1. Contradictory stage thresholds are rejected before launch, not reordered or coerced. Exact schema names/units remain implementation details.
- No new fact or decision is needed to express the settled contract at the selected Draft/spec-only endpoint. The open boundaries above are not silently resolved by this artifact. Return to the refinement coordinator; no downstream workflow is selected. **(2026-10-04: this describes the original endpoint only; see [Implementation Verification](#implementation-verification-2026-10-04).)**

## Implementation Verification (2026-10-04)

The "Source boundary", "Verification guidance", and "Out of scope and open boundaries" sections above describe the original spec-only stage. Implementation, test authoring/execution and verification were subsequently authorized and completed; this dated section records the execution evidence without changing R1–R8, the solution, or the out-of-scope list.

Implementation: `src/pressure.ts` owns `pressureParameters`, `validatePressureInput`, `resolvePressure` (per-field defaults and the strict-greater cross-stage check), `PressureClock`, and the task-local `TaskPressure` state machine. `src/delegate.ts` registers `pressure`, resolves one policy per invocation, rejects invalid input before any child spawn through the clone-safe `__piDelegatePressureError` path, starts `TaskPressure` only after task onset, submits reminders through the shared serialized steering boundary, and disposes on settlement/abort. `src/status.ts` renders the acknowledged stage as visual-only `pressure: none / warning / urgent`.

| Requirements | Evidence |
| --- | --- |
| R1 (defaults, overrides, validation) | `tests/pressure.test.ts` covers warning/urgent time and turn overrides, mixed partial overrides, per-field defaults, and rejection of unknown nested keys, `afterSeconds`/`afterTurns` misuse and nested value objects. `tests/pressure.integration.test.ts` `invalid cross-stage policies fail before spawning or acknowledging either mode` and `raw null/string/boolean values are rejected before host coercion in both modes` (T11). |
| R2 (stages, OR, deduplication) | `tests/pressure.test.ts` `time first` / `turn first` / `same observation` ordering plus once-per-stage state; integration `sync elapsed OR includes a held provider, excludes initialization, deduplicates later turn triggers, and stays advisory` (T1, T3, T5). |
| R3, R4 (intent, elapsed time) | Integration asserts a held provider counts as running time without interruption and that initialization time is excluded from the task clock (T6, T7); reminder meaning is inspected rather than literal wording. |
| R5 (completed turns) | Integration `unfinished assistant/multiple parallel and nested tools are one completed turn, not tool/message counters` (T8). |
| R7 (both modes, isolation) | Integration `concurrent sync/background calls keep distinct thresholds and once-per-stage state` and `background pressure survives initiating parent completion and retains normal completion/output/separate usage` (T4). |
| R8 (advisory, no termination) | Integration `stays advisory` behavior through continued work, `cancelling the initiating background parent turn does not cancel pressure; explicit task cancel cleans continued work`, `synchronous parent abort still cancels a pressured child and awaits resource cleanup`, `fast completion clears deadlines and cannot create a new child run or late completion`, and `explicit background cancel during gated initialization removes all pre-task resources` (T9, T10). |
| R6 delivery boundary | `tests/pressure.test.ts` covers transport refusal/timeout isolation (`Subagent pressure delivery failed: steer refused`), and `tests/rpc.test.ts` retains settlement/cancellation observation. |

Final post-format checks on Bun 1.4.1 / Pi 1.0.0: `bun test` (371 passed, 0 failed, 3712 assertions, 19 files), `bun run typecheck`, `bun run check` (Biome, error-on-warnings, 46 files) and `git diff --check` all passed.

Limits: tests use deterministic local fixture providers and isolated real Pi RPC processes, without external model credentials. Controlled-fixture visibility evidence establishes the eligible boundary and task-local ordering, not a wall-clock delivery SLA or guaranteed model compliance. Verification remains scoped to Pi 1.0.0; the unchanged out-of-scope list above still excludes hard budgets, automatic cancellation and enforced tool restrictions.

**Superseded rationale for the status change (2026-10-04):** `.grimoire/plans/0006-subagent-soft-pressure.md` previously recorded that spec 0003's and ADR 0003's statuses "remain unchanged because full-artifact completion evidence was not expanded to those combinations" — specifically pressure active across reload/session replacement and presentation truncation. This artifact is promoted to Implemented here on the basis that R1–R8 are realized and mapped to the evidence above; that combined-scenario gap is retained as a stated limit, not as a reason to describe the feature as still in progress. Those combinations continue to be covered compositionally by the existing lifecycle (`tests/background.lifecycle.test.ts`) and presentation (`tests/status.presentation.test.ts`) suites rather than by dedicated new real-host pressure tests.
