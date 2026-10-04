# Background runtime steering

**Spec ID:** 0005
**Status:** Draft
**Date:** 2026-10-04
**Sources:** [Runtime steering roadmap candidate](../../docs/roadmap.md#todo); accepted refinement handoff H below; [ADR 0004 — Task-addressed runtime steering](../adr/0004-task-addressed-runtime-steering.md).

## Source and coordination boundary

- **H — Accepted handoff:** The user accepted the coordinator's first-version recommendations by invoking `grimoire-spec` and replying “可以继续吧”. The parent can add context, narrow scope, or request a final report from the existing active background child without cancellation/restart. Scope is existing background `taskId` in the current session/branch, pure-text instructions, explicit initialization `not_ready` without readiness waiting or later-delivery buffering, and rejection of unknown, terminal, cancelling, or invalidated work. The accepted runner-owned narrow control, shared manual/pressure submission boundary, raw prefixed RPC steer, receipt limitations, lifecycle preservation, parent-only reachability, and exclusions are expressed below. No new behavioral assumptions are authorized. `delegate_steer({ taskId, message })` illustrates the capability, not a fixed tool/schema name.
- **A4 — Additive decision:** [ADR 0004](../adr/0004-task-addressed-runtime-steering.md), Proposed, records H's ownership, plain-instruction transport, submission ordering, acceptance-versus-consumption, and lifecycle choices. It does not supersede ADRs 0001–0003 or establish implemented steering.
- **B — Baseline contracts:** [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md), Superseded only in synchronous exclusivity by [ADR 0002](../adr/0002-session-owned-background-delegation.md), Completed, retains fresh RPC children, conventional inherited-tool reinitialization, and parent-only registration/reachability. [Spec 0002](./0002-session-owned-background-delegation.md), Implemented, establishes background ownership, four outcomes, query/completion delivery, available usage, and cleanup. [ADR 0003](../adr/0003-per-delegation-soft-pressure.md), Implementing, and [spec 0003](./0003-subagent-soft-pressure.md), Draft, establish advisory pressure and its time/turn/stage semantics. [Spec 0004](./0004-agent-status-ui.md#r2--numeric-identity-and-title) distinguishes numeric UI labels from background IDs; it does not establish a steering interface. [CONTEXT.md](../CONTEXT.md) currently contains no domain definitions.
- **L — Inspected repository baseline:** [src/delegate.ts](../../src/delegate.ts) owns `runDelegation`, child RPC initialization, original-task submission, automatic pressure, settlement/result collection, cleanup, parent tool registration, and lifecycle hooks. [src/background.ts](../../src/background.ts) owns task IDs/controllers/results and scope invalidation: its acknowledgement precedes initialization, and its public `running` view includes initialization. [src/child.ts](../../src/child.ts) validates inherited tools during the initialization handshake. [src/rpc.ts](../../src/rpc.ts) serializes stdin writes, preserves successful response data, applies control-request timeouts, and observes `agent_settled`. [src/pressure.ts](../../src/pressure.ts) currently owns a pressure-local submission tail and task-local observations/stage state. [src/inheritance.ts](../../src/inheritance.ts) and [src/index.ts](../../src/index.ts) implement parent-only filtering, child validation, and registration branching. [Runtime and safety](../../docs/runtime.md) documents existing ownership, shared workspace, and non-sandbox limits. No task-addressed steering capability exists in this baseline.
- **P — Installed-host feasibility, Pi and agent-core 1.0.0:** [RPC steer](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md#steer), [steering modes](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md#set_steering_mode), [run lifecycle](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc.md#run-lifecycle), [agent/turn events](../../node_modules/@earendil-works/pi-coding-agent/docs/json.md#agent-and-turn-events), [queue events](../../node_modules/@earendil-works/pi-coding-agent/docs/json.md#queue-and-state-events), and [extension reachability](../../node_modules/@earendil-works/pi-coding-agent/docs/extensions.md#tool-exposure). Runtime corroboration is in [RPC mode][host-rpc], [AgentSession][host-session], [agent-core Agent][host-agent], and [agent loop][host-loop]. Versions are recorded in the installed [Pi package](../../node_modules/@earendil-works/pi-coding-agent/package.json) and [agent-core package](../../node_modules/@earendil-works/pi-agent-core/package.json).

| Host observation | Read-only source support | Contract consequence |
| --- | --- | --- |
| Raw steer returns `queued` or input-handler `handled`; idle steer merely queues | RPC mode `steer` handler; AgentSession `_queueUserInput`, `steer`, `_queueSteer`; Agent `steer` | Preserve host disposition, not a run-start or consumption claim |
| RPC input lines launch concurrent async handlers; steering awaits input preprocessing | RPC mode input reader/`handleInputLine`; AgentSession `_runInputHandlers` and `_queueUserInput` | Serialized writes alone do not guarantee host enqueue order; await preceding request outcome |
| `prompt` can execute extension commands; raw steer rejects registered extension commands, while input handlers and skill/template expansion remain in its path | AgentSession `prompt`, `_throwIfExtensionCommand`, `_queueUserInput` | Use raw steer with a non-slash instruction prefix; retain trusted handlers |
| Queued text enters the transcript before request preparation/context conversion; queues can drain or be cleared | Agent loop `runLoop` and `streamAssistantResponse`; AgentSession user `message_start`, queue snapshots, `clearQueue` | Transcript/queue evidence is distinct from final provider input and from durable residence |
| Work can continue after `agent_end`; settled closes session-level execution, but async preprocessing can finish later | AgentSession `_runAgentPrompt`, `_handlePostAgentRun`, `_runBeforeSettleBoundary`, `_emitAgentSettled`, `_queueUserInput` | Close controls on `agent_settled`; a late queued receipt can be unconsumed |

This is requirements drafting under `grimoire-refine`. Permission is to read relevant sources and write/read back only this new spec. Baseline implementation evidence and installed-host source inspection do not establish this feature's implementation or acceptance. No tests, runtime probes, or QA are performed here. Existing artifact statuses and historical notes are not revised. No blocking ADR conflict was found for H's additive scope.

## Requirements

### R1 — Existing background task, existing ownership scope

- The parent can submit pure-text additional instructions to the existing active background child: new context, narrower scope, or a request for a final report. Steering does not cancel/restart the child or replace its original task with a fresh delegation.
- Address the task using its existing background `taskId` in the current owning session/runtime and branch. This is not a numeric TUI-label interface and does not introduce public synchronous task handles.
- Explicitly reject unknown, terminal (`completed`, `incomplete`, `failed`, `cancelled`), cancelling, and invalidated tasks, including IDs from another ownership scope. Do not reopen/restart them or silently fall back to `prompt` or continuation.

### R2 — Readiness is initialization success plus original-task start

- Manual steering is ready only after inherited-tool initialization succeeds **and** the original child task starts, while its execution control remains active. Background acknowledgement, child-process existence, or the public `running` view alone does not establish readiness.
- During initialization, or before original-task start, return a recognizable `not_ready` outcome. Do not wait for readiness and do not cache that rejected instruction for later delivery.
- A failed initialization or original-task start cannot establish readiness; its task outcome and cleanup remain governed by the baseline. Initialization activity is not task execution.

### R3 — Plain-instruction transport with trusted host behavior

- Use raw Pi RPC `steer` for manual instructions and retain the existing automatic-pressure steering path. Do not use command-capable `prompt`, implicitly continue an idle child, or explicitly start a replacement run to make an instruction take effect. Normal host continuation within the existing task remains governed by the baseline.
- Add a non-slash instruction prefix so caller text beginning with `/` is submitted as additional instruction text rather than as a top-level command/skill/template invocation. Exact prefix wording is not fixed.
- Preserve trusted host input-handler behavior, including transformation or handling, for both manual and automatic input. The prefix is not a sandbox against those trusted handlers.
- Preserve the host's steering mode for both kinds of input. Serial submission does not impose a new one-message-per-turn consumption policy; the host may consume one at a time or in a batch according to its mode.

### R4 — One task-local serial submission boundary

- Manual instructions and automatic pressure for the same child use one shared steering submission boundary. Await the preceding RPC outcome before submitting the next steering request; merely writing JSONL records to stdin in order is insufficient.
- Keep submission ownership and isolation task-local. Instructions, receipts, readiness, and pressure state must not cross into another task.
- This serial boundary is not an additional priority policy between manual input and pressure, and it is not a model-consumption ordering guarantee. In particular, a timed-out predecessor can still be undergoing host preprocessing; serial local submission does not make that uncertain outcome definite.

### R5 — Receipt semantics and uncertain timeout

- A successful receipt preserves the distinguishable host disposition: **`queued`** means Pi queued the instruction (possibly transformed by an input handler); **`handled`** means an input handler consumed that submission rather than placing it in the steering queue.
- Neither disposition proves durable queue residence, provider/model consumption, execution, compliance, or a final task result. A `queued` receipt can arrive after the message has already drained, been cleared, or missed continued execution; a `handled` receipt is not a claim of model delivery.
- Report steering rejection/failure separately from the child task's result. Treat a timeout as an uncertain submission outcome, not proof that the instruction was undelivered. Do not automatically retry a timed-out steering submission.
- The existing 40-second RPC control-response timeout is a transport baseline, not a new delivery or completion SLA. No hard time-to-delivery or completion guarantee is introduced.

### R6 — Eligible delivery boundary, not interruption

- Steering does not interrupt an in-flight provider request or tool and does not skip the current assistant response's associated tools.
- Queued steering is eligible for injection after the assistant turn's tools finish and before a subsequent provider request, subject to the host's handling/mode and continued task execution. RPC acceptance does not promise that there will be such a request or that the immediately next request contains the instruction.
- Queue snapshots and user-message transcript events are not provider/model-consumption acknowledgements; host context/request transformations occur after transcript injection.

### R7 — Execution control closes with the existing lifecycle

- Closing, explicit background-task cancellation, and ownership invalidation disable steering controls. Controls also close on `agent_settled`, not on low-level `agent_end`, and cannot remain active merely because terminal result collection/cleanup is still pending.
- Preserve shutdown, extension reload, session replacement/forking, and branch-changing `/tree` invalidation/cleanup. Old controls/IDs must not route instructions or results into a replacement runtime or destination branch. Preserve the baseline's pre-navigation/commit invalidation; invalidated work is not resurrected if navigation is later cancelled.
- A task-state/readiness check does not create atomic active-run acceptance inside the host. The child may settle while an already-submitted instruction is undergoing asynchronous input preprocessing. Even a subsequent successful `queued` receipt can be unconsumed; it must not reopen the control or trigger a replacement run.
- Ordinary parent-turn completion or cancellation does not invalidate accepted background work or its otherwise active steering control. Ownership remains session/runtime/branch-local, not originating-turn-local.

### R8 — Preserve task outcomes, results, and pressure

- A manual steering failure alone must not mark a healthy task failed or cancel it. Underlying task execution or transport failure still follows the baseline lifecycle and outcome semantics; steering does not mask those failures.
- Preserve all four task outcomes, ordinary settlement/result collection, output and diagnostic representation, queryability and model-visible completion delivery, available usage and its separate background accounting, and owned-resource cleanup. A steering receipt is neither a replacement result nor a new completion channel.
- Preserve pressure configuration/thresholds, the actual-task-running clock excluding initialization, completed assistant-plus-tools turn counting, independent once-per-stage reminder state, and advisory nature. Sharing submission with manual input does not reset, duplicate, or turn reminders into hard budgets. Synchronous automatic pressure and synchronous delegation behavior remain intact without public synchronous steering handles.

### R9 — Parent-only capability reachability

- The new capability remains parent-only, unavailable to launched children through direct model declarations, `tool_search`, or `codemode`/nested tool execution.
- Apply the existing registration, inheritance filtering/exclusion, and child-validation boundaries to the added capability; merely telling the child not to call it is insufficient. Preserve ordinary active/discoverable tool inheritance and explicit initialization failure for unreconstructible tools.
- Shared-workspace and non-sandbox limits remain unchanged; steering narrows scope through instructions, not enforced filesystem permissions.

### Traceability

| Requirements | Settled source and feasibility/baseline support | Representative verification |
| --- | --- | --- |
| R1 | H; A4 Decision; B background ownership and UI-ID distinction; L task records | T1, T3, T9, T11 |
| R2 | H; A4 readiness consequence; L acknowledgement/view, initialization handshake and original-task start | T2, T3 |
| R3 | H; A4 raw-steer/prefix/trusted-handler choice; P command, input and mode paths | T4, T5, T6 |
| R4 | H; A4 shared serialization; L write tail versus pressure-local tail; P concurrent requests/async preprocessing | T4, T10, T11 |
| R5 | H; A4 receipt/timeout limits; L response preservation/control timeout; P disposition and mutable queues | T1, T5, T7, T8, T10 |
| R6 | H; A4 no interruption/consumption promise; B pressure boundary; P agent loop/request transformation | T1, T7 |
| R7 | H; A4 lifecycle/race choice; B/L ownership hooks; P `agent_end` continuation and settlement | T3, T8, T9, T11 |
| R8 | H; A4 failure isolation; B/L result, usage, pressure and cleanup contracts | T9, T10, T11 |
| R9 | H; retained ADR 0001 and B inheritance; L registration/filter/validation; P exposure distinctions | T12 |

## Solution

Retain `runDelegation` as exclusive owner of the child process, RPC transport, execution observations, and cleanup. Give the background-task owner a narrow steering control capability for that execution, not an arbitrary `RpcProcess` or general RPC command interface. The owner resolves the existing scope-local task ID and rejects unavailable work; the runner's readiness and closure boundaries govern the control. This separates the background `running` view from actual control readiness without requiring a new task-listing/status interface.

Route manual text and automatic pressure through the same task-local submission boundary, awaiting each preceding RPC outcome before the next submission. Use raw prefixed steer and preserve host dispositions/handlers/mode. Bind controls and unsubmitted steering work to actual task readiness and the existing closing/cancellation/invalidation/settlement boundaries; disabled controls cannot submit new steering. Already-submitted host work remains subject to the receipt race in R7. Manual-operation failure is separate from task outcome collection; the existing task/transport lifecycle remains authoritative.

**Trace:** H and A4's accepted ownership/submission/transport design; R1–R9; L and P corroborate the necessary integration points. Exact capability/method names, schema layout apart from recognizable `not_ready` and host disposition meaning, module layout, and prefix wording remain implementation details.

### Necessary seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Task addressing | Parent capability → background-task owner | Existing background `taskId`, plain text, current ownership scope | Explicit rejection for unknown/terminal/cancelling/invalidated work or access to that execution's narrow control; no new child/run (R1) |
| Runner control/readiness | Background-task owner ↔ `runDelegation` | Valid ownership, inherited-tool initialization success, original-task start, active execution | Narrow steer capability without arbitrary RPC/process ownership; `not_ready` without waiting/buffering until both readiness conditions hold (R2) |
| Shared submission | Manual instructions and task-local pressure → execution control | Same child identity, ordered submissions, preceding RPC outcome | One task-local serial boundary; no policy/state leakage, extra priority rule, or forced consumption mode (R3–R4, R8) |
| Host instruction/receipt | Runner control ↔ child Pi RPC/session | Non-slash-prefixed raw steer, trusted input processing, host mode, response correlation | Distinct `queued`/`handled`, explicit failure or uncertain timeout; post-tool delivery opportunity without interruption/consumption guarantee (R3, R5–R6) |
| Execution closure | Child settlement/transport and owner cancellation/invalidation → control | `agent_settled`, closing, cancellation, scope teardown/navigation; possible in-flight preprocessing | No further submissions through disabled controls; no restart/migration; honest handling of late receipts (R7) |
| Existing outcome/pressure ownership | Steering activity ↔ runner, background results, pressure observations | Manual-operation outcome separate from execution outcome; original pressure clock/turn/stage state | Healthy-task failure isolation; unchanged four outcomes, result/usage/delivery/cleanup and advisory pressure (R8) |
| Parent-only reachability | Parent registration/inheritance capture → child registration/validation | Added capability belongs to the existing parent-only set | No child direct/search/codemode reachability; ordinary inherited-tool reconstruction retained (R9) |

## End-to-End Tests

These are representative input-to-outcome acceptance scenarios for future verification, not executed tests, a test implementation, or a downstream plan. Controlled fixtures may establish a continued run and unmodified instruction path to observe delivery; this does not turn every successful receipt into a consumption/compliance promise.

### T1 — Add context, narrow scope, or request a report on the same child (R1, R5–R6)

- **Given:** A ready background task in the owning scope, held in an active run, with a controlled host/provider that will continue through an eligible boundary and no input/context handler removing the instruction.
- **When:** The parent submits new context, a narrower scope, or a final-report request using that task's ID.
- **Then:** The parent receives the host's steering disposition, not a final task result. The addition reaches that same child's later provider input through the eligible boundary in this fixture, without cancelling/restarting it or changing session/task identity. Any eventual result is collected through the baseline; the receipt does not prove obedience.

### T2 — Acknowledged `running` is not ready (R2)

- **Given:** Background acknowledgement has returned while inherited-tool initialization is held; separately, initialization has succeeded but original-task start is not established.
- **When:** The parent submits an additional instruction during either phase, then the original task subsequently starts.
- **Then:** The call returns recognizable `not_ready` without waiting for readiness. That rejected text is not submitted/cached for later delivery. A separate explicit call after readiness can use the same ID while active. Initialization/start failure follows the baseline failed-task and cleanup path and never enables steering.

### T3 — Unavailable tasks cannot be reopened (R1–R2, R7)

- **Given:** An unknown ID, an ID from another scope, tasks with each of the four terminal outcomes, a cancelling task held before cleanup, and an invalidated task. Include a settled execution whose result collection has not yet finished.
- **When:** The parent addresses any of them for steering.
- **Then:** Steering is explicitly rejected; no raw steering submission/new prompt/continuation, child restart, or reopened result occurs. A stale public `running` view during settlement/result collection is not sufficient to keep the control active.

### T4 — Shared serial submission survives asynchronous host preprocessing (R3–R4)

- **Given:** One ready task with a trusted async input handler gating the first submission; manual input and a due pressure reminder both enter the shared boundary. Exercise each as the first submission and also two manual submissions. The host continues long enough to observe both; separately use each host steering mode.
- **When:** The later submission is pending while the first handler/RPC outcome is held, then the first receives its outcome.
- **Then:** The later RPC steer is not submitted before the preceding outcome. For successful queued submissions, controlled host observations reflect that serial admission rather than concurrent handler completion reordering. Both retain the host's one-at-a-time or batched consumption behavior; no feature-imposed mode or additional manual-versus-pressure priority is introduced. Another task's instruction/state is not mixed into this task.

### T5 — Handled and transformed input remain trusted host behavior (R3, R5)

- **Given:** A ready task with a trusted handler that, in separate cases, consumes a steer or transforms it before queueing; exercise manual instructions and automatic pressure.
- **When:** The submission passes through real Pi input processing.
- **Then:** Consumed input yields distinguishable `handled`, not a claim that the original text was queued or delivered to the model. Transformed queued input yields `queued`; any observed provider text is the host-processed text. Neither handler is bypassed and no duplicate original instruction is inserted to compensate for handling/transformation.

### T6 — Slash-leading caller text stays an instruction (R3)

- **Given:** A ready child with registered command and skill/template sentinels, with input handlers that do not deliberately transform the text into those invocations.
- **When:** The parent submits pure-text instructions starting with a registered `/command`, `/skill:name`, or prompt-template name.
- **Then:** The extension submits non-slash-prefixed raw steer, not `prompt`. Caller text does not execute/expand as a top-level slash invocation; it remains additional instruction text on the controlled path. Trusted handlers retain their separate ability to handle/transform input.

### T7 — ACK precedes consumption without provider/tool interruption (R5–R6)

- **Given:** A ready task with a provider request or associated tool batch held in flight and a queued steering response available while that work is still held.
- **When:** The parent submits steering and then the fixture releases the current work and continues to an eligible provider request.
- **Then:** The successful RPC receipt is observable independently of later provider input. In-flight work is not interrupted and associated tools are not skipped. Controlled provider-input evidence can establish later inclusion after the tool boundary; neither ACK, queue snapshots, nor transcript events alone establish it. No delivery-duration or immediate-next-request guarantee is asserted.

### T8 — Low-level end, settlement, and the late-receipt race (R5, R7)

- **Given:** In one case, `agent_end` precedes automatic continuation while the session-level task remains active. In another, a submitted steer's async input handler is held while the child reaches `agent_settled`.
- **When:** Steering is attempted during the still-active continuation case; in the race case, preprocessing is released after settlement and a further call is attempted after closure.
- **Then:** `agent_end` alone does not close control. `agent_settled` closes it even before result collection/cleanup finishes, and further calls are rejected. If the racing request returns successful `queued` while transport remains available, that receipt may be unconsumed and is reported without restarting/continuing the child; closure may instead produce a steering failure. A state check or receipt is not presented as atomic acceptance into an active run.

### T9 — Cancellation and ownership invalidation disable controls (R1, R7–R8)

- **Given:** Ready background work and steering activity in an originating scope, including controlled races with existing explicit cancellation or teardown.
- **When:** The parent cancels the task, or exit/reload/session replacement/forking/branch-changing `/tree` invalidates ownership.
- **Then:** Disabled controls cannot submit further instructions; owned execution resources follow baseline cancellation/cleanup. No old instruction/result wakes a closing runtime or enters the replacement/destination branch. Query/completion outcomes retain baseline ownership and four-state meaning. Pre-navigation invalidation is not undone if navigation is later cancelled; work accepted during the navigation window remains covered by existing commit invalidation.

### T10 — Manual failure and uncertain timeout do not become task failure (R4–R5, R8)

- **Given:** A healthy active child whose manual steer is rejected by the host or whose RPC response is delayed beyond the existing control timeout; separately, a child with an underlying transport exit/failure.
- **When:** The manual steering operation reports failure/timeout while healthy execution continues, or the underlying transport fails.
- **Then:** The healthy task is not failed/cancelled solely by that operation and can still produce its ordinary result/usage. Timeout is an uncertain outcome and no automatic resubmission occurs, including if delayed host processing later queues the text. A later submission waits for the preceding local RPC outcome but is not claimed to eliminate timeout-related host uncertainty. Underlying task/transport failure still uses baseline failure collection and cleanup, not steering failure isolation as a way to conceal it.

### T11 — Parent independence, pressure, and outcome compatibility (R1, R4, R7–R8)

- **Given:** Concurrent background tasks with distinct pressure policies and an existing synchronous call with automatic pressure; include tasks eventually producing each of the four outcomes.
- **When:** The parent finishes/cancels an ordinary turn, manual input is submitted to an eligible background task, and existing time/turn pressure thresholds become due.
- **Then:** Background ownership/eligible control survives ordinary parent-turn completion/cancellation. Each task retains its thresholds, actual-task clock, assistant-plus-tools completed-turn count, once-per-stage state and advisory reminders through the shared submission path. Another task is unaffected. Synchronous waiting/cancellation/pressure remains unchanged without a public steerable handle. Settlement, final text/diagnostics/full-output references, generation-length versus presentation-truncation meaning, query/completion delivery, available usage/separate accounting, and cleanup remain baseline-authoritative; a report request does not itself force a terminal status.

### T12 — Children cannot discover or call the added capability (R9)

- **Given:** A parent with the new capability registered and representative active/deferred/codemode inherited tools, launching real background and synchronous children through the existing initialization boundary.
- **When:** A child inspects model declarations, searches for the capability, or attempts nested/codemode access.
- **Then:** The steering capability is unavailable through all three routes and is excluded/validated using the existing parent-only boundaries. Ordinary inherited tools retain their activation/discoverability and reconstruction checks. No filesystem sandbox or enforced modification scope is claimed.

## Decisions

| Material choice | Reason/source |
| --- | --- |
| Background-only existing task addressing; no public synchronous handles or TUI label interface | H's accepted first-version scope; A4; B's existing background ownership and distinct UI labels |
| Explicit `not_ready`, without waiting or initialization buffering | H; A4's readiness consequence; L's early acknowledgement and initialization/start separation |
| Runner owns process/RPC/cleanup and exports only narrow steering control | H and A4's accepted responsibility boundary; L's shared execution runner |
| One task-local manual/pressure serial boundary awaiting RPC outcomes | H and A4; P's concurrent async input path makes stdin ordering alone insufficient |
| Non-slash-prefixed raw steer, trusted handlers and existing host mode | H and A4; P's command-capable prompt, steer preprocessing, and queue modes |
| Distinct queued/handled receipts, uncertain timeout, no automatic retry after timeout or consumption/SLA promise | H, roadmap acceptance distinction, A4, and P's mutable queues/async preprocessing; L's existing control timeout |
| `agent_settled` closure plus cancellation/invalidation; preserve task/pressure/result semantics and parent-only reachability | H and A4; B/L lifecycle and inheritance; P settlement/continuation/race evidence |

## Verification guidance and limits

- Future evidence should compose the parent task-addressed surface, background owner, actual runner/control boundary, and real Pi RPC input processing. Mocking a successful `steer` response or checking stdin alone does not establish handler ordering, slash safety, settlement races, or provider input.
- Gate initialization and original-task start separately for T2. Gate async input preprocessing/RPC outcomes for T4/T8/T10; use event order rather than invented timing thresholds. Observe `agent_end` versus `agent_settled` separately. A host-only late queue observation establishes race feasibility, not correctness of the future task wrapper.
- For T1/T7, capture actual controlled provider input **after** host request/context transformations, together with request/tool event ordering and correlated RPC responses. Separate acceptance, queue residence, transcript injection, provider input, and any model answer/compliance. This is verification evidence for a fixture, not a new public consumption receipt or guarantee.
- Cover both `queued` and handler `handled`, transformed text, both host consumption modes, manual/pressure ordering in either direction, isolation, post-closure attempts, and preserved baseline results/lifecycles. Exercise supported long-lived TUI and RPC parent runtimes without adding a TUI steering panel; one-shot print/JSON background support remains unpromised under B.
- Record the host/version and evidence actually obtained. Current evidence is read-only source inspection of installed Pi and agent-core 1.0.0, not runtime-steering implementation, feature tests, real-provider verification, or all-version compatibility. This Draft performs no such verification and authorizes none at the selected endpoint.

## Out of scope and open boundaries

- TUI steering panels, task listing/details, numeric-label addressing, message withdrawal, and provider/model-consumption confirmation.
- Public synchronous task handles/manual synchronous steering; parent-side initialization buffering; restarting/reopening terminal work; implicit idle continuation or command-capable prompt fallback.
- Pressure-policy changes, hard interruption/budgets, guaranteed completion/compliance or delivery latency, and enforced filesystem/workspace isolation. Existing shared workspace and non-sandbox limits remain.
- New behavioral assumptions are not adopted. Empty-message validation, message size/rate limits, durable receipt storage/notifications, retry/idempotency contracts beyond the chosen no-automatic-retry-after-timeout rule, priority between manual input and pressure beyond serial submission, and cancellation semantics for the steering tool call were not selected and are not acceptance obligations in this Draft.
- Exact capability/method names, receipt/error payload layout except recognizable `not_ready` and preserved host disposition meaning, module layout, and prefix wording remain unprescribed implementation details.
- No unresolved blocking fact or decision is needed to express H at this endpoint. If implementation requires a new semantic choice, return it to refine/clarify for live recording before proceeding; this artifact does not resolve it by assumption. The endpoint is one verified requirements Draft only, returned to the coordinator with no downstream workflow.

[host-rpc]: ../../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js
[host-session]: ../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js
[host-agent]: ../../node_modules/@earendil-works/pi-agent-core/dist/agent.js
[host-loop]: ../../node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js
