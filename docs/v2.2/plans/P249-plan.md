# P249 plan: split e2e-real at the IPC boundary, Claude suite separate

Base: `v2.0` at `bb9f55fd0`. Planned against current tree (re-read source, CodeGraph discovery).

SPEC row: split every e2e-real scenario into a backend flow test plus a frontend UI spec asserting
same result; mock responses guarded against drift from real Go shapes; e2e-real only for what cannot
be split; real-claude tests become own suite (own directory, own `bun run` script, no build tag or
env flag); update `docs/DEV_ENVIRONMENT.md` table and CLAUDE.md bullet. Why now: full e2e-real/UI/flow
runs are slow under load; split makes validation cheaper and more targeted.

## 1. Current state

- Two Playwright projects named `e2e-real`: `apps/kira-studio/playwright.config.ts` and
  `apps/kira-space/playwright.config.ts`, `workers: 2`, chromium, `testDir: ./tests/e2e-real`.
- Fixtures (`apps/*/tests/e2e-real/fixtures.ts`) build per worker: `scripts/setup.sh`,
  `bun run build:test:<app>`, `go build -tags server`, `fakeclaude`; spawn one server per test on a
  free port and temp `KIRA_HOME`; `packages/workbench/src/testing/e2eReal.ts` holds the build lock,
  `bound()` and `waitForHealth`.
- Scripts: `test:e2e-real:studio` (runs `bun run build:studio` first, then the fixture rebuilds
  `build:test:studio` into the same `frontend/dist`: wasted build), `test:e2e-real:space`.
- Not in CI (`pr.yml` runs `test:ui:studio`, `test:ipc:fe:studio`, `test:visual:studio`,
  `test:unit`, `test:go`) and not in hooks (pre-commit lint/typecheck, pre-push `go build ./...`,
  `lint:go`, `lint:dead`).
- Backend tier: `apps/*/internal/flows/*` (flowharness boots real composition root, real SQLite/
  git/PTY/HTTP/gRPC/Docker, fake OS seams and fake claude); `flowtest.Complete` gates the complete
  suite (`KIRA_FLOW_COMPLETE=1`). Frontend tier: `apps/*/tests/ui` (real Vue, real Wails runtime
  JS, bound calls answered from `tests/ui/support/mockRuntime.ts` hand-written fixtures).
- No contract-drift guard today: UI mock responses are hand-typed. Only precedent is
  `gitflow.TestFixtures_CaptureGraphChunkFrame` (writes a golden graph chunk frame with
  `KIRA_GIT_FIXTURES=write`) plus `apps/kira-studio/tests/unit/frame-golden.spec.ts`.
- Real `claude` suite (P237): build tag `realclaude` + `KIRA_REAL_CLAUDE=1` on
  `apps/kira-space/internal/realclaude/*` (7 files), `apps/kira-studio/internal/realclaude/*`
  (4 files), `internal/memory/smoke_test.go`, `internal/memory/importer/smoke_test.go`. The
  importer smoke relies on `internal/memory/importer/engine_test.go`'s `TestMain` serving
  `memory-mcp` under `KIRA_TEST_MEMORY_MCP=1`, and on `internal/memory/importer/testdata/smoke/`.
- No Playwright spec runs the real `claude` (every e2e-real agent path uses `fakeclaude`). Grep
  confirmed; nothing to move on the Playwright side.

## 2. Claude suite: new layout

Requirement: own directory and package, own `bun run` script, opt-in by absence from every default
command, no build tag, no env flag. A plain directory inside the root module fails that: `go test
./...` (CI `test:go`) would compile and run it. Solution: one nested Go module per app. Go's `./...`
and golangci-lint's package loading stop at a nested `go.mod`, so default commands never see it.
Internal-package visibility follows import path, not module (x/tools' nested `gopls` module imports
`golang.org/x/tools/internal/...` the same way), so a module rooted under `apps/<app>/` may import
`apps/<app>/internal/flowharness` and root `internal/...`.

Layout:

