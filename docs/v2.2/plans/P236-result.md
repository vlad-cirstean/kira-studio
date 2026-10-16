# P236 result (Stream A)

Base `e0a0e9874`, branch `p236-239-A`. Plan: `P236-plan.md`. Findings: `P236-findings.md`.

## Commits

- Space flows: `f6b4288c9` journeys, `aa7e88775` review and credential, `2898199f3` error paths,
  `3d84fe2d9` parallel ops over two git streams.
- Studio flows: `de72d0378` sqlite journey, db mcp, windows, `ce01ef2e5` api gaps.
- e2e-real: `1996a3943` specs plus `relaunch()` in both fixtures.
- Coverage gate: `3e35a4bc9`, `exempt.txt` 3 Space entries (F1), 0 Studio.
- Fixes (one per root cause): `41add5d2d` F2, `03b0942e5` F3, `886db9d01` F6, `1c5a99716` F7,
  `15e2f600d` F8, `16f455ec2` paging spec, `053521fe2` git helper config, `b2719a4ac` build fixture.
- Lint: `eec8c5183`.

## Flaky rates

| Target | Before | After |
|---|---|---|
| `TestResolveSource_CancelOnlyAffectsOwnCaller` `-race` | 41 failed of ~150 | 0 of 40 |
| `repo-graph-paging` "columns resized wide", 80/160 reps, 8 workers | 1 of 80 | 0 of 160 |
| `ade-board-real` 30 reps, 4 workers | 7 failed, 23 git warnings | 0 failed, 0 warnings |
| `ade-v2-panel.spec.ts:239` 80 reps, 8 workers | 0 of 80 | not changed |
| `TestCodeSearch/cancel_stops_events` | 1 failure in one verification run | 0 of 30 |

## Verification

- `go build ./...` exit 0. `go build -tags server ./apps/kira-space/...` exit 0.
- `bun run test:flows:space`, `test:flows:studio`, `:complete` variants (docker up): all `ok`.
- `go test -race -count=1` on all flows and flowharness packages: all `ok`.
- Coverage gate: `checked 209 bound methods and requests, 3 exempt` (Space), `checked 147 bound
  methods and requests, 0 exempt` (Studio). Gate failed with 4 and 24 and 47 uncovered before the
  tests it found were added.
- `bun run test:e2e-real:space`: `19 passed (1.4m)`. `bun run test:e2e-real:studio`: `19 passed (2.7m)`.
- `bun run lint`, `bun run typecheck`, `bun run lint:dead`: exit 0. `bun run lint:go`: `0 issues.`

## After rebase onto v2.0 (final run)

- Extra commits: `9de52cd12` AttachPush unexported (F1 fixed, gate exemptions removed, harness
  expects 22 bound services), `5068b8563` docker exec-new click (P244), `b48eb523f` bridge test,
  `8dc41cb7b` termflow close and notify click races (found failing in the final run).
- Gate passes with the two new services covered, 0 exemptions in both apps.
- `go build ./...`, `go build -tags server ./apps/kira-space/...`: exit 0.
- `test:flows:space`, `test:flows:studio`, both `:complete` (docker up): `ok`. `go test -race -count=1`
  on all flows and flowharness: `ok`.
- `test:e2e-real:space`: `19 passed (1.5m)`. `test:e2e-real:studio`: `19 passed (1.7m)`.
- `lint`, `typecheck`, `lint:dead`: exit 0. `lint:go`: `0 issues.`
- Run once into a full disk (go cache 8 GB): cleared with `go clean -cache`, then rerun clean.
- P237 real-claude hook tests not rerun: only `Attach*` call sites changed in `appwire`, not hook composition.

## Not done

- F4, F5: no fix (see findings).
- Journey spec makes its commit with git on disk: Space's Git module has no commit UI.
