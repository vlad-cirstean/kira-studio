# P150 Review code, iter2: re-verified against the current tree

Plan only. Re-verification of the approved `P150-review-code.md` (written at `70440ae`, before
P144-P149). Base now: `v2.0` tip `e0a76fdb` (P149 closed). User decisions Q1-Q7 (prior plan §12) stand
unchanged. This file replaces the prior plan's §2-§10 where they differ; prior §1 (ask), §3 (audit),
§6.1-§6.4 wording and §12 stay the reference. Where this file and the prior plan disagree, this file
wins. Every claim below was re-read from current source (`codegraph_explore` first), not from prior
prose.

## 0. Ask (unchanged, prior §1)

1. Per task branch: **Review code** button opens a **new window** reviewing only that branch.
2. Content-based "since review": next visit shows only what differs from what the user last
   reviewed, whatever produced it (stages, agents, rebases). Repeatable.
3. **AI questions panel** forwards to the task's **review agent**: one interactive TUI Claude Code
   session per task, resumed for the whole task, every task branch as context. `▶ Review` uses it.
4. **GitHub sync** (one way, app -> GitHub, `gh` CLI only): mark fully reviewed files viewed on the
   PR; un-reviewing a file unmarks it, only for files this app marked. Partial reviews never sync.
5. Reuse the Git-module review stack; no parallel engine.

Q1-Q7: same agent for `▶ Review` and the window, resumed every time; one shared agent terminal per
task; uncommitted changes banner only; review windows not restored on relaunch; renamed unchanged
file keeps its review; un-review unmarks on GitHub (app-marked files only); agent cwd = first created
branch's worktree, other worktrees (or main checkouts) via `--add-dir`.

## 1. Re-verification of prior §2 assumptions

| # | Prior assumption | Now (evidence) | Verdict |
|---|---|---|---|
| A1 | `ade_tasks`, `ade_task_branches`; Branch has `codeRepoId`, `name`, `base`, `worktree`, `taskId` | `0008_p144_ade_tasks.sql`; `adewire.Branch` (`wire.go:178`) has all, plus `kind`, `dirty`, `tip` | holds |
| A2 | `ade_sessions` has `mode`, `task_id`, `branch_id`, `stage_id`; TUI via `Tracker.Prepare`/`Compose` | rebuilt v2-only by `0011_p148_drop_ade_v1.sql`; `Prepare` (`tracker.go:201`), `Compose` (`tracker.go:284`) | holds |
| A3 | `Send` pastes into a live TUI | `TaskBoard.Send` (`launches.go:439`) -> `Tracker.Send` (`tracker.go:470`) bracketed paste then `\r`; headless refused | holds, no port |
| A4 | `Prs` returns PR per branch id | `TaskBoard.Prs` (`board.go:504`) via `ResolveBranchPr` | holds |
| A5 | TUI activity per `terminalId` via `agentEvent` | `createAgentSessionsStore.agentActivityFor` (workbench), `activity.ts` `activityKind` | holds |
| A6 | Next free Space migration `0011` | `0011` is P148's drop; next free is **`0012`** | drift D1 |
| A7 | Branch panel, stage block, branch-row menu exist | `panel/headerActions.ts`, `panel/AdeStageBlock.vue`, `plan/AdeBranchRow.vue` `onMenu` (fix items only) | holds |
| A8 | `adeTaskSessions` push on TUI spawn/stop | `Tracker` `OnChange` -> board `notifySessions`; `installAdeSignals` invalidates `sessionsKey` | holds |

### Drift found (each changes the design below)