- `apps/kira-space/tests/claude/` — module `github.com/kirathecat/kira-studio/apps/kira-space/tests/claude`,
  package `claude`. `go.mod`: `go 1.27.1`, `require github.com/kirathecat/kira-studio v0.0.0`,
  `replace github.com/kirathecat/kira-studio => ../../../..`; `go.sum` from `go mod tidy`.
  Files: every `apps/kira-space/internal/realclaude/*_test.go` (build tag dropped, env gate dropped),
  plus `memory_gate_test.go` (from `internal/memory/smoke_test.go`, rewritten against exported
  `memory` API; local `facts` helper copied, it is unexported test code in `service_test.go`) and
  `memory_import_test.go` (from `internal/memory/importer/smoke_test.go`, exported `importer` API);
  tests renamed `TestSmokeRealClaude` -> `TestMemoryGate`, `TestSmokeImport` -> `TestMemoryImport`.
  `testdata/smoke/` moves here from `internal/memory/importer/testdata/smoke/` (only the smoke
  reads it). `TestMain` keeps `flowharness.Main` and gains the `KIRA_TEST_MEMORY_MCP=1` ->
  `memorycli.Run` branch the importer smoke needs; `engine_test.go` drops that branch (dead once the
  smoke leaves).
- `apps/kira-studio/tests/claude/` — module `.../apps/kira-studio/tests/claude`, package `claude`,
  same `go.mod` shape. Files: every `apps/kira-studio/internal/realclaude/*_test.go`, tag and env gate
  dropped.
- Delete `apps/*/internal/realclaude/`, `internal/memory/smoke_test.go`,
  `internal/memory/importer/smoke_test.go`.
- Gate left: the package preflight (no `claude` on `PATH` or `claude -p` cannot run under the temp
  `HOME` -> skip). That is an availability check, not an opt-in flag; keep it.
- Never add a root `go.work`: workspace mode would pull the nested modules into `./...`.

Scripts (root `package.json`; bun appends extra args, `go test` accepts flags after packages):

- `test:claude:space`: `cd apps/kira-space/tests/claude && CGO_ENABLED=1 go test -v -timeout 15m ./...`
- `test:claude:studio`: same for Studio.
- `test:claude`: both, sequential.
- Per area: `bun run test:claude:space -run 'TestAdeHeadlessRun|...'`.
- `lint:claude`: `golangci-lint run` inside each nested module (no tokens spent; compiles test code).

Docs:

- `docs/DEV_ENVIRONMENT.md` section renamed "Real `claude` tests"; gate bullets replaced by layout
  and "opt-in by absence"; every table row becomes a `bun run test:claude:<app> -run '...'` command;
  memory rows point at `test:claude:space -run 'TestMemoryGate|TestMemoryImport'`; lint line becomes
  `bun run lint:claude`. Spend and runtime figures stay.
- `CLAUDE.md` bullet "Real `claude` tests are opt-in and cost tokens": point at the renamed section
  and `bun run test:claude*`; same rule, never in hooks or CI.
- Prior chapters' plans keep old commands (history, not live docs).

## 3. Contract-drift guard

One JSON fixture per split scenario, written and asserted by the Go flow test, consumed by the UI
spec as its mock response. Go shape changes fail the flow test; regenerating the file changes what
the UI spec sees, so a stale UI assumption fails there.

- Go: `internal/flowtest/contract.go`: `Contract(t, dir, scenario, key string, got any)`. Marshal
  `got` with `encoding/json` (what Wails uses for bound results), normalise, compare to
  `<dir>/<scenario>.json` key `key` (`Service.Method`, or `Service.Method#n` for a repeated call)
  using `go-cmp` (already direct dep) for the diff. `KIRA_CONTRACT=write` rewrites the file (mirrors
  `KIRA_GIT_FIXTURES=write`); a missing file or key fails with that hint. Options: `Mask(keys...)`
  for volatile fields the automatic rules miss (durations, pids, ports).
- Normalisation, automatic: UUIDs -> `<id:n>` numbered by first appearance (keeps equality between
  fields); RFC3339 timestamps -> `<time:n>`; `app.Home`/`app.KiraHome`/temp-dir prefixes ->
  `<home>`/`<kira>`/`<tmp>`; flow-server base URLs -> `<http>`/`<https>`/`<grpc>`.
- Each `flowharness` gets `(*App).Contract(t, scenario, key, got)` resolving `dir` to
  `apps/<app>/tests/contract/` via `runtime.Caller`, and filling path/URL substitutions.
- TS: `packages/workbench/src/testing/ui/contract.ts`: `contract(dir, scenario, key, schema?)`
  hydrates placeholders deterministically (`<id:3>` -> `00000000-0000-4000-8000-000000000003`,
  `<time:n>` -> fixed base + n s, paths -> `/home/test/...`, URLs -> the UI spec's own fake
  origin) and, when a `packages/shared/domain` zod schema exists for that shape, parses through
  it (TS type drift fails the UI spec too). Each app's `tests/ui/support/` re-exports a bound
  `contract(scenario, key, schema?)`.
