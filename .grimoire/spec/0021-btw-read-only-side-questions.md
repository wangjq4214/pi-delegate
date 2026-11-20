# `/btw` multi-turn chat in a centered overlay

**Spec ID:** 0021  
**Status:** Draft  
**Date:** 2026-11-20

**Sources:** The original `/btw` discussion chose a standalone package and default delegate tool inheritance. The follow-up refinement superseded right-side placement and single-question interaction: the user requested an input box on bare `/btw`, chose a centered overlay, confirmed multi-turn chat, and approved revising this spec only. Baselines: [delegate consumer API](../../packages/pi-delegate/docs/api.md), [child inheritance](../../packages/pi-delegate/src/inheritance.ts), [consumer-owned presentation](./0020-goal-progress-and-readable-list.md), and [instance-local layout adaptation ADR](../adr/0020-instance-local-user-message-layout-adaptation.md).

## Requirements

1. **Open a chat before asking.** In the Pi TUI, bare `/btw` opens a centered floating chat and focuses its input, including on first use. If the chat is already open, focus its input. Opening it without a question neither shows a usage notification nor submits a request. Enter in the chat input submits the question to the side chat, not the main editor. The overlay may cover part of the main view but does not reserve columns or reflow the main chat.
2. **Keep the quick-ask shortcut.** `/btw <question>` submits that question to the same side chat and shows the centered overlay without stealing focus from the main editor or waiting for the answer before returning control.
3. **Support follow-ups.** The overlay shows the conversation, including questions, answers, and the current invocation's status or failure. Follow-ups can refer to previous exchanges in that side chat. Esc from the focused overlay hides it and returns focus to the main editor without clearing the conversation. Reopening on the same branch in the same session lets the user continue. Switching branch or session clears the side chat; results from the old chat must not appear in the new one. No durable side-chat history is required.
4. **Keep context one-way.** At submission, the side request can reference a bounded snapshot of recent user and assistant text from the current main branch, along with preceding side-chat exchanges for follow-ups. Do not forward the full main transcript, main tool outputs, or other branches. Side-chat questions and answers do not enter the main transcript or future main-model context, and completion does not start a main turn. The exact snapshot bound is not prescribed.
5. **Keep delegate behavior unchanged.** Use the same tool registration, active-tool restoration, and exclusions as ordinary delegation in the same parent session. `pi-btw` does not add a tool policy or change the parent tool set. This is not read-only or a workspace sandbox: inherited tools can have side effects. Suppress only the compact Agents row for the side-chat invocation; ordinary delegate presentation, records, and accounting remain unchanged.

## Solution and integration contracts

| Boundary | Contract |
| --- | --- |
| Pi TUI → `pi-btw` | Use the public custom overlay interface for centered placement and focus control. `pi-btw` owns the input and the branch- and session-scoped side conversation. Read main-branch context without modifying it. |
| `pi-btw` → public `pi-delegate` API | Use the existing `execute()` contract with the new question and scoped dialogue context. Reuse invocation progress and consumer-managed presentation for status and row suppression. The API supplies the terminal answer or failure; answer streaming is not required. `pi-delegate` continues to own execution and accounting. |

## End-to-end acceptance

- **Open and ask from an empty side chat.** On first use, run bare `/btw`. A centered overlay opens with a focused input and no usage notification or request. Type a question and press Enter. The overlay shows the question, status, and answer or a truthful failure; the main chat does not reflow or receive a turn.
- **Close, reopen, and follow up.** Ask for two alternatives in the overlay, wait for the answer, press Esc, and run `/btw` again. Focus returns to the main editor on Esc and to the side input on reopening. The original exchange is still visible, and asking about “the second option” can use that exchange as context without restating it.
- **Isolate branch and session changes.** After creating side history, switch branches or sessions and open `/btw`. The previous exchange is not shown or carried into a new side request. If an old request was still running, its result does not populate the new chat.
- **Preserve quick ask and context direction.** Run `/btw <question>` about a detail stated in recent current-branch dialogue. It appears in the same centered chat, while the main editor keeps focus and is usable before completion. Inspect the request boundary for eligible main dialogue and the absence of abandoned-branch material and main tool outputs. Neither the question nor the answer appears in the main transcript or the next main-model request.
- **Verify inheritance and coexistence.** Run a side request and an ordinary delegate invocation with the same parent configuration. Both receive the same registered tools, active subset, and existing exclusions, and both retain normal delegate records and accounting. Only the side request suppresses its own compact Agents row.

## Decisions and exclusions

- Centered chat replaces the original right-side overlay. Bare `/btw` is the interactive entry point; the argument form remains the non-focus-stealing shortcut. A true split layout, host layout patch, or `pi-open-tui` dependency is not required.
- The existing delegate API and default tool inheritance remain in force. No new tool-loading policy or second task runner is required. The historical filename does not imply read-only execution.
