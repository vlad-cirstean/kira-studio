# P168 Part 3 findings: Studio DB adapters I (adapter core and SQL engines)

Review of plan `P168-part3-sql-adapters.md`. Report only; nothing fixed. One Sonnet fixer follows
(plan §8) and deletes this file when done.

- Base commit: `e6691b2` (plan's surveyed tree). HEAD reviewed: `87757ac` (plan commit only on top).
  No Part 3 file changed between them. Whole chunk, not a diff (plan §1).
- P166/P167 skip list: `P166-code-review.md` absent on `v2.0`; `P167-code-review.md` deleted on
  `v2.0` (fixed). Neither names a Part 3 file. Nothing skipped.
- Paths: `SA` = `apps/kira-studio/internal/adapters`. Line numbers are current tree.

## Checks

- `go vet ./apps/kira-studio/internal/adapters/...`: clean.
- `go test -race ./apps/kira-studio/internal/adapters/...`: all pass (container suites skip with
  Docker down; sqlite runs real).
- Real-container run (dockerd started, images via `mirror.gcr.io`,
  `TESTCONTAINERS_RYUK_DISABLED=true`): `go test -count=1` over `SA/postgres/...`,
  `SA/mysqlfamily/...`, `SA/clickhouse/...`: all pass.
- Probes: throwaway `_test.go` files against real `postgres:17-alpine`, `mysql:8.4`,
  `mariadb:11.4`, `clickhouse-server:26.3` containers, deleted before commit. Each finding says
  which probe confirmed it.

## Findings (ranked)

13 findings: high 3 (F1-F3), medium 3 (F4-F6), low 7 (F7-F13). F1-F4 are rooted in the core;
F5-F13 in the engines. None needs a design decision beyond the fix named.

### F1 (high) Postgres read-only console escapes the read-only wrap

`SA/errors.go:87` (`sqlReadOnlyVarOff`), `SA/errors.go:105` (`endsTransaction`),
`SA/postgres/console.go:187-212`.

`AssertNoTransactionEscalation` is a spelling blacklist. Postgres accepts more spellings than it
lists:
- Boolean spellings beyond `off|false|0`: `no`, `n`, `f`, `fa`, `of`, … (`parse_bool` accepts any
  unique prefix).
- A quoted GUC name: `SET "transaction_read_only" = off` (regex needs `\s*(=|TO)` right after the
  bare name).
- `ABORT` (Postgres synonym for ROLLBACK) ends the wrap; `endsTransaction` checks only
  COMMIT/END/ROLLBACK. Then `RESET default_transaction_read_only` (or `RESET ALL`,
  `SET default_transaction_read_only TO DEFAULT`) clears the session default, and the next
  statement runs in writable autocommit.

Scenario (confirmed through the real adapter, `ReadOnly: true`, PG 17): each batch below inserted
its row; control `SET transaction_read_only = off` was rejected.
- `["SET transaction_read_only = no", "INSERT INTO t VALUES (200)"]`
- `["SET \"transaction_read_only\" = off", "INSERT …"]`
- `["ABORT", "RESET default_transaction_read_only", "INSERT …"]` (also leaves the pinned
  connection's session default writable for every later op).

Fix: stop relying on the blacklist alone. After every statement of a read-only batch, check
server state on the same connection: `pgconn.TxStatus()` must still be `'T'` (inside the wrap) and
`current_setting('transaction_read_only')` must be `on`; otherwise ROLLBACK, error, and re-assert
`SET default_transaction_read_only = on`. Keep the regex only as a cheap first pass, widened to
`ABORT`, quoted names and Postgres boolean prefixes. Extend `errors_test.go` table and the
`TestPostgres_ReadOnlyConnectionExecuteCannotEscapeReadOnlyTransaction` conformance case with
these spellings.

### F2 (high) MySQL/MariaDB read-only console escapes the read-only wrap via comment syntax

`SA/errors.go:285-347` (`StripSQLComments`, `startsLineComment`, block nesting),
`SA/errors.go:105`, `SA/mysqlfamily/console.go:155-178`.

The shared comment scanner diverges from the MySQL/MariaDB lexer three ways:
- `#` line comments are not recognised. `# x\nCOMMIT` strips to `# x COMMIT`; `endsTransaction`
  sees leading field `#`, not COMMIT.
- `--` is always a comment to the scanner; MySQL needs whitespace/control after it. `1--1` is
  arithmetic, so `SET @a = 1--1, SESSION transaction_read_only = OFF` strips to `SET @a = 1`.
- Block comments are treated as nesting; MySQL/MariaDB do not nest. `/* /* */ COMMIT -- */` is all
  comment to the scanner, but the server runs `COMMIT`.

Scenario (confirmed through the real adapter, `ReadOnly: true`, fresh connection per batch, on
both MySQL 8.4 and MariaDB 11.4; control `["COMMIT"]` rejected):
- `["# x\nCOMMIT", "SET @a = 1--1, SESSION transaction_read_only = OFF", "INSERT INTO t VALUES (101)"]`
- `["/* /* */ COMMIT -- */", "SET @a = 1--1, SESSION transaction_read_only = OFF", "INSERT … (100)"]`

Both rows landed. The session flag also stays OFF on the pinned connection, so later ops on that
read-only connection are writable too. The `console.go:146-154` doc claim ("no additional
per-statement rejection is strictly required on this dialect") is false once the wrap can be
ended.

Fix: same shape as F1. After every statement, check `@@in_transaction = 1` and
`@@transaction_read_only = 1` (MariaDB: `@@tx_read_only`); on failure ROLLBACK, re-run
`SET SESSION TRANSACTION READ ONLY`, error. Make the scanner dialect-aware (or add a MySQL mode):
`#` comments, `-- ` only before whitespace/control, non-nesting `/* */` for MySQL. Add the three
spellings to `errors_test.go` and the mysqlfamily conformance case.

### F3 (high) `ClassifySQL` reports executing writes as `read`

`SA/classify.go:91-122` (`ExplainAnalyzeTarget`), `SA/classify.go:163-172` (WITH branch),
`SA/errors.go:285` (scanner, shared with F2).

`dbmcp run_query` gates on the class; a `read` verdict under the common read=allow mode runs with
no prompt. Confirmed misclassifications (probe on `ClassifySQL`, server behaviour confirmed on
real servers):
- `EXPLAIN ANALYSE DELETE FROM t` and `EXPLAIN (ANALYSE) DELETE FROM t` → `read`. Postgres accepts
  the British spelling and executes the DELETE (PG 17: rows gone).
- `WITH a AS (SELECT 1) SELECT * INTO newt FROM a` → `read`. Postgres creates table `newt`
  (confirmed). The WITH branch scans DDL/write keywords but not `INTO`.
- MySQL `SELECT 1--1 INTO OUTFILE '/tmp/x'` and `SELECT 1 # /*\nINTO OUTFILE '/tmp/x' -- */` →
  `read`; the server writes a file (FILE privilege). Same scanner divergence as F2.

Fix: accept `ANALYSE` alongside `ANALYZE` in `ExplainAnalyzeTarget` and `sqlAnalyzeKeyword`; check
`sqlIntoKeyword` in the WITH branch; dialect-aware comment stripping from F2 (or, fail-closed, map
any statement containing `#` or a `--` not followed by whitespace to `unknown` for the
mysql-family/clickhouse classifiers). Add the cases to `classify_test.go`.

### F4 (medium) Keyset tokens bound as display text: binary keys page wrongly, can loop forever

`SA/sqltext.go:61-85` (`BuildKeysetWhereSQL`), `SA/sqltext.go:654-670` (`keysetValueAt`).

Keyset boundary values are the cells' display text, bound as plain string params. A binary key
column displays as `0x<hex>`, so the predicate compares the column with the ASCII bytes of
`"0x…"`. MySQL `BINARY`/`VARBINARY` (UUID keys are common), Postgres `bytea` (text input `'0x01'`
parses as escape-format bytes `30 78 30 31`) and SQLite `BLOB` (TEXT always sorts before BLOB) are
all affected.

Scenario (confirmed, MySQL 8.4 via adapter `Read`): table `b(id varbinary(4) primary key)` with 8
rows, page size 2, following `NextToken` with `after` cursors: page 6 still `hasMore=true`;
pagination never terminates and repeats rows. Same mechanism skips rows instead of looping for
other byte distributions.

Fix: decode each keyset value by its column's type class before binding (binary →
`DecodeBinaryCellText`, as `NewParamRenderer` already does for mutations), or make a binary
column keyset-ineligible in `ComputeEffectiveOrder` (offset fallback). Add a binary-PK keyset
scenario to each relational conformance suite.

### F5 (medium) A cancelled catalog query kills the pinned connection for good

`SA/postgres/catalog.go:25-48` (`execFor`), `SA/mysqlfamily/catalog.go:20-44` (`execFor`),
`SA/postgres/client.go:283-312`, `SA/mysqlfamily/client.go:366-392` (`Acquire`).

Catalog queries (tree, Describe, Definition, SchemaColumns, `getReadTarget` inside Read and
Mutate, the Connect probe) pass the op's own ctx straight to the driver; only the data/console
paths use `RunWithAbortRace`. On cancel, pgx v5.11's default `DeadlineContextWatcherHandler` sets a
socket deadline and `ResultReader.receiveMessage` calls `asyncClose()`; go-sql-driver closes its
netConn. `ConnSet` never checks liveness, so the dead `*pgx.Conn` / `*sql.Conn` stays the entry for
that database.

Scenario (confirmed, real adapter): cancel an `execFor` query mid-flight (Stop on a slow tree
expand or Describe, or the frame session closing). The next `Children` on the same database fails
with `failed to deallocate cached statement(s): conn closed` (PG 17) or `driver: bad connection`
(MySQL 8.4, MariaDB 11.4), and keeps failing until the user reconnects.

Fix: route `execFor` through `RunWithAbortRace` + `track()` like `runArrayQuery` (cancel stays
server-side via `Cancel`), and make `Acquire` drop and re-dial an entry whose connection is closed
(`conn.IsClosed()` for pgx; `driver.ErrBadConn` / `Conn.PingContext` for mysql). Add a
cancel-then-reuse scenario to both conformance suites.

### F6 (medium) Per-connection lock ignores ctx: Stop on a queued op and teardown both block unbounded

`SA/postgres/client.go:232-236` (eviction/`CloseAll` `Close`), `SA/postgres/client.go:293,303-310`
(`Acquire`), `SA/mysqlfamily/client.go:270-275,376,385-390`, `SA/relational/connstate.go:32-51`.

`connEntry.mu` is a `sync.Mutex` held for an op's whole duration, including the release's
`inFlight.Wait()` for a background query that `RunWithAbortRace` already abandoned. Three waits on
it take no ctx: `Acquire` (a queued op), LRU eviction `Close` inside another op's `Get`, and
`CloseAll` inside `Disconnect`.

Scenario: the server becomes unreachable mid-query (VPN drop, laptop sleep). `Disconnect` runs
`Cancel`, whose side dial fails after `connectTimeout`; `Drain` returns at ctx; `CloseAll` then
blocks on `e.mu`, held by the op whose detached-ctx query waits on a dead socket until TCP
keepalive gives up (pgx dialer keepalive 5 min, many minutes total). `Router.Disconnect` and a
reconnect's `Router.Connect` (teardown is inline at `adapterhost/router.go:156-157`) hang far past
`disconnectTimeout`; Part 2's `connections.Service.abortInFlight` waits unbounded on that Connect,
so Disconnect/Remove/Update of the connection hang too. Same lock: pressing Stop on a Read queued
behind a long query does nothing until that query ends. Not reproduced (needs a partition); traced
from code.

Fix: replace `connEntry.mu` with a 1-slot channel semaphore acquired via `select` on ctx (Acquire
returns `CheckCancelled`); in `Close`, wait for the semaphore with a bound, then close the socket
regardless (`PgConn().Conn().Close()` / `connEntry.db.Close()` are safe to call concurrently and
unblock the stuck reader).

### F7 (low) Server-side cancel can hit the next op's query on the same connection

`SA/postgres/adapter.go:386-410`, `SA/mysqlfamily/adapter.go:373-397`.

`Cancel` pops the backend pid / thread id, then dials a side connection, then cancels whatever
that backend runs at that moment. If the targeted query finishes in the dial window (a TLS dial
over WAN is tens of ms) and its op releases the entry, the next queued op starts on the same
backend and gets `pg_cancel_backend` / `KILL QUERY` instead. The other op reports `E_CANCELLED`
for a Stop the user never pressed.

Fix: have the entry's release wait for an in-progress Cancel aimed at it (record "cancel in
flight" on the entry under the tracker lock; `Acquire`'s release blocks on it), or on Postgres use
`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid = $1 AND query_start = $2` with the
start time captured when the query was tracked.

### F8 (low) sqlite `inFlight.Add` has no draining guard

`SA/sqlite/adapter.go:150-160` (Disconnect's waiter), `SA/sqlite/adapter.go:180-217`
(`runOnConn`).

`runOnConn` calls `a.inFlight.Add(1)` with no lock and no draining check, while `Disconnect`'s
goroutine may be in `inFlight.Wait()`. This is the exact `sync.WaitGroup` misuse P108 F3 fixed in
`QueryTracker` (`draining` flag) but sqlite kept its own counter. An op that resolved the adapter
before `takeLiveAdapterForTeardown` removed it can start after Disconnect began: worst case the
`WaitGroup` panics ("Add called concurrently with Wait"), otherwise it runs on a DB whose close is
pending.

Fix: reuse `QueryTracker`'s pattern: a `draining` flag checked and `Add` done under `a.mu`, refuse
new work with `E_CONNECT` once draining.

### F9 (low) sqlite `Connect` ignores ctx

`SA/sqlite/adapter.go:66-120`.

`Connect(_ context.Context, …)` runs `db.Conn` and three probes on `context.Background()`. Each
probe can wait the 5 s busy timeout on a locked file, and a file on a hung network mount blocks
indefinitely. Part 2's `abortInFlight` waits on Connect with no bound, so Disconnect/Remove/Update
of that connection wait too.

Fix: pass ctx to `db.Conn` and `runRows`; on ctx error run the existing cleanup path.

### F10 (low) Postgres definition emits a stray sequence for identity columns

`SA/postgres/definition.go:175-200` (`fetchSerialSequences`), used by `buildTableStatements`.

The doc comment says `pg_get_serial_sequence` returns NULL for an identity column; it returns the
identity sequence (confirmed PG 17: `public.ident_id_seq`). The generated DDL then has
`CREATE SEQUENCE public.ident_id_seq`, the identity column, and `ALTER SEQUENCE … OWNED BY`.
Replayed, it succeeds but leaves an unused extra sequence (the identity gets `ident_id_seq1`), so
the "Open definition" text does not reproduce the table.

Fix: add `AND a.attidentity = ''` to the query and correct the comment.

### F11 (low) ClickHouse reads a literal `ᴺᵁᴸᴸ` string as NULL

`SA/clickhouse/query.go:31-43` (`nullSentinel`, `decodeRow`).

`JSONCompactStrings*` renders NULL as `ᴺᵁᴸᴸ`, and a real string with that text renders the same
(confirmed CH 26.3: rows `(1, NULL)` and `(2, 'ᴺᵁᴸᴸ')` both come back `"ᴺᵁᴸᴸ"`). The grid shows
NULL for a non-NULL value. Exotic input, but the doc comment's "can't collide" is wrong.

Fix: for Nullable columns select an extra `isNull(col)` flag (read path knows the types), or
switch to a typed JSON format where NULL is JSON `null`. At minimum, correct the comment.

### F12 (low) ClickHouse console: a leading `#` comment drops the result and buffers it all

`SA/clickhouse/console.go:92-99` (`leadingCommentRE`, `isRowReturning`),
`SA/clickhouse/query.go:171-188` (`RunCommand`).

ClickHouse accepts `#` comments (confirmed: `# note\nSELECT 42` returns 42). `leadingCommentRE`
skips only `--` and `/* */`, so `# fetch\nSELECT * FROM big` is routed to `RunCommand`, which
`io.ReadAll`s the entire result into memory, discards it, and reports `0 row(s) written`. Same for
a parenthesised `(SELECT …)` or a FROM-first `FROM t SELECT …`.

Fix: add `#[^\n]*\n` to `leadingCommentRE` and `\(`/`FROM` to `rowReturningRE`; in `RunCommand`
drain the body with `io.Copy(io.Discard, …)` instead of buffering it.

### F13 (low) ClickHouse query params reject tab/newline in identifiers

`SA/clickhouse/query.go:77-79` (`escapeParamValue`).

Param values are parsed as TSV-escaped text; only backslash is escaped. A raw tab or newline stops
the parse (confirmed CH 26.3: `param_x=a%09b` → `BAD_QUERY_PARAMETER … only 1 of 3 bytes was
parsed`). A database/table name containing either fails every catalog lookup, Describe and Count.

Fix: also escape `\t`, `\n`, `\r` (as `\\t`, `\\n`, `\\r`) after the backslash pass.

## Coverage

### Block 1: core (`SA/*.go`, `SA/relational`) (reviewed)

Reviewed in full: `errors.go`, `classify.go`, `sqltext.go`, `sqlmutate.go`, `relationalpage.go`,
`tracker.go`, `abort.go`, `connset.go`, `guarded.go`, `relational/connstate.go`, `adapter.go`,
`caps.go` (field set and JSON names match `packages/shared/caps.ts`), `format.go`, `live.go`,
`registry.go`, `rowops.go`, `sslmode.go`, `tree.go`.

Leads checked, no finding:
- `QueryTracker.Drain` leaves `draining=true` after a ctx timeout: harmless. `Router.Connect`
  always builds a new adapter (`CreateAdapter`) and removes the old one from the live map first,
  so no op registers on a drained tracker.
- `TrackerFor` no-op release while draining: only an op already holding the old adapter can hit
  it; its query still runs on a connection `CloseAll` then waits for (see F6).
- `RunSQLMutation`: rollback on every early return incl. failed COMMIT; each engine's rollback
  detaches ctx (`WithoutCancel` + 5 s).
- `ValidateRequestedTerms` reached by every engine's structured sort (PG/MySQL/SQLite through
  `ComputeEffectiveOrder`, ClickHouse through `computeOrderBySql`).
- `WhereClause` trailing `--` handled by the newline before `)`. `ConnSet`: single-flight, Primary
  never evicted, dial after `CloseAll` closed, no leak on dial error.
- `QuoteIdentDouble`/`Backtick` NUL panic: recovered by `Host.RunOp` and by the data-frame
  `recover()` covering `Preview`.
- Missing unit tests for `Guarded`, `ParseSSLMode`, `relational.Disconnect`: bodies are trivial,
  under the `CLAUDE.md` unit-test bar; not a finding.

### Blocks 2-5: engines (reviewed)

- **postgres** (all 10 files): `adapter, caps, catalog, client, console, definition, errors,
  mutate, query, read`. Findings F1, F5, F6, F7, F10. Checked, no finding: `buildConfig` clears
  `Fallbacks` on override; `verify-ca` chain check; `statement_timeout=0`; read path runs
  `AssertNoHiddenStatement` on filter and text sort for read-only; definition quotes every name
  via `format('%I')`; `mapError` keeps pgx's redacted config error.
- **mysqlfamily, mysql, mariadb** (all 16 files). Findings F2, F5, F6, F7. Checked, no finding:
  `MultiStatements=false`, `ClientFoundRows=true`, URI query keys never reach driver `Params`,
  TLS registry names bounded per mode/host, `KILL QUERY` side connection unprivileged for own
  thread, definition quotes with backticks, binary cells decoded on mutate.
- **sqlite** (all 10 files). Findings F8, F9. Lead refuted: `buildDSN` concatenation is safe
  because `rejectDSNMetacharacters` refuses `?`, `#`, `%` first; modernc v1.58 honours
  `_query_only`, `_busy_timeout`, `_foreign_keys`, `_txlock`, `mode`. `mode=ro` makes ATTACH
  inherit read-only. `assertSingleStatement` fails closed. Mutate rollback detached.
- **clickhouse** (all 10 files). Findings F11, F12, F13. Leads refuted (CH 26.3): `readonly=2`
  cannot be lowered by `SETTINGS readonly=0` (Code 164); credentials travel only in
  `X-ClickHouse-User`/`Key` headers, never URL or error text; catalog SQL binds every name as
  `{x:String}`; `KILL QUERY … SYNC` is bounded by Disconnect's ctx and covers in-flight streams
  after `CloseIdleConnections`; unbracketed IPv6 host in `OpenClient`'s URL still dials correctly
  (Go splits on the last colon). TLS modes all verify certificates (stricter than pg/mysql
  `require`), documented as D12.
- Connect promptness (plan §5.1, Part 2 `abortInFlight`): postgres/mysqlfamily dial with ctx and
  `connectTimeout` 10 s; clickhouse probe is `RunWithAbortRace` on ctx; sqlite is F9; reconnect
  teardown is F6.
