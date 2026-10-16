# P1 — Test-suite speed: measure, cut, merge

> **What this phase is.** `docs/v1.4/SPEC.md`'s P1 row, turned into concrete steps from two research
> passes (broad landscape, then a deep dive with real measurements — both under `docs/v1.4/plans/`'s
> discipline, not repeated here). **Session override, this chapter only**: per explicit user
> instruction, this plan and its implementation are both done by the orchestrating session directly,
> not handed to a Sonnet implementer subagent — `CLAUDE.md`'s own "Opus plans, Sonnet implements"
> line stays written as-is; only this chapter's practice departs from it.

## 0. Baseline and the one fact that reshapes the phase

Authored against `claude/feature-v1.4` at `f7bd8fd`. No Docker in this environment — every
container-backed number below is either measured on a real CI runner later (step 1) or left an open
question (§8), never guessed.

**`go test -count=1 ./...` (warm cache, no Docker): 50.4s wall clock, of which `internal/gitsock` is
35.6s and `internal/gitsession` is 17.4s.** Go already runs packages concurrently — wall clock is
already ≈ the slowest package. Adding `t.Parallel()` to a fast package buys nothing; it finishes
before `gitsock` does regardless. So "add `t.Parallel()` everywhere" is the wrong shape for this
phase. The real levers, in order of measured impact: `gitsock`/`gitsession`'s parallelism blocker
(§2), the container tier's duplicated starts (§3), and the CI-level serialization/redundancy (§4-6).
The Bun/TypeScript unit tier is **not** a speed problem — 727 tests across 127 files run in 1.1s —
so no phase effort goes there beyond the two duplication cuts named in §7.

## 1. Baseline on real CI runners, recorded in `docs/PERF.md`

`docs/PERF.md` has never tracked suite duration. First commit of this phase: run `test:go` on both
`checks` (macOS, no Docker) and `container-tests` (ubuntu, Docker) as they exist today, and
`test:ui` split by project (`ui`, `ui-timing`), and record real wall-clock numbers in a new
`docs/PERF.md` section — this is the only place the container tier's true cost becomes visible.
Every later step in this phase re-measures against this baseline, not against the container-free
number in §0.

## 2. Go tier: remove `gitsock`/`gitsession`'s parallelism blocker, then parallelize

Root cause: Go's `testing` panics if `t.Setenv` runs in a test that called `t.Parallel()` (or whose
parent did). `internal/storage/db.go`'s `Open()` takes no argument and resolves its path through
`internal/config`'s `KiraHome()`, which reads `os.Getenv("KIRA_HOME")` — so every test that needs an
isolated home directory reaches for `t.Setenv("KIRA_HOME", …)`, which then blocks `t.Parallel()` for
that test and its package.

1. Add `storage.OpenAt(dir string) (*DB, error)` beside the existing `Open()` (which keeps calling
   `OpenAt(config.KiraHome())` — no behavior change for production callers). Thread an explicit dir
   through `internal/config`'s layout helpers the same way, wherever a test currently sets
   `KIRA_HOME` only to make `config.EnsureLayout`/`DbPath`/`LogsDir` see it.
2. `apps/kira-studio/internal/gitsock/integration_test.go`'s `newIntegrationServerWithRunner` (82
   call sites) stops calling `t.Setenv("KIRA_HOME", kiraHome)` and calls `storage.OpenAt(kiraHome)`
   directly. Same fix, same reason, for every other file `t.Setenv`-blocked on `KIRA_HOME` and/or
   `KIRA_INSECURE_SECRETS`: `internal/ipcfixture/harness.go` (a non-test file — blocks the whole
   package, see §3), `internal/tree/service_test.go`, `internal/connections/service_test.go`,
   `internal/bridge/{http_test.go,collections_import_atomicity_test.go,grpc_test.go}`,
   `internal/storage/repos/{helpers_test.go,variables_test.go}`, `internal/storage/dsn_test.go`,
   `internal/oplog/wire_test.go`, `internal/shell/window_test.go`, `internal/apivars/resolve_test.go`.
   Leave `internal/adapters/testsupport/images_test.go` alone — it tests `KIRA_COMPAT_IMAGE_*`'s env
   override itself, so `t.Setenv` there is the subject under test, not incidental setup.
