# P151 — Introduce mutation testing (report-only)

Base: `8dd60e10`. Branch `v2.0-p151-c`. Runs as third concurrent stream beside P144 A/B, at the
user's explicit request (outside normal one-phase-at-a-time order).

## 1. Goal and hard boundaries

Measure test strength: run mutation testing over the whole unit-test surface, record how many
mutants survive. Nothing gets fixed now.

- In: tooling, wrapper scripts, a summary generator, one baseline run, docs, a pending CI workflow.
- Out, entirely: production-code edits, new tests, test fixes, mutation-driven refactors.
- Out: any gate. No `.githooks/*` change, no `package.json` script, no `pr.yml` step, no
  threshold. Pre-commit/pre-push cost must stay unchanged.
- Out: UI/visual/ipc/e2e/e2e-real suites (Playwright). Only Go `go test` and `bun test` unit scope.
- Untouched shared hotspots: root `package.json`, root `bun.lock`, `knip.json`, `go.mod`, `go.sum`,
  `biome.json`, root `.gitignore`, `bunfig.toml`, `docs/v2.0/SPEC.md`, `docs/ARCHITECTURE.md`.

## 2. Evidence gathered on this machine (4 cores, go1.27.1, bun 1.3.14, node 22.22)

Real checks run while planning, not assumptions:

- `go test -count=1 ./internal/... ./apps/kira-space/internal/... ./apps/kira-studio/internal/...`:
  2m07s wall, 70 packages ok, 2 red at base `8dd60e10` (see §9 Q6):
  `apps/kira-space/internal` (`TestDomainPackagesDoNotImportBridge`: `bridge/adewire` flagged) and
  `apps/kira-space/internal/gitsock` (`TestMatrix_M3_FullIndependence`, timing; flaky).
- `bun run test:unit`: 1831 pass, 182 files, 13s — only after copying generated Wails
  `frontend/bindings` in (untracked build product, `bun run setup`); without them 51 fail on
  `Cannot find module '@bindings/...'`.
- Go tool installs (into a scratch `GOBIN`, never `go.mod`): `gremlins@v0.6.0` builds and runs under
  go1.27.1 (38s install). `avito-tech/go-mutesting@latest` builds too.
- gremlins on `apps/kira-studio/internal/mask`: default `--timeout-coefficient` (3) gave 81/106
  `TIMED OUT` (17ms suite, coefficient multiplies coverage-run time). With coefficient 60: 87 killed,
  17 lived, 1 timeout, 1 not covered, 35s at 2 workers. On `apps/kira-space/internal/gitclient/logsession`
  (7s suite): 46 mutants, 65s at 2 workers.
- avito go-mutesting on same `mask`: 245 mutants, 3m11s, single-threaded, no coverage gating
  (uncovered code counts as escaped), writes `report.json` into the CWD (dirtied the tree).
- gremlins dry runs (root-level, coverage-aware): `./apps/kira-studio/internal` 2,933 runnable /
  3,602 not covered; `./internal` 250 / 420; `./apps/kira-space/internal` fails coverage outright
  (red tests above), per-package sum ≈ 2,850 runnable. Adapter packages are mostly not covered:
  their conformance suites `t.Skip` without Docker (`testsupport/fixture.go:49`), e.g. kafka 7
  runnable / 171 not covered, postgres 19 / 264.
- gremlins coverage always runs `go test ./<dir>/...` (hardcoded in
  `internal/coverage/coverage.go:170`): a parent dir re-runs every child suite. `-E '/'` limits
  mutation to the dir's own files (verified). `--diff <ref>` exists and runs.
- gremlins copies the whole module per worker (`internal/engine/workdir/workdir.go:81`,
  `filepath.Walk` of the module root). Main checkout carries 790MB `node_modules` → run from a
  tracked-files snapshot, never the live checkout.
- StrykerJS 10.0.0 + `@hughescr/stryker-bun-runner` 1.4.0 installed in an isolated
  `tools/mutation/package.json`: own `bun.lock`, root `bun.lock` untouched, `knip` exit 0,
  `biome check` clean, nested `tools/mutation/.gitignore` honored by biome (VCS mode).
