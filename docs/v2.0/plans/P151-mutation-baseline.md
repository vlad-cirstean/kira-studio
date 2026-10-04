# P151 mutation baseline (sample)

Report-only snapshot for trend, not a target. Nothing here is fixed in P151. Generated body below
is `tools/mutation/out/<run>/summary.md` verbatim; full reports stay in the gitignored run dir.

- Commit `bb58aa81` (HEAD at run start; tooling-only changes since). Date 2026-10-04.
- Machine: 4 cores, 15 GB RAM, Linux, go1.27.1, bun 1.3.14, node 22.22. 2 workers, `nice -n 19`, two
  other streams building concurrently (timings are noisy upper-ish bounds).
- Tools: gremlins v0.6.0, StrykerJS 10.0.0, `@hughescr/stryker-bun-runner` 1.4.0.
- Wall time, 2 workers: TS 31 min (git-ipc 14m, git-core 12m, api-core 4m, kira-space-vscode 25s),
  Go 12 min (25 packages). Total about 43 min, resumed in six segments of one run dir.

## Sample used

User-approved sample; the full baseline is a later on-demand run in resumable chunks.

- TS areas run: `git-ipc`, `git-core`, `api-core`, `kira-space-vscode` (8,892 mutants).
- TS areas not run: `kira-studio` (19,170 mutants), `kira-space` (9,676), `git-ui` (6,390), `cross`
  (5,619). Each passes its dry run (initial test run green) at this commit.
- Go packages run (25, 2,031 mutants): `internal/{jsonx,kirapaths,kiratime,metrics,pathsafe,procgroup,
  rpcstream,shell,terminal,tokenauth}`, `apps/kira-studio/internal/{adapters/kafka,adapters/postgres,
  connections,mask,maskrules,mcpauth,postman,queryplan,tree}`, `apps/kira-space/internal/{gitclient/
  logsession,gitops,gitpath,gitreview,gitsearch,gitstore}`.
- Go packages not run: the rest of the 73 with tests, minus the plan's exclusions, including the heavy tail (`gitsession`, `ade`,
  `gitrpc`, `apps/kira-studio/internal` root).
- Full-run estimate from these rates: Go roughly 6,000 runnable mutants, TS rest roughly 40,000
  instrumented. Plan on several hours each at 2 workers.

## Headline

- Go: 1,296 killed, 0 survived, 735 not covered. Score 63.8%, covered score 100.0%.
- TS: 3,515 killed, 217 timeout, 983 survived, 3,525 not covered, 652 ignored. Score 45.3%, covered
  score 79.2%.
- Go "0 survived" is not a harness blind spot: a synthetic weak test in a scratch snapshot reports
  `LIVED`. It disagrees with the plan's early `mask` probe (17 lived); not investigated, tree and
  load differed. Treat Go survivor counts as unproven until a larger Go sample confirms.
- Go score is dominated by packages with no tests (`jsonx`, `pathsafe`, `kirapaths`, ...) and
  container-gated adapters. TS survivors concentrate in `git-core` (`commitStore`, `edges`,
  `matcher`) and `api-core`.

## Caveats

- Go red, skipped: `internal/terminal` (`TestSessionCloseKillsProcessGroup` fails in plain `go test`
  here; not fixed, out of P151 scope). Base `8dd60e10` red layering test is fixed: `go test
  ./apps/kira-space/internal` passes on this tree.
- Go: container-gated adapter suites `t.Skip` without Docker, so `adapters/kafka` and
  `adapters/postgres` read as not covered (435 mutants). Darwin-only files not mutated
  (`internal/metrics`: 4 files). Default gremlins mutator set only (no logical/loop-control
  inversions). Timing-sensitive suites can count false kills.
- TS: specs `tabs-save-retries-after-failure` and `tabs-save-serialized` excluded from
  `kira-studio` and `cross` (`setTimeout(0)` race under instrumentation); neither area ran here. No
  type checker, so some survivors are type-invalid code. `.vue` not mutated. Static mutants
  ignored. `packages/theme` and `packages/kira-ui` have no unit suite.
- `kira-space-vscode` scores 7.7%: most code needs the VS Code API and no unit test reaches it.
- Per-test timeouts count as killed (git-ipc: 142 of 1,014, each costs 10s).

## Totals

| lang | mutants | killed | survived | timeout | no cov. | invalid | ignored | score | covered score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| go | 2031 | 1296 | 0 | 0 | 735 | 0 | 0 | 63.8% | 100.0% |
| ts | 8892 | 3515 | 983 | 217 | 3525 | 0 | 652 | 45.3% | 79.2% |

score = (killed + timeout) / (killed + timeout + survived + no coverage). covered score drops no coverage.

## TS areas