3. Mark `t.Parallel()`:
   - `internal/gitsession` (173 funcs / 19 files, 17.4s, no package-level mutable state, every
     fixture already `t.TempDir()`-scoped) — **except** `concurrency_test.go`, whose own header
     states its `TestConcurrent*` tests are timing/ordering-sensitive by design. Leave that file
     serial.
   - `internal/gitsock` (134 tests, 35.6s) — **except** `matrix_test.go`, `recovery_test.go`, and
     `perf_test.go`: these count live `git` processes under `/proc` and assert zero goroutine
     growth/orphans process-wide, which a parallel sibling test would corrupt. Genuinely unsafe, not
     just untidy — stays serial even after step 2's fix removes the `t.Setenv` blocker.
   - `internal/gitclient/porcelain` (95 of 96 funcs — leave `TestFixtures_Regenerate` serial, it
     writes `testdata/` under `KIRA_GIT_FIXTURES=write`), `internal/gitpreflight`,
     `internal/gitops`, `internal/gitsearch`, `internal/preconnect`. Cheap wins (near-zero wall-clock
     change today, since none is on the critical path), but they matter under `-race` and are true
     regardless.
4. Explicitly **not** in this step, left as open follow-ups (§8): the handful of tests overriding a
   package-level var via `t.Cleanup` restore (`gitclient/runner_test.go`, `ghclient/runner_test.go`,
   `gitprepare/runner_internal_test.go`, `gitvsix/exec_test.go`, `bridge/grpc_test.go`'s
   `serverStreamFn`, and `storage/repos`'s three byte-budget globals) — each needs its own small
   refactor (thread the value through a struct field) and none is on the critical path. In-package
   parallelism for `internal/adapters/*`'s container-backed tests is **unverified** without Docker —
   do not enable it in this phase; leave those packages exactly as they run today.

## 3. Merge `internal/ipcfixture` into the matching adapter test binaries

`internal/ipcfixture` starts its own second copy of mariadb, mysql, clickhouse, redis, sqs, and
kafka — six containers, all already started by `internal/adapters/*`'s own suites in the same
`go test ./...` run. Different Go packages mean different test binaries, so
`testsupport/fixture.go`'s memoization can't span them; the fix is merging the *binaries*, not
reaching for testcontainers' `Reuse` (rejected — package binaries start concurrently and would race
to create the same named container, `Reuse` needs Ryuk disabled which currently guarantees cleanup,
and a `StopMariadb` in one binary's `TestMain` would tear down a container a sibling binary is
mid-test on).

1. Promote `internal/ipcfixture`'s shared test-only helpers to real, exported, non-`_test.go` files
   so an external test package can call them: `fixture_assert_test.go`'s assert/write helpers →
   `assert.go`; `mariadb_test.go`'s `fieldsOf`/`nodeNamed`/`strp`/`intp` → alongside them or a small
   `helpers.go`.
2. Replace `fixture_assert_test.go`'s `repoRootForWrite` (a fixed `../../../..` walk) with a
   `runtime.Caller`-anchored root helper, matching `testsupport/postgres.go`'s existing `repoRoot()`
   pattern — the walk depth differs once these files move into `internal/adapters/<x>`.
3. Move each `ipcfixture/<adapter>_test.go` into the matching adapter package's **external test
   package**: `clickhouse_test.go` → `package clickhouse_test` beside `internal/adapters/clickhouse`,
   `redis_test.go` → `package redis_test`, `sqs_test.go` → `package sqs_test`, `kafka_test.go` →
   `package kafka_test` (keeps its own `kafkasasl` prewarm — no clean split available there),
   `mariadb_test.go` **and** `mysql_test.go` → both into `package mysqlfamily_test` (that adapter
   package already prewarms both). No import cycle: verified none of `bridge`, `appcore`,
   `adapterhost`, `tree`, `connections` imports the concrete adapter packages — only `main.go`'s
   blank imports do — so the external test package can import whatever `ipcfixture` needs freely.
4. Move `ipcfixture/testdata/*.fixture.json` alongside each destination, resolved through the same
   root helper from step 2.
