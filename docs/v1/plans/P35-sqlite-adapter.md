# P35 — The SQLite adapter: a file is not a server

> SPEC.md §10's **P35** row, verbatim:
>
> *"A seventh SQL-family adapter, `engine/adapters/sqlite/`, for local/embedded `.sqlite`/`.db`
> files rather than a network connection — matching the fixed internal shape the other SQL adapters
> establish where SQLite's file-based, serverless model actually fits it, with its own
> `tests/db/sqlite.spec.ts`"*, with the rationale *"Not yet planned — queued for when its turn
> comes. Connection-dialog shape (a file path instead of host/port/credentials) and driver choice
> are open questions for that plan, not decided here"*. This plan decides both.
>
> **The finding the phase turns on.** The driver is already in the app, and it is a language
> builtin. `src/main/storage/db.ts:5,52` opens Kira's *own* storage with `node:sqlite` (P0 D2), and
> the engine's `utilityProcess` (`main/engine-host.ts:41`) runs Electron 43.4.1's Node —
> **24.18.1**, whose `node:sqlite` exports `DatabaseSync`/`StatementSync`/`Session`/`backup` over
> **SQLite 3.53.1** with FTS5, RTREE, SESSION and column metadata compiled in (F1, F24, all
> measured in this sandbox). P35 adds **no dependency, no native module, no `electron-rebuild`
> step, no `asarUnpack` entry** — the exact opposite of P32's Kafka driver.
>
> **The second finding, and the one this plan spends most of its decisions on.** Every fixed
> assumption the other six adapters share is *absent* here, not merely different: there is no host,
> no port, no username, no password, no TLS, no server-side session to `KILL`, and no second
> connection to cancel from. `connection.ts:83-96` currently *requires* a host and a port for every
> non-AWS kind; `Caps.cancel` is `true` in all eight adapter literals; §5.1's table has a "cancel
> mechanism" column for every row. SQLite genuinely has none of it. The plan's job is to say so
> honestly — `caps.cancel: false`, no `DEFAULT_PORT` entry, no credential note in the dialog —
> rather than to invent a serverless imitation of a server (D4, D12, D14).
>
> **The third finding, and the reason this phase is small.** `node:sqlite`'s entire API is
> **synchronous** and exposes no `sqlite3_interrupt` (F3, F10) — so a running statement cannot be
> cancelled, and while one runs, the engine's event loop cannot even *receive* the abort. That is
> not a limitation to work around; it is what the capability flag exists to declare. Measured, the
> exposure is bounded: on a 1M-row table `count(*)` is **9 ms**, a filtered full scan **73 ms**, a
> keyset page **~0 ms** and a deep `OFFSET 900000` page **18 ms** (F11). The app's own read path is
> `LIMIT pageSize+1` by construction; only a user's own console query is unbounded, exactly as on
> every other engine.
>
> **The fourth finding, and a free one.** P34 D17's `SqlDialect` seam absorbs SQLite in **three
> lines**: SQLite quotes identifiers with double quotes, which is already `quoteIdent`'s default
> branch (`sqlIdent.ts:27-30`), and every other renderer consumer gates on `sqlDialectFor(kind)`
> being truthy. Adding a seventh SQL engine to the renderer is now a one-line change to one file —
> the thing P34 D17 claimed, tested here for the first time.

## 0. Ground rules for this phase

- **No new dependency.** `node:sqlite` is a builtin of the runtime the engine already is (F1, F2).
  A native driver would be a packaging story (prebuild download, `asarUnpack`, per-arch binaries)
  bought for capabilities it does not actually add (F13).
- **The user's file is not ours to change.** No `PRAGMA journal_mode`, no `VACUUM`, no `ANALYZE`,
  no auto-create. `journal_mode` is a *persistent property of the file* — setting WAL survives
  close/reopen and leaves `-wal`/`-shm` sidecars beside a file the user did not ask us to touch
  (F16, D6). §9.1's dataset discipline gets a new sibling rule: opening a database in Kira must
  leave it byte-identical unless the user mutated a row (spec scenario 36).
- **Kira never creates a database.** §1 says DDL is read-only; a mistyped path must fail, not
  silently produce an empty file — which is precisely what `node:sqlite` does by default (F7, D8).
- **Absent capabilities are declared, not simulated.** `caps.cancel: false` (D4), no default port
  (D12), no credentials in the dialog (D14). §5.1: *"If a driver cannot cancel, the capability is
  absent and the stop button says so rather than lying."*
- **Nothing silently truncated.** `prepare()` compiles only the first statement of a
  multi-statement string and reports no error (F9) — the adapter refuses instead (D9), matching
  MariaDB's `multipleStatements: false`.
- **This is not a "family".** P34's `mysql-family/` exists because two engines share one wire
  protocol and one driver. SQLite shares neither with anything (D17); the only shared code is
  `adapters/sql-text.ts`, whose row-value keyset predicate and `LIMIT n OFFSET m` were **verified
  to run** against SQLite 3.53.1 in this sandbox, unchanged (F17 note, D17).
- Comments per `AGENTS.md`: only where the code cannot say it for itself — in particular D3's
  BigInt rule, D6's "do not touch the file" pragmas and D9's dropped-tail check, none of which
  anyone re-derives from the code.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every commit.
  **`tests/db/sqlite.spec.ts` needs no Docker** — the fixture is a temp file (D32). It does need a
  runtime with `node:sqlite`: this sandbox's Bun is **1.3.11 and has none** (measured: *"No such
  built-in module: node:sqlite"*), while `bun-types@1.4.0`'s own compatibility doc bundled in
  `node_modules` says it is *"Fully implemented"* in Bun 1.4 (F12). Items that depend on Bun 1.4
  are flagged **verify-on-Bun-1.4** in §8, exactly as P34 flagged verify-on-container.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings (measured against this tree and these runtimes, not assumed)

### The driver and the runtimes

**F1 — `node:sqlite` is present in the runtime the adapter actually runs in.** The engine is an
Electron `utilityProcess` (`main/engine-host.ts:41`, `utilityProcess.fork(join(__dirname,
'engine.js'))`), so it is Electron's own Node. Measured under
`ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron`: `process.versions.node === '24.18.1'`,
`process.versions.electron === '43.4.1'`, `Object.keys(require('node:sqlite'))` =
`['DatabaseSync','StatementSync','Session','constants','backup']`, and
`SELECT sqlite_version()` = **`3.53.1`**.

**F2 — the app already ships on it, and the build already externalizes it.**
`src/main/storage/db.ts:5,52` opens `kira.sqlite` through `await import('node:sqlite')`, inside a
`try`/`catch` whose message names `better-sqlite3 + @electron/rebuild` as the documented fallback
(P0 D2). `out/main/index.js` retains a literal `import("node:sqlite")` — Vite externalizes any
`node:`-prefixed id (`vite/dist/node/chunks/config.js:4279`), which matters because `bun run build`
runs Vite under Bun, and Bun's `module.builtinModules` does **not** contain `sqlite` (measured).
The prefix, not the builtin list, is what makes it work.

**F3 — the whole API is synchronous, and there is no interrupt.**
`DatabaseSync.prototype` = `open, close, prepare, exec, function, createTagStore, location,
aggregate, createSession, applyChangeset, enableLoadExtension, enableDefensive, loadExtension,
serialize, deserialize, setAuthorizer`. `StatementSync.prototype` = `iterate, all, get, run,
columns, setAllowBareNamedParameters, setAllowUnknownNamedParameters, setReadBigInts,
setReturnArrays`. There is no async variant and no `interrupt()`.

**F4 — an INTEGER outside `Number.MAX_SAFE_INTEGER` *throws* unless BigInts are enabled.**
Measured: reading `9007199254740993` raises `RangeError: Value is too large to be represented as a
JavaScript number` with `code: 'ERR_OUT_OF_RANGE'`. `setReadBigInts(true)` (per statement, Node
22.5+) or the `readBigInts` database option (Node **24.4.0**+,
`@types/node/sqlite.d.ts:55-61`) returns every INTEGER as a `BigInt` instead. Both were verified
present in Electron's build; the per-statement setter has the wider version floor.

**F5 — `StatementSync.columns()` is the console path's catalog.** Measured shape per column:
`{ column, database, name, table, type }`, where `type` is the *declared* type of the origin column
(`'INTEGER'`, `'TEXT'`, `null` for an expression or an untyped column) — i.e. the same vocabulary
`pragma_table_xinfo` uses, unlike MariaDB, whose wire types are a second vocabulary
(`mysql-family/console.ts:13-17`).

