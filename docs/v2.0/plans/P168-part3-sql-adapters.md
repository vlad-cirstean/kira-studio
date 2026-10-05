# P168 Part 3: review plan, Studio DB adapters I (adapter core and SQL engines)

Chunk A2, Stream A position 2 of 12, phase 1 (pre-plan `P168-prep-plan.md` §5.2). One Opus
reviewer runs this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `e6691b2` (`p168-stream-a`, Part 2 fixed and its findings file dropped).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`, `SF` =
`apps/kira-studio/frontend/src`. Line numbers are as of `e6691b2`; re-read before citing.

SPEC row names this file `P168-part3-adapters-sql.md`; the orchestrator named it
`P168-part3-sql-adapters.md`. Same plan, this name wins.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamA` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index: run
  `sh scripts/codegraph-setup.sh` in the worktree if `.codegraph/` is missing. Seeds:
  `QueryTracker` `TrackerFor`/`Snapshot`/`PopRunning`/`Drain`; `RunWithAbortRace`;
  `relational.Disconnect`; `ConnSet` `Get`/`CloseAll`/`detachLRULocked`; each engine's
  `Connect`/`Disconnect`/`Cancel`/`trackerFor`/`requireClient`/`requireEntry`; sqlite `runOnConn`,
  `buildDSN`; clickhouse `buildURL`/`doRequest`/`escapeParamValue`/`StreamQuery`;
  `ClassifySQL`, `StripSQLComments`, `AssertNoHiddenStatement`, `AssertNoTransactionEscalation`,
  `quoteHasBackslash`, `endsTransaction`; `RunSQLMutation`, `RunRelationalMutate`,
  `CompileMutationOps`; `PlanRelationalPage`, `KeysetPageCollector`, `ComputeEffectiveOrder`,
  `ValidateRequestedTerms`, `BuildScanOrderBy`; `adapterhost` `Host.CancelOp`,
  `Router.Connect`/`Disconnect`, `Dispatcher.Execute`; `main.go` `wireAdapters`.
- **CodeGraph over-links names.** Same-named methods across the ten adapters and Space's
  `ade.Tracker`/`keepawake.Release` showed up in `Tracker`/`Release` queries. Confirm every
  cross-package claim with `git grep` of import lines. Go's `internal/` rule makes those
  authoritative.
- **Driver source in the module cache** where a claim turns on driver behavior:
  `jackc/pgx/v5@v5.11.0` (simple protocol, `pgconn` cancel and config-error redaction),
  `go-sql-driver/mysql@v1.10.1` (`InterpolateParams`, `MultiStatements=false`,
  `ClientFoundRows`, `Timeout`), `modernc.org/sqlite@v1.58.0` (DSN keys `_busy_timeout`,
  `_foreign_keys`, `_txlock`, `_query_only`, `mode`; `interruptOnDone`), ClickHouse over plain
  `net/http`.
- **Scratch probes** in the session scratchpad or a throwaway `_test.go` deleted before the
  findings commit, never committed, where a claim turns on runtime behavior (scanner output on a
  crafted statement, `url.Values` encoding, `sync.WaitGroup` reuse).
- **Checks:** `go vet ./apps/kira-studio/internal/adapters/...` (clean at `e6691b2`) and
  `go test -race ./apps/kira-studio/internal/adapters/...`. Docker is installed but its daemon is
  down here; container suites skip (`testsupport.DockerUnavailableMessage`). Optional: start it
  (`docs/DEV_ENVIRONMENT.md` Docker section: `dockerd`, `mirror.gcr.io` pulls) to run the real
  postgres/mysql/mariadb/clickhouse suites. sqlite suites run without Docker. The permutation
  matrix stays gated (`KIRA_TEST_MATRIX=1`, `scripts/test-matrix.sh`); not required. If missing
  deps or bindings fail a check: `bun install --frozen-lockfile` and `bun run setup` (or
  `scripts/prepare-worktree.sh`). A red check is a finding.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `e6691b2`. **Part 3: no drift.** 138 files, 26,401 code lines,
8,115 test lines, same as `f40cd35`.

Drift elsewhere, all from fixes since `f40cd35`, none touching a Part 3 file:
- Part 2: 145 to 148 files, 19,684 to 20,159 lines (tests 7,872 to 8,088). Part 2 fixes:
  migration `0030`, `model/textlen.go` + test.
