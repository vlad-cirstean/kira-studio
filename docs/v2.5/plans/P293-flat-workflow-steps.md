# P293 plan: Flat workflow steps and a friendlier step panel

Ask (user, verbatim intent): "Let's make it flat, this is just too complex. Let's call them steps. And make the
right config panel for a step more user friendly. It looks quite odd now." So: a workflow is one list of
steps; the workflow sense of "stage" leaves the product (UI, copy, docs, prompts, tool texts, identifiers, SQL,
workflow files); the step inspector gets a clear, grouped layout.

Second user decision (after the first plan, `e0a30eb3f`): no backwards compatibility, build it from scratch,
there are no users. So no fold of old files, no conversion of stored rows, no prompt override fold, no legacy
spellings. Old `stages` files are refused with a clear error; ADE task data is reset by one migration.

SPEC row P293: flat list of steps, the word "step" only, mapping of every stage concept stated, open questions
decided final with a why, inspector redesign (grouped sections, plain labels, defaults first, advanced
collapsed, shadcn-vue/Tailwind), tests split at the IPC boundary, specs and sandbox baselines updated, real
`claude` ADE row re-run.

Base: `3407b48ad` (origin/v2.0). Implementation runs after P291 and P292 (both review rounds and fixers) land.
The implementer re-reads the tree then: line numbers and migration numbers below are from the base and drift;
names hold. P292 review rounds do not cover P293.

Discovery: `codegraph_explore` over `apps/kira-space` (`adeflow/{parse,writer,reader}.go`,
`adewire/{wire,results}.go`, `ade/{steps,stages,route,runs,launches,taskwf,board,reviewstep,review_agent,
vars,agenttools}.go`, `repos/adetask.go`, `model/adetask.go`, `bridge/{adetask,mobilewrite}.go`,
`mobileweb/{writer,writes,routes}.go`, `ade/v2/board/{progress,stageBlocks,stageMoves,status,actions,menu,
workflowForm,workflowGraph,stepResults}.ts`, `ade/v2/workflows/*.vue`, `ade/v2/panel/{AdeStageBlock,
AdeStageMover}.vue`, `ade/v2/plan/{usePlanModel,AdeTaskCard}`, `ade/v2/run/{useTaskAction,AdeRunDialog}`,
`mobile/state/*`) and the root project (`internal/llmprompts/{registry,store}.go`); reads of migrations
(SQL is not indexed), i18n catalog, docs and visual baselines.

## 0. How it works today (from source)

- Schema (`adeflow/parse.go` `stage`, `steps`). Workflow `id`, `name`, `kira_space_mcp`, `stages`. A stage
  has `id`, `name`, `kind` (`user|manual` → user, `agent|automated` → agent, `script`; `stageKindAlias`),
  `status` (To do, In progress, In review, Done; required), `skip`. User: `session`, `prompt` (only with
  session). Agent: `steps` (non-empty). Script: `command`, `runs_on`, `on_failure` (`stop|retry 1|retry 2`),
  `timeout`. Step ids unique per stage only; a step id may equal a stage id (`testdata/standard.yaml`).
- Agent step: `id`, `name`, `runs_on` (`once | each repo | only <nick>`), `before` (`auto|approval`),
  `results` (1..12, `next`: `next|end|stop|<step id of same stage>`) or `on_failure` (`stop | retry N |
  back:<id>`, via `adewire.ImplicitResults`), `max_returns` (P288: agent 1..10 default 3, review 0..10
  default 0), `timeout`, then one body: `prompt` + `allowed_tools`, `smart_script` + `params`, or a `review`
  block (P286), plus `sandbox` (P287).
- Legacy-only code today (P288 kept it for files from before `results`/`max_returns`): `on_failure` on steps
  and script stages, `ImplicitResults(stepID, onFailure)`, `LegacyLimit`, `LegacyOnFailure` (writer reduces
  results back to `on_failure`), result `max` (`legacyMax` folds it into `max_returns`),
  `Stage.FillReturnLimits`/`Workflow.FillReturnLimits` (snapshots from before `max_returns`, called at every
  decode site), kind aliases `manual`/`automated`. Frontend mirrors: `OnFailure` type, `legacyMaxReturns`,
  `implicitResults(stepId, onFailure)`.
- Writer (`writer.go`) edits the `yaml.Node` tree in place (`applyWorkflow`, `applyStage`, `applyStep`, key
  orders `topOrder`/`stageOrder`/`stepOrder`) so unedited files stay byte-identical; `Reader.New` writes a
  one-stage user workflow. No workflow ships preinstalled; samples live in `adeflow/testdata`,
  `flows/adeflow/testdata/imported.yaml`, `tests/claude/*.go` (inline YAML), `tests/fixtures/ade-v2/*.json`.
- Engine (`ade/steps.go`, `runs.go`). A task row holds `stage_id` (stage id, `done`, `''`) and
  `current_stage_json` (stage snapshot on entry) plus `workflow_json`/`workflow_hash` (P196 whole snapshot).
  `stageSteps` turns the current stage into `stepDef`s (script stage = one step with id = stage id; user stage
  none). `plan` = those steps with targets and latest runs filtered by `stage_id`. `walkPath` follows routes
  from step 0; `nextAction`: only the first step's `StartRun` starts it; later steps start themselves or wait
  for `Approve`; past the end = `actStageComplete`. The user clicks Done (`StageDone` → `nextRunnable`, past
  the last = `done`); the next agent or script stage needs Run again. User stage: `LaunchStage` opens its
  session (stage id `review` launches the review agent, `reviewStageID`).
- Routes (`route.go` `decideRoute`): `next`/`end`/forward → run `done`; `stop` → run `failed`; self or earlier
  → `decideLoop` counts `back` rows per (task, stage, step, branch) (`countReturns`), stops at `max_returns`,
  else queues the target. `chainRerun` reruns stale downstream steps.
- Moves. `SetTaskStage(task, stage|done, fromStageId)`, refused while a run is live; runs stay. UI: panel
  `AdeStageMover`, task menu "Move to stage" + "Skip <stage>", stage block "Move task here", phone Back/Next.
- Board. No column board. Plan card: one progress segment per stage (agent stages wider) and a status tag
  (`deriveStatus`). Panel Workflow block: one `AdeStageBlock` per stage. Card action per stage kind
  (`actions.ts`).
- Snapshots: `refreshSnapshot` re-reads the stage on advance; wire `Task.currentStage` serves tasks whose
  workflow file is gone.
- Stored rows: `ade_tasks(stage_id, current_stage_json, workflow_json, workflow_hash)`, `ade_runs(stage_id,
  step_id, branch_id, attempt, ...)` (attempt per stage, step, branch), `ade_sessions(stage_id, step_id)`,
  `ade_reviews`/`ade_run_sandbox` (by run id), `ade_workflow_last_valid(workflow_json)` (stage-shaped cache).
