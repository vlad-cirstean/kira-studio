# P108 Part 1 — whole-codebase review: chunk pre-plan and stream assignment

Splits the whole tree into 19 review chunks across 2 streams. It does not review code. Each chunk
later gets its own Opus review plan, one Opus reviewer and one Sonnet fixer (SPEC row, Part 2
onward). Tree surveyed: `d45eb28` (P107 iter2 closing sweep merged).

Paths repo-relative. `Studio` = `apps/kira-studio`, `Space` = `apps/kira-space`, `vscode` =
`apps/kira-space-vscode`, `SF` = `Studio/frontend/src`, `PF` = `Space/frontend/src`, `SA` =
`Studio/internal/adapters`, `SI` = `Studio/internal`, `PI` = `Space/internal`. Line counts are
`wc -l` over tracked `.go`/`.ts`/`.vue` at `d45eb28`, tests included.

## 0. Method

- **CodeGraph index, aggregated.** `.codegraph/codegraph.db` copied to the scratchpad and read via
  `bun:sqlite` (P107's method). Every `calls`/`references`/`instantiates`/`imports`/`implements`/
  `extends` edge was rolled up to a module key (Go package, TS package subdir, Studio view dir),
  production files only. Two noise filters: cross-language edges dropped (all are name
  collisions: no Go/TS call edge exists) and Go edges between the two apps dropped (Go's
  `internal/` rule makes them impossible). 965 module pairs remain. §2 quotes the ones that
  decide a boundary.
- **`codegraph_explore`, targeted.** Four calls on the boundaries the split depends on: Studio
  composition root (`main.go` `wireAdapters`/`wireGit`, `adapters.Adapter`), page wire
  (`page/encode.go` to `shared/protocol/frame.ts` `decodeFrame`, sole TS caller
  `SF/bridge/port.ts`), git IPC (`gitrpc.Router`/`Handlers`, `gitsock.Server`, `git-ipc`
  `createRpcClient`/`Transport`, `vscode/src/proxyHandlers.ts`), Studio data plane
  (`adapterhost.Dispatcher` over `enginecache`, callers `dataframe.go`/`ipcfixture`/`dbmcp`), and
  the frontend seam (`packages/workbench/src/host.ts` `WorkbenchHost`, each app's
  `workbench/host.ts`, `createTabsStore`'s `TabsHost`). The `codegraph` MCP server exposes only
  `codegraph_explore`; there is no `codegraph_node` to call.
- **Import specifiers, verified.** CodeGraph's TS name resolution over-links (it showed Studio
  views calling `git-ui`, which P106 already found false). Every cross-package claim below was
  re-checked against real `import` lines with `git grep`.
- **Churn.** The clone is shallow: history reaches back only to `d84a7c4` (2026-09-22, P104's
  tail). Churn figures are `git diff --numstat d84a7c4 d45eb28` (P104 tail through P107). P99-P103
  scope comes from their own SPEC rows.

## 1. What SPEC fixes, what this plan decides

SPEC fixes: one Opus reviewer per chunk, freeform "any bug or issue", edge cases weighted; Opus
writes each chunk's review plan; Sonnet fixes every finding; 2 parallel streams; chunks run one at
a time within a stream; a chunk's scope is its own files plus one hop out on both call-graph
edges; a chunk whose one-hop set overlaps a chunk open in the other stream shares its stream or
waits.

This plan decides: chunk count and boundaries (§4, §5), stream and order (§3), when a stream waits
(§3.2), and who may edit what (§3.3).

## 2. Coupling findings

Aggregate edge counts, production code, filtered as §0 describes.

- **The two apps never import each other.** Zero real imports between `Studio` and `Space`/
  `vscode`/`git-*` in either direction, Go or TS (verified by `git grep`). Every shared edge runs
  through exactly two bases: Go `internal/*` and the TS packages `workbench`, `theme`, `kira-ui`,
  plus part of `shared`.
- **Go base consumers.** Studio: `SI/bridge` (27 files, 176 edges into `ipcerr` alone),
  `SI/storage` (20 files; 53 into `appsettings`, 17 `appstorage`, 16 `sqlitex`), plus
  `adapterhost`, `adapters` (`jsonx` only, one file), `agenthooks`, `appcore`, `appshell`,
  `config`, `connections`, `dbmcp`, `ipcfixture`, `maskrules`, `mcpauth`, `mcpinstall`,
  `metrics`, `oplog`, `preconnect`, `secrets`, `tree`. Space: `PI/gitrpc` (16 files, 80 into
  `ipcerr`), `PI/storage` (14), `PI/bridge` (11), `gitsock` (`notify`, `rpcstream`), `gitreview`
  (`sqlitex`), `gitaskpass` (`localsock`), `gitclient`, `ghclient`, `gitvsix`, `codeworkspace`,
  `appshell`, `appcore`, `config`. `rpcstream` is Space-only in practice (`gitsock/server.go`,
  `bridge/gitstream.go`); `jsonx` is Studio-only (`adapters/redis/read.go`,
  `storage/model/mutations.go`).
- **TS base consumers (real import lines).** `packages/workbench`: 140 Studio files, 36 Space, 6
  `git-ui`, 1 `git-ipc`, 1 `vscode`. `packages/theme`: 96 Studio, 21 Space, 12 `workbench`.
  `packages/kira-ui`: 41 `git-ui`, 1 `workbench` (`util/floatingPosition.ts`), 1 Studio
  (`SF/views/stream/StreamView.vue`). `packages/shared`: 230 Studio, 13 Space, 15 `workbench`,
  13 `api-core`.
- **`packages/shared` is mostly Studio's.** Only `protocol/events.ts` (`CHANNEL`, `TerminalEvent`:
  `PF/bridge/index.ts`, `workbench/src/bridge/createCoreControl.ts`,
  `workbench/src/state/createTerminalsStore.ts`) and ten `domain/` files (`base64`, `color`,
  `connection`, `git`, `layout`, `path`, `repo`, `settings`, `shortcuts`, `tabs`) are imported
  outside Studio. The rest of `protocol/` is the Studio engine wire; the rest of `domain/` (sql
  lexer/linter/splitter, mask, http, ops, …) is Studio-only.
