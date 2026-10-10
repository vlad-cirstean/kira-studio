# P242 Part 4 plan, iter2: recurring scripts

SPEC row P242 Part 4 (both apps; ADE target Space only). Baseline: iter1 `P242-plan.md` 2.7 and
section 6. Planned against `738a05080` (v2.0 after P242 Parts 1-3). Where this file and iter1 differ,
this file wins (iter1 predates Part 3 and the user's later asks: confirm popup, ADE workdirs).

Discovery: `codegraph_explore` (index re-synced first: `codegraph sync .`) over `internal/scriptruns`
(`Service`, `Begin`, `plan`, `planADE`, `useWorktree`, `Start`, `claimWorktree`, `startPlanned`,
`startSmart`, `startTerminal`, `runTrigger`, `decide`, `Close`, `Recover`, `Repo`, `logSink`, `Bound`,
`ADE`), `internal/scripts` (`CustomScript`, `CustomScriptFields.Validate`, `Smart`, `ResolveDir`,
`PrepareDir`, `BuiltinVars`), `internal/runoutcome`, `claudeheadless/process.go` (`Run`, `lineWriter`),
`loginshell`, `procgroup`, `shell.WindowRegistry` (`AnyRealKey`), `dbmcp.ApprovalBroker` and
`notify.PendingQueue` (popup precedent), Automations frontend (`module.ts`, `ScriptDialog`,
`AutomationsPanel`, `RunsSection`, `ScriptRunView`, `RunStatusBadge`, `runsQueries`, `RunScriptDialog`).
Read directly (not indexed or config): `apps/kira-space/internal/ade/automation.go`,
`apps/*/internal/appwire/{appwire,wire}.go` (script runs wiring, `revealNote`),
`agentnotify.HandleScriptRun`, `bridge/customscripts.go`, migrations `0034-0036` / `0026-0029`,
`flowharness/harness.go`, `flows/coverage`, gronx v1.20.4 source (`next.go`, `gronx.go`, LICENSE).

## 0. Requirements carried

- R1 Third Automations option **recurring script**: a normal or smart script fired by a cron
  expression (5 fields, timezone, next 3 fires shown); enable toggle; run now.
- R2 Where it runs: the script's own folder choice (Kira automations folder `<app home>/automations/<id>`
  by default, or a picked folder; never `$HOME` for new scripts), or (Space) an ADE task's worktree,
  the folder that task's workflow steps run in.
- R3 By default a due run shows a confirm popup and starts only after accept. Per script: "Run
  without asking".
- R4 Overlap guard on every recurring script, both kinds: previous run still running, or its popup
  still unanswered, means skip this tick and wait for the next; the skip shows as `skipped` with its
  reason in the runs list.
- R5 Missed fires (app closed, machine asleep) are skipped; fires only while the app runs.
- R6 Normal scripts run headless on a schedule; scheduled runs share the run list with trigger
  `scheduled`.
- R7 Notification on failure (Space, P238 sink).
- R8 Studio too, without the ADE target.
- R9 Every preview shows resolved values through `VarText` (confirm popup, run-now popup, run tab).
- R10 No credential reads (nothing new read; secrets never stored).
- R11 Flow-test coverage gate green, both `exempt.txt` empty. Tests only per CLAUDE.md bar; the
  scheduler's tick, overlap and skip logic qualifies (concurrency, time arithmetic).
- R12 shadcn-vue, Tailwind, VueUse, Pinia, TanStack; `<script setup lang="ts">`; no `<style>`.
- R13 Library: `github.com/adhocore/gronx` (MIT, zero deps).
- Out of scope (P246): popup routing across windows beyond "main window", queueing while no window
  is open, system notification for the confirm popup.

## 1. Current tree (verified)

- `scriptruns.TriggerScheduled = "scheduled"` exists, unused. `script_runs.trigger_kind` CHECK already
  allows it; `state` CHECK is `running|done|failed|cancelled|blocked` (no `waiting`, no `skipped`).
- `custom_scripts` latest columns: `kind params_json smart_json use_ade_dir`. Latest migrations: Studio
  `0036_p242_scripts_in_ade.sql`, Space `0029_p242_scripts_in_ade.sql` (identical bodies).
  `script_run_logs` has no FK to `script_runs` (rebuild-and-swap is safe; precedent Studio `0002`).
- `Service.plan(args, claimed)` resolves params, ADE vars (`planADE`), folder (`ResolveDir` or
  `useWorktree`), smart prompt and tools, blocker, hash. `useWorktree` checks `ADE.Busy` for smart only.
- `Start` claims the worktree for smart (kept) or pending normal (released at once). `startSmart`
  inserts a fresh `Run` (`runTrigger`: `ade` with a task, else `manual`), tracks it in `s.smart`
  (cap `maxSmartRuns = 3`), finishes via `decide`. `startTerminal` returns a launch token; `Begin`
  records the run when the tab opens. No headless normal runner exists.
- `Stop`: smart -> cancel context; else `Registry.Close(terminalID)`. `Close` stops smart runs and
  waits. `Recover` fails every `running` row.
