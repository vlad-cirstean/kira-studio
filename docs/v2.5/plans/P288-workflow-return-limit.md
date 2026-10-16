# P288 plan: Workflow step returns and single-surface step editing

Ask (SPEC row P288): a failed step can return to an earlier step. Add a per-step maximum of returns, set in
the workflow editor, stored in the workflow definition, backwards compatible (missing value takes the
default). Defaults: automatic step 3, interactive step 0 (no limit). At the maximum the run stops failed with
an English message naming the step and the limit (catalog key if the UI shows it). Counter per run per step,
survives restart and Resume (P279), shown in the run view. Editor: drop the toolbar row above the flow
graph; add, remove, edit, rearrange and return limit live on the graph/step editing surface. Tests split at
the IPC boundary; affected UI specs and sandbox-recorded visual baselines updated.

Base: `831e02af7` (origin/v2.0). Builds on P279 (resume), P286 (review step), P287 (sandbox section in the
step inspector; nothing on the toolbar).

Discovery: `codegraph_explore` over `apps/kira-space` (`adeflow/{parse,writer}.go`, `adewire/{results,wire}.go`,
`ade/{steps,route,runs,board,taskwf,reviewstep}.go`, `repos/adetask.go`, `ade/v2/board/{workflowGraph,
stepResults,stageBlocks,progress,workflowForm}.ts`, `ade/v2/workflows/*.vue`, `ade/v2/state/adeWorkflowDraft.ts`,
`ade/v2/panel/{AdeStageBlock,AdeRunOutcome}.vue`). Query ran against the main checkout's `apps/kira-space`
index, same commit as base.

## 0. How returns work today

- Schema. An agent-stage step has `results:` (1 to 12) or a legacy `on_failure` (`stop | retry 1 | retry 2 |
  back:<earlier step>`). Each result has `next` (`next | end | stop | <step id>`) and `max`. A route to the
  step itself or an earlier step is a loop; parser `resolveRoutes` sets `loop = target <= si`, `loopMax`
  fills `max` (declared 1..10, default `adewire.DefaultLoopMax = 3`; `max` on a forward route is an error).
  `adewire.ImplicitResults` turns `on_failure` into `done`/`failed` results (`retry N` = `failed` → self,
  max N; `back:x` = `failed` → x, max 3). `LegacyOnFailure` reduces results back to `on_failure` so the
  writer keeps old files byte-identical. Writer `applyResult` writes `max` only when not 0 and not 3.
- Script stage: one step (`stageSteps`), stage-level `on_failure` `stop | retry 1 | retry 2`, no `back:`.
- User stage: no steps, no results; nothing routes.
- Engine. `recordOutcomeLocked` → `decideRoute` (`ade/route.go`): `resultFor` picks the result (reported id,
  else `done`/`failed`). `next`/`end`/forward id → run `done` with the route; `stop` → run `failed`; a loop →
  `decideLoop`. `decideLoop` counts `loopsSpent(run, res.ID)`: `back` rows of the same (task, stage, step,
  branch) that reported the same result id. Over `res.Max` → run `failed`, route `stop`, note
  `<reason> (sent back N times)` or `(retried N times)`. Else run state `back`, note `retry n of N` or
  `<reason> → back to <step> (n of N)`, and a `pendingLoop` queues the target: self = new attempt; earlier
  step = new attempt with `Loops` = next stage round, resuming the target's Claude session with
  `AdeSendBackLine`. `chainRerun` later reruns stale downstream steps (not returns).
- Budget is per result edge, counted from durable `ade_runs` rows, never reset (stage revisit keeps runs).
- P286 review step: `FinishReview` routes the chosen result through `recordOutcomeLocked`; a not-ok result
  routed back uses `decideLoop` with the edge `max` (default 3). Review rounds (`purpose = review`) are
  `noAdvance` and never route or count. P286 §1.15 fixed review steps as interactive, limit default 0.
- P279: `RecoverRunning` marks live runs `stuck` (keeps `launch_resume_id`); `ResumeRun` queues a new
  attempt with `runOpts{Loops}`; `back` rows are never rewritten. Retry likewise adds an attempt.
