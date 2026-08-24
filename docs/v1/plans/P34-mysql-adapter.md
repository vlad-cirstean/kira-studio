# P34 — The MySQL adapter: one driver, two engines, and the kind seam that has to stop being longhand

> SPEC.md §10's **P34** row (`SPEC.md:697`), verbatim:
>
> *"A sixth SQL-family adapter, `engine/adapters/mysql/`, matching the fixed internal shape
> (`index.ts`/`client.ts`/`query.ts`/`definition.ts`/`read.ts`) `postgres/` and `mariadb/` already
> establish, with its own `tests/db/mysql.spec.ts` against a MySQL testcontainer."*
>
> The user's own words: *"add mysql"*.
>
> **The finding the whole phase turns on.** The MariaDB adapter's driver is the `mariadb` npm
> connector (`package.json:64`), and that package is *"fast mariadb or mysql connector"*
> (`node_modules/mariadb/package.json:4`) — a first-class MySQL client with MySQL 8's default
> `caching_sha2_password` handshake implemented
> (`node_modules/mariadb/lib/cmd/handshake/auth/caching-sha2-password-auth.js`), MySQL's
> binary-JSON wire type mapped (`lib/const/field-type.js:29`, *"only for MySQL"*), and three
> MySQL-only options in its public typings (`types/share.d.ts:795-814`). One of those options is
> already set, to `false`, in `mariadb/client.ts:21`. **P34 adds no dependency.** It adds a
> connection kind, a connection-defaults profile, a fixture, and a spec.
>
> **The second finding, and the reason this is not a copy-paste phase.** Of the 1,878 lines under
> `src/engine/adapters/mariadb/`, the parts that genuinely differ for MySQL are: the
> `ConnectionKind` literal, the `serverVersion` label, and one connection option. Everything else —
> every `information_schema` query, the keyset paging, the binary/text decode, the transaction, the
> console runner, `SHOW CREATE TABLE` passthrough — is correct against MySQL 8 unchanged (F8–F12,
> F15). Duplicating it would create two 1,878-line files that must be fixed twice forever, in a
> repo whose own shared-glue module says duplication *"would guarantee they drift"*
> (`sql-text.ts:5-7`). D7 extracts the shared core instead, with the existing MariaDB suites as the
> behaviour-preservation gate.
>
> **The third finding, and the highest-consequence one for the UI.** The renderer's SQL-dialect
> union is written out longhand in **twelve** places as `'postgres' | 'mariadb'` (F22), and the
> fallback for an unrecognised kind is `undefined` — which makes `sqlIdent.ts:7-10` emit
> **double quotes** for identifiers. A MySQL connection that isn't added to every one of those
> sites would silently generate `"column" = 'value'` filters that MySQL rejects. D17 replaces the
> twelve unions with one helper so this is an enum entry, not a twelve-site checklist.

## 0. Ground rules for this phase

- **No new dependency.** `mariadb@3.5.3` is already a runtime dependency and is already a MySQL
  client (F1–F3, F7). Adding `mysql2` would put a second wire-protocol implementation into the
  engine process for an engine the resident one already speaks — against §2.2, and against the
  measured reason `registry.ts:5-10` defers driver imports at all.
- **One implementation, not two similar ones.** P27's §0 rule, applied to an adapter instead of a
  view. The MySQL-family core lives once (D7); the two engine folders keep §11's fixed shape and
  carry only what actually differs.
