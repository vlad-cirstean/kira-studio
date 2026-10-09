# P231 plan: real-flow IPC tests for Kira Space

Spec row (`docs/v2.2/SPEC.md`): real-flow tests for every main flow of Kira Space, split at the IPC
(bridge) level. Go side drives the bound services against real `git` and real temporary repos, no
mocked git, default settings. TS side drives the frontend against the real bridge. All modules. Two
parallel streams (A, B), disjoint file ownership. Then fix every issue the tests find.

User request, verbatim: "Cover all the main flows in the kira space app with real tests split at ipc
level. The tests should actually use real git and git repos. This includes all modules of the app.
Create the tests in parallel on 2 streams and of course then fix any issues you find".

Why: P225 (graph commits vanish, Show more broken) and P230 (ADE Refresh `exec: no command` with the
default empty `git.gitPath`) both shipped green. The UI tier mocks both wire planes
(`tests/ui/support/mockRuntime.ts`, `gitStreamMock.ts`). The Go tiers wire pieces by hand: every ADE
harness set `GitPath` to `"git"` (P230 C1), and `TestTaskBoard_RefreshWithDefaultGitPathSetting`
still injects `GitStatus` directly instead of resolving it through `gitclient.Discovery`. Nothing
drives the services the way `main.go` wires them.

Base: `53112022d` (branch `v2.0`). Discovery done with `codegraph_explore` (5 calls) for indexed code
(`internal/rpcstream`, `internal/localsock`, `internal/agenthooks`, `apps/kira-studio/internal/ipcfixture`,
adapter test seams, `packages/git-ipc/src/rpc.ts`). The index lacks `apps/kira-space`; those files were
read directly: `main.go`, `internal/bridge/*.go`, `internal/gitclient/discovery.go`,
`internal/bridge/gitstream.go`, `internal/appshell/stream.go`, `internal/gitsock/integration_test.go`,
`internal/ade/runengine_test.go`, `internal/ade/board_refresh_test.go`, `internal/bridge/mobile.go`,
`internal/mobileweb/lan.go`, `frontend/src/bridge/index.ts`, `frontend/src/workbench/modes.ts`,
`playwright.config.ts`; plus `apps/kira-studio/tests/e2e-real/fixtures.ts` and
`internal/windowsvc`.

---

## 1. Inventory

### 1.1 IPC surfaces

Kira Space has four IPC surfaces. All four get real-flow coverage.

1. **Bound services**: 20 `application.NewService` registrations in `main.go:316-339`, ~150 exported
   methods (counted from `internal/bridge/*.go`, plus embedded `terminal.BoundService` and
   `windowsvc.Service`).
2. **Git stream**: `appshell.RegisterGitStream` serves `bridge.ServeGitStream(router, conn)` over a
   Wails stream. rpcstream frames (`internal/rpcstream/frame.go`), allowlist of 54 request methods plus
   `graph.stream` (`bridge/gitstream.go` `allowedMethods`). Graph chunks are flatbuffers blobs
   (`internal/gitwire`).
3. **Push events**: `appevent.Emitter` `Emit`/`EmitTo`/`EmitFocused`. Channels in
   `bridge/events.go`, `bridge/memory.go`, ADE/terminal/agent channels.
4. **External sockets**: `gitsock` unix socket (VS Code extension pairing + same router),
   `mobileweb` HTTP/SSE/WebSocket server (phone, `/api/...` routes in `mobileweb/routes.go`),
   `agenthooks` unix socket (Claude Code hooks), `gitaskpass` socket (credential relay).

### 1.2 Modules and main flows

Verified against `main.go` service list, `frontend/src/workbench/modes.ts` (`git`, `ade`, `terminal`,
`memory`), `frontend/src/workbench/*` (settings panes, dialogs, status bar), `frontend/mobile/`.
10 modules, 64 flows. "Calls" names the IPC methods each flow crosses.

**M1 Git (git stream; frontend `repo/`, `packages/git-ui`)** — 20 flows

| # | Flow | Calls |
|---|---|---|
| G1 | Open repo with default settings | `app.init`, `repo.open`, `repo.close` |
| G2 | Graph first page, decorations, lanes data | `graph.status`, `graph.stream` (credit) |
| G3 | Graph paging to the end (Show more) | `graph.loadMore`, `graph.stream` |
| G4 | External change refreshes graph | `repo.changed` evt, `graph.refresh` |
| G5 | Commit detail and file diff | `commit.detail`, `commit.fileDiff`, `file.read`, `file.goToTarget` |
| G6 | Working tree and status | `working.detail`, `status.get` |
| G7 | Inline blame | `blame.line` |
| G8 | Checkout (dirty tree, autostash) | `refs.list`, `preflight.checkout`, `op.run` |
| G9 | Stash list, show, pop, branch | `stash.list`, `stash.show`, `globalStash.list`, `preflight.stashPop`, `preflight.stashBranch`, `op.run` |
| G10 | Worktree add and remove | `worktree.list`, `preflight.worktreeAdd/Remove`, `op.run` |
| G11 | Fetch, pull (ff-only/merge/rebase), push, force push, delete remote branch | `remote.pullPreflight`, `remote.pushPreflight`, `remote.run`, `remote.cancel` |
| G12 | Conflict and sequencer (cherry-pick, revert, continue/skip/abort) | `preflight.cherryPick`, `preflight.revert`, `op.run` |
| G13 | Reset | `preflight.reset`, `op.run` |
| G14 | Undo | `undo.peek`, `undo.run` |
| G15 | Stacked branches restack | `stack.list`, `preflight.restack`, `stack.restack`, `stack.cancelRestack` |
| G16 | Search history | `search.run` |
| G17 | Per-repo settings | `repoSettings.get`, `repoSettings.set` (restricted fields refused) |
| G18 | Code review: base, files, marks, comments, export | `review.*` (11 methods) |
| G19 | PR lookup with no GitHub remote | `commit.resolvePr`, `branch.resolvePr`, `pr.browserUrl` |
| G20 | Credential prompt during remote op | `credential.request` evt, `credential.provide`, `GitCredentialService.Pending/Provide` |

**M2 Repositories (`CodeWorkspaceService`, `FilesService`; `ReposDialog.vue`, file tree, search)** — 6 flows

| # | Flow | Calls |
|---|---|---|
| R1 | Import repo via folder picker | `FilesService.ChooseFolder`, `ImportRepo`, `ListRepos` |
| R2 | Rename, colour, reorder, remove | `RenameRepo`, `SetRepoColor`, `ReorderRepos`, `RemoveRepo` (+ ADE repos-changed) |
| R3 | Browse files, read file, read diff | `OpenWorkspace`, `ListFiles`, `ReadFile`, `ReadDiff`, `CloseWorkspace` |
| R4 | Code search | `StartSearch`, search events, `CancelSearch` |
| R5 | Heads and worktree links across repos | `RepoHeads`, `RepoWorktreeLinks` |
| R6 | Import edge cases: non-repo, duplicate, linked worktree, bare | `ImportRepo` |

**M3 Connected editors (`GitClientsService`, `gitsock`; `ConnectedEditorsPane.vue`, `GitPairingDialog.vue`)** — 3 flows

