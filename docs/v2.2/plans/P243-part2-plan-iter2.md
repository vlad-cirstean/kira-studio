# P243 Part 2 plan, iter2: remove the VS Code extension and its git server

SPEC row P243 Part 2. User's words for P243: "drop the VS Code extension, and the git server it uses
to connect, etc." Part 2 deletes. Part 1 already moved the coverage (`P243-part1-result.md`). No
restyling: P245 owns every `kv:`, `--vscode-*`, codicon and token change (section 9 lists what this
removal unblocks).

Baseline: iter1 `P243-plan.md` §2, §3, §5, §7 and Part 1 iter2 §8. Where this file differs, this file
wins. Planned against `v2.0` at `c10610314` (P242 Part 4 landed and `Done`; Space migrations end at
`0030`).

Discovery: `codegraph_explore` (index re-synced with `codegraph sync .`) over `createRpcServer`,
`createSocketChannel`, `VSCODE_WEBVIEW_BUFFER_ENCODING`, `BufferEncoding`, `HostKind`,
`hostConnectionState`, `ConnectionBanner`, `SettingsState`, `Capabilities`/`createDetailActions`,
`createStreamChannel`, `Transport`, `buildReadOnlyRowMenu`/`buildReadOnlyRefMenu`, `gitBlockedCopy`,
`NoRepositoryPanel`, `GitClientsService`/`InstallVsCodeIntegration`. `apps/kira-space/internal/**`
Go is not in the index (same gap as iter1 and Part 1), so read directly plus `git grep` for
importers: `appwire/{appwire,wire}.go`, `main.go`, `gitsock/lock.go`, `bridge/{gitstream,
gitstream_test,gitstream_classification_coverage_test,events}.go`, `gitrpc/{handlers,wire,graph,
remote,review,worktree,contract}.go`, `gitsession/{worktree,entry}.go`, `flowharness/{harness,
harness_test}.go`, `storage/migrations/embed.go`, `internal/rpcstream/session.go`; frontend
`repo/git/hostHandlers.ts`, `views/repo/RepoGraphView.vue`, `bridge/index.ts`; root `package.json`,
`knip.json`, `biome.json`, Taskfiles, `scripts/{check-tokens,verify-packaging}.sh`,
`.github/workflows/{pr,release}.yml`; `P242-part4-plan-iter2.md` and the `p242d-L` diff.

## 0. Deltas vs iter1 and Part 1 §8 (current tree)

1. **P242 Part 4 landed.** Space migration high-water is `0030`, so the `git_clients` drop is
   `0031_p243_drop_git_clients.sql`. Precedent: Studio `0026_p100_drop_git_tables.sql`.
2. **Part 1's ported tests send extension-injected params.** `gitflow/graphstream_test.go:45,46,52`
   and `reviewflow/ranged_test.go:198` pass `pageSize`. `gitrpc` decodes with plain
   `json.Unmarshal`, so a dropped field is ignored silently and the tests would change meaning.
   They switch to the stored `kiraSpace.graph.pageSize` (`repoSettings.set`) in the same commit
   that drops the params.
3. **Commit order changes.** Iter1 deleted the extension last. The extension imports
   `createRpcServer`, `createSocketChannel`, git-core ports and every contract entry, and
   `typecheck:git`/`test:unit` include it. So the extension goes first; every later commit then
   builds and typechecks without it.
4. **One extension test is a git-ui guard.** `apps/kira-space-vscode/src/vueComponentImports.test.ts`
   walks `packages/git-ui/src` for `import type X from '*.vue'` (a runtime-blank component). It
   moves to `packages/git-ui/src/vueComponentImports.test.ts`. The other 10 extension unit tests
   (`linkUrl`, `prUrl`, `proxyHandlers`, `commands`, `blameState`, `memoizedSetter`, `virtualKey`,
   `linkOpenExternal`, `prOpenExternal`, `webviewDocument`) test extension code and die with it.
5. **`rpc.test.ts` drives the client through `createRpcServer`** (15 uses). The client stays (Space
   uses it); the server goes. Client behaviour tests move onto a test-local scripted peer;
   server-only tests die (section 2.5).
6. **The transfer-list path is dead too.** `streamChannel.post` sends `JSON.stringify(message)` and
   ignores `transfer`; it is the only channel left. `MessageChannelLike.bufferEncoding`, the
   `transfer` argument, `encode`/`decode`/`collectTransferables`/`dedupeTransferList` and the base64
   walk go with `socketChannel.ts`. `encodeStreamPayload`/`decodeStreamPayload` stay
   (`graphStreamFixture.ts`, `rpc.ts` client decode).
7. **Allowlist removal changes refusal codes only.** `Router.ForConn` dispatches `graph.stream`
   as its only stream and no `review.session.*`/`review.open`/`editor.*` request. Without the
   allowlist those reach the router and get `E_UNKNOWN_METHOD` instead of `E_READ_ONLY`; Space
   answers all of them host-side and never sends them. `guardRepoSettingsSet` stays.
8. **`rpcstream.Handlers.MaxFrameBytes` keeps its field.** `bridge/gitstream.go:220` also sets it;
   only the gitsock comment goes.
9. **Bound services: 23 -> 22.** `flowharness/harness_test.go:22` asserts 23; `appwire.go:336`
   comment already says 22 (stale until now).
10. **Space test mocks hold vsix and pairing entries** in `bootSnapshots.ts`, `ipcChannels.ts`,
    `mockRuntime.ts`. The visual settings spec lists `Connected editors` and owns
    `settings-connected-editors-visual-linux.png`.