**F6 — errors carry a machine-readable SQLite result code.** Every failure is an `Error` with
`code: 'ERR_SQLITE_ERROR'`, `errcode: <SQLite result code>` and `errstr`. Measured: `14`
(`SQLITE_CANTOPEN`, *"unable to open database file"*), `26` (`SQLITE_NOTADB`, *"file is not a
database"*), `5` (`SQLITE_BUSY`, *"database is locked"*), `8` (`SQLITE_READONLY`, *"attempt to
write a readonly database"*), `1` (`SQLITE_ERROR`). Open-on-a-closed-handle raises
`ERR_INVALID_STATE` instead.

**F7 — opening a path that does not exist *creates* an empty database.** Measured: a plain
`new DatabaseSync('/tmp/.../created.sqlite')` leaves that file on disk. `{ readOnly: true }` is the
one mode that refuses, with errcode 14. Opening a non-SQLite file throws at construction with
errcode 26 — the header is validated eagerly, not at first query.

**F8 — the open options, with their version floors** (`@types/node/sqlite.d.ts:5-70`, all verified
accepted by Electron's build): `open` (22.5), `enableForeignKeyConstraints` — **default `true`**
(22.10), `enableDoubleQuotedStringLiterals` — default `false` (22.10), `readOnly` (22.12),
`allowExtension` — default `false` (22.13), `timeout` → `busy_timeout` (24.0), `readBigInts` (24.4),
`returnArrays` (24.4). Measured: a freshly opened handle reports `PRAGMA foreign_keys` = `1`, and
`{timeout: 3000}` reports `PRAGMA busy_timeout` = `3000`. Unknown keys are accepted silently, so an
option's presence in the options object proves nothing — each was verified by its effect.

**F9 — `prepare()` silently keeps only the first statement.** Measured:
`db.prepare('SELECT 1 AS a; SELECT 2 AS b;')` succeeds, `get()` returns `{a: 1}`, and
`stmt.sourceSQL` is `'SELECT 1 AS a;'`. The tail is discarded with no error. `db.exec()` runs every
statement but returns no rows.

**F10 — cancellation does not exist, twice over.** There is no `interrupt()` (F3), and because the
API is synchronous, `ctx.signal`'s `abort` event cannot be *delivered* while a statement runs — the
engine's event loop is inside `sqlite3_step`. A between-rows `signal.aborted` check inside
`iterate()` therefore cannot observe a cancel issued during the same statement. `better-sqlite3`
exposes no interrupt either (checked against its documented API surface, not its source, in this
sandbox — flagged in §8, though it does not change D1).

**F11 — measured cost, 1M-row table, `id INTEGER PRIMARY KEY, payload TEXT`, this container:**
insert of 1,000,000 rows via one recursive CTE **999 ms** (24 MB file); `count(*)` **9 ms**;
`count(*)` behind a non-matching `LIKE` (full scan) **73 ms**; `SELECT ... ORDER BY id LIMIT 101`
**~0 ms**; the same with `OFFSET 900000` **18 ms**; keyset `WHERE id > ?` **~0 ms**; `.all()` of all
1M rows **1237 ms**; `.iterate()` over all 1M rows **763 ms**.

**F12 — the runtime split under the two test suites.** `bun test tests/db` (`package.json:31`)
runs the DB suite; **this sandbox's Bun is 1.3.11 and has no `node:sqlite`** (measured, both
installs on PATH: *"No such built-in module: node:sqlite"*; only `bun:sqlite` exists).
`node_modules/bun-types/docs/runtime/nodejs-compat.mdx:174-176` — shipped with the pinned
`bun-types@1.4.0` — states `node:sqlite` is *"🟢 Fully implemented"*, and CI pins
`bun-version: latest` (`.github/workflows/ci.yml:25`), so the intended dev/CI Bun is 1.4+. The UI
suite is different: Playwright's CLI runs under Node (`tests/ui/support/mysql.ts:1-3` says so
outright), and this container's Node 22.22.2 does have `node:sqlite`.