- Graph editor: `AdeWorkflowGraph.vue` (Vue Flow, locked dagre layout) with stage frames
  (`AdeStageGroupNode`), step nodes, end node per agent stage, `+ Add stage`; inspector `AdeStageInspector`
  or `AdeStepInspector`. Draft store `adeWorkflowDraft.ts` keys everything by stage.
- Step inspector today (baselines `workflow-graph-visual`, `workflow-graph-review-visual`): one flex-wrap row
  of label/select pairs (labels detach from controls), long Max returns hint, mode tabs, tools, prompt, a
  preview card repeating the prompt, Sandbox block always open, results cards, finish note. No section titles,
  no grouping, no order of importance.
- Prompts: `ade.stage.message` (`StageVars{StageName, StagePrompt}`), `ade.step.prompt` (`Step
  {{.StepNumber}}/{{.StepCount}}`, count = steps in stage), `headless.tool.task_info` ("workflow, stage"),
  `TaskInfo.Stage` (json `stage`). Store `rebuild` ignores override ids not in the registry.

## 1. Decisions (final)

1. **One list: a workflow has `steps`, no stages.** Step kinds: `agent` (headless `claude -p`; body `prompt`
   or `smart_script`), `script` (one shell command), `review` (P286 wait-for-user review), `manual` (your own
   work, optional interactive Claude Code session). Why: the four things a stage could hold, without the
   container.
2. **Step fields by kind; `kind` required.** All: `id` (unique in the workflow), `name`, `kind`, `status`
   (optional; default In review for review, In progress otherwise), `skip`. Agent: `runs_on`, `before`,
   `results`, `max_returns`, `timeout`, `prompt`+`allowed_tools` or `smart_script`+`params`, `sandbox`.
   Script: `command`, `runs_on`, `before`, `results` (fixed ids `done`/`failed`, routes editable),
   `max_returns`, `timeout`. Review: `review` block (optional, empty = defaults), `runs_on`, `before`,
   `results`, `max_returns`, `timeout`, `sandbox`. Manual: `session`, `prompt` (only with session). Keys of
   another kind are refused. Why: one spelling per fact; `kind` alone says what a step is.
3. **Routes.** `next` = next step in the list; `<step id>` later = jump (steps between are skipped), self or
   earlier = return (P288 `max_returns`, counter per task, step, branch); `end` = the workflow is finished;
   `stop` (not-ok results only) = run failed, task stays. Manual steps have one implicit `done → next`.
   Results omitted on agent and script steps = `adewire.DefaultResults()`: `done` (ok, `next`), `failed`
   (not ok, `stop`). Why: same engine rules over a longer list.
4. **Legacy spellings removed (final).** Gone: `on_failure` (steps and script), result `max`, kind aliases
   `user`/`automated`, `ImplicitResults(id, onFailure)` (→ `DefaultResults()`), `LegacyLimit`,
   `LegacyOnFailure`, `legacyMax`, `FillReturnLimits` (Go); `OnFailure`, `legacyMaxReturns`,
   `implicitResults(id, onFailure)` (→ `defaultResults()`) (TS). Each turns into a plain `unknown key "<key>"`
   refusal. Kept from P288: `results`, `max_returns`, `DefaultLimit`, `DefaultRoute`, `DefaultMaxReturns`,
   `MaxMaxReturns`, `Loop`. Why: each removed item exists only to read files or snapshots written before
   `results`/`max_returns`; P288's live rules use only the kept ones.
5. **Old format refused, never folded.** A file whose top level has `stages` fails parse with line of the
   key and message `"stages" is no longer supported: list every step under "steps" (see the Agents docs)`.
   Checked before the key allow-list so it wins over `unknown key`. The Workflows page shows the file as
   invalid with that text, as any other parse error. Why: user decision; a clear message beats a silent fold.
6. **Task position: entry step + derived current step.** `ade_tasks.entry_step_id` stores the step the task
   last entered by create, move, manual Done or a return past it (`done` when finished, `''` without a
   workflow). The current step is derived: `walkPath` from the entry over current-pass runs; the first step
   not done. `ade_tasks.since_json` stores the pass watermark: `{"<stepId>/<branchId>": attempt}`; runs with
   `attempt <= since[key]` are history. Why: derived current step cannot drift from runs.
7. **SQL: one destructive migration (`00NN_p293_flat_steps.sql`, next free number; 0038 at base).** ADE task
   data is reset; this is acceptable (user decision, no users). Explicit deletes, children first, so the
   result does not depend on the FK pragma:
   - Deleted rows: `windows` rows of ADE review windows (`key IN (SELECT window_key FROM
     ade_review_windows)`), `ade_review_windows`, `ade_gh_synced`, `ade_branch_marks`, `ade_worktree_setup`,
     `ade_log_chunks`, `ade_logs`, `ade_task_plan`, `ade_task_branches`, `ade_tasks`, `ade_workflow_last_valid`.
   - Dropped and recreated empty: `ade_run_sandbox`, `ade_reviews`, `ade_runs` (same columns as 0036/0037
     minus `stage_id`, same CHECKs and three indexes), `ade_sessions` (same columns as 0011+0012 minus
     `stage_id`, same CHECK, indexes `ade_sessions_task` and unique `ade_sessions_review`). Rebuild, not
     `DROP COLUMN`: SQLite refuses `DROP COLUMN` under these table CHECKs (0015 precedent).
   - Renamed in place: `ade_tasks.stage_id` → `entry_step_id`, `ade_tasks.current_stage_json` →
     `since_json` (`RENAME COLUMN`; `ade_tasks` is the FK parent of six tables, so no rebuild).
   - Kept: `ade_backlog`, `ade_repo_config`, `ade_repo_integration`, `ade_repo_envs`, `ade_env_state`,
     `ade_folders`, code repos, scripts. `script_runs.task_id` keeps dangling ids (the same case as a
     deleted task today). Git worktrees of deleted task branches stay on disk, untracked.
   - No migration unit test: plain DDL, and every Go flow test applies the full chain on a fresh DB.
   Why: user decision; renamed columns keep "stage" out of SQL; a reset removes every stage-shaped row
   (snapshots, run keys, the last-valid cache) in one step.
8. **How steps advance.** An automatic step (agent, script, review) reached by a forward route from another
   automatic step starts itself, or waits for Approve with `before: approval`. The entry step, when automatic
   and without current-pass runs, waits for Run (`StartRun`: branch names, message, worktree prep). A manual
   step waits for you: Session (when `session: true`) and Done. Done (`StepDone`) sets entry = next
   non-skipped step, so agents after a manual step wait for Run. Path past the last step or route `end` →
   task `done` automatically (no Finish click); a workflow wanting a last human check ends with a manual
   step. Why: keeps the two human checkpoints (Run after your work, Approve gates) and drops clicks that only
   existed because of stages.
