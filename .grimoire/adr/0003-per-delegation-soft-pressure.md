# Per-delegation soft pressure without automatic cancellation

**Status:** Implementing
**Date:** 2026-10-03

## Context

The user wants a subagent to receive increasing pressure to finish after sufficient running time or execution turns. The user clarified that the parent agent configures these thresholds when starting each subagent, with two default stages when configuration is omitted. The user then accepted the recommendation to configure the two stages independently, fill omitted values from the defaults, and use reminders rather than automatic cancellation.

The existing system uses fresh RPC children for both synchronous and opt-in background delegation. ADR 0002 establishes session-owned background execution and explicit cancellation; it preserves synchronous call cancellation and the RPC/inheritance boundaries from ADR 0001. The current README explicitly states that model tasks have no fixed time limit.

Sources:

- This refinement conversation: the initial request for runtime/turn-based pressure, the clarification assigning configuration to the parent at invocation, and the final acceptance of the recommended spec-only route and behavior.
- [ADR 0001](./0001-rpc-subagents-and-parent-only-delegation.md) and [ADR 0002](./0002-session-owned-background-delegation.md).
- `src/delegate.ts`, `src/rpc.ts`, and `README.md` for existing task execution, settlement, and cancellation.
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md#steer` for runtime steering delivery.

## Decision

- The parent supplies a task-local, two-stage pressure policy when invoking delegation. Omitted values use the corresponding defaults. One call's configuration does not change another call's policy.
- Pressure thresholds are advisory, not hard execution budgets. Reaching a stage produces a model-visible instruction to finish; it does not automatically abort the child, classify the task as cancelled, or enforce a tool-access boundary.
- Apply the same policy to synchronous and background children while preserving their existing ownership and explicit cancellation behavior.
- Deliver pressure through the child's running conversation. Pi RPC steering is available after the current assistant turn has finished executing its tools and before the next model request; it does not interrupt an in-flight provider request or tool.

The user chose soft pressure to encourage earlier completion without introducing automatic termination. Exact default numbers and trigger/counting semantics are ordinary feature requirements and are specified in the associated spec, not duplicated here.

## Consequences

- Each delegation needs its own effective policy and reminder state, bounded by that child's execution lifecycle.
- Triggering pressure must not replace ordinary result collection, completion delivery, or resource cleanup. Existing cancellation mechanisms remain available.
- The parent can tailor pressure for each task without relying solely on global settings.
- A child may ignore a reminder, and a long-running tool may delay its consumption. This policy does not guarantee completion within a maximum time or turn count.
- This record establishes the accepted design direction, not implemented behavior or real-host verification. See [spec 0003](../spec/0003-subagent-soft-pressure.md) for the requirements contract.
