# P168 Part 1: whole-codebase review, chunk pre-plan and stream assignment

Splits the whole tree into 22 review chunks (Parts 2-23) across 2 streams. Reviews no code.
Each chunk later gets its own Opus review plan, one Opus reviewer and one Sonnet fixer (§6).
Tree surveyed: `f40cd35` (P168 row added; P166 review in flight, nothing fixed yet).

Paths repo-relative. `Studio` = `apps/kira-studio`, `Space` = `apps/kira-space`, `vscode` =
`apps/kira-space-vscode`, `SF` = `Studio/frontend/src`, `PF` = `Space/frontend/src`, `SI` =
`Studio/internal`, `PI` = `Space/internal`, `SA` = `SI/adapters`. Line counts are `wc -l` over
owned `.go/.ts/.vue/.js/.mjs/.css/.sh/.sql/.lua/.fbs` at `f40cd35`, tests included. **Counts
are as of `f40cd35` only.** P166/P167 fixes and earlier chunks' fixes land before most chunks
start, so the first chunk's review plan re-runs §8's script and every review plan re-reads its
files from the current tree.

## 0. Method

- **CodeGraph index, aggregated.** `.codegraph/codegraph.db` copied to the scratchpad, every
  `calls/references/instantiates/imports/implements/extends` edge rolled up to a module key (Go
  package, TS package subdir, Studio/Space view dir), production files only. Cross-language edges
  dropped (name collisions only) and Go edges between the two apps dropped (Go's `internal/` rule
  forbids them). 2,545 module pairs remain. §2 quotes the ones that set a boundary.
- **`codegraph_explore`, targeted.** On the boundaries the split turns on: Space ADE wiring
  (`main.go` `wireTracker`/`wireAdeTask`/`wireReviewWindows`, `bridge.AdeTaskService`,
  `storage/model.AdeTask`, `repos.AdeTaskRepo`); the shared parse worker (`useParseWorker`,
  `handlers`, its callees `beautify.ts`, `console/copyAll.ts`, `console/format.ts`, its callers in
  console, httprequest, grpcrequest); the terminal (`internal/terminal` `Registry`,
  `BoundService.Open`, `AgentSessions`, `workbench` `createTerminalsStore`, `TerminalPanel`,
  `gitsession.Conn.Open`, `gitsock.Server`); review window and hosts (`ade.TaskBoard.
  OpenReviewWindow`, `repos.AdeReviewWindowsRepo`, `AdeReviewWindow.vue`, `gitUiModule.ts`,
  `vscode/src/proxyHandlers.ts` `createProxyHandlers` over `git-ipc` `ServerHandlers`).
- **Import lines, verified.** CodeGraph over-links TS names. Every cross-package claim below was
  re-checked against real `import`/Go import lines with `git grep`.
- **Churn.** `git diff --numstat 743af03..HEAD` (the P166 scope: P143-P165) per chunk, via §8's
  rules. It ranks collision risk with the P166/P167 fixers (§3.4).

## 1. What SPEC fixes, what this plan decides

SPEC fixes: one Opus reviewer per chunk, freeform "any kind of issue or bug", edge cases
weighted; Opus writes each chunk's review plan; one Sonnet fixer; chunk scope is its own files
plus one hop out on both call-graph edges; chunks run one at a time within a stream.

User scope change (after the row was written): chunk reviews start as soon as this plan is
committed, beside the P166 then P167 chain. Hard cap: at most 2 concurrent agent streams across
everything. The P166/P167 chain holds 1 slot until P167 is committed.

This plan decides: chunk count and boundaries (§4, §5), streams, order and schedule (§3), gates
(§3.2), edit scope and landing (§3.3, §3.4).

## 2. Coupling findings

- **The two apps never import each other.** Zero real imports between Studio and Space, vscode
  or `git-*`, in either direction, Go or TS. `git grep` hits are comments only. Every shared
  edge runs through two bases: root Go `internal/*` and the TS packages `workbench`, `theme`,
  `kira-ui`, plus a slice of `shared`.
- **Go base consumers (files importing).** `ipcerr` 28 Studio / 28 Space, `kiratime` 26/2,
  `sqlitex` 11/14, `appstorage` 9/9, `testx` 5/13, `shell` 4/6, `terminal` 2/6, `notify` 5/4.
  Space-only: `agenthooks` (ADE `tracker.go`, bridge), `procgroup`, `pathsafe`, `rpcstream`,
  `localsock`. Studio-only: `jsonx`. `agenthooks` left Studio in P127 and now serves Space ADE.
- **TS base consumers (files importing).** `@workbench/`: 169 Studio, 59 Space, 10 `git-ui`,
  1 `git-ipc`. `@theme/`: 103 Studio, 67 Space, 45 `git-ui`, 25 `workbench`, 1 vscode.
  `theme/src/components/ui` now holds the shadcn-vue primitives (116 files): `git-ui/components`
  918 edges, Studio `api` 516, `httprequest` 504. `kira-ui` shrank to 3 files
  (`KuiColumnResizeHandle`, `floatingPosition`): 1 Studio (`StreamView.vue`), 2 `git-ui`,
  1 `workbench`. `@shared/`: 235 Studio, 17 Space, 29 `workbench`.
- **`packages/shared` outside Studio.** Only `protocol/events.ts` and `domain/{agent,base64,
  color,git,layout,ops,path,repo,scripts,settings,shortcuts,tabs}.ts` are imported by Space or
  the base packages. `domain/{http,collections,grpc,editor}` reach `api-core`; `domain/http`
  also reaches `theme/src/methodColor.ts` (type only); `domain/connection` reaches
  `db-fixtures`. All other `shared` files are Studio-only.
- **Dense clusters (never cut).** `SI/storage/repos` to `model` 325; `views/console` to
  `views/shared` 313, `grid` to `shared` 296, `documents` to `shared` 127; `git-ui/components`
  to `git-ui/state` 205, `state` to `git-ui/bridge` 167, both to `git-ipc` ~118; Space
  `bridge/adetask.go` to `bridge/adewire` 141, `ade/*` to `adewire` ~300 over 10 files;
  `ade/v2/{panel,board,plan,dialog}` to `ade/v2` 76-145 each; `gitsession` to
  `gitclient/porcelain`, `gitpreflight`, `gitops`, `gitreview` (§5.15).
- **Space ADE Go (new since P108).** `PI/ade` (11.4k) imports `storage/{model,repos}`,
  `bridge/adewire`, `gitsession`, `gitclient(/porcelain)`, `gitprepare`, `gitreview`,
  `gitaskpass`, `ghclient`, `codeworkspace`, `adeflow`, `adeagent`, root `terminal`,
  `agenthooks`. Only `bridge/adetask.go` and `Space/main.go` import it. `adeflow` imports only
  `adewire`; `adeagent` imports `gitprepare`, root `procgroup`, `tokenauth`. So ADE is a top
  caller of the git layer and sits above it in the order.