- **Dense clusters (where a chunk must not be cut).** `SA` to `SI/storage` 679 (the `model`
  types), `SA` to `SI/page` 299, `adapterhost` to `adapters` 71 and to `page` 67;
  `gitsession` to `gitclient` 265, to `gitpreflight` 221, to `gitops` 107, to `gitreview` 100;
  `gitrpc` to `gitsession` 153; `git-ui/components` to `kira-ui` 361 and to `git-ui/state` 279;
  `git-ui/state` to `git-ui/bridge` 176; `SF/views/console` to `SF/views/shared` 253, `grid` to
  `shared` 223, `documents` to `shared` 113.
- **Cross-language mirrors (no call edge, same contract).** Page wire: `SI/page/encode.go` +
  `SI/adapterhost/frame.go` to `packages/shared/protocol/frame.ts` (both sides generated from
  `wire.fbs`). Git wire: `PI/gitwire` to `packages/git-ipc/src/generated` +
  `graphChunkCodec.ts`. Git RPC: `gitrpc` handler table to `git-ipc/src/contract.ts`. Mask:
  `SI/mask` to `shared/domain/mask.ts` (`tests/unit/mask-parity.spec.ts`). Query plans:
  `SI/queryplan` to `SF/views/console` plan parsers. Settings: `internal/appsettings` +
  `SI/storage/model` to `shared/domain/settings.ts`. Vocabulary:
  `tests/unit/go-ts-vocabulary-parity.spec.ts`. Wails bindings are generated and gitignored.

## 3. Streams

### 3.1 Split by app

**Stream A = Kira Studio, opened by the shared Go base. Stream B = Kira Space, opened by the
shared frontend base.** §2's first finding decides it: once both bases close, no Studio chunk's
one-hop set can overlap any Space chunk's, so the two streams never need to wait on each other
again. Each app's own cross-language mirrors (page wire, mask, git wire, git RPC) stay in one
stream, so a two-sided mirror fix never crosses streams.

Load is uneven: A ≈ 217k lines over 11 chunks, B ≈ 152k over 8. Declined rebalancing, with the
requirement named: moving any Studio chunk into B puts it next to Studio chunks whose own files
are its one-hop callers/callees (storage, bridge, `views/shared`, `state`), which breaks the SPEC
rule. §7 covers the language split, the obvious balanced alternative.

### 3.2 Gates

Only two, both at the start:

- **G1.** Part 14 (B2, first Space Go chunk) starts only after Part 2 (A1, shared Go base) is
  committed. Every Space Go chunk one-hops into `internal/*`.
- **G2.** Part 6 (A5, first Studio chunk holding TS) starts only after Part 13 (B1, shared frontend
  base) is committed. Parts 3-5 (A2-A4) are pure Go and may run while B1 is open.

Parts 2 and 13 start together. Part 2's own set (Go) and one-hop set (Go callers in both apps) are
disjoint from Part 13's (TS). After G1 and G2 the streams run free.

### 3.3 Edit scope

- A fixer edits its own chunk's files and one-hop files owned by an earlier or later chunk **in its
  own stream**. The stream is sequential, so this never races.