| unit | mutants | killed | survived | timeout | no cov. | invalid | ignored | score | covered score | time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `api-core` | 2595 | 1458 | 257 | 20 | 600 | 0 | 260 | 63.3% | 85.2% | 4m11s |
| `git-core` | 2675 | 1424 | 475 | 55 | 650 | 0 | 71 | 56.8% | 75.7% | 12m01s |
| `git-ipc` | 1014 | 449 | 157 | 142 | 154 | 0 | 112 | 65.5% | 79.0% | 14m04s |
| `kira-space-vscode` | 2608 | 184 | 94 | 0 | 2121 | 0 | 209 | 7.7% | 66.2% | 0m25s |

## Go packages

| unit | mutants | killed | survived | timeout | no cov. | invalid | ignored | score | covered score | time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `apps/kira-space/internal/gitclient/logsession` | 62 | 46 | 0 | 0 | 16 | 0 | 0 | 74.2% | 100.0% | 0m26s |
| `apps/kira-space/internal/gitops` | 83 | 57 | 0 | 0 | 26 | 0 | 0 | 68.7% | 100.0% | 0m21s |
| `apps/kira-space/internal/gitpath` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | 0m01s |
| `apps/kira-space/internal/gitreview` | 217 | 178 | 0 | 0 | 39 | 0 | 0 | 82.0% | 100.0% | 1m29s |
| `apps/kira-space/internal/gitsearch` | 231 | 184 | 0 | 0 | 47 | 0 | 0 | 79.7% | 100.0% | 0m57s |
| `apps/kira-space/internal/gitstore` | 83 | 80 | 0 | 0 | 3 | 0 | 0 | 96.4% | 100.0% | 0m24s |
| `apps/kira-studio/internal/adapters/kafka` | 178 | 7 | 0 | 0 | 171 | 0 | 0 | 3.9% | 100.0% | 0m23s |
| `apps/kira-studio/internal/adapters/postgres` | 283 | 19 | 0 | 0 | 264 | 0 | 0 | 6.7% | 100.0% | 0m43s |
| `apps/kira-studio/internal/connections` | 164 | 149 | 0 | 0 | 15 | 0 | 0 | 90.9% | 100.0% | 1m46s |
| `apps/kira-studio/internal/mask` | 106 | 105 | 0 | 0 | 1 | 0 | 0 | 99.1% | 100.0% | 0m26s |
| `apps/kira-studio/internal/maskrules` | 13 | 0 | 0 | 0 | 13 | 0 | 0 | 0.0% | n/a | 0m04s |
| `apps/kira-studio/internal/mcpauth` | 20 | 15 | 0 | 0 | 5 | 0 | 0 | 75.0% | 100.0% | 0m09s |
| `apps/kira-studio/internal/postman` | 189 | 184 | 0 | 0 | 5 | 0 | 0 | 97.4% | 100.0% | 2m33s |
| `apps/kira-studio/internal/queryplan` | 180 | 159 | 0 | 0 | 21 | 0 | 0 | 88.3% | 100.0% | 0m48s |
| `apps/kira-studio/internal/tree` | 32 | 24 | 0 | 0 | 8 | 0 | 0 | 75.0% | 100.0% | 0m23s |
| `internal/jsonx` | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0.0% | n/a | 0m02s |
| `internal/kirapaths` | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 0.0% | n/a | 0m02s |
| `internal/kiratime` | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0.0% | n/a | 0m02s |
| `internal/metrics` | 46 | 30 | 0 | 0 | 16 | 0 | 0 | 65.2% | 100.0% | 0m14s |
| `internal/pathsafe` | 11 | 0 | 0 | 0 | 11 | 0 | 0 | 0.0% | n/a | 0m02s |
| `internal/procgroup` | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0.0% | n/a | 0m02s |
| `internal/rpcstream` | 38 | 38 | 0 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 0m12s |
| `internal/shell` | 76 | 21 | 0 | 0 | 55 | 0 | 0 | 27.6% | 100.0% | 0m32s |
| `internal/tokenauth` | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0.0% | n/a | 0m02s |

## Worst 15 units by score (>= 20 mutants)