- Editor. `AdeWorkflowGraph.vue`: save bar, name + Space-tools row, then the toolbar row
  `ade-wf-strip-row` (stage chips: select, drag reorder via `useSortableReorder`; `Add stage`), then the
  canvas/inspector split. Add step: `AdeStageInspector` button `ade-wf-add-step`. Remove step:
  `AdeStepInspector` button and Delete key (confirm). Make start: inspector. Skip/Remove stage: stage
  inspector dropdown. Step order: routes plus Make start (`normalizeOrder`). Per-result `max` input in
  `AdeStepResults.vue` (`ade-wf-result-max`); loop edge label `↩ ≤max`. TS draft uses `max > 0` as the loop
  marker (`reclassify`, `reaches`, `normalizeOrder`, `setRoute`).
- Run view: `stageBlocks.ts` `routeText` (`changes ↩ Implement (max 3)`), run line note, `fixRound`
  (`Fix round n of max` from `backMax`); `AdeRunOutcome` shows `↩ <note>` for a back route.

## 1. Decisions (final)

1. **Per-step `max_returns` replaces per-result `max`.** Why: SPEC asks per step; two budgets conflict
   (review 0 vs edge 3) and double the editor fields.
2. **A return is any result routed to the step itself or an earlier step** (retry and send-back). Why: one
   mechanism (`decideLoop`) and the same runaway risk.
3. **Defaults: prompt and smart-script steps 3; review step 0 (no limit); script stage = its `retry N`.**
   Why: SPEC; P286 §1.15; a script stage already states its N and has no other loop.
4. **Range: automatic steps 1 to 10; review steps 0 to 10.** Why: 0 means a human drives; an unattended
   agent loop without a limit spends without bound; 10 is today's cap.
5. **Counter per (task, stage, step, branch), derived from `ade_runs` rows in state `back` with
   `purpose = ''`, any result.** No new column, never reset (stage revisit, Retry, Resume keep it). Why: rows
   already persist across restart and P279 Resume (Resume adds an attempt, never rewrites `back` rows); a
   derived value cannot drift; same reset rule as today. A user Retry after the stop reruns the step once;
   its next failure stops again without a return: the stop means "a human looks now".
6. **No SQL migration.** Workflow YAML: missing `max_returns` takes the default; legacy `on_failure:
   retry N` gives N; legacy result `max` on loop routes (no `max_returns`) folds to the largest declared.
   Task snapshots (`ade_tasks.workflow_json`, `current_stage_json`) missing the field get the same rule on
   decode (`retry N` from `onFailure`, else the default). Why: SPEC "missing takes the default"; explicit
   legacy values stay honored where still readable; a snapshot's old result `max` is not (in-flight tasks
   only, default 3 applies).
7. **One spelling per fact.** `max_returns` with `on_failure` is refused; `max_returns` with a result `max`
   is refused. Writer never writes result `max`; writes `max_returns` only when it differs from the
   implied value (`retry N` → N, else the default by step kind); writes `on_failure` only when results
   reduce to it and the limit equals its implied value. Why: old files save byte-identical unless edited.
8. **Wire: `StepResult.max` becomes `loop: boolean`; `PipelineStep.maxReturns: number`; `Run.returns:
   number`.** Parser sets `loop`; the editor draft keeps it as its loop marker; writer and engine ignore it
   (engine uses step order). Why: the TS draft needs a loop marker (`max > 0` today); a boolean keeps that
   role without a budget.
9. **Stop message: catalog key `backend.space.ade.returnLimit.body`, English
   `Stopped: {step} reached its limit of {limit} returns.`**, rendered in Go (`i18n.T`) into run `note` and
   `outcome.reason`; run `failed`, route `stop`, `summary` keeps the agent's text. Why: the run line and
   outcome show the note; P286 renders catalog notes in Go the same way.
