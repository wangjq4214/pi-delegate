# Summary

<!-- What changed, and why? -->

## Scope

- [ ] pi-delegate
- [ ] pi-open-tui
- [ ] Workspace / tooling
- [ ] Documentation

## Related issue

<!-- Closes #123, or explain why no issue is needed. -->

## Validation

<!-- List the commands you ran and their results. Explain skipped checks. -->

```sh
bun run build
bun run typecheck
bun run check
bun run test
```

<!-- For UI changes, describe interactive verification. For delegated runtime changes, describe lifecycle/RPC checks. -->

## Checklist

- [ ] This PR contains one cohesive change, without unrelated refactoring.
- [ ] I have added or updated tests for behavior changes.
- [ ] I have run the relevant checks and documented any limitations above.
- [ ] I have updated both English and Chinese READMEs for user-facing changes where applicable.
- [ ] The packages remain independent, with no new cross-package runtime dependency.
- [ ] Changes to imported pi-open-tui behavior or its upstream revision are documented where applicable.
- [ ] Logs, screenshots, and examples contain no secrets or private conversation data.