| # | Flow | Calls |
|---|---|---|
| E1 | VS Code client pairs and reads a repo | socket hello, `kira:git:pairing` evt, `PendingPairing`, `Approve`, `repo.open`/`graph.stream` over socket |
| E2 | Deny, revoke, re-pair, token reuse across restart | `Deny`, `Revoke`, `List`, `kira:git:clients` evt |
| E3 | Socket refuses Space-only writes | `repoSettings.set`, `worktree.prepare` over socket |

**M4 Agents / ADE (`AdeTaskService`; `ade/v2/*`)** — 12 flows

| # | Flow | Calls |
|---|---|---|
| D1 | Folder import and repo facts with default settings | `AddFolder`, `SetFolderWatch`, `RemoveFolder`, `Repos`, `UpdateRepo`, `Board` |
| D2 | Refresh: remote, no remote, bad remote, linked-worktree root | `Refresh` |
| D3 | Task with branches (new branch creates worktree, existing branch) | `CreateTask`, `UpdateTask`, `AddTaskRepo`, `AddExistingBranch`, `CandidateBranches` |
| D4 | Backlog | `AddBacklogItem`, `UpdateBacklogItem`, `MoveBacklogItem`, `DeleteBacklogItem`, `PromoteBacklogItem`, `Backlog` |
| D5 | Workflows | `Workflows`, `NewWorkflow`, `WorkflowYaml`, `ValidateWorkflowYaml`, `SaveWorkflow`, `SaveWorkflowYaml`, `ImportWorkflow`, `SetTaskWorkflow` |
| D6 | Headless run lifecycle | `StartRun`, `Approve`, `RetryRun`, `StopRun`, `StageDone`, `SetTaskStage`, `RetrySetup`, `ReadLog`, runs/log evts |
| D7 | Agent commits reach board; force push; record merge | `Board`, `ForcePush`, `RecordMerge` |
| D8 | Queue and plan with merge-tree checks | `SetPlan`, `SetQueuedAfter` |
| D9 | Interactive sessions in a real PTY | `LaunchStage`, `StartBranch`, `TakeOver`, `Send`, `Sessions`, `FocusSession` |
| D10 | Archive with risk check | `ArchiveRisk`, `ArchiveTask` |
| D11 | Review window and review agent | `OpenReviewWindow`, `ReviewWindowTarget`, `ReviewAgent`, `LaunchReviewAgent` |
| D12 | GitHub PRs and sync | `Prs`, `GitHubSyncPlan`, `GitHubSyncApply` |

**M5 Memory (`MemoryService`, `MemoryImportService`; `workbench/memory`, `MemoryPane.vue`)** — 6 flows

| # | Flow | Calls |
|---|---|---|
| Y1 | Add memory through the gate, then find it | `Store`, `Recent`, `Search`, `History`, `kira:memory:changed` |
| Y2 | Gate rejects or fails | `Store` |
| Y3 | Semantic status without the runtime library | `SemanticStatus`, `RetrySemantic`, `Search` (keyword fallback) |
| Y4 | Connect Claude Code (MCP) | `McpStatus`, `InstallClaudeCode` |
| Y5 | Bulk import lifecycle | `Choose`, `Create`, `Start`, `Jobs`, `Job`, `Pause`, `Resume`, `Cancel`, `Discard`, `Dismiss`, `kira:memory:import` |
| Y6 | Import retries | `RetryFailed`, `RetryFile` |

**M6 Terminal and quick commands (`TerminalService`, `CustomScriptsService`; `workbench/terminal`)** — 3 flows

| # | Flow | Calls |
|---|---|---|
| T1 | Shell tab in a repo runs git | `DefaultCwd`, `Open`, `Write`, `Resize`, `Close`, output/exit `EmitTo` |
| T2 | Collections: move script, delete collection with scripts | `CreateCollection`, `Create`, `Update`, `Move`, `RenameCollection`, `DeleteCollection`, `Remove`, `List`, changed evt |
| T3 | Agent tab counts as a live agent session | `Open` (claude-code), `AgentSessions`, keep-awake agent reason |

**M7 Settings, layout, windows, lifecycle (`SettingsService`, `LayoutService`, `TabsService`, `WindowsService`, `LifecycleService`, `KeepAwakeService`)** — 5 flows

| # | Flow | Calls |
|---|---|---|
| S1 | Git path setting drives discovery everywhere | `SettingsService.Set` then `app.init`, `ImportRepo`, ADE `Refresh` |
| S2 | Window-scoped tabs and mode | `WindowsService.Ensure`, `SetMode`, `TabsService.Save/List`, `LayoutService.Set/GetAll` |
| S3 | Quit and window-close flush handshake | `LifecycleService.Flushed`, `WindowFlushed` |
| S4 | Keep awake manual and agent reason | `KeepAwakeService.SetManual`, `Status`, settings `claudeCode.keepAwakeWithAgents` |
| S5 | Date format setting reaches git payloads | `SettingsService.Set` `appearance.dateFormat`, `commit.detail` |

**M8 Operations log (`OpsService`; `OperationsPanel.vue`)** — 2 flows

| # | Flow | Calls |
|---|---|---|
| O1 | Git ops and graph failures land in the log | `remote.run`/`op.run`/`graph.reportFailure` then `OpsService.Recent` |
| O2 | Cancel a running remote op | `OpsService.Cancel` |

**M9 Mobile web (`MobileAccessService`, `mobileweb`; `MobileAccessPane.vue`, `MobilePairingDialog.vue`, `frontend/mobile`)** — 6 flows

| # | Flow | Calls |
|---|---|---|
| B1 | Enable, trust network, port | `SetEnabled`, `TrustCurrentNetwork`, `ForgetNetwork`, `SetPort`, `Status`, `kira:mobile:status` |
| B2 | Phone pairing approve/deny/revoke | `POST /api/pair`, `PendingPairing`, `Approve`, `Deny`, `Devices`, `Revoke`, `/api/me` |
| B3 | Phone reads ADE state built on real repos | `/api/ade/board`, `/backlog`, `/repos`, `/workflows`, `/sessions`, `/log`, `/prs` |
| B4 | Phone writes with permissions and idempotency | `SetDevicePermissions`, `/api/ade/backlog/items`, `/backlog/move`, `/tasks/stage`, `/tasks/run`, `/tasks/launch`, `LaunchOpened` |
| B5 | Phone event stream | `/api/events` (SSE) |
| B6 | Phone agent input and terminal attach | `SetAgentInputEnabled`, `/api/agent/sessions/{id}/send`, `/terminal` (WebSocket), `TerminalHolds`, `ReclaimTerminal`, `kira:mobile:terminals` |

**M10 Shell links and updates (`LinkService`, `GitHubService`, `UpdateService`)** — 1 flow covered, 1 excluded

| # | Flow | Calls |
|---|---|---|
| L1 | External link and PR URL open, unsafe scheme refused | `LinkService.OpenExternal`, `GitHubService.OpenPullRequestURL` |
| — | Update check/install | **Excluded.** `appupdate` hardcodes `api.github.com` and `raw.githubusercontent.com` URLs (`checker.go:33`, `install.go:26`) with no endpoint seam; a flow test would hit the network and install over the running app. Existing `internal/appupdate` tests stay the coverage. Deferred decision DD2. |

Not flows (no test): status-bar metrics ticker, `GitClientsService.VsixStatus`/`InstallVsCodeIntegration`
(needs a `code` CLI and VS Code), `MemoryService.InstallSemanticModel` (35 MB network download; real
model already has `-tags embedsmoke`).

---

## 2. Harness decision

### 2.1 Go side: wire services through one shared composition function

