# pi-btw

Build and load both extensions from the workspace root (omit the delegate
`-e` argument if your Pi session already loads a compatible delegate runtime):

```sh
bun run --filter @wangjq4214/pi-delegate build
bun run --filter @wangjq4214/pi-btw build
pi -e ./packages/pi-delegate/dist/index.js -e ./packages/pi-btw/dist/index.js
```
Use `/btw <question>` to ask a side question. The right-side overlay does not
resize the main chat or take editor focus. Use `/btw` with no argument to
focus the open overlay (or reopen it after closing); use the arrow keys to
scroll and Escape to close.

The child sees a bounded snapshot of recent dialogue from the current branch.
Questions and answers are not added to the main conversation. Only the
current side question is retained by the overlay; there is no separate saved
chat or streamed answer. Delegate retains its normal task records.

The child inherits tools just like an ordinary delegate invocation. This is
not a read-only mode: inherited tools may run commands, modify files, or have
other side effects. Side questions and any retrieved content are sent to the
selected model.