9. **How a user moves a task.** `SetTaskStep(taskId, stepId | done, fromStepId)`: any non-skipped step in
   either direction, refused while a run is live. Effect: entry = target; `since` = latest attempt of every
   (step, branch) with runs, so the target and every later step run fresh (earlier runs stay as history). An
   automatic target waits for Run; a manual one waits for you. A return whose target lies before the entry
   moves the entry back to the target (`since` unchanged). UI: panel step mover (Back, Next, select), task
   menu "Move to step" + "Skip <step>", step row "Move task here", phone Back/Next. Stale guard
   `fromStepId` compares with the derived current step. Why: moves per step, with a real rerun.
10. **Board columns: one progress segment per step, equal width; status tag from the current step's
    `status`; panel Workflow block = one row per step.** Why: there is no column board; the card strip and
    panel blocks are the "columns", and a flat list has no other grouping. To do = current step is the entry,
    it is the first non-skipped step, no runs, no sessions. Skipped steps draw muted.
11. **Per-repo scope unchanged**: `runs_on` on agent, script and review steps; manual steps are task-level
    (no branch, no runs). Why: scope is a step property already.
12. **Snapshots.** `workflow_json` holds the flat workflow (taken as today); decode is plain `json.Unmarshal`
    (no fold, no fill). The per-stage snapshot, `refreshSnapshot` and wire `Task.currentStage` go: started
    tasks read their whole snapshot (P196). A not-started task whose file is gone shows "workflow missing".
    Why: redundant with P196.
13. **Naming.** The workflow sense of "stage" leaves UI copy, i18n keys and values, docs, workflow files,
    prompt ids, fields and texts, MCP tool texts, Go/TS identifiers, test names and SQL columns. Only
    survivors: the rejection message (§1.5) and its parser test case; the P293 migration (names the columns it
    renames/drops); earlier migrations (applied history, never edited); chapter records under `docs/v*/`.
    Other meanings stay: git staging (`git.*`, Studio git texts), SQL change staging (`studio.grid.*`,
    `data-grid.mdx`), `backend.core.appUpdate.stageFailed`. Why: the ask targets the workflow concept; git
    and grid staging are their own established terms.
14. **Prompts.** `ade.stage.message` → `ade.manual.message`, `StageVars{StageName, StagePrompt}` →
    `ManualVars{StepName, StepPrompt}`, Go `AdeStageMessage` → `AdeManualMessage`; default text otherwise
    unchanged. No override conversion: a stored `ade.stage.message` override is an unknown id, which `rebuild`
    already ignores. `ade.step.prompt`: `StepNumber/StepCount` count the workflow's automatic steps in list
    order; default text unchanged. `headless.tool.task_info` default: "workflow, stage" → "workflow, current
    step". `TaskInfo.Stage` → `Step` (json `step`). `budget.tsv` row id renamed, sizes refreshed by
    `promptsizes -snapshot` where they move; golden test data updated; `checkprompts` green. Why: no users,
    so no override to keep; the unknown-id rule already covers a stale file.
15. **Step inspector redesign** (§6): header (kind + name), then plain-language sections, essentials first:
    "What it does", "Where it runs", "When it ends"; "Advanced" collapsed (timeout, allowed tools, status,
    skip, sandbox, finish_step preview). Fields per kind only. Labels above wide controls, two-column grid for
    short pairs. Why: today's single wrapped row reads odd; the user asked for friendlier.
16. **Canvas.** One column of step nodes, no frames; one End node. Step menu: Add step after ▸ (Agent, Script,
    Review, Manual), Move up, Move down (disabled when the swap would turn a forward route into a return),
    Make start, Skip/Unskip, Remove. Under the canvas: `+ Add step` (same kind submenu). Why: P288 menus
    minus the stage level.
17. **Libraries.** shadcn-vue (`ToggleGroup`, `Collapsible`, `Field*`, `Input`, `Textarea`, `NativeSelect`,
    `Switch`, `Checkbox`, `DropdownMenu`, `Card`, `Separator`), Tailwind utilities only, VueUse via the repo's
    `usePersistedState` for the Advanced open state, Pinia draft store (one concern), TanStack Query for
    bridge calls. `<script setup lang="ts">` everywhere. No new dependency.
18. **No new real `claude` test.** Engine paths are covered by fakeagent flows; run the existing ADE row once
    at the end with the renamed test names (§9).

## 2. Wire (`internal/bridge/adewire`)

- `wire.go`: `StepKind` consts `agent|script|review|manual`. `PipelineStep` → `WorkflowStep` adding `Kind`,
  `Status`, `Skip`, `Session`, `Command` (json `kind,status,skip,session,command`), dropping `OnFailure`.
  `Workflow.Stages` → `Steps` (json `steps`). `Stage`, `StageKind`, both `FillReturnLimits` deleted. `Task`:
  `StageID` → `EntryStepID` (json `entryStepId`), `CurrentStage` removed, `Since map[string]int` (json
  `since`). `Run.StageID` removed. `SetTaskStageArgs` → `SetTaskStepArgs{TaskID, StepID, FromStepID}`;
  `LaunchStageArgs` → `LaunchStepArgs{TaskID, Message, FromStepID}`; `StartRunArgs.FromStageID` →
  `FromStepID`; `StepArgs.StageID` removed; `TaskInfo.Stage` → `Step`.
- `results.go`: `ImplicitResults` → `DefaultResults() []StepResult`; `LegacyLimit`, `LegacyOnFailure`
  deleted; comments say "step id of the workflow".

## 3. Files (`internal/adeflow`)

- `parse.go`: top level `id,name,kira_space_mcp,steps`; `stages` present → §1.5 error first. `stage(...)`,
  `stageKindAlias`, `onFailure`, `onFailureSimple`, `legacyMax`, `resultNodes.max` deleted. New `step(...)`
  validates per kind (§1.2): `kind is required`, `kind must be agent, script, review or manual`, per-kind
  allow-lists (`<key> is not allowed on <kind> steps`), `id %q is already used by another step`, routes over
  the whole list (`next must be next, end, stop or a step id of this workflow`), at least one non-skipped
  step, script `results` ids exactly `done`/`failed`, manual has no `results`, `review` block only on review
  steps. Missing `max_returns` = `DefaultLimit(kind == review)`. Existing results, `max_returns`, sandbox,
  review and smart rules move unchanged. "at least one result must lead forward, or the step can never
  finish".
