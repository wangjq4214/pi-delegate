# Development guide

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Roadmap](roadmap.md)

## Local setup

Use Git, Bun 1.4.1 or later, and a compatible Pi host. The development dependencies pin Pi 1.0.0. Pi CLI running under Node.js requires Node.js 22.19 or later; children launched by a Bun host require `node` on `PATH`.

From the repository root:

```sh
bun install --frozen-lockfile
```

Run dependency installation inside a Git repository so Lefthook can install the hook. The `postinstall` script installs `pre-commit`; if lifecycle scripts were disabled, install it manually:

```sh
bun run hooks:install
```

If Bun reports blocked lifecycle scripts in transitive dependencies, these checks and tests do not require automatically trusting those scripts.

## Running the extension locally

```sh
bun run pi --extension ./src/index.ts
```

With Pi CLI already installed, you can also run:

```sh
pi --extension ./src/index.ts
```

Pi loads TypeScript directly, without a build step. Use Pi's `/reload` after modifying the extension.

The `pi.extensions` field in `package.json` declares `src/index.ts`. The repository can also be installed as a local Pi package; see [installation](../README.md#installation).

Local package dependencies must be installed by the developer with Bun. Pi host modules are peer dependencies and are also pinned as development dependencies for local types; they are not bundled into the extension. The package is marked `private` to prevent accidental npm publication.

## Development commands

| Command | Purpose |
| --- | --- |
| `bun run check` | Non-writing Biome formatting, lint, and import checks; warnings fail the check. |
| `bun run check:fix .` | Format the project, apply safe lint fixes, and organize imports. |
| `bun run format` | Apply formatting only. |
| `bun run typecheck` | Type-check `src/` and `tests/`. |
| `bun test` | Run unit, integration, lifecycle, and isolated Git-hook tests. |
| `bun run hooks:install` | Install or update Lefthook-managed hooks. |

`check:fix` also accepts individual file paths. Fixes do not use `--unsafe`; issues without safe fixes need manual changes.

## Testing

Before submitting code changes, run:

```sh
bun run check
bun run typecheck
bun test
git diff --check
```

The test suite includes:

- Parent/child tool-registration and inheritance checks.
- RPC execution, result states, output truncation, and cleanup.
- Background completion delivery, cancellation, session replacement/reload, and branch-navigation boundaries.
- Pressure timing/turn semantics and TUI status behavior.
- Real Pi processes with deterministic local model providers and MCP fixtures.
- Hook behavior in isolated temporary Git repositories.

Hook tests create commits only in temporary repositories and do not change this project's index or history. Tests do not include model-call end-to-end scenarios requiring external credentials.

TUI tests exercise the real runtime APIs and status component, not a complete terminal rendering/keyboard/picker end-to-end workflow. Host compatibility beyond Pi 1.0.0 is not currently verified.

Biome does not check Markdown formatting. For documentation-only changes, inspect the rendered structure, verify relative links and examples, keep the README translations aligned, and run `git diff --check`.

## Git hooks

Configuration lives in `lefthook.yml`. Only `pre-commit` is configured; there is no `pre-push` hook.

Before a commit, the hook runs sequentially:

1. Format staged Biome-supported files, apply safe lint fixes, and organize imports.
2. Re-stage fixed files through Lefthook's `stage_fixed: true`.
3. Type-check the entire project, including unstaged source and test files.

Remaining lint errors, warnings, or type errors fail the commit. Automatic fixes may already have changed the working tree before failure; inspect the diff before retrying.

Markdown/YAML-only commits skip Biome, but still run type checking. Tests are run manually with `bun test` and are not attached to another hook.

### Partially staged files

The hook processes whole working-tree files and re-stages them. Unstaged edits in a partially staged file may therefore be included in the commit.

When using `git add -p`, save those edits separately first and inspect `git diff --cached` before committing. This hook does not promise to preserve partial-staging boundaries.

## Repository layout

```text
README.md                English project overview
README.zh-CN.md          Matching Chinese project overview
docs/                    English usage, runtime, development, and roadmap docs
src/index.ts             Pi extension entry point
src/delegate.ts          Tool registration and delegation runner
src/inheritance.ts       Tool reconstruction and parent-only boundaries
src/child.ts             Internal child initialization
src/rpc.ts               Child-process RPC transport and cleanup
src/background.ts        Session-owned background tasks and completion delivery
src/pressure.ts          Per-task finish-reminder policy
src/status.ts            TUI child-status component
src/output.ts            Output truncation and retained result files
tests/                   Bun tests and local fixtures
.grimoire/               Requirements and architectural decision records
biome.json               Biome configuration
lefthook.yml             Pre-commit configuration
tsconfig.json            TypeScript configuration
bun.lock                 Dependency lockfile
```

## Documentation changes

Keep `README.md` and `README.zh-CN.md` aligned section by section, including commands, examples, capabilities, and limitations. Both READMEs link to each other; detailed guides under `docs/` are maintained in English.

Put tool-reference details in [usage](usage.md), lifecycle and safety guarantees in [runtime](runtime.md), contributor workflows here, and proposed work in [roadmap](roadmap.md). Roadmap candidates are not current features.

Consult the relevant specifications and architectural decisions in `.grimoire/` before changing project behavior or contracts.