- Stryker per-area results (`--dryRunOnly` unless stated):
  - git-core `util/` full run: 169 mutants, 22s, score 74.07%.
  - `apps/kira-space/frontend/src/ade/useQueue.ts` full run vs `ade-queue-parity.spec.ts`:
    2,284 mutants, 7m12s at 2 workers, 54.16% (1228 killed, 698 survived, 349 no coverage) —
    ≈0.44 s per covered mutant per worker.
  - Whole scope instrumented: 565 files, 48,214 mutants.
  - kira-studio area 19,170 mutants (742 tests green), kira-space 7,675 (212 green), git-core 2,675
    (269 green) — each green only after three workarounds below.
- Workarounds the dry runs needed (no repo test/source change):
  1. Bun default 5s per-test timeout kills `shaTable.test.ts` 100k-sha test under instrumentation →
     `bun.bunArgs: ['--timeout', '60000']`.
  2. Runner eager-imports every mutated module before any spec (README "Eager-import and
     `mock.module()`"). Modules reaching `/wails/runtime.js` (`bridge/port.ts` module-scope
     `Stream('engine')`) then fail before `packages/workbench/src/testing/unit/wailsRuntime.ts`
     registers its `mock.module`: 123 of 280 frontend modules fail a standalone import. Passing that
     helper via `bunArgs --preload` did not help (ordering). Appending
     `[test] preload = [window.ts, wailsRuntime.ts]` to the **snapshot's** `bunfig.toml` (runner
     forwards bunfig `preload`) did. `main.ts` excluded (`__KIRA_DEBUG_HOOKS__` undefined).
  3. `tabs-save-retries-after-failure.spec.ts` and `tabs-save-serialized.spec.ts` fail under
     instrumentation (a `setTimeout(0)` race; also fail in a plain instrumented sandbox) → excluded
     from the kira-studio area's test list, not edited.
- Whole-suite single Stryker run failed its initial run (58 fails) → per-area runs (§4) are the
  design, not an optimisation.

## 3. Tool choice

Go — **gremlins v0.6.0** (Apache-2.0, LICENSE verified in module cache; last release 2025-12-05).

- Coverage-aware: separates NOT COVERED from LIVED — the report must distinguish "no test runs
  this" from "test runs it but asserts nothing".
- Parallel workers, per-mutant workdir copies (never mutates the source tree), JSON output (`-o`),
  `--diff`, `--exclude-files`, `--tags`.
- Rejected: avito-tech/go-mutesting (MIT, active: commit 2026-10-02) — sequential only, no coverage
  split, writes into CWD; ~5× slower on `mask`. zimmski/go-mutesting — unmaintained since 2021.
  ooze (MIT, v0.2.0 2023) — runs as a `_test.go` inside each package and needs a `go.mod`
  requirement: violates both "no new tests" and "go.mod untouched".
- Risk: gremlins maintenance is slow (one release in ~2y). Pinned version; fallback is avito with
  a 5× runtime and no coverage split — documented, not built.

TS — **StrykerJS 10.0.0** (`@stryker-mutator/core`, Apache-2.0, released 2026-08-14) with
**`@hughescr/stryker-bun-runner` 1.4.0** (Apache-2.0, released 2026-09-15, `bun >= 1.3.7`).

- Repo's unit runner is `bun test` (`package.json` `test:unit`, specs import `bun:test`). Vitest
  runner would need every spec rewritten: rejected. `stryker-mutator-bun-runner` 0.4.0: stale
  (2025-07), core ^9 only: rejected.
- hughescr runner gives `perTest` coverage: each mutant runs only its covering tests and files;
  NoCoverage costs nothing.
- Risk: single maintainer. Fallback: Stryker built-in `command` runner (`bun test <area files>`),
  `coverageAnalysis: 'off'` — every mutant runs the whole area suite (4-13s), ~10-30× slower and no
  NoCoverage status. Documented, not built.
- No `@stryker-mutator/typescript-checker`: needs its own `typescript` in `tools/mutation`, slows
  every mutant; bun strips types, so type-invalid mutants still execute. Caveat in baseline.
- Implementer re-verifies licenses of the `tools/mutation` transitive tree (read each
  `node_modules/**/package.json` `license`), lists any non-permissive one, stops if found.

