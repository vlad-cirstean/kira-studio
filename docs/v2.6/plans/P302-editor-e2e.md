# P302: e2e for P301 editor fixes

Row: `docs/v2.6/SPEC.md` P302. Base: `336eb016b`. Fixes under test: `afb63dde9`.
Two features, each split at IPC boundary: Go flow test asserts result and writes contract keys; UI spec
reads same keys and asserts same result. Existing mechanism only: `flowharness.App.Contract`
(`apps/kira-space/tests/contract/*.json`), `tests/ui/support/contract.ts`, `openWorkflows`, IPC mocks.

## What exists (discovery)

- Parser: `resolveStepRoutes` (`internal/adeflow/parse.go:706`) fails with `next cannot return to a manual
  or skipped step, which never runs`. Implementer check: `reviewConfig` (`parse.go:504`), `implementer must
  be an earlier agent step`. Graph save path `Reader.Save` → `encodeWorkflow` re-parses, so `SaveWorkflow`
  refuses both via `ErrInvalidInput` → `ipcerr.BadRequest` (`bridge/adetask.go:110`).
- Flow helpers (`internal/flows/adeflow/helpers_test.go`): `flowharness.New`, `saveWorkflow`, `flowYAML`,
  `agentStep`. Error-as-contract pattern: `resume_test.go:79` stores `err.Error()`; UI parses it
  (`ade-v2-resume.spec.ts:81`). Structured-save pattern: `branching_test.go:191-222`.
- Fresh harness has no workflows; `Workflows()` lists only what the test saved.
- UI: `ade-v2-workflows.spec.ts` owns local helpers `t`, `node`, `menuItem`, `saved`, `openYaml`,
  `stepOf`. Fixture `standard.yaml`: `spec`(manual) `plan` `impl` `tests` `ci` `pr` `review`(manual)
  `release`; `tests.failed → impl` loop. No review-kind step in any fixture.
- Smart script fixture `SCRIPTS`/`SMART`/`script()` are local to `ade-v2-automations.spec.ts:17-45`.
- Every test id needed exists: `ade-wf-node[data-step-id]`, `ade-wf-step-menu`, `ade-wf-step-skip`,
  `ade-wf-step-up`, `ade-wf-step-remove`, `confirm-dialog-confirm`, `ade-wf-result[data-result]`,
  `ade-wf-result-route`, `ade-wf-step-kind-manual`, `ade-wf-step-mode-smart`,
  `ade-wf-step-review-implementer`, `ade-wf-save`, `ade-wf-save-error`, `ade-wf-yaml`, `ade-wf-yaml-msg`.
  **No `data-testid` to add; no Vue change.**

## Feature 1 (finding 1.1): return route to a step that never runs

Backend: new `internal/flows/adeflow/workflow_editor_test.go`, `TestWorkflowReturnToStepThatNeverRuns`,
contract scenario `ade-workflow-editor`. Two subtests, no overlap with parser row (that one: `Parse` direct,
manual target):
1. `yaml return to a manual step`: `ValidateWorkflowYaml` on `flowYAML` with `manual m`, then agent `s`
   whose `failed` result has `next: m`. Assert `Error != nil`, `Workflow == nil`, `Line` = line of the
   `next: m` node (count it in the literal), message contains `cannot return to a manual or skipped step`.
   Contract `AdeTaskService.ValidateWorkflowYaml#return-to-manual` (the validation value).
2. `graph save return to a skipped step`: `saveWorkflow` agent `plan`, agent `impl` (`skip: true`), agent
   `tests`. Read entry via `Workflows()`; set `tests` result `failed` to `Next: "impl", Loop: true`;
   `SaveWorkflow` with entry hash. Assert `*ipcerr.Error` code is bad-request, message contains same text,
   and `WorkflowYaml` hash unchanged (file untouched). Contract `AdeTaskService.SaveWorkflow#return-to-skipped`
   as `err.Error()`.

