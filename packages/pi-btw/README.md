# pi-btw

Build and load both extensions from the workspace root (omit the delegate
`-e` argument if your Pi session already loads a compatible delegate runtime):

```sh
bun run --filter @wangjq4214/pi-delegate build
bun run --filter @wangjq4214/pi-btw build
pi -e ./packages/pi-delegate/dist/index.js -e ./packages/pi-btw/dist/index.js
```
Run `/btw` to open a centered chat overlay with a focused input. Press Enter
to send, use ↑/↓ or Page Up/Page Down to scroll, and press Escape to hide
the chat and return to the main editor. Run `/btw <question>` to send directly
without taking focus from the main editor.

Ask follow-up questions in the same overlay. Hiding and reopening it preserves
the chat until you switch branches or sessions. Each request can see a bounded
snapshot of recent main dialogue and completed side-chat exchanges. Side
questions and answers never enter the main conversation. There is no saved
side chat or streamed answer. Delegate retains its normal task records.

The child inherits tools just like an ordinary delegate invocation. This is
not a read-only mode: inherited tools may run commands, modify files, or have
other side effects. Side questions and any retrieved content are sent to the
selected model.