- `writer.go`: `topOrder` `id,name,kira_space_mcp,steps`; `stageOrder` deleted; `stepOrder`
  `id,name,kind,status,skip,session,runs_on,before,results,max_returns,timeout,command,smart_script,params,
  review,sandbox,prompt,allowed_tools`. `applyWorkflow` writes `steps` via `syncItems`; `applyStep` per kind
  (drops other kinds' keys, writes `kind` always, `status` only when not the kind default, `skip` only when
  true, `results` only when not equal to `DefaultResults()`, `max_returns` only when not the default).
  `applyStage`, `dropOthers` (folded into `applyStep`), `LegacyOnFailure` reduction deleted. `Reader.New`:
  one manual step `work`.
- `testdata`: `standard.yaml`, `bugfix.yaml`, `chore.yaml` rewritten flat by hand (`kind` on every step,
  `results` instead of `on_failure`); `flows/adeflow/testdata/imported.yaml` likewise.
- Tests (`adeflow_test.go`, `writer_test.go`): `TestParse_aliasMapsToWireKind` and the legacy cases of
  `TestParse_returnLimits` (`on_failure`, result `max`, `retry 2`) deleted; per-kind refusals and the one
  rejection case (§9) added to `TestParse_rules`; round-trip byte-identical on the flat samples; writer
  comment test without the alias line.

## 4. Engine (`internal/ade`), storage, bridge

- `steps.go`: `stageSteps` → `workflowSteps(wf)`; `stepDef` gains `Kind`, `Skip`, `Session`; manual steps
  have no targets. `stages.go` folds into `steps.go`: `firstStep`, `nextStep(wf, from)` (non-skipped).
  `walkPath(steps, entry)` starts at the entry index and passes over `Skip` steps; `nextAction` adds
  `actWaitUser` (manual at path end), `actComplete` replaces `actStageComplete`; the "only StartRun starts"
  rule applies to the entry index. `chainRerun` walks from the entry.
- `runs.go`: `taskCtx` holds `wf`, `entry`, `since`; `loadTaskCtx` decodes the snapshot and `since_json`.
  `plan` filters runs by `step_id` and `attempt > since`. `advanceLocked`: `actComplete` →
  `SetEntryStep(task, "done", nil)`. `StageDone` → `StepDone` (current step must be manual: `the current
  step is not a manual step`). `SetTaskStage` → `SetTaskStep` (§1.9; skipped target refused; `since` from
  `LatestRuns`). `StartRun`: current step must be the entry, automatic, without current-pass runs (`the
  current step does not wait for Run`). `Approve(taskId, stepId)`. `staleStage` → `staleStep`.
  `refreshSnapshot` removed.
- `route.go`: `decideRoute` ignores runs not of the current pass; `RouteEnd` → forward to `len(plan)`;
  `decideLoop` target before the entry → `SetEntryStep(task, target, since)`. `countReturns(runs, step,
  branch, upTo)` (stage arg dropped; P288 rule otherwise unchanged).
- `launches.go`: `LaunchStage` → `LaunchStep` (current step manual with `session`); `reviewStageID` →
  `reviewStepID` (`review_agent.go`); session rows carry the step id. `vars.go`: `composeStageMessage` →
  `composeManualMessage` (`ManualVars`). Step numbering per §1.14.
- `reviewstep.go`: candidates = earlier agent prompt steps in the workflow on the branch (current pass);
  `reviewRun` checks the run is in the current pass. `agenttools.go`: `info.Step`.
- `taskwf.go`: `taskWorkflow`, `decorateTask`, `toWireTask` decode with `json.Unmarshal`, no
  `FillReturnLimits`; `toWireTask` drops `CurrentStage`, sets `EntryStepID`, `Since`. `board_writes.go`
  (`CreateTask`, `PromoteBacklogItem`, `SetTaskWorkflow`): entry = `firstStep`.
- Migration per §1.7, registered in `migrations/embed.go` (`p293_flat_steps`).
- `storage/model/adetask.go`: `AdeTask.StageID` → `EntryStepID`, `CurrentStageJSON` → `SinceJSON`;
  `AdeRun.StageID`, `model/adesession.go` `AdeSession.StageID` removed. `repos/adetask.go`: column lists
  `entry_step_id, since_json`; `SetStage` → `SetEntryStep(taskID, stepID, since)`; queries keyed by
  `stage_id` switch to `step_id` (`MAX(attempt)`, return count, latest runs). `repos/adesessions.go`: column
  lists without `stage_id`.
- `bridge/adetask.go`: bound `StepDone`, `SetTaskStep`, `LaunchStep` (count stays 58);
  `validateAdeFromStep`. `bridge/mobilewrite.go`, `mobileweb/{writer,writes,routes}.go`: `SetTaskStep`,
  `LaunchStep`, request `fromStepId`, result `{taskId, stepId}`, route `/api/ade/tasks/step` action
  `task.step`; `task.run`/`task.launch` take `fromStepId`.
- Catalog (`en.json`): engine refusals stay plain English `invalid(...)`; no new backend key.
- Go tests: `steps_test.go`, `stages_test.go` (merged into steps), `board_stage_test.go` →
  `board_step_test.go`, `runengine*_test.go`, route tests: stage args dropped, entry/skip cases added.

## 5. Board, run view, mobile (`apps/kira-space/frontend`)

- `ade/v2/wire.ts`: mirror §2 (`StepKind`, `WorkflowStep`, `Workflow.steps`, `Task.entryStepId`,
  `Task.since`, no `currentStage`, `Run.stageId`, `OnFailure`, `Stage`). `bridge/index.ts`:
  `adeTaskStepDone`, `adeTaskSetTaskStep`, `adeTaskLaunchStep`.
- `board/stepResults.ts`: `defaultResults()`, `hasDefaultResults(results)`; `legacyMaxReturns`,
  `implicitResults` deleted.
- `board/progress.ts`: `stepDefs(wf)` flat; `latestRun` skips `attempt <= since`; `walkPath(ids, steps,
  entry)` mirrors Go (skip, entry); `TaskProgress.stage` → `step`, `stageIndex` → `stepIndex`, `segments`
  per step (`StepSegment`, no `wide`), label `<current step> <done>/<total automatic>`, `finished` =
  `entryStepId === 'done'`.
- `board/stageBlocks.ts` → `stepBlocks.ts` (`StepBlock`, `buildStepBlocks`: one block per step, states
  past/now/next/skipped; manual text "Waiting for you" / "Your own work"; `release` keyed by step id),
  `routeText`, `fixRound`, `backLimit` over the flat list. `stageMoves.ts` → `stepMoves.ts`.
- `board/status.ts`: §1.10. `board/actions.ts`: `stepAction` by current step kind: manual → `session` or
  `done`/`finish` (finish when no later non-skipped step); entry automatic pending → `run`; gated →
  `approve`; stuck → `takeOver`; failed → `retry`. `board/menu.ts`: `moveStep`, "Move to step", "Skip
  <step>". `board/needsYou.ts`: `stepId` only. `board/runMessage.ts`, `dialog/*`: step names.
