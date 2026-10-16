# P86 — Claude Code lifecycle hooks (opt-in), plus a running-agent-sessions status-bar widget

`docs/v1.8/SPEC.md`'s P86 row (`:160`) and its Sequencing paragraph (`:136`-`:141`), turned into
concrete steps. Everything below was read in the current tree (`claude/p82-p83-implementation-ocpvj1`
at `58861e85`, P71-P85 landed); line numbers are from that tree.

Two halves, and they are **not one mechanism** (§10 decides this plainly, with the reason). The
widget's count comes from the PTY's own lifetime, which P85 §3.1 deliberately preserved. The hooks
exist for a different job: letting Kira Studio's own UI see what Claude Code is doing *inside* a
session it launched.

No new dependency. No `@kira/git-ipc` contract change, no `CONTRACT_VERSION` bump (P83 §18's
reasoning holds — every method here is on the Wails bound surface). No `packages/git-ui/` change,
no VS Code-extension change. No SQLite migration (two settings leaves, not a table — §9.2).

**The constraint SPEC states, met by construction, not by care:** this phase writes no file inside
any project, ever — not `.claude/settings.json`, not `.claude/settings.local.json`, not `.mcp.json`.
§2 and §3 are where that is established.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Does hook wiring need a project's `.claude/settings.json` | **No.** `claude --settings <file>` loads *additional* settings from a path this app owns, outside every project. Confirmed from `claude --help` in this container, not memory: `--settings <file-or-json>  Path to a settings JSON file or a JSON string to load additional settings from` | §2.1 |
| Then does it need `.claude/settings.local.json` | **Also no**, and this is the stronger result: nothing is patched, merged or un-merged anywhere, so opting out is complete by construction rather than by a cleanup path that can fail | §2.2, §3.2 |
| Does `--settings` suppress the user's own hooks | **No.** It is additive; `--setting-sources` is the separate flag that restricts which sources load, and this phase never passes it. A project's own `PostCompact` hook (this very repo has one) keeps firing | §2.3 |
| The opt-in flow's shape | A settings leaf `claudeCode.hooksEnabled`, default `false`, read **at every launch** — never a one-time install. A new Settings section "Claude Code" owns it; a dismissible first-run banner inside the first Claude Code tab points at it. The banner never types into the PTY | §9 |
| How Kira Studio knows which tab a hook belongs to | `KIRA_TERMINAL_ID` in the launched shell's env, forwarded by the hook as a request header. Hook processes are children of `claude`, which is a child of that shell, so the value is inherited | §5.3 |
| How a hook reaches the app | One generated shim script posting the hook's own stdin JSON to a **unix-domain socket** (0600, in a 0700 mkdtemp directory) served by stdlib `net/http`. `internal/gitaskpass`'s socket/shim/token shape plus `internal/dbmcp/http.go`'s handler shape, both already in this repo | §5 |
| Are the hooks and the widget coupled | **No.** The widget works with hooks off, and must — hooks are opt-in. The count is PTY liveness; the hooks add within-session detail (which tool, waiting for input) that liveness cannot express | §10 |
| What tells a Claude Code launch apart from a shell one | An explicit `launchKind` field threaded from the launch site — **not** `command === 'claude'`, which P85 OQ-3 ruled out in advance | §4 |
| Where the count's authority lives | **Go.** `terminal.Registry` already holds every live session across every window; the frontend's own map is per-window and would disagree between windows. P87's keep-awake assertion is one OS-level process and needs one app-wide truth | §11 |
| Which store pattern to follow | `state/cacheStats.ts`'s pushed-from-Go shape, not `state/blameStatus.ts`'s owner token. A token arbitrates between two same-window writers; here the only writer is Go | §12 |
| Absent, not a zero reading | `StatusBar.vue:72`-`74`'s own rule, applied: `v-if="agentCount > 0"`, no "0" state | §14.1 |
| Any unit test | **Two.** The hook-event reducer (`tests/unit/agent-activity-reducer.spec.ts`) and the listener's auth/bound/parse path (`internal/agenthooks/server_test.go`). Everything else is CRUD, a toggle, or rendering, which `CLAUDE.md`'s bar excludes by name | §19 |

---

# Part A — the hooks

## 1. What a Claude Code launch is today

P85 landed a fixed command. `TabStrip.vue`'s `newTabMenuItems()` calls
`launchInActiveWorkspace({command: 'claude', label: 'Claude Code', color: 'none'})`, which reaches
`openRepoTerminalTab` (`state/repoTabs.ts:211`-`242`), `openTerminalSession`
(`state/terminals.ts:104`), `TerminalService.Open` (`internal/bridge/terminal.go:79`) and finally
`$SHELL -l -i -c claude` (`internal/terminal/session.go:69`-`75`).

So today: **the app knows nothing about the session after spawn except its bytes and its exit code.**
`TerminalSession.status` (`state/terminals.ts:20`) is `starting`/`running`/`exited`/`failed`, driven
by `ChannelTerminal`'s own `exited` flag. Nothing distinguishes a Claude Code tab from a shell tab
except its command string, and P85 §11.4 refused to add a discriminator so this phase could design
one against the tree it found.

## 2. The mechanism — `claude --settings <app-owned file>`

### 2.1 What runs

For a Claude Code launch with `claudeCode.hooksEnabled` on, the command becomes:

```
claude --settings '/var/folders/…/kira-agent-XXXX/hooks.json'
```

built in Go (`internal/bridge/terminal.go`, §8.3), never in the frontend — the path is app-private
and never enters tab state, so "Duplicate tab" re-derives it rather than persisting a stale one.

With the setting off, the command stays the literal `claude`: P85's behaviour, byte for byte.

### 2.2 Why no project file is touched

Three candidate homes for the hook config, and only one is outside the project:

| Candidate | Verdict |
|---|---|
| `.claude/settings.json` | Checked in. SPEC forbids it outright, and it is right to: a per-machine socket path and a per-run token have no business in version control |
| `.claude/settings.local.json` | Gitignored **by convention**, not by guarantee — this repo's own `.gitignore:154`-`157` had to spell the rule out. An arbitrary project may track it. Worse, the file is the user's own: wiring in means parse, merge, and un-merge on opt-out, with a real chance of clobbering hooks the user wrote |
| `~/.claude/settings.json` | Not in the project, but global: it would apply the app's hooks to every `claude` the user runs anywhere, including sessions Kira Studio never launched |

