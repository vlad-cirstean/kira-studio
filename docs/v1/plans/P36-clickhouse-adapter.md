# P36 — The ClickHouse adapter: an OLAP engine has no row identity

> SPEC.md §10's **P36** row, verbatim:
>
> *"An eighth SQL-family adapter, `engine/adapters/clickhouse/`, for ClickHouse's columnar/OLAP
> dialect, matching the fixed adapter shape with its own `tests/db/clickhouse.spec.ts` against a
> ClickHouse testcontainer"*, with the rationale *"Not yet planned — queued. How much of the fixed
> SQL-adapter shape (pending-change mutation staging, in particular) fits an OLAP engine's own
> conventions is an open question for that plan"*. This plan answers that question, and the answer
> is **most of it, but not update and not delete**.
>
> **The finding the phase turns on.** `ClickHouse does not require a unique primary key. You can
> insert multiple rows with the same primary key.` — the MergeTree engine doc, verbatim (F16). Every
> write path this app has, from `views/grid/pendingChanges.ts:53`'s `primaryKeyOf` through
> `mutate.ts`'s `assertKeyIsPrimaryKey` and `assertAffectedExactlyOne`, rests on the assumption that
> a table's primary-key columns address exactly one row. ClickHouse's `PRIMARY KEY` is a *sparse
> index over the sorting key*: it is not a constraint, it is not unique, and there is no other
> unique identity to substitute (F19, F20). The plan's central decision (D23) is therefore
> `canInsert: true, canUpdate: false, canDelete: false, writable: true` — the same shape Kafka
> already ships (`kafka/caps.ts:26-29`), reached for a different but equally structural reason, and
> declared rather than simulated. §5.1: *"If a driver cannot cancel, the capability is absent and
> the stop button says so rather than lying."* The same rule, applied to writes.
>
> **The second finding, and the one that makes the phase cheap.** The driver is
> `@clickhouse/client@1.23.1`: **pure TypeScript, zero external dependencies** (its one dependency,
> `@clickhouse/client-common`, is itself dependency-free), speaking ClickHouse's **HTTP interface**
> on port 8123 over `node:http`/`node:https` (F1, F2). No native addon, no `electron-rebuild`, no
> `asarUnpack`, no per-ABI cache — the exact opposite of P32's Kafka driver, and the first
> *added* dependency since P32 that carries none of P32's cost. `@testcontainers/clickhouse@12.1.0`
> exists and pins the same `testcontainers@12.1.0` this repo already has (F47), so the DB fixture is
> the same five-line preset shape `support/mysql.ts` and `support/redis.ts` already use.
>
> **The third finding, and the one that makes cancellation real.** Unlike SQLite (P35 D4, the app's
> first honest `cancel: false`), ClickHouse can genuinely be cancelled — but *only* by asking.
> The HTTP interface doc is explicit: *"Running requests don't stop automatically if the HTTP
> connection is lost"* (F8), so an `AbortSignal` is a local-only teardown and would be exactly the
> lie §5.1 forbids. The real mechanism is `KILL QUERY WHERE query_id = '…' SYNC` (F9) issued on a
> **second HTTP request over the same client's pool** (F7) — Postgres's `pg_cancel_backend(pid)`
> and MySQL's `KILL QUERY <threadId>` side-connection pattern, with the side connection replaced by
> a socket the connection pool already has. `caps.cancel: true`, and it is forwarded to the server.
>
> **The fourth finding, and the one that widens a shared file.** P34 D17's `SqlDialect` seam absorbed
> MySQL in one line and P35 D28 absorbed SQLite in three — because both landed on a quote character
> `quoteIdent` already emitted. ClickHouse is the first engine to land on the *other* branch:
> it quotes identifiers with **backticks** (F28), which today only `dialect === 'mysql'` produces
> (`sqlIdent.ts:33`). The seam still holds, but `quoteIdent` stops being an if/else and becomes a
> set (D29) — and `@codemirror/lang-sql@6.10.0` has no ClickHouse dialect to map onto (F41), so
> `languages.ts` gains its first `SQLDialect.define()`: a third shape beside "map to a vendored
> dialect" (postgres/mysql/sqlite) and "hand-write a `StreamLanguage`" (mongo/redis, P18/P35).

## 0. Ground rules for this phase

- **One new dependency, and it must stay boring.** `@clickhouse/client` is added as a production
  dependency. It is pure TypeScript with one dependency-free transitive package (F1), so
  `externalizeDepsPlugin()` treats it exactly like `pg` and `mariadb`, `scripts/native-electron-build.sh`
  is not touched, and `electron-builder`'s `asarUnpack` list is not touched. Commit 2 exists solely
  to prove that (§4).
- **The user's schema is not ours to change.** No `ALTER TABLE … MODIFY SETTING`, no `OPTIMIZE`, no
  `SYSTEM FLUSH`, no `ANALYZE`-equivalent. This is P35's "the user's file is not ours to change"
  rule restated for a server: lightweight `UPDATE` is *only* available once
  `enable_block_number_column` and `enable_block_offset_column` are enabled **as table settings**
  (F21), and turning them on for a user's production table in order to make a grid cell editable is
  precisely the trade this rule forbids (D24).
- **Absent capabilities are declared, not simulated.** `canUpdate: false`, `canDelete: false`,
  `foreignKeys: false`, `transactions: false`, `pagination: 'offset'` (D23, D25, D18, D26, D20).
  Five honest falses, each with a finding behind it. `cancel` is *not* one of them (D8).
- **Nothing silently dropped or silently truncated.** The server itself refuses multi-statement
  input over HTTP (`Code: 62 … Multi-statements are not allowed`, F11) — better than SQLite's silent
  tail-drop (P35 F9), so the adapter forwards the server's message rather than pre-empting it. The
  renderer, however, *does* silently drop an update/delete op whose key is null
  (`pendingChanges.ts:187-193`, F37), which is exactly what would happen on every ClickHouse table
  — so the grid's delete affordances become caps-gated instead (D31).
- **Preview and execution must be the same text.** §8.14 requires *Preview command* to show "the
  exact statements the pending changes will execute". ClickHouse's HTTP interface has no positional
  placeholder and its named `{name:Type}` parameters require the adapter to declare a type per
  placeholder (F3), so this adapter renders SQL literals on **both** paths (D27) — with a ClickHouse-
  correct escaper, since `'` alone is not enough here (F28, F39).
- Comments per `AGENTS.md`: only where the code cannot say it for itself — in particular D24's
  "why there is no update", D27's backslash escape, D20's "why there is no keyset", and D19's
  `default_format` trick, none of which anyone re-derives from the code.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every commit.
  `tests/db/clickhouse.spec.ts` **needs Docker** (unlike P35's), so per `AGENTS.md` it cannot be
  executed in Claude Code's Linux web container; items that depend on a live server are flagged
  **verify-on-container** in §8, exactly as P34 flagged them.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings

Findings F1–F35 are ClickHouse and driver facts, each read from the official documentation in
`ClickHouse/ClickHouse@master/docs`, the ClickHouse source, or the npm registry / the client's own
source. F36–F50 are facts about this tree, measured against it. Nothing here is assumed; where a
fact could only be confirmed against a running server it is called out as such and lands in §8's
verify-on-container list.

### The driver

**F1 — `@clickhouse/client` is pure TypeScript with effectively zero dependencies.** npm registry,
`@clickhouse/client`: latest **1.23.1**, `"engines": {"node": ">=16"}`, `"dependencies": {"@clickhouse/client-common": "1.23.1"}`,
Apache-2.0, repo `github.com/ClickHouse/clickhouse-js`. `@clickhouse/client-common@1.23.0`'s own
`dependencies` object is **empty**. The README states the client is *"written purely in TypeScript"*
with *"zero external dependencies"*. `packages/client-node/package.json` lists `simdjson` only as a
**devDependency** (a benchmark comparison), never shipped. There is no `binding.gyp`, no
`node-gyp-build`, no `prebuild-install`, no `node-addon-api`. This is the whole reason the phase
does not repeat P32.

**F2 — it speaks the HTTP interface, and the HTTP interface's port is 8123.** The client's default
`url` is `http://localhost:8123` (`packages/client-common/src/config.ts`), the Node implementation
builds on `node:http`/`node:https` + `node:stream`, and the ClickHouse HTTP doc's opening line is
*"port 8123 for HTTP"*. The native TCP protocol (port 9000) has no first-party JS client at all —
`@clickhouse/client` is HTTP-only, and `@clickhouse/client-web` is the Fetch/WebStreams variant for
browsers, which is not what the engine process is. There is no decision to make here: HTTP is the
only option the official client offers, and it is also the simpler one.

**F3 — the client's configuration surface** (`BaseClickHouseClientConfigOptions`, verified against
`packages/client-common/src/config.ts`): `url` (default `http://localhost:8123`), `pathname`,
`request_timeout` (default `30_000`), `max_open_connections` (default `10`), `compression.response`
/ `compression.request` (both default `false`), `username` (default `default`), `password`,
`access_token`, `application`, `database` (default `default`), `clickhouse_settings`, `log.level`,
`session_id`, `role`, `http_headers`, `keep_alive.enabled` (default `true`) /
`keep_alive.idle_socket_ttl` (default `2500`), `json`, `tracer`, `use_multipart_params`,
`dangerously_log_query_text`. The Node build adds `tls`, `http_agent`, `set_basic_auth_header`,
`capture_enhanced_stack_trace`, `max_response_headers_size`.

**F4 — the client's methods, and which one the adapter needs where.** From
`packages/client-common/src/client.ts`:
- `query(params)` — **always appends `FORMAT <format>` to the query text** (the doc comment says so
  outright, and warns that a query already containing `FORMAT` produces a duplicate-`FORMAT` syntax
  error, *"intended behavior"*). Returns a `ResultSet` with `json()`, `text()`, `stream()`,
  `query_id`, `response_headers`.
- `exec(params)` — takes the **full SQL including any `FORMAT`**, adds nothing, returns
  `ExecResult<Stream>`; *"the caller must consume the stream, as the underlying socket will not be
  released until then."*
- `command(params)` — for statements with no output; returns `CommandResult` carrying `summary`.
- `insert(params)`, `ping()`, `close()`.
`QueryParams` carries `query`, `format`, `query_params`, `clickhouse_settings`, **`abort_signal`**,
**`query_id`**, `session_id`, `role`.

**F5 — errors arrive as a real, machine-readable class.**
`packages/client-common/src/error/error.ts` exports `ClickHouseError extends Error` with
`code: string` (the numeric ClickHouse error code, as a string) and `type: string | undefined`
(the `SCREAMING_SNAKE` name), parsed out of the server's own
`Code: N. DB::Exception: <message> (TYPE) (version …)` envelope. Its regex deliberately anchors on
the *innermost* exception so a cluster-wrapped error still classifies correctly. This is the same
class of vocabulary SQLite's `errcode` gave P35 (F6/D26) — classification, not message-sniffing.

**F6 — the numeric error codes the adapter classifies on**, read from
`src/Common/ErrorCodes.cpp@master`: `47 UNKNOWN_IDENTIFIER`, `48 NOT_IMPLEMENTED`,
`60 UNKNOWN_TABLE`, `62 SYNTAX_ERROR`, `81 UNKNOWN_DATABASE`, `159 TIMEOUT_EXCEEDED`,
`164 READONLY`, `192 UNKNOWN_USER`, `193 WRONG_PASSWORD`, `194 REQUIRED_PASSWORD`,
`195 IP_ADDRESS_NOT_ALLOWED`, `209 SOCKET_TIMEOUT`, `210 NETWORK_ERROR`, `242 TABLE_IS_READ_ONLY`,
`291 DATABASE_ACCESS_DENIED`, `394 QUERY_WAS_CANCELLED`, `497 ACCESS_DENIED`,
`516 AUTHENTICATION_FAILED`.

**F7 — a concurrent second request is free.** `max_open_connections` defaults to 10 sockets per host
(F3), so the `KILL QUERY` that cancels an in-flight `SELECT` goes out on a socket the same client
already owns. Postgres (`postgres/index.ts`) and MySQL (`mysql-family/index.ts:345-371`) both have to
*open a whole new connection* to cancel; ClickHouse needs no `ConnectionSet`, no LRU, no
`PRIMARY_KEY` sentinel, and no per-database connection at all — the database is a per-request
parameter, not a connection property.

**F8 — an abort signal is not a cancel.** The HTTP interface doc, verbatim: *"Running requests don't
stop automatically if the HTTP connection is lost. Parsing and data formatting are performed on the
server-side, and using the network might be ineffective."* Passing `ctx.signal` as `abort_signal`
tears down the local request and frees the socket, and is worth doing, but on its own it is exactly
the *"stop showing the result"* non-cancel §5.1 forbids.

**F9 — `KILL QUERY` is the real mechanism, and it needs no privilege to kill your own query.**
Syntax, from `docs/reference/statements/kill.mdx`:
`KILL QUERY [ON CLUSTER cluster] WHERE <expr over system.processes> [SYNC|ASYNC|TEST] [FORMAT f]`.
`ASYNC` is the default (fire and forget); `SYNC` waits and returns a `kill_status` column per
process (`finished`, `waiting`, or a reason it could not be stopped); `TEST` only checks
permissions. The doc states *"Read-only users can only stop their own queries"* — i.e. no
`PROCESS`/`SUPER`-equivalent grant is needed for the case the adapter cares about, the same property
that lets `tests/db/mysql.spec.ts` run its cancel scenario as an unprivileged user.

**F10 — the query id is the adapter's to choose.** The HTTP interface's documented optional
parameters are `query_id` (*"can be passed as the query ID (any string)"*) and `quota_key`, and
`QueryParams.query_id` (F4) passes it through per request. So the adapter, not the server, owns the
value `KILL QUERY` will match on — no `SELECT connection_id()` / `pg_backend_pid()` round trip, and
no window between "the query started" and "we learned its id" (which is the race
`mysql-family/query.ts`'s `TrackQuery` machinery exists to close).

**F11 — the server refuses multi-statement input, with a real error.** The HTTP interface doc's own
example:
```
curl -sS "http://localhost:8123" --data-binary "SET ROLE my_role;SELECT * FROM my_table;"
Code: 62. DB::Exception: Syntax error (Multi-statements are not allowed)
```
This is strictly better than SQLite's behaviour (P35 F9 — `prepare()` silently kept the first
statement and discarded the rest) and equal to MariaDB's `multipleStatements: false`: the guard is
the server's, so the adapter needs none of its own and the message is already the right one.

**F12 — every response carries a summary header.** `X-ClickHouse-Summary` is a JSON object with
`read_rows`, `read_bytes`, `written_rows`, `written_bytes`, `total_rows_to_read`, `result_rows`,
`result_bytes`, `elapsed_ns`, and (25.11+) `memory_usage`. The client exposes it as
`ClickHouseSummary` on `CommandResult`/`InsertResult`
(`packages/client-common/src/clickhouse_types.ts`). `written_rows` is what an `INSERT` reports.

### ClickHouse as an engine