- **The existing MariaDB suites are the gate, not an afterthought.** `tests/db/mariadb.spec.ts`
  (33 scenarios, 1,558 lines) and `tests/ui/mariadb.spec.ts` must pass **unchanged** after commit 1.
  If a testid or an import path has to move, the extraction is wrong (P27 D26's precedent).
- **Nothing is set on the user's session behind their back.** No `SET SESSION`, no silent
  `sslmode`, no silent `allowPublicKeyRetrieval` (D3, D5, D14). An auth failure says what to do
  (D4) rather than being worked around.
- **The renderer must not learn a third engine name.** A SQL engine's *dialect* is a quoting and
  grammar family, not a product (D17). After this phase, `views/shared/sqlIdent.ts` is the only
  file that knows which kinds are SQL.
- **MySQL is asked, never imitated.** `SHOW CREATE TABLE` output and `information_schema` rows are
  rendered verbatim, exactly as `mariadb/definition.ts:97-101` already promises.
- Comments per AGENTS.md: only where the code cannot say it for itself. Every `D` below that
  encodes a non-obvious constraint gets one line at its implementation site — in particular D3's
  RSA/TLS interaction, which nobody will re-derive from the code.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every commit.
  **Per `AGENTS.md`, `tests/db/mysql.spec.ts` cannot run in Claude Code's Linux web container at
  all** — the outbound policy blocks `production.cloudfront.docker.com`, so `docker pull` can
  resolve the `mysql:8.4` manifest but never fetch its layers, and the suite hangs on a container
  that never starts. Every container-backed assertion in §5 must be run on the macOS/Colima box
  (`colima start`) or in CI before this phase is called done. This is not a "should" — several of
  the MySQL-specific findings below (F5's TLS path, F16's stats caching, the JSON decode in F11)
  are reasoned from the driver source and the servers' documented behaviour and are explicitly
  flagged as **verify-on-container** in §8.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings (verified against the tree and the driver source, not assumed)

### The driver

**F1 — the MariaDB adapter's driver is a MySQL client, shipped as such.** `package.json:64` pins
`"mariadb": "3.5.3"` in `dependencies`. That package describes itself as *"fast mariadb or mysql
connector"* (`node_modules/mariadb/package.json:4`) and its README opens with *"Non-blocking
MariaDB and MySQL client for Node.js"* (`node_modules/mariadb/README.md:14`), positioning itself
directly against `mysql` and `mysql2` (`README.md:31`). This is not a compatibility accident; it is
the package's stated scope.

**F2 — it implements MySQL 8's default authentication plugin, in full.**
`node_modules/mariadb/lib/cmd/handshake/auth/` contains `caching-sha2-password-auth.js`,
`sha256-password-auth.js` and `native-password-auth.js` alongside the MariaDB-only `ed25519` and
`parsec` plugins. The caching-SHA2 state machine covers all three server responses: the fast path
(`:53-57`), full authentication over a secure channel (`:59-77`), and the RSA public-key exchange
for an insecure one (`:79-111`). `lib/const/field-type.js:29` reads
`export const JSON = 245; //only for MySQL` — the driver decodes MySQL's native binary JSON type,
which MariaDB never sends. `types/share.d.ts:795-814` documents `rsaPublicKey`,
`cachingRsaPublicKey` and `allowPublicKeyRetrieval` as *"path/content to **MySQL** server RSA
public key"*.

**F3 — the adapter already sets the one MySQL-only option it needs, to the safe value.**
`mariadb/client.ts:21` is `allowPublicKeyRetrieval: false`. Against MariaDB that line is inert (no
MariaDB auth plugin uses RSA key exchange); it exists because the option is part of the connector's
base config surface. Against MySQL it is load-bearing — see F4.

**F4 — plaintext + `caching_sha2_password` + a cold server-side cache fails closed, with a
driver-side error the adapter currently mismaps.** `caching-sha2-password-auth.js:94-104` throws
`ER_CANNOT_RETRIEVE_RSA_KEY` when the server demands full authentication, the connection is not
secure, and neither `cachingRsaPublicKey` nor `allowPublicKeyRetrieval` is set. That error carries
`errno: 45044` (`lib/misc/errors.js:138`) and, because 45044 is in the driver's own 45000–46000
range, `code: 'ER_CANNOT_RETRIEVE_RSA_KEY'` (`lib/misc/errors.js:23-27`). It is *not* server error
1045, so `mariadb/query.ts:25-27` does not classify it as `E_AUTH` (see F6). Note the trap for
testing: this only fires on a **cold** cache — once a user authenticates successfully once, the
server's SHA2 cache serves the fast path (`:53-57`) and plaintext connections for that user succeed
until `FLUSH PRIVILEGES`.

**F5 — TLS makes it work, and the adapter's existing `sslmode` handling already produces exactly
the right TLS shape.** `caching-sha2-password-auth.js:59-77`: on a secure connection the driver
sends the password in clear over TLS and never needs the RSA key — unless
`info.requireValidCert && info.selfSignedCertificate`, which raises `ER_SELF_SIGNED_SHA256`
(errno 45063, `errors.js:157`). `lib/connection.js:1373-1376` derives
`requireValidCert = opts.ssl === true || (opts.ssl && rejectUnauthorized !== false)` — so
`ssl: { rejectUnauthorized: false }`, which is precisely what `mariadb/client.ts:56` sets for
`sslmode` `require`/`prefer`, yields `requireValidCert === false` and the clear-over-TLS path.
Conversely `connection.js:1382-1391`'s "tolerate a self-signed cert and fingerprint-validate later"
branch is gated on `info.isMariaDB()`, so `mariadb/client.ts:58`'s `sslmode=verify-full`
(`ssl: true`) against a MySQL server's auto-generated self-signed certificate will fail at the TLS
layer — correctly, and that is what `verify-full` means.

**F6 — `mapMariaError` has no branch for either driver-side auth error.** `mariadb/query.ts:22-40`
maps errno 1045 / `ER_ACCESS_DENIED_ERROR` to `E_AUTH`, 1317 to `E_CANCELLED`, four socket codes to
`E_CONNECT`, and everything else — including F4's and F5's — to `E_QUERY`. A user whose MySQL
connection fails at the handshake would see a generic query error carrying a driver-internal
message about `cachingRsaPublicKey`.

**F7 — the binary-vs-text column split works unchanged against MySQL 8.**
`mariadb/query.ts:56-65` decides a column is binary when its type is `VAR_STRING`/`STRING`/a BLOB
family member **and** its collation is named `BINARY`. The driver's collation table has both
entries MySQL 8 needs: `lib/const/collations.js:150` (`63 BINARY`) and `:312`
(`255 UTF8MB4_0900_AI_CI` — MySQL 8's server default, which MariaDB never uses). A collation the
table did not know would leave `field.collation` undefined and the `?.` chain would classify the
column as text — a safe degradation, not corruption.

### The adapter as it stands, measured against MySQL 8

**F8 — every catalog and definition query is portable `information_schema`, and the one join that
could have broken is already written the portable way.** `mariadb/catalog.ts` queries `SCHEMATA`
(`:26-30`), `TABLES` (`:59-65`), `ROUTINES` (`:92-96`), `COLUMNS` (`:128-133`), `STATISTICS`
(`:163-168`) and `KEY_COLUMN_USAGE`+`REFERENTIAL_CONSTRAINTS` (`:208-217`, `:238-247`);
`mariadb/definition.ts:42-51` queries `TABLE_CONSTRAINTS` left-joined to `CHECK_CONSTRAINTS`. All
exist in MySQL 8.0.16+. Critically, that join is `ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME` — MariaDB's `CHECK_CONSTRAINTS` has a `TABLE_NAME`
column and MySQL's does not, so had the query joined on `TABLE_NAME` it would have been
MariaDB-only. It doesn't. `information_schema.CHECK_CONSTRAINTS` first appearing in **MySQL 8.0.16**
is what sets this adapter's server floor (D12).

**F9 — exactly one catalog concept is MariaDB-only, and its code is inert rather than wrong on
MySQL.** MySQL has no sequences. `mariadb/catalog.ts:40-44` maps `TABLE_TYPE` `'SEQUENCE'` to the
`sequence` node kind and `:63-64`'s `ORDER BY CASE` has a `'SEQUENCE'` arm;
`mariadb/index.ts:116-123` treats a `sequence` path as a leaf and `:204-212` rejects `definition()`
for one. Against MySQL, `information_schema.TABLES.TABLE_TYPE` is only ever `'BASE TABLE'`,
`'VIEW'` or `'SYSTEM VIEW'` (the last only inside `information_schema`, which `:18` excludes) — so
the sequence branches are a `Record` lookup that never hits and an `ORDER BY` arm that never
matches. They cost nothing and can stay shared.

**F10 — the system-schema exclusion list is already MySQL's own.** `mariadb/catalog.ts:18` is
`['information_schema', 'performance_schema', 'mysql', 'sys']` — the exact four MySQL ships.
`tests/db/mariadb.spec.ts:120-123` asserts all four are hidden.

**F11 — `typeClassFor`'s `json` branch is dead code on MariaDB and live code on MySQL, and this is
the one type-mapping difference between the engines.** `mariadb/read.ts:40` is
`if (base.startsWith('json')) return 'json';`, reading `information_schema.COLUMNS.COLUMN_TYPE`.
MariaDB's `JSON` is an alias for `LONGTEXT` with an implicit `json_valid()` CHECK — the fixture
itself records this (`tests/db/fixtures/0002_mariadb_seed.sql:141-143`: *"MariaDB has no CAST(... AS
JSON) (JSON isn't a cast target type — it's a LONGTEXT alias)"*), and the driver's own typings say
the same (`types/share.d.ts:44-48`). So on MariaDB that column reads `longtext` and the branch never
fires. MySQL has a native binary JSON type, `COLUMN_TYPE` reads `json`, and the branch fires. The
wire-level counterpart is `mariadb/console.ts:50`'s `field.type === 'JSON'`, which likewise can only
be produced by a MySQL server (F2, `field-type.js:29`). **Nothing needs forking** — the same code is
simply more correct against MySQL than it can be against MariaDB.

**F12 — MySQL 8.0.19+ dropped integer display widths, and the type classifier survives it.**
`COLUMN_TYPE` for an `INT` column reads `int` on MySQL 8.4 and `int(11)` on MariaDB 11.4;
`tinyint(1)` keeps its width on both, because that is how both engines spell boolean.
`mariadb/read.ts:32-36` tests `/^tinyint\(1\)/` first and then a `\b`-anchored alternation, so both
spellings classify identically. The only consequence is that a test asserting a literal `dataType`
string must expect the MySQL spelling.

**F13 — three things in the MariaDB fixture do not exist in MySQL at all.**
`tests/db/fixtures/0002_mariadb_seed.sql:66-70` uses the native `UUID` column type (MariaDB 10.7+);
`:266` is `CREATE SEQUENCE invoice_number_seq`; and `:144` plus `tests/db/support/mariadb.ts:110-113`
use the `seq_1_to_N` pseudo-table from MariaDB's SEQUENCE storage engine, for the 200-element JSON
array and the 1,000,000-row bulk insert respectively.

**F14 — `performance_schema` defaults differ, in MySQL's favour.**
`tests/db/support/mariadb.ts:44-47` has to start the container with `--performance-schema=ON`
because MariaDB ships it off, and it needs it for scenario 1's
`performance_schema.session_connect_attrs` assertion (`tests/db/mariadb.spec.ts:89-99`). MySQL ships
`performance_schema` **on** by default, so the MySQL fixture needs no such flag and the same
assertion works out of the box.

**F15 — cancellation is identical on both engines.** `mariadb/index.ts:320-343` opens a side
connection and issues `KILL QUERY <threadId>`; `query.ts:94` reads `conn.threadId`; `query.ts:28`
maps errno 1317 / `ER_QUERY_INTERRUPTED` to `E_CANCELLED`;
`tests/db/mariadb.spec.ts:379-380` asserts the query is gone from `information_schema.PROCESSLIST`.
All four are MySQL-identical: `KILL QUERY` needs no privilege for your own thread, 1317 is the same
server error number, and `information_schema.PROCESSLIST` still exists in MySQL 8.4 (with
`performance_schema.processlist` as the newer alternative).

**F16 — MySQL caches `information_schema` table statistics and MariaDB does not.** MySQL's
`information_schema_stats_expiry` defaults to 86,400 seconds, so `TABLES.TABLE_ROWS` and
`TABLES.TABLE_COMMENT` can be served from a cache up to a day old unless the session sets it to 0 or
an `ANALYZE TABLE` refreshes it. MariaDB has no such cache, which is why
`tests/db/mariadb.spec.ts:283-294` can assert an exact `rowEstimate` of 3 for a freshly seeded
three-row table. The adapter consumes `TABLE_ROWS` in two places — `catalog.ts:59-65` (the tree's
`~N rows` detail, `:74-76`) and `index.ts:166-172` (`describe().rowEstimate`) — and both already
present the number as an estimate.

**F17 — the adapter is 1,878 lines across nine files, and eight of them are engine-neutral.**
`caps.ts` 25, `catalog.ts` 332, `client.ts` 130, `console.ts` 169, `definition.ts` 166, `index.ts`
370, `mutate.ts` 176, `query.ts` 193, `read.ts` 317. Taking F8–F16 together, the MySQL-specific
surface across all of it is: the `kind` literal (`index.ts:38`), the `serverVersion` prefix
(`index.ts:70`), and one connection option (`client.ts:21`).

**F18 — the repo's shared-glue module states the anti-duplication principle explicitly.**
`src/engine/adapters/sql-text.ts:5-7`: *"The genuinely shared, driver-agnostic glue both SQL
adapters' read.ts call — kept out of the adapter folders because duplicating it would guarantee they
drift (§5e). Everything dialect-shaped (quoting, LIMIT syntax, catalog SQL) stays in each adapter
folder."* Its `buildKeysetPredicate` (`:22-33`) emits a row-value comparison `(a, b) > (?, ?)`,
which MySQL supports, and `mariadb/read.ts:217-229` emits `LIMIT n OFFSET m`, which MySQL accepts.
Neither file needs a change.

**F19 — the counter-precedent for duplication exists too, and it is narrow.**
`mariadb/read.ts:76-77`: `computeEffectiveOrder` is *"identical logic to postgres/read.ts's … kept
as a sibling copy rather than a shared helper because it depends on each adapter's own ReadTarget
shape."* That reasoning does not transfer here: MariaDB and MySQL would share one `ReadTarget`, not
two.

### The kind seam across the app

**F20 — the kind enum and four exhaustive `Record<ConnectionKind, …>` maps; the compiler finds all
of them.** `shared/domain/connection.ts:4-13` is the enum (its trailing comment still says only
Postgres and MariaDB have adapters, which has been stale since P8); `:17-23` is `DEFAULT_PORT`
(`Partial`, so it does not force an entry). The exhaustive maps are
`ConnectionDialog.vue:22-30` (`KIND_LABEL`), `:31-39` (`KIND_ACCENT`), `icons.ts:36-44`
(`CONNECTION_KIND_ICON`), and — as a `Partial`, so not forced — `registry.ts:11-19` (the lazy
adapter loaders). `ConnectionDialog.vue:49` renders `connectionKindSchema.options` directly, so the
engine-picker tile appears the moment the enum grows; `:40-48`'s `SUPPORTED_KINDS` set is what
decides whether it is clickable (`:287-291`).

**F21 — four seams the compiler will *not* catch.** (a) `EngineIcon.vue:17-90` is a chain of
`v-if="kind === '…'"` branches — an unknown kind renders an empty `<svg>` with no error, and the
file's own header (`:5-9`) claims the marks are *"1:1 with parts/_icons.html's i-* engine symbols"*,
where `docs/v1/design/kira-design-system/parts/_icons.html` has `i-postgres` (`:68`) and `i-mariadb`
(`:69`) and no MySQL symbol. (b) `project/grouping.ts:20`'s `labelFor: { mariadb: 'Routines' }` is a
`Partial`, so a missing entry silently falls back to "Functions". (c) `shared/domain/uri.ts:35`
derives the URI scheme from the kind (`mysql` → `mysql://`, already correct) and `:75-77`'s
`canRoundTripToFields` is deliberately Postgres-only (also already correct). (d)
`project/menus.ts:243-247` gates *Set as default* on Postgres with the reason spelled out —
*"MariaDB's console can already switch database with its own `USE db;`"* — which is equally true of
MySQL, so it is correct as written.

**F22 — the SQL-dialect union is longhand in twelve places and its fallback silently breaks
identifier quoting.** The type is declared at `views/shared/sqlIdent.ts:5` as
`'postgres' | 'mariadb' | undefined` and re-declared inline at `editor/languages.ts:112`,
`editor/CodeMirrorHost.vue:23`, `workbench/panels/OperationsPanel.vue:91-93`,
`views/definition/DefinitionView.vue:112-115`, `views/grid/DataGrid.vue:164-168`,
`views/grid/FilterToolbar.vue:28-32`, `views/grid/PreviewCommandPanel.vue:20-24`,
`views/celleditor/CellEditorView.vue:55-59`, `views/console/ConsoleView.vue:54-57`, plus two
kind-tests that are not the union but the same decision: `views/console/lint.ts:168` and
`views/console/completion.ts:119-127`. Every one narrows with
`record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined`. A kind that
is not in that test resolves to `undefined`, and `sqlIdent.ts:7-10` then quotes identifiers with
**double quotes** — so `gridMenu.ts:56` and `:158-159`, which generate *Filter by this value* and
FK-navigation predicates, would emit `"id" = '3'` against a MySQL server that reads that as a string
literal comparison, not a column. `languages.ts:125` would also drop SQL syntax highlighting and
`lint.ts:168` the console linter. None of this is a type error.

**F23 — `connectionKindIcon` has no callers.** `project/icons.ts:36-48` defines
`CONNECTION_KIND_ICON` and `connectionKindIcon`; the header comment says it feeds
*"the icon picker in ConnectionDialog.vue's new connection-kind chooser"*, but that chooser renders
`EngineIcon` (`ConnectionDialog.vue:295-298`). `grep -rn "connectionKindIcon" src` matches only the
definition. It is dead code that the exhaustive `Record` would nonetheless force P34 to extend.

**F24 — nothing in `src/main/` or the engine's scheduler/cache knows a kind.**
`grep -rn "'mariadb'" src/main src/engine src/shared` matches exactly one line —
`shared/domain/connection.ts:6`. `adapters/live.ts` is a `Map<string, Adapter>` with no kind
awareness, and `adapters/adapter.ts:72` types `kind` as the enum without switching on it. §11's
promise that a new engine never touches `scheduler/` or `cache/` holds.

### Tests, fixtures and demo data

**F25 — `@testcontainers/mysql@12.1.0` exists, at exact version parity with the five modules
already pinned.** `package.json:36-41` pins `@testcontainers/{kafka,localstack,mariadb,postgresql,redis}`
all at `12.1.0`; `npm view @testcontainers/mysql dist-tags` reports `latest: 12.1.0`. Its build
exports `MySqlContainer` / `StartedMySqlContainer`, sets `MYSQL_DATABASE`/`MYSQL_ROOT_PASSWORD`/
`MYSQL_USER`/`MYSQL_PASSWORD`, exposes 3306 with a 120 s startup timeout, and — exactly like
`@testcontainers/mariadb`, whose gap `tests/db/support/mariadb.ts:36-38` documents — **sets no wait
strategy or healthcheck of its own**. `getConnectionUri()` emits a `mysql://` URI.

**F26 — the MariaDB test harness is a three-file pattern, and only its container setup is
engine-shaped.** `tests/db/support/mariadb.ts` (153 lines: image pin `:10`, healthcheck `:52-58`,
seed via the connector's own `importFile` `:69-77`, root-only second database and bulk insert
`:83-118`, the `ResolvedConnectionConfig` it hands the adapter `:120-138`), the seed SQL
(`tests/db/fixtures/0002_mariadb_seed.sql`, 291 lines), and the spec
(`tests/db/mariadb.spec.ts`, 33 scenarios). The UI side is a five-line re-export
(`tests/ui/support/mariadb.ts`) plus a deliberately small spec whose stated purpose
(`tests/ui/mariadb.spec.ts:10-11`) is: *"if this passes and no renderer file has a MariaDB branch in
it, the adapter-abstraction claim is proven."* P34 adds renderer branches (F22/D17), so that claim
now needs its own guard.

**F27 — only two files outside `adapters/mariadb/` import from inside it.**
`tests/db/mariadb.spec.ts:6` imports `mariadbCaps` from `mariadb/caps`, and `:7` imports
`RunningQuery` and `runQuery` from `mariadb/query`. Nothing imports `mariadb/catalog`,
`mariadb/mutate` or `mariadb/console`.

**F28 — the demo stack is per-engine and already collides on port 3306.**
`scripts/demo-dbs/docker-compose.yml` has a `mariadb` service bound to `3306:3306` with an
`init.sql` mount and a healthcheck; `scripts/demo-dbs/seed.sh:12-15` pipes `mariadb/seed.sql`
through `docker exec`. A MySQL service in the same file needs a different host port.

**F29 — the docs that enumerate engines, all four of them.** `SPEC.md:182-188` (§5.1's per-database
table), `SPEC.md:728-733` (§11's adapters tree, where `:731` reads *"mariadb/ same shape as
postgres/"*), `SPEC.md:772-774` (the fixed-internal-shape rationale), `src/shared/caps.ts:87-99`
(the per-kind caps table in the doc comment), and `README.md:23-31` (the supported-engines table).

## 2. Shapes introduced in this plan

```ts
// src/engine/adapters/mysql-family/profile.ts — NEW. Everything that genuinely differs between a
// MariaDB connection and a MySQL one, and nothing else (D10). Three fields, deliberately: any
// fourth candidate has to argue for itself as its own decision rather than arrive as a flag.

export interface MysqlFamilyProfile {
  /** The adapter's own kind, surfaced as `Adapter.kind` and used in log lines. */
  readonly kind: Extract<ConnectionKind, 'mariadb' | 'mysql'>;
  /** Prefix for ConnectInfo.serverVersion: 'MariaDB' / 'MySQL' (D6). */
  readonly serverLabel: string;
  /**
   * Engine-specific connection options, applied after the shared host/port/user/ssl handling.
   * MariaDB's is a no-op; MySQL's reads `allowPublicKeyRetrieval` off `cfg.options` (D3).
   */
  applyEngineOptions(
    base: ConnectionConfig,
    cfg: ResolvedConnectionConfig,
    log: AdapterDeps['log'],
  ): void;
}
```

```ts
// src/engine/adapters/mysql-family/index.ts — NEW. The Adapter implementation, moved verbatim from
// mariadb/index.ts with the three profile-driven lines substituted. One class, two engines (D7).
export function createMysqlFamilyAdapter(deps: AdapterDeps, profile: MysqlFamilyProfile): Adapter;

// src/engine/adapters/mysql-family/{client,query,catalog,read,mutate,console,definition}.ts — NEW,
// each moved verbatim from its mariadb/ counterpart. Two edits only:
//   client.ts        buildConnectionOptions() takes the profile and calls applyEngineOptions
//   query.ts         mapError() gains F4's and F5's driver-side auth codes (D4); the exported
//                    name changes from mapMariaError to mapError, since it now serves both
```

```ts
// src/engine/adapters/mysql/ — NEW. §11's fixed shape, with content only where content differs.
//   index.ts       the MySQL profile + createMysqlAdapter(deps)
//   caps.ts        mysqlCaps — a Caps literal, identical values to mariadbCaps (D8)
//   client.ts      applyMysqlOptions() — the allowPublicKeyRetrieval opt-in (D3) — and a
//                  re-export of the shared buildConnectionOptions/ConnectionSet
//   query.ts       re-export: runQuery, runCommand, typeCastString, mapError, RunningQuery,
//                  TrackQuery
//   read.ts        re-export: readPage, countRows, quoteIdent, typeClassFor
//   definition.ts  re-export: buildDefinition
//
// src/engine/adapters/mariadb/ — the same five files plus caps.ts, the four non-client ones
// becoming re-exports. catalog.ts, mutate.ts and console.ts are deleted from both folders: they
// are not part of §11's documented shape and nothing outside the folder imports them (F27).
```

```ts
// src/renderer/views/shared/sqlIdent.ts — the twelve longhand unions collapse to one helper (D17).

/** A quoting-and-grammar family, not a product: every MySQL-wire engine shares one dialect. */
export type SqlDialect = 'postgres' | 'mysql';

/** undefined for a kind with no SQL surface (mongodb, redis, kafka, sqs, s3) or no connection. */
export function sqlDialectFor(kind: ConnectionKind | undefined): SqlDialect | undefined;

// quoteIdent's branch becomes `dialect === 'mysql'` -> backticks; the double-quote default is
// unchanged and now only ever reached for 'postgres'.
export function quoteIdent(dialect: SqlDialect | undefined, name: string): string;
```

```sql
-- tests/db/fixtures/0008_mysql_seed.sql — NEW. A port of 0002_mariadb_seed.sql, not a copy (D27).
-- The three MariaDB-only constructs (F13) and their replacements:
--   UUID columns              -> CHAR(36) (wide_table stays at 59 columns, so spec 3's assertion
--                                is unchanged)
--   CREATE SEQUENCE           -> removed; spec 3 asserts byKind('sequence') is [] instead
--   SELECT ... FROM seq_1_to_200 -> INSERT ... WITH RECURSIVE seq(n) AS (...) SELECT ...
--                                (MySQL's default cte_max_recursion_depth of 1000 covers 200)
-- Everything else — the 59-column wide_table, nulls_and_unicode, composite_pk, the self-referencing
-- employees FK, the regions->customers->orders->order_items<-products graph with its CHECK and its
-- UNIQUE key, big_rows, the view, the function, the procedure, and the two quoting-edge-case
-- tables — is byte-for-byte parallel so the two specs keep asserting the same things.
```

## 3. Decisions

### Topic A — the driver and the connection

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Reuse `mariadb@3.5.3`. P34 adds no runtime dependency.** The MySQL adapter imports the same connector the MariaDB adapter does. | F1–F3, F7: the package is a stated MySQL client, implements MySQL 8's default auth plugin in full, carries MySQL's binary-JSON wire type and MySQL's RSA-key options, and its collation table already knows MySQL 8's default collation. The adapter code already sets one MySQL-only option (`client.ts:21`). Adding an engine that the resident driver already speaks and *not* using it would be a strange kind of purity. |
| D2 | **`mysql2` is not added.** | It would put a second wire-protocol implementation in the engine process for a protocol already implemented there — against §2.2's RSS budget and against the measured reason `registry.ts:5-10` defers driver imports at all (*">100MB of the engine's baseline RSS"*). It would also mean rewriting all 1,878 lines against a different result shape and a different `typeCast` API, which is the opposite of what D7 is for. |
| D3 | **`allowPublicKeyRetrieval` stays `false` and becomes an explicit per-connection opt-in**, read from `cfg.options.allowPublicKeyRetrieval === 'true'` in `mysql/client.ts`, exactly as `sslmode` is read at `mariadb/client.ts:53-62`. | F4: with a cold server-side cache, a plaintext MySQL 8 connection cannot complete `caching_sha2_password` without either TLS or the server's RSA public key. Retrieving that key from an unauthenticated server is an MITM window — the client encrypts the password with a key it cannot verify — which is why the driver defaults it off and why DBeaver ships it as an unchecked box rather than a default. `cfg.options` is already the established channel for exactly this kind of per-connection driver knob, and it round-trips through the URI (`uri.ts:42-44`), so the setting is visible in the connection string rather than hidden in app state. |
| D4 | **`mapError` gains `ER_CANNOT_RETRIEVE_RSA_KEY` (45044) and `ER_SELF_SIGNED_SHA256` (45063) as `E_AUTH`, with a message naming the two remedies** — *"MySQL requires an encrypted connection or the server's public key for this account: add `sslmode=require`, or set `allowPublicKeyRetrieval=true` to accept the server's key over an unencrypted connection."* Shared by both adapters. | F6: today both surface as `E_QUERY` carrying driver-internal prose about `cachingRsaPublicKey` — a dead end for a user whose password is perfectly correct. This is the single most likely first-run failure for a new MySQL connection, so it must be the most legible. Putting it in the shared `query.ts` is harmless for MariaDB, which has no auth plugin that can raise either code. |
| D5 | **`sslmode=require` is documented as the working configuration for MySQL 8+, and the connection dialog does not set it silently.** The `tests/db` fixture sets it (D26); the README's engine notes and the adapter's own error text (D4) say why. | F5: MySQL auto-generates a self-signed certificate at initialisation, so TLS is available on a stock server, and `ssl: { rejectUnauthorized: false }` (what `sslmode=require` already produces) gives `requireValidCert === false` and the clear-password-over-TLS path with no RSA exchange at all. Silently defaulting it would change behaviour for a server with TLS disabled and would put an option in the URI the user never typed. Raised as open question 2. |
| D6 | **`ConnectInfo.serverVersion` is `` `${profile.serverLabel} ${VERSION()}` ``, and the adapter logs a warning — but does not fail — when the MySQL profile finds `MariaDB` in the version string.** | Mirrors `mariadb/index.ts:70` exactly, which `tests/db/mariadb.spec.ts:78` asserts against. The warning matters because pointing the MySQL adapter at a MariaDB server *works* (same driver, same protocol) and would otherwise be invisible until a sequence failed to appear in the tree; failing the connect would be worse, because the connection is genuinely usable. |

### Topic B — one implementation, not two

| # | Decision | Rationale |
|---|----------|-----------|
| D7 | **The shared MySQL-family core lives once, in `src/engine/adapters/mysql-family/`, parameterized by a `MysqlFamilyProfile`. `mariadb/` is refactored onto it in commit 1, before MySQL exists at all**, with `tests/db/mariadb.spec.ts` and `tests/ui/mariadb.spec.ts` passing **unchanged** as the acceptance criterion. | F17 measures the alternative: a 1,878-line copy of which three lines differ, to be maintained in lockstep forever with no compiler or linter able to notice when it stops being. F18 is the repo's own stated position on that (*"duplicating it would guarantee they drift"*), and F19's counter-precedent explicitly turns on the two adapters having different `ReadTarget` shapes — which MariaDB and MySQL do not. Doing the extraction **first**, against a shipped adapter with 33 container-backed scenarios and a UI spec, is what makes it verifiable: if the suites pass unchanged, the extraction is behaviour-preserving, and only then does a second profile get added. This is P26/P27's own sequencing (*"adopting it in the cell editor first, with cell-editor.spec.ts unchanged and green, is what proves the extraction is behaviour-preserving before a second caller depends on it"*). Raised as open question 3, because it is the one decision here that enlarges the phase beyond "add mysql". |
| D8 | **Both engine folders keep §11's five files** — `index.ts`, `client.ts`, `query.ts`, `definition.ts`, `read.ts` — plus `caps.ts`. `index.ts`, `caps.ts` and `client.ts` carry real content; `query.ts`, `read.ts` and `definition.ts` are re-exports of the shared modules. `catalog.ts`, `mutate.ts` and `console.ts` are **deleted** from `mariadb/` and never created in `mysql/`. | The re-exports are not ceremony: `SPEC.md:772-774` promises *"a reviewer already knows where MongoDB's read.ts will be before it exists"*, and F27's two real importers (`tests/db/mariadb.spec.ts:6-7`) must keep compiling against the same paths — which is also what keeps that spec **unchanged** under D7. The three deleted files are not in §11's documented shape and have no importer outside their folder (F27), so a shim for them would be pure noise. |
| D9 | **The profile has exactly three fields (`kind`, `serverLabel`, `applyEngineOptions`) — the sequence branches stay shared and unconditional.** | F9: `TABLE_TYPE_TO_NODEKIND`'s `'SEQUENCE'` entry is a `Record` key a MySQL server can never produce, and the `ORDER BY CASE` arm is a branch no row can match. A `profile.hasSequences` flag would add a decision point to the code and remove nothing from the output. The rule this encodes: a profile field must change observable behaviour, or it does not exist. |
| D10 | **`caps.ts` stays a per-engine literal, not a shared constant.** `mysqlCaps` repeats `mariadbCaps`'s values with the same header comment. | `shared/caps.ts:82-86` is explicit that the per-kind table there is *"documentation, not code (do not create the other adapters' cap literals here)"*, and `mariadb/caps.ts:3-5` makes the point that identical values are a *claim*, per engine, not a shared fact. If MySQL's capabilities ever diverge (a `caps.transactions` nuance, say) the literal is where that is said. Twenty lines is a cheap price for an honest per-engine statement. |
| D11 | **`sql-text.ts` is not touched.** | F18: `buildKeysetPredicate`'s row-value comparison and `mariadb/read.ts:217-229`'s `LIMIT n OFFSET m` are both valid MySQL. The module is already at the right altitude. |

### Topic C — MySQL-versus-MariaDB, concretely

| # | Decision | Rationale |
|---|----------|-----------|
| D12 | **The MySQL adapter's documented server floor is MySQL 8.0.16**, stated in the caps table and the README; the adapter does not probe the version and does not degrade below it — a `definition()` call against an older server surfaces the server's own error. | F8: the only version-sensitive query in the whole adapter is `definition.ts:42-51`'s join to `information_schema.CHECK_CONSTRAINTS`, which MySQL added in 8.0.16 (2019). MySQL 5.7 reached end of life in October 2023. Adding a version probe and a second constraint query for a server nobody should be running is exactly the kind of speculative branch AGENTS.md's "no shortcuts, and scope left out is left out entirely" cuts against — the honest move is to name the floor. |
| D13 | **`typeClassFor` and `typeClassForField` are not forked.** | F11: the `json` branch (`read.ts:40`) and the `field.type === 'JSON'` branch (`console.ts:50`) are dead against MariaDB and live against MySQL. The same code is simply more correct on the newer engine; a fork would produce two files that differ by nothing. F12 likewise: the `\b`-anchored regexes already classify `int` and `int(11)` identically. |
| D14 | **`information_schema_stats_expiry` is left at the server's default; the adapter never issues `SET SESSION`.** The tree detail is already `~N rows` (`catalog.ts:74-76`) and `describe().rowEstimate` is already documented as an estimate. | F16: setting it to 0 would make every tree expansion open every table's storage-engine statistics — a real cost on a large schema, paid on every connection, to sharpen a number the UI already renders with a tilde. §2.1's frame budget and §2.2's "the tree is lazy" both point the other way. What this does change is a **test** assertion (D30): MySQL's cached statistics mean scenario 6 cannot assert an exact `rowEstimate` for a small table the way `mariadb.spec.ts:294` does. Raised as open question 6. |
| D15 | **`SHOW CREATE TABLE` / `SHOW CREATE VIEW` passthrough is unchanged** (`definition.ts:102-151`), including its two notes. | Both engines answer the same statements with the same result-column names (`Create Table` / `Create View`), and the whole point of `definition.ts:97-101` is that the server is asked, not imitated. MySQL's output differs in content — `utf8mb4_0900_ai_ci` collations, version-gated `/*!80000 … */` comments, no implicit `json_valid()` CHECK — and rendering that verbatim is correct, not a divergence to handle. |

### Topic D — the kind seam

| # | Decision | Rationale |
|---|----------|-----------|
| D16 | **`connectionKindSchema` gains `'mysql'` immediately after `'mariadb'`; `DEFAULT_PORT.mysql = 3306`; `registry.ts` gains one lazy loader line.** The stale trailing comment at `connection.ts:12` is corrected while it is being edited. | F20. Enum order drives the engine picker's tile order (`ConnectionDialog.vue:49`), and MySQL belongs next to its family. The comment has claimed "postgres (P1) and mariadb (P2) have adapters so far" since before P8 shipped Mongo. |
| D17 | **The twelve longhand `'postgres' \| 'mariadb'` unions collapse to one `SqlDialect` type and one `sqlDialectFor(kind)` helper in `views/shared/sqlIdent.ts`**, where `'mysql'` is the *family* value covering both MariaDB and MySQL. `quoteIdent` branches on `'mysql'`; `languages.ts` maps `'mysql'` to lang-sql's `MySQL` dialect and `'postgres'` to `PostgreSQL`; `lint.ts:168` becomes `if (sqlDialectFor(kind)) return lintSqlConsole`. | F22 is the highest-consequence silent failure in the phase: an unhandled kind falls to `undefined`, and `sqlIdent.ts:7-10` then emits double-quoted identifiers into `gridMenu.ts`'s generated *Filter by this value* and FK-navigation predicates — invalid SQL that MySQL reads as a string comparison rather than rejecting outright. Making the dialect a *family* rather than a kind is what stops this recurring: `languages.ts:125` **already** maps MariaDB to CodeMirror's `MySQL` dialect, so the family is the concept the code was reaching for. After this, adding a seventh SQL engine is one line in `sqlDialectFor`, and `views/shared/sqlIdent.ts` is the only renderer file that knows which kinds are SQL. |
| D18 | **`EngineIcon.vue` gains a `mysql` branch and `docs/v1/design/kira-design-system/parts/_icons.html` gains the matching `i-mysql` symbol** — a dolphin silhouette drawn as `currentColor` paths at 16px, not the vendored trademark. | F21(a): the `v-if` chain fails silently, so a missing branch ships an empty `<svg>` in the engine picker, the connection rail and the tree. The file's own header states the marks are 1:1 with `_icons.html`, so adding only one of the two would make that comment false. P27's "the design system is compared against, never edited" applies to *redesigning an existing surface*; a genuinely new engine has no symbol to compare against, and the 1:1 invariant is what requires both files to move together. The redraw rule (`EngineIcon.vue:5-9`) — *"the products' own logos, redrawn to 16px as currentColor paths … not the vendored trademarked marks"* — carries over unchanged. |
| D19 | **`KIND_LABEL.mysql = 'MySQL'`, `KIND_ACCENT.mysql = 'teal'`, and `SUPPORTED_KINDS` gains it.** | F20. The accent must be distinguishable at a glance from MariaDB's `blue` (`#7ba8dc`) and Postgres's `cyan` (`#58b4c4`) in the connections rail, since those are the two engines a MySQL connection will most often sit beside. `teal` (`#5fb7a5`, `tokens.css:79`) is unused, is on-brand for MySQL's dolphin, and is the furthest free hue from `blue`. Raised as open question 1 — `orange` and `indigo` are the other free slots. |
| D20 | **`grouping.ts:20`'s `labelFor` gains `mysql: 'Routines'`.** | F21(b): MySQL calls them stored routines exactly as MariaDB does, `information_schema.ROUTINES` is the source for both (`catalog.ts:92-96`), and the `Partial` map fails silently to "Functions" otherwise. §5.1's MariaDB row already specifies the label. |
| D21 | **`CONNECTION_KIND_ICON` and `connectionKindIcon` are deleted from `project/icons.ts`, not extended.** | F23: no caller, and the exhaustive `Record` would otherwise force P34 to invent a codicon for an engine nothing renders that way. P27 D10's precedent — *"dead code that lint does not catch is worse than dead code that does; it reads as live to the next person"* — and the deletion is 13 lines with a grep proving it safe. |
| D22 | **`shared/domain/uri.ts` is not touched, and neither is `project/menus.ts:243-247`.** | F21(c)/(d): `formatConnectionUri:35` already yields `mysql://` for the new kind; `canRoundTripToFields:75-77` is correctly Postgres-only (the MySQL adapter parses URIs itself through `parseConnectionUri`, exactly as `mariadb/client.ts:27-43` documents); and *Set as default* is correctly absent for MySQL for the reason its own comment already gives — `USE db;` is a MySQL statement too. |
| D23 | **`project/typeGlossary.ts:41`'s `SET` description is reworded from "MariaDB's SET type" to name both engines; no entries are added.** | The file is regex-driven over catalog type names and dialect-agnostic by construction; MySQL's scalar type list is a subset of what it already describes. One word of doc accuracy, in a file P34 would otherwise leave saying something narrower than the truth. |

### Topic E — fixtures and tests

| # | Decision | Rationale |
|---|----------|-----------|
| D24 | **The container image is `mysql:8.4`.** | 8.4 is MySQL's current LTS, the mirror of the MariaDB fixture's own LTS pin (`support/mariadb.ts:10`, `mariadb:11.4`). It defaults to `caching_sha2_password`, has dropped the `--default-authentication-plugin` startup option in favour of `authentication_policy`, and ships `mysql_native_password` present-but-disabled — i.e. it is the version whose auth behaviour D3/D4 exist for, rather than an 8.0 image that would let the phase pass without ever exercising them. The official image publishes `linux/arm64`, which the macOS/Colima dev box needs. |
| D25 | **`tests/db/support/mysql.ts` mirrors `support/mariadb.ts` structurally**, including the memoized single container, the `resolveDockerHost()` call, `importFile` for the seed, root-only creation of the second database, and the `stop()` that resets the memo for Playwright's shared worker. Two differences: no `--performance-schema=ON` command (F14), and a `mysqladmin ping` healthcheck instead of `healthcheck.sh`. | F25/F26: `@testcontainers/mysql` sets no wait strategy of its own, and the official MySQL entrypoint boots the server twice during initialisation with the first boot on a socket only — so a TCP-based healthcheck (`mysqladmin ping -h 127.0.0.1 …`) is what distinguishes "initialising" from "ready", exactly the double-boot hazard `support/mariadb.ts:48-51` documents. |
| D26 | **The fixture's `ResolvedConnectionConfig` sets `options: { sslmode: 'require' }`.** | F5/D5: it is the configuration that works against a stock MySQL 8 server without weakening anything, so the suite exercises the path real users are told to use — and scenario 2b (D29) covers the plaintext path deliberately, as a failure assertion, rather than by accident. |
| D27 | **`tests/db/fixtures/0008_mysql_seed.sql` is a port of `0002`, not a copy**, changing only F13's three MariaDB-only constructs: `UUID` → `CHAR(36)` (keeping `wide_table` at 59 columns so `mariadb.spec.ts:162`'s assertion transfers verbatim), no `CREATE SEQUENCE`, and `WITH RECURSIVE` in place of `seq_1_to_200`. | Parity is the point: `0002`'s own header says it is *"deliberately kept in parity with 0001_seed.sql so the two spec files can assert the same things"*, and a third engine only proves the abstraction if it is asked the same questions. Every deliberate divergence therefore has to be a documented engine difference, not a convenience. Two of `0002`'s comments carry over unchanged and matter: `:272-275`'s single-statement stored procedure (the connector's `importFile` splitter has no `DELIMITER` support) and `:104-105`'s `MEDIUMBLOB` for the 256 KB value. The stored function stays `DETERMINISTIC`, which is what keeps `CREATE FUNCTION` legal on a MySQL server with binary logging on (the default) without granting `SUPER` or flipping `log_bin_trust_function_creators`. |
| D28 | **The 1,000,000-row `big_rows` insert uses a six-way cross join over a ten-row digits table, in ten 100,000-row statements, then `ANALYZE TABLE`** — issued from `support/mysql.ts` as root, exactly where `support/mariadb.ts:109-115` issues its `seq_1_to_N` equivalent. | F13: MySQL has no SEQUENCE engine. The digits cross join is MySQL's conventional numbers-table idiom and is materialisation-free, unlike a 1,000,000-deep recursive CTE, which would need `cte_max_recursion_depth` raised past its 1,000 default and would build the whole set in a temporary table. Chunking keeps any single InnoDB transaction to 100 k rows. `ANALYZE TABLE` is required for the same reason `support/mariadb.ts:114` runs it, and doubly so under F16's statistics cache. |
| D29 | **A second, never-authenticated user (`kira_nocache`) is created by the fixture solely for the plaintext-auth scenario, and that scenario is declared first among the MySQL-specific tests.** | F4's cache trap: after any successful authentication, MySQL's SHA2 cache serves the fast path and a plaintext connection for that user *succeeds*, so a scenario that reuses the fixture's main user would pass for the wrong reason (or flake, depending on test order). A dedicated user whose first authentication is the one under test is the only way to assert the cold-cache behaviour honestly. |
| D30 | **`tests/db/mysql.spec.ts` mirrors `mariadb.spec.ts`'s 33 scenarios 1:1, with four adjustments and five MySQL-specific additions** (enumerated in §5). | §9.1 fixes the per-engine scenario list, and F26's parity principle applies to the specs as much as the fixtures: a divergence in coverage would make the two engines' guarantees quietly different. The adjustments are all forced by a documented engine difference (F13's sequences, F16's statistics cache, F12's display widths, D6's version label); the additions are the things only MySQL can be asked. |
| D31 | **One small `tests/ui/mysql.spec.ts` plus a five-line `tests/ui/support/mysql.ts` re-export**, a strict subset of `tests/ui/mariadb.spec.ts`, whose load-bearing assertion is D17's dialect seam: a *Filter by this value* from the grid's row context menu must produce a **backtick**-quoted identifier in the filter box. | F26: the MariaDB UI spec's stated purpose is that no renderer file has an engine branch in it — and P34 adds renderer branches (F22). §9.2 requires UI behaviour to be validated through the real app, and F22's failure mode (double-quoted identifiers in generated SQL) is invisible to `bun run test:db` because it lives entirely in the renderer. Keeping it small keeps the added container time to one engine's worth of startup. |
| D32 | **`scripts/demo-dbs/` gains a `mysql` service on host port 3307, a `mysql/init.sql`, a `mysql/seed.sql` and a `seed.sh` stanza.** | F28: 3306 is taken by the `mariadb` service in the same compose file, and the demo stack's whole purpose is that every engine is up at once. 3307 is the conventional second-MySQL port and goes in the service's own header comment beside the connection URI, matching how every other service documents itself. |