`--settings` beats all three because the file is **per launch**, not per project and not per user.
Nothing persists, so nothing needs undoing.

### 2.3 Additive, not a replacement

`claude --help` lists `--setting-sources <sources>` ("Comma-separated list of setting sources to
load (user, project, local)") as a *separate* flag from `--settings`. This phase never passes
`--setting-sources`, so user, project and local settings all still load and the app's hooks are
added to whatever the user already has. A project hook and a Kira Studio hook on the same event both
fire.

OQ-1 records the one end-to-end check this deserves before the feature is called done.

### 2.4 What the hook config contains

Six events, no matcher on any of them (match everything), one command each — the same generated
shim, since `hook_event_name` inside the payload says which event it is:

```json
{
  "hooks": {
    "SessionStart":  [{ "hooks": [{ "type": "command", "command": "'<dir>/hook'", "timeout": 5 }] }],
    "SessionEnd":    [{ "hooks": [{ "type": "command", "command": "'<dir>/hook'", "timeout": 5 }] }],
    "PreToolUse":    [{ "hooks": [{ "type": "command", "command": "'<dir>/hook'", "timeout": 5 }] }],
    "PostToolUse":   [{ "hooks": [{ "type": "command", "command": "'<dir>/hook'", "timeout": 5 }] }],
    "Notification":  [{ "hooks": [{ "type": "command", "command": "'<dir>/hook'", "timeout": 5 }] }],
    "Stop":          [{ "hooks": [{ "type": "command", "command": "'<dir>/hook'", "timeout": 5 }] }]
  }
}
```

The schema is read from the installed CLI, not assumed: the settings hook map is
`partialRecord(enum(events), array({matcher?: string, hooks: [...]}))` and a command entry is
`{type: "command", command: string, timeout?: number}` with `timeout` in **seconds**. This repo's own
`.claude/settings.json` already carries that exact shape for its `PostCompact` hook.

Generate this document with `encoding/json` over a Go struct. Never hand-assemble JSON text.

The command value is the shim path wrapped in single quotes (Claude Code runs it through a shell).
Generation **refuses** — a hard error, not a best-effort escape — a directory path containing a
single quote or a newline, exactly as `gitaskpass.buildShim` refuses an unquotable argv element.
A `mkdtemp` path never contains either; the check exists so a future change cannot silently produce
a broken command.

## 3. Rejected alternatives

### 3.1 Write the hooks into the project's `.claude/settings.json`

Rejected, and not a close call: SPEC forbids it, and it would put a per-run socket path and token
into a file the user commits.

### 3.2 Patch `.claude/settings.local.json` on opt-in, un-patch on opt-out

Rejected. Three concrete failures:

1. **Opt-out can fail.** The app crashes, the file gets edited by hand, two windows disagree — and
   the leftover hook then points at a socket nobody serves, so every tool call in an unrelated
   terminal session spawns a shim that fails. `--settings` has no leftover to strip.
2. **It is the user's file.** Merging in means a read-modify-write of hooks the user wrote, with a
   real chance of clobbering them on a concurrent edit.
3. **Gitignored by convention, not guarantee** — §2.2.

### 3.3 An environment variable pointing at a hook config

Rejected because no such variable exists. `claude --help` documents `--settings` for this and
nothing else; inventing an env contract the CLI does not read would silently do nothing.

### 3.4 Pass the hook config as a JSON string rather than a path

`--settings` accepts `<file-or-json>`, so this is real, not a strawman. Rejected: the document is
roughly 900 bytes of JSON that would have to survive `$SHELL -l -i -c` quoting intact, and it would
show in full in the user's own process list. A path is one short argument.

### 3.5 Match on `state.command === 'claude'` to recognise an agent tab

Rejected in advance by P85 OQ-3, and the reasons hold: a custom script whose command happens to be
`claude` is not a built-in launch, and a future flag on the built-in entry would break the match.
§4's explicit field is the answer.

## 4. The launch-kind discriminator

`packages/shared/domain/tabs.ts`, beside P85's own three fields:

```ts
export const terminalLaunchKindSchema = /*#__PURE__*/ z.enum(['shell', 'claude-code', 'script']);
export type TerminalLaunchKind = z.infer<typeof terminalLaunchKindSchema>;
```

`terminalTabStateSchema` gains `launchKind: terminalLaunchKindSchema.default('shell')` — defaulted
for the same reason P85's three fields are (`parseState` runs on `duplicateState` output).

`TerminalLaunch` (`state/repoTabs.ts:211`) gains `kind: TerminalLaunchKind`. The three producers:

| Producer | `kind` |
|---|---|
| `TabStrip.vue`'s Terminal entry, and both `GitPanel.vue` row menus | omit `launch` entirely; the default `'shell'` applies, unchanged |
| `TabStrip.vue`'s Claude Code entry | `'claude-code'` |
| `TabStrip.vue`'s per-script entries | `'script'` |

`'claude-code'` is the only kind that gets hooks and the only kind the widget counts. A custom
script that runs `claude` counts as a script — stated so the implementation does not "fix" it into
a heuristic.

`launchKind` threads through `openTerminalSession` (`state/terminals.ts:104`) to
`control.terminalOpen` and `TerminalOpenArgs.LaunchKind`, exactly as P85 threaded `command`.

## 5. The hook transport

### 5.1 Shape

`internal/agenthooks` (new domain package — no `internal/bridge` import, picked up automatically by
`internal/layering_test.go`'s `TestDomainPackagesDoNotImportBridge`, the rule `internal/terminal`'s
own package comment already records) owns, for the app's whole run:

- a 0700 `os.MkdirTemp` directory (`kira-agent-`),
- `hooks.json` inside it (§2.4),
- `hook`, the shim script, 0700,
- `s`, a unix socket, 0600 — named one character for `gitaskpass`'s own recorded reason (macOS caps
  `sun_path` at 104 bytes),
- a 32-byte hex token (`crypto/rand`),
- an `http.Server` over `net.Listen("unix", …)` with one route, `POST /hook`.