- **Shared-base files have one owning stream after they close:** `internal/*` and repo tooling
  (A1's set) belong to stream A; B1's set belongs to stream B. A fix that needs the other stream's
  base file is not made in place. The fixer records it (file, finding, proposed change) in its
  report. The orchestrator runs it as a fix-only Sonnet step in the owning stream, between that
  stream's chunks, as its own commit naming the originating Part. Once the owning stream has
  finished its last chunk, the originating fixer may make the edit directly.
- One known cross-stream mirror: Go settings (`internal/appsettings`, A1) against
  `shared/domain/settings.ts` (B1), both open at once during Parts 2/13. A settings-schema finding
  there fixes its own side if that side alone is correct. Otherwise it hands the other side off
  per the rule above. The handed-off half is the owning stream's first step after its
  position-1 chunk commits.
- `.github/workflows/*` cannot be pushed from this session. Workflow fixes follow
  `docs/DEV_ENVIRONMENT.md`'s `docs/pending-changes/` procedure. That directory already holds one
  pending patch each for `pr.yml` and `release.yml`; merge into those patches, never a second one.

## 4. Chunk summary

Execution order runs top to bottom within each stream.

| Part | Stream/pos | Chunk | ~Lines |
|---|---|---|---|
| 2 | A1 | Shared Go base and repo tooling | 10k |
| 3 | A2 | Studio persistence, secrets and connection lifecycle | 18k |
| 4 | A3 | Studio DB adapters I: adapter core and SQL engines | 23k |
| 5 | A4 | Studio DB adapters II: document, key-value, stream, object-store engines | 15k |
| 6 | A5 | Studio engine data plane and page wire protocol | 19k |
| 7 | A6 | Studio Go app shell, Wails bridge, agent integrations | 18k |
| 8 | A7 | Studio API client backend | 17k |
| 9 | A8 | Studio API client UI | 20k |
| 10 | A9 | Studio grid and shared view machinery | 24k |
| 11 | A10 | Studio query console, SQL editor, per-kind data views | 24k |
| 12 | A11 | Studio shell, project tree, state stores, UI-test harness | 29k |
| 13 | B1 | Shared frontend base | 14k |
| 14 | B2 | Space git process layer | 14k |
| 15 | B3 | Space git preflight, ops, review, search, graph store | 15k |
| 16 | B4 | Space git session | 17k |
| 17 | B5 | Space git RPC, socket server, `git-ipc` contract | 23k |
| 18 | B6 | `git-core` and `git-ui` logic | 21k |
| 19 | B7 | `git-ui` components | 20k |
| 20 | B8 | Kira Space hosts: desktop app and VS Code extension | 28k |

Within a stream the order runs bottom-up where the call graph allows (callees before callers), so
each chunk's one-hop callees are already reviewed and settled. Studio's frontend is the one
exception, named in A11.

## 5. Chunks

Every chunk's one-hop lists below are package/directory-granular. Its own review plan narrows them
to exact files and symbols with CodeGraph.

### 5.1 Part 2 — A1: Shared Go base and repo tooling

- **Own.** `internal/**` (all 20 packages: `appevent`, `appsettings`, `appstorage`, `ipcerr`,
  `jsonx`, `kirapaths`, `kiratime`, `layeringtest`, `localsock`, `logging`, `notify`,
  `pathsafe`, `rpcstream`, `shell`, `sqlitex`, `startupfail`, `terminal`, `testx`, `tokenauth`,
  `toolexec`). Repo tooling: `scripts/*.sh` except `db-compat.sh`, `test-matrix.sh` and
  `demo-dbs/` (A3), `.githooks/*`, `.claude/hooks/*`, root `package.json` scripts, `biome.json`,
  `knip.json`, `.golangci.yml`, root `tsconfig*.json`, `.github/workflows/*` (read, §3.3).
- **Callers.** Every Go importer §2 lists, both apps, plus both `main.go` (`startupfail`,
  `logging`, `shell.NewCloseFlushCoordinator`).
- **Callees.** Stdlib, Wails runtime, SQLite driver, the `git`/shell binaries (`toolexec`).
- **Watch.** P103 Part 3 hoisted shell, terminal and events into `internal/shell` and
  `internal/terminal` (per-window flush handshake; SPEC called Space's copy "trimmed", which
  proved stale). P103 Part 4 composed `model.Settings` from `appsettings`. P107 extracted
  `appstorage.ScanLayoutRows` and reused `notify.Emitter`. `startupfail` is now per-app via
  `NewReporter(Deps)`, no process-wide default (P100). Recent churn: `appstorage` 439, `shell`
  299, `terminal` 249, `notify` 183. P106 renamed 15 root scripts: check every hook, script and
  Taskfile call site against the new `:studio` names. Mirror: `appsettings` against
  `shared/domain/settings.ts` (§3.3).

### 5.2 Part 3 — A2: Studio persistence, secrets and connection lifecycle

- **Own.** `SI/storage/**` (`db.go`, `migrations`, `model`, `repos`), `SI/secrets`,
  `SI/localauth`, `SI/connections`, `SI/preconnect`, `SI/datagrip`. Pure Go (Studio-only
  `shared/domain` TS mirrors go to A11), so it may run while B1 is open.
- **Callers.** `SA/**` (`model` types), `SI/bridge`, `adapterhost`, `apivars`, `postman`,
  `maskrules`, `oplog`, `tree`, `dbmcp`, `ipcfixture`, `main.go` (`openCore`, reveal
  `authorizer` shared with `apivars`).
- **Callees.** `internal/{appsettings,appstorage,sqlitex,kiratime,ipcerr}` (A1, closed),
  `SA` (`connections` connects through the registry), `apivars`.
- **Watch.** P107 I2-1 consolidated the leaf-table repos (layout/settings `Set` transactions,
  `upsert*Section` chains): check each leaf key still round-trips. P103 Part 4 split the settings
  schema. Migrations ordering against `model`. The reveal grace is shared by one `authorizer`
  instance: connection-password and variable reveals must still agree. Churn: `storage` 2,234.

### 5.3 Part 4 — A3: Studio DB adapters I (adapter core and SQL engines)

- **Own.** `SA/*.go` (`adapter.go`, `registry.go`, `caps.go`, `tracker.go`, `errors.go`,
  `classify.go`, `live.go`, `connset.go`, `rowops.go`, `sqlmutate.go`, `sqltext.go`,
  `relationalpage.go`, `format.go`, `tree.go`, `abort.go`), `SA/testsupport`, `SA/postgres`,
  `SA/mysqlfamily`, `SA/mysql`, `SA/mariadb`, `SA/sqlite`, `SA/clickhouse`, `scripts/demo-dbs/**`,
  `scripts/db-compat.sh`, `scripts/test-matrix.sh`.
- **Callers.** `adapterhost` (`Dispatcher`, `runOp`), `dbmcp`, `tree`, `connections`,
  `SI/bridge` (schema, stream), `ipcfixture`, `main.go` `wireAdapters`, A4's engines (core only).
- **Callees.** `SI/storage/model`, `SI/page` builders, `internal/jsonx`, drivers.
- **Watch.** Highest churn in the tree (`SA` 5,156 lines, 94 files). P107 T2-3 moved running-query
  bookkeeping into `adapters.QueryTracker`: each adapter's `mu` now guards only its handle, so
  check `Drain` on `Disconnect`, release identity on multi-statement ops, and cancel races. Each
  `Caps()` false must match an `Unsupported` return that no caller reaches. Conformance suites
  (`SA/*/*_test.go`) are exempt from the unit-test bar (`CLAUDE.md`). Keep per-capability
  coverage there; prune only true duplicates.

### 5.4 Part 5 — A4: Studio DB adapters II (document, key-value, stream, object-store engines)

- **Own.** `SA/mongo`, `SA/redis`, `SA/kafka`, `SA/sqs`, `SA/s3`, `SA/awscfg`.
- **Callers.** Same as A3.
- **Callees.** A3's adapter core (closed), `SI/storage/model`, `SI/page`, SDK clients.
- **Watch.** Go concurrency the TS source never had: `sqs` queue-URL cache and receipt handles,
  `kafka` ephemeral browse clients (P58e E5), `mongo` `inFlight` WaitGroup against
  `Disconnect`, `redis` per-db connection set. Leaf-returns-`[]` rule 5 in `Children`.

### 5.5 Part 6 — A5: Studio engine data plane and page wire protocol

- **Own.** `SI/adapterhost`, `SI/enginecache`, `SI/page` (hand-written; `page/wire` is generated,
  boundary only), `SI/tree`, `SI/oplog`, `SI/ipcfixture`; `packages/shared/protocol/**` except
  `events.ts` (`protocol/wire/` generated, boundary only); `packages/db-fixtures/**`;
  `SF/bridge/*`; `shared/domain/{mutations,ops,object-store,tree}.ts`; `Studio/tests/ipc/**`,
  `Studio/tests/e2e-real/**`, `Studio/tests/support/**`, `tests/unit/bridge-*.spec.ts`.
- **Gate.** G2: waits for Part 13.
- **Callers.** Go: `SI/bridge`, `dbmcp` (`Query.Execute`), `main.go`. TS: every `SF` store and
  view calling `SF/bridge/data.ts`/`control.ts`. `decodeFrame`'s only caller is
  `SF/bridge/port.ts`.
- **Callees.** `SA` (A3/A4, closed), `SI/storage`, `SI/connections`, `SI/grpcclient` (page
  builders), `@workbench/bridge` and `protocol/events.ts` (B1, closed).
- **Watch.** Wire mirror, both halves in this chunk: `encode.go`/`frame.go` against `frame.ts`
  (P107 I2-40 consolidated the document/kv/stream decoders; I2-45 added `sumChunkBytes` to each
  page `Finish`). `ExecuteResponse` copy-on-multi-page rule. `Mutate` invalidates the cache even
  on failure (P43 F12). A cache hit must never enter the op log. `port.ts`: `ready` gating,
  timeouts starting before the open ack, `rejectAllPending`. Generated code is excluded;
  regenerate via `scripts/generate-wire.sh` if a schema change is ever needed.

### 5.6 Part 7 — A6: Studio Go app shell, Wails bridge and agent integrations

- **Own.** `SI/bridge/**`, `SI/appshell`, `SI/appcore`, `SI/appupdate`, `SI/keepawake`,
  `SI/metrics`, `SI/config`, `SI/buildinfo`, `Studio/main.go`, `Studio/cmd/**`,
  `SI/layering_test.go`, `SI/dbmcp`, `SI/queryplan`, `SI/mask`, `SI/maskrules`, `SI/mcpauth`,
  `SI/mcpinstall`, `SI/agenthooks`, `shared/domain/{mask,dbmcp,agent}.ts`,
  `tests/unit/{mask-parity,agent-activity-reducer}.spec.ts`, `Studio/Taskfile.yml`,
  `Studio/build/**`.
- **Callers.** Wails bindings (generated) called from `SF` stores; the MCP clients (Claude Code)
  over `dbmcp`; the Claude Code hook process over `agenthooks`.
- **Callees.** Every Studio Go service package (A2-A5 closed, A7 open later in this stream),
  `internal/{shell,terminal,appevent,ipcerr}` (A1).
- **Watch.** The bridge is the hub and gets reviewed after every Go subsystem it fans into.
  P107 I2-44 extracted the dbmcp read-gate preamble: check every schema tool still refuses under
  read-mode deny. Masked-connection error path (`maskedToolError`) must never leak a raw driver
  message. Approval flow ordering is verdict, then explain, then at most one approval, then
  execute. Mirrors: `mask.go` against `mask.ts`; `queryplan` against the console plan parsers
  (A10, read). `bridge/collections_*_atomicity_test.go` guard import/export rollback.

### 5.7 Part 8 — A7: Studio API client backend

- **Own.** `SI/httpclient`, `SI/grpcclient`, `SI/apivars`, `SI/postman`, `packages/api-core/**`,
  `shared/domain/{http,collections,grpc,grpc-history,response-history,variables}.ts`,
  `tests/unit/go-ts-vocabulary-parity.spec.ts`.
- **Callers.** `SI/bridge/{http,grpc,grpchistory,collections,variables,responsehistory}.go`
  (A6, closed); `SF/api`, `SF/views/{httprequest,grpcrequest}` (A8, next) into `api-core` (126
  edges).
- **Callees.** `SI/storage` repos, `secrets` cipher, the reveal `authorizer` (A2, closed).
- **Watch.** Variable reveal grace and secret isolation. Postman import atomicity. gRPC
  reflection/schema supersession. Go/TS history vocabulary parity.

### 5.8 Part 9 — A8: Studio API client UI

- **Own.** `SF/api/**`, `SF/views/httprequest/**`, `SF/views/grpcrequest/**`; `tests/unit/api-*`,
  `grpc-*`, `history-runtime-reactivity`; `tests/ui/http-*`, `grpc-request`, `collections`,
  `api-*`, `secrets`, `credential-reveal`.
- **Callers.** `SF/workbench/tabViews.ts`, `SF/App.vue` (`ApiDialogs`), tab kinds (A11).
- **Callees.** `packages/api-core` (A7), `SF/views/shared/request/*` and `SF/editor` (A9/A10,
  later in this stream), `SF/state`, B1 packages (closed).
- **Watch.** P99 Part 3 moved this whole surface onto shadcn-vue, Pinia and TanStack Query (39
  files): stale-cache and invalidation edges after mutations, and query keys. P104 primitive
  swap. P105 disabled-trigger tooltips. Churn: `SF/api` 1,107, `grpcrequest` 723,
  `httprequest` 664.

### 5.9 Part 10 — A9: Studio grid and shared view machinery

- **Own.** `SF/views/shared/**`, `SF/views/grid/**`; the grid/slick/page/cell `tests/unit`
  specs (`grid-*`, `slick-*`, `kira-slick-grid`, `column-widths-cache`,
  `page-store-cell-cache`, `resolve-column-order`, `row-*`, `scan`, `match-index`,
  `timestamp-two-digit-year`, `view-*`, `fake-data-*`, `ejson`, `document-row-height-cache`);
  `tests/ui/{slick-grid,data-view,cell-editor,mutations,row-coloring,scroll-trace,fake-data}`.
- **Callers.** Every Studio data view: `console` 253 edges, `grid` 223, `documents` 113,
  `stream` 64, `httprequest` 55, `grpcrequest` 27.
- **Callees.** `SF/state` (`page` stores, cell selection), `SF/bridge` (A5, closed),
  `protocol/page.ts`, SlickGrid, B1 packages.
- **Watch.** P99 Part 4 migration. `views/shared` churn 2,578, the largest frontend area. Page
  store cursor/boundary arithmetic, selection model edges, clipboard format safety, SQL literal
  escaping, staged edits against composite/PK-less tables.

### 5.10 Part 11 — A10: Studio query console, SQL editor and per-kind data views

- **Own.** `SF/views/console/**`, `SF/editor/**`, `SF/beautify.ts`,
  `SF/views/{documents,keyvalue,stream,browse,definition}/**`,
  `shared/domain/{sql-keywords,sql-lex,sql-lint,sql-split,sql-tokens,console,definition,editor,schema,queries,streamFilter}.ts`;
  `tests/unit/{console-*,explain-*,sql-*,ddl-schema,schema-*,find-ranges-memo,paint-spans-merge,hover-value-caption,autocomplete-tokenizers,sigma-count-refresh,document-*,mongo-sort-document-roundtrip,browse-key-types,stream-*,sqs-mutation-never-polls}`
  except `document-row-height-cache` (A9); `Studio/tests/fixtures/**`;
  `tests/ui/{console*,autocomplete,sql-schema,definition,document-view-readonly}`.
- **Callers.** `SF/workbench/tabViews.ts`, tab kinds (A11), `SF/views/httprequest` (editor).
- **Callees.** `SF/views/shared` (A9, closed), `SF/state` (schemas, run state), Monaco,
  sql-formatter, B1 packages, `SF/theme/completion.ts` (A11).
- **Watch.** Auto-explain races (stop, overlap, clobber, run-after-tab-close). The splitter and
  linter are parsers with interacting rules. Stream view: P105 §5.2(a) moved its ten column
  handles onto `KuiColumnResizeHandle` from `kira-ui` (B1). Churn: `documents` 1,168, `stream`
  1,098, `console` 866.

### 5.11 Part 12 — A11: Studio shell, project tree, state stores and UI-test harness

- **Own.** `SF/{App.vue,main.ts,fonts.ts}`, `SF/workbench/**`, `SF/project/**`, `SF/state/**`,
  `SF/theme/**`, `SF/shortcuts/**`, `SF/terminal/**`, `SF/views/terminal/**`,
  `Studio/frontend/vite.config.ts`, `Studio/playwright.config.ts`,
  `shared/domain/{mode,uri,tree-filter,datagrip,secrets,scripts}.ts`; `tests/ui/support/**`,
  `tests/ui/{fixtures.ts,global.d.ts}`, `tests/visual/**`, every remaining `tests/unit` and
  `tests/ui` spec (`tabs-*`, `tree-*`, `ops-markraw`, `run-state`, `mongo-srv-uri`, `smoke`,
  `workbench`, `tabs`, `tree`, `connections`, `connection-dialog-tabs`, `preconnect`,
  `datagrip-import`, `mode-switch`, `operations`, `settings-*`, `mask-preview`,
  `terminal-module`, `tooltips`, `update-banner`, `font-roles`, `control-sizing`, `interaction`,
  `leaks`, `perf`, `budgets`).
- **Callers.** None above it: this is the app root.
- **Callees.** Every Studio view (A8-A10, closed), `SF/bridge` (A5), B1's `WorkbenchHost`,
  `createTabsStore`, terminal and settings components (closed).
- **Watch.** Last in the stream on purpose. `state/**` is a callee of every view, which breaks
  bottom-up order. Earlier view fixers may edit it (same stream). This pass then re-reviews it
  with every caller settled. P103 Part 2's `TabsHost` hooks (`onOpened`, `onClosed`,
  `onDuplicated`, `persistable`: incognito tabs must never persist, even duplicated). P99 Part 2
  shell migration. Churn: `workbench` 1,465, `SF/theme` 1,171, `project` 990. Spec files that
  map to an earlier chunk's source stay with that chunk: the lists above are defaults, and a
  misplacement costs nothing because the stream is sequential.

