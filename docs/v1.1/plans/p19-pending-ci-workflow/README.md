# P19's pending CI workflow bumps

`ci.yml` and `release.yml` here are the real, finished versions of `.github/workflows/ci.yml` and
`.github/workflows/release.yml` with P19's GitHub Actions major-version bump applied
(`docs/v1.1/plans/P19-dependency-runtime-bump.md` §6 C11): `actions/checkout@v4` → `@v7`,
`actions/setup-go@v5` → `@v7`, `actions/upload-artifact@v4` → `@v7`. `oven-sh/setup-bun@v2` is
unchanged — already the current major. They just aren't live in `.github/workflows/` yet.

GitHub refuses to accept a commit touching `.github/workflows/*.yml` from this session's OAuth
credential: "refusing to allow an OAuth App to create or update workflow `ci.yml` without
`workflow` scope." A session whose GitHub credential carries the `workflow` scope can apply it —

```
git mv docs/v1.1/plans/p19-pending-ci-workflow/ci.yml .github/workflows/ci.yml
git mv docs/v1.1/plans/p19-pending-ci-workflow/release.yml .github/workflows/release.yml
rm docs/v1.1/plans/p19-pending-ci-workflow/README.md
```

then commit and push. No other change is needed; both files are otherwise final and identical to
their live counterparts except for the three `uses:` version bumps.

P19's third action-bump target, `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml`, needed no
staging of its own — it is a plain doc file outside `.github/workflows/`, so its own bump landed in
the same commit as this phase's other changes and carries no push-scope problem. Once *that* file is
applied per its own README (P16's), the `workflow` bump has already gone with it.

This is the same restriction `AGENTS.md`'s "Known open items" tracks for P16's own staged
`db-compat.yml` — same shape, new files.