- Library check: Go golden libraries (`gotest.tools/v3/golden`, `goldie`) compare bytes only; the
  requirement here is cross-language normalised fixtures with placeholder equality, which none
  offers. The compare/diff itself reuses `go-cmp`.
- Test bar: the normaliser (id numbering across nested values, several interacting rules) gets
  one table test `internal/flowtest/contract_test.go`. Nothing else.

Contract scope per scenario: only the bound results the scenario's assertions depend on (column
"contract keys" below). Event payloads the UI reacts to (run changed, list changed) go through the
same helper: `app.Events` records them, `Contract` stores them under `event:<channel>#n`.

## 4. Inventory and disposition

Legend: Split = delete the e2e-real test after its backend flow test and frontend UI spec both
assert the same result with a shared contract fixture. Stay = cannot be split; reason given.
"Exists" = a counterpart test covering the scenario today (implementer confirms it asserts the
same result and adds the contract wiring); "new" = write it. Flow tests run in the default
`test:flows:*` unless marked complete (Docker or slow; `flowtest.Complete` / `KIRA_FLOW_DOCKER`).

### 4.1 Kira Studio (`apps/kira-studio/tests/e2e-real/`, 17 specs, 27 tests)

1. `api-boot-real` (1). Seed environment via bound call, UI send resolves `{{var}}` against real
   server; response pane plus server record. Proves variable resolution end to end. Split. Backend:
   `apiflow.TestVariablePrecedence` + `httpflow` send (exists; add assertion on server-recorded
   URL). Frontend: `tests/ui/http-variables.spec.ts` (exists). Contract keys: `HttpService.Send`,
   `VariablesService.List`.
2. `api-curl-real` (1). Import curl, send, copy as curl, real `curl` replays, server sees same
   request. Split via shared string: frontend `tests/ui/http-curl.spec.ts` asserts the clipboard
   text of copy-as-curl equals the contract's `curl:generated` string (generator is TS,
   `packages/api-core/src/http/curl/generate.ts`); backend new `httpflow.TestCurlReplayMatchesSend`
   sends the parsed request via `HttpService.Send`, runs real `curl` (skip without it) on the
   contract string against the flow server, asserts both recorded requests equal. Contract keys:
   `curl:generated` (owned by the Go side, reproduced by the UI spec; D6), `HttpService.Send`.
   Note: the Go flow can only check the string it is given, so the UI half is what catches a
   generator change.
3. `api-grpc-real` (3). Reflection describe, unary with header/trailer, server stream message by
   message, Stop. Split. Backend: `grpcflow.TestDescribeReflection`, `TestUnaryMetadataAndStatus`,
   `TestServerStreamAndCancel` (exist). Frontend: `tests/ui/grpc-request.spec.ts` (exists; add
   stream-stop case if absent). Contract keys: `GrpcService.Describe`, `GrpcService.Call`, stream
   events.
4. `api-http-real` (1). Secret resolves on wire; history row and op log keep placeholder. Split.
   Backend: `httpflow.TestSendResolvesSecretsOnlyOnTheWire` (exists). Frontend: `http-history`,
   `api-secret-reveal-isolation` (exist; add history-row placeholder assertion if absent). Contract
   keys: `HttpService.Send`, `ResponseHistoryService.List`, `OpsService.List`.
5. `api-postman-real` (1). Import via menu builds tree, imported request sends, export re-readable.
   Split. Backend: `apiflow.TestPostmanImportSendExport` (exists). Frontend:
   `tests/ui/collections.spec.ts` (exists; add import-tree-from-contract case). Contract keys:
   `CollectionsService.Import`, `CollectionsService.Tree`, `CollectionsService.Export`.
6. `automations-real` (3). Script runs in its folder -> Succeeded; failing script shows exit status;
   Stop -> cancelled. Split. Backend: `termflow.TestScriptRunLifecycle`, `TestScriptRunNonZeroExit`,
   `TestScriptRunStopAndClose`, `TestScriptFolders` (exist). Frontend: `automations-runs`,
   `automations-module` (exist). Contract keys: `ScriptRunsService.Get` per outcome, run events.
7. `automations-recurring-real` (2). Due recurring script asks, Run starts headless -> Succeeded;
   Run now starts at once. Real clock. Split (fake clock in flows is the better backend half).
   Backend: `termflow.TestScheduleConfirm`, `TestRunScheduleNow` (exist). Frontend:
   `tests/ui/automations-recurring.spec.ts` (exists). Contract keys: `ScriptRunsService.SchedulePreview`,
   `ConfirmAccept`, `RunScheduleNow`, confirm event. P246 edits this spec (main-window page); see §8.