## 4. Design

### 4.1 Layout (all new files)

```
scripts/mutation/run.sh        entry: run.sh go|ts|all [targets...] [flags]
scripts/mutation/go.sh         per-package gremlins loop (sourced by run.sh)
scripts/mutation/ts.sh         per-area Stryker loop (sourced by run.sh)
tools/mutation/package.json    pinned Stryker + bun runner, own bun.lock
tools/mutation/bun.lock
tools/mutation/.gitignore      bin/  node_modules/  out/
tools/mutation/tsconfig.json   typechecks summarize.ts + stryker.config.mjs only
tools/mutation/areas.json      TS area table (§4.4)
tools/mutation/stryker.config.mjs  base config; reads area spec from env
tools/mutation/summarize.ts    gremlins + Stryker JSON → summary.json + summary.md
```

`scripts/mutation/*.sh` source `scripts/lib.sh` for `require_cmd`/`go_directive`, then reset
`ROOT_DIR` from `git rev-parse --show-toplevel` (lib.sh assumes callers live directly in
`scripts/`). `summarize.ts` lives under `tools/`, not `scripts/mutation/`: knip's root project glob
`scripts/**/*.ts` with entry `scripts/*.ts` would flag it unused and need a `knip.json` edit.

### 4.2 Run directory and snapshot

- Reports: `tools/mutation/out/<UTC yyyymmdd-HHMMSS>-<shortsha>/` plus `out/latest` symlink.
  Contents: `meta.json` (commit, tool versions, flags, nproc, start/end), `go/<pkg-slug>.json` +
  `.log`, `ts/<area>/mutation.json` + `.log`, `summary.json`, `summary.md`.
- Work: `RUN_TMP=$(mktemp -d)`; `export TMPDIR=$RUN_TMP` so gremlins `wd-*` dirs, Stryker sandboxes
  and runner temp files land there. `trap` removes `RUN_TMP` on exit; reports stay.
- Snapshot: `git archive <ref> | tar -x -C $RUN_TMP/src`. `<ref>` = `HEAD`, or with `--dirty`
  `$(git stash create)` (creates an object, touches no ref; falls back to HEAD when clean). Tracked
  files only (~52MB), so the live checkout is never mutated or copied with `node_modules`.
- Snapshot extras: symlink root `node_modules` and each workspace `*/node_modules` that exists;
  TS only: copy `apps/*/frontend/bindings` (missing → exit with "run `bun run setup` first") and
  append the `[test] preload` block (§2 workaround 2) to the snapshot `bunfig.toml`, with a comment
  naming why.

### 4.3 Go mode (`run.sh go [pkgdir...]`)

- Tool: `GOBIN=tools/mutation/bin GOTOOLCHAIN=go$(go_directive) go install
  github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0` when `bin/gremlins` is missing or its
  `meta` stamp (version + go directive) differs. Same toolchain-pin rule as `setup.sh`.
- Targets: default = every package with test files under `./internal/...`,
  `./apps/kira-studio/internal/...`, `./apps/kira-space/internal/...` (`go list -e`), minus the
  exclusion list. Args narrow to given dirs.
- Excluded packages (test infrastructure or generated): `internal/layeringtest`, `internal/testx`,
  `apps/kira-studio/internal/adapters/testsupport`, `apps/kira-studio/internal/ipcfixture`,
  `apps/kira-studio/internal/page/wire`, `apps/kira-space/internal/gitwire` (flatc output),
  `apps/kira-studio/cmd/...`, both app `main` packages. `_test.go` files are never mutated by
  gremlins.
- Excluded files: `-E '/'` (subpackage files; each package gets its own run), `-E '_darwin\.go$'`,
  plus any file whose `//go:build` line requires `darwin` (scan, not just name). These compile only
  on macOS; on Linux a mutant there is invisible. Count reported as "darwin-only, not mutated".
- Per package: pre-check `go test -count=1 <pkg>` timed as `t`. Red → record `status: red` with
  first `--- FAIL` line, skip. Green → `gremlins unleash -o go/<slug>.json --workers W
  --timeout-coefficient C -E ... <dir>`; `C = max(3, ceil(max(60, 3t) / t))`. Coverage failure
  (recursive child flake) → retry once, then `status: red`.