| # | Drift | Consequence |
|---|---|---|
| D1 | Space migration `0011` taken (P148) | P150 takes **`0012_p150_review.sql`** (holds `ade_sessions.purpose`, `ade_review_windows`, `ade_gh_synced`). P156 then needs `0013`. gitreview migration stays `0003_p150_pin.sql` |
| D2 | `AdeTaskService` binds 47 methods (`grep -c '^func (s \*AdeTaskService)'` = 47; 47 `adeTask*` in `bridge/index.ts`); 23 fixtures; `wire_test.go` table is a map checked against the directory listing, no count literal | P150: **47 -> 53** methods, **23 -> 28** fixtures |
| D3 | `PrepareArgs.ExtraArgs` exists; `LaunchStage` already builds `--add-dir` (cwd = first created mine branch, else first repo root; other worktrees and read-only repo roots extra) | No new `AddDirs` field. Factor `LaunchStage`'s dir loop into one helper the review agent shares |
| D4 | `Compose` appends ` -- <message>` after the base command (variadic `--add-dir` safe) | A resume can carry a first message (`claude --resume <id> --add-dir … -- <msg>`) |
| D5 | `▶ <Stage>` now opens P148's Claude dialog (`compose.ts stageSpec` -> `flow.ts sendLaunch` -> `LaunchStage`) | Route to the review agent **server-side inside `LaunchStage`**; dialog unchanged |
| D6 | `actions.ts userStageAction` hides `▶ <Stage>` while any TUI runs on the task | A running review agent must not hide `▶ Spec`; exclude review-agent rows unless the current stage is the review stage |
| D7 | `TakeOver` resumes a stopped TUI row with `pa.Resume` and no `ExtraArgs` | Take over of a review-agent row goes through the review-agent launcher, so `--add-dir` is recomputed |
| D8 | v1 `AdeService` gone; `AdeTaskService.FocusWindow` is a func field set after `windows` exists (`main.go:189`); `winDeps` built at `main.go:302` | `OpenReviewWindow` uses the same two-step: func fields on `AdeTaskService`, assigned after `winDeps` |
| D9 | Rename detection exists: `NameStatusArgs`/`NumstatArgs` run `-M -C`; `FileChange.OriginalPath` set for renamed/copied | §4.6 carry-over is a `RangeFiles` join change only; `renamed` only, never `copied` |
| D10 | `Store.Purge(ctx, repoID, branch)` has two callers in `gitsession/gh.go`, no force flag | No signature change: sweep and `Purge` skip pinned rows; archive unpins, then purges |
| D11 | `CONTRACT_VERSION = 41` (`git-ipc/validate.ts:161`), `ContractVersion = 41` (`gitrpc/contract.go:165`) | `review.snapshot` bumps both to **42** (VS Code host rebuilt from the same packages) |
| D12 | P148 `dialog/deliver.ts` (`deliver`, `openLaunch`) and `turnWatch.ts` (`adeTurns.watch(terminalId, {requireSubmit})`) exist | Compose box reuses both: submit is confirmed by `UserPromptSubmit`, answer end by `Stop` |
| D13 | All review marks go through `RepoEntry.MarkFile` -> `gitreview.Store.Put` (git-ui Files pane, Space diff tabs' `reviewDecorations.ts`, VS Code host) | Un-review -> GitHub unmark moves **server-side** (store observer), so every surface triggers it. `GitHubSyncApply` loses `unmarkOnly`; `LaunchReviewAgent` loses `windowKey` (terminal opens in the caller's window via `openLaunch`) |
| D14 | `AttachCloseFlush` **hides** the last counted window instead of closing it; `OpenWindow` deletes a row only when `RemoveAndCount > 0` | Ephemeral windows must not count, must always close (never hide) and always delete their row (§4.1) |
| D15 | `findBranchRef` falls back to remote short names (`origin/x`) | A review-kind branch may resolve only as a remote ref: the window target branch uses the same spelling the board resolved its tip from (implementer verifies on a review-kind fixture) |
| D16 | Claude Code stores conversations per project dir; `Prepare` refuses a resume outside the recorded cwd (`ErrResumeCwdNotDir`, missing dir = `ErrInvalidInput`) | First branch's worktree can vanish (merged, removed) before the task ends. Then the launcher starts a fresh review agent and says so (§4.4) |
| D17 | P148 dialogs `Send` into `working` sessions (`busyFor` only guards rewrite risk) | Busy rule: block only on `input`; `working` allowed (Claude Code queues typed input), turn watch confirms |
| D18 | Sandbox: server-tag build opens no native window and drops terminal output; interactive `claude` cannot sign in; `gh auth status` fails (invalid `GH_TOKEN`) | Live smoke uses a fake `gh` and a fake `claude` on `PATH` (§9.3); real-account checks recorded or filed (§9.4) |
| D19 | GraphQL schema checked offline: `octokit/graphql-schema` `schema.graphql` @`82ff2d47`: `MarkFileAsViewedInput`/`UnmarkFileAsViewedInput {clientMutationId, path: String!, pullRequestId: ID!}`, payload `pullRequest`, `FileViewedState = DISMISSED | UNVIEWED | VIEWED`, `PullRequestChangedFile.viewerViewedState: FileViewedState!` | Prior V3 introspection step is done; only a live mark/unmark remains (§9.4) |
| D20 | Stream C (`/home/user/kira-studio-c`) owns `internal/terminal/**` (P153), later P154 edits tests in `gitrpc`, `gitsession`, `ade`, `bridge` | P150 never touches `internal/terminal/**`. New P150 tests use a temp `Registry.Review` store and temp home (never the real `review.db`); result lists every test file P150 touched so P154 rebases cleanly |

No drift changes scope or a user decision. Nothing goes back to the user.

## 2. Data model

### 2.1 `review.db` (`internal/gitreview`), `0003_p150_pin.sql`

- `ALTER TABLE review_session ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`.
- `sweepDB`: `WHERE last_used_at < ? AND pinned = 0`. `Purge`: `AND pinned = 0` (D10; no new param).
- `Store.SetPinned(ctx, repoID, branch, pinned bool) error`: upserts the session row (pin before any
  mark) via `upsertSession`, else updates.
- `Store.SetObserver(fn func(ReviewChange))`, `ReviewChange{RepoID, Branch, Path, State string}`
  (`State` = `full` | `partial` | `deleted`): called after a committed `Put` or `Delete`, outside the
  transaction. Set once in `main.go` before serving; nil = no call. Plain func seam, same convention
  as `Registry.Settings`.
- Key stays `(repo_id, branch)`. A task branch maps 1:1 to it. One store; Git module and review
  window see the same marks.

### 2.2 Space DB, `0012_p150_review.sql`

```sql
ALTER TABLE ade_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'review'));
CREATE UNIQUE INDEX ade_sessions_review ON ade_sessions (task_id) WHERE purpose = 'review';
CREATE TABLE ade_review_windows (
  window_key TEXT PRIMARY KEY REFERENCES windows (key) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL UNIQUE REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE ade_gh_synced (
  branch_id TEXT NOT NULL REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  path TEXT NOT NULL, pr_number INTEGER NOT NULL, marked_at INTEGER NOT NULL,
  PRIMARY KEY (branch_id, path)
);
```

FKs are enforced (`sqlitex` sets `_foreign_keys=1`). `model.AdeSession` gains `Purpose`;
`scanAdeSessionRow`, `InsertTUI` carry it; `MarkRunning` (resume) keeps it.

