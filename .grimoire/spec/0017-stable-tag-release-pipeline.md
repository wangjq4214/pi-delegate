# Stable tag-triggered workspace releases

**Spec ID:** 0017
**Status:** Draft
**Date:** 2026-10-26
**Sources:** Refinement conversation: the user requested automatic GitHub Release and npm publication on tagging, confirmed making pi-dollar-skills public, stable releases only and npm Trusted Publishing, then accepted shared package versions and the recommended spec-only endpoint. The proposed flow includes validation before npm publication, Release creation afterward with tarballs and generated notes, and rerun support. Durable boundaries are in [ADR 0030](../adr/0030-public-workspace-trusted-publishing.md).

## Requirements

1. Provide a GitHub Actions release workflow for `wangjq4214/pi-delegate`. Pushing a stable release tag `vX.Y.Z` to GitHub triggers publication from that tagged revision. Creating a tag only locally does not trigger it. Prerelease tags, unrelated tags and ordinary branch pushes must not publish through this flow.
2. Publish these three packages publicly to npm as one shared release version:
   - `@wangjq4214/pi-delegate` from `packages/pi-delegate/`;
   - `@wangjq4214/pi-open-tui` from `packages/pi-open-tui/`;
   - `@wangjq4214/pi-dollar-skills` from `packages/pi-dollar-skills/`.
   The workspace root remains private and unpublished. Delivering the flow includes making pi-dollar-skills' package metadata publicly publishable; package independence remains unchanged.
3. Before publication, all three package manifest versions must equal the tag version without the leading `v`. A mismatch or invalid stable version blocks both npm publication and Release creation. The workflow must not automatically bump versions, commit changes or create replacement tags. Maintainers prepare and commit aligned versions before tagging.
4. All release validation must pass before any package is published: frozen-lockfile dependency installation, repository lint/format checks, type checking, workspace tests, builds and package tarball checks. Use the existing repository script contracts, particularly `bun run test`, not bare root `bun test`, so package-relative fixtures retain their intended working directories.
5. Check the tarballs for the declared package identity/version and shipped contents: the built `dist/index.js` Pi entry, bundled license, declared documentation and delegate's bundled skills. Tarballs must reflect each package's `files` contract rather than include the workspace root or unrelated repository artifacts. These are the package artifacts published to npm and attached to the Release.
6. Authenticate automated npm publication using npm Trusted Publishing/OIDC, not a stored long-lived npm publication token. Required npm-side trust configuration remains externally managed. Missing authorization or a publication error must fail visibly rather than be reported as a successful release.
7. After all three package versions are available on npm, create a non-prerelease GitHub Release for the triggering tag, with automatically generated release notes and all three npm `.tgz` artifacts. Do not create the successful Release while any package publication remains unsuccessful.
8. Support rerunning a failed workflow for the same tag. Skip package versions already successfully published; publish missing ones and finish the GitHub Release and its three assets without creating duplicate releases or assets. Do not try to overwrite immutable npm versions. An npm lookup/authentication/network failure is not evidence that a version is already published.
9. Supply maintainer-facing setup and release instructions covering npm trust configuration for each package and the eventual workflow identity, version preparation, tag pushing and recovery after partial failure. Verify and document the new package's initial-publication prerequisites rather than assume OIDC is already usable for a package not yet created on npm.

## Solution

A shared stable tag identifies a single repository revision and release version. GitHub Actions validates that revision and all three manifests, runs the repository's existing checks and produces the three package tarballs. Only after successful validation does it publish missing package versions through npm Trusted Publishing. Successful npm completion enables the GitHub Release with the same tag, generated notes and package artifacts.

Reuse the current Bun workspace, lockfile and per-package build/pack contracts. The root declares Bun 1.4.1 and README development guidance requires Node.js 22.19 or later. This spec does not select action versions or a workflow filename; delivery must use tooling compatible with the checked-in project and npm Trusted Publishing requirements.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Release trigger | Maintainer / GitHub tag push → Actions | Stable `vX.Y.Z` tag and its exact revision | A release attempt tied to that version and source revision; no publication for other inputs |
| Version and quality gate | Tagged workspace → release artifacts | Three aligned manifests, frozen lockfile, existing check/build/test scripts and package file declarations | Validated tarballs, or failure before external publication |
| Publication identity | GitHub Actions OIDC ↔ npm package trust | Trust configured for the repository/workflow and each package; compatible runner/tooling | Authorized public publication without a stored long-lived token, or visible authentication failure |
| npm publication and retry | Validated tarballs / workflow ↔ npm registry | Package identities, versions, artifacts and reliable published-version lookup | Three available package versions; already successful versions skipped during retry |
| Release completion | Workflow → GitHub Releases | All three npm versions available, triggering tag, tarballs and generated notes | One stable Release containing three assets, including after a retry |
| Maintainer setup | Release documentation ↔ external npm configuration | Package ownership/access, workflow identity and initial-publication prerequisites | Explicit setup and recovery instructions; configuration is not silently assumed complete |