5. Delete `internal/ipcfixture` once empty. `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/...`
   (CLAUDE.md's documented regen command) now runs each generator inside its adapter's own suite —
   update that CLAUDE.md line to the new invocation once this lands.

## 4. CI: cut the `ui-timing` → `ui` dependency edge

`apps/kira-studio/playwright.config.ts`'s `ui-timing` project (4 tests: `budgets.spec.ts`,
`perf.spec.ts`, and 2 of `slick-grid.spec.ts`'s 17, selected by title via `grep`) declares
`dependencies: ['ui']`, so it waits for all 244 other tests before its own 4 start — for a "quiet
machine" requirement (`workers: 1`, `fullyParallel: false`) that has nothing to do with `ui`
finishing. Drop the `dependencies` edge; run `ui-timing` as its own step/job instead, sequenced
however CI scheduling makes it cheapest (before or after `ui`, not gated on it).

## 5. CI: cache `wails3` + generated bindings; scope macOS `test:go`

`scripts/setup.sh` runs in three jobs (`checks`, `ui`, `package-smoke` via `prepackage`) and its
cache gate (a stamp file under the gitignored `.task/`, checked against an untracked `bindings/`
dir) misses on every fresh checkout, so all three jobs pay both halves — installing the `wails3` CLI
(likely the dominant cost; nothing on a fresh runner's `PATH`) and regenerating bindings — even
though the output is a pure function of `go.mod` plus the generator's Go sources, identical across
jobs for one commit.

1. Cache `$(go env GOPATH)/bin/wails3`, keyed on `hashFiles('go.mod')` **and** runner OS (`checks`/
   `package-smoke` are macOS, `ui` is ubuntu — the binary isn't portable, the generated TypeScript
   output is). `setup.sh` already validates a cached binary against `wails3 version`/toolchain
   before trusting it — keep that check, don't bypass it for a cache hit.
2. Cache `apps/kira-studio/frontend/bindings/` + `apps/kira-studio/.task/`, keyed on `go.mod` plus
   whatever Go sources the generator reads — one key can serve both OSes, the output itself is
   platform-independent.
3. Scope `checks`' (macOS) `go test` invocation to the packages with real darwin-only test coverage
   — `internal/secrets`, `internal/metrics`, `internal/localauth`, `internal/gitclient`,
   `internal/datagrip` — instead of the full `./...`, which `container-tests` (ubuntu, with Docker)
   already runs in full. Keep `go build ./...` (or `go vet ./...`) on macOS unscoped, cheaply, so a
   darwin-only compile break still fails `checks`. Confirm `internal/localauth` actually has test
   functions before including it (§8 — unverified by the research pass).

## 6. CI: add `test:ipc:fe` to a job

`bun run test:ipc:fe` (6 specs / 7 tests, headless Chromium, static server, no Docker) runs in no CI
job today — it's the consumer half of the fixtures §3's adapters now generate, so its absence from
CI is a real gap in the anti-drift contract those fixtures exist for. Add it to an existing job
(cheapest fit: alongside `ui`, since both are Playwright/Chromium-family and already pay that setup
cost) rather than a new job.

## 7. `tests/ui/` pruning — narrow, evidence-based cuts only

Two concrete, verified cases, not a general sweep (the TypeScript unit tier stays untouched — see
§0/§8):

1. **`tests/ui/console-explain.spec.ts`'s threshold-comparison tests (`:248`, `:280`) duplicate
   `tests/unit/explain-plan.spec.ts`'s exhaustive bun coverage of the same predicate across 5
   engines.** Fold `:280` into `:248`, and reduce `:248` to one "flagged vs. not-flagged renders
   differently" assertion — the threshold logic itself stays proven at the bun tier, the UI tier's
   remaining job is only proving the plan reaches the DOM (`:207` already does that).
2. **Boot-consolidation for the theme/geometry cluster**: `control-sizing.spec.ts` (4 tests/4 boots),
   `font-roles.spec.ts` (2/2), `workbench.spec.ts` (2/2), `row-coloring.spec.ts` (3/3),
   `tooltips.spec.ts` (3/3) — 14 tests, 14 full-app boots, all asserting computed styles/geometry on
   essentially the same default rendered workbench. Consolidate into fewer `relaunch()` calls per
   file where the assertions genuinely share one boot's state; don't merge across files unless their
   mock sets are identical.

Explicitly **not** cut, confirmed deliberately disjoint by reading both sides: `tests/unit/
console-format.spec.ts` (Mongo-branch-only, per its own header) vs. `tests/ui/console-format.spec.ts`
(Postgres/Mongo/Redis through the editor); `tests/unit/autocomplete-tokenizers.spec.ts` (pure
tokenizer functions) vs. `tests/ui/autocomplete.spec.ts` (popup rendering/navigation/lint). The
`api-ui-consistency.spec.ts` pairs with `http-pipes.spec.ts`/`http-variables.spec.ts` are deliberately
paired (styling half vs. wire half) — co-locate if it's cheap, don't delete either side.

## 8. Explicitly out of scope / open questions for a later pass

- Whether any `internal/adapters/*` package is safe for in-package `t.Parallel()` against its shared
  container — unverifiable without Docker in this environment; leave serial.
- Whether `internal/localauth` has any `Test*` functions at all (didn't turn up in the census) —
  confirm before touching its inclusion in §5 step 3's scoped list.
- The package-level-var `t.Cleanup`-restore tests named in §2 step 4 — each needs its own struct-field
  refactor; not blocking, not done here.
- `api-ui-consistency.spec.ts`'s 32-test scope creep past its own stated charter (a real maintenance
  issue, not a speed one) — worth a follow-up phase, not this one.

## 9. Verification

Fast checks (`go build`, `go vet`, `bun run typecheck`, `bun run lint`) per commit, as CLAUDE.md's
default. The expensive check for this phase specifically **is** the phase's own subject — run
`go test ./...` (both with and without `-race` on the touched packages) and `bun run test:ui` once
near the end, confirm the new `t.Parallel()` runs are race-clean, and record the before/after
wall-clock numbers against §1's baseline in `docs/PERF.md`.
