# P247 plan: workflow branching overhaul

SPEC row P247. Planned against `c10610314` (v2.0 after P242 Part 4 landed). One sequential Sonnet
implementer; no stream split (engine, wire, MCP and editor share types and order-dependent work).

Discovery: `codegraph sync .` first, then `codegraph_explore` over `internal/claudeheadless`
(`finishStep`, `finishArgs`, `checkFinish`, `buildMCPServer`, `startLocked`, `Register`, `Grant`,
`Finish`, `FinishStepSuffix`, `addOutcomeTool`, `Outcomes`), `internal/runoutcome` (`Outcome`,
`ForProcess`), `internal/flowtest/fakeagent` (`finishAction`, `callTool`, `runSideEffects`),
`internal/scriptruns` (`Service`, `planADE`). `apps/kira-space/**` is not in the index; read directly:
`adeflow/{parse,writer}.go`, `bridge/adewire/wire.go`, `ade/{steps,sendback,runs,smartstep,vars,
launches}.go`, `storage/model/adetask.go`, `storage/repos/adetask.go` (`RunsOfTask`, `CountRuns`,
`LatestRuns`), `storage/migrations` (`ade_runs.state` CHECK), `agentnotify/agentnotify.go`,
`flows/coverage/{coverage_test.go,exempt.txt}`, frontend `ade/v2/{wire.ts,workflows/*,board/
{workflowForm,progress,stageBlocks,needsYou,runMessage}.ts,state/adeWorkflowsUi.ts,automation/
smartStepBody.ts,run/AdeRunDialog.vue}`, `packages/theme/src/components/{VarText.vue,ui/*}`,
`scripts/check-ade-colours.sh`, `apps/kira-space/frontend/src/ade/v2/tones.css`, root `package.json`,
`docs/v2.2/plans/P243-plan.md` section 6 (P243 Part 2 ownership).

## 0. Requirements carried

- R1 `finish_step` reports a result that is ok or not ok.
- R2 A workflow step declares several allowed results, some ok, some not ok.
- R3 The MCP tool requests exactly one of the running step's results (schema enum per run).
- R4 The workflow branches on the chosen result: go back to another step, retry loops.
- R5 Loops are bounded (per-edge max), never infinite.
- R6 Existing workflow files and started tasks' snapshots behave exactly as today.
- R7 P241 fields (`reason`, `conflictedFiles`, `lastGitError`, `tried`) stay on `finish_step`; the
  result lands in the shared `runoutcome` outcome and in `run_outcome`.
- R8 Editor overhaul: graph-style editor, no up/down buttons.
- R9 Edge colour: ok results green, not-ok red; when ok and not-ok results lead to the same next
  step, the edge keeps the normal colour.
- R10 Previews use `VarText` (prompt variables and the generated finish instruction).
- R11 Result and route shown on board, task panel, Needs you and the P238 notification; a failed
  branch (stop route or spent loop) needs the user.
- R12 Tailwind, shadcn-vue, VueUse, Pinia, TanStack Query; one vetted fully open-source graph library.
- R13 Tests only per CLAUDE.md bar; flow-coverage gate green with `exempt.txt` empty.

## 1. Current tree (verified)

- YAML (`adeflow/parse.go`): agent step keys `id name runs_on before on_failure timeout prompt
  allowed_tools smart_script params`; `on_failure` = `stop | retry 1 | retry 2 | back:<earlier step
  id>` (script stage: no `back:`). Strict: unknown key is an error. Writer (`writer.go`) edits the
  `yaml.Node` tree in place, keyed by `id` (`syncItems`), key order `stepOrder`, drops defaults.
- Wire `adewire.PipelineStep{... OnFailure ...}`, TS mirror `ade/v2/wire.ts`. Task stage snapshots
  (`CurrentStageJSON`) and task workflow snapshots carry this JSON, so old shapes persist in the DB.
- Engine (`ade/steps.go`): linear per stage. `nextAction` walks steps in list order; failed step
  retries while `attempt <= retryLimit`; `chainRerun` re-queues stale runs (`loops < round`) after a
  send-back. `sendback.go` `decideSendBack`: failed `back:` run -> state `back`, target step resumed in
  its Claude session with a fix line, max 3 rounds (`maxSendBackRounds`), counted by
  `CountRuns(..., AdeRunBack)`. `recordOutcomeLocked` applies it; `advanceLocked` moves on.