## End-to-End Tests

### Stable release succeeds

- **Given:** The three manifests match a prepared stable version, trust is configured, and all validations pass.
- **When:** The maintainer pushes the matching `vX.Y.Z` tag.
- **Then:** The workflow validates the tagged revision, publishes the three public npm packages at `X.Y.Z`, and subsequently creates one stable GitHub Release for that tag with generated notes and the three checked tarballs.
- **And:** The private root is not published; the workflow makes no version-bump commit or tag change.

### Non-release input cannot publish

- **Given:** A branch push, unrelated tag or prerelease tag such as `v1.2.3-beta.1`.
- **When:** GitHub processes the push.
- **Then:** This release flow performs no npm publication and creates no release for that input.

### Version mismatch blocks external changes

- **Given:** A stable tag differs from at least one of the three manifest versions.
- **When:** Its workflow runs.
- **Then:** Validation fails before any npm publication or Release creation, and the version mismatch is identifiable.

### Quality or artifact validation fails

- **Given:** Aligned versions but a dependency install, lint, typecheck, test, build or tarball-content check fails.
- **When:** The stable-tag workflow runs.
- **Then:** No package is published and no Release is created. A missing built entry or bundled license is an artifact-validation failure, not a publishable package.

### npm authorization is missing

- **Given:** The build passes but required package trust is absent or invalid.
- **When:** npm publication is attempted.
- **Then:** The run fails visibly without a successful Release or a silent token-authentication fallback.

### Retry completes a partial publication

- **Given:** The first attempt published one or two package versions before another npm publication failed.
- **When:** The failed run is rerun for the same tag after resolving the failure.
- **Then:** Published versions are skipped, missing versions are published, and the Release is completed with all three assets.
- **And:** Registry lookup failures are reported as failures, not treated as success or as a reason to skip an unpublished package.

### Retry completes GitHub Release delivery

- **Given:** All npm publications succeeded, but GitHub Release creation or an asset upload failed.
- **When:** The run is rerun.
- **Then:** npm versions are not republished and one Release ends with all three assets, without duplicates. A fully successful rerun likewise leaves one complete Release.

## Decisions and Evidence

- **Public scope, stable-only flow, unified versions and OIDC:** Confirmed in the refinement conversation and recorded in [ADR 0030](../adr/0030-public-workspace-trusted-publishing.md). No new runtime coupling is authorized.
- **Release with npm tarballs:** The initial recommendation retains the shared-tag/Release pattern in [ADR 0014](../adr/0014-public-workspace-release-0.2.0.md), extended to the third package. ADR 0014's `0.2.0` is historical, not the next release version.
- **Quality gates and workspace execution:** [Root package.json](../../package.json), [README](../../README.md) and ADR 0014 establish the existing checks and package-working-directory requirement. Package manifests declare the shipped file lists, Pi entry and prepack builds: [delegate](../../packages/pi-delegate/package.json), [Open TUI](../../packages/pi-open-tui/package.json), [dollar skills](../../packages/pi-dollar-skills/package.json).
- **Retry and ordering:** The recommended flow publishes npm before creating the Release and supports reruns after partial success. This is recovery, not an atomic transaction spanning npm and GitHub.
- **Selected endpoint:** One requirements spec, no ticket decomposition or implementation plan. The work is a single coordinated release flow; separate tickets add no selected handoff value.

## Verification and Limitations

- This spec is a requirements handoff, not evidence that a workflow exists or that a release was executed. No production code, package versions, account settings or tags are changed during refinement.
- npm-side trust and pi-dollar-skills' initial-publication prerequisites have not been verified. Delivery must establish and document these before claiming end-to-end readiness. Any required one-time package setup is distinct from routine OIDC publication and requires appropriate external authorization.
- No next release number is selected. Maintainers choose it and align the three versions before pushing its tag; illustrative versions in tests do not authorize a release.
- npm package publication is immutable and the three package uploads are not atomic. Partial npm success can remain after a failure; retry completes the remaining work rather than rolling back published packages.
- A check that a package/version exists supports retry skipping; this spec does not claim that existence alone proves byte-for-byte equality with a rebuilt local tarball.
- Implementation verification should cover trigger filtering, version and quality gates, package artifacts, identity failure and both partial-success retry paths. Any real npm/GitHub publication used as evidence requires separate authorization; do not release merely to validate this spec.

## Out of Scope

- Prerelease channels or independently versioned package releases.
- Automatic version bumping, release commits, or tag creation by the workflow.
- Publishing the private workspace root or changing runtime package dependencies.
- Starting implementation, QA execution, account configuration, commits, tag pushes or publication in this spec-only refinement.
