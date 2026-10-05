# Per-task model selection with verified startup configuration

**Status:** Completed
**Date:** 2026-10-04

## Context

The user asked how to realize Per-task model selection from [the roadmap](../../packages/pi-delegate/docs/roadmap.md). The refinement discussion proposed independent optional `model: { provider, id }` and `thinkingLevel` inputs, parent inheritance by default, exact model selection without silent fallback, and Pi-native thinking-level adjustment with disclosure of the effective value. The user replied “接受，然后那个UI也要显示一下模型和thinking级别”, accepting those choices and requesting model/thinking visibility in the existing Agents UI.

The existing execution boundary is a fresh RPC child with conventional tool/configuration reinitialization. [ADR 0002](./0002-session-owned-background-delegation.md) retains that boundary from [ADR 0001](./0001-rpc-subagents-and-parent-only-delegation.md) and supplies session-owned background execution. [ADR 0004](./0004-task-addressed-runtime-steering.md) keeps transport ownership in the runner rather than the background task registry. This decision extends task startup configuration without changing those ownership boundaries.

Sources:

- This refinement conversation: the proposed interface, inheritance, exact-selection, effective-thinking, startup-only, credential and ownership boundaries; the user's acceptance and additional UI requirement.
- `src/inheritance.ts`: captures the parent's current model/thinking level into child CLI arguments.
- `src/delegate.ts`: both invocation modes capture inheritance before execution and share `runDelegation`, which owns child initialization, original-task submission and cleanup.
- `src/background.ts`: session-owned execution and result delivery; an accepted task identifier is not evidence of completed child initialization.
- `src/status.ts` and [spec 0004](../spec/0004-agent-status-ui.md): the existing above-input Agents display and its visual-only ownership boundary.
- Installed Pi 1.0.0: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts`, `dist/core/model-resolver.js`, `dist/core/agent-session.js` and `dist/modes/rpc/rpc-mode.js`.

Source inspection shows that CLI model patterns permit fuzzy matching, RPC `set_model` uses exact provider/model-ID matching, and switching models can apply a model-specific/default thinking level. `set_thinking_level` adjusts to the selected model's supported levels; `get_state` exposes the selected model and effective thinking level. These facts establish available integration points, not implemented or tested per-task selection.

## Decision

- Make model selection a per-invocation startup configuration shared by synchronous and background delegation. Capture plain configuration at delegation acceptance; later parent-model changes must not alter already-accepted background work. Do not change the parent session's model/thinking level or persist task overrides as user/project defaults.
- Accept independent optional `model: { provider, id }` and `thinkingLevel` inputs. Omitted fields inherit the corresponding current parent value. If only the model changes, the inherited thinking request is still subject to the target model's capabilities.
- Resolve model identity exactly within Pi's configured model registry. Do not use ambiguous bare names, CLI fuzzy matching or silent fallback to a different model as the delegation contract. Reject unknown models or child-side reconstruction/selection failures explicitly.
- Use Pi's native thinking-level adjustment instead of maintaining a second model-capability policy or rejecting every supported-level adjustment. Preserve the requested value separately from the child-confirmed effective value so adjustments are observable.
- Keep child transport/configuration verification in the shared runner. The original task must not be submitted until the selected model and effective thinking level have been confirmed in the child. Determine the model before applying the per-invocation thinking request, since changing models may reapply defaults.
- Continue conventional child credential/configuration reinitialization. Do not add caller-supplied API-key tool parameters or copy resolved secrets into delegation parameters/results. Parent-only runtime model/provider or credential state is not assumed to be reconstructible in another process; configuration/authentication failures are explicit rather than permission to choose a different model. Successful configuration checking does not guarantee remote-provider success.
- Limit this increment to task-start selection. Do not add runtime model-switch controls, automatic model routing or a new model-listing capability as part of this feature.

This is additive to ADRs 0001–0004, not a replacement of their fresh-session, inheritance, registration, ownership, steering, pressure or accounting boundaries. The requested UI fields and their presentation belong in [spec 0006 — Per-task model selection and Agents UI configuration visibility](../spec/0006-per-task-model-selection.md), not in a separate UI architecture decision. Spec 0004 remains its baseline UI contract.

## Consequences

- A parent can choose a task-specific model/thinking combination for speed, cost or complexity without changing other delegations or the parent session.
- Startup CLI arguments alone are insufficient evidence of exact selection or effective thinking. Child-side verification must distinguish requested configuration from confirmed configuration before original-task execution.
- A background task acknowledgement remains acceptance for asynchronous execution, not successful model configuration or authentication. Child-side failures remain task failures under the existing result and cleanup contract.
- Model/thinking visibility can reuse the existing visual-only status owner; it must not give the UI or background registry arbitrary child RPC control or change task lifetime.
- Native thinking adjustment can produce an effective level different from the request. Consumers must not label the requested level as confirmed merely because it was accepted as input.
- **Correction (2026-10-04):** the original bullet here read "The selected endpoint is spec-only. No implementation, implementation plan, tests or runtime/UI QA have been authorized or performed for this feature." That described the proposal-stage endpoint only; implementation was subsequently authorized and is now realized. See [Realization and verification](#realization-and-verification-2026-10-04). The host-source evidence above remains scoped to Pi 1.0.0, not all host versions.

## Realization and verification (2026-10-04)

The proposal-stage caveat corrected above described the spec-only endpoint. The user subsequently authorized implementation, and the decisions in this ADR are now realized; the requirements contract and its evidence table are in [spec 0006 — Per-task model selection and Agents UI configuration visibility](../spec/0006-per-task-model-selection.md#implementation-verification-2026-10-04).

Implementation: `src/configuration.ts` owns the exact-identity/thinking-level types, input validation and invocation capture; `src/inheritance.ts` no longer derives model/thinking from fuzzy CLI patterns and instead carries a plain `requestedConfiguration` snapshot; `src/delegate.ts` registers independent optional `model`/`thinkingLevel` inputs and, in the shared runner, drives exact RPC `set_model` → `set_thinking_level` → `get_state` verification before original-task submission, feeding confirmed values to `status.configured`; `src/status.ts` adds the confirmed configuration row and its `StatusObserver.configured` seam. `docs/usage.md` and `docs/runtime.md` document the interface and the runner-owned verification boundary, and the roadmap entry is closed.

Real Pi 1.0.0 RPC tests verify the four-way inheritance matrix in both synchronous and background mode, exact identity with slash/colon-bearing model IDs, no fallback on missing model/auth, Pi-native thinking adjustment (`max` → `high`, non-reasoning model → `off`) with requested/effective disclosure, no parent-selection or saved-default mutation, and confirmation-before-submission ordering under cancellation and control failures. The Agents rows are verified against host-composed terminal frames for connector/alignment, resized widths, ANSI/control sanitization and 5-second retention with stale-callback rejection.

Final post-format checks on Bun 1.4.1 / Pi 1.0.0: `bun test` (371 passed, 0 failed, 3712 assertions, 19 files), `bun run typecheck`, `bun run check` (Biome, 46 files), and `git diff --check` all passed.

Completion is scoped to this extension's startup-selection contract. Tests use deterministic local fixture providers without external model credentials; the UI evidence exercises the host-composed widget frame rather than InteractiveMode keyboard E2E. No runtime model-switch control, automatic routing, model-discovery tool, cross-version compatibility claim or guarantee of provider acceptance during a run is added, as decided above.