- `panel/AdeStageBlock.vue` → `AdeStepBlock.vue` (manual row: Session/Done; "Move task here");
  `AdeWorkflowBlock.vue` lists step blocks; `AdeStageMover.vue` → `AdeStepMover.vue`. `plan/AdeTaskCard.vue`
  segments `flex-1`. `run/useTaskAction.ts`: `StepDone`, run dialog for agent entry, direct `StartRun` for
  script/review entry. `run/AdeRunDialog.vue`: title "Run <step>". `queries.ts`: `useStepDone`,
  `useSetTaskStep` (`withStep` optimistic patch), `useLaunchStep`. `state/adeDialogs.ts`: `session(taskId)`.
- Mobile: `state/useAgentsModel.ts`, `state/useTaskActions.ts`, `api/adeWriter.ts` (`setTaskStep`,
  `launchStep`, `/api/ade/tasks/step`), `state/useAdeWrites.ts`, `screens/PlanTaskCard.vue`.
- Unit specs: `tests/unit/ade-v2-progress.spec.ts`, `ade-v2-board-parity.spec.ts`, `ade-v2-dialog.spec.ts`,
  `ade-v2-workflow-graph.spec.ts` fixtures flat; legacy `on_failure` cases deleted; walkPath entry/skip cases
  added to the progress spec (parity with Go).

## 6. Workflow editor and step inspector (`ade/v2/workflows`, `board/workflowGraph.ts`, `state/adeWorkflowDraft.ts`)

Canvas:
- `workflowGraph.ts`: `layoutWorkflow(wf)` over `wf.steps`: one spine column, nodes `256x104`, result fans
  and loop gutter as today, one End node; manual and script nodes use their default results; skipped steps
  dashed and muted. Remove stage group/leaf nodes, `layoutAgent` merge, per-stage end nodes. `setRoute`,
  `normalizeOrder`, `reclassify`, `reaches` take the flat list. New `canMove(wf, id, delta)`.
- `state/adeWorkflowDraft.ts`: selection `{ stepId }`; `createStep(afterId | null, kind)`, `moveStepBy(id,
  delta)`, `patchStep(id, p)`, `replaceStep(step)` (kind change via `withKind`), `removeStep(id)`, result ops
  without `stageId`; stage ops removed.
- `board/workflowForm.ts`: `newStep(kind, ids)`, `withKind(step, kind)` (keeps id, name, `runs_on` when the
  target kind has it, resets the rest to kind defaults, review defaults per P286/P288), `kindLabel(kind)`;
  `newStage` and `failureLabel` deleted, `runnableCount` → `runnableSteps`.
- `AdeStepNode.vue`: kind chip (Agent amber, Script green, Review blue, Manual grey), number = list position,
  menu per §1.16 (`ade-wf-step-menu`, items `ade-wf-step-add-after-<kind>`, `ade-wf-step-up`,
  `ade-wf-step-down`, `ade-wf-step-start`, `ade-wf-step-skip`, `ade-wf-step-remove`). Delete
  `AdeStageGroupNode.vue`, `AdeStageInspector.vue`. `AdeWorkflowGraph.vue`: `+ Add step` dropdown
  (`ade-wf-add-step`, items `ade-wf-add-step-<kind>`) replaces `+ Add stage`; `AdeEndNode.vue` label "End".

Inspector (right pane `ade-wf-inspector`), new layout:

```
[Kind: (Agent)(Script)(Review)(Manual)]         ToggleGroup, ade-wf-step-kind
[ Step name ............................ ]      Input, ade-wf-step-name
── What it does ─────────────────────────
 Agent : Instructions (Prompt | Smart script)   SecondaryTabs ade-wf-step-mode
         Prompt textarea (placeholder names {task} {repo} {branch} {worktree})
         ▸ Preview (Collapsible, closed)        resolved tokens
         or Smart script select + params + body preview
 Script: Command textarea (font-data) + one-line hint (non-zero exit = failed)
 Review: Send comments to [Implementer session|New session], Implementer step [Nearest earlier|…]
         note: "The run waits for you in the review window."
 Manual: Open a Claude Code session [Switch]; First message textarea (when on)
         note: "The task waits until you click Done."
── Where it runs ───────── (agent, script, review)
 Runs on   [Once ▾]        grid row; hint under: what Once / Each repository mean
 Start     (Automatically | After my approval)   ToggleGroup, ade-wf-step-gate
── When it ends ────────── (agent, script, review)
 Results: compact rows  [id] [✓ Success] [Goes to ▾] [×], description under (agent/review)
          script: fixed rows done/failed, route only; + Add result (agent/review)
 Max returns [3]  hint: "Returns allowed to this or an earlier step. 0 = no limit (review only)."
▸ Advanced (Collapsible, closed; open state persisted per viewer)  ade-wf-step-advanced
 Timeout [1h] · Task status here [In progress ▾] · Skip this step [Checkbox]
 Allowed tools (agent prompt only)
 ▸ Sandbox (agent, review; summary line "Write worktree · network on")
 finish_step instruction preview (agent)
```

- Components (`workflows/inspector/`): `AdeInspectorSection.vue` (title, optional hint, slot; `collapsible`
  prop wraps shadcn-vue `Collapsible`), `AdeStepAgentFields.vue`, `AdeStepScriptFields.vue`,
  `AdeStepReviewFields.vue`, `AdeStepManualFields.vue`, `AdeStepRunFields.vue`, `AdeStepEndFields.vue` (hosts
  `AdeStepResults.vue` + Max returns), `AdeStepAdvanced.vue`; `AdeStepSandbox.vue` and `AdeStepResults.vue`
  move in. `AdeStepInspector.vue` = header + sections, picks fields by kind.
- Rules: section title `text-kira-sm font-medium text-foreground`, hint `text-kira-sm text-muted-foreground`
  under the control; short pairs in `grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2`; wide controls
  stacked with label above (`Field`, `FieldLabel`, `FieldDescription`); `Separator` between sections; no
  scoped `<style>`. Kind change confirms only when the step has a non-empty prompt, command or session prompt
  (`ConfirmDialog`, "Change kind? Its <field> is cleared.").
- Keep test ids for surviving fields (`ade-wf-step-name`, `-scope`, `-gate`, `-timeout`, `-max-returns`,
  `-mode-*`, `-tools`, `-prompt`, `-preview`, `-script`, `-review-*`, `ade-wf-sandbox-*`, `ade-wf-result-*`);
  new: `ade-wf-step-kind-<kind>`, `ade-wf-step-command`, `ade-wf-step-session`, `ade-wf-step-session-prompt`,
  `ade-wf-step-status`, `ade-wf-step-skip`, `ade-wf-step-advanced`, `ade-wf-step-section-<what|where|end>`.
