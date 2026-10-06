# P168 Part 6: review plan, Studio Go app shell, Wails bridge and DB MCP

Chunk A5, Stream A position 5 (pre-plan `P168-prep-plan.md` §5.5). One Opus reviewer runs this
plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `d7f1da9` (`p168-stream-a` = `v2.0` tip; Parts 2-5 fixed, Part 5 findings file
dropped).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`ST` = `apps/kira-studio/tests`, `SD` = `packages/shared/domain`. Line numbers are as of `d7f1da9`;
re-read before citing.

SPEC row and orchestrator agree on the name `P168-part6-go-shell.md`.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamA` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index:
  `.codegraph/` exists; run `sh scripts/codegraph-setup.sh` if missing. Seeds per area:
  - main/lifecycle: `main`, `openCore`, `wireAdapters`, `wireEmbeddedServices`, `wireLifecycle`
    (`beforeFlush`/`teardown`), `wireWindowsAndMenu`, `buildErrorHandler`, `windowStore`;
    `shell.NewQuitter`/`Quitter.Shutdown`, `shell.NewDeferredEmitter`, `appshell`
    `RegisterEngineStream`/`NewDialogs`/`BuildTemplate`.
  - bridge: every `*Service` bound in `main.go:152-180`; `embeddedService`
    `startLocked`/`stopLocked`/`setRunning`/`startIfEnabled`; `Events.Attach`/`Sources`,
    `toWireApprovalSnapshot`; `OpsService.Cancel`; `HttpService.Send`/`Cookies`/`DeleteCookie`,
    `mapHttpError`, `secretReplacer`; `GrpcService`; `CollectionsService` (`GetRequest`,
    `GetGrpcRequest`, `Import`, `Export`, `writeFileAtomically`); `VariablesService.Reveal`;
    `FilesService`; `DataGripService`; `SchemaService`; `ServeEngineStream`.
  - dbmcp: `New`, `buildMCPServer`, `withPanicRecovery`, `bindHTTP`/`tokenVerifier`/`closeHTTP`/
    `Serve`, `resolveEnabled`, `capsOf`, `connectForQuery`, `resolveReadGated`, `resolveVerdict`,
    `maybeExplain`, `awaitApproval`, `runQuery`, `explainQuery`, `planFor`,
    `assertComposedStatementsAreReads`, `maskPlanForMaskedConnection`, `toolError`,
    `maskedToolError`, `renderPage` and the four `render*Page`, `refuseRiskyStatementSyntax`,
    `riskyResultTypeClasses`, `maskedColumnRenamedOrHidden`, `columnRules`, `ApprovalBroker`
    (`Request`/`resolve`/`AbandonAll`), `modesOf`/`verdictFor`/`strictestOf`.
  - bridge/dbmcp.go: `NewDbMcpService`, `dbMcpTokenProviderFor`, `remintDbMcpToken`,
    `helperTokenMatchesRecord`, `helperTokenValid`, `SetEnabled`, `Regenerate`,
    `InstallClaudeCode`, `explainThreshold`.
  - mcpauth: `MintTTL`, `Check`, `TokenVerifier`, `LoadOrMintTTL`, `Save`, `SaveHelperToken`,
    `LoadHelperToken`, `atomicWrite0600`. mcpinstall: `Install`, `Command`,
    `EnsureHeaderHelperScript`, `shellSingleQuote`, `locateClaude`, `isNotRegisteredError`.
  - mask/maskrules: `mask.Apply`/`MaskNullable`/`Stricter`/`Set.RuleFor`, the per-kind maskers,
    `tag`; `maskrules.Service` (`MaskSetFor`, `invalidate`, `store`, `Upsert`, `Remove`,
    `RegenerateKey`); TS `SD/mask.ts` `maskNullable` and its helpers.
  - queryplan: `Explainable`, `StatementsFor`, `Supported`, `FromPages`, per-dialect `parse*Plan`,
    `issues.go`, `metrics.go`.
- **CodeGraph over-links names.** `Server`/`Close`/`Start`/`Status`/`Install`/`Cancel`/`Events`
  exist in Space (`gitsock`, `adeagent`, `gitvsix`, `bridge`), in root `internal/*` and in every
  engine. Confirm every cross-package claim with `git grep` of import lines (Go's `internal/` rule
  makes those authoritative).
- **Library source** where a claim turns on library behavior: `github.com/modelcontextprotocol/
  go-sdk` (`auth.RequireBearerToken`, `NewStreamableHTTPHandler` `Stateless`, request body
  limits, per-request ctx cancel on client disconnect), `net/http` (`CrossOriginProtection`,
  `Server.Shutdown`), `net/http/cookiejar` (no delete API, `SetCookies` expiry keyed by
  domain/path/name, host-only vs domain cookies, what `Cookies(u)` returns), Wails v3
  `application` (`NewService` method exposure, `OnShutdown`/`ShouldQuit` order, `HandleStream`),
  `github.com/rivo/uniseg` against `Intl.Segmenter`.
- **Scratch probes** in the session scratchpad or a throwaway `_test.go`/`.spec.ts`, deleted
  before the findings commit, never committed, where a claim turns on runtime behavior (a shell
  round trip of `mcpinstall.Command`; a `maskrules` invalidate racing `MaskSetFor`; a cookie jar
  delete by domain/path; an MCP request with a huge body).
- **Checks:** `go vet` and `go test -race` over `./apps/kira-studio/internal/{bridge,appshell,
  appcore,buildinfo,config,dbmcp,queryplan,mask,maskrules,mcpauth,mcpinstall}/...`,
  `./apps/kira-studio/internal` (`layering_test.go`), `./apps/kira-studio/cmd/...` and
  `go build ./apps/kira-studio/...`; `bun test ST/unit/mask-parity.spec.ts
  ST/unit/explain-plan.spec.ts ST/unit/explain-truncated.spec.ts`; `bun run typecheck`. UI tier
  touching this chunk's surfaces: `bun run test:ui:studio -- --grep
  "settings-claude-code|mask-preview|connections|update-dialog"` (mock runtime; confirm the specs
  still exercise the bound methods' shapes). Docker daemon is up at plan time (`docker info`
  succeeds): run `go test ./apps/kira-studio/internal/ipcfixture/...` once (it boots
  `bridge.MaskRulesService`/`OpsService` through `harness.go`). Missing deps or bindings:
  `bun install --frozen-lockfile` and `bun run setup` (or `sh scripts/prepare-worktree.sh`). A red
  check is a finding.
- **`claude` CLI** is on `PATH` here (`/opt/node22/bin/claude`). A probe of `mcpinstall.Install`
  may run it with `--scope user` only against a scratch `HOME`; never against the real user config.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `d7f1da9`. **Part 6: 95 files, 14,755 to 14,757 code lines (tests
4,462 to 4,464).** One Part 6 file changed since `f40cd35`: `SI/dbmcp/render_test.go` +2 lines,
by Part 5 `21c1338` (stream `Body` now `*string`; `render.go` already read it through `cellAt`, no
production edit). P166 also removed `bridge/engine.go` before `f40cd35` (`5fa3720`); not drift.

Drift elsewhere, none touching a Part 6 file:
- Part 2: 148 files, 20,159 lines (tests 8,088): unchanged.
- Part 3: 143 files, 27,825 (8,712): unchanged since Part 5's plan.
- Part 4: 76 files, 16,747 to 16,751 (7,754): Part 5's `kafka/read.go`, `sqs/read.go` edits.
- Part 5: 110 to 119 files, 21,623 to 21,695 (10,822 to 10,970): its fixer's golden-frame test
  (`c013e93`), fixture sync spec (`e901ab0`), dead zod schemas removed (`f33f54f`).
- Part 10: 23,917 (10,431). Part 11: 30,574 (10,074). Part 13: 26,924 (14,858). All Stream C.
- Stream B: Part 14 16,275; 15 15,641; 16 19,279; 17 23,594; 20 20,312; 21 17,327.
- Totals: streams A 257,899, B 183,492; 2,898 owned, 0 orphans, 3,536 tracked (docs 485).
- **Stream drift (SPEC `8a008bd`, not in the script):** Parts 10-13 are Stream C. The script
  still labels them `[A]`. Edit scope follows the SPEC (§8).

P166/P167: findings `a37fdec` and `8a98250` name no Part 6 path (P167's one `main.go` hit is
Space's). Both findings files are deleted on this branch and on `v2.0`. Pre-plan churn for this
chunk was 28 lines (P164 connections tiles, P166 `EngineService` drop). Review the whole chunk,
not a diff.

## 2. Own file set (95 files)

64 production code files (10,293 lines), 24 test code files (4,464), 7 non-code build files (509
lines, not counted). Per area (prod files/lines; test files/lines):

- **`SI/bridge`** (30/3,998; 7/1,618): `grpc` 545, `collections` 460, `dbmcp` 451, `http` 415,
  `variables` 276, `files` 171, `events` 167, `keepawake` 139, `connections` 130, `maskrules` 130,
  `queries` 123, `embedded` 107, `tree` 83, `customscripts` 79, `responsehistory` 78, `datagrip`
  71, `grpchistory` 66, `update` 64, `app` 56, `ops` 51, `apidata` 44, `schema` 44, `stream` 43,
  `settings` 42, `lifecycle` 41, `filters` 34, `layout` 33, `tabs` 29, `terminal` 13, `windows` 13.
  Tests: `http_test` 616, `grpc_test` 474, `collections_export_atomicity_test` 182,
  `dbmcp_test` 108, `collections_import_atomicity_test` 90, `files_test` 84, `connections_test` 64.
  113 exported methods on `*XxxService` receivers are Wails-bound, plus the embedded
  `windowsvc.Service` and `terminal.BoundService` methods (Part 8 code, bound here).
- **`SI/dbmcp`** (8/2,148; 9/1,612): `render` 688, `tools` 538, `server` 286, `approval` 230,
  `explain` 159, `http` 133, `access` 69, `permissions` 45. Tests: `render_test` 688,
  `approval_test` 303, `run_query_approval_test` 143, `tools_test` 137, `server_test` 85,
  `access_test` 83, `explain_approval_test` 82, `explain_test` 59, `http_test` 32.
- **`SI/queryplan`** (10/1,396; 2/229): `mysql` 225, `clickhouse` 223, `mariadb` 178, `postgres`
  168, `issues` 142, `parse` 127, `sqlite` 96, `plan` 94, `metrics` 79, `statements` 64. Tests:
  `parse_test` 198, `statements_test` 31.
- **`SI/mask`** (1/515; 2/537): `mask` 515; `mask_test` 424, `parity_test` 113.
- **`SI/mcpauth`** (1/266; 1/237): `token` 266; `token_test` 237.
- **`SI/mcpinstall`** (2/271; 1/105): `install` 262, `exec` 9; `install_test` 105.
- **`SI/maskrules`** (1/209): `service`. **`SI/appshell`** (3/121): `menu` 72, `dialogs` 32,
  `stream` 17. **`SI/appcore`** (1/54): `deps`. **`SI/config`** (2/62): `paths` 52, `env` 10.
  **`SI/buildinfo`** (1/17).
- **Root files** (2/724; 1/49): `apps/kira-studio/main.go` 611, `cmd/g1measure/main.go` 113;
  `SI/layering_test.go` 49.
- **`SD`** (2/512): `mask.ts` 443, `dbmcp.ts` 69. **`ST/unit/mask-parity.spec.ts`** 77.
- **Non-code:** `Taskfile.yml` 48, `.gitignore` 4, `build/Taskfile.yml` 112, `build/config.yml`
  78, `build/darwin/{Taskfile.yml 208, Info.plist 27, Info.dev.plist 32}`.
- **Not owned, read as fixtures:** `ST/fixtures/mask/*.json` (132 files) and
  `ST/fixtures/explain-plans/` are Part 12 (`tests/fixtures/**`). `mask/parity_test.go` and
  `queryplan/parse_test.go` read them.

## 3. One hop: callers (git grep of import lines)

- **Go importers of Part 6 packages from outside the chunk:**
  - `bridge`: `ipcfixture/harness.go` (`MaskRulesService`, `OpsService`), and
    `ipcfixture/{kafka,redis,sqs}_test.go` (Part 5, closed, editable). A bridge signature change
    ripples there.
  - `config`: `storage/db.go` (Part 2, closed). `buildinfo`: `httpclient/client.go` (Part 7,
    later, User-Agent).
  - `queryplan`: `adapters/clickhouse/console_internal_test.go` (Part 3, closed; composer and
    classifier lockstep test, P108 Part 7 F4).
  - `appcore`, `maskrules`: `ipcfixture/harness.go`.
  - `dbmcp`, `mask`, `mcpauth`, `mcpinstall`, `appshell`: no importer outside Part 6.
- **TS callers of the Wails bindings:** only `SF/bridge/index.ts` and `SF/bridge/apiControl.ts`
  (Part 5, closed, editable) import `SF/bindings/` in production; test doubles in
  `ST/ui/support/{ipcChannels,mockRuntime}.ts` (Part 13, Stream C). Every store reaches the
  bindings through those two files (47 importers of `bridge/control`, per Part 5's plan).
- **`SD/mask.ts`**: `SF/bridge/index.ts`, `SF/state/maskRules.ts`, `SF/project/
  ConnectionDialog.vue`, `SF/views/grid/{SlickGridHost.vue,maskPreview.ts,menu.ts}`,
  `SF/views/shared/celleditor/generate.ts`, `packages/shared/protocol/events.ts` (Part 9), the
  excluded `frontend/proto/grid/data.ts`, and `ST/unit/mask-parity.spec.ts`. The grid's mask
  preview is the TS port's only production consumer.
- **`SD/dbmcp.ts`**: `SF/bridge/index.ts`, `SF/state/dbmcp.ts` (Stream C).
- **MCP clients**: any process on loopback holding the bearer token (Claude Code via the
  `headersHelper` script). `Origin` header blocked by `CrossOriginProtection`.

## 4. One hop: callees

- **Parts 2-5 (closed):** `connections.Service` (`List`, `StateOf`, `Connect`, `Shutdown`,
  `OnStateChange`...), `storage/model`, `storage/repos` (`Settings`, `Collections`, `MaskRules`,
  `MaskKeys`, `Ops`, `Windows`), `secrets`, `localauth`, `preconnect`, `datagrip`;
  `adapters` (`OpClass`, `Caps`, `CodeOf`, `ClassifySQL`), engine packages (blank imports in
  `main.go`); `adapterhost` (`Router.Execute`/`ClassifyStatement`/`Cancel`/`Host().RunOp`,
  `ExecuteRequestWire`, `StreamSession`), `enginecache.NewCache`, `tree.Service`
  (`Children`/`Describe`/`SchemaColumns`; Part 5 `1dca4ef` now keeps engine error codes across
  the boundary: re-check `dbmcp.toolError`/`maskedToolError` against the new error type), `oplog`
  (`New`, `Start`, `Stop`), `page` (`TabularPage`... `CellText`/`IsNull`/`IsTruncated`,
  `MaxCellBytes`).
- **Part 7 (next, same stream, editable):** `httpclient` (`Send`, `JarCookies`,
  `DeleteJarCookie`, `ClearJar`), `grpcclient`, `apivars` (`ResolveRequest`, `Reveal`),
  `postman` (`Parse`, `Write`).
- **Part 8 (later, same stream, editable):** `ipcerr` (24 imports), `shell` (`Quitter`,
  `WindowRegistry`, `CloseFlushCoordinator`, deferred emitter/dialogs), `terminal`, `windowsvc`,
  `keepawake`, `appupdate`, `metrics`, `notify` (`PendingQueue`, `OrderedEmitter`), `tokenauth`,
  `toolexec`, `appevent`, `appstorage`, `kiratime`, `kirapaths`, `logging`, `startupfail`,
  `layeringtest`.
- **Libraries:** `modelcontextprotocol/go-sdk` (`mcp`, `auth`), Wails v3 `application`,
  `google/uuid`, `rivo/uniseg`, `gopsutil` (`cmd/g1measure`).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk exposes
every Studio service to the renderer and a database tool surface to any local MCP client.

### 5.1 Wails-bound method surface

- **Exposure.** Every exported method on a bound service is callable from any window's JS,
  including helpers that look internal. List exported methods that are not meant as bindings
  (`embeddedService` is unexported; check `DbMcpService`, `KeepAwakeService`, `UpdateService`,
  `TerminalService`, `WindowsService` for exported non-binding methods) and anything returning a
  secret (`VariablesService.Reveal`/`RevealHistory`, connection password reveal) without the
  `localauth` gate.
- **Error shape.** The renderer keys behavior on `ipcerr` codes. Find bound methods that return a
  raw `error` (not `ipcerr`), wrap every failure as `E_INTERNAL` where a caller needs a real code
  (routed F6, §7), or put driver/file-system text with secrets into `Message`/`Details`
  (`mapHttpError` `Details` carries the masked timeline: confirm masking covers every hop).
- **Args validation.** Required-field checks per method (`BadRequest`), limits (`OpsService.Recent`
  `limit` has a floor, no ceiling), path arguments that reach the file system: `CollectionsService
  .Import`/`Export` take a renderer-supplied path with no dialog check (any window can read or
  overwrite any user file through them: weigh against the trust model that the renderer is
  first-party), `DataGripService.Scan`/`Import`, `FilesService.Choose*` default paths.
- **Context.** Only `dbmcp`, `grpc`, `http`, `update` take `ctx`. `OpsService.Cancel` passes
  `context.Background()` (`ops.go:49`); Part 5 F1 bounded `Host.CancelOp` itself (`6d144c8`):
  confirm the bound now covers this path, do not re-report F1.
- **Events.** `Events.Attach` is detached first in teardown; producers that emit outside it
  (`emitApiData`, `ChannelSettingsChanged` from `DbMcpService.SetEnabled`, terminal and gRPC
  `EmitTo`) can still emit after detach into a tearing-down app.
- **Deps copy.** `appcore.Deps` is copied by value into each service literal (`main.go:152-180`,
  `wireEmbeddedServices`). A field set on `deps` after a copy is invisible to that service.
  Confirm every field is set before its first copy (`Events` at `main.go:123`, after
  `wireAdapters` copied `deps` into nothing bound yet).

### 5.2 Lifecycle and shutdown order

- **Boot.** `openCore` then `wireAdapters` (router, connections `Start`, tree, oplog `Start`,
  sweeps, metrics) then `wireEmbeddedServices` (DB MCP starts serving **before**
  `application.New`, with a deferred emitter not yet attached: an MCP `run_query` that arrives
  before `attachEmitter(app)` triggers `connections.Connect`, which emits state; check the
  deferred emitter buffers or drops, and that nothing panics) then `wireLifecycle` then
  `application.New` then `wireWindowsAndMenu` then `Run`.
- **Teardown** (`main.go:435-458`): installer cancel, events detach, **oplog stop**, DB MCP stop,
  connections shutdown, keep-awake stop, terminal shutdown, repos close, DB close. Weigh:
  `oplog.Stop` runs before DB MCP drains and before connections disconnect, so ops still finishing
  (an approved `run_query`, a disconnect) emit `op:end` to no consumer: rows marked by
  `finishInFlight` instead (confirm, not a loss); in-flight HTTP/gRPC `RunOp`s and engine data
  streams (`ServeEngineStream`) are never cancelled before `db.Close()`: an op closing after that
  writes to a closed DB or an `OpsRepo` with a closed statement. `quitter` 2 s flush wait and
  `beforeFlush` ordering. `sync.OnceFunc` around both; `OnShutdown` versus `ShouldQuit` order in
  Wails (does `teardown` ever run twice or never, e.g. on `SIGTERM`/OS logout).
- **Embedded server lifecycle** (`bridge/embedded.go`, `bridge/dbmcp.go`): `setRunning` under the
  lock while `startFn` binds a port and spawns `Serve`; `SetEnabled` flips the setting before the
  start result is known (a bind failure leaves `ServerEnabled=true` and a stopped server: next boot
  retries, UI shows `Error`); `stopFn` runs `AbandonAll` then `Close` (P108 M6 #17): a `Request`
  enqueued between the two after `AbandonAll` waits for `Close`'s graceful drain or 2 minutes.
  `Regenerate` against a stopped server.
- **Windows.** `windows.DetachAll` in `beforeFlush`; startup window loop (`main.go:532-550`) on a
  DB whose window list fails; `AttachReopen` with zero windows.

### 5.3 DB MCP: auth, tool surface, read-only enforcement, result caps

- **Auth** (`http.go`, `mcpauth`): loopback bind only, `DefaultPort` 8766 refused on conflict
  (P108 F11); bearer check per request through `tokenVerifier` under `tokenMu`; constant-time
  compare in `tokenauth`; `Check` hashes before expiry (no expiry oracle); `CrossOriginProtection`
  against a browser page. Weigh: a DNS-rebinding page (Host header check?) against a client that
  sends no `Origin`/`Sec-Fetch-Site`; token file and helper mirror modes (0600) and the `home`
  dir mode (0700) when `KIRA_HOME` already exists with looser perms; `LoadOrMintTTL` stamping a
  zero `ExpiresAt` file on load; `Regenerate`/`SetToken` racing a request mid-verify; `Save` temp
  file left behind on rename failure; no request body cap on the MCP handler (`http.go:54-86`; a
  multi-GB `sql` arg is read whole: check the SDK).
- **Tool surface** (`server.go:194`): six tools, each wrapped by `withPanicRecovery`. Check every
  tool's args schema (`jsonschema` tags) against what the handler accepts: `path` strings decoded
  by `model.DecodePath` downstream, `maxRows` clamp (`tools.go:269-275`), `refresh` bypassing the
  metadata cache (an MCP client can force a full catalog re-read per call: cost, not a gate).
- **Exposure gate** (`access.go:15`): `resolveEnabled` hides non-exposed connections with the same
  text as unknown ids; `listConnections` filters `McpEnabled`. Every tool must call it before any
  backend touch. `connectForQuery` connects on demand (runs the pre-connect script): confirm only
  `run_query`/`explain_query` reach it and schema tools on a disconnected connection fail without
  connecting.
- **Read-only and permission enforcement:** `resolveVerdict` (`tools.go:256`) order: resolve,
  all-deny refusal, clamp, connect, classify (classifier error degrades to `ClassUnknown`, then
  strictest mode), verdict. Weigh: classification runs on the live adapter after connect, so a
  classifier that needs a live connection (redis `COMMAND`) versus a stale one; the connection's
  own `ReadOnly` flag is enforced by the adapter (Part 3/4 guards), not here: confirm a
  `ReadOnly` connection with write mode `allow` still refuses writes in the engine, and that
  `listConnections` reports both. `awaitApproval` re-resolves after approve (P108 M7) but does not
  re-classify (SQL unchanged: fine) or re-check `ReadOnly`. `explainQuery` (`tools.go:413`) gate
  order against the pre-plan watch: verdict, explain, at most one approval, execute. Schema tools
  (`resolveReadGated`) on read `deny` (P108 M7 #8): confirm all three, and that
  `listConnections` alone stays ungated by design.
- **Composed EXPLAIN:** `queryplan.Explainable` (raw `;` guard) plus
  `assertComposedStatementsAreReads` on every composed statement; ClickHouse composes two
  statements (`EXPLAIN PLAN ...`, `EXPLAIN ESTIMATE ...`); MySQL `EXPLAIN FORMAT=JSON` on a
  `WITH ... DELETE`-shaped CTE; Postgres `EXPLAIN` without `ANALYZE` never executes (confirm no
  dialect composes `ANALYZE`); `leadingCommentRE` versus nested/MySQL `/*!` comments
  (`Explainable` strips a `/*! ... */` executable comment as a comment).
- **Masking on the MCP path:** `MaskSetFor` resolved after approval and before execute
  (`tools.go:191`); `maskedToolError` withholds driver text only when `mk != nil`;
  `renderPage` refusals (risky syntax, risky result type classes, rename/alias, document/stream
  pages, columnless keyvalue); `maskPlanForMaskedConnection` on explain output (P108 F5). Weigh:
  `planFor` errors on a masked connection logged with the raw driver message (`explain.go`, log
  only?) and returned by `explainQuery` through `toolError` (unmasked?); a mask rule added between
  `MaskSetFor` and render; `withAdditionalStatementResultsNote` reveals only a count, never later
  pages' rows.
- **Result caps:** `maxRows` default 200, max 2000, applied at render (`renderTabularPage`
  `cappedReturned`); per-cell truncation at `page.MaxCellBytes`; `maskedColumnsMaxListed`. **Part
  4 F8 (held design decision, §6):** `run_query` calls `Router.Execute` whose console path
  materialises the whole result before `renderPage` caps rows. Reviewer: state whether that gap is
  reachable through `run_query` (and through `planFor`'s EXPLAIN pages) and file it as one
  `design-decision` finding cross-referencing Part 4 F8, no proposed code fix here. Same for
  **Part 4 F15** only if `run_query`/schema tools can reach an SQS `ReceiveMessage`. `sqs`
  `Caps().SQL` is `false` (`sqs/caps.go:18`), so `run_query` likely cannot; confirm
  `list_children`/`describe_table` never browse messages, then say so in coverage, no finding.
- **Approvals** (`approval.go`): FIFO, `maxPendingApprovals`, timer versus ctx versus
  Approve/Deny races (`resolve` returns already-resolved), `AbandonAll` keeps the broker usable,
  `ApprovalTimeout` 2 min against the MCP client's own request timeout (Claude Code may time out
  first: the query then runs on approve after the client left? `ctx` is the request ctx; confirm
  `Request` returns `Abandoned` on client disconnect and that `Execute` uses the same ctx).
  Approval snapshot carries the statement text to every window (`toWireApprovalSnapshot`): on a
  masked connection the SQL literal is the agent's own text, not row data (fine).

### 5.4 Mask and maskrules parity (Go and TS)

- **Algorithm parity:** `mask.go` against `SD/mask.ts`, pinned by 132 fixture files
  (`ST/fixtures/mask`, Part 12) read by `mask/parity_test.go` and `mask-parity.spec.ts`. No
  fixture generator is committed (`parity_test.go:13-17` says fixtures are "generated from this Go
  package"; `git grep` finds no writer): a new kind or edge case has no regeneration path. Check
  word splitting (`strings.Fields`/`unicode.IsSpace` versus `NAME_WORD_SPLIT_RE` at `mask.ts:105`:
  `\s` plus a literal NEL byte pair, invisible in an editor; JS `\s` also matches U+FEFF, which
  `unicode.IsSpace` does not), grapheme counting (`uniseg` versus `Intl.Segmenter`, emoji ZWJ and regional-indicator
  sequences, Unicode version skew between Go module and the WebView's ICU), correlation tag
  (HMAC input normalisation, hex/base32 length), number bucketing (`pow10String` on negative,
  decimal, exponent, `NaN`, locale separators), date parsing, `[redacted]`/bullet constants,
  empty-string identity, `MaskNullable` NULL pass-through. Which inputs have no fixture.
- **`Stricter`** kind ranking (`mask.go:437-472`) against any TS ranking (does TS fold rules at
  all, or does the grid preview take the first match?). Unknown kinds rank as redact in Go; zod
  rejects them in TS.
- **`maskrules.Service`** cache (`service.go:107-159`): `MaskSetFor` reads the cache, unlocks,
  queries, then stores. An `Upsert`/`Remove` whose `invalidate` lands between the query and the
  `store` leaves the pre-write set cached until the next write to that connection: a just-added
  rule does not mask MCP output. Confirm by probe. `EnsureKey` failure path; `RegenerateKey`
  invalidation; folding by lowercased column name ignores `table_name` (documented: stricter
  wins), and `RuleFor` lowercases with `strings.ToLower` (non-ASCII case folding versus SQLite
  `lower()` ordering in the repo).
- **Bridge `MaskRulesService`** (`bridge/maskrules.go`): writes go through `maskrules.Service`
  (`Upsert`, `Remove`, `RegenerateKey`; `Remove` reads the repo first for the connection id).
  Check every write broadcasts `ChannelMaskRulesChanged`, and that no other writer
  (`connections` delete cascade, DataGrip import) changes rules behind the cache.

### 5.5 mcpinstall file writes and registration

- **`Command`** (`install.go:190-194`) wraps the JSON payload in single quotes, but the payload's
  `headersHelper` is itself `shellSingleQuote(helperPath)`, which contains `'`. When the user pastes
  the shown command, the shell ends the outer quote at the inner `'`. The stored `headersHelper`
  then has no quotes, which is the P108 F10 bug again, on the copy-paste path only. `Install`
  passes argv directly, so it is not affected. Also `name` is unquoted. Confirm with a `sh -c`
  probe on a path that contains a space and one that contains `'`.