- `claudeheadless.lineWriter` (unexported) splits a stream into capped lines; `procgroup.GracefulCancel`
  and `loginshell.{ResolveShell,BuildArgv}` are the shared spawn pieces.
- No scheduler, no clock seam, no cron dependency (`go.mod` has nothing cron-like).
- `shell.WindowRegistry.AnyRealKey()` = smallest key of a non-ephemeral window, deterministic; Space
  `revealNote` already uses it as "the window to show a generic thing in". Both appwires hold the
  registry. `appevent.EmitTo` targets one window.
- `dbmcp.ApprovalBroker` broadcasts its pending queue to every window (precedent for a queued popup;
  its routing is what P246 generalizes).
- `scripts.Service.broadcast` is the one place every script mutation passes; no change hook exists.
- `agentnotify.HandleScriptRun` posts for smart runs only.
- Frontend: `ScriptDialog` (kind fixed per open; `+` menu items `New script`, `New smart script`),
  `RunsSection` (smart row opens the run tab, normal row expands), `ScriptRunView` (smart-only header:
  model, prompt, Continue), `RunStatusBadge`/`runText` maps per state, `RunPreview` (VarText),
  `AdeContextFields` (task combobox, branch radio), `RunScriptDialogHost` mounted in both
  `WorkbenchShell.vue`. Context menu supports `submenu`.
- gronx v1.20.4: `IsValid(expr)`, `NextTickAfter(expr, start, incl)` on the start time's location;
  accepts 5-7 fields and `@` tags, so field count and tags are checked by us first. v1.20.5
  (2026-09-27) is under 14 days old today; v1.20.4 (2026-09-17) is the pin.

## 2. Decisions (planner defaults; user may override)

- D1 **A recurring script is a script with a schedule.** `custom_scripts.schedule_json` ('' = none),
  same pattern as `smart_json`. Any script can gain or drop a schedule in its editor. The `+` menu
  gains a `New recurring script` submenu: `Script`, `Smart script` (opens the editor with the
  schedule on). Rows show a clock badge and the next fire. No separate table: nothing runtime is
  persisted beyond runs (missed fires are skipped, so no last-fire bookkeeping).
- D2 **Cron**: exactly 5 fields, no `@` tags, no seconds or years (checked before gronx). Timezone is
  an IANA name, default the window's `Intl` zone; Go validates with `time.LoadLocation` and the
  package imports `time/tzdata`. DST: a nonexistent local time is skipped; a repeated wall time
  fires once (a fire whose wall time in the zone equals the previous fire's is dropped).
- D3 **Where it runs.** Default: the script's own folder (`ResolveDir`: Kira automations folder, or
  the picked folder; legacy `home` rows keep their notice). Space: the schedule may pin an ADE task
  (and branch); the run then resolves exactly as a run for that task (Part 3): ADE variables, and the
  branch worktree when `use_ade_dir`. "Task or workflow" both name that worktree: a workflow step of
  the task runs there. Studio has no ADE target (refused at fire with Part 3's text).
- D4 **Confirm by default.** `schedule.confirm` default true; the editor's Switch reads "Run without
  asking" (inverted). A due run with confirm inserts a `waiting` run row; the popup lists waiting
  rows. Until P246 the popup shows only in the **main window** = `WindowRegistry.AnyRealKey()` (the
  same window `revealNote` picks); other windows show nothing but the runs list row.
- D5 **Overlap guard, any trigger.** At a tick, a `running` or `waiting` run of the same script (from
  any trigger: schedule, Automations, ADE, terminal tab) skips the tick: a `skipped` row with reason
  `the previous run is still running (started 09:00)` or `the previous run is still waiting for your
  answer (due 09:00)`. The run that is still going is left alone.
- D6 **Other reasons a tick skips**, each a `skipped` row with the plan's own text: blocker (smart cap
  `3 smart scripts are running…`, ADE busy, worktree preparing, MCP server gone, folder missing),
  missing values, plan error (`the task no longer exists`, `tasks exist only in Kira Space`).
- D7 **A waiting popup never expires on its own.** It ends on accept (runs then, even late), decline
  (`skipped`, reason `you declined it`, source `user`), the schedule turned off or removed or the
  script removed (`skipped`, `the schedule was turned off` / `the script was removed`), or app quit
  (`skipped`, `Kira <App> closed before you answered`, set by `Recover` at next boot).
- D8 **Missed fires are silent.** App closed, or a timer that arrives more than 60 s after its fire
  time (sleep, clock jump): no row; the next fire is computed from now. Stated in the editor: "Runs
  only while Kira <App> is open. Missed runs are skipped."
- D9 **Normal scripts run headless on a schedule**: login shell `-c <command>`, no terminal tab, no
  stdin, stdout/stderr into `script_run_logs`, the run tab shows it. Timeout per schedule
  (`schedule.timeout`, default `30m`, bounds `1m`-`24h`; normal scripts only). Smart scripts keep
  their own timeout.
- D10 **A scheduled run in a worktree holds the claim, both kinds** (Part 3 D2 exempted normal
  terminal runs because a person controls that tab; a headless run is unattended and bounded by its
  timeout). Busy branch -> skip (D6).