8. `automations-smart-real` (2). Smart script to Succeeded / Failed with agent summary (fake claude).
   Split. Backend: `termflow.TestSmartScript` (exists; confirm both outcomes). Frontend:
   `tests/ui/automations-smart.spec.ts` (exists). Contract keys: `ScriptRunsService.Get`,
   `ReadLog`.
9. `dbmcp-real` (1). Real MCP client writes to exposed SQLite connection, call parks on UI approval
   dialog, Approve releases it, row lands. Split. Backend: `dbmcpflow.TestDbMcpApprovalFlow`
   (exists, real MCP client over HTTP). Frontend: new `tests/ui/dbmcp-approval.spec.ts`
   (`DbMcpApprovalDialog.vue` has no UI spec today): pending-approval event from contract shows the
   dialog with statement and connection, Approve sends the answer call with the contract's id.
   Contract keys: approval event payload, `DbMcpService.Answer` args. P246 edits this spec; see §8.
10. `docker-real` (1). Compose-labelled container listed, logs stream, exec, stop. Stay: real
    container engine plus real exec PTY through xterm (busybox Enter-after-CPR quirk is only visible
    here). Backend already split (`dockerflow` complete); this stays the one Docker spot-check.
11. `mariadb-real` (2). C1b keyset paging over `big_rows`; MariaDB + Kafka together survive reload.
    Stay: real containers; only coverage of Kafka StreamPage and two native kinds in one app.
12. `multiwindow-real` (1). Two pages, one backend, each keeps own tabs. Stay: real window-key
    routing over the server build's broadcast `EmitTo`.
13. `postgres-real` (3). Round-trip through real bridge; keyset paging forward/back; P248 paste env
    lines fixes stale password. Tests 1 and 2 stay (real container, network adapter anchor). Test 3
    splits: backend `dbflow.TestPostgresJourney` gains a paste-credentials step (complete, Docker);
    frontend `tests/ui/connection-paste-credentials.spec.ts` (exists; add reconnect-after-update
    case). Contract keys: `ConnectionsService.Update`, `Connect`.
14. `restart-real` (1). SIGKILL + relaunch, environments and active one survive. Split. Backend:
    `apiflow.TestRestartKeepsApiState` (exists). Frontend: UI boot with contract-derived
    environments snapshot shows active environment (add to `http-variables.spec.ts` or
    `api-ui-consistency.spec.ts`). Contract keys: `VariablesService.Environments`.
15. `sqlite-real` (1). Real SQLite through real dialog, bridge, tree, rows. Stay: Studio's
    Docker-free wiring anchor; the only proof the built bundle, generated bindings, Wails runtime
    transport and FlatBuffers page frames reach real Go services. One anchor per app is what a split
    cannot replace.
16. `terminal-real` (3). New terminal tab runs command; script in picked folder; keystrokes one by
    one arrive in order. Tests 1-2 split: backend `termflow.TestShellTab`, `TestScriptInPickedFolder`
    (exist); frontend `automations-module.spec.ts` (exists). Test 3 stays: ordering across real
    async writes over the real transport; a mock bridge serialises calls and cannot reorder them.
17. (P246, in flight) `prompts-two-windows-real` (1). Stay: real two-window routing (same class as
    `multiwindow-real`).

Studio after: `docker-real` 1, `mariadb-real` 2, `multiwindow-real` 1, `postgres-real` 2,
`sqlite-real` 1, `terminal-real` 1 (keystrokes) = 8 tests in 6 specs (+1 from P246).

### 4.2 Kira Space (`apps/kira-space/tests/e2e-real/`, 23 specs, 32 tests)

1. `ade-automation-real` (2). Smart script in task worktree: Running chip then Succeeded; step waits
   for running automation. Split. Backend: `adeflow.TestAutomationRun`, `TestAutomationStep`
   (exist). Frontend: `ade-v2-automations.spec.ts` (exists). Contract keys: `AdeService.Task`,
   `ScriptRunsService.List{taskId}`.
2. `ade-board-real` (1). Refresh all fetches repo with remote, rescans one without. Split. Backend:
   `adeflow.TestRefreshDefaultSettings` (exists; confirm both repo kinds). Frontend:
   `ade-v2-plan.spec.ts` (exists, has Refresh all). Contract keys: `AdeService.RefreshAll`, board
   event.
3. `ade-rebase-real` (3). New task on develop starts at origin/develop; Change base rebases in
   background; conflict reported, pending, Abort restores tip. Split. Backend:
   `adeflow.TestTaskBase`, `TestRebaseRun` (exist; confirm conflict + abort). Frontend:
   `ade-v2-base-rebase.spec.ts` (exists). Contract keys: `AdeService.ChangeBase`, rebase events,
   `AdeService.AbortRebase`.
