# P294 plan: test and CI speed

SPEC row P294 (`docs/v2.6/SPEC.md`). Three scopes: (1) PR CI wall time, (2) slow tests, (3) this dev box.
Base: `201f559` (v2.6). Planner: Opus. Implementer: one sequential Sonnet subagent (section 9).

Discovery: `codegraph_explore` over `testsupport` (`ImageFor`, `Prewarm`, `StartPostgres`, `fixture`),
`flowharness.New` (Space), `adeflow` tests, `workbench/src/testing/ui/{fixtures,server}.ts`,
`tests/ui/support/mockRuntime.ts`; reads of `.github/workflows/{pr,release}.yml`,
`apps/kira-studio/playwright.config.ts`, `package.json`, `scripts/{setup,prepare-*}.sh`, `.githooks/*`,
`docs/DEV_ENVIRONMENT.md`, `docs/PERF.md` §5. CI evidence from GitHub Actions: PR #2 run 22 (`38854999318`,
failed on one spec) and run 14 (`37651268689`, last green), job step times and job logs (per-test lines from
the Playwright `list` reporter, per-package `ok` lines from `go test`). Raw output: scratchpad only, not committed.

## 1. Before numbers

### 1a. CI (ubuntu-latest 4 vCPU; macos-15), run 22 unless marked

| Item | Time |
|---|---|
| Run wall clock (first job start to last job end) | 15m47s (run 14: 16m28s) |
| `wails-linux-cli` job | 1m38s |
| `checks (Linux)` job (starts after `wails-linux-cli`) | 4m13s; setup 1m32s, `lint` 27s, `typecheck` 1m51s, builds 12s, `lint:dead` 4s |
| `checks (macOS)` job | 3m16s; `setup-go` 62s, bindings 43s |
| Idle wait before `ui`/`container-tests` start (`needs` all three checks) | 6m02s |
| `ui` job | 9m45s; setup 1m19s, Playwright install 26s, `test:ui:studio` 7m55s (run 14: 7m51s, then `ipc-frontend` 12s, `visual` 19s) |
| `ui` project content | 550 tests, sum 1847s test time, 4 workers, median 2.5s, min 0.79s |
| `container-tests` job | 9m15s; image tar restore 27s + `docker load` 79s (tar 2.43 GB), `setup-go` 18s, apt 35s, bun 15s, bindings 11s, builds 13s, `test:unit` 12s, `go test ./...` 5m35s (run 14: 4m12s) |
| `go test ./...` content | 131 packages with tests, sum of package times 650s; first `ok` line 70s after step start (compile) |
| `apt-get install` GTK4/WebKitGTK, per Linux job | 25s to 72s |
| `setup-go` cache | one entry keyed on `go.sum` only (868 MB), saved once, never refreshed: build cache goes stale |

### 1b. This box (4 cores, 15 GB, Docker 29 started by hand)

| Item | Time |
|---|---|
| `go build ./...` cold GOCACHE / warm | 91s / 7s |
| `go vet ./...` (warm build cache) | 20s |
| `go test -run XXX_NONE ./...` (compile test binaries only) | 118s |
| `go test -count=1 ./...` (binaries cached) | 218s; sum of package times 684s; 2 packages fail (section 6, L4) |
| same, non-container packages only (170), `-p 4` / `-p 8` | 151s / 133s |
| same, container packages only (17), `-p 4` / `-p 8` | 76s / 67s |
| Pull all 11 test images in parallel via `mirror.gcr.io` | 83s (7.5 GB unpacked) |
| `bun run test:unit` | 11s |
| `bun run lint` | 21s |
| `bun run typecheck` cold tsbuildinfo / warm | 72s / 19s |
| pre-commit hook (`lint` + `typecheck`, warm) | 41s |
| `build:test:studio` (each `test:*:studio` script repeats it) | 7s |
| Playwright `ui` project | 598s; 546 passed; sum 2340s; median 3.0s; min 0.92s |
| Playwright `ui-timing --no-deps` / `visual` | 57s / 14s |
| Playwright `ipc-frontend` | 7/7 fail: chromium headless shell 1243 missing; after `playwright install --only-shell chromium` (6s): 12s, 7 passed |

