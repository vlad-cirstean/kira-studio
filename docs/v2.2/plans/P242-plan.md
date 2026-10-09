# P242 plan: Automations (smart scripts, schedules, universal run status)

SPEC row P242. User's words, condensed (two messages):

1. Smart scripts: scripts run on demand as headless Claude, reporting how they ended. Same params a
   workflow receives (task, branch, repo, ...), plus custom envs (free input or a multi-select of
   predefined options). Usable in workflows, from the terminal section, and from an ADE task. An
   interpolated variable with several values (2 branches, 2 repos) asks via a popup. AI badge.
   Studio has them too, without ADE variables.
2. "Very important": see that it runs while it runs, then whether it succeeded and the reason if
   not, the same for every headless Claude execution and every normal script execution.
3. Rename the Terminal section to **Automations** (terminal tabs stay "terminals").
4. A third kind, **recurring** scripts: a normal or smart script fired by a cron expression.
5. Working directory for every script: the ADE workdir when invoked from ADE (toggle), a picked
   folder, or by default a new folder under the Kira home, never `$HOME`.

Base: `v2.0` after P241 is implemented and committed. P242 builds on P241's outcome model and
`run_outcome` tool, so it never runs beside P241.

Discovery: `codegraph_explore` over the quick-command store and panel (`createCustomScriptsStore`,
`TerminalPanel`, `QuickCommandsDialog`, `module.ts`, `createTerminalTabs`, `createTerminalsStore`),
`internal/terminal` (`BoundService.Open`, `ValidateOpen`, `Registry.Open`, `newSession`),
`internal/quickcommands`, `kirapaths.Home`, `terminal.DefaultCwd`. `apps/kira-space/**` is mostly
not indexed, so these were read directly: `internal/ade/{vars,steps,runs,workflows}.go`,
`internal/adeflow/parse.go`, `internal/adeagent/{process,mcp}.go` (head),
`internal/flowharness/{main.go,fakeagent/fakeagent.go}`, `internal/bridge/{customscripts.go,
adewire/wire.go}`, migrations `0020`, `0023`; `internal/memory/claude.go`; the P238, P239, P240 and
P241 plans. One real-CLI probe (below).

## 1. What exists today

### 1.1 Quick commands ("custom scripts")

- One shared Go package `internal/quickcommands` (record, `Validate`, SQL `Repo`, `Service`); each
  app binds a shim `bridge.CustomScriptsService` and owns its own `custom_scripts` +
  `custom_script_collections` tables (Space `0020`/`0023`, Studio `0024`/`0031`/`0033`).
- Fields: `name`, `command` (shell text), `workingDir` (`''` = app default), `color`,
  `collectionId`. No params, no kind, no variables, no import/export (nothing to stay compatible
  with).
- Frontend: one shared module `packages/workbench/src/terminal/**` mounted by both apps through
  `TerminalModuleContext` (`module.ts`), store `createCustomScriptsStore` (Pinia, snapshot pushed on
  `ChannelCustomScriptsChanged`), panel `TerminalPanel.vue`, editor `QuickCommandsDialog.vue`.
- Run: `runScript` opens a **terminal tab** (`launch.kind: 'script'`), Go runs
  `$SHELL -l -i -c <command>` in a PTY (`terminal.newSession`). cwd = `workingDir || defaultCwd()`,
  and `defaultCwd` is **`$HOME`** (`terminal.DefaultCwd`).
- Status today: the PTY exit event sets `TerminalSession.status` `exited|failed` and `exitCode`;
  `TerminalHostView.vue` shows a footer line after exit. No elapsed time, no run record, no history,
  no reason beyond the exit code, nothing in the tab strip or status bar.

### 1.2 ADE variables and runs

- Variables: `runVars{Task, Jira, Repo, Branch, Worktree}`, `substitute()` replaces `{task} {jira}
  {repo} {branch} {worktree}` in one pass (known names only; unknown braces left as is); script
  stages quote each value with `quotePOSIX`. Workflows declare **no custom params**: these five
  are "the params a workflow receives". P241 adds a base per branch (`{base}` becomes meaningful).
- A step targets branches by `runs_on` (`once`, `each repo`, `only <nick>`), so a step run always
  has exactly one branch: no ambiguity inside a workflow.
- Headless Claude: `adeagent.Run` (`claude -p --output-format stream-json --verbose --session-id
  --mcp-config <0600 file> --setting-sources ... --allowedTools ...`, prompt on stdin, login-shell
  `exec`, process-group stop). No `--model`, no budget, env not scrubbed.
- Scripts: `superviseScript` runs `gitprepare` with timeout, note `exited with status N`.
- P241 (planned): `RunOutcome{Status done|failed|blocked, Reason, Source agent|verify|exit|timeout|
  restart|user, Reported, Verified, LastError, ...rebase fields}` on `ade_runs.outcome_json` for
  every agent run, synthesis table for no report, `run_outcome` MCP tool, `purpose` runs outside the
  workflow. Script stage runs get no outcome there.
- Other headless Claude: `internal/memory` gate and import calls (`claude -p --output-format json
  --json-schema`, budget, scrubbed env). They are steps inside one memory job, which already shows
  progress and a classified error.

### 1.3 Homes

`kirapaths.Home`: Studio `$KIRA_HOME` else `~/.kira-studio`; Space `$KIRA_SPACE_HOME` else
`~/.kira-space` (0700 layout via `EnsureLayoutAt`). Tests point both at temp dirs
(`testx.RunWithTempHomes`).

### 1.4 Probe (claude 2.1.295, haiku, 0.008 USD)

