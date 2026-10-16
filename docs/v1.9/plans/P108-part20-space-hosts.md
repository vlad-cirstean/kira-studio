# P108 Part 20 — review plan: Kira Space hosts

Chunk B8, stream B position 8, last chunk of stream B (pre-plan §5.19). Parts 13-19 landed first.
One Opus reviewer runs this plan and reports findings. It fixes nothing. One Sonnet fixer then lands
one commit per finding. Tree surveyed: `ccc9ac0`.

Paths repo-relative. `Space` = `apps/kira-space`. `PI` = `Space/internal`. `PF` =
`Space/frontend/src`. `vscode` = `apps/kira-space-vscode`. `GU` = `packages/git-ui/src`. `B1`-`B7`
= Parts 13-19 (`kira-ui`/`workbench`/`theme`, `PI/git*` process/ops/session/rpc, `git-core` and
`GU` logic, `GU` components), all closed.

## 0. Method

- **`codegraph_explore`**, nine survey calls made while writing this plan: `main.go` boot order
  (`wireGit`, `storage.Open`, `repos.New`, service registration); teardown and quit (`teardown`,
  `beforeFlush`, `NewQuitter`, `CloseFlushCoordinator`, `gitsock.Server.Close`,
  `gitsession.Registry.Close`); `bridge/events.go` against `gitsock.Server.OnPairingChanged`/
  `OnClientsChanged` and `PF/state/gitClients.ts`; `vscode/src/extension.ts` `activate`/
  `deactivate` against `ConnectionManager`; `PF/main.ts`/`bridge/*`/`repo/git/transport.ts`
  against `bridge/gitstream.go` `ServeGitStream`; `PI/storage/repos/*`; `PF/state/{workspace,
  repoTabs,tabs}.ts` close and flush; `bridge/codeworkspace.go` against `PI/codeworkspace/*`;
  `vscode` webview hosting (`webviewProviderBase`, `html.ts`, `webviewDocument.ts`,
  `transport.ts`). The review is discovery, so the reviewer uses `codegraph_explore` too
  (`ToolSearch "codegraph"` first) for blast radius before any cold `Read`.
- **`git grep` of import lines and channel/method strings** decides exact caller and subscriber
  sets. CodeGraph's TS resolution over-links (pre-plan §0), and a Wails event channel or an
  `rpcstream` method string is a string match, not a graph edge.
- **Earlier stream-B fixes in this scope are the baseline, not new-finding material.** Since
  `d45eb28`: `70f4f51` (Part 17 F14, `vscode/src/connection.ts` `tokenRejected` close made inert),
  `bc365eb` (Part 17 F9, `PI/bridge/gitstream.go` `Conn.Emit` mutex), `cac7093` (Part 17 F3,
  `PF/repo/git/transport.ts` `channel.onClose`), `8d91abe` (Part 15/16 F1,
  `PI/storage/repos/gitreposettings.go` `checkout.autoStash`), `eb6f425` (Part 14,
  `PI/codeworkspace/diff.go`), Part 19's `vscode/tests/interaction` specs and fakes (`31068ad`,
  `98a4923`, `769b83a`, `baf0990`, `ccc9ac0`). Review the code each fix left, not the fix's own
  claim. `cac7093`'s `onClose` is new code for item 5.
- **Real probes** (scratch dir, `go test -race`, `bun test`, a Playwright run of `Space/tests/ui`
  or `vscode/tests`) only where a claim rests on runtime ordering or on packaging output: the
  teardown order against a live git stream (item 1), the pairing push (item 2), a `.vsix` content
  listing (item 10).

## 1. Own file set

Production about 3.9k Go, 9.7k `PF`, 5.0k `vscode` (`wc -l`). Tests about 1.2k Go, 3.4k
`Space/tests`, 5.1k `vscode/tests`. Pre-plan's ~28k total holds only with tests counted.

- **Go roots:** `Space/main.go` (308), `PI/layering_test.go` (33).
- **`PI/bridge`** (1,501 production, 17 files): `codeworkspace.go` (585), `gitstream.go` (228),
  `gitclients.go` (189), `terminal.go` (122), `github.go`, `events.go`, `files.go`, `tabs.go`,
  `settings.go`, `lifecycle.go`, `layout.go`, `link.go`, `stream.go`, `browser.go`. Tests:
  `github_test.go`, `gitstream_test.go`, `gitstream_classification_coverage_test.go`.
