# P279 plan: Resume stuck agent runs; quit confirmation

Ask (SPEC row P279): (1) step 0, real `claude` probe of `claude --resume` on a transcript killed mid-turn
or ending on an unanswered tool call; record the result here. (2) `Recover` keeps a resumable launch spec
(stored Claude session id as `ResumeID`) on stuck ADE runs and failed-by-restart smart-script runs. A
Resume action requeues the run through `Launch.ResumeID` with a resume prompt: previous session was
interrupted; re-check the last action. Review `composeResumePrompt`. (3) Quit confirmation when agents are
live ("N agents running; quitting stops them") through `internal/shell/quit.go` and `ConfirmDialog`, in
both apps. (4) Known limitation, documented not solved: no detached runner, no PTY survival; crash or quit
still stops the process; Resume restores the conversation, the turn in flight is lost, half-applied tool
effects are possible; `kira-db` MCP stays app-bound. Flow test plus UI spec per scenario; real `claude`
rows after.

Out of scope (user decision): a detached runner or PTY holder; keeping `kira-db` MCP alive past quit.

Base: `v2.0` at `18c1af43b` (P278 close-out). Discovery ran through `codegraph_explore`: `scriptruns`
(`Service.Recover`, `Close`, `decide`, `launchSmart`, `newRun`, `begin`, `plan`, `Start`, `claimWorktree`,
`Repo.FailRunning`/`FinishByRun`, `Run`, `RunParam`, `launch`), `claudeheadless` (`Script`, `Run`, `Spec`,
`FinishInstruction`, `ScriptReport`), `runoutcome.ForProcess`, `shell.Quitter`, `appevent.Events`,
`prompts.Router`/`Bound`, `llmprompts` (`define`, `Entry`, `AdeSendBackLine`), `terminal.Registry.Open`,
`BoundService.Open`. The index in this checkout holds no `apps/kira-space` symbol (`TaskBoard`,
`apps/kira-space/internal/ade/runs.go` both unmatched), so Space code was read directly: `ade/recover.go`,
`ade/runs.go` (`queueRun`, `launch`, `startRun`, `superviseAgent`, `agentOutcome`, `RetryRun`,
`StopRun`, `markStopped`), `ade/vars.go` `composeResumePrompt`, `ade/route.go` send-back resume,
`ade/smartstep.go` `spec`, `storage/model/adetask.go` `AdeRunLaunch`, `repos/adetask.go`
`RecoverRunning`, `bridge/adetask.go` `RetryRun`, `adewire.Run`, `appwire` (`agentSessionCount`,
`NewQuitter`, `teardown`), `main.go` options, `flowharness` `Restart`/`stop`, `adeflow`
`TestRestartRecovery`, frontend `stageBlocks.ts`, `AdeStageBlock.vue`, `needsYou.ts`,
`useNeedsAction.ts`, `PromptHost.vue`, `ConfirmDialog.vue`, `confirmDialog.ts`, both `App.vue`,
`RunOutcomeBlock.vue`, `module.ts` `ScriptRunsSeam`, `fakeagent.go`.

## 0. Step 0: real `claude` probe (done by the planner)