- Empty pane: "Select a step to edit it. Drag from a result dot to another step to set where it goes.
  {tokens} are filled in per run."
- Workflows page intro: "A workflow is the list of steps a task goes through: agent, script, review and
  manual steps."

## 7. Copy (`packages/theme/src/i18n/en.json`)

95 keys mention "stage" at base; 13 are other meanings (git staging, grid staging, app update) and stay. The
rest (82) are renamed, edited or removed:
- `space.ade.board.taskMenu.moveToStage.label` → `moveToStep`; `…skipStage.label` → `skipStep`.
- `space.ade.board.taskAction.stage.{label,tooltip}` → `taskAction.session.{label,tooltip}`;
  `taskAction.done.tooltip`, `doneLast.tooltip`, `retryFailed`, `retryStuck`, `runAgents.tooltip`: var
  `{stage}` → `{step}`.
- `space.ade.claudeDialog.stage.title` → `claudeDialog.step.title`; `space.ade.runDialog.title.title` var.
- `space.ade.outcome.routeEnd.label` → "→ End".
- `space.ade.panelFacts.why.stage.hint` → `why.step.hint`.
- `space.ade.progress.stage{Agent,Script,User,Done}.label` → `progress.step{Agent,Script,Manual,Review,Done}`.
- `space.ade.stage.*` → `space.ade.step.*`; `space.ade.stage.modeUserSession.label` → `step.modeManual`.
- `space.ade.stageBlock.*` → `space.ade.stepBlock.*`; `skipThis.label` "Skip this step".
- `space.ade.stageMover.{back,next}.tooltip` → `space.ade.stepMover.*` ("Back one step", "Next step").
- `space.ade.workflows.graph.addStage.label` → `graph.addStep.label`; `inspectorEmpty.emptyHint` text.
- `space.ade.workflows.results.intro.hint` ("…sets where the task goes next"); `route.end.option` "End".
- `space.ade.workflows.stageInspector.{command.example,command.hint,prompt.aria,prompt.placeholder,
  session.label,status.tooltip}` → `space.ade.workflows.stepInspector.*`; `stageNode.{manual,noCommand,
  session}.label` → `stepNode.*`; `workflows.stage.defaultName.label` → `workflows.step.defaultName.label`
  ("New step"); `workflows.page.intro.body` text.
- `mobile.plan.{moveBackConfirm.body,moveForwardConfirm.body,startConfirm.title,startSessionConfirm.body}`
  var `{stage}` → `{step}`; `startThisStage{Confirm.title,SessionConfirm.body}` → `startThisStep*`.