- D11 **Secrets are never stored.** `schedule.params` holds non-secret values only. A script with a
  secret param needs confirm on; the popup asks the secret values (ParamsForm limited to secrets).
  Saving `confirm: false` on such a script is refused: `a recurring script with a secret param must
  ask before each run: secrets are never stored`.
- D12 **ADE variables without a task are refused at save**: `VarsUsed(command)` holds a built-in and
  `schedule.taskId == ""` -> `a recurring script without a task cannot use {branch}` (first built-in
  named). Same rule as `planADE`'s `askTask`, so Studio refuses them too.
- D13 **Run now** (row menu and editor): opens the same confirm popup locally in the clicking window
  (preview, secrets), accept starts the schedule's run headless now, trigger `scheduled`. Overlap is
  an error in the popup (`…is still running`), no `skipped` row (a person is there). Plain `Run…`
  keeps opening the normal run dialog.
- D14 **New states.** `waiting` (live, like `running`) and `skipped` (ended).
  `runoutcome.StatusSkipped = "skipped"`, `runoutcome.SourceSchedule = "schedule"`. ADE runs never
  produce either.
- D15 **Notification (Space)**: a run with trigger `scheduled` that ends `failed` posts
  `Recurring script failed · <name>` (body = reason) under `Enabled`, any kind. Other scheduled ends
  follow the existing smart rules (done/blocked prefs); normal scheduled `done`, `skipped` and
  `waiting` never post (confirm notifications are P246). Click opens the run tab
  (`kira:agent:reveal-script-run`, exists). Studio: no OS notifications.
- D16 **One cron parser, in Go.** Rows and the editor get next fires from bound `NextFires`; no TS
  cron library.
- D17 **gronx `pkg/tasker` declined**: it runs its own wall-clock loop with no injectable clock and
  has no notion of confirm, overlap-as-recorded-skip or plan blockers. Only `IsValid` and
  `NextTickAfter` are used.
- D18 **Line splitting moves, no new dependency**: `claudeheadless.lineWriter` moves to
  `internal/linewriter` (`New(onLine)`, `Write`, `Flush`), used by `claudeheadless.Run` and the new
  headless runner.
- D19 **Bound methods (6 new, `scriptruns.Bound`)**: `NextFires`, `SchedulePreview`,
  `RunScheduleNow`, `ConfirmAccept`, `ConfirmDecline`, `MainWindow`. Schedule writes go through the
  existing `CustomScripts.Create/Update`. Both apps' flows call all six; `exempt.txt` stays empty.
- D20 **No stream split.** Go types feed regenerated bindings the frontend needs; `scriptruns`,
  appwire, tests support and docs are shared. One sequential implementer.

## 3. Design

### 3.1 `internal/scripts`

`schedule.go` (new):

```go
// Schedule makes a script recurring; nil on a script that is not.
type Schedule struct {
    Cron     string              `json:"cron"`
    Timezone string              `json:"timezone"`
    Enabled  bool                `json:"enabled"`
    Confirm  bool                `json:"confirm"`  // ask before each run
    Timeout  string              `json:"timeout"`  // normal scripts; "" = 30m
    Params   map[string][]string `json:"params"`   // non-secret fixed values
    TaskID   string              `json:"taskId"`   // Kira Space ADE target; "" none
    BranchID string              `json:"branchId"`
}
const DefaultScheduleTimeout = "30m" // bounds MinScheduleTimeout 1m, MaxScheduleTimeout 24h
func ValidCron(expr string) error                  // 5 fields, no '@', gronx.IsValid
func NextFires(expr, tz string, after time.Time, n int) ([]time.Time, error) // DST rule D2
func (s Schedule) TimeoutDuration() time.Duration
```

- `NextFires`: `loc := time.LoadLocation(tz)`; loop `t = gronx.NextTickAfter(expr, t.In(loc), false)`;
  drop a candidate whose wall time (`t.In(loc).Format("2006-01-02 15:04")`) equals the previous
  accepted one; `n` capped at 10. Errors user-facing: `cron needs 5 fields: minute hour day month
  weekday`, `cron: <gronx text>`, `unknown timezone "x"`.
- `CustomScript`/`CustomScriptFields` gain `Schedule *Schedule json:"schedule"`. `Validate`:
  cron, timezone, timeout bounds, params (names exist, not secret, `ParamValues` accepts them),
  D11, D12; `TaskID == ""` clears `BranchID`. `repo.go`: `schedule_json` in `selectColumns`,
  `encodeExtras`, insert, update.
- `Service` gains `OnChange func()`, called after `broadcast` (the scheduler reloads).

### 3.2 Storage (identical bodies) Studio `0037_p242_recurring_scripts.sql`, Space `0030_p242_recurring_scripts.sql`

- `ALTER TABLE custom_scripts ADD COLUMN schedule_json TEXT NOT NULL DEFAULT '';`
- Rebuild-and-swap `script_runs` (`script_runs_new` with every current column, `state` CHECK adds
  `waiting`, `skipped`), copy, drop, rename, recreate `script_runs_created`, `script_runs_terminal`,
  `script_runs_task`, plus `script_runs_active ON script_runs (script_id) WHERE state IN ('running',
  'waiting')`.
