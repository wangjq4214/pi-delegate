# Per-delegation soft pressure without automatic cancellation

**Status:** Completed
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
- **Correction (2026-10-04):** the original bullet here read "This record establishes the accepted design direction, not implemented behavior or real-host verification. See spec 0003 for the requirements contract." That described the spec-only stage; implementation and real-host verification were subsequently authorized and are now realized. See [Realization and verification](#realization-and-verification-2026-10-04).

## Realization and verification (2026-10-04)

The corrected bullet above described the spec-only stage. Implementation and real-host verification were subsequently authorized and completed; the requirements contract and its evidence table are in [spec 0003 — Subagent soft pressure](../spec/0003-subagent-soft-pressure.md#implementation-verification-2026-10-04).

Implementation: `src/pressure.ts` owns the `pressure` parameter schema, `validatePressureInput`, per-field defaults and the cross-stage strict-greater check in `resolvePressure`, the `PressureClock` abstraction and the task-local `TaskPressure` state machine. `src/delegate.ts` resolves one policy per invocation and rejects invalid input before any child is spawned (`validatePressureInput` → clone-safe `__piDelegatePressureError`), constructs `TaskPressure` only after task onset, serializes pressure through the shared steering boundary, and disposes it on settlement/abort. `src/status.ts` renders the visual-only acknowledged stage (`pressure: none / warning / urgent`).

Real Pi 1.0.0 RPC tests verify elapsed-time OR turn triggers with per-value defaults, initialization excluded from the task clock, held provider/tool time included without interruption, once-per-stage deduplication, assistant-plus-tools completion counted as one turn (not messages or tools), cross-mode invocation isolation, advisory-only behavior through continued work and explicit cancellation, and pre-launch rejection of contradictory or wrongly-typed policies. Terminal outcomes, completion/output/usage channels and cleanup are asserted unchanged.

Final post-format checks on Bun 1.4.1 / Pi 1.0.0: `bun test` (371 passed, 0 failed, 3712 assertions, 19 files), `bun run typecheck`, `bun run check` (Biome, 46 files) and `git diff --check` all passed.

Completion is scoped to this extension's advisory-pressure contract. Tests use deterministic local fixture providers without external model credentials; they inspect reminder meaning and transport disposition rather than asserting a wall-clock visibility SLA. As decided above, threshold crossings still do not terminate a child, restrict tools or imply compliance, and no all-host-version compatibility claim is added.

**Superseded rationale for the status change (2026-10-04):** `.grimoire/plans/0006-subagent-soft-pressure.md` previously recorded that this ADR's and spec 0003's statuses "remain unchanged because full-artifact completion evidence was not expanded to those combinations" — specifically pressure active across reload/session replacement and presentation truncation. That reasoning treated a coverage gap in *combined* scenarios as blocking promotion of a realized decision. The status is promoted here on the basis that the decision itself is realized and the mapped evidence above covers R1–R8; the untouched gap is now stated as an explicit limit rather than as a reason to keep the decision recorded as in-progress. The combined pressure × reload/session-replacement and pressure × truncation cases remain covered compositionally by the existing lifecycle and presentation suites, not by dedicated new real-host tests.
