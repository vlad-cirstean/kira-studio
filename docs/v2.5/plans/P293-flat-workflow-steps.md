# P293 plan: Flat workflow steps and a friendlier step panel

Ask (user, verbatim intent): "Let's make it flat, this is just too complex. Let's call them steps. And make the
right config panel for a step more user friendly. It looks quite odd now." So: a workflow is one list of
steps; "stage" leaves the product (UI, copy, docs, prompts, tool texts, identifiers) except where a stored
format needs the old name; the step inspector gets a clear, grouped layout. Existing workflow files, stored
tasks and run history keep working.

SPEC row P293 (`907c4497a`): flat list of steps, the word "step" only (no "stage" in UI, docs, workflow files
or code names), mapping of every stage concept stated, open questions decided final with a why, inspector
redesign (grouped sections, plain labels, defaults first, advanced collapsed, shadcn-vue/Tailwind), tests
split at the IPC boundary, specs and sandbox baselines updated, real `claude` ADE row re-run.

Base: `907c4497a` (origin/v2.0). Implementation runs after P291, P292 (both review rounds and fixers) land.
The implementer re-reads the tree then: line numbers below are from the base and will drift; names hold.
P292 review rounds do not cover P293.

Discovery: `codegraph_explore` over `apps/kira-space` (`adeflow/{parse,writer,reader}.go`,
`adewire/{wire,results}.go`, `ade/{steps,stages,route,runs,launches,taskwf,board,reviewstep,review_agent,
vars,agenttools}.go`, `repos/adetask.go`, `model/adetask.go`, `bridge/{adetask,mobilewrite}.go`,
`mobileweb/{writer,writes,routes}.go`, `ade/v2/board/{progress,stageBlocks,stageMoves,status,actions,menu,
workflowForm,workflowGraph}.ts`, `ade/v2/workflows/*.vue`, `ade/v2/panel/{AdeStageBlock,AdeStageMover}.vue`,
`ade/v2/plan/{usePlanModel,AdeTaskCard}`, `ade/v2/run/{useTaskAction,AdeRunDialog}`, `mobile/state/*`), plus
reads of `internal/llmprompts/{registry,store}.go`, migrations, i18n catalog, docs and visual baselines.

## 0. How it works today (from source)

- Schema (`adeflow/parse.go` `stage`, `steps`). Workflow `id`, `name`, `kira_space_mcp`, `stages`. A stage
  has `id`, `name`, `kind` (`user|manual` → user, `agent|automated` → agent, `script`), `status` (To do, In
  progress, In review, Done; required), `skip`. User: `session`, `prompt` (only with session). Agent: `steps`
  (non-empty). Script: `command`, `runs_on`, `on_failure` (`stop|retry 1|retry 2`, no `back:`), `timeout`.
  Step ids unique per stage only; stage ids unique per workflow. A step id may equal a stage id
  (`testdata/standard.yaml`: stage `impl`, step `impl`).
- Agent step: `id`, `name`, `runs_on` (`once | each repo | only <nick>`), `before` (`auto|approval`),
  `results` (1..12, `next`: `next|end|stop|<step id of same stage>`) or legacy `on_failure`, `max_returns`
  (P288: agent 1..10 default 3, review 0..10 default 0), `timeout`, then one body: `prompt` +
  `allowed_tools`, or `smart_script` + `params`, or a `review` block (P286; `send_to`, `implementer` = earlier
  prompt step of the stage), plus `sandbox` (P287).
- Writer (`writer.go`) edits the `yaml.Node` tree in place (`applyWorkflow`, `applyStage`, `applyStep`,
  key orders `stageOrder`/`stepOrder`) so unedited files stay byte-identical; `Reader.New` writes a one-stage
  user workflow. No workflow ships preinstalled; samples live in `adeflow/testdata`.
- Engine (`ade/steps.go`, `runs.go`). A task row holds `stage_id` (stage id, `done`, `''`) and
  `current_stage_json` (stage snapshot on entry) plus `workflow_json`/`workflow_hash` (P196 whole snapshot,
  taken on first run, session or stage move). `stageSteps` turns the current stage into `stepDef`s (a script
  stage is one step with id = stage id, prompt = command; a user stage has none). `plan` = those steps with
  targets (`stepTargets`: once = first mine branch, each repo, only nick) and latest runs filtered by
  `stage_id`. `walkPath` follows routes from step 0; `nextAction`: first step only `StartRun` starts (Run
  dialog: branch names, message, worktree prep); later steps start themselves or wait for `Approve`;
  path past the end = `actStageComplete`. Stage complete never advances alone: the user clicks Done
  (`StageDone` → `nextRunnable`, skipping `skip` stages; past the last = `done`). The next agent or script
  stage then needs Run again. User stage: no runs; `LaunchStage` opens its interactive session (stage id
  `review` launches the review agent instead, `reviewStageID`); Done moves on.