### 2.3 Lifecycle

- `OpenReviewWindow`: `SetPinned(gitRepoId, branch, true)`.
- `ArchiveTask`: per branch `SetPinned(false)` then `Purge`; close its review windows; delete its
  `ade_gh_synced` rows (no GitHub call). The review agent stops with the other task terminals
  (`closeTaskTerminals` already covers every running TUI of the task).
- PR closed/merged before archive: pinned rows survive `maybePurgeClosed` (G3 closed).

## 3. Wire contract (serial step 0, commit 1)

Preplan §3 rule 1: one commit changes Go `adewire`, TS `ade/v2/wire.ts`, fixtures, and the git-ipc
contract together. No bridge method lands here (bindings are generated from Go methods; a stub is
forbidden), only types, fixtures, git-ipc request shape and version.

New `AdeTaskService` methods (land with their engine code, §7 commits 4-6):

| Method | Args | Result |
|---|---|---|
| `OpenReviewWindow` | `BranchArgs` | `boolean` (true opened, false focused existing) |
| `ReviewWindowTarget` | `WindowKeyArgs {windowKey}` | `ReviewWindowTarget \| null` |
| `ReviewAgent` | `TaskArgs` | `ReviewAgentState` |
| `LaunchReviewAgent` | `TaskArgs` | `ReviewAgentLaunch` (E_INVALID when already running) |
| `GitHubSyncPlan` | `BranchArgs` | `GhSyncPlan` |
| `GitHubSyncApply` | `BranchArgs` | `GhSyncResult` |

Reused unchanged: `Send`, `FocusSession`, `Prs`, `Board`, `Sessions`, `TakeOver`, `LaunchStage`.

```ts
interface WindowKeyArgs { windowKey: string }
interface ReviewWindowTarget { taskId: string; branchId: string; codeRepoId: string; gitRepoId: string;
  branch: string; base: string; worktree: string }
interface ReviewAgentState { session: Session | null; hostWindowKey: string /* '' = not running */ }
interface ReviewAgentLaunch { launch: Launch; resumed: boolean; note: string /* '' or why a fresh one started */ }
type GhSyncStatus = 'ok' | 'noPr' | 'prClosed' | 'disabled' | 'ghMissing' | 'unauthenticated'
  | 'unavailable' | 'headNotFetched';
interface GhSyncFile { path: string; action: 'mark' | 'unmark' | 'alreadyViewed' | 'skip';
  reason: '' | 'notReviewed' | 'partial' | 'changedSinceReview' | 'differsFromPrHead' | 'notInPr' }
interface GhSyncPlan { status: GhSyncStatus; message: string; account: string; pr: PR | null;
  headSha: string; localTip: string; files: GhSyncFile[] }
interface GhSyncResult { status: GhSyncStatus; message: string; marked: string[]; unmarked: string[];
  failed: { path: string; error: string }[] }
// Session gains: purpose: '' | 'review'
```

git-ipc: `review.snapshot {repoId, branch, path} -> {kind: 'none' | 'text' | 'binary' | 'tooLarge' |
'absent'; text: string | null; reviewedAtSha: string | null}` in `contract.ts`, `REQUEST_KEY_MAP`,
`gitrpc` contract/wire types; `CONTRACT_VERSION`/`ContractVersion` 41 -> 42 with a one-line history
comment like P111's.

Fixtures (`tests/fixtures/ade-v2/`): `review-target.json`, `review-agent.json`,
`review-agent-launch.json` (with `note`), `gh-sync-plan.json` (one file per action/reason, `account`),
`gh-sync-result.json` (one failure); `sessions.json` gains one `purpose: 'review'` session; every
other session fixture gains `purpose: ''`. `wire_test.go` table +5 entries.

Step 0 checks: `go test ./apps/kira-space/internal/bridge/adewire/... ./apps/kira-space/internal/gitrpc/...`,
`bun run typecheck`, `bun run lint`, `go build ./...`.

## 4. Architecture

### 4.1 Review window (Go)

- `AdeTaskService` gains func fields (not bound methods, same as `FocusWindow`): `OpenWindow func(rec
  shell.WindowRecord)`, `CloseWindow func(key string) bool`, `SetWindowTitle func(key, title string)`.
  Assigned in `main.go` after `winDeps` exists.
- `OpenReviewWindow(BranchArgs)`: engine validates (branch on a live task, `name != ''`, repo held via
  `openRepo`), resolves `gitRepoId` and the ref spelling (D15), pins (§2.3). Existing
  `ade_review_windows` row for the branch -> `FocusWindow(key)`, return `false`. Else mint key,
  `Windows.Create` (order after all rows, cascade bounds from current window), insert row,
  `OpenWindow(rec)`, `SetWindowTitle(key, "Review · <repo nickname> · <branch>")`, return `true`.
- `ReviewWindowTarget(WindowKeyArgs)`: row join -> target, `null` otherwise. Frontend reads
  `windowKey` (`packages/workbench/src/util/window.ts`) at boot. No URL change.
- Ephemeral (Q4): Space `WindowsRepo.List` excludes keys in `ade_review_windows`; boot deletes
  leftover review rows (`DELETE FROM windows WHERE key IN (SELECT window_key FROM ade_review_windows)`,
  cascade) before the startup `List`.