**Decision: refactor `main.go`'s service construction into `apps/kira-space/internal/appwire`, called by
both `main.go` and the test harness.** Rejected: a harness that copies the wiring (Kira Studio's
`ipcfixture.NewApp` shape). P230 C1 was exactly a wiring bug (`TaskBoardDeps` built from the raw
setting); a copied wiring drifts from `main.go` and re-opens that bug class. One function means a test
cannot wire differently from production.

`appwire` scope (moved verbatim from `main.go`, behaviour unchanged):

- `wireGit`, `wireTracker`, `wireAdeTask`, `wireTermBroker`, `agentSessionCount`, `adeGitPathSetting`,
  `adeAutofetchMinutes`, `adeCloseTerminal`, `shutdownTracker`, `closeTaskReviewWindows`,
  `removeRetiredModels`, `runArgvShim` (exported `RunArgvShim`, used by `main` and harness).
- Construction of all 20 bound services, the mobile hub tap, `bridge.Events`, op-log/metrics/push
  attachments, `KeepAwakeRecompute` wiring, `terminalRegistry.OnChange`.
- Teardown (`main.go:259-310`) as `Wired.BeforeFlush()` and `Wired.Teardown()`.

`appwire.Options` carries only the OS seams `main` owns today:

| Option | Production (`main.go`) | Harness |
|---|---|---|
| `Repos`, `DB` | `storage.Open()`, `repos.New` | same, temp `KIRA_SPACE_HOME` |
| `Emitter` | `shell.NewDeferredEmitter()` | recording emitter |
| `Browser` | `shell.NewDeferredBrowser()` | recorder |
| `Dialogs` (`bridge.Dialogs`) | `appshell.NewDialogs(rawDialogs)` | scripted answers queue |
| `Locator` (`gitclient.Locator`) | `platformLocator()` (below) | `gitclient.NewDarwinLocator()` |
| `KeepAwakeDriver` | `keepawake.NewPlatformDriver()` | recorder (never holds a real assertion on a Mac) |
| `MobileIsLAN`, `MobileDetect`, `MobileFind` | nil (lannet defaults) | loopback network, `IsLoopback` |
| `MobileAssets` | embedded `dist-mobile` | empty `fstest.MapFS` |

The `Locator` row is the only git-path seam. `NewDarwinLocator` is the production locator on macOS and
its probe order (configured path, `exec.LookPath("git")`, Homebrew, CLT shim gated on `xcode-select`)
also finds `/usr/bin/git` on Linux. So the harness resolves the default empty `git.gitPath` through
the real `Discovery` and the real locator code. No `GitPath: "git"`, no injected `GitStatus`.

Window-shell cycle: `LifecycleService` and `UpdateService` need the quitter; the quitter needs
`Teardown`. Resolve with a second step: `appwire.Build(opts) *Wired` builds everything, then
`w.BindShell(appwire.ShellHooks{Flusher, WindowFlusher, Quit, OpenWindow, CloseWindow, FocusWindow,
SetWindowTitle, OpenNewWindow})` completes `LifecycleService`, `UpdateService`, `AdeTaskService`
window hooks and `WindowsService.OpenNewWindow`. `w.Bound() []any` returns the 20 services in
`main.go`'s current order; `main` maps each to `application.NewService`. `w.GitRouter()` feeds
`appshell.RegisterGitStream`. The harness passes a real `shell.NewQuitter` (flush flow S3 is real) and
recorders for window open/close/focus/title.

`platformLocator()`: two files in package `main`, `locator_native.go` (`//go:build !server`, returns
`gitclient.NewPlatformLocator()`) and `locator_server.go` (`//go:build server`, returns
`gitclient.NewDarwinLocator()`). The `-tags server` build is test and sandbox only, never shipped. This
replaces `docs/DEV_ENVIRONMENT.md`'s "throwaway local patch to `Locate`, never commit" step and lets the
TS tier run real git on Linux.

Mobile seam: rename `MobileAccessService.isLAN` to exported `IsLAN` (doc: nil in production). The
harness lives outside package `bridge` and needs it to bind loopback (`mobilenet_test.go:113` widens it
the same way).

Layering: `internal/appwire` and `internal/flowharness` import `internal/bridge`; add both to
`packagesExemptFromBridgeCheck` in `internal/layering_test.go`, with the ipcfixture precedent named.
Flow test packages hold only `_test.go` files plus `doc.go`; add their prefix too if `layeringtest`
lists them.

### 2.2 Go harness package: `apps/kira-space/internal/flowharness`

Non-test package, imported only by `_test.go` files. Files and contents:

- `harness.go`: `New(t, ...Opt) *App`. Skips without `git` (`testx.SkipWithoutGit`). Creates a short
  temp root with `os.MkdirTemp("", "ksf")` (not `t.TempDir()`: macOS temp paths exceed the 104-byte
  unix socket limit for `git.sock`, the hooks and askpass sockets). Sets `KIRA_SPACE_HOME`,
  `KIRA_MEMORY_HOME`, `HOME` (temp, with `.gitconfig` user.name/email, `init.defaultBranch=main`,
  `commit.gpgsign=false`, and `.bash_profile`/`.zprofile`/`.profile` prepending the fake bin dir, the
  P150 PTY-login-shell PATH fix), `GIT_CONFIG_NOSYSTEM=1`, `PATH` with fake bin dir first, `TZ=UTC`.
  Then `storage.Open`, `repos.New`, `appwire.Build`, `BindShell`, registers `t.Cleanup` in main's
  teardown order. Settings left at defaults; a test changes one only through `SettingsService.Set`,
  the way the UI does. `App` exposes each bound service by type, the `Wired`, the recorders and
  `Restart(t)` (teardown, then rebuild on the same home: recovery flows D6, E2).
- `events.go`: recording `appevent.Emitter`. `Wait(t, channel, pred, timeout)`, `Since(mark)`.
  Records window key for `EmitTo`.
- `shellfakes.go`: browser recorder, scripted dialogs, window-hook recorder, keep-awake driver
  recorder.
- `gitrepo.go`: real repo builders, every one a real `git` invocation with fixed
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` stepping 1 minute per commit:
  `Repo` (init, commit files, branch, tag, checkout, merge `--no-ff`, rename, binary file,
  NFD-named file, `Conflict(branchA, branchB, path)`), `BareRemote()` plus `Clone()` (two clones for
  diverge/push races), `LinkedWorktree(branch)`, `NoRemote`, `BadRemote` (unreachable `file://` path),
  `History(n, branches, mergeEvery)` built with `git fast-import` (2 500 commits under 1 s; 50 000 for
  the complete suite), `RevList(args)` as the oracle. Expensive templates built once per test binary
  (`sync.Once` under the package temp root) and copied per test with `git clone --local --no-hardlinks`
  or `cp -a` for working-tree state.
- `stream.go`: in-memory `bridge.StreamSession` pair (two channels of whole frames, the shape
  `application.StreamConn` gives `ServeGitStream`). `OpenGitStream(t)` runs the real
  `bridge.ServeGitStream(w.GitRouter(), conn)` in a goroutine, the exact function `appshell.stream.go`
  registers. Client: `Request(method, params, &out) error` (returns the wire error code/message),
  `Stream(method, params, credit)` decoding blob frames (`0x00 | u32 header | json | blob`) and
  `gitwire` flatbuffers chunks into `[]GraphRow{Sha, Parents, Refs, Lane...}`, `Events(method)`.
  Wire structs come from `internal/gitrpc/contract.go` types where exported, so a Go-side contract
  change breaks compilation here, not silently.
