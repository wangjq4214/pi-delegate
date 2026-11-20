# pi-btw

Build and load both extensions from the workspace root (omit the delegate
`-e` argument if your Pi session already loads a compatible delegate runtime):

```sh
bun run --filter @wangjq4214/pi-delegate build
bun run --filter @wangjq4214/pi-btw build
pi -e ./packages/pi-delegate/dist/index.js -e ./packages/pi-btw/dist/index.js
```
Run `/btw` to open a centered chat overlay with a focused input. Press Enter
to send and use ↑/↓ or Page Up/Page Down to scroll. While the overlay has focus,
Escape stops all pending side requests without interrupting the main chat.
Press Escape again to close the overlay and return to the main editor without
waiting for cancellation to finish. When there is nothing to stop, Escape closes
the overlay on the first press. Run `/btw <question>` to send directly without
taking focus from the main editor.

The overlay uses the active Pi theme. Open TUI, when enabled, styles the
composer, individual User messages, and the side chat's own Workline—not the
outer overlay. Otherwise these use Pi's native appearance. The overlay reduces
padding and decoration on small terminals. It does not show tool calls.

Ask follow-up questions in the same overlay. Hiding and reopening it preserves
the chat until you switch branches or sessions. Each request can see a bounded
snapshot of recent main dialogue and completed side-chat exchanges. Side
questions and answers never enter the main conversation. There is no saved
side chat or streamed answer. Delegate retains its normal task records.

The child inherits tools just like an ordinary delegate invocation. This is
not a read-only mode: inherited tools may run commands, modify files, or have
other side effects. Side questions and any retrieved content are sent to the
selected model.
