# P2 — Tabular data view

> **Deliverable (SPEC §10).** Virtualized grid, tabs (same table N times), pagination + page
> sizes, count-all, projection, sort, stop button, search toolbar, filter toolbar (WHERE +
> ORDER BY + history/saved), L2/L3 caches, prefetch. MariaDB adapter.

**Why this phase matters.** Two things happen here that nothing before them could force.

The first is that a *second SQL engine validates the adapter abstraction cheaply*. P1 built
`Adapter`, `Caps` and the §5.1 capability table against exactly one implementation, which means
every seam in it is currently unfalsified — a `Caps` field that Postgres happens not to need, a
`NodePath` shape that happens to have three segments, a cancel contract written around
`pg_cancel_backend`. MariaDB is the cheapest possible second witness: same query language, same
`kind: 'tabular'` pages, but two segments instead of three (`database → table/view/routine`,
no schema level), a `routine` node kind Postgres never produced, `KILL QUERY <threadId>` instead
of a side-channel cancel packet, and a connection model that is *not* database-scoped. If the
abstraction survives that without special-casing in the renderer, it will survive MongoDB in P7.
If it doesn't, we find out now, for the price of one adapter, instead of in P7 for the price of a
rewrite.

The second is that this is the *first virtualized, high-frequency-render surface*, so the §2.1
performance rules stop being aspirational and start being load-bearing. Up to now "no Vue
reactivity on row data" cost nothing because there was no row data; "≤8 ms scroll frames" cost
nothing because nothing scrolled 10,000 items; "byte-budgeted caches, not entry counts" cost
nothing because nothing held bytes. P2 makes all three real simultaneously, and it does it on the
one screen the user stares at all day. Every decision below about columnar storage, frozen
non-reactive page objects, explicit version counters and byte accounting exists to make those
budgets structurally true rather than something a later phase has to claw back.

---

## 0. Ground rules for this phase

**Read first.** `docs/SPEC.md` §2.1, §2.2, §4, §5, §5.1, §7, §8.4, §8.5, §8.10, §8.11, §9;
`docs/plans/P1-connections-and-tree.md` §1 (decisions D1–D22), §3 (contracts), §4 (adapter model).
P2 does not restate P1's decisions; it extends them, and where it changes one it says so with a D
number.

**Standing rules carried forward from P1** (unchanged unless a D below says otherwise):

1. Zod-validate at every trust boundary: IPC in main, port frames in the engine, anything read
   back out of SQLite.
2. The renderer never receives a password.
3. Every DB call goes through `runOp` so it lands in the op log with a working stop button.
4. `AdapterError` codes are a closed set; the server's message is preserved verbatim.
5. No `any`. No non-null assertions on values that cross a process boundary.
6. Every UI surface gets a stable `data-testid`.
7. **Modified by D12** — P1's "never interpolate a database identifier into a SQL string" becomes
   "never interpolate a database identifier that did not come from cached catalog metadata, and
   only through the adapter's `quoteIdent`."

**Out of scope for P2.** Do not build these; several of them are one small step away and that is
exactly why they need naming:

| Not in P2 | Where it lands |
| --- | --- |
| Cell editing, the cell editor panel, dirty-cell tracking, transaction badge | P3 |
| Copy/paste of rows or cells, grid cell/row context menus, FK navigation | P6 (§8.10) |
| DDL viewer, object detail tabs, `describe`-backed structure tab | P4 |
| Query console, ad-hoc SQL, `saved_queries` with `kind: 'console'` | P5.5 |
| Export (CSV/JSON), import | P6 |
| Non-tabular pages: `DocumentPage`, `KeyValuePage`, `StreamPage` and their views | P7/P8 |
| Column freezing/pinning, grouped headers, cell heatmaps | P11 |
| Server-side full-text search across the whole table (search toolbar is page-local, D19) | never — that is what the filter toolbar is |
| Encryption of stored credentials | deferred per §1 |
| Auto-respawn of a dead engine | post-P5 decision, still open |

**Test commands.** Every step below names its own check. The three commands are:

