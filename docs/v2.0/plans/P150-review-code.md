# P150 Review code: per-branch review window, review agent, GitHub viewed sync

Plan only. User-requested phase, placed after P149. **Status: approved by user, ready to implement
(all of §12's Q1-Q7 resolved); P150 still must be re-verified against the then-current tree (§0).**

## 0. Base and re-verification

- Written against `70440ae` (`v2.0`, P143 landed). P144-P149 not landed.
- **P150 starts only after P149 lands.** Its implementer first re-verifies every §2 assumption and
  every path/symbol below against the then-current tree (`codegraph_explore` first), and records
  drift in this file's result section before writing code. A failed assumption that changes scope
  stops the phase and goes back to the user, never silently re-scoped.
- Inputs: user request (verbatim intent in §1), `design/ade-v2/SPEC2.md` (§2 Session, §5 user stages
  with `session: true`, Take over), `plans/P143-ade-v2-preplan.md` §3 rules, §6 decisions,
  `plans/P143-wire-contract.md`.

## 1. Ask (restated, nothing narrowed)

1. Per branch of a task: **Review code** button. Opens a **new window** that reviews only that
   branch's changes.
2. **Content-based "since review"**: next review shows only what differs from what the user last
   reviewed, whatever produced the change (later stages, other agents, rebases). Repeatable: review,
   leave, come back, review the delta.
3. **AI questions panel** in that window. Questions go to the task's **review agent**: an interactive
   TUI Claude Code session, **one per task**, reused (resumed) for the whole task, with every branch of
   the task as context. Interactive chat for any intent. The `▶ Review` stage button uses the same
   agent (§5.4).
4. **GitHub sync**: when the branch has a PR (now or later), a button marks the user's fully
   reviewed files as viewed on GitHub, and un-reviewing a file unmarks it (only files this app
   marked). One-way app -> GitHub. Partial-file reviews never sync.
5. Reuse the existing Git-module review stack, not a parallel one.

## 2. Assumptions about P144-P149 (re-verify at start)

| # | Assumption | Source | If false |
|---|---|---|---|
| A1 | `ade_tasks`, `ade_task_branches` exist; a `Branch` has `codeRepoId`, `name`, `base`, `worktree`, `taskId` | P143 wire, P144 A | Stop, re-plan data model |
| A2 | `ade_sessions` has `mode`, `task_id`, `branch_id`, `stage_id` (P146's migration, not P144's); TUI sessions spawn/resume through `ade.Tracker.Prepare`/`Compose` (`claude --session-id` / `claude --resume`) | P146 A, P147 A | Stop |
| A3 | `AdeTaskService.Send(SendArgs)` writes bracketed paste + Enter to a live TUI (`Tracker.Send`, `ade/paste.go`) | P143 §4, P147 A | Port `Tracker.Send` into the v2 surface in this phase |
| A4 | `Prs` returns PR per branch id via `gitsession` `ResolveBranchPr`/`ensureSnapshot` | P143 §4, P144 A | Add lookup here |
| A5 | TUI activity per `terminalId` reaches the frontend via `agentEvent` (`input`/`working`/`waiting`/`idle`) | P143 §5 "reused unchanged" | Stop: §5.4 busy rule needs it |
| A6 | Highest Space migration after P148 is `0010` (P144 `0008`, P146 `0009` `ade_sessions` rebuild, P148 drops v1 tables); P150 takes the next free number (`0011` expected) | preplan §1, §4 P146 | Take next free number |
| A7 | Branch panel (P146 B), Review/user-stage block (P147 B) and branch-row context menu exist in `frontend/src/ade/v2/**` | preplan §4 | Put the button where the then-current UI has branch actions |
| A8 | `adeTaskSessions` push fires on TUI spawn/stop | P143 §5 | Emit it here |

## 3. Audit: existing review module vs ask

Already there (reuse as is):

| Piece | Where | What it does |
|---|---|---|
| Review store | `apps/kira-space/internal/gitreview` (`review.db`, `0001_g11_review.sql`, `store.go`) | Per `(repo_id, branch)` session; per path: `state` full/partial, `reviewed_at_sha`, `blob_oid`, compressed **content snapshot** (≤1 MiB text), ranges in snapshot coordinates |
| Delta | `gitsession/incremental.go` `FileDelta` | Tier 0 blob-oid equality (`unchanged`), tier 1 `git diff reviewedAtSha tip -- path` (`fast`), tier 2 `git diff --no-index snapshot current` when the reviewed commit is unreachable or pruned (`slow`) |
| File list | `RangeFiles` (`review.files`) | `mergeBase..tip` changes joined with records; `changedSinceReview = currentOID != rec.BlobOID` (content, not commits) |
| Marking | `MarkFile` (`review.mark`), keyed mutex, re-snapshot at tip; ranges via `review.fileDiff` | Full and partial (line ranges) |
| UI | `packages/git-ui` `ReviewView.vue`, `ReviewFilesPane.vue`, `state/review.ts` (`ReviewSessionState`), `state/reviewFiles.ts` (`ReviewFilesState`, `sinceReview`/`range` modes) | Commits/files/comments panes, mark toggle, delta status text |
| Host glue (Space) | `frontend/src/repo/RepoReviewView.vue` (`mountReview`), `repo/git/hostHandlers.ts` (`editor.openRangeDiff` -> `state/repoTabs.ts` `openRepoReviewDiffTab`), `views/repo/RepoDiffView.vue` + `reviewDecorations.ts` (mark/comment layer in Monaco) | Diff tabs with review layer |
| VS Code host | `apps/kira-space-vscode/src/reviewView.ts`, `reviewMarking.ts` | Not touched by P150 |
| gh | `internal/ghclient` (`Discovery` auth probe with TTL, `Client.get` = `gh api --method GET`, `PullsForBranch`, `OpenPulls`), `gitsession/gh.go` (snapshot, breaker on rate limit, `githubEnabled`), `bridge/github.go` | PR lookup only, read-only REST |
| Live TUI injection | `ade.Tracker.Send` -> `deps.WriteTerminal` (bracketed paste, then `\r`); `terminal.Registry` is process-wide, keyed by terminal id | Text into a running Claude Code TUI from any window |
| Windows | `internal/shell` `OpenWindow`, `OpenNewWindow`; URL `/?window=<key>`; `windows` table rows (tabs FK `ON DELETE CASCADE`); `terminal.Registry.CloseWindow` on close; `Registry.WindowOf`; `AdeService.FocusSession`/`FocusWindow` | Persisted workbench windows |

Key finding: **"since review" is already content-based per file** (blob oid + stored snapshot), so
changes by later stages, other agents and rebases already surface. P150 adds no new diff engine.

Gaps P150 closes:

| # | Gap | Fix (§) |
|---|---|---|
| G1 | No "show only what needs review" view; the list shows the whole `mergeBase..tip` set | Needs-review filter (§5.2) |
| G2 | Diff tab's left side in `sinceReview` mode is `reviewedAtSha:path`, a commit. Pruned or GC'd after a force-push -> broken left pane, though the snapshot exists | `review.snapshot` method, left model from snapshot (§5.3) |
| G3 | Reaper deletes sessions idle 14 days (`gitreview.IdleTTL`); `ResolveBranchPr` purges on closed/merged PR (D20). A long task loses its review state | `pinned` flag: task branches exempt until task archive (§4.1) |
| G4 | Review base resolves from upstream/`origin/HEAD`; a task branch's base is `Branch.base` (stacked branches) | Pass base as override in the window's target (§5.2) |
| G5 | Only committed tip is reviewed; agent edits left uncommitted in the worktree are invisible | Banner from `Branch.dirty` only (§5.2); worktree state is never reviewed (decided) |
| G6 | No review window; windows are all persisted workbenches restored on relaunch | Ephemeral review window kind (§5.1) |
| G7 | No per-task review agent; no questions panel | §5.4 |
| G8 | `ghclient` is GET-only REST; no PR node id; no viewed-state read or write | GraphQL via `gh api graphql` (§6) |
| G9 | Rename loses review (record keyed by path) | Carry over when content is unchanged (§5.6) |

## 4. Data model

### 4.1 `review.db` (`internal/gitreview`), migration `0003_p150_pin.sql`

- `review_session.pinned INTEGER NOT NULL DEFAULT 0`.
- `sweepDB`: `WHERE last_used_at < ? AND pinned = 0`. `Purge` (D20 seam): skip pinned unless
  called with `force`.
- `Store.SetPinned(ctx, repoID, branch, pinned bool)`: creates the session row if missing (pin
  before first mark), else updates.
- Stays keyed `(repo_id, branch)`. A task branch maps 1:1 to that pair (A1), so per task+branch
  state needs no new key. Reviewed state never moves into the Space DB: one store, the Git module
  and the review window see the same marks.

### 4.2 Space DB, migration `0011_p150_review.sql` (number per A6)

- `ade_sessions.purpose TEXT NOT NULL DEFAULT ''` (`''` | `'review'`); unique partial index
  `ON ade_sessions(task_id) WHERE purpose = 'review'` -> exactly one review agent per task, enforced
  by the DB.
- `ade_review_windows(window_key TEXT PRIMARY KEY REFERENCES windows(key) ON DELETE CASCADE,
  task_id TEXT NOT NULL, branch_id TEXT NOT NULL, created_at INTEGER NOT NULL)`, unique on
  `branch_id` (one review window per branch).
- `ade_gh_synced(branch_id TEXT NOT NULL REFERENCES ade_task_branches(id) ON DELETE CASCADE,
  path TEXT NOT NULL, pr_number INTEGER NOT NULL, marked_at INTEGER NOT NULL, PRIMARY KEY (branch_id,
  path))`: paths this app marked viewed on GitHub. Only these are ever unmarked (§6.3), so the user's
  own GitHub viewed state is never touched. GitHub's `viewerViewedState` is still read before each
  push to avoid redundant writes.

### 4.3 Lifecycle hooks

- `OpenReviewWindow`: `SetPinned(gitRepoId, branch, true)`.
- Task archive (P147 A `ArchiveTask`): unpin + `Purge(force)` every branch, close its review
  windows, stop the review agent (already stops all TUI sessions), delete its `ade_gh_synced` rows
  (no GitHub call on archive).
- Branch removed from task: unpin that branch.

## 5. Architecture

### 5.1 Review window (Go, Space-only + one shared shell seam)

- `bridge` method `OpenReviewWindow(BranchArgs) -> boolean`: branch must be created (`name != ''`)
  and repo held. Existing row for `branch_id` -> focus that window (`FocusWindow`), return `false`.
  Else mint key, `WindowsRepo.Create`, insert `ade_review_windows`, `shell.OpenWindow(winDeps, rec)`
  (cascade from current window), return `true`. `winDeps` reaches the service the same way
  `windowsSvc.OpenNewWindow` / `adeSvc.FocusWindow` closures do in `main.go`.
- Window context: frontend reads `windowKey` (`packages/workbench/src/util/window.ts`), calls
  `ReviewWindowTarget({windowKey})`. Non-null -> review root; null -> normal workbench. No URL
  change, so `shell.Options` stays untouched and the target survives a webview reload.
- Ephemeral, never restored on relaunch (decided; no restoration work in this phase): Space
  `WindowsRepo.List` excludes rows in `ade_review_windows` (startup restore and
  `ReopenWindows` never revive one). Boot deletes leftover review rows (crash case) before windows
  open.
- Shared seam (`internal/shell`): `WindowOpenerDeps.Ephemeral func(key string) bool` (nil in Studio).
  `OpenWindow`'s close handler and `AttachCloseFlush`'s last-window predicate count only
  non-ephemeral windows, and an ephemeral window's row is always deleted on close. Without it,
  closing the main workbench while a review window is open deletes the main row and the user's
  tabs. Studio behaviour unchanged (nil).
- Task archive / branch removal / branch deleted: close the window (`WindowRegistry` lookup ->
  `Close()`).
- Title: `Review · <repo nickname> · <branch>` via `SetTitle` after open.

### 5.2 Review window UI (frontend)

Layout, three panes, shadcn-vue + Tailwind utilities, resizable with the existing panel resize
handle:

- **Left: review sidebar.** Mount git-ui `view: 'review'` exactly as `RepoReviewView.vue`
  (`gitTransportFor(codeRepoId)`, `NullViewStateStore`), target `{repoId: gitRepoId, branch,
  base}` with `base = Branch.base` as override (G4). If git-ui's mount target lacks `base`, add an
  optional `base` that `ReviewSessionState.setTarget` applies as an override (reason `'override'`,
  existing union member).
- **Needs-review filter (G1)**: `ReviewFilesPane` gets a toggle `Needs review | All`, default
  `Needs review` = `review.kind === 'none' || review.kind === 'partial' || review.changedSinceReview`.
  Count badge on the toggle. Additive prop, default `All`, so the VS Code host and Git module keep
  today's behaviour unless they opt in. Empty state: `Nothing changed since your last review.`
- **Centre: diff tabs.** The window's own tab store (`windowKey`-scoped tabs, cascade-deleted with
  the row). `editor.openRangeDiff` already routes through `hostHandlers.ts` to
  `openRepoReviewDiffTab` in the window that asked. Implementer verifies the repo workspace for
  `codeRepoId` is opened in this window at boot so `repoWorkspaceKey` tabs render.