- Part 8: 16,274 to 16,328 lines (`internal/sqlitex/reindex.go`, Part 2's reorder fix).
- Part 16: 18,789 to 18,792; Part 20: 20,140 to 20,207 (P166/P167 fixes, Stream B files).
- Totals: streams A 254,613, B 182,164; 2,871 owned, 0 orphans, 3,499 tracked (docs 475).

`v2.0` tip is `ec9ed18`, 9 commits past this branch's merge base `8a98250` (P167 fixes). None
touch a Part 3 file (`git diff --name-only 8a98250 v2.0` has no `SI/adapters` or Part 3 script
path). The rebase before landing is therefore conflict-free for this chunk.

P166-scope churn in Part 3: 0 lines (pre-plan §4). Review the whole chunk, not a diff.

## 2. Own file set (138 files)

85 production `.go` (15,084 lines), 34 `_test.go` (8,115), 19 scripts (3,202 counted, plus
`docker-compose.yml`). Production lines per package:

- **`SA` core** (3,111; 21 files): `abort, adapter, caps, classify, connset, errors, format,
  guarded, live, registry, relationalpage, rowops, sqlmutate, sqltext, sslmode, tracker, tree`.
  New since P108: `guarded.go` (P113 G1 `Guarded[T]`), `sslmode.go` (P115 `ParseSSLMode`).
  Largest: `sqltext.go` 746, `errors.go` 560 (SQL scanner and read-only guards), `sqlmutate.go`
  364, `connset.go` 220, `adapter.go` 209, `classify.go` 201.
- **`SA/relational`** (51): `connstate.go` (`ConnState[S]`, shared `Disconnect`). New since P108.
- **`SA/postgres`** (2,317): `adapter, caps, catalog, client, console, definition, errors,
  mutate, query, read`.
- **`SA/mysqlfamily`** (2,140): `adapter, catalog, client, console, definition, errors, mutate,
  profile, query, read`. **`SA/mysql`** (41), **`SA/mariadb`** (38): `adapter, caps, client`.
- **`SA/sqlite`** (2,185): `adapter, caps, catalog, client, console, definition, errors, mutate,
  query, read`.
- **`SA/clickhouse`** (2,016): `adapter, caps, catalog, client, console, definition, errors,
  mutate, query, read`.
- **`SA/testsupport`** (3,185; 24 files): per-engine container starters (`postgres, mysql,
  mariadb, mysqlfamily, mysqlfamily_seed, clickhouse, sqlite, mongo, redis, kafka, kafka_sasl,
  localstack, s3, sqs`), `fixture, images, matrix, prewarm, scenarios, seed, spec`; tests
  `images_test, kafka_test, localstack_test`. Shared with Part 4's suites and `ipcfixture`.
- **Conformance and unit tests** (34): core `abort, classify, connset, errors, sqlmutate,
  sqltext`; per engine `*_test.go`, `authmatrix_test.go`, `*_internal_test.go`,
  `connset_wiring_test.go`, sqlite `query_bench_test.go`.
- **Scripts:** `scripts/demo-dbs/{docker-compose.yml,seed.sh}`, per-engine `init`/`seed`
  (`clickhouse, mariadb, mysql, postgres` `.sql`; `mongo` `.js`; `kafka, s3, sqs` `.sh`; `redis`
  `.lua`; `sqlite/seed.ts`), `scripts/db-compat.sh`, `scripts/test-matrix.sh`.
  `demo-dbs/README.md` is excluded (docs).

## 3. One hop: callers (git grep of import lines, production files)

- **`SA` core, outside the chunk.** Symbols each file uses:
  - `adapterhost/router.go`: `Adapter, CreateAdapter, GetLiveAdapter, SetLiveAdapter,
    DeleteLiveAdapterIf, ConnectInfo, Deps, OpCtx, OpClass, ClassUnknown, StatementClassifier,
    TreeChildren`. `Router.Disconnect` runs `CancelOpsForConnection` then
    `takeLiveAdapterForTeardown` then `adapter.Disconnect`, bounded by `disconnectAdapter`.
  - `adapterhost/host.go`: `GetLiveAdapter`, `NewOpCtx`, `Error`/codes. `CancelOp` cancels the
    local op context first, then `adapter.Cancel(ctx, opID)`.
  - `adapterhost/{data,dataframe,op}.go`: `Adapter, ReadRequest, CountRequest, CountResult,
    GetLiveAdapter, New, Code*`. `Dispatcher.Execute` passes `req.Statements` to
    `adapter.Execute`.
  - `dbmcp/{tools,permissions,approval,explain,server,access,render}.go`: `OpClass`,
    `Class{Read,Write,DDL,Unknown}`, `StatementClassifier`, `Caps`, `CodeOf`, `Error`.
    `run_query` classifies through `Router.ClassifyStatement`; the classifier is a security gate.
  - `tree/service.go`: `TreeChildren`. `ipcfixture/harness.go`, `main.go`: `Deps`.
  - `bridge/{grpc,http}.go`: `OpCtx`, `ErrorCode` only (no adapter call).
- **Engine packages.** `main.go` blank-imports all ten for `init()` `Register`.
  `mysqlfamily` is imported by `mysql` and `mariadb` only. `relational` by `postgres` and
  `mysqlfamily` only. `testsupport` by tests only (every engine's suites in Parts 3-4, six
  `ipcfixture/*_test.go`).
- **Part 4's engines** (`mongo, redis, kafka, sqs, s3, awscfg`) use the core heavily: `NewOpCtx`,
  `New`, codes, `CodeOf`, `TreeChildren`, `ReadRequest`, `CountResult`, `Unsupported`,
  `CheckCancelled`, `RunWithAbortRace`, `Guarded`, `RequireConnected`, `EncodePageToken`/
  `DecodePageToken`, `RunKindDispatched`, `ConnSet`/`NewConnSet` (redis), `QueryTracker`
  (mongo), `ParseSSLMode`/`SkipsVerification`, `ClassifyNetError`, `DispatchUpdateDeleteInsert`.
  A core signature or semantic change must keep them building and correct (pre-plan §3.3: same
  stream, editable).
- **Drift from the pre-plan's caller list:** `connections` imports nothing from `SA`; it reaches
  adapters only through `connections.Backend` (`adapterhost.Router`). It still matters (§5.1:
  Part 2's new `abortInFlight` waits on `Backend.Connect`). `bridge` reaches `SA` only for
  `OpCtx`/`ErrorCode`.
- **Frontend, read only for mirrors and reachability:** `packages/shared/caps.ts` (Part 13) is
  the TS mirror of `SA/caps.go` (field order mirrored by comment; no parity test found by
  `git grep`). `SF` console plan parsers read engine EXPLAIN output (Part 12).

## 4. One hop: callees

- `SI/storage/model` (Part 2, closed): `ResolvedConnectionConfig`, `NodePath`, `MutationPlan`,
  `MutationRowOp`, `SortSpec`, `PageCursor`, `ConsoleRequest`, `ColumnMeta`, `ObjectMeta`,
  `ObjectDefinition`. Imported by 74 own production files.
- `SI/page` (Part 5, later; 39 own files): `TabularPageBuilder`, `ColumnDescriptor`, `TypeClass`,
  `PageKind`, `UnpagedPosition`, keyset position. `page/wire` is generated, excluded.
- **`internal/jsonx`: drift.** No Part 3 file imports it at `e6691b2`; only `SA/redis/read.go`
  (Part 4). Drop it from this chunk's callees.
- `scripts/lib.sh` (Part 8): sourced by `test-matrix.sh` and `db-compat.sh`.
- Drivers (`go.mod`): `pgx/v5 v5.11.0`, `go-sql-driver/mysql v1.10.1`, `modernc.org/sqlite
  v1.58.0`, ClickHouse over `net/http`, `testcontainers-go v0.44.0` (+ postgres, mysql, mariadb,
  clickhouse, kafka modules).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk turns
user and agent text into SQL and enforces read-only.

### 5.1 Lifecycle, cancellation and `QueryTracker`

- `QueryTracker.Drain` bounded by ctx: when ctx wins, `relational.Disconnect` proceeds to
  `CloseAll` while a goroutine still holds a pinned conn. postgres/mysqlfamily `Close` take
  `e.mu`, held for the whole op. Decide whether `CloseAll` then blocks unbounded, or closes under
  a live op.
- `TrackerFor` while `draining` returns a no-op release: the op still runs, untracked (no
  `Snapshot`/`Cancel`, not waited by `Drain`). Check what such an op touches after close.
- Drain's goroutine resets `draining=false` and `runningByOp=nil` only after `Wait`. A reconnect
  on the same adapter instance before that: does `Router.Connect` reuse the instance or create a
  new one (`CreateAdapter`)?
- **sqlite has its own tracker** (`runningByOp`, `inFlight`), with no `draining` guard.
  `Disconnect` returning on ctx timeout leaves `state.db` set until the close goroutine runs, so a
  new `runOnConn` can `inFlight.Add(1)` concurrently with `inFlight.Wait()` (`sync.WaitGroup`
  misuse) and run on a DB about to close.
- Multi-statement release identity (`runningByOp[opID] == q`) for console "Run all" and mutate;
  `PopRunning` in `Cancel` then a later statement of the same op registering after the pop.
- `Cancel` side paths: mysqlfamily `KILL QUERY <thread id>` on a fresh side connection (thread id
  reused after the query ended, side connection built from `Cfg` incl. TLS), postgres
  `pg_cancel_backend`, clickhouse `KILL QUERY WHERE query_id = {qid:String} SYNC` (`SYNC` wait
  bound), sqlite `driverCtx` cancel. Each must report false, never error, for an unknown op.
- clickhouse `Disconnect` only calls `CloseIdleConnections`: an in-flight streaming response
  keeps its socket. Confirm `Snapshot`-then-`Cancel` covers it.
- `RunWithAbortRace` returns on `ctx.Done()` while the goroutine still owns the conn: the op's
  cleanup (`ROLLBACK`/`COMMIT` on a detached ctx with `endTransactionTimeout` 5 s), the next
  queued op after the entry lock frees, eviction `Close`.
- **Part 2 change to weigh against:** `connections.Service.abortInFlight` now waits on the
  in-flight attempt's `done` with no bound, for Disconnect, Remove and Update. Every engine's
  `Connect` must return promptly on ctx cancel. sqlite `Connect` takes `_ context.Context`;
  postgres/mysql dial with `connectTimeout` 10 s; check clickhouse's probe request ctx.
- `ConnSet`: single-flight dial, LRU eviction never evicts Primary, dial completing after
  `CloseAll` (`closed` flag), `Max` counting in-flight dials, per-database connection leak on
  dial error.

### 5.2 SQL injection surface and read-only enforcement

- `ClassifySQL` raw-text `;` guard (P108 F1) and its interaction with `dbmcp` `run_query` and
  `explain`. Leading-keyword cases: `WITH` data-modifying CTE, `SELECT … INTO`, `EXPLAIN ANALYZE`
  (executes), `COPY … TO PROGRAM`, `CALL`, `DO`, `SET`, `PRAGMA` writes, `ATTACH`, ClickHouse
  `SYSTEM`/`OPTIMIZE`/`INSERT … SELECT`, MySQL `HANDLER`/`LOAD DATA`/`DO`.
- `StripSQLComments` and `AssertNoHiddenStatement`: nested block comments (Postgres nests, MySQL
  does not), MySQL executable comments `/*!` / `/*M!` (body runs), `#` line comments in MySQL
  (not handled by `startsLineComment`), dollar quotes with tags, `E'…'` backslash strings,
  `quoteHasBackslash` false negatives.
- Per-engine read-only: postgres session default plus `BEGIN READ ONLY` wrap plus
  `AssertNoTransactionEscalation`; mysqlfamily `START TRANSACTION READ ONLY`; sqlite `mode=ro` +
  `_query_only=1`; clickhouse `readonly=2` per request (never on `KILL QUERY`). Check every
  write path (`Mutate`, `Execute`, DDL, catalog side queries) checks `AssertWritable` or the
  engine guard, and the wrap's cleanup on failure leaves no open transaction on a pinned conn.
- Identifier quoting: `QuoteIdentDouble` (NUL panics, recovered upstream), `QuoteIdentBacktick`,
  ClickHouse identifier quoting, `escapeParamValue` (backslash only; check quotes and `\0`).
  Catalog SQL that concatenates names instead of binding.
- Filter and order-by: raw filter fragments by design versus closed sets.
  `ValidateRequestedTerms` rejects non-lowercase directions; check every engine's read path calls
  it, and whether text sort (`SortSpec.Kind == "text"`) or a trailing `--` in a filter can break
  out of `WHERE (…)`.
- sqlite `buildDSN`: `"file:" + path + "?" + q.Encode()` with no path escaping. A path holding
  `?`, `#` or `%` changes DSN keys (could drop `mode=ro`).
- ClickHouse credentials go in `X-ClickHouse-User`/`X-ClickHouse-Key` headers; confirm no URL,
  log line or error message carries them (`mapTransportError` echoes `url.Error`).

### 5.3 Pagination, cursors and type mapping

- Keyset boundary arithmetic: `KeysetPageCollector.Track` probe row, `before` reversal and edge
  swap, NULLs in keyset columns (sqlite legacy nullable PKs, rowid tiebreaker), duplicate keys
  without a unique tiebreaker, `AssertKeysetSupported` fallback to offset, page token decode of a
  token from another table (`RequestFingerprint`).
- Wire/type mapping per engine: pg `numeric`, `money`, arrays, `interval`, `bytea`, time zones,
  `inet`, enum, domain, composite; MySQL `BIT`, `DECIMAL`, unsigned `BIGINT` past 2^63, zero
  dates, `JSON`, binary collations; sqlite dynamic typing and type affinity; ClickHouse
  `Nullable`, `LowCardinality`, `UInt64`/`Int128`/`UInt256`, `Decimal256`, `DateTime64`
  precision and tz, `Map`, `Tuple`, `Array`. `TypeClassFor` per engine against `page.TypeClass`.
- Edit-path coercion: display text versus bound value, `0x<hex>` binary convention against each
  dialect, keyset token values as strings against typed columns, `AssertAffectedExactlyOne`
  with `ClientFoundRows` (MySQL) and PK-less tables.
- Large values: clickhouse `maxCellBytes` and the scanner buffer, per-cell truncation in the
  other engines, rows wider than the page budget, `Count` overflow and `AbbreviateCount`.

### 5.4 Transactions, DDL and definitions

- `RunSQLMutation`: rollback on every early return, including a failed `COMMIT`; it passes
  `ctx` to `rollback`, each engine must detach it.
- `Definition`/DDL generation per engine (`definition.go`, `catalog.go`): quoting of every
  emitted identifier, defaults and check expressions, partial and expression indexes, generated
  columns, views versus tables, objects in a non-default schema, `temp`/attached sqlite schemas
  via `pragma_*`.
- Permission-limited users: catalog queries a least-privilege user cannot run (pg
  `pg_catalog` vs `information_schema`, MySQL `PROCESS`, ClickHouse `system.*`), and whether
  each failure degrades or fails the whole tree/describe.
- Timeouts: pg `statement_timeout=0` and the Stop contract, sqlite `_busy_timeout` 5000 versus
  `_txlock=immediate`, clickhouse dial/TLS bounds only (no request timeout by design), mysql
  `Timeout` (dial) versus read/write timeouts.

### 5.5 Errors, caps and registry

- Driver error text into `Error.Message` and `ConnectInfo.Details`: pgx `ParseConfigError`,
  MySQL DSN errors, `url.Error` from clickhouse. Must not re-leak what Part 2 locked down.
- Every `Caps()` false matches an `Unsupported` return no caller reaches. `caps.go` against
  `shared/caps.ts` field set and JSON names (`MaxPageSize` pointer, `omitempty`).
- `Register`/`CreateAdapter` duplicate kinds, `live.go` map races (`SetLiveAdapter`,
  `DeleteLiveAdapterIf`).
- `ParseSSLMode` vocabulary per engine; `verify-ca`/`verify-full` hostname handling in pg and
  mysqlfamily TLS registry name collisions across connections.

### 5.6 Test support and scripts

- Conformance suites are **exempt** from the unit-test bar (`CLAUDE.md`). Keep per-capability
  coverage; report only true duplicates or a suite that no longer guards what its name says.
  Missing capability coverage for a new core helper (`Guarded`, `ParseSSLMode`,
  `relational.Disconnect`) is a valid finding.
- `testsupport`: pinned images (`images.go`) against `test-matrix.sh`/`db-compat.sh` and
  `KIRA_COMPAT_IMAGE_<KIND>`; container cleanup on test failure (leaked containers);
  `matrix.go` env set/restore (`LookupEnv` path); seed idempotence.
- `scripts/demo-dbs`: published ports bound to `0.0.0.0` versus `127.0.0.1`, default passwords,
  seed scripts' quoting, `seed.sh` error handling (`set -eu`), `sqlite/seed.ts` path handling.
- `db-compat.sh`, `test-matrix.sh`: argument parsing, `--only` validation, exit status when a
  row fails, POSIX `sh` portability.

## 6. What Part 2 already changed (do not re-report)

Part 2 fixes landed on this branch (`dd8f971`..`c7cc630`). None edits a Part 3 file.
- Migration `0030_p168_fk_indexes.sql` (FK child indexes) and `sqlitex.reindex` dense reorder.
- One UTF-16 length rule: `model.UTF16Len`/`TruncateUTF16` (`model/textlen.go`) for connection
  names, saved query names, sort text and the DataGrip name cap. Sort text now counts in UTF-16
  units at the model layer; an adapter-side re-check is not a new finding unless the adapter
  disagrees.
- `connections`: URI `password` query param moves to the encrypted secret; `sslpassword`,
  `tlsCertificateKeyFilePassword`, `proxyPassword` are refused by `Validate`. Disconnect, Remove
  and Update abort and wait out an in-flight Connect; Update during connect reconnects; state
  store and emit are one step.
- `preconnect`: one-shot classified by real exit, leftover process group reaped.
- `localauth`: prompts serialised, grace expires across sleep.
- `storage`: byte caps cut on a rune boundary; `Reorder` validates ids.

Adapter-side consequences of these (§5.1 Connect ctx promptness) are in scope; the Part 2 code
itself is not.

## 7. Watch items and known coverage

- Pre-plan §5.2 watch: `QueryTracker` (`Drain` on `Disconnect`, multi-statement release, cancel
  races); `Caps()` false versus `Unsupported`; conformance exemption. Folded into §5.1, §5.5,
  §5.6.
- **P166/P167.** `docs/v2.0/plans/P166-code-review.md` is gone from both branches.
  `P167-code-review.md` is still on this branch but deleted on `v2.0` (fixed); neither names a
  Part 3 file. Before starting, check `docs/v2.0/plans/P16{6,7}-code-review.md` on `v2.0`: any
  finding still listed there on a Part 3 file is skipped.
- P108 Part 4's fixes are in code (classifier raw `;` guard F1, tracker `draining` F3,
  cancel-before-drain F4, ClickHouse dial/TLS bounds F5, `escapeParamValue`,
  `ValidateRequestedTerms`). P113 G1 (`Guarded`, `relational`) and P115 (`sslmode.go`) followed.
  Verify they hold; do not re-report them as new.

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this order** (callees first, so each engine reads against a known
  core). About 15k production lines plus 8k test lines plus 3k script lines: one agent pass
  covers it if test files are read only where they are the sole guard of a claim.
  1. Core: `errors.go` scanner and guards, `classify.go`, `sqltext.go`, `sqlmutate.go`,
     `relationalpage.go`, `tracker.go`, `abort.go`, `connset.go`, `guarded.go`, then the rest
     of `SA/*.go`, `relational/connstate.go`.
  2. postgres. 3. mysqlfamily, then mysql and mariadb. 4. sqlite. 5. clickhouse.
  6. `testsupport`. 7. Scripts.
  8. Conformance and unit tests: confirm per-capability coverage and the guard claims cited.
- **Resumable:** write `docs/v2.0/plans/P168-part3-findings.md` as blocks finish, and commit it
  after steps 1, 5 and 8 (`docs(v2.0): P168 Part 3 findings, <blocks>`). An interrupted run
  resumes from the last committed block, never re-derives one.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario, and a proposed fix. Mark a finding that needs a real design
  decision; the fixer turns it into its own `SPEC.md` phase.
- The findings file states base commit, HEAD reviewed, checks run and results, findings, then
  coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk
  with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 3 findings`, normal commit, hooks green, explicit
  `git add <path>`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 3`, under
  pre-plan §3.3 edit scope (Part 4 engines and Part 5/13 callers editable, same stream). A core
  change re-runs `go build ./apps/kira-studio/...` and `go test -race` over `SA/...`,
  `adapterhost`, `dbmcp`. It deletes the findings file when done. Chunk lands per pre-plan §3.4
  before Part 4's plan starts.

## 9. Out of scope

- Part 4 engines' own logic (`mongo, redis, kafka, sqs, s3, awscfg`); only their use of a core
  symbol whose contract this review changes.
- `adapterhost`, `enginecache`, `page`, `tree`, `ipcfixture` internals (Part 5) and `dbmcp`
  policy (Part 6), beyond the contract each relies on from this chunk.
- `storage/model` validation (Part 2, closed), `queryplan` (Part 6), console plan parsers
  (Part 12), `shared/caps.ts` (Part 13; a mirror fix lands under §3.3 in Stream A).
- Root `internal/*` and `scripts/lib.sh` (Part 8): record only as a callee note when it breaks a
  Part 3 contract.
- Generated code, docs, excluded files (pre-plan §6).
