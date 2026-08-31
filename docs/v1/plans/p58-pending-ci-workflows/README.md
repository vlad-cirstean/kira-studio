# Pending CI workflow updates (P57 M7, revised P58f M11) — now two generations behind

This session's GitHub OAuth token lacks the `workflow` scope, so pushing a commit that edits
`.github/workflows/*.yml` is rejected outright ("refusing to allow an OAuth App to create or
update workflow `ci.yml` without `workflow` scope"). Confirmed again in this session — the same
rejection P57 M7 recorded is still current.

The live `.github/workflows/ci.yml`/`release.yml` are still fully **Electron-era**: `bun run
test:e2e`, `app.asar.unpacked/out/main/engine.js`, `dist/mac-arm64/`, `db-unit-tests` running `bun
run test:db`. None of that exists any more — Electron left with P57 M7, and `test:e2e`/`test:db`
are not even valid `package.json` scripts today. The `ci.yml`/`release.yml` staged here are not the
P57 content any more either: they carry that generation's Wails/Go update *and* P58f M10's own
follow-up (no `vendor-node.sh`, no `build:engine`, no `runtime/` tree in the packaged-bundle
assertions, `db-unit-tests` renamed `container-tests` since its coverage moved to
`shell/internal/adapters/*/*_test.go`) — see `docs/PACKAGING.md` §7 for the job-by-job reasoning
and `docs/v1/plans/P58f-cutover.md` D17 for why this phase revises rather than re-stages from
scratch.

Copy each file over its counterpart in `.github/workflows/` and commit from an account/token that
has `workflow` scope (reconnect GitHub with that scope under claude.ai's connector settings, or
push from a local checkout):

```sh
cp docs/v1/plans/p58-pending-ci-workflows/ci.yml .github/workflows/ci.yml
cp docs/v1/plans/p58-pending-ci-workflows/release.yml .github/workflows/release.yml
git add .github/workflows/ci.yml .github/workflows/release.yml
git rm -r docs/v1/plans/p58-pending-ci-workflows
git commit -m "ci: workflows for a build with no Node (P57 M7 + P58f M10, applied together)"
```

If a future phase needs to revise these again before this ever lands, revise the two files in
place here (this directory, not `.github/workflows/`) and update this README's own "how many
generations behind" count — do not let a third generation silently stack on top of a directory
that still says "P57" or "two generations".

**Revised by v1.1 P1** (dependency/script/folder audit): `release.yml`'s `verify:packaging` step
set `KIRA_STRICT_UPDATE_CHECK: '1'`, a variable `scripts/verify-packaging.sh` has never read since
the P57 rewrite dropped its strict-mode branch along with the electron-builder checks. Removed the
`env:` block and reworded the step name. This is a correction to the staged content, not a new
generation of it — the "two generations behind" count above is unchanged.
