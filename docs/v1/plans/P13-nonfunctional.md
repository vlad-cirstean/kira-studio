# P13 — Nonfunctional checks: memory leaks, storage leaks, redundant DB work, caching gaps

> Plan for SPEC.md §10 phase **P13**. Deliverable: *Sweep for memory leaks, storage leaks,
> inefficient/redundant DB interaction, and insufficient caching across the whole codebase; fix
> everything found.* Unlike P12, this phase has no trigger gates: every finding in §2 is fixed in
> this phase unless §3 records it as a prior deliberate decision with a citation. Nothing is
> handed forward.

## 0. Ground rules for this phase

- **Full sweep, full fix.** §2 enumerates 21 findings across the four charter categories. Each one
  either gets a decision row in §3 that fixes it, or a decision row that declines to fix it *and
  cites the earlier plan or spec section that made that trade deliberately*. There is no third
  outcome and no "handed to a later phase" bucket — P13 is the last nonfunctional phase before
  docs (P14) and tooling (P15).
- **`docs/PERF.md` §4's three handed items are a floor, not the scope.** They appear here as F19,
  F20 and the L-B question answered in D21. The other 18 findings come from this phase's own
  independent read of `src/main/`, `src/engine/`, `src/renderer/` and `src/shared/`.
- **Every finding carries a file:line and a concrete failure scenario.** A finding without a
  reproducible "user does X → Y happens because Z" is not a finding; several candidates were
  checked, found sound, and recorded in §4 instead of being fixed for the sake of activity.
- **No new product surface.** No new views, no new settings, no new menu items. The only
  user-visible behaviour changes are the three the spec already requires and the app currently
  does not do: stale (not blanked) counts after a local mutation (§7), tabs of a deleted
  connection closing (§8.4 consequence, D7), and log-file retention (§6).
- **No new IPC channel.** Two existing wire schemas gain one optional field each
  (`countRequestWire.refresh`, `invalidateRequestWire.scope`), which is a schema change inside
  channels that already exist, not a new channel. One renderer test hook is widened
  (`window.__kiraRetainedBytes`, D5) alongside the existing `__kiraGridRetainedBytes`, which stays
  so `tests/ui/perf.spec.ts`'s current assertion keeps its meaning.
- **The three cache tiers keep their §7 identities.** L1 stays in main's SQLite (P1 D10), L2 stays
  the engine's byte-budgeted `ByteLru`, L3 stays the engine's count map. P13 bounds L3 and fixes
  L3's invalidation *policy*; it does not add a fourth tier, move a tier, or give L1 a TTL.
- **Measurement discipline carries over from P12.** Where a fix claims a round-trip reduction, the
  new `tests/db/*.spec.ts` assertions count actual statements through a recording `setCommand`
  (§5), rather than asserting a number nobody measured.
