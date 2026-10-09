# P232 plan: real-flow IPC tests for Kira Studio (API, Docker, terminal)

Spec row (`docs/v2.2/SPEC.md`): real-flow tests for Kira Studio, same type as P231. Go bound-service
tests at the IPC level against real services with default settings, plus real-UI `e2e-real` specs.
Scope: API module (requests, collections, variables/environments, history, gRPC) with real HTTP and
gRPC servers, no mocked transport; Docker module against a real daemon, skipping with a clear message
when none answers; Studio's own terminal wiring (`bridge/terminal.go`, terminal module host, quick
commands). Reuse P231's harness patterns. Then fix every issue found.

Base: `b1d74c24c` (branch `v2.0`). Discovery: `codegraph_explore` (5 calls) over Studio `main.go`
wiring, `internal/docker`, `internal/terminal`, `internal/quickcommands`, `bridge/http.go`,
`bridge/grpc.go`, `httpclient`, `grpcclient`. Read directly: `apps/kira-studio/internal/bridge/*.go`,
`internal/ipcfixture/harness.go`, `tests/e2e-real/fixtures.ts`, `support/passthrough.ts`,
`frontend/src/workbench/{modes,terminalModule}.ts`, `internal/docker/{bound,engine_test}.go`,
`grpcclient/{call,testserver_test}.go`, P231 plan (`git show feee13d82`), Space `appwire`/`flowharness`.

---

## 1. Inventory

### 1.1 IPC surfaces in scope

Studio registers 27 bound services (`main.go:154-182`). Three areas are in scope.

1. **Bound services**: `HttpService` (4 methods), `GrpcService` (2), `CollectionsService` (13),
   `VariablesService` (15), `ResponseHistoryService` (5), `GrpcHistoryService` (5), `DockerService`
   (22, embeds `internal/docker.BoundService`), `TerminalService` (5, embeds
   `internal/terminal.BoundService`), `CustomScriptsService` (8, over `internal/quickcommands`).
   Support services the flows cross: `FilesService` (3 pickers), `SettingsService` (2), `OpsService`
   (`Recent`, `Cancel`). Total 79 methods in scope.
2. **Push events**: `kira:grpc:call` (`EmitTo` window), `kira:api:dataChanged`, `kira:op:update`,
   `kira:docker:{changed,status,stats,logs,exec}` (per window), `kira:terminal` output/exit
   (`EmitTo`), `kira:customScripts:changed`.
3. **Window lifecycle hooks**: `WindowOpenerDeps.Terminal` (`Registry.CloseWindow`) and
   `OnWindowClosing` (`docker.CloseWindowBound`) at window close; quit teardown
   (`terminal.ShutdownBound`), Wails `ServiceShutdown` on `DockerService`.

Not an IPC surface here: copy-as-curl and import-curl are TS-only (`packages/api-core/src/http/curl`,
own unit specs). Their real flow is covered in `e2e-real` (§5.2). Postman scripts are imported inert
(`postman.WarnScriptsInert`); Studio runs no request scripts.

### 1.2 Does Studio use git?

No. No Go file under `apps/kira-studio` imports a git package or execs `git`; the frontend has no git
module (grep for `gitclient`, `internal/git`, `"git"`). A terminal shell can run git; that is the
user's shell, not a Studio flow. No git tests in P232.

### 1.3 Flows

**M1 HTTP (`HttpService`, `OpsService`, `ResponseHistoryService`; `views/httprequest`)** — 8 flows

| # | Flow | Calls |
|---|---|---|
| H1 | Send with collection and environment variables, secrets resolved only on the wire | `VariablesService.CreateEnvironment/Upsert/SetActiveEnvironment`, `HttpService.Send`, `ResponseHistoryService.List/Get`, `OpsService.Recent` |
| H2 | Redirect chains, cross-host header strip, follow off, max hops | `Send` (options `followRedirects`, `maxRedirects`) |
| H3 | Cookie jar: set, replay, list, delete, clear, jar off, incognito jar | `Send`, `Cookies`, `DeleteCookie`, `ClearCookies`, `SettingsService.Set api.disableCookieJar` |
| H4 | TLS verify on/off, HTTP/1.1 vs HTTP/2 | `Send` (options `sslVerify`, `httpVersion`) |
| H5 | Auth headers (basic, bearer from a transformed variable) | `Send`, `VariablesService.Upsert` |
| H6 | Bodies: JSON, urlencoded, multipart with file, binary file, gzip, response size cap | `Send` (options `maxResponseMb`) |
| H7 | Timeout and cancel mid-body | `Send`, `OpsService.Cancel`, `OpsService.Recent` |
| H8 | Transport error classes | `Send` (refused, DNS, bad URL, bad method) |

**M2 gRPC (`GrpcService`, `GrpcHistoryService`; `views/grpcrequest`)** — 10 flows

| # | Flow | Calls |
|---|---|---|
| G1 | Describe via reflection, with metadata | `GrpcService.Describe` (reflection) |
| G2 | Describe via `.proto` with import paths, then call | `Describe` (proto), `Call` |
| G3 | Reload after server schema change | `Describe` (`reload`) |
| G4 | Unary: metadata, header/trailer, non-OK status, history | `Call`, `GrpcHistoryService.List/Get`, `OpsService.Recent` |
| G5 | Server stream events, cancel mid-stream | `Call` (`streaming`), `kira:grpc:call`, `OpsService.Cancel` |
| G6 | Client and bidi streaming refused cleanly | `Describe`, `Call` |
| G7 | TLS targets: CA file, missing CA, server name | `Describe`, `Call` (`tls`) |
| G8 | Secrets in target and metadata, echoed secret masked | `Call`, `GrpcHistoryService.Get`, `OpsService.Recent` |
| G9 | Describe against a silent server returns | `Describe` |
| G10 | Large messages and long streams | `Call` |

**M3 API data (`CollectionsService`, `VariablesService`, histories, `FilesService`; `api/*`)** — 6 flows

