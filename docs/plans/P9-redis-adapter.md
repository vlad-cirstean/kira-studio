# P9 — Redis adapter + key/value view

> Plan for SPEC.md §10 phase **P9**. Deliverable: *Adapter + key/value view.* "Second non-tabular
> shape" — the phasing table's P9 row deliberately omits the "(expand/collapse, edit, delete)"
> suffix that P8's row explicitly carries; read as the scope signal that this phase's view is
> **read-only** (browsing only, no in-UI mutation — writes remain reachable only via the console's
> raw commands, same as any other engine's console).

## 0. Ground rules for this phase

- Build exactly what §5.1's redis row + §8.8 "Key/value view (Redis)" + §8.14's shell-style console
  describe. No pub/sub UI, no cluster topology view, no `KEYS`/unbudgeted `SCAN` anywhere, no
  in-view edit/delete — those are not named anywhere in scope for v1 (and the last is a deliberate
  scope narrowing per the header above).
- §8.8's literal text: "Namespace tree from `SCAN` with `:` splitting; per-type value renderers
  (string, hash, list, set, zset, stream) with TTL and memory usage shown. Never `KEYS`, never
  `SCAN` without a count budget."
- §5.1's redis row: tree = db index → key namespaces split on `:`; default view = key/value;
  pagination = `SCAN` cursor, never `KEYS`, never unbudgeted `SCAN`; exact count = `DBSIZE` only
  (approx per-prefix); cancel = abort the SCAN loop (+ `CLIENT KILL` for blocking commands, but see
  D7 below for why this adapter deliberately does not implement the `CLIENT KILL` half).
- The view is read-only: `caps.writable: false`; `preview()`/`mutate()` both throw `E_UNSUPPORTED`.
  §8.10's right-click coverage table has no Redis/key/namespace row at all (unlike Document's
  explicit row), consistent with there being no in-view mutation UI to put a menu item on.
- `describe()`/`ddl()` are unsupported stubs — `describe()` is only ever called from
  `views/grid/state.ts`/`celleditor/*` (grid-only, confirmed via grep), never reached by a
  `'keyvalue'` tab; `caps.ddl === false` gates the DDL menu item the same way Mongo's does.