- Run states (DB CHECK): `pending running stuck failed back done`. No `skipped`.
- `finish_step` (`claudeheadless/mcp.go`): `status` free string validated to `done|failed|
  needs_input`; schema inferred from `finishArgs` (no enum). The HTTP handler picks one of 8 prebuilt
  `*mcp.Server` by grant flags, so no per-run schema today. `FinishStepSuffix` is one constant;
  appended by `vars.go composePrompt/composeResumePrompt` and `smartstep.go`. TS mirror
  `FINISH_STEP_SUFFIX` in `board/runMessage.ts`, shown in `AdeRunDialog.vue` and `AdeStepCard.vue`.
- `fromFinish`/`finishState` (`runs.go`) map status to run state; `reportOf` keeps P241 detail in
  `model.AdeRunOutcome.Report`. Taken-over TUI runs report through the same tool
  (`launches.go prepareWithGrant`, `applyTUIFinish`).
- Editor: `AdeWorkflowEditor.vue` (Form/YAML toggle) -> `AdeWorkflowForm.vue` -> `AdeStageCard.vue`
  (up/down/remove) -> `AdeStepCard.vue` (up/down/remove, `On failure` select). Helpers
  `board/workflowForm.ts` (`moved`, `backOptions`, `withValidBacks`). Page state Pinia
  `state/adeWorkflowsUi.ts`. Save via TanStack `useSaveWorkflow`.
- Colours under `ade/` must be `--kira-*`/tone tokens (`scripts/check-ade-colours.sh`); tone colours
  exist as Tailwind theme colours `tone-{green,red,grey,...}{,-solid,-tint}` (`tones.css`).
- No graph library in the repo. `vue-draggable-plus` is a root dependency already.
- Space flow-coverage gate `flows/coverage`, `exempt.txt` empty.

## 2. Decisions (planner defaults; user may override)

- D1 Field name stays `status`. Its enum per run is the step's result ids plus `needs_input`. A step
  with no declared results has the implicit pair `done` (ok) and `failed` (not ok), so its enum is
  exactly today's three values; rebase runs and smart-script runs (Automations) keep that enum too.
  Reason: no break for P241 rebase prompts, `ScriptReportSuffix`, fakeagent, real-claude tests.
- D2 Results are a YAML list (order = enum order), keyed by `id` like stages and steps.
- D3 Routes: `next` (following step; stage complete after the last), a step id of the same stage,
  `end` (stage complete; rest of the path skipped), `stop` (halt; Needs you). Defaults: ok -> `next`,
  not ok -> `stop`. `stop` only on a not-ok result. Cross-stage routes are out of scope: stage moves
  stay user-driven (`StageDone`, `SetTaskStage`).
- D4 Edge kinds by list position: target after the source = forward; target equal or before = loop
  edge. Loop edges carry `max` (1..10, default 3; legacy `retry N` = self loop, max N; legacy `back:`
  = max 3). Counts are cumulative per (task, stage, step, branch, result), never reset, so total
  runs per stage are bounded by the sum of maxes. Spent budget falls to `stop` with the note
  "<reason> (sent back N times)" as today.