- Routes (`route.go` `decideRoute`): `next`/`end`/forward id → run `done` with route; `end` = end of stage;
  `stop` → run `failed`; self or earlier → `decideLoop`: counts `back` rows per (task, stage, step, branch)
  (`countReturns`), stops at `max_returns` with catalog note, else queues the target (`pendingLoop`, `Loops`
  = next round, resumes the target's Claude session). `chainRerun` reruns stale downstream steps.
- Moves. `SetTaskStage(task, stage|done, fromStageId)`: any non-skipped stage either direction, refused while a
  run is live; runs stay (a revisited stage's latest runs show, so a revisited agent stage reads complete).
  UI: panel `AdeStageMover` (Back, Next, select), task menu "Move to stage" + "Skip <stage>", stage block
  "Move task here", phone Back/Next (`stageMoves`).
- Board. No column board exists. The Plan card shows one progress segment per stage (`progress.segments`,
  agent stages wider) and a status tag (`deriveStatus`: first untouched stage → To do, failed/stuck →
  Blocked, else the stage's `status`). Panel Workflow block: one `AdeStageBlock` per stage
  (`buildStageBlocks`), steps inside, a `release` stage id lists branches. Card action per stage kind
  (`actions.ts`: `stage` session, `run`, `approve`, `takeOver`, `retry`, `done`, `finish`).
- Snapshots: `refreshSnapshot` re-reads the stage from the task workflow on advance; `FillReturnLimits` on
  every decode site (`toWireTask`, `loadTaskCtx`, `taskWorkflow`, `decorateTask`). Wire `Task.currentStage`
  serves tasks whose workflow file is gone.
- Stored rows: `ade_runs(stage_id, step_id, branch_id, attempt, loops, ...)` (script stage: both = stage id;
  attempt is per stage, step, branch: `repos/adetask.go` `MAX(attempt)`), `ade_sessions(stage_id, step_id)`,
  `ade_reviews` (by run id), `ade_tasks(stage_id, current_stage_json, workflow_json, workflow_hash)`.
- Review (P286) waits in run state `review`; rounds are `purpose = review` rows with the step's ids.
  Sandbox (P287) per step, agent and review. Max returns (P288) per step.
- Graph editor: `AdeWorkflowGraph.vue` canvas (Vue Flow, locked dagre layout) with stage frames
  (`AdeStageGroupNode`), step nodes, end node per agent stage, `+ Add stage`; inspector pane shows
  `AdeStageInspector` or `AdeStepInspector`. Draft store `adeWorkflowDraft.ts` keys everything by stage.
- Step inspector today (baselines `workflow-graph-visual`, `workflow-graph-review-visual`): one flex-wrap row
  of label/select pairs (labels detach from their control: "Before this step" sits alone at a row end), a
  long Max returns hint, mode tabs Prompt/Smart script/Review, tools, prompt, a preview card that repeats the
  prompt, Sandbox block (shown for review steps too, always open), results cards, finish note. No section
  titles, no grouping, everything open, no visual order of importance.
- Prompts: `ade.stage.message` (`StageVars{StageName, StagePrompt}`), `ade.step.prompt` (`Step
  {{.StepNumber}}/{{.StepCount}}`, count = steps in stage), `headless.tool.task_info` ("workflow, stage"),
  `TaskInfo.Stage` (json `stage`) in the MCP tool result. Overrides are stored by entry id in the prompts
  file; an override naming an unknown template field turns Invalid.

## 1. Decisions (final)

1. **One list: a workflow has `steps`, no stages.** Step kinds: `agent` (headless `claude -p`; body `prompt`
   or `smart_script`), `script` (one shell command), `review` (P286 wait-for-user review), `manual` (your
   own work, optional interactive Claude Code session). Why: the four things a stage could hold today, without
   the container.
2. **Step fields by kind.** All: `id` (unique in the workflow), `name`, `kind`, `status` (optional; default
   In review for review, In progress otherwise), `skip`. Agent: `runs_on`, `before`, `results`, `max_returns`,
   `timeout`, prompt+`allowed_tools` or `smart_script`+`params`, `sandbox`. Script: `command`, `runs_on`,
   `before`, `results` (fixed ids `done`/`failed`, routes editable), `max_returns`, `timeout`. Review: as
   P286 (`review` block, `runs_on`, `before`, `results`, `max_returns`, `timeout`, `sandbox`). Manual:
   `session`, `prompt` (only with session); no runs_on, results, timeout. `kind` optional on read (default
   `agent`; a `review` block implies `review`); the writer always writes it. Why: per-kind fields are what
   the engine already reads; one spelling per fact.
3. **Routes.** `next` = next step in the list; `<step id>` later = jump (steps between are skipped), self or
   earlier = return (P288 `max_returns`, counter per task, step, branch); `end` = the workflow is finished;
   `stop` (not-ok results only) = run failed, task stays. Manual steps have one implicit `done → next`.
   Script steps: `done` (ok) and `failed` (not ok); legacy `on_failure` keeps working through
   `ImplicitResults`. Why: same engine rules, the list is just longer.
4. **Task position: entry step + derived current step.** `ade_tasks.stage_id` (column name kept) stores the
   *entry step*: the step the task last entered by create, move, manual Done or a return past it (`done`
   when finished, `''` without a workflow). The *current step* is derived: `walkPath` from the entry over
   current-pass runs; the first step not done. `ade_tasks.current_stage_json` (column kept) stores the pass
   watermark `since`: `{"<stepId>/<branchId>": attempt}`; runs with `attempt <= since[key]` are history.
   Why: no SQL migration; derived current step cannot drift from runs, as today's current step within a stage.
5. **How steps advance.** An automatic step (agent, script, review) reached by a forward route from another
   automatic step starts itself, or waits for Approve with `before: approval`. The entry step, when
   automatic and without current-pass runs, waits for Run (`StartRun`: branch names, message, worktree prep;
   today's `i == 0` rule). A manual step waits for you: Session (when `session: true`) and Done. Done
   (`StepDone`) sets entry = next non-skipped step, so the agents after a manual step wait for Run, as today
   after a user stage. Path past the last step or route `end` → task `done` automatically (no Finish click);
   a workflow wanting a last human check ends with a manual step. Why: keeps today's two human checkpoints
   (Run after your work, Approve gates) and drops the stage-boundary clicks that only existed because of
   stages.
6. **How a user moves a task.** `SetTaskStep(taskId, stepId | done, fromStepId)`: any non-skipped step in
   either direction, refused while a run is live. Effect: entry = target; `since` = latest attempt of every
   (step, branch) with runs, so the target and every later step run fresh (earlier runs stay as history).
   An automatic target waits for Run; a manual one waits for you. A return whose target lies before the
   entry moves the entry back to the target (`since` unchanged). UI: panel step mover (Back, Next, select),
   task menu "Move to step" + "Skip <step>", step row "Move task here", phone Back/Next. Stale guard
   `fromStepId` compares with the derived current step. Why: today's stage moves, per step, with a real
   rerun instead of a revisit that reads complete.
7. **Board columns (final): one progress segment per step, equal width; status tag from the current step's
   `status`; panel Workflow block = one row per step.** Why: there is no column board; the card strip and
   panel blocks are the "columns", and a flat list has no other grouping. To do = current step is the entry,
   it is the first non-skipped step, no runs, no sessions. Skipped steps draw muted.
8. **Per-repo scope unchanged**: `runs_on` on agent, script and review steps; manual steps are task-level
   (no branch, no runs). Why: scope is a step property already.
9. **Legacy workflow files fold on read; first Save writes flat.** `adewire.FoldStages` (one pure function
   used by the parser and by snapshot decode) maps stages to steps in order:
   - user stage → `manual` step (id = stage id, `session`, `prompt`); script stage → `script` step (id = stage
     id, `command`, `runs_on`, `timeout`, `on_failure` → results + `max_returns` via `ImplicitResults`/
     `LegacyLimit`); agent stage → its steps in order.
   - Ids: first occurrence keeps its id; a later duplicate becomes `<stage id>-<id>`, then `-2`, `-3` until
     unique. Routes and review `implementer` inside a stage are remapped with the stage's map.
   - Last step of an agent stage: `next` stays `next` (now the next stage's first step); `end` becomes the
     id of the next stage's first step, or `end` in the last stage.
   - Stage `status` copies to each of its steps when it differs from the step's kind default; stage `skip`
     copies to each of its steps.
   - The first step of an agent or script stage that directly follows another agent or script stage gets
     `before: approval` (keeps today's Done + Run checkpoint as one Approve). After a user stage: unchanged
     (manual Done → Run already waits).
   - The parser returns the fold map (`Workflow.Legacy map[string]string`, `json:"-"`): `"<stage>/<step>"` and
     `"<stage>/"` (stage entry) → flat id. Mixed `stages` + `steps` in one file is refused.
   Writer: a legacy document converts to `steps:` on Save, reusing the step `yaml.Node`s (comments on steps
   kept, stage head comments move to the stage's first step). An unedited legacy file is never rewritten.
   Why: user files stay valid with zero action; conversion happens only on an explicit Save.
10. **Stored tasks and runs: fold on decode + one boot backfill, no SQL migration.**
    - Decode: `adewire.DecodeWorkflow(raw)` folds a legacy snapshot (`"stages"` key) at every decode site
      (`taskWorkflow`, `decorateTask`, board). Robust when a backfill row failed.
    - Backfill `ade.(*TaskBoard).flattenStored()` in `Recover`, first, before `RecoverRunning` and
      `snapshotStartedTasks`. Per task (archived included) with a legacy snapshot, a legacy `stage_id` or
      legacy-shaped `current_stage_json` (has `kind`): fold map from its snapshot (else the live file's
      `Legacy`); one transaction (`repos.AdeTaskRepo.RewriteLegacy`): `ade_runs.step_id` and `stage_id` →
      flat id (all purposes; rebase rows not in the map stay), `ade_sessions.stage_id/step_id` → flat id,
      `workflow_json` → flat JSON and `workflow_hash` recomputed (`workflowHash`, so an unchanged live file
      shows no "updated" badge), `stage_id` → flat entry (stage → its first step; user/script stage id maps to
      itself; `done`/`''` kept; unknown → first step), `current_stage_json` → `since` = latest attempt per
      (step, branch) of runs from stages other than the old current stage (NULL when empty). Idempotent:
      a flat row matches no legacy marker. Logged per task at warn on failure, never fatal.
    - New rows write the step id into both `stage_id` and `step_id` (columns kept, `stage_id` never read).
    Why: few users, data must not break; a Go fold reuses `FoldStages` and is testable; schema stays.
11. **Snapshots.** `workflow_json` holds the flat workflow (taken as today). The per-stage snapshot and
    `refreshSnapshot` go: started tasks already read their whole snapshot (P196), so it was redundant.
    Wire `Task.currentStage` goes; a not-started task whose file is gone shows "workflow missing" (no
    progress), as a task with no workflow.
12. **Naming cleanup.** "Stage" leaves UI copy, i18n keys and values, docs, workflow files written by the app,
    prompt ids, fields and texts, MCP tool texts and Go/TS identifiers. Stays for stored-format compatibility
    only: SQL column names `ade_tasks.stage_id`, `ade_tasks.current_stage_json`, `ade_runs.stage_id`,
    `ade_sessions.stage_id` (appear only inside SQL strings in `repos/`; Go fields are renamed); the legacy
    reader (`adewire/legacy.go` `LegacyStage`, `FoldStages`, parser legacy branch, writer `convertLegacy`,
    prompt override fold) that must name what it reads. Full list §8. Why: SPEC asks no "stage" anywhere;
    stored data and user files must keep loading.
13. **Prompts.** `ade.stage.message` → `ade.manual.message`, `StageVars{StageName, StagePrompt}` →
    `ManualVars{StepName, StepPrompt}`, Go `AdeStageMessage` → `AdeManualMessage`; default text otherwise
    unchanged. Stored overrides fold on read (`llmprompts/store.go` `read`): a legacy id in
    `renamedIDs{"ade.stage.message": "ade.manual.message"}` moves to the new id and its text gets `.StageName`
    → `.StepName`, `.StagePrompt` → `.StepPrompt`; the next Save writes the new id. `ade.step.prompt`:
    `StepNumber/StepCount` count the workflow's automatic steps (agent, script, review) in list order; default
    text unchanged. `headless.tool.task_info` default: "workflow, stage" → "workflow, current step".
    `budget.tsv`: row id renamed, sizes refreshed by `promptsizes -snapshot` where they move; `checkprompts`
    green. `TaskInfo.Stage` → `Step` (json `step`, current step name). Store unit test: legacy override id and
    fields load under the new id, valid (interacting rename + validation rules). Why: SPEC asks no "stage" in
    code names; a read-time fold keeps user overrides.
14. **Step inspector redesign** (§6): header (name + kind), then plain-language sections, essentials first:
    "What it does", "Where it runs", "When it ends"; "Advanced" collapsed (timeout, allowed tools, status,
    skip, sandbox, finish_step preview). Fields per kind only. Labels above wide controls, two-column grid
    for short pairs (no orphaned labels). Why: today's single wrapped row reads odd; the user asked for
    friendlier.
15. **Canvas.** One column of step nodes, no frames; one End node. Step menu: Add step after ▸ (Agent,
    Script, Review, Manual), Move up, Move down (disabled when the swap would turn a forward route into a
    return), Make start, Skip/Unskip, Remove. Under the canvas: `+ Add step` (same kind submenu). Why: P288
    menus minus the stage level.
16. **Libraries.** shadcn-vue (`ToggleGroup` for kind, `Collapsible`, `Field*`, `Input`, `Textarea`,
    `NativeSelect`, `Switch`, `Checkbox`, `DropdownMenu`, `Card`, `Separator`), Tailwind utilities only,
    VueUse via the repo's `usePersistedState` for the Advanced open state, Pinia draft store (one concern),
    TanStack Query for bridge calls. `<script setup lang="ts">` everywhere. No new dependency.
17. **No new real `claude` test.** Engine paths are covered by fakeagent flows; run the existing ADE row once
    at the end with the renamed test names (§9).

## 2. Wire and fold (`internal/bridge/adewire`)

- `wire.go`: `StepKind` consts `agent|script|review|manual`. `PipelineStep` → `WorkflowStep` adding `Kind`,
  `Status`, `Skip`, `Session`, `Command` (json `kind,status,skip,session,command`). `Workflow.Stages` →
  `Steps` (json `steps`), `Legacy map[string]string` (`json:"-"`). `Stage` → `legacy.go` `LegacyStage`
  (fold input, unexported from the wire contract). `FillReturnLimits` on `Workflow` over steps (script uses
  `LegacyLimit(onFailure)`, review keeps 0). `Task`: `StageID` → `EntryStepID` (json `entryStepId`),
  `CurrentStage` removed, `Since map[string]int` (json `since`). `Run.StageID` removed. `SetTaskStageArgs` →
  `SetTaskStepArgs{TaskID, StepID, FromStepID}`; `LaunchStageArgs` → `LaunchStepArgs{TaskID, Message,
  FromStepID}`; `StartRunArgs.FromStageID` → `FromStepID`; `StepArgs.StageID` removed; `TaskInfo.Stage` →
  `Step`.
- `legacy.go`: `LegacyStage`, `LegacyWorkflow`, `FoldStages(stages []LegacyStage) (steps []WorkflowStep,
  legacy map[string]string)` per §1.9, `DecodeWorkflow(raw []byte) (Workflow, error)` (fold when the JSON has
  `stages`, then `FillReturnLimits`).
- `legacy_test.go` (interacting rules, CLAUDE.md bar): id collision → `<stage>-<id>`, `-2`; route remap in a
  stage; last-step `end` → next stage's first step; last stage `end` stays; status copy only when not
  default; skip copy; approval on agent→agent and agent→script boundaries, none after user; script
  `retry 2` → failed self, `max_returns: 2`; review implementer remap; snapshot JSON fold equals YAML fold
  (same hash input).

## 3. Files (`internal/adeflow`)

- `parse.go`: top-level `steps` (new) or `stages` (legacy → parse each into `LegacyStage` with today's rules,
  then `FoldStages`); both present → `use steps or stages, not both`. New `step(...)` validates per kind
  (§1.2): field allow-lists per kind (`<key> is not allowed on <kind> steps`), `kind must be agent, script,
  review or manual`, `id %q is already used by another step`, routes over the whole list, at least one
  non-skipped step, script `results` ids exactly `done`/`failed`, manual has no `results`. `stageKindAlias`
  stays for legacy only. Existing step rules (results, `max_returns`, sandbox, review, smart) move unchanged.
- `writer.go`: `topOrder` `id,name,kira_space_mcp,steps`; `stepOrder` gains `kind` (after `name`),
  `status`, `skip`, `session`, `command`; `applyWorkflow` writes `steps` via `syncItems`; `applyStep` per
  kind (drops other kinds' keys, writes `status` only when not the kind default, `skip` only when true,
  `on_failure` only when results reduce to it as today). `convertLegacy(root)`: when `stages` exists, build
  the `steps` sequence from stage nodes per the fold (reuse step nodes, re-key user/script stage mappings,
  move stage head comments), delete `stages`. `Reader.New`: one manual step `work`.
- `testdata`: `standard.yaml`, `bugfix.yaml`, `chore.yaml` rewritten flat; copies kept as
  `testdata/legacy/{standard,bugfix,chore}.yaml` for fold tests.
- Tests (`adeflow_test.go`, `writer_test.go`): legacy file parses to the expected flat workflow; flat
  round-trip byte-identical; legacy file Save → flat text equal to a golden; per-kind refusals; mixed refusal.

## 4. Engine (`internal/ade`), storage, bridge

- `steps.go`: `stageSteps` → `workflowSteps(wf)`; `stepDef` gains `Kind`, `Skip`, `Session`; manual steps have
  no targets. `stages.go` folds into `steps.go`: `firstStep`, `nextStep(wf, from)` (non-skipped). `walkPath(
  steps, entry)` starts at the entry index and passes over `Skip` steps (marked skipped); `nextAction` adds
  `actWaitUser` (manual at path end), `actComplete` replaces `actStageComplete`; the "only StartRun starts"
  rule applies to the entry index. `chainRerun` walks from the entry.
- `runs.go`: `taskCtx` holds `wf` (task workflow), `entry`, `since`; `loadTaskCtx` decodes via
  `taskWorkflow` + `since` JSON (legacy-shaped value → empty). `plan` filters runs by `step_id` and
  `attempt > since`. `advanceLocked`: `actComplete` → `SetEntryStep(task, "done", nil)`. `StageDone` →
  `StepDone` (current step must be manual: `the current step is not a manual step`). `SetTaskStage` →
  `SetTaskStep` (§1.6; skipped target refused; `since` built from `LatestRuns`). `StartRun`: the current step
  must be the entry, automatic, without current-pass runs (`the current step does not wait for Run`).
  `Approve(taskId, stepId)`. `staleStage` → `staleStep` (current step). `refreshSnapshot` removed.
- `route.go`: `decideRoute` ignores runs not of the current pass; `RouteEnd` → forward to `len(plan)`;
  `decideLoop` target before the entry → `SetEntryStep(task, target, since)`. `countReturns(runs, step,
  branch, upTo)` (stage arg dropped; P288 rule otherwise unchanged).
- `launches.go`: `LaunchStage` → `LaunchStep` (current step manual with `session`); `reviewStageID` →
  `reviewStepID` (`review_agent.go`); session rows carry the step id. `vars.go`: `composeStageMessage` →
  `composeManualMessage` (`ManualVars`, §1.13). Step numbering per §1.13.
- `reviewstep.go`: candidates = earlier agent prompt steps in the workflow on the branch (current pass);
  `reviewRun` checks the run is in the current pass, not `stage == current`. `agenttools.go`: `info.Step`.
- `taskwf.go`: `taskWorkflow`, `decorateTask` use `adewire.DecodeWorkflow`; `toWireTask` drops
  `CurrentStage`, sets `EntryStepID`, `Since`. `board_writes.go` (`CreateTask`, `PromoteBacklogItem`,
  `SetTaskWorkflow`): entry = `firstStep`.
- New `flatten.go`: `flattenStored()` per §1.10, called first in `Recover`. Unit test `flatten_test.go`
  (several interacting rules: map, entry, since, idempotence).
- `storage/model/adetask.go`: `AdeTask.StageID` → `EntryStepID`, `CurrentStageJSON` → `SinceJSON` (doc
  comments name the kept columns); `AdeRun.StageID` and `AdeSession.StageID` removed (inserts write
  `step_id` into `stage_id`). `repos/adetask.go`: `SetStage` → `SetEntryStep(taskID, stepID, since)`;
  queries keyed by `stage_id` switch to `step_id` (`MAX(attempt)`, return count, latest runs);
  `RewriteLegacy(taskID, LegacyRewrite)` one transaction. `repos/adesessions.go` likewise.
- `bridge/adetask.go`: bound `StepDone`, `SetTaskStep`, `LaunchStep` (count stays 58);
  `validateAdeFromStep`. `bridge/mobilewrite.go`, `mobileweb/{writer,writes,routes}.go`: `SetTaskStep`,
  `LaunchStep`, request `fromStepId`, result `{taskId, stepId}`, route `/api/ade/tasks/step` action
  `task.step` (audit log line only, not stored), `task.run`/`task.launch` keep paths with `fromStepId`.
- Catalog (`en.json`): engine refusals stay plain English `invalid(...)` as today; no new backend key.
- Go tests: `steps_test.go`, `stages_test.go` (merge into steps), `board_stage_test.go` → `board_step_test.go`,
  `runengine*_test.go`, `route` tests: stage args dropped, entry/skip cases added.

## 5. Board, run view, mobile (`apps/kira-space/frontend`)

- `ade/v2/wire.ts`: mirror §2 (`StepKind`, `WorkflowStep`, `Workflow.steps`, `Task.entryStepId`,
  `Task.since`, no `currentStage`, no `Run.stageId`, args renamed). `bridge/index.ts`: `adeTaskStepDone`,
  `adeTaskSetTaskStep`, `adeTaskLaunchStep`.
- `board/progress.ts`: `stepDefs(wf)` flat; `latestRun` skips `attempt <= since`; `walkPath(ids, steps,
  entry)` mirrors Go (skip, entry); `TaskProgress.stage` → `step` (current), `stageIndex` → `stepIndex`,
  `segments` per step (`StepSegment`, no `wide`), label `<current step> <done>/<total automatic>`,
  `finished` = `entryStepId === 'done'`.
- `board/stageBlocks.ts` → `stepBlocks.ts` (`StepBlock`, `buildStepBlocks`: one block per step, states
  past/now/next/skipped; manual block text "Waiting for you" / "Your own work"; `release` keyed by step id
  `release`), `routeText`, `fixRound`, `backLimit` over the flat list. `stageMoves.ts` → `stepMoves.ts`.
- `board/status.ts`: §1.7. `board/actions.ts`: `stepAction` by current step kind: manual → `session`
  (was `stage`) or `done`/`finish` (finish when no later non-skipped step); entry automatic pending → `run`;
  gated → `approve`; stuck → `takeOver`; failed → `retry`. `board/menu.ts`: `moveStep` cmd, "Move to step"
  submenu, "Skip <step>". `board/needsYou.ts`: `stepId` only. `board/runMessage.ts`, `dialog/*`: step names.
- `panel/AdeStageBlock.vue` → `AdeStepBlock.vue` (one row per step; manual row: Session/Done buttons; "Move
  task here"); `AdeWorkflowBlock.vue` lists step blocks; `AdeStageMover.vue` → `AdeStepMover.vue`.
  `plan/AdeTaskCard.vue` segments `flex-1` each. `run/useTaskAction.ts`: `StepDone`, run dialog for
  agent entry, direct `StartRun` for script/review entry. `run/AdeRunDialog.vue`: title "Run <step>",
  preview of the entry step. `queries.ts`: `useStepDone`, `useSetTaskStep` (`withStep` optimistic patch),
  `useLaunchStep`. `state/adeDialogs.ts`: `session(taskId)`.
- Mobile: `state/useAgentsModel.ts`, `state/useTaskActions.ts` (step names, confirm texts),
  `api/adeWriter.ts` (`setTaskStep`, `launchStep`, `/api/ade/tasks/step`), `state/useAdeWrites.ts`,
  `screens/PlanTaskCard.vue`.
- Unit specs: `tests/unit/ade-v2-progress.spec.ts`, `ade-v2-board-parity.spec.ts`, `ade-v2-dialog.spec.ts`
  fixtures flat; add walkPath entry/skip cases to progress spec (parity with Go).

## 6. Workflow editor and step inspector (`ade/v2/workflows`, `board/workflowGraph.ts`, `state/adeWorkflowDraft.ts`)

Canvas:
- `workflowGraph.ts`: `layoutWorkflow(wf)` over `wf.steps`: one spine column, nodes `256x104`, result fans
  and loop gutter as today, one End node; manual and script nodes use their implicit results; skipped steps
  dashed and muted. Remove stage group/leaf nodes, `layoutAgent` merge, per-stage end nodes. `setRoute`,
  `normalizeOrder`, `reclassify`, `reaches` take the flat list. New `canMove(wf, id, delta)`.
- `state/adeWorkflowDraft.ts`: selection `{ stepId }`; `createStep(afterId | null, kind)`, `moveStepBy(id,
  delta)`, `patchStep(id, p)`, `replaceStep(step)` (kind change via `withKind`), `removeStep(id)`, result ops
  without `stageId`; stage ops removed.
- `board/workflowForm.ts`: `newStep(kind, ids)`, `withKind(step, kind)` (keeps id, name, `runs_on` when the
  target kind has it, resets the rest to kind defaults, review defaults per P286/P288), `kindLabel(kind)`;
  `newStage`, `runnableCount` → `runnableSteps`.
- `AdeStepNode.vue`: kind chip (Agent amber, Script green, Review blue, Manual grey), number = list position,
  menu per §1.15 (`ade-wf-step-menu`, items `ade-wf-step-add-after-<kind>`, `ade-wf-step-up`,
  `ade-wf-step-down`, `ade-wf-step-start`, `ade-wf-step-skip`, `ade-wf-step-remove`). Delete
  `AdeStageGroupNode.vue`, `AdeStageInspector.vue`. `AdeWorkflowGraph.vue`: `+ Add step` dropdown
  (`ade-wf-add-step`, items `ade-wf-add-step-<kind>`) replaces `+ Add stage`; no stage selection;
  `AdeEndNode.vue` label "End".

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

Rename (key → key, text updated, "stage" → "step"):
- `space.ade.board.taskMenu.moveToStage.label` → `moveToStep`; `…skipStage.label` → `skipStep`.
- `space.ade.board.taskAction.stage.{label,tooltip}` → `taskAction.session.{label,tooltip}`;
  `taskAction.done.tooltip`, `doneLast.tooltip`, `retryFailed`, `retryStuck`, `runAgents.tooltip`: var
  `{stage}` → `{step}`.
- `space.ade.claudeDialog.stage.title` → `claudeDialog.step.title`; `space.ade.runDialog.title.title` var.
- `space.ade.outcome.routeEnd.label` → "→ End".
- `space.ade.panelFacts.why.stage.hint` → `why.step.hint`.
- `space.ade.progress.stage{Agent,Script,User,Done}.label` → `progress.step{Agent,Script,Manual,Review,Done}`.
- `space.ade.stage.*` (15) → `space.ade.step.*`; `space.ade.stage.modeUserSession.label` → `step.modeManual`.
- `space.ade.stageBlock.*` (8) → `space.ade.stepBlock.*`; `skipThis.label` "Skip this step".
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
  first message of a manual step session…"); `llmPrompts.var.stageName` → reuse existing `var.stepName` (or add
  it if absent), `llmPrompts.var.stagePrompt` → `var.stepPrompt`; texts of
  `llmPrompts.entry.{adeJiraLine,adeRepoLine}.usedBy.body`, `llmPrompts.var.{stepCount,stepNumber}.description`
  ("in the workflow").
- `space.common.stage.label` → `space.common.step.label`.
Remove: `graph.addStageAfter.label`, `graph.stageMenu.aria`, `stageInspector.{addStep,name.aria,remove,skip,
unskip}`, `kind.agentBackground.option`, `field.onFailure.label`, `onFailure.*` if unused, `progress.stageUser`,
and any key copy-coverage reports unused. Add: kind labels `space.ade.workflows.kind.{agent,script,review,
manual}.option`, section titles `space.ade.workflows.stepInspector.section.{what,where,end,advanced,sandbox}.
label`, `…instructions.label`, `…start.label`, `…start{Auto,Approval}.option`, `…runsOnHint.{once,each,only}`,
`…status.label`, `…skip.label`, `…session.label`, `…sessionPrompt.label`, `…manualNote.hint`,
`…scriptNote.hint`, `…kindChange.{title,body}`, `space.ade.workflows.graph.addStepKind.aria`,
`space.ade.workflows.stepNode.kind.<kind>.label`, `space.ade.step.waitingYou.status`.
Unrelated "stage" texts stay (`git.*` staging, `backend.core.appUpdate.stageFailed`, `studio.grid.*`).

## 8. Rename scope (exact)

- Go renamed: `adewire.{PipelineStep→WorkflowStep, Workflow.Stages→Steps, Task.StageID→EntryStepID,
  SetTaskStageArgs→SetTaskStepArgs, LaunchStageArgs→LaunchStepArgs, *.FromStageID→FromStepID,
  TaskInfo.Stage→Step}`, `adewire.Stage→LegacyStage` (legacy only); removed `Task.CurrentStage`,
  `Run.StageID`, `StepArgs.StageID`. `ade.{StageDone→StepDone, SetTaskStage→SetTaskStep,
  LaunchStage→LaunchStep, stageSteps→workflowSteps, firstRunnable→firstStep, nextRunnable→nextStep,
  staleStage→staleStep, reviewStageID→reviewStepID, composeStageMessage→composeManualMessage,
  actStageComplete→actComplete}`, removed `refreshSnapshot`, file `stages.go`. `model.{AdeTask.StageID→
  EntryStepID, AdeTask.CurrentStageJSON→SinceJSON}`, removed `AdeRun.StageID`, `AdeSession.StageID`.
  `repos.SetStage→SetEntryStep`. Bridge/mobile methods and route per §4. `llmprompts.{AdeStageMessage→
  AdeManualMessage, StageVars→ManualVars, StageName→StepName, StagePrompt→StepPrompt}`, id
  `ade.stage.message→ade.manual.message`. Tests: `TestAdeStageSession` → `TestAdeManualSession`
  (tests/claude), `board_stage_test.go` → `board_step_test.go`, `stages_test.go` merged into `steps_test.go`.
- TS/Vue renamed: types per §5; files `stageBlocks.ts→stepBlocks.ts`, `stageMoves.ts→stepMoves.ts`,
  `AdeStageBlock.vue→AdeStepBlock.vue`, `AdeStageMover.vue→AdeStepMover.vue`; deleted
  `AdeStageGroupNode.vue`, `AdeStageInspector.vue`; queries, bridge entries, dialog action, menu cmd, mobile
  writer per §5.
- Stays (stored format): SQL column names `ade_tasks.stage_id`, `ade_tasks.current_stage_json`,
  `ade_runs.stage_id`, `ade_sessions.stage_id` (inside SQL strings only); legacy reader code named for what it
  reads (`LegacyStage`, `FoldStages`, `convertLegacy`, `renamedIDs`) and its tests/fixtures
  (`adeflow/testdata/legacy/`).
- Size: about 37 Go files, 45 TS/Vue files, 34 spec files, 65 i18n keys renamed or edited, 20 added, 12
  removed, 1 prompt id and 1 prompt default changed, 3 docs.
- Guard: after the rename, `rg -i 'stage' apps/kira-space/{internal,frontend} internal/llmprompts
  site/src/content/docs/docs/space` hits only the stays above, git staging texts and the update installer;
  the close-out lists the remaining hits.

## 9. Tests (split at the IPC boundary)

| Scenario | Go flow (fakeagent; new `internal/flows/adeflow/flatsteps_test.go` `TestFlatSteps`) | UI spec (new `tests/ui/ade-v2-flat-steps.spec.ts`, `contract:` cases) |
|---|---|---|
| Full pass | flat file: manual `spec` (session) → agent `impl` (each repo) → review → script `release`. Create: entry spec, To do. `LaunchStep` session; `StepDone` → entry impl, waits Run; `StartRun` → impl done → review waits → `FinishReview approved` → script runs → task `done` with no click. Contracts `ade-flat-steps#{created,manual,run,review,done}` | card: one segment per step, status tag from step status, actions Session → Done → Run → review → Merged/Archive; panel step rows; manual row Done button |
| Moves | after impl done, `SetTaskStep(impl)` back: `since` set, impl waits Run, rerun counts fresh; `SetTaskStep(release)` forward; refused while live; to `done`. Contract `#moved` | Move to step submenu, step row Move task here, step mover Back/Next; reran step shows pending, earlier runs hidden |
| Return past entry | entry = review (moved), review `rework` → impl (before entry): entry becomes impl, impl reruns, return counted. Contract `#return` | `↩ 1/3` chip on impl |
| Legacy file | `testdata/legacy/standard.yaml` loads: flat ids, `before: approval` on the release step, manual `spec`/`review`; `SaveWorkflow` writes flat (no `stages:`); unedited file bytes unchanged after `Workflows`. Contract `#legacy` | editor shows the folded list, no frames; Save payload has `steps` |
| Stored legacy rows | seed task rows in legacy shape (snapshot with stages, stage_id = agent stage, runs with stage/step ids incl. a review round and a collided id); boot: `Board` task has `entryStepId` = first step of that stage, runs mapped, `since` covers other-stage runs, no outdated badge; second boot changes nothing. Contract `#backfill` | board renders the backfilled contract: segments, current step, run lines |
| Editor | `SaveWorkflow` with one step per kind; file has `kind` per step, manual without results; reload equal. Contract `#workflow` | inspector: kind toggle switches field groups; Advanced closed by default and remembered; Add step after ▸ Script; Move up disabled when it would create a return; save payload |

- Updated Go tests: every `internal/flows/adeflow/*_test.go` and `mobileflow`, `journeyflow`, `usageflow`,
  `notifyflow` that call stage APIs or assert `StageID` (36 files reference stages; legacy YAML inputs stay
  where they only feed a scenario, so they also prove the fold); `ade` unit tests; `adeflow` parser/writer;
  `mobileweb` route tests; `bridge/adewire/wire_test.go`.
- Contracts: regenerate (`KIRA_CONTRACT=write go test -p 2 ./internal/flows/...`) and the frozen fixtures in
  `tests/fixtures/ade-v2/` (`workflows.json`, `task.json`, `board.json`, `start-run.json`, `launch.json`,
  `event-runs.json`, `workflow-validation.json`, `workflow-yaml.json`); expected diff: `stages` → `steps`,
  `stageId`/`currentStage` gone, `entryStepId`, `since`, `kind`. New `ade-flat-steps.json`.
- Updated UI specs: `ade-v2-workflows.spec.ts` (stage frame/menu cases → step menu, Add step by kind,
  inspector sections), `ade-v2-workflow-layout.spec.ts`, `ade-v2-review-step.spec.ts`,
  `ade-v2-return-limit.spec.ts`, `ade-v2-sandbox.spec.ts` (sandbox now under Advanced), `ade-v2-plan.spec.ts`,
  `ade-v2-panel.spec.ts`, `ade-v2-run.spec.ts`, `ade-v2-launch.spec.ts`, `ade-v2-task-menu.spec.ts`,
  `ade-v2-resume.spec.ts`, `ade-v2-review-open.spec.ts`, `ade-v2-sessions.spec.ts`, `ade-v2-automations.spec.ts`,
  `ade-v2-base-rebase.spec.ts`, `ade-claude-missing.spec.ts`, `copy-coverage.spec.ts`, `consistency.spec.ts`,
  `ui-leftovers.spec.ts`; mobile `tests/mobile/{writes,tabs,ui-leftovers}.spec.ts`, `support/mockServer.ts`.
- Visual baselines (re-record in the sandbox per `docs/DEV_ENVIRONMENT.md`, Linux only; macOS not recorded):
  `ade-workflow-graph.spec.ts` `workflow-graph-visual`, `workflow-graph-branches-visual`;
  `ade-review-step.spec.ts` `workflow-graph-review-visual`; `ade-sandbox.spec.ts` `sandbox-popover-visual`
  only if its diff shows the run view changed. New: `workflow-graph-manual-visual` (manual step selected,
  session on) and `workflow-graph-script-visual` (script step selected) in `ade-workflow-graph.spec.ts`.
- Real `claude` (Linux sandbox, once after test-and-fix; report spend): `bun run test:claude:space -run
  'TestAdeHeadlessRun|TestAdeStepResults|TestAdeManualSession|TestAdeRebaseRun|TestAdeResumeRun|
  TestAdeResumeLost|TestAdeReviewStep|TestAdeReviewLost|TestAdeSandbox|TestAdeSandboxReadOnly' -count=1`.
  `tests/claude/*.go` workflows become flat YAML. Mac: the sandbox row's macOS half runs only on a real Mac;
  if none is available, record "not run on macOS" in the close-out, as P287 did.

## 10. Docs

- `site/src/content/docs/docs/space/agents.mdx` (terse, P284 rule): Workflows: "A workflow is a list of
  steps"; the four kinds; per-kind fields; routes (`end` = workflow done); how a task moves (Run, Approve,
  Done, auto finish, Move to step, history); legacy files ("older files with `stages` still load; Save writes
  steps"); graph editor (step menu, `+ Add step`, inspector sections and Advanced); YAML example flat. Return
  limit text: "per task, step and branch". `bun run lint`, `site:check` green.
- `docs/ARCHITECTURE.md`: Model and scope bullet (flat steps, kinds); new bullet "Flat steps (P293)": entry
  step + derived current step, `since` watermark in `current_stage_json`, columns kept, `FoldStages`,
  `DecodeWorkflow`, `flattenStored` backfill, auto finish; update Return limit (key without stage), Graph
  editor (no frames, step menu, Move up/down), Review step ("the step waits"), Task snapshot (no stage
  snapshot, no `refreshSnapshot`), replace the Stage `skip` bullet with step `skip`. Known open items: none
  expected.
- `docs/DEV_ENVIRONMENT.md`: ADE row test name `TestAdeStageSession` → `TestAdeManualSession`.
- `docs/v2.5/SPEC.md` P293 row: status and result note at close-out (row text is the other agent's).

## 11. Execution (one sequential Sonnet implementer)

No streams: wire, files, engine, backfill, UI depend on each other in order. Each commit passes the normal
hook (typecheck, lint incl. `checkprompts`, build); Go commits land before the TS ones (TS wire is
hand-written, so the hook stays green between them). Resume after interruption: `git log --oneline
<base>..`; continue at the first missing commit.

1. `feat(adewire): flat workflow steps with legacy stage fold` (§2, additive: new types next to old, fold +
   test). Files: `adewire/{wire,legacy,legacy_test,results}.go`.
2. `feat(adeflow): parse and write flat workflow files` (§3, wire switch for files). Files: `adeflow/*.go`,
   `testdata/**`, Go compile fixes in callers.
3. `feat(ade): flat step engine` (§4 engine, storage, bridge, mobileweb; Go unit tests). Files:
   `ade/*.go`, `storage/{model,repos}/*.go`, `bridge/{adetask,mobilewrite}.go`, `mobileweb/*.go`,
   `adewire/wire.go` (remove `Stage` from wire).
4. `feat(ade): fold stored tasks and runs to flat steps` (`flatten.go`, `RewriteLegacy`, tests).
5. `refactor(space): flat steps in board, run view and phone` (§5, copy keys it uses).
6. `feat(space): flat workflow canvas` (§6 canvas, draft store, workflowForm, unit graph spec).
7. `feat(space): step inspector redesign` (§6 inspector, copy keys).
8. `refactor(prompts): manual step message and step wording` (§1.13; `llmprompts/{registry,store}.go`,
   store test, `ade/vars.go`, i18n entry keys, `budget.tsv`; `checkprompts` green).
9. `test(ade): flat steps flow tests and contracts` (§9 Go rows, updates, contract regen, fixtures).
10. `test(space): flat steps UI specs and visual baselines` (§9 UI rows, spec updates, re-record 3 + 2 new).
11. Full test pass once: Go `-race` on `ade`, `adeflow`, `adewire`, `flows/...`, `mobileweb`; UI, unit,
    mobile and visual suites; fixes as `fix:` commits.
12. `docs: flat workflow steps` (§10).
13. Real `claude` ADE row; fixes as `fix:` commits; report spend.

## 12. Risks

- Behaviour change: automatic steps across old stage boundaries now flow; the fold adds `before: approval`
  there, and manual Done keeps Run. A user who relied on Done to pause after an agent stage gets Approve.
- Auto finish: a workflow ending with an automatic step finishes without a click; Archive stays manual.
- Backfill on a corrupt snapshot: the task keeps `DecodeWorkflow` fold at read; runs whose ids cannot map
  stay with old ids and show as history. Logged.
- Id collisions rename steps (`<stage>-<id>`); the first Save writes those ids, and run history moves with
  them through the backfill.
- First Save of a legacy file rewrites its layout; stage-level comments move to the first step.
- Prompt overrides: an `ade.stage.message` override folds to `ade.manual.message` on read; a hand-edited
  override using other template syntax around the old fields still validates through the normal path.
- Size: largest single commit is step 3; keep it compiling, push nothing until hooks pass.

## 13. Out of scope

- Step groups, lanes or any grouping concept; drag-and-drop reordering on the canvas.
- SQL schema changes or column renames.
- New run states, parallel steps, per-step task status beyond today's four values.
- Results on manual steps; `before` on manual steps.
- Changes to P286 review, P287 sandbox, P288 return counting rules beyond dropping the stage key.
- Mobile UI redesign beyond renames and step moves.