- **`EnsureHeaderHelperScript`**: writes `<home>/mcp-header-helper.sh` mode 0700 via plain
  `os.WriteFile` (not atomic, unlike `mcpauth.Save`); a pre-existing file with looser mode keeps
  its mode (`WriteFile` does not chmod an existing file); a symlink at that path is followed.
  Script content `printf '{"Authorization":"Bearer %s"}' "$tok"`: a token with `%` or `"` (token
  alphabet from `tokenauth.Mint`: confirm).
- **`Install`**: remove-then-add (not atomic; a failed add leaves no registration), `spawnTimeout`,
  `isNotRegisteredError` string match against CLI output across versions, `--scope user` only.
- **Token files** (`mcpauth`): helper plaintext mirror `<home>/kira-db-header.token` 0600 (D8
  exception); `remintDbMcpToken` writes record and helper non-atomically as a pair (crash between
  them leaves a mismatch: `helperTokenMatchesRecord` then reminds on next start, by design?).

### 5.6 queryplan

- Mirror of the console plan parsers (`SF/views/console` explain code, Part 12, read only):
  `explain-plan.spec.ts` and `parse_test.go` share `ST/fixtures/explain-plans`. Check per dialect:
  missing or renamed JSON keys (MySQL 8.0 vs 8.4 `EXPLAIN FORMAT=JSON` v2, MariaDB
  `query_block` nesting, ClickHouse `indexes = 1` shape, Postgres `Plans` recursion depth), number
  parsing of `rows`/`Plan Rows`/`filtered`, `ErrTruncated` when the JSON cell hit
  `MaxCellBytes`, deep recursion on a hostile plan (stack), SQLite `parent` pointing at an unknown
  or cyclic id, `OverThreshold` with a nil estimate. `issues.go` severity rules versus the TS
  `isFlaggedPlan`.
