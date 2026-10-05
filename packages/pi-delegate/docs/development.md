# Development guide

[Back to README](../README.md) · [Usage](usage.md) · [Runtime and safety](runtime.md) · [Roadmap](roadmap.md)

## Local setup

Use Git, Bun 1.4.1 or later, and a compatible Pi host. The development dependencies pin Pi 1.0.0. Pi CLI running under Node.js requires Node.js 22.19 or later; children launched by a Bun host require `node` on `PATH`.

From the repository root:

The workspace root is two levels above this package. Shared tooling, Git hooks and the lockfile live there; this package retains its own Pi manifest. See the [workspace overview](../../../README.md).

```sh
bun install --frozen-lockfile
```

Run `bun run hooks:install` inside a Git repository to install the development `pre-commit` hook explicitly. There is no `postinstall` hook, so npm consumers do not need Git or Lefthook.

If Bun reports blocked lifecycle scripts in transitive dependencies, these checks and tests do not require automatically trusting those scripts.

## Running the extension locally

```sh
bun run --cwd packages/pi-delegate pi --extension ./src/index.ts
```

With Pi CLI already installed, you can also run:

```sh
pi --extension ./packages/pi-delegate/src/index.ts
```

Pi loads TypeScript directly, without a build step. Use Pi's `/reload` after modifying the extension.

The `pi.extensions` field in `packages/pi-delegate/package.json` declares `dist/index.js`. Run `bun run build` from the workspace root before installing `packages/pi-delegate` as a local Pi package; the private root itself is not installable as a Pi package. See [installation](../README.md#installation).

Rolldown builds a single Node.js ESM entry with a source map. Node built-ins and Pi host modules remain external. The source entry remains available for direct development loading; delegation resolves the matching source or built entry for child processes. Pi host modules are peer dependencies and pinned as development dependencies for local types; they are not bundled.

For the same source/bundle commands as the UI package:

```sh
bun run --filter @wangjq4214/pi-delegate dev
bun run --filter @wangjq4214/pi-delegate build
bun run --filter @wangjq4214/pi-delegate start
# In another terminal, for bundle changes:
bun run --filter @wangjq4214/pi-delegate build:watch
```

These scripts run Pi in the package directory. Reload source or rebuilt bundles with `/reload`; avoid loading an installed copy alongside the explicit source entry. The bundle includes `dist/LICENSE` copied from the workspace root. `prepack` builds before packing/publishing; inspect `npm pack --dry-run --workspace @wangjq4214/pi-delegate` from the root before a release. For Node inspector setup, see the [UI development guide](../../pi-open-tui/docs/development.md#bundle-debugging-and-packaging), substituting delegate’s package directory and source entry as needed.

## Development commands

Run the following from the workspace root. For delegate-only checks, use `bun run --filter @wangjq4214/pi-delegate build`, `typecheck`, or `test`. Bare `bun test` is supported inside `packages/pi-delegate`, not at the workspace root, because fixtures use package-relative paths.

| Command | Purpose |
| --- | --- |
| `bun run build` | Build all workspace packages; delegate emits `packages/pi-delegate/dist/index.js`. |
| `bun run check` | Non-writing Biome formatting, lint, and import checks; warnings fail the check. |
| `bun run check:fix .` | Format the project, apply safe lint fixes, and organize imports. |
| `bun run format` | Apply formatting only. |
| `bun run typecheck` | Type-check repository tests and all workspace packages. |
| `bun run test` | Run repository tests and each package’s tests in its own directory. |
| `bun run hooks:install` | Install or update Lefthook-managed hooks. |

`check:fix` also accepts individual file paths. Fixes do not use `--unsafe`; issues without safe fixes need manual changes.

## Testing

Before submitting code changes, run:

```sh
bun run build
bun run check
bun run typecheck
bun run test
git diff --check
```

The test suite includes:

- Parent/child tool-registration and inheritance checks.
- RPC execution, result states, output truncation, and cleanup.
- Background completion delivery, cancellation, session replacement/reload, and branch-navigation boundaries.
- Pressure timing/turn semantics and TUI status behavior.
- Background runtime steering readiness/closure, manual-pressure serialization, trusted handlers, slash safety, both host modes, real control timeout, provider-input boundaries, and child discovery/nested/codemode exclusion.
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

Markdown/YAML-only commits skip Biome, but still run type checking. Tests are run manually with `bun run test` and are not attached to another hook.

### Partially staged files

The hook processes whole working-tree files and re-stages them. Unstaged edits in a partially staged file may therefore be included in the commit.

When using `git add -p`, save those edits separately first and inspect `git diff --cached` before committing. This hook does not promise to preserve partial-staging boundaries.

## Repository layout

```text
README.md                         Workspace overview (English)
README.zh-CN.md                   Workspace overview (Chinese)
packages/pi-delegate/
  README.md, README.zh-CN.md      Published extension overviews
  docs/                          Usage, runtime, development, roadmap
  src/                           Unchanged extension runtime and status UI
  tests/                         Delegate tests and local fixtures
  skills/                        Bundled delegate-worktree skill
  package.json                   Published Pi package manifest
  rolldown.config.mjs            Extension build configuration
  tsconfig.json                  Extends shared compiler options
packages/pi-open-tui/             Independent imported Pi UI extension
  src/                           Upstream source entry and modules
  tests/                         Upstream Node test suite
  rolldown.config.mjs            Extension bundle and license emission
tests/                           Repository-level tests, including Git hooks
.grimoire/                       Requirements and architecture records
biome.json                       Shared Biome configuration
lefthook.yml                     Shared pre-commit configuration
tsconfig.base.json               Shared TypeScript compiler options
tsconfig.json                    Repository-level test type checking
bun.lock                         Workspace dependency lockfile
```

## Documentation changes

Keep `README.md` and `README.zh-CN.md` aligned section by section, including commands, examples, capabilities, and limitations. Both READMEs link to each other; detailed guides under `docs/` are maintained in English.

Put tool-reference details in [usage](usage.md), lifecycle and safety guarantees in [runtime](runtime.md), contributor workflows here, and proposed work in [roadmap](roadmap.md). Roadmap candidates are not current features.

Consult the relevant specifications and architectural decisions in `.grimoire/` before changing project behavior or contracts.
