# pi-delegate

[English](README.md) | [简体中文](README.zh-CN.md)

Delegate focused tasks to fresh Pi subagents without leaving your current session.

pi-delegate is a TypeScript extension for Pi. It launches one-off subagents over RPC, with synchronous results or opt-in background execution.

## Features

- **Fresh subagents:** each task runs in a new session; delegation tools are available only to the parent agent.
- **Tool inheritance:** reconstruct the parent's tools and extensions, preserving activation and discoverability.
- **Synchronous and background execution:** wait for a result or continue working while a session-owned task runs.
- **Task management:** receive model-visible completion messages, query background results, and cancel tasks explicitly.
- **Soft pressure and status UI:** configure task-local finish reminders and monitor subagents above the TUI input.

## Requirements

- Git and Bun 1.4.1 or later for local setup.
- Node.js 22.19 or later. When Pi runs under Bun, `node` must be available on `PATH` for child processes.
- A compatible Pi host. This extension is validated with `@earendil-works/pi-coding-agent@1.0.0`; other host versions are not currently verified.

## Installation

Run the following from the root of a local Git checkout:

```sh
bun install --frozen-lockfile
```

Dependency installation also installs the development Git hook. See the [development guide](docs/development.md) for setup details.

### Load the extension directly

```sh
bun run pi --extension ./src/index.ts
```

Pi loads the TypeScript source directly; no build step is required.

### Install as a local Pi package

With Pi CLI installed:

```sh
pi install /absolute/path/to/pi-delegate
```

The package declares its extension entry point in `package.json`. Install its dependencies with Bun first. It is currently marked `private` and is not published to npm.

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

| Tool | Purpose |
| --- | --- |
| `delegate` | Start a fresh synchronous or background subagent. |
| `delegate_status` | Query a background task by its returned `taskId`. |
| `delegate_cancel` | Cancel a background task and wait for resource cleanup. |

See the [usage guide](docs/usage.md) for parameters, result states, pressure settings, and the status UI.

## Limitations

- Background execution requires a long-lived TUI or RPC session. Tasks do not survive exit, reload, session replacement, or branch navigation.
- Parent and child agents share the working directory; the extension does not provide workspace isolation or an operating-system sandbox.
- The parent's full conversation is not copied automatically. Supply relevant context explicitly.
- Soft pressure is advisory, not a hard timeout. Background usage is reported separately from Pi's parent-session totals.

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

This repository does not currently include a license file. Licensing terms have not been specified.
