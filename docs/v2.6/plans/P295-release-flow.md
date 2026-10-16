# P295 plan: release flow speed; publish, not draft

SPEC row P295 (`docs/v2.6/SPEC.md`). Base: `61228c84` (v2.6). Planner: Opus. Implementer: one sequential
Sonnet subagent (section 8). No split: the setup action, the scripts and the workflow patch interlock.

Discovery: `codegraph_explore` over `testsupport` (`ImageFor`, `Images`, `RunMatrix`, `RequireMatrix`) and
`internal/appupdate` (`isReleaseBuild`, `updateAvailable`); reads of `.github/workflows/{release,pr}.yml`,
`.github/actions/setup/action.yml`, `scripts/{test-matrix,db-compat,pull-test-images,setup,install}.sh`,
`package.json`, `apps/kira-studio/build/Taskfile.yml`, `docs/PACKAGING.md` §7, `docs/ARCHITECTURE.md` (app
update), `docs/DEV_ENVIRONMENT.md` (workflow push limit), P294 plan. CI evidence: GitHub Actions API, release runs
7 (`37199734528`), 9 (`37605088088`), 10 (`38741985764`), 11 (`38888876287`, tag `v0.2.6`, finished), failed runs
6 and 8, PR run `38887837248` (main, `bd0c224`), per-step times and full job logs (scratchpad only, not committed).

## 1. Before numbers

### 1a. Per job (wall, job start to end)

| Run (tag) | test-matrix | db-compat | release (macOS) | Tag to done |
|---|---|---|---|---|
| 7 (`v0.2.0`, no image tar cache yet) | 4m25s | 6m56s | 8m29s | 15m36s |
| 9 (`v0.2.2`) | 12m44s | 13m30s | 6m53s | 21m09s |
| 10 (`v0.2.3`) | 10m24s | 13m29s | 17m13s | 31m00s |
| 11 (`v0.2.6`) | 8m31s | 17m37s | 11m21s | 29m10s |

`release` `needs` both test jobs, so the path is `db-compat` then `release`, strictly serial.

### 1b. Linux test jobs, run 11

| Step | test-matrix | db-compat |
|---|---|---|
| checkout + `setup-go` | 14s | 16s |
| image tar restore | miss, every run (see 1d) | miss, every run |
| serial `docker pull` inside the script | 1m14s (8 images) | 3m02s (16 images) |
| first package compile (cold GOCACHE) | ~68s | ~67s |
| tests | ~2m | ~4m (16 runs serial; slowest kafka, mysqlfamily, sqs ~20-28s each) |
| `docker save` + cache upload | 3m32s (2.5 GB tar) | 8m36s (4.0 GB tar) |

### 1c. macOS `release` job, run 10 / run 11

| Step | Run 10 | Run 11 |
|---|---|---|
| checkout, setup-bun, setup-go, `bun install` | 1m13s | 48s |
| `scripts/setup.sh` (wails3 install on cache miss, dev bindings) | 3m00s | 2m13s |
| `brew install grep` + `lint` | 1m09s | 42s |
| `typecheck` | 2m59s | 1m38s |
| `package:studio` | 4m20s | 2m36s |
| `package:space` | 1m48s | 1m19s |
| `verify:packaging` + bundle assert | 33s | 26s |
| draft release + 2 artifact uploads | 10s | 9s |
| post-job cache saves (bun, wails3, bindings, setup-go) | 1m54s | ~1m17s |

Inside `package:studio` (run 11): `prepackage` setup 10s, production bindings ~37s, frontend build 5s,
`go build -tags production -trimpath` 81s, bundle + ad-hoc `codesign` under 1s, DMG 21s. `package:space`:
bindings ~37s, frontend 8s, `go build` 14s, `codesign` under 1s, DMG 17s. DMGs: Space 27 MB; Studio similar.

Signing and notarisation cost nothing today: ad-hoc `codesign --sign -` only, under 1s per app; Developer ID
signing and notarisation are deferred (`docs/PACKAGING.md` §6, SPEC §3), so there is no notary wait to cut.
macOS runner speed varies about 2x between runs (`package:studio` 1m56s in run 9, 4m20s in run 10).

### 1d. Findings

