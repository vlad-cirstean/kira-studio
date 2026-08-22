# P2 — Tabular data view

> Plan for SPEC.md §10 phase **P2**. Authored by Opus, executed by Sonnet.
> Deliverable: *Virtualized grid, tabs (same table N times), pagination + page sizes, count-all, projection, sort, stop button, search toolbar, filter toolbar (`WHERE` + `ORDER BY` + history/saved), L2/L3 caches, prefetch. **MariaDB adapter**.*
>
> P1 proved the adapter shape against one engine and one read surface (the tree). P2 is where the shape has to survive contact with the two things it was designed for: a **second SQL engine** written against the same interface without touching the first, and the **bulk read path** — result pages, caches, cancellation, and a grid that has to stay at frame budget while holding ten thousand rows.

## 0. Ground rules for this phase

- Build **only** what P2 lists. Read §16 (Out of scope) before starting and again whenever you feel like "just adding" a cell editor, a copy-as-JSON item, a DDL tab or an FK button.
- Run `bun run lint`, `bun run typecheck` and `bun run test:ui` at the end of each numbered step. From Step 14 on, also `bun run test:db`. A step is done when its acceptance check passes.
- **Standing rule from P1, restated and amended:** *never interpolate a database identifier into SQL that came from user free text.* P2 must nonetheless name a table and its columns in a `SELECT`, which no parameter can do. The amendment is D8: identifiers are quoted by a per-adapter `quoteIdent` and may **only** come from adapter-produced catalog metadata (a `NodePath` segment or a `ColumnMeta.name` the adapter itself just read out of the catalog) — never from the filter box, never from a renderer-supplied string that was not first matched against catalog output.
- **No Vue reactivity on row data** (§2.1). Row bytes live in plain, frozen, non-reactive structures; the grid reads them imperatively and re-renders off an explicit version counter. A `reactive()` wrapper around a page is a P2 bug, not a style preference.
- **Every byte is accounted for.** Any structure that holds result data has a measured size and a budget (§2.2). "It's probably small" is not a cache policy.

### P0/P1 realities you must work with (verified against the tree, not the plans)

These are facts about the code as it stands at `746394c`. Do not rediscover them the hard way.

1. **`opKind` is `z.enum(['connect','disconnect','children','describe','test'])`** in `src/shared/domain/ops.ts`, with a comment saying P2 adds `read`/`count`. The **same enum is duplicated inline** in `opStartEventSchema` in `src/shared/protocol/engine-ops.ts` (`kind: z.enum([...])`). Both must grow together, and the inline one should be replaced by an import of `opKindSchema` while you are there — the duplication is exactly the kind of thing that silently drops `read` events.
2. **`op_log.tab_id` exists and is always `null`.** `src/main/oplog.ts` hardcodes `tabId: null` in its `InFlightOp`. P2 is what fills it (D2).
3. **`RunOpCtx` already extends `OpCtx` with `setRows(n)`** (`src/engine/scheduler/ops.ts`). `runOp` generates the `opId` itself; P2 lets the caller supply one (D2).
4. **The engine's live-adapter map lives in `src/engine/control.ts`** as a module-level `const adapters = new Map<string, Adapter>()`, and `wireScheduler({ emit, getAdapter })` injects a lookup into the scheduler to avoid an import cycle. P2's data service needs the same lookup, so Step 4 extracts the map into `src/engine/adapters/live.ts` (D-note in Step 4) rather than adding a second injection channel.
5. **The renderer↔engine MessagePort carries exactly one op: `ping`.** `src/engine/rpc.ts` has a one-entry handler table; `src/renderer/bridge/port.ts` handles only `{kind:'res'}` frames, has a hard 30 s timeout on every request, and ignores `{kind:'evt'}` frames entirely — even though `PortEvent` is already declared in `src/shared/port.ts`. P2 adds event handling and per-request timeout control (D25).
6. **`engine/index.ts` posts port responses with `port.postMessage(response)` — no transfer list.** Step 4 changes the port dispatch signature to return `{ response, transfer }`. See D4 before you assume `transfer` can carry an `ArrayBuffer` here.
7. **`tabs` exists, is empty, and its `order` column is quoted everywhere** (`"order"` is a SQLite keyword). There is no `storage/schema/tabs.ts` — P1 Step 13b deliberately left it out, saying the phase that adds the repo adds the schema file. That phase is this one.
8. **`saved_queries` exists, is empty, and its `name` column is `NOT NULL`.** This is why filter *history* does not live in it (D19).
9. **`metadata_cache` merges `children` and `describe` into one row per `(connection_id, path)`** because the unique index has no `kind`. Do not touch this; L1 is unchanged by P2 (§3).
10. **`schema_version` is 1**; `src/main/storage/migrations/index.ts` is a hand-maintained `as const` array and migrations are `.sql?raw` imports. P2 adds `0002_p2.sql` and one line to that array.
11. **Settings are `{ appearance: {...} }` only.** The Settings dialog's **Data**, **Cache** and **Advanced** sections are already drawn with `disabled` inputs and a *"Available once data views land."* note. P2 turns Data and Cache on and deletes their notes; **Advanced stays disabled** (engine memory cap and op-log retention are P12).
12. **`SettingsDialog.vue` is one file with inline `<template v-if>` blocks per section** — there is no `sections/` directory. Keep that shape.
13. **`renderer/state/` holds `connections.ts` and `ops.ts`; `renderer/workbench/state/` holds `layout.ts`, `settings.ts`, `engine.ts`, `contextMenu.ts`; `renderer/project/state/` holds `tree.ts`.** P2 adds `renderer/state/tabs.ts` and **moves `settings.ts` into `renderer/state/`** (D20) because P2 is the phase that both touches it and makes it cross-view. Nothing else moves.
14. **`VirtualList.vue` is fixed-row-height, single-axis, and reads `rowHeight` as a prop.** It is right for the tree and the op log and **wrong for the grid**, which needs two-axis windowing and per-column widths. Do not generalise it — the grid gets its own windowing (Step 8), and `VirtualList.vue` is left exactly as it is.
15. **`ContextMenu.vue` + `workbench/state/contextMenu.ts` is the single menu service** (P1 D12), and its `MenuItem` already supports `swatch`, `checked`, `danger`, `disabled` and one level of submenu. The tab menu (Step 7) and the tree additions (Step 13) use it. Do not write a second menu.
16. **`main/ipc/errors.ts`'s `handle()` folds `err.code` into the message as `[CODE] text`.** The renderer branches on that prefix. Port ops do **not** go through it — `engine/rpc.ts` has its own error envelope with a real `code` field, which is better; keep it and make the data client surface `{ code, message }`.
17. **`externalizeDepsPlugin()` externalises `dependencies` and bundles `devDependencies`.** `mariadb` is loaded by the engine at runtime, so it goes in **`dependencies`** next to `pg`.
18. **`tests/db/support/docker.ts` already resolves the Colima socket and exports `isDockerAvailable` / `DOCKER_UNAVAILABLE_MESSAGE`.** The MariaDB fixture reuses it verbatim; do not write a second probe.
19. **`tests/db/support/postgres.ts` memoises one container per test process** and seeds 1 000 000 rows into `app.big_rows` by default. P2 is the phase that consumes those rows. The MariaDB fixture mirrors the shape exactly (Step 14).
20. **`tsconfig.node.json` includes `tests/db/support/**/*.ts`** but not `tests/db/*.spec.ts` — the specs typecheck under `tests/db/tsconfig.json` with `bun-types`. Add nothing; new support files are picked up automatically.

### Prerequisites to verify before Step 1

```
colima status            # must report a running VM; if not: colima start --cpu 4 --memory 6 --disk 40
docker context ls        # 'colima' must exist
docker info              # must succeed
docker pull mariadb:11.4
docker pull postgres:17-alpine   # already cached from P1, listed so a clean machine gets both
```

**Colima, not Docker Desktop** — unchanged from P1, and `tests/db/support/docker.ts` already handles the socket resolution.

---

## 1. Decisions made in this plan