- **`PI/appshell`** (`dialogs.go`, `menu.go`, `stream.go`), **`PI/appcore/deps.go`**,
  **`PI/config`** (`paths.go`, `env.go`), **`PI/buildinfo`**.
- **`PI/codeworkspace`** (1,135): `search.go` (437), `files.go`, `session.go`, `textpos.go`,
  `diff.go`, `enumerate.go`, `paths.go`. Tests: `search_test.go`, `textpos_test.go`.
- **`PI/storage`** (1,198, 21 files): `db.go`; `migrations/{0001_init,0002_p100_tabs_layout}.sql`,
  `embed.go`; `model/*`; `repos/{coderepos,gitclients,gitreposettings,helpers,layout,repos,
  settings,tabs,windows}.go`, `gitreposettings_test.go`.
- **`PF`** (75 files): `App.vue`, `main.ts`, `bridge/{index,control}.ts`; `repo/GitPanel.vue`
  (750), `repo/git/{transport (333),hostHandlers (485),reviewSession,viewStateStore,gitUiModule}
  .ts`, `repo/state/{fileTree,perRepo,repoHeads,repoLinks,search,worktrees}.ts`; `state/*`
  (`repoTabs` 293, `tabs`, `tabDomain`, `tabKinds`, `workspace`, `gitClients`, `gitCredential`,
  `coderepos`, `repoOpenHold`, others); `views/repo/*` (`RepoFileView` 438, `reviewDecorations`
  623, `useDiffEditor` 274, others); `workbench/*` (`GitPairingDialog`, `GitCredentialDialog`,
  `SettingsDialog`, panes); `vite.config.ts`, `tsconfig`.
- **`Space/tests`**: `ui/{repo-workspace (1,159),repo-graph-lifecycle}.spec.ts`,
  `ui/support/{mockRuntime,gitStreamMock,graphStreamFixture,ipcChannels,bootSnapshots}.ts`,
  11 `unit` specs. `Space/playwright.config.ts`.
- **Build:** `Space/Taskfile.yml`, `Space/build/{Taskfile.yml,config.yml,darwin/Taskfile.yml,
  darwin/Info.plist,darwin/Info.dev.plist}`, icons.
- **`vscode/src`**: `extension.ts` (771), `proxyHandlers.ts` (667), `reviewMarking.ts` (629),
  `connection.ts` (479), `commands.ts`, `reviewComments.ts`, `blameWidget.ts`, `diffToolbar.ts`,
  `html.ts`, `webviewDocument.ts`, `webviewProviderBase.ts`, `reviewView.ts`, `panelView.ts`,
  `transport.ts`, `virtualUri.ts`, `virtualFileDecoration.ts`, `ports/*`, `webview/main.ts`.
  `vscode/{package.json (504),.vscodeignore,playwright.config.ts}`, `vscode/tests/{interaction,
  layout,support}`.
- **Scripts:** `scripts/build-vscode.ts`, `scripts/package-vscode.ts`.

Tests are read only where they pin a contract the review questions, or where a mock masks a gap
(item 2).

## 2. One hop: callers

- **None above this chunk**, confirmed. Callers are the Wails runtime (`main`, bound service
  methods, the `ServeGitStream` stream handler, window events) and the VS Code host (`activate`,
  `deactivate`, registered commands, `WebviewViewProvider.resolveWebviewView`, configuration and
  workspace events). No other package imports `Space/*` or `vscode/*` (`PI/layering_test.go`
  exempts `internal`, `internal/bridge`, `internal/appshell`; check that nothing outside this chunk
  imports them).
- **Wails bindings** (`Space/frontend/bindings`, gitignored, generated) are the contract between
  `PI/bridge` and `PF`. Diff the bound method set against every `PF` call site after
  `wails3 generate bindings` rather than trusting either side.
- **`GU/main.ts` `mount`** (B7) is called from `PF/views/repo/RepoGraphView.vue`,
  `PF/repo/RepoReviewView.vue` and `vscode/src/webview/main.ts`. Part 19's plan treated their
  on-disk state as the caller contract; this pass reviews them as own code.

## 3. One hop: callees