- `fakeagent/`: one fake `claude` and `gh` implementation, `Run(args, env) int`. Entry points:
  harness `Main(m)` re-exec (test binary run as `claude`/`gh`/`memory-mcp`/`memory-embed`, the
  `runengine_test.go` and `importer/engine_test.go` precedent), and `fakeagent/cmd/fakeclaude`
  (`package main`, built by the TS fixture). Scenario from `KIRA_FAKE_SCEN` JSON: ports
  `runengine_test.go`'s named actions (`done`, `fail`, finish-step variants), plus generic `emit`
  (print a file to stdout), `sh` (run a snippet in the agent cwd, e.g. `git commit`), `exit n`,
  `waitFile` (block until a flag file exists, for Stop/StopRun/attach flows). Every call writes argv,
  stdin and cwd to `KIRA_FAKE_DIR`. Generic actions exist so streams extend behaviour through
  scenario data in their own `testdata/`, never by editing this shared code.
- `main.go` in harness: `Main(m *testing.M)` dispatches the re-exec argv (via `appwire.RunArgvShim`
  for `memory-mcp`/`memory-embed`, `fakeagent.Run` for `claude`/`gh`), else
  `testx.RunWithTempHomes(m)`.
- `complete.go`: `Complete(t)` skips unless `KIRA_FLOW_COMPLETE=1`.
- `harness_test.go`: one smoke test. `New` builds; `len(Bound()) == 20`; git stream `app.init`
  answers `ok` with an absolute git path under default settings; teardown leaves no open
  `git.sock`. Prints build time.

Not fakes: git, SQLite, the git stream, gitsock, PTYs, fsnotify/FSEvents watchers, mobile HTTP server,
hooks socket, askpass socket. Fakes, each an OS or third-party seam with no git in it: Claude Code CLI,
`gh` CLI, native dialogs, browser, power assertion, LAN detection, window manager.

### 2.3 TS side: real UI against a real `-tags server` backend

**Decision: a Kira Space `e2e-real` Playwright project**, Kira Studio's `tests/e2e-real` shape: build
`frontend/dist` (`build:test:space`) and `go build -tags server -o apps/kira-space/bin/kira-space-server-test
./apps/kira-space`, spawn per test with temp `KIRA_SPACE_HOME`/`KIRA_MEMORY_HOME`/`HOME`,
`WAILS_SERVER_HOST=127.0.0.1`, free `WAILS_SERVER_PORT`, fake bin dir on `PATH`; open Chromium on
`/?window=<uuid>` (`WindowsService.Ensure` creates the row on a server build, `windowsvc` doc comment).

Rejected alternatives:

- TS contract-only client (no browser) calling `/wails/runtime`: the Go suite already asserts every
  result; a second client adds little. Both motivating bugs needed the real UI on real data: P225/P228
  lanes are computed and drawn in the frontend, P230 showed as a UI chip.
- Extending `tests/ui` mocks: the problem being fixed.

Why it is the cheapest real seam: no new server code (Wails server mode serves both planes over
HTTP/WebSocket), one binary build per run, chromium (Studio's e2e-real precedent; UI fidelity stays
`tests/ui`'s WebKit job).

Known server-build limits, decided:

- Terminal output does not reach the page (`EmitTo` needs a native window, DEV_ENVIRONMENT P126
  note): terminal flows are Go-only (T1-T3); TS covers quick-commands CRUD paths only.
- No native dialogs: `FilesService.ChooseFolder` and `MemoryImportService.Choose` are stubbed with a
  passthrough `page.route` for exactly that method (Studio e2e-real precedent).
- Mobile server binds a LAN interface only: phone flows are Go-only (B1-B6, real HTTP on loopback via
  `IsLAN`). The phone UI keeps its mocked `tests/mobile` tier.

Shared TS harness files: `apps/kira-space/tests/e2e-real/fixtures.ts` (build lock, build, spawn, health,
page, teardown SIGKILL), `support/gitRepo.ts` (`execFileSync('git')` builders mirroring the Go ones,
including `fast-import` history), `support/bound.ts` (POST `/wails/runtime` by FQN for seeding, the
DEV_ENVIRONMENT recipe body), `support/routes.ts` (dialog passthrough stubs). The build-lock and
health helpers in `apps/kira-studio/tests/e2e-real/fixtures.ts` (`acquireBuildLock`, `isLockStale`,
`waitForHealth`, free-port) move to `packages/workbench/src/testing/e2eReal.ts` and both fixtures
import them; no copy.

---

## 3. Commit 0 (single Sonnet agent, before the split)

Lands on `v2.0`; both streams branch from its last commit. Commits, in order:

1. `refactor(space): composition root in internal/appwire` — move, `BindShell`, `Bound()`,
   `platformLocator` build-tag pair, layering exemption. Pure move otherwise: no behaviour change.
2. `refactor(space): export mobile IsLAN seam`.
3. `test(space): flowharness and fake agent` — §2.2, smoke test, empty flow packages:
   `apps/kira-space/internal/flows/{gitflow,repoflow,editorflow,adeflow,memoryflow,termflow,appflow,mobileflow}/`
   each with `doc.go` (package comment) and `main_test.go` (`func TestMain(m) { os.Exit(flowharness.Main(m)) }`).
4. `test(space): e2e-real tier` — §2.3 fixtures/support, shared `e2eReal.ts` move (Studio fixture
   imports it), Playwright project `e2e-real` (`testDir: './tests/e2e-real'`, chromium,
   `fullyParallel`, `workers: 2`), `.gitignore` `apps/kira-space/bin/`, `tsconfig.tests.json`
   include, one smoke spec `boot-real.spec.ts` (boot, import a real repo through `bound.ts`, Git
   module lists it, graph shows HEAD's subject).
5. `chore: flow suite scripts` — root `package.json`:
   `test:flows:space` = `go test ./apps/kira-space/internal/flows/... ./apps/kira-space/internal/flowharness/...`;
   `test:flows:space:complete` = `KIRA_FLOW_COMPLETE=1 go test -timeout 20m` same packages;
   `test:e2e-real:space` = `node node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts --project=e2e-real`
   (fixture builds itself under the lock).

Commit 0 checks: `go build ./apps/kira-space` and `go build -tags server ./apps/kira-space`; generated
bindings unchanged (`bun run setup` then diff `apps/kira-space/frontend/bindings` against a copy taken
before commit 1; the bound types and FQNs must not move); `go test ./apps/kira-space/...`;
`bun run test:flows:space`; `bun run test:e2e-real:space` (smoke); Studio `sqlite-real.spec.ts` still
passes after the helper move; `bun run test:ui:space` unchanged pass count; typecheck, lint, lint:go,
lint:dead. Any pre-existing failure found gets fixed in Commit 0 (CLAUDE.md rule), never deferred.

---

## 4. Streams

Split by module, each stream owning both its Go and TS tests. Two worktrees off Commit 0's last
commit: `../kira-studio-p231-a` (branch `p231-a`), `../kira-studio-p231-b` (branch `p231-b`). Each runs
`sh scripts/prepare-worktree.sh` first. Commit 0 is the only producer of shared code; streams add
files only.

### 4.1 File ownership (zero overlap)

| Path | Owner |
|---|---|
| `apps/kira-space/internal/appwire/**` | Commit 0 |
| `apps/kira-space/internal/flowharness/**` (incl. `fakeagent`) | Commit 0 |
| `apps/kira-space/internal/flows/*/doc.go`, `*/main_test.go` | Commit 0 |
| `apps/kira-space/main.go`, `locator_*.go`, `internal/layering_test.go`, `internal/bridge/mobile*.go` (IsLAN) | Commit 0 |
| `apps/kira-space/tests/e2e-real/fixtures.ts`, `support/**`, `boot-real.spec.ts` | Commit 0 |
| `apps/kira-space/playwright.config.ts`, `tsconfig.tests.json`, root `package.json`, `.gitignore` | Commit 0 |
| `packages/workbench/src/testing/e2eReal.ts`, `apps/kira-studio/tests/e2e-real/fixtures.ts` | Commit 0 |
| `apps/kira-space/internal/flows/gitflow/*_test.go`, `gitflow/testdata/**` | Stream A |
| `apps/kira-space/internal/flows/repoflow/*_test.go`, `repoflow/testdata/**` | Stream A |
| `apps/kira-space/internal/flows/editorflow/*_test.go` | Stream A |
| `apps/kira-space/tests/e2e-real/git-*.spec.ts`, `repos-*.spec.ts` | Stream A |
| `docs/v2.2/plans/P231-findings-A.md` | Stream A |
| `apps/kira-space/internal/flows/adeflow/*_test.go`, `adeflow/testdata/**` | Stream B |
| `apps/kira-space/internal/flows/memoryflow/*_test.go`, `memoryflow/testdata/**` | Stream B |
| `apps/kira-space/internal/flows/termflow/*_test.go` | Stream B |
| `apps/kira-space/internal/flows/appflow/*_test.go` | Stream B |
| `apps/kira-space/internal/flows/mobileflow/*_test.go` | Stream B |
| `apps/kira-space/tests/e2e-real/ade-*.spec.ts`, `memory-*.spec.ts`, `settings-*.spec.ts`, `commands-*.spec.ts` | Stream B |
| `docs/v2.2/plans/P231-findings-B.md` | Stream B |

Separate Go packages per stream, so stream-private helpers never collide at landing. Streams touch no
production code, no `flowharness` file, no shared TS support file. A stream that needs a harness
change stops and reports it to the orchestrator, who lands it on `v2.0` as a Commit 0 follow-up and
both streams rebase onto it; never edited inside a stream.

**No ordering dependency between A and B: confirmed.** Both depend only on Commit 0. Neither imports
the other's packages or specs. Cross-module flows sit wholly in one stream: S1 (git path setting
across git stream, repos and ADE) is Stream B's `appflow`, calling the git stream through
`flowharness`, not through Stream A code; O1 (ops log) is Stream B's `appflow` driving its own git ops.
Findings files are per stream. Production fixes do not happen in streams (§6).

### 4.2 Stream rules

- Implement every test in §5 for the stream, then run the stream's suites once and triage (CLAUDE.md:
  implement first, test once). Commit per module as it lands.
