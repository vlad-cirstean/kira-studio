# P148 plan: ADE v2 wave 5 — v1 backend removal ‖ dialogs, Sessions, Take over, Needs you, archive UI

Serial step 0, then two streams in one `P`. Stream A (v1 removal, Go plus bridge glue) and Stream B
(frontend) in separate worktrees off one base. Implements preplan §4 P148, the `SPEC.md` P148 row
(everything moved into it: M1, U1 (a), headless-sources draft binding), P147 §8 carry-forward, and
the P147 `DEV_ENVIRONMENT.md` finding. Nothing from P149+.

Inputs: `SPEC.md` P148 row, P145-P147 results; `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P148,
§5 matrix, §6 D1-D16); `plans/P143-wire-contract.md` (frozen; 47 methods, 9 channels);
`plans/P146-*`, `plans/P147-*` (R-decisions, `## Result`, stream notes); `design/ade-v2/SPEC2.md`,
`mockup.html` (views `plan`, `needs`, `agents`, panel Sessions tab, dialogs, fix menu);
`git show 13e99974:apps/kira-space/frontend/src/ade/{AdeClaudeDialog.vue,dialogCompose.ts,dialogFlow.ts,launch.ts,turnWatch.ts}`;
`docs/ARCHITECTURE.md` Known open items; `docs/DEV_ENVIRONMENT.md` server-tag recipe. Base `B0`:
`v2.0` tip after step 0 lands (current tip `b9bd8c1f`).

**Status: done** (see `## Result`). No open preplan item (O2-O5 resolved). Gaps found here resolved with the
recommended option (R-table).

## 0. Findings from the current tree

Backend (v1, all still bound):
- `bridge/ade.go` (1561 lines): `AdeService` with 19+ v1 methods (`PrepareLaunch`, `Send`, `Sessions`,
  `FocusSession`, `RepoSnapshot`, `RepoPrs`, `Refresh`, `ForcePush`, `ArchiveRisk`, `Archive`,
  `AddBranch`, `AddNewWork`, `UpdateNewWork`, `SetBranchMeta`, `SetWorkType`, `SetPlan`,
  `SetQueuedAfter`, `BindNewWork`, dependencies, `ProvideCredential`, `CandidateBranches`) plus
  `AgentSessions()` — the P127 agent-monitor hydrate, **not v1**: `terminalAgentSessions` in
  `bridge/index.ts` and `createAgentSessionsStore` (`ade/state/agentSessions.ts`, `main.ts`) call it.
  Same file holds helpers v2 uses: `AgentSessionWire`, `AgentSessionsEvent`, `toWireAgentSessions`,
  `AgentSessionsChanged`, `EmitAgentEvent`, `adeMaxMessageBytes`, `adeMaxBranchBytes`,
  `validateAde{BranchName,Est,ISODate,ItemID,Jira,Name,Notes,URL}` (all called from `adetask.go`).
- `bridge/events.go`: `ChannelAdeSessions`, `ChannelAdeRepo`, `ChannelAdeCredential`, plus
  `AdeRepoChanged`/`AdeCredentialRequested`; `bridge/ade.go`: `ChannelAdeOpenSession`. TS keys
  `adeSessions`, `adeRepo`, `adeCredential`, `adeOpenSession` in `packages/shared/protocol/events.ts`.
- `internal/ade/queue.go` (1825 lines) + `facts.go`: v2 still uses `repoCaches`/`newRepoCaches`/LRU
  key types, `resolveQueuedRef`/`resolvedRef`, `dirtyCode`/`toDirtyEntries`, `resolveKind`,
  `mainDisplay`, `findRemoteRow`, `rangeFacts`, `computePairFacts`, `computeAncestry`, `filesSet`,
  `forcePushRemote`, types `DirtyEntry`, `Commit`, `Jira`, const `adeRepoChangedDebounce`; from
  `facts.go` `pairFacts` (+`orderPair`, `sharedFiles`, `intersectSorted`, `pairItem`, `pair`),
  `mergedRule`, `atRisk`/`atRiskInput`/`atRiskResult`. v1-only: `Queue` and all its methods,
  snapshot/new-work/dependency/plan/color/history builders, `inferParents`, `breakCycleFrom`,
  `rebindCandidates`, `colorSlot`, `toFileDeltas`, `toCommits`, `SessionRef`, `QueueDeps`, every v1
  fact type (`BranchFact`, `RepoSnapshot`, ...).
- `internal/gitsession/queuefacts.go`: `StackParents` and `ReflogCreatedAt` have only v1 callers.
- `tracker.go`: `PrepareArgs`/`pendingIntent` carry v1 `CodeRepoID`/`Branch`/`NewWorkID`; `Prepare`
  has a v1 branch (resume recreates a missing cwd); `List`/`ListByRepo`/`Recover` are v1
  (`AdeSessionsRepo.List`/`ListByRepo`/`StopAllRunning`/`Insert` filter `task_id = ''`).
  `TaskBoard.Recover` already stops v2 rows.
- Storage: `repos/adequeue.go`, `model/adequeue.go`, `Repos.AdeQueue`; tables `ade_branches`,
  `ade_new_work`, `ade_plan`, `ade_colors` (0005), `ade_dependencies`, `ade_blockers` (0006),
  `work_type` columns (0007). `ade_sessions` (0010) keeps v1 columns `code_repo_id`, `branch`,
  `new_work_id` and a two-arm CHECK. No migration test exists.
- `main.go`: `wireAde` builds Tracker, agent hooks **and** `Queue`; `shutdownAde` closes the queue;
  `adeSessionsFor`, `adeCodeRepoLookup` are queue-only; `AdeService` registered and given
  `FocusWindow`; `Registry.OnChange` calls `AgentSessionsChanged(adeSvc)`.
- Tests: `bridge/ade_test.go` (v1 spawn), `ade/queue_test.go` (v1 snapshot, refresh, force push,
  archive, rebind, dependencies, work type, concurrency, `TestMainDisplay`), `facts_test.go` (v1
  `inferParents`, `rebindCandidates`, `colorSlot` cases beside kept `pairFacts`/`mergedRule`/`atRisk`),
  `tracker_test.go` (most cases v1-shaped `PrepareArgs`). v2 has no `TaskBoard.ForcePush` test.
- Comments naming `AdeService` in root `internal/terminal/session.go:413`, `internal/shell/registry.go:68`,
  `docs/DEV_ENVIRONMENT.md` (live-check paragraph).

Frontend:
- v1 frontend views are gone (P145). Left: `ade/wire.ts` (v1 types, imported only by
  `bridge/index.ts`), v1 `ade*` entries in `bridge/index.ts` (+ `@bindings/adeservice.js` import,
  `normalizeAdeRepoPrs`/`normalizeAdeArchiveRisk`), `main.ts` comment naming `kira:ade:*` channels.
- No frontend caller for `adeTask{ArchiveRisk,ArchiveTask,FocusSession,LaunchStage,RecordMerge,Send,
  Sessions,SetQueuedAfter,StartBranch,StopRun,TakeOver}`, `onAdeTaskOpenSession`, `onAdeTaskSessions`.
- `useTaskAction` renders only `run|approve|retry|done|finish` (P147 R22). `AdeActionCell` renders
  Force push and See error only: `rebase`, `queueAfter`, `start` branch actions exist in
  `board/actions.ts` but render nothing. `buildCard` passes `sessions: []`; `buildNeedsYou` gets
  `sessions: []` and reads TUI `activity` from the wire, which is always `''` for TUI (contract:
  TUI activity comes from agent events by `terminalId`). Stuck script runs (no session) map to
  `Take over`.