- D5 Self loop = fresh attempt (no resume), like today's retry. Earlier-step loop = today's send-back
  (resume the target's Claude session with a fix line, chain re-runs after it). Run state for any loop
  route is `back` (shown "sent back" or "retry n of max").
- D6 A run that routes forward ends `done`, even for a not-ok result; the outcome keeps `status:
  failed` and the result id, so UI shows "failed, continued". A `stop` route ends `failed`.
- D7 No report (crash, timeout, exit without `finish_step`): use the step's result named `failed` when
  it exists (keeps legacy `retry N`/`back:` behaviour on crashes), else `stop`.
- D8 Steps on different branches (`runs_on`) settle at step level as today. A step's forward target
  is the earliest forward target among its target runs (skips the least). Loop routes stay per branch.
- D9 Skipped steps are a view, not rows: no `skipped` run state, no migration. The engine walks the
  route path; steps off the path are skipped. Old runs without a stored route count as `next`.
- D10 Wire keeps `PipelineStep.onFailure` (legacy snapshots and display) and adds `results` (always
  materialized by the parser; engine falls back to `onFailure` when an old snapshot has none). The
  writer derives YAML from `results` alone: when the results equal an implicit legacy form it writes
  `on_failure` (or nothing for `stop`) and no `results`; otherwise `results` and no `on_failure`.
  `results` and `on_failure` together on one step is a parse error.
- D11 Script stages unchanged (`on_failure` stop/retry N; a self loop in the graph). Smart-script
  steps may declare results (they report through `finish_step` already).
- D12 Graph library `@vue-flow/core` 1.48.2 (MIT; released 2026-01-28) with `@dagrejs/dagre` 3.1.1
  (MIT; 2026-08-08) for layout. License check below (section 3.7). Declined: `elkjs` (EPL-2.0, heavier,
  not needed for <50 nodes); hand-rolled SVG (pan/zoom, handles, edge routing and hit-testing are
  exactly the infrastructure CLAUDE.md says to take from a library); `@vue-flow/controls`,
  `@vue-flow/background`, `@vue-flow/minimap` (own Tailwind toolbar is enough).
- D13 Auto-layout on every edit; no stored node positions (no YAML noise, no layout drift). Nodes are
  not draggable; the canvas pans and zooms.
- D14 Step order in YAML follows the graph: the editor keeps the start step first and a topological
  order of forward edges (stable to the current order). A new edge that would close a forward cycle
  becomes a loop edge. Stage order: drag the stage strip (`vue-draggable-plus`). Up/down buttons gone.
- D15 Editor mode values `graph | yaml` (label "Graph"); `form` is removed.
- D16 Run state on the wire unchanged. `runoutcome.Outcome` gains `Result`; `model.AdeRunOutcome`
  gains `Route` (resolved target: step id, `end`, `stop`, or `back:<id>`/`retry`), both JSON in the
  existing outcome column. No migration.
- D17 No new bound method. If the implementer adds one, a flow test calls it; `exempt.txt` stays
  empty.
- D18 The graph editor is `defineAsyncComponent`-loaded, so the board bundle does not carry Vue Flow.

## 3. Design

### 3.1 YAML format and parser (`apps/kira-space/internal/adeflow/parse.go`)

```yaml
- id: review
  name: Review
  runs_on: once
  prompt: Review the diff of {branch}.
  results:
    - id: approved
      ok: true
      description: The change is ready.
    - id: changes
      ok: false
      description: The change needs work; say what.
      next: impl
      max: 3
    - id: trivial
      ok: true
      next: end
```

- Step allowed keys add `results`. Result keys: `id` (required, `idPattern`, unique, not
  `needs_input`), `ok` (required bool), `description` (optional, one line, at most 200 characters),
  `next` (optional; `next|end|stop|<step id of this stage>`), `max` (optional int 1..10, only on a loop
  edge). 1 to 12 results.
- Rules (first error wins, line numbers as today): unknown step id in `next`; `stop` on an ok result;
  `max` on a forward route; at least one result routes forward (else the stage can never complete);
  `results` with `on_failure` on one step.
- `next` may name a later step: forward check needs the full step list, so resolve targets in a second
  pass after all step ids are known (today `back:` uses `earlier`).
- Materialize: `step.Results` always set. Absent `results`: `[{done ok next}, {failed !ok
  <legacy route>}]` from `on_failure`. `step.OnFailure` = legacy value when representable, else `""`.
- Pure helpers in a new `adeflow/results.go`: `ImplicitResults(onFailure)`, `LegacyOnFailure(results)
  (string, bool)` (used by the writer, D10). Engine uses its own copy through `adewire` types; to avoid
  a dependency cycle put both helpers in `bridge/adewire/results.go` if `ade` cannot import
  `adeflow` (check imports; `ade` already imports `adewire`).

### 3.2 Writer (`adeflow/writer.go`)

- `stepOrder` adds `results` after `on_failure`.
- `applyStep`: if `LegacyOnFailure(s.Results)` holds -> `dropKeys("results")`, write `on_failure` as
  today. Else -> `dropKeys("on_failure")`, `syncItems` on `results` keyed by `id`, per item
  `setScalar` for `id`, `ok` (`kBool`), `description` (only when set), `next` (only when not the
  default), `max` (only when not 3). Comments on unchanged results survive (same `syncItems` path).
- `encodeWorkflow` re-parses, so an invalid graph is refused with the parser message as today.

### 3.3 Wire (`bridge/adewire/wire.go`, `frontend/src/ade/v2/wire.ts`)

- `StepResult{ID string "id"; OK bool "ok"; Description string "description"; Next string "next";
  Max int "max"}`. `Next` is `next|end|stop|<step id>`; `Max` 0 means "not a loop" on the wire for
  forward routes, else 1..10 (parser fills 3 by default on loops).
- `PipelineStep.Results []StepResult "results"` (never nil). `OnFailure` kept (D10).
- `model.AdeRunOutcome.Route string "route,omitempty"` (`storage/model/adetask.go`, one field).
- `runoutcome.Outcome.Result string "result,omitempty"` (`internal/runoutcome/outcome.go`) and
  `packages/shared/domain/runOutcome.ts` (`result: z.string().optional()`). TS `AdeRunOutcome` adds
  `route?: string`.
- Regenerate `apps/kira-space/frontend/bindings/**` (Wails) after the Go change.
- Fixtures `tests/fixtures/ade-v2/{workflows,board,workflow-yaml}.json`: add `results` to every step
  (materialized form).

### 3.4 MCP (`internal/claudeheadless`)

- `Grant` gains `Results []ResultSpec{ID, OK, Description}`; empty = implicit `done`/`failed`.
- Per-run schema: `Register` builds the registration's `*mcp.Server` when `Grant.RunID != ""` and keeps
  it on the `registration`; the handler returns it for that token, else the shared flag-keyed servers
  (Space-only and outcome-only grants). Tool input schema: infer from `finishArgs` with
  `jsonschema.For[finishArgs]` (go-sdk v1.8.0 re-exports google/jsonschema-go), then set
  `Properties["status"].Enum` to the ids plus `needs_input` and its description to one line per result
  ("approved (ok): The change is ready."). Set `mcp.Tool.InputSchema` explicitly so `AddTool` uses it
  and validates calls against it (verified: go-sdk v1.8.0 `toolForErr` -> `setSchema` infers only
  when `InputSchema` is nil, and resolves a given schema for input validation).
- `finishStep` validates `status` against the grant's ids plus `needs_input` (defence in depth; the
  enum already refuses) and records `Finish.Status` = chosen id. Error text lists the allowed ids.
