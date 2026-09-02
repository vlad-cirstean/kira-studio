# P19's pending CI workflow bumps, revised by P20

`ci.yml` and `release.yml` here are the real, finished versions of `.github/workflows/ci.yml` and
`.github/workflows/release.yml` with P19's GitHub Actions major-version bump applied
(`docs/v1.1/plans/P19-dependency-runtime-bump.md` §6 C11): `actions/checkout@v4` → `@v7`,
`actions/setup-go@v5` → `@v7`, `actions/upload-artifact@v4` → `@v7`. `oven-sh/setup-bun@v2` is
unchanged — already the current major.

**P20 (`docs/v1.1/plans/P20-scripts-dev-package-overhaul.md` §5 C6/D7) has since revised these
beyond P19's three `uses:` bumps.** All three inline "install the pinned wails3, then generate
bindings" blocks — CI's own copy-pasted reimplementation of `scripts/wails-dev-setup.sh`, missing
`-clean=true` and the `GOTOOLCHAIN` pin the script itself carries after P20 (F7-F9) — are replaced
with `sh scripts/setup.sh`, the merged entry point `scripts/install-deps.sh` +
`scripts/wails-dev-setup.sh` became (P20 D6). `ci.yml`'s `checks` job step name, which cited
`src/renderer/bridge/*.ts` (gone since P3's C2), is corrected in the same pass. They still aren't
live in `.github/workflows/` yet.

GitHub refuses to accept a commit touching `.github/workflows/*.yml` from this session's OAuth
credential: "refusing to allow an OAuth App to create or update workflow `ci.yml` without
`workflow` scope." A session whose GitHub credential carries the `workflow` scope can apply it —

```
git mv docs/v1.1/plans/p19-pending-ci-workflow/ci.yml .github/workflows/ci.yml
git mv docs/v1.1/plans/p19-pending-ci-workflow/release.yml .github/workflows/release.yml
rm docs/v1.1/plans/p19-pending-ci-workflow/README.md
```

then commit and push. No other change is needed; both files are otherwise final and identical to
their live counterparts except for the three `uses:` version bumps, the three binding-generation
blocks P20 routed through `scripts/setup.sh`, and `ci.yml`'s corrected step name.

P19's third action-bump target, `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml`, needed no
staging of its own — it is a plain doc file outside `.github/workflows/`, so its own bump landed in
the same commit as this phase's other changes and carries no push-scope problem. Once *that* file is
applied per its own README (P16's), the `workflow` bump has already gone with it.

This is the same restriction `AGENTS.md`'s "Known open items" tracks for P16's own staged
`db-compat.yml` — same shape, new files.