- Resume: a package whose `go/<slug>.json` exists is skipped (`--resume <run-dir>`). Halting mid-run
  loses at most one package.
- Changed mode: `--changed <ref>` limits targets to packages with `.go` changes since `<ref>` and
  passes `--diff <ref>` to gremlins.
- Containers: default runs without Docker. Container-gated adapter tests skip, their mutants report
  NOT COVERED, tagged "container-gated" in the summary (packages under `adapters/` whose
  not-covered share > 50%). No container mode in this phase: a mutant run would start containers
  per mutant (minutes each).

### 4.4 TS mode (`run.sh ts [area...]`)

- Tool: `bun install --frozen-lockfile --cwd tools/mutation` when its `node_modules` is missing.
  Stryker runs under node: `node tools/mutation/node_modules/@stryker-mutator/core/bin/stryker.js
  run tools/mutation/stryker.config.mjs`, CWD = snapshot.
- `areas.json` (one area = one Stryker run; `tests` relative, never absolute — runner warns that
  absolute paths bypass the sandbox):

  | area | mutate | tests |
  | --- | --- | --- |
  | kira-studio | `apps/kira-studio/frontend/src/**/*.ts` | `apps/kira-studio/tests/unit` minus 2 tabs-save specs |
  | kira-space | `apps/kira-space/frontend/src/**/*.ts` | `apps/kira-space/tests/unit` |
  | api-core | `packages/api-core/src/**/*.ts` | `packages/api-core/test` |
  | git-core | `packages/git-core/src/**/*.ts` | its `*.test.ts` |
  | git-ipc | `packages/git-ipc/src/**/*.ts` | its `*.test.ts` |
  | git-ui | `packages/git-ui/src/**/*.ts` | its `*.test.ts` |
  | kira-space-vscode | `apps/kira-space-vscode/src/**/*.ts` | its `*.test.ts` |
  | cross | `packages/shared/**/*.ts`, `packages/workbench/src/**/*.ts` | every spec above |

  `cross` exists because shared/workbench code is exercised mainly through app specs; `perTest`
  keeps its per-mutant cost to covering tests. Each `excludeTests` entry carries a `reason`.
- Global excludes: `**/*.{test,spec}.ts`, `**/*.d.ts`, `**/generated/**`, `**/bindings/**`,
  `packages/shared/protocol/wire.ts`, `packages/shared/protocol/wire/**`, `**/components/ui/**`
  (vendored shadcn), `**/testing/**`, `**/main.ts`, all `.vue`. `packages/theme` and
  `packages/kira-ui` have no unit tests: listed in summary as "no unit suite", not run.
- Config: `testRunner: 'bun'`, `coverageAnalysis: 'perTest'`, `ignoreStatic: true` (static mutants
  otherwise force full-area runs; counted as Ignored), `checkers: []`, `disableTypeChecks:
  '{apps,packages}/**/*.ts'` (default scans docs HTML and warns), `bun: { timeout: 600000, bunArgs:
  ['--timeout', '60000'] }`, `timeoutMS: 10000`, `timeoutFactor: 2`, `reporters: ['json',
  'clear-text']`, `jsonReporter.fileName` and `tempDirName` from env, `concurrency` = W.
  Plugin path via `import.meta.resolve`.
- Unverified areas (api-core, git-ipc, git-ui, vscode, cross): implementer dry-runs each first. A
  red initial run gets the same two remedies (timeout, preload); a spec still red is added to that
  area's `excludeTests` with the failing test name as reason. Never edit a spec.
- Resume: area with `ts/<area>/mutation.json` present is skipped.
- Changed mode: `--changed <ref>`: `mutate` = changed `.ts` files intersecting the area's globs;
  area skipped when empty.

### 4.5 Concurrency and resources

- `W` = `MUTATION_WORKERS` or `max(1, nproc/2)`. Half the cores: Go suites use `t.Parallel` and
  timing-sensitive concurrency tests; oversubscription turns flakes into false kills. Never pass
  gremlins `--test-cpu` (see Result).
- Disk per run ≈ snapshot 52MB + W gremlins copies + one Stryker sandbox.
- `run.sh all` runs Go then TS sequentially, never both at once.