UI: append to `tests/ui/ade-v2-workflows.spec.ts` (reuses its helpers):
- `contract: the route select hides manual and skipped steps up to this one, keeping the current pick`.
  `openWorkflows(relaunch, [{ channel: IPC.adeTaskSaveWorkflow, error: <parsed contract> }])`. Skip `impl`
  and `plan` via `menuItem(..., 'ade-wf-step-skip')`. Click `tests`; on its `failed` row route select:
  `toHaveValue('impl')`; `option[value="impl"]` count 1 (current pick kept); `spec` and `plan` count 0;
  `review` (manual, after `tests`) and `tests` (this step) count 1. Click Save; `ade-wf-save-error`
  contains contract message. Same result as backend 2: loop to skipped step refused, text shown.
- `contract: a YAML return to a manual step shows the parser error`. Mock
  `IPC.adeTaskValidateWorkflowYaml` with contract value; `openYaml`; fill any text; `ade-wf-yaml-msg`
  equals `✕ Line ${line}: ${message} (the last valid version stays in use)` (format from existing
  `an invalid YAML shows its line` test).

## Feature 2 (finding 1.2): stale `review.implementer` cleared

Base workflow `editor` (YAML literal in test): agent `plan`, agent `impl`, review `review`
(`review: {send_to: implementer, implementer: impl}`, results `approved` ok→next, `rejected` not ok→stop;
no loop, so feature 1 never interferes), agent `verify`.

Backend: same file, `TestWorkflowEditorClearsStaleImplementer`. `saveWorkflow` base; contract
`AdeTaskService.Workflows` (whole result: UI boot input). Table of 4 edits applied to a copy of
`entry.Workflow`, each re-saving the base YAML first so cases stay independent:
`remove impl`; `move review above impl` (order plan, review, impl, verify); `impl kind manual` (mirror
frontend `withKind`: drop agent-only fields and results, as the UI sends); `impl smart script`
(`SmartScript: "Review diff"`, `Prompt: ""`, `AllowedTools: nil`; parser does not check script exists).
Per edit: `SaveWorkflow` keeping `Implementer: "impl"` refused, message contains
`implementer must be an earlier agent step`; same edit with `Implementer: ""` succeeds, re-read
`Workflows()` shows review `Implementer == ""`. Contract one accepted entry
`AdeTaskService.SaveWorkflow#cleared` (remove case) as UI save response.

UI: append to `ade-v2-workflows.spec.ts`, one `for` loop over 4 named edits generating
`contract: <edit> clears the review implementer and the save goes through`. Boot:
`openWorkflows(relaunch, [{adeTaskWorkflows: contract Workflows}, {adeTaskSaveWorkflow: contract
#cleared}, SCRIPTS])`. Click `review`: implementer select `toHaveValue('impl')`. Edit:
remove → `menuItem(page,'impl','ade-wf-step-remove')` + confirm; move → `menuItem(page,'review','ade-wf-step-up')`;
kind → click `impl`, `ade-wf-step-kind-manual`, confirm; smart → click `impl`, `ade-wf-step-mode-smart`.
Click `review`: select `toHaveValue('')`. `saved(page, control, 1)`: `stepOf(out,'review').review` equals
`{ sendTo: 'implementer', implementer: '' }`; `ade-wf-save-error` count 0. Same result as backend: `''`
is what the editor sends and what the save accepts.

Fixtures needed: only the new contract keys plus `SCRIPTS`. Move `script`, `SMART`, `PLAIN`, `SCRIPTS`
from `ade-v2-automations.spec.ts` into `tests/ui/support/adeV2.ts` (exported), import in both specs. No
change to `tests/fixtures/ade-v2/*.json`.

## Test bar

User asked for these e2e (SPEC row, decisions final); new-feature split rule applies. Minimal: 2 Go tests
(2 + 4 subcases), 6 UI tests. Parser unit row stays as is; flow tests go through the service, cover the
skipped target and the graph path it lacks.

## Run, cost, risk