The spec leaves these open. They are decided here — implement as written, do not re-litigate.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Result pages travel renderer↔engine over the MessagePort, never through main.** The new port channel group is `data:read`, `data:count`, `data:prefetch`, `cache:stats`, `cache:clear`. Everything else P2 adds (tabs persistence, saved filters, history, settings) stays on `ipcRenderer.invoke` through main. | This is P1 D1's forward reference cashed in, and §4's rule: "Bulk data skips the main process… Control messages go through main so it stays the single source of truth for state and logging." A 10 000-row page is megabytes; routing it through main means two structured clones and a main-process stall on every page — the exact frame-drop §2.1 forbids. Tabs and saved filters are SQLite rows, which only main can touch, so they take the main path for the same reason the tree does. |
| **D2** | **The renderer generates the `opId` for a port op and sends it in the request; `runOp` accepts a caller-supplied id and a `tabId`.** `op_log.tab_id` is populated from it. | The stop button must be able to cancel an op that has not answered yet, so the renderer needs the id *before* the response. The alternatives are worse: an early `evt` frame correlating a request id to an op id is a second round trip and a race, and a per-tab "current op" registry in the engine duplicates state the renderer already has. `runOp` rejects a duplicate id (`E_QUERY`), so a buggy or hostile renderer cannot hijack another op. Filling `tab_id` also finally makes §8.11's tab column and *Reveal originating tab* real. |
| **D3** | **A `TabularPage` column is lossless server text: packed UTF-8 bytes + a `Uint32Array` of offsets + a null **bitset**, plus a `typeClass` on the column descriptor for alignment and formatting.** No client-side numeric decoding, no per-row objects, no `Date`/`BigInt`/`number` reconstruction. Both adapters read in the driver's *string* mode (Postgres: identity type parsers; MariaDB: `typeCast` → `column.string()`). | §2.2 wants columnar with ~4–6× less per-row overhead; this is the shape that delivers it — three exactly-sized buffers per column and zero objects per row. It is also the only *lossless* choice: `numeric(20,6)` and `bigint` do not survive a JS `number`, and the grid displays the server's own rendering anyway (which is what a DB client should show). Identity parsers are cheaper than parsing, not more expensive. P3's cell editor gets the same text and does its own format autodetect on it, which is exactly §8.6's design. |
| **D4** | **Transfer is an optimisation, not a correctness requirement.** Build the page once, keep it in L2, and send the port a **copy**. Whether the copy rides in a transfer list is decided by what Electron's `MessagePortMain.postMessage` typings actually accept in this Electron version — verify against `electron.d.ts` before writing the call; if the transfer list is `MessagePortMain[]` only, send by structured clone and move on. | Two independent points. (a) **Never transfer the L2 original** — a transferred `ArrayBuffer` is detached, so the cached page would be silently emptied and every later hit would serve zero bytes. This is the single most likely catastrophic bug in this phase. (b) The columnar win is the *absence of per-row objects*, not zero-copy; a structured clone of contiguous buffers is one memcpy and still orders of magnitude better than cloning 10 000 objects. Design for the copy, take the transfer if the platform gives it. Corollary: every typed array must be backed by an **exactly-sized** `ArrayBuffer` — a view over an oversized shared buffer clones the slack. |
| **D5** | **`Page` is declared as a discriminated union with one member today** — `export type Page = TabularPage;` — with a doc comment naming `DocumentPage` (P8), `KeyValuePage` (P9) and `StreamPage` (P10) as the future members, and **every consumer switches on `page.kind`** even though the switch has one arm. | P0/P1's no-scaffolding-forward rule: three empty interfaces would be a lie the type system endorses, and P8 would redesign them anyway. Requiring the `kind` switch now is what makes widening the union purely additive — a new member is a compile error at every site that must handle it, which is the whole point of the discriminant. |
| **D6** | **Sort has two surfaces and one state.** `SortSpec` is `{ kind: 'structured'; terms: { column, direction }[] }` or `{ kind: 'text'; text: string }`. Clicking a grid header produces the structured form and renders its equivalent string into the `ORDER BY` box; typing in the box switches the state to the text form and clears the header indicators. | §8.5 has both a clickable header sort and a free-text `ORDER BY` field; they are two editors for one thing and must not be able to disagree. Keeping the structured form distinguishable is not cosmetic — it is what makes D7's keyset decision possible at all, because free text is opaque to the adapter. |
| **D7** | **Keyset pagination is used only when the effective order is machine-readable and total; every random-access jump uses `LIMIT/OFFSET`.** Precisely: keyset iff the sort is absent or `structured`, **all** terms share one direction, and the relation has a primary key (or a unique, all-`NOT NULL` index) to append as a tiebreaker in that same direction — and the request is `after`/`before`. `first`, `last` and jump-to-page always use `offset`. A `text` sort is always `offset`. | §5.1 promises "keyset on PK, else `LIMIT/OFFSET`" for both engines, and `caps.pagination: 'keyset'` is already asserted for Postgres — dropping keyset would make the cap a lie. But §8.5's pager has ⏮/⏭ and a page number, which keyset cannot express at all. Row-value comparison (`(a,b) > ($1,$2)`) is the only sane keyset construction on both engines and it requires uniform direction, hence the restriction rather than a half-working mixed-direction hack. The pager exposes `data-pagination="keyset\|offset"` so this is observable and testable rather than folklore. |
| **D8** | **Each adapter gets a `quoteIdent(name)` and identifiers may only originate in catalog output.** Postgres: `"` + `name.replace(/"/g,'""')` + `"`. MariaDB: backtick + `name.replace(/`/g,'``')` + backtick. A name containing `\0` throws `E_QUERY`. Projected column names from the renderer are **matched against the freshly-read `ColumnMeta` list** and an unknown name throws `E_NOT_FOUND` naming it. | The read path cannot bind a table name as a parameter, so P1's absolute "never interpolate an identifier" needs an explicit, narrow exception rather than being quietly broken. Sourcing every identifier from catalog output and re-validating projections turns the exception into a closed loop: the only strings that reach `quoteIdent` are strings the server itself just handed us. |
| **D9** | **The `WHERE` and `ORDER BY` free text is embedded verbatim, and that is safe here — provably, not by hope.** Guards, all three of which must hold: the fragment is embedded **inside a `SELECT`**, where neither engine permits DML; the query is issued over a protocol that **cannot carry a second statement** (Postgres: always pass a `values` array so node-postgres uses the extended protocol; MariaDB: `multipleStatements` stays at its default `false`); and the server's error text is surfaced **unmodified**. | §8.5 is explicit that the predicate is free text pushed server-side and that "invalid input is reported inline by the server's own error, unmodified" — sanitising or re-parsing it would break the feature. Writing down *why* it is safe, and which switch enforces each part, is what stops a later phase from turning on `multipleStatements` for an unrelated reason and quietly opening a hole. |
| **D10** | **The read path re-resolves the relation's column/PK metadata from the catalog on every uncached read**, in the same op, before the data statement. No fourth cache tier, no adapter-side metadata map. | An L2 hit skips it entirely, so it costs nothing on the path that has to feel instant; a miss is already a round trip, and one extra catalog query on a local socket is ~1–3 ms. The alternative — a per-adapter metadata memo — needs its own invalidation story that would have to agree with L1's, and two caches of the same fact that can disagree is a bug generator. If measurement in P12 says otherwise, P12 can memoise it with numbers in hand. |
| **D11** | **`engine/cache/` holds L2 and L3 only; L1 stays in main.** §11 describes `engine/cache/` as "L1/L2/L3 tiers"; that is superseded by P1 D10, which put L1 in SQLite in main so the tree renders while disconnected. Record the deviation in a comment at the top of `engine/cache/index.ts`. | §7's L1 is persistent, on disk, and must be readable with no engine involvement ("instant on launch"). Moving it into the engine would make the project panel depend on a live utility process, which is precisely what P1 designed away. L2 and L3 are in-memory, byte-budgeted and per-session — they belong where the pages are. |
| **D12** | **L2 key = `sha1(canonicalJson(normalizedRequest))`**, where the normalized request is `{connectionId, path, projection (sorted, unique, or null), filter (trimmed, null if empty), sort (canonical string), pageSize, cursor}`. The entry retains `connectionId`, `path` and the canonical JSON for targeted eviction and for the stats readout. | §7 says "Key = hash of {connectionId, path, filter, projection, sort, pageSize, pageToken}" — this is that, made deterministic. Normalisation is what turns "the user re-picked the same three columns in a different order" into a cache hit. Keeping `connectionId`/`path` on the entry is what makes *Refresh* and *disconnect* able to evict a subset without walking every key. |
| **D13** | **L3 is `{connectionId, path, filter} → {value, exact, at}` with a 5-minute TTL and a `stale` flag.** In P2 the only things that set `stale` are the TTL and an explicit *Refresh*; there is **no mutation-invalidation machinery**, because there are no mutations. The eviction entry point P5 will call is `cache.dropTarget(connectionId, path)`, which *Refresh* already uses. | §7 gives L3 both a TTL and "immediately marked stale after any local mutation". The second half has nothing to invalidate until P5, and building a mutation-observer with no mutations is scaffolding forward. Naming the exact function P5 will call means P5 adds a call site, not a redesign. |
| **D14** | **Prefetch never ships bytes.** `data:prefetch` takes the same request shape and answers `{ warmed: boolean; bytes: number }`; the page stays in L2 and the subsequent real `data:read` is a hit. Prefetch is skipped when the key is already resident, is cancellable via the normal stop path, and **is logged in the op log as a normal `read`**. | §7's prefetch exists to make the *next* click instant, not to move data the user may never look at — answering with the page would double the transfer for a speculative fetch. Logging it is §8.11's rule ("every DB operation, live") and honesty: it is a real query against the user's server. It is also why the `prefetch` setting exists, and why op-counting specs turn it off. |
| **D15** | **"Clear caches" clears L2 and L3 only. L1 is untouched.** | §7 gives L1 an explicit, complete invalidation story (connection deleted, reconnect, manual *Refresh*) and no others. A generic button that also blew away metadata would contradict that story and blank the panel that §7 exists to keep instant. |
| **D16** | **Cache stats are pushed engine→renderer over the port** as `{kind:'evt', topic:'cache:stats'}`, throttled to at most 1 Hz and only when a number changed. | The status bar shows cache size continuously (§7 Observability); a poll would either lag or spin a timer forever. The port already has an event envelope declared and unused (§0 note 5) — this is what it was for. Pushing on change means an idle app posts nothing. |
| **D17** | **Tabs persist as a whole-set replace** (`kira:tabs:save({ tabs })`, delete-all + insert in one transaction, mirroring `filters:replace`), written immediately on a structural change (open/close/reorder/activate) and debounced at 1 s for view-state changes (scroll, widths, page). **A restored tab is never auto-connected** and renders only a centred *Reconnect & load* button. | §8.4 is explicit about the restore behaviour. Whole-set replace because the set is tens of rows and is edited as a list; per-row upserts would need ordering fixups on every close. The two-speed write keeps a scroll wheel from writing SQLite 60 times a second while guaranteeing that "I closed a tab and force-quit" is durable. |
| **D18** | **`tabKindSchema` declares all six §8.4 kinds; only `data` is renderable in P2**, and the restore path drops rows of any other kind with a `warn` log. | Same call as P1 D4 made for `Caps` and `connectionKindSchema`: a closed vocabulary is data, decided once, and nothing can *create* a non-`data` tab in P2 so no placeholder UI exists to rot. Dropping unknown rows on restore is the same "corrupt row is a miss, not an error" discipline P1 used for the metadata cache. |
| **D19** | **Migration `0002_p2.sql` adds `saved_queries.pinned` and a new `filter_history` table.** Saved filters are `saved_queries` rows with `kind = 'filter'` and a JSON `body` of `{ where, orderBy }`; history is `filter_history(id, connection_id, path, where_text, order_by_text, used_at)`, capped at 20 per `(connection_id, path)`. | §8.5 distinguishes "the previously used filters and sorts for this table" from "anything **saved** (`saved_queries`)" — two lifecycles: one is an automatic, evicting, unnamed ring, the other is deliberate, named and pinned. `saved_queries.name` is `NOT NULL` (§0 note 8), so history would have to store `''` names in a table whose every other consumer (P5.5's console) expects real ones. A separate table is smaller than the workaround. `pinned` is a plain `ALTER TABLE ADD COLUMN`, which SQLite supports. |
| **D20** | **`settings` grows `data: { defaultPageSize, prefetch, countOnOpen }` and `cache: { l2BudgetMb }`**, and `renderer/workbench/state/settings.ts` **moves to `renderer/state/settings.ts`**. | §8.2 specifies exactly these controls, and P2 is the phase that makes them mean something. The move follows P1 note 11's own rule (a file relocates in the phase that touches it) plus §11's criterion for `renderer/state/`: `views/grid/` must read the page-size and prefetch settings, and a view reaching up into `workbench/` is the dependency inversion §11 exists to prevent. |
| **D21** | **The workbench's toolbar band hosts *both* §8.5 toolbars** (main row + filter row) and is tinted with the connection colour; `MainView` hosts only the view body; the search toolbar is a floating widget inside the view body. | §8.1's chrome diagram puts one toolbar band between the tab strip and the main view, and §8.5 says the filter toolbar sits directly below the main toolbar — so both belong to the band, and the band's height becomes content-driven instead of the current fixed 32 px. §8.12 names the tab and the data-view toolbar as two of the three places the connection colour appears (the tree rail is the third and already exists). VS Code's find widget floats over the editor, and §8.5 says the search toolbar is "VS Code-styled". |
| **D22** | **P2 ships no grid context menus.** §8.10's *Grid cell*, *Grid row* and *Grid header* rows land whole in P6. The **Tab** row of §8.10 ships in P2. | The grid rows are half copy/paste (P6), half FK navigation (P7) and half mutation (P5); a menu with two live items and five dead ones is worse than none, and P6 would rewrite it. Sorting and column visibility have real homes already (header click, projection menu). The tab menu is the opposite case: every item on it operates on a concept P2 creates and can implement completely today. |
| **D23** | **Copy/paste is P6; the selection model is P2.** Cell, row, column and range selection with keyboard extension exists; nothing writes to the clipboard. | §10's P6 row owns "copy/paste rows" explicitly. Selection is not optional in P2 — §8.5 lists it under grid behaviour, and P3's cell editor is defined as "clicking a cell renders its value here", which requires a selection to exist and be observable. |
| **D24** | **`pageSize ∈ {10, 100, 1000, 10000}`, validated at the port boundary; the adapter fetches `pageSize + 1` rows to compute `hasMore` and returns at most `pageSize`.** | §8.5's `rows [10\|100\|1k\|10k]` is the whole set, so a union of literals is the honest type and the hard cap on how big a page can get. The +1 probe is how you know there is a next page without a count, which is what keeps ▶ enabled before anyone presses Σ. |
| **D25** | **Data port ops have no client-side timeout.** `request()` grows an options argument; `data:read`/`data:count`/`data:prefetch` pass `timeoutMs: null`. Cancellation is the escape hatch. | §5.1: "Cancellation is never 'stop showing the result' — it is always forwarded to the server." A client-side timeout that abandons a query the server is still executing is exactly that lie, and a legitimate `count(*)` over 1 M rows can outlive any timeout you would be willing to set. The stop button plus the op log are the user's control surface. |
| **D26** | **MariaDB mirrors Postgres D14: one `mariadb.Connection` per (connection, database), never a pool, bounded at 8 with LRU eviction of non-primary connections; cancel opens a short-lived side connection and runs `KILL QUERY <threadId>`.** | §5.1's MariaDB row names exactly this cancel mechanism, and it needs a known thread id — which a pool does not reliably give you, for the same reason `pg_cancel_backend` needs a known backend pid (P1 D14). Mirroring the structure also means `client.ts` is recognisably the same file in both adapter folders, which is §11's stated goal for the fixed adapter shape. |
| **D27** | **The MariaDB adapter is a new folder and touches nothing outside it** — `src/engine/adapters/mariadb/{index,client,query,catalog,read,caps}.ts` plus one line in `adapters/registry.ts` and one enabled `<option>` in the connection dialog. | This is the phase's actual thesis (§10: "Second SQL engine validates the abstraction cheaply"). If adding it requires editing `scheduler/`, `cache/`, `data.ts` or any renderer file beyond enabling the dialog option, the abstraction failed and the fix belongs in the abstraction — say so rather than making the edit. |
| **D28** | **The search toolbar searches the loaded page in the renderer, in chunks across animation frames**, with a live match count and a cancel-on-retype. It never queries the server. | §8.5: "Searches the **loaded page only** — never the server… the two are deliberately not mixed." A 10 000 × 60 page is 600 000 cells; doing that synchronously on every keystroke would blow §2.1's frame budget by two orders of magnitude, so chunking is not a nicety. |

---

## 2. Target tree at the end of P2

New and modified files only; everything else from P0/P1 is untouched. Paths follow SPEC §11's layout, continuing P1's rule that a file relocates only in the phase that substantially touches it.

```
package.json                                     + mariadb (dependencies)
src/
  shared/
    protocol/
      page.ts                          NEW  Page union, TabularPage, columnar codec, byte accounting (D3/D5)
      data-ops.ts                      NEW  the port channel group: op names, Read/Count wire schemas (D1)
      ipc.ts                           MOD  + tabs/queries/history channels and KiraApi methods
      engine-ops.ts                    MOD  + configureCache op; opStart gains tabId; kind imports opKindSchema
    domain/
      tabs.ts                          NEW  TabKind, TabRecord, DataTabState (+Zod), tab-title helpers
      queries.ts                       NEW  SavedQuery, FilterHistoryEntry, SortSpec, FilterSpec (+Zod)
      ops.ts                           MOD  opKind += 'read' | 'count'
    settings.ts                        MOD  + data{} and cache{} sections (D20)
  main/
    storage/
      migrations/0002_p2.sql           NEW  saved_queries.pinned + filter_history (D19)
      migrations/index.ts              MOD  one line
      schema/tabs.ts                   NEW
      schema/saved-queries.ts          NEW
      schema/filter-history.ts         NEW
      repos/tabs.ts                    NEW  listTabs / replaceTabs (whole-set, one transaction)
      repos/saved-queries.ts           NEW  list/save/update/delete/touch for kind='filter'
      repos/filter-history.ts          NEW  record (capped ring) / list
    ipc/tabs.ts                        NEW  kira:tabs:*
    ipc/queries.ts                     NEW  kira:queries:*
    ipc/registry.ts                    MOD  two lines
    ipc/settings.ts                    MOD  push cache budget to the engine on change
    engine-config.ts                   NEW  pushes engine-relevant settings at startup and on change
    oplog.ts                           MOD  tabId from the op:start event instead of hardcoded null
  engine/
    index.ts                           MOD  port dispatch returns { response, transfer }
    rpc.ts                             MOD  the data/cache port ops
    control.ts                         MOD  adapters map extracted; disconnect drops L2/L3 for the connection
    data.ts                            NEW  read/count/prefetch orchestration: cache-aside + runOp + serialize
    scheduler/ops.ts                   MOD  caller-supplied opId, tabId, duplicate-id rejection
    cache/
      lru.ts                           NEW  ByteLru<K,V>: byte-budgeted LRU with measured sizes
      pages.ts                         NEW  L2 (D12)
      counts.ts                        NEW  L3 (D13)
      index.ts                         NEW  façade: get/put/dropTarget/dropConnection/clear/stats
    adapters/
      adapter.ts                       MOD  + read() and count() (the P1 roadmap's P2 row)
      live.ts                          NEW  the live adapter map, extracted from control.ts
      registry.ts                      MOD  + mariadb factory
      sql-text.ts                      NEW  driver-agnostic page-builder glue shared by both SQL adapters
      postgres/
        read.ts                        NEW  the file P1 reserved: read() + count() for Postgres
        catalog.ts                     MOD  + relation-for-read resolution (columns + PK + unique index)
        index.ts                       MOD  wire read/count through
      mariadb/                         NEW  index.ts client.ts query.ts catalog.ts read.ts caps.ts
  renderer/
    bridge/
      port.ts                          MOD  event frames, per-request timeout control, transfer-aware receive
      data.ts                          NEW  typed client for the data port ops
      control.ts                       MOD  wrappers for the new main channels
    state/
      settings.ts                      MOD  moved from workbench/state/settings.ts (D20)
      tabs.ts                          NEW  open tabs, active tab, persistence, restore (D17)
    views/grid/                        NEW  (SPEC §11's renderer/views/grid/)
      DataView.vue                          the tab body: grid + overlays + Reconnect & load
      DataToolbar.vue                       §8.5 row 1
      FilterToolbar.vue                     §8.5 row 2
      FilterHistoryMenu.vue                 history + saved (D19)
      ColumnsMenu.vue                       projection multi-select
      SearchToolbar.vue                     §8.5 search widget (D28)
      DataGrid.vue                          two-axis virtualized grid
      page.ts                               non-reactive page store + version counter + cell decode (D3)
      columns.ts                            widths, order, alignment, auto-size
      search.ts                             chunked page search (D28)
      state.ts                              per-tab data-view state machine
    workbench/
      panels/TabStrip.vue              MOD  real tab strip, connection-tinted (§8.4, §8.12)
      panels/Toolbar.vue               MOD  hosts the active tab's toolbars (D21)
      panels/MainView.vue              MOD  hosts the active tab's view body
      panels/OperationsPanel.vue       MOD  tab column resolves a title; Reveal originating tab
      WorkbenchShell.vue               MOD  toolbar band height becomes content-driven
      StatusBar.vue                    MOD  cache-size readout (§7 Observability)
      SettingsDialog.vue               MOD  Data + Cache sections turned on (§8.2)
      state/settings.ts                DEL  moved to renderer/state/settings.ts
    project/
      menus.ts                         MOD  Open data / Open data in new tab / Count rows / Saved filters ▸;
                                            column: Add to projection, Sort by (P1's deferrals)
      state/tree.ts                    MOD  revealPath() for the tab menu's Reveal in project panel
tests/
  db/
    support/mariadb.ts                 NEW  container + seeded config, mirrors support/postgres.ts
    fixtures/0002_mariadb_seed.sql     NEW  the §9.1 dataset in MariaDB dialect
    mariadb.spec.ts                    NEW  the §9.1 scenarios for MariaDB, incl. server-side cancel
    postgres.spec.ts                   MOD  + read/count/pagination/projection/filter scenarios
  ui/
    support/mariadb.ts                 NEW  re-export for Playwright, mirrors support/pg.ts
    data-view.spec.ts                  NEW  grid, paging, count, projection, sort, search, stop, filters
    tabs.spec.ts                       NEW  same table twice, tab menu, session restore, colors
    mariadb.spec.ts                    NEW  second-engine smoke through the real UI
    perf.spec.ts                       NEW  10k-row scroll tripwire + cache-budget assertion
docs/plans/P2-tabular-data-view.md     (this file)
```

---

## 3. What P2 does not change

Read this before touching anything outside §2's list. These are load-bearing and P2 has no business in them.

- **L1 and the tree's control path.** `main/tree-service.ts`, `main/storage/repos/metadata-cache.ts`, `main/connections.ts`, `main/ipc/{connections,tree,filters}.ts`, `engine/adapters/postgres/{client,query}.ts`'s existing behaviour, and the `kira:tree:*` channels all stay as they are. P1 D10's cache-aside, D11's reconnect invalidation and the 4 MB payload guard are unchanged. P2 adds `read`/`count`, which do not go near them.
- **`metadata_cache`'s merged-payload row shape** and its `(connection_id, path)` unique index. No migration touches it.
- **The `Caps` type.** Every flag P2 needs already exists (P1 D4 shipped it complete). MariaDB gets a cap literal; the type does not change.
- **`Adapter.connect/disconnect/children/describe/cancel`** signatures. P2 *adds* two methods; it does not alter the five that exist.
- **`VirtualList.vue`**, the project tree's rendering, the connection dialog, the filters dialog, the colour picker, `ContextMenu.vue`, `Splitter.vue`, `Codicon.vue`, `tokens.css`.
- **The op-log persistence and retention path** (`repos/ops.ts`, `pruneOps`, the 500-entry renderer ring). P2 adds two `opKind` members and fills `tab_id`; the machinery is untouched.
- **Engine lifecycle.** No auto-respawn (still), no per-connection processes, no change to `--max-old-space-size=512`. Note that this flag bounds the V8 old space and **not** `ArrayBuffer` memory — the L2 byte budget is the only thing bounding page bytes, which is why D12's accounting has to be right.
- **Credential handling.** `SecretStore`, `ConnectionSummary`'s missing `password`, `reveal` logging: untouched. Nothing in the data path sees a secret.
- **The Advanced settings section** stays disabled.

---

## 4. Shared contracts (Step 1 writes these; the rest of the plan refers back)

### 4a. `src/shared/protocol/page.ts` — the columnar page (D3, D5)

Imported by the engine (encode) and the renderer (decode). Isomorphic: `TextEncoder`/`TextDecoder` only, no Node or DOM APIs.

```ts
export type PageKind = 'tabular' | 'document' | 'keyvalue' | 'stream';   // re-exported from caps.ts

export type TypeClass = 'number' | 'text' | 'boolean' | 'temporal' | 'binary' | 'json' | 'other';

export interface ColumnDescriptor {
  name: string;
  /** The server's own type name, verbatim: 'numeric(20,6)', 'varchar(50)', 'longblob'. */
  dataType: string;
  typeClass: TypeClass;        // alignment + NULL/empty rendering + P3's format hinting
  nullable: boolean;
  isPrimaryKey: boolean;
}

/**
 * One column of one page. Three exactly-sized buffers (D4) and no per-row object:
 *   text of row i = utf8.decode(data.subarray(offsets[i], offsets[i + 1]))
 *   row i is NULL  = (nulls[i >> 3] & (1 << (i & 7))) !== 0
 * A NULL row has offsets[i] === offsets[i+1]; an empty string does too, which is why the
 * bitset is the only thing that distinguishes them (§8.5 requires they render differently).
 */
export interface TextColumnChunk {
  data: Uint8Array;            // packed UTF-8, exactly-sized ArrayBuffer
  offsets: Uint32Array;        // rowCount + 1 entries
  nulls: Uint8Array;           // ceil(rowCount / 8) bytes
  /** Sorted row indices whose text was cut at MAX_CELL_BYTES. Usually empty. */
  truncated: Uint32Array;
}

export interface PagePosition {
  /** Absolute row offset when the page came from an offset query; null for a keyset page. */
  offset: number | null;
  pageSize: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
  strategy: 'keyset' | 'offset';
}

export interface TabularPage {
  kind: 'tabular';
  columns: ColumnDescriptor[];
  rowCount: number;
  chunks: TextColumnChunk[];   // index-aligned with `columns`
  position: PagePosition;
  truncatedCells: number;
  /** Measured, not estimated — this is what L2 budgets against (§2.2). */
  byteSize: number;
  fetchedAt: number;           // epoch ms
}

/**
 * P8 widens this to `TabularPage | DocumentPage`, P9 adds `KeyValuePage`, P10 `StreamPage`
 * (D5). Switch on `page.kind` everywhere, even though there is one arm today — that is what
 * makes widening additive instead of a rewrite.
 */
export type Page = TabularPage;

export const MAX_CELL_BYTES = 64 * 1024;
export const MAX_PAGE_SIZE = 10_000;
```

Codec, in the same file — the engine and the renderer must agree byte for byte, so there is exactly one implementation:

```ts
export interface TabularPageBuilder {
  /** One row, one string-or-null per column, in `columns` order. */
  appendRow(values: readonly (string | null)[]): void;
  /** Reverses the accumulated rows before finishing — used by a keyset 'before' page (D7). */
  reverse(): void;
  finish(position: PagePosition): TabularPage;
}
export function createTabularPageBuilder(columns: ColumnDescriptor[]): TabularPageBuilder;

export function isNull(chunk: TextColumnChunk, row: number): boolean;
export function cellText(chunk: TextColumnChunk, row: number, decoder: TextDecoder): string;
export function isTruncated(chunk: TextColumnChunk, row: number): boolean;
export function chunkByteSize(chunk: TextColumnChunk): number;
export function pageByteSize(page: TabularPage): number;
```

Implementation notes that are not optional:

- The builder accumulates into **growable scratch** (a `Uint8Array` doubled on demand, plus a plain `number[]` of offsets) and only at `finish()` copies into exactly-sized buffers. Growing by `slice()` per row would be quadratic; handing out a view over an oversized scratch buffer would defeat D4.
- `appendRow` truncates a value at `MAX_CELL_BYTES` **on a UTF-8 code-point boundary** (never mid-sequence — a split surrogate makes the renderer's decoder emit U+FFFD and the cell looks corrupted) and records the row index in `truncated`.
- `finish` computes `byteSize` as the sum of `chunkByteSize` over the chunks plus a fixed per-column envelope estimate (name + dataType lengths ×2 for UTF-16 + 64 bytes of object overhead). It is a measurement, not a guess: L2's budget is only as honest as this number.
- `cellText` takes the decoder as an argument so callers reuse one instance; constructing a `TextDecoder` per cell is a measurable cost at 600 000 cells.
- Zod validates the **envelope** (`columns`, `rowCount`, `position`, counters) at the port boundary. The typed arrays are checked structurally — `instanceof` plus `offsets.length === rowCount + 1` plus `nulls.length === Math.ceil(rowCount / 8)` — and a mismatch throws. Running Zod over 600 000 cells would cost more than the query.

### 4b. `src/shared/protocol/data-ops.ts` — the port channel group (D1)

```ts
export const DATA_OP = {
  read: 'data:read',
  count: 'data:count',
  prefetch: 'data:prefetch',
  /** Drops L2 pages + the L3 count for one target. The ↻ button; P5's mutation hook (D13). */
  invalidate: 'data:invalidate',
  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
} as const;

export const PORT_EVENT = { cacheStats: 'cache:stats' } as const;

export type SortDirection = 'asc' | 'desc';
export type SortSpec =
  | { kind: 'structured'; terms: { column: string; direction: SortDirection }[] }
  | { kind: 'text'; text: string };

export type PageCursor =
  | { mode: 'offset'; offset: number }
  | { mode: 'after'; token: string }
  | { mode: 'before'; token: string };

/** The wire form: `path` is the encoded string (D6 of P1). engine/data.ts decodes it. */
export interface ReadRequestWire {
  opId: string;                       // renderer-generated (D2)
  tabId: string | null;
  connectionId: string;
  path: string;
  projection: string[] | null;        // null = every column
  filter: string | null;              // free-text WHERE fragment (D9)
  sort: SortSpec | null;
  pageSize: 10 | 100 | 1000 | 10000;  // D24
  cursor: PageCursor;
}

export interface CountRequestWire {
  opId: string;
  tabId: string | null;
  connectionId: string;
  path: string;
  filter: string | null;
}

export interface ReadResponse { page: Page; source: 'cache' | 'server'; }
export interface CountResponse { value: number; exact: boolean; at: number; stale: boolean; source: 'cache' | 'server'; }
export interface PrefetchResponse { warmed: boolean; bytes: number; }
export interface CacheStats {
  l2Bytes: number; l2BudgetBytes: number; l2Entries: number;
  l2Hits: number; l2Misses: number;
  l3Entries: number;
}
```

Every request payload gets a Zod schema in this file and is parsed in `engine/rpc.ts` before use (a trust boundary — §3 of the spec). `filter` and each `sort.text` are capped at **4096 characters** by the schema; a longer one is rejected with `E_QUERY` and a legible message. `pageSize` is a `z.union` of the four literals, not a number with bounds.

### 4c. `src/shared/domain/tabs.ts` (D17, D18)

```ts
export const tabKindSchema = z.enum(['data', 'ddl', 'document', 'keyvalue', 'stream', 'console']);
export type TabKind = z.infer<typeof tabKindSchema>;

// Only 'data' is renderable in P2; the restore path drops other kinds with a warn (D18).
export const RENDERABLE_TAB_KINDS: readonly TabKind[] = ['data'];

export const dataTabStateSchema = z.object({
  pageSize: z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10000)]),
  pageIndex: z.number().int().min(0),      // what the pager shows; offset = pageIndex * pageSize
  filter: z.string().nullable(),
  sort: sortSpecSchema.nullable(),
  projection: z.array(z.string()).nullable(),
  columnWidths: z.record(z.string(), z.number()),
  columnOrder: z.array(z.string()).nullable(),
  scrollTop: z.number(),
  scrollLeft: z.number(),
});
export type DataTabState = z.infer<typeof dataTabStateSchema>;

