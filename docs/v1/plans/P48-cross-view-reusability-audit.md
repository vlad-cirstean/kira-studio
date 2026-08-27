# P48 — Cross-view reusability audit: what is actually shared, what only looks shared, and what a fix in one view still fails to reach

> Not a SPEC §10 deliverable. A user-directed, post-v1 **audit-and-refactor**, and a direct
> follow-up to P39's three-iteration modularity pass — six-plus phases of console/grid/Mongo work
> have landed on top of P39's own tree since, and the deliverable here is the drift that accreted
> in them, extracted for real where the duplication is real.
>
> **Charter, verbatim (SPEC.md §10's P48 row).** *"…a user-directed, post-v1 audit-and-refactor of
> the six data-view kinds (grid/SQL, console, document/Mongo, keyvalue, stream, definition), their
> `ViewChrome`-based toolbars, and the backend engine-adapters layer, looking for logic and
> components that are duplicated rather than genuinely shared. Named examples to start from: the SQL
> grid's DataGrid/cell-editor pairing versus the console's read-only SQL result rendering (only
> partially unified so far, by P40); the Mongo document view's row/expand-collapse handling versus
> the console's Mongo result rendering (P46 added expand-all/collapse-all to the console separately
> rather than sharing the document view's own implementation); toolbar button ordering and
> composition, which currently differs across every ViewChrome consumer; non-UI logic (loaders,
> connection gates, mutation/error handling, projection/pagination helpers) revisited for drift
> accrued since P39's own pass; and the same duplication question applied to the backend adapters
> (postgres/mysql-family/sqlite/clickhouse/mongo/redis/kafka/sqs/s3/rabbitmq). The deliverable is an
> actual refactor extracting genuinely shared, configurable primitives where the duplication is
> real — not a forced merge where two things only look alike."*
>
> **Trigger, verbatim.** *"User-reported: a fix or improvement made in one data view isn't reflected
> in its siblings, because what looks like one shared component is often two independently-
> maintained ones; queued as a follow-up to P39 now that six-plus phases of console/grid/Mongo work
> since P39 landed have had time to accrete new, un-audited duplication."*
>
> **P39's three plans are the baseline this measures drift against**
> (`docs/v1/plans/P39-modularity-and-cleanliness{,-iter2,-iter3}.md`). Everything P39 already
> extracted — `views/shared/page/`'s seven modules, `useConnectionGate`, `createRuntimeStore`,
> `classifyLoadError`/`stopOp`, `createPageStore`, `createPageSearch`, `patchTabState`,
> `state/viewCommands.ts`, and the engine's `sql-text.ts`/`sql-mutate.ts`/`errors.ts` root modules —
> is **out of bounds for re-proposal**. This plan names only what those passes left behind or what
> P40–P47 added on top of them. Where a P39 extraction turns out to have held perfectly, that is
> recorded as a non-finding (F35–F37) rather than quietly re-litigated.
>
> **This plan says "no" four times on purpose.** F34–F40 are candidates that were checked against
> the current tree and deliberately *not* extracted, each with the reason. One of the charter's own
> four named examples (the DataGrid/ConsoleResultGrid pairing) is **largely refuted** — see §1.B.
> P47's own precedent stands: a documented "this does not hold up" is a legitimate deliverable, and
> a manufactured extraction is not.

## 0. Ground rules for this phase

- **Zero behaviour change except where a finding names one.** This is a structure phase in P39's
  tradition. Exactly two steps change what a user can observe, and both are named as such up front:
  §4 step 10 (a superseded count can currently land on a document/key-value/stream tab, because
  P43's `countOpId` guard was added to the grid alone) and §4 step 14's documented 1 px border
  change (D9). Nothing else moves a pixel or a message.
- **Every `data-testid` survives, byte for byte, with two named exceptions.** D6 lists them
  (`document-prev` → `document-pager-prev`, `document-next` → `document-pager-next`), both proven
  unreferenced by any spec with a grep recorded in that decision. No other id is renamed, added or
  removed. Where a shared component would otherwise swallow an id, the id moves onto the shared
  component as a prop (D8's `toolbarTestid`/`toolbar2Testid`), never disappears.
- **Extract only what two call sites actually wrote out the same way.** A "configurable primitive"
  with more knobs than call sites is a forced merge with extra steps. Every extraction below either
  (a) removes a byte-identical body, or (b) removes a body that differs in exactly one named
  dimension, which becomes exactly one parameter. Anything needing three or more per-caller knobs is
  in §1.G as a non-finding instead.
- **Every commit leaves `bun run lint`, `bun run typecheck` (all four projects — `node`, `web`,
  `db`, `unit`; `package.json:22-26`) and `bun run build` green.** `tests/unit/` must stay green
  too and is runnable here (`bun test tests/unit`, ~1 s, no Docker): `sql-text.spec.ts` covers §4
  steps 4–6's file directly, `view-state.spec.ts` drives `views/keyvalue/state.ts`'s and
  `views/browse/state.ts`'s `load()` through steps 8–10, and `scan.spec.ts` covers step 13's
  `views/shared/page/scan.ts`. `tests/db/`, `tests/electron-db/` and `tests/ui/` cannot run in this
  sandbox (AGENTS.md's Docker/Electron notes) — they are unchanged by this phase apart from step
  10's one behavioural fix, and §5 says what a machine with Docker must re-run before this is called
  done.
- **No new dependency.** Nothing here needs one.
- Comments per AGENTS.md: only where the code cannot say it for itself. Each new shared module gets
  one header comment naming the copies it replaces (P39's own convention, so the next audit can tell
  extraction from coincidence); the call sites lose the comments that used to explain the copy.
- Conventional Commits, one per step of §4: `refactor(...)`, `fix(...)`, `build(lint):`, `docs:`.

---

## 1. Findings

Verified against the tree at `fa67924` (branch `claude/phase-only-48-d9mokq`, equal to
`origin/feature/kickoff`'s tip). Every line reference below was read, not remembered.

### A. The `ViewChrome` layer — six consumers and one holdout

**F1 — the grid is not a `ViewChrome` consumer at all, and hand-rolls three of its four bands.**

`grep -rn "ViewChrome" src/renderer` returns six mounting sites — `DocumentView.vue:514`,
`KeyValueView.vue:568`, `StreamView.vue:472`, `DefinitionView.vue:136`, `ConsoleView.vue:260`,
`BrowseView.vue:134` — and **not** `views/grid/DataView.vue`. The grid instead assembles the same
chrome by hand:

| ViewChrome does | The grid does the same thing at |
|---|---|
| `<ViewHeader …>` with conn dot/engine icon/target/badges/`#trailing` (`ViewChrome.vue:40-54`) | `DataView.vue:122-148` — the same `ViewHeader` primitive, the same props, its own badge list |
| `<div class="p-toolbar-rail" :style="{'--kira-rail': connColorVar(...)}"/>` (`ViewChrome.vue:56`) | `DataView.vue:152-153` — the same element, the same `connColorVar` call |
| Refresh + Stop in a leading `.group`, Stop tinted `is-live` while cancellable (`ViewChrome.vue:57-73`) | `DataToolbar.vue:249-265` — same two `IconButton`s, same icons, same `is-live` class, same disabled rule |
| `<RunState :status :elapsed-ms>` last, after the `p-push` (`ViewChrome.vue:79-82`) | `DataToolbar.vue:417-423` — same primitive, same `useRunState(...)` source, and a comment that says so |
| `useRunState(() => props.tab.id)` (`ViewChrome.vue:36`) | `DataToolbar.vue:81` |
| `connectionRecord(props.tab.connectionId)` (`ViewChrome.vue:34`) | `DataToolbar.vue:64`, `DataView.vue:32` |

`ViewChrome.vue:11-15`'s own header comment states the reason the Refresh/Stop pair lives in the
chrome: *"six views implementing it separately is exactly how three of them drifted into showing
Stop only while running instead of merely disabling it."* The grid is the seventh view, and it is
the one still implementing it separately. **Genuine duplication.** `ViewHeader.vue:8-11`'s comment
— *"The grid (Main.html) has no view-head; it opens straight on its toolbar, so DataView.vue doesn't
use this component"* — is now **stale**: `DataView.vue:122` mounts exactly that component.

**F2 — the grid's toolbars read global state where every sibling reads a prop.** `DataToolbar.vue:51`
and `FilterToolbar.vue:18` both do `const tab = computed(() => activeDataTab.value)` and then guard
every handler on `tab.value` being non-null. This is safe only because `MainView.vue:68` keys
`DataTabView` by `activeTab.id` and mounts it solely while that tab is active — so `activeDataTab`
is always `props.tab`. Every other view's toolbar markup lives inside the per-tab component and
reads `props.tab` directly. The nullable-tab plumbing (14 `if (!tab.value) return` guards in
`DataToolbar.vue` alone) exists only because of the divergence, not because of a real case.

**F3 — the whole toolbar composition, side by side.** `sep` = a `<div class="sep"/>`; `→` = the
order as rendered.

| View | Band 1 | Band 2 |
|---|---|---|
| grid (`DataToolbar.vue:244-424`) | [Refresh, Stop] → sep → pager(first, prev, page-input, next, last) → page-size → sep → [count, columns] → sep → [add, delete, search] → push → [pending chip, preview, discard, commit] → RunState | `FilterToolbar.vue` — history, WHERE, ORDER BY, Clear |
| documents (`DocumentView.vue:532-654`) | [Refresh, Stop] → sep → pager(first, prev, page-input, next, last) → sep → page-size → sep → [count, fields, expand-all, collapse-all] → sep → [add, search] | history, filter, SORT, Clear |
| keyvalue (`KeyValueView.vue:602-748`) | [Refresh, Stop] → sep → [prev, status, next] → sep → page-size → sep → [count] → sep → [add, edit, delete, download, search] | — |
| stream (`StreamView.vue:496-570`) | [Refresh, Stop] → sep → [count, status, poll\|next] → page-size *(no sep)* → sep → [add, delete, search] | Kafka only: history, offset, partitions, timestamp |
| console (`ConsoleView.vue:279-333`) | [Refresh, Stop] → Run → Run all → sep → new-result toggle → sep → Saved queries → sep → search | — |
| definition (`DefinitionView.vue:158-192`) | [Refresh, Stop] → sep → [pane segmented] … `#toolbar-end`: Copy, Open in console | — |
| browse (`BrowseView.vue:146-181`) | [Refresh, Stop] → Up → breadcrumb → sep → filter → upload → push count | — |

The charter's claim that "toolbar button ordering and composition differs across every ViewChrome
consumer" is **confirmed, but the useful part of it is narrower than it sounds.** Four of the seven
rows genuinely differ because the views genuinely differ (a console has no pager; a definition tab
has no rows to count; a Browse level has no page size). The two rows that differ *without* a reason
are:

- the grid's missing leading `sep` semantics — it opens `[Refresh, Stop] → sep`, exactly like
  documents/keyvalue/stream, but implements the group itself (F1);
- the stream's page-size picker sitting outside a `sep` boundary that every sibling puts it inside
  (`StreamView.vue:530-536` vs `DocumentView.vue:583-588`, `KeyValueView.vue:630-638`). One
  missing `<div class="sep"/>`.

**F4 — the pager is written twice, and the two copies disagree about their own icons.**
`DataToolbar.vue:269-314` and `DocumentView.vue:537-580` render the same five controls in the same
order, and `DocumentView.vue:213-214`'s own comment says so outright: *"Mirrors DataToolbar.vue's
own pageDisplay/pageInputValue/pageCount/onJump exactly."* The supporting script is duplicated too —
`DataToolbar.vue:83-99,130-135` vs `DocumentView.vue:215-228`: `pageDisplay`, the
`pageInputValue` mirror ref (with the whole seven-line comment about not fighting the user's typing
living only in the grid's copy), `pageCount`, and `onJump`.

The icons drifted:

| Button | grid | documents |
|---|---|---|
| First | `chevron-left` (`:271`) | `chevron-left` (`:539`) |
| Previous | `chevron-left` (`:279`) | `arrow-left` (`:546`) |
| Next | `chevron-right` (`:300`) | `arrow-right` (`:569`) |
| Last | `chevron-right` (`:307`) | `chevron-right` (`:575`) |

So the grid renders **two identical `chevron-left` glyphs side by side** for First and Previous, and
two identical `chevron-right` for Next and Last, while the document list renders four distinguishable
glyphs. `keyvalue` (`KeyValueView.vue:611,621`) and `stream` (`StreamView.vue:519`) also use
`arrow-left`/`arrow-right` for prev/next. The grid is the outlier, and it is the outlier in the
direction of being harder to read. **This is the user-reported bug class, exactly: an improvement
made in one data view that never reached its sibling.** Genuine duplication.

**F5 — the `SearchToolbar` sits in three different places.** `DataView.vue:159-167` mounts it inside
the toolbar band; `DocumentView.vue:707-715` mounts it in ViewChrome's `#strips`;
`KeyValueView.vue:817-825` mounts it *inside the `v-else` body*, below the reconnect gate, so a
gated key/value tab cannot show a find widget while its siblings can. `ConsoleView.vue:430-438`
mounts it in the results body. Three placements, one component. Not extracted here (§1.G, F38) — the
placement is a per-view layout decision and only the key/value one is arguably wrong; fixing that is
a behaviour change this structure phase does not own.

### B. Named example 1 — `DataGrid.vue` vs `ConsoleResultGrid.vue`. **Largely refuted.**

**F6 — the two grids are not two copies of one grid, and merging them would be the forced merge the
charter warns about.** Read side by side:

| | `DataGrid.vue` (2155 lines) | `ConsoleResultGrid.vue` (681 lines) |
|---|---|---|
| Virtualization | rows **and columns**, `@tanstack/vue-virtual`, `rangeExtractor` seam, `paddingStart` gutter (`:379-402`, P47) | rows only, `VirtualList`, every column rendered per row (`:308-336`) |
| Positioning | absolute `top`/`left` from `offsets` + `GUTTER_WIDTH`, `contain: layout` | plain flex row, `width` per cell |
| Selection | four-shape union (`state.ts:19-23`), drag-select, keyboard extend, end-cap geometry (`:568-574`) | one `ref<{row,col}|null>` "last click" (`:225-230`) |
| Editing | inline `<input>`, `stageEdit`/`discardCellEdit`, pending-delete/insert overlays | none — read-only by construction (P40 D11) |
| Column widths | persisted per tab + drag-resize + reorder | measured once per page, never stored |
| Cell-editor publish | a `watch` on selection × pageVersion × tabId × dragActive, with `onEdit`/`onRevert` (`:604-656`) | a click handler, no `onEdit` (`:251-268`) |
| Page kinds | tabular only | tabular **or** document **or** keyvalue (three template branches) |

`ConsoleResultGrid.vue:34-40`'s own header already argues this: *"A lightweight, read-only sibling of
DataGrid.vue — not a retrofit of it… reusing it here would mean stripping most of it back out."*
That argument holds on re-inspection. **Verdict: refuted. No component merge, and no "configurable
DataGrid".** The charter's own sentence — *not a forced merge where two things only look alike* — is
the finding here.

What *is* genuinely duplicated between them is four small, specific things, all of which the code
itself already flags as drift risks:

**F7 — `headerTitleFor` is written twice and its own comment predicts the re-drift.**
`DataGrid.vue:126-143` and `ConsoleResultGrid.vue:71-86` build the same
`{title, meta, metaColor, body}` tooltip object. `ConsoleResultGrid.vue:68-70`: *"structured the
same way DataGrid.vue's own twin changed with it — deliberately the same shape minus the comment,
so the two can't re-drift the way P40 D16 already closed once."* The pair has already drifted once
(P40 D16), been re-synced twice (P42 D19/D20, then the P46-7 regression pass, which had to make the
identical `typeClassColor(col.typeClass)` change in both files), and is still two bodies. The single
real difference: the grid overlays DESCRIBE-derived `dataType` and the column's DB `comment`
(`:135,137`); the console has neither, because `execute()` never consults a catalog. That is exactly
one parameter. **Genuine duplication.**

**F8 — the search match index is written three times, byte-identical.**
`DataGrid.vue:661-668`, `KeyValueView.vue:511-517` and `ConsoleResultGrid.vue:217-223` each declare:

```ts
const matchIndex = computed(() => {
  const entry = searchState[tabId];
  if (!entry) return null;
  const set = new Set<string>();
  for (const m of entry.matches) set.add(`${m.row}:${m.col}`);
  return { set, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});
```

Same seven lines, same `${row}:${col}` key, same "rebuilt only when the search result changes"
comment in all three. Only the *consumers* differ (the grid maps display→page column first; keyvalue
keys `col` as `'field'|'value'`; the console keys it as a number) — the index itself does not.
`DocumentView.vue:335-346`'s equivalent is genuinely different (keyed by row, holding match ranges
for the `<mark>` preview) and is **not** part of this. **Genuine duplication, three copies.**

**F9 — the tabular row scanner is written twice, and the key/value one three times.**
`views/grid/search.ts:40-47` and `views/console/search.ts:66-72` are the same per-row loop over a
`TabularPage`'s chunks (null-skip, decode, `eachMatch`, push `{row, col, start, end}`).
`views/keyvalue/search.ts:46-52` and `views/console/search.ts:97-101` are the same two-chunk
field/value scan, differing only in whether `col` is `'field'|'value'` or `0|1`. All four also
repeat the same four-line early-out (`if (!page || q.text === '') return { cancel(){}, done:
Promise.resolve([]) }`) — five copies counting `documents/search.ts:42-44`. **Genuine duplication.**

Also noted while reading: the width fallback is spelled three different ways for the same concept —
`DataGrid.vue:163` `?? 96`, `ConsoleResultGrid.vue:102` `?? 96` **and** a literal `56` gutter seed,
against `views/shared/page/columns.ts:61`'s own `?? MIN_WIDTH` (= 64). `56` is `DataGrid.vue:60`'s
`GUTTER_WIDTH`, restated as a bare number in `ConsoleResultGrid.vue:102` and again as
`width: 56px` in its CSS (`:507-510`). Unreachable in practice (`initialWidths` returns a width for
every page column), so this is a latent inconsistency rather than a live bug — but three spellings
of two constants across two files that must agree is precisely what a shared module is for.

### C. Named example 2 — the Mongo document row, twice. **Confirmed, with a split verdict.**

**F10 — the document row's markup is duplicated, down to five shared `data-testid`s.**
`DocumentView.vue:799-825` and `ConsoleResultGrid.vue:397-419` render the same head: an
`.expand-toggle` button carrying `data-testid="document-toggle-expand"` with a
`chevron-down`/`chevron-right` swap, `.doc-id` (`data-testid="document-id"`), a `{{ fieldCount }}
fields` badge (`document-field-count`), a byte badge (`document-byte-badge`), and a conditional
`truncated` badge (`document-truncated`). **Both files emit the same five ids** — the console's copy
inherits the document tab's own test hooks verbatim, which is what a copy-paste leaves behind and
what a shared component would give you honestly.

**F11 — nine CSS rules are duplicated, and one of them has already drifted.**

| Rule | `DocumentView.vue` | `ConsoleResultGrid.vue` | Same? |
|---|---|---|---|
| `.doc-row` | `:988-992` | `:581-586` | yes (+ `cursor: default`) |
| `.doc-head` | `:994-1002` | `:592-600` | **no** — `padding: 0 var(--kira-s-4)` vs `0 var(--kira-s-3)` |
| `.doc-head:hover` | `:1004-1006` | `:602-604` | yes |
| `.doc-row.open > .doc-head` | `:1008-1010` | `:606-608` | yes |
| `.doc-row.selected > .doc-head` | `:1015-1017` | `:613-615` | yes |
| `.doc-row.search-match` | `:1022-1024` | `:617-619` | yes |
| `.doc-row.search-match-current` | `:1026-1028` | `:621-623` | yes |
| `.expand-toggle` | `:1052-1062` | `:625-635` | yes |
| `.doc-id` | `:1064-1073` | `:637-646` | yes (property order differs) |

Eight byte-identical rules and one that differs by a single spacing step — an unnoticed 2 px
difference in the head's horizontal padding between the same row in two views. **Genuine
duplication.**

**F12 — but the expansion *state* is genuinely two different models, and merging them would be a
forced merge.** `views/documents/state.ts:271-301`: a **persisted** `tab.state.expanded` record
where *absent means expanded* (P27 D2), so `setAllExpanded(…, true)` clears the map outright to
avoid writing 10 000 keys into `state_json`. `views/console/state.ts:49-89`: a **runtime-only**
`Set<string>` keyed `` `${resultKey}:${docId}` `` where *absent means collapsed* (P42 D11), so
`setAllResultDocsExpanded(…, true)` adds every id and collapse prunes by prefix. Opposite defaults,
opposite storage, opposite scope keys, opposite lifetimes — and each has a recorded reason. The
charter's framing ("P46 added expand-all/collapse-all to the console separately rather than sharing
the document view's own implementation") is **half right**: sharing the *state model* would be
wrong; sharing the *row that reads it* is right. A shared row component that takes `expanded` as a
prop and emits `toggle` is precisely the "configurable primitive" split.

**F13 — the unparseable-body fallback has drifted, and unifying it would break an asserted
behaviour.** `DocumentView.vue:886` renders a read-only `CodeMirrorHost` for a body that failed to
parse (D22's fallback); `ConsoleResultGrid.vue:430` renders a plain `<pre class="doc-body-text">`.
`tests/ui/mongo.spec.ts:401` asserts the document tab's truncated row shows a `.cm-editor`, and
`:360` asserts the whole 1000-row list contains **zero** `.cm-editor` at page size 1000 (P27 D24's
tripwire). Unifying on `<pre>` breaks `:401`; unifying on CodeMirror puts an editor instance into
the console's own result list, which can be just as long. **Not unified** — it stays a per-caller
slot, and this plan says so rather than pretending the drift is fixable for free.

### D. Named example 3 — toolbar ordering and composition

Covered by F1–F5 above. The extractable core is: the grid becomes a `ViewChrome` consumer (F1),
which by construction gives it the same Refresh/Stop/RunState/rail/header as its six siblings; and
the pager becomes one component (F4), which by construction settles the icon drift. Everything else
in F3's table differs for a real reason and stays.

### E. Named example 4 — non-UI logic, re-audited against P39's baseline

**F14 — `load()`'s failure tail is written out four times, byte-identical.**
`views/grid/state.ts:145-162`, `views/documents/state.ts:108-122`,
`views/keyvalue/state.ts:117-131`, `views/stream/state.ts:125-139`:

```ts
if (rt.opId !== opId) return;
rt.opId = null;
const failure = classifyLoadError(err);
if (failure.kind === 'cancelled') { rt.status = 'cancelled'; return; }
if (failure.kind === 'disconnected') { unmarkHydrated(tabId); return; }
rt.status = 'error';
rt.error = { code: failure.code, message: failure.message };
```

P39 F12/F13 extracted the *classification* (`classifyLoadError`) precisely because *"the reaction
genuinely differs per caller"* (`viewOp.ts:6-9`) — and at the time it did: the console's disconnected
branch sets `status = 'idle'` first (`console/state.ts:260-269`), and browse's uses `loadSeq` instead
of `opId` (`browse/state.ts:86-96`). But the *other four* reactions are now identical, verbatim,
including comment-free. One parameter — an optional "on disconnected, first…" hook — covers the
console's one extra line. **Genuine duplication, four copies, accrued around a P39 extraction that
stopped one level short.**

The op-start preamble is the same story: `rt.status='loading'; rt.opId=opId; rt.error=null;
rt.actionError=null;` after a `crypto.randomUUID()` appears identically at
`grid/state.ts:106-110`, `documents/state.ts:78-82`, `keyvalue/state.ts:87-91`,
`stream/state.ts:77-81`.

**F15 — `setActionError` is five identical four-line functions.** `grid/state.ts:76-79`,
`documents/state.ts:60-63`, `keyvalue/state.ts:57-60`, `stream/state.ts:67-70`,
`browse/state.ts:56-59` — each `const rt = runtime[tabId]; if (rt) rt.actionError = message;`, each
with its own P43-F6/D7 doc comment explaining the same thing. All five runtimes declare
`actionError: string | null` in the same position. `createRuntimeStore` (P39 iter3's own factory,
`viewOp.ts:50-64`) is already the shared owner of these records and could hand back the setter.
**Genuine duplication.**

**F16 — `onToggleSearch` is five copies and `onCloseSearch` four.** `DataToolbar.vue:136-139`,
`DocumentView.vue:272-275`, `KeyValueView.vue:496-499`, `StreamView.vue:391-394`,
`ConsoleView.vue:153-156`; close at `DocumentView.vue:277-280`, `KeyValueView.vue:500-503`,
`ConsoleView.vue:157-160`, `DataView.vue:114-117`. One-line bodies — thin, but this is exactly the
mass `stopOp` (P39 F13, one line × five) was extracted at, and the same five runtimes carry the
same `searchOpen` field.

**F17 — `runCount` is three identical copies, and all three are missing the guard the fourth has.**
`documents/state.ts:132-149`, `keyvalue/state.ts:141-157` and `stream/state.ts:149-165` are the same
body modulo which `filter` they pass. `grid/state.ts:193-216` is that same body **plus** a
`countOpId` supersession guard (`:198,211`) and a `refresh: rt.count?.stale === true` flag, added by
P43 F7/D10 for a real bug: *"A filter change since this count started already cleared
rt.count/countOpId — an answer to the previous WHERE landing now would resurrect a total for the
wrong query."* The document view has exactly the same hazard — `documents/state.ts:226-233`'s
`setSearch` clears `count` (`:230`) and then loads, and a `runCount` already in flight against the
previous filter will overwrite that `null` with a stale total when it lands. The key/value and
stream views have no filter to change but do have Refresh, and the same late-response race.

**This is the user-reported symptom in its purest form: a fix landed in the grid in P43 and never
reached its three siblings, because the four `runCount`s are four bodies, not one.**

**F18 — the immediate-mutation writers are nine functions with one body.**
`views/documents/mutations.ts` (3 functions), `views/keyvalue/mutations.ts` (3),
`views/stream/mutations.ts` (4). Every one of them is:

```ts
const tab = findXTab(tabId);
if (!tab?.connectionId) return;
await data.mutate({ opId: crypto.randomUUID(), tabId, connectionId: tab.connectionId, path: tab.path, ops });
await reload(tabId);
reloadTabsForTarget(tab.connectionId, tab.path, tabId);
```

Only the `ops` array differs. Two of the nine add a tail (`keyvalue/mutations.ts:59`'s
`browseInvalidate`, and `addKey` at `:87-97`, which opens a new tab instead of reloading) — one
optional hook. `keyvalue/mutations.ts:7-8` and `stream/mutations.ts:6` both say in prose that they
mirror `documents/mutations.ts`'s discipline. **Genuine duplication, nine call sites.**

**F19 — there are now three page stores where P39 left one factory and two exceptions, and the two
exceptions have converged on each other rather than on the factory.**

| Store | Decode cache | Window pruning | Scope key |
|---|---|---|---|
| `views/shared/page/store.ts:8-65` (P39 F9) | flat `Map<string,string>`, key `` `${field}:${row}` `` | none | tabId |
| `views/grid/page.ts:4-83` | two-level `Map<row, Map<col,string>>` | `setVisibleWindow` (P29 D7), `:48-57` | tabId |
| `views/console/resultPages.ts:9-101` | two-level `Map<row, Map<subKey,string>>` | `setVisibleWindow` (P43 F2/D3), `:92-101` | `${tabId}:result:${seq}` |

`resultPages.ts:23-26`'s own comment says it is *"the same one-line memo views/shared/page/store.ts's
own `cached()` runs for the other three stores. Not built on that factory: this store keys by
`${tabId}:${...}` rather than `tabId`, and holds a `Page` union."* Neither stated reason survives
inspection: the factory's scope key is already an opaque `string`, and it is already generic over the
page type (`createPageStore<P extends {rowCount, byteSize}>`). The **real** difference is the pair of
things `grid/page.ts` and `resultPages.ts` share and the factory lacks — the two-level cache and
`setVisibleWindow`. P29 gave the grid one; P43 gave the console the other, by copying the grid's.
`documents/page.ts`, `keyvalue/page.ts` and `stream/page.ts` never got either. **Genuine
duplication, and post-P39 drift by construction.** (Adding pruning to the factory is behaviour-neutral
for the three views that never call `setVisibleWindow`: an un-pruned cache is what they have today.)

**F20 — `pathPrefix` is written twice, identically.** `DataView.vue:58-67` and
`DocumentView.vue:136-145`: decode the path, drop the last segment, prepend the connection name,
join with `' / '`. Byte-identical apart from how each reaches `connectionRecord`. The other four
views compute a genuinely different prefix (`BrowseView.vue:42`, `StreamView.vue:68`,
`KeyValueView.vue:96-100`, `DefinitionView.vue`'s `breadcrumb`) and stay as they are.

### F. `engine/adapters/` — the third pass since P39

**F21 — the mid-flight cancellation check is open-coded twenty-six times.**

```
$ grep -rho "if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');" src/engine/adapters
     26 (identical)
```

Across 14 files in 8 adapters: `kafka/read.ts` ×6, `redis/read.ts` ×6, `s3/read.ts` ×3,
`redis/{catalog,console,mutate}.ts` ×1 each, `s3/{catalog,mutate,transfer}.ts` ×1 each,
`sqs/read.ts`, `mongo/console.ts`, `clickhouse/console.ts`, `mysql-family/console.ts`,
`postgres/console.ts` ×1 each.

P39 iter3 F17/D15 extracted `assertNotCancelled(ctx)` (`errors.ts:59-63`) — but that is the
**pre-flight** check, and it throws a *different* message: `'operation was cancelled before it
started'`. P39 preserved that message byte-for-byte and (correctly) did not fold the 26 mid-flight
copies into it. So this is not a re-proposal of P39's extraction: it is its unswept sibling, and
four of the 26 sit in files that already `import { assertNotCancelled }` two lines away
(`postgres/console.ts:9,151`, `mysql-family/console.ts:10,149`, `clickhouse/console.ts`,
`mongo/console.ts`). **Genuine duplication, twenty-six copies, one exact message.**

**F22 — the abort/settle race is written six times.** `postgres/query.ts:80-106` and `:133-159`,
`postgres/console.ts:50-76`, `mysql-family/query.ts:84-110` and `:136-162`,
`mysql-family/console.ts:79-105`. Each is the same 26-line `new Promise` with a `settled` latch, an
`onAbort` that rejects `E_CANCELLED`, `addEventListener('abort', …, {once: true})`, and a
`then`/`catch` pair that each remove the listener, call `release`, and resolve or `reject(mapError(err))`.
The three differences: the resolved value (`result.rows` / `rows` / the raw result), whether
`release` is optional (`release?.()` in postgres, `release()` in mysql-family), and which adapter's
`mapError` is called. All three are parameters; none is a reason for six bodies. **Genuine
duplication.** These are the only two callback-style drivers in the tree (`pg`, `mariadb`) — the
other nine adapters use `AbortSignal` natively — so the helper has six call sites and will not grow;
that is a reason to keep it small, not a reason not to write it.

**F23 — the "whole result, no paging" `PagePosition` is written ten times.**

```ts
{ offset: 0, pageSize: <n>, hasMore: false, nextToken: null, prevToken: null, strategy: 'offset' }
```

`sql-text.ts:142-149` (inside `singleStatusPage`), `postgres/console.ts:108-115`,
`mysql-family/console.ts:127-134`, `clickhouse/console.ts:62-69`, `sqlite/console.ts:53-60`,
`mongo/console.ts:77-84` and `:93-100`, `redis/console.ts:76-83`, `redis/read.ts:75-82`,
`s3/read.ts:117-124`. Ten copies of a six-field literal whose only variable is `pageSize`. It spans
SQL and non-SQL adapters alike, so its home is the wire shape itself
(`shared/protocol/page.ts`, beside `pagePositionSchema` at `:72` and the four page builders at
`:333+`), not any adapter-side module. **Genuine duplication.**

**F24 — the SQL keyset read path is three near-identical bodies, and P39 extracted only its
smallest pieces.** P39 hoisted `resolveProjection`, `safeInt`, `computeEffectiveOrder`,
`buildOrderBy`, `buildKeysetPredicate` and the token codec into `sql-text.ts`. What it left in
`postgres/read.ts:56-249`, `mysql-family/read.ts:44-219` and `sqlite/read.ts:70-228`:

| Block | postgres | mysql-family | sqlite | Same? |
|---|---|---|---|---|
| keyset-unsupported throw | `:72-77` | `:63-68` | `:86-91` | byte-identical (6 lines) |
| hidden tiebreaker columns + `fetchColumns` + `keysetColumnIndex` | `:81-96` | `:70-85` | `:93-102` | identical except sqlite's rowid-aware column resolver (`:53-68`) |
| `reverseRows` + scan-term direction flip + `orderBySql` | `:131-144` | `:110-123` | `:127-139` | byte-identical (13 lines) |
| `probedExtra` / `keptRows` | `:190-191` | `:167-168` | `:179-180` | byte-identical |
| `keysetValuesOf` | `:203-211` | `:180-188` | `:191-198` | identical except the per-driver cell→text step |
| `strategy` / `hasMore` / `nextToken` / `prevToken` / `position` | `:215-243` | `:189-215` | `:200-225` | byte-identical (28 lines) |
| `countRows`'s WHERE + SQL assembly + numeric parse | `:247-273` | `:217-243` | `:230-247` | identical modulo the relation name and the driver call — `clickhouse/read.ts:181-206` shares the tail too |

That is roughly **75 lines repeated three times** on top of what P39 already shared, in the single
most correctness-sensitive path in the engine (a wrong `prevToken` silently pages a user past rows).
The variable parts are exactly three: the qualified-name string, the driver call, and the cell→text
codec. **Genuine duplication.**

Two smaller ones in the same layer:

- `primaryKeyFromIndexes` is byte-identical in `postgres/catalog.ts:258-260` and
  `mysql-family/catalog.ts:188-190`, and the seven lines after it that derive `columns` / `pkColumns`
  / `nullableByName` / `uniqueKeys` are byte-identical too (`postgres/catalog.ts:283-290`,
  `mysql-family/catalog.ts:325-331`).
- `if (!this.<handle>) throw new AdapterError('E_CONNECT', 'adapter is not connected');` appears in
  ten adapters (`clickhouse:254`, `kafka:139`, `mongo:229`, `mysql-family:372`, `postgres:368`,
  `rabbitmq:190`, `redis:155`, `s3:147`, `sqlite:266`, `sqs:140`), same message every time.

**F25 — the layering lint rule has a hole the seventh view folder falls through.**
`biome.json:79-90`'s `views/<kind>/*` sibling-import group lists `grid`, `documents`, `keyvalue`,
`stream`, `console`, `definition` — but **not `browse`**, which P41 added after P39 iter3 wrote the
rule. `grep -rn "\.\./browse/" src/renderer/views` outside `views/browse/` returns nothing today, so
there is no violation to fix — only a rule that has stopped covering the tree it was written for.

**F26 — one stale comment.** `ViewHeader.vue:8-11` states the grid does not use `ViewHeader`;
`DataView.vue:122` mounts it. (P39 iter3 corrected eighteen comments of this class; this is a new
one, introduced when the grid grew a view head.)

### G. Non-findings — checked, and deliberately not extracted

**F27 — the two grids' cell-editor pairing.** Refuted in F6. The grid publishes through a `watch`
over a four-shape selection union with `onEdit`/`onRevert` closures into `pendingChanges.ts`; the
console publishes from a click handler with neither, by design (P40 D11). There is no shared body.

**F28 — `ColumnsMenu.vue` vs `ProjectionMenu.vue`.** Five scoped CSS rules are byte-identical
(`.columns-menu-inner`/`-header`/`-loading`/`-list`/`-footer`) and `.columns-menu-item` differs by
one `gap` line. The *scripts* are not duplicated: `ColumnsMenu.vue` carries drag-reorder
(`:66-82`), PK pinning (`:17-19,44`), and order/projection diffing (`:55-64,84-105`) that
`ProjectionMenu.vue` has no equivalent of; `ProjectionMenu.vue:18-22` deliberately snapshots its
candidate list where the grid's is a computed, and says why. Moving five CSS rules into
`primitives.css` costs a class rename in both templates and buys five rules. **Not extracted.**

**F29 — `keyvalue`/`stream` do not join the shared pager (F4).** Neither has first/last/jump: a
Redis `SCAN` cursor and a Kafka offset window have no addressable page N, and
`KeyValueView.vue:604-608`/`StreamView.vue:504-527` put a status line *between* prev and next where
the pager puts a page-jump input. A pager component that can also be a two-button strip with a text
node in the middle has more configuration than call sites. **Not extracted.**

**F30 — the document search scanner is not the console's document scanner.**
`documents/search.ts:51` scans `previewLineFor(doc.body)` — whitespace-collapsed, matching exactly
the string the collapsed row renders under `<mark>` (P31 D20) — while `console/search.ts:83` scans
the raw `page.bodies` chunk. Two different haystacks for two different renderings. Unifying them
would either break the document row's `<mark>` offsets or change what the console finds.
**Not extracted.**

**F31 — the expansion state models (F12).** Not merged; only the row that reads them is.

**F32 — `runRaw`/`buildPage`/`execute` across the six `console.ts` modules.** Beyond the shared
pieces already named (F21's cancel check, F22's abort race, F23's position literal, and P39's own
`singleStatusPage`), each `buildPage` maps a *different driver's* result shape to columns
(`pg`'s `fields[].dataTypeID` + a `pg_type` lookup; `mariadb`'s `FieldInfo` + a wire-type
vocabulary; ClickHouse's JSON meta; `node:sqlite`'s dynamic values; Mongo's shell values; Redis's
reply types). The two lines they share — `if (statements.length === 0) throw …` and
`ctx.setCommand(statements.join(';\n'))` — sit inside six otherwise-different `execute()` bodies.
**Not extracted** (a two-line preamble helper would add an import to six files to save twelve lines).

**F33 — `'connect probe returned no rows'` × 4.** `postgres/index.ts:61`, `mysql-family:73`,
`sqlite:50`, `clickhouse:64`. A single `if (!row) throw` line inside four `connect()` bodies that
otherwise share nothing (different probe SQL, different `ConnectInfo` details). Below the bar that
`unsupported()` (16 copies) and `assertWritable()` (10 copies) were extracted at. **Not extracted.**

**F34 — the adapter capability stubs.** `describe`/`definition`/`downloadObject`/`execute` refusals
already go through P39's `unsupported()`/`noQueryConsole()` in every adapter; re-checked, no drift.
**Nothing to do.**

**F35 — the reconnect gate has not drifted at all.** P39 iter2's `useConnectionGate` is called by
all seven views (`DataView.vue:25`, `DocumentView.vue:90`, `KeyValueView.vue:57`,
`StreamView.vue:89`, `DefinitionView.vue:31`, `ConsoleView.vue:45`, `BrowseView.vue:24`) and
`refreshOrReconnect` by all six that have a Refresh button. Zero hand-rolled copies remain. The
`ReconnectGate` primitive is mounted from six views and nowhere else. **A P39 extraction that held
perfectly — recorded so the next audit does not re-check it from scratch.**

**F36 — `patchTabState` and `createRuntimeStore` held too.** `state/tabs.ts:555-596`'s seven patchers
are still one body plus a documented per-caller flag; all six view state modules still build their
runtime through `createRuntimeStore` (`viewOp.ts:50`). No copies have reappeared.

**F37 — `createPageSearch` held.** All four paged views still assemble their `PageSearchApi` through
the factory (`grid/search.ts:60`, `documents/search.ts:67`, `keyvalue/search.ts:67`,
`console/search.ts:112`), and `SearchToolbar.vue` still imports no view-specific module. Only the
*scanners* underneath it drifted (F9).

**F38 — the `SearchToolbar`'s three mount points (F5).** A layout decision per view; the one that
looks wrong (key/value's, inside the gated body) is a behaviour change, not a structure one.
**Out of scope, recorded in §9.**

**F39 — `DataGrid.vue`'s own size.** 2155 lines is the largest file in the renderer, but it is one
component doing one job with no internal duplication that this audit found. Splitting it is a
different phase with a different justification. **Out of scope.**

**F40 — the console's result grid renders every column of every visible row** (no column
virtualization, `ConsoleResultGrid.vue:323`). That is a performance question, not a duplication one,
and P47's own §6 already owns the "does the library go anywhere else" question (SPEC §10's P49 row
names it explicitly). **Out of scope, recorded in §9.**

---

## 2. Shapes introduced in this plan

### 2.1 `src/engine/adapters/errors.ts` — two additions

```ts
/** Adapter rule 2's *mid-flight* check, the sibling of assertNotCancelled above: twenty-six
 *  identical copies across eight adapters (F21). The message differs from assertNotCancelled's on
 *  purpose — that one reports a cancel that landed *before* the call started. */
export function throwIfCancelled(ctx: OpCtx): void {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
}

/** The "did connect() ever run" guard ten adapters open their private handle accessors with. */
export function requireConnected<T>(handle: T | null | undefined): T {
  if (!handle) throw new AdapterError('E_CONNECT', 'adapter is not connected');
  return handle;
}
```

### 2.2 `src/engine/adapters/abort.ts` (new)

```ts
/** The abort/settle race the two callback-style drivers (pg, mariadb) each wrote out three times
 *  (F22). `start()` is the driver call; `release` is the query-tracker's own release, run on every
 *  exit; `mapError` is the adapter's own. Resolves the driver's raw result — every caller's own
 *  `.rows`/`.affectedRows` narrowing stays at the call site. */
export function withAbortRace<T>(
  ctx: OpCtx,
  start: () => Promise<T>,
  opts: { release?: () => void; mapError: (err: unknown) => unknown },
): Promise<T>;
```

### 2.3 `src/shared/protocol/page.ts` — one addition

```ts
/** A page that is the whole result: no offset, no continuation, nothing more to fetch. Ten
 *  adapters' console/read paths wrote this literal out by hand (F23). */
export function unpagedPosition(rowCount: number): PagePosition;
```

### 2.4 `src/engine/adapters/sql-text.ts` — the keyset read path (F24)

```ts
export function assertKeysetSupported(wantsKeyset: boolean, isTextSort: boolean, eligible: boolean): void;

/** projected columns + whichever tiebreaker columns were not projected, plus the name→fetch-index
 *  map the token builder needs. `resolveHidden` defaults to a lookup over `all` that throws
 *  `keyset tiebreaker column not found: <name>`; sqlite passes its rowid-aware resolver. */
export function resolveFetchColumns(
  projected: ColumnMeta[], all: ColumnMeta[], order: EffectiveOrder,
  resolveHidden?: (name: string) => ColumnMeta,
): { fetchColumns: ColumnMeta[]; keysetColumnIndex: Map<string, number> };

/** The scan ORDER BY: a text sort verbatim, else the effective terms with every direction flipped
 *  when the fetch runs backwards for a `before` cursor. */
export function buildScanOrderBy(
  sort: SortSpec | null, order: EffectiveOrder, reverseRows: boolean, quote: (s: string) => string,
): string;

/** hasMore / nextToken / prevToken / strategy and the PagePosition they go into — D7's whole
 *  forward-and-backward token rule, once. `cellAt` is the driver's own cell→text step. */
export function buildKeysetPosition<Row>(args: {
  cursor: PageCursor; pageSize: number; displayRows: Row[]; probedExtra: boolean;
  order: EffectiveOrder; keysetColumnIndex: Map<string, number>; fingerprint: string;
  cellAt: (row: Row, index: number) => string | null;
}): PagePosition;

/** `WHERE (<filter>)` or ''. Parenthesised — §5b step 4. */
export function whereClause(filter: string | null): string;

/** count(*)'s scalar, with the shared non-numeric refusal. */
export function parseCountValue(raw: unknown): number;

export function primaryKeyFromIndexes(indexes: IndexMeta[]): string[] | null;

/** columns marked with isPrimaryKey + the PK + the all-NOT-NULL unique indexes, from one raw
 *  column list and one index list (F24's second bullet). */
export function resolveKeyShape(
  rawColumns: ColumnMeta[], indexes: IndexMeta[],
): { columns: ColumnMeta[]; primaryKey: string[] | null; uniqueKeys: string[][] };
```

### 2.5 `src/renderer/views/shared/viewOp.ts` — grown into the per-tab op vocabulary

```ts
export function createRuntimeStore<R>(makeDefault: () => R): {
  runtime: Record<string, R>;
  ensureRuntime(tabId: string): R;
  /** F15: the same four-line setter five state modules wrote out. Present only when R carries the
   *  field, enforced by the R constraint at the call site. */
  setActionError(tabId: string, message: string | null): void;
  toggleSearchOpen(tabId: string): void;   // F16
  setSearchOpen(tabId: string, open: boolean): void;
};

/** F14: status/opId/error/actionError at the start of a load, and the op id it stamped. */
export function beginOp(rt: { status: string; opId: string | null; error: unknown; actionError?: string | null }): string;

/** F14: the four-view failure tail. Returns false when the result was superseded (the caller
 *  returns immediately); `onDisconnected` is the console's one extra line. */
export function applyLoadFailure(
  rt: LoadRuntime, opId: string, err: unknown, tabId: string,
  opts?: { onDisconnected?(): void },
): void;
```

### 2.6 `src/renderer/views/shared/page/store.ts` — one store for five page modules (F19)

`createPageStore<P>` gains the two-level decode cache and window pruning `grid/page.ts` and
`console/resultPages.ts` each grew separately:

```ts
export interface PageStore<P extends { rowCount: number; byteSize: number }> {
  readonly pageVersion: { n: number };
  bumpPageVersion(): void;                 // console/state.ts's setActiveResult (P40 D9)
  setPage(scope: string, page: P): void;
  getPage(scope: string): P | null;
  drop(scope: string): void;
  dropForPrefix(prefix: string): void;     // resultPages.ts's dropForTab
  totalRetainedBytes(): number;
  /** row → subKey → text. `subKey` is a column index, or 'id'/'body'/'field'/'value'. */
  cached(scope: string, row: number, subKey: string, decode: (d: TextDecoder) => string): string;
  /** P29 D7 / P43 F2-D3: prune to the visible row window instead of clearing. */
  setVisibleWindow(scope: string, startRow: number, endRow: number): void;
}
```

### 2.7 `src/renderer/views/shared/immediateMutation.ts` (new, F18)

```ts
/** The nine-call-site body behind documents/keyvalue/stream's mutations.ts: resolve the tab, one
 *  data.mutate, reload, then tell every sibling tab on the same target. */
export function createImmediateMutator<T extends { connectionId: string | null; path: string }>(opts: {
  findTab(tabId: string): T | null;
  reload(tabId: string): Promise<void>;
}): (
  tabId: string,
  ops: MutationRowOp[],
  after?: (tab: T & { connectionId: string }) => void | Promise<void>,
) => Promise<void>;
```

### 2.8 `src/renderer/views/shared/page/Pager.vue` (new, F4)

Props `pageIndex`, `pageSize`, `count: number | null`, `hasMore`, `testidPrefix`, `lastTooltip`,
`strategy?`; emits `first`, `prev`, `next`, `last`, `jump(pageIndex)`. Owns `pageDisplay`, the
`pageInputValue` mirror ref and its watcher, `pageCount`, and `onJump` — the four duplicated
computeds of F4.

### 2.9 `src/renderer/views/shared/document/DocumentRow.vue` (new, F10–F12)

Root `<div class="doc-row">`, carrying every rule of F11's table. Props `view: DocumentRowView`,
`scope: string` (a tab id or a result key — `views/shared/document/rows.ts`'s existing registered-
source key), `expanded`, `selected`, `searchMatch`, `searchMatchCurrent`. Emits `toggle`, `select`.
Slots: `#actions` (documents' edit/delete/editing chip; the console passes none) and `#body` (each
view's own expanded body, per F13). Renders the head — expand toggle, `.doc-id`, field-count, byte
and truncated badges — with all five `data-testid`s unchanged.

### 2.10 `src/renderer/views/shared/page/columns.ts` and `search.ts` — small additions

```ts
// columns.ts (F9)
export const GUTTER_WIDTH = 56;
export const DEFAULT_COLUMN_WIDTH = 96;
export function columnHeaderTooltip(
  col: { name: string; typeClass: TypeClass }, dataType: string, comment?: string | null,
): { title: string; meta?: string; metaColor?: string; body?: string };

// search.ts (F8)
export function createMatchIndex<C>(
  state: Record<string, { matches: { row: number; col: C }[]; index: number }>,
  tabId: () => string,
): ComputedRef<{ has(row: number, col: C): boolean; isCurrent(row: number, col: C): boolean } | null>;

// scan.ts (F9)
export function emptyScan<M>(): SearchHandle<M>;
export function tabularRowScanner<M>(page: TabularPage, make: (row, col, start, end) => M): RowScan<M>;
export function keyValueRowScanner<M, C>(page: KeyValuePage, cols: [C, C], make: …): RowScan<M>;
```

### 2.11 `src/renderer/theme/primitives/ViewChrome.vue` — two optional props (D8)

`toolbarTestid?` / `toolbar2Testid?`, applied to its own two `.p-toolbar` bands, so the grid's
`data-testid="data-toolbar"` and `"filter-toolbar"` survive the move into the slots.

---

## 3. Decisions

**Engine**

- **D1.** `throwIfCancelled` keeps the message `'operation was cancelled'` verbatim and lives beside
  `assertNotCancelled`, which keeps `'operation was cancelled before it started'`. Two functions,
  two messages, because they answer two different questions and both messages are already on the
  wire. Merging them would change 26 or 9 user-visible strings for tidiness.
- **D2.** `withAbortRace` resolves the driver's **raw** result rather than taking an extractor
  callback. Six call sites each do their own one-line narrowing afterwards; a callback would put a
  closure between the driver and the promise for no gain.
- **D3.** `unpagedPosition` goes in `shared/protocol/page.ts`, not under `engine/adapters/`. Ten
  callers span SQL and non-SQL adapters, and the thing it constructs is a wire shape that already
  lives there beside its own Zod schema and its four builders. No adapter-side module can be
  imported by all ten without becoming a junk drawer.
- **D4.** The F24 helpers go into the existing `sql-text.ts`, not a new file. Its own header already
  scopes it to *"the genuinely shared, driver-agnostic SQL text/planning glue"*; `resolveProjection`
  and `computeEffectiveOrder` are already planning rather than text, and `resolveKeyShape` is the
  same kind of thing one layer up. A fifth root module for two catalog functions would cost more
  than it explains. The header comment is widened to say `read.ts` **and** `catalog.ts`.
- **D5.** `buildKeysetPosition` is generic over the row type with a `cellAt` callback, so
  `sqlite/read.ts`'s `toCellText` and the two text-mode drivers' raw `(string|null)[]` rows both fit
  without the helper knowing anything about a driver. ClickHouse does **not** call it — it is
  offset-only by construction (`clickhouse/read.ts:113-116`) and has no keyset path to share. It
  does adopt `whereClause` and `parseCountValue`.

**Renderer**

- **D6.** The shared `Pager.vue` derives its ids as `${prefix}pager-first|prev|page-input|next|last`
  and `${prefix}pager` for the container. With `prefix=''` every grid id is unchanged
  (`pager`, `pager-first`, `pager-prev`, `pager-page-input`, `pager-next`, `pager-last`); with
  `prefix='document-'`, `document-pager`, `document-pager-first`, `document-pager-page-input` and
  `document-pager-last` are unchanged, and exactly two ids change: `document-prev` →
  `document-pager-prev` and `document-next` → `document-pager-next`. Both were proven unreferenced:
  `grep -rn "document-prev\|document-next" tests/ src/` returns only the two `.vue` lines being
  changed. These are the only two id changes in the phase.
- **D7.** The shared pager uses `chevron-left` (First), `arrow-left` (Previous), `arrow-right`
  (Next), `chevron-right` (Last) — the document view's spelling, which is also key/value's and
  stream's for prev/next (F4). The grid's two duplicate glyph pairs go away. Only icon names already
  used in the tree are used; `node_modules` is not installed in this sandbox, so no new codicon name
  is introduced on faith.
- **D8.** `ViewChrome` gains `toolbarTestid`/`toolbar2Testid` rather than the grid's toolbars keeping
  their own `.p-toolbar` wrappers inside ViewChrome's bands. Nesting `.p-toolbar` inside `.p-toolbar`
  would double the 28 px height and the border; a prop moves the id onto the band that is actually
  the toolbar.
- **D9.** Making `FilterToolbar` the grid's `#toolbar-2` gives it `.p-toolbar.last`
  (`primitives.css:507-509`), so **the grid's filter row loses its 1 px bottom border** — matching
  the document view's filter row, which is the same band in the same slot. This is the phase's only
  pixel change and it is deliberate: the alternative is a `keepBorder` prop on `ViewChrome`, which
  re-introduces per-view divergence in the component whose entire purpose is to remove it. Recorded
  in §8's checklist so it is verified as intended rather than discovered later.
- **D10.** `DataToolbar.vue` and `FilterToolbar.vue` take `tab` as a required prop and stop reading
  `activeDataTab` (F2). Fourteen nullable-tab guards go away, and the grid's toolbars stop being the
  only ones that could, in principle, render for a tab other than their own.
- **D11.** `DocumentRow.vue` takes `expanded` as a prop and emits `toggle` — the two expansion state
  models (F12) stay exactly where they are. This is the split the charter asks for: the row is the
  shared, configurable primitive; the store behind it is not, and forcing one would break either
  P27 D2's persisted default-expanded map or P42 D11's runtime per-result set.
- **D12.** `.doc-head`'s horizontal padding resolves to `var(--kira-s-4)` — the document view's
  value. P42 D11's own comment says the console's row *mirrors* the data tab's; where they disagree,
  the mirrored one is the copy.
- **D13.** The unparseable-body fallback stays per-caller in the `#body` slot (F13). Unifying on
  `<pre>` breaks `tests/ui/mongo.spec.ts:401`; unifying on `CodeMirrorHost` puts an editor instance
  in the console's own long result lists, which is the thing P27 D24's tripwire at `:360` exists to
  prevent. Naming the drift and leaving it is more honest than closing it wrong.
- **D14.** `createPageStore` gains window pruning for every caller, including the three that never
  call `setVisibleWindow`. For those three the cache simply never prunes — byte-for-byte today's
  behaviour — so this is not a silent perf change smuggled into a structure phase.
- **D15.** The `countOpId` guard (F17) is ported to documents/keyvalue/stream as a **`fix:`** commit
  of its own (§4 step 10), separate from the `refactor:` that makes the three `runCount`s one body.
  A behaviour change and a structural change in one commit is a commit nobody can revert half of.
- **D16.** `applyLoadFailure` takes an `onDisconnected` hook rather than folding the console's
  `status = 'idle'` line into the shared body. `console/state.ts:260-267` records exactly why that
  line exists (a Stop button left permanently red); the hook keeps the reason at the site that has
  it.
- **D17.** `views/browse/**` joins `biome.json`'s sibling-import group (F25). The edit is inside the
  **existing** `src/renderer/views/**` override — no new override block, so P39 iter3's
  overlapping-`includes` trap (a later broad override silently replacing a narrow one's patterns
  while `lint` stays green) is not in play. Verified by adding a throwaway
  `views/console/x.ts → ../browse/state` import, confirming `bun run lint` fails, and removing it.
- **D18.** No shared "view state module" base class or generic `createPagedViewState` factory. The
  four `load()` bodies differ in six named places (the grid clears pending changes and validates the
  page strategy and lazily describes; key/value re-bases a cursor-paged reload; stream sets `polled`
  and builds a Kafka filter and clears `selectedRow`; documents does none of these) — a factory
  covering all six would take six callbacks, which is a forced merge with a factory's face on. The
  extraction stops at the two blocks that are byte-identical (F14) and the setters that are
  (F15/F16/F17).

---

## 4. Implementation order

Engine first (no UI to eyeball, and `tests/unit/sql-text.spec.ts` covers steps 4–6 directly), then
the renderer, largest structural move before the smaller ones that land on top of it. Each step is
one commit unless it says otherwise, and each leaves `lint` / `typecheck` (four projects) / `build`
green.

**1. `refactor(adapters): one mid-flight cancellation check instead of twenty-six`** (F21, D1)
Add `throwIfCancelled` to `engine/adapters/errors.ts`. Replace all 26 open-coded copies across
`kafka/read.ts` (6), `redis/read.ts` (6), `s3/read.ts` (3), `redis/{catalog,console,mutate}.ts`,
`s3/{catalog,mutate,transfer}.ts`, `sqs/read.ts`, `mongo/console.ts`, `clickhouse/console.ts`,
`mysql-family/console.ts`, `postgres/console.ts`. Drop the now-unused `AdapterError` import from any
file that had no other use for it (Biome's `noUnusedImports` will name them). Message unchanged, so
`grep -rn "'operation was cancelled'" src/engine/adapters` afterwards returns only `errors.ts`,
`abort.ts`'s future home (step 2), `rabbitmq/errors.ts:38` and the six abort-race rejects.

**2. `refactor(adapters): one abort/settle race behind the two callback-style drivers`** (F22, D2)
New `engine/adapters/abort.ts` with `withAbortRace`. Rewrite the six sites — `postgres/query.ts:80`,
`:133`, `postgres/console.ts:50`, `mysql-family/query.ts:84`, `:136`, `mysql-family/console.ts:79` —
each becoming a `withAbortRace(ctx, () => …, { release, mapError })` plus its own one-line
narrowing. `release?.()` vs `release()` collapses into the optional `release` field.

**3. `refactor(protocol): one unpaged page position instead of ten`** (F23, D3)
Add `unpagedPosition(rowCount)` to `shared/protocol/page.ts`. Adopt it at all ten sites of F23,
including inside `sql-text.ts:142-149`'s `singleStatusPage`. `tests/unit/sql-text.spec.ts` exercises
`singleStatusPage`'s neighbours and must stay green.

**4. `refactor(adapters): the SQL read path's keyset planning moves into sql-text.ts`** (F24, D4/D5)
Add `assertKeysetSupported`, `resolveFetchColumns` and `buildScanOrderBy`. Adopt in
`postgres/read.ts`, `mysql-family/read.ts` and `sqlite/read.ts`; sqlite passes its existing
`resolveKeysetColumnMeta` (`sqlite/read.ts:53-68`) as `resolveHidden`. Nothing else moves in this
commit.

**5. `refactor(adapters): one keyset page position behind postgres, mysql and sqlite`** (F24, D5)
Add `buildKeysetPosition`. Replace the three copies of the 28-line
`strategy`/`hasMore`/`nextToken`/`prevToken`/`position` block and the three `keysetValuesOf`
closures. `cellAt` is `(row, i) => row[i]` for postgres/mysql-family and
`(row, i) => toCellText(row[i])` for sqlite. Add a `tests/unit/sql-text.spec.ts` case per D7
direction (an `after` page, a `before` page, an offset page at 0 and at >0) — the file already owns
the keyset-eligibility assertions this sits directly under, and this is the one block in the phase
where a mistake silently mis-pages a user rather than failing loudly.

**6. `refactor(adapters): one count-result parse and one WHERE clause`** (F24, D5)
Add `whereClause` and `parseCountValue`. Adopt in `postgres/read.ts`, `mysql-family/read.ts`,
`sqlite/read.ts` and `clickhouse/read.ts` — both in `readPage` (the filter) and in `countRows` (the
filter plus the numeric parse). sqlite's `typeof raw === 'bigint' ? Number(raw) : Number(raw)`
(`sqlite/read.ts:242`) is the same expression twice and collapses into `parseCountValue`'s body.

**7. `refactor(adapters): one connected-handle guard and one key-shape resolution`** (F24)
Add `requireConnected` to `errors.ts` and adopt it in the ten `requireX()`/accessor bodies. Add
`primaryKeyFromIndexes` and `resolveKeyShape` to `sql-text.ts`, delete both copies from
`postgres/catalog.ts` and `mysql-family/catalog.ts`, and re-point their `getReadTarget`s. Update
`sql-text.ts`'s header comment to say it serves `read.ts` **and** `catalog.ts` (D4).

**8. `refactor(views): the per-tab runtime store owns actionError and the search flag`** (F15/F16)
`createRuntimeStore` returns `setActionError`, `toggleSearchOpen` and `setSearchOpen`. Delete the
five `setActionError` bodies (`grid`, `documents`, `keyvalue`, `stream`, `browse` state modules) —
each keeps its one-line re-export so no importer changes — and route the five `onToggleSearch` /
four `onCloseSearch` handlers through the store. `tests/unit/view-state.spec.ts` touches
`keyvalue/state.ts` and `browse/state.ts` and must stay green.

**9. `refactor(views): one load-op preamble and one load-failure tail`** (F14, D16/D18)
Add `beginOp` and `applyLoadFailure` to `viewOp.ts`. Adopt in `grid/state.ts:106-162`,
`documents/state.ts:78-122`, `keyvalue/state.ts:87-131`, `stream/state.ts:77-139`, and in
`console/state.ts:218-273` with `onDisconnected: () => { rt.status = 'idle'; }`.
`browse/state.ts:74-96` is **not** touched: it supersedes by `loadSeq`, not `opId`, and has no
`E_CANCELLED` branch (D18).

**10. `fix(views): a superseded count never lands on a document, key/value or stream tab`** (F17, D15)
Port `grid/state.ts:193-216`'s `countOpId` guard to `documents/state.ts`, `keyvalue/state.ts` and
`stream/state.ts`: add `countOpId: string | null` to each runtime and its default, stamp it before
the `data.count` await, drop the response when it no longer matches, and clear it wherever the tab
already clears `count` (`documents/state.ts:230`). Behaviour change, named in §0, its own commit.

**11. `refactor(views): one page store behind all five page modules`** (F19, D14)
Rewrite `views/shared/page/store.ts` per §2.6 (two-level cache keyed row→subKey, `setVisibleWindow`,
`bumpPageVersion`, `dropForPrefix`). Rebuild `views/grid/page.ts` and `views/console/resultPages.ts`
on it — each keeps only its own row accessors (`cell`, `documentRow`, `keyValueRow`) and its own
`CellView` shape. `documents/page.ts`, `keyvalue/page.ts` and `stream/page.ts` change only where the
`cached()` signature moved from `(scope, 'field:row', decode)` to `(scope, row, 'field', decode)`.
`window.__kiraRetainedBytes` must keep summing every store (`totalRetainedBytes` is unchanged in
contract) — `tests/ui/memory.spec.ts` reads it.

**12. `refactor(views): the immediate-mutation writers share one body`** (F18)
Add `views/shared/immediateMutation.ts`. Rewrite `documents/mutations.ts` (3 functions),
`keyvalue/mutations.ts` (3) and `stream/mutations.ts` (4) as `ops`-building calls into it.
`deleteKey`'s `browseInvalidate` tail and `addKey`'s open-a-new-tab-instead-of-reload behaviour go
through the `after` hook; `addKey` keeps its own body, since it does not reload at all.

**13. `refactor(views): one match index and one row scanner behind the find toolbar`** (F8/F9)
Add `createMatchIndex` to `views/shared/page/search.ts` and `emptyScan`/`tabularRowScanner`/
`keyValueRowScanner` to `views/shared/page/scan.ts`. Adopt the index in `DataGrid.vue:661`,
`KeyValueView.vue:511` and `ConsoleResultGrid.vue:217`; adopt the scanners in `grid/search.ts`,
`keyvalue/search.ts` and `console/search.ts`'s three branches; adopt `emptyScan` in all five
`search.ts` modules. `documents/search.ts`'s own scanner and `DocumentView.vue`'s range-keyed index
are untouched (F30). `tests/unit/scan.spec.ts` covers `runChunkedScan`'s frame semantics and must
stay green.

**14. `refactor(grid): the data view opens with ViewChrome like every other view`** (F1/F2/F20,
D8/D9/D10) — the phase's largest step, and the one to land before the pager sits inside it.
- `ViewChrome.vue` gains `toolbarTestid`/`toolbar2Testid`.
- `DataView.vue` mounts `<ViewChrome>`: its four badges and the PK chip move to `#badges`/
  `#head-trailing`; `DataToolbar` becomes `#toolbar` and `FilterToolbar` `#toolbar-2`;
  `SearchToolbar` moves to `#strips`; the error strips, the reconnect gate, the grid and
  `CellEditorDock` stay in the default slot in today's order. Its hand-rolled `ViewHeader` and
  `.p-toolbar-rail` (`:122-153`) are deleted.
- `DataToolbar.vue` drops its own `.p-toolbar` root, its Refresh/Stop group (`:249-265`), its
  `RunState` (`:423`) and its `useRunState` import; `canRefresh`/`canStop` are handed to `ViewChrome`
  as `!rt?.opId` / `!!rt?.opId`, preserving today's exact disabled and `is-live` semantics. Its
  pending-changes group moves to `#toolbar-end`.
- `DataToolbar.vue` and `FilterToolbar.vue` take `tab` as a prop (D10).
- Add `views/shared/targetPath.ts`'s `ancestorPathPrefix(connectionId, path)` (F20) and use it from
  both `DataView.vue` and `DocumentView.vue`.
- Fix `ViewHeader.vue:8-11`'s stale comment (F26).
- Add the one missing `<div class="sep"/>` before `StreamView.vue:530`'s page-size picker (F3).

**15. `refactor(views): one pager behind the SQL grid and the document list`** (F4, D6/D7)
Add `views/shared/page/Pager.vue`. Replace `DataToolbar.vue:269-321` (pager + the four computeds at
`:83-99,130-135`) and `DocumentView.vue:537-580` (+ `:213-228`). Grid passes `testid-prefix=""`,
`last-tooltip="Count rows first"`, `:strategy="rt?.lastStrategy"`; documents passes
`testid-prefix="document-"`, `last-tooltip="Count documents first"`.

**16. `refactor(documents): the console's Mongo result renders the document view's own row`**
(F10–F13, D11/D12/D13)
Add `views/shared/document/DocumentRow.vue` per §2.9, carrying F11's nine CSS rules with
`--kira-s-4` padding (D12). Rewrite `DocumentView.vue:778-891` and `ConsoleResultGrid.vue:384-433`
as `<DocumentRow>` usages: documents passes `#actions` (edit/delete/editing chip) and a `#body` with
its preview-match line, inline editor and CodeMirror fallback; the console passes only a `#body`
with the tree and its `<pre>` fallback. Both delete their copies of the nine rules. Every one of the
five shared `data-testid`s renders from the one component.

**17. `refactor(views): one column-header tooltip, one gutter width, one default column width`** (F7/F9)
Add `columnHeaderTooltip`, `GUTTER_WIDTH` and `DEFAULT_COLUMN_WIDTH` to
`views/shared/page/columns.ts`; use `DEFAULT_COLUMN_WIDTH` in `columnOffsets`'s own fallback too
(replacing `MIN_WIDTH` there, which is a *clamp* bound, not a default). Adopt in `DataGrid.vue:60`,
`:126-143`, `:163` and `ConsoleResultGrid.vue:71-86`, `:100-103`, and replace its CSS
`width: 56px` (`:507-510`) with a `--gutter-width` custom property set from the constant.

**18. `build(lint): the sibling-import rule covers views/browse too`** (F25, D17)
Add `"../browse/**"` and `"../../browse/**"` to the existing group at `biome.json:79-90`. Prove it
with a throwaway violating import, then remove it.

**19. `docs: record P48's cross-view audit`**
`docs/ARCHITECTURE.md`: the *UI architecture* section gains a line saying the grid is a `ViewChrome`
consumer like every other view and that the pager and the Mongo document row are one component each;
the *Adapter contract* section's `sql-text.ts` paragraph gains the keyset read-path helpers and
`resolveKeyShape`, and its `errors.ts` paragraph gains `throwIfCancelled`/`requireConnected`, with
`abort.ts` named as the fifth root module under `engine/adapters/`. `docs/v1/SPEC.md` §10's P48 row
gains its `Implemented:` record in the style P43/P46/P47 use. No other doc changes.

---

## 5. Verification

Runnable in this sandbox, after **every** commit:

- `bun run lint`
- `bun run typecheck` (all four projects)
- `bun run build`
- `bun test tests/unit` — `sql-text.spec.ts` (steps 3–7), `view-state.spec.ts` (steps 8–11),
  `scan.spec.ts` (step 13), `column-range.spec.ts` (step 17), plus the new keyset-position cases
  added in step 5.

Not runnable here (AGENTS.md's Docker and Electron-binary notes) and therefore recorded as owed:

- `bun test tests/db` — steps 1–7 touch every adapter's read/console path. The pre-existing
  12 pass / 10 fail baseline P39 recorded is the bar: same counts, zero resolution errors.
- `bun run test:db:kafka` — step 1 rewrites six lines in `kafka/read.ts`.
- `xvfb-run -a bun run test:ui` — steps 8–17. The specs that actually exercise the changed
  surfaces: `data-view.spec.ts` (the pager ids, the toolbar, `filter-toolbar.png`),
  `mongo.spec.ts` (the document row, the console's Mongo result, `:360`/`:401`'s CodeMirror
  tripwires, `document-pager-*`), `redis.spec.ts` / `s3.spec.ts` (`keyvalue-prev`/`-next`, the
  browse level), `kafka.spec.ts` / `sqs.spec.ts` / `rabbitmq.spec.ts` (`stream-next`, the new
  `sep`), `memory.spec.ts` (`__kiraRetainedBytes` after step 11), `budgets.spec.ts` (P29/P47's grid
  invariants, which step 14 must not disturb — it changes the grid's chrome, never `DataGrid.vue`'s
  render path).

A grep-level check per step, cheap and exact:

| After step | Command | Expected |
|---|---|---|
| 1 | `grep -rc "ctx.signal.aborted) throw" src/engine/adapters` | only `errors.ts` |
| 2 | `grep -rn "addEventListener('abort'" src/engine/adapters` | `abort.ts` + `kafka/read.ts:243` only |
| 3 | `grep -rn "strategy: 'offset'," src/engine/adapters src/shared` | the four genuinely-paged sites only |
| 5 | `grep -rn "keysetValuesOf" src/engine/adapters` | nothing |
| 8–10 | `grep -rn "function setActionError" src/renderer/views` | nothing |
| 11 | `grep -rn "decodeCache" src/renderer/views` | `shared/page/store.ts` only |
| 13 | `grep -rn "const matchIndex = computed" src/renderer` | nothing |
| 14 | `grep -rn "activeDataTab" src/renderer/views` | nothing |
| 14 | `grep -rn "ViewChrome" src/renderer/views` | seven mounting sites |
| 16 | `grep -rn "^\.doc-head" src/renderer/views` | `shared/document/DocumentRow.vue` only |
| 17 | `grep -rn "?? 96\|width: 56px" src/renderer/views` | nothing |

---

## 6. Explicitly out of scope

- **Merging `DataGrid.vue` and `ConsoleResultGrid.vue`** (F6/F27). Refuted, not deferred.
- **Merging the two document expansion stores** (F12/F31). Refuted, not deferred.
- **Splitting `DataGrid.vue`** (F39). 2155 lines, no internal duplication found; a different phase.
- **Column virtualization for the console's result grid** (F40). A performance question, and SPEC
  §10's P49 row already owns "does P47's virtualizer go anywhere else."
- **Moving the key/value `SearchToolbar` out of its gated body** (F5/F38). A behaviour change.
- **Normalising the toolbars beyond F1/F3's two items.** The remaining differences in F3's table are
  differences between the views, not between two implementations of one view.
- **`ColumnsMenu`/`ProjectionMenu`** (F28), the `console.ts` `execute()` preambles (F32), the
  connect-probe row check (F33). All below the bar, all named with their counts so the next audit
  does not re-derive them.
- **New tests beyond step 5's keyset-position cases.** P44's scarcity rule stands: a structure phase
  that changes no behaviour needs no new coverage, and the one behaviour change (step 10) is a race
  the existing Docker-gated specs cannot force any more deterministically than
  `view-state.spec.ts`'s own idiom could — which is why step 10 is a separate, revertible commit
  rather than a test-backed claim.
- **Any change to `docs/design/`.** The design system is the reference the toolbars are being made
  to agree with, not a thing this phase edits.

---

## 7. Target tree at the end of P48

Only what changes. `~` = modified, `+` = new, `−` = deleted.

```
src/
  shared/protocol/
    ~ page.ts                     + unpagedPosition() (D3)
  engine/adapters/
    + abort.ts                    withAbortRace() — the two callback drivers' settle race (F22)
    ~ errors.ts                   + throwIfCancelled(), requireConnected()
    ~ sql-text.ts                 + assertKeysetSupported/resolveFetchColumns/buildScanOrderBy/
                                    buildKeysetPosition/whereClause/parseCountValue/
                                    primaryKeyFromIndexes/resolveKeyShape; header widened to
                                    "read.ts and catalog.ts" (D4)
    ~ postgres/{read,catalog,query,console,index}.ts
    ~ mysql-family/{read,catalog,query,console,index}.ts
    ~ sqlite/{read,console,index}.ts
    ~ clickhouse/{read,console,index}.ts
    ~ mongo/{console,index}.ts  ~ redis/{read,catalog,console,mutate,index}.ts
    ~ kafka/{read,index}.ts     ~ sqs/{read,index}.ts
    ~ s3/{read,catalog,mutate,transfer,index}.ts   ~ rabbitmq/index.ts
  renderer/
    theme/primitives/
      ~ ViewChrome.vue            + toolbarTestid/toolbar2Testid (D8)
      ~ ViewHeader.vue            stale comment corrected (F26)
    views/
      shared/
        + immediateMutation.ts    createImmediateMutator() — nine writers, one body (F18)
        + targetPath.ts           ancestorPathPrefix() (F20)
        ~ viewOp.ts               createRuntimeStore gains setActionError/toggleSearchOpen/
                                  setSearchOpen; + beginOp(), applyLoadFailure() (F14-F16)
        document/
          + DocumentRow.vue       the head + row shell both Mongo views render (F10-F12)
        page/
          + Pager.vue             first/prev/jump/next/last, one implementation (F4)
          ~ store.ts              two-level decode cache + setVisibleWindow + prefix drop (F19)
          ~ columns.ts            + GUTTER_WIDTH, DEFAULT_COLUMN_WIDTH, columnHeaderTooltip (F7/F9)
          ~ search.ts             + createMatchIndex (F8)
          ~ scan.ts               + emptyScan, tabularRowScanner, keyValueRowScanner (F9)
      grid/
        ~ DataView.vue            a ViewChrome consumer; hand-rolled head + rail deleted (F1)
        ~ DataToolbar.vue         a #toolbar fragment; Refresh/Stop/RunState/pager all gone
        ~ FilterToolbar.vue       #toolbar-2; takes `tab` as a prop (D10)
        ~ DataGrid.vue            match index, header tooltip, gutter/width constants shared
        ~ page.ts  ~ state.ts  ~ search.ts
      documents/  ~ DocumentView.vue  ~ page.ts  ~ state.ts  ~ mutations.ts
      keyvalue/   ~ KeyValueView.vue  ~ page.ts  ~ state.ts  ~ mutations.ts  ~ search.ts
      stream/     ~ StreamView.vue    ~ page.ts  ~ state.ts  ~ mutations.ts
      console/    ~ ConsoleView.vue   ~ ConsoleResultGrid.vue  ~ resultPages.ts  ~ state.ts
                  ~ search.ts
      browse/     ~ state.ts
tests/unit/
  ~ sql-text.spec.ts              + buildKeysetPosition cases (step 5)
~ biome.json                      views/browse joins the sibling-import group (D17)
docs/
  ~ ARCHITECTURE.md               ~ v1/SPEC.md (§10's P48 row)
```

**Why this split pays for itself.** Every extraction above is aimed at exactly one failure mode —
the one the user reported. `ViewChrome` already exists *because* three views drifted on the Stop
button (`ViewChrome.vue:11-15`); the grid stayed outside it and now shows two identical chevrons in
its pager while its sibling shows four distinct glyphs. `headerTitleFor` has been re-synced by hand
three times across two files and its own comment predicts the fourth. `runCount` was fixed in the
grid in P43 and three siblings still carry the bug. `setVisibleWindow` was written for the grid in
P29 and copied to the console in P43, and the three views in between have neither. In every case the
cost of the duplication is not the lines — it is that the *next* fix has to be made two, three, five
or twenty-six times, and will not be. Twenty-six copies of one `if` is the extreme version of the
same statement. The measure of this phase is not how many lines it deletes; it is that after it, a
change to the pager, the document row, the count guard, the page cache, the keyset token, or the
cancellation check is a change to one place.

---

## 8. Acceptance checklist

1. `bun run lint`, `bun run typecheck` (node/web/db/unit) and `bun run build` green after **every**
   one of the nineteen commits, not only at the end.
2. `bun test tests/unit` green after every commit, including the new `buildKeysetPosition` cases.
3. `grep -rn "ViewChrome" src/renderer/views` returns **seven** mounting sites; `DataView.vue` is
   one of them, and `grep -rn "activeDataTab" src/renderer/views` returns nothing.
4. Every `data-testid` in `src/renderer` is unchanged except the two D6 names. Verify by diffing
   `grep -rho 'data-testid="[^"]*"' src/renderer | sort -u` against the pre-phase output: the diff
   must be exactly `-document-prev`, `-document-next`, `+document-pager-prev`,
   `+document-pager-next`.
5. The grid's pager renders four distinguishable icons (chevron-left, arrow-left, arrow-right,
   chevron-right), and the document list renders the same four (D7).
6. The grid's filter row has **no** bottom border, matching the document view's (D9) — verified on
   screen, and recorded as intended rather than reported as a regression.
7. `.doc-head` renders with `--kira-s-4` horizontal padding in both the Mongo data tab and the
   console's Mongo result (D12), and `grep -rn "^\.doc-head" src/renderer/views` returns one file.
8. A document tab's expansion still persists across a tab close/reopen and still defaults to
   expanded; a console result set's still starts collapsed and still dies with the result (D11).
9. A truncated/unparseable document body still shows a CodeMirror editor in the data tab and a
   `<pre>` in the console (D13) — `tests/ui/mongo.spec.ts:360` and `:401` unchanged and passing on a
   machine that can run them.
10. `window.__kiraRetainedBytes` still sums every page store after step 11
    (`tests/ui/memory.spec.ts`).
11. No adapter message string changed: `git diff` over `src/engine/adapters` contains no change to
    any string literal passed to `AdapterError`, except where a copy was deleted outright.
12. `bun test tests/db` reproduces the pre-existing 12 pass / 10 fail baseline with zero resolution
    errors, and `xvfb-run -a bun run test:ui` is green — both on a machine with Docker, since
    neither can run here (§5).
13. `bun run lint` fails on a throwaway `views/console/x.ts → ../browse/state` import and passes
    once it is removed (D17).
14. `docs/ARCHITECTURE.md` and SPEC §10's P48 row describe the tree as it now is, and no comment in
    `src/` names a file or a structure this phase moved.

---

## 9. What is left, and who owns it

- **The key/value find widget is unreachable behind the reconnect gate** (F5/F38). A one-line move
  of `KeyValueView.vue:817-825` out of the `v-else`, but it changes what a gated tab can do. Owed to
  a behaviour phase, not this one.
- **The console's result grid has no column virtualization** (F40). SPEC §10's P49 row already asks
  whether P47's virtualizer belongs anywhere beyond `DataGrid.vue`; this is the concrete first
  answer to that question, with a measurement to take rather than a refactor to do.
- **The unparseable-document-body fallback is still two renderings** (F13/D13), pinned in place by
  `tests/ui/mongo.spec.ts:401` on one side and P27 D24's no-editor-in-a-long-list tripwire on the
  other. Closing it means deciding which of the two assertions is the one worth keeping — a product
  decision, recorded here so it is not re-discovered as a bug.
- **`ColumnsMenu`/`ProjectionMenu`'s five shared CSS rules** (F28) and **the six `console.ts`
  `execute()` preambles** (F32) stay duplicated, deliberately, with their counts recorded above so
  a later audit can re-weigh them against a bar that may have moved.
- **`DataGrid.vue` is still 2155 lines** (F39). Not a duplication problem; if it becomes a
  maintainability one, it needs its own phase and its own justification, not this one's.
