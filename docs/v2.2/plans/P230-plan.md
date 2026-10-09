# P230 plan: Agents module Refresh says "never fetched", then a git error

Base: `718da8181` (P228 plan), branch `v2.0`. Worktree branch `v22-fix-G`.

## Ask (user's words)

"in the agent module the refresh doesn t work, it says never fetched and then gives a git error".
No-remote repo must be a clear non-error state, not a git error.

One sequential Sonnet implementer. No stream split: Go fix and UI fix meet in one wire state
(`RepoState.remote`/`lastFetchAt`) and the same chip.

## Where it is

Agents module (`workbench/modes.ts`: `ade: { label: 'Agents' }`), Plan view header.
`AdeRepoChip.vue` renders `never fetched` when `lastFetchAt === null`; its `↻` button
(`ade-repo-refresh`) and the header's `Refresh all` (`ade-refresh-all`) call
`AdeTaskService.Refresh` -> `TaskBoard.Refresh` -> `refreshRepo` (`internal/ade/board.go`).
`lastFetchAt` is the mtime of `FETCH_HEAD`, read by `lastFetchAt(entry)` in `collectRepo`
(`board_facts.go`). A failed row shows `remoteErrorText(error)` in red in place of the note.

## Root cause

**C1 (the report). The board opens repos with the raw `git.gitPath` setting, which defaults to `""`.**
`main.go` wires `TaskBoardDeps.GitPath: adeGitPathSetting(repositories)`, which returns
`settings.Git.GitPath` verbatim. `TaskBoard.openRepo` passes it to `conn.Open` ->
`Registry.Acquire` -> `gitclient.Identify` -> `exec.CommandContext(ctx, "", ...)`. Every other
opener resolves through `Discovery.Status(ctx, setting).Path` first (`gitrpc.handleRepoOpen`,
`CodeWorkspaceService.session`, the board's own `importFolder`). `adeGitPathSetting`'s comment
claims "Registry.Acquire resolves an unset/relative path itself"; it does not (`registry.go`
`acquire` hands `gitPath` straight to `Identify` and `NewRepo`).

Effect with default settings, every repo, every time:
- Board read: `repoFacts` -> `openRepo` fails -> `fallback()`; `res.state` stays
  `{CodeRepoID}` (no `remote`, no `lastFetchAt`) -> chip `never fetched`, even when `FETCH_HEAD`
  exists. Log: `WARN ade board: open repo ... exec: no command`.
- Refresh: `refreshRepo` -> `openRepo` fails -> `refreshFailure` ->
  `{kind: "Unknown", message: "git rev-parse --is-bare-repository failed (unknown): exec: no command"}`
  in red. That is the "git error".

Unit tests miss it: every ADE harness sets `GitPath: func() string { return "git" }`.

Reproduced in a scratch Go test on this tree (deleted): harness with `GitPath` returning `""`,
`GitStatus` `{ok, git}`, repo cloned and `git fetch` run (FETCH_HEAD present):
`board repo {CodeRepoID:a MainName: Remote: LastFetchAt:<nil>}` and
`row error kind=Unknown msg="git rev-parse --is-bare-repository failed (unknown): exec: no command"`.

**C2. No remote is reported as an error.** `refreshRepo` returns
`{kind: "NoRemote", message: "this repository has no remote configured"}` and stops; the chip shows
it in red. Before any refresh the chip says `never fetched` (no FETCH_HEAD ever). Measured:
`[noremote] row error kind=NoRemote msg="this repository has no remote configured"`. Nothing reads
kind `NoRemote` (grep: Go and TS, tests included).

**C3. Linked-worktree root never shows a fetch.** `lastFetchAt` stats
`Summary.CommonDir/FETCH_HEAD`; git writes FETCH_HEAD per worktree
(`git rev-parse --git-path FETCH_HEAD` in a linked worktree:
`<common>/.git/worktrees/feat/FETCH_HEAD`). Measured: refresh `Error:<nil>`, then
`repo wt remote="origin" lastFetchAt=<nil>`. Reachable: code repos imported from the Repos panel
can be linked worktrees (`addRepoFromPath` tests); ADE folder import rejects them.

Not causes (checked): credential routing (`RouteCredentials` -> `gitcred.Relay` queue), wire call
shape (`useRefresh` -> `AdeTaskService.Refresh`), bad remote URL (returns classified
`RemoteNotFound`, correct), shallow clone, renamed single remote, empty remote (all ok).

## Fix

**F1. Board resolves git through discovery** (`board.go`).
- Delete `TaskBoardDeps.GitPath`.
- `openRepo`, uncached branch only: `status := b.deps.GitStatus(ctx)`; `status.Kind != "ok"` ->
  `fmt.Errorf("ade: git is unavailable: %s", status.Kind)` (same wording as `importFolder`);
  else `b.conn.Open(ctx, b.deps.Registry, status.Path, rec.Root)`. Cached branch unchanged
  (keeps `TestTaskBoard_notCreatedAndTooOldGit` passing: its entry is cached before `tooOld`).
- `main.go`: drop `GitPath: gitPath` from `TaskBoardDeps`; keep `adeGitPathSetting` feeding the
  `GitStatus` closure; rewrite its comment (no "Acquire resolves" claim).
- Test harnesses drop `GitPath:`: `board_test.go:45`, `workflows_test.go:52`,
  `integration_test.go:61`, `runengine_test.go:229`.

**F2. No remote is a local rescan, not an error** (`board.go` `refreshRepo`).
- `!hasRemote`: skip only `RunRemote`; run the rest (inventory, `countBranchRefsChanged` (0),
  `repoFacts`, merge marks, PR check, rebase checks). Row has `error: null`. Delete the `NoRemote`
  error literal.
- No wire change: the UI reads `RepoState.remote === ''`.

**F3. FETCH_HEAD from the worktree's own git dir** (`board.go` `lastFetchAt`): stat
`entry.Summary.GitDir/FETCH_HEAD` (equals CommonDir for a main worktree). Verify `GitDir` is
absolute in `Identify`'s summary before relying on it.

**F4. Repo state set before facts** (`board_facts.go`): in `repoFacts`, right after `openRepo`
succeeds, set `res.state.Remote` (`entry.DefaultRemote`) and `res.state.LastFetchAt`, so a later
`collectRepo` failure cannot masquerade as `never fetched`. `collectRepo` keeps setting
`MainName`. No dedicated test (two-line move).

**F5. Chip states** (`AdeRepoChip.vue`, `AdePlanHeader.vue`, `AdePlanView.vue`).
- `RepoChipModel` and chip props gain `remote: string`; `AdePlanView` maps `remote: r.remote`.
- Note order: busy `fetching…`; error (red); `remote === ''` -> `no remote`, or
  `no remote · <summary>` once a refresh ran; `lastFetchAt === null` -> `never fetched`; else ago.
- Refresh tip: remote set `Fetch <label>`; none `Rescan <label> (no remote to fetch)`. Button
  stays (local rescan still marks merges). `aria-label` unchanged.
- `refreshNote` unchanged.

## Regression tests (write first, see them fail, then fix)

Go, `apps/kira-space/internal/ade/board_refresh_test.go`:

G1 `TestTaskBoard_RefreshWithDefaultGitPathSetting`. Harness from `newBoardHarness`; then (pre-fix
only) `h.board.deps.GitPath = func() string { return "" }` before any board call, mirroring the
default setting. `initQueueRepo`, branch `feat` with a commit, task on it, `git fetch -q` in the
clone. Assert board repo `Remote == "origin"` and `LastFetchAt != nil`; `Refresh(["a"])` row
`Error == nil`.
Expected failure on this tree (measured): `Remote: LastFetchAt:<nil>`; refresh
`kind=Unknown msg="git rev-parse --is-bare-repository failed (unknown): exec: no command"`.
In the F1 commit, replace the override line with
`h.status.Store(gitclient.GitStatus{Kind: "ok", Path: <exec.LookPath("git")>})` so the test
asserts the board opens with discovery's path.

G2 `TestTaskBoard_RefreshWithoutRemoteIsNotAnError`. `git init -b main`, commit, branch `feat`
with a commit, task on it, no remote. `Refresh(["r"])`: row `Error == nil`, `RefsChanged == 0`;
board repo `Remote == ""`; no `FETCH_HEAD` in `.git`.
Expected failure on this tree (measured): `row error kind=NoRemote msg="this repository has no
remote configured"`.

G3 `TestTaskBoard_LinkedWorktreeRootShowsFetch`. `initQueueRepo`, `addQueueWorktree(feat)`,
`h.addRepoFromPath("wt", wt)`, task on `feat`, `Refresh(["wt"])` ok, board repo
`LastFetchAt != nil`.
Expected failure on this tree (measured): `lastFetchAt=<nil>`.

Playwright, `apps/kira-space/tests/ui/ade-v2-plan.spec.ts`:

U1 "a repo without a remote reads no remote, never an error". `openPlan` with the board fixture
copied in-test, `repo-mobile` set to `remote: ''`, `lastFetchAt: null`; `adeTaskRefresh` returns
`{repos: [{codeRepoId: 'repo-mobile', refsChanged: 0, mergedInto: [], error: null}]}`.
1. `repo-mobile` `ade-repo-note` has text `no remote`.
2. Click its `ade-repo-refresh`; note has text `no remote · no changes`; note lacks class
   `text-tone-red`.
Expected failure on this tree: step 1 receives `never fetched`.

Record every failure from a run of the test commit alone, in the result section.

## Files (ownership; P228 stream owns `packages/git-ui/**`, CommitGrid.vue, App.vue: not touched)

- `apps/kira-space/internal/ade/board.go`, `board_facts.go`
- `apps/kira-space/internal/ade/board_refresh_test.go`; harness line only in `board_test.go`,
  `workflows_test.go`, `integration_test.go`, `runengine_test.go`
- `apps/kira-space/main.go` (`wireAdeTask`, `adeGitPathSetting` comment)
- `apps/kira-space/frontend/src/ade/v2/plan/AdeRepoChip.vue`, `AdePlanHeader.vue`, `AdePlanView.vue`
- `apps/kira-space/tests/ui/ade-v2-plan.spec.ts`
- `docs/ARCHITECTURE.md` (ADE "Git facts" bullet and "Git refresh (P191)" bullet only),
  `docs/v2.2/SPEC.md` (P230 row and result only). P228 edits other sections of both; rebase
  conflicts there are textual only.

## Docs

- `docs/ARCHITECTURE.md`, ADE "Git facts": board opens repos with `GitStatus().Path`
  (discovery), never the raw setting; non-ok git fails the open with `ade: git is unavailable`.
  Refresh fetches the default remote when there is one; without one it rescans locally and the chip
  reads `no remote`. `lastFetchAt` is the worktree git dir's FETCH_HEAD mtime.
- `docs/v2.2/SPEC.md`: P230 result (C1-C3, measured failing lines, checks, Mac handover). Row
  status Done only after orchestrator verifies.

## Checks

1. Per commit: `bun run typecheck`, `bun run lint`, `bun run lint:go`, `bun run lint:dead`.
2. `go test ./apps/kira-space/internal/ade/...`, then `go test ./apps/kira-space/...`.
3. `bun run build:test:space`, then
   `node node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts --project=ui ade-v2-`.
4. Once near the end: `bun run test:ui:space`.
5. Not needed: mobile and visual suites (no mobile repo chip; no visual baseline of the Plan header);
   run `test:visual:space` only if a baseline shows `ade-plan-header`.

## Commits (Conventional Commits, in order)

1. `test(space): ade refresh regression tests` (G1-G3, U1; fail on this tree; failures in body).
2. `fix(space): ade board opens repos with discovered git path` (F1, harness lines, G1 override
   swap).
3. `fix(space): ade refresh without a remote is a local rescan` (F2, F5).
4. `fix(space): ade fetch time from the worktree git dir` (F3, F4).
5. `docs: P230 result` (ARCHITECTURE, SPEC).

## Mac handover

1. Settings > Git > Git executable path empty (default). Agents > Plan: each chip shows a time
   (`5m ago`), not `never fetched`, for any repo fetched before.
2. `Refresh all`: chips show `fetching…`, then `<n> refs changed` or `no changes`; no red text.
   Console log has no `exec: no command`.
3. Repo with no remote (`git init` + a task branch): chip reads `no remote`; `↻` tip reads
   `Rescan … (no remote to fetch)`; click it: `no remote · no changes`, not red.
4. Repo with a bad remote URL: red classified message stays (correct failure).
5. Set Git executable path to a real git (`/opt/homebrew/bin/git`), relaunch, Refresh all: same as
   step 2.

## Deferred decisions (implementer takes the default; the user can overrule)

- D1 Several remotes, none named `origin`: `DefaultRemote` returns none, so the chip reads
  `no remote` and Refresh rescans locally. Alternative: fetch all, or let the user pick a remote per
  repo. Out of scope.
- D2 A failed fetch still rewrites FETCH_HEAD (git truncates it first; measured: bad-URL refresh
  moved `lastFetchAt`), so after a reload the chip shows a time though the fetch failed. Default:
  leave; the in-session red error covers it. Alternative: record last successful fetch per repo.
- D3 A deleted repo root yields `fork/exec /usr/bin/git: no such file or directory` (cwd missing,
  measured). Default: leave; separate wording fix if wanted.
- D4 Refresh button stays for a no-remote repo (local rescan marks local merges). Alternative:
  hide it.