- Shared shell seam: `WindowOpenerDeps.Ephemeral func(key string) bool` (nil in Studio, behaviour
  unchanged). `WindowRegistry` counts non-ephemeral windows for `AttachCloseFlush`'s last-window
  predicate; an ephemeral window always closes (never hides) and always deletes its row. So closing
  the main window while a review window is open hides main and keeps its row and tabs (D14). Pure
  decision `closeDecision(isEphemeral, otherRealWindows) (hide, deleteRow bool)` in `internal/shell`,
  unit-tested in `registry_test.go`.
- `WindowRegistry` gains `Close(key) bool` and `SetTitle(key, title) bool` for the func fields.
- Archive closes the task's review windows through `TaskBoardDeps.CloseReviewWindows func(taskID
  string)` (same seam shape as `CloseTerminal`), wired in `main.go`.

### 4.2 Review window UI

New dir `frontend/src/ade/v2/review/` (covered by `check-ade-colours.sh`). Boot (`main.ts`): after
`windowsEnsure`, `ReviewWindowTarget({windowKey})` before mount; non-null -> Pinia
`adeReviewWindow.target`; `App.vue` renders `AdeReviewWindow.vue` instead of `TitleBar` +
`WorkbenchShell` (shared dialogs and `ContextMenu` stay). Boot also runs
`ensureWorkspaceShell(codeRepoId)` + `activateWorkspace` so diff tabs render in this window.

Layout: three panes with the existing `panel/AdePanelResizeHandle.vue`; widths via VueUse
`useStorage` (per-viewer convenience).

- **Header**: task colour square, title (2-line clamp), repo nickname, branch, base marker,
  `Sync to GitHub · N` (§4.5), uncommitted banner from `Branch.dirty` (`N uncommitted changes in the
  worktree are not in this review`; banner only, Q3).
- **Left**: git-ui `mount(…, {view: 'review', target: {repoId: gitRepoId, branch, base}, reviewFilter:
  'needsReview', onReviewMarked})` exactly as `RepoReviewView.vue`. git-ui additions (all optional, old
  hosts unchanged): `ReviewTarget.base?` applied through `ReviewSessionState.setBase` after `setTarget`
  (resolution reason `override`); `reviewFilter?: 'all' | 'needsReview'` (default `all`) passed to
  `ReviewFilesPane` as a ToggleGroup `Needs review · N | All`, needs review = `kind none | partial |
  changedSinceReview`, empty state `Nothing changed since your last review.`; `onReviewMarked?(path)`
  called after a successful `ReviewFilesState.mark`.
- **Centre**: this window's diff tabs (`openRepoReviewDiffTab` via `hostHandlers.ts`).
- **Right**: questions panel (§4.4).
- State: Pinia `adeReviewWindow` (target, filter mode, compose draft; one concern). Server state
  through TanStack Query: `ReviewWindowTarget`, `ReviewAgent`, `GitHubSyncPlan` (`staleTime: 0`,
  refetch on focus, invalidated by `onReviewMarked`, by `reviewDecorations.ts` marks in this window,
  and by `adeTaskBoard`), `Board`, `Prs`, `Sessions`.
- **Review code button** (main window): `headerActions.ts` new kind `review` for any created branch
  (mine or review kind; placed before the non-mine early return), `AdeBranchRow.vue` context menu
  item `Review code` above the fix items (menu opens even with no fix items), and one per branch in
  `AdeStageBlock.vue` when the block is the review stage. Disabled with tooltip `Create the branch
  first` when `name === ''`. Calls `OpenReviewWindow`.

### 4.3 Content-based left side (G2)

- `review.snapshot` handler: `Store.Record` + `gitreview.Decompress` (no catfile, no git spawn).
- `RepoDiffView.vue`: a review tab whose `left === reviewedAtSha` (sinceReview mode) builds its left
  model from `review.snapshot` when `kind === 'text'`; else today's rev read. `reviewDecorations.ts`
  unchanged (ranges already project through `FileDelta`).

### 4.4 Review agent

- Row: `ade_sessions` with `purpose = 'review'`, `mode = 'tui'`, `task_id`, `branch_id = ''`,
  `stage_id = ''`. DB enforces one per task. `PrepareArgs.Purpose` and `pendingIntent.Purpose` carry
  it into `Compose`'s `InsertTUI`.
- `TaskBoard.launchReviewAgent(ctx, tc, message)` (task mutex held), the one launcher:
  1. Dirs from the helper factored out of `LaunchStage` (D3): cwd = first created mine branch's
     worktree (`launchGate`), extras = other worktrees and read-only repo roots via `--add-dir`.
  2. No row -> new launch (`Prepare` with `Purpose`, message = `composeReviewMessage` unless given).
  3. Stopped row, recorded cwd still a dir -> resume (`Prepare{Resume: rec.ID}`, fresh `--add-dir`
     extras so later branches join, message only when given). `resumed = true`.
  4. Stopped row, cwd gone (D16) -> clear old row's `purpose` (stays a plain stopped session), new
     launch; `note = "The previous review conversation ran in <cwd>, which no longer exists. Started a
     new one."`.
  5. Running row -> `E_INVALID a review agent is already running`.
- `composeReviewMessage` (fixed text, prior plan §5.4): task title, Jira line, notes (first 2000
  chars), one line per branch (`<nick>: <branch> (base <base>) worktree <path>` or read-only root),
  then `I review these branches in Kira Space and will ask you questions about them. Answer from the
  code; change files only when I ask you to.` No permission mode set.