- A failing test caused by a **test bug** is fixed in-stream.
- A failing test caused by a **product bug**: commit the test with
  `t.Skip("P231 finding A3: <one line>")` (TS: `test.fixme` with the same text), and record the finding
  in the stream's findings file in the same commit (§6.1). Never fix product code in a stream.
- Discovery: tracing a failure's root cause is discovery. Call `codegraph_explore` for indexed code
  (`internal/*`, `packages/*`) before Read/Grep; `apps/kira-space` is not indexed, read it directly.
  The orchestrator greps the stream's tool log for real calls.
- No `--no-verify` as a finish. Hooks green on every commit.

---

## 5. Per-flow tests

Each line: test name; setup (real git); assertions; bug class it guards. **(C)** = complete suite only
(`flowharness.Complete(t)`). Everything else is the general suite. Bar: a test must cross the IPC
boundary and assert a real-git or cross-module consequence. Pure persistence round trips (layout
get/set, rename then list, tabs save/list in one window) are excluded as CRUD trivia, per CLAUDE.md.

### 5.1 Stream A — Go

`gitflow` (git stream through `ServeGitStream`, default settings):

- `TestOpenDefaultGitPath` — repo; `app.init` ok, `status.path` absolute; `repo.open` ok, root and
  `repoId` set. Guards P230 C1 class (empty `git.gitPath` reaching `exec`).
- `TestOpenShapes` — non-repo dir, bare repo, linked-worktree root, subdirectory, NFD-named dir; each
  result kind and `root`/common dir match `git rev-parse`. Guards P230 C3 class.
- `TestGraphFirstPage` — `History(300, 6 branches, merge every 7)` plus tags and a cloned remote;
  first chunk row count equals page size; rows, parents and ref decorations equal
  `git log --topo-order --format=%H %P %D` for that window. Guards wire encoding and decoration
  mapping.
- `TestGraphPagesToEnd` — `History(2500, 8, 5)`; small credit; `graph.loadMore` until exhausted;
  concatenated shas equal `git rev-list --all --topo-order` exactly, no duplicates, no gaps,
  `hasMore` false only at the end. (C) same at 50 000. Guards P225 class (commits vanish, Show more).
- `TestGraphRefreshAfterExternalCommit` — commit with plain `git` outside the app; wait for
  `repo.changed` (real watcher); `graph.refresh` shows the new head; after two `loadMore` pages,
  refresh keeps every previously loaded row. Guards P225's still-open "Refresh after Load more re-walks
  one page" (a failure here is a finding, not a test bug).
- `TestCommitDetailAndDiff` — merge commit, rename, binary, NFD path, mode change; `commit.detail`
  file list equals `git show --name-status -M`; `commit.fileDiff` hunks equal `git diff` for one
  file; `file.read` at a revision equals `git show rev:path`.
- `TestWorkingTreeStates` — staged, unstaged, untracked, deleted, conflicted; `working.detail` and
  `status.get` match `git status --porcelain=v2`.
- `TestBlameLine` — three authors over one file; `blame.line` sha/author per line equals
  `git blame --porcelain`.
- `TestCheckoutDirtyAutostash` — dirty tree; `preflight.checkout` reports the conflict risk;
  `repoSettings.set` `checkoutAutoStash`; `op.run` checkout; HEAD moved, changes restored, ops log row.
- `TestStashFlows` — two stashes (one with untracked); `stash.list`, `stash.show`; pop with conflict
  reports conflict and keeps the stash; `stashBranch` creates branch; `globalStash.list` spans two
  open repos.
- `TestWorktreeAddRemove` — `preflight.worktreeAdd`/`op.run` creates it (`git worktree list` shows
  it); remove with a dirty worktree refused by preflight, clean one removed; `worktree.prepare` refused
  by the allowlist.
- `TestRemoteFetchPullPush` — bare remote, clones X and Y; Y pushes; X `remote.run` fetch, ahead/behind
  in `refs.list`; pull ff-only; X commits and pushes; force push after amend rejected by preflight
  unless confirmed, then succeeds; delete remote branch. (C) pull with `merge` and `rebase` on a
  diverged branch, each with and without a conflict, and sequencer `continue`/`abort` after it.
- `TestRemoteCancel` (C) — `remote.run` fetch against a remote whose `git-upload-pack` is a wrapper
  that sleeps (`uploadpack` config); `remote.cancel`; op ends cancelled, no lock files left.
