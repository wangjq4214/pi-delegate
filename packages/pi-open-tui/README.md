# @wangjq4214/pi-open-tui

An independent application intended to rewrite Pi’s terminal UI. It is **not** a UI package for pi-delegate and has no dependency on that extension.

## Current scope

This package is a private application scaffold only. Its entry prints a placeholder message and exits. Agent/session integration, interactive rendering, input handling, and the choice of UI architecture are not implemented or decided by this migration.

## Commands

Install dependencies from the [workspace root](../../README.md), then run:

```sh
bun run --filter @wangjq4214/pi-open-tui dev
bun run --filter @wangjq4214/pi-open-tui build
bun run --filter @wangjq4214/pi-open-tui start
bun run --filter @wangjq4214/pi-open-tui typecheck
bun run --filter @wangjq4214/pi-open-tui test
```

Build uses Rolldown and emits Node.js ESM to `dist/cli.js` with a source map. `start` requires a prior build and Node.js 22.19 or later. The package is not yet published and does not install a global executable.