- Entry points, all through the one launcher:
  - `LaunchReviewAgent(TaskArgs)` (review window "Start review agent").
  - `LaunchStage` when the current stage is `kind user`, `session: true`, `id == "review"` (sample
    workflow `standard.yaml`): the dialog's message (or, when `''`, `composeReviewMessage` plus the
    stage prompt) goes to the review agent (D5).
  - `TakeOver` of a `purpose = 'review'` row (D7).
- `ReviewAgent(TaskArgs)`: row (`toWireSession`, with `Purpose`) and `hostWindowKey` from
  `Registry.WindowOf(terminalId)` when running.
- Hosting (Q2): a PTY belongs to the window that opened it. Questions panel: running here -> reuse
  `sessions/AdeTuiPane.vue`; running elsewhere -> `Review agent is open in another window` +
  `Focus` (`FocusSession`), compose still sends via `Send`; not running -> `Start review agent`
  (`LaunchReviewAgent` -> `openLaunch` with `adeTerminals.track`). One process, never two.
- Compose box (Textarea + Send, ⌘Enter via VueUse `onKeyStroke`): prefix `[<repo> <branch> ·
  <path>:L<a>-L<b>]` when this window's active diff tab has a selection, else `[<repo> <branch>]`.
  Diff editor context-menu action `Ask review agent` prefills the reference. Delivery reuses P148
  `deliver({kind: 'send', …}, onArmed)` with `adeTurns.watch(terminalId, {requireSubmit: true})`
  (D12). Status line: `Sent` -> `Answering…` on `UserPromptSubmit` -> cleared on `Stop`. No
  `UserPromptSubmit` within 10 s (VueUse `useTimeoutFn`) -> `Claude Code did not take the message;
  press Enter in its terminal.` Busy rule (D17): Send disabled with tooltip while activity is
  `input`; allowed when `working`/`waiting`/`idle`.
- `sessionView.ts`: tab name `Review agent` for `purpose === 'review'`. `actions.ts userStageAction`:
  `talking` ignores review-agent rows unless the current stage id is `review` (D6).

### 4.5 GitHub viewed sync

`ghclient` (one client, prior §6.2, adjusted):

- `Client.graphql(ctx, repo, query string, vars []GraphQLVar, out any) Status`: same auth gate as
  `get` (no spawn unless `discovery.Status` ok); argv `api graphql --hostname <host> -f query=<q>`
  then per var `-f name=value` for strings (never `-F`: a path starting `@` would read a file) and
  `-F name=<int>` for integers only. Shared `classify`; a 200 body with `errors[]` -> `KindForbidden`,
  `Reason` = first message; per-alias errors exposed by `path[0]`.
- `PullFiles(ctx, repo, number) (PullFiles{NodeID, HeadSha, State, Files []{Path, Viewed}}, Status)`:
  `repository(owner,name){pullRequest(number){id headRefOid state files(first:100, after:$c){nodes{path
  viewerViewedState} pageInfo{hasNextPage endCursor}}}}`, paged to the end, stop at 3000 files.
- `SetFilesViewed(ctx, repo, prNodeID, paths, viewed bool) (failed map[string]string, Status)`: chunks
  of 50 aliased mutations (`m<i>: markFileAsViewed(input:{pullRequestId:$pr, path:$p<i>})
  {clientMutationId}`, `unmarkFileAsViewed` when `viewed` is false). Query text built from indexes
  only; paths travel as variables.