The listener is stdlib `net/http` over that socket: `internal/dbmcp/http.go`'s handler/timeout shape
(`ReadHeaderTimeout: 10s`, `IdleTimeout: 120s`) on `internal/gitaskpass`'s filesystem boundary. Both
patterns already exist here; neither is invented.

### 5.2 The shim

```sh
#!/bin/sh
# Kira Studio agent hook (P86). Always exits 0: a non-zero exit from a PreToolUse hook blocks the
# agent's own tool call, and this shim only reports. stderr is discarded for the same reason — a
# stale socket must not print into the agent's transcript on every tool call.
exec 2>/dev/null
"<curl>" --silent --max-time 2 --output /dev/null \
  --unix-socket "$KIRA_AGENT_HOOK_SOCKET" \
  --header "Authorization: Bearer $KIRA_AGENT_HOOK_TOKEN" \
  --header "X-Kira-Terminal: $KIRA_TERMINAL_ID" \
  --header "Content-Type: application/json" \
  --data-binary @- \
  http://localhost/hook
exit 0
```

`<curl>` is an absolute path resolved once with `exec.LookPath("curl")` at enable time and written
into the shim, so a `PATH` difference inside the session cannot change which binary runs. When
`curl` is missing, **enabling fails loudly**: `AgentHooksStatus.Error` carries
`curl not found; hooks cannot report` and the Settings section renders it, the same way
`DbMcpStatus.Error` renders a bind failure. No silent degradation.

### 5.3 Correlating a hook to a tab

`KIRA_TERMINAL_ID` is set in the launched shell's environment, so every descendant — `claude`, and
each hook process `claude` spawns — inherits it. The shim forwards it as `X-Kira-Terminal`.

This survives the case a session id would not: a user who exits `claude` and runs it again in the
same tab produces a second Claude Code session whose hooks still resolve to that tab.

`claude --session-id <uuid>` exists and was considered as the correlation key instead. Rejected for
exactly that case — it names only the first session, and a relaunch inside the same tab would go
unattributed.

### 5.4 Env passed to the launched shell

`terminal.OpenParams` gains `Env []string`, appended after `sessionEnv()`'s own four variables. The
domain package stays agnostic: it forwards strings. `internal/bridge/terminal.go` composes them, and
only for `launchKind == "claude-code"` with the listener running:

```
KIRA_TERMINAL_ID=<tab id>
KIRA_AGENT_HOOK_SOCKET=<dir>/s
KIRA_AGENT_HOOK_TOKEN=<token>
```

A plain terminal and a custom script get none of the three. Any process inside that terminal can
read the token — which is the same trust level as the shell itself, since the socket is already
reachable by every process of the same user. The token guards against a *different* user's process
finding the socket path, which the 0600 mode already blocks; it is defence in depth, not the
boundary. Say it that way, never as a boundary it is not.

## 6. What the listener reads, and what it discards

A hook payload's base is `{session_id, transcript_path, cwd, permission_mode}` plus per-event
fields — `tool_name`/`tool_input`/`tool_use_id` (PreToolUse), plus `tool_response` (PostToolUse),
`message`/`title`/`notification_type` (Notification), `stop_hook_active` (Stop), `source`
(SessionStart), `reason` (SessionEnd). Read from the installed CLI, not from memory.

`tool_input` and `tool_response` carry file contents and command output. The listener decodes into a
struct holding only the fields below; `encoding/json` skips the rest without retaining it, and
nothing is logged at any level:

```go
type Event struct {
    TerminalID       string `json:"terminalId"`       // from X-Kira-Terminal, not the body
    Event            string `json:"event"`            // hook_event_name
    SessionID        string `json:"sessionId"`
    Cwd              string `json:"cwd"`
    ToolName         string `json:"toolName"`
    ToolUseID        string `json:"toolUseId"`
    NotificationType string `json:"notificationType"`
    Message          string `json:"message"`          // bounded, §6.1
    Source           string `json:"source"`           // SessionStart
    Reason           string `json:"reason"`           // SessionEnd
}
```

### 6.1 Bounds

- Request body: `http.MaxBytesReader` at `maxHookPayloadBytes = 4 * 1024 * 1024`. Over that, 413 and
  the event is dropped. A dropped `PostToolUse` cannot strand the UI, because §13's reducer pairs by
  `tool_use_id` and is reset by `Stop` and by the session leaving the registry.
- `Message`: truncated to `maxHookMessageBytes = 200`, on a rune boundary.
- Token check: `crypto/subtle.ConstantTimeCompare`, `gitaskpass`'s own precedent.
- Unknown or empty `X-Kira-Terminal`: 400, dropped. The listener never invents a terminal.

## 7. Lifecycle

`AgentHooksService` (`internal/bridge/agenthooks.go`) owns start/stop, copying `DbMcpService`'s
shape verbatim — `Status()`, `SetEnabled(args)`, a `sync.Mutex` and a `server *agenthooks.Server`
field. `SetEnabled` patches the settings leaf, emits `ChannelSettingsChanged` with the merged row,
then starts or stops under the lock and returns the status, including an `Error` string rather than
a Go error when the start itself failed (`DbMcpService.SetEnabled:214`-`236`, read directly).

Started at boot when the leaf is already on; stopped in `main.go`'s teardown beside
`codeWorkspaceSvc.Shutdown()`. `Close` shuts the HTTP server down with a bounded context and removes
the whole temp directory.

**A running Claude Code session whose listener has stopped keeps working** — its hooks post into a
closed socket, the shim exits 0, and the session is unaffected. Turning the toggle off mid-session
therefore stops the reporting and nothing else. State this in the Settings section's help text.

## 8. The Go diff

### 8.1 Added: `internal/agenthooks`

| File | Contents |
|---|---|
| `agenthooks.go` | `Server`, `New(Options{OnEvent func(Event)})`, `Close()`, `SettingsPath()`, `Env(terminalID string) []string`, `Event` |
| `config.go` | the `hooks.json` document (§2.4) built from a struct, plus `shellSingleQuote` and its refusal rule |
| `shim.go` | the shim body (§5.2) and the `exec.LookPath("curl")` resolution |
| `http.go` | the socket listener, the `POST /hook` handler, the token check and the bounds (§6.1) |
| `server_test.go` | §19.2's cases |