Per-project cold typecheck (s): `web:studio` 38, `space-web` 37, `git` 27, `docker` 19, `space-mobile` 18,
`proto:studio` 17, `site` 7; each tsgo project 2-3. vue-tsc projects are the cost.

## 2. Slowest, ranked

Playwright `ui` (CI run 22 seconds, local in brackets):

1. `interaction.spec.ts` "interaction completeness" 46.7 (53.5): one test, `setTimeout(240_000)`.
2. `cell-editor.spec.ts` "autodetect, beautify, override…" 25.5 (34.5).
3. `tree.spec.ts` "project tree — expansion, caching…" 25.4 (25.8).
4. `slick-grid.spec.ts` "SlickGrid spike" 23.3 (29.6); file total 162 (217) over 22 tests, the costliest file.
5. `data-view.spec.ts` 22.2 (26.8); `leaks.spec.ts` 21.8 (28.2); `slick-grid` iter2-onset 21.4 (29.0).
6. Costliest files after `slick-grid`: `console` 82, `api-ui-consistency` 80, `autocomplete` 77,
   `sql-schema` 71, `grpc-request` 67, `control-sizing` 61.

Time by test length (CI): under 2s 266s, 2-5s 842s, 5-10s 476s, 10-20s 76s, 20s+ 186s. The suite is wide,
not tall: no single test sets the floor; total CPU does. Per-test boot floor (new page, `goto`, wait for
`status-bar`): ~0.8-0.9s, about 21% of the sum. Fixed sleeps: 58 `waitForTimeout` calls, about 15s of 2340s.

Go packages (CI run 22 seconds; local `-p 4` in brackets):

1. `apps/kira-space/internal/flows/adeflow` 92 (104): 56 tests, zero `t.Parallel`, each boots a full app via
   `flowharness.New`, which calls `t.Setenv` (`HOME`, `PATH`, `KIRA_*`), so the tests cannot run in parallel.
2. `apps/kira-space/internal/ade` 49 (51).
3. `apps/kira-studio/internal/adapters/kafka` 39 (36); `ipcfixture` 37 (30); `mysqlfamily` 33 (27);
   `clickhouse` 31 (21); `dockerflow` 27 (35); `gitflow` 26 (28); `memoryflow` 27 (24); `testsupport` 24 (30).
4. Long single tests: `TestClickHouse` 15, `TestRebaseRun` 14, `TestKafkaFixtureSeed` 10, `TestCallSilentServer` 10.

## 3. Where the time goes

- CI wall is serial, not slow work: 6m02s of idle `needs` wait, then one 7m55s Playwright step and one 5m35s
  Go step, each on one 4-vCPU runner. The test steps are CPU-bound: `ui` 1847s CPU over 4 workers matches
  its 7.7 min wall; Go `-p 8` only gains 12% here, and it slows each package (adeflow 104s to 128s).
- Every Linux job repeats about 1.5 min of setup. `container-tests` adds 106s of image tar restore and load.
- Go compile is not cached usefully in CI (stale `go.sum`-keyed entry), and test results are never cached.
- `typecheck` runs cold in CI every time: 1m51s, where a warm incremental run is about a quarter of that.
- Locally the same CPU limits apply: 10 min for `ui` on 4 cores is the floor of the current suite; a fresh
  container also pays cold Go caches (91s build, 118s test compile), cold tsbuildinfo, image pulls.

## 4. Changes

Expected saving is on CI wall clock unless stated. "Risk" names what could break and the guard.

### C1. Shared setup composite action

- Files: new `.github/actions/setup/action.yml`.
- Inputs: `bun` (default true), `go-cache` (cache key name, empty = no Go build cache), `gtk` (default false),
  `bindings` (default true).
