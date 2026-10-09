# P243 plan: drop the VS Code extension and git.sock

SPEC rows P243 Part 1 and P243 Part 2. User's words: "drop the VS Code extension, and the git server
it uses to connect, etc." A later phase (P245) restyles the git module; this phase does no restyling,
only records what blocks P245 (§7).

Base: `v2.0` after P242 Part 3 is implemented and committed (table order). Runs alone, never beside
another stream (§8).

Discovery: `codegraph_explore` over `ServeGitStream`, `GitClientsService`, `InstallVsCodeIntegration`,
`createRpcServer`, `createRpcClient`, `createStreamChannel`, `createSocketChannel`,
`VSCODE_WEBVIEW_BUFFER_ENCODING`, `HostKind`, git-core ports (`EditorIntegration`, `ProcessRunner`,
`FileWatcher`, `WorkspaceRoots`, `Windows`, `Theme`, `Storage`), `apps/kira-space-vscode/src/transport.ts`.
`apps/kira-space/internal/**` Go is not in the CodeGraph index (same gap P242's plan names), so the
Go side was read directly plus `git grep` for importers: `bridge/{gitstream,gitclients,events}.go`,
`appwire/{appwire,wire}.go`, `main.go`, `gitsock/{server,lock}.go`, `gitvsix/install.go`,
`gitsession/conn.go`, `gitrpc/{handlers,settings,contract,wire}.go`; frontend
`repo/git/{transport,hostHandlers,gitUiModule}.ts`; Stream A's P236 plan and its worktree
(read-only) for the coverage gate.

## 1. How the pieces connect today

- **Extension** `apps/kira-space-vscode` (77 tracked files): VS Code host + webview. Webview mounts
  `@kira/git-ui`; extension host proxies requests (`createRpcServer`) and dials
  `${KIRA_SPACE_HOME}/git.sock` (`createSocketChannel`, length-prefixed frames). Ships as
  `apps/kira-space/bin/kira-space.vsix`, copied into `Kira Space.app/Contents/Resources`.
- **git server** `internal/gitsock`: Unix socket listener, flock `git.sock.lock`, pairing handshake
  and token trust store (`git_clients` table), peer credentials. Each connection is a
  `gitsession.Conn` served by `gitrpc.Router.ForConn` over `internal/rpcstream`.
- **gitvsix**: finds the bundled `.vsix`, runs `code --install-extension` or reveals it in Finder.
- **Kira Space native path** (kept): `bridge.ServeGitStream` serves the same `gitrpc.Router` over the
  Wails `Stream('git')` through `rpcstream`; frontend `repo/git/transport.ts` uses `createRpcClient`
  + `createStreamChannel` and answers host methods in `hostHandlers.ts`. ADE board has its own
  in-process `gitsession.Conn`.

## 2. Delete / simplify / keep, with evidence

### 2.1 Delete (used only by the extension or git.sock)

| Item | Evidence |
|---|---|
| `apps/kira-space-vscode/**` (src, webview, tests/interaction, tests/layout, playwright config, resources, README, LICENSE, `.vscodeignore`) | the extension itself |
| `apps/kira-space/internal/gitsock/**` (≈10k lines, 120+ tests) | importers: `appwire`, `bridge/gitclients.go`, `main.go` (only `AcquireLock`, see 2.2) |
| `apps/kira-space/internal/gitvsix/**` | sole importer `bridge/gitclients.go` + `appwire` |
| `bridge/gitclients.go` + `_test.go` (`GitClientsService`: List, Revoke, PendingPairing, AttachPush, Approve, Deny, VsixStatus, InstallVsCodeIntegration) | every method is git.sock pairing or vsix; mobile pairing has its own `MobileAccessService` |
| `bridge/events.go` `ChannelGitPairing`, `ChannelGitClientsChanged` | emitted only by `GitClientsService.AttachPush` |
| `storage/model/gitclient.go`, `storage/repos/gitclients.go`, `Repos.GitClients` | trust store of paired editors, read only by gitsock and GitClientsService |
| `git_clients` table | new migration `DROP TABLE git_clients` (index drops with it); next free number at implementation time (0026 today) |
| `appwire`: `gitWired.sock`, `GitSock()`, `Wired.GitClients`, `detachGitPush`, `gitsock.New/Start/Close`, `gitvsix.New`, its `Bound()` entry (bound count drops by one) | only wiring for the above |
| `flows/editorflow/**` (incl. Stream A's `vsix_test.go`) | drives git.sock pairing and vsix only |
| Frontend: `workbench/GitPairingDialog.vue`, `workbench/settings/ConnectedEditorsPane.vue`, `state/gitClients.ts`, `bridge/index.ts` gitClients/gitPairing/gitVsix calls, `main.ts` hydrate, `App.vue` mount, `state/settings.ts` 'Connected editors' section, `SettingsDialog.vue` branch | callers of GitClientsService only. `PairingRequestDialog.vue` stays (MobilePairingDialog uses it) |
| `packages/shared/domain/git.ts` `gitClientSchema`, `gitPairing*`, `gitVsix*`; `packages/shared/protocol/events.ts` `gitPairing`, `gitClientsChanged` | consumers are the frontend files above. `gitCredentialPromptSchema` stays (ADE board credential relay) |
| `packages/git-ipc/src/socketChannel.ts` + test, `createRpcServer` (+ server half of `rpc.ts`), `VSCODE_WEBVIEW_BUFFER_ENCODING`, base64 buffer encoding path in `codec.ts` (`BufferEncoding` 'base64', `bytesToBase64` and inverse, `encodeBuffers`/`decodeBuffers` if only base64 needs them), `./socketChannel` export in `package.json` | `createRpcServer` callers: `webviewProviderBase.ts` only; `createSocketChannel` (node `Buffer`): `connection.ts` only; `streamChannel` declares `bufferEncoding: 'native'` |
| `packages/git-core/src/ports/*` except the ones still imported (today only `RepoCandidate` reaches git-ui, via git-ipc's own copy; check `EditorCapabilities`, `Clipboard`, `Theme`, `Windows`, `LogLevel` after deletion) and their `index.ts` exports | 0 importers outside the extension for `Browser`, `Disposable`, `EditorIntegration`, `VirtualDocumentSource`, `FileWatcher*`, `Logger`, `ProcessRunner`, `Spawn*`, `ProcessExit`, `Storage*`, `ThemeKind`, `OpenFolderOptions`, `WorkspaceRoots`, `coerceSettings`, `SettingDef`, `CoerceProblem` (grep, list in §9) |
| `packages/git-ui/vite.config.ts` and git-ui `devDependencies` it alone needs | header: "one Vite build producing the VS Code webview entry"; Space compiles git-ui through its own Vite. Delete only what knip then reports unused |
| Contract (TS `contract.ts` + Go `wire.go`/handlers) extension-only surface: `worktree.prepare`, `worktree.cancelPrepare`, `worktree.progress` event, `WorktreePrepare*` types, `editor.resolveConflict`, `worktree.openWindow`, `settings.changed` event, `connection.changed` event, `SettingsSnapshot` (`workbench.tree.indent` only), `app.init.settings`, `app.init.host`, `HostKind` (both copies), extension-injected optional params `graph.loadMore`/`graph.stream` `scope`/`pageSize`, review `baseCandidates`, pull `strategySetting` | `worktree.prepare*`: Go-served but refused by `gitstream.go` allowlist, so only git.sock reached it; `RunPrepare` has no other caller (ADE uses `gitprepare` directly). `editor.resolveConflict`/`worktree.openWindow`: Space answers with `refuseLocally`. `settings.changed`/`connection.changed`: no emitter in Space (`git grep` §9). Injected params: no git-ui or Space caller sends them (`git grep strategySetting\|baseCandidates:\|pageSize:` in git-ui/Space: 0 hits); Go falls back to stored repo settings |
| `gitsession.RunPrepare`, `WorktreePrepareDeps`, `WorktreePrepareResult`, prepare progress emit, `gitrpc` prepare handlers + `opslot` prepare branch | only `worktree.prepare` reaches them |
| git-ui extension-only UI: `capabilities` object of `app.init` (all flags), `resolveConflict` button ("Resolve in VS Code"), "Open in New Window" worktree action, `PrepareOutput.vue` + prepare run UI in `WorktreeDialog.vue`, read-only menu branches gated on `write === false` (`buildReadOnlyRefMenu`, `:write-capability`), `ConnectionBanner.vue` + `BridgeClient` connection-state machinery + `hostConnectionState` mount option, `SettingsState` + `settings.changed` listener, `NoRepositoryPanel`/`gitBlockedCopy` `host !== 'kira'` copy | Space's `hostHandlers.ts` hardcodes every capability: `openInEditor`, `goToFile`, `clipboard`, `editRepoSettings`, `write`, `openExternal` true; `resolveConflict`, `openWorktreeWindow`, `runPrepareScript` false. Each `true` gate becomes unconditional, each `false` branch is deleted. `ReviewCommitRow`'s `buildReadOnlyRowMenu` stays if it is a review-context menu, not a `write` gate (check its callers) |
| Space `hostHandlers.ts`: `editor.resolveConflict`, `worktree.openWindow` handlers, `capabilities`/`settings`/`host` composition in `app.init` | contract entries deleted above |
| `bridge/gitstream.go`: allowlist `allowedMethods`, `allowedStream`, `allowedRequest` and `gitstream_classification_coverage_test.go` | after `worktree.prepare*` go, the allowlist equals the router's whole method set; its only job was refusing what a paired client could call. Router dispatch table is the single list. `guardRepoSettingsSet` stays (see 2.2) |
| Scripts/config: `scripts/build-vscode.ts`, `scripts/package-vscode.ts`, root `build:vscode`, `package:vscode`, `test:webview`, `apps/kira-space-vscode` in `workspaces`, `test:unit` path, `typecheck:git` vscode leg, root devDeps `@types/vscode`, `@vscode/vsce`; `knip.json` workspace block and the two ignores; `biome.json` ignore line 310 and the `"vscode"` entry of the restricted-import group (keep `"vue"`); `scripts/check-tokens.sh` `VSCODE_WEBVIEW_SRC` leg; `scripts/verify-packaging.sh` S9 (ext/app version) and A6 (bundled .vsix); `apps/kira-space/build/Taskfile.yml` `build:vsix`; `build/darwin/Taskfile.yml` vsix deps and copies; `.gitignore` vsix/`.vscode-test` lines; `tools/mutation/areas.json` extension area; `packages/workbench/src/testing/ui/server.ts` extension mention | build/packaging chain of the `.vsix` only |
| `.github/workflows/release.yml` `VSCODE_PKG` block; `pr.yml` step names naming gitsock | **Cannot push** from a Linux session: write `docs/pending-changes/.github__workflows__release.yml.patch` and `.github__workflows__pr.yml.patch` (DEV_ENVIRONMENT "Git push" section). Release breaks without the release.yml patch (perl on a missing file), so the result section must flag it |
| Space UI test support: `ipcChannels.ts`, `mockRuntime.ts`, `bootSnapshots.ts` gitClients/gitPairing/gitVsix entries; `tests/visual/settings.spec.ts` 'Connected editors' section and its baseline PNG | mocks for deleted bindings |

### 2.2 Keep, simplify (shared by extension and Space)

| Item | Decision |
|---|---|
| `gitsock.AcquireLock` | move to `apps/kira-space/internal/config/lock.go` (`config.AcquireLock`); `main.go` single-instance guard keeps working on `app.lock` |
| `gitrpc`, `gitsession`, `gitstore`, `gitwire`, `gitreview`, `gitpreflight`, `gitops`, `gitsearch`, `gitclient`, `gitpath`, `gitaskpass`, `gitcred`, `gitprepare` | all imported by `gitrpc`/`gitsession`/`ade` (importer list in §9). Comment cleanup only where a comment names gitsock, VS Code or "paired client" |
| `gitsession.Conn.DisableAutoFetch`/`AcquireQuiet`/autofetch | keep: ADE board's Conn arms auto-fetch (`ade/board.go:152`, no `DisableAutoFetch`); native graph Conn still opts out. Reword comments that cite paired clients |
| `gitsession.Conn.RouteCredentials`, `gitcred.Relay`, `GitCredentialService`, `gitCredentialPromptSchema` | keep: ADE board routes credentials (`ade/board.go:153`) |
| `guardRepoSettingsSet` (prepare script and worktree base path fields) + Go `repoSettings.set` prepare-script refusal | keep: security boundary for the native webview, independent of VS Code (script is written only by Space settings, run by ADE) |
| `internal/rpcstream` (envelope, credit, `ContractVersion`), git-ipc `rpc.ts` client half, `validate.ts` (`CONTRACT_VERSION`, `wrapVersioned`, `assertContractShape`), `streamChannel.ts`, `blobFrame.ts`, `graphChunkCodec.ts`, generated `gitwire`, `scripts/generate-wire.sh`, `packages/git-ipc/schema/gitwire.fbs` | live on the native stream. **Contract version stays**: it is every frame's envelope on the native stream, `gitStreamMock.ts` and `flowharness/stream.go` assert it, and removing it is a wire-format change with nothing to gain. Bump `ContractVersion`/`CONTRACT_VERSION` 45 -> 46 in both places (contract shape changes), keep the equality test |
| `internal/pairing`, `internal/tokenauth` | keep: mobile web and ADE agent MCP import them |
| `@kira/git-ui` `mount()` (`main.ts`, `MountRoot.vue`, `index.ts`) | Space mounts it (`gitUiModule.ts`, `RepoGraphView.vue`, `RepoReviewView.vue`, `AdeReviewFiles.vue`); drop only the `host` and `hostConnectionState` options |
| `review.session.save/load`, `editor.openDiff/openAllChanges/openWorkingDiff/openRangeDiff/goToFile`, `review.open`, `graph.revealCommit`, `pr.openExternal`, `link.openExternal`, `clipboard.write`, `repo.list` | Space `hostHandlers.ts` answers each; keep |
| `@vscode/codicons`, `seti-icons`, `vscode-tokens.css`, `--kv-*` tokens, `kv:` prefix, `packages/theme/src/vscode-bridge.css`, `readTokens.ts` | styling; P245 owns it (§7). Do not touch |
| Docs history `docs/v1.*`, `docs/v2.0`, `docs/v2.1`, earlier v2.2 plans and results | history, untouched |

### 2.3 Keep as is (Space only)

`bridge/gitstream.go` (`ServeGitStream`), `repo/git/{transport,hostHandlers,gitUiModule,viewStateStore,reviewSession}.ts`, `packages/git-core` graph/model/search/store, `packages/git-ui` components not listed in 2.1.

## 3. Data on users' machines

- `git_clients` rows: dropped by the migration (2.1). Token hashes only; nothing to export.
- `${KIRA_SPACE_HOME}/git.sock`, `git.sock.lock`: nothing creates them any more. After
  `acquireSingleInstance` succeeds in `main.go`, best-effort `os.Remove` both (ignore not-exist, log
  any other error at Warn). Safe: the single-instance lock means no other Space owns this home. One
  helper, no test (one obvious case).
- Installed extension in the user's VS Code (installed only on the user's click via
  `code --install-extension`, extension id `vladcirstean.kira-space-vscode`; its token lives in
  VS Code SecretStorage): **never touched by Space.** Decision: no in-app notice. Space has no toast
  or notice system, and the extension already shows its own disconnected state harmlessly. Instead:
  `apps/kira-space/README.md` gets one "Upgrading" line with `code --uninstall-extension
  vladcirstean.kira-space-vscode`, and the Mac handover lists it. Open question O1 if the user
  wants an in-app hint.

## 4. Part 1: carry coverage off the extension and git.sock (extension still present, all green)

Nothing is deleted in Part 1. Product code untouched except test helpers.

1. **gitsock Go tests audit.** For each `Test*` in `gitsock/*_test.go` (≈120), classify in a table
   appended to this file (§10, one line per test): (a) transport-only (handshake, token, revoke,
   frame, peercred, pairing, lock, listener recovery) -> dies with gitsock; (b) handler semantics
   already proven by a named test in `flows/gitflow`, `flows/reviewflow`, `gitrpc/*_test.go` or
   `gitsession/*_test.go` -> name it; (c) uncovered -> port to the native stream through
   `flowharness.GitStream` in `flows/gitflow` (or `reviewflow` for review/comments). Likely (c):
   `graphstream_test.go` resume-from-cache, ranged resume, walks private per connection (two
   `OpenGitStream`), credit backpressure, `GraphLoadMoreHonorsRepoStoredPageSize`; `incremental_test.go`;
   parts of `matrix_test.go`/`recovery_test.go`. Commit the table first (resumability), then ports.
2. **Golden graph-chunk fixture.** Move `TestFixtures_CaptureGraphChunkFrame` (gated
   `KIRA_GIT_FIXTURES=write`) to `flows/gitflow`, capturing the frame body from the flowharness pipe;
   move the TS decode half from `socketChannel.test.ts` into `streamChannel.test.ts`. Proof: run the
   capture, `git diff --exit-code packages/git-ipc/testdata/` (body bytes are transport-agnostic;
   if not identical, regenerate and say why in the result).
3. **Perf tests.** Port `TestG8PerfBaseline` and `TestGraphStreamPerf` (opt-in `KIRA_GIT_PERF=1`) to
   `flows/gitflow/perf_test.go` over the native stream; update the command in
   `docs/DEV_ENVIRONMENT.md`.
4. **Webview interaction specs audit.** For each test in `apps/kira-space-vscode/tests/interaction`
   and `tests/layout` (62 tests, 14 files) classify in §10: extension-only behaviour (e.g.
   `graph-dialog-reconnect` = `connection.changed`; `editor.resolveConflict`; prepare) -> dies;
   covered by a named Space spec (`repo-workspace`, `repo-graph-*`, `ade-v2-review`, `git-panel-tab`)
   -> name it; uncovered -> port into `apps/kira-space/tests/ui` (`gitStreamMock.ts` fixtures), grouped
   by area, e.g. `repo-branch-picker.spec.ts`, `repo-commit-meta.spec.ts`,
   `repo-review-interaction.spec.ts`, `repo-graph-columns.spec.ts`. Spot check today: no Space spec
   covers the branch picker, commit-meta "Show more", review commit-list cap, review mark checkbox,
   `graph.revealCommit` from review, floating-geometry flips. Do not touch
   `repo-graph-paging.spec.ts`/`ade-v2-panel.spec.ts` beyond what a port needs.
5. Part 1 done when: §10 tables committed with zero unclassified rows; every (c) row names its new
   test; new Go tests pass under `test:flows:space`, new UI specs pass under `test:ui:space`; the
   extension, `test:webview` and gitsock tests still pass (nothing removed yet).

Commits (Part 1): `docs(v2.2): P243 coverage audit tables`; `test(space): native-stream graph
stream and incremental flows`; `test(space): graph chunk golden fixture over the native stream`;
`test(space): git stream perf over the native stream`; `test(space): git-ui interactions ported from
the webview suite` (split by area if large).

## 5. Part 2: removal

Order keeps every commit building (`go build`, typecheck) so hooks pass without `--no-verify`.

1. `refactor(space): move single-instance lock out of gitsock` — `config.AcquireLock`, `main.go`
   import.
2. `feat(space)!: drop git.sock server and VS Code pairing` — delete `gitsock`, `gitvsix`,
   `bridge/gitclients.go`, channels, `appwire` wiring (teardown keeps `registry.Close()` and
   askpass close), `flows/editorflow`, `flowharness` gitsock bits (`harness.go` comments,
   `harness_test.go` git.sock assertions), Stream A coverage `exempt.txt` lines naming
   `GitClientsService` (line 2 goes; lines 3-4 reworded to stand alone), any flow calling
   `app.W.GitClients` (`git grep`). Legacy socket-file cleanup (§3). Migration dropping
   `git_clients`, repo + model files. Frontend: pairing dialog, Connected editors pane, store,
   bridge calls, settings section, shared schemas/channels, regenerated Wails bindings
   (`scripts/setup.sh`), UI test mocks, visual settings spec section + baseline. `BREAKING CHANGE:`
   footer: VS Code extension no longer connects.
3. `refactor(git): drop worktree prepare and extension-only contract surface` — Go handlers,
   `RunPrepare` family, wire types; TS contract entries (§2.1 list); bump contract version to 46 in
   both; `gitstream.go` allowlist + classification test removal; Space `hostHandlers.ts`
   (`app.init` returns `{contractVersion, git, dateFormat}` shape only, refusals gone).
4. `refactor(git-ui): drop host capabilities and VS Code host branches` — capability gates,
   `HostKind`, `host`/`hostConnectionState` mount options, `ConnectionBanner`, `SettingsState`,
   prepare UI, resolve-in-VS-Code, open-in-new-window, read-only menus; update git-ui unit tests and
   `fakeTransport.ts`; Space mounts (`RepoGraphView.vue`, `RepoReviewView.vue`,
   `AdeReviewFiles.vue`) stop passing `host`/`hostConnectionState`. Inline `workbench.tree.indent`
   as the file tree's constant 8.
5. `refactor(git-ipc): drop socket channel, rpc server and base64 encoding` — plus git-core ports
   and settings-schema leftovers knip reports.
6. `chore: remove the VS Code extension` — delete `apps/kira-space-vscode`, scripts, package.json
   scripts/workspace/devDeps, `bun install` (bun.lock), knip, biome, check-tokens, verify-packaging,
   Taskfiles, `.gitignore`, mutation areas, `packages/git-ui/vite.config.ts`.
7. `ci: pending workflow patches for the extension removal` — the two `docs/pending-changes/*.patch`.
8. `docs: drop the VS Code extension` — `docs/ARCHITECTURE.md` (git server section around
   `GitServer (internal/gitsock)`, git.sock lines, Bound counts, contract version, Known open items,
   op-log `source` line), `docs/PACKAGING.md` (.vsix chain, A6/S9), `docs/DEV_ENVIRONMENT.md`
   (webview suite, gitsock perf command), `docs/PERF.md`, root `README.md` (layout line),
   `apps/kira-space/README.md` (+ Upgrading line §3), `CLAUDE.md` only if a pointer goes stale
   (today none). Fix every stale comment the §9 greps still list.
9. Fixes from the final test run as follow-up commits.

Dead code: after step 6 run `bun run lint:dead` (knip) and `go vet ./...`; delete every newly
reported export, file and dependency in the same pass (`fix: drop exports orphaned by the extension
removal`). `go mod tidy` and commit `go.mod`/`go.sum` if they change.

## 6. File ownership (Part 2)

Owns: `apps/kira-space-vscode/**`; `apps/kira-space/internal/{gitsock,gitvsix}/**`;
`apps/kira-space/internal/bridge/{gitclients,gitclients_test,events,gitstream,gitstream_test,gitstream_classification_coverage_test}.go`;
`apps/kira-space/internal/appwire/**`; `apps/kira-space/main.go`; `apps/kira-space/internal/config/**`;
`apps/kira-space/internal/gitrpc/**`, `gitsession/**` (prepare removal and comments),
`gitreview/store.go`, `gitaskpass/broker.go`, `gitcred/relay.go`, `gitpreflight/checkout.go`
(comments); `apps/kira-space/internal/storage/{migrations,model,repos}/**` (git_clients);
`apps/kira-space/internal/flows/editorflow/**`, `flows/coverage/exempt.txt`, any flow file calling
`GitClients`; `apps/kira-space/internal/flowharness/{harness,harness_test}.go`;
`apps/kira-space/frontend/src/{App.vue,main.ts,bridge/index.ts,state/gitClients.ts,state/settings.ts}`,
`workbench/{GitPairingDialog,SettingsDialog}.vue`, `workbench/settings/ConnectedEditorsPane.vue`,
`repo/git/{transport,hostHandlers}.ts`, `repo/RepoReviewView.vue`, `views/repo/RepoGraphView.vue`,
`ade/v2/review/AdeReviewFiles.vue`; `apps/kira-space/frontend/bindings/**` (regenerated);
`apps/kira-space/tests/{ui/support,visual}/**`; `packages/{git-ipc,git-core,git-ui}/**` (not
`theme/**`, not `kv:` classes); `packages/shared/{domain/git.ts,protocol/events.ts}`;
`packages/workbench/src/testing/ui/server.ts`; root `package.json`, `bun.lock`, `knip.json`,
`biome.json`, `.gitignore`, `go.mod`, `go.sum`; `scripts/{build-vscode,package-vscode}.ts`,
`scripts/{check-tokens,verify-packaging}.sh`; `apps/kira-space/build/**`; `tools/mutation/areas.json`;
`docs/pending-changes/**`; living docs listed in §5 step 8.

Part 1 adds: `apps/kira-space/internal/flows/{gitflow,reviewflow}/**`,
`packages/git-ipc/src/streamChannel.test.ts`, `packages/git-ipc/testdata/**`, new
`apps/kira-space/tests/ui/*.spec.ts`, `apps/kira-space/tests/ui/support/gitStreamMock.ts` (only if a
port needs a fixture), `docs/DEV_ENVIRONMENT.md`.

## 7. Leftovers for P245 (git module visual alignment)

Recorded here, not done here:

- `kv:` Tailwind prefix: 776 `kv:` utility uses across 25 files in `packages/git-ui/src`. Exists
  because git-ui compiled its own prefixed root (`theme/tailwind.css`, `@import ... prefix(kv)`,
  `@theme inline reference` with namespace resets) to avoid colliding with Space's root in one
  document. With the webview gone, git-ui can drop the prefix and be scanned by Space's own Tailwind
  root (`@source` the package), using default theme values.
- Token indirection: `packages/git-ui/src/theme/vscode-tokens.css` (304 lines, 81 `var(--vscode-*)`
  fallbacks feeding `--kv-*`), `packages/theme/src/vscode-bridge.css` (maps `--kira-*` onto
  `--vscode-*`), `packages/theme/src/base.css` import of it, `theme/kira-structure.css` (105),
  `theme/density.css` (29), 138 `var(--kv-*)` uses. P245 replaces these with the app's own
  Tailwind/shadcn tokens.
- `theme/readTokens.ts` (`TokenReader`, used by `CommitGrid.vue` for row height/font from CSS vars):
  re-point at the app tokens.
- `@vscode/codicons` icon font (`icons/codicon.css`, `ACTION_ICONS`): candidate for `@lucide/vue`
  like the rest of the app. `seti-icons` file icons stay unless P245 decides otherwise.
- `scripts/check-tokens.sh` git-ui leg and `scripts/check-theme-classes.sh` rules tied to `kv`.
- `apps/kira-space/frontend/src/state/settingsDomain.ts:42` font size routed through
  `--vscode-font-size`.
- Components whose layout mimics VS Code panels (`AppToolbar.vue`, `CommitGrid.vue` SlickGrid
  styling, `DetailPane.vue`).

## 8. Ordering vs Stream A and other phases

Overlap with Stream A (P236, `/home/user/kira-sA`) is real: A owns `apps/kira-space/internal/flows/**`
(incl. `editorflow/vsix_test.go` and `flows/coverage/{coverage_test.go,exempt.txt}`, whose
`exempt.txt` names `GitClientsService.AttachPush`), `flowharness/**`, `packages/git-ui/**`, and the
gate reads the router's request names (`worktree.prepare*` disappear). P243 must not start until
Stream A has landed on `v2.0`. It also follows P240-P242 by table order (P240/P241 wait for A
themselves). So: no concurrency; P243 runs alone after P242 Part 3. Part 1 before Part 2,
sequentially, one implementer each.

## 9. Verification checklist (orchestrator)

Part 1:

- `git diff --stat <part1-base>..HEAD` touches only Part 1 files (§6); nothing deleted.
- §10 tables: `grep -c '| ? |' docs/v2.2/plans/P243-plan.md` is 0 (no unclassified row); each (c)
  row's named test exists (`git grep -n "func <Name>"` / spec title grep).
- `go test ./apps/kira-space/internal/flows/gitflow/ ./apps/kira-space/internal/flows/reviewflow/`
  green; `bun run test:ui:space` green; `bun run test:webview` still green.
- `KIRA_GIT_FIXTURES=write go test -run TestFixtures_CaptureGraphChunkFrame ./apps/kira-space/internal/flows/gitflow/`
  then `git diff --exit-code packages/git-ipc/testdata/`; `bun test packages/git-ipc/src/streamChannel.test.ts`.

Part 2 (real greps, must be empty unless noted):

- `git grep -n -i -E "vscode|vs code|vsix|gitvsix|gitsock|kira-space-vscode|git\.sock|Connected editors|GitClientsService|InstallVsCodeIntegration|createRpcServer|socketChannel|HostKind|runPrepareScript|resolveConflict|openWorktreeWindow|paired client" -- ':!docs/v1*' ':!docs/v2.0' ':!docs/v2.1' ':!docs/v2.2/plans' ':!docs/v2.2/SPEC.md' ':!docs/pending-changes'`
  -> allowed hits only: P245 styling leftovers (`vscode-tokens.css`, `vscode-bridge.css`,
  `base.css` import, `--vscode-*` vars, `@vscode/codicons`, `codicon`), README "Upgrading" line,
  the legacy-socket cleanup helper naming `git.sock`, and `knip.json` codicons ignore. Every other
  hit is a miss. ("webview" is left out: Wails' own native webview is a legit term.)
- `test ! -e apps/kira-space-vscode && test ! -e apps/kira-space/internal/gitsock && test ! -e apps/kira-space/internal/gitvsix && test ! -e scripts/build-vscode.ts`.
- `git grep -n "worktree.prepare\|worktree.cancelPrepare\|worktree.progress\|connection.changed\|settings.changed"` -> no hits outside history docs.
- Importer check for every kept git package still has a non-test importer:
  `for p in gitwire gitstore gitreview gitpreflight gitcred gitaskpass gitsearch gitprepare gitpath gitops; do git grep -l "kira-space/internal/$p\"" -- '*.go' | grep -v _test | grep -v "internal/$p/" | head -1; done` prints 10 lines.
- Contract version: `grep -n "ContractVersion = \|CONTRACT_VERSION = " apps/kira-space/internal/gitrpc/contract.go packages/git-ipc/src/validate.ts` both 46.
- Migration: new file drops `git_clients`; `go test ./apps/kira-space/internal/storage/...` green.
- `jq -r '.workspaces[]' package.json | grep -c vscode` is 0; `jq -r '.scripts | keys[]' package.json | grep -E "vscode|webview"` empty; `grep -n "vscode\|vsce" package.json` empty.
- `bun run lint`, `bun run lint:dead` (knip clean), `bun run lint:go` (golangci-lint), `bun run typecheck`.
- `go build ./apps/kira-space/ ./apps/kira-studio/` and `go build -tags server ./apps/kira-space/ ./apps/kira-studio/`; `go vet ./...`.
- `go test ./apps/kira-space/internal/...` (incl. `bridge`, `appwire`, `gitrpc`, `gitsession`,
  `config`), `bun run test:flows:space` (coverage gate green, no stale exempt line), `bun run test:unit`.
- Space git UI regressions (must stay green): `bun run test:ui:space` (all, at least
  `repo-workspace`, `repo-graph-{failures,lifecycle,lines,paging,pr-badge,rewalk}`, `git-panel-tab`,
  `git-credential-relay`, `ade-v2-review`, Part 1's new specs); `bun run test:visual:space` (settings
  baseline updated for the removed section only); `bun run test:e2e-real:space` git specs.
- `ls docs/pending-changes/` holds `.github__workflows__release.yml.patch` and
  `.github__workflows__pr.yml.patch`; `git apply --check` of each against current `.github/workflows`
  succeeds.
- Hooks: no commit used `--no-verify` (`git log` shows the hook-run commits normal).

Mac handover (user):

- Launch the packaged Kira Space: no `Connected editors` section in Settings; `ls ~/.kira-space`
  shows no `git.sock`/`git.sock.lock` after one launch; `Contents/Resources` holds no `.vsix`.
- Git module: open a repo, graph, detail, review, fetch/pull/push, stash, worktree add/remove work.
- `code --uninstall-extension vladcirstean.kira-space-vscode` if the extension was installed.
- Apply the two `docs/pending-changes` patches; next release run passes the version step.

## 10. Coverage audit tables (filled by the Part 1 implementer)

Columns: test | file | class (a transport-only / b covered / c ported) | covering or new test.
Use `?` in the class column only while unfinished; Part 1 is not done while one remains.

### 10.1 gitsock Go tests

(empty)

### 10.2 webview interaction and layout specs

(empty)

## 11. Risks

- Coverage loss from deleting ≈120 gitsock tests and 62 webview tests: Part 1 exists to prevent it.
- Wire shape changes (contract bump, removed params/events) break nothing external once the
  extension is gone; Space ships both ends in one binary.
- Release workflow fails until the user applies the pending release.yml patch.
- `kv:`-prefixed git-ui keeps working unchanged; any accidental restyle is out of scope (P245).

## 12. Open questions

- O1: in-app hint to uninstall the old extension (default: none, README + handover only).
- O2: if the §10.2 port grows beyond ~25 new UI tests, keep all or trim to one test per behaviour
  (default: one per distinct behaviour, merge near-duplicates, per CLAUDE.md's test bar).
