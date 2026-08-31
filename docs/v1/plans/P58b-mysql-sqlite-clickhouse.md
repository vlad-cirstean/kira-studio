# P58b — MySQL/MariaDB, SQLite and ClickHouse, native (M6, ending at C1b)

> **Parent:** `docs/v1/plans/P58-go-native-adapters.md`. That document's §0.3 splits P58 into six
> sub-phases and assigns **P58b** the single milestone **M6 — MySQL/MariaDB, SQLite, ClickHouse**:
> *"Three adapters, `nativeKinds` grows by four kinds (mariadb, mysql, sqlite, clickhouse). SQLite
> carries D8's capability change and its own new regression test. Ends with
> `tests/db/{mysql,mariadb,sqlite,clickhouse}.spec.ts` deleted and their Go successors green."*
>
> **Predecessor:** `docs/v1/plans/P58a-substrate-postgres.md`, complete (its §12 and §13 record M0
> and M1–M5's real results). P58a built everything under `shell/internal/{adapters,page,enginecache,
> adapterhost,enginebackend}` and proved it against a real Postgres container and a real built app.
> **P58b writes no substrate.** It writes three adapters on top of one that already exists, and the
> single most useful thing this plan can do is say precisely which parts of that substrate they
> plug into unchanged, and which four things it does not yet have.
>
> **What this document may not relitigate.** The parent's Decisions (P58 D1–D20), its research (§1),
> its target tree (§3), its designs (§4), its testing plan (§5) and its sequencing (§9) are settled,
> as are P58a's own A1–A21 for everything already built. Where this plan deviates from a parent
> *design* it says so in the open with the reason. **It deviates from two parent *decisions*** — the
> SQLite driver (P58 D8's first part) and the ClickHouse driver (P58 D6's ClickHouse row) — and both
> deviations are stated as decisions here **and** raised as open questions in §10, with an M6.0 probe
> that settles each empirically before a line of product code depends on it. That is P58a's own
> pattern: its PG-2 probe overturned §6's guessed fallback with a smaller, better fix, and the plan
> said so rather than quietly shipping the guess.
>
> **Decision numbering.** P58b's own decisions are **B1–B24**. A parent decision is always written
> **P58 D\<n\>** in full and a P58a decision **P58a A\<n\>** in full — never a bare `D<n>`/`A<n>` —
> so three numberings can never be confused in a cross-reference.
>
> Every claim below was read out of the tree as it stands at `ce4585a` (P58a M5's own commit) with
> `git grep`, `wc -l`, the actual files, and — for every Go driver claim — **the driver's own source
> in the module cache**, downloaded and read for this plan. Where the parent's summary and the tree
> disagree, §1 records the tree. Where the parent's summary and a driver's source disagree, §1
> records the source and quotes it.

## 0. What this sub-phase is, and what it is not

### 0.1 The five bodies of work

1. **M6.0 — probes.** Throwaway Go programs, no product code, settling the four claims this plan's
   own decisions rest on that a source read can suggest but only a running server can confirm:
   go-sql-driver's text-protocol/`interpolateParams` path against both a MariaDB and a MySQL
   container (MY-1); `modernc.org/sqlite` returning storage-class-faithful values where
   `mattn/go-sqlite3` coerces on declared type (SQ-1); ClickHouse's HTTP interface answering
   `JSONCompactStringsEachRowWithNamesAndTypes` with the `ᴺᵁᴸᴸ` sentinel and its mid-stream
   `__exception__` trailer over a raw `net/http` request (CH-1); and `testcontainers-go`'s
   `mysql`/`mariadb`/`clickhouse` modules starting in **this** sandbox (TC-2). §6.
2. **M6.1 — the shared lifts.** Three small changes to already-existing packages that all three
   adapters need and that are much cheaper before the adapters than after: hoisting
   `runWithAbortRace` out of `postgres/query.go` into `internal/adapters` (§1.7, B14), generalising
   `internal/adapters/testsupport` so three more fixtures cannot re-discover P58a's
   `t.Cleanup`-kills-the-container bug (§1.9, B15), and replacing the Node-served placeholder
   kind literal that five other packages' tests hardcode with one exported constant (§1.8, B16).
   **`nativeKinds` does not change in M6.1**, so the whole existing suite must stay green through it.
3. **M6.2 — MySQL and MariaDB.** One `mysqlfamily` package plus two ~30-line profile packages
   (P58 D19), `github.com/go-sql-driver/mysql` through `database/sql`. `nativeKinds` gains
   `mariadb` and `mysql`.
4. **M6.3 — SQLite.** One `sqlite` package, `modernc.org/sqlite` (B7), a real stop button
   (P58 D8's capability change, B8), and the only fixture in the repo's Go tier that needs no Docker
   at all. `nativeKinds` gains `sqlite`.
5. **M6.4 — ClickHouse, and C1b.** One `clickhouse` package speaking the HTTP interface directly
   over `net/http` (B11). `nativeKinds` gains `clickhouse`, reaching five of eleven. Then **C1b**
   (§7): the coexistence half of P58a's own C1 checklist, which P58a §13 recorded as *"not run this
   session — MariaDB has no Go adapter yet (P58b) … worth doing for real once P58b's MariaDB adapter
   exists and both connections can be genuinely native/non-native side by side in one running app."*

### 0.2 Not in this sub-phase

- **No substrate change beyond M6.1's three lifts.** `internal/page`, `internal/enginecache`,
  `internal/adapterhost` and `internal/enginebackend` are untouched. §1.3 is the evidence that they
  do not need to change: every hook these three adapters want was already built for them, two of
  them named for P58b explicitly in P58a's own source comments.
- **No `src/` change at all.** Not one file, not one line. §1.3's last paragraph and B21. P58a's
  `git diff --stat src/ -- ':!src/renderer/bridge/port.ts'` assertion **narrows** here to
  `git diff --stat src/` — the stronger form.
- **No `tests/ui/` change and no `tests/ipc/` change.** P58a A10 still holds: the mocked tier speaks
  the index-keyed chunk encoding and keeps decoding through `toTypedArray`'s second branch, which
  P58f deletes. `tests/ipc/`'s three affected fixtures are *not* regenerated here — §1.10 explains
  why that is a deliberate, named cost rather than an oversight.
- **No `mongo/literal.go`, no `franz-go`, no `aws-sdk-go-v2`.** `shell/go.mod` gains exactly
  **two** modules in P58b (`github.com/go-sql-driver/mysql`, `modernc.org/sqlite`) plus three
  test-only `testcontainers-go` modules. B11 means it gains **no** ClickHouse module.
- **No deletion of `src/engine/`.** All three TypeScript adapters stay exactly where they are; P58f
  deletes them. `tests/ipc/{mariadb,mysql,clickhouse}`'s backend halves keep driving them and keep
  passing, unchanged.
- **No re-measurement.** `docs/PERF.md`'s chunk-encoding measurement was M2's and is done. P58b adds
  no number to it.

### 0.3 The one thing in P58b that is hard to walk back, and how it is isolated

Everything M6.1–M6.4 adds is additive Go: three new packages, one hoisted helper, three new test
fixtures. Deleting any of them restores the previous behaviour.

**Flipping a `nativeKinds` bit is not additive**, and P58b flips four. From the instant
`nativeKinds["mariadb"] = true` lands, every MariaDB connection in every developer's app — and in
`tests/e2e-real/`, and in any manual session — is served by code written this week rather than code
that has been in production since P34. P58a's own findings section is emphatic about the class of
bug this creates and could not catch: *"only `tests/e2e-real/postgres-real.spec.ts`, driving the
real built app against a real container, surfaced it … exactly the class of bug unit tests calling
the adapter directly can never catch, since they never touch the wire encoding at all."*

Three structural answers, all of them in §9's commit list rather than in anyone's vigilance:

1. **Each kind flips in its own commit**, at the end of its own milestone, never batched (B20).
   Four kinds flipping in one commit would make the first user-visible regression ambiguous across
   three adapters and two drivers.
2. **The Go acceptance spec lands and fails before its adapter** (P58 D12 / its R3), per adapter.
3. **C1b is run after the last flip, not before** (§7), and it is the only step in this sub-phase
   that exercises a native and a Node-served connection in one running app — which is the property
   P58 D4 is built on and which nothing in P58a ever proved end to end.

## 1. What re-reading the tree found

### 1.1 The parent's "no new page shape and no new pagination strategy" claim, checked

The parent's sub-phase table justifies grouping these three as: *"They share `sql-text.ts`'s keyset
planner and `sql-mutate.ts`'s guards with Postgres, so this sub-phase exercises the substrate three
more times with **no new page shape and no new pagination strategy** — only new dialects."*

Read out of the three adapters rather than taken on trust:

- **Page shape: the claim is exactly right.** All three `read.ts` modules return `TabularPage` and
  nothing else; all three `console.ts` modules return `TabularPage[]`; all three reach for
  `singleStatusPage` for a non-row-returning statement. No adapter here constructs a `DocumentPage`,
  a `KeyValuePage` or a `StreamPage`. `internal/page`'s four builders already exist and P58b uses
  exactly one of them.
  - A small confirmation worth recording because it reads as an accident until you check it:
    `sql-text.ts`'s `singleStatusPage(text, dataType)` carries a `dataType` parameter *because
    ClickHouse spells its text type `String`* (`clickhouse/console.ts:84` passes `'String'`,
    everyone else passes `'text'`). P58a ported it as `SingleStatusPage(text, dataType string)`
    with that reason in its own §4.4 table. The parameter's first non-`'text'` caller arrives in
    M6.4.
- **Pagination strategy: the claim is directionally right and literally wrong**, and the difference
  matters for the testing plan rather than for the code.
  - `mariadbCaps`/`mysqlCaps` are `pagination: 'keyset'` — identical to Postgres's, exercising the
    same `ComputeEffectiveOrder` → `AssertKeysetSupported` → `ResolveFetchColumns` →
    `BuildScanOrderBy` → `BuildKeysetPredicate` → `BuildKeysetPosition` chain M5 already ran.
  - `sqliteCaps` is also `'keyset'`, but with a **tiebreaker source the Go substrate has never
    resolved**: primary key → all-NOT-NULL unique index → *the table's own implicit `rowid`*
    (`sqlite/read.ts:82-83`, `resolveKeysetColumnMeta`). That is not a new strategy; it is the
    `resolveHidden` hook, and P58a built it — `sqltext.go`'s `ResolveFetchColumns` takes a
    `resolveHidden func(string) (model.ColumnMeta, error)` whose own §4.4 row says, in P58a's plan,
    *"sqlite passes its own in P58b."*
  - `clickhouseCaps` is **`pagination: 'offset'`**, and that value has never crossed the Go
    substrate. ClickHouse's `readPage` refuses an `after`/`before` cursor outright with a named
    `E_UNSUPPORTED` message, never calls the keyset planner at all, and builds a `PagePosition`
    literal with `strategy: 'offset'`, `nextToken: null`, `prevToken: null`. So the honest
    restatement of the parent's claim is: **P58b needs no new substrate, but it is the first
    sub-phase to emit a `PagePosition` the Go codec has never emitted and to take a `read` path that
    skips the keyset planner entirely.** Both are covered by types that already exist
    (`page.PagePosition` is a plain struct); neither needs code. It does mean §5.5's ClickHouse
    coverage cannot lean on M5's keyset tests having already proven the pager.
- **One more thing the claim does not cover, and it is the largest single risk in this sub-phase.**
  The three adapters share a keyset planner and a mutation-guard set; they do **not** share a *value
  codec*. Postgres's page cells arrive as the server's own text because P58a's PG-2 probe found
  `pgx.QueryExecModeSimpleProtocol` and used it. Each of the three adapters here has its own,
  different answer to "how does a cell become text", and in all three cases the Go driver's default
  answer is the wrong one:
  - MySQL/MariaDB: the text protocol, forced by `interpolateParams=true`, plus a binary-vs-text
    decision per column (§1.4).
  - SQLite: the value's own storage class, never the declared type — and `mattn/go-sqlite3` coerces
    on the declared type (§1.5).
  - ClickHouse: the server's own `*Strings` JSON rendering, which `clickhouse-go` cannot ask for
    (§1.6).

  §1.4–§1.6 are three instances of one finding: **the value codec is where each of these ports will
  break, and each of the three breaks differently.**

### 1.2 The three adapters, measured

`git grep -c "" -- src/engine/adapters/<dir>` for this plan. **32 files, 4 685 lines**, matching the
parent's §1.1 totals exactly (1 782 + 1 430 + 1 473).

| File | mysql-family | sqlite | clickhouse |
|---|---:|---:|---:|
| `index.ts` | 400 | 280 | 286 |
| `catalog.ts` | 324 | 388 | 317 |
| `read.ts` | 184 | 210 | 208 |
| `definition.ts` | 159 | 105 | 72 |
| `console.ts` | 129 | 73 | 88 |
| `query.ts` | 118 | 116 | 159 |
| `client.ts` | 170 | 90 | 122 |
| `mutate.ts` | 90 | 94 | 101 |
| `errors.ts` | 46 | 42 | 84 |
| `caps.ts` | — (per profile) | 32 | 36 |
| `profile.ts` | 25 | — | — |
| **subtotal** | **1 645** | **1 430** | **1 473** |

Plus the two profile directories: `mariadb/` 68 lines across 6 files (`caps.ts` 28, `client.ts` 14,
`index.ts` 16, and three 2–4-line re-export shims), `mysql/` 69 lines across 6 files (the same shape,
`client.ts` 20 because `applyEngineOptions` actually does something).

**Expected Go size.** P58a's Postgres port is the only calibration this repo has: 1 726 TypeScript
lines became 2 176 lines of Go product code (a 1.26× ratio) plus 762 lines of Go test. Applying it
gives roughly **2 050 / 1 800 / 1 850** lines for the three packages — except that two of the three
move in the other direction for identified reasons: SQLite loses `setReadBigInts`, the
`node:sqlite`-availability probe and the `SqliteParam` union (Go's `int64` and `any` cover all
three), while ClickHouse *gains* a small HTTP client and a response reader it currently gets from
`@clickhouse/client`. Treat ~5 700 lines of Go product code plus ~2 200 of Go test as the working
estimate, and treat it as an estimate.

### 1.3 What P58a's substrate already gives P58b for free — and the four things it does not

Read out of `shell/internal/`, not inferred. This is the section that makes P58b much smaller than
P58a, and it is worth being exact about.

**Free, already built, no change needed:**

| Needed by P58b | Where it already is | Notes |
|---|---|---|
| `Adapter`, `Caps`, `Deps`, `OpCtx`, `ConnectInfo`, `ReadRequest`/`CountRequest`/`CountResult`, `TreeChildren` | `internal/adapters/adapter.go` (200 lines), `caps.go` | The interface all three implement verbatim |
| The eight `AdapterErrorCode` strings, `Error`, `New`, `CodeOf`, `Unsupported`, `NoQueryConsole`, `AssertWritable`, `CheckNotStarted`, `CheckCancelled`, `RequireConnected` | `internal/adapters/errors.go` (99 lines) | All three `errors.go` ports map onto this closed set |
| `Register(kind, ctor)` / `CreateAdapter` | `internal/adapters/registry.go` | Each new package registers from its own `init()`; **no edit to `registry.go`** |
| The live map | `internal/adapters/live.go` | |
| The whole keyset planner: `BuildOrderBy`, `BuildKeysetPredicate`, `EncodePageToken`/`DecodePageToken`, `RequestFingerprint`, `ResolveProjection`, `SafeInt`, `WhereClause`, `ParseCountValue`, `PrimaryKeyFromIndexes`, `ResolveKeyShape`, `StripOneTrailingSemicolon`, `SingleStatusPage`, `AssertKeysetSupported`, `ComputeEffectiveOrder`, `ResolveFetchColumns`, `BuildScanOrderBy`, `BuildKeysetPosition` | `internal/adapters/sqltext.go` (489 lines) | 18 functions; mysql-family uses 12, sqlite 13, clickhouse 5 |
| The mutation guards and renderer: `OrderedOps`, `AssertColumnsKnown`, `AssertAffectedExactlyOne`, `AssertKeyIsPrimaryKey`, `LiteralRenderer`, `NewParamRenderer`, `RenderRowOp`, **`ResolveDatabaseTablePath`** | `internal/adapters/sqlmutate.go` (165 lines) | `ResolveDatabaseTablePath` is unused by Postgres; P58a's §4.5 ported it anyway with the note *"ported in M1 because P58b's three adapters all need it"* — and they do, all three |
| The columnar codec, all four builders, `MaxCellBytes`/`MaxPageSize`, UTF-8 boundary truncation, base64 chunk marshalling, `PageByteSize`, `UnpagedPosition` | `internal/page/` (`chunk.go`, `scratch.go`, `builder.go`) | `NewTabularPageBuilder(cols).AppendRow([]*string).Finish(pos)` is the whole surface these three need |
| L2/L3 cache, the cache-aside discipline, the op scheduler, the panic boundary, `op:start`/`op:end`, the data-op dispatcher, the request `Validate()`s, the per-kind router, the single-writer stream session | `internal/enginecache/`, `internal/adapterhost/` | **None of it is kind-specific.** A new adapter is served the moment its kind is in `nativeKinds` |
| `model.ResolvedConnectionConfig`, `model.NodePath`, `model.ObjectMeta`, `model.ObjectDefinition`, `model.ConstraintMeta`, `model.DefinitionSection`, `model.SortSpec`, `model.MutationPlan`/`MutationRowOp`/`MutationResult`, `model.RowValues` (order-preserving, P58a A4), `model.PageCursor`, `model.ConsoleRequest` | `internal/storage/model/` | Every type all three adapters name |
| The renderer's dual chunk decoder | `src/renderer/bridge/port.ts`'s `toTypedArray` | **Verified present**: the `typeof v === 'string'` base64 branch is in the tree at `ce4585a`, added by P58a's own findings-driven fix. This is the reason P58b touches no `src/` file |
| `testsupport.IsDockerAvailable`, `testsupport.DockerUnavailableMessage`, the repo-root resolver | `internal/adapters/testsupport/postgres.go` | The gate and the seed-path anchor are already generic; only the per-engine fixtures are new |

**Not free — the four gaps, all of them small, all of them M6.1:**

1. **`runWithAbortRace` is unexported and lives in `postgres/query.go`.** All three P58b adapters
   need it, for three different reasons (§1.7). B14 hoists it.
2. **`testsupport` has exactly one fixture and no shared memo shape.** Its `StartPostgres`/
   `StopPostgres` pair encodes P58a's hard-won `t.Cleanup` lesson in prose in one function's doc
   comment. Three more fixtures written by hand from that prose is three more chances to
   re-discover the bug. B15.
3. **`nativeKinds`'s Node-served placeholder is a bare `"mariadb"` literal in five test files.**
   §1.8. B16.
4. **`adapters.LiteralRenderer` renders SQL-standard doubled-quote escaping; ClickHouse needs
   backslash escaping** (`clickhouse/mutate.ts:28-31`, P36 D6/F27). This is *not* a substrate gap —
   ClickHouse already keeps its own `literalFor` in TypeScript and keeps its own in Go (B13). Listed
   here only so nobody "unifies" the two renderers on the way past.

### 1.4 `go-sql-driver/mysql` really does serve both dialects — and four facts from its source that decide the port's shape

The parent's §1.8 recommends `github.com/go-sql-driver/mysql` via `database/sql`, *"the standard
driver, wire-compatible with both servers, which is what makes the existing one-core/two-profile
split port unchanged."* The task of verifying that was assigned here rather than assumed, so it was
verified against v1.10.0's own source, read from the module cache.

**The dual-dialect claim holds, and holds for a stronger reason than wire compatibility.**
`README.md:49`: *"MySQL (5.7+) and MariaDB (10.5+) are supported by maintainers."* And
`auth.go:334` implements `client_ed25519` — MariaDB's own authentication plugin, which a
"MySQL driver that happens to speak the same wire protocol" would not carry. The fixture's servers
are `mariadb:11.4` and `mysql:8.4`, both inside that support window. **B1 keeps P58 D19's
one-core-two-profiles shape**, and it is not a leap of faith.

Four facts from the source that the port cannot be written without:

1. **`interpolateParams=true` is the exact analogue of pgx's `QueryExecModeSimpleProtocol`, and it
   is not the default.** `connection.go:485-505`: `mysqlConn.query` returns `driver.ErrSkip` when
   args are present and `!cfg.InterpolateParams` — which makes `database/sql` fall back to
   `Prepare`, i.e. the **binary** protocol. With `InterpolateParams` on, the driver interpolates
   client-side (its own escaping, `connection.go:248`) and sends one `comQuery`, i.e. the **text**
   protocol, whose rows arrive as raw server bytes. That is precisely what `mysql-family/query.ts`
   already insists on for its own reasons — *"Always the text protocol (`conn.query`), never
   `conn.execute()`'s binary/prepared protocol … the binary protocol combined with the textMode
   typeCast callback above corrupts row data (confirmed with real bound params)"* — so the
   TypeScript adapter's hard-won rule ports as one DSN parameter. **B2.** One caveat from
   `dsn.go:32`/`collations.go:253`: `interpolateParams` is refused with a named error for twelve
   legacy CJK collations (`big5_chinese_ci`, `sjis_*`, `gbk_*`, `gb18030_*`, `cp932_*`); the default
   is `utf8mb4_general_ci` (id 45) and the adapter sets no collation, so this cannot fire — but it
   is a real refusal to know about if a user ever supplies one through the URI's query string.
2. **`ColumnTypeDatabaseTypeName` already carries the binary/text distinction, so the collation
   lookup disappears.** `fields.go:20-115`: `fieldTypeBLOB` → `"TEXT"` unless
   `charSet == binaryCollationID` (63), in which case `"BLOB"`; `fieldTypeString` → `"CHAR"` vs
   `"BINARY"`; `fieldTypeVarChar`/`fieldTypeVarString` → `"VARCHAR"` vs `"VARBINARY"`;
   `fieldTypeGeometry` → `"GEOMETRY"`; `fieldTypeBit` → `"BIT"`. `mysql-family/query.ts`'s
   `typeCastString` does this by hand (*"VAR_STRING/STRING/the BLOB family only count as binary when
   the column's own collation is the binary collation … the driver's Collation table names it
   'BINARY'"*) — in Go the driver has already made the decision and the adapter reads a string.
   **B3.**
3. **`ColumnTypeLength` is commented out upstream, and one behaviour is lost because of it.**
   `rows.go:66-68`, verbatim:
   ```go
   // func (rows *mysqlRows) ColumnTypeLength(i int) (length int64, ok bool) {
   // 	return int64(rows.rs.columns[i].length), true
   // }
   ```
   So `sql.ColumnType.Length()` reports `(0, false)`. `mysql-family/console.ts:50` uses exactly that
   field — `if (field.type === 'TINY' && field.columnLength === 1) return 'boolean'` — because the
   query console never consults the catalog and the wire protocol's display width is the only
   signal `tinyint(1)` gives. **In Go the console path cannot tell `tinyint(1)` from `tinyint`, and
   a boolean column in a console result classifies as `number`.** The *read* path is unaffected: it
   reads `COLUMN_TYPE` (`'tinyint(1)'`) out of `information_schema.COLUMNS`, and
   `mysql.spec.ts` test 35 asserts the read path, not the console path. No existing spec asserts the
   console path's boolean case. **B4** accepts the narrowing, documents it, and adds a Go test
   pinning the *new* behaviour so it is a recorded decision rather than an undiscovered drift.
4. **A cancelled context does not send `KILL QUERY` — it destroys the connection.**
   `connection.go:745-767` starts a watcher goroutine; on `<-ctx.Done()` it calls
   `mc.cancel(err)` → `mc.cleanup()` (`connection.go:178-194`), which closes `mc.closech` and calls
   `conn.Close()` on the raw socket. This is strictly worse than pgx's behaviour, which P58a already
   had to work around: pgx *races* its own cancel request against the adapter's
   `pg_cancel_backend`; go-sql-driver *tears down the connection whose thread id the adapter was
   about to `KILL QUERY`*. §1.7 and B6.

### 1.5 `mattn/go-sqlite3` cannot express the SQLite adapter's value codec — and `modernc.org/sqlite` can

This is the largest finding in this plan and it overturns half of a parent decision, so it is stated
with its source.

P58 D8's first part reads: *"The driver. Already in `go.mod`, already linking the same amalgamation
the app-storage layer uses … A second SQLite implementation (`modernc.org/sqlite`, pure Go) in the
same binary would be a needless second copy with different edge-case behaviour."* The reasoning is
sound for the *storage* layer, which scans into typed Go struct fields where a driver-side
conversion is harmless or wanted. It does not survive contact with a **data browser**, whose entire
job is to show what is actually stored.

`sqlite/read.ts:200-210`'s codec, and its own comment:

> *"D3/D21: the value→text codec. Switches on the **value's** own JS type, never the column's
> declared type — SQLite is dynamically typed (F21), so a TEXT-declared column is free to hold a
> BLOB value and vice versa."*

`tests/db/sqlite.spec.ts` test 35 (*"dynamic typing: the value codec follows the value, not the
declared type"*) asserts exactly this with a real probe table: a `BLOB` value written into a `TEXT`
column must come back as `0x…`, and the text `'not a number'` written into an `INTEGER` column must
come back verbatim.

`mattn/go-sqlite3` v1.14.50, `sqlite3.go:2636-2698`, in `SQLiteRows.nextSyncLocked` — read for this
plan, not recalled:

```go
switch col.typ {
case C.SQLITE_INTEGER:
        val := int64(col.i64)
        switch decltype[i] {
        case columnTimestamp, columnDatetime, columnDate:
                ...
                dest[i] = t                    // time.Time
        case "boolean":
                dest[i] = val > 0              // bool
        default:
                dest[i] = val
        }
...
case C.SQLITE_TEXT:
        ...
        switch decltype[i] {
        case columnTimestamp, columnDatetime, columnDate:
                ... for _, format := range SQLiteTimestampFormats { ... }
                if err != nil {
                        // The column is a time value, so return the zero time on parse failure.
                        t = time.Time{}
                }
                dest[i] = t
        default:
                dest[i] = s
        }
}
```

`decltype[i]` is `sqlite3_column_decltype`, lower-cased — i.e. **the declared column type**, the one
thing this adapter's codec is documented never to switch on. Three concrete consequences against the
existing fixture (`tests/db/fixtures/0009_sqlite_seed.sql` declares `bool_a…bool_d BOOLEAN`,
`date_a…date_d DATE`, `datetime_a…datetime_c DATETIME`, `ts_a…ts_c TIMESTAMP`, and
`orders.ordered_at DATETIME`):

- A `BOOLEAN` column storing `0`/`1` renders `false`/`true` instead of `0`/`1` — a visible change to
  every cell in four fixture columns and, worse, a change the cell editor would write back
  differently.
- A `DATE`/`DATETIME`/`TIMESTAMP` column's stored text is re-parsed and re-formatted through
  `SQLiteTimestampFormats`, so the grid stops showing what the file contains.
- **A `DATETIME` column holding text SQLite could not parse silently becomes the zero time** — the
  driver's own comment says so. That is the exact failure mode the adapter's D21 rule exists to
  prevent, and it fails silently in the one direction a database tool must never fail.

There is no escape hatch: the conversion is inside `rows.Next` (below `database/sql`, so
`sql.RawBytes` does not help), it is not gated on any DSN parameter or `ConnectHook`, and
`sqlite3_column_decltype` returns the declared type for any direct column reference — which is what
this adapter's `SELECT "a", "b" FROM t` always emits. Erasing the decltype would mean wrapping every
projected column in an expression, which changes NULL and numeric semantics and breaks `ORDER BY`.

`modernc.org/sqlite` v1.57.0, `rows.go:129-190`, does the faithful thing **by default** and makes
the compatibility behaviour opt-in:

```go
case sqlite3.SQLITE_INTEGER:
        v, err := r.c.columnInt64(r.pstmt, i)
        ...
        if !r.c.intToTime {
                dest[i] = v
        } else {
                // Inspired by mattn/go-sqlite3: ... but we make this compatibility optional
                // behind a DSN query parameter, because this changes API behavior, so an
                // opt-in is needed.
                ...
        }