### 5.12 Part 13 — B1: Shared frontend base

- **Own.** `packages/workbench/**` (including `src/testing`), `packages/theme/**`,
  `packages/kira-ui/**`, `packages/shared/caps.ts`, `packages/shared/protocol/events.ts`,
  `packages/shared/domain/{base64,color,connection,git,layout,path,repo,settings,shortcuts,tabs}.ts`.
- **Callers.** Studio: `SF/workbench`, `api`, `project`, `state`, `bridge`, every view,
  `packages/api-core`, `tests/**`. Space: `PF/workbench`, `repo`, `views/repo`, `state`,
  `bridge`. `git-ui` (`components` into `kira-ui`, 361 edges; 6 files into `workbench`),
  `git-ipc` (1), `vscode` (1).
- **Callees.** Vue, reka-ui (shadcn-vue), VueUse, Pinia, floating-ui, xterm; Studio-owned
  `shared/domain/{mode,queries,tree}.ts` (read; A11/A10/A5 own them, and they stay untouched while
  this runs because Parts 3-5 are Go-only).
- **Watch.** P103 Parts 1-2 created this package set (the verbatim tier, then `WorkbenchHost`
  and `createTabsStore` parameterized over both apps). The host is a structural subset of each
  app's Pinia store, so check both apps still satisfy it. P104 replaced hand-rolled primitives
  with shadcn-vue. P105 added `TooltipDisabledTrigger` and `KuiColumnResizeHandle`. The
  `--color-muted` collision (`theme/src/base.css:33` against `shadcn-bridge.css`) is P110's own
  row: out of scope here, do not re-find or fix it.