4. `ade-review-open-real` (1). Real commits drive Review code; click opens review window. Split.
   Backend: `adeflow.TestReviewOpenFacts` (exists). Frontend: `ade-v2-review-open.spec.ts`
   (exists). Contract keys: review-open facts call.
5. `ade-run-real` (1). Run finishes step 1, waits for approval on step 2. Split. Backend:
   `adeflow.TestRunLifecycle` (exists). Frontend: `ade-v2-run.spec.ts` (exists). Contract keys:
   `AdeService.Task`, run events.
6. `ade-task-real` (1). Run gives task a real worktree; archive removes it. Split. Backend:
   `adeflow.TestRunLifecycle`, `TestArchiveRisk` (exist). Frontend: `ade-v2-archive.spec.ts`
   (exists). Contract keys: `AdeService.Task`, `AdeService.Archive`.
7. `automations-real` (3). Same as Studio 4.1.6 on Space. Split. Backend: `termflow`
   `TestScriptRunLifecycle`, `TestScriptRunNonZeroExit`, `TestScriptRunStopAndClose` (exist).
   Frontend: `automations-runs.spec.ts`, `automations-scripts.spec.ts` (exist).
8. `automations-recurring-real` (2). Same as 4.1.7 on Space. Split. Backend: `termflow`
   `TestScheduleConfirm`, `TestRunScheduleNow` (exist). Frontend: `automations-recurring.spec.ts`
   (exists). P246 edits this spec; see §8.
9. `automations-smart-real` (2). Same as 4.1.8. Split. Backend: `termflow.TestSmartScriptSpace`
   (exists). Frontend: `automations-smart.spec.ts` (exists).
10. `boot-real` (1). Boot real server, import real repo, open graph. Stay: Space's wiring anchor
    (same reason as Studio `sqlite-real`: bundle, bindings, runtime transport, git stream frames).
11. `commands-real` (1). Collection and script moved into it survive reload. Split. Backend:
    `termflow.TestCollectionsMoveAndDelete` (exists). Frontend: `automations-scripts.spec.ts`
    (exists; add boot-from-contract snapshot case). Contract keys: `CustomScriptsService.List`.
12. `git-checkout-stash-real` (1). Blocked checkout auto-stashes; stash list; Pop restores on origin
    branch. Split. Backend: `gitflow.TestCheckoutDirtyAutostash`, `TestStashFlows` (exist).
    Frontend: `repo-branch-picker.spec.ts` (exists; add autostash notice + Pop case if absent).
    Contract keys: git RPC `checkout` result, `stash.list`.
13. `git-commit-detail-real` (1). Merge and rename commit file lists equal git name-status; file
    opens diff. Split. Backend: `gitflow.TestCommitDetailAndDiff`,
    `TestCommitDetailMergeParentSelector` (exist; assert against `git diff --name-status`). Frontend:
    new `repo-commit-detail.spec.ts` (no UI spec renders the detail file list today). Contract keys:
    `commit.detail` for the merge and rename commits, `diff.read`.
14. `git-graph-real` (1). 5600-commit history pages to git's count, node on every row, resized
    columns survive Load more. Split. Backend: `gitflow.TestGraphPagesToEnd`,
    `TestGraphLoadMoreHonorsStoredPageSize` (exist). Frontend: `repo-graph-paging.spec.ts` with
    `graphPagingFixture.ts` (exists; add column-resize-survives-Load-more if absent). Drift guard
    here is the existing binary chunk golden (`TestFixtures_CaptureGraphChunkFrame`); turn it from
    write-only into compare-by-default with the same `KIRA_CONTRACT=write` switch (D9).
15. `git-remote-real` (1). Fetch, Pull, Push against real bare remote that a second clone pushes to;
    ahead/behind marks; Operations panel. Split. Backend: `gitflow.TestRemoteFetchPullPush` (exists).
    Frontend: `repo-graph-refresh.spec.ts`, `operations.spec.ts` (exist; add ahead/behind from
    contract). Contract keys: `branch.list` (ahead/behind), ops events.
16. `git-review-real` (2). Review comment persists across reload; reloaded Review pane compares
    without graph tab. Split. Backend: `reviewflow.TestReviewSessionRoundTrip`,
    `TestCommentsOrderedByFileThenLine` (exist). Frontend: `repo-review-interaction.spec.ts`
    (exists; add reload-restores-comment and no-graph-tab cases). Contract keys: review session and
    comment list calls.