- **Right: AI questions panel** (§5.4).
- **Header strip**: task colour square, task title (2-line clamp, SPEC2 §5.2), repo nickname,
  branch, base marker; `Sync to GitHub` button (§6); uncommitted banner when `Branch.dirty` is
  non-empty: `3 uncommitted changes in the worktree are not in this review` (G5; banner only, worktree
  state is never added to the diff).
- **Review code button** (main window, A7): branch panel header actions, branch-row right-click
  menu, and one per branch in the Review stage block. Calls `OpenReviewWindow`. Disabled with
  tooltip for a not-created branch.
- State: Pinia `adeReviewWindow` store (target, panel widths, filter mode, compose draft). Server
  state through TanStack Query: `ReviewWindowTarget`, `ReviewAgent`, `Prs`, `GitHubSyncPlan`,
  `Board` slice for the task. Invalidation on `adeTaskBoard`, `adeTaskSessions`. VueUse
  `useStorage` for per-window pane widths only (convenience, not state that must persist).

### 5.3 Content-based left side (G2)

- git-ipc method `review.snapshot {repoId, branch, path} -> {kind: 'none' | 'text' | 'binary' |
  'tooLarge' | 'absent', text: string | null, reviewedAtSha: string | null}` from
  `Store.Record` (`gitreview.Decompress`). Mirrors in `packages/git-ipc/src/contract.ts` +
  `validate.ts` and `internal/gitrpc/{contract,wire,handlers}.go`.
