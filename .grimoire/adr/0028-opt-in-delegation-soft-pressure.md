# Opt-in delegation soft pressure

**Status:** Completed
**Date:** 2026-10-25
**Supersedes:** [ADR 0003 — Per-delegation soft pressure](./0003-per-delegation-soft-pressure.md), only its automatic enablement when pressure configuration is omitted.

## Context

The user requested that delegate stop automatically sending pressure messages, retain pressure as an option, and default it to off because some tasks legitimately run for a long time. Even advisory instructions to end exploration and prepare a final report can be inappropriate for those tasks; absence of automatic cancellation does not remove that influence.

Sources:

- This refinement request: “delegate 不要自动发送压力信息了，可以作为选项被开启，有些任务会很长，不适合这样，默认关闭吧”.
- [ADR 0003](./0003-per-delegation-soft-pressure.md) and [spec 0003](../spec/0003-subagent-soft-pressure.md): the previous default-on policy and advisory reminder contract.
- `packages/pi-delegate/src/pressure.ts` at refinement baseline: omitted configuration resolved to warning/urgent defaults and reminder instructions encouraged early wrap-up.
- [ADR 0022](./0022-opt-in-task-execution-budgets.md): execution budgets are a separate opt-in cancellation policy.

## Decision

- Soft pressure is disabled by default. Delegation without explicit pressure enablement must not automatically send warning or urgent finish-reminder instructions.
- Retain soft pressure as an explicitly enabled option rather than remove it. The reason for changing the default is to allow legitimate long-running tasks to continue without unsolicited wrap-up pressure.
- This supersedes only ADR 0003's automatic enablement on omission, not its advisory-versus-cancellation distinction. It does not change the separate execution-budget policy.

The user subsequently accepted the proposed per-invocation interface and the settled-handoff endpoint. Interface details and acceptance checks belong to that handoff rather than a new architectural decision or spec.

## Consequences

- Future requirements and implementation must distinguish disabled pressure from enabled pressure whose individual thresholds use defaults.
- The previous spec's all-configuration-omitted behavior is historical baseline, not the newly selected default. The user selected a settled handoff without a separate new spec or ticket set.
- At the refinement endpoint this recorded direction only; implementation was subsequently authorized through the user's explicit `grimoire-loop` invocation. See realization below.

## Realization and verification (2026-10-25)

`packages/pi-delegate/src/pressure.ts` now resolves omitted pressure to disabled; an explicit object enables the existing per-field defaults and validation. `src/runner.ts` creates and observes a pressure monitor only when enabled, while retaining settlement waiting, manual steering, independent budget enforcement and cleanup. `src/tasks.ts` omits a disabled policy from task metadata, and `src/task-panel.ts` presents it as disabled. The tool schema, both READMEs and usage/runtime documentation describe opt-in behavior.

Focused unit and controlled-runner tests verify disabled resolution, no pressure clock/timer activity, waiting for real settlement, default thresholds under a virtual 601-second observation and more than 40 completed turns, policy snapshot isolation, and the disabled Overview. Real Pi 1.1.0 RPC tests run concurrent enabled/disabled tasks in both synchronous/background combinations through 45 model calls: omitted pressure produces no receipts or model-visible reminders, while `{}` retains once-per-stage receipts at 20/40 turns. The existing budget, manual-steering, result and cleanup suites remain passing.

Post-format verification from `packages/pi-delegate/`: `bun test` (637 passed, 1 platform-specific skip, 0 failed; 9202 assertions across 43 files), `bun run typecheck`, `bun run check` (100 files), and `bun run build` passed. The elapsed-default regression uses a controlled clock rather than a ten-minute real-host soak; real-host tests use deterministic local providers, not external credentials. No release or running-session reload is claimed.
