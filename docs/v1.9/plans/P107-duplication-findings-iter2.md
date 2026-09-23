# P107 duplication findings — iteration 2

Fresh sweep of the whole tree after iteration 1 landed: both apps' Go and TypeScript/Vue, every
`packages/*`, tests included. Tree audited: `ad5c4959` (`origin/v1.9`, iteration 1's
consolidation pass and Tailwind-bracket deep-dive included). Not a review of iteration 1's fixes:
same method, run again from scratch against the current source, plus two sweeps iteration 1 did
not run. Every entry names exact instances, what differs, one consolidation shape. A Sonnet
subagent implements from §4, same phase.

Line numbers are as of `ad5c4959`. Paths repo-relative. `Studio` = `apps/kira-studio`, `Space` =
`apps/kira-space`, `A` = `apps/kira-studio/internal/adapters`, `SF` = `Studio/frontend/src`,
`PF` = `Space/frontend/src`, `vscode` = `apps/kira-space-vscode`.

## 0. Method

Six sweeps over the CodeGraph index (`.codegraph/codegraph.db`, copied to the scratchpad, read
via `bun:sqlite`), then per-candidate verification by reading source and `diff`.

- S1 body hash: every `function`/`method` node, comments and whitespace stripped, hashed; second
  pass identifier-blind. Same as iteration 1.
- S2 name collisions: same symbol name, ≥2 files, same language, ranked by normalized-line LCS.
- S3 callee fingerprint: ordered callee list per function from `calls` edges, LCS ≥0.7.
- S5 (new) line shingles: K=6 normalized-line shingles over every tracked `.go`/`.ts`/`.vue`
  file, Vue templates included, maximal repeated blocks ≥8 lines. 2946 blocks; everything ≥17
  lines read.
- S6 (new) MinHash/LSH: 64 hashes, 16 bands, identifier-blind 4-gram token shingles per
  function ≥8 lines, Jaccard ≥0.5. 8866 pairs; production pairs ≥0.70 all read, test pairs
  ≥0.80 sampled.

S5 and S6 are what iteration 1 lacked: S1 sees only exact bodies, S3 only call order, so a
near-identical block inside a bigger function, or a repeated Vue template region, never surfaced.
Most entries below come from those two.

Excluded before counting, as in iteration 1: generated code (`page/wire`, `gitwire`,
`shared/protocol/wire`, `git-ipc/src/generated`), cross-language mirrors (`mask.go`/`mask.ts`,
`page/encode.go`/`encodeFrame.ts`, `queryplan` vs `planParsers`), `git-core` vs `git-ipc`
contract copies (B3 boundary, `wireConformance.test.ts`).

Two areas excluded as in flight, not as declines — a concurrent P105 pass is extracting both
right now, so a finding here would collide with it:

