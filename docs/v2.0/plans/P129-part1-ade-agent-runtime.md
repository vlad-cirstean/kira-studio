# P129 Part 1 — `ade` agent runtime: Kira Space spawns and tracks Claude Code sessions

Plan for `docs/v2.0/SPEC.md`'s P129 row. Planned against `v1.9` at `6e4d57d3` (P127, P128 landed).

This planning pass read `docs/v2.0/design/SPEC.md` (design spec, wins over the mockup) and
`docs/v2.0/design/mockup.html` (1821 lines, `Component.renderVals()`/`sendDialog()`) in full. Scope
comes from those two, not the SPEC row's paraphrase. The phase is too large for one pass (§3), so
this document does two jobs:

1. **§2: whole-phase architecture, binding on every later part's plan.** Package boundaries, data
   model, backend/frontend seams, library choices, and a design-section-to-part coverage map, so
   no behavior is dropped between parts.
2. **§4-§8: Part 1 in full depth.** Kira Space spawns `claude` through the shared terminal module,
   wires P127's `agenthooks.Manager` and reducer, and persists every session it ever started.

Parts 2-8 each get their own plan (`docs/v2.0/plans/P129-part<N>-<slug>.md`), written by an Opus
pass against the tree the previous part left, before that part's implementation starts.

Every path, symbol and count below was measured in this container at `6e4d57d3`:
`codegraph_explore` for symbols, call graphs and blast radius (terminal open path, `BoundService`,
`Registry.OnChange`, `agenthooks.Manager`/`Server`/config, the P127 store and reducer,
`useTerminalMount`/`TerminalHostView`/terminal renderer, `gitsession` worktree/`RunOp`/stack/
remote/gh/merge-tree, `gitrpc` router and `gitstream` allowlist, Space `main.go`/bridge/events);
`git show` of P127's removal commits (`c2dc2a14`, `d20bc970`) for the Studio precedent; the
installed CLI's own `claude --help` (2.1.283) for launch flags.

---

## 0. Open questions and resolutions

Rows marked **user** need a user answer before the named part's planning pass starts. Nothing in
Part 1 depends on any of them.

| Open | Resolution | Where |
|---|---|---|
| One pass or parts? | **Eight parts**, strict order. Part 1 is the agent runtime | §3 |
| Design says "UI only, mock data behind a typed data layer"; SPEC row says Kira Space really spawns agents and git reuses `gitsession` | **SPEC row governs the phase:** real sessions, real git. The design's "typed data layer" becomes the real `AdeService` wire types (§2.4) | §2.1 |
| go-git for the in-memory conflict check (design §3.1) | **Declined, named requirement.** Not a dependency (`go.mod` has none). go-git v5 has no three-way tree merge (its `Merge` supports fast-forward only), so it cannot meet §3.1's "three-way tree merge in memory". `git merge-tree --write-tree` does exactly that, in the object database, no checkout, no temp files, and `gitsession` already runs it (`porcelain.MergeTreeArgs`/`ParseMergeTreeOutput`, `preflight.go:178,244`) | §2.3 |
| Where the ade UI mounts | **P128's `ade` slot, as a full-area module.** The design has its own repo tab bar and resizable panel; the workbench left panel and tab strip would duplicate them. `ModeDef` gains a `layout: 'full'` variant (Part 3) | §2.2 |
| Mounting `git-ui` components (P131 overlap) | **None.** Changes tab and branch picker are ade's own, over `AdeService` data. P131 stays independent of P129 | §2.2 |
| Wire transport | **Wails bound `AdeService` plus push signals**, not the `gitstream` rpc contract. That contract (`@kira/git-ipc`) also serves the VS Code extension; ade calls are coarse snapshots, no streaming | §2.3 |
| Hooks on/off setting in Space | **Always on.** Space's ade needs activity; the design has no toggle. Start failure (curl missing, bind conflict) is logged, not fatal: sessions still spawn and track, activity icons stay absent | §4.3 |
| Agent-aware keep-awake reason for Space (P127 §2.8 left it to P129) | **Not added.** Neither the design nor the SPEC row asks for it | §4.8 |
| **user:** Claude Code icon asset (design §2.5: "official Claude Code icon asset") | Needs the asset file from the user (Anthropic brand asset, trademark, not a library license question). Blocks Part 5's agents pill | Part 5 |
| **user:** Jira title/status source ("Pasted links show `syncing` until the API fills title and status") | No Jira integration exists anywhere in the repo. Needs a user decision: Jira Cloud REST with a token in the OS keychain, or a CLI (the `gh` precedent), plus the base URL. Part 7 exists for it | Part 7 |
| **user:** `ready`, `ciFailing`, and the `Merge` action | Data model has `ready?`/`ciFailing?`; the mockup's `Merge` button is a no-op and §4 has no Merge template. Proposed default for the user to confirm: `ciFailing` = PR head's check runs failing, `ready` = PR approved and checks green and not behind, `Merge` = Claude dialog with a `Merge <branch>` template using only branch/worktree/PR number+URL | Part 2 (facts), Part 4 (template) |
| `claude --resume <id>` from a directory other than the session's original cwd (archived worktree deleted, design §2.4 "only offers `new worktree`") | Unverified against the CLI. Part 1 resumes in the recorded cwd when it exists; Part 8's planning pass probes the installed CLI and picks the fallback | §8 |

---

## 1. Confirmed current state

