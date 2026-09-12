# P24 — what "stale" means for the DB metadata cache

> **Phase:** `docs/v1.2/SPEC.md`'s P24 row — *"DB metadata cache staleness audit"*.
> **Branch:** `claude/feature-v1-2`. **Predecessors this plan builds directly on:**
> `docs/v1.2/plans/P22c-schema-aware-completion.md` (which added the fourth cache kind and
> deliberately deferred *this* question — its §5 is a handoff written for this plan) and
> `docs/v1.2/plans/P23-sqlite-unbounded-growth-audit.md` (whose §0.3 declined to touch this
> cache's refresh cadence for the same reason). Neither is contradicted here; §0.3 records
> exactly where this phase changes a fact one of them documented, and why.

---

## 0. Scope

### 0.1 The item, in the user's own words

> *"Make sure db metadata is properly cached, and not fetched and refreshed all the time. For
> example when I connect after a while, you refresh that data, but then I open tables navigate etc
> and you don't as it didn't got stale. Ofc if i press refresh you update the metadata."*

Three behaviours are being described, and they are a *specification*, not a diagnosis:

1. **Reconnecting after a while re-reads the metadata.** Correct and expected.
2. **Navigating an already-loaded tree on a continuously-live connection serves from cache** —
   "as it didn't got stale."
3. **An explicit Refresh always re-reads.**

This phase's job is to establish which of the three actually holds today, against the real code,
and to fix the ones that do not. The SPEC row itself asks for exactly that: *"locate the actual
cause of the over-fetching the user is observing … rather than assume a specific mechanism up
front."*

### 0.2 What the investigation found, against the row's own premises

The row's framing assumes over-fetching. That is half right, and the half that is wrong matters:

- **Behaviour 1 holds** (F4) — and is the *source* of the problem rather than a working feature.
  A successful connect does not "refresh" the metadata; it **deletes every row for that
  connection** (`connections/service.go:639`). Everything the user then opens is a cold fetch,
  forever, because there is nothing left to hit. That is the "fetched and refreshed all the time"
  the user perceives, and it is caused by the very step they identified as correct.
- **Behaviour 2 holds** (F6). Expanding a node the renderer already has issues no IPC at all
  (`project/state/tree.ts:164`); re-opening a table's data tab or definition tab hits the Go-side
  cache; `ensureSchemaColumns` is idempotent and single-flight. Within one live connection session
  the app does not re-fetch what it already has. **This part of the user's diagnosis is not a bug**
  and the plan does not manufacture one.
- **Behaviour 3 does not hold** (F8, F9, F10). An explicit Refresh re-fetches exactly **one kind
  at one path** and leaves the other three kinds *on the same row* untouched. Refresh on a
  connection re-lists only that connection's root. Refresh on a table calls `Children` on a **leaf**
  — a real engine op and an op-log row, producing an empty `children` array nobody renders, while
  the `describe` / `definition` / `columns` payloads the user actually wants re-read stay exactly
  as they were. `TreeService.Invalidate`, the Go API built for the designed behaviour, has **zero
  frontend callers**.
- **There is no staleness concept anywhere** (F2, F3). `fetched_at` is written on every write and
  read by exactly one statement — the eviction `ORDER BY`. Nothing ever compares it to anything.
  `etag` has never been written non-`NULL` in the repository's history. A cache hit wins at any age.

So the fix is not "add a TTL". It is: **give "stale" a real, non-temporal meaning, stop conflating
invalidation with deletion, and make the explicit Refresh actually mean what P1 §6c said it meant.**

### 0.3 Not in scope, and why

- **No TTL, no timer, no background revalidation.** D1 argues this from the user's own sentence
  and from `docs/v1/plans/P1-connections-and-tree.md` §6c's original "**TTL:** none". A clock-based
  rule would re-fetch during a live session the user explicitly said should not re-fetch, *and*
  would fail to re-fetch after a reconnect that lands inside the window. It gets both halves of the
  requirement wrong.
- **The L2 page cache and the L3 count cache are untouched.** Their invalidation stories
  (`docs/ARCHITECTURE.md`'s Caching section) are separate, already explicit, and not what the user
  is describing — "db metadata" is L1.
- **The 200-rows-per-connection and 4-MiB-per-row caps are not changed.** P23 F8 measured them and
  concluded the table is bounded; this phase changes *when rows are dropped*, not *how many* are
  kept. §0.3's one honest amendment to P23 is recorded below.
- **`docs/ARCHITECTURE.md` and P23's own inventory say `metadata_cache` is "dropped whole on every
  reconnect"** (`P23-…md:797`). D6 stops that. This is a deliberate amendment to a fact P23
  documented, not an oversight: P23 F8 itself says the table is bounded **three ways**, and the
  reconnect delete is not one of the three — the 200-row cap, the 4-MiB payload refusal and the
  `ON DELETE CASCADE` are. Removing the delete leaves every bound P23 relied on intact. `V-`commits
  update both documents.
- **`dropConnectionState`'s behaviour on disconnect is left alone** (F7). It defeats P1 D11's
  "re-fetch only the expanded paths" nicety, but it causes *under*-restoration, not over-fetching,
  and reversing it is a RAM trade `docs/v1.1/plans/P5-ram-usage.md` owns. Recorded as a finding and
  an open question, not changed.
- **`expand()`'s auto-connect is left alone.** Expanding a disconnected connection connects it
  first (`tree.ts:153-161`), deliberately ("the twisty is the primary way users browse"). D5 makes
  the disconnected read reachable for the *other* consumers (console completion, a restored
  definition tab), which is what P22c F7 needs; it does not re-litigate the twisty.
- **No new adapter capability, no new bridge method, no new bound-call surface.** Every method this
  phase needs already exists; one of them (`Invalidate`) simply has no caller yet.

---

## 1. Findings

### F1 — The cache, end to end: four reads, one write, one delete

`apps/kira-studio/internal/tree/service.go` is the whole L1 read path. Four methods —
`Children` (`:107`), `Describe` (`:140`), `Definition` (`:168`), `SchemaColumns` (`:199`) — share
one shape, byte for byte:

```go
if !refresh {
    if raw, ok := s.getCached(connectionID, path, "<kind>"); ok {
        // unmarshal + validate; on success return Source: "cache"
        // on failure: s.meta.Drop(connectionID, path)
    }
}
if err := s.requireConnected(connectionID); err != nil { return ..., err }
// ... backend call, then s.meta.Put(connectionID, path, "<kind>", encoded)
```

`getCached` (`:97-103`) is a thin pass-through to `repos.MetadataCacheRepo.Get`, which has exactly
one non-test caller in the repository. The write is `Put`
(`internal/storage/repos/metadata_cache.go:54`); the deletes are `Drop` (`:107`) and
`DropConnection` (`:118`), reachable from `tree.Service.Invalidate` (`service.go:232`) and from
`connections.Service.attemptConnect` (`internal/connections/service.go:639`).

### F2 — `fetched_at` is written on every write and compared to nothing

`metadata_cache` (`internal/storage/migrations/0001_init.sql:60-67`) has `fetched_at TEXT NOT NULL`
and `etag TEXT`. Every occurrence of either, in the entire tree:

| Where | What it does |
|---|---|
| `metadata_cache.go:78-81` (`INSERT`) | writes `fetched_at = model.NowISO()`, `etag = NULL` |
| `metadata_cache.go:80` (`ON CONFLICT … DO UPDATE`) | overwrites `fetched_at` with the new value |
| `metadata_cache.go:92` (`ORDER BY fetched_at DESC, rowid DESC`) | **eviction ordering only** |

That is the complete list. `etag` is written `NULL` unconditionally and is never selected. Nothing
anywhere parses `fetched_at` back into a time, and `MetadataCacheRepo.Get` (`:45-48`) does not even
select the column — it returns `payload[kind]` and a `nil` error, always.

**So the audit's literal question — "does anything read `fetched_at` to decide stale vs fresh, or
does it just get written and never compared?" — answers: never compared.**

### F3 — A cache hit always wins, at any age

Follows directly from F1 and F2. With `refresh: false`, a parseable, validating row is returned
with `Source: "cache"` regardless of when it was written — a week ago, a schema migration ago, a
different server version ago. There is no staleness check in the SQL, in the repo, or in the
service. "Stale" is not a concept this code has.

### F4 — Behaviour 1 holds: a successful connect does drop the whole connection's metadata

`internal/connections/service.go:637-641`, the tail of `attemptConnect`:

```go
// D11 (Step 6a numbering): the whole connection's metadata is refreshed on every reconnect.
_ = s.deps.Metadata.DropConnection(id)
s.metadataInvalidated.Emit(id)
```

`Connect` (`:548`) de-duplicates concurrent attempts but has **no already-connected short-circuit**;
that is fine in practice because every UI path that reaches it is gated (`menus.ts:110-130` offers
*Connect* only when not live; `tree.ts:153`, `useConnectionGate.ts:36` both check the status first),
so this fires on real connects only. `Disconnect` (`:644-650`) deliberately keeps the cache
("Cached metadata stays — it is on disk").

The event reaches the renderer as `kira:connection:metadataInvalidated`
(`internal/bridge/events.go:83-85`), where `project/state/tree.ts:298` re-fetches the expanded set
and `state/schemaColumns.ts:130` drops its own per-container copies.

### F5 — …and that delete is why every post-reconnect navigation is a cold fetch

Deleting is not refreshing. After a connect there is nothing on disk for the connection, so:

- every node the user expands is a server round trip, once per node, for the rest of the session;
- every table they open re-runs `describe`;
- every console they open re-runs the schema-wide `SchemaColumns` query P22c added;
- the "panel is instant on launch" property `docs/ARCHITECTURE.md` claims and P1 D10 designed for
  is unreachable through the tree, because `expand()` connects *before* it ever reads
  (`tree.ts:153-165`) and the connect has just emptied the table.

This is precisely the symptom the user reports, arrived at from the opposite direction to the one
the SPEC row assumes: the app is not failing to notice that its cache is fresh, it is **throwing
the cache away and then having to re-read everything**.

The cost is not hypothetical. A `columns` payload for a wide schema is up to 4 MiB of
already-fetched, still-valid structure (P22c D2); dropping it means the next console open pays a
schema-wide catalog query again for a reconnect the user made to run one statement.

### F6 — Behaviour 2 holds: navigating a live tree does not re-fetch

Checked on every path a user reaches by "opening tables, navigating":

| Action | What actually happens |
|---|---|
| Re-expand a node already expanded once | `tree.ts:164` — `if (treeState.children[k]) return;` — **no IPC at all**. Collapse never discards the copy (`collapse`, `:168`), so this is a pure re-render. |
| Expand a node for the first time this session | `loadChildren(…, refresh: false)` → `TreeService.Children` → cache hit if the row survives. |
| Open a table's data tab | `views/grid/state.ts:159` — `if (!rt.meta) void loadMeta(tabId)`, once per tab runtime; `loadMeta` (`:85-95`) calls `treeDescribe` with no `refresh`. |
| Open a definition tab | `views/definition/state.ts:58-61` — `treeDefinition` + `treeDescribe`, `opts?.refresh` undefined on mount. |
| Open a SQL console | `state/schemaColumns.ts:56-72` — idempotent (`byContainer[key]` guard), single-flight (`pendingLoads`), fire-and-forget. |
| Type in a console | Nothing. P22c D5's rule — the language layer never fetches — is enforced by `cachedRelationsFor` being a plain lookup (`:80-85`). |
| Search the panel | Renderer-side only, over already-cached nodes (`tree.ts:369`). |

Nothing polls (`setInterval` appears once in the whole frontend, in `state/runState.ts`, for a
duration ticker), and nothing auto-connects at launch. **The cache is keyed correctly and hits are
served.** The user's "opening a table you already opened refetches" hypothesis does not reproduce.

### F7 — P1 D11's "re-fetch only the expanded paths" is a no-op on the disconnect→reconnect path

`refreshExpanded` (`tree.ts:192-202`) reads `treeState.expanded`. But `dropConnectionState`
(`:252-272`) — invoked whenever a connection reports `disconnected` (`:323-325`, P5 D6/F9) —
**clears `treeState.expanded` for that connection**. So on the ordinary Disconnect → Connect cycle
(and on `Update`'s internal reconnect, `connections/service.go:352-359`, which is a `Disconnect`
followed by a `Connect`), the expanded set is empty by the time the invalidation push lands and
`refreshExpanded` re-fetches nothing. It is only reachable from `error` → Connect, where
`dropConnectionState` deliberately does not run.

This is an interaction between two phases that were each individually right. It is recorded here
because it is the reason the "refresh without a flash" half of D11 does not appear to work — but it
causes a *blank* tree, not extra fetches, so §0.3 declines to change it and OQ-2 carries it forward.

### F8 — Behaviour 3 does not hold: an explicit Refresh re-fetches one kind at one path

`refresh(connectionId, path)` (`tree.ts:182-185`) is the single implementation behind every
Refresh menu item. It calls `loadChildren(…, true)`, which sets `refresh: true` on
`TreeService.Children` only.

`Children` with `refresh: true` skips the cache *read* and then calls `Put`
(`service.go:132`), which **merges** into the existing row (`metadata_cache.go:61-66`) — the
unique index is `(connection_id, path)`, so `children`, `describe`, `definition` and `columns` for
one path live in one `payload_json` object. A refresh therefore:

- replaces the `children` key,
- **leaves `describe`, `definition` and `columns` for the same path exactly as they were**,
- and stamps the row's `fetched_at` to now, which under any future freshness rule would make those
  three stale payloads look freshly fetched (F13).

`docs/v1/plans/P1-connections-and-tree.md` §6c's eviction table says *"Refresh on a node → that
node's row"*. The row was never what got refreshed.

### F9 — Refresh on a *connection* is not "all rows for that connection", and `Invalidate` has no caller

Same §6c table: *"Refresh on a connection / Refresh all → all rows for that/every connection."*

What is built:

- `menus.ts:130-137` (connection row) → `refresh(connectionId, '')` → re-lists the connection's
  **root children only**. Every schema, table, definition and column payload beneath it survives.
- `menus.ts:663-667` (*Refresh all*) → `refreshAllConnections` (`tree.ts:242-246`) →
  `refreshExpanded` per connection → re-fetches the `children` kind for currently-expanded paths.
  Nothing else, for any connection.

`TreeService.Invalidate` (`internal/bridge/tree.go:63-68` → `tree/service.go:232-237`) implements
the designed semantics precisely — `path == nil` drops the whole connection, non-nil drops one
row. It is exposed to the renderer as `control.treeInvalidate` (`frontend/src/bridge/index.ts:214`).
**It has no call site.** The only frontend reference to it is its own definition.

### F10 — Refresh on a table calls `Children` on a leaf

`menuForRow` (`menus.ts:63-91`) routes `table` / `view` / `matview` to `relationMenu`, whose
Refresh (`:366-373`) is `refresh(row.connectionId, row.path)` — and `collection` to
`collectionMenu`, whose Refresh (`:450-457`) is the same. But P19 D5 made relations leaves, and
Mongo collections are leaves too (`internal/adapters/mongo/adapter.go:131-134`). Every adapter
answers a leaf path with an empty list rather than an error — e.g. postgres
(`internal/adapters/postgres/adapter.go:170-181`):

```go
// Rule 5 (Adapter doc comment): Children returns [] for a leaf, never an error. P19 D5:
// table/view/matview are leaves too now …
case "sequence", "function", "table", "view", "matview":
    return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
```

So right-clicking a table and choosing Refresh:

1. issues a real engine operation through `RunOp` and writes an **op-log row** the Operations panel
   shows the user;
2. writes `{"children": []}` into `metadata_cache` under that table's path, consuming one of the
   connection's 200 row slots for a payload nothing ever renders (`buildNodeRow`, `tree.ts:359-360`,
   sets `childNodes = undefined` for a leaf);
3. **refreshes none of the three kinds that table actually has cached** — its `describe` (the
   grid's projection/PK metadata) and its `definition` (the definition view's DDL) stay stale.

This is over-fetching and under-refreshing in the same click.

### F11 — A tree Refresh never reaches the renderer's own `schemaColumnsState`

`state/schemaColumns.ts:124-136` clears `byContainer` on exactly one signal: the
`onConnectionMetadataInvalidated` broadcast. A tree Refresh does not emit it (`Invalidate`'s own
comment, `tree/service.go:229-231`: *"No push of its own"*), and does not call `Invalidate` anyway
(F9). So after refreshing a schema in the tree, SQL completion, diagnostics and hover keep offering
the *previous* column set until the connection is reconnected — the exact drift P22c §5 flagged as
the one `columns` most deserves a rule for ("an `ALTER TABLE ADD COLUMN` made outside the app is
exactly the drift a user would notice through completion first").

Its own header comment also claims it is filled on "a console opening, **a table's data tab
loading**"; only `ConsoleView.vue:116-125` calls it. Harmless, but the comment is wrong and D10
corrects it.

### F12 — There is already a per-connection connect epoch, and `tree.Service` can already see it

`model.ConnectionState.Since` (`internal/storage/model/connection.go:49`, `int64` ms) is stamped
`nowMillis()` when a state is emitted. For the `connected` status it is emitted from exactly one
place — `attemptConnect`'s success path (`connections/service.go:632-637`) — and is never
re-stamped while the connection stays up: the other `emitState` calls carry `connecting` (`:583`),
`error` (`:167`, `:591`) or `disconnected` (`:648`).

So, for a live connection, `Since` **is** the moment that connection was established: a
monotonically-advancing-per-connect epoch, already in memory, already reachable from
`tree.Service` through the one-method `Connected` interface it already depends on
(`tree/service.go:21-23`, `s.states.StateOf(connectionID)`). No new column, no new interface, no
migration is needed to know when the current connection began.

And `fetched_at` is already written in a format that compares correctly as a plain string:
`model.NowISO()` uses `jsISOFormat = "2006-01-02T15:04:05.000Z"` — UTC, fixed width, exactly three
fractional digits, chosen precisely so that lexicographic order equals chronological order
(`internal/storage/model/time.go:5-22`, whose comment says so explicitly and cites `op_log`'s own
retention cut as the precedent).

### F13 — A row-level `fetched_at` cannot express per-kind freshness

The merged-row shape (F8) means one `fetched_at` covers up to four independently-fetched payloads.
Under any freshness rule this is wrong in the dangerous direction: refreshing a container's
`children` would mark its `columns` — last session's, on the same row — as freshly fetched. Since
`columns` is the kind whose drift a user notices first (F11), a freshness rule built on the row-level
column would silently defeat itself. Freshness has to be recorded per kind, alongside the payloads
it describes. D3 does that without a migration.

---

## 2. Decisions

### D1 — "Stale" means *written before the current connection was established*. No TTL. (F2, F3)

An L1 entry is **stale** exactly when it was written before the connection it belongs to was most
recently established, or when a user explicitly asked for it to be refreshed. Age plays no part.

Justification, in order of weight:

1. **The user's own sentence defines it this way.** "When I connect after a while, you refresh that
   data, but then I open tables navigate etc and you don't **as it didn't got stale**." The
   staleness boundary they name is the *connect*, not a duration. A TTL would fail both halves: it
   would re-fetch mid-session (violating behaviour 2) and it would *not* re-fetch after a reconnect
   inside the window (violating behaviour 1).
2. **It is the original design.** `docs/v1/plans/P1-connections-and-tree.md` §6c: *"**TTL:** none …
   metadata is small, on disk, and the whole point is that it never expires,"* with an eviction
   table whose only triggers are connection-deleted, reconnect, Refresh, and the 4-MiB refusal.
   This phase does not invent a policy; it makes the existing one real and fixes the two rows of
   that table that were never implemented.
3. **A duration has no defensible value.** Schema drift is caused by events (a migration, a
   deploy), not by elapsed time; any number chosen would be re-fetching on a schedule unrelated to
   when anything actually changed. `docs/ARCHITECTURE.md`'s "No speculative fetching" law points
   the same way.

### D2 — The epoch is `ConnectionState.Since`, compared as a string against `fetched_at` (F12)

`tree.Service` gains one unexported helper:

```go
// freshnessFloor is the timestamp a cached payload must be at or after to count as fresh: the
// moment this connection was established (D1). The second result is false while the connection is
// not connected, which means no floor applies at all (D5).
func (s *Service) freshnessFloor(connectionID string) (string, bool) {
    st := s.states.StateOf(connectionID)
    if st.Status != "connected" {
        return "", false
    }
    return model.FormatISO(time.UnixMilli(st.Since)), true
}
```

and `getCached` compares `fetchedAt >= floor` **as a plain string** — correct by F12's format
argument, with no parsing and no error path. A payload with no recorded timestamp (a row written
before this phase) compares as the empty string, which is less than every real timestamp: **it is
stale whenever a floor applies, and still servable when none does.** That is exactly the right
upgrade behaviour, and it needs no migration and no backfill.

What this buys, stated plainly: **`fetched_at` finally has a reader.** The audit's question was
whether the column is compared to anything; after this phase it is the whole mechanism.

Known limit, recorded rather than engineered around: a backwards wall-clock step (an NTP
correction) between a connect and a write can make one fresh payload look stale (one extra fetch —
harmless) or one stale payload look fresh (missed until the next connect). Both self-heal on the
next connect, and neither justifies a monotonic counter and the schema change it would need.

### D3 — Freshness is recorded **per kind**, inside the payload, under a reserved key (F13)

`metadata_cache.payload_json` today is `{ "children": …, "describe": …, "definition": …, "columns": … }`.
It becomes:

```json
{
  "children":  <payload>,
  "columns":   <payload>,
  "fetchedAt": { "children": "2026-09-06T10:11:12.000Z", "columns": "2026-09-05T08:00:00.000Z" }
}
```

`"fetchedAt"` is a reserved key: the kind names are a closed set of four, fixed in
`tree/service.go`, so it can never collide with a payload key. `Put` writes `fetchedAt[kind] = now`
and leaves the other entries alone; `Get` returns `(payload[kind], fetchedAt[kind])`, with `""` when
the map or the entry is absent — the pre-P24 case D2 already handles.

The `fetched_at` **column** is unchanged and keeps doing its one job: ordering the 200-row eviction
by whole-row recency (`metadata_cache.go:86-97`). That remains correct — eviction is about rows, not
kinds — and P23's own bound is untouched.

**Repo signature change:** `Get(connectionID, path, kind) (json.RawMessage, error)` becomes
`Get(connectionID, path, kind) (payload json.RawMessage, fetchedAt string, err error)`. One
non-test caller (F1), so this is mechanical.

### D4 — The check lives in `tree.Service`, not in the repo

The repo stays what its own doc comments say it is: a store that does not validate and does not
interpret (`metadata_cache.go:43-44` — *"Get is JSON.parse'd, NOT further validated here — callers
parse through their own domain shape"*). Connection state is a domain concept it has no access to
and should not acquire. `tree.Service` already holds the `Connected` seam and already owns the
"validate, and drop on mismatch" half of cache-aside; freshness is the same kind of decision and
belongs next to it.

Concretely, `getCached` becomes the single choke point — all four read methods keep their existing
four-line shape and gain nothing.

### D5 — No connection, no floor: a disconnected read is served at any age (F5)

When `StateOf(...).Status != "connected"` there is no epoch, so **every** cached payload is served.
This preserves P22c F7's load-bearing property (a cache hit is served before `requireConnected` is
consulted — `tree/service.go:109-117`) and, for the first time, makes P1 D10's *"the tree renders
from cache while disconnected, which is what makes the panel useful on launch"* actually reachable:
today the first connect deletes the previous session's rows before anything can read them.

The concrete beneficiary is the one P22c named: a SQL console opened over a container whose
`columns` were cached in a previous session gets working completion, diagnostics and hover with no
connection at all.

### D6 — `attemptConnect` stops deleting; the invalidation push stays (F4, F5)

`connections/service.go:639`'s `_ = s.deps.Metadata.DropConnection(id)` is removed. The
`metadataInvalidated.Emit(id)` on the next line stays, and keeps meaning what it always meant to
the renderer: *drop your in-memory copies and read again.*

After D2 the effect on correctness is identical — every row for that connection is now older than
the new `Since` and therefore stale, so the first read of each path re-fetches — but the effect on
cost is the difference this phase exists for:

| | before | after |
|---|---|---|
| Rows for the connection, immediately after connect | 0 | unchanged, all stale |
| First read of a path the user opens | server | server (identical) |
| Path the user never opens this session | lost | kept, and still there for the next launch's disconnected read |
| Reading while disconnected | nothing to read | last session's payloads (D5) |
| A 4-MiB `columns` payload after a reconnect-to-run-one-query | re-fetched | re-fetched only if a console actually asks |

Nothing is served stale while connected. The delete bought no correctness; it only guaranteed a
miss.

### D7 — An explicit Refresh means "drop the row, then read" — routed through `Invalidate` (F8, F9)

The dead API becomes the implementation of P1 §6c's own eviction table. `project/state/tree.ts`
gains two exported actions beside the existing `refresh`:

```
refresh(connectionId, path)            // container / connection root, and a group's parent
  → await control.treeInvalidate(connectionId, path)   // the whole row: all four kinds
  → dropSchemaColumns(connectionId, path)              // D10
  → loadChildren(connectionId, path, false)            // now a guaranteed miss

refreshConnection(connectionId)        // a connection row's Refresh, and Refresh all
  → await control.treeInvalidate(connectionId)         // path omitted: every row
  → dropSchemaColumns(connectionId)
  → refreshExpanded(connectionId)

refreshObject(connectionId, path)      // a leaf: relation, collection (D8)
  → await control.treeInvalidate(connectionId, path)
  → reload any open tab on that (connectionId, path)
```

Why invalidate-then-read rather than keeping `refresh: true`: `refresh: true` bypasses one kind's
*read* and rewrites that one kind. Only a `Drop` clears the row, which is what "Refresh this node"
has meant since P1 and what F8 shows was never delivered. Using one mechanism instead of two also
removes the possibility of the two disagreeing. The extra IPC round trip is a local SQLite `DELETE`
on a user-initiated action; the call it replaces was a network round trip.

`loadChildren`'s `refresh` parameter and `TreeService`'s `Refresh` argument both **stay** — the
definition view's toolbar Refresh (`views/definition/state.ts:58-61`, asserted at
`tests/ui/definition.spec.ts:149`) uses them, and it is the correct mechanism there: that view
refreshes one object's two kinds, not a row.

### D8 — Refresh on a leaf stops calling `Children` on it (F10)

`relationMenu` (`menus.ts:366-373`) and `collectionMenu` (`:450-457`) route to `refreshObject`.
That drops the object's whole row — `describe` *and* `definition` *and* the junk `children` a
previous build may have written — and reloads any open tab showing that path via the existing
`state/viewCommands.ts` registry (`reloadTabsForTarget`'s own shape, `:96-110`), which is the
sanctioned `project/` → `views/` edge.

It issues **no** tree call for the leaf. The next data-tab open re-runs `describe`, the next
definition-tab open re-runs `definition`, and no op-log row is written for work that returns `[]`.

### D9 — `refreshExpanded` drops its `refresh: true` (D2, D6)

`tree.ts:200` becomes `await loadChildren(connectionId, path, false)`. Its two callers are the
reconnect push (where every row is already stale by D2, so the fetch happens anyway) and
`refreshConnection` (where the rows have just been deleted, so it is a guaranteed miss). Passing
`refresh: true` on top would force a re-fetch of a path a *sibling window* may have already
refreshed under the same new epoch — the one case where the flag can now cause a fetch the epoch
rule says is unnecessary.

### D10 — The renderer's `schemaColumnsState` is dropped by an explicit refresh too (F11)

`state/schemaColumns.ts` exports `dropSchemaColumns(connectionId, containerPath?)` — the loop
`initSchemaColumnsSync` already runs (`:130-135`), factored out and given an optional
single-container form — and the three D7 actions call it. Its stale header comment ("a table's data
tab loading") is corrected to say what F11 found: `ConsoleView.vue` is the only caller.

---

## 3. Commit sequence

Ten commits. G1-G4 are Go and independently green; F1-F4 are frontend; V1-V2 are verification and
docs. Order matters: the Go freshness rule must exist before the connect-side delete is removed
(G3 before G4), or there is a window where a reconnect serves stale metadata.

| # | Commit | Contents |
|---|---|---|
| **G1** | `refactor(storage): metadata_cache.Get returns the payload's own fetch time` | `metadata_cache.go`: `readPayload` unchanged; add the reserved `fetchedAt` map to `Put`'s merge (D3); widen `Get` to `(payload, fetchedAt, error)`; update `tree/service.go:97-103`'s single caller to ignore the new value for now. No behaviour change. |
| **G2** | `test(storage): the per-kind fetch map, and a pre-P24 row` | `metadata_cache_test.go`: two kinds written minutes apart keep independent `fetchedAt` entries; writing one kind does not move the other's; a hand-inserted legacy-shape row reads back with `fetchedAt == ""`; the row-level column and the 200-row eviction still behave exactly as `TestMetadataCacheEvictionKeepsNewestAndIsolatesConnections` asserts. |
| **G3** | `feat(tree): a cached payload is stale if it predates the current connection` | `tree/service.go`: `freshnessFloor` (D2), `getCached` compares, all four read methods unchanged in shape. A stale payload is **bypassed, never dropped** (D5 needs it, and a failed re-fetch must not lose the cache). |
| **G4** | `fix(connections)!: a successful connect no longer deletes the connection's metadata` | `connections/service.go:637-641`: drop the `DropConnection` call, keep the emit, rewrite the D11 comment to name the epoch rule. `!` because it changes a documented invariant (§0.3). |
| **F1** | `feat(studio): explicit tree refresh drops the whole cached row` | `project/state/tree.ts`: `refresh` → invalidate-then-read; new `refreshConnection`, `refreshObject` (D7); `refreshExpanded` drops `refresh: true` (D9); `refreshAllConnections` routes through `refreshConnection`. |
| **F2** | `fix(studio): refreshing a table no longer lists a leaf's children` | `project/menus.ts`: connection row (`:130-137`) → `refreshConnection`; `relationMenu` (`:366-373`) and `collectionMenu` (`:450-457`) → `refreshObject`; container (`:290-300`) and group (`:491-499`) keep `refresh`, now with row semantics; *Refresh all* (`:663-667`) unchanged at the call site, changed underneath. |
| **F3** | `fix(studio): an explicit refresh clears the console's cached columns` | `state/schemaColumns.ts`: extract `dropSchemaColumns(connectionId, containerPath?)`, reuse it in `initSchemaColumnsSync`, call it from the three refresh actions; correct the header comment (D10). |
| **G5** | `test(tree): the staleness rules, and how they interact` | `internal/tree/service_test.go` — §4.2. This is the phase's real coverage. |
| **V1** | `test(studio): refresh drops the row; navigation does not re-fetch` | `tests/ui/tree.spec.ts` — §4.4. |
| **V2** | `docs: record what "stale" means for L1` | `docs/ARCHITECTURE.md`'s Caching section (§5), and the one line of `docs/v1.2/plans/P23-…md`'s inventory table that this phase amends (§0.3). |

---

## 4. Verification plan

`CLAUDE.md`'s testing bar names *"cache eviction/invalidation with interacting rules"* as one of the
few things that genuinely earns dedicated tests. That is exactly what this phase is, so §4.2 is not
optional and is written first.

### 4.1 Fast checks

`bun run lint`, `bun run typecheck`, `bun run build`; `go build ./apps/kira-studio/internal/...`,
`go vet ./apps/kira-studio/internal/...`. No bindings regeneration is needed — no bridge service's
method set changes.

### 4.2 Go — `internal/tree` (`bun run test:go`), the cases this phase owes

The existing harness (`service_test.go:62-100`) already gives a real SQLite database, a counting
`fakeBackend` and a `fakeStates` whose status a test sets directly. It needs one addition: a
`Since` on the fake state, so a test can place a connect epoch on either side of a write.

| Case | What it pins |
|---|---|
| **`TestFreshCacheHitIsServedWhileConnected`** | Connect, fetch (miss → server), fetch again → `Source: "cache"`, backend count unchanged. Behaviour 2, guarded. |
| **`TestPayloadOlderThanTheConnectionIsRefetched`** | Write a payload, then advance the connection's `Since` past it, then read → `Source: "server"`, count +1. **The core rule.** Fails on `main`. |
| **`TestRefetchRewritesFreshnessAndTheNextReadHits`** | Same setup, then read twice → server once, cache once. Proves the refresh is once per path per connection session, not per read. |
| **`TestStalePayloadIsStillServedWhileDisconnected`** | Stale payload + `Status != "connected"` → `Source: "cache"`, no `requireConnected` error. D5, and P22c F7's property. |
| **`TestStalePayloadIsNotDropped`** | After a stale read that re-fetches, and after a *failing* backend re-fetch, the row still exists. A failed refresh must not destroy the cache. |
| **`TestRefreshingOneKindDoesNotFreshenAnother`** | Write `children` and `columns` under one path pre-epoch; advance `Since`; read `children` (re-fetches, rewrites the row) — then read `columns` and assert it **still** re-fetches. **This is F13's hazard, and the single most important case in the file:** it fails against a row-level `fetched_at` implementation and passes against D3's per-kind map. |
| **`TestPreP24RowIsStaleWhenConnectedAndServedWhenNot`** | A hand-written legacy `payload_json` (no `fetchedAt` key): re-fetched while connected, served while disconnected. D2's upgrade path. |
| **`TestInvalidateDropsEveryKindOnTheRow`** | Write all four kinds under one path, `Invalidate(conn, &path)`, assert all four now miss. F8's gap, from the Go side. |
| **`TestInvalidateConnectionDropsEveryPath`** | Two paths, `Invalidate(conn, nil)`, both miss; a second connection's rows untouched. F9's gap. |
| **`TestExplicitRefreshBeatsAFreshPayload`** | A payload written *after* `Since` (fresh by D1) still re-fetches with `refresh: true`. Behaviour 3 must not be defeated by the new freshness rule. |

The eight existing cases (`TestSchemaMismatchDropsRow`, `TestTruncatedRefreshDropsOlderCompleteRow`,
the five `SchemaColumns` cases, `TestChildrenAndSchemaColumnsShareOneRow`) must all still pass
unmodified except for the harness's new `Since` field — several set `status = "connected"` with a
zero `Since`, which under D2 is a floor of the Unix epoch and therefore leaves every payload fresh.
That is the correct default for them and should be left explicit rather than papered over.

### 4.3 Go — `internal/connections` (`bun run test:go`)

One case in `connections/service_test.go`: **a successful connect leaves the connection's
`metadata_cache` rows in place and still emits `metadataInvalidated`.** It fails on `main` (the
rows are gone) and is the only direct guard on G4. Whatever existing case asserts the current
delete must be rewritten, not deleted — its `metadataInvalidated` half is still the contract.

### 4.4 UI (`bun run test:ui`)

`tests/ui/tree.spec.ts` already counts adapter ops through `opsCount()` — the right instrument.
Three scenarios:

- **Navigation costs nothing.** Expand a schema, collapse it, re-expand: op count unchanged. (This
  is behaviour 2 and largely holds today; it is worth pinning precisely *because* it holds, so a
  future change to `expand()`'s early return cannot silently un-hold it.)
- **Refresh on a container drops the row.** Refresh a schema, then open a table under it: a
  `describe` op is issued, where before the fix the pre-refresh `describe` payload was served from
  cache. The user-visible statement of F8.
- **Refresh on a table issues no `children` op.** Right-click a table → Refresh → assert the op
  delta contains no `children`. Fails on `main` (F10).

`tests/ui/definition.spec.ts:149`'s `refresh: true` assertion must still pass untouched — D7
deliberately leaves the definition view's own toolbar alone, and that assertion is the guard.

The disconnect→reconnect scenario in `tree.spec.ts` cannot exercise the epoch (that tier's
`mockRuntime` has no `Events.On` mock, as its own header comment at `:48-55` records). §4.5 says so
rather than pretending otherwise.

### 4.5 What is deliberately not verified

- **The reconnect→stale→refetch path end to end in `tests/ui/`.** No event mock in that tier (its
  own documented limitation). §4.2's `TestPayloadOlderThanTheConnectionIsRefetched` covers the rule
  itself against a real database; `tests/e2e-real/{sqlite,postgres}-real.spec.ts` exercise a real
  connect/disconnect cycle and must stay green, which is the integration-level check available.
- **A wall-clock regression.** D2 records the limit; constructing an NTP step in a test would pin
  behaviour nobody depends on.
- **Byte-level cache-size measurement.** `CLAUDE.md`: measure when a real question is at stake.
  D6's table is a statement about *when* rows are deleted, checkable by reading them back, which
  §4.2 and §4.3 do.

---

## 5. The audit's answer, for `docs/ARCHITECTURE.md`

The Caching section's **L1 — metadata** paragraph currently reads *"**No TTL** — an entry is dropped
only when its connection is deleted, and the whole connection's metadata is refreshed on **every
reconnect**."* V2 replaces the second half and adds the definition the section has never carried:

> **No TTL, and staleness is defined by connection epoch, not by a clock (P24).** A cached payload
> is *fresh* if it was written after the connection it belongs to was most recently established,
> and *stale* otherwise; a stale payload is bypassed and re-fetched on its first read, per kind,
> and is never re-fetched again for the rest of that connection session. The epoch is
> `ConnectionState.Since`; the comparison is against a per-kind timestamp stored inside
> `payload_json` under the reserved key `fetchedAt` (the `fetched_at` **column** orders the 200-row
> eviction and nothing else). While a connection is **not** connected there is no epoch, so the
> cache is served at any age — which is what makes the panel instant on launch and lets a SQL
> console over a cached container offer completion with no live connection (P22c F7).
>
> A connect no longer *deletes* the connection's rows (it did through P23); it moves the epoch, so
> the same rows are re-read lazily, once each, only for the paths a user actually opens. An
> explicit *Refresh* still deletes: a node's Refresh drops that node's whole row — all four kinds —
> and a connection's Refresh or *Refresh all* drops every row for that connection, which is what
> `docs/v1/plans/P1-connections-and-tree.md` §6c's eviction table always specified.

P22c's own paragraph — *"Whether a reconnect should refresh more aggressively, or `columns` deserves
a rule finer than the other three kinds, is `docs/v1.2/SPEC.md`'s P24 row's question, not decided
here"* — is replaced by the answer: **not more aggressively, and yes, finer — per kind, which
`columns` gets for free from D3.**

---

## 6. What this phase deliberately does not do

- **No TTL, timer, background revalidation, or stale-while-revalidate.** D1.
- **No schema migration.** D2 and D3 are both achieved inside data the schema already stores.
- **No change to the 200-row / 4-MiB caps** (P23 F8's numbers stand).
- **No new bridge method or bound call.** `Invalidate` existed; it now has callers.
- **Does not touch L2 or L3.** §0.3.
- **Does not change `expand()`'s auto-connect**, or `dropConnectionState`'s behaviour on
  disconnect (F7, OQ-2).
- **Does not add an already-connected guard to `connections.Service.Connect`.** F4 checked: every
  UI path is gated, and adding one would change what an explicit user Connect on a live connection
  means — a separate question this phase has no evidence about.
- **Does not give `columns` a rule the other three kinds lack.** P22c §5 offered that option; D3
  makes it unnecessary, since per-kind freshness gives every kind the finer rule at once.

---

## 7. Open questions, with their resolutions

**OQ-1 — Should a stale payload be served immediately and refreshed behind it (stale-while-revalidate)?**
*Resolved: no.* It would give the "refresh without a flash" that P1 D11 wanted, but it needs a new
push channel to deliver the second answer, and it means the user can act on metadata the app already
knows is stale. D1's rule re-fetches once per path per session, only for paths actually opened —
cheap enough that hiding the latency is not worth a second delivery mechanism. Revisit only if a
real wait is reported on a large schema.

**OQ-2 — Should a disconnect stop clearing `treeState.expanded` (F7)?**
*Resolved: not here.* It would restore P1 D11's re-fetch-the-expanded-set behaviour, but it trades
against `docs/v1.1/plans/P5-ram-usage.md` D6/F9's reason for dropping the tree copy, and it produces
an expanded-but-empty render unless the children are kept too. It causes under-restoration, never
over-fetching, so it is outside this phase's question. Recorded so it is not rediscovered.

**OQ-3 — Should the tree refresh a leaf's row by *also* re-listing its parent?**
*Resolved: no.* A leaf's own tree row (label, detail, badges) comes from its parent's listing, so
re-listing the parent would update it — but that is exactly what the parent's own Refresh is for,
and doing it implicitly makes a one-object Refresh cost a whole schema listing. D8 drops the row and
reloads what is on screen; a user who wants the listing re-read refreshes the container.

**OQ-4 — Does anything still need `etag`?**
*Resolved: nothing does, and this phase does not remove it.* It has never been written non-`NULL`
(F2). Dropping a column needs a migration and buys nothing; noting that it is dead is enough.

---

## Checklist

- [x] G1 `Get` returns the payload's own fetch time; `Put` maintains the per-kind `fetchedAt` map
- [x] G2 repo tests: per-kind map, legacy row, eviction unchanged
- [x] G3 `freshnessFloor` + `getCached` comparison; stale is bypassed, never dropped
- [x] G4 `attemptConnect` stops deleting; emit stays
- [x] F1 `refresh` / `refreshConnection` / `refreshObject`; `refreshExpanded` drops `refresh: true`
- [x] F2 `menus.ts` routes each Refresh to the right action; no `children` call on a leaf
- [x] F3 `dropSchemaColumns`, wired into the three refresh actions; header comment corrected
- [x] G5 `internal/tree` staleness suite (§4.2), including the per-kind hazard case (landed in the
      same commit as G3, ahead of the plan's own commit-sequence position, since the harness change
      the suite needs is one and the same)
- [x] `internal/connections` case: connect keeps the rows, still emits (§4.3)
- [x] V1 `tests/ui/tree.spec.ts` scenarios (§4.4 — container-refresh and leaf-refresh, both
      confirmed against `control.log()`'s `treeInvalidate` entries rather than `opsCount()`, the
      more precise instrument for a void call outside its op-channel set; `definition.spec.ts:149`
      still green)
- [x] V2 `docs/ARCHITECTURE.md` Caching section (§5); P23's inventory line amended (§0.3);
      `docs/v1.2/SPEC.md`'s own P24 row given an Implemented summary
- [x] `bun run lint` / `typecheck` / `build`; `go build` / `go vet` / `bun run test:go`;
      `bun run test:unit`; `bun run test:ui`; `tests/e2e-real/{sqlite,postgres}` green

---

## 8. Sources

Every claim above is from the tree at `origin/claude/feature-v1-2` (`966b1bd`).

- `apps/kira-studio/internal/tree/service.go` — the four cache-aside reads (`:107`, `:140`, `:168`,
  `:199`), `getCached` (`:97`), `requireConnected` (`:86`), `Invalidate` (`:232`)
- `apps/kira-studio/internal/storage/repos/metadata_cache.go` — `Get` (`:45`), `Put` and its merge
  + eviction (`:54-103`), `Drop` / `DropConnection` (`:107`, `:118`)
- `apps/kira-studio/internal/storage/migrations/0001_init.sql:60-67` — the table, `fetched_at`,
  `etag`
- `apps/kira-studio/internal/storage/model/time.go:5-40` — `jsISOFormat`, `NowISO`, `FormatISO`
- `apps/kira-studio/internal/storage/model/connection.go:49` — `ConnectionState.Since`
- `apps/kira-studio/internal/connections/service.go` — `Connect` (`:548`), `doConnect` (`:574`),
  `attemptConnect` and its delete+emit (`:599-641`), `Disconnect` (`:644`), `Update`'s reconnect
  (`:345-360`), `emitState` sites (`:167`, `:583`, `:591`, `:632-637`, `:648`)
- `apps/kira-studio/internal/bridge/tree.go` — `TreeService`'s method set, `Invalidate` (`:63-68`)
- `apps/kira-studio/internal/bridge/events.go:83-85` — the invalidation push
- `apps/kira-studio/internal/adapters/postgres/adapter.go:170-181`,
  `apps/kira-studio/internal/adapters/mongo/adapter.go:131-134` — leaves answer `Children` with `[]`
- `apps/kira-studio/frontend/src/project/state/tree.ts` — `loadChildren` (`:109`), `expand`
  (`:147`), `refresh` (`:182`), `refreshExpanded` (`:192`), `refreshAllConnections` (`:242`),
  `dropConnectionState` (`:252`), `initTreeSync` (`:296`)
- `apps/kira-studio/frontend/src/project/menus.ts` — `menuForRow` (`:63`), connection Refresh
  (`:130`), container (`:290`), relation (`:366`), collection (`:450`), group (`:491`),
  *Refresh all* (`:663`)
- `apps/kira-studio/frontend/src/bridge/index.ts:153-215` — the four tree calls and
  `treeInvalidate`
- `apps/kira-studio/frontend/src/state/schemaColumns.ts` — `ensureSchemaColumns` (`:56`),
  `cachedRelationsFor` (`:80`), `initSchemaColumnsSync` (`:128`)
- `apps/kira-studio/frontend/src/views/grid/state.ts:85-95`, `:159`;
  `apps/kira-studio/frontend/src/views/definition/state.ts:38-78`;
  `apps/kira-studio/frontend/src/views/console/ConsoleView.vue:116-125`
- `apps/kira-studio/internal/tree/service_test.go`,
  `apps/kira-studio/internal/storage/repos/metadata_cache_test.go` — the existing harnesses
- `apps/kira-studio/tests/ui/tree.spec.ts:35-70` — `opsCount()` and the tier's documented limits
- `docs/v1/plans/P1-connections-and-tree.md` — D10 (`:58`), D11 (`:59`), §6c's L1 scope and
  eviction table (`:885-901`)
- `docs/v1.2/plans/P22c-schema-aware-completion.md` — F7 (`:188`), F8 (`:207`), D2 (`:318`),
  D5 (`:427`), §5's handoff (`:648-667`)
- `docs/v1.2/plans/P23-sqlite-unbounded-growth-audit.md` — §0.3 (`:117-120`), F8 (`:281-296`),
  the inventory line this phase amends (`:797`)
- `docs/ARCHITECTURE.md` — the Caching section
