# `/btw` side questions using default delegate tool inheritance

**Spec ID:** 0021  
**Status:** Draft  
**Date:** 2026-11-20

**Sources:** The user requested a standalone side-question package using delegate, chose a right-side overlay over a reserved column, and approved a Spec-only handoff. In the subsequent refinement, the user superseded the read-only design by selecting delegate's default tool loading. Baselines: [delegate consumer API](../../packages/pi-delegate/docs/api.md), [child inheritance](../../packages/pi-delegate/src/inheritance.ts), [consumer-owned presentation](./0020-goal-progress-and-readable-list.md), and [instance-local layout adaptation ADR](../adr/0020-instance-local-user-message-layout-adaptation.md). The installed Pi TUI documentation describes public custom overlays, positioning, and focus control.

## Requirements

1. **Side question, not a main turn.** `/btw <question>` submits a side question from the Pi TUI and opens a right-anchored overlay showing the question, task status, and final answer or failure. Submission does not wait for the child to finish before returning control to the main editor. The overlay does not take editor focus by default. It may cover the right side of the existing view; it does not reserve columns, narrow, or reflow the main chat.
2. **One-way context.** A side question can reference a bounded snapshot of recent user and assistant text from the current branch at submission. Do not forward the full transcript, tool outputs, or other branches. Neither the side question nor its answer is added to the main transcript or future main-model context, and completion does not start a main turn. The exact snapshot bound is not prescribed.
3. **Default tool inheritance.** A `/btw` child uses the same tool registration, active-tool restoration, and exclusions as an ordinary delegate invocation in the same parent session. `pi-btw` does not add a tool policy, allowlist, or project-root restriction and does not change the parent tool set. This is not read-only: if normal inheritance permits shell, writes, or extension tools, the child can use them. Main-chat isolation is not workspace isolation.
4. **Shared execution, separate UI.** `pi-btw` owns the command and overlay; `pi-delegate` owns task execution and accounting. Show status from that invocation and display the returned final answer. Suppress only that invocation's compact Agents row; ordinary delegate behavior, records, and accounting remain unchanged. No change to Pi's source, private layout adapters, `pi-open-tui` dependency, or second task runner is required.

## Solution and integration contracts

| Boundary | Contract |
| --- | --- |
| Pi TUI → `pi-btw` | Use the public custom overlay interface for right-side placement and focus control. Read main-branch context without modifying it. |
| `pi-btw` → public `pi-delegate` API | Use the existing `execute()` contract with the side question and scoped dialogue context. Reuse invocation progress and consumer-managed presentation for status and row suppression. The API returns a terminal result and does not stream answer text. No new delegate API or tool-loading mode is needed. |

## End-to-end acceptance

- **Ask while using the main editor.** Submit `/btw` with a question about a known in-project file. The right overlay appears without changing the main chat's wrapping or taking editor focus by default. The editor remains available before the child settles. The overlay shows task status and then an answer or a truthful failure; the side question and answer do not appear in the main transcript or the next main-model request.
- **Verify context direction.** Ask about a detail stated in recent current-branch dialogue. The child receives the eligible dialogue snapshot, not abandoned-branch material or tool outputs. Completing the side question does not trigger a main inference.
- **Verify inherited tools.** From the same parent configuration, compare `/btw` with an ordinary delegate invocation. Both children receive the same registered tools and active subset, and both retain the existing exclusions for delegation and declared parent-only tools. `/btw` neither strips otherwise eligible tools nor bypasses exclusions.
- **Check coexistence.** Run a side question and an ordinary delegate invocation. Only the side question replaces its own per-task Agents row. Both retain normal delegate records and accounting.

## Decisions and exclusions

- Use the public right-side overlay rather than true split layout. The user accepted overlap to avoid changing Pi's layout internals. The existing User-message adapter ADR does not authorize a new host layout patch and does not need to change for this route.
- Default inheritance supersedes the earlier read-only proposal. Do not ship the experimental `toolPolicy` API or advertise sandboxing, read-only access, or project-root confinement.
- No streamed answer body, durable side-chat history, or custom Pi layout is required. Exact overlay geometry and presentation details are not prescribed by this contract.