- Disabled-control tooltip wrapper: `<span tabindex="0">` around a disabled trigger, ~81 sites
  in 26 files (settings panes' reset buttons, `RawExchangePane.vue`, `AdvancedPane.vue`, …).
  P105 §4.2 moves it to `packages/theme/src/components/ui/tooltip/TooltipDisabledTrigger.vue`.
- Column/pane resize handle: `packages/git-ui/src/components/CommitGrid.vue` 1216/1231/1246
  (`role="separator"`, `aria-value*`, arrow-key resize), `SF/views/stream/StreamView.vue`
  1070-1169 (ten handles), `packages/git-ui/src/App.vue` 1476-1510 (detail-pane drag-and-clamp,
  its own comment names `CommitGrid.vue` as the twin). P105 §5.2(a) moves it to
  `ColumnResizeHandle.vue`.

Neither gets a finding entry or implementation guidance below. Entries that touch a file P105 is
editing (I2-18, I2-38) name the overlap and leave that part alone.

Summary: 28 tier-2 findings, 14 tier-1 findings, 13 declines. Of the 42: 10 are residue of an
iteration-1 finding that landed narrower than its own shape (I2-4, I2-5, I2-8, I2-11, I2-12,
I2-13, I2-14, I2-22, I2-24, I2-32), 2 are duplication iteration 1's own extractions left behind
as identical wrappers around the new helper (I2-3, I2-19), 30 new.

## 1. Tier 2 — flows and chains

### I2-1 Leaf-table repos cross-app: layout and settings

Instances:

- `Space/internal/storage/repos/layout.go` `scanAll` 32-62 / `Set` 46-96 vs
  `Studio/.../layout.go` 39-75 / 59-125 (S6 0.99): begin tx, read every leaf inside tx, merge
  patch, write each leaf, commit. Only the leaf vocabulary differs (Space 2, Studio 5).
- `Space/.../settings.go` `GetAll` 27-59 vs `Studio/.../settings.go` 27-74 (0.89): the
  `rows.Next()` scan block 43-52 in both is `appstorage.ScanLayoutRows`
  (`internal/appstorage/layout.go:18`) verbatim — extracted for layout, not applied here.
- `Set` `Studio/.../settings.go:185-225` vs `Space/.../settings.go:70-95` (1.00): same tx/read/
  upsert-sections/re-read skeleton as layout's `Set`.
- Upsert chains, all `if p.X != nil { UpsertLeaf(tx, key, *p.X) }`: `Studio/.../settings.go`
  `upsertDataSection` 76, `upsertCacheSection` 83, `upsertAdvancedSection` 90-110,
  `upsertApiSection` 112-152, `upsertDbMcpSection` 154, `upsertClaudeCodeSection` 161-181;
  `Space/.../settings.go` `upsertAdvancedSection` 61; `internal/appsettings/repo.go`
  `UpsertAppearance` 28-68, `UpsertGit` 72-97. S6 1.00 across the Studio three, 0.85 against the
  `appsettings` two.

Differs only in: table name, leaf key set, per-app section types.

Shape: `internal/appstorage/leaves.go` (extend): rename `ScanLayoutRows` to `ScanLeafRows`, use
from both settings `GetAll`; `UpdateLeaves(db, selectAll *sql.Stmt, apply func(tx *sql.Tx,
stored map[string]json.RawMessage) error) (map[string]json.RawMessage, error)` holds the tx/read/
apply/re-read frame for all four `Set`s. `internal/appsettings/repo.go`: `UpsertOptional[T
any](tx, key string, v *T) error`; each section function becomes a list of
`UpsertOptional` calls, or a `[]leafWrite{key, ptr}` table walked once.

### I2-2 Tabs repo `Save`/`List` cross-app, plus the generic scan loop

Instances: `Space/internal/storage/repos/tabs.go` `Save` 71-127 vs `Studio/.../tabs.go` 100-157
(S6 1.00; S5 block 99-126 / 129-156): validate loop, tx, upsert loop, keep-list prune with
placeholders, commit. `List` 24-66 / 25-78 (0.86): same query/scan/`rows.Err` skeleton, Studio
scans two extra `NullString` columns. Same scan skeleton, 19-20 lines each, in
`Studio/.../customscripts.go` `List` 32-51, `Space/.../coderepos.go` `List` 26-45 (1.00),
`Space/.../gitclients.go` `List` 93-112, `Studio/.../collections.go` `listCollections` 64-83 /
`listItems` 85-104 (0.93-0.95), `Studio/.../windows.go` `List` 27-58 vs `Space/.../windows.go`
28-58 (0.92).

Differs only in: column set and scan function.

Shape: `internal/sqlitex/query.go` `QueryAll[T any](rows *sql.Rows, err error, scan
func(*sql.Rows) (T, error)) ([]T, error)` — query, loop, `rows.Err`, close; every `List` above
becomes one call. `internal/appstorage/tabs.go` `ReplaceKeyed(db, table, keyColumn string, keys
[]string, upsert func(tx *sql.Tx) error) error` — tx, upsert callback, prune-not-in-keys, commit;
each app's `Save` keeps its validate loop and its own upsert statement.

### I2-3 `windowStore` adapter ×2 and four identical `WindowBounds`

Instances: `Space/main.go:310-346` and `Studio/main.go:581-614` (S5 23-line block): a
`windowStore` struct adapting `*repos.WindowsRepo` to `shell.WindowRepo` — `SetBounds`/`List`/
`Create`/`Delete`, each converting `model.WindowBounds`/`WindowRecord` to `shell.WindowBounds`/
`WindowRecord` field by field. The struct is declared four times with the same fields:
`Space/internal/storage/model`, `Studio/internal/storage/model`, `internal/appstorage/window.go`,
`internal/shell/openwindow.go`. Iteration 1's T2-15 put the open chain in `shell` and T2-10 the
repo in `appstorage`, and left this adapter identical in both `main.go`.

Shape: `shell.WindowBounds`/`WindowRecord` become type aliases of the `appstorage` types; each
app's `model.WindowBounds`/`WindowRecord` alias them too (the JSON tags already match).
`appstorage.WindowRepo` gains `List`/`Delete` (the `mode` column both apps carry moves with them);
`*appstorage.WindowRepo` then satisfies `shell.WindowRepo` directly and both `windowStore`s go.

### I2-4 `storage.OpenAt` ×2 and `migrations.All` ×3

Instances: `Space/internal/storage/db.go` `OpenAt` 32-50 vs `Studio/.../db.go` 39-57: identical
19 lines — `EnsureLayoutAt`, `DbPathAt`, `migrations.All()`, convert `[]migrations.Migration` to
`[]sqlitex.Migration` in a loop, `appstorage.OpenAt`. `migrations/embed.go` `All` in
`Space/internal/storage` 34, `Studio/internal/storage` 60, `Space/internal/gitreview` 35: same
`Migration` struct, same name-table walk over the embedded FS. Iteration 1 declined `All ×3`
because `//go:embed` resolves per package (P103 §2.3). The directive does; the struct and the
loop do not.

Shape: `internal/sqlitex/load.go` `LoadMigrations(fsys fs.FS, names []struct{Version int; Name
string}) ([]Migration, error)`; each `embed.go` keeps its `//go:embed` and its name table and
its `All` becomes one call returning `[]sqlitex.Migration`. `storage.OpenAt` loses the convert
loop; what is left (three lines) stays per app.

### I2-5 `bridge/terminal.go` `Open` validation chain

Instances: `Space/internal/bridge/terminal.go` `Open` 85 (block 39-106) vs
`Studio/.../terminal.go` 144 (block 86-165), S5 39 lines: `TerminalID`/`WindowKey` required,
`terminal.ValidDim` rows/cols, `filepath.IsAbs` + `os.Stat` on cwd, `MaxCommandBytes`,
`terminal.ValidLaunchKind`, each mapped to `ipcerr.BadRequest` with the same message. Studio adds
`AgentHooks` composition after the chain. T2-7 moved the service and coalescer to
`internal/terminal`; the validation stayed in both bridges.

Shape: `internal/terminal/validate.go` `ValidateOpen(args OpenArgs) error` returning the
`ipcerr` values; both `Open`s call it first. The bound arg structs stay per app (P103 §2.3);
`OpenArgs` is the plain struct they convert to.

### I2-6 Bridge service bodies cross-app: tabs, layout, settings, lifecycle, link, files

Instances (`Space/internal/bridge` vs `Studio/internal/bridge`): `tabs.go` 10-54 / 9-54 (S5 27
lines: window-exists check, `Validate` loop, `Save`, error mapping), `layout.go`, `settings.go`,
`lifecycle.go` (byte-identical bodies), `link.go` `OpenExternal` 28 in both (URL parse, scheme
allow-list, `browser.OpenURL`), `files.go` `ChooseFolder` 37 / 125 (dialog options, cancel
mapping). Iteration 1 declined "bridge thin wrappers" as one-liners; these are 15-27 lines each.

Differs only in: the bound struct type and the repo field it reaches.

Shape: bound types stay per app (P103 §2.3); bodies move: `internal/shell/link.go`
`OpenExternalURL(raw string) error`, `internal/shell/dialogs.go` `ChooseFolder(ctx, title)
(string, bool, error)`, `internal/appstorage/tabs.go` `SaveWindowTabs(windows WindowRepo, tabs
TabsSaver, windowKey, records)`. Each bound method becomes one delegating line.

### I2-7 `appshell/menu.go` item builders

Instances: `Space/internal/appshell/menu.go` 23-43 vs `Studio/.../menu.go` 35-57 (S5 18 lines):
the Edit section (undo/redo/cut/copy/paste/select-all with roles) identical; the App section
prefix/suffix and the Window section tail identical; only each app's extra items differ.

Shape: `internal/shell/menu.go` `EditMenu()`, `AppMenuHead(name)`, `AppMenuTail()`,
`WindowMenuTail()` returning `[]*menu.MenuItem`; each app's `BuildMenu` composes and inserts its
own items.

### I2-8 History `Record`/`Get`: gRPC vs HTTP

Instances: `Studio/internal/storage/repos/grpc_history.go` `Record` 65-218 vs
`response_history.go` `Record` 61-209 (S6 0.78, ~110 lines each): `Validate`, tx, resolve
environment name via `SELECT name FROM api_environments`, build snapshot, marshal, elide when
over half the budget and re-marshal, uuid, `itemID`/`scopeKey`, `INSERT`, per-scope cap
`DELETE`, `SUM(stored_bytes)` windowed budget sweep, commit. `Get` 254-288 / 269-303 (1.00): row
scan + snapshot unmarshal. T2-14 built `historyTable[T]` (`history.go`: `List`/`Delete`/`Adopt`/
`SweepOrphans`) and left `Record`/`Get` "genuinely differ" — the snapshot struct differs; the
chain around it does not.

Shape: extend `historyTable[T]` with `Record(db, entry recordInput, build func(envName string)
(T, error), elide func(*T)) (string, error)` and `Get(db, id string) (T, error)`; each repo
supplies its snapshot builder and elision. Budget/cap SQL parameterized by the table fields the
struct already carries.

### I2-9 Collections and connections repos: parallel CRUD pairs

Instances (`Studio/internal/storage/repos/`):

- `collections.go` `GetRequest` 127-146 vs `GetGrpcRequest` 149-168 (S6 1.00; protocol constant
  and decoder differ), `CreateItem` 230-283 vs `CreateGrpcItem` 288-332 (0.74), `SaveRequest`
  368-415 vs `SaveGrpcRequest` 419-458 (0.72).
- `variables.go` `RevealValue` 1002-1022 vs `RevealHistoryValue` 1026-1046 (1.00): table,
  scope column and error noun differ.
- `connections.go` `Insert` 168-212, `InsertWithSecret` 256-300, `InsertDuplicateWithSecret`
  324-369 (0.84-0.96): same tx, next-sort-order, `INSERT`, commit, `Get`; `Update` 214-245 vs
  `UpdateWithSecret` 403-455 (0.77); the connection column list repeated five times. Iteration
  1's "simple CRUD repos" decline covered per-table SQL; three copies of one table's `INSERT` is
  not that.

Shape: `collections.go` `getRequestBody(itemID, protocol string, decode func([]byte) (any,
error))`, `createItem(tx, kind, protocol, parentID, name, body)`, `saveRequestBody(itemID,
protocol, body)`; `variables.go` `revealSecret(table, scopeColumn, noun, id)`; `connections.go`
`connectionColumns` const and `insertConnection(tx, rec, secretRef *string) error` used by all
three inserts, `updateConnection(tx, rec, secretRef *string)` by both updates.

### I2-10 `tree/service.go` cached reads and `adapterhost` prologues

Instances: `Studio/internal/tree/service.go` `Children` 129-157, `Describe` 162-187,
`Definition` 190-215, `SchemaColumns` 221-249 (S6 1.00 for Describe/Definition, 0.82 the rest):
cache check, `requireConnected`, `DecodePath`, backend call, `Put`. `Studio/internal/adapterhost/
router.go` `Describe` 169-193 vs `Definition` 195-217 (1.00): `RunOp` wrapper. `adapterhost/
data.go` `Read` 48-87, `Count` 91-125, `Mutate` 149-170, `ObjectDownload` 175-194 (0.74-0.92):
`requireLiveAdapter` + `decodePath` + `RunOp(OpSpec{…})` + `value.(T)` assertion; cache halves
differ per method.

Shape: `tree/service.go` `cachedRead[T any](s *Service, connID string, path, get func() (T,
bool), fetch func(ctx, adapter, decoded) (T, error), put func(T))`; `adapterhost/op.go`
`runOp[T any](d *Dispatcher, ctx, connID, kind, opID, tabID string, call func(ctx, adapter,
path, op) (T, error)) (T, error)` used by the six dispatcher methods; cache reads/stores stay in
`Read`/`Count` around the call.

### I2-11 Relational adapter residue: mysqlfamily, postgres, sqlite

Instances (after T2-1's `relationalpage.go`/`sqlmutate.go`/`connset.go`):

- `Children`: `A/mysqlfamily/adapter.go:128-174` vs `A/postgres/adapter.go:119-181` (S6 0.98),
  `A/sqlite/adapter.go:193-230` (0.71): depth walk, `"database"` root check, per-depth list call,
  leaf kinds return `[]`, "unrecognized path depth".
- `readPage` tail: `A/mysqlfamily/read.go:128-165`, `A/postgres/read.go:146-183`,
  `A/sqlite/read.go:169-196` (S5 24/19 lines, byte-identical): first/last row capture,
  `ReverseRows` swap, `displayRowCount`, `BuildKeysetPosition` with the same `CellAt` closure,
  `builder.Finish`. Fingerprint struct literal `read.go:69-89` / `68-89` (18 lines) identical.
- `mutate`: `A/mysqlfamily/mutate.go:45-91` vs `A/postgres/mutate.go:51-100` (1.00 modulo
  placeholder function, `START TRANSACTION`/`BEGIN`, `ExecContext`/`Exec`); sqlite 47-98 (0.86).
- `execFor`: `A/mysqlfamily/catalog.go:16-40` vs `A/postgres/catalog.go:21-45` (0.87).
- `NewConnSet`: `A/mysqlfamily/client.go:249-271` vs `A/postgres/client.go:158-183` (0.87).
- `listSchemaColumns` 180-226 / 251-297 (0.74); `A/mysqlfamily/catalog.go` `listForeignKeys`
  282-310 vs `listReferencedBy` 314-341 (0.99: same query shape, mirrored columns).

Shape: `A/relationalpage.go` (extend): `KeysetPageCollector` holding first/last/rowCount/
probedExtra with `Finish(builder, plan, req, fetch, order)`; `RelationalFingerprint` struct type
replacing the three anonymous literals. `A/sqlmutate.go` (extend): `RelationalMutateDeps{Resolve,
Placeholder, BeginSQL, Exec, Rollback}` and `RunRelationalMutate(ctx, deps, plan, readOnly)`
folding the three `mutate` bodies. `A/tree.go` (new): `WalkRelationalChildren(path, listRoot,
listObjects func(db) …, leafKinds)`. `listForeignKeys`/`listReferencedBy` become one
`queryForeignKeys(sql, mapRow)` with two call sites. `execFor`/`NewConnSet` differ in driver
types only; leave unless a generic over `rows` type reads shorter — note in the commit either
way.

### I2-12 Row-op mutate residue: mongo, redis, s3, sqs, and mongo console pairs

Instances: `A/mongo/mutate.go` `mutateDB` 171-206, `A/redis/mutate.go` 156-188,
`A/s3/mutate.go` `mutate` 207-238, `A/sqs/mutate.go` 63-72 (S6 0.93-0.98): `AssertWritable`,
path resolve, `preview(plan)`, a hand-rolled `";\n"` join loop into `commandText`,
`op.SetCommand`, `RunRowOps` with the same `switch rowOp.Kind` dispatch. T2-4 extracted
`RunRowOps`/`PreviewProduce`; T1-3 replaced join loops elsewhere and missed these four.
`A/mongo/console.go`: `runUpdateOne` 336-363 vs `runUpdateMany` 365-391 (1.00), `runDeleteOne`
393-409 vs `runDeleteMany` 411-427 (1.00), `runInsertOne`/`runInsertMany` (0.90), `runFind`
234-263 vs `runAggregate` 447-472 (0.82): arg coercion, `RunWithAbortRace` around one driver
call, `statusPage`.

Shape: `A/rowops.go` (extend): `RunKindDispatched(ctx, op, plan, readOnly, statements []string,
insert, update, delete func(ctx, rowOp) (int, error))` — `strings.Join(statements, ";\n")`,
`SetCommand`, `RunRowOps` with the switch, once. `A/mongo/console.go`: `runFilterUpdate(ctx,
collection, stmt, op, name string, call func(ctx, filter, update bson.D) (*UpdateResult, error),
withUpsert bool)`, `runFilterOnly(…)` for delete/count, so each `run*` is the driver call plus
its status keys.

### I2-13 `gitrpc` handler template residue

Instances: 56 `handle*` methods in `Space/internal/gitrpc`; `handleRepoCall` (`handle.go:21`,
T2-12) is used in 13 (`refs.go` 4, `detail.go` 3, `stack.go` 4). The other 43 still hand-roll
decode / required-field check / `entryFor` / call / map: `stash.go` `handleStashList` 24-41,
`handleStashShow` 54-74, `handlePreflightStashPop` 76-96, `handlePreflightStashBranch` 98-118,
`handleGlobalStashList` 123-140 (S6 1.00 pairwise); `worktree.go` ×5 (24-41 == stash's list,
1.00), `comments.go` ×5 (`List` vs `Export` 0.84, `Remove` vs `Clear` 0.91), `remote.go` ×5,
`incremental.go` ×3, `review.go`, `reset.go` ×2, `ops.go` ×3, `gh.go` ×3, `graph.go` ×4,
`settings.go` ×3, `search.go`.

Shape: convert every handler whose params carry `repoId` to `handleRepoCall`; the per-op
required-field check and the `validStashScope` check are the `resolve` closure, the error mapper
(`mapGitError`/`mapStashError`/`mapDetailError`) wraps the `call` closure — exactly how
`refs.go` already does it. Add `requireNonEmpty(op string, fields map[string]string) error` for
the "X and Y are required" messages. Handlers with no repo (`credential.provide`, `settings.*`)
get a sibling `handleCall[P, R]` without `entryFor`.

### I2-14 Paged view stores: navigation, load frame, search

Instances (`SF/views/`):

- Navigation, byte-identical modulo the tab accessor pair (`findDocumentTab`/
  `patchDocumentTabState`, `findDataTab`/`patchDataTabState`, `keyValueHost(viewKey)`/
  `host.patch`): `documents/state.ts` `stop` 156, `goNext` 167, `goPrev` 180, `goFirst` 196,
  `goLast` 204, `goToPage` 215, `resetTokens` 230; `grid/state.ts` 248, 260, 273, 252, 288, 299,
  310; `shared/keyvalue/state.ts` `stop` 161, `goNext` 168, `goPrev` 181; `stream/state.ts` `stop`
  204, `goNext` 227.
- `load`: `documents/state.ts:76-130` vs `grid/state.ts:135-208` (S6 0.83): effective-cursor
  fallback, `beginOp`, `data.read({...})`, runtime-gone and superseded guards, page-kind check,
  `setPage`, position fields, `applyLoadFailure` + `pageIndex` revert.
- `runSearch`: `grid/search.ts:20-47` vs `shared/keyvalue/search.ts:25-53` (0.76),
  `documents/search.ts:32`: the column/row scan loop feeding `createMatchIndex`.

T2-16 landed as `runPagedCount` only; its stated reasons for stopping (async vs sync
`setProjection`/`setSort`, keyvalue's `keyValueHost()` seam) do not apply to the navigation
functions, which take the same four closures in all three stores, nor to the load frame.

Shape: `SF/views/shared/page/navigation.ts` `createPageNavigation<T>(host: { tab(id): { pageIndex,
pageSize } | undefined; patch(id, { pageIndex }); runtime(id); ensureRuntime(id); load(id, cursor,
prevIndex) })` returning `stop/goNext/goPrev/goFirst/goLast/goToPage/resetTokens`; each store
spreads the result. `SF/views/shared/page/load.ts` `runPagedLoad({ rt, opId, read, expectKind,
apply, onFailure })` for the frame; grid keeps `clearPending`/`loadMeta`/`clearCellFocus` in its
`apply`/`onFailure`. `shared/page/search.ts` (extend): `scanRows(rowCount, cellText, matcher)`
so the three `runSearch` keep only their cell accessor.

### I2-15 Studio tree menus

Instances: `SF/project/menus.ts` `relationMenu` 315-395, `collectionMenu` 401-470 (S6 0.98; S5
27-line block 339-376 / 423-460), `streamNodeMenu` 506-549 (0.76), `consumerGroupMenu` 555-586
(0.77): open, open-in-new-tab, caps-gated definition, `consoleMenuItem`, refresh, copy-name,
copy-qualified-name, count. `SF/views/browse/menu.ts` 46-70 vs 84-108 (S5 19 lines): open /
open-in-new-tab / copy-name repeated in `keyRowMenu` and `objectRowMenu`.

Shape: `SF/project/menuItems.ts` `openItems(row, open: (opts?) => void)`, `definitionItem(row)`,
`refreshItem(row)`, `copyNameItems(row, qualified?)`, `countItem(row, label)`; the six menus
compose and append their own rows.

### I2-16 HTTP vs gRPC request: view chrome, resolver, tab open

Instances:

- `SF/views/grpcrequest/GrpcRequestView.vue:54-78` == `SF/views/httprequest/HttpRequestView.vue:
  84-109` (S5 19 lines): `envColor`/`connRecord`/`railColor`/`runState`/`runStateLabel`/
  `incognito`/`toggleIncognito`/`envId`.
- `httprequest/state.ts` `resolveTabState` 88-117 vs `grpcrequest/state.ts` `resolveGrpcTabState`
  40-60 (0.97): `refs` accumulator + `sub` closure over `resolve`, enabled-and-named pair filter/
  map. HTTP adds `subUrl` and body substitution.
- `SF/api/tabs.ts` `openCollectionRequestTab` 56-79 vs `openCollectionGrpcRequestTab` 106-126
  (1.00): find-by-itemId, activate, `schema.parse({...defaults, ...fromSaved, itemId, name})`,
  `openTab(kind, …)`.

Shape: `SF/views/shared/request/useRequestChrome.ts` (`useRequestChrome(tab)` returning the eight
bindings); `SF/views/shared/request/resolve.ts` `createSubstituter(values, secretNames, dynamic)`
returning `{ sub, subUrl, refs }` and `resolvePairs(list, sub)`; `SF/api/tabs.ts`
`openSavedRequestTab({ kind, itemId, name, schema, defaults, fromSaved })`.

### I2-17 `beautify.ts` vs `ejson.ts`: raw-tree parser and renderer

Instances: `SF/beautify.ts` `parseJsonObject` 106-135 / `parseJsonArray` 137-159 vs
`SF/views/shared/document/ejson.ts` `parseShellObject` 628-660 / `parseShellArray` 662-689 (S6
0.88/0.92); `renderJsonIndented` 182-216 / `renderJsonCompact` 218-239 vs `renderShellIndented`
709-743 / `renderShellCompact` 745-766 (0.88/0.83). Differs: shell accepts unquoted keys and a
trailing comma; shell render normalizes the key through `JSON.stringify`. Both are
spelling-preserving re-encoders — the CLAUDE.md library rule's own named exception — so no
library replaces them; the two hand-rolled copies still collapse to one.

Shape: `SF/views/shared/document/rawTree.ts`: `RawNode` type, `parseContainer(cursor, {
parseKey, parseValue, skipWs, allowTrailingComma, error })`, `renderIndented(node, keyText)`,
`renderCompact(node, keyText)`; `beautify.ts` and `ejson.ts` keep scanners and literal rules.

### I2-18 Settings panes cross-app

Instances: `PF/workbench/settings/AppearancePane.vue` 66-130, 137-171, 202-276 ==
`SF/workbench/settings/AppearancePane.vue` 159-223, 228-262, 349-423 (S5 44 + 25 + 48 lines):
the data font-size field with stepper and range error, the row-density button pair, the
word-wrap and date-format leaves; `AdvancedPane.vue` 22-53 == 210-241 (24 lines: git log level
select); `SettingsDialog.vue` 20-47 == 22-49 (deep-link `onBeforeUnmount` reset, `save`, shell
binding). `settings/types.ts` differs only in the `Pick<Settings, …>` key list. P103 §5.5 put
`SettingsShell.vue` in `@workbench`; the fields it hosts stayed copied.

Overlap with P105: each field's reset button is the disabled-tooltip wrapper P105 §4.2 is
replacing. Extract the fields around it; consume `TooltipDisabledTrigger` once P105 lands, do
not re-implement the wrapper.

Shape: `packages/workbench/src/settings/fields/` `FontSizeField.vue`, `RowDensityField.vue`,
`WordWrapField.vue`, `DateFormatField.vue`, `GitLogLevelField.vue`, each taking `draft`,
`isAtDefault`, `resetLeaf`, `patch` through the existing `SettingsPaneProps` contract;
`useSettingsDeepLinkReset(store)` for the dialog's unmount hook. Panes become field lists.

### I2-19 Terminal views after T2-21

Instances: `SF/views/terminal/TerminalView.vue` 24-50, 98-123 == `PF/views/repo/
RepoTerminalView.vue` 9-35, 50-75 (S5 19 + 17 lines): after `useTerminalMount` was extracted the
two components are still line-identical — the `rendererDeps` object, the composable call with
seven store functions, the template, the scoped style. Duplication iteration 1's own extraction
left in place.

Shape: `packages/workbench/src/terminal/TerminalHostView.vue` owning the template, style and the
composable call, with `tab` and a `deps: TerminalHostDeps` prop (the seven functions + appearance
getter); each app's view is a 12-line wrapper building `deps` from its stores. Or a
`provide`/`inject` key for the deps and no per-app wrapper at all.

### I2-20 Space frontend: repo menus, diff tab open, monaco URIs

Instances: `PF/repo/GitPanel.vue` `onRepoContextMenu` 135-191 vs `onWorktreeContextMenu` 204-259
(S6 0.84): rename/close/remove item triples with the same handlers. `PF/state/repoTabs.ts`
`openRepoCommitDiffTab` 108-165 vs `openRepoReviewDiffTab` 200-240 (0.84): find existing diff
tab, reuse branch, `openTab('repo-diff', …)`. The reuse branches differ: the commit variant
evicts the preview cohort (P79 fix), the review variant does not — a behavioural divergence to
decide, not to unify silently; ask whether the review path missed the P79 fix before extracting.
`PF/views/repo/monaco.ts` `repoDiffUris` 58-77 vs `repoRevisionDiffUris` 84-105 (1.00): two
`Uri.from` with query strings.

Shape: `GitPanel.vue` `recordMenuItems(record, { rename, close, remove })`; `repoTabs.ts`
`openRepoDiffTab({ repoId, path, match, init, pinned, previewCohort })` once the reuse-branch
question is settled; `monaco.ts` `repoUriPair(mod, repoId, path, [queryA, queryB])`.

### I2-21 `StashList.vue` vs `GlobalStashList.vue`, and the ref-menu pair

Instances: `packages/git-ui/src/components/GlobalStashList.vue` `select` 51, `openMenu` 58,
`openMenuFromButton` 63, `onMenuSelect` 76-96 vs `StashList.vue` 62, 69, 74, 87-113 (S6 1.00 for
`onMenuSelect`); row template identical apart from the label cell. `TagList.vue` `openRefMenu`/
`openRefMenuFromButton` 58-67 == `BranchPicker.vue` 404-413.

Shape: `StashRows.vue` (list body: rows, selection, menu open/select) with `menuFor(entry)` and
`rowModel(entry)` props and a `label` slot; the two components become the header plus one
`<StashRows>`. `useRowMenu(open: (row, event) => void)` for the ref-menu pair.

### I2-22 `git-ui` state: latest-request residue

Instances: `packages/git-ui/src/state/reviewFiles.ts` `#loadFiles` 111-137, `#loadDiff` 208-237,
`reviewComments.ts` `#load` 65-89 (S6 0.99 / 0.75): abort previous controller, new controller,
`loading = true`, `stillCurrent` closure, request with signal, guard, apply, swallow cancelled
`TransportError`, set error, `finally` reset. T1-23's `createLatestRequest` (`latestRequest.ts`)
is used by `detail.ts` and `working.ts` only.

Shape: extend `latestRequest.ts` with `runLatest<T>({ request: (signal) => Promise<T>,
stillCurrent, onResult, onError, setLoading? })` implementing the frame once; the three methods
become one call each with their `stillCurrent` predicate.

### I2-23 `ops.ts`: preflighted op and confirm-slot pattern

Instances: `packages/git-ui/src/state/ops.ts` `runRevert` 594-625 vs `runCherryPick` 775-813
(S6 0.82): busy guard, preflight request, conditional dialog through a `#confirm*` promise,
repo-changed guard, cancelled announcement, `op.run`, `#applyResult`, announcement. `runPush`
1589-1614 vs `runForcePush` 1625-1658 (0.79). Six `#confirmX(pending): Promise<Route | null>`
methods each storing a `pendingX` ref and a `#resolveX` slot (`Checkout`, `Revert`,
`CherryPick`, `ForcePush`, `Reset`, `StashPop`) with matching `resolveXDialog` methods.

Shape: `packages/git-ui/src/state/pendingSlot.ts` `createPendingSlot<P, R>()` returning
`{ pending: Ref<P | undefined>, ask(p): Promise<R | null>, resolve(r) }`; six fields become six
slots. `#runPreflighted({ preflight, needsDialog, slot, buildOp, announce, cancelText })` for
revert/cherry-pick (push/force-push keep `#runRemote` and use the slot only).

### I2-24 VS Code webview providers (T2-24's unlanded half)

Instances: `vscode/src/panelView.ts` `resolveWebviewView` 57-81 vs `reviewView.ts` 58-81 (S6
0.95): options, html, message pump, dispose; `notifySettingsChanged` 105/108,
`notifyRepoChanged` 111/131 (its comment: "a three-line copy of `panelView.ts`'s own"),
`notifyConnectionState` 142/139, `notifyRepoSettingsChanged` 153/148, `notifyStackProgress`
135/156. Commit `e9fca4aa` landed T1-26 (`virtualUri.ts`) only; the `createWebviewProvider` half
of T2-24 never did.

Shape: `vscode/src/webviewProviderBase.ts` abstract `WebviewProviderBase` with
`resolveWebviewView` (calls an abstract `bootstrap()`), the shared `notify*` methods and the
channel/server fields; `KiraGraphViewProvider`/`KiraReviewViewProvider` keep deps, bootstrap
island and their own extras (`runUiAction`, `reviewBranch`, worktree/remote progress).

### I2-25 Studio UI spec helpers

Instances (`Studio/tests/ui/*.spec.ts`, definition counts): `modeTab` ×15,
`openHttpModeAndNewRequest` ×9, `connectionCreateArgs` ×8 (one variant adds the six `mcp*`
fields), `connectAndExpand` ×7 (per-engine field sets), `typeInto` ×6 (`insertText` vs `type`
variants), `openConsoleFromMenu` ×6, `installClipboardSpy`/`lastClipboardWrite` ×3,
`openSettings` ×3, `httpResponse` ×3, `connectRedis`/`connectMongo`/`grpcTab`/`hoverWord` ×2.
S5's largest within-suite blocks (`interaction.spec.ts` 529-1040 ×8, `data-view.spec.ts` 258-794
×5, `slick-grid.spec.ts` 1329-1867 ×5, `connections.spec.ts` 210-264 ×2, `mask-preview.spec.ts`
×2, `sql-schema.spec.ts` ×3, `http-request.spec.ts` ×2) are these helpers inlined. T2-22's
`engineFixture.ts` holds the engine trio only.

Shape: `Studio/tests/ui/support/apiMode.ts` (`modeTab`, `openHttpModeAndNewRequest`, `grpcTab`,
`httpResponse`), `support/connect.ts` (`connectionCreateArgs(kind, { mcp? })`,
`connectAndExpand(page, engine)`, `connectRedis`/`connectMongo`, `openConsoleFromMenu`),
`support/editor.ts` (`typeInto(view, page, text, { paste? })`, `hoverWord`),
`support/clipboard.ts`, `support/settings.ts`; specs import.

### I2-26 Fixture seed literals

Instances: `Studio/tests/ipc/mariadb/mariadb.fixture.ts:431-539` == `Studio/tests/ui/
data-view.spec.ts:271-379` == `Studio/tests/ui/support/postgresFixture.ts:539-644` (S5 105
lines: the md5-rows tabular page); `budgets.spec.ts:213-314` == `postgresFixture.ts:289-390`
(70: tree/columns snapshot); `cellEditorCaptures.ts:674-711` == `postgresFixture.ts:657-694`;
`mariadb.fixture.ts` vs `mysql.fixture.ts` 46-78, 118-153, 174-205 (24-27 each) and within-file
247-293 / 337-383; `mariadb.fixture.ts:260-289` == `ui/support/mariadbFixture.ts:187-216`;
`clickhouse.fixture.ts` 351-393 / 423-465; `sqs.fixture.ts` 118-202 / 211-295 (54);
`packages/db-fixtures/support/mariadb.ts:135-157` == `postgres.ts:82-104`.

Shape: `Studio/tests/support/seeds/` one module per literal (`md5RowsPage.ts`,
`appTreeSnapshot.ts`, …) exported once and imported by ipc fixtures, ui fixtures and specs; the
within-file repeats become a `snapshotFor(variant)` function in each fixture. `db-fixtures`
`start` shared prologue into `support/common.ts`.

### I2-27 Unit and state test harnesses

Instances:

- `Studio/tests/unit/console-*.spec.ts` ×4 (`overlapping-explain-clobber` 9-46,
  `stop-auto-explain` 8-45, `auto-explain-race` 11-47, `stop-explain-resolves-anyway` 9-45): the
  same pinia/bridge/store bootstrap plus local `deferred` and `sleep`. `deferred` defined in 13
  files across `Studio/tests/unit`, `git-ipc/src/rpc.test.ts`, `git-ui/src/state/working.test.ts`;
  `sleep`/`tick` in 7.
- `packages/git-ui/src/state/{ops,pr,stack,repoSettings,reviewFiles,working}.test.ts` 18-70: the
  same `FakeTransport` class (`request`/`on`/`emit`/`stream`/`dispose`, `calls` log) and `tick`.
- `vscode/tests/interaction/support/server.ts` vs `tests/layout/support/server.ts` (55 of ~140
  lines differ; 83-128 identical), both containing `packages/workbench/src/testing/ui/server.ts`
  46-68 (static-file branch) verbatim.
- `vscode/tests/interaction/support/fakeGraphHost.ts` 355-372 / 386-412 / 448-474 (chunk
  scripts), 289-305 vs `fakeReviewHost.ts` 70-86, 171-193 vs `Space/tests/ui/support/
  graphStreamFixture.ts:129-151` (`toArrayBuffer` + packed-chunk builder);
  `vscode/src/linkOpenExternal.test.ts:15-38` == `prOpenExternal.test.ts:13-36` (stub host).

Shape: `packages/workbench/src/testing/unit/async.ts` (`deferred`, `sleep`);
`Studio/tests/unit/support/consoleHarness.ts` (the bootstrap, returns the three stores);
`packages/git-ui/src/testing/fakeTransport.ts`; `vscode/tests/support/webviewServer.ts`
`startWebviewServer({ view, bootstrap })` built on a `serveStatic(distDir)` helper exported from
`@workbench/testing/ui/server`; `packages/git-core/src/testing/packedChunk.ts`
(`toArrayBuffer`, `buildPackedChunk(rows)`); `vscode/src/testing/stubHost.ts`.

### I2-28 Go test helpers

Instances: `waitUntil` ×3 (`Studio/internal/keepawake/caffeinate_test.go`, `oplog/wire_test.go`,
`preconnect/supervisor_test.go`), `processAlive` ×2, `asIpcErr` ×2 (`connections/service_test.go`,
`secrets/cipher_test.go`), `derefOrNil` ×2 (`Studio/…/connections/uri_test.go`,
`Space/…/gitreview/resolve_test.go`), `indexOf` ×2, `skipWithoutGit` ×2, `nodePath` ×9 (every
adapter `_test.go`), `offsetRead` ×3 (kafka/sqs/s3); `Space/internal/gitsession`
`newIncrementalTestEntry`/`newStackTestEntryWithRunner`/`newQueriesTestEntry`/
`newWorktreeTestEntry` (4 files); `Space/internal/gitrpc` `resetSmokeConn`/`searchSmokeConn`
(+1); `Space/internal/gitsock` `buildOpsFixtureRepo` 57-81 == `buildReviewFixtureRepo` 48-72,
`buildDetailFixtureRepo`, `buildAskFixtureRepo`; `Studio/internal/ipcfixture/clickhouse_test.go:
73-106` == `mysql_test.go:80-116`; `A/s3/authmatrix_test.go:68-117` vs `A/sqs/authmatrix_test.go:
76-129` (comments differ only); `A/mysqlfamily/mysqlfamily_test.go:955-1007` ==
`A/sqlite/sqlite_test.go:620-672` (insert/delete round trip); `Space/internal/layering_test.go`
28-62 vs `Studio/internal/layering_test.go` 39-85 (exemption sets differ, runner identical).

The conformance suites keep per-capability coverage (CLAUDE.md exemption); only the helper
mechanics dedupe.

Shape: `internal/testx` (repo-root): `WaitUntil`, `ProcessAlive`, `DerefOrNil`, `SkipWithoutGit`,
`AsIpcErr`; `A/adaptertest`: `NodePath`, `OffsetRead`, `InsertDeleteRoundTrip(t, a, path)`;
`gitsession` `newTestEntry(t, testEntryOpts{runner, script, store})`; `gitrpc` `smokeConn(t,
dir)`; `gitsock` `fixtureRepo(t, fixtureSpec)`; `internal/layeringtest.Run(t, modulePrefix,
exempt map[string]bool)`; ipcfixture and authmatrix tables become `for _, tc := range` over an
engine list.

## 2. Tier 1 — helpers and narrow functions

### I2-29 Token mint/hash/verify ×2

`Space/internal/gitsock/token.go` `mintToken` 27, `hashToken` 39, `verifyToken` 47 vs
`Studio/internal/mcpauth/token.go` `MintTTL` 53, `hashToken` 69, `Verify` 79 — same random
bytes, salted SHA-256, constant-time compare; each file's comment acknowledges the other. Shape:
`internal/tokenauth` (repo-root): `Mint() (plain string, hash, salt []byte, error)`, `Hash(tok,
salt)`, `Verify(presented string, hash, salt []byte) bool`; `mcpauth` keeps `Record`/TTL/file
persistence around it.

### I2-30 `model/tabs.go` `Validate` ×2

`Space/internal/storage/model/tabs.go:55` vs `Studio/.../tabs.go:75`: same kind/window/state
checks; Space requires `workspaceId` always, Studio only for `terminal`. `IsRenderableTabKind`/
`IsJSONObject` thin wrappers in both. Shape: `appstorage.ValidateTab(rec TabFields, requireWorkspace
func(kind string) bool) error`; each model keeps its kind table.

### I2-31 `reindex*` ×3

`Studio/internal/storage/repos/variables.go` `reindexEnvironments` 297-322, `reindexVariables`
642-671, `collections.go` `reindexSiblings` 569-598 (S6 0.77-0.84): `SELECT id … ORDER BY
sort_order, created_at, id`, then `UPDATE … SET sort_order = ?` per row. Shape:
`internal/sqlitex/reindex.go` `ReindexSortOrder(tx, selectSQL, updateSQL string, args ...any)
error`.

### I2-32 `gitreview/migrate.go` vs `sqlitex.Migrate` (T1-8 residue)

`Space/internal/gitreview/migrate.go` `migrate` 16-82 vs `internal/sqlitex/sqlitex.go` `Migrate`
116-166 (S6 0.76): the same runner, line for line, plus `normalizeStoredPaths`. T1-8 named it;
commit landed `sqlitex.Open` in `db.go` only, the runner and its "D4" comment survived. Shape:
`migrate` = `sqlitex.Migrate(db, steps)` then `normalizeStoredPaths`; delete the runner and the
comment. Behaviour change: the too-new case returns `*sqlitex.SchemaTooNewError` instead of a
formatted string — check `gitreview`'s callers classify by type, not text, before landing.

### I2-33 `gitsession` stash-list tail and `porcelain` identity parse

`Space/internal/gitsession/stash.go` `StashList` 39-69 vs `GlobalStashList` 98-137 (0.81): the
`distinctBaseShas` → `StashBaseSubjectArgs` → `ParseStashBaseSubjects` → re-parse → nil-to-empty
tail. `Space/internal/gitclient/porcelain/log.go` `ParseLogRecord` 117-148 vs `ParseScanRecord`
164-196 (0.76): author/committer time parse and `CommitIdentity` pair. Shape: `stash.go`
`e.resolveBaseSubjects(ctx, provisional) (map[string]string, error)`; `log.go`
`parseIdentities(fields) (author, committer CommitIdentity, error)`.

### I2-34 `grpcclient/reflect.go` `fetch` ×2

`Studio/internal/grpcclient/reflect.go` `v1Transport.fetch` 71-94 vs `v1AlphaTransport.fetch`
135-158 (1.00), `listServices` likewise; only the proto package differs. Shape: one generic
`fetchWith[Req, Resp any](stream, build, read)` or an interface over the two stream types; keep
the two thin transports.

### I2-35 Ordered-object `MarshalJSON` ×2

`Studio/internal/storage/model/mutations.go` `RowValues.MarshalJSON` 41-62 vs
`A/redis/read.go` `streamFields.MarshalJSON` 261-282 (0.95): ordered name/value pairs to a JSON
object. Shape: `internal/jsonx` (repo-root, or `A/jsonutil`) `MarshalOrderedObject(pairs
[]struct{Name string; Value any}) ([]byte, error)`.

### I2-36 Reveal gate ×2

`Studio/internal/connections/service.go` `Reveal` 472-495 vs `Studio/internal/apivars/reveal.go`
`reveal` 52-76 (0.81): `Auth.Authorize`, cancelled/unavailable switch, fetch, log. Result types
differ. Shape: `internal/localauth` (extend) `Gated(auth, reason string, confirmed bool, fetch
func() (string, error)) (Outcome, string, error)`; each service maps `Outcome` to its own result.

### I2-37 Adapter transport error tail and relational `caps.go`

`A/redis/errors.go` 39-47, `A/kafka/errors.go` 41-, `A/awscfg/errors.go` 67-, `A/clickhouse/
errors.go` 86-93: `*net.DNSError` / `net.Error` timeout / connection-refused classification to
`CodeConnection`/`CodeTimeout`. `A/mysqlfamily/errors.go` `mapError` 15-45 vs `A/postgres/
errors.go` 24-54 (0.85): same skeleton around driver-specific codes. `A/{mariadb,mysql,postgres,
sqlite}/caps.go` 3-33 byte-identical (sqlite adds two fields). Shape: `A/errors.go` (extend)
`MapNetError(err) (*Error, bool)` called first by every `mapError`; `A/caps.go`
`RelationalCaps` base value, each package copies and overrides.

### I2-38 Within-file Vue template repeats

`SF/views/httprequest/RawExchangePane.vue` 177-209 == 249-281 (S5 24 lines: request/response
sections rebuilt per branch); `SF/views/shared/AutocompleteField.vue` 468-486 == 492-510
(`<textarea>` and `<input>` with 19 identical attributes); `SF/views/console/
ConsoleSlickGrid.vue` 760-785 == `SF/views/grid/SlickGridHost.vue` 2071-2100
(`SlickHybridSelectionModel` options, `velocity`/`lastScrollEventAt`/`scrollEventSeq` wiring;
T2-17 declined the handlers, not this block). `RawExchangePane.vue`'s copy buttons are inside
P105's tooltip-wrapper edit — extract the section, leave the button markup as P105 leaves it.
Shape: `RawExchangePane.vue` one `RawSection` local block via `v-for` over `[request, response]`;
`AutocompleteField.vue` a `fieldAttrs` computed bound with `v-bind`; `SF/views/shared/slick/
selectionModel.ts` `createHybridSelectionModel(gutterField)` and `attachScrollProbes(grid,
tracker, seq)`.

### I2-39 `App.vue` `<AppToolbar>` bound twice

`packages/git-ui/src/App.vue` 1604-1623 == 1630-1649 (S5 18 lines): the same 16 props and 12
listeners on `<AppToolbar>` in the unborn-HEAD branch and the normal branch. Shape: one computed
`toolbarBindings` (`v-bind` + `v-on` object), or restructure so the toolbar renders once above
the `v-else-if` chain.

### I2-40 `shared/protocol` page decoders and builders (medium confidence)

`packages/shared/protocol/frame.ts` `decodeDocumentPage` 205-221, `decodeKeyValuePage` 223-242,
`decodeStreamPage` 244-267 (0.92-1.00); `page.ts` `createDocumentPageBuilder` 419-449,
`createKeyValuePageBuilder` 457-499, `createStreamPageBuilder` 513-562 (0.73-0.76). Each is a
column-name list plus the `position`/`rowCount`/`byteSize`/`fetchedAt` frame. Shape:
`decodeColumns(wire, names)` + per-kind extras, `createColumnarBuilder(columns, { maxBytes,
extras })`. Land only if the typed result is not weakened (no `Record<string, Chunk>` leaking
into `Page`); otherwise decline in the commit with that reason.

### I2-41 `sql-keywords.spec.ts` copies the list it tests

`Studio/tests/unit/sql-keywords.spec.ts:14-77` == `packages/shared/domain/sql-keywords.ts:25-92`
(S5 64 lines): `REQUIRED_MINIMUM` duplicated into the test, which then asserts the module
contains its own copy. Shape: export `REQUIRED_MINIMUM` (or derive it from `ddl.ts`/`sqlRefs.ts`
constants) and assert the keyword set is a superset; delete the copy.

### I2-42 `tests/ui/fixtures.ts` cross-app

`Space/tests/ui/fixtures.ts:20-65` == `Studio/tests/ui/fixtures.ts:23-70` (S5 26 lines):
`RelaunchOptions`, fixture types, `uiServer` worker fixture, `consoleErrors`, the `relaunch`
launcher. Studio adds the `stream` fixture. Shape: `packages/workbench/src/testing/ui/fixtures.ts`
`createUiFixtures({ distDir, installMocks, extraFixtures? })`; each app's file is its mock
installer plus the call (T2-22 moved `mockRuntime`/`server`, not the fixture).

## 3. Declines and out of scope

Each with the requirement that keeps it separate.

- P105 in-flight areas: disabled-tooltip wrapper, column/pane resize handle (§0). Excluded, not
  declined — a concurrent pass owns them.
- `git-core` vs `git-ipc` structural copies (`model/operation.ts:153-300` / `contract.ts:731-878`,
  `diff.ts`, `remote.ts`, `preflight/types.ts`, `commit.ts`, `stash.ts`, `status.ts`): B3 forbids
  the import; `wireConformance.test.ts` guards drift.
- Discriminated-union JSON codecs ×3 (`model/cursor.go` `PageCursor` 18-71, `queries.go`
  `SortSpec` 26-79, `mutations.go` `MutationRowOp`): same probe/switch pattern, but arm fields,
  validation and error strings all differ; a generic would exceed the three bodies.
- `adapterhost/data.go` `Read` vs `Count` cache halves: key, store and response shape differ;
  only the prologue dedupes (I2-10).
- `config/paths.go`, `config/env.go`, `appshell/dialogs.go` cross-app: already one-line delegates
  to repo-root packages.
- Bound Wails service struct types cross-app: P103 §2.3 (binding generation, `@bindings/*`
  paths). Bodies dedupe (I2-5, I2-6); types stay.
- `queryplan/mysql.go` vs `mariadb.go` (0.76), `planParsers/mysql.ts` vs `mariadb.ts` (0.81):
  iteration 1's decline stands — real column-set differences.
- `PF/views/repo/useDiffEditor.ts` `mount` vs `useDiffEditor` (0.74): nested function inside its
  enclosing one; S6 self-overlap, not duplication.
- `Space/internal/gitclient/repo.go` `Read` vs `Write` (0.75): mirrored I/O; one shape would hide
  direction.
- `A/kafka/caps.go` vs `A/sqs/caps.go` (S5 17 lines): overlapping `false` fields, different
  capability sets; the relational four (I2-37) are the byte-identical ones.
- `A/mysqlfamily/query.go` vs `A/postgres/query.go` `runArrayQuery`/`streamArrayQuery`/
  `runCommand`: `database/sql` vs `pgx` row APIs differ in every call; T2-1's `sqltext.go` took
  what was shareable.
- `Studio/internal/storage/repos/repos.go` `New` vs Space's (S6 1.00 on the prepare pattern):
  three `db.Prepare` + error each; a helper would be the same length.
- `git-ui` `WorktreeList.vue` `blockerText` vs `StackDialog` (0.94): re-checked, iteration 1's
  decline stands — different blocker enums.
- Generated FlatBuffers and cross-language mirrors, as iteration 1.

## 4. Implementation order

Sequential, one Sonnet subagent, commit per finding (`refactor:` / `test:`), fast checks per
commit, full suites once at the end (`test:go`, `test:unit`, `test:ui:studio`, `test:ui:space`,
vscode tests, adapter conformance suites for I2-11, I2-12, I2-37).

1. Go base helpers: I2-4, I2-29, I2-30, I2-31, I2-32, I2-33, I2-34, I2-35, I2-36.
2. Adapters: I2-37, I2-11, I2-12, I2-10.
3. Cross-app storage and shell: I2-1, I2-2, I2-3, I2-5, I2-6, I2-7.
4. Studio Go: I2-8, I2-9. Space Go: I2-13.
5. Studio frontend: I2-14, I2-15, I2-16, I2-17, I2-38. Cross-app: I2-18 (after P105 merges, or
   around its wrapper), I2-19. Space: I2-20 (settle the reuse-branch question first).
6. Git packages and vscode: I2-21, I2-22, I2-23, I2-24, I2-39, I2-40.
7. Tests: I2-41, I2-42, I2-25, I2-26, I2-27, I2-28.

Closing check: re-run S1 and S6 (`sweep.ts` method in §0) and require every remaining S1 exact
group and every production S6 pair ≥0.85 to be one §3 decline by name.

## 5. Closing-sweep addendum (post-merge, `f3a5d1a8`)

Found by the I2-18/I2-21 deferred implementation pass's own closing S1/S6 re-sweep against the
merged tree (both streams + deferred findings landed). Every other S1/S6 hit from that re-sweep
mapped to an existing finding or §3 decline; these five didn't and were left unfixed at the time,
flagged for this follow-up pass. Re-verify exact locations against current source before touching
(function/file names given, not line numbers — the sweep's own output didn't carry them).

- **I2-43** `apps/kira-studio/frontend/src/state/tabs.ts`: `openDataTab`/`openDocumentTab`/
  `openKeyValueTab`/`openStreamTab` (S6, Jaccard 1.00, ~15 lines each) — differ only in the
  tab-kind string and its default-state factory. Shape: one `openTab(kind, defaultStateFactory)`
  helper, four one-line callers.
- **I2-44** `apps/kira-studio/internal/dbmcp/tools.go`: `listChildren`/`describeTable`/
  `describeSchema` (S6, 0.94-1.00). Shape: extract the shared body into one helper parameterized
  on what differs; keep each exported wrapper thin.
- **I2-45** `apps/kira-studio/internal/page/builder.go`: `Finish` ×3 (S6, 0.91-1.00). Shape: same
  approach — one shared body, thin per-variant wrappers.
- **I2-46** `apps/kira-space/internal/gitops/conflict.go`: `ContinueArgs`/`AbortArgs`/`SkipArgs`
  (S6, 1.00). Shape: one shared constructor/builder parameterized on the one thing that differs
  per variant.
- **I2-47** `apps/kira-space/internal/gitsession/conn.go`: `WalkFor`/`ReviewWalkFor`/
  `alreadyHeld` (S6, 0.88-1.00). Shape: same approach; re-check `alreadyHeld`'s exact overlap with
  the other two before merging — it scored lowest (0.88), confirm it's real duplication and not
  S6 noise before extracting.

Implementation: one sequential Sonnet subagent, commit per finding, fast checks per commit
(`go build`, `golangci-lint`, `typecheck`, `lint:dead`). All five are non-overlapping files across
two apps' Go and one app's frontend, so no parallel split needed at this size. Full suites once at
the end: `test:go`, `test:unit`, `test:ui:studio`, `test:ui:space`. This addendum, once
implemented, closes P107 iteration 2 in full — no further closing-sweep pass is required unless a
future iteration 3 is opened.