- **B3-B5 Go (closed):**
  - `gitsession.NewRegistry` with `Settings`/`RepoSettingsGet`/`RepoSettingsSet` hooks,
    `Registry.Close`, `NewConn`, `Conn.{DisableAutoFetch,SetEmit,Emit,Close}`.
  - `gitrpc.New`, `Router` method table (`allowedMethods` in `gitstream.go` must match it).
  - `gitsock.New`, `Server.{Start,Close,OnPairingChanged,OnClientsChanged,Approve,Deny,Revoke,
    Clients}`, the `flock` single-listener lock.
  - `gitaskpass.New`/`Broker.Close`/`RunHelper`, `gitexec` runner and discovery.
  - `PI/codeworkspace` calls `catfile.Session` (B3) and `pathsafe.ValidateRelPath`.
- **Part 2-3 Go (A-stream, closed):** `internal/rpcstream.NewSession` (8 MiB frame cap),
  `internal/appstorage`/`sqlitex`, `internal/kirapaths`, `internal/logging`, `internal/
  startupfail`, `internal/shell` (`Quitter`, `CloseFlushCoordinator`, window registry).
- **B6/B7 (closed):** `GU` `mount`, `BridgeClient`, `Transport`; `git-core` types; `@kira/git-ipc`
  `ServerHandlers`, `createRpcServer`, channel types.
- **B1 (closed):** `@kira/kira-ui`, `workbench` (`PF/workbench/*` builds on it).
- **Libraries:** Wails v3 (`application.New`, `NewService`, `Window`, `Events`, menus, dialogs),
  Vue, Pinia, TanStack Query, VueUse, Monaco (`PF/views/repo/*`), `vscode` API
  (`WebviewViewProvider`, `CommentController`, `FileDecorationProvider`,
  `TextEditorDecorationType`, `workspace.fs`, `SecretStorage`/`globalState`), `@vscode/vsce`,
  Bun (`Bun.build`), Vite.

## 4. Edge cases to weight