- Migration test per app, in the existing `migrate_*_test.go` pattern: rows and indexes survive, the
  new states insert.

### 3.3 `internal/runoutcome`

`StatusSkipped`, `SourceSchedule`; helper `Skipped(reason string, src Source) Outcome`.

### 3.4 `internal/scriptruns`

`run.go`: `StateWaiting = "waiting"`. `repo.go`:

- `Active(scriptID) (*Run, error)`: newest `running|waiting` row of the script.
- `Waiting() ([]Run, error)`; `BeginWaiting(id string, run Run) (bool, error)`: one `UPDATE … SET
  state='running', started_at, cwd, command, prompt, params_json, tools_json, model, session_id, task
  fields WHERE id = ? AND state = 'waiting'` (false = already answered).
- `SkipWaiting(where, reason, src, now)`: by id, by script id, or all (Recover) -> changed runs.
- `FailRunning` unchanged; `Recover` also skips every `waiting` row (D7 quit text).

`plan` gains options: `plan(args RunArgs, o planOpts)` with `planOpts{claimed, headless bool}`
(replaces the bool). `headless` makes `useWorktree` check `ADE.Busy` for both kinds (D10).
`planned` gains `trigger Trigger` (set by the caller; `runTrigger` stays the default) and
`timeout time.Duration` (normal headless).

`schedule.go` (new): `scheduleArgs(rec CustomScript, secrets map[string][]string) RunArgs` =
`{ScriptID, Params: rec.Schedule.Params ∪ secrets, TaskID, BranchID}`; `Service.SchedulePreview`,
`Service.startScheduled(p, existing *Run)` (claim worktree when `Dir.Mode == worktree`, keep it for
both kinds; then `launchSmart` or `startHeadless`), `Service.skip(rec, due, reason)`.

`smart_run.go`: `startSmart(p)` becomes `launchSmart(p, run Run, existing bool)`; `existing` uses
`BeginWaiting` instead of `Insert`. Trigger from `p.trigger`. `smartRun` renamed `bgRun`.

`headless.go` (new) `startHeadless(p, run Run, existing bool)`:

- Tracked in `s.bg map[string]*bgRun` with `s.bgWait`; not counted in the smart cap.
- `argv := loginshell.BuildArgv(ResolveShell(...), command)`; `cmd.Dir = p.dir.Path`;
  `cmd.Env = ScrubGitEnv(os.Environ()) + GIT_TERMINAL_PROMPT=0 + p.envList`; `Setsid`;
  `procgroup.GracefulCancel`; stdout/stderr via `linewriter` into `newLogSink` (`stdout`/`stderr`).
- Outcome: `runoutcome.ForProcess(Process{Kind: KindScript, ExitCode, End})` with `EndTimeout`
  (`p.timeout`), `EndUser` (Stop), `EndQuit` (Close), `EndStartErr`; `WithLastError(lastStderr)`.
- `Service.ScheduleTimeout time.Duration`: when positive, replaces every headless run's timeout (a
  flow test; `SmartTimeout`'s twin). `flowharness.WithScheduleTimeout(d)` in both harnesses.
- `Stop`: a run with `TerminalID == ""` and kind `script` stops its `bgRun`; a `waiting` run is
  declined (D7 text `stopped by you`). `Close` stops smart and headless runs and waits both.

`scheduler.go` (new):

```go
type Clock interface { Now() time.Time; After(d time.Duration) <-chan time.Time }
type Scheduler struct {
    Svc   *Service
    Clock Clock         // nil = real clock
    Late  time.Duration // 60 s; a fire seen later than this is missed (D8)
    // fire and list default to the Service paths; the unit test replaces both (no DB).
    fire func(scriptID string, due time.Time)
    list func() ([]scripts.CustomScript, error)
    // unexported: mu, entries map[scriptID]entry{next time.Time; wall string; sched scripts.Schedule}, wake chan, stop chan, done chan
}
func (s *Scheduler) Start()   // load, then one goroutine
func (s *Scheduler) Reload()  // non-blocking send on wake (buffered 1)
func (s *Scheduler) Close()   // stop the loop, wait
```

- Loop (single goroutine owns `entries`): on start and on every wake, `reload(now)`: list scripts;
  for each enabled schedule keep the entry when cron and timezone are unchanged, else compute `next`
  from `now`; drop removed or disabled ones and `SkipWaiting` their waiting rows (D7). Then wait on
  `Clock.After(earliest - now)`, `wake`, or `stop`.
- On timer: for each entry with `next <= now` in order of `next`: if `now - next > Late` -> missed,
  no row; else `fire(scriptID, next)`. Then `next = NextFires(cron, tz, next, 1)` (dedupe rule via
  `wall`); a `next` still `<= now` (long sleep) advances from `now`.