### 5.13 Part 14 — B2: Space git process layer

- **Own.** `PI/gitclient/**` (including `catfile`, `porcelain` and its `testdata`),
  `PI/ghclient`, `PI/gitpath`, `PI/gitaskpass`.
- **Gate.** G1: waits for Part 2.
- **Callers.** `gitsession`, `gitrpc`, `gitsearch`, `gitpreflight`, `gitops`, `gitreview`,
  `gitprepare`, `gitwire`, `gitvsix`, `codeworkspace`, `Space/main.go` (`wireGit`, `askpass`
  argv shim).
- **Callees.** `internal/{toolexec,pathsafe,localsock,kirapaths}` (A1, closed), the `git` and
  `gh` binaries.
- **Watch.** Porcelain parsing of NUL/0x1f-separated output (CRLF subjects, empty bodies,
  trailers, signed commits, renames, binary and LFS diffs). The `cat-file --batch` size gate
  (`Check` before `Read`, `ErrTooLarge`) and newline-in-rev fallback. `Repo.Read`/`Write` slot
  accounting against cancellation. Askpass credential handling is security-relevant. P100 Part 1
  moved all of it out of Studio.

### 5.14 Part 15 — B3: Space git preflight, ops, review, search and graph store

- **Own.** `PI/gitpreflight`, `PI/gitops`, `PI/gitreview`, `PI/gitsearch`, `PI/gitprepare`,
  `PI/gitstore`, `PI/gitwire`.