1. **Teardown completeness and order (`Space/main.go`).** `teardown` runs, in order:
   `terminalSvc.Shutdown`, `gitSock.Close`, `askpassBroker.Close`, `repositories.Close`,
   `db.Close`.
   - It never calls `codeWorkspaceSvc.Shutdown()`. `bridge/codeworkspace.go` (~line 420) and
     `codeworkspace/session.go` `CloseAll` both claim `main.go` calls it "beside
     `repositories.Close()`". Open `catfile` processes and running searches outlive teardown.
   - `gitRegistry.Close()` runs only inside `gitsock.Server.Close` (`gitsock/server.go` ~350),
     which returns early `if !s.listening`: lock held by another instance, or `Start` failed. Then
     no `Registry.Close` (entry teardown, watchers, `review.db` close). Decide whether `main.go`
     must own the registry's close.
   - `repositories.Close`/`db.Close` run while a Wails `ServeGitStream` may still serve (the
     native graph's stream is not a gitsock conn). Its handlers call `RepoSettingsGet` into a
     closed statement set. Probe with a live stream during quit.
   - `beforeFlush` only does `windows.DetachAll`. Confirm the 2 s `Quitter` flush window and the
     frontend flush handshake (item 12) finish before `teardown`.
2. **Pairing and clients push channels have no Go emitter.** `bridge/events.go` defines
   `ChannelGitPairing` (`kira:git:pairing`) and `ChannelGitClientsChanged` (`kira:git:clients`),
   but no Go code subscribes `gitsock.Server.OnPairingChanged`/`OnClientsChanged` or emits either
   channel (`git grep` confirms; `main.go:48` says "wired by nothing yet"). `PF/state/gitClients.ts`
   `hydrateGitClients` subscribes `control.onGitPairingChanged`/`onGitClientsChanged` and relies on
   them to clear the dialog after approve/deny. Likely effects: a pairing request after boot never
   shows (`GitPairingDialog`), approve/deny never clears it, revoke/pair never updates the
   Connected editors pane. `Space/tests/ui/support/ipcChannels.ts` (~26-32) mocks the channels,
   which masks the gap. Probe a real pair from a second process. History is shallow (`30089ea`
   graft), so treat as currently-true, not as a regression to bisect.
3. **Two instances.** No Wails single-instance option (`git grep SingleInstance` finds nothing).
   A second launch shares `kira.db`, restores the same window list (both write `windows`/`tabs`
   rows), and its `gitsock.Start` silently skips listening. Check SQLite busy handling and
   last-writer-wins on tabs/layout; check that the second instance's VS Code-facing state
   (clients pane, pairing) says anything at all.
4. **`PF/main.ts` bootstrap has no error path.** `void bootstrap()` runs `Promise.all` of six
   hydrates with no `catch`. One rejection and `app.mount` never runs: a blank window, no retry.
   Compare `GU`'s `retryBootstrap` (B6) and Studio's own boot.
5. **`PF/repo/git/transport.ts` channel lifecycle (`cac7093`, new code).**
   `channel.onClose` disposes `remote` and deletes `sharedClientsByCodeRepoId[codeRepoId]`
   unconditionally, with no identity check against the current entry. After
   `disposeGitTransport` plus a fast reopen, the old channel's late close evicts the newer client.
   Leases (`leaseOf`) held by mounts on a dead client stay dead until remount.
   `localEmittersByCodeRepoId` is overwritten on reconnect, so mounts listening on the old local
   emitter miss `review.target`/`ui.action`. `linkAbort` and `credential.request` routing to
   `gitCredentialStore`: check both survive a reconnect.
6. **`PI/codeworkspace` session lifetime.** `Registry.Open` replaces a session on a
   `Root`/`GitPath` change via `existing.Close()`. `catfileSession()` and `BeginSearch()` have no
   closed guard: a caller holding a replaced session spawns a `cat-file` process or a
   `context.Background()`-rooted search nobody closes. `StartSearch`'s goroutine outlives its
   window (`EmitTo` no-ops, the scan continues). `ReadFile` stats then reads (size gate TOCTOU);
   `os.Stat` follows symlinks: check whether `pathsafe.ValidateRelPath` or `scanFile` stops a
   symlink escaping the root. Check `ImportRepo`'s path validation.
7. **VS Code activation and deactivation (`vscode/src/extension.ts`).**
   - `void migrateLegacySettings(...)` awaits `whenConnected` with no abort signal, calls
     `repo.open` on the first workspace folder and never `repo.close` (a hold on the connection),
     then `repoSettings.set`, `settings.setGitPath`, then sets the `globalState` flag. A failure
     midway: flag unset, partial migration re-run next activation. `settings.setGitPath` is
     refused on the native allowlist (item 9) but allowed over gitsock: confirm intent.
   - `context.subscriptions` gets `{dispose: () => manager.dispose()}` before the `manager.on`
     unsubscribers, and `deactivate` calls `connection?.dispose()` again. Check
     `ConnectionManager.dispose` idempotency and whether handlers fire during dispose.
   - `activityDebounce` `setTimeout` is never cleared on dispose. The `app.init` `.then` can run
     after dispose. Module-level `connection` on a re-activate in the same host.
   - `extensionKind: ["workspace"]`: under Remote-SSH it dials the remote host's
     `~/.kira-space/git.sock`. Check the failure copy says so.
8. **Webview hosting.** `webviewDocument.ts` CSP: `default-src 'none'`, nonce `script-src`,
   `style-src 'unsafe-inline'`, graph-only `worker-src ${cspSource} blob:`. Bootstrap island:
   `JSON.stringify(bootstrap).replace(/</g, '\\u003c')` inside `<script type="application/json">`;
   check U+2028/2029 and that nothing reads it as script. `html.ts` puts `process.env.KIRA_REPO`
   into the production bootstrap: confirm test-only. `webviewProviderBase.resolveWebviewView` on a
   re-resolve (view hidden then shown, `retainContextWhenHidden` off): old `RpcServer` disposed
   before the new one serves? Emits during hidden are dropped; `pendingUiAction` is one-shot.
   `transport.ts`'s `close()` is a no-op: check who relies on it.
9. **`bridge/gitstream.go` allowlist.** `allowedMethods` (55 Router methods; refuses
   `worktree.prepare`, `worktree.cancelPrepare`, `settings.setGitPath`), `allowedStreamMethods`
   (`graph.stream` only), `guardRepoSettingsSet` (refuses `WorktreePrepareScript`/
   `WorktreeBasePath`). Diff against the current `gitrpc` Router table: a method added since is
   silently refused on native. `gitstream_classification_coverage_test.go` should fail on drift;
   confirm it does. Any other `RepoSettings` field that runs a command or picks a path? P111
   overlap on the pull-strategy method: name only.
10. **Packaging.** `.vscodeignore` excludes only `src/**`, `tsconfig.json`, `.vscodeignore`,
    `node_modules/**`, `**/*.map`: `tests/**` (~5k lines), `playwright.config.ts` and any local
    `test-results` ship in the `.vsix`. Probe with `vsce ls`. `build/Taskfile.yml` `build:vsix`
    `sources` omit `vscode/tests` and `.vscodeignore`-affecting inputs: a stale `.vsix` survives
    such a change. Version `0.0.0` in both `build/config.yml` and `vscode/package.json`: check the
    `appVersion` handshake does not refuse or mis-compare. `darwin/Taskfile.yml` copies the `.vsix`
    before ad-hoc `codesign --deep`. `build-vscode.ts`'s `bun:`/`Bun.` substring check (false
    positive on a string literal, false negative on a dynamic import). `package-vscode.ts` magic
    and size checks. `vscode/package.json` has no `scripts`/`files`; `"type": "module"` with a
    `.cjs` `main`.