| # | Flow | Calls |
|---|---|---|
| D1 | Saved request: send, history under the item, adopt scratch history, delete cascades | `CreateCollection`, `CreateItem`, `SaveRequest`, `Send`, `ResponseHistoryService.List/Adopt`, `Delete`, `kira:api:dataChanged` |
| D2 | Variable scope precedence, active environment, bulk edit, value history, reveal | `VariablesService.*` (15), `Send` |
| D3 | Postman import, send, export, re-import | `FilesService.ChooseOpen/ChooseSave`, `Import`, `Export`, `List`, `Send` |
| D4 | Incognito leaves no trace | `Send`, `Call` (`incognito`), histories, `OpsService.Recent` |
| D5 | Dynamic values resolved per send | `Send` |
| D6 | Restart persistence: secrets decrypt, active environment, tree | `Restart`, `VariablesService.Reveal`, `Send` |

**M4 Docker (`DockerService`; `docker/DockerView.vue`, `packages/docker-ui`)** — 11 flows

| # | Flow | Calls |
|---|---|---|
| K1 | Status: ok engine facts; daemon-down, unreachable, TLS, not-installed classes | `Status` (`refresh`) |
| K2 | Containers: list, compose grouping labels, stop/start/restart, inspect, unknown id | `Containers`, `Start`, `Stop`, `Restart`, `InspectContainer` |
| K3 | Images, volumes, networks, inspect each kind | `Images`, `Volumes`, `Networks`, `Inspect` |
| K4 | Engine events reach the window | `Watch`, `Unwatch`, `kira:docker:changed` |
| K5 | Logs: follow, timestamps, stdout/stderr, close, container exit ends stream | `LogsOpen`, `LogsClose`, `kira:docker:logs` |
| K6 | Exec: write, resize, exit code, refused on stopped container | `ExecOpen`, `ExecWrite`, `ExecResize`, `ExecClose`, `kira:docker:exec` |
| K7 | Stats: two windows, one unsubscribes | `StatsSubscribe`, `StatsUnsubscribe`, `kira:docker:stats` |
| K8 | Window close ends that window's docker streams only | logs/exec/stats + harness `CloseWindow` (Studio `OnWindowClosing`) |
| K9 | Contexts: list, switch, bogus name, back to automatic | `Contexts`, `UseContext`, `kira:docker:status` |
| K10 | Quit ends every stream | teardown + `ServiceShutdown` |
| K11 | Real compose project grouping | `Containers` (complete only, needs `docker compose`) |

**M5 Terminal and quick commands (`TerminalService`, `CustomScriptsService`, `FilesService`; `workbench/terminalModule.ts`)** — 7 flows

| # | Flow | Calls |
|---|---|---|
| T1 | Shell tab in default cwd, Studio TERM_PROGRAM, resize, close | `DefaultCwd`, `Open`, `Write`, `Resize`, `Close`, `kira:terminal` |
| T2 | Open refusals | `Open` (relative/missing cwd, duplicate id, bad dims, long command) |
| T3 | Quick command in a picked folder runs as a script launch | `FilesService.ChooseFolder`, `CustomScriptsService.Create/List`, `Open` (`launchKind: script`) |
| T4 | Quick-command collections in Studio's DB (move, rename, delete cascade, restart) | `CreateCollection`, `Move`, `RenameCollection`, `DeleteCollection`, `List`, changed event |
| T5 | Window close kills only that window's shells | `Open` x2 windows, harness `CloseWindow` |
| T6 | Quit tears down terminals; Open after quit refused | teardown, `Open` |
| T7 | Large output ordered and complete | `Open`, `Write` (complete only) |

### 1.4 Excluded, with reason

- **Connections, projects, tree, data grid, SQL console**: not in the row; covered by
  `internal/ipcfixture` (6 adapters), the adapter conformance suites and `tests/e2e-real`
  (sqlite/postgres/mariadb/multiwindow). Nothing above needs them.
- **DB MCP (`DbMcpService`)**: P233 owns `bridge/dbmcp.go` and `mcpinstall`. Harness keeps it at its
  default off and injects a recording installer (§2.1).
- **DataGrip import, mask rules, schema, filters, saved queries**: database-side, not in the row.
- **Update module**: `appupdate` hardcodes GitHub URLs, no endpoint seam (P231 DD2, same reason).
- **Keep-awake**: Studio keeps only the manual toggle (P188 moved the agent reason to Space); no flow
  with these modules.
- **`claude-code` launch kind in Studio terminals**: Studio has no consumer of
  `Registry.AgentSessions` and no agent hooks since P127/P188. Space's `termflow` covers the shared
  agent path.
- **Settings, layout, tabs, windows**: only as used by the flows above (`SettingsService.Set api.*`).
  Window/tab isolation is `multiwindow-real.spec.ts`.
- **Metrics ticker, menus, native dialogs' own UI**: shell pieces; dialogs are faked at the seam.

---

## 2. Harness decision

### 2.1 Go: extract Studio's composition root into `apps/kira-studio/internal/appwire`

**Decision: move `main.go`'s service construction into `appwire.Build`, called by `main.go` and the
harness.** Same reason as P231 §2.1: a harness that copies wiring drifts from production.
`ipcfixture.NewApp` already copies part of it. Today `main.go` holds `wireAdapters`,
`wireEmbeddedServices`, `wireLifecycle` and the 27-service list inline; the harness needs all of it.
Cross-module wiring the flows assert lives only there: `terminal.TermProgram` (set in `main`), the
`OnWindowClosing` docker hook, `CustomScriptsService` events, the shared `localauth.Authorizer`
(connections and variables), teardown order.

`appwire` scope, moved from `main.go`, behaviour unchanged:

- `wireAdapters`, `wireEmbeddedServices`, `wireLifecycle`, the post-`openCore` repo constructions
  (`NewSecrets`, `NewVariables`, `NewMaskKeys`, `maskrules.New`, `apivars.New`), `appcore.Deps`,
  the 27 services in today's order, `bridge.Events` attach, `terminal.TermProgram`/`Version`
  assignment.
- Teardown as `Wired.BeforeFlush()` and `Wired.Teardown()` (today's `beforeFlush`/`teardown`
  closures). Quitter stays inside `Wired` (it needs only the events emitter).