export const tabRecordSchema = z.object({
  id: z.string(),
  connectionId: z.string().nullable(),
  path: z.string(),                        // encoded NodePath, '' for a connection-scoped tab
  kind: tabKindSchema,
  state: dataTabStateSchema,               // widened to a union when a second kind lands
  order: z.number().int(),
  active: z.boolean(),
});
export type TabRecord = z.infer<typeof tabRecordSchema>;

export function defaultDataTabState(pageSize: DataTabState['pageSize']): DataTabState;
/** 'order_items' — the path tail's name; the connection name is rendered separately. */
export function tabTitle(record: TabRecord): string;
```

Cursor tokens are deliberately **not** persisted: they are server-shaped and cheap to redo, and a restored tab loads by offset (`pageIndex * pageSize`). A tab row whose `state_json` fails `dataTabStateSchema` is dropped on restore, logged, and not re-saved — the same "corrupt row is a miss" discipline as L1.

### 4d. `src/shared/domain/queries.ts` (D19)

```ts
export const savedQueryKindSchema = z.enum(['filter']);   // P5.5 adds 'console'
export const filterBodySchema = z.object({
  where: z.string().nullable(),
  orderBy: sortSpecSchema.nullable(),
});
export const savedQuerySchema = z.object({
  id: z.string(), connectionId: z.string(), path: z.string(),
  name: z.string().trim().min(1).max(120),
  kind: savedQueryKindSchema,
  body: filterBodySchema,
  pinned: z.boolean(),
  createdAt: z.string(), usedAt: z.string().nullable(),
});
export const filterHistoryEntrySchema = z.object({
  id: z.string(), connectionId: z.string(), path: z.string(),
  where: z.string().nullable(), orderBy: sortSpecSchema.nullable(), usedAt: z.string(),
});
```

`sortSpecSchema` lives here (it is a domain concept — "how this table is ordered") and is re-exported by `protocol/data-ops.ts` for the wire, matching §11's split between what concepts mean and what crosses a wire.

### 4e. Modifications to existing shared files

`shared/domain/ops.ts`:
```ts
export const opKindSchema = z.enum([
  'connect', 'disconnect', 'children', 'describe', 'test',
  'read', 'count',            // P2
]);                            // P5 adds 'mutate'; P5.5 adds 'execute'
```

`shared/protocol/engine-ops.ts`:
- `opStartEventSchema.kind` becomes `opKindSchema` (imported, not re-declared — §0 note 1).
- `opStartEventSchema` gains `tabId: z.string().nullable()`.
- `ENGINE_OP` gains `configureCache: 'cache:configure'` with payload `{ l2BudgetBytes: number }` and result `{}`.

`shared/settings.ts`:
```ts
export const dataSettingsSchema = z.object({
  defaultPageSize: z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10000)]),
  prefetch: z.boolean(),
  countOnOpen: z.boolean(),
});
export const cacheSettingsSchema = z.object({ l2BudgetMb: z.number().int().min(8).max(1024) });
// settingsSchema = { appearance, data, cache }; defaults: 100 / true / false / 64.
```
`settingsPatchSchema` gains the two partial sections. `repos/settings.ts` already round-trips whatever `settingsSchema` describes; **verify** that a stored row written by a P1 build (which has no `data`/`cache` keys) still parses — if `settingsSchema` is strict about missing keys, give the new sections defaults via `.default()` so an existing `~/.kira-studio/kira.sqlite` does not fail to launch after the upgrade. That is a real upgrade path, not a hypothetical: the developer's own dev database is a P1 one.

`shared/protocol/ipc.ts` — new channels and `KiraApi` methods:
```
kira:tabs:list             () -> TabRecord[]
kira:tabs:save             ({ tabs: TabRecord[] }) -> void
kira:queries:list          ({ connectionId, path }) -> SavedQuery[]
kira:queries:save          ({ connectionId, path, name, body, pinned }) -> SavedQuery
kira:queries:update        ({ id, name?, pinned? }) -> SavedQuery
kira:queries:delete        ({ id }) -> void
kira:queries:touch         ({ id }) -> void
kira:queries:historyList   ({ connectionId, path, limit }) -> FilterHistoryEntry[]
kira:queries:historyRecord ({ connectionId, path, where, orderBy }) -> void
```

---

## 5. The adapter additions (normative)

This is the P1 roadmap's P2 row, cashed in. Read all of §5 before writing either adapter.

### 5a. Signatures — `src/engine/adapters/adapter.ts`

```ts
/** The adapter-facing request: `path` is a decoded NodePath, unlike the wire form. */
export interface ReadRequest {
  path: NodePath;
  projection: string[] | null;
  filter: string | null;
  sort: SortSpec | null;
  pageSize: number;              // already validated ≤ MAX_PAGE_SIZE at the port boundary
  cursor: PageCursor;
}
export interface CountRequest {
  path: NodePath;
  filter: string | null;
}

export interface Adapter {
  // ... the five P1 methods, unchanged ...

  /** One page of rows. Shape depends on caps.defaultPageKind; both SQL adapters return TabularPage. */
  read(req: ReadRequest, ctx: OpCtx): Promise<Page>;

  /** `exact` is false when the adapter can only estimate (caps.exactCount === false). */
  count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;
}
```

Add to the file's existing rule list:

> 7. **`read()` and `count()` obey the same identifier rule as the catalog code, via `quoteIdent` (D8).** Every identifier they emit came out of a catalog query in the same op. A projected column name that is not in that catalog result is `E_NOT_FOUND`, never quoted-and-hoped.
> 8. **A page is built with `createTabularPageBuilder` from `shared/protocol/page.ts`.** An adapter that hand-rolls the columnar layout will disagree with the renderer's decoder in some edge case; there is one codec.

### 5b. Statement construction — identical rules for both SQL adapters

Per `read()`, in order:

1. **Resolve the relation** (D10): from `req.path`, get the qualified name and the full `ColumnMeta[]` plus the primary key and the unique-index list, using the adapter's existing catalog functions. Postgres path shape is `database:d/schema:s/{table|view|matview}:t`; MariaDB's is `database:d/{table|view}:t` — each adapter validates its own shape and throws `E_NOT_FOUND` naming the path otherwise.
2. **Resolve the projection**: `null` → every column in ordinal order. Otherwise, map each requested name to a `ColumnMeta` (exact match, case-sensitive) and emit them in **ordinal order, not request order** — display order is a renderer concern (D12's normalisation depends on this). Unknown name → `E_NOT_FOUND`.
3. **Build the column descriptors**: `dataType` verbatim from the catalog, `typeClass` from the adapter's own type-name mapping, `isPrimaryKey` from the PK list.
4. **Compose**:
   ```
   SELECT <quoted projected columns>
     FROM <quoted qualified relation>
    [WHERE (<filter>)]                     -- verbatim, parenthesised (D9)
    [  AND <keyset predicate>]             -- only in after/before mode
    ORDER BY <effective order>
    LIMIT <pageSize + 1> [OFFSET <offset>]
   ```
   The `filter` is **always parenthesised** — `a = 1 OR b = 2` combined with a keyset predicate by bare `AND` would silently change the user's meaning.
5. **Bind everything that can be bound**: the keyset key values and `LIMIT`/`OFFSET` are parameters. Postgres: `LIMIT $1 OFFSET $2` with a `values` array (which is also what forces the extended protocol, D9). MariaDB: `LIMIT ? OFFSET ?` via `execute()` (the binary prepared protocol). **If MariaDB rejects a placeholder in `LIMIT`** on the server version in the fixture, fall back to inlining — but only after asserting `Number.isSafeInteger` and non-negative, and say so in a comment; these are app-generated integers, never user text.
6. **`ctx.setCommand(sql)` before issuing** (P1 rule 3), with the parameter values appended as a readable suffix so the op log shows the real statement (§8.11, §9.1's "command preview correctness").
7. **Read in string mode, array rows** (D3), fetch up to `pageSize + 1`, feed the first `pageSize` into the builder, set `hasMore` from whether the extra row arrived. In `before` mode, `reverse()` before `finish()`.
8. **`ctx.setRows(page.rowCount)`.**

`count()` is `SELECT count(*) [AS n] FROM <quoted qualified relation> [WHERE (<filter>)]`, returned as `{ value, exact: true }` for both engines (`caps.exactCount` is true for both). The value comes back as text in string mode — parse with `Number()` and reject a non-finite result rather than propagating `NaN` into the pager.

### 5c. Pagination (D7), precisely

Compute the **effective order** and the **keyset eligibility** together:

```
sort == null            -> terms = [], direction = 'asc'
sort.kind == 'text'     -> effective ORDER BY = the text verbatim; keyset INELIGIBLE
sort.kind=='structured' -> terms = sort.terms (columns validated against the catalog, like a projection)
                           eligible iff every term shares one direction