- Panel: tabs `Task` · `Notes` (branch: `Details` · `Changes`); no Sessions tab; `Merged into` rows
  without Merge / Re-merge; stale chip tooltip lacks `Right-click to re-merge.` (P146 R5 dropped it).
- Shell tabs: `Backlog` · `Plan` · right `Workflows` · `Repos`; no `Needs you`.
- History rows per task with repos render already (`AdePlanView` `bandHistory`, P145).
- Point-anchored menus use the shared `@workbench/state/contextMenu` store and
  `@workbench/components/ContextMenu.vue` (reka/shadcn `DropdownMenu`, P104 §5), already used for the
  plan's day menu. No shadcn `context-menu` primitive in `packages/theme`.
- Terminals: `useTerminalsStore().openTerminalSession(tabId, codeRepoId, cwd, cols, rows, command,
  'claude-code')`; `TerminalHostView` with `useTerminalModule().host` deps renders one (provided in
  `App.vue`).
- Settings: `workbench/SettingsDialog.vue` drafts `appearance|advanced|git` only;
  `workbench/settings/AdvancedPane.vue` writes `ade.headlessSettingSources` immediately;
  `settings/types.ts` `SettingsSections` is that 3-section `Pick`.
- `knip` dry run without the two `ade/v2` entries (this pass, scratch config): 12 unused exports and
  21 unused exported types, all in `ade/v2/board/*.ts` and `ade/v2/wire.ts` (`ARCHIVE_TIP`,
  `BLOCKED_PANEL_TEXT`, `NeedsItem`, `BranchAction`, `BranchRisk`, `DirtyEntry`, `MergedInto`,
  `RepoState`, `RepoPrs`, `WorktreeSetup`, `PR`, `FileChange`, `Commit`, `RemoteOpError`, calendar /
  timeline / progress internals...). Nothing else.
- `docs/ARCHITECTURE.md` Known open items: "Run held behind a failed worktree setup keeps note
  `waiting…`" is stale — P147 R10 fixed it (`setup.go:354`, `recover.go:32` call `setPendingNote`).

## 0.1 Coverage (SPEC2 slice of P148 → where)

| SPEC2 § / source | Item | Here |
|---|---|---|
| §3 | `Needs you` tab (amber badge) | B §4.8 |
| §4.1 | `!` click targets (stuck → Take over; question → its terminal) | B §4.6 |
| §4.2 | Task action `Take over`, `▶ <Stage>`, Archive (R22 leftovers) | B §4.6, §4.7 |
| §4.2 | Branch `Rebase`, `Queue after`, `▶ Start` buttons | B §4.3, §4.6 |
| §5 | User stage dialog with prompt + context (`LaunchStage`) | B §4.6 (R16) |
| §5 / D3 | Take over everywhere, confirm when the run is live, `TUI … (resumed)` tab | B §4.5 (R14) |
| §5 / §7 / D3 | Read-only live headless log without Take over (Sessions tab, step rows, Needs you) | B §4.5, §4.8 |
| §5 / R14 | Taken-over stuck / failed run finishes from the TUI | A done (P147); B opens the TUI |
| §6 | Fix menu, Merge dialog (`Also push <target>` off, `_<target>` worktree, `RecordMerge` on finish, D14), Merge / Re-merge in Details, `Right-click to re-merge.` | B §4.4 (R12, R13) |
| §7 | Sessions tab (task and branch), `Sessions N`; branch header actions (Rebase, Queue after, Re-merge, ▶ Start agent); task header Archive | B §4.5, §4.3, §4.7 |
| §9 | Repo-named rebase / queue templates, Start / Start step | B §4.2, §4.6 |
| §10 | Archive dialog, every branch at risk, history with repos | B §4.7 (R18) |
| §11 | Needs you rows, kinds, order, one action each, footer, All sessions grouped by task, badge; `interrupted by restart` stuck runs | B §4.8 (R19) |
| §11 | Archived sessions through History | B §4.7 (R18) |
| §13 / D5 | v1 backend, tables, wire, channels dropped; no data migration | A §3 |
| SPEC row | Headless-sources switch bound to the settings draft and Save | B §4.9 (R21) |
| SPEC row | Rebase / Queue after dialogs from the v1 port (U1 (a)) | B §4.2 (R10) |
| P147 R8 | `StopRun` UI caller | B §4.5 (R15) |
| P147 finding | Live-smoke recipe sets `settings` `git.path` | step 0 |
| row | knip clean, no dead v1 frontend | A §3.5, B §4.10 (R22) |

## 1. Decisions