- `fire` (synchronous in the loop, so one script never races itself): `Svc.Scripts.Get`; gone or
  disabled -> drop. `Svc.Runs.Active(id)` non-nil -> `skip` (D5 text). `plan(scheduleArgs, {headless:
  true})` error, blocker or missing -> `skip` (D6). Confirm on -> insert a `waiting` run
  (`CreatedAt = due`, trigger `scheduled`, cwd, command or prompt, params, task fields) and emit.
  Else `startScheduled(p, nil)`; a start error -> `skip` with its text.
- `Service.Scheduler *Scheduler` back-pointer for `RunScheduleNow` and `Confirm*` (they run on the
  bound goroutine, take no scheduler lock; overlap is re-checked through `Runs.Active` there).

Confirm and run-now (`confirm.go`, new):

- `SchedulePreview(scriptID, secrets)` -> `Preview` of `scheduleArgs` with `{headless: true}`.
- `ConfirmAccept(runID, hash, secrets)`: run must be `waiting` (else `E_INVALID` `this run was already
  answered`); script and schedule must exist (else skip the row, `E_INVALID`); another active run of
  the script (not this row) -> `E_INVALID` D5 text; plan, hash check (`E_CONFLICT` as `Start`),
  `startScheduled(p, &run)`.
- `ConfirmDecline(runID)` -> `SkipWaiting` by id, `you declined it`, source `user`; no-op when already
  answered.
- `RunScheduleNow(scriptID, hash, secrets)`: active run -> `E_INVALID` D5 text; plan, hash,
  `startScheduled(p, nil)`.
- `MainWindow()` -> `Service.MainWindow()` (func field set by appwire: `Windows.AnyRealKey`), `""`
  when none.

`bound.go` additions (D19):

```go
type NextFiresArgs struct { Cron, Timezone string; Count int }        // json cron, timezone, count
func (b *Bound) NextFires(a NextFiresArgs) ([]int64, error)            // unix ms; E_INVALID with the parse text
type ScheduleArgs struct { ScriptID string; Secrets map[string][]string } // json scriptId, secrets
func (b *Bound) SchedulePreview(a ScheduleArgs) (Preview, error)
type ScheduleStartArgs struct { ScheduleArgs; Hash string }
func (b *Bound) RunScheduleNow(a ScheduleStartArgs) (Started, error)
type ConfirmArgs struct { RunID, Hash string; Secrets map[string][]string }
func (b *Bound) ConfirmAccept(a ConfirmArgs) (Started, error)
func (b *Bound) ConfirmDecline(a IDArgs) error
func (b *Bound) MainWindow() (string, error)
```