- **Space ADE frontend.** `PF/ade/v2` (13k, 112 files) calls `PF/bridge` (54 edges),
  `PF/repo/git/transport.ts` (`onReviewRepaint`), `@workbench` components and `queryClient`.
  `PF/App.vue` mounts `AdeReviewWindow.vue` (the review window). Tests: 14 `tests/ui/ade-v2-*`,
  6 `tests/unit/ade*`, `tests/fixtures/ade-v2/`.
- **Shared parse worker (P163).** `SF/workers/parse/handlers.ts` calls `SF/beautify.ts`,
  `views/console/{copyAll,format}.ts`. Callers: console, `httprequest/RequestBodyPane.vue`,
  `useResponseBody.ts`, `grpcrequest/GrpcRequestView.vue`. It sits with the console.
- **Terminal.** Go `internal/terminal` (`Registry`, `BoundService`) serves both apps' bridges and
  Space ADE (`AgentSessions`, `Write`, `WindowOf`). TS half is `workbench/src/terminal` +
  `state/createTerminalsStore.ts`, instantiated by each app's `state/terminals.ts`.
- **Studio Go call order.** `storage/model` is imported by every adapter, adapterhost, bridge,
  dbmcp, enginecache, connections, oplog, tree, postman. `page` by every adapter, adapterhost,
  dbmcp, enginecache, queryplan. `adapterhost` by bridge, dbmcp, appshell, appcore. `storage`
  itself imports `httpclient` (model/repos), a later chunk's file.
- **Cross-language mirrors (no call edge, one contract).** Page wire: `SI/page/encode.go` +
  `SI/adapterhost/frame.go` against `shared/protocol/frame.ts` (both from `wire.fbs`). Git wire:
  `PI/gitstore/encode.go` against `git-ipc/src/graphChunkCodec.ts` (from `gitwire.fbs`). Git RPC:
  `gitrpc` handler table against `git-ipc/src/contract.ts`. ADE wire: `PI/bridge/adewire/wire.go`
  against `PF/ade/v2` types (`tests/unit/ade-v2-board-parity.spec.ts`). Mask: `SI/mask` against
  `shared/domain/mask.ts`. Query plans: `SI/queryplan` against console plan parsers. Settings:
  `internal/appsettings` + `SI/storage/model` against `shared/domain/settings.ts`. Vocabulary:
  each app's `go-ts-vocabulary-parity.spec.ts`. Wails bindings are generated and gitignored.

## 3. Streams and schedule

### 3.1 Split by app, both bases in stream A

**Stream A = Kira Studio plus both shared bases. Stream B = Kira Space (Go, `git-*` packages,
ADE, desktop host, VS Code extension).** §2's first finding decides it: no Studio chunk's
one-hop set reaches a Space chunk except through the two bases. Every app's own mirrors (page
wire, mask, queryplan, git wire, git RPC, ADE wire) stay in one stream, so a two-sided mirror
fix never crosses streams.

Both bases go to A, unlike P108, because of the schedule (§3.4): B cannot start before P167 is
committed, while A runs from day one. A therefore closes both bases while B is still idle. P108's
cross-stream settings mirror (`appsettings` against `shared/domain/settings.ts`) is now
in-stream.

Load: A 254,084 lines over 12 chunks, B 182,094 over 10. A is heavier on purpose: it runs alone
during phase 1.

### 3.2 Gates

- **G0 (schedule).** Stream B starts only after P167 is committed (§3.4).
- **G1.** Part 14 (B1, first Space Go chunk) starts only after Part 8 (A7, shared Go base) is
  committed and landed. Every Space Go chunk one-hops into `internal/*`.
- **G2.** Part 17 (B4, first Space chunk holding TS: `git-ipc` imports `@workbench`) starts only
  after Part 9 (A8, shared frontend base) is committed and landed.

Part 8 is A's 7th chunk. If P167 lands before it, B waits at G1. That costs an idle slot, never
correctness.

### 3.3 Edit scope

- A fixer edits its own chunk's files and one-hop files owned by an earlier or later chunk **in
  its own stream**. A stream is sequential, so this never races within it.
- **Before Stream B starts**, an A fixer may also edit a B-owned file that is a one-hop caller of
  its chunk (in practice: Part 8's or Part 9's Space callers when a base API changes). Only the
  P166/P167 chain can race it, and §3.4's landing rule covers that.
- **After Stream B starts**, a fixer never edits the other stream's files. Base files (Parts 8
  and 9) belong to A. A B fix needing a base file is recorded in the fixer's report (file,
  finding, proposed change). The orchestrator runs it as a fix-only Sonnet step in stream A
  between A's chunks, as its own commit naming the originating Part. Once A has finished its last
  chunk, the B fixer may make the edit directly.
- A finding already listed in a P166/P167 findings file still on disk is skipped. That chain
  fixes it. The reviewer checks `docs/v2.0/plans/P16{6,7}-code-review.md` first, if present.
- `.github/workflows/*` cannot be pushed from this session. Follow `docs/DEV_ENVIRONMENT.md`'s
  workaround (`docs/pending-workflows/` already holds `mutation.yml`; merge into an existing
  pending file, never a second copy).

### 3.4 Schedule and landing

At most 2 concurrent agent streams across everything (user cap). The P166/P167 chain runs in
the main `v2.0` checkout. Its fixers may edit production files anywhere.

- **Phase 1: Stream A alone,** beside P166 then P167. Parts 2-13 in order.
- **Phase 2: both streams,** once P167 is committed. A continues where it is; B starts at
  Part 14 (G1, G2 still apply).

Order inside A is chosen against P166-scope churn (`743af03..f40cd35`, lines added+deleted per
chunk): Parts 2-7 (Studio Go, API backend) 0-28 lines each, so they run first. Part 8 (Go base)
2,011 lines (mutation tooling, `internal/terminal`, `internal/shell`, scripts) and Part 12
(console, parse worker, perf tests) 2,039 lines run later, when most P166 fixes have landed.
P166's real weight sits in B: Part 20 (ADE Go) 23,529 and Part 21 (ADE frontend) 40,067, and B
starts only after P167. The excluded Cheetah prototype took 3,953.

This order puts the Go base after the six Studio Go chunks: those reviewers read `internal/*` as
an unreviewed callee, and the base review then sees settled callers. The same trade P108 made
for Studio `state/**`. Studio TS chunks still follow the frontend base (Part 9).