Restated (preplan §6), implemented here: D3 (confirm before taking over a live run; read-only logs
without Take over), D5 (drop v1 tables, no data migration), D9 (footer has no CI count), D14 (merge
recorded only when the app's merge dialog finishes). P147 contract use: R13 (`TakeOver{stopIfRunning:
true}`), R14, R15 (`LaunchStage`), R16 (`StartBranch`), R17 (`Send`, `FocusSession`), R18
(`ArchiveRisk` then `ArchiveTask`, no discard flag).

| # | Decision | Why |
|---|---|---|
| R1 | **Step 0 (serial, before `B0`)**: `AgentSessions()` moves from `AdeService` to Kira Space's own `bridge.TerminalService` (method on the embedding struct; `s.Registry`); `AgentSessionsChanged(e appevent.Emitter, reg *terminal.Registry)`; `index.ts` `terminalAgentSessions` → `TerminalService.AgentSessions()`; mock FQN `TerminalService.AgentSessions`, IPC key value `kira:terminal:agentSessions`. Plus the `DEV_ENVIRONMENT.md` fix | The hydrate is agent-monitor, not v1; A deletes `AdeService` whole. Bridge key already says `terminal…`. The binding move and B's mock FQN must land together: the only cross-stream touch |
| R2 | `DEV_ENVIRONMENT.md` server-tag recipe gains a bullet: ADE git work reads the `settings` row `git.path`, not discovery; seed `INSERT INTO settings (key, value) VALUES ('git.path', '"/usr/bin/git"')` with the windows / code_repos rows, else `StartRun` fails `E_INTERNAL … exec: no command`. The older live-check paragraph's `AdeService` call list becomes `AdeTaskService` | P147 live-run finding; stale pointer removed in the same pass |
| R3 | A: kept fact helpers move verbatim from `queue.go` into new `ade/gitfacts.go` (list in §0); `facts.go` keeps `pairFacts` family, `mergedRule`, `atRisk` only; `queue.go` deleted. After removal no unexported func, type or const in `internal/ade` lacks a non-test caller (`golangci-lint` `unused`), and no exported one either (grep each) | No behavior change for v2; dead v1 code gone entirely |
| R4 | A: `Tracker` becomes v2-only. `PrepareArgs` drops `CodeRepoID`, `Branch`, `NewWorkID`; `TaskID` required (`ErrInvalidInput`); `pendingIntent` same; v1 resume cwd recreation removed (missing cwd = `ErrInvalidInput`, P147 deviation already); `List`, `ListByRepo`, `Recover` (v1) deleted; `Compose` inserts only through `InsertTUI`; `ErrSessionWrongRepo` → `ErrSessionWrongTask` (message `session belongs to another task`) | Only v2 callers remain (`launches.go`); a two-shape tracker is dead weight |
| R5 | A: migration `0011_p148_drop_ade_v1.sql`: `DROP TABLE ade_blockers, ade_dependencies, ade_colors, ade_plan, ade_new_work, ade_branches` (one statement each, children first); rebuild `ade_sessions` without `code_repo_id`, `branch`, `new_work_id`: same columns otherwise, CHECK `task_id <> '' AND (mode = 'tui' OR run_id <> '')` plus the two existing enum CHECKs; copy only `task_id <> ''` rows; drop `ade_sessions_repo`, recreate `ade_sessions_task`. `model.AdeSession` loses the three fields; `Validate` v2-only; `adeSessionsSelectColumns`, scans, `InsertHeadless`, `InsertTUI` updated; `AdeSessionsRepo.Insert`, `List`, `ListByRepo`, `StopAllRunning` deleted | D5. Columns only v1 rows used are v1 tables in all but name; a row a v2 reader can never see is not "data" |
| R6 | A: no committed migration test (CLAUDE.md test bar). A scratch Go program (deleted after) opens a temp DB migrated to `0010`, seeds one v1 row in each v1 table plus one v1 and one v2 `ade_sessions` row, runs `0011`, checks: v1 tables gone, v2 session row intact, v1 session row gone, `PRAGMA foreign_key_check` empty. Recorded in A notes | Real question (rebuild + copy) answered once; nothing to regress later |
| R7 | A: v1 channels removed everywhere: Go `ChannelAdeSessions`, `ChannelAdeRepo`, `ChannelAdeCredential`, `ChannelAdeOpenSession`, `AdeSessionsChanged`, `AdeRepoChanged`, `AdeCredentialRequested`, `AdeOpenSession`; TS keys in `packages/shared/protocol/events.ts`. Tracker `OnChange` broadcasts `AdeTaskSessionsChanged` only | D5; contract §5 lists 9 v2 channels |
| R8 | A: `gitsession.RepoEntry.StackParents` and `ReflogCreatedAt` deleted with any porcelain helper and test used only by them (grep each symbol first) | v1-only git reads |
| R9 | A: tests. Delete tests of deleted code (`bridge/ade_test.go`, v1 `queue_test.go` cases, `facts_test.go` `inferParents`/`rebindCandidates`/`colorSlot` cases). Port before deleting, retargeted at `TaskBoard`, any `queue_test.go` case whose rule now lives only in kept code and no v2 test covers: `ForcePush` success and stale-lease refusal (`TaskBoard.ForcePush` has no test), `Refresh` fetching a moved review branch (if `integration_test.go`/`board_test.go` lack it); `TestMainDisplay` moves to `gitfacts_test.go`. `tracker_test.go` cases reshaped to task rows (lifecycle, grace, mismatch, resume, Send, concurrency); v1-only cases (`ResumeWrongRepo`, `Recover_StopsLeftover`, `PrepareResumeRecreatesMissingCwd`) deleted or rewritten to their v2 meaning | Adapter-style coverage of kept remote-op rules must not vanish with its v1 host; the rest is the test bar |
| R10 | B: **dialog machinery port** to `ade/v2/dialog/` from `13e99974`: `turnWatch.ts` (verbatim, P129 Part 4 §0.15 rules), `deliver.ts` (from `launch.ts`: `Send` vs launch, `onArmed` seam), `compose.ts` (pure templates and view model from `dialogCompose.ts`, rewritten on v2 wire: `Board`, `Branch`, `Session`, `Repo`), `flow.ts` (from `dialogFlow.ts`), `AdeClaudeDialog.vue` (v1 component on shadcn Dialog / Button / Textarea / Switch / ToggleGroup / Tooltip / Alert). Kinds: `rebase`, `queue`, `merge`, `stage`, `start`, `archive`. Dropped v1 kinds and fields: `move` (drag has no dialog, SPEC2 §4), new-work draft and resume `askWt`, dependency items. One Pinia store `adeDialogs` (open spec, edited message, push switch, override, target choices, in-dialog error, in-flight `rebasing` branch ids, pending archives / merges): one concern, dialog flow | U1 (a) restore. Reuse over rewrite (preplan §1: "reuse Claude dialog machinery") |
| R11 | B: delivery per target branch: options = running TUI sessions on that branch (`claude <first 4 of id>`; `(only agent)` when one) else `new session`; default = first running TUI, else new. Running → `adeTaskSend` (arm turn watch `requireSubmit: true` before the call). New → `adeTaskStartBranch({branchId, message})`, arm on the returned `terminalId` (`requireSubmit: false`), then `openTerminalSession(launch.terminalId, '', launch.cwd, 80, 24, launch.command, 'claude-code')`; a `failed` terminal status throws into the dialog error. `stage` → `adeTaskLaunchStage`, `start` → `adeTaskStartBranch` the same way. After any launch: select the task (or branch for a branch-level launch), open its Sessions tab, select the new session (`launch.sessionId`). Turn events: `installAdeSignals` feeds `control.onAgentEvent` to `adeTurns.onEvent`; a watch on the agent-sessions store's live terminal ids feeds `onLive` | R16, R17. Same arming rules as v1 (P129 Part 4 §0.14-§0.15) |
| R12 | B: rebase / queue: roots = the clicked branch (or its stack root for `↓N main` / `✕ conflict`, mockup `rootOf`); restack chain = mine created branches stacked on it (`branchGraph` children), each line `In <worktree>: git rebase <parent>`. Onto main: `git fetch origin && git rebase origin/<main>`; onto a review branch: kind `queue`, ref `origin/<name>`, `Do not modify <name>.`; first line `Rebase <name> (repo <nick>) onto <onto>` (SPEC2 §9). Switch `Also force-push after rebasing` (off → `Do not push.`, on → `Then push each rebased branch with: git push --force-with-lease`). After a root's successful delivery: `adeTaskSetQueuedAfter({branchId: root, afterBranchId: onto})` when onto is a branch. `rebasing` marks roots until their turn ends; their Rebase buttons read `Rebasing…`, disabled. Busy check: TUI sessions on stack branches with agent activity `working`/`waiting` → busy list + `Override…`; a running headless run on any stack branch → blocked, no override, text `A background run is active on <branch>. Stop it in Sessions, or wait.` | Mockup text verbatim. `StartBranch` refuses beside a running headless run (R16), and a rebase under a running agent rewrites its tree |
| R13 | B: merge dialog (title `Merge into T` / `Re-merge into T`): SPEC2 §6 template, worktree path `<board.worktreeBasePath>/<repo name>/_<target>` (Go `freePath` segment rule: repo `name` with `/` → `-`); switch `Also push <target>` default off (on → `Then push: git push origin <target>`). On the turn's `stop` outcome: `adeTaskRecordMerge({branchId, target})`, then the board refreshes; `ended` → action error `the session ended before the merge finished; nothing recorded`. Entry points: fix menu, Details `Merge`/`Re-merge` buttons, branch header `Re-merge into T` (stale only), Needs you `Re-merge` | D14: recorded only when the dialog's own turn finishes |
| R14 | B: **Take over** (`useTakeOver(sessionId)`): headless session whose run's latest attempt is `running` → `AdeConfirmDialog` title `Take over a running run?`, body `<step> is still running on <branch>. Taking over stops it first; it becomes stuck and continues in Claude Code.`, buttons `Cancel` / `Stop and take over`; otherwise no confirm. Call `adeTaskTakeOver({sessionId, stopIfRunning: true})`, then open the terminal and select it as R11. Entry points: Sessions tab headless status bar, `Finished / stopped` rows (headless and TUI), step run lines (stuck / failed / running agent runs with a session), task action `Take over` (stuck / failed step), Needs you `Take over`, card / row `!` on a stuck run | D3, R13, R14. One composable, every surface |
| R15 | B: headless status bar gets `Stop` (outline, tip `stop this run; it becomes stuck`) while its run is `running` → `adeTaskStopRun({runId})` | P147 R8 named P148 B the caller; without it `StopRun` is dead surface. SPEC2 shows no Stop; this is the one addition, recorded as a deviation |
| R16 | B: `▶ <Stage>` dialog (title `<Stage> · interactive Claude Code`, button `Open session`): message = TS mirror of Go R15 default (`composeStageMessage`); unedited → `message: ''`. `▶ Start` dialog (title `Start Claude Code (interactive)`, button `Start`): mirror of Go R16 default; unedited → `''`. Neither has targets, busy check or push switch | Server owns the default text (P147 R15/R16), as the Run dialog (P147 R24) |
| R17 | B: Sessions tab (`Sessions N`, N = sessions in scope). Task scope = every session with `taskId`; branch scope = that `branchId`. Strip: running sessions, interactive first then most recent; badge `TUI` (solid Claude orange) or `claude -p` (dashed); name `TUI · <4-char id>` (+ ` (resumed)` when `resumes`) / `claude -p · <step name>`. Headless pane: status bar `headless run · step <step> · <run state>[ · needs you] · <ago>` + `Take over` + `Stop` (R15), `AdeRunLog` (`run`, `runId`), note `Read-only log of a background run. Use Take over to continue it yourself in Claude Code.` TUI pane: `TerminalHostView` (`useTerminalModule().host`) when this window holds the terminal (`terminalSession(terminalId)` exists); else `Show` → `adeTaskFocusSession`; `false` → `This session's terminal is not open in any window.` Empty strip → `Nothing running.` Below: `Finished / stopped` (`ago` · `Take over` · label; a headless label opens its log inline). Sessions data: `useSessions()` query over `adeTaskSessions`, invalidated by `onAdeTaskSessions`; `onAdeTaskOpenSession` selects task / branch, Sessions tab, session | SPEC2 §7, mockup lines 875-925. TUI `activity` comes from the agent-sessions store by `terminalId` |
| R18 | B: Archive. Task cell `Archive` (purple, finished) and panel header `Archive` (purple when finished, grey otherwise, mockup 2187-2190), tip `ARCHIVE_TIP`. Flow: `adeTaskArchiveRisk`; any `blocked` → action error listing them; no branch with dirty or unmerged → `adeTaskArchiveTask` directly; else the `archive` dialog (title `Archive: work would be lost`, risk line `<nick>: N uncommitted, M unmerged commits`, SPEC2 §10 message, targets per at-risk branch, buttons `Delete anyway` → `ArchiveTask` and `Send to Claude, then archive`). The latter: deliver per target; when every watched turn ends `stop`, re-read `ArchiveRisk`; still at risk → reopen the dialog with fresh risk; clear → `ArchiveTask`; `ended` → action error. History row click selects the archived task in a read-only panel: header (title, `archived` chip, repos), Sessions tab only, `Finished / stopped` rows with logs, no Take over (`TakeOver` needs a live task) | SPEC2 §10, §11 ("archived ones through History"), v1 flow, R18 (no discard flag: the dialog is the confirmation) |
| R19 | B: Needs you page (`view: 'needs'`, tab between Backlog and Plan, amber badge = `items.length`). Rows (mockup `needs`): kind chip · age · one action · scope · what, over task colour square + title; `detail` and the run note (`interrupted by restart`) shown muted. Actions: stuck run with a session → Take over (R14); stuck run without session (script) and `failed` → `Retry` (`RetryRun` per failed / stuck latest run, as `useTaskAction`); `question` → `Open` (`adeTaskFocusSession`; `false` → local open as R17); `approval` → `Approve`; `setup failed` → `See error` (select branch, Details, `focusSetup`); `stale merge` → `Re-merge` (R13). Each row's `Log` link (headless stuck / failed) opens `AdeRunLog` inline (D3). Empty → `Nothing needs you right now.` Footer `N background runs · M interactive sessions` + `All sessions` toggle: grouped by task, `Running` / `Stopped` filter, rows as mockup `agents` (activity icon · repo or `spec` · `claude -p · <step>` / `TUI · interactive` / `TUI · spec session` · branch · worktree · ago · state), click opens the session (R17). `buildNeedsYou` gets real sessions with TUI activity merged from the agent store; stuck script runs map to `Retry`; ages fall back to run `finishedAt` | SPEC2 §11, D7, D9 |
| R20 | B: fix menu on right-click of a created mine branch row through the shared `useContextMenuStore().openContextMenu` (label `<nick> · <branch>`, then items): per integration target `Re-merge into T (stale)` / `Merge into T` (not merged), `Rebase onto main` (stack root behind), `Rebase onto <branch>` (`↻` follow), `Force push` (unpushed); none → `Nothing to fix` (disabled). Stale chip tip appends ` Right-click to re-merge.` | One app-wide point-anchored menu (reka `DropdownMenu`, P104 §5) already serves the plan's day menu; a second menu primitive would duplicate it. Deviation from the row's "shadcn `context-menu`" wording, recorded |
| R21 | B: headless-sources switch joins the settings draft: `settings/types.ts` `SettingsSections` = `Pick<Settings, 'appearance' \| 'advanced' \| 'git'> & { ade: Pick<Settings['ade'], 'headlessSettingSources'> }`; `SettingsDialog.vue` passes `ade: { headlessSettingSources }` in `defaults` and `current`; `AdvancedPane.vue` binds `draft.ade.headlessSettingSources` (`'user'` ↔ on) with `isAtDefault` / `resetLeaf('ade', 'headlessSettingSources')`; nothing written until Save. Other `ade` leaves stay out of the draft (written live by the plan and panel) | SPEC row; narrowest draft shape the generic shell accepts |
| R22 | B: drop both `ade/v2` `knip.json` entries. Every finding resolved by real use (types this phase consumes: `BranchRisk`, `DirtyEntry`, `NeedsItem`, `BranchAction`, `ARCHIVE_TIP`, ...), by naming an existing indexed-access type with its wire name where code already uses that shape (`RepoState`, `WorktreeSetup`, `PR`, `FileChange`, `Commit`, `RemoteOpError`, `RepoPrs`, `MergedInto`), by un-exporting a symbol used only in its own file, or by deleting dead code. No new ignore. `wire.ts` is not edited (A owns it, frozen) | Row asks knip clean with v1 gone; P146/P147 dry runs deferred both entries to here |
| R23 | B: branch actions render: `Rebase` / `Queue after` (cell and branch header, mockup labels `Rebase onto main`, `Rebase onto <short>`, `Queue after <short>`, `Re-merge into T`, `▶ Start agent`), `▶ Start` (cell). `useTaskAction` renders every kind (`takeOver`, `stage`, `archive` too) | Closes P147 R22 / F11 leftovers |
| R24 | No wire change, no new bound method: 47 `AdeTaskService` methods and 9 v2 channels stay. P148 A adds none (contract §4) | Contract frozen at P143 |