1. **Every cache the release saves is useless.** Caches saved from a tag ref are scoped to that tag; a later tag
   restores only its own scope and the default branch. Measured: key `docker-test-matrix-Linux-c9e3089f…` was saved
   by run 10 (`v0.2.3`) and missed by run 11 (`v0.2.6`) with the same key. So the image tar cache has never hit
   on a later tag. Each release writes ~7 GB of tag-scoped cache (4.0 + 2.5 GB tars, ~0.4 GB setup-go, bun,
   wails3) into a 10 GB repo budget, evicting main's PR caches. It costs 3.5 to 8.6 min per test job, the largest
   single item on the path.
2. **Run 11 also missed main's caches** (`bun-macOS-16e0…`, `wails3-macOS-1b6c…`) that the main PR run saved 20 min
   earlier under the same keys. Cause not provable from here (the cache-list API is blocked by this sandbox's
   proxy); eviction by the release's own multi-GB saves is the likely cause. Finding 1's fix removes it.
3. **`lint` and `typecheck` on macOS duplicate PR CI** (`checks (Linux)` runs both on every sha). 2m20s to 4m08s
   of macOS time per release, plus `brew install grep` only for that lint.
4. **The release does not check PR CI at all.** Runs 9 and 10 shipped commits whose PR CI run failed
   (`b34eec5`, `a2b96b9`: `PR pull_request failure`); `v0.2.0` (`85a8f34`) had no PR CI run. Today a human
   publishing the draft is the only guard. Publishing directly makes this gate mandatory.
5. **test-matrix and db-compat are not duplicates of PR CI.** `pr.yml` never sets `KIRA_TEST_MATRIX` or
   `KIRA_COMPAT_IMAGE_*` (complete tier, P25/P16). They are the only gate for the auth matrix and the min/max
   server versions, so they stay on the tag.
6. **Nothing PR CI builds is reusable.** PR CI builds no `.app`/DMG; its macOS Go cache is built without
   `-trimpath -tags production`, which changes every compile action ID.
7. **Billing.** `get_workflow_run_usage` for run 10: billable 0 ms on every OS (public repo, standard runners
   free). Weighted by the 10x macOS multiplier as a proxy (per-job minutes rounded up): run 10 = 25 Linux +
   18 macOS x10 = 205; run 11 = 27 + 12 x10 = 147. macOS also caps at 5 concurrent jobs.
8. **What publishing means here.** `scripts/install.sh` and `internal/appupdate` read `/releases/latest`, which
   excludes drafts and prereleases. A published release reaches every installed app's Update button within the
   6 h check cache. `install.sh` requires both assets and checks size and `digest` (`sha256:…`) per asset, and
   rejects a tag with a suffix (`v0.2.0-alpha`).

## 2. Target flow

```
tag push ─┬─ ci-gate (ubuntu)            wait for or start PR CI on this sha
          ├─ build (macos-15)             package both apps, assert, sha256, upload artifact
          ├─ test-matrix (ubuntu)
          ├─ db-compat (ubuntu, min)
          └─ db-compat (ubuntu, max)
                       └──► publish (ubuntu, needs all five)  draft → upload → verify → publish
```

No job `needs` another except `publish`. The macOS build starts at once; only the publish waits for the gates.

## 3. Changes

### R1. Setup action: restore-only mode

- File: `.github/actions/setup/action.yml`. New input `cache-save` (default `"true"`). Each of the five cache steps
  (gomod, gobuild, bun, wails3, bindings) becomes two steps: `actions/cache` with `if: … && inputs.cache-save ==
  'true'` (unchanged config) and `actions/cache/restore` (same pin `0057852b…`, same `path`/`key`/`restore-keys`)
  with `if: … && inputs.cache-save != 'true'`.
- PR CI unchanged: default `"true"` takes exactly today's steps. Verify by diff: the `true` branch is byte-equal to
  the current step plus one `&&` clause.
- Why: finding 1. A tag job restores main's entries and writes nothing.
- Push: `.github/actions/` is outside `.github/workflows/`, so a sandbox push passes the scope check (P294 C1). If
  refused, move the change to `docs/pending-changes/.github__actions__setup__action.yml.patch`.

### R2. Parallel image pull for the complete-tier scripts

- Files: `scripts/lib.sh` (new `pull_images <label> <mirror 0|1> <image>...`), `scripts/db-compat.sh`,
  `scripts/test-matrix.sh`.