```

If eligible **and** the relation has a tiebreaker (primary key, else the first unique index whose columns are all `NOT NULL`), the effective order is `terms ++ (tiebreaker columns not already in terms)`, all in the shared direction; the keyset key is exactly that column list. If there is no tiebreaker, keyset is ineligible — a table with no unique key has no total order and paging it by keyset would silently skip or repeat rows.

- `cursor.mode === 'offset'` → no keyset predicate, `OFFSET n`, `position.offset = n`, `strategy: 'offset'`.
- `cursor.mode === 'after'` and eligible → predicate `(k1, k2, …) > ($a, $b, …)` for `asc`, `<` for `desc`; `position.offset = null`, `strategy: 'keyset'`.
- `cursor.mode === 'before'` and eligible → flip every direction in the `ORDER BY`, use the opposite comparison, then `reverse()` the builder.
- `cursor.mode === 'after' | 'before'` and **not** eligible → the adapter throws `E_UNSUPPORTED` with `keyset pagination is unavailable for this sort; the client must use an offset cursor`. The renderer never sends a keyset cursor when the last page reported `strategy: 'offset'`, so this is a contract violation, not a user-facing path.

**Tokens** are `base64url(JSON.stringify({ v: 1, k: string[], f: <fingerprint> }))` where `k` is the tiebreaker column values of the boundary row (as their server text, exactly as they came back) and `f` is a short hash of `{path, projection, filter, sort, pageSize}`. A token whose fingerprint does not match the current request is rejected with `E_QUERY` — applying page 40's cursor after the filter changed would return a page that is silently wrong, which is worse than an error. Bind the key values as parameters; both engines infer the parameter types from the row-value comparison against the column types.

### 5d. Type-class mapping

Each adapter owns a `typeClassFor(dataType: string): TypeClass` beside its catalog code:

- **Postgres**: `int2/int4/int8/numeric/decimal/float4/float8/money` → `number`; `bool` → `boolean`; `date/time/timetz/timestamp/timestamptz/interval` → `temporal`; `json/jsonb` → `json`; `bytea` → `binary`; everything else → `text`, except array types (`_`-prefixed / `[]`-suffixed) which are `other`.
- **MariaDB**: `tinyint/smallint/mediumint/int/bigint/decimal/float/double/bit` → `number` (with `tinyint(1)` → `boolean`, which is how MariaDB spells bool); `date/datetime/timestamp/time/year` → `temporal`; `json` → `json`; `binary/varbinary/*blob/geometry` → `binary`; `enum/set` → `text`; everything else → `text`.

`typeClass === 'number'` is what right-aligns a column (§8.5); `'binary'` is what makes the read path hex-encode instead of decoding UTF-8.

### 5e. `src/engine/adapters/sql-text.ts`

The genuinely shared, driver-agnostic ~80 lines both `read.ts` files call — kept out of the adapter folders because duplicating it would guarantee they drift:

```ts
export function buildOrderBy(terms: {column: string; direction: SortDirection}[], quote: (s: string) => string): string;
export function buildKeysetPredicate(columns: string[], direction: SortDirection, mode: 'after'|'before', firstParamIndex: number, placeholder: (i: number) => string): string;
export function encodePageToken(key: string[], fingerprint: string): string;
export function decodePageToken(token: string, expectedFingerprint: string): string[];   // throws E_QUERY on mismatch
export function requestFingerprint(parts: unknown): string;
export function hexPreview(bytes: Uint8Array): string;   // '0x…' for binary columns
```

`placeholder` is `(i) => '$' + i` for Postgres and `() => '?'` for MariaDB — the one dialect difference worth parameterising. Everything genuinely dialect-shaped (quoting, `LIMIT` syntax, catalog SQL) stays in the adapter folder, per §11's rule that a new engine is one new folder.

---

## 6. The cache tiers (normative)

### 6a. `engine/cache/lru.ts`

```ts
export interface ByteLruEntry<V> { value: V; bytes: number; at: number; }
export class ByteLru<V> {
  constructor(budgetBytes: number);
  get budgetBytes(): number;
  setBudget(bytes: number): void;         // evicts immediately if over
  get bytes(): number;
  get size(): number;
  get(key: string): V | undefined;        // touches
  set(key: string, value: V, bytes: number, meta: { connectionId: string; path: string; label: string }): void;
  deleteWhere(pred: (meta) => boolean): number;
  clear(): void;
  entries(): { key: string; bytes: number; at: number; meta }[];
}
```

- Insertion order is maintained with a `Map` (JS `Map` iterates in insertion order; `get` re-inserts to touch). No linked list, no library.
- `set` evicts from the oldest end until `bytes + incoming ≤ budget`. **An entry larger than half the budget is not cached at all** — one 40 MB page must not evict every other page in a 64 MB budget. Log at `warn` with the size, and return without storing.
- `setBudget` is called from `ENGINE_OP.configureCache`.

### 6b. `engine/cache/pages.ts` — L2 (D12)

Key derivation, the store, and hit/miss counters. Entries hold the **authoritative** `TabularPage`; `data.ts` sends a copy (D4).

```ts
export function pageCacheKey(req: ReadRequestWire): { key: string; label: string };
export function getPage(key: string): TabularPage | undefined;
export function putPage(key: string, label: string, req: ReadRequestWire, page: TabularPage): void;
export function pageStats(): { bytes: number; budgetBytes: number; entries: number; hits: number; misses: number };
```

`label` is the canonical JSON, kept for the stats listing and for debugging an unexpected miss; `key` is its SHA-1 (`node:crypto`).

### 6c. `engine/cache/counts.ts` — L3 (D13)

```ts
export interface CountEntry { value: number; exact: boolean; at: number; stale: boolean; }
export function getCount(connectionId: string, path: string, filter: string | null): CountEntry | undefined;
export function putCount(connectionId: string, path: string, filter: string | null, value: number, exact: boolean): void;
```

TTL is 5 minutes: an entry past it is returned with `stale: true` **and kept** (the pager greys the total and offers a refresh, §7 — it does not blank it). An entry past 30 minutes is dropped. There is no byte budget here; a count is three numbers, and the entry count is bounded by `dropTarget`/`dropConnection`.

### 6d. `engine/cache/index.ts` — the façade

```ts
export const cache = {
  configure(l2BudgetBytes: number): void;
  readPage(key: string): TabularPage | undefined;
  storePage(key, label, req, page): void;
  count(connectionId, path, filter): CountEntry | undefined;
  storeCount(connectionId, path, filter, value, exact): void;
  /** Refresh on one table: drops its pages and its counts. P5's mutation invalidation calls this. */
  dropTarget(connectionId: string, path: string): void;
  /** Disconnect and connection-delete (§2.2: disconnecting releases all its cached pages). */
  dropConnection(connectionId: string): void;
  clear(): void;                                   // the settings dialog's Clear caches (D15)
  stats(): CacheStats;
  onStatsChanged(cb: (stats: CacheStats) => void): void;   // throttled emitter for D16
};
```

The file's header comment records D11 (L1 is in main, deliberately) so nobody goes looking for it here.

---

## Step 1 — Shared contracts

**Files:** `src/shared/protocol/{page,data-ops}.ts` (new), `src/shared/domain/{tabs,queries}.ts` (new), `src/shared/domain/ops.ts` (mod), `src/shared/protocol/{ipc,engine-ops}.ts` (mod), `src/shared/settings.ts` (mod)

Write §4 verbatim as code. No behaviour, no imports from `main`/`engine`/`renderer`.

Two things in this step are easy to get subtly wrong and expensive to find later:

- **The codec's round trip.** Before moving on, drive `createTabularPageBuilder` from a scratch script over a hostile row set: `null`, `''`, `'a'`, a 4-byte emoji, a combining sequence, a string that lands exactly on `MAX_CELL_BYTES`, and one that straddles it mid-code-point. Assert `cellText` returns exactly what went in for every non-truncated cell, that `isNull` and `''` are distinguishable, that a truncated cell decodes without a U+FFFD at its tail, and that `pageByteSize` equals the sum of the three buffers' `byteLength` plus the envelope. Delete the scratch script before committing — Step 14's DB specs are the permanent version of this.
- **The `opKind` duplication** (§0 note 1). Grep for `'children'` across `src/shared` after the edit; there must be exactly one enum listing op kinds.

**Acceptance:** `bun run typecheck` passes with the new files imported by nothing; the scratch round-trip assertions hold; `bun run lint` green.

---

## Step 2 — Storage: migration, schema, repos, and the two new IPC domains

**Files:** `src/main/storage/migrations/0002_p2.sql` + `migrations/index.ts` (mod), `src/main/storage/schema/{tabs,saved-queries,filter-history}.ts`, `src/main/storage/repos/{tabs,saved-queries,filter-history}.ts`, `src/main/ipc/{tabs,queries}.ts`, `src/main/ipc/registry.ts` (mod), `src/renderer/bridge/control.ts` (mod), `src/preload/index.ts` (mod)

### 2a. `0002_p2.sql` (D19)

```sql
ALTER TABLE saved_queries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE TABLE filter_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  where_text TEXT,
  order_by_json TEXT,
  used_at TEXT NOT NULL
);

CREATE INDEX filter_history_target ON filter_history(connection_id, path, used_at);
```

Add `{ version: 2, name: '0002_p2', sql: m0002 }` to `migrations/index.ts`. Nothing else changes — `tabs` as P0 created it is sufficient (D17: `state_json` carries everything), and adding a column to it would be a migration with no consumer.

### 2b. Drizzle schema files

`schema/tabs.ts`, `schema/saved-queries.ts`, `schema/filter-history.ts`, one `sqliteTable()` each, mirroring the SQL exactly. `tabs.order` is the SQLite keyword `order` — the Drizzle property is `order: integer('order')` and Drizzle quotes it; verify against a generated statement, because an unquoted `order` is a syntax error at runtime, not at typecheck. Booleans (`active`, `pinned`) use `integer(..., { mode: 'boolean' })`, per P1 Step 13b.

### 2c. `repos/tabs.ts`

```ts
export async function listTabs(db: KiraDb): Promise<TabRecord[]>;      // ORDER BY "order"
export async function replaceTabs(db: KiraDb, tabs: TabRecord[]): Promise<void>;
```
`replaceTabs` is delete-all + insert in **one** `db.transaction` (the `filters.ts` pattern), rewriting `order` as the array index so the stored order is always dense. `listTabs` parses each row's `state_json` through `dataTabStateSchema` and **skips** (with a `warn`) any row that fails or whose `kind` is not in `RENDERABLE_TAB_KINDS` (D18) — one bad row must not cost the user every other tab. Remember P1 note 1: `replaceTabs` opens the transaction, so nothing it calls may open another.

### 2d. `repos/saved-queries.ts` and `repos/filter-history.ts`

```ts
listSavedFilters(db, connectionId, path): Promise<SavedQuery[]>   // pinned DESC, used_at DESC, name
saveFilter(db, input): Promise<SavedQuery>
updateSavedFilter(db, id, patch: { name?: string; pinned?: boolean }): Promise<SavedQuery>
deleteSavedFilter(db, id): Promise<void>
touchSavedFilter(db, id): Promise<void>                            // used_at = now

