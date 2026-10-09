# P236 plan: more real-flow coverage, user journeys, flaky-spec fixes

SPEC row P236. User's words: "Cover more flows and use cases with real tests (e2e, IPC, etc.) so
there are no surprises when I test it."

Base: `v2.0` at `a6637fbdf`. Stream A (see SPEC stream table). One sequential Sonnet implementer.
Extends P231 (Space) and P232 (Studio): same harnesses, same rules (real git, real SQLite, real
PTYs, real sockets, default settings; fake only OS/third-party seams).

Discovery: `codegraph_explore` over `appwire` (Studio), `agenthooks`, `internal/terminal`,
`internal/docker` (indexed). `apps/kira-space/**` is not in the CodeGraph index; read directly.
Coverage numbers below come from a scratch script: every `export function` in the generated
bindings (`apps/*/frontend/bindings/.../internal/bridge/*service.ts`) grepped as `\.<Method>\(` in
`apps/<app>/internal/{flows,flowharness}/**/*_test.go`. Name collisions overcount (e.g.
`customscriptsservice.Remove` "hit" in `gitflow` is another `Remove`); step 1 below re-checks every
hit as a qualified call.

## 1. Audit

### 1.1 Numbers (base tree)

| Surface | Methods | No flow test calls it |
|---|---|---|
| Space bound services (20) | 152 | 20 |
| Space git stream requests (`packages/git-ipc/src/contract.ts` `requests`) | 81 keys | 26 not named in any flow test |
| Studio bound services (27) | 147 | 57 (mostly DB services: covered by `tests/ipc` fixtures and adapter suites, not by flows) |

### 1.2 Space gaps

Bound methods with no flow call: `AdeTask.{AddTaskRepo, SaveWorkflow, SetTaskStage, UpdateTask,
WorkflowYaml}`, `CodeWorkspace.CloseWorkspace`, `CustomScripts.{RenameCollection, Update}`,
`GitClients.{AttachPush, InstallVsCodeIntegration, VsixStatus}`, `GitCredential.{AttachPush,
Pending, Provide}`, `Lifecycle.WindowFlushed`, `Memory.InstallSemanticModel`,
`MobileAccess.AttachPush`, `Update.{CancelInstall, InstallUpdate}`, `Windows.OpenNew`.

`AttachPush` (x3) are Go-only helpers that Wails binds by accident of being exported: check each is
really in the binding file; if bound, either unexport behind a package func (the
`docker.CloseWindowBound` precedent) or exempt with reason. Never leave a bound method that a page
can call to detach another window's push.

Git stream keys never named in a flow test: `review.open`, `review.fileDiff`, `review.snapshot`,
`review.target`, `review.session.load`, `review.session.save`, `review.comment.clear`,
`repo.list`, `graph.revealCommit`, `worktree.cancelPrepare`, `worktree.openWindow`, `ui.action`,
`link.openExternal`, `pr.openExternal`, `clipboard.write`, `file.goToTarget`, `editor.goToFile`,
`editor.openAllChanges`, `editor.openDiff`, `editor.openRangeDiff`, `editor.openWorkingDiff`,
`editor.resolveConflict`, `autoFetch.changed`, `connection.changed`, `settings.changed`. Classify
each first: served by Kira Space's router, VS Code host only (`editor.*` likely), or a push. Only
router-served requests need a flow test; host-only and pushes go in the exempt list with reason.
The `review.*` set is the real gap (P150 review code runs only through `git-review-real.spec.ts`).

### 1.3 Studio gaps