- One adapter = one logical connection-set (existing rule #6 in `adapter.ts`, read as "one
  connect() call sets up everything the adapter owns," not literally one socket) — Redis's `SELECT
  n` mutates connection-wide state exactly like MariaDB's implicit per-connection database, so this
  adapter needs a small per-db-index connection pool (`DbConnectionSet`, mirrors MariaDB's
  `ConnectionSet`) rather than one shared connection, unlike Mongo's single pooled client.
- Cancellation: `ctx.signal` is checked between bounded `SCAN`/`HSCAN`/`SSCAN`/`ZSCAN`/`XRANGE`
  round-trips — the sole mechanism (D7 below explains why `CLIENT KILL` is deliberately out of
  scope). `adapter.cancel(opId)` is a no-op returning `false`; `caps.cancel: true` regardless,
  since the primary (and, here, only meaningful) mechanism is fully effective for every op this
  adapter issues.
- No unit tests beyond the two existing suites. `tests/db/redis.spec.ts` is a new numbered-scenario
  file (mirrors `mongo.spec.ts`'s structure) using Testcontainers' Redis image; `tests/ui/redis.spec.ts`
  is a new minimal-but-real UI spec (mirrors `mongo.spec.ts`'s UI counterpart, adapted for read-only
  browsing + console). Run `bun run lint`, `bun run typecheck` (all three project splits),
  `bunx electron-vite build`, `bun run test:db`, and `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. **`Page` is a two-member union with a doc comment reserving this exact widening** —
   `src/shared/protocol/page.ts`: `type Page = TabularPage | DocumentPage; // P9 adds KeyValuePage`.
   `assertPageStructure()` already dispatches on `page.kind`; this phase adds a third arm.
2. **`TextColumnChunk` is reused a second time** — `KeyValuePage` mirrors `DocumentPage`'s exact
   two-fixed-column shape (`fields`/`values` instead of `ids`/`bodies`) rather than inventing a
   third codec.
3. **`Caps`/`PageKind`/`PaginationStrategy` already have the target literals reserved** —
   `PageKind` already includes `'keyvalue'`; `PaginationStrategy` already includes `'cursor'`
   (Mongo uses this same literal for its keyset path); only `PagePosition.strategy`'s narrower
   `z.enum(['keyset','offset'])` needs widening to include `'cursor'`.
4. **`nodeKindSchema` needs exactly three new literals** — `'database'` is already used by Mongo
   (reused as-is for Redis's logical-db level), and this phase adds `'namespace'` (an intermediate
   `:`-delimited tree level) and `'key'` (a leaf, opened as a key/value tab).
5. **`tabKindSchema` already includes `'keyvalue'`**; `RENDERABLE_TAB_KINDS` and
   `tabRecordSchema`'s discriminated union do not yet have the matching member — this phase adds
   `keyValueTabStateSchema`/`defaultKeyValueTabState()`/`asKeyValueTab()` following the
   `documentTabStateSchema` pattern, minus the edit-related fields (read-only).
6. **`connectionKindSchema` already includes `'redis'`**; only `DEFAULT_PORT.redis` (6379) is
   missing from `connection.ts`. `ConnectionDialog.vue`'s `KIND_LABEL` already has `redis: 'Redis'`;
   only `SUPPORTED_KINDS` needs `'redis'` added.
7. **`registry.ts` is a flat object literal** — adding Redis is one import + one entry.
8. **`engine/data.ts`, `engine/cache/{index,pages}.ts`, `renderer/bridge/data.ts` are already fully
   `Page`-generic** (confirmed by reading all four in full this phase) — no changes needed, exactly
   as P8's own reality #8 already established when `DocumentPage` was added.
9. **`Toolbar.vue`'s excluded-kinds check already covers `'console'`/`'document'`** — the same
   self-contained-toolbar precedent applies to `KeyValueView.vue`; one more excluded kind, no other
   change.
10. **`ProjectTree.vue`'s open-dispatch is already kind-aware** (P8 turned the flat `OPENABLE_KINDS`
    set into a branching dispatch for `'collection'`) — this phase adds `'key'` as a third branch
    calling `openKeyValueTab`, alongside the existing `'namespace'`/`'database'` expand-only kinds
    (namespaces and databases are containers, not openable leaves, same as Mongo's `'database'`).
11. **`menus.ts`'s `menuForRow()` switch needs `'namespace'` and `'key'` cases** — per the read-only
    scope decision (ground rules), both are minimal (copy name / copy qualified name / open,
    mirroring `columnMenu`'s shape), with no delete/edit rows (unlike Mongo's document-row-level
    menu, which lives inside `DocumentView.vue` itself, not `menus.ts`, and is unaffected).
12. **`state/tabs.ts`'s `duplicateTab()` is a 4-way dispatch after P8** (document branch added) —
    this phase adds a 5th, `keyvalue`, explicit branch rather than leaving it to a fallthrough.
13. **The MariaDB adapter's `ConnectionSet` (`mariadb/client.ts`) is the direct template** for
    Redis's `DbConnectionSet` — per-key `Map`, LRU eviction, `MAX_CONNECTIONS` cap, `get()`/
    `primary()`/`closeAll()` — because both engines mutate connection-wide state on a `USE`/`SELECT`
    equivalent, unlike Mongo's cheap synchronous `client.db(name)` handle-get.
14. **`ioredis` is not yet a dependency** — `package.json` has `pg`, `mariadb`, `mongodb`, `bson`,
    but no Redis client. This phase adds it.
15. **`scheduler/ops.ts`'s `cancelOp()` aborts `ctx.signal` before calling `adapter.cancel(opId)`** —
    confirmed by reading the scheduler; this ordering is why client-side `ctx.signal` polling
    between bounded SCAN-family round-trips is sufficient on its own (D7), and why `adapter.cancel`
    can safely be a permanent no-op without weakening cancel behavior in practice.
16. **`mariadb/console.ts` has zero `readOnly`-classification references** (confirmed via grep;
    only `mutate.ts` enforces a read-only guard) — Redis's console needs no statement-classification
    logic either; it dispatches every token stream generically through ioredis's `.call()`.

## 1. Shapes introduced in this plan

```ts
// src/shared/protocol/page.ts

// Mirrors DocumentPage's fixed-two-column reuse of TextColumnChunk. 'fields' holds a per-type
// label (e.g. the hash field name, the list index as text, 'value' for a string) and 'values'
// holds the corresponding value text — one row per element for a container type, one row for a
// string. TTL/memory usage/redis type are carried on `KeyValuePage` itself (whole-key metadata,
// not per-row), not encoded into the row shape.
export interface KeyValuePage {
  kind: 'keyvalue';
  position: PagePosition;
  redisType: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream';
  ttlMs: number | null; // null = no expiry (PTTL returned -1)
  memoryBytes: number | null; // null = MEMORY USAGE unavailable/failed (best-effort)
  fields: TextColumnChunk;
  values: TextColumnChunk;
  rowCount: number;
  byteSize: number;
}

export type Page = TabularPage | DocumentPage | KeyValuePage;

export function createKeyValuePageBuilder(opts: {
  redisType: KeyValuePage['redisType'];
  ttlMs: number | null;
  memoryBytes: number | null;
}): {
  push(field: string, value: string): void;
  build(position: PagePosition): KeyValuePage;
};

// assertPageStructure gains a third `page.kind === 'keyvalue'` arm, validating fields/values the
// same way the document arm validates ids/bodies.
export function assertPageStructure(page: Page): void;

// PagePosition.strategy widens: z.enum(['keyset', 'offset', 'cursor']) — SCAN-family cursors are
// opaque server-side cookies, matching Mongo's 'cursor'-shaped-but-different case only in name;
// the token itself is whatever ioredis's SCAN returns, base64url-wrapped like every other token.
```

```ts
// src/engine/adapters/redis/caps.ts
export const redisCaps: Caps = {
  tree: { levels: ['database', 'namespace', 'key'], leafHasChildren: false },
  defaultView: 'keyvalue',
  pagination: 'cursor',
  count: 'estimate-only', // DBSIZE for the db-wide count; per-namespace counts are approximate
  cancel: true,
  writable: false,
  sql: true, // shell-style console, per §8.14
  ddl: false,
  foreignKeys: false,
};
```

```ts
// src/engine/adapters/redis/client.ts
// Mirrors mariadb/client.ts's ConnectionSet exactly, keyed by logical db index (0-15) instead of
// database name — SELECT mutates connection-wide state the same way USE does for MariaDB.
export class DbConnectionSet {
  constructor(makeConnection: (dbIndex: number) => Redis, maxConnections?: number);
  get(dbIndex: number): Promise<Redis>;
  primary(): Redis | null;
  closeAll(): Promise<void>;
}
export function connectRedis(cfg: ResolvedConnectionConfig): Promise<{
  set: DbConnectionSet;
  defaultDbIndex: number;
}>;
```

```ts
// src/engine/adapters/redis/catalog.ts
// listDatabases: INFO keyspace, one 'database' node per non-empty db (name db{N}), not all 16.
export function listDatabases(primary: Redis): Promise<TreeNode[]>;
// listNamespaceChildren: bounded SCAN with MATCH `${prefix}*` COUNT <budget>, splitting each
// returned key on the first ':' after the prefix into either a deeper 'namespace' node (dedup'd)
// or a 'key' leaf (name = the complete literal key, not just its last segment).
export function listNamespaceChildren(
  conn: Redis,
  prefix: string, // '' at the db root
  ctx: OpCtx,
): Promise<TreeNode[]>;
```

```ts
// src/engine/adapters/redis/read.ts
// Dispatches on TYPE key, then per-type: GET (string), HSCAN (hash), SSCAN (set), ZSCAN (zset),
// LRANGE index-window (list, offset strategy), XRANGE id-cursor (stream). PTTL + best-effort
// MEMORY USAGE attached to every page. A key that no longer exists at read time throws
// AdapterError('E_QUERY', ...) — deliberately not E_NOT_FOUND, which DISCONNECTED_CODES already
// overloads to mean "adapter/connection gone" and would wrongly trigger the reconnect-prompt UI.
export function readKey(conn: Redis, key: string, req: ReadRequest, ctx: OpCtx): Promise<KeyValuePage>;
// Exact via O(1) type-length commands (HLEN/SCARD/ZCARD/LLEN/XLEN/1-for-string) → exactCount: true.
export function countKey(conn: Redis, key: string, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;
```

```ts
// src/engine/adapters/redis/console.ts
// Hand-written whitespace tokenizer (single/double-quote aware, no JSON-literal nesting — real
// Redis CLI syntax, not a JSON DSL like Mongo's shell). Each line dispatches generically via
// conn.call(commandName, ...args) — no per-command switch, unlike Mongo's console. Any RESP reply
// is formatted generically into a KeyValuePage: an array becomes one row per element, a
// primitive/null becomes a single row.
export function execute(set: DbConnectionSet, dbIndex: number, ctx: OpCtx, statements: string): Promise<Page[]>;
```

```ts
// src/engine/adapters/redis/index.ts
export function createRedisAdapter(deps: AdapterDeps): Adapter;
// preview()/mutate() both throw AdapterError('E_UNSUPPORTED', ...) — read-only per ground rules.
// cancel(opId) is a permanent no-op returning false (D7) — ctx.signal is the sole mechanism.
```

```ts
// src/shared/domain/tabs.ts
export interface KeyValueTabState {
  status: 'idle' | 'loading' | 'error';
  error: string | null;
}
export function defaultKeyValueTabState(): KeyValueTabState;
export function asKeyValueTab(tab: TabRecord): KeyValueTabRecord | null;
```

```ts
// src/renderer/state/tabs.ts
export function openKeyValueTab(connectionId: string, path: string, opts?: { newTab?: boolean }): string;
export function patchKeyValueTabState(tabId: string, patch: Partial<KeyValueTabState>): void;
export function findKeyValueTab(connectionId: string, path: string): TabRecord | undefined;
```

```ts
// src/renderer/views/keyvalue/state.ts — mirrors views/documents/state.ts's runtime shape, minus
// any mutation-related exports (read-only).
export function load(tabId: string, opts?: { refresh?: boolean }): Promise<void>;
export function goNext(tabId: string): Promise<void>;
export function goPrev(tabId: string): Promise<void>;
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | `KeyValuePage` reuses `TextColumnChunk` as a fixed two-column (`fields`, `values`) shape, exactly mirroring `DocumentPage`; TTL/memory/type are page-level metadata fields, not encoded into rows. | Realities #1-2; a key's rows (hash fields, list indices, etc.) are homogeneous per-type but the whole-key metadata (TTL, memory, type) applies once per page, not once per row — matching how the real Redis client APIs (`TYPE`, `PTTL`, `MEMORY USAGE`) return it. |
| D2 | The view is **read-only**: `caps.writable: false`, `preview()`/`mutate()` throw `E_UNSUPPORTED`; no edit/delete UI anywhere in `KeyValueView.vue`. | The phasing table names "(expand/collapse, edit, delete)" for P8 but omits it for P9 — read as a deliberate scope line, reinforced by §8.10's right-click table having no Redis-specific row at all (unlike Document's explicit row). Writes stay reachable through the console's raw commands, consistent with every other engine's console being a full escape hatch. |
| D3 | Leaf `'key'` tree nodes store the **complete literal Redis key** as their `name`, not a single `:`-delimited segment; intermediate `'namespace'` nodes store only their own local segment. | Sidesteps any ambiguity in reconstructing a key from ancestor path segments (colons inside a segment's own text vs. colons used as the tree's own separator) — `read()`/`count()` take the leaf's `name` directly as the real key, no joining logic needed at the point of use. |
| D4 | `catalog.listNamespaceChildren()` reconstructs the `SCAN MATCH` prefix by joining only the `'namespace'`-kind ancestor segments collected during tree descent (not the leaf), since a `'key'` node is never itself expanded. | Consistent with D3 — the join only ever needs to happen going *down* the tree (building a prefix to scan), never coming back *up* (turning a leaf into a key), which is the operation D3 already made trivial. |
| D5 | Root-level `children()` lists only non-empty logical Redis databases via `INFO keyspace`, not a fixed 0-15 sweep. | `INFO keyspace` returns exactly the `dbN:keys=...` lines for databases that actually hold data — sweeping all 16 unconditionally would mean 15 empty `SELECT`+`DBSIZE` round-trips in the common single-db-in-use case, with no information gained (an empty db has no children to show anyway). |
| D6 | Per-type read dispatch: `GET` (string, single row); `HSCAN`/`SSCAN`/`ZSCAN` (hash/set/zset, cursor-looped up to the page's budget); `LRANGE` index-window (list, offset strategy); `XRANGE` id-cursor (stream). Count uses O(1) exact type-length commands (`HLEN`/`SCARD`/`ZCARD`/`LLEN`/`XLEN`, or 1 for a string) → `exactCount: true` for a single key's count. | Matches §8.8's named renderer list exactly (string/hash/list/set/zset/stream); per-key counts have genuine O(1) exact commands available (unlike the db-wide `DBSIZE`-only characterization in §5.1, which is read as describing the tree/db level, not a single key's element count) — using the exact command where one exists is strictly better than approximating. |
| D7 | `adapter.cancel(opId)` is a permanent no-op returning `false`; cancellation relies solely on `ctx.signal` being checked between bounded SCAN-family round-trips. `CLIENT KILL` is deliberately **not** implemented. | `scheduler/ops.ts` aborts `ctx.signal` *before* calling `adapter.cancel()` (reality #15), so the signal check is already sufficient for every op this adapter issues — all of them are SCAN-family loops or single fast commands, never a single blocking multi-second call. Implementing `CLIENT KILL` would require targeting the specific connection running the op; under `DbConnectionSet`'s one-connection-per-db-index model (D9), that connection is shared by any other concurrent op on the same db, so killing it would sever unrelated in-flight work — unsafe for no practical gain given the signal check already covers the real cases. |
| D8 | `caps.cancel: true` despite D7's no-op `cancel()`. | `Caps.cancel` describes whether cancellation *works* from the UI's perspective, not which specific mechanism implements it; the signal-check path (D7) is fully effective for this adapter's actual op shapes, so the capability is honestly `true`. |
| D9 | `DbConnectionSet` (new `redis/client.ts`) mirrors `mariadb/client.ts`'s `ConnectionSet` structurally — per-db-index `Map`, LRU eviction, `MAX_CONNECTIONS` cap — instead of Mongo's single shared client. | Redis's `SELECT n` mutates connection-wide state exactly like MariaDB's implicit per-connection database; a single shared connection would be unsafe under concurrent cross-db access (two ops on different db indices racing each other's `SELECT`), the same problem `ConnectionSet` already solves for MariaDB. |
| D10 | A key that no longer exists at read time throws `AdapterError('E_QUERY', ...)`, not `E_NOT_FOUND`. | `DISCONNECTED_CODES` (confirmed by reading `views/documents/state.ts`) already overloads `E_NOT_FOUND` to mean "the adapter/connection itself is gone," which drives a reconnect-prompt UI path — a vanished key is an ordinary query-time condition (the value expired or was deleted concurrently), not a connection failure, so it must use a code that doesn't trigger that UI. |
| D11 | The console is a hand-written whitespace/quote-aware tokenizer dispatching every command generically through `conn.call(name, ...args)`, with no per-command switch — unlike Mongo's console, which needs one because `db.<collection>.<method>()` syntax requires JSON-literal argument parsing per method. | Real Redis CLI syntax is flat whitespace-separated tokens (with optional quoting), and ioredis's `.call()` accepts any command name generically — there is no per-command semantic difference to switch on, so a generic dispatcher is both simpler and strictly more complete (any command works, including future/unlisted ones) than an enumerated method list. |
| D12 | No statement-classification (read-only detection) is added to the console. | Confirmed by grep that `mariadb/console.ts` has zero `readOnly` references — only `mutate.ts`'s explicit guard enforces read-only mode elsewhere in the app — so Redis's console needs no new classification logic either; it is consistent with existing precedent, not a gap. |
| D13 | `nodeKindSchema` gains `'namespace'` and `'key'`; the existing `'database'` literal (added for Mongo) is reused as-is for Redis's logical-db level rather than adding a Redis-specific database-kind literal. | A logical Redis database and a Mongo database serve the identical tree role (root-level container, not opened as a tab, only ever expanded) — reusing the literal avoids a meaningless third "this is also a database" kind. |
| D14 | `menus.ts` gets minimal `'namespace'` (copy name only) and `'key'` (copy name / copy qualified name / open) cases; no delete/edit menu rows anywhere. | Follows directly from D2's read-only scope; mirrors `columnMenu`'s minimal shape (realities #11), the smallest thing consistent with these being addressable, named tree nodes. |
| D15 | `ioredis` is added as the driver dependency; no cluster-client variant (`ioredis.Cluster`) is wired up. | Matches SPEC §4's driver list; cluster topology UI is explicitly out of scope for v1 per the ground rules — a single-node/single-endpoint client covers everything the spec names. |

## 3. Target tree at the end of P9

```
src/shared/
  protocol/page.ts        MOD — KeyValuePage, createKeyValuePageBuilder, Page union widened to 3
                                 members, assertPageStructure 3rd arm, PagePosition.strategy gains
                                 'cursor'.
  domain/tree.ts           MOD — nodeKindSchema gains 'namespace', 'key'.
  domain/tabs.ts           MOD — keyValueTabStateSchema, defaultKeyValueTabState, asKeyValueTab,
                                  tabRecordSchema keyvalue member, RENDERABLE_TAB_KINDS.
  domain/connection.ts     MOD — DEFAULT_PORT.redis = 6379.
src/engine/adapters/
  registry.ts               MOD — redis: createRedisAdapter entry.
  redis/                    NEW
    caps.ts                 NEW — redisCaps.
    client.ts                NEW — DbConnectionSet, connectRedis.
    errors.ts                 NEW — mapRedisError → AdapterError.
    catalog.ts                 NEW — listDatabases/listNamespaceChildren (bounded SCAN + INFO
                                      keyspace).
    read.ts                    NEW — readKey, countKey (per-type dispatch).
    console.ts                   NEW — tokenizer + generic .call() dispatch + KeyValuePage
                                        formatting.
    index.ts                      NEW — createRedisAdapter (Adapter implementation, read-only,
                                        no-op cancel).
src/renderer/
  state/tabs.ts             MOD — openKeyValueTab, patchKeyValueTabState, findKeyValueTab,
                                    duplicateTab's 5th (keyvalue) branch.
  project/ConnectionDialog.vue MOD — SUPPORTED_KINDS gains 'redis'.
  project/ProjectTree.vue   MOD — 'key' branch in the open dispatch → openKeyValueTab;
                                    'namespace'/'database' stay expand-only.
  project/menus.ts          MOD — 'namespace' case (copy name), 'key' case (copy name/qualified
                                    name/open), QUALIFIED_KINDS gains 'key'.
  workbench/panels/MainView.vue  MOD — v-else-if branch for 'keyvalue' → KeyValueView.
  workbench/panels/Toolbar.vue   MOD — excluded-kinds check gains 'keyvalue'.
  workbench/panels/TabStrip.vue  MOD — iconFor 'keyvalue' case.
  project/icons.ts            MOD — icon for 'namespace'/'key' tree node kinds.
  views/console/resultPages.ts   MOD — keyValueRow() + 3rd Page-kind branch.
  views/console/ConsoleResultGrid.vue MOD — 3rd template branch, console-result-kv-row testid.
  views/keyvalue/            NEW
    KeyValueView.vue          NEW — self-contained toolbar + type-aware row renderer, read-only.
    state.ts                   NEW — DataViewRuntime analog for key/value pages.
    kvPage.ts                    NEW — row-decoding helper, mirrors documents/docPage.ts.
    keyValueMenu.ts               NEW — minimal per-row context menu (copy field/value only — no
                                        delete/edit, per D2).
package.json               MOD — ioredis driver dependency.
tests/db/
  support/redis.ts          NEW — Testcontainers startRedis(), mirrors support/mongo.ts.
  fixtures/0004_redis_seed.ts NEW — seed keys across all 6 renderer types.
  redis.spec.ts               NEW — numbered scenario suite (catalog/tree, per-type read/count,
                                     cancel, console).
tests/ui/
  support/redis.ts           NEW — re-export wrapper, mirrors ui/support/mongo.ts.
  redis.spec.ts                NEW — connect, tree walk, open key/value tab per type, console,
                                     cancel, consoleErrors check.
docs/plans/
  P9-redis-adapter.md       NEW — this document.
```
