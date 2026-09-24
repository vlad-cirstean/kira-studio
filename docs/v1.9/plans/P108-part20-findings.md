# P108 Part 20 — Kira Space hosts review findings

Scope: `apps/kira-space/main.go`, `apps/kira-space/internal/{bridge,appshell,appcore,codeworkspace,
storage,config,buildinfo}`, `apps/kira-space/frontend/**`, `apps/kira-space-vscode/**`, build and
packaging scripts. Plan: `P108-part20-space-hosts.md`. Tree reviewed: `c7e3cca`. Review only; fixer
applies each finding as its own commit. Items in `docs/ARCHITECTURE.md` Known open items are not
re-reported.

Severity: High = core feature broken in normal use. Medium = lost state, leak or blank UI on a
reachable path. Low = narrow window, dev/packaging hygiene, or misleading copy.

## F1 — Pairing and Connected-editors push channels have no Go emitter (High)

Sites:
- `apps/kira-space/internal/bridge/events.go:11-18` (`ChannelGitPairing`, `ChannelGitClientsChanged`
  declared, never emitted)
- `apps/kira-space/internal/gitsock/server.go:71-77` (`OnPairingChanged`/`OnClientsChanged`, zero
  callers)
- `apps/kira-space/main.go:41-50` (header: "gitsock.OnPairingChanged is wired by nothing yet")
- `apps/kira-space/frontend/src/state/gitClients.ts:44-60` (`hydrateGitClients` subscribes both
  channels), `:62-75` (`approvePairing`/`denyPairing`/`revokeGitClient` rely on the push to re-render)
- `apps/kira-space/frontend/src/workbench/GitPairingDialog.vue:68` (renders only while
  `gitClientsStore.pending` is non-null)

Bug: `git grep` finds no Go subscriber of `OnPairingChanged`/`OnClientsChanged` and no emit of
`kira:git:pairing`/`kira:git:clients` anywhere. The frontend reads pairing and client state once, at
boot, then waits for pushes that never come.

Reachable, normal use:
- A VS Code extension that dials after Kira Space booted enters the broker queue. The dialog never
  appears. The request expires and the extension lands in `denied` (timeout). Pairing only works if
  the extension dialed before the window hydrated.
- If a request was pending at boot, Approve/Deny resolves it server-side but the dialog stays up
  (countdown pinned at 0) until relaunch.
- Revoke and a fresh pairing never update the Connected editors pane.

No test catches it: `apps/kira-space/tests/ui/support/ipcChannels.ts:28,32` only names the channels;
no UI spec pushes either one against the real Go side.

Fix:
- In `main.go`, after `attachEmitter(app)`: subscribe `gitSock.OnPairingChanged` and
  `gitSock.OnClientsChanged`; map each payload through the existing wire projections
  (`toWireSnapshot` in `bridge/gitclients.go`; `[]model.GitClient` as-is) and broadcast on the two
  channels via `events`. A small `bridge` helper (e.g. `GitClientsService.AttachPush`) keeps gitsock
  types out of `main.go`, matching `gitclients.go`'s own interface-at-consumer precedent.
- Unsubscribe in `teardown` before `gitSock.Close()`.
- Update the stale `main.go` header and `events.go` comment.

## F2 — Frontend bootstrap has no error path: one failed hydrate leaves a blank window (Medium)

Sites: `apps/kira-space/frontend/src/main.ts:40-47` (`Promise.all` of six hydrates), `:61-64`
(`app.mount` only after it), `:67` (`void bootstrap()`).

Bug: any rejection (a bound call's `ipcerr`, e.g. `GitClientsService.List`/`TabsService.List`/
`SettingsService.GetAll` hitting a DB error or a busy DB past the 5 s `_busy_timeout`) skips
`app.mount`. Result: blank window, unhandled rejection in the webview console only, no retry, no
log line on the Go side.

Reachable: any hydrate failure at launch. F7's second-instance case makes a busy DB plausible.