recordFilterUse(db, { connectionId, path, where, orderBy }): Promise<void>
listFilterHistory(db, connectionId, path, limit): Promise<FilterHistoryEntry[]>   // used_at DESC
```

`recordFilterUse` is the only interesting one: in one transaction, delete any existing row for the same `(connection_id, path, where_text, order_by_json)` triple (so re-applying a filter moves it to the top rather than duplicating it), insert the new row, then delete everything past the newest **20** for that `(connection_id, path)`. A no-op filter (`where` null **and** `orderBy` null) is not recorded — "I cleared the filter" is not history.

### 2e. IPC domains

`ipc/tabs.ts` and `ipc/queries.ts`, each following the established shape: parse the payload with a Zod schema (trust boundary), delegate to the repo, let `handle()` from `ipc/errors.ts` do the error folding. Two lines in `ipc/registry.ts`. Then the mechanical additions to `preload/index.ts` (`KiraApi` implementations) and `renderer/bridge/control.ts` (wrappers, remembering `plain()` for anything built from reactive state — a `TabRecord[]` from the tabs store is exactly that case, and forgetting it produces the "An object could not be cloned" error P1's comment warns about).

**Acceptance:** relaunch the app; `sqlite3 ~/.kira-studio/kira.sqlite 'select version from schema_version'` reports `2`; `pragma table_info(saved_queries)` shows `pinned`; `filter_history` exists. From devtools: `await window.kira.tabsSave({tabs:[…]})` then `tabsList()` round-trips, a second save replaces rather than appends, and deleting the connection cascades the rows away. `bun run test:ui` still green (nothing renders tabs yet).

---

## Step 3 — Engine: the L2/L3 cache tiers

**Files:** `src/engine/cache/{lru,pages,counts,index}.ts`, `src/shared/protocol/engine-ops.ts` (the `configureCache` op, from Step 1), `src/engine/control.ts` (mod: handle `configureCache`), `src/main/engine-config.ts`, `src/main/index.ts` + `src/main/ipc/settings.ts` (mod)

Write §6 as code. Then wire the budget:

- `src/main/engine-config.ts` exports `pushEngineConfig(engineHost, db)`: reads settings, calls `ENGINE_OP.configureCache` with `l2BudgetMb * 1024 * 1024`. Called once from `main/index.ts` after `startEngine()` **and** from `ipc/settings.ts` after a patch that changed `cache.l2BudgetMb`. Failures are logged, never thrown — a settings save must not fail because the engine is mid-restart.
- `control.ts` gains a `cache:configure` handler that calls `cache.configure(bytes)`. It runs **outside** `runOp` — it is not a database operation and has no business in the op log.

The cache is not observable from anywhere yet; that is fine. Its correctness is asserted directly:

**Acceptance:** a scratch script (deleted before committing) exercises `ByteLru` — insert entries summing past the budget and assert the oldest are evicted and `bytes` stays within it; assert an over-half-budget entry is refused and logged; assert `setBudget` to a smaller number evicts immediately; assert `deleteWhere` by `connectionId` removes exactly the matching entries; assert `stats()` counts hits and misses. `bun run lint && bun run typecheck` green.

---

## Step 4 — Engine: the data service and the port channel

**Files:** `src/engine/adapters/live.ts` (new), `src/engine/control.ts` (mod), `src/engine/scheduler/ops.ts` (mod), `src/engine/data.ts` (new), `src/engine/rpc.ts` (mod), `src/engine/index.ts` (mod), `src/renderer/bridge/{port,data}.ts`

### 4a. `adapters/live.ts` — extract the live-adapter map

```ts
export function setLiveAdapter(connectionId: string, adapter: Adapter): void;
export function getLiveAdapter(connectionId: string): Adapter | undefined;
export function deleteLiveAdapter(connectionId: string): void;
```
`control.ts` uses these instead of its local `Map`; `wireScheduler`'s `getAdapter` becomes `getLiveAdapter`; `data.ts` imports it directly. Pure extraction — no behaviour change, and it is what keeps `data.ts` from importing `control.ts` and forming a cycle (P1 rule 6's ownership statement moves from "control.ts owns the map" to "live.ts owns the map, control.ts owns its lifecycle").

Also in `control.ts`: `handleDisconnect` calls `cache.dropConnection(connectionId)` after the adapter closes (§2.2: "Disconnecting a connection releases its driver state and all its cached pages"). `handleConnect`'s reconnect path (disconnect-then-connect) inherits this for free.

### 4b. `scheduler/ops.ts` (D2)

```ts
export async function runOp<T>(
  spec: { connectionId: string | null; kind: OpKind; opId?: string; tabId?: string | null },
  fn: (ctx: RunOpCtx) => Promise<T>,
): Promise<{ opId: string; value: T }>
```
- `spec.opId ?? crypto.randomUUID()`. If the supplied id is already in `running`, throw `AdapterError('E_QUERY', 'duplicate operation id')` **before** emitting `op:start` — otherwise a duplicate id would corrupt the op log's primary key and cancel the wrong op.
- `spec.tabId ?? null` rides in the `op:start` event.
- Nothing else changes. `cancelOp` already looks the op up by id and forwards to the adapter, so the stop button works for reads with no further change (D5 was P1's).

`main/oplog.ts` takes `tabId` from the parsed event instead of hardcoding `null`.

### 4c. `engine/data.ts`

```ts
export async function handleRead(payload: unknown): Promise<{ response: ReadResponse; page: TabularPage }>;
export async function handleCount(payload: unknown): Promise<CountResponse>;
export async function handlePrefetch(payload: unknown): Promise<PrefetchResponse>;
```

`handleRead`, step by step — this is the phase's hot path, so it is written out:

1. Parse with the Zod wire schema.
2. `const { key, label } = pageCacheKey(req)`. `cache.readPage(key)` — on a hit, return it with `source: 'cache'` and **no** `runOp` (a cache hit is not a database operation and must not appear in the op log; P1's tree spec established exactly this contract and P2's specs assert it again).
3. On a miss: `getLiveAdapter(req.connectionId)`, `E_NOT_FOUND` if absent (the renderer turns that into the tab's *Reconnect & load* affordance).
4. `runOp({ connectionId, kind: 'read', opId: req.opId, tabId: req.tabId }, ctx => adapter.read({ ...req, path: decodePath(connectionId, req.path) }, ctx))`.
5. Switch on `page.kind` (D5). For `'tabular'`: `cache.storePage(key, label, req, page)`, then return.
6. The **copy for the wire** is made by the caller in `rpc.ts`, not here — `data.ts` returns the authoritative page and `rpc.ts` clones it. Keeping the clone at the transport boundary is what makes it impossible to accidentally hand the cached original to `postMessage` (D4).

`handleCount`: L3 lookup first; a fresh entry returns `source: 'cache'`; a stale one is returned **and** a refresh is not triggered automatically (§7: counts are computed on explicit request only). A miss runs `runOp({kind:'count'})`, stores, returns.

`handlePrefetch` (D14): compute the key; if resident, return `{ warmed: false, bytes: 0 }` immediately. Otherwise run exactly `handleRead`'s miss path and return `{ warmed: true, bytes: page.byteSize }` — never the page.

### 4d. `engine/rpc.ts` and `engine/index.ts`

`dispatch` becomes:
```ts
export async function dispatch(request: PortRequest): Promise<{ response: PortResponse; transfer?: unknown[] }>
```
with handlers for `DATA_OP.read`, `.count`, `.prefetch`, `.cacheStats`, `.cacheClear`, plus the existing `ping`. `engine/index.ts`'s `handleRequest` posts `port.postMessage(response, transfer)` when a transfer list is present.

**The clone (D4).** In the `read` handler, produce the wire page with a `clonePageForTransfer(page)` helper (in `rpc.ts`, not in `page.ts` — it is a transport concern): a new `TabularPage` whose chunks hold `new Uint8Array(chunk.data)` / `new Uint32Array(chunk.offsets)` / etc., each backed by a fresh exactly-sized buffer. **Before writing the `postMessage` call, open `node_modules/electron/electron.d.ts` and read `MessagePortMain.postMessage`'s signature.** If its transfer parameter is `MessagePortMain[]`, pass no transfer list and let structured clone copy — and put a one-line comment recording what the typings said and the date, so the next person does not re-litigate it. If it accepts `ArrayBuffer`, pass the chunks' buffers.

The engine also emits `{kind:'evt', topic:'cache:stats', payload}` over the active port from `cache.onStatsChanged` (D16). `engine/index.ts` holds the active port already; give it a small `emitPortEvent(topic, payload)` used by the subscription, and make it a no-op when no port is attached (the engine outlives a renderer reload).

### 4e. `renderer/bridge/port.ts` and `renderer/bridge/data.ts`

`port.ts`:
- `request(op, payload, opts?: { timeoutMs?: number | null })`, default 30 s, `null` = no timeout (D25).
- Handle `{kind:'evt'}` frames: `onPortEvent(topic, cb): () => void`.
- Reject pending requests with a legible error when a **new** port is attached (a renderer reload or an engine restart re-attaches; the old requests will never answer).
- Reconstruct typed arrays defensively: after structured clone they arrive as real typed arrays, but validate the structural invariants from §4a and throw on a mismatch rather than letting a malformed page reach the grid.

`data.ts` — the typed client, the only thing views call:
```ts
export const data = {
  read(req: ReadRequestWire): Promise<ReadResponse>;
  count(req: CountRequestWire): Promise<CountResponse>;
  prefetch(req: ReadRequestWire): Promise<PrefetchResponse>;
  clearCaches(): Promise<void>;
  cacheStats(): Promise<CacheStats>;
  onCacheStats(cb: (s: CacheStats) => void): () => void;
};
```
Errors surface as an `Error` carrying `code` (the port envelope has a real `code` field — §0 note 16), so the grid can branch on `E_CANCELLED` vs `E_NOT_FOUND` vs `E_QUERY` without string sniffing.

**Acceptance:** deferred to Step 5 for the real path. For now, `ping` still works, `bun run test:ui` is green, and killing the engine mid-`ping` produces a legible rejection rather than a hang.

---

## Step 5 — PostgreSQL `read()` and `count()`

**Files:** `src/engine/adapters/adapter.ts` (mod), `src/engine/adapters/sql-text.ts` (new), `src/engine/adapters/postgres/read.ts` (new), `src/engine/adapters/postgres/catalog.ts` (mod), `src/engine/adapters/postgres/index.ts` (mod), `src/engine/adapters/registry.ts` (unchanged)

Write §5a's signatures, §5e's helpers, then the Postgres implementation.

`catalog.ts` gains one function, because the read path needs three facts in one shot and the existing `describe` helpers return more than it needs:

```ts
export interface ReadTarget {
  oid: number;
  qualifiedName: { schema: string; relation: string };
  columns: ColumnMeta[];
  primaryKey: string[] | null;
  /** Unique indexes whose columns are all NOT NULL — keyset tiebreaker candidates (D7). */
  uniqueKeys: string[][];
}
export function getReadTarget(exec: QueryExecutor, schema: string, relation: string): Promise<ReadTarget>;
```
Built from the existing `getRelationInfo` / `listColumns` / `listIndexes` queries, run **sequentially** on the one client (P1's comment in `index.ts` explains why: node-postgres has deprecated concurrent queries on a single `Client`).

`read.ts`:
- `quoteIdent` per D8.
- The query is issued through the existing `runQuery` helper (so it is cancellable, tracked for `pg_cancel_backend`, and `setCommand`-logged) but with a **query config object** rather than a bare string, because the read needs `rowMode: 'array'` and identity type parsers:
  ```ts
  client.query({ text, values, rowMode: 'array', types: { getTypeParser: () => (v: string) => v } })
  ```
  `runQuery` currently takes `(client, sql, params, ctx, track)`. Extend it with an optional 6th argument `{ rowMode?: 'array'; textMode?: boolean }` rather than writing a second helper — the cancellation, tracking and error-mapping logic must not be duplicated, and duplicating it is how one of the two paths ends up uncancellable. Keep the existing call sites working unchanged.
- **Verify** `types.getTypeParser` is honoured per-query in the installed `pg` version (read `node_modules/pg/lib/query.js` or the typings; it is passed into the `Result`). If it is not, fall back to `pg.types.setTypeParser` scoped by constructing the `Client` with a custom `types` in `client.ts` — but only for the read path's client, and say so in a comment. Do **not** fall back to stringifying parsed values: `numeric` → JS number is lossy and D3 exists to prevent exactly that.
- `bytea` arrives in text mode as `\x…`; convert to `0x…` via `hexPreview` semantics so the grid and P3 see one binary convention. A `bytea` beyond `MAX_CELL_BYTES` is truncated by the builder like any other cell.
- `count()` per §5b.
- `index.ts` delegates `read`/`count` to the new module, exactly as it delegates catalog work today.

**Acceptance:** deferred to Step 14's DB specs for the assertions that matter. Before moving on, drive it by hand: `bun run dev`, connect to a local Postgres, and from devtools call `window.kira`-adjacent plumbing is not wired yet — instead add a temporary scratch spec under `tests/db/` that starts the fixture, connects the adapter, and reads page 1 and page 2 of `app.big_rows` both ways (offset and keyset), printing `position`. Fold that scratch into `postgres.spec.ts` properly in Step 14 rather than deleting it.

---

## Step 6 — MariaDB adapter

**Files:** `src/engine/adapters/mariadb/{caps,client,query,catalog,read,index}.ts`, `src/engine/adapters/registry.ts` (mod), `src/renderer/project/ConnectionDialog.vue` (mod: enable the MariaDB option, default port 3306)
**Deps:** `bun add mariadb` (→ `dependencies`, §0 note 17)

This step must not touch `scheduler/`, `cache/`, `data.ts` or any renderer file beyond the dialog option (D27). If it seems to need to, stop and report why.

### 6a. `caps.ts`

```ts
export const mariadbCaps: Caps = {
  tabular: true, documents: false, keyValue: false, stream: false,
  defaultPageKind: 'tabular',
  sql: true, ddl: true,
  projection: true, serverFilter: true, exactCount: true, pagination: 'keyset',
  foreignKeys: true, writable: true, transactions: true,
  cancel: true,
};
```
Identical to Postgres's, which is the point: §5.1's two SQL rows differ only in mechanism, and `caps.ddl: true` is a statement about what MariaDB *can* do — `ddl()` itself is P4's.

### 6b. `client.ts` (D26)

Mirror `postgres/client.ts` structurally:
- `buildConnectionOptions(cfg, { database, log })`: fields mode → `{ host, port, user, password, database }`; URI mode → the connection string. **Verify** whether the installed `mariadb` connector accepts a `mariadb://`/`mysql://` connection string in `createConnection`; if it does not, parse with `shared/domain/uri.ts`'s `parseConnectionUri` and map to fields, and record that in a comment. Always set: `connectTimeout: 10_000`, `multipleStatements: false` (explicitly, even though it is the default — D9 depends on it and an explicit line is what stops someone flipping it), `allowPublicKeyRetrieval: false`, `metaAsArray: false`, `trace: false`, and a `connectAttributes: { program_name: 'kira-studio' }` so the app is identifiable in `SHOW PROCESSLIST` the way `application_name` makes it identifiable in Postgres (the DB specs assert on it).
- `options.ssl` handling that mirrors the `sslmode` mapping, with unknown values warned and ignored, never silently dropped.
- `class ConnectionSet` with `get(database | null)`, `primary()`, `closeAll()`, `MAX_CONNECTIONS = 8` and LRU eviction of non-primary connections. Record `connection.threadId` when a connection is created — that is what `cancel()` needs.

### 6c. `query.ts`

The mirror of `postgres/query.ts`, and the same warning belongs in it: the `AbortSignal` listener only unblocks *us*; the server-side kill is `adapter.cancel()`'s job and both run.

- `mapMariaError(err)`: `err.errno === 1045` or `err.code === 'ER_ACCESS_DENIED_ERROR'` → `E_AUTH`; `1317` / `'ER_QUERY_INTERRUPTED'` → `E_CANCELLED`; `'ECONNREFUSED' | 'ENOTFOUND' | 'ETIMEDOUT' | 'ER_GET_CONNECTION_TIMEOUT'` → `E_CONNECT`; everything else → `E_QUERY` with the server's message **verbatim**.
- `runQuery(conn, sql, params, ctx, track, opts?)` with the same shape as the Postgres helper, `opts` selecting `rowsAsArray` and the string-mode `typeCast`.
- **String mode** (D3): pass `typeCast: (column, next) => { … }` returning `column.string()` for everything except binary-ish column types (`BLOB`, `TINY_BLOB`, `MEDIUM_BLOB`, `LONG_BLOB`, `GEOMETRY`, `BIT`, and `VAR_STRING`/`STRING` whose charset is binary) which return a hex string built from `column.buffer()`. `column.string()` on a binary column decodes as UTF-8 and mangles the bytes — this is the MariaDB equivalent of Postgres's `bytea` handling, and getting it wrong shows up as U+FFFD soup in the grid, not as an error.
- Use `conn.execute()` (binary prepared protocol) for the read path so `LIMIT ?`/`OFFSET ?` bind, and `conn.query()` for catalog statements that have no parameters. Both go through the same helper.

### 6d. `catalog.ts` — MariaDB's tree levels (§5.1: database → tables/views/routines → column)

