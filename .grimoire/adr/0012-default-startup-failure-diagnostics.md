# Expose bounded child stderr by default on delegation startup failure

**Status:** Completed
**Date:** 2026-10-05

## Context

The user requested actionable error information when pi-delegate fails to start a child. [Spec 0001](../spec/0001-rpc-subagent-delegation.md) already requires explicit reporting of startup and reconstruction failures. The current `packages/pi-delegate/src/rpc.ts` drains and discards stderr to avoid copying potentially sensitive extension output into tool results; unexpected child exits therefore expose process status without stderr diagnostics.

The refinement discussion offered automatic failure-only disclosure or explicitly enabled diagnostics. The user accepted automatic disclosure after being informed that stderr may contain sensitive information. This is a bounded startup-diagnostics capability, not completion of the broader traceable-results item in `packages/pi-delegate/docs/roadmap.md`.

## Decision

- By default, return a bounded tail of child stderr when delegation startup fails; no explicit diagnostic opt-in is required. Prefer actionable startup errors over the current blanket suppression of child stderr on this path.
- Do not return startup stderr on successful delegation, and do not persist a stderr log artifact.
- Document that the diagnostic tail may contain sensitive information and becomes part of the model-visible failure result. Bounded output is not a guarantee of redaction.

Source: The user's request for startup error information and subsequent acceptance of the recommended default behavior in this refinement conversation.

## Consequences

- Startup failure results can provide concrete child diagnostics in addition to the original error and observed process status.
- Collection must remain bounded and must not compromise existing cancellation or child cleanup guarantees. Stderr is diagnostic data, not RPC protocol data or independent proof of failure.
- The existing synchronous and background result channels can carry the diagnostic information without introducing a separate diagnostic tool.
- The exact byte limit, startup-step labels, and optional result-field shape remain implementation details; the discussion suggested a 16 KiB tail but did not establish that number as a contract.
- Implementation and verification remain pending. Full execution-record persistence, result templates/schemas, and a new TUI task panel are outside this decision.

## Implementation evidence (2026-10-05)

The pending-work statement above describes the proposal at recording time. The decision is now realized in `packages/pi-delegate/src/rpc.ts` and `src/delegate.ts`; privacy and bounded-capture behavior are documented in `docs/runtime.md`. The parent traceable-results roadmap item remains unchecked, with startup diagnostics recorded as a completed sub-capability.

- `tests/startup-diagnostics.test.ts` covers 19 scenarios, including real installed Pi CLI startup failure, split UTF-8, byte-tail truncation, cleanup-time stderr, primary-error preservation, success/runtime/cancellation non-disclosure, both task-start signals, live-buffer discard, background results, and held-pipe cleanup.
- Root `bun run test` passed (repository: 6 passed; delegate: 470 passed, 1 POSIX-only permissions test skipped on Windows; UI: 102 passed). After additional regression coverage and scoped formatting, the affected startup/RPC suites passed again: 44 passed, 0 failed, including all 19 startup-diagnostics scenarios.
- Root `bun run typecheck`, `bun run build`, `bun run check`, and `git diff --check` passed. Independent read-only review/check reported no confirmed blockers; its two coverage suggestions were retained as regression checks.
- Verification used Windows, Node.js 24.21.0, Bun 1.4.1, and the pinned Pi 1.0.0 host without external model credentials. POSIX late inherited-pipe capture was not executed on this platform; diagnostics remain best-effort under existing bounded cleanup.
