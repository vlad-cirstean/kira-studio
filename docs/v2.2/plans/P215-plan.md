# P215 plan: test and hook speed

Base: `cf0d009a6` (v2.0). Machine: 4 cores, 15 GB RAM, no other agents running. Clone history starts
at `19fef8a8b` (2026-10-06 19:31), so every commit here is inside the "last ~30h" window; no bisect.

## Measured (warm cache, second run unless noted)

| Stage | Seconds |
|---|---|
| pre-commit `bun run lint` | 11.5 |
| - `biome check .` (1908 files) | 4.1 |
| - `scripts/check-theme-classes.sh` | 5.9 |
| - `scripts/check-class-conflicts.ts` | 1.3 |
| - `check-tokens.sh` + `check-ade-colours.sh` | 0.06 |
| pre-commit `bun run typecheck` (11 jobs, parallel) | 41 |
| - `typecheck:web:studio` (vue-tsc, alone) | 23.3 |
| - `typecheck:space-web` (vue-tsc, alone) | 18.8 |
| - `typecheck:git` (tsgo x3 + vue-tsc x2, alone) | 13.3 |
| - `typecheck:docker` (vue-tsc, alone; added 2026-10-07 `36134ee7c`) | 5.8 |
| - `typecheck:space-mobile` (vue-tsc, alone; added 2026-10-08 `bfcedc3de`) | 5.3 |
| - `typecheck:proto:studio` (vue-tsc, alone) | 5.0 |
| - five tsgo jobs, each alone | 0.4 to 1.5 |
| pre-push `go build ./...` | 6.2 |
| pre-push `bun run lint:go` | 1.8 |
| pre-push `bun run lint:dead` (knip) | 3.2 |
| `go build ./...`, fresh GOCACHE | 97 |
| `golangci-lint run`, fresh lint cache | 14 |
| `go build` / `lint:go` after editing `internal/sqlitex/load.go` | 7.8 / 5.0 |
| `go test ./...` (first run after cache wipe / cached) | 69 / 1.9 |
| `bun run test:unit` (1810 tests) | 11 |
| `build:test:space` | 6.5 |
| `test:ui:space` Playwright (227 tests) | 275 |
| `build:test:studio` | 7.5 |
| `test:ui:studio` Playwright, `ui` (338 tests) + `ui-timing` (4) | 531 + 55 = 592 |
| `build:space-mobile` | 5.1 |
| `test:ui:space-mobile` Playwright (51 tests) | 20 |

Per-test (Playwright JSON reporter): space `ui` median 5.3 s, sum 1065 s over 275 s wall, so 3.9x
of 4 workers. Studio `ui` median 3.8 s, sum 2079 s over 531 s wall, same 3.9x. A space test that
takes 7.6 s in the full run takes 3.3 s alone (`--workers=1`): the suite is CPU-bound, not waiting.

## What is not the cause (checked, ruled out)

- Network waits: an idle booted app issues 0 RPCs in 10 s (scratch census spec, both apps), and
  WebKit sits idle in `top`. No test reaches a model download; `internal/memory/embed/smoke_test.go`
  is behind `//go:build embedsmoke`.
- Rebuild per Playwright run: neither config has `webServer` or `globalSetup`. Each `test:ui:*`
  script builds the frontend once (5 to 8 s). `resolveWailsRuntimeJsPath`
  (`packages/workbench/src/testing/ui/mockRuntime.ts:62`) runs `go list -m` once per worker: 0.08 s.
- `//go:embed all:frontend/dist-mobile` (`apps/kira-space/main.go:58`): 652 KB, 16 files. Warm
  `go build` is 6 s, of which linking 3 mains is most; that cost predates this window.
- New Go deps (go-git, docker/cli, moby client, onnxruntime_go, go-huggingface, goldmark): in the
  fresh-cache build action graph (`-debug-actiongraph`) the top costs are wails cgo 37 s,
  go-redis 20 s, modernc sqlite 16 s, aws s3 14 s. `onnxruntime_go` cgo is 2.5 s. Cold Go cost is
  long-standing, not new.