- **Callers.** `gitsession` (221 into `gitpreflight`, 107 `gitops`, 100 `gitreview`), `gitrpc`.
- **Callees.** `gitclient`, `ghclient` (B2, closed), `PI/storage` (B8, later: `gitreview`,
  `gitsock`), `internal/sqlitex`.
- **Watch.** P107 I2-46 table-drove `ContinueArgs`/`AbortArgs`/`SkipArgs`: check per-op flags.
  Mirror: `gitwire` against `git-ipc/src/generated` + `graphChunkCodec.ts` (B5, read).

### 5.15 Part 16 — B4: Space git session

- **Own.** `PI/gitsession/**`.
- **Callers.** `gitrpc` (153), `gitsock`, `gitaskpass`, `PI/bridge`, `Space/main.go`
  (`gitsession.NewRegistry`, `Settings`/`RepoSettings*` hooks).
- **Callees.** B2 and B3 (closed), `codeworkspace`, `PI/storage`.
- **Watch.** P107 I2-47 extracted `walkForSlot` for `WalkFor`/`ReviewWalkFor`. Registry holds and
  per-connection routing (D18), auto-fetch timers, protected branches. Churn: 538.

### 5.16 Part 17 — B5: Space git RPC, socket server and `git-ipc` contract

- **Own.** `PI/gitrpc`, `PI/gitsock`, `PI/gitvsix`, `packages/git-ipc/**` (`src/generated`
  boundary only).