Fix:
- Mount first, or wrap the hydrate stage: on rejection, still mount and show a boot-failure state
  with Retry (git-ui's `retryBootstrap` pattern, B6), and log through the existing bridge logging.
- Consider `Promise.allSettled` for the non-essential hydrates (`gitClients`, `terminals`) so one
  optional store cannot block the whole shell.

## F3 — `transport.ts` late `onClose` evicts a newer shared client (Medium)

Sites:
- `apps/kira-space/frontend/src/repo/git/transport.ts:146-149` (`channel.onClose` deletes
  `sharedClientsByCodeRepoId[codeRepoId]` unconditionally)
- `transport.ts:308-315` (`gitTransportFor` creates on a map miss)
- `transport.ts:320-333` (`disposeGitTransport` deletes the entry, then `shared.transport.dispose()`)
- `packages/git-ipc/src/streamChannel.ts:131-135` (`fireClose` runs from `socket.onclose`, i.e.
  asynchronously after `close()`)

Bug: `disposeGitTransport(A)` closes the channel, but its `onClose` fires later, from the socket's
close event. If `gitTransportFor(A)` created a new shared client in between, the stale handler
deletes the NEW entry. The new client stays open (socket, Go `gitsession.Conn`, repo hold) but is no
longer reachable: the next `gitTransportFor(A)` opens a third client, and the next
`disposeGitTransport(A)` never disposes the orphan. The orphan leaks for the window's life.

Reachable:
- `repo/state/worktrees.ts:87-95` collapse (`release` → `disposeGitTransport` when the repo has no
  open workspace), then re-expand (`:106` `gitTransportFor`) before the close event lands.
- `state/workspace.ts:70-81` close a repo workspace, then reopen it right away
  (`repo/state/repoHeads.ts:66-69` and the graph tab both call `gitTransportFor`).

Also in this file:
- `localEmittersByCodeRepoId` (`:133`, set `:150`, deleted `:324`) has no reader anywhere.
  `blameAnnotation.ts` does not use it, despite `:128-132`'s comment. Dead state; the same stale
  close would also leave it pointing at the wrong emitter if it ever gained a reader.
- After an unexpected server-side close, mounted leases keep the dead client until remount. Noted,
  not part of this fix.

Fix:
- Capture the returned transport object in `createNativeGitTransport`; in `onClose`, delete only when
  `sharedClientsByCodeRepoId.get(codeRepoId)?.transport === thisTransport`.
- Delete `localEmittersByCodeRepoId` and its comment, or wire its reader; don't leave a write-only map.

## F4 — `codeworkspace.Session` has no closed guard: replaced/closed sessions respawn `cat-file` (Medium)

Sites:
- `apps/kira-space/internal/codeworkspace/session.go:110-117` (`catfileSession` recreates when
  `s.catfile == nil`)
- `session.go:120-136` (`Close` nils `s.catfile`; `closeOnce` is then spent)
- `session.go:146-155` (`BeginSearch` installs a fresh cancel on a closed session)
- `session.go:54-68` (`Registry.Open` closes a session on `Root`/`GitPath` change), `:82-90`
  (`Registry.Close`)
- `diff.go:62-63` (`readHeadSide` → `catfileSession()`)
- `internal/bridge/codeworkspace.go:541-551` (`StartSearch` → `sess.BeginSearch()`), `:391-395`
  (`CloseWorkspace`)

Bug: a caller holding a session that another goroutine just closed (via `CloseWorkspace`,
`RemoveRepo`, or a git.path change through `Registry.Open`):
- `ReadDiff` → `catfileSession()` builds a new `catfile.Session`. Its two `git cat-file` processes
  spawn on first use. Nothing ever closes them: the session is out of the registry and `closeOnce`
  already fired. `CloseAll` cannot reach them either.
- `StartSearch` → `BeginSearch()` returns a live context on a dead session. `CancelSearch` uses
  `Registry.Peek`, which returns nil or the replacement, so the Stop button cannot cancel it. The
  full-worktree scan runs to completion.

Reachable: close a repo workspace (`state/workspace.ts:73` fires `CloseWorkspace`) while its diff
tab is loading or a search is being started; or edit git.path while a diff reads. The `cat-file`
leak is permanent for the process.

Fix: add a `closed bool` under `s.mu`, set in `Close`. `catfileSession` returns an error
(`ErrSessionClosed`) when closed; `readHeadSide` propagates it. `BeginSearch` returns an
already-cancelled context when closed.

## F5 — `CodeWorkspaceService.Shutdown` is never called (Low)

Sites:
- `apps/kira-space/main.go:135-151` (`teardown`: terminal, gitsock, askpass, repos, db; no
  codeworkspace)
- `internal/bridge/codeworkspace.go:420-424` and `internal/codeworkspace/session.go:92-93` (both claim
  `main.go`'s teardown calls it "beside repositories.Close()")

Bug: open `cat-file` pairs and running searches are never stopped at quit. The children exit on stdin
EOF when the process dies, so the practical harm is small. The two doc comments describe teardown
that does not exist.

Fix: call `codeWorkspaceSvc.Shutdown()` in `teardown`, before `repositories.Close()`. Searches read
settings through `Deps.Repos`, so the order matters.

## F6 — `gitsession.Registry` close is owned by gitsock and skipped when it never listened (Low)

Sites:
- `apps/kira-space/internal/gitsock/server.go:300-305` (early return when `!s.listening`),
  `:349-351` (the only `Registry.Close()` call)
- `apps/kira-space/main.go:135-151` (`teardown` never closes `gitRegistry`)
- `internal/shell/quit.go:115-159` (`flushThenQuit` runs `teardown()` before `app.Quit()`; windows
  and Wails streams are still live)
- `apps/kira-space/internal/appshell/stream.go:11-15` (native `ServeGitStream` shares `gitRegistry`)

Bug:
- When `gitSock.Start` did not listen (lock held by another instance, or a listen error), teardown
  never calls `Registry.Close`. Entries, watchers, auto-fetch timers and `review.db` stay open until
  process exit; `review.db` is never checkpointed and closed cleanly.
- When it did listen, `Registry.Close` runs while the native graph's `ServeGitStream` is still
  serving: Wails closes streams only in `App.cleanup`, after `teardown`. A native request landing in
  that window re-`Acquire`s entries on the closed registry, and its `RepoSettingsGet` hook hits
  `repositories` right as `repositories.Close()`/`db.Close()` run. Errors only, in the last
  milliseconds before quit.

Fix: host side, no B-stream change needed. `Registry.Close` is idempotent (swaps the entry map;
`gitreview.Store.Close` is idempotent), so call `gitRegistry.Close()` in `teardown` right after
`gitSock.Close()`, before `repositories.Close()`. Fix the stale gitsock ownership comment in
`server.go:346-348` only if the fixer touches that file anyway.

## F7 — No single-instance guard; a second launch shares `kira.db` silently (Low)

Sites:
- `apps/kira-space/main.go:83-100` (`storage.Open`, migrations, `wireGit`/`gitSock.Start` all run
  before `application.New` at `:154`)
- `main.go:154-186` (no `SingleInstance` option; Wails v3 beta.21 has
  `application.Options.SingleInstance`)
- `apps/kira-space/internal/gitsock/server.go:99-101` (lock not acquired: logs at Info, returns nil)

Bug: a second process opens the same `kira.db`, restores the same window rows, and last-writer-wins
on `tabs`/`windows`/layout. Closing a window in one instance deletes a row the other still owns. Its
gitsock silently does not listen. Its Connected-editors pane and pairing dialog operate on a broker
nobody dials; a Revoke there writes `revoked_at` but cannot close the live connection held by the
first instance.

Reachable: macOS LaunchServices dedups ordinary launches, so only `open -n`, running the binary
directly, or a dev build pointed at the same `KIRA_SPACE_HOME`. Hence Low.

Fix: acquire a single-instance guard before `storage.Open`. Either `application.Options.
SingleInstance` (activate the first instance's window) with storage/gitsock init moved after
`application.New`, or reuse the existing `git.sock.lock` flock early: not acquired means another
instance owns this home, so activate/exit instead of continuing.

## F8 — `.vsix` ships `tests/**` and `playwright.config.ts` (Low)

Sites: `apps/kira-space-vscode/.vscodeignore:10-14`.

Bug: the ignore list covers `src/**`, `tsconfig.json`, `.vscodeignore`, `node_modules/**`, `**/*.map`
only. `vsce ls --no-dependencies` (run at `c7e3cca`) lists 21 `tests/**` files (~5k lines of
Playwright specs, fake hosts, servers) plus `playwright.config.ts` in the shipped package. A local
`test-results/` or `playwright-report/` directory would ship too.

Fix: add `tests/**`, `playwright.config.ts`, `test-results/**`, `playwright-report/**`. Keep the
file's own warning: no pattern touching `dist/`, `.vite/` or a leading dot. Re-run `vsce ls` to
confirm only `dist/**`, `resources/**`, `package.json`, `README.md`, `LICENSE` remain.

## F9 — `build:vsix` `sources` omit real build inputs; a stale `.vsix` survives (Low)

Sites: `apps/kira-space/build/Taskfile.yml:104-116`.

Bug: go-task skips the task when every listed source is unchanged. Missing inputs:
- `packages/git-ui/vite.config.ts`: the config `scripts/build-vscode.ts:11` builds the webview with.
- `apps/kira-space-vscode/README.md`: shipped in the `.vsix`.
- `bun.lock`: a dependency bump (Vue, SlickGrid, codicons) changes the bundle.
- `apps/kira-space-vscode/tests/**` and `playwright.config.ts` while F8 is unfixed (shipped).

Fix: add the first three. After F8 lands, tests no longer ship, so they stay out of `sources`.

## F10 — Remote workspaces sit in "connecting…" forever with no hint why (Low)

Sites:
- `apps/kira-space-vscode/package.json:25-27` (`extensionKind: ["workspace"]`)
- `apps/kira-space-vscode/src/connection.ts:101-104` (`socketPath` from the extension host's own
  home)
- `apps/kira-space-vscode/src/extension.ts:682-721` (`showConnectionStatus` copy:
  `Socket: ~/.kira-space/git.sock`)

Bug: under Remote-SSH/WSL/Dev Containers the extension runs on the remote host and dials the
remote's `~/.kira-space/git.sock`, which never exists. The state stays `connecting` with backoff
forever. The status copy names a path that looks right on the user's Mac and gives no remote hint.

Fix: when `vscode.env.remoteName` is set, show a distinct state/message ("Kira Space runs on this
Mac; remote workspaces are not supported") and skip the dial loop. Also print the resolved socket
path, not the literal `~` form.

## F11 — 4 biome `noExplicitAny` warnings in `review-target-race.spec.ts` (Low)

Sites: `apps/kira-space-vscode/tests/interaction/review-target-race.spec.ts:40,45,53,62`
(`(window as any).__resolveRepoList`/`__emitReviewTarget`/`__refsListCalls`). Added by `baf0990`
(Part 19 F6).

In scope here, not a deferral: `vscode/tests/interaction` is in this chunk's own file set (plan §1).
CLAUDE.md's fix-on-the-spot rule applies; the fix is local to one test file plus its support module.

Fix: declare the three test globals once (a `FakeReviewHostWindow` interface exported from
`tests/interaction/support/fakeReviewHost.ts`, or a `declare global { interface Window { … } }` block
there) and cast `window as unknown as FakeReviewHostWindow`. `bunx biome lint` on the file must
report 0 warnings.

## F12 — `ReadFile` size gate is stat-then-read (Low)

Sites: `apps/kira-space/internal/codeworkspace/files.go:127-145` (`os.Stat` size check, then
`os.ReadFile` of the whole file); `search.go:318-323` (same stat-then-open shape).

Bug: the 8 MiB bound is checked on a stat, then the file is read whole. A file that grows between the
two (a log being written in the worktree) is read and shipped over IPC at its new size. A non-regular
file reached through a listed symlink (a FIFO) passes the stat (size 0, not a dir) and then blocks
`os.ReadFile`/`os.Open` forever, pinning the bound call or a search worker.

Reachable: narrow. Symlink escape itself is not possible: `pathsafe.ValidateRelPath` returns the fully
resolved path and `requireUnder` rejects anything outside the resolved root.

Fix: open once, `f.Stat()` the descriptor, reject `!Mode().IsRegular()` as `missing`, and read through
`io.LimitReader(f, MaxReadBytes+1)`, classifying `tooLarge` on overflow. Same regular-file check in
`scanFile`.

## Examined, nothing real

- **gitstream allowlist drift (item 9).** `allowedMethods` has 54 request methods plus
  `graph.stream`; each one is dispatched by `internal/gitrpc`. `TestGitrpcDispatch_EveryMethodIsClassified`
  passes and fails on an unclassified new method. `guardRepoSettingsSet` field coverage is pinned by
  `TestRepoSettingsSetTouchesRestrictedField_CoversEveryPatchField`.
- **VS Code activation/deactivation (item 7).**
  - `ConnectionManager.dispose` runs twice (`deactivate`, then the `context.subscriptions` entry).
    Every step is idempotent: `#stopped`, token bump, `?.` on socket/transport, VS Code emitters'
    `dispose`. Inert.
  - `activityDebounce` and the `app.init` `.then` can call `render()` after dispose. They only set
    fields on a disposed `StatusBarItem`. Harmless.
  - `migrateLegacySettings`: `whenConnected` with no signal leaves one pending promise after dispose,
    nothing more. The unclosed `repo.open` is the connection's own idempotent per-repo hold
    (`gitsession.Conn.Open`), released on disconnect. One-shot. `settings.setGitPath` over gitsock is
    intended (refused only on the native stream).
- **Webview hosting (item 8).** CSP is `default-src 'none'` with a CSPRNG nonce. The bootstrap island
  is `type="application/json"`, never executed, with `<` escaped; U+2028/2029 are irrelevant to an
  HTML data block and `JSON.parse`. `KIRA_REPO` only seeds a repo when the user's own environment
  sets it. `resolveWebviewView` swaps `this.server` with an identity-checked `onDidDispose`.
  `createWebviewChannel.close()` is a correct no-op: `RpcServer.dispose` unsubscribes and aborts.
- **Version handshake (item 10).** `appVersion` `0.0.0` is display-only; the handshake compares
  `contractVersion` only (`gitsock/handshake.go:103`). `gitvsix` installs with `--force`, so a fixed
  version still reinstalls. `darwin/Taskfile.yml` copies the `.vsix` before `codesign --deep`: correct
  order. `build-vscode.ts`'s `bun:`/`Bun.` substring guard fails closed on a false positive.
- **Storage (item 11).** `TabsRepo.Save` validates then upserts and prunes in one transaction via
  `appstorage.ReplaceKeyed`. `GitRepoSettingsRepo.Set` validates before `Begin`. Migrations run
  through the shared `appstorage.OpenAt` (A-stream).
- **Frontend flush and close (item 12).** The flush ack lives in `packages/workbench`'s
  `createTabsStore` (B1, closed). `closeRepoWorkspace`'s order (tabs, then `CloseWorkspace`, then
  transport) is sound; its one real race is F3.
- **`proxyHandlers.ts` (item 13).** Runtime imports are `node:path`, `@kira/git-core` and local pure
  modules; `ConnectionManager` is type-only. Still vscode-free.
- **Path safety (item 6).** Symlink escape blocked (see F12). `ImportRepo`, `ListFiles` and
  `ReadDiff` all validate through `ValidateRelPath`.
- **Bridge services.** `gitclients.go`, `lifecycle.go`, `files.go` examined: fine apart from F1/F7.