- `Wired.OnWindowClosing []func(string)` (today's docker hook) and `Wired.TerminalRegistry`;
  `main.go` passes both into `shell.WindowOpenerDeps`.

Stays in `main.go`: `startupfail.Reporter`, `config.EnsureLayout`, `logging.Init/Sweep`,
`storage.Open`, `repos.New`, `secrets.New`, `localauth.New` (the `openCore` prefix),
`application.New`, `wireWindowsAndMenu`, `buildErrorHandler`, `windowStore`.

`appwire.Options` (only the OS seams):

| Option | Production (`main.go`) | Harness |
|---|---|---|
| `DB`, `Repos`, `Cipher`, `Authorizer` | `openCore` | `storage.Open` on temp `KIRA_HOME`, `secrets.New`, `localauth.New(now, scripted evaluate, func() bool { return false })` |
| `Emitter` | `shell.NewDeferredEmitter()` | recording emitter (`internal/flowtest.Events`) |
| `Dialogs` (`bridge.Dialogs`) | `appshell.NewDialogs(rawDialogs)` | scripted answer queue |
| `KeepAwakeDriver` | `keepawake.NewPlatformDriver()` | recorder (never a real power assertion on a Mac) |
| `McpInstaller` (`bridge.McpInstaller`) | `mcpinstall.New(mcpinstall.Deps{})` | recorder (never touches the real `claude` config) |
| `AppName`, `Version` | `"Kira Studio"`, `buildinfo.Version` | same |

`Wired` exposes each bound service by field and `Bound() []application.Service` in today's order.
`main.go` sets `w.Windows.OpenNewWindow` itself, as now; the harness sets a recorder. No
`BindShell` step is needed: Studio's quitter needs no window hooks at build time.

`McpInstaller` and the `NewDbMcpService` call: P233 changes `bridge/dbmcp.go` (not
`NewDbMcpService`'s signature, verified on its branch at `ebcf4e685`). Keeping the installer
construction in `main.go` means a later P233 signature change touches only one `appwire` line on
rebase. Commit 0 rebases on whatever P233 has landed before it starts.

Layering: add `internal/appwire` and `internal/flowharness` to `packagesExemptFromBridgeCheck` in
`apps/kira-studio/internal/layering_test.go`, naming the ipcfixture precedent.

`ipcfixture.NewApp` keeps its own partial wiring in P232 (DD3).

### 2.2 Reuse from P231: extract the app-agnostic pieces to repo-root `internal/flowtest`

`apps/kira-space/internal/flowharness` cannot be imported from `apps/kira-studio` (Go `internal`
rule). Two of its files are app-agnostic and would otherwise be copied:

- `events.go` (recording `appevent.Emitter`, `Wait`, `Since`, `Decode`), 109 lines.
- `complete.go` (`Complete(t)`, `EnvComplete = "KIRA_FLOW_COMPLETE"`).

**Decision: move both to `internal/flowtest`.** Space's `flowharness` keeps its API through
`type Events = flowtest.Events`, `const EnvComplete = flowtest.EnvComplete`,
`func Complete(t testing.TB) { flowtest.Complete(t) }`. No Space flow file changes. P233 touches
neither file (checked on its branch). One complete-suite gate for both apps.

Not shared: git builders, fake agent, mobile and git-stream pieces (Space-only); Studio dialogs
(Studio's own `bridge.Dialogs` shape).

### 2.3 Go harness: `apps/kira-studio/internal/flowharness`

Non-test package, imported only by `_test.go` files.

- `harness.go`: `New(t, ...Opt) *App`. Temp root via `t.TempDir()` (Studio flows open no unix
  socket of their own). Sets `KIRA_HOME`, `HOME` (temp; `DefaultCwd` and the docker config dir read
  it), `KIRA_INSECURE_SECRETS=1` (Linux; a no-op on darwin, DD8), `TZ=UTC`. Settings stay default; a
  test changes one only through `SettingsService.Set`. Calls `HttpService.ClearCookies` (the jar is
  process-global in `httpclient/cookies.go`). `App` exposes `W *appwire.Wired`, `Events`, `Dialogs`,
  `KeepAwake`, `McpInstaller`, `CloseWindow(key)` (runs `W.TerminalRegistry.CloseWindow(key)` then
  each `W.OnWindowClosing`, the order `internal/shell/openwindow.go:108-111` uses), `Restart(t)`
  (teardown, rebuild on the same home), `Quit(t)` (`BeforeFlush`, `Teardown`, then `ServiceShutdown`
  on every `Bound()` service that has it, as Wails does). Cleanup in that same order.
- `shellfakes.go`: scripted `bridge.Dialogs` (`QueueOpenFile`, `QueueSaveFile`, `QueueDirectory`,
  cancel = ""), keep-awake driver recorder, MCP installer recorder, localauth evaluate script.
- `servers.go`: real local servers, started per test, closed in cleanup:
  - `HTTP(t)` and `HTTPS(t)` (`httptest` with a CA minted per test binary, CA PEM written to a file):
    routes `/echo` (method, headers, body hash, proto), `/redirect?n=&code=&to=`, `/cookie/set`,
    `/cookie/echo`, `/basic`, `/bearer`, `/bytes?n=`, `/gzip`, `/slow?ms=` (writes headers, then
    stalls the body), `/status?code=`. Every request recorded; `srv.Requests()` returns them.
    `HTTPSAltName` serves `localhost` and `127.0.0.1` SANs; a second listener gives a cross-host hop.
  - `GRPC(t, ...GrpcOpt)`: real `grpc.Server` over `testdata/flow.proto` compiled at runtime with
    `bufbuild/protocompile` and served with `dynamicpb` (the `grpcclient/testserver_test.go` method),
    reflection v1 and v1alpha registered. Service `kira.flow.v1.Flow`: `Unary`, `ServerStream`
    (`count`, `intervalMs`), `ClientStream`, `Bidi`, `Fail` (code, message, echoes metadata),
    `Slow` (waits for cancel). Options: TLS (same CA), auth interceptor requiring metadata, extra
    method (for reload), fixed port (restart on the same address). Records metadata and peer.
  - `Silent(t)`: TCP listener that accepts and never writes.
- `docker.go`: `RequireDocker(t) *Docker`. Pings the engine the app would resolve; no answer =
  `t.Skip("docker: no engine at <host> (<err>); start dockerd or colima, or unset KIRA_FLOW_DOCKER")`,
  or `t.Fatal` when `KIRA_FLOW_DOCKER=require`. Resolves the real endpoint once in `Main` before any
  `HOME` swap (`DOCKER_HOST`, else `docker context inspect` against the real `HOME`, else the default
  and probe sockets) and sets `DOCKER_HOST` per test, so a temp `HOME` never hides Colima on a Mac.
  Pulls `mirror.gcr.io/library/alpine:3.20` once per binary (the image `internal/docker/engine_test.go`
  uses; never a Docker Hub name). Helpers: `Run(name, cmd, labels)`, `Volume`, `Network`, `Tag`, all
  labelled `kira.flowtest=<run id>`; `t.Cleanup` force-removes each. `Main` sweeps resources labelled
  `kira.flowtest` older than one hour (crash leftovers) and removes this run's tags.
- `main.go`: `Main(m)` = endpoint capture, sweep, `testx.RunWithTempHomes(m)`.
- `cmd/flowservers/main.go`: starts `HTTP`, `HTTPS`, `GRPC` (plain and TLS) from `servers.go`,
  prints one JSON line `{http, https, grpc, grpcTls, caFile, protoDir}`, serves `/__requests` on the
  HTTP server, exits on stdin close. Used by the TS fixture so both tiers share one server
  implementation.
- `harness_test.go`: smoke. `New` builds; `len(Bound()) == 27`; `HttpService.Send` to `HTTP(t)`
  answers 200; `Quit` leaves the registry empty. Prints build time.

Real: SQLite, the cipher, the adapter host's op scheduler and op log, `httpclient`, `grpcclient`,
local HTTP/HTTPS/gRPC servers, PTYs and login shells, the Docker engine. Faked, each an OS seam:
native dialogs, keep-awake driver, OS authentication prompt, the `claude` MCP installer, the window
manager.

Process-global state the harness accounts for: `httpclient` shared jar and client (cleared per
test), `grpcclient` descriptor cache (keyed by source; `G3` uses `reload`), `terminal.TermProgram`
(same value every build). Tests in one package run serially (`t.Setenv`); packages run in parallel.

### 2.4 TS: extend Studio's existing `e2e-real` project

The project exists (`apps/kira-studio/tests/e2e-real`, chromium, `workers: 2`,
`bun run test:e2e-real:studio`). Extend it; no new project.

- `fixtures.ts`: add a `serverEnv` option (`test.use({ serverEnv: {...} })`) merged into the spawn
  env, and a worker-scoped `flowServers` fixture that builds once under the build lock
  (`go build -o apps/kira-studio/bin/flowservers ./apps/kira-studio/internal/flowharness/cmd/flowservers`)
  and spawns it per worker.
- `support/flowServers.ts`: typed handle (`urls`, `requests()` from `/__requests`).
- `packages/workbench/src/testing/e2eReal.ts`: move Space's `support/bound.ts` `bound()` here with a
  `bridgePkg` parameter; Space's `bound.ts` becomes a two-line wrapper. Studio specs seed through it.
- Dialogs: stub `FilesService.ChooseOpen/ChooseSave/ChooseFolder` with the existing
  `support/passthrough.ts`.
- Server build `EmitTo` broadcasts (`internal/shell/emitto_server.go`, P231 A3), so terminal output,
  `kira:grpc:call` and docker streams reach the page.

---

## 3. Commit 0 (one Sonnet agent, before the split)

Branch `v22-fix-P232` in `/home/user/kira-v22-A`, rebased first on whatever P233 has landed on
`v2.0`. Commits, in order:

1. `refactor(studio): composition root in internal/appwire` — §2.1. Pure move plus the `Options`
   seams; layering exemption.
2. `refactor(test): share flow event recorder and complete gate in internal/flowtest` — §2.2.
3. `test(studio): flowharness, local servers, docker helpers` — §2.3, smoke test, empty flow
   packages `apps/kira-studio/internal/flows/{httpflow,grpcflow,apiflow,dockerflow,termflow}/`, each
   `doc.go` and `main_test.go` (`func TestMain(m *testing.M) { os.Exit(flowharness.Main(m)) }`).
4. `test(studio): e2e-real flow servers and serverEnv` — §2.4, shared `bound()` move, one smoke spec
   `api-boot-real.spec.ts` (seed an environment through `bound()`, send a request from the UI to
   `flowServers.http`, response status shows, server recorded it).
5. `chore: studio flow suite scripts` — root `package.json`:
   `test:flows:studio` = `go test ./apps/kira-studio/internal/flows/... ./apps/kira-studio/internal/flowharness/...`;
   `test:flows:studio:complete` = `KIRA_FLOW_COMPLETE=1 KIRA_FLOW_DOCKER=require go test -timeout 20m` same packages.
   `.gitignore` already covers `apps/kira-studio/bin/`.

Checks: `go build ./apps/kira-studio` and `-tags server`; bindings unchanged (`bun run setup`, diff
`apps/kira-studio/frontend/bindings` against a copy taken before commit 1); `main.go` diff is a move;
`go test ./apps/kira-studio/...`; `bun run test:flows:space` still green (flowtest move);
`bun run test:flows:studio`; `bun run test:e2e-real:studio` (existing specs plus smoke); typecheck,
lint, `lint:go`, `lint:dead`. Pre-existing failures found here are fixed here (CLAUDE.md).

---

## 4. Streams

Max-2 cap: P233 is already running. A second P232 stream makes three concurrent; DD5.

Two worktrees off Commit 0's last commit: Stream A in `/home/user/kira-v22-A` (branch
`v22-fix-P232-a`), Stream B in `/home/user/kira-v22-A2` (branch `v22-fix-P232-b`). Each runs
`sh scripts/prepare-worktree.sh` and `bun run setup` first.

### 4.1 File ownership (zero overlap)

| Path | Owner |
|---|---|
| `apps/kira-studio/main.go`, `internal/appwire/**`, `internal/layering_test.go` | Commit 0 |
| `apps/kira-studio/internal/flowharness/**` (incl. `cmd/flowservers`, `testdata/flow.proto`) | Commit 0 |
| `apps/kira-studio/internal/flows/*/doc.go`, `*/main_test.go` | Commit 0 |
| `internal/flowtest/**`, `apps/kira-space/internal/flowharness/{events,complete}.go` | Commit 0 |
| `apps/kira-studio/tests/e2e-real/fixtures.ts`, `support/flowServers.ts`, `api-boot-real.spec.ts` | Commit 0 |
| `packages/workbench/src/testing/e2eReal.ts`, `apps/kira-space/tests/e2e-real/support/bound.ts` | Commit 0 |
| root `package.json` | Commit 0 |
| `apps/kira-studio/internal/flows/httpflow/*_test.go`, `httpflow/testdata/**` | Stream A |
| `apps/kira-studio/internal/flows/grpcflow/*_test.go`, `grpcflow/testdata/**` | Stream A |
| `apps/kira-studio/internal/flows/apiflow/*_test.go`, `apiflow/testdata/**` | Stream A |
| `apps/kira-studio/tests/e2e-real/api-*.spec.ts` (except `api-boot-real`), `tests/e2e-real/testdata/api/**` | Stream A |
| `docs/v2.2/plans/P232-findings-A.md` | Stream A |
| `apps/kira-studio/internal/flows/dockerflow/*_test.go`, `dockerflow/testdata/**` | Stream B |
| `apps/kira-studio/internal/flows/termflow/*_test.go` | Stream B |
| `apps/kira-studio/tests/e2e-real/docker-*.spec.ts`, `terminal-*.spec.ts` | Stream B |
| `docs/v2.2/plans/P232-findings-B.md` | Stream B |

Avoid list (P233): `internal/mcpinstall`, `internal/agenthooks`, `internal/claudecfg`, Settings MCP
UI in both apps, `bridge/dbmcp.go`, Space `appwire/wire.go`, `flows/memoryflow`, `flows/claudeflow`,
`tests/ui/support/mockRuntime.ts`, `internal/shell`. No P232 commit touches them.

**No ordering dependency between A and B: confirmed.** Both depend only on Commit 0. Separate Go
packages; neither imports the other's. Specs are separate files. Terminal and docker exec share
`kira:terminal`-shaped events but no code. Streams touch no production code, no harness file, no
shared support file. A stream needing a harness change stops and reports it; the orchestrator lands
it on `v22-fix-P232` as a Commit 0 follow-up and both rebase.

### 4.2 Stream rules

- Implement every test in §5 for the stream, then run the stream's suites once and triage. Commit per
  package as it lands.
- Test bug: fix in-stream.
- Product bug: commit the test with `t.Skip("P232 finding A3: <one line>")` (TS: `test.fixme`, same
  text) and the entry in the stream's findings file in the same commit (§6.1). Never fix product
  code in a stream.
- Discovery while tracing a failure: `codegraph_explore` before Read/Grep (load via `ToolSearch`
  `"codegraph"`; the index lags new files, read those directly). The orchestrator greps the log.
- No `--no-verify` as a finish.

---

## 5. Per-flow tests

Bar: a test crosses the IPC boundary and asserts a wire, cross-service or persisted consequence.
Persistence round trips (create then list) are not tests on their own. **(C)** = complete suite only
(`flowtest.Complete(t)`); the rest is general.

### 5.1 Stream A — Go

`httpflow`:

- `TestSendResolvesSecretsOnlyOnTheWire` (H1) — collection var `base`, environment secret `token`,
  active environment; `Send` `{{base}}/echo` with `Authorization: Bearer {{token}}`. Server saw the
  plaintext token. Response timeline, `ResponseHistoryService.Get`, `OpsService.Recent` command show
  `{{token}}`, never the value. Raw bytes of `kira.sqlite` plus `-wal` contain no token.
- `TestRedirects` (H2) — 301, 302, 303, 307, 308 chains: method and body per code; a hop to the
  second host drops `Authorization` and user headers (server record); `followRedirects:false` returns
  the 302; `maxRedirects:2` on a 3-hop chain fails with the documented class; timeline hops equal
  the chain.
- `TestCookieJar` (H3) — `Set-Cookie` then a second send replays it; `Cookies(url)` lists; domain and
  path scoping; `DeleteCookie`; `ClearCookies`; `api.disableCookieJar` via `SettingsService.Set`
  sends none; an incognito send's cookie never reaches the shared jar.
- `TestTLSAndHTTPVersion` (H4) — HTTPS with the test CA: default `sslVerify` fails with
  `E_HTTP_TRANSPORT` naming the certificate; per-request `sslVerify:false` gets 200; `httpVersion:"2"`
  reaches the server as HTTP/2, `"1.1"` as HTTP/1.1 (server record).
- `TestAuthHeaders` (H5) — `/basic` 401 without, 200 with a header built from a variable through a
  transform (`apivars/transforms.go`); `/bearer` with a secret.
- `TestBodies` (H6) — JSON raw, urlencoded with reserved characters, multipart with a file part
  (server hash equals file hash), binary file mode; gzip response decoded; `/bytes` above
  `maxResponseMb` reports the cap (truncation flag or error, whichever the response view handles).
  (C) 200 MB body under a raised cap.
- `TestTimeoutAndCancel` (H7) — `/slow` with per-request `requestTimeoutMs:200` yields `E_TIMEOUT`;
  a second send cancelled by `OpsService.Cancel(opId)` while the body stalls yields `E_CANCELLED`;
  op log rows end timeout and cancelled; server saw both connections close.
- `TestTransportErrors` (H8) — refused port, `.invalid` host, malformed URL (`E_BAD_REQUEST`),
  unknown method; each a distinct class, op log row ends error.

`grpcflow`:

- `TestDescribeReflection` (G1) — services and methods with streaming flags for all four kinds,
  request templates; reflection service itself hidden; server with an auth interceptor needs
  metadata `authorization` from a secret variable; without it the error class names the status.
- `TestDescribeProtoAndCall` (G2) — `.proto` importing a second file through `importPaths` plus a
  well-known type; schema matches reflection's; `Call` in proto mode reaches the server; missing
  import fails `E_GRPC_SCHEMA` naming the file.
- `TestReloadAfterSchemaChange` (G3) — describe; restart the server on the same port with an extra
  method; describe again returns the cached schema; `reload:true` returns the new method.
- `TestUnaryMetadataAndStatus` (G4) — request metadata echoed into header and trailer; `Fail`
  NOT_FOUND returns code and message; one history row per completed call; op log command ends with
  the code name.
- `TestServerStreamAndCancel` (G5) — 5 messages 50 ms apart reach `kira:grpc:call` for the calling
  window in seq order, offsets rising; the history row exists before the terminal event (D11);
  `OpsService.Cancel` at message 3 ends CANCELLED with a partial count of 3 and a history row.
- `TestClientAndBidiRefused` (G6) — `Describe` flags them; `Call` returns `E_GRPC_BAD_REQUEST`, no
  history, no server call recorded. Documented gap, not a finding (DD6).
- `TestTLSTargets` (G7) — TLS server: `caFile` succeeds; no CA fails `E_GRPC_TRANSPORT`; `serverName`
  override passes a SAN mismatch; plaintext against TLS fails.
- `TestSecretsInTargetAndMetadata` (G8) — target host and metadata from environment secrets; server
  saw values; history and op log keep placeholders; server echoing the secret in its status message
  comes back masked in the result and in history; DB bytes contain no secret.
- `TestDescribeSilentServer` (G9) — `Describe` against `Silent(t)` returns an error within 10 s.
  No cancel path exists for `Describe` (no `opId`), so a hang is a finding.
- `TestLargeMessages` (G10, C) — 4 MB unary response; 10 000-message stream: every seq arrives once.

`apiflow`:

- `TestSavedRequestHistory` (D1) — collection, item, `SaveRequest`; send with `itemId`: history
  under the item, not the scratch tab; `Adopt` a scratch tab's history into a new item;
  `kira:api:dataChanged` scopes per mutation; deleting the collection removes its items' history.
- `TestVariablePrecedence` (D2) — same name at global, collection, environment: server sees the
  environment value; `SetActiveEnvironment` switches it; `ApplyBulk` add/update/delete;
  `History` lists value changes; `Reveal`/`RevealHistory` need confirmation (scripted unavailable OS
  auth) then return the value; `DuplicateEnvironment` copies secrets that still decrypt on send.
- `TestPostmanImportSendExport` (D3) — scripted `ChooseOpen` returns `testdata/collection.json`
  (folders, collection vars, a secret var, auth block, scripts, file body, a GraphQL body); `Import`
  report warnings match; an imported request sends `{{baseUrl}}` to the real server; scripted
  `ChooseSave`, `Export`: `SecretCount` 1, gRPC item counted in `SkippedGrpc`; re-import equals the
  tree (names, order, URLs, bodies).
- `TestIncognitoLeavesNoTrace` (D4) — incognito HTTP send and gRPC call: no history rows, no
  persisted op log rows, DB bytes free of the request URL.
- `TestDynamicValues` (D5) — `{{$uuid}}`/`{{$timestamp}}` differ per send at the server; history
  keeps the template.
- `TestRestartKeepsApiState` (D6) — `Restart`: active environment kept, secret still sends,
  collection tree unchanged.

### 5.2 Stream A — TS (`e2e-real`)

- `api-http-real.spec.ts` — environment with a secret, saved request, Send from the UI; response
  pane shows the server's echo; history list shows the entry; Operations panel shows `{{token}}`.
- `api-curl-real.spec.ts` — paste a curl into Import curl; send; server record equals the curl's
  request. Copy as curl, run it with the real `curl` binary; the server records the same method, path,
  headers and body as the app's send. Skips when `curl` is absent.
- `api-postman-real.spec.ts` — import through the menu with `ChooseOpen` stubbed to a fixture file;
  tree shows folders; export with `ChooseSave` stubbed; written file parses and lists the requests.
- `api-grpc-real.spec.ts` — reflection describe against `flowServers.grpc`, pick `ServerStream`,
  call; messages appear one by one; Stop ends it; unary call shows header and trailer.

### 5.3 Stream B — Go

`dockerflow` (`RequireDocker` except where noted):

- `TestStatusClasses` (K1) — no daemon needed: `DOCKER_HOST=unix:///<tmp>/none.sock` gives
  `daemon-down`; `tcp://127.0.0.1:<closed>` gives `unreachable`; `https://` at an `httptest` TLS
  server gives `tls`. With an engine: `Status{refresh}` ok, engine version equals the client's
  `ServerVersion`. Not-installed runs only where no default socket exists, else skips with that
  reason.
- `TestContainerActions` (K2) — labelled container `sh -c 'echo ready; sleep 300'`, two with
  `com.docker.compose.project/service` labels: `Containers` carries project and service; `Stop` then
  `Containers{all:false}` omits it; `Start`; `Restart` changes start time; `InspectContainer` shows
  env, a volume mount and networks; `Start`/`InspectContainer` on an unknown id give `E_NOT_FOUND`.
- `TestImagesVolumesNetworks` (K3) — run-tagged alpine, a volume, a network with a container
  attached: each listed with its fields; `Inspect{kind,id}` for each kind returns its JSON; unknown
  kind `E_INVALID`.
- `TestEngineEvents` (K4) — `Watch(window)`; a container started with the client yields
  `kira:docker:changed` naming containers for that window; after `Unwatch`, none.
- `TestLogsStream` (K5) — container prints 50 numbered lines to stdout and stderr, then sleeps:
  `LogsOpen{follow,timestamps}` delivers all in order with stream names; `LogsClose` stops events; a
  container that exits ends its stream with `ended:true`; unknown container errors. (C) 100 000
  lines, none dropped, order kept.
- `TestExecSession` (K6) — `ExecOpen` shell in a running container; `ExecWrite`
  `echo $((6*7))` gives `42`; `ExecResize` then `stty size` matches; `exit 3` gives an exit event
  with code 3; `ExecOpen` on a stopped container errors; `ExecClose` twice is fine.
- `TestStatsTwoWindows` (K7) — windows A and B subscribe one container: both get samples with
  CPU and memory set; A unsubscribes, B keeps receiving.
- `TestWindowCloseEndsStreams` (K8) — window A opens logs, exec and stats, window B logs:
  `CloseWindow(A)` ends A's logs (`ended`) and exec (exit event) and stops A's stats; B's logs still
  flow. Guards Studio's `OnWindowClosing` wiring.
- `TestContexts` (K9) — temp `HOME/.docker/contexts/meta/<sha256>/meta.json` for `flow-ctx` pointing
  at the real host: `Contexts` lists `default` first then `flow-ctx`; `UseContext{flow-ctx}` returns
  source `selected`, emits `kira:docker:status` and `kira:docker:changed`, ends an open log stream;
  `UseContext{bogus}` gives `E_INVALID`; `UseContext{""}` returns to automatic.
- `TestQuitEndsStreams` (K10) — logs and exec open; `Quit`: both end; later `Containers` still
  answers on a fresh harness.
- `TestComposeGrouping` (K11, C) — skips without `docker compose`; `testdata/compose.yml` with two
  `mirror.gcr.io` services, `up -d`; `Containers` groups both under the project; `down -v` in cleanup.

`termflow`:

- `TestShellTab` (T1) — `DefaultCwd` equals the temp `HOME`; `Open` shell there; write
  `pwd; echo $TERM_PROGRAM`; output for the window shows the path and `Kira Studio`; `Resize 100x30`
  then `stty size` shows `30 100`; `Close` gives the exit event; a later `Write` is a no-op.
- `TestOpenRefusals` (T2) — relative cwd, missing cwd, duplicate id, `cols:0`, command over
  `MaxCommandBytes`: each `E_INVALID`, no session registered.
- `TestQuickCommandInPickedFolder` (T3) — scripted `ChooseFolder` returns a dir holding
  `marker.txt`; `CustomScriptsService.Create{cwd, command: "ls marker.txt; exit 4"}`;
  `kira:customScripts:changed` carries it; `Open{launchKind:"script", cwd, command}` shows
  `marker.txt` and exits with code 4. A cancelled picker returns `canceled:true`.
- `TestQuickCommandCollections` (T4) — two collections; `Move` a script between them and to none;
  `RenameCollection`; `DeleteCollection` removes its scripts (Studio's FK cascade, `PRAGMA
  foreign_keys`) and the event snapshot agrees; `Restart` lists the same snapshot.
- `TestWindowCloseKillsOnlyItsShells` (T5) — shells in windows A and B, each `echo $$`; `CloseWindow(A)`:
  A's exit event, A's pid gone (`testx.ProcessAlive`), B still answers a write.
- `TestQuitTearsDownTerminals` (T6) — two shells; `Quit`: exit events, pids gone; `Open` on the old
  `Wired` gives `E_INVALID` ("terminal window is closing").
- `TestLargeOutput` (T7, C) — `seq 1 200000`: concatenated output has every line once, in order.

### 5.4 Stream B — TS (`e2e-real`)

- `docker-real.spec.ts` — skips without an engine (same message); labelled compose-label container
  created with `docker run` from the spec; Docker mode lists it under its project; open logs, a line
  shows; Stop from the UI, state updates without reload; exec `echo kira-$((1+1))` shows `kira-2`;
  cleanup removes the container.
- `terminal-real.spec.ts` — `serverEnv` with a temp `HOME`; Terminal mode, new tab, type
  `echo kira-$((1+1))`, output shows `kira-2`; Quick commands: add one with `ChooseFolder` stubbed to a
  temp dir, run it, output shows the dir listing.

Totals: Stream A 24 Go tests + 4 specs; Stream B 18 Go tests + 2 specs; Commit 0 one Go smoke test
and one smoke spec. 43 Go tests, 7 new specs. The orchestrator verifies with `go test -list` and
`playwright --list`.

---

## 6. Findings and fix phase

### 6.1 Findings files

`docs/v2.2/plans/P232-findings-A.md` and `-B.md`, one per stream, committed with each skipped test:

```
## A3 Describe hangs against a silent server
- Test: grpcflow TestDescribeSilentServer (skipped "P232 finding A3")
- Failure: <exact failing assertion line>
- Repro: <setup, calls>
- Suspected cause: <file:line>, how found (codegraph_explore / read)
- Class: product bug | needs design decision
```

`needs design decision` (another subsystem, a missing feature): the orchestrator adds a SPEC row at
the table end and asks the user; the test stays skipped naming that row.

### 6.2 Fix phase

After both streams land and pass verification: one sequential Sonnet fixer for both files (DD10).
Why one: streams split test files, not production code; API and Docker findings may share the
op scheduler, `appwire` or event paths. Two fixers only if findings exceed 15 and a zero-overlap
production-file table can be drawn.

Fixer: group by root cause; per group fix, un-skip, run those tests plus the package's own suite,
commit (`fix(studio): ...`), note the fix commit in the findings entry. Then delete both findings
files and fold the pre-fix failure lines into `## P232 result`.

Done: `grep -rn "P232 finding" apps/kira-studio` empty, except skips naming a new SPEC row the user
has seen.

---

## 7. Suites, time budgets, checks

| Suite | Command | When | Budget (Linux) |
|---|---|---|---|
| General Go flows | in `bun run test:go`; alone `bun run test:flows:studio` | every dev loop, CI `container-tests` | ≤ 60 s wall, packages parallel; `dockerflow` ≤ 30 s with a warm image; harness `New` ≤ 400 ms |
| Complete Go flows | `bun run test:flows:studio:complete` | on demand, phase end, before release | ≤ 8 min |
| TS e2e-real | `bun run test:e2e-real:studio` | on demand, phase end | new specs ≤ 4 min incl. builds, 2 workers |

P25 split: general holds one load-bearing assertion set per flow; complete adds volume (200 MB
body, 10 000-message stream, 100 000 log lines, 200 000 terminal lines) and the compose run. Same
test functions; `Complete(t)` gates the extra cases.

**Docker in the general suite, gated on a reachable engine.** Why: the failure class worth catching
(stream teardown, window-close wiring, error mapping) is cheap to run (alpine starts in under a
second) and CI `container-tests` already has a daemon for the adapter suites. A Mac without Colima
skips with the message from §2.3, so the dev loop never needs Docker. Status error classes (K1 first
half) need no daemon and always run. `KIRA_FLOW_DOCKER=require` turns the skip into a failure; the
complete script sets it, so a phase-end run cannot pass with Docker silently skipped.

Speed rules: no sleeps, only `Events.Wait` and `testx.WaitUntil`; image pulled once per binary;
servers per test on port 0; each package timed once at phase end, numbers in the result section.

Sandbox: `dockerd` may need starting as root (`setsid nohup dockerd > /tmp/dockerd.log 2>&1 <
/dev/null &`); Docker Hub blobs are blocked, `mirror.gcr.io` works (DEV_ENVIRONMENT Docker section).
Engine 29.8.2 and `docker compose` v5.6.0 answer here (checked at plan time).

Orchestrator checks:

- Commit 0: §3 checks; `Bound()` count 27; bindings diff empty; `main.go` diff is a move; real
  `codegraph_explore` calls if the implementer traced indexed code.
- Each stream: `go test -list` and `playwright --list` match §5 names and counts; no file outside the
  stream's rows (`git diff --stat <commit0>..v22-fix-P232-x`); no `httptest.NewRecorder`, no fake
  `RoundTripper`, no in-process `bufconn` in `apps/kira-studio/internal/flows` (grep: transport must
  be real sockets); no image reference outside `mirror.gcr.io` (grep); `docker ps -a --filter
  label=kira.flowtest` empty after a run; skip markers match findings entries one to one.
- Landing: rebase each stream onto `v22-fix-P232`; a conflict means the ownership table was wrong,
  stop. Remove the B worktree; push.
- Fix phase: skip grep empty; `bun run test:go`, `test:flows:studio:complete` (with the daemon up),
  `test:e2e-real:studio`, `test:ui:studio` (fixes may touch the frontend), `test:unit`, typecheck,
  lint, `lint:go`, `lint:dead` green; each fixed finding failed before (line recorded) and passes
  after.

Unit-test bar: these are flow suites at the IPC boundary, requested explicitly, with P231 and the
adapter conformance suites as precedent. Inside them the bar still holds: §5 lists flows with wire or
cross-service consequences, not CRUD round trips.

---

## 8. Docs

Docs land last, after P233's docs edits are on `v2.0` (both phases edit `ARCHITECTURE.md` and
`DEV_ENVIRONMENT.md`, different sections).

- `docs/ARCHITECTURE.md` Testing: add the Studio flow tier (`appwire` composition root, `flowharness`,
  real vs faked, local servers, docker gating, general/complete) beside the Space paragraph; note
  `internal/flowtest` shared by both harnesses; extend the Studio `e2e-real` paragraph (spec count,
  `flowservers`, server-build `EmitTo` broadcast for terminal and gRPC events). Docker module section:
  one line on flow coverage. Process model: Studio's `main.go` now calls `appwire.Build`.
- `docs/DEV_ENVIRONMENT.md`: Docker section, replace the start command with
  `setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &` (survives the calling shell) and add
  the flow suites' `KIRA_FLOW_DOCKER=require`; new short section "Kira Studio flow suites (P232)":
  commands, env (`KIRA_FLOW_COMPLETE`, `KIRA_FLOW_DOCKER`), `flowservers`, label sweep.
- `docs/v2.2/SPEC.md`: `## P232 result` (counts, timings, findings with pre-fix lines, deviations);
  row Done; this plan deleted after folding (`docs/v2.2/README.md`).
- `CLAUDE.md`: no change.

---

## 9. Mac handover

1. `bun run test:flows:studio` with Colima stopped: `dockerflow` skips with the clear message, all
   else passes. Then `colima start` and `bun run test:flows:studio:complete`: all pass, including
   compose. Report darwin-only failures (PTY login shell, `stty`, Keychain cipher, Colima socket
   discovery under a temp `HOME`).
2. `bun run test:e2e-real:studio`: existing and new specs pass.
3. App smoke after the `appwire` move (`bun run dev:studio`): API: send a request with an environment
   secret, check history; gRPC: describe a reflection server, stream; Docker: list, logs, exec, stop;
   Terminal: new tab, a quick command with a picked folder; Settings > Database MCP still toggles;
   close a window with a terminal and docker logs open, then Cmd+Q within 2 s.
4. No Touch ID prompt during the suites (scripted OS auth); `~/.claude*` untouched (recording MCP
   installer); `docker ps -a --filter label=kira.flowtest` empty afterwards.

---

## 10. Deferred decisions (defaults the orchestrator takes unless the user says otherwise)

- DD1: Studio `appwire` extraction from `main.go` (default yes) vs copied wiring (rejected, §2.1).
- DD2: `internal/flowtest` holds the event recorder and complete gate for both apps (default yes).
- DD3: `ipcfixture.NewApp` keeps its own wiring in P232; moving it onto `appwire` is a later cleanup.
- DD4: Docker flows in the general suite gated on a reachable engine; `KIRA_FLOW_DOCKER=require` in
  the complete script (default).
- DD5: concurrency cap. P233 plus two P232 streams is three. Default: Stream A starts after Commit 0;
  Stream B starts once P233's implementer finishes, unless the user allows three.
- DD6: client and bidi streaming gRPC are unsupported (`grpcclient.Unary`/`ServerStream` refuse them).
  P232 asserts the clean refusal; adding them is a new SPEC row only if the user asks.
- DD7: gRPC calls have no timeout (`requestTimeoutMs` is HTTP-only; no deadline field in
  `GrpcCallArgs`). Coverage is cancel plus server statuses. Whether gRPC should honour a timeout is a
  design question; a `Describe` hang (G9) is a product bug either way.
- DD8: on macOS the harness uses the real Keychain-backed cipher, as `ipcfixture` already does (P25
  F10 exception). `KIRA_INSECURE_SECRETS` is Linux-only.
- DD9: e2e-real stays on demand, not in CI (as Studio's and Space's today).
- DD10: one sequential fixer for both findings files (§6.2 exception rule).
- DD11: one complete-suite env name for both apps, `KIRA_FLOW_COMPLETE=1`.