### 8.2 Changed: `internal/terminal`

- `OpenParams` gains `Env []string` — "extra environment, appended after sessionEnv(); the domain
  package never composes it."
- `Session` gains `cwd string` and `agent bool`, both set from `OpenParams` in `newSession`.
- `OpenParams` gains `Agent bool`.
- `Registry` gains `OnChange func()` and `AgentSessions() []AgentSession` where
  `AgentSession{ID, Cwd string}`.
- `Registry.Open` calls `OnChange` after registering; `Registry.remove` calls it after deleting.

**The ordering here is load-bearing and easy to get wrong.** `readLoop` calls `onExit` *before*
`unregister()` (`session.go:126`-`128`), so emitting the count from `OnExit` would report the dying
session as still live. `OnChange` fires from `remove`, after the map entry is gone. Call it outside
the mutex.

### 8.3 Changed: `internal/bridge/terminal.go`

- `TerminalOpenArgs` gains `LaunchKind string \`json:"launchKind"\``; validated against the three
  known values, `E_INVALID` otherwise (empty is accepted and means `shell`, so an older caller keeps
  working).
- `TerminalService` gains `AgentHooks *AgentHooksService` and `Emit` already exists.
- `Open` composes the command and env before calling `Registry.Open`:

```go
command, env := args.Command, []string(nil)
agent := args.LaunchKind == launchKindClaudeCode
if agent && s.AgentHooks != nil {
    if path, hookEnv, ok := s.AgentHooks.LaunchFor(args.TerminalID); ok {
        command += " --settings " + agenthooks.ShellSingleQuote(path)
        env = hookEnv
    }
}
```

  `maxTerminalCommandBytes` is checked against `args.Command` as today, before this append — the
  app's own flag is not the user's text and must not count against their budget.
- New method `AgentSessions() []AgentSessionWire` for the boot hydrate (§12).

### 8.4 Changed: `internal/bridge/events.go`, `main.go`, settings model

- `ChannelAgentEvent = "kira:agent:event"`, `ChannelAgentSessions = "kira:agent:sessions"`. Both
  `Emit`, not `EmitTo`: the count is app-wide by definition (§11), and a hook event is filtered by
  the receiving window against terminals it owns.
- `main.go`: construct `AgentHooksService`, pass it into `TerminalService`, set
  `registry.OnChange`, register the service, close it in teardown.
- `model.ClaudeCodeSettings{HooksEnabled, HooksPromptDismissed bool}` and `model.ClaudeCodePatch`,
  mirroring `DbMcpSettings`/`DbMcpPatch` (`internal/storage/model/settings.go:57`-`60`, `:145`).

## 9. The opt-in flow

### 9.1 The rule

**The setting is read at every launch.** It is not an installer, not a one-time write, not a state
that can drift. Off means the command stays `claude`; on means one flag is appended. That is the
whole of the opt-out path.

### 9.2 Settings leaves

`packages/shared/domain/settings.ts`, mirroring `dbMcpSettingsSchema` exactly:

```ts
export const claudeCodeSettingsSchema = /*#__PURE__*/ z.object({
  hooksEnabled: z.boolean().default(false),
  hooksPromptDismissed: z.boolean().default(false),
});
```

added to `settingsSchema` with `.default({hooksEnabled: false, hooksPromptDismissed: false})`, to
`settingsPatchSchema` as `.partial().optional()`, and to `defaultSettings`.

Two leaves, not a table: both are scalar booleans, which is exactly what `repos/settings.go`'s
`leaf` helpers take, and neither of P85 §11.1's three objections applies.

### 9.3 The Settings section

`state/settings.ts`'s `sections` gains `'Claude Code'` between `'Scripts'` and
`'Code intelligence'` — beside the launch surface it configures, and in the same family as the two
other sections that own an app-local server's on/off switch.

Contents, `'Database MCP'`'s own layout (`SettingsDialog.vue:1385`-`1445`) reduced to what this
phase needs:

| Control | testid | Behaviour |
|---|---|---|
| Toggle, "Report session activity to Kira Studio" | `settings-claude-code-hooks` | Calls `agentHooksSetEnabled` immediately — instant-effect, bypassing draft/Save, the posture `'Connected editors'`/`'Code intelligence'`/`'Database MCP'` already take |
| Help paragraph | — | Names exactly what happens: Claude Code tabs launch with `--settings` pointing at a file this app owns; no project file is written; turning it off affects the next launch, and a session already running simply stops reporting |
| Error note | `claude-code-hooks-error` | `AgentHooksStatus.Error` when non-empty (bind failure, `curl` missing) |
| Config path | `claude-code-hooks-path` | The generated `hooks.json` path, mono, read-only, shown only while running — so the claim "outside your project" is checkable, not just asserted |

### 9.4 The first-run banner

Discoverability, without a write anywhere. `RepoTerminalView.vue` renders a banner **above** the
xterm host (`repo-terminal-host`), a sibling of the existing `terminal-footer`, when all three hold:
the tab's `launchKind` is `claude-code`, `settingsState.claudeCode.hooksEnabled` is false, and
`hooksPromptDismissed` is false.

`data-testid="claude-code-hooks-prompt"`, one line of text and two buttons:

- **Enable** — patches `hooksEnabled` through `agentHooksSetEnabled`, then replaces the banner with
  one line saying it applies to the next Claude Code tab. The running session is not restarted and
  not typed into.
- **Not now** — patches `hooksPromptDismissed`, and the banner never returns.

**It never writes to the PTY.** P83 §8.2 and P85 §3.1 both record that rule; a prompt rendered in
the tab's own chrome respects it, a prompt typed into the shell would not.

---

# Part B — the widget

## 10. Are the hooks and the widget coupled? No.

Decided plainly, since SPEC puts both in one row and the reader will reasonably assume one feeds the
other.

**The count is PTY liveness, and needs no hook at all.** P85 §3.1 chose `-c` over a post-spawn write
for precisely this: with `$SHELL -l -i -c claude`, the shell exits when `claude` exits, so the
session's own exit *is* the agent's exit. `internal/terminal` already reports it
(`readLoop`, `waitExitCode`, `remove`). Adding a hook dependency here would be worse than redundant:
hooks are opt-in, so a hook-fed count would read zero for every user who declined, while agents were
visibly running.