```

`_inttotime` and `_texttotime` both default off (`sqlite.go:391-405`), so with a plain DSN every
value arrives as its storage class: `int64`, `float64`, `string`, `[]byte`, `nil`. That is a
one-for-one match for `toCellText`'s four branches.

Two more things checked in the same read, both of which make `modernc.org/sqlite` the better fit
rather than merely the acceptable one:

- **Its DSN already spells every option this adapter sets.** `_busy_timeout` (`client.ts`'s 5 000 ms,
  matching `storage/db.ts`), `_foreign_keys` (`enableForeignKeyConstraints: true`), `_txlock=immediate`
  (`mutate.ts`'s `BEGIN IMMEDIATE`, D25), `_query_only` (a read-only connection), and a general
  `_pragma=` escape hatch. Validation happens up front, before any statement runs
  (`sqlite.go:290-296`'s own comment: *"a failed Open must not leave the database half-configured"*).
- **Its interrupt handling is the safer of the two.** `conn.go:26-41`'s own comment says it
  deliberately does **not** invalidate the connection because an in-flight query was interrupted;
  `sqlite.go:74-76`'s `interruptOnDone` *"sets up a goroutine to interrupt the provided db when the
  … [context is done and] doesn't interrupt after the caller finishes."* `mattn`'s equivalent
  (`sqlite3.go:2429`, `sqlite3.go:2601`) carries its own inline warning: *"this is still racy and
  can be no-op if executed between sqlite3\_\* calls."*

**B7** therefore selects `modernc.org/sqlite`. The costs P58 D8 named are real and are paid: a second
SQLite implementation in the binary (≈5 MB, and a second amalgamation version that can drift from
`internal/storage`'s), and a machine-translated engine that is measurably slower than cgo SQLite on
write-heavy work — which the test fixture's 1 000 000-row `WITH RECURSIVE` insert will feel and a
user browsing 10 000 rows a page will not. **It is not a "pure Go, no cgo" argument** — cgo is
already a hard requirement of this module (`mattn/go-sqlite3` for `internal/storage`, and Wails'
GTK/WebKitGTK bindings for `internal/shell`), P58a §1.9 already recorded that `CGO_ENABLED=0` is not
an option here, and this plan does not pretend otherwise. The argument is correctness, and only
correctness. §10 OQ-1 raises it to the parent's author; §6's SQ-1 probe settles it against a real
file before M6.3 writes a line.

### 1.6 `clickhouse-go/v2`'s HTTP transport pins `default_format=Native`, and that is the whole ClickHouse port

The parent's §1.8 recommends `github.com/ClickHouse/clickhouse-go/v2` (v2.48.0 is current, released
into 2026 — checked with `go list -m -versions`). Its cancellation reasoning is right and unchanged:
the adapter cancels with `KILL QUERY WHERE query_id = … SYNC` on a second request, so the driver's
weak context story is irrelevant.

What the recommendation does not cover is the format, and the format is what this adapter is built
on. `clickhouse/client.ts:28-33` sets four fixed settings, the first of which is
`default_format: 'JSONCompactStringsEachRowWithNamesAndTypes'`, and `clickhouse/query.ts:43-51`
depends on the consequence:

> *"The \*Strings JSON formats render every Nullable NULL as this literal small-caps string instead
> of JSON null — chosen by ClickHouse itself specifically so it can't collide with an empty string,
> verified empirically against clickhouse-server:26.3 … Not documented anywhere the adapter can link
> to; the sentinel itself is the only reliable signal."*

That format is what makes every cell arrive as **the server's own text**, which is what the page
codec stores and what `tests/db/clickhouse.spec.ts` asserts literally: test 36 expects
`'123456789012345678.1234567890123456789'` for a `Decimal128(20)` with a comment explaining that the
server renders one digit short of the inserted literal and *"the adapter passes the server's own
text through unchanged (D16)"*; test 37 expects the lower-case string `'nan'` for a `Float` NaN and
the four-character string `'null'` for a text value distinct from SQL NULL; test 35 expects
`'green'` for an `Enum8` and a canonical UUID string; and `wide_types`' `Array`/`Tuple`/`Map`/`IPv4`/
`IPv6`/`FixedString`/`LowCardinality` columns all arrive as ClickHouse's own JSON/text renderings.

`clickhouse-go` cannot be asked for that format. `conn_http.go:201` sets
`query.Set("default_format", "Native")` on every request, and `conn_http.go:683-686` explicitly drops
any attempt to override it through `WithSettings`:

```go
for key, value := range options.settings {
        // check that query doesn't change format
        if key == "default_format" {
                continue
        }
        ...
}
```

Putting `FORMAT JSONCompactStringsEachRowWithNamesAndTypes` in the SQL text does not help either:
the server would honour it and the driver would then try to decode the body as Native and fail.
There is no exported raw-response path.

So a `clickhouse-go` port would have to scan native-typed Go values — `time.Time`, `decimal.Decimal`,
`uuid.UUID`, `*big.Int`, `net.IP`, `[]any`, `map[string]any`, `float64(NaN)` — and **render them back
into text itself**, matching ClickHouse's own output byte for byte, for every type family in
`wide_types`, forever. Go's `strconv.FormatFloat(math.NaN(), …)` produces `"NaN"`, not `"nan"`. The
Decimal128 case is a 38-significant-digit value whose exact rendering the spec pins. This is not a
re-baselining exercise; it is re-implementing a server's formatter in the client.

**B11 therefore drops the driver and speaks the HTTP interface directly over `net/http`**, which is
exactly what `@clickhouse/client` does and exactly the shape P58 D6 already chose for RabbitMQ
(*"no library — `net/http`"*), with §1.8's own observation that having no driver *"makes RabbitMQ
the simplest of the eleven, not the hardest — the opposite of the intuition its 1 209 lines
suggest."* The ClickHouse adapter needs a POST with the statement as the body, `query_id`,
`param_<name>` values, four settings and an optional `readonly=2`, all as URL parameters, plus a
streamed response reader — no session, no prepared statements, no batching, no type system.

**The cost, named honestly.** `@clickhouse/client` did two things for free that a hand-rolled client
must do itself, and both are in B12: parsing the exception envelope (the response carries
`X-ClickHouse-Exception-Code`, and the body's `Code: N. DB::Exception: …` prefix, which
`errors.ts`'s fifteen-code table dispatches on), and — the harder one — the **mid-stream exception**:
a `SELECT` that fails after rows have already streamed returns HTTP 200 and appends an
`__exception__` trailer to the body rather than a status code. `clickhouse-go`'s own
`conn_http_errors.go:60-71` documents both the modern (`\r\n__exception__\r\n<tag>\r\nCode: …`) and
the older 25.8 (`__exception__\r\nCode: …`) layouts, which is the best available evidence that this
is real, versioned and worth handling deliberately. §6's CH-1 probe measures the exact shape against
`clickhouse/clickhouse-server:26.3` before any product code, and §4.4 states the handling rule.

### 1.7 All three adapters need `runWithAbortRace`, for three different reasons

`AGENTS.md`'s P58a findings state the rule and predict this section:

> *"Any future Go adapter built on a context-native driver (mysql-family's `go-sql-driver/mysql`,
> ClickHouse's `clickhouse-go` — both honour ctx cancellation the same way pgx does) needs this same
> helper, not a direct `conn.Query(ctx, …)`."*

Checked per adapter, and the finding is right for all three but for three genuinely different
reasons — which is why this gets its own section rather than a footnote:

| Adapter | What the driver does with a cancelled context | Why that breaks the two-step cancel | The rule |
|---|---|---|---|
| **mysql-family** | `connection.go:761` → `mc.cancel(err)` → `mc.cleanup()` **closes the raw socket** (§1.4 fact 4) | `adapterhost.Host.CancelOp` cancels the op context *first*, then calls `adapter.Cancel(opID)`. If the op context reached the driver, the connection whose `CONNECTION_ID()` the adapter tracked is already gone by the time `KILL QUERY <threadId>` is issued on the side connection — and `database/sql` has discarded it from the pool. The kill targets a session that no longer exists, and the caller gets no confirmation | Issue on `context.WithoutCancel(ctx)`; the caller-facing wait races the result against `ctx.Done()`. Identical to Postgres |
| **clickhouse** | The HTTP request is aborted; the **server keeps executing** (`caps.ts`'s own note: *"the server keeps executing a query after the original socket closes"*) — which is exactly why `KILL QUERY … SYNC` exists here | The socket abort is harmless, but the `release()` that runs when the request errors removes the op's `query_id` from `runningByOp` **before** `Cancel(opID)` looks it up — so `Cancel` finds nothing, skips the `KILL QUERY`, and reports `false`. This is the same shape as the pgx bug P58a's `TestPostgres_Cancel` caught, and in TypeScript it is only masked by `cancelOp` calling `adapter.cancel` on the same tick the abort fires | Same helper, same reason: `release()` must run when the request *settles*, not when the context fires |
| **sqlite** | `modernc.org/sqlite` calls `sqlite3_interrupt` on context-done. **This is the only cancellation mechanism there is** — there is no side connection and no server to kill | The inverse problem: the driver context must be cancellable, but it must not be the *op's* context, or a local abort would interrupt the statement before `Cancel(opID)` is ever consulted and `caps.cancel = true` would be a lie about which step did the work | Issue on an **adapter-owned** cancellable context, registered per op; `Cancel(opID)` cancels *that* one. Same helper, opposite polarity — B8 |

**B14** hoists the helper into `internal/adapters/abort.go` as `adapters.RunWithAbortRace`, the Go
successor to `src/engine/adapters/abort.ts`. This reverses a P58a *implementation* call, not a
decision: P58a's §4.11 wrote *"P58 §1.9 leaves 'whether it stays a shared helper' to P58a: **it does
not**"* — correct with one caller, wrong with four. That is P39's own threshold argument, applied.

### 1.8 Flipping four kinds breaks five other packages' tests, and the fix should be structural

`AGENTS.md`'s P58a findings again, in the general form its author intended:

> *"Flipping a kind's `nativeKinds` bit is a breaking change for any **other** package's test that
> used that kind as a 'definitely still forwards to the child' placeholder — grep for the literal
> kind string across `internal/` before flipping it, not just within the package the milestone
> itself is authoring."*

Grepped for this plan (`grep -rn '"mariadb"\|"mysql"\|"sqlite"\|"clickhouse"' shell/internal
--include=*_test.go`), **before** writing §3, exactly as the task's own instruction requires:

| File:line | What it is | Breaks when |
|---|---|---|
| `internal/connections/service_test.go:63, 82, 114, 225` | `Kind: "mariadb"` on two fixture connections, plus two comments reading *"'mariadb' is not in nativeKinds (postgres is, as of M5) — this router always forwards to the …"* | M6.2 |
| `internal/tree/service_test.go:51` | the same comment, same assumption | M6.2 |
| `internal/adapterhost/integration_test.go:23` | `fakeKindLookup{"conn-1": "mariadb"} // never in nativeKinds` | M6.2 |
| `internal/adapterhost/dataframe_test.go:107` | `conns["conn-2"] = "mariadb" // never in nativeKinds` | M6.2 |
| `internal/adapterhost/router_test.go:23-33` | asserts `IsNativeKind("mariadb")` is **false**, then mutates `nativeKinds["mariadb"] = true` and `defer delete`s it, then asserts `IsNativeKind("sqlite")` is false | M6.2 **and** M6.3 |

