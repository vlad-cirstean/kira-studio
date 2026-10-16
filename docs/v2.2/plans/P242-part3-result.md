# P242 Part 3 result

Plan: `P242-part3-plan-iter2.md`. Branch `p242c-K`, rebased on v2.0. Space only; Studio keeps ADE nil.

## Delivered

- `internal/scriptruns` ADE seam (`ade.go`): `Tasks`, `Context`, `ClaimWorktree`, `Busy`, `Tools`. Built-ins `task jira repo branch base worktree`. Preview `needs` and `ade`; Start claims the worktree.
- `internal/scripts`: `use_ade_dir`, run `task_id/task_title/branch_id/branch_label`. Migrations Space 0029, Studio 0036, identical bodies.
- `claudeheadless/result.go`: one result-event outcome table for ADE steps and smart scripts.
- Space `ade/automation.go`: `TaskBoard` implements the seam. Gate both ways: step launch held with note "waiting for automation <name>", released on claim release and after restart; rebase blocker "automation X is running in <branch>"; `StartBranch` refused.
- Workflow `smart_script` + `params` step: parse, writer, `planSmartStep`, `smartOutcome`, `superviseAgent`. `run_outcome` kind `automation`.
- Notification `HandleScriptRun` (smart runs only) and reveal channel `kira:agent:reveal-script-run`.
- Workbench: `AdeContextFields` (task combobox, branch radio), worktree Switch, task-aware run dialog. Space: task menu submenu, branch row and header entries, chip, panel block, step card toggle, ADE Run dialog smart body.
- Tests: `adeflow/automation_test.go`, `notifyflow` automation cases, Studio `termflow` refusal case, `ade-v2-automations.spec.ts`, Studio `automations-smart.spec.ts` Switch absence, `ade-automation-real.spec.ts`, real claude `TestSmartScriptRun/in task worktree`.
- Docs: ARCHITECTURE (Scripts in ADE paragraph, run_outcome, high-water marks 0036 / 0029), DEV_ENVIRONMENT row path, SPEC.

## Applied decisions

D1-D16 defaults as written in the plan. No new bound methods; both `exempt.txt` empty.

## Deviations and fixes found while testing

- `scripts.Repo.Insert` omitted `use_ade_dir`: a script created through `Create` never got the worktree option. Fixed.
- Start passed the request branch id to `ClaimWorktree`; an auto-picked single branch has an empty request id, so Start failed "that branch no longer exists". Now uses the resolved preview branch. Found by e2e-real.
- Smart step config errors surfaced as `E_INTERNAL`; now `E_INVALID`, and the failed-launch note reads "could not start: <cause>".
- Fake claude records `KIRA_BRANCH*` env too.
- After a smart start from ADE the person stays on the board; the chip opens the run tab. Plan text implied the tab opens on start.
- Reveal payload from a notification click carries an empty `label`; the frontend takes the label from the cached run.
- Editor sends `useAdeDir: true` by default in Studio too (flag unused there, Switch hidden).
- Mock fixtures of both apps' Automations UI specs gained the new schema fields (`useAdeDir`, run task fields, `needs`, `ade`, dir `branch/pending`).

## Checks

- gofmt, `go vet`, golangci-lint (changed packages, realclaude tag), `bun run typecheck`, `bun run lint`, `bun run lint:dead`: clean.
- `go test ./internal/...`: green. Studio UI 366 pass. e2e-real: Space 30, Studio 24 pass. `test:flows:space`, `test:flows:studio`: green, coverage gate green.
- Space UI 354 tests: green (`repo-review-interaction` 600-commit case failed once under load, passes alone). Space visual 8 pass.
- Real claude (haiku): `TestSmartScriptRun` both apps, `TestAdeHeadlessRun`, `TestAdeStageSession`, `TestAdeRebaseRun`, `TestRealClaudeSettingsUntouched` PASS. Smart in worktree 0.0014 USD.
- Checklist greps: VarText hits RunPreview, RunScriptDialog, AdeContextFields, AdeStepCard, AdeRunDialog; `error_max_budget_usd` only in `result.go`, fakes, tests and pre-existing `internal/memory`; no credential reads in the diff; no dependency file changed.

## Not done

- Complete flow suites (`:complete`) not run.
- `TestRebaseRun/an approved step waits for a running rebase` once failed (20 s) under parallel load; passes alone and on rerun.