11. **Storage.** Migrations `0001`/`0002` idempotent under a partially applied run; `Tabs.Save`
    upsert-then-prune per `window_key` inside one transaction?; `Settings` patch validation
    (`appearance`, `git`, `advanced.gitLogLevel`) rejects unknown keys and bad enums before write;
    `Repos.Close` closes statements only (the DB is `db.Close`). Survey found it sound; the
    reviewer confirms, it does not assume.
12. **Frontend flush and close.** `createTabsStore` `onFlushBeforeClose`/
    `onWindowFlushBeforeClose` against `Quitter`'s 2 s: a slow or failing save loses tabs silently?
    `PF/state/workspace.ts` `closeRepoWorkspace` runs, in order: `closeWorkspaceTabs`,
    `codeWorkspaceCloseWorkspace` (error ignored), `disposeGitTransport`, drop fileTree/search.
    A close racing an open of the same repo (`repoOpenHold`).
13. **`proxyHandlers.ts` stays vscode-free** (watch item). Runtime imports: `node:path`,
    `@kira/git-core`, `@kira/git-ipc`, local pure modules. `import type { ConnectionManager }`
    from `connection.ts` (which imports `vscode`) is the only coupling. Report only if a narrow
    port would close a real defect or a test gap, not as style.

## 5. Watch items from pre-plan §5.19

- **P100 Parts 2-3 extraction and rename:** stale comments are the visible residue. `main.go`'s
  header says "four bridge services" and "no terminal"; it registers 10 (`GitClients`,
  `CodeWorkspace`, `GitHub`, `Link`, `Files`, `Settings`, `Layout`, `Tabs`, `Terminal`,
  `Lifecycle`). The `Shutdown` doc claim (item 1) is the same kind. A stale comment is a finding
  only where it hides a real defect.
- **`proxyHandlers.ts` vscode-free by design:** confirmed at runtime; type-only coupling (item 13).
- **`PI/storage` lands here with `PI/bridge`:** confirmed. `8d91abe` (Part 15/16 F1) already edited
  `gitreposettings.go`; review as baseline. The pre-plan's 31-edge count was not re-counted.
- **Churn `PI/storage` 673, `PF/repo` 677:** `PF/repo/git/transport.ts` (item 5) and
  `hostHandlers.ts` carry most of it.
- **Added while surveying:** teardown gaps (item 1), unwired pairing channels (item 2), no
  single-instance guard (item 3), unguarded frontend boot (item 4), `.vsix` contents (item 10).

## 6. Out of scope

- **B1-B7's own files** (`kira-ui`, `workbench`, `theme`, `PI/git*`, `git-core`, `git-ipc`, `GU/**`,
  `packages/git-ui/vite.config.ts`). Closed. A needed change there is reported here, with the
  symbol named, only when a host-side fix cannot close it (item 1's `gitsock.Server.Close` early
  return is such a candidate).
- **A-stream internals** (`internal/rpcstream`, `internal/shell`, `internal/appstorage`,
  `internal/kirapaths`, `internal/logging`). Read only to judge this chunk's use of them.
- **Generated code:** `Space/frontend/bindings`, `packages/git-ipc/src/generated`.
- **Known open items** in `docs/ARCHITECTURE.md`: independent `gitsession.Conn`s for native and
  VS Code, native `review.session` expiry, `pendingReviewTargetByCodeRepoId` leak,
  `loadComments`' swallowed error, comment-reload fan-out, `fileTree.ts` per-row tracking,
  quick-open debounce/recency/50k cap, C5 tree not following the filesystem, C7 search limits,
  `vscode-bridge.css` specificity tie, `pr.yml` missing Kira Space coverage.
- **P111's pull-strategy wire change.**
- **Style nits and library-rule conformance on their own.** Findings must be real bugs:
  correctness, races, leaks, lost state, error handling, contract mismatches, packaging that
  ships wrong content, security (CSP, path escape) with a real path to exploit.
