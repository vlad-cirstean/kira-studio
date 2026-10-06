# P168 Part 22 findings: Kira Space desktop host

Reviewer: Opus, report only. Fixer: one Sonnet subagent, commits per group, deletes this file when done.

- Review base: `f40cd35` (P168 pre-plan row). Reviewed tree: `95edce1` (`v2.0` fast-forwarded into
  `p168-stream-a`).
- Scope: whole owned codebase, not only the diff. Own: `apps/kira-space/main.go`, `Taskfile.yml`,
  `build/**`, frontend configs (`index.html`, `vite.config.ts`, tsconfigs, playwright configs),
  `internal/{bridge (minus adetask.go, adetask_validate.go, agentsessions.go, adewire/**),appshell,
  appcore,codeworkspace,config,buildinfo}/**`, `internal/layering_test.go`, `frontend/src/**` minus
  `ade/`, non-ADE `tests/**`.
- One hop: none above (app root). Callees read where a finding depends on them: `internal/shell`
  (window registry, close flush), `internal/terminal` (`BoundService.Open`), `internal/pathsafe`,
  `ade.Tracker`, `gitreview.Store`, reka-ui `DialogClose`/`DialogRoot`.
- Commits by other fixers in owned files since `f40cd35` (treated as unreviewed): `666af00`,
  `9145627`, `26578f9`, `07e7387`, `b604dbf`, `eadf236`, `59e7483`, `c50bb3f`, `fda8259`,
  `076bd81`, `6af53ab`, `fcf4fd2`. Reviewed in place; nothing found specific to them beyond the
  items below.
- Severity: high = data loss, security, crash, wrong result in a common path. Medium = wrong result
  in a real but narrower path. Low = edge race, drift, dead code, perf.

## Findings

### F1 (medium): repo file tree and search list a conflicted file three times

- File: `apps/kira-space/internal/codeworkspace/enumerate.go:18-28` (`EnumerateAll`). Callers
  `files.go:39` (`ListFiles`), `search.go:228` (`Search`).
