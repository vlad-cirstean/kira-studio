# P22c — completion driven by the schema metadata the app already caches

> **What this phase is.** Part 3 of `docs/v1.2/SPEC.md`'s P22 row (see
> `plans/P22-shared-primitives-and-tokens.md` §0.1 for the split). It owns the row's one
> architectural item, and it is the only one of the three that touches Go, the wire, and the SQLite
> schema — which is why it has its own document and its own commit sequence.
>
> **This item is a correction of a misunderstanding, not a regression.** P19 D14-D16 shipped exactly
> what P19's own plan chose: table-name completion from the project tree's cached node list, plus a
> **"Fill from connection"** button that stages a hand-editable DDL document the user must then
> Save. The row says that shape is wrong — completion should be driven **automatically** by the
> schema metadata the app already fetches and caches, with no document and no button. The
> constraint P19 was working under — *the language/completion layer never opens a connection of its
> own* — **stands and is not reopened**; this plan keeps it and satisfies the row inside it.
>
> **Base commit.** `b52fd72` (branch `claude/feature-v1-2`). Every `file:line` points at it.
>
> **Sequencing.** Lands after `plans/P22-shared-primitives-and-tokens.md` (whose D8 owns the
> completion popup's own look) and independently of `P22b-api-and-studio-polish.md`. It is also the
> phase `docs/v1.2/SPEC.md`'s **P24** row exists to make cheap — P24 audits the metadata cache's
> staleness rules; this phase adds one more consumer of the same cache and must not prejudge P24's
> findings, which §5 records.

---

## 0. Scope

### 0.1 The item

> *"table/column completion must be driven by the schema metadata this app already fetches and
> caches from the live connection for the project tree and other Studio surfaces, not by a
> hand-pasted 'Schema (DDL)' document — P19's 'Fill from connection' button, which stages that same
> cached metadata into a document a user must remember to open and click, was the wrong shape for
> what was asked; the live cache should back completion directly and automatically wherever a
> connection is already open, with no separate manual step, and without ever having the language
> layer connect to the real database itself."*

| Findings | Decisions | Commits |
|---|---|---|
| F1-F12 | D1-D9 | V1-V12 |

### 0.2 Corrections this investigation makes to the row's own premises

1. **"the schema metadata this app already fetches and caches … for the project tree" — the tree's
   cache does not contain columns, and cannot** (F3, F4). `project/state/tree.ts:355-357` records
   P19 D5: *"a table/view/matview is a leaf regardless of what a cached node's own `hasChildren`
   says — its columns moved into the definition view."* So the tree's own `treeState.children` is a
   **relation-name** cache and nothing more, which is exactly why P19 D14 could only deliver table
   names from it. The metadata that *does* carry columns is a different cache — the SQLite-backed
   `metadata_cache` table's `describe` payload (F5) — and it is populated **per object, on demand**,
   only for objects a user has actually opened (F6). Neither cache, as it stands, can serve
   "complete every column of every table in this schema".
2. **"the live cache should back completion directly … wherever a connection is already open" — the
   cache is not live, it is durable and connection-independent** (F5, F7). `metadata_cache` is a
   real SQLite table with a `fetched_at` stamp and a 200-row-per-connection cap; `tree.Service`
   serves a hit **before** `requireConnected` is consulted (`tree/service.go:99-107`), so cached
   metadata is readable with no connection at all. That is strictly better than the row assumes and
   it is what makes D3 possible.
3. **"schema-aware SQL/**Mongo** completion" — Mongo has no field-level schema to be aware of**
   (F11). `internal/adapters/mongo/adapter.go:191` returns `Columns: []model.ColumnMeta{}` — the
   adapter deliberately reports no columns, because a Mongo collection has none. Mongo's own
   "schema" is *sampled from loaded documents*, which the app already does
   (`mongoFilterCandidates`, `DocumentView.vue:201-204`). D8 serves the Mongo half from that, and
   says plainly that it is a different mechanism rather than pretending one design covers both.

### 0.3 Not in scope

- **Reopening "the language layer never opens its own connection."** v1.1's P18 row set it, P19 F22
  restated it, and the P22 row explicitly says it *"stands"*. Every fetch this plan adds is issued
  by a **view**, on tab activation, through the same `control.tree*` bridge the project tree uses —
  never by a `CompletionSource`, and never on a keystroke. D5 states the rule as code.
- **The metadata cache's staleness policy.** That is `docs/v1.2/SPEC.md`'s P24 row, sequenced after
  this one. This phase adds a consumer and inherits whatever staleness rules exist; it neither
  tightens nor loosens them. §5 records the two places P24 will want to look.
- **Removing the DDL document feature.** D7 keeps it as a deliberate override; only the **staging
  button** P19 D15 added goes.
- **Cross-database or cross-schema completion.** A console is opened under one container and
  completes that container. Qualifying `other_schema.t` is OQ-3.

---

## 1. Findings

### F1 — What drives SQL completion today, end to end (the P19 shape)

1. `views/console/ConsoleView.vue:139` → `consoleCompletionSources(kind, connectionId, path,
   ddlSchema.value, database)`.
2. `views/console/completion.ts:171-190` — for a SQL kind, computes
   `relations = consoleRelationNames(connectionId, path)` and calls
   `sqlCompletionSources(dialect, schema ?? EMPTY_DDL_SCHEMA, database, relations)`.
3. `views/console/sqlLanguageService.ts:51-74` — three branches:
   - `schema.tables.length > 0` → `schemaCompletionSource(…)` + `keywordCompletionSource` +
     `relationCompletionSource(relations)`;
   - else `relations.length > 0` → `relationCompletionSource` + `keywordCompletionSource`;
   - else `undefined` (lang-sql's own language-data keywords take over).
4. `schema` is `ddlSchemaFor(connectionId, dialect)` (`state/schemas.ts:81-88`) — a `DdlSchema`
   parsed by `views/console/ddl.ts`'s `parseDdl` from **the connection's stored DDL text**.
5. `relations` is `consoleRelationNames` (`completion.ts:52-72`) — the console's own container path
   walked back to the last `database:`/`schema:` segment, then
   `treeState.children[rowKey(connectionId, containerPath)]` filtered to `table`/`view`/`matview`,
   mapped to `.name`.

So today: **table names come free from the tree's cache; columns come only from a hand-supplied
document.** The row's complaint is about step 4.

### F2 — `relationCompletionSource` is name-only and position-gated (and correctly so)

`sqlLanguageService.ts:26-37`:

```ts
const RELATION_POSITION_RE = /\b(from|join|update|into|table)\s+$/i;
…
return { from: word.from, options: relations.map((label) => ({ label, type: 'class' })) };
```

A bare identifier position gets nothing from it — deliberately, per its own comment (*"offering
table names at a bare identifier position … would flood it"*). It cannot offer columns, cannot
resolve an alias (`select u.| from users u`), and carries no type information. All three are things
`@codemirror/lang-sql`'s `schemaCompletionSource` does natively **given a namespace object**, which
is the whole point of D4.

### F3 — The project tree holds relation names and nothing below them

`project/state/tree.ts:59` — `treeState.children: Record<rowKey, TreeNode[]>`, populated by
`control.treeChildren` for every node the user has expanded. `:355-357` records P19 D5: a
table/view/matview is a **leaf**; `NodeKind` still lists `'column'`
(`packages/shared/domain/tree.ts:16`) but nothing expands into one any more, because columns moved
into the definition view. P19 F25 found the same thing and it is why P19 D14 is a two-layer design.

### F4 — `TreeService.Definition` carries DDL text, per object, on demand

`internal/bridge/tree.go:41-46` → `tree.Service.Definition` → `model.ObjectDefinition`
(`internal/storage/model/definition.go:43-57`) whose `Statements []string` is, for Postgres,
`CREATE SEQUENCE` / `CREATE TABLE <qname> (…)` / `ALTER TABLE … ADD CONSTRAINT …` /
`CREATE VIEW …` / `COMMENT ON …` (`internal/adapters/postgres/definition.go:200-272`) — the exact
vocabulary `ddl.ts:327-348`'s `parseDdl` consumes. That is what P19 D15's "Fill from connection"
button loops over (`state/schemas.ts:157-188`): **one bridge call per relation**, concatenated into
the DDL document.

That loop is the shape the row rejects, and its cost is the reason: for a 200-table schema it is 200
round trips, each of which is itself several engine queries, all to produce a text document that is
then re-parsed by a hand-written DDL parser to recover structure the adapter already had.

### F5 — There **is** a real, durable, structured metadata cache, and it already holds columns

`internal/tree/service.go` is *"L1 cache-aside for children/describe/definition over
`internal/storage/repos.MetadataCacheRepo`"* (`:1-4`). Three kinds, one row per `(connection, path)`:

```go
// storage/repos/metadata_cache.go:53-56
// Put merges payload into the existing row's {children?, describe?, definition?} object (the
// unique index is (connection_id, path) — kind is not part of the key …)
```

and `Describe` (`tree/service.go:131-156`) returns `model.ObjectMeta`
(`storage/model/tree.go:73-85`):

```go
type ObjectMeta struct {
    Path, Kind, Name, QualifiedName string
    Columns      []ColumnMeta        // {Name, Position, DataType, Nullable, DefaultExpr, IsPrimaryKey, Comment}
    PrimaryKey   []string
    ForeignKeys  []ForeignKeyMeta    // {Name, Columns, ReferencedPath, ReferencedColumns, …}
    ReferencedBy []ForeignKeyMeta
    Indexes      []IndexMeta
    RowEstimate  *int
    Comment      *string
}
```

**`ColumnMeta` is precisely what a completion source needs** — a name, a rendered type
(`format_type(...)` on Postgres, `postgres/catalog.go:219-244`), nullability, PK-ness and a comment
— and it is already parsed, validated (`model.ValidateObjectMeta`) and persisted. Nothing about it
is a text document.

### F6 — But `describe` is only cached for objects a user has actually opened

`control.treeDescribe`'s callers, by grep across `frontend/src`:

- `views/grid/state.ts:90` — once per data tab, when a table is opened.
- `views/definition/state.ts:61` — when a Definition tab is opened.

So a fresh connection where the user has expanded a schema but opened no table has **zero**
`describe` rows. Column completion driven off the existing per-object cache alone would be empty
exactly when it is most wanted (a new console on a new connection), which is the failure mode P19
D16's hint strip existed to explain and which the row is asking to remove rather than explain.

### F7 — A cache hit is served before the connection is even checked

`tree/service.go:131-140`:

```go
func (s *Service) Describe(connectionID, path string, refresh bool, tabID *string) (DescribeResult, error) {
	if !refresh {
		if raw, ok := s.getCached(connectionID, path, "describe"); ok { … return …"cache"… }
	}
	if err := s.requireConnected(connectionID); err != nil { return DescribeResult{}, err }
	…
}
```

The same shape in `Children` (`:99-107`) and `Definition` (`:159-167`). **So cached metadata is
readable with no live connection at all**, and a completion layer reading it is not "connecting to
the database" in any sense — it is reading rows out of `kira.db`. This is what makes the row's ask
satisfiable *inside* the constraint rather than in tension with it.

### F8 — The cache is capped at 200 rows per connection, LRU by fetch time

`storage/repos/metadata_cache.go:13-16` and `:85-95`:

```go
maxMetadataRowsPerConnection = 200
…
DELETE FROM metadata_cache WHERE connection_id = ? AND path NOT IN (
  SELECT path FROM metadata_cache WHERE connection_id = ? ORDER BY fetched_at DESC, rowid DESC LIMIT ?)
```

Rows of **all three kinds share that budget** (one row per path, payload merged). So a design that
writes one cache row *per relation* would, on a 300-table schema, evict the tree's own `children`
rows to make space for column data — and then evict the column data again on the next expansion.
**Any schema-wide design must be one row, not N.** This single fact decides D2's cache key.

### F9 — Every SQL engine can list a whole schema's columns in one query

Checked against each adapter's existing catalog code, which already issues the per-object form:

| Engine | Per-object query today | Schema-wide form |
|---|---|---|
| Postgres | `pg_attribute` joined to one `pg_class` OID (`postgres/catalog.go:219-244`) | the same query with `WHERE n.nspname = $1` and no `relname` filter, joined back to `pg_class.relname` |
| MySQL / MariaDB | `information_schema.columns` for one table (`mysqlfamily/`) | drop the `TABLE_NAME` predicate, keep `TABLE_SCHEMA` |
| ClickHouse | `system.columns` for one table | `WHERE database = ?` |
| SQLite | `pragma_table_info(<t>)` | `SELECT m.name AS table_name, p.* FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table','view')` — one query, documented `pragma_table_info` table-valued form |

So the schema-wide fetch is **one round trip per container**, not one per relation — two to three
orders of magnitude cheaper than P19 D15's loop, and it returns the same `ColumnMeta` shape the
per-object path already produces. That is the finding the whole design rests on.

### F10 — `@codemirror/lang-sql`'s `schemaCompletionSource` wants exactly this shape

`sqlLanguageService.ts:57-62` already calls it with
`{ dialect, schema: toSqlNamespace(schema), defaultSchema: defaultSchemaFor(...) }`, where
`toSqlNamespace` (`views/console/ddl.ts`) turns a parsed `DdlSchema` into lang-sql's
`{ [tableOrSchema]: string[] | {self, children} }` namespace. Given a namespace it delivers, for
free: table names at a relation position, **column names after `table.`**, **alias resolution**
(`select u.| from users u`), and schema-qualified paths. So the target of this phase is not "write a
completion source" — it is **"produce that namespace from `ColumnMeta` instead of from parsed DDL
text"**, which is a pure function over data the app already has a validated struct for.

### F11 — Mongo has no column metadata, by design, and already samples fields where it matters

`internal/adapters/mongo/adapter.go:191` — `Columns: []model.ColumnMeta{}, PrimaryKey: nil`. A
collection has no declared field set, so nothing is fetched and nothing is cached.

What the app *does* have: `views/documents/DocumentView.vue:201-208` binds `filterCandidates` /
`sortCandidates` to `mongoFilterCandidates(tabId)` / `mongoSortCandidates(tabId)` — field names
derived from the **documents currently loaded in that tab's page**, recomputed on `pageVersion`.
That is the only honest source of a Mongo field vocabulary, and it exists.

The Mongo console, meanwhile, gets collection names, methods, `$` operators and BSON constructors
(`completion.ts:75-116`) and **no field names at all**.

### F12 — What the DDL document is, after this phase, and what depends on it

`state/schemas.ts` exports, at `b52fd72`: `ensureDdl`, `saveDdl`, `ddlSchemaFor`,
`connectionRelationsFromTree`, `fillDdlFromConnection` (P19 D15's button),
`isNoSchemaHintDismissed` / `dismissNoSchemaHint` (P19 D16's strip), and `openSchemaDialog`.
Consumers of the parsed `DdlSchema` are **three**, not one: completion
(`sqlLanguageService.sqlCompletionSources`), diagnostics (`views/console/lint.ts` via
`consoleLintSource(kind, ddlSchema)`, `ConsoleView.vue:149`) and hover
(`sqlHoverSource(dialectObject, ddlSchema)`, `ConsoleView.vue:156`).

**So whatever replaces the document as completion's source must be offered to all three**, or the
console will complete a column its own hover cannot describe and its own linter flags as unknown —
the exact "one supply, three consumers" property P19 D15's own rejected-alternative note called out
as the reason not to bolt a second source onto completion alone.

---

## 2. Decisions

### D1 — A schema-wide column fetch becomes a first-class adapter capability (F9)

`internal/adapters`' tree-operation surface gains one method beside `Children`/`Describe`/
`Definition`:

```go
// SchemaColumns returns every relation in one container (a database or schema node) together with
// its columns, in ONE round trip. It is Describe's schema-wide sibling and returns the same
// ColumnMeta values Describe does — never a second, parallel column shape.
//
// Indexes, foreign keys, referencedBy, row estimates and comments are deliberately absent: this
// exists to back completion/diagnostics/hover over a whole container, and fetching a schema's
// entire constraint graph to spell a column name is the cost this method exists to avoid.
// Describe stays the per-object, full-fidelity call.
SchemaColumns(ctx context.Context, path model.NodePath, op *adapters.OpCtx) ([]model.RelationColumns, error)
```

with

```go
// storage/model/tree.go, beside ObjectMeta
type RelationColumns struct {
    Name    string       `json:"name"`     // the relation's own name, unqualified
    Kind    string       `json:"kind"`     // "table" | "view" | "matview"
    Columns []ColumnMeta `json:"columns"`  // ObjectMeta's own element type, reused verbatim
}
```

- **`caps.go` gates it.** A kind that cannot serve it (mongo, redis, kafka, sqs, s3) reports the
  capability false and the whole feature degrades to today's behaviour — `adapters/caps.go` is
  already how the UI learns what an engine can do (`docs/ARCHITECTURE.md`: *"the UI reads only
  Caps"*), so this needs no per-kind branching anywhere above the adapter.
- **Five implementations**, each a widened form of a query that file already contains (F9), landing
  as one commit per engine.
- **The conformance suites cover it per adapter**, which is `AGENTS.md`'s explicit exemption from
  the unit-test bar: *"nothing else exercises a Go adapter capability by capability."*

### D2 — One cache row per container, under the existing `metadata_cache` (F5, F8)

`tree.Service` gains `SchemaColumns(connectionID, path string, refresh bool)` with the **identical**
cache-aside shape its three siblings have — cached read first, `requireConnected` second, backend
third, `meta.Put` on success:

```go
func (s *Service) SchemaColumns(connectionID, path string, refresh bool) (SchemaColumnsResult, error) {
    if !refresh {
        if raw, ok := s.getCached(connectionID, path, "columns"); ok {
            var rels []model.RelationColumns
            if err := json.Unmarshal(raw, &rels); err == nil && model.ValidateRelationColumns(rels) {
                return SchemaColumnsResult{Relations: rels, Source: "cache"}, nil
            }
            _ = s.meta.Drop(connectionID, path)
        }
    }
    …
    _ = s.meta.Put(connectionID, path, "columns", encoded)
}
```

Three properties, each deliberate:

- **A fourth `kind` in the existing payload object, not a new table.** `MetadataCacheRepo.Put`
  merges by kind into one `(connection_id, path)` row (`metadata_cache.go:53-56`), so a container's
  `children` list and its `columns` list share **one row** — the container the tree already caches
  children for. **Zero net rows added**, so F8's 200-row budget is untouched and no eviction
  pressure is created. This is the single most important consequence of F8 and the reason the design
  is keyed on the container rather than on each relation.
- **The 4 MB payload ceiling** (`metadata_cache.go:14`) is the real limit, not the row count. A
  1000-column schema serialises to roughly 100-200 KB; a genuinely enormous one exceeds 4 MB, is
  logged and **not cached** — `Put`'s existing behaviour, which degrades to "fetched each time"
  rather than failing. Named, not fixed: OQ-4.
- **`refresh` is plumbed but not called on a timer.** Invalidation rides entirely on the existing
  paths — `Service.Invalidate` (`tree/service.go:186-193`) already drops a whole connection's rows,
  and `connections.OnMetadataInvalidated` already broadcasts a reconnect. Whether that is *enough*
  is P24's question, not this phase's (§5).

### D3 — One bridge method, one frontend store, filled on tab activation (F7)

**Bridge.** `internal/bridge/tree.go` gains `SchemaColumns(args TreeDescribeArgs)` — the same
four-field args struct `Describe` and `Definition` already share (`tree.go:26-32`). Bindings are
regenerated with `wails3 task common:generate:bindings` (`AGENTS.md`: `-names` is load-bearing).

**Frontend store.** New `state/schemaColumns.ts` — *not* under `views/`, because three different
views will read it and `views/<kind>/*` may not import another `views/<kind>/*` (`biome.json`), and
because `state/` is where `schemas.ts` (its predecessor) already lives:

```ts
// Keyed by rowKey(connectionId, containerPath) — the SAME key project/state/tree.ts uses for its
// own children cache, so the two never disagree about what "this container" means.
export const schemaColumnsState = reactive({ byContainer: {} as Record<string, RelationColumns[]> });

/** Idempotent, single-flight, fire-and-forget. Called on tab activation; never from a
 *  CompletionSource, never on a keystroke (D5). Resolves from the Go-side cache with no
 *  connection when one is cached (P22c F7), and is a no-op when the container is already loaded
 *  or a fetch for it is in flight. */
export async function ensureSchemaColumns(connectionId: string, containerPath: string): Promise<void>;
```

**Who calls it, and when.** Exactly one place per surface, all of them a view's own lifecycle:

| Caller | When |
|---|---|
| `views/console/ConsoleView.vue` | `onMounted` and on `watch(() => props.tab.path)` — resolving the container the same way `consoleRelationNames` already does |
| `views/grid/state.ts`'s data-tab load | after its existing `treeDescribe`, for the table's own container — so opening a table warms the console that will be opened beside it |
| `views/documents/DocumentView.vue` | **not** — Mongo is D8's mechanism, not this one |

**Invalidation.** `state/schemaColumns.ts` subscribes to the same broadcast `project/state/tree.ts`
already listens to for metadata invalidation and clears the affected connection's entries. One
subscription, mirroring an existing one — not a second invalidation mechanism.

### D4 — `sqlCompletionSources` takes a namespace, and the DDL document becomes an override layer (F1, F10)

`views/console/sqlLanguageService.ts`'s signature becomes:

```ts
export function sqlCompletionSources(
  dialect: SqlDialect,
  schema: DdlSchema,                       // the hand-authored document, still first
  database: string | null | undefined,
  relations: readonly string[],            // the tree's own names (P19 D14) — still the last resort
  cached: readonly RelationColumns[],      // P22c: the metadata cache's own columns
): readonly CompletionSource[] | undefined
```

with a **new pure function beside `toSqlNamespace`**:

```ts
/** RelationColumns[] -> lang-sql's namespace object, the exact shape toSqlNamespace already
 *  produces from a parsed DdlSchema — so schemaCompletionSource cannot tell which supply it got,
 *  and alias resolution / `table.` completion / qualified paths all work identically. */
export function namespaceFromCached(relations: readonly RelationColumns[]): SQLNamespace;
```

Precedence, in one place, stated once:

| Available | Sources, in order |
|---|---|
| a DDL document with tables | `schemaCompletionSource(document namespace)`, `keywordCompletionSource`, then `relationCompletionSource(relations)` — **unchanged from P19** |
| no document, cached columns | `schemaCompletionSource(namespaceFromCached(cached))`, `keywordCompletionSource` |
| no document, no cached columns, tree relations | `relationCompletionSource(relations)`, `keywordCompletionSource` — **unchanged from P19 D14** |
| none of the above | `undefined` — **unchanged** |

**The document still wins.** A user who has deliberately pasted a schema (a read-replica they cannot
introspect, a schema they are designing before it exists) keeps getting exactly what they get today.
The cache is what fills the case that was previously empty — which is the whole of the complaint.

### D5 — The rule the completion layer must obey, written as code (F7, §0.3)

`sqlLanguageService.ts`'s header comment gains, and the implementation enforces:

> **A `CompletionSource` in this file receives data; it never fetches.** Every argument
> `sqlCompletionSources` takes is a value already in memory when the source is constructed. The one
> new supply (`cached`) is read from `schemaColumnsState`, a plain reactive record, filled by a
> **view's own lifecycle hook** — never by a completion, a lint, or a hover callback, and never on a
> keystroke. This is v1.1 P18's "no schema introspection over a real connection" rule, kept exactly:
> what changed in P22c is not who may query the database (still nobody, from here) but that the
> **already-cached, already-structured** metadata the app fetched for its own tree is finally
> offered to this layer instead of being re-derived from a text document the user had to paste.

Mechanically, the guard is that `state/schemaColumns.ts` exports **no synchronous read that can
trigger a fetch**: `ensureSchemaColumns` is `async` and returns `void`; the read accessor is a plain
property lookup that returns `[]` on a miss. A source calling it can only ever get what is already
there.

### D6 — Diagnostics and hover read the same supply (F12)

`views/console/lint.ts`'s `consoleLintSource` and `editor/hover.ts`'s `sqlHoverSource` both take a
`DdlSchema` today. Rather than widen both signatures with a second, differently-shaped argument,
`state/schemaColumns.ts` exports one adapter:

```ts
/** The cached columns projected into the DdlSchema shape the three console language providers
 *  already share — so completion, diagnostics and hover cannot disagree about what the console
 *  knows. Merged UNDER the hand-authored document (D4's precedence), never over it. */
export function effectiveSchema(connectionId: string, containerPath: string, document: DdlSchema): DdlSchema;
```

`ConsoleView.vue`'s `ddlSchema` computed (`:109`) becomes `effectiveSchema(…, ddlSchemaFor(…))`, and
the three providers below it (`:139`, `:149`, `:156`) are then **unchanged** — they keep taking one
`DdlSchema` and keep agreeing with each other by construction. This is the smallest change that
preserves F12's "one supply, three consumers" property, and it means hover can now show a real
`format_type()` string for a column the user never opened.

`DdlSchema`'s own type is checked to carry what `ColumnMeta` provides (name, type); anything
`ColumnMeta` has and `DdlSchema` does not (nullability, PK-ness, comment) is carried in the new
`RelationColumns` path and reaches hover through a widened `DdlColumn` field or is dropped —
whichever `ddl.ts`'s existing shape makes cheaper, decided by the implementer and stated in the
commit body. **Adding a field to `DdlColumn` is preferred**: hover showing `not null, pk` is a real
gain and the parser can populate it too.

### D7 — "Fill from connection" is deleted; the DDL dialog stays (F4, §0.3)

- **Deleted:** `state/schemas.ts`'s `fillDdlFromConnection` (`:157-188`), `FillProgress` (`:142`),
  `connectionRelationsFromTree` (`:128-140`) if nothing else uses it, and `SchemaDialog.vue`'s
  "Fill from connection" button and its progress label. This is P19 D15 in full. It exists to stage
  the same metadata the cache now serves directly, at N round trips instead of one, behind a button
  the row identifies as the wrong shape.
- **Deleted:** P19 D16's no-schema hint strip and its dismissal state
  (`ConsoleView.vue:637-658`, `state/schemas.ts:190-196`). Its text — *"No schema for this
  connection — table and column completion is off. Set one up ▸"* — is false the moment D4 lands:
  completion is on, from the cache, with no setup.
- **Kept:** `SchemaDialog.vue`, `saveDdl`, `ensureDdl`, `ddlSchemaFor`, `parseDdl`, and the
  connection-row context-menu entry. The document is now a deliberate **override** for the cases the
  cache cannot serve (a schema that does not exist yet; an engine with no `SchemaColumns`
  capability; a connection the user cannot introspect), and D4's precedence makes that real. The
  dialog's own copy is updated to say so, replacing the *"Nothing here ever reads from the
  connection itself"* framing that made it read as the only supply.

### D8 — Mongo's field completion comes from loaded documents, and is a different mechanism (F11)

`views/documents/`'s `mongoFilterCandidates` — field names sampled from the tab's loaded page — is
promoted to `views/shared/` (mandatory: `biome.json` forbids `views/console/**` importing
`views/documents/**`; the same promotion P19 D7 made for `clipboardFormats.ts`), and
`completion.ts`'s `mongoCompletionSource` gains a fourth position: **inside a filter/projection
object literal**, offer field names sampled from whatever documents that connection's collection
views have loaded, keyed by `(connectionId, database, collection)`.

Stated plainly in the source and here: **this is a sample, not a schema.** It offers what has been
seen, it degrades to nothing when nothing has been loaded, and it is not backed by
`metadata_cache` because there is nothing to cache — `adapters/mongo/adapter.go:191` returns no
columns because a Mongo collection has none. Pretending one design covers both engines' "schema
completion" would be the second misunderstanding this phase exists to correct.

If a console is opened on a collection nobody has browsed, Mongo completion is exactly what it is
today (collections, methods, operators, constructors). That is the honest degradation, and it is the
same one `mongoCollectionNames`' own comment already records (`completion.ts:31-33`).

### D9 — What the user sees, and when

No new affordance, no button, no strip. The sequence, end to end:

1. A user expands a schema in the tree → `treeChildren` caches relation names (unchanged).
2. A user opens a console or a table under that schema → the view calls
   `ensureSchemaColumns(connectionId, containerPath)` once → one round trip → one `metadata_cache`
   row payload.
3. Typing `select * from ` offers tables; `select u.` after `from users u` offers **columns with
   their types**; hovering a column shows its type; the linter stops flagging real columns as
   unknown.
4. Reopening the app, with no connection made at all, still completes — F7's cached-before-connected
   read.

**That is the item**: the metadata the app already fetches, backing completion directly and
automatically, with no manual step, and with the language layer never opening a connection of its
own.

---

## 3. Commit sequence

Conventional Commits, one concern each, in dependency order. Lands after
`plans/P22-shared-primitives-and-tokens.md`.

| # | Commit | Covers |
|---|---|---|
| V1 | `feat(adapters): a container's columns are one query, not one per table` | D1's interface + `caps.go` + `model.RelationColumns` |
| V2 | `feat(postgres): list a schema's columns in one round trip` | D1, postgres |
| V3 | `feat(mysql,mariadb): list a schema's columns in one round trip` | D1, mysqlfamily |
| V4 | `feat(clickhouse,sqlite): list a schema's columns in one round trip` | D1, remaining two |
| V5 | `feat(tree): a container's columns are cached beside its children` | D2 |
| V6 | `feat(bridge): TreeService.SchemaColumns` (+ regenerated bindings) | D3, Go half |
| V7 | `feat(studio): the console loads its container's columns when it opens` | D3, frontend store |
| V8 | `feat(console): completion is driven by the cached schema, with no document` | D4 |
| V9 | `feat(console): diagnostics and hover read the same cached schema` | D6 |
| V10 | `refactor(studio)!: the schema document is an override, not the only supply` | D7 (removals) |
| V11 | `feat(console): a Mongo console completes the fields its documents have shown` | D8 |
| V12 | `test(p22c): the specs §4 enumerates` | §4 |
| V13 | `docs: ARCHITECTURE's Caching section records the fourth metadata kind` | §5 |
| V14 | `docs(spec): P22 part 3 implemented` | the SPEC row |

Ordering: V1 before V2-V4 (the interface). V5 needs V1's model type. V6 needs V5. V7 needs V6's
bindings. V8 needs V7. V9 after V8 (same supply, and its own commit so the "three consumers agree"
change is legible). **V10 must come after V8 and V9** — removing the staging button before the cache
backs completion would leave a window with no column completion at all. V11 is independent of
V1-V10 and may land any time after V7.

The `!` on V10 is deliberate: `fillDdlFromConnection` is a removed public export of
`state/schemas.ts`, and the dialog loses a button a user may have been using.

---

## 4. Verification plan

### 4.1 Go — adapter conformance (`bun run test:go`, and the real-container suites)

`AGENTS.md` exempts these from the unit-test bar explicitly: *"nothing else exercises a Go adapter
capability by capability."* Per SQL adapter, in `internal/adapters/<kind>/*_test.go`:

- `SchemaColumns` on a container with two tables and a view returns all three, each with its columns
  in ordinal order, each column's `DataType` **byte-identical to what `Describe` reports for the
  same column** — the property that makes D6's shared supply honest, and the one thing that would
  silently rot if the two queries drifted.
- An empty container returns an empty slice, not an error.
- A container the user cannot read returns the adapter's own permission error, unwrapped into
  `ipcerr` by the caller.
- The non-SQL kinds report the capability false and the method is not implemented.

`internal/adapters/testsupport` already provisions the containers; `P25`'s complete-suite harness
(`Scenario`/`Requires`) is the seam for the permission case, per `AGENTS.md`.

### 4.2 Go — the cache (`bun run test:go`)

`internal/tree/service_test.go` (existing) gains, mirroring its `Describe` cases exactly:

- A miss calls the backend once and writes a `columns` payload; the second call is served from cache
  with `Source: "cache"` and **no backend call**.
- A cached read succeeds while the connection is **disconnected** (F7's property, and the one this
  design most depends on).
- `refresh: true` bypasses the cache and rewrites it.
- A payload that fails `ValidateRelationColumns` is dropped and re-fetched.
- `Invalidate(connectionID, nil)` clears it.
- **`children` and `columns` for one container share one row**: writing both and reading each back
  proves F8's zero-net-row property. This is the case that would catch a future change to
  `MetadataCacheRepo.Put`'s merge silently doubling the app's cache footprint.

### 4.3 Unit (`bun run test:unit`)

- **`namespaceFromCached`** — **yes.** It is a shape transform with real interacting rules
  (unqualified vs. schema-qualified relations, a view and a table with the same column name,
  `defaultSchema` resolution, an empty relation) feeding a third-party completion engine whose
  behaviour depends on getting the shape exactly right. That is on the right side of `AGENTS.md`'s
  bar; `toSqlNamespace`'s own existing coverage is the model.
- **`effectiveSchema`'s precedence** — **yes**, three cases: document wins over cache; cache fills
  when the document is empty; both empty yields the empty schema. It is the merge rule three
  consumers depend on.
- Nothing else. `ensureSchemaColumns` is a single-flight fetch-and-store; the bridge method is a
  pass-through.

### 4.4 UI (`bun run test:ui`)

1. **`sql-schema.spec.ts`** (existing — P19's *"with no DDL document, the console is unchanged"*
   case is **updated, not deleted**, since its subject is exactly what D4 changes): with no DDL
   document, opening a console under a schema and typing `select * from ` offers the tables; typing
   `select u.` after `from users u` offers **that table's columns** with their types in the
   completion detail. The keyword-completion assertions in that case stay as they are.
2. **`sql-schema.spec.ts`** — the document still wins: save a DDL document naming a table the
   fixture's cache does not have, and assert its columns are offered (D4's precedence).
3. **`sql-schema.spec.ts`** — one `treeSchemaColumns` call per container per console open, not per
   keystroke: type twenty characters and assert the mocked IPC log still shows exactly one call
   (D5's rule, asserted rather than asserted-in-prose).
4. **`sql-schema.spec.ts`** — hovering a column the user never opened shows its type, and the
   linter does not flag it (D6).
5. **`sql-schema.spec.ts`** — the no-schema hint strip and the "Fill from connection" button are
   **gone** (`console-no-schema-hint`, `console-no-schema-hint-setup`,
   `console-no-schema-hint-dismiss` and the dialog's fill testid all absent), and the Schema (DDL)
   dialog still opens from the connection row's menu and still saves (D7).
6. **`autocomplete.spec.ts`** — a Mongo console, after a collection view has loaded a page, offers
   that page's field names inside a filter literal; a console opened with nothing loaded offers
   collections/methods/operators exactly as today (D8, and its honest degradation).

### 4.5 Real backend (`tests/e2e-real`)

One scenario, Postgres and SQLite (the two the suite runs unconditionally, `AGENTS.md`): connect,
expand a schema, open a console **without opening any table**, and assert a column of an unopened
table completes. This is the case the mocked tier cannot prove, because it is exactly the
"the adapter really did return this in one query" claim.

### 4.6 What is deliberately not verified

- **The 4 MB payload ceiling's behaviour on a genuinely enormous schema** (OQ-4). Constructing a
  4 MB-of-columns fixture to watch a documented `Put` path log-and-skip is not worth its runtime;
  the branch already exists and is already exercised by `metadata_cache_test.go`.
- **Whether the cache is refreshed often enough.** P24's question, not this phase's (§5).
- **Anything rendered.** This sandbox cannot build the app (`wails3` absent); every UI case above is
  written to fail loudly rather than to confirm a guess.

---

## 5. What this phase hands to P24, deliberately

`docs/v1.2/SPEC.md`'s P24 row — *"connecting to a database (after being idle a while) should refresh
its cached metadata … but simply navigating the already-loaded tree must not re-fetch"* — audits the
staleness policy this phase inherits. Two things this phase adds that P24 will want in its scope,
recorded here so they are not rediscovered:

1. **A fourth cache kind, `columns`, with no staleness rule of its own.** It refreshes exactly when
   `children`/`describe`/`definition` do — on an explicit `refresh: true`, or when `Invalidate`
   drops the connection. If P24 concludes that a reconnect should refresh metadata, `columns` is
   included for free; if it concludes something finer-grained, `columns` is the kind most worth a
   rule, since a `ALTER TABLE ADD COLUMN` made outside the app is exactly the drift a user would
   notice through completion first.
2. **A new fetch on tab activation** (D3). It is single-flight and idempotent and it reads through
   the cache, so on a warm connection it costs nothing. But it *is* a new "opening a thing triggers
   a metadata call" path, which is the class of behaviour P24's row is about. `ensureSchemaColumns`
   is deliberately the single choke point for it.

`docs/ARCHITECTURE.md`'s Caching section is updated in V13 to describe the fourth kind and the
container-keying, so P24 starts from a current description rather than from this plan.

---

## 6. What this phase deliberately does not do

- **Does not let the language layer open a connection.** D5, and §0.3. The constraint is kept, not
  argued with.
- **Does not delete the DDL document, the parser, or the dialog** (D7) — only P19 D15's staging
  button and P19 D16's strip.
- **Does not fetch a schema's constraint graph.** `SchemaColumns` returns columns; `Describe` stays
  the full-fidelity per-object call (D1).
- **Does not add a cache row per relation** (D2, F8) — that would evict the tree's own children.
- **Does not introduce a staleness or TTL policy** (§5).
- **Does not give Mongo a `metadata_cache`-backed field schema** (D8, F11) — there is nothing to
  cache.
- **Does not touch `views/grid/`'s `runtime[tabId].meta`.** `sqlLanguageService.ts:23-28`'s
  standing note about not falling back to *that* cache stays true: it is a per-tab describe for one
  open table, and this phase's supply is a per-container fetch that never reads it.
- **Does not add cross-schema completion** (OQ-3).

---

## 7. Open questions, with their resolutions

**OQ-1 — Should `ensureSchemaColumns` also fire when a *connection* is expanded, rather than only
when a tab opens?**
*Resolved: no.* Expanding a connection lists databases; expanding a database lists schemas. Fetching
every schema's columns at that moment is N round trips for a user who may open none of them — the
same over-fetching P24 exists to prevent. Tab activation is the moment the app learns *which*
container a person is actually working in, and it is one call. If a user reports a perceptible wait
on first completion, the answer is a fetch on **container expansion** (one container, when its
children are listed), not on connection expansion.

**OQ-2 — Should `SchemaColumns` return indexes and foreign keys too, so hover can show them?**
*Resolved: no, and named so it is not re-litigated.* On Postgres that is three more queries per
container (`listIndexes`, `listForeignKeys`, `listReferencedBy` — `postgres/adapter.go:218-230`),
each considerably heavier than the column list, to serve a hover panel the user reaches by opening
the Definition tab anyway. Columns and their types are what completion, diagnostics and hover
actually need. If a later phase wants a relation graph for completion (joining on a foreign key,
say), that is a real feature with its own cost and its own row.

**OQ-3 — Should a console complete relations in *other* schemas of the same database?**
*Resolved: not in this phase.* The container the console is opened under is the one it completes,
which matches `consoleRelationNames`' existing behaviour (P19 D14) and keeps the fetch to one call.
Cross-schema completion means either fetching every schema (OQ-1's cost) or a
completion-time fetch (D5's prohibition). The honest middle — completing a schema the user has
already opened a tab under, because its row is already cached — falls out for free once
`schemaColumnsState` holds more than one container, and the implementer should let it: the store is
keyed by container, so `namespaceFromCached` over *every* loaded container of the same connection is
a one-line widening. Recorded as the preferred answer if the narrow version reads badly in use.

**OQ-4 — What happens on a schema whose column list exceeds the 4 MB payload ceiling?**
*Resolved: it is fetched every time and never cached*, which is `MetadataCacheRepo.Put`'s existing,
logged behaviour (`metadata_cache.go:73-77`) and not a new failure mode. Roughly 20,000+ columns in
one schema. If that turns out to be real, the fix is to store per-relation rows for that container
only — which reopens F8's budget question and is its own decision.

**OQ-5 — Does removing the "Fill from connection" button lose anything a user relied on?**
*Resolved: only for an engine with no `SchemaColumns` capability, and there is none among the five
SQL kinds.* The button's output was a DDL text document; the dialog still accepts one, so anybody
who wants that exact artefact can still produce it with `pg_dump --schema-only`. What they no longer
have is the app doing N round trips to build it — which is the cost the row objects to. V10's commit
body says this, and D7 keeps the dialog copy honest about what the document is now for.

---

## Checklist

- [ ] V1 `feat(adapters): a container's columns are one query, not one per table`
- [ ] V2 `feat(postgres): list a schema's columns in one round trip`
- [ ] V3 `feat(mysql,mariadb): list a schema's columns in one round trip`
- [ ] V4 `feat(clickhouse,sqlite): list a schema's columns in one round trip`
- [ ] V5 `feat(tree): a container's columns are cached beside its children`
- [ ] V6 `feat(bridge): TreeService.SchemaColumns`
- [ ] `wails3 task common:generate:bindings` re-run after V6 (`-names` is load-bearing)
- [ ] V7 `feat(studio): the console loads its container's columns when it opens`
- [ ] V8 `feat(console): completion is driven by the cached schema, with no document`
- [ ] V9 `feat(console): diagnostics and hover read the same cached schema`
- [ ] V10 `refactor(studio)!: the schema document is an override, not the only supply`
- [ ] V11 `feat(console): a Mongo console completes the fields its documents have shown`
- [ ] V12 `test(p22c): the specs §4 enumerates`
- [ ] V13 `docs: ARCHITECTURE's Caching section records the fourth metadata kind`
- [ ] `bun run lint` / `typecheck` / `build` clean
- [ ] `bun run test:go` green, including the new per-adapter conformance cases and the
      shared-row cache case
- [ ] `bun run test:unit` green (`namespaceFromCached`, `effectiveSchema`)
- [ ] `bun run test:ui` run once at the end; failures fixed as follow-up commits
- [ ] `tests/e2e-real` §4.5 scenario run once (Postgres + SQLite)
- [ ] `docs/v1.2/SPEC.md`'s P22 row updated

---

## 8. Sources

**Read in this worktree at `b52fd72`:**
`internal/tree/service.go`, `internal/bridge/tree.go`,
`internal/storage/repos/metadata_cache.go`, `internal/storage/model/{tree,definition}.go`,
`internal/adapters/postgres/{adapter,catalog,definition}.go`, `internal/adapters/mongo/adapter.go`,
`internal/adapters/{caps.go,adapter.go}`,
`views/console/{ConsoleView.vue,completion.ts,sqlLanguageService.ts,ddl.ts,lint.ts}`,
`views/documents/DocumentView.vue`, `views/grid/state.ts`, `views/definition/state.ts`,
`project/state/tree.ts`, `project/{SchemaDialog.vue,menus.ts}`, `state/schemas.ts`,
`editor/{hover.ts,CodeMirrorHost.vue}`, `packages/shared/domain/tree.ts`, `frontend/src/bridge/index.ts`,
`biome.json`, `tests/ui/sql-schema.spec.ts`.

**Not run**: `bun run build`, `bun run test:ui`, `bun run test:go`. `frontend/bindings/` is generated
by `wails3`, absent here; `node_modules` is not populated in this worktree. F9's schema-wide query
forms are stated from each adapter's own existing per-object query plus the engine's documented
catalog surface, not from a live run — §4.1's conformance cases are what prove them, and they are
written so a wrong query fails against a real container rather than shipping.

**Prior plans**: `docs/v1.1/plans/P18-sql-language-server-explain.md` (D5, D21 — the "no
introspection from the language layer" rule this phase keeps, and the tree-cache technique it
extends), `docs/v1.2/plans/P19-connection-dialog-mongo-console-sql-tooling.md` (F20-F25, D14, D15,
D16, OQ-4 — the design this phase corrects, and its own honest note that a silent fallback *"would
make the DDL surface look broken whenever it's simply empty"*), `docs/v1.2/SPEC.md`'s P22 and P24
rows, and `docs/ARCHITECTURE.md`'s Caching and Testing sections.
