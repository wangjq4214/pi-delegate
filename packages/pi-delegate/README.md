# pi-delegate

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Delegate focused tasks to fresh Pi subagents without leaving your current session.

pi-delegate is a TypeScript extension for Pi. It launches one-off subagents over RPC, with synchronous results or opt-in background execution.

## Features

- **Fresh subagents:** each task runs in a new session; delegation tools are available only to the parent agent.
- **Tool inheritance:** reconstruct the parent's tools and extensions, preserving activation and discoverability.
- **Synchronous and background execution:** wait for a result or continue working while a session-owned task runs.
- **Task management:** discover synchronous/background tasks, inspect retained results, and manage background work in a floating `/delegates` TUI panel or through tools.
- **Runtime steering:** add context, narrow scope, or request a report from an active background child without restarting it.
- **Opt-in soft pressure and status UI:** finish reminders are off by default; explicitly configure them per task and monitor subagents above the TUI input.
- **Opt-in execution budgets:** disclose per-task time/turn limits upfront and cancel on either observed threshold, independently of advisory pressure.

## Requirements

- Git and Bun 1.4.1 or later for local setup.
- Node.js 22.19 or later. When Pi runs under Bun, `node` must be available on `PATH` for child processes.
- A compatible Pi host. This extension is validated with `@earendil-works/pi-coding-agent@1.1.0`; other host versions are not currently verified.

## Installation

### Install from npm

```sh
pi install npm:@wangjq4214/pi-delegate
```

The npm package includes the built extension and worktree skill; no local build is required.

### Local development setup

Run the following from the root of a local Git checkout:

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run build
```

Development Git hooks are installed explicitly with `bun run hooks:install`; npm consumers do not run development hooks. See the [development guide](docs/development.md).

### Load the extension directly

```sh
bun run --cwd packages/pi-delegate pi --extension ./src/index.ts
```

Pi loads the TypeScript source directly; no build step is required.

### Install as a local Pi package

With Pi CLI installed:

```sh
pi install /absolute/path/to/checkout/packages/pi-delegate
```

The package declares the built `dist/index.js` extension and bundled `delegate-worktree` skill in `package.json`. Install dependencies and run `bun run build` before installing a local checkout.

This package is now under `packages/pi-delegate` in a Bun workspace. The root is private; pack/publish from this package directory. See the [workspace overview](../../README.md).

## Usage

The parent agent can call `delegate` with a task and the context it needs:

```json
{
  "task": "Review error handling in src/ and report findings with file paths",
  "context": "Analyze only; do not modify files"
}
```

By default, the call waits for the child's final outcome. To continue working while the child runs, opt into background mode:

```json
{
  "task": "Analyze test coverage and report gaps",
  "context": "Analyze only; do not modify files",
  "background": true
}
```

Background outcomes do not send automatic completion messages or wake the parent. Use `delegate_list` to discover tasks and `delegate_status` to retrieve results on demand.

| Tool | Purpose |
| --- | --- |
| `delegate` | Start a fresh synchronous or background subagent. |
| `delegate_list` | Discover bounded task summaries in the current session/branch. |
| `delegate_wait` | Wait for selected tasks; return statuses only, not reports. |
| `delegate_status` | Inspect a synchronous or background task by exact `taskId`. |
| `delegate_cancel` | Cancel a background task and wait for resource cleanup. |
| `delegate_steer` | Submit plain-text instructions to an active background task by `taskId`. |

To wait instead of polling, call `delegate_wait` with `{ "taskIds": ["<exact taskId>"] }`. It defaults to any task ending and 30 seconds; optionally select `condition: "all"` and a positive `timeoutSeconds` up to 120. Completion, failure, cancellation and incomplete outcomes all count as ending. The response contains only statuses; retrieve reports separately with `delegate_status`. Timeout or cancelling a wait does not cancel background work. See [explicit waiting](docs/usage.md#explicit-waiting).

In TUI mode, `/delegates` opens one floating list → details → confirmation/instruction panel. Synchronous IDs are read-only: independent cancellation and steering remain background-only. Records/results survive five-second compact-row expiry, but not scope invalidation; the panel does not require pi-open-tui.

Optional execution limits work in either mode:

```json
{ "task": "Analyze the core risks and report unfinished work honestly", "budget": { "maxSeconds": 120, "maxTurns": 8 } }
```

Each omitted dimension is unlimited; no default hard budget is added. Seconds must be positive/finite and turns positive integers (zero is invalid). The child receives the limits before working. Time excludes queue/init but includes provider/tool waits; turns are completed assistant responses with associated tools. Either observed threshold cancels without extra reporting generation. Results distinguish budget cancellation and retain available partial text/usage; effects are not rolled back and process shutdown is not instantaneous. See [execution budgets](docs/usage.md#optional-execution-budget).

See the [usage guide](docs/usage.md) for parameters, result states, pressure settings, and the status UI.

## Limitations

- Background execution requires a long-lived TUI or RPC session. Tasks do not survive exit, reload, session replacement, or branch navigation.
- Parent and child agents share the working directory by default; optional `cwd` selects another existing directory. The bundled `delegate-worktree` skill guides parent-managed Git workspaces; the extension does not manage worktrees, enforce filesystem isolation, or provide an operating-system sandbox.
- The parent's full conversation is not copied automatically. Supply relevant context explicitly.
- Soft pressure is advisory, not a hard timeout. Background usage is reported separately from Pi's parent-session totals.
- Steering returns RPC handling receipts, not model-consumption or completion confirmation; initialization returns `not_ready`, and a timeout is uncertain, not a reason to retry automatically.

See [runtime and safety](docs/runtime.md) for inheritance, lifecycle, interaction, and cleanup boundaries.

## Documentation

- [Usage guide](docs/usage.md) — tools, parameters, results, pressure, and TUI behavior.
- [Runtime and safety](docs/runtime.md) — tool inheritance, process ownership, cancellation, and security boundaries.
- [Development guide](docs/development.md) — setup, checks, tests, Git hooks, and repository layout.
- [Roadmap](docs/roadmap.md) — prioritized capability candidates and TODOs.

The detailed documentation is maintained in English.

## Contributing

See the [development guide](docs/development.md) before making changes. Run the documented checks and tests, and keep the English and Chinese READMEs aligned when updating project-level documentation.

## License

[MIT](../../LICENSE). See the workspace root for the full license text.