**F13 — `better-sqlite3` would not hit P32's exact wall, and still loses.** `npm view` reports
`better-sqlite3@13.0.3` depending on `node-addon-api ^8` — an N-API addon, so unlike
`@confluentinc/kafka-javascript` (a NAN/V8 addon, `AGENTS.md`'s "Native Kafka driver" section) it is
not ABI-locked per runtime. It would still add: a native dependency to a packaged app, a
`prebuild-install` download per platform/arch, an `asarUnpack` entry, and a second SQLite build
alongside the one Electron already links. Against a builtin, and with F10 unaffected either way,
there is nothing left on its side of the ledger.

### SQLite as an engine

**F14 — there is nothing to connect *to*.** No host, port, user, password, TLS, session id, or
second connection. `shared/domain/connection.ts:83-96`'s `superRefine` currently requires both a
host and a port for every kind not in `AWS_STYLE_KINDS`; `mysql-family/index.ts:345-371`'s
`cancel()` opens a side connection to `KILL QUERY`; `mysql-family/client.ts:58-67` maps `sslmode`.
None of it has a SQLite counterpart.

**F15 — one writer, many readers, and a lock is a real failure mode.** Measured with two handles on
one file: while handle A holds `BEGIN IMMEDIATE`, handle B's `INSERT` fails with errcode 5
(*"database is locked"*) once its busy timeout expires, while B's `SELECT` succeeds throughout.

**F16 — `journal_mode` is a persistent property of the user's file.** Measured:
`PRAGMA journal_mode=WAL`, close, reopen → still `wal`, and `-wal`/`-shm` sidecars appear beside the
file. A fresh file reports `delete`.

**F17 — the catalog is pragmas, and every one of them is bindable.** Verified against 3.53.1:
`PRAGMA database_list` → `{seq, name, file}` for `main`, `temp` and any `ATTACH`ed schema;
`PRAGMA table_list` → `{schema, name, type: 'table'|'view'|'virtual'|'shadow', ncol, wr, strict}`;
`pragma_table_xinfo(?)`, `pragma_index_list(?)` (`{name, unique, origin: 'c'|'u'|'pk', partial}`),
`pragma_index_info(?)`, `pragma_foreign_key_list(?)`
(`{id, seq, table, from, to, on_update, on_delete, match}`); `sqlite_master` → `{type, name,
tbl_name, sql}` where `sql` is the object's own `CREATE` text verbatim. The table-valued forms
(3.16+) take `?` parameters, so **no identifier is ever interpolated** — Adapter rule 7 holds with
no new discipline.

**F18 — `PRAGMA table_info` omits generated columns; `SELECT *` returns them.** Measured on
`g(a INT, b INT GENERATED ALWAYS AS (a*2) VIRTUAL, c INT GENERATED ALWAYS AS (a*3) STORED)`:
`table_info` → `[a]`; `table_xinfo` → `a`/hidden 0, `b`/hidden 2, `c`/hidden 3; `SELECT *` →
`{a, b, c}`; `INSERT INTO g(a,b)` → errcode 1, *"cannot INSERT into generated column \"b\""*. For a
virtual table, `hidden` 1 marks columns `SELECT *` also omits (measured on an FTS5 table:
`body`/0, `docs`/1, `rank`/1).

**F19 — there is no CHECK-constraint catalog.** SQLite has no equivalent of
`information_schema.CHECK_CONSTRAINTS` (which `mysql-family/definition.ts:42-51` joins and which
sets MySQL's 8.0.16 floor). A CHECK is visible only inside `sqlite_master.sql`.

**F20 — there is no row-count catalog either.** `sqlite_stat1` exists only after `ANALYZE`;
measured, it holds `{tbl, idx, stat}` with `stat`'s first token being the row count, and the
`idx IS NULL` row being the table's own. Without `ANALYZE` there is no estimate at any price short
of a real `count(*)`.

**F21 — declared types are affinity hints, and values are dynamically typed.** The declared type is
an arbitrary string mapped to one of five affinities by substring rules (`INT` → INTEGER;
`CHAR`/`CLOB`/`TEXT` → TEXT; `BLOB` or empty → BLOB; `REAL`/`FLOA`/`DOUB` → REAL; else NUMERIC), and
an individual *value* need not match its column's affinity at all. Measured: `columns()`/xinfo
report `'INTEGER'`, `''` (untyped) and `'ANY'` (STRICT) verbatim; a `NUMERIC`-affinity column
holding `'2020-01-01'` comes back as the string.

**F22 — a TEXT value that is not valid UTF-8 comes back lossy.** Measured:
`CAST(x'ff41' AS TEXT)` reads back as `[U+FFFD, 'A']`. The same class of loss as
`mysql-family/query.ts:83`'s `field.string()`, and the reason `typeCastString` hex-encodes binary
columns there (`:81`, `0x<hex>`).

**F23 — every rowid table has a free, stable, unique tiebreaker.** `PRAGMA table_list.wr === 0`
means the table has a `rowid`, selectable and orderable (measured: `SELECT rowid AS rid, a FROM t
ORDER BY rowid`), even with no declared primary key. `WITHOUT ROWID` tables (`wr === 1`) always
have one by definition. This is strictly more than MariaDB/Postgres offer, where a PK-less table
falls back to offset paging (`mysql-family/read.ts:106-114`).

**F24 — Electron's SQLite build, from `PRAGMA compile_options`:** `ENABLE_FTS3`, `ENABLE_FTS3_PARENTHESIS`,
`ENABLE_FTS5`, `ENABLE_RTREE`, `ENABLE_GEOPOLY`, `ENABLE_SESSION`, `ENABLE_PREUPDATE_HOOK`,
`ENABLE_RBU`, `ENABLE_MATH_FUNCTIONS`, `ENABLE_COLUMN_METADATA`, `ENABLE_DBSTAT_VTAB`,
`THREADSAFE=1`, `MAX_ATTACHED=10`, `MAX_COLUMN=2000`, `DEFAULT_SYNCHRONOUS=2`. JSON functions are
built in (3.38+). A virtual table reads through `SELECT` like any other; its shadow tables are
internal.

**F25 — identifiers are double-quoted, and F8's `enableDoubleQuotedStringLiterals: false` default is
load-bearing.** Measured: `SELECT "notacol"` fails with *"no such column: \"notacol\" - should this
be a string literal in single-quotes?"* — i.e. double quotes mean identifier, exactly as
`sqlIdent.ts:29`'s default branch already emits.

**F26 — `sql-text.ts` needs nothing.** Its row-value keyset predicate (`sql-text.ts:22-32`,
`(a, b) > (?, ?)`) and `mysql-family/read.ts:217-229`'s `LIMIT n OFFSET m` were both run against
3.53.1 here and returned the expected rows.

### The connection seam

**F27 — the repo already has a "no host, no port" precedent, and §6 documents its shape.**
`connection.ts:78-96`'s `AWS_STYLE_KINDS` exempts `sqs`/`s3` from the host/port refinement and
repurposes `database` (AWS region) and `username` (named profile); `SPEC.md` §6 spells that out
("S3 connections reuse the existing `connections` columns …"). `ConnectionDialog.vue:214-217,348,
372-389` is the whole renderer consequence. Nothing else in `src/renderer` reads `record.host`
(grep: only `ConnectionDialog.vue`).

**F28 — the URI round trip already works for an absolute path, by accident.**
`uri.ts:34-46`'s `formatConnectionUri` sets `url.pathname = '/' + database`, so a `database` of
`/Users/me/a.sqlite` serialises to **`sqlite:////Users/me/a.sqlite`** — SQLAlchemy's own four-slash
absolute form — and `uri.ts:17`'s `pathname.slice(1)` parses it back to `/Users/me/a.sqlite`
exactly. Verified by simulation. One asymmetry: `parseConnectionUri` decodes `username`/`password`
(`:25-26`) but **not** the pathname, so `/Users/me/my db.sqlite` round-trips as `%20`-escaped text.

**F29 — `canRoundTripToFields` is Postgres-only** (`uri.ts:75-77`), so a URI-mode SQLite connection
could never be switched back to Fields (`ConnectionDialog.vue:101-108` refuses and says why).

**F30 — *Copy URI* runs for every kind.** `project/menus.ts:174-185` calls `formatConnectionUri`
unconditionally, so the URI form has to be correct for SQLite whether or not URI mode is offered in
the dialog.

**F31 — `DEFAULT_PORT` is already a `Partial` and the dialog already tolerates a kind with no
port.** `connection.ts:18` (comment: *"Kinds with no conventional default port are absent"*) and
`ConnectionDialog.vue:150-151` (`if (defaultPort !== undefined) d.port = defaultPort`).

**F32 — P33 shipped an engine-neutral file-open IPC.** `main/ipc/files.ts`'s
`IPC.filesChooseOpen` handler takes **no payload**, sets `properties: ['openFile']` with **no
filters**, `stat()`s the chosen path and returns `{canceled, file: {path, name, size}}`;
`renderer/bridge/control.ts:68` and `preload/index.ts:117` expose it. Its own header comment says
the domain is engine-neutral *"(a future export-to-CSV feature would use the identical handler)"*.

**F33 — the mutation key is the page's PK columns.** `views/grid/pendingChanges.ts:49-59` builds
row identity from *"every column in the current page with `isPrimaryKey === true`"*, and `:126-130`
builds an insert's column list from the non-PK ones. An adapter-internal hidden column can
therefore never be mutation identity.

### The kind seam across the app

**F34 — P34 D17's seam is exactly the extension point.** `views/shared/sqlIdent.ts:18` is
`type SqlDialect = 'postgres' | 'mysql'`; `:21-25` is `sqlDialectFor`; `:27-30`'s `quoteIdent`
**already** double-quotes anything that is not `'mysql'`. Every other consumer gates on truthiness
or maps by value: `editor/languages.ts:125` (`dialect === 'postgres' ? PostgreSQL : dialect ===
'mysql' ? MySQL : undefined`), `views/console/lint.ts:169` (`if (sqlDialectFor(kind)) return
lintSqlConsole`), and eight `sqlDialectFor(record?.kind)` call sites across the grid, console,
definition, cell editor and operations panel. `@codemirror/lang-sql@6.10.0` exports an **`SQLite`**
dialect (`dist/index.d.ts:213,223`).

**F35 — `grouping.ts` needs nothing.** Its only per-connection-kind override is `function` →
"Routines" for mariadb/mysql (`grouping.ts:40-48`); SQLite has no stored routines. `GROUPED_KINDS`
already folders `view`, and `isLeafKind` already covers `table`/`view`.

**F36 — free accent slots.** `tokens.css:77-88` defines thirteen; `ConnectionDialog.vue:34-43`
uses cyan (postgres), blue (mariadb), teal (mysql), green (mongodb), red (redis), amber (kafka),
magenta (sqs), olive (s3). Unused: **orange** `#d1966d`, **indigo** `#979fdd`, **violet** `#b296d2`,
grey `#9fa5ac`.

**F37 — `EngineIcon.vue` fails silently for an unknown kind** (a chain of `v-if="kind === '…'"`,
`:17-46`), and its header claims the marks are 1:1 with
`docs/v1/design/kira-design-system/parts/_icons.html`'s `i-*` symbols (`:68-75`) — which today has
no `i-sqlite`.

**F38 — nothing reads `caps.cancel`, and the contract already covers `false`.** `grep -rn
"caps.cancel" src` matches nothing outside the eight adapter literals (all `true`);
`scheduler/ops.ts:90-105` aborts the local signal and then calls `adapter.cancel(opId)` best-effort;
`adapters/adapter.ts:89-94` already documents *"Adapters with caps.cancel === false return false
unconditionally"*. SQLite would be the first adapter to exercise that sentence.

**F39 — SPEC §1 is already stale about SQLite's neighbour.** It reads *"Explicitly deferred:
MySQL, SQLite-as-target, light mode …"* while §10's P34 row records MySQL as implemented.

### Tests, fixtures and demo data

**F40 — the DB-suite shape, and what SQLite drops from it.** Every `tests/db/*.spec.ts` starts with
`if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE)` and a memoized
one-container-per-process fixture (`tests/db/support/mariadb.ts:27-33,144-151`, whose `stop()`
resets the memo for Playwright's shared worker). SQLite needs **none of it** — no image pin, no
healthcheck, no double-boot wait, no `resolveDockerHost()`, no root-vs-app user split. It needs a
`mkdtemp` and a seed. `tests/ui/fixtures.ts:29-33` already `mkdtemp`s a `KIRA_HOME` per test, so the
UI side has the same tooling. `tsconfig.node.json:22` also typechecks `tests/db/support/**`.

**F41 — the demo stack has no seam for a file-based engine.** `scripts/demo-dbs/docker-compose.yml`
is eight services and `seed.sh` is eight `docker exec` stanzas; nothing there can produce a file on
the developer's own disk, which is the only artefact a SQLite connection can point at.

## 2. Shapes introduced in this plan

```ts
// src/shared/domain/connection.ts — NEW, beside AWS_STYLE_KINDS (F27) and shaped exactly like it.

/** Kinds whose "connection" is a local file path, not a network endpoint (P35 D10/D11). Fields
 *  mode repurposes `database` for the absolute path; host/port/username/password are unused. */
export const FILE_KINDS: ReadonlySet<ConnectionKind> = new Set(['sqlite']);
```

```ts
// src/engine/adapters/sqlite/client.ts — NEW. There is no pool, no side connection and no
// per-database handle set: one file, one DatabaseSync (D17, D18).

export interface SqliteHandle {
  readonly db: DatabaseSync;      // node:sqlite, loaded through a dynamic import (D2)
  readonly file: string;          // the resolved absolute path
  readonly readOnly: boolean;
}

/** Resolves the file path from fields mode (`cfg.database`) or URI mode (the decoded pathname,
 *  F28), stats it (D8: Kira never creates a database), then opens it. */
export async function openDatabase(cfg: ResolvedConnectionConfig): Promise<SqliteHandle>;
```

```ts
// src/engine/adapters/sqlite/query.ts — NEW. The one place a statement is compiled and run.

export interface RunOptions {
  /** Row-shaped read: setReturnArrays(true) so duplicate column names survive (D3). */
  rowsAsArray?: boolean;
  logParams?: boolean;
}

/** Prepares, guards against F9's silently-dropped tail (D9), applies D3's BigInt/array setters,
 *  calls ctx.setCommand() and runs. Honours ctx.signal only *before* the statement — F10 is why
 *  there is no mid-statement check to pretend about. */
export function runQuery<R>(h: SqliteHandle, sql: string, params: unknown[],
                            ctx: OpCtx, opts?: RunOptions): R[];

/** The value→text codec. SQLite is dynamically typed, so this switches on the *value*, never on
 *  the column's declared type (F21): Uint8Array -> `0x<hex>` (mysql-family/query.ts:81's own
 *  convention), bigint -> decimal, number -> String, string -> verbatim, null -> null. */
export function toCellText(value: unknown): string | null;
```

```ts
// src/engine/adapters/sqlite/catalog.ts — NEW.
export interface ReadTarget {
  qualifiedName: { schema: string; table: string };
  columns: ColumnMeta[];
  primaryKey: string[] | null;
  uniqueKeys: string[][];
  /** F23/D22: 'rowid' when this is a rowid table whose columns do not shadow the name; null for
   *  a view or a WITHOUT ROWID table. The last-resort keyset tiebreaker, never mutation
   *  identity (D23). */
  rowidColumn: string | null;
}
```

```sql
-- tests/db/fixtures/0009_sqlite_seed.sql — NEW. A port of 0002_mariadb_seed.sql, not a copy (D34):
-- the same object graph so the same scenarios assert the same things, with every divergence a
-- documented engine difference rather than a convenience.
--   no CREATE SEQUENCE / FUNCTION / PROCEDURE  -> SQLite has none; their absence is asserted
--   ENGINE=InnoDB / charset clauses            -> dropped; SQLite has neither
--   UUID / ENUM / SET / MEDIUMBLOB             -> the five affinity families plus an undeclared
--                                                 column and an `ANY` column in a STRICT table
--   `weird``name` / `Order Items`              -> "weird""name" / "Order Items"  (F25)
-- and four tables that exist only here, each earning a scenario:
--   no_pk_rowid   (no PRIMARY KEY — D22's rowid keyset path)
--   without_rowid (WITHOUT ROWID, TEXT PK)
--   generated_cols(a, b VIRTUAL, c STORED — F18)
--   fts_docs      (CREATE VIRTUAL TABLE ... USING fts5 — the shadow-table filter, F17/F24)
```

## 3. Decisions

### Topic A — the driver and the runtime

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`node:sqlite`. P35 adds no dependency, no native module, no build step and no packaging change.** | F1: it is present in the exact runtime the engine is, over SQLite 3.53.1 with every extension a real user database is likely to need (F24). F2: the app already stakes its own storage on it and the build already externalizes it. F13: `better-sqlite3` is N-API so it would not repeat P32's ABI wall, but it would still add a prebuild download, an `asarUnpack` entry and a second SQLite build to a packaged app — and F10 means it buys no capability the builtin lacks. WASM options (`sql.js`, `node-sqlite3-wasm`) trade a file handle for a memory image, against §2.2. |
| D2 | **Loaded with `await import('node:sqlite')` inside `client.ts`, wrapped in the same catch-and-explain `storage/db.ts:52-59` uses**, whose message names the runtime requirement rather than surfacing `ERR_UNKNOWN_BUILTIN_MODULE`. | F2: the dynamic form is the one already proven to survive `bun run build`. It is also what makes F12's failure legible: under Bun 1.3 the message says *"node:sqlite is unavailable in this runtime (Bun 1.4+, or Electron's own Node, is required)"* instead of a bare module-resolution error, and it keeps `registry.ts:5-11`'s lazy-driver discipline literally true for the seventh engine. |
| D3 | **Every prepared statement gets `setReadBigInts(true)`, and every row-shaped read also gets `setReturnArrays(true)`** — the per-statement setters, not the database-level options. | F4 is not a formatting preference: without it, one `bigint`-range value in a user's table makes the *whole page* throw `ERR_OUT_OF_RANGE`, and `Number` would silently lose precision on the values that do fit. A `BigInt` stringifies exactly, which is all `appendRow` (`page.ts:314`) wants. The per-statement setters carry the wider version floor (22.5/24.4 vs 24.4 for the db options, F8), and `setReturnArrays` is what keeps `SELECT a, a` from collapsing into one key in the console path — the object shape would silently drop a column. |
| D4 | **`caps.cancel = false`, and `cancel()` returns `false` unconditionally. The adapter tracks no running statement and opens no side connection.** | F10, twice: there is no `sqlite3_interrupt` in the API, *and* a synchronous statement blocks the event loop so the abort cannot even arrive. §5.1 is explicit that a driver that cannot cancel declares the capability absent rather than lying, `adapter.ts:89-94` already specifies exactly this return, and F38 shows nothing in the app breaks — the scheduler still aborts locally, so an op that has not yet started still rejects `E_CANCELLED`. This is the first `false` in the app and it is the honest one. |
| D5 | **`execute()` streams rows through `iterate()` into the page builder; `read()`/`count()` stay `.all()`, bounded by `LIMIT pageSize + 1`.** | F11 measures both halves: `iterate` over 1M rows is *faster* than `.all()` (763 ms vs 1237 ms) and never materialises a second copy of the result — one array of rows plus the builder's buffers is one copy too many for §2.2 when the statement is a user's own unbounded `SELECT *`. For `read()`, the result is at most `pageSize + 1` rows by construction, so `.all()` is simpler with nothing to gain from streaming. Note deliberately *not* claimed: a between-rows `signal` check, which F10 proves can never fire. |
| D6 | **The adapter changes nothing persistent about the user's file. No `journal_mode`, no `VACUUM`, no `ANALYZE`, no `synchronous`. The only pragmas issued are `busy_timeout = 5000` and a *read* of `journal_mode`/`page_size` for `ConnectInfo.details`; `enableForeignKeyConstraints` is left at node:sqlite's default `true` and `enableDoubleQuotedStringLiterals` at its default `false`, both stated explicitly in the options object.** | F16: `journal_mode` persists in the file header and spawns `-wal`/`-shm` sidecars — setting it would be Kira quietly modifying a database it was asked only to read. `busy_timeout` is per-connection and matches `storage/db.ts:67` exactly. FK enforcement `ON` matches what every other engine in the app does natively and what `storage/db.ts:66` chooses for Kira's own database, so a delete that would orphan rows fails the same way it would on Postgres. The two explicit lines exist for the same reason `mysql-family/client.ts:24-26` sets `multipleStatements: false` explicitly: F8 shows unknown option keys are accepted silently, so the defaults must be written down or a later Node release can move them under us. Scenario 36 (§5) is the standing guard. |
| D7 | **A read-only connection opens the file `readOnly: true`**, in addition to `mutate()`'s existing guard. | F8/F15: it makes the read-only flag true at the OS level — Kira never takes so much as a write lock on a file the user marked read-only, which for a single-writer engine is a real courtesy to whatever application owns that database. Defence in depth, one line, and measurable (errcode 8, F6). |
| D8 | **Kira never creates a database. `connect()` `stat()`s the path first: missing → `E_NOT_FOUND` naming the path; not a regular file → `E_CONNECT`.** | F7: the default open *creates* an empty file, so a typo'd path would otherwise "connect successfully" to an empty database that Kira itself just wrote into the user's filesystem — the worst possible failure mode for a tool whose §1 promise is that DDL is read-only. `readOnly: true` would refuse on its own (F7) but only for read-only connections, so the check has to be explicit. |
| D9 | **A statement string carrying more than one statement is refused with `E_QUERY`, never silently truncated.** After `prepare()`, the adapter compares the input against `stmt.sourceSQL` and raises if the remainder contains anything but whitespace, `;`, and SQL comments. | F9 is the phase's quietest hazard: `db.prepare('DELETE FROM t WHERE id=1; DELETE FROM t')` runs the first and discards the second with no error at all. MariaDB refuses the same input outright (`multipleStatements: false`), and the console's contract (§8.14, `adapter.ts:115-122`) is one page per statement — a dropped tail would mean a page that silently describes half of what the user asked for. The comment/whitespace tolerance is what stops `SELECT 1; -- done` from being a false positive. |

### Topic B — the connection shape (the plan's central question)

| # | Decision | Rationale |
|---|----------|-----------|
| D10 | **`database` carries the absolute file path. No new column, no migration, no `filePath` field.** `host`, `port`, `username`, `password` stay `null` for a SQLite connection. | F27 is the precedent and it is the app's own stated pattern: §6 already documents SQS/S3 as *"reuse the existing `connections` columns"* with `database` holding the AWS region. A file path is more obviously "the database" than a region ever was. A new column would mean a migration, a Drizzle schema file, a Zod field, an IPC shape change and a `ResolvedConnectionConfig` change — for a value the existing column holds correctly, round-trips through the URI correctly (F28), and displays under a label the dialog already relabels per kind (`ConnectionDialog.vue:372`). Raised as open question 5 because it is the decision most worth arguing with. |
| D11 | **A new `FILE_KINDS` set in `shared/domain/connection.ts` drives validation and the dialog together**, exactly as `AWS_STYLE_KINDS` does: fields mode requires no host and no port for a file kind, and *does* require `database` to be present and absolute. | F27's shape, extended rather than overloaded — folding SQLite into `AWS_STYLE_KINDS` would make that constant's name a lie and would relabel its `database` field "Region". The new refinement is also the first time `database` is validated at all: today an empty database field passes for every kind, which for a file path means a connection that can only ever fail at connect time. Absolute-only (rather than resolving relative paths) because the engine process's cwd is the app bundle — a relative path has no meaning a user could predict. |
| D12 | **SQLite gets no `DEFAULT_PORT` entry, and the dialog shows no port field. Said here explicitly so nobody adds a placeholder later.** | F31: the map is already `Partial` and `onKindChange` already no-ops for a kind without one, so this is a decision to *not* write a line, which is exactly the kind that gets undone by accident. §5.1's table gets an em dash in the port-shaped columns for the same reason. |
| D13 | **URI mode is supported, and `uri.ts`'s two functions need no change.** The form is `sqlite:////absolute/path.sqlite`. Two small honest fixes ride along: `sqlite/client.ts` percent-decodes the path, and `canRoundTripToFields` gains a `sqlite` arm. | F28 is the finding that decides this: the four-slash form falls out of the existing `formatConnectionUri`/`parseConnectionUri` pair with byte-exact round-tripping, and it is the same spelling SQLAlchemy uses for an absolute path. F30 means the URI has to be right anyway — *Copy URI* is offered for every connection. The decode is F28's asymmetry (the pathname is never decoded, so a path with a space arrives `%20`-escaped); doing it in the adapter rather than in `uri.ts` keeps six other adapters' behaviour untouched. F29's arm is five lines and turns "this URI cannot be represented as fields" into the false statement it currently would be. |
| D14 | **The dialog renders, for a file kind: one full-width **Database file** field (keeping the `connection-database` testid) with a **Browse…** button, the Read-only checkbox, the pre-connect fields, and nothing else.** Host, Port, User, Password and the Keychain credential note are all hidden. The field stays a plain, typeable text input. | F14: there are no credentials, so the credential note ("Credentials are encrypted with your macOS Keychain") would be describing something that does not exist. Typeable, not browse-only, for two reasons that are both requirements rather than preferences: the UI suite drives this field with `page.fill()` (there is no way to drive a native `showOpenDialog`), and a path pasted from a README or a `find` result is how most people will actually connect. Keeping the existing testid means `tests/ui/*`'s helpers need no new vocabulary. |
| D15 | **`kira:files:chooseOpen` gains an optional `{ filters, title }` payload**, defaulting to today's exact behaviour, used here for `SQLite database (*.sqlite, *.sqlite3, *.db, *.db3)` plus All files. | F32: the handler's own header claims the domain is engine-neutral, and a file-open dialog with no filters is the one piece of that claim P33 never had a second caller to test. Additive, zod-validated like every other payload in `main/ipc/`, and `state/objectStore.ts:46`'s existing caller is untouched. The alternative — an unfiltered picker — makes the user hunt for a `.sqlite` file among everything else in a directory. |
| D16 | **SQLite takes no per-connection driver options at all.** `cfg.options` is unused; no `mode=ro`, no `immutable`, no `busy_timeout` override. | The file path is the entire configuration (F14). `readOnly` already exists as a first-class connection field and D7 wires it to the real thing; a second, URI-borne spelling of the same idea would be two sources of truth. `immutable=1` is a genuine SQLite option with a genuine use (reading a file on read-only media) and a genuine footgun (silent corruption if the file *is* being written), which makes it a decision for a later phase with a test, not a flag smuggled in here. |

### Topic C — the adapter

| # | Decision | Rationale |
|---|----------|-----------|
| D17 | **`engine/adapters/sqlite/` stands alone. P34's `mysql-family/` "family" pattern does not apply and nothing new is extracted.** The only shared code is `adapters/sql-text.ts`, used unchanged. | A family exists when two engines share a wire protocol and a driver (P34 F1-F3, F17-F19: 1,878 lines of which three differed). SQLite shares neither with anything — different driver, different catalog, different type system, different concurrency model, its own dialect. F26 verified the one genuinely shared module actually runs against 3.53.1: the row-value keyset predicate and `LIMIT n OFFSET m` both behave. Extracting anything else would be inventing a commonality to justify the abstraction. |
| D18 | **The folder carries §11's fixed shape with real content in every file** — `index.ts`, `caps.ts`, `client.ts`, `query.ts`, `catalog.ts`, `read.ts`, `mutate.ts`, `console.ts`, `definition.ts`, `errors.ts` — and no re-export shims. | `SPEC.md:772-774`'s promise is that *"a reviewer already knows where MongoDB's read.ts will be before it exists"*. `mariadb/`'s re-export files exist only because a second engine sits on the same core (P34 D8); there is no second engine here, so a re-export would be shim-for-shim's-sake. `errors.ts` is its own file because SQLite classifies by numeric result code (F6) the way `redis/errors.ts` and `kafka/errors.ts` do, not inline like `mysql-family/query.ts:35`. |
| D19 | **Tree: connection → one node per `PRAGMA database_list` entry (`temp` hidden) → tables and views.** The level uses the existing `database` NodeKind and is named with SQLite's own schema name (`main`); its `detail` is the file's basename. `shadow` rows and `sqlite_`-prefixed names are hidden (the SQLite analogue of `mysql-family/catalog.ts:18`'s system-schema list); `virtual` tables appear as tables. Views are foldered by the renderer's existing `GROUPED_KINDS`. | F17 gives the enumeration for free and F24/F17 give the exclusions: an FTS5 table brings five `shadow` tables with it that no user has any business seeing. Using `database` rather than inventing a NodeKind keeps `grouping.ts`, `menus.ts`, `stickyBand.ts` and every path-shaped assertion working unchanged (F35) — §11's *"a new engine is add one folder, never a change to scheduler/ or cache/"* extends to the renderer here. Stated plainly so nobody is surprised: since Kira never issues `ATTACH`, this level today always contains exactly one node. It is still read from `database_list` rather than hardcoded, because that is the honest source and it costs one pragma. |
| D20 | **`describe()` is five pragmas: `table_xinfo` (columns, keeping `hidden ∈ {0,2,3}`), its `pk` ordinal (primary key), `index_list` + `index_info` (indexes and unique keys), `foreign_key_list` (outbound FKs), and one `foreign_key_list` per sibling table for inbound FKs.** `rowEstimate` comes from `sqlite_stat1` when `ANALYZE` has been run, else `null`. | F18 is why `table_xinfo` and not `table_info`: the latter omits generated columns that `SELECT *` returns, which would make the adapter's own projection silently disagree with the table. `hidden === 1` is excluded because `SELECT *` excludes it too. The inbound-FK scan is the one place SQLite costs more than `information_schema` (there is no reverse index), but it is one bounded pragma per table in one schema, on the describe/definition path only — never on tree expansion — which is the same altitude `mysql-family/index.ts:168-181`'s sequential catalog queries already sit at. F20 is why the estimate is honest-or-absent: the tree already renders it as `~N rows` (`catalog.ts:74-76`) and omits the detail entirely when null. |
| D21 | **`typeClassFor` implements SQLite's five affinity rules over the declared type, plus three sugar cases (`BOOLEAN` → `boolean`, `DATE`/`DATETIME`/`TIMESTAMP` → `temporal`, `JSON` → `json`) and `'other'` for an undeclared or `ANY` column. Separately — and this is the part no other adapter needs — the *value's* own JS type decides its text form** (`Uint8Array` → `0x<hex>`, `bigint` → decimal, `number` → `String`, `string` → verbatim). | F21: the declared type is a hint, not a contract, so a column-driven codec (which is what both other SQL adapters use) would mangle the blob that a TEXT column is perfectly entitled to hold. The `0x` spelling is `mysql-family/query.ts:81`'s, not a new convention, so the cell editor's hex pane behaves identically across engines. The three sugar cases are the same judgement `read.ts:33`'s `tinyint(1)` → `boolean` makes: the engine has no such type, but every schema in the wild spells it that way. F22's replacement character is noted in the code as the one lossy path, exactly as it is lossy on MariaDB. |
| D22 | **Keyset paging uses the primary key, else a unique index, else the implicit `rowid`** — the last only for a rowid table (`table_list.wr === 0`) whose own columns do not shadow the name. It is fetched as a hidden keyset column through the mechanism `read.ts` already has for tiebreakers. Views and text-sorted requests fall back to offset. | F23: SQLite gives every rowid table a stable unique tiebreaker for free, so the PK-less tables where MariaDB and Postgres degrade to offset paging can page properly here. This is the plan's one instance of *"where SQLite's file-based model actually fits it"* being better rather than merely different. The shadow check is not hypothetical: a user column literally named `rowid` wins name resolution, and the predicate would then compare the wrong thing. |
| D23 | **`rowid` is never mutation identity. `mutate()` on a table with no primary key stays `E_UNSUPPORTED`, matching both other SQL adapters.** | F33: the plan's `key` is built by the *renderer* from the page's `isPrimaryKey` columns, so making rowid the mutation key would mean surfacing rowid as a visible page column the user never asked for — a schema Kira invented, shown in a grid. The paging use (D22) is entirely adapter-internal and needs no such exposure. |
| D24 | **`definition()` returns `sqlite_master.sql` verbatim; constraints are composed from the pragmas (PK, UNIQUE, FK); CHECK constraints are *not* listed, and a `notes` line says they appear in the Source text.** | F17: `sqlite_master.sql` is the engine's own `CREATE` text — the exact "asked, never imitated" position `mysql-family/definition.ts:97-101` takes about `SHOW CREATE TABLE`. F19: there is no CHECK catalog at all, so listing them would mean parsing SQL, which is the thing this file exists not to do. An honest note beats an empty section (P23's own `notes` precedent for a denied `describeConfigs`). |
| D25 | **`mutate()` wraps the batch in `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, not a deferred `BEGIN`.** | F15: a deferred transaction takes its write lock at the first write, so a contended file fails *mid-batch*; `IMMEDIATE` takes it up front, so a busy database fails before a single row has changed — which is what "one transaction, all or nothing" (`adapter.ts:108-113`) has to mean when the lock is file-scoped rather than row-scoped. |
| D26 | **`errors.ts` classifies by `errcode`:** 14 `CANTOPEN` → `E_CONNECT` (naming the path), 26 `NOTADB` → `E_CONNECT` (*"this file is not a SQLite database"*), 5 `BUSY` / 6 `LOCKED` → `E_TIMEOUT` (*"the database file is locked by another writer"*), 8 `READONLY` → `E_UNSUPPORTED` (naming the file), everything else → `E_QUERY` with SQLite's message verbatim. `ERR_INVALID_STATE` → `E_CONNECT`. | F6 gives a real numeric vocabulary, so this is classification rather than message-sniffing. `E_TIMEOUT` for BUSY is the accurate code: the failure is the busy timeout expiring, and it is the one SQLite error a retry might legitimately fix. Adapter rule 4 keeps 19 `CONSTRAINT` and 1 `ERROR` verbatim — SQLite's own messages (*"UNIQUE constraint failed: t.a"*) are already better than anything a wrapper would write. |
| D27 | **`sqliteCaps`: `cancel: false`, everything else as the other SQL adapters** — tabular, sql, definition, describe, projection, serverFilter, exactCount, keyset, foreignKeys, canInsert/Update/Delete/writable, transactions all `true`; `fileTransfer: false`. | D4 for `cancel`. `exactCount: true` is not a formality — F11 measures `count(*)` at 9 ms over a million rows, which is cheaper than any other engine in the app. `fileTransfer: false` deserves one sentence in the literal, because SQLite is the one engine where a naive reading of the flag ("it's a file!") is wrong: `fileTransfer` is about an *item* being a file (an S3 object), not about the database being one. |

### Topic D — the kind seam

| # | Decision | Rationale |
|---|----------|-----------|
| D28 | **`SqlDialect` gains `'sqlite'`; `sqlDialectFor` gains one line; `languages.ts` maps it to lang-sql's `SQLite`; `quoteIdent` is not touched.** That is the entire renderer SQL surface. | F34/F25: SQLite quotes identifiers with double quotes, which is already `quoteIdent`'s default branch — but the dialect is still a *member* rather than an alias of `'postgres'`, because it is a real grammar the editor has a real dialect for and because `sqlDialectFor` returning `'postgres'` for a SQLite connection would be a lie the next reader has to decode. Everything else (lint, completion, console, filter box, FK navigation, the operations panel) gates on truthiness and needs nothing. P34 D17 claimed a seventh SQL engine would be one line in one file; this is the phase that tests the claim. |
| D29 | **`KIND_LABEL.sqlite = 'SQLite'`, `KIND_ACCENT.sqlite = 'violet'`, `SUPPORTED_KINDS` gains it.** | F36: violet (`#b296d2`) is free and sits furthest from the four blue-green engines a SQL connection will be listed beside — Postgres cyan, MariaDB blue, MySQL teal. Orange sits next to Kafka's amber; indigo is barely separable from MariaDB's blue at 16 px. Raised as open question 1. |
| D30 | **`EngineIcon.vue` and `parts/_icons.html` gain a matching `sqlite`/`i-sqlite` mark together** — a feather, redrawn as `currentColor` paths at 16 px, not the vendored logo. | F37: a missing branch ships an empty `<svg>` with no error, in the picker, the rail and the tree; and the component's header asserts a 1:1 correspondence with `_icons.html` that adding only one of the two would falsify. Same rule P34 D18 followed. |
| D31 | **Not touched: `grouping.ts`, `menus.ts`'s *Set as default*, `views/console/completion.ts`.** `typeGlossary.ts` gains one `any` entry and rewords the `blob`/`text` glosses that currently claim MariaDB size limits. | F35: no routines, no per-kind label. *Set as default* stays Postgres-only for a stronger reason than MariaDB's — SQLite has no switchable current database at all, only `ATTACH`. The glossary is regex-driven and already covers `integer`/`text`/`blob`/`real`/`numeric` (`typeGlossary.ts:58,62,97,108`), but `blob` reads *"up to 64 KB (MariaDB)"*, which is wrong for a SQLite column showing that type; `ANY` (STRICT tables, F21) has no entry at all. |

### Topic E — tests, fixtures and demo data

| # | Decision | Rationale |
|---|----------|-----------|
| D32 | **`tests/db/support/sqlite.ts` is a temp-file fixture, not a container**: `mkdtemp` → create the file → run `0009_sqlite_seed.sql` through `node:sqlite` → insert 1,000,000 `big_rows` with one recursive CTE → `ANALYZE big_rows` only → return a `ResolvedConnectionConfig` with `database: <path>`. `stop()` removes the directory and resets the memo. | F40: this is the whole harness. No image pin, no healthcheck, no double-boot wait strategy, no root-versus-app-user split, no `resolveDockerHost()` — a file-based engine makes the fixture strictly simpler than any of the other seven, which is the first place SPEC §10's "where SQLite's model actually fits it" cashes out. F11 measures the 1M-row insert at ~1 s, so unlike MariaDB's `seq_1_to_N` or MySQL's chunked cross join there is no reason to gate it behind an option. `ANALYZE` on `big_rows` only, mirroring `0002_mariadb_seed.sql:6-8`'s own note, is what lets scenario 6 still assert a `null` estimate elsewhere (F20). The memo reset is `support/mariadb.ts:144-149`'s Playwright-worker reason, unchanged. |
| D33 | **The suite's gate is `sqliteAvailable()`, not `isDockerAvailable()`** — a legible skip naming the runtime requirement when `node:sqlite` is missing, mirroring `DOCKER_UNAVAILABLE_MESSAGE`'s discipline. | F12: the one thing this suite needs that the environment might not have is a Bun with `node:sqlite` (1.4+). Everything else runs anywhere — which makes `tests/db/sqlite.spec.ts` the first DB spec on this branch that is not Docker-gated at all. |
| D34 | **`0009_sqlite_seed.sql` is a port of `0002`, not a copy** (§2's list), plus four SQLite-only tables that each earn a scenario: `no_pk_rowid`, `without_rowid`, `generated_cols`, `fts_docs`. | `0002`'s own header states the parity principle (*"deliberately kept in parity with 0001_seed.sql so the two spec files can assert the same things"*) and it is what makes a seventh adapter prove the abstraction rather than just exist. Every divergence here is a documented engine difference — no routines, no sequences, no storage engines, no charsets — and the four additions are exactly the four findings that have no analogue anywhere else in the repo (F23, F18, F17/F24). |
| D35 | **`tests/ui/sqlite.spec.ts` must not skip.** It creates its own temp database through the same support module and runs unconditionally. | F39/F40: it needs no container, so it is the first engine UI spec that actually executes in CI *and* in Claude Code's Linux web container — the environment where, per `AGENTS.md`, every other engine's UI spec self-skips. That makes the dialect assertion (D28) and the file-path dialog (D14) genuinely covered rather than covered-in-principle. |
| D36 | **The demo stack gains a `scripts/demo-dbs/sqlite/` seed run by `bun` (no compose service), producing a gitignored `kira-demo.sqlite` beside it, and `seed.sh` prints the absolute path to paste into the dialog.** `docker-compose.yml` is not touched. | F41: there is no service to add — the artefact a SQLite connection needs is a file on the developer's own disk, which no container can put there. The seed script uses `node:sqlite`, the same module the adapter uses, so the demo file is created by exactly the code path the app will read it with. `docker ps` staying eight services rather than showing a phantom ninth is the honest picture. |

### Topic F — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D37 | **Docs the implementing session edits:** SPEC §1 (SQLite leaves the deferred list — and the stale `MySQL` in that same sentence goes with it, F39), §5.1's table (a SQLite row whose cancel column reads *"none — SQLite has no interruptible statement"*), §6 (one sentence mirroring the S3 paragraph: `database` holds the absolute file path, `host`/`port`/`username`/`password` unused), §11's adapters tree, `shared/caps.ts:100-110`'s per-kind table, `README.md:22-31`'s engine table plus a footnote, and `AGENTS.md` (a short section: `tests/db/sqlite.spec.ts` needs Bun 1.4+, needs no Docker, and is the one DB spec that runs in the web container). The §10 phasing row is updated **only once the phase is implemented**. | Standing practice (P34 D33, P27 D34). `AGENTS.md` earns a section because F12 is exactly the class of environment fact that file exists to record — a future session hitting *"No such built-in module"* under an old Bun should find the answer there, not re-derive it. |
| D38 | **No change to `scheduler/`, `cache/`, `shared/protocol/`, any `Page` shape, or `main/` beyond D15's optional filters payload.** | §11's claim that a new engine is one folder. SQLite returns the same `TabularPage` the other SQL adapters do, and `adapters/live.ts` has never known a kind. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and
`bun run build` green. Steps 1–2 are the engine, 3–4 the app surface, 5–7 the tests, 8–9 demo data
and docs. Nothing here needs Docker; steps 5–7 need a Bun/Node with `node:sqlite` (§0).

1. **`feat(shared): the sqlite connection kind and its file-path shape`** —
   `shared/domain/connection.ts` (the enum entry, `FILE_KINDS`, the `superRefine` arms, and
   deliberately no `DEFAULT_PORT` entry) and `shared/domain/uri.ts`'s `canRoundTripToFields` arm
   (D10–D13). No adapter yet: `registry.ts` has no loader, so a SQLite connection is refused by
   `createAdapter`'s existing `E_UNSUPPORTED` (`registry.ts:25-27`) — the same intermediate state
   every kind passed through.
2. **`feat(engine): the SQLite adapter`** — the whole of `adapters/sqlite/` (ten files) plus the
   one `registry.ts` loader line (D1–D9, D17–D27). This is the phase's large commit; the `Adapter`
   interface admits no partial implementation, and a half-adapter with `E_UNSUPPORTED` stubs is
   exactly what `AGENTS.md`'s "no shortcuts, scope left out is left out entirely" forbids.
3. **`feat(main): file-open dialog filters`** — `main/ipc/files.ts`'s optional payload,
   `preload/index.ts`, `renderer/bridge/control.ts` (D15). `state/objectStore.ts` unchanged, which
   is the acceptance criterion.
4. **`feat(renderer): SQLite in the connection dialog, dialect and icons`** — `FILE_KINDS`-driven
   dialog rendering and the Browse button, `KIND_LABEL`/`KIND_ACCENT`/`SUPPORTED_KINDS`,
   `SqlDialect`'s third member and `languages.ts`, `EngineIcon.vue` + `_icons.html`,
   `typeGlossary.ts` (D14, D28–D31). `xvfb-run -a bun run test:ui`'s existing non-Docker specs
   (`smoke`, `startup`, `workbench`, `connections`) are the regression guard and can actually be
   run here.
5. **`test(db): the SQLite file fixture and seed`** — `tests/db/support/sqlite.ts` and
   `tests/db/fixtures/0009_sqlite_seed.sql` (D32–D34).
6. **`test(db): the SQLite adapter scenarios`** — `tests/db/sqlite.spec.ts`, §5's list.
7. **`test(ui): SQLite through the real UI`** — `tests/ui/support/sqlite.ts` and
   `tests/ui/sqlite.spec.ts` (D35). Runs unconditionally; a skip here is a bug.
8. **`chore(demo): a SQLite demo database`** — `scripts/demo-dbs/sqlite/` (seed script + SQL), the
   `seed.sh` stanza, `.gitignore`, and the `demo-dbs/README.md` section (D36).
9. **`docs: SPEC §1/§5.1/§6/§11, the caps table, the README and AGENTS for SQLite`** — D37's edits
   (not the phasing row), and this plan's own commit if it is not already landed.

## 5. Tests

### Existing specs and what must happen to them

| Spec | Why | Change |
|---|---|---|
| `tests/ui/{grid,console,definition,autocomplete,cell-editor}.spec.ts` | D28 widens `SqlDialect` and `languages.ts`. | **No change.** The regression guard for step 4 — a Postgres/MariaDB/MySQL behaviour change shows up here. |
| `tests/ui/connections.spec.ts` | Step 4 restructures the dialog's field block behind `isFileStyle`. | **No change.** It drives the Postgres path; it runs without Docker, so it is the one that can be proven green in every environment. |
| `tests/db/{postgres,mariadb,mysql}.spec.ts` | Untouched — D17 extracts nothing and D38 changes no shared module. | **No change.** Re-run as the guard that `sql-text.ts` really was left alone. |
| `tests/ui/memory.spec.ts` | `registry.ts` gains an eighth lazy loader. | **No source change**, but re-run: the RSS budget must not move. `node:sqlite` is a builtin, so a regression here would mean the loader stopped being lazy, not that a driver got heavier. |

### `tests/db/sqlite.spec.ts` — the scenario list

**1:1 with `mysql.spec.ts`, unchanged in substance:** 3 (tree enumeration), 4 (quoting), 5
(describe), 6 (row estimate), 8 (cap honesty), 9 (children of a leaf), 10–17 (first page, deep page
by offset, keyset forward and backward, no keyset without a tiebreaker, projection, filter and
sort, fidelity, count), 18 (read cannot write), 19 (definition), 20–26 (preview and the six mutate
scenarios), 27–29 (execute), 30–31 (the P13 tripwires: one statement for count, read still resolves
the catalog).

**Adjusted, each for a documented engine difference:**

- **1. connect / disconnect** — `serverVersion` matches `/^SQLite 3\./`; `details` carries the file
  path, `journal_mode` and `page_size` (D6's read-only pragmas). After `disconnect()`, a second
  handle opened by the test can take a write lock immediately — the SQLite equivalent of
  `mysql.spec.ts:1`'s "the session's connect attributes are gone", and the only way to prove the
  handle was really closed.
- **2. auth failure** — **dropped: SQLite has no authentication** (F14). Replaced by three
  connect-failure scenarios that are real here:
  **2a.** a path that does not exist → `E_NOT_FOUND` naming the path, **and `existsSync(path)` is
  still false afterwards** (D8 — the assertion that Kira did not create a database, F7);
  **2b.** a file that is not a SQLite database → `E_CONNECT`, message from errcode 26;
  **2c.** a directory → `E_CONNECT` rather than an unhandled throw.
- **3. tree enumeration** — one `database` node (`main`; `temp` hidden), tables ungrouped, the view
  present, the FTS5 virtual table present as a `table`, **its five `shadow` tables and every
  `sqlite_*` name absent** (F17/F24), and `byKind('sequence')`/`byKind('function')` both `[]`.
- **6. row estimate** — `big_rows` in the 900 k–1.1 M band after the fixture's `ANALYZE`; a
  never-analyzed table reports `rowEstimate: null` (F20/D20), not 0 and not a real count.
- **7. cancel** — **rewritten, not dropped.** `caps.cancel === false`; `adapter.cancel(anyOpId)`
  resolves `false`; and an op whose `AbortSignal` is *already* aborted rejects `E_CANCELLED` before
  the statement runs. That is the whole of the cancellation contract for this engine (D4), and
  asserting it is how the suite stays honest that nothing was quietly given up.
- **19. definition** — the statement text is compared byte-for-byte against a side handle's own
  `SELECT sql FROM sqlite_master`; `constraints` carries the PK, the UNIQUE index and the FK, the
  CHECK is **absent**, and `notes` says where to find it (D24/F19); the text re-executes into a
  fresh temp database; the four `E_UNSUPPORTED`/`E_NOT_FOUND` guards are unchanged.
- **26. mutate: no primary key is `E_UNSUPPORTED`** — asserted against `no_pk_rowid`, i.e. against
  the very table D22 *can* page by rowid, which is what makes D23's boundary visible.
- **32–33. the remaining P13 tripwires** — the running-query map does not exist (D4), so the leak
  guard becomes: a failed connect leaves no open handle and creates no `-wal`/`-shm` file.

**SQLite-specific additions:**

- **34. int64 fidelity** — a column holding `9007199254740993` reads back as that exact decimal
  string on the read path *and* the console path, and does not throw (F4/D3). Without
  `setReadBigInts`, this scenario is an `ERR_OUT_OF_RANGE` crash, not a wrong value — which is why
  it is first among the additions.
- **35. dynamic typing** — a BLOB stored in a `TEXT`-declared column reads as `0x…`; a text value
  stored in an `INTEGER`-declared column reads verbatim; both columns' `typeClass` still reflects
  their *declared* affinity (F21/D21). The scenario that would catch anyone "simplifying"
  `toCellText` into a column-driven codec.
- **36. the file is not modified** — capture the file's bytes (or its `journal_mode`, `mtime` and
  the absence of `-wal`/`-shm`) before a full session (connect → tree → describe → read → definition
  → disconnect) and assert nothing changed; then run a real `mutate()` and assert `journal_mode` is
  *still* the file's original mode (F16/D6). The guard for the phase's central promise.
- **37. keyset paging by rowid** — `no_pk_rowid` pages forward and backward by token with
  `strategy: 'keyset'`, the tokens are stable, and `rowid` never appears in the page's columns
  (F23/D22/D23). Plus: `without_rowid` pages by its declared PK, and the view falls back to
  `offset`.
- **38. generated columns** — `generated_cols` reports all three columns from `describe()` and all
  three come back from `read()` (F18); an `INSERT` that targets the generated one surfaces SQLite's
  own *"cannot INSERT into generated column"* verbatim as `E_QUERY` (Adapter rule 4).
- **39. a locked database is a legible failure** — with an external handle holding
  `BEGIN IMMEDIATE`, a `mutate()` rejects with `E_TIMEOUT` and a message naming the lock after the
  busy timeout, rather than hanging (F15/D26).
- **40. multi-statement input is refused, not truncated** — `execute()` with a single entry
  containing two statements rejects `E_QUERY`; the same two sent as two entries produce two pages;
  `SELECT 1; -- trailing comment` is accepted as one (F9/D9).

### `tests/ui/sqlite.spec.ts` — small, and unconditional (D35)

Same structure as `tests/ui/mysql.spec.ts`, minus the Docker gate and the 240 s container timeout:

- The engine picker shows a **SQLite** tile with a non-empty mark, and picking it shows **no port
  field** and no password field (D12/D14 — the assertions that the file-kind branch really is
  wired, since a missing branch renders the network form silently).
- The **Database file** field accepts a typed absolute path and the connection saves.
- Connecting shows the green dot and a `SQLite 3.` server version in the status tooltip.
- The tree lists `main`, its tables, and a **Views** folder.
- Opening `order_items` renders the grid, and **row context menu → Filter by this value puts a
  double-quoted predicate in the filter box** — the mirror of the MySQL spec's backtick assertion,
  and the direct test of D28.
- The console tab accepts `SELECT 1;` and returns one page (SQL mode, not plain text).

### What is deliberately not added

No unit tests (§9's standing rule). `typeClassFor`'s affinity rules and `toCellText`'s value codec
are pure functions, and scenarios 16, 34 and 35 are where their correctness is observable.

## 6. Explicitly out of scope

- **Creating a database from Kira** (D8). §1 says DDL is read-only; "New SQLite database…" is a
  real feature with a real design (where, with what page size, with what journal mode) and it is not
  this phase. Raised as open question 3.
- **Cancellation, in every form** (F10/D4) — including the worker-thread architecture that would
  keep the engine's event loop responsive during a long statement. That would fix *blocking*, not
  *interruption* (a terminated worker still cannot interrupt a running `sqlite3_step`), it would
  put a second serialization boundary between the adapter and its typed-array pages, and F11 puts
  the exposure for every app-generated query in the tens of milliseconds.
- **`ATTACH` management** — a connection to several files at once. `database_list` is read honestly
  (D19), but Kira never attaches, so the schema level always shows exactly `main`.
- **Extensions** (`allowExtension` stays `false`) and **SQLCipher / encrypted databases**. Loading a
  native extension named by a database file is a code-execution surface, and an encrypted database
  needs a key, which is a credential, which is a whole connection-shape argument this phase just
  spent its budget removing.
- **`immutable=1`, `mode=ro` and every other SQLite URI parameter** (D16).
- **Tree levels for indexes, triggers and virtual-table internals.** §5.1 fixes the level list at
  database → table/view for the SQL engines, and MariaDB's triggers are unrepresented in exactly
  the same way (`mysql-family/definition.ts:131`'s note).
- **`bun:sqlite` as a second driver to make the DB suite runnable on Bun 1.3** (F12). Two drivers
  for one engine, so that a test can run on an older runtime than the app supports, is precisely the
  trade `registry.ts`'s comment and P34 D2 both refuse.
- **libSQL / Turso, `sqlite3` CLI shell-outs, and SQLite-over-network forks.** They may well work
  against this adapter; claiming support means testing it, which is a phase.
- **Any behaviour change to the other six adapters.** D38.

## 7. Target tree at the end of P35

```
src/engine/adapters/
  sql-text.ts                        --  UNCHANGED — verified against SQLite 3.53.1 (F26, D17)
  registry.ts                       MOD  + the sqlite lazy loader (D1)
  sqlite/                           NEW  §11's fixed shape, real content in every file (D18)
    index.ts                        NEW  the Adapter impl: connect/children/describe/definition/
                                         read/count/preview/mutate/execute/cancel(->false, D4)
    caps.ts                         NEW  sqliteCaps — the app's first cancel:false (D27)
    client.ts                       NEW  dynamic node:sqlite import (D2), path resolution from
                                         fields/URI (D13), the stat-first open (D8), D6/D7's pragmas
    query.ts                        NEW  prepare + F9's dropped-tail guard (D9), D3's BigInt/array
                                         setters, toCellText's value-driven codec (D21)
    catalog.ts                      NEW  database_list / table_list / table_xinfo / index_* /
                                         foreign_key_list; ReadTarget incl. rowidColumn (D19, D20, D22)
    read.ts                         NEW  keyset (PK -> unique -> rowid) + offset, typeClassFor (D21, D22)
    mutate.ts                       NEW  BEGIN IMMEDIATE batch, PK-required (D23, D25)
    console.ts                      NEW  iterate-into-the-builder, columns() for descriptors (D5, F5)
    definition.ts                   NEW  sqlite_master.sql verbatim + pragma-composed constraints (D24)
    errors.ts                       NEW  errcode -> AdapterErrorCode (D26)
src/shared/
  domain/connection.ts              MOD  'sqlite' in the enum, FILE_KINDS, the superRefine arms;
                                         deliberately no DEFAULT_PORT entry (D10-D12)
  domain/uri.ts                     MOD  canRoundTripToFields gains a sqlite arm (D13)
  caps.ts                           MOD  the per-kind doc table gains a sqlite row (D37)
src/main/
  ipc/files.ts                      MOD  chooseOpen takes an optional { filters, title } (D15)
src/preload/index.ts                MOD  the same payload passthrough (D15)
src/renderer/
  bridge/control.ts                 MOD  filesChooseOpen(filters?) (D15)
  views/shared/sqlIdent.ts          MOD  SqlDialect gains 'sqlite'; quoteIdent untouched (D28)
  editor/languages.ts               MOD  'sqlite' -> lang-sql's SQLite dialect (D28)
  project/ConnectionDialog.vue      MOD  isFileStyle: the Database file field + Browse, no host/
                                         port/user/password/credential note (D14, D29)
  project/typeGlossary.ts           MOD  an `any` entry; the blob/text glosses stop saying MariaDB (D31)
  theme/EngineIcon.vue              MOD  + the sqlite feather mark (D30)
  project/grouping.ts                --  UNCHANGED (F35, D31)
  project/menus.ts                   --  UNCHANGED — Set as default stays Postgres-only (D31)
tests/
  db/support/sqlite.ts              NEW  temp-file fixture, 1M-row CTE insert, sqliteAvailable() (D32, D33)
  db/fixtures/0009_sqlite_seed.sql  NEW  the ported dataset + four SQLite-only tables (D34)
  db/sqlite.spec.ts                 NEW  the mirrored set + 6 adjusted + 7 SQLite-specific (§5)
  db/{postgres,mariadb,mysql}.spec.ts  --  UNCHANGED — re-run as the sql-text.ts guard
  ui/support/sqlite.ts              NEW  five-line re-export of the db harness
  ui/sqlite.spec.ts                 NEW  the small UI spec; runs unconditionally (D35)
scripts/demo-dbs/
  docker-compose.yml                 --  UNCHANGED — there is no service to add (D36)
  sqlite/seed.ts                    NEW  builds kira-demo.sqlite with node:sqlite
  sqlite/seed.sql                   NEW
  seed.sh                           MOD  + the SQLite stanza, printing the absolute path (D36)
  README.md                         MOD  + the SQLite row: a file, not a host:port
.gitignore                          MOD  + scripts/demo-dbs/sqlite/*.sqlite
docs/
  v1/SPEC.md                        MOD  §1, §5.1, §6, §11 (D37) — phasing row once implemented
  v1/design/kira-design-system/parts/_icons.html   MOD  + the i-sqlite symbol (D30)
  v1/plans/P35-sqlite-adapter.md    NEW  this document
AGENTS.md                           MOD  + the node:sqlite / Bun 1.4 environment note (D37)
README.md                           MOD  + the SQLite engine row and footnote (D37)
package.json                         --  UNCHANGED — no dependency, no devDependency (D1)
```

## 8. Acceptance checklist

**The driver and the connection**

- [ ] `package.json` is byte-identical to its pre-P35 state — no dependency, no devDependency, no
      script.
- [ ] `grep -rn "better-sqlite3\|bun:sqlite" src tests scripts` matches nothing.
- [ ] A connection whose `database` is an absolute path to a real `.sqlite` file connects, and
      `serverVersion` reads `SQLite 3.x`.
- [ ] A path that does not exist fails with `E_NOT_FOUND` **and leaves no file behind**.
- [ ] A non-SQLite file fails with `E_CONNECT` naming "not a SQLite database"; a directory does too.
- [ ] A read-only connection opens the file read-only: a write attempt is refused before it reaches
      the file.
- [ ] `sqlite:////abs/path.sqlite` round-trips through *Copy URI* → paste → Fields, including a path
      containing a space.

**The file is left alone**

- [ ] After a full session (connect, browse, read, definition, mutate, disconnect), the database's
      `journal_mode` is unchanged and no `-wal`/`-shm` file remains that was not there before.
- [ ] `grep -rn "journal_mode\|VACUUM\|ANALYZE" src/engine/adapters/sqlite` matches only a *read* of
      `journal_mode` for `ConnectInfo.details`.

**The adapter**

- [ ] Tree: one `main` node, tables ungrouped, a **Views** folder, the FTS5 virtual table visible,
      its shadow tables and every `sqlite_*` name hidden, no sequence or function kinds.
- [ ] `describe()` returns generated columns, the composite PK, the self-referencing FK and both FK
      directions.
- [ ] A value above `Number.MAX_SAFE_INTEGER` reads back exactly, on both the grid and console paths.
- [ ] A BLOB in a TEXT-declared column reads as `0x…`; the column's `typeClass` still follows its
      declared affinity.
- [ ] A table with no primary key pages by keyset (rowid) and still refuses `mutate()` with
      `E_UNSUPPORTED`; `rowid` never appears as a page column.
- [ ] `definition()` returns `sqlite_master.sql` verbatim, re-executes into a fresh database, lists
      PK/UNIQUE/FK, omits CHECK, and says so in `notes`.
- [ ] Insert, update and delete run in one `BEGIN IMMEDIATE` transaction; a row-count conflict rolls
      the whole batch back; a locked file fails `E_TIMEOUT` rather than hanging.
- [ ] `caps.cancel === false`, `cancel()` returns `false`, and an already-aborted op still rejects
      `E_CANCELLED`.
- [ ] A two-statement string handed to `execute()` as one entry is **refused**, not truncated.

**The kind seam**

- [ ] A grid *Filter by this value* against SQLite produces a **double-quoted** identifier and
      executes; the same against MySQL still produces a backtick-quoted one.
- [ ] The SQLite console highlights and lints SQL.
- [ ] The engine picker's SQLite tile renders a real mark in its accent colour, and `_icons.html`
      carries the same path.
- [ ] The SQLite connection form shows a Database file field with a working Browse button, and no
      host, port, user, password or Keychain note.

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` clean.
- [ ] `xvfb-run -a bun run test:ui` — `smoke`, `startup`, `workbench`, `connections` **and
      `sqlite`** pass, with `sqlite` **not skipped**, in an environment with no Docker.
- [ ] **verify-on-Bun-1.4:** `bun test tests/db/sqlite.spec.ts` green. This sandbox's Bun 1.3.11 has
      no `node:sqlite` (F12), so the suite reports `sqliteAvailable()`'s skip here; it must be run on
      the macOS box or in CI (`bun-version: latest`) before the phase is called done. Sanity-check in
      the meantime: the same fixture and adapter exercised under
      `ELECTRON_RUN_AS_NODE=1 electron`, which *does* have `node:sqlite` here.
- [ ] **verify-on-Bun-1.4:** `setReadBigInts`/`setReturnArrays` behave under Bun's `node:sqlite`
      as they do under Node 24 (D3). Both were measured only under Electron in this sandbox.
- [ ] `bash scripts/demo-dbs/seed.sh` produces `kira-demo.sqlite` and prints a path the dialog
      accepts, with no compose service added.
- [ ] SPEC §1, §5.1, §6, §11, `shared/caps.ts`'s table, the README and `AGENTS.md` all describe what
      shipped.

## 9. Open questions for the user

1. **SQLite's accent colour: `violet`, `orange` or `indigo`?** D29 picks `violet` (`#b296d2`) — free,
   and the furthest from the four blue-green SQL engines it will be listed beside. `orange` sits next
   to Kafka's amber; `indigo` is hard to separate from MariaDB's blue at 16 px. One line either way.
2. **Should a typed `~/path.sqlite` be expanded?** The plan says no: Browse produces absolute paths,
   and `E_NOT_FOUND` names the path it actually tried. Expanding `~` means the renderer or main
   learning about home directories for one engine. The counter-argument is that `~/` is how people
   write paths, and a first-run `E_NOT_FOUND` on a path the user considers valid is a bad greeting.
3. **Should Kira be able to create a new SQLite database file?** D8 says no — §1's DDL-is-read-only
   line, and the alternative is silently creating databases on typos. But "New SQLite database…" is
   the single most obvious missing verb for a file-based engine, and it is a small feature if it is
   an explicit, named action rather than a side effect of connecting.
4. **If the dev box's Bun turns out to be older than 1.4, should the SQLite DB suite follow P32's
   Kafka precedent** and move to `tests/electron-db/` under `ELECTRON_RUN_AS_NODE=1 electron`? D33
   assumes not (CI pins `bun-version: latest` and `bun-types@1.4.0` is already pinned), but the
   fallback exists, costs an esbuild bundling step, and would make the suite runnable everywhere
   including this container.
5. **Is `database` the right column for the path, or should P35 add a real `file_path` column?**
   D10 reuses it, following §6's own S3/SQS wording. A dedicated column would be self-documenting
   at the cost of a migration, a schema file, a Zod field and an IPC shape change — and would leave
   `database` unused for one kind rather than repurposed.
6. **Should a SQLite connection default to read-only?** Not proposed, but worth asking: SQLite is
   single-writer, and the file a developer points Kira at is often a *live application's* database.
   Defaulting the Read-only checkbox on for file kinds would mean Kira never takes a write lock
   unless asked. The counter-argument is that it would make SQLite the one engine that behaves
   differently from every other on first connect.
