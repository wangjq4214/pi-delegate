# Independent packages in a Bun workspace

**Status:** Accepted

## Context

The user requested a monorepo and named a new UI package `pi-open-tui`. They clarified that it is an independent application intended to rewrite Pi’s UI, unrelated to delegate. They approved migration plus an application scaffold, not implementation of the new UI.

## Decision

- Use Bun workspaces under `packages/*`, retaining Bun 1.4.1 and TypeScript.
- Move the existing extension to `packages/pi-delegate`, preserving `@wangjq4214/pi-delegate`, its Pi manifest, bundled skill, published files and runtime behavior.
- Create `packages/pi-open-tui` as a private independent application scaffold, with its own build, start, development, typecheck and test scripts. The placeholder entry prints a message and exits.
- Name the application package `@wangjq4214/pi-open-tui`, following the user’s subsequent request to use the same npm username scope as delegate. Keep its directory `packages/pi-open-tui` and private status unchanged.
- Neither package depends on the other. Do not extract delegate’s existing status UI into the new application.
- Keep one lockfile, shared development tooling, Biome, Git hooks and base compiler options at the private workspace root. Run package tests in their package working directories; repository-level tests remain at the root.
- Do not add Turbo/Nx, a shared runtime package, agent/session integration or an interactive UI architecture in this migration.

## Consequences

- npm installation of delegate remains unchanged. Local Pi installation targets `packages/pi-delegate`, not the private repository root.
- Contributors use root `bun run test` to run repository tests and sequential workspace suites. Root bare `bun test` does not establish compatibility for delegate’s cwd-relative fixtures.
- Both packages build independently. The new application is not published or feature-complete; its Pi UI rewrite requires a separate design/implementation scope.
- Historical artifact source paths describe their original inspections; relative source links are migrated to the new locations without changing those contracts or prior evidence.
