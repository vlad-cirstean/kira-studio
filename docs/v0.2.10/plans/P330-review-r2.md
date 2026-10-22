# P330 review round 2 findings

Base `d61472b` (v2.8 P319 close-out), same as P329. HEAD `645af3452`. Scope `git diff d61472b..HEAD`: P320 sweep, P322-P328, and P329 round 1 fixer commits `5be176a03..1b40136a2` as unreviewed code. One Opus reviewer, three dimensions. Findings only, ranked by severity. Four findings.

## Scope checks with no finding

- Classifier fix (`9ef65f3b2`): `DESCRIBE t`, `DESC t col` and ClickHouse `DESCRIBE TABLE t` still reach `ExplainAnalyzeTarget` with no ANALYZE, so they stay read. MySQL `EXPLAIN ANALYZE FORMAT=TREE ...` lands on `ClassUnknown`, which fails closed. MariaDB `ANALYZE FORMAT = JSON <dml>` strips correctly; `ANALYZE TABLE`, `ANALYZE NO_WRITE_TO_BINLOG TABLE` and Postgres `ANALYZE VERBOSE t` stay DDL.
- MySQL per-request wrap: inside `START TRANSACTION READ ONLY`, MySQL refuses to change transaction characteristics, so "still in a transaction" is the right invariant on a writable connection. The violation path re-arms `SET TRANSACTION READ WRITE`, so the probe's armed read-only flag does not leak to the next transaction.
- `ConnectContext` (`b0aca3f89`): `WithoutCancel` keeps the MCP source value and drops the request's cancellation, so a closed MCP request cannot abort a connect other waiters share. The tag reaches `RunOp` through `RunPreconnect` and `Backend.Connect`.
- Stale strip (`dcbded40d`): Definition, Documents and Stream now gate on loaded data. Console `restamp` only re-marks read-only output. `ConsoleSlickGrid` is `editable: false`, so no write path reopens on old-session data.
- Update dialog (`429bc443f`): every close goes through `later()` (Esc, overlay and the routed popup), and the status-bar open clears `checkError`. No stale `checkFailed` path is left.
- Runs section (`3b3251874`): Tailwind 4.3.3 emits `max-h-1/2` as a percentage of the panel. The section is no longer `shrink-0`, and the new spec measures it against the panel.
- S3 spec (`588d47d72`) covers all four gates round 1 listed. Title-bar comments (`1b40136a2`) match the code.
- P328 Postman multi-file import: per-file failures stay isolated, and the one emit per kind replaces the old per-call deferred emit. The only `Import` caller sends `paths`.
- Performance: the per-request wrap adds three short round trips (BEGIN, verify, COMMIT) to an MCP read. `staleData.isStale` is a map lookup. Nothing real.

## 1. High: MCP read commits or rolls back an open user transaction

`dbmcp/tools.go:223` now sets `ReadOnly` for every read verdict on a writable connection. `postgres/adapter.go:375` and `mysqlfamily/adapter.go:357` then open the wrap on the shared per-database connection, the same pinned connection the console uses (`requireClient`/`ConnSet.Acquire`, one entry per database). On a writable connection, nothing stops a console batch from leaving a transaction open across batches: `AssertNoTransactionEscalation` runs only under `readOnly`, and no code checks the transaction state between ops.

Failure, Postgres: the user runs `BEGIN; UPDATE accounts SET balance = 0 WHERE id = 7;` in the console and pauses to check before `COMMIT`. An MCP client runs `SELECT count(*) FROM accounts`, which is allowed by default. `BEGIN READ ONLY` (`postgres/console.go:258`) inside the open transaction is only a warning (25001), so the SELECT runs in the user's read-write transaction. `verifyReadOnlyWrap` (`:212-224`) sees `transaction_read_only = off`, runs `ROLLBACK` and returns "This connection is read-only." The user's UPDATE is gone without notice. Their later `COMMIT` is a no-op warning.

Failure, MySQL/MariaDB: same sequence. `START TRANSACTION READ ONLY` (`mysqlfamily/console.go:236`) implicitly commits the user's open transaction before the read runs. The UPDATE is committed. A later `ROLLBACK` is meant to undo it, but does nothing.

