# Public workspace packages with trusted publishing

**Status:** Testing
**Date:** 2026-10-26

## Context

The user requested tag-triggered GitHub Release and npm publication. During refinement they explicitly confirmed that pi-dollar-skills should also become public, that only stable releases are needed, and that npm Trusted Publishing can be configured.

[ADR 0014](./0014-public-workspace-release-0.2.0.md) records the earlier public release of pi-delegate and pi-open-tui. At inspection, both are at 0.4.3 while pi-dollar-skills is private at 0.1.0. This decision extends the public package scope; it does not replace the historical 0.2.0 release record or the package independence established in [ADR 0010](./0010-independent-workspace-packages.md) and [ADR 0026](./0026-independent-dollar-skill-extension.md).

## Decision

- Include `@wangjq4214/pi-dollar-skills` in public npm publication alongside `@wangjq4214/pi-delegate` and `@wangjq4214/pi-open-tui`; retain the private workspace root and independent packages.
- Scope the requested automated release flow to stable releases, not prerelease channels.
- Use one shared `vX.Y.Z` repository tag and align all three public package versions to `X.Y.Z` before tagging. The user confirmed unified versions; a mismatch must block publication rather than trigger automatic version edits.
- Use npm Trusted Publishing (OIDC) for automated npm publication rather than a stored long-lived npm token. The user confirmed they can configure the required npm-side trust.

## Consequences

- Delivery must change pi-dollar-skills' private publication metadata before it can be publicly published; this record does not itself change package files or publish anything.
- npm-side trust configuration is an external setup requirement. User willingness to configure it is not evidence that trust is already configured or that first-publication prerequisites have been verified.
- This record captures confirmed publication, versioning and authentication boundaries, not an implemented workflow or an authorization to execute a release.
