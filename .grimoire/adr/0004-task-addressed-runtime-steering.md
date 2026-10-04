# Task-addressed runtime steering within background ownership

**Status:** Completed
**Date:** 2026-10-04

## Context

The user asked how to realize Runtime steering from [the roadmap](../../docs/roadmap.md), then invoked `grimoire-spec` and replied “可以继续吧” to the recommendation for background-task-only steering, initialization rejection with `not_ready`, RPC acceptance rather than consumption guarantees, and the spec-only endpoint.

[ADR 0002](./0002-session-owned-background-delegation.md) establishes session/branch-owned background task identifiers and cleanup. The fresh-child RPC and parent-only capability boundaries retained from [ADR 0001](./0001-rpc-subagents-and-parent-only-delegation.md) remain applicable. [ADR 0003](./0003-per-delegation-soft-pressure.md) already establishes advisory child-conversation steering for automatic pressure; this decision extends access to parent-supplied runtime instructions, not pressure policy or task lifetime.

The confirmed discussion recommended keeping child transport ownership in the execution runner, exposing only a narrow steering capability to the task owner, and serializing manual steering together with automatic pressure. These boundaries let the parent add context, narrow scope, or request a report without cancelling and restarting the child or giving the task registry arbitrary RPC control.

Sources:

- This refinement conversation: the initial request, the proposed responsibility/lifecycle/receipt boundaries, and the user's acceptance and selection of spec-only.
- `src/delegate.ts`: shared child runner, initialization handshake, existing raw RPC `steer` for pressure, settlement and cleanup.
- `src/background.ts`: scope-local task identifiers, cancellation, result ownership and invalidation; it does not currently expose a task-addressable steering channel.
- `src/rpc.ts` and `src/pressure.ts`: transport responses, serialized writes, settlement observation and pressure-local steering submission order.
- Installed Pi 1.0.0: `node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md#steer`, `docs/rpc.md#run-lifecycle`, `dist/core/agent-session.js` and `dist/modes/rpc/rpc-mode.js`; `node_modules/@earendil-works/pi-agent-core/dist/agent.js` and `dist/agent-loop.js`.

Source inspection establishes that raw steer returns `queued` or `handled`, does not interrupt an in-flight provider request or tool, and does not wake an idle agent. Asynchronous input preprocessing can finish after settlement. RPC write order alone is therefore neither a model-consumption guarantee nor a guarantee of host enqueue order for concurrent requests.

## Decision

- Add a parent-only, task-addressed steering capability for initialized, still-active background tasks in their existing ownership scope. Preserve the synchronous API and its internal automatic pressure without introducing public synchronous task handles.
- Preserve the execution runner's exclusive ownership of the child process, RPC transport and cleanup. Give the background-task owner a narrow steering control interface rather than exposing arbitrary RPC commands. Bound that control interface to actual task readiness and its execution lifecycle.
- Use raw Pi RPC `steer` for plain additional instructions. Do not route through command-capable `prompt`, implicitly continue an idle child, or restart/reopen a completed task. Add a non-slash instruction prefix while retaining trusted host input-handler behavior.
- Serialize manual instructions and automatic pressure through one task-local steering submission boundary, waiting for the preceding RPC outcome before submitting the next request. Keep existing pressure policy and trigger/counting state unchanged.
- Promise an RPC handling outcome, preserving the distinction between `queued` and `handled`, not interruption, durable queue residence, delivery latency, provider/model consumption, execution or compliance. Treat timeout as an uncertain submission outcome rather than permission to retry automatically.
- Tie readiness, control invalidation and cleanup to the existing task/session/branch lifecycle. `agent_settled`, not low-level `agent_end`, closes the execution control boundary; explicit cancellation and ownership invalidation also disable it. A receipt racing settlement is not proof that the instruction was consumed.
- A manual steering failure alone does not change the task outcome or cancel healthy background execution. Existing task execution, cancellation and transport failure semantics remain authoritative.

