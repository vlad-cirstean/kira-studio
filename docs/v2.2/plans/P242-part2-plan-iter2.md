# P242 Part 2 plan, iter2: smart scripts

SPEC row P242 Part 2. Design baseline: `P242-plan.md` (iter1) sections 2.3, 2.4, 2.6, 2.8 and 5. This
file replaces iter1's Part 2 outline, planned against the tree at `f82ec5b2a` (v2.0 after P242 Part 1,
P240, P241, P243 Part 1). Where this file and iter1 differ, this file wins.

Discovery: `codegraph_explore` over `internal/scripts` (`CustomScript`, `CustomScriptFields.Validate`,
`Repo`, `Service`), `internal/memory/claude.go` (`scrubbedEnv`, `claudeArgs`), the Automations
frontend (`AutomationsModuleContext`, `ScriptRunsSeam`, `AutomationsPanel`, `ScriptDialog`,
`useRunScript`, `openTerminalTab`), run surfaces (`runOutcomeSchema`, `scriptRunSchema`,
`RunOutcomeBlock`, `RunStatusBadge`, `VarText`, `TextPart`, `copyOrReportError`) and tab kinds
(`TabKindDef`, `terminalTabKind`, `createTabsStore.openTab`, `RenderableTabKinds`). `apps/kira-space/**`
is not indexed; read directly: `internal/adeagent/{process,stream,mcp,space,outcomes,suffix,doc}.go`,
`internal/ade/{runs,vars,steps,launches,rebase,agenttools}.go` (launch, gate, `RunOutcomes`),
`internal/adeflow/parse.go`, `internal/agentnotify/agentnotify.go`, `internal/gitprepare/script.go`,
`internal/flowharness/{main.go,fakeagent/fakeagent.go}`, `internal/appwire` (scriptruns wiring),
migrations `0026`/`0027`, frontend `ade/v2/{board/taskMenu.ts,panel/AdeRunLog.vue,workflows/*}`. Also
`internal/{runoutcome,scriptruns,terminal/bound.go}` and `claude --help` (CLI 2.1.295) for flags.

## 0. User requirements and decisions

- R1 Smart script = a script run on demand as headless Claude (`claude -p`).
- R2 It receives the params a workflow receives (task, jira, repo, branch, base, worktree) plus custom
  params: free text, or select / multi-select over predefined options. Params reach the run as env
  vars and are interpolated into the prompt.
- R3 Invocable from Automations (both apps), manually from an ADE task or branch (Space), and as a
  workflow step (Space). Studio has no ADE variables, tasks, branches or workflows.
- R4 Several candidates for a param (2 branches, 2 repos) ask through a picker.
- R5 Configured in the Automations module.
- R6 Small visible AI indicator on smart scripts.
- R7 While it runs it shows it is executing; at the end success or failure with the reason, through
  the shared `runoutcome` like every other run.
- R8 Interpolated values preview as resolved text, visibly marked as variables (`VarText`).
- R9 ADE worktree toggle (moved from Part 1): from an ADE task or workflow, run in the ADE worktree or
  in the script's own folder; default folder stays `<app home>/automations/<id>`, never `$HOME`.

Decisions by the user (binding):

- D1 Defaults: model `sonnet`, budget 1 USD, timeout 15 min.
- D2 The run dialog allows a one-off prompt edit, never saved.
- D3 Tools are an explicit allowlist. Checklist of built-ins: Read, Grep, Glob, Edit, Write,
  NotebookEdit, Bash (Bash with optional patterns, e.g. `Bash(git status:*)`). Default Read, Grep,
  Glob, labelled **Default tools**; the words "read-only" never appear.
- D4 User MCP servers off by default. Enabling a server lists its tools as checkboxes, each off until
  ticked.
- D5 The run dialog shows the exact `--allowedTools` list used. `finish_step` and (with a task) the
  Space tools are always added.
- D6 Missed cron runs are Part 3 (recurring), not here.
- D7 shadcn-vue, Tailwind, VueUse, Pinia, TanStack. Bound-method coverage gate stays at 0
  exemptions. Flow tests per P236, e2e-real, real-claude test for a smart script (haiku, cents).

Planner decisions (each with its reason):

- P1 **One report channel: `finish_step` in both apps.** D5 puts `finish_step` in every run. Studio
  gets the same loopback MCP server Space uses (moved to a shared package, 3.1). No `--json-schema`.
  The fake claude (`fakeagent`) already reports through `finish_step`, so both apps' flow tests use
  one fake.
- P2 **Exact allowlist means isolated settings.** `--setting-sources ""` on every smart run: a user
  settings file's `permissions.allow` would otherwise approve tools the dialog never listed. Plus
  `--tools <ticked built-ins>` (an unticked built-in does not exist for the run), `--allowedTools`
  (D5 list), `--strict-mcp-config`, `--permission-prompts none` (anything unlisted is denied, never
  prompted). Same isolation `internal/memory` already ships. The preview says "Your Claude settings
  files are not loaded."
- P3 **No `queued` state.** `script_runs.state` CHECK has no `queued`; adding it is a table rebuild.
  At most 3 headless smart runs per app run at once; a 4th is refused (`3 smart scripts are running:
  wait for one to finish`), shown as a Preview blocker before Run is pressed.
- P4 **Needs you entry for automations dropped.** Not asked; the task card chip, task panel block,
  run tab, runs list and OS notification cover R7. Iter1 had it; named here so it is not silently
  lost (section 10, item 2).
- P5 **Server name stays `kira-ade`** in both apps (tool `mcp__kira-ade__finish_step`): renaming it
  changes prompts, fakes and tests of shipped ADE runs for a label. Section 10, item 3.
- P6 **Workflow smart step references the script by name** (`smart_script: <name>`); a name shared
  by two scripts fails the launch with a clear reason. YAML stays readable; ids are UUIDs.
- P7 **Normal scripts get params too** (env only, `$KIRA_PARAM_X`, never substituted into the
  command text; iter1 question 3). A normal script with params, or one started from ADE, opens the
  run dialog, then a terminal tab.

## 1. Current tree (verified)