## 2. Step 0 (serial, orchestrator lands on `v2.0` before creating worktrees)

One Sonnet implementer, two commits:

1. `refactor(kira-space): agent sessions hydrate moves to TerminalService` (R1):
   `bridge/terminal.go` `func (s *TerminalService) AgentSessions() AgentSessionsEvent`; move
   `AgentSessionWire`, `AgentSessionsEvent`, `toWireAgentSessions`, `AgentSessionsChanged`,
   `EmitAgentEvent` from `bridge/ade.go` to new `bridge/agentsessions.go`;
   `AgentSessionsChanged(e appevent.Emitter, reg *terminal.Registry)`; delete `AdeService.AgentSessions`;
   `main.go` `Registry.OnChange` calls the new signature; `index.ts` `terminalAgentSessions` uses
   `TerminalService.AgentSessions()`; `tests/ui/support/mockRuntime.ts` FQN and comment,
   `ipcChannels.ts` value `kira:terminal:agentSessions`.
2. `docs: live-smoke recipe seeds the git.path setting` (R2), `docs/DEV_ENVIRONMENT.md` only.

Checks: hook, `go build ./...`, `go test ./apps/kira-space/internal/bridge/...`, `bun run typecheck`,
`bun run test:ui:space` (boot hydrate path). `B0` = commit 2.