10. **Run view: run-line chip `↩ 2/3` (`↩ 2` with no limit), tooltip `Returned 2 of 3 times` /
    `Returned 2 times, no limit`**, from `Run.returns` and the step's `maxReturns`. `routeText` drops
    `(max N)`; `fixRound` takes the largest limit of the steps that route back to the step. Why: the counter
    is per branch run, and the run line is per branch.
11. **"Toolbar row" = `ade-wf-strip-row`** (stage chips + Add stage). Removed. Save bar and the name /
    Space-tools row stay. Why: those hold workflow fields, not step editing; the strip is the chrome above the
    graph.
12. **One editing surface = canvas + inspector split.** Node menus (shadcn-vue `DropdownMenu`, `⋯` trigger,
    also on right-click) hold structure actions. Step node: Add step after, Make start, Remove (confirm, as
    Delete key). Stage frame: Add step (agent), Add stage after, Move up, Move down, Skip/Unskip, Remove.
    Agent frame header: `+ Step` button. Under the canvas: `+ Add stage`. Inspectors keep fields only plus
    Max returns. Delete key unchanged. Why: actions sit on what they change; layout is locked, so Move
    up/down replaces strip drag.
13. **Max returns field in the step inspector's top field row, after Timeout, always shown**, shadcn-vue
    `Input type="number"` (min 1 or 0 for review, max 10), hint names the 0 rule for review steps. Step node
    shows `↩ ≤N` (or `↩ no limit`) when the step has a loop route. Switching mode to Review sets 0 when the
    value is still 3; leaving Review sets 3 when it is 0. Why: one place to set it; the node shows it where
    loop edges start.
14. **No new LLM prompt.** `budget.tsv` untouched; P289 sweep gets nothing from P288. `AdeSendBackLine`
    unchanged.
15. **No new real `claude` test.** The limit lives in the engine; fakeagent covers it. Run the existing ADE
    row once at the end (`ade`, `adeflow` changed). Why: `docs/DEV_ENVIRONMENT.md` area rule; real tokens add
    no coverage here.
16. **Libraries:** shadcn-vue `DropdownMenu`, `Input`, `Button`; Pinia draft store; no new dependency.
    `useSortableReorder` leaves the graph (no stage drag on a locked layout).
17. **Tasks started before P288 show the "workflow updated" badge once.** `decorateTask` compares the stored
    snapshot hash with a hash of the live workflow's JSON, which gains `maxReturns` and `loop`. Accepted, as
    for P286/P287 field additions. Why: the badge is informational; hashing a normalized form costs code for
    a one-time effect.

## 2. Schema and parser (`internal/adeflow`, `internal/bridge/adewire`)

YAML (agent-stage step):

```yaml
- id: test
  name: Test
  runs_on: each repo
  results:
    - { id: passed, ok: true }
    - { id: failed, ok: false, next: implement }
  max_returns: 2      # prompt/smart 1..10, default 3; review 0..10, default 0 (0 = no limit)
  timeout: 30m
```

- `adewire/results.go`: rename constants `DefaultLoopMax` → `DefaultMaxReturns = 3`, `MaxLoopMax` →
  `MaxMaxReturns = 10`. `StepResult`: drop `Max`, add `Loop bool \`json:"loop"\``. `ImplicitResults` sets
  `Loop` on the `retry`/`back:` route. New `LegacyLimit(onFailure string, review bool) int` (`retry N` → N,
  else `DefaultLimit(review)`), `DefaultLimit(review bool) int` (0 / 3). `LegacyOnFailure(stepID, results,
  earlier, maxReturns, review)` reduces only when `maxReturns == LegacyLimit(rule, review)`.
- `adewire/wire.go`: `PipelineStep.MaxReturns int \`json:"maxReturns"\``. `(*Stage).FillReturnLimits()`:
  per step with `MaxReturns == 0` and `Review == nil` → `LegacyLimit(OnFailure, false)`. Idempotent; a review
  step keeps 0. `Run.Returns int \`json:"returns"\``.
