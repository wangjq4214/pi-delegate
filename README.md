# Pi workspace

[English](README.md) | [简体中文](README.zh-CN.md)

A Bun + TypeScript monorepo with two independent packages:

| Package | Purpose | Status |
| --- | --- | --- |
| [`@wangjq4214/pi-delegate`](packages/pi-delegate/README.md) | Pi extension for RPC subagent delegation | Existing extension; npm name and behavior preserved |
| [`@wangjq4214/pi-open-tui`](packages/pi-open-tui/README.md) | Configurable Pi terminal UI extension imported from OldSuns/pi-open-tui | Public npm package; based on upstream v0.3.11 |

`pi-open-tui` is not a delegate UI extraction. Neither package depends on the other. No shared runtime package or Turbo/Nx layer is introduced.

## Development

Use Git, Bun 1.4.1 or later, and Node.js 22.19 or later for the Pi host, delegate’s children, and the UI extension’s upstream tests.

From the repository root:

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run build
bun run typecheck
bun run check
bun run test
```

`build`, `typecheck`, and `test` run workspace scripts sequentially. `test` also runs repository-level tests. Use **`bun run test`**, not a bare root `bun test`: delegate fixtures resolve paths relative to their package directory. Biome and Git hooks are configured at the repository root.

### Run a single package

```sh
bun run --filter @wangjq4214/pi-delegate test
bun run --filter @wangjq4214/pi-open-tui dev
bun run --filter @wangjq4214/pi-open-tui build
bun run --filter @wangjq4214/pi-open-tui start
```

Both packages use Rolldown to emit `dist/index.js`, a source map, and a copy of the root license at `dist/LICENSE`. `dev` loads TypeScript source; `start` loads the bundle and requires a prior build. Use `/reload` in Pi after source changes, or after a `build:watch` rebuild. These scripts run Pi in the package directory.

### Load or install delegate

```sh
bun run --cwd packages/pi-delegate pi --extension ./src/index.ts
# With Pi CLI installed, after building:
pi install /absolute/path/to/checkout/packages/pi-delegate
# Existing npm installation is unchanged:
pi install npm:@wangjq4214/pi-delegate
```

The root is private and is not a Pi package. Build/pack/publish each package from its directory under `packages/`; delegate retains its extension entry and bundled worktree skill.

## Layout

```text
packages/
  pi-delegate/       Extension source, tests, skills, docs and build config
  pi-open-tui/       Imported UI extension, tests and docs
tests/               Repository-level Git-hook and workspace tests
.grimoire/           Project requirements and architectural records
package.json         Private workspace root and shared development tools
tsconfig.base.json   Shared TypeScript compiler options
tsconfig.json        Repository-level test type checking
biome.json           Repository-wide formatting/lint configuration
lefthook.yml         Repository-wide pre-commit hook
bun.lock             One workspace lockfile
```

See the [delegate development guide](packages/pi-delegate/docs/development.md) for runtime verification and Git-hook limitations. Consult relevant `.grimoire/` records before changing contracts.

## License

[MIT](LICENSE). The root license covers this repository and retains the upstream pi-open-tui copyright notice.