**The hooks answer a question liveness cannot**: what the session is doing right now — running a
tool, waiting for the user, finished with a turn. That is the within-session detail §13 reduces and
§14 renders.

They meet in exactly one place, and only for display: §14's tooltip lists the Go-published sessions
and annotates each with whatever activity this window knows. With hooks off, the annotation is
absent and the count is still right.

One honest edge, not hidden: `claude` not installed exits 127 immediately, so the count blinks 1
then 0. The footer already says `Process exited (code 127)` (P85 §2.4), which is the legible signal;
suppressing the blink would need an availability probe P85 rejected for its own reasons.

## 11. The count's authority is Go

`terminal.Registry` holds every live session across every window, so it is the only place an
app-wide answer exists. The frontend's `state/terminals.ts` map is per-window: with two windows open
each would show its own subset, and the user's question ("how many agents am I running") is not a
per-window question.

It also settles P87 in advance. That phase acquires one `caffeinate -i -s` per *app*, not per window;
driven by a per-window count, two windows would each try to own it.

The published payload is a list, not a bare number:

```ts
export interface AgentSessionsEvent {
  sessions: { terminalId: string; cwd: string }[];
}
```

A bare count would leave §14's tooltip unable to say *which* sessions, and this window cannot fill
that gap for a session another window owns. `cwd` is the label source (its basename); the count is
`sessions.length`.

## 12. The store — `state/agentSessions.ts`

`state/`, not `repo/state/`: `StatusBar.vue` and `TabStrip.vue` (both `workbench/`) read it, the
same layering argument `state/terminals.ts` records at its own head.

```ts
export const agentSessionsState = reactive({
  sessions: [] as AgentSession[],
  activity: new Map<string, AgentActivity>(),   // keyed by terminalId, §13
});
export function initAgentSessions(): Promise<void>
export function reduceAgentActivity(prev: AgentActivity | undefined, event: AgentEvent): AgentActivity
export function agentActivityFor(terminalId: string): AgentActivity | undefined
```

`initAgentSessions` joins `main.ts`'s boot `Promise.all`: one `control.terminalAgentSessions()`
hydrate (the broadcast only fires on change, so a window opened later needs a snapshot — `dbmcp.ts`'s
`hydrateDbMcp` precedent), then two subscriptions, `onAgentSessions` and `onAgentEvent`.

**No owner token**, unlike `state/blameStatus.ts`. That token exists to arbitrate between two
same-window writers racing across a view switch; here the only writer is Go, pushing over an event.
`state/cacheStats.ts` is the shape this follows — a reactive store, one subscription, nothing else.

`onAgentSessions` replaces `sessions` wholesale and **prunes `activity`** of every terminal id no
longer listed. That is what makes a killed tab's activity disappear even when `SessionEnd` never
arrived (§13 rule 5).

## 13. The activity reducer

The one piece here with real interacting rules, and the one that earns a unit test.

```ts
export type AgentPhase = 'idle' | 'working' | 'attention';

export interface AgentActivity {
  phase: AgentPhase;
  runningTools: string[];   // tool_use_id, insertion-ordered, capped
  toolName: string | null;  // most recent PreToolUse's tool, for the tooltip
  message: string | null;   // Notification text, when phase is 'attention'
  sessionId: string | null;
}
```

Transitions:

| Event | Effect |
|---|---|
| `SessionStart` | Replaces the whole entry with a fresh `idle` one, never merges — a user who exits `claude` and reruns it in the same tab starts clean |
| `PreToolUse` | Adds `tool_use_id` to `runningTools`, sets `toolName`, phase `working` |
| `PostToolUse` | Removes `tool_use_id`. Phase stays `working`; a turn ends at `Stop`, not at a tool |
| `Notification` | Phase `attention`, `message` set. `runningTools` untouched |
| `Stop` | Phase `idle`, `runningTools` cleared, `message` cleared |
| `SessionEnd` | Drops the entry |

The rules that make it worth testing, each a real failure mode rather than an invented one:

1. **Pairing is by `tool_use_id`, never a depth counter.** Each hook is its own `curl` process, so
   a `PostToolUse` can arrive before its own `PreToolUse`. A set is order-insensitive; a counter
   would go negative and strand the phase.
2. **An unmatched `PostToolUse` is a no-op**, not an error and not a decrement — §6.1 can legitimately
   drop an oversized `PostToolUse`.
3. **`Notification` does not clear `runningTools`.** A permission prompt arrives *during* a tool call;
   losing the set there would make the following `PostToolUse` unmatched too.
4. **`Stop` clears everything**, which is what heals a session that lost a `PostToolUse` to §6.1.
5. **A terminal absent from the latest `sessions` list loses its entry** (§12), so a killed tab never
   leaves a stale `attention`.
6. **`runningTools` is capped** at `MAX_RUNNING_TOOLS = 64`, oldest dropped — a bound on a set fed by
   an external process.

`reduceAgentActivity` is pure: `(prev, event) => next`. The store applies it; the test calls it
directly.

## 14. Rendering

### 14.1 The status-bar widget

`StatusBar.vue`, in the **right-hand** `.side`, before `app-metrics` — it is an app-wide fact like
the metrics and cache readouts beside it, not a caret fact like blame and nav-status on the left.

```
<CodiconIcon name="sparkle" :size="13" /> {{ agentCount }}
```

`data-testid="agent-sessions"`, `v-if="agentCount > 0"` — `StatusBar.vue:72`-`74`'s "absent, not a
zero reading" rule, the same rule the blame and nav-status items follow.