- knip: 3.2 s; `dist`, `dist-mobile` and worktrees are not scanned (all gitignored or outside repo).
- golangci-lint scope: `.golangci.yml` is fine; warm 1.8 s.
- `reducedMotion: 'reduce'` on the space `ui` project: 39.5 s versus 38.4 s for `ade-v2-run.spec.ts`
  alone. No gain; animations are not the wait.

No single regression exists. The slowdown is several costs that grew in this window, plus one
test-helper defect that doubles the boot for half the space suite.

## Root causes and fixes

### 1. `openPlan` boots the app twice (space Playwright, biggest win)

Evidence: `apps/kira-space/tests/ui/support/adeV2.ts:124-133`. `openPlan` calls `relaunch()`
(full boot: navigate, ~40 mocked RPCs, wait for `status-bar`), then `clock.install` and
`window.reload()` (second full boot). The trace of `ade-v2-run.spec.ts` "Cancel closes the Run
dialog without a call" shows boot 1 at 0.4 to 1.6 s and boot 2 at 1.8 to 2.6 s of a 3.6 s test.
108 `openPlan(` calls across 17 spec files; most of the 227 tests go through it.

The shared fixture already installs a clock before the first navigation: `clockTime` in
`packages/workbench/src/testing/ui/fixtures.ts:84-87` (`clock.install` then `clock.resume`, so
time still flows, same as `openPlan`'s install without `pauseAt`). `RelaunchOptions` in
`apps/kira-space/tests/ui/fixtures.ts:21` extends `UiFixturesOptions`, so it accepts `clockTime`.

Fix, `adeV2.ts:122-133`:

```ts
/** Opens the ade Plan on the fixture day; the clock is pinned before the first navigation. */
export async function openPlan(
  relaunch: (options?: RelaunchOptions) => Promise<KiraApp>,
  extra: readonly ControlSnapshot[] = [],
): Promise<KiraApp> {
  const app = await relaunch({ control: adeV2Control(extra), clockTime: FIXED_NOW });
  await app.window.locator('[data-testid="ade-plan"]').waitFor();
  return app;
}
```

Measured with exactly this change, full space `ui` project: 275 s to 192 s, 227/227 pass (sum of
test time 1065 s to 736 s). Apply the same review to any other helper that does
`relaunch` then `reload` (`grep -n "\.reload()" apps/*/tests/ui`): studio's
`installClipboardShim` (`apps/kira-studio/tests/ui/support/clipboard.ts:49-53`) has one caller;
move its `addInitScript` into that spec's `relaunch` path only if the caller allows it, otherwise
leave it (one test, ~1 s).

### 2. Typecheck is non-incremental and grew by two vue-tsc jobs (pre-commit, 41 s)

Evidence: `package.json:47-58`. Every pre-commit re-checks 11 projects from scratch, 7 of them
vue-tsc. Shared packages are re-checked once per project: 583 source files appear in more than
one vue-tsc program (`--listFilesOnly`; theme 132, git-ui 126, workbench 117). In this window
`typecheck:docker` (5.8 s alone) and `typecheck:space-mobile` (5.3 s alone) joined the parallel
set; on 4 cores that adds CPU contention to every other job.

Fix: add `--incremental --tsBuildInfoFile node_modules/.cache/tsbuildinfo/<name>.tsbuildinfo` to
every `tsgo`/`vue-tsc` invocation in `package.json:48-58`, one distinct file per `-p` project
(`typecheck:git` has five invocations, so five files). `node_modules/` is already gitignored, and
`*.tsbuildinfo` too. TS writes the build-info file even with `--noEmit`. Keep `typecheck`'s
parallel shell as is.

Measured with all 15 invocations incremental (scratch script, same parallelism):
cold 40.6 s, no change 17.4 s, after editing `packages/workbench/src/bootstrapShell.ts` (shared by
every frontend) 33 s. Single project `space-web`: 21.3 s cold, 7.8 s no change, 8.7 s after a leaf
edit. Correctness checked: an injected type error in a `.ts` file and in `App.vue` is still
reported on the incremental run.

Not done: TS project references (`composite` + `vue-tsc -b`) would also dedupe the 583 shared
files, but needs `composite`/`declaration` emit in every package tsconfig. Larger change, own
phase if wanted after this lands.

### 3. `check-theme-classes.sh` spawns ~350 recursive greps (pre-commit lint, 5.9 s)

Evidence: `scripts/check-theme-classes.sh` has 138 check calls. `check_class_all` (`:152`, 80
calls) and `check_class_in_attrs_all` (`:177`, 29 calls) each run one `grep -r` over `SCAN_DIRS`
plus `_gu_ku_hits` (`:130`), which runs two more over git-ui and kira-ui. One pass is ~35 ms; the
script is linear in retired names, and `36134ee7c` widened `SCAN_DIRS` with docker-ui. A single
combined alternation of all 79 `check_class_all` names over every scanned dir takes 0.10 s.

Fix: two-phase prefilter, keeping each function's current rules and messages.
1. Each family's call sites stay as they are, but the function body first appends `name` (and
   `replacement`, `dirs`) to a family list instead of grepping.