`gitsession` (rate-limit breaker reused: `armBreaker`/`breakerStatus` on the entry's `ghState`):

- `RepoEntry.GhSyncPlan(ctx, branch, base string, pr int, synced map[string]bool) GhSyncPlanResult`
  implements prior §6.3 rules 0-6 unchanged (unmark app-marked non-full; skip notReviewed, partial,
  changedSinceReview, differsFromPrHead; alreadyViewed; mark), `notInPr` listing, records resolved
  with §4.6 carry-over. PR head blob oids via `blobOIDs(headSha, paths)`; `headSha` absent locally ->
  `headNotFetched` (`PR head <sha7> is not fetched. Refresh the repo first.`), no partial result.
- `RepoEntry.SetPrFilesViewed(...)` wraps `SetFilesViewed` with breaker handling.

`ade` (owns `ade_gh_synced`):

- `GitHubSyncPlan(BranchArgs)`: `Prs` row for the branch -> `noPr` / `prClosed`; github disabled or
  no GitHub remote -> `disabled`; `ghMissing` / `unauthenticated` from Discovery; `account` = the
  `gh` login Discovery parsed. Else `GhSyncPlan`.
- `GitHubSyncApply(BranchArgs)`: recompute the plan server-side (never trust a client plan), mark
  `mark` rows, unmark `unmark` rows, insert/delete `ade_gh_synced` per success, return
  `marked`/`unmarked`/`failed`.
- Un-review (Q6, D13): `Store` observer -> board `onReviewChange`: if `(repoID, branch)` maps to a live
  task branch and `path` has an `ade_gh_synced` row and the new state is not `full`, queue a
  per-branch background unmark (coalesced). It takes the same per-branch mutex as `GitHubSyncApply`,
  recomputes the plan under it (a re-review before the worker runs means no unmark), unmarks only
  rule-0 rows, and leaves a failed row for the next plan (shown as `unmark`). Errors are logged with
  `scope=ade`. Nothing read from GitHub changes app review state.
- UI (prior §6.4 table unchanged): button `Sync to GitHub · N` (N = mark + unmark), shadcn Popover
  listing rows with reasons and the `gh` account, confirm `Mark N files viewed on PR #n` (`, unmark M`
  when any). `headNotFetched` offers `Refresh repo` (`Refresh`). Button hidden for `disabled`/`noPr`.

### 4.6 Rename carry-over (Q5)

In `RangeFiles` (and the sync plan's record lookup): a change of kind `renamed` with no record at
`path`, a record at `OriginalPath`, and current blob oid == that record's `blob_oid` reports the old
record's state under the new path (`changedSinceReview` false). The next mark at the new path writes
a record there. `copied` never carries. One case added to the existing `RangeFiles` test.

## 5. Streams verdict: one sequential implementer, step 0 first

A split (A: Go; B: frontend) has a clean file boundary but fails the no-ordering-dependency half of
the `CLAUDE.md` rule:

- P147/P148 split only because B called methods already in `index.ts` at `B0`. Here every B surface
  calls a P150 method (`ReviewWindowTarget` decides the window root; `LaunchReviewAgent`,
  `GitHubSyncPlan`, `OpenReviewWindow`). `index.ts` imports Wails bindings generated from Go methods,
  so B cannot even add its `index.ts` entries until A's methods exist. Step 0 cannot land the methods
  without stubs (forbidden).
- The only method-free frontend work (git-ui filter/base/hook options) is about one commit; not worth
  a worktree.
- The live smoke (§9.3) needs both halves; neither half is independently verifiable end to end.

So: **one Sonnet implementer**, commits in §7 order, backend before the frontend that calls it.
Commit 1 is the serial step 0 (contract). Ownership for the record (whole tree is one owner):

| Path | Owner |
|---|---|
| `apps/kira-space/internal/{ade,bridge,gitreview,gitsession,gitrpc,ghclient,storage}/**`, `main.go`, `internal/shell/**` | implementer |
| `apps/kira-space/frontend/src/**`, `apps/kira-space/tests/**`, `packages/git-ui/**`, `packages/git-ipc/**` | implementer |
| `internal/terminal/**` | **never** (stream C, D20) |
| `scripts/mutation/**`, `tools/mutation/**`, `.github/**` | never |

## 6. Libraries

No new dependency. GitHub GraphQL through the existing `gh` runner (`gh api graphql`); a Go GraphQL
client (`shurcooL/githubv4`, MIT) declined: `gh` owns the token and the app never reads it, which a
direct HTTP client would break. Frontend: shadcn-vue already in `packages/theme/src/components/ui/`
(Button, Textarea, Popover, Tooltip, Badge, Alert, ToggleGroup; nothing to add), Tailwind utilities
only (git-ui keeps its `kv:` prefix), VueUse (`useStorage`, `onKeyStroke`, `useTimeoutFn`), Pinia
(`adeReviewWindow`), TanStack Query (all bridge reads; `GitHubSyncApply`, `LaunchReviewAgent`,
`OpenReviewWindow` as mutations), workbench terminal (`TerminalHostView` via `AdeTuiPane`). Every Vue
file `<script setup lang="ts">`.

## 7. Commits and fast checks

Pre-commit hook (`bun run lint`, `bun run typecheck`) on every commit, never `--no-verify`. Per Go
commit also `go build ./...`, `go vet` on touched packages, `gofmt -l` empty. Bindings via `wails3 task
common:generate:bindings` whenever a bound method lands.

1. **Step 0** `feat(kira-space): P150 review contract`: §3 types, fixtures, `wire_test.go` table,
   git-ipc `review.snapshot` shape, contract version 42.
2. `feat(kira-space): pin task review sessions and snapshot reads`: gitreview `0003`, `SetPinned`,
   sweep/`Purge` skip pinned, `SetObserver`, `review.snapshot` handler, rename carry-over (§4.6).
3. `feat(shell): ephemeral windows`: `WindowOpenerDeps.Ephemeral`, `closeDecision`, registry
   `Close`/`SetTitle`.
4. `feat(kira-space): review windows`: migration `0012`, repos for `ade_review_windows`,
   `WindowsRepo.List` filter, boot purge, `OpenReviewWindow`, `ReviewWindowTarget`, archive hooks,
   `index.ts`, mock runtime FQNs.
5. `feat(kira-space): per-task review agent`: `purpose`, dir helper, `launchReviewAgent`,
   `ReviewAgent`, `LaunchReviewAgent`, `LaunchStage`/`TakeOver` routing, `index.ts`.
6. `feat(kira-space): GitHub viewed sync`: `ghclient.graphql`/`PullFiles`/`SetFilesViewed`,
   `GhSyncPlan`, `GitHubSyncPlan`/`Apply`, observer-driven unmark, `index.ts`.
7. `feat(git-ui): review base override, needs-review filter, mark hook`.
8. `feat(kira-space): content-based review diff left side`.
9. `feat(kira-space): review window shell`: boot switch, layout, header, banner, store, queries.
10. `feat(kira-space): review agent panel`: hosting states, compose, turn watch, busy rule, `Ask
    review agent`, session label, `userStageAction` tweak.
11. `feat(kira-space): GitHub sync UI`.
12. `feat(kira-space): Review code button`.
13. `test(kira-space): review window UI specs`.
14. Fixes from §9 as follow-up commits, then the closing step (§10).

Expensive suites run once near the end, not per commit.

## 8. Tests (CLAUDE.md bar)

Earn a test:
- Go `TestGhSyncPlanRule`: table over rules 0-6 + `notInPr` + `headNotFetched` + rename carry-over.
- Go `TestSetFilesViewed_ArgvGolden` (mark, unmark, `@`-path via `-f`, alias error mapping) and
  `TestPullFiles_Pagination` with a fake `ghclient.Runner` (precedent
  `TestOpenPulls_ArgvGoldenAndEarlyStop`).
- Go `store_test.go`: sweep and `Purge` skip pinned; unpin then purge deletes.
- Go `registry_test.go`: `closeDecision` table (ephemeral, last real, real with others).
- Go board test: un-review queues an unmark; a re-review before the worker runs sends none; a failed
  unmark keeps the row (concurrency + interacting rules). Fake gh runner, temp review store.
- Go `RangeFiles` test: one renamed-unchanged case.
- UI (`tests/ui`, mock runtime): review window boots three panes for a target, normal workbench for
  `null`; Needs review hides a reviewed-unchanged file; Send disabled on activity `input`;
  `Start review agent` when no session; sync button hidden for `noPr`, popover lists reasons.

No test for: `OpenReviewWindow`/`ReviewWindowTarget` CRUD, `review.snapshot` pass-through,
`SetPinned`, `composeReviewMessage`, the dir helper (already exercised by `LaunchStage` tests).

All new Go tests use a temp `Registry.Review`/`KIRA_SPACE_HOME` (D20); none opens the real
`review.db`.

## 9. End checks, acceptance, live smoke

### 9.1 End checks

Fast: `bun run lint`, `bun run typecheck`, `go build ./...`, `bun run lint:go`, `bun run lint:dead`,
`gofmt -l apps internal` empty.
Suites (once, end): `go test ./apps/kira-space/... ./internal/shell/...`, `bun run test:unit`,
`bun run test:webview` (git-ui), `bun run test:ui:space`, `bun run test:visual:space` (baseline update
only for the new window if a visual spec covers it), `bun run build:vscode` (contract 42).

### 9.2 Acceptance (orchestrator verifies with real checks)

- Every §0 item maps to a commit and a §9.3 step.
- `grep -c '^func (s \*AdeTaskService)' apps/kira-space/internal/bridge/adetask*.go` totals 53;
  53 `adeTask*` in `frontend/src/bridge/index.ts`; 28 files in `tests/fixtures/ade-v2/`.
- Real callers exist for `SetFilesViewed`, `PullFiles`, `review.snapshot` (in `RepoDiffView.vue`),
  `LaunchReviewAgent`, `OpenReviewWindow`, `SetPinned`, `SetObserver`, `closeDecision`.
- No change under `internal/terminal/**`, `scripts/mutation/**`, `tools/mutation/**`.
- Migration files: `0012_p150_review.sql` (Space), `0003_p150_pin.sql` (gitreview).
- Hooks green on every shipped commit.

### 9.3 Live smoke (sandbox, server-tag recipe in `DEV_ENVIRONMENT.md`)

One shell invocation per run (start, poll, drive, kill), scratch files in the scratchpad, nothing
committed:

1. Build `go build -tags server ./apps/kira-space/...`; temp `KIRA_SPACE_HOME`; seed
   `windows('main')`, `code_repos`, `git.path` rows. Scratch repo with branch `feat/p150` (3 changed
   files) and `origin` URL `https://github.com/kira-scratch/p150.git`.
2. **Fake `gh`** first on `PATH` (Discovery uses `exec.LookPath`): answers `--version`, `auth status
   --hostname github.com` (ok, account `kira-scratch`), the REST pulls queries (one open PR for
   `feat/p150`, `headRefOid` = local tip), `api graphql` file queries (state per file from a JSON
   file the script reads) and mutations (appends argv to a log, flips state). **Fake `claude`** first
   on `PATH`: logs argv and raw stdin bytes (`cat -v`) to a file. Confirm through
   `/proc/<pid>/cmdline` that the launched process is the fake; if the login shell drops the `PATH`
   prefix, fall back to the P149 method (real `claude` argv from `/proc`, hook shim for
   `UserPromptSubmit`/`Stop`) and say so.
3. Create a task with the branch; `OpenReviewWindow` -> `true`, rows in `windows` and
   `ade_review_windows`, `review_session.pinned = 1`; second call -> `false`.
4. Playwright on `/?window=<reviewKey>`: three panes, header title, Needs review lists 3 files. Mark
   2 reviewed. Commit a change to one of them, `git commit --amend` + rewrite the branch (old tip
   unreachable). Reload: Needs review lists 1; its diff tab's left side equals the stored snapshot
   (`review.snapshot` text == reviewed bytes).
5. Ask a question with a selection -> fake `claude` log shows `ESC[200~[<repo> feat/p150 · <path>:L…]
   …ESC[201~` then `\r`; argv shows `--session-id`, `--add-dir` for other branches, ` -- ` first
   message. Stop the session (kill PTY), `LaunchReviewAgent` again -> same row id and
   `claudeSessionId`, argv `--resume <id>`. `LaunchStage` on a task in stage `review` -> same row.
6. `GitHubSyncPlan` -> one `mark`, one `changedSinceReview`, one `notReviewed`; `GitHubSyncApply` ->
   fake gh log has one aliased `markFileAsViewed`, `ade_gh_synced` has the row. Un-review that file in
   the window -> fake gh log gains `unmarkFileAsViewed`, row gone. `git mv` an unchanged reviewed file
   and commit -> still reviewed.
7. Kill and restart the server: leftover review rows purged at boot, `windows('main')` and its tabs
   intact.

Native close/hide behaviour (main closed while a review window is open) is not observable in a
server build: covered by `closeDecision`'s test; the Wails wiring is recorded as unobserved in the
result unless a desktop build is available.

### 9.4 Real-account verifications

- **V2 real Claude Code paste**: the sandbox has no Claude login (Known open item "An interactive
  `claude` turn is unobservable"). Not repeatable here; the closing step extends that item with the
  review agent (`--add-dir` resume, paste into a `working` turn, the 10 s no-submit hint).
- **V3 real GitHub mark/unmark**: run `gh auth status`. If authenticated: on a scratch PR, one sync
  marks a file (GitHub UI shows Viewed), un-review unmarks it; record the decisive line. If not, the
  orchestrator asks the user once for a token; without one, the closing step adds Known open item
  "GitHub viewed sync unobserved against real GitHub (P150)" with this recipe. The schema half is
  already verified offline (D19).

## 10. Closing step (after §9 fixes land)

`docs(v2.0): P150 result` (serial, same implementer):
- This file's `## Result`: commits, drift met during implementation, §9.3 outcome per step (one
  decisive line each), V2/V3 outcome, test files touched (for P154), `codegraph_explore` count.
- `docs/v2.0/SPEC.md` P150 row status -> implemented (or the precise open part).
- `docs/ARCHITECTURE.md` ADE section: new `### Review code` subsection (window kind and ephemerality,
  pinning, snapshot left side, review agent rules incl. stage id `review` and the cwd-gone rule,
  server-side unmark, `gh api graphql`); "binds 53 methods"; "28 fixtures"; storage list adds `0012`;
  Known open items updated per §9.4.
- `docs/DEV_ENVIRONMENT.md`: the fake `gh`/fake `claude` on `PATH` fact, only if it held.

## 11. Carry-forward

- P156 takes Space migration `0013` (not `0012`); its SPEC row already says "check P150 first".
- P154 rebases over the P150 test files listed in the result.
- Unobserved real-account checks stay as Known open items until run on an authenticated desktop
  build.

## Result

Commits on `v2.0` after the plan `8728967c`: `78ae1e85` contract, `3ade5a29` pin and snapshot reads,
`81212f81` ephemeral windows, `617f52b6` review windows, `7e58761a` review agent, `fcef1cc3` GitHub sync,
`c3efaedc` git-ui review base/filter/mark hook, `002ffed3` since-review diff, `bc99bb7c` window shell,
`6af00b2f` agent panel, `93733ba5` sync UI, `f0b70709` contract-42 chunk fixture, `56464452` Review code
button, `680fdcbc` git-ui `setTarget(open)`, `53870ffa` UI specs, `d297331d` smoke fixes, `4d1d5429`
gocognit/prealloc refactors, `7e19759d`, `487dd031` UI spec fixes, `d3b196ad` knip. No `--no-verify`.

**Drift and deviations:**
- Commit 2 (`3ade5a29`) shipped with a bridge test red; fixed in commit 4 (`617f52b6`).
- git-ui `ReviewTarget` gained `pane?`; `setTarget(repoId, branch, {base, pane})` and `open` so the window
  resolves once (`680fdcbc`).
- A single-line reference renders `L<n>`, not `L<n>-<n>`.
- Step 4 listed 2 files after the rewrite, not 1 (the amended file and the one never reviewed).
- Sync reason for a rewritten, reviewed file is `differsFromPrHead`, not `changedSinceReview`.
- `useDiffEditor` (shared) now holds Monaco objects in `shallowRef`: a deep `ref` hung the page.
- The sessions fixture review session `rv01` is stopped, so two UI specs count it (`487dd031`).

**Bugs the smoke found (`d297331d`):** `repository not open` (git socket needs `repo.open`; files pane now
calls `ensureRepoOpen`); page freeze (Monaco in a deep `ref`); tab strip filled the centre column.

**§9.3 outcome:** 1 built and seeded; 2 fake `gh`/`claude` ran only with a `HOME` override (login shell
reorders `PATH`), `/proc/<pid>/cmdline` showed the fake; 3 `OpenReviewWindow` true then false, rows and pin
present; 4 three panes, 3 files listed, after rewrite 2 listed, left side equals stored snapshot; 5 fake
`claude` log shows bracketed paste then `\r`, `--add-dir`, `--resume` same row and `claudeSessionId`,
`LaunchStage` on `review` reuses the row; 6 plan lists `mark`, skip, `notReviewed`; apply logs one aliased
`markFileAsViewed` and writes the ledger; un-review logs `unmarkFileAsViewed` and drops the row; rename keeps
review; 7 no record kept of a restart check: `purgeReviewWindows` runs at boot (`main.go`), unobserved live.
Native close/hide wiring unobserved (server build); `closeDecision` test covers the rule.

**V2/V3:** both unobserved (no Claude login; no authenticated `gh`). Known open items added.

**Suites (final tip):** `go build`, `go vet`, `bun run lint:go` 0 issues, `go test ./...` pass,
`lint:all` pass, `test:unit` 1765 pass, `test:ui:space` 158 pass before two spec count fixes (3 failed,
fixed, rerun green), `test:webview` 60 pass, `test:visual:space` 4 pass, `test:visual:studio` 14 pass.

**Test files touched (for P154):** `tests/ui/ade-v2-review.spec.ts` (new), `ade-v2-sessions.spec.ts`,
`ade-v2-needs.spec.ts`, `tests/ui/fixtures.ts`, `tests/ui/support/{ipcChannels,mockRuntime}.ts`,
`tests/unit/ade-v2-dialog.spec.ts`, `tests/fixtures/ade-v2/*`.

**`codegraph_explore`:** 7 calls in this implementer's transcript.