- `TestCherryPickRevertConflict` — cherry-pick with conflict; `op.run` abort restores; again with
  resolve then `continue`; revert of a merge with mainline.
- `TestResetAndUndo` — `preflight.reset` soft/mixed/hard on dirty tree; `undo.peek` label;
  `undo.run` restores previous HEAD and branch.
- `TestStackRestack` — three stacked branches, amend the base; `stack.list` shows the stack;
  `stack.restack` rebases all; (C) a conflicting restack then `stack.cancelRestack` restores refs.
- `TestSearchHistory` — `search.run` by message, author, sha prefix, path on the 2 500 history;
  results equal `git log --grep/--author` sets.
- `TestRepoSettingsAffectStream` — `repoSettings.set graphPageSize` changes the next first page size;
  `worktreePrepareScript` refused by `guardRepoSettingsSet`.
- `TestReviewSession` — feature branch off main with 3 commits; `review.resolveBase` picks main;
  `review.files` equals `git diff --name-only main...feat`; mark, comment add/list/remove/export;
  close and reopen stream, comments persist (`review.db`).
- `TestNoRemoteAndPr` — no-remote repo: pull/push preflights return a no-remote result, not an
  error; `commit.resolvePr`/`branch.resolvePr` return none; `pr.browserUrl` refuses a non-GitHub remote.
- `TestTwoConnectionsShareRepo` — two stream connections open the same repo; `repo.close` on one;
  the other still streams and both got `repo.changed` before close.
- `TestCredentialPrompt` (C) — HTTPS remote served by `net/http/httptest` + `net/http/cgi` running
  real `git http-backend` behind basic auth; `remote.run` fetch raises `credential.request` on the
  stream and in `GitCredentialService.Pending`; wrong secret yields the auth error class; right secret
  completes the fetch.

`repoflow` (`CodeWorkspaceService`, `FilesService`):

- `TestImportViaFolderPicker` — scripted dialog returns a repo path; `ChooseFolder` then
  `ImportRepo` with default settings succeeds (real Discovery); `ListRepos` has it; ADE `Repos`
  shows it (repos-changed hook).
- `TestImportEdgeCases` — non-repo refused; same path twice deduped or refused (assert whichever the
  UI expects from `ReposDialog.vue`); linked worktree and bare repo handled as the dialog shows them.
- `TestBrowseReadDiff` — `OpenWorkspace`, `ListFiles` (tracked, ignored excluded, nested), `ReadFile`
  (text, binary flag, large file cap), `ReadDiff` against HEAD; a symlink escaping the root refused
  (`pathsafe`).
- `TestCodeSearch` — `StartSearch` streams events until done with hits equal to `git grep -n`;
  `CancelSearch` mid-search stops events.
- `TestHeadsAndWorktreeLinks` — two repos, one with two linked worktrees; checkout in a worktree;
  `RepoHeads` and `RepoWorktreeLinks` reflect it.
- `TestRemoveRepoClosesSessions` — open workspace and search; `RemoveRepo`; later calls return
  not-found, no leaked cat-file processes (`/proc` or `ps` count before/after).