`claude -p --model haiku --output-format stream-json --verbose --setting-sources "" --strict-mcp-config
--no-session-persistence --max-budget-usd 0.10 --allowedTools 'Bash(ls:*)' --json-schema <schema>`:
the last line is `{"type":"result","subtype":"success","is_error":false,"structured_output":{"status":
"done","summary":"..."},"total_cost_usd":0.008,"num_turns":3,"permission_denials":[],
"terminal_reason":"completed",...}`. So stream-json (live log) and a schema-forced final report work
together, with cost and permission denials in the same event. The child also inherited the parent
Claude session id from the environment: env scrubbing (memory's `scrubbedEnv` list) is required.

## 2. Decisions

### 2.1 Names (requirement 3)

- User-facing module name **Automations** in both apps. Internal key stays `terminal` (mode key,
  workspace id `'terminal'`, persisted tabs and layout keyed on it, `TerminalModuleContext`,
  `packages/workbench/src/terminal/**`, `internal/terminal`, bound `TerminalService`,
  `CustomScriptsService`, `custom_scripts` tables, `data-testid`s). Renaming those is persisted-state
  migration and bound-name churn for no user-visible gain.
- Item names: **Script** (shell command, today's "quick command"), **Smart script** (headless
  Claude), **Recurring** (a schedule on a script of either kind). "Terminal" stays for real shells:
  tab title fallback `Terminal`, `+` menu item `Terminal`, `No terminal open`, repo terminals,
  Docker container `Terminal` tab.
- Mode icon `terminal-bash` -> `run-all` (codicon) so it reads as automations; tab icons unchanged.

User-visible strings changed (exhaustive from `rg`; the implementer re-greps after Part 1):

| File | Old | New |
|---|---|---|
| `apps/kira-space/frontend/src/workbench/modes.ts`, `apps/kira-studio/frontend/src/workbench/modes.ts` | `label: 'Terminal'`, `icon: 'terminal-bash'` | `'Automations'`, `'run-all'` |
| `packages/workbench/src/terminal/TerminalPanel.vue` | header `Quick commands`; `Add quick command…`; `New quick command` (2 menus); `No quick commands`; `Add one with + above.` | `Automations`; `New automation…` (menu: Script, Smart script, Recurring); `New script` / `New smart script` / `New recurring script`; `No automations`; unchanged |
| `packages/workbench/src/terminal/QuickCommandsDialog.vue` | `Add quick command` / `Edit quick command`; field `Script` | `New script` / `Edit script` (smart: `New smart script`); field `Command` |
| `packages/workbench/src/terminal/scriptActions.ts` | `It will no longer appear in Quick commands.` | `It will no longer appear in Automations.` |
| `docs/ARCHITECTURE.md` (Terminal module section), root `README.md` feature list | "Terminal module", "quick commands" | "Automations module (internal key `terminal`)", "scripts" |

Tests asserting those strings: `apps/kira-studio/tests/ui/{terminal-module,mode-switch}.spec.ts`,
`apps/kira-space/tests/ui/modules.spec.ts`, both `tests/e2e-real/terminal-real.spec.ts`,
`apps/kira-studio/internal/flows/termflow/quickcommand_test.go` (error strings only if changed:
Go error strings `quickcommands: ...` stay). Shortcuts: `packages/shared/domain/shortcuts.ts` has no
mode or terminal entry and native menus have no Terminal item (grepped), so nothing to keep in sync.

### 2.2 One run model for every execution (requirement 2)

Two run stores, one outcome type, one UI:

- **`ade_runs`** (existing) keeps every workflow run (agent step, script step, P241 rebase, and a
  smart script used as a workflow step). Their engine features (send-back, retry, gates, Take over)
  stay there.
- **`script_runs`** (new, both apps, shared package `internal/scriptruns`) records every Automations
  execution: a script run in a terminal tab, a smart script run (from Automations, from an ADE task,
  or by a schedule), a scheduled script run.
- **`internal/runoutcome.Outcome`** (new, shared) is the one outcome type. P241's
  `model.AdeRunOutcome` embeds it (JSON keys unchanged: Go flattens embedded structs), adding only
  its rebase fields. One TS schema `packages/shared/domain/runOutcome.ts`; Space `ade/v2/wire.ts`
  imports it instead of declaring its own.

```go
package runoutcome
type Status string // done | failed | blocked | cancelled
type Source string // agent | verify | exit | timeout | budget | restart | user | start
type Outcome struct {
    Status            Status   `json:"status"`
    Reason            string   `json:"reason"`            // one line; always set unless done
    Source            Source   `json:"source"`
    Reported          bool     `json:"reported"`          // the agent reported (finish_step or schema)
    Verified          bool     `json:"verified"`
    ExitCode          *int     `json:"exitCode,omitempty"`
    LastError         string   `json:"lastError,omitempty"` // last stderr line, bounded 1 KiB
    Summary           string   `json:"summary,omitempty"`   // agent's one line
    Details           string   `json:"details,omitempty"`   // agent's details, bounded 8 KiB
    CostUSD           *float64 `json:"costUsd,omitempty"`
    PermissionDenials []string `json:"permissionDenials,omitempty"` // tool names, bounded 50
}
func ForProcess(p Process) Outcome // exit/timeout/start error/user stop -> outcome (scripts, PTY, no-report agents)
func (o Outcome) CopyText(title string) string // "Copy for agent" text, one place
```

`ForProcess` rules (the one table every non-reporting execution uses):

| Case | Status | Source | Reason |
|---|---|---|---|
| exit 0, script | done | exit | `` |
| exit N != 0, script | failed | exit | `exited with status N` |
| exit 0, agent without report | failed | exit | `no report: Claude ended without reporting` |
| exit N, agent without report | failed | exit | `no report: claude exited with status N` |
| timeout | failed | timeout | `timed out after <d>` (agent: `no report: timed out after <d>`) |
| could not start | failed | start | `could not start: <err>` |
| Stop / tab closed while running | cancelled | user | `stopped by you` |
| app quit or crash while running | failed | restart | `interrupted: Kira <app> closed while it ran` |
| budget hit (`subtype error_max_budget_usd`) | failed | budget | `stopped at the budget of <x> USD` |

P241 changes for consistency (P242 Part 1 edits P241's code, not its plan): Stop maps to
`cancelled` (P241 table said `failed`, source `user`); ADE run **state** stays `failed` for a stop
(the step machine's vocabulary), the outcome carries `cancelled`. Script stage runs
(`superviseScript`) now store an outcome too (source `exit`/`timeout`/`user`/`start`).

Run states for `script_runs`: `queued | running | done | failed | blocked | cancelled` (`blocked` =
agent reported `needs_input`). UI labels: Queued, Running, Succeeded, Failed, Needs you, Cancelled.

Not covered: memory gate/import calls (steps inside one memory job with its own status and
classified error). Open question 1.

### 2.3 Smart scripts (requirement 1)

A smart script is a `custom_scripts` row with `kind = 'smart'`. `command` holds the instructions
(the prompt body). Settings in `smart_json`, params in `params_json`.

```ts
// packages/shared/domain/scripts.ts additions
scriptKind = z.enum(['command', 'smart']);
scriptParam = z.object({
  name: z.string(),           // ^[a-z][a-z0-9_]{0,31}$, not a built-in name
  label: z.string(),          // '' = name
  type: z.enum(['text', 'select', 'multiselect']),
  options: z.array(z.string()), // select/multiselect: 1..50, unique, each 1..200 chars, no newline
  default: z.array(z.string()), // text: 0..1 value; select: 0..1 option; multiselect: subset
  required: z.boolean(),
  secret: z.boolean(),        // text only: env only, never in the prompt, never stored with a run
});
smartSettings = z.object({
  model: z.enum(['haiku', 'sonnet', 'opus']),          // default sonnet
  maxBudgetUsd: z.number(),                            // default 1, 0.05..25
  timeout: z.string(),                                 // Go duration, default 15m, max 2h
  tools: z.enum(['read', 'edit', 'shell']),            // default read
  extraTools: z.array(z.string()),                     // adeflow tool patterns, max 30
  userMcp: z.boolean(),                                // default false (--strict-mcp-config)
});
dirMode = z.enum(['kira', 'fixed', 'home']);           // 'home' only on rows that predate P242
customScriptFields += { kind, params, smart: smartSettings.nullable(), dirMode, useAdeDir: z.boolean() }
```

- Built-in variables: Space `task jira repo branch base worktree`; Studio none. Names are reserved
  in both apps (a script stays valid if its body is ever pasted across).
- Syntax `{name}`, ADE's rule: one-pass replace of known names only; other braces stay literal (code
  samples in prompts survive). The editor lists the variables it found ("Uses: task, branch, env")
  so a typo shows as unused.
- Prompt value rendering: text as is; select the option; multiselect `a, b, c`. Env: every resolved
  built-in as `KIRA_TASK`, `KIRA_JIRA`, `KIRA_REPO`, `KIRA_BRANCH`, `KIRA_BASE`, `KIRA_WORKTREE`, each
  param as `KIRA_PARAM_<UPPER NAME>` (multiselect newline-separated). These are the user's
  "custom envs".
- Final prompt = body (substituted) + `\n\n` + fixed `SmartReportSuffix` (shown read-only in the
  preview): "When you finish, give your final report: status done when the task is complete, failed
  with the reason when it is not, needs_input with your question when you need a decision. Put what
  you did or found in details."
- Report contract (both apps, Automations and ADE-task runs): `--json-schema` with
  `{status: done|failed|needs_input, summary <=1000, reason <=1000, details <=8000}`, read from the
  stream-json `result` event's `structured_output` (probe 1.4). Decision table
  `decideSmartOutcome(result, exit)`:
  - result `success` + `structured_output` -> agent status (needs_input -> blocked), Reported,
    reason/summary/details, cost, denials. `failed` without reason -> reason `the script reported
    failure without a reason`.
  - `error_max_budget_usd` -> budget row; `error_max_turns` -> failed, source agent, `stopped at the
    turn limit`; `is_error` other -> failed, source agent, reason = bounded `result` text.
  - no result event -> `ForProcess` agent rows (exit, timeout, user, restart).
  - `permission_denials` non-empty and status not done -> reason gains ` (denied: Bash, Write)` so a
    too-narrow tool posture is obvious.
- Workflow steps keep `finish_step` (step semantics: send-back, retry); a smart script used as a
  step is just its prompt and settings inside a normal step run (2.6).

Headless argv (shared `internal/claudeheadless`, extracted from `adeagent/process.go` +
`stream.go`): `exec claude -p --output-format stream-json --verbose --session-id <uuid> --model <m>
--max-budget-usd <x> --setting-sources <app setting> [--strict-mcp-config] --allowedTools <list>
--json-schema <schema>`, prompt on stdin, scrubbed env + `KIRA_*` vars, cwd per 2.5. Tool lists:
`read` = Read, Grep, Glob; `edit` = + Edit, Write, NotebookEdit; `shell` = + Bash; plus
`extraTools`. Nothing else is allowed (`-p` denies unlisted tools; denials are reported). Session
persistence stays on so a blocked or failed run can **Continue in a terminal** (`claude --resume
<id>` in a terminal tab, kind `claude-code`, same cwd). Setting sources: Space's existing
`claudeCode.headlessSettingSources` setting; Studio `user,project,local` (Claude's normal). No file
in the user's Claude config is written (P233): no `--settings`, no MCP config file for smart runs.

### 2.4 Invocation and resolution (requirement 1)

Entry points:

- Automations panel (both apps): row click / `Run` on a script opens a terminal tab (today) unless
  it has params, then the run dialog first; on a smart script always the run dialog.
- ADE (Space): task context menu `Run automation` submenu (task card, plan list), branch row menu
  and branch panel header `Run automation…` (branch preset). Both kinds. A normal script from ADE
  opens a terminal tab in the Automations module with the ADE workdir and `KIRA_*` env.
- Workflow step: `smart_script:` key (2.6).
- Schedule (2.7).

One run dialog `packages/workbench/src/runs/RunScriptDialog.vue` (shadcn-vue `Dialog`), driven by
`ScriptRuns.Preview`:

1. **Task** (Space, Automations entry only, shown when the script uses an ADE variable or has
   `useAdeDir` on and ADE vars are referenced): `Command` combobox of live tasks. Not shown from ADE
   entries (task given).
2. **Branch** (Space): shown when a branch-bound variable (`branch repo base worktree`) is used, or
   `useAdeDir` applies, and the task has more than one mine branch: radio list `repo · branch`, drafts
   disabled with `not created yet`, a branch with a running ADE run disabled with `a run is working on
   it`. One branch: chosen silently (no ambiguity). Nothing is remembered between dialogs.
3. **Params**: one field per param in order: `text` -> `Input` (secret: password input), `select` ->
   `NativeSelect`, `multiselect` -> `Popover` + `Command` with check items (P241's base-picker
   pattern). Defaults prefilled; required marked.
4. **Preview** (read-only, live as fields change, `watchDebounced` 250 ms -> TanStack query keyed on
   the args): working directory (resolved path, its source `Kira scripts folder | picked folder |
   worktree of <branch>`, and `resolves to <realpath>` when it differs), model, budget, timeout, tool
   posture as a sentence ("Can read files; cannot edit or run commands"), MCP posture, env summary
   (`KIRA_BRANCH=feat/x`, secret values `••••`), and the full prompt with the suffix. A normal script
   shows the command and env instead of a prompt.
5. `Run` (disabled until Preview returns no `missing`); `Cancel`.

Injection rules (pinned by tests 5.1):
- Values never enter shell text: the claude argv is fixed; values go to stdin (the previewed prompt)
  and to env. A normal script gets values only as env (`$KIRA_PARAM_X`); `{name}` in a normal
  command is **not** substituted (unlike ADE script stages, which quote): env is the safe path and
  the preview tells the user so.
- Select/multiselect values must be members of the declared options (server-checked). Text: max
  2000 chars, no NUL or control characters except `\n` `\t`.
- `Start` takes the preview's `hash` (sha256 over prompt, cwd, model, budget, timeout, tools, MCP
  posture, env names and non-secret values). The server recomposes; a mismatch refuses with
  `the script or the task changed since the preview: check it again`. What runs is what was shown.

### 2.5 Working directory (requirement 5)

Per script: `dirMode` (`kira` default for new scripts, `fixed`, legacy `home`), `workingDir`
(for `fixed`), `useAdeDir` (Space; default on).

Precedence, first that applies:
1. Invoked from ADE (task entry, workflow step) and `useAdeDir` on -> the chosen branch's worktree.
   Missing worktree: Preview shows the blocker `the worktree of <branch> is missing: start the
   task's run first`; no fallback.
2. `dirMode fixed` -> `workingDir`. Missing or not a directory -> blocker `<path> does not exist`;
   never created by Kira.
3. `dirMode home` (legacy rows only) -> `$HOME`.
4. `dirMode kira` -> `<app home>/automations/<script id>` (Studio `~/.kira-studio/automations/...`,
   Space `~/.kira-space/automations/...`), created on first run with 0700 (`MkdirAll` then `Lstat`:
   the folder and `automations/` must be real directories, not symlinks; refuse otherwise with
   `<path> is a symlink: remove it`). The script id is a UUID, so no path escapes. Deleted with the
   script (best effort, only when inside `<app home>/automations/`).

Rules: every path absolute and `filepath.Clean`ed; Preview shows the resolved real path; a
`fixed` path is the user's choice and may be anywhere (it is their machine), shown before running.
Plain terminal tabs (the `+` menu, `No terminal open`) keep `$HOME`: they are shells, not scripts.

Migration: existing rows keep their behaviour explicitly. SQL sets `dir_mode = 'fixed'` where
`working_dir <> ''`, else `'home'`. The editor shows a legacy row a one-line notice: "Runs in your
home folder (the old default). New scripts use the Kira automations folder." with a `Use automations
folder` button. `home` is not offered for new scripts.

### 2.6 Smart script as a workflow step

`adeflow` agent step keys: `smart_script: <script name>` and optional `params: {name: value | [values]}`;
`prompt` and `allowed_tools` are refused next to `smart_script` (`prompt is not allowed with
smart_script`). Parse checks syntax only (the DB is not visible to the parser). At launch
(`startRun`, agent stage): deps `SmartScript(name) (quickcommands.CustomScript, error)`; prompt =
script body substituted with the step's `runVars` + params, then the usual `FinishStepSuffix`; model,
budget, tool posture from the script (union with `finish_step` and Space tools); timeout = step
`timeout` if set, else the script's. Unknown script, a required param without value, or a value not
in the options -> the run fails to launch with `could not start: smart script "x": <why>`. Editor
(`AdeStepCard.vue`): a `Prompt | Smart script` toggle; smart-script `NativeSelect` (AI badge in the
option label) plus a params form reusing `ScriptParamsForm.vue`. `adeflow/writer.go` writes the keys.
The step card and the ADE run views show the AI badge on such steps.

### 2.7 Recurring scripts (requirement 4)

A schedule is 1:1 with a script (`script_schedules.script_id UNIQUE`), so "Recurring" is the third
item kind in the UI: a script (normal or smart) plus its schedule; the row shows a clock badge and
`next 09:00`. A script can still be run on demand.

```ts
schedule = z.object({
  scriptId: z.string(),
  cron: z.string(),            // standard 5 fields, no seconds/years, no @macros
  timezone: z.string(),        // IANA, default the window's Intl timezone
  enabled: z.boolean(),
  allowOverlap: z.boolean(),   // default false
  missed: z.enum(['skip', 'once']), // default skip
  notifyOnFailure: z.boolean(), // default true (Space; Studio has no OS notifications)
  timeout: z.string(),         // normal scripts only, default 30m, max 24h
  params: z.record(z.array(z.string())), // fixed values; every required param must resolve
  lastFireAt, nextFireAt: z.number().nullable(),
  lastSkip: z.string(),        // e.g. "skipped 09:00: the previous run was still running"
});
```

- Library: **`github.com/adhocore/gronx`** (MIT, no dependencies, active: v1.20.4 2026-09-17,
  v1.20.5 2026-09-27). Not a dependency today; nothing cron-like is in `go.sum`. Used for `IsValid`
  and `NextTickAfter(expr, ref, false)`; field count is checked first (exactly 5). `robfig/cron/v3`
  declined: last release 2020. Pin the newest tag at least 14 days old at implementation time. Our
  own loop does the firing (a fake clock must drive it).
- Timezone: `time.LoadLocation`; next fire computed on wall time in that zone. The package imports
  `time/tzdata` so a missing system zoneinfo never breaks it. DST: a nonexistent local time is
  skipped; a repeated hour fires once (fires deduped by UTC instant). Flow test pins both.
- Scheduler `scriptruns.Scheduler{Clock}` (`Clock` interface `Now`, `NewTimer`; real and fake): one
  goroutine, a timer to the earliest `nextFireAt`, re-armed on any schedule write and after each
  fire. Fire: overlap check (a `queued|running` run of this schedule and `!allowOverlap` -> record
  `lastSkip`, no run), else start a run with trigger `scheduled`, then `lastFireAt`, recompute
  `nextFireAt`. Global concurrency cap shared with on-demand smart runs (2.8).
- Missed fires (app was closed, or the machine slept past a fire): on start and on a clock jump,
  `skip` recomputes from now; `once` runs one catch-up run if any fire was missed, then recomputes.
  Stated in the UI: "Runs only while Kira <app> is open. Missed runs are skipped" (or "run once when
  the app opens").
- Normal scripts on a schedule run **headless** (no terminal tab; nobody is watching): login shell
  `-c <command>`, cwd per 2.5 (never ADE), stdout/stderr captured to the run log, timeout from the
  schedule. Smart scripts run as in 2.3. ADE variables are refused in a scheduled script's body
  (`schedules run without a task: remove {branch}`); `useAdeDir` is ignored.
- Editor (in the script dialog, a `Schedule` section shown for Recurring): cron `Input` with a
  presets `NativeSelect` (hourly, daily 09:00, weekdays 09:00, weekly Monday 09:00), timezone
  `Command` combobox, live "Next: Tue 09:00, Wed 09:00, Thu 09:00" (bound `ScheduleNextFires`,
  TanStack query, debounced) or the parse error, `Switch`es enabled/overlap/notify, missed
  `RadioGroup`, timeout, fixed param values (`ScriptParamsForm`). Row: `Run now` (manual trigger,
  respects overlap), enable toggle, `last: 09:00 · failed`, `next: 10:00`.
- Failure notification (Space): P238 notifier, title `Recurring script failed · <name>`, body =
  reason, when `notifyOnFailure`. Studio: the status bar shows a failed-run dot until the runs list
  is opened (no OS notifications in Studio; stated in the editor).

### 2.8 Execution, live status, surfaces

`internal/scriptruns` (shared):

```go
type Trigger string // terminal | manual | ade | scheduled
type Run struct {
    ID, ScriptID, ScriptName, Kind, Color string
    Trigger                     Trigger
    State                       string // queued|running|done|failed|blocked|cancelled
    Outcome                     *runoutcome.Outcome
    TaskID, TaskTitle, BranchID string // Space ADE context, '' otherwise
    TerminalID                  string // terminal-tab runs
    ScheduleID                  string
    Cwd, Model, SessionID       string
    Params                      []ParamValue // name + display value; secrets never stored
    Prompt                      string       // smart: the exact prompt sent (secrets never in it)
    QueuedAt                    int64
    StartedAt, FinishedAt       *int64
    Dismissed                   bool
}
```

- Concurrency: at most 3 headless runs at once per app (smart + scheduled normal); more wait
  `queued` FIFO. Terminal-tab runs are not capped (the user opened them).
- Stop: headless -> process-group SIGTERM, SIGKILL after 2 s (shared `procgroup`); terminal-tab ->
  close the PTY session. Outcome `cancelled`, `stopped by you`.
- Logs: `script_run_logs(run_id, seq, stream, text)`, 250 ms batched writes (ADE `logSink` shape),
  bounded 5 MiB per run (then one `… output cut` line). Smart: parsed stream-json lines (assistant
  text, tool use names and inputs, tool results first line), as ADE run logs. Never env, never the
  token-free MCP config (none exists for smart runs).
- Push: `ChannelScriptRunsChanged` (`kira:script-runs:changed`, rows) per app; the frontend patches
  TanStack query caches (`setQueryData`), no polling.
- Retention: keep the newest 500 finished runs per app (and their logs); purge at start and hourly.
- Restart: at start every `queued|running` row -> `failed`, source `restart`.
- ADE gate (Space): a smart run whose cwd is a worktree refuses to start while an ADE run is
  `running|pending` on that branch (blocker in Preview); while a smart run runs in a worktree, the
  ADE engine holds a step run on that branch `pending` with note `waiting for automation <name>`
  (P241's rebase-gate hook gains this predicate), released on run end.

Surfaces (shared `packages/workbench/src/runs/**` components, Tailwind only):

- `RunStatusBadge.vue`: state icon (`loading~spin` running, `check`, `error`, `question`,
  `circle-slash`, `clock` queued) + label + live elapsed (`useElapsed(startedAt, finishedAt)`, VueUse
  `useNow({interval: 1000})` only while running).
- `RunOutcomeBlock.vue`: status, reason, source, exit code, cost, denials, summary, details (collapsed),
  `Copy for agent` (VueUse `useClipboard`, `Outcome.CopyText` format mirrored in TS), `Continue in
  terminal` (smart, blocked/failed with a session id), `Run again` (reopens the dialog with the same
  inputs).
- `RunLog.vue`: virtualised tail (`@tanstack/vue-virtual`, already a dependency) over `ReadLog`
  pages, follows the end while running.
- Automations panel: AI badge (`sparkle` codicon, `data-testid="script-ai-badge"`, tooltip `Smart
  script: runs Claude headless`) and clock badge on rows; a running row shows a spinner and elapsed;
  a `Runs` section under the scripts (collapsible, newest first, 50 shown, filter All/Running/Failed)
  with `RunStatusBadge`, trigger label (`terminal`, `manual`, `ADE · <task>`, `scheduled`), Stop.
- Run tab: a headless run opens a workbench tab of new kind `scriptRun` (state `{runId}`) in the
  Automations module: header (name, AI badge, `RunStatusBadge`, Stop), `RunOutcomeBlock` when ended,
  `RunLog`. Opened on Run (smart) and from any runs list row.
- Terminal tab of a script: tab icon `loading~spin` while running (terminal tab kind's `icon` hook
  reads the run state), header strip with `RunStatusBadge`; after exit the footer becomes
  `RunOutcomeBlock` (compact). `Copy for agent` there adds the last 40 lines of the xterm buffer
  (read from xterm, which already strips escape sequences).
- Status bar (both apps): `▶ N running` when N > 0 (click opens Automations runs), plus a red dot
  for unseen failed scheduled runs (Studio's notification substitute).
- ADE (Space): task card chip (`AdeAutomationChip.vue`): running `✦ <name> 0:42`, latest failed
  `✦ <name> failed` (red, tip = reason, `Dismiss`); task panel block `Automations` listing the task's
  runs with the shared components; step views show `RunOutcomeBlock` for every ADE run (P241's
  `AdeRebaseOutcome` composes it plus rebase extras); Needs you kind `automation` for blocked or
  failed undismissed task runs.
- Notification (Space, P238): smart runs ending not `done` -> `Automation failed · <name>` /
  `Automation needs you · <name>` with reason; `done` -> `Automation done · <name>` only when the
  P238 `notifyOnRunEnded` leaf is on. Click opens the run tab.
- Agents: P241's `run_outcome` tool gains `purpose: 'automation'`, reading `script_runs` of the
  grant's task. `composePrompt` adds the failed-automation line like P241's rebase line.

## 3. Split (CLAUDE.md: keep the number)

Too large for one implementer pass. Three parts, strictly in order, each its own plan, implementer
and result. This file is **Part 1's plan** and the design baseline for Parts 2 and 3; their own
plans (`P242-part2-plan.md`, `P242-part3-plan.md`) are written after the previous part lands, against
the then-current tree, reusing sections 2.3-2.7 here.

- **P242 Part 1: Automations rename, universal run status, working directory.** 2.1, 2.2, 2.5, the
  `script_runs` store and live surfaces of 2.8 for terminal-tab script runs and every ADE run.
- **P242 Part 2: Smart scripts.** 2.3, 2.4, 2.6, headless engine, run tab, ADE entries, gate,
  notification, `run_outcome`, Continue in terminal, normal scripts from ADE.
- **P242 Part 3: Recurring scripts.** 2.7, headless normal-script runner, scheduler, editor.

Cut line rationale: Part 1 ships the universal behaviour the user called very important on the
executions that exist today; Part 2 adds the new execution kind on top; Part 3 needs both (it fires
either kind headless).

## 4. Part 1 in detail

### 4.1 Go

| File | Change |
|---|---|
| `internal/runoutcome/outcome.go` | new: `Outcome`, `Status`, `Source`, `Process`, `ForProcess`, `CopyText` |
| `internal/runoutcome/outcome_test.go` | new: one table over `ForProcess` x script/agent x every row of 2.2 (the table other parts and both apps lean on; borderline under the bar, kept because three engines depend on its exact wording) |
| `apps/kira-space/internal/storage/model/adetask.go` | `AdeRunOutcome` embeds `runoutcome.Outcome` (P241 fields minus the generic ones) |
| `apps/kira-space/internal/ade/runs.go` | `superviseScript` and the no-report agent paths build outcomes via `ForProcess`; stop -> `cancelled` |
| `apps/kira-space/internal/ade/recover.go` | restart outcome via `ForProcess` |
| `internal/scriptruns/{run.go,repo.go,service.go,events.go}` | new: `Run`, SQL repo (`script_runs`), `Service` (List, Get, Stop, Dismiss, Recover, Purge), terminal hooks |
| `internal/scriptruns/workdir.go` | new: `ResolveDir(script, appHome, adeDir) (Dir, error)` with the 2.5 rules |
| `internal/quickcommands/{quickcommands.go,repo.go}` | fields `DirMode`, `UseAdeDir`; validation (`fixed` needs an absolute `workingDir`; `home` refused on create and on a change from another mode) |
| `internal/terminal/validate.go` | `OpenArgs.ScriptID string` (optional; set only with `launchKind: script`) |
| `internal/terminal/bound.go` | field `ScriptRuns ScriptRunHooks` (interface `Started(terminalID, scriptID, cwd string)`, `Exited(terminalID string, code int, err error)`, `Closing(terminalID string)`); `Open` calls `Started` for script launches and wires `onExit`; `Close` calls `Closing` first so the exit maps to `cancelled` |
| `internal/terminal/service.go` | `DefaultCwd` unchanged (shells) |
| `apps/kira-space/internal/storage/migrations/0027_p242_automations.sql` | new (after P241's `0026`; renumber if taken) |
| `apps/kira-studio/internal/storage/migrations/0034_p242_automations.sql` | new |
| `apps/{kira-space,kira-studio}/internal/storage/repos/repos.go` | `ScriptRuns` repo |
| `apps/{kira-space,kira-studio}/internal/bridge/scriptruns.go` | new shim `ScriptRunsService`: `List`, `Get`, `Stop`, `Dismiss`, `ResolveDir` (`ReadLog` arrives with Part 2's logs) |
| `apps/{kira-space,kira-studio}/internal/bridge/events.go` | `ChannelScriptRunsChanged` |
| `apps/{kira-space,kira-studio}/internal/appwire/*.go` | build `scriptruns.Service` (app home from `config.Home()`), hook it into `TerminalService.ScriptRuns`, `Recover` + purge at start, bound count +1 (update count comments) |
| `apps/{kira-space,kira-studio}/internal/bridge/terminal.go` | pass `ScriptRuns` |

Migration (both apps, same body):

```sql
ALTER TABLE custom_scripts ADD COLUMN dir_mode TEXT NOT NULL DEFAULT 'kira'
  CHECK (dir_mode IN ('kira', 'fixed', 'home'));
ALTER TABLE custom_scripts ADD COLUMN use_ade_dir INTEGER NOT NULL DEFAULT 1;
UPDATE custom_scripts SET dir_mode = CASE WHEN working_dir <> '' THEN 'fixed' ELSE 'home' END;
CREATE TABLE script_runs (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,          -- no FK: a run outlives its script
  script_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('command', 'smart')),
  color TEXT NOT NULL DEFAULT 'none',
  trigger TEXT NOT NULL CHECK (trigger IN ('terminal', 'manual', 'ade', 'scheduled')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'blocked', 'cancelled')),
  outcome_json TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '', branch_id TEXT NOT NULL DEFAULT '',
  terminal_id TEXT NOT NULL DEFAULT '', schedule_id TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL,
  queued_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  dismissed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX script_runs_recent ON script_runs (queued_at DESC);
CREATE INDEX script_runs_script ON script_runs (script_id, queued_at DESC);
CREATE INDEX script_runs_task ON script_runs (task_id, queued_at DESC);
```

`task_id`, `branch_id`, `schedule_id` and the `smart`/`manual`/`ade`/`scheduled` values are used by
Parts 2-3; they are declared now so the CHECK constraints need no table rebuild later (SQLite cannot
alter a CHECK in place). Part 1 writes only `command`/`terminal` rows; that is a schema choice, not
unused code.

Terminal-tab run flow: `TerminalPanel.runScript` resolves the dir through `ScriptRuns.ResolveDir`
(blocker shown in the panel error line), then opens the tab with `scriptId`; Go `Open` validates,
spawns, `Started` inserts `running` (trigger `terminal`, `terminal_id`); `Exited` patches
`ForProcess` (code -1 after `Closing` -> cancelled); emit. A script deleted while its tab runs keeps
its run (name copied).

### 4.2 Frontend

| File | Change |
|---|---|
| `packages/shared/domain/runOutcome.ts`, `packages/shared/domain/scriptRuns.ts` | new zod schemas |
| `packages/shared/domain/scripts.ts` | `dirMode`, `useAdeDir` |
| `packages/shared/domain/tabs.ts` | `terminalTabStateSchema.scriptId` optional (`''` default) |
| `packages/workbench/src/runs/{RunStatusBadge,RunOutcomeBlock,RunsSection}.vue`, `useElapsed.ts`, `runsQueries.ts`, `copyText.ts` | new (TanStack queries over a `ScriptRunsSeam`, cache patched from the push) |
| `packages/workbench/src/terminal/module.ts` | `TerminalModuleContext.runs: ScriptRunsSeam`; `openTerminalTab` launch carries `scriptId` |
| `packages/workbench/src/terminal/TerminalPanel.vue` | 2.1 strings, `New automation…` menu (Part 1: `Script` only), row running spinner + elapsed, `RunsSection` |
| `packages/workbench/src/terminal/QuickCommandsDialog.vue` | 2.1 strings, working-directory `RadioGroup` (`Kira automations folder` / `Choose folder…`), legacy notice, `Use the ADE worktree when run from a task` `Switch` (Space only, via a context flag) |
| `packages/workbench/src/terminal/TerminalHostView.vue` | status strip + compact `RunOutcomeBlock` footer for script tabs, xterm tail for copy |
| `packages/workbench/src/tabs/terminalTabKind.ts` | optional `iconFor(tab)` hook (spinner while the tab's run runs) |
| `packages/workbench/src/state/createTerminalTabs.ts`, `createTerminalsStore.ts` | pass `scriptId` to `terminalOpen` |
| `apps/{kira-space,kira-studio}/frontend/src/workbench/{modes.ts,terminalModule.ts,StatusBar.vue}` | label/icon, `runs` seam, `▶ N running` |
| `apps/{kira-space,kira-studio}/frontend/src/bridge/index.ts` (+ `control.ts` where calls live) | `scriptRunsList/Get/Stop/Dismiss/ResolveDir`, `onScriptRunsChanged`, `terminalOpen(..., scriptId)` |
| `apps/kira-space/frontend/src/ade/v2/wire.ts` | `RunOutcome` from the shared schema |
| `apps/kira-space/frontend/src/ade/v2/panel/{AdeStageBlock,AdeRebaseOutcome}.vue`, `ade/v2/run/*` where a run's end is shown | `RunStatusBadge` + `RunOutcomeBlock` for every ADE run |
| tests support `apps/*/tests/ui/support/{ipcChannels,mockRuntime}.ts` | new channels |

No new Pinia store in Part 1 (runs are server state: TanStack Query). Part 2's run dialog state is
component-local.

### 4.3 Tests (Part 1)

Go flow (real PTY, real temp dirs, default settings):
- `apps/kira-studio/internal/flows/termflow/automation_test.go` (new) and
  `apps/kira-space/internal/flows/termflow/automation_test.go` (new):
  1. Script `exit 0` in a tab: run row `running` while it sleeps 1 s (state read mid-run), then
     `done`, `exitCode 0`, `startedAt < finishedAt`, push received.
  2. `exit 3`: `failed`, reason `exited with status 3`.
  3. Close the tab mid-run: `cancelled`, `stopped by you`.
  4. Restart (`app.Restart()`) with a row left `running`: `failed`, source `restart`.
  5. Dir modes: new script without folder runs in `<KIRA home>/automations/<id>` (created 0700,
     `pwd` output asserted), `fixed` missing folder -> `ResolveDir` blocker, a symlinked
     `automations` dir refused, legacy row (inserted pre-migration via raw SQL, then migrated) runs in
     `$HOME` (test home) and reports `dirMode home`.
  6. Retention: 510 finished rows -> 500 after purge.
- Space `internal/flows/adeflow`: script stage exit 2 -> ADE run outcome `failed`/`exit`/`exited with
  status 2`; Stop on an agent run -> outcome `cancelled`, run state `failed`.
- Migration test beside the existing `migrate_quick_command_collections_test.go` (both apps): rows
  with and without `working_dir` get `fixed`/`home`.
- P236 coverage gate: the five new bound methods per app named in flow tests; `exempt.txt` unchanged.

Playwright UI (mocked bridge, Go-generated fixtures where the shape is Go's):
- `apps/kira-studio/tests/ui/automations.spec.ts` and `apps/kira-space/tests/ui/automations.spec.ts`
  (new): mode label `Automations`; panel header, empty state and menu texts; running row spinner and
  ticking elapsed (Playwright clock); finished run in `Runs` with reason; `Copy for agent` clipboard
  text; Stop calls `scriptRunsStop`; status bar `▶ 1 running`; editor dir radio and legacy notice.
- Update text assertions in the specs listed in 2.1; `terminal-real.spec.ts` (both apps) asserts the
  run footer after a real script exit.

### 4.4 Checks and commits (Part 1)

Per commit: `go build ./...` (+ `-tags server` for Space), golangci-lint, `bun run typecheck`,
`bun run lint`, `bun run lint:dead`. Once at the end: `test:flows:space`, `test:flows:studio`,
`go test ./internal/{runoutcome,scriptruns,quickcommands,terminal}/...`, both apps' UI specs
(automations, terminal-module, mode-switch, modules, ade-v2-run, ade-v2-panel, ade-v2-base-rebase),
both `e2e-real` terminal specs.

Commits: `feat(runoutcome): shared run outcome`; `feat(scriptruns): run store and terminal hooks`;
`feat: automations working directory`; `refactor(space): ADE outcomes via runoutcome`;
`feat(workbench): run status components and runs list`; `feat: rename Terminal module to
Automations`; `test: automation flows and UI specs`; `docs: automations`.

## 5. Part 2 outline (its own plan follows Part 1)

- Go: `internal/claudeheadless` (moved from `adeagent/process.go`, `stream.go`; `adeagent` keeps
  thin aliases so P241's code compiles unchanged; adds `Model`, `MaxBudgetUSD`, `JSONSchema`,
  `StrictMCP`, scrubbed env (memory's list moves here and `internal/memory` imports it), result-event
  parsing); `internal/loginshell` (moved `ResolveShell`, `BuildArgv`, `IsExecutableFile` from
  `gitprepare`, which re-exports); `internal/scriptruns/{smart.go,compose.go,preview.go,engine.go,
  logs.go}` (`Preview`, `Start`, `ReadLog`, `decideSmartOutcome`, queue cap); `quickcommands`
  kind/params/smart validation; ADE context provider interface implemented in
  `apps/kira-space/internal/ade/automation.go` (tasks, branches, vars, worktree, gate); `adeflow`
  `smart_script`/`params` parse + writer; `runs.go` launch for smart steps and the hold predicate;
  `agentnotify.HandleScriptRuns`; `agenttools.go`/`adeagent` `run_outcome` purpose `automation`.
- Migrations: Space `0028`, Studio `0035`: `custom_scripts.kind`, `params_json`, `smart_json`;
  `script_runs.{model, session_id, params_json, prompt}`; `script_run_logs`.
- Frontend: `RunScriptDialog.vue`, `ScriptParamsEditor.vue` (builder: name, label, type, options
  list with add/remove/reorder, default, required, secret), `ScriptParamsForm.vue`, `SmartBadge.vue`,
  `RunLog.vue`, `scriptRun` tab kind (both apps' `tabKinds.ts`, `tabViews.ts`, tab domain), ADE task
  menu / branch menu / panel header entries, `AdeAutomationChip.vue`, task panel `Automations` block,
  Needs you kind, `AdeStepCard.vue` smart-step editor.
- Tests: fake claude shared by both harnesses: `internal/claudeheadless/claudefake` (scenario via
  env: stream lines, a `result` with `structured_output`, exit code, sleep, budget/turn errors,
  record argv/stdin/env/cwd); Space `flowharness.Main` and Studio `flowharness/main.go` dispatch
  argv0 `claude` to it for automation tests (Space ADE tests keep `fakeagent`). Flow cases: done,
  failed with reason, blocked, no report (exit 0, exit 1), timeout, budget, Stop, restart, queue cap,
  ambiguous branch preview (`needs.branch` lists two), task picker, draft branch disabled, gate both
  ways, hash mismatch refusal, injection set (`'; touch pwned #`, `$(touch pwned)`, backticks,
  newline + "ignore previous instructions": no `pwned` file, argv fixed, stdin == preview prompt
  byte for byte, env value exact), secret param absent from DB/log/prompt, select value outside
  options refused, workflow smart step (prompt from script, finish_step, unknown script fails launch),
  `run_outcome` lists a failed automation. UI specs both apps: builder, AI badge, dialog with branch
  popup and multiselect, preview, live running, outcome, Continue in terminal. Real claude: P237
  table row "Automations" `TestSmartScriptRun` (haiku, budget 0.10 USD): one `done` case and one
  `needs_input` case, both apps' engines via the Space realclaude package plus one Studio case.

## 6. Part 3 outline (its own plan follows Part 2)

- Go: `gronx` dependency; `internal/scriptruns/{schedule.go,scheduler.go,clock.go,command.go}`
  (validation, next fires, scheduler loop, missed policy, overlap, headless shell runner);
  bound `ScheduleList`, `ScheduleSave`, `ScheduleDelete`, `ScheduleSetEnabled`,
  `ScheduleNextFires`, `ScheduleRunNow`; notifier rule. Migrations Space `0029`, Studio `0036`:
  `script_schedules`.
- Frontend: schedule section in the editor, `New recurring script`, clock badge, next/last on rows,
  status bar failed dot (Studio).
- Tests: flow tests with the fake clock (`scriptruns.Scheduler.Clock` set through `Wired`): fires at
  the expected instants over a simulated day, timezone `America/New_York` across the DST change
  (skip and dedupe), disable stops fires, overlap skip records `lastSkip`, `allowOverlap` runs two,
  missed `skip` vs `once` across `app.Restart()`, persistence across restart, `Run now`, concurrency
  cap with three due fires, normal script headless log and exit outcome, smart scheduled run with
  fixed params, ADE variable refused, notification on failure only when enabled. UI specs: editor
  next-3 preview, invalid cron message, presets, toggle, rows.

## 7. Overlap and ordering

- **Stream A (P236)**, running in `/home/user/kira-sA`, owns `ade/v2/**`, `flows/**`,
  `flowharness/**`, `tests/e2e-real/**`. P242 edits all of them. P242 starts only after A lands.
- **P240** edits `ade/v2/{plan,panel,board}` files P242 Part 2 edits again (task menu, branch row,
  panel header). Sequential by row order.
- **P241** is the base: P242 Part 1 edits P241's `AdeRunOutcome`, `runs.go` outcome paths,
  `recover.go`, `AdeRebaseOutcome.vue`; Part 2 extends `run_outcome` and the launch gate. P242 runs
  after P241 is implemented and committed. Migration numbers assume P241 took Space `0026`.
- P238/P239 landed; P242 Part 2 edits `agentnotify` (P238's) and P237's DEV_ENVIRONMENT table.
- No parallel streams inside P242: every part touches the shared run store and both apps' wiring.

## 8. Orchestrator verification checklist (Part 1; Parts 2-3 get their own)

- [ ] Rename: `rg -n "label: 'Automations'" apps/*/frontend/src/workbench/modes.ts` hits both;
      `rg -n "[Qq]uick command" packages apps/*/frontend/src` is empty; `rg -n "'terminal'" apps/*/frontend/src/workbench/modes.ts` still hits (key kept).
- [ ] Shared outcome: `rg -n "runoutcome\." apps/kira-space/internal/ade apps/kira-space/internal/storage/model internal/scriptruns`
      shows real callers (`ForProcess` in `runs.go` script and agent paths, `scriptruns` exit hook).
- [ ] Terminal-tab runs recorded: `rg -n "ScriptRuns" internal/terminal/bound.go apps/*/internal/appwire` shows the hook set in both apps.
- [ ] Never `$HOME` by default: `rg -n "DefaultCwd\(" packages/workbench/src/terminal/TerminalPanel.vue` empty;
      flow test 5 asserts the `automations/<id>` cwd.
- [ ] Migrations: both new files contain `dir_mode` and `CREATE TABLE script_runs`.
- [ ] Bound methods covered: P236 gate green in both `test:flows:*`; `exempt.txt` unchanged.
- [ ] Frontend rules: new `.vue` files `<script setup lang="ts">`, no `<style>`; no new Pinia store;
      `package.json`/`pnpm-lock.yaml` unchanged in Part 1; `go.mod` unchanged in Part 1.
- [ ] Counts: Part 1 flow cases 6 per app + 2 ADE + 2 migration; UI specs both apps green.
- [ ] Hooks green on every commit, no `--no-verify`; SPEC P242 Part 1 `Done` with result.
- [ ] Codegraph: Parts 2 and 3 planners show real `codegraph_explore` calls; the Part 1 implementer
      executes a named plan (no call required).

## 9. Open questions for the user

1. Memory imports and the memory gate also run headless Claude. Plan keeps their own job status
   (progress plus classified error) and does not list them in Automations runs. Include them?
2. Smart script prompt in the run dialog is read-only (the script is edited in its editor). ADE
   dialogs allow editing the prompt before sending. Allow a one-off edit here too?
3. Params for **normal** scripts reach the command as env only (`$KIRA_PARAM_X`), never substituted
   into the command text. OK, or substitute with shell quoting like ADE script stages?
4. Default model `sonnet`, budget 1 USD, timeout 15 m, tools read-only, user's MCP servers off.
   Change any default?
5. Studio has no OS notifications: a failed recurring script shows a status-bar dot. Add native
   notifications to Studio as a later phase?
6. Missed recurring runs default to `skip`. OK?