### 1.1 Shared agent monitoring (P127), unwired

| Symbol | File | State |
|---|---|---|
| `Manager` (`NewManager(Options{OnEvent})`, `Start`, `Stop`, `Status`, `ComposeLaunch(terminalID, command) (string, []string)`) | `internal/agenthooks/manager.go` | No caller since P127 step 6. `ComposeLaunch` appends ` --settings '<hooks.json>'` and returns the three hook env vars (`KIRA_TERMINAL_ID`, socket, token). Token must never cross a bound method |
| `Event{TerminalID, Event, SessionID, Cwd, ToolName, ToolUseID, NotificationType, Message, Source, Reason}` | `internal/agenthooks/agenthooks.go:35` | `tool_input` never decoded |
| `hookEvents` = SessionStart, SessionEnd, PreToolUse, PostToolUse, Notification, Stop | `internal/agenthooks/config.go:13` | No `UserPromptSubmit`. Listener accepts any `hook_event_name` (`http.go`, no allowlist) |
| `ChannelAgentSessions` `kira:agent:sessions`, `ChannelAgentEvent` `kira:agent:event` | `internal/appevent/appevent.go:77-78`; TS `CHANNEL.agentSessions`/`agentEvent` in `packages/shared/protocol/events.ts:60,63` | No Go emitter |
| `createAgentSessionsStore(control)` (`sessions`, `activity` Map by terminalId, `agentActivityFor`, `initAgentSessions`) | `packages/workbench/src/state/createAgentSessionsStore.ts` | No instance in either app |
| `reduceAgentActivity(prev, event)`; phases `idle`/`working`/`attention` | `packages/workbench/src/state/agentActivity.ts`; spec `agent-activity-reducer.spec.ts` | Every `Notification` means `attention`; `Stop` means `idle`; no wake/monitor notion; no timestamp |
| `AgentSession{terminalId, cwd}`, `AgentSessionsEvent`, `AgentEvent`, `AgentPhase`, `AgentActivity` | `packages/shared/domain/agent.ts` | Host declares its own Go wire struct (P127 §2.3: ~15 lines, Studio's deleted `AgentSessionWire`) |

### 1.2 Terminal spawn path (P128)

- `internal/terminal.BoundService.Open(OpenArgs)` (`bound.go:73`): `ValidateOpen`, then
  `Agent: args.LaunchKind == "claude-code"`, then `OpenWithCoalescedOutput(OpenParams{…})`. No
  `Env`, no command rewrite. Comment lines 77-80: "Space never sets Registry.OnChange, so Agent is
  inert there".
- `OpenParams.Env` (`session.go:262`) is appended to the session env; `Command` runs as
  `$SHELL -l -i -c Command`. `MaxCommandBytes` = 64 KiB, checked in `ValidateOpen` only.
- `Registry.OnChange` fires outside the mutex after an agent session registers (`Open`) and after
  one is removed (`remove`, after the map entry is gone: `session.go:289-294, 334, 391`).
  `Registry.AgentSessions()` lists live agent sessions `{ID, Cwd}` across windows. `Registry.Write`
  is a no-op for a dead id.
- Sessions are window-scoped: `Registry.CloseWindow(windowKey)` kills a window's PTYs.
- Studio precedent (`d20bc970`, deleted): `TerminalService.AgentHooks` optional collaborator;
  `Open` composed `command, env` only when `agent && AgentHooks != nil`; `AgentSessions()` bound
  hydrate; `TerminalAgentSessionsChanged` package func as the `OnChange` target, so the emitter
  never becomes a renderer-callable bound method.
- Frontend: `createTerminalsStore.openTerminalSession(tabId, codeRepoId, cwd, cols, rows, command,
  launchKind)` calls `terminalOpen`; `useTerminalMount` opens only on first mount;
  `terminalRenderer.getOrCreateTerminal(tabId)` keeps one xterm per id alive across remounts.
  `TerminalHostView` is prop-driven (`tab`, `deps`) with a default slot (P128 §1.9 kept it so for
  P129).

### 1.3 Kira Space wiring today

- `apps/kira-space/main.go:136`: `terminalSvc := &bridge.TerminalService{BoundService:
  &terminal.BoundService{Emit: emitter, Registry: terminal.NewRegistry()}}`. No `OnChange`, no
  hooks. Teardown (`sync.OnceFunc`) calls `terminalSvc.Shutdown()` before `repositories.Close()`
  and `db.Close()`.
- `internal/bridge/events.go`: Space-only channels (`ChannelGitPairing` …) plus `appevent`
  re-exports. `Events` wraps `appevent.Events`.
- Storage: migrations `0001_init.sql`, `0002_p100_tabs_layout.sql`, `0003_p128_window_mode.sql`;
  `repos.Repos` aggregate (`repos.go:19-51`); `_foreign_keys=1` (`sqlitex.go:49`); `code_repos.id
  TEXT PRIMARY KEY`.
- `internal/layering_test.go`: domain packages must not import `internal/bridge`.
- `github.com/google/uuid v1.6.0` already in `go.mod`.

### 1.4 Installed CLI (`claude` 2.1.283, `claude --help`)

- `claude [options] [prompt]`: positional prompt starts an interactive session with it.
- `--session-id <uuid>`: the caller picks the session id. `-r, --resume [value]`: resume by id.
- `--settings <file-or-json>`: extra settings (P86's hooks path).
- Tool names `Monitor` and `ScheduleWakeup` exist in the binary (a string match, nothing more).

### 1.5 Where the SPEC row and design disagree or stay silent

- Design scope line "UI only, mock data" versus the row's real spawning and `gitsession` reuse:
  §0, row governs.
- Design §3.1 names go-git: §0, declined with the requirement named.
- `ready`/`ciFailing`/Merge, Jira source, icon asset: §0 user rows.
- "The app knows every session ever started on this machine": only sessions this app launched
  carry hooks, so "every session" means every session Kira Space started. Part 1 persists them.

---

## 2. Whole-phase architecture (binding on Parts 2-8)

### 2.1 Behavior source

The design spec wins over the mockup; the mockup wins for markup structure, data flow and
interaction detail the spec leaves implicit (`renderVals()` ordering, cell layout, tooltip text,
`sendDialog()` templates). Visual tokens only are theme-adapted: design §7 colors and IBM Plex map
to `packages/theme` tokens (`--kira-*`, Tailwind utilities); tone tints (green/amber/red/blue/grey/
purple) and the 20-color work palette stay literal data values, since they encode meaning, not
theme. Every §9 "decision to keep" is a checklist item in each part's closing audit.

### 2.2 Frontend boundaries

- All ade code lives in `apps/kira-space/frontend/src/ade/`. Kira Studio reuses none of it, so
  nothing moves to `packages/shared` or `packages/workbench` except: `agent.ts`/`agentActivity.ts`
  (already shared, Part 1 extends them) and `ModeDef`'s `layout: 'full'` variant (Part 3).
- Module shape: `MODES.ade = { label, icon, layout: 'full', view: AdeView }` (Part 3). With
  `layout: 'full'`, Space's `WorkbenchShell.vue` hides the left panel and tab strip and renders
  `view` as the whole main area. `AdePanel.vue`/`AdeStart.vue` placeholders are deleted then.
  Studio's modes keep the default layout, no behavior change.
- No `git-ui`/`kira-ui` import anywhere in `src/ade/` (P131 independence; enforced by Part 8's
  closing audit).
- State: TanStack Query for everything fetched from `AdeService` (repo snapshot, sessions,
  candidates), invalidated by push signals. Pinia stores, one concern each: `adeUi` (selection,
  open tab, history-open, dialog state), plus the P127 agent store instance (`agentSessions`).
  Pure derivation in `useQueue()` (design §6), a plain function module ported from
  `renderVals()`, unit-tested (design §6 asks for it, and it is a large decision structure).
- Components: shadcn-vue from `packages/theme` (Dialog, Popover, Tabs, Tooltip, Button, Badge,
  Input, Textarea, NativeSelect, ToggleGroup, Command for the branch search, Resizable for the
  panel, Checkbox). Missing pieces added to `packages/theme` the shadcn-vue way: `switch` (force-
  push switch). Right-click menus use the workbench's existing `useContextMenuStore`. VueUse for
  wheel/resize/timers (`useNow` for "today" rollover and relative times, `useDebounceFn` for the
  history pull reset). Tailwind utilities only, no scoped `<style>`.
- Libraries (license checked per feature at install time, each part's plan records it):
  `vue-draggable-plus` (MIT) for drag; `@tiptap/vue-3` + `@tiptap/starter-kit` +
  `@tiptap/extension-task-list`/`task-item`/`link` (MIT core, no Pro extensions) and a Markdown
  serializer (`tiptap-markdown`, MIT, if it supports the installed TipTap major; otherwise
  TipTap's own MIT `@tiptap/markdown`); `@xterm/xterm` already present.
- Terminals: the Agents tab renders `TerminalHostView` with the session's `terminalId` as tab id
  and `launchKind: 'claude-code'`. Spawning goes through the unchanged `openTerminalSession`
  (§4.2), so the xterm keep-alive, drain queue and resize behavior are the shared module's own.

### 2.3 Backend boundaries

- New domain package `apps/kira-space/internal/ade/` (no `bridge` import): session tracker
  (Part 1), plan/meta/color/new-work persistence and git facts (Part 2). Bound surface
  `apps/kira-space/internal/bridge/ade.go` (`AdeService`), registered in `main.go`.
- Git reuse, never a parallel path: repos via `gitsession.Registry.Acquire`; worktree list via
  `RepoEntry.Worktrees`; worktree removal (Archive) via `RepoEntry.RunOp` `worktreeRemove` with
  its preflight; ahead/behind and stack parents via the existing stack config keys
  (`gitops.StackParentKey`/`StackBaseKey`) and `stack.list` machinery; fetch (Refresh) and force
  push via `RepoEntry.RunRemote` (`fetch`, `forcePush` with `pushPreflight`'s lease tip);
  conflict/overlap via `merge-tree --write-tree` and changed-path sets; PR data via
  `RepoEntry.ResolveBranchPr`; refs-moved via the entry's `repo.changed` subscription. Part 2's
  plan resolves how a non-rpc caller supplies credentials to `RunRemote` (today a nil `Conn`
  means credential-free, `autofetch.go:163`).
- Only Force push, Refresh (fetch) and Archive's worktree removal mutate git from the app. Every
  other git change is a Claude message (design §3/§4).
- Push signals: `kira:ade:sessions` (Part 1) and `kira:ade:repo` (Part 2), payload-free or
  `{codeRepoId}`, each only invalidating a query.

### 2.4 Data model

Design §6 maps onto wire types (Go structs with json tags, mirrored in
`apps/kira-space/frontend/src/ade/wire.ts`, `trust<T>()`ed like every bound result) and tables:

| Design type | Source of truth | Part |
|---|---|---|
| `Session` | `ade_sessions` table plus live activity from the P127 store | 1 |
| `Branch` git facts (`ahead`, `behind`, `files`, `commits`, `dirty`, `merged`, worktree, owner, author) | Computed per snapshot from `gitsession` | 2 |
| `Branch.kind`, `archivedAt`, `est`, names, links, notes (`UserMeta`) | `ade_branches` (per repo+branch meta) | 2 |
| `Branch.pr` | `ResolveBranchPr` | 2 |
| `Branch.jira` title/status | Part 7's source | 7 |
| `CandidateBranch` | `for-each-ref` over local/remote heads not in the queue | 2 |
| `NewWork` | `ade_new_work` | 2 |
| `RepoPlan` (`day`, `order`, `queuedAfter`, `unpushed`) | `ade_plan` rows per repo; `queuedAfter` stored as ade's own override, not git stack config (a rebase target the user chose must not rewrite `git config` before Claude has rebased) | 2 |
| `ColorMap` | `ade_colors` (repo, branch, slot), assigned once, never reassigned | 2 |
| `UiPrefs` | Space settings leaves `ade.*` (global); autofetch maps to the existing per-repo fetch interval; `historyOpen` runtime only (design: resets per repo tab) | 2 |
| Conflicts, shares, behind | Backend facts (§3.1 of the design), consumed by `useQueue` | 2 |
| Stacks, segments, ripple, statuses, tags, positions, titles, day totals | `useQueue()` | 3 |

Branch identity: `(codeRepoId, branch name)`. Kira Space's imported repos (`code_repos`) are the
ade's repo tabs. Days are ISO dates (design §5.10), "today" the local date.

### 2.5 Coverage map, design section to part

| Design | Part |
|---|---|
| §1 concepts, §6 data model | 2 (persisted, git facts), 3 (derived) |
| §2.0 activity icons | 3 (component, tab counts), used by 4-8 |
| §2.1 repo tab bar (repo tabs, needs-input counts) | 3; pinned `All agents` tab 8 |
| §2.2 All agents view | 8 |
| §2.3 project header, fetch status, Refresh, `main` line, Rebase all | 3 |
| §2.3 Add popover, timeline, history pull, overdue, days, weekends, capacity/overflow, Later, day off, drop targets, splitting, multi-day, work colors, review/merged/parked rows, action column, stack box, agents pill | 5 |
| §2.4 detail panel (header, archive safety, Details, Changes, Agents) | 6 |
| §2.5 icon | 5 (first consumer) |
| §3 rules, §5 ordering | 3 (`useQueue`), 2 (facts) |
| §3 push/force push | 2 (backend), 5/6 (buttons) |
| §3.1 conflict computation | 2 |
| §4 Claude Code dialog, archive-at-risk dialog | 4 |
| §7 visual tokens | every UI part (3-8) |
| §8 libraries | 5 (drag), 6 (TipTap, xterm) |
| §9 decisions to keep | every UI part's audit; 8 re-checks all |
| Agent spawn, tracking, session persistence, activity | 1 |
| Jira sync | 7 |
| Screen-by-screen live comparison against `mockup.html` (the row's acceptance) | 8 |

---

## 3. Split decision: eight parts, strict order

One pass cannot hold this: a Go runtime, a Go git-facts engine, a ~1,000-line derivation port,
two dialogs, a timeline with drag and drop, a rich-text panel and a second view. Each part is one
sequential Sonnet implementer; no part runs concurrently with another (each builds on the last).
Parts are ordered so every new export has a consumer in the same part (`knip`'s `lint:dead`
fails otherwise), which is why frontend wiring for Part 1's backend lands in Part 3, not here.

| Part | Scope | Depends on |
|---|---|---|
| 1 | Agent runtime: hooks wired in Space, launch composition, session tracker and table, `AdeService` session surface, reducer `waiting` extension | P127, P128 |
| 2 | Queue backend: ade tables, repo snapshot git facts, conflicts/shares/behind/merged, candidates, PR data, Refresh, Force push, Archive with at-risk check, `kira:ade:repo` | 1 |
| 3 | `useQueue()` port with unit tests; ade data layer (queries, `adeUi` store, agent store instance); `layout: 'full'` module; repo tab bar; project header; `main` line; activity icons | 2 |
| 4 | Claude Code dialog (all templates, targets, worktree choice, busy check and override, force-push switch, Reset) and archive-at-risk dialog; send/launch through Part 1 | 3 |
| 5 | Timeline and stack boxes: days, history, capacity, day off, action column, drag and drop, Add popover, Claude Code icon | 4 |
| 6 | Detail panel: header actions, Details (TipTap notes, links, estimate), Changes, Agents (terminals, status strip, Stopped list), resizable | 5 |
| 7 | Jira link sync | 6, user answer |
| 8 | All agents view and pinned tab; cross-window Open; closing screen-by-screen comparison against `mockup.html` | 7 |

---

## 4. Part 1 scope

### 4.1 Shared terminal seam: `BoundService.ComposeAgent`

`internal/terminal/bound.go`:

```go
// ComposeAgent, when set, rewrites a claude-code launch's command and supplies extra env before
// spawn. Kira Space sets it (P129); Kira Studio leaves it nil, so its Open is unchanged.
ComposeAgent func(terminalID, command string) (string, []string, error)
```

`Open`: after `ValidateOpen`, when `agent && b.ComposeAgent != nil`, call it; an error returns
`ipcerr.New("E_INVALID", err.Error())`; recheck `len(command) > MaxCommandBytes` after composing
(same E_INVALID message as `ValidateOpen`). Pass `Env: env`. A func field is not a method, so
Wails binds nothing new (FQN gate, §6). Rewrite `bound.go:77-80` and Space
`bridge/terminal.go`'s "Agent is inert" comments, both stale after this part.

### 4.2 Launch flow (renderer drives the PTY, Go owns the command)

1. Renderer calls `AdeService.PrepareLaunch(args)`; Go validates, records a pending intent keyed
   by a fresh `terminalId`, returns `{terminalId, sessionId, command}`.
2. Renderer mounts `TerminalHostView` for `terminalId` with `command` and `launchKind:
   'claude-code'`; `useTerminalMount` calls the unchanged `openTerminalSession`.
3. `TerminalService.Open` calls `ComposeAgent` = `Tracker.Compose`, which consumes the intent,
   requires the renderer's `command` to equal the prepared one, appends hooks
   (`Manager.ComposeLaunch`) and then the quoted prompt, inserts or revives the session record as
   `running`, and returns the env.
4. `Registry.OnChange` (spawn and exit) runs `Tracker.Reconcile` and emits
   `ChannelAgentSessions`; the tracker emits `kira:ade:sessions` when records changed.
5. Hook events reach `Tracker.HandleEvent` and are emitted on `ChannelAgentEvent`.

Why not spawn from Go directly: the renderer's terminal store would not know the session, and
`useTerminalMount` would open a second PTY on first mount. The renderer path reuses the shared
module unchanged.

Command shapes (`internal/ade/command.go`):

- New: `claude --session-id <uuid>`; the app picks the Claude session id up front (§1.4), so no
  SessionStart round trip is needed to learn it.
- Resume: `claude --resume <claudeSessionId>`.
- Composed: `<command> --settings '<hooks.json>' '<prompt>'` (prompt last, omitted when empty).
- `quotePOSIX(s)`: `'` + `strings.ReplaceAll(s, "'", `'\''`) + `'`. Newlines stay literal inside
  single quotes, which `$SHELL -l -i -c` accepts. Trivial, so hand-rolled, not a library.

### 4.3 Space wiring (`apps/kira-space/main.go`)

- `registry := terminal.NewRegistry()`, shared by `TerminalService` and the tracker.
- `tracker := ade.NewTracker(ade.TrackerDeps{Store: repositories.AdeSessions, LiveAgents:
  registry.AgentSessions, WriteTerminal: registry.Write, Now: time.Now, OnChange: func() {
  bridge.AdeSessionsChanged(events) }})`; `tracker.Recover()` marks rows left `running` by a
  previous process as `stopped` (PTYs never outlive the app).
- `hooks := agenthooks.NewManager(agenthooks.Options{OnEvent: func(ev agenthooks.Event) {
  tracker.HandleEvent(ev); bridge.EmitAgentEvent(emitter, ev) }})`; `hooks.Start()` error logged
  with `slog.Warn`, never fatal. `tracker.SetHooks(hooks.ComposeLaunch)` before any window exists.
- `terminal.BoundService{…, ComposeAgent: tracker.Compose}`.
- `registry.OnChange = func() { tracker.Reconcile(); bridge.AgentSessionsChanged(adeSvc) }`.
- `adeSvc := &bridge.AdeService{Tracker: tracker, Registry: registry}` registered as a Wails
  service.
- Teardown order: `terminalSvc.Shutdown()` (PTYs die, `OnChange` marks rows stopped while the DB
  is open), `tracker.Close()` (flushes last-active times), `hooks.Stop()`, then the existing
  `repositories.Close()`/`db.Close()`.

### 4.4 Session tracker (`apps/kira-space/internal/ade/tracker.go`)

State under one mutex: `pending` (intents by terminalId, from `PrepareLaunch`, dropped after
2 minutes unused), `live` (terminalId to record id, from `Compose`), `spawnedAt` (grace window),
`lastActive` (record id to unix ms, flushed on Stop/SessionEnd/stop/`Close`).

| Method | Rule |
|---|---|
| `Prepare(args)` | Validate (§4.6). New: fresh record id and Claude session id (`uuid.NewString()`). Resume: record must exist, belong to `codeRepoId`, be `stopped`; reuses its Claude session id and record id. Store intent; return `{terminalId, sessionId, command}` |
| `Compose(terminalID, command)` | Intent found: `command` must equal intent's command, else error. Insert (new) or revive (resume) the record: `state='running'`, `terminal_id`, `last_active_at=now`. Remember `spawnedAt`; schedule one `Reconcile` after a 30 s grace (`time.AfterFunc`). Return `hooks(terminalID, command)` plus quoted prompt. No intent (a claude-code launch not from ade; Space has none today): hooks only, no record |
| `Reconcile()` | Read `LiveAgents()`. A `running` record whose terminal is not live and is past its grace: `stopped`, `terminal_id NULL`, flush last-active. Emit `OnChange` when anything changed. Idempotent; safe from any goroutine |
| `HandleEvent(ev)` | Unknown terminal: ignore. Bump `lastActive`. `SessionStart` with a different `SessionID` (after `/clear`): update `claude_session_id`, emit `OnChange`. `Stop`/`SessionEnd`: flush `lastActive` |
| `Send(sessionID, message)` | Record `running` and terminal live, else `E_INVALID`. Write bracketed paste then `\r` as two `WriteTerminal` calls (§4.5) |
| `List()` | All rows, newest `last_active_at` first, with in-memory `lastActive` overriding the stored value |
| `Recover()` / `Close()` | Startup stop-all; shutdown flush |

The grace window exists because `Compose` runs before the PTY is registered: a record inserted at
compose time must not be stopped by a `Reconcile` that races the spawn. A spawn that fails after
`Compose` converges to `stopped` within 30 s, so every launch the user pressed leaves a record.

### 4.5 Forwarding a message to a running session

Design §4: "exactly one running session: the message is forwarded to it". Bytes:
`ESC[200~` + message + `ESC[201~`, then `\r`. The message is normalized first: CRLF to LF, and
any embedded `ESC[201~` removed, so text cannot end the paste early. Whether Claude Code's TUI
needs a pause between the paste end and `\r` is unverified (§8); the second write is separate so
a delay can be added without restructuring.

### 4.6 Bound surface (`apps/kira-space/internal/bridge/ade.go`)

```go
type AdeService struct {
	Tracker  *ade.Tracker
	Registry *terminal.Registry
}

func (s *AdeService) AgentSessions() AgentSessionsEvent            // P127 store hydrate
func (s *AdeService) Sessions() AdeSessionsResult                  // every recorded session
func (s *AdeService) PrepareLaunch(args AdePrepareLaunchArgs) (AdePrepareLaunchResult, error)
func (s *AdeService) Send(args AdeSendArgs) error

// Package funcs, never bound (Studio's TerminalAgentSessionsChanged precedent):
func AgentSessionsChanged(s *AdeService)                 // Emit ChannelAgentSessions
func EmitAgentEvent(e appevent.Emitter, ev agenthooks.Event) // Emit ChannelAgentEvent
func AdeSessionsChanged(ev *Events)                      // Emit ChannelAdeSessions, nil payload
```

Wire types (json tags camelCase):

- `AgentSessionWire{terminalId, cwd}`, `AgentSessionsEvent{sessions}`: `agent.ts`'s contract.
- `AdeSessionWire{id, claudeSessionId, codeRepoId, branch, newWorkId, cwd, state, terminalId,
  startedAt, lastActiveAt}` (`state`: `running`/`stopped`; times unix ms; `terminalId` `""` when
  stopped).
- `AdePrepareLaunchArgs{codeRepoId, branch, newWorkId, cwd, resume, message}`: exactly one of
  `branch`/`newWorkId`; `codeRepoId` exists (`Repos.CodeRepos.Get`); `cwd` absolute existing
  directory; `resume` `""` or a record id; `branch` has no NUL/newline and ≤ 255 bytes; `message`
  ≤ 32 KiB.
- `AdePrepareLaunchResult{terminalId, sessionId, command}`; `AdeSendArgs{sessionId, message}`
  (`message` non-empty, ≤ 32 KiB).
- Errors via `ipcerr` (`E_INVALID` for validation, `InternalErr` otherwise).

`ChannelAdeSessions = "kira:ade:sessions"` lives in Space `bridge/events.go` (Space-only). Its TS
`CHANNEL` entry lands in Part 3 with its first consumer.

New-work binding (`newWorkId`) is opaque here: Part 2 creates `ade_new_work` and adds the rebind
(new work becomes a branch once Claude creates it); Part 1 only stores the id.

### 4.7 Storage

`apps/kira-space/internal/storage/migrations/0004_p129_ade_sessions.sql`:

```sql
CREATE TABLE ade_sessions (
  id                TEXT PRIMARY KEY,
  code_repo_id      TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  branch            TEXT NOT NULL DEFAULT '',
  new_work_id       TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT NOT NULL,
  cwd               TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('running', 'stopped')),
  terminal_id       TEXT,
  started_at        INTEGER NOT NULL,
  last_active_at    INTEGER NOT NULL,
  CHECK ((branch = '') <> (new_work_id = ''))
);
CREATE INDEX ade_sessions_repo ON ade_sessions (code_repo_id);
```

Times are unix ms (activity times, compared numerically; `git_clients`' own convention). Model
`storage/model/adesession.go`; repo `storage/repos/adesessions.go` (`Insert`, `MarkRunning`,
`MarkStopped`, `SetClaudeSessionID`, `SetLastActive`, `StopAllRunning`, `Get`, `List`), added to
`repos.Repos`. Removing a code repo cascades its sessions.

### 4.8 Reducer: `waiting`, timestamps, `UserPromptSubmit`

`internal/agenthooks/config.go`: add `"UserPromptSubmit"` to `hookEvents` (a new user turn is
the one reliable "working" start for a text-only reply). Update the event list comments in
`config.go`, `agenthooks.go` and `agent.ts`.

`packages/shared/domain/agent.ts`: `AgentPhase = 'idle' | 'working' | 'attention' | 'waiting'`;
`AgentActivity` gains `wakeArmed: boolean` and `at: number` (ms, receipt time).

`reduceAgentActivity(prev, event, now)` (`now` injected, keeps it pure; the store passes
`Date.now()`):

| Event | Next |
|---|---|
| `SessionStart` | Reset, `at = now` |
| `UserPromptSubmit` | `working`, `message: null`, `wakeArmed: false` |
| `PreToolUse` | `working`, as today; `toolName` in `WAKE_TOOLS` (`Monitor`, `ScheduleWakeup`) sets `wakeArmed` |
| `PostToolUse` | As today; `attention` becomes `working` (the prompt was answered and the tool ran) |
| `Notification` | `notificationType` `idle_prompt` or `auth_success`: phase unchanged (an idle session is not "needs input", design §1). Anything else: `attention`, as today |
| `Stop` | `wakeArmed ? 'waiting' : 'idle'`, then clears as today, `wakeArmed: false` |
| every event | `at = now` |

Design mapping (done in Part 3's UI, not in the shared type): `attention` is `needs input`,
`waiting` is `waiting on monitor`. A `Bash` background run cannot arm `waiting`, since
`tool_input` is never decoded (P86's privacy rule); recorded in `docs/ARCHITECTURE.md` as a known
limitation. The `idle_prompt`/`auth_success` values come from Claude Code's hooks reference; the
implementer confirms them there (documentation, not the binary) before step 6.

### 4.9 Out of Part 1, confirmed not forgotten

Everything in §2.5 not assigned to Part 1. Specifically: renderer wiring (control methods, agent
store instance, sessions query, `CHANNEL.adeSessions`) lands in Part 3 with its first consumer;
new-work rebind in Part 2; cross-window Open in Part 8; resume fallback when the cwd is gone in
Part 8.

---

## 5. Steps and commits

Every commit passes the pre-commit hook (`bun run lint`, `bun run typecheck`) and
`go build ./...`. Record `P129_START=$(git rev-parse HEAD)` and save Space's generated
`bindings/**/internal/bridge/terminalservice.ts` `ByName` lines before step 1. Regenerate bindings
after each Go step that touches a bound type (`wails3 generate bindings`, per
`docs/DEV_ENVIRONMENT.md`).

The `SPEC.md` split into eight part rows landed with this plan's own commit; no step for it.

1. **`feat(terminal): optional agent launch composition seam`** — §4.1. Studio's `main.go`
   unchanged (field nil). No dedicated test: a nil check plus a pass-through; step 5's
   integration test exercises the composed command and env end to end.
2. **`feat(agenthooks): hook UserPromptSubmit`** — §4.8's Go half.
3. **`feat(space): ade session storage`** — migration `0004`, model, repo, `repos.Repos` field.
4. **`feat(space): ade session tracker`** — `internal/ade/{tracker.go,command.go,paste.go}` plus
   `tracker_test.go` (§6.1).
5. **`feat(space): spawn and track Claude Code sessions`** — `bridge/ade.go`, `bridge/events.go`
   channel, `main.go` wiring and teardown (§4.3), `bridge/terminal.go` comment. Regenerate; FQN
   gate. Integration test (§6.1).
6. **`feat(workbench): waiting-on-monitor activity and event timestamps`** — §4.8's TS half,
   `createAgentSessionsStore` passes `Date.now()`, spec extended.
7. **`docs: ARCHITECTURE records Kira Space's agent runtime (P129 Part 1)`** — §5.2.
8. Result section in `docs/v2.0/SPEC.md` (`## P129 Part 1 result`), per chapter convention.

### 5.1 File inventory

New: `apps/kira-space/internal/ade/{tracker.go,command.go,paste.go,tracker_test.go,command_test.go}`,
`apps/kira-space/internal/bridge/ade_test.go`,
`apps/kira-space/internal/bridge/ade.go`,
`apps/kira-space/internal/storage/migrations/0004_p129_ade_sessions.sql`,
`apps/kira-space/internal/storage/model/adesession.go`,
`apps/kira-space/internal/storage/repos/adesessions.go`.

Edited: `internal/terminal/bound.go`, `internal/agenthooks/{config.go,
agenthooks.go}`, `apps/kira-space/main.go`, `apps/kira-space/internal/bridge/{events.go,
terminal.go}`, `apps/kira-space/internal/storage/repos/repos.go`,
`packages/shared/domain/agent.ts`, `packages/workbench/src/state/{agentActivity.ts,
createAgentSessionsStore.ts,agent-activity-reducer.spec.ts}`, generated Space bindings,
`docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`.

Blast radius (`codegraph_explore`): `BoundService.Open` is reached only through both apps'
`TerminalService`; `reduceAgentActivity` has one caller (`applyEvent`) plus its spec;
`createAgentSessionsStore` has no instance; `hookEvents` is read only by `buildHooksDocument`.
Kira Studio's behavior cannot change: its `ComposeAgent` stays nil and it has no agent store.

### 5.2 `docs/ARCHITECTURE.md`

- Kira Space section: ade agent runtime (launch flow §4.2, tracker, `ade_sessions`, hooks always
  on, window-scoped PTYs so closing a window stops its sessions).
- Shared agent monitoring section: Space is now the consumer; `UserPromptSubmit`; `waiting` phase
  and its `Monitor`/`ScheduleWakeup` rule.
- Known open items: replace "package unwired from Kira Space's UI" with "wired in Go; ade UI
  lands in P129 Parts 3-8" (removed entirely by Part 8); add the `Bash` background limitation.
- Remove the "Agent is inert in Space" statement if ARCHITECTURE carries it.

---

## 6. Verification

Measure `test:unit`, `test:ui:space`, `test:ui:studio`, `go test` at `P129_START` first.

| Command | Expected |
|---|---|
| `go build ./...`, `go vet ./...`, `bun run lint:go` | Clean |
| `go test ./internal/terminal/ ./internal/agenthooks/ ./apps/kira-space/internal/... ./apps/kira-studio/internal/...` | Pass; Space layering test passes, exemption set unchanged |
| FQN gate on Space `terminalservice.ts` | Identical to the saved list |
| Space bindings gain `adeservice.ts` | Exactly `AgentSessions`, `Sessions`, `PrepareLaunch`, `Send` |
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `bun run test:unit` | Baseline plus the reducer cases |
| `bun run test:ui:space`, `test:ui:studio` | Baseline unchanged (no UI change in Part 1) |

### 6.1 Tests (per `CLAUDE.md`'s bar)

- `internal/ade/tracker_test.go` earns its place: interacting rules (pending, grace, resume,
  `/clear` rebinding, recovery) under concurrent callers. Cases: prepare, compose, reconcile live,
  exit, stopped; compose with a mismatched command refused; a spawn that never registers is
  stopped after the grace (inject a short grace); resume of a running or foreign-repo record
  refused; `SessionStart` with a new id updates `claude_session_id`; `Recover` stops leftovers;
  `-race` run of `Compose`/`Reconcile`/`HandleEvent` from separate goroutines. Uses a real
  `ade_sessions` table over `storage.OpenAt(t.TempDir())`.
- `quotePOSIX` table test (quotes, newlines, `$`, backslash, empty): one test, a quoting edge case
  set, run through `sh -c 'printf %s …'` to prove round-trip.
- Integration, `apps/kira-space/internal/bridge/ade_test.go`: real `Registry`, real
  `agenthooks.Manager`, a fake `claude` script first on `PATH` that curls the hook shim
  (`SessionStart` with its `--session-id`, then `Stop`) and exits. Asserts: record `running`
  after spawn with the prepared Claude id, `ChannelAgentEvent` and `ChannelAgentSessions`
  emitted, record `stopped` after exit, the token never appears in any bound result.
- Reducer spec: `UserPromptSubmit`; `Monitor` then `Stop` gives `waiting`; next `PreToolUse`
  gives `working`; `idle_prompt` keeps phase; `PostToolUse` clears `attention`; `at` set.
- No test for the repo CRUD, the wire structs or `AgentSessions()` (pass-throughs).

### 6.2 Live run

Kira Space runs in server mode here (`go build -tags server`, `docs/DEV_ENVIRONMENT.md`), which
serves the real bound surface without a display. With the installed CLI (2.1.283): call
`PrepareLaunch`, then `TerminalService.Open` with the returned command, confirm a `SessionStart`
event arrives carrying the prepared Claude session id and the record reads `running`; close the
terminal; the record reads `stopped`. No prompt is submitted, so no model call is made. If the
CLI cannot start unauthenticated in this container, say so in the result section and rely on the
fake-CLI integration test. Not checked, no display: xterm rendering of the session (Part 6 has
the first UI) and the bracketed-paste-then-Enter behavior in the real TUI (§8).

---

## 7. Closing audit

Account for every hit.

| Check | Command | Pass |
|---|---|---|
| Token never bound | `rg -n 'KIRA_AGENT_HOOK\|Env' apps/kira-space/internal/bridge/ade.go` | No bound method or wire struct carries env or token; integration test asserts it |
| Studio untouched in behavior | `git diff --stat $P129_START -- apps/kira-studio` | Empty (bindings unchanged) |
| Seam used by Space only | `rg -n 'ComposeAgent' apps internal` | `bound.go` and Space `main.go` only |
| One spawn path | `rg -n 'OpenWithCoalescedOutput\|Registry\.Open\(' apps/kira-space` | Empty (Space spawns only via `TerminalService.Open`) |
| Domain does not import bridge | Space `layering_test.go` | Pass |
| Stale "inert" comments gone | `rg -n 'inert' internal/terminal apps/kira-space/internal/bridge docs/ARCHITECTURE.md` | No claim that Agent is inert in Space |
| No renderer scaffolding | `git diff --stat $P129_START -- apps/kira-space/frontend/src` | Empty except generated bindings |
| Reducer consumers compile | `bun run typecheck` | Clean |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Claude Code's TUI treats `\r` right after the paste end as part of the paste | Two separate writes (§4.5); the first real-TUI check (Part 4, sending to a running session) adds a short delay in `Send` if needed, as a fix commit there |
| `claude --resume <id>` fails outside the session's original cwd | Part 1 always resumes in the recorded cwd. Part 8 (archived sessions, `new worktree`) probes and decides |
| Composed command exceeds 64 KiB | Rechecked after composing; message capped at 32 KiB |
| `OnChange` ordering: exit notification processed before spawn notification | `Reconcile` reads the live set itself each call, and the grace window covers the spawn race (§4.4) |
| Hooks listener fails to start | Logged; sessions still spawn and persist; activity absent. Part 3 decides whether to surface it |
| `UserPromptSubmit` adds one curl per user prompt | Negligible next to per-tool hooks |
| Closing a window kills its sessions (window-scoped PTYs) | Documented (§5.2); the record reads `stopped`, resumable. Changing PTY scope is out of this phase |
| P132 edits Space `main.go`/`bridge/events.go` later | Default `P` order puts P132 after all P129 parts |