- Steps: `oven-sh/setup-bun` (same pin, 1.3.14); bun cache (same key) and `bun install --frozen-lockfile`;
  `actions/setup-go` with `cache: false`; `actions/cache` for `~/go/pkg/mod` keyed on `hashFiles('go.sum')`;
  when `go-cache` is set, `actions/cache` for `~/.cache/go-build` (and on macOS `~/Library/Caches/go-build`, via
  `go env GOCACHE` written to `$GITHUB_ENV`) keyed `gobuild-<os>-<go-cache>-<hash go.sum>-<github.sha>` with
  restore keys `gobuild-<os>-<go-cache>-<hash go.sum>-` then `gobuild-<os>-<go-cache>-`; wails3 cache and
  bindings cache (same keys as today); GTK apt install only when `gtk` is true or the wails3 cache missed
  (`setup.sh` builds wails3 with cgo then); `sh scripts/setup.sh` when `bindings` is true.
- Saving: no time by itself; removes five copies of 8 steps. Enables C3, C6, C7.
- Risk: `.github/actions/` sits outside `.github/workflows/`, so a Linux sandbox push should pass the scope
  check. Implementer confirms with the push; if refused, move the file under `docs/pending-workflows/actions/`
  beside the C2 patch.
- Measured fact backing the conditional apt: `wails3 generate bindings` with `PKG_CONFIG_LIBDIR=/nonexistent`
  (no GTK headers) and with `CGO_ENABLED=0` both produce a tree byte-identical to the GTK run (`diff -r` empty);
  only warnings differ (5 and 124 lines, all `could not import C`).

### C2. New PR workflow graph (pending patch)

- File: `docs/pending-changes/.github__workflows__pr.yml.patch` (DEV_ENVIRONMENT.md "Git push": an existing
  workflow is changed through `docs/pending-changes/<path>.patch`, a `git diff`-style patch plus a one-line why;
  `docs/pending-workflows/` is only for whole new workflow files). Build it by editing `.github/workflows/pr.yml`
  in the working tree, `git diff > patch`, then `git checkout -- .github/workflows/pr.yml`. Check with
  `git apply --check` and with actionlint (`go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7` on the
  patched copy). Never commit `.github/workflows/*` itself.