Setup: CLI `2.1.296`, temp `HOME` with `.claude.json` onboarding seed, parent session env stripped
(`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_REMOTE_SESSION_ID`, `CLAUDECODE`), auth from env, no
credential file read. Flags as the app's headless launch: `-p --output-format stream-json --verbose`,
prompt on stdin, plus `--model haiku --max-budget-usd 0.05 --allowedTools Bash`. Child in its own process
group; SIGKILL to the group (worse than the app's SIGTERM-then-SIGKILL). Script:
scratchpad `probe/probe.py`. Spend 0.0033 USD.

| Case | What happened |
|---|---|
| A. SIGKILL 3 s after a Bash `tool_use` streamed (command blocks on a missing file) | Transcript `~/.claude/projects/<cwd>/<id>.jsonl` ends on the assistant `tool_use` line (`stop_reason: tool_use`), no `tool_result`. |
| A-resume: `--resume <id>` in the same cwd, `-p`, new stdin prompt | Exit 0. `system/init` `session_id` is the original id; same file grows, no new file. CLI first appends a synthetic `tool_result` (`is_error: true`): "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]", then a synthetic assistant "No response requested.", then the new prompt. Model named the exact last command and said it never saw output. |
| B. SIGKILL 0.3 s after `system/init` (turn in flight, nothing streamed) | User prompt is in the transcript; no assistant line. |
| B-resume | Exit 0, same id. CLI appends synthetic "No response requested." Model: "You asked for a 200-word story ... I haven't written it yet." The interrupted request survives; its answer is lost. |
| C. `--resume <id>` from a different cwd | Works in 2.1.296 (finds the session across project dirs); model notes the cwd changed. |
| D. `--resume <unknown uuid>` | Exit 1, stderr `No conversation found with session ID: <id>`, stream `result/error_during_execution`. No API call. |
| E. `--resume <id> --session-id <id>` | Exit 1: `Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.` |

Conclusions the design rests on:
- Resume of a mid-turn kill is safe: the CLI repairs an orphan `tool_use` itself and tells the model the
  outcome is unknown. No continuation-prompt fallback or fresh-run fallback is needed for that case.
- Loss is exactly the turn in flight: streamed-but-unrecorded output and the unknown result of the last
  tool call. Its side effects may have happened (half-applied). The resume prompt must say "re-check".
- `--resume` keeps the session id: the resumed process needs no new id; `Script` already drops
  `--session-id` when `Resume` is set (case E would fail otherwise).
- A run whose transcript never got written (killed before `init`, or `~/.claude` cleared) fails resume
  with case D's stderr line. That is the one fallback: report it, keep Retry (fresh session) available.
- Resume stays in the run's own cwd (worktree or script folder) although case C shows it is not required:
  tools, relative paths and hooks expect that cwd.

## 1. Live work, quit, and what "Quit anyway" does today

- Graceful quit: `Quitter.ShouldQuit` returns false, starts `flushThenQuit` (window flush handshake, 2 s
  cap), then `teardown`. Space teardown closes `sched`, `runs` (`scriptruns.Service.Close`: smart and
  headless runs end `endQuit`, outcome `failed`, source `restart`, "Kira Space quit while it ran") and
  `AdeBoard` (cancels `b.ctx`; `superviseAgent`/`superviseScript` return early, ADE rows stay `running`,
  R18). Terminal registry close SIGHUPs PTYs (agent tabs included).
- Next boot: ADE `Recover` marks `running` runs `stuck` (outcome source `restart`, "interrupted: Kira Space
  closed while it ran"), stops session rows, removes stale `*.mcp.json`. `scriptruns.Recover` fails
  `running` rows the same way (crash path; a graceful quit already finished them).
- Closing the last window never quits (`ApplicationShouldTerminateAfterLastWindowClosed: false` in both
  apps): work keeps running, so no confirmation there.
- `OnShutdown` (signal, `Run` error) cannot ask anyone: unchanged.

"Live" for the confirmation (final): processes a quit kills that do agent or run work.
- Space: running ADE runs (`ade_runs.state = 'running'`: agent, smart-step, script-stage and rebase runs;
  all of them die and need a manual Resume or Retry), running smart and headless script runs
  (`scriptruns` `smart` plus `bg` maps), agent PTYs (`terminal.Registry.AgentSessions`: claude-code tabs
  and ADE TUI sessions). Why: each one loses work on quit; counting only Claude would hide script steps
  that also go stuck.
- Studio: running smart and headless script runs, agent PTYs. No ADE.
- Not counted: plain shell tabs and normal script terminal runs. Why: they restore as tabs, and a prompt
  on every quit with a shell open trains users to click through it.

## 2. ADE resume (Space)

### 2.1 Persisting the resume spec

- `repos.AdeTaskRepo.RecoverRunning` sets, in its one `UPDATE`, `launch_resume_id` from the run's
  session: `launch_resume_id = CASE WHEN purpose = '' AND session_id <> '' THEN COALESCE((SELECT
  claude_session_id FROM ade_sessions s WHERE s.id = ade_runs.session_id), '') ELSE '' END`; other
  `launch_*` columns are set to `''`. Returned runs carry the same `Launch`. Atomic with the stuck marking.
  Columns exist since `0014_p156_run_launch_spec.sql`: no migration.
- `model.AdeRunLaunch` doc changes: non-empty on a never-launched row (held spec) or on a run stopped by a
  restart (`ResumeID` only). `startRun`'s `Launch: &model.AdeRunLaunch{}` clear stays.
- Rebase runs: excluded (their own `recoveredRebases` path). Script-stage runs: no session, excluded.
  Runs made `stuck` by `needs_input` or "stopped by you": not resumable (no `ResumeID` written). Why: a
  user stop is deliberate and a `needs_input` run waits for the user; Take over covers both.

### 2.2 Wire

- `adewire.Run` gains `Resumable bool \`json:"resumable"\``, set in `board.go`'s run mapper:
  `State == stuck && Launch.ResumeID != "" && StartedAt != nil`. TS `Run` in
  `apps/kira-space/frontend/src/ade/v2/wire.ts` gains `resumable: boolean`; progress `StepRun` carries it.

### 2.3 `TaskBoard.ResumeRun(ctx, runID)` (`ade/runs.go`, beside `RetryRun`)

Under the task mutex, same guards as `RetryRun` (stage current, step in plan, latest attempt), then:
1. `run.Purpose == rebase` or `!resumable` (rule above): `invalid("only a run Kira Space interrupted can
   resume")`, catalog key `backend.space.ade.resumeNotResumable.body` through the existing invalid path.
2. `line := llmprompts.RunResumeLine.Text(b.prompts(), llmprompts.ResumeVars{App: "Space"})`.
3. Clear the old row's spec first: `UpdateRun(run.ID, Launch: &model.AdeRunLaunch{})`, emit. A second
   Resume then fails rule 1, never launches twice.
4. `queueRun(ctx, tc, plan, idx, run.BranchID, run.Attempt+1, "", runOpts{Loops: run.Loops, Launch:
   model.AdeRunLaunch{ResumeID: id, Prompt: line, Note: noteResumed}})`, `noteResumed = "resumed after
   restart"`. A missing worktree or setup gate holds the run `pending` with the spec, exactly as today.
- `startRun` already handles `spec.ResumeID`: same Claude id on the new `ade_sessions` row
  (`Resumes` set), `composeResumePrompt`, `agentLaunch.resume`. Smart-step runs keep `Resume` through
  `smartStep.spec`. No change there.
- `composeResumePrompt` review (final): keep it. It appends the step's finish instruction, which the
  resumed agent needs because the original prompt's results may have changed with a workflow edit. Only
  its doc comment changes to name both callers (send-back and restart resume).

### 2.4 Lost conversation

- `runoutcome` gains `EndResumeLost` (source `start`): reason `could not resume: Claude has no saved
  conversation for this run; use Retry`.
- `claudeheadless` exports `IsNoConversation(line string) bool` (prefix `No conversation found with
  session ID:`, the probe's case D). `superviseAgent` passes `l.resume != ""` into `agentOutcome`; when no
  finish and the last stderr line matches, the outcome is `failed` with `EndResumeLost`. Same in
  `smartOutcome` and scriptruns `decide` (new `decision.resumed`).
- No automatic second launch. Why: a silent fresh run hides the loss and spends again; Retry is one click
  and visible.

### 2.5 IPC and bridge

- `bridge.AdeTaskService.ResumeRun(ctx, adewire.RunArgs) error`, validation as `RetryRun`.
- Frontend: `bridge/index.ts` `adeTaskResumeRun`; `queries.ts` `useResumeRun()` (TanStack mutation,
  board refresh rides the existing `adeTaskBoardChanged` push).

## 3. Smart-script resume (both apps, `internal/scriptruns`)

### 3.1 Data

- Migrations: Studio `0038_p279_script_run_resume.sql`, Space `0035_p279_script_run_resume.sql`:
  `ALTER TABLE script_runs ADD COLUMN resume_id TEXT NOT NULL DEFAULT ''` and `ADD COLUMN resumed_from
  TEXT NOT NULL DEFAULT ''`. `scan`, `columns`, `Insert` carry both.
- `Run` gains `ResumedFrom string \`json:"resumedFrom"\`` and `Resumable bool \`json:"resumable"\`` (from
  `resume_id != ''`; `resume_id` itself never leaves Go). Zod `scriptRunSchema` in
  `packages/shared/domain/scriptRuns.ts` gains both.
- Set `resume_id = session_id` when a smart run ends with source `restart`: in `Repo.FailRunning` (crash
  path, `CASE WHEN kind = 'smart' THEN session_id ELSE '' END`) and in `Repo.finish` when the outcome's
  source is `restart` and the row is smart (graceful quit path via `decide` `endQuit`). One rule in the
  repo, both paths.
- `Repo.TakeResume(id) (sessionID string, ok bool, err error)`: `UPDATE script_runs SET resume_id = ''
  WHERE id = ? AND resume_id <> '' RETURNING session_id`. `Repo.RestoreResume(id, sessionID)` puts it back
  when the launch then fails before `begin`.

### 3.2 `Service.Resume(id string) (Started, error)` and `Bound.Resume(IDArgs)`

1. `Get(id)`; not smart or not resumable: `CodeBadRequest` `backend.core.scriptRun.resumeNotResumable.body`.
2. Rebuild `RunArgs{ScriptID, Params, TaskID, BranchID}` from the row. Params: `RunParam.Value` per name;
   for a param the current script types as text, one value; for others split on `"\n"` (the `Env` join).
   Masked secret values are dropped.
3. `plan(args, planOpts{})`. `Missing` non-empty (a secret param, or a param added since):
   `CodeBadRequest` `backend.core.scriptRun.resumeMissing.body` with `{names}`. A blocker: same error path
   as `Start`. Script deleted: the existing `automations.script.gone.error`.
4. Worktree runs: `claimWorktree(p, true)` as `Start` does.
5. `TakeResume`; then `p.resume = sessionID`, `p.resumedFrom = id`, `p.sent = RunResumeLine.Text(App:
   s.App) + "\n\n" + p.preview.Suffix`. `newRun` uses `p.resume` as `SessionID` when set and copies
   `ResumedFrom`; trigger stays from `runTrigger(p)`. `launchSmart` sets `spec.Resume = run.SessionID`
   when `p.resume != ""` (then `Script` emits `--resume`, never `--session-id`).
6. Launch error before `begin`: `RestoreResume`, release the claim, return the error.
- Why re-plan from the current script, not the stored row: one launch path (`plan`, `launchSmart`), and
  budget, timeout and MCP config are not on the row. Tools edited since apply to the continuation.
- Why a new run row: the old row keeps its interrupted outcome as history; `resumedFrom` links them; logs
  stay per process. Same as ADE attempts.
- Why secrets block resume: secret values are never stored (P242 rule). The error names them; Run again
  asks for them.

### 3.3 Frontend

- `ScriptRunsSeam.resume(id): Promise<ScriptRunStarted>` in `packages/workbench/src/automations/module.ts`;
  both apps' `bridge/index.ts` implement it over `ScriptRunsService.Resume`.
- `runsQueries.ts` `useResumeScriptRun()` mutation; on success open the new run's tab
  (`ctx.openRunTab`), same as Start.
- `RunOutcomeBlock.vue`: `Resume` button (`data-testid="run-resume"`) before Run again when
  `run.resumable`; inline error under it on rejection. Emits `resume`; `ScriptRunView.vue` and
  `RunsSection.vue` call the mutation.
- Resumed run header shows `automations.run.resumedFrom.label` ("Resumes an interrupted run") when
  `resumedFrom !== ''`.

## 4. Resume prompt (llmprompts)

- New entry `RunResumeLine` (`ID: "run.resume.line"`, `KindMessage`, `Apps: {Studio, Space}`,
  `Applies: NextCall`, vars `ResumeVars{App string \`prompt:"required"\`}`), catalog keys
  `llmPrompts.entry.runResumeLine.{title,description,usedBy.body}`. Default:
  `Kira {{.App}} closed while you worked, so your last turn was cut off. A tool call marked interrupted has
  an unknown outcome: it may have run in part. Check the current state of that action (files, git, running
  processes) before you redo or skip it. Then carry on with the task.`
- ADE appends the finish instruction (`composeResumePrompt`); smart runs append the script report suffix
  (and the Space note for task runs, as `plan` builds `Suffix`).
- Why one shared entry: same situation, same wording; `App` names the app. Golden file
  `internal/llmprompts/golden_test.go` data and the prompt guard script take the new entry.

## 5. Quit confirmation (both apps)

### 5.1 Go

- `shell.Quitter` gains a gate set by `SetGate(g QuitGate)` (main and harness wire it after `Build`):

  ```go
  type QuitGate interface {
      Live() int     // live work count, section 1
      Ask(count int) // raise the confirmation popup
      Withdraw()     // drop it
  }
  ```
- `ShouldQuit`: `done` true; `started` false; else when `!confirmed` and `gate.Live() > 0`: if
  `asking.CompareAndSwap(false, true)`, `go gate.Ask(n)`; return false. Otherwise today's path. Never
  blocks (P56 D2 holds).
- `ConfirmQuit()`: `confirmed = true`, `asking = false`, `gate.Withdraw()`, then start `flushThenQuit`
  directly (same `started` CAS). It ends in `app.Quit()`, whose `ShouldQuit` returns true. No app
  attached (flow harness): the flush and teardown still run.
- `CancelQuit()`: `asking = false`, `gate.Withdraw()`. A later quit asks again.
- `Shutdown` unchanged.
- Gate implementation `appwire.quitGate` (one per app, over `prompts.Router`): `Ask` calls
  `Router.Open(Prompt{ID: "quit:app", Kind: KindQuit, Ref: "app", Title:
  i18n.T("backend.prompt.quit.title", {app})})` then `Router.RevealKind(KindQuit)`; that reopens a window
  when none is open (existing `Reopen` hook) and focuses the target. `Withdraw` is `Router.Close("quit:app")`.
- `prompts.KindQuit = "quit"`; `countTitle` gets no case (one quit prompt at most).
- Counters: Space `liveWork` = `Tasks.CountRunning()` (new repo method, `ade_runs` state running) +
  `runs.Live()` + `len(registry.AgentSessions())`. Studio: `runs.Live()` +
  `len(registry.AgentSessions())`. `scriptruns.Service.Live() int` = `len(smart) + len(bg)` under `mu`.
- `LifecycleService` (each app's `bridge/lifecycle.go`) gains `ConfirmQuit()`, `CancelQuit()`,
  `QuitStatus() (QuitStatus, error)` with `QuitStatus{Asking bool; Agents, Runs, Scripts int}` (agent
  PTYs, ADE runs, script runs; Studio leaves `Runs` 0). Bound methods are fire-and-forget like `Flushed`.
- "Quit anyway" = `ConfirmQuit`: today's quit, unchanged. Agents get SIGTERM then SIGKILL; ADE rows stay
  running until the next boot's `Recover`; smart rows end `restart`. Both become resumable (sections 2-3).

### 5.2 Frontend

- `promptKindSchema` gains `'quit'`.
- `packages/workbench/src/prompts/QuitPrompt.vue` (`<script setup lang="ts">`): TanStack `useQuery`
  over `lifecycle.QuitStatus` (key `['lifecycle', 'quitStatus']`, `staleTime: 0`); renders
  `ConfirmDialogView` (`tone: 'danger'`, focus starts on Cancel): title `workbench.quitConfirm.title`,
  message `workbench.quitConfirm.body` with `{count}` = sum, a second line from the non-zero parts
  (`workbench.quitConfirm.agents.label`, `.runs.label`, `.scripts.label`), confirm
  `workbench.quitConfirm.quit.label`. Confirm calls `lifecycle.ConfirmQuit`; Cancel, Escape and frame
  close call `CancelQuit`. Pending while the call is in flight.
- `createCoreControl.ts` lifecycle seam gains the three calls; both `App.vue` add `quit:
  markRaw(QuitPrompt)` to `promptKinds`. Why `ConfirmDialogView`, not the `confirmDialog` store: the store
  is single-slot and would cancel a confirm the user already has open; the routed host already owns one
  popup per window.

## 6. ADE UI (Space)

- `stageBlocks.ts` `RunLine` gains `canResume: run.resumable`; `canRetry` stays.
- `AdeStageBlock.vue` run line: `Resume` button (`data-testid="ade-run-resume"`, `ACTION_CLASS.claude`,
  tooltip `space.ade.stageBlock.resume.tooltip`) before Take over and Retry; `onResume` through
  `useResumeRun`, errors into the block's `error` like Retry.
- `needsYou.ts`: a stuck run with `resumable` gets action `'Resume'` (new id in the action union,
  `ACTION_LABEL` `common.action.resume.label`); otherwise today's Take over / Retry. `useNeedsAction.ts`
  handles `'Resume'` over `useResumeRun` for every `runIds` entry.
- Run note shows the restart reason already; nothing new there.

## 7. i18n (`packages/theme/src/i18n/en.json`)

- `common.action.resume.label`: Resume
- `space.ade.stageBlock.resume.tooltip`: Continue the interrupted Claude session
- `automations.run.resume.tooltip`: Continue the interrupted Claude session
- `automations.run.resumedFrom.label`: Resumes an interrupted run
- `workbench.quitConfirm.title`: Quit Kira {app}?
- `workbench.quitConfirm.body`: Running now: {count}. Quitting stops them. Resume each one later from its run.
- `workbench.quitConfirm.agents.label`: Claude sessions: {count}
- `workbench.quitConfirm.runs.label`: Task runs: {count}
- `workbench.quitConfirm.scripts.label`: Script runs: {count}
- `workbench.quitConfirm.quit.label`: Quit anyway
- `backend.prompt.quit.title`: Kira {app} waits to quit
- `backend.space.ade.resumeNotResumable.body`: Only a run Kira Space interrupted can resume.
- `backend.core.scriptRun.resumeNotResumable.body`: Only a run Kira {app} interrupted can resume.
- `backend.core.scriptRun.resumeMissing.body`: Resume needs values for: {names}. Use Run again.
- `llmPrompts.entry.runResumeLine.title`: Resume after restart
- `llmPrompts.entry.runResumeLine.description`: First message of a run resumed after Kira quit or crashed.
- `llmPrompts.entry.runResumeLine.usedBy.body`: Task runs and smart scripts, Resume action.

Wording follows `CLAUDE.md` style; avoid plural forms (catalog has none).

## 8. Docs

- `docs/ARCHITECTURE.md`: ADE run section gains "Resume after restart" (spec written at `Recover`,
  `ResumeRun`, lost-conversation outcome, probe facts); automations section gains smart resume; shell
  quit section gains the gate. Known open items gains one entry: "No detached runner: quit or crash stops
  every agent and PTY. Resume restores the conversation; the turn in flight is lost and its tool effects
  may be half-applied. `kira-db` MCP stops with Studio."
- `docs/DEV_ENVIRONMENT.md` real `claude` table: ADE row adds `TestAdeResumeRun`; smart row adds
  `TestSmartScriptResume`; one line for the probe script recipe (temp `HOME`, stripped parent env).

## 9. Tests (split at the IPC boundary)

| Scenario | Go flow (fakeagent) | UI spec |
|---|---|---|
| ADE run interrupted, resumed | `adeflow/resume_test.go` `TestResumeAfterRestart`: actions `[{waitFile}, "done"]`; run running; `app.Restart()`; run `stuck`, `resumable`, outcome source `restart`; `ResumeRun`; attempt+1 `done`; call 2 `.args` has `--resume <claude id of call 1>`, no `--session-id`; `.prompt` holds the `RunResumeLine` default and the finish instruction; old attempt `resumable` false; second `ResumeRun` on it refused. Contract `ade-resume.json` keys `#stuck`, `#resumed`, `#refused` | `ade-v2-resume.spec.ts`: board from `#stuck` shows `ade-run-resume` and Needs row action Resume; click sends `AdeTaskService.ResumeRun` with the run id; board from `#resumed` hides it; `#refused` error text inline |
| Lost conversation | `TestResumeLostConversation`: new fakeagent behaviour `"lost"` (stderr `No conversation found with session ID: <id>`, exit 1); resumed run `failed`, reason from `EndResumeLost`; `RetryRun` then launches with `--session-id`. Contract `#lost` | same spec: `#lost` run shows the reason and Retry, no Resume |
| Not resumable | `TestResumeRefused`: script-stage stuck run, "stopped by you" run, `needs_input` run: `resumable` false, `ResumeRun` refused | covered by `#refused` |
| Smart run resume (crash and quit paths) | Space `termflow` and Studio `termflow` `TestSmartScriptResume`: subtest `quit` (harness `Restart`, graceful `Close`) and subtest `crash` (plant a `running` smart row with a session id, `Restart`, `Recover`); both `resumable`; `Resume` gives a new run with `resumedFrom`, same `sessionId`, `--resume` in `.args`, resume line in `.prompt`, ends `done`; second `Resume` refused; a script with a secret param refuses with `resumeMissing`. Contract `smart-resume.json` (each app) `#interrupted`, `#resumed`, `#missing` | shared scenario `packages/workbench/src/testing/ui/scenarios/automationsResume.ts`, run by `automations-resume.spec.ts` in both apps: `run-resume` visible on `#interrupted`, click calls `ScriptRunsService.Resume`, opens the new run tab; `#resumed` header label; `#missing` error inline |
| Quit with live work | Space `appflow/quit_test.go` `TestQuitConfirm`: ADE run on `waitFile` plus a claude-code terminal (fake claude); `ShouldQuit` false; `Prompts.List` has `quit` targeting the main window; `QuitStatus` `{Asking, Agents 1, Runs 1}`; `CancelQuit` withdraws, bound calls still served, `ShouldQuit` asks again; `ConfirmQuit` runs the flush (window ack) and teardown; `ShouldQuit` then true; after `Restart` the run is resumable. Studio `windowflow/quit_test.go` same with a smart run. Contracts `quit-confirm.json` (each app) `#asking` | shared scenario `quitConfirm.ts`, `quit-confirm.spec.ts` in both apps: routed `quit` entry plus `#asking` status shows the dialog with counts; Quit anyway calls `LifecycleService.ConfirmQuit`; Cancel and Escape call `CancelQuit` |
| Quit with nothing live | existing `TestQuitHandshake`-style tests assert no `quit` prompt is raised | none (no UI) |

Real `claude` rows (opt-in, after test-and-fix):
- `apps/kira-space/tests/claude/ade_test.go` `TestAdeResumeRun`: real haiku agent step whose prompt runs
  a Bash wait on a flag file; wait for the `tool_use` log line; `app.Restart()`; `ResumeRun`; create the
  flag; expect `done` through `finish_step`; the run log shows the CLI's interrupted `tool_result` line.
- `TestSmartScriptResume` (Space module only): same shape for a smart script.
- `TestAdeResumeLost`: resume with the transcript file deleted; expect `EndResumeLost` (no API call, no
  spend).
- Then the existing rows: `bun run test:claude:space -run 'TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestAdeResumeRun|TestAdeResumeLost|TestSmartScriptRun|TestSmartScriptResume'`
  and `bun run test:claude:studio -run TestSmartScriptRun`. Report spend.

No new unit test. `Quitter` gate logic is covered by both flow tests; existing `internal/shell/quit_test.go`
gets the gate field in its constructor helper only.

## 10. Execution order (one sequential Sonnet implementer)

No streams: Go repo, `scriptruns`, `llmprompts`, wire types and UI depend on each other in order, and both
apps share `internal/` and `packages/`. Commits (Conventional Commits, typecheck and lint per commit,
`bun run lint`, `bun run lint:go`, `bun run typecheck`):
1. `feat(llmprompts): resume-after-restart prompt` (entry, catalog keys, golden).
2. `feat(scriptruns): resume interrupted smart runs` (migrations both apps, repo, `Service.Resume`,
   `Live`, `Bound.Resume`, lost-conversation outcome, `runoutcome.EndResumeLost`,
   `claudeheadless.IsNoConversation`, fakeagent `"lost"`).
3. `feat(ade): resume stuck runs after restart` (`RecoverRunning`, wire `Resumable`, `ResumeRun`, bridge,
   `composeResumePrompt` doc).
4. `feat(shell): confirm quit while agents run` (`Quitter` gate, `KindQuit`, `quitGate` both apps,
   counters, `LifecycleService` both apps, main and harness wiring).
5. Regenerate bindings: `wails3 task common:generate:bindings` in both apps (gitignored).
6. `feat(ade-ui): resume action` (wire, stage block, needs).
7. `feat(automations): resume action in run views` (seam, queries, `RunOutcomeBlock`, both bridges).
8. `feat(workbench): quit confirmation dialog` (`QuitPrompt.vue`, seam, both `App.vue`, prompt kind).
9. `test: P279 flow tests and contracts` (Go flows; `KIRA_CONTRACT=write` then `-count=2` without it).
10. `test: P279 UI specs` (scenarios plus both apps' specs, mock runtime IPC entries).
11. Serial test-and-fix, one suite at a time from idle: `lint`, `lint:go`, `typecheck`,
    `go test ./... -count=1`, `test:flows:space`, `test:flows:studio`, `test:unit`, `test:ui:space`,
    `test:ui:studio`, coverage gate in both apps (new bound methods have flow calls). Fix at cause, commit
    per group, `fix:` prefix. Pre-existing failures get fixed too (`CLAUDE.md`).
12. Real `claude` rows (section 9). Write the three new tests in commit 9's style first:
    `test(claude): resume rows`.
13. Close-out: `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md` (section 8), SPEC P279 `Done`, result
    section below. `docs: P279 close-out`.

## 11. File ownership (single implementer; for review scope)

- Go shared: `internal/shell/quit.go` (+ `quit_test.go` helper), `internal/prompts/prompts.go`,
  `router.go`, `internal/scriptruns/{repo,run,service,smart_run,preview,headless,bound}.go`,
  `internal/runoutcome/outcome.go`, `internal/claudeheadless/{process,stream}.go` (helper only),
  `internal/llmprompts/registry.go` (+ golden data), `internal/flowtest/fakeagent/fakeagent.go`.
- Space Go: `ade/{recover,runs,vars,board}.go`, `storage/model/adetask.go`, `storage/repos/adetask.go`,
  `storage/migrations/0035_p279_script_run_resume.sql`, `bridge/{adetask,lifecycle}.go`,
  `bridge/adewire/wire.go`, `appwire/{appwire,wire}.go`, `main.go`, `flowharness/harness.go`, flows
  `adeflow/resume_test.go`, `termflow`, `appflow/quit_test.go`, `tests/claude/{ade,automation}_test.go`.
- Studio Go: `storage/migrations/0038_p279_script_run_resume.sql`, `bridge/lifecycle.go`,
  `appwire/{appwire,wire}.go`, `main.go`, `flowharness/harness.go`, flows `termflow`,
  `windowflow/quit_test.go`.
- Frontend: `packages/shared/domain/{scriptRuns,prompts}.ts`, `packages/workbench/src/{automations/module.ts,
  automations/runs/{runsQueries.ts,RunOutcomeBlock.vue,ScriptRunView.vue,RunsSection.vue},
  prompts/QuitPrompt.vue, bridge/createCoreControl.ts, testing/ui/scenarios/{automationsResume,quitConfirm}.ts}`,
  `packages/theme/src/i18n/en.json`, Space `frontend/src/{App.vue,bridge/index.ts,ade/v2/{wire.ts,queries.ts,
  board/{progress,stageBlocks,needsYou}.ts,panel/AdeStageBlock.vue,needs/useNeedsAction.ts}}`, Studio
  `frontend/src/{App.vue,bridge/index.ts}`, both apps' `tests/ui/{support/*,*.spec.ts}` and
  `tests/contract/*.json` named in section 9.

## 12. Verification (orchestrator, real checks)

1. This plan's section 0 table exists and names CLI `2.1.296`; scratchpad probe script is not committed.
2. `rg -n "launch_resume_id" apps/kira-space/internal/storage/repos/adetask.go` shows the `RecoverRunning` update setting it from `ade_sessions`.
3. `rg -n "func \(b \*TaskBoard\) ResumeRun" apps/kira-space/internal/ade` one hit; `rg -n "ResumeRun" apps/kira-space/internal/bridge/adetask.go apps/kira-space/frontend/src` shows bridge, `bridge/index.ts`, `queries.ts`, and both `AdeStageBlock.vue` and `useNeedsAction.ts` callers.
4. `rg -n "resume_id|resumed_from" apps/*/internal/storage/migrations internal/scriptruns/repo.go`: both migrations plus repo use.
5. `rg -n "func \(s \*Service\) Resume|func \(b \*Bound\) Resume" internal/scriptruns` two hits; `rg -n "\.resume\(" packages/workbench/src/automations` a real caller.
6. `rg -n "RunResumeLine" internal apps --glob '!*_test.go'`: registry plus ADE and scriptruns callers; no resume prompt string outside `registry.go` (guard script green in `bun run lint`).
7. `rg -n "EndResumeLost|IsNoConversation" internal apps --glob '!*_test.go'`: outcome plus ADE agent, smart step and scriptruns callers.
8. `rg -n "SetGate|ConfirmQuit|CancelQuit|QuitStatus" internal/shell apps/*/internal/{appwire,bridge} apps/*/main.go apps/*/internal/flowharness`: gate wired in both apps' main and harness; `rg -n "KindQuit" internal/prompts apps/*/internal/appwire` used.
9. `rg -n "QuitPrompt" apps/*/frontend/src/App.vue` two hits; `rg -n "ConfirmDialogView" packages/workbench/src/prompts/QuitPrompt.vue` one.
10. Every en.json key in section 7 present; `bun run lint` (catalog check) green.
11. Flow logs: `TestResumeAfterRestart`, `TestResumeLostConversation`, `TestResumeRefused`, both `TestSmartScriptResume`, `TestQuitConfirm`, Studio quit test pass; coverage gate green in both apps.
12. UI logs: `ade-v2-resume`, both `automations-resume`, both `quit-confirm` specs pass; contracts read, not inlined.
13. Real `claude` rows pass with spend reported; `TestAdeResumeRun` log shows the interrupted `tool_result` text.
14. `docs/ARCHITECTURE.md` Known open items has the detached-runner entry; resume and quit-gate sections present.
15. Planner and implementer tool logs show `codegraph_explore` calls for discovery beyond this plan.

## 13. Decisions log (final)

- Resume a mid-turn kill directly: probe A shows the CLI repairs the orphan `tool_use` and flags the outcome unknown.
- No continuation or fresh-run fallback for a cut turn: the conversation survives; only the turn is lost.
- Lost transcript fails visibly with `EndResumeLost`, Retry stays: an automatic fresh run hides the loss and spends twice.
- Spec written at `Recover` in the stuck-marking `UPDATE`: atomic, and the UI reads one flag.
- ADE spec only for restart-stuck agent runs: user stops and `needs_input` are deliberate; Take over covers them.
- Rebase and script-stage runs not resumable: rebase has its own recovery; scripts have no session.
- Resume is a new attempt (ADE) or new row (smart): history keeps the interruption; logs stay per process.
- Old ADE spec cleared before launch, smart spec taken by compare-and-set: one click never launches twice.
- Same Claude session id on resume: probe A, the CLI keeps it; `--session-id` with `--resume` is an error (probe E).
- Resume in the original cwd: tools, hooks and relative paths expect it, although probe C shows it is optional.
- Smart resume re-plans from the current script: one launch path; budget, timeout and MCP are not on the row.
- Secret params block smart resume: secrets are never stored.
- One shared `RunResumeLine` prompt with `App`: same situation in both apps; editable in Settings (P271).
- `composeResumePrompt` kept: the finish instruction must follow the current step results.
- Live = ADE runs, script runs, agent PTYs; shells excluded: count what a quit loses, avoid prompt fatigue.
- Gate in `Quitter`, popup through the prompts router: single target window, reopen when none, existing reveal path.
- `QuitPrompt` renders `ConfirmDialogView`, not the confirm store: the store is single-slot.
- No prompt on last-window close: the app keeps running.
- No prompt on `OnShutdown`: a signal has nobody to ask.
- "Quit anyway" is today's quit: no new teardown path; rows become resumable on next boot.
- Count shown at ask time, refreshed on dialog mount: quit is seconds away; no live push needed.
- One sequential implementer: shared files across Go, wire and UI; order-dependent.
- No unit tests: flows and UI specs cover the logic; nothing meets the complexity bar.

## 14. Result

(Filled at close-out.)