### Topic F — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D33 | **The docs the implementing session edits: `SPEC.md` §5.1's table (a MySQL row beside MariaDB's), §11's adapters tree (`mysql/` and `mysql-family/`), `shared/caps.ts:87-99`'s per-kind table, and `README.md:23-31`'s engine table (plus a note naming the MySQL 8.0.16 floor and `sslmode=require`). The §10 phasing row for P34 is updated **only once the phase is implemented**.** | F29, and standing practice (P27 D34, P24 D41, P22 D11). The phasing table is a record of what shipped, not a plan. §11's tree gains one line for `mysql-family/` because D7 introduces a directory §11 does not currently describe, and §11 is the document that promises a reviewer knows where things are. |
| D34 | **No change to `scheduler/`, `cache/`, `main/`, `shared/protocol/` or any `Page` shape.** | F24: nothing outside `shared/domain/connection.ts` and `adapters/registry.ts` knows a kind, and MySQL returns the same `TabularPage` MariaDB does. §11's claim that a new engine is *"add one folder matching this shape, never a change to scheduler/ or cache/"* is a claim this phase gets to prove rather than amend. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and
`bun run build` green. Steps 1–2 are the extraction, 3 is the engine, 4–5 the renderer, 6–8 the
tests, 9–10 demo data and docs. Container-backed suites cannot run in the Linux web container
(§0) — they are run on macOS/Colima at the points marked.