- `RepoDiffView.vue` with `review` set and `left === reviewedAtSha` (sinceReview mode): left model
  from `review.snapshot` when `kind === 'text'`; else falls back to today's rev read. Marks and
  `reviewDecorations.ts` unchanged (they already project ranges through `FileDelta`).
- Outcome: the left pane is exactly the bytes the user reviewed, whatever happened to the commit.

### 5.4 Review agent and question forwarding

Mechanism, verified in code: `Tracker.Send(recordId, message)` writes `ESC[200~ … ESC[201~` then
`\r` to the session's PTY through the process-wide `terminal.Registry`. Works from any window. The
pause between paste-end and Enter is unverified (`paste.go` comment, P129 Part 1 §8); §10 V2
verifies it against real Claude Code. No other injection path is needed or invented.

- **One per task**: `ade_sessions` row with `purpose = 'review'`, `mode = 'tui'`, `task_id`,
  `branch_id = ''`. Created on first launch, resumed (`claude --resume <claudeSessionId>`) on every
  later launch. Same Claude conversation for the whole task.
- **Hosting**: a TUI PTY belongs to the window that opened it (`CloseWindow` kills it on close).
  One agent terminal per task, shared by all of that task's review windows: the window that
  launches the agent hosts it in the questions panel. Closing that window stops the session; next
  launch resumes it. If the agent already runs in another window (another branch's review window, or
  the main window's Sessions tab), this window shows `Review agent is open in another window` +
  **Focus** (`FocusSession`), and the compose box still sends through `Send`. One process, never
  two.
- **Launch** (`LaunchReviewAgent{taskId, windowKey}` -> `Launch`): new or resume via
  `Tracker.Prepare`. cwd = first created branch's worktree in task order (D12 rule); every other
  branch's worktree (or the repo's main checkout when no worktree) via `--add-dir`, recomputed on
  each resume so branches added later join. Requires extending `PrepareArgs`/`newCommand`/
  `resumeCommand` with `AddDirs` (`claude --help` lists `--add-dir <directories...>`, verified
  installed CLI). App sets no permission mode (D6 spirit); interactive for all intents.
  First-launch message (fixed text, sent once as the initial prompt):
  ```
  You are the review assistant for task: <title>
  - Jira: <key> <url>
  - Notes: <notes, first 2000 chars>
  - Branches:
    - <repo nickname>: <branch> (base <base>) worktree <path>
  I review these branches in Kira Space and will ask you questions about them. Answer from the code;
  change files only when I ask you to.
  ```