- `pull_images`: for each image start `docker pull` in the background (mirror mode: pull
  `mirror.gcr.io/<path>` then `docker tag` to the plain name; path rule `*/*` keeps the name, otherwise
  `library/<name>`, same rule as `pull-test-images.sh`), write each failure to a temp file, `wait` for all, print
  one line per image, return 1 if any failed. Fatal on failure: both scripts already treat a pre-flight pull
  failure as fatal ("pull first, all of it", P16 §6.2), keep that.
- Remove the duplicated `mirror_path_for` and `pull_image` from both scripts; their `--mirror` and `--no-pull`
  flags keep working.
- Saving: db-compat pull 3m02s to about 1 to 1.5 min (P294 measured 11 images in parallel in 83s); test-matrix
  1m14s to under 1 min.

### R3. PR CI gate script

- File: new `scripts/release-ci-gate.sh <sha> <ref> [--dry-run]`. Needs `gh`, `GH_TOKEN`, `GITHUB_REPOSITORY`.
- Loop every 30s until a 40 min deadline. Read `repos/$R/actions/workflows/pr.yml/runs?head_sha=<sha>` (all events).
  Decide in this order:
  1. any run `completed` + `success`: print its URL, exit 0;
  2. any run queued, waiting, requested, pending or in progress: wait;
  3. any run `completed` with `failure`, `timed_out`, `startup_failure` or `action_required`: print URLs and
     "rerun PR CI for this commit, then rerun this release's failed jobs", exit 1;
  4. otherwise (no run, or only cancelled/skipped/neutral/stale): `--dry-run` prints "would dispatch" and exits 3;
     else `gh workflow run pr.yml --ref <ref>` once, then wait for the new run to show up.
- Deadline: exit 1 with the last state.
- Why dispatch: a tag on a commit with no PR run (`v0.2.0`), or whose run a newer push cancelled
  (`cancel-in-progress: true` in `pr.yml`), still gets the full PR suite, unchanged, on that exact sha.
  `workflow_dispatch` is one of the two events a `GITHUB_TOKEN` may trigger.
- A `pull_request` run tests the merge of the PR head into main, keyed by the head sha. Accepted: it is the same
  suite, run on a tree that contains the tagged commit.
- No unit test (CLAUDE.md bar: one ordered decision over API fields). Checked by the dry runs in section 6.

### R4. `release.yml` rewrite (pending patch)

- File: `docs/pending-changes/.github__workflows__release.yml.patch` (DEV_ENVIRONMENT.md "Git push"). Build it by
  editing `.github/workflows/release.yml` in the tree, `git diff > patch` with a one-line why on top, then
  `git checkout -- .github/workflows/release.yml`. Never commit the workflow file itself.
- Triggers: `push` tags `v*.*.*` (unchanged) plus `workflow_dispatch` with required input `version` (semver
  without `v`). A dispatch runs every job except `publish`: a full dry run on any branch with no tag, and the way
  to take after timings.
- Top-level `permissions: contents: read`; each job widens only what it needs.

| Job | Runner | Needs | Permissions | Timeout | Steps |
|---|---|---|---|---|---|
| `ci-gate` | ubuntu | none | `actions: write`, `contents: read` | 45 | sparse checkout `scripts/`; `sh scripts/release-ci-gate.sh "$GITHUB_SHA" "$GITHUB_REF_NAME"` |
| `build (macOS)` | macos-15 | none | `contents: read` | 30 | checkout; set version (R5); setup action `cache-save: "false"`, `go-cache: ""`; `package:studio`; `package:space`; name DMGs; `verify:packaging`; bundle assert (unchanged); sha256 of both DMGs to job outputs `studio-sha256`, `space-sha256`; one `upload-artifact` `release-dmgs` (both files, `if-no-files-found: error`, 14 days) |
| `test-matrix (Linux)` | ubuntu | none | default | 30 | checkout; setup action `bun: "false"`, `bindings: "false"`, `go-cache: go-ct`, `cache-save: "false"`; `sh scripts/test-matrix.sh --mirror` |
| `db-compat (Linux, min\|max)` | ubuntu, matrix `extreme: [min, max]`, `fail-fast: false` | none | default | 30 | as test-matrix; `sh scripts/db-compat.sh --${{ matrix.extreme }} --mirror` |
| `publish` | ubuntu | all four (matrix counts as one) | `contents: write` | 10 | `if: github.event_name == 'push'`; R6 |