- `bun run typecheck` — both projects; must be clean after every step.
- `bun run test:db` — Bun + Testcontainers, no Electron. Requires Colima
  (`DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`,
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`). Skips with a reason when Docker
  is unavailable; a skip is not a pass.
- `bun run test:ui` — builds to `out-test/` and runs Playwright against a real Electron.

**P1 realities you must work with (verified against the tree, not the P1 plan).** These are the
facts on disk as of `2c79b86`. Several differ from what the P1 plan projected.

1. **The renderer↔engine port carries exactly one op: `ping`.** `src/engine/rpc.ts` has
   `handlers = { ping }` and returns `{ code: 'UNKNOWN_OP' }` for anything else.
   `src/renderer/bridge/port.ts` has a `request(op, payload)` with a 30 s timeout and a
   `handleMessage` that assumes **every inbound frame is a `PortResponse`** — there is no `evt`
   branch, so `PortEvent` (declared in `src/shared/port.ts`) is currently dead. P2 makes both
   sides real (Step 2).
2. **`src/engine/ops.ts` `runOp` already exposes `ctx.setRows`** in addition to `ctx.setCommand`,
   which the P1 plan text did not promise. The read path needs it; use it rather than adding
   another channel. `runOp`'s spec today is `{ connectionId, kind }` and mints its own `opId`.
3. **Migrations are Drizzle, not raw SQL.** `src/main/storage/schema.ts` is the single source of
   truth and `bun run db:generate` emits into `drizzle/`. `migrate.ts` resolves
   `resolve(process.cwd(), 'drizzle')`. **P2 needs no schema change**: `tabs` and `saved_queries`
   already exist with exactly the columns P2 needs (D14, D17). Do not hand-write SQL in `drizzle/`.
4. **`src/shared/ops.ts` `opKindSchema` is `['connect','disconnect','children','describe','test']`.**
   P2 adds exactly `'read'` and `'count'` — nothing else.
5. **`opStartEventSchema` has no `tabId`,** and `src/main/index.ts` hardcodes `tabId: null` in both
   the `op:start` and `op:end` branches of the op-log wiring, with the comment that P2 can fill it.
   Step 4 fills it; D9 depends on it.
6. **All four workbench panels are `EmptyState` stubs.** `MainView.vue`, `TabStrip.vue`,
   `Toolbar.vue`, `CellEditorPanel.vue` are 7-line files. `WorkbenchShell.vue` gives the tab strip
   and toolbar a fixed `32px` track each and `MainView` `flex: 1; min-height: 0`. P2 fills three of
   them and leaves `CellEditorPanel.vue` untouched for P3.
7. **`VirtualList.vue` is vertical-only, fixed-row-height, single-axis** (spacer divs + a slot per
   item). It is right for the tree and the ops panel and wrong for the grid; P2 writes a separate
   `DataGrid.vue` and leaves `VirtualList.vue` alone (D22).
8. **`src/renderer/project/menus.ts` `treeRowMenu` has no "Open data" items** — only Refresh, Copy
   name, Copy qualified name. P1 deliberately omitted them. Step 8 adds them, plus "Count rows"
   and "Saved filters ▸", which P1 explicitly deferred to P2.
9. **`SettingsDialog.vue`'s Data and Cache sections are hardcoded and `disabled`** with the text
   "Available once data views land." `src/shared/settings.ts` has only `appearance`. Step 1 grows
   the schema; Step 16 makes the controls real.
10. **`StatusBar.vue` has no cache readout and no "● N connected".** §7 requires the cache size to
    be visible in the status bar; Step 16 adds it.
11. **`src/shared/tree.ts` `nodeKindSchema` has no `'routine'`** (it has `function` and
    `sequence`). MariaDB's §5.1 row is `database → table/view/routine`. D24 resolves this.
12. **`ClientSet` (postgres/client.ts) hands out one shared `Client` per database with no
    checkout.** With P1's one-op-at-a-time usage that was safe; P2 runs a read, a count and a
    prefetch concurrently on one connection, and `pg_cancel_backend(pid)` cancels *whatever that
    backend is currently running*. D11 fixes this before it becomes a data-integrity bug.
13. **`ConnectionDialog.vue` lists MariaDB as `supported: false`** and `uri.ts`
    `canRoundTripToFields` hard-returns `false` for any kind other than `postgres`. Step 14 flips
    both.
14. **`tests/db/fixtures/0001_seed.sql` is Postgres-specific** (schemas, `jsonb`, `matview`,
    `bigserial`, quoted-identifier tables). MariaDB gets its own fixture file; the existing one is
    not renamed or restructured.

---

## 1. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| **D1** | **Result pages travel over the renderer↔engine `MessagePort` (ops `data:read`, `data:count`); everything else stays on `ipcRenderer.invoke` → main → engine.** Opening a tab, persisting tab state, saved filters, cancel, and settings all stay on the control channel. | §4, verbatim. The port skips two serialization hops and keeps main's event loop out of the per-page path, which is what protects the 8 ms frame budget when a 5 000-row page lands. Control traffic is small, rare, and needs main's SQLite anyway. |
| **D2** | **Pages are columnar: per column one flags byte-array plus one typed array (`Float64Array`/`BigInt64Array`/`Uint8Array`) or a UTF-8/bytes blob with an `Int32Array` offset index. No row objects ever exist.** | §2.2 "columnar/typed-array result storage". A 5 000×40 page as JS objects is 200 000 property slots and ~20 MB of heap; as columns it is ~40 buffers and the byte count is *exactly* known, which is the only way the byte-budgeted L2 of §7 can be honest rather than a guess. |
| **D3** | **The columnar buffers are *copied*, not transferred, over the port — SPEC §4's "as transferable `ArrayBuffer`s" is not achievable in Electron 43.** Verified: `electron.d.ts` declares `MessagePortMain.postMessage(message: any, transfer?: MessagePortMain[]): void` — the transfer list accepts only `MessagePortMain`, never `ArrayBuffer`. | Say it out loud rather than discover it in Step 2. The win §4 was actually reaching for — not shipping one JS object per row across a process boundary — is fully preserved by D2; what is lost is one `memcpy` per page (~2 MB at the default page size, sub-millisecond). Keep the layout transfer-ready so a future Electron that widens the transfer list is a one-line change, and note the silver lining: because it is a copy, an L2-cached buffer can never be detached by being sent, so no defensive `slice()` is needed on cache hits. |
| **D4** | **A read query returns every value as the server rendered it, as text, except for five families that get native encodings: int2/int4/oid/float4/float8 → `f64`, int8 → `i64`, bool → `bool`, byte strings → `bytes`, everything else → `utf8`.** `numeric`/`DECIMAL` stay `utf8`. | Two independent reasons. Precision: `numeric(38,10)` through a `double` is data corruption, and a client that silently reformats what the server sent is worse than useless for a DB tool. Cost: the driver's default parsers (pg building `Date` objects, `JSON.parse` on every `jsonb` cell) are a large hidden per-cell cost we are paying to then re-stringify for display. Postgres gets `types: { getTypeParser: () => (v) => v }` on read queries only (catalog queries keep the default parsers); MariaDB gets an equivalent `typeCast`. |
| **D5** | **Cell payloads are capped at 64 KiB in the page encoding, with a per-cell `truncated` flag (bit 1 of the flags byte).** Grid shows the prefix plus `…`. | §9.1's fixture has a 1 MB text column and a 256 KB `bytea`; a 5 000-row page of those is 5 GB. Truncation is the only way the page-size selector can offer 5 000 at all. Full-value retrieval is P3's cell editor; the flag is the hook it will use. |
| **D6** | **Pagination is dual: keyset when the effective `ORDER BY` is exactly the primary key (uniform direction), offset in every other case, with the PK appended as a tie-breaker for stability.** The cursor is `{kind:'offset', offset} \| {kind:'keyset', token, direction}`. | §5.1 says "keyset on PK, else LIMIT/OFFSET" and §8.5's pager needs `⏮ ◀ ▶ ⏭` plus jump-to-page. Keyset cannot jump to page 57; offset degrades quadratically at depth. The default (unsorted) case and the sort-by-PK case — which is the overwhelming majority of sequential paging — take the keyset path; a user-typed `ORDER BY` takes the offset path. Widening keyset to arbitrary sorts is a P11 optimization, not a P2 requirement. |
| **D7** | **`⏭ last page` and the "of M" in the pager are disabled/blank until a count is known**, because a last-page jump needs a total. | Falls out of §8.5's own wording ("the row count is an estimate until you press Count all"), so it is not a compromise — it is the spec's behaviour made mechanical. |
| **D8** | **`count` takes a `mode: 'estimate' \| 'exact'` in its request and returns the roadmap's `{value, exact}` unchanged.** Estimate = `pg_class.reltuples` / `information_schema.TABLES.TABLE_ROWS`, and is only offered when there is no filter. With a filter and no count-all, the pager shows `?`. | Keeps `count(req, ctx): Promise<{value, exact}>` — the normative signature written into `adapter.ts` in P1 — byte-identical, while serving both §8.5 behaviours from one op. An estimate of a filtered table is not an estimate, it is a lie. |
| **D9** | **The renderer never mints an `opId`. It derives each tab's running-op set from the existing `kira:op:update` push, which now carries `tabId`, and the stop button calls the existing `kira:ops:cancel`.** | One source of truth for "what is running", shared with §8.11's ops panel, and zero new cancel plumbing — P1's `runOp`/`abortOp`/`adapter.cancel` chain is reused whole. The cost is that the stop button is inert for the few ms before the push arrives; since §2.1 only requires a stop button on operations that can exceed ~150 ms, and the spinner itself does not appear until 150 ms, this is unobservable. |
| **D10** | **L2 (pages) and L3 (counts) both live in the engine, in one module, keyed exactly as §7 specifies.** L1 metadata stays in main's SQLite (P1 D10). Main holds no page bytes. | §7 says L2 is "in-memory LRU in the engine"; putting L3 anywhere else would mean a second invalidation path for the same `{connectionId, path, filter}` key. Keeping every byte of result data in the engine is also what makes §2.2's `--max-old-space-size=512` a meaningful bound: main and the renderer cannot silently accumulate result memory. |
| **D11** | **Adapters lease physical connections. `lease()` returns an exclusive connection whose backend pid/threadId is known; the op's tracking entry records that exact connection; `cancel(opId)` targets it, and if the op has not been leased yet it is dropped locally and reports success.** Postgres: up to 3 leases per database, still bounded at 8 databases. MariaDB: up to 3 leases total. | P2 is the first phase with concurrent ops on one connection (read + prefetch + count), and P1's shared-`Client` model makes `pg_cancel_backend(pid)` cancel whichever query that backend happens to be running — pressing stop on a prefetch could kill the user's read. Exclusive leases preserve P1 D14's actual reason for rejecting a `Pool` (you must know which backend ran your query) while making concurrency safe. |
| **D12** | **Each adapter exports `quoteIdent(name: string): string`, and identifiers are only ever fed to it from cached catalog metadata (the decoded `NodePath` and the column list from `describe`), never from user free-text.** Postgres doubles `"`, MariaDB doubles `` ` ``; both reject `\0`. | P1's absolute "never interpolate an identifier" rule cannot survive `SELECT <cols> FROM <table>` — no SQL dialect parameterizes identifiers. Narrowing the rule to "only catalog-sourced names, only through the adapter's quoter" keeps the guarantee that matters (nothing the user typed becomes an identifier) and is testable against the seed's `app."weird""name"` and `app."Order Items"` fixtures. |
| **D13** | **The filter toolbar's `WHERE` and `ORDER BY` are spliced into the SQL verbatim, wrapped in parentheses, and the server's error is shown unmodified.** Multi-statement injection is structurally blocked: pg's extended protocol refuses multiple statements in a parameterized query, and `mariadb` defaults `multipleStatements: false` — set it explicitly to `false` anyway. | §8.5 designs for this: "the filter is pushed to the server; syntax errors come back as the server's own message". Parsing and re-emitting the user's SQL would produce worse errors and reject valid dialect-specific syntax. The parenthesis wrap shifts the server's reported error offset; that is acceptable because the message, not the position, is what §8.5 promises. |
| **D14** | **The `saved_queries` ambiguity resolves as: history and saved are the same rows, distinguished by `name`.** `kind: 'filter'` (P5.5 will add `'console'`), `body` = `{"where": "...", "orderBy": "..."}`, unnamed rows are history and are pruned to the 20 most recent per `(connection_id, path)`, named rows are "saved/pinned", never pruned, and sort first in the history dropdown. | §8.5 says history shows "the previously used filters and sorts for this table, plus anything saved… an entry can be named and pinned" — naming *is* the pinning act. This needs no schema change, no new table, no new concept, and leaves `kind` free for P5.5's console entries in the same store. |
| **D15** | **Session restore (§8.4) is in scope.** Tabs persist to the `tabs` table (debounced 250 ms); on launch the tab strip rehydrates and every restored tab renders a centred **Reconnect & load** button instead of firing a query. | It is the only reason the `tabs` table exists, it is ~60 lines on top of persistence we need anyway, and it is the strongest end-to-end Playwright assertion available in this phase (relaunch → tabs present → zero ops logged). Deferring it would mean writing the persistence and then deliberately not reading it back. |
| **D16** | **Tab identity is a UUID, never the path.** "Open data" focuses an existing tab for that path if one exists; "Open data in new tab" and double-click-with-⌘ always create one; each tab owns an independent filter/sort/projection/page state. | §8.4, verbatim: "Tab identity is the tab's `id`, not its path… the same table can be open five times with five different filters." |
| **D17** | **The `ORDER BY` text box is the single source of truth for sort; clicking a header rewrites it.** Header arrows are rendered from a best-effort parse of that text (simple `col [ASC\|DESC]` lists); when it does not parse, no arrows are shown and the text still wins. | §8.5 gives the user two sort affordances (header click, `ORDER BY` box). Storing both would create two states that can disagree, and the resulting reconciliation bug is the kind that ships. One string, one truth, one place to persist. |
| **D18** | **Projection is a `string[] \| null` (null = all columns in catalog order) driven by the toolbar's `columns ▾` multi-select, and it changes the SQL select list — it is not a CSS `display:none`.** | §8.5 calls it "projection", and §5.1 gives Postgres and MariaDB `projection: true`; pushing it down is the whole point (fewer bytes on the wire, fewer bytes in L2). Hiding columns client-side would make the L2 key lie. |
| **D19** | **The search toolbar searches only the currently loaded page, in the renderer, and never touches the server. It is not mixed with the filter toolbar in any way** — different placement, different keybinding (⌘F vs the filter row), different result semantics (highlight/step vs re-query). | §8.5: "This is deliberately not mixed with the server-side filter." Users who conflate them get silently wrong results on table 2 of 400 000 rows. Searching runs in 2 000-row rAF slices with a running match count so a 5 000×40 page cannot stall the frame budget. |
| **D20** | **Page sizes are 100 / 500 / 1 000 / 5 000, default 500**, settable globally in Settings → Data and overridable per tab from the toolbar. | 500 rows × 40 columns is ~200 KB encoded — one round trip, well inside a frame budget to decode nothing (decoding is lazy per visible cell), and ~30 pages fit L2's 64 MB default. 5 000 exists for "select all, scroll, eyeball" and is where D5's truncation earns its keep. |
| **D21** | **Prefetch is renderer-driven**: after a page renders, a `requestIdleCallback(…, {timeout: 500})` issues the *next* cursor's read with `prefetch: true`; the engine fills L2 and returns `{cached, rowCount, bytes}` with **no payload**. Any navigation, filter, sort or projection change cancels the pending prefetch before it is sent. | §7 requires "cancellable, dropped if the user navigates away" — only the renderer knows what "navigates away" means. Returning no payload avoids paying D3's copy for bytes we would immediately discard. Prefetch ops are ordinary logged `read` ops (no new op kind, no schema change); UI specs that count ops turn prefetch off in Settings first. |
| **D22** | **`DataGrid.vue` is new and two-axis; `VirtualList.vue` is untouched.** The grid holds row data in a frozen, non-reactive `PageView` object and re-renders off an explicit `version` ref, exactly as §2.1 mandates. Only the window bounds, column layout and selection are reactive — all O(visible), never O(rows). | §2.1: "Row data is never reactive. Result pages are frozen plain structures; the grid reads them imperatively and re-renders on an explicit version counter." Retrofitting a single-axis, slot-per-item list into a 2-axis grid with a sticky header, a row gutter and resizable columns would produce something worse than either. |
| **D23** | **MariaDB uses one primary connection (plus D11 leases) with fully qualified `` `db`.`table` `` names — it does *not* mirror Postgres's per-database client.** Cancellation uses a fresh side connection issuing `KILL QUERY <threadId>`. | MariaDB is not database-scoped the way Postgres is; a connection can address every schema, so per-database clients would burn sockets against §2.2 for nothing. This divergence is a feature of the phase: it is the first real proof that `Adapter` tolerates different connection topologies without the layers above noticing. |
| **D24** | **`nodeKindSchema` gains `'routine'`**, used by MariaDB for both `PROCEDURE` and `FUNCTION` rows; Postgres keeps emitting `'function'`. | §5.1's MariaDB row literally says `database → table/view/routine`. Forcing MariaDB's procedures into `'function'` would misname them in the UI; adding a kind is one enum entry plus one icon mapping, and the tree is already capability-driven. |
| **D25** | **Cache observability is push-based**: the engine emits a throttled (≤2/s) `cache:stats` port **event** after each read/count; the renderer keeps it in a state module for the status bar and Settings → Cache. `cache:clear` is a port request. | §7 requires the cache size be visible in the status bar and clearable from settings. Polling a size counter from the renderer is both wasteful and stale; and this is the one genuine consumer that makes `PortEvent` (declared but dead since P0) real, which the phase needs anyway for future streaming pages. |
| **D26** | **L2/L3 invalidation triggers: connection disconnect drops everything for that connection; a refreshing `describe`/`children` on a path drops that path's entries; the toolbar's Refresh sets `refresh: true`, which bypasses the L2 lookup and overwrites the entry (and drops the L3 entry for count).** No TTL on L2; L3 keeps §7's 5-minute TTL. | §7 gives L3 a TTL and L2 none, because a page is only wrong if the data changed, and the events that can change it are exactly the ones enumerated here. §2.2 requires pages be freed on tab close — the LRU handles that implicitly, but tab close also issues an explicit drop for its key prefix so a closed 5 000-row tab does not hold 64 MB hostage. |
| **D27** | **`mariadb` goes in `dependencies`, not `devDependencies`, and no `@types/mariadb` is installed** (it does not exist; `mariadb@3.5.x` ships `types/index.d.ts`). | `electron.vite.config.ts` uses `externalizeDepsPlugin()`, which externalizes `dependencies` only — a driver in `devDependencies` would be bundled into `engine.js` and break its native-ish require graph, exactly as `pg` would have. |
| **D28** | **Column widths are assigned deterministically from the declared type and header length (`clamp(max(header.length, typeWidth) * ch, 80, 320)`), never by measuring content.** Double-clicking a resize handle auto-fits against the first 200 loaded rows. | A measuring pass over 5 000 rows before first paint is precisely the thing §2.1's frame budget forbids. Deterministic initial widths also make the Playwright layout assertions stable. |
| **D29** | **New context menus in P2 are limited to the two surfaces P2 owns: the column header (sort asc/desc, clear sort, hide column, show all columns, copy column name) and the tab (close, close others, close to the right, close all, duplicate, copy name, reveal in project panel).** Grid cell and grid row menus stay P6. | Every item listed maps 1:1 onto behaviour P2 is already building, so the menus cost nothing but wiring. Cell/row menus are ≥60 % copy/edit/FK-navigate items that do not exist until P3/P6, and a menu of disabled items is worse than no menu. |

---

## 2. Target file tree

Only new (`+`) and modified (`~`) files. Everything else stays as it is.

```
src/
  shared/
  ~ caps.ts                      // no change to Caps; re-export PageKind consumers use
  + page.ts                      // ColumnEncoding, PageColumn, TabularPage, PageCursor, flags bits
  + data.ts                      // ReadRequest / CountRequest / ReadResult / CountResult (Zod)
  + tabs.ts                      // TabRecord, DataTabState, tabStateSchema
  + saved-query.ts               // SavedQuery, FilterBody, kind enum
  ~ port.ts                      // PORT_OP / PORT_EVENT consts, cacheStats event payload
  ~ ops.ts                       // opKindSchema += 'read' | 'count'
  ~ engine-ops.ts                // opStartEventSchema += tabId; ENGINE_OP.configure
  ~ ipc.ts                       // tabs:*, savedQueries:* channels
  ~ settings.ts                  // data{} and cache{} sections
  ~ tree.ts                      // nodeKindSchema += 'routine'
  ~ uri.ts                       // canRoundTripToFields accepts mysql/mariadb
  main/
  ~ index.ts                     // op-log wiring: real tabId from op:start
  ~ ipc.ts                       // register tabs + savedQueries services; push settings to engine
  + storage/tabs.ts              // getAllTabs / replaceTabs (Drizzle)
  + storage/saved-queries.ts     // list / upsert / touch / delete / pruneHistory (Drizzle)
  preload/
  ~ index.ts                     // expose the new channels
  engine/
  ~ rpc.ts                       // dispatch data:read / data:count / cache:*; emitEvent helper
  ~ ops.ts                       // runOp spec += tabId
  ~ control.ts                   // configure op; drop caches on disconnect / refreshing describe
  + cache.ts                     // L2 (byte-budgeted LRU) + L3 (TTL) + stats
  + page/encode.ts               // adapter-agnostic columnar encoder
  + page/sql.ts                  // shared SELECT / COUNT builder + keyset predicate
  + lease.ts                     // generic lease pool used by both adapters
  adapters/
  ~ adapter.ts                   // read() / count() / quoteIdent() on Adapter; roadmap updated
  postgres/
  ~ client.ts                    // ClientSet.lease(database) (D11)
  ~ query.ts                     // raw-text type parsers for read queries
  ~ index.ts                     // read/count/quoteIdent, cancel targets the leased pid
  + read.ts                      // pg field OID → ColumnEncoding, page assembly
  + mariadb/{index,client,query,catalog,caps,read}.ts
  renderer/
  bridge/
  ~ port.ts                      // evt frames, subscribe(), typed read/count wrappers
  ~ control.ts                   // tabs + savedQueries wrappers
  workbench/
  ~ panels/MainView.vue          // tab body: grid | reconnect | error | empty
  ~ panels/TabStrip.vue          // real tabs, colour tint, context menu, overflow
  ~ panels/Toolbar.vue           // §8.5 data-view toolbar
  + DataGrid.vue                 // two-axis virtualization (D22)
  + FilterToolbar.vue            // history ▾ · WHERE · ORDER BY · apply/clear
  + SearchToolbar.vue            // ⌘F, page-local (D19)
  + ReconnectPrompt.vue          // §8.4 restored-tab placeholder
  ~ StatusBar.vue                // cache size readout
  ~ SettingsDialog.vue           // Data + Cache sections become real
  + state/tabs.ts                // tab list, active tab, per-tab load/refresh/paging
  + state/page.ts                // PageView: frozen page + lazy decode + version counter
  + state/cache.ts               // last cache:stats event
  ~ state/ops.ts                 // index running ops by tabId (D9)
  project/
  ~ menus.ts                     // Open data / Open data in new tab / Count rows / Saved filters ▸
  ~ ConnectionDialog.vue         // MariaDB supported, default port 3306
  ~ icons.ts                     // 'routine' icon
tests/
  + db/mariadb.spec.ts
  + db/support/mariadb.ts
  + db/fixtures/mariadb_seed.sql
  + db/read.spec.ts              // encoder + pagination + cancel, Postgres
  + ui/data-view.spec.ts
  ~ ui/support/api.ts            // tabs/savedQueries wrappers
drizzle/                          // unchanged — no migration in P2 (see §0.3)
```

---

## 3. Shared contracts

This is the section everything else hangs off. Get these exactly right before writing any
behaviour; every later step is a consumer.

### 3.1 `src/shared/page.ts` — the wire format for result data

```ts
// Bits in a column's per-row flags byte. Two bits today, six spare — do not repurpose them
// without changing the encoder and every decoder in lockstep.
export const CELL_NULL = 1 << 0;
export const CELL_TRUNCATED = 1 << 1;

export const MAX_CELL_BYTES = 64 * 1024; // D5

export type ColumnEncoding = 'f64' | 'i64' | 'bool' | 'utf8' | 'bytes';

export interface PageColumn {
  name: string;
  /** The server's own type name (`int4`, `VARCHAR(255)`, `jsonb`). Header tooltip + alignment. */
  dataType: string;
  encoding: ColumnEncoding;
  /** length === rowCount. CELL_NULL / CELL_TRUNCATED. One byte per row, not a bitmask:
   *  it is 1/8th the size of an f64 column and removes a shift+mask from every cell read. */
  flags: Uint8Array;
  /** f64 | i64 | bool — length === rowCount. `bool` uses 0/1 bytes. Absent for utf8/bytes. */
  values?: Float64Array | BigInt64Array | Uint8Array;
  /** utf8 | bytes payload, concatenated. Absent for f64/i64/bool. */
  data?: Uint8Array;
  /** utf8 | bytes — length === rowCount + 1; cell i spans [offsets[i], offsets[i+1]). */
  offsets?: Int32Array;
}

export type PageCursor =
  | { kind: 'offset'; offset: number }
  | { kind: 'keyset'; token: string; direction: 'next' | 'prev' };

/** Canonical string form of a cursor. Used both as the on-the-wire token and as the final
 *  component of the L2 key (§7 calls it `pageToken`). `off:0`, `ks:next:<token>`. */
export function cursorKey(c: PageCursor): string;

export interface TabularPage {
  kind: 'tabular';
  columns: PageColumn[];
  rowCount: number;
  /** Absolute offset of row 0 when known (always for offset cursors, only when the keyset walk
   *  started from a known offset otherwise). Drives the row-number gutter. */
  offset: number | null;
  nextToken: string | null;   // null ⇒ this is the last page
  prevToken: string | null;
  /** Sum of every buffer's byteLength. The *only* number L2 budgets against (§2.2). */
  bytes: number;
  truncatedCells: number;
  elapsedMs: number;
  fromCache: boolean;
}
```

`TabularPage` is one arm of §5's `Page` discriminated union; declare the union in `page.ts` as
`export type Page = TabularPage` with a comment naming `DocumentPage | KeyValuePage | StreamPage`
as P7/P8 arms, so `Adapter.read`'s return type is already the union and P7 widens it without
touching call sites.

**Not Zod.** `TabularPage` crosses a process boundary but carries megabytes of typed arrays; a Zod
parse per page would defeat D2's whole point. Validate it structurally instead: a single
`assertTabularPage(v: unknown): TabularPage` in the renderer that checks `kind`, `rowCount`, and
that each column's buffer lengths agree with `rowCount`, then `Object.freeze`s the wrapper. Say so
in a comment — this is a deliberate, bounded exception to standing rule 1, and it is the only one.

### 3.2 `src/shared/data.ts` — requests (these *are* Zod; they cross into SQL)

```ts
export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const pageCursorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offset'), offset: z.number().int().min(0) }),
  z.object({
    kind: z.literal('keyset'),
    token: z.string().max(8192),
    direction: z.enum(['next', 'prev']),
  }),
]);

export const readRequestSchema = z.object({
  connectionId: z.string(),
  /** Encoded NodePath of a table/view/matview (§3 of P1's contracts). */
  path: z.string(),
  /** Stamped onto op:start so the renderer can attribute the running op to a tab (D9). */
  tabId: z.string(),
  /** null ⇒ every column in catalog order (D18). */
  projection: z.array(z.string()).nullable(),
  /** Free-text WHERE body, no `WHERE` keyword. Empty ⇒ no predicate (D13). */
  where: z.string().max(20_000),
  /** Free-text ORDER BY body, no `ORDER BY` keyword. Empty ⇒ adapter default (D17). */
  orderBy: z.string().max(20_000),
  pageSize: z.number().int().min(1).max(20_000),
  cursor: pageCursorSchema,
  /** Bypass the L2 lookup and overwrite the entry (Refresh button, D26). */
  refresh: z.boolean().default(false),
  /** Fill L2 and return no payload (D21). */
  prefetch: z.boolean().default(false),
});
export type ReadRequest = z.infer<typeof readRequestSchema>;

export const countRequestSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  tabId: z.string(),
  where: z.string().max(20_000),
  mode: z.enum(['estimate', 'exact']),
  refresh: z.boolean().default(false),
});
export type CountRequest = z.infer<typeof countRequestSchema>;

/** `page` is null exactly when the request was a prefetch. */
export type ReadResult =
  | { delivered: true; page: TabularPage }
  | { delivered: false; rowCount: number; bytes: number };

export interface CountResult { value: number; exact: boolean; fromCache: boolean; at: string }
```

`ReadRequest` deliberately does *not* carry a structured `sort: SortSpec[]`. D17 made the
`ORDER BY` text the single truth; a parallel structured field would be a second one. The adapter
parses it far enough to decide keyset eligibility (D6) and no further.

### 3.3 `src/shared/port.ts` — protocol additions

Keep `PortRequest`/`PortResponse`/`PortEvent` exactly as they are; add the op and topic
vocabularies so neither side spells a string literal:

```ts
export const PORT_OP = {
  ping: 'ping',
  read: 'data:read',
  count: 'data:count',
  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
} as const;

export const PORT_EVENT = { cacheStats: 'cache:stats' } as const;

export interface CacheStats {
  l2Bytes: number; l2Entries: number; l2Budget: number; l2Hits: number; l2Misses: number;
  l3Entries: number; l3Hits: number; l3Misses: number;
}
```

Note in a comment that a `data:read` response is the one frame where `payload` is not
JSON-shaped — it carries typed arrays, cloned per D3.

### 3.4 `src/shared/tabs.ts` — tab and per-tab state

```ts
export const dataTabStateSchema = z.object({
  projection: z.array(z.string()).nullable().default(null),
  where: z.string().default(''),
  orderBy: z.string().default(''),
  pageSize: z.number().int().default(500),
  cursor: pageCursorSchema.default({ kind: 'offset', offset: 0 }),
  /** 1-based, for the pager display; derived from `cursor.offset` when it is an offset cursor. */
  pageIndex: z.number().int().min(1).default(1),
  totalRows: z.number().int().nullable().default(null),
  totalExact: z.boolean().default(false),
  columnWidths: z.record(z.string(), z.number()).default({}),
  columnOrder: z.array(z.string()).default([]),
  scrollTop: z.number().default(0),
  scrollLeft: z.number().default(0),
});
export type DataTabState = z.infer<typeof dataTabStateSchema>;

export const tabRecordSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  path: z.string(),
  kind: z.literal('data'),          // P4 adds 'object', P5.5 adds 'console'
  state: dataTabStateSchema,
  order: z.number().int(),
  active: z.boolean(),
});
export type TabRecord = z.infer<typeof tabRecordSchema>;
```

Selection and the search-toolbar state are **not** in `DataTabState` — they are runtime-only and
never persisted (restoring a highlighted cell into a tab whose data has not loaded is meaningless).
They live in the renderer's tab state module as:

```ts
export type SelectionMode = 'cell' | 'row' | 'column';
export interface Selection {
  mode: SelectionMode;
  anchor: { row: number; col: number };
  focus: { row: number; col: number };
}
```

`Selection` is the P3 handshake: P3's cell editor reads `activeTab.selection.focus` plus
`pageView.cell(row, col)` and needs nothing else from P2.

### 3.5 `src/shared/saved-query.ts`

```ts
export const savedQueryKindSchema = z.enum(['filter']); // P5.5 adds 'console'
export const filterBodySchema = z.object({ where: z.string(), orderBy: z.string() });
export const savedQuerySchema = z.object({
  id: z.string(), connectionId: z.string(), path: z.string(),
  name: z.string(),                       // '' ⇒ history; non-empty ⇒ saved/pinned (D14)
  kind: savedQueryKindSchema,
  body: filterBodySchema,                 // stored as JSON text in `saved_queries.body`
  createdAt: z.string(), usedAt: z.string().nullable(),
});
export const HISTORY_LIMIT = 20;
```

### 3.6 `src/shared/settings.ts` — new sections

```ts
export const dataSettingsSchema = z.object({
  defaultPageSize: z.number().int().default(500),
  prefetchNextPage: z.boolean().default(true),
  countOnOpen: z.enum(['never', 'estimate', 'exact']).default('estimate'),
});
export const cacheSettingsSchema = z.object({
  l2BudgetMb: z.number().int().min(16).max(512).default(64),   // §7
  l3TtlSeconds: z.number().int().min(0).default(300),          // §7
});
```

Extend `settingsSchema`, `settingsPatchSchema` and `defaultSettings` in the same shape the
`appearance` section already uses. `countOnOpen: 'estimate'` as the default is what makes the pager
show a number the instant a tab opens without ever running an unbounded `count(*)`.

### 3.7 `Adapter` additions (`src/engine/adapters/adapter.ts`)

The P1 roadmap comment in this file is normative. Implement it *exactly* as written —

```ts
read(req: ReadRequest, ctx: OpCtx): Promise<Page>;
count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;
```

— with two additions that are not signature changes to those two methods:

- `quoteIdent(name: string): string` (D12), a pure function on the adapter.
- `cancel(opId)` keeps its signature; only its implementation changes (D11).

Update the roadmap comment in place: mark `read`/`count` as landed in P2, and leave the P3+ rows
(`update`, `insert`, `delete`, `ddl`, `explain`, …) exactly as they are. If any of this deviates
from the comment when you get there, change the plan, not the signature, and say so in the commit
message.

---

## 4. Implementation steps

Seventeen steps. Each is independently demonstrable — you can stop after any one of them and the
app still builds, typechecks and runs.

---

### Step 1 — Shared contracts and settings

**Files:** `src/shared/{page,data,tabs,saved-query}.ts` (new);
`src/shared/{port,ops,engine-ops,ipc,settings,tree}.ts` (modified).

Write §3 verbatim. Also in this step, because they are one-line changes that everything downstream
imports:

- `ops.ts`: `opKindSchema = z.enum([... , 'read', 'count'])` — exactly those two.
- `engine-ops.ts`: `opStartEventSchema` gains `tabId: z.string().nullable()`; `ENGINE_OP` gains
  `configure: 'engine:configure'` with payload `{ l2BudgetBytes: number; l3TtlSeconds: number }`.
- `tree.ts`: `nodeKindSchema` gains `'routine'` (D24).
- `ipc.ts`: add `tabsGetAll: 'kira:tabs:getAll'`, `tabsReplace: 'kira:tabs:replace'`,
  `savedQueriesList: 'kira:savedQueries:list'`, `savedQueriesUpsert: 'kira:savedQueries:upsert'`,
  `savedQueriesDelete: 'kira:savedQueries:delete'`, `savedQueriesTouch: 'kira:savedQueries:touch'`.

`cursorKey` gets a Bun test in `tests/db/read.spec.ts` (create the file here with just that
`describe`) asserting stability: the same cursor always produces the same string, and `off:0` and
`ks:next:x` never collide.

**Acceptance.** `bun run typecheck` clean. `bun run test:db` passes (the new file's cursor tests
run without Docker). No behavioural change in the app.

---

### Step 2 — The bulk port channel, and a transfer spike

**Files:** `src/engine/rpc.ts`, `src/renderer/bridge/port.ts`, `src/shared/port.ts`.

Three jobs.

*(a) Prove D3 before building on it.* Add a temporary `dev:echo` op to `rpc.ts` that returns
`{ buf: new Uint8Array(1_048_576) }` and a temporary renderer call that asserts
`res.buf.byteLength === 1_048_576` and `res.buf instanceof Uint8Array`. Electron serializes port
messages with the structured clone algorithm, so typed arrays survive as copies — but confirm it
against this Electron build rather than against the docs, because everything from Step 3 onward
assumes it. Delete `dev:echo` at the end of this step; keep the finding in the commit message.

*(b) Make `PortEvent` real.* `handleMessage` currently assumes every inbound frame is a
`PortResponse`. Branch on `data.kind`: `'res'` resolves the pending entry as today, `'evt'`
dispatches to subscribers registered via a new `subscribe(topic, handler): () => void`. Unknown
`kind` logs once and is dropped. On the engine side add
`emitPortEvent(topic: string, payload: unknown)` next to `dispatch`, guarding a missing port the
same way `src/engine/ops.ts`'s `emitEvent` guards `process.parentPort`, so `rpc.ts` stays
importable from plain Bun.

*(c) Typed wrappers.* In `bridge/port.ts` export
`readPage(req: ReadRequest): Promise<ReadResult>` and
`countRows(req: CountRequest): Promise<CountResult>`, which `await ready`, call `request`, and run
`assertTabularPage` on the delivered page. Raise the read timeout: 30 s is right for control ops
and wrong for a `count(*)` on a 200 M-row table — give `data:read`/`data:count` a **120 s** timeout
and note that the real bound is the user's stop button, not the timeout.

**Acceptance.** Temporary spike shows the 1 MB round trip in the renderer console with the correct
`byteLength`; after removing it, `bun run test:ui` still passes with zero console errors.

---

### Step 3 — The columnar encoder

**Files:** `src/engine/page/encode.ts` (new); `tests/db/read.spec.ts` (extended).

This is the piece that makes the second adapter cheap: it knows nothing about any driver.

```ts
export interface EncodeColumnSpec { name: string; dataType: string; encoding: ColumnEncoding }

export interface EncodeInput {
  columns: EncodeColumnSpec[];
  /** Rows as arrays, in `columns` order. Values are driver-native: string | number | bigint |
   *  Uint8Array | null | boolean. */
  rows: readonly unknown[][];
}

export function encodeTabular(input: EncodeInput): Pick<TabularPage,
  'columns' | 'rowCount' | 'bytes' | 'truncatedCells'>;
```

Algorithm, per column:

- Allocate `flags = new Uint8Array(rowCount)`.
- `f64`: `Float64Array(rowCount)`; `null → flags|=CELL_NULL, value 0`; strings via `Number(v)`;
  `NaN` from a non-null value is a bug — it means the encoding choice was wrong for the type, so
  fall back to `utf8` for that column rather than silently writing `NaN` (assert in dev).
- `i64`: `BigInt64Array`; `BigInt(v)`; out-of-range throws → fall back to `utf8`.
- `bool`: `Uint8Array` of 0/1; accept `true/false`, `'t'/'f'`, `'1'/'0'`, `1/0`.
- `utf8`: two passes. Pass 1 encodes each cell with a single shared `TextEncoder` into a growable
  chunk list, clamping at `MAX_CELL_BYTES` on a **code-point boundary** (`TextEncoder.encodeInto`
  into a 64 KiB scratch buffer gives you `written` and `read`; use `read` to know you cut cleanly)
  and setting `CELL_TRUNCATED`. Pass 2 concatenates into one `Uint8Array` and fills
  `Int32Array(rowCount + 1)`. Non-string, non-null values are stringified: `Uint8Array`/`Buffer`
  never reach `utf8` (they are `bytes`), `bigint` via `toString()`, objects via `JSON.stringify`
  (only reachable if an adapter fails to set raw parsers — log once).
- `bytes`: same offsets structure, no encoding, same 64 KiB clamp.
- `bytes` sum: `flags.byteLength + (values?.byteLength ?? 0) + (data?.byteLength ?? 0) +
  (offsets?.byteLength ?? 0)`, summed across columns. This is the number L2 budgets on; it must be
  exact, not estimated.

A single `Int32Array` offset index caps one column's payload at 2 GiB per page, which the 64 KiB
cell clamp and the 20 000 row cap make unreachable (20 000 × 64 KiB = 1.28 GiB — close enough to
matter, so throw `E_QUERY` with "page too large, reduce page size" if a column's payload would
exceed `2**31 - 1` rather than silently wrapping).

**Acceptance.** Bun tests, no Docker: round-trip every encoding including nulls; a 100 KB string
truncates to exactly `MAX_CELL_BYTES` with `CELL_TRUNCATED` set and no broken surrogate at the cut;
a 4-byte emoji straddling the boundary is dropped whole, not halved; `bytes` equals the sum of the
actual `byteLength`s; an all-null `f64` column produces a `Float64Array` and no `NaN`s in `values`.

---

### Step 4 — `tabId` end-to-end on the op stream

**Files:** `src/engine/ops.ts`, `src/engine/control.ts`, `src/main/index.ts`,
`src/renderer/workbench/state/ops.ts`.

`runOp`'s spec becomes `{ connectionId: string | null; kind: OpKind; tabId?: string | null }` and
puts `tabId ?? null` on the `op:start` event. In `main/index.ts` replace both hardcoded
`tabId: null` occurrences: `op:start` uses `start.tabId`, and the in-flight map carries it forward
so the `op:end` record has it too. In the renderer's ops state, maintain
`runningByTab: Map<string, Set<string>>` derived from the `kira:op:update` push — add on
`status === 'running'`, remove on any terminal status — and expose
`runningOpId(tabId): string | null` (most recent). This is D9's entire implementation.

**Acceptance.** `bun run test:ui` — existing ops-panel spec still passes; add an assertion that a
`connect` op logs with `tabId === null` (no tab exists yet), proving the column is nullable
end-to-end rather than accidentally `''`.

---

### Step 5 — Lease pool, `quoteIdent`, and the SQL builder

**Files:** `src/engine/lease.ts` (new), `src/engine/page/sql.ts` (new),
`src/engine/adapters/postgres/client.ts`, `src/engine/adapters/adapter.ts`.

*Lease pool.* Generic and driver-free:

```ts
export interface Lease<T> { value: T; id: string; release(): void }
export class LeasePool<T> {
  constructor(opts: { max: number; open: () => Promise<T>; close: (v: T) => Promise<void> });
  acquire(signal?: AbortSignal): Promise<Lease<T>>;
  closeAll(): Promise<void>;
}
```

FIFO waiters; `acquire` rejects with `E_CANCELLED` if the signal fires while queued (D11's "dropped
locally" case). `ClientSet` grows `lease(database: string | null): Promise<Lease<Client>>`, keeping
its 8-database LRU but holding a `LeasePool<Client>` of max 3 per database instead of a single
`Client`. `get()` stays for P1's catalog callers — implement it as `lease()` + immediate release
where it is safe (catalog queries are short and serialized), or better, migrate the four catalog
call sites to leases in this step so there is exactly one path. Backend pid comes from
`(client as unknown as { processID?: number }).processID` — pg sets it on connect; if it is
missing, the adapter records `null` and `cancel` degrades to the local abort only. Do not guess:
confirm against `@types/pg`.

*`quoteIdent`.* Postgres: `'"' + name.replaceAll('"', '""') + '"'`; MariaDB (Step 14):
`'`' + name.replaceAll('`', '``') + '`'`. Both throw `E_QUERY` on `\0`. Put a shared
`assertIdentifier(name)` in `page/sql.ts`.

*SQL builder.* `page/sql.ts` builds text but takes the quoting function as a parameter, so both
adapters share it:

```ts
export interface SelectSpec {
  quote: (s: string) => string;
  table: string[];          // already-unquoted name parts, e.g. ['app', 'orders'] or ['shopdb','orders']
  columns: string[] | null; // projection (D18); null ⇒ '*'
  where: string;            // free text (D13)
  orderBy: string;          // free text, or generated PK order
  keyset: { columns: string[]; direction: 'asc' | 'desc'; values: unknown[] } | null;
  limit: number;
  offset: number | null;
}
export function buildSelect(spec: SelectSpec): { text: string; params: unknown[] };
export function buildCount(spec: Pick<SelectSpec, 'quote' | 'table' | 'where'>): { text: string; params: [] };
```

Assembly rules, in order: `SELECT` list (`*` or quoted projection) · `FROM` quoted parts joined by
`.` · `WHERE` — the free text wrapped in parentheses, `AND`-ed with the keyset row comparison
`(c1, c2) > ($1, $2)` (`<` for `desc`/`prev`) when present · `ORDER BY` — free text verbatim if
non-empty, else the generated PK order · `LIMIT n + 1` (the extra row is how `nextToken` is decided;
drop it before encoding) · `OFFSET` only for offset cursors. Keyset values are **parameters**, never
interpolated — they come from a previous page's row data, which is the one place user-influenced
data enters the SQL, and it goes through the driver's parameter path.

Placeholders differ (`$1` vs `?`), so `buildSelect` takes a `placeholder: (i: number) => string`
too. That is the last dialect difference in this file.

**Acceptance.** Pure Bun tests: `buildSelect` output for (no filter, no sort), (projection + free
WHERE), (keyset next), (keyset prev, direction flipped), (offset 4 500); the seed's
`app."weird""name"` and `app."Order Items"` quote correctly; an identifier containing `\0` throws.

---

### Step 6 — Postgres `read`

**Files:** `src/engine/adapters/postgres/{read,query,index}.ts`; `tests/db/read.spec.ts`.

*Type parsers (D4).* Read queries only:

```ts
const RAW = { getTypeParser: () => (v: string) => v };
await client.query({ text, values, rowMode: 'array', types: RAW });
```

`rowMode: 'array'` is what feeds `encodeTabular` without ever building a row object. Catalog
queries in `catalog.ts` keep pg's default parsers — do not touch them.

*OID → encoding.* One table in `read.ts`: `16 → bool`, `17 → bytes`, `20 → i64`,
`21|23|26 → f64`, `700|701 → f64`, everything else `utf8`. With `RAW` parsers `bytea` arrives as a
`\x…` hex string, so the `bytes` path hex-decodes (skip the leading `\x`; if the server is in
`bytea_output = escape` mode the string will not start with `\x` — detect and fall back to `utf8`
rather than producing garbage). The column's `dataType` comes from `result.fields[i].dataTypeID`
resolved against a small OID→name map plus `format_type` for anything unknown; simplest correct
approach is to ask the catalog once per table via `describe`'s cached column metadata and fall back
to `oid:<n>`.

*Cursor handling.* Keyset eligibility (D6): `req.orderBy` is empty **and** the table has a primary
key (from L1 metadata via `describe`) ⇒ keyset with the PK columns ascending. `req.orderBy` is a
plain `<pkcol> asc|desc` list matching the PK exactly ⇒ keyset with that direction. Everything else
⇒ offset. On the keyset path, `nextToken`/`prevToken` are `JSON.stringify` of the PK values of the
last/first returned row, base64url-encoded; decoding validates arity against the current PK and
falls back to offset 0 on mismatch (schema changed under us).

*The op.* `read` runs inside `runOp({connectionId, kind: 'read', tabId})`, calls
`ctx.setCommand(text)` **before** executing (so a hung query is visible in the ops panel with its
SQL), `ctx.setRows(page.rowCount)` after, leases a client per D11, and registers
`{opId → {leaseId, pid}}` so `cancel` can target it. Abort handling reuses `query.ts`'s existing
race-with-`settled`-guard pattern; do not invent a second one.

**Acceptance.** `bun run test:db` against the Postgres container:
`app.wide_table` reads 100 rows with every column's encoding as the OID table predicts;
`nulls_and_unicode` round-trips 4-byte emoji and NULLs distinctly from empty strings;
`composite_pk` pages by keyset with correct ordering across the page boundary (concatenate pages 1
and 2 and assert strict monotonic PK, no gaps, no duplicates); `big_rows` at offset 9 500 returns
the right slice; `numeric` values come back as their exact text.

---

### Step 7 — Postgres `count`, and the caches

**Files:** `src/engine/adapters/postgres/index.ts`, `src/engine/cache.ts` (new),
`src/engine/{rpc,control}.ts`.

*`count`.* `mode: 'exact'` → `buildCount` → `{value, exact: true}`. `mode: 'estimate'` with an
empty `where` → `SELECT reltuples::bigint FROM pg_class WHERE oid = $1::regclass` →
`{value, exact: false}`; a negative `reltuples` (never analyzed) returns `{value: 0, exact: false}`
and the UI shows `?`. `mode: 'estimate'` with a non-empty `where` → throw at the *call site*, not
the adapter: the renderer must not ask (D8).

*Cache module.* One file, two maps, no dependencies on any adapter:

```ts
export interface CacheConfig { l2BudgetBytes: number; l3TtlMs: number }
export function l2Key(req: ReadRequest): string;   // §7: connectionId|path|where|projection|orderBy|pageSize|cursorKey
export function l3Key(req: CountRequest): string;  // §7: connectionId|path|where
export function l2Get(key: string): TabularPage | undefined;
export function l2Put(key: string, page: TabularPage): void;   // evicts LRU until bytes ≤ budget
export function l3Get(key: string): { value: number; exact: boolean; at: number } | undefined;
export function l3Put(key: string, v: { value: number; exact: boolean }): void;
export function dropConnection(connectionId: string): void;
export function dropPath(connectionId: string, path: string): void;  // prefix match, both tiers
export function clearAll(): void;
export function stats(): CacheStats;
export function configure(cfg: Partial<CacheConfig>): void;
```

L2 is a `Map` (insertion-ordered = LRU when you `delete`+`set` on hit) accumulating
`page.bytes`; eviction pops from the front until the running total fits. A single page larger than
the whole budget is **not** cached (and does not evict everything) — log it once and return it
uncached. `refresh: true` deletes the key before the lookup. L3 entries carry `at`; `l3Get` returns
`undefined` past the TTL and deletes.

*Wiring.* `control.ts` handles `ENGINE_OP.configure` by calling `cache.configure`, calls
`dropConnection` in the disconnect path, and calls `dropPath` when a `describe`/`children` runs
with refresh. `rpc.ts`'s `data:read`/`data:count` handlers consult the cache before dispatching to
the adapter, set `fromCache`, and emit the throttled `cache:stats` event (D25) after every
read/count.

**Acceptance.** `bun run test:db`: the same read twice produces one op in the engine's op stream
and `fromCache: true` the second time; a `refresh: true` read produces a second op; setting the
budget to 1 MB and reading three 600 KB pages leaves exactly the two most recent in `stats()`;
`dropConnection` zeroes `l2Bytes`; an L3 hit after the TTL is a miss.

---

### Step 8 — Tabs: storage, state, strip, and the tree entry points

**Files:** `src/main/storage/tabs.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
`src/renderer/bridge/control.ts`, `src/renderer/workbench/state/tabs.ts`,
`src/renderer/workbench/panels/TabStrip.vue`, `src/renderer/project/menus.ts`,
`src/renderer/project/{TreeRow.vue,icons.ts}`.

*Storage.* Drizzle over the existing `tabs` table. `getAllTabs(db)` orders by `order` and
Zod-parses `state_json`, **dropping** (and logging) any row that fails rather than throwing —
a corrupt tab must not brick startup. `replaceTabs(db, tabs)` is a single transaction:
`delete(tabs)` then insert all. The set is ≤ a few dozen rows; a diff would be more code and more
bugs than a replace, and it matches how P1 persists connection filters.

*Renderer state.* `state/tabs.ts` owns `tabs: Ref<Tab[]>` and `activeId: Ref<string|null>` where
`Tab = TabRecord & { runtime: {...} }`. Runtime (non-persisted) fields:
`status: 'idle'|'loading'|'ready'|'error'|'restored'`, `pageView: PageView|null`,
`error: AdapterError|null`, `selection: Selection`, `search: {...}`, `elapsedMs`, `rowsLoaded`.
Actions: `openData(connectionId, path, {newTab})` (D16), `close(id)`, `closeOthers(id)`,
`closeToRight(id)`, `duplicate(id)`, `activate(id)`, `move(id, index)`, plus the data actions added
in Steps 10–13. Every mutation of persisted state schedules a 250 ms debounced `tabsReplace`.
**`pageView` must never be `ref`/`reactive`** — hold it in a plain field on a `markRaw`'d object,
or better, keep pages in a separate non-reactive `Map<tabId, PageView>` next to the store and let
the store hold only a `pageVersion: number` (D22). Prefer the second: it makes the mistake
impossible rather than merely discouraged.

*Tab strip.* Horizontal, `32px`, one button per tab: a 3 px left border in the connection's colour
(the P1 colour that `Toolbar`/`TabStrip` were always meant to carry), an icon from the node kind,
the table name, a `×` on hover, middle-click to close, drag to reorder, and the D29 context menu.
Overflow scrolls horizontally with the active tab kept in view (`scrollIntoView({block:'nearest'})`
on activation) — no dropdown, no shrinking-to-nothing.

*Tree entry points.* `menus.ts` `treeRowMenu` gains, for `table|view|matview` (and MariaDB's
`table|view` after Step 14): **Open data** (⏎), **Open data in new tab**, a separator, **Count
rows** (runs an exact count for that path and shows it in the status bar without opening a tab),
and **Saved filters ▸** listing that path's named `saved_queries` entries, each opening a new tab
with that filter applied. Double-click on those node kinds = Open data; ⌘-double-click = new tab.

**Acceptance.** `bun run test:ui`: right-click a table → Open data → a tab appears with the table's
name and the connection's colour; open the same table twice with "Open data in new tab" → two tabs,
both present; close the middle of three tabs → the right neighbour activates; relaunch the app
(the fixture's second-launch helper) → the same tabs are present in the same order with the same
active tab. No grid yet — the body is still `EmptyState`.

---

### Step 9 — `PageView` and the virtualized grid

**Files:** `src/renderer/workbench/state/page.ts`, `src/renderer/workbench/DataGrid.vue`,
`src/renderer/workbench/panels/MainView.vue`.

*`PageView`* wraps a `TabularPage` and is the only thing that touches its buffers:

```ts
export class PageView {
  constructor(page: TabularPage, columnOrder: string[], widths: Record<string, number>);
  readonly rowCount: number;
  readonly columns: readonly GridColumn[];   // display order, with {left, width, align}
  readonly totalWidth: number;
  isNull(row: number, col: number): boolean;
  isTruncated(row: number, col: number): boolean;
  /** Decoded on demand from the buffers; no memoization (see below). */
  text(row: number, col: number): string;
  raw(row: number, col: number): number | bigint | string | Uint8Array | null;  // P3's hook
  setWidth(name: string, px: number): void;
  autoFit(name: string, sampleRows: number): number;
}
```

No decode cache. A visible viewport is ≈50 rows × ≈14 columns = 700 cells; `TextDecoder.decode`
over a 20-byte subarray is ~0.2 µs, so a full repaint costs ~0.15 ms of decoding against an 8 ms
budget. A cache would add invalidation surface for a rounding error. Say this in a comment so the
next person does not "optimize" it.

*Grid architecture.* One scroll container, `position: relative`, containing:

1. a sizing spacer `width = totalWidth + gutterWidth`, `height = rowCount * rowHeight`;
2. a sticky header row (`position: sticky; top: 0`) rendering only visible columns;
3. a sticky row-number gutter (`position: sticky; left: 0`) rendering only visible rows;
4. the cell layer, one `<div class="row">` per visible row, `transform: translateY(...)`, each
   containing only the visible columns as absolutely positioned cells.

The reactive state is exactly four numbers plus a version:

```ts
const version = ref(0);                                   // bumped when the page swaps
const vp = reactive({ top: 0, left: 0, w: 0, h: 0 });      // scroll + ResizeObserver
const win = computed(() => { void version.value; /* → {r0, r1, c0, c1} */ });
const rows = computed(() => range(win.value.r0, win.value.r1));   // array of indices
```

Cell content comes from `view.text(r, c)` — a plain function call on a non-reactive object, so Vue
tracks *indices*, never data. Scroll events are `passive` and write to a plain variable; a
`requestAnimationFrame` loop copies it into `vp` at most once per frame, which is what keeps a
120 Hz trackpad fling from queueing 200 re-renders. Overscan: 6 rows, 2 columns. Row height comes
from the existing `--kira-row-height` token (compact 22 / comfortable 28) — read it once via
`getComputedStyle` on mount and on the settings change, never per frame.

Rendering rules from §8.5: NULL renders as a muted italic `[NULL]` (never an empty string, which is
a real, different value); numeric encodings and `numeric`/`DECIMAL` types right-align; `bool`
centres; truncated cells get a trailing `…` and a `title`. Column resize is a 5 px hit area on the
header's right edge (pointer capture, live width update via `view.setWidth` + version bump);
double-click auto-fits (D28). Column reorder is header drag → `columnOrder` in tab state.

`MainView.vue` becomes the tab-body switch: `restored` → `ReconnectPrompt.vue`, `error` → the
error state with the server's message and a Retry, `loading` with no page → a centred spinner,
`ready` → `DataGrid`, no tabs → the existing `EmptyState`.

**Acceptance.** `bun run test:ui` with a seeded 10 000-row table:
`document.querySelectorAll('[data-testid="grid-cell"]').length < 1200` at every scroll position
(proves windowing); scrolling to the bottom shows the last row's real values; a Vue devtools-free
proof of D22 — assert `isReactive` is false for the object returned by the page store's
`getPage(tabId)` (expose it on `window.__kira` in test builds only, the way P1's harness exposes
its API); a scripted fling (50 successive `wheel` events) records no frame over 8 ms via
`performance.measure` around the rAF handler, asserted as a p95 to avoid GC flake.

---

### Step 10 — The data-view toolbar: pager, page size, refresh, count, stop

**Files:** `src/renderer/workbench/panels/Toolbar.vue`, `src/renderer/workbench/state/tabs.ts`.

Left to right, per §8.5: `⏮ ◀ page N of M ▶ ⏭` · page-size select (D20) · **Refresh** · **Count
all** · **Stop** · `columns ▾` · a right-aligned status reading `N rows · 24 ms` (and
`· cached` on an L2 hit). The whole bar is tinted with the connection colour (a 2 px top border,
matching the tab strip).

Behaviour:

- `▶`/`◀` use `nextToken`/`prevToken` when the last page provided them, else
  `offset ± pageSize`. `⏮` = `{kind:'offset', offset:0}`. `⏭` is disabled until `totalRows` is
  known, then jumps to `offset = (ceil(total/pageSize) - 1) * pageSize` (D7). `page N` is an
  editable number input on click; Enter jumps by offset.
- Page-size change re-reads from offset 0 (any other choice makes "page N" meaningless).
- Refresh sets `refresh: true` on both the read and the count (D26).
- Count all issues `mode: 'exact'`; the result sets `totalRows`/`totalExact` and the pager gains
  its "of M". On tab open, `settings.data.countOnOpen` decides whether an `estimate` fires
  automatically.
- Stop is enabled iff `opsState.runningOpId(tabId) !== null` (D9) and calls the existing
  `kira:ops:cancel`. A cancelled read leaves the previous page on screen and shows "Cancelled" in
  the status area — it does not blank the grid.
- After 150 ms of an in-flight read, an inline indeterminate progress bar appears under the toolbar
  (§2.1). Implement it as a single `setTimeout(150)` armed at dispatch and cleared on settle, not a
  ticking timer.
- `columns ▾` is a checkbox list of the table's columns (from L1 metadata) with All/None; applying
  sets `projection` and re-reads from offset 0 (D18).

**Acceptance.** `bun run test:ui`: paging forward 3 pages then back 3 lands on the identical first
row; page-size 100 → the grid shows 100 rows and `page 1`; Count all fills "of M" matching the
seed's known row count; Stop on a `pg_sleep`-backed slow read (inject via a filter of
`id > 0 AND pg_sleep(3) IS NULL`) flips the op to `cancelled` in the ops panel within ~200 ms.

---

### Step 11 — Sort and projection through the header

**Files:** `DataGrid.vue`, `state/tabs.ts`, `menus.ts`-style header menu in `DataGrid.vue`.

Clicking a header cycles `asc → desc → none` and **rewrites `state.orderBy`** to
`"col" ASC` / `"col" DESC` / `''` (D17), then re-reads from offset 0. Shift-click appends a second
term. The arrow indicator is rendered from `parseOrderBy(text)`, a deliberately small parser:
split on `,`, each term must match `^\s*("[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s*(asc|desc)?\s*$`
case-insensitively and resolve to a known column name; any failure ⇒ `null` ⇒ no arrows anywhere.
The header context menu (D29) is Sort ascending / Sort descending / Clear sort / — / Hide column /
Show all columns / Copy column name.

**Acceptance.** `bun run test:ui`: click a header → rows reorder and the `ORDER BY` box shows
`"name" ASC`; type `"name" desc` into the box by hand → the header arrow flips to descending; type
`name desc nulls last` → data reorders and no arrow is shown (parser bailed, server accepted);
hide two columns → the SQL in the ops panel's command column no longer mentions them.

---

### Step 12 — The filter toolbar, history and saved filters

**Files:** `src/renderer/workbench/FilterToolbar.vue`,
`src/main/storage/saved-queries.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
`src/renderer/bridge/control.ts`.

*Storage (D14).* `listSavedQueries(db, {connectionId, path, kind})` returns named entries first
(by `name`), then unnamed by `usedAt desc`. `upsertSavedQuery` writes the JSON body.
`touchSavedQuery(id)` sets `usedAt = now`. `pruneHistory(db, connectionId, path)` deletes unnamed
rows beyond the newest `HISTORY_LIMIT`, called after every successful apply.

*Toolbar.* One row below the data-view toolbar, hidden by default, toggled by a funnel button and
`⌘⇧F`: `history ▾` · `WHERE [____]` · `ORDER BY [____]` · `Apply` · `Clear` · `Save…`. Both inputs
are single-line, monospace, and submit on Enter. Apply writes `where`/`orderBy` into tab state,
re-reads from offset 0, invalidates `totalRows` (the count is for the old predicate), and records an
unnamed history entry. `Save…` prompts for a name and writes a named entry. The `history ▾` dropdown
lists saved entries (pin icon) above history entries, each showing a one-line preview; picking one
fills both inputs and applies. Right-click an entry → Rename / Delete.

*Errors.* A server error from an applied filter renders **in the toolbar, under the offending
input**, with the server's message verbatim and no attempt to re-word it (D13), and the grid keeps
showing the last good page.

**Acceptance.** `bun run test:ui`: apply `id > 500` → row count drops and the ops-panel command
contains `WHERE (id > 500)`; apply `id >` (invalid) → the Postgres syntax-error message appears
verbatim under the WHERE input and the previous rows are still on screen; save it as "big ids",
reopen the table in a new tab, pick it from `history ▾` → the filter is applied; 25 successive
distinct filters leave exactly 20 unnamed rows plus the named one in `saved_queries`.

---

### Step 13 — The search toolbar (page-local) and prefetch

**Files:** `src/renderer/workbench/SearchToolbar.vue`, `state/page.ts`, `state/tabs.ts`.

*Search (D19).* ⌘F opens a VS Code-style bar anchored top-right **over the grid**: query · match
case · whole word · regex · `3 of 47` · ↑ ↓ · ×. Matching runs over `view.text(r, c)` in 2 000-row
slices scheduled on `requestAnimationFrame`, updating the count as it goes and abandoning the run
when the query changes. Matches are `{row, col}` in row-major order; ↑/↓ move the selection and
scroll the match into view; matched cells get a highlight class, the active match a stronger one.
The bar states plainly, in placeholder text, "Searches the loaded page" — the one-line UI
acknowledgement that this is not the filter.

*Prefetch (D21).* After a successful non-prefetch read renders, if `settings.data.prefetchNextPage`
and a next cursor exists, schedule `requestIdleCallback(cb, {timeout: 500})`. The callback issues
the read with `prefetch: true`. Any of {new read dispatched, filter/sort/projection/page-size
change, tab close, tab switch} cancels the pending callback with `cancelIdleCallback` before it
fires; if it has already been sent, let it complete (it only fills a cache) — do not fire a cancel
op for it, which would pollute the op log with cancellations the user did not ask for.

**Acceptance.** `bun run test:ui`: ⌘F, type a value present in 3 cells → `1 of 3`, ↓ steps through
them and scrolls; regex mode with an invalid pattern shows an inline "invalid regex" and does not
throw; with prefetch on, page-forward after a 600 ms idle returns `fromCache: true` (assert via the
toolbar's `· cached` marker) and the ops panel shows the prefetch's `read` op having completed
*before* the user pressed `▶`.

---

### Step 14 — MariaDB adapter: connect, tree, describe

**Files:** `src/engine/adapters/mariadb/{caps,client,query,catalog,index}.ts`,
`src/engine/adapters/registry.ts`, `src/shared/uri.ts`,
`src/renderer/project/ConnectionDialog.vue`, `src/renderer/project/icons.ts`,
`package.json`.

`bun add mariadb` (into `dependencies`, D27; no `@types/*`, D27). Settle every driver API against
`node_modules/mariadb/types/index.d.ts` before writing it — `threadId`, `rowsAsArray`, `metaAsArray`
and the `typeCast` callback shape in particular. Do not guess; P1's postgres adapter was written the
same way.

*`caps.ts`* copies the mariadb row already filled in at `src/shared/caps.ts` — do not invent new
values, and do not "improve" the shared table.

*`client.ts`* (D23): one `LeasePool<Connection>` of max 3 against the configured host, created with
`multipleStatements: false` (D13), `rowsAsArray: true`, `connectTimeout: 10_000`,
`trace: false`, and no `database` pinning — every statement uses qualified names. URI mode passes
the connection string; fields mode builds an options object. `killQuery(config, threadId)` opens a
fresh connection, runs `KILL QUERY ?`, and closes it.

*`catalog.ts`*, one SQL const + one function per level, every value parameter-bound:

- **databases** — `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN
  ('information_schema','performance_schema','mysql','sys') ORDER BY SCHEMA_NAME`.
- **objects in a database** — `information_schema.TABLES` (`TABLE_TYPE` → `table`/`view`) union
  `information_schema.ROUTINES` (`ROUTINE_TYPE` → `routine`, D24), both filtered by `?`.
- **columns** — `information_schema.COLUMNS` ordered by `ORDINAL_POSITION`, projecting
  `COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA` into P1's
  `columnMetaSchema`.
- **indexes** — `information_schema.STATISTICS` grouped by `INDEX_NAME`, `NON_UNIQUE` → `unique`,
  `INDEX_NAME = 'PRIMARY'` → `primary`.
- **foreign keys** — `information_schema.KEY_COLUMN_USAGE` joined to `REFERENTIAL_CONSTRAINTS`, for
  `objectMetaSchema.foreignKeys`.

*`index.ts`* — `children(path)` and `describe(path)` switch on segment count: 0 ⇒ databases,
1 ⇒ objects, 2 ⇒ columns. Two segments to a table where Postgres needs three; nothing above the
adapter may care, and if something does, that is the bug this phase exists to find.
`connect` runs `SELECT VERSION()` and reports `{ version, details: { charset } }`.
Error mapping in `query.ts`: `errno 1045`/`ER_ACCESS_DENIED_ERROR` → `E_AUTH`;
`1317`/`ER_QUERY_INTERRUPTED` → `E_CANCELLED`; `ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ER_GET_CONNECTION_TIMEOUT`
→ `E_CONNECT`; everything else `E_QUERY` with the server's message verbatim.

*Renderer.* `ConnectionDialog.vue`: `{ value: 'mariadb', supported: true }`, default port 3306 when
the kind changes to mariadb (and 5432 back for postgres). `uri.ts` `canRoundTripToFields` accepts
`kind === 'mariadb'` with scheme `mariadb` or `mysql`; `formatConnectionUri` emits the connection's
own kind as the scheme, which it already does. `icons.ts` maps `routine` (codicon
`symbol-method`).

**Acceptance.** `bun run test:db` with a `mariadb:11` Testcontainer: connect, list databases
(system schemas absent), list tables + views + routines in the seed database, describe a table's
columns/indexes/FKs; `bun run test:ui` — create a MariaDB connection through the dialog, expand to
a table, and confirm the tree renders with two levels above the table rather than three.

---

### Step 15 — MariaDB `read` and `count`

**Files:** `src/engine/adapters/mariadb/{read,index}.ts`.

`typeCast` returns `column.string()` for everything except binary/BLOB columns, which return
`column.buffer()` — the MariaDB analogue of D4's raw parsers. Field type → encoding, resolved
against the connector's exported type enum (read it, do not hardcode the numbers): `TINY`(with
`length===1`)/`BIT(1)` → `bool`; `TINY|SHORT|INT24|LONG|FLOAT|DOUBLE` → `f64`; `LONGLONG` → `i64`;
`TINY_BLOB|BLOB|MEDIUM_BLOB|LONG_BLOB` **with the binary collation** → `bytes` (the same type ids
carry `TEXT` with a non-binary collation → `utf8`); `NEWDECIMAL` → `utf8` (D4); everything else
`utf8`. `dataType` is `column.columnType`'s name plus the `COLUMN_TYPE` string from L1 metadata when
available.

`read` reuses `page/sql.ts` with `quoteIdent` = backticks and `placeholder = () => '?'`; the table
parts are `[database, table]`. Keyset eligibility is identical to Postgres's (D6) — MariaDB
supports row-constructor comparison, so the generated predicate is unchanged. `count` exact is
`SELECT COUNT(*)`; estimate is `SELECT TABLE_ROWS FROM information_schema.TABLES WHERE
TABLE_SCHEMA = ? AND TABLE_NAME = ?` with `exact: false` (InnoDB's `TABLE_ROWS` is a sampled
estimate, which is exactly what `exact: false` means).

`cancel(opId)` looks up the op's lease, reads its `threadId`, and issues `KILL QUERY` on a side
connection (D23) — gated, as in P1, on `caps.cancel`.

**Acceptance.** `bun run test:db`: read every column type in the MariaDB seed with the expected
encodings; keyset paging across a page boundary is monotonic and gap-free; `SELECT SLEEP(30)`
issued as a filtered read is cancelled within ~200 ms and disappears from
`information_schema.PROCESSLIST`; a `COUNT(*)` matches the seed's known row count and the estimate
returns `exact: false`.

---

### Step 16 — Settings, status bar, and cache observability

**Files:** `src/renderer/workbench/SettingsDialog.vue`,
`src/renderer/workbench/StatusBar.vue`, `src/renderer/workbench/state/cache.ts`,
`src/main/ipc.ts`.

Settings → **Data**: default page size (D20's four options), prefetch next page, count on open
(never/estimate/exact) — all bound to the real schema, all `disabled` attributes removed and the
"Available once data views land." text deleted. Settings → **Cache**: L2 budget slider
(16–512 MB), live "Result cache: 41.2 MB of 64 MB · 87 % hit rate" from the `cache:stats` event,
and a working **Clear caches** button (`cache:clear` port request, which also drops L1 via the
existing metadata-cache IPC — §7 says the button clears the caches, plural).

Main pushes `ENGINE_OP.configure` to the engine at startup and on every settings change that
touches `cache` (one small handler in `main/ipc.ts`'s settings service).

Status bar gains a compact cache readout (`◱ 41 MB`) with a tooltip breaking out entries and hit
rate, sitting left of the panel toggles.

**Acceptance.** `bun run test:ui`: change the L2 budget to 16 MB → the status bar's figure never
exceeds it after loading several large pages; Clear caches → the figure drops to 0 and the next
page read reports `fromCache: false`; toggling prefetch off means no speculative `read` op appears
in the ops panel after a page renders.

---

### Step 17 — Selection, keyboard navigation, and the P3 seam

**Files:** `DataGrid.vue`, `state/tabs.ts`.

Selection (§3.4) with three modes: click a cell → `cell`; click the row gutter → `row`; click a
header → `column` (in addition to the sort click — use the header's *label* area for sort and the
whole header for column selection only when ⌘ is held, to avoid a two-purpose click). Shift-click
extends from the anchor; ⌘/Ctrl-click is **not** implemented (multi-range selection is P6's
problem, and a half-built one is worse than none). Keyboard: arrows move the focus cell, ⇧+arrows
extend, Home/End go to the first/last column, ⌘↑/⌘↓ to the first/last row of the loaded page,
PageUp/PageDown scroll by a viewport, Tab/⇧Tab move horizontally with wrap. Every movement scrolls
the focus into view and stays inside the loaded page (crossing a page boundary with the keyboard is
P6).

Selection is O(1) reactive state — two `{row, col}` pairs — so it may live in the reactive store
without violating D22. Highlighting is a class computed per visible cell from those four numbers.

The seam for P3, stated so it does not have to be rediscovered: `activeTab.selection.focus` plus
`getPage(tabId).raw(row, col)` and `.isTruncated(row, col)` are everything the cell editor needs;
`CellEditorPanel.vue` stays a stub in this phase and P3 changes exactly that one file plus the
adapter's `update`.

**Acceptance.** `bun run test:ui`: click a cell → it is outlined and `[data-testid="grid-cell"]`
carries `data-selected`; arrow keys move the outline and auto-scroll at the viewport edge;
shift-arrow extends a rectangle whose size matches the key count; clicking the gutter selects a
full row. Verify a P3-shaped read: `window.__kira.activeCell()` (test-build-only helper) returns
the same string the DOM shows.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation / trigger |
| --- | --- | --- | --- | --- |
| R1 | Electron's port serializer does not preserve typed arrays as expected, or copies them via JSON | Low | Blocks D2 wholesale | Step 2(a) is a spike specifically to find this on day one. If typed arrays do not survive, fall back to one `ArrayBuffer` per page plus a JSON header describing column offsets — the encoder already produces exactly that layout, so the blast radius is `encode.ts`'s return shape and `assertTabularPage`. |
| R2 | 8 ms frame budget missed under real data (many wide `utf8` columns) | Medium | §2.1 violation, the phase's headline claim | Measure in Step 9's acceptance, not at the end. Escape hatches in order: raise overscan and reduce per-cell DOM (single text node, no nested spans); cache decoded text for the visible window only; last resort, render the cell layer to a canvas — do not start there. |
| R3 | Keyset paging returns wrong rows when the PK is composite or contains NULLs | Medium | Silent data corruption in the user's mental model — the worst class of bug here | Row-constructor comparison is exact for composite PKs; NULLs in a PK are impossible by definition. The real risk is the *token* going stale across a schema change: decode validates arity and column names against the current PK and falls back to offset 0. Step 6's acceptance tests `composite_pk` explicitly. |
| R4 | `pg_cancel_backend`/`KILL QUERY` cancels the wrong statement | Medium (was certain before D11) | Data-integrity-adjacent; worse once P3 lands writes | D11's exclusive leases. Add an assertion in the cancel path that the recorded lease is still held by that opId; if not, skip the server cancel and only abort locally. |
| R5 | A 1 MB-per-cell table blows memory before truncation applies | Low | Engine OOM at 512 MB | D5 truncates during encoding, before any full page exists in memory — but the *driver* materializes full values first. Cap `pageSize` at 5 000 in the UI and let the 20 000 schema max exist only for programmatic use; if the engine OOMs on the §9.1 fixture, add a `SUBSTRING`/`LEFT` projection push-down for known-large types, which is a `page/sql.ts`-only change. |
| R6 | L2 byte accounting drifts from real RSS (JS object overhead, fragmentation) | Medium | §2.2's 350 MB target missed while the UI claims 40 MB | `page.bytes` counts buffer bytes exactly; the per-page object overhead is ~1 KB against megabytes, so drift is <1 %. Watch it in the Step 16 acceptance by comparing `process.memoryUsage().rss` in the engine against `stats().l2Bytes` and log the ratio in dev. |
| R7 | Free-text WHERE/ORDER BY enables statement injection | Low | Severe | Structurally blocked (D13): pg's extended protocol rejects multiple statements in a parameterized query and `multipleStatements: false` is set explicitly for MariaDB. Add one Bun test per adapter that `'1=1; DROP TABLE app.regions'` as a filter errors and leaves the table present. Note honestly that a read-only user is the real defence and P4's read-only mode is where that lands. |
| R8 | MariaDB's two-segment path leaks into renderer code that assumes three | Medium | Breaks the abstraction P2 exists to validate | Nothing in the renderer may index `decodePath(...)[1]` — it uses `pathTail`/`pathParent` and the node's `kind`. Grep for numeric path indexing at the end of Step 14 and treat every hit as a bug. |
| R9 | Tab-state persistence writes on every scroll event | Medium | SQLite write amplification, jank | 250 ms debounce and `scrollTop`/`scrollLeft` are the only high-frequency fields; if this shows up in a profile, drop them from the persisted state (session restore does not fire a query anyway, so restoring a scroll offset is nearly meaningless). |
| R10 | Prefetch doubles the op log's volume and makes the ops panel unreadable | Medium | §8.11 usability | Accepted for P2 (D21) because a hidden op is worse than a noisy one. If it grates, P6 adds a "hide prefetch" filter to the ops panel — a UI-only change, no schema. |
| R11 | The `mariadb` driver's `typeCast`/`rowsAsArray` API differs from what this plan assumes | Medium | Step 15 rework | Settle every call against the bundled `.d.ts` in Step 14 before writing Step 15. If `typeCast` cannot be combined with `rowsAsArray`, fall back to default row objects and read them positionally by field name — one extra indirection in `read.ts`, no contract change. |
| R12 | Session restore resurrects a tab whose connection or table no longer exists | Medium | Broken tab on launch | The restored tab does nothing until "Reconnect & load" is pressed (D15); failure at that point renders the normal error state with the server's message. `getAllTabs` already drops rows whose `state_json` fails to parse, and the `tabs.connection_id` FK cascades on connection delete. |

---

## 6. Open questions (decide during, record in the commit)

1. **Does `describe`'s cached metadata carry a primary key today?** Keyset eligibility (D6) needs
   one. If `objectMetaSchema` has no PK field, derive it from the `primary` index in
   `indexes` rather than adding a field — and if that is not available either, add
   `primaryKey: string[] | null` to `objectMetaSchema` in Step 5 and note it as a contract change.
2. **Where does the "Count rows" tree-menu result surface?** The status bar is the cheapest place
   and needs no new UI. If it reads badly, move it to a toast in P6.
3. **Should a tab whose connection is closed keep its last page on screen?** Proposed: yes, greyed,
   with the toolbar disabled — the data is already in the renderer and throwing it away helps
   nobody. Confirm against §8.4's restored-tab wording when you get there.

---

## 7. Definition of done

- Two adapters (`postgres`, `mariadb`) implement `read`, `count`, `quoteIdent` and lease-accurate
  `cancel`, and neither appears by name anywhere in `src/renderer` or `src/main`.
- A table opens in N independent tabs with independent filter/sort/projection/page state; tabs
  survive relaunch as "Reconnect & load" placeholders that log zero ops until pressed.
- The grid renders a 10 000-row page with <1 200 cell nodes in the DOM at any scroll position, and
  the p95 rAF handler stays under 8 ms during a scripted fling.
- Row data is provably non-reactive: the page store's `getPage(tabId)` fails `isReactive`.
- Pager, page sizes, count-all (exact and estimate), projection, header sort, `ORDER BY` box,
  filter toolbar with history + saved entries, page-local search, and a stop button that cancels a
  real server-side query all work against both engines.
- L2 respects a byte budget that the status bar reports and Settings can change and clear; L3
  honours its TTL; prefetch fills L2 on idle and is cancelled by navigation.
- `bun run typecheck`, `bun run lint`, `bun run test:db` and `bun run test:ui` are all clean, and
  the Playwright `consoleErrors` array is empty in every spec.
