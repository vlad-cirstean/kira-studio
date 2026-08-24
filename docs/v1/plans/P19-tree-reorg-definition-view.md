# P19 — Tree reorganization + generic object-definition view

> Plan for SPEC.md §10 phase **P19**. Deliverable, verbatim from the phasing table: *"Tree shows
> tables first, ungrouped; every other object kind (functions, sequences, etc.) grouped into
> per-kind folders by default. Tables no longer expand to show columns in the tree — that moves into
> the definition view. The definition view (today's DDL tab) defaults to a nicely parsed structured
> display (columns/indexes/constraints) with a toggle to see the raw SQL text as it works today;
> gains a MongoDB implementation (indexes, and the collection's JSON Schema validator if set);
> renamed to a more generic term than "DDL" to fit non-SQL connections."* Listed as *"user-requested,
> to be researched and planned in detail when picked up"* — this document is that research.
>
> This phase touches four layers: the renderer's tree assembly, two adapters' `children()`, one
> adapter's new definition implementation, and a rename that crosses `shared/`, `main/`, `engine/`,
> `preload/`, `renderer/` and both test suites. §3's D14 enumerates that rename identifier by
> identifier; nothing in it is left to "and so on".

## 0. Ground rules for this phase

- **Nothing the tree stops showing may become unreachable.** Every affordance a column tree row
  carried today (its type, its `PK` badge, Copy name / Add to projection / Sort by — §8.10's
  "Column (tree)" row) reappears in the definition view's Columns section. This is a *relocation*,
  not a deletion, and D9 is where that is written down. Deleting the rows and calling the menu
  coverage "no longer applicable" would be exactly the half-implementation AGENTS.md rules out.
- **Grouping is a renderer policy, not an adapter change.** No adapter learns a new node kind, no
  encoded path grows a folder segment, and no `children()` call is added or removed for the sake of
  a folder. See D2 for why — the short version is that a folder segment inside an encoded path
  would have to be parsed by every adapter's `segments.length` dispatch and by `revealPath()`.
- **Curated vocabularies, not exhaustive ones.** The set of kinds that get a folder is a literal
  four-entry table (D3), not "every kind that isn't a table". The set of constraint types the
  Structure pane knows is a five-member enum (D11). Both are readable in one screen.
- **The raw SQL surface must not regress.** The Source pane is today's `DdlView.vue` body — same
  `CodeMirrorHost`, same dialect, same read-only, same notes strip, same Copy button, same L1
  cache-aside — reached in one click instead of zero. The deliverable says the raw text "works
  today" and that is a constraint, not an aspiration (acceptance checklist, §7).
- **Persisted enum values are coerced at the storage-repo read boundary, never in the domain
  union.** Both `tabs.kind` and `op_log.kind` carry the string `'ddl'` on disk today, and both
  repos *drop* a row whose enum member doesn't parse (realities #14, #15). D15 adds one legacy
  mapping line to each, so the domain unions stay closed and a user loses neither an open tab nor
  their operation history to a rename.
- Comments per AGENTS.md: only where the code cannot say it for itself. Every `D` below that encodes
  a non-obvious constraint gets one line at its implementation site, not a paraphrase of this file.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `xvfb-run -a bun run
  test:ui` from step 4 on. `bun run test:db` matters from step 2 on — unlike P18, this phase does
  change adapters.

### Realities this phase works with (verified against the tree)

1. **The tree renders exactly what `children()` returns — there is no view-side transform today.**
   `project/state/tree.ts:250-308`'s `buildRows()` walks `treeState.children[k]` (a
   `Record<string, TreeNode[]>` filled verbatim by `control.treeChildren`), applies
   `evaluate(node, filters)` and the search query, and pushes one `TreeRowVm` per `TreeNode`. There
   is no reordering, no synthesis, no grouping anywhere between the adapter and the DOM. Grouping
   therefore has exactly one natural home (D2) and it is this function.
2. **Postgres's schema level already returns tables first and functions last, in one flat list.**
   `postgres/catalog.ts:85-146`'s `listRelationsAndFunctions()` orders relations by
   `CASE relkind WHEN 'r'/'p' THEN 0 WHEN 'v' THEN 1 WHEN 'm' THEN 2 WHEN 'S' THEN 3` then appends
   function nodes. Its own comment says "D15: a schema's children are the objects themselves, no
   Tables/Views folder nodes" — P19 is the decision that reverses half of that, and it reverses it
   in the renderer, leaving this query and its ordering untouched.
3. **MariaDB's database level has the same shape one level shallower, and folds procedures into
   `'function'`.** `mariadb/catalog.ts:54-108`'s `listTablesAndRoutines()` maps `BASE TABLE`/`VIEW`/
   `SEQUENCE` (`:40-44`) then appends `information_schema.ROUTINES` rows as `kind: 'function'` with
   `detail: 'procedure'` for procedures. There is no `matview` kind on MariaDB at all. D3's label
   override exists because of this line specifically.
4. **A table's columns are tree children today, produced by a three-query round trip per expand.**
   `postgres/index.ts:121-134` routes a depth-3 `table`/`view`/`matview` path to `listColumnNodes()`
   (`:349-368`), which runs `getRelationOid` + `listColumns` + `listIndexes` and emits one
   `kind: 'column'` node per column with `detail` = the data type and `badges: ['PK']`.
   `mariadb/index.ts:111-120` + `:334` is the identical pattern at depth 2. Removing this removes
   three catalog queries per table expand, not just rows.
5. **`hasChildren` for a relation is set in the catalog, and the L1 cache has no TTL.**
   `postgres/catalog.ts:118` writes `hasChildren: kind !== 'sequence'`. A schema listing cached
   before this phase would still carry `hasChildren: true` for its tables, and §7 gives L1 no
   expiry — only reconnect or an explicit Refresh rewrites it. So flipping the adapter alone would
   leave a live twisty on every already-cached table until the next reconnect. D5 handles that.
6. **Tree expand state is not persisted anywhere.** `shared/layout.ts`'s `layoutSchema` holds only
   `panel.{project,operations,cellEditor}` and `window.bounds`; `treeState.expanded` is a plain
   in-memory `Set` (`project/state/tree.ts:31-43`) cleared by `collapseAll()` and by
   `dropConnectionState()`. **Removing the column rows therefore needs no expand-state migration of
   any kind** — a fact worth stating because it is the one place a restructure like this usually
   costs something (D6).
7. **A tree row's Playwright identity is `data-path`.** `project/TreeRow.vue:79-80` renders
   `:data-path="row.path"` and `:data-kind="row.kind"`, and every UI spec's `findRow()` selects
   `[data-testid="tree-row"][data-path="…"]`. A synthetic folder row that reused its parent's path
   would make `[data-path="database:kira_test/schema:app"]` match five rows and break
   `budgets.spec.ts:292-308`'s twisty click. D2's `#`-suffixed synthetic path exists for this.
8. **`#` cannot occur in an encoded path.** `encodePath` (`shared/domain/tree.ts:38-40`) joins
   `${kind}:${encodeURIComponent(name)}` with `/`; `encodeURIComponent('#')` is `%23`, and every
   kind is a `nodeKindSchema` word. So `#` is a safe, collision-proof discriminator for a synthetic
   row's path and key.
9. **`ObjectMeta` already carries everything the Structure pane needs except constraints and Mongo's
   validator.** `shared/domain/tree.ts:113-126`: `columns: ColumnMeta[]` (name, position, dataType,
   nullable, defaultExpr, isPrimaryKey, comment), `primaryKey`, `foreignKeys`, `referencedBy`,
   `indexes: IndexMeta[]` (name, columns, unique, primary, method), `rowEstimate`, `comment`. It is
   fetched through `control.treeDescribe` and L1-cached, and the grid already reads it exactly this
   way — `views/grid/state.ts:70-80`'s `loadMeta()` with a deliberately silent `catch`.
10. **Mongo's `describe()` already returns real indexes.** `mongo/index.ts:100-138` calls
    `catalog.describeIndexes()` and maps them into `ObjectMeta.indexes` with `primary: name ===
    '_id_'`; `columns`/`foreignKeys`/`referencedBy` are `[]` by design ("§8.5: Mongo has no FK
    navigation in v1"). Mongo's Structure pane needs **no new index plumbing at all** — the data is
    already on the wire, behind a `caps.ddl: false` that stops the tab from ever opening.
11. **Mongo's collection listing deliberately asks for names only.** `mongo/catalog.ts:26-44` passes
    `{ nameOnly: true }`, so `options` — where `validator`, `validationLevel` and `validationAction`
    live — is never fetched. `node_modules/mongodb/mongodb.d.ts:3278-3287` types
    `CollectionInfo.options?: Document`, and the installed driver is `mongodb@6.21.0`. Reading the
    validator is one `db.listCollections({ name }, {})` call on the definition path only; the tree's
    listing keeps `nameOnly: true` (D12).
12. **Mongo values already travel as EJSON strings, and `bson` is already a direct import.**
    `mongo/read.ts:1` imports `{ EJSON } from 'bson'` and ships every document body as
    `EJSON.stringify(doc, { relaxed: false })` into a `TextColumnChunk`. `EJSON.stringify(value,
    undefined, 2, { relaxed: true })` (`node_modules/bson/bson.d.ts:1577`) is the same tool, and
    relaxed mode is what keeps a `$jsonSchema`'s `minimum: 5` from rendering as
    `{"$numberInt":"5"}` (D12).
13. **Postgres already queries its constraints structurally — to build the DDL text.**
    `postgres/ddl.ts:125-132` selects `conname` + `pg_get_constraintdef(oid, true)` for
    `contype IN ('p','u','c','f','x')`. Returning that list *as data* alongside the composed
    statements costs zero extra round trips (D11). MariaDB has no equivalent: `mariadb/ddl.ts:44`
    is a single `SHOW CREATE TABLE` passed through verbatim (`origin: 'server'`, `:76`), so its
    constraint list needs one added query, on the definition path only.
14. **An unparseable persisted tab row is dropped, with a warn, and not re-saved.**
    `main/storage/repos/tabs.ts:27-45`: `tabRecordSchema.safeParse` failure → `log('warn', …)` →
    `continue`, then a second gate on `RENDERABLE_TAB_KINDS`. `tabs.kind` is plain `TEXT` with no
    CHECK constraint (`migrations/0001_init.sql:74-82`), so a tab-kind rename needs no SQL
    migration — but without D15 it would silently close every open DDL tab on first launch.
15. **The op log has the identical drop-on-unparseable rule.**
    `main/storage/repos/ops.ts:69-74` drops any row whose `kind` is outside `opKindSchema`.
    `'ddl'` is a member today (`shared/domain/ops.ts:8`) and the Operations panel renders it
    verbatim, so the string is user-visible and must be renamed — and coerced on read (D15).
16. **A stale-shaped L1 payload is a miss, not an error.** `main/tree-service.ts:83-119` parses each
    cached payload through its Zod schema and calls `dropCached` on failure. `MetaKind` is
    `'children' | 'describe' | 'ddl'` (`repos/metadata-cache.ts:6`) and the three payloads share one
    row keyed `(connection_id, path)` (`:11-15`, `:69`). Renaming the key to `'definition'` is
    therefore self-healing: the lookup misses, the definition is re-fetched, and the orphaned `ddl`
    key inside the JSON disappears the next time the connection reconnects (§7 refreshes a whole
    connection's metadata on every reconnect).
17. **`DdlView.vue` already documents this phase's UI as deliberately skipped.**
    `views/ddl/DdlView.vue:123-125`: *"Column/index/constraint counts and the Definition/Columns/
    Indexes/Constraints segmented view from the mockup need structured catalog data this tab doesn't
    fetch (only the raw statement text) — skipped rather than faked."* The mockup it refers to is
    `docs/design/kira-design-system/Ddl.dc.html:396`, which draws a four-way `.p-seg`. P19 is that
    skipped work, with the segmentation reshaped by D7.
18. **A segmented-control primitive already exists.** `theme/primitives/Segmented.vue` is a generic
    SFC over a `readonly { value: T; label: string; title?: string; testid?: string }[]`, rendering
    `.p-seg` with an `on` class. The Structure/Source toggle is one `<Segmented>`, not new chrome.
19. **`columnTypeIcon()` is a tree helper that survives its only caller.** `project/icons.ts:48-58`
    maps a data type to a codicon and is used only by `TreeRow.vue:20` for column rows. D9 gives it
    a second home in the Structure pane's Columns table, so the type iconography moves with the
    data rather than being deleted alongside the rows.
20. **The tree's only asserted perf budget expands a *schema*, not a table.** `docs/PERF.md:24`/`:40`
    ("Cached tree expand", p95 2.8 ms against a 50 ms budget) is measured by
    `budgets.spec.ts:292-308`, which collapses/expands `APP_PATH` and waits for `BIG_ROWS_PATH` (a
    table row) to appear. Tables stay ungrouped and first, so that row still appears at the same
    place; folders are pure view state with no fetch (D2), so the measured path gets *shorter*, not
    longer. No budget anywhere assumes a column row exists.

## 1. The name, decided

The tab, the view, the adapter method, the capability flag and the menu item are all renamed from
**DDL** to **definition**. The raw-SQL pane inside the view is called **Source**; the parsed pane is
called **Structure**.

Why "definition", specifically:

- **SPEC.md already uses it for exactly this thing.** The P19 row calls the deliverable a "generic
  object-definition view" and refers to "the definition view (today's DDL tab)" — twice, in the
  sentence that commissions the rename. `engine/adapters/adapter.ts:84` already documents `ddl()` as
  *"The object's definition as executable statements."* The word is not invented here; it is the one
  the spec and the code already reach for when they need the engine-neutral term.
- **It reads correctly on both sides.** "Open definition" on a Postgres table means its DDL; on a
  Mongo collection it means its indexes and its JSON Schema validator. Both are, literally, the
  definition of the object as the server holds it.
- **"Source" is already this codebase's word for the raw text.** The type is `SourceText`
  (`shared/domain/ddl.ts:8`) and `TreeDdlResult.source` already distinguishes `'cache' | 'server'`.
  Naming the raw pane "Source" and the type `ObjectDefinition` keeps both words doing the job they
  already do, and avoids the mockup's collision where "Definition" named one *segment* of the tab.
- Rejected: **"Structure"** as the feature name — it is the right word for the parsed pane, and
  using it for the whole tab would leave the parsed pane needing a second, vaguer name ("Overview").
  Rejected: **"Schema"** — `'schema'` is already a `NodeKind` and a Postgres tree level
  (`shared/domain/tree.ts:6`); reusing it would make `schema:app/table:x`'s "schema" and "the schema
  view" two different things one line apart. Rejected: **"Properties"/"Object info"** — generic to
  the point of saying nothing, and neither appears anywhere in this codebase or spec today.

§8 flags the final call as an open question anyway; D14's blast radius is mechanical either way, so
substituting a different noun costs one search-and-replace across the table below and nothing more.

## 2. Shapes introduced in this plan

```ts
// src/shared/domain/definition.ts   (renamed from shared/domain/ddl.ts)

/** Where the text came from. 'server' is the engine's own definition, byte for byte. */
export type DefinitionOrigin = 'server' | 'composed';

/** How the Source pane renders `statements`, and how definitionText() joins them.
 *  'sql' → one statement per entry, ';'-terminated. 'json' → one document, no separator. */
export type DefinitionLanguage = 'sql' | 'json';

export const constraintMetaSchema = z.object({
  name: z.string(),
  type: z.enum(['primaryKey', 'unique', 'foreignKey', 'check', 'exclusion']),
  /** The engine's own text: pg_get_constraintdef(), or MariaDB's CHECK_CLAUSE / key column list.
   *  Rendered verbatim — never re-composed here (D11). */
  definition: z.string(),
});
export type ConstraintMeta = z.infer<typeof constraintMetaSchema>;

/** Structure a document engine has and the SQL-shaped ObjectMeta has no room for. Null for
 *  every SQL engine, and for a Mongo collection this is the *only* new data on the wire —
 *  its indexes already arrive through describe() (realities #10). */
export const documentSchemaMetaSchema = z.object({
  /** EJSON (relaxed, 2-space) — the `$jsonSchema` sub-document when the validator has one,
   *  else the whole validator document verbatim. Null when no validator is set. */
  validator: z.string().nullable(),
  /** True when `validator` is the $jsonSchema sub-document, i.e. renderable as a field table. */
  isJsonSchema: z.boolean(),
  validationLevel: z.string().nullable(),  // 'off' | 'strict' | 'moderate'
  validationAction: z.string().nullable(), // 'error' | 'warn'
});

export const objectDefinitionSchema = z.object({
  path: z.string(),
  kind: nodeKindSchema,
  qualifiedName: z.string(),
  language: z.enum(['sql', 'json']),          // NEW
  /** Ordered, each without a trailing semicolon. Never empty. */
  statements: z.array(z.string()).min(1),
  origin: definitionOriginSchema,
  notes: z.array(z.string()),
  constraints: z.array(constraintMetaSchema), // NEW — [] where the engine has none (D11)
  documentSchema: documentSchemaMetaSchema.nullable(), // NEW — null for SQL engines (D12)
  generatedAt: z.string(),
});
export type ObjectDefinition = z.infer<typeof objectDefinitionSchema>;

/** The one definition of "the Source pane's document". ';'-joins for 'sql', '\n\n' for 'json'. */
export function definitionText(def: ObjectDefinition): string;
```

```ts
// src/shared/domain/tabs.ts
export const tabKindSchema = z.enum([
  'data', 'definition', 'document', 'keyvalue', 'stream', 'console',   // 'ddl' -> 'definition'
]);

/** Which pane the toggle is on. The one thing this tab now has worth remembering — it was
 *  `z.object({})` ("D4: nothing to remember") while there was only one pane. `.default('structure')`
 *  keeps a tab saved under the old empty shape restorable (realities #14), the same discipline
 *  keyValueTabStateSchema's own `pageSize` comment records. */
export const definitionTabStateSchema = z.object({
  pane: z.enum(['structure', 'source']).default('structure'),
});
export type DefinitionTabState = z.infer<typeof definitionTabStateSchema>;
```

```ts
// src/renderer/project/state/tree.ts
export interface TreeRowVm {
  // …unchanged…
  kind: NodeKind | 'connection' | 'group';   // 'group' is a renderer-only row (D2)
  /** Group rows only: the NodeKind this folder collects, for the icon and the empty check. */
  groupKind?: NodeKind;
}

/** `database:kira_test/schema:app#function` — a real encoded path can never contain '#'
 *  (realities #8), so this collides with no node's path and no other group's. */
export function groupPath(parentPath: string, kind: NodeKind): string;
```

```ts
// src/renderer/project/grouping.ts   (new, pure, no Vue)

/** The complete, curated list of kinds that get their own folder, in render order. Any kind not
 *  named here is never grouped and keeps its position — which is what leaves tables, collections,
 *  redis namespaces/keys, s3 prefixes/objects, kafka topics/partitions/consumer groups and sqs
 *  queues exactly as they are today (D3). */
export const GROUPED_KINDS: readonly {
  kind: NodeKind;
  label: string;
  /** Per-connection-kind override. One entry today: MariaDB's `function` nodes include stored
   *  procedures (realities #3), and §5.1 calls that level "routines". */
  labelFor?: Partial<Record<ConnectionKind, string>>;
}[] = [
  { kind: 'view',     label: 'Views' },
  { kind: 'matview',  label: 'Materialized views' },
  { kind: 'sequence', label: 'Sequences' },
  { kind: 'function', label: 'Functions', labelFor: { mariadb: 'Routines' } },
];

/** Splits an already-filtered child list into [ungrouped, folders] — ungrouped in adapter order
 *  first, then one folder per non-empty GROUPED_KINDS entry, in table order. */
export function partitionChildren(
  nodes: TreeNode[],
  connectionKind: ConnectionKind,
): { ungrouped: TreeNode[]; groups: { kind: NodeKind; label: string; nodes: TreeNode[] }[] };

/** Kinds whose rows no longer expand, whatever a cached TreeNode's `hasChildren` says (D5). */
export function isLeafKind(kind: NodeKind): boolean;   // table | view | matview
```

```ts
// src/renderer/views/definition/structure.ts   (new, pure — the view's own derivations)

/** One Constraints-section row, merged from ObjectDefinition.constraints (engine text) and the
 *  ObjectMeta edges the SQL adapters already return (foreignKeys/referencedBy), de-duplicated by
 *  name so a foreign key never renders twice (D11). */
export interface ConstraintRow {
  name: string;
  type: ConstraintMeta['type'] | 'referencedBy';
  detail: string;
  /** Set for 'foreignKey'/'referencedBy' — the encoded path of the other table (P7's own field). */
  referencedPath?: string;
}

/** Parsed `$jsonSchema` field rows: name, bsonType/type, required, description. Returns null when
 *  the validator is not a $jsonSchema (an arbitrary query document), which is the signal to render
 *  it as raw JSON instead of a table (D12). */
export function jsonSchemaFields(validator: string): JsonSchemaFieldRow[] | null;
```

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The tree reorganization and the definition view ship as one phase but touch disjoint code.** No shared module, no shared type; the only thing they share is the rename (D14) and the fact that the columns the tree stops showing are the columns the view starts showing. | They are one deliverable in §10 and one user-visible story ("object detail lives in the definition view, not the tree"), but implementing them as one blob would make the diff unreviewable. §4's ordering does the tree first and the view second, with the rename in between, so each step is independently green. |
| D2 | **Grouping is done in `project/state/tree.ts`'s `buildRows()`, over the already-filtered child list, as synthetic `kind: 'group'` rows.** No adapter changes, no new `NodeKind`, no new path segment. A group row's `path` is `` `${parentPath}#${kind}` `` and its key is the usual `rowKey(connectionId, thatPath)`; its children are rendered from the *parent's* `treeState.children[k]`, never fetched. | Adapter-side folders would need a real addressable path, which means either a `folder:` segment inside encoded paths — parsed by four adapters' `segments.length` dispatch, by `decodePath`, by `revealPath()`'s `split('/')` ancestor walk (`state/tree.ts:161-176`) and by `menus.ts`'s `qualifiedNameFor` — or a folder whose children carry paths that skip it, which breaks reveal anyway. Renderer-side grouping needs none of that: it is a pure transform of a list the renderer already holds (realities #1), it costs no round trip, and it survives a cached listing unchanged. The `#` suffix keeps `data-path` unique per row (realities #7, #8) so no existing Playwright selector becomes ambiguous. |
| D3 | **Exactly four kinds get folders — `view`, `matview`, `sequence`, `function` — in that order, each folder shown only when non-empty, each labelled from a literal table with one MariaDB override (`Functions` → `Routines`).** Tables and collections are simply not in the list, so they render first, ungrouped, in adapter order. | The deliverable's rule is "tables first, ungrouped; every *other* object kind grouped", and an explicit four-entry list is the honest way to say that: an inferred rule ("group anything that isn't the primary kind" or "group when a level is heterogeneous") would also reorganize Redis's namespace/key levels, S3's prefix/object levels and Kafka's topic/consumer-group root, which this phase must leave alone. Because tables/collections are excluded, "tables first" needs no separate sort — they are the residue of the partition, in the order the adapter already sorted them (realities #2). MariaDB's `function` folder holds procedures too (realities #3), so it borrows §5.1's own word for that level. |
| D4 | **Folders start collapsed, and their expand state lives in the same `treeState.expanded` set as everything else — keyed by the synthetic path. `ProjectTree.vue`'s `onToggle` gains a group branch that flips the set directly and never calls `expand()`.** | Collapsed-by-default is the entire point of grouping: a schema with 40 functions currently pushes its tables off-screen. `expand()` (`state/tree.ts:111-130`) connects the connection and calls `loadChildren` for the row's path — for a synthetic path that would be an IPC call for a node no adapter has ever heard of, so the branch is mandatory, not stylistic. Reusing the one `expanded` set keeps `collapseAll()`, `dropConnectionState()` and the search-time `descendantMatch` expansion (`state/tree.ts:288`) working on folders for free. |
| D5 | **Tables, views and matviews become leaves: the two SQL adapters stop emitting column nodes and set `hasChildren: false`, *and* the renderer suppresses the twisty for those kinds regardless of what a cached node says (`isLeafKind`).** `postgres/index.ts`'s depth-3 branch and `mariadb/index.ts`'s depth-2 branch return `[]` for every object kind; `listColumnNodes` is deleted from both. | The adapter change is the honest one. The renderer guard exists because L1 has no TTL and is only rewritten on reconnect or explicit Refresh (realities #5) — without it, every already-cached schema listing would keep a live twisty on its tables that expands to a now-empty list. Two lines, and the phase's most visible change is instant instead of "after you reconnect". Deleting `listColumnNodes` also removes three catalog queries per table expand (realities #4). |
| D6 | **No migration, no cache bump, no cleanup pass for the removed column rows.** Stale `metadata_cache` rows keyed at a table's own path are inert (nothing asks for that path's children any more) and are dropped wholesale on the connection's next reconnect invalidation. | Tree expand state is not persisted at all (realities #6), so there is no stored expansion to migrate. §7 already specifies that a connection's whole metadata set is refreshed on every reconnect, which is the existing, sufficient reaper. Writing a bespoke purge would add a migration whose only job is to delete rows that a reconnect deletes anyway. |
| D7 | **The view is one tab with a two-way `<Segmented>`: `Structure` (default) and `Source`. The chosen pane is persisted per tab in `DefinitionTabState.pane`.** The mockup's four-way `Definition/Columns/Indexes/Constraints` segmentation is *not* built; Columns, Indexes and Constraints become stacked sections **inside** Structure, each with a count badge. | The deliverable asks for "a nicely parsed structured display (columns/indexes/constraints)" — one display containing all three — "with a toggle to see the raw SQL text". Four mutually exclusive segments would hide a table's indexes while you read its columns, which is exactly backwards for the primary use (understanding a table at a glance), and would make "the toggle to raw SQL" one of four peers rather than the alternate view the sentence describes. `Segmented.vue` already exists (realities #18), and persisting the choice costs one field on a tab state that was previously empty. |
| D8 | **Structure is fed by two existing, independently-cached calls: `control.treeDescribe(path)` for columns/indexes/PK/FKs/comment/row estimate, and `control.treeDefinition(path)` for the source text, constraints and Mongo's validator.** Neither duplicates the other; `ObjectMeta` gains no fields. | `describe()` already returns everything a Structure pane needs about columns and indexes, for every engine including Mongo (realities #9, #10), it is L1-cached, and the grid already consumes it exactly this way (`views/grid/state.ts:70-80`) — re-deriving it inside `definition()` would mean two adapters computing the same list twice and two cache entries that can disagree. Conversely `constraints`/`documentSchema` must *not* go on `ObjectMeta`: `loadMeta()` runs on every data-tab open, so a constraint query there would tax the hot path for a pane most tabs never show. Two cache-aside calls on one view is the app's own established pattern, not a new one. |
| D9 | **Every affordance the column tree rows carried moves into the Columns section**: the per-type icon (`columnTypeIcon`, realities #19), the `PK` badge, the type/nullable/default/comment text, and a right-click menu with §8.10's exact three items — Copy name, Add to projection, Sort by — reusing `menus.ts`'s existing `setProjection`/`setSort` calls against the table's own data tab. `menus.ts`'s `columnMenu` keeps its `'index'` case (Mongo index leaves still exist) and loses its `'column'` case. | §8.10's "Column (tree)" row is a spec commitment; a phase that deletes the rows carrying it must relocate it, not drop it (ground rule 1). The logic is already written — `targetTabFor()` resolves or opens the table's data tab and the two setters are unchanged — the only adaptation is that the table path is `tab.path` directly instead of `pathParent(row.path)`. SPEC §8.10's row is retitled "Column (definition view)" in the same commit. |
| D10 | **The `'column'` NodeKind literal stays in `nodeKindSchema`; every producer of it is deleted.** | `decodePath` throws on an unknown kind (`shared/domain/tree.ts:49-50`), and `metadata_cache` rows keyed at `…/column:id` paths exist on disk today; keeping the literal keeps that function total over already-persisted strings for the cost of one enum member. Nothing reads it into the UI any more, and `icons.ts`'s `KIND_ICON` entry stays as the Structure pane's fallback icon. |
| D11 | **`ObjectDefinition.constraints` is a `{name, type, definition}` list with a five-member type enum** (`primaryKey`/`unique`/`foreignKey`/`check`/`exclusion`). Postgres fills it from the `pg_constraint` query it **already runs** to compose its DDL; MariaDB fills it from one added `information_schema.TABLE_CONSTRAINTS` ⟕ `CHECK_CONSTRAINTS` query on the definition path only; Mongo returns `[]`. The Constraints section merges this with `ObjectMeta.foreignKeys`/`referencedBy`, de-duplicated by name, so inbound references appear as their own rows. | The deliverable names constraints explicitly, and `ObjectMeta` has no CHECK/EXCLUDE information at all — building the section from PK/FK/unique indexes alone would silently drop every check constraint from a "structured display of constraints", which is the kind of quiet half-answer AGENTS.md rules out. Postgres pays nothing (realities #13). MariaDB pays one query, on a path a user opened deliberately, never on the data-tab hot path. The engine's own `definition` text is rendered verbatim rather than re-composed, for the same reason `mariadb/ddl.ts` passes `SHOW CREATE` through untouched: the server's wording is the truth, ours would be an approximation. |
| D12 | **Mongo gets `caps.definition: true` and a real `definition()`.** Source = the collection's creation-options document from `db.listCollections({ name }, {})`, EJSON-relaxed, 2-space, `language: 'json'`, `origin: 'server'` (`'{}'` with a note when the collection has no options). Structure = the indexes `describe()` already returns, plus a **Validation** section built from `documentSchema`: the `$jsonSchema` sub-document rendered as a field table (name / bsonType / required / description), the `validationLevel`/`validationAction` as chips, and an honest "No validator set on this collection." when there is none. A validator that is *not* a `$jsonSchema` (an arbitrary query document like `{ age: { $gte: 18 } }`) renders as read-only JSON instead of a table. | Realities #10-12: the indexes are already on the wire, the driver already types `options`, and EJSON is already this adapter's serialization. Relaxed mode is deliberate — strict EJSON would render a schema's `minimum: 5` as `{"$numberInt":"5"}` in a pane whose whole job is readability, and a `$jsonSchema` is plain JSON by construction so nothing is lost. The non-`$jsonSchema` fallback exists because Mongo genuinely allows it; pretending every validator is a JSON Schema would mean rendering an empty table for a validator that is doing real work. The tree keeps `nameOnly: true` (realities #11) — the options fetch belongs on the path that needs it, not on every database expand. |
| D13 | **`caps.ddl` becomes `caps.definition`, and it is the single gate for the menu item and the tab — `true` for postgres, mariadb and mongodb; `false` for redis, kafka, sqs and s3.** No second flag, no `caps.structure`. | One capability answers one question ("does this engine have an object definition to show?"), and every non-`true` adapter keeps its existing `E_UNSUPPORTED` throw and its "never reached" comment, retargeted. Splitting it would create a gate matrix with no engine in the interesting cells: nothing here has structure without a source or a source without structure. |
| D14 | **The rename, in full.** Identifiers below change; everything not listed keeps the word "DDL" because it genuinely means SQL Data Definition Language. | Enumerated so the implementation has nothing to infer. |

**D14 — old → new, exhaustively**

| Old | New | Notes |
|---|---|---|
| `src/shared/domain/ddl.ts` | `src/shared/domain/definition.ts` | file |
| `sourceTextSchema` / `SourceText` | `objectDefinitionSchema` / `ObjectDefinition` | + 3 new fields (§2) |
| `ddlOriginSchema` / `DdlOrigin` | `definitionOriginSchema` / `DefinitionOrigin` | values unchanged |
| `ddlText()` | `definitionText()` | gains the `language` branch |
| `Adapter.ddl()` | `Adapter.definition()` | all 7 adapters |
| `Caps.ddl` / `capsSchema.ddl` | `Caps.definition` / `capsSchema.definition` | mongo flips to `true` |
| `ENGINE_OP.ddl` = `'adapter:ddl'` | `ENGINE_OP.definition` = `'adapter:definition'` | in-process only |
| `IPC.treeDdl` = `'kira:tree:ddl'` | `IPC.treeDefinition` = `'kira:tree:definition'` | in-process only |
| `TreeDdlResult { ddl, source }` | `TreeDefinitionResult { definition, source }` | `ipc.ts`, `tree-service.ts` |
| `TreeService.ddl()`, `kira.treeDdl`, `control.treeDdl` | `.definition()`, `kira.treeDefinition`, `control.treeDefinition` | preload + bridge |
| `MetaKind 'ddl'`, `CachedPayload.ddl` | `'definition'`, `.definition` | self-healing (realities #16) |
| `opKindSchema` member `'ddl'` | `'definition'` | coerced on read, D15 |
| `tabKindSchema` member `'ddl'` | `'definition'` | coerced on read, D15 |
| `ddlTabStateSchema` / `DdlTabState` / `DdlTabRecord` / `defaultDdlTabState` | `definitionTabStateSchema` / `DefinitionTabState` / `DefinitionTabRecord` / `defaultDefinitionTabState` | + `pane` field |
| `openDdlTab()` | `openDefinitionTab()` | `state/tabs.ts`, `menus.ts`, `duplicateTab`'s branch |
| `src/renderer/views/ddl/` → `DdlView.vue`, `DdlViewRuntime` | `views/definition/` → `DefinitionView.vue`, `DefinitionViewRuntime` | + `structure.ts`, section components |
| `postgres/ddl.ts`, `mariadb/ddl.ts`, `buildDdl()` | `postgres/definition.ts`, `mariadb/definition.ts`, `buildDefinition()` | |
| menu id `open-ddl`, label `Open DDL` | `open-definition`, `Open definition` | `menus.ts`, `tree.spec.ts:298` |
| testids `ddl-view`, `ddl-reconnect`, `ddl-reconnect-load`, `ddl-target`, `ddl-refresh`, `ddl-copy`, `ddl-open-console`, `ddl-error`, `ddl-notes` | `definition-…` (same suffixes) | + new `definition-pane`, `definition-columns`, `definition-indexes`, `definition-constraints`, `definition-validation`, `definition-source` |
| `data-read-only-reason="ddl-not-editable"` | `"definition-not-editable"` | |
| `tests/ui/ddl.spec.ts` | `tests/ui/definition.spec.ts` | 47 references |
| **Stays "DDL":** SPEC §1's "DDL is read-only but modelled for editing" and its v2 "DDL editing" line; `ConnectionDialog.vue:411`'s read-only helper text ("grid edits, DDL, and console writes"); `postgres/console.ts:96`'s statement-classification comment; `mariadb/definition.ts`'s `SHOW CREATE TABLE` note text; `redis/mutate.ts:68`'s historical reference to P4's scope. | — | each names SQL DDL itself, not this feature |

| # | Decision | Rationale |
|---|----------|-----------|
| D15 | **Session restore keeps every already-open DDL tab, and the ops panel keeps its history, via one legacy-value mapping in each storage repo** — `repos/tabs.ts` maps a stored `kind === 'ddl'` to `'definition'` (and `{}` state to `{ pane: 'structure' }` via the schema default) before `safeParse`; `repos/ops.ts` maps `'ddl'` to `'definition'` before its own. The domain unions stay closed — neither schema gains a legacy member. | Both repos currently *drop* a row whose enum member doesn't parse (realities #14, #15), so doing nothing would silently close a user's open DDL tabs on first launch and blank the `ddl` rows out of the Operations panel. `tabs.kind` is untyped `TEXT` (no CHECK), so no SQL migration is involved either way. Putting the mapping at the read boundary — the single place a persisted enum string enters the process — rather than in the Zod union keeps the rest of the app unable to express the old value at all, and makes the compatibility shim one greppable line per file that a later phase can delete outright. |
| D16 | **`tests/ui/ddl.spec.ts` becomes `tests/ui/definition.spec.ts` and is rewritten, not merely renamed.** Scenario 2's column-row menu assertion (`:238-241`) and scenario 8's tab-kind attributes change; three new blocks are added — the Structure/Source toggle and its persistence across a relaunch, the Columns/Indexes/Constraints sections against `wide_table`/`order_items`, and a Mongo block (new `startMongo` fixture in this spec) covering indexes + validator + no-validator. `tree.spec.ts` (`:204-220` column expansion, `:294-306` menu id list, `:314-316` column menu, `:336-337` re-expand), `mariadb.spec.ts:31,131`, `console.spec.ts:33,188-191` and `leaks.spec.ts:131,191` are updated in the same commit. | A restructure this size cannot leave a spec asserting the old shape "still passing because it happens to be skipped". Every one of those five files asserts something P19 changes, and each is listed here with its line so the implementation cannot miss one. `budgets.spec.ts` needs no change (realities #20) and that is worth verifying rather than assuming. |
| D17 | **The DB specs' column assertions move to `describe()`, they do not disappear.** `postgres.spec.ts:136-146` (60 columns of `wide_table`) and `:167-185` (the `weird"name` / `Order Items` quoting cases) and `mariadb.spec.ts:141,171,180` re-target `adapter.describe(...).columns`; `mongo.spec.ts:129,178-185` flips from "ddl is unsupported" to a real definition scenario. The mongo seed (`fixtures/0003_mongo_seed.ts`) gains a `validated_widgets` collection created with a `$jsonSchema` so both validator branches are covered. | Those quoting assertions are the only coverage that a table whose name contains a quote or a space survives the catalog round trip — they test identifier binding, not tree shape, and `listColumns` (which they exercise) is unchanged and still reached by `describe()`. Moving them preserves the coverage; deleting them alongside the tree rows would quietly lose it. |
| D18 | **SPEC.md is updated in the same commit**: §5's `Caps` block and `Adapter` interface (`ddl` → `definition`), §5.1's Mongo row and `caps.ts`'s own documentation table (mongo's `ddl: no` → `definition: yes`), §8.4's tab-kind list, §8.10's "Open DDL" → "Open definition" and its "Column (tree)" row retitled "Column (definition view)", §8.3's tree description gaining the grouping rule, a new §8.12-adjacent paragraph describing the definition view's two panes, §11's repo layout (`views/ddl/` → `views/definition/`, adapters' `ddl.ts` → `definition.ts`), and the P19 phasing row rewritten from "Not yet implemented" to what shipped — the same treatment P17's and P18's rows got. | The spec is the contract every later phase reads; leaving it describing a `ddl` capability and a tree that expands tables would make it actively misleading, and §11's fixed per-adapter file list (`index.ts`/`client.ts`/`query.ts`/`ddl.ts`/`read.ts`) is quoted as a rule at SPEC.md:601. |

## 4. Implementation order

1. **Tree grouping, renderer-only.** `project/grouping.ts` (`GROUPED_KINDS`, `partitionChildren`,
   `isLeafKind`), `groupPath()` in `state/tree.ts`, `TreeRowVm.kind` widened to include `'group'`,
   `buildRows()` emitting folder rows and recursing into their member lists, `ProjectTree.vue`'s
   `onToggle`/`onOpen` group branches (a folder toggles; double-click toggles; it opens nothing),
   `TreeRow.vue`'s `folder`/`folder-opened` icon branch, `menus.ts`'s `'group'` case (Refresh the
   *parent*, Collapse all — nothing that needs a real node). Tables and columns are untouched here,
   so the tree still behaves as it does today apart from the four folders.
2. **Tables become leaves.** Delete `listColumnNodes` from `postgres/index.ts` and
   `mariadb/index.ts`, return `[]` for every depth-3/depth-2 object kind, set `hasChildren: false`
   in both catalogs, apply `isLeafKind` in `buildRows`. Move the DB specs' column assertions to
   `describe()` (D17). `menus.ts` loses its `'column'` case. `bun run test:db` green here.
3. **The rename, mechanically, with no behaviour change.** Every row of D14's table, in one commit:
   `shared/domain/definition.ts` (with `language`, `constraints`, `documentSchema` added but
   `constraints: []` / `documentSchema: null` from every adapter for now), caps, engine op, IPC
   channel, tree-service, metadata-cache key, tab kind + `pane` state, `openDefinitionTab`,
   `views/definition/`, both adapters' `definition.ts`, the menu item, every testid, and D15's two
   coercion lines. `tests/ui/definition.spec.ts` is the renamed file, updated for the new
   ids/testids only. Everything is green and the app looks identical except for the menu label.
4. **Structured data on the wire.** Postgres's `definition()` returns its already-queried
   constraints as `ConstraintMeta[]`; MariaDB's gains the `TABLE_CONSTRAINTS`/`CHECK_CONSTRAINTS`
   query. `tests/db/postgres.spec.ts`/`mariadb.spec.ts` assert the constraint lists.
5. **The Structure pane.** `views/definition/structure.ts` (`ConstraintRow` merge,
   `jsonSchemaFields`), the section components (Columns, Indexes, Constraints, Validation) and
   `DefinitionView.vue`'s `<Segmented>` + second `treeDescribe` load, with the Source pane wired to
   the existing body verbatim. `columnTypeIcon` gets its second caller; the Columns rows get D9's
   three-item context menu.
6. **Mongo.** `caps.definition: true`; `mongo/definition.ts` (options fetch, EJSON source,
   `documentSchema`); `mongo/index.ts`'s throw replaced. Seed a validated collection (D17) and add
   the mongo scenarios to `tests/db/mongo.spec.ts`.
7. **Tests and docs.** The rest of D16's spec updates, the new UI blocks, then SPEC.md per D18 and
   this plan committed alongside.

## 5. Explicitly out of scope

- **Editing anything.** The definition view stays read-only in both panes (SPEC §1: "DDL is
  read-only but modelled for editing"). No CREATE/ALTER/DROP, no index builder, no validator editor.
- **Index/constraint tree nodes for SQL tables.** Tables become leaves; they do not trade column
  children for index children. Mongo's index leaves stay exactly as P8's D10 put them (SPEC §5.1
  names them explicitly) — a collection's children are homogeneous, so D3's list gives them no
  folder either. §8's open question 2 revisits this if the inconsistency bothers.
- **Folders for Redis, Kafka, SQS and S3 levels.** None of those emit any kind in `GROUPED_KINDS`,
  so they are untouched by construction, not by exception (D3).
- **A definition view for sequences, functions, indexes, redis keys, kafka topics or s3 objects.**
  `caps.definition` gates the tab, and the two SQL adapters still throw `E_UNSUPPORTED` for
  `sequence`/`function` paths exactly as they do today. Making a function's body openable is a real
  feature (it needs `pg_get_functiondef`/`SHOW CREATE FUNCTION` and a `function` node menu) and is
  not what §10's P19 row asks for.
- **Persisting or configuring the grouping.** No setting to turn folders off, no per-connection
  override, no drag-reorder. The `connection_filters` dialog keeps its existing
  database/schema/table scope (`project/filter.ts:30`) and gains no folder rules.
- **Clickable navigation from a foreign-key constraint row to the referenced table.**
  `ConstraintRow.referencedPath` is carried (P7 already computes it) so a later phase can wire it,
  but no navigation ships here — P7's PK/FK cell navigation remains the only such affordance.
- **Diffing, exporting or copying the structured pane.** Copy stays what it is today: the Source
  text, via the existing `definition-copy` button.
- **Renaming `metadata_cache.kind`'s stored values or writing a SQL migration for any of it.** D6,
  D15 and realities #16 cover why none is needed.

## 6. Target tree at the end of P19

```
src/shared/
  domain/ddl.ts                DEL  -> domain/definition.ts
  domain/definition.ts         NEW  ObjectDefinition (+ language, constraints, documentSchema),
                                    ConstraintMeta, DocumentSchemaMeta, definitionText()
  domain/tabs.ts               MOD  tabKindSchema 'ddl'->'definition'; definitionTabStateSchema
                                    gains `pane`; RENDERABLE_TAB_KINDS; DefinitionTabRecord
  domain/ops.ts                MOD  opKindSchema 'ddl' -> 'definition'
  domain/tree.ts                --  UNCHANGED ('column' kept, D10; ObjectMeta untouched, D8)
  caps.ts                      MOD  Caps.ddl -> Caps.definition (+ the §5.1 doc table)
  protocol/engine-ops.ts       MOD  ENGINE_OP.definition, payload/result schemas
  protocol/ipc.ts              MOD  IPC.treeDefinition, TreeDefinitionResult
src/engine/adapters/
  adapter.ts                   MOD  ddl() -> definition()
  postgres/ddl.ts              DEL  -> postgres/definition.ts
  postgres/definition.ts       NEW  buildDefinition() — same SQL, now also returns constraints (D11)
  postgres/index.ts            MOD  definition(); depth-3 returns []; listColumnNodes deleted
  postgres/catalog.ts          MOD  hasChildren: false for relations
  mariadb/{ddl.ts -> definition.ts, index.ts, catalog.ts}  same three changes + the constraints query
  mongo/caps.ts                MOD  definition: true
  mongo/definition.ts          NEW  listCollections options -> EJSON source + documentSchema (D12)
  mongo/index.ts               MOD  definition() implemented; children() unchanged
  mongo/catalog.ts             MOD  collectionOptions() helper; listCollections keeps nameOnly
  {redis,kafka,sqs,s3}/{caps,index}.ts  MOD  caps.definition: false; throw retargeted
src/main/
  tree-service.ts              MOD  definition() + TreeDefinitionResult + objectDefinitionSchema
  ipc/tree.ts                  MOD  IPC.treeDefinition handler
  storage/repos/metadata-cache.ts MOD  MetaKind 'definition'
  storage/repos/tabs.ts        MOD  legacy 'ddl' -> 'definition' coercion (D15)
  storage/repos/ops.ts         MOD  legacy 'ddl' -> 'definition' coercion (D15)
src/preload/index.ts           MOD  treeDefinition
src/renderer/
  project/grouping.ts          NEW  GROUPED_KINDS, partitionChildren(), isLeafKind() (D3/D5)
  project/state/tree.ts        MOD  'group' rows in buildRows(), groupPath(), TreeRowVm.groupKind
  project/ProjectTree.vue      MOD  group branches in onToggle/onOpen
  project/TreeRow.vue          MOD  folder icon for group rows
  project/menus.ts             MOD  'group' case; 'column' case removed; open-definition item
  project/icons.ts              --  UNCHANGED (columnTypeIcon gains a second caller, D9/#19)
  bridge/control.ts            MOD  treeDefinition
  state/tabs.ts                MOD  openDefinitionTab, duplicateTab branch
  views/ddl/                   DEL  -> views/definition/
  views/definition/
    DefinitionView.vue         NEW  Segmented(Structure|Source) + both loads (D7/D8)
    state.ts                   NEW  DefinitionViewRuntime { definition, meta, status, error, source }
    structure.ts               NEW  ConstraintRow merge, jsonSchemaFields() (D11/D12)
    ColumnsSection.vue         NEW  type icon, PK badge, D9's context menu
    IndexesSection.vue         NEW  shared by SQL and Mongo
    ConstraintsSection.vue     NEW  SQL only
    ValidationSection.vue      NEW  Mongo only
  workbench/panels/MainView.vue   MOD  'definition' branch
  workbench/panels/TabStrip.vue   MOD  'definition' icon case (still file-code)
tests/db/
  fixtures/0003_mongo_seed.ts  MOD  validated_widgets with a $jsonSchema (D17)
  postgres.spec.ts             MOD  column assertions -> describe(); constraints; renamed ddl scenario
  mariadb.spec.ts              MOD  same three
  mongo.spec.ts                MOD  '7. ddl is unsupported' -> a real definition scenario
  {kafka,redis,sqs,s3}.spec.ts MOD  caps.definition assertions
tests/ui/
  ddl.spec.ts                  DEL  -> definition.spec.ts
  definition.spec.ts           NEW  the old 10 scenarios, updated, + Structure/Source, sections, Mongo
  tree.spec.ts                 MOD  folders; no column rows; menu id list; group toggling
  mariadb.spec.ts              MOD  column-row assertion -> definition view
  console.spec.ts              MOD  column-row menu assertion
  leaks.spec.ts                MOD  menu id + view testid
  budgets.spec.ts               --  UNCHANGED (verified: expands a schema, waits on a table, #20)
docs/
  SPEC.md                      MOD  §5, §5.1, §8.3, §8.4, §8.10, §11, P19 phasing row (D18)
  plans/P19-tree-reorg-definition-view.md  NEW  this document
```

## 7. Acceptance checklist

- [ ] A Postgres schema shows its tables first, ungrouped, in the same order as today, followed by
      collapsed **Views**, **Materialized views**, **Sequences** and **Functions** folders; a folder
      with no members does not render.
- [ ] A MariaDB database shows the same, with the function folder labelled **Routines** and no
      Materialized views folder.
- [ ] Expanding a folder issues **zero** IPC calls and zero op-log rows (D2/D4) — asserted, not
      assumed.
- [ ] Mongo, Redis, Kafka, SQS and S3 trees are byte-for-byte what they are today: no folders, no
      reordering, collection index leaves intact.
- [ ] A table, view and matview row shows **no twisty** and does nothing on double-click except open
      its data tab — including on a connection whose schema listing was cached before the upgrade
      and has not reconnected since (D5).
- [ ] Search still finds a table by name, still marks the result, and a match inside a folder auto-
      expands that folder (the existing `descendantMatch` rule extended to group rows).
- [ ] `Open definition` appears on table/view/matview rows for Postgres and MariaDB **and on
      collection rows for Mongo**, and on nothing for Redis/Kafka/SQS/S3.
- [ ] The definition tab opens on **Structure** by default, showing Columns (with type icon, PK
      badge, type, nullable, default, comment), Indexes and Constraints sections with count badges;
      switching to **Source** shows exactly today's DDL text, highlighted, read-only, with the same
      notes strip and the same Copy behaviour.
- [ ] A CHECK constraint defined on the fixture table appears in the Constraints section on both
      Postgres and MariaDB, and an inbound foreign key appears as its own row (D11).
- [ ] Right-clicking a Columns row offers exactly **Copy name / Add to projection / Sort by**, and
      each does what the tree's column menu did (D9).
- [ ] A Mongo collection's definition tab shows its indexes, its `$jsonSchema` fields as a table
      with `validationLevel`/`validationAction` chips, and its creation-options document on the
      Source pane; a collection with **no** validator shows the honest empty state rather than an
      empty table.
- [ ] A Mongo validator that is not a `$jsonSchema` renders as read-only JSON, not as an empty field
      table (D12).
- [ ] The selected pane survives a tab switch **and a relaunch** (D7's `pane` state).
- [ ] Reopening a definition tab hits L1 (`data-source="cache"`, no new op-log row); Refresh forces
      exactly one new `definition` op — the existing scenario-6 assertions, retargeted.
- [ ] **An app upgraded over an existing `kira.sqlite` restores its previously-open DDL tabs as
      definition tabs, and its Operations panel still lists the old `ddl` rows** (D15) — the single
      most important backward-compatibility assertion in this phase.
- [ ] `docs/PERF.md`'s cached tree expand budget still passes unchanged (realities #20).
- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` and `bun run test:db` green, including the renamed spec and the
      new Mongo scenarios.
- [ ] No identifier named `ddl`/`Ddl`/`DDL` remains outside D14's "Stays DDL" list — verified by
      grep, in the same commit.

## 8. Open questions for the user

1. **Is "definition" the right word?** §1 argues it from SPEC.md's own P19 wording and from
   `adapter.ts:84`'s existing doc comment, with the panes named Structure and Source. The main
   alternative is naming the whole feature **Structure** ("Open structure"), which reads slightly
   more concretely for a Mongo collection but then leaves the parsed pane needing a second name.
   Worth confirming before step 3, since the rename is one commit and cheap to steer *before* it and
   tedious after.
2. **Should a Mongo collection also stop expanding, moving its index leaves into the definition view
   entirely?** This plan says no: SPEC §5.1 names "database → collections (+ indexes)" explicitly,
   P8's D10 made each index an addressable node deliberately, and a handful of indexes is not the
   60-row flood that motivated removing columns. But it does leave the tree slightly inconsistent —
   a table is a leaf while a collection is not. Flipping it is a two-line change in
   `mongo/index.ts` plus `isLeafKind`.
3. **Should folders default to expanded rather than collapsed (D4)?** Collapsed is what makes
   "tables first" actually pay off on a schema with 40 functions. Expanded would preserve today's
   at-a-glance view of everything at the cost of the deliverable's main benefit. One-line flip,
   worth deciding deliberately rather than discovering.
4. **How much does a *function's* definition matter?** §5 scopes it out: `Open definition` stays
   unavailable on sequence and function rows, exactly as `Open DDL` is today. Now that functions get
   their own folder and are therefore more visible, showing `pg_get_functiondef` / `SHOW CREATE
   FUNCTION` in the same view is a small, natural follow-on — but it is genuinely new adapter work
   and a new menu case, so it belongs in its own phase unless it is wanted now.

## 9. Addendum — open question 2 resolved

The inconsistency did bother: a Mongo collection now also stops expanding. `mongo/index.ts`'s
`children()` returns `[]` for a collection path (matching `listCollections`' `hasChildren: false`)
instead of `catalog.listIndexNodes()`; that function is deleted, along with the now-dead `'index'`
NodeKind (`nodeKindSchema`, `icons.ts`'s `KIND_ICON`, `menus.ts`'s `case 'index'` and the tree-only
`columnMenu`/`targetTabFor` it alone called). Indexes are unaffected as data — `describeIndexes()`
still backs `describe()`'s `ObjectMeta.indexes`, which the definition view's Indexes section already
renders. SPEC §5.1's Mongo row updated to match; `tests/db/mongo.spec.ts` scenario 3 now asserts
`hasChildren === false` instead of enumerating index tree nodes, and scenario 5 targets a collection
path directly instead of a now-unrepresentable index path.