11. **WorktreeDialog's prepare step is dead in Space.** `runPrepareScript` is `false` in Space;
    the dialog shows the script and refuses to run it. ADE runs the script (`gitprepare`), and the
    Space repos dialog edits it (`repos-dialog.spec.ts`). The whole prepare step and its toolbar
    strip go (D7).

## 1. How it connects today (unchanged from iter1 §1)

Extension webview mounts `@kira/git-ui`; extension host proxies over `createRpcServer` and dials
`${KIRA_SPACE_HOME}/git.sock` (`gitsock`: listener, flock `git.sock.lock`, pairing, token store
`git_clients`, peer creds). `gitvsix` installs the bundled `.vsix`. Space's own git module
(kept) is `bridge.ServeGitStream(router, conn)` over the Wails `Stream('git')` through
`internal/rpcstream`, with frontend `repo/git/transport.ts` (`createRpcClient` +
`createStreamChannel`) and `hostHandlers.ts` answering host methods. The ADE board holds its own
in-process `gitsession.Conn`. Nothing in the native path goes through a bound method except
`GitCredentialService` (kept).

## 2. Inventory

### 2.1 Delete

| Item | Evidence |
|---|---|
| `apps/kira-space-vscode/**` (77 tracked files) | the extension |
| `apps/kira-space/internal/gitsock/**` (incl. `testdata`) | importers: `appwire`, `bridge/gitclients{,_test}.go`, `main.go` (`AcquireLock` only, moves, step 1) |
| `apps/kira-space/internal/gitvsix/**` | importers: `bridge/gitclients.go`, `appwire` |
| `bridge/gitclients.go`, `bridge/gitclients_test.go`; `bridge/events.go` `ChannelGitPairing`, `ChannelGitClientsChanged` | every method is pairing or vsix; channels emitted only by `AttachGitClientsPush` |
| `storage/model/gitclient.go`, `storage/repos/gitclients.go`, `Repos.GitClients` | read only by gitsock and GitClientsService |
| `appwire`: `gitsock`/`gitvsix` imports, `Wired.GitClients`, `detachGitPush`, `GitSock()`, Bound entry, teardown socket close (keep `w.Git.registry.Close()` and askpass close, reword their comments); `wire.go` `gitWired.sock`, `gitsock.New/Start` | only wiring |
| `flows/editorflow/**` | git.sock pairing and vsix only; Part 1 gate check: 0 git requests referenced only there |
| `bridge/gitstream.go` `allowedMethods`, `allowedStreamMethods`, `allowedRequest`, `allowedStream`; `gitstream_classification_coverage_test.go`; `gitstream_test.go` allowlist tests (`AllowlistedMethodsReachInnerHandler`, `WriteMethodsAreRefused`, `HostAnsweredMethodsAreRefused`, `UnknownMethodIsRefused`, `GraphStreamReachesInnerHandler`, `UnknownStreamMethodIsRefused`, `writeMethods`, `hostAnsweredMethods`) | after prepare goes the allowlist equals the dispatch set. Keep both `GuardRepoSettingsSet_*` tests |
| Contract, Go and TS: `worktree.prepare`, `worktree.cancelPrepare`, `worktree.progress` event, `WorktreePrepare*` types, `editor.resolveConflict`, `worktree.openWindow`, `settings.changed`, `connection.changed`, `SettingsSnapshot`, `app.init` `host`/`settings`/`capabilities`, `HostKind` (git-ipc and git-core copies), injected params (`graph.loadMore`/`graph.stream` `scope`+`pageSize`, `review.resolveBase` `baseCandidates`, `remote.pullPreflight` `strategySetting`) | iter1 §2.1 row; Go falls back to stored repo settings (`pageSizeFrom`, `repoGraphScope`, `entry.RepoSettings().PullStrategy`, stored base candidates) |
| `gitsession.RunPrepare`, `WorktreePrepareDeps`, `WorktreePrepareResult`, `CancelPrepare`, `noSpawnPrepareResult`, prepare timeout helper, `RepoEntry.prepare` slot and its `forceCancel` in teardown; `gitrpc/worktree.go` prepare handlers; tests `gitrpc/worktree_test.go` `WorktreePrepare_*`/`WorktreeCancelPrepare_*`, `gitsession/worktree_test.go` prepare cases, `gitsession/concurrency_test.go` prepare half, `gitflow/ops_local_test.go:221` block, `gitflow/errors_test.go` `TestWorktreeCancelPrepare` | only `worktree.prepare*` reaches them. `gitprepare` stays (ADE: `ade/{deploy,board,runs,setup,logsink}.go`) |
| git-ui: `ConnectionBanner.vue`, `BridgeClient` connection-state machinery, `state/settings.ts` (`SettingsState`), `PrepareOutput.vue`, `OpsState` prepare fields and methods (`ops.ts` `worktree.progress` handler, `runWorktreePrepare`, `cancelWorktreePrepare`, `dismissWorktreePrepareResult`, status computed, buffer), WorktreeDialog prepare step, AppToolbar prepare strip, App.vue `handleOpenWorktreeWindow` and its menu item, "Resolve in VS Code" button, read-only branches gated on `capabilities.write === false` (`buildReadOnlyRefMenu`, `buildReadOnlyStashMenu` if only those callers), `NoRepositoryPanel` VS Code copy, `gitBlockedCopy` `host` param | Space hardcodes every capability (`hostHandlers.ts:193`): true gates become unconditional, false branches go. `buildReadOnlyRowMenu` stays (review context menu) without its `clipboardEnabled` param |
| `packages/git-ipc`: `socketChannel.ts` + test, `./socketChannel` export, `createRpcServer` + server types (`RequestHandler`, `StreamHandler`, `ServerHandlers`, `RpcServer`, `CreditGate` if client-unused), `VSCODE_WEBVIEW_BUFFER_ENCODING`, `BufferEncoding`, base64 helpers, `encode`/`decode`/`collectTransferables`/`dedupeTransferList`, `MessageChannelLike.bufferEncoding` and `post`'s `transfer` arg | `createRpcServer` caller: extension only; `createSocketChannel`: extension only; delta 6 |
| `packages/git-core/src/ports/**` and their `index.ts` exports | 0 importers outside the extension (grep over git-ui, git-ipc, Space frontend, workbench: `Browser`, `Clipboard`, `Disposable`, `EditorIntegration`, `VirtualDocumentSource`, `FileWatcher`, `Logger`, `ProcessRunner`, `Storage`, `Theme`, `Windows`, `WorkspaceRoots` all 0; git-ui's `RepoCandidate` comes from git-ipc) |
| git-core `settings/schema.ts`: `HostKind`, `workbench.tree.indent`; `coerceSettings`/`CoerceProblem`/`CoerceResult`/`SettingDef` if knip reports them unused | extension mirrored VS Code settings; Space reads `kiraSpace.*` keys from stored repo settings. Keys keep their names (D9) |
| Space frontend: `workbench/GitPairingDialog.vue`, `workbench/settings/ConnectedEditorsPane.vue`, `state/gitClients.ts`; `bridge/index.ts` GitClientsService import, git client/pairing/vsix methods and types; `main.ts` store hydrate; `App.vue` mount and comment; `state/settings.ts` `'Connected editors'`; `SettingsDialog.vue` branch | callers of GitClientsService only. `PairingRequestDialog.vue` and `usePendingDecision.ts` stay (mobile pairing, DB MCP approval) |
| `packages/shared/domain/git.ts` `gitClient*`, `gitPairing*`, `gitVsix*`; `packages/shared/protocol/events.ts` `gitPairing`, `gitClientsChanged` | frontend consumers above. `gitCredentialPromptSchema` stays |
| Space UI support: `bootSnapshots.ts` `gitClientsList`, `ipcChannels.ts` `gitClients*`/`gitPairing*`/`gitVsix*`, `mockRuntime.ts` their FQNs and defaults; `tests/visual/settings.spec.ts` `'Connected editors'` and `settings.spec.ts-snapshots/settings-connected-editors-visual-linux.png` | mocks of deleted bindings |
| Build: `scripts/{build-vscode,package-vscode}.ts`; root `package.json` workspace `apps/kira-space-vscode`, scripts `build:vscode`, `package:vscode`, `test:webview`, the `typecheck:git` extension leg, `test:unit`'s `apps/kira-space-vscode/src`, devDeps `@types/vscode`, `@vscode/vsce`; `bun.lock`; `knip.json` workspace block and ignores `@types/vscode`, `@vscode/vsce` (keep `@vscode/codicons`); `biome.json:310` ignore line and `"vscode"` in the restricted-import group (keep `"vue"`, reword the message); `scripts/check-tokens.sh` webview leg (lines 79-88); `scripts/verify-packaging.sh` S9 and A6; `apps/kira-space/build/Taskfile.yml` `build:vsix`; `build/darwin/Taskfile.yml` vsix deps and both copies; `.gitignore` `.vscode-test`; `tools/mutation/areas.json` extension area and its test path; `packages/git-ui/vite.config.ts` and git-ui devDeps knip then reports | `.vsix` chain only. The Playwright `webview-layout`/`webview-interaction` projects live in the deleted `apps/kira-space-vscode/playwright.config.ts` |
| `.github/workflows/release.yml:137-142`, `pr.yml:198,230` step names | pending patches only (section 4) |

### 2.2 Keep, edit

| Item | Change |
|---|---|
| `gitsock.AcquireLock` | moves to `apps/kira-space/internal/config/lock.go` as `config.AcquireLock`; `main.go` uses it on `app.lock` |
| `main.go` | after `acquireSingleInstance`, `removeLegacyGitSocket()`: best-effort `os.Remove` of `git.sock` and `git.sock.lock` under `config.KiraSpaceHome()`; ignore not-exist; `slog.Warn` anything else. Safe: the instance lock means no other Space owns this home. Reword the `acquireSingleInstance` comment (no gitsock) |
| `ContractVersion` / `CONTRACT_VERSION` | 45 -> 46 in `gitrpc/contract.go` and `git-ipc/src/validate.ts` with one history line each; `gitrpc/stash_test.go` `TestContractVersion_Is45` -> `_Is46` |
| `validate.ts` contract-shape tables | drop removed requests and events |
| Space `hostHandlers.ts` | `app.init` returns `{contractVersion, git, dateFormat}`; `editor.resolveConflict`/`worktree.openWindow` handlers and `refuseLocally` (if unused) go; header comment stops citing `proxyHandlers.ts` |
| Space mounts `RepoGraphView.vue`, `RepoReviewView.vue`, `ade/v2/review/AdeReviewFiles.vue` | stop passing `host` and `hostConnectionState`; drop the OQ4 comment |
| git-ui `mount()` (`main.ts`, `MountRoot.vue`, `index.ts`), `App.vue`, `ReviewView.vue`, `detailActions.ts`, `review.ts`, `ReviewCommentsPane.vue`, `CommitMeta.vue`, `FileTree.vue`, `AppToolbar.vue`, `RepoSettingsDialog.vue` | drop `host`/`hostConnectionState` options; `Capabilities` type and every `capabilities.*` read go (true branch kept); file tree indent becomes the constant `8px` |
| git-ui tests and `testing/fakeTransport.ts` | follow the removed fields; delete tests of deleted behaviour only (`ops.test.ts` prepare describe, capability-false cases) |
| `gitflow/graphstream_test.go`, `reviewflow/ranged_test.go` | set `kiraSpace.graph.pageSize` through `repoSettings.set` before the walk instead of a `pageSize` param (delta 2); assertions unchanged |
| `flowharness/harness_test.go` | Bound count 22; drop the `git.sock` exists/removed assertions |
| `flowharness/harness.go` | comment lines 2 and 82 only (no gitsock; the path-length note keeps hooks and askpass sockets) |
| `storage/migrations` | new `0031_p243_drop_git_clients.sql` (`DROP TABLE git_clients;`, the index drops with it) + `embed.go` entry `{Version: 31, ...}`. `0001_init.sql` never edited |
| `go.mod`/`go.sum` | `go mod tidy`: `golang.org/x/sys` likely becomes `// indirect` (gitsock was its only direct importer). `gopsutil`, `flatbuffers` stay (other importers) |
| `rpc.test.ts` | rewrite against a test-local peer (section 2.5) |
| Comments naming gitsock, git.sock, VS Code, the extension or "paired client" in kept code | reword or delete when stale: `internal/rpcstream/{frame,session}.go`, `internal/notify/ordered{,_test}.go`, `internal/startupfail/{alert,classify,exec,report,step}.go`, `internal/tokenauth/tokenauth.go`, `internal/pairing/pairing{,_test}.go`, `internal/kirapaths/paths.go`, `internal/toolexec/exec.go`, `internal/appstorage/appstorage.go:5`, Space `config/paths.go`, `gitaskpass/broker.go`, `gitcred/relay.go`, `gitreview/store.go`, `gitpreflight/{checkout,worktree}.go`, `gitclient/{discovery.go,porcelain/*,repo_test.go,watcher_test.go}`, `gitsession/{conn,entry,registry,queries}.go` and tests, `gitrpc/*`, `storage/model/{gitreposettings,settings}.go`, `packages/git-ipc/src/{contract,streamChannel,validate,transport}.ts`, `packages/git-core/src/util/nfcPath{,.test}.ts`, `packages/git-ui/src/{main.ts,theme/vscode-tokens.css:170 comment only}`, `packages/theme/src/{base.css,tailwind-core.css}` comments only, `packages/workbench/src/testing/ui/server.ts`, `GitCredentialDialog.vue`, `MemoryPane.vue`, `MobileAccessPane.vue`, `usePendingDecision.ts`, `packages/shared/domain/dbmcp.ts:45`. Final list = the section 8 grep |

Out of scope, untouched: `@vscode/codicons`, `seti-icons`, `vscode-tokens.css`, `vscode-bridge.css`,
`--vscode-*`/`--kv-*` tokens, `kv:` prefix, `readTokens.ts`, `tailwind-core.css` split (P245).
`internal/pairing`, `internal/tokenauth`, `gitcred`, `GitCredentialService`, `gitprepare`,
`guardRepoSettingsSet` and the Go `repoSettings.set` prepare-script refusal (native security
boundary). History docs (`docs/v1*`, `docs/v2.0`, `docs/v2.1`, earlier v2.2 plans and results),
Studio migrations `0016`/`0026`.

### 2.3 Data on users' machines

`git_clients` rows: dropped by `0031` (token hashes only). `git.sock`/`git.sock.lock`: removed at
startup (2.2). An installed extension stays in the user's VS Code; Space never touches it. No in-app
notice (D10); `apps/kira-space/README.md` gets one "Upgrading" line with `code --uninstall-extension
vladcirstean.kira-space-vscode`.

### 2.4 Coverage gate

`flows/coverage` checks every Wails-bound method plus every request parsed from
`gitrpc/handlers.go`. Removing `GitClientsService` and the prepare requests only shrinks both sets.
`exempt.txt` stays empty. Re-run Part 1's gap script (section 8) at the end: it must print nothing.

### 2.5 Tests (CLAUDE.md bar)

- New: `config/lock_test.go` `TestAcquireLock` (Part 1's `p` row: second acquire on a separate open
  file description refused, close, reacquire succeeds). Nothing else new.
- Moved: `vueComponentImports.test.ts` to `packages/git-ui/src/` (path depth fixed; still runs
  under `test:unit` via `packages/git-ui/src`).
- Rewritten: `rpc.test.ts` keeps client behaviour only, against a test-local peer that answers
  `req`/`open`/`credit`/`cancel` frames over an in-memory `MessageChannelLike`: request round trip
  and error code, event delivery, credit (client grants, peer never sends past it), cancel mid
  stream, concurrent streams, throwing `onChunk` rejects, `rawStreamChunks`, contract version
  mismatch. Dropped: server-side cases (`base64` channel, abort-listener count PERF8, raw chunk
  identity PERF5, server dispose). Keep the file under ~400 lines; merge near-duplicates.
- Updated in place: delta 2 tests, harness test, contract version test, git-ui tests.
- Deleted with their code: gitsock (136), editorflow, `bridge/gitclients_test.go`,
  `gitvsix/install_test.go`, allowlist tests, prepare tests, `socketChannel.test.ts`, `codec.test.ts`
  base64 block, extension unit and Playwright suites.
- No migration test (one `DROP TABLE`; `TestEveryEmbeddedFileIsRegistered` and storage open tests
  apply it). No test for the legacy socket cleanup (one obvious case).

## 3. Work, in commit order (each commit builds; hooks pass, no `--no-verify`)

1. `refactor(space): move the single-instance lock to config` — `config/lock.go`,
   `config/lock_test.go`, `main.go` import. gitsock still present.
2. `chore!: remove the VS Code extension and its packaging` — delete `apps/kira-space-vscode`,
   `scripts/{build,package}-vscode.ts`, `packages/git-ui/vite.config.ts`; `package.json`
   (workspace, three scripts, `typecheck:git` leg, `test:unit` path, two devDeps), `bun install`
   (commit `bun.lock`), `knip.json`, `biome.json`, `check-tokens.sh`, `verify-packaging.sh` S9/A6,
   both Taskfiles, `.gitignore`, `tools/mutation/areas.json`, `workbench/src/testing/ui/server.ts`
   comment; move `vueComponentImports.test.ts`. Footer `BREAKING CHANGE: the Kira Space VS Code
   extension is no longer built or bundled.` If the hook's knip pass already reports git-ipc or
   git-core exports orphaned here, pull those step 6 deletions forward into this commit; never
   bypass the hook.
3. `feat(space)!: drop the git.sock server, editor pairing and vsix install` — Go: gitsock,
   gitvsix, `bridge/gitclients*`, channels, appwire/wire wiring, Bound 22, editorflow,
   `harness{,_test}.go`, legacy socket cleanup in `main.go`, migration `0031` + `embed.go`, model
   and repo files, `rpcstream` and other Go comments in files already touched. Frontend: pairing
   dialog, Connected editors pane, store, bridge methods, `main.ts`, `App.vue`, settings section,
   `SettingsDialog.vue`, shared domain and channels, UI mocks, visual settings spec and its baseline
   PNG. Regenerate bindings (`sh scripts/setup.sh`; `frontend/bindings` is gitignored). Footer
   `BREAKING CHANGE: VS Code can no longer connect to Kira Space.`
4. `refactor(git-ui): drop host capabilities and VS Code host branches` — section 2.1 git-ui row,
   2.2 git-ui rows, Space mounts. The contract still declares the removed fields here; git-ui just
   stops reading them, so typecheck stays green.
5. `refactor(git)!: drop worktree prepare and the extension-only contract surface` — Go handlers,
   wire types, `RunPrepare` family, injected params, `gitstream.go` allowlist and its tests,
   contract version 46 (Go, TS, test); TS `contract.ts`, `validate.ts`, `hostHandlers.ts`; delta 2
   test updates; prepare test deletions. Footer `BREAKING CHANGE: git contract 46 removes
   worktree.prepare*, settings.changed, connection.changed and host capabilities.`
6. `refactor(git-ipc): drop the socket channel, rpc server and buffer encodings` — section 2.1
   git-ipc and git-core rows, `rpc.test.ts` rewrite, `codec.test.ts` base64 block, git-ipc
   `package.json` export.
7. `fix: drop exports orphaned by the extension removal` — run `bun run lint:dead` (knip), `go vet
   ./...`, `go mod tidy`; delete every newly reported export, file and dependency. Skip the commit
   if nothing is reported.
8. `chore: reword comments that named the removed extension` — every remaining section 8 grep hit
   in code files not yet touched.
9. `ci: pending workflow patches for the extension removal` — section 4.
10. `docs: drop the VS Code extension` — section 5.
11. Test run (section 7), fixes as follow-up `fix:` commits.
12. `docs(v2.2): P243 Part 2 result` — `plans/P243-part2-result.md`, SPEC row `Done`, the
    `P243 Part 2 result` section (plan and result paths, counts, release-patch warning).

## 4. Pending workflow patches (`docs/DEV_ENVIRONMENT.md` "Git push")

Never commit `.github/workflows/*` from this Linux sandbox. Create `docs/pending-changes/` and write
two `git diff`-style patches, each with a one-line "why" note on top:

- `docs/pending-changes/.github__workflows__release.yml.patch`: delete the G10 D21 comment and the
  `VSCODE_PKG` block (`release.yml:137-142`) from "Set both apps' version from the release tag".
  Why: the manifest is gone; `perl -i` on a missing file fails the release job.
- `docs/pending-changes/.github__workflows__pr.yml.patch`: step names at `pr.yml:198` and `:230`
  stop naming gitsock (`gitsession exercises ...`, `internal/gitsession runs t.Parallel() ...`).
  The steps stay (gitsession still needs both).

Prove each with `git apply --check docs/pending-changes/<file>` against the current tree. The result
section and the final report say the release workflow fails until the user applies the release
patch.

## 5. Docs

- `docs/ARCHITECTURE.md`: Stack table rows naming the extension; Storage high-water line (Space
  `0031`, name the drop); Process model (`git.sock` listener, lock); Git module intro, Transport,
  Session model, Go packages (drop gitsock/gitvsix, note `config.AcquireLock`), delete "The
  extension and its packages" (3187-) and fold any still-true fact into Transport; Git graph and
  Code review native sections (stop contrasting with the extension; `app.init` shape; contract 46;
  no allowlist, `guardRepoSettingsSet` stays); Testing (drop `test:webview`, the webview projects,
  gitsock suites); Renderer security surface line. Known open items: delete P178 VS Code host, P173
  VS Code host, P172 paired token, "native graph and the VS Code extension hold independent Conns",
  P202 "Space Git window refuses `worktree.prepare`" (move the fact "ADE runs the prepare script;
  the Git window never does" into the Git module section); reword the review-session expiry item
  (no extension comparison) and the `pr.yml` item (drop `build:vscode`/`test:webview`); add one
  item "release.yml still stamps the removed extension manifest until
  `docs/pending-changes/.github__workflows__release.yml.patch` is applied (P243 Part 2)".
- `docs/PACKAGING.md`: the `.vsix` chain, A6, S9, Install button, Connected editors history line
  stays as history only where it says "moved"; current-state text drops the `.vsix`.
- `docs/DEV_ENVIRONMENT.md`: lines 164-180 (gitsock, `git.sock`, "gitsock copy goes in P243
  Part 2"), 209-210 (webview suites).
- `docs/PERF.md`: G8 perf baseline and the `internal/gitsock` timing row keep their numbers as
  history with one line saying the suites now live in `flows/gitflow` (P243); the `build:vscode`
  method line says the build is gone.
- Root `README.md` (VS Code extension sentence, layout line 199); `apps/kira-space/README.md`
  (intro, Git graph bullet, socket paragraph, credential relay and multi-editor bullets,
  prerequisites, packaging, scripts table rows, app data, tests, layout, Marketplace line; add the
  "Upgrading" line).
- `CLAUDE.md`: no pointer goes stale (checked); untouched.

## 6. Ownership and overlap with P242 Part 4 (`/home/user/kira-sL`, branch `p242d-L`)

Fact at planning time: P242 Part 4 is merged into local `v2.0` (`c10610314`, `p242d-L` at the same
commit) and its SPEC row is `Done`. Only follow-up fix commits can still come from that worktree,
inside Part 4's own ownership list (`P242-part4-plan-iter2.md` §4). P243 Part 2 runs in its own
worktree off `v2.0` at `c10610314` or later (CLAUDE.md: the hook checks the whole tree).

| Area | P242 Part 4 (fixes only) | P243 Part 2 | Shared? |
|---|---|---|---|
| `internal/{scripts,scriptruns,runoutcome,linewriter,claudeheadless,flowtest/fakeclock}` | owns | none | no |
| `packages/workbench/src/automations/**`, `tabs/scriptRunTabKind.ts`, `testing/e2eReal.ts` | owns | none (`testing/ui/server.ts` comment only, a different file) | no |
| `packages/shared/domain/{scripts,scriptRuns,runOutcome}.ts` | owns | `git.ts`, `protocol/events.ts` | no |
| Space `flows/{termflow,adeflow,notifyflow}`, `storage/migrations/0030*` + its test | owns | `flows/{editorflow (delete),gitflow,reviewflow}`, `0031*` | no |
| Studio app (bridge, appwire, flowharness, flows, migrations, tests, mocks, baseline) | owns | none | no |
| Space `bridge/customscripts.go`, `agentnotify/agentnotify.go`, `workbench/{automationsModule.ts,WorkbenchShell.vue}` | owns | none | no |
| `apps/kira-space/internal/appwire/appwire.go` | scheduler wiring (Options, `sched`, Build, teardown `w.sched.Close()`) | GitClients field, Build block, `Bound()`, `GitSock()`, teardown socket lines | **yes** |
| `apps/kira-space/internal/appwire/wire.go` | none on Space | `gitWired.sock`, `wireGit` socket start | no (Part 4 touched Studio's `wire.go`, not Space's) |
| `apps/kira-space/internal/flowharness/harness.go` | options and `build()` | comment lines 2 and 82 | **yes** |
| `apps/kira-space/internal/storage/migrations/embed.go` | `Version: 30` line (landed) | appends `Version: 31` | **yes** |
| `apps/kira-space/frontend/src/bridge/index.ts` | `scriptRuns*` methods | GitClients import, types, methods | **yes** |
| `apps/kira-space/tests/ui/support/{bootSnapshots,ipcChannels,mockRuntime}.ts` | `scriptRuns*` entries | git client, pairing, vsix entries | **yes** |
| `go.mod`, `go.sum` | `gronx` (landed) | `go mod tidy` (`x/sys` to indirect) | **yes** |
| `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v2.2/SPEC.md` | high-water `0030`, Automations paragraph, open item, real-claude row, row + result | section 5, row + result | **yes** |
| root `package.json`, `bun.lock`, `knip.json`, `biome.json`, scripts, Taskfiles, `packages/{git-ipc,git-core,git-ui}`, `.gitignore`, `tools/` | none | owns | no |

Rules for the shared files, so the landing rebase stays trivial:

- Code files (`appwire.go`, `harness.go`, `bridge/index.ts`, the three mocks): P243 deletes only
  its own lines and never reflows, reorders or reformats neighbouring Part 4 lines. On a rebase
  conflict keep Part 4's lines as they are and drop only P243's.
- `embed.go`: P243 appends one line after the highest existing entry. If Part 4 ever adds a
  migration, P243 renumbers its file and entry to the next free number at rebase time.
- `go.mod`/`go.sum`: never hand-merge; after any rebase run `go mod tidy` and commit the result.
- Docs: P243 writes `ARCHITECTURE.md`, `DEV_ENVIRONMENT.md` and `SPEC.md` only in its last two
  commits (steps 10, 12), after rebasing onto the then-current `v2.0`. The high-water sentence is
  edited on top of Part 4's wording.

No ordering dependency: P243 Part 2 needs nothing from a Part 4 fix and a fix needs nothing from
P243. Landing order is free; a conflict outside the shared rows above means this table was wrong.
Concurrent streams: at most 2 (Part 4 fixes plus this). If Part 4 still has unlanded fix commits
when P243 starts, land those first by rebasing them; P243 then rebases once more before step 10.

## 7. Checks

Per commit: hooks (go build, golangci-lint, `bun run typecheck`, `bun run lint`, `bun run
lint:dead`). Fast checks cheap; the expensive suites run once, at step 11:

- `go build ./apps/kira-space/ ./apps/kira-studio/`, `go build -tags server` for both, `go vet ./...`.
- `go test ./apps/kira-space/internal/... ./internal/...` (incl. `config`, `bridge`, `appwire`,
  `gitrpc`, `gitsession`, `storage/...`, `flowharness`, `rpcstream`).
- `bun run test:flows:space` (gate green, `exempt.txt` empty) and the gap script below prints
  nothing:

  ```sh
  cd apps/kira-space/internal
  for n in $(grep -oE '^\s*"[a-zA-Z]+\.[a-zA-Z.]+"\s*:' gitrpc/handlers.go | tr -d ' \t":'; grep -oE 'case "[a-zA-Z.]+"' gitrpc/handlers.go | cut -d'"' -f2); do
    grep -rlq --include='*_test.go' "\"$n\"" flows || echo "$n"
  done
  ```
- `bun run test:unit` (git-ipc, git-core, git-ui incl. the moved guard).
- `bun run test:ui:space` (all; at least `repo-*`, `git-panel-tab`, `git-credential-relay`,
  `ade-v2-review*`, `mobile-access`, `repos-dialog`, Part 1's ported specs).
- `bun run test:visual:space` (only the Connected editors baseline removed; no other diff).
- `bun run test:e2e-real:space` git specs.
- `KIRA_GIT_FIXTURES=write go test -run TestFixtures_CaptureGraphChunkFrame
  ./apps/kira-space/internal/flows/gitflow/` then `git diff --exit-code packages/git-ipc/testdata/`
  (the frame body must not change: no wire change touches a graph chunk).
- `git apply --check` of both pending patches.

A failing check found on the way is fixed in this pass (CLAUDE.md), pre-existing or not.

## 8. Orchestrator verification checklist

- [ ] Gone: `test ! -e apps/kira-space-vscode && test ! -e apps/kira-space/internal/gitsock && test ! -e apps/kira-space/internal/gitvsix && test ! -e apps/kira-space/internal/flows/editorflow && test ! -e scripts/build-vscode.ts && test ! -e scripts/package-vscode.ts && test ! -e packages/git-ipc/src/socketChannel.ts && test ! -e packages/git-ui/vite.config.ts && test ! -e packages/git-core/src/ports`.
- [ ] Residue grep is empty except allowed hits:
      `git grep -n -i -E "vscode|vs code|vsix|gitvsix|gitsock|kira-space-vscode|git\.sock|Connected editors|GitClientsService|InstallVsCodeIntegration|createRpcServer|socketChannel|HostKind|runPrepareScript|resolveConflict|openWorktreeWindow|hostConnectionState|paired client|worktree\.prepare|cancelPrepare|worktree\.progress|connection\.changed|settings\.changed|bufferEncoding|base64" -- ':!docs/v1*' ':!docs/v2.0' ':!docs/v2.1' ':!docs/v2.2/plans' ':!docs/v2.2/SPEC.md' ':!docs/pending-changes' ':!apps/kira-studio/internal/storage/migrations' ':!apps/kira-space/internal/storage/migrations/0001_init.sql' ':!bun.lock'`.
      Allowed: P245 styling (`vscode-tokens.css`, `vscode-bridge.css` and its import, `--vscode-*`,
      `@vscode/codicons`, `codicon`), `knip.json` codicons ignore, the README "Upgrading" line, the
      legacy cleanup helper and its comment, `0031` SQL comment, ARCHITECTURE/PACKAGING/PERF
      history lines that say "removed in P243", base64 uses unrelated to git-ipc (terminal store,
      HTTP code, Studio). Every other hit is a miss.
- [ ] `jq -r '.workspaces[]' package.json | grep -c vscode` is 0; `jq -r '.scripts|keys[]' package.json | grep -E 'vscode|webview'` empty; `grep -n '"@types/vscode"\|"@vscode/vsce"' package.json` empty.
- [ ] `grep -n "ContractVersion = \|CONTRACT_VERSION = " apps/kira-space/internal/gitrpc/contract.go packages/git-ipc/src/validate.ts` both 46.
- [ ] Migration: `apps/kira-space/internal/storage/migrations/0031_p243_drop_git_clients.sql` holds `DROP TABLE git_clients`; `embed.go` has `Version: 31`; `git diff c10610314 -- apps/kira-space/internal/storage/migrations/0001_init.sql` empty.
- [ ] Lock moved: `git grep -n "func AcquireLock" apps/kira-space/internal/config/lock.go` hits; `git grep -n "config.AcquireLock" apps/kira-space/main.go` hits; `config/lock_test.go` exists.
- [ ] Legacy cleanup: `git grep -n "git.sock" apps/kira-space/main.go` shows only the removal helper.
- [ ] Bound: `git grep -n "got != 22" apps/kira-space/internal/flowharness/harness_test.go` hits; no `GitClients` in `appwire`.
- [ ] Allowlist gone, guard kept: `git grep -n "allowedMethods\|allowedStream" apps/kira-space/internal` empty; `git grep -n "guardRepoSettingsSet" apps/kira-space/internal/bridge/gitstream.go` hits.
- [ ] Injected params gone: `git grep -n "StrategySetting\|BaseCandidates \[\]string\|PageSize \*int" apps/kira-space/internal/gitrpc/wire.go` empty (stored `ReviewBaseCandidates`/`GraphPageSize` settings remain); `git grep -n '"pageSize"' apps/kira-space/internal/flows` empty.
- [ ] Kept packages still imported by non-test code: `for p in gitwire gitstore gitreview gitpreflight gitcred gitaskpass gitsearch gitprepare gitpath gitops gitsession gitrpc; do git grep -l "kira-space/internal/$p\"" -- '*.go' | grep -v _test | grep -v "internal/$p/" | head -1; done` prints 12 lines.
- [ ] git-ipc client survives: `git grep -n "createRpcClient\|createStreamChannel" apps/kira-space/frontend/src/repo/git/transport.ts` hits; `rpc.test.ts` has no `createRpcServer`.
- [ ] Guard moved: `test -e packages/git-ui/src/vueComponentImports.test.ts`.
- [ ] Pending patches: both files under `docs/pending-changes/`; `git apply --check` passes; `git diff c10610314 --stat -- .github` empty.
- [ ] Coverage: gap script prints nothing; `apps/kira-space/internal/flows/coverage/exempt.txt` empty; `bun run test:flows:space` green.
- [ ] Suites in section 7 green; visual diff limited to the deleted baseline.
- [ ] Commits normal (no `--no-verify`), Conventional, breaking ones carry `BREAKING CHANGE:`.
- [ ] Overlap: `git diff --name-only c10610314..HEAD` touches no Part 4-owned file outside the shared rows of section 6.
- [ ] Codegraph: this planner's run shows real `codegraph_explore` calls; the implementer executes a named plan (no call required, CLAUDE.md), except where step 7's knip/vet leftovers need tracing.

Mac handover (user): launch the packaged app; Settings has no Connected editors; after one launch
`~/.kira-space` holds no `git.sock`/`git.sock.lock`; `Contents/Resources` holds no `.vsix`; Git module
open, graph, detail, review, fetch/pull/push, stash, worktree add/remove work; `code
--uninstall-extension vladcirstean.kira-space-vscode` if installed; apply both pending patches, then
a release run passes its version step.

## 9. Left for P245 (recorded, not done)

Iter1 §7 holds, refreshed: `kv:` prefix and git-ui's own prefixed Tailwind root (`theme/tailwind.css`)
can now go, since no second document hosts git-ui; `vscode-tokens.css` (`--vscode-*` fallbacks into
`--kv-*`), `packages/theme/src/vscode-bridge.css` and its `base.css` import, `kira-structure.css`,
`density.css`, `readTokens.ts` (CommitGrid row metrics), `@vscode/codicons` (candidate for
`@lucide/vue`), `scripts/check-tokens.sh` git-ui `kv` leg, `check-theme-classes.sh` `kv` rules,
`settingsDomain.ts` font size via `--vscode-font-size`, VS Code-shaped layouts (`AppToolbar.vue`,
`CommitGrid.vue`, `DetailPane.vue`). New with this removal: `packages/theme/src/tailwind-core.css`
exists only because the webview root needed the core without the host rules; P245 may fold it back
into `base.css`. Nothing in Part 2 blocks P245.

## 10. Decisions (planner defaults; user may override)

- D1 Extension first in commit order (delta 3), so no commit typechecks against half-removed code.
- D2 Contract version stays the envelope and bumps 45 -> 46; removing it would change the wire for
  nothing.
- D3 Drop the stream allowlist and its tests; keep `guardRepoSettingsSet` and its two tests (the
  prepare-script and base-path field refusal is a native security boundary).
- D4 Drop injected params; Part 1 tests move to stored settings (delta 2).
- D5 Drop `createRpcServer`, base64 and transfer lists; keep client tests on a test-local peer.
- D6 Delete every git-core port and `HostKind` both copies; `gitBlockedCopy` always uses the
  Settings hint.
- D7 Delete the git-ui worktree prepare step, toolbar strip, `PrepareOutput.vue` and `OpsState`
  prepare state. The Git window never ran the script in Space; ADE runs it, the repos dialog edits
  it.
- D8 `workbench.tree.indent` goes; the file tree uses a constant `8px` (Space's current value).
- D9 `kiraSpace.*` repo setting keys keep their names (stored data; a rename is churn and P245 does
  not need it).
- D10 No in-app uninstall hint; README "Upgrading" line plus the Mac handover (iter1 O1 default).
- D11 Migration `0031` with no dedicated test; legacy socket cleanup with no test.
- D12 Move `vueComponentImports.test.ts` into git-ui; it guards git-ui, not the extension.
- D13 `golang.org/x/sys` goes wherever `go mod tidy` puts it; no manual pin.
- D14 Add one Known open item for the unapplied release patch; delete it when the patch is applied.
- D15 Concurrency with P242 Part 4 fixes allowed under section 6; landing order free.