- Jobs, no `needs` edges at all (nothing consumes another job's output):

| Job | Runner | Setup (C1 inputs) | Work | Timeout |
|---|---|---|---|---|
| `checks (macOS)` | macos-15 | go-cache `macos`, gtk false | unchanged: lint:go, `go build ./...`, darwin packages | 15 |
| `checks (Linux)` | ubuntu | go-cache `checks`, gtk true | lint, typecheck (C5 cache), build:studio, build:space, lint:dead, verify:packaging, `test:unit` (moved from container-tests) | 15 |
| `ui (Linux, shard i/4)` | ubuntu, matrix shard 1..4, `fail-fast: false` | go-cache empty, gtk false | Playwright cache, `playwright install --with-deps webkit`, `build:test:studio`, `playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --shard=i/4` | 15 |
| `ui-extra (Linux)` | ubuntu | go-cache empty, gtk false | `playwright install --with-deps webkit` and `--only-shell chromium`, `build:test:studio` once, then serially `--project=ipc-frontend`, `--project=visual`, `--project=ui-timing --no-deps` | 15 |
| `go (Linux)` | ubuntu | go-cache `go-rest`, gtk true | git identity, inotify sysctl, build:studio, build:space, `bun run test:go:rest` (C4) | 15 |
| `go-containers (Linux)` | ubuntu | bun false, bindings false, go-cache `go-ct`, gtk true | start C3 pull in background first, inotify sysctl, wait for pull, `sh scripts/go-test-split.sh containers` (C4; no bun in this job) with `TESTCONTAINERS_RYUK_DISABLED=true` | 15 |

- Removed: `wails-linux-cli` (its only job was to avoid a parallel wails3 rebuild race on a go.mod change; a
  cache miss now costs each job about 1.5 min once per go.mod bump, a race on save is harmless), the image tar
  restore, `docker load`, `docker save` and tar cache steps (frees a 2.4 GB cache entry under the 10 GB limit).
- Shard count 4: `ui` is 1847s CPU on 4 workers (7.7 min). 4 shards give about 2 min each plus about 1.6 min
  setup; 3 shards give about 2.6 min. 4 keeps the ui shards under the Go jobs, so more shards buy nothing.
  Public repo: Linux minutes are free; 9 concurrent jobs fit the 20-job limit (macOS 1 of 5).
- `ui-timing` on its own runner, after `ipc-frontend` and `visual` in the same job: it gets an idle machine
  (the reason for its `dependencies: ['ui']`), without rerunning `ui`. `--no-deps` is Playwright's own flag.
  `playwright.config.ts` keeps the dependency for local `test:ui:studio` runs; no config change.
- Failure artifacts: `upload-artifact` per job, names `playwright-report-ui-<i>` and `playwright-report-extra`.
  Keep `list` + `html` reporters; merging shard reports (`blob` + `merge-reports`) is rejected (section 7).
- Saving: the 6m02s idle wait and the 1m38s `wails-linux-cli` lead go away; ui path 9m45s to about 3.8 min;
  `ipc-frontend` + `visual` (31s) and `ui-timing` leave the ui path.
- Risk: renamed jobs. Checked: the `main` ruleset requires a PR review only, no status checks, so no rule
  references job names. Risk: shards balance by test count, not duration; worst shard measured in C2 step
  verification (section 8).

### C3. Pull test images in parallel instead of a tar

- Files: new `apps/kira-studio/internal/adapters/testsupport/cmd/testimages/main.go` (prints every pinned image,
  one per line, via the existing constants through `ImageFor`, so the list has one source and honours
  `KIRA_COMPAT_IMAGE_*`); new `scripts/pull-test-images.sh` (runs that printer, adds
  `mirror.gcr.io/library/alpine:3.20`, `mirror.gcr.io/library/bash:5.2` and the testcontainers ryuk image,
  pulls each from `mirror.gcr.io` in parallel (`library/` prefix for un-namespaced names, DEV_ENVIRONMENT.md
  rule), re-tags to the plain name, prints one line per image, exits 0 even when a pull fails: testcontainers
  then pulls that image from Docker Hub itself); `package.json` script `test:images`.
- CI use: started with `nohup … &` right after C1 setup in `go-containers` (the printer needs Go), waited on
  before the test step, so the pull overlaps the apt install and the test compile.
- Saving: 106s serial (restore 27s + load 79s) to near zero on the path. `mirror.gcr.io` also avoids Docker Hub
  anonymous rate limits on shared runner IPs.
- Risk: background process across steps (GitHub keeps it alive until job end; the wait step checks its pid and
  prints its log). An image tag added to `testsupport` without a constant read by the printer is still pulled by
  testcontainers lazily, just slower.

### C4. Split Go tests across two runners

- Files: new `scripts/go-test-split.sh <containers|rest>` (lists `go list ./...`, selects by one regex:
  `/internal/adapters/|/internal/ipcfixture|/flows/dockerflow|/flows/dbflow` for containers, the rest otherwise,
  then runs `go test` on that list with any extra args passed through); `package.json` scripts `test:go:rest`
  and `test:go:containers`. `test:go` stays `go test ./...`.
- Plain `go test` (no `-count=1`): with C6, a package whose inputs did not change replays its cached pass.
- Saving: Go step 5m35s to about 2.5 min (rest: adeflow-bound, 151s here) and about 1.3 min (containers: 76s
  here). The containers job also drops bun, bindings and frontend builds: its packages link Wails' cgo
  application package but never the root `main` packages that embed `frontend/dist`.
- Risk: a new container package not matching the regex still runs, in the `rest` job (Docker exists there too);
  only balance suffers. Split is load balancing, never a coverage filter.

### C5. Cache tsbuildinfo for `typecheck`

- Files: C2 patch only (`actions/cache` on `node_modules/.cache/tsbuildinfo` in `checks (Linux)`, key
  `tsbuildinfo-<hash bun.lock>-<github.sha>`, restore key `tsbuildinfo-<hash bun.lock>-`).
- Saving: 1m51s to about 30-40s (local cold 72s vs warm 19s). Off the critical path after C2, so this shortens
  the job, not the run; worth it because it is one cache step.
- Risk: tsc and vue-tsc incremental mode key on file content hashes, not mtimes, so a fresh checkout reuses
  entries correctly. A `bun.lock` change starts cold.

### C6. Real Go build and test cache

- Files: C1 (the per-job `gobuild-*` cache), C2 (job keys).
- Saving: test compile from about 70s to about 15-25s on a warm cache; unchanged packages replay cached test
  results, so a frontend-only PR runs almost no Go tests.
- Risk: a cached pass hides a flaky test until its package changes; same as every local run today. Cache churn:
  each push saves about 1.3 GB per Go job; GitHub evicts least recently used past 10 GB, restore keys fall back
  to the newest entry. Removing the 2.4 GB image tar (C2) pays for it.

### C7. Skip apt where no cgo build runs

- Files: C1 (`gtk` input), C2 (ui shards and `ui-extra` set `gtk: false`).
- Saving: 25-72s per ui job. Playwright's `--with-deps` still installs WebKit's own runtime libraries.
- Risk: covered by the measured byte-identical bindings (C1); on a wails3 cache miss C1 installs GTK anyway.

### C8. Box fixes and docs (scope 3)

- `scripts/prepare-ui-tests.sh`: also install the chromium headless shell (`playwright install --only-shell
  chromium`, same `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0` override as the webkit install). Today `ipc-frontend`
  (and `e2e-real`) fail on a fresh box: the preinstalled `/opt/pw-browsers` chromium is build 1194, Playwright
  1.63.0 wants headless shell 1243.
- `docs/DEV_ENVIRONMENT.md`: replace the per-image manual `docker pull`/`docker tag` list in the Docker section
  with `bun run test:images`; add a short "Test speed on this box" section to "Load, disk and test scope":
  the section 1b numbers, `test:go:rest` and `test:go:containers` as the split local runs, leave `-count=1` off
  to reuse the test cache, `--project=ui` costs about 10 min on 4 cores, `playwright test --last-failed` and
  `--only-changed=<ref>` (spec and support files only: app code is a built bundle, so it never selects specs
  for an app change), and that the hooks run lint and typecheck only (41s warm, about 90s cold), never tests.
- `docs/PERF.md` §5: replace the v1.4 P1 baseline table with section 1 and the after-numbers (section 8).
- Saving: `ipc-frontend` from failing to 12s locally; one command instead of 22 manual pull/tag lines.

### C9. Two Go tests that fail on this box (CLAUDE.md: fix on the spot)

- `apps/kira-studio/internal/flows/dockerflow` `TestImageRegistryURL` fails alone, deterministically:
  `registry link of mirror.gcr.io/library/alpine:3.20 = {URL:https://hub.docker.com/_/alpine Unconfirmed:true},
  want the Hub page`. This box's Docker 29 uses the containerd image store, which `docs/ARCHITECTURE.md`
  (around line 5112) says reports implied Hub names as Unconfirmed; CI's Docker passes. Fix the test to expect
  what the product does for the store in use (discover with `codegraph_explore` on `imageRegistry`,
  `TestImageRegistryURL`), not the product.
- `internal/terminal` `TestSessionCloseLeavesUnhungJobs/dash_background` ("Close took 2.2s, want < 2s") and
  `TestSessionCloseKillsProcessGroup/bash` fail only under full-suite load; they pass alone (1.4s). Apply
  DEV_ENVIRONMENT.md's P277 load recipe; find what Close waits on. Never widen the bound or add a retry. If the
  root cause needs a design change in `internal/terminal`, add a new SPEC row for it instead of a half fix.
- Both predate P294 (`git diff --stat 201f559` touches neither file).

## 5. CI sketch after C1-C7

Critical path estimate (warm caches): `go (Linux)` about 1.5 min setup + 20s compile + 2.5 min tests = about
4.5 min; ui shard about 1.4 min setup + 2.2 min tests = about 3.8 min; `go-containers` about 3 min;
`checks (Linux)` about 3 min; `checks (macOS)` about 3 min. Cold caches (go.mod or bun.lock bump): add about
1.5 min (wails3 build, cold compile). Run wall: about 5 min warm, about 7 min cold, from 15m47s.

## 6. Local box summary (why it is slow, what changes)

- L1 CPU: 4 cores. `ui` is 2340s of WebKit work: 10 min is the floor of the current suite on this box. WebKit
  here runs 1.8x (JS) to 2.9x (DOM) slower than Chromium (DEV_ENVIRONMENT.md). Not a config problem;
  `workers: '100%'` already uses every core. Documented (C8), not changed.
- L2 Docker: daemon not running at session start, Hub blobs blocked; one command now (C3, C8).
- L3 Cold caches: Go 91s build / 118s test compile, tsbuildinfo 72s. `prepare-dev-environment.sh` does not warm
  them; adding a 3-4 min warm-up to every worktree prepare is rejected (section 7). Documented.
- L4 Two failing Go tests (C9).
- L5 `build:test:studio` per script: 7s; not worth a skip flag (section 7).
- L6 Hooks: pre-commit runs `lint` + `typecheck` (41s warm), pre-push `go build`, `lint:go`, `lint:dead`. No hook
  runs a test suite; nothing to change.
- L7 Missing chromium headless shell breaks `ipc-frontend` (C8).

## 7. Rejected options

- Raise Go `-p` above 4: measured 12% (rest) and 12% (containers) gain, but each package slows (adeflow 104s to
  128s) and load-sensitive tests (C9's terminal pair) fail more. Not worth it.
- Make `adeflow` parallel: `flowharness.New` sets process env with `t.Setenv`; parallel needs per-app env
  injection through the whole harness. After C4 the rest job floor is about 110s anyway (170 packages over 4
  slots), so the gain is under 40s. Not worth a harness redesign.
- Split Go into three or more runners: the rest job is adeflow-bound (104s); a third runner moves nothing.
- Testcontainers reuse across packages (`WithReuseByName`): packages run concurrently and mutate seeded data;
  sharing one database across binaries invites cross-package flakes.
- Merge `ipcfixture`'s six container starts into the adapter packages (v1.4 P1's deferred item): saves about
  30s of CPU in `go-containers`, which after C4 is off the critical path (76s). Not worth the churn now.
- Smaller images (Confluent `cp-kafka` 2.05 GB to `apache/kafka-native`, MySQL/Mongo slim variants): changes the
  server the conformance suites prove against, a product decision, not a speed fix. With C3 the pull is off the
  path anyway.
- Cache apt packages: `cache-apt-pkgs-action` was dropped after a corrupted entry restored 0 packages on a hit
  (PR #2 run 10, commit "ci: drop the GTK4/WebKitGTK apt-pkgs cache"). C7 removes apt from four of six Linux jobs instead.
- Run in the Playwright Docker image (`mcr.microsoft.com/playwright`): its fonts differ from ubuntu-latest, and
  the `visual` baselines are captured on ubuntu-latest only (tests/visual/README.md); pulling the image costs
  about what the install saves.
- Switch `ui` to Chromium: about 2x faster, but `ui` exists to run the engine the app embeds (WebKit).
- More Playwright workers than cores: known load-sensitive specs (ARCHITECTURE.md Known open items, P277 recipe)
  fail under oversubscription.
- Reuse one page across tests in a file to skip the 0.8s boot: tests assume a fresh app (stores, tabs, mocks per
  `relaunch`); shared state would leak between tests. Boot cost is app startup work, a product perf question
  for its own phase if wanted.
- Replace fixed `waitForTimeout` calls: about 15s of 2340s, most are deliberate quiet windows in
  `slick-grid.spec.ts` (300ms coalescing). Under 1%; not worth the risk.
- Shard report merging (`blob` reporter, `merge-reports` job): adds a job and a `needs` edge for a report only
  read on failure; per-shard artifacts are enough.
- Drop CI `retries: 1`: a retry only costs time on a failure, and a flaky spec still shows as flaky.
- Typecheck with tsgo for Vue projects: vue-tsc on tsgo is not stable; vue-tsc is the 38s cost per project.
- A fast/slow test tier split: no single test exceeds 60s and sharding plus test caching remove the wall; a
  tier would only hide tests from PRs.
- Dedupe flow tests against UI specs: the IPC-boundary split is the repo's rule (CLAUDE.md), not duplication.
- Warm Go and TS caches in `prepare-dev-environment.sh`: 3-4 min on every worktree prepare, most sessions never
  run the full Go suite.
- A skip-build flag for `test:*:studio` scripts: 7s per run.
- Reuse C3 in `release.yml`'s test-matrix: release-only, outside the PR wall this phase targets.

## 8. Verification and targets

Local (implementer, before handing back):

1. `bun run lint`, `bun run typecheck`, `shellcheck scripts/pull-test-images.sh scripts/go-test-split.sh`.
2. With `dockerd` up and images removed (`docker image rm` of the test images): time `bun run test:images`;
   target at most 90s, every image present with its plain name afterwards.
3. `bun run test:go:containers` and `bun run test:go:rest` with `-count=1` passed through: all green
   (C9 fixed), times recorded; targets about 80s and about 155s on this box. Then both without `-count=1` after
   a no-op change: target under 30s each (cached).
4. `sh scripts/prepare-ui-tests.sh` on this box installs the headless shell; `playwright test --project=ipc-frontend`
   7 passed.
5. Run `--project=ui --shard=i/4` for i 1..4 once each, alone: record each shard's time and test count; the worst
   shard must stay within 1.4x of the mean, else report the imbalance in the result.
6. C9 load check: the P277 recipe on the two terminal tests, `-count=40`, zero failures.
7. `git apply --check` of the C2 patch on a clean tree; actionlint clean on the patched `pr.yml`.

CI (after the user applies the C2 patch from a Mac session and the PR runs twice: once cold, once warm):

| Metric | Before | Target |
|---|---|---|
| Run wall clock, warm caches | 15m47s | at most 6 min |
| Run wall clock, cold caches | 15m47s | at most 8 min |
| Slowest ui shard job | 9m45s (one job) | at most 4.5 min |
| `go (Linux)` job | 9m15s (one job, with containers) | at most 5 min |
| `go-containers (Linux)` job | (in the above) | at most 4 min |
| `checks (Linux)` typecheck step, warm | 1m51s | at most 45s |

The orchestrator records the CI numbers in this file's result section once the user reports the runs; until
then the result section says the CI half is pending the patch. Also check run 22's one failure,
`mode-switch.spec.ts:339` (icon size bound, passed locally): if it still fails on the new graph, fix it in
this phase or add a SPEC row, per CLAUDE.md.

## 9. Execution

One sequential Sonnet implementer. No stream split: C1, C2, C4 and C5 all meet in the C2 patch and in
`package.json`; C3 and C4 both add `package.json` scripts and DEV_ENVIRONMENT.md text. Overlap is real, so no
zero-overlap table exists.

Commit order (Conventional Commits, normal hooks):

1. `feat(test): pinned test image printer and parallel mirror pull` (C3 code, `package.json` `test:images`).
2. `feat(test): split Go tests into container and rest runs` (C4).
3. `ci: shared setup composite action` (C1).
4. `ci: pending pr.yml patch for parallel, sharded jobs` (C2, C5, C6, C7 in the patch).
5. `fix(test): install the chromium headless shell in prepare-ui-tests` (C8 script).
6. `fix(test): …` one commit per C9 test, each naming its root cause.
7. `docs: test speed on this box, PERF §5 re-measured, P294 result` (C8 docs, section 8 local numbers here).

Each commit lands as its step completes, so an interrupted run resumes from the log.

## Result

Commits (branch v2.6): `5f23b27` image printer and pull script, `07c4117` Go split, `236c125` composite action,
`5fa38ac` + `1193efa` pending `pr.yml` patch, `e65856d` headless shell, `589e98c` dockerflow fix, `54d6136`
terminal fix, `8249b96` scoped hooks, then docs. Not pushed.

Changes against the plan, from user decisions during the run:

- `ui` first shipped in 2 shards, then moved back to 4 by user decision (follow-up patch
  `docs/pending-changes/.github__workflows__pr.yml.patch`; per-shard time about half the 2-shard figures,
  not re-measured). Measured alone with 2 shards on this box: 304s and 321s, 273 tests each (balance within 3% of
  the mean). CI estimate per shard: about 4 min tests plus 1.3 min setup.
- The image tar cache stays (`go-containers` restores it, loads it in the background beside setup). The parallel
  pull script runs only on a cache miss, then the tar is saved as before. Existing cache keys and paths are kept;
  setup-go's `go.sum`-keyed cache is replaced by `gomod-*` (module cache) plus per-job `gobuild-*` entries.
- CI runs the full suite on every PR: no path filters, no skipped jobs.
- Hooks scope to changed files (item 3 of the user decisions); see the PERF table.
- Ryuk image not pulled: `go-containers` sets `TESTCONTAINERS_RYUK_DISABLED=true`.
- `scripts/pull-test-images.sh` pulls `alpine:3.20` and `bash:5.2` under the mirror name only (C9, below).

C9 root causes (both differ from the plan's guess):

- `TestImageRegistryURL`: not the containerd store. This box also carried a plain `alpine:3.20` tag (from the
  manual pull/tag recipe), so the registry-link logic picked the implied Hub name. With the plain tag removed
  the test passes unchanged. The script no longer creates that tag. No test change.
- Terminal pair: the full suite ran under `setsid nohup`, which leaves SIGHUP ignored; the shells inherited it, so
  `Close` never hung them up (SigIgn bit 1 in the failure dump). Product bug too (app started via `nohup`). Fix in
  `internal/terminal/session.go`: when SIGHUP is ignored at start, install a handler so the exec resets it to
  default. Verified: 5 runs of both tests under `nohup`, whole package under `nohup`, `rest` suite green.
  Plain runs with 8 busy loops never failed (`-count=40`), so load was not the cause.

### Before and after, this box

| Item | Before | After |
|---|---|---|
| Pull 11 images, cold | 83s (manual) | 60s (`bun run test:images`) |
| Go containers, `-count=1` | 76s (`-p 4`, part of 218s) | 81s, all green |
| Go rest, `-count=1` | 151s | 134s, all green (terminal pair fixed) |
| Go rerun, no changes | 218s | containers 1.5s; rest 114s (`ade` 44s and `theme/i18n` are never cached) |
| `ui` | 598s one run | 304s + 321s (2 shards, run alone) |
| `ipc-frontend` | 7 of 7 fail | 7 passed, 11s |
| Pre-commit docs-only / Go-only / studio frontend | 43s warm | 0.5s / 0.1s / 56s |
| Pre-push, Go-only range | 12s | 10s with tests of the changed package |

Not met: the "under 30s cached" Go target (`ade` and `i18n` do not cache; not investigated further). Frontend
commits get no hook speedup (the lint rules take 17s and the changed projects must typecheck).
No `shellcheck` on this box: the two scripts are only `sh -n` checked. The patch passes `git apply --check`
and actionlint v1.7.7 clean.

### CI (pending: needs the patch applied from a Mac session and two PR runs)

Estimates, not measured. Run wall: 15m47s before, about 6 min warm after (slowest ui shard about 5.3 min incl.
setup). Billed Linux runner-minutes, run 22 before: `wails-linux-cli` 1.6 + `checks (Linux)` 4.2 + `ui` 9.8 +
`container-tests` 9.3 = 24.9 (plus macOS 3.3). After, estimate: `checks (Linux)` 3.2 + 2 ui shards 2 x 5.3 +
`ui-extra` 2.7 + `go` 4.3 + `go-containers` 3 = 23.8 (plus macOS 3.3). Billed time stays about equal; wall time
drops by about 60%. Per-job rounding up to whole minutes adds about 3 min to the after figure. Cold-cache runs
add about 1.5 min per job. Also recheck run 22's `mode-switch.spec.ts:339` failure on the new graph.