## 3. Stream A: v1 backend removal

Uses `codegraph_explore` before Read/Grep for any symbol not pinned here (CLAUDE.md). Each commit:
pre-commit hook passes normally, `gofmt -l` empty, `go build ./...`, `go vet ./apps/kira-space/...`,
`bun run typecheck`; tests of code a commit deletes are deleted in that commit. Notes file written
incrementally.

### 3.1 Frontend bridge glue (first, while Go still binds v1)

- `frontend/src/bridge/index.ts`: delete the `@bindings/adeservice.js` import, every v1 `ade*` /
  `onAde{Sessions,Repo,Credential,OpenSession}` entry, `normalizeAdeRepoPrs`, `normalizeAdeArchiveRisk`
  and the `../ade/wire` type import.
- Delete `frontend/src/ade/wire.ts`.
- `packages/shared/protocol/events.ts`: delete `adeSessions`, `adeRepo`, `adeCredential`,
  `adeOpenSession` and their comment.
- `frontend/src/main.ts`: comment naming `kira:ade:*` channels updated to the v2 channels.

### 3.2 Go removal

- `ade/gitfacts.go` (R3) created by moving the kept helpers; `facts.go` trimmed; `queue.go` deleted;
  `board.go` header comment ("v1 Queue stays untouched until P148") updated.
- `bridge/ade.go` deleted. Kept helpers move: validators + `adeMaxMessageBytes`/`adeMaxBranchBytes`
  to `bridge/adetask_validate.go`; nothing else survives. `bridge/events.go` v1 channels and emitters
  deleted (R7).
- `tracker.go` per R4. `main.go`: `wireAde` → `wireTracker` (tracker + agent hooks, no queue, no
  `tracker.Recover()`), `shutdownAde` drops the queue, `adeSessionsFor` and `adeCodeRepoLookup`
  deleted, `AdeService` construction, `FocusWindow` assignment and service registration deleted;
  `adeGitPathSetting`, `adeAutofetchMinutes`, `adeCloseTerminal` stay (TaskBoard uses them), their doc
  comments renamed off `QueueDeps`.
- Storage per R5: migration `0011`, `model/adesession.go`, `repos/adesessions.go`; delete
  `repos/adequeue.go`, `model/adequeue.go`, `Repos.AdeQueue` field and its constructor wiring.
- `gitsession` per R8.
- Comments naming `AdeService` in `internal/terminal/session.go`, `internal/shell/registry.go` point
  at `AdeTaskService.FocusSession`.

### 3.3 Tests

Per R9. Bounded waits, no sleeps as sync (P146 harness). `go test -race` on `ade`, `adeagent`,
`adeflow`, `gitsession`.

### 3.4 Commits (Stream A)

1. `refactor(kira-space): drop v1 ade bridge entries and wire types from the frontend` — §3.1.
2. `refactor(kira-space): move v2 git fact helpers out of the v1 queue` — `gitfacts.go`, no behavior
   change, `TestMainDisplay` moved.
3. `feat(kira-space)!: remove the v1 ade service, queue and channels` — §3.2 bridge, ade, main.go,
   tracker (R4, R7), their tests (R9), ported ForcePush / Refresh cases. Footer `BREAKING CHANGE: v1
   AdeService bindings and kira:ade:* channels removed`.
4. `feat(kira-space)!: migration 0011 drops v1 ade tables and session columns` — R5, model, repo,
   scans. Footer `BREAKING CHANGE: v1 ade data dropped (D5)`.
5. `refactor(kira-space): remove v1-only gitsession stack and reflog reads` — R8.
6. `docs(v2.0): P148 stream A notes` — `plans/P148-streamA-notes.md` (commits, R6 migration check,
   deviations, `codegraph_explore` call count).

### 3.5 Stream A end checks

`go test ./apps/kira-space/...` (gitsock must be green: P152 landed), `go test -race
./apps/kira-space/internal/{ade,adeagent,adeflow,gitsession}/...`, `bun run lint:go`, `bun run
lint:dead`, `bun run typecheck`, `go mod tidy` diff empty, `git diff B0 -- go.mod go.sum package.json
bun.lock` empty; R6 migration check; greps of §6.1.

## 4. Stream B: dialogs, Sessions, Take over, Needs you, archive UI

Imports only `ade/v2/wire.ts` (rule 5), `ade/v2/board/*`, shared stores / components. Consumes only
methods and channels in `index.ts` at `B0`. Library use: Tailwind utilities (no scoped `<style>`),
shadcn-vue (Dialog, Button, Textarea, Switch, ToggleGroup, Tooltip, Alert, Badge, Tabs, Field) and the
shared `ContextMenu` (R20), VueUse (`useIntervalFn`, `onKeyStroke`, `useClipboard` where needed),
Pinia (`adeDialogs` new; `adeBoardUi` view union gains `'needs'`, panel tab state, `sessionId`
selection, archived-task selection), TanStack Query (`useSessions`, mutations). No new package, no
new primitive. Uses `codegraph_explore` before Read/Grep for any symbol not pinned here (CLAUDE.md).

### 4.1 Data and state

- `ade/v2/queries.ts`: `sessionsKey`, `useSessions()`; mutations `useTakeOver`, `useLaunchStage`,
  `useStartBranch`, `useSend`, `useStopRun`, `useRecordMerge`, `useSetQueuedAfter`, `useArchiveRisk`,
  `useArchiveTask`, `useFocusSession`.
- `ade/queries.ts` `installAdeSignals`: `onAdeTaskSessions` → invalidate sessions;
  `onAdeTaskOpenSession` → `adeBoardUi.openSession(event)`; `onAgentEvent` → `adeTurns.onEvent`;
  agent-store live ids → `adeTurns.onLive` (R11).
- `usePlanModel`: real sessions into `buildCard` / `taskCell` / `deriveStatus` (`hasSessions`) /
  `buildNeedsYou`, TUI activity merged by `terminalId` from the agent-sessions store.
