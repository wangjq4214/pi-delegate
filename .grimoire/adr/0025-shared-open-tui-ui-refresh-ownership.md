# Share extension-owned Open TUI periodic refresh without merging measurements

**Status:** Testing
**Date:** 2026-10-16
**Partially supersedes:** [ADR 0024](./0024-structured-thinking-presentation-and-dynamic-spinner.md), only its independently owned 80ms thinking ticker. Thinking animation remains independent of stream delivery; the native collapsed-label integration boundary is unchanged.

## Context

During review and refinement of [PR #2](https://github.com/wangjq4214/pi-delegate/pull/2), the user requested unified refresh rather than separate animation/timing loops, with reduced redundant work as the goal. Inspected local source has a 250ms Workline interval in `packages/pi-open-tui/src/index.ts` and a 500ms enhanced-tool interval in `src/tool-presentation.ts`. PR head `413a7b065dc26fd63cdfc363fd7fecfa2ca1fe30` additionally introduces an independently owned 80ms thinking interval in `src/peek-controller.ts`.

The user accepted one shared, session-scoped scheduling owner for these three extension-owned UI consumers, demand-based refresh, idle cleanup, timely event-driven updates, and explicit exclusion of external data polling and host/third-party timer ownership. The accepted conversation ended with “可以！” after this boundary was presented. It authorizes knowledge recording and Spec revision, not implementation or QA.

Existing `LatestRefresh` in `src/refresh.ts` coalesces asynchronous Git/runtime snapshot requests and rejects superseded results. Existing tool composition also preserves native renderer behavior; for example, the native shell renderer can own a timer. Neither responsibility is equivalent to the extension's periodic UI refresh.

## Decision

- Give the extension's Workline, enhanced-tool elapsed presentation and thinking title tree one shared, session-scoped owner for periodic UI scheduling. Replace their independently owned periodic loops; merely assigning equal intervals to multiple loops is not the selected design.
- Consumers participate only while they need dynamic presentation. Permit different update cadences; do not force all consumers to run at the fastest animation rate. Combine due work and coalesce extension-owned render requests for a scheduling round.
- Stop periodic wakeups when no consumer needs them. Dispose subscriptions and reject stale work on session replacement/navigation, shutdown or relevant feature disablement. A consumer finishing must not stop another still-active consumer.
- Retain timely event-driven invalidation for content, completion, cancellation, failure and configuration changes; it must not wait for a periodic tick.
- Share scheduling, not semantic state or measurement intervals. Each thinking message, tool call and full agent run retains its own start/end boundaries, elapsed measurement and outcome evidence. Use shared duration-formatting capability instead of another independent feature-specific formatter; differing intentional precision needs do not imply shared elapsed values.
- Keep Git/runtime reads under their existing asynchronous coalescing/invalidation mechanism, not animation-driven polling. Do not take over Pi-native or third-party animation timers or change their renderer capabilities. Preserve the [public tool-composition boundary](./0019-universal-tool-presentation-with-specialized-composition.md), [host-evidenced outcome distinctions](./0013-host-evidenced-open-tui-run-outcomes.md) and package independence.

## Consequences

- One scheduling owner provides a verifiable place for demand, wakeup and lifecycle accounting without turning the UI clock into an execution scheduler or external-data poller.
- Fewer independent wakeups/render requests are an intended improvement, not evidence of a measured CPU or latency gain. Verification must compare representative activity and idle behavior; no numeric performance threshold or new fixed cadence was agreed.
- The exact scheduler API, timer primitive, cadence policy, formatter API and file organization remain implementation details. This record does not authorize private host patches or global interception of `requestRender`.
- [Spec 0014](../spec/0014-structured-thinking-block-presentation.md) contains the accepted title-tree behavior, compatibility requirements, consumer contracts and verification scenarios. No implementation or QA completion is claimed.

## Execution evidence — 2026-10-16

The user subsequently invoked `grimoire-loop` and authorized checkout and implementation. `ui-refresh.ts` now owns the shared periodic source; `index.ts`, `tool-presentation.ts` and `peek-controller.ts` consume it. Deterministic scheduler and actual-host/entry-point integration tests cover aligned demand, independent measurements, component invalidation, disable/re-enable, session reset, target replacement, native timer preservation and idle cleanup. A Git/runtime integration test confirms UI ticks do not request external snapshots. Shared duration formatting is implemented in `utils.ts` with explicit precision policies.

Automated evidence and the remaining manual boundary are recorded in Spec 0014. Testing status records completed implementation with live terminal/font/IME verification pending, not a claim of CPU-performance improvement or full visual acceptance.