Two non-test hits, both correct and untouched: `internal/connections/input.go:12`'s
`fileKinds = map[string]bool{"sqlite": true}` (the connection dialog's file-picker gate, nothing to
do with routing) and `internal/storage/model/connection.go:48`'s valid-kind set.

Swapping `"mariadb"` for the next still-Node-served kind would work and would guarantee the same
grep-and-patch dance in P58c, P58d and P58e. **B16** instead exports one constant from
`adapterhost` — `TestKindNodeServed`, with a doc comment naming the sub-phase that will next have to
move it — and points all five files at it. After that, each later sub-phase changes one line rather
than five files, and the compiler cannot silently miss one. `router_test.go` additionally needs its
`IsNativeKind` cases re-pointed: the "not native" example becomes that constant and the
"add to the map and observe it live" example keeps mutating a kind that is genuinely absent.

*Named alternative, rejected:* making `nativeKinds` injectable so each test can supply its own. It is
a bigger change, it weakens P58 §4.6's "one table, one source of truth" property, and it would let a
test pass against a routing table production never uses.

### 1.9 The four `tests/db/support/*.ts` files: three cannot be deleted, one can — today

`AGENTS.md`'s P58a findings record the mistake this section exists to avoid: the plan claimed
`tests/db/support/postgres.ts`'s *"only consumer goes"* with the spec, and by implementation time
four other files depended on it. *"General lesson: a plan's own 'its only consumer' claim about a
shared support file is a snapshot, not a standing fact."*

So, grepped at plan time across the whole tree (excluding `node_modules/`, `out/` and the git-ignored
`.claude/worktrees/`):

| Support file | Consumers other than its own `tests/db/*.spec.ts` | Fate |
|---|---|---|
| `tests/db/support/mariadb.ts` | `scripts/capture-tree.ts:47` (`startMariadb`), `tests/ipc/mariadb/mariadb.backend.spec.ts:9` | **KEEP** |
| `tests/db/support/mysql.ts` | `tests/ipc/mysql/mysql.backend.spec.ts:9` | **KEEP** |
| `tests/db/support/sqlite.ts` | `tests/e2e-real/support/sqlite.ts:10` → `tests/e2e-real/sqlite-real.spec.ts`, and `tests/ipc/support/harness.spec.ts:9` | **KEEP** — and it is load-bearing for C1b (§7) |
| `tests/db/support/clickhouse.ts` | **none.** `tests/ipc/clickhouse/` deliberately uses its own `container.ts` (P50 D1 forbade editing `tests/db/`, and `ClickHouseContainer`'s construction is private to `start()`), which imports only `../../db/support/docker` | **DELETABLE** — subject to B17's re-grep |

`tests/db/fixtures/{0002_mariadb_seed.sql, 0008_mysql_seed.sql, 0009_sqlite_seed.sql,
0010_clickhouse_seed.sql}` are **unchanged** in all four cases: P58 D12's rule is that the Go seeders
read the same files, so the dataset a Go adapter is judged against is byte-identical to the one its
TypeScript predecessor passed.

**B17** therefore deletes four spec files and exactly one support file, and makes the re-grep an
explicit step in §9's commit list rather than an assumption in §3.

### 1.10 `tests/ipc/`'s mariadb/mysql/clickhouse fixtures start describing a producer the app no longer uses

Not a breakage — a quiet weakening of a guarantee, which is worse, so it gets named.

`docs/ARCHITECTURE.md`'s Testing section states the tier's whole value in one sentence: *"a frontend
spec cannot mock a shape the backend has stopped producing without that same fixture module's own
backend assertion failing first."* The backend half imports `src/engine/control.ts` and the
TypeScript adapter directly; the frontend half mocks both wire planes from the shared
`<adapter>.fixture.ts`.

Three of the seven `tests/ipc/` adapters are P58b's: `mariadb`, `mysql`, `clickhouse`. (`postgres`
has no `tests/ipc/` split at all, which is why P58a never met this; `sqlite` has none either — only
`tests/ipc/support/harness.spec.ts` borrows its fixture.) After M6.2 and M6.4, the real app serves
those three kinds from Go while `tests/ipc/`'s backend half keeps asserting against the TypeScript
adapter. **The anti-drift guarantee still holds — for a producer that no longer runs in production.**

P58 D13 is the answer and it belongs to P58f: *"the seven `*.backend.spec.ts` files are replaced by
a Go equivalent that drives the same sequence against the same containers and writes the same fixture
modules."* Nothing in P58b should try to bring that forward — porting a fixture generator for three
adapters while four others still need the TypeScript one would leave two generators and two
conventions in the tree for three sub-phases.

What P58b owes instead is smaller and is in §8: **the Go acceptance suite must cover, per adapter,
every shape that adapter's `*.fixture.ts` pins** — the tree children, the describe payload, the
first page's columns and cells — so a Go-side divergence from the TypeScript producer fails a Go
test rather than going unnoticed until P58f regenerates the fixture. Concretely that is already
implied by porting the spec scenarios (§5.3–§5.5); this section exists so the implementer knows
*why* those particular scenarios must not be dropped as redundant.

### 1.11 The four specs, counted, and how much of each ports

Counted for this plan (`grep -c "^\s*\(test\|it\)("`), and read scenario by scenario. The four files
are 6 765 lines and **161 scenarios**, against P58a's single 1 633-line, 34-scenario Postgres file.
This is the largest test-porting job in P58.

