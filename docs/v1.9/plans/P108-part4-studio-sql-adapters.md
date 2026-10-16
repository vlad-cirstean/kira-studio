# P108 Part 4 — review plan: Studio DB adapters I (adapter core and SQL engines)

Chunk A3, stream A position 3 (pre-plan §5.3). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands one commit per finding. Tree surveyed:
`31c312f`.

Paths are repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`.

## 0. Method

- **`codegraph_explore`** for discovery: the adapter contract and registry against
  `main.go` `wireAdapters` and `adapterhost.Router` (`CreateAdapter`, `Connect`, `Disconnect`,
  `QueryTracker.Drain`); the cancel path `bridge/ops.go` `Cancel` to `Router.Cancel` to
  `Host.CancelOp` to `GetLiveAdapter` to each adapter's `Cancel`; the console path
  `Dispatcher.Execute` and `dbmcp` `run_query` into `ClassifyStatement`/`Execute`.
- **Driver source read in the module cache** where a claim depends on driver behavior:
  `modernc.org/sqlite@v1.58.0` DSN keys, `pgx/v5@v5.11.0` `pgconn` config errors and busy-conn
  locking, `go-sql-driver/mysql@v1.10.1` flags (`InterpolateParams`, `MultiStatements`,
  `ClientFoundRows`).
- **Throwaway probe tests** in the package dir, deleted after the run, never committed, where a
  claim depends on runtime behavior of the shared SQL scanner (`StripSQLComments`, `ClassifySQL`,
  `AssertNoTransactionEscalation`).
- **`go test -race`** over every own package. Real-container suites skip without Docker; the
  unit-level half must pass.

## 1. Own file set

Production files. `_test.go` files are read only where they are the package's own guard.

- **`SA` core** (15): `adapter.go`, `registry.go`, `caps.go`, `tracker.go`, `errors.go`,
  `classify.go`, `live.go`, `connset.go`, `rowops.go`, `sqlmutate.go`, `sqltext.go`,
  `relationalpage.go`, `format.go`, `tree.go`, `abort.go`.
- **`SA/postgres`**: `adapter,caps,catalog,client,console,definition,errors,mutate,query,read`.
- **`SA/mysqlfamily`**: `adapter,catalog,client,console,definition,errors,mutate,profile,query,read`.
- **`SA/mysql`**, **`SA/mariadb`**: `adapter,caps,client` (profile plus caps literal only).
- **`SA/sqlite`**: `adapter,caps,catalog,client,console,definition,errors,mutate,query,read`.
- **`SA/clickhouse`**: `adapter,caps,catalog,client,console,definition,errors,mutate,query,read`.
- **`SA/testsupport`**: 23 files (container starters, `matrix.go`, `scenarios.go`, `spec.go`).
- **Scripts**: `scripts/demo-dbs/**` (`docker-compose.yml`, `seed.sh`, per-engine init/seed),
  `scripts/db-compat.sh`, `scripts/test-matrix.sh`.

About 12.3k production lines plus the conformance suites; matches pre-plan §4's ~23k.

## 2. One hop: callers

- **`adapterhost`** (Part 6, not settled; read only): `Router.Connect` (reconnect path calls
  `existing.Disconnect` outside `RunOp`), `Router.Test`, `Router.Disconnect` (inside `RunOp`, no
  serialization with other ops on the same adapter), `Router.Cancel` to `Host.CancelOp` (local
  `cancel()` first, then `adapter.Cancel`), `Dispatcher.Execute/Read/Count/Mutate`.
- **`dbmcp`** (Part 3 settled): `tools.go` `run_query` classifies `args.SQL` whole through
  `Router.ClassifyStatement` then executes it as one statement; `explain.go`
  `assertComposedStatementsAreReads`.
- **`connections.Service`** (Part 3 settled): `Disconnect` calls `Backend.Disconnect`
  synchronously; `onPreconnectExit` in a goroutine.
- **`tree`**, **`SI/bridge`** (schema, stream), **`ipcfixture`**, `main.go` `wireAdapters`
  (`adapters.Deps.Log` into `slog`).
- **Part 5's engines** consume the core only: `RunRowOps`, `RunKindDispatched`, `ConnSet`,
  `ClassifyNetError`, `RequireConnected`. A core fix must keep them building.

## 3. One hop: callees

- `SI/storage/model` (Part 3 settled): `ResolvedConnectionConfig`, `NodePath`, `MutationPlan`,
  `SortSpec` (note: `SortTerm.Direction` is not validated in its decoder), `PageCursor`.
- `SI/page` builders (Part 6): `TabularPageBuilder`, `UnpagedPosition`.
- `internal/jsonx` (Part 2 settled).
- Drivers: pgx v5 (simple protocol on read/console), go-sql-driver/mysql (text protocol,
  `MultiStatements=false`), modernc.org/sqlite (per-op `*sql.Conn` from a 1-conn pool),
  plain `net/http` for ClickHouse.

## 4. Edge cases to weight

Security first: this chunk turns user and agent text into SQL.

- **Statement smuggling past the classifier and the read-only guard.** `StripSQLComments` is
  quote-aware but treats backslash as ordinary. Probe every dialect whose strings honor backslash
  (Postgres `E'…'` and `standard_conforming_strings=off`, MySQL/MariaDB default, ClickHouse) for a
  span where the scanner leaves a string early and then strips a real `;` as a `--` comment.
  Check which drivers actually run a second statement (pgx simple protocol does; mysql
  `MultiStatements=false` and ClickHouse HTTP do not; sqlite has its own guard).
- **Identifier quoting.** `QuoteIdentDouble`/`QuoteIdentBacktick`, ClickHouse's
  backslash-aware backtick quoting, `param_` escaping, catalog SQL that should bind or
  server-quote (`format('%I')`) rather than concatenate.
- **Raw SQL fragments by design** (filter, text sort) versus fragments that should be closed
  sets (`SortTerm.Direction`). A trailing `--` comment in a filter against `WHERE (…)`.
- **Type coercion on the edit path.** Display text versus bound value: the `0x<hex>` binary
  convention against each dialect's type classifier (MySQL `BIT`, SQLite dynamic typing),
  keyset token values as strings against typed columns, NULL in keyset columns (SQLite legacy
  nullable PKs), count parsing.
- **Cancellation and the pinned connection.** `RunWithAbortRace` returns early on a local abort
  while its goroutine still owns the connection. Check who can touch that connection next: the
  op's own cleanup (`ROLLBACK`/`COMMIT` detached), the next queued op after the entry lock is
  released, eviction `Close`, and a late `KILL QUERY`/`pg_cancel_backend` against a reused pid or
  thread id.
- **Transaction correctness.** `RunSQLMutation` rollback on every early return; console read-only
  wrap `BEGIN READ ONLY`/`START TRANSACTION READ ONLY` and its cleanup; what a failed cleanup
  leaves on a pinned connection for the next op.
- **Lifecycle and leaks.** `Disconnect` racing in-flight ops (unsynchronized `connSet`/`handle`/
  `db` fields, `QueryTracker.Drain` `WaitGroup` reuse, a dial completing after `ConnSet.CloseAll`),
  `Drain` blocking without a bound, reconnect path, side connections in `Cancel`.
- **Timeouts.** Per-engine client timeouts versus the Stop-button contract (Postgres sets
  `statement_timeout=0`; check ClickHouse's `http.Client.Timeout`).
- **Credentials in errors.** Driver error text surfaced through `Error.Message` (pgx
  `ParseConfigError` redaction, `url.Parse` errors kept only as `Cause`, ClickHouse request URLs),
  `ConnectInfo.Details`. Must not re-leak what Part 3 locked down.
- **SQLite specifics.** DSN keys against the driver actually linked, `?`/`#`/`%` in file paths,
  schema-less `pragma_*` calls against attached or `temp` schemas.
- **Scripts.** Pinned images in `test-matrix.sh` against `testsupport` constants; demo stack
  exposure (published ports, default passwords).

## 5. Watch items (pre-plan §5.3)

- P107 T2-3 `QueryTracker`: each adapter's `mu` guards only its handle. Check `Drain` on
  `Disconnect`, release identity on multi-statement ops, cancel races.
- P107 T2-2 shared `ConnSet` LRU with single-flight dial; P107 T2-1/I2-11 shared relational
  read/mutate trio (`PlanRelationalPage`, `KeysetPageCollector`, `RunRelationalMutate`).
- Every `Caps()` false must match an `Unsupported` return no caller reaches.
- Conformance suites (`SA/*/*_test.go`) are exempt from the unit-test bar (`CLAUDE.md`). Keep
  per-capability coverage; prune only true duplicates. They must still pass.