- Removed: `lint`, `typecheck`, `brew install grep` (finding 3; the gate proves `checks (Linux)` passed on this
  sha); the separate `scripts/setup.sh` step (`prepackage:*` already runs it; the setup action restores wails3 and
  the Studio bindings from main); the image tar restore/load/save/cache steps (finding 1); every cache save.
- `go-cache: go-ct` restores main's `go-containers` build cache, which holds the same adapter packages compiled with
  the same flags; `-count=1` in both scripts disables only the test result cache, not the build cache.
- No GTK: the adapter packages need no cgo GUI headers (today's test jobs run with `setup-go` alone).
- Header comments: rewrite the job comments to state the new graph and why test-matrix/db-compat stay (finding 5).

### R5. Version step

- `TAG="${INPUT_VERSION:-${GITHUB_REF_NAME#v}}"` (`INPUT_VERSION` from `inputs.version` via `env`). Reject anything
  not matching `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`, then the same perl write and assert as today.

### R6. Publish job

Env: `GH_TOKEN`, `GH_REPO: ${{ github.repository }}`, `TAG: ${{ github.ref_name }}`. No checkout.

1. Download `release-dmgs`. Check each file's sha256 against `needs.build.outputs.*`.
2. Refuse if a published release for `$TAG` exists (`gh api repos/$GH_REPO/releases/tags/$TAG` returns a non-draft):
   exit 1, never overwrite. Delete any draft whose `tag_name` is `$TAG` (a leftover of an earlier attempt; log ids).
3. Compose notes: today's heredoc, unchanged.
4. `gh release create "$TAG" --draft --verify-tag --title "Kira Studio and Kira Space $TAG" --notes-file
   release-notes.md` plus `--prerelease` when `$TAG` contains `-` (the installer rejects such tags, and
   `/releases/latest` then skips them), plus both DMGs. Record the draft id (list releases, `draft` and
   `tag_name == $TAG`) to `$GITHUB_ENV`.
5. Verify through `repos/$GH_REPO/releases/$ID/assets`: exactly the two names, `state == uploaded`, `size` equals
   the local file, `digest == sha256:<local>`. Poll `digest` up to 60s if null; fail if it never appears
   (`install.sh` relies on it).
6. Publish: `gh api -X PATCH repos/$GH_REPO/releases/$ID -F draft=false` (plus `-f make_latest=true` unless
   prerelease). Confirm `releases/tags/$TAG` reads `draft: false`.
7. `if: failure()` step: delete the draft `$ID` if it is still a draft. A failure before step 6 leaves nothing
   visible; step 6 is one API call, so a release is never visible with a missing or unverified asset.

## 4. Failure safety and bad tags

- A failed gate (`ci-gate`, `build`, `test-matrix`, either `db-compat`): `publish` is skipped. No release, no
  draft. Installed apps see nothing.
- Flaky failure: "Re-run failed jobs" in the Actions UI. Artifacts from the first attempt stay available, so a
  green rerun publishes.
- Real failure on a tag: delete the tag (`git push --delete origin vX.Y.Z`), fix, tag again (same or next patch).
- PR CI red on the sha: rerun or fix PR CI first, then rerun the release's failed jobs.
- Bad release found after publish: tag a fixed next patch (the updater only offers strictly newer,
  `updateAvailable`). Optionally delete the bad release so `/releases/latest` falls back; users already on it are
  not downgraded.
- Decision, draft-then-publish inside one final job (not "create published in one call", not "draft early in the
  build job"): the explicit draft gives a verify point before anything is visible; a draft made early in the build
  would leave stale drafts on every gate failure and saves nothing.

## 5. Expected after (estimates; measured only on a real run, section 7)

| Item | Before (runs 10/11) | After |
|---|---|---|
| macOS build job | 17m13s / 11m21s | ~5 to 7 min (setup ~1, packaging ~4, checks ~0.5) |
| test-matrix | 10m24s / 8m31s | ~4 min |
| db-compat | 13m29s / 17m37s | ~3 to 3.5 min per half |
| publish | inside macOS job | ~0.5 min |
| Tag to published, PR CI already green | 31m00s / 29m10s | ~6 to 8 min |
| Tag pushed at merge (run 11 case) | 29m10s | max(PR CI remainder ~10 min, build) + 0.5 |
| Weighted minutes (macOS x10) | 205 / 147 | ~15 Linux + 6 to 7 macOS x10 ≈ 75 to 85 |
| Billable minutes | 0 (public repo) | 0 |
| Tag-scoped cache written per release | ~7 GB | 0 |

Trade-off accepted: the macOS build no longer waits for tests, so a failing gate wastes one macOS build
(~6 weighted min x10). Of the last six tag runs, one failed in a test gate (run 8) and one in packaging (run 6).

## 6. Verification (implementer, this sandbox)

- `git apply --check` the patch on a clean tree; actionlint on the patched copy
  (`go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`, as P294).
- actionlint can't see inside the composite action: check `action.yml` by diff (R1) and YAML parse.
- `sh -n` and `shellcheck` (when available) on the three scripts.
- Gate dry runs, read-only API calls, record output in the result: `bd0c224` expect exit 0 (green main push
  run); `a2b96b9` expect exit 1 (failed `pull_request` run); `85a8f34` expect exit 3 (no run, would dispatch).
- With Docker up (DEV_ENVIRONMENT.md "Docker"): `sh scripts/db-compat.sh --only redis --min --mirror` and
  `sh scripts/test-matrix.sh --only redis --mirror` pass; time the pull lines.
- Pre-commit hook passes on every commit, no `--no-verify`.

## 7. Not verifiable until a real run (state in the result)

- Every timing in section 5; main-scope cache hits on a tag; the `digest` field timing; `--prerelease` and
  `make_latest`; the dispatch path of R3 (no tag is pushed and no workflow is dispatched from this session; a tag
  push is outward-facing).
- How: once the user applies the patch, run "Release" by `workflow_dispatch` on `main` with `version: 0.0.0-test`
  (publish skipped) to take after timings; the first real tag then proves `publish`.

## 8. Implementer steps and commits

1. `refactor(scripts): pull complete-tier images in parallel` (R2).
2. `feat(scripts): release gate on the commit's PR CI result` (R3) with the dry-run outputs in the commit body.
3. `ci: restore-only cache mode in the setup action` (R1).
4. `ci: pending release.yml patch for parallel build and direct publish` (R4 to R6).
5. `docs: publish-direct release flow`: `docs/PACKAGING.md` §7 "Cutting a release" (new graph, publish is
   automatic, human §4 hardware checks move after publish, bad-tag handling from section 4, the dispatch dry
   run); `docs/ARCHITECTURE.md` app-update bullet ("`release.yml` creates every release as a draft…" becomes
   "publishes only after every gate and asset check"); SPEC P295 status `Done (pending the release.yml patch)`;
   a "Result" section here with before numbers (section 1), the dry-run outputs and "after: pending first run".

## 9. Rejected options

- **Drop test-matrix and db-compat on tags, rely on PR CI**: PR CI never runs them (finding 5).
- **Move them into PR CI**: the user keeps PR CI unchanged; P25/P16 keep them in the complete tier.
- **Keep `lint`/`typecheck` on macOS**: duplicate of `checks (Linux)` on the same sha once the gate exists.
- **Reuse PR-built artifacts**: none exist (finding 6); building DMGs in PR CI would add macOS minutes to every PR.
- **Restore main's macOS Go build cache for packaging**: `-trimpath -tags production` change every action ID, so
  ~1.3 GB restored for zero hits.
- **Warm a release build cache from a main push**: adds ~3 macOS min to every main push to save ~1 min per release.
- **Any cache save from a tag run, incl. the image tar**: tag-scoped, never restored (finding 1).
- **Package both apps in parallel**: same runner shares `node_modules` and Task fingerprints (race); two macOS
  runners double setup at x10 weight to save ~1.3 min.
- **Larger macOS runner** (`macos-15-xlarge`): paid even on a public repo.
- **`-run AuthMatrix` filter in test-matrix**: off the critical path after R4, and the filter must track every
  `RequireMatrix`-gated test name by hand; a missed name drops coverage silently.
- **Split db-compat per kind** (8 jobs): min/max halves already sit under the macOS path; more jobs add setup.
- **Fail when the sha has no PR CI run** instead of dispatching: `v0.2.0` had none; dispatch runs the same suite.
- **Chain the release by `workflow_run` on PR CI**: loses the tag context and needs a second trigger path.
- **Draft early in the build job, publish at the end**: leaves drafts on every gate failure.
- **One `gh release create` without `--draft`**: no point to verify digests before the release is visible.
- **Developer ID signing / notarisation work**: none runs today (ad-hoc only, deferred by SPEC §3); nothing to cut.