There is **no schema level**: a path is `database:d`, then `database:d/table:t`, then `database:d/table:t/column:c`. Each catalog function binds names as parameters against `information_schema`; no identifier interpolation (P1's standing rule is unchanged for catalog work).

- **Databases** (root): `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY SCHEMA_NAME`. `hasChildren: true`; the connected database gets `detail: 'connected'`, mirroring the Postgres adapter.
- **Tables / views / sequences** in a database: `information_schema.TABLES` filtered by `TABLE_SCHEMA`, selecting `TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT`. Map `'BASE TABLE'` → `table`, `'VIEW'` → `view`, `'SEQUENCE'` → `sequence` (MariaDB ≥ 10.3; if the server reports sequences as base tables, they simply appear as tables — do not special-case it). There is **no** `matview` in MariaDB; that `NodeKind` member is simply never emitted here.
  `detail` for a table = `~N rows` from `TABLE_ROWS` when non-null. Note in a comment that `TABLE_ROWS` is an InnoDB estimate and can be far off — it is a hint in the tree, and §8.5's Σ *count all* is the exact answer.
- **Routines**, appended after the relations at the same level: `SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?`. Both `FUNCTION` and `PROCEDURE` map to `NodeKind` `function` — the same collapse the Postgres adapter already does for `prokind IN ('f','p')`, so no `NodeKind` change is needed. `detail` = the return type for a function, `'procedure'` for a procedure. `hasChildren: false`.
- **Columns**: `information_schema.COLUMNS` by `(TABLE_SCHEMA, TABLE_NAME)` ordered by `ORDINAL_POSITION`, selecting `COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, COLUMN_KEY`. Use **`COLUMN_TYPE`**, not `DATA_TYPE` — `varchar(50)` is what the user wants to see, `varchar` is not.
- **Indexes**: `information_schema.STATISTICS`, grouped by `INDEX_NAME`, columns ordered by `SEQ_IN_INDEX`; `unique = NON_UNIQUE === 0`; `primary = INDEX_NAME === 'PRIMARY'`; `method = INDEX_TYPE`. The primary key is the `PRIMARY` index's columns, or `null`.
- **Foreign keys** and **`referencedBy`** (P1 D17): join `information_schema.KEY_COLUMN_USAGE` (for the column pairs, ordered by `ORDINAL_POSITION`) with `information_schema.REFERENTIAL_CONSTRAINTS` (for `DELETE_RULE`/`UPDATE_RULE`), filtered by `TABLE_SCHEMA/TABLE_NAME` for outbound and by `REFERENCED_TABLE_SCHEMA/REFERENCED_TABLE_NAME` for inbound. `referencedPath` is `encodePath([{kind:'database',name:refSchema},{kind:'table',name:refTable}])` — note the two-segment shape, unlike Postgres's three.
- `getReadTarget` mirrors §5's Postgres version.

### 6e. `index.ts`

Same structure as the Postgres adapter: `connect` runs `SELECT VERSION() AS version, DATABASE() AS \`database\`, @@character_set_server AS charset` and returns `{ serverVersion: 'MariaDB ' + version, details: { database, charset } }`; `disconnect` closes the set; `children`/`describe` switch on path depth (**2 levels shallower than Postgres** at the relation level — this is the assertion that the tree code is genuinely path-driven and not Postgres-shaped); `read`/`count` delegate to `read.ts`; `cancel(opId)` looks up the tracked `threadId`, opens a **short-lived side connection** with the same options, runs `KILL QUERY <threadId>` and closes it, returning whether it succeeded.

Two notes for `cancel`: the thread id is an app-generated integer from the driver, so interpolating it is not an identifier-rule violation (assert `Number.isSafeInteger` anyway); and killing your **own** query needs no `PROCESS`/`SUPER` privilege, which is why the fixture can run the adapter as a non-root user and still pass the server-side cancellation assertion.

Finally: one line in `adapters/registry.ts`, and in `ConnectionDialog.vue` remove the `disabled` from the MariaDB option and default its port to 3306 (the dialog already defaults 5432 for Postgres; make the default port kind-driven rather than adding a second hardcoded number).

**Acceptance:** deferred to Step 14. Interim: `createAdapter('mariadb', deps)` no longer throws `E_UNSUPPORTED`, and a manual `bun run dev` against a locally running MariaDB expands database → table → columns in the tree.

---

## Step 7 — Renderer: tabs

**Files:** `src/renderer/state/tabs.ts`, `src/renderer/workbench/panels/TabStrip.vue`, `src/renderer/workbench/panels/{Toolbar,MainView}.vue`, `src/renderer/workbench/WorkbenchShell.vue` (mod), `src/renderer/project/state/tree.ts` (mod: `revealPath`), `src/renderer/main.ts` (mod: hydrate tabs)

### 7a. `renderer/state/tabs.ts` (D17)

Cross-view state, so it lives in `renderer/state/` next to `connections.ts` and `ops.ts`.

```ts
export const tabsState = reactive({
  tabs: [] as TabRecord[],          // ordered
  activeId: null as string | null,
  /** In-memory only: a restored tab has not loaded and shows "Reconnect & load" (§8.4). */
  hydrated: new Set<string>(),
});

export async function hydrateTabs(): Promise<void>;              // awaited in main.ts
export function openDataTab(connectionId: string, path: string, opts?: { newTab?: boolean }): string;
export function duplicateTab(id: string): string;
export function closeTab(id: string): void;
export function closeOthers(id: string): void;
export function closeToTheRight(id: string): void;
export function closeAll(): void;
export function activateTab(id: string): void;
export function patchTabState(id: string, patch: Partial<DataTabState>): void;
export const activeTab = computed<TabRecord | null>(...);
```

- **`openDataTab` without `newTab`** activates an existing *unpinned-equivalent* tab for the same `(connectionId, path)` if one exists, else creates one — that is §8.10's "Open data" vs "Open data in new tab". Identity is still `id`, never `path` (§8.4): "Open data in new tab" always creates, so the same table can be open N times with independent state, and nothing anywhere may key a map by path.
- **`closeTab` frees the page** for that tab (`pageStore.drop(id)` from Step 8) — §2.2: "Result pages are held only for tabs that are open; closing a tab frees its pages immediately." This is the only place that happens, and Step 15's perf spec asserts it.
- **Persistence** (D17): a `save()` that calls `control.tabsSave(plain(tabsState.tabs))`. Structural changes call it immediately; `patchTabState` calls a 1 s debounced version. `plain()` matters here (§0 / P1's bridge comment).
- **Restore**: `hydrateTabs` loads, sets `activeId` from the `active` row (or the first tab), and leaves `hydrated` **empty** — every restored tab shows *Reconnect & load*. Restoring does **not** connect anything.

### 7b. `TabStrip.vue` (§8.4, §8.12)

Replaces the empty state. A horizontally scrollable row of tabs; each tab shows a kind icon, the title (`tabTitle`), a close `×` on hover/active, and a **3 px top border in `var(--kira-conn-<color>)`** resolved from `connectionsState.records` — the connection colour on the tab (§8.12's second of three places). The active tab gets `--kira-bg` against the strip's `--kira-bg-chrome`, VS Code style. Middle-click closes. `data-testid="tab"`, `data-tab-id`, `data-active`, `data-color`.

Right-click opens the **Tab menu** (D22, §8.10) through the existing service: `Close · Close others · Close to the right · Close all · — · Duplicate tab · Copy name · Reveal in project panel`. *Duplicate tab* is `duplicateTab` (same target, fresh default state — the cheapest possible demonstration of §8.4's identity rule). *Reveal in project panel* calls `revealPath(connectionId, path)` on the tree state: expand every ancestor path in order (awaiting each, sequentially — the same discipline `refreshExpanded` already uses), select the row, and scroll it into view. Add a `scrollToIndex` to `VirtualList.vue` via `defineExpose` for the last part — that is the one change this step makes to it, and it adds no behaviour to existing callers.

When there are no tabs, keep an `EmptyState`.

### 7c. `Toolbar.vue` and `MainView.vue` (D21)

- `Toolbar.vue` renders nothing when there is no active tab; for a `data` tab it renders `DataToolbar` + `FilterToolbar` stacked (Steps 9–10; for now, placeholders that Step 9 fills). Its root carries the connection tint: a subtle `border-left: 3px solid var(--kira-conn-<color>)` plus a 6 %-alpha wash of the same token — enough to read at a glance without fighting the Dark Modern palette.
- `MainView.vue` renders the active tab's body: `DataView` for `data`, the existing `EmptyState` when there is no tab. No branch for other kinds (D18).
- `WorkbenchShell.vue`: the `.toolbar` rule's fixed `height: 32px` becomes `flex-shrink: 0` with content-driven height, and the `tab-strip` keeps its 32 px. Nothing else in the grid template changes.

**Acceptance:** with a Postgres connection in the tree, `window.kira`-free UI actions: opening a tab from the (Step 13) menu is not available yet, so drive it from devtools via `openDataTab` exposure — instead, temporarily wire double-click on a table row to `openDataTab` and keep it (it is good behaviour and §8.10's "Open data" is the same action). Assert: two tabs for the same table coexist with independent titles; closing, close-others and close-to-the-right behave; the tab strip is tinted per connection; relaunching restores the tabs, none of them connected, each showing *Reconnect & load*; `sqlite3` shows the rows with dense `"order"` values.

---


## Step 8 — Renderer: the grid

**Files:** `src/renderer/views/grid/{page,columns,state}.ts`, `src/renderer/views/grid/{DataView,DataGrid}.vue`

This is the step §2.1 is about. Read the whole step before writing any of it.

### 8a. `page.ts` — the non-reactive page store (D3, §2.1)

```ts
/** Plain module state. NOT reactive — a Proxy around 600 000 cells is the frame budget. */
export function setPage(tabId: string, page: TabularPage): void;
export function getPage(tabId: string): TabularPage | null;
export function drop(tabId: string): void;              // called by closeTab (§2.2)
export function totalRetainedBytes(): number;           // Step 15's leak assertion reads this

/** Bumped whenever a tab's page is replaced. Components watch this, not the page. */
export const pageVersion = reactive({ n: 0 });

export function cell(tabId: string, row: number, col: number): { text: string; isNull: boolean; truncated: boolean };
```

- `cell()` decodes on demand through one module-level `TextDecoder`, with a small **decoded-string cache keyed by the visible window** (a `Map<number, string>` per column, cleared whenever the window moves off it or the page is replaced). Only visible cells are ever decoded — decoding a whole page up front would rebuild exactly the per-row JS objects D3 exists to avoid.
- The page object handed to `setPage` is `Object.freeze`d at the top level as a tripwire: any code that tries to mutate it fails loudly in dev instead of silently diverging from `byteSize`.
- Components re-render off `pageVersion.n`; a page swap is one reactive write, not 600 000.

### 8b. `columns.ts`

- `initialWidths(page)`: measure with a `CanvasRenderingContext2D.measureText` under the app font (read `--kira-font-family` / `--kira-font-size` off the root once), taking the wider of the header and a sample of the first 50 rows, clamped to `[64, 480]` px. Widths are per-column and persisted in the tab state.
- `visibleColumnRange(scrollLeft, viewportWidth, widths, order)`: prefix-sum lookup for column windowing. Recompute the prefix sums only when widths or order change, not per frame.
- `alignmentFor(descriptor)`: `right` for `typeClass === 'number'`, `left` otherwise (§8.5's "type-aware right-alignment for numerics").
- Column **reorder** is display-only and lives in `DataTabState.columnOrder`; it never changes the request (D12's normalisation depends on the projection being a set).

### 8c. `state.ts` — the per-tab data-view state machine

```ts
export interface DataViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null;                       // the in-flight op, for the stop button (D2)
  count: { value: number; exact: boolean; stale: boolean } | null;
  meta: ObjectMeta | null;                   // from kira:tree:describe (L1) — the projection menu
  lastStrategy: 'keyset' | 'offset';
  nextToken: string | null;
  prevToken: string | null;
  hasMore: boolean;
  selection: Selection | null;
  searchOpen: boolean;
}
export const runtime = reactive({} as Record<string, DataViewRuntime>);

export async function load(tabId: string, cursor?: PageCursor): Promise<void>;
export async function reload(tabId: string): Promise<void>;         // ↻: dropTarget then load
export async function runCount(tabId: string): Promise<void>;       // Σ
export function stop(tabId: string): void;                          // ⏹ → control.opsCancel(opId)
export function goFirst / goPrev / goNext / goLast / goToPage(tabId, n): Promise<void>;
export function setPageSize / setProjection / setFilter / setSort(...): Promise<void>;
```

Rules the machine must hold to:

- **Every state-changing control resets paging to page 0** except the pager itself (§8.5: "The predicate and the sort are pushed server-side and reset paging"). Page size changes reset too — page 40 at 100 rows is not page 40 at 10 000.
- **Cursor choice** (D7): ▶ uses `{mode:'after', token: nextToken}` when `nextToken` is non-null, else `{mode:'offset', offset:(pageIndex+1)*pageSize}`. ◀ mirrors it with `prevToken`. ⏮ is always offset 0. ⏭ requires a count and is offset `(pageCount-1)*pageSize`. Jump-to-page is offset. Never send a keyset cursor when the previous page reported `strategy: 'offset'`.
- **`meta`** comes from `control.treeDescribe(connectionId, path)` — L1, main-side, free after the first call. It feeds the projection menu and the column list; it is **not** what builds the SQL (D10).
- **Cancellation** sets `status: 'cancelled'` and **keeps the previously rendered page** — a stop button that blanks the grid is a worse outcome than the query the user stopped.
- **`E_NOT_FOUND` / `E_DISCONNECTED`** flips the tab back to the *Reconnect & load* affordance rather than showing a red error, matching the restored-tab path (one component, two entry points).
- Loading a page writes `tabsState` (`pageIndex`) through `patchTabState`, which is what makes the pager position survive a relaunch.

### 8d. `DataGrid.vue` — two-axis virtualization

- **Structure:** a sticky header row, a sticky row-number gutter, and a scroll container whose inner sizer is `totalWidth × rowCount * rowHeight`. Visible rows and visible columns are computed from `scrollTop`/`scrollLeft`; only their intersection is in the DOM (§2.1: "No DOM node per cell for off-screen rows").
- **Rows are absolutely positioned** with `transform: translateY(...)` off a single container transform rather than per-row `top` — one style write per frame instead of N.
- **Scroll handling is passive** and does not `await` anything. The render pass reads `page.ts` imperatively.
- **`rowHeight`** comes from `--kira-row-height` (density setting), read once on mount and on settings change.
- **`NULL` renders as a muted italic `NULL`**; an empty string renders as nothing. They must be visually distinct (§8.5) and the spec asserts it.
- **Truncated cells** render their text plus a muted `…` with a `title` of *"value truncated at 64 KB"*.
- **Column resize**: a 4 px drag handle on each header edge, writing `columnWidths`. **Column reorder**: header drag with a drop indicator, writing `columnOrder`. Both are display-only and debounce into the tab state.
- **Header click sorts** (D6): asc → desc → none, cycling; the header shows a chevron; the equivalent text is mirrored into the `ORDER BY` box.
- **Selection** (D23): click a cell; shift-click extends a rectangular range; click a row number selects the row; click a header selects the column; ⌘/ctrl-click adds a disjoint cell. Arrow keys move, shift+arrows extend. The selection is exposed as `runtime.selection` for P3 to read and for the spec to assert. **Nothing writes to the clipboard.**
- **`data-testid`s**: `data-grid`, `grid-header-cell` (`data-column`), `grid-row` (`data-row`), `grid-cell` (`data-row`, `data-column`, `data-null`), `grid-gutter-cell`.
- Empty result: a centred *"No rows"* — not the shared `EmptyState`, which is panel-shaped.

### 8e. `DataView.vue`

Hosts the grid, the loading overlay (a thin indeterminate bar at the top of the view — never a spinner that replaces the previous page), the error strip (server text verbatim, §8.5), the *Reconnect & load* centred button for an unhydrated or disconnected tab (§8.4), and the floating `SearchToolbar` (Step 11).

**Acceptance:** open `app.big_rows` (1 M rows) from the tree; the first 100 rows render; scrolling to the bottom of the page is smooth and the DOM node count stays roughly constant (assert with `document.querySelectorAll('.grid-cell').length` before and after scrolling); `NULL` and `''` in `nulls_and_unicode` render differently; emoji/CJK/RTL render correctly; the 1 MB text cell shows truncated with the marker; numeric columns are right-aligned; resizing and reordering columns survives a tab switch.

---

## Step 9 — Renderer: the data toolbar

**Files:** `src/renderer/views/grid/{DataToolbar,ColumnsMenu}.vue`, `src/renderer/workbench/panels/Toolbar.vue` (mod)

§8.5's first row, left to right, with nothing added and nothing left out:

`↻ refresh` · `⏮ ◀ page N of M ▶ ⏭` · `rows [10|100|1k|10k]` · `Σ count all` · `columns ▾` · `+ row` · `− row` · `⌘ preview command` · `🔍 search` · `⏹ stop`

- **`↻ refresh`** → `reload`: `data:invalidate({ connectionId, path })` (§4b), which calls `cache.dropTarget` and so clears both this table's pages and its count, then a normal `load()`. A dedicated op rather than a `refresh` flag on `data:read`, so the invalidation surface is one function that P5's mutation path can call for the same reason (D13).
- **Pager**: `page N` always; `of M` only once a count exists (§8.5: "until then the pager shows `page N` with no total"). `N` is an editable number input when `M` is known, else static text. ⏭ is `disabled` without a count, with a `title` saying *"Count rows first"*. The pager root carries `data-pagination="keyset|offset"` (D7).
- **Row sizes**: a four-way segmented control; the default comes from `settings.data.defaultPageSize`.
- **`Σ count all`**: `runCount`. While running it shows a spinner; when done it shows the number, and a **stale** count (L3 TTL, D13) renders greyed with a small refresh affordance rather than disappearing (§7).
- **`columns ▾`** → `ColumnsMenu.vue`: a checkbox list of `meta.columns` with *All* / *None*, applying on close. Because `caps.projection` is true for both engines, the menu's footer reads *"Applied server-side"*; the branch that would say otherwise exists because §8.5 requires the toolbar to say which, and a future adapter with `projection: false` will take it — write the conditional, driven by the connection's caps, not a hardcoded string. (The renderer needs caps: add them to `ConnectionState` — the engine already returns `ConnectInfo` on connect; extend the connected state with `caps` so the renderer can branch. This is a small, honest addition to `shared/domain/connection.ts` and `main/connections.ts`.)
- **`+ row`, `− row`, `⌘ preview command`**: **rendered and permanently `disabled`**, with `title="Available in a later version"`. This is a deliberate exception to P1 Step 9b's "omit rather than grey out" rule and the reason is different here: §8.5 specifies this toolbar as an ordered row, and omitting three of its ten controls would make the toolbar's shape change under the user in P5. A greyed control in a specified toolbar row communicates the product's shape (the same argument P0 used for the disabled settings sections); a greyed *menu item* communicates nothing, which is why P1 omitted those. Do not wire them to anything.
- **`🔍 search`** toggles `runtime.searchOpen`.
- **`⏹ stop`** is enabled only while `runtime.opId` is non-null; it calls `control.opsCancel(opId)` — the P1 channel, unchanged (D5 was P1's; P2 only consumes it).

**Acceptance:** all pager controls move through a 1 M-row table with page sizes 10/100/1k/10k; `data-pagination` reads `keyset` for ▶ on an unsorted table and `offset` after a free-text `ORDER BY`; Σ fills in `of M`; projection reduces the columns and the reduced query is visible in the operations panel; ⏹ cancels a `SELECT` over `big_rows` with no `WHERE` at 10 000 rows and the op-log row flips to `cancelled`.

---

## Step 10 — Renderer: the filter toolbar, history and saved filters

**Files:** `src/renderer/views/grid/{FilterToolbar,FilterHistoryMenu}.vue`

§8.5's second row: `🕘 history` · `WHERE …` · ———— · right-aligned `ORDER BY …`

- Both inputs are single-line, monospace, and apply on **Enter** or blur (not per keystroke — every apply is a server round trip). Escape reverts to the applied value. A cleared input means "no predicate", not an empty predicate.
- Applying either one resets paging to page 0 and records history (`kira:queries:historyRecord`) unless both are empty (D19/2d).
- **Invalid input is reported by the server, unmodified** (§8.5): the error strip shows the message verbatim, the previous page stays on screen, and the input keeps the user's text so they can fix it. Do not pre-validate the fragment; do not prepend "Invalid filter:".
- The `ORDER BY` box is D6's second editor: typing in it sets `sort = { kind: 'text' }` and clears the header chevrons; a header click sets `{ kind: 'structured' }` and writes the equivalent string into the box. The box shows a small muted marker when the current sort is structured, so it is obvious which editor last won.
- **`🕘 history`** opens `FilterHistoryMenu.vue`: a two-section popover — **Saved** (pinned first, each row with its name, a pin toggle, a rename affordance and a delete) then **Recent** (the last 20, rendered as `WHERE … / ORDER BY …` one-liners). Selecting an entry applies it and, for a saved one, calls `kira:queries:touch`. A *"Save current filter…"* footer action prompts for a name and calls `kira:queries:save`. `data-testid="filter-history"`, per-row `data-testid="history-entry"` / `saved-entry`.
- Saved filters and history are scoped to `(connectionId, path)`, so two tabs on the same table share them and two tabs on different tables do not.

**Acceptance:** a `WHERE` narrows the result and the op log shows the predicate embedded in the real statement; an invalid predicate shows the server's own message and leaves the grid intact; `ORDER BY name DESC` reorders and flips `data-pagination` to `offset`; applying a filter twice yields one history entry, not two; a saved filter survives a relaunch; a pinned one sorts above the rest.

---

## Step 11 — Renderer: the search toolbar

**Files:** `src/renderer/views/grid/{SearchToolbar.vue,search.ts}`

VS Code-styled, floating over the top-right of the grid body (D21), toggled from the toolbar or by the find accelerator the app already owns. Controls: query input, **match case**, **whole word**, **regex**, the match count (`3 of 214`), and prev/next. Escape closes and clears the highlight.

`search.ts` (D28):
```ts
export function runSearch(tabId: string, q: { text: string; matchCase: boolean; wholeWord: boolean; regex: boolean }, onProgress: (found: number, done: number, total: number) => void): { cancel(): void; done: Promise<Match[]> };
```
- Scans the loaded page **only** — never the server (§8.5's deliberate separation from the `WHERE` box).
- Iterates cells in row-major order in **chunks of 2 000 rows per `requestAnimationFrame`**, decoding transiently and retaining only the match coordinates (`{row, col, start, end}`). Retaining decoded strings for a whole page would undo D3.
- A new keystroke cancels the in-flight scan and restarts; the count updates as it goes so a 10 000-row page feels responsive rather than frozen.
- An invalid regex is reported inline in the search box (red border + message), not thrown.
- Matches highlight in place; prev/next moves the selection to the match and scrolls it into view, which reuses the grid's existing scroll-to-cell.

**Acceptance:** on a 10 000-row page, typing a common substring shows a rising match count without a visible frame hitch; match case, whole word and regex each change the count as expected; prev/next walks the matches and scrolls; the operations panel gains **zero** rows during a search.

---

## Step 12 — Prefetch, cache observability, and the settings sections

**Files:** `src/renderer/views/grid/state.ts` (mod), `src/renderer/state/settings.ts` (moved, mod), `src/renderer/workbench/{StatusBar,SettingsDialog}.vue` (mod), `src/renderer/workbench/state/settings.ts` (deleted)

### 12a. Prefetch (D14, §7)

After a page renders and the app is idle, speculatively warm the next page:

- Scheduled from `load()`'s completion via `requestIdleCallback` with a **250 ms** timeout fallback, and only when `settings.data.prefetch` is on, the tab is active, `hasMore` is true, and no other op is in flight for the tab.
- Fires `data.prefetch(...)` with the **next** cursor, a fresh `opId` and the tab's id.
- **Cancelled and forgotten** when the user navigates, changes filter/sort/projection/page size, switches tabs or closes the tab — the in-flight prefetch's `opId` is cancelled through `control.opsCancel` exactly like a foreground read (§7: "cancellable, dropped if the user navigates away").
- The subsequent ▶ is then an L2 hit and produces **no** op-log row, which is the observable proof that prefetch worked and is what Step 15's spec asserts.

### 12b. Observability (§7, D16)

- **Status bar**: a cache-size readout next to the engine indicator — `⛁ 12.4 MB` with a `title` of *"Result cache: 12.4 MB of 64 MB, 37 pages"*. Fed by `data.onCacheStats`. Hidden until the first stats event so a fresh launch does not show a zero.
- **Settings → Cache**: the budget as a number input in MB (writes `settings.cache.l2BudgetMb`, which `main/engine-config.ts` pushes to the engine), a live hit-rate readout (`hits / (hits + misses)`, shown as `—` before any read), and a working **Clear caches** button (`data.clearCaches()`, L2+L3 only per D15, with a `title` saying so). Delete the *"Available once data views land."* note.
- **Settings → Data**: default page size (the four-way choice), prefetch on/off, count-on-open (default off). Delete the note. `countOnOpen` makes `load()` also run `runCount` on the first load of a tab.
- **Settings → Advanced** keeps its disabled inputs and its note (§0 note 11).

### 12c. The settings move (D20)

`renderer/workbench/state/settings.ts` → `renderer/state/settings.ts`, imports updated at every call site (`main.ts`, `SettingsDialog.vue`, `StatusBar.vue`, `App.vue` if it touches it, and the new grid files). Pure move plus the two new sections; `applyAppearance()` is unchanged.

**Acceptance:** with prefetch on, pressing ▶ twice in a row produces **one** op-log `read` row for the second press's page (the prefetch's) and none for the render; with prefetch off, one per press. The status-bar readout grows as pages load and never exceeds the budget; lowering the budget in settings evicts immediately and the readout drops; **Clear caches** zeroes it and the next ▶ is a miss; the tree still renders from L1 afterwards (D15).

---

## Step 13 — Tree menu additions and the operations panel's tab column

**Files:** `src/renderer/project/menus.ts` (mod), `src/renderer/project/state/tree.ts` (mod), `src/renderer/workbench/panels/OperationsPanel.vue` (mod)

P1 Step 9b deferred a specific set of menu items to P2 by name. Here they are, and **only** these:

| Target | P1 shipped | **P2 adds** | Still deferred |
|---|---|---|---|
| Table / view / matview | Refresh · Copy name · Copy qualified name | **Open data** · **Open data in new tab** · **Count rows** · **Saved filters ▸** | Open DDL (P4); Open query console (P5.5) |
| Column | Copy name | **Add to projection** · **Sort by** | — |
| Database / schema | Refresh · Copy name · Filters… | — | Open query console (P5.5); **Set as default** — see below |
| Operations log row | Copy command · Copy error · Cancel | **Reveal originating tab** | Re-run (P5.5) |
| Tab | — | the whole row (Step 7b) | — |
| Grid cell / row / header | — | — | the whole row (P6, D22) |

- **Open data** → `openDataTab(connectionId, path)`; **Open data in new tab** → the same with `newTab: true`. Ordered first, before Refresh, matching §8.10's own ordering.
- **Count rows** opens the table's data tab (existing or new) and runs `runCount` on it. It does **not** run a bare count with nowhere to show the answer.
- **Saved filters ▸** is a submenu of that table's saved filters (from `kira:queries:list`); picking one opens the tab with that filter applied. Empty state: a single disabled *"No saved filters"* item. The full saved-queries surface — the console's saved statements, renaming from a manager dialog — is P5.5; this submenu is the toolbar's saved set, reachable from the tree, which is exactly what §8.10's row means at this phase.
- **Add to projection** / **Sort by** on a column act on the **active data tab if it targets that column's table**, and otherwise open the table's data tab first and then apply. Anything else (silently doing nothing, or acting on an unrelated tab) is worse than either.
- **Set as default** stays deferred. P1 deferred it saying "nothing consumes a default yet" and that is still true in P2: a data tab's path already names its database, so nothing reads a default. P5.5's console is the first consumer. Do not add it.
- **Operations panel**: the `tab` column stops rendering `—` and resolves `record.tabId` against `tabsState` to a title (falling back to `—` for a closed tab, and to the raw id never). Clicking a row and the new *Reveal originating tab* item both call `activateTab(tabId)` when the tab is still open — §8.11's "Clicking a row reveals the tab that issued it", which P1 recorded as inert.

**Acceptance:** right-clicking a table now yields exactly `open-data · open-data-new-tab · refresh · copy-name · copy-qualified-name · count-rows · saved-filters`; a column yields `copy-name · add-to-projection · sort-by`; the database and schema menus are **unchanged** from P1; a `read` op-log row shows the originating tab's title and clicking it activates that tab.

---

## Step 14 — Testcontainers: the MariaDB fixture and the DB specs

**Files:** `tests/db/support/mariadb.ts`, `tests/db/fixtures/0002_mariadb_seed.sql`, `tests/db/mariadb.spec.ts`, `tests/db/postgres.spec.ts` (mod), `tests/ui/support/mariadb.ts`

### 14a. `support/mariadb.ts`

Mirrors `support/postgres.ts` exactly — same exported shape, same memoisation, reusing `support/docker.ts`'s `resolveDockerHost()`:

```ts
export interface MariaFixture {
  container: StartedTestContainer;
  config: ResolvedConnectionConfig;   // ready to hand to the adapter
  uri: string;
  stop(): Promise<void>;
}
export function startMariadb(opts?: { seedBigTable?: boolean }): Promise<MariaFixture>;
```

- Image **`mariadb:11.4`** (LTS). Env: `MARIADB_ROOT_PASSWORD=kira`, `MARIADB_DATABASE=kira_test`, `MARIADB_USER=kira`, `MARIADB_PASSWORD=kira`.
- **Readiness**: `.withHealthCheck({ test: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized'], interval, timeout, retries })` plus `Wait.forHealthCheck()`. The image ships `healthcheck.sh`; this is more reliable than a log match. If the script is missing on the pinned tag, fall back to `Wait.forLogMessage(/ready for connections/, 2)` — MariaDB's entrypoint starts the server twice for exactly the same reason Postgres's does, and waiting for the first line gets you a connection refused (the identical flake P1 documented).
- `startupTimeout` 120 s.
- Seed as **root** (the fixture needs `CREATE`), but the returned `config` connects as **`kira`** — the non-root user is what proves `KILL QUERY` on your own query needs no `PROCESS` privilege (§6e). Grant `kira` all privileges on `kira_test` and `SELECT` on a second database so the tree has more than one to list.
- A second database `kira_analytics` with one table, mirroring the Postgres fixture's `analytics` schema (MariaDB has no schema level, so the second *database* is the equivalent).

### 14b. `fixtures/0002_mariadb_seed.sql` — the §9.1 dataset, MariaDB dialect

Deliberate parity with `0001_seed.sql` so the two spec files can assert the same things:

- `wide_table` — 60 columns across `int`, `bigint`, `decimal(20,6)`, `text`, `varchar(50)`, `tinyint(1)`, `date`, `datetime(6)`, `timestamp`, `char(36)` (the UUID stand-in — MariaDB's native `uuid` type exists in 10.7+, use it and note the version), `json`, `blob`, `enum`, `set`. Some nullable, some `NOT NULL`, several with defaults and **column comments** (`COMMENT '…'`).
- `nulls_and_unicode` — `NULL`s in every nullable column, empty strings (distinct from `NULL`), emoji, CJK, RTL, combining characters, a **1 MB** `longtext` and a **256 KB** `blob`. The table must be `utf8mb4` or the emoji silently become `?` — set the charset explicitly on the table, not just the connection.
- `nested_json` — a `json` column with 5-level nesting and a 200-element array.
- `composite_pk(tenant_id, entity_id, …)` — two-column PK.
- `employees(id, manager_id → employees.id)` — self-referencing FK.
- `regions ← customers ← orders ← order_items → products` — the same multi-hop graph, so `foreignKeys` **and** `referencedBy` both have something to assert. InnoDB throughout (FKs require it).
- `big_rows` — **1 000 000 rows**, seeded with MariaDB's SEQUENCE engine: `INSERT INTO big_rows (id, payload) SELECT seq, MD5(seq) FROM seq_1_to_1000000;` then `ANALYZE TABLE big_rows`. The `seq_1_to_N` virtual tables are built in and are far faster and simpler than a recursive CTE (which would also need `cte_max_recursion_depth` raised past its 1000 default). Gated behind `seedBigTable`, default **true** — unlike P1, P2 genuinely consumes these rows.
- One view, one stored function, one stored procedure, one `SEQUENCE`, so every `NodeKind` the adapter can emit appears. No matview (MariaDB has none) — assert its absence rather than pretending.
- A table named `` weird`name `` and one named `Order Items`, for the same reason P1 has them: identifier quoting is where catalog and read code break, and D8 needs a test that would catch a regression.

### 14c. `tests/db/mariadb.spec.ts`

The §9.1 scenario list, matching `postgres.spec.ts` 1–10 and then the P2 additions:

1. **connect / disconnect** — `serverVersion` matches `/^MariaDB 11\./`; after `disconnect`, a side connection sees no session with `program_name = 'kira-studio'` in `information_schema.PROCESSLIST`.
2. **auth failure** — wrong password → `AdapterError` code `E_AUTH`, server message verbatim.
3. **tree enumeration** — root lists `kira_test` and `kira_analytics` and **not** `mysql`/`information_schema`/`performance_schema`/`sys`; `kira_test` lists the tables, the view, the sequence, the function and the procedure with the right kinds; `wide_table` lists 60 columns in ordinal order; **the path depth is 2, not 3** (no schema level) — assert the encoded paths explicitly, because that is the abstraction claim this adapter exists to test.
4. **quoting** — `` weird`name `` and `Order Items` enumerate and their columns list.
5. **describe** — `order_items` has the right columns (`COLUMN_TYPE` strings, nullability, defaults, comments), `primaryKey`, one entry per index with `unique`/`primary` correct, two `foreignKeys` with resolved `referencedPath`/`referencedColumns`, and `employees` has a self-referential `referencedBy`.
6. **row estimate** — `big_rows`'s node reports an estimate after `ANALYZE`; a never-analysed table reports `null`, never a raw sentinel.
7. **cancel, asserted server-side** — run `SELECT SLEEP(30)` under `runOp`; wait until a side connection sees it in `information_schema.PROCESSLIST`; `cancelOp(opId)`; assert (a) the promise rejects with `E_CANCELLED` and (b) within 2 s the query is **gone from the process list**. This is §9.1's hard requirement and the whole reason `caps.cancel` is allowed to be `true`.
8. **cap honesty** — `mariadbCaps.cancel === true` and scenario 7 passes.
9. **children of a leaf** — a routine returns `[]` and does not throw.
10. **read: first page** — 100 rows of `big_rows`, `rowCount === 100`, `hasMore === true`, column descriptors correct, `position.strategy === 'keyset'`.
11. **read: deep page by offset** — offset 900 000; the first row's id is 900 001; the statement in `setCommand` contains `OFFSET`.
12. **read: keyset forward and backward** — page through `after` five times, collect the ids, then walk back with `before` and assert the id sequences are exact mirrors with no gaps or repeats. Then assert a token from a *different* filter is rejected with `E_QUERY` (§5c's fingerprint).
13. **read: no keyset without a tiebreaker** — a table with no unique key falls back to `offset` and reports `strategy: 'offset'`; a mixed-direction structured sort does the same.
14. **read: projection** — a two-column projection returns two chunks in ordinal order; an unknown column name throws `E_NOT_FOUND` naming it.
15. **read: filter and sort** — a `WHERE` narrows the count of returned rows; a syntactically invalid `WHERE` throws `E_QUERY` carrying the server's own message **unmodified** (assert a distinctive substring of MariaDB's message, not a message of ours).
16. **read: fidelity** — from `nulls_and_unicode`: `NULL` and `''` are distinguishable via `isNull`; emoji/CJK/RTL round-trip byte-exact through the codec; the 1 MB text cell is truncated at `MAX_CELL_BYTES` and reported in `truncated`/`truncatedCells`; the blob column comes back as `0x…` hex, not U+FFFD; `decimal(20,6)` comes back as its exact text, not a rounded double (**this is the assertion that D3 exists for** — write it as an exact string comparison).
17. **count** — `count()` on `big_rows` is exactly 1 000 000 and `exact === true`; with a `WHERE`, it matches a hand-run query.
18. **read cannot write** — a filter of `1=1; DROP TABLE app_probe` throws rather than dropping anything, and the probe table still exists afterwards (D9's guard, asserted rather than asserted-in-prose).

`postgres.spec.ts` gains 10–18 in the same order, against the Postgres fixture. Where the two engines' error text differs, assert on the code plus a substring the server actually produces — never on a message we compose.

### 14d. `tests/ui/support/mariadb.ts`

A three-line re-export mirroring `tests/ui/support/pg.ts`, so Playwright specs can start the same container.

**Acceptance:** `bun run test:db` green with Colima running, both engines, all scenarios; a legible Colima message (not a stack trace) when the daemon is down; the run's wall time is reported so Step 15 knows what it is adding to.

---

## Step 15 — Playwright specs

**Files:** `tests/ui/{data-view,tabs,mariadb,perf}.spec.ts`

All four follow the P1 conventions exactly: `test.beforeAll` skips with `DOCKER_UNAVAILABLE_MESSAGE` when Docker is unreachable (D22 of P1), setup creates the connection through `window.kira.connectionsCreate` rather than driving the dialog, `consoleErrors` must be empty at the end of every spec, and the grid is virtualized so **a row not scrolled into view is not in the DOM** — reuse `tree.spec.ts`'s scroll-until-found helper shape rather than asserting on a bare query.

**`data-view.spec.ts`** (Postgres-backed, the bulk of §9.2's data-view coverage):
- Turn **prefetch off** in settings first for every op-counting assertion, then back on for the prefetch assertions. Say why in a comment — an unexplained settings write in a spec is the kind of thing a later reader deletes.
- Open `app.big_rows`; assert 100 rows render, the gutter numbers start at 1, the header shows the column names.
- All pagination controls: ▶ ▶ ▶, ◀, ⏮, page-size 10 → 1000 → 10000, and jump-to-page after Σ. Assert the gutter's first row number each time; that number is the honest end-to-end check that the cursor logic is right.
- Σ **count all** fills in `of 10000`; the count survives a page change; after a *Refresh* it is recomputed (one new `count` op row).
- **Projection**: uncheck half the columns; assert the header shrinks and the op log's command contains only the kept columns.
- **Sort**: click a header (asc → desc → none) and assert the first row changes and `data-pagination` flips as D7 predicts; then a free-text `ORDER BY` and assert it wins and clears the chevrons.
- **Filter toolbar**: a valid `WHERE` narrows the grid; an invalid one shows the server's verbatim message with the previous page still rendered; history records one entry per distinct filter; save, pin, rename and delete a saved filter and relaunch to assert persistence.
- **Search toolbar**: match count, match case, whole word, regex, prev/next, and **zero** new op-log rows during a search.
- **Stop**: start a 10 000-row read over `big_rows` and press ⏹; assert the op-log row flips to `cancelled` and the previously rendered page is still on screen.
- **Cache**: note the op count, page back to a visited page, assert **no** new op row (L2 hit); press ↻ and assert exactly one.
- **Prefetch**: with it on, press ▶ and wait for idle, then press ▶ again and assert the second render added **no** new op row beyond the prefetch's own.
- **`NULL` vs `''`**: on `nulls_and_unicode`, assert the two cells differ by `data-null` and by rendered text.
- Screenshots: `data-view.png`, `filter-toolbar.png`, `search-toolbar.png`.

**`tabs.spec.ts`** (Postgres-backed):
- Open the same table twice ("Open data in new tab"); page one to page 5 and change its page size; assert the other tab is untouched (§8.4's whole point, and §9.2 names it explicitly).
- Tab context menu: assert the exact item id list; exercise Close others / Close to the right / Close all / Duplicate tab / Reveal in project panel (assert the tree row becomes visible and selected).
- Colours: assert the tab and the toolbar band carry the connection's colour token; change the colour from the tree menu and assert both re-tint.
- **Session restore**: with three tabs open on two connections, relaunch; assert all three come back in order with the right titles, that **none** is connected, that each shows *Reconnect & load*, and that pressing it on one connects that connection and loads its page with the persisted page index and page size.
- Close a tab and relaunch; assert it is gone.
- Screenshots: `tabs.png`, `restored-tab.png`.

**`mariadb.spec.ts`** — the second engine through the real UI, deliberately small: create a MariaDB connection, connect, expand database → table → columns (asserting the two-level path shape), open a data tab, read a page, run Σ, apply a `WHERE`, and cancel a long read. If this passes and no renderer file has a MariaDB branch in it, D27's claim is proven.

**`perf.spec.ts`** — a tripwire, not a benchmark:
- Load a 10 000-row page, scroll the full height in ~20 steps, and sample `requestAnimationFrame` deltas in-page. Assert the **p95 frame time is under 24 ms** and record the measured p50/p95 in the test output. This is deliberately looser than §2.1's 8 ms budget: Playwright drives an instrumented, unoptimised build. It catches "someone made the grid re-render every row per frame"; it does not certify the budget. §2.1's real measurement is **P12's** job and this comment must say so.
- Assert the DOM cell count stays bounded (< 1500) throughout the scroll.
- Assert `totalRetainedBytes()` (Step 8a) returns to its pre-open value after opening and closing ten tabs — the deterministic version of §2.2's "closing a tab frees its pages immediately", worth far more than a flaky RSS reading.
- Assert the reported L2 size never exceeds the configured budget after loading twenty distinct pages.

**Acceptance:** `bun run test:ui` green with Colima up; the specs that need no container still green with Colima down; `test-results/screenshots/` gains the six new images and they look like §8.1's chrome with a data tab in it.

---

## 16. Explicitly out of scope for P2

Do not build, stub, or "prepare" any of these. If a P2 file seems to need one, the design is wrong — say so rather than scaffolding forward.

- **No cell editor content.** No CodeMirror dependency, still. Clicking a cell updates the selection and nothing else; `CellEditorPanel.vue` keeps its P0 empty state, untouched. Format autodetect, manual type override and beautify are **P3** — and P3 is cheap precisely because D3 hands it the server's own text.
- **No DDL.** `caps.ddl` is `true` for both SQL adapters because both *can*; `ddl()` does not exist and *Open DDL* is absent from every menu. **P4.**
- **No mutations of any kind.** No `+ row`, no `− row`, no cell editing, no pending-change set, no *Preview command* content, no commit/rollback, no cache invalidation triggered by a write, no engine-side read-only enforcement beyond what §5's D9 already makes structurally impossible. The three disabled toolbar buttons are inert markup (Step 9). **P5.**
- **No query console**, no `console` tab kind construction, no `saved_queries` rows with `kind !== 'filter'`, and **no *Open query console* item in any menu**. **P5.5.**
- **No grid context menus** (D22) — nothing for grid cells, rows or headers. **P6.**
- **No copy or paste** (D23). No TSV/CSV/JSON/`INSERT` copy, no paste-to-stage. The selection exists and does nothing but be selected. **P6.**
- **No keyboard shortcuts** beyond the existing menu accelerators and the grid's own arrow/shift navigation and Escape. No command palette, no tab-switching bindings, no binding table. **P6.**
- **No PK/FK navigation.** `foreignKeys`/`referencedBy` continue to be collected and cached and continue to have no consumer. No cell buttons, no filtered tabs, no FK graph. **P7.**
- **No third adapter.** No MongoDB, Redis, Kafka, SQS or S3 folder, and no `DocumentPage`/`KeyValuePage`/`StreamPage` types (D5). **P8–P10.**
- **No structured filter builder.** The `WHERE` box is free text; *Filter by this value* is a P6 cell-menu item and does not exist here.
- **No tree pagination, no tree changes** beyond the four menu items in Step 13 and `revealPath`.
- **No `Set as default` database/schema** (Step 13's table says why).
- **No drag-reorder of tabs or connections.** Tab order changes only by opening and closing.
- **No export.** §1 puts CSV/JSON export out of v1 entirely.
- **No L1 changes**, no new metadata cache tier, no adapter-side metadata memo (D10).
- **No engine auto-respawn**, no per-connection engine processes, no change to the memory cap.
- **No RSS or cold-start measurement, no cache tuning pass, no packaging.** Step 15's perf spec is a tripwire and says so. **P12.**
- **No pre-connect scripts.** **P11.**
- **No unit tests.** Two suites only: `tests/db` and `tests/ui`.

---

## 17. Risk register

| Risk | Signal | Response |
|---|---|---|
| **A transferred `ArrayBuffer` detaches the L2 original** | A page renders once, then every later hit renders an empty grid; `byteLength === 0` on a cached chunk | D4: L2 holds the authoritative page, the port gets a clone made at the transport boundary. If you are debugging this, the bug is that someone passed the cached page's buffers to `postMessage`. Never "fix" it by disabling the cache. |
| **Electron's `MessagePortMain` transfer list does not accept `ArrayBuffer`** | A `TypeError` at the first `postMessage` with a transfer list, or the typings simply say `MessagePortMain[]` | Expected, and harmless (D4): send by structured clone. The columnar win is the absence of per-row objects. Record what the typings said in a comment so this is not re-litigated every phase. |
| **A typed array is a view over an oversized scratch buffer** | Page byte size on the renderer side is far larger than `byteSize`; memory climbs faster than the budget predicts | §4a's builder copies into exactly-sized buffers at `finish()`. Structured clone copies the whole underlying `ArrayBuffer`, not the view's window — a 1 MB scratch buffer behind a 4 KB column is a 250× amplification. |
| **`pg` ignores a per-query `types.getTypeParser`** | `numeric(20,6)` arrives as a JS number, `bigint` loses precision, the fidelity assertion in Step 14 scenario 16 fails | Verify before writing (§5's Step 5 note). Fall back to a read-path `Client` constructed with custom `types`. **Never** fall back to `String(parsedValue)` — that is the lossy path D3 exists to prevent, and it would pass a casual eyeball test while corrupting money columns. |
| **MariaDB `column.string()` mangles a BLOB** | The blob column renders as U+FFFD soup rather than hex | §6c: branch the `typeCast` on the column type and use `column.buffer()` + hex for binary types. The fixture's 256 KB blob is there to catch this. |
| **MariaDB rejects a placeholder in `LIMIT`** | `You have an error in your SQL syntax near '?'` on the first read | §5b step 5's fallback: inline the integers after `Number.isSafeInteger` validation, with a comment. They are app-generated, never user text. |
| **`information_schema.TABLES` is slow on a server with many tables** | Expanding a MariaDB database takes seconds | Acceptable *provided* it is cancellable (it goes through `runQuery`, so it is) and shows a spinner. Filter by `TABLE_SCHEMA` in the query — never enumerate all schemas and filter client-side. Do not add tree pagination; that is a real design question and it belongs to P12 with measurements. |
| **`KILL QUERY` needs a privilege the fixture user lacks** | Step 14 scenario 7 fails with an access-denied error rather than a cancellation | Killing your *own* query needs no `PROCESS`/`SUPER`. If it fails, the side connection is authenticating as a different user than the one that ran the query — check `ConnectionSet`'s options, not the privileges. |
| **The op log fills with prefetch rows and users think the app is chatty** | Twice as many `read` rows as page views | Intended and honest (D14) — a prefetch is a real query. The setting exists so it can be turned off, and every op-counting spec turns it off. Do not "fix" it by hiding prefetch ops from the log. |
| **A renderer-supplied `opId` collides** | An op-log primary-key conflict, or the stop button cancelling the wrong query | D2: `runOp` rejects a duplicate id before emitting `op:start`. Verify that path exists before shipping — it is three lines and it is the entire safety story for accepting an id from the renderer. |
| **A keyset token is applied after the filter changed** | A page of rows that silently skips or repeats a range | §5c's fingerprint, and `E_QUERY` on mismatch. The renderer must also drop its tokens whenever filter/sort/projection/pageSize changes — assert it in Step 14 scenario 12. |
| **Grid re-renders every row on scroll** | The perf tripwire's p95 jumps; DOM cell count grows with scroll distance | §2.1 and Step 8d: windowed rows *and* columns, one container transform, no reactivity on row data. If a `reactive()` wrapper appeared around a page, that is the cause. |
| **A 10 000 × 60 search freezes the UI** | The window stops responding while typing in the search box | D28's chunking. If chunking is already in place and it still stalls, the cause is decoded strings being retained — `search.ts` must decode transiently. |
| **The settings row from a P1 database fails to parse after the schema grows** | The app refuses to launch against an existing `~/.kira-studio/kira.sqlite` | §4e: give `data` and `cache` schema defaults, and test the upgrade explicitly by launching against a P1-era database file before committing Step 12. |
| **Nested `db.transaction`** | `cannot start a transaction within a transaction` in `replaceTabs` or `recordFilterUse` | P1 note 1's `fooTx()`/`foo()` split. Both new repos open transactions; nothing they call may open another. |
| **`tabs."order"` unquoted by Drizzle** | `near "order": syntax error` on the first tab save | §0 note 7 / Step 2b — verify the generated SQL once, early, rather than discovering it at the end of a long step. |
| **The MariaDB adapter forces a change outside its folder** | A `if (kind === 'mariadb')` appears in `data.ts`, `cache/`, or a renderer file | D27. Stop and report it rather than making the edit — that branch is the abstraction failing, and the fix belongs in the abstraction (or in `Caps`, which is what `Caps` is for). |
| **The two suites' container startup dominates the run** | `bun run test:db` and `bun run test:ui` each take minutes | Both fixtures memoise one container per process (P1's pattern). If it still hurts, gate `seedBigTable` off for the specs that do not page — but the paging specs genuinely need 1 M rows, so do not gate it off globally. |

---

## 18. Open questions for the human

Both have defaults chosen and implemented in this plan; they are called out because they are the kind of thing worth overruling *before* the code exists.

1. **Three disabled buttons in the data toolbar.** §8.5 specifies the toolbar as an ordered row of ten controls, three of which (`+ row`, `− row`, `⌘ preview command`) belong to P5. Step 9 renders them disabled, which deviates from P1's "omit rather than grey out" rule for *menu items* — the argument being that a specified toolbar's shape should not shift under the user two phases later, the same argument P0 used for the disabled settings sections. The alternative is to omit them and have the toolbar grow three controls in P5. Default taken: **render them disabled**.
2. **Prefetch on by default.** §8.2 lists prefetch as a setting and §7 describes it as what "makes paging feel instant", but it doubles the query count against the user's server for pages they may never look at. Default taken: **on**, matching the disabled placeholder the settings dialog already shows (`checked` + `disabled`), with the op log making it visible and the setting making it stoppable. Say so if you would rather ship it off and let people opt in.

---

## 19. Definition of done for P2

1. `bun install && bun run lint && bun run typecheck && bun run build && bun run test:ui && bun run test:db` is green from a clean clone with Colima running.
2. A **MariaDB** connection can be created, tested, saved, connected, browsed (database → tables/views/routines → columns), read from and cancelled — and adding it touched no file outside `src/engine/adapters/mariadb/`, one line of `adapters/registry.ts` and the dialog's kind option (D27).
3. Both SQL adapters implement `read()` and `count()` with the exact signatures in the P1 roadmap table, return a **columnar** `TabularPage`, and preserve `numeric`/`decimal` and `bigint` values as exact text (D3), proven by an exact-string assertion in both DB specs.
4. Opening a table produces a tab; opening it again in a new tab gives a second, fully independent one — independent paging, page size, projection, sort, filter, scroll and selection (§8.4).
5. Every §8.5 toolbar control works: refresh, all five pager controls, four page sizes, count-all, projection, and a stop button that **actually reaches the server** — asserted server-side for both engines (`pg_stat_activity`, `information_schema.PROCESSLIST`).
6. The filter toolbar pushes `WHERE` and `ORDER BY` server-side, resets paging, reports invalid input with the server's own message unmodified, and offers history plus named, pinned saved filters that survive a relaunch.
7. The search toolbar searches the loaded page only, with match case / whole word / regex / count / prev-next, and issues **zero** queries.
8. A second read of the same page issues **no** database round-trip (visible as zero new operations-panel rows); *Refresh* issues exactly one; the L2 size readout in the status bar never exceeds the configured budget; lowering the budget evicts immediately; *Clear caches* zeroes L2/L3 and leaves L1 intact.
9. Prefetch warms the next page when idle, ships no bytes, is cancelled on navigation, and can be turned off in settings.
10. The grid holds 10 000 rows with a bounded DOM, renders `NULL` distinctly from `''`, right-aligns numerics, truncates a 1 MB cell with a marker, and closing a tab frees its page immediately (asserted against `totalRetainedBytes()`).
11. Tabs, their order, their active one and their per-tab state persist; on relaunch nothing auto-connects and every restored tab shows *Reconnect & load* (§8.4).
12. The operations panel shows `read`/`count` ops with their real statements and their originating tab, and clicking a row activates that tab.
13. `tests/db/mariadb.spec.ts` passes all eighteen scenarios and `tests/db/postgres.spec.ts` passes its original ten plus the nine P2 additions.
14. `test-results/screenshots/` contains `data-view.png`, `filter-toolbar.png`, `search-toolbar.png`, `tabs.png` and `restored-tab.png`.
15. Nothing from §16 exists in the tree — in particular no CodeMirror, no clipboard code, no grid context menu, no `mutate`, no third adapter, and no `DocumentPage`.