- `Explainable`/`StatementsFor` versus TS `isExplainable`/`explainStatementsFor` (ported
  "verbatim"): diff the two, including `WITH` that ends in a DML statement on Postgres
  (`WITH x AS (DELETE ...) SELECT`): `Explainable` accepts it, plain `EXPLAIN` does not execute it
  (fine), but the classifier must still see the DML for `run_query`.

### 5.7 Config, build and tooling

- `config/paths.go`/`env.go`: `KIRA_HOME` resolution (relative fallback when `os.UserHomeDir`
  fails, P108 F10 note), dev/test isolation (`IsDev`), `EnsureLayout` modes. `buildinfo.Version`
  default and ldflags injection in `build/Taskfile.yml`.
- `Taskfile.yml`, `build/**`: signing/notarisation steps, `Info.plist` keys (`NSAppleEvents`,
  hardened runtime entitlements), dev versus release bundle ids, `.gitignore` coverage of
  generated bindings.
- `cmd/g1measure`: dev tool (`splitNonEmpty` string concat per rune; fine for a CLI). Report only a
  real defect.
- `layering_test.go`: exempt list (`internal`, `bridge`, `ipcfixture`, `appshell`) still minimal.

### 5.8 Unit-test bar

`CLAUDE.md` bar: dbmcp approval races, render refusals, mask algorithm and parity, mcpauth expiry
boundary, collections atomicity clear it. Report only a true duplicate or a test restating a
trivial body (candidates: `http_test.go` 616 and `grpc_test.go` 474 for thin pass-through cases).