### 4.6 Summary (`summarize.ts`, run by `run.sh` at the end and standalone via
`bun tools/mutation/summarize.ts <run-dir>`)

- Normalised statuses: killed, survived (gremlins LIVED), timeout, noCoverage, invalid (gremlins NOT
  VIABLE; Stryker CompileError/RuntimeError), ignored (Stryker Ignored/static; gremlins SKIPPED).
- `score = (killed + timeout) / (killed + timeout + survived + noCoverage)`; `coveredScore` drops
  noCoverage. Stryker's own convention, applied to both languages so numbers compare.
- `summary.json`: `{ commit, generatedAt, tools: {gremlins, stryker, runner}, totals: {go, ts},
  units: [{ lang, unit, status: ok|red|skipped, reason?, tags[], counts, score, coveredScore,
  durationSec }] }`.
- `summary.md`: totals per language; per-area table; worst 15 units by `score` with ≥ 20 mutants;
  red/skipped units with reasons; darwin-only and container-gated counts. Terse, no prose.
- No unit test for it: plain counting, below CLAUDE.md's bar.

## 5. Runtime estimate and baseline decision

- Go: ≈ 6,000 runnable mutants. Measured 0.66 s/mutant/worker at a 17ms suite, 2.8 s at 7s.
  Heavy tail: `gitsession` (25s suite), `ade` (19s), `gitrpc` (15s), `apps/kira-studio/internal`
  root (13s, recursive coverage of the whole app). Estimate 5-6 worker-hours → ~3h at W=2 here.
- TS: 48,214 mutants instrumented; at 50-65% covered and 0.44 s/covered mutant/worker,
  1-1.5h at W=2, less with `ignoreStatic`.
- Decision: **full baseline**, run as resumable segments (one `run.sh` call per background command,
  each < 2h: Go light packages; Go heavy tail; TS kira-studio; TS rest). If the total exceeds 8h
  wall, or the container restarts twice, stop and commit a documented sample: all TS areas plus
  every Go package except `gitsession`, `ade`, `gitrpc`, each omission named.

## 6. Baseline note

`docs/v2.0/plans/P151-mutation-baseline.md`: generated `summary.md` body plus a short header —
commit, date, machine (nproc, RAM), W, wall time per segment, tool versions, and caveats:

- Go red packages skipped (names); container-gated adapter suites read as not covered;
  darwin-only files not mutated; timing-flaky suites can count as false kills.
- TS: excluded specs with reasons; no type checker, so some survivors are type-invalid code;
  `.vue` not mutated; static mutants ignored.
- Numbers are a snapshot for trend, not a target. No finding gets fixed in P151.

## 7. CI (pending workflow)

`docs/pending-workflows/mutation.yml` (cannot push `.github/workflows/` from here;
`docs/DEV_ENVIRONMENT.md` §"Git push"). Report-only:

- `on: workflow_dispatch` (inputs `lang: go|ts|all`, `changed_ref`) and `schedule` weekly (Sunday
  `17 2 * * 0`). Not on push/PR. `permissions: contents: read`. `concurrency` group, no cancel.
- Jobs `go` and `ts`, `ubuntu-latest`, `timeout-minutes: 350`, `continue-on-error: true`. Same
  action versions as `pr.yml` (`checkout@v7`, `setup-go@v7` with `go-version-file`,
  `setup-bun@v2`, `cache@v4`, `upload-artifact@v7`). `ts` mirrors `pr.yml`'s Linux job steps for
  apt packages + `sh scripts/setup.sh` (bindings).
- Run `sh scripts/mutation/run.sh <lang>`, append `summary.md` to `$GITHUB_STEP_SUMMARY`, upload
  the run dir as an artifact (14-day retention). Never a required check.

## 8. Docs

- `docs/DEV_ENVIRONMENT.md`: new section "Mutation testing (P151, report-only)" appended at end:
  prerequisites (`bun run setup` for bindings, Go per go.mod), commands, flags (`--changed`,
  `--resume`, `--dirty`, `MUTATION_WORKERS`), output location, runtime expectations, the three
  Stryker workarounds and why, Docker note, "never wired into hooks".
