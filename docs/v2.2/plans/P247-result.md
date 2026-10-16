# P247 result

Done: step results in YAML, per-run `finish_step` schema, route engine, graph editor, result and route on board, panel, Needs you and notification.

Commits (on `p247-N`, off v2.0 `298215758`):
- `feat(ade): step results in workflow YAML`
- `feat(ade): finish_step takes the step's results`
- `feat(ade): route runs on the chosen result`
- `feat(ade): result and route on board, panel, Needs you, notification`
- `feat(ade): graph workflow editor`
- `test(ade): branching flow, graph editor UI specs, visual baseline, real claude results`

Deviations from plan:
- Test shape follows the later user rule: each new feature test is a split e2e. Backend: `flows/adeflow/branching_test.go` (review loop, spent budget, forward skip, end route, legacy retry and back, Save round trip). Frontend: `ade-v2-workflows.spec.ts` (graph editing) and `ade-v2-run.spec.ts` (result chip, route text, sent-back line from fixtures). No new e2e-real spec; the planned `ade-workflow-branching-real.spec.ts` is not added.
- Route and loop count live as planned (D16). Launch failures ("could not start") no longer auto-retry; they bypass `decideRoute`. Accepted.
- `NumberStepperInput` is not in the theme; the max field is a number `Input`.
- Plan test `ade-v2-workflow-graph.spec.ts` covers edge grouping, loop classification, `setRoute`, `normalizeOrder`, layout order.
- New visual baseline `tests/visual/ade-workflow-graph.spec.ts` (Space, linux webkit).
- Knip and biome findings from earlier commits fixed on the spot (`progress.ts` optional chain).
- Real-claude: `TestAdeStepResults` added to the existing ADE row in `docs/DEV_ENVIRONMENT.md`; build tag and env flag untouched.
- Licences checked at install: `@vue-flow/core` 1.48.2 and `@dagrejs/dagre` 3.1.1 (and `@dagrejs/graphlib`) MIT; both pins older than 14 days.

Checks (real output):
- Pre-commit hook (lint, typecheck) passed on every commit, no `--no-verify`.
- `golangci-lint run ./apps/kira-space/... ./internal/claudeheadless/... ./internal/flowtest/... ./internal/runoutcome/...`: `0 issues.`; tagged `realclaude` files: `0 issues.`
- `bun run test:unit`: `1845 pass, 0 fail`; `bun run lint:dead`: no findings.
- `go build ./...` and `go build -tags server ./...`: clean.
- `go test ./apps/kira-space/internal/ade/...`: ok (94 s).
- `test:flows:space`: all packages ok (adeflow 82 s, coverage gate ok, `exempt.txt` empty). `test:flows:studio`: all ok.
- `test:ui:space`: `370 passed`, 1 failed: `repo-review-interaction.spec.ts` "600 commits mount 500 rows" (5 s timeout, git review UI, load average above 30); alone `8 passed`.
- `test:ui:studio`: `379 passed`, 1 failed: `budgets.spec.ts` console keystroke p50 `51` vs budget `50` (timing, load average above 30; Studio only, untouched by this phase). Rerun not clean under the same load.
- Space visual: `9 passed` (new `workflow-graph-visual-linux.png`); Studio visual: `13 passed`.
- `test:e2e-real:space`: `32 passed`; `test:e2e-real:studio`: `27 passed`.
- Real claude ADE row: `TestAdeHeadlessRun`, `TestAdeStepResults`, `TestAdeStageSession`, `TestAdeRebaseRun` all PASS; spend `0.0236 USD`. `TestAdeStepResults` stored `outcome.result` `pass`, route `next`: the real claude picked a declared result from the per-run schema enum.
- `flows/adeflow TestRebaseRun` flake seen earlier (rebase `NoOp:true` under load, also on v2.0): passed in the full flows run; root cause not found.

Unfixed:
- The two load timeouts above (git review 600 commits; Studio console keystroke budget). Neither touches P247 files.
- Not rebased onto P243 Part 2 (not on v2.0 yet): rebase, `bun install`, regenerate bindings and rerun `lint` before landing.