- `parse.go` `steps`: `max_returns` added to the step field list. Read after results/on_failure:
  - present with `on_failure` → `max_returns and on_failure cannot be used together; use results`.
  - present: whole number, 1..10 (0..10 on a review step) → else
    `max_returns must be a whole number from 1 to 10` / `from 0 to 10 on a review step`.
  - absent: legacy result `max` fold (below), else `LegacyLimit(on_failure, review)`.
  `loopMax` becomes `legacyMax`: result `max` only on a loop route (existing error kept); a value 1..10;
  with step `max_returns` present → `max moved to max_returns on the step; remove it`. The largest legacy
  value becomes `MaxReturns`. `resolveRoutes` sets `r.Loop`; review steps are parsed before
  `resolveRoutes`, so the review flag is known.
- `writer.go`: `stepOrder` gains `max_returns` after `results`. `applyStep` writes it when
  `MaxReturns != implied` (implied = `LegacyLimit(OnFailure written, review)` when `on_failure` is written,
  else `DefaultLimit(review)`), else drops it. `applyResult` always drops `max`; `resultOrder` loses it.
  `applyResults` passes `MaxReturns`/review to `LegacyOnFailure`.
- Tests (`adeflow_test.go`, `writer_test.go`; parser with interacting rules, `CLAUDE.md` bar): default 3,
  review default 0, review 0 allowed, agent 0 refused, 11 refused, `max_returns` + `on_failure` refused,
  `max_returns` + result `max` refused, legacy result `max: 5` folds to 5, two legacy values fold to the
  largest, `retry 2` gives 2, round-trip: unchanged legacy file byte-identical, `max_returns: 5` written,
  result `max` dropped on save, `on_failure: back:x` with limit 4 saves as `results` + `max_returns: 4`.

## 3. Engine (`internal/ade`)

- `steps.go`: `stepDef` gains `ReturnLimit int` (0 = no limit). Agent step: `s.MaxReturns` after
  `FillReturnLimits`; script stage: `LegacyLimit(onFailure, false)`.
- Snapshot decode: call `FillReturnLimits` at the four sites that unmarshal a stage or workflow snapshot:
  `board.go` `toWireTask` (`CurrentStageJSON`), `runs.go` `loadTaskCtx` (`CurrentStageJSON`), `taskwf.go`
  `taskWorkflow` and `decorateTask` (`WorkflowJSON`).
- `route.go`: `loopsSpent` → `returnsSpent(run)`: `back` rows, `purpose = ''`, same (stage, step, branch),
  any result. Pure helper `countReturns(runs []model.AdeRun, stage, step, branch string, upTo int) int`
  (attempt ≤ `upTo`) shared with the wire mapper. `decideLoop`:
  - `limit := plan[idx].Def.ReturnLimit`; `round := spent + 1`.
  - `limit > 0 && round > limit` → `stopped(out)`, `note = i18n.T("backend.space.ade.returnLimit.body",
    {step: def.Name, limit})`, `out.out.Reason = note`.
  - Notes: self `retry n of N` (`retry n` when no limit); back `<reason> → back to <step> (n of N)`
    (`(n)` when no limit).
  - Rest unchanged (resume target session, `AdeSendBackLine`, `Loops`).
- `board.go` `toWireTask`: `Run.Returns = countReturns(runs, r.StageID, r.StepID, r.BranchID, r.Attempt)`
  for `purpose = ''` runs (0 otherwise). One pass over the task's runs.
- Review step: `FinishReview` path unchanged; limit 0 never stops. Rounds never count (purpose).
- Rebase, `chainRerun`, `Loops`, `RetryRun`, `ResumeRun`: unchanged.
- Catalog `packages/theme/src/i18n/en.json`: `backend.space.ade.returnLimit.body`.
- `runengine_wave4_test.go`: update the spent-budget note assertion to the catalog text.

## 4. Frontend model (`apps/kira-space/frontend/src/ade/v2`)

- `wire.ts`: `StepResult.loop: boolean` (drop `max`), `PipelineStep.maxReturns: number`, `Run.returns:
  number`; doc comments updated.