The same thing happens to an MCP client's own `BEGIN` → `UPDATE` (approved) → `SELECT` sequence. Before round 1, a writable connection ran MCP reads with no wrap, so neither failure existed. The P329 Known open items entry does not mention it.

Fix direction: when `readOnly && !connReadOnly`, check the transaction state before opening the wrap. Postgres: `conn.PgConn().TxStatus() != 'I'`. MySQL/MariaDB: the existing `SET TRANSACTION READ ONLY` probe, where error 1568 means a transaction is open. A probe that succeeds only arms the next transaction, which `START TRANSACTION READ ONLY` opens anyway. If a transaction is open, refuse the MCP read with its own message ("the connection has an open transaction; commit or roll it back first"). Never begin, commit or roll back on top of it. Add a `testsupport` scenario: open a transaction and write, send a `ReadOnly` request, then check the write is still pending and can be rolled back.

## 2. Medium: per-request wrap falsely refuses ordinary MCP reads as "This connection is read-only."

With `ReadOnly` set, `execute` runs `AssertNoTransactionEscalation` (`postgres/console.go:245-249`, `mysqlfamily/console.go:225-229`). That screen was built for read-only connections. Its `AssertNoHiddenStatement` (`adapters/errors.go:553-562`) rejects any backslash inside a quoted run, and `sqlReadWrite` (`errors.go:100`) matches `READ WRITE` anywhere in the text, string literals included. Both return `backend.studio.adapter.readOnly.body`, "This connection is read-only."

Failure: on a writable Postgres connection with default MCP modes, `SELECT * FROM logs WHERE msg ~ '\d{3}'`, `... LIKE 'a\_b'`, `SELECT E'\n'` or `... WHERE body ILIKE '%read write%'` classify read. They ran before round 1. Now each is refused with a message that is false for this connection, so the MCP client cannot tell what to change. The same happens on MySQL/MariaDB.

The screen adds nothing for a read verdict. `ClassifySQL` (`classify.go:146-149`) already returns `ClassUnknown` for any inner `;` in the raw text, so a read verdict is always one statement. Its leading keyword cannot be a transaction verb or `SET TRANSACTION`. The real backstop is `verifyReadOnlyWrap` after the statement.

Fix direction: run `AssertNoTransactionEscalation` only when `connReadOnly`, and rely on the wrap plus `verifyReadOnlyWrap` in per-request mode. Give the per-request violation its own message key (for example "MCP ran this read as read-only and it tried to write"), not the read-only-connection text. Add a scenario case: a backslash literal read under `ReadOnly` on a writable connection succeeds.

## 3. Low: failed update check shows a raw Go error with the GitHub API URL

`apps/kira-studio/internal/bridge/update.go:54-56` passes `err.Error()` as `{cause}`. For a network failure that text is net/http's own, for example `Get "https://api.github.com/repos/.../releases/latest": dial tcp: lookup api.github.com: no such host`. The dialog renders it as "Couldn't check for updates (Get "https://…": dial tcp …)."

Failure: offline, the user picks Check for updates. The dialog shows a Go transport string and a URL. The type's own doc comment (`:11-14`) says the update wire shape carries no URL to the renderer.

Fix direction: map the error to a short catalog cause in `appupdate` (offline or DNS, timeout, `unexpected status N`), and log the raw error with `slog`.

## 4. Low: dead `DESCRIBE`/`DESC` entries in `sqlReadKeywords`

`adapters/classify.go:49-51` still lists `DESCRIBE` and `DESC` as plain reads. `:180` then excludes them by name so `:182` can handle them. Two places now define where `DESCRIBE` belongs, and they contradict each other. The map's comment says "plain-read vocabulary", which no longer holds for those two keys.

Failure: a later edit that reorders the switch, or reuses `sqlReadKeywords` elsewhere, brings back the `DESCRIBE ANALYZE DELETE` bypass P329 fixed.

Fix direction: remove `DESCRIBE` and `DESC` from `sqlReadKeywords`, and drop the `keyword != ...` guard at `:180`.