1. **`refactor(engine): extract the shared MySQL-family adapter core`** — create
   `adapters/mysql-family/` (`profile.ts`, `index.ts`, `client.ts`, `query.ts`, `catalog.ts`,
   `read.ts`, `mutate.ts`, `console.ts`, `definition.ts`) by **moving** the MariaDB files
   unchanged, substituting the three profile-driven lines (`kind`, `serverLabel`,
   `applyEngineOptions`) and renaming `mapMariaError` → `mapError`. `mariadb/` keeps `index.ts`
   (the MariaDB profile + `createMariaDbAdapter`), `caps.ts` and `client.ts`, and gains re-export
   `query.ts` / `read.ts` / `definition.ts`; `mariadb/catalog.ts`, `mutate.ts` and `console.ts` are
   deleted (D7–D10). **Acceptance: `tests/db/mariadb.spec.ts` and `tests/ui/mariadb.spec.ts` pass
   with zero source changes** (macOS/Colima).
2. **`fix(engine): map the connector's RSA-key auth failures to E_AUTH`** — `mysql-family/query.ts`'s
   `mapError` gains errno 45044 / 45063 with D4's message. No MySQL yet; MariaDB behaviour is
   unchanged because neither code is reachable there.
3. **`feat(engine): the MySQL adapter`** — `shared/domain/connection.ts` (enum + `DEFAULT_PORT` +
   the stale comment), `adapters/registry.ts`'s loader line, and `adapters/mysql/`
   (`index.ts` with the profile, `caps.ts`, `client.ts` with `applyMysqlOptions`, and the three
   re-exports). At the end of this commit the engine can connect to MySQL; the renderer cannot yet
   quote for it (D16, D1, D3, D6, D8).