- Write contracts (from `apps/kira-space`): `KIRA_CONTRACT=write go test -p 2 ./internal/flows/adeflow
  -run 'TestWorkflowReturnToStepThatNeverRuns|TestWorkflowEditorClearsStaleImplementer'`, then rerun without
  the variable, `-count=2`. Inspect JSON diff for machine paths (harness replaces `<space>` etc.).
- UI: `bun run build:test:space`, then `npx playwright test --config=apps/kira-space/playwright.config.ts
  --project=ui ade-v2-workflows.spec.ts ade-v2-automations.spec.ts`. Cost: Go tests seconds (no agent runs);
  UI ~1 min for two specs. Run one heavy suite at a time.
- Flake: option presence via auto-retrying `toHaveCount`, never a one-shot `evaluateAll`. Kind change asks
  only for a non-empty step (`impl` has a prompt, so confirm is expected). Contract output must be
  deterministic: no timestamps in these values; confirm with `-count=2`.
- Hooks: pre-commit lint/typecheck staged TS and Go; pre-push builds, lints, tests changed Go packages, so
  `internal/flows/adeflow` runs on push. No UI test in hooks. No real-`claude` row (no Claude code touched).

## Commits (one sequential Sonnet implementer)

1. `test(ade): flow tests for returns to steps that never run and stale review implementer` — new Go file
   plus written `tests/contract/ade-workflow-editor.json`.
2. `test(ade): share smart script fixtures in ade v2 UI support` — move `SCRIPTS` etc.
3. `test(ade): UI specs for route options and stale implementer` — 6 tests in `ade-v2-workflows.spec.ts`.
4. Fixes from the targeted runs as follow-ups; then `docs(v2.6): P302 result` (fill below, SPEC row Done).

## Result

Done. Commits: `4185dcd86` (flow tests + contract `ade-workflow-editor.json`), `ca2f7d385` (shared smart script
fixtures in `tests/ui/support/adeV2.ts`), `492132a64` (UI specs). No product bug found, no Vue change, no follow-up fix.

Tests added:
- Go `TestWorkflowReturnToStepThatNeverRuns` (2 subtests): YAML return to manual -> parser error with line 19;
  graph `SaveWorkflow` return to skipped step -> bad-request, file hash unchanged.
- Go `TestWorkflowEditorClearsStaleImplementer` (4 subtests: remove, move above, kind manual, smart script): stale
  `Implementer: "impl"` refused with `implementer must be an earlier agent step`; `""` saves and re-reads cleared.
  Manual-kind step built like the frontend `withKind` (agent fields dropped); assumption held.
- UI, 6 tests in `ade-v2-workflows.spec.ts`: route select hides manual/skipped steps up to the step, keeps
  current pick, refused save shows contract message; YAML error line/message shown; 4 edits clear the review
  implementer to `''` and the save goes through (same values as backend).

Runs: contract write, then `-count=2` re-run, pass (6 subtests each run, no machine paths in JSON).
`bun run build:test:space` ok. Playwright `ade-v2-workflows` + `ade-v2-automations`: 50 pass, 1 test-side fix
(trailing `.` in the YAML message), then the 8 `contract:` tests pass. Full `internal/flows/adeflow` and
`internal/adeflow` pass.

Follow-up:
- Biome warning: unused `PLAIN` import in `ade-v2-automations.spec.ts`, from commit 2; removed in `66b93e432`. Biome on `tests/ui` clean.
- Fix reverted (parse.go, `workflowGraph.ts`, `adeWorkflowDraft.ts`, `AdeStepResults.vue` from `afb63dde9`, tree restored, nothing committed). Fail without fix: both Go `TestWorkflowReturnToStepThatNeverRuns` subtests; UI route-select test and all 4 stale-implementer UI tests. Pass without fix: Go `TestWorkflowEditorClearsStaleImplementer` (backend already refused stale implementer; the fix is the editor clearing it) and the UI YAML-error test (mock-driven; the parser guard is the Go contract).
- Full rerun of `ade-v2-workflows` + `ade-v2-automations` after restore and rebuild: 51 passed, 0 failed.
