# Stable workspace releases

## Contract

- Push a stable `vX.Y.Z` tag to `wangjq4214/pi-delegate`. Only that exact tagged revision is released. Prerelease/invalid tags cannot publish; branch pushes do not trigger this workflow.
- All four package manifests must already have version `X.Y.Z`: `@wangjq4214/pi-delegate`, `@wangjq4214/pi-open-tui`, `@wangjq4214/pi-dollar-skills`, and `@wangjq4214/pi-goal`. The workspace root remains private. Goal pins the matching delegate release, which is published and visible on npm before goal is published.
- The workflow never changes versions, commits or tags. It runs frozen installation, lint, typecheck, `bun run test`, builds and tarball checks before any publication.
- The read-only validation job builds and packs once. The dependent publishing job rechecks the same downloaded archives, publishes missing versions to npm's stable `latest` channel, then creates a GitHub Release with generated notes and all four `.tgz` files.
- No npm token is stored in Actions. npm uses OIDC Trusted Publishing; GitHub Release delivery uses the job's scoped `GITHUB_TOKEN`.

Local preparation does not publish packages or configure npm trust. Do not reuse an existing release tag.

## One-time npm setup

These are **human setup instructions**, not steps to run just to test the implementation. They can publish packages or change account settings and require maintainer authorization.

1. Ensure the npm account can publish all four scoped packages and create public packages under `@wangjq4214`. Ensure GitHub Actions is enabled in the repository.
2. A package must exist on npm before its Trusted Publisher can be configured. For a new package such as `pi-goal`, use [npm staged publishing](https://docs.npmjs.com/staged-publishing/) with a maintainer's npm login to create the package without making its real release public:
   - With npm 11.15.0 or later, stage a temporary tarball with a **distinct prerelease version** (for example, `0.6.0-bootstrap.0`, not `0.6.0`). Make this tarball from a temporary copy; do not edit or stage the verified release tarball.
   - Use `npm stage publish /absolute/path/to/bootstrap.tgz --tag bootstrap --access public --ignore-scripts --registry=https://registry.npmjs.org`. npm creates the package entry; leave the bootstrap submission unapproved. Do not add maintainer credentials to GitHub.
   - After the real stable release succeeds, discard the unused staged bootstrap submission. Existing packages need no bootstrap.
3. In **each package's npm Settings → Trusted publishing → GitHub Actions**, configure:
   - Organization or user: `wangjq4214`
   - Repository: `pi-delegate`
   - Workflow filename: **`release.yml`**, not `.github/workflows/release.yml`
   - Environment name: **leave empty**; this workflow does not use a GitHub Environment.
   - If the npm UI offers a publication mode, allow direct `npm publish`, not staged-only publication.
4. npm Trusted Publishing requires npm **11.5.1+** and Node.js **22.14+**. The publishing job installs npm 11 on Node 24 on a GitHub-hosted Ubuntu runner. Do not replace this with `bun publish` or an older npm.
5. The package `repository.url` and `repository.directory` identify this repository and package subdirectory. The release helper validates them. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. Restrict who can push release tags: a matching tag authorizes external publication without an approval environment.

npm-side trust must be configured separately for all four packages. A workflow file alone does not configure npm. If the workflow filename, owner, repository or environment changes, update trust before releasing.

Sources: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [public scoped package publication](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

## Prepare a release

Choose a new stable version not already used by a public workspace package or an existing repository tag.

1. Edit `version` in all four `packages/*/package.json` files to the chosen `X.Y.Z`, and update the goal manifest’s `@wangjq4214/pi-delegate` dependency to the same exact version. Keep the root private. Update the lockfile with `bun install --lockfile-only` and inspect the diff.
2. From the repository root, using Bun 1.4.1 and Node 24:
   ```sh
   # Set this to your actual chosen version; X.Y.Z is a placeholder.
   VERSION=X.Y.Z
   node scripts/release.ts validate "v$VERSION"
   bun install --frozen-lockfile
   bun run check
   bun run typecheck
   bun run build
   bun run test
   # Clear only stale release tarballs from dist/release if it already exists.
   node scripts/release.ts pack "v$VERSION"
   node scripts/release.ts verify "v$VERSION"
   ```
   The `validate`, `pack` and `verify` modes never publish. `pack` disables npm lifecycle scripts because workspace builds have already run; it checks actual archive manifests, allowed files, built entry, license, documentation and bundled delegate skills. `dist/release/` must contain exactly the four versioned tarballs.
3. Complete first-publication setup if needed, configure npm trust, then commit the workflow/scripts/docs and aligned manifests/lockfile. Review and push the commit through the normal repository process.
4. **Only when intentionally releasing**, tag that commit and push the tag:
   ```sh
   git tag -a "v$VERSION" -m "Release v$VERSION"
   git push origin "v$VERSION"
   ```
   Local tagging alone does not start Actions. Watch **Actions → Stable release**. The workflow cannot be manually dispatched to publish a branch.

Do not push a tag merely to validate the workflow. Both the tag push and the initial npm publication described here are real release operations. Neither is performed by this implementation or its offline tests.

## Failure recovery

- **Invalid tag/version or failed install/check/test/build/archive check:** no npm package or GitHub Release is created by that attempt. Fix the source and prepare a new appropriate release commit/tag; do not force-move a published release tag.
- **npm authentication failure:** check all four npm trust records, exact workflow filename and repository metadata, runner/npm versions and package bootstrap. A package/version 404 from the anonymous public registry lookup means absent; an npm publish 404 can instead indicate a trust/permission failure. Other lookup HTTP errors, invalid identity/JSON and network failures abort; they are not successful publication.
- **Partial npm success:** published versions are immutable and are not rolled back. After each accepted upload, the helper polls npm every 15 seconds for up to 20 minutes while npm processes the package; only version-not-found (404) responses are retried. Other lookup failures still abort. If processing exceeds this window, check npm status and wait for the version to become public before rerunning; do not blindly republish or bump the version. Use **Re-run failed jobs** for the same workflow/tag to skip exact package/version identities already on npm and publish only missing ones. Reruns use the original tagged source, so a local script fix is not automatically included in an existing run.
- **GitHub Release creation/upload/finalization failure:** all npm packages have already succeeded. The helper searches existing releases (including drafts), resumes the same Release and uploads missing assets. Matching SHA-256 assets are left alone; incomplete/different same-name assets are replaced, not duplicated. A new Release stays draft until all uploads succeed; notes are generated when the draft is first created.
- **Fully successful rerun:** npm versions are skipped; the same complete stable Release remains. Existing legacy assets without a digest are uploaded again under the same names.
- Artifacts are retained for **7 days**. Prefer rerunning only the failed publication job so it uses the original checked tarballs. If artifacts expired, rerun all jobs to rebuild/revalidate the same tagged revision. Artifact upload uses overwrite for all-job reruns. Package/version existence enables retry skipping, but is **not** proof that a rebuilt archive is byte-identical to an earlier npm upload.
- All-job reruns may rebuild differently as tooling evolves. Do not modify release tags or use retries to replace npm contents; registry publication cannot overwrite an existing version.

npm and GitHub do not provide one atomic transaction for these releases. A failure may leave some npm packages published or a draft/partially uploaded GitHub Release. A successful validation job alone is not release success.

## Evidence boundary

Offline tests cover invalid inputs, manifests/archive checks, registry errors, partial npm failures, GitHub draft/asset recovery and workflow permissions/order. Local packing uses real npm/tar without publication. These do **not** prove that GitHub OIDC or npm ownership/trust is configured. Only a separately authorized real release can establish those external integrations.
