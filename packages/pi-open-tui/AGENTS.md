# Package Guidelines

## Layout and scope

- `src/` is the imported Pi extension; `tests/` contains the upstream `node:test` suite.
- The root `../../LICENSE` retains MIT attribution.
- See [docs/development.md](docs/development.md) for the exact upstream revision and integration differences.
- This package is independent of pi-delegate and is private. Do not add dependencies between them.

## Development

Use the Bun workspace at the repository root:

```sh
bun install --frozen-lockfile
bun run --filter @wangjq4214/pi-open-tui typecheck
bun run --filter @wangjq4214/pi-open-tui test
bun run check
```

Use `bun run --filter @wangjq4214/pi-open-tui dev` to load source for interactive verification. `build` uses Rolldown to emit `dist/index.js`, a source map, and `dist/LICENSE`; Pi host SDKs remain external. `start` loads the built extension. `prepack` builds before packing/publishing; private status is unchanged.

## Changes

Preserve imported source and tests unless a behavior change is explicitly requested. Keep strict typing, focused `node:test` coverage, the MIT license, and upstream attribution. The imported source/test directories intentionally opt out of Biome to preserve the snapshot. Other files follow the root configuration.

Keep English and Chinese READMEs aligned. Detailed docs are maintained in English. Use the root `bun.lock`; do not introduce a package-level npm lockfile or new lifecycle-script permissions.