17. `journey-real` (1). Import, new commit, ADE run to done, reload keeps all. Split. Backend:
    `journeyflow.TestFirstRunJourney`, `TestRestartKeepsUserData` (exist). Frontend: each step has
    its own spec (`repos-dialog`, `repo-graph-refresh`, `ade-v2-add`, `ade-v2-run`); no new journey
    UI spec (D7). Contract keys: none new.
18. `memory-real` (1). Memory added through gate listed and found by search. Split. Backend:
    `memoryflow.TestStoreThroughGate` (exists). Frontend: `memory-module.spec.ts` (exists). Contract
    keys: `MemoryService.Store`, `MemoryService.Search`.
19. `multiwindow-real` (1). Terminal output reaches only owning page. Stay: real window-key
    filtering over broadcast `EmitTo`.
20. `repos-dialog-real` (2). Add repo through dialog, rename, colour, browse, open file; code search
    hits reach window. Split. Backend: `repoflow.TestImportViaFolderPicker`, `TestBrowseReadDiff`,
    `TestCodeSearch` (exist). Frontend: `repos-dialog.spec.ts`, `repo-workspace.spec.ts`,
    `repo-file-tree.spec.ts` (exist). Contract keys: `CodeWorkspaceService.ImportRepo`, `ListFiles`,
    `ReadFile`, search events.
21. `restart-real` (1). Repos, ADE board, settings survive SIGKILL relaunch. Split. Backend:
    `journeyflow.TestRestartKeepsUserData` (exists). Frontend: boot from contract snapshots shows
    repos, board and setting (add to `modules.spec.ts`). Contract keys: `CodeWorkspaceService.ListRepos`,
    `AdeService.Board`, `SettingsService.GetAll`.
22. `settings-git-path-real` (1). Bad Git path blocks graph naming it; clearing recovers. Split.
    Backend: `appflow.TestGitPathSettingEverywhere` (exists). Frontend: `repo-graph-failures.spec.ts`
    (exists; add bad-git-path error naming the path, then recovery). Contract keys: graph open error,
    `SettingsService.Set`.
23. `terminal-real` (1). Keystrokes one by one in order. Stay (same reason as Studio 4.1.16 test 3;
    separate app wiring of the shared store).
24. (P246, in flight) `prompts-two-windows-real` (1). Stay (two-window routing).

Space after: `boot-real` 1, `multiwindow-real` 1, `terminal-real` 1 = 3 tests in 3 specs (+1 from
P246).

Method names above are the current bound names as best read from the tree; the implementer
confirms each against `apps/*/frontend/bindings/**` before writing a contract key.

## 5. e2e-real after split

- Same project name, configs, fixtures and support files; delete support files no remaining spec
  imports (expected: Space `support/{ade,routes,memoryGate,gate-accept.json,gitRepo}` if unused,
  Studio `support/kafka.ts` stays for `mariadb-real`; `knip` confirms).
- `test:e2e-real:studio` drops the leading `bun run build:studio &&` (fixture already builds the
  hooks-enabled bundle into the same `dist`).
- Config comments state the rule: e2e-real holds only real containers, real window routing, real
  transport ordering, one wiring anchor per app.
- `docs/ARCHITECTURE.md` e2e-real sections (around "e2e-real tier (Playwright)" and the Studio
  "deliberately small" paragraph) list the remaining specs and the split rule; mention
  `tests/contract/`.
- `docs/DEV_ENVIRONMENT.md` "Kira Studio/Space flow suites": add `KIRA_CONTRACT=write` regen
  command; drop notes about deleted specs (`terminal-real` HOME note stays).

## 6. Runtime and cost

Estimates, not measured (decision does not hinge on exact numbers; P236 result: 19 tests each,
Space 1.4-1.5 min, Studio 1.7-2.7 min, idle machine).

- Before: Space 32 tests ~2.5-4 min, Studio 27 tests ~3-5 min (Postgres, MariaDB, Kafka, Docker
  dominate), each plus ~1-2 min build; Studio pays one extra frontend build (~30-60 s). Under load
  average 30+: x2-3 and the usual timeouts. Every UI-visible change today needs both suites.
- After: Space 3 tests ~1-1.5 min incl. build; Studio 8 tests ~2-3 min incl. build, minus the
  redundant build. Moved assertions cost seconds in `test:flows:*` (in-process, no browser, no
  build) and ~2-5 s per UI test in the fully parallel `ui` project.
