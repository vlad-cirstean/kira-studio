# P241 result

Plan: `P241-plan-iter2.md`. Branch `p241-I`, base `v2.0`. Not pushed.

## Delivered

Backend (`apps/kira-space/internal`):
- Migrations and model: branch `base`, `base_branch_id`, `base_pending_from`; `ade_runs.purpose='rebase'`;
  `model.AdeRunOutcome` (outcome + `Report` + `Rebase` facts).
- `ade`: base resolve/validate (remote first, cycle refusal), `RepoBranches`, `SetBranchBase`,
  `RebasePreview`, `Rebase`, `AbortRebase`, `decideRebaseOutcome`, restack order, per-task mutex, recovery.
- `adeagent`: `finish_step` carries `reason`, `conflictedFiles`, `lastGitError`, `tried`; `run_outcome` tool.
- `agentnotify`: `Rebase <verdict> · <task>` title, reason body.
- `gitsession.BranchInventory`: keeps the worktree of a branch mid-rebase.
- `flowharness`: `Deps.RebaseTimeout`.

Frontend (`ade/v2`): `AdeBasePicker`, `board/rebaseActions.ts` (one rule for tag action, panel header, fix
menu, task menu, card button), `board/changeBase.ts`, `AdeAbortRebaseDialog`, `panel/AdeRunOutcome` (branch
panel `Last rebase` and a failed step's report in the stage block), Needs you kind `rebase`, base marker
with pending state, headless Rebase dialog (preview prompt, read-only suffix, Autostash, Run in background).

Tests:
- `flows/adeflow/rebase_test.go` `TestRebaseRun` (15 subtests), `base_test.go` (picker subtest added).
- `tests/ui/ade-v2-base-rebase.spec.ts` (16), edits to `ade-v2-dialogs`, `-add`, `-panel`, `-plan`.
- `tests/e2e-real/ade-rebase-real.spec.ts` (3), `realclaude/ade_test.go` `TestAdeRebaseRun` (2).
- Unit: `ade-v2-dialog.spec.ts` (rebase template cases dropped), `ade-v2-board-parity.spec.ts` (labels as parts).

## Deviations

- Plan case "stacked draft parents": impossible (a draft cannot parent); stack case runs on created branches.
- Plan case 9 reduced to last-finish-wins; the released-config call from a second process is not tested.
- Timeout case uses `Deps.RebaseTimeout` set by the harness, not an app setting.
- `golangci-lint` unusable in this container (Go version below its minimum); `gofmt` and `go vet` used.
- Two bugs found by the flow tests and fixed: worktree missing from `BranchInventory` mid-rebase (broke
  Abort and `rebaseInProgress`), and `run_outcome` output failing schema validation (`RawMessage`; now `any`).
- UI spec has 16 tests (plan 14): plus the step report and an extra dialog case.
- e2e-real: plan cases 1 and 2 are two tests (start on develop; Change base to main).

## Checks

All hooks green on every commit, no `--no-verify`.

- `bun run test:flows:space`: pass (coverage gate included, `exempt.txt` untouched).
- Go unit `ade`, `adeagent`, `gitsession`, `bridge/...`: pass.
- `bun run test:unit`: 1825 pass.
- Full Space UI (`test:ui:space`): 337 pass. First full run had 8 failures: 6 outdated assertions fixed in
  this phase and one `repo-review-interaction` flake that passed on rerun.
- Space visual: 8 pass.
- e2e-real `ade-*`: 8 pass (3 new).
- Real claude (`TestAdeHeadlessRun|TestAdeStageSession|TestAdeRebaseRun`): pass, spend 0.0268 USD.
  Rebase clean and one-line conflict both ended `done`, `Verified`.
- Real claude `TestRealClaudeSettingsUntouched`: pass, spend 0.0018 USD.

## Not run

- Full e2e-real project (only `ade-*` and the new spec).
- Mobile UI projects, Studio suites.
- `test:flows:space:complete`.
