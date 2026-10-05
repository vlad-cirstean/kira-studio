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

Block 1 (core) findings below. Engine findings follow in the block 2 commit.

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
  it; its query still runs on a connection `CloseAll` then waits for (see F6 in block 2).
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