- `docs/ARCHITECTURE.md`: no change. Mutation tooling is a dev-environment fact, not an app fact.

## 9. Commits, checks, acceptance

Commits (Conventional Commits; hooks pass normally; fast checks before each: `bun run lint`,
`bun run typecheck`, `node_modules/.bin/tsgo --noEmit -p tools/mutation/tsconfig.json`,
`bunx knip` exit 0, `sh -n` on each `.sh`):

1. `chore(mutation): isolated Stryker toolchain manifest` — `tools/mutation/{package.json,
   bun.lock,.gitignore,tsconfig.json}`. Check: `git diff --stat` shows root `bun.lock` untouched.
2. `feat(mutation): Go mutation runner` — `scripts/mutation/run.sh`, `scripts/mutation/go.sh`.
   Check: `run.sh go apps/kira-studio/internal/mask` produces `go/*.json`, tree clean after.
3. `feat(mutation): TS mutation runner` — `scripts/mutation/ts.sh`,
   `tools/mutation/{areas.json,stryker.config.mjs}`. Check: dry run of every area green.
4. `feat(mutation): summary generator` — `tools/mutation/summarize.ts`. Check: summary from
   commit 2+3 sample outputs.
5. `docs: mutation testing how-to and pending workflow` — `docs/DEV_ENVIRONMENT.md`,
   `docs/pending-workflows/mutation.yml`.
6. `docs(v2.0): P151 mutation baseline` — `docs/v2.0/plans/P151-mutation-baseline.md`, result
   section appended to this plan.

Acceptance (orchestrator verifies by real check):

- `git diff 8dd60e10 --stat` touches only §10's files.
- `grep -rn mutation .githooks package.json .github` finds nothing.
- `knip` exit 0; `bun run lint` and `typecheck` pass; root `bun.lock` byte-identical to base.
- After a run, `git status --short` is empty (outputs ignored, snapshot in `TMPDIR`).
- `tools/mutation/out/latest/summary.json` exists and its totals match the baseline note.
- Baseline note states per-language totals, per-area scores, runtime, every skip with reason.
- No `.go`/`.ts`/`.vue` change outside `scripts/mutation/` and `tools/mutation/`.

## 10. Streams verdict and file ownership

One stream, one sequential implementer. No split: Go runner, TS runner and summary share
`run.sh` and the run-dir format (ordering dependency).

P151 owns exactly:

- `scripts/mutation/**` (new)
- `tools/mutation/**` (new)
- `docs/pending-workflows/mutation.yml` (new; directory new)
- `docs/DEV_ENVIRONMENT.md` (one appended section)
- `docs/v2.0/plans/P151-mutation-testing.md`, `docs/v2.0/plans/P151-mutation-baseline.md`

Overlap check: P144 A/B own Go `internal/**` (both apps + repo root), `apps/kira-space/frontend/
src/ade/v2/board/**`, `go.mod`, `knip.json`, `SPEC.md`. P151 reads those trees (snapshot only),
writes none. Closing step owns `docs/v2.0/SPEC.md` (row + result) — P151 never edits it. Zero overlap.
Only shared-file risk: `docs/DEV_ENVIRONMENT.md` if another stream also appends; append-at-end
keeps any rebase conflict trivial.

## 11. Questions for the user

1. Accept `@hughescr/stryker-bun-runner` (Apache-2.0, single maintainer, active) as a dependency
   of the isolated tools dir? Alternative is the built-in command runner, ~10-30× slower.
2. Full baseline (~4-5h here, segmented) or the documented sample (skips 3 heaviest Go packages)?
3. Leave container-gated adapter suites as "not covered" in the baseline, or plan a later opt-in
   per-adapter container run?
4. Pending workflow: weekly schedule plus manual dispatch, or manual dispatch only?
5. Want a root `package.json` alias (`bun run mutation`) later? Skipped now: shared hotspot.
6. Base `8dd60e10` has a red Go test: `apps/kira-space/internal` layering test flags
   `bridge/adewire` as a domain package importing the bridge layer. CLAUDE.md says fix on the spot,
   but that tree belongs to P144 (`internal/**`). Route it to P144 or a follow-up phase?
   (`gitsock` `TestMatrix_M3_FullIndependence` also failed once: timing flake.)