- `llmPrompts.entry.adeStageMessage.*` → `llmPrompts.entry.adeManualMessage.*` ("Manual step message", "The
  first message of a manual step session…"); `llmPrompts.var.stageName` → `var.stepName` (reuse or add),
  `llmPrompts.var.stagePrompt` → `var.stepPrompt`; texts of `llmPrompts.entry.{adeJiraLine,adeRepoLine}.
  usedBy.body`, `llmPrompts.var.{stepCount,stepNumber}.description` ("in the workflow").
- `space.common.stage.label` → `space.common.step.label`.
Remove: `graph.addStageAfter.label`, `graph.stageMenu.aria`, `stageInspector.{addStep,name.aria,remove,skip,
unskip}`, `kind.agentBackground.option`, `field.onFailure.label`, `onFailure.*`, `progress.stageUser`, and any
key copy-coverage reports unused. Add: `space.ade.workflows.kind.{agent,script,review,manual}.option`,
`space.ade.workflows.stepInspector.section.{what,where,end,advanced,sandbox}.label`, `…instructions.label`,
`…start.label`, `…start{Auto,Approval}.option`, `…runsOnHint.{once,each,only}`, `…status.label`,
`…skip.label`, `…session.label`, `…sessionPrompt.label`, `…manualNote.hint`, `…scriptNote.hint`,
`…kindChange.{title,body}`, `space.ade.workflows.graph.addStepKind.aria`,
`space.ade.workflows.stepNode.kind.<kind>.label`, `space.ade.step.waitingYou.status`.

## 8. Rename scope (exact, counted at base)

- Files mentioning "stage" (any case) at base: Go source 45, Go tests 58 (`internal/`), `tests/claude` 7,
  TS/Vue source 52 (`frontend/src` + `frontend/mobile`), test specs and fixtures 72 (`tests/`, of which 9 JSON
  fixtures), `internal/llmprompts` 3 (`registry.go`, `golden_test.go`, `testdata/budget.tsv`), i18n 82 keys,
  site docs 4 (`space/agents.mdx`, `space/phone.md`, `reference/mcp-tools.md`, `reference/prompts.md`;
  `studio/data-grid.mdx` is grid staging, stays), `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`. Files
  touching `on_failure`/`onFailure`: 34 (overlap with the above).
- Go renamed: `adewire.{PipelineStep→WorkflowStep, Workflow.Stages→Steps, Task.StageID→EntryStepID,
  SetTaskStageArgs→SetTaskStepArgs, LaunchStageArgs→LaunchStepArgs, *.FromStageID→FromStepID,
  TaskInfo.Stage→Step, ImplicitResults→DefaultResults}`; deleted `adewire.{Stage, StageKind,
  FillReturnLimits ×2, LegacyLimit, LegacyOnFailure}`, `Task.CurrentStage`, `Run.StageID`,
  `StepArgs.StageID`, `PipelineStep.OnFailure`. `adeflow`: deleted `stage`, `stageKindAlias`, `onFailure`,
  `onFailureSimple`, `legacyMax`, `applyStage`, `stageOrder`. `ade.{StageDone→StepDone,
  SetTaskStage→SetTaskStep, LaunchStage→LaunchStep, stageSteps→workflowSteps, firstRunnable→firstStep,
  nextRunnable→nextStep, staleStage→staleStep, reviewStageID→reviewStepID,
  composeStageMessage→composeManualMessage, actStageComplete→actComplete}`, deleted `refreshSnapshot`, file
  `stages.go`. `model.{AdeTask.StageID→EntryStepID, AdeTask.CurrentStageJSON→SinceJSON}`, deleted
  `AdeRun.StageID`, `AdeSession.StageID`. `repos.SetStage→SetEntryStep`. Bridge/mobile methods and route per
  §4. `llmprompts.{AdeStageMessage→AdeManualMessage, StageVars→ManualVars, StageName→StepName,
  StagePrompt→StepPrompt}`, id `ade.stage.message→ade.manual.message`. Tests: `TestAdeStageSession` →
  `TestAdeManualSession` (tests/claude), `board_stage_test.go` → `board_step_test.go`, `stages_test.go`
  merged into `steps_test.go`, `TestParse_aliasMapsToWireKind` deleted.
- SQL: `ade_tasks.{stage_id→entry_step_id, current_stage_json→since_json}`; `ade_runs.stage_id`,
  `ade_sessions.stage_id` dropped (§1.7).
- TS/Vue renamed: types per §5; files `stageBlocks.ts→stepBlocks.ts`, `stageMoves.ts→stepMoves.ts`,
  `AdeStageBlock.vue→AdeStepBlock.vue`, `AdeStageMover.vue→AdeStepMover.vue`; deleted
  `AdeStageGroupNode.vue`, `AdeStageInspector.vue`; `OnFailure`, `legacyMaxReturns`, `implicitResults`
  deleted; queries, bridge entries, dialog action, menu cmd, mobile writer per §5.
- Workflow YAML rewritten flat by hand: `adeflow/testdata/{standard,bugfix,chore}.yaml`,
  `flows/adeflow/testdata/imported.yaml`, inline YAML in Go tests (`adeflow`, `ade`, `flows/*`,
  `tests/claude`) and TS specs, `tests/fixtures/ade-v2/workflow-yaml.json`. No workflow ships with the app.
- Guard at close-out: `rg -i 'stage' apps/kira-space/{internal,frontend,tests} internal/llmprompts
  packages/theme/src/i18n site/src/content docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md` hits only the
  survivors of §1.13 (rejection message + its test case, the P293 and earlier migrations, git/grid/app-update
  staging). The close-out lists the remaining hits.

## 9. Tests (split at the IPC boundary)

| Scenario | Go flow (fakeagent; new `internal/flows/adeflow/flatsteps_test.go` `TestFlatSteps`) | UI spec (new `tests/ui/ade-v2-flat-steps.spec.ts`, `contract:` cases) |
|---|---|---|
| Full pass | flat file: manual `spec` (session) → agent `impl` (each repo) → review → script `release`. Create: entry spec, To do. `LaunchStep` session; `StepDone` → entry impl, waits Run; `StartRun` → impl done → review waits → `FinishReview approved` → script runs → task `done` with no click. Contracts `ade-flat-steps#{created,manual,run,review,done}` | card: one segment per step, status tag from step status, actions Session → Done → Run → review → Merged/Archive; panel step rows; manual row Done button |
| Moves | after impl done, `SetTaskStep(impl)` back: `since` set, impl waits Run, rerun counts fresh; `SetTaskStep(release)` forward; refused while live; to `done`. Contract `#moved` | Move to step submenu, step row Move task here, step mover Back/Next; reran step shows pending, earlier runs hidden |
| Return past entry | entry = review (moved), review `rework` → impl (before entry): entry becomes impl, impl reruns, return counted. Contract `#return` | `↩ 1/3` chip on impl |
| Editor | `SaveWorkflow` with one step per kind; file has `kind` per step, manual without results, default results not written; reload equal. Contract `#workflow` | inspector: kind toggle switches field groups; Advanced closed by default and remembered; Add step after ▸ Script; Move up disabled when it would create a return; save payload |

- Rejection test (the one new non-flow test): a case in `adeflow_test.go` `TestParse_rules`: a file with top
  level `stages:` fails with the §1.5 message at the key's line. Deleted: legacy fold, backfill, prompt
  override fold and alias tests of the first plan; P288 legacy cases (`on_failure` + `max_returns`, result
  `max`, `retry 2` limit, `on_failure: back:x` save) in `adeflow_test.go`, `writer_test.go`,
  `flows/adeflow/reviewstep_test.go` (fixture `max: 2` → `max_returns: 2`), `stepResults`/progress unit specs.
- Updated Go tests: every `internal/flows/adeflow/*_test.go` and `mobileflow`, `journeyflow`, `usageflow`,
  `notifyflow`, `claudeflow`, `windowflow`, `appflow` helpers that write workflow YAML or call stage APIs
  (inputs rewritten flat); `ade` unit tests; `adeflow` parser/writer; `mobileweb` route tests;
  `bridge/adewire/wire_test.go`; `llmprompts/golden_test.go`.
- Contracts: regenerate (`KIRA_CONTRACT=write go test -p 2 ./internal/flows/...`) and the frozen fixtures in
  `tests/fixtures/ade-v2/` (`workflows.json`, `task.json`, `board.json`, `start-run.json`, `launch.json`,
  `event-runs.json`, `workflow-validation.json`, `workflow-yaml.json`); expected diff: `stages` → `steps`,
  `stageId`/`currentStage`/`onFailure` gone, `entryStepId`, `since`, `kind`. New `ade-flat-steps.json`.
- Updated UI specs: `ade-v2-workflows.spec.ts` (stage frame/menu cases → step menu, Add step by kind,
  inspector sections), `ade-v2-workflow-layout.spec.ts`, `ade-v2-review-step.spec.ts`,
  `ade-v2-return-limit.spec.ts`, `ade-v2-sandbox.spec.ts` (sandbox under Advanced), `ade-v2-plan.spec.ts`,
  `ade-v2-panel.spec.ts`, `ade-v2-run.spec.ts`, `ade-v2-launch.spec.ts`, `ade-v2-task-menu.spec.ts`,
  `ade-v2-resume.spec.ts`, `ade-v2-review-open.spec.ts`, `ade-v2-sessions.spec.ts`, `ade-v2-automations.spec.ts`,
  `ade-v2-base-rebase.spec.ts`, `ade-claude-missing.spec.ts`, `copy-coverage.spec.ts`, `consistency.spec.ts`,
  `ui-leftovers.spec.ts`; mobile `tests/mobile/{writes,tabs,ui-leftovers}.spec.ts`, `support/mockServer.ts`.
- Visual baselines (re-record in the sandbox per `docs/DEV_ENVIRONMENT.md`, Linux only):
  `ade-workflow-graph.spec.ts` `workflow-graph-visual`, `workflow-graph-branches-visual`;
  `ade-review-step.spec.ts` `workflow-graph-review-visual`; `ade-sandbox.spec.ts` `sandbox-popover-visual`
  only if its diff shows the run view changed. New: `workflow-graph-manual-visual` (manual step selected,
  session on) and `workflow-graph-script-visual` (script step selected).
- Real `claude` (Linux sandbox, once after test-and-fix; report spend): `bun run test:claude:space -run
  'TestAdeHeadlessRun|TestAdeStepResults|TestAdeManualSession|TestAdeRebaseRun|TestAdeResumeRun|
  TestAdeResumeLost|TestAdeReviewStep|TestAdeReviewLost|TestAdeSandbox|TestAdeSandboxReadOnly' -count=1`.
  `tests/claude/*.go` workflows become flat YAML. macOS half of the sandbox row runs only on a real Mac; if
  none is available, record "not run on macOS" in the close-out, as P287 did.

## 10. Docs

- `site/src/content/docs/docs/space/agents.mdx` (terse, P284 rule): Workflows: "A workflow is a list of
  steps"; the four kinds; per-kind fields; `results` and default results; routes (`end` = workflow done); how
  a task moves (Run, Approve, Done, auto finish, Move to step, history); graph editor (step menu,
  `+ Add step`, inspector sections and Advanced); flat YAML example; `on_failure` and result `max` text
  removed. Return limit text: "per task, step and branch".
- `space/phone.md` ("move tasks between steps"), `reference/mcp-tools.md` (`task_info`: "workflow, current
  step"), `reference/prompts.md` ("workflow step prompts"; `ade.manual.message` entry if listed). `bun run
  lint`, `site:check` green.
- `docs/ARCHITECTURE.md`: Model and scope bullet (flat steps, kinds); new bullet "Flat steps (P293)": entry
  step + derived current step, `since_json` watermark, auto finish, no compatibility layer (old files refused,
  ADE task data reset by the P293 migration); update Return limit (key per task, step, branch), Graph editor
  (no frames, step menu, Move up/down), Review step, Task snapshot (no per-step snapshot, no
  `refreshSnapshot`), step `skip`; delete `on_failure`/result `max` mentions. Known open items: none expected.
- `docs/DEV_ENVIRONMENT.md`: ADE row test name `TestAdeStageSession` → `TestAdeManualSession`; other "stage"
  wording in ADE rows.
- `docs/v2.5/SPEC.md` P293 row: status and result note at close-out.

## 11. Execution (one sequential Sonnet implementer)

No streams: wire, files, engine, migration and UI depend on each other in order. Each commit passes the normal
hook (typecheck, lint incl. `checkprompts`, build); Go commits land before TS ones (TS wire is hand-written, so
the hook stays green between them). Resume after interruption: `git log --oneline <base>..`; continue at the
first missing commit.

1. `feat(adewire): flat workflow step types` (additive: `StepKind`, `WorkflowStep`, `DefaultResults` next to
   the old types; compiles alone).
2. `feat(adeflow)!: flat workflow files, old format refused` (§3 and the wire switch: `Workflow.Steps`,
   legacy code deleted; parser, writer, testdata, rejection test; minimal compile fixes in callers).
3. `feat(ade)!: flat step engine and step columns` (§4 engine, migration §1.7, storage, bridge, mobileweb;
   Go unit tests).
4. `refactor(space): flat steps in board, run view and phone` (§5, copy keys it uses).
5. `feat(space): flat workflow canvas` (§6 canvas, draft store, workflowForm, unit graph spec).
6. `feat(space): step inspector redesign` (§6 inspector, copy keys).
7. `refactor(prompts): manual step message and step wording` (§1.14; `llmprompts/registry.go`, golden test,
   `ade/vars.go`, i18n entry keys, `budget.tsv`; `checkprompts` green).
8. `test(ade): flat steps flow tests and contracts` (§9 Go rows, updates, contract regen, fixtures).
9. `test(space): flat steps UI specs and visual baselines` (§9 UI rows, spec updates, re-record 3 + 2 new).
10. Full test pass once: Go `-race` on `ade`, `adeflow`, `adewire`, `flows/...`, `mobileweb`, `migrations`;
    UI, unit, mobile and visual suites; fixes as `fix:` commits.
11. `docs: flat workflow steps` (§10), then the §8 guard.
12. Real `claude` ADE row; fixes as `fix:` commits; report spend.

## 12. Risks

- Data reset: every ADE task, run, session, log and review window is deleted on first start after upgrade;
  task worktrees stay on disk, untracked. Accepted by the user (no users).
- Old workflow files stop loading: shown invalid with the §1.5 message until rewritten by hand.
- A stored `ade.stage.message` prompt override is ignored (unknown id) and stays in the prompts file until
  the next Save of another override rewrites it unchanged; harmless.
- Behaviour change: automatic steps flow across what were stage boundaries; add `before: approval` where a
  pause is wanted. Manual Done keeps Run.
- Auto finish: a workflow ending with an automatic step finishes without a click; Archive stays manual.
- Size: largest commits are 2 and 3; keep each compiling, push nothing until hooks pass.

## 13. Out of scope

- Step groups, lanes or any grouping concept; drag-and-drop reordering on the canvas.
- Any compatibility layer: fold, conversion, backfill, alias or legacy spelling.
- New run states, parallel steps, per-step task status beyond today's four values.
- Results on manual steps; `before` on manual steps.
- Changes to P286 review, P287 sandbox, P288 return counting rules beyond dropping the stage key and the
  legacy spellings of §1.4.
- Mobile UI redesign beyond renames and step moves.
- Cleanup of orphaned task worktrees on disk.

## Result (implementer)

Commits on `p293`: `748f003b1` (Go, frontend, mobile, unit specs, fixtures), `1041c3aef` (docs), plus the
spec commit after it. Steps 1-9 and 11 done; 10 and 12 (full test pass, real `claude` row) left to the
test-and-fix agent. Hook (lint, typecheck) green on every commit, no `--no-verify`.

Deviations:
- Go steps 1-5 and 7-8 landed in one commit: Go and hand-written TS wire compile together, hook typechecks both.
- `since` holds only the target and later steps. Lenient `TargetErr`. A not-started task follows the live
  file's first step. `snapshotStartedTasks` removed.
- Wire drops `Session.StageID`, `ReviewCandidate.Stage`, `RunOutcomeEntry.Stage`.
- Engine fix in `queueRun`: attempt bumps past history.
- `task_info` default says "step". Fixed pre-existing `TestScheduleValidation` weekday flake.
- Frontend: `canMove` blocks only explicit id routes; Remove disabled for a one-step workflow;
  `buildStepBlocks(progress, workflow)`; new keys `runReview.tooltip`, `modeOwn`. Kind labels read "Agent
  step" etc. (catalog duplicate rule).
- Parity tests against the stage-shaped mockup oracle replaced. `AdeStepBlock` `reviewRows` still checks
  `step.id === 'review'`.
- New UI spec uses the contract for shape checks and fixture boards for UI state; the return-chip and
  moved-step scenarios are thin and may need tightening once run. `openWorkflows` moved to `support/adeV2.ts`.
- `rg -i stage` guard: survivors are git/grid/update staging, the rejection message and its docs mention.

Not run (for test-and-fix): UI suite (`ade-v2-flat-steps` and all edited ade specs, copy-coverage,
consistency, ui-leftovers), mobile suite, unit suite, Go `-race` on touched packages, e2e, real `claude` row.
Visual baselines to re-record on Linux: `workflow-graph`, `workflow-graph-branches`, `workflow-graph-review`;
new `workflow-graph-manual`, `workflow-graph-script`; `sandbox-popover` only if its diff shows change.