- `board/stepResults.ts`: `DEFAULT_MAX_RETURNS = 3`, `MAX_RETURNS = 10`, `defaultMaxReturns(review)`;
  `implicitResults` sets `loop`; `reviewDefaultResults` `loop: false`.
- `board/workflowGraph.ts`: every `max > 0` / `max = …` loop-marker use becomes `loop`
  (`reclassify`, `reaches`, `normalizeOrder`, `setRoute`, `clearRoute`, `removeStep`, `addResult`);
  `clampMax` and `patchResult`'s `max` go; `GraphEdge.max` goes. Header comment line 8 updated.
- `board/workflowForm.ts` `newStep`: `maxReturns: 3`. Review mode switch per §1.13 (in
  `AdeStepInspector.setMode`).
- `state/adeWorkflowDraft.ts`: `createStage(afterStageId?)` inserts after; `moveStageBy(stageId, delta)`
  over `moveStage`; `patchStep` carries `maxReturns` (clamped in the inspector handler).
- Unit specs `tests/unit/ade-v2-workflow-graph.spec.ts`, `ade-v2-progress.spec.ts`,
  `ade-v2-board-parity.spec.ts`: fixtures `max` → `loop`, add `maxReturns`.

## 5. Single editing surface (`ade/v2/workflows`)

- `AdeWorkflowGraph.vue`: delete `ade-wf-strip-row` (chips, Add stage), `strip`, `KIND_TONE`,
  `stripEl`/`useSortableReorder`. Add under the canvas, inside the scroller after VueFlow, a dashed
  `+ Add stage` button (`ade-wf-add-stage`, reuses `space.ade.workflows.graph.addStage.label`). Move the
  remove-step confirm into `workflows/useStepRemoval.ts` (`confirmRemoveStep(stageId, stepId)`), used by
  the Delete shortcut and the node menu.
- `AdeStepNode.vue`: header gets a `⋯` `DropdownMenu` trigger (`ade-wf-step-menu`, classes `nodrag nopan`,
  `@click.stop`), right-click opens it. Items: Add step after (`ade-wf-step-add-after`, `createStep(stageId,
  stepId)`), Make start (`ade-wf-step-start`, disabled on the start step), Remove (`ade-wf-step-remove`,
  `text-error`, confirm). Returns chip (`ade-wf-node-returns`) when a result has `loop`: `↩ ≤N` or
  `↩ no limit`. Node stays `256x104`.
- `AdeStageGroupNode.vue`: `⋯` menu (`ade-wf-stage-menu`, per frame) with Add step (agent,
  `ade-wf-stage-add-step`), Add stage after (`ade-wf-stage-add-after`), Move up (`ade-wf-stage-up`,
  disabled first), Move down (`ade-wf-stage-down`, disabled last), Skip/Unskip (`ade-wf-stage-skip`, rule
  `canSkip` as today), Remove (`ade-wf-stage-remove`). Agent frame header: `+ Step` button
  (`ade-wf-add-step`, `data-stage-id`).
- `AdeStageInspector.vue`: drop its dropdown and the Add step button; fields only.
- `AdeStepInspector.vue`: drop Make start and Remove buttons; add Max returns (`ade-wf-step-max-returns`,
  label `space.ade.workflows.stepInspector.maxReturns.label`, hint
  `…maxReturns.hint`). P287 Sandbox and P286 Review sections unchanged.
- `AdeStepResults.vue`: drop the per-result max input. `AdeResultEdge.vue`: label `results ↩` without
  `≤max`. `AdeWorkflowGraph.vue` edge data drops `max`.
- Styling: Tailwind utilities, no scoped `<style>`; `<script setup lang="ts">` only.
- Catalog: add `space.ade.workflows.stepInspector.maxReturns.{label,hint}`
  (`Max returns`, `Times a failure may send the run back. Review steps: 0 = no limit.`),
  `space.ade.workflows.stepNode.returns.label` (`↩ ≤{limit}`), `…stepNode.returnsUnlimited.label`
  (`↩ no limit`), `space.ade.workflows.graph.stepMenu.aria`, `…graph.stageMenu.aria`,
  `…graph.addStepAfter.label`, `…graph.addStageAfter.label`, `…graph.moveUp.label`,
  `…graph.moveDown.label`. Reuse existing add step, make start, skip, remove keys. Remove
  `space.ade.workflows.results.max.label`, `space.ade.workflows.stageInspector.actions.aria` and any key
  left unused (copy-coverage catches leftovers).