No flow call: `App.Info`; `Collections.{GetGrpcRequest, MoveItem, Rename, SaveGrpcRequest}`;
`Connections.{Connect, Disconnect, Duplicate, Remove, Reorder, SecretsStatus, States, Test,
Update}`; `CustomScripts.{Remove, Update}`; `DataGrip.Scan`; `DbMcp.{ApproveQuery, DenyQuery,
InstallClaudeCode, PendingApprovals, Regenerate, SetEnabled}`; `Filters.Replace`;
`GrpcHistory.Clear`; `KeepAwake.SetManual`; `Layout.GetAll`; `Lifecycle.{Flushed,
WindowFlushed}`; `MaskRules.{CorrelationKey, Counts, RegenerateKey, Remove}`;
`Queries.{HistoryList, HistoryRecord, ListConsole, Save, SaveConsole, Touch, Update}`;
`ResponseHistory.Clear`; `Settings.GetAll`; `Tabs.Save`; `Tree.{Children, Definition, Invalidate,
KeyTypes, SchemaColumns}`; `Update.{CancelInstall, InstallUpdate}`;
`Variables.{DeleteEnvironment, Reorder, ReorderEnvironments, UpdateEnvironment}`;
`Windows.{Ensure, OpenNew, SetMode}`.

Full per-method map: Appendix A (Space), Appendix B (Studio).

## 2. New Go flow tests

Rules: one package per area under the app's `internal/flows/`; `main_test.go` calls the harness
`Main` like the P231/P232 packages; complete-only cases call `flowharness.Complete(t)`. A test
earns its place only by driving a real multi-service path or an error path a user can hit. No test
for a getter already exercised as a side effect of a journey: the journey's assertions cover it.

### 2.1 Space (`apps/kira-space/internal/flows/`)

| Package / file | Test | What it drives |
|---|---|---|
| `journeyflow/firstrun_test.go` (new pkg) | `TestFirstRunJourney` | empty home -> `Windows.Ensure` -> `CodeWorkspace.ImportRepo` -> git stream `repo.open`, `graph.stream`, stage + commit, push to `NewBare` -> `AdeTask.CreateTask`, `UpdateTask` (title, owner), `AddTaskRepo` (second repo), `StartBranch`, `StartRun` (fake claude scenario finishing), `StageDone`, `SetTaskStage` back one stage, `ArchiveTask` -> `app.Restart()` -> board, tabs, layout, settings, repo list, archived task all as before |
| `journeyflow/restart_test.go` | `TestRestartMidRun` | run in flight (scenario `hold`) -> `Restart` -> run reads stopped/failed per `TaskBoard.Recover`, `RetryRun` works, no orphan worktree lock |
| | `TestRestartKeepsUserData` | custom scripts + collections (`CreateCollection`, `RenameCollection`, `Update`, `Move`), memory entries, mobile device token, ADE workflow saved via `SaveWorkflow` and read back via `WorkflowYaml` -> `Restart` -> all equal |
| `windowflow/windows_test.go` (new pkg) | `TestTwoWindowsIsolation` | two keys via `Windows.Ensure`; terminal open in each; `CloseWindow` hook on one closes only its PTYs (`Registry.WindowOf`); tabs saved per window stay per window; `Lifecycle.WindowFlushed` on one window only releases that window's close; settings change emits `kira:settings:changed` to both (recorder) |
| | `TestFocusSessionAcrossWindows` | ADE TUI session opened in window A, `FocusSession` from window B focuses A (window manager fake) and emits `open-session` to A only (native path asserted through the fake `EmitTo`) |
| | `TestOpenNewWindow` | `Windows.OpenNew` reaches `ShellHooks.OpenNewWindow` once, creates a row |
| `reviewflow/review_test.go` (new pkg) | `TestReviewSessionRoundTrip` | `review.target`, `review.open`, `review.snapshot`, `review.fileDiff` on a real branch diff; `review.session.save` with a comment; restart; `review.session.load` returns it; `review.comment.clear` empties it |
| `gitflow/credential_test.go` | `TestHTTPRemoteCredentialPrompt` | real `git http-backend` served by `net/http/cgi` with basic auth on `127.0.0.1`; push from the app -> askpass -> `GitCredential.Pending` lists the prompt -> `Provide` -> push succeeds; wrong password -> classified auth error, prompt not re-asked in a loop |
| `gitflow/errors_test.go` | `TestRepoDeletedWhileOpen`, `TestPushRejectedNonFastForward`, `TestWorktreeAddBranchCheckedOutElsewhere`, `TestGraphRevealCommit`, `TestWorktreeCancelPrepare`, `TestRepoList` | error classes reach the client as classified errors, never a raw `exec` string; `graph.revealCommit` returns the row of a commit outside the first page |
| `repoflow/workspace_test.go` (extend) | `TestCloseWorkspaceStopsSearch` | `CloseWorkspace` during a running search ends it, frees cat-file pair |
| `adeflow/errors_test.go` | `TestRunWithoutClaudeOnPath`, `TestRunClaudeExitsNonZero`, `TestWorkflowYamlInvalidThenFixed` | user-visible failure text on the board, retry after fix |
| `appflow/update_test.go` | `TestUpdateRefusedInDevBuild` | `InstallUpdate` and `CancelInstall` in a dev build: refuse cleanly, no child process |
| `editorflow/vsix_test.go` | `TestVsixStatusAndInstallWithoutCode` | `VsixStatus` and `InstallVsCodeIntegration` with no `code` CLI on PATH: classified "not found", no write outside the temp home |
| `memoryflow/semantic_test.go` | `TestInstallSemanticModelOffline` | `InstallSemanticModel` against a local `httptest` server serving a wrong-hash file: refused on SHA-256 mismatch, nothing left in the model store. Needs the model URL injectable; if it is not, add a harness-only seam (`appwire.Options`) in a follow-up after Stream C lands (C owns `appwire`), and record it in the findings file |
| `mobileflow/concurrency_test.go` | `TestPhoneAndDesktopWriteRace` | phone `reorder` and desktop `MoveBacklogItem` concurrently, `-race`: final order equals one of the serial orders, no lost item |