- **Compose box** (questions panel, below the terminal): Textarea + Send (⌘Enter). Prefix built
  client-side from context: `[<repo> <branch> · <path>:L<start>-L<end>]` when a diff tab is active
  with a selection, else `[<repo> <branch>]`. Diff editor context menu `Ask review agent` prefills
  the selection reference. Sends through `Send{sessionId, message}`.
- **Busy rule**: send refused (button disabled, tooltip) while the agent's activity is `input`
  (a permission prompt or question waiting): a paste would land in that prompt. `working`: allowed
  only if V2 shows Claude Code queues pasted input during a turn; otherwise disabled too. Not running
  -> button reads `Start review agent` (launch, then send).
- **`▶ Review` is the same agent.** The SPEC2 Review user stage button (`▶ Review`, stage with
  `session: true`, identified as the user stage with id `review`; implementer confirms the rule
  against P147's stage-session code) launches or resumes this per-task review agent instead of a
  separate stage session, and so does `Review code`. Resumed every time, including when the user
  returns days later to re-review (`claude --resume <claudeSessionId>`). Hosting follows the rule
  above (the `▶ Review` click hosts it in the main window's session view).

### 5.6 Rename carry-over (G9)

A renamed file whose content is unchanged keeps its review. In `gitreview` `RangeFiles` (and the
sync plan's record lookup), a changed file reported as renamed `old -> new` with no record at `new`,
a record at `old`, and current blob oid == that record's `blob_oid` resolves to the old record's state
under `new` (`changedSinceReview` false). The next mark at `new` writes a record there. A rename with
edits does not carry (today's behaviour: reviewed state is by content, so it shows as never reviewed).
Resolved server-side, so no wire change. Implementer verifies `RangeFiles` runs rename detection
(`-M`) and exposes the old path internally; adds it if not. One case added to the existing
`RangeFiles` test, no new test file.

### 5.5 IPC summary (contract extension, serial commit 1)

Preplan §3 rule 1 applies: one serial commit changes Go `adewire` + TS `ade/v2/wire.ts` +
fixtures + git-ipc contract together.

`AdeTaskService` methods:

| Method | Args | Result |
|---|---|---|
| `OpenReviewWindow` | `BranchArgs` | `boolean` (true opened, false focused existing) |
| `ReviewWindowTarget` | `WindowKeyArgs {windowKey}` | `ReviewWindowTarget \| null` |
| `ReviewAgent` | `TaskArgs` | `ReviewAgentState {session: Session \| null; hostWindowKey: string}` |
| `LaunchReviewAgent` | `LaunchReviewAgentArgs {taskId; windowKey}` | `Launch` (E_INVALID if running) |
| `GitHubSyncPlan` | `BranchArgs` | `GhSyncPlan` |
| `GitHubSyncApply` | `GhSyncApplyArgs {branchId; unmarkOnly}` | `GhSyncResult` |

Reused unchanged: `Send`, `FocusSession`, `Prs`, `Board`. Types:

```ts
interface ReviewWindowTarget { taskId: string; branchId: string; codeRepoId: string; gitRepoId: string;
  branch: string; base: string; worktree: string }
type GhSyncStatus = 'ok' | 'noPr' | 'prClosed' | 'disabled' | 'ghMissing' | 'unauthenticated'
  | 'unavailable' /* rate limit, network, GitHub error */ | 'headNotFetched';
interface GhSyncFile { path: string; action: 'mark' | 'unmark' | 'alreadyViewed' | 'skip';
  reason: '' | 'notReviewed' | 'partial' | 'changedSinceReview' | 'differsFromPrHead' | 'notInPr' }
interface GhSyncPlan { status: GhSyncStatus; message: string; pr: PR | null; headSha: string;
  localTip: string; files: GhSyncFile[] }
interface GhSyncResult { status: GhSyncStatus; message: string; marked: string[]; unmarked: string[];
  failed: { path: string; error: string }[] }
```

`Session` gains `purpose: '' | 'review'`. Fixtures: `review-target.json`, `review-agent.json`,
`gh-sync-plan.json` (one file per action/reason), `gh-sync-result.json` (one failure);
`sessions.json` gains one review session. Go decode test table +4 (count updated in the test).
No new push channel: `adeTaskSessions` and `adeTaskBoard` cover invalidation.

## 6. GitHub viewed sync

### 6.1 Verification done for this plan

- Installed `gh 2.89.0`; `gh api graphql` sends POST with `-f`/`-F` variables (`gh api --help`).
- GitHub GraphQL docs (Pulls reference): `markFileAsViewed(input: {pullRequestId: ID!, path:
  String!, clientMutationId})` returns `pullRequest`; `unmarkFileAsViewed` takes the same input
  shape (documented next to it, not verified live here); `PullRequestChangedFile.viewerViewedState:
  FileViewedState!` = `VIEWED | UNVIEWED | DISMISSED` (`DISMISSED` = new changes since viewed);
  `PullRequest.files(first, after)`.
- **Not verified live**: this sandbox's `GH_TOKEN` is invalid (`gh auth status` fails). V3 (§10)
  runs `gh api graphql -f query='{__type(name:"MarkFileAsViewedInput"){inputFields{name}}}'` (and the
  same for `UnmarkFileAsViewedInput`) and one real mark and one real unmark on a scratch PR before the
  code is called done. No assumption ships unverified;
  a mismatch stops the phase and goes to the user.

### 6.2 `ghclient` additions

- `Client.graphql(ctx, repo, query string, vars map[string]string, out any) Status`: same auth gate
  as `get` (`discovery.Status`, no spawn when not ok), argv `api graphql --hostname <host> -f
  query=<q> -F/-f <vars>` (strings via `-f`, never shell-joined), shared `classify`; GraphQL
  `errors[]` in a 200 body -> `KindForbidden` with the first message as `Reason`.
- `PullFiles(ctx, repo, number) (PullFiles{NodeID, HeadSha, State, Files []{Path, Viewed
  string}}, Status)`: one query `repository(owner,name){pullRequest(number){id headRefOid state
  files(first:100, after:$c){nodes{path viewerViewedState} pageInfo{hasNextPage endCursor}}}}`,
  paged to the end (GitHub caps PR files at 3000; stop there).
- `SetFilesViewed(ctx, repo, prNodeID, paths []string, viewed bool) (failed map[string]string,
  Status)`: one mutation per chunk of 50 using aliases (`m0: markFileAsViewed(input:{pullRequestId:$pr,
  path:$p0}){clientMutationId}` …, `unmarkFileAsViewed` when `viewed` is false); per-alias errors
  map to `failed`.
- Rate-limit breaker: reuse `gitsession` `armBreaker`/`breakerStatus`.

### 6.3 Plan rule (`gitsession`, one function, unit-tested)

For each path in the PR's file list, first match (records resolved with §5.6's rename carry-over):

0. path in `ade_gh_synced` for this branch and the review is not full (`none` or `partial`) ->
   `unmark` (GitHub already `UNVIEWED`: drop the row silently, no listing)
1. no review record or `kind none` -> `skip notReviewed`
2. `partial` -> `skip partial` (GitHub has no partial-file review)
3. `changedSinceReview` (local tip blob != reviewed `blob_oid`) -> `skip changedSinceReview`
4. PR head blob oid of path != reviewed `blob_oid` -> `skip differsFromPrHead`
5. `viewerViewedState == VIEWED` -> `alreadyViewed`
6. else (`UNVIEWED` or `DISMISSED`) -> `mark`

Reviewed files absent from the PR list -> `skip notInPr` (listed so the user sees why); their
`ade_gh_synced` rows are dropped.
Rule 4 makes the sync content-based too: a force-pushed PR head still syncs every file whose bytes
match what the user reviewed. PR head blob oids come from `blobOIDs(headSha, paths)` (batched
`cat-file --batch-check`); `headSha` missing locally -> status `headNotFetched`, message `PR head
<sha7> is not fetched. Refresh the repo first.`, no partial result.

`GitHubSyncApply` recomputes the plan server-side (never trusts a client plan), marks `mark` rows and
unmarks `unmark` rows (`unmarkOnly` skips the marks), records each success in `ade_gh_synced` (insert
on mark, delete on unmark), returns `marked`/`unmarked`/`failed`. Un-review trigger: the review window
calls `GitHubSyncApply{unmarkOnly: true}` after the user un-reviews a file when a PR is open and sync
is available; a failure leaves the row for the next call (button or later un-review). Implementer
verifies git-ui exposes a mark-changed hook for the host and adds an optional host action if not. Only
fully reviewed files are ever marked; only paths in `ade_gh_synced` are ever unmarked. One-way:
nothing read from GitHub changes app review state; `viewerViewedState` only avoids redundant writes.

### 6.4 Error cases

| Case | Status | UI |
|---|---|---|
| `github.enabled` off or no GitHub remote | `disabled` | Button hidden |
| No PR for branch (`Prs` empty) | `noPr` | Button hidden; appears when `Prs` later returns one (board refresh / window focus refetch) |
| PR closed or merged | `prClosed` | Button disabled, tooltip `PR #n is closed` |
| `gh` not found | `ghMissing` | Button disabled, `Install the GitHub CLI (gh)` |
| `gh auth status` fails for host | `unauthenticated` | `Run gh auth login --hostname <host>`; recheck on next click (Discovery TTL 30s) |
| Rate limited / network / GitHub error | `unavailable` | Message from `Status.Reason`; breaker respected |
| PR head not local | `headNotFetched` | Message + `Refresh repo` action (P144 `Refresh`) |
| Force-pushed head, local tip differs | `ok` | Rule 4 decides per file; header shows `PR head a1b2c3d ≠ local e4f5a6b` |
| Some mutations fail | `ok` | `Synced 7 files · 2 failed` + per-file errors; failed unmarks retry next call |
| Nothing to mark | `ok` | `Nothing to sync` with skip reasons expandable |

Viewed state on GitHub is per authenticated `gh` user; dialog states which account (`Discovery`
already parses it).

Sync UI: button `Sync to GitHub · N` (N = `mark` + `unmark` count from `GitHubSyncPlan`), click opens
a small shadcn Popover listing mark/unmark/skip rows, `Mark N files viewed on PR #n` confirms (label
adds `, unmark M` when any).

## 7. Streams verdict: one sequential implementer

A split (Stream A: Go review agent, gh sync, window, IPC; Stream B: review window, questions panel,
Review code button) has a clean file boundary, but fails the no-ordering-dependency half of the
`CLAUDE.md` streams rule:

- B's every surface calls A's new methods (`ReviewWindowTarget` decides the window root,
  `LaunchReviewAgent`, `GitHubSyncPlan`). The preplan made waves honest by letting B consume only
  methods landed in an **earlier** phase (§2 "pipelining"); P150 is one phase, so B would consume
  same-phase methods through mocks only.
- The contract commit also touches `packages/git-ipc` (`review.snapshot`), which both sides read.
- The real e2e (§10) needs both halves landed; nothing is independently verifiable end to end.
- Size ~L total (A ~M, B ~M-L); two worktrees + rebase cost more than they save.

Default: **one Sonnet implementer, commits in §8 order** (backend first, so each frontend commit
builds on landed methods). Ownership table for the record (zero overlap, used only if the user
overrides this verdict and accepts mock-only B testing until landing):

| Path | A | B |
|---|---|---|
| `apps/kira-space/internal/**`, `main.go`, `internal/shell/**`, migrations | ✓ | |
| `frontend/src/bridge/index.ts`, `frontend/src/ade/v2/wire.ts`, `packages/git-ipc/**`, fixtures (contract commit, serial) | ✓ | |
| `frontend/src/ade/**` (not `wire.ts`), `frontend/src/App.vue`, `frontend/src/views/repo/**`, `packages/git-ui/**`, `packages/theme/src/components/ui/**` additions, `apps/kira-space/tests/{ui,unit,visual}/**` | | ✓ |

## 8. Commits and fast checks

Pre-commit hook (`bun run lint`, `bun run typecheck`) on every commit; never `--no-verify`.
Per commit also: `go build ./...`, `go vet` on touched packages, `gofmt -l`.

1. `feat(kira-space): P150 review contract` — `adewire` types/methods, `ade/v2/wire.ts`, 4 new +1
   changed fixtures, decode-test table, git-ipc `review.snapshot` (TS contract + validate + Go
   `gitrpc` wire/contract types). `go test ./apps/kira-space/internal/bridge/...`.
2. `feat(kira-space): pin task review sessions` — `gitreview` migration `0003`, `SetPinned`,
   sweep/Purge skip, `review.snapshot` handler, rename carry-over (§5.6).
3. `feat(shell): ephemeral windows` — `WindowOpenerDeps.Ephemeral`, close/last-window counting.
4. `feat(kira-space): review windows` — migration `0011`, `ade_review_windows`, `ade_gh_synced`, `WindowsRepo.List`
   filter, boot purge, `OpenReviewWindow`, `ReviewWindowTarget`, archive/branch hooks, `index.ts`.
5. `feat(kira-space): per-task review agent` — `ade_sessions.purpose`, `PrepareArgs.AddDirs`,
   `ReviewAgent`, `LaunchReviewAgent`.
6. `feat(kira-space): GitHub viewed sync` — `ghclient.graphql`/`PullFiles`/`SetFilesViewed`, plan
   rule (mark and unmark), `GitHubSyncPlan`/`Apply`. `go test ./apps/kira-space/internal/{ghclient,gitsession,bridge}/...`.
7. `feat(git-ui): needs-review filter and review base override` — `ReviewFilesPane`, mount target.
8. `feat(kira-space): content-based review diff left side` — `RepoDiffView.vue` snapshot model.
9. `feat(kira-space): review window` — App root switch, three-pane layout, header, Pinia store,
   queries, uncommitted banner.
10. `feat(kira-space): review agent panel` — terminal mount, compose, busy rule, `Ask review agent`
    diff action, focus-elsewhere state.
11. `feat(kira-space): GitHub sync UI` — button, popover, error states, un-review trigger.
12. `feat(kira-space): Review code button` — branch panel, branch-row menu, Review stage block.
13. `test(kira-space): review window UI specs` — mock runtime (`tests/ui/support/{ipcChannels,
    mockRuntime}.ts` FQNs), §9 specs.
14. Fixes from §10 as follow-up commits. Then `docs(v2.0): P150 result` (this file's result section;
    `docs/ARCHITECTURE.md` review/ADE section + Known open items, serial per preplan rule 6).

Expensive suites once near the end (§10), not per commit.

## 9. Tests (CLAUDE.md bar)

Earn a test:
- Go `TestGhSyncPlanRule`: table over §6.3's seven interacting rules (incl. `unmark`) + `notInPr` +
  `headNotFetched`.
- Go `TestSetFilesViewed_ArgvGolden` (mark and unmark) and `TestPullFiles_Pagination`: fake `ghclient.Runner`, same
  precedent as `TestOpenPulls_ArgvGoldenAndEarlyStop` (argv shape and cursor paging are easy to get
  wrong; GraphQL `errors[]` in a 200 body).
- Go: sweep skips pinned, Purge skips pinned unless forced — one test, extends `store_test.go`
  (cache eviction/invalidation with interacting rules).
- Go: close-count with ephemeral windows (last real workbench keeps its row while a review window
  is open) — a race-prone teardown rule.
- UI (`tests/ui`, mock runtime): review window boot renders 3 panes for a target and the normal
  workbench for `null`; Needs-review filter hides a reviewed-unchanged file; Send disabled on
  activity `input`; sync button hidden for `noPr`, popover lists reasons for a plan fixture.

No test for: `OpenReviewWindow` CRUD, `ReviewWindowTarget` lookup, `review.snapshot` pass-through,
`AddDirs` command string beyond one assertion folded into the existing `TestTracker_*` table if a
case already builds commands there.

## 10. Acceptance

Fast: `bun run lint`, `bun run typecheck`, `go build ./...`, `bun run lint:go`, `bun run lint:dead`.
Suites (once, end): `go test ./apps/kira-space/... ./internal/shell/...`, `bun run test:unit`,
`bun run test:ui:space`, `bun run test:visual:space` (baseline update only for the new window).

Verifications (each recorded with the one decisive line in the result section):
- V1 `codegraph_explore` re-verification of §2 A1-A8, drift listed.
- V2 Real Claude Code: `Send` into a running review agent (idle, and mid-turn `working`) submits
  the question; decides §5.4 `working` rule and whether paste-end/Enter needs a delay.
- V3 Real `gh`: introspection of `MarkFileAsViewedInput` and `UnmarkFileAsViewedInput`, then
  `GitHubSyncApply` on a scratch PR marks a file (GitHub shows it viewed) and, after un-review,
  unmarks it (GitHub shows it unviewed). Needs a valid `gh` login; if the environment has none,
  stop and ask the user for one. Never skip.

**One real e2e** (live `bun run dev:space`, real git, real `claude`, real `gh`; steps and outcome
in the result section):
1. Task with one real branch in a scratch repo, PR open on a scratch GitHub repo.
2. `Review code` -> new window, title `Review · …`, Needs review lists all changed files.
3. Mark two files reviewed; close window; commit a change to one of them from another terminal
   (simulated agent); force-push the branch.
4. `Review code` again -> only the changed file listed; its left side is the reviewed bytes (snapshot).
5. Ask a question with a selection reference -> appears in the review agent TUI and is answered;
   close and reopen the window -> same conversation resumed (same `claudeSessionId`).
6. `Sync to GitHub` -> the unchanged reviewed file marked viewed on the PR; the changed one listed
   `changedSinceReview`. Un-review the marked file -> it shows unviewed on the PR. Rename a reviewed
   file without edits, relaunch the window -> still reviewed.
7. Close the main window while the review window is open; relaunch -> main workbench restored with
   its tabs, review window not restored.

Ask-vs-delivered check (orchestrator): every §1 item maps to a commit and a V/e2e step; grep for
real callers of `SetFilesViewed`, `review.snapshot`, `LaunchReviewAgent`, `OpenReviewWindow`.

## 11. Libraries

No new dependency. GitHub GraphQL via the existing `gh` CLI runner (`gh api graphql`); a Go GraphQL
client (`shurcooL/githubv4`, MIT) declined: real requirement is the app's existing auth model (`gh`
owns the token; the app never reads it), which a direct HTTP client would break. Frontend: shadcn-vue
(Button, Textarea, Popover, Tooltip, Badge, Alert, ToggleGroup; `add` any missing into
`packages/theme/src/components/ui/`), Tailwind utilities only, VueUse (`useStorage`,
`onKeyStroke` for ⌘Enter, `useEventListener`), Pinia (`adeReviewWindow`, one concern), TanStack
Query (all bridge reads, `GitHubSyncApply` as a mutation), existing workbench terminal module
(xterm). Every Vue file `<script setup lang="ts">`.

## 12. User decisions (resolved)

- Q1. `▶ Review` and the Review code window use the same per-task review agent (one interactive TUI
  session per task), resumed every time, including when the user returns later to re-review (§5.4).
- Q2. One shared agent terminal per task across that task's review windows (§5.4 Hosting).
- Q3. Uncommitted worktree changes: banner only (§5.2).
- Q4. Review windows are short-lived, not restored on relaunch (§5.1). No restoration work.
- Q5. A renamed file with unchanged content keeps its review (§5.6).
- Q6. Un-reviewing a file also unmarks it on GitHub (`unmarkFileAsViewed`), only for files this app
  marked; still one-way app -> GitHub, only fully reviewed files are marked (§6.3).
- Q7. Agent cwd is the first created branch's worktree, other worktrees (or main checkouts) via
  `--add-dir`, as planned (§5.4).