| Spec | Lines | Scenarios | Ports as-is | Re-baselined against the Go driver | Moves to `adapterhost` or becomes a caps assertion | Rewritten or dropped, each with a reason |
|---|---:|---:|---:|---:|---:|---:|
| `mariadb.spec.ts` | 1 565 | 33 | 27 | 3 (2, 22, 28) | 2 (8, 29) | 1 (33) |
| `mysql.spec.ts` | 1 793 | 38 | 30 | 4 (2, 2c, 22, 28) | 2 (8, 29) | 2 (2b, 33) |
| `sqlite.spec.ts` | 1 672 | 43 | 36 | 3 (2b, 2c, 39) | 2 (8, 29) | 2 (7, 40) |
| `clickhouse.spec.ts` | 1 735 | 47 | 40 | 4 (2a, 2b, 2d, 42) | 2 (8, 29) | 1 (32's leak half) |

The four columns, explained once because the same rules apply to all four files:

- **Ports as-is** — the scenario drives the adapter against the same seeded fixture and asserts a
  shape, a cell value or a count. `readTabular`, `cellAt`, `isNull` and `makeCtx` have direct Go
  equivalents in `postgres_test.go` already; reuse them rather than reinventing them per package
  (they belong beside `testsupport`, B15).
- **Re-baselined against the Go driver, never loosened** (P58 §1.10's first non-portable point).
  Every one of these asserts a driver's own error *text* or code: MariaDB/MySQL's `ER_ACCESS_DENIED`
  wording, SQLite's `SQLITE_BUSY` message, ClickHouse's `Code: N. DB::Exception:` envelope.
  `mysql.spec.ts` 2c (`sslmode=verify-full` against a self-signed certificate) is worth calling out
  as a re-baseline that gets *better*: `mysql-family/client.ts:110-138` carries eighteen lines of
  comment explaining that the `mariadb` npm driver races two of its own socket handlers and that
  under Bun the failure can escape every `try`/`catch`, which is why the adapter lets the handshake
  succeed and inspects `info.selfSignedCertificate` afterwards. Go's `crypto/tls` returns a clean,
  synchronous `x509.UnknownAuthorityError` from `Dial`. **The whole workaround is deleted, not
  ported** (B24), and the scenario asserts the real rejection.
- **Moves out of the adapter package.** Scenario 8 (*"cap honesty"*) is a one-line comparison against
  the caps literal. Scenario 29 (*"execute: an already-cancelled signal rejects before running
  anything"*) is a test of `adapters.CheckNotStarted` plus the scheduler, which `adapterhost` already
  covers — keep one per adapter anyway, as a three-line case, because it is the cheapest possible
  proof that the adapter honours Adapter rule 2.
- **Rewritten or dropped, each with its own reason, and each reason recorded in the Go file it
  would have lived in** (three of the four below are rewrites, not deletions — the table's last
  column counts them together because in each case the *original* assertion does not survive):
  - `mariadb`/`mysql` 33 and `sqlite` 32 (*"a failed connect leaves nothing open"*) assert on the
    TypeScript adapter's private `connectionSet`/`handle` field being null. In Go the equivalent is
    `a.db == nil` after a failed `Connect`, which is worth keeping — so these are **not** dropped;
    only their `performance_schema.SESSION_CONNECT_ATTRS`/`-wal` sidecar *mechanisms* change. Ported,
    re-derived. (Listed in the table's drop column only for `mariadb`/`mysql` 33's
    `SESSION_CONNECT_ATTRS` half, which needs `--performance-schema=ON` and asserts a
    `connectAttributes` feature `go-sql-driver` spells differently — see B23.)
  - `mysql.spec.ts` 2b (*"plaintext caching_sha2_password fails with an actionable E_AUTH, and both
    documented remedies work"*) — **this one is a genuine behaviour loss and B22 records it as one.**
    `go-sql-driver/mysql`'s `auth.go:400-430` requests the server's RSA public key over a plaintext
    connection **unconditionally**; there is no `allowPublicKeyRetrieval` gate to withhold it. The
    MySQL profile's whole reason for existing (`mysql/client.ts`, P34 D3/D5: *"Retrieving the
    server's RSA public key over an unauthenticated connection is an MITM window … which is why the
    driver defaults it off and why this is a per-connection choice"*) has no Go counterpart. The
    scenario is rewritten to assert the *new* behaviour — a plaintext `caching_sha2_password`
    connection succeeds — so the change is pinned by a test rather than discovered by a user.
  - `sqlite.spec.ts` 7 (*"cancel: caps says false, cancel() says false"*) is invalidated by
    P58 D8's capability change and is **replaced**, not dropped, by the real-cancellation case plus
    D8's own mandated regression test (§5.4).
  - `sqlite.spec.ts` 40 and `clickhouse.spec.ts` 42 (*"multi-statement input is refused"*) both port,
    but their mechanism changes: SQLite's is the adapter's own `assertSingleStatement` re-derived
    against the Go driver's prepare-and-tail behaviour (B9), ClickHouse's is the server's own
    refusal and needs no adapter code at all.

**The `waitUntil`-on-server-state pattern is the single most valuable thing in all four files and
ports verbatim**, exactly as P58a §1.7 said of the Postgres file. Its per-engine form:
`SHOW PROCESSLIST` (MariaDB/MySQL, `mariadb.spec.ts:302-412`), `system.processes` (ClickHouse,
`clickhouse.spec.ts:315-379`). SQLite has no server-side view — its cancellation proof is that a
long-running statement actually returns `E_CANCELLED` in bounded time *and* that the very next
statement on the same adapter succeeds (§5.4).

### 1.12 Two environment facts have changed since P58a was written

Both were checked in this sandbox for this plan, and both make P58b cheaper than the parent plan
assumes.

1. **This sandbox's Bun now has `node:sqlite`.** `AGENTS.md`'s SQLite section says *"This sandbox's
   own Bun (1.3.x) lacks `node:sqlite`, so `bun test tests/db/sqlite.spec.ts` here reports the
   legible `SQLITE_UNAVAILABLE_MESSAGE` failure rather than actually running the suite"*, and
   P58 §1.10's second non-portable point repeats it. `bun --version` is **1.4.0** and
   `import('node:sqlite')` resolves. Two consequences: `tests/db/sqlite.spec.ts` can be run **before**
   its Go successor, giving a live oracle to diff against — which is exactly what an implementer
   wants when re-baselining a value codec; and `tests/e2e-real/sqlite-real.spec.ts`, whose
   `sqliteAvailable()` gate skipped it here, now runs. That spec is C1b's SQLite vehicle (§7), and
   its gate stays: the *fixture* still seeds the file with `node:sqlite`, even after the *adapter*
   is Go.
2. **`testcontainers-go`'s ClickHouse module sets no ulimits at all.** P58 §4.10 flagged this as a
   *"check, do not assume in either direction"* item. Checked:
   `modules/clickhouse@v0.44.0/clickhouse.go:76` sets a single wait strategy —
   `wait.NewHTTPStrategy("/").WithPort("8123/tcp")` — and nowhere calls `WithUlimits`. So
   `@testcontainers/clickhouse`'s hardcoded `nofile: {hard: 262144}`, this sandbox's fixed 20 000
   ceiling, and `tests/ipc/clickhouse/container.ts`'s `NoUlimitClickHouseContainer` subclass
   **have no Go counterpart and the workaround simply disappears**. A whole paragraph of
   `AGENTS.md`'s Docker section becomes historical for the Go tier, and §8 requires recording that.
   The `mirror.gcr.io` retag is unaffected — it is a daemon-level fact and applies unchanged.

Two further module facts, recorded because §6's TC-2 probe should confirm rather than assume them:
`modules/mysql@v0.44.0` waits on `wait.ForLog("port: 3306  MySQL Community Server")` and
`modules/mariadb@v0.44.0` on `wait.ForLog("port: 3306  mariadb.org binary distribution")`. Both
should be correct — the entrypoint's init boot runs with networking off and logs `port: 0`, which is
precisely the distinction `tests/db/support/mysql.ts`'s own comment says a TCP-reaching healthcheck
was needed for — but "should be correct" is what M6.0 is for.

## 2. Decisions

**B1 — `mysqlfamily` is one Go package; `mariadb` and `mysql` are two ~30-line packages holding a
profile, a caps literal and an `init()`.** P58 D19, applied, and §1.4 is the verification the parent
asked for: one driver really does serve both servers, with MariaDB's own `client_ed25519` plugin
implemented. Each profile package registers its own kind
(`adapters.Register("mariadb", …)`), so `internal/adapters/registry.go` is not edited and
`shell/main.go` gains two blank imports rather than one. **The three re-export shims
(`mariadb/{read,query,definition}.ts`, 2–4 lines each) have no Go counterpart** — they exist only so
`tests/db/mariadb.spec.ts:7`'s import compiles (P34 D7's own commit-1 criterion), and a Go test
imports `mysqlfamily` directly.

**B2 — every mysql-family DSN sets `interpolateParams=true` and leaves `parseTime` off.** §1.4 fact
1. This is the text-protocol switch, the direct analogue of P58a's `pgx.QueryExecModeSimpleProtocol`
finding, and it is what makes the driver return the server's own bytes. `parseTime=true` would hand
back `time.Time` for `DATE`/`DATETIME`/`TIMESTAMP` and re-introduce, on the MySQL side, exactly the
declared-type coercion §1.5 rejects `mattn/go-sqlite3` for. Both are set in code, not read from the
user's URI: `mysql.ParseDSN` is given the parsed URI's own parameters, then these two are forced
afterwards, so a user's connection string cannot turn them off.

**B3 — a data cell's text-vs-hex decision reads `ColumnTypeDatabaseTypeName`, not a collation
table.** §1.4 fact 2. `"BLOB"`, `"TINYBLOB"`, `"MEDIUMBLOB"`, `"LONGBLOB"`, `"BINARY"`,
`"VARBINARY"`, `"GEOMETRY"`, `"BIT"` → `0x<hex>`; everything else → the raw bytes as a string.
`typeCastString`'s collation lookup and its two `Set`s are deleted, not ported: the driver already
made the decision the TypeScript had to make by hand. Rows scan into `sql.RawBytes` and are copied
into the page builder within the same `Next()` iteration.

**B4 — the query console loses `tinyint(1) → boolean`, and a Go test pins the loss.** §1.4 fact 3.
`ColumnTypeLength` is commented out upstream, so a `TINYINT` console column classifies as `number`.
The read path is unaffected (it reads `COLUMN_TYPE` from `information_schema`). This is a
render-pane choice on a read-only result set, not a data change. It is recorded in
`docs/ARCHITECTURE.md`'s per-engine section and in `mysqlfamily/console.go`'s own comment, and
`mysqlfamily`'s Go suite gets a case asserting `number` so the next person to "fix" it finds a test
explaining why it is that way.

**B5 — `ConnectionSet` becomes one `*sql.DB` per (connection, database) with `SetMaxOpenConns(1)`,
holding one pinned `*sql.Conn`; the thread id comes from `SELECT CONNECTION_ID()` once per pinned
connection.** P58 D20, and `client.ts:76-78`'s reason ported verbatim: *"one `Connection` per
(connection, database), never a pool, bounded at 8 with LRU eviction of non-primary connections.
`KILL QUERY` needs a known `threadId`, which a pool does not reliably give you."* `database/sql`
hands out a pool by default and go-sql-driver exposes no thread id, so both halves need saying in
code. The 8-entry LRU with a never-evicted primary ports as written.

**B6 — mysql-family never passes the op's context to the driver.** §1.7. Every `QueryContext`/
`ExecContext` runs inside `adapters.RunWithAbortRace` on `context.WithoutCancel(ctx)`. The
server-side kill is `KILL QUERY <threadId>` on a short-lived side connection, exactly as today, and
it is the *only* thing that stops the query. `safeThreadId`'s `Number.isSafeInteger` guard has no Go
counterpart (thread ids are `uint64` on the wire, `int64` here) and is deleted, not ported — the same
call P58 D7 makes for Kafka's `toNativeOffset`.

**B7 — SQLite's driver is `modernc.org/sqlite`, not `mattn/go-sqlite3`.** §1.5, and it is a
correction to P58 D8's first part rather than a preference. `mattn/go-sqlite3` coerces
`SQLITE_INTEGER`/`SQLITE_TEXT` values on the *declared* column type into `time.Time` and `bool`, and
returns the **zero time** when the re-parse fails — silently, below `database/sql`, with no DSN
opt-out. That contradicts `sqlite/read.ts`'s documented D3/D21 codec and would break the existing
fixture's twelve `BOOLEAN`/`DATE`/`DATETIME`/`TIMESTAMP` columns. `modernc.org/sqlite` returns
storage-class-faithful values by default and puts the compatibility behaviour behind `_inttotime`/
`_texttotime`, which this adapter never sets. Costs paid and named: a second SQLite implementation in
the binary and a slower engine on write-heavy work. **The cgo question is not part of this
argument** — cgo is already required by `internal/storage` and `internal/shell`, so "pure Go" is
neither a selling point nor a cost here. §6's SQ-1 settles it empirically; §10 OQ-1 raises it to the
parent's author.

**B8 — `sqliteCaps.cancel` becomes `true`, and the mechanism is an adapter-owned per-op driver
context.** P58 D8's second part, with the half the parent left open filled in. There is no side
connection to cancel from, so `Cancel(opID)` cannot work the way the other three SQL adapters' do.
The adapter keeps `runningByOp map[string]context.CancelFunc`; every statement runs on a context
**derived from `context.Background()`**, not from the op's, and cancelled only by
`Cancel(opID)` — which is what makes `modernc.org/sqlite`'s `interruptOnDone` fire
`sqlite3_interrupt`. `adapters.RunWithAbortRace` still races the caller's own `ctx.Done()`, so a
local abort unblocks the caller immediately without touching the statement. This preserves
`adapterhost.Host.CancelOp`'s two-step discipline exactly (*"the local abort alone is not a
cancel"*) while making the second step real for the first time on this engine. **P58 D8's third
part is kept unchanged**: every op holds its own `*sql.Conn` for its whole lifetime, so an interrupt
can only reach the statement it was aimed at.

**B9 — `assertSingleStatement` is kept and re-derived, not deleted.** `sqlite/query.ts:16-28`'s
guard exists because `node:sqlite`'s `prepare()` *"silently keeps only the first statement of a
multi-statement string, with no error"*, and the console's contract is one page per statement. The
Go driver's behaviour here is different in mechanism and must be established by SQ-1 rather than
assumed; whatever it turns out to be, the *contract* — a dropped tail is refused with
`E_QUERY "multiple statements are not supported in a single statement"` — is preserved verbatim, and
`sqlite.spec.ts` 40 is the test.

**B10 — SQLite gets its own `testsupport/sqlite.go`, and it is the only fixture in the Go tier with
no Docker gate.** The TypeScript precedent is explicit (`AGENTS.md`'s SQLite section: *"a temp-file
fixture (`mkdtemp` + `node:sqlite`), not a Testcontainers harness — there is no container to start,
no image to pull, no daemon to reach"*), and the Go version is simpler still because it needs no
runtime-availability gate either. It does need `StartSqlite(t)`/`StopSqlite()` and a `TestMain`,
for the same reason every other fixture does (B15): a `t.Cleanup`-registered `rmSync` on the first
test to call it deletes the database out from under the rest of the package. It seeds from
`tests/db/fixtures/0009_sqlite_seed.sql` unchanged and runs the same
`WITH RECURSIVE` 1 000 000-row insert plus `ANALYZE big_rows` — the second step P58a's findings
record as having been silently skipped the first time round for Postgres.

**B11 — ClickHouse speaks the HTTP interface directly over `net/http`; `shell/go.mod` gains no
ClickHouse module.** §1.6. `clickhouse-go/v2`'s HTTP transport pins `default_format=Native` and
explicitly discards a `default_format` override, so the `JSONCompactStringsEachRowWithNamesAndTypes`
format the adapter's entire value codec and its whole spec file are written against is unreachable
through it. The alternative is re-implementing ClickHouse's own text formatter for
`Decimal128`/`Float` NaN/`Enum8`/`UUID`/`IPv4`/`IPv6`/`Array`/`Tuple`/`Map`/`DateTime64` in Go and
keeping it byte-identical forever. Precedent: P58 D6's own RabbitMQ row (*"no library —
`net/http`"*) and §1.8's finding that this made RabbitMQ the simplest adapter rather than the
hardest. §6's CH-1 settles it; §10 OQ-2 raises it.

**B12 — ClickHouse's error mapping reads the exception code from the response, in three places, in
this order.** `X-ClickHouse-Exception-Code` (a header, present on a failed request); then the body's
first `Code: N. DB::Exception: …` prefix; then, for a 200-OK response whose body ends in an
`__exception__` trailer, the code inside that trailer. `errors.ts`'s fifteen-code table
(`UNKNOWN_DATABASE` 81, `TIMEOUT_EXCEEDED` 159, `READONLY` 164, `QUERY_WAS_CANCELLED` 394, …) and
its own dispatch order port verbatim; only the *extraction* changes. The mid-stream case is the one
`@clickhouse/client` handled invisibly, and CH-1 measures its exact bytes against
`clickhouse-server:26.3` before the reader is written.

**B13 — ClickHouse keeps its own literal renderer and its own single multi-row `INSERT`.**
`clickhouse/mutate.ts`'s `literalFor` uses backslash escaping (P36 D6/F27), not
`adapters.LiteralRenderer`'s doubled quotes, and `renderInsert` emits **one** statement for a whole
plan (columns = the union across ops, missing values padded `NULL`) rather than one per op, because
`preview()` must render what `mutate()` runs. So ClickHouse uses exactly one function from
`sqlmutate.go` — `AssertColumnsKnown` — plus `ResolveDatabaseTablePath`, and none of `OrderedOps`,
`RenderRowOp`, `LiteralRenderer`, `NewParamRenderer`, `AssertAffectedExactlyOne` or
`AssertKeyIsPrimaryKey`. That is not an omission to fix.

**B14 — `runWithAbortRace` is hoisted to `internal/adapters/abort.go` as
`adapters.RunWithAbortRace`, in M6.1, before any adapter.** §1.7. It is the Go successor to
`src/engine/adapters/abort.ts`, it keeps its doc comment (including the *"do not 'fix' it by trying
to make the query itself abort"* rule and the pgx-specific reasoning, generalised to name all four
drivers), and `postgres/query.go` becomes its first caller rather than its owner. This reverses
P58a §4.11's *"it does not [stay a shared helper]"*, which was correct with one caller.

**B15 — `internal/adapters/testsupport` gains a generic memo and one documented rule, and three new
fixtures use them.** The rule, from `AGENTS.md`'s P58a findings, restated as code rather than prose:
*a fixture's teardown is never registered with `t.Cleanup`; it is an exported `StopX()` called from
the package's own `TestMain` after `m.Run()`.* A small generic (`type fixture[T any]` with
`get(t, start) T` and `stop(terminate func(T))`) makes the shape hard to get wrong, and the existing
`StartPostgres`/`StopPostgres` pair is refactored onto it in the same commit so there is exactly one
example, not two. The shared spec helpers `postgres_test.go` already grew — the recording `OpCtx`,
`readTabular`, `cellAt`, `isNull` — move beside it as an exported test-support package so three more
adapters do not each write their own.

**B16 — the Node-served placeholder kind in other packages' tests becomes one exported constant.**
§1.8. `adapterhost.TestKindNodeServed` (currently `"mongodb"`, P58c's), with a doc comment naming
which sub-phase must next move it, replaces the five hardcoded `"mariadb"` literals.

**B17 — four `tests/db/*.spec.ts` files are deleted, one `tests/db/support/*.ts` file is deleted,
and the support deletion is re-checked at implementation time.** §1.9. `mariadb.spec.ts`,
`mysql.spec.ts`, `sqlite.spec.ts`, `clickhouse.spec.ts` each go in the commit **after** their Go
successor is green (P58 D12's third rule, P58a A21's discipline). Of the four support modules only
`clickhouse.ts` has no other consumer; the other three stay. §9's commit 24 re-runs the grep before
deleting, because §1.9's table is a snapshot and `AGENTS.md` says so.

**B18 — the four `caps` literals are ported value for value, and exactly one value changes.**
`mariadbCaps` and `mysqlCaps` stay two separate literals with identical values (P34 D10: *"if MySQL's
capabilities ever diverge … this literal is where that gets said"*). `clickhouseCaps` ports
unchanged, including `canUpdate: false`, `canDelete: false`, `transactions: false`,
`foreignKeys: false` and `pagination: "offset"` — all four permanent facts about the engine, not
gaps. `sqliteCaps` changes exactly one field: `cancel: false` → `true` (B8), and the
`docs/ARCHITECTURE.md` sentence that currently reads *"permanently `false`"* is rewritten **in the
same commit**, per P58 D8's own instruction that a stale "permanently false" would be worse than no
comment.

**B19 — the three packages keep one Go file per TypeScript file.** P58 D18 and P58a A20, applied:
`index.ts` → `adapter.go` (Go has no `index` convention), everything else keeps its name. The point
is diffability across a 4 685-line port: when a Go behaviour disagrees with the TypeScript,
`clickhouse/read.go` and `clickhouse/read.ts` are the two files to put side by side.

**B20 — `nativeKinds` grows in three separate commits, never one.** §0.3. `{"mariadb","mysql"}` at
the end of M6.2 (one commit — the two are the same adapter and the same test run),
`{"sqlite"}` at the end of M6.3, `{"clickhouse"}` at the end of M6.4. Each commit's message records
which acceptance suite went green immediately before it.

**B21 — P58b's `src/` diff is empty, and §5.2 asserts the strong form.** The one shared frontend
change these adapters need — `toTypedArray`'s base64 branch — already exists in the tree
(§1.3, verified at `port.ts:76-91`). Every milestone ends with `git diff --stat src/` returning
nothing at all. If it is ever non-empty, either P58 D1 was broken or the substrate has a coupling
neither P58a nor this plan found, and the implementer should stop and say so rather than absorb it.

**B22 — MySQL's `allowPublicKeyRetrieval` option is removed, and the security change is recorded as
a loss.** §1.11. `go-sql-driver/mysql` requests the server's RSA public key over a plaintext
connection unconditionally (`auth.go:400-430`), with no opt-in gate, so the option would be a no-op
that reads like a control. `mysql/client.ts`'s `applyEngineOptions` becomes empty and the MySQL
profile keeps existing only for its server label — a smaller profile, honestly. `errors.ts`'s
`RSA_KEY_MESSAGE` and its two errno branches (45044, 45063) go with it. This lands in
`docs/ARCHITECTURE.md`'s per-engine section and in `AGENTS.md`'s P58b findings as a **capability
loss**, alongside P58 §7's list, and `mysql.spec.ts` 2b is rewritten to assert the new behaviour
rather than deleted.

**B23 — the connect-attribute probe changes mechanism and keeps its assertion.**
`mysql-family/client.ts` sets `connectAttributes: { program_name: 'kira-studio' }`;
`go-sql-driver`'s equivalent is the `connectionAttributes` DSN parameter
(`connectionAttributes=program_name:kira-studio`). `mariadb.spec.ts`/`mysql.spec.ts` scenario 1
asserts through `performance_schema.SESSION_CONNECT_ATTRS` that the attribute is present while
connected and gone after disconnect; the Go fixture keeps `--performance-schema=ON` on the MariaDB
container so the assertion survives.

**B24 — `sslmode` maps to a registered `*tls.Config`, and the `verify-full` post-handshake
inspection is deleted rather than ported.** `mysql.RegisterTLSConfig(name, cfg)` plus `tls=<name>` in
the DSN. `disable`/absent → no TLS; `require`/`prefer` → `&tls.Config{InsecureSkipVerify: true}`;
`verify-full` → a real verifying config with `ServerName` set from the host. Everything in
`client.ts:110-138` about `info.selfSignedCertificate`, `tlsAuthorizationError`, racing socket
handlers and `oven-sh/bun#7332` describes a JavaScript driver under Bun and has no subject in Go.
An unknown `sslmode` keeps its warn-and-ignore behaviour.

## 3. Target tree

```
shell/internal/adapters/
  abort.go                      NEW    M6.1  RunWithAbortRace, hoisted from postgres/query.go (B14)
  postgres/query.go             EDITED M6.1  calls adapters.RunWithAbortRace; local copy deleted
  testsupport/
    fixture.go                  NEW    M6.1  the generic memo + the TestMain rule as code (B15)
    postgres.go                 EDITED M6.1  refactored onto fixture.go; behaviour unchanged
    spec.go                     NEW    M6.1  recording OpCtx, readTabular, cellAt, isNull —
                                             lifted out of postgres_test.go (B15)
    mariadb.go                  NEW    M6.2  mariadb:11.4, 0002_mariadb_seed.sql, seq_1_to_N big_rows,
                                             kira/kira_analytics users, --performance-schema=ON (B23)
    mysql.go                    NEW    M6.2  mysql:8.4, 0008_mysql_seed.sql, the digits cross join,
                                             TLS-on-by-default server, the kira user
    sqlite.go                   NEW    M6.3  a temp dir, 0009_sqlite_seed.sql, WITH RECURSIVE
                                             big_rows + ANALYZE. No Docker gate (B10)
    clickhouse.go               NEW    M6.4  clickhouse/clickhouse-server:26.3, 0010_clickhouse_seed.sql
                                             over HTTP, kira_admin/kira/kira_ro users. No ulimit
                                             workaround needed (§1.12)
  mysqlfamily/                  NEW    M6.2  (B1, B19) 10 files, one per mysql-family/*.ts:
    adapter.go   client.go   query.go   read.go   catalog.go
    definition.go console.go  mutate.go  errors.go  profile.go
    mysqlfamily_test.go         NEW    the shared acceptance suite, run twice (§5.3)
    mariadb_test.go             NEW    MariaDB's container + its engine-specific cases
    mysql_test.go               NEW    MySQL's container + its five engine-specific cases
    main_test.go                NEW    one TestMain, stopping both containers after m.Run()
  mariadb/                      NEW    M6.2  caps.go + profile.go + init() — ~30 lines
  mysql/                        NEW    M6.2  caps.go + profile.go + init() — ~30 lines (B22: the
                                             profile's applyEngineOptions is now empty)
  sqlite/                       NEW    M6.3  (B19) 10 files, one per sqlite/*.ts:
    adapter.go   client.go   query.go   read.go   catalog.go
    definition.go console.go  mutate.go  errors.go  caps.go
    sqlite_test.go, main_test.go
  clickhouse/                   NEW    M6.4  (B19) 10 files, one per clickhouse/*.ts, where
    adapter.go   client.go   query.go   read.go   catalog.go       client.go is now an HTTP
    definition.go console.go  mutate.go  errors.go  caps.go        client rather than a driver
                                                                   wrapper (B11)
    clickhouse_test.go, main_test.go

shell/internal/adapterhost/router.go        EDITED  nativeKinds grows in three commits (B20);
                                                    TestKindNodeServed exported (B16)
shell/internal/adapterhost/router_test.go   EDITED  M6.1  uses TestKindNodeServed (B16)
shell/internal/adapterhost/{integration,dataframe}_test.go  EDITED M6.1  same (B16)
shell/internal/connections/service_test.go  EDITED  M6.1  same (B16)
shell/internal/tree/service_test.go         EDITED  M6.1  same (B16)
shell/main.go                               EDITED  four blank imports (mariadb, mysql, sqlite,
                                                    clickhouse), one per milestone
shell/go.mod                                EDITED  + go-sql-driver/mysql, modernc.org/sqlite,
                                                    + testcontainers modules mysql/mariadb/clickhouse
                                                    (test-only). No ClickHouse driver (B11)

shell/internal/{page,enginecache,enginebackend}/**   UNCHANGED  §1.3 — deliberately, not by omission
shell/internal/{oplog,enginehost,storage}/**         UNCHANGED
src/**                                               UNCHANGED  B21 — every file, including port.ts

tests/db/mariadb.spec.ts                    DELETED  M6.2 last commit (B17)
tests/db/mysql.spec.ts                      DELETED  M6.2 last commit
tests/db/sqlite.spec.ts                     DELETED  M6.3 last commit
tests/db/clickhouse.spec.ts                 DELETED  M6.4 last commit
tests/db/support/clickhouse.ts              DELETED  M6.4 last commit — after §9 c24's re-grep (B17)
tests/db/support/{mariadb,mysql,sqlite}.ts  UNCHANGED  real consumers elsewhere (§1.9)
tests/db/fixtures/*.sql                     UNCHANGED  the Go seeders read these exact files
tests/ipc/**                                UNCHANGED  §1.10 — the generator port is P58f's (P58 D13)
tests/ui/**                                 UNCHANGED  P58a A10
tests/e2e-real/mariadb-real.spec.ts         NEW      M6.4  C1b's vehicle (§5.6, §7)
tests/e2e-real/support/mariadb.ts           NEW      M6.4  re-exports tests/db/support/mariadb.ts,
                                                     mirroring support/sqlite.ts's own shape
tests/e2e-real/sqlite-real.spec.ts          UNCHANGED  now runs here (§1.12) and covers SQLite native
package.json                                UNCHANGED  test:db runs a directory; deleting a spec
                                                     needs no script edit (§5.1)

docs/ARCHITECTURE.md                        EDITED  per-database mapping (SQLite's cancel cell),
                                                    Per-engine facts (PostgreSQL/MariaDB/MySQL,
                                                    SQLite, ClickHouse), Stack's driver line
docs/v1/plans/P58b-mysql-sqlite-clickhouse.md EDITED  M6.0 results, then M6.1-M6.4 results (§9)
AGENTS.md                                   EDITED  the P58b findings entry; the SQLite section's
                                                    Bun-1.3 paragraph and the ClickHouse ulimit
                                                    paragraph both become historical for the Go tier
```

## 4. Designs

### 4.1 `mysqlfamily`, file by file

`database/sql` + `github.com/go-sql-driver/mysql`, one `*sql.DB` per (connection, database) with
`SetMaxOpenConns(1)` and one pinned `*sql.Conn` (B5). Explicitly **not** a shared pool, for
`client.ts`'s own reason.

| Go file | Ports | Key points |
|---|---|---|
| `profile.go` | `profile.ts` | `Profile{Kind, ServerLabel string; ApplyEngineOptions func(*mysql.Config, model.ResolvedConnectionConfig, LogFunc)}`. Three fields, deliberately — P34 D9's *"a profile field must change observable behaviour, or it does not exist"* holds, and after B22 MySQL's `ApplyEngineOptions` is empty, which is worth a comment rather than a deletion of the field |
| `client.go` | `client.ts` | `buildConfig` → `mysql.NewConfig()` + the parsed URI or the fields; `Params["connectionAttributes"] = "program_name:kira-studio"` (B23); `InterpolateParams = true`, `ParseTime = false`, `MultiStatements = false`, `AllowNativePasswords = true` (B2); the `sslmode` → `RegisterTLSConfig` mapping (B24). `ConnSet` with `Get(ctx, database)`, `Primary(ctx)`, `CloseAll(ctx)`, the 8-entry LRU that never evicts the primary, and — the Go-only addition — one `SELECT CONNECTION_ID()` per pinned conn, cached on the entry |
| `query.go` | `query.ts` | `runQuery`/`runCommand`: `op.SetCommand` **before** the statement (rule 3), `adapters.CheckNotStarted`, `track(RunningQuery{ThreadID: entry.threadID})` with the identity-checked release, then `adapters.RunWithAbortRace` (B6). `typeCastString` is replaced by B3's `DatabaseTypeName` switch and moves to `read.go` beside the other cell-text logic. `logParams` ports as written |
| `read.go` | `read.ts` | `QuoteIdent` (NUL check, backtick doubling), `TypeClassFor` over the catalog's `COLUMN_TYPE` string — **`tinyint(1)` checked before the general number match**, `\b`-anchored, so `int` and `int(11)` classify identically (`mysql.spec.ts` 35's own point) — `cellText(raw []byte, dbType string) *string` (B3), `ReadPage`, `CountRows`. `ReadPage` is the same eleven-step shape as `postgres/read.go`'s and should be diffed against it, not written fresh |
| `catalog.go` | `catalog.ts` | The eight `information_schema` queries, SQL text unchanged, `?` placeholders unchanged. Two scanning notes the TypeScript has as comments and Go makes moot: `ORDINAL_POSITION` and `NON_UNIQUE` come back as `BIGINT` and needed `Number(...)` coercion in JS; in Go they scan into `int64` and `int` directly, and the `0n !== 0` trap disappears. `SYSTEM_SCHEMAS`'s four-placeholder `NOT IN` ports as written |
| `definition.go` | `definition.ts` | `SHOW CREATE TABLE`/`SHOW CREATE VIEW` passed through verbatim (*"MariaDB is asked, never composed"*), `stripOneTrailingSemicolon`, `listConstraints`'s two `information_schema` queries and its `FIELD(...)` ordering, the two `notes` strings verbatim. `generatedAt` is `time.Now().UTC().Format(time.RFC3339Nano)`, matching `postgres/definition.go` |
| `console.go` | `console.ts` | `runRaw` (no per-statement `SetCommand`), the row-vs-OkPacket split — in Go that is `db.QueryContext` vs `db.ExecContext`, and unlike TypeScript the driver does not hand back a union, so the console needs the same leading-keyword decision ClickHouse already makes, or a `QueryContext` that tolerates a zero-column result. **Prefer the latter**: go-sql-driver returns a `*sql.Rows` with zero columns for a non-row-returning statement over `comQuery`, so `len(cols) == 0` is the same signal `StatementSync.columns().length === 0` gives SQLite. MY-1 confirms it. `typeClassForField` ports over `DatabaseTypeName` minus B4's boolean case |
| `mutate.go` | `mutate.ts` | `ResolveDatabaseTablePath`, `Preview` (synchronous, no catalog, no network), `Mutate`'s fresh `getReadTarget` in the same op, the three per-op guards, the single `SetCommand` for the whole batch, and `START TRANSACTION`/…/`COMMIT` with `ROLLBACK` on any failure — issued through the **same pinned `*sql.Conn`**, which is what makes the transaction real under `database/sql` |
| `errors.go` | `errors.ts` | `mapError` over `*mysql.MySQLError.Number`: 1045 → `E_AUTH`, 1317 → `E_CANCELLED`. The three Node errno branches (`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/`ER_GET_CONNECTION_TIMEOUT`) re-derive against `*net.OpError`/`*net.DNSError`/`os.ErrDeadlineExceeded` — the same re-derivation `postgres/errors.go` already did, and the same rule: against real failures in the Go suite, never guessed. 45044/45063 are deleted with B22 |
| `adapter.go` | `index.ts` | The `Adapter` implementation, the path-shape validation for each method, `runningByOp` + `trackerFor`'s identity-checked release, `connect`'s assign-the-handle-before-opening-anything rule (P13 D1), the MySQL-connected-to-MariaDB **warning** (P34 D6 — a warning, never a connect failure), `describe`'s sequential (never concurrent) catalog queries, and `Cancel`'s side connection |

`Cancel`, written out, because it is what C1b turns on and because its shape differs from Postgres's
in exactly one place:

```go
// Cancel opens a connection of its own — not the ConnSet's, never pooled — and runs
// KILL QUERY <threadId>. index.ts:344-370's shape. Killing your own query needs no PROCESS/SUPER
// privilege, which is why the fixture can run the adapter as the unprivileged `kira` user.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
        a.mu.Lock()
        running, ok := a.runningByOp[opID]
        delete(a.runningByOp, opID)
        cfg := a.cfg
        a.mu.Unlock()
        if !ok || cfg == nil || running.ThreadID == 0 {
                return false, nil
        }

        side, err := sql.Open("mysql", sideDSN(*cfg, a.profile, a.deps.Log))
        if err != nil { /* log warn; return false, nil */ }
        defer side.Close()
        // The thread id is an unsigned 64-bit server-side identifier and never user input, so it is
        // formatted into the statement rather than bound — KILL takes no placeholder.
        if _, err := side.ExecContext(ctx, "KILL QUERY "+strconv.FormatUint(running.ThreadID, 10)); err != nil {
                /* log warn; return false, nil */
        }
        return true, nil
}
```

Three details, each one a place a correct-looking port loses behaviour: the op is removed from
`runningByOp` **before** the side connection is opened (a second cancel is a no-op); every failure
is logged and reported as `false` rather than returned as an error (*"cancel() never throws for
'already finished'"*); and `sql.Open` does not dial, so the real failure surfaces from
`ExecContext` — which means the `err != nil` on `Open` is about a malformed DSN, not about the
server.

### 4.2 `sqlite`, file by file — and the cancellation design

`modernc.org/sqlite` through `database/sql` (B7). One `*sql.DB` for the whole adapter with
`SetMaxOpenConns(1)`; every op takes `db.Conn(ctx)` and holds it for the op's lifetime (P58 D8's
third part).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | `resolveFilePath` (fields mode repurposes `database` as the absolute path, D10/D13; URI mode percent-decodes), `assertFileExists` — **kept, and load-bearing**: D8's *"Kira never creates a database"* rule. The Go driver would also create on open, so the `os.Stat` check ports first and the DSN additionally uses SQLite's own `mode=ro`/`mode=rw` (never `rwc`) as a second line of defence. DSN: `file:<path>?_busy_timeout=5000&_foreign_keys=1&_txlock=immediate` plus `&_query_only=1` and `mode=ro` when `cfg.readOnly`. The `node:sqlite`-unavailable branch has no Go counterpart and is deleted |
| `query.go` | `query.ts` | `prepareOne` + `assertSingleStatement` (B9), `runQuery`/`runCommand`/`execLiteral`. **`setReadBigInts` and the whole `SqliteParam` union disappear** — Go's `int64` is exact and `any` covers every bind type — and the two comments explaining why the catalog path deliberately opted out go with them. Every call goes through `adapters.RunWithAbortRace` with B8's adapter-owned context |
| `read.go` | `read.ts` | `QuoteIdent`, `TypeClassFor` over the declared type (the five affinity rules plus `BOOL`/date-family/`JSON` sugar, and `'other'` for an undeclared or `ANY` column — unchanged), `resolveKeysetColumnMeta` (the synthetic rowid `ColumnMeta` handed to `ResolveFetchColumns`'s `resolveHidden` hook), `ReadPage`, `CountRows`, and **`toCellText`**, which is the file that B7 exists for: `nil` → NULL, `[]byte` → `0x<hex>`, `int64` → decimal, `float64` → its shortest exact form, `string` → verbatim. Nothing switches on the declared type |
| `catalog.go` | `catalog.ts` | `PRAGMA database_list`, `PRAGMA table_list`, and the four table-valued pragma functions with **bound parameters** (`SELECT * FROM pragma_table_xinfo(?)`) — Adapter rule 7 in its strongest form, ported exactly. `loadRowEstimates`/`getRowEstimateFor` keep the missing-`sqlite_stat1`-table fallback (P57 e2e-revisit §7 item 1: a never-ANALYZEd database must not take tree enumeration down), re-derived against the Go driver's error rather than `AdapterError.code === 'E_QUERY'`. `pickRowidColumn`'s three-alias shadow check and the `type !== 'view'` guard (found empirically, *"reading order_summary crashed with 'no such column: rowid'"*) port verbatim |
| `definition.go` | `definition.ts` | `SELECT sql FROM sqlite_master WHERE type = ? AND name = ?` — the whole "asked, never composed" story in one query — `buildConstraints`' PK/UNIQUE/FK composition and the CHECK-constraint note, verbatim |
| `console.go` | `console.ts` | Column count as the row-returning signal, one page per statement, `.iterate()`-equivalent streaming (`*sql.Rows` already streams — the TypeScript needed `.iterate()` explicitly to avoid `.all()`'s second copy, and Go gets that for free), `singleStatusPage("<n> row(s) affected", "text")` |
| `mutate.go` | `mutate.ts` | `BEGIN IMMEDIATE` (D25 — a deferred BEGIN takes its write lock at the first write, so a contended file fails mid-batch), the three guards, the rowid-is-never-mutation-identity rule (D23), the single `SetCommand`, `COMMIT`/best-effort `ROLLBACK`. Issued on the op's own pinned `*sql.Conn` |
| `errors.go` | `errors.ts` | `mapError` over the driver's error code, **primary code = `code & 0xff`** (F6's rule, unchanged): `CANTOPEN`(14)/`NOTADB`(26) → `E_CONNECT`; `BUSY`(5)/`LOCKED`(6) → `E_TIMEOUT`; `READONLY`(8) → `E_UNSUPPORTED`; everything else → `E_QUERY` with SQLite's own message verbatim. `modernc.org/sqlite`'s error type is re-derived in SQ-1, not assumed |
| `caps.go` | `caps.ts` | The literal, one field changed (B18) |
| `adapter.go` | `index.ts` | The `Adapter` implementation; `Cancel` per B8 |

**The cancellation design, written out, because it is the one genuinely new mechanism in P58b:**

```go
// Every statement runs on a context the adapter owns, derived from Background rather than from the
// op's own ctx. That is deliberate and is what makes caps.cancel honest: adapterhost.Host.CancelOp
// cancels the op context first (unblocking the caller) and then calls Cancel(opID) — and only the
// second step must be allowed to reach the statement, or "cancelled" would mean "we stopped
// waiting", which is exactly what §5.1's rule forbids. modernc.org/sqlite's interruptOnDone turns
// this cancellation into sqlite3_interrupt on the op's own dedicated *sql.Conn (P58 D8's third
// part), so it can only ever reach the statement it was aimed at.
func (a *Adapter) runOnConn(ctx context.Context, opID string, fn func(context.Context, *sql.Conn) error) error {
        conn, err := a.db.Conn(ctx)
        if err != nil { return mapError(err) }
        defer conn.Close()

        driverCtx, cancel := context.WithCancel(context.Background())
        a.register(opID, cancel)
        defer a.release(opID, cancel)

        return adapters.RunWithAbortRace(ctx, func() {}, func(context.Context) error {
                return fn(driverCtx, conn)
        })
}

// Cancel is the second half. caps.cancel is true because this actually interrupts a running
// statement — a change from the TypeScript adapter, whose node:sqlite had no sqlite3_interrupt at
// all (P58 D8).
func (a *Adapter) Cancel(_ context.Context, opID string) (bool, error) {
        a.mu.Lock(); cancel, ok := a.runningByOp[opID]; delete(a.runningByOp, opID); a.mu.Unlock()
        if !ok { return false, nil }
        cancel()
        return true, nil
}
```

`RunWithAbortRace`'s `release` argument is a no-op here because SQLite's registration is keyed on
the op rather than on a per-statement handle; a multi-statement op (mutate's transaction, the
console's "Run all") registers once at the top and the identity check that Postgres and
mysql-family need has no analogue.

### 4.3 `clickhouse`, file by file — and the HTTP client

`net/http` (B11). No driver, no pool of the driver's own — one `*http.Client` with a
`http.Transport` whose `MaxIdleConnsPerHost` is at least 2, so the `KILL QUERY` request always has a
free connection (`caps.ts`'s own F7/F9 note: *"a second HTTP request the client's own connection
pool already has free"*).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | `resolveTarget` (fields or URI; `sslmode` → `http`/`https`, warn-and-ignore for anything else; port defaults to 8123), the four fixed settings as URL parameters on every request (`default_format=JSONCompactStringsEachRowWithNamesAndTypes`, `output_format_json_validate_utf8=1`, `show_table_uuid_in_table_create_query_if_not_nil=0`, `date_time_output_format=simple`), `database=<db>` as a URL parameter (the construction-time default the TypeScript client held), and `X-ClickHouse-User`/`X-ClickHouse-Key` for credentials. `Handle{client, url, defaultDatabase, readOnly}` |
| `query.go` | `query.ts` | The three entry points, one for one: `streamQuery` (the `JSONCompactStringsEachRowWithNamesAndTypes` reader — line 1 names, line 2 types, everything after is a JSON array of strings, with the `ᴺᵁᴸᴸ` sentinel decoded to nil), `runCommand` (no `FORMAT` appended — an `INSERT`'s own `FORMAT` names the *input* format), and `runCatalogQuery` (`FORMAT JSON` with `param_<name>` bound values, `ctx.SetCommand`, the `readonly=2` setting when the connection is read-only). All three take a `queryID` and register it with `track`; all three run inside `adapters.RunWithAbortRace` (§1.7) |
| `read.go` | `read.ts` | `QuoteIdent` (backticks, NUL guard), `unwrapType` (recursive `Nullable(...)`/`LowCardinality(...)` in either nesting order), `baseTypeName`, `TypeClassFor` with its four sets ported as `map[string]bool`, `computeOrderBySql` (a requested sort, else the table's own `sorting_key` verbatim), the `E_UNSUPPORTED` refusal of any non-offset cursor with its message verbatim, and the `PagePosition{Strategy: "offset", NextToken: nil, PrevToken: nil}` literal (§1.1) |
| `catalog.go` | `catalog.ts` | The `system.databases`/`system.tables`/`system.columns`/`system.data_skipping_indices` queries with `{db:String}`/`{tbl:String}` parameters, `kindForEngine`, `toColumnMeta` (nullability from the type string; `isPrimaryKey` **always false**, D18/D23), `splitTopLevelCommas` (depth-tracking, not a plain split), and `listCheckConstraints` — a small parser over the `CREATE TABLE` text, because `system.constraints` does not exist on the server this adapter is tested against. That parser is the one thing in this package that clears `AGENTS.md`'s unit-test bar on its own (§5.5) |
| `definition.go` | `definition.ts` | `create_table_query` verbatim, `buildTableSection`'s five/six rows, the two `notes` strings verbatim |
| `console.go` | `console.ts` | `isRowReturning`'s comment-stripping regex plus the seven-keyword test, verbatim — the HTTP interface gives no cheap "will this return rows" signal, and appending `FORMAT` to an `INSERT` would be a different statement |
| `mutate.go` | `mutate.ts` | `assertInsertOnly` with its message verbatim, `literalFor`'s backslash escaping, `renderInsert`'s union-of-columns single statement (B13), and `affectedRows = writtenRows > 0 ? writtenRows : len(inserts)`. `writtenRows` comes from the `X-ClickHouse-Summary` response header's JSON, which is where `@clickhouse/client`'s `result.summary.written_rows` came from |
| `errors.go` | `errors.ts` | B12's three-place extraction, then `errors.ts`'s fifteen-code dispatch verbatim, then the network-level fallbacks (`ECONNREFUSED`/`ENOTFOUND`/`EHOSTUNREACH` → `E_CONNECT`, timeouts → `E_TIMEOUT`) re-derived against Go's own error types |
| `caps.go` | `caps.ts` | The literal, unchanged (B18) |
| `adapter.go` | `index.ts` | The `Adapter` implementation, `requireRelationPath`'s three-kind set, `opRuntime`'s per-call `nextQueryId` closure (`kira-<opId>-<n>` — an instance-level map would be a leak; a closure per top-level call is not), `trackerFor`'s identity-checked release, and `Cancel`'s `KILL QUERY WHERE query_id = {qid:String} SYNC` which **never carries `readonly`** (D7/D8) |

**The response reader, and the mid-stream exception (B12).** The reader is a `bufio.Scanner` over
newline-delimited JSON arrays with the buffer raised well past the default 64 KiB (a single cell can
be `MaxCellBytes` = 64 KiB, and a row is many cells). Three terminal conditions, and the third is the
one `@clickhouse/client` hid:

1. A non-2xx status → read the body, extract per B12, `mapError`.
2. Clean end of body → done.
3. **A line that is not a JSON array.** ClickHouse appends an `__exception__` trailer to a 200-OK
   body when a query fails after streaming began. The rule: any line that fails to parse as a JSON
   array is treated as the start of an exception trailer, the remainder of the body is read, and
   `mapError` runs over it — never silently ignored, and never treated as a row. CH-1 measures the
   exact bytes (`clickhouse-go`'s own `conn_http_errors.go:60-71` documents two layouts across
   server versions, which is why this is measured rather than pattern-matched from memory).

### 4.4 Cancellation, three mechanisms, one helper

The per-adapter table P58 §4.7 requires each sub-phase plan to produce, for the three things most
easily lost.

| | mariadb / mysql | sqlite | clickhouse |
|---|---|---|---|
| **Cancel mechanism** | `KILL QUERY <threadId>` on a short-lived side connection; the thread id from `SELECT CONNECTION_ID()` on the pinned conn | `sqlite3_interrupt`, reached by cancelling the adapter-owned per-op driver context, on the op's own dedicated `*sql.Conn` (B8) | `KILL QUERY WHERE query_id = {qid:String} SYNC` on a second HTTP request; the query id is `kira-<opId>-<n>` |
| **Driver ctx** | never the op's — `RunWithAbortRace(context.WithoutCancel)`; a cancelled ctx closes the socket (B6) | never the op's — a context the adapter cancels itself (B8) | never the op's — `RunWithAbortRace(context.WithoutCancel)`; otherwise `release()` beats `Cancel` to the query id (§1.7) |
| **`caps.cancel`** | `true`, unchanged | `false` → **`true`** (B8, P58 D8) | `true`, unchanged |
| **Pagination** | keyset on PK → all-NOT-NULL unique index, else offset. Token = `sqltext.EncodePageToken`'s `{v,k,f}` payload, unpadded base64url | the same, plus the implicit `rowid` as a third tiebreaker, via `ResolveFetchColumns`'s `resolveHidden` hook | **offset only.** `after`/`before` refused with `E_UNSUPPORTED` and a named message; `nextToken`/`prevToken` always nil |
| **Error mapping** | `*mysql.MySQLError.Number` (1045, 1317), plus re-derived Go network errors. 45044/45063 deleted (B22) | the driver's primary code, `code & 0xff` (14/26/5/6/8) | `X-ClickHouse-Exception-Code` → body `Code: N.` → `__exception__` trailer (B12), then the fifteen-code table |

### 4.5 `testsupport`: three new fixtures, one rule made structural

B15. The rule that P58a paid for and that this plan must not let three more fixtures re-learn:

> **A fixture's teardown is never `t.Cleanup`.** Go's `testing` package runs a `Cleanup` the instant
> the *registering* test function returns — which for the first test to call `StartX` is long before
> the rest of the package's tests run. Teardown is an exported `StopX()`, called once from the
> package's own `TestMain` after `m.Run()` returns. This is the Go analogue of `bun:test`'s
> `beforeAll`/`afterAll`, and it is why P58a's first `StartPostgres` took 50 s for 24 tests instead
> of 8 s.

`fixture.go` makes that shape the only convenient one:

```go
// fixture memoizes one expensive resource per test binary. Start is called at most once; Stop is
// called from TestMain, never from a test. See the package doc for why t.Cleanup is wrong here.
type fixture[T any] struct {
        mu   sync.Mutex
        val  *T
        err  error
}
func (f *fixture[T]) get(t *testing.T, start func() (*T, error)) *T
func (f *fixture[T]) stop(terminate func(*T))
```

`StartPostgres`/`StopPostgres` are refactored onto it in the same commit, so the tree carries one
example rather than two shapes.

The four fixtures, each seeding from the existing `.sql` file unchanged (P58 D12):

| Fixture | Container | Seed | The step most easily forgotten |
|---|---|---|---|
| `mariadb.go` | `mariadb:11.4`, `--performance-schema=ON` (B23) | `0002_mariadb_seed.sql` as root | `big_rows` via the SEQUENCE engine's `seq_1_to_1000000` pseudo-table, then `ANALYZE TABLE`; the `kira_analytics` database and its `GRANT SELECT`; the returned config connects as the **unprivileged `kira` user**, not root |
| `mysql.go` | `mysql:8.4` | `0008_mysql_seed.sql` as root | `big_rows` via the six-way `digits` cross join, then `ANALYZE TABLE`, then `DROP TABLE digits`; the returned config carries `sslmode: require` because a stock MySQL 8 auto-generates a certificate and `caching_sha2_password` over plaintext is what test 2b is about (B22) |
| `sqlite.go` | none — `t.TempDir`-style directory (B10) | `0009_sqlite_seed.sql` | `big_rows` via `WITH RECURSIVE`, then `ANALYZE big_rows` **only** — every other table must be left without a `sqlite_stat1` row, which is what scenario 6 asserts a null estimate against |
| `clickhouse.go` | `clickhouse/clickhouse-server:26.3` — **no ulimit workaround** (§1.12) | `0010_clickhouse_seed.sql`, statement by statement over HTTP as `kira_admin` | the three users: `kira_admin` (ACCESS MANAGEMENT), `kira` (SELECT/INSERT/ALTER DELETE on `kira_test`, SELECT on `system` and `default`), `kira_ro` (SELECT only) — scenario 43's server-side read-only assertion and scenario 7's cancel assertion are both meaningless without them |

All four keep the `IsDockerAvailable` gate except `sqlite.go`, which needs nothing. All four pull
their images through `mirror.gcr.io` **in the daemon**, per `AGENTS.md`'s Docker section — no Go code
references the mirror.

### 4.6 The router flip, and what else it touches

`nativeKinds` is the whole mechanism (P58 §4.6) and P58a built the seam. What a flip actually
changes, enumerated so the implementer can check each one rather than trust that "the router handles
it":

- **Control plane** — `connections.{Test,Connect,Disconnect,Remove}` and `tree.{Children,Describe,
  Definition}` start reaching `adapterhost.Host` for that kind. Nothing to write; §1.8's five test
  files are the only fallout.
- **Data plane** — `HandleDataFrame` starts answering `data:read`/`count`/`preview`/`mutate`/
  `execute`/`invalidate` in-process for that kind, which means **that kind's pages start arriving
  base64-encoded** and the renderer's `toTypedArray` first branch handles them (§1.3). No change.
- **Cancel** — routes on op ownership, not kind (P58a A13), so a flip changes nothing here.
- **`connections.MarkAllErrored`** — P58a A15 narrowed it to Node-served kinds. After M6.4 five of
  eleven kinds are excluded from it; C1b step 12 is the check that this is still right.
- **`cache:stats`** — P58a A16's merge keeps summing the two caches' counters and reporting the
  configured budget once. As more kinds go native the Go side's share grows and the child's shrinks;
  nothing about the merge changes.
- **`shell/main.go`** — one blank import per new adapter package, so its `init()` runs and
  `adapters.CreateAdapter` can find it. **This is the single most likely thing to be forgotten**,
  because omitting it produces no compile error: `CreateAdapter` returns
  `E_UNSUPPORTED "<kind> connections are not supported yet"` at connect time, in the real app only,
  and never in `go test ./internal/adapters/<engine>` (which constructs the adapter directly). §8
  makes it a per-milestone acceptance check.

## 5. Testing plan

### 5.1 What survives untouched

- **`tests/ui/`** entirely — 36 tests, 18 spec files. P58a A10 holds unchanged: the mocked tier still
  speaks the index-keyed chunk encoding, which `toTypedArray`'s second branch still decodes.
- **`tests/ipc/`** entirely — all three halves of all seven adapters. The backend half still imports
  `src/engine/control.ts`, which still exists and still works, and §1.10 records the cost of that
  being true.
- **`tests/unit/`** entirely. Nothing in P58b has a TypeScript unit-test subject that moves.
- **`package.json`.** `test:db` runs `bun test tests/db --path-ignore-patterns '**/kafka.spec.ts'`
  over a whole directory, so deleting four spec files needs no script edit. (Worth recording because
  P58a's own §3 predicted a `package.json` edit for the same reason and did not need one either.)
- **`tests/e2e-real/sqlite-real.spec.ts`** as a *file*, though its meaning changes completely: from
  M6.3 it drives a Go-native SQLite adapter instead of the Node child's, through the same real app.
  §1.12 records that it now actually runs in this sandbox. It is the cheapest real-app proof in the
  repo and §7 uses it.

### 5.2 The `src/` non-change, asserted in its strong form

Every milestone from M6.1 onward ends with:

```
git diff --stat src/
```

returning **empty** — no exclusion, unlike P58a's own form, because P58b has no `src/` change at all
(B21). If it is ever non-empty the implementer stops and says so rather than absorbing it.

### 5.3 The MySQL/MariaDB Go tier

`shell/internal/adapters/mysqlfamily/`, driven by `testcontainers-go` against `mariadb:11.4` and
`mysql:8.4`, seeded from `0002_mariadb_seed.sql` and `0008_mysql_seed.sql` unchanged.

**Shape.** The two TypeScript specs are ~90 % the same file. In Go that becomes one shared
suite function plus two thin drivers, in one package so one `TestMain` can stop both containers:

```go
// mysqlfamily_test.go
func runFamilySuite(t *testing.T, fx *testsupport.SQLFixture, profile Profile) { /* the 27 shared scenarios */ }

// mariadb_test.go
func TestMariaDB(t *testing.T) { runFamilySuite(t, testsupport.StartMariaDB(t), mariadb.Profile) }
// plus MariaDB's own: the SEQUENCE-engine tree node, scenario 33's connect-attributes probe

// mysql_test.go
func TestMySQL(t *testing.T) { runFamilySuite(t, testsupport.StartMySQL(t), mysql.Profile) }
// plus MySQL's own five: 2b (rewritten per B22), 2c (TLS, re-baselined per B24), 34, 35, 36

// main_test.go
func TestMain(m *testing.M) { code := m.Run(); testsupport.StopMariaDB(); testsupport.StopMySQL(); os.Exit(code) }
```

Containers start lazily on first use, so a Docker-less run skips both and stops neither.

**Scope.** §1.11's table: 27 shared scenarios port as-is, 3–4 are re-baselined against the Go
driver's own wording, 2 collapse (caps, already-cancelled), and B4's new case is added.

**The scenario that must not be softened:** *cancel, asserted server-side.* A `SELECT SLEEP(30)` is
started through `RunOp`; the test polls `SHOW PROCESSLIST` (through a **separate** root connection,
never the adapter's) until the sleeping query appears; `CancelOp` is called; the op rejects with
`E_CANCELLED`; and the test polls `SHOW PROCESSLIST` again until the query is **gone**, with a
2-second deadline. The second poll is the assertion — the first only proves the query started.
This is also the test B6 exists for, and it is the one most likely to pass for the wrong reason if
the op's own context reaches the driver (the connection would be closed, the query would die with
it, and `KILL QUERY` would never be proven to work at all). Assert additionally that
`Cancel` returned **`true`**.

### 5.4 The SQLite Go tier

`shell/internal/adapters/sqlite/`, temp-directory fixture, **no Docker**, seeded from
`0009_sqlite_seed.sql` unchanged. 36 of 43 scenarios port as-is — the highest ratio of the four,
because SQLite's spec is almost entirely about the adapter's own logic rather than about a driver.

Four cases are new or changed, and three of them are the reason B7 and B8 exist:

| Test | Why it is here |
|---|---|
| **the value codec follows the value, not the declared type** (spec 35, ported) | B7's whole argument. It must run against the same `dyn_probe` table the TypeScript builds: a `BLOB` in a `TEXT` column comes back `0x…`, the text `'not a number'` in an `INTEGER` column comes back verbatim |
| **a `BOOLEAN` column renders `0`/`1` and a `DATETIME` column renders its stored text** (new) | The specific `mattn/go-sqlite3` coercions §1.5 found. Not covered by spec 35, which uses `TEXT`/`INTEGER` columns. A driver swap that reintroduced the coercion would pass spec 35 and fail this |
| **cancel actually interrupts** (replaces spec 7) | B8. A long-running statement (`WITH RECURSIVE` counting to a very large number, or a `SELECT` over `big_rows` with a deliberately expensive predicate) is started through `RunOp`; `CancelOp` is called; the op rejects with `E_CANCELLED` within a bounded time; `Cancel` returns `true`; and `caps.Cancel` is `true` |
| **a cancel followed immediately by an unrelated query on the same adapter succeeds** (new) | **P58 §5.3 mandates this by name**, for `sqlite3_interrupt`'s connection-wide scope. It is the exact regression `mattn/go-sqlite3` #488/#745/#681 describe, and B8's per-op dedicated `*sql.Conn` is what should make it pass. Keep it even though the chosen driver's own design already guards it — the test outlives the driver choice |

Two ported scenarios need their mechanism re-derived rather than their assertion changed: 32 (*"a
failed connect leaves nothing open, and no `-wal`/`-shm` sidecar"* — the Go DSN must not enable WAL,
and the check is a directory listing) and 36 (*"the file is not modified by a read session"* — an
`os.Stat` mtime/size comparison, and it is the strongest possible statement of the read-only
promise).

### 5.5 The ClickHouse Go tier

`shell/internal/adapters/clickhouse/`, `clickhouse/clickhouse-server:26.3`, seeded from
`0010_clickhouse_seed.sql` unchanged, three users created after the seed (§4.5). 40 of 47 scenarios
port as-is. The four re-baselined ones are all error-envelope assertions and are exactly what B12's
extraction must satisfy.

Three scenarios carry more weight here than anywhere else and should be written first, because they
are what B11 is being judged on:

- **35 (wide types)** — `Array`/`Tuple`/`Map` classify `json`, `Enum8`/`UUID`/`IPv4`/`IPv6`/
  `FixedString`/`LowCardinality` classify `text`, `Decimal128` `number`, `DateTime64` `temporal`,
  and `LowCardinality(Nullable(String))` reports `nullable: true` while `LowCardinality(String)`
  reports false. Plus two exact cell values: `'green'` and
  `'61f0c404-5cb3-11e7-907b-a6006ad3dba0'`.
- **36 (big integers keep every digit)** — the exact strings
  `'123456789012345678.1234567890123456789'` and `'18446744073709551615'`, on both the read path and
  the console path. If the reader is passing the server's own text through, these are free; if
  anything in the pipeline round-trips through a Go numeric type, they fail.
- **37 (NULL is not the string "null", and NaN is not NULL)** — the `ᴺᵁᴸᴸ` sentinel decoded to a real
  NULL in the chunk's null bitset, the four-character string `'null'` **not** null, and the
  three-character string `'nan'` not null. This is the single most direct test of the format choice
  B11 rests on.

**Unit-level, against `AGENTS.md`'s bar.** Exactly one thing in P58b clears it without argument:
`clickhouse/catalog.go`'s `listCheckConstraints` + `splitTopLevelCommas` — a small parenthesis-aware
parser over `CREATE TABLE` text with several interacting lexical rules (backtick-quoted names with
doubled backticks, nested parentheses, `ASSUME` deliberately excluded). It gets a table-driven Go
unit test with the cases the TypeScript regex's behaviour implies, written before the port.
Everything else in this sub-phase is covered by §5.3–§5.5 against a real container, which is where
it belongs. In particular: no unit test for `unwrapType`, `typeClassFor`, `quoteIdent` or
`toCellText` — each is a short function whose behaviour the acceptance suite already pins on real
values, and `AGENTS.md`'s rule is explicit that *"a branch is not complexity."*

### 5.6 `tests/e2e-real/` gains exactly one spec, and it is C1b's vehicle

P58 §5.5 is right that this tier is deliberately small and that adding one spec per newly-native
engine is *"tempting and mostly wrong"* — its job is wiring, not adapter coverage. P58b adds one
file anyway, for a reason that is not adapter coverage: **there is no other way to run C1b.**

`tests/e2e-real/mariadb-real.spec.ts`, two tests:

1. **MariaDB, native, end to end** — the same shape as `postgres-real.spec.ts`: create the
   connection through the real dialog, connect, expand the tree, open a table, see real cell text
   through the base64 chunk path, page forward and back and assert
   `[data-testid="pager"]`'s `data-pagination="keyset"`. This is the step that caught P58a's
   `toTypedArray` bug and it is the cheapest possible insurance against its analogue.
2. **Coexistence** — the same app instance additionally connects a **MongoDB** connection, still
   served by the Node child, expands its tree and reads a page. Then the Node child is killed and
   the MariaDB connection is asserted still connected and still able to serve a read, while the
   MongoDB connection flips to `error` (P58a A15). **This is C1b**, and it is the proof P58 D4's
   whole coexistence property has never actually had.

SQLite needs no new spec: `sqlite-real.spec.ts` already exists, already covers connect/tree/rows
through the real app, and from M6.3 does it against the Go adapter. ClickHouse gets none — its
wiring is identical to MariaDB's and P58 §5.5's restraint applies.

### 5.7 What P58b deliberately does not test

- **The `tests/ipc/` fixtures against the Go producer.** §1.10 — that is P58 D13's job and P58f's
  milestone, and doing three of seven early would leave two generators in the tree.
- **Packaging.** No bundle change in P58b; `verify-packaging.sh` is untouched and still correct.
- **The base64 wire encoding through `tests/ui/`.** P58a A10, unchanged.
- **MySQL and MariaDB against each other's server.** P34 D6 makes pointing one at the other a
  warning rather than a failure, and the warning is asserted in the MySQL suite; a cross-product of
  two profiles against two servers would double the container time to re-prove one `if`.

## 6. M6.0 — the probes, concretely

Four throwaway Go programs under the scratch directory (**never committed; no product code lands in
M6.0**), each answering one question with a printed PASS/FAIL. The deliverable is a findings
subsection appended to this document (§9 commit 1) and, for anything surprising, an `AGENTS.md`
entry. Ordering: TC-2 first (everything else needs containers), then MY-1, CH-1, SQ-1 — SQ-1 last
only because it needs no Docker and can run while an image pulls.

| Probe | What it runs | Asserts | If it fails |
|---|---|---|---|
| **TC-2** | `testcontainers-go` + `modules/{mariadb,mysql,clickhouse}@v0.44.0` starting `mariadb:11.4`, `mysql:8.4` and `clickhouse/clickhouse-server:26.3` (all mirror-retagged), running one trivial query against each, terminating | All three start in this sandbox; specifically that **the ClickHouse module needs no ulimit workaround** (§1.12's source read, confirmed against a running daemon) and that the two `wait.ForLog` strategies resolve rather than matching the entrypoint's init boot | The Go fixture for that engine needs its own explicit wait strategy (the shape `testsupport/postgres.go` already uses for Postgres's double-boot), or — for ClickHouse — a `WithHostConfigModifier` clearing ulimits, the Go analogue of `NoUlimitClickHouseContainer` |
| **MY-1** | Against both containers: connect with `interpolateParams=true&parseTime=false`; run a parameterised `SELECT` over `wide_table` and over a `VARBINARY`/`BLOB`/`JSON`/`DATETIME`/`DECIMAL` set, scanning every column as `sql.RawBytes`; print each column's `DatabaseTypeName()` and its exact bytes; run `SELECT CONNECTION_ID()`; start `SELECT SLEEP(30)` on one connection and `KILL QUERY <id>` it from a second; separately, cancel a query's *context* and observe what happens to the connection | (a) the text protocol really is used with args present (no `Prepare` round trip on the wire — assert by observing that `DatabaseTypeName` still distinguishes `BLOB` from `TEXT`, and that a `DECIMAL` arrives as its exact server text rather than a float); (b) `KILL QUERY` from a side connection produces errno 1317 on the killed query; (c) **a cancelled context closes the connection** rather than killing the query server-side — §1.4 fact 4, confirmed; (d) a non-row-returning statement over `QueryContext` yields zero columns (§4.1's `console.go` row) | (a) failing means B2 is wrong and the read path needs a different mechanism — stop and raise it; (c) failing in the *other* direction (the driver sends `KILL QUERY` itself) would make B6 unnecessary, which is a welcome result to record but not to assume |
| **SQ-1** | No container. Create a temp database with a `BOOLEAN`, a `DATETIME` holding `'not a date'`, a `TEXT` column holding a BLOB and an `INTEGER` column holding text. Read it with **both** `mattn/go-sqlite3` and `modernc.org/sqlite`, printing each value's Go type and rendered text. Then, on modernc: open with `_busy_timeout`/`_foreign_keys`/`_txlock=immediate`/`_query_only`; confirm `mode=rw` refuses to create a missing file; run a long statement and cancel its context, then immediately run an unrelated query on the same `*sql.Conn`; prepare a two-statement string and observe what the driver does with the tail; print the error type and code for a `SQLITE_BUSY` and a `SQLITE_NOTADB` | §1.5's source read, confirmed against real values: mattn coerces on decltype (and returns the zero time for `'not a date'`), modernc does not. Plus the five things B9/B10/§4.2 need: the DSN options apply, no file is created, the interrupt lands and the next statement succeeds, the multi-statement tail behaviour, and the error shape `mapError` will dispatch on | If modernc *also* coerces, or if the interrupt does not land, P58 D8's original `mattn` choice stands and B7/B8 are withdrawn — in which case the SQLite port must either accept the coercion (recording it as a loss on §7's list) or keep `caps.cancel: false`. Either way the answer is written down before M6.3 starts |
| **CH-1** | Against the ClickHouse container: a raw `net/http` POST with the statement in the body and `default_format=JSONCompactStringsEachRowWithNamesAndTypes`, `param_db=…`, `query_id=…`, `readonly=2`; read the response line by line and print the names row, the types row, and the exact cell text for `wide_types`' `dec`, `big_uint`, `nullable_val`, `float_val`, `en`, `uid`, `arr`, `mp` columns; then `KILL QUERY WHERE query_id = … SYNC` from a second request while a slow `SELECT` runs; then deliberately fail a `SELECT` **after** rows have streamed (e.g. `SELECT throwIf(number = 5000) FROM numbers(10000)`) and print the raw tail bytes; then read `X-ClickHouse-Summary` off an `INSERT` | (a) the format and the `ᴺᵁᴸᴸ` sentinel behave exactly as `query.ts` documents, and the exact strings §5.5 lists arrive verbatim; (b) `KILL QUERY … SYNC` works from a second HTTP request and the first query errors with code 394; (c) **the mid-stream `__exception__` trailer's exact layout** on this server version (B12's third extraction site); (d) `written_rows` is readable from the summary header | (a) failing means B11 is wrong and the ClickHouse port must fall back to `clickhouse-go` plus a Go-side text renderer — a materially larger job that must be re-planned, not absorbed. (c) failing to reproduce means the trailer handling is written defensively from `clickhouse-go`'s own two documented layouts and marked as unverified against this server |

## 7. C1b — the checklist

P58's §0.3 defines C1 (after M5) and C2 (before M10) and assigns **no checkpoint to M6**. This plan
adds one, and it is not invented for symmetry: it is the half of C1 that P58a could not run. P58a
§13, verbatim:

> *"Steps 17-21 (MariaDB coexistence in the same session; interleaved op-log across both hosts;
> summed cache-stats budget; killing the Node child and confirming only the MariaDB connection
> errors): **not run this session** — MariaDB has no Go adapter yet (P58b) … Worth doing for real
> once P58b's MariaDB adapter exists and both connections can be genuinely native/non-native side by
> side in one running app."*

That is now possible, with the roles swapped: MariaDB is the **native** side and MongoDB (P58c's,
still Node-served) is the other.

**This sandbox has no real X display**, which P58a's §13 established and which nothing since has
changed. So C1b is written for the `tests/e2e-real/` substitute P58a actually used — a real
`-tags server` Go binary, real bindings, real containers, real UI code paths, reached over
`http://127.0.0.1` from a headless browser tab — and **not** for `xdotool`/`import -window`
screenshot steps that cannot run here. Every step below is either a `tests/e2e-real/` assertion or a
shell observation made in the same Bash invocation as the app run (`AGENTS.md`, P51: a background
process started in one invocation cannot be signalled from a later one; budget 150 s).

**Preparation** (one Bash invocation)

1. `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`; wait for `API listen on /var/run/docker.sock`.
2. Pull and retag `mariadb:11.4` and `mongo:8` via `mirror.gcr.io/library/…`.
3. `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`;
   `go install …/wails3@v3.0.0-beta.15` (**pinned**); `scripts/vendor-node.sh` and
   `bun run build:engine` — **the Node child is still required**, it serves six of eleven kinds;
   `wails3 generate bindings -b -i -ts -names`; `bun run build`.
4. `bunx playwright test --project=e2e-real` (or the single spec), which builds
   `go build -tags server` itself through `tests/e2e-real/fixtures.ts`.

**The native half — MariaDB, in Go**

5. The app boots and `[data-testid="status-bar"]` is present. (P58a's own recorded substitute for
   "the app rendered rather than showing a blank page".)
6. A MariaDB connection is created through the real dialog, tested and connected; the status dot
   reads `connected` and its tooltip starts `MariaDB 11.`.
7. The tree expands: connection → `kira_test` → the relations, with `~N rows` details on tables and
   the SEQUENCE-engine node present (the one tree shape MySQL can never produce).
8. `kira_test.order_items` opens as a data tab and renders **real cell text** — the base64 chunk path
   end to end, and the step that caught P58a's `toTypedArray` bug.
9. The pager goes forward and back over `big_rows`; the rows differ, the back page matches the
   first, and `[data-testid="pager"]` carries `data-pagination="keyset"` — so a silent fall back to
   offset paging fails this step rather than producing correct-looking rows.
10. `[data-testid="engine-status"]` is `ok` throughout (P58a A17: `ping` is still answered by the
    child, so this is also a check that the child is alive).

**The coexistence half — MongoDB, still on Node**

11. In the **same session**, a MongoDB connection is created and connected; its tree expands and a
    collection opens and renders a page. All of this is served by the Node child, and its pages
    arrive in the **index-keyed** encoding — so this step is simultaneously the proof that
    `toTypedArray`'s second branch is still needed and still works.
12. The Node child is killed (`kill <pid>`, its pid read from `ps --forest` in the same invocation).
    The **MongoDB** connection flips to `error`; the **MariaDB** connection stays `connected` and
    still serves a read (P58a A15). If MariaDB also flips, `MarkAllErrored` was not narrowed — or was
    narrowed against a stale `nativeKinds` snapshot.

**Recording.** C1b is recorded in the M6.4 commit message and in `AGENTS.md`'s P58b findings entry,
naming which of steps 5–12 passed and which could not be run, per P55 §10 / P56 §6 / P57 §6 / P58a
§13's standard of recording *"not available in this session"* rather than leaving it implied. Steps
11–12 are the load-bearing ones: they are the only evidence in the entire phase that P58 D4's
coexistence property holds in a running app rather than in a router unit test.

## 8. Acceptance criteria

**Per milestone**

- **M6.0** — all four probes have a recorded PASS, or a recorded FAIL with its consequence taken
  explicitly (§6). **No product code committed.** B7 and B11 are either confirmed or withdrawn in
  writing before M6.3/M6.4 start.
- **M6.1** — `go test ./... -race` in `shell/` is green with **`nativeKinds` unchanged**;
  `internal/adapters/abort.go` exists and `postgres/query.go` has no local copy;
  `grep -rn '"mariadb"' shell/internal --include=*_test.go` returns nothing;
  `testsupport.StartPostgres` still starts exactly one container per test binary (timing check:
  `go test ./internal/adapters/postgres -v` is not slower than before); `git diff --stat src/` empty.
- **M6.2** — `go test ./internal/adapters/mysqlfamily/` green against both real containers, or
  explicitly recorded as Docker-unavailable; `nativeKinds` contains `mariadb` and `mysql`;
  `shell/main.go` has both blank imports (§4.6's most-forgotten step);
  `tests/db/{mariadb,mysql}.spec.ts` deleted in the milestone's last commit; the whole existing suite
  (`bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run test:go`, `bun run test:ui`,
  `bun run test:ipc:fe`) green; `git diff --stat src/` empty.
- **M6.3** — `go test ./internal/adapters/sqlite/` green **without Docker**; `nativeKinds` contains
  `sqlite`; `sqliteCaps.Cancel` is `true` **and** `docs/ARCHITECTURE.md`'s *"permanently `false`"*
  sentence is rewritten in the same commit (P58 D8); §5.4's four cases all present;
  `tests/db/sqlite.spec.ts` deleted last; `tests/e2e-real/sqlite-real.spec.ts` passes against the Go
  adapter; `git diff --stat src/` empty.
- **M6.4** — `go test ./internal/adapters/clickhouse/` green against a real container;
  `nativeKinds` contains `clickhouse`, reaching five of eleven; §5.5's three format-critical
  scenarios (35, 36, 37) all pass with their exact expected strings; **C1b recorded** (§7);
  `tests/db/clickhouse.spec.ts` and `tests/db/support/clickhouse.ts` deleted last, after §9 c24's
  re-grep; `git diff --stat src/` empty.

**Phase-level**

1. C1b's checklist is recorded with a per-step result, including "not run in this session" where
   that is the honest answer (§7).
2. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`,
   `bun run test:ui`, `bun run test:ipc:fe` are green.
3. `cd shell && go test ./... -race` is green.
4. **`git diff --stat src/` is empty.** Not "empty except one file" — empty (B21).
5. **`git diff --stat tests/ui tests/ipc` is empty**, including every `*.fixture.ts` (§1.10).
6. `git diff --stat shell/internal/page shell/internal/enginecache shell/internal/enginebackend`
   is empty (§1.3 — the substrate needed nothing).
7. The whole `git diff --stat` scope, enumerated in advance so a surprise is visible:
   - **`shell/internal/adapters/`** — five new directories (`mysqlfamily/`, `mariadb/`, `mysql/`,
     `sqlite/`, `clickhouse/`) holding three adapters and two profiles, one new file (`abort.go`),
     one edited (`postgres/query.go`), and `testsupport/` grown by five files.
   - **`shell/internal/adapterhost/`** — `router.go` (`nativeKinds` + `TestKindNodeServed`) and three
     `_test.go` files.
   - **`shell/internal/{connections,tree}/`** — one `_test.go` each.
   - **`shell/main.go`** — four blank imports. **`shell/go.mod`/`go.sum`** — two runtime modules,
     three test-only.
   - **`tests/db/`** — four spec deletions, one support deletion. **`tests/e2e-real/`** — two new
     files.
   - **`docs/`, `AGENTS.md`** — per §3.
   - **`src/`, `tests/ui/`, `tests/ipc/`, `package.json`, `scripts/`, `.github/`** — nothing.
8. `AGENTS.md` gains a **"P58b implementation findings"** entry on the P52–P58a pattern, carrying at
   minimum: M6.0's four probe results; whether B7 and B11 survived their probes; the
   `testcontainers-go` ClickHouse module's ulimit finding (§1.12 — and the corresponding paragraph of
   the existing Docker/ClickHouse sections marked historical **for the Go tier**, not deleted, since
   `tests/ipc/clickhouse/` still needs it); the Bun 1.4 `node:sqlite` correction (§1.12); the
   MySQL `allowPublicKeyRetrieval` loss (B22); the console `tinyint(1)` loss (B4); and whatever the
   flip of four kinds turned up that this plan did not predict.
9. `docs/ARCHITECTURE.md` is updated: the per-database mapping table's SQLite **Cancel mechanism**
   cell (no longer "none"), the **SQLite** per-engine section (no `node:sqlite`, no Bun floor,
   `caps.cancel` now true and why), the **ClickHouse** per-engine section (no
   `@clickhouse/client`, the HTTP interface spoken directly, the format and the sentinel), the
   **PostgreSQL / MariaDB / MySQL** section (extended the way P58a extended it for Postgres: which
   kinds are Go-native, the driver, and the `allowPublicKeyRetrieval` change), and the **Stack**
   table's driver line.
10. This document gains its own **M6.0 results** and **M6.1–M6.4 results** sections, the way
    P58a's §12 and §13 record what actually happened — including any decision that turned out wrong.

## 9. Sequencing

Five milestones, in order, with the commits inside each. The parent's hard rules apply unchanged: its
**R2** (the substrate lands before any adapter) is why M6.1 is a milestone rather than four scattered
edits; its **R3** (an adapter's Go tests land and fail before its implementation) is encoded in
M6.2–M6.4's commit lists; its **R4** (probes before the work they inform) is why M6.0 is first.

**M6.0 — probes** *(no commits to `shell/`)*
1. `docs: record P58b M6.0 probe results` — this document gains a findings subsection, and B7/B11 are
   confirmed or withdrawn in writing.

**M6.1 — the shared lifts** *(`nativeKinds` unchanged throughout)*
2. `refactor(adapters): hoist runWithAbortRace into the adapters package` — `abort.go`,
   `postgres/query.go` re-pointed (B14). Existing tests unchanged and green.
3. `refactor(testsupport): one memoized-fixture shape, torn down from TestMain` — `fixture.go`,
   `postgres.go` refactored onto it, `spec.go` lifted out of `postgres_test.go` (B15).
4. `test: name the Node-served placeholder kind once` — `adapterhost.TestKindNodeServed` and the five
   call sites (B16).

**M6.2 — MySQL and MariaDB**
5. `test(mysqlfamily): container fixtures for mariadb and mysql` — `testsupport/{mariadb,mysql}.go`,
   with a trivial connectivity test proving both seed correctly.
6. `test(mysqlfamily): the Go acceptance suite, against two real containers` —
   `mysqlfamily_test.go`, `mariadb_test.go`, `mysql_test.go`, `main_test.go`, **failing**
   (P58 D12 / R3).
7. `feat(mysqlfamily): client, query and error mapping` — `client.go`, `query.go`, `errors.go`,
   `profile.go`, and the two profile packages' `caps.go`.
8. `feat(mysqlfamily): the catalog and the tree` — `catalog.go`, and `adapter.go`'s
   connect/disconnect/children/describe.
9. `feat(mysqlfamily): read, count and the definition view` — `read.go`, `definition.go`.
10. `feat(mysqlfamily): mutations and the query console` — `mutate.go`, `console.go`.
11. `feat(adapterhost): serve mariadb and mysql in-process` — `nativeKinds` += both,
    `shell/main.go` += two blank imports. The commit message records the acceptance run.
12. `test: delete tests/db/{mariadb,mysql}.spec.ts, their subject now in Go` (B17). The two support
    modules stay (§1.9).

**M6.3 — SQLite**
13. `test(sqlite): a temp-file fixture, no Docker` — `testsupport/sqlite.go`.
14. `test(sqlite): the Go acceptance suite` — `sqlite_test.go`, `main_test.go`, **failing**,
    including §5.4's four new/changed cases.
15. `feat(sqlite): client, query and error mapping` — `client.go`, `query.go`, `errors.go`,
    `caps.go` **with `Cancel: true`**, and `docs/ARCHITECTURE.md`'s two SQLite sentences rewritten in
    this same commit (P58 D8, B18).
16. `feat(sqlite): the catalog, the tree and the definition view` — `catalog.go`, `definition.go`,
    and `adapter.go`'s connect/disconnect/children/describe/definition.
17. `feat(sqlite): read, count and the value codec` — `read.go`. The codec is the reason B7 exists,
    so this commit is the one to review hardest.
18. `feat(sqlite): mutations, the query console and real cancellation` — `mutate.go`, `console.go`,
    `adapter.go`'s `Cancel` (B8).
19. `feat(adapterhost): serve sqlite in-process` — `nativeKinds` += `sqlite`, `main.go` += one blank
    import. `tests/e2e-real/sqlite-real.spec.ts` is run here and its result recorded.
20. `test: delete tests/db/sqlite.spec.ts, its subject now in Go` (B17). `support/sqlite.ts` stays —
    `tests/e2e-real/` and `tests/ipc/support/harness.spec.ts` both need it (§1.9).

**M6.4 — ClickHouse, and C1b**
21. `test(clickhouse): a container fixture with its three users` — `testsupport/clickhouse.go`.
22. `test(clickhouse): the Go acceptance suite, against a real container` — `clickhouse_test.go`,
    `main_test.go`, plus `listCheckConstraints`' unit test, **failing**.
23. `feat(clickhouse): the HTTP client, the response reader and error mapping` — `client.go`,
    `query.go`, `errors.go`, `caps.go` (B11, B12).
24. `feat(clickhouse): the catalog, the tree and the definition view` — `catalog.go`,
    `definition.go`, `adapter.go`'s tree half.
25. `feat(clickhouse): offset paging, count and the query console` — `read.go`, `console.go`.
26. `feat(clickhouse): inserts, and why update and delete are refused` — `mutate.go` (B13).
27. `feat(adapterhost): serve clickhouse in-process` — `nativeKinds` += `clickhouse`, `main.go` +=
    one blank import. Five of eleven.
28. `test(e2e-real): mariadb native alongside a Node-served mongo connection` —
    `tests/e2e-real/{mariadb-real.spec.ts,support/mariadb.ts}`. **C1b runs here**; the commit message
    records its result.
29. `test: delete tests/db/clickhouse.spec.ts and its now-unused support module` — **re-grep first**
    (B17, §1.9's snapshot caveat).
30. `docs: P58b findings — three dialects, two driver corrections and the coexistence proof` —
    `AGENTS.md`, `docs/ARCHITECTURE.md`, and this document's §12/§13.

**Why MySQL/MariaDB first and ClickHouse last.** MySQL/MariaDB is the adapter closest to Postgres —
same keyset planner, same side-connection cancel, same catalog shape — so it is the one most likely
to be a genuine translation rather than a redesign, and it is the one that unlocks C1b's coexistence
vehicle. ClickHouse is last because B11 is the largest single bet in this plan and it benefits from
every lesson the two milestones before it produce. SQLite sits in the middle because its
capability change and its driver correction are independent of the other two and because its suite
needs no Docker, so it can make progress on a day when the daemon will not start.

## 10. Open questions for the parent plan's author

Each of these contradicts something the parent settled, or affects P58c–P58f as much as P58b. None is
silently resolved; where P58b needs a working assumption to proceed it is stated as *interim* and
marked reversible, and each has an M6.0 probe attached so the answer is evidence rather than
argument.

**OQ-1 — P58 D8 chose `mattn/go-sqlite3`, and it cannot express the SQLite adapter's own documented
value codec.** §1.5, with the driver's source quoted: `mattn/go-sqlite3` v1.14.50's
`SQLiteRows.nextSyncLocked` coerces `SQLITE_INTEGER` and `SQLITE_TEXT` values on the *declared*
column type into `time.Time` and `bool`, returning the **zero time** when a re-parse fails, with no
DSN opt-out and no reachable escape hatch below `database/sql`. That is a direct contradiction of
`sqlite/read.ts`'s D3/D21 rule and of `sqlite.spec.ts` scenario 35, and it fires against twelve
columns of the existing fixture. D8's stated reason — *"already in `go.mod`, already linking the same
amalgamation the app-storage layer uses"* — is sound for `internal/storage`, which scans into typed
fields, and does not transfer to a data browser. **P58b interim: `modernc.org/sqlite` (B7)**, whose
equivalent behaviour is opt-in behind `_inttotime`/`_texttotime` and off by default, and whose
interrupt handling is the safer of the two. The costs (a second SQLite implementation in the binary,
a slower engine on write-heavy work) are accepted and named. The parent's author should decide
whether D8's first part is amended or whether the coercion is accepted as a documented loss; SQ-1
gives the evidence either way. **Note this is not a cgo question** — cgo is already mandatory here
and P58 §10 says so.

**OQ-2 — P58 D6's ClickHouse row chose `clickhouse-go/v2`, whose HTTP transport cannot be asked for
the format the adapter is built on.** §1.6, with the source quoted: `conn_http.go:201` pins
`default_format=Native` and `conn_http.go:683-686` explicitly discards a `default_format` override
from `WithSettings`. The adapter's whole value codec — and its `wide_types` scenarios' exact expected
strings — depend on `JSONCompactStringsEachRowWithNamesAndTypes` and on ClickHouse's own `ᴺᵁᴸᴸ`
sentinel. A `clickhouse-go` port would have to re-implement ClickHouse's text formatter in Go.
**P58b interim: a raw `net/http` client (B11)**, the same shape P58 D6 already chose for RabbitMQ and
which §1.8 found made RabbitMQ the simplest adapter rather than the hardest. The named cost is that
the exception envelope — including the mid-stream `__exception__` trailer on a 200-OK response —
becomes the adapter's own job (B12), and CH-1 measures it. The parent's author should decide whether
D6's ClickHouse row is amended; if it is not, M6.4 needs re-planning, not absorbing.

**OQ-3 — `tests/ipc/`'s mariadb/mysql/clickhouse fixtures describe a producer the app stops using at
M6.2/M6.4, and P58 D13's generator port is not until P58f.** §1.10. The anti-drift guarantee
`docs/ARCHITECTURE.md` states so carefully keeps holding, for a TypeScript adapter that no longer
serves a real connection — for three sub-phases. P58b's answer is to require the Go acceptance suite
to cover every shape those fixtures pin (§8 criterion 5 plus §5.3–§5.5), which is a weaker guarantee
than the one the tier was built for. The parent's author may prefer a different disposition: porting
the generator per adapter as each kind goes native (three generators in three languages'
worth of overlap), or accepting the gap explicitly and saying so in
`docs/ARCHITECTURE.md`'s Testing section for the duration. This plan takes the second, minus the
documentation change, because the documentation change spans all six sub-phases.

**OQ-4 — MySQL's `allowPublicKeyRetrieval` has no Go equivalent, and the security posture changes.**
§1.11 and B22. `go-sql-driver/mysql` requests the server's RSA public key over a plaintext connection
unconditionally; the option P34 D3/D5 introduced *because* that is an MITM window becomes a control
that controls nothing. P58b removes it and records the change as a loss in `docs/ARCHITECTURE.md`
and `AGENTS.md`, and rewrites `mysql.spec.ts` 2b to pin the new behaviour. P58 §7's *"what gets
worse"* list should gain this item — it is the first genuine *security-posture* regression the phase
has produced, as opposed to a behavioural or ergonomic one, and it deserves to be in the same list
as the loss of process isolation rather than only in a sub-phase plan.

**OQ-5 — P58 assigns no checkpoint to M6, and the one thing P58a's C1 could not prove is exactly
what M6 makes provable.** §7. This plan defines **C1b** and puts it at the end of M6.4. If the
parent's author would rather number it differently, or fold it into C2's pre-M10 pass, the *content*
is what matters: a native and a Node-served connection alive in one running app, with the child
killed and only the Node-served one erroring. Deferring it to C2 would mean P58 D4's coexistence
property goes unproven in a running app until the sub-phase that deletes coexistence.

## 11. Environment notes for the implementing session

- **A fresh container has none of the toolchain.** Go, plus
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for anything that builds
  `internal/shell` or the root `main` package. `./internal/adapters/...` needs none of it, so the
  fast loop for the whole of M6.1–M6.4 is `go test ./internal/adapters/<engine>` and never `./...`.
  Only C1b (§7) needs the headers.
- **cgo is already on and cannot be turned off** for the module as a whole (`mattn/go-sqlite3` in
  `internal/storage`, Wails' GTK bindings in `internal/shell`). B7's `modernc.org/sqlite` is pure Go
  but that is not why it is chosen, and `CGO_ENABLED=0` is not an option to reach for.
- **Install `wails3` pinned** to `shell/go.mod`'s exact version (`v3.0.0-beta.15`), never `@latest`
  (P55's finding).
- **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`) before `bun run build` resolves its imports. P58b
  changes no bound method signature, so one regeneration per fresh container is enough.
- **`shell/runtime/` is git-ignored too**, and P58b still needs both halves: `scripts/vendor-node.sh`
  for `runtime/node/bin/node` and `bun run build:engine` for `runtime/engine/engine.cjs`. The app
  refuses to start without the engine bundle (P56 D12), and after P58b the child still serves six of
  eleven kinds.
- **Docker**: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown` here; `colima start` on macOS. Pull
  every image through `mirror.gcr.io` and retag to the plain name (`library/` for unnamespaced
  official images, none for already-namespaced ones like `clickhouse/clickhouse-server`). The retag
  lives in the daemon, so `testcontainers-go` finds the plain name with no code change.
  P58b's four images: `mariadb:11.4`, `mysql:8.4`, `clickhouse/clickhouse-server:26.3` and — for
  C1b only — `mongo:8`.
- **The ClickHouse `ulimit` workaround is not needed in the Go tier** (§1.12, confirm with TC-2). It
  is still needed by `tests/ipc/clickhouse/container.ts`, which is TypeScript and stays.
- **This sandbox's Bun is 1.4.0 and has `node:sqlite`** (§1.12), so `bun test tests/db/sqlite.spec.ts`
  runs here and is a live oracle to diff the Go port against — genuinely useful for §5.4's value-codec
  cases, and it is worth running the TypeScript spec once before writing the Go one.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (P51's finding, still true). C1b's app run — start, exercise, tear down — is one Bash invocation
  with a 120–150 s timeout.
- **There is no real X display here**, so C1b is written against `tests/e2e-real/` rather than
  `xdotool`/`import -window` (§7). Do not spend a session trying to make the screenshot path work;
  P58a already established that it does not.
- **Comparing a struct containing an `any` field with `==` panics at runtime** rather than failing to
  compile (P55's finding). `model.ConnectionState.Caps` is such a field — use `go-cmp` (already a
  dependency), never `==`.
- **`go test ./... -race` is the bar**, not `go test ./...`. Three of P58b's four adapters run their
  driver call on a goroutine (`RunWithAbortRace`) and register/release from another; the race
  detector is the only thing that will find a missing mutex in `runningByOp`.

## 12. M6.0 results (run for real in this sandbox)

All four probes pass, run against `mariadb:11.4`, `mysql:8.4` and `clickhouse/clickhouse-server:26.3`
(all already pulled and retagged via `mirror.gcr.io` from earlier sessions — no fresh pull needed).
Throwaway code, in a scratch Go module outside the repo, never committed — the four programs
themselves, per §6's own instruction. Findings that change or sharpen a decision are folded back
into §2 rather than only recorded here; this section is the empirical trail.

- **TC-2 — PASS, all three.** `mariadb:11.4` and `mysql:8.4` each start and answer `SELECT 1` with
  no wait-strategy surprises (both resolve on their own log-message wait). `clickhouse-server:26.3`
  starts and answers an authenticated HTTP `SELECT 1` with **no `ulimit` workaround at all** —
  confirming §1.12's source read against a running daemon, not just against the module's own code.
  One correction to the probe as originally sketched: the ClickHouse module's `WithPassword("")`
  does not mean "no password" — its own doc comment says the password *"must not be empty or
  undefined"* — and an unauthenticated GET against the HTTP interface is a 401, not a free pass;
  the real credentials (`WithPassword("probe")`, `user=default&password=probe`) are what the
  adapter's own client must send too, matching client.go's design already.
- **MY-1 — PASS, both engines, with one genuine per-engine divergence worth designing around.**
  (a) confirmed: `DatabaseTypeName()` distinguishes `VARBINARY`/`BLOB` from `TEXT`/`JSON` on both
  engines, and `DECIMAL(10,3)` arrives as the exact server text `"123.456"`, never a float — B2/B3
  stand as written. A secondary, unplanned-for confirmation: MariaDB's `JSON` column reports
  `DatabaseTypeName() == "TEXT"` (MariaDB's `JSON` is a `LONGTEXT` alias with a `CHECK` constraint,
  not a real type), while MySQL's reports `"JSON"` — both still classify correctly as `text`/`json`
  typeClass either way, so no code change, but worth naming in `docs/ARCHITECTURE.md`'s per-engine
  section so a future reader does not "fix" the apparent inconsistency.
  (c) confirmed exactly as §1.4 predicted: cancelling a query's `context.Context` returns
  `context canceled` to the caller **and leaves the `*sql.Conn` unusable** (`driver: bad
  connection` on the very next statement) — this is decisive evidence for B6/B14: mysql-family
  must never pass the op's own context into `QueryContext`/`ExecContext`.
  (d) confirmed: `UPDATE … ` via `QueryContext` yields zero columns, no rows.
  (b) **confirmed for MariaDB, genuinely different for MySQL — a real per-engine divergence, not a
  probe bug.** `KILL QUERY <id>` against a plain `SELECT SLEEP(30)` on MariaDB raises
  `Error 1317 (70100): Query execution was interrupted` after ~500 ms, exactly as designed. The
  identical test against MySQL 8.4 returns **no error at all** — `SELECT SLEEP(30)` resolves with
  its own documented return value (`1`, meaning "was interrupted") rather than raising anything,
  because MySQL's `SLEEP()` is explicitly documented to swallow `KILL QUERY` and report it via its
  return value instead of an error, precisely so scripts can test cancellation without handling an
  exception. This is a fact about `SLEEP()` specifically, not about `KILL QUERY` against a real
  data-scanning statement (which does raise an error on both engines — not independently
  re-verified here, since `mapError`'s job is to map whatever the driver returns, not to assume a
  particular statement shape), but it means **`mysqlfamily`'s own acceptance test for real MySQL
  cancellation must not use `SLEEP()` as its long-running statement** — a recursive/generated-rows
  query (the same shape `sqlite/query.ts`'s own long-statement tests already use) is the honest
  substitute, and `mysqlfamily`'s Go suite uses one instead of copying `postgres_test.go`'s own
  `pg_sleep(30)` pattern verbatim.
- **SQ-1 — PASS, confirms B7 exactly, plus one B9-relevant surprise.** `mattn/go-sqlite3` returns
  `bool(true)` for the `BOOLEAN` column and the **zero `time.Time`** for `'not a date'` in the
  `DATETIME` column — silently, no error, exactly as §1.5 read from its source.
  `modernc.org/sqlite` returns `int64(1)` and the raw string `"not a date"` for the same two
  columns — storage-class-faithful, no coercion. All four of modernc's own feature checks pass:
  the `_busy_timeout`/`_foreign_keys`/`_txlock`/`_query_only` DSN options are accepted;
  `mode=rw` against a missing file fails with `unable to open database file (14)` and creates
  nothing; a context cancelled 300 ms into a long recursive-CTE statement returns `context
  canceled` and **the same `*sql.Conn` is immediately reusable afterward** (`SELECT 1` succeeds) —
  a materially better result than mysql-family's own MY-1(c): modernc's own `interruptOnDone`
  really does call `sqlite3_interrupt` and leaves the connection healthy, which is exactly the
  mechanism B8 needs and confirms `sqliteCaps.cancel: true` is a mechanism actually available, not
  aspirational; `SQLITE_BUSY` and `SQLITE_NOTADB` both arrive as `*sqlite.Error` with the expected
  codes (5, 26) and readable messages. **The one surprise**: a two-statement string
  (`CREATE TABLE …; INSERT …`) passed to a single `Exec` call **executes both statements** — modernc
  does not raise an error and does not silently drop the second one the way `node:sqlite`'s
  `prepare()` does. This does not withdraw B9 (the console's one-page-per-statement *contract*
  still needs enforcing), but it changes the mechanism: the adapter must split and count statements
  itself *before* executing (e.g. reject a payload that already contains more than one statement,
  the same shape `console.go`'s own multi-statement `execute()` loop already assumes at the caller
  level) rather than relying on the driver to reject or truncate a smuggled second statement — a
  cheaper, more correct guard than SQ-1 was written expecting to need.
- **CH-1 — PASS on all four, with one probe correction that matters for the adapter's own request
  shape.** (a) the exact format confirmed: names row, types row
  (`"Decimal(18, 4)"`, `"Enum8('a' = 1, 'b' = 2)"`, …), and the data row's every documented cell
  verified byte for byte — `"ᴺᵁᴸᴸ"` for the `Nullable(String)` NULL, `"nan"` for the `Float64` NaN,
  `"[1,2,3]"`/`"{'x':1,'y':2}"` for `Array`/`Map`. (b) `KILL QUERY WHERE query_id = '…' SYNC`
  against a running `sleep(3) FROM numbers(20)` works from a second HTTP request: the killed
  request itself comes back `status=500`, header `X-ClickHouse-Exception-Code: 394`, body
  `"Code: 394. DB::Exception: Query was cancelled. (QUERY_WAS_CANCELLED)…"` — B12's first two
  extraction sites confirmed against a real response, not just against `errors.ts`'s table.
  (c) **the mid-stream `__exception__` trailer does not appear with a default-sized result** — a
  10,000-row `numbers()` query buffers entirely before ClickHouse flushes anything, so the whole
  response arrives as one ordinary `status=500` error with no rows at all. It **does** reproduce,
  byte for byte, once the request forces early flushing (`buffer_size=0&wait_end_of_query=0` plus a
  small `max_block_size`) against a 2,000,000-row query that fails partway through: `status=200`,
  the normal names/types/data rows stream first, then the literal trailer
  `__exception__\n<token>\nCode: 395. DB::Exception: …\n<byte-count> <token>\n__exception__\n`.
  **The probe correction**: a plain GET with `query=<sql>` in the URL is rejected outright by this
  server version — *"Cannot execute query in readonly mode. For queries over HTTP, method GET
  implies readonly. You should use method POST for modifying queries."* — for **every** statement,
  not only DDL/DML; `clickhouse/client.go` must always POST the statement as the request body
  (matching §6's own probe description, which already said POST — the correction is that this is
  not optional even for a `SELECT`, contrary to what a first read of ClickHouse's docs might
  suggest). (d) `X-ClickHouse-Summary`'s `written_rows` is readable on an `INSERT` response, as
  designed.

None of these results changes P58b's own decisions beyond what §2 already records — B7 and B11 both
stand exactly as argued, now with a real container behind each rather than only a source read; B8's
mechanism is now proven live, not merely plausible; B9's contract is unchanged but its enforcement
point moves to the adapter, a smaller change than SQ-1 was written expecting to find. The MySQL
`SLEEP()`/`KILL QUERY` divergence is new and is folded into §5.3's testing plan (the acceptance
suite's own long-running statement) rather than into §2, since it changes a test fixture's shape,
not a design decision.