Tooltip: one line per session, `<basename(cwd)> — <activity text>`, where activity text is
`waiting for you` (attention, plus the bounded message when present), `running <toolName>`
(working with a tool), `working` (working with none), `idle`, or nothing at all when this window
knows no activity for that session (hooks off, or another window's session).

**A `<span>`, not a `<button>`.** P76's blame item is a button because clicking it reveals a commit;
this item does nothing yet. P87 converts it and adds the popover — stated here so that phase's own
planning pass knows the conversion is expected and this phase did not pre-build it.

### 14.2 The tab attention dot

`Notification` needs a consumer, or configuring it is dead scope `CLAUDE.md` forbids. The smallest
real one: a Claude Code tab whose activity is `attention`, and which is not the active tab, renders a
dot.

`TabStrip.vue` already has this exact idiom — `:class="{'is-preview': …, 'is-incognito': …}"` with a
matching `:data-preview`/`:data-incognito` attribute. Add `'is-attention'` and `:data-attention`, and
one `.p-tab.is-attention::after` dot rule in that file's own scoped styles. Cleared by activating the
tab: `onClick` is already where a tab becomes active, and the condition reads `!tab.active`, so
nothing extra is wired.

## 15. The frontend diff, in one list

| File | Change |
|---|---|
| `packages/shared/domain/tabs.ts` | `terminalLaunchKindSchema`, `launchKind` on the terminal tab state (§4) |
| `packages/shared/domain/settings.ts` | `claudeCodeSettingsSchema`, schema/patch/defaults entries (§9.2) |
| `packages/shared/domain/agent.ts` (new) | `AgentSession`, `AgentSessionsEvent`, `AgentEvent`, `AgentActivity`, `AgentPhase` |
| `packages/shared/protocol/events.ts` | `agentEvent`, `agentSessions` |
| `frontend/src/bridge/index.ts` | `agentHooksStatus`, `agentHooksSetEnabled`, `terminalAgentSessions`, `onAgentEvent`, `onAgentSessions`, `terminalOpen`'s `launchKind` argument |
| `frontend/src/state/agentSessions.ts` (new) | §12, §13 |
| `frontend/src/state/agentHooks.ts` (new) | the Settings section's status store, `state/dbmcp.ts`'s shape minus the approval half |
| `frontend/src/state/repoTabs.ts` | `TerminalLaunch.kind`, seeded into the tab state |
| `frontend/src/state/terminals.ts` | `launchKind` through `openTerminalSession` |
| `frontend/src/state/tabKinds.ts` | `defaultState` gains `launchKind: 'shell'` (`duplicateState` already spreads) |
| `frontend/src/state/settings.ts` | `'Claude Code'` in `sections` |
| `frontend/src/main.ts` | `initAgentSessions()`, `hydrateAgentHooks()` in the boot `Promise.all` |
| `frontend/src/views/repo/RepoTerminalView.vue` | passes `launchKind`; the first-run banner (§9.4) |
| `frontend/src/workbench/panels/TabStrip.vue` | the Claude Code/script entries' `kind`; the attention dot (§14.2) |
| `frontend/src/workbench/StatusBar.vue` | the widget (§14.1) |
| `frontend/src/workbench/SettingsDialog.vue` | the `'Claude Code'` section (§9.3) |
| `frontend/bindings/…/internal/bridge/{agenthooksservice,terminalservice,models,index}.ts` | regenerated with `wails3 task common:generate:bindings` (`docs/DEV_ENVIRONMENT.md:243`), never hand-typed |
| `tests/ui/support/ipcChannels.ts`, `mockRuntime.ts` | the new call/event channels plus FQN entries; a default `{sessions: []}` for `terminalAgentSessions` and a default status for `agentHooksStatus` |

## 16. What this phase does not touch

Confirmed by reading the post-P85 tree, not assumed:

- **`custom_scripts`, `CustomScriptsService`, the Scripts settings section** — a script gets
  `launchKind: 'script'` at the launch site and nothing else. No per-script "this is an agent" flag
  (§17).
- **`packages/git-ui/`, `packages/git-ipc/`, `apps/kira-studio-vscode/`** — no file, no contract
  method, no `CONTRACT_VERSION` bump.
- **`repo/GitPanel.vue`** — `terminalCountAtPath` is unchanged and still counts a Claude Code
  terminal on its row, which is correct (P85 §5.4 already made this call).
- **`internal/terminal`'s output path** — the coalescer, the drain queue and `terminalRenderer.ts`
  are untouched.
- **`internal/mcpinstall`, `internal/dbmcp`, `internal/repomap`** — read for their shapes, not
  changed. This phase registers no MCP server.

## 17. Deliberately out of scope

- **The keep-awake control** — P87 owns it, including turning §14.1's span into a button.
- **Hook events beyond the six SPEC names.** `UserPromptSubmit`, `SubagentStart`/`SubagentStop`,
  `PreCompact`, `PermissionRequest` and the rest exist in the installed CLI and are deliberately not
  configured: each is a spawn per occurrence with no consumer in this phase's UI.
- **Acting on a hook.** Every hook here reports; none blocks, denies or injects context. The shim's
  unconditional `exit 0` is what enforces that.
- **Reading the transcript.** `transcript_path` arrives and is dropped (§6).
- **Per-script or per-repo hook configuration.** One app-wide toggle.
- **Restoring a Claude Code session across a restart.** P83 §7.5 stands.
- **Making custom scripts countable as agents**, or any heuristic over a command string (§4).
- **Notifying the OS** (a native notification on `Notification`). A tab dot and a status-bar readout
  are this phase's surfaces; a system notification is its own decision with its own permission flow.
- **`docs/ARCHITECTURE.md` / `README.md`.** Chapter docs are their own phase's job.

## 18. Files

Added:

| File | Contents |
|---|---|
| `apps/kira-studio/internal/agenthooks/agenthooks.go` | §8.1 |
| `apps/kira-studio/internal/agenthooks/config.go` | §2.4 |
| `apps/kira-studio/internal/agenthooks/shim.go` | §5.2 |
| `apps/kira-studio/internal/agenthooks/http.go` | §5.1, §6 |
| `apps/kira-studio/internal/agenthooks/server_test.go` | §19.2 |
| `apps/kira-studio/internal/bridge/agenthooks.go` | `AgentHooksService` (§7) |
| `packages/shared/domain/agent.ts` | §15 |
| `apps/kira-studio/frontend/src/state/agentSessions.ts` | §12, §13 |
| `apps/kira-studio/frontend/src/state/agentHooks.ts` | §15 |
| `apps/kira-studio/tests/unit/agent-activity-reducer.spec.ts` | §19.1 |
| `apps/kira-studio/tests/ui/settings-claude-code.spec.ts` | §19.3 |

Modified: `internal/terminal/session.go`, `internal/bridge/terminal.go`,
`internal/bridge/events.go`, `internal/storage/model/settings.go`, `main.go`, plus §15's frontend
list and `tests/ui/repo-workspace.spec.ts`.

Deleted: none.

## 19. Tests

### 19.1 `tests/unit/agent-activity-reducer.spec.ts` — earned

§13's reducer is a decision structure with interacting rules fed by an out-of-order external
producer, which is what `CLAUDE.md`'s bar actually names. Cases, one per rule:

1. `SessionStart` on an existing entry resets rather than merges.
2. `PreToolUse` then `PostToolUse` for the same `tool_use_id` leaves `runningTools` empty and the
   phase still `working`.
3. `PostToolUse` arriving **before** its `PreToolUse` leaves the set empty, never negative.
4. An unmatched `PostToolUse` is a no-op.
5. `Notification` during a tool call sets `attention` and keeps `runningTools`; the following
   `PostToolUse` still matches.
6. `Stop` clears the set, the message and the tool name.
7. `runningTools` past `MAX_RUNNING_TOOLS` drops the oldest, not the newest.

### 19.2 `internal/agenthooks/server_test.go` — earned

The auth and bound path, over a real socket in `t.TempDir()`, `gitaskpass`'s own broker-test
precedent:

1. A valid POST with a token and `X-Kira-Terminal` delivers an `Event` carrying the header's terminal
   id and the body's `hook_event_name`/`tool_name`.
2. A wrong token is rejected and `OnEvent` never fires.
3. A missing `X-Kira-Terminal` is a 400 with no event.
4. A body over `maxHookPayloadBytes` is a 413 with no event.
5. `tool_input`/`tool_response`/`transcript_path` in the body never appear in the delivered `Event`.
6. `Close` removes the directory and the socket.

Plus one non-HTTP case in `config.go`'s own test surface: `ShellSingleQuote` refuses a path holding a
single quote (§2.4's hard error).

**No test for the config document itself** — a struct marshalled by `encoding/json` is the
format-round-trip-with-no-edge-case the bar excludes by name.

### 19.3 Playwright

**`settings-claude-code.spec.ts`** (new, modelled on `settings-scripts.spec.ts`, itself modelled on
`settings-code-intelligence.spec.ts`): the section renders with the toggle off; clicking it calls
`agentHooksSetEnabled` with `{enabled: true}`; a status carrying `error` renders
`claude-code-hooks-error`; a running status renders `claude-code-hooks-path`.

**`repo-workspace.spec.ts`**, beside P85's own two launch-kind cases and following their shape
(`expect.poll` over `control.log()`):

1. The Claude Code entry's `terminalOpen` now carries `{command: 'claude', launchKind: 'claude-code'}`
   — extends P85's existing assertion rather than adding a case.
2. `agent-sessions` is absent with no agent running; after `emitWailsEvent(page, IPC.agentSessions,
   {sessions: [{terminalId: …, cwd: REPO.root}]})` it reads `1`; back to `{sessions: []}` and it is
   absent again. This is the §14.1 rule, asserted as absence and not as a `0`.
3. A `Notification` event through `emitWailsEvent(page, IPC.agentEvent, …)` for a non-active Claude
   Code tab sets `data-attention="true"` on that tab; activating it clears the attribute.

### 19.4 Known gaps, stated rather than papered over

- **No Playwright coverage of a real hook firing.** The Playwright tier has no Go process behind it
  (`mockRuntime.ts` intercepts the `Call` route) and the real app is a native Wails window with no
  remote-debugging hook — P83 §17.3's boundary, restated, not re-argued. §19.2 is where a real
  request crosses a real socket.
- **No coverage of `claude` actually loading `--settings`.** That needs a real `claude` process and a
  real API round trip. OQ-1 is the check, and it is a manual one.
- **No multi-window coverage** of the app-wide count (§11): the fixture drives one window, the same
  limit P85 §15.3 recorded for the custom-scripts broadcast.

## 20. Checks

- Per commit: `bun run typecheck`, `bun run lint` (expect only the known pre-existing
  `UncommittedChangesStrip.vue` info finding), `scripts/check-tokens.sh`, `bun run build`. Go commits
  additionally `go build ./...` and `go vet ./...`.
- Once, near the end (`CLAUDE.md`'s implement-then-test rule), fixes as follow-up commits:
  1. `go test ./...` — `internal/agenthooks`, `internal/terminal`, and `internal/layering_test.go`
     picking up the new domain package automatically.
  2. `bun run test:unit`.
  3. `bun run test:ui`. `repo-workspace.spec.ts` and the `settings-*.spec.ts` files are the exposed
     ones; report counts.
  4. `bun run build:vscode` + `bun run test:webview` — expected entirely unaffected; confirm by
     diffing the touched file list, as P78/P85 did, rather than asserting it.
- Manual pass in the real app: launch a Claude Code tab with the toggle off and confirm the banner;
  click Enable, launch a second tab, and confirm the widget reads 2; run a tool and watch the tooltip
  say so; trigger a permission prompt and confirm the dot on the unfocused tab; exit both and confirm
  the widget disappears rather than reading 0; confirm `git status` in the project is clean
  throughout, which is the whole point of §2. **If no GUI is available in this sandbox — which every
  prior phase in this chapter found — say so plainly in the phase result rather than claiming it
  passed.**

## 21. Order and commits

1. **`feat(terminal): let a session carry extra environment and a launch kind`**
   `internal/terminal/session.go` (`Env`, `Agent`, `cwd`, `OnChange`, `AgentSessions`),
   `internal/bridge/terminal.go`'s `LaunchKind` plumbing, regenerated bindings,
   `packages/shared/domain/tabs.ts`, `state/repoTabs.ts`, `state/terminals.ts`,
   `state/tabKinds.ts`, `TabStrip.vue`'s three producers. No user-visible change yet.
2. **`feat(agent): serve Claude Code hook callbacks over a private socket`**
   `internal/agenthooks/*` and its test. Self-contained; nothing calls it yet.
3. **`feat(settings): opt in to Claude Code session reporting`**
   `internal/bridge/agenthooks.go`, `main.go`, the settings model and schema, `state/agentHooks.ts`,
   `SettingsDialog.vue`'s section, `state/settings.ts`'s `sections`. Wires 2 to the toggle and to
   `TerminalService.Open`'s command/env composition.
4. **`feat(workbench): count running Claude Code sessions in the status bar`**
   `ChannelAgentSessions`, `TerminalService.AgentSessions`, `state/agentSessions.ts`'s session half,
   `main.ts`'s hydrate, `StatusBar.vue`. Complete and useful on its own, with hooks off.
5. **`feat(workbench): show what a Claude Code session is doing`**
   `ChannelAgentEvent`, the reducer half of `state/agentSessions.ts`, the tooltip, `TabStrip.vue`'s
   attention dot.
6. **`feat(terminal): offer hook reporting the first time Claude Code starts`**
   `RepoTerminalView.vue`'s banner (§9.4).
7. **`test(ui): cover the agent widget, the attention dot and the Claude Code settings section`**
   §19.1's unit spec, §19.3's Playwright work.

Dependencies: **1 before everything** (every later commit reads `launchKind`). **2 before 3** (3
starts what 2 builds). **4 before 5** (5's pruning rule reads 4's session list). **6 after 3** (the
banner patches 3's leaf). **7 last** — it asserts against 3, 4, 5 and 6 at once.

## 22. Passes and subagents

**One Sonnet subagent, sequential, commits 1-7.** Commits 1, 3 and 4 all touch
`internal/bridge/terminal.go` and the same regenerated binding files; 4 and 5 rewrite the same store
module and the same `StatusBar.vue` region; 3 and 6 both patch the same settings leaves. That is one
continuous, order-dependent piece of work, which `CLAUDE.md` names as not a parallelisation
candidate. Commit 2 is genuinely independent of the rest, but it is roughly 250 Go lines — not enough
to earn a second agent plus a hand merge over three shared files.

Size: roughly 400 new Go lines plus 150 of Go test; roughly 250 new TS lines across the schemas,
stores and bridge wiring; roughly 120 changed lines in `SettingsDialog.vue`; roughly 60 across
`StatusBar.vue`/`TabStrip.vue`/`RepoTerminalView.vue`; roughly 200 lines of Playwright plus 120 of
unit test. No new dependency, no migration, no contract change.

## 23. Open questions

- **OQ-1 (for the implementer, blocking the phase result's own honesty).** `--settings` is documented
  by `claude --help` as loading *additional* settings, and `--setting-sources` is a separate flag this
  phase never passes — so project and user hooks should keep firing alongside the app's. Confirmed
  from the CLI's own help text, **not** exercised end to end here. Verify once, cheaply: in a scratch
  directory with its own `.claude/settings.json` defining a `SessionStart` hook that touches a file,
  run `claude --settings <generated file> --debug hooks -p 'say hi'` and confirm both hooks ran. If
  they do not, the fallback is `.claude/settings.local.json` with a merge — which §3.2 rejects for
  real reasons, so bring the finding back rather than switching silently.
- **OQ-2 (for the implementer).** The shim uses `curl` rather than re-invoking the app binary as a
  subcommand, the way `gitaskpass` does. The reason is frequency: `PreToolUse` blocks the agent's own
  tool call, and this binary links Wails and WebKit, so a spawn per tool call is a cost the
  `gitaskpass` precedent (one spawn per credential prompt) never had to carry. `curl` is at
  `/usr/bin/curl` on every macOS this app packages for, and §5.2 makes its absence a loud failure. If
  a measurement of the app-binary path ever shows it cheap, that is a change worth making — with a
  number, not a preference.
- **OQ-3 (for the user, not blocking).** §9.3 places the `'Claude Code'` section between `'Scripts'`
  and `'Code intelligence'`. Ship as planned; change it only on request, exactly as P85's OQ-1 asked
  for its own section.
- **OQ-4 (closed, recorded so it is not reopened).** Whether the widget should be a `<button>` in
  this phase. **No** — §14.1. P87 owns the click target and the popover; a button that does nothing
  is worse than a readout.
- **OQ-5 (closed).** Whether custom scripts should be countable as agents. **No** — §4. The
  discriminator is explicit at the launch site, never a heuristic over a command string, which is
  what P85's OQ-3 asked this phase to honour.
- **OQ-6 (for the implementer).** `Notification`'s `message` is shown in the widget's tooltip,
  truncated to 200 bytes (§6.1). It is Claude Code's own wording ("Claude needs your permission to
  use Bash"), not user content — but it is the one hook field that reaches the screen verbatim. If
  any payload seen in practice carries more than that, truncate harder rather than widening the
  bound.

## 24. Dogfooding note

The repo-map MCP server was used for this planning pass, over plain HTTP/JSON-RPC (`CLAUDE.md`
step 4 — the native tool surface is unavailable in an agent-harness session, per its own step-3
caveat). The startup banner hit `CLAUDE.md`'s step-2 hazard again, as P84's and P85's passes both
recorded; deleting `/root/.kira-studio/mcp-repo-map-fc694cca06c3-token.json` and restarting minted a
fresh token and printed the `claude mcp add` command, exactly as documented.

`read_symbol {"symbol":"SetEnabled","file":"apps/kira-studio/internal/bridge/dbmcp.go"}` returned the
method with its doc comment and full body — the single call that settled §7's whole shape (patch the
leaf, emit the merged settings, start or stop under the lock, return `Error` in the status rather
than a Go error), replacing a read of a 400-line file.

`docs/v1.8/mcp-repo-map-issues.md` gets no entry from this pass: nothing this pass asked it returned
a wrong or missing result, and manufacturing an entry for a working query is the invented finding
`CLAUDE.md` warns against.

One fact worth recording here rather than there, since it is about this planning pass and not about
the server: the Claude Code hook payload shapes, the hook settings schema and the `--settings` flag
in §2/§4/§6 were all read out of the installed CLI (`claude --help`, and the shipped
`@anthropic-ai/claude-code/cli.js`) in this container. None of it is from memory, and an implementer
who needs to re-check a field name has the same two sources.