- Targeting: a change now runs its area's flow package (`go test ./apps/kira-space/internal/flows/adeflow/`)
  and the matching UI spec, not a full e2e-real run.
- Claude suite: unchanged spend (Space ~0.03 USD + memory few cents + import 0.14 USD; Studio
  <0.01 USD) and time (Space ~75 s, Studio ~12 s); only the commands change.

## 7. Implementation shape

One sequential Sonnet implementer. Streams considered: A (Claude suite) and B (split) are logically
independent but both edit `package.json` and `docs/DEV_ENVIRONMENT.md`, so file ownership is not
disjoint; A is also small. No split.

Ordered commits (Conventional Commits; fast checks per commit: `bun run lint`, `bun run typecheck`,
`go vet` on touched packages, `lint:go`; expensive suites once at the end):

1. `test!: move real claude tests into their own modules` — two nested modules, files moved, tags
   and env gates removed, memory smokes moved with `testdata/smoke`, `engine_test.go` MCP branch
   removed, old dirs deleted, `test:claude*` and `lint:claude` scripts. Verify: `go vet ./...` and
   `go test -run '^$' ./...` inside each module compile; root `go test ./...` lists no `claude`
   package; `bun run lint:claude` clean.
2. `docs: claude suite commands` — DEV_ENVIRONMENT section and table, CLAUDE.md bullet.
3. `test: contract fixtures shared by flow and UI tests` — `internal/flowtest/contract.go` +
   `contract_test.go`, both flowharness `Contract`, `packages/workbench/src/testing/ui/contract.ts`,
   per-app re-export, `apps/*/tests/contract/` dirs.
4. `test(studio): split API e2e-real specs` — 4.1.1-4.1.5, 4.1.14; delete those specs.
5. `test(studio): split automations and terminal e2e-real specs` — 4.1.6-4.1.8, 4.1.16 tests 1-2.
6. `test(studio): split dbmcp approval and paste-credentials` — 4.1.9, 4.1.13 test 3; new
   `dbmcp-approval.spec.ts`.
7. `test(space): split automations e2e-real specs` — 4.2.7-4.2.9, 4.2.11.
8. `test(space): split ADE e2e-real specs` — 4.2.1-4.2.6.
9. `test(space): split git e2e-real specs` — 4.2.12-4.2.16; new `repo-commit-detail.spec.ts`; graph
   golden compare-by-default.
10. `test(space): split repos, memory, settings, restart and journey specs` — 4.2.17, 4.2.18,
    4.2.20-4.2.22.
11. `test: trim e2e-real to unsplittable scenarios` — unused support files, config comments,
    `test:e2e-real:studio` build fix.
12. `docs: e2e-real split and contract fixtures` — ARCHITECTURE, DEV_ENVIRONMENT.
13. Fixes from the end-of-phase run, grouped by root cause.
14. `docs: P249 result` — SPEC result section, row status.

Each split commit: write or extend the flow test with `app.Contract(...)`, run `KIRA_CONTRACT=write`
once, review the JSON by eye (no secrets, no machine paths), then wire the UI spec to `contract(...)`,
then delete the e2e-real test. Never delete before both halves pass.

End-of-phase verification (once): `test:flows:studio`, `test:flows:space` (coverage gate,
`exempt.txt` empty), complete variants for touched Docker flows (`test:flows:studio:complete`),
`test:ui:studio`, `test:ui:space`, `test:e2e-real:studio`, `test:e2e-real:space`, `test:unit`,
`lint`, `typecheck`, `lint:go`, `lint:dead`, `lint:claude`, and one `test:claude` run (spends
tokens; the move touches every Claude test, so CLAUDE.md's "after changing Claude integration code"
rule applies). Record pass counts and wall times before (from a pre-phase run on base) and after.

Verification the orchestrator runs: grep shows no `realclaude` build tag or `KIRA_REAL_CLAUDE` left
outside `docs/v2.1`/older plans; `ls apps/*/tests/e2e-real/*.spec.ts` matches §4 "after" lists;
every split row's UI spec calls `contract(` and its flow test calls `.Contract(`; `go list ./...`
from root contains no `tests/claude`.

## 8. In-flight overlap (rebase-time checklist)