- `Finish` unchanged in shape (Status now any declared id). `checkFinish` bounds unchanged.
- `FinishStepSuffixFor(results []ResultSpec) string`: implicit results return today's exact
  `FinishStepSuffix` text (constant kept for it); declared results return: `When this step ends, call
  the finish_step tool once with status set to one of: approved (ok: The change is ready), changes
  (not ok: ...). Add a one-line summary; for a not-ok status give the reason. If you need a decision
  from me, use status "needs_input" with your question.` TS mirror `finishStepSuffix(results)` in
  `board/runMessage.ts` returns the same text (parity unit check reads the Go file, as
  `go-ts-vocabulary-parity.spec.ts` does).
- `composePrompt`, `composeResumePrompt` (`ade/vars.go`) and `planSmartStep` (`smartstep.go`) take the
  step's results. `superviseAgent` and `prepareWithGrant` pass `Grant.Results` from `stepDef`.
- `run_outcome` entries carry `outcome.result` and `outcome.route` through the stored JSON (no code
  beyond the fields).

### 3.5 Engine (`apps/kira-space/internal/ade`)

- `stepDef` gains `Results []adewire.StepResult`; `stageSteps` fills it from `PipelineStep.Results`,
  else `ImplicitResults(OnFailure)` (old snapshots). Script stage: implicit from its `on_failure`.
