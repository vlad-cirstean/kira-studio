# P15 — Fake data generator

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:30`, P15 row): *"Integrate a Faker-style
> fake-data library and build an easy-to-use UI for generating a user-specified number of rows of
> realistic fake data into the currently viewed table/collection, respecting column types/schema
> wherever the connection's adapter exposes them."* Why: *"A genuinely useful capability for a DB GUI
> client that nothing in the current tree provides."*
>
> **The headline, in one line: the mutation *wire* path is exactly right to reuse and needs no change
> at all — `MutationRowOp{kind:'insert'}` → `data.mutate` → `Dispatcher.Mutate` → each adapter's own
> `Mutate` — but the mutation *staging* path (`views/grid/pendingChanges.ts` plus the grid's
> pending-insert rows) is the one part of it that cannot carry N rows, and the reason is structural,
> not a tuning knob.** `pendingState` is a `reactive({})` holding one plain object per staged insert
> (`pendingChanges.ts:27`, `:157-164`), and `DataGrid.vue:1846-1873` renders those inserts with a
> plain `v-for` **outside the row virtualizer** — one `<div class="grid-row">` and one `<input>` per
> visible column per staged row, with the virtualizer's own `count` set to `displayRowCount`
> (`:372`), which excludes them by construction. Staging 1 000 generated rows means 1 000
> non-virtualized DOM rows and 1 000 deeply-reactive objects — against `docs/ARCHITECTURE.md:65-67`'s
> two hardest invariants ("No DOM node per cell for off-screen rows", "No Vue reactivity on row
> data") and against P5's own audit, which recorded **"Non-virtualised lists: None"**
> (`docs/v1.1/plans/P5-ram-usage.md:442`) — true today only because "+ row" is a hand-click.
>
> **So P15 reuses the mutation path and skips the staging store**, the same way
> `views/shared/immediateMutation.ts` already does for documents/keyvalue/stream: build
> `MutationRowOp[]` directly, hand them to `data.mutate` **in batches**, reload once at the end. No
> new op, no new adapter method, no `Caps` field, no Go change of any kind.
>
> **Batching is not an optimisation, it is what keeps the feature inside three existing hard limits.**
> **[verified here]** 100 000 generated rows of seven columns is **2 799 ms** to generate, **22.70 MiB**
> of request JSON and **~118 MiB** of transient heap in V8. One `data.mutate` carrying that plan
> would be a single 22.7 MiB renderer→Go frame (admissible only because Wails admits one oversized
> frame into an empty inbound queue — `stream.go:392-393` — not because it is a supported size), and
> `postgres/mutate.go:136`'s `op.SetCommand(joinSemicolons(previewParts))` would write **100 000
> INSERT statements as one string** into the `op_log.command` column and broadcast it to every window.
> Nothing truncates that anywhere (§2 F9).
>
> **`@faker-js/faker` is the right library and it does not tree-shake.** v10.6.0, MIT, released
> **2026-08-14** with a roughly monthly cadence — **[verified here]** against the registry. Its `en`
> locale is one object literal, so **[verified here]** `export { faker } from '@faker-js/faker'`
> bundles to **444 194 B raw / 152 546 B gzip** and importing `@faker-js/faker/locale/en` instead
> saves 97 bytes. 114 290 B gzip of that is the locale data alone; `simpleFaker` (no locale data,
> so no names/emails/addresses — i.e. not "realistic") is 27 442 B. That is 4x the `sql-formatter`
> chunk P13 landed, which is exactly why it follows P13's D2 pattern verbatim: a re-export entry
> module reached only through `await import()`, so it costs **zero** at boot and is fetched the first
> time someone opens the dialog.
>
> **What the generator can and cannot know is decided by two structures that already reach the
> renderer.** `ColumnDescriptor` on the page (`packages/shared/protocol/page.ts:17-28`) carries
> `typeClass`, `nullable`, `isPrimaryKey`, `generated` and the server's **verbatim** `dataType`
> (`varchar(50)`, `numeric(20,6)`, `Enum8('a'=1,'b'=2)`) — which is the *only* place a length,
> precision or enum member set exists. `ObjectMeta` from `treeDescribe`, already loaded into
> `runtime[tabId].meta` (`views/grid/state.ts:37`, `:77-87`), adds `defaultExpr`, `primaryKey`,
> `indexes[].unique` and `foreignKeys[].referencedPath/referencedColumns`. Two things are genuinely
> out of reach and are stated as warnings rather than papered over: **a real FK value** (it lives in
> another table) and **uniqueness** (`faker.helpers.unique` was **removed** in faker v10 —
> **[verified here]**, it is `undefined` — and no client-side set can know what is already stored).
> **MongoDB has no column metadata at all**: `mongo/adapter.go:191` returns `Columns: []` outright.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `e63bc2c` (`test(ui): the credential reveal gate`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1-P11, P13 and P14 have landed; P12 has not.

**What the two most recent phases hand P15 for free**, both load-bearing here:

- **P13's lazy chunk.** `views/console/sqlFormatterEntry.ts` + `await import()` is the app's first
  and (today) only dynamically-imported chunk, now named as a fact in `docs/ARCHITECTURE.md:28`.
  **[verified here]** the built tree has exactly two JS assets — `index-BVVug_OK.js`
  (1 057 495 B raw / 334 906 B gzip) and `sqlFormatterEntry-DhcLvpf7.js` (141 507 B / 37 622 B).
  P15 adds the second such chunk and follows the same shape, so this is adoption, not invention.
- **P14 touches nothing here.** Its edits are `internal/localauth`, `internal/secrets` build tags,
  the connections bridge/dialog and one `tests/ui` spec — no adapter, no mutation path, no grid.

### 0.2 Scope

1. `@faker-js/faker` as a new dependency, reached **only** through a lazily-imported re-export entry
   module, so it costs nothing at boot (D2).
2. A **Generate data…** dialog, opened from the data grid's own toolbar mutation group, that:
   - proposes one **recipe** per column from that column's real schema (D4's decision table),
   - lets the user change the row count, the seed, and any column's recipe (including *skip*),
   - shows the real dialect SQL for the first few rows through the **existing** `data:preview` op,
   - names, before anything runs, the two classes of thing it cannot get right (FK targets,
     uniqueness) for the specific columns affected.
3. Generation and insertion in **batches**, each batch one ordinary `data.mutate` call with its own
   op id, with progress and a **working stop button** (`docs/ARCHITECTURE.md:69`).
4. One `tests/unit` spec for the recipe decision table, one `tests/ui` spec for the whole flow, and
   one Postgres adapter conformance test for a multi-row insert plan.

### 0.3 Not in this phase

- **Generating into a MongoDB collection, a Redis key space, a Kafka topic, an SQS queue or an S3
  bucket.** F5: only the four tabular SQL kinds (postgres, mariadb, mysql, sqlite) plus ClickHouse
  have a column set to generate *against*; `mongo/adapter.go:191` returns `Columns: []`, and
  redis/kafka/sqs/s3 insert through `$`-prefixed sentinels (`views/keyvalue/mutations.ts:13-14`,
  `views/stream/mutations.ts:11-27`), not columns. Mongo is the one with a real follow-up shape (its
  `$jsonSchema` validator, already parsed into `DocumentSchemaMeta` by `mongo/definition.go:43-60`)
  — OQ-1, not built here.
- **Generating FK-valid values by reading the referenced table.** D9 explains the design that would
  work (`data.read` on `ObjectMeta.foreignKeys[].referencedPath`, projecting `referencedColumns`,
  sampling the page) and why it is OQ-2 rather than P15 scope.
- **Server-side generation.** §3 weighs it with real numbers. It is the right escape hatch at
  millions of rows and the wrong first build, because it means a second mutation path.
- **Any change to `pendingChanges.ts`, `DataGrid.vue`'s insert rows, or the Commit/Discard/Preview
  toolbar group.** P15 goes around the staging store (D3); it does not fix, extend or virtualise it.
  Making staged inserts virtualization-safe is OQ-3.
- **Any Go-side change.** No new data-plane op, no `Adapter` method, no `Caps` field, no migration,
  no settings leaf. The one Go file P15 touches is a new `_test.go` (§5 C5).
- **Truncating `op_log.command`.** F9 is a real pre-existing sharp edge that P15's batch size keeps
  clear of rather than fixes; OQ-4 hands the fix forward with the reason it belongs on its own.
- **Deleting/emptying a table before generating.** "Generate 1 000 rows" is additive. A *Truncate*
  action is a separate destructive verb nobody has asked for.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim below is **[verified in source]** against this
  tree at the cited `file:line`, or **[verified here]** where it was executed in this sandbox.
- **One new dependency, and its cost is measured before it is added** (F6, F7), then re-checked
  against the emitted chunk at implementation time (§5 C1) — P13 F8's rule, for the same reason:
  nothing in CI asserts a byte size, so a failed tree-shake would be silent.
- **No new abstraction where one exists.** The op is `data.mutate`; the row op is
  `MutationRowOp`; the modal is `DialogFrame`; the error is `MessageStrip`; the busy indicator is
  `RunState`; the cancel is `control.opsCancel`. The nearest precedent for the whole dialog —
  a feature dialog driven by its own state module and mounted in `App.vue` — is
  `workbench/UploadObjectDialog.vue` (`App.vue:18`, `:59`).
- **Two unit tests, both earned, and no more.** The recipe decision table (D4) is the
  "decision structure large enough that no one can hold it in their head" `AGENTS.md` names
  outright, and the `dataType` bound parser is a small lexer with real boundary cases. Everything
  else — a dialog, a loop calling `data.mutate`, a library call — gets nothing.
- **Comments only where the code cannot say it for itself.** Four are owed: why the faker entry
  module exists (D2), why generation never goes through `pendingChanges` (D3), why a serial primary
  key is skipped (D4), and why the batch size is the number it is (D6).

---

## 1. What the code does today

### 1.1 The mutation path, end to end

**[verified in source]** One path, five hops, identical for every adapter and every write:

| # | Where | What |
|---|---|---|
| 1 | `views/grid/pendingChanges.ts:184-200` | `buildPlan(tabId)` turns the staged set into `MutationRowOp[]` — deletes, then updates, then inserts (D8's own comment: mirrors the adapter's execution order so *Preview command* shows what `mutate()` will run). |
| 2 | `views/grid/pendingChanges.ts:212-228` | `commitPending` calls `data.mutate({opId: crypto.randomUUID(), tabId, connectionId, path, ops})`, then `clearPending` **only on success**. |
| 3 | `bridge/data.ts:44` | `data.mutate` is `request(DATA_OP.mutate, req, NO_TIMEOUT)` — no client-side timeout by design (`:22-23`, P4 D25); cancellation via `control.opsCancel` is the only escape. |
| 4 | `internal/adapterhost/dataframe.go:169-176` | `data:mutate` decodes `MutateRequestWire` (`wire.go:151-168` — `opId` and `connectionId` required, **`ops` unbounded**), then `Dispatcher.Mutate`. |
| 5 | `internal/adapterhost/data.go:149-170` | `RunOp(Kind:"mutate")` around `adapter.Mutate(ctx, MutationPlan{Path, Ops}, op)`, with `defer d.cache.InvalidateAfterMutation(...)` **unconditional** — its own comment states why: six adapters mutate without a transaction, so a partly-applied plan has still changed the server. |

**`MutationRowOp` is a three-way discriminated union with a wire-order-preserving value map.**
`internal/storage/model/mutations.go:99-167`: `insert` carries only `Values`, a `RowValues` —
which is an **order-preserving slice**, not a map (`:9-13`), because a preview/mutate statement's
column order is asserted verbatim by the fixture corpus. Every value is `*string`: `nil` is SQL
NULL, and every non-NULL value travels as **text**, whatever the column's type. That last property
is what makes a generator safe for `bigint` and `numeric(20,6)` alike — no JavaScript number ever
has to represent the value (D5).

**The renderer has a second, staging-free caller of exactly this path.**
`views/shared/immediateMutation.ts:11-35` is the nine-call-site body behind documents/keyvalue/
stream: resolve the tab, one `data.mutate`, reload the tab, tell sibling tabs on the same target.
No pending set, no preview. **This is the shape P15 adopts** (D3).

### 1.2 Which adapters accept an insert, and what each one does with a multi-op plan

**[verified in source]**, `internal/adapters/*/caps.go` and `*/mutate.go`:

| Kind | `CanInsert` | `Transactions` | What `Mutate` does with N insert ops |
|---|---|---|---|
| PostgreSQL | `postgres/caps.go:24` `true` | `true` | Re-reads the catalog in the same op (`mutate.go:82`), `AssertColumnsKnown` per op, then `BEGIN` / **one `INSERT` per op** / `COMMIT` (`:142-175`), each checked by `AssertAffectedExactlyOne` (`:167`). A deferred rollback on a detached, timeout-bounded ctx (`:152-160`). |
| MariaDB / MySQL | `mariadb/caps.go:25`, `mysql/caps.go:24` `true` | `true` | Same shape (`mysqlfamily/mutate.go:62-170`), same detached-ctx `ROLLBACK` (`:149-151`). |
| SQLite | `sqlite/caps.go:32` `true` | `true` | Same shape, with `BEGIN IMMEDIATE` rather than a deferred `BEGIN` (`sqlite/mutate.go:136`) and the same detached cleanup (`:151-153`). |
| ClickHouse | `clickhouse/caps.go:29` `true` | **`false`** | **Different, and better for this feature**: `renderInsert` (`mutate.go:40-68`) collapses *every* insert op in one plan into a **single multi-row `INSERT … VALUES (…),(…),…`**, columns being the union across ops with a `NULL` pad for a missing one. `assertInsertOnly` (`:14-21`) refuses anything but an insert. |
| MongoDB | `mongo/caps.go:27` `true` | `false` | Loops the ops (`mutate.go:113`); `insert` requires the `$document` sentinel. |
| Redis | `redis/caps.go:32` `true` | `false` | Loops (`mutate.go:133`); `_key`/`$value` sentinels, string-typed keys only. |
| Kafka | `kafka/caps.go:35` `true` | `false` | Loops into `[]*kgo.Record` and one `ProduceSync` (`produce.go:110-111`). |
| SQS | `sqs/caps.go:29` `true` | `false` | Loops (`mutate.go:105`). |
| S3 | `s3/caps.go:36` `true` | `false` | Loops (`mutate.go:238`); an insert is a **local-file upload**, not a value. |

**`Caps.Transactions` is the honest per-adapter answer to "what happens on partial failure"** and it
already reaches the renderer: `packages/shared/caps.ts:62` declares it, and `internal/adapters/caps.go`
mirrors the field order deliberately so the two diff against each other.

### 1.3 What schema information actually reaches the renderer

**[verified in source]** Two structures, both already in hand for an open data tab:

**A. `ColumnDescriptor`, on every page** (`packages/shared/protocol/page.ts:17-28`):

| Field | Value | Where it comes from |
|---|---|---|
| `name` | column name | catalog |
| `dataType` | **the server's own type name, verbatim** — `'numeric(20,6)'`, `'varchar(50)'`, `'longblob'` (the doc comment's own examples) | postgres: `format_type(a.atttypid, a.atttypmod)` (`postgres/catalog.go:222`); mysqlfamily: **`COLUMN_TYPE`, not `DATA_TYPE`** (`catalog.go:148-152`, whose own comment says `"varchar(50)" is what the` … ); sqlite: the declared type (`catalog.go:258`); clickhouse: `system.columns.type` (`catalog.go:151`) |
| `typeClass` | one of seven: `number`/`text`/`boolean`/`temporal`/`binary`/`json`/`other` (`page.ts:5`) | each adapter's own `typeClassFor` (e.g. `postgres/read.go:34-55`) |
| `nullable` | real | catalog |
| `isPrimaryKey` | real | catalog |
| `generated` | `true` for a computed column — **sqlite and clickhouse only** (`sqlite/read.go:142`, `clickhouse/read.go:149`); postgres and mysqlfamily hardcode `false` with a comment saying so (`postgres/read.go:110-112`) | catalog |

**B. `ObjectMeta`, from `treeDescribe`, already loaded into `runtime[tabId].meta`**
(`views/grid/state.ts:37`, `:77-87` — a `loadMeta` whose failure is deliberately swallowed because
"the projection menu is a nicety fed by this"). `internal/storage/model/tree.go:43-83`:

- `Columns[]` = `ColumnMeta{Name, Position, DataType, Nullable, DefaultExpr, IsPrimaryKey, Comment}`
  — **`DefaultExpr` is the field `ColumnDescriptor` does not have**, and it is what distinguishes a
  `serial`/`identity` primary key (`nextval('app.customers_id_seq'::regclass)`) from one the user
  must supply.
- `PrimaryKey []string`.
- `Indexes[] = IndexMeta{Name, Columns, Unique, Primary, Method}` — **uniqueness is structurally
  available**, per index, including non-PK unique indexes (the corpus has one:
  `order_items_order_product_idx`, `packages/db-fixtures/fixtures/0001_seed.sql:252`).
- `ForeignKeys[] = ForeignKeyMeta{Name, Columns, ReferencedPath, ReferencedColumns, OnDelete, OnUpdate}`
  — the referenced table's **encoded node path**, i.e. everything needed to read it, and nothing
  about which values it holds.
- `RowEstimate *int`, `Comment *string`.

**C. What exists but is *not* in either structure.** CHECK constraints reach the renderer only
through `Definition` — `model/definition.go:12-18`'s `ConstraintMeta{Name, Type, Definition}`, where
`Definition` is *"the engine's own text … rendered verbatim, never re-composed here"*
(`postgres/definition.go:124-149`). It is a SQL expression string, not a structure, and `Definition`
is a separate op the data grid never issues.

### 1.4 The add-row UI, and the staging store behind it

**[verified in source]**

- **The button.** `views/grid/DataToolbar.vue:209-231` is the mutation group: `add` / `trash` /
  `search`, gated by `isWritable` (`:46-48` — `caps.writable && !connection.readOnly`) and, for
  delete, additionally by `caps.canDelete` (`:53`, P36 D26's own ClickHouse gate).
- **`onAddRow`** (`:109-118`) stages one insert seeded with every non-`generated` column at `null`.
- **The store.** `pendingChanges.ts:27` — `const pendingState = reactive({} as Record<string,
  TabPending>)`, where a `TabPending` holds `edits: Map`, `deletes: Set`, `inserts: PendingInsert[]`.
  Its header (`:7-9`) states it is renderer-only, in-memory, per tab, never persisted.
- **The rendering.** `DataGrid.vue:1846-1873`: `v-for="(insert, idx) in insertRows"` — every staged
  insert, every time, with one `<input class="cell-input">` per **visible column**. It sits outside
  the row virtualizer, whose own `count` is `displayRowCount` (`:372`, `:266-268`), which counts
  page rows (or filtered rows) and never inserts. `displayPositionOf` (`:279`) positions an insert
  at `displayRowCount + (row - rowCount)`.
- **Commit.** `DataView.vue:91-103` — `commitPending`, `setActionError(null)`, `reloadAfterMutation`;
  on throw, `setActionError(message)` and the staged set survives (`pendingChanges.ts:226` clears
  only after the await resolves). `reloadAfterMutation` (`state.ts:176-191`) invalidates pages,
  reloads at the current page index, re-reads the count if one was ever taken, then tells sibling
  tabs.
- **Preview.** `PreviewCommandPanel.vue:26-38` calls `previewPending` on mount and renders
  `statements.join(';\n\n')` into a read-only CodeMirror. `Dispatcher.Preview`
  (`data.go:127-143`) is *"never an op, never touches the server"*.

### 1.5 The bundle and lazy-chunk discipline P5 set and P13 exercised

**[verified in source]** `docs/v1.1/plans/P5-ram-usage.md:177-206` (F3) measured the production
bundle and recorded that `vite.config.ts` sets no `manualChunks`; P5's D8 (`:466`) made a further
split conditional on its own measurement. P13 took the first one and wrote it into
`docs/ARCHITECTURE.md:28` as a property of the app. **[verified here]** today's `dist/assets/`
holds exactly two JS files, listed in §0.1.

---

## 2. Findings

### F1 — The wire path needs nothing; the staging path cannot carry N rows, structurally
**[verified in source]** §1.1 and §1.4. `MutateRequestWire.Validate` (`wire.go:160-168`) checks two
string fields and never looks at `Ops`, so the wire is already willing to carry any plan. What
cannot carry it is `pendingChanges.ts`'s `reactive` store plus `DataGrid.vue:1846`'s un-virtualized
`v-for` — one DOM row and one `<input>` per visible column per staged row, plus Vue's deep
reactivity over every staged value. `docs/ARCHITECTURE.md:65-67` forbids both shapes for row data,
and P5's own audit table (`docs/v1.1/plans/P5-ram-usage.md:442`) records *"Non-virtualised lists:
**None**. Every list is virtualised"* — a claim that survives today only because the only producer
of staged inserts is a human clicking `+`.

`tests/ui/perf.spec.ts:171`/`:198` bounds the grid at `< 1500` elements matching
`[data-testid="grid-cell"]`; an insert cell is `data-testid="grid-cell-insert"`
(`DataGrid.vue:1861`), so that guard would **not even fire** on the regression. Stated so nobody
concludes from a green perf spec that staging N rows is fine.

### F2 — Four SQL kinds insert one statement per row inside one transaction; ClickHouse batches
**[verified in source]** §1.2's table. Postgres/MariaDB/MySQL/SQLite compile one `INSERT` per op and
run them in sequence between `BEGIN` and `COMMIT` — so a plan of N rows is N server round trips, and
`AssertAffectedExactlyOne` (`sqlmutate.go:44-49`) is applied to each. ClickHouse's
`renderInsert` (`clickhouse/mutate.go:40-68`) collapses the whole plan into one multi-row `INSERT`,
which is both faster and, since `Transactions` is `false` there, the only reason a ClickHouse bulk
insert is atomic at all (one statement, one insert block).

**A per-batch size is therefore doing two different jobs**: on ClickHouse it is the width of one
generated statement; on the four transactional kinds it is the number of round trips inside one
transaction, and therefore the unit of rollback (D6, D7).

### F3 — Partial failure has exactly two shapes, and `Caps.transactions` already tells them apart
**[verified in source]** On postgres/mariadb/mysql/sqlite a failed op inside `Mutate` returns before
`COMMIT`, and the deferred rollback runs on a **detached, timeout-bounded** context specifically so
it lands even when the caller's ctx is already cancelled (`postgres/mutate.go:152-160`,
`mysqlfamily/mutate.go:145-151`, `sqlite/mutate.go:139-153` — all three carry the same P2 R2 comment
about a pinned connection left "idle in transaction"). `TestPostgres_MutateRowCountConflictRollsBack`
(`postgres/postgres_test.go:727-757`) proves the whole plan rolls back. On the other six adapters
there is no transaction and the loop simply stops — earlier ops stay written, which is precisely why
`Dispatcher.Mutate` invalidates the cache unconditionally (`data.go:145-148`, `:160`).

**For batched generation this means the failure story is per batch, and it is honest either way**:
batch k fails ⇒ batches 1…k−1 are committed and durable, batch k is rolled back whole (transactional
kinds) or partially written (ClickHouse: never, since it is one statement). D7 makes the UI say this
in those words rather than reporting "failed" over a table that now has 3 000 new rows in it.

### F4 — There is no stop button for a commit today, and no server→renderer progress channel at all
**[verified in source]** `commitPending` mints its own `crypto.randomUUID()` op id
(`pendingChanges.ts:219`) and **never stores it**; `ViewChrome`'s stop is bound to
`:can-stop="!!rt?.opId"` (`DataView.vue:167`), and `rt.opId` is written only by `beginOp` on a page
load (`state.ts:115`). So a slow commit is uncancellable today. Separately, `adapters.OpCtx` declares
`OnProgress func(Progress)` (`adapter.go:139`) and **[verified here]** `grep -rn "OnProgress"
apps/kira-studio/internal/` returns that declaration and nothing else — the field is never set and
never read. There is no op-progress event for a renderer to subscribe to.

**Both facts point the same way**: batching is what makes progress and cancellation possible without
inventing a channel — the renderer knows how many batches it has sent, and each batch carries its own
op id that `control.opsCancel` (`bridge/control.ts:255`) can cancel.

### F5 — Only five connection kinds have a column set to generate against
**[verified in source]** §1.2. MongoDB's `Describe` returns `Columns: []model.ColumnMeta{}` and
`PrimaryKey: nil` outright (`mongo/adapter.go:191`) — the collection is schemaless and the adapter
says so rather than guessing; what it *does* return is `Indexes` (with `Unique`), and its
`Definition` separately surfaces a `$jsonSchema` validator as a parsed field table
(`mongo/definition.go:43-60`, `model/definition.go:20+`'s `DocumentSchemaMeta`). Redis, Kafka, SQS
and S3 do not insert *columns* at all: their insert ops carry `$`/`_`-prefixed sentinels
(`views/keyvalue/mutations.ts:13-14`, `views/stream/mutations.ts:11-27`), and an S3 insert is a
local-file upload (`s3/mutate.go`). So "respecting column types/schema wherever the adapter exposes
them" resolves to postgres, mariadb, mysql, sqlite and clickhouse — and this plan says so rather
than shipping a wand icon on a Redis Browse tab.

### F6 — `@faker-js/faker` is the only actively-maintained candidate, and 10.6.0 is current
**[verified here]** against the npm registry:

| Package | Latest | License | Last publish |
|---|---|---|---|
| **`@faker-js/faker`** | **10.6.0** | MIT | **2026-08-14** (10.2.0 Jan, 10.3.0 Feb, 10.4.0 Mar, 10.5.0 Jun, 10.6.0 Aug — roughly monthly) |
| `@ngneat/falso` | 8.0.2 | MIT | 2025-07-13 (~14 months stale) |
| `chance` | 1.1.13 | MIT | 2025-05-18 |
| `casual` | 1.6.2 | MIT | 2026-03-31 (a Node-oriented, CommonJS-first API) |

`@faker-js/faker` is `"type": "module"`, `"sideEffects": false`, ships its own `.d.ts`, and its
module surface is the one a per-column recipe list wants: **[verified here]**
`Object.keys(faker)` = `fakerCore, datatype, date, helpers, location, number, string, airline,
animal, book, color, commerce, company, database, finance, food, git, hacker, image, internet,
lorem, music, person, phone, science, system, vehicle, word`.

### F7 — It bundles to 152 KB gzip and does **not** tree-shake, because a locale is one object
**[verified here]** esbuild `--bundle --minify --format=esm` (Vite 7's own minifier),
`@faker-js/faker@10.6.0`:

| What is imported | Raw | gzip -9 | vs. today's 334 906 B gzip main chunk |
|---|---|---|---|
| `export { faker } from '@faker-js/faker'` | 444 194 | **152 546** | +45.6 % |
| `export { faker } from '@faker-js/faker/locale/en'` | 444 058 | 152 449 | +45.5 % |
| `new Faker({ locale: [en, base] })` | 444 193 | 152 545 | — |
| `export { en } from '@faker-js/faker'` (the locale **data alone**) | 288 815 | 114 290 | — |
| `export { SimpleFaker, simpleFaker }` (engine only, **no locale data**) | 113 609 | 27 442 | +8.2 % |

Two things to read off this: **the locale subpath buys 97 bytes**, because `en` is one object
literal that Rollup cannot split; and **75 % of the weight is data, not code** — so there is no
"import fewer modules" lever. `simpleFaker` is the only smaller shape and it has no names, emails,
addresses or company names, i.e. it is not the "realistic" the SPEC row asks for.

`@ngneat/falso` tree-shakes far better (**[verified here]** six `rand*` functions bundle to 37 682 B
raw / **15 549 B** gzip, because each generator carries its own small data file) and is the one
genuine size argument against faker — see §3 for why it still loses.

### F8 — Generation cost and payload size, measured
**[verified here]** Node/V8 in this container, `@faker-js/faker@10.6.0`, seven columns per row
(`person.fullName`, `internet.email`, `location.city`, `date.past().toISOString()`,
`finance.amount`, `lorem.sentence`, plus a counter), built as `MutationRowOp[]`:

| N rows | Generate | `JSON.stringify` | Request payload | Process heap after |
|---|---|---|---|---|
| 100 | 15 ms | 2 ms | 0.02 MiB | 23 MiB |
| 1 000 | 69 ms | 2 ms | 0.23 MiB | 36 MiB |
| 10 000 | 291 ms | 15 ms | 2.26 MiB | 43 MiB |
| 100 000 | **2 799 ms** | 169 ms | **22.70 MiB** | **118 MiB** |

`await import('@faker-js/faker')` costs **160.8 ms** cold and the first generated value a further
1.7 ms; every value after that is microseconds. These are V8 numbers and the shipped renderer is
JavaScriptCore, which is why §6.2 re-measures rather than trusting the row (P13 F4's own discipline).

`faker.seed(n)` is **deterministic** — **[verified here]** two `seed(7)` / `person.fullName()` pairs
return the same string — which is what makes both the reproducibility affordance (D8) and the
`tests/ui` fixture (§6.1) possible at all.

### F9 — A large single plan hits three unbounded places, none of which anything truncates
**[verified in source]**

1. **The op-log command text.** `postgres/mutate.go:128-136` renders a *second*, literal copy of
   every op for display and calls `op.SetCommand(joinSemicolons(previewParts))` — one string holding
   every statement. `adapterhost/host.go:153-160` puts it on the `op:end` event verbatim, and
   `repos/ops.go:49` writes it into `op_log.command`. **[verified here]** nothing anywhere caps its
   length; `repos/ops.go:121-135`'s `Prune` bounds the *number* of rows, not the size of one.
2. **The request frame.** `bridge/port.ts:143` sends `JSON.stringify(req)` as one frame. Wails'
   inbound admission is `len(c.in) == 0 || c.inBytes+len(data) <= streamInQueueBytes`
   (`stream.go:392-393`, `streamInQueueBytes = 8 << 20` at `:112`), with a hard per-frame ceiling of
   `streamMaxFrameBytes = 64 << 20` (`stream_transport.go:50`). **A 22.7 MiB frame is admitted only
   when the inbound queue happens to be empty**, and answers `429` otherwise, which `port.ts` does
   not retry.
3. **The preview panel.** `PreviewCommandPanel.vue:20` joins every statement into one CodeMirror
   document.

None of these is P15's to fix. All three are avoided by batching (D6) and by previewing a bounded
sample (D10).

### F10 — `dataType` is the only source of length, precision and enum members, and it is per-dialect
**[verified in source]** §1.3 A. The corpus proves the shapes are real:
`packages/db-fixtures/fixtures/0001_seed.sql:22-85`'s `app.wide_table` has `varchar(50)`,
`numeric(20,6)`, `bool`, `date`, `timestamptz`, `uuid`, `jsonb` and `bytea` columns side by side, and
mysqlfamily deliberately reads `COLUMN_TYPE` rather than `DATA_TYPE` so `varchar(50)` and
`int unsigned` survive intact (`mysqlfamily/catalog.go:148-152`). ClickHouse's own type strings carry
more still — `Nullable(String)`, `FixedString(16)`, `Enum8('a' = 1, 'b' = 2)` — so an `Enum8`'s
**valid member set is literally in the string** and a generator can pick from it.

`typeClass` alone is not enough for any of this: it has seven members
(`packages/shared/protocol/page.ts:5`) and collapses `varchar(50)` and `text` onto the same one.

### F11 — Uniqueness is visible, unenforceable, and faker no longer even pretends to help
**[verified in source]** `ObjectMeta.Indexes[].Unique` (`model/tree.go:57`) names every unique index,
and `ConstraintMeta.Type == "unique"` names every unique constraint on the definition side.
**[verified here]** `faker.helpers.unique` is `undefined` in v10 — it was deprecated in v8 and
removed. Even if it existed, it de-duplicates only within one process's own generated set and knows
nothing about the rows already in the table.

So the truthful design is: a column covered by a unique index gets a recipe that is unique **by
construction** where one exists (`sequence` for an integer, `string.uuid` for a uuid/text), and a
**named pre-flight warning** otherwise. A duplicate that slips through fails as an ordinary server
error — `tests/ui/mutations.spec.ts:180-186` already carries a real captured
`duplicate key value violates unique constraint "composite_pk_pkey"` for exactly that case.

### F12 — A foreign key's target is reachable, but only by a second read
**[verified in source]** `ForeignKeyMeta.ReferencedPath` is an **encoded node path**
(`model/tree.go:66`), i.e. exactly what `data.read` takes, and `ReferencedColumns` names the columns
to project. `page.MaxPageSize` is `10_000` (`internal/page/chunk.go:13`). So "sample real FK values"
is one extra `data.read` per FK per generation run, bounded at 10 000 candidate values. That is a
genuinely good feature and a genuinely separate one — D9/OQ-2.

Until it exists, a NOT-NULL FK column is the one case where the generator *knows* it will produce an
invalid row. The corpus has three (`app.orders.customer_id`, `app.order_items.order_id`,
`app.order_items.product_id` — `0001_seed.sql:238`, `:243-244`), so this is not hypothetical.

### F13 — `tests/ui`'s data-plane mock matches on the **exact** payload, so the spec must pin the seed
**[verified in source]** `tests/ui/support/mockStreamBrowser.js:98-108`'s `matchKey` is
`` `${op}:${JSON.stringify(payload)}` `` with only `opId`, `tabId` and a `refresh:false` normalised
away; a request with no matching key gets a fixed `E_FIXTURE_MISS` error frame
(`mockStream.ts:155-172`) that no spec can override. Repeats of the same key replay the group in
order (`mockStreamBrowser.js:151-153`).

Consequence, and it shapes §6.1: a `tests/ui` spec that generates faker-backed values must pin the
seed **and** hard-code the generated values, which pins the spec to faker 10.6.0's exact RNG stream —
something **P19 (dependency bump) will break on purpose**. The mitigation is D8's seed field plus a
deterministic non-faker recipe (`sequence`) that the spec uses for the exact-payload assertions,
keeping the faker-backed content covered by the unit test instead.

---

## 3. Checked, and not fired

- **Generating in Go instead of the renderer.** Real candidates exist and are maintained —
  **[verified here]** `github.com/brianvoe/gofakeit/v7` **v7.16.0** (2026-08-20) and
  `github.com/go-faker/faker/v4` **v4.11.0** (2026-08-14) both resolve on `proxy.golang.org`. It
  would delete F7's 152 KB chunk and F8's 22.7 MiB payload outright, and on a SQL engine it could go
  further still (`INSERT … SELECT … FROM generate_series`). It loses on the thing this phase is
  actually constrained by: it needs a new data-plane op or a new `Adapter` method, i.e. a **second**
  mutation path across ten adapters, plus a `Caps` field, plus its own preview story — exactly what
  the phase brief rules out, and what `docs/ARCHITECTURE.md:571-575`'s "shared machinery, not four
  reimplementations" exists to prevent. It is the right answer at millions of rows and is handed
  forward as OQ-5 with these numbers attached, not discarded.
- **`@ngneat/falso` for its 15.5 KB.** Ten times smaller (F7) and the only real size argument. It
  loses on maintenance (last publish 2025-07-13, against faker's monthly cadence), on a per-generator
  import surface that a user-selectable recipe list would have to enumerate statically anyway, and on
  the fact that the 152 KB is in a **lazily-imported chunk that costs nothing at boot** — so the
  saving is on a one-time parse the user pays only when they open the dialog. Recorded so the trade
  is visible if a future phase ever needs the bytes back.
- **Extending `pendingChanges.ts` to hold generated rows and reusing Commit.** The most obvious
  design, and F1 is why it is not built: the store is `reactive`, the rows render un-virtualized, and
  the *Preview command* panel would join N statements into one document (F9.3). Making that safe is a
  grid rework, not a fake-data feature — OQ-3.
- **A new `Caps` flag (`canGenerate`).** Unnecessary: the gate is exactly
  `caps.canInsert && caps.tabular && !connection.readOnly`, all three of which the toolbar already
  reads (`DataToolbar.vue:37-48`).
- **A settings leaf for a default row count / default seed / default locale.** Nothing is persisted
  by this phase; the dialog's own defaults are constants. P17 rewrites the settings dialog's commit
  model anyway, and adding a leaf now would be a fifth Appearance-shaped edit for a value nobody has
  asked to keep.
- **`NOTICES.md`.** It covers **icon assets only** (`NOTICES.md:1-3`); MIT code dependencies are not
  listed there (P13 checked the identical question for `sql-formatter`). No change.
- **`dependencies` vs `devDependencies`.** P1's D1 settled that the split has no effect post-Electron
  and that nothing moves; every renderer library sits in `devDependencies`, and `sql-formatter`
  (`package.json:60`) is the immediate precedent. The new one joins them.
- **A migration or a schema change.** Nothing is stored. Generated rows are ordinary inserts.
- **Multi-window.** Generation runs in the window that owns the tab, and
  `reloadAfterMutation`/`reloadTabsForTarget` already handle sibling tabs; connection state and the
  three cache tiers are app-wide (`docs/ARCHITECTURE.md:804-810`), and
  `Dispatcher.Mutate`'s unconditional `InvalidateAfterMutation` is what makes a second window's tab
  correct on its next read. Nothing to broadcast.
- **Reusing `assertPageStructure` / the page codec for the generated rows.** They are request-side
  data, never a `Page`; the wire shape is `MutationRowOp[]`, which the FlatBuffers data plane does
  not touch at all — requests are still plain JSON text (`docs/ARCHITECTURE.md:702-703`, P11 D3).

---

## 4. Decisions

**D1 — P15 ships on the five tabular SQL kinds: postgres, mariadb, mysql, sqlite, clickhouse.** F5.
The button is gated on `caps.tabular && caps.canInsert && !connection.readOnly`, which is a
capability test, not a kind check (`docs/ARCHITECTURE.md:97-100`'s standing rule), and which
therefore lets a future adapter opt in for free. Mongo is a real follow-up with a real schema source
(OQ-1); the other four kinds have no column set at all and get nothing.

**D2 — `@faker-js/faker` is reached only through a lazily-imported local entry module.** P13's D2
shape, verbatim, because the reason is identical and the measurement is four times larger:

- `frontend/src/views/grid/fakeData/fakerEntry.ts` — nothing but
  `export { faker } from '@faker-js/faker/locale/en';` plus the one comment saying why the file
  exists. The `/locale/en` subpath buys 97 bytes (F7) and is chosen anyway, because it makes the
  single-locale intent explicit at the import rather than in a comment.
- `frontend/src/views/grid/fakeData/generate.ts` — `await import('./fakerEntry')` inside the
  generator, memoised in a module-scope variable so a second run pays nothing.

An inline `await import('@faker-js/faker')` would leave the shape of the emitted chunk to Rollup's
analysis of a dynamic namespace; a static re-export behind a dynamic import is the shape P13 already
proved emits a clean, correctly-sized chunk in this build.

**D3 — Generation never touches `pendingChanges.ts`, and the ops go straight to `data.mutate`.**
F1. The precedent is `views/shared/immediateMutation.ts` — the app's own second, staging-free caller
of the same wire path (§1.1) — and the whole difference here is that the ops are built by a generator
instead of by a document editor. This is the second of §0.4's four owed comments, because "why does
this not use the pending set like + row does" is exactly the question a future reader will ask.

**D4 — One recipe per column, chosen by a stated decision table, every choice overridable.**
`recipeFor(descriptor, meta)` runs in this order and stops at the first match:

| # | Condition | Recipe | Why |
|---|---|---|---|
| 1 | `descriptor.generated` | **skip** | P36 D28's rule, and what `DataToolbar.vue:112-117` already does for + row: the server computes it and an explicit value is refused. |
| 2 | `column.defaultExpr !== null` **and** `isPrimaryKey` | **skip** | A `serial`/`identity`/`AUTO_INCREMENT` key. Supplying one guarantees a collision; skipping lets the sequence assign. §0.4's third owed comment. |
| 3 | `isPrimaryKey`, no default, `typeClass === 'number'` | **sequence** (user-editable start, default 1) | The only unique-by-construction integer a client can produce (F11). |
| 4 | `isPrimaryKey`, no default, otherwise | **string.uuid** | Unique by construction for a text/uuid key. |
| 5 | the column is in some `foreignKeys[].columns` | **skip** if `nullable`, else **unset + a named warning** | F12: the generator knows it cannot get this right, so it says which column and why rather than inventing an id. |
| 6 | the *name* matches a heuristic (lowercased, `_`/`-` stripped) | the matching faker recipe | `email`→`internet.email`, `firstname`→`person.firstName`, `lastname`→`person.lastName`, `name`→`person.fullName`, `phone`/`tel`→`phone.number`, `city`/`country`/`state`/`zip`/`postcode`/`address`/`street`→`location.*`, `company`/`org`→`company.name`, `url`/`website`/`link`→`internet.url`, `price`/`amount`/`total`/`cost`/`salary`→`finance.amount`, `createdat`/`updatedat`→`date.recent`, `birth*`→`date.birthdate`, `description`/`comment`/`note`/`bio`/`summary`→`lorem.sentence`, `uuid`/`guid`→`string.uuid`, `slug`→`lorem.slug`, `is*`/`has*`/`active`/`enabled`→`datatype.boolean`. Applied only when the name's implied type agrees with `typeClass`, so a `varchar` column called `amount` still gets a number-shaped string and an `int` column called `name` does not get a person's name. |
| 7 | `typeClass` fallback | `number`→`number.int` (bounded, D5) · `boolean`→`datatype.boolean` · `temporal`→`date.past`, formatted per `dataType` (a `date` gets `YYYY-MM-DD`, a `time` gets `HH:mm:ss`, everything else ISO-8601) · `json`→a small fixed-shape object · `binary`→`'0x' + hex` (the app-wide convention `adapters.DecodeBinaryCellText`, `sqlmutate.go:115-123`, decodes on the way in) · `text`→`lorem.words`, clamped to the declared length (D5) · `other`→**skip** | |

Every row of that table is a control in the dialog, so the default is a proposal, never a
constraint. The full recipe set also carries `skip`, `null`, `constant`, and `sequence` explicitly —
`sequence` and `constant` being what makes a deterministic, faker-version-independent `tests/ui`
assertion possible (F13, §6.1).

**D5 — The declared type's own bounds are parsed out of `dataType`, and every value is emitted as
text.** F10 is the reason this is possible and `RowValues`' `*string` (§1.1) is the reason it is
safe. `parseTypeBounds(dataType)` returns `{ maxLength?, precision?, scale?, signed?, enumMembers? }`
from:

- `varchar(n)` / `character varying(n)` / `char(n)` / `nchar(n)` / `FixedString(n)` → `maxLength`
- `numeric(p,s)` / `decimal(p,s)` → `precision`/`scale`
- `tinyint`/`smallint`/`int`/`integer`/`int2`/`int4`/`int8`/`bigint`/`UInt8`…`Int64` → an integer
  range; MySQL's `unsigned` suffix (present because the adapter reads `COLUMN_TYPE`, F10) clears
  `signed`
- `Enum8('a' = 1, 'b' = 2)` / `Enum16(…)` → `enumMembers`, and the recipe becomes "pick a member"
- `Nullable(T)` unwraps to `T` before any of the above

A `bigint` is generated as a **decimal string**, never a JavaScript number, so nothing is clipped at
2⁵³ on the way to a column that can hold more. A `numeric(20,6)` likewise. This parser plus D4's
table is what earns the one unit test (D12).

**D6 — Generation and insertion run in batches of 500 rows, and the number is a stated constant, not
a feel.** F8: 500 rows of seven columns is ~0.12 MiB of request JSON and ~35 ms to generate —
comfortably inside `docs/ARCHITECTURE.md:69`'s ~150 ms rule for the generation step, two orders of
magnitude below F9.2's 8 MiB inbound-queue budget, and a 500-statement (not 100 000-statement)
`op_log.command` row (F9.1). On ClickHouse it is also the width of one generated multi-row `INSERT`
(F2), which is a shape that engine is built for. This is §0.4's fourth owed comment; the constant
lives beside it. Each batch is generated **immediately before** it is sent and released afterwards,
so peak renderer heap is one batch, not N rows (F8's 118 MiB figure is what *not* doing this costs).

**D7 — Each batch is its own op, and a failure stops the run and reports what is already committed.**
Every batch calls `data.mutate` with its own `crypto.randomUUID()` op id, which the dialog keeps in a
ref so the Stop button can call `control.opsCancel(opId)` — closing F4's gap for this feature without
touching `DataView.vue`'s own commit path. On a failure the run stops at that batch and the dialog's
error strip states three things: the server's verbatim message, how many rows were committed before
it (`(batchIndex) * BATCH_SIZE`), and whether the failing batch itself rolled back — read from
`caps.transactions` (`packages/shared/caps.ts:62`), which is `true` for the four SQL kinds and
`false` for ClickHouse (F3). No retry, no resume: the user knows the count and can generate the
remainder.

**D8 — The run is seeded, and the seed is visible and editable.** `faker.seed(n)` before the first
batch and never again, so the whole run is one deterministic stream (F8). The dialog shows the seed
in a field, pre-filled with a fresh random integer per open; the user can pin it to reproduce a run
exactly. This is a genuine feature (reproducible test data) *and* what makes F13's `tests/ui` fixture
possible, which is the better of the two reasons to have it and the reason it is not a hidden
constant.

**D9 — A NOT-NULL foreign-key column is warned about, never guessed at.** F12. The dialog's
pre-flight strip lists, by name: every NOT-NULL FK column with no recipe, every column covered by a
unique index whose recipe is not `sequence`/`string.uuid`/`constant`-free, and every NOT-NULL column
the user has set to *skip*. It is a warning, not a block — the user may know something the catalog
does not (a `constant` FK value that exists) — and pressing Generate anyway produces an ordinary
server error the same way a hand-typed bad insert does.

**D10 — Preview shows the first *five* rows, through the existing `data:preview` op.** The op is
already the right one — synchronous, never touches the server, renders the real dialect statement
(`data.go:127-143`) — and five rows is enough to see the shape without F9.3's unbounded document. The
preview is generated from the same seed as the run, so what it shows is literally the first five rows
that will be written. It renders in the dialog with `CodeMirrorHost … :read-only="true"` and the
`sqlDialectFor` mapping `PreviewCommandPanel.vue:22-24` already uses.

**D11 — The entry point is one `IconButton` in the grid toolbar's existing mutation group, and one
command-palette entry.** `DataToolbar.vue:209-231`, immediately after `add` and before `trash`, so
the two "put rows in" verbs sit together: `icon="wand"` (**[verified here]** a real codicon, and
**[verified in source]** used nowhere else in the renderer — `sparkle` is taken by
`CellEditorView.vue:483`), `data-testid="toolbar-generate-data"`, disabled with a reason-bearing
tooltip when the gate in D1 is false. The dialog itself is `workbench/GenerateDataDialog.vue`, driven
by a `state/fakeData.ts` open/close state and mounted in `App.vue` beside `UploadObjectDialog`
(`App.vue:18`, `:59`) — the established shape for a feature dialog, and the one that keeps
`project/menus.ts`-style callers from having to import a `views/` module. **No native menu item and
no accelerator**: P13 added `view.format` to the seven-file menu/accelerator path because formatting
is a keystroke-frequency editing verb; generating a thousand rows is not, and a command-palette
entry (`shortcuts/state.ts`) is the whole of what this needs.

**D12 — Two unit tests, and only two.** `AGENTS.md`'s bar names "a decision structure large enough
that no one can hold it in their head" — D4's seven-rule table with a ~25-entry name heuristic is
that, and getting rule 2 wrong (generating a value for a `serial` PK) breaks every run on every table
with a sequence. `parseTypeBounds` (D5) is the second: a small lexer over five per-dialect type
grammars with real boundary cases (`Nullable(FixedString(16))`, `Enum8` with a quoted comma,
`int unsigned`, `numeric(20,6)` vs bare `numeric`). Everything else in this phase is a dialog, a
`for` loop and a library call, and gets no test at all.

---

## 5. Implementation order

Six commits. C1 is first and separately revertible because it is the one step whose cost must be
measured before anything is built on it.

### C1 — `chore(deps): @faker-js/faker, in its own lazily-loaded chunk`

- Root `package.json` `devDependencies`: `"@faker-js/faker": "10.6.0"` (exact, like every other
  entry; `devDependencies` per §3 / P1 D1).
- New `frontend/src/views/grid/fakeData/fakerEntry.ts`: the one re-export and the one comment (D2).
- **Measure the emitted chunk before moving on.** `bun run build`, then confirm `dist/assets/` holds
  a **third** `.js` chunk at roughly **444 KB raw / 152 KB gzip** (F7) and that `index-*.js` has not
  grown from its current 1 057 495 B / 334 906 B. A figure well above 152 KB gzip means a locale
  other than `en` was pulled in. Record both numbers in the commit body (P13 C2's own step, F8's
  reason).

### C2 — `feat(grid): a schema-driven recipe for every column`

Pure logic, no UI, no library call at runtime — this is what C4's unit test targets.

- New `frontend/src/views/grid/fakeData/types.ts`: the `Recipe` union (`skip` | `null` | `constant` |
  `sequence` | `faker` with a generator id) and `ColumnPlan { column, recipe, warning? }`.
- New `frontend/src/views/grid/fakeData/typeBounds.ts`: `parseTypeBounds(dataType)` (D5).
- New `frontend/src/views/grid/fakeData/recipes.ts`: the generator-id catalogue (label, the faker
  call it maps to, which `TypeClass`es it is offerable for) and `recipeFor(descriptor, meta)` —
  D4's table — plus `planWarnings(plans, meta)`, D9's three warning classes.

Nothing here imports `@faker-js/faker`: a recipe is an **id**, resolved to a call only in C3.

### C3 — `feat(grid): generate fake rows into the current table`

- New `frontend/src/views/grid/fakeData/generate.ts`:
  - the memoised `await import('./fakerEntry')` (D2),
  - `resolveGenerator(recipe, bounds)` → `(rowIndex: number) => string | null`,
  - `generateBatch(plans, seedState, from, count): MutationRowOp[]` — builds one batch's ops and
    holds nothing beyond them (D6),
  - `runGeneration({connectionId, path, tabId, plans, total, seed, onProgress, signal})` — seed once,
    then loop: generate a batch, `await data.mutate({opId, …})`, report progress, release. Stops on
    the first failure and rethrows an error carrying `committedRows` (D7).
- New `frontend/src/state/fakeData.ts`: the dialog's open/close state, mirroring
  `state/objectStore.ts`'s `uploadDialogState` shape.
- New `frontend/src/workbench/GenerateDataDialog.vue`: `DialogFrame` with the row-count field, the
  seed field (D8), the per-column recipe table, the warning `MessageStrip` (D9), a **Preview**
  disclosure calling `data.preview` with the first five ops (D10), and a footer whose primary button
  becomes a `RunState` + Stop while a run is in flight (D7). On success it closes and calls
  `reloadAfterMutation(tabId)` (`views/grid/state.ts:176-191`) so the grid, the pager and the count
  chip all correct themselves through the existing path.
- `frontend/src/App.vue`: mount it beside `UploadObjectDialog` (`:59`).
- `frontend/src/views/grid/DataToolbar.vue`: the `wand` `IconButton` (D11).
- `frontend/src/shortcuts/state.ts`: a `data.generate` palette entry.

### C4 — `test(unit): the fake-data recipe table and the declared-type bound parser`

`apps/kira-studio/tests/unit/fake-data-recipes.spec.ts`. D12's two subjects, no DOM, no faker import:

- `recipeFor`: a `generated` column skips; a `serial` PK (`defaultExpr: "nextval('…')"`) skips; a
  no-default integer PK gets `sequence`; a no-default text PK gets `string.uuid`; a nullable FK
  column skips and a NOT-NULL one comes back unset with a warning; `email`/`created_at`/`price` hit
  their name heuristics; a `varchar` column named `id` does **not** get `sequence`; every
  `typeClass` has a fallback and `other` skips.
- `parseTypeBounds`: `varchar(50)`, `character varying(50)`, `numeric(20,6)`, bare `numeric`,
  `int unsigned`, `bigint`, `Nullable(FixedString(16))`, `Enum8('a' = 1, 'b,c' = 2)` (the quoted
  comma), and an unrecognised type returning empty bounds rather than throwing.

A one-line comment above the file states which rule it guards, per `AGENTS.md`.

### C5 — `test(postgres): a multi-row insert plan commits atomically`

`apps/kira-studio/internal/adapters/postgres/postgres_test.go`, one new function beside the existing
mutation tests (`:594-940`). This is the adapter-tier half the phase brief asks for, and it belongs
under the conformance-suite exemption (`AGENTS.md`'s "per-capability coverage … even where it reads
like a CRUD round-trip"), not the general unit-test bar:

- Build a 200-op insert plan against `app.customers` (`0001_seed.sql:224-227` — a `serial` PK, a
  NOT-NULL `name`, a nullable FK `region_id`), omitting `id` entirely, and assert `AffectedRows ==
  200` and that a follow-up `Count` reflects it — the proof that D4 rule 2's "skip the serial PK"
  produces a plan the server actually accepts.
- Then a 200-op plan whose 150th op names an unknown column, and assert the **whole** batch rolled
  back (a `Count` unchanged from before) — F3's transactional half, at batch scale rather than
  `TestPostgres_MutateRowCountConflictRollsBack`'s two-op scale.

No new test for ClickHouse's `renderInsert`: `clickhouse/mutate.go:40-68` already collapses a
multi-op plan by construction and `clickhouse_test.go` already exercises `Mutate`; a second
assertion of the same union-and-pad rule would be the duplication `AGENTS.md` says to prune.

### C6 — `test(ui): the fake-data generator dialog`

The spec described in §6.1. New file, `apps/kira-studio/tests/ui/fake-data.spec.ts`.

**`docs/ARCHITECTURE.md`:** two edits are genuinely owed, and neither is about the dialog.
1. The Stack table's *Renderer build* row (`:28`) says "One dynamically-imported chunk as of P13".
   C1 makes that two — amend the count and name the second.
2. The UI-architecture section's write-model paragraph (`:562-568`) states that SQL table writes
   accumulate in a per-tab pending-change set and reach the database only at *Commit*. After C3 that
   is no longer the only path: add one clause naming generation as a staging-free, batched caller of
   the same `mutate` op, with D3's reason. Everything else — the recipe table, the dialog, the batch
   size — is per-feature detail that belongs in this plan.

---

## 6. Verification

### 6.1 The `tests/ui` spec

`tests/ui/` drives the real built bundle in real WebKit with both wire planes mocked, which is the
right tier: generation is renderer work plus ordinary `data:preview`/`data:mutate` calls that the
mock already speaks (`ipc/support/types.ts:49-60`'s `LogicalPortResponse` has both `mutate` and
`preview` kinds, added by `mutations.spec.ts`'s own port). The pattern to follow is
`tests/ui/mutations.spec.ts` end to end — same fixture (`compositePkConnectAndOpen`,
`postgresFixture.ts:409`), same `relaunch({control, stream})` shape, same
`[data-testid="grid-cell"][data-row=…][data-column=…]` assertions.

**No new fixture capture is needed**, which matters: `AGENTS.md` records that the one-off capture
tool does not exist in this tree right now, so a phase needing a fresh capture would be blocked.
`COMPOSITE_PK_META` (`postgresFixture.ts:353-397`) already carries the full `ObjectMeta` — two
NOT-NULL integer PK columns with `defaultExpr: null`, one nullable `text`, and a real unique PK index
— which is exactly the shape D4 rules 3 and 5 and D9's warnings need.

**F13 governs the whole design of this spec**: the mock matches the exact `data:mutate` payload, so
scenarios 2-4 set every column's recipe to `sequence` or `constant`, whose output is fixed by the app
and not by faker's RNG. Faker-backed *content* is covered by C4's unit test; this tier covers the
*wiring*.

Five scenarios:

1. **The button's gate.** On the read-only connection the fixture already builds
   (`mutations.spec.ts:14-18`'s `RO_CONNECTION_SUMMARY`), assert
   `[data-testid="toolbar-generate-data"]` is present and **disabled**, and that its tooltip names
   the read-only reason — the same shape the existing `toolbar-add-row` assertion takes.
2. **The default plan is schema-derived.** Open the dialog on `app.composite_pk` and assert the two
   PK columns propose `sequence` (D4 rule 3 — no default in the fixture's meta) and `name` proposes a
   text recipe, and that the warning strip names `tenant_id`/`entity_id` as unique-index-covered.
   This is the assertion most likely to be deleted later by someone who thinks the strip is noise, so
   its comment must say what it guards.
3. **Preview shows real SQL for the first rows.** Set both PKs to `sequence` starting at 100 and
   `name` to a `constant`, set the count to 3, open Preview, and assert the panel's text contains
   `INSERT INTO "app"."composite_pk"` — answered by one `DATA_OP.preview` snapshot whose payload is
   the exact three ops (fully determined by the two sequences and the constant).
4. **Generate commits and the grid reloads.** Press Generate; assert exactly one `DATA_OP.mutate`
   went out (3 rows ≪ D6's 500-row batch) with the same three ops, that the dialog closed, and that
   the grid now shows the reloaded page — answered by the `invalidate` + `read` snapshot pair
   `mutations.spec.ts:110-150` already establishes as the `reloadAfterMutation` sequence.
   `mockStream`'s `ops()` handle (`mockStream.ts:214`) is what asserts the request count, so a
   regression that sent one mutate per row would fail here rather than pass quietly.
5. **A failed batch reports what was committed.** A `DATA_OP.mutate` snapshot carrying
   `error: { code: 'E_QUERY', message: 'duplicate key value violates unique constraint
   "composite_pk_pkey"' }` (the real captured text `mutations.spec.ts:180-186` already uses); assert
   the dialog stays open, the strip shows that message verbatim, and it also states the committed-row
   count and that the failed batch rolled back (D7 — `caps.transactions` is `true` for this
   connection).

**Not covered by any tier, and stated rather than papered over:** the batching boundary itself. A
1 500-row run producing three `data.mutate` calls would need three exact-payload snapshots of 500 ops
each — a ~1 MB spec file asserting arithmetic. The batch loop's own boundary behaviour is instead
covered by inspection plus §6.2's manual run; if that ever proves insufficient, the honest fix is a
unit test over `runGeneration` with `data.mutate` faked, not a `tests/ui` fixture.

### 6.2 Measurements to take, and record

Three, all cheap, all required by the discipline this phase inherits rather than optional colour:

1. **The emitted chunk** (C1's own step): raw and gzip bytes of the new `dist/assets/*.js` against
   F7's 444 194 / 152 546 expectation, plus a confirmation that `index-*.js` did **not** grow.
2. **Cold-import and warm-generate latency on the WebKit tier**, since F8's numbers are V8's. Inside
   scenario 3, bracket the first Preview press with `performance.now()` and log it (do **not** assert
   a threshold — `docs/PERF.md:143-165` is explicit that this tier's timings carry a scheduling
   artefact and that new hard budgets on it are earned). If the cold import is within an order of
   magnitude of F8's 160.8 ms, D6's batch sizing stands.
3. **One real 5 000-row run against a real Postgres container**, by hand, through
   `tests/e2e-real`'s own `-tags server` build or a local `bun run dev`: confirm ten batches go out,
   the Stop button cancels mid-run, and — the specific thing F9.1 predicts — that the resulting
   `op_log` rows each carry a 500-statement `command`, not one 5 000-statement row. If that text
   proves uncomfortably large even at 500, D6's constant is the knob and OQ-4 is the real fix.

### 6.3 What must not regress

- `tests/ui/mutations.spec.ts`, `data-view.spec.ts`, `cell-editor.spec.ts` and `interaction.spec.ts`
  all pass unchanged. C3 adds a sibling button to `DataToolbar.vue` and touches nothing in
  `pendingChanges.ts` or `DataGrid.vue`; a failure in any of these means something moved that should
  not have.
- `dist/assets/index-*.js` does not grow. If it did, the dynamic import collapsed back into the main
  chunk and D2's whole justification is gone.
- `tests/ui/perf.spec.ts` and `budgets.spec.ts` are untouched by construction: nothing in this phase
  runs on the scroll or keystroke path, and the faker chunk is not even fetched until the dialog
  opens.
- `go test ./apps/kira-studio/internal/adapters/postgres/...` passes with C5 added — including the
  existing `TestPostgres_MutateCancelledMidTransactionDoesNotLeakOpenTransaction`
  (`postgres_test.go:792`), which C5's 200-op plan exercises far harder than the two-op plans it was
  written against.

### 6.4 Running the rest here

```
bun run lint && bun run typecheck && bun run build
bun run test:unit
bun run test:ui
go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...
```

`typecheck:web` is the check that `@faker-js/faker`'s types resolve under
`moduleResolution: "Bundler"` — **[verified here]** the package is `"type": "module"` with sibling
`.d.ts` files and a `./locale/*` exports entry, so this should be clean on the first build, but it is
the thing worth watching. **[verified here]** this container has no Playwright browsers cached, so
`bunx playwright install webkit` plus the system libraries its post-install warning names must run
before the first `test:ui`. C5 needs Docker for its Postgres container — `AGENTS.md`'s Docker section
covers starting `dockerd` and pulling `postgres` through `mirror.gcr.io/library/`.

---

## 7. Acceptance checklist

1. A **Generate data…** button appears in the data grid's toolbar mutation group for postgres,
   mariadb, mysql, sqlite and clickhouse connections; it is disabled with a reason-bearing tooltip on
   a read-only connection, and it exists on no other view kind.
2. `@faker-js/faker` is in the root `devDependencies` at an exact version, is imported **only** by
   `views/grid/fakeData/fakerEntry.ts`, and that module is reached only through an `await import()`.
3. `bun run build` emits a third JS chunk of roughly 444 KB raw / 152 KB gzip, and `index-*.js` is no
   larger than it was before the phase. Both figures are in C1's commit body.
4. Opening the dialog on a table proposes a recipe per column derived from that column's real schema:
   generated and serial-PK columns are skipped, a no-default PK gets a unique-by-construction recipe,
   a `varchar(n)` column's text is clamped to `n`, an `Enum8` column picks a real member, and every
   proposal is overridable.
5. A NOT-NULL foreign-key column, a unique-index-covered column with a non-unique recipe, and a
   skipped NOT-NULL column each produce a named warning before anything runs — and Generate is still
   pressable.
6. Preview renders the real dialect `INSERT` text for the first five rows through the existing
   `data:preview` op, and those five rows are the ones the run will actually write.
7. Generating N rows sends `ceil(N / 500)` `data.mutate` calls, each with its own op id, with a
   working Stop button and visible progress; nothing is ever staged into `pendingChanges.ts` and
   `DataGrid.vue`'s insert `v-for` never renders a generated row.
8. A failed batch leaves the dialog open showing the server's verbatim message, the number of rows
   already committed, and whether the failing batch rolled back — read from `caps.transactions`.
9. On success the grid reloads through `reloadAfterMutation`, the count chip goes stale, and sibling
   tabs on the same table reload.
10. `tests/unit/fake-data-recipes.spec.ts` covers C4's cases; `tests/ui/fake-data.spec.ts` covers
    §6.1's five scenarios; C5's two Postgres cases pass against a real container; every other spec in
    every tier passes unchanged.
11. `docs/ARCHITECTURE.md`'s Renderer-build row names both dynamic chunks, and its write-model
    paragraph names generation as a staging-free batched caller of the same `mutate` op.
12. `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
    `go build`/`go test ./apps/kira-studio/internal/...` all clean.

---

## 8. Open questions, handed forward

- **OQ-1 — Generating documents into a MongoDB collection.** F5: `Describe` returns no columns, but
  `Definition` already parses a `$jsonSchema` validator into a field table
  (`mongo/definition.go:43-60`), and the document view's insert path
  (`views/documents/mutations.ts:19-24`'s `$document` sentinel) is the same `mutate` op. So the shape
  exists: read the validator, propose a recipe per declared field, fall back to inferring fields from
  the currently loaded page when there is no validator. It needs its own dialog surface on
  `DocumentView.vue` and its own honest answer for a collection with neither a validator nor a loaded
  page, which is why it is not folded in here.
- **OQ-2 — Foreign-key-valid values.** F12 gives the whole mechanism: `ForeignKeyMeta.ReferencedPath`
  is a `data.read`-shaped path and `ReferencedColumns` is the projection, bounded at
  `page.MaxPageSize` (10 000) candidates. The open questions are cost (one extra read per FK per run)
  and honesty about sampling only the first page of a large parent table. Worth doing; worth doing
  deliberately.
- **OQ-3 — Staged inserts are not virtualization-safe.** F1. `DataGrid.vue:1846`'s `v-for` and
  `pendingChanges.ts:27`'s `reactive` store are fine for a handful of hand-added rows and wrong for
  any programmatic producer. P15 goes around them; a later phase that wants "generate rows into the
  pending set so I can edit them before committing" has to fix them first, and P5's own audit table
  (`P5-ram-usage.md:442`) should be corrected in the same breath, since it currently reads
  "Non-virtualised lists: None".
- **OQ-4 — `op_log.command` is unbounded.** F9.1: every SQL adapter's `Mutate` renders a second,
  literal copy of every op and stores the join as one string, which `host.go:153-160` broadcasts and
  `repos/ops.go:49` persists, with no cap anywhere. D6's batch size keeps P15 clear of it, but the
  underlying edge belongs to whoever owns the op log — a length cap with an honest
  "… and N more statements" tail is the obvious fix, and it wants to be one change across all four
  SQL adapters plus the panel, not a P15 side effect.
- **OQ-5 — Server-side generation, for the case P15 deliberately does not serve.** §3's numbers:
  `gofakeit` v7.16.0 is current and maintained, and at millions of rows an `INSERT … SELECT`
  formulation is orders of magnitude better than any renderer→wire→adapter path can be. The reason it
  is not P15 is that it needs a second mutation path. If a future phase wants it, the cheapest honest
  shape is a new `Adapter` method behind a new `Caps` flag with a per-adapter `E_UNSUPPORTED`
  fallback onto exactly the batched client-side path P15 builds — so P15 is the fallback that makes
  that phase safe to attempt, not work it would throw away.
- **OQ-6 — For P19.** F13: `tests/ui/fake-data.spec.ts` deliberately uses non-faker recipes for its
  exact-payload assertions specifically so a faker version bump does not break it. If a later change
  makes that spec assert faker-generated content, P19's dependency bump will start failing it on RNG
  drift, and the fix is to re-capture the expected values, not to pin faker. Recorded so nobody
  concludes the bump broke the feature.