## 6. Run view (`board/stageBlocks.ts`, `panel/AdeStageBlock.vue`)

- `RunLine.returns: string` and `returnsTip: string`: from `run.returns` and the step's `maxReturns`
  (§1.10); '' when `returns == 0`. `StepRun` (progress.ts) carries `returns`.
- `AdeStageBlock.vue`: chip `ade-run-returns` before the note, `AdeTip` with the tooltip; red tone when
  the run is `failed` with route `stop` and `returns >= maxReturns > 0`, else amber.
- `routeText`: `routeBack`/`routeRetry` labels lose `(max {max})`; loop detection by step index (snapshots
  may lack `loop`). `backMax` → `backLimit`: largest `maxReturns` of steps routing back to the step.
- Catalog: `space.ade.stage.returns.{label,tooltip}` (`↩ {count}/{limit}`, `Returned {count} of {limit}
  times`), `space.ade.stage.returnsUnlimited.{label,tooltip}` (`↩ {count}`, `Returned {count} times, no
  limit`); edit `routeBack.label` → `{id} ↩ {step}`, `routeRetry.label` → `{id} ↻ retry`.
- Mobile renders no run lines: compile fixes only.

## 7. Tests (split at the IPC boundary)

| Scenario | Go flow (fakeagent, new `internal/flows/adeflow/returnlimit_test.go` `TestReturnLimit`) | UI spec (new `tests/ui/ade-v2-return-limit.spec.ts`, `contract:` cases) |
|---|---|---|
| Stop at limit | impl → test (`max_returns: 2`, `failed` → impl); test fails 3 times: runs `back` (returns 1, note `(1 of 2)`), `back` (2), `failed` route `stop`, note = catalog text with `test` and `2`, `returns` 2. Contract `ade-return-limit#back`, `#stopped` | run line shows `↩ 1/2`; `#stopped`: failed run, note text, red chip `↩ 2/2`, Retry button |
| Restart and Resume | `max_returns: 2`; one return; impl attempt holds on `waitFile`; `app.Restart()`; impl `stuck` resumable; `ResumeRun`; done; test fails → `(2 of 2)`; next failure stops. Counter survives both | — (Resume UI covered by P279 spec) |
| Review no limit | implement → review step (P286, no `max_returns`), `rework` → implement; `FinishReview rework` 4 times: every one loops back, no stop, `returns` 4. Contract `#review` | `↩ 4` chip, tooltip "no limit" |
| Default and legacy | file without `max_returns`: stops after 3 with limit 3 in the note | — |
| Editor round-trip | `SaveWorkflow` with `maxReturns: 5` on an agent step and 0 on a review step; file has `max_returns: 5`, none on review; `Workflows` returns both. Contract `#workflow` | inspector shows 5; edit to 4 → Save payload `maxReturns: 4`; review mode allows 0, agent min 1; node chip `↩ ≤4` |

Updated Go tests (IPC shape changes): `branching_test.go` (`reviewResults` writes `max_returns`; spent note
asserts the catalog text; results literal `Max` → step `MaxReturns`), `adeflow` parser/writer tests (§2),
`runengine_wave4_test.go`. `reviewstep_test.go` fixture `max: 2` stays (legacy fold covers it).

Contracts: regenerate every fixture the `internal/flows/adeflow` (and mobile) flow tests write
(`KIRA_CONTRACT=write go test -p 2 ./internal/flows/adeflow ./internal/flows/...`); expected diff only
`max` → `loop`, `maxReturns`, `returns`. Known: `ade-branching`, `ade-review-step`,
`ade-workflow-results`, plus run-carrying ones (`ade-run`, `ade-resume`, `ade-base`, `ade-run-errors`,
`ade-sandbox`, `mobile-board`). New: `ade-return-limit.json`.