## Result

Implemented as planned, 6 commits (`ab035847` manifest, `bb58aa81` Go runner, `6e430f7f` TS runner,
`252c7773` summary, `725d30e1` docs, baseline commit last). Baseline: `P151-mutation-baseline.md`
(sample, user-approved: Go 25 packages / 2,031 mutants, TS 4 areas / 8,892 mutants, about 43 min at
2 workers). Go figures invalid, see Open items; TS score 45.3%, covered score 79.2%.

Q1-Q5 answered by user: single-maintainer bun runner accepted; sample baseline now (full later,
resumable); container-gated adapters stay "not covered"; CI job manual-dispatch only (no weekly
schedule); no root `bun run mutation` alias. Q6: `go test ./apps/kira-space/internal` passes on the
rebased tree (P144 Stream A's `layeringtest.RunAllowing`).

Deviations from the plan:

- `tools/mutation/tsconfig.json` ships in the summary commit, not the manifest commit: an `include`
  of files that do not exist yet fails `tsgo` (TS18003). `stryker.config.mjs` carries JSDoc types so
  `checkJs` passes.
- Unit marker is `<unit>.info.json` (status, reason, duration, darwin files), not the mutation JSON:
  red units have no mutation JSON. TS layout is flat: `ts/<area>.json|.log|.info.json`.
- Go `--changed` does not use `gremlins --diff`: the snapshot has no `.git`. It limits packages to
  changed `.go` files and excludes every other file of the package with `-E`. Verified with
  `--dirty --changed HEAD` for Go and TS.
- A fourth Stryker workaround: workspace packages carry their own `node_modules` (isolated linker),
  which Stryker's sandbox does not link (`Cannot find package 'zod'`). Fix: `inPlace: true` on the
  disposable snapshot, and `run.sh` symlinks every `node_modules`. Added `progress-append-only`
  reporter for visible progress. Workarounds 1 (bun timeout) and 2 (preload) kept from planning; not
  re-verified individually after `inPlace`.
- Transitive licence read of `tools/mutation/node_modules` (172 packages): MIT 139, Apache-2.0 15, ISC
  10, BSD-3-Clause 4, BlueOak-1.0.0 1, 0BSD 1, CC-BY-4.0 1 (`caniuse-lite`, data, dev-only). No
  copyleft.
- The worktree's generated Wails bindings were stale (`adetaskservice` missing, so `typecheck` and
  `knip` failed); refreshed from the main checkout's gitignored copy. Not a tracked change.
- `internal/terminal` `TestSessionCloseKillsProcessGroup` fails in plain `go test` here. Not touched
  (user: no test fixes). Needs its own follow-up phase if it reproduces outside this container.

Acceptance checks (real runs):

- `git diff 13e99974 --stat` touches only `scripts/mutation/**`, `tools/mutation/**`,
  `docs/pending-workflows/mutation.yml`, `docs/DEV_ENVIRONMENT.md`, and the two `P151-*` docs.
- No mutation reference in `.githooks`, `package.json`, `.github` (only the word "permutation" in
  `release.yml`). Root `bun.lock` and `package.json` byte-identical. Hooks passed on every commit
  without `--no-verify`; `knip` exit 0, `bun run lint` and `typecheck` pass, `tsgo -p
  tools/mutation/tsconfig.json` clean.
- After runs `git status --short` is empty; `out/latest/summary.json` totals match the baseline note.

Open items:

- Go baseline invalid. Finding: gremlins v0.6.0 builds `-cpu 2` as a single argv entry, so `go test`
  fails to start and every covered mutant counts as killed (the "0 survived" vs the early `mask`
  probe's 17 lived). Reproduced on `internal/mask`: with the flag 105 killed / 0 lived; without
  87 killed / 17 lived / 1 timeout. Flag removed from `scripts/mutation/go.sh` (`fab4ca68`). The
  Go rerun (25 packages, about 12 min at 2 workers) is deferred to a run on another VM; the Go
  totals and tables in `P151-mutation-baseline.md` stay stale until then. Not rerun here.
- `internal/terminal` `TestSessionCloseKillsProcessGroup` did not reproduce on retest in this
  container (4 passes, main and p151 worktrees). Tracked as P153.