**F13 — the catalog is `system.*`, and it is richer than `information_schema`.** ClickHouse ships an
`INFORMATION_SCHEMA` emulation (in *two* spellings, `INFORMATION_SCHEMA` and `information_schema` —
both appear as separate rows in `system.databases`), but the native tables are the ones with the
ClickHouse-specific columns this adapter needs: `system.databases`, `system.tables`,
`system.columns`, `system.data_skipping_indices`, `system.constraints`, `system.processes`,
`system.mutations`.

**F14 — `system.tables` is a one-query answer to `describe()`, `definition()` and the tree's row
estimate at once.** Columns (from `docs/reference/system-tables/tables.mdx`): `database`, `name`,
`uuid`, **`engine`**, `is_temporary`, `metadata_modification_time`, **`create_table_query`**,
`engine_full`, `as_select`, **`partition_key`**, **`sorting_key`**, **`primary_key`**,
`sampling_key`, `unique_key`, `skipping_indices_types`, `storage_policy`,
**`total_rows` (`Nullable(UInt64)` — "the exact number of rows … if it is possible to quickly
determine")**, `total_bytes`, `total_bytes_uncompressed`, `parts`, `active_parts`, `total_marks`,
**`comment`**, `has_own_data`, `target_database`/`target_table` (a materialized view's destination),
`definer`. `create_table_query` is ClickHouse's own `CREATE` text — the `SHOW CREATE TABLE`
equivalent, with no second round trip, exactly as `sqlite_master.sql` was for P35 (D21).

**F15 — `system.columns` covers every column fact `ColumnMeta` has room for except nullability.**
`database`, `table`, `name`, **`type`**, **`position`** (1-based), **`default_kind`** (`DEFAULT` /
`MATERIALIZED` / `ALIAS`, or empty), **`default_expression`**, **`comment`**,
`is_in_partition_key`, `is_in_sorting_key`, **`is_in_primary_key`**, `is_in_sampling_key`,
`compression_codec`, `character_octet_length`, `numeric_precision`, `numeric_scale`,
`datetime_precision`, `statistics`. Nullability is not a column: it is encoded *inside* the type
string, as `Nullable(T)` — possibly nested, as in `LowCardinality(Nullable(String))` (F24).

**F16 — the finding the phase turns on: ClickHouse's primary key is not unique.**
`docs/reference/engines/table-engines/mergetree-family/mergetree.mdx`, line 200, verbatim:
*"ClickHouse does not require a unique primary key. You can insert multiple rows with the same
primary key."* The same doc (line 196) explains what it *is*: *"A sparse index allows extra data to
be read. When reading a single range of the primary key, up to `index_granularity * 2` extra rows in
each data block can be read."* `PRIMARY KEY` in ClickHouse names a prefix of `ORDER BY` for the
sparse index; it enforces nothing.

**F17 — ClickHouse has no foreign keys, and never had.** Foreign-key syntax in a `CREATE TABLE` is
**parsed and ignored** (ClickHouse PR #53864, *"Ignore foreign keys in tables definition"*, merged
for MySQL-DDL compatibility), so even a schema that *spells* an FK carries no metadata about it —
there is no `system.foreign_keys`, no reverse index, and nothing in `system.tables` or
`system.columns` that records the relationship. Unlike P35's SQLite gaps, which were "there is a
concept but no catalog", this is "there is no concept".

**F18 — ClickHouse *does* have a CHECK-constraint catalog, unlike SQLite.**
`system.constraints`: `database`, `table`, `name`, `type` (`Enum8('CHECK' = 0, 'ASSUME' = 1)`),
`expression`. So the definition view's Constraints section has real content here, and P35's D24
("CHECK constraints appear only in the Source text — SQLite has no separate catalog") does **not**
carry over.

**F19 — `UNIQUE KEY` exists, and is neither released nor usable.** `system.tables.unique_key` is in
master (F14) and ClickHouse issue #103486 (`UNIQUE KEY for ClickHouse`) is the tracking issue: it is
**open**, delivered incrementally **behind the experimental flag `allow_experimental_unique_key`**,
starting with `MergeTree` and only later `ReplicatedMergeTree`/`SharedMergeTree`, with
per-partition (not global) uniqueness scope. It promises exactly what this adapter would need —
dedup identity decoupled from `ORDER BY`, implicit UPSERT on `INSERT`, synchronous `DELETE`
visibility — which is why it is named here as the future seam (§6) rather than quietly ignored.
It is not in 26.3 LTS and nothing in P36 may depend on it.

**F20 — the only true row identity is a snapshot identity, and merges invalidate it.** MergeTree's
virtual columns (`mergetree.mdx` §Virtual columns) include `_part` (the part's name), `_part_offset`
(the row's number within the part), `_part_index`, `_part_starting_offset`, `_partition_id`,
`_part_data_version`, and — persisted across merges *only when the corresponding table setting is
enabled* — `_block_number` (`enable_block_number_column`) and `_block_offset`
(`enable_block_offset_column`). `(_part, _part_offset)` does uniquely address a physical row, and it
is selectable. It is also invalidated by any background merge, which ClickHouse performs without
asking. A page token or a mutation key built on it would, after a merge, silently address a
*different* row — strictly worse than P35's rowid (stable for the life of the row) and squarely in
the territory P35 D23 refused.

**F21 — the three mutation mechanisms, and what each one actually costs.**
- **`ALTER TABLE … UPDATE/DELETE`** (`docs/reference/statements/alter/update.mdx`,
  `…/alter/delete.mdx`) — heavyweight *mutations*: they rewrite whole column files for every
  affected part, and they are **asynchronous by default** (`mutations_sync` default `0`, i.e. the
  statement returns before anything has changed). A grid whose Commit returns and then refreshes
  would show the old value.
- **Lightweight `DELETE FROM [db.]table WHERE expr`** — *"only available for the \*MergeTree table
  engine family"*; implemented as a `_row_exists` mask; **synchronous by default**
  (`lightweight_deletes_sync`, default **2** = wait for all replicas, per
  `docs/reference/settings/session-settings/lightweight.mdx`), so on return the rows are invisible
  to subsequent queries. Requires the `ALTER DELETE` privilege. Does not work on a table with
  projections unless `lightweight_mutation_projection_mode` is changed.
- **Lightweight `UPDATE … SET … WHERE`** (25.7+, **beta**, `docs/reference/statements/update.mdx`) —
  writes a small "patch part", waits for it, and the new values are *"Immediately visible in SELECT
  queries"*. This is the one mechanism whose latency and visibility semantics actually fit a grid.
  But: *"To use lightweight updates, materialization of `_block_number` and `_block_offset` columns
  must be enabled using table settings `enable_block_number_column` and
  `enable_block_offset_column`."* Those are **per-table MergeTree settings, off by default** —
  turning them on is `ALTER TABLE … MODIFY SETTING`, a DDL change to the user's table. It also
  cannot touch key columns (*"Updating columns used in the calculation of the primary or partition
  keys is not supported"*), is limited to `MergeTree`/`ReplacingMergeTree`/`CollapsingMergeTree`/
  `VersionedCollapsingMergeTree` and their Replicated/Shared variants, and is documented as
  *"designed to update small amounts of rows (up to about 10% of the table)"* with a *"too many
  parts"* failure mode under frequent small updates — which is precisely the access pattern a
  cell-by-cell grid produces.

**F22 — no mutation reports an affected-row count the app could assert on.** `mutate()`'s contract
(`mysql-family/mutate.ts`, `sqlite/mutate.ts`) is `assertAffectedExactlyOne` — the guard that stops a
mis-keyed `UPDATE` from silently rewriting a thousand rows. `X-ClickHouse-Summary` (F12) reports
`written_rows` for an `INSERT`; for a lightweight `DELETE`/`UPDATE` it reports the *patch/mask* rows
written, not the number of user rows matched, and there is no ClickHouse statement that returns "N
rows matched your WHERE". Combined with F16 there is no way to build the guard at all: the adapter
could neither address one row nor verify it had.

**F23 — `INSERT` is ordinary, synchronous, and reports its row count.**
`INSERT INTO db.t (a, b) VALUES (…)` over the HTTP interface returns when the block is written, and
`X-ClickHouse-Summary.written_rows` is the count (F12). Nothing about the OLAP model makes an insert
exotic; it is the one write verb that maps onto this app's model unchanged.

**F24 — the type system is a string grammar, not a flat enum.** From
`docs/reference/data-types/index.mdx`: integers (`Int8`…`Int256`, `UInt8`…`UInt256`), `Float32/64`,
`Decimal(P,S)`/`Decimal32/64/128/256`, `Bool`, `String`, `FixedString(N)`, `Date`, `Date32`,
`DateTime([tz])`, `DateTime64(P[,tz])`, `Time`, `Time64`, `IPv4`, `IPv6`, `Array(T)`, `Tuple(…)`,
`Map(K,V)`, `Nested(…)`, `JSON`, `Dynamic`, `Variant(…)`, `Nullable(T)`, `LowCardinality(T)`,
`UUID`, `Enum8(…)`/`Enum16(…)`, the geo types (`Point`/`Ring`/`Polygon`/…), `QBit`,
`AggregateFunction(f, T…)`, `SimpleAggregateFunction(f, T)`, and the special types
(`Expression`, `Interval`, `Nothing`, `Set`). `Nullable` and `LowCardinality` are **wrappers**, and
they nest: `LowCardinality(Nullable(String))` is a real, common column type. Crucially, `String` is
*both* the text type and the blob type — the docs describe it as replacing `VARCHAR`, `BLOB` and
`CLOB` alike — so there is no per-column signal that distinguishes text from bytes.

**F25 — `JSONCompactStringsEachRowWithNamesAndTypes` is exactly the wire shape this app's page
builder wants.** From `docs/reference/formats/JSON/JSONCompactStringsEachRowWithNamesAndTypes.mdx`,
the output is a names row, a types row, then one JSON array of strings per data row:
```json
["date", "season", "home_team", "home_team_goals"]
["Date", "Int16", "LowCardinality(String)", "Int8"]
["2022-04-30", "2021", "Sutton United", "1"]
```
Every value is already a string, so nothing is parsed into a JS `number` and nothing loses
precision; the types row is the `ColumnDescriptor.dataType`/`typeClass` source with **no separate
catalog query**; and `NULL` is JSON `null` (`docs/reference/formats/JSON/JSON.mdx`: *"ClickHouse
supports NULL, which is displayed as `null` in the JSON output"*), distinct from the string
`"null"` — which is what `TabularPageBuilder`'s null bitset needs (`page.ts:34-40`). The client
lists this format in `StreamableJSONFormats`
(`packages/client-common/src/data_formatter/formatter.ts`), so `ResultSet.stream()` can feed the
builder row by row without materialising the whole result.

**F26 — that format does not validate UTF-8 unless asked.**
`output_format_json_validate_utf8` defaults to **`false`**, and the setting's own note says
*"it doesn't impact formats JSON/JSONCompact/JSONColumnsWithMetadata, they always validate utf8"* —
i.e. the `…EachRow…` family does **not**. A `String` column holding non-UTF-8 bytes would therefore
emit bytes that are not valid JSON, which `JSON.parse` will reject or mangle.

**F27 — the non-Strings JSON formats are not an alternative.**
`output_format_json_quote_64bit_integers` defaults to `true` (so `UInt64` arrives quoted anyway) but
`output_format_json_quote_denormals` defaults to `false`, so `NaN`/`±Inf` in a `Float64` column come
back as JSON `null` — indistinguishable from a real `NULL`. A Strings format sidesteps both.

**F28 — the lexical grammar: backtick *or* double-quote identifiers, single-quote-only strings, and
two characters that must be escaped.** From `docs/reference/syntax.mdx`:
- *"If you want to use identifiers the same as keywords or you want to use other symbols in
  identifiers, quote it using double quotes or backticks, for example, `"id"`, `` `id` ``."*
  ClickHouse's own `create_table_query` output uses backticks (F14's example:
  ``CREATE TABLE base.t1 (`n` UInt64) ENGINE = MergeTree ORDER BY n``).
- *"String literals must be enclosed in single quotes. Double quotes are not supported."*
- Escaping: `''` **or** `\'` for a single quote, and — the load-bearing part —
  *"In string literals, you need to escape at least `'` and `\` using escape codes `\'` (or: `''`)
  and `\\`."* A backslash before an unrecognised character is literal, but before `n`, `t`, `0`,
  `xHH`, `N` etc. it is an escape.
- Comments: `--`, `#!`, `# ` (line), and **nestable** `/* … */`.

**F29 — a quoted literal in `VALUES` is converted into the column's type.**
`input_format_values_interpret_expressions` defaults to **`1`**: *"For Values format: if the field
could not be parsed by streaming parser, run SQL parser and try to interpret it as SQL expression."*
So `INSERT INTO t (n) VALUES ('42')` into a `UInt32` column goes through the expression path and
converts, which is what lets this adapter use the same always-quote literal renderer every other SQL
adapter uses (D27) rather than a type-aware one.

**F30 — read-only is a server-side setting, with three levels.** `readonly = 0` (no restriction),
`1` (read queries only, and settings cannot be changed), `2` (read queries only, but settings may
still be changed except `readonly` itself). In both `1` and `2`, `INSERT`/`CREATE`/`ALTER`/`DROP`
are refused with `Code: 164 READONLY`. `2` is the level that still lets the adapter send its own
per-request format settings.

**F31 — `ORDER BY` + `LIMIT n OFFSET m` are ordinary, and the sorting key is the free one.**
Standard `LIMIT count OFFSET offset` is supported. `optimize_read_in_order` lets ClickHouse serve an
`ORDER BY` that is a prefix of the table's own sorting key straight out of the parts' existing
order, without a sort; any other `ORDER BY` is a real sort, bounded by the usual memory settings
(and failing with `MEMORY_LIMIT_EXCEEDED` rather than degrading silently). `system.tables.sorting_key`
(F14) is that expression as ClickHouse's own text.

**F32 — an exact count is cheap.** For a MergeTree table, `SELECT count() FROM t` with no predicate
is answered from part metadata, and `system.tables.total_rows` is documented as *"Total number of
rows, if it is possible to quickly determine exact number of rows in the table, otherwise NULL"* —
exact, not an estimate, and `NULL` (honestly absent) for engines that cannot answer cheaply and for
views. A filtered `count()` is a columnar scan of the predicate's columns only.

**F33 — the engine name is the object's kind.** `system.tables.engine` is the table engine without
parameters: `MergeTree`/`ReplacingMergeTree`/… for tables, **`View`** for a plain view,
**`MaterializedView`** for a materialized view, plus `Dictionary`, `Distributed`, `Log`,
`TinyLog`, `Memory`, `Null`, `Merge`, `Buffer`, `URL`, `S3`, `MySQL`, … — all of which are
`SELECT`able like any other table.

**F34 — the MySQL wire interface exists, and ClickHouse tells you not to use it.** ClickHouse serves
the MySQL protocol on port 9004 and the PostgreSQL protocol on 9005, which would in principle let
ClickHouse ride `mysql-family/` with **no new dependency at all**. The MySQL interface doc
(`docs/concepts/features/interfaces/mysql.mdx`) is explicit about the cost: *"SSL implementation
might not be fully compatible; there could be potential TLS SNI issues"*, *"A particular tool might
require dialect features … that aren't implemented yet"*, and, decisively, *"If there is a native
driver available (e.g., DBeaver), it is always preferred to use it instead of the MySQL interface."*
It also silently forces `prefer_column_name_to_alias = 1`, which *"can't be turned off and it can
lead in rare edge cases to different behavior between queries sent to ClickHouse's normal and MySQL
query interfaces."*

**F35 — the client's TLS surface is narrow, and deliberately so.** `NodeClickHouseClientConfigOptions.tls`
is `{ ca_cert: Buffer }` or `{ ca_cert, cert, key }` — there is **no `rejectUnauthorized` escape
hatch**. The only way to reach one is the `http_agent` option, which is flagged `@experimental` and
whose own doc says that when set, *"`max_open_connections`, `tls` and `keep_alive` options have no
effect"* — i.e. taking it costs F7's free-second-request property. ClickHouse's HTTPS port is 8443.

### The app seam

**F36 — `Caps` has room for every honest answer this engine needs, and `transactions` is
declared-only.** `shared/caps.ts:22-68`: `pagination` is the union
`'keyset'|'offset'|'cursor'|'token'|'offsetWindow'|'batch'`; `canInsert`/`canUpdate`/`canDelete`
exist *precisely* because `writable` alone *"can't express an adapter that supports some mutation
kinds but not others — e.g. Kafka can produce a new message (insert) but has no per-message update
or delete at all"* (`caps.ts:48-53`). `grep -rn "caps.transactions" src` matches only the eight
adapter literals; nothing reads it — the same standing this file records `cancel` had before P35
exercised it. `grep -rn "\.pagination" src/renderer src/main` matches only three lines, all
`=== 'batch'` in the stream view: `'offset'` is inert in the renderer, and the per-page
`PagePosition.strategy` is what actually drives the pager.

**F37 — the renderer's row identity is the page's primary-key columns, and a missing key is dropped
in silence.** `views/grid/pendingChanges.ts:53-63`'s `primaryKeyOf` collects *"every column in the
current page with `isPrimaryKey === true`"* and returns `null` when there are none;
`:182-198`'s `buildPlan` then does `if (key) ops.push(...)` for deletes and updates — so on a
key-less table a staged delete is marked in the gutter, Commit runs the inserts only, and the delete
**disappears with no message**. That behaviour exists today for a PK-less MySQL table; on ClickHouse
it would be the behaviour for *every* table.

**F38 — the grid's write affordances are gated on `caps.writable`, `readOnly` and `hasPrimaryKey`,
never on the three per-action flags.** `DataToolbar.vue:58-62`'s `isWritable` is
`!!caps.value?.writable && !record?.readOnly`, and its own comment says *"The 5 mutation buttons
(add/delete/preview/commit/discard) are gated on writability alone — never on whether the table has
a primary key."* `DataGrid.vue:173-181`'s `canEditTable` is `isWritable && hasPrimaryKey`, where
`isWritable` there checks only `readOnly` — no caps at all. So with `isPrimaryKey: false` on every
column, inline editing is already off for ClickHouse **by accident**, while the `− row` button and
`Delete`/`⌘⌫` stay enabled and stage ops that F37 then drops.

**F39 — the literal renderer escapes only `'`.** `mysql-family/mutate.ts:13-16` and
`sqlite/mutate.ts:14-17` are byte-identical: `` `'${value.replace(/'/g, "''")}'` ``. Correct for
MySQL (whose `\` handling the driver's own parameter binding covers on the execute path) and for
SQLite (which has no backslash escape at all). **Not** correct for ClickHouse (F28).

**F40 — `SqlDialect` is a three-member union and only `'mysql'` gets backticks.**
`views/shared/sqlIdent.ts:22` is `type SqlDialect = 'postgres' | 'mysql' | 'sqlite'`; `:25-30` is
`sqlDialectFor`; `:32-35`'s `quoteIdent` is `if (dialect === 'mysql') return backticks; return
double-quotes`. Every other consumer either gates on truthiness (`views/console/lint.ts:169`,
`if (sqlDialectFor(kind)) return lintSqlConsole`) or maps by value (`editor/languages.ts:122-132`).
`identNeedsQuoting` takes a dialect it does not yet use.

**F41 — `@codemirror/lang-sql@6.10.0` has no ClickHouse dialect, but it does export the builder.**
`dist/index.d.ts:223` exports `Cassandra, MSSQL, MariaSQL, MySQL, PLSQL, PostgreSQL, SQLConfig,
SQLDialect, SQLDialectSpec, SQLNamespace, SQLite, StandardSQL, keywordCompletionSource,
schemaCompletionSource, sql` — no ClickHouse. `SQLDialect.define(spec)` is public, and
`SQLDialectSpec` carries exactly the knobs ClickHouse needs: `keywords`, `types`, `builtin`,
`backslashEscapes`, `hashComments`, `spaceAfterDashes`, `doubleQuotedStrings`, `operatorChars`,
`specialVar`, **`identifierQuotes`** (*"The characters that can be used to quote identifiers"*, e.g.
SQLite's own is `` "`\"" ``), `caseInsensitiveIdentifiers`, `unquotedBitLiterals`.

**F42 — everything downstream of `sqlDialectFor` is dialect-neutral.**
`shared/domain/sql-split.ts` is a quote/comment-aware splitter with no dialect switch;
`shared/domain/sql-lint.ts` is lexical-only and its own header explains why it is *"Deliberately not
the Lezer SQL tree's error nodes: one grammar serves every dialect"*; `views/console/lint.ts:169`
and the grid's filter completion both gate on `sqlDialectFor(kind)` being truthy. Adding a fourth
member turns all of them on for ClickHouse with no further change.

**F43 — the accent, the tile and the mark.** `theme/tokens.css:77-88` defines thirteen accents;
`ConnectionDialog.vue:36-46` assigns cyan (postgres), blue (mariadb), teal (mysql), violet (sqlite),
green (mongodb), red (redis), amber (kafka), magenta (sqs), olive (s3). **Free: `orange` `#d1966d`,
`indigo` `#979fdd`, `grey` `#9fa5ac`.** `EngineIcon.vue` is a chain of `v-if="kind === '…'"` with no
fallback — an unknown kind renders an **empty `<svg>` with no error**, in the picker, the tree and
the connection rail alike — and its header (`:5-9`) asserts the marks are *"1:1 with
parts/_icons.html's i-* engine symbols"*, which today has `i-sqlite` and its eight siblings.

**F44 — the type glossary lowercases and strips the first parenthesised group.**
`project/typeGlossary.ts:178-184`'s `normalize()` does `.toLowerCase().replace(/\([^)]*\)/, '')`, so
`DateTime64(3, 'UTC')` → `datetime64`, but `LowCardinality(String)` → `lowcardinality` and
`Nullable(Int32)` → `nullable` — the wrapper survives and the inner type is thrown away. The file
already has the right shape for the fix: `typeDescription` recurses on Postgres's `[]` array suffix
(*"describe by the element type rather than listing every possible array shape"*), which is exactly
what a `Nullable(T)`/`LowCardinality(T)` wrapper needs.

**F45 — `grouping.ts` needs nothing.** `GROUPED_KINDS` (`:64-73`) already folders `view`, `matview`,
`sequence`, `function` and `consumerGroup`; `isLeafKind` (`:110-112`) already covers
`table`/`view`/`matview`. The only per-connection-kind label override is MariaDB/MySQL's
`function` → "Routines", and ClickHouse has no per-database routine level to show.

**F46 — `ObjectDefinition.sections` is a generic name/value list, unused by every SQL engine so
far.** `shared/domain/definition.ts:40-51`: P23 added it for a Kafka topic's partitions, a consumer
group's members and an SQS queue's attributes, rendered by `views/definition/PropertiesSection.vue`,
and its own doc says *"[] for postgres/mariadb/mongo"*. `constraints` is
`'primaryKey'|'unique'|'foreignKey'|'check'|'exclusion'`.

**F47 — `@testcontainers/clickhouse` exists, at the exact version this repo already pins.**
npm: `@testcontainers/clickhouse@12.1.0`, *"ClickHouse module for Testcontainers"*, dependency
`testcontainers: ^12.1.0` — which is `package.json`'s own pinned `testcontainers` version, and the
same version as the five `@testcontainers/*` presets already installed. From its source
(`packages/modules/clickhouse/src/clickhouse-container.ts`): `ClickHouseContainer` takes the image as
a **required** constructor argument (no default), exposes 9000 and 8123, sets
`Wait.forHttp("/", 8123).forResponsePredicate(r => r === "Ok.\n")` and a 120 s startup timeout, and
raises `nofile` ulimits to 262144 to avoid *"Too many open files"*. `withUsername`/`withPassword`/
`withDatabase` set `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/`CLICKHOUSE_DB`.
`StartedClickHouseContainer` exposes `getPort()`, **`getHttpPort()`**, `getUsername()`,
`getPassword()`, `getDatabase()`, `getHttpUrl()`, `getClientOptions()`, `getConnectionUrl()`.

**F48 — the version to pin.** ClickHouse uses calendar versioning (`YY.M.patch.build`) and
designates an LTS twice a year, in **March and August**, supported for a year. **26.3 is the current
LTS** (26.3.9.8-lts, April 2026); 25.8 is the prior one. `clickhouse/clickhouse-server:26.3` is
therefore the pin with the longest remaining support window that is unambiguously released.

**F49 — the demo stack is eight compose services and eight `seed.sh` stanzas**, plus P35's
service-less `sqlite/` directory. `scripts/demo-dbs/docker-compose.yml` has `postgres`, `mariadb`,
`mysql`, `mongo`, `redis`, `kafka`, `sqs` (LocalStack) and `s3`, each with a named volume.

**F50 — the DB-suite harness discipline.** Every `tests/db/*.spec.ts` except `sqlite.spec.ts` opens
with `if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE)`
(`support/docker.ts`), and every container fixture is memoized per process with a `stop()` that
resets the memo — `support/mysql.ts:196-201` explains why: *"Playwright's `workers:1` config runs
every UI spec file sequentially in the same worker process, sharing this module's state."*
`support/docker.ts` also auto-resolves Colima's `DOCKER_HOST`. `tsconfig.node.json` typechecks
`tests/db/support/**`.

## 2. Shapes introduced in this plan

```ts
// src/shared/protocol/page.ts — MODIFIED. The one shared-protocol change in this phase (D28).
// A column the engine computes and refuses on INSERT: ClickHouse's MATERIALIZED and ALIAS columns
// (F15), and — set in the same commit, since a one-engine flag would be special pleading —
// SQLite's VIRTUAL/STORED generated columns (P35 F18). The renderer's insert paths skip these the
// same way duplicateAsInsert already skips primary-key columns.
export interface ColumnDescriptor {
  name: string;
  dataType: string;
  typeClass: TypeClass;
  nullable: boolean;
  isPrimaryKey: boolean;
  generated: boolean;   // NEW — zod: z.boolean().default(false)
}
```

```ts
// src/renderer/views/shared/sqlIdent.ts — MODIFIED. A set, not an if/else (D29).

export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'clickhouse';

/** Dialects that spell a quoted identifier with backticks. ClickHouse accepts double quotes too
 *  (F28), but backticks are what its own SHOW CREATE TABLE emits, so they are what the app emits. */
const BACKTICK_DIALECTS: ReadonlySet<SqlDialect> = new Set(['mysql', 'clickhouse']);
```

```ts
// src/engine/adapters/clickhouse/client.ts — NEW. There is no pool to manage and no per-database
// handle: one ClickHouseClient, whose own agent holds up to max_open_connections sockets (F7), and
// the database is a per-request parameter rather than a connection property (D5).

export interface ClickHouseHandle {
  readonly client: ClickHouseClient;      // @clickhouse/client, loaded through a dynamic import
  readonly url: string;                   // the resolved http(s)://host:port, for ConnectInfo
  readonly defaultDatabase: string;
  readonly readOnly: boolean;
}

/** Builds the client config from fields mode (host/port/database/username/password) or URI mode
 *  (`clickhouse://user:pass@host:8123/db`), applies D6's settings block and D7's `readonly: 2`,
 *  then probes with one `SELECT version()` so a bad host/credential fails at connect() (D4). */
export async function openClient(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): Promise<ClickHouseHandle>;
```

```ts
// src/engine/adapters/clickhouse/query.ts — NEW. The one place a statement leaves the process.

export interface RunOptions {
  /** The database to resolve unqualified names against; omitted for a fully-qualified statement. */
  database?: string;
  /** D8: the query_id KILL QUERY will match on. The caller registers it before awaiting. */
  queryId: string;
}

/** Row-returning path. Sends the statement with FORMAT
 *  JSONCompactStringsEachRowWithNamesAndTypes (D14), streams the names row, the types row and
 *  then the data rows, and hands each raw string row to `onRow`. Calls ctx.setCommand() with the
 *  statement text alone — never with the FORMAT clause the client appends (F4), and never with
 *  the settings, which travel as URL parameters. */
export async function runQuery(
  h: ClickHouseHandle, ctx: OpCtx, sql: string, opts: RunOptions,
  onHeader: (names: string[], types: string[]) => void,
  onRow: (values: (string | null)[]) => void,
): Promise<void>;

/** Non-row path (INSERT, and the console's own DDL) — `command()`, returning
 *  X-ClickHouse-Summary.written_rows (F12). */
export async function runCommand(
  h: ClickHouseHandle, ctx: OpCtx, sql: string, opts: RunOptions,
): Promise<{ writtenRows: number }>;

/** The value -> SQL literal codec. Escapes `\` first and then `'` — F28 requires both, and every
 *  other SQL adapter in this tree escapes only the quote (F39). */
export function literalFor(value: string | null): string;
```

```ts
// src/engine/adapters/clickhouse/catalog.ts — NEW.
export interface ReadTarget {
  qualifiedName: { schema: string; table: string };
  columns: ColumnMeta[];
  /** F15: MATERIALIZED/ALIAS columns are readable (the adapter never emits SELECT *) but refuse
   *  an INSERT. Surfaced as ColumnDescriptor.generated (D28). */
  generatedColumns: ReadonlySet<string>;
  engine: string;                 // F33 — 'MergeTree', 'View', 'MaterializedView', 'Dictionary', ...
  /** F14/F31: ClickHouse's own sorting-key expression text, used verbatim as the default ORDER BY
   *  when the user asked for no sort (D21). '' for an engine with no sorting key. */
  sortingKey: string;
  primaryKeyExpression: string;   // F14 — shown, never used as row identity (D23)
  partitionKey: string;
  totalRows: number | null;       // F32 — exact when ClickHouse can answer cheaply, else null
  comment: string | null;
}
```

```sql
-- tests/db/fixtures/0010_clickhouse_seed.sql — NEW. A port of 0008_mysql_seed.sql, not a copy
-- (D36): the same object graph so the same scenarios assert the same things, with every
-- divergence a documented engine difference.
--   PRIMARY KEY / FOREIGN KEY / UNIQUE / AUTO_INCREMENT -> ORDER BY, and no FK at all (F16, F17)
--   ENGINE=InnoDB                                        -> ENGINE = MergeTree / ReplacingMergeTree
--   no CREATE SEQUENCE / FUNCTION / PROCEDURE            -> ClickHouse has no per-database routines
--   VARCHAR/TEXT/BLOB                                    -> String, LowCardinality(String),
--                                                           FixedString(N), Nullable(String)
--   `weird``name` / `Order Items`                        -> unchanged; ClickHouse uses backticks too
-- and six tables that exist only here, each earning a scenario:
--   dup_keys        (ReplacingMergeTree, two rows with an identical ORDER BY tuple — F16's proof)
--   wide_types      (Array/Tuple/Map/Enum8/UUID/IPv6/Decimal128/DateTime64/LowCardinality(Nullable))
--   generated_cols  (a DEFAULT, a MATERIALIZED and an ALIAS column — F15/D28)
--   commented       (a table comment and per-column comments — F14/F15)
--   no_sorting_key  (ENGINE = Memory: no sorting key, no total_rows — D21/D17's null paths)
--   big_rows        (1,000,000 rows from numbers(1000000) — one INSERT ... SELECT, no chunking)
```

## 3. Decisions

### Topic A — the driver and the wire

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`@clickhouse/client@1.23.1`, added as a production dependency, pinned exact like every other driver in `package.json`.** No `@clickhouse/client-web`, no `chdb`, no HTTP-by-hand. | F1: it is the official client, pure TypeScript, with one dependency-free transitive package — so it costs nothing P32's `@confluentinc/kafka-javascript` costs (no NAN/N-API addon, no ABI, no `electron-rebuild`, no `asarUnpack`, no `.cache/native`). F2: it is HTTP-only, which is also the only JS option; there is no maintained native-protocol JS client to weigh against it. `@clickhouse/client-web` is the Fetch/WebStreams build for browsers and Cloudflare Workers — the engine is a Node `utilityProcess`, so the Node build is the correct one. Writing HTTP by hand to avoid one dependency would mean re-implementing streaming, keep-alive, compression, error parsing and summary headers, which is the trade P34 D2 already refused in the other direction. |
| D2 | **Rejected: riding `mysql-family/` over ClickHouse's MySQL wire port (9004), which would add no dependency at all.** | F34 is the finding, and ClickHouse's own doc is the argument: *"If there is a native driver available … it is always preferred to use it instead of the MySQL interface."* Concretely, the compatibility layer would cost every single thing this plan is built on — `system.*`'s ClickHouse-specific columns would arrive through an `information_schema` emulation, the type strings would be MySQL-mapped rather than ClickHouse's own (killing D15's typeClass work and D14's types-row shortcut), there would be no `query_id` to `KILL QUERY` on (D8), no per-request `clickhouse_settings` (D6, D7), and a documented, unswitchable `prefer_column_name_to_alias = 1` behaviour difference from the real interface. Zero dependencies is not worth an emulation of the engine we are trying to support. |
| D3 | **Loaded with `await import('@clickhouse/client')` inside `client.ts`, behind `registry.ts`'s existing lazy per-kind loader.** | `registry.ts:5-11`'s comment is explicit that eager loading of all eight adapters cost *">100MB of the engine's baseline RSS"* (P12's lever L-A). A ninth driver joins the same discipline; the registry line is the only importer. |
| D4 | **`connect()` opens the client, then probes with one `SELECT version(), currentDatabase(), timezone()`.** The handle is assigned to the instance **before** the probe runs. `ConnectInfo.serverVersion` is `` `ClickHouse ${version}` ``; `details` carries `url`, `database` and `timezone`. | The client is lazy — `createClient()` opens no socket, so a wrong host or a wrong password would otherwise surface on the first tree expansion rather than at connect. P13 D1's rule is the assignment order: *"assigned before anything is opened, not after the probe succeeds — the handle must be reachable by `disconnect()` from the instant … a socket could have been opened"* (`mysql-family/index.ts`'s own comment). `timezone()` is in `details` because ClickHouse renders `DateTime` in the server's session timezone and a user staring at a shifted timestamp deserves to see which one. |
| D5 | **One `ClickHouseClient` per connection. No `ConnectionSet`, no per-database client, no LRU.** The database is passed per request (`QueryParams`' own database resolution) or written into the statement as a qualified `` `db`.`table` ``. | F7: the client owns an agent with `max_open_connections` sockets, so concurrency is already handled and a second concurrent request (D8's `KILL QUERY`) is free. `postgres/client.ts`'s `ClientSet` and `mysql-family/client.ts`'s `ConnectionSet` exist because both engines bind a connection to one database *and* because `KILL QUERY`/`pg_cancel_backend` need a second connection with a known backend id — ClickHouse has neither constraint. Deleting a whole class of state is the right answer, not an oversight. |
| D6 | **A fixed `clickhouse_settings` block is applied at client construction and written out explicitly, defaults included:** `default_format: 'JSONCompactStringsEachRowWithNamesAndTypes'` (D19), `output_format_json_validate_utf8: 1` (D16), `show_table_uuid_in_table_create_query_if_not_nil: 0` (its own default, D21), `date_time_output_format: 'simple'`. Nothing else. **No `mutations_sync`, no `lightweight_deletes_sync`, no `enable_block_number_column`, no `max_execution_time`, no `max_result_rows`.** | The same reasoning P35 D6 gave for writing down `node:sqlite`'s defaults: an unstated default is one a later server release can move under us, and this list is short enough to state. The absences are the load-bearing half — `enable_block_number_column` is a *table* setting whose only purpose here would be to unlock lightweight `UPDATE` (F21), and turning it on would be Kira altering a user's production table (§0); `max_execution_time` would impose a limit the user never asked for on their own console query. `date_time_output_format: 'simple'` pins the `YYYY-MM-DD hh:mm:ss` spelling the cell editor's timestamp pane (§8.6) knows how to parse. |
| D7 | **A read-only connection sends `readonly: 2` on every data, console and mutation request — and never on the `KILL QUERY` request.** This is in addition to `mutate()`'s existing guard. | F30: `readonly: 2` makes the connection's read-only flag true *at the server*, so a write is refused by ClickHouse (`Code: 164`) before it reaches a table, not merely greyed out in the UI — the §8.13 promise that *"the guard is enforced in the engine, not just greyed out"*, taken one level further, exactly as P35 D7 did by opening the file `readOnly: true`. `2` rather than `1` because `1` also forbids changing settings, which would reject D6's own format block. Excluded from the `KILL` request because `readonly` restricts a session to `SELECT` and `KILL QUERY` is not one — and cancelling your own query is not a write to user data, so a read-only connection keeps its stop button. |
| D8 | **`caps.cancel = true`. Every statement carries a `query_id` of `` `kira-${opId}-${seq}` ``; `cancel(opId)` issues `KILL QUERY WHERE query_id = '<current>' SYNC` and returns whether `kill_status` came back `finished`/`waiting`. `ctx.signal` is *also* passed as `abort_signal`, but is never the cancel.** A `runningByOp` map tracks the current id per op with the same release-closure identity check `mysql-family/index.ts:388-397` uses. | F8 is why the signal alone will not do — the server keeps working after the socket dies, which is the exact behaviour §5.1 calls lying. F9/F10 are why the real thing is cheap: the adapter *chooses* the id, so there is no window between "the query started" and "we know how to kill it", which is the race MySQL's `TrackQuery` exists to close. F7 is why there is no side connection. The `-${seq}` suffix is the multi-statement case (console *Run all*, a mutate batch): one `opId`, several sequential statements, and killing the wrong one would be worse than killing none. `SYNC` because a cancel that returns before the query has actually stopped would let the UI re-enable its controls too early. |

### Topic B — the connection shape

| # | Decision | Rationale |
|---|----------|-----------|
| D9 | **ClickHouse is an ordinary network kind: host, port, database, username, password, fields *and* URI mode. It is in neither `AWS_STYLE_KINDS` nor `FILE_KINDS`, and `connection.ts`'s `superRefine` needs no new arm.** | It is a server with credentials — the first genuinely conventional new kind since P34. The interesting shapes in this phase are all inside the adapter, and the connection dialog should stay boring. This is worth stating because P33 and P35 both had to widen `connection.ts`, and a reader arriving from those two would expect a third exception. |
| D10 | **`DEFAULT_PORT.clickhouse = 8123`** — the HTTP interface, not 9000. | F2: the client is HTTP-only, so 9000 (the native TCP port) would be a port nothing in this app can ever speak to. 8123 is also the port `@testcontainers/clickhouse` health-checks on (F47), so the fixture and the dialog agree by construction. A TLS deployment uses 8443 and the user types it (D12). |
| D11 | **URI mode is supported and `uri.ts` needs no change.** The form is `clickhouse://user:pass@host:8123/db`. `canRoundTripToFields` stays Postgres-only, so a URI-mode ClickHouse connection cannot be switched back to Fields — the same standing behaviour MariaDB and MySQL have. | `formatConnectionUri` already uses `input.kind` as the scheme for every kind but Postgres (`uri.ts:36`), and `clickhouse://` is the conventional spelling (it is what `clickhouse-connect`, the JDBC driver's `jdbc:clickhouse://`, and every ClickHouse ORM use). *Copy URI* runs for every kind (`project/menus.ts:174-185`), so this has to be right whether or not the dialog offers URI mode. The adapter translates `clickhouse://host:8123` into the client's own `http://host:8123` — the app's URI is the app's, and the driver's `url` is an implementation detail behind it. |
| D12 | **TLS is `options.sslmode` with exactly two meaningful values: absent/`disable` → `http://`, `require`/`verify-full` → `https://` with the system trust store. Anything else logs a warning and is ignored, mirroring `mysql-family/client.ts:58-67` exactly. Custom CA, mutual TLS and skipping verification are out of scope (§6).** | F35: the client's `tls` option takes only `ca_cert`/`cert`/`key` Buffers and has **no** `rejectUnauthorized` escape hatch; the only route to one is `http_agent`, which is `@experimental` and whose own documentation says it disables `max_open_connections`, `tls` *and* `keep_alive` — i.e. taking it would cost D8 its free second socket. Reusing the `sslmode` key rather than inventing `secure`/`tls` keeps one vocabulary across every server-backed SQL engine in the app. `require` and `verify-full` collapse to the same behaviour here and the plan says so rather than pretending to a distinction the client cannot make. |
| D13 | **`options` carries nothing else.** No `session_id`, no `role`, no `compression`, no `application` override, no arbitrary `clickhouse_settings` passthrough. `application: 'kira-studio'` is set unconditionally. | `session_id` would make the server serialize every request from this connection through one session, turning D5's free concurrency (and D8's `KILL QUERY`) into a queue — a real footgun for a value that buys nothing here. A `clickhouse_settings` passthrough from `options` is attractive and wrong for one specific reason: `options` round-trips through the connection URI and *Copy URI* (`connection.ts:66-68` gives the identical reason for keeping `preconnect` out of `options`), so a pasted URI could silently set `readonly = 0` on a connection the user marked read-only. `application` is the ClickHouse counterpart of `mysql-family/client.ts:29`'s `connectAttributes: { program_name: 'kira-studio' }` and lands in `system.query_log`, which is what makes scenario 7's server-side cancel assertion checkable. |

### Topic C — the adapter: catalog, read, definition

| # | Decision | Rationale |
|---|----------|-----------|
| D14 | **`engine/adapters/clickhouse/` stands alone, with §11's fixed shape and real content in every file** — `index.ts`, `caps.ts`, `client.ts`, `query.ts`, `catalog.ts`, `read.ts`, `mutate.ts`, `console.ts`, `definition.ts`, `errors.ts`. The only shared code is `adapters/sql-text.ts`, and only three of its five exports are used (`buildOrderBy`, `requestFingerprint`, `hexPreview` — never `buildKeysetPredicate`/`encodePageToken`, since there is no keyset here, D20). | P34's `mysql-family/` "family" exists because two engines share one wire protocol and one driver (P34 F1-F3). ClickHouse shares neither with anything in this tree — different driver, different transport (HTTP vs a binary wire protocol), different catalog (`system.*` vs `information_schema` vs pragmas), different type grammar, different concurrency model. D2 already refused the one route that would have made it a family. The unused half of `sql-text.ts` is called out here so nobody later "notices" the keyset helpers are missing and wires them in. |
| D15 | **Tree: connection → one node per `system.databases` row → tables (ungrouped), `View` and `MaterializedView` foldered by the renderer's existing `GROUPED_KINDS`.** `INFORMATION_SCHEMA` and `information_schema` are hidden; **`system` is kept**. `engine === 'View'` → `view`, `engine === 'MaterializedView'` → `matview`, everything else → `table`. `is_temporary` rows are hidden. | F33 gives the kind mapping for free and F45 means the renderer needs nothing. The two `information_schema` spellings are a compatibility emulation of a catalog `system.*` already provides — pure duplicate noise beside it, hidden the same way `mysql-family/catalog.ts:18`'s `SYSTEM_SCHEMAS` list hides MySQL's four. `system` is deliberately *not* hidden, breaking that precedent on purpose: it is the catalog this adapter itself reads from, it is genuinely browsable (`system.query_log`, `system.parts`, `system.mutations` are things a ClickHouse user opens on purpose), and hiding it would be hiding the thing the app is built on. It is a collapsed database node and P28's checkbox filter can hide it per connection. Raised as open question 2. |
| D16 | **The read wire format is `JSONCompactStringsEachRowWithNamesAndTypes`, with `output_format_json_validate_utf8: 1`.** Every value arrives as a string or JSON `null`; the types row is the only source of `ColumnDescriptor.dataType`. | F25: this is, almost exactly, the shape `createTabularPageBuilder` was designed for — arrays of already-stringified values plus a null marker that is distinguishable from an empty string, which is what `page.ts:34-40`'s bitset requires. It also removes an entire class of bug: nothing goes through a JS `number`, so a `UInt64` above `Number.MAX_SAFE_INTEGER` needs no `setReadBigInts` equivalent (P35 D3's whole problem does not exist here) and a `Decimal128` keeps every digit. F27 is why the non-Strings variants lose: `NaN`/`Inf` would arrive as JSON `null`, indistinguishable from a real `NULL`. F26 is why the UTF-8 setting is not optional: this format is *not* one of the always-validating ones, so a `String` column holding non-UTF-8 bytes would emit a response that is not valid JSON at all. Turning validation on replaces those bytes with U+FFFD — a lossy path, and the same lossy path `mysql-family/query.ts:83`'s `field.string()` and SQLite's own TEXT decode (P35 F22) already have — commented as such in the code. |
| D17 | **`typeClassFor` parses ClickHouse's type grammar rather than matching prefixes: unwrap `Nullable(…)` and `LowCardinality(…)` (recursively, in either nesting order), then classify the inner name.** `Int*`/`UInt*`/`Float*`/`Decimal*`/`Bool`→`number` (`Bool` → `boolean`); `Date`/`Date32`/`DateTime`/`DateTime64`/`Time`/`Time64`→`temporal`; `String`/`FixedString`/`UUID`/`IPv4`/`IPv6`/`Enum8`/`Enum16`→`text`; `JSON`/`Dynamic`/`Variant`/`Array`/`Tuple`/`Map`/`Nested`/`Point`/`Ring`/`Polygon`/`MultiPolygon`→`json`; `AggregateFunction`/`SimpleAggregateFunction`/`Nothing`/`Interval`/anything unrecognised→`other`. **Nullability comes from the same parse** (`Nullable(` present anywhere in the wrapper chain). | F24 is why a prefix match will not do: `LowCardinality(Nullable(String))` starts with neither `String` nor `Nullable`, and MariaDB's `typeClassFor` (`mysql-family/read.ts:31-43`) is entirely prefix-based. The controversial calls, stated: **`String` → `text`, not `binary`**, because ClickHouse's own docs describe `String` as replacing `VARCHAR`, `BLOB` *and* `CLOB` alike (F24) — there is no per-column signal, and guessing `binary` would put every text column behind the cell editor's hex pane. **The composite and semi-structured types → `json`**, because ClickHouse renders `Array`, `Tuple`, `Map` and the geo types in JSON output as JSON arrays/objects, so the cell editor's JSON beautify pane is already correct for them — this is the P35 D21 judgement (three "sugar" cases where the storage class and the useful rendering differ) applied to five families instead of three. **`Enum8`/`Enum16` → `text`** because the JSON Strings format emits the enum's *name*, not its numeric value. `binary` is never produced: ClickHouse has no type that is unambiguously bytes, so claiming one would be less honest than `text` plus F26's replacement-character note. |
| D18 | **`describe()` is three queries against `system.*` and returns `primaryKey: null`, `foreignKeys: []` and `referencedBy: []` for every object.** Columns and `generated` come from `system.columns`; `rowEstimate`, `comment` and the engine facts from `system.tables`; `indexes` from `system.data_skipping_indices` mapped as `{ name, columns: [expr], unique: false, primary: false, method: type }`, plus **one synthetic entry for the sparse primary index** named after the table, with `primary: true`, `unique: false` and `method: 'sparse (primary index)'`. | F16/F17 are the two nulls, and both are structural rather than "not implemented yet": `primaryKey` is `null` because a non-unique key handed to `views/grid/pendingChanges.ts:53` is a loaded gun (F37, D23), and the FK arrays are empty because the *concept* does not exist (F17) — not because the catalog is missing, which is the SQLite-shaped gap P35 had. `unique: false` on every index entry is the same honesty: a ClickHouse skipping index is a pruning aid, not a constraint. The synthetic primary entry exists because otherwise a user looking at a ClickHouse table in the definition view would see nothing at all about its sorting key, which is *the* thing that determines how the table behaves; `method` names what it is so the row cannot be misread as a B-tree PK. |
| D19 | **`describe()`, `definition()` and `count()` never issue more than the queries above, and every column value they read is bound as a ClickHouse query parameter (`{db:String}`, `{tbl:String}`), never interpolated.** | Adapter rule 7 (`adapter.ts:49-53`), and the catalog is where interpolation is most tempting because the values *are* identifiers. `system.*` filtering is a plain `WHERE database = {db:String} AND table = {tbl:String}` — a string comparison, so a real bound parameter works, exactly as SQLite's table-valued pragma functions did (P35 F17). The only place an identifier is ever emitted as text is `read()`/`count()`/`mutate()`'s relation and column names, all of which came out of a catalog query in the same op and go through `quoteIdent`. |
| D20 | **`caps.pagination = 'offset'`, and `read()` returns `strategy: 'offset'` unconditionally. A cursor in `after`/`before` mode is `E_UNSUPPORTED` with a message naming the reason. No page tokens are ever minted.** ClickHouse is the app's first *tabular SQL* adapter without keyset paging. | F16: keyset needs a unique total order, and ClickHouse's sorting key is explicitly not unique — a strict `>` predicate would **silently skip** every row that ties with the boundary row, and a `>=` would repeat them. Neither failure is visible to the user, which is what makes it unacceptable rather than merely imperfect. F20 is the alternative that was considered and rejected: `(_part, _part_offset)` *is* unique within a snapshot, but any background merge (which ClickHouse performs unasked) renews part names and offsets, so a token minted before a merge would silently address a different row afterwards — strictly worse than P35's rowid, which is stable for the life of the row. F19 is the future: when `UNIQUE KEY` ships un-flagged, `system.tables.unique_key` is already the column to read, and this decision becomes revisitable in one place. F36 confirms the cost is contained — nothing in the renderer branches on `caps.pagination` except the stream view's `'batch'` check, and a PK-less MySQL table already exercises the offset-only path end to end. |
| D21 | **When the request carries no sort, `read()` orders by `system.tables.sorting_key`'s own expression text, verbatim.** No sorting key (a `Memory`/`Log` table, a view) means no `ORDER BY` at all, and a `notes`-level caveat is recorded in the plan rather than invented in the UI. | An unordered `LIMIT/OFFSET` is not deterministic across pages, so offset paging (D20) without a default order would let page 2 repeat rows from page 1 — the failure D20 refused for keyset, reintroduced by omission. F31 is why the *sorting key* specifically: it is the one `ORDER BY` ClickHouse can serve straight out of the parts' existing order under `optimize_read_in_order`, so the honest default is also the free one. Using ClickHouse's own expression string rather than reassembling a column list from `is_in_sorting_key` is the "asked, never imitated" position (`mysql-family/definition.ts:97-101`'s stance on `SHOW CREATE TABLE`): a sorting key can be an expression (`ORDER BY (toYYYYMM(d), id)`), and re-deriving `(d, id)` from the flags would be a different, slower order that ClickHouse could no longer read in place. Stated plainly because it is still not a *total* order — duplicate sorting-key values tie arbitrarily, and §5.1's ClickHouse row says so. |
| D22 | **`definition()` returns `system.tables.create_table_query` verbatim as one statement, `origin: 'server'`; `constraints` comes from `system.constraints` (`CHECK` and `ASSUME`); and `sections` (P23's generic name/value list) carries a **Table** block: Engine, Sorting key, Primary key, Partition key, Sampling key, Total rows, Total bytes, Parts, Storage policy, Comment.** `notes` states, in one sentence each, that ClickHouse's `PRIMARY KEY` is a sparse index rather than a uniqueness constraint, and that ClickHouse has no foreign keys. | F14: `create_table_query` *is* the engine's own `CREATE` text, so this is P35 D24's `sqlite_master.sql` position with a different column name — no `SHOW CREATE TABLE` round trip, nothing composed. F18 is the pleasant surprise: unlike SQLite, ClickHouse *does* have a CHECK catalog, so the Constraints section has real content and P35 D24's "there is no catalog, see the Source text" note does not carry over. F46 is the reuse: `sections` has been dead for every SQL engine since P23 shipped it for Kafka, and a ClickHouse table's engine/sorting-key/partition-key facts are exactly the name/value shape it was built for — the alternative was inventing a SQL-specific field for data `PropertiesSection.vue` already renders. `show_table_uuid_in_table_create_query_if_not_nil: 0` is pinned in D6 so the returned text is re-executable rather than carrying an Atomic-database UUID; scenario 19 is the guard, and if a UUID clause appears anyway it stays verbatim with a `notes` line rather than being edited out (Adapter rule 4). |

### Topic D — the write story (the plan's central question)

| # | Decision | Rationale |
|---|----------|-----------|
| D23 | **`canInsert: true`, `canUpdate: false`, `canDelete: false`, `writable: true`. `mutate()` accepts only `insert` ops; an `update` or `delete` op is `E_UNSUPPORTED` with a message that names the reason ("ClickHouse tables have no unique row key: a MergeTree primary key is a sparse index, not a constraint, so a row cannot be addressed unambiguously"). `preview()` refuses the same ops the same way.** | F16 is the whole argument, and it is the engine's own sentence: *"ClickHouse does not require a unique primary key. You can insert multiple rows with the same primary key."* Every update/delete path in this app is built on the opposite assumption — `pendingChanges.ts:53`'s `primaryKeyOf`, `mutate.ts`'s `assertKeyIsPrimaryKey`, and `assertAffectedExactlyOne`, which exists *specifically* to catch a key that matched more than one row. F22 removes the last fallback: ClickHouse reports no matched-row count, so the adapter could not even detect that it had hit ten rows instead of one. F20 rules out a substitute identity. This is not a gap to fill later: it is `kafka/caps.ts:26-29`'s exact shape (*"these two stay `false` permanently, not 'not yet implemented'"*) reached for a structural reason, and it is what §5.1's *"the capability is absent … rather than lying"* rule looks like applied to writes instead of to cancellation. |
| D24 | **Rejected, with reasons recorded here so the question is not reopened by guesswork: lightweight `UPDATE`, lightweight `DELETE`, and `ALTER TABLE … UPDATE/DELETE`.** | Each fails for its own reason (F21). **`ALTER TABLE … UPDATE/DELETE`**: `mutations_sync` defaults to `0`, so the statement returns before anything has changed — Commit would report success and the grid's refresh would show the old value; and even set to `2` it rewrites whole column files per affected part, which is a catastrophic response to editing one cell. **Lightweight `UPDATE`**: it is the only mechanism whose latency and visibility actually fit a grid (it waits for the patch part and the new value is *"Immediately visible in SELECT queries"*), but it requires `enable_block_number_column` and `enable_block_offset_column` **as table settings**, off by default — so Kira would have to `ALTER TABLE … MODIFY SETTING` a user's production table to make a cell editable, which §0's ground rule forbids outright. It is also documented as beta, cannot touch key columns, is limited to four engines, and warns about *"too many parts"* under frequent small updates, which is the exact access pattern a cell-by-cell grid produces. **Lightweight `DELETE`** is the closest call — it is synchronous by default (`lightweight_deletes_sync = 2`) and the rows really are gone from subsequent queries when it returns — but it is still `DELETE FROM t WHERE <predicate>`, and with no unique predicate available (F16) the honest description of what the button would do is "delete every row that looks like this one". A delete that sometimes removes six rows is worse than no delete button. |
| D25 | **`caps.transactions = false`.** | ClickHouse's transactions are an experimental feature behind `allow_experimental_transactions`, and `mutate()` here executes exactly one `INSERT` per op anyway (D26), so there is nothing to wrap. F36 notes nothing reads the flag today — which is exactly why it must be set truthfully now, while the reason is in front of us. |
| D26 | **`mutate()` executes one `INSERT INTO db.t (cols) VALUES (…), (…), …` per plan — every staged insert row in a single multi-row `VALUES` statement — and returns `X-ClickHouse-Summary.written_rows` as `affectedRows`. There is no `BEGIN`/`COMMIT`.** `preview()` renders the identical statement. | F23: an `INSERT` is ordinary and synchronous, and F12 gives a real row count to return, so `MutationResult.affectedRows` is honest rather than assumed. One statement rather than one per row because ClickHouse is explicitly hostile to many small inserts (F21's *"too many parts"*), and because with no transaction (D25) a per-row loop could leave a plan half-applied — a single multi-row `VALUES` is atomic per block, which is the strongest all-or-nothing this engine offers and therefore the honest reading of `adapter.ts:108-113`'s *"one transaction"* here. Order (`delete`, `update`, `insert`) is moot when only inserts survive D23. |
| D27 | **`literalFor()` escapes `\` first and then `'`, and is used on *both* the preview path and the execute path.** No query parameters. | F28: *"In string literals, you need to escape at least `'` and `\`"* — F39 shows every existing adapter escapes only the quote, correct for their engines and wrong here, so this is a real one-line difference that a copy-paste port would get wrong and no test would catch until a Windows path or a regex landed in a cell. Backslash first, because escaping the quote into `\'` and *then* escaping backslashes would double the escape. Literals on both paths rather than parameters because §8.14 requires *Preview command* to show *"the exact statements the pending changes will execute"*, and ClickHouse's HTTP interface has no positional placeholder: its `{name:Type}` parameters need a declared type per placeholder (F3), which the adapter would have to guess for `Nullable(Array(Enum8(…)))` and would simply move the escaping problem onto the parameter's own wire encoding. F29 is what makes the always-quote renderer (the same one every other adapter uses) correct here: `input_format_values_interpret_expressions` defaults to `1`, so `'42'` in a `UInt32` column is converted rather than rejected. Scenario 41 is the guard, with a value containing `'`, `\`, `\n`, a NUL-adjacent control character and non-ASCII text. |
| D28 | **`ColumnDescriptor` gains `generated: boolean` (zod `.default(false)`), and the renderer's three insert paths skip a generated column the way `duplicateAsInsert` already skips a primary-key one.** ClickHouse sets it for `default_kind ∈ {MATERIALIZED, ALIAS}`; **SQLite sets it in the same commit** for `table_xinfo.hidden ∈ {2, 3}`. This is the one shared-protocol change in P36, and it retires P35 D38's "no protocol change" claim explicitly rather than quietly. | F15: a `MATERIALIZED`/`ALIAS` column is readable (this adapter never emits `SELECT *`, so it selects them by name and they come back) but refuses an `INSERT`. F38 + `pendingChanges.ts:155-162` is the collision: `+ row` stages *every* page column with a `null`, so an insert into any ClickHouse table with a MATERIALIZED column would fail — and since `preview()` is synchronous and catalog-free by contract (`adapter.ts:102-105`), the adapter cannot filter the column list at execute time without making the preview a lie (D27). Making it a page-level fact is the only fix that keeps preview and execution identical. Setting it for SQLite too is not scope creep but the opposite: P35's own scenario 38 already documents that an `INSERT` targeting `generated_cols.b` fails with *"cannot INSERT into generated column"*, which means `+ row` on that table is broken today — and a flag set by exactly one engine is special pleading rather than a protocol. Postgres's own `GENERATED ALWAYS` columns are named in §6 as the follow-up, not silently included. |

### Topic E — the kind seam

| # | Decision | Rationale |
|---|----------|-----------|
| D29 | **`SqlDialect` gains `'clickhouse'`; `quoteIdent`'s `if (dialect === 'mysql')` becomes a `BACKTICK_DIALECTS` set containing `'mysql'` and `'clickhouse'`.** `identNeedsQuoting` is unchanged. | F28: ClickHouse accepts both backticks and double quotes for identifiers, and its own `create_table_query` emits backticks — so backticks are what the app emits, and matching what the engine writes is the same rule P34 D17 followed for MySQL. The set rather than a second `||` because F40 shows this is the first time the branch has had two members, and because P34 F22 records exactly what an unhandled kind falling through this function costs: *"a MySQL connection that wasn't added to every one of those twelve sites would emit invalid double-quoted identifiers"*. A set makes the *next* backtick engine one entry rather than a second condition someone can forget. `identNeedsQuoting`'s bare-identifier grammar (`^[a-z_][a-z0-9_]*$`) matches ClickHouse's documented one (`^[a-zA-Z_][0-9a-zA-Z_]*$`, F28) closely enough that its existing dialect-independence still holds. |
| D30 | **`languages.ts` gains a locally-defined `ClickHouse` dialect via `SQLDialect.define()`** — `identifierQuotes: '\`"'`, `backslashEscapes: true`, `hashComments: true`, `doubleQuotedStrings: false`, `operatorChars: '*+-%<>!=&\|/~^'`, `specialVar: '{'`, plus a curated ClickHouse keyword and type vocabulary. Not a `StreamLanguage`. | F41: `@codemirror/lang-sql@6.10.0` has no ClickHouse dialect, but it *does* export `SQLDialect.define` and a spec with precisely the knobs F28's grammar needs — so this is a third shape in `languages.ts`, sitting between "map to a vendored dialect" (postgres/mysql/sqlite) and "hand-write a `StreamLanguage`" (mongo/redis, P18 D23/P35). The `StreamLanguage` route is wrong here for the reason it was right there: Mongo's `db.coll.find()` and Redis's flat command grammar are not SQL at all, whereas ClickHouse *is* SQL and gets the whole Lezer SQL tree — indentation, bracket matching, `schemaCompletionSource` — for the cost of one spec literal. `hashComments` and `backslashEscapes` are the two that would be wrong if it were aliased to `MySQL`, and `doubleQuotedStrings: false` is the one that would be wrong either way (MySQL treats `"x"` as a string, ClickHouse as an identifier). `specialVar: '{'` is for ClickHouse's own `{name:Type}` query parameters. The vocabulary is curated, not exhaustive — the same call `sqlIdent.ts:38-40`'s reserved-word list already makes. |
| D31 | **The grid's delete and edit affordances become caps-gated. `DataToolbar.vue`'s `− row` and `DataGrid.vue`'s `Delete`/`⌘⌫` plus the cell menu's *Delete row* read `caps.canDelete`; `canEditTable` gains `caps.canUpdate` alongside its existing `hasPrimaryKey` check. The `+ row`/preview/commit/discard buttons keep gating on `writable`.** A disabled `− row` carries a tooltip naming the engine reason, not "Connection is read-only". | F37 is the bug this closes: `buildPlan` drops an update or delete whose key is null **with no message**, so today a ClickHouse user could mark a row for deletion, see the red gutter rail (§8.5, P31 D31), press Commit, get a success toast, and find the row still there. That is the "nothing silently dropped" ground rule violated in the most confusing possible way. F38 shows the current gating is `caps.writable` + `hasPrimaryKey`, which means inline editing is *already* off for ClickHouse — but only as a side effect of `isPrimaryKey: false`, which is exactly the kind of accidental correctness this repo writes down and makes deliberate. The three write-gate flags exist for precisely this (`caps.ts:48-53`); ClickHouse is the first *tabular* adapter to need them, the way S3 was the first key/value one (P33). `tests/ui/{mutations,data-view,interaction}.spec.ts` are the regression guard that Postgres/MariaDB/MySQL/SQLite moved by nothing. |
| D32 | **`KIND_LABEL.clickhouse = 'ClickHouse'`, `KIND_ACCENT.clickhouse = 'orange'`, `SUPPORTED_KINDS` gains it, and `EngineIcon.vue` + `parts/_icons.html` gain a matching `clickhouse`/`i-clickhouse` mark together** — the three-bar/five-bar column-store glyph the project's own identity uses, redrawn as `currentColor` paths at 16 px, never the vendored logo. | F43: `orange` (`#d1966d`) is free, and unlike P35's own reasoning for rejecting it, it is *right* here — ClickHouse's identity is a yellow/orange bar mark, and the nearest occupied hue, Kafka's amber, belongs to a stream engine that never sits beside it in a list of SQL connections. `indigo` is the alternative and is raised as open question 1. Both files change together because `EngineIcon.vue` renders an **empty `<svg>` with no error** for an unknown kind (F43) — a silent failure in three places at once — and because the component's own header asserts a 1:1 correspondence with `_icons.html` that adding only one of the two would falsify. Same rule as P34 D18 and P35 D30. |
| D33 | **`typeGlossary.ts` gains ClickHouse's type family, and `typeDescription` learns to unwrap `Nullable(T)`/`LowCardinality(T)` recursively — describing the inner type, exactly as it already recurses on Postgres's `[]` suffix.** `grouping.ts`, `menus.ts`'s *Set as default* and `views/console/completion.ts` are not touched. | F44: `normalize()` strips the first parenthesised group, so `LowCardinality(String)` currently normalises to the meaningless `lowcardinality` and `Nullable(Int32)` to `nullable` — the wrapper survives and the type is discarded, which would give every wrapped ClickHouse column either no gloss or a wrong one. The `[]` branch (`typeGlossary.ts:189-196`) is the shape to copy, and its own comment already states the principle: *"describe by the element type rather than listing every possible array shape as its own entry."* F45 is why `grouping.ts` is untouched. *Set as default* stays Postgres-only: ClickHouse's `USE db` is a session-scoped statement and D13 refuses `session_id`, so there is no current database to switch. |

### Topic F — tests, fixtures and demo data

| # | Decision | Rationale |
|---|----------|-----------|
| D34 | **`tests/db/support/clickhouse.ts` uses `@testcontainers/clickhouse@12.1.0` and pins `clickhouse/clickhouse-server:26.3`.** Same memoized one-container-per-process shape, same `stop()`-resets-the-memo discipline, same `resolveDockerHost()` import. | F47: the preset exists, at the exact `testcontainers` version already pinned, and it carries the two things a hand-rolled `GenericContainer` would get wrong — the `Wait.forHttp('/')` predicate on `"Ok.\n"` (which is the real readiness signal, and needs no credentials) and the `nofile` ulimit bump that prevents a *"Too many open files"* flake. P16 already converted Postgres/MariaDB/Redis onto their presets for the same reason; there is no argument for regressing on a new engine. F48 is the pin: 26.3 is the current LTS with the longest remaining support window. F50 is the harness discipline this file inherits unchanged, including the memo reset that `support/mysql.ts:196-201` explains. |
| D35 | **The fixture seeds as the container's own privileged user and returns a config for a second, unprivileged `kira` user with `GRANT SELECT, INSERT, ALTER DELETE ON kira_test.*`.** A third user, `kira_ro`, gets `SELECT` only. | Mirrors `support/mysql.ts`'s own root-seeds/app-user-connects split (§6e), which exists to prove the adapter needs no elevated privilege. It also makes scenario 7's cancel assertion meaningful: F9's *"read-only users can only stop their own queries"* is only a real finding if the connection under test is not a superuser. `kira_ro` is what scenario 2c asserts `readonly`-independent server-side refusal against. |
| D36 | **`0010_clickhouse_seed.sql` is a port of `0008_mysql_seed.sql`, not a copy** (§2's list), plus six ClickHouse-only tables that each earn a scenario: `dup_keys`, `wide_types`, `generated_cols`, `commented`, `no_sorting_key`, `big_rows`. | `0002_mariadb_seed.sql`'s own header states the parity principle (*"deliberately kept in parity with 0001_seed.sql so the two spec files can assert the same things"*), and it is what makes an eighth adapter prove the abstraction rather than merely exist. Every divergence is a documented engine difference: no PK, no FK, no UNIQUE, no AUTO_INCREMENT, no sequences, no routines. `dup_keys` is the most important table in the fixture — two rows with an identical `ORDER BY` tuple, which is F16 turned into an assertion and therefore the direct evidence for D23. `big_rows` is `INSERT INTO big_rows SELECT number, … FROM numbers(1000000)` — one statement, no chunking, none of MariaDB's `seq_1_to_N` or MySQL's six-way digit cross join (P34 D28). |
| D37 | **`tests/ui/clickhouse.spec.ts` is Docker-gated like every engine's UI spec except SQLite's**, and is a small, deliberate subset of `tests/ui/mysql.spec.ts` whose two load-bearing assertions are the backtick-quoted *Filter by this value* (D29) and the **disabled `− row` button with an engine-specific tooltip** (D31). | P35 D35's unconditional spec was possible only because a temp file needs no container; ClickHouse needs one, so the standing `AGENTS.md` caveat applies and the plan says so up front rather than discovering it in CI. The two assertions are chosen because each is a seam where a missing branch fails *silently*: `sqlDialectFor` returning `undefined` would emit double-quoted identifiers that ClickHouse would happily accept as identifiers and then fail to match (P34 F22's failure mode, one level subtler here), and an un-gated `− row` would produce F37's silent no-op. |
| D38 | **The demo stack gains a ninth compose service (`clickhouse/clickhouse-server:26.3`, host port 8124 — 8123 is free but 8124 keeps the "host port ≠ container port where a second engine could collide" convention `mysql:3307` set) with its own `init.sql`/`seed.sql` and a `seed.sh` stanza.** | F49: eight services and eight stanzas is the established shape, and unlike SQLite (P35 D36, where there was nothing to containerize) ClickHouse is an ordinary server. The seed is the same e-commerce model as the other relational engines, re-expressed in MergeTree terms — which is itself useful documentation of what this adapter does and does not offer. |

### Topic G — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D39 | **Docs the implementing session edits:** SPEC §1 (ClickHouse joins the in-scope engine list, and §1's write-path sentence gains "ClickHouse tables get **add row** only"), §5.1's table (a ClickHouse row: tree levels, `tabular`, *"`LIMIT/OFFSET` only — MergeTree has no unique row key to build a keyset cursor on"*, *"yes (`count()` reads part metadata)"*, *"`KILL QUERY WHERE query_id = …` on a second HTTP request"*), §5's `Caps` prose (a sentence naming ClickHouse as the first tabular adapter with `canUpdate`/`canDelete` false), §11's adapters tree, `shared/caps.ts:100-110`'s per-kind table, `README.md`'s engine table plus a footnote, and `AGENTS.md` (a short section: the driver is pure JS so nothing in the native-build path applies, the DB suite needs Docker, and `@clickhouse/client` is the app's first *added* dependency since P32 that needs no rebuild step). The §10 phasing row is updated **only once the phase is implemented**. | Standing practice (P34 D33, P35 D37). `AGENTS.md` earns a section for the inverse of P32's reason: a future session seeing a *new dependency* in an app that has been burned by one will reasonably assume `scripts/native-electron-build.sh` needs a line, and the file should say it does not. |
| D40 | **No change to `scheduler/`, `cache/`, `adapters/live.ts`, `adapters/sql-text.ts`, `main/`, or any `Page` *variant*.** The single exception is D28's additive `ColumnDescriptor.generated`, which is named here rather than buried. | §11's claim that a new engine is one folder. ClickHouse returns the same `TabularPage` the other SQL adapters do. P35 D38 made the stronger "no protocol change at all" claim and could keep it; this phase cannot, and the honest thing is to say which claim broke and why (D28) rather than to let a reader discover it in the diff. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and
`bun run build` green. Steps 1–3 are the engine, 4–6 the app surface, 7–9 the tests, 10–11 demo data
and docs. Steps 7–9 need Docker and cannot be executed in Claude Code's Linux web container
(`AGENTS.md`); everything else can.

1. **`feat(shared): the clickhouse connection kind`** — `shared/domain/connection.ts` (the enum
   entry and `DEFAULT_PORT.clickhouse = 8123`; deliberately no `FILE_KINDS`/`AWS_STYLE_KINDS`
   membership and no new `superRefine` arm, D9/D10) and `shared/caps.ts`'s per-kind doc table row.
   No adapter yet: `registry.ts` has no loader, so a ClickHouse connection is refused by
   `createAdapter`'s existing `E_UNSUPPORTED` (`registry.ts:25-27`) — the same intermediate state
   every kind has passed through.
2. **`chore(deps): @clickhouse/client`** — the one `package.json` line, `bun install`, and the
   proof that it costs nothing: `bun run build` clean, `grep` confirming
   `scripts/native-electron-build.sh` and `electron-builder`'s `asarUnpack` are untouched, and
   `node -e` under `ELECTRON_RUN_AS_NODE=1 electron` confirming the module loads in the engine's
   actual runtime (D1). Its own commit because it is the phase's only packaging risk, and P32's
   history is why that gets isolated rather than buried in a 10-file adapter commit.
3. **`feat(engine): the ClickHouse adapter`** — the whole of `adapters/clickhouse/` (ten files) plus
   the one `registry.ts` loader line (D3–D8, D14–D27). This is the phase's large commit; the
   `Adapter` interface admits no partial implementation, and a half-adapter with `E_UNSUPPORTED`
   stubs is exactly what `AGENTS.md`'s "scope left out is left out entirely" forbids.
4. **`feat(shared,renderer): generated columns are not insertable`** — `ColumnDescriptor.generated`
   and its zod field, the ClickHouse adapter setting it, **the SQLite adapter setting it**, and
   `pendingChanges.ts`'s `addInsertRow` call sites (`DataToolbar.vue`'s `onAddRow`,
   `duplicateAsInsert`, `DataGrid.vue`'s paste path) skipping generated columns (D28). Its own
   commit because it is a shared-protocol change that touches two adapters and fixes a
   pre-existing SQLite bug; `tests/ui/{mutations,data-view}.spec.ts` are the regression guard.
5. **`feat(renderer): the clickhouse SQL dialect`** — `SqlDialect`'s fourth member,
   `BACKTICK_DIALECTS`, `sqlDialectFor`, and `languages.ts`'s `SQLDialect.define()` ClickHouse
   grammar (D29/D30). `xvfb-run -a bun run test:ui`'s four non-Docker specs plus a manual check that
   Postgres/MySQL/SQLite console highlighting is unchanged are the guard.
6. **`feat(renderer): caps-gated row deletion, and the ClickHouse tile, accent, mark and glossary`**
   — `DataToolbar.vue`/`DataGrid.vue`/`gridMenu.ts`'s `canDelete`/`canUpdate` gates (D31),
   `KIND_LABEL`/`KIND_ACCENT`/`SUPPORTED_KINDS`, `EngineIcon.vue` + `_icons.html`, and
   `typeGlossary.ts`'s ClickHouse entries plus wrapper unwrapping (D32/D33).
7. **`test(db): the ClickHouse container fixture and seed`** — `tests/db/support/clickhouse.ts`,
   `tests/db/fixtures/0010_clickhouse_seed.sql`, and the `@testcontainers/clickhouse` devDependency
   (D34–D36).
8. **`test(db): the ClickHouse adapter scenarios`** — `tests/db/clickhouse.spec.ts`, §5's list.
9. **`test(ui): ClickHouse through the real UI`** — `tests/ui/support/clickhouse.ts` and
   `tests/ui/clickhouse.spec.ts` (D37).
10. **`chore(demo): a ClickHouse demo service`** — `scripts/demo-dbs/clickhouse/` (`init.sql`,
    `seed.sql`), the compose service, the `seed.sh` stanza, and the `demo-dbs/README.md` row (D38).
11. **`docs: SPEC §1/§5/§5.1/§11, the caps table, the README and AGENTS for ClickHouse`** — D39's
    edits (not the phasing row), and this plan's own commit if it is not already landed.

## 5. Tests

### Existing specs and what must happen to them

| Spec | Why | Change |
|---|---|---|
| `tests/ui/{mutations,data-view,interaction}.spec.ts` | Step 6 changes what gates the grid's `− row`, `Delete`/`⌘⌫` and *Delete row* menu item across every engine. | **No change.** These are the regression guard: Postgres/MariaDB/MySQL/SQLite all have `canDelete: true`, so every existing assertion must still pass byte for byte. A failure here means the gate was written as `canDelete === true` somewhere it should have been `!== false`. |
| `tests/db/sqlite.spec.ts` | Step 4 sets `generated: true` on SQLite's VIRTUAL/STORED columns. | **One scenario extended** — scenario 38 (generated columns) gains an assertion that `read()`'s descriptors carry `generated: true` for `b`/`c` and `false` for `a`. The existing *"cannot INSERT into generated column"* assertion stays: the server-side refusal is still the backstop. |
| `tests/ui/{grid,console,definition,autocomplete,cell-editor}.spec.ts` | Steps 5–6 widen `SqlDialect`, `languages.ts` and `typeGlossary.ts`. | **No change.** The regression guard for the dialect seam — a Postgres/MySQL/SQLite behaviour change shows up here. |
| `tests/ui/connections.spec.ts` | Step 6 adds a ninth engine tile. | **No change.** It drives the Postgres path and runs without Docker, so it is the one that can be proven green in every environment. |
| `tests/db/{postgres,mariadb,mysql}.spec.ts` | Untouched — D14 extracts nothing and D40 changes no shared engine module. | **No change.** Re-run as the guard that `sql-text.ts` really was left alone. |
| `tests/ui/memory.spec.ts` | `registry.ts` gains a ninth lazy loader and `package.json` a ninth driver. | **No source change**, but re-run: the RSS budget must not move. `@clickhouse/client` is pure JS and lazily imported, so a regression here would mean the loader stopped being lazy. |

### `tests/db/clickhouse.spec.ts` — the scenario list

**1:1 with `mysql.spec.ts`, unchanged in substance:** 3 (tree enumeration), 4 (quoting), 5
(describe), 8 (cap honesty), 9 (children of a leaf), 10 (first page), 11 (deep page by offset), 14
(projection), 15 (filter and sort), 16 (fidelity), 17 (count), 18 (read cannot write), 19
(definition), 20 (preview: exact text, never executes), 22 (mutate: unknown column is
`E_NOT_FOUND`), 23 (mutate: read-only connection is `E_UNSUPPORTED`), 27–29 (execute), 30–31 (the
P13 tripwires: one statement for count, read still resolves the catalog), 33 (filter injection never
reaches the database).

**Adjusted, each for a documented engine difference:**

- **1. connect / disconnect** — `serverVersion` matches `/^ClickHouse 2\d\./`; `details` carries
  `url`, `database` and `timezone` (D4). After `disconnect()`, a subsequent `children()` rejects
  `E_CONNECT` *and* `system.processes` on a side client shows no query from
  `application = 'kira-studio'` — the ClickHouse equivalent of `mysql.spec.ts:1`'s "the session's
  connect attributes are gone", and the only way to prove `client.close()` really released the
  sockets.
- **2. auth and reachability failures** — real here, unlike SQLite. **2a.** a wrong password →
  `E_AUTH`, message from code 516 `AUTHENTICATION_FAILED`; **2b.** an unknown user → `E_AUTH`
  (code 192/193); **2c.** an unreachable host/port → `E_CONNECT`, not a hang past
  `request_timeout`; **2d.** an unknown database → `E_NOT_FOUND` naming it (code 81).
- **3. tree enumeration** — the seeded database plus `default` and **`system`** are present;
  `INFORMATION_SCHEMA` and `information_schema` are **absent** (D15); tables ungrouped, the view
  present as `view` and the materialized view as `matview`; `byKind('sequence')` and
  `byKind('function')` both `[]`.
- **6. row estimate** — `big_rows` reports a `rowEstimate` of exactly 1,000,000 from
  `system.tables.total_rows` (F32 — exact, not a band, unlike MySQL's statistics cache which P34
  D26 had to widen for); the `Memory`-engine `no_sorting_key` table reports `rowEstimate: null`
  rather than 0; the view reports `null`.
- **7. cancel: the real thing** — `caps.cancel === true`. A long `SELECT sleepEachRow(…)` is started,
  its `query_id` observed in `system.processes` on a side client, `adapter.cancel(opId)` returns
  `true`, and **the query is gone from `system.processes`** — asserted server-side, per §9.1's own
  rule, exactly as the Postgres and MySQL specs assert against `pg_stat_activity` and
  `SHOW PROCESSLIST`. Plus: the cancelled op rejects with `E_CANCELLED` (code 394
  `QUERY_WAS_CANCELLED`), an already-aborted signal rejects before the statement runs, and
  `cancel()` for an unknown opId returns `false` without throwing.
- **12–13. there is no keyset, and asking for one says so** — replaces `mysql.spec.ts`'s two keyset
  scenarios. `caps.pagination === 'offset'`; a first page comes back with `strategy: 'offset'`,
  `nextToken: null` and `prevToken: null`; a cursor in `after` mode rejects `E_UNSUPPORTED` with a
  message naming MergeTree's non-unique key; and paging forward by offset across the seeded table
  returns disjoint, complete row sets (D20).
- **21/24/25/26. mutate, rewritten around insert-only** — **21.** an insert lands in the op log with
  the exact statement `preview()` rendered, and `affectedRows` equals `written_rows` (D26);
  **24.** an `update` op is `E_UNSUPPORTED` with a message naming the sparse-index reason, **and the
  table is unchanged afterwards** (D23); **25.** a `delete` op is the same; **26.** a plan mixing an
  insert with an update is refused **whole** — the insert must not land (the boundary that makes
  D23 a guard rather than a filter).
- **32. the leak guard** — a failed connect leaves no open socket (`system.metrics`'
  `HTTPConnection` gauge, read on a side client, returns to its pre-attempt value) and no entry in
  the adapter's `runningByOp` map.

**ClickHouse-specific additions:**

- **34. duplicate "primary key" rows are real** — `dup_keys` (a `ReplacingMergeTree` with two rows
  sharing an identical `ORDER BY` tuple) reads back **both** rows, `describe()` reports
  `primaryKey: null`, and every `ColumnDescriptor.isPrimaryKey` is `false` (F16/D18/D23). The single
  scenario that justifies the whole write story; first among the additions for that reason.
- **35. wide types** — `wide_types` round-trips `Array(String)`, `Tuple(UInt8, String)`,
  `Map(String, UInt64)`, `Enum8`, `UUID`, `IPv4`, `IPv6`, `Decimal128(20)`, `DateTime64(3, 'UTC')`,
  `FixedString(8)`, `LowCardinality(String)` and `LowCardinality(Nullable(String))`, with the
  expected `typeClass` for each and `nullable` derived from the wrapper chain rather than a flag
  (D17). The scenario that would catch anyone "simplifying" `typeClassFor` into a prefix match.
- **36. big integers keep every digit** — a `UInt64` holding `18446744073709551615` and a
  `Decimal128(20)` holding a 38-digit value both read back as their exact decimal strings, on the
  read path *and* the console path (D16). Note what is being asserted: not that a `BigInt` was
  produced, but that no JS number ever existed.
- **37. NULL is not the string "null", and NaN is not NULL** — a `Nullable(String)` column holding
  SQL `NULL` reports `isNull`, one holding the literal text `null` does not, and a `Float64` holding
  `nan` comes back as `nan` rather than as a NULL (F25/F27/D16).
- **38. the default order is the table's own sorting key** — with no sort requested, the emitted
  statement's `ORDER BY` is byte-identical to `system.tables.sorting_key` read on a side client, and
  two successive offset pages over `big_rows` are disjoint; the `Memory`-engine `no_sorting_key`
  table emits **no** `ORDER BY` at all (D21).
- **39. generated columns** — `generated_cols` reports all three columns from `describe()` and all
  three come back from `read()` (the adapter never emits `SELECT *`, so a `MATERIALIZED`/`ALIAS`
  column is readable); `generated` is `true` for the MATERIALIZED and ALIAS columns and `false` for
  the DEFAULT one; and an insert that targets the MATERIALIZED column surfaces ClickHouse's own
  message verbatim as `E_QUERY` (F15/D28).
- **40. definition round trip** — `create_table_query` comes back byte-for-byte identical to a side
  client's own `SHOW CREATE TABLE`, **contains no `UUID '…'` clause** (D6's pinned setting), and
  re-executes into a scratch database; `constraints` carries the seeded CHECK from
  `system.constraints` (F18); `sections` carries Engine/Sorting key/Primary key/Partition key/Total
  rows; `notes` states the sparse-index and no-foreign-keys facts (D22).
- **41. literal escaping** — an insert of a value containing `'`, `\`, `\n`, `\t`, a `%` and
  non-ASCII text round-trips byte-for-byte, and `preview()`'s rendered statement is **the same
  string** that was executed (F28/D27). The scenario that catches a `literalFor` ported from
  `mysql-family/mutate.ts` without the backslash branch.
- **42. multi-statement input is refused by the server** — `execute()` with one entry containing two
  statements rejects `E_QUERY` carrying ClickHouse's own *"Multi-statements are not allowed"*; the
  same two sent as two entries produce two pages (F11).
- **43. read-only is enforced by the server, not just by the adapter** — a read-only connection's
  `mutate()` is `E_UNSUPPORTED` from the adapter's own guard, **and** a raw insert pushed through
  `execute()` on that same connection is refused by ClickHouse with code 164 `READONLY` (D7). Two
  independent layers, asserted independently.
- **44. table and column comments** — `commented`'s `ObjectMeta.comment` and its columns'
  `comment` fields are non-null and match the seed; a table with no comment reports `null`, not `''`
  (F14/F15).
- **45. cancel does not leak, and neither does a slow read** — after a cancelled long query, a fresh
  read on the same adapter succeeds immediately (the socket was returned to the pool, not
  destroyed), and `runningByOp` is empty (D8).

### `tests/ui/clickhouse.spec.ts` — a small, Docker-gated subset

Same structure as `tests/ui/mysql.spec.ts`, including the 240 s container timeout and the
`isDockerAvailable()` skip (D37):

1. The engine picker shows a **ClickHouse** tile with a **non-empty** mark (the assertion that
   `EngineIcon.vue`'s new branch exists at all — F43's silent-empty-svg failure), and picking it
   shows host, port, user and password fields with the port prefilled to **8123** (D10).
2. The connection saves and connects: green dot, and a `ClickHouse 26.` server version in the status
   tooltip.
3. The tree lists the seeded database, its tables ungrouped, a **Views** folder and a **Materialized
   views** folder — and no `INFORMATION_SCHEMA` node (D15).
4. Opening `order_items` renders the grid, and **row context menu → Filter by this value puts a
   backtick-quoted predicate in the filter box and narrows the grid for real** — the direct test of
   D29, and the mirror of the MySQL spec's own assertion rather than SQLite's double-quoted one.
5. **`+ row` is enabled; `− row` is disabled and its tooltip names the engine reason** (not
   "Connection is read-only"); double-clicking a cell does **not** start an inline edit (D31). The
   assertion that the phase's central decision is wired all the way to the surface.
6. The definition tab's Structure pane shows a **Table** properties section naming the engine and
   the sorting key, and the Columns section shows no PK badge on any column (D18/D22).
7. The console tab accepts `SELECT 1;` and returns one page (SQL mode, highlighted — D30).

### What is deliberately not added

No unit tests (§9's standing rule). `typeClassFor`'s grammar parse and `literalFor`'s escaper are
pure functions, and scenarios 35, 37 and 41 are where their correctness is observable.

## 6. Explicitly out of scope

- **Update and delete, in every form** (D23/D24) — including a "verify uniqueness first, then act"
  design (a `SELECT count() … WHERE <key>` probe before each `UPDATE`), which was considered and
  rejected: it doubles the round trips, races any concurrent insert between the probe and the write,
  and still cannot use lightweight `UPDATE` without the table-setting change §0 forbids. When
  `UNIQUE KEY` (F19) ships un-flagged, this is one phase's worth of work built on
  `system.tables.unique_key`, and D20/D23 are the two decisions it reopens.
- **Keyset pagination, in every form** (D20) — including a `(_part, _part_offset)` cursor (F20:
  merges invalidate it silently) and a sorting-key cursor with a `>=`/`>` fudge (F16: one repeats
  rows at every page boundary, the other skips them).
- **`ALTER`, `OPTIMIZE`, `SYSTEM`, `TRUNCATE` and every other DDL verb from the tree or the grid.**
  §1's DDL-is-read-only line. A user can type them in the query console, which is where every
  engine's DDL already lives.
- **`ON CLUSTER`, replication and sharding awareness.** `system.clusters` and `system.replicas` exist
  and are browsable in the console; the adapter neither reads them nor appends `ON CLUSTER` to
  anything, so a `Distributed` table behaves as the ordinary readable table it is.
- **ClickHouse Cloud specifics** — `access_token` (JWT) auth, the Cloud-only `lightweight_deletes_sync`
  default of `1`, and idle-service wake-up latency. The adapter connects to Cloud over the same HTTP
  interface with a username and password; the JWT path is a credential shape (§6's `connections`
  columns) that deserves its own decision, not a smuggled-in `options` key.
- **Custom CA certificates, mutual TLS and skipping certificate verification** (D12) — F35: the
  client's `tls` option is `ca_cert`/`cert`/`key` Buffers with no `rejectUnauthorized` escape hatch,
  and the only route to one (`http_agent`) is experimental and disables `max_open_connections`,
  `keep_alive` and `tls` along with it, which would cost D8 its free second socket.
- **Response and request compression** (`compression.response`, F3) — likely a large win against a
  remote server and plausibly a CPU cost in the engine process, and this repo does not flip
  performance levers without a number (`docs/PERF.md` §2.1's methodology note). One config line for a
  later phase with a measurement.
- **`session_id`, `role` and arbitrary `clickhouse_settings` passthrough** (D13).
- **Progress reporting from `X-ClickHouse-Progress`.** The client can surface it and `OpCtx` has an
  `onProgress` hook, but no adapter in this tree drives it today; adding the first one is a
  cross-cutting UI question, not a ClickHouse question.
- **Postgres's own `GENERATED ALWAYS` columns getting `ColumnDescriptor.generated`** (D28 sets it for
  ClickHouse and SQLite only). Postgres's `attgenerated` is one column away in
  `postgres/catalog.ts`'s existing query, but adding it without a fixture table and a scenario would
  be exactly the untested widening this repo's own rules forbid — named here so it is a follow-up
  rather than an oversight.
- **chDB, and ClickHouse's native TCP protocol (port 9000)** (F2/D1).
- **Any behaviour change to the other seven adapters**, except D28's `generated` flag on SQLite and
  D31's caps gating, both of which are additive and both of which are guarded by existing specs.

## 7. Target tree at the end of P36

```
src/engine/adapters/
  sql-text.ts                        --  UNCHANGED — only buildOrderBy/requestFingerprint/
                                         hexPreview are used; the keyset helpers are not (D14, D20)
  registry.ts                       MOD  + the clickhouse lazy loader (D3)
  clickhouse/                       NEW  §11's fixed shape, real content in every file (D14)
    index.ts                        NEW  the Adapter impl: connect/children/describe/definition/
                                         read/count/preview/mutate/execute/cancel (D4, D8)
    caps.ts                         NEW  clickhouseCaps — pagination:'offset', canUpdate/canDelete
                                         false, foreignKeys false, transactions false, cancel TRUE
                                         (D8, D20, D23, D25)
    client.ts                       NEW  dynamic @clickhouse/client import (D3), url from fields/URI
                                         (D11), D6's settings block, D7's readonly, D12's sslmode
    query.ts                        NEW  runQuery (streamed JSONCompactStringsEachRowWithNamesAndTypes,
                                         D16), runCommand (summary.written_rows, D26), literalFor's
                                         backslash-then-quote escaper (D27), query_id minting (D8)
    catalog.ts                      NEW  system.databases / system.tables / system.columns /
                                         system.data_skipping_indices / system.constraints;
                                         ReadTarget incl. sortingKey + generatedColumns (D15, D18, D21)
    read.ts                         NEW  offset-only paging, sorting-key default ORDER BY,
                                         typeClassFor's wrapper-unwrapping grammar (D17, D20, D21)
    mutate.ts                       NEW  insert-only, one multi-row VALUES; update/delete are
                                         E_UNSUPPORTED naming why (D23, D26, D27)
    console.ts                      NEW  exec() + default_format, streamed; a status page for an
                                         empty body; a raw-text page for a user's own FORMAT (D19)
    definition.ts                   NEW  create_table_query verbatim + system.constraints +
                                         P23 sections + the two notes (D22)
    errors.ts                       NEW  ClickHouseError.code/type -> AdapterErrorCode (F5, F6)
  sqlite/read.ts                    MOD  + `generated` on the descriptors it builds (D28)
src/shared/
  domain/connection.ts              MOD  'clickhouse' in the enum + DEFAULT_PORT 8123 (D9, D10)
  domain/uri.ts                      --  UNCHANGED — `clickhouse://` falls out of the existing
                                         scheme rule; canRoundTripToFields stays postgres-only (D11)
  protocol/page.ts                  MOD  ColumnDescriptor.generated + its zod field (D28)
  caps.ts                           MOD  the per-kind doc table gains a clickhouse row (D39)
src/renderer/
  views/shared/sqlIdent.ts          MOD  SqlDialect gains 'clickhouse'; quoteIdent's mysql branch
                                         becomes BACKTICK_DIALECTS (D29)
  editor/languages.ts               MOD  + a locally SQLDialect.define()'d ClickHouse grammar (D30)
  views/grid/DataToolbar.vue        MOD  the − row button gates on caps.canDelete (D31)
  views/grid/DataGrid.vue           MOD  canEditTable gains caps.canUpdate; Delete/⌘⌫ gates on
                                         caps.canDelete; the paste path skips generated columns (D28, D31)
  views/grid/gridMenu.ts            MOD  the cell menu's Delete row gates on caps.canDelete (D31)
  views/grid/pendingChanges.ts      MOD  duplicateAsInsert skips generated columns (D28)
  project/ConnectionDialog.vue      MOD  the ClickHouse tile, KIND_LABEL, KIND_ACCENT ('orange'),
                                         SUPPORTED_KINDS, onAddRow's column list (D28, D32)
  project/typeGlossary.ts           MOD  ClickHouse's type family + Nullable/LowCardinality
                                         unwrapping in typeDescription (D33)
  theme/EngineIcon.vue              MOD  + the clickhouse bar mark (D32)
  project/grouping.ts                --  UNCHANGED (F45, D33)
  project/menus.ts                   --  UNCHANGED — Set as default stays postgres-only (D33)
tests/
  db/support/clickhouse.ts          NEW  @testcontainers/clickhouse, image 26.3, memoized (D34, D35)
  db/fixtures/0010_clickhouse_seed.sql  NEW  the ported dataset + six ClickHouse-only tables (D36)
  db/clickhouse.spec.ts             NEW  the mirrored set + 8 adjusted + 12 ClickHouse-specific (§5)
  db/sqlite.spec.ts                 MOD  scenario 38 gains the `generated` assertion (D28)
  db/{postgres,mariadb,mysql}.spec.ts   --  UNCHANGED — re-run as the sql-text.ts guard
  ui/support/clickhouse.ts          NEW  re-export of the db harness, mysql.ts's own shape
  ui/clickhouse.spec.ts             NEW  the small UI spec; Docker-gated (D37)
  ui/{mutations,data-view,interaction}.spec.ts  --  UNCHANGED — the D31 regression guard
scripts/demo-dbs/
  docker-compose.yml                MOD  + the clickhouse service (host port 8124) + its volume (D38)
  clickhouse/init.sql               NEW
  clickhouse/seed.sql               NEW
  seed.sh                           MOD  + the ClickHouse stanza (D38)
  README.md                         MOD  + the ClickHouse row
docs/
  v1/SPEC.md                        MOD  §1, §5, §5.1, §11 (D39) — phasing row once implemented
  v1/design/kira-design-system/parts/_icons.html   MOD  + the i-clickhouse symbol (D32)
  v1/plans/P36-clickhouse-adapter.md    NEW  this document
AGENTS.md                           MOD  + the "@clickhouse/client is pure JS" note (D39)
README.md                           MOD  + the ClickHouse engine row and footnote (D39)
package.json                        MOD  + @clickhouse/client (dependency),
                                         + @testcontainers/clickhouse (devDependency)
```

## 8. Acceptance checklist

**The driver and the packaging**

- [ ] `package.json` gains exactly two lines: `@clickhouse/client` (dependency) and
      `@testcontainers/clickhouse` (devDependency), both pinned exact.
- [ ] `grep -rn "clickhouse" scripts/native-electron-build.sh electron-builder.yml` matches nothing —
      no rebuild step, no `asarUnpack` entry.
- [ ] `bun run build` clean, and `out/main`/`out/engine` contain no bundled copy of the driver
      (`externalizeDepsPlugin` left the `require`/`import` in place).
- [ ] The module loads under `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron` — the
      engine's actual runtime — and under `bun`, which is what `bun test tests/db` uses.

**The connection**

- [ ] A ClickHouse connection created in Fields mode prefills port **8123** and connects;
      `serverVersion` reads `ClickHouse 26.x`.
- [ ] A wrong password fails `E_AUTH`, an unknown database `E_NOT_FOUND`, an unreachable host
      `E_CONNECT` — none of them a hang.
- [ ] `clickhouse://user:pass@host:8123/db` round-trips through *Copy URI*, and a URI-mode connection
      connects.
- [ ] A read-only connection is refused **by the server** (code 164) for a write pushed through the
      console, not only by the adapter's own guard.

**The adapter**

- [ ] Tree: the seeded database, `default` and `system` present; both `information_schema` spellings
      absent; tables ungrouped; **Views** and **Materialized views** folders.
- [ ] `describe()` returns `primaryKey: null`, `foreignKeys: []`, `referencedBy: []` and
      `isPrimaryKey: false` on every column — for every table, including one with a declared
      `PRIMARY KEY`.
- [ ] A `ReplacingMergeTree` table holding two rows with an identical `ORDER BY` tuple returns
      **both** rows.
- [ ] A `UInt64` at `18446744073709551615` and a 38-digit `Decimal128` read back exactly, on the grid
      and console paths alike.
- [ ] `Nullable(String)` NULL renders distinctly from the literal text `null`; a `Float64` `nan`
      is not reported as NULL.
- [ ] `LowCardinality(Nullable(String))` reports `typeClass: 'text'` and `nullable: true`.
- [ ] With no sort requested, the emitted `ORDER BY` is `system.tables.sorting_key` verbatim; a
      `Memory`-engine table emits none.
- [ ] `caps.pagination === 'offset'`; every page reports `strategy: 'offset'` with null tokens; a
      keyset cursor is `E_UNSUPPORTED` with a message naming the reason.
- [ ] `count()` on a 1,000,000-row table returns exactly 1,000,000, and the tree's row estimate is
      exact too (not a band).
- [ ] `definition()` returns `create_table_query` verbatim, carries **no `UUID '…'` clause**,
      re-executes into a scratch database, lists the seeded CHECK constraint, and carries a
      **Table** properties section plus the sparse-index and no-foreign-keys notes.
- [ ] An insert commits, `affectedRows` equals `written_rows`, and *Preview command*'s text is the
      byte-identical statement that ran — including a value containing `'`, `\` and a newline.
- [ ] An update or delete op is `E_UNSUPPORTED` naming the sparse-index reason, and a plan mixing one
      with an insert is refused **whole**.
- [ ] `caps.cancel === true`; a cancelled query **disappears from `system.processes`**, the op
      rejects `E_CANCELLED`, and a fresh read on the same adapter succeeds immediately afterwards.
- [ ] A two-statement string handed to `execute()` as one entry is refused with ClickHouse's own
      *"Multi-statements are not allowed"*.

**The kind seam**

- [ ] A grid *Filter by this value* against ClickHouse produces a **backtick**-quoted identifier and
      narrows the grid; the same against SQLite still produces a double-quoted one and against
      Postgres a double-quoted one.
- [ ] The ClickHouse console highlights and lints SQL, and its completion popup responds to
      Arrow Up/Down (P31 D14's own guarantee, inherited).
- [ ] The engine picker's ClickHouse tile renders a real mark in its accent colour, and
      `_icons.html` carries the same path.
- [ ] `− row` is disabled with an engine-specific tooltip and double-click does not start an edit —
      on ClickHouse only. Postgres/MariaDB/MySQL/SQLite are unchanged.
- [ ] `+ row` on a table with a MATERIALIZED column stages an insert that **omits** it and succeeds;
      the same on SQLite's `generated_cols` succeeds where it previously failed.
- [ ] The definition view's Columns section shows a gloss for `LowCardinality(String)` describing
      **String**, not "lowcardinality".

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` clean on every
      commit.
- [ ] `xvfb-run -a bun run test:ui` — `smoke`, `startup`, `workbench`, `connections` and `sqlite`
      pass in an environment with no Docker; `clickhouse` **skips cleanly** there rather than
      erroring.
- [ ] **verify-on-container:** `bun test tests/db/clickhouse.spec.ts` green against a live
      `clickhouse/clickhouse-server:26.3`. Per `AGENTS.md` this cannot run in Claude Code's Linux web
      container (the outbound policy blocks Docker Hub's blob CDN), so it must be run on the
      macOS/Colima box or in CI before the phase is called done.
- [ ] **verify-on-container:** the four facts this plan reasons about from documentation rather than
      from a running server — `JSONCompactStringsEachRowWithNamesAndTypes`'s exact NULL and
      invalid-UTF-8 behaviour under `output_format_json_validate_utf8: 1` (F25/F26/D16),
      `KILL QUERY … SYNC`'s `kill_status` values for an unprivileged user's own query (F9/D8),
      `create_table_query`'s UUID clause under `show_table_uuid_in_table_create_query_if_not_nil: 0`
      (D6/D22), and `readonly: 2` co-existing with D6's per-request format settings (F30/D7).
- [ ] **verify-on-container:** `tests/ui/clickhouse.spec.ts` end to end.
- [ ] `bash scripts/demo-dbs/seed.sh` brings the ninth service up and seeds it, and a connection to
      `localhost:8124` browses it.
- [ ] SPEC §1, §5, §5.1, §11, `shared/caps.ts`'s table, the README and `AGENTS.md` all describe what
      shipped.

## 9. Open questions for the user

The implementing session proceeds on each stated default; none of these blocks a commit.

1. **ClickHouse's accent colour: `orange` or `indigo`?** D32 picks `orange` (`#d1966d`) — free, and
   the closest free hue to ClickHouse's own yellow identity. The counter-argument is that Kafka's
   `amber` (`#bca260`) is the nearest neighbour and the two are separable but not instantly so at
   16 px; `indigo` (`#979fdd`) is unambiguous but reads as a second MariaDB blue in a list of SQL
   connections. One line either way.
2. **Should the `system` database be hidden from the tree?** D15 keeps it, breaking the precedent
   `mysql-family/catalog.ts:18` set for MySQL's four system schemas. The argument for keeping it:
   `system.query_log`, `system.parts` and `system.mutations` are things ClickHouse users open on
   purpose, it is the catalog this adapter itself reads from, and P28's checkbox filter can hide it
   per connection. The argument for hiding it: it is ~100 tables at the top of a fresh connection's
   tree, and no other engine shows its internals. One entry in an exclusion list either way.
3. **Is `canUpdate: false` / `canDelete: false` the right call, or should P36 ship a lightweight
   `DELETE` gated on a uniqueness probe?** D23/D24 say no, on four independent grounds (no unique
   key, no matched-row count, the table-setting change lightweight `UPDATE` needs, and the beta
   status). The counter-argument is that lightweight `DELETE` alone *is* synchronous and immediate,
   and "delete every row matching this row's sorting key" is a defensible operation on many real
   ClickHouse tables — it is just not the operation the button appears to offer. If the answer is
   "ship delete", it needs its own confirmation dialog naming how many rows will go, which is a
   different feature from the grid's current one.
4. **Should `ColumnDescriptor.generated` land in P36 at all, or be its own small phase?** D28 lands
   it here because ClickHouse's MATERIALIZED columns make it unavoidable and because a flag set by
   one engine is not a protocol. It does mean P36 touches `shared/protocol/page.ts` and
   `engine/adapters/sqlite/`, which P35 D38 promised a new engine would never require. The
   alternative — ClickHouse tables with a MATERIALIZED column simply cannot be inserted into, with
   the server's own error explaining why — is smaller and worse.
5. **Which ClickHouse image should the DB fixture and the demo stack pin?** D34/D38 pick
   `clickhouse/clickhouse-server:26.3` (the current LTS, F48). `25.8` is the prior LTS and would
   prove a wider compatibility floor; a floating `latest` would catch upstream breakage early and
   make the suite non-reproducible. Note that 26.8 LTS is due around now (F48's March/August
   cadence) and may be the better pin by the time this is implemented — if so, take it, and record
   the version the scenarios were actually verified against.
6. **Should the connection dialog show ClickHouse's HTTPS port (8443) when `sslmode=require` is
   set?** Not proposed. D10 prefills 8123 unconditionally and D12 only switches the scheme, so a
   TLS user must change the port by hand — and will get a connect failure with a legible message if
   they forget. Auto-switching the port on an `options` change would be the first time the dialog
   reacts to one, which is a bigger precedent than the convenience is worth.
7. **Should `compression.response` be on?** §6 defers it for lack of a measurement. Against a remote
   ClickHouse the JSON text this adapter reads compresses roughly ten-fold, which is the single
   largest available win for the one engine most likely to be remote — but it is also CPU in the
   engine process, and `docs/PERF.md` §2.1's methodology note is the reason this plan will not flip
   it on a guess.

### Critical Files for Implementation

- `/home/user/kira-studio/src/engine/adapters/sqlite/` (the whole folder — `index.ts`, `caps.ts`, `client.ts`, `query.ts`, `catalog.ts`, `read.ts`, `mutate.ts`, `console.ts`, `definition.ts`, `errors.ts`: the stands-alone adapter shape `clickhouse/` copies, and the file set D28 also modifies)
- `/home/user/kira-studio/src/engine/adapters/adapter.ts` and `/home/user/kira-studio/src/shared/caps.ts` (the contract every decision in Topics A, C and D is measured against)
- `/home/user/kira-studio/src/renderer/views/grid/pendingChanges.ts` and `/home/user/kira-studio/src/renderer/views/grid/DataToolbar.vue` (F37/F38 — the two files that make D23's `canUpdate`/`canDelete` falses necessary and D31's gating possible)
- `/home/user/kira-studio/src/renderer/views/shared/sqlIdent.ts` and `/home/user/kira-studio/src/renderer/editor/languages.ts` (D29/D30 — the backtick set and the first `SQLDialect.define()`)
- `/home/user/kira-studio/src/shared/protocol/page.ts` (D28's `ColumnDescriptor.generated`, and `createTabularPageBuilder`, which D16's wire format feeds directly)