`RunArgs` gains `ListTasks bool json:"listTasks"`: Space fills `Needs.Tasks` even when no ADE variable
is used (the schedule editor's task picker).

### 3.5 Wiring (both appwires)

- `scriptruns.Service.MainWindow = w.Windows.AnyRealKey` (Studio: `lifecycle.windows`).
- `Scheduler{Svc: runs, Clock: opts.Clock}`; `runs.Scheduler = sched`; `Start()` after `Recover()`
  and after `runs.ADE` is set (Space); `Close()` in teardown before `runs.Close()`.
- `bridge.CustomScriptsService` gains `Changed func()`, passed to `scripts.Service.OnChange`; appwire
  sets it to `sched.Reload`.
- `appwire.Options.Clock scriptruns.Clock` and `ScheduleTimeout`; `flowharness.WithClock(c)` and
  `WithScheduleTimeout(d)` in both harnesses.
- `go.mod`: `github.com/adhocore/gronx v1.20.4` (or the newest tag at least 14 days old at
  implementation time).

### 3.6 Space notification

`agentnotify.HandleScriptRun`: track `running` runs of kind smart, or trigger `scheduled` of any
kind. On end: trigger `scheduled` and `failed` -> title `Recurring script failed · <name>` under
`Enabled`; otherwise today's smart rules; normal non-failed ends never post. `waiting`/`skipped`
never post.

### 3.7 Frontend (shared workbench)

- Domain: `scriptRunStateSchema` adds `waiting`, `skipped`; `runOutcomeSchema` status/source add
  `skipped`/`schedule`; `scriptScheduleSchema` mirrors `scripts.Schedule`; `customScriptFieldsSchema`
  gains `schedule: scriptScheduleSchema.nullable()`; `ScriptRunArgs.listTasks?`.
- `module.ts` `ScriptRunsSeam` adds `nextFires`, `schedulePreview`, `runScheduleNow`,
  `confirmAccept`, `confirmDecline`, `mainWindow`; both apps' `automationsModule.ts` and bridge
  (`control.scriptRuns*`) wire them; mock runtime FQNs added.
- `runText`/`RunStatusBadge`: `waiting` "Waiting for you" (`warn`), `skipped` "Skipped" (`default`).
  `RunsSection`: a row with `terminalId === ''` opens the run tab (smart or headless); trigger
  `scheduled` shows `· scheduled`; a skipped row expands to its reason (RunOutcomeBlock).
  `RunsStatusItem` unchanged (running only).
- `ScriptRunView`: smart-only parts (`SmartBadge`, model, `Prompt sent`, Continue) gated on kind;
  a normal headless run shows `Command` (pre) and the log. A `waiting` run shows `Review and run`
  (opens the confirm dialog locally) and `Decline`.
- `schedule/ScheduleFields.vue` (new, in `ScriptDialog` under the folder field; a Switch "Run on a
  schedule" toggles it; on by default from `New recurring script`):
  - Cron `Input` + presets `NativeSelect` (Every 15 minutes, Every hour, Every day 09:00, Weekdays
    09:00, Mondays 09:00); `Next: Tue 09:00, Wed 09:00, Thu 09:00` from `nextFires` (TanStack query,
    `refDebounced` 250 ms, formatted with `Intl.DateTimeFormat` in the chosen zone) or the parse error
    as `FieldError`.
  - Timezone `Popover` + `Command` over `Intl.supportedValuesOf('timeZone')`, default the window's.
  - Switches: `Enabled`, `Run without asking` (disabled with a reason when the script has a secret
    param).
  - `Timeout` `Input` (normal scripts only).
  - Values: `ParamsForm` over non-secret params (fixed values).
  - Space (`ctx.ade`): `Where` `RadioGroup` `Script folder` | `An ADE task`; the task choice reuses
    `AdeContextFields` fed by `ctx.runs.preview({…, listTasks: true})`.
  - Note text (D8) and "A run still going, or still waiting for your answer, makes the next one skip."
- `ScriptDialog`: kind stays fixed per open; `AutomationsPanel` `+` menu adds the `New recurring
  script` submenu (`Script`, `Smart script`); editor props gain `schedule?: boolean` (initial on).
- Rows (`AutomationsPanel`): clock `CodiconIcon` (`watch`) on scripts with a schedule, `next 10:00`
  (from `nextFires` count 1, `refetchInterval` to that instant) or `off`; last scheduled run state
  (`useScriptRuns`, newest `scheduled` run of the script). Row menu: `Run now` (D13), `Turn schedule
  on/off` (calls `scripts.update` with `schedule.enabled` flipped).
- `schedule/ScheduleConfirmDialog.vue` (new): title `Run <name>?` + `SmartBadge` for smart, `Due
  09:00` or `Now`; `RunPreview` of `schedulePreview` (VarText: folder, env, command or prompt,
  task/branch); `ParamsForm` over secret params only; `Run` / `Not now` (waiting: decline) buttons;
  error line (`E_CONFLICT` refetches the preview). `Cmd/Ctrl+Enter` runs.
- `schedule/ScheduleConfirmHost.vue` (new, mounted next to `RunScriptDialogHost` in both
  `WorkbenchShell.vue`): `waiting` runs from `useScriptRuns` oldest first; shows the head when
  `mainWindow` query equals `windowKey` (`@workbench/util/window`); `N more waiting` line. The
  `mainWindow` query refetches when the waiting set changes and on `useWindowFocus` true. A
  run-now request (`useScheduleConfirmStore`, Pinia, one concern: the locally opened confirm) shows
  in the clicking window regardless.

### 3.8 Studio

Same shared code; `ade` false hides the ADE target. Nothing Studio-specific beyond wiring and the
migration.

## 4. Files (ownership, one implementer)

- Go shared: `go.mod`, `go.sum`; `internal/linewriter/linewriter.go` (moved), `internal/claudeheadless/
  process.go`; `internal/runoutcome/outcome.go`; `internal/scripts/{schedule.go,scripts.go,repo.go,
  service.go}`; `internal/scriptruns/{run.go,repo.go,preview.go,ade.go,launch.go,smart_run.go,
  service.go,bound.go,schedule.go,headless.go,scheduler.go,confirm.go,scheduler_test.go}`;
  `internal/flowtest/fakeclock/fakeclock.go` (new).
- Studio: `internal/storage/migrations/0037_p242_recurring_scripts.sql` + migration test,
  `internal/appwire/{appwire,wire}.go`, `internal/bridge/customscripts.go`, `internal/flowharness/
  harness.go`, `internal/flows/termflow/schedule_test.go`, `frontend/src/bridge/*`,
  `frontend/src/workbench/{automationsModule.ts,WorkbenchShell.vue}`, mock runtime,
  `tests/ui/automations-recurring.spec.ts`, `tests/e2e-real/automations-recurring-real.spec.ts`,
  regenerated bindings, visual baseline `script-dialog` if changed.
- Space: `internal/storage/migrations/0030_p242_recurring_scripts.sql` + migration test,
  `internal/appwire/{appwire,wire}.go`, `internal/bridge/customscripts.go`, `internal/agentnotify/
  agentnotify.go`, `internal/flowharness/harness.go`, `internal/flows/termflow/schedule_test.go`,
  `internal/flows/adeflow/schedule_test.go`, `internal/flows/notifyflow/notify_test.go`,
  `frontend/src/bridge/*`, `frontend/src/workbench/{automationsModule.ts,WorkbenchShell.vue}`, mock
  runtime, `tests/ui/automations-recurring.spec.ts`, `tests/e2e-real/automations-recurring-real.spec.ts`,
  regenerated bindings.
- Shared frontend: `packages/shared/domain/{scripts,scriptRuns,runOutcome}.ts`;
  `packages/workbench/src/automations/{module.ts,AutomationsPanel.vue,ScriptDialog.vue}`,
  `runs/{RunsSection,ScriptRunView,RunStatusBadge}.vue`, `runs/runText.ts`, `runs/runsQueries.ts`,
  `schedule/{ScheduleFields,ScheduleConfirmDialog,ScheduleConfirmHost}.vue`,
  `schedule/{scheduleQueries,confirmDialog}.ts`.
- Docs: `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md` (real claude row path list adds
  `scheduler.go`/`confirm.go`), `docs/v2.2/SPEC.md`, `docs/v2.2/plans/P242-part4-result.md`.

## 5. Tests

### 5.1 Unit `internal/scriptruns/scheduler_test.go` (concurrency and time arithmetic; CLAUDE.md bar)

Fake clock (`fakeclock`) and a stub `fire` recorder (the loop takes a `fire` func field so the unit
test needs no DB):

- `NextFires` `America/New_York`: `30 2 * * *` across the March change skips the missing day's 02:30
  instant (no 03:30 substitute fire); `30 1 * * *` across November fires once; `*/15 * * * *` over
  a UTC day = 96 instants; Monday-only weekday; invalid inputs (4 fields, 6 fields, `@daily`, bad
  zone).
- Loop: advancing 1 h with `*/15` fires 4 times at exact instants; a fire seen 61 s late is missed
  (no call), the next one fires; `Reload` with a changed cron re-arms (old instant never fires);
  disabled schedule never fires; `Close` returns with the loop stopped while a fire is pending.

### 5.2 Studio flows `flows/termflow/schedule_test.go` (fake clock via `flowharness.WithClock`)

- `TestScheduleValidation`: Create refuses bad cron, 6 fields, bad zone, timeout out of bounds,
  secret param plus `confirm: false`, `{task}` without a task, unknown param; `NextFires` returns 3
  ms instants and `E_INVALID` text for a bad cron.
- `TestScheduleHeadless`: normal script `echo hi; echo err >&2`, confirm off, `*/5`: advance -> run
  trigger `scheduled`, `terminalId` "", cwd `<home>/automations/<id>`, log holds `hi` and `err`,
  outcome `done`; `exit 3` -> `failed` `exited with status 3`; `sleep 30` with the harness timeout
  override (`WithScheduleTimeout(2s)`) -> `failed` `timed out after 2s`; `Stop` on a running one ->
  `cancelled` `stopped by you`.
- `TestScheduleOverlap`: `sleep 30` script, `* * * * *`: second tick -> `skipped` reason names the
  running run; Stop; next tick runs. Smart script with the slow fake claude: same rule.
- `TestScheduleConfirm`: confirm on: tick -> `waiting` row, no process; `MainWindow` equals the
  harness window key; `SchedulePreview` matches the waiting row's folder and command; next tick ->
  `skipped` `still waiting for your answer`; `ConfirmAccept` with the preview hash -> same run id goes
  `running` then `done`; a second accept -> `E_INVALID` already answered; edit script then accept with
  the old hash -> `E_CONFLICT`; `ConfirmDecline` -> `skipped` `you declined it`; turning the schedule
  off ends a waiting row `the schedule was turned off`; a secret param asked through `Secrets`
  reaches env and is stored masked.
- `TestScheduleRestart`: waiting row plus enabled schedule; `app.Restart(t)` with the clock 3 h ahead:
  waiting row `skipped` `Kira Studio closed before you answered`, no catch-up rows, next fire in the
  future, schedule still enabled.
- `TestRunScheduleNow`: runs headless at once, trigger `scheduled`; while running -> `E_INVALID`
  `still running`.
- `TestStudioScheduleRefusesTask`: a schedule with `taskId` set fires as `skipped` `tasks exist only
  in Kira Space`.

### 5.3 Space flows

- `flows/termflow/schedule_test.go`: the Studio cases above that exercise shared code, adapted to the
  Space harness (headless, overlap, confirm, restart, run now); every new bound method called.
- `flows/adeflow/schedule_test.go` `TestScheduleADE`: smart script `use_ade_dir` pinned to a task
  branch, confirm off: tick runs in the worktree with `KIRA_BRANCH`, task fields, trigger
  `scheduled`, the branch claim holds a step launch ("waiting for automation <name>") until it ends;
  a running step on the branch -> next tick `skipped` `a run is working on <branch>`; task archived ->
  `skipped` `the task no longer exists`; normal headless script in the worktree claims too.
- `flows/notifyflow`: scheduled normal `failed` posts `Recurring script failed · <name>`; scheduled
  normal `done`, `skipped` and `waiting` post nothing.

### 5.4 Playwright UI (mocked bridge), both apps `tests/ui/automations-recurring.spec.ts`

`New recurring script` submenu opens the editor with the schedule on; preset fills the cron; next 3
shown in the chosen zone; invalid cron shows the error and disables Save; `Run without asking`
disabled with a secret param; saved row shows the clock and `next`; row toggle flips `enabled`;
confirm popup shows for a pushed `waiting` run when `mainWindow` equals the window key and not
otherwise; popup preview uses `VarText` (folder chip); Run calls `ConfirmAccept` with the hash; Not now
calls `ConfirmDecline`; runs list shows `Skipped` with its reason; a headless run opens the run tab
with the log. Space adds the ADE target picker.

### 5.5 e2e-real, both apps `tests/e2e-real/automations-recurring-real.spec.ts`

Recurring normal script `echo scheduled-ok`, `* * * * *`, confirm on: popup appears within 75 s,
Run, run ends `Succeeded` with `scheduled-ok` in its log. Run now on a "run without asking" script
runs at once.

### 5.6 Real claude (opt-in)

`launchSmart` refactor touches the smart path: run the DEV_ENVIRONMENT "Smart scripts" row
(`TestSmartScriptRun`, both apps). No new real-claude case (the claude invocation is unchanged).

### 5.7 Checks

gofmt, `go vet ./...`, golangci-lint on changed packages, `bun run typecheck`, `bun run lint`,
`bun run lint:dead`, `test:flows:space`, `test:flows:studio` (coverage gate, both `exempt.txt`
empty), `go test ./internal/...`, both UI suites, both visual suites (regenerate only baselines this
phase changes), both e2e-real suites.

## 6. Commits

1. `refactor: move line splitting to internal/linewriter`
2. `feat(scripts): schedule on a script, cron and timezone validation` (gronx dep, migrations both
   apps, migration tests, runoutcome skipped)
3. `feat(scriptruns): headless normal runs` (bgRun, Stop, Close, run tab data)
4. `feat(scriptruns): scheduler, confirm and run now` (plan options, launchSmart, scheduler, bound
   methods, appwire both apps, fake clock, harness options, unit test)
5. `feat(space): notify failed recurring scripts`
6. `feat(workbench): recurring scripts editor, rows, confirm popup` (domain, seams, bridges, mocks,
   bindings)
7. `test: recurring scripts flows, UI and e2e-real`
8. `docs: recurring scripts` (ARCHITECTURE Automations paragraph and high-water marks `0037`/`0030`,
   Known open items entry: "cron confirm popup shows in the main window only, no system notification
   (P246)", DEV_ENVIRONMENT row paths, SPEC row `Done`, result file)

Hooks green on every commit; no `--no-verify`.

## 7. Orchestrator verification checklist

- [ ] Dependency: `rg -n "adhocore/gronx" go.mod` hits; version tag at least 14 days old at commit
      date; `rg -n "gronx\." internal` shows real callers in `internal/scripts/schedule.go`.
- [ ] Line splitting moved: `rg -n "type lineWriter" internal/claudeheadless` empty;
      `rg -n "linewriter\.New" internal` hits `claudeheadless/process.go` and `scriptruns/headless.go`.
- [ ] Scheduler real: `rg -n "TriggerScheduled" internal/scriptruns` hits `scheduler.go`/`confirm.go`;
      both appwires call `Start()` and `Close()` on it; `Changed`/`OnChange` wired to `Reload`.
- [ ] Overlap and skip: `rg -n "StatusSkipped" internal` shows scheduler and confirm callers;
      flows assert both skip texts (running, waiting).
- [ ] Confirm default on: `Validate`/editor default `confirm: true`; flow asserts `waiting` before
      any process.
- [ ] Main window only: `rg -n "AnyRealKey" apps/*/internal/appwire` hits the `MainWindow` wiring in
      both apps; UI spec covers the not-main case.
- [ ] Headless normal: no `TerminalStart` on scheduled runs; flow asserts `terminalId == ""` and log.
- [ ] Folder: flow asserts `<home>/automations/<id>` for a default scheduled run (never `$HOME`).
- [ ] ADE target (Space): adeflow asserts worktree cwd, claim hold, busy skip.
- [ ] Studio: no ADE target in the editor; refusal flow green.
- [ ] VarText: `rg -n "VarText|RunPreview" packages/workbench/src/automations/schedule` hits the
      confirm dialog.
- [ ] No credential reads: diff adds no read of keychain, `.claude.json`, settings `env`; secrets
      never written (`rg -n "Secret" internal/scripts/schedule.go` shows only the refusal).
- [ ] Migrations: both bodies identical (`diff`), contain `schedule_json`, `'waiting'`, `'skipped'`;
      ARCHITECTURE high-water marks `0037` / `0030`.
- [ ] Bound methods: 6 new; coverage gate green in both `test:flows:*`; both `exempt.txt` empty.
- [ ] Frontend rules: new `.vue` files `<script setup lang="ts">`, no `<style>`; one new Pinia store
      (`useScheduleConfirmStore`, one concern); no TS cron package in any `package.json`.
- [ ] Tests per bar: one unit file (`scheduler_test.go`); flows, UI, e2e-real as section 5.
- [ ] Hooks green, SPEC P242 Part 4 `Done` with result; real claude row run and noted in the result.
- [ ] Codegraph: this planner's run shows real `codegraph_explore` calls; the implementer executes a
      named plan (no call required).

## 8. Not in Part 4

P246: routing the confirm popup by origin across windows, queueing while no window is open, system
notification for the confirm. Catch-up runs after downtime (D8 skips them). A TS cron parser (D16).
Studio OS notifications.