4. **`refactor(renderer): one SQL dialect helper for every SQL engine`** — `SqlDialect` and
   `sqlDialectFor` in `views/shared/sqlIdent.ts`; all twelve sites from F22 adopt it;
   `quoteIdent` branches on `'mysql'`; `languages.ts` and `CodeMirrorHost.vue` take `SqlDialect`
   (D17). Behaviour for Postgres and MariaDB is unchanged — `xvfb-run -a bun run test:ui`'s
   existing grid, console, definition and autocomplete specs are the regression guard.
5. **`feat(renderer): MySQL in the connection dialog, tree and icons`** — `KIND_LABEL`,
   `KIND_ACCENT`, `SUPPORTED_KINDS`, `grouping.ts`'s `labelFor`, `EngineIcon.vue`'s path and
   `_icons.html`'s `i-mysql` symbol, the `typeGlossary.ts` wording, and the deletion of
   `connectionKindIcon`/`CONNECTION_KIND_ICON` (D18–D21, D23).
6. **`test(db): MySQL testcontainer fixture and seed`** — `package.json` gains
   `@testcontainers/mysql@12.1.0` (devDependency); `tests/db/support/mysql.ts` and
   `tests/db/fixtures/0008_mysql_seed.sql` (D24–D28). Verified by starting the container and
   running one throwaway assertion before step 7 lands (macOS/Colima).