| unit | mutants | killed | survived | timeout | no cov. | invalid | ignored | score | covered score | time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `apps/kira-studio/internal/adapters/kafka` | 178 | 7 | 0 | 0 | 171 | 0 | 0 | 3.9% | 100.0% | 0m23s |
| `apps/kira-studio/internal/adapters/postgres` | 283 | 19 | 0 | 0 | 264 | 0 | 0 | 6.7% | 100.0% | 0m43s |
| `kira-space-vscode` | 2608 | 184 | 94 | 0 | 2121 | 0 | 209 | 7.7% | 66.2% | 0m25s |
| `internal/shell` | 76 | 21 | 0 | 0 | 55 | 0 | 0 | 27.6% | 100.0% | 0m32s |
| `git-core` | 2675 | 1424 | 475 | 55 | 650 | 0 | 71 | 56.8% | 75.7% | 12m01s |
| `api-core` | 2595 | 1458 | 257 | 20 | 600 | 0 | 260 | 63.3% | 85.2% | 4m11s |
| `internal/metrics` | 46 | 30 | 0 | 0 | 16 | 0 | 0 | 65.2% | 100.0% | 0m14s |
| `git-ipc` | 1014 | 449 | 157 | 142 | 154 | 0 | 112 | 65.5% | 79.0% | 14m04s |
| `apps/kira-space/internal/gitops` | 83 | 57 | 0 | 0 | 26 | 0 | 0 | 68.7% | 100.0% | 0m21s |
| `apps/kira-space/internal/gitclient/logsession` | 62 | 46 | 0 | 0 | 16 | 0 | 0 | 74.2% | 100.0% | 0m26s |
| `apps/kira-studio/internal/mcpauth` | 20 | 15 | 0 | 0 | 5 | 0 | 0 | 75.0% | 100.0% | 0m09s |
| `apps/kira-studio/internal/tree` | 32 | 24 | 0 | 0 | 8 | 0 | 0 | 75.0% | 100.0% | 0m23s |
| `apps/kira-space/internal/gitsearch` | 231 | 184 | 0 | 0 | 47 | 0 | 0 | 79.7% | 100.0% | 0m57s |
| `apps/kira-space/internal/gitreview` | 217 | 178 | 0 | 0 | 39 | 0 | 0 | 82.0% | 100.0% | 1m29s |
| `apps/kira-studio/internal/queryplan` | 180 | 159 | 0 | 0 | 21 | 0 | 0 | 88.3% | 100.0% | 0m48s |

## Worst 15 files by score (>= 20 mutants)

| file | mutants | survived | no cov. | score |
| --- | --- | --- | --- | --- |
| `apps/kira-space/internal/gitreview/export.go` | 20 | 0 | 20 | 0.0% |
| `apps/kira-studio/internal/adapters/kafka/adapter.go` | 22 | 0 | 22 | 0.0% |
| `apps/kira-studio/internal/adapters/postgres/console.go` | 35 | 0 | 35 | 0.0% |
| `apps/kira-studio/internal/adapters/postgres/adapter.go` | 57 | 0 | 57 | 0.0% |
| `apps/kira-studio/internal/adapters/postgres/catalog.go` | 42 | 0 | 42 | 0.0% |
| `apps/kira-studio/internal/adapters/postgres/definition.go` | 70 | 0 | 70 | 0.0% |
| `apps/kira-studio/internal/adapters/postgres/read.go` | 32 | 0 | 32 | 0.0% |
| `packages/api-core/src/grpc/saved.ts` | 87 | 0 | 87 | 0.0% |
| `packages/api-core/src/http/body.ts` | 198 | 0 | 147 | 0.0% |
| `packages/api-core/src/http/saved.ts` | 148 | 0 | 148 | 0.0% |
| `packages/api-core/src/http/substituteRequest.ts` | 28 | 0 | 28 | 0.0% |
| `packages/git-core/src/graph/stashRows.ts` | 32 | 0 | 32 | 0.0% |
| `apps/kira-space-vscode/src/blameWidget.ts` | 117 | 0 | 117 | 0.0% |
| `apps/kira-space-vscode/src/connection.ts` | 305 | 0 | 305 | 0.0% |
| `apps/kira-space-vscode/src/diffToolbar.ts` | 95 | 0 | 95 | 0.0% |

## Red / skipped units

| unit | status | reason |
| --- | --- | --- |
| `go:internal/terminal` | red | --- FAIL: TestSessionCloseKillsProcessGroup (10.24s) |

## Notes

- container-gated Go packages (not covered share > 50%): 2, 435 not-covered mutants
- Go packages with darwin-only files not mutated: 1
- TS without a unit suite, not run: packages/theme, packages/kira-ui

## Run

- commit bb58aa81adf87c52e24c467fcbc0bd2e7a73ff0f, 4 cores
- segment ts 2026-10-04T14:39:31Z: 26m05s, 2 workers
- segment go 2026-10-04T15:05:45Z: 2m41s, 2 workers
- segment go 2026-10-04T15:09:31Z: 5m30s, 2 workers
- segment ts 2026-10-04T15:15:04Z: 4m11s, 2 workers
- segment go 2026-10-04T15:19:39Z: 4m08s, 2 workers
- segment ts 2026-10-04T15:23:49Z: 0m25s, 2 workers
- tools: gremlins v0.6.0 go1.27.1; stryker 10.0.0; bun runner 1.4.0