**Landing rule.** Each stream is its own git worktree and branch (`p168-stream-a`,
`p168-stream-b`), both off the same base commit (the commit that adds this plan).
- Each chunk lands on its own, after its fix pass commits and its findings file is deleted,
  before the stream's next review plan starts.
- To land: rebase the stream branch onto current `v2.0`, run hooks (normal commit path, never
  `--no-verify`), then `git merge --ff-only <stream-branch>` in the main checkout. Run it only
  between P166/P167 steps, with that checkout clean. If `v2.0` moved meanwhile, rebase again.
- **A rebase conflict is never blind-resolved.** It means a P166/P167 fix or the other stream
  changed the same code. The fixer re-reads the conflicting hunks against the current tree, keeps
  both intents, and re-runs hooks. If the fix no longer applies, it is dropped and the drop is
  stated in the commit message.
- Every chunk review plan re-reads current files (never this plan's snapshot), because P166/P167
  and earlier chunks may have changed them.
- Chunk fixer commits name `P168 Part <N>`. P167's diff will contain landed P168 commits; the
  orchestrator should tell the P167 reviewer they are reviewed under P168.
- Worktrees survive a container restart. Resume a stream from its last commit.

### 3.5 Per-stream file ownership

Zero overlap, by construction: §8's first-matching-rule assignment gives each file exactly one
Part; the check output proves every owned file has one owner and no file is orphaned.

| Stream | Parts | Owns |
|---|---|---|
| A | 2-13 | `internal/**`, `scripts/**` except `demo-dbs` is Part 3 and `build-vscode.ts`/`package-vscode.ts` are B; `tools/**`, `.githooks/**`, `.claude/**`, `.github/**`, every root file; `packages/{workbench,theme,kira-ui,shared,api-core,db-fixtures}/**`; `apps/kira-studio/**` |
| B | 14-23 | `apps/kira-space/**`, `apps/kira-space-vscode/**`, `packages/{git-core,git-ipc,git-ui}/**`, `scripts/{build,package}-vscode.ts` |

Excluded from both, with reason, in §6.

## 4. Chunk summary

Execution order runs top to bottom within each stream.

| Part | Stream/pos | Chunk | Lines (tests) | P166 churn |
|---|---|---|---|---|
| 2 | A1 | Studio persistence, secrets and connection lifecycle | 19,684 (7,872) | 5 |
| 3 | A2 | Studio DB adapters I: adapter core and SQL engines | 26,401 (8,115) | 0 |
| 4 | A3 | Studio DB adapters II: document, key-value, stream, object-store engines | 15,798 (7,277) | 0 |
| 5 | A4 | Studio engine data plane and page wire protocol | 21,623 (10,822) | 18 |
| 6 | A5 | Studio Go app shell, Wails bridge, DB MCP | 14,755 (4,462) | 28 |
| 7 | A6 | Studio API client backend | 17,074 (6,514) | 2 |
| 8 | A7 | Shared Go base and repo tooling | 16,274 (3,944) | 2,011 |
| 9 | A8 | Shared frontend base | 14,723 (449) | 271 |
| 10 | A9 | Studio API client UI | 23,319 (10,157) | 459 |
| 11 | A10 | Studio grid and shared view machinery | 30,574 (10,074) | 241 |
| 12 | A11 | Studio console, editor, parse worker, per-kind data views | 27,172 (10,375) | 2,039 |
| 13 | A12 | Studio shell, project tree, state stores, UI-test harness | 26,687 (14,621) | 518 |
| 14 | B1 | Space git process layer | 16,073 (8,546) | 449 |
| 15 | B2 | Space git preflight, ops, review, search, prepare, graph store, op log | 15,176 (7,563) | 165 |
| 16 | B3 | Space git session | 18,789 (8,637) | 565 |
| 17 | B4 | Space git RPC, socket server, `git-ipc` contract | 23,577 (14,003) | 618 |
| 18 | B5 | `git-core` and `git-ui` logic | 20,843 (6,705) | 18 |
| 19 | B6 | `git-ui` components | 19,897 (1,314) | 89 |
| 20 | B7 | Space ADE engine (Go) and Space persistence | 20,140 (4,585) | 23,529 |
| 21 | B8 | Space ADE frontend and review window | 17,275 (4,167) | 40,067 |
| 22 | B9 | Kira Space desktop host | 19,849 (6,209) | 1,820 |
| 23 | B10 | Kira Space VS Code extension | 10,475 (5,148) | 1 |

Stream B runs bottom-up (callees first) except where §5 names it. All chunks sit in the 10-31k
range; none needs a further split.

## 5. Chunks

One-hop lists are package/directory granular. Each chunk's review plan narrows them to exact
files and symbols with CodeGraph.

### 5.1 Part 2 — A1: Studio persistence, secrets and connection lifecycle

- **Own.** `SI/{storage,secrets,localauth,connections,preconnect,datagrip}/**` (testdata
  included).
- **Callers.** Every adapter and `SA/testsupport` (`storage/model`), `adapterhost`, `bridge`,
  `dbmcp`, `enginecache`, `oplog`, `tree`, `postman`, `apivars`, `maskrules`, `appcore`,
  `ipcfixture`, `main.go` (`openCore`; one `authorizer` shared with `apivars`).
- **Callees.** `internal/{appsettings,appstorage,sqlitex,kiratime,ipcerr}` (Part 8, later),
  `httpclient` (model/repos, Part 7), `SA` registry (`connections`).
- **Watch.** Migration order against `model`. Settings leaf-key round trips. The shared reveal
  grace (connection password and variable reveal agree). Keychain fallbacks per platform.
  DataGrip import of malformed XML and JDBC URLs. Preconnect supervisor tail and signal races.

### 5.2 Part 3 — A2: Studio DB adapters I (adapter core and SQL engines)

- **Own.** `SA/*.go`, `SA/{testsupport,relational,postgres,mysqlfamily,mysql,mariadb,sqlite,
  clickhouse}/**`, `scripts/demo-dbs/**`, `scripts/{db-compat,test-matrix}.sh`.
- **Callers.** `adapterhost`, `dbmcp`, `tree`, `connections`, `bridge`, `ipcfixture`,
  `main.go` `wireAdapters`, Part 4's engines (core only).
- **Callees.** `SI/storage/model` (Part 2, closed), `SI/page` builders (Part 5), `internal/jsonx`,
  drivers.
- **Watch.** `QueryTracker`: `Drain` on `Disconnect`, multi-statement release, cancel races.
  Each `Caps()` false matches an `Unsupported` return no caller reaches. Conformance suites
  (`SA/*/*_test.go`) are exempt from the unit-test bar (`CLAUDE.md`): keep per-capability
  coverage, prune only true duplicates.

### 5.3 Part 4 — A3: Studio DB adapters II (document, key-value, stream, object-store)

- **Own.** `SA/{mongo,redis,kafka,sqs,s3,awscfg}/**`.
- **Callers.** Same as Part 3.
- **Callees.** Part 3's core (closed), `storage/model`, `page`, SDK clients.
- **Watch.** `sqs` queue-URL cache and receipt handles, `kafka` ephemeral browse clients, `mongo`
  `inFlight` against `Disconnect`, `redis` per-db connection set, leaf-returns-`[]` in
  `Children`. Same conformance-suite exemption.

### 5.4 Part 5 — A4: Studio engine data plane and page wire protocol

- **Own.** `SI/{adapterhost,enginecache,page,tree,oplog,ipcfixture}/**` (`page/wire` generated,
  excluded); `packages/shared/protocol/**` except `events.ts` (`protocol/wire` generated,
  excluded); `packages/shared/domain/{mutations,object-store,tree,connection}.ts`;
  `packages/db-fixtures/**`; `SF/bridge/**`; `Studio/tests/{ipc,e2e-real,support}/**`;
  `tests/unit/{bridge-*,e2e-real-build-lock}.spec.ts`.
- **Callers.** Go: `bridge`, `dbmcp`, `appshell`, `appcore`, `main.go`. TS: every `SF` store and
  view calling `SF/bridge/{data,control,apiControl}.ts`; `decodeFrame`'s sole caller is
  `SF/bridge/port.ts`.
- **Callees.** `SA` (Parts 3-4, closed), `storage`, `connections` (Part 2, closed),
  `@workbench/bridge`, `protocol/events.ts` (Part 9, later).
- **Watch.** Wire mirror, both halves here: `encode.go`/`frame.go` against `frame.ts`.
  `ExecuteResponse` copy-on-multi-page. `Mutate` invalidates the cache even on failure. A cache
  hit never enters the op log. Router reconnect race, throttle, dataframe cancel. `port.ts`:
  `ready` gating, timeouts before the open ack, `rejectAllPending`. `e2e-real` is kept
  (`CLAUDE.md`); regenerate wire via `scripts/generate-wire.sh` if a schema changes.

### 5.5 Part 6 — A5: Studio Go app shell, Wails bridge and DB MCP

- **Own.** `SI/{bridge,appshell,appcore,buildinfo,config,dbmcp,queryplan,mask,maskrules,mcpauth,
  mcpinstall}/**`, `SI/layering_test.go`, `Studio/{main.go,Taskfile.yml,.gitignore}`,
  `Studio/{cmd,build}/**`, `shared/domain/{mask,dbmcp}.ts`, `tests/unit/mask-parity.spec.ts`.
- **Callers.** Wails bindings (generated) from `SF` stores; MCP clients over `dbmcp`.
- **Callees.** Parts 2-5 (closed), Part 7 (next), `internal/{shell,terminal,appevent,ipcerr,
  keepawake,appupdate,windowsvc,metrics}` (Part 8, later).
- **Watch.** dbmcp read-gate on every schema tool under read-mode deny; `maskedToolError` never
  leaks a raw driver message; approval order is verdict, explain, at most one approval, execute.
  Collections import/export atomicity tests. Mirrors: `mask.go`/`mask.ts`, `queryplan` against
  console plan parsers (Part 12, read).

### 5.6 Part 7 — A6: Studio API client backend

- **Own.** `SI/{httpclient,grpcclient,apivars,postman}/**`, `packages/api-core/**`,
  `shared/domain/{http,collections,grpc,grpc-history,response-history,variables}.ts`,
  `tests/unit/go-ts-vocabulary-parity.spec.ts`.
- **Callers.** `bridge/{http,grpc,grpchistory,collections,variables,responsehistory,apidata}.go`
  (Part 6, closed); `storage/{model,repos}` (Part 2, closed); `SF/api`, `views/{httprequest,
  grpcrequest}` (Part 10); `theme/src/methodColor.ts` (type).
- **Callees.** `storage` repos, `secrets` cipher, the reveal `authorizer`, `localauth`.
- **Watch.** Variable reveal grace, secret isolation, Postman import atomicity and parse limits,
  gRPC descriptor cache invalidation and reflection supersession, cookie jar, timeline.

### 5.7 Part 8 — A7: Shared Go base and repo tooling

- **Own.** `internal/**` (26 packages: `agenthooks`, `appevent`, `appsettings`, `appstorage`,
  `appupdate`, `ipcerr`, `jsonx`, `keepawake`, `kirapaths`, `kiratime`, `layeringtest`,
  `localsock`, `logging`, `metrics`, `notify`, `pathsafe`, `procgroup`, `rpcstream`, `shell`,
  `sqlitex`, `startupfail`, `terminal`, `testx`, `tokenauth`, `toolexec`, `windowsvc`). Tooling:
  `scripts/**` except Part 3's and B's, `scripts/mutation/**`, `tools/mutation/**`,
  `.githooks/**`, `.claude/**`, `.github/workflows/*` (§3.3), root `package.json`, `biome.json`,
  `knip.json`, `.golangci.yml`, `.jscpd.json`, `.mcp.json`, `bunfig.toml`, `go.mod`,
  `tsconfig.json`, `.gitignore`.
- **Callers.** Every Go importer in both apps (§2), both `main.go`, Space ADE (`agenthooks`,
  `terminal`, `procgroup`). Before Stream B starts the fixer may edit Space callers (§3.3).
- **Callees.** Stdlib, Wails runtime, SQLite driver, PTY, `git`/shell binaries, Stryker.
- **Watch.** Terminal `Registry` reservation and `OnChange` ordering, coalesced output, Linux
  PTY/proc code. Shell window registry and close-decision handshake. `agenthooks` HTTP listener
  (security, P127 move). Mutation tooling (P151): `run.sh`/`go.sh`/`ts.sh` argument handling,
  `areas.json`, `summarize.ts`. Hook and script call sites. Settings mirror against
  `shared/domain/settings.ts` (Part 9, next, same stream).

### 5.8 Part 9 — A8: Shared frontend base

- **Own.** `packages/{workbench,theme,kira-ui}/**` (shadcn `theme/src/components/ui` and
  `workbench/src/testing` included), `packages/shared/package.json`,
  `shared/protocol/events.ts`, `shared/domain/{agent,base64,color,git,layout,ops,path,repo,
  scripts,settings,shortcuts,tabs}.ts`.
- **Callers.** Studio and Space frontends, `git-ui` (theme 918 edges, workbench 10 files),
  `git-ipc` (1), vscode (1), `api-core`, both apps' tests. Before Stream B starts the fixer may
  edit Space callers (§3.3).
- **Callees.** Vue, reka-ui (shadcn-vue), VueUse, Pinia, TanStack Query, floating-ui, xterm,
  Studio-owned `shared/domain/http.ts` (read).
- **Watch.** `WorkbenchHost` stays a structural subset of each app's store. `createTabsStore`
  `TabsHost` hooks: incognito tabs never persist, even duplicated. `createTerminalsStore` drain
  bound and late-output drop. Tooltip and resize-handle primitives. `queryClient` shared
  defaults.

### 5.9 Part 10 — A9: Studio API client UI

- **Own.** `SF/{api,views/httprequest,views/grpcrequest}/**`; `tests/unit/{api-*,grpc-*,http-*,
  history-runtime-*}`; `tests/ui/{http-*,grpc-*,collections,api-*,secrets,credential-reveal}`;
  `tests/perf/http-*`; `tests/visual/http-request-view*`.
- **Callers.** `SF/workbench/tabViews.ts`, `SF/App.vue`, tab kinds (Part 13).
- **Callees.** `api-core` (Part 7, closed), `SF/views/shared/request` (Part 11), `SF/editor` and
  parse worker (Part 12), `SF/state`, Part 9 (closed).
- **Watch.** TanStack Query keys and invalidation after mutations, cross-window sync, secret
  reveal expiry, send-then-tab-close leak, cookie store race, gRPC stream terminal race.

### 5.10 Part 11 — A10: Studio grid and shared view machinery

- **Own.** `SF/views/{shared,grid}/**`; `tests/unit/{grid-*,slick-*,kira-slick-grid,
  column-widths-cache,page-store-cell-cache,page-navigation-*,resolve-column-order,row-*,scan,
  match-index,timestamp-*,view-*,fake-data-*,ejson,document-row-height-cache}`;
  `tests/ui/{slick-grid,data-view,cell-editor,mutations,row-coloring,scroll-trace,fake-data}`;
  `tests/perf/{grid-scroll.spec.ts,support/wideTable.ts}`; `tests/visual/data-view*`.
- **Callers.** `console` 313 edges, `grid` 296, `documents` 127, `stream`, `httprequest`,
  `grpcrequest`.
- **Callees.** `SF/state` (page stores, cell selection), `SF/bridge` (Part 5, closed),
  `protocol/page.ts`, SlickGrid, Part 9.
- **Watch.** P162 SlickGrid layer fix. Page store cursor and boundary arithmetic, selection model
  edges, clipboard format safety, SQL literal escaping, staged edits on composite/PK-less tables.

### 5.11 Part 12 — A11: Studio console, editor, parse worker and per-kind data views

- **Own.** `SF/views/{console,documents,keyvalue,stream,browse,definition}/**`, `SF/editor/**`,
  `SF/workers/**`, `SF/beautify.ts`, `shared/domain/{sql-*,console,definition,editor,schema,
  queries,streamFilter}.ts`; `tests/unit/{console-*,explain-*,sql-*,ddl-schema,schema-*,
  find-ranges-*,paint-spans-*,hover-*,autocomplete-*,sigma-*,document-*,mongo-sort-*,browse-*,
  stream-*,sqs-*,chunked-text,parse-worker-client,support/consoleHarness.ts}` except
  `document-row-height-cache` (Part 11); `Studio/tests/fixtures/**`; `tests/ui/{console*,
  autocomplete,sql-schema,definition,document-view-*}`; `tests/perf/{console-*,documents*,
  parse-callers,pureFns.entry}`; `tests/visual/{console,schema-dialog}*`.
- **Callers.** `SF/workbench/tabViews.ts`, tab kinds (Part 13); `httprequest` and `grpcrequest`
  (editor, parse worker; Part 10, closed).
- **Callees.** `views/shared` (Part 11, closed), `SF/state`, Monaco, sql-formatter,
  `SF/theme/completion.ts` (Part 13).
- **Watch.** Parse worker (P163): abort on scope dispose, `runLatest` key reuse, inline vs worker
  parity, chunker boundaries. Auto-explain races (stop, overlap, clobber, run after tab close).
  Splitter and linter rule interactions. Console result cap.

### 5.12 Part 13 — A12: Studio shell, project tree, state stores and UI-test harness

- **Own.** Everything else under `Studio/`: `SF/{App.vue,main.ts,fonts.ts}`,
  `SF/{workbench,project,state,theme,shortcuts}/**`, `Studio/frontend/{index.html,package.json,
  components.json,tsconfig.json,vite.config.ts,wails/runtime.js}`, `Studio/playwright{,.perf}.
  config.ts`, `Studio/tsconfig*.json`; `shared/caps.ts`, `shared/domain/{mode,uri,tree-filter,
  datagrip,secrets}.ts`; `tests/ui/{support/**,fixtures.ts,global.d.ts}`, remaining
  `tests/{unit,ui,visual,perf}` files (`tabs-*`, `tree-*`, `run-state`, `mongo-srv-uri`, `smoke`,
  `workbench`, `connections`, `preconnect`, `datagrip-import`, `mode-switch`, `operations`,
  `settings-*`, `mask-preview`, `terminal-module`, `tooltips`, `update-dialog`, `font-roles`,
  `focus-ring`, `control-sizing`, `interaction`, `leaks`, `perf`, `budgets`, `perfProbe`,
  `blockMeter`, `tree-scroll`).
- **Callers.** None above it: app root.
- **Callees.** Every Studio view (Parts 10-12, closed), `SF/bridge` (Part 5), Part 9.
- **Watch.** Last in A on purpose: `state/**` is a callee of every view (bottom-up exception).
  Earlier view fixers may edit it (same stream); this pass re-reviews it with callers settled.
  Status-bar removals (P164). Spec files mapping to an earlier chunk's source stay with that
  chunk; a misplaced default costs nothing in a sequential stream.

### 5.13 Part 14 — B1: Space git process layer

- **Own.** `PI/{gitclient,ghclient,gitpath,gitaskpass}/**` (`porcelain/testdata` included).
- **Gate.** G0, G1.
- **Callers.** `gitsession`, `gitrpc`, `gitsock`, `gitsearch`, `gitpreflight`, `gitops`,
  `gitreview`, `gitprepare`, `codeworkspace`, `ade`, `bridge`, `Space/main.go`.
- **Callees.** `internal/{toolexec,pathsafe,localsock,kirapaths,procgroup}` (Part 8, closed),
  `git`/`gh`.
- **Watch.** Porcelain parsing of NUL/0x1f output (CRLF, empty bodies, trailers, signed, renames,
  binary and LFS diffs, merge-tree conflicts). `cat-file --batch` size gate. `Repo.Read/Write`
  slot accounting against cancellation. Askpass credential handling (security).

### 5.14 Part 15 — B2: Space git preflight, ops, review, search, prepare, graph store, op log

- **Own.** `PI/{gitpreflight,gitops,gitreview,gitsearch,gitprepare,gitstore,oplog}/**`
  (`gitwire` generated, excluded).
- **Callers.** `gitsession` (preflight/ops/review heavy), `gitrpc`, `gitsock`, `ade`,
  `adeagent` (`gitprepare`).
- **Callees.** Part 14 (closed), `internal/{sqlitex,notify,kiratime}`.
- **Watch.** Per-op `ContinueArgs/AbortArgs/SkipArgs` flags, undo/revert preflight. Review store
  migrations. Prepare script execution trust. Mirror: `gitstore/encode.go` against
  `git-ipc/src/graphChunkCodec.ts` (Part 17, read).

### 5.15 Part 16 — B3: Space git session

- **Own.** `PI/gitsession/**`.
- **Callers.** `gitrpc`, `gitsock`, `ade`, `bridge`, `Space/main.go`.
- **Callees.** Parts 14-15 (closed), `storage/model` (Part 20, later, same stream).
- **Watch.** `Conn.Open` close race and duplicate-open cleanup, registry holds, auto-fetch arming
  per connection (`noAutoFetch`), walk staleness marks, stack and worktree ops, protected
  branches.

### 5.16 Part 17 — B4: Space git RPC, socket server and `git-ipc` contract

- **Own.** `PI/{gitrpc,gitsock,gitvsix}/**`, `packages/git-ipc/**` (`src/generated` excluded).
- **Gate.** G2.
- **Callers.** Go: `PI/bridge/{gitstream,gitclients}.go`, `Space/main.go`. TS: `git-ui/state`,
  `git-ui/components`, `PF/repo`, `PF/views/repo`, vscode.
- **Callees.** Part 16 (closed), `storage` (Part 20, later), `internal/{rpcstream,notify,ipcerr,
  tokenauth}`.
- **Watch.** Both halves of the RPC contract here. `gitsock` handshake, pairing, flock, `Close`
  against mid-handshake connections, revocation, per-connection mailbox caps. `streamChannel`
  and `socketChannel` ordering and late close. Codec validation of hostile frames.

### 5.17 Part 18 — B5: `git-core` and `git-ui` logic

- **Own.** `packages/git-core/**`, `packages/git-ui/src/{state,graph,bridge}/**`,
  `packages/git-ui/src/{index.ts,graphVisibility.ts,shims-vue.d.ts}`.
- **Callers.** `git-ui` components and `App.vue` (Part 19), `PF/repo`, `PF/views/repo`, vscode.
- **Callees.** `git-ipc` (Part 17, closed).
- **Watch.** `BridgeClient`, review session state, graph order and visibility, search store.

### 5.18 Part 19 — B6: `git-ui` components

- **Own.** Rest of `packages/git-ui/**`: `src/components/**`, `src/{App.vue,MountRoot.vue,
  main.ts}`, `src/{icons,lib,theme,testing}/**`, `package.json`, `tsconfig.json`,
  `vite.config.ts`.
- **Callers.** `PF/repo/git/gitUiModule.ts` (lazy mount), `PF/views/repo`, vscode webview.
- **Callees.** Part 18 (closed), `theme`/`workbench`/`kira-ui` (Part 9, closed).
- **Watch.** `App.vue` bootstrap and content states, commit grid resize handles, row menus,
  review view base selection.

### 5.19 Part 20 — B7: Space ADE engine (Go) and Space persistence

- **Own.** `PI/{ade,adeflow,adeagent,storage}/**` (testdata included),
  `PI/bridge/{adetask.go,adetask_validate.go,agentsessions.go,adewire/**}`.
- **Callers.** `PI/bridge/adetask.go` (own), `Space/main.go` (`wireTracker`, `wireAdeTask`,
  `wireReviewWindows`, `closeTaskReviewWindows`, `purgeReviewWindows`); storage callers
  `gitsock`, `gitsession`, `codeworkspace`, `bridge`.
- **Callees.** Parts 14-16 (closed), `codeworkspace` (Part 22, later), `internal/{terminal,
  agenthooks,procgroup,tokenauth,sqlitex,appstorage,appsettings}` (Part 8).
- **Watch.** Highest P166-scope churn in the tree (23.5k): read P166/P167 outcomes first.
  Run engine and recovery after restart, per-task mutex use, review window open/teardown ordering
  (window row then review row, orphan cleanup), GitHub sync ledger, workflow YAML limits,
  `adetask_validate` bounds. `adeagent` process and MCP token. Migrations 0004-0015 ordering.
  `PI/storage` is a callee of Parts 15-17: earlier fixers may edit it (same stream).

### 5.20 Part 21 — B8: Space ADE frontend and review window

- **Own.** `PF/ade/**`; `Space/tests/ui/{ade-v2-*,support/adeV2.ts}`,
  `Space/tests/unit/{ade*,support/adeV2Fixtures.ts,support/mockupV2Oracle.ts}`,
  `Space/tests/fixtures/ade-v2/**`.
- **Callers.** `PF/App.vue` (`AdeReviewWindow`), `PF/workbench` (Part 22).
- **Callees.** `PF/bridge`, `PF/repo/git/transport.ts` (Part 22, later, same stream; bottom-up
  exception), `@workbench` (Part 9).
- **Watch.** 40k lines of P166-scope churn. Board, plan drag-drop, dialogs, needs, sessions,
  review window panes and sync-plan invalidation. ADE wire mirror against `adewire` (Part 20,
  closed; `ade-v2-board-parity.spec.ts`).

### 5.21 Part 22 — B9: Kira Space desktop host

- **Own.** Everything else under `Space/`: `PI/{bridge (rest),appshell,appcore,codeworkspace,
  config,buildinfo}/**`, `PI/layering_test.go`, `Space/{main.go,Taskfile.yml,.gitignore,
  playwright*.config.ts,tsconfig*.json}`, `Space/build/**`, `PF/` except `ade/`, remaining
  `Space/tests/**`.
- **Callers.** None above it: app root.
- **Callees.** Parts 14-21 (closed), Part 8, Part 9.
- **Watch.** `main.go` wiring order (tracker before any window, review window purge). Git
  credential and pairing dialogs. Repo file tree, search, blame, diff editors and shared Monaco
  model refcount. `codeworkspace` path safety.

### 5.22 Part 23 — B10: Kira Space VS Code extension

- **Own.** `vscode/**`, `scripts/{build,package}-vscode.ts`.
- **Callers.** VS Code activation.
- **Callees.** `git-ipc`, `git-core`, `git-ui` (Parts 17-19, closed), `@theme` (1 file).
- **Watch.** `proxyHandlers.ts` implements `ServerHandlers` and stays vscode-free (narrow ports).
  Connection `whenConnected` and reconnect. Workspace trust gating. Webview CSP in `html.ts`.

## 6. Per-chunk loop (Parts 2-23) and exclusions

- **Review plan.** Opus writes `docs/v2.0/plans/P168-part<N>-<slug>.md`: exact own-file list
  from the current tree, exact one-hop callers/callees (symbol level), edge cases to weight, the
  watch items above. It must call `codegraph_explore` for discovery (`ToolSearch "codegraph"`
  first). The first chunk's plan (Part 2) also re-runs §8 and records any drift. The orchestrator
  greps the subagent's tool log for real calls before accepting.
- **Review.** One Opus reviewer, freeform "any kind of issue or bug", edge cases weighted, no
  fixes. It also calls `codegraph_explore`. Findings go to
  `docs/v2.0/plans/P168-part<N>-findings.md`, committed before any fixer starts. A chunk with
  nothing real says so.
- **Fix.** One Sonnet fixer fixes every finding, one commit per group of related findings
  (Conventional Commits, naming `P168 Part <N>`), under §3.3. A finding needing a real design
  decision becomes its own named `SPEC.md` phase. The fixer deletes the findings file when done.
  Hooks green on every commit.
- **Land.** Per §3.4, then the stream's next chunk starts.
- **Kept, not pruned.** Adapter conformance suites (`SA/*/*_test.go`) and `Studio/tests/e2e-real`
  per `CLAUDE.md`.
- **Excluded from ownership and review** (625 files):
  - docs: `docs/**`, every `*.md`, `LICENSE` files (472). Not code.
  - generated: `SI/page/wire`, `shared/protocol/wire`, `git-ipc/src/generated`, `PI/gitwire`
    (63). FlatBuffers output; regenerate via `scripts/generate-wire.sh`.
  - lockfiles: `bun.lock`, `tools/mutation/bun.lock`, `go.sum` (3).
  - Cheetah prototype (P165, NO-GO, kept only as a comparison tool, not shipped):
    `Studio/frontend/proto/**`, `Studio/tests/proto/**`, `playwright.proto.config.ts`,
    `frontend/vite.proto.config.ts`, `frontend/tsconfig.proto.json`,
    `tests/perf/proto-grid-scroll.spec.ts`, `tests/unit/proto-grid-selection.spec.ts` (45).
    P166 reviews it in scope.
  - assets: `*.png`, `*.icns`, `build/appicon.icon/**`, `vscode/resources/**`, `.gitkeep` (42).
    Binary or static; visual baselines are regenerated by the visual suite.

## 7. Declined alternatives

- **Bases split across streams (P108's shape).** B is idle until P167 lands, so a B-owned base
  would block every Studio TS chunk for that whole time. A owns both.
- **Go base first in A (strict bottom-up).** Its files carry 2,011 lines of P166-scope churn
  (mutation tooling, terminal, shell): reviewing it first maximises collisions with P166 fixes.
  Six zero-churn Studio Go chunks run first instead (§3.4).
- **Language split.** Puts every IPC mirror (page wire, git RPC, ADE wire, mask) across streams
  and needs a cross-stream handoff for each two-sided fix. Declined, as in P108.
- **ADE folded into the git chunks.** ADE Go (20k) and frontend (17k) are each a full chunk, and
  ADE calls the git layer one way only. Separate chunks keep both reviewable and keep the git
  layer bottom-up.
- **Prototype as its own chunk.** It does not ship, carries a NO-GO verdict, and P166 already
  reviews it. Excluded rather than spend a chunk.

## 8. Ownership coverage check

Run from repo root: `python3 <script>` (script below). First matching rule wins, so each file
has exactly one owner. Output at `f40cd35`:

```
Part  2 [A] files= 145 codelines= 19684 (tests   7872)
Part  3 [A] files= 138 codelines= 26401 (tests   8115)
Part  4 [A] files=  72 codelines= 15798 (tests   7277)
Part  5 [A] files= 110 codelines= 21623 (tests  10822)
Part  6 [A] files=  95 codelines= 14755 (tests   4462)
Part  7 [A] files=  90 codelines= 17074 (tests   6514)
Part  8 [A] files= 156 codelines= 16274 (tests   3944)
Part  9 [A] files= 256 codelines= 14723 (tests    449)
Part 10 [A] files=  91 codelines= 23319 (tests  10157)
Part 11 [A] files= 133 codelines= 30574 (tests  10074)
Part 12 [A] files= 314 codelines= 27172 (tests  10375)
Part 13 [A] files= 151 codelines= 26687 (tests  14621)
Part 14 [B] files= 134 codelines= 16073 (tests   8546)
Part 15 [B] files=  98 codelines= 15176 (tests   7563)
Part 16 [B] files=  51 codelines= 18789 (tests   8637)
Part 17 [B] files=  85 codelines= 23577 (tests  14003)
Part 18 [B] files= 126 codelines= 20843 (tests   6705)
Part 19 [B] files= 101 codelines= 19897 (tests   1314)
Part 20 [B] files= 111 codelines= 20140 (tests   4585)
Part 21 [B] files= 166 codelines= 17275 (tests   4167)
Part 22 [B] files= 173 codelines= 19849 (tests   6209)
Part 23 [B] files=  72 codelines= 10475 (tests   5148)
streams code lines: {'A': 254084, 'B': 182094}
owned files: 2868 excluded: {'docs': 472, 'asset': 42, 'gen': 63, 'proto': 45, 'lock': 3} orphans: 0 tracked: 3493
```

2,868 owned + 625 excluded + 0 orphans = 3,493 tracked files. Stream A owns Parts 2-13, B owns
Parts 14-23: no file has two owners, so the streams share no file.

```python
import re, subprocess, sys, collections
ST='apps/kira-studio/'; SP='apps/kira-space/'; SF=ST+'frontend/src/'; PF=SP+'frontend/src/'
SU=ST+'tests/unit/'; SUI=ST+'tests/ui/'
X=[
 ('docs',  r'^docs/|\.md$|^LICENSE$|^apps/kira-space-vscode/LICENSE$'),
 ('gen',   r'^apps/kira-studio/internal/page/wire/|^packages/shared/protocol/wire/|^packages/git-ipc/src/generated/|^apps/kira-space/internal/gitwire/'),
 ('lock',  r'(^|/)bun\.lock$|^go\.sum$'),
 ('proto', r'^apps/kira-studio/(frontend/proto/|tests/proto/|playwright\.proto\.config\.ts$|frontend/vite\.proto\.config\.ts$|frontend/tsconfig\.proto\.json$|tests/perf/proto-grid-scroll\.spec\.ts$|tests/unit/proto-grid-selection\.spec\.ts$)'),
 ('asset', r'\.(png|icns)$|/build/appicon\.icon/|^apps/kira-space-vscode/resources/|\.gitkeep$'),
]
R=[
 (8, r'^internal/|^scripts/(?!demo-dbs/|db-compat\.sh$|test-matrix\.sh$|build-vscode\.ts$|package-vscode\.ts$)|^tools/|^\.githooks/|^\.claude/|^\.github/|^[^/]+$'),
 (9, r'^packages/(workbench|theme|kira-ui)/|^packages/shared/package\.json$|^packages/shared/protocol/events\.ts$|^packages/shared/domain/(agent|base64|color|git|layout|ops|path|repo|scripts|settings|shortcuts|tabs)\.ts$'),
 (2, ST+r'internal/(storage|secrets|localauth|connections|preconnect|datagrip)/'),
 (3, ST+r'internal/adapters/(testsupport|relational|postgres|mysqlfamily|mysql|mariadb|sqlite|clickhouse)/|'+ST+r'internal/adapters/[^/]+$|^scripts/(demo-dbs/|db-compat\.sh$|test-matrix\.sh$)'),
 (4, ST+r'internal/adapters/'),
 (5, ST+r'internal/(adapterhost|enginecache|page|tree|oplog|ipcfixture)/|^packages/shared/protocol/|^packages/db-fixtures/|'+SF+r'bridge/|^packages/shared/domain/(mutations|object-store|tree|connection)\.ts$|'+ST+r'tests/(ipc|e2e-real|support)/|'+SU+r'(bridge-|e2e-real-build-lock)'),
 (6, ST+r'internal/(bridge|appshell|appcore|buildinfo|config|dbmcp|queryplan|mask|maskrules|mcpauth|mcpinstall)/|'+ST+r'internal/layering_test\.go$|'+ST+r'(main\.go|Taskfile\.yml|\.gitignore)$|'+ST+r'(cmd|build)/|^packages/shared/domain/(mask|dbmcp)\.ts$|'+SU+r'mask-parity'),
 (7, ST+r'internal/(httpclient|grpcclient|apivars|postman)/|^packages/api-core/|^packages/shared/domain/(http|collections|grpc|grpc-history|response-history|variables)\.ts$|'+SU+r'go-ts-vocabulary-parity'),
 (10, SF+r'(api|views/httprequest|views/grpcrequest)/|'+SU+r'(api-|grpc-|http-|history-runtime)|'+SUI+r'(http-|grpc-|collections|api-|secrets|credential-reveal)|'+ST+r'tests/perf/http-|'+ST+r'tests/visual/http-request-view'),
 (11, SF+r'views/(shared|grid)/|'+SU+r'(grid-|slick-|kira-slick-grid|column-widths-cache|page-store-cell-cache|page-navigation|resolve-column-order|row-|scan\.|match-index|timestamp-|view-|fake-data-|ejson|document-row-height-cache)|'+SUI+r'(slick-grid|data-view|cell-editor|mutations|row-coloring|scroll-trace|fake-data)|'+ST+r'tests/perf/(grid-scroll|support/wideTable)|'+ST+r'tests/visual/data-view'),
 (12, SF+r'(views/(console|documents|keyvalue|stream|browse|definition)|editor|workers)/|'+SF+r'beautify\.ts$|^packages/shared/domain/(sql-[a-z]+|console|definition|editor|schema|queries|streamFilter)\.ts$|'+SU+r'(console-|explain-|sql-|ddl-schema|schema-|find-ranges|paint-spans|hover-|autocomplete-|sigma-|document-|mongo-sort|browse-|stream-|sqs-|chunked-text|parse-worker|support/consoleHarness)|'+ST+r'tests/fixtures/|'+SUI+r'(console|autocomplete|sql-schema|definition|document-view)|'+ST+r'tests/perf/(console-|documents|parse-callers|pureFns)|'+ST+r'tests/visual/(console|schema-dialog)'),
 (13, r'^apps/kira-studio/|^packages/shared/'),
 (14, SP+r'internal/(gitclient|ghclient|gitpath|gitaskpass)/'),
 (15, SP+r'internal/(gitpreflight|gitops|gitreview|gitsearch|gitprepare|gitstore|oplog)/'),
 (16, SP+r'internal/gitsession/'),
 (17, SP+r'internal/(gitrpc|gitsock|gitvsix)/|^packages/git-ipc/'),
 (18, r'^packages/git-core/|^packages/git-ui/src/(state|graph|bridge)/|^packages/git-ui/src/(index\.ts|graphVisibility\.ts|shims-vue\.d\.ts)$'),
 (19, r'^packages/git-ui/'),
 (20, SP+r'internal/(ade|adeflow|adeagent|storage)/|'+SP+r'internal/bridge/(ade|agentsessions)'),
 (21, PF+r'ade/|'+SP+r'tests/(ui|unit)/(ade|support/adeV2|support/mockupV2)|'+SP+r'tests/unit/ade|'+SP+r'tests/fixtures/ade-v2/'),
 (22, r'^apps/kira-space/'),
 (23, r'^apps/kira-space-vscode/|^scripts/(build|package)-vscode\.ts$'),
]
CODE=re.compile(r'\.(go|ts|vue|js|mjs|css|sh|sql|lua|fbs)$')
files=[f for f in subprocess.check_output(['git','ls-files'],text=True).split('\n') if f]
def lines(f):
    try: return open(f,'rb').read().count(b'\n')
    except OSError: return 0
own=collections.defaultdict(list); excl=collections.defaultdict(list); orphan=[]
for f in files:
    k=next((n for n,p in X if re.search(p,f)),None)
    if k: excl[k].append(f); continue
    hit=next((n for n,p in R if re.search(p,f)),None)
    if hit is None: orphan.append(f); continue
    own[hit].append(f)
streams={'A':0,'B':0}; tot=0
for n in sorted(own):
    fl=own[n]; code=sum(lines(f) for f in fl if CODE.search(f))
    tests=sum(lines(f) for f in fl if CODE.search(f) and re.search(r'_test\.go$|\.spec\.ts$|\.test\.ts$|/tests/',f))
    s='A' if n<=13 else 'B'; streams[s]+=code; tot+=len(fl)
    print(f"Part {n:2d} [{s}] files={len(fl):4d} codelines={code:6d} (tests {tests:6d})")
print('streams code lines:',streams)
print('owned files:',tot,'excluded:',{k:len(v) for k,v in excl.items()},'orphans:',len(orphan),'tracked:',len(files))
for f in orphan: print('ORPHAN',f)
if len(sys.argv)>1:
    for f in own[int(sys.argv[1])]: print(f)
```

Rule order matters only for the catch-alls (Part 8's root files, Part 13's rest of Studio and
`shared`, Part 19's rest of `git-ui`, Part 22's rest of Space). `python3 <script> <N>` lists
Part N's files.