- **Callers.** Go: `PI/bridge/gitstream.go`, `PI/appshell/stream.go`, `Space/main.go`. TS:
  `git-ui/state` (80), `git-ui/components` (76), `git-ui/bridge`, `PF/repo` (45), `vscode/src`
  (88).
- **Callees.** `gitsession` (B4, closed), `internal/{rpcstream,notify,ipcerr,tokenauth}` (A1).
- **Watch.** Largest Space churn (`gitrpc` 2,010). Both halves of the RPC contract are here:
  handler method table and params against `contract.ts`. `gitsock` handshake/pairing, flock, and
  `Close` against mid-handshake connections (G32 finding #1). Revocation. Per-connection
  `repoSettings.changed` mailbox cap. `streamChannel` connect queue ordering (P67b).

### 5.17 Part 18 — B6: `git-core` and `git-ui` logic

- **Own.** `packages/git-core/**`, `packages/git-ui/src/{state,graph,bridge}/**`,
  `packages/git-ui/src/{index.ts,graphVisibility.ts,shims-vue.d.ts}`.
- **Callers.** `git-ui/components` + `App.vue` (B7, next), `PF/repo`, `vscode/src` (`git-core`
  ports 76, store 21).
- **Callees.** `git-ipc` (B5, closed), `git-core` ports.
- **Watch.** `BridgeClient` (61 callers), review session state, graph order/visibility. Churn:
  `git-ui/state` 1,066.

### 5.18 Part 19 — B7: `git-ui` components

- **Own.** `packages/git-ui/src/components/**`, `packages/git-ui/src/{App.vue,main.ts}`,
  `packages/git-ui/src/{icons,theme,testing}/**`, `packages/git-ui/vite.config.ts`.
- **Callers.** `PF/views/repo`, `PF/repo`, `vscode/src/webview`.
- **Callees.** B6 (closed), `kira-ui` and `workbench` (B1, closed).
- **Watch.** `App.vue` (1,700+ lines) bootstrap and content states. P105's `CommitGrid.vue`
  column and detail-pane resize handles. Churn: `components` 871.

### 5.19 Part 20 — B8: Kira Space hosts (desktop app and VS Code extension)

- **Own.** `PI/bridge`, `PI/appshell`, `PI/appcore`, `PI/codeworkspace`, `PI/storage`,
  `PI/config`, `PI/buildinfo`, `PI/layering_test.go`, `Space/main.go`, `Space/frontend/**`,
  `Space/tests/**`, `Space/playwright.config.ts`, `Space/Taskfile.yml`, `Space/build/**`;
  `vscode/**`, `scripts/build-vscode.ts`, `scripts/package-vscode.ts`.
- **Callers.** None above it: app roots and VS Code activation.
- **Callees.** Everything B2-B7 (closed), B1 (closed), `internal/*` (A1).
- **Watch.** P100 Parts 2-3 extracted and renamed all of this. `vscode/src/proxyHandlers.ts`
  implements `git-ipc`'s `ServerHandlers` and stays vscode-free by design (narrow ports).
  `PI/storage` is a callee of B3-B5 but lands here with its main user, `PI/bridge` (31 edges):
  earlier Space fixers may edit it (same stream). Churn: `PI/storage` 673, `PF/repo` 677.

## 6. Per-chunk loop (Parts 2-20)

- **Review plan.** Opus writes `docs/v1.9/plans/P108-part<N>-<slug>.md`: exact own-file list,
  exact one-hop callers/callees (symbol level), edge cases to weight, the chunk's watch items
  above. It must call `codegraph_explore` for discovery (`CLAUDE.md`'s CodeGraph section:
  `ToolSearch "codegraph"` first). The orchestrator greps the subagent's tool log for real calls
  before accepting.
- **Review.** One Opus agent runs the plan and reports findings, no fixes. It also uses
  `codegraph_explore`, because the review is discovery.
- **Fix.** One Sonnet agent fixes every finding, one commit per finding (Conventional Commits),
  under §3.3's edit scope. A stream's next chunk starts only after this commit lands.
- **Excluded from review.** Generated code: `SI/page/wire`, `packages/shared/protocol/wire`,
  `PI/gitwire`'s generated half, `packages/git-ipc/src/generated`, both apps'
  `frontend/bindings` (gitignored). P110's known `--color-muted` collision. A real currently-true
  limitation a chunk finds but cannot fix in scope goes into its own named follow-up phase in
  `SPEC.md`, never into a result section.

## 7. Declined alternatives

- **Language split (Go stream, TS stream).** Better balanced (≈166k and ≈205k lines), with
  structurally zero call-graph overlap, since no Go/TS call edge exists. Declined because every
  app's IPC boundary would cross streams: page wire, mask, git wire, the git RPC contract and each
  Wails-bound service. A two-sided mirror fix would then need a cross-stream handoff and
  leave a broken commit between the halves. The SPEC's own boundary emphasis ("behaves correctly
  across its immediate boundary") also argues for keeping both sides of an IPC call in one
  stream.
- **About 10 chunks.** At ≈370k lines with tests, 10 chunks average ≈37k lines each before
  one-hop context. That is too much for one reviewer's careful edge-case pass. 19 follows the
  dense clusters in §2, and no cluster is cut. Merges already taken: the Space desktop host with
  the VS Code extension (both are `git-ui` hosts), the console with the per-kind data views (both
  sit on `views/shared` and share result rendering). Merges declined: A3+A4 (≈38k), A7+A8
  (≈37k), B3+B4 (≈32k), B6+B7 (≈41k).
- **Both shared bases in one stream.** That forces the other stream to idle until both close,
  since every chunk in both apps one-hops into one base or the other. One base per stream lets
  both streams start at once (§3.2).