- `board/needsYou.ts`: R19 changes (script stuck → `Retry`, age fallback, note in `detail`); unit
  cases extended in `ade-v2-board-parity.spec.ts` (decision table).

### 4.2 Dialog machinery (R10-R12, R16)

`ade/v2/dialog/{compose.ts,flow.ts,deliver.ts,turnWatch.ts,AdeClaudeDialog.vue}`, `state/adeDialogs.ts`;
one dialog mounted in `AdeShell`. View: title, busy alert (list + `Override…` / `Undo override`),
targets (repo chip · branch · option chips), branch-name inputs none (Run dialog stays P147's),
editable message + `Reset`, push switch where the kind has one, archive risk line, footer `Cancel` +
kind button (`Send to Claude` / `Send anyway` red under override / `Open session` / `Start` /
`Send to Claude, then archive` + `Delete anyway`), inline error. Blank message disables send
(v1 §0.14 step 12). Unit spec `ade-v2-dialog.spec.ts` for `compose.ts` (rebase restack chain, queue
onto review, repo-named lines, merge path and push line, archive lines, stage / start mirrors) and
`turnWatch.ts` (submit / stop / ended / live-seen rules): interacting rules, earns the bar.

### 4.3 Rebase / Queue after (R12, R23)

`AdeActionCell` renders `Rebase` / `Queue after` / `▶ Start` from `BranchTag.actions` (tones per
mockup: Rebase amber, Queue after red, Start Claude). Branch panel header actions (mockup 2275-2287):
`Force push`, `Rebase onto main`, `Rebase onto <short>`, `Queue after <short>`, `Re-merge into T`
(stale), `Retry setup` (P147), `▶ Start agent` (no session, setup ok), disabled `Created when the
pipeline runs` for a not-created branch.

### 4.4 Merge dialog, fix menu, Merge / Re-merge (R13, R20)

Details → `Merged into` rows gain `[Merge | Re-merge]` (`Merge` when not merged, `Re-merge` when
stale, none when merged). Fix menu on `AdeBranchRow` `@contextmenu`. Stale tooltip text per R20.

### 4.5 Sessions tab and Take over (R14, R15, R17)

`ade/v2/sessions/{AdeSessionsTab.vue,AdeSessionStrip.vue,AdeHeadlessPane.vue,AdeTuiPane.vue,
AdeStoppedList.vue,useTakeOver.ts}`; task and branch panels get `Sessions N`. Step run lines
(`AdeStageBlock`) gain `Take over` on stuck / failed / running agent runs with a session (`Log` stays).

### 4.6 Stage, Start, task action, `!` (R16, R23)

`useTaskAction` renders all kinds: `takeOver` → R14 (session of the stuck run), `stage` → stage
dialog, `archive` → R18; panel header uses the same. `AdeAttention` click: stuck run → Take over;
question → Sessions tab with that session (local) or `FocusSession`.

### 4.7 Archive (R18)

`ade/v2/archive/useArchive.ts` (flow), dialog kind `archive` via R10; panel header `Archive`; history
row click → archived-task panel (`ade/v2/panel/AdeArchivedPanel.vue`).

### 4.8 Needs you and All sessions (R19)

`ade/v2/needs/{AdeNeedsPage.vue,AdeNeedsRow.vue,AdeAllSessions.vue}`; shell tab `Needs you` with amber
badge, never a placeholder (it lands whole here).

### 4.9 Settings switch (R21)

`workbench/SettingsDialog.vue`, `workbench/settings/{types.ts,AdvancedPane.vue}`.

### 4.10 knip and dead code (R22)

`knip.json` entries and comment removed; findings resolved per R22; `bun run lint:dead` clean.

### 4.11 Mock runtime and specs (`apps/kira-space/tests/ui/`)

- `support/mockRuntime.ts` / `ipcChannels.ts`: FQNs for the 11 methods above; `sessions.json`,
  `launch.json`, `archive-risk.json`, `event-open-session.json` fixtures; helpers emitting
  `sessions`, `agentEvent` (`UserPromptSubmit`, `Stop`, `SessionEnd`), `agentSessions`, open-session.
- `ade-v2-dialogs.spec.ts`: rebase from `↓N main` (default text, repo-named, restack lines, push
  switch line), queue after onto review (`Do not modify`, `SetQueuedAfter` args after delivery),
  busy block + override, headless block (no override), target choice running vs new
  (`Send` vs `StartBranch` args), blank message disables send; merge from fix menu and Details
  (`Also push develop` off, path, `RecordMerge` only after an emitted `Stop`, none after
  `SessionEnd`); fix menu items and `Nothing to fix`; stale tip text.
- `ade-v2-sessions.spec.ts`: task / branch scope, strip order and badges, headless bar + log +
  `Stop` arg, `Take over` confirm on a running run (`stopIfRunning: true`) and no confirm on a stuck
  one, new `(resumed)` tab selected, stopped list Take over, open-session event selects, terminal
  not in this window → `Show` → `FocusSession`.
- `ade-v2-launch.spec.ts`: `▶ <Stage>` dialog default text, unedited `message: ''`, edited text;
  `▶ Start` likewise; task `Take over`; `!` targets.
- `ade-v2-archive.spec.ts`: no risk → `ArchiveTask` direct; risk → dialog, `Delete anyway`, send then
  archive after `Stop` with risk re-read (still at risk reopens); blocked error; history row → archived
  panel sessions.
- `ade-v2-needs.spec.ts`: kinds, order, actions and their args, `interrupted by restart` note, empty
  state, footer, badge, All sessions grouping and filter.
- Settings spec: switch edits the draft, Save sends `{ade: {headlessSettingSources}}`, Cancel sends
  nothing, reset button (replaces P146's immediate-write assertion).

### 4.12 Commits (Stream B)

Each: pre-commit hook passes normally; `bun run typecheck`; touched specs run.

1. `feat(kira-space): ade v2 Claude dialog machinery and rebase / queue after dialogs` (§4.1 data, §4.2, §4.3).
2. `feat(kira-space): ade v2 merge dialog, fix menu and merge buttons` (§4.4).
3. `feat(kira-space): ade v2 Sessions tab and Take over` (§4.5).
4. `feat(kira-space): ade v2 stage and start launches, task actions and attention targets` (§4.6).
5. `feat(kira-space): ade v2 task archive dialog and archived sessions` (§4.7).
6. `feat(kira-space): ade v2 Needs you page and all sessions` (§4.8).
7. `feat(kira-space): headless setting sources switch saves with the settings dialog` (§4.9).
8. `chore(kira-space): drop ade v2 knip entries` (§4.10).
9. `test(kira-space): ade v2 dialogs, sessions, launch, archive and needs-you specs` (§4.11).
10. `fix(kira-space): align ade v2 sessions, needs-you and dialogs with the mockup` (§6.3).
11. `docs(v2.0): P148 stream B notes` — `plans/P148-streamB-notes.md` (commits, mockup verdict, deviations, `codegraph_explore` call count).

### 4.13 Stream B end checks

`bun run test:unit`, `bun run lint:all` (incl. `lint:dead` with no ade entry), `bun run
test:ui:space` (webkit per `DEV_ENVIRONMENT.md`), `scripts/check-ade-colours.sh`, mockup comparison
(§6.3).

## 5. Streams verdict, ownership, worktrees

**Split holds** after step 0. Zero file overlap; no ordering dependency:

- B calls only `index.ts` entries present at `B0` (all 47 `adeTask*`, `onAdeTask*`, `terminal*`,
  `onAgentEvent`, `onAgentSessions`). A deletes only v1 entries, which no B file calls (P145 removed
  every v1 caller; `ade/v2/**` never imports `ade/wire.ts`, rule 5).
- A's Go removal changes no v2 behavior or wire shape; B's mock specs do not depend on it.
- Step 0 carries the one shared touch (agent-sessions FQN in B's mock, R1).
- No wire change (R24). A stream needing one stops (preplan §3 rule 1).

| Path | Step 0 | A | B | Closing |
|---|---|---|---|---|
| `bridge/terminal.go`, new `bridge/agentsessions.go`, `bridge/ade.go` (AgentSessions part), `main.go` (`OnChange` line), `index.ts` (`terminalAgentSessions`), `tests/ui/support/{mockRuntime,ipcChannels}.ts` (that entry), `docs/DEV_ENVIRONMENT.md` | ✓ | | | |
| `apps/kira-space/internal/**` except `internal/gitsock/**` | | ✓ | | |
| `apps/kira-space/main.go`, `frontend/src/bridge/index.ts`, `frontend/src/main.ts`, `frontend/src/ade/wire.ts` (deleted), `packages/shared/protocol/events.ts`, `internal/terminal/session.go`, `internal/shell/registry.go` (comments), `go.mod`/`go.sum` (expected unchanged) | | ✓ | | |
| `docs/v2.0/plans/P148-streamA-notes.md` | | ✓ | | |
| `apps/kira-space/frontend/src/ade/**` except `ade/wire.ts`, `ade/v2/wire.ts` | | | ✓ | |
| `frontend/src/workbench/SettingsDialog.vue`, `frontend/src/workbench/settings/{types.ts,AdvancedPane.vue}` | | | ✓ | |
| `knip.json`, `scripts/check-ade-colours.sh`, `packages/theme/src/components/ui/**` (none expected) | | | ✓ | |
| `apps/kira-space/tests/ui/**`, `tests/unit/ade-*` | | | ✓ | |
| `docs/v2.0/plans/P148-streamB-notes.md` | | | ✓ | |
| `docs/v2.0/SPEC.md`, preplan, this plan's `## Result`, `docs/ARCHITECTURE.md` | | | | ✓ |

**Untouchable by A and B:** `apps/kira-space/internal/gitsock/**` and its tests (P152, P154);
`scripts/mutation/**`, `tools/mutation/**` (P151); `ade/v2/wire.ts`, `internal/bridge/adewire/**`,
`tests/fixtures/ade-v2/**`, `packages/shared/**` except A's `protocol/events.ts` edit, `packages/
workbench/**`, `package.json`, `bun.lock`. A stream needing any of these stops and reports.

Run from `/home/user/kira-studio`, base `B0` (after step 0):

```sh
git worktree add -b v2.0-p148-a /home/user/kira-studio-p148-a B0
git worktree add -b v2.0-p148-b /home/user/kira-studio-p148-b B0
sh scripts/prepare-dev-environment.sh   # inside each worktree
```

Check each worktree is at `B0`. Orchestrator lands nothing on `v2.0` while A and B run except a
rule-1 amendment. A stopped stream resumes from its last commit, never from scratch.

Landing after both pass their end checks: `merge --ff-only v2.0-p148-a`; in B's worktree `git rebase
v2.0` (a real conflict = wrong ownership: stop, report); `merge --ff-only v2.0-p148-b`; wave-end
suite (§6.4); closing step (§7); remove worktrees, delete branches, `git push origin v2.0`.

## 6. Acceptance

### 6.1 Step 0 and Stream A (checked by the orchestrator)

- `grep -rn "AdeService\b" apps/kira-space internal --include=*.go --include=*.ts` (excluding
  `AdeTaskService`) → 0; `bridge/ade.go`, `ade/queue.go`, `repos/adequeue.go`, `model/adequeue.go`,
  `frontend/src/ade/wire.ts` absent; `kira:ade:` (not `kira:adetask:`) absent from code.
- `grep -c` bound `func (s *AdeTaskService) [A-Z]` = `adeTask*` entries in `index.ts` = 47; `TerminalService.AgentSessions` present and called from `index.ts`.
- `ls internal/storage/migrations` ends at `0011_p148_drop_ade_v1.sql`; `grep -n "code_repo_id\|new_work_id" repos/adesessions.go model/adesession.go` → 0; R6 check recorded.
- `ade_branches|ade_new_work|ade_plan|ade_colors|ade_dependencies|ade_blockers` appear only in
  migrations `0005`-`0007` and `0011`.
- `StackParents`, `ReflogCreatedAt`, `inferParents`, `rebindCandidates`, `colorSlot`, `NewQueue`
  absent; `TaskBoard.ForcePush` has a test (grep).
- Contract untouched since `B0`: `git diff B0 -- apps/kira-space/frontend/src/ade/v2/wire.ts
  apps/kira-space/internal/bridge/adewire apps/kira-space/tests/fixtures/ade-v2` empty.

### 6.2 Stream B

- No file under `ade/v2/` imports `ade/wire.ts`; no scoped `<style>`; no `defineComponent`; one store
  per concern (`adeDialogs` holds dialog flow only) (grep).
- Every `adeTask*` and `onAdeTask*` entry in `index.ts` has a caller outside `bridge/index.ts` (the
  §0 loop prints nothing).
- `knip.json` has no `ade/v2` entry; `bun run lint:dead` exit 0.
- `Right-click to re-merge.` present; `Needs you` tab present; `Take over`, `▶ Start`, Archive,
  `▶ <Stage>`, `Rebase`, `Queue after`, `Merge`, `Re-merge`, `Stop` rendered (specs).
- `AdvancedPane.vue` has no `patchSettings` call.
- UI specs of §4.11 pass; `check-ade-colours.sh` passes.

### 6.3 Mockup comparison (B end, again at wave end)

Throwaway Playwright Chromium script (scratchpad), 1440×900: mockup `needs` (incl. All sessions),
panel Sessions tab (task `T_auth` headless stuck with log; a TUI tab; Finished / stopped), branch
header actions, fix menu on `b_auth`, merge / rebase / queue / stage / start / archive dialogs, Take
over confirm, Details `Merged into` with Merge / Re-merge, against the built test app on the mock
runtime with fixtures. Read both images; list differences. Accepted: `Stop` button (R15), shared
context-menu look (R20), terminal pane is a real xterm (mockup draws text lines), Take over confirm
(D3, not in mockup), app fonts, fixture-vs-mockup data. Anything else (geometry, order, chips, tones,
labels) is a defect fixed before landing. Verdict + image paths in the B notes.

### 6.4 Wave end (landed tip)

- `go build ./...`, `go test ./apps/kira-space/...` (gitsock green; P152 landed: a failure is a P148
  regression unless its signature matches P154's real-home sharing, then record under P154),
  `go test -race ./apps/kira-space/internal/{ade,adeagent,adeflow,gitsession}/...`, `bun run test:unit`,
  `bun run lint:all`, `bun run test:ui:space`. Failures fixed in follow-up commits on `v2.0`.
- **Migration on a real v1 home:** copy of a home at `0010` with v1 rows (scratch-seeded) boots on the
  landed tip: `0011` applies, app starts, board loads, v2 sessions list intact.
- **Live run** (server-tag recipe as amended in step 0, local `Locate` patch reverted after, real
  `claude`): temp home, scratch repos `api` (prepare `sleep 3; echo prepared`) and `web`, `git.path`
  seeded; Playwright Chromium on `/?window=main`:
  1. Task on both repos with a workflow whose first stage is `user` + `session: true`; `▶ Spec`
     dialog default text, `Open session` → Sessions tab shows a `TUI` tab with an xterm.
  2. Agent stage with a step prompting `call finish_step with status "needs_input" and question
     "which file?"` → run `stuck`; Needs you shows `stuck run` with `Take over`; `Take over` (no
     confirm, run not live) → `TUI … (resumed)` tab; the run row in the DB has a TUI session with
     `resumes` = the headless Claude id.
  3. Second run with a `sleep 60` step: Sessions headless bar → `Take over` shows the confirm;
     `Stop and take over` → run `stuck` `taken over in Claude Code`. Third: `Stop` → `stuck` `stopped by you`.
  4. `web` branch `↓1 main` after a scratch commit on `main`: `Rebase` dialog text names the repo;
     send to a new session (`StartBranch`) → TUI tab appears.
  5. Fix menu on a branch with `develop` configured → `Merge into develop` dialog path and push line.
  6. Task Archive with a dirty worktree → dialog; `Delete anyway` → task gone, history row with repos,
     history click lists its sessions.
  7. Settings: toggle headless sources, Cancel → unchanged in DB; toggle, Save → `ade.headlessSettingSources` row changed.
  What the sandbox cannot show (TUI first-run screen, a real `Stop` hook ending a turn, so `RecordMerge`
  and send-then-archive completion) is recorded as not observed, covered by the mock specs. Screens in
  scratchpad; result in the plan `## Result`.

## 7. Closing step (serial subagent, after landing)

- `## Result` here (commits, counts, R6 check, migration-on-real-home, live run, mockup verdict,
  licenses: none new, deviations); `## P148 result` in `SPEC.md`; row status **Done**.
- Preplan §5 matrix: §6 fix menu row notes R20; §7 Sessions row notes R15 `Stop`.
- `docs/ARCHITECTURE.md` short notes (full ade rewrite stays P149): v1 removed (migration `0011`,
  sessions v2-only, `TerminalService.AgentSessions`), dialog flow (targets, turn watch, `RecordMerge`
  on `Stop`). Known open items: delete "Run held behind a failed worktree setup keeps note" (fixed by
  P147 R10, verify `setup.go` / `recover.go` first); reword "A pending Send to Claude, then archive
  lives in the renderer" to the v2 `adeDialogs` store (still true); reword the two items naming the v1
  queue (`pairFacts` conflict pairs, linked-worktree dirty refresh) to the v2 board if still true, else
  delete; add "held fix runs lose their resume spec across restart" (P147 carry-forward, still open).
- Remove worktrees; push.

## 8. Carry-forward

- P149: full suites, live comparison, ade `ARCHITECTURE.md` rewrite; re-audit SPEC2 §13 drops with v1
  gone; R15 and R20 deviations listed for the user.
- P150: amends `ArchiveTask` (unpin, purge, review windows) per its own plan; archive dialog from R18
  is its UI entry.
- P154: tests still on the real `review.db` (unchanged).
- Open for the user (unchanged): todo progress unobservable in `claude -p` 2.1.289; interactive
  `claude --resume` TUI unobservable in the sandbox.

## Result

**Commits** (`4dc1d3fb..v2.0`, 22): step 0 and plan before it. Stream A: `f4140f4a`, `59edd807`, `3897fa6b`
(remove v1 service, queue, channels), `12b2a645` (migration `0011`), `a7b9193c`, notes `f4a4c854`. Stream B:
`31cba801`, `0a2c1862`, `b3e7da8a`, `926b0b9f`, `9b8bb053`, `663ecca4`, `57cadc1b`, `cc38380a`, specs
`086567d6` `d0686d77` `5720a0e8` `b0e242f2` `aecbacf8`, mockup fix `cb29d9ad`, notes `4e531695`. Closing: `668b2dd7`
and docs.

**Counts:** 47 `func (s *AdeTaskService) [A-Z]` = 47 `adeTask*` entries; `grep -rn AdeService` in code
(excluding `AdeTaskService`) empty; v1 tables only in migrations `0005`-`0007`, `0011`.

**Wave-end suite on the landed tip:** `go build ./...` ok; `go test ./apps/kira-space/...` ok;
`go test -race` on `ade`, `adeagent`, `adeflow`, `gitsession` ok; `bun run test:unit` 1764 pass;
`typecheck`, `lint:all` ok; `test:ui:space` 154 pass (webkit). One stale comment fixed (`mockRuntime.ts`).

**R6 / migration on a v1 home:** Stream A's scratch test (notes). Wave end: server built at `4dc1d3fb`
made a home at version 10; seeded one row in each v1 table, a v1 session, a v2 task and a v2 session;
landed tip booted: version 11, v1 tables gone, v1 session dropped, v2 task and session intact, board loads,
Sessions tab lists the v2 row.

**Live run** (server-tag build, real `claude` 2.1.289, temp home, scratch repos `api` and `web`, `git.path`
seeded, Playwright Chromium; no `Locate` patch needed, so nothing to revert). Ran and passed:
- Spec stage (`user`, `session: true`): `▶ Spec` dialog default text, `Open session` gave a `TUI` tab with an xterm.
- Agent step `needs_input`: run `stuck` `which file?`; Needs you listed `stuck run` with `Take over`;
  Take over (no confirm, run not live) opened `TUI … (resumed)`; DB row `resumes` = headless Claude id.
- Live run: Sessions headless bar showed `Take over` and `Stop`; Take over showed the confirm; `Stop and take over`
  gave run `stuck` `taken over in Claude Code` and a resumed TUI tab. A second run `Stop` gave `stuck` `stopped by you`.
- `web` after a scratch commit on `main`: `↓1 main`, `Rebase` dialog text names the repo, send to `new session` opened a TUI tab (`StartBranch`).
- `develop` as integration branch: right-click menu `Merge into develop`; dialog shows the develop worktree path; `Also push develop` switches `Do not push.` to `Then push: git push origin develop`.
- Archive of a task with a dirty worktree: dialog showed risk and `Delete anyway`; task gone, worktrees removed, history row with repos, click lists its sessions.
- Settings: toggling the headless sources switch then Cancel left the DB unchanged; Save wrote `ade.headlessSettingSources` = `"user"`.
- Needs you tab, badge, `▶ Spec` and `▶ Start` buttons rendered.

Not observed: TUI first-run screen of `claude`, a real `Stop` hook ending a turn (so `RecordMerge` and
send-then-archive completion), the mockup screenshot comparison repeated at wave end (no UI change after
Stream B's verdict). Covered by the mock specs. Smoke finding: `claude -p` blocks a standalone
`sleep N` and backgrounds it; a long-running step needs `until [ -f flag ]; do sleep 2; done`.

**Mockup verdict:** Stream B notes. **Licenses:** none new; `go.mod`, `go.sum`, `package.json`, `bun.lock` unchanged.

**Deviations:** R15 `Stop` button; R20 shared context-menu look; `archive/useArchive.ts` not created (flow in
`dialog/flow.ts`); A and B notes list the rest. Run dialog default text keeps `{repo}`, `{branch}`, `{worktree}`
placeholders for a `once` step (expanded per branch at launch).