2. After all calls, per family, build one PCRE alternation `(?:name1|name2|…)` with the same
   anchoring and run one grep per pass type with the same exclusions as today: the base pass over
   `$dirs` minus `${THEME_SRC}/components/ui/`, and the GU/KU pass with `_gu_ku_hits`'s class-attr,
   `cn.ts` and comment-line filters.
3. Zero hits in a pass: skip every per-name grep for it. Any hits: for each name, test the hit
   lines (not the tree) with its own regex and report through the existing message path.
Names can be regexes (`sugg-[a-z]+`), so wrap each in `(?:…)`. A name whose `dirs` argument
differs from `SCAN_DIRS` goes in its own group keyed by `dirs`.

Expected 5.9 s to under 1 s. Verify the guard still fires: add a retired class (e.g.
`text-muted`) to one `.vue` file and to one git-ui `.vue` class attr, run the script, see both
reported, revert.

### 4. A 43 MB Linux binary is tracked at repo root (push and clone weight)

Evidence: `git ls-files kira-space` lists it; added in `633a8d69c` (42 MB) and rewritten in
`33df1cd04` (43 MB), both already on `origin/v2.0`. It is `go build ./apps/kira-space` output run
from the repo root. Every rebuild that gets committed pushes another ~43 MB.

Fix: `git rm --cached kira-space`, add `/kira-space` and `/kira-studio` to root `.gitignore`. No
history rewrite (already pushed).

### Legitimate, left as is

- Studio `ui` (531 s) and the rest of space `ui`: CPU-bound at 3.9x on 4 workers. Each test opens a
  fresh WebKit page, boots the real build and answers every RPC through `page.route`
  (`packages/workbench/src/testing/ui/mockRuntime.ts`), ~20 to 130 ms per fulfil. Mobile tests,
  which hit a real local HTTP server instead, run at a 1.0 s median. Replacing route mocks with a
  local mock server is a test-infra redesign, not a regression fix; out of scope.
- Fixed waits that assert something does not happen: `ade-v2-launch.spec.ts:172` (2.6 s),
  `ade-v2-workflows.spec.ts:62` (1.2 s), `repo-workspace.spec.ts:557,1261`. Needed for the negative
  check; 4.6 s total.
- `go build ./...` with a fresh cache: 97 s, dominated by wails cgo. Only after a cache wipe.
- Warm pre-push: 11 s total. Not slow.
- `bun run test:unit`: 11 s; slowest file `packages/git-ui/src/state/pr.test.ts` 3.6 s of real-timer
  waits. Fine.

## Expected after

| Stage | Now | After |
|---|---|---|
| pre-commit lint | 11.5 | ~6.5 |
| pre-commit typecheck, no change / leaf edit / shared edit | 41 / 41 / 41 | ~17 / ~20 / ~33 |
| `test:ui:space` | 275 | ~192 |
| pre-push (warm) | 11 | 11 |
| `test:ui:studio` | 592 | 592 |

## Verification

Run each twice; report the second.

```sh
time bun run lint
time sh scripts/check-theme-classes.sh
time bun run typecheck            # after one warm-up run
echo 'export const __x = 1;' >> apps/kira-space/frontend/src/state/appMetrics.ts
time bun run typecheck; git checkout apps/kira-space/frontend/src/state/appMetrics.ts
time bun run test:ui:space        # expect ~190 s, 227 pass
git ls-files kira-space           # expect empty
```

Commits: one per fix group (1, 2, 3, 4), Conventional Commits, hooks passing without
`--no-verify`.
