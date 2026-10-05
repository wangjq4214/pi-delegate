# Import upstream pi-open-tui as an independent extension

**Status:** Accepted

## Context

The user requested a one-to-one copy of `https://github.com/OldSuns/pi-open-tui/tree/main` into `packages/pi-open-tui/`, with documentation following the existing repository style. Upstream is a Pi extension rather than the standalone application envisioned by ADR 0010.

## Decision

- Replace the application scaffold with upstream v0.3.11 at commit `766ccab7b40df6fb9682a105a05d3838803c3d4b`.
- Preserve extension source unchanged, relocated into the package's flat `src/` directory at the user's request; retain upstream tests with imports adjusted to `../src/`, preserving the upstream MIT notices in the root license. At the user's subsequent request, adapt upstream GitHub templates into root `.github/` for both packages and workspace tooling, removing the package-level copy.
- Retain `@wangjq4214/pi-open-tui` and private status. Keep both packages independent.
- Use the upstream Node test runner. At the user's subsequent request, both packages use Rolldown for Node ESM bundles with source maps and host SDK imports kept external. `dev` loads source, `start` loads `dist/index.js`, and Pi manifests and publication files target `dist`. `build:watch` supports iterative bundle debugging; `prepack` builds before packing/publishing. UI private status remains unchanged.
- Use the root Bun lockfile and shared TypeScript. Pin Pi SDK development dependencies to the workspace's existing 1.0.0. Omit upstream npm lockfile and npm-specific lifecycle-script metadata.
- Adapt bilingual READMEs, package guidelines, and development documentation to the workspace style and commands. Preserve attribution and explain the import revision and deviations.
- Exclude only imported extension/test directories from Biome formatting, lint, and import organization to avoid unrelated rewrites of the imported source and tests. TypeScript and upstream tests still verify those directories; metadata and integration tests remain under root Biome checks.

## Consequences

- This supersedes ADR 0010's application-scaffold scope and absent Pi manifest for this package, but not package independence, scope, private status, or workspace tooling.
- The package now changes the UI of an existing Pi host. It does not replace Pi's runtime or install a standalone executable.
- Configuration uses upstream's `~/.pi/agent/open-tui.json`; do not simultaneously load this package and the upstream extension.
- At the user's subsequent request, the repository adopts MIT at the root `LICENSE`, retaining both the project and upstream copyright notices. No separate `packages/pi-open-tui/LICENSE` is kept; package documentation links to the root license.
- Synchronization must record the upstream revision and intentional local differences. Interactive terminal/provider behavior requires separate smoke testing.