- `internal/scripts`: `CustomScript{ID, Name, Command, WorkingDir, DirMode, Color, CollectionID,
  SortOrder, CreatedAt, UpdatedAt}`; `CustomScriptFields.Validate` (trims, `scripts:` prefixed
  user-facing errors); `ResolveDir`, `PrepareDir`, `RemoveDir`; shared `Repo` with one
  `selectColumns` string (so both apps' `custom_scripts` must keep identical columns).
- `internal/scriptruns`: `Run{ID, ScriptID, ScriptName, Color, Kind ("script"), Trigger, State,
  TerminalID, Cwd, Command, Outcome, CreatedAt, StartedAt, FinishedAt}`; `Service` is the
  `terminal.ScriptLauncher` (`Begin(scriptID, terminalID)`, `Failed`, `Exited`), `List`, `Get`,
  `Stop` (closes the PTY), `ResolveDir`, `Recover`, purge keeps 500 finished. `Bound` is embedded by
  each app's `bridge.ScriptRunsService`, so a new `Bound` method is a new bound method in both apps.
- `script_runs` (Space `0026`, Studio `0034`): `kind` no CHECK, `trigger_kind` CHECK `terminal|manual|
  ade|scheduled`, `state` CHECK `running|done|failed|cancelled|blocked`. No task/branch columns.
- `internal/runoutcome.Outcome{Status, Reason, Source, Reported, ExitCode, LastError, Summary}`,
  sources `agent|exit|timeout|start|user|restart|verify`; `ForProcess` is the wording table.
- Headless Claude lives in Space only: `apps/kira-space/internal/adeagent` (`Spec`, `Run`, `Script`
  argv via login shell `exec claude -p --output-format stream-json --verbose --session-id ...
  --mcp-config ... --setting-sources ... --allowedTools ...`, prompt on stdin, process group stop;
  `parseLine` maps stream-json to log lines and ignores the `result` event's cost/denials; loopback
  MCP `Server` with per-run bearer token and 0600 config file, tools `finish_step`, Space tools,
  `run_outcome` (kinds `rebase|step`)). It imports `gitprepare` (shell) and `procgroup` only. 15 Space
  files import it. Studio cannot import `apps/kira-space/internal/**` (Go internal rule).
- `gitprepare.{ResolveShell, BuildArgv, IsExecutableFile, DefaultShell}`: 5 non-test callers
  (`adeagent/process.go`, `ade/{runs,setup,deploy}.go`, `gitsession/worktree.go`).
- `internal/memory/claude.go`: `inheritedSessionEnv` + `scrubbedEnv` (Claude session vars), the
  isolation flags of P2.
- Fake claude: `apps/kira-space/internal/flowharness/fakeagent` (+ `cmd/fakeclaude` for e2e-real),
  scenario `KIRA_FAKE_SCEN`, records `.args/.cwd/.prompt` in `KIRA_FAKE_DIR`; Space harness symlinks
  the test binary as `claude` in `BinDir` and dispatches on argv0. Studio harness has no fake claude.
- ADE launch hold: `TaskBoard.launch` holds a step run with note `waiting for rebase` while
  `RunningRebaseOn(branch)`; `releaseRebaseGate` -> `launchHeldLocked(sb)`. `launchGateOf` creates a
  missing worktree and waits for setup.
- Agent stage steps: `adewire.PipelineStep{ID, Name, RunsOn, Before, OnFailure, Timeout, Prompt,
  AllowedTools}`; `adeflow` validator lists allowed keys per step.
- Notifier (Space only): `agentnotify.Notifier.HandleRuns(adewire.Run)`; Studio has no OS
  notifications.
- Frontend: `AutomationsModuleContext{defaultCwd, openTerminalTab, host, scripts, runs,
  showAutomations, chooseFolder}`, `ScriptRunsSeam{list, stop, resolveDir, onChanged}`; `runs/`
  components and `runsQueries.ts` (TanStack, key `['scriptRuns','list']`); `ScriptDialog.vue`
  (`VarText` folder preview); `TerminalLaunch.scriptId`; tab kinds via `TabKindDef` (badge hook),
  Go `RenderableTabKinds` in both apps' `storage/model/tabs.go` with a parity spec. shadcn-vue
  primitives present: checkbox, command, popover, radio-group, switch, native-select, textarea,
  toggle-group, dialog, field, badge.
- Migrations: Space high-water `0027_p241_rebase.sql`, Studio `0034_p242_automations.sql`.
- Coverage gate: `apps/*/internal/flows/coverage/exempt.txt` both empty.

## 2. Split proposal (Part numbering only)

Iter1 sized Part 2 as one pass. Against the current tree it is two order-dependent pieces of about
Part 1's size each: the engine and its Automations surfaces (both apps), then the ADE integration
(Space engine, workflows, ADE frontend). Proposal:

- **P242 Part 2: Smart scripts.** Sections 3.1-3.8 below: shared headless engine, script kind,
  params, tool allowlist and MCP, preview, run, logs, run tab, editor, run dialog, normal scripts
  with params; Automations entry in both apps (Space without a task context).
- **P242 Part 3: Scripts in ADE.** Section 3.9: ADE variables and task/branch picker, task and
  branch entries, worktree toggle (R9), normal scripts from ADE, gate both ways, workflow smart
  step, `run_outcome` kind `automation`, task chip and panel block, notification.
- **P242 Part 4: Recurring scripts** (today's Part 3, renamed; text unchanged).

SPEC edits if accepted (orchestrator; this plan commits only itself): rename row "P242 Part 2" text
to Part 2 above, insert "P242 Part 3" row, rename "P242 Part 3" to "P242 Part 4", and update every
"P242 Part 3" cross-reference (rows P243 Part 1 and P246 prose, SPEC user-words line 92) to
"P242 Part 4". Part 3 gets its own iter plan after Part 2 lands, using 3.9 as baseline. If the split
is declined: one implementer does 3.1-3.8, commits, then 3.9, in that order (no parallel streams:
3.9 builds on 3.1-3.8's types and generated bindings).

## 3. Design

### 3.1 Shared moves (no behaviour change, first commits)

| From | To | Note |
|---|---|---|
| `apps/kira-space/internal/adeagent/**` (incl. tests, `testdata`) | `internal/claudeheadless/**`, package `claudeheadless` | `git mv`; 15 importers sed `adeagent.` -> `claudeheadless.`; doc comment: headless Claude runs and the run-report MCP server, for ADE steps and smart scripts |
| `gitprepare.{ResolveShell, BuildArgv, IsExecutableFile, DefaultShell}` + their tests | `internal/loginshell` | callers updated; `gitprepare.BuildEnv` and `scrubbedEnvKeys` stay |
| `memory.inheritedSessionEnv`, `scrubbedEnv` | `claudeheadless.ScrubSessionEnv(environ []string) []string` | `internal/memory/claude.go` calls it; its test moves along |
| `apps/kira-space/internal/flowharness/fakeagent/**` (incl. `cmd/fakeclaude`) | `internal/flowtest/fakeagent/**` | Space `flowharness/main.go`, `tests/e2e-real/fixtures.ts` build path updated |

`go build ./...`, both `test:flows:*` and `go test ./internal/claudeheadless/... ./internal/loginshell/...`
green before any feature commit.

### 3.2 Headless engine additions (`internal/claudeheadless`)

`Spec` gains (zero values keep today's ADE argv byte for byte):

```go
Model          string   // --model, "" = omitted
MaxBudgetUSD   float64  // --max-budget-usd, 0 = omitted
Tools          []string // --tools <comma list>; nil = omitted (ADE), empty = ""
Isolated       bool     // --setting-sources "" --strict-mcp-config --permission-prompts none
MCPConfigPaths []string // extra --mcp-config files after the Kira one (user servers)
```

`Isolated` overrides `SettingSources`. `Handler.OnResult func(Result)`; `Result{Subtype string,
IsError bool, CostUSD *float64, Denials []string, Text string}` parsed from the `result` line
(`total_cost_usd`, `permission_denials[].tool_name`, `result` bounded 1 KiB). The existing log line
for `result` stays.

`NewServer` takes `Options{Dir, OnFinish, Space SpaceTools, Outcomes Outcomes}` (struct, not four
positional args; Space's one caller updated). A run grant without a task gets `finish_step` only.

`usermcp.go` (new, read-only on the user's files; P233 holds):

- `UserServers(env func(string) string) ([]UserServer, error)`: reads `$CLAUDE_CONFIG_DIR/.claude.json`
  if `CLAUDE_CONFIG_DIR` is set, else `$HOME/.claude.json`; top-level `mcpServers` only (user scope;
  project and local scopes depend on a cwd and are out of scope, stated in the editor). Returns
  `{Name, Transport stdio|http|sse, Target}`: command basename or URL host, never env, args or
  headers. Raw JSON kept server-side only.
- `ListTools(ctx, name)`: go-sdk client (`mcp.CommandTransport` with the server's command, args and
  env over `os.Environ()`, cwd the app home; `StreamableClientTransport` / `SSEClientTransport` with
  its headers), 15 s timeout, at most 200 tools. Error text: `could not list tools of <name>: <err>`.
- `WriteUserConfig(dir, runID string, names []string) (path string, release func(), err error)`:
  copies those servers' raw objects from the user's file at start time into a 0600 file (dir 0700),
  removed by `release`. A ticked server missing from the user's file is a blocker:
  `MCP server <name> is no longer in your Claude config`.

`ScriptReportSuffix` (new, in `suffix.go`): `When you are finished, call the finish_step tool with
status "done" and a one-line summary. If you could not finish, call it with status "failed" and give
the reason. If you need a decision, call it with status "needs_input" and your question.`

### 3.3 Script model (`internal/scripts`, `packages/shared/domain/scripts.ts`)

```go
const (KindScript = "script"; KindSmart = "smart")
type Param struct {
    Name     string   `json:"name"`     // ^[a-z][a-z0-9_]{0,31}$, not a built-in variable name
    Label    string   `json:"label"`    // "" shows Name
    Type     string   `json:"type"`     // text | select | multiselect
    Options  []string `json:"options"`  // select/multiselect: 1..50, unique, 1..200 chars, no newline
    Default  []string `json:"default"`  // text: 0..1; select: 0..1 option; multiselect: subset
    Required bool     `json:"required"`
    Secret   bool     `json:"secret"`   // text only: env only, never in the prompt, never stored with a run
}
type MCPChoice struct { Server string `json:"server"`; Tools []string `json:"tools"` }
type Smart struct {
    Model        string      `json:"model"`        // haiku | sonnet | opus; default sonnet
    MaxBudgetUSD float64     `json:"maxBudgetUsd"` // 0.05..25; default 1
    Timeout      string      `json:"timeout"`      // Go duration 1m..2h; default 15m
    Tools        []string    `json:"tools"`        // subset of BuiltinTools; default Read, Grep, Glob
    BashPatterns []string    `json:"bashPatterns"` // only with Bash; 0..30, 1..200 chars, no ")" or newline
    MCP          []MCPChoice `json:"mcp"`          // 0..10 servers, 0..100 tools each, names ^[A-Za-z0-9_.-]{1,64}$
}
// CustomScript and CustomScriptFields gain Kind, Params []Param, Smart *Smart.
var BuiltinTools = []string{"Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash"}
var DefaultTools = []string{"Read", "Grep", "Glob"}
var BuiltinVars = []string{"task", "jira", "repo", "branch", "base", "worktree"} // reserved in both apps
```

Validation (`Validate`, user-facing, `scripts:` prefix): `kind` script|smart; smart needs `Smart`
(missing fields filled with D1 defaults), a script needs `Smart == nil`; `command` holds the prompt
for a smart script (max 20000 chars); params unique, max 20; `{secret}` used in a smart prompt ->
`scripts: secret param <name> cannot be used in the prompt`; a `{name}` of an unknown variable is not
an error (literal braces stay, code samples survive); unknown tool, pattern with `)`, MCP choice with
no tools (`scripts: tick at least one tool of <server> or turn it off`).

`smart.go` (pure, shared by `scriptruns` and Part 3's ADE launch):

- `VarsUsed(text, params)`: names in `{...}` that are built-ins or params, first-seen order.
- `Compose(text string, vals map[string]string) []Part` with `Part{Text, Var, Value string}`: one
  pass, known names only (ADE's `substitute` rule). `PlainText(parts)`.
- `ParamValues(params, given map[string][]string) (vals, env, missing, err)`: select/multiselect
  values must be options (`value "x" is not an option of <name>`); text max 2000 chars, no NUL or
  control characters except `\n` `\t`; defaults fill blanks; required and empty -> missing. Prompt
  rendering: text as is, select the option, multiselect `a, b, c`. Env: `KIRA_PARAM_<UPPER>`
  (multiselect newline-joined); built-ins `KIRA_TASK`, `KIRA_JIRA`, `KIRA_REPO`, `KIRA_BRANCH`,
  `KIRA_BASE`, `KIRA_WORKTREE` (Part 3).
- `ToolArgs(s Smart, extra []string) (tools, allowed []string)`: `tools` = ticked built-ins;
  `allowed` = ticked built-ins with Bash replaced by `Bash(<p>)` per pattern when patterns exist,
  then `mcp__<server>__<tool>` per ticked tool, then `extra` (finish_step, run_outcome, Space tools),
  deduped, stable order.

### 3.4 Storage (Part 2 migrations, identical bodies)

Space `0028_p242_smart_scripts.sql`, Studio `0035_p242_smart_scripts.sql` (renumber to the next free
number at implementation time):

```sql
ALTER TABLE custom_scripts ADD COLUMN kind TEXT NOT NULL DEFAULT 'script' CHECK (kind IN ('script', 'smart'));
ALTER TABLE custom_scripts ADD COLUMN params_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE custom_scripts ADD COLUMN smart_json TEXT NOT NULL DEFAULT '';
ALTER TABLE script_runs ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE script_runs ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE script_runs ADD COLUMN prompt TEXT NOT NULL DEFAULT '';        -- exact prompt sent; never a secret
ALTER TABLE script_runs ADD COLUMN params_json TEXT NOT NULL DEFAULT '[]'; -- [{name, value}], secrets as "••••"
ALTER TABLE script_runs ADD COLUMN tools_json TEXT NOT NULL DEFAULT '{}';  -- {tools, allowedTools, mcpServers}
CREATE TABLE script_run_logs (
  run_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr', 'event')),
  text   TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
```

`script_runs.kind` gets `smart` (no CHECK on it). `trigger_kind` `manual` for a dialog start. Purge
deletes logs of purged runs. `docs/ARCHITECTURE.md` high-water marks updated.

### 3.5 Preview and start (`internal/scriptruns`)

```go
type RunArgs struct {
    ScriptID string              `json:"scriptId"`
    Params   map[string][]string `json:"params"`
    Prompt   *string             `json:"prompt"`  // D2: one-off body for this run; nil = the saved body
    // Part 3 adds TaskID, BranchID, Entry.
}
type Preview struct {
    Kind     string        `json:"kind"`
    Missing  []string      `json:"missing"`  // required params without value
    Blocker  string        `json:"blocker"`  // folder, cap, MCP server gone; Run disabled
    Dir      scripts.Dir   `json:"dir"`
    Body     string        `json:"body"`     // the saved prompt template (dialog edit starts from it)
    Prompt   []scripts.Part `json:"prompt"`  // resolved body as parts
    Suffix   string        `json:"suffix"`   // ScriptReportSuffix, shown read-only
    Env      []EnvVar      `json:"env"`      // {name, value, secret, fromVar}; secret value ""
    Command  string        `json:"command"`  // normal script
    Model    string        `json:"model"`; MaxBudgetUSD float64 `json:"maxBudgetUsd"`; Timeout string `json:"timeout"`
    Tools    []string      `json:"tools"`        // --tools
    Allowed  []string      `json:"allowedTools"` // --allowedTools, exact (D5)
    MCP      []string      `json:"mcpServers"`
    Hash     string        `json:"hash"`
}
type StartArgs struct { RunArgs; Hash string `json:"hash"` }
type Started struct {
    RunID    string          `json:"runId"`    // smart: the run; normal: ""
    Terminal *TerminalStart  `json:"terminal"` // normal script: open a terminal tab with this
}
type TerminalStart struct { Token, Cwd string }
```

- `Preview(args)`: loads the script; `ResolveDir` (no side effect); `ParamValues`; composes prompt
  (smart) or env (both); `ToolArgs` with extra `mcp__kira-ade__finish_step`; cap check (smart);
  MCP servers still present (smart). `Hash` = sha256 of canonical JSON over kind, cwd, resolved
  prompt text + suffix, model, budget, timeout, tools, allowed, MCP names, command, env names and
  non-secret values.
- `Start(args)`: recomposes; hash differs -> `E_CONFLICT` `the script changed since the preview:
  check it again`; blocker or missing -> `E_INVALID` with that text.
  - Smart: insert `running` run (trigger `manual`, kind `smart`, model, session id, prompt, params
    display, tools JSON); `PrepareDir`; register a run grant on the scriptruns' own
    `claudeheadless.Server` (dir `<app home>/automations-mcp`, 0700); `WriteUserConfig`; spawn
    `claudeheadless.Run` in a goroutine with `Spec{Dir, Prompt (text + "\n\n" + suffix), SessionID,
    MCPConfigPath, MCPConfigPaths, Model, MaxBudgetUSD, Tools, AllowedTools, Isolated: true,
    Timeout, Env}`. Env = `ScrubSessionEnv(os.Environ())` + `loginshell` git scrub + `KIRA_*`.
  - Normal: no run yet. Store a launch `{scriptID, cwd, env, created}` under a random token (32
    bytes, base64url), single use, expires after 60 s; return `{Token, Cwd}`. The frontend opens the
    terminal tab with `scriptId` + `launchToken`; `terminal.Open` passes the token to
    `ScriptLauncher.Begin(scriptID, terminalID, token)`, which consumes it (env and cwd from the
    launch; a missing, used or expired token -> `E_INVALID` `this run expired: start it again`). No
    token keeps Part 1's path (no params, no env).
- Injection rules (pinned by flow tests): claude argv fixed and quoted (`Script`); values reach the
  run only through stdin (the previewed prompt) and env; a normal command is never rewritten.
- Engine end: `decide(finish *Finish, res *Result, exit, runErr, stopped, timeout)`:

| Case (first match) | Status | Source | Reason |
|---|---|---|---|
| stopped from the UI | cancelled | user | `stopped by you` |
| app quit while running | failed | restart | `Kira <App> quit while it ran` |
| `finish_step` done | done | agent | `` (Summary set) |
| `finish_step` needs_input | blocked | agent | reason or summary |
| `finish_step` failed | failed | agent | reason, summary, or `the agent reported failure without a reason` |
| result `error_max_budget_usd` | failed | budget (new) | `stopped at the budget of <x> USD` |
| result `error_max_turns` | failed | agent | `stopped at the turn limit` |
| result `is_error` other | failed | agent | bounded result text |
| no report | `ForProcess` agent rows (exit, timeout, start) |

  Every row sets `CostUSD` and `PermissionDenials` (tool names, max 50) when the result had them, and
  `LastError` from the last stderr line. Not done with denials -> reason gains ` (denied: Bash,
  Write)`. Run state = outcome status. Grant and user MCP file released, emit, purge.
- `runoutcome.Outcome` gains `CostUSD *float64 json:"costUsd,omitempty"`, `PermissionDenials
  []string json:"permissionDenials,omitempty"`, `SourceBudget`; TS mirror updated.
- Stop (smart): cancels the run's context (`procgroup` SIGTERM, SIGKILL after 2 s). `Service.Close()`
  (app teardown, both appwires): cancels every smart run and records the quit row before returning.
  `Recover` already fails rows left `running`.
- Logs: `logs.go` batched sink (250 ms, ADE `logSink` shape), line max 2 KiB, 5000 lines per run
  then oldest dropped (`truncated`). Push `kira:scriptRunLog:appended` `{runId, chunks}`.
  `ReadLog(id, afterSeq)` -> `{chunks, truncated}`.
- Concurrency: cap counter under the service mutex, checked in Preview and again in Start.

Bound (`scriptruns.Bound`, so both apps): `Preview`, `Start`, `ReadLog`, `McpServers`, `McpTools`
(5 new per app). Each app: `ChannelScriptRunLog` in `bridge/scriptruns.go`; appwire builds the
server, passes `ClaudeBin` (harness sets it) and calls `Close` in teardown. Bindings regenerated with
`wails3 task common:generate:bindings`; never hand-edited.

### 3.6 Frontend: editor (`packages/workbench/src/automations/`)

- Panel `+` menu: `New script`, `New smart script`. Row: `SmartBadge.vue` (codicon `sparkle`,
  `data-testid="script-ai-badge"`, tooltip `Smart script: runs Claude headless`) before the name.
  Row click: normal script without params -> terminal tab (today); otherwise the run dialog.
- `ScriptDialog.vue` gains `kind`; for smart: title `New smart script` / `Edit smart script`, field
  `Prompt` (`Textarea`), `Uses: task, branch, env` line from `VarsUsed` (chips via `VarText`), and
  the sections below as child components (each `<script setup lang="ts">`, Tailwind only):
  - `smart/SmartSettingsFields.vue`: model `NativeSelect`, budget `Input type=number`, timeout
    `Input` (`15m`), D1 defaults.
  - `smart/ToolsField.vue`: `FieldSet` legend `Tools`, one `Checkbox` per built-in, a `Default
    tools` button that resets to Read/Grep/Glob, under Bash an `InputGroup` list of patterns
    (`git status:*`) shown only when Bash is ticked; the resulting `--allowedTools` line previewed
    live (`font-data`).
  - `smart/McpToolsField.vue`: `McpServers` (TanStack query `['scriptRuns','mcp']`); one `Switch`
    per server, off; on -> `McpTools` (query `['scriptRuns','mcp',name]`, only while on) listing one
    `Checkbox` per tool, all off; error -> `Alert` plus `Add tool by name` input. Note: `Only
    servers from your user Claude config are listed.`
  - `ParamsEditor.vue` (both kinds): list of params; each row name, label, type `NativeSelect`,
    options list (add, remove, reorder with buttons), default, `Required`/`Secret` `Checkbox`
    (Secret only for text). Normal script shows `Params reach the command as $KIRA_PARAM_<NAME>`.
- Shared TS: `scripts.ts` schemas for `Param`, `Smart`, `MCPChoice`, kind, `BUILTIN_TOOLS`,
  `DEFAULT_TOOLS`; `scriptRuns.ts` adds `kind: z.enum(['script','smart'])`, model, sessionId,
  prompt, params, tools; `runOutcome.ts` adds `costUsd`, `permissionDenials`, source `budget`.

### 3.7 Frontend: run dialog, run tab, runs

- `run/runDialog.ts`: Pinia store `scriptRunDialog` (one concern: the open dialog request
  `{scriptId, prefill?}`), `open`, `close`. `run/RunScriptDialogHost.vue` mounted once in each app's
  `WorkbenchShell.vue`, so any module can open it (Part 3's ADE entries).
- `run/RunScriptDialog.vue` (shadcn `Dialog`; `SmartBadge` in the title for smart):
  1. `ParamsForm.vue`: text `Input` (secret: `type=password`), select `NativeSelect`, multiselect
     `Popover` + `Command` with check items. Defaults prefilled, required marked.
  2. Prompt (smart): read-only `VarText` of `Preview.prompt` (chips for each substituted value) and
     the suffix under a `Added by Kira` label; `Edit for this run` toggles a `Textarea` with
     `Preview.body`; `Reset` returns to the saved body; a note `Not saved to the script`.
  3. Preview block: folder (`VarText`, source label), model, budget, timeout, `--tools ...` and
     `--allowedTools ...` exactly as `Preview` returns them (`font-data`, `data-testid=
     "run-allowed-tools"`), MCP servers, env list (`KIRA_PARAM_X=` + chip, secret `••••`),
     `Your Claude settings files are not loaded.`; normal script: command and env.
  4. `Run` disabled while `missing`/`blocker` non-empty or the query is fetching; `Cancel`.
  Args are debounced (`refDebounced`, 250 ms) into a TanStack query `['scriptRuns','preview',args]`
  with `placeholderData: keepPreviousData`. `Start` is a mutation; smart -> open the run tab;
  normal -> `openTerminalTab({cwd, launch: {..., scriptId, launchToken}})`.
- `TerminalLaunch.launchToken?`, `terminalTabStateSchema.launchToken` (`.default('')`, never
  persisted: terminal tabs are not persisted), `terminal.OpenArgs.ScriptLaunchToken` (only with
  `ScriptID`; `ValidateOpen` refuses it otherwise; max 64 chars).
- Run tab: new tab kind `script-run` (state `{runId}`), workspace `automations`, both apps:
  `state/tabDomain.ts`, `state/tabKinds.ts` (`tabs/scriptRunTabKind.ts` factory: title = script
  name, icon `sparkle`, badge from the run state), `workbench/tabViews.ts`, Go `RenderableTabKinds`
  (both apps), parity spec. View `runs/ScriptRunView.vue`: header (name, `SmartBadge`,
  `RunStatusBadge`, `RunElapsed`, Stop), `RunOutcomeBlock` once ended, `RunLog.vue` (first page by
  `ReadLog`, then pushed chunks into the TanStack cache `['scriptRuns','log',id]`, follows the end
  unless scrolled up via VueUse `useScroll`, as `AdeRunLog.vue`), prompt sent (collapsed), `Continue
  in terminal` when blocked or failed with a session id: terminal tab, launch kind `claude-code`,
  command `claude --resume '<sessionId>'`, cwd the run's cwd.
- `RunOutcomeBlock.vue`: cost (`Cost 0.12 USD`), denials line, summary; `Run again` reopens the
  dialog prefilled with the run's non-secret params. `runText.ts` copy text adds model, cost,
  denials and the summary.
- `RunsSection.vue` rows: `SmartBadge` for kind smart; click on a smart run opens its tab.
- `ScriptRunsSeam` gains `preview`, `start`, `readLog`, `onLog`, `mcpServers`, `mcpTools`; both apps'
  `bridge/index.ts` and `workbench/automationsModule.ts` wire them.

### 3.8 Studio and Space without a task

Identical code paths. Built-in variable names are reserved but unresolved (literal), no task fields,
`finish_step` only. Space Automations entry without a task: the same; Part 3 adds the task picker.

### 3.9 ADE integration (Part 3 if the split is accepted)

- Seam `scriptruns.ADE` (nil in Studio), implemented by `apps/kira-space/internal/ade/automation.go`
  on `TaskBoard`:

```go
type ADE interface {
    Tasks() ([]TaskChoice, error)                       // live tasks {id, title}
    Context(taskID, branchID string) (ADEContext, error) // vars, branches, chosen branch
    Worktree(ctx context.Context, branchID string) (string, error) // launchGateOf
    Busy(branchID string) string                        // "" or why: "a run is working on it"
    Tools() (space claudeheadless.SpaceTools, outcomes claudeheadless.Outcomes)
}
```

- `RunArgs` gains `TaskID`, `BranchID`, `Entry` (`automations|ade`); `Preview` gains `Needs{Tasks
  []TaskChoice, Branches []BranchChoice{id, label "repo · branch", disabled, why}}`. Task needed:
  Space Automations entry and the script uses an ADE variable. Branch needed: a branch-bound
  variable (`repo branch base worktree`) is used, or the worktree folder applies, and the task has
  more than one mine branch; one branch is chosen silently; drafts `not created yet`; a branch with
  a running/pending ADE run `a run is working on it`. Nothing remembered between dialogs.
- Folder (R9): `custom_scripts.use_ade_dir` (default 1), editor `Switch` `Run in the task's worktree
  when started from ADE` (Space only, context flag `ade: true`). From ADE with it on: the branch
  worktree via `Worktree` at Start (`launchGateOf`: creates it, waits for setup; blocker text
  passed through); preview shows `worktree of <branch>`. Off: the script's own folder.
- Grant with a task: `Space: true` always (D5) plus `run_outcome`; prompt gets `SpaceSuffix`;
  allowed list adds `SpaceToolNames` and `RunOutcomeTool`.
- Normal scripts from ADE: dialog, token start, env `KIRA_*`, cwd per R9, run trigger `ade`.
- Gate both ways: Preview/Start blocker while `Busy(branch)`; `TaskBoard.launch` holds a step run
  with note `waiting for automation <name>` while a smart run is `running` in that branch's
  worktree (dep `AutomationOn(branchID) string`), released by `TaskBoard.ReleaseAutomation(branchID)`
  (same as `releaseRebaseGate` -> `launchHeldLocked`) from the run's end hook; rebase plan blocker
  `an automation is running in this worktree`.
- Workflow step: `adeflow` agent-step keys `smart_script: <name>` and `params: {name: value |
  [values]}`; `prompt` and `allowed_tools` refused beside `smart_script` (`prompt is not allowed with
  smart_script`); `writer.go` writes them; `adewire.PipelineStep.{SmartScript, Params}`; `stepDef`
  same. Launch (`startRun`, agent stage): look up by name among smart scripts (none or two ->
  `could not start: smart script "x": not found | 2 scripts have that name`); params via
  `ParamValues` (missing or invalid -> `could not start: smart script "x": <why>`); prompt = body
  composed with the run's vars + `FinishStepSuffix`; model, budget, tools, MCP from the script with
  `Isolated: true`; allowed = `ToolArgs(extra: finish_step, run_outcome, Space tools when enabled)`;
  timeout = step `timeout` if set, else the script's; cwd = worktree unless `use_ade_dir` is off.
  `AdeStepCard.vue`: `Prompt | Smart script` `ToggleGroup`, script `NativeSelect` (label with AI
  mark), `ParamsForm`; step cards and run views show `SmartBadge` on such steps.
- `run_outcome` kind `automation` (`OutcomeQuery.Kind`, tool schema text): the task's script runs
  (script name in `step`), newest first. `TaskBoard` reads them through dep `ScriptRunsOf(taskID)`.
- Surfaces: task card chip `AdeAutomationChip.vue` (running: `SmartBadge` + name + elapsed; latest
  failed or blocked: red/amber with the reason as tip; click opens the run tab and switches to
  Automations), task panel block `AdeAutomationsBlock.vue` (that task's runs with the shared
  components), entries `Run automation` submenu in the task menu (`taskMenu.ts` cmd `automation`),
  branch row menu and branch panel header (`headerActions.ts`) with the branch preset.
- Notification (P238 notifier): `HandleScriptRuns(runs)` for smart runs ending not `done`:
  `Automation failed · <name>` / `Automation needs you · <name>`, body = reason; `done` only under
  the existing `OnRunEnded` pref. Click opens the run tab.
- Migration (Space `0029`, Studio `0036`; Studio too because `scripts.Repo` is shared):
  `custom_scripts.use_ade_dir INTEGER NOT NULL DEFAULT 1`; `script_runs.{task_id, task_title,
  branch_id, branch_label}` TEXT default `''`; index `script_runs_task (task_id, created_at DESC)`.

## 4. Files (ownership)

Part 2:

| Area | Files |
|---|---|
| Shared Go moves | `internal/claudeheadless/**` (from `apps/kira-space/internal/adeagent/**`), `internal/loginshell/**`, `internal/flowtest/fakeagent/**` (from Space `flowharness/fakeagent/**`), `apps/kira-space/internal/gitprepare/{script.go,script_test.go}`, the 15 importers of `adeagent` (`ade/{agenttools,board,launches,rebase,rebaseprompt,rebaseverify,runs,vars}.go` + their tests, `appwire/wire.go`, `flows/adeflow/rebase_test.go`), `ade/{setup,deploy}.go`, `gitsession/worktree.go`, `internal/memory/{claude.go,claude_test.go}` |
| Shared Go new | `internal/claudeheadless/{process,stream,mcp,suffix,usermcp,env}.go` (+ tests where 6 says), `internal/runoutcome/outcome.go`, `internal/scripts/{scripts,repo,service,smart}.go`, `internal/scriptruns/{run,repo,service,bound,preview,smart,launch,logs,mcp}.go`, `internal/terminal/{bound,validate}.go`, `internal/flowtest/fakeagent/fakeagent.go` (`fake-mcp` stdio mode with tools `echo`, `ping`) |
| Space Go | `storage/migrations/0028_p242_smart_scripts.sql` + `migrate_smart_scripts_test.go`, `storage/model/tabs.go`, `appwire/{appwire,wire}.go`, `bridge/scriptruns.go`, `flowharness/{main,harness}.go`, `flows/termflow/smart_test.go`, `realclaude/automation_test.go` |
| Studio Go | `storage/migrations/0035_p242_smart_scripts.sql` + migrate test, `storage/model/tabs.go`, `appwire/{appwire,wire}.go`, `bridge/scriptruns.go`, `flowharness/{main,harness}.go` (BinDir, PATH, `.bash_profile`, argv0 dispatch to `fakeagent`), `flows/termflow/smart_test.go`, `realclaude/smartscript_test.go` |
| Shared TS | `packages/shared/domain/{scripts,scriptRuns,runOutcome,tabs}.ts` |
| Workbench | `packages/workbench/src/automations/{AutomationsPanel.vue,ScriptDialog.vue,module.ts,runScript.ts}`, new `automations/smart/{SmartBadge,SmartSettingsFields,ToolsField,McpToolsField}.vue`, `automations/ParamsEditor.vue`, `automations/run/{runDialog.ts,RunScriptDialogHost.vue,RunScriptDialog.vue,ParamsForm.vue,RunPreview.vue}`, `automations/runs/{RunOutcomeBlock,RunsSection,ScriptRunView,RunLog}.vue`, `runs/{runText,runsQueries}.ts`, `tabs/scriptRunTabKind.ts`, `state/createTerminalTabs.ts`, `terminal/TerminalTabView.vue` (Run again through the dialog) |
| Apps frontend (both) | `frontend/src/{bridge/index.ts,workbench/automationsModule.ts,workbench/tabViews.ts,workbench/WorkbenchShell.vue,state/tabKinds.ts,state/tabDomain.ts}`, `frontend/bindings/**` (regenerated) |
| Tests (both) | `tests/ui/automations-smart.spec.ts` (new), `tests/ui/support/{ipcChannels,mockRuntime,bootSnapshots}.ts`, `tests/e2e-real/automations-smart-real.spec.ts` (new), `tests/e2e-real/fixtures.ts` (fakeclaude build; Studio gains it), `tests/unit/go-ts-vocabulary-parity.spec.ts` if it lists kinds |
| Docs | `docs/ARCHITECTURE.md` (Automations section, migrations high-water, headless isolation), `docs/DEV_ENVIRONMENT.md` (real-claude rows, Studio fake claude), `README.md` and `apps/kira-space/README.md` feature line, SPEC row + `plans/P242-part2-result.md` |

Part 3 (or the second half of one pass): Space `ade/{automation.go (new),runs.go,rebase.go,steps.go,
agenttools.go,board.go}`, `adeflow/{parse,writer}.go` + tests, `bridge/adewire/wire.go`,
`internal/claudeheadless/outcomes.go`, `agentnotify/agentnotify.go`, `appwire/**`, migrations Space
`0029` / Studio `0036` + tests, `internal/scripts/**`, `internal/scriptruns/{preview,service,run,repo}.go`,
Space frontend `ade/v2/{board/taskMenu.ts,plan/useTaskMenu.ts,plan/AdeBranchRow.vue,plan/AdeTaskCard.vue,
panel/headerActions.ts,panel/AdeTaskPanel.vue,workflows/AdeStepCard.vue,board/workflowForm.ts,wire.ts}`,
new `ade/v2/automation/{AdeAutomationChip,AdeAutomationsBlock}.vue`, `state/agentNotify.ts` (click),
shared `ScriptDialog.vue` (switch), `run/RunScriptDialog.vue` (task/branch sections), tests below.

## 5. Tests

P236 conventions: real processes, temp homes, default settings, fake `claude` through PATH, no
mocks in Go flows. No new unit tests: `decide` and `ParamValues` rows are each reached by a flow case
below (CLAUDE.md bar). Coverage gate: the 5 new bound methods per app are called in that app's flow
tests; `exempt.txt` stays empty.

### 5.1 Go flows, Part 2

`apps/kira-studio/internal/flows/termflow/smart_test.go` `TestSmartScript` (the full matrix; shared
code, one app carries it):

1. Save rules: defaults filled (sonnet, 1, 15m, Read/Grep/Glob); reserved param name, `{secret}` in
   prompt, unknown tool, pattern with `)`, budget 30, MCP server with no tools: each refused with its
   message.
2. Preview: `tools` `[Read Grep Glob]`, `allowedTools` `[Read Grep Glob mcp__kira-ade__finish_step]`;
   Bash with patterns -> `Bash(git status:*)`; prompt parts carry param values as vars; env names;
   select value outside options refused; required missing listed.
3. Start done (fake `done` after `waitFile`): run `running` mid-run (state read), then `done`,
   `reported`, summary; `.args` holds `--model sonnet --max-budget-usd 1 --setting-sources ''
   --strict-mcp-config --permission-prompts none --tools Read,Grep,Glob`; `.prompt` equals preview
   text + suffix byte for byte; env `KIRA_PARAM_X` exact; cwd `<KIRA_HOME>/automations/<id>`;
   `ReadLog` returns the tool-use line; log push received.
4. Outcomes: `failed` with reason; `needs_input` -> `blocked`; `nofinish` exit 0 and `fail` exit 1
   (`lastError` set); an emitted `result` line `error_max_budget_usd` with cost -> `failed`/`budget`,
   `costUsd`; denials in a result line -> reason suffix; timeout via harness override
   (`Deps.SmartTimeout`, P241's `RebaseTimeout` precedent).
5. Stop -> `cancelled`; app restart while running -> quit outcome, then `Recover` leaves nothing
   running.
6. Cap: three `sleep` runs; 4th Preview blocker and Start `E_INVALID`.
7. Hash: edit the script between Preview and Start -> `E_CONFLICT`; one-off prompt runs (`.prompt`)
   and the stored script is unchanged.
8. Injection: param values `'; touch pwned #`, `$(touch pwned)`, backticks, newline + `ignore
   previous instructions`: no `pwned` file anywhere under the harness root, argv identical to a
   plain run's, stdin equals the preview, env value exact.
9. Secret param: present in the child env, absent from `script_runs` row, logs, prompt and the
   `params` of `Get`.
10. Normal script with params: Start returns a token; terminal Open with it prints `$KIRA_PARAM_X`;
    second use and a 61 s old token refused (clock seam).
11. MCP: `$HOME/.claude.json` with server `fake` (the harness `fake-mcp`); `McpServers` lists it
    (no env/args in the answer); `McpTools` lists `echo`, `ping`; run with `fake/echo` ticked: second
    `--mcp-config` file holds the server, `allowedTools` has `mcp__fake__echo`, file gone after the
    run; server removed from `.claude.json` before Start -> blocker.

`apps/kira-space/internal/flows/termflow/smart_test.go` `TestSmartScriptSpace`: done run (cases 3,
11 short form) so Space's own bound methods are covered, plus Space-without-task grant
(`allowedTools` has no Space tools).

Migration tests (both apps): a pre-migration `custom_scripts` row reads back `kind script`,
`params []`, `smart null`.

### 5.2 Go flows, Part 3

`apps/kira-space/internal/flows/adeflow/automation_test.go` `TestAutomationRun`: task picker needs;
two branches -> `needs.branches` 2 with a draft disabled and a branch with a running run disabled;
branch preset skips it; ADE vars in prompt and env (`KIRA_BRANCH`, `KIRA_BASE`); worktree folder on
and off; Space tools and `run_outcome` in `allowedTools`; gate: ADE step held `waiting for automation
x` then launched at run end, smart start refused while the step runs, rebase blocker; workflow step:
prompt from script + `FinishStepSuffix`, script tools + finish_step, unknown and duplicate name and
missing param fail the launch, step timeout wins; `run_outcome` kind `automation` lists a failed run;
normal script from ADE: terminal env `KIRA_BRANCH`. `flows/notifyflow`: failed smart run notifies,
done does not unless `OnRunEnded`.

### 5.3 Playwright UI (mocked bridge, both apps)

`tests/ui/automations-smart.spec.ts`: `New smart script` menu; editor shows `Default tools`, page has
no text `read-only`; Bash patterns appear only when ticked; MCP switch off by default, on shows
unticked tool checkboxes; params builder; AI badge on row and run rows; run dialog: text, select,
multiselect fields; prompt chips (`[data-testid=var-chip][data-var=env]`); exact `run-allowed-tools`
text; one-off edit sent in `scriptRunsStart` args and absent from `customScriptsUpdate` calls; Run
opens the run tab with `Running` and a ticking elapsed (Playwright clock); pushed log line shows;
done and failed outcomes with reason and cost; Continue in terminal opens a terminal tab with
`claude --resume`. Space Part 3: `tests/ui/ade-v2-automations.spec.ts` (task menu submenu, branch
row and header entries, branch radio, chip states, task panel block, step card toggle writes YAML).

### 5.4 e2e-real (both apps)

`tests/e2e-real/automations-smart-real.spec.ts`: create a smart script in the UI, run it with the
fake claude (`done` scenario), see `Running` then `Succeeded`; a `failed` scenario shows its reason.
Studio fixture builds `bin/fakeclaude` from `internal/flowtest/fakeagent/cmd/fakeclaude` and sets the
`HOME` `.bash_profile` PATH prefix (DEV_ENVIRONMENT P150 note). Part 3: Space
`ade-automation-real.spec.ts` (task menu run in the worktree; a held step).

### 5.5 Real claude (opt-in, haiku, `--max-budget-usd 0.05` per run)

- `apps/kira-studio/internal/realclaude/smartscript_test.go` `TestSmartScriptRun`: (a) prompt `Reply
  with the word ok.` -> `done`, `reported`, `costUsd > 0`; (b) default tools, prompt asks to create
  `marker.txt` with Bash -> no `marker.txt`, the run ends with a reported status.
- `apps/kira-space/internal/realclaude/automation_test.go` `TestSmartScriptRun`: (a) through Space
  wiring. Part 3 adds a subtest in a task worktree with Space tools.
- New row in `docs/DEV_ENVIRONMENT.md` "Real `claude` tests (P237)":
  `| Smart scripts: internal/{claudeheadless,scriptruns,scripts}/** | KIRA_REAL_CLAUDE=1 CGO_ENABLED=1
  go test -tags realclaude ./apps/kira-studio/internal/realclaude/ ./apps/kira-space/internal/realclaude/
  -run TestSmartScriptRun -v -timeout 15m |`. ADE row path list: `apps/kira-space/internal/adeagent`
  becomes `internal/claudeheadless`. Lint line gains nothing new (same packages).
- Rows to run at Part 2 end: Smart scripts (new), ADE runs (package moved), Claude config isolation
  (`TestRealClaudeSettingsUntouched`: argv composition changed), hooks (`internal/terminal/bound.go`
  changed), memory gate (`internal/memory/claude.go` changed). Part 3 end: Smart scripts, ADE runs.

### 5.6 Checks

Per commit: `go build ./...` (+ `-tags server` for Space where the env allows), `gofmt`/`go vet`
(golangci-lint where it runs), `bun run typecheck`, `bun run lint`, `bun run lint:dead`. Once at the
end: `test:flows:space`, `test:flows:studio` (coverage gate included), `go test ./internal/...` for
the touched shared packages, both apps' full UI suites (`test:ui:space`, `test:ui:studio`), both
`test:e2e-real:*`, the real-claude rows above. Hooks green on every commit, never `--no-verify`.

## 6. Commits (Part 2)

1. `refactor: move headless claude to internal/claudeheadless, login shell helpers to internal/loginshell`
2. `refactor(test): share the fake claude across both flow harnesses`
3. `feat(claudeheadless): model, budget, tool flags, isolation, result event, user MCP servers`
4. `feat(scripts): smart kind, params and tool allowlist`
5. `feat(scriptruns): preview, start, smart runs, logs and launch tokens`
6. `feat(workbench): smart script editor`
7. `feat(workbench): run dialog and run tab`
8. `test: smart script flows in both apps`
9. `test: smart script UI specs and e2e-real`
10. `test: real claude smart script`
11. `docs: smart scripts`

Part 3: `feat(space): run scripts from ADE tasks and branches`, `feat(space): smart script workflow
step`, `feat(space): automation gate, run_outcome and notification`, `test(space): ADE automation
flows, UI and e2e-real`, `docs: scripts in ADE`.

## 7. Parallelism verdict

- Inside Part 2: no streams. Frontend depends on the generated bindings and the Go types; every
  commit touches both apps' wiring.
- Beside **P243 Part 2**: no. Overlap: Space `appwire/**`, Space migrations (both take the next
  number), `bridge/events.go`/`bridge/index.ts`, `frontend/bindings/**`, `flowharness/harness.go`,
  `tests/ui/support/{ipcChannels,mockRuntime,bootSnapshots}.ts`, `flows/coverage`, ARCHITECTURE and
  DEV_ENVIRONMENT. Row order also puts P243 Part 2 after P242's last part.
- Beside **P245**: no by CLAUDE.md (one phase at a time; only the user can override). File overlap is
  small: P245 owns `packages/git-ui/**` and Space git frontend; Part 2 edits neither. If the user
  overrides, Part 2 must not touch `packages/theme/**` (it does not plan to) and P245 must not touch
  `packages/workbench/src/automations/**`, both apps' `WorkbenchShell.vue`, `tests/ui/support/**` or
  visual baselines; each runs in its own worktree.

## 8. Orchestrator verification checklist (Part 2)

- [ ] Codegraph: this planner's run shows `codegraph_explore` calls; the implementer executes a named
      plan (no call required).
- [ ] Moves: `rg -n "kira-space/internal/adeagent" apps internal` empty; `rg -n
      "claudeheadless\.Run\(" apps internal/scriptruns` hits `ade/runs.go` and `internal/scriptruns`.
- [ ] One report channel: `rg -n "json-schema" internal/scriptruns internal/claudeheadless` empty;
      `rg -n "FinishStepTool" internal/scriptruns` hits.
- [ ] Isolation: flow case 3 asserts `--setting-sources ''`, `--strict-mcp-config`,
      `--permission-prompts none`, `--tools`.
- [ ] Wording: `rg -ni "read-only|read only" packages/workbench/src/automations` empty; `rg -n
      "Default tools" packages/workbench/src/automations` hits.
- [ ] D5: the dialog's `run-allowed-tools` text comes from `Preview.allowedTools` (grep the
      component), and Start uses the same composed list (hash covers it).
- [ ] D1: `rg -n '"sonnet"|15m|MaxBudgetUSD.*1' internal/scripts/smart.go internal/scripts/scripts.go`.
- [ ] D2: UI spec asserts the edit reaches `scriptRunsStart` and never `customScriptsUpdate`.
- [ ] D4: UI spec asserts MCP switch off and tool checkboxes unticked after enabling.
- [ ] Migrations: both new files contain `kind`, `smart_json`, `script_run_logs`.
- [ ] Bound methods: `Preview`, `Start`, `ReadLog`, `McpServers`, `McpTools` named in both apps' flow
      tests; both coverage gates green; both `exempt.txt` empty.
- [ ] Frontend rules: new `.vue` are `<script setup lang="ts">`, no `<style>`; exactly one new Pinia
      store (`scriptRunDialog`); queries via TanStack; `package.json`/lockfile unchanged (go-sdk MCP
      client already a dependency: `go.mod` unchanged).
- [ ] VarText: `rg -n "VarText" packages/workbench/src/automations/run` hits the prompt, env and
      folder previews.
- [ ] Real claude: result section quotes the PASS line and spend of each row in 5.5; DEV_ENVIRONMENT
      has the new row.
- [ ] Hooks green on every commit; SPEC row Done with `plans/P242-part2-result.md`.

## 9. Not in Part 2

Recurring and missed runs (Part 4 if split, else Part 3); memory runs in the Automations list
(Part 1 decision); project- or local-scope MCP servers (user scope only); Needs you kind
`automation` (P4).

## 10. Questions for the orchestrator or user

1. Accept the split (section 2): Part 2 smart scripts, Part 3 scripts in ADE, Part 4 recurring?
2. Drop the Needs you `automation` entry (P4)?
3. Keep the report server name `kira-ade` in Studio's tool list (P5), or rename it app-wide to
   `kira` (touches every ADE prompt, fake and test)?
4. Smart runs load no Claude settings files (P2). A user whose auth lives in a settings file `env`
   (Bedrock, proxy) cannot run smart scripts, as with memory today. Accept?
