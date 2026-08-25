# P43 (iteration 1) — Functionality review: data handling, panel-to-panel state, error surfacing

> **Iteration 1 of three.** The user asked for this phase to run **three full rounds**
> (AGENTS.md's multi-pass convention): Opus researches and writes a plan, Sonnet implements it,
> repeated three times, each round working against the tree the previous round actually left
> behind. This file is round one; `-iter2.md` and `-iter3.md` will follow, written against what
> this round lands, not against this file's prose.
>
> **The phase, in the user's own words** (SPEC.md:994): *"an in-depth review of the app's actual
> behavior (data handling, panel-to-panel communication, whether a state change is reflected
> everywhere it should be, error handling and how errors reach the user), frontend or
> engine/main, followed by real fixes"* and *"practically anything that could be a bug should be
> found and fixed no matter if it be FE or in between."*
>
> **Unlike P39, this phase is explicitly allowed to change behavior.** The discipline that
> replaces "zero behavior change" is P40's and P41's: every behavior change is a numbered decision
> in §3, every finding carries a `file:line` read in the tree, and every spec assertion a change
> invalidates is edited **in the same commit** that changes the behavior.
>
> **Deliberately broad, not exhaustive.** Twelve verified findings and one verified *non*-finding.
> Every one was confirmed by opening the file and reading the function — nothing here is
> "might be an issue." Candidates that did not survive that check are named in §6 with the reason,
> so iteration 2 does not re-open them.
>
> **Branch tip when this plan was written: `ee9c655` on `feature/kickoff`;
> `git status --porcelain` over the repo is empty apart from this file.**
>
> **P42 lands before this plan is implemented.** The renumbering commit `ee9c655` inserted
> **P42 — Console, grid and cell-editor polish batch** ahead of this phase, and it is planned and
> implemented separately. P42's scope touches two files this plan also touches:
> `views/console/resultPages.ts` / `ConsoleResultGrid.vue` (F2) and
> `views/shared/celleditor/CellEditorView.vue` (F3, indirectly — P42 reworks the format picker and
> the byte badge, not the `readOnly` plumbing). Neither finding is invalidated by P42's own list,
> but **every `file:line` below is read at `ee9c655` and may have moved by the time this is
> implemented** — re-grep before editing, do not trust a line number blind.

---

## 0. Ground rules for this phase

- **Every finding carries a `file:line` read in the tree at `ee9c655`.** Where a claim is about
  *absence* (nothing calls X, nothing surfaces Y) it was produced by a repo-wide grep over `src/`
  **and** `tests/`, and the exact absence is stated rather than implied.
- **A fix, not a workaround.** This phase may change behavior, so a finding is answered by making
  the code do the right thing — not by hiding a symptom, greying out a control, or adding a
  comment describing the defect.
- **Every behavior change carries its own spec edit in the same commit.** `tests/ui/sqlite.spec.ts`
  is the one DB-backed UI spec that runs for real in this sandbox (AGENTS.md's SQLite section), and
  four of this round's findings are observable through it — those get **real, executed** coverage
  here rather than Docker-gated coverage that nobody can run. §5 says exactly which.
- **P39's layering rules stand.** `biome.json`'s seven `overrides` are unchanged by this phase.
  Every import added below is `views/* → state/*`, `views/* → views/shared/*`, `state/* → state/*`
  or `state/* → bridge/*`. No `views/ → project/`, no `views/ → views/<sibling>/`, no
  `project/ → views/`.
- **No new dependency, no new build step, no migration, no new IPC channel, no new wire-schema
  field.** Every fix below is renderer-internal or engine-internal.
- **`data-testid`s are added, never removed or renamed.** New ones follow each view's existing
  prefix convention (`data-action-error`, `document-action-error`, …).
- Comments per AGENTS.md: only where the code cannot say it for itself. Three existing comments
  become false as a result of this phase and are rewritten in the same commits
  (`StreamView.vue:149-153`, `cellSelection.ts:24-30`, `resultPages.ts:18-22`).
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` stay green
  after **every** commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. The three items previous phases explicitly handed to this one

**F1 — `UploadObjectDialog.vue`'s `containerPrefix` drops every ancestor prefix segment above the
immediate parent, so an upload through a 2-or-more-level-nested S3 prefix lands in the wrong
place.** Handed here by P41 (SPEC.md:993's own P41 row). **Confirmed real.**
`workbench/UploadObjectDialog.vue:28-31`:

```ts
const containerPrefix = computed(() => {
  const tail = pathTail(uploadDialogState.containerPath);
  return tail?.kind === 'prefix' ? `${tail.name}/` : '';
});
```

`pathTail` (`shared/domain/tree.ts:64-73`) returns only the **last** segment, and an S3 `prefix`
node's `name` is only its own local segment — `s3/catalog.ts:101-110` slices `cp.Prefix` down to
`segment` and encodes `{ kind: 'prefix', name: segment }`. So for the level
`bucket:main-bucket/prefix:reports/prefix:2024`, `containerPrefix` is `"2024/"` and
`chooseFile()` (`:37`) prefills `key = "2024/note.txt"`.

That string is the **whole bucket-relative key**, not a relative one: `objectStore.ts:107-122`
puts it in the insert op's `_key` sentinel verbatim, and `s3/mutate.ts:152` /`:167-178` passes
`keyFrom(op.values, 'insert')` straight to `PutObjectCommand`'s `Key`. The object is therefore
created at `2024/note.txt` at the bucket root, not at `reports/2024/note.txt`. Worse,
`objectStore.ts:123-124` then builds the "new object" tab path as
`containerSegments + { kind: 'object', name: key }` — a path claiming an object named
`2024/note.txt` under `prefix:reports/prefix:2024`, which does not exist, so the tab that opens
immediately fails its own read.

**F1a — no existing assertion could have caught it.** `tests/ui/s3.spec.ts:648-655` uploads from
the Browse panel at exactly **one** level below the bucket root (`prefix:reports`) and asserts
`'reports/note.txt'` — which is correct at one level and only at one level. The fixture already
seeds a two-level prefix (`tests/db/fixtures/0007_s3_seed.ts:13`,
`NESTED_OBJECT_KEY = 'reports/2024/summary.json'`), so the deeper case was reachable and simply
never driven.

**F2 — `views/console/resultPages.ts`'s `setVisibleWindow` has no caller anywhere, so a console
result set's decoded-cell cache is never pruned.** Handed here by P40 (its F22, SPEC.md:992).
**Confirmed real.** `grep -rn "setVisibleWindow" src/ tests/` returns exactly four hits:
`views/grid/page.ts:48` (the definition) and `views/grid/DataGrid.vue:40,377` (its one caller), plus
`views/console/resultPages.ts:74` (the definition) — and **no** caller.
`ConsoleResultGrid.vue` has no `visiblePageRowBounds` watch, no scroll hook, and never imports the
function (`ConsoleResultGrid.vue:10` imports `cell, documentRow, getPage, keyValueRow,
pageVersion` only). Consequences, both real:

- `Entry.windowKey` (`resultPages.ts:12`, initialised at `:43`) is dead state — always `''`.
- `cached()` (`:23-30`) memoises every decoded cell for the entry's whole lifetime, so scrolling a
  10 000-row console result decodes and **retains** every cell string it passes, against
  `views/grid/page.ts:43-57`'s deliberate prune-on-window-move (P29 D7). §2.2's memory budget
  applies to console results exactly as it does to grid pages.

**F3 — the stream view mounts the cell editor with the same "no write path" gap the console had
before P40 fixed it there, and the document view mounts a dock that can never open at all.**
Handed here by P40 (its F14). **Confirmed real, and refined.**

`StreamView.vue:823` and `DocumentView.vue:818` both render `<CellEditorDock :tab-id="tab.id" />`
with no `read-only` prop; `CellEditorDock.vue:13-15` defaults it to `false`, and `ConsoleView.vue:337`
is the only mount that passes `true`. For the stream view that means:

- the UUID-generate button and `EditBufferActions`' modified chip / byte badge / Beautify / Revert
  all render (`CellEditorView.vue:103-112` gates them on `!viewerMode`), on a surface where
  `isEditable` (`:86-88`) is permanently `false` because `StreamView.vue:131-155`'s publisher never
  sets `onEdit`;
- on a **read-only connection**, `readOnlyReasonFor` (`celleditor/state.ts:38-43`) returns
  `'connection-read-only'` and the panel prints a *"Connection is read-only"* lock chip
  (`CellEditorView.vue:116-119`) — explaining a refusal for a write that was never on offer, which
  is precisely the false statement P40 D12 removed for the console.

`StreamView.vue:149-153`'s own comment is now **false**: it says *"this panel is read-only for
every row regardless (CellEditorView.vue always renders CodeMirrorHost with `:read-only="true"`)"*.
Since P5 that line reads `:read-only="!isEditable"` (`CellEditorView.vue:146`).

For the **document** view the finding is different and simpler: **nothing ever publishes a cell for
a document tab.** `grep -rn "publishSelectedCell" src/renderer` returns four publishers —
`views/grid/DataGrid.vue:534`, `views/keyvalue/KeyValueView.vue:463`, `views/stream/StreamView.vue:155`
and `views/console/ConsoleResultGrid.vue:128` — and none in `views/documents/`. The dock's own
`v-if="cell"` (`CellEditorDock.vue:21`) therefore never opens. SPEC.md:552-553 states the intended
behavior outright: *"The cell editor panel (§8.6) is never shown for a document tab."* The mount is
dead markup that contradicts the file it sits in, and `documents/state.ts:227-229`'s comment
("The row published to the cell editor") describes a publication that does not happen —
`selectRow` only sets `rt.selectedRow`.

**F4 — `clickhouse/read.ts`'s `quoteIdent` still has no NUL-byte guard where its three SQL siblings
do.** Handed here by P39 iteration 3 (its F18/D20, whose own words were *"P40 is the phase that is
allowed to change behavior and to test the change"* — that phase is now P43). **Confirmed
unchanged.** `postgres/read.ts:24-27`, `mysql-family/read.ts:25-28` and `sqlite/read.ts:26-29` each
open with

```ts
if (name.includes('\0')) throw new AdapterError('E_QUERY', 'identifier contains a NUL byte');
```

`clickhouse/read.ts:18-20` does not:

```ts
export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}
```

It is reached with catalog-derived and user-derived names alike —
`clickhouse/read.ts:98` (`buildOrderBy` over the user's `ORDER BY` terms), `:133-134` and `:190`
(relation and projection columns). This is the only SQL adapter in the app where the check is
absent, and the inconsistency itself is the bug: either all four guard or none do, and three
already do.

### B. Errors that never reach the user

**F5 — a failed *commit* in the data grid produces no UI at all: it is an unhandled promise
rejection.** `views/grid/DataToolbar.vue:203-208`:

```ts
async function onCommit(): Promise<void> {
  const t = tab.value;
  if (!t?.connectionId) return;
  await commitPending(t.connectionId, t.path, t.id);
  await reloadAfterMutation(t.id);
}
```

No `try`/`catch`, and `@click="onCommit"` does not catch an async rejection. `commitPending`
(`views/grid/pendingChanges.ts:212-226`) `await`s `data.mutate`, which rejects with the server's
own message for every real failure — a constraint violation, a type error, `assertWritable`'s
`E_UNSUPPORTED` on a read-only connection, `assertAffectedExactlyOne`'s "affected N rows". The only
error surface the data view has is `DataView.vue:174-182`'s strip, gated on
`rt?.status === 'error' && rt.error` — and `rt.status`/`rt.error` are written **only** by `load()`
(`views/grid/state.ts:126-137`). Nothing in the mutation path writes them. SPEC §8.5's *"Invalid
input is reported inline by the server's own error, unmodified"* and §8.15's *"errors surfaced
verbatim"* are both unmet for the one write path in the app that stages before it writes.

Note also that `clearPending(tabId)` (`pendingChanges.ts:225`) runs only after a **successful**
`data.mutate`, so the staged set does survive the failure — the data is not lost, the *explanation*
is.

**F6 — the same gap in every immediate-mutation view, and it is exactly the delete/commit paths
that lack it while the add/compose paths have it.** A repo-wide read of every `data.mutate` caller
in `src/renderer` splits cleanly in two:

| Has an error surface | File:line |
|---|---|
| Redis string edit | `KeyValueView.vue:270-283` (`editError`) |
| S3 object body edit | `KeyValueView.vue:300-313` (`objectSaveError`) |
| Redis add key | `KeyValueView.vue:368-384` (`addError`) |
| Stream add message | `StreamComposeMessage.vue:64-66` (`error`) |
| S3 upload | `UploadObjectDialog.vue:64-66` (`error`) |

| Has **none** | File:line | What is lost |
|---|---|---|
| Grid commit | `DataToolbar.vue:203-208` | F5 |
| Document edit | `DocumentView.vue:385-390` (`commitEdit`) | a Mongo validation/duplicate-key error |
| Document insert | `DocumentView.vue:241-245` (`commitCreate`) | the same, on insert |
| Document delete (row button) | `DocumentView.vue:403-406` — `void deleteDocument(...)` | the `void` discards the rejection outright |
| Document delete (context menu) | `documents/menu.ts:72` — `void deleteDocument(tabId, id)` | same |
| Redis/S3 delete | `KeyValueView.vue:320-333` (`onDeleteKey`) | a failed `DEL`/`DeleteObject` |
| SQS delete | `StreamView.vue:337-344` (`onDeleteMessage`) | a failed receipt-handle delete |
| S3 delete from Browse | `browse/menu.ts:130-134` | `contextMenu.ts:49`'s `void item.run()` swallows it |

Every one of these is a **destructive** action executed immediately with no staging and no
preview — the class of action where a silent failure is worst, since the user's next look at the
list (after the `reload` that never runs) shows the row still there with no reason given.

### C. State that is not reflected where it should be

**F7 — a filter change never invalidates the tab's row count, so the pager keeps showing the
*previous* filter's total and page count as if they described the new one.**
`views/grid/state.ts:270-274`:

```ts
export async function setFilter(tabId: string, filter: string | null): Promise<void> {
  resetTokens(tabId);
  patchDataTabState(tabId, { filter, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}
```

`rt.count` is written in exactly one place — `runCount` (`views/grid/state.ts:186`) — and cleared
in none. `DataToolbar.vue:84-90`'s `pageCount` derives the pager's `page N of M` from it
(`Math.ceil(count.value / size)`), and `goLast` (`views/grid/state.ts:227-236`) navigates to
`(pageCount - 1) * pageSize` from the same number. So: press Σ on a 10 000-row table, then apply a
`WHERE` that matches three rows — the toolbar still reads *"of 100"*, ⏭ is still enabled, and
pressing it requests offset 9 900 of a three-row result. The count is not even greyed: `stale` is
false, because the L3 entry it came from is genuinely fresh **for its own filter**
(`engine/cache/counts.ts:30-32` keys on `{connectionId, path, filter}`, so the new filter is a
different key entirely — the cache is right and the renderer's mirror is what is wrong).

Identical in the document view: `documents/state.ts:201-204`'s `setSearch` changes the Mongo
filter, `rt.count` is written only at `:131`, and `documents/state.ts:187` computes `pageCount`
from it the same way.

**F8 — the document view has no `resetTokens`, so a failed reload after a search/sort change leaves
a keyset cursor from the previous query in place.** `views/grid/state.ts:249-253` exists precisely
for this and is called by all four of the grid's setters (`:259, :265, :271, :277`).
`views/documents/state.ts` never assigns `rt.nextToken`/`rt.prevToken` outside `load()`'s success
path (`:93-94`) — `grep -n "nextToken" src/renderer/views/documents/state.ts` gives `:23, :37, :93,
:145, :154-155` and nothing else. On the happy path the follow-up `load()` overwrites them, which
is why this has never been seen; when that `load()` fails or is superseded (`:83`'s
`if (rt.opId !== opId) return`), `goNext` (`:154-155`) then sends a `{ mode: 'after', token }`
cursor built under the *old* filter/sort. The grid guards this; the document view does not.

**F9 — disconnecting a connection never returns its open tabs to §8.4's Reconnect gate, so
reconnecting from the tree shows the pre-disconnect page with no re-fetch.**
`useConnectionGate.ts:29-31` computes `needsReconnect` as
`!isHydrated(tab.id) || connectionStatus !== 'connected'` — correct while disconnected. But
`unmarkHydrated` is called from exactly six places (`grep -rn "unmarkHydrated" src/renderer`), and
all six are the `failure.kind === 'disconnected'` branch of a **load** (`grid/state.ts:139`,
`documents/state.ts:104`, `keyvalue/state.ts:94`, `stream/state.ts:121`, `console/state.ts:159`,
`browse/state.ts:57`). An explicit Disconnect — `state/connections.ts:170-173`, which only writes
`connectionsState.states[id]` — never touches `tabsState.hydrated`. So the moment the connection
goes back to `connected` (from the tree's own menu, or from `expand()`'s auto-connect at
`project/state/tree.ts:136-146`), `needsReconnect` flips back to `false` and the view re-renders
its old rows: the renderer's page store (`views/grid/page.ts:15`'s `pages` map) is keyed by tab id
and is only dropped on tab close (`state/tabs.ts:48-55`), even though the engine already released
its own copy (`engine/cache/index.ts:96-101`'s `dropConnection` on disconnect). The user is looking
at data from before the disconnect with nothing on screen saying so.

The same hole explains why an open **Browse** tab is never refreshed on reconnect: the only
reconnect-time refresh in the app is `project/state/tree.ts:282-284`'s
`onConnectionMetadataInvalidated → refreshExpanded`, and `refreshExpanded` (`:177-193`) walks
`treeState.expanded` only — the project tree. Since P41 the tree holds no Redis/S3 level below the
container at all, so a Browse tab's level is refreshed by nothing.

**F10 — a committed mutation is invisible to a second tab open on the same table.** §8.4 makes
"the same table opens any number of times" a headline feature, and §7 promises L2 is *"invalidated
by … any local mutation on the same target."* The engine keeps that promise
(`engine/data.ts:141`'s `cache.invalidateAfterMutation`). The renderer does not: the only reload
after a commit is `reloadAfterMutation(t.id)` (`DataToolbar.vue:207` → `views/grid/state.ts:158-168`),
which takes a single `tabId`. Nothing anywhere enumerates the other tabs on the same
`(connectionId, path)` — `grep -rn "reloadTab\|reloadTabsFor" src/renderer` shows
`state/viewCommands.ts:23-27`'s `reloadTab(kind, tabId)` and its five call sites, every one of them
a single, already-known tab. Delete a row in tab A and commit; tab B keeps rendering that row from
its own `views/grid/page.ts` entry indefinitely — and clicking it stages an update against a
primary key that no longer exists. The same applies across kinds (a document tab and a data tab on
the same Mongo collection, two key/value tabs on the same key).

**F11 — a key/value tab's own mutations never tell an open Browse tab that its level changed.**
P41 introduced `browseInvalidate` (`state/viewCommands.ts:63-81`) for exactly this and wired
**one** caller: `UploadObjectDialog.vue:61`. `grep -rn "browseInvalidate" src/renderer` confirms
those are the only two hits. But the key/value view mutates the same container's contents from
three more places, none of which call it:

- `KeyValueView.vue:328` → `deleteObject(...)` (an S3 object removed from its own tab);
- `KeyValueView.vue:332` → `deleteKey(...)` (`keyvalue/mutations.ts:39-54`, a Redis key removed);
- `KeyValueView.vue:377` → `addKey(...)` (`keyvalue/mutations.ts:62-90`, a new Redis key created,
  which `:89` then opens in its own tab).

`browse/state.ts:111-118`'s `invalidateLevel` matches on the tab's `currentLevel(tabId) === path`,
and the container of a key/object tab is exactly `pathParent(tab.path)` — the level a Browse tab
would be sitting on. Since P41 the Browse panel is the **only** place that level is rendered, so
today deleting a key from its tab leaves the panel that navigated you there still listing it, with
no refresh short of the row menu's own Refresh.

### D. Engine-side data handling

**F12 — a mutation that fails part-way leaves the target's stale pages in L2.**
`engine/data.ts:133-142`:

```ts
  const { value } = await runOp(…, (ctx) => adapter.mutate(plan, ctx));
  cache.invalidateAfterMutation(req.connectionId, req.path);
  return { affectedRows: value.affectedRows };
```

The invalidation is on the success path only. That is safe for the three adapters whose `mutate()`
is transactional — `postgres/mutate.ts:92-104` and `mysql-family/mutate.ts` wrap the whole plan in
`BEGIN`/`COMMIT` with a `ROLLBACK` on any throw, and sqlite likewise — but **not** for the ones
that are a plain sequential loop with no transaction at all:

- `redis/mutate.ts:100-125` — each op `SET`/`DEL`s and increments `affectedRows`; a throw on op *k*
  leaves ops `0..k-1` applied;
- `s3/mutate.ts:218-229` — same shape over `PutObject`/`DeleteObject`;
- `mongo/mutate.ts`, `sqs/mutate.ts`, `rabbitmq/mutate.ts`, `clickhouse/mutate.ts` — same shape.

A multi-op plan that fails half-way therefore mutates the server and leaves the pre-mutation page
in L2 under an unchanged key, so the next `handleRead` for that target returns it as a cache hit
(`engine/data.ts:39-42`) with `source: 'cache'`, and — because F5 means the renderer's own
post-mutation reload never runs on a failure — nothing else corrects it either. The two findings
compound: the user sees an unchanged grid and no error.

### E. One verified non-finding, recorded so iteration 2 does not re-open it

**F13 — P39 F16's `skipUnchanged` divergence in `state/tabs.ts` is *not* a defect either way.**
P39 iteration 1 preserved the split rather than unifying it and handed *"the question of which is
the bug"* to this phase (SPEC.md:943). Read in full: `patchTabState`
(`state/tabs.ts:505-519`) skips `Object.assign` **and** `saveDebounced()` when
`patchChanged(state, patch)` is false, and `patchChanged` (`:495-501`) is a shallow `Object.is`
comparison. Both halves check out:

- **The three `skipUnchanged: true` patchers** (`data`, `console`, `definition`, `:522-531`, plus
  `browse` at `:548-550`) never receive a patch whose value is the same *reference* as the state's
  own — every object-valued patch site builds a fresh literal (`DataGrid.vue:449-451`'s
  `{ ...t.state.columnWidths, [name]: width }`, `grid/state.ts:286`'s `columnOrder`,
  `documents/state.ts:249-254`'s `{ ...tab.state.expanded }`). A skip therefore only ever happens
  when the patch is genuinely a no-op, and skipping the assign is then indistinguishable from
  performing it.
- **The three `skipUnchanged: false` patchers** (`document`, `keyvalue`, `stream`, `:534-544`)
  schedule a debounced save for a no-op patch, but `saveIfChanged` (`:96-101`) compares
  `JSON.stringify(tabsState.tabs)` against `lastSavedSnapshot` and returns before the IPC. The cost
  of the divergence is one 1000 ms timer that resolves to nothing. `StreamView.vue:392-397`'s
  per-`pointermove` resize patch is the hottest caller and it collapses into that same single
  timer.

Neither branch can produce a wrong persisted tab record or a lost save. Unifying them is a
**cleanliness** change with no behavior to fix, which is P39's remit, not this phase's — so this
plan changes nothing here and says so, rather than manufacturing a fix to close an open question.

---

## 2. Shapes introduced in this plan

**Each paged view's runtime gains one field**, in `views/{grid,documents,keyvalue,stream,browse}/state.ts`:

```ts
  /** P43: the last *action* (commit, insert, edit, delete) that failed, verbatim from the server.
   *  Distinct from `error`, which describes a failed page *load* — the page on screen is still
   *  valid, so the view keeps rendering it and shows this above it instead. Cleared by the next
   *  successful action or load. */
  actionError: string | null;
```

with one setter per module, in the file's existing style:

```ts
export function setActionError(tabId: string, message: string | null): void {
  const rt = runtime[tabId];
  if (rt) rt.actionError = message;
}
```

and one strip per view, beside the existing load-error strip:

```html
<MessageStrip v-if="rt?.actionError" tone="err" icon="warning" data-testid="data-action-error">
  {{ rt.actionError }}
</MessageStrip>
```

Testids: `data-action-error`, `document-action-error`, `keyvalue-action-error`,
`stream-action-error`, `browse-action-error`.

**`state/viewCommands.ts` — one new function over the registry it already owns:**

```ts
// P43 F10: §7's "L2 is invalidated by any local mutation on the same target" is kept by the
// engine, but the renderer's own per-tab page stores are not — a second tab on the same
// (connectionId, path) kept rendering rows a sibling tab had already deleted. Skips the tab that
// performed the mutation (its own caller already reloads it, with the pages-only invalidate
// scope P13 D18 needs) and every tab still behind the reconnect gate (§8.4: it will load when
// pressed).
export function reloadTabsForTarget(connectionId: string, path: string, exceptTabId: string): void
```

`viewCommands.ts` may import `./tabs` — `state/tabs.ts` does not import `state/viewCommands.ts`
(`grep -n "viewCommands" src/renderer/state/tabs.ts` is empty), so there is no cycle.

**`state/tabs.ts` — the page-store drop split in two:**

```ts
// The five page stores only. dropAllPagesForTab() = this plus cleanupTabRuntime(), which a
// disconnect must NOT do: a disconnected tab keeps its runtime (its count, its open find
// toolbar, its selection) and gets it back on reconnect — only its bytes are released.
function dropPageStoresForTab(id: string): void
```

**`views/console/resultPages.ts` — `Entry.windowKey` becomes the same prune-not-clear pair
`views/grid/page.ts` already uses:**

```ts
  decodeCache: Map<string, string>;   // unchanged: `${row}:${col}` / `id:${row}` / …
  windowStart: number;
  windowEnd: number;
```

with `setVisibleWindow(key, startRow, endRow)` deleting only the entries whose row left the window,
mirroring `views/grid/page.ts:48-57` exactly (the console's key is a string with the row as its
first `:`-delimited component, so the row is recovered with one `parseInt` rather than a second
map level).

---

## 3. Decisions

### The three inherited items

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`containerPrefix` joins *every* `prefix` segment of the container path, not just the tail.** Built from `decodePath(connectionId, containerPath).segments.filter(s => s.kind === 'prefix').map(s => s.name).join('/')` plus a trailing `/` when non-empty. | F1. This is the same reconstruction `s3/catalog.ts:70` already performs on the engine side (`prefixSegments.join('/') + '/'`), so the two agree by construction instead of by coincidence. Using `pathTail` was correct only for a one-level prefix, which is exactly the depth the one existing test drove. `decodePath` is already imported by `state/objectStore.ts:6` and is `@shared/`, so no new edge. |
| D2 | **The dialog keeps letting the user edit the key freely, and `uploadObject`'s returned path stays `containerSegments + object:key`.** No validation that the typed key still starts with the container's prefix. | The key field is deliberately editable (§8.8: *"a small form (key, content type, both prefilled…)"*) — an upload into a sibling prefix is a legitimate thing to type. Refusing it would be a new restriction nobody asked for. The returned path is only used to open the new object's tab, and a key the user retargeted out of the container simply opens a tab whose path names the container it was uploaded *through* — the same convention the tree has always used for an object node. Making the path track an arbitrary retyped key is a separate question and is listed in §6. |
| D3 | **`views/console/resultPages.ts` gets the prune-not-clear semantics of `views/grid/page.ts`, and `ConsoleResultGrid.vue` calls it from a `visiblePageRowBounds` watch — the same two lines `DataGrid.vue:363-378` already has.** Not "delete `setVisibleWindow` as dead code." | F2. The function is not dead by intent — it is half-wired, and the half that is missing is the one that keeps §2.2's budget. P29 D7 decided prune-over-clear for the grid because a fling crosses many window boundaries that mostly overlap; a console result scrolls the same way and deserves the same answer. Deleting it instead would make the console the one grid in the app that retains every string it has ever decoded, and would need a `§6` entry defending that. |
| D4 | **The stream view's dock is mounted with `:read-only="true"`; the document view's dock is deleted outright.** `StreamView.vue:149-153`'s comment is rewritten to say what is now true. | F3. The two mounts fail P40 D11's test in two different ways and so get two different answers. Stream *does* publish cells and its panel is genuinely a viewer — that is what `readOnly` means. Documents publishes nothing, so the mount is unreachable markup contradicting SPEC.md:552-553; §8.7's reason (*"a document's own row is already the read/write surface, and the panel has no primary key of its own to publish a cell for"*) is a design decision, not an oversight, so the honest change is to stop mounting a dock the view has decided not to use. `cellSelection.ts:24-30`'s comment — which lists "Document/KeyValue/Stream/Console" as future publishers — is corrected to name the two that publish and the one that does not. |
| D5 | **The key/value view keeps its `readOnly`-less mount.** | Not every non-grid mount is a viewer: `KeyValueView.vue:437-461` genuinely sets `onEdit`/`onRevert` for an S3 object's `Body` row, so its dock is a real editor for that row and a per-cell refusal for the others — exactly the case `readOnlyReasonFor` exists to explain. Passing `readOnly` there would hide Beautify and Revert on the one cell in that view that can be written. |
| D6 | **ClickHouse's `quoteIdent` gains the NUL guard; the other three keep theirs.** | F4. Four SQL adapters, one rule. Guarding is the safer of the two ways to end the inconsistency, it matches the majority, and a NUL byte in an identifier is never a legitimate query — every engine here would reject it at the wire anyway, just later and with a worse message. The alternative P39 iteration 3 named (removing the other three) would weaken a security-adjacent check to buy symmetry. |

### Errors reaching the user

| # | Decision | Rationale |
|---|----------|-----------|
| D7 | **A failed action gets its own runtime field and its own strip (`actionError`), not `rt.status = 'error'` + `rt.error`.** | F5/F6. `rt.status`/`rt.error` mean *"the page failed to load"* — every view's own strip, empty state and toolbar reads them that way (`DataView.vue:174-182` renders the strip **instead of** nothing else changing, but `views/grid/state.ts`'s own `load` is the only writer, and a later successful load clears them). A failed commit leaves the page on screen perfectly valid; reusing the load-error slot would make the grid claim its data is broken when only the write was refused. A second, sibling strip says exactly what happened and is cleared by the next successful action or load. |
| D8 | **Every `data.mutate` caller in `src/renderer` is wrapped, including the two `void`-ed ones.** `documents/menu.ts:72` and `browse/menu.ts:130-134` run inside `contextMenu.ts:49`'s `void item.run()`, so the menu item's own `run` must catch. | F6. `state/contextMenu.ts:44-57` deliberately fires menu items as `void item.run()` (a menu item is not an awaitable), so an unhandled rejection there is guaranteed, not merely possible. Fixing it centrally in `contextMenu.ts` (a global catch that logs) was considered and rejected: it would produce a console line, not a message a user can read, and it would hide the same class of bug in every future menu item. The catch belongs where the view that owns the surface can render it. |
| D9 | **No global `unhandledrejection` handler, and no toast system.** | The app has no toast; §8's every error surface is a `MessageStrip` inside the view that owns the action (`DataView.vue:174`, `DocumentView.vue:644`, `StreamView.vue:667`, the three popover error slots). Adding a ninth kind of floating surface for this would be a design change nobody asked for, and a global rejection handler would catch *these* the same way it caught everything else — as an anonymous banner with no idea which tab it belongs to. |

### State reflected everywhere

| # | Decision | Rationale |
|---|----------|-----------|
| D10 | **A filter change clears `rt.count` outright** (`rt.count = null`) in both the grid and the document view — it does not mark it stale. | F7. `stale` (§7) means *"this number was right for this question and may have drifted"* — the pager keeps it greyed with a refresh affordance. A count taken under a different `WHERE` is not a drifted answer to the new question, it is an answer to a different one; showing it greyed would still put a wrong `of M` in the pager and still enable ⏭ to an offset past the end. Clearing it returns the pager to `page N` with no total, which is exactly what §8.5 says the un-counted state looks like (*"until then the pager shows `page N` with no total"*). Projection and sort changes do **not** clear it: neither changes which rows match. |
| D11 | **The document view gains a `resetTokens`, called from all four of its setters, mirroring `views/grid/state.ts:249-253` verbatim.** | F8. The grid's guard exists because a keyset token is only meaningful under the query that produced it; nothing about the document view makes that less true, and `mongo/read.ts`'s `_id` keyset strategy is exactly the case a stale token silently mis-pages. Copying the grid's own three-line function keeps the two views' pagers arguing the same way. |
| D12 | **A connection leaving `connected` unmarks every one of its tabs as hydrated and releases their page bytes.** Wired as a `control.onConnectionState` subscription in `state/tabs.ts`, beside the `onConnectionsChanged` one it already has (`state/tabs.ts:137-143`). | F9. §8.4's reconnect gate is the app's own answer to "this tab's data may no longer be current" — a disconnect is that situation by definition, and today only a *failed read* reaches it. Doing this in `state/tabs.ts` rather than `state/connections.ts` keeps the dependency direction the file already has (`tabs.ts` imports `bridge/control`; `connections.ts` importing `tabs.ts` would be a new upward edge). The **runtime** record is deliberately kept (D13). |
| D13 | **A disconnect releases page bytes but keeps each tab's runtime record** — a new `dropPageStoresForTab` split out of `dropAllPagesForTab`, without the `cleanupTabRuntime` call. | `cleanupTabRuntime` is the *tab closed* signal: it drops the runtime every view keeps its count, selection, find-toolbar state and error in. A disconnected-and-reconnected tab is the same tab and should come back with its find toolbar still open and its column selection intact — only its rows are gone, which is what the reconnect gate is about. Freeing the bytes is the part §2.2 actually asks for, and it mirrors what the engine already does on disconnect (`engine/cache/index.ts:96-101`). |
| D14 | **After a successful mutation, every *other* hydrated tab on the same `(connectionId, path)` reloads** — one `reloadTabsForTarget` helper in `state/viewCommands.ts`, called from `views/grid/state.ts`'s `reloadAfterMutation` and from `views/{documents,keyvalue,stream}/mutations.ts`. | F10. The registry in `viewCommands.ts` already exists to reload a tab by kind from outside its module, and this is the same operation over a set instead of one id. Doing it in each `mutations.ts` (rather than in `bridge/data.ts`'s `mutate` wrapper) keeps the "who reloads" decision with the code that knows the mutation succeeded and which tab performed it. Tabs behind the reconnect gate are skipped: they have no page to correct and will load when pressed. |
| D15 | **A mutation from a key/value tab calls `browseInvalidate(connectionId, pathParent(tab.path))`.** | F11. `browseInvalidate` is P41's own answer to this exact question and already fires-and-forgets when no Browse tab is open (`viewCommands.ts:75-81`), so the call is free when there is nothing to refresh. Three call sites: `keyvalue/mutations.ts`'s `deleteKey` and `addKey`, and `KeyValueView.vue`'s S3 `deleteObject` branch. Not the *edit* path: an edit changes a value, never the level's membership, and `browse/state.ts` renders names only. |
| D16 | **No `browseInvalidate` from the grid/document/stream mutation paths.** | Those engines have no `keyBrowser` container (`caps.keyBrowser` is false for all nine), so there is never a Browse tab whose level their mutations could change. Calling it anyway would be a no-op that reads as if it might matter. |

### Engine

| # | Decision | Rationale |
|---|----------|-----------|
| D17 | **`handleMutate`'s `cache.invalidateAfterMutation` moves into a `finally`, so a failed plan drops the target's pages too.** | F12. Dropping pages that were still correct (the transactional adapters' rollback case) costs one re-read; keeping pages that are now wrong (the six non-transactional adapters' partial-failure case) is a correctness bug that survives until the user happens to press Refresh. The asymmetry decides it. The count's *stale* mark comes along for the same reason — a partially applied plan has changed the row count as surely as a fully applied one. |
| D18 | **The non-transactional adapters are not made transactional.** | Redis, S3, SQS, RabbitMQ and Mongo (for a multi-op plan without a session) have no transaction to wrap a plan in at the protocol level, and ClickHouse's has no per-row addressability to roll back. Inventing compensating writes would be a far larger, far riskier phase than this one, and it is not what the failure mode calls for — the fix is to stop *caching* a lie about what happened, which D17 does. Named in §6 and §8. |

---

## 4. Implementation order

Eleven commits. Each is one sitting, independently reviewable, leaves `lint`/`typecheck` (node,
web, db, electron-db)/`build` green, and carries the spec edits for the behavior *it* changes. The
four inherited items come first (they are the ones a reader is expecting), then the error-surface
work, then the cross-panel state work, then the engine.

1. **`fix(s3): an upload through a nested prefix keeps every ancestor segment`** — D1/D2.
   `workbench/UploadObjectDialog.vue:26-31` (`containerPrefix` rebuilt from `decodePath`, comment
   rewritten to say *ancestor-joined*, not *trailing*). **Spec edits in this commit:**
   `tests/ui/s3.spec.ts:625-660` — descend one level further (`NESTED_PREFIX_PATH`, already a
   constant at `:54`) before opening the upload dialog, and assert
   `upload-key` reads `reports/2024/note.txt`; keep the existing one-level assertion as a second
   step so both depths are covered.
2. **`fix(console): the result grid prunes its decoded-cell cache as it scrolls`** — D3.
   `views/console/resultPages.ts` (`Entry.windowKey` → `windowStart`/`windowEnd`, `setVisibleWindow`
   prunes by row, the `:18-22` comment's *"clears its whole cache on a window change"* sentence
   corrected); `views/console/ConsoleResultGrid.vue` gains the `visiblePageRowBounds` computed and
   the one-line watch, copied from `views/grid/DataGrid.vue:363-378`. No spec edit — §5 says why.
3. **`fix(celleditor): the stream dock is a viewer; the document dock is removed`** — D4/D5.
   `views/stream/StreamView.vue:823` gains `:read-only="true"`, and `:149-153`'s comment is
   rewritten; `views/documents/DocumentView.vue:23,818` drops the import and the mount;
   `views/documents/state.ts:227-229`'s comment corrected; `state/cellSelection.ts:24-30`'s comment
   corrected to name the four real publishers. **Spec edits in this commit:**
   `tests/ui/cell-editor.spec.ts` — the stream step asserts `cell-editor-panel` carries
   `data-read-only="true"` and has **no** `cell-editor-uuid-generate`; `tests/ui/mongo.spec.ts`
   asserts `cell-editor` has count 0 for a document tab with a row selected.
4. **`fix(clickhouse): reject a NUL byte in an identifier`** — D6.
   `engine/adapters/clickhouse/read.ts:18-20`, one line plus the `AdapterError` import if it is not
   already there. **Spec edits in this commit:** `tests/db/clickhouse.spec.ts` gains a NUL-identifier
   assertion — a **new** one: `grep -rn "NUL byte" tests/` is empty today, so none of the four
   adapters' guards has ever been covered, which is part of why the missing one went unnoticed for
   three phases. Drive it through `read()`'s own `ORDER BY` path (`clickhouse/read.ts:98`) and
   expect `E_QUERY`.
5. **`fix(grid): a failed commit reports the server's error in the view`** — D7.
   `views/grid/state.ts` (`actionError` on `DataViewRuntime`, `setActionError`, cleared at the top
   of `load()`); `views/grid/DataToolbar.vue:203-208` (`try`/`catch` around
   `commitPending`+`reloadAfterMutation`); `views/grid/DataView.vue` (the strip, testid
   `data-action-error`). **Spec edits in this commit:** a new second test in
   `tests/ui/sqlite.spec.ts` — stage an insert that violates `order_items`' primary key, commit,
   assert `data-action-error` is visible and contains the server's own message, and assert
   `consoleErrors` stays empty (which is what proves the unhandled rejection is gone);
   `tests/ui/mutations.spec.ts` gains the same assertion on its own read-only-guard step.
6. **`fix(views): every immediate mutation surfaces its own failure`** — D7/D8.
   `views/documents/state.ts`, `views/keyvalue/state.ts`, `views/stream/state.ts`,
   `views/browse/state.ts` each gain `actionError` + `setActionError`; the eight call sites in F6's
   second table are wrapped; `DocumentView.vue`, `KeyValueView.vue`, `StreamView.vue` and
   `BrowseView.vue` each gain the strip. `views/documents/menu.ts:72` and
   `views/browse/menu.ts:130-134` catch inside their own `run`. **Spec edits in this commit:**
   `tests/ui/mongo.spec.ts` (a delete refused by a read-only connection shows
   `document-action-error`), `tests/ui/redis.spec.ts` and `tests/ui/s3.spec.ts` (the same for
   `keyvalue-action-error`) — all Docker-gated, see §5.
7. **`fix(grid,documents): a filter change invalidates the tab's row count`** — D10/D11.
   `views/grid/state.ts:270-274` (`rt.count = null` in `setFilter` only);
   `views/documents/state.ts:201-204` (the same in `setSearch`) plus the new `resetTokens` and its
   four call sites (`:201, :211, :216, :221`). **Spec edits in this commit:** the new
   `tests/ui/sqlite.spec.ts` test from commit 5 gains a count step — press Σ, read
   `toolbar-count`'s tooltip, apply a `WHERE`, assert the count badge no longer reports a total and
   ⏭ is disabled; `tests/ui/data-view.spec.ts:160-190` gains the same around its existing count
   block.
8. **`fix(tabs): a disconnect returns every open tab to Reconnect & load`** — D12/D13.
   `state/tabs.ts` (`dropPageStoresForTab` split out of `dropAllPagesForTab:48-55`; a new
   `control.onConnectionState` subscription beside `:137-143`'s, unmarking hydration and dropping
   page stores for that connection's tabs when `status` is `'disconnected'` or `'error'`).
   **Spec edits in this commit:** the new `tests/ui/sqlite.spec.ts` test gains a disconnect step —
   open the table, disconnect from the tree menu, reconnect from the tree menu, assert the tab
   shows `reconnect-gate` and not `data-grid` until it is pressed.
9. **`fix(tabs): a committed mutation reloads every other tab on the same target`** — D14.
   `state/viewCommands.ts` (`reloadTabsForTarget`, importing `tabsState`/`isHydrated` from
   `./tabs`); `views/grid/state.ts`'s `reloadAfterMutation`, `views/documents/mutations.ts`'s three
   functions, `views/keyvalue/mutations.ts`'s `saveValueEdit`/`deleteKey`,
   `views/stream/mutations.ts`'s four functions each call it after their own `reload`.
   **Spec edits in this commit:** the new `tests/ui/sqlite.spec.ts` test gains a two-tab step —
   open `order_items` twice ("Open data in new tab"), delete a row and commit in one, switch to the
   other, assert the row is gone without a manual Refresh. This is the last step of that test, so
   the mutation runs after every non-mutating assertion in the file.
10. **`fix(keyvalue): a key or object mutation refreshes an open Browse tab`** — D15/D16.
    `views/keyvalue/mutations.ts` (`deleteKey`, `addKey`) and `KeyValueView.vue:320-333`'s S3
    branch each call `browseInvalidate(connectionId, pathParent(tab.path) ?? '')`.
    **Spec edits in this commit:** `tests/ui/redis.spec.ts` and `tests/ui/s3.spec.ts` — with a
    Browse tab sitting on the container level, delete the key/object from its own key/value tab and
    assert the Browse row disappears without a manual Refresh.
11. **`fix(engine): a failed mutation still invalidates the target's cached pages`** — D17/D18.
    `engine/data.ts:133-142` (`try`/`finally` around `runOp`, with the comment stating why a
    non-transactional adapter's partial failure is the case that decides it).
    **Spec edits in this commit:** `tests/db/redis.spec.ts` gains a two-op plan whose second op
    fails, followed by a read that must reflect the first op rather than the cached pre-mutation
    page.

**Docs are deliberately *not* a commit here.** SPEC.md's §10 P43 row and any §8 sentence this round
falsifies are written once, at the end of iteration 3, when the phase's own outcome is known —
the same way P39 recorded all three iterations in one row. This plan file is the only doc this
round commits.

---

## 5. Verification

**Say plainly what this box can and cannot do.** Per AGENTS.md: `bun run lint`, `bun run typecheck`
and `bun run build` all run here. Playwright runs here **only** because the Electron binary is
already installed by hand (`node_modules/electron/dist/electron` exists at `ee9c655`; if a fresh
container loses it, re-install with `curl` per AGENTS.md's "Electron binary" section). It must be
invoked **directly** — `bun run test:ui` fires `pretest:ui` → `scripts/native-electron-build.sh`,
which cannot fetch Electron's C++ headers through this environment's proxy and fails before a
single spec runs. The working invocation here is:

```
bun run build && xvfb-run -a bunx playwright test \
  tests/ui/sqlite.spec.ts tests/ui/startup.spec.ts tests/ui/smoke.spec.ts tests/ui/connections.spec.ts
```

`workbench.spec.ts` and `secrets.spec.ts` also run clean and are worth adding when a change touches
layout or credentials. Every Docker-backed spec self-skips (image pulls return `403` through this
environment's proxy), and `bun test tests/db` cannot run here at all.

| Spec | Runs in this sandbox? |
|---|---|
| `tests/ui/sqlite.spec.ts` | **Yes, for real, unconditionally** — a real SQLite connection, a real tree, a real data grid, a real filter and a real console. It is where commits 5, 7, 8 and 9 get executed coverage. |
| `smoke`, `startup`, `connections`, `workbench`, `secrets` | Yes (no DB). |
| `data-view`, `mutations`, `mongo`, `redis`, `s3`, `clickhouse`, `cell-editor`, `console`, `tree`, … | **No** — Postgres/Mongo/Redis/LocalStack/ClickHouse containers; they `test.skip()` cleanly rather than fail. |
| `tests/db/*` | **No** — Testcontainers, same `403`. |

**Be blunt about the consequence.** Four of this round's eleven commits (5, 7, 8, 9) are verifiable
here *for real* against SQLite; the rest are verifiable here only by
`lint`/`typecheck`/`build` plus careful reading, and their spec edits must be run on a box that can
run them (the macOS/Colima machine or CI) before the round is called finished.

| Commit | What must be re-run green | What it pins |
|---|---|---|
| 1 | `typecheck` here; `s3.spec.ts` elsewhere | An upload from a two-level prefix produces `reports/2024/note.txt` and the tab that opens is the object that was actually created. The retained one-level assertion is what proves the fix did not just move the off-by-one. |
| 2 | `typecheck` + `budgets.spec.ts` elsewhere | **No spec can observe this directly** — `window.__kiraRetainedBytes` (`renderer/main.ts:47-53`) sums page `byteSize`, not decode caches, so a pruned cache and an unpruned one report the same number. Verified by reading the diff against `views/grid/page.ts:43-57` and by `budgets.spec.ts`'s scroll-response budget staying green (the guard that the added watch costs nothing per frame). Stated rather than papered over. |
| 3 | `typecheck` here; `cell-editor.spec.ts`, `mongo.spec.ts`, `kafka.spec.ts`, `sqs.spec.ts` elsewhere | The stream dock renders `data-read-only="true"` with no reason chip and no edit-only affordances; no document tab renders a `cell-editor` at all; the other three mounts are untouched (the console still passes `true`, the grid and key/value still pass nothing). |
| 4 | `typecheck` (all four) here; `tests/db/clickhouse.spec.ts` elsewhere | A NUL-bearing identifier is refused with `E_QUERY` before it reaches the wire, exactly as it is for the other three SQL adapters. Note that this is the **first** test of any of the four guards — `grep -rn "NUL byte" tests/` is empty at `ee9c655`. |
| 5 | `sqlite.spec.ts` **here, for real** | A failed commit prints the server's message in `data-action-error`, the staged set survives, and `consoleErrors` is empty — the last of those is the assertion that the unhandled rejection is actually gone rather than merely accompanied by a strip. |
| 6 | `typecheck` here; `mongo.spec.ts`, `redis.spec.ts`, `s3.spec.ts`, `sqs.spec.ts` elsewhere | Every destructive action in every view has somewhere to put a failure. `grep -rn "data\.mutate" src/renderer` — every caller is inside a `try` or is a function whose own caller is. |
| 7 | `sqlite.spec.ts` **here, for real**; `data-view.spec.ts`, `mongo.spec.ts` elsewhere | After a `WHERE`, the pager shows no total and ⏭ is disabled; after Σ again it shows the *new* filter's total. A projection or sort change leaves the count alone — the assertion that D10 stayed narrow. |
| 8 | `sqlite.spec.ts` **here, for real**; `startup.spec.ts` **here**; `leaks.spec.ts` elsewhere | Disconnect → every tab of that connection is regated; reconnect from the tree → still regated until pressed; press → fresh rows. `startup.spec.ts` is what proves the restore path is unchanged, and `leaks.spec.ts` that no runtime record leaked (D13 keeps them deliberately, so `__kiraTreeConnectionIds` is unchanged). |
| 9 | `sqlite.spec.ts` **here, for real**; `mutations.spec.ts`, `mongo.spec.ts` elsewhere | A commit in tab A corrects tab B with no user action. The `exceptTabId` skip is what keeps tab A on `reloadAfterMutation`'s `scope: 'pages'` invalidate rather than double-reloading it with the `scope: 'all'` one (P13 D18 — a double reload would erase the stale count mark a moment after it was set). |
| 10 | `redis.spec.ts`, `s3.spec.ts` elsewhere | Deleting a key/object from its own tab updates the Browse panel that navigated there. |
| 11 | `tests/db/redis.spec.ts`, `tests/db/postgres.spec.ts` elsewhere | A partially applied plan no longer leaves a stale page in L2; a rolled-back Postgres plan still reads the same rows back (the assertion that the extra invalidation costs correctness nothing). |

**Manual click-through afterwards (a human or an agent on a box with real containers)** —
half of this round is about what happens *between* panels, which no single spec sees end to end:

1. Open the same table in two tabs. Delete a row in one and commit. Switch: the other tab has
   already corrected itself.
2. Press Σ, then type a `WHERE` that matches a handful of rows: the total disappears rather than
   lying, and ⏭ greys out. Press Σ again: the new, correct total.
3. Stage an edit that will be refused (a NOT NULL violation) and commit: the message appears above
   the grid, verbatim, and the staged edit is still there to fix.
4. Disconnect a connection with three tabs open, then reconnect it from the tree: all three still
   say Reconnect & load. Press one: fresh rows, and its find toolbar is still open where it was.
5. Browse an S3 bucket down two prefix levels and upload: the key is prefilled with the full
   `a/b/` prefix, the object lands there, and the tab that opens shows its body.
6. Open a Browse tab on a Redis database, open a key from it, delete the key from the key tab:
   the Browse row is gone when you switch back.
7. Click a stream message's cell: the panel shows the value with no Beautify, no Revert, no byte
   badge, no modified chip — and, on a read-only connection, no "Connection is read-only" chip.
8. Click a document row: no cell-editor panel appears at all.

---

## 6. Explicitly out of scope

- **Making the six non-transactional adapters' `mutate()` atomic** (D18). Redis, S3, SQS, RabbitMQ,
  Mongo and ClickHouse have no protocol-level transaction over a multi-op plan; compensating writes
  are a phase of their own. §8.
- **A toast/notification system** (D9). Every error in this app lives in the view that produced it.
- **Validating that an upload's typed key still lives under the container it was launched from**
  (D2), and making `uploadObject`'s returned tab path track a retargeted key. §8.
- **Truncation reporting for a browsed level** — P41 §6 declined it and `adapter.ts:138-141` gates
  the `Adapter.children()` widening it needs behind amending P1's plan first. Unchanged here.
- **Unifying `state/tabs.ts`'s `skipUnchanged` split** (F13). Verified as a cleanliness question
  with no behavior behind it; P39's remit, not this phase's.
- **`useRunState`'s newest-record-wins lookup** (`state/runState.ts:38`). Two concurrent ops tagged
  with the same `tabId` (a slow Σ plus a fast page) make the toolbar ring read idle while the
  slower one is still running. Real, but marginal, and it needs a live two-op race to verify — not
  something to change on reading alone. Handed to iteration 2.
- **`main/ipc/{app,engine,layout,settings}.ts` using raw `ipcMain.handle` instead of
  `ipc/errors.ts`'s wrapped `handle()`.** Checked: none of those four handlers throws anything
  carrying a `.code`, so the wrapper would add nothing today. A consistency item, not a bug.
- **Candidates checked and discarded as *not* bugs**, recorded so iteration 2 does not spend the
  time again:
  - `state/connections.ts:192`'s `patchConnectionFields` sending `password: null` — that is the
    three-state convention's *"unchanged"* (`main/connections.ts:267-284`), and
    `storage/repos/connections.ts:14-17` never touches the password column at all.
  - `views/grid/pendingChanges.ts:182-198`'s `buildPlan` silently dropping an op whose
    `primaryKeyOf` is null — unreachable: hiding the PK needs a projection change, and
    `views/grid/state.ts:83`'s `load()` calls `clearPending(tabId)` before any such reload.
  - `views/console/state.ts:131-138`'s unbounded result-set accumulation in append mode — opt-in
    per tab (P40 D6), each set closable with its own ×.
  - `src/preload/index.ts`'s listener symmetry — P39 iteration 3 collapsed all nineteen onto
    `onSignal`/`onEvent` (`:35-45`), and every one returns its own `off`. Re-read in full: nothing
    left half-wired.

---

## 7. Acceptance checklist

- [ ] `grep -n "pathTail" src/renderer/workbench/UploadObjectDialog.vue` returns nothing; the key
      prefilled from a `bucket/prefix:a/prefix:b` level reads `a/b/<filename>`, and
      `tests/ui/s3.spec.ts` asserts both the one-level and the two-level case.
- [ ] `grep -rn "setVisibleWindow" src/renderer` shows **two** definitions and **two** callers.
- [ ] `grep -rn "CellEditorDock" src/renderer` shows four mounts (grid, key/value, stream, console),
      of which stream and console pass `read-only`; `views/documents/` has none.
- [ ] All four SQL adapters' `quoteIdent` open with the same NUL-byte guard.
- [ ] `grep -rn "data\.mutate" src/renderer` — every call site is inside a `try`/`catch` whose
      `catch` writes an `actionError` (or a popover's own error ref).
- [ ] A failed commit renders `data-action-error`, keeps the staged set, and adds nothing to
      `consoleErrors`. Asserted in `tests/ui/sqlite.spec.ts`, run **for real** in this sandbox.
- [ ] Applying a `WHERE` clears the tab's count in both the grid and the document view; applying a
      projection or a sort does not.
- [ ] `views/documents/state.ts` has a `resetTokens` called by all four of its setters.
- [ ] Disconnecting a connection regates every one of its tabs, frees their page bytes, and keeps
      their runtime records; `leaks.spec.ts`'s hooks are unchanged in shape.
- [ ] A commit in one tab corrects every other hydrated tab on the same `(connectionId, path)`, and
      the committing tab itself is still reloaded exactly once, with `scope: 'pages'`.
- [ ] Deleting a Redis key or an S3 object from its own tab refreshes an open Browse tab sitting on
      its container level.
- [ ] `engine/data.ts`'s `handleMutate` invalidates in a `finally`.
- [ ] `git diff` for this round touches **no** file under `src/main/storage/migrations/`,
      `src/preload/`, `src/shared/protocol/`, `biome.json` or `package.json`, and adds no
      dependency.
- [ ] **No `data-testid` was removed or renamed anywhere.** The set only grows.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` clean
      after **every** commit; `sqlite`/`startup`/`smoke`/`connections` green **in this sandbox**;
      the full `test:ui` suite and `bun test tests/db` green on a box that can run them before the
      round is called done.

---

## 8. What is left, and who owns it

**Handed to iteration 2 (to be re-verified against the tree this round leaves, not taken on trust):**

1. **`state/runState.ts:38`'s newest-record-wins lookup** (§6). A slow op masked by a faster
   sibling on the same tab makes the toolbar ring lie. Needs a two-op race to confirm.
2. **The metadata cache now holds levels nothing renders** — P41 §8 item 2, untouched here. Every
   level a Browse tab visits is written to `metadata_cache` by `main/tree-service.ts:77-94` with no
   size budget and no per-connection cap.
3. **A browsed level still truncates silently** — P41 §8 item 1, untouched here.
   `redis/catalog.ts`'s SCAN round cap and `s3/catalog.ts:15`'s `MAX_LIST_ROUNDS` both stop early
   and return what they have, and `TreeNode` has no field to say so.
4. **The engine, `main/`, and the adapters' `read.ts` pagination edges got a lighter pass than the
   renderer this round.** The renderer is where the user's own framing pointed hardest
   (panel-to-panel, state reflection, error surfacing) and where twelve of thirteen findings landed,
   but that is a statement about where this round *looked*, not proof that `read.ts`'s keyset
   fallbacks are clean. Iteration 2 should start there.
5. **P42 lands in between.** Its own list touches the console result strip, the Mongo console's
   result rendering, the cell editor's format picker, grid selection and the find scanner —
   iteration 2 is the first round that can review that work, and should.

**Handed to P44 (sparse unit tests):**

6. `views/console/resultPages.ts`'s `setVisibleWindow` pruning is the clearest unit-test candidate
   this round produces — pure, total, and provably invisible to every DOM-level assertion the suite
   can make (§5, commit 2).
7. `UploadObjectDialog.vue`'s ancestor-prefix join is the same shape of pure function, and its bug
   survived a thorough UI spec precisely because the spec only ever drove one depth (F1a).

**Decided here, not deferred:**

8. **A failed action gets its own strip, not the load-error strip** (D7) — the page on screen is
   still valid when a write is refused, and saying otherwise would be a second false statement on
   top of the silence this round removes.
9. **A disconnect regates tabs but keeps their runtimes** (D12/D13) — the bytes are what §2.2 asks
   to free; the find toolbar, the selection and the count are what makes the tab the same tab when
   it comes back.
10. **`state/tabs.ts`'s `skipUnchanged` split is not a bug** (F13) — P39 iteration 1 asked this
    phase to settle it, and it is settled: neither branch can produce a wrong persisted record or a
    lost save. Written down here so it is not asked a fourth time.