7. **`test(db): the MySQL adapter scenarios`** — `tests/db/mysql.spec.ts`, §5's list.
   `bun run test:db` green (macOS/Colima), `bun run typecheck:db` green everywhere.
8. **`test(ui): MySQL through the real UI`** — `tests/ui/support/mysql.ts` and
   `tests/ui/mysql.spec.ts` (D31). `xvfb-run -a bun run test:ui` green (macOS/Colima).
9. **`chore(demo): a MySQL service in the demo compose stack`** — the compose service on 3307,
   `mysql/init.sql`, `mysql/seed.sql`, the `seed.sh` stanza and the `demo-dbs/README.md` row (D32).
10. **`docs: SPEC §5.1/§11, the caps table and the README for MySQL`** — D33's edits (not the
    phasing row), and this plan's own commit if it is not already landed.

## 5. Tests

### Existing specs and what must happen to them

| Spec | Why | Change |
|---|---|---|
| `tests/db/mariadb.spec.ts` (33 scenarios) | D7 moves every file it exercises. | **No change permitted.** Passing unchanged is commit 1's acceptance criterion; F27's two imports (`mariadb/caps`, `mariadb/query`) are exactly what D8's re-exports exist to preserve. If either import has to move, the extraction is wrong. |
| `tests/ui/mariadb.spec.ts` | Same, plus D17 rewrites the dialect plumbing its grid assertions ride on. | **No change.** Re-run and shown green after commits 1 and 4. |
| `tests/ui/{grid,console,definition,autocomplete,cell-editor}.spec.ts` | D17 touches `sqlIdent.ts`, `languages.ts`, `CodeMirrorHost.vue`, `lint.ts`, `completion.ts` and six view components. | **No change.** These are the regression guard for commit 4 — a Postgres/MariaDB behaviour change would show up here. |
| `tests/ui/memory.spec.ts` | `registry.ts` gains a seventh lazy loader; the extraction changes which module objects the engine holds. | **No source change**, but re-run: the RSS budget must not move. D7 should be neutral-to-better (one core instead of two copies), and a regression would mean the re-export shims are pulling the shared core in eagerly for a session that never connects. |
| `tests/db/postgres.spec.ts` | Untouched by everything here. | **No change.** Re-run as the guard that `sql-text.ts` really was left alone (D11). |

### `tests/db/mysql.spec.ts` — the scenario list