- P246 (`p246-O`): adds `apps/*/tests/e2e-real/prompts-two-windows-real.spec.ts` (Stay), edits
  `apps/*/tests/e2e-real/automations-recurring-real.spec.ts` and Studio `dbmcp-real.spec.ts`
  (both deleted by P249) and adds `openMainWindow` to `packages/workbench/src/testing/e2eReal.ts`.
  At rebase: keep the new spec and helper; drop P246's edits to deleted specs but carry their
  intent (popup in main window only) into the UI halves (`automations-recurring.spec.ts`,
  `dbmcp-approval.spec.ts` assert the main-window key from `PromptsService.MainWindow`'s contract)
  and confirm `promptflow` covers the backend half. P246 also edits `tests/ui/support/mockRuntime.ts`
  and `ipcChannels.ts` in both apps; P249 edits the same files for contract wiring: expect textual
  conflicts, resolve by union.
- P251 (`p251-Q`): bumps `@wailsio/runtime` and Go Wails (`package.json`, `go.sum`). The nested
  modules' `go.sum` must be re-tidied after it lands (`go mod tidy` in both `tests/claude`); the
  real-runtime path in `mockRuntime` and the e2e-real anchors must pass on the new runtime.
- P245 (git restyle, plan only): changes git module classes and visuals. P249's new and extended
  Space git UI specs (`repo-commit-detail`, `repo-branch-picker`, `repo-graph-paging`,
  `repo-review-interaction`, `repo-graph-failures`) select by `data-testid` and role only, never by
  class or `kv:` token, so the restyle does not break them; any spec P245 adds is UI/visual and
  outside e2e-real.
- P250 (next, not started): uses §3's contract helper for its IPC-level splits; its gaps audit
  starts from the post-P249 e2e-real list.

## 9. Test-gap risks

- Mock bridge serialises calls; races across the real async transport (ordering, cancellation
  mid-flight, duplicate events) are covered only by the remaining anchors and `terminal-real`.
- Server-build `EmitTo` broadcasts to every page; window filtering stays covered only by the two
  multiwindow specs and P246's two-window spec.
- Contract covers what the scenario asserts, not every field of every call; un-contracted mock
  responses can still drift (P250 and later phases widen coverage scenario by scenario).
- Flow tests call bound methods in-process, not over Wails' JSON-over-HTTP; argument decoding
  (JSON tags on args structs) is proven only by the anchors. Mitigation: contract fixtures also
  record args the UI must send where the scenario depends on them (D10).
- Journey continuity across modules (one session, reload) loses its single end-to-end check;
  `journeyflow` keeps it on the backend.
- Real-clock behaviour (minute turning) moves to fake-clock flows; a real timer regression would
  show only in manual use.
- Claude suite in nested modules compiles only when `lint:claude` or `test:claude` runs; a root
  refactor can break it silently between runs (same as today's build tag). D4's alternative
  narrows that.

## 10. Decisions (defaults in force unless the user overrides)

1. Remaining project name: keep `e2e-real` (no churn for in-flight P246/P250 and docs). Deferred
   question for the user: rename to `e2e-anchor` (or other) once P246/P250 land; a rename is one
   commit touching both configs, two scripts, docs.
2. Claude suite gate: nested Go module per app under `apps/<app>/tests/claude/`; no build tag, no
   env flag; preflight skip on missing `claude` kept.
3. Script names: `test:claude:space`, `test:claude:studio`, `test:claude`, `lint:claude`.
4. `lint:claude` stays out of `lint:go`/pre-push (keeps "absent from every default command"
   literal). Alternative: add it to pre-push to catch compile breaks early (no tokens spent).
5. Memory smokes join the Space Claude module (`memory_gate_test.go`, `memory_import_test.go`),
   rewritten against exported API.
6. `api-curl-real` split: the Go side owns the fixture string (a hand-written expected curl command
   for the scenario's request); the UI spec asserts copy-as-curl produces exactly that string; the
   Go flow replays it with real `curl`. Alternative: Playwright writes the string (UI side owns the
   fixture), which inverts the drift direction; rejected because generation logic is TS and the
   UI spec is the right place to fail on it.
7. `journey-real` splits with no new journey UI spec; its UI steps are already covered spec by spec.
   Alternative: keep it as Space's anchor instead of `boot-real` (broader, ~3x slower).
8. Stay list per §4: one wiring anchor per app, real containers, multi-window, keystroke ordering
   (both apps), P246's two-window spec. `postgres-real` paste-credentials test splits.
9. Graph chunk golden becomes compare-by-default under `KIRA_CONTRACT=write` (retires
   `KIRA_GIT_FIXTURES`).
10. Contract files store the UI's outgoing args too where the scenario depends on them
    (`args:Service.Method`), asserted by the UI spec against the recorded call and decoded by the
    Go flow test into the args struct before calling.
11. Normaliser gets one table test; no other new unit tests.
12. One sequential implementer, no streams.
13. Contract regen switch name: `KIRA_CONTRACT=write`.