- Run `bun run lint`, `bun run typecheck` (all three splits), `bunx electron-vite build`,
  `bun run test:db`, and `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. Six adapters implement `Adapter`; `createAdapter` is async and lazily imports one kind's driver
   (`src/engine/adapters/registry.ts:11-26`, P12 lever L-A). An adapter instance is created
   *before* anyone knows whether the connection will succeed.
2. `postgres` and `mariadb` hold a `ClientSet`/`ConnectionSet` (an LRU of per-database clients);
   `mongo` holds one pooled `MongoClient`; `redis` holds a `DbConnectionSet`; `kafka` holds an
   `Admin`; `sqs` holds an `SQSClient`. Only `postgres`/`mariadb` assign the handle to `this`
   *after* their connect probe (`postgres/index.ts:44-69`, `mariadb/index.ts:49-69`); the other
   four close their handle inside their own `connect()` failure path
   (`mongo/index.ts:52`, `redis/index.ts:44`, `kafka/index.ts:42`, `sqs/index.ts:40`).
3. `postgres`/`mariadb` track the currently-running query per op in a `Map` so `cancel()` can
   issue `pg_cancel_backend`/`KILL QUERY` on a side connection
   (`postgres/index.ts:39`, `mariadb/index.ts:44`). The tracker callback is threaded through
   `read.ts`/`mutate.ts`/`console.ts` and invoked inside `runQuery`.
4. `cache/pages.ts` (L2) is a `ByteLru` with a 64 MB default budget and a `> budget/2` refusal rule
   (`cache/lru.ts:53-70`, P12 D19). `cache/counts.ts` (L3) is a bare `Map` with a 5-minute TTL and
   a 30-minute hard drop, no size bound (`cache/counts.ts:1-17`).
5. `ByteLru`'s own doc comment already anticipates L3 reusing it: *"generic enough that L3 (§6c)
   could reuse it, though L3 is unbudgeted and small enough not to need it"* (`cache/lru.ts:14-18`).
   It exposes `get`/`set`/`deleteWhere`/`clear`/`entries`/`size`/`bytes` but no single-key delete.
6. `cache/counts.ts:37-39` already returns `stale: age > TTL_MS` and the renderer already renders
   it: `DataToolbar.vue:246-256` greys the Σ button (`:class="{ stale: rt?.count?.stale }"`) and
   shows a `refresh` codicon. The stale state is unreachable after a mutation, because
   `cache.dropTarget` deletes the entry outright (`cache/index.ts:76-81`).
7. `cache.dropTarget` has exactly two callers with different intents that it cannot tell apart:
   `handleMutate` (`data.ts:141-142`) and `DATA_OP.invalidate` (`rpc.ts:29-33`, which is the
   renderer's explicit ↻ Refresh via `views/grid/state.ts:221-226`).
8. `handleRead`/`handleCount` are cache-aside and a cache hit never reaches the op log
   (`data.ts:30-102`). `handlePrefetch` deliberately reuses `handleRead` so a prefetch never
   double-counts a miss (`data.ts:104-113`).
9. `countRows` in both SQL adapters takes `target: Pick<ReadTarget, 'qualifiedName'>`
   (`postgres/read.ts:319-325`, `mariadb/read.ts:296-302`) — it uses nothing else off the target.
   Both `count()` implementations nonetheless call the full `resolveReadTarget`
   (`postgres/index.ts:229-232`, `mariadb/index.ts:220-223`), which calls `getReadTarget`
   (`postgres/catalog.ts:286-304`: `getRelationInfo` + `listColumns` + `listIndexes`, sequential;
   `mariadb/catalog.ts:315-330`: `listColumns` + `listIndexes`).
10. `sqs` resolves a queue name to its URL with a `GetQueueUrlCommand` on every read and every
    count (`sqs/index.ts:71`, `sqs/index.ts:77` → `sqs/catalog.ts:40-48`), although
    `catalog.listQueues` has already enumerated every queue URL for the tree.
11. Main's Drizzle handle is `drizzle-orm/sqlite-proxy` over `node:sqlite`; the proxy callback
    calls `raw.prepare(sql)` on every single query (`main/storage/db.ts:45-59`), as do the raw
    `get`/`run` helpers (`:65-69`). Transactions are real `BEGIN`/`COMMIT` issued through the same
    callback (`node_modules/drizzle-orm/sqlite-proxy/session.js:46-56`).
12. `PRAGMA foreign_keys = ON` is set at open (`db.ts:42`) and every FK in `0001_init.sql` declares
    `ON DELETE CASCADE` or `SET NULL`. `tabs.connection_id` is `ON DELETE CASCADE`
    (`0001_init.sql:74-82`), and `replaceTabs` is delete-all + insert-N in one transaction
    (`main/storage/repos/tabs.ts:53-68`).
13. `pruneOps(db, retentionDays)` deletes past-retention rows and then trims to `HARD_CAP_ROWS`
    (20 000) with `notInArray(opLog.id, keepIds)` (`repos/ops.ts:79-92`). It is called exactly once,
    at startup (`main/oplog.ts:23`).
14. `main/log.ts:7-10` writes `~/.kira-studio/logs/kira-${YYYY-MM-DD}.log` via electron-log's
    `resolvePathFn`. Nothing deletes an old day's file; `storage/paths.ts:22-25`'s `ensureLayout()`
    only creates directories.
15. `setSettings` re-reads every setting, then upserts every leaf of all four sections regardless of
    what the patch touched (`repos/settings.ts:41-63`); `ipc/settings.ts:12-14` then calls
    `pushEngineConfig`, which reads all settings a third time (`engine-config.ts:15`).
16. The renderer's page bytes live in five non-reactive module stores keyed by tab id
    (`views/grid/page.ts`, `views/console/resultPages.ts`, `views/documents/docPage.ts`,
    `views/keyvalue/kvPage.ts`, `views/stream/streamPage.ts`). `closeTab` frees all five via
    `dropAllPagesForTab` (`state/tabs.ts:40-46,383`). Only `views/grid/page.ts` exposes
    `totalRetainedBytes()`, and only it is wired to `window.__kiraGridRetainedBytes`
    (`renderer/main.ts:9,22`), which is what `tests/ui/perf.spec.ts:81` reads.
17. Each view has a *separate* reactive per-tab runtime record — `views/grid/state.ts:33`,
    `views/console/state.ts:15`, `views/ddl/state.ts:13`, `views/documents/state.ts:24`,
    `views/keyvalue/state.ts:23`, `views/stream/state.ts:27` — plus
    `views/grid/search.ts:27`'s `searchState`. `closeTab` touches none of them.
18. Every one of those view state modules imports from `state/tabs.ts`
    (e.g. `views/console/state.ts:5`), so `state/tabs.ts` cannot import them back without a
    module cycle. `state/tabs.ts`'s existing cleanup imports are all *leaf* page modules.
19. `treeState` is keyed `${connectionId}|${path}` across six collections
    (`project/state/tree.ts:31-43`) and is refreshed on reconnect via
    `onConnectionMetadataInvalidated` → `refreshExpanded` (`tree.ts:167-173`). Nothing purges it
    when a connection is deleted. `state/connections.ts:127-131`'s `deleteConnection` clears only
    `records` and `states`.
20. `expand()` always round-trips `kira:tree:children` even when `treeState.children[k]` is already
    populated, by explicit design comment (`tree.ts:104-112`).
21. P12 recorded the §2.2 350 MB assertion as failing on ~620–626 MB of baseline Chromium/Electron
    overhead in this environment, and measured the 10-tab RSS delta at ≈ 18–43 MB
    (`docs/PERF.md` §2.2). `tests/ui/memory.spec.ts`'s teardown block explicitly logs rather than
    asserts, with the comment "P13's leak sweep owns the assert".
22. `tests/ui/perf.spec.ts:179-203` already asserts open/close retained-byte symmetry
    (`expect(afterClose).toBe(baseline)`) — but only over the grid store (reality 16).
23. `tests/db/*.spec.ts` drive adapters directly with a hand-built `OpCtx` whose `setCommand()` is a
    no-op (`tests/db/postgres.spec.ts:26-31`). Every `runQuery` calls `ctx.setCommand(sql)`
    (`postgres/query.ts:56`, `mariadb/query.ts:79`), so a recording `setCommand` is an exact,
    already-wired statement counter.

## 1. Shapes and signatures introduced in this plan

```ts
// src/engine/cache/lru.ts — the one addition ByteLru needs to back L3 (D19).
delete(key: string): boolean;

// src/engine/cache/counts.ts — L3 becomes a bounded ByteLru and gains an explicit stale flag.
const COUNT_ENTRY_BYTES = 128;              // fixed nominal cost; entries are 4 scalars + a key
const L3_BUDGET_BYTES = 256 * 1024;         // ≈ 2 000 entries before LRU eviction
interface StoredCount { value: number; exact: boolean; at: number; stale: boolean }
export function markCountTargetStale(connectionId: string, path: string): number;

// src/engine/cache/index.ts — the two intents behind today's single dropTarget (D18).
dropTarget(connectionId, path): void;              // explicit ↻ Refresh: pages + counts, hard
invalidateAfterMutation(connectionId, path): void; // §7: pages hard, counts marked stale

// src/shared/protocol/data-ops.ts — one optional field on each of two existing wire schemas.
countRequestWireSchema:      { ..., refresh: z.boolean().optional() }
invalidateRequestWireSchema: { ..., scope: z.enum(['all', 'pages']).optional() }

// src/engine/adapters/{postgres,mariadb}/query.ts — the tracker callback returns its own release.
export type TrackQuery = (q: RunningQuery) => () => void;

// src/engine/adapters/{postgres,mariadb}/index.ts — count no longer resolves the catalog (D13).
private resolveCountTarget(path: NodePath): { client: Client; target: Pick<ReadTarget, 'qualifiedName'> };

// src/renderer/state/tabRuntime.ts — NEW leaf registry that breaks the cycle in reality 18.
export function registerTabRuntimeCleanup(fn: (tabId: string) => void): void;
export function cleanupTabRuntime(tabId: string): void;

// src/renderer/views/{console/resultPages,documents/docPage,keyvalue/kvPage,stream/streamPage}.ts
export function totalRetainedBytes(): number;   // mirrors views/grid/page.ts:52-56

// src/renderer/main.ts — the aggregate hook; __kiraGridRetainedBytes stays as-is.
window.__kiraRetainedBytes = (): number => /* sum of all five stores */;

// src/main/storage/db.ts — a capped prepared-statement cache in front of raw.prepare (D16).
const STMT_CACHE_MAX = 200;

// src/main/oplog.ts — retention runs on a count, not only at boot (D11).
const PRUNE_EVERY_OPS = 500;