**1:1 with `mariadb.spec.ts`, unchanged in substance:** 2 (auth failure → `E_AUTH`), 4 (quoting —
`` weird`name `` and `Order Items`), 5 (describe: columns, PK, indexes, outbound and inbound FKs),
7 (cancel, asserted server-side through `information_schema.PROCESSLIST`), 8 (cap honesty),
10–17 (first page, deep page by offset, keyset forward and backward, no keyset without a
tiebreaker, projection, filter and sort, fidelity, count), 18 (read cannot write),
19 (definition: `SHOW CREATE TABLE` passthrough compared against a side connection's own output,
constraints including the `order_items_quantity_positive` CHECK, the view's `DEFINER=`, the
round-trip into a fresh database, and the four `E_UNSUPPORTED`/`E_NOT_FOUND` guards),
20–26 (preview, and the six mutate scenarios), 27–29 (execute), 30–33 (the P13 regression
tripwires: one statement for count, the read path still resolving the catalog, the running-query
map not growing, a failed connect leaving nothing open).

**Adjusted, each for a documented engine difference:**

- **1. connect / disconnect** — `serverVersion` matches `/^MySQL 8\.4\./` (D6). The
  `performance_schema.session_connect_attrs` assertion is unchanged and needs no container flag
  (F14). Additionally asserts that the connection was made over TLS
  (`SHOW SESSION STATUS LIKE 'Ssl_cipher'` is non-empty), since D26 is what makes the whole suite's
  auth path work and a silent fallback to plaintext would hide scenario 2b's meaning.
- **3. tree enumeration** — `byKind('sequence')` is **`[]`**, not `['invoice_number_seq']` (F13);
  `byKind('view')`, `byKind('function')` and the 59-column `wide_table` assertion are unchanged;
  the four system schemas are still hidden (F10).
- **6. row estimate** — `big_rows`' estimate still asserts the 900 k–1.1 M band after D28's
  `ANALYZE TABLE`, but the small-table assertion becomes
  `rowEstimate === null || rowEstimate <= 10` with a comment naming
  `information_schema_stats_expiry` (F16/D14) — MySQL may serve a cached or absent value where
  MariaDB serves an exact 3.
- **9. children of a leaf** — the leaf is a `view` (`order_summary`) rather than a `sequence`,
  since MySQL has none (F13). The assertion — `children()` returns `[]` and never throws — is
  unchanged.

**MySQL-specific additions:**

- **2b. plaintext `caching_sha2_password` fails with an actionable `E_AUTH`, and both documented
  remedies work** (D3/D4/D29, the phase's central risk). Using the never-authenticated
  `kira_nocache` user, and declared before anything can warm the server's SHA2 cache: (a) with no
  `sslmode` and no `allowPublicKeyRetrieval`, `connect()` rejects with `code: 'E_AUTH'` and a
  message naming both `sslmode` and `allowPublicKeyRetrieval`; (b) the same config plus
  `options: { sslmode: 'require' }` connects; (c) a **third** user, also cold, plus
  `options: { allowPublicKeyRetrieval: 'true' }` and no TLS, also connects. This is the scenario
  that fails today against `mariadb/query.ts:22-40` (F6) and the reason D4 exists.
- **2c. `sslmode=verify-full` against the container's self-signed certificate is rejected** (F5) —
  `connect()` rejects rather than silently downgrading. The guard that
  `connection.js:1382-1391`'s self-signed tolerance really is MariaDB-only and that a user asking
  for full verification gets it.
- **34. a JSON column classifies as `json`, on both the read path and the console path** (F11/D13) —
  `describe()`/`read()` report `typeClass: 'json'` for `wide_table.json_a` (where the MariaDB spec
  can only ever see `text`), and `execute('SELECT json_a FROM wide_table')` reports the same for its
  column descriptor, exercising `console.ts:50`'s `field.type === 'JSON'` branch — which no
  MariaDB server can reach. Includes a unicode value inside the JSON document, read back
  byte-identical, as the guard that MySQL's binary-collation JSON metadata does not push the value
  through the binary/hex path (F7).
- **35. integer display widths are absent and `tinyint(1)` still means boolean** (F12) —
  `wide_table.int_a`'s `dataType` is `int` (not `int(11)`) while `bool_a`'s is `tinyint(1)`, and
  their `typeClass`es are `number` and `boolean` respectively. One assertion, but it is the one
  that would catch a future regex tightening in `read.ts:31-44` breaking one engine and not the
  other.
- **36. `nested_json`'s 200-element array survived the `WITH RECURSIVE` port** (D27) — the deep
  value reads back with 200 items, the guard that the fixture port did not quietly shrink the
  dataset the paging and truncation scenarios lean on.

### `tests/ui/mysql.spec.ts` — deliberately small (D31)

Same structure as `tests/ui/mariadb.spec.ts` (`test.describe.configure({ timeout: 240_000 })`, a
`beforeAll` that skips cleanly when Docker is unavailable, one connection created through the real
dialog):

- The engine picker shows a **MySQL** tile with a non-empty engine mark (D18/D19 — an empty `<svg>`
  is exactly what F21(a) makes possible), and picking it prefills port 3306.
- Connecting shows the green dot and a `MySQL 8.4` server version in the connection's tooltip/status
  (D6).
- The tree lists `kira_test`, its tables and its `Routines` folder (D20 — the label, not
  "Functions").
- Opening `order_items` renders the grid, and **row context menu → Filter by this value puts a
  backtick-quoted predicate in the filter box** (D17 — the assertion this spec exists for), which
  then executes and narrows the grid.
- The console tab accepts `SELECT 1;` and returns one page (D17's `lint.ts`/`languages.ts` half:
  the editor is in SQL mode, not plain).

### What is deliberately not added

No unit tests (§9's standing rule). `sqlDialectFor` is a pure function, but its correctness is
observable only through the two assertions above, which is where they live.

## 6. Explicitly out of scope

- **MySQL 5.7 and anything below 8.0.16** (D12). EOL since 2023, and the `CHECK_CONSTRAINTS` floor
  is stated rather than worked around.
- **`mysql2`, or any second driver** (D2).
- **A per-engine advanced-options UI in the connection dialog.** `sslmode` and
  `allowPublicKeyRetrieval` are typed into the options record or the URI query string exactly as
  every other driver knob is today. Giving the dialog real per-engine option fields is a genuine
  feature with its own design (which options, per kind, validated how) and it would touch all seven
  engines, not one. Raised as open question 4.
- **Changing MariaDB's CodeMirror dialect from `MySQL` to `MariaSQL`.** `languages.ts:125` picks
  `MySQL` for MariaDB today and D17 preserves that; whether lang-sql's `MariaSQL` is a better fit is
  a MariaDB question P34 did not raise.
- **MySQL-specific tree levels**: partitions, triggers, events, or a replication/group-replication
  topology. §5.1's MariaDB row fixes the level list for the family (database → table/view/routine),
  and adding levels for one engine would break the parity F26 relies on. Triggers stay unrepresented
  in exactly the way `definition.ts:131`'s note already says.
- **The MySQL X Protocol / document store.** A different port, a different protocol, and a
  document-shaped page for an engine whose caps say `tabular`.
- **Compatibility claims for MySQL-protocol forks** (TiDB, Vitess/PlanetScale, MariaDB's own
  `MAXSCALE`). They may well work — the driver and the queries are portable — but claiming support
  means testing it, and that is a phase, not a footnote.
- **Any behaviour change to the MariaDB adapter.** D7 moves its code; commit 1's acceptance
  criterion is that nothing it does changes.
- **`SET SESSION information_schema_stats_expiry = 0`** (D14). Raised as open question 6.
- **Retiring `postgres/`'s own duplication.** `postgres/read.ts` and `mariadb/read.ts` share
  `computeEffectiveOrder` by copy for the reason `read.ts:76-77` gives; D7 unifies the *MySQL
  family*, not the two SQL families, and widening it to Postgres would need a third `ReadTarget` to
  agree.

## 7. Target tree at the end of P34

```
src/engine/adapters/
  sql-text.ts                        --  UNCHANGED (D11)
  registry.ts                       MOD  + the mysql lazy loader (D16)
  mysql-family/                     NEW  the shared MySQL-wire core, one implementation (D7)
    profile.ts                      NEW  kind / serverLabel / applyEngineOptions — three fields (D9)
    index.ts                        NEW  the Adapter class, moved from mariadb/index.ts
    client.ts                       NEW  moved; buildConnectionOptions takes the profile
    query.ts                        NEW  moved; mapMariaError -> mapError, + RSA auth codes (D4)
    catalog.ts                      NEW  moved verbatim (sequence branches stay, inert on MySQL)
    read.ts                         NEW  moved verbatim
    mutate.ts                       NEW  moved verbatim
    console.ts                      NEW  moved verbatim
    definition.ts                   NEW  moved verbatim
  mariadb/
    index.ts                        MOD  the MariaDB profile + createMariaDbAdapter
    caps.ts                          --  UNCHANGED (a per-engine literal, D10)
    client.ts                       MOD  no-op applyEngineOptions + re-export
    query.ts                        MOD  re-export (keeps tests/db/mariadb.spec.ts:7 compiling)
    read.ts                         MOD  re-export
    definition.ts                   MOD  re-export
    catalog.ts / mutate.ts / console.ts   DEL  moved to mysql-family/ (D8; no outside importer)
  mysql/                            NEW  §11's fixed shape (D8)
    index.ts                        NEW  the MySQL profile + createMysqlAdapter
    caps.ts                         NEW  mysqlCaps — same values, stated per engine (D10)
    client.ts                       NEW  applyMysqlOptions: allowPublicKeyRetrieval (D3)
    query.ts / read.ts / definition.ts   NEW  re-exports of the shared core
src/shared/
  domain/connection.ts              MOD  'mysql' in the enum, DEFAULT_PORT.mysql, stale comment (D16)
  domain/uri.ts                      --  UNCHANGED (D22)
  caps.ts                           MOD  the per-kind doc table gains a mysql row (D33)
src/renderer/
  views/shared/sqlIdent.ts          MOD  SqlDialect + sqlDialectFor; quoteIdent branches on 'mysql' (D17)
  editor/languages.ts               MOD  takes SqlDialect (D17)
  editor/CodeMirrorHost.vue         MOD  sqlDialect prop takes SqlDialect (D17)
  views/console/lint.ts             MOD  gates on sqlDialectFor (D17)
  views/console/completion.ts       MOD  comment + the SQL test via sqlDialectFor (D17)
  views/console/ConsoleView.vue     MOD  adopts sqlDialectFor (D17)
  views/definition/DefinitionView.vue   MOD  adopts sqlDialectFor (D17)
  views/grid/DataGrid.vue           MOD  adopts sqlDialectFor (D17)
  views/grid/FilterToolbar.vue      MOD  adopts sqlDialectFor (D17)
  views/grid/PreviewCommandPanel.vue    MOD  adopts sqlDialectFor (D17)
  views/celleditor/CellEditorView.vue   MOD  adopts sqlDialectFor (D17)
  workbench/panels/OperationsPanel.vue  MOD  adopts sqlDialectFor (D17)
  project/ConnectionDialog.vue      MOD  KIND_LABEL / KIND_ACCENT / SUPPORTED_KINDS (D19)
  project/grouping.ts               MOD  labelFor.mysql = 'Routines' (D20)
  project/icons.ts                  MOD  CONNECTION_KIND_ICON + connectionKindIcon deleted (D21)
  project/typeGlossary.ts           MOD  the SET description names both engines (D23)
  project/menus.ts                   --  UNCHANGED (D22)
  theme/EngineIcon.vue              MOD  + the mysql mark (D18)
tests/
  db/support/mysql.ts               NEW  mysql:8.4, mysqladmin healthcheck, seed, big_rows (D24-D28)
  db/fixtures/0008_mysql_seed.sql   NEW  the ported dataset (D27)
  db/mysql.spec.ts                  NEW  33 mirrored + 4 adjusted + 5 MySQL-specific (D30, §5)
  db/mariadb.spec.ts                 --  UNCHANGED — commit 1's acceptance gate
  db/postgres.spec.ts                --  UNCHANGED — re-run as the sql-text.ts guard
  ui/support/mysql.ts               NEW  five-line re-export of the db harness (D31)
  ui/mysql.spec.ts                  NEW  the small UI spec; the backtick assertion (D31)
  ui/mariadb.spec.ts                 --  UNCHANGED — re-run after commits 1 and 4
scripts/demo-dbs/
  docker-compose.yml                MOD  + the mysql service on 3307 (D32)
  mysql/init.sql                    NEW
  mysql/seed.sql                    NEW
  seed.sh                           MOD  + the MySQL stanza (D32)
  README.md                         MOD  + the MySQL row (D32)
docs/
  v1/SPEC.md                        MOD  §5.1 table, §11 tree (D33) — phasing row once implemented
  v1/design/kira-design-system/parts/_icons.html   MOD  + the i-mysql symbol (D18)
  v1/plans/P34-mysql-adapter.md     NEW  this document
package.json                        MOD  + @testcontainers/mysql@12.1.0 (devDependency only, D24)
```

## 8. Acceptance checklist

**The extraction**

- [ ] `tests/db/mariadb.spec.ts` and `tests/ui/mariadb.spec.ts` pass with **zero** source changes
      after commit 1.
- [ ] `grep -rn "adapters/mariadb" src tests` matches only `tests/db/mariadb.spec.ts:6-7`, as it
      does today.
- [ ] `grep -rn "mapMariaError" src` returns nothing.
- [ ] No file under `src/engine/adapters/mysql/` duplicates a query, a type map or a page builder
      that exists under `mysql-family/`.
- [ ] `tests/ui/memory.spec.ts`'s RSS budget passes, measured, and is no worse than before.

**The driver and the connection** *(every item here is verify-on-container — see §0)*

- [ ] `package.json`'s `dependencies` are unchanged; the only addition anywhere is
      `@testcontainers/mysql@12.1.0` under `devDependencies`.
- [ ] A MySQL 8.4 connection with `sslmode=require` connects, and `Ssl_cipher` is non-empty.
- [ ] A cold-cache plaintext connection fails with `E_AUTH` and a message naming both `sslmode` and
      `allowPublicKeyRetrieval` — not `E_QUERY`, not driver prose.
- [ ] The same connection with `allowPublicKeyRetrieval=true` succeeds; with `sslmode=verify-full`
      against the container's self-signed certificate it fails rather than downgrading.
- [ ] A wrong password still yields `E_AUTH` from server error 1045.
- [ ] `serverVersion` reads `MySQL 8.4.x`; pointing the MySQL adapter at MariaDB connects and logs a
      warning rather than failing.

**The adapter**

- [ ] Tree: databases, tables, views, routines under a **Routines** folder; no sequence node; the
      four system schemas hidden.
- [ ] `describe()` returns 59 columns for `wide_table`, the composite PK, the self-referencing FK,
      and both FK directions.
- [ ] A JSON column reports `typeClass: 'json'` on both the grid path and the console path, and a
      unicode value inside it round-trips byte-identically.
- [ ] `int` (no display width) classifies as `number`; `tinyint(1)` classifies as `boolean`.
- [ ] `definition()` returns the server's own `SHOW CREATE TABLE` text verbatim, it re-executes into
      a fresh database, and the `CHECK` constraint appears in `constraints`.
- [ ] Keyset paging forward and backward, offset paging deep into `big_rows`, projection, filter,
      sort, and an exact count all behave as the MariaDB scenarios assert.
- [ ] Insert, update and delete run in one transaction, a row-count conflict rolls the whole batch
      back, and a read-only connection refuses with `E_UNSUPPORTED`.
- [ ] Cancel is asserted **server-side**: the query is gone from `information_schema.PROCESSLIST`.

**The kind seam**

- [ ] `grep -rn "'postgres' | 'mariadb'" src/renderer` returns nothing.
- [ ] `grep -rn "=== 'mariadb'" src/renderer` returns nothing.
- [ ] A grid *Filter by this value* against MySQL produces a backtick-quoted identifier and
      executes; the same against Postgres still produces a double-quoted one.
- [ ] The MySQL console highlights SQL, lints SQL, and its identifier completions insert backticks.
- [ ] The engine picker's MySQL tile renders a real mark in its accent colour, and `_icons.html`
      carries the same path.
- [ ] `grep -rn "connectionKindIcon" src` returns nothing.

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` clean.
- [ ] `bun run test:db` and `xvfb-run -a bun run test:ui` green **on the macOS/Colima box or in
      CI** — per `AGENTS.md` neither can run in Claude Code's Linux web container, and this phase
      adds a container-backed suite that has never been executed anywhere else.
- [ ] `docker compose -f scripts/demo-dbs/docker-compose.yml up -d` brings MySQL up alongside
      MariaDB with no port conflict, and `scripts/demo-dbs/seed.sh` seeds it.
- [ ] SPEC §5.1, SPEC §11, `shared/caps.ts`'s table and the README all describe what shipped.

## 9. Open questions for the user

1. **MySQL's accent colour: `teal`, `orange` or `indigo`?** D19 picks `teal` (`#5fb7a5`) — free,
   on-brand for the dolphin, and the furthest unused hue from MariaDB's `blue` (`#7ba8dc`). The
   risk is Postgres's `cyan` (`#58b4c4`) sitting one hue away in the same rail. `orange`
   (`#d1966d`) is maximally distinct from both blues but sits next to Kafka's `amber`; `indigo`
   (`#979fdd`) is distinct in the rail but close to `blue` at 16px. One line either way.
2. **Should a brand-new MySQL connection default `options.sslmode = 'require'` in the dialog?**
   D5 says no — nothing is set behind the user's back, and D4's error message teaches the fix on
   first failure. The counter-argument is that *every* stock MySQL 8 server has TLS available, so
   the default would simply work, and a first-run `E_AUTH` on a correct password is a bad
   introduction to the app. Defaulting it is one line in `defaultDraft()`/`onKindChange`, and it
   would be visible in the URI rather than hidden.
3. **Is the `mysql-family/` extraction (D7) the right size for this phase?** It is the largest thing
   here that the ask did not name: it moves eight files of a shipped adapter before adding
   anything. The alternative is a 1,878-line copy that ships faster and diverges silently
   thereafter. If the answer is "copy for now", say so and the plan's commits 1–2 collapse into
   "copy `mariadb/` to `mysql/` and edit three lines" — but §6's out-of-scope list would then need
   a standing item for the eventual unification.
4. **Should `sslmode` / `allowPublicKeyRetrieval` become real fields in the connection dialog?**
   Today they are keys in the options record or query parameters on the URI, which is how every
   driver knob in the app is set (§6). Making them first-class is a seven-engine design question
   (which options, per kind, validated how) that this phase deliberately does not open.
5. **Demo stack: is host port 3307 for MySQL acceptable?** 3306 is MariaDB's in the same compose
   file (F28). The alternative is moving MariaDB to 3307 and giving MySQL the conventional 3306,
   which is arguably more natural but changes a documented URI developers may already have saved.
6. **Should a MySQL connection set `information_schema_stats_expiry = 0` on its session?** D14 says
   no: it would make every tree expansion read live storage-engine statistics for every table, to
   sharpen a number already rendered as `~N rows`. But it would also make MySQL's row estimates
   behave exactly like MariaDB's and Postgres's, which is a real consistency argument — and it
   could be a per-connection option rather than a default.
