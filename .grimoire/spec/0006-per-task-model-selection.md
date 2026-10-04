# Per-task model selection and Agents UI configuration visibility

**Spec ID:** 0006
**Status:** Implemented
**Date:** 2026-10-04
**Sources:** The settled refinement conversation: the user accepted independent `model: { provider, id }` and `thinkingLevel` overrides, exact model selection, and Pi-native thinking adjustment with effective-value disclosure; requested model/thinking visibility in the existing UI; refined the layout to a vertical bar before `model`, with its text aligned to the activity text; then explicitly invoked `grimoire-spec`. [ADR 0005](../adr/0005-per-task-model-selection.md).

## Source and coordination boundary

- **H-selection — Accepted handoff:** Retain current-parent inheritance by default. Capture configuration per invocation for both synchronous and background tasks, without changing the parent or saved defaults. Select an exact configured provider/model ID without silent fallback. Determine the model before applying the requested/inherited thinking level, follow Pi's capability adjustment, and disclose requested versus confirmed effective configuration. Verify child startup configuration before submitting the original task. Keep transport ownership in the runner and credential/configuration reinitialization conventional. Limit this increment to startup selection, without runtime model-switch controls, automatic routing or a new model-listing tool.
- **H-ui — UI requirement and final layout:** The user added “那个UI也要显示一下模型和thinking级别”, then refined the placement with “model前面有一个竖线吧，和thinking对齐吧”. The final handoff places a `│` before a dedicated model/thinking metadata line, aligns `model` with the activity text such as `thinking…`, and aligns `│` with the following activity connector `└`. This replaces the earlier provisional alignment to the summary/number/title. The metadata represents confirmed startup configuration, not the parent configuration or an unconfirmed requested value. Preserve the existing theme, width, status, pressure and terminal-retention behavior.
- **A — Architectural decision:** [ADR 0005](../adr/0005-per-task-model-selection.md), Completed, records the accepted exact-selection, invocation snapshot, native-thinking, runner and credential boundaries. UI layout is an ordinary requirement in this contract, not another ADR. (Originally recorded as Proposed; implementation was subsequently authorized — see [Implementation Verification](#implementation-verification-2026-10-04).)
- **B — Existing contracts:** [ADR 0002](../adr/0002-session-owned-background-delegation.md) retains the fresh RPC child, parent-only tools and conventional inheritance decisions from [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md); [spec 0002](./0002-session-owned-background-delegation.md) defines background ownership and result delivery. [Spec 0004](./0004-agent-status-ui.md) defines the existing Agents presentation, counting, pressure acknowledgement, theme and retention. [ADR 0004](../adr/0004-task-addressed-runtime-steering.md) and [spec 0005](./0005-background-runtime-steering.md) establish runner-owned task steering without giving the task registry arbitrary RPC control.
- **L — Inspected repository:** [src/inheritance.ts](../../src/inheritance.ts) currently derives model/thinking CLI arguments from the parent context. [src/delegate.ts](../../src/delegate.ts) captures inputs before either invocation path and owns shared child initialization, task submission and cleanup. [src/background.ts](../../src/background.ts) owns background tasks and eventual results. [src/status.ts](../../src/status.ts) currently renders summary and activity rows without model/thinking metadata. [Docs/runtime](../../docs/runtime.md) documents the current inheritance boundary; [the roadmap](../../docs/roadmap.md) lists per-task selection as unimplemented.
- **V — Host-source evidence:** Installed Pi 1.0.0 `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts` exposes exact registry lookup; `dist/core/model-resolver.js` permits fuzzy CLI selection; `dist/modes/rpc/rpc-mode.js` implements exact `set_model`, `set_thinking_level` and `get_state`; `dist/core/agent-session.js` checks auth configuration, reapplies thinking on model switches, clamps supported thinking levels, and persists defaults only when explicitly requested. Pi's `docs/rpc-commands.md` and `docs/cli.md` document the interfaces. This is feasibility evidence, not implemented or runtime-tested per-task selection.

Selected endpoint: **spec-only**, one contract for startup selection and its UI visibility, with a compatibility cross-reference in spec 0004. No slice, tickets, implementation plan, production/test edits or runtime/UI QA are authorized. The spec consumes settled requirements and established choices only: organize and express them, but do not invent or revise domain facts, requirements, constraints, acceptance semantics, architecture or unconfirmed assumptions. Meaningful assertions must trace to the handoff or sources. A needed new fact/decision returns to refine for clarification and live recording before this stage resumes; formatting and execution ordering do not authorize filling semantic gaps. Results return to refine at this endpoint.

**Concurrency/usage extension (2026-10-04):** [Spec 0007 — Concurrency scheduling and delegated cost visibility](./0007-concurrency-scheduling-and-cost-visibility.md) separately authorizes queued-phase visibility, capacity/aggregate information and an aligned per-task usage row in the same Agents area. Invocation-captured selection, child confirmation before original-task submission, requested-versus-effective truthfulness and R6–R7's model/activity alignment remain applicable. This cross-reference is a spec-only compatibility update, not implementation evidence for the new scheduling/usage feature.

## Requirements

### R1 — Independent optional selection inputs

- Extend the parent-only `delegate` tool with optional `model` and `thinkingLevel` inputs, for both synchronous and `background: true` calls.
- `model`, when present, is an object containing `provider` and `id` strings identifying a configured chat model. It is not a bare name, CLI pattern, glob or combined thinking suffix. A slash or colon that is part of an actual model ID remains part of that exact ID.
- `thinkingLevel`, when present, is one Pi level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. Valid level names are not a promise that every model supports every level.
- Reject malformed inputs or unknown exact model identities explicitly rather than treating them as omitted values or substituting defaults. Parent-side rejection happens before child startup and before accepting a background task ID. Child-side failures after acceptance follow R4.
- Retain existing task, context, title, background and pressure meanings. Do not add caller-supplied credential fields.

**Trace:** H-selection; A; V for level names and registry lookup; B for retained tool behavior.

### R2 — Invocation snapshot and independent inheritance

| Inputs | Model request | Thinking request before native adjustment |
| --- | --- | --- |
| Both omitted | Current parent model at invocation capture | Current parent thinking level at invocation capture |
| Only `model` supplied | Exact supplied provider/ID | Captured parent thinking level |
| Only `thinkingLevel` supplied | Captured parent model | Supplied level |
| Both supplied | Exact supplied provider/ID | Supplied level |

- Resolve omitted fields independently. A target model's saved thinking default must not replace the invocation's captured/supplied thinking request.
- Capture plain per-invocation configuration before handing work to the synchronous runner or background owner. Later parent model/thinking changes must not alter an already-accepted task's captured configuration.
- Concurrent tasks retain their own configurations without cross-task mutation. A child override must not change the parent session's selection or saved user/project defaults.
- Omitting the new fields retains parent inheritance rather than enabling automatic model routing.

**Trace:** H-selection; A; L for the existing capture/execution seam.

### R3 — Verified child startup configuration

- Keep the shared runner responsible for child transport, initialization, configuration verification and cleanup. The UI and background registry consume configuration data rather than receiving arbitrary RPC control.
- Complete inherited-tool initialization and establish the exact requested model and effective thinking level before submitting the original task.
- Determine the model before applying the invocation's thinking request. If model switching reapplies saved/default thinking, it must not override that subsequent request.
- Confirm the selected model identity and effective level from child state. Startup CLI arguments, parent registry membership, command acceptance or a background `taskId` alone do not establish effective child configuration.
- Do not execute the original task with a different model merely because CLI fuzzy matching, defaults or child reconstruction selected one. Unknown/unavailable models and configuration-verification failures are explicit failures, not fallback policies.
- Apply Pi-native thinking capability adjustment to a valid requested level, including an inherited level. Do not reject solely because the host adjusts that valid level, or duplicate model-specific adjustment rules in the extension.
- The verified values describe startup session configuration. This increment does not promise provider consumption, successful inference or immutable physical-provider routing throughout a run.

**Trace:** H-selection; A; V for exact RPC selection, model-switch thinking and effective state.

### R4 — Credentials, failure and ownership compatibility

- Continue the existing child working directory, inherited environment, conventional configuration discovery and provider-extension reinitialization. Do not assume parent-only runtime model/provider or credential state is available in another process.
- Child-side unavailable models, unreconstructible providers, missing auth configuration and configuration-setting/readback failures must produce an explicit failed task under existing result and cleanup semantics. Do not select another model or proxy configuration/credential resolution to the parent as a silent substitute; retain the existing synchronous/background child UI-request policy.
- Parent-side input/identity rejection returns a failed call without accepting background work. A valid background call may return its task ID before child-side configuration completes; subsequent startup failure is preserved in its queryable result and normal completion delivery.
- Do not label requested configuration as verified when failure or cancellation prevents confirmation. Preserve available diagnostics/configuration without fabricating missing effective values.
- Do not copy resolved API keys, OAuth tokens or auth headers into delegation arguments, configuration metadata, status rows or results. Successful auth-configuration checks do not guarantee that a remote provider accepts a later request.
- Preserve existing synchronous cancellation, session/branch-owned background lifetime, parent-only delegation reachability, steering readiness, soft pressure, terminal outcomes, usage accounting, result delivery/query and cleanup. Configuration work must not count as original-task running time or completed execution turns.

**Trace:** H-selection; A; B; existing initialization-excluding time semantics in spec 0004.

### R5 — Requested and confirmed configuration in results

- Results must expose the invocation's resolved model/thinking request separately from available child-confirmed startup model/thinking values. Exact result-member names are not prescribed here; the distinction is part of the contract.
- Report the actual confirmed level, not just a successfully submitted request. If Pi adjusts the level, the request-to-effective difference must be observable in the returned configuration data.
- Carry available configuration through synchronous terminal results and background result query/completion channels, including later execution failures or cancellation. A failure before confirmation must not manufacture effective values.
- Preserve existing task-output, truncation, stop-reason and usage meanings. An initial background acknowledgement remains acceptance, not a final configuration or task-success receipt.

**Trace:** H-selection; A; B for existing result channels and unavailable-data behavior.

### R6 — Model/thinking visibility in the existing Agents UI

- Extend the existing above-input Agents list for both synchronous and background children. Keep the first summary row's numeric identity, title, time, English turn labels and acknowledged pressure indicator.
- Add a separate metadata row between the summary and existing activity/outcome row. When startup configuration is confirmed, show the model as `provider/id` and the effective level with English `model:` and `thinking:` labels.
- The model metadata belongs to the same child as the summary/activity. It must not show another task's or the parent's subsequent configuration, or replace current activity with configuration text.
- Before confirmation, do not present captured/requested configuration as already effective. The exact pending/unknown wording is an implementation detail; requested values, if shown, must be clearly distinguished from confirmed values. A pre-confirmation failure/cancellation must not leave a false effective-value claim.
- The effective thinking-level label is configuration metadata, not evidence that the model is currently thinking. Keep activity such as `thinking…` dependent on observed activity as in spec 0004.
- Retain confirmed startup metadata with the terminal summary/activity for the existing 5-second visual retention, then remove the whole child display without discarding a still-queryable background result. Late old-scope configuration callbacks must not repopulate invalidated rows.
- Preserve the existing theme integration, semantic activity/pressure colors, spacing, metadata sanitization and terminal-column width bounds. New model IDs and levels must not inject ANSI/control sequences or hidden lines. Narrow-terminal truncation remains permissible; no additional width threshold or new palette is introduced.

**Trace:** H-ui; H-selection/A for effective-value truthfulness; B/spec 0004 for visual-only ownership and unchanged presentation semantics.

### R7 — Vertical connector and activity-text alignment

At accommodating terminal widths, use this row relationship:

```text
  1  Check RPC errors · 12s · 3 turns · pressure: none
    │  model: provider/model-id · thinking: low
    └─ thinking…
```

- Prefix the configuration row with a vertical `│`; its terminal column aligns with the activity/outcome row's `└` connector.
- Align the start of `model` with the start of activity/outcome text after `└─ `, for example the `t` in `thinking…`. Do not instead align it with the summary number or task title.
- Apply the same relationship when activity is a tool call or terminal outcome. It is presentation, not an activity-history tree or a new task identity.
- When existing narrow-width inset reduction/truncation applies, both subordinate rows share the same alignment basis and every rendered line still fits the supplied width. Do not preserve fixed padding by overflowing the terminal.
- The illustrated title, duration, count, model ID, level and activity are examples, not preset roles/models or evidence that every child emits thinking events.

**Trace:** H-ui's final refinement; B/spec 0004 for width/spacing and activity boundaries.

## Solution

Extend the existing invocation-capture and shared-runner boundary with an exact model identity and a thinking request. Independently resolve overrides/inheritance once per invocation, then establish and confirm configuration in the initialized child before original-task submission. Keep Pi responsible for supported-level adjustment and conventional provider/auth configuration, with explicit failures rather than model substitution. Publish requested/confirmed configuration as data to existing result channels and the visual-only status owner.

The existing summary and activity/outcome remain intact; insert the configuration row and use the R7 connector/alignment. [Spec 0004](./0004-agent-status-ui.md) remains the baseline UI contract. This separately authorized feature extends its original allowed-field restriction only with model/thinking metadata; historical UI verification does not verify the new row or startup selection. No new public runtime control channel, task owner or module layout is prescribed.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Selection input/capture | Parent tool call and current context → execution options | Independent valid overrides, captured current parent selection, both invocation modes | Exact per-invocation model/thinking request; early invalid-input/unknown-identity rejection without parent mutation (R1–R2) |
| Child model/provider reconstruction | Existing inheritance/configuration → fresh RPC child | Conventional sources/environment, configured model/provider and usable auth configuration | Child-local model availability or explicit reconstruction/auth failure, without copied secret metadata or fallback (R3–R4) |
| Startup verification | Shared runner → child model/thinking control and state | Successful tool initialization; exact identity; requested thinking after model determination | Confirmed startup model/effective level before original-task submission, or failed/cancelled task with cleanup (R3–R4) |
| Configuration/result data | Runner → synchronous results and background result ownership | Captured request and available confirmed startup values | Requested/effective distinction through existing terminal/query/completion channels, with background acceptance kept distinct (R5) |
| Configuration/status data | Runner/invocation identity → existing visual status owner | Same-child confirmed configuration or explicitly unconfirmed state, ownership validity | Truthful model/thinking metadata without RPC authority, cross-task contamination or stale-scope updates (R6) |
| Terminal rendering | Correlated status/configuration → existing Agents widget | Current theme/width, unchanged summary/activity and agreed connector relationship | `│` metadata row aligned to activity text, current theme, bounded width and unchanged terminal retention (R6–R7) |

## End-to-End Tests

These are future acceptance scenarios, not tests executed by this spec stage.

### T1 — Default inheritance and independent overrides (R1–R3, R5–R6)
- **Given:** A parent with a selected model/thinking level and reconstructible configured alternatives, exercised in synchronous and background mode.
- **When:** It delegates with neither field, only model, only thinking, and both fields.
- **Then:** Child startup uses R2's model/request combination after Pi-native adjustment. Original task input reaches that configured child; results distinguish request/effective values; TUI metadata reflects the confirmed child configuration. Parent selection and saved defaults remain unchanged.

### T2 — Exact identity, malformed inputs and no fuzzy fallback (R1, R3–R4)
- **Given:** Configured models with similar names or equal IDs across providers, a model whose exact ID includes a slash/colon, and a reconstructible provider.
- **When:** Calls select a known exact provider/ID, an unknown/partial identity, or malformed model/thinking input.
- **Then:** Valid exact IDs select only that model and do not parse ID punctuation as thinking syntax. Invalid/unknown parent inputs fail before child startup/background acceptance. If the child cannot establish the exact accepted identity, it fails without executing the original task on a similar/default model.

### T3 — Native adjustment and saved-thinking defaults (R2–R3, R5–R6)
- **Given:** A target model with a saved thinking default different from the invocation request, and models with restricted/no reasoning support.
- **When:** Delegation switches to the target and applies an explicit or inherited valid Pi level, including a level that the target adjusts.
- **Then:** The task uses Pi's effective result for the invocation request rather than the saved default. Adjustment alone does not fail the task. Results preserve requested/effective levels and UI shows the effective level; a no-reasoning model reports the host's effective `off` without falsely claiming thinking activity.

### T4 — Concurrent tasks and parent changes after acceptance (R2, R5–R6)
- **Given:** Concurrent delegations using different combinations and a background child held during initialization.
- **When:** The parent changes its own model/thinking after background acceptance and the children later start/finish independently.
- **Then:** Each task uses its captured combination, with same-child configuration in results/UI and no cross-task leakage. Neither completion nor configuration reporting rewrites parent selection/defaults.

### T5 — Child-only configuration failures and cancellation (R3–R6)
- **Given:** Parent-valid inputs whose provider/auth/runtime state cannot be reconstructed by the child; separately, initialization/control/readback fails or cancellation occurs before confirmation.
- **When:** A synchronous call starts, or an accepted background task proceeds to child initialization/configuration.
- **Then:** Original task execution does not start with unconfirmed/different configuration. Failures/cancellation retain their existing distinct outcomes and cleanup; background queries/completion deliver the outcome after its initial acknowledgement. Available request/diagnostics are retained, unavailable effective values are not invented, and no resolved credentials enter tool/UI/result metadata.

### T6 — Confirmed UI row and final alignment (R6–R7)
- **Given:** Real host-composed Agents displays for synchronous/background children, including held initialization, distinct confirmed models/levels, observed thinking/tool activity and terminal outcomes.
- **When:** Configuration is confirmed and activity/outcome changes at accommodating widths, then the terminal is narrowed/resized.
- **Then:** The first summary remains intact; the dedicated configuration row uses `│`, its model text starts in the same terminal column as activity/outcome text, and `│` aligns to `└`. Confirmed metadata is not replaced by parent/request-only values or interpreted as observed thinking. Narrow lines remain width-bounded with consistent subordinate alignment, and new metadata is sanitized.

### T7 — Retention, invalidation, theme and non-TUI compatibility (R4–R7)
- **Given:** Active and retained configuration rows, a queryable background result, a pending old-scope configuration update, representative themes and existing RPC/non-TUI invocation paths.
- **When:** Theme switching/redraw, the existing 5-second terminal expiry, or session/reload/branch ownership invalidation occurs; non-TUI tasks also execute.
- **Then:** Metadata follows the existing theme/width contract with no new palette; all rows expire together while queryable results retain configuration. Old updates cannot reappear in a new scope. Existing cancellation, pressure acknowledgement, activity/outcome meanings, result/usage channels and non-TUI execution remain operational without the widget.

## Decisions

- **Choice:** Independent `model: { provider, id }` and `thinkingLevel` rather than ambiguous CLI patterns. **Reason/source:** H-selection and ADR 0005; exact provider identity avoids fuzzy substitution and cross-provider ambiguity.
- **Choice:** Capture each invocation and verify child startup before task submission, with model determination preceding the thinking request. **Reason/source:** H-selection and ADR 0005; V establishes model-switch defaults and effective-state interfaces.
- **Choice:** Pi-native thinking adjustment with requested/effective disclosure rather than a duplicate capability policy or strict rejection of every adjustment. **Reason/source:** Explicitly accepted H-selection and ADR 0005.
- **Choice:** Conventional credential/provider reconstruction, runner-owned control and existing lifecycle/result owners. **Reason/source:** H-selection, ADR 0005 and B; do not expand the task registry/UI into transport or credential owners.
- **Choice:** A dedicated configuration row with `│` aligned to `└` and model text aligned to activity text. **Reason/source:** H-ui's final refinement, superseding the earlier provisional summary/number/title alignment.
- **Choice:** One new feature spec with a bounded extension link in spec 0004; no slice/implementation stage. **Reason/source:** The user accepted the spec-only route and explicitly invoked spec after adding/refining UI visibility. Selection and its visibility share one startup-configuration contract and approval path.

## Verification boundary and remaining implementation freedom

- No unconfirmed architectural assumption or blocking requirement choice is required by this draft. Exact result-member names, pending/unknown wording, new metadata's styling within the existing theme contract, width-dependent abbreviation details and internal module layout remain implementation details within R1–R7.
- Future verification needs real Pi child startup/control and a controlled credential-free provider, not only argument-array or renderer mocks. Pair requested/effective metadata with the model/thinking state used at original-task onset, and deliberately exercise model-specific saved defaults and a child-only reconstruction failure.
- For R7, measure the composed host frame in terminal columns, ignoring ANSI bytes and accounting for wide/combining characters. Include normal/narrow widths and multiple-digit UI identities without creating a new width or refresh-rate SLA.
- Inspect persisted model/thinking settings and parent session selection before/after execution to establish absence of task-induced default/parent mutation. Existing result/UI tests are baseline evidence, not verification of this new feature.
- Host feasibility inspection is scoped to Pi 1.0.0. No new runtime/UI QA, tests requiring external provider credentials, full terminal-input E2E or cross-version compatibility verification has been performed in this spec-only stage.

## Out of Scope

- Runtime model-switch controls, automatic model routing, a new model-discovery/listing tool, or a task scheduling/cost-budget system.
- Caller-supplied API keys, secret-bearing configuration/result/UI metadata, cross-process model/provider/auth proxies, or copying arbitrary parent in-memory state.
- Changes to task ownership, steering/pressure policy, usage accounting, tool inheritance/parent-only reachability, workspace isolation or the existing terminal-retention duration.
- UI roles, token/cost statistics, result bodies, tool arguments, thinking content or activity-history logs; changing Pi's overall layout/theme or adding a separate palette/configuration watcher.
- Tickets/slice, an implementation plan, production/test edits or runtime/UI QA at this selected endpoint. **(2026-10-04: scoped to the original spec-only endpoint; implementation and verification were subsequently authorized — see [Implementation Verification](#implementation-verification-2026-10-04).)**

## Implementation Verification (2026-10-04)

The "Source and coordination boundary" and "Verification boundary" sections above describe the original spec-only stage. The user subsequently authorized implementation, test authoring/execution and verification; this dated section records the execution evidence without changing R1–R7, the solution seams or the out-of-scope list.

Implementation: `src/configuration.ts` (new) owns the `ModelIdentity`/`TaskConfiguration`/`ThinkingLevel` types, the `model`/`thinkingLevel` tool parameter schemas, parent-side validation and invocation capture; `src/inheritance.ts` replaces fuzzy CLI `--provider/--model/--thinking` derivation with a plain `requestedConfiguration` snapshot; `src/delegate.ts` registers the independent optional inputs, rejects invalid/unknown selections before child startup and background acceptance, and in the shared runner drives exact `set_model` → `set_thinking_level` → `get_state` verification before original-task submission; `src/status.ts` adds the `StatusObserver.configured` seam and the `│` configuration row with unconfirmed wording. `docs/usage.md` and `docs/runtime.md` document the interface and the runner-owned verification boundary; the roadmap entry is closed.

| Requirements | Evidence |
| --- | --- |
| R1, R2 | `tests/configuration.test.ts`: the selection table covers both-omitted, model-only, thinking-only and both-supplied resolution, plus malformed model/level and absent-parent-selection rejection and full-model metadata stripping. `tests/delegate.integration.test.ts` `real public Pi selection {sync,background}` runs the four combinations through the real public `delegate` tool with a slash/colon-bearing model ID. |
| R3, R4 | `tests/configuration.runner.test.ts`: for sync and background, the `success`, `set_model`, `set_thinking_level`, `get_state`, `mismatch`, `invalid-level`, `execution-error` and `cancel` scenarios assert command ordering, that no `prompt`/observer/control runs before verification, and that requested configuration survives failure (fixture: `tests/fixtures/configuration-rpc.mjs`). `tests/delegate.integration.test.ts` `real startup missing-model\|missing-auth\|cancel-init preserves request without submitting original task` proves the original task is not executed on a fallback model, with cleanup verified. |
| R5 | Integration asserts `configuration: { requested, effective }` on completion, including Pi-native adjustment (`max` → `high`, non-reasoning model → `off`); failure/cancellation cases retain `requested` with no fabricated `effective`. |
| R6 | `tests/status.presentation.test.ts` asserts the pre-confirmation row `model: unconfirmed · thinking: unconfirmed` and the confirmed `model:`/`thinking:` labels within the existing theme and width bounds; `tests/status.test.ts` `confirmed configuration expires with terminal rows and old callbacks cannot restore it` covers 5-second retention, invalidation, stale-scope and post-failure callbacks; `tests/status.integration.test.ts` exercises the real runner plus widget for sync and background. |
| R7 | `tests/status.presentation.test.ts` `composed configuration rows align connector and activity text, sanitize IDs, and fit resized widths` measures the host-composed frame over 10 rows: `│` aligned to `└`, model text aligned to activity text, wide/combining-character widths, ANSI/OSC-link stripping, U+2028/U+2029 removal and resized-width bounds. |
| T4, T7 | `tests/delegate.integration.test.ts` `real concurrent child startup and UI retain snapshots across parent changes and cancellation`; `tests/status.presentation.test.ts` real theme switch/hot-reload; existing RPC/non-TUI paths re-verified in `tests/delegate.integration.test.ts`. |
| R2 parent/default immutability | Integration asserts parent `get_state` before/after equality and byte-identical `settings.json`, including saved `modelThinkingLevels` defaults. |

Final post-format checks on Bun 1.4.1 / Pi 1.0.0: `bun test` (371 passed, 0 failed, 3712 assertions, 19 files), `bun run typecheck`, `bun run check` (Biome, error-on-warnings, 46 files) and `git diff --check` all passed.

Limits: tests use deterministic local fixture providers and isolated real Pi RPC processes, without external model credentials or service requests. The UI evidence exercises the host-composed widget frame, not InteractiveMode keyboard/picker E2E. Feasibility and verification remain scoped to Pi 1.0.0; the unchanged out-of-scope list above still excludes runtime model switching, automatic routing, a model-discovery tool and cross-version compatibility claims.