This is an additive decision, not a supersession of ADRs 0001–0003. The initialization response, rejection cases and representative acceptance scenarios are ordinary requirements specified in [spec 0005 — Background runtime steering](../spec/0005-background-runtime-steering.md).

## Consequences

- Runtime instructions can reach the existing child's conversation without reusing that child for another delegation or introducing a second communication transport. No operating-system sandbox or enforced workspace restriction is introduced.
- Task lookup and publicly reported `running` state are insufficient to establish readiness: the current background view also uses `running` during child initialization. The implementation needs an execution-scoped control-readiness boundary.
- For acknowledged submissions, shared task-local sequencing avoids async host preprocessing reordering manual instructions and pressure merely because both were written to stdin in order. An uncertain timeout does not establish that earlier host preprocessing has finished, so it cannot establish host enqueue order. Host steering mode still determines one-at-a-time versus batched consumption.
- Terminal, cancelling, not-ready or invalidated work is not silently converted into a new prompt. A caller cannot infer execution or compliance from a successful receipt, including a late receipt racing settlement.
- **Correction (2026-10-04):** the original bullet here read "The chosen endpoint is requirements drafting only. Runtime steering is not yet implemented or newly runtime-tested; installed-host source evidence is limited to Pi 1.0.0." That described the drafting endpoint; implementation and real-host verification were subsequently authorized and are now realized. See [Realization and verification](#realization-and-verification-2026-10-04). Installed-host source evidence remains limited to Pi 1.0.0.

## Realization and verification (2026-10-04)

The corrected bullet above described the drafting endpoint. Implementation and real-host verification were subsequently authorized and completed; the requirements contract and its evidence table are in [spec 0005 — Background runtime steering](../spec/0005-background-runtime-steering.md#implementation-verification-2026-10-04).

Implementation: `src/steering.ts` owns the `SteeringReceipt` union (`accepted` with `queued`/`handled`, plus `not_ready`/`closed`/`failed`/`uncertain`), the narrow `SteeringControl` interface granted to the task owner, and the runner-owned `TaskSteering` boundary with its task-local serialized `tail`, `[pi-delegate instruction]` prefix, readiness (`agent_start` plus confirmed original-task start), and closure on `agent_settled`/`rpc_failure`. `src/background.ts` resolves the task in the owning scope and rejects `unknown_task`, `terminal`, `cancelling` and `closing` work without exposing RPC commands. `src/delegate.ts` registers the parent-only `delegate_steer({ taskId, message })` and wires the control; `src/inheritance.ts` lists it in `DELEGATION_TOOLS` so children cannot discover or call it.

Real Pi 1.0.0 RPC tests verify: readiness requiring original-task start with no rejected-text buffering; rejection of unknown, foreign, terminal, cancelling and settled tasks; a real trusted input handler consuming and transforming input yielding `handled`/`queued` with no bypass or duplicate insertion; slash-leading caller text staying instruction text rather than a command/skill/template invocation; `agent_end` not closing control while `agent_settled` does, including the settlement race; a rejected manual steer not failing a healthy task or suppressing its result/usage; a real 40-second timeout reported as uncertain with no automatic retry; task-local isolation between concurrent steering and pressure; and parent-only exclusion during child startup.

Final post-format checks on Bun 1.4.1 / Pi 1.0.0: `bun test` (371 passed, 0 failed, 3712 assertions, 19 files), `bun run typecheck`, `bun run check` (Biome, 46 files) and `git diff --check` all passed.

Completion is scoped to this extension's steering contract. Tests use deterministic local fixture providers without external model credentials; receipt/transport disposition is verified separately from model consumption, so no interruption, delivery-latency, compliance or host-enqueue-order guarantee is added. Verification remains scoped to Pi 1.0.0, and the exclusions above (no TUI panel, no synchronous handles, no task listing) are unchanged.