`editorflow` (`gitsock`, `GitClientsService`; raw socket client in this package, ported from
`gitsock/integration_test.go`'s `testClient`):

- `TestEditorPairsAndReadsRepo` — dial `git.sock`, hello; `kira:git:pairing` event; `PendingPairing`;
  `Approve`; client gets a session token; `repo.open` and `graph.stream` over the socket on a real
  repo. Restores the `git-pairing-real.spec.ts` coverage ARCHITECTURE names as a gap.
- `TestEditorDenyRevokeRepair` — `Deny`; then pair, `Revoke` (`kira:git:clients` event, connection
  dropped); re-pair works; `Restart` on the same home, stored token reconnects without a prompt.
- `TestEditorRefusesSpaceWrites` — `repoSettings.set` and `worktree.prepare` refused over the socket
  (P178).

### 5.2 Stream A — TS (`e2e-real`)

- `git-graph-real.spec.ts` — `History(2500, 8 branches, merges)`; open the repo; scroll and Load more
  until done; row count equals `git rev-list --all --count`; every row has a graph node in its lane
  cell; drag graph/author/date column widths, then Load more, nodes still present (P225, P228
  classes against real data).
- `git-commit-detail-real.spec.ts` — click a merge commit; file list equals
  `git show --name-status -M`; open a file diff.
- `git-remote-real.spec.ts` — bare remote plus a second clone pushing; Fetch, Pull, Push from the
  toolbar; ahead/behind badges update; Operations panel lists the ops.
- `git-checkout-stash-real.spec.ts` — dirty tree; checkout a branch from the refs menu with autostash;
  stash list shows and pops a stash.
- `repos-dialog-real.spec.ts` — add a repo through the Repos dialog (folder picker stubbed); rename,
  colour; file tree; open a file; code search hit.
- `git-review-real.spec.ts` — review a branch; add a comment; reload the page; the comment persists.

### 5.3 Stream B — Go

`adeflow` (`AdeTaskService`; fake agent from `flowharness/fakeagent`):

- `TestFolderImportAndFacts` — folder with three repos (remote, no remote, linked worktree);
  `AddFolder` imports them; `Board` repo facts: remote, `lastFetchAt` after a plain `git fetch`;
  `SetFolderWatch` picks up a fourth repo created later; `RemoveFolder`.
- `TestRefreshDefaultSettings` — default `git.gitPath`; `Refresh` all: remote repo ok with refs
  changed after a push from another clone; no-remote repo reads no remote, not an error; bad-remote
  repo returns the classified error; linked-worktree root updates `lastFetchAt`. P230 C1-C3 at the bound
  level, through real `Discovery`.
- `TestTaskBranches` — `CreateTask`; `AddTaskRepo` new branch creates a real worktree
  (`git worktree list`); `AddExistingBranch` with a remote-only branch; `CandidateBranches` lists
  local and remote; board ahead/behind against base equals `git rev-list --left-right --count`.
- `TestBacklogPromote` — add three items, move, update, delete one, promote one; promoted task appears
  on `Board`, item gone from `Backlog`. Order arithmetic is the reason this is not CRUD.
- `TestWorkflowsYaml` — `NewWorkflow`; invalid YAML fails `ValidateWorkflowYaml` with a line; save;
  import a file (scripted dialog path); `SetTaskWorkflow` on a task changes its stages.
- `TestRunLifecycle` — scenario `done`; `StartRun` runs setup in the real worktree, step reaches
  approval; `Approve`; `StageDone`; `ReadLog` pages in order; scenario `fail` then `RetryRun`
  succeeds; `waitFile` scenario then `StopRun` ends it stopped; setup failure (worktree path occupied)
  then `RetrySetup`.
- `TestAgentCommitReachesBoard` — scenario `sh: git commit` in the worktree; board ahead count rises;
  rebase base on remote, `ForcePush` updates the bare remote ref; merge the branch on the remote,
  `RecordMerge`; task state merged.
- `TestQueueMergeTree` — two tasks touching the same file; `SetQueuedAfter`; merge-tree conflict
  fact appears (real `git merge-tree --write-tree`); `SetPlan` reorders.
- `TestInteractiveSessions` — `LaunchStage` opens a real PTY running fake `claude` (TUI scenario
  `waitFile`); `Sessions` lists it running; `Send` text arrives in the fake's stdin record;
  `FocusSession` calls the window-hook recorder; release the flag, session ends stopped (tracker
  Reconcile). `TakeOver` of a headless run and `StartBranch` follow the same checks.
- `TestArchiveRisk` — unpushed commit in a task branch; `ArchiveRisk` reports it; `ArchiveTask`
  removes the worktree and keeps or deletes the branch per the risk choice; review windows closed via
  recorder.
- `TestReviewWindowAndAgent` — `OpenReviewWindow` records a window with a review key;
  `ReviewWindowTarget` resolves it; `LaunchReviewAgent` starts fake claude in the worktree;
  `ReviewAgent` state transitions.
- `TestRestartRecovery` — run in `waitFile`; `Restart`; `Board`/`Sessions` show it stopped, worktree
  intact, `StartRun` works again.
- `TestGitHubWithoutGh` — `gh` absent from PATH: `Prs`, `GitHubSyncPlan` return the unavailable state,
  no error toast class. (C) `TestGitHubSyncWithFakeGh`: fake `gh` scenario returns a PR list;
  `GitHubSyncPlan`/`Apply` result matches.

`memoryflow` (no git; real SQLite, real subprocess paths):

- `TestStoreThroughGate` — fake `claude` emits an accepting gate output (`testdata/gate-accept.json`);
  `Store` two facts; `kira:memory:changed`; `Recent` and `Search` find them; `History` shows the store
  event.
- `TestGateRejectsOrFails` — rejecting gate stores nothing; malformed gate output surfaces an error,
  store unchanged.
- `TestSemanticUnavailable` — no `KIRA_ORT_LIB`: `SemanticStatus` unavailable; `Search` still returns
  keyword hits; `RetrySemantic` leaves state consistent.
- `TestConnectClaudeCode` — `McpStatus` before; `InstallClaudeCode` with fake `claude`: recorded argv
  is the remove plus `add-json` pair with an absolute, quoted `headersHelper`/command path; status after.
- `TestImportLifecycle` — scripted dialog picks `testdata/import/` (two files); `Create`, `Start`;
  fake chunk agents and the final agent add memories through real `memory-mcp` (test binary re-exec);
  `Jobs`/`Job` progress to done; memories searchable; `Dismiss`. Second job: `Pause` mid-run, `Resume`,
  `Cancel`, `Discard`.
- `TestImportRetries` (C) — one chunk agent fails; `Job` shows the failed file; `RetryFile` then
  `RetryFailed` complete it.

`termflow`:

- `TestShellTabRunsGit` — `DefaultCwd`; `Open` a shell in a repo; `Write` `git rev-parse --abbrev-ref
  HEAD`; output event (`EmitTo` the window) contains the branch; `Resize`; `Close`; exit event;
  `Registry` empty.
- `TestCollectionsMoveAndDelete` — collection with two scripts; `Move` one out; `DeleteCollection`;
  remaining script lands where the UI expects (assert against `createCustomScriptsStore` semantics);
  changed events carry the full snapshot.
- `TestAgentTabCountsForKeepAwake` — `claudeCode.keepAwakeWithAgents` on; `Open` a claude-code tab
  (fake TUI); keep-awake driver recorder held with agent reason; close tab, released.

`appflow`:

- `TestGitPathSettingEverywhere` — `Set git.gitPath` to a missing file: git stream `app.init`
  `notFound` listing the path, `ImportRepo` refused, ADE `Refresh` row error classified; set it to the
  real absolute git: all three recover without restart; back to `""`: recover. Guards Discovery cache
  and settings propagation across modules.
- `TestWindowScopedState` — two window keys via `Ensure`; `SetMode` and `TabsService.Save` per window;
  `List` for each returns only its own; `Restart`; both persist.
- `TestQuitFlushHandshake` — real quitter: `RequestQuit` emits the flush signal; `WindowFlushed` per
  window then `Flushed`; teardown runs once; DB closed; second quit is a no-op.
- `TestKeepAwakeManualAndAgents` — `SetManual` on/off; `Status` reasons; headless ADE session running
  (fake `waitFile`) counts as agent reason when the setting is on.
- `TestOpsLogAndCancel` — fetch and checkout through the git stream, `graph.reportFailure`;
  `OpsService.Recent` rows in order with kinds; (C) cancel a slow fetch through `OpsService.Cancel`.
- `TestDateFormatReachesGit` — `appearance.dateFormat` absolute vs relative changes `commit.detail`
  date fields.
- `TestOpenLinks` — `OpenExternal` https recorded; `javascript:`/`file:` refused; PR URL validation.

`mobileflow` (real `mobileweb` HTTP server on loopback via `IsLAN`; Go `net/http` phone client with
cookie jar, `coder/websocket` for terminal):

- `TestEnableTrustPort` — `SetEnabled`; `TrustCurrentNetwork`; status listening on the injected
  network; `SetPort` rebinds; `ForgetNetwork` stops with the matching reason.
- `TestPhonePairing` — `POST /api/pair`; `kira:mobile:pairing`; `Approve`; cookie works on `/api/me`;
  a second phone `Deny`; `Revoke` first, its SSE connection drops and `/api/me` is 401.
- `TestPhoneReadsRealAde` — ADE state built through `AdeTaskService` on real repos (task with a real
  worktree branch, backlog, a finished run log); `/api/ade/board`, `/backlog`, `/repos`, `/log`
  match the bound-service results; no `cwd` field anywhere.
- `TestPhoneWrites` — writes refused without permission; `SetDevicePermissions` write on; backlog add
  and move, replay with the same `Idempotency-Key` returns the first response once; `/tasks/stage`
  next and prev change the task; `/tasks/launch` emits `kira:mobile:openLaunch`, `LaunchOpened`.
- `TestPhoneEventStream` — `/api/events` receives an ADE board change made through the bound service.
- `TestPhoneTerminalAttach` — agent input both switches on; TUI session (fake `waitFile`);
  `/api/agent/sessions/{id}/send` text reaches the fake; WebSocket attach; `TerminalHolds` lists the
  hold and `kira:mobile:terminals` fires; `ReclaimTerminal` ends the phone side.

### 5.4 Stream B — TS (`e2e-real`)

- `ade-board-real.spec.ts` — two imported repos (bare remote; no remote), default settings; Agents >
  Refresh all; chips show a fetch time and `no remote`; no red text (P230 U1 class).
- `ade-task-real.spec.ts` — create task, add a new branch; worktree exists on disk; card shows the
  branch; archive; worktree gone.
- `ade-run-real.spec.ts` — fake `claude` on the server PATH (scenario `done`); start a run; run reaches
  approval, approve, log visible.
- `memory-real.spec.ts` — Add memory dialog with gate-accept fake; memory listed; search finds it.
- `settings-git-path-real.spec.ts` — Settings > Git path to a missing file; Git module shows the
  blocked panel naming that path; clear it; module recovers.
- `commands-real.spec.ts` — create a collection and a script, move it; reload; persisted.

Totals: Stream A 31 Go tests + 6 specs; Stream B 36 Go tests + 6 specs; Commit 0 one Go smoke test
and one smoke spec. 68 Go tests, 13 specs. Plan count, used by the orchestrator to verify (`go test -list`, `playwright --list`).

---

## 6. Findings and fix phase

### 6.1 Findings files

`docs/v2.2/plans/P231-findings-A.md` and `-B.md`, one per stream, each committed together with its
skipped failing test. Entry format:

```
## A3 graph refresh after Load more drops loaded rows
- Test: gitflow TestGraphRefreshAfterExternalCommit (skipped "P231 finding A3")
- Failure: <exact failing assertion line>
- Repro: <setup, calls>
- Suspected cause: <file:line>, how found (codegraph_explore / read)
- Class: product bug | needs design decision
```

A finding that needs a design decision or another subsystem gets `Class: needs design decision`; the
orchestrator adds a SPEC row for it (next free `P` number at the table end) and asks the user. Its
test stays skipped with that row's number in the skip text.

### 6.2 Fix phase

After both streams land and pass orchestrator verification: **one sequential Sonnet fixer for both
findings files.** Why one: stream ownership partitions test files, not production code. Both
motivating bugs crossed modules (Discovery and settings feed git, repos and ADE), so A and B findings
are likely to share root causes and files; two fixers would need a production-file ownership table
nobody can draw before the findings exist. Exception: if the findings exceed 15 and the orchestrator
can draw a zero-overlap production-file table between two groups, two fixers in worktrees, same
landing rules.

Fixer rules: read both files; group by root cause; per group fix, remove the `P231 finding` skips of
that group, run those tests (plus the module's existing suite), commit (`fix(space): ...`). Record in
the findings file, per entry, the pre-fix failure line (already there) and the fix commit. Regression
tests stay. When every product finding is fixed, delete both findings files in a final commit and
move the pre-fix failure lines into `## P231 result` in `SPEC.md`.

Done means: `grep -rn "P231 finding" apps/kira-space` is empty, except skips naming a new SPEC row the
user has seen.

---

## 7. Suites, time budget, checks

| Suite | Command | When | Budget (Linux CI runner) |
|---|---|---|---|
| General Go flows | part of `bun run test:go` (`go test ./...`); alone `bun run test:flows:space` | every dev loop and CI `container-tests` | ≤ 90 s wall, all 9 packages in parallel; ≤ 3 s per test typical; harness `New` ≤ 300 ms |
| Complete Go flows | `bun run test:flows:space:complete` | on demand, phase end, before release | ≤ 10 min |
| TS e2e-real | `bun run test:e2e-real:space` | on demand, phase end | ≤ 6 min incl. build, 13 specs, 2 workers |

This is the P25 general/complete split: general is the per-flow load-bearing assertion set, complete
adds the permutations (pull strategies times conflict, 50 000-commit paging, cancel, credentials,
import retries, fake `gh`). Same tests, `Complete(t)` gating only the extra cases, no parallel
mechanism.

Speed rules: serial within a package (process env `KIRA_SPACE_HOME`/`HOME` per test via `t.Setenv`),
parallel across packages; fixture templates built once per binary and copied; `fast-import` for
history; no sleeps, only `Wait` on events or `testx.WaitUntil`; each package measured once at phase
end, numbers into the result section.

Linux CI: `container-tests` already raises `fs.inotify.max_user_instances` (each open repo holds a
watcher). Harness closes repos at teardown so counts stay bounded. CI wiring for e2e-real: none, same
as Studio's e2e-real (on-demand); `.github/workflows/` cannot be pushed from a Linux session
(DEV_ENVIRONMENT), so any later wiring goes through `docs/pending-workflows/`.

Unit-test bar: these are flow suites at the IPC boundary, requested explicitly, with the adapter
conformance suites and e2e-real as precedent. The bar still applies inside them: §5 lists flows with
real-git or cross-module consequences; persistence round trips are excluded.

Orchestrator checks before accepting each step:

- Commit 0: §3 checks; `main.go` diff is a move (no new logic); `Bound()` count 20; bindings diff empty;
  real `codegraph_explore` calls in the implementer log if it traced anything in indexed code.
- Each stream: `go test -list` and `playwright --list` counts equal §5 per package/spec; every test name
  in §5 present; no `GitPath: "git"`, no `GitStatus{` literal, no fake `Runner`/`Locator` in
  `apps/kira-space/internal/flows` (grep); no file outside the stream's ownership rows touched
  (`git diff --stat <commit0>..p231-x`); findings file entries match skip markers one to one.
- Landing: rebase each stream onto `v2.0`; a conflict means the ownership table was wrong, stop.
  Remove worktrees; push.
- Fix phase: skip grep empty; `bun run test:go`, `bun run test:flows:space:complete`,
  `bun run test:e2e-real:space`, `bun run test:ui:space` (fixes may touch frontend),
  `bun run test:unit`, typecheck, lint, lint:go, lint:dead all green; each fixed finding's test failed
  before (line in findings) and passes after.

---

## 8. Docs

- `docs/ARCHITECTURE.md` Testing: replace the "Kira Space has no `ipc/`/`e2e-real/` tier ... real gap"
  paragraph with the flow tier (appwire shared composition root, flowharness, what is real vs faked,
  general/complete) and the Kira Space `e2e-real` tier (server build, server-tag locator, limits:
  no terminal output, no dialogs, no mobile). Remove the `git-pairing-real` gap text (closed by
  `TestEditorPairsAndReadsRepo`). Update the Parallelism paragraph's Kira Space project list. Add the
  `appwire` package to the Kira Space process-wiring description.
- `docs/DEV_ENVIRONMENT.md`: P126 server-tag recipe drops the "throwaway `Locate` patch, never
  commit" step and the windows-row seeding note if `Ensure` covers it (verify in Commit 0); new
  section "Kira Space flow suites": commands, env (`KIRA_FLOW_COMPLETE`, `KIRA_FAKE_SCEN`,
  `KIRA_FAKE_DIR`), short temp root for macOS socket paths, fake agent, inotify limit.
- `docs/v2.2/SPEC.md`: `## P231 result` (counts, timings, findings with pre-fix lines, deviations);
  row Done; this plan deleted after folding, per `docs/v2.2/README.md`.
- `CLAUDE.md`: no change (no new process rule).

---

## 9. Mac handover

The user runs on the Mac (darwin locator with real Homebrew/CLT git, FSEvents watcher instead of
fsnotify, macOS socket path lengths):

1. `bun run test:flows:space` then `bun run test:flows:space:complete`: all pass. Report any darwin-only
   failure (watcher timing in `TestGraphRefreshAfterExternalCommit`, socket paths).
2. `bun run test:e2e-real:space`: 13 specs pass.
3. App smoke after the `appwire` move (`bun run dev:space`): window opens; Git: open a repo, scroll,
   Load more, fetch; Agents: Refresh all, no red text, start a task stage; Memory: add one memory;
   Terminal: `git status` in a tab; Settings > Mobile access: QR shows; Cmd+Q quits within 2 s with
   tabs restored on relaunch.
4. `git config --global` untouched after the suites (harness `HOME` isolation).

---

## 10. Deferred decisions (defaults the orchestrator takes unless the user says otherwise)

- DD1: `appwire` refactor of `main.go` (default yes) vs copied wiring in the harness (rejected, §2.1).
- DD2: Update module excluded (no endpoint seam in `appupdate`). Adding a seam is its own phase if wanted.
- DD3: `locator_server.go` committed for the `-tags server` build (default yes; test/sandbox build only).
- DD4: `MobileAccessService.IsLAN` exported (default yes).
- DD5: one sequential fixer for both findings files (default; §6.2 exception rule).
- DD6: e2e-real not wired into CI (default; on demand like Studio's).
- DD7: complete-suite gate env name `KIRA_FLOW_COMPLETE=1` (default).