## 6. What earlier fixes already changed (do not re-report)

- **P108 Part 7** (v1.9; this chunk's analogue, `docs/v1.9/SPEC.md` "P108 Part 7 result"): F1
  over-refusing JSON/array columns (known open item), F2 `headersHelper` replaces the argv token,
  F3 remove-before-add name collision, F4 ClickHouse composed EXPLAIN classification, F5
  `maskPlanForMaskedConnection`, F6 `explain_query` post-approval re-check, F7
  `withPanicRecovery`, F8 helper-mirror gate for Command/Install, F9 Regenerate always rendered,
  F10 `shellSingleQuote` in `Install` and `Command` (§5.5 suspects only the `Command` copy-paste
  path), F11 no port fallback, F12 keepawake reap race (now Part 8 code), F13 teardown order (DB
  MCP before connections) and `connections` `closed` flag, F14 docs. Also M6/M7 dbmcp findings
  cited in code comments (#4 masked errors, #8 schema-tool read gate, #12 multi-statement note,
  #17 abandon before close). Verify they hold; do not re-report.
- **P168 Parts 2-4** (closed): no Part 6 file edited. Part 2: `connections` `abortInFlight`
  waits on `Backend.Connect`; `model.UTF16Len`. Part 3: classifier and tracker fixes. Part 4:
  engines honour ctx on `Connect`, redis subcommand read-only gate. **Held by design decision,
  not fixed: Part 4 F8** (console results fully materialised, no row/byte cap, shared with SQL
  consoles) **and F15** (sqs browse on a read-only connection consumes messages). Do not
  re-report either; §5.3 asks only for a reachability statement through dbmcp, filed as a
  `design-decision` finding that cites F8.
- **P168 Part 5** (closed, `6d144c8`..`d7f1da9`): F1 bounded `Host.CancelOp`, F2/F3 reconnect and
  throttle races, F4 stream null bodies (`render.go` already reads `*string` bodies; only
  `render_test.go` changed), F5 error-frame cap and `Send` failure, F6 oversized page not cached,
  F7 dead wire zod schemas removed, F8 tree keeps engine error codes across Wails (`1dca4ef`), F9
  ipcfixture single capture, F10 golden frames, F11 e2e-real build script.
- **P166/P167**: no Part 6 file named; findings files deleted. Nothing to skip.

## 7. Routed items owned by this Part

Read `docs/v2.0/plans/P168-routed-from-streamC.md` and `P168-routed-from-streamA.md` (both on this
branch), and `P168-routed-to-stream-a.md`.

- **Stream C Part 10 F6 (low): Part 6 owns the Go half and must fix it here.** File
  `SI/bridge/collections.go:61-74` (`GetRequest`, `GetGrpcRequest` wrap every failure in
  `ipcerr.InternalResult`). The repo returns a plain `fmt.Errorf("repos/collections: no item %s")`
  on `sql.ErrNoRows` (`storage/repos/collections.go:109-110`, Part 2, closed, editable). Reviewer:
  confirm, then file it with this edit set: a sentinel (`repos.ErrItemNotFound`, wrapped) in
  `getRequestBody`; the bridge maps it to a typed code (`ipcerr.New("E_NOT_FOUND", ...)` or a
  new `ipcerr.NotFound` constructor in `internal/ipcerr`, Part 8, same stream, editable) and keeps
  `E_INTERNAL` for every other error. Non-request items and protocol mismatches stay
  `E_BAD_REQUEST` or internal: reviewer decides. **Renderer half routes to Stream C:**
  `SF/api/state/apiQueries.ts` `apiSavedRequestQueryOptions`/`apiSavedGrpcRequestQueryOptions`
  return `null` only for the new code. Tag `needs-other-part-file:
  apps/kira-studio/frontend/src/api/state/apiQueries.ts (Part 10, Stream C)`. The fixer records
  the code name in `P168-routed-from-streamA.md`.
- **Stream C Part 10 F18 (low): Go half is Parts 6/7; Part 6's fixer lands it.** Files:
  `SI/bridge/http.go:202-223` (`HttpCookieDeleteArgs` gains `Domain`, `Path`; `DeleteCookie`
  passes them), `SI/httpclient/cookies.go:98-105` (`DeleteJarCookie` sets `Domain`/`Path` on the
  expiring cookie; Part 7, next, same stream, editable as one hop) and `SF/bridge/apiControl.ts:104`
  (`httpDeleteCookie(url, name, domain, path)`; Part 5, closed). Part 5's plan deferred the
  `apiControl.ts` edit to this fixer because bindings regenerate from Go; Part 5's fixer has
  landed, so the Part 6 fixer now widens it in the same commit as the Go binding (regenerate
  bindings with `bun run setup`). Reviewer: check how `JarCookies` (`cookies.go:82`) derives
  `Domain`/`Path` (stdlib `cookiejar.Cookies` returns name and value only), whether a host-only
  cookie must be expired with an empty `Domain`, and whether the exact-cookie delete is feasible
  over `cookiejar` at all. If infeasible without a jar replacement, tag `design-decision`.
  **Renderer half routes to Stream C:** `CookiesPane.vue` `onRemove` and `useCookiesStore
  .deleteCookie` pass `c.domain` and `c.path`. Tag `needs-other-part-file:
  apps/kira-studio/frontend/src/views/httprequest/{CookiesPane.vue,cookies.ts} (Part 10, Stream
  C)`.
- **`P168-routed-from-streamA.md`**: no item is Part 6's. F12 and Part 5 F4 (stream null body)
  route to Part 12 (Stream C); `dbmcp/render.go` already handles a null body (confirm in block 4,
  no finding). Part 5 F7 (`fkPreview.ts` comment) is Stream C. Part 4 F20 (`shared/caps.ts`) is
  Part 13.
- **`P168-routed-to-stream-a.md` Part 14 F4** (`localsock` `wg.Add` race): Part 8, not Part 6.

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (security-weighted core first, then the bridge
  hub, then lifecycle, then mirrors and tests). About 10.3k production lines plus 4.5k test lines:
  read tests only where they are the sole guard of a claim, or in block 7.
  1. **Auth and install:** `mcpauth`, `mcpinstall`, `bridge/dbmcp.go`, `bridge/embedded.go`,
     `dbmcp/{server,http}.go`.
  2. **DB MCP tools and gates:** `dbmcp/{access,permissions,tools,explain,approval}.go`,
     `queryplan/statements.go`; Part 4 F8/F15 reachability statement here.
  3. **Masking:** `mask/mask.go`, `maskrules/service.go`, `bridge/maskrules.go`,
     `dbmcp/render.go`, `SD/mask.ts` (parity), `SD/dbmcp.ts` against the Go wire structs
     (`DbMcpStatus`, approval snapshot).
  4. **Bridge services:** every other `SI/bridge/*.go` (`collections` incl. routed F6, `http`
     incl. routed F18, `grpc`, `variables`, `files`, `connections`, `tree`, `ops`, `events`,
     `stream`, `queries`, `schema`, `datagrip`, `customscripts`, `settings`, `layout`, `tabs`,
     `windows`, `terminal`, `keepawake`, `update`, `lifecycle`, `app`, `apidata`, `filters`,
     `responsehistory`, `grpchistory`), `appcore/deps.go`, `appshell/*`.
  5. **Lifecycle and config:** `main.go`, `config/*`, `buildinfo`, `layering_test.go`,
     `Taskfile.yml`, `build/**`, `.gitignore`, `cmd/g1measure`.
  6. **queryplan parsers:** `parse`, per-dialect files, `issues`, `metrics`, `plan` against the
     console parsers (Part 12, read).
  7. **Tests and checks:** every Part 6 `_test.go`, `mask-parity.spec.ts`, the §0 checks, the
     ipcfixture run and the UI subset if not run earlier.
- **Resumable:** write `docs/v2.0/plans/P168-part6-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 6 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). Mark each block done in the file's coverage section. An
  interrupted run reads the file, resumes at the first block not marked done, and never
  re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome; say which probe or real run
  confirmed it), and a proposed fix. Tag `design-decision` when it needs one; the fixer turns it
  into its own `SPEC.md` phase. Part 4 F8's reachability finding is `design-decision` by
  definition and cites F8; it does not become a second phase if F8 already has one.
- **Edit scope tag.** The fixer may edit Part 6 files and Stream A one-hop files (Parts 2-5
  closed, Parts 7-9 later; pre-plan §3.3), including `ipcfixture` (bridge callers),
  `storage/repos/collections.go` (F6), `httpclient/cookies.go` (F18), `SF/bridge/{index,
  apiControl}.ts` (binding wrappers) and `internal/ipcerr`. A finding whose fix needs a file
  outside that set carries `needs-other-part-file: <path> (Part N)`. That covers every Stream C
  file (Parts 10-13: `SF/api/**`, `SF/views/**`, `SF/state/**`, `SF/project/**`,
  `SF/workbench/**`, `ST/ui/**`, `ST/fixtures/**` incl. the mask and explain-plan fixtures) and
  every Stream B file (Parts 14-23). The orchestrator routes those; the Part 6 fixer never edits
  them. A parity fix that needs a new mask fixture is tagged with `ST/fixtures/mask/` (Part 12).
- The findings file states base commit (`d7f1da9`), HEAD reviewed, checks run and results (vet,
  race, build, bun unit, typecheck, UI subset, ipcfixture run, probes), findings, then coverage
  per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk with
  nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 6 findings`, normal commit, hooks green, before any fixer
  starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 6`. A fix
  re-runs `go build ./apps/kira-studio/...`, `go vet` and `go test -race` over the Part 6 Go
  packages, plus `SI/ipcfixture`, `SI/storage/...`, `SI/httpclient`, `internal/ipcerr` when a
  caller or contract changed; `bun run setup` (bindings) and `bun run typecheck` after any bound
  signature change; `bun test` for touched TS specs; `mask-parity.spec.ts` plus
  `mask/parity_test.go` for any mask change; the UI subset (§0) when a bound shape changed. It
  deletes the findings file when done. Routed renderer halves (F6, F18, any other) go to
  `P168-routed-from-streamA.md` with exact file and change. Chunk lands per pre-plan §3.4 before
  Part 7's plan starts.

## 9. Candidate suspects (unconfirmed; verify, do not assume)

Raised during planning discovery. Each is a lead, not a finding.

1. `mcpinstall.Command` (`install.go:190-194`): the outer `'...'` around a payload that holds
   `shellSingleQuote(helperPath)` drops the inner quotes when pasted. A helper path that contains
   a space registers unquoted (P108 F10 regression on the copy path only).
2. `maskrules.Service.MaskSetFor` (`service.go:107-158`): invalidate-versus-store race caches a
   pre-write rule set, so a rule added mid-query is ignored until the next write.
3. DB MCP serves before `application.New` and `attachEmitter`; an early `run_query` connect emits
   through an unattached deferred emitter (`main.go:122-135,195`).
4. Teardown stops `oplog` before DB MCP drains and before connections shut down, and never
   cancels in-flight HTTP/gRPC ops or engine streams before `db.Close()` (`main.go:435-458`).
5. No request body cap on the MCP HTTP handler (`http.go:54-86`); `sql` args of any size.
6. `EnsureHeaderHelperScript` uses non-atomic `os.WriteFile`, keeps an existing file's mode,
   follows a symlink (`install.go:143-156`).
7. `CollectionsService.Import`/`Export` accept any renderer path with no dialog provenance
   (`collections.go:275-283,431-445`): weigh only against the first-party-renderer trust model.
8. `SetEnabled` persists `ServerEnabled=true` before a bind failure is known (`bridge/dbmcp.go:
   264-278`): repeated failing starts on every boot, UI shows the error each time (by design?).
9. `explainQuery`/`planFor` failure on a masked connection: driver message logged and possibly
   returned unmasked through `toolError` (`explain.go:137-158`, `tools.go:413+`).
10. `SD/mask.ts:105` splits on U+FEFF (JS `\s`), Go `strings.Fields` does not: name masking
    diverges on a BOM-bearing value; no fixture covers it. No committed fixture generator.
11. `OpsService.Recent` has no upper `limit` bound (`ops.go:32-37`).
12. `ApprovalTimeout` 2 min versus the MCP client's request timeout: a query approved after the
    client gave up still executes unless `Request`/`Execute` see the request ctx cancelled.

## 10. Out of scope

- Engines (Parts 3-4, closed) beyond the classifier and console contract dbmcp relies on; F8/F15
  (§6) beyond the reachability statement.
- `adapterhost`, `enginecache`, `page`, `tree`, `oplog`, `ipcfixture` internals (Part 5, closed),
  beyond how this chunk calls them.
- `httpclient`, `grpcclient`, `apivars`, `postman` internals (Part 7, next): only the bridge's use
  of them and the routed F18 jar edit.
- Root `internal/*` (`shell`, `terminal`, `windowsvc`, `keepawake`, `appupdate`, `metrics`,
  `notify`, `ipcerr`...; Part 8, later): record only as a callee note when it breaks a Part 6
  contract.
- Frontend stores and views (Stream C, incl. `DatabaseMcpPane.vue`, `state/dbmcp.ts`, grid mask
  preview): read only for reachability and mirrors; fixes tagged per §8.
- Generated Wails bindings (`SF/bindings`, gitignored), docs, excluded files (pre-plan §6).