// src/main/log.ts — log-file retention (D12).
const LOG_RETENTION_DAYS = 30;
```

## 2. Findings

Severity is *impact if the scenario is hit*, not likelihood: **high** = unbounded growth, data
loss, or a server-side resource held indefinitely; **medium** = bounded but real waste a user can
feel or a spec'd behaviour that does not happen; **low** = correct today, wrong under a plausible
sequence.

### Memory leaks

**F1 — `postgres`/`mariadb` leak their entire client set when the connect probe fails.**
`src/engine/adapters/postgres/index.ts:44-69` (and `mariadb/index.ts:49-69`) construct the
`ClientSet`, open a client, run the version/database probe, and only then assign
`this.clientSet = clientSet` (`:60`). `disconnect()` closes `this.clientSet` (`:70-76`), so if the
probe throws, the socket that was successfully opened is unreachable and never closed.
*Scenario:* a user connects to a Postgres server their role can read but where
`current_setting('server_encoding')` errors, or the server drops the session between TCP accept and
the probe response. `connect()` rejects, the UI shows a connect error, and one live backend stays
open on the server for the lifetime of the engine process. Retrying the connection ten times pins
ten server backends and ten sockets. **Severity: high.**

**F2 — `control.ts` never disconnects an adapter whose `connect()` failed.**
`src/engine/control.ts:44-48`: `createAdapter` is awaited, `runOp(... adapter.connect ...)` is
awaited, and `setLiveAdapter` runs only on success — the rejection path has no cleanup, so the
adapter object (and whatever the driver opened before failing) is dropped on the floor with no
`disconnect()`. `handleTest` (`:105-114`) has the mirror-image bug: `adapter.disconnect()` is called
on the success path (`:110`) but the `catch` at `:112` returns `{ ok: false }` without disconnecting.
*Scenario:* a user clicks **Test connection** against a host that accepts TCP and then fails auth
late, or cancels a connect while the probe is in flight (`runOp` aborts, `connect()` rejects). For
`postgres`/`mariadb` this compounds F1. For the other four adapters the driver handle is closed
inside their own `connect()` catch, so this is a latent contract hole rather than a live leak
there — but "the engine owns disconnecting anything it created" is the invariant, and it is not
enforced anywhere today. **Severity: high** (as the enclosing contract for F1).

**F3 — `runningByOp` grows one entry per statement and is only ever emptied by `cancel()` or
`disconnect()`.** `src/engine/adapters/postgres/index.ts:39` declares the map; `.set()` happens at
`:220` (read), `:231` (count), `:276` (mutate), `:290` (execute) and `:347` (the shared exec helper);
`.delete()` appears once, at `:297`, inside `cancel()`. `mariadb/index.ts` is identical
(sets at `:211/:222/:261/:272/:328`, delete at `:279`). Each entry is a `RunningQuery` closure that
keeps its `Client`/`Connection` and its SQL string reachable.
*Scenario:* a user keeps one Postgres connection open all day and pages through data. Every read,
count, prefetch, mutation and console run adds a permanent map entry keyed by a fresh uuid. After
10 000 operations the map holds 10 000 uuid keys and 10 000 closures that can never be looked up
again, and nothing shrinks it until the connection is disconnected. **Severity: high**
(unbounded, on the hot path, in the process with the 512 MB `--max-old-space-size` cap).

**F4 — no view's per-tab runtime record is deleted when its tab closes.**
`closeTab` (`src/renderer/state/tabs.ts:377-395`) drops pages, cell selection and pending edits, and
touches none of the seven per-tab reactive records listed in reality 17.
*Scenario:* a user opens and closes 200 tabs over a working session. `views/grid/state.ts:33`'s
`runtime` retains 200 records, each holding an `ObjectMeta` (`meta`, the full column list from
`kira:tree:describe`) plus pager tokens; `views/grid/search.ts:27`'s `searchState` retains every
match array ever produced (one `{row, col, start, end}` object per match — a search over a 100 k-row
page can produce tens of thousands). None of it is reachable from the UI again.
**Severity: high.**

**F5 — a closed console tab's result pages stay alive in its runtime record.**
`src/renderer/views/console/state.ts:70-75` stores each result set twice: into the page store via
`setPage(resultPageKey(tabId, i), page)` and into `rt.results = response.pages`. `closeTab` clears
the first (`dropAllPagesForTab` → `resultPages.dropForTab`) and not the second (F4).
*Scenario:* a user runs `SELECT * FROM big_table LIMIT 100000` in a console tab and closes it.
§2.2 states "Result pages are held only for tabs that are open; closing a tab frees its pages
immediately" — but the whole page (all chunk buffers) is still referenced by `runtime[tabId].results`
and stays resident until reload. This is invisible to `tests/ui/perf.spec.ts:179-203`'s symmetry
assertion because that assertion reads `__kiraGridRetainedBytes()`, which sums the *grid* store only
(reality 16/22). **Severity: high** — a direct, measurable §2.2 violation that the existing
regression test is structurally unable to see.

**F6 — `treeState` is never purged when a connection is deleted.**
`src/renderer/project/state/tree.ts:31-43` keys six collections by `${connectionId}|${path}`;
`state/connections.ts:127-131`'s `deleteConnection` clears `records` and `states` only.
`treeState.savedQueries` additionally gains an entry on *every* relation right-click
(`tree.ts:51-56`, deliberately never memoised).
*Scenario:* a user adds a connection to a 5 000-table warehouse, expands several schemas, deletes
the connection, and repeats with a second one. Every deleted connection's full `TreeNode[]` payload
stays in `treeState.children` forever, keyed by a connection id that no longer exists.
**Severity: medium** (bounded by how many connections the user deletes, unbounded in bytes per
deletion).

**F7 — tabs of a deleted connection stay open, and every subsequent tab save then fails against a
foreign-key constraint.** `tabs.connection_id` is `ON DELETE CASCADE` (`0001_init.sql:74-82`) and
`PRAGMA foreign_keys = ON` (`db.ts:42`). Main's `remove()` (`main/connections.ts:284-294`) deletes
the connection row, cascading its `tabs` rows away. The renderer keeps those tabs in
`tabsState.tabs` — nothing closes them. The next debounced save calls `replaceTabs`
(`repos/tabs.ts:53-68`), whose `INSERT` re-inserts a row with the deleted `connection_id`.
*Scenario:* a user has a data tab open on "Staging DB", deletes that connection from the project
panel, then reorders tabs or scrolls another tab. `replaceTabs`'s transaction throws
`FOREIGN KEY constraint failed`, rolls back — after the `DELETE FROM tabs` inside the same
transaction is undone, so no rows are lost *this* time — and the renderer discards the rejection
(`state/tabs.ts:65` is a bare `void control.tabsSave(...)`). Every later save fails the same way, so
**tab persistence is silently dead for the rest of the session** and the next launch restores a
stale layout. The retained tab also keeps its runtime record, its page bytes and its
`Reconnect & load` affordance for a connection that cannot exist. **Severity: high** — silent
loss of persisted state from a completely ordinary action, on top of the retention.

**F8 — the window-bounds debounce timer is never cleared when the window closes.**
`src/main/window.ts:36-44` sets a 250 ms-class `setTimeout` on every `resize`/`move` and clears it
only on the next event. Nothing clears it on `close`/`closed`.
*Scenario:* a user drags the window and hits ⌘Q inside the debounce window. The timer survives into
teardown and calls `setLayout(db, ...)` against a `BrowserWindow` that is being destroyed
(`win.getBounds()` on a destroyed window throws) and a `db` handle that `close()` may already have
released. It also keeps the timer, the closure, and through it the `win` and `db` references alive
past the point Electron expects them gone. **Severity: medium.**

**F9 — the data grid's scroll-persist timer is not cleared on unmount.**
`src/renderer/views/grid/DataGrid.vue:193-199` debounces `patchDataTabState` by 300 ms;
`onUnmounted` (`:162-165`) disconnects the `ResizeObserver` and clears the cell selection but leaves
`scrollSaveTimer` pending.
*Scenario:* a user scrolls a grid and closes the tab (or switches tabs, which unmounts the grid)
within 300 ms. The timer fires against an unmounted component; `patchDataTabState` no-ops because
the tab record is gone, but the closure has held the component's reactive refs alive for the whole
interval, and every rapid open-scroll-close cycle stacks another one. **Severity: low.**

**F10 — `oplog.ts`'s `inFlight` map is never pruned when an op never ends.**
`src/main/oplog.ts:25` declares it, `:37` inserts on `op:start`, `:71` deletes on `op:end`. The
engine host's `exit` handler (`main/engine-host.ts:65-75`) rejects every pending *call* but has no
hook into the op log.
*Scenario:* the engine process crashes or is killed mid-query (P12 sized it at 512 MB
`--max-old-space-size`; an oversized result can OOM it). Every op that was running at that moment
keeps its `InFlightOp` record forever, and the corresponding `op_log` row stays `status = 'running'`
with a `NULL` duration. Repeated across engine restarts in a long session, the map only grows.
**Severity: low** (small records, but genuinely unbounded and it also leaves permanently-`running`
rows in the op log).

### Storage leaks

**F11 — op-log retention runs once, at startup only.**
`src/main/oplog.ts:23` calls `void pruneOps(db, retentionDays)` at wiring time and never again.
`HARD_CAP_ROWS = 20 000` (`repos/ops.ts`) is therefore a cap on what survives a *restart*, not a cap
on the table.
*Scenario:* a user leaves Kira open for a week driving a busy console. Two rows are written per
operation (`appendOp` then `finishOp`, `oplog.ts:38,62`), so a session doing 200 000 operations
leaves 200 000 rows — ten times the documented hard cap — in `kira.db` until the next launch. SPEC
§6 describes the op log as "rotated, capped"; today it is capped only across restarts.
**Severity: medium.**

**F12 — log files accumulate one per day, forever.**
`src/main/log.ts:7-10` resolves the path to `kira-${YYYY-MM-DD}.log`. electron-log rotates an
individual file at its default `maxSize`, but nothing deletes yesterday's file, and
`storage/paths.ts:22-25` only creates the directory.
*Scenario:* a user runs Kira daily for two years. `~/.kira-studio/logs/` accumulates ~730 files
that nothing in the app or in `docs/` ever removes, and no uninstall path exists (§1 defers
installers). **Severity: medium** (slow, unbounded, entirely outside the user's view).

### Inefficient / redundant DB interaction

**F13 — every count runs a full catalog resolution it does not use.**
`postgres/index.ts:229-232` and `mariadb/index.ts:220-223` call `resolveReadTarget`, which calls
`catalog.getReadTarget` — three sequential catalog queries for Postgres
(`getRelationInfo` + `listColumns` + `listIndexes`, `postgres/catalog.ts:286-304`) and two for
MariaDB (`mariadb/catalog.ts:315-330`) — and then hand the result to `countRows`, whose parameter
type is `Pick<ReadTarget, 'qualifiedName'>` (reality 9). Columns, PK, unique keys and oid are
discarded.
*Scenario:* a user opens a table with `countOnOpen` enabled (`views/grid/state.ts:198`). The tab
issues one read (3 catalog queries + 1 data query) and one count (3 catalog queries + 1
`COUNT(*)`) — 8 server round trips where 5 are needed, of which the 3 wasted ones are
`pg_catalog`/`information_schema` joins, not cheap primary-key lookups. Clicking Σ again after the
TTL, or on a filtered view, repeats it. **Severity: medium** (3 wasted round trips per count, on
the most common user action there is).

**F14 — SQS resolves the queue URL over the network on every read and every count.**
`sqs/index.ts:71` and `:77` both call `catalog.resolveQueueUrl` → `GetQueueUrlCommand`
(`sqs/catalog.ts:40-48`), even though `catalog.listQueues` already returned every queue's URL when
the tree was populated.
*Scenario:* a user polls an SQS queue repeatedly from a stream tab. Each poll is two AWS API calls
instead of one; `GetQueueUrl` is billed and rate-limited like any other SQS request, and its answer
for a given name cannot change for the life of the connection.
**Severity: medium** (100 % overhead on a metered API).

**F15 — one settings change costs three reads and twelve writes.**
`repos/settings.ts:41-43` calls `getAllSettings` to merge, `:51-63` upserts *every leaf of every
section* (four sections, ~12 keys) rather than only the patched leaves, and `ipc/settings.ts:11-14`
then calls `pushEngineConfig`, which calls `getAllSettings` a third time (`engine-config.ts:15`) to
read the one field it needs — a field the caller is already holding in `merged`.
*Scenario:* a user drags the L2 budget slider in Settings. Each committed change reads the whole
settings table twice more than necessary and rewrites eleven rows whose values did not change,
inside a transaction. **Severity: low** (local SQLite, small table) — but it is pure redundancy
with an obvious fix.

**F16 — every SQL statement in main is re-prepared from source text on every execution.**
`src/main/storage/db.ts:45-59`'s proxy callback opens with `const stmt = raw.prepare(sql);` and the
raw helpers at `:65-69` do the same. `node:sqlite`'s `prepare` runs the SQL compiler each time.
*Scenario:* a user runs 200 operations. Each writes two `op_log` rows (`appendOp` + `finishOp`),
each debounced tab save is 1 + N statements plus `BEGIN`/`COMMIT`, and each tree expand is a
`SELECT` plus a merge transaction — every one of them recompiles identical SQL. The cost lands on
the main process, the same thread that must stay responsive for IPC and for the §2.1 tree-expand
budget. **Severity: low-medium.**

**F17 — the tab layout is rewritten in full on every debounced save, including when nothing
changed.** `state/tabs.ts:68-74` debounces at 1 s and always sends the whole array;
`repos/tabs.ts:53-68` always does `DELETE FROM tabs` plus N `INSERT`s in a transaction.
*Scenario:* a user scrolls a grid. `DataGrid.vue:196` fires `patchDataTabState` 300 ms after the
scroll settles, which schedules a save; with 10 tabs open, every scroll pause writes 12 statements
plus a transaction to disk, even when the only change is a scroll offset — and a save is scheduled
even by patches that set a field to the value it already had. **Severity: low.**

**F18 — re-expanding an already-loaded tree node re-runs the whole IPC + L1 read.**
`project/state/tree.ts:104-112`: `expand()` unconditionally calls `loadChildren(..., refresh: false)`
even when `treeState.children[k]` is already populated, by design comment. That round trip reaches
`tree-service.ts:64-81`, which reads the `metadata_cache` row and `JSON.parse`s its payload — a
payload capped at 4 MB (`repos/metadata-cache.ts:17`).
*Scenario:* a user collapses and re-expands a schema with 5 000 tables to get it out of the way.
Each re-expand serialises a multi-megabyte JSON blob across IPC and parses it on the main thread and
again in the renderer, for data the renderer already has in `treeState.children`. §2.1 budgets tree
expand at ≤ 50 ms. **Severity: medium.**

### Insufficient / incorrect caching

**F19 — L3 (counts) is an unbounded `Map`.** `src/engine/cache/counts.ts:17`. It shrinks only via
`dropCountTarget`/`dropCountConnection`/`clearCounts` or the 30-minute drop *checked on read*
(`:33-36`) — an entry nobody reads again is never examined and never removed. The key includes the
raw filter string (`:20-22`).
*Scenario:* a user browses 300 tables and tries several filters on each. L3 accumulates an entry per
`{connection, path, filter}` triple with no size bound and no eviction, in the process that is
capped at 512 MB. This is `docs/PERF.md` §4 item 1. **Severity: medium.**

**F20 — L2's `hits`/`misses` are lifetime-cumulative and survive `clearCaches()`.**
`src/engine/cache/pages.ts:35-36` are module-level `let`s; `clearPages()` (`:62-64`) clears the
`ByteLru` and not the counters.
*Scenario:* a user opens Settings → Cache, clicks **Clear cache**, and reads "Hit rate 84 %" for a
cache that is empty. The number is surfaced in two places — `StatusBar.vue:20` and
`SettingsDialog.vue:104-112` — so it is user-facing today, not internal telemetry. This is
`docs/PERF.md` §4 item 3. **Severity: low** (wrong number, not wrong data).

**F21 — a local mutation deletes the cached count instead of marking it stale, so §7's stale-count
UI is unreachable and every post-mutation count is a fresh full scan.** SPEC §7's L3 rule is:
counts have a "TTL 5 min, and immediately marked *stale* (shown greyed with a refresh affordance)
after any local mutation". `cache.dropTarget` (`cache/index.ts:76-81`) deletes both the pages and
the counts, and `handleMutate` calls exactly that (`data.ts:141-142`). `counts.ts:37-39` already
computes a `stale` flag and `DataToolbar.vue:246-256` already renders it (reality 6) — the path that
should set it after a mutation does not exist. The renderer compounds it: `DataToolbar.vue:163-164`
commits and then calls `reload()`, which issues `DATA_OP.invalidate` (`views/grid/state.ts:221-226`)
— a second hard drop.
*Scenario:* a user edits one cell in a 50 M-row table and commits. The count is deleted twice over;
the toolbar shows Σ blank instead of the previous total greyed with a refresh affordance, and the
next Σ click runs a full `COUNT(*)` against 50 M rows because there is nothing left to mark. The
spec'd behaviour — keep the number, grey it, let the user decide whether the recount is worth it —
never happens. **Severity: medium** (spec deviation plus an avoidable full table scan, and it makes
built UI dead code).

**F22 — nothing caches the SQS name→URL mapping.** The engine's three tiers cover pages (L2) and
counts (L3); an adapter-local, connection-scoped identifier map has no tier and no home, so F14's
round trip has nowhere to be avoided. `sqs/index.ts` holds only `private client: SQSClient | null`
(`:31`). *Scenario:* as F14. Recorded separately because the fix is a cache, not a call-site
change, and because it must be bound to the adapter's lifetime — a stale URL after a queue is
deleted and recreated must not outlive the connection. **Severity: medium** (same impact as F14;
listed under both charter categories because the fix belongs to this one).

## 3. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | **F1:** in `postgres`/`mariadb` `connect()`, assign `this.clientSet`/`this.connectionSet` *immediately after construction*, before `primary()` and before the probe, and wrap the probe in `try { ... } catch (err) { await this.disconnect(); throw err; }`. | The handle must be reachable by `disconnect()` from the instant anything could have been opened. Assigning first and cleaning up in a `catch` is the only ordering where no failure point leaves an orphan; the other four adapters already close their handle on their own failure path (reality 2), so this brings the two SQL adapters to the house standard rather than inventing one. |
| D2 | **F2:** `handleConnect` wraps the `runOp(... connect ...)` call in `try/catch`, calls `await adapter.disconnect().catch(() => {})` and rethrows; `handleTest` moves its `disconnect()` into a `finally`. | The engine created the adapter, so the engine disconnects it — on every path, including abort. Doing it in `control.ts` makes the invariant hold for all six kinds and for any future one, instead of depending on each adapter remembering. `.catch(() => {})` on the cleanup keeps the original error as the one the user sees. |
| D3 | **F3:** change the tracker callback's type to `TrackQuery = (q: RunningQuery) => () => void` (§1). `runQuery` calls `const release = track(q)` and `release()` in a `finally`. The adapter's release closure is `() => { if (this.runningByOp.get(opId) === q) this.runningByOp.delete(opId); }`. | The tracker is already invoked inside `runQuery`, which is the one place that knows when a statement settles — so the fix needs no new plumbing at the `read.ts`/`mutate.ts`/`console.ts` call sites, which only forward the callback. The identity check is what makes multi-statement ops correct: a "Run all" console request and a multi-op mutation reuse one `opId`, so statement 1's release must not unregister statement 2's still-running query — it sees a different `q` and no-ops, and statement 2's own release does the delete. `cancel()` semantics are unchanged: it still finds whatever is running *now*. |
| D4 | **F4:** add `src/renderer/state/tabRuntime.ts`, a leaf registry (`registerTabRuntimeCleanup` / `cleanupTabRuntime`). Each of the six view state modules and `views/grid/search.ts` registers a one-line cleanup at module scope; `closeTab` calls `cleanupTabRuntime(id)` alongside `dropAllPagesForTab(id)`. | Every view state module imports `state/tabs.ts` (reality 18), so the direct import `state/tabs.ts` → `views/*/state.ts` would be a cycle — the existing `dropAllPagesForTab` only works because every module it imports is a leaf. A registry inverts the dependency with no cycle and no new coupling: a view kind whose module was never loaded simply has nothing registered, which is correct because it also created nothing. |
| D5 | **F5:** the console's cleanup (D4) sets `runtime[tabId].results = []` before the record is deleted; additionally, export `totalRetainedBytes()` from all four remaining page stores and expose `window.__kiraRetainedBytes` as the sum of all five. `__kiraGridRetainedBytes` stays, unchanged. | Fixing the retention without fixing the *instrument* would leave the same class of bug invisible next time — `tests/ui/perf.spec.ts`'s symmetry assertion passed all through P12 while console pages leaked, precisely because it could only see one of five stores. Keeping the grid-only hook preserves the existing assertion's meaning; the new hook is what §5's leak spec asserts on. |
| D6 | **F6:** add `dropConnectionState(connectionId)` to `project/state/tree.ts` (purges all six collections by the `${connectionId}\|` prefix and clears `selected`/`pendingScrollKey` if they point into it), and call it from `initTreeSync`'s existing subscription block for any connection id that has disappeared from `onConnectionsChanged`'s record list. | `tree.ts` already imports `connectionsState` and `control` and already owns one lifecycle subscription (`:167-173`), so this adds no new dependency edge. Driving it off `onConnectionsChanged` rather than off `deleteConnection()` covers every deletion path — the context menu, a direct IPC call, a future bulk delete — which is the same reasoning `state/connections.ts:44-50` records for that channel. |
| D7 | **F7:** `state/tabs.ts` subscribes to `control.onConnectionsChanged` and calls `closeTab(id)` for every tab whose `connectionId` is no longer in the list, then saves. | Closing is the only outcome consistent with the schema: main has already cascaded those `tabs` rows away, so a "kept" tab is a row that cannot be re-inserted (`FOREIGN KEY constraint failed`) and a view that can never load (`E_NOT_FOUND` on every Reconnect & load). Routing through `closeTab` means the pages (F5) and runtime (F4) are freed by the same code path as a manual close, with no second cleanup to keep in sync. `state/tabs.ts` already imports `control`, so no cycle. |
| D8 | **F8:** `win.on('closed', () => clearTimeout(timer))` in `main/window.ts`. | The narrowest correct fix. Deliberately *not* flushing the pending bounds write on close: `main`'s quit path already holds `before-quit` for the renderer's own flush (`state/tabs.ts:80-87`), and adding a second, synchronous `setLayout` into window teardown would race the `db.close()` this is meant to stay clear of. Losing up to one debounce interval of window-bounds movement on quit is the same trade the debounce already makes. |
| D9 | **F9:** clear `scrollSaveTimer` in `DataGrid.vue`'s existing `onUnmounted`. | One line, no behaviour change — the pending write is a scroll offset that `patchDataTabState` would discard anyway once the tab is gone. |
| D10 | **F10:** `wireOplog` clears `inFlight` when the engine exits, and marks the abandoned rows. | Reuses `main/engine-host.ts`'s existing `exit` handling rather than adding a timer or a TTL. The op-log rows for abandoned ops are finished with `status: 'error'` and the message the host already produces, so the operations panel stops showing permanently-`running` entries — the same treatment `connections.ts:140-142` gives connections on engine exit. |
| D11 | **F11:** keep the startup prune and add a counted prune — `PRUNE_EVERY_OPS = 500` completed ops triggers `void pruneOps(db, retentionDays)` from the `op:end` handler. | A counter is deterministic, testable, and adds no timer to leak (which would be its own F8). 500 bounds the table at `HARD_CAP_ROWS + 500` instead of "whatever a session produced", and at two writes per op it fires roughly once per 1 000 rows — rare enough that the `notInArray` trim (`repos/ops.ts:83-91`, up to 20 000 bound parameters) is not on any hot path. |
| D12 | **F12:** `main/log.ts` deletes `kira-*.log` files older than `LOG_RETENTION_DAYS = 30` once at startup, best-effort. | Matches SPEC §6's "rotated, capped" for the app's other on-disk history and mirrors the op log's own retention shape. A fixed constant rather than reusing `advanced.opLogRetentionDays`: that setting is documented in §8.2 as the op log's retention, and silently making it govern diagnostic files too would surprise a user who sets it to 1 to keep the op log small. Failures are swallowed — a log directory that cannot be read must never block startup. |
| D13 | **F13:** add `resolveCountTarget(path)` to both SQL adapters — it performs the same path-shape validation as `resolveReadTarget` and returns `{ client, target: { qualifiedName } }` built from the path segments, with no catalog query. `count()` calls it instead of `resolveReadTarget`. | This is **not** a re-litigation of P2 D10 (`docs/plans/P2-tabular-data-view.md:70`, "the read path re-resolves catalog metadata on every uncached read … no fourth cache tier, no adapter-side metadata map"). Nothing is being cached or memoised: the three catalog queries are removed because `countRows` provably never reads their results (reality 9). The read path is untouched and still re-resolves exactly as D10 requires. P5 D7's rule (`docs/plans/P5-mutations.md:133`, "a renderer-supplied identifier is never trusted across a catalog boundary without a same-op re-check") also does not apply: it guards *writes* from landing on the wrong object, whereas a count returns a scalar, quotes both identifiers (`postgres/read.ts:326`, `mariadb/read.ts:303`), and gets a server-side "relation does not exist" if the path is wrong — the same error the re-resolution would have produced, one round trip earlier. |
| D14 | **F14/F22:** give the SQS adapter `private readonly queueUrls = new Map<string, string>()`, populated by `catalog.listQueues` and by `resolveQueueUrl` on a miss, read by `read()`/`count()`, and cleared in `disconnect()`. | Bound to the adapter instance, so it is emptied by the same lifecycle event that already releases the client — a queue deleted and recreated between sessions can never be served a stale URL, and §2.2's "disconnecting releases its driver state" covers it without a new cache tier. Its size is the queue count, which the tree has already materialised. This is adapter-local identifier resolution, not a fourth cache tier: it holds no rows, no metadata shape, and nothing L1/L2/L3 has an opinion about. |
| D15 | **F15:** `setSettings` writes only the leaves present in the validated patch; `pushEngineConfig` takes an optional already-merged `Settings` and `ipc/settings.ts` passes `merged`. | The merge read stays (a patch must merge against stored values to return a complete `Settings`), but the other two reads and the eleven no-op upserts do not. Passing `merged` rather than re-reading also removes a real read-after-write ordering assumption between the two modules. |
| D16 | **F16:** add a `Map<string, StatementSync>` in front of `raw.prepare` in `db.ts`, capped at `STMT_CACHE_MAX = 200` with oldest-first eviction, used by both the Drizzle proxy callback and the raw helpers. | Drizzle emits a small, stable set of SQL strings, so a cache hit is the normal case. The cap is not decoration: `pruneOps`'s `notInArray` generates a *distinct* SQL string per parameter count (`repos/ops.ts:90`), so an uncapped cache would itself be an unbounded map — exactly the F19 shape this phase is fixing elsewhere. Eviction is insertion-order; the compiled statements it drops are rebuilt on demand. |
| D17 | **F17:** `state/tabs.ts` keeps the last successfully-saved serialisation and skips both the IPC and the write when the current one is identical; `patchDataTabState`/`patchConsoleTabState` skip `saveDebounced()` when `Object.assign` changed nothing. | Cheaper than the write it avoids (ten tabs of tab state is a few KB of JSON), and it removes the whole redundant round trip rather than optimising `replaceTabs`. `replaceTabs`'s delete-all + insert-N shape is left exactly as it is — the dense-`order` guarantee its own comment records (`repos/tabs.ts:51-52`, "D17, mirrors filters.ts's whole-set replace pattern") depends on it, and a differential update would trade a real invariant for a write that now rarely happens. |
| D18 | **F21:** split the two intents behind `cache.dropTarget`. `cache.dropTarget` keeps today's hard-drop semantics and stays the handler for `DATA_OP.invalidate` (the ↻ Refresh button). New `cache.invalidateAfterMutation` drops pages and calls `counts.markCountTargetStale`; `handleMutate` calls it. `DATA_OP.invalidate` gains `scope?: 'all' \| 'pages'`, and `DataToolbar.vue`'s commit handler calls a new `reloadAfterMutation(tabId)` that passes `scope: 'pages'`. Finally, `runCount` sends `refresh: rt.count?.stale === true`, and `handleCount` skips the L3 read when `refresh` is set. | SPEC §7 spells out the required behaviour ("immediately marked *stale* (shown greyed with a refresh affordance) after any local mutation") and the UI for it is already built (reality 6) — the engine simply never produces the state. All four pieces are needed for the behaviour to be reachable: without the `scope` split, `reload()`'s hard invalidate erases the stale mark a millisecond after `handleMutate` sets it; without the `refresh` flag, clicking the refresh affordance would be served the stale value it is asking to replace. Deriving `refresh` from `stale` rather than always forcing keeps a Σ click on a fresh count a cache hit, which is what L3 exists for and what `tests/ui/data-view.spec.ts:206-223`'s op-count assertions encode. |
| D19 | **F19:** back L3 with `ByteLru` — `L3_BUDGET_BYTES = 256 * 1024`, a nominal `COUNT_ENTRY_BYTES = 128` per entry (≈ 2 000 entries), meta `{ connectionId, path, label: filter ?? '' }`. `dropCountTarget`/`dropCountConnection` become `deleteWhere` predicates; the 30-minute expiry needs a new single-key `ByteLru.delete`. | `lru.ts:14-18` already names L3 as the intended second user and the class already has every operation L3 needs bar one. Reusing it means one eviction policy, one place where "bounded" is enforced, and it replaces two hand-written prefix scans (`counts.ts:52-74`) with the same `deleteWhere` L2 uses. A fixed nominal per-entry cost rather than a real measurement: the entries are four scalars plus a key, the variance is noise, and an entry cap expressed in bytes keeps the single `ByteLru` shape. 2 000 entries is far beyond any realistic browsing session (F19's scenario reaches ~1 500 at its worst) while still being a bound. `lru.ts`'s doc comment is updated — it is now wrong. |
| D20 | **F20:** `clearPages()` resets `hits` and `misses` to 0. | The counters are read as a hit *rate* in two user-facing places, and a rate over a window that includes a cache the user explicitly emptied is not a meaningful number. "Since last clear" is the only interpretation that matches what the Clear button appears to do. |
| D21 | **Not fixed — renderer page eviction for cold (inactive) tabs.** `docs/PERF.md` §4 item 2 / P12 lever L-B. | Deliberate prior decision, twice. §2.2 requires pages to be released when a tab is **closed** ("Result pages are held only for tabs that are open; closing a tab frees its pages immediately") — which F4/F5/D4/D5 make actually true — and says nothing about inactive-but-open tabs. P12's D20/L-B declined it on the grounds that evicting a cold tab's page would put the ≤ 50 ms cached-tab-switch budget (§2.1) at risk on re-activation, and P12's own measurement puts the whole 10-tab delta at ≈ 18–43 MB (`docs/PERF.md` §2.2), i.e. ~2–4 MB per tab. Trading a hard interaction budget for single-digit megabytes is the wrong side of that trade; P13 records it as answered, not deferred. |
| D22 | **Not fixed — L1 (`metadata_cache`) has no TTL and is dropped only on connection delete and refreshed on every reconnect.** | Deliberate prior decision: P1 D10, restated at `engine/cache/index.ts:1-4` and implemented at `main/connections.ts:199-201`. It is also not a leak: rows are keyed `(connection_id, path)` with a unique index (`0001_init.sql:84`), each payload is capped at 4 MB (`repos/metadata-cache.ts:17`), and the row count is bounded by the connection's schema size, not by session length. `ON DELETE CASCADE` (`0001_init.sql:48`) removes every row when the connection goes. |
| D23 | **Not fixed — L2 pages outlive the tab that fetched them.** | Deliberate: §7 defines L2 as a byte-budgeted cache keyed by the *normalised request* (`cache/pages.ts:17-33`, P2 D12), specifically so two tabs on the same table share one page and re-opening a table is a hit. Its bound is the 64 MB budget and its lifetime bound is `cache.dropConnection` on disconnect (`control.ts:64-65`, §2.2). §2.2's "closing a tab frees its pages immediately" is about the renderer's retained pages — which is F4/F5's subject — not about the engine's shared, budgeted request cache. |
| D24 | **Not fixed — console results never populate L2 and a console run never invalidates any data tab's cache.** | Deliberate: SPEC §8.14, restated verbatim at `engine/data.ts:146-148` ("the adapter has no reliable way to know which table free-form SQL touched; the user's own ↻ still works"). |
| D25 | **F18:** `expand()` skips `loadChildren` when `treeState.children[k]` is already populated and no refresh was requested; `refresh()` and `refreshExpanded()` are unchanged. The design comment at `tree.ts:104-112` is rewritten to record why. | The comment's concern — "trying to be clever about it here would just duplicate that cache-aside logic and risk disagreeing with it" — is about *deciding whether the server needs asking*, which the renderer is genuinely not entitled to do. This change decides nothing of the sort: it returns data the renderer is already holding and rendering. The renderer's copy has exactly two invalidation sources and both already run — `onConnectionMetadataInvalidated` → `refreshExpanded` (`tree.ts:167-173`, which passes `refresh: true` and so is unaffected) and the explicit context-menu refresh. Since a collapse does not discard `treeState.children[k]`, re-expanding it is a pure re-render today; making it one in code is what §2.1's ≤ 50 ms tree-expand budget assumes. |

## 4. Checked and found sound (no change)

Recorded so a later reader knows these were examined and why they are not findings.

- **`main/engine-host.ts`'s pending-call map** — cleaned on response, on timeout, and on `exit`
  (`:65-75`), which rejects every outstanding entry.
- **`renderer/bridge/port.ts`** — clears each request's timer on settle (`:23`, `:52`) and rejects
  everything pending when the port is replaced.
- **Component listeners and observers** — `App.vue` (unsubscribe array, `:41`), `ContextMenu.vue`
  (`:43-53`, four paired add/remove plus a submenu timer cleared), `SettingsDialog.vue` (`:48-53`),
  `ConnectionDialog.vue` (`:84-88`), `VirtualList.vue` (`:20-25`), `DataGrid.vue`'s
  `ResizeObserver` (`:144`, disconnected at `:162`), `DataView.vue`'s `cancelPrefetch` on unmount
  (`:58-61`). All correctly paired; F9 is the single exception.
- **`grid/search.ts`'s scan loop** (`:64-91`) — `requestAnimationFrame`-chunked, retains match
  coordinates only and decodes transiently, and `cancel()` stops the chain. The leak is the
  *result* store outliving its tab (F4), not the scan.
- **`state/ops.ts`** — capped at `MAX_RECORDS = 500`.
- **`project/filter.ts`'s `compiledCache`** — bounded by the number of user-authored filter rules.
- **`views/celleditor/state.ts`'s overrides** — session-only and bounded by user action (P3 D12).
- **`repos/filter-history.ts`** — `HISTORY_LIMIT = 20` per `(connection, path)`, trimmed on write.
- **Schema FKs** — every FK in `0001_init.sql` is `ON DELETE CASCADE` or `SET NULL` and
  `foreign_keys` is `ON` (`db.ts:42`), so deleting a connection removes its filters, metadata cache,
  saved queries and tabs. F7 is the *renderer* not following main, not a missing constraint.
- **`repos/metadata-cache.ts`'s `putCached` read-merge-write** — two statements per write because a
  `children` and a `describe` payload can share one row (the unique index is `(connection_id, path)`
  and `kind` is not part of the key, `:8-15`). In practice only `describe` + `ddl` ever collide, and
  both are small; the large `children` payload belongs to a container path that has no other kind.
  The merge is the correctness guarantee and stays.
- **`db.transaction()` interleaving** — the sqlite-proxy driver issues real `BEGIN`/`COMMIT`
  (reality 11) with no serialisation, but the awaits between them resolve only microtasks against
  a synchronous `node:sqlite` handle, and `ipcMain.handle` callbacks resume as macrotasks — so two
  transactions cannot interleave today. No concrete failure scenario exists, so per §0 it is
  recorded here rather than "fixed" speculatively. Anything that later introduces real async I/O
  inside a transaction must revisit this.
- **`op_log` rows outliving their connection** — `ON DELETE SET NULL` (`0001_init.sql:58`) is
  deliberate: the operations panel keeps history for work the user did before deleting a
  connection. Bounded by D11 + `HARD_CAP_ROWS`.
- **SQLite free-page reuse after a prune** — `kira.db` does not shrink when `pruneOps` deletes
  rows, but the freed pages are reused by subsequent inserts and the table is hard-capped, so the
  file size is bounded. A `VACUUM` would block the main thread for the sake of an already-bounded
  file.
- **`mongo`/`redis`/`kafka` target resolution** — all resolve read targets from the path locally
  with no server round trip (`mongo/index.ts:221`, `redis/index.ts:98-107`, `kafka/index.ts:88-95`).
  F13/F14 are specific to the two SQL adapters and to SQS.
- **`kafka`'s per-browse ephemeral consumer group** (`kafka/read.ts:91`, unique `groupId` per
  browse) — deliberate (P10 D6) and cleaned up in a `finally` (`:150-154`).
- **`handlePrefetch` reusing `handleRead`** (`data.ts:104-113`) — deliberate, so a prefetch cannot
  double-count an L2 miss.

## 5. Test plan

### Must keep passing unchanged

- All of `tests/db/` — `postgres`, `mariadb`, `mongo`, `redis`, `kafka`, `sqs`, `preconnect`.
  D3's tracker change and D13's `resolveCountTarget` both touch code these drive directly.
- `tests/ui/data-view.spec.ts:190-223` — the pagination/Σ block asserts exact `count` op-log deltas.
  D18's `refresh` flag is derived from `stale`, and D13 removes catalog *statements* without
  changing the number of *ops*, so both deltas must be identical after the change. This is the
  sharpest existing guard on D13 and D18 and must not be adjusted to fit.
- `tests/ui/perf.spec.ts:179-203` — the retained-bytes symmetry assertion keeps reading
  `__kiraGridRetainedBytes()` (D5).
- `tests/ui/budgets.spec.ts` — all four §2.1 budgets; D25 should improve tree expand and must not
  regress the other three.
- `tests/ui/memory.spec.ts` — the 350 MB assertion and its logged teardown block.
- `tests/ui/tabs.spec.ts`, `console.spec.ts`, `mutations.spec.ts`, `tree.spec.ts`,
  `connections.spec.ts`, `workbench.spec.ts`, `smoke.spec.ts`, `interaction.spec.ts`,
  `cell-editor.spec.ts`, `ddl.spec.ts`, and the five per-kind UI specs.

### New coverage

**`tests/ui/leaks.spec.ts` (NEW)** — one Postgres container, the per-spec conventions
(`isDockerAvailable()` guard, local helpers, timeout override). Owns the assertion
`tests/ui/memory.spec.ts`'s teardown comment hands to this phase.

- *Tab open/close symmetry across all five page stores* (F4, F5, D4, D5): record
  `window.__kiraRetainedBytes()` at baseline; open a data tab, a console tab (with a large result
  set) and a DDL tab; close all three; assert the aggregate returns exactly to baseline. This is
  the assertion that fails today for console tabs.
- *Runtime records are released* (F4): after opening and closing 20 tabs, assert via
  `page.evaluate` that the aggregate retained bytes is back to baseline and that a re-opened tab
  starts from a default runtime (empty search state, no stale count, `status: 'idle'`).
- *Deleting a connection closes its tabs and leaves persistence working* (F7, D7): open two tabs on
  connection A and one on connection B, delete A, assert A's tabs are gone and B's remains, then
  change B's tab state, `relaunch`, and assert B's tab is restored — which fails today because the
  save transaction has been throwing since the delete.
- *Deleting a connection purges the tree* (F6, D6): expand several nodes on A, delete A, assert no
  tree row for A and that a `page.evaluate` probe of the tree store shows no `A|` keys.
- *L3 is bounded* (F19, D19): drive `window.kira`'s data bridge to count many distinct
  `{path, filter}` combinations, then read `cacheStats().l3Entries` (already exposed —
  `shared/protocol/data-ops.ts:168-176`, rendered at `StatusBar.vue:20`) and assert it stops
  growing at the budget rather than tracking the request count.
- *Clearing the cache resets the hit rate* (F20, D20): warm L2, read the Settings → Cache hit rate,
  click Clear, assert the hit rate reads as empty/0 rather than the pre-clear percentage.

**`tests/ui/mutations.spec.ts` (MOD)** — after committing a cell edit on a table with a known count:
assert the Σ button still shows the previous total, carries the `stale` class and the refresh
codicon (F21, D18), and that clicking it produces exactly one new `count` op row and clears the
stale class. This is the regression test for the §7 behaviour that has never worked.

**`tests/db/postgres.spec.ts` / `tests/db/mariadb.spec.ts` (MOD)** — replace `makeCtx()`'s no-op
`setCommand` (`postgres.spec.ts:26-31`) with a recording variant that pushes each statement into an
array, and add:
- *count issues one statement* (F13, D13): call `adapter.count(...)` with a recording ctx and assert
  exactly one recorded statement, matching `/count\(/i`. Today this records four (Postgres) or three
  (MariaDB).
- *read still resolves the catalog* (D13's boundary): call `adapter.read(...)` and assert the
  catalog statements are still there — P2 D10 is not being changed, and this pins that.
- *the running-query map does not grow* (F3, D3): run N reads through one adapter and assert the
  map is empty afterwards (via a test-only accessor or by asserting `cancel()` of a completed op
  returns `false`), then assert `cancel()` of an *in-flight* op still returns `true` — the
  behaviour D3 must not break.
- *a failed connect leaves nothing open* (F1, D1): point the adapter at a reachable host with bad
  credentials, assert `connect()` rejects, then assert a subsequent `disconnect()` is a clean no-op
  and (Postgres) that `pg_stat_activity` shows no additional backend for the test role.

**`tests/db/sqs.spec.ts` (MOD)** — assert that a second `read`/`count` on the same queue issues no
second `GetQueueUrl` (F14/F22, D14), by counting calls against the fixture's endpoint, and that a
`disconnect()` + `connect()` cycle re-resolves it.

**`tests/ui/tree.spec.ts` (MOD)** — collapse and re-expand a loaded node and assert no new
`children` op row (F18, D25), using the established `window.kira.opsRecent({ limit: 1000 })` pattern
(`tree.spec.ts:118`); then assert that the context-menu refresh *does* produce one.

**`tests/ui/workbench.spec.ts` (MOD)** — assert a settings patch of one field leaves the other
sections' values untouched across a `relaunch` (F15, D15). The write-narrowing must not lose data.

**Not covered by an automated test, recorded in `docs/PERF.md`:** F8 (window-close timer), F10
(engine-crash op reconciliation) and F12 (log retention) are startup/teardown paths that Playwright
cannot drive deterministically. Each gets a line in the manual checklist in `docs/PERF.md` §3.

## 6. Target tree at the end of P13

```
docs/
  PERF.md                          MOD — §4 rewritten: the three handed items are resolved (D19,
                                          D20, D21 answers L-B); three manual checks added to §3.
  plans/
    P13-nonfunctional.md           NEW — this document.
src/shared/
  protocol/data-ops.ts             MOD — countRequestWireSchema.refresh?: boolean;
                                          invalidateRequestWireSchema.scope?: 'all' | 'pages'.
src/engine/
  control.ts                       MOD — handleConnect disconnects a failed adapter and rethrows;
                                          handleTest's disconnect moves into a finally (D2).
  data.ts                          MOD — handleMutate → cache.invalidateAfterMutation;
                                          handleCount honours req.refresh (D18).
  rpc.ts                           MOD — DATA_OP.invalidate routes on `scope` (D18).
  cache/
    lru.ts                         MOD — delete(key); doc comment updated for L3 (D19).
    counts.ts                      MOD — ByteLru-backed, budgeted; explicit `stale` on
                                          StoredCount; markCountTargetStale (D18, D19).
    pages.ts                       MOD — clearPages() resets hits/misses (D20).
    index.ts                       MOD — invalidateAfterMutation alongside dropTarget (D18).
  adapters/
    postgres/index.ts              MOD — connect() assigns the set first + cleans up on failure
                                          (D1); resolveCountTarget (D13); tracker release (D3).
    postgres/query.ts              MOD — TrackQuery returns a release; runQuery calls it in a
                                          finally (D3).
    mariadb/index.ts               MOD — same three changes as postgres/index.ts.
    mariadb/query.ts               MOD — same as postgres/query.ts.
    sqs/index.ts                   MOD — per-connection queueUrls map, cleared on disconnect (D14).
    sqs/catalog.ts                 MOD — listQueues surfaces name→URL for the map (D14).
src/main/
  window.ts                        MOD — clear the bounds timer on 'closed' (D8).
  oplog.ts                         MOD — clear inFlight and finish abandoned rows on engine exit
                                          (D10); PRUNE_EVERY_OPS counted prune (D11).
  log.ts                           MOD — LOG_RETENTION_DAYS startup sweep of kira-*.log (D12).
  engine-config.ts                 MOD — pushEngineConfig accepts an already-merged Settings (D15).
  ipc/settings.ts                  MOD — passes `merged` instead of forcing a third read (D15).
  storage/
    db.ts                          MOD — capped prepared-statement cache (D16).
    repos/settings.ts              MOD — writes only the patched leaves (D15).
src/renderer/
  main.ts                          MOD — window.__kiraRetainedBytes aggregate; the grid-only hook
                                          stays (D5).
  state/
    tabRuntime.ts                  NEW — leaf cleanup registry (D4).
    tabs.ts                        MOD — closeTab calls cleanupTabRuntime; onConnectionsChanged
                                          closes tabs of deleted connections (D4, D7); save skips
                                          an unchanged snapshot (D17).
  project/state/tree.ts            MOD — dropConnectionState + its onConnectionsChanged wiring
                                          (D6); expand() reuses loaded children (D25).
  views/
    grid/state.ts                  MOD — reloadAfterMutation; runCount sends refresh when stale
                                          (D18).
    grid/search.ts                 MOD — registers its cleanup (D4).
    grid/DataGrid.vue              MOD — clear scrollSaveTimer on unmount (D9).
    grid/DataToolbar.vue           MOD — commit path calls reloadAfterMutation (D18).
    grid/page.ts                   MOD — no change to totalRetainedBytes; registers nothing.
    console/state.ts               MOD — registers its cleanup, clearing rt.results (D4, D5).
    console/resultPages.ts         MOD — totalRetainedBytes() (D5).
    ddl/state.ts                   MOD — registers its cleanup (D4).
    documents/state.ts             MOD — registers its cleanup (D4).
    documents/docPage.ts           MOD — totalRetainedBytes() (D5).
    keyvalue/state.ts              MOD — registers its cleanup (D4).
    keyvalue/kvPage.ts             MOD — totalRetainedBytes() (D5).
    stream/state.ts                MOD — registers its cleanup (D4).
    stream/streamPage.ts           MOD — totalRetainedBytes() (D5).
  bridge/data.ts                   MOD — invalidate(scope), count(refresh) (D18).
tests/
  ui/leaks.spec.ts                 NEW — retained-byte symmetry across all five stores, runtime
                                          release, connection-delete tab/tree purge, L3 bound,
                                          hit-rate reset (§5).
  ui/perf.spec.ts                  MOD — header note only; assertions unchanged (D5).
  ui/mutations.spec.ts             MOD — stale count after commit, one count op on refresh (D18).
  ui/tabs.spec.ts                  MOD — persistence survives a connection delete (D7).
  ui/tree.spec.ts                  MOD — re-expand issues no children op; refresh does (D25).
  ui/workbench.spec.ts             MOD — a one-field settings patch preserves other sections (D15).
  db/postgres.spec.ts              MOD — recording setCommand; count statement count; tracker map;
                                          failed-connect cleanup (D1, D3, D13).
  db/mariadb.spec.ts               MOD — same four as postgres.spec.ts.
  db/sqs.spec.ts                   MOD — GetQueueUrl issued once per connection (D14).
```