- Recording (`fromFinish`, `finishState`, `agentOutcome`, `smartOutcome`, `applyTUIFinish`): map the
  chosen id to its result; `Outcome.Result` = id, `Status` = done for ok, failed for not ok; `needs_input`
  unchanged (`stuck`). No report: D7.
- New `decideRoute(run, out)` replaces `decideSendBack`'s entry (rename file `sendback.go` ->
  `route.go`, keep the resume logic): resolve the result's `next` to an index; forward or `end` ->
  run `done` (D6), `Route` set; `stop` -> `failed`; loop -> count prior runs of this step and branch
  with `outcome.result == id` and state `back` from `RunsOfTask` (in memory; `CountRuns` stays for
  rebase code if used elsewhere, else delete) -> under max: state `back`, queue (self: fresh attempt
  `attempt+1`, same loops; earlier: today's send-back with `loops = round`), note `"<reason> -> back to
  <step> (n of max)"` or `"retry n of max"`; spent: `failed` with the spent note.
- Path walk in `steps.go` (pure, unit-tested): `walkPath(steps []stepView) (path []int, skipped
  []bool)`: start at 0; a step whose state is `done` moves to its forward target = the earliest
  resolved forward route among its target runs' `outcome.route` (`""` legacy = next); steps between are
  skipped; stop at the first step not done or past the end.
- `nextAction` iterates the path only (first path step not done; entry-step rule unchanged; path past
  the end -> `actStageComplete`). `actRetry` and `retryLimit` go away (self loops are decided at record
  time). `chainRerun` walks the path per branch (route-following) instead of list order; off-path
  runs are ignored.
- `stepView.state()` unchanged. Manual `RetryRun`, `Approve`, `StageDone` unchanged.

### 3.6 Board, panel, Needs you, notification

- `board/progress.ts` mirrors 3.5: `StepState` adds `skipped`; `buildSteps` applies the TS `walkPath`
  (route from `run.outcome.route`); skipped steps count as done in `doneSteps`/`frac`; `StepRun` gains
  `result`, `ok`. `branchProgress` labels `"<step> ↩ sent back"` and `"retry n of max"` from the note.
- `board/stageBlocks.ts`: `RUN_GLYPH` adds a skipped glyph (`⤼`, grey); `failText` becomes
  `routeText` (non-default routes, e.g. `changes ↩ Implement (max 3)`, `trivial → end`).
- `panel/AdeRunOutcome.vue`: result chip (green tint for ok, red tint for not ok, tone classes) plus
  route text ("→ Tests", "↩ back to Implement 2 of 3", "→ end of stage", "stopped").
- `board/needsYou.ts`: `failed` item `what` = `Step "<name>" ended <result>` when a result exists;
  `detail` = reason or the spent-loop note. No new kind.
- `agentnotify.HandleRuns`: for a step run with `outcome.result`, title `"ADE <result> · <task>"`
  (`failed`/`done` stay as today for implicit results); `back` stays non-final (no notification on an
  automatic loop). Spent loop and `stop` notify as `failed`.

### 3.7 Graph editor (frontend, `apps/kira-space/frontend/src/ade/v2/workflows/`)

Dependencies (root `package.json`, exact pins): `@vue-flow/core` `1.48.2`, `@dagrejs/dagre` `3.1.1`.
License check at implementation: `npm view <pkg> license` (MIT both), repo `LICENSE` file MIT, and
transitive deps `@dagrejs/graphlib` (MIT), `d3-drag`, `d3-selection`, `d3-zoom`, `d3-interpolate`
(ISC); features used (custom node and edge components, handles, `onConnect`, `fitView`, group nodes)
are all in the MIT core package; Vue Flow has no paid or Enterprise tier. `@vue-flow/core` brings its
own `@vueuse/core` ^10 copy; accept (internal to the library). Import `@vue-flow/core/dist/style.css`
only (structural), never `theme-default.css`; style with Tailwind.

Files:
- `board/workflowGraph.ts` (pure, unit-tested): `toGraph(workflow)` -> stage group nodes, step nodes,
  edges; `aggregateEdges(step)` groups results by resolved target: all ok -> `tone: 'ok'`, all not ok ->
  `'fail'`, mixed -> `'neutral'`; label = result ids; loop edges flagged with max. `layout(graph)` via
  dagre per stage (top-to-bottom, loop edges excluded from ranking), stage groups left to right.
  `connect(workflow, stageId, stepId, resultId, targetId)`, `clearRoute`, `addResult`,
  `removeResult`, `addStep(stageId, afterStepId?)`, `removeStep` (routes into it reset to defaults),
  `setStart`, `normalizeOrder` (D14), `moveStage(from, to)`.
- `board/workflowForm.ts`: keep `newStep`, `withKind`, `newStage`, `runnableCount`, `parseTools`,
  `formatTools`, `cloneWorkflow`, `STATUS_OPTIONS`, `FAILURE_OPTIONS` (script stage only); delete
  `moved`, `backOptions`, `withValidBacks`. `newStep` gets implicit `results`.
- Pinia `state/adeWorkflowDraft.ts` (one concern: the open editor's draft): `draft`, `dirty`,
  `selection` (`{kind: 'stage'|'step', stageId, stepId?}`), `error`, actions wrapping the pure ops.
  `adeWorkflowsUi` keeps page state; its `dirty` reads the draft store (no duplicate flag).
- `AdeWorkflowGraph.vue` (replaces `AdeWorkflowForm.vue`): save bar, name, Kira Space tools switch,
  stage strip (`VueDraggable` from `vue-draggable-plus`, stage chips with kind and skip state, + Add
  stage), then `ResizablePanelGroup` (shadcn `resizable`): Vue Flow canvas | inspector. Toolbar (fit
  view, zoom in/out) as `TooltipIconButton`s using `useVueFlow()`. `useResizeObserver` (VueUse) refits
  on resize; `onKeyStroke('Delete')` removes the selected step after the confirm dialog
  (`useConfirmDialogStore`). `useSaveShortcut` kept.
- `AdeStepNode.vue`: name, runs-on, approval gate badge, smart badge, prompt preview (two lines,
  `VarText` chips for `{task} {jira} {repo} {branch} {worktree}` through a `promptParts(text)` helper
  next to `smartBodyParts`), one source `Handle` per result (dot in tone: ok green, not ok red), one
  target `Handle`. Start step marked.
- `AdeStageGroupNode.vue`: group frame with name, kind, status; user and script stages are single
  nodes; script `on_failure` retry shown as a self loop.
- `AdeResultEdge.vue`: `BaseEdge` + `EdgeLabelRenderer`; stroke class `stroke-tone-green-solid`,
  `stroke-tone-red-solid` or `stroke-muted-foreground`; loop edges dashed with `max n` in the label;
  `data-tone` attribute for tests. Stage-to-stage edges neutral.
- Inspector: `AdeStepInspector.vue` (from `AdeStepCard.vue`, no up/down; fields as today; `VarText`
  prompt preview under the textarea; finish-instruction preview from `finishStepSuffix(results)` with
  result ids as chips) plus `AdeStepResults.vue` (rows: id `Input`, ok `Switch`, description, route
  `NativeSelect` [next, each step, end, stop], max `NumberStepperInput` on loop routes, remove; + Add
  result). `AdeStageInspector.vue` (from `AdeStageCard.vue`, no up/down; remove and skip via its
  `DropdownMenu`). Route selects are the keyboard path for everything the mouse does on the canvas.
- `AdeWorkflowEditor.vue`: mode toggle `Graph | YAML`, loads the graph with `defineAsyncComponent`.
- `run/AdeRunDialog.vue`: suffix preview from `finishStepSuffix(stage step results)`.
- No colour literals (check-ade-colours); no scoped `<style>`.

## 4. Files

One implementer. P247 owns:
- `apps/kira-space/internal/adeflow/**`; `apps/kira-space/internal/bridge/adewire/{wire.go,results.go}`;
  `apps/kira-space/internal/ade/{steps,steps_test,sendback->route,runs,smartstep,vars,launches,
  runengine_test,runengine_wave4_test}.go` and any `ade/*_test.go` the rename touches;
  `apps/kira-space/internal/agentnotify/agentnotify.go` (+ its test);
  `apps/kira-space/internal/flows/adeflow/**` (new `branching_test.go`; edits to
  `backlog_workflows_test.go`, `runs_test.go`); `apps/kira-space/internal/realclaude/ade_test.go`.
- `internal/claudeheadless/{mcp,suffix,mcp_test}.go`; `internal/runoutcome/outcome.go`;
  `internal/flowtest/fakeagent/fakeagent.go`; `packages/shared/domain/runOutcome.ts`.
- `apps/kira-space/frontend/src/ade/v2/{wire.ts,workflows/**,board/{workflowForm,workflowGraph,
  progress,stageBlocks,needsYou,runMessage}.ts,panel/AdeRunOutcome.vue,run/AdeRunDialog.vue,
  automation/smartStepBody.ts,state/{adeWorkflowsUi,adeWorkflowDraft}.ts}`.
- `apps/kira-space/tests/ui/ade-v2-workflows.spec.ts`; `apps/kira-space/tests/unit/
  {ade-v2-progress,ade-v2-workflow-graph,go-ts-vocabulary-parity}.spec.ts` (parity: suffix text);
  `apps/kira-space/tests/fixtures/ade-v2/{workflows,board,workflow-yaml}.json`;
  `apps/kira-space/tests/e2e-real/ade-workflow-branching-real.spec.ts`.
- `docs/ARCHITECTURE.md` (ADE workflow section only), `docs/DEV_ENVIRONMENT.md` (real-claude table
  row), `docs/v2.2/SPEC.md` (P247 row status and result).

Ownership against concurrent phases:
- P243 Part 2 (extension and git server removal; plan `P243-plan.md` section 6). Shared files and
  rule: root `package.json` and `bun.lock` (P247 adds two deps; P243 Part 2 removes the extension
  workspace and devDeps): land after P243 Part 2 per table order, rebase, re-run `bun install`.
  `apps/kira-space/frontend/bindings/**`: generated; regenerate after rebasing, never hand-merge.
  `apps/kira-space/internal/storage/model/**` is P243 Part 2's for `git_clients`; P247 edits only
  `model/adetask.go` (one JSON field), no migration, no `repos/**`. `flows/coverage/exempt.txt`: P247
  does not touch it (D17). `apps/kira-space/tests/ui/support/**` is P243 Part 2's: P247 uses fixtures
  and the existing `adeV2.ts` helpers unchanged; if a helper must change, edit it after P243 Part 2
  lands. `docs/ARCHITECTURE.md`: different sections (git server vs ADE workflows). `knip.json`,
  `appwire/**`, `main.go`, `packages/git-*`: P247 does not touch.
- P245 (git module restyle): owns `packages/git-ui/**`, git views under `apps/kira-space/frontend/src/
  {repo,views/repo}/**`, `packages/theme/**` token and class changes, `frontend/src/styles.css`,
  `scripts/check-{tokens,theme-classes}.sh`. P247 touches none of them: it uses existing shadcn
  components (`resizable`, `dropdown-menu`, `native-select`, `switch`, `input`, `tooltip`) as is and
  imports the Vue Flow CSS inside `AdeWorkflowGraph.vue`, not `styles.css`.
- P246 (popup routing) may edit `agentnotify`; P247 lands after it per table order and rebases its
  title change onto P246's notifier.

## 5. Tests (CLAUDE.md bar)

Unit (Go), extend existing files:
- `adeflow/adeflow_test.go` `TestParse_rules`: rows for each new rule (unknown target, stop on ok,
  max on forward, no forward result, results with on_failure, duplicate id, `needs_input` id).
- `adeflow/writer_test.go`: legacy file round trip byte-identical; graph edit -> `results` written, no
  `on_failure`; results reverted to legacy form -> `on_failure` back, comments kept.
- `ade/steps_test.go`: `walkPath` (forward skip, end, earliest forward target across branches, legacy
  routes), `nextAction` over a path, `chainRerun` route-following.
- `claudeheadless/mcp_test.go`: a run grant's `tools/list` shows the `status` enum of its results plus
  `needs_input`; an id outside the enum is refused; implicit grant enum is `done failed needs_input`.

Flow (Go, real bridge, fake claude) `flows/adeflow/branching_test.go` (fakeagent gains action name
`result:<id>` calling `finish_step` with that status):
- Review loop: `review` picks `changes` twice then `approved`; `impl` resumes twice in its session with
  the fix line, loops 1 and 2, the chain re-runs, stage completes.
- Loop guard: always `changes`, `max: 2` -> third report fails the run with the spent note; board
  facts show the step failed; Needs-you inputs present.
- Forward skip and end: `trivial` -> later steps never launch, stage completes.
- Legacy: an `on_failure: retry 1` and a `back:` workflow behave as before (existing runs tests stay
  green; add only if not already covered).
- Save round trip through the bound `SaveWorkflow`/`WorkflowYaml` methods with results.

UI (Playwright, mocked bridge) `tests/ui/ade-v2-workflows.spec.ts` rewritten for the graph: no element
with `ade-wf-step-up`/`-down`; edge tones (`data-tone` ok, fail, neutral for mixed); setting a route in
the inspector saves `results[].next`; adding a result adds a handle; stage strip drag reorders stages;
YAML mode tests kept as they are. Unit TS `tests/unit/ade-v2-workflow-graph.spec.ts`: edge aggregation,
loop classification, `normalizeOrder`; `ade-v2-progress.spec.ts`: path walk parity cases.

e2e-real (Space) `ade-workflow-branching-real.spec.ts`: edit a workflow in the graph editor, save, run
a task with fake claude choosing `changes` then `approved`, see the result chip and the sent-back line.

Real claude (opt-in, haiku, tiny budget): one test in `realclaude/ade_test.go`: a step with results
`pass`/`retry_later`, prompt asks for `retry_later`; assert the stored `outcome.result`. Add the row to
`docs/DEV_ENVIRONMENT.md` "Real `claude` tests (P237)"; run it once at phase end.

Checks: `bun run lint` (incl. check-ade-colours), `bun run lint:dead`, `bun run typecheck`,
`bun run lint:go`, `go build ./...` (+ `-tags server`), `bun run test:unit`, `bun run test:flows:space`
(coverage gate, `exempt.txt` empty), `bun run test:ui:space` (workflows, run, panel, needs specs).

## 6. Commits

1. `feat(ade): step results in workflow YAML` (parse, writer, wire, results helpers, fixtures, Go unit).
2. `feat(ade): finish_step takes the step's results` (claudeheadless per-run schema and suffix,
   runoutcome `Result`, fakeagent, mcp_test).
3. `feat(ade): route runs on the chosen result` (steps path walk, route.go, runs, smartstep, vars,
   launches, model `Route`, steps_test).
4. `feat(ade): result and route on board, panel, Needs you, notification` (progress, stageBlocks,
   needsYou, AdeRunOutcome, agentnotify, TS unit).
5. `feat(ade): graph workflow editor` (deps, workflowGraph, draft store, Vue Flow components,
   inspector, editor toggle, run dialog suffix, bindings regen).
6. `test(ade): branching flows, UI, e2e-real and real claude` then fix commits for what they find.
7. `docs: workflow results and routing` (ARCHITECTURE, DEV_ENVIRONMENT, SPEC result).

## 7. Orchestrator verification checklist

- `grep -rn "ade-wf-step-up\|ade-wf-step-down\|moved(" apps/kira-space/frontend/src/ade` empty.
- `grep -n "@vue-flow/core\|@dagrejs/dagre" package.json` exact pins; a real import of
  `@vue-flow/core` in `workflows/AdeWorkflowGraph.vue` and of `@dagrejs/dagre` in
  `board/workflowGraph.ts`.
- `grep -n "Enum" internal/claudeheadless/mcp.go` sets the per-run `status` enum; `mcp_test.go`
  asserts it.
- A pre-P247 workflow file (`flows/adeflow/testdata` or a fixture) saves byte-identical when
  unchanged.
- `AdeResultEdge.vue` uses the three tone classes; no colour literal added (`check-ade-colours` green).
- `exempt.txt` empty; no new migration under `storage/migrations`.
- Branching flow tests and the real-claude row ran (log line in the result doc).

## 8. Not in P247

Cross-stage routes (D3); stored node positions (D13); parallel branches (fork/join) inside a stage;
a run state `skipped`.