### 2.2 Studio (`apps/kira-studio/internal/flows/`)

| Package / file | Test | What it drives |
|---|---|---|
| `dbflow/sqlite_test.go` (new pkg) | `TestSQLiteJourney` | `Connections.Create` (SQLite file in temp dir), `Test`, `Connect`, `States`, `Tree.Children`/`Definition`/`SchemaColumns`/`KeyTypes` where applicable, `Queries.SaveConsole`/`ListConsole`/`Save`/`Update`/`Touch`, run a query through the existing query path, `HistoryRecord`/`HistoryList`, `Filters.Replace`, `MaskRules` upsert + `Counts` + `CorrelationKey` + `RegenerateKey` + `Remove`, `Disconnect`, `Duplicate`, `Reorder`, `Update`, `Remove`; restart; persisted rows equal |
| `dbflow/sqlite_test.go` | `TestSecretsStatusAndReveal` | `SecretsStatus` with `KIRA_INSECURE_SECRETS`, password round trip through `Update` three-state |
| `dbflow/postgres_test.go` | `TestPostgresJourney` | same journey against a real Postgres container (`KIRA_FLOW_DOCKER` gate, P232's skip message), complete suite only |
| `dbmcpflow/mcp_test.go` (new pkg) | `TestDbMcpApprovalFlow` | `DbMcp.SetEnabled(true)`; a real MCP client (`github.com/modelcontextprotocol/go-sdk`, already in `go.mod`, streamable HTTP with the token the header helper prints) calls `list_connections`, `run_query` (read), a write needing approval -> `PendingApprovals` lists it -> `DenyQuery` -> client gets the denial; again -> `ApproveQuery` -> executes; `Regenerate` -> old token 401 |
| | `TestInstallClaudeCodeWithoutCli` | `InstallClaudeCode` with no `claude` on PATH: `notFound` + copy command, nothing written in temp HOME |
| `apiflow/collections_test.go` (extend) | `TestMoveRenameGrpcItem` | `MoveItem` across collections, `Rename`, `SaveGrpcRequest`/`GetGrpcRequest` round trip, then `Export`/`Import` keeps them |
| `apiflow/variables_test.go` | `TestEnvironmentLifecycle` | `UpdateEnvironment`, `ReorderEnvironments`, `Reorder`, `DeleteEnvironment` while a request references a variable: next send resolves to the new active env; deleted env falls back cleanly |
| `apiflow/history_test.go` | `TestHistoryClear` | `ResponseHistory.Clear`, `GrpcHistory.Clear` after real sends |
| `windowflow/windows_test.go` (new pkg) | `TestStudioWindows` | `Windows.Ensure`, `SetMode`, `OpenNew`, `Tabs.Save` per window, `Layout.GetAll`, `Settings.GetAll`, `Lifecycle.Flushed`/`WindowFlushed`, docker + terminal close per window |
| `termflow/quickcommand_test.go` (extend) | `TestCustomScriptUpdateRemove` | `CustomScripts.Update`, `Remove` |
| `appflow/app_test.go` (new pkg) | `TestInfoAndKeepAwake` | `App.Info` fields, `KeepAwake.SetManual` against the fake driver, `Update.InstallUpdate`/`CancelInstall` refusal in dev build, `DataGrip.Scan` with a fake DataGrip config dir in temp HOME |

### 2.3 Concurrency cases (both apps, `-race`)

- Space `gitflow/concurrency_test.go` `TestParallelOpsOneRepo`: two git streams on one repo; commit
  and fetch at once; the repo session serializes; graph after both equals `git log`.
- Studio `httpflow/send_test.go` `TestConcurrentSendsSharedJar`: 20 parallel sends with cookies;
  jar consistent, no race report.

## 3. New `e2e-real` specs (real backend, real UI)

| File | Spec |
|---|---|
| `apps/kira-space/tests/e2e-real/journey-real.spec.ts` | first run: import repo, commit in UI, create ADE task, start run (fake claude), see it finish; reload page; state stays |
| `apps/kira-space/tests/e2e-real/restart-real.spec.ts` | kill and relaunch the server binary (`kira-space-server-test`) with the same home; tabs, active module, ADE board, settings survive. Needs a fixture `relaunch()`: add it to `fixtures.ts` (Stream A owns it) |
| `apps/kira-space/tests/e2e-real/multiwindow-real.spec.ts` | two pages with two window keys; terminal output only in its own page (server build broadcasts `EmitTo`, so assert by `terminalId` routing, per DEV_ENVIRONMENT note) |
| `apps/kira-studio/tests/e2e-real/restart-real.spec.ts` | API tabs, environments, history survive relaunch |
| `apps/kira-studio/tests/e2e-real/dbmcp-real.spec.ts` | enable DB MCP in Settings, a JSON-RPC `tools/call` POST from the spec (fetch, bearer token from the token file) for a write shows the approval dialog, approve, result arrives |

## 4. Coverage gate (cheap, robust: yes)

`apps/kira-space/internal/flows/coverage/coverage_test.go` and the Studio twin:

1. Boot the harness, walk `app.W.Bound()`, take `svc.Instance()`, list exported methods via
   `reflect` minus Wails lifecycle names (`ServiceStartup`, `ServiceShutdown`, `ServiceName`).
   This is exactly what Wails binds, no generated bindings needed.
2. Read every `*_test.go` under `apps/<app>/internal/flows/` (via `filepath.WalkDir` from the test's
   own dir) and match `\.<Method>\(`.
3. Space also checks the git router's registered request names if `gitrpc.Router` exposes them
   (check; if it does not, skip this half and say so in the result, no new export just for this).
4. Fail listing each `Service.Method` with no match and no line in `coverage/exempt.txt`
   (`Service.Method  reason`, one per line). Also fail on a stale exempt line (method gone or now
   covered).

Runs inside `test:flows:*` (no new script, no hook change). Known limit, stated in the file
comment: name match, not call-graph proof. Stream C adds bound services
(`AgentNotifyService`, `ClaudeUsageService`) with their own flow tests; after rebase the gate must
pass with them, which C's plans already require.

## 5. Flaky specs (fix the cause, not the retry count)

Repro first, each with `--repeat-each` under load, record the failure rate before and after in the
result section.

| Spec | Repro | Hypotheses to check in order |
|---|---|---|
| `apps/kira-space/tests/ui/repo-graph-paging.spec.ts:319` "columns resized wide never push the graph out of view" | `bunx playwright test --config=apps/kira-space/playwright.config.ts --project=ui repo-graph-paging -g "columns resized wide" --repeat-each=80 --workers=8` (P231: ~1/80, drag step timeout) | (a) drag issued before `CommitGrid` finished its post-resize rebuild (P235 F4 changed `setColumnWidth` rebuild): wait on a grid-ready signal, not time; (b) handle hit box moves during `steps` drag: assert handle position after each move; (c) product bug: resize rebuild drops pointer capture. Fix in `packages/git-ui` if (c) |
| `apps/kira-space/tests/e2e-real/ade-board-real.spec.ts` | `bun run test:e2e-real:space -- ade-board-real --repeat-each=30 --workers=4` | P233 note: git push negotiation flake, `fatal: expected 'acknowledgments'` warnings in helpers. Check the helper bare remote: same bare pushed concurrently by two tests? per-test bare dir; `protocol.version` mismatch between test git and server git; `git push` racing a `fetch` from the board's autofetch. Fix the shared cause in `support/` helpers |
| `apps/kira-space/tests/ui/ade-v2-panel.spec.ts:239` "dragging the handle persists the dragged width; a click persists nothing" | `--repeat-each=80 --workers=8` | `expect(widthWrites()).toHaveLength(0)` runs before a debounced write would land, so it can pass or fail by timing; the drag may also start before the panel settles. Assert the click case with `expect.poll` over a bounded window after a settled-layout signal; check that the click path really never schedules a write (product bug if it does, in `apps/kira-space/frontend/src/ade/v2/`) |

Also: P235 noted `TestResolveSource_CancelOnlyAffectsOwnCaller` (Studio) flaked once under load.
Repro with `go test -count=200 -race -run TestResolveSource_CancelOnlyAffectsOwnCaller` on its
package; fix if it reproduces, else record "no repro in 200 runs".

## 6. Findings loop

Every test that finds a product bug: commit it failing first with `t.Skip("P236 finding <id>:
...")` removed in the fixing commit, the P231 pattern. Findings file
`docs/v2.2/plans/P236-findings.md` (committed before the first fix, deleted at close-out). A fix
needing a file another stream owns (see SPEC stream table) is not made in Stream A: it stays in the
findings file, marked "after landing", and Stream A fixes it after the rebase onto the chapter
branch.

## 7. Docs

Stream A edits no doc file (Stream B owns `docs/DEV_ENVIRONMENT.md`, Stream C
`docs/ARCHITECTURE.md`). Test facts go in the P236 result section of SPEC (orchestrator close-out)
and file-level doc comments. After all streams land, the orchestrator spawns one doc pass for test
counts in `docs/ARCHITECTURE.md` "Testing".

## 8. Commits

1. `test(space): first-run, restart and window journeys` (journeyflow, windowflow).
2. `test(space): review session and credential prompt flows`.
3. `test(space): git, ade, editor, update error paths`.
4. `test(studio): sqlite journey, db mcp approval, windows`.
5. `test(studio): api collections, environments, history gaps`.
6. `test: e2e-real journeys and restart specs` (+ fixture `relaunch()`).
7. `test: bound-method coverage gate` (+ `exempt.txt` with reasons).
8. One `fix(...)` commit per root cause found; one per flaky spec.

## 9. Verification checklist (orchestrator)

- `git diff --stat a6637fbdf..HEAD` touches only Stream A paths (SPEC table).
- `ls apps/kira-space/internal/flows/{journeyflow,windowflow,reviewflow,coverage}`,
  `ls apps/kira-studio/internal/flows/{dbflow,dbmcpflow,windowflow,appflow,coverage}` exist.
- Coverage gate passes and is real: `CGO_ENABLED=1 go test ./apps/kira-space/internal/flows/coverage/ -v`
  prints the method count (152 + new); temporarily deleting one exempt line makes it fail (check by
  reading the test, or run once with a scratch edit, then `git checkout`).
- `wc -l apps/*/internal/flows/coverage/exempt.txt`: every line has a reason; no Studio DB method
  exempt without naming the `tests/ipc` fixture that covers it.
- Re-run the audit script (Appendix method): Space bound methods with no flow call drop from 20 to
  the exempt set only; Studio from 57 to the exempt set only.
- `bun run test:flows:space`, `bun run test:flows:studio`, `bun run test:flows:space:complete`,
  `bun run test:flows:studio:complete` (docker up), `-race` on the new packages.
- `bun run test:e2e-real:space`, `bun run test:e2e-real:studio` green.
- Flaky specs: result section quotes before/after failure rates from the `--repeat-each` runs; after
  is 0 in the stated run count.
- `bun run lint`, `bun run typecheck`, `bun run lint:dead`, `golangci-lint run ./...`,
  `go build ./...`, `go build -tags server ./apps/kira-space/...` clean.
- `P236-findings.md` deleted at close-out; every finding has a fix commit or a SPEC follow-up row.

## Appendix A: Space bound methods -> flow packages calling them (base tree)

- `adetaskservice`: AddBacklogItem (adeflow,mobileflow); AddExistingBranch (adeflow); AddFolder (adeflow); AddTaskRepo (**none**); Approve (adeflow,editorflow,mobileflow); ArchiveRisk (adeflow); ArchiveTask (adeflow); Backlog (adeflow,mobileflow); Board (adeflow,appflow,mobileflow); CandidateBranches (adeflow); CreateTask (adeflow,appflow,claudeflow,mobileflow); DeleteBacklogItem (adeflow); FocusSession (adeflow); ForcePush (adeflow); GitHubSyncApply (adeflow); GitHubSyncPlan (adeflow); ImportWorkflow (adeflow); LaunchReviewAgent (adeflow); LaunchStage (adeflow,claudeflow); MoveBacklogItem (adeflow); NewWorkflow (adeflow); OpenReviewWindow (adeflow); PromoteBacklogItem (adeflow); Prs (adeflow); ReadLog (adeflow,mobileflow); RecordMerge (adeflow); Refresh (adeflow,appflow); RemoveFolder (adeflow); Repos (adeflow,mobileflow,repoflow); RetryRun (adeflow); RetrySetup (adeflow); ReviewAgent (adeflow); ReviewWindowTarget (adeflow); SaveWorkflow (**none**); SaveWorkflowYaml (adeflow,appflow,claudeflow,mobileflow); Send (adeflow); Sessions (adeflow,mobileflow); SetFolderWatch (adeflow); SetPlan (adeflow); SetQueuedAfter (adeflow); SetTaskStage (**none**); SetTaskWorkflow (adeflow); StageDone (adeflow,mobileflow); StartBranch (adeflow,mobileflow); StartRun (adeflow,appflow,mobileflow); StopRun (adeflow); TakeOver (adeflow); UpdateBacklogItem (adeflow); UpdateRepo (adeflow); UpdateTask (**none**); ValidateWorkflowYaml (adeflow); WorkflowYaml (**none**); Workflows (adeflow,mobileflow)
- `codeworkspaceservice`: CancelSearch (repoflow); CloseWorkspace (**none**); ImportRepo (adeflow,appflow,claudeflow,mobileflow,repoflow); ListFiles (repoflow); ListRepos (repoflow); OpenWorkspace (repoflow); ReadDiff (repoflow); ReadFile (adeflow,appflow,claudeflow,gitflow,memoryflow,mobileflow,repoflow); RemoveRepo (repoflow); RenameRepo (repoflow); ReorderRepos (repoflow); RepoHeads (repoflow); RepoWorktreeLinks (repoflow); SetRepoColor (repoflow); Shutdown (appflow); StartSearch (repoflow)
- `customscriptsservice`: Create (memoryflow,termflow); CreateCollection (termflow); DeleteCollection (termflow); List (appflow,editorflow,termflow); Move (termflow); Remove (gitflow,repoflow); RenameCollection (**none**); Update (**none**)
- `filesservice`: ChooseFolder (repoflow)
- `gitclientsservice`: Approve (adeflow,editorflow,mobileflow); AttachPush (**none**); Deny (editorflow,mobileflow); InstallVsCodeIntegration (**none**); List (appflow,editorflow,termflow); PendingPairing (editorflow,mobileflow); Revoke (editorflow,mobileflow); VsixStatus (**none**)
- `gitcredentialservice`: AttachPush (**none**); Pending (**none**); Provide (**none**)
- `githubservice`: OpenPullRequestURL (appflow)
- `keepawakeservice`: SetManual (appflow); Status (appflow,mobileflow,termflow)
- `layoutservice`: GetAll (appflow,flowharness); Set (appflow,gitflow,mobileflow,termflow)
- `lifecycleservice`: Flushed (appflow); WindowFlushed (**none**)
- `linkservice`: OpenExternal (appflow)
- `memoryimportservice`: Cancel (appflow,memoryflow); Choose (memoryflow); Create (memoryflow,termflow); Discard (memoryflow); Dismiss (memoryflow); Job (memoryflow); Jobs (memoryflow); Pause (memoryflow); Resume (memoryflow); RetryFailed (memoryflow); RetryFile (memoryflow); Start (memoryflow)
- `memoryservice`: History (memoryflow); InstallClaudeCode (memoryflow); InstallSemanticModel (**none**); McpStatus (memoryflow); Recent (appflow,gitflow,memoryflow); RetrySemantic (memoryflow); Search (memoryflow); SemanticStatus (memoryflow); Store (memoryflow)
- `mobileaccessservice`: Approve (adeflow,editorflow,mobileflow); AttachPush (**none**); Deny (editorflow,mobileflow); Devices (mobileflow); ForgetNetwork (mobileflow); LaunchOpened (mobileflow); PendingPairing (editorflow,mobileflow); ReclaimTerminal (mobileflow); Revoke (editorflow,mobileflow); SetAgentInputEnabled (mobileflow); SetDevicePermissions (mobileflow); SetEnabled (mobileflow); SetPort (mobileflow); Status (appflow,mobileflow,termflow); TerminalHolds (mobileflow); TrustCurrentNetwork (mobileflow)
- `opsservice`: Cancel (appflow,memoryflow); Recent (appflow,gitflow,memoryflow)
- `settingsservice`: GetAll (appflow,flowharness); Set (appflow,gitflow,mobileflow,termflow)
- `tabsservice`: List (appflow,editorflow,termflow); Save (appflow)
- `terminalservice`: AgentSessions (mobileflow,termflow); Close (editorflow,flowharness,gitflow,mobileflow,termflow); DefaultCwd (termflow); Open (adeflow,claudeflow,mobileflow,termflow); Resize (termflow); Write (editorflow,gitflow,mobileflow,repoflow,termflow)
- `updateservice`: CancelInstall (**none**); InstallUpdate (**none**); Status (appflow,mobileflow,termflow)
- `windowsservice`: Ensure (appflow); OpenNew (**none**); SetMode (appflow)

## Appendix B: Studio bound methods -> flow packages calling them (base tree)

- `appservice`: Info (**none**)
- `collectionsservice`: CreateCollection (apiflow,grpcflow,httpflow,termflow); CreateGrpcItem (apiflow); CreateItem (apiflow); Delete (apiflow); Export (apiflow); GetGrpcRequest (**none**); GetRequest (apiflow); Import (apiflow); List (apiflow,grpcflow,httpflow,termflow); MoveItem (**none**); Rename (**none**); SaveGrpcRequest (**none**); SaveRequest (apiflow)
- `connectionsservice`: Connect (**none**); Create (termflow); Disconnect (**none**); Duplicate (**none**); List (apiflow,grpcflow,httpflow,termflow); Remove (**none**); Reorder (**none**); Reveal (apiflow); SecretsStatus (**none**); States (**none**); Test (**none**); Update (**none**)
- `customscriptsservice`: Create (termflow); CreateCollection (apiflow,grpcflow,httpflow,termflow); DeleteCollection (termflow); List (apiflow,grpcflow,httpflow,termflow); Move (termflow); Remove (**none**); RenameCollection (termflow); Update (**none**)
- `datagripservice`: Import (apiflow); Scan (**none**)
- `dbmcpservice`: ApproveQuery (**none**); DenyQuery (**none**); InstallClaudeCode (**none**); PendingApprovals (**none**); Regenerate (**none**); SetEnabled (**none**); Status (dockerflow)
- `dockerservice`: Containers (dockerflow); Contexts (dockerflow); ExecClose (dockerflow); ExecOpen (dockerflow); ExecResize (dockerflow); ExecWrite (dockerflow); Images (dockerflow); Inspect (dockerflow); InspectContainer (dockerflow); LogsClose (dockerflow); LogsOpen (dockerflow); Networks (dockerflow); Restart (apiflow,dockerflow,termflow); Start (dockerflow); StatsSubscribe (dockerflow); StatsUnsubscribe (dockerflow); Status (dockerflow); Stop (dockerflow); Unwatch (dockerflow); UseContext (dockerflow); Volumes (dockerflow); Watch (dockerflow)
- `filesservice`: ChooseFolder (termflow); ChooseOpen (apiflow); ChooseSave (apiflow)
- `filtersservice`: List (apiflow,grpcflow,httpflow,termflow); Replace (**none**)
- `grpchistoryservice`: Adopt (apiflow); Clear (**none**); Delete (apiflow); Get (apiflow,grpcflow,httpflow); List (apiflow,grpcflow,httpflow,termflow)
- `grpcservice`: Call (apiflow,grpcflow); Describe (grpcflow)
- `httpservice`: ClearCookies (httpflow); Cookies (httpflow); DeleteCookie (httpflow); Send (apiflow,flowharness,httpflow)
- `keepawakeservice`: SetManual (**none**); Status (dockerflow)
- `layoutservice`: GetAll (**none**); Set (httpflow)
- `lifecycleservice`: Flushed (**none**); WindowFlushed (**none**)
- `maskrulesservice`: CorrelationKey (**none**); Counts (**none**); List (apiflow,grpcflow,httpflow,termflow); RegenerateKey (**none**); Remove (**none**); Upsert (apiflow,grpcflow,httpflow)
- `opsservice`: Cancel (grpcflow,httpflow); Recent (apiflow,grpcflow,httpflow)
- `queriesservice`: Delete (apiflow); HistoryList (**none**); HistoryRecord (**none**); List (apiflow,grpcflow,httpflow,termflow); ListConsole (**none**); Save (**none**); SaveConsole (**none**); Touch (**none**); Update (**none**)
- `responsehistoryservice`: Adopt (apiflow); Clear (**none**); Delete (apiflow); Get (apiflow,grpcflow,httpflow); List (apiflow,grpcflow,httpflow,termflow)
- `schemaservice`: Get (apiflow,grpcflow,httpflow); Set (httpflow)
- `settingsservice`: GetAll (**none**); Set (httpflow)
- `tabsservice`: List (apiflow,grpcflow,httpflow,termflow); Save (**none**)
- `terminalservice`: Close (dockerflow,grpcflow,httpflow,termflow); DefaultCwd (termflow); Open (flowharness,termflow); Resize (termflow); Write (dockerflow,termflow)
- `treeservice`: Children (**none**); Definition (**none**); Describe (grpcflow); Invalidate (**none**); KeyTypes (**none**); SchemaColumns (**none**)
- `updateservice`: CancelInstall (**none**); InstallUpdate (**none**); Status (dockerflow)
- `variablesservice`: ApplyBulk (apiflow); CreateEnvironment (apiflow,grpcflow,httpflow); Delete (apiflow); DeleteEnvironment (**none**); DuplicateEnvironment (apiflow); History (apiflow); List (apiflow,grpcflow,httpflow,termflow); ListEnvironments (apiflow); Reorder (**none**); ReorderEnvironments (**none**); Reveal (apiflow); RevealHistory (apiflow); SetActiveEnvironment (apiflow,httpflow); UpdateEnvironment (**none**); Upsert (apiflow,grpcflow,httpflow)
- `windowsservice`: Ensure (**none**); OpenNew (**none**); SetMode (**none**)
