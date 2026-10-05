# Public workspace release 0.2.0

**Status:** Accepted

## Context

The user authorized publishing both workspace packages and explicitly requested that their versions be unified at `0.2.0`.

## Decision

- Publish `@wangjq4214/pi-delegate` and `@wangjq4214/pi-open-tui` publicly at `0.2.0`.
- Remove the UI package's private flag and set `publishConfig.access` to `public`. This supersedes the private/non-publication boundary in ADR 0010; package independence and the private workspace root remain unchanged.
- Use a shared repository tag `v0.2.0` and GitHub Release containing both npm tarballs.
- Retain upstream UI attribution to v0.3.11; it describes the imported source snapshot, not this scoped package's release version.

## Consequences

Both scoped packages are installable independently from npm. Build, typecheck, lint, workspace tests and tarball contents must be checked before publication. Unrelated untracked review files and artifacts are excluded from the release commit.