Updated UI specs:
- `ade-v2-workflows.spec.ts`: stage select by clicking the stage frame (not strip chip); add step via
  `ade-wf-add-step` on the frame; stage reorder via Move up/down menu (replaces chip drag at line ~268);
  skip/remove through the frame menu; Make start/Remove through the step menu; result max cases (lines
  ~176, ~207) become step Max returns; strip-row absence asserted once.
- `ade-v2-workflow-layout.spec.ts` (lines ~112-113), `ade-v2-sandbox.spec.ts` (~132),
  `copy-coverage.spec.ts` (~105): strip chip → stage frame click.
- Visual (re-record in the sandbox per `docs/DEV_ENVIRONMENT.md`, Linux only; macOS not recorded):
  `ade-workflow-graph.spec.ts` `workflow-graph-visual`, `workflow-graph-branches-visual`;
  `ade-review-step.spec.ts` `workflow-graph-review-visual`. Strip row gone, node menu triggers, `+ Step`,
  `+ Add stage`, edge labels without `≤N`, returns chips. No new baseline.

Real `claude`: ADE row once after test-and-fix (`bun run test:claude:space -run 'TestAdeHeadlessRun|
TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestAdeResumeRun|TestAdeResumeLost|
TestAdeReviewStep|TestAdeReviewLost|TestAdeSandbox|TestAdeSandboxReadOnly' -count=1`); report spend.

## 8. Docs

- Site `site/src/content/docs/docs/space/agents.mdx` (terse, P284 rule): Workflows: replace "A loop edge has
  a `max` from 1 to 10" with `max_returns` (what counts as a return, defaults 3 / review 0, range, legacy
  `max` and `retry N`, stop message); editing paragraph: canvas menus, `+ Step`, `+ Add stage`, Move up/down,
  inspector fields; Runs: the `↩ n/N` chip. `bun run lint` and `site:check` green.
- `docs/ARCHITECTURE.md` Workflows: Step results bullet (`max` → `loop` on wire, step `max_returns`, fold
  and refusals, writer rule); Graph editor bullet (strip removed; node menus; "Stages reorder by dragging the
  stage strip" → Move up/down); new bullet "Return limit (P288)": counter from `back` rows, `countReturns`,
  `FillReturnLimits` on snapshot decode, catalog note, `Run.returns`. Known open items: none expected.
- `docs/DEV_ENVIRONMENT.md`: no change (ADE row already covers `ade`/`adeflow`).

## 9. Execution (one sequential Sonnet implementer)

No streams: schema, engine, wire and UI depend on each other in order. Each commit passes the normal hook
(typecheck, lint incl. `checkprompts`, build). Resume after interruption: `git log --oneline
831e02af7..`; continue at the first missing commit.

1. `feat(adeflow): per-step max_returns in workflow schema` (§2; Go wire; Go test compile fixes).
2. `feat(ade): per-step return limit and counter` (§3; catalog key; wave4 test).
3. `feat(space): return limit in workflow model and inspector` (§4; §5 inspector field, node chip, edge
   label, results max removal; unit specs).
4. `feat(space): single-surface step editing` (§5 strip removal, node and frame menus, `+ Step`,
   `+ Add stage`, inspector buttons out, catalog keys).
5. `feat(space): return counter in run view` (§6).
6. `test(ade): return limit flow tests and contracts` (§7 Go rows, branching updates, contract regen).
7. `test(space): return limit UI spec, editor specs and visual baselines` (§7 UI rows, re-record 3).
8. Full test pass once: Go `-race` on `ade`, `adeflow`, `flows/adeflow`; UI and visual suites; fixes as
   `fix:` commits.
9. `docs: workflow return limit and single-surface editing` (§8).
10. Real `claude` ADE row; fixes as `fix:` commits; report spend.

Out of scope: resetting the counter on Retry; per-result budgets; stage drag-and-drop on the canvas; P289
prompt rewrite; any change to `AdeSendBackLine`.