- Scenario: during a merge, rebase or cherry-pick with a conflict, `git ls-files --cached` emits one
  line per index stage (1, 2, 3) for each unmerged path. Verified: a conflicted `f` lists as
  `f f f`; a Go probe of `ListFiles` returned `paths=[f f f]` and `Search` reported
  `FilesScanned: 3` for a one-file repo (probe deleted).
  - Tree (`frontend/src/repo/state/fileTree.ts:20-52` `buildTree`): three sibling file nodes, three
    rows with the same `key` (`node.path`), duplicate-key rendering in the virtual list. Quick open
    (`repoTreePaths`) shows the file three times.
  - Search: the file is scanned three times. `insertByPath` (`repo/state/search.ts:62-73`) collapses
    the groups, but `SearchStats` (`filesScanned`, `filesMatched`, `matches`) triple-count, and the
    10,000-match cap trips three times sooner. Its comment ("today's Search never reports the same
    path twice") is false.
- Conflicts are routine in a git client, so this is a common path.
- Fix: dedupe in `EnumerateAll`. Output is index-sorted, so stage entries are adjacent: drop an
  entry equal to the previous one. Do it in Go, not with `--deduplicate` (needs git 2.31; the
  discovery floor may be lower). Fix the `insertByPath` comment. No dedicated unit test needed
  (one adjacent-equal check).

### F2 (medium): credential dialog close button answers the next queued prompt with a dismissal

- File: `apps/kira-space/frontend/src/workbench/GitCredentialDialog.vue:65-78` (header close
  button), `:61` (`@update:open`), store `frontend/src/state/gitCredential.ts:47-54`.
- Scenario: two repos prompt at once (two `credential.request`s queue). The user clicks the header
  X. The `Button`'s `@click="onCancel"` runs, and `DialogClose as-child` also calls
  `rootContext.onOpenChange(false)` (reka-ui `DialogClose.js:27`), which sets the non-passive
  `useVModel` and emits `update:open(false)` synchronously, so `onCancel` runs again in the same
  tick. The first call settles prompt A and pumps prompt B into `active` synchronously; the second
  call answers prompt B with `null` before it ever renders. B's fetch/push fails with an auth error
  the user never saw. The Cancel button and Escape fire once and are fine.
- `GitPairingDialog.vue:41-45` has the same double fire for Deny; harmless today because
  `pending` updates only on the async push event, so both calls deny the same id (second answers
  `alreadyResolved`).
- Fix: make the store settle by identity, not "whatever is active": `answerCredential(pending,
  secret)` returns without effect when `pending !== state.active`; the dialog captures `active` at
  click time. Also drop the redundant `@click` on the button wrapped by `DialogClose` in both
  dialogs (let `update:open` be the single path). Extend `tests/unit/git-credential-queue.spec.ts`
  with the stale-identity case (queue ordering is already the tested rule there).

### F3 (low): unexpected git stream close skips the workspace cleanup and strands live leases

- File: `apps/kira-space/frontend/src/repo/git/transport.ts:221-226` (`channel.onClose`) versus
  `disposeGitTransport` `:308-321`.
- Scenario: the git stream closes on its own (a `decodeFrame` failure, the Go side ending
  `ServeGitStream`). `onClose` disposes the client and evicts the map entry, but does not run what
  `disposeGitTransport` runs:
  - `forgetRepoOpen(gitRepoId)` is skipped. The next `gitTransportFor` dials a new Go `Conn`
    that holds no repo, yet `repoOpenMemo` still has a resolved promise, so every `blame.line`
    fails `E_REPO_NOT_HELD` for that repo until the workspace closes (the exact P69 Group 3 bug,
    via a second path).
  - `dropCredentialRequests(codeRepoId)` is skipped: a queued prompt for the dead client stays
    answerable and sends into a disposed client.
  - Long-lived leases taken by `repo/state/repoHeads.ts:61-72` and `repo/state/worktrees.ts:111-121`
    stay on the dead client; their `repo.changed` subscriptions never fire again, so branch labels
    and worktree lists stop live-updating with no error.
- Fix: one `evictSharedClient(codeRepoId, shared)` helper that both paths call (identity check
  kept for `onClose`): forget the repo-open memo, drop credential requests, dispose leases, dispose
  the client. For the two stores, re-lease on demand: expose a small `onTransportEvicted(codeRepoId,
  fn)` hook (or let each store's watcher re-create its lease when the held lease reports released)
  so a later reconnect re-subscribes.

### F4 (low): pairing dialog names the wrong socket path

- File: `apps/kira-space/frontend/src/workbench/GitPairingDialog.vue:51`.
- Scenario: the trust prompt says the editor connects "over `~/.kira-studio/git.sock`". Kira
  Space's socket is `<KIRA_SPACE_HOME or ~/.kira-space>/git.sock` (`main.go:587`,
  `internal/config/paths.go`). A security prompt that names the other app's path misinforms the
  user deciding whether to trust the connection.
- Fix: drop the hard-coded path ("over Kira Space's local git socket"), or pass the real path from
  Go in the pairing snapshot. The generic wording is enough.

### F5 (low): pairing snapshot hydrate can miss a request that arrives during boot

- File: `apps/kira-space/frontend/src/state/gitClients.ts:42-56` (`hydrateGitClients`).
- Scenario: `gitPairingPending()` resolves with `pending: null`; a VS Code pairing request lands
  and `kira:git:pairing` is emitted before `onGitPairingChanged` subscribes (the subscription runs
  only after the whole `Promise.all`, including the slower `gitVsixStatus`). No later event comes
  until something else changes, so the prompt never shows and the request expires as a denial.
  Same gap for `onGitClientsChanged`.
- Fix: subscribe first, then fetch; apply the fetched snapshot only when no push arrived meanwhile
  (a per-feed `pushed` flag set in the handler).

### F6 (low): repo list mutations do not reach other windows

- File: `apps/kira-space/internal/bridge/codeworkspace.go:266-322` (`ImportRepo`, `RenameRepo`,
  `ReorderRepos`, `RemoveRepo`); renderer `frontend/src/state/coderepos.ts`.
- Scenario: window A imports, renames, reorders or removes a repo. Window B's `records` stay stale
  until something else triggers a hydrate (only `adewire.ChannelRepos`, from the ADE board, does).
  After a remove in A, B keeps the workspace open on a deleted row: every bound call answers
  `E_NOT_FOUND`, and B's tab saves re-persist tabs `CodeReposRepo.Remove` just dropped.
- Fix: broadcast a repos-changed signal after each successful mutation (reuse
  `AdeTaskReposChanged(events)`, whose renderer handler already re-hydrates `useCodeReposStore`
  in every window; `CodeWorkspaceService` needs an `Events`/`OnReposChanged` seam from `main.go`).
  In `hydrateCodeRepos`, close any open workspace whose record vanished
  (`closeRepoWorkspace`).

### F7 (low): concurrent import of one root reports E_INTERNAL instead of E_ALREADY_IMPORTED

- File: `apps/kira-space/internal/codeworkspace/import.go:59-74`; storage
  `internal/storage/repos/coderepos.go:64-69` (Part 20, unchanged by this fix).
- Scenario: two windows (or a worktree switch racing an import) import the same root. Both pass the
  `List` check; the second `INSERT` hits `UNIQUE INDEX code_repos_repo` and surfaces as a wrapped
  SQLite error, which `ImportRepo` maps to `E_INTERNAL`. `coderepos.ts:96-106`
  (`openRepoAtPath`) recovers only on `E_ALREADY_IMPORTED`, so the user sees an internal error.
- Fix: in `Import`, map a SQLite unique-constraint error from `store.Create` to
  `&importError{ErrAlreadyImported, ...}` (check for an existing `sqlitex` constraint helper
  first; else match `sqlite3.ErrConstraintUnique` via `errors.As`).

### F8 (low, routed): no abort hook when a composed agent terminal fails to open

- Source: routed from Part 20 F2 (`P168-routed-from-streamB.md`). Files: `internal/terminal/bound.go:93-125`
  (Part 8, closed), `apps/kira-space/internal/ade/tracker.go:307-389` (Part 20, Stream B, closed),
  `apps/kira-space/main.go:151-153` (this part: the wiring line only).
- Scenario: `BoundService.Open` calls `ComposeAgent` (`Tracker.Compose`, which inserts or marks
  running a session row), then `OpenWithCoalescedOutput` can still fail (`ErrDuplicateSession`,
  `ErrRegistryClosed`, a spawn error). The row stays `running` until the 30 s grace `Reconcile`
  stops it; a fresh row's Claude session id never ran, so a later resume of it fails. Part 20
  removed the deterministic length case (`Compose` checks `MaxCommandBytes` itself), so
  `bound.go:100-102`'s recheck is now unreachable for a tracked launch.
- Not fixed in this part's files alone. Fix (needs Part 8 and Part 20 files): add `AbortAgent
  func(terminalID string)` beside `ComposeAgent` on `BoundService`, called on every failure after a
  successful compose; add `Tracker.Abort(terminalID)` that, under `mu`, removes the
  `live/byRecord/spawnedAt` entries and stops the grace timer, then deletes a fresh row or marks a
  resumed one stopped and fires `OnChange`; wire it in `main.go`. Routed in
  `P168-routed-from-streamA.md`.

### F9 (low): RepoMultiDiffView can leak a diff editor on a fast collapse and re-expand

- File: `apps/kira-space/frontend/src/views/repo/RepoMultiDiffView.vue:68-96` (`mountSection`,
  `disposeSection`), `useDiffEditor.ts:211-282`.
- Scenario: a section expands (handle H1 starts `mount()`, awaiting the read), the user collapses
  it (`disposeSection` deletes H1 from `diffEditors`; H1's `unmountEditor` is a no-op, nothing is
  registered yet), then re-expands before H1's read resolves. `setContainer` sets the shared
  per-path `containerRef` to the new element and starts H2. H1 resumes, sees a non-null
  `container.value` (the new element), and builds a diff editor there; H2 builds a second one in
  the same element. `registerDiffEditor` keeps only the last; the other widget is never disposed
  (Monaco instance and DOM leak, two stacked editors).
- Fix: give each mount an identity check before it creates the editor: in `mountSection`, pass a
  per-call container ref (not the shared per-path one) or have `useDiffEditor.mount` accept an
  `isCurrent()` guard checked right before `createDiffEditor`; after `await handle.mount()`, if
  `diffEditors.get(path) !== handle`, call `handle.dispose()`.

### F10 (low): codeworkspace registry closes sessions while holding its map lock

- File: `apps/kira-space/internal/codeworkspace/session.go:73-87` (`Registry.Open` calls
  `existing.Close()` under `r.mu`).
- Scenario: a `git.path` change makes every next `Open` replace its session. `Session.Close` closes
  the cat-file pair; `persistentProcess.close` (`gitclient/catfile/session.go:229-236`) takes the
  process mutex, which an in-flight `Read` of an up-to-8 MiB blob holds. Meanwhile every bound call
  for every repo (`session()`, `Peek` for `CancelSearch`) blocks on `r.mu`.
- Fix: swap the map entry under the lock, call `existing.Close()` after unlocking (same shape as
  `Registry.Close`/`CloseAll`).

### F11 (low): repo heads refresh leaks unhandled rejections

- File: `apps/kira-space/frontend/src/repo/state/repoHeads.ts:44-47,53,70`.
- Scenario: `refreshRepoHeads` is fired with `void` from two watchers and a `repo.changed`
  handler. With git unavailable, `RepoHeads` rejects `E_GIT_UNAVAILABLE` on every records change
  and every `refsChanged`, each an unhandled promise rejection in the console.
- Fix: catch inside `refreshRepoHeads`, leave existing labels, log once at `console.warn`.

### F12 (low): overlapping tree refreshes can install an older listing

- File: `apps/kira-space/frontend/src/repo/state/fileTree.ts:174-195` (`refreshRepoTree`).
- Scenario: two refreshes overlap (Refresh clicked twice, or open plus Refresh). If the first
  `ListFiles` resolves last, its older snapshot overwrites the newer one and `loading` flips false
  while the newer call is still running.
- Fix: a per-repo sequence number; only the latest call writes `paths/status/tree/loading`.

### F13 (low, known open item): dead KeepAlive hooks in RepoGraphView

- File: `apps/kira-space/frontend/src/views/repo/RepoGraphView.vue:10-33,34,98-103`.
- `docs/ARCHITECTURE.md` Known open items already records it: `MainView.vue` has no `KeepAlive`,
  so `onActivated`/`onDeactivated` never fire, `setVisible` is inert, and the header comment
  describes a design that no longer exists. Fixable inside this file.
- Fix: delete the two hooks, their import, and the stale KeepAlive comments (keep `setVisible` on
  git-ui's `MountHandle`, Part 18/19 surface, untouched). Delete the Known open items entry.

### F14 (low, known open item): stale review target replayed on a later cold mount

- File: `apps/kira-space/frontend/src/repo/git/hostHandlers.ts:362-373`.
- Known open item: `review.open` always stashes into `pendingReviewTargetByCodeRepoId`, but only the
  cold-mount `takePendingReviewTarget` drains it. When `review.target` is delivered live, the entry
  stays and is replayed on a later cold mount. Never cleared on workspace close.
- Fix: stash only when `deps.emitLocal('review.target', ...)` returns false (the
  `graph.revealCommit` pattern at `:388-390`); clear both pending maps for the repo in the
  workspace-close path. Delete the Known open items entry.

### F15 (low, known open item): failed review comment load looks like zero comments

- File: `apps/kira-space/frontend/src/views/repo/reviewDecorations.ts:405-422` (`loadComments`).
- Known open item: `.catch` turns a failed `review.comment.list` into an empty list, so a transient
  failure erases every comment glyph with no banner or retry.
- Fix: keep the previous `comments` on failure and surface the same error/Retry state `loadDiff`
  uses (C13-9). Delete the Known open items entry.

### F16 (low): stale and wrong comments

- `apps/kira-space/main.go:51-61`: says "no terminal, no keep-awake, no Claude Code hooks" and lists
  four services; main now wires all of those and 15 services. Rewrite to the current order.
- `internal/bridge/keepawake.go:8-13`: "this app has no Claude Code hook integration in scope";
  false since P129 (`agenthooks` wired in `main.go:406`).
- `internal/appcore/deps.go:1-6`: "the four moved bridge services" read Deps; now most services.
- `frontend/src/bridge/index.ts` header: "trimmed to the 13 services"; `main.go` binds 15.
- `frontend/src/repo/git/hostHandlers.ts:161-164`: "this function's 4 call sites"; there are 3.
- `frontend/src/repo/state/search.ts:58-61`: see F1.
- Fix: comment edits only, terse, per CLAUDE.md.

## Dropped candidates (with reason)

- Review session pins survive relaunch (`purgeReviewWindows` drops window rows, not pins): by
  design; `teardownReview` unpins on archive, and a pinned session must outlive its window.
- `terminalRegistry.OnChange` assigned after `board.Start()` (`main.go:162`): no terminal opens
  before `app.Run`; the board never calls `Registry.Open`. No race.
- `purgeReviewWindows` after `board.Start()`: the board reads no review-window rows at start.
- `gitstream` `repoSettings.set` guard passing malformed params: same struct and decoder as the
  real handler, which rejects them; narrows only.
- `ReadFile`/`scanFile` stat-then-open TOCTOU after `ValidateRelPath`: local, read-only, the
  repository owner controls both; no privilege boundary crossed.
- Markdown reading view remote images/tracking: CSP `img-src 'self' data:` blocks them.
- Heading ids clobbering `#app`: inside `.md-reading`, no script reads them by id; cosmetic only.
- `RepoFileView.vue` scoped `<style>`: styles `v-html` markdown, no template element to carry
  utility classes; documented decline, valid.
- Blame of a worktree file after an external edit refers to new line numbers while the model shows
  mount-time text: covered by the "tree does not follow the filesystem" known item; a model reload
  is a feature, not a bug fix.
- Search sort order (`insertByPath` UTF-16 compare vs git byte order): only differs for astral vs
  high-BMP names; ordering stays stable and deterministic.
- `UpdateService.InstallUpdate` `go s.Quit()`: intentional, documented.
- `codeworkspace.Session.Close` during an in-flight `ReadDiff`: `catfileSession` returns
  `ErrSessionClosed`, mapped to `E_WORKSPACE_CLOSED`; correct.

## Routed items handled

- Part 20 F2 (abort hook): F8 above, routed to Part 8/Part 20 owners.
- Part 17 F2 (`rpcstream.wireError.Kind`), Part 14 F4 (`localsock`), Part 10/12 items: not Part 22
  files; nothing to do here.

## Coverage

- Go, read fully: `main.go`; `internal/bridge/{browser,stream,windows,terminal,link,tabs,layout,ops,
  lifecycle,settings,files,keepawake,github,update,events,gitstream,gitclients,codeworkspace}.go`;
  `internal/appshell/*`; `internal/appcore/*`; `internal/config/*`; `internal/buildinfo/*`;
  `internal/codeworkspace/{paths,files,session,diff,import,enumerate,search}.go`. Skimmed:
  `textpos.go`, bridge tests.
- Callees read for findings: `internal/shell/{registry,openwindow,closeflush}.go`,
  `internal/terminal/{bound,session}.go`, `internal/pathsafe`, `ade/{tracker,review}.go`,
  `gitreview/store.go`, `gitsock/server.go`, `storage/repos/{adereview,coderepos}.go`,
  `gitclient/catfile/session.go`, reka-ui `DialogClose`/`DialogRoot`.
- Frontend, read fully: `main.ts`, `bridge/index.ts` (head), `state/{workspace,coderepos,
  gitCredential,gitClients,repoOpenHold,repoTabs}.ts`, `repo/git/{transport,hostHandlers}.ts`,
  `repo/state/{fileTree,search,repoHeads,worktrees}.ts`, `views/repo/{editors,monaco,useDiffEditor,
  blameLine,blameAnnotation,markdownReading}.ts`, `views/repo/{RepoFileView (script),
  RepoMultiDiffView}.vue`, `repo/RepoReviewView.vue`, `workbench/{GitCredentialDialog,
  GitPairingDialog}.vue`, `workbench/settings/GitPane.vue` (script). Grepped: `v-html`, `<style`,
  `defineComponent`, `script setup` across all non-ADE components.
- Build/config: `Taskfile.yml`, `build/darwin/Taskfile.yml` (flags), `build/config.yml`,
  `build/darwin/Info.plist`, `frontend/index.html` (CSP).
- Not read line by line: `GitPanel.vue`, `RepoSearchView.vue`, `RepoTreeRow.vue`,
  `reviewDecorations.ts` beyond `loadComments`, `language.ts`, settings panes other than Git,
  `TitleBar`/`StatusBar`, non-ADE Playwright specs.
- Checks run: `go test -race` on `bridge/...`, `codeworkspace/...` (green); a Go probe confirming F1
  (deleted); `git ls-files` reproduction of F1 in a scratch repo.
