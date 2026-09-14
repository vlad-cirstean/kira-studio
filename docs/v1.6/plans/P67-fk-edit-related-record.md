# P67 — FK preview: edit the related record

> **What this phase is.** `docs/v1.6/SPEC.md`'s P67 row, turned into concrete steps from direct
> reads of the real tree — every file, line number and API below was opened and checked, never
> recalled. SPEC's own premise about what exists today is wrong in one load-bearing way; §0 states
> the correction before anything is designed on top of it.

## 0. SPEC's premise, corrected

SPEC's P67 row says:

> clicking a foreign-key-valued cell already shows the referenced row from its own table — confirmed
> present, exact component not yet located; likely `views/shared/celleditor/CellEditorView.vue` or
> adjacent

Three claims. Checked directly:

**1. "Clicking an FK cell shows the referenced row" — half true, and not a preview.** What exists
(v1 P7, `docs/v1/plans/P7-pk-fk-navigation.md`) is *navigation*, not preview. Clicking an FK cell's
nav button calls `navigateForeignKey` (`views/grid/menu.ts:94-104`), which opens a **new data tab**
on the referenced table pre-filtered to `<refCol> = '<val>'`. No popover, no inline panel, nothing
anchored to the cell. Grepped for `fkPreview`, `relatedRow`, `peek`, `preview` across
`frontend/src`: the only `Preview` in `views/grid/` is `PreviewCommandPanel.vue`, which renders the
SQL for *pending changes* — unrelated.

**2. "Only a read-only preview" — false.** The tab P7 opens is a fully editable data tab.
`DataView.vue:299` mounts `CellEditorDock` with no `readOnly`, and `canEditTable()`
(`SlickGridHost.vue:227-231`) is satisfied for any writable connection on a PK-bearing table. The
related record is already editable once you get there.

**3. "Likely `CellEditorView.vue` or adjacent" — false.** `grep -in "fk\|foreign\|referenc"` over
`views/shared/celleditor/*` returns exactly one hit, an unrelated comment at
`CellEditorView.vue:62`. The cell editor knows nothing about foreign keys.

**So the literal mandate — "let the preview open the related record in a real edit session" — is
already satisfied, because the thing it calls a preview is already an edit session.** Per
`CLAUDE.md`'s rule that a planning pass states plainly when it finds nothing real, that is stated
here rather than dressed up.

**What is genuinely missing, and what this phase therefore builds.** Two gaps between the row's
described experience and the tree:

- **No in-place look at the related record.** Today the only way to see it costs a whole new tab and
  moves you off the row you were reading. SPEC's wording ("preview", "shows the referenced row")
  describes a lightweight look that does not exist.
- **No "edit this related record" action.** P7 lands you on a filtered grid and stops. Nothing
  selects the record, nothing puts you in edit mode; you hunt for a cell yourself.

P67 closes both: an anchored **read-only preview popover** on the FK cell, whose primary action
routes the related record into **the existing data-tab edit surface**, pre-filtered, row selected,
cell editor live on it. No second edit UI is built — SPEC's own instruction, and §5 is how it is
kept.

---

## 1. Confirmed current state

### 1.1 The FK affordance, end to end

| File:line | What is there |
| --- | --- |
| `packages/shared/domain/tree.ts` `objectMetaSchema` | `foreignKeys` / `referencedBy`, each `{ name, columns, referencedPath, referencedColumns, onDelete, onUpdate }` |
| `views/grid/state.ts:85-95` | `loadMeta` fetches that `ObjectMeta` once per tab via `control.treeDescribe` (L1 cache-aside), stores it at `runtime[tabId].meta` |
| `views/grid/menu.ts:75-90` | `foreignKeyValueFilter(dialect, columns, referencedColumns, rowValues)` — the composite-safe `<refCol> = '<val>' AND …` builder; returns `null` when any source value is missing or NULL |
| `views/grid/menu.ts:94-104` | `navigateForeignKey(entry, ctx)` — `openDataTab(..., { newTab: true })` then `void setFilter(tabId, filter)` |
| `views/grid/menu.ts:108-123` | `fkNavItem(idPrefix, entry, ctx)` — one `MenuItem` per edge, `disabled` when the filter can't be built |
| `views/grid/menu.ts:128-137` | `foreignKeyNavItems(columnName, meta, ctx)` — outbound edges whose `columns` include this cell's column |
| `views/grid/menu.ts:143-164` | `referencedByItems` / `referencedByMenuItems` — the PK-side "Referenced by ▸" submenu |
| `views/grid/menu.ts:187-281` | `cellMenu` — splices the FK items in at `:199-202`, behind a separator (`:279`) |
| `views/grid/slick/rowValues.ts:191-210` | `navColumnsFor(meta)` — the cheap per-column precheck (`fk`/`pk`/`valueNames` sets) |
| `views/grid/slick/rowValues.ts:247-276` | `cellNavEntry(...)` — the single source of truth for a cell's nav affordance; `'fk'` wins over `'pk'`; `null` when nothing is navigable |
| `views/grid/SlickGridHost.vue:895-910` | `navEntryAt(pos, cellIdx)` — display position to page row/display col, then `cellNavEntry` |
| `views/grid/SlickGridHost.vue:941-963` | `placeNavButtonsForRenderedCells()` — one real `<button class="cell-nav-btn" data-testid="cell-nav-button" data-nav-kind="fk\|pk">` per rendered `.slick-cell.has-nav`, appended imperatively, idempotent via `data-kira-nav-placed` |
| `views/grid/SlickGridHost.vue:972-985` | `onGridClick` — a click on `.cell-nav-btn`: exactly one candidate runs immediately, more than one opens `openContextMenu` with the same items |
| `theme/cellClass.ts:30-33` | the `fk` / `has-nav` cell flags the formatter writes; the button's icon glyph is chosen from them |

**The button is imperative DOM inside a SlickGrid cell**, not a Vue-rendered element, and it is
destroyed whenever `invalidateRow` rebuilds its cell. That constrains how the popover is anchored
(§4.3).

### 1.2 The edit surface, end to end

| File:line | What is there |
| --- | --- |
| `views/grid/DataView.vue:295` | `<SlickGridHost :tab-id="tab.id" />` |
| `views/grid/DataView.vue:299` | `<CellEditorDock :tab-id="tab.id" />` — no `readOnly`, so the dock is a real editor |
| `views/shared/celleditor/CellEditorDock.vue:17` | renders only when `selectedCellFor(tabId)` is non-null |
| `state/cellSelection.ts:7-38` | `SelectedCell`, including `onEdit` / `onRevert` — "set only by a publisher that can genuinely stage a write" |
| `views/grid/SlickGridHost.vue:2151-2159` | `selectionTarget()` — `rt().selection` narrowed to a single cell |
| `views/grid/SlickGridHost.vue:2160-2209` | the publish watch: builds the `SelectedCell`, wires `onEdit` to `stageEdit` and `onRevert` to `discardCellEdit`, calls `publishSelectedCell` |
| `views/grid/SlickGridHost.vue:1329-1338` | `startEditCell(row, displayCol)` — `grid.setActiveCell(...)` then `grid.editActiveCell()` |
| `views/grid/SlickGridHost.vue:1344-1356` | `onBeforeEditCell` — the single veto (gutter, insert row, not writable, deleted row, truncated value) |
| `views/grid/pendingChanges.ts:117`, `:284`, `:294` | `stageEdit`, `previewPending`, `commitPending` |

So "edit a record" in this app means: **select a cell in a data tab → the cell editor dock targets
it → edits stage into that tab's pending set → the toolbar commits.** There is exactly one such
surface, and P67 reuses it rather than adding one.

Two consequences this plan leans on:

1. `grid.setActiveCell` is enough. `SlickHybridSelectionModel.handleActiveCellChange` turns any
   active-cell change into a one-cell selected range, which fires `onSelectedRangesChanged`, which
   sets `rt().selection`, which the publish watch turns into a `SelectedCell`
   (`SlickGridHost.vue:1422-1426`'s own comment states the mechanism).
2. `startEditCell` is **self-gating**: `onBeforeEditCell` refuses when the table isn't editable, and
   the active cell is still set, so the dock still targets it and shows its existing read-only chip
   (`CellEditorView.vue:110-135`). P67 therefore never re-derives an editability rule of its own.

### 1.3 A tab-free row read already exists on the wire

`ReadRequestWire.tabId` is `string | null` (`packages/shared/protocol/data-ops.ts:54`, `:66`), and Go
carries it as `TabID *string` (`internal/adapterhost/host.go:30`, threaded at `data.go:68`). So a
preview can issue a real `data.read` with no tab of its own. **No backend change, no new IPC
method, no protocol change in this phase.**

Decoding needs no store either: `@shared/protocol/page` exports `cellText` / `isNull` /
`isTruncated`, which is exactly what `views/grid/page.ts:31-41` uses under its cache.

### 1.4 Anchored floating surfaces

| File:line | What is there |
| --- | --- |
| `theme/floatingPosition.ts:54` | `computeFloatPosition(reference, floatingEl, opts)` — `@floating-ui/dom` with `offset`/`flip`/`shift`/`size`, `strategy: 'fixed'` |
| `theme/floatingPosition.ts:98` | `pointReference(x, y)` — a zero-size virtual reference at a viewport point |
| `theme/floatingPosition.ts:35-36` | `--kira-float-max-w` / `--kira-float-max-h`, written by `size()`; a consumer opts in by reading them |
| `theme/primitives/PopoverPanel.vue:28-34`, `:66-75` | the shared backdrop + Escape + `autoUpdate` chrome — but it anchors to `backdropEl.parentElement`, i.e. it requires being rendered as a **sibling of its trigger** |
| `workbench/ContextMenu.vue:91-94` | the one existing consumer anchored to a point rather than an element |

`PopoverPanel` cannot be used as-is: the FK nav button has no Vue parent to render a sibling into
(§1.1). §4.3 takes the `ContextMenu` route instead.

### 1.5 P60 landed; the cell editor is Monaco

SPEC's "if P60 has already moved the cell editor onto Monaco, build on that end state" — it has.
`CellEditorView.vue:7` imports `MonacoHost`, and `:577-586` mounts it for the encoded pane.
**This phase touches no editor engine code at all**, so that end state is simply the ground it
stands on.

---

## 2. D1 — what this phase builds

1. **A read-only FK preview popover**, anchored at the click, showing the referenced record's
   columns and values, fetched with one tab-free `data.read` (§4).
2. **`Edit this record`** in that popover: opens the related record in the existing data-tab edit
   surface, pre-filtered, with the record's first non-key cell selected and edit mode entered (§5).
3. **`Open in new tab`** in that popover: `navigateForeignKey` verbatim — the exact action the
   button performs today, unchanged, one click further in.
4. **One new cell-menu item per outbound FK edge**, `Edit referenced row (<table>)`, built from the
   same function the popover's Edit calls — so the two surfaces can never disagree, the invariant
   P7 D3 already states for navigation (`menu.ts:126-127`).

Nothing else changes. The PK-side ("Referenced by") button and submenu are untouched (§9).

---

## 3. D2 — the trigger: left-click on an FK nav button opens the preview

Today: one candidate navigates immediately; more than one opens a context menu of candidates
(`SlickGridHost.vue:977-984`).

After: **one candidate opens the preview popover**; more than one keeps today's context menu, whose
items then open the preview for the chosen edge rather than navigating.

Why this and not a second affordance:

- It is the behaviour SPEC describes as already existing ("clicking a foreign-key-valued cell …
  shows the referenced row").
- A preview needs one unambiguous target, and the multi-candidate menu is already the disambiguator.
- **No capability is lost.** The right-click cell menu's `Go to referenced row (<table>)` item
  (`menu.ts:113-116`) is untouched and still one click. The popover's own `Open in new tab` is the
  same call.

Cost, stated plainly: three assertions in `tests/ui/interaction.spec.ts` (`:1390`, `:1420`, `:1433`)
currently expect `clickCellNav` to add a tab, and must become "open the popover, then click
`Open in new tab`". `tests/ui/support/grid.ts:65-69`'s `clickCellNav` helper stays as-is (it clicks
the button); the specs gain a follow-up click. `tests/ui/slick-grid.spec.ts`'s T9 is unaffected — it
only asserts the button's presence, kind and position. See OQ-1.

**NULL FK values still no-op.** `cellNavEntry` filters out disabled items
(`rowValues.ts:267-274`), so `navEntryAt` already returns `null` for a NULL source value and no
popover opens. Unchanged, and covered by `interaction.spec.ts:1385-1387`.

---

## 4. The preview

### 4.1 `views/grid/fkPreview.ts` — the fetch and the shape

No component logic here; this module is what the popover renders.

```ts
export interface PreviewColumn {
  name: string;
  dataType: string;
  typeClass: TypeClass;
  /** Part of the FK edge's referencedColumns — badged in the popover. */
  isTarget: boolean;
  isPrimaryKey: boolean;
}

export interface PreviewRow {
  values: { text: string; isNull: boolean; truncated: boolean }[];
}

export type FkPreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; columns: PreviewColumn[]; rows: PreviewRow[]; hasMore: boolean };

export async function fetchReferencedRow(
  connectionId: string,
  sourceTabId: string,
  entry: ForeignKeyMeta,
  filter: string,
  signal: { cancelled: boolean },
): Promise<FkPreviewState>;
```

Request shape, all of it already legal today (§1.3):

```ts
await data.read({
  opId: crypto.randomUUID(),
  tabId: sourceTabId,   // attribution only — see below
  connectionId,
  path: entry.referencedPath,
  projection: null,     // a preview wants the whole record
  filter,               // foreignKeyValueFilter's output, unchanged
  sort: null,
  pageSize: 10,         // the protocol's own smallest (pageSizeSchema)
  cursor: { mode: 'offset', offset: 0 },
});
```

- **`tabId` is the *source* tab's id, not `null` and not the target's.** The op then appears in that
  tab's own op-log row like every other query it caused. It deliberately does **not** touch
  `runtime[sourceTabId]` — no `beginOp`, no `rt.opId` write — so the grid's own status and stop
  button are unaffected.
- **Cancellation.** The popover keeps the `opId` while in flight and calls
  `control.opsCancel(opId)` (`bridge/index.ts:309`) on close if the response has not landed. A
  late response is also dropped via the `cancelled` flag — belt and braces, because cancel is
  best-effort server-side.
- **Cache.** This is an ordinary read against `(connectionId, path, query)`, so a second preview of
  the same record is an L2/L3 hit. Nothing new is cached renderer-side; there is no page store
  entry and nothing to evict.
- **Decoding** is `cellText` / `isNull` / `isTruncated` per chunk (§1.3), rows `0..min(rowCount, 5)`.

`isPrimaryKey` comes from the returned `ColumnDescriptor` (`packages/shared/protocol/page.ts:23`) —
the preview needs no `treeDescribe` of its own, and issues none.

### 4.2 The four states the popover must render

| State | Cause | Rendering |
| --- | --- | --- |
| loading | in flight | a `p-strip` spinner row, fixed height, so the panel does not jump |
| error | the read rejected | the server's message in a `p-chip err`; `Open in new tab` stays enabled, `Edit this record` stays enabled |
| no row | `rowCount === 0` | "No matching row in `<table>`" — a real, reachable case (an orphaned FK value, or the row deleted since the page loaded). `Edit this record` is **hidden**; `Open in new tab` stays, since the filtered empty grid is a legitimate place to land |
| ready | `rowCount >= 1` | row 0's columns and values; when `rowCount > 1`, a `p-chip info` reading `<n> matching rows` and only the first shown |

`rowCount > 1` is not hypothetical: an FK may reference a non-unique key, and `pageSize: 10` is what
makes the count honest rather than assumed.

Per-value rendering reuses what already exists: `NULL` and `truncated` as the same `p-chip info` /
`p-chip warn` the cell editor uses (`CellEditorView.vue:474-476`), the type colour from
`theme/icons.ts`'s `typeClassColor`, `PK` / `FK` badges in the same `header-key` style the grid's own
headers use (`SlickGridHost.vue:1020-1023`).

### 4.3 `views/grid/FkPreviewPopover.vue` — anchoring

Rendered by `SlickGridHost.vue` inside its existing root div (`:2329`), `v-if`'d on one local ref.

- Anchored with `computeFloatPosition(pointReference(clientX, clientY), el, { offset: 6 })` —
  `ContextMenu.vue:91-94`'s own route. **Not** the button element: §1.1's button is destroyed on any
  `invalidateRow`, and a detached reference is exactly what a virtualized grid produces on the next
  scroll frame.
- **`flip` left at its default (`true`)**, unlike `ContextMenu`. A preview is a panel, not a menu:
  "above the point" is a real, useful placement for a row near the bottom of the viewport, and
  `ContextMenu`'s own reason for disabling it ("a point has no other side to flip to",
  `ContextMenu.vue:82`) is a menu convention, not a constraint of `pointReference`.
- Reads `--kira-float-max-h` on its inner scroll container so a wide record clamps instead of
  overflowing (`floatingPosition.ts:35-36`'s own opt-in contract).
- Closes on: Escape (capture phase, `stopPropagation` — `PopoverPanel.vue:98-108`'s own reasoning
  applies verbatim, since the grid root has its own keydown handler), click on its full-viewport
  transparent backdrop, either action running, and the host's `onUnmounted`.
- A grid scroll closes it too. The popover is anchored to a viewport point over a virtualized row;
  leaving it floating over an unrelated row after a scroll would be a lie. One listener on the
  SlickGrid viewport element the host already holds.

**Why not extend `PopoverPanel` with a `reference` prop.** Considered, and declined: every one of
its 15 consumers renders as a sibling of its trigger, and its backdrop, focus-restore
(`:84-89` — `anchorEl.querySelector('button')`) and reposition all read `backdropEl.parentElement`.
A `reference` prop would make that whole chain conditional for one caller whose trigger is not a
Vue element at all. The shared *positioning* primitive (`computeFloatPosition`) is reused, which is
the part that carries the real logic; the ~40 lines of backdrop/Escape chrome are duplicated
deliberately and stay under this component's own roof, as `ContextMenu.vue` already does for the
same reason.

**No new dependency.** `@floating-ui/dom` (already direct, via `theme/floatingPosition.ts`, adopted
in v1.1 P23) is the positioning engine `CLAUDE.md`'s library-first rule points at, and it is already
here.

---

## 5. Routing into the edit surface

### 5.1 `views/grid/menu.ts` — one new operation beside `navigateForeignKey`

```ts
/** P67: the same jump navigateForeignKey performs, then a request to land the caret in the
 *  related record — the grid tab IS the edit surface (no second editor exists), so "edit the
 *  related record" is "open it there and select a cell in it". */
export async function editReferencedRow(entry: ForeignKeyMeta, ctx: FkNavContext): Promise<void> {
  const filter = foreignKeyValueFilter(ctx.dialect, entry.columns, entry.referencedColumns, ctx.rowValues);
  if (filter === null) return;
  const { id: tabId } = openDataTab(ctx.connectionId, entry.referencedPath, { newTab: true });
  await setFilter(tabId, filter);
  requestCellFocus(tabId, { row: 0, prefer: 'first-non-key', edit: true });
}
```

Three decisions inside those six lines:

- **`newTab: true`, same as `navigateForeignKey`.** Reusing an existing tab on the same target is
  friendlier but unsafe: `load()` calls `clearPending(tabId)` unconditionally
  (`views/grid/state.ts:115`), so re-filtering a tab that already holds staged edits would discard
  them silently. A new tab cannot do that. (`setFilter` on the *fresh* tab clears an empty pending
  set — a no-op.)
- **`await setFilter`, then request focus.** This is what makes the handshake race-free: `setFilter`
  resolves only after `load()` has called `setPage`, so by the time the request is made, the page
  that is in the store is the *filtered* one. Requesting before the await would risk the target
  tab's own first, unfiltered mount-load consuming it and selecting the wrong record.
- **`foreignKeyValueFilter` is called once more, not threaded from the caller.** It is a pure
  function over data both sites already hold; `fkNavItem:118-120` already calls it a second time
  for its own `disabled` computation. One shared builder, no new parameter shapes.

`qualifiedNameForPath` (`menu.ts:56-61`, currently module-private) is **exported** — the popover
needs the referenced table's display name for its header, and duplicating the `decodePath` +
`QUALIFIED_KINDS` filter is exactly the drift P7 D9 avoided.

New menu items, mirroring `foreignKeyNavItems` one for one:

```ts
export function foreignKeyEditItems(columnName, meta, ctx): MenuItem[]
```

— `id: 'edit-referenced-<constraint name>'`, `label: 'Edit referenced row (<qualified name>)'`,
`icon: 'edit'`, the same `disabled` predicate, `run: () => void editReferencedRow(fk, ctx)`.
Spliced into `cellMenu`'s existing `fkItems` array (`menu.ts:199-202`) right after the nav items, so
the separator logic at `:279` needs no change. This is the keyboard-reachable path to the same
action — the popover is pointer-driven, and the right-click menu is how every other grid action
stays reachable without one.

### 5.2 `views/grid/focusRequest.ts` — the pending handshake

A direct port of `views/repo/reveal.ts:20-40`'s shape — the repo's own established answer to "act on
a tab whose view may not be mounted yet".

```ts
export interface CellFocusRequest {
  /** Page row index. Always 0 today (the filtered page holds the one record). */
  row: number;
  /** Which column to land on: the first column that is not part of the primary key, falling
   *  back to display column 0 when every column is. */
  prefer: 'first-non-key';
  /** Enter the grid's inline editor too, not just select. Self-gating (onBeforeEditCell). */
  edit: boolean;
}

export function registerGridHost(tabId: string, apply: (req: CellFocusRequest) => boolean): void;
export function unregisterGridHost(tabId: string): void;
export function requestCellFocus(tabId: string, req: CellFocusRequest): void;
export function consumeCellFocus(tabId: string): CellFocusRequest | null;
export function clearCellFocus(tabId: string): void;
```

- `requestCellFocus` applies immediately when a host is registered for that tab **and** its `apply`
  returns `true` (it has a page and resolved a column); otherwise the request is stored pending.
- `SlickGridHost.vue` registers in `onMounted` (`:1742`) and unregisters in `onUnmounted` (`:1994`),
  and consumes any pending request at the end of the existing `pageVersion` watch
  (`:2033-2053`, after `grid.render()`), which is precisely when a freshly loaded page is rendered
  and its columns are built.
- `clearCellFocus(tabId)` is called from `views/grid/state.ts`'s `load()` catch arm
  (`:160-172`) — a load that produced no page can never satisfy the request, and leaving it pending
  would make a *later*, unrelated load jump somewhere the user did not ask for.
- `registerTabRuntimeCleanup` (the registry `views/grid/state.ts:71-73` already uses) drops the
  pending entry when the tab closes.

This module imports nothing (a `Map` and two plain functions), so it closes no cycle with `menu.ts`,
`state.ts` or the host.

### 5.3 `SlickGridHost.vue` — applying it

```
apply(req):
  p = getPage(tabId); if (!p || req.row >= p.rowCount) return false
  order = currentOrder()
  displayCol = first index in `order` whose page column has isPrimaryKey === false, else 0
  startEditCell(req.row, displayCol)          // when req.edit
  return true
```

`startEditCell` (`:1329-1338`) already does `setActiveCell` + `editActiveCell`, and
`onBeforeEditCell` (`:1344-1356`) already vetoes when the table is not editable — so a read-only
connection, a PK-less table or a truncated value each land the user on the selected cell with the
cell editor dock open and its existing explanatory chip showing, and no inline editor. **One
editability rule, in the place that already owns it.** §9 restates this as a non-goal.

"First non-key column" rather than column 0 because a record's primary key is the one thing you
almost never want to edit, and it is column 0 in every fixture this repo has. The fallback keeps the
behaviour defined for an all-key table.

---

## 6. Files

**New**

```
apps/kira-studio/frontend/src/views/grid/fkPreview.ts            the fetch + decode + state shape (§4.1)
apps/kira-studio/frontend/src/views/grid/FkPreviewPopover.vue    the anchored panel (§4.2/§4.3)
apps/kira-studio/frontend/src/views/grid/focusRequest.ts         the pending-focus handshake (§5.2)
```

**Extended**

```
apps/kira-studio/frontend/src/views/grid/menu.ts            editReferencedRow, foreignKeyEditItems,
                                                            qualifiedNameForPath exported (§5.1)
apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue  onGridClick opens the popover (§3);
                                                            popover in the template; register/
                                                            unregister/apply focus (§5.3)
apps/kira-studio/frontend/src/views/grid/state.ts           clearCellFocus in load()'s catch (§5.2)
apps/kira-studio/tests/ui/interaction.spec.ts               the P7 section, extended (§7)
docs/ARCHITECTURE.md                                        the PK/FK navigation paragraph (§8)
docs/v1.6/mcp-repo-map-issues.md                            this phase's dogfooding (§8)
```

**Untouched, and that is the point**

```
packages/shared/**                  no protocol, schema or domain change (§1.3)
apps/kira-studio/internal/**        no backend change of any kind (§1.3)
views/shared/celleditor/**          the cell editor learns nothing about foreign keys (§0 claim 3)
views/grid/pendingChanges.ts        staging and commit are reached, never changed
theme/primitives/PopoverPanel.vue   not widened for one caller (§4.3)
```

---

## 7. Testing

`CLAUDE.md`'s bar: a dedicated unit test only for genuinely hard logic. **Nothing here clears it.**

- `editReferencedRow` is three calls over an existing, already-covered filter builder.
- The focus handshake is a `Map` with three operations — reveal.ts, its own precedent, carries no
  test either.
- "First non-key column" is one `findIndex` with a fallback — `CLAUDE.md`'s "a single `if` guarding
  one obvious case isn't complexity", verbatim.
- The preview fetch is a request builder plus a decode loop — "thin pass-through wrappers" and
  "format round-trips with no edge case", both on the explicit "gets nothing" list.

**No new unit test files.** Coverage goes where P7's own coverage already lives: a fresh describe
block in `apps/kira-studio/tests/ui/interaction.spec.ts`, against the same
`regions → customers → orders → order_items` / `employees` fixture graph its P7 section
(`:1380-1440`) already drives.

Cases:

1. **The popover opens and shows the referenced record.** `clickCellNav(page, 0, 'product_id')` on
   `order_items` → `[data-testid="fk-preview"]` visible, header names `products`, a row reading
   `Widget`, and **no new tab** (the count is unchanged — the assertion that pins §3's behaviour
   change).
2. **`Open in new tab` is P7's behaviour, intact.** From that popover, click
   `[data-testid="fk-preview-open"]` → tab count +1, one row, `name` is `Widget`. This replaces the
   three existing `clickCellNav`-then-expect-a-tab assertions (`:1390`, `:1420`, `:1433`).
3. **`Edit this record` lands in edit mode.** Click `[data-testid="fk-preview-edit"]` → a new tab on
   `products`, one row, and `[data-testid="cell-editor-panel"]` present with
   `data-cell-key` naming a non-PK column of row 0 (`cellKey`, `cellSelection.ts:63-65`). Then type
   into the dock and assert the grid cell shows a staged edit — proving it reached the *existing*
   pending set, not a parallel one.
4. **No matching row.** Seed a read whose filtered page is empty → the popover reads "No matching
   row", `fk-preview-edit` has count 0, `fk-preview-open` still present.
5. **NULL source value still no-ops.** `employees.manager_id` row 0 — the existing assertion at
   `:1385-1387` extended by one line: no popover appears either.
6. **The cell menu carries the mirror item.** Right-click an FK cell → `menuItemIds` contains both a
   `go-to-referenced-` and an `edit-referenced-` id (the P7 D3 invariant, now for two actions).

`tests/ui/support/grid.ts` gains one helper, `fkPreview(page)`, beside `cellNavButton`.

Fixtures: none new. Every case above runs on `orderItemsFixture` / the employees self-FK the P7
section already sets up.

---

## 8. Documentation

- **`docs/ARCHITECTURE.md`** — the PK/FK navigation description gains the preview: what clicking an
  FK cell now does, that `Open in new tab` is the unchanged P7 jump, that `Edit this record` routes
  into the ordinary data tab because that tab *is* the edit surface, and that no second editor
  exists. Also correct the test-tier paragraph's feature list (`:3401`) if a count moves.
- **`docs/v1.6/mcp-repo-map-issues.md`** — this phase's own dogfooding. The planning pass's entry is
  already appended (token remint, `symbol` vs `name` parameter, `find_references` verified correct).
- **No `SPEC.md` edit.** §0's correction lives here, in this plan, per the never-retro-edit
  convention; a "Deliverable" paragraph on the P67 row is the orchestrator's call once the phase
  lands, not this plan's.

---

## 9. Explicitly out of scope

- **Editing inside the popover.** SPEC says "reusing [the edit surface] rather than building a
  second edit UI", and a writable popover would be exactly that second UI — with its own staging,
  its own commit, its own dirty state and its own conflict story against the tab that may already be
  open on the same table.
- **The PK-side "Referenced by" button and submenu.** It names *tables*, plural, with no single
  record to preview; previewing a list of referencing rows is a different feature. Its click
  behaviour (`data-nav-kind="pk"`) is byte-identical after this phase.
- **Reusing an open tab instead of opening a new one.** §5.1 — `clearPending` makes it a silent
  data-loss path.
- **Multi-hop preview** (previewing an FK *inside* the preview). One level, deliberately: a chain of
  popovers has no obvious close semantics and no anchor that survives a scroll.
- **Any new editability rule.** §5.3 — `onBeforeEditCell` and `readOnlyReasonFor` stay the only two.
- **Mongo / document tabs, key-value, stream, console.** No FK metadata exists for any of them; P7's
  own scope note ("Mongo has no FK navigation") is unchanged.
- **A preview for the composite-FK *target* being multi-row by design**, beyond showing the count
  and the first row (§4.2).
- **Backend, protocol, schema or binding changes.** §1.3 — the wire already carries everything.
- **Caching the preview renderer-side.** The engine's own cache already serves a repeat (§4.1).
- **A settings toggle for the preview.** SPEC does not ask for one; the trigger is a click on an
  affordance that is already opt-in.

---

## 10. Verification

### 10.1 Mechanical

```
bun run typecheck
bun run lint
bun run build
bun run test:ui
bun run test:visual        # expect a zero-pixel diff — the popover renders only after a click
```

No Go build or `go test` run is needed: this phase changes no Go file (§6). Run
`go build ./...` once anyway as a cheap confirmation that nothing was touched by accident.

### 10.2 Manual recipe

Against the seeded demo SQLite database (`scripts/demo-dbs/sqlite/seed.ts`, which carries the same
FK graph):

1. Open `order_items`. Every `product_id` / `order_id` cell shows its nav button, as before.
2. Click one. The popover opens over the grid, shows the `products` record, and **no tab is opened**.
3. Escape closes it. Scrolling the grid closes it. Clicking elsewhere closes it.
4. `Open in new tab` → exactly today's behaviour: a new `products` tab filtered to that record.
5. `Edit this record` → a new `products` tab, one row, a non-PK cell already active with the inline
   editor open and the cell editor dock showing that value. Type, blur, and the grid shows a staged
   edit; the toolbar's Commit writes it and the source tab is untouched.
6. Repeat 5 with the connection marked read-only: the cell is still selected, the dock still opens,
   the dock shows "Connection is read-only", and no inline editor appears.
7. `employees.manager_id` on Ada (NULL): no button, nothing on click.
8. Delete the referenced `products` row in another tab, then preview the same FK cell: "No matching
   row", `Edit this record` gone, `Open in new tab` still offered.

### 10.3 Checklist

- [ ] No file under `apps/kira-studio/internal/` or `packages/shared/` changed.
- [ ] `views/shared/celleditor/` unchanged.
- [ ] `PopoverPanel.vue` unchanged.
- [ ] `navigateForeignKey` and `foreignKeyNavItems` unchanged; the right-click
      `Go to referenced row` item behaves exactly as before.
- [ ] The PK-side nav button's behaviour is unchanged.
- [ ] Editing the related record stages into that tab's own `pendingChanges` set — verified by
      Commit, not by inspection.
- [ ] No second editability rule was introduced (`grep` for `canUpdate` / `readOnly` in the new
      files returns nothing).
- [ ] The preview's in-flight read is cancelled when the popover closes.
- [ ] A repo-map MCP `tools/call` answered correctly during the phase; logged.

---

## 11. Open questions for a human

**OQ-1 — the click now previews instead of jumping.** §3 changes what a left-click on an FK nav
button does. The old one-click jump survives in the right-click cell menu and one click deeper in
the popover, so nothing is unreachable, but muscle memory changes and three UI assertions move.
*Recommendation: make the change. It is the behaviour SPEC's own P67 row describes as already
existing, and a preview that needs a second affordance to reach would leave the grid with three FK
controls on one cell. The alternative — preview on `Alt`+click, jump on plain click — is available
and costs nothing to switch to later, but hides the phase's whole deliverable behind an undiscoverable
chord.*

**OQ-2 — which cell `Edit this record` lands on.** §5.3 picks the first non-primary-key column. That
is a guess about intent: the alternative is the column the FK actually points at
(`entry.referencedColumns[0]`), which is usually the primary key and usually the one column you do
not want to edit. *Recommendation: first non-key, as written. The record is what was asked for, not
a particular field, and landing on an uneditable key column would make "edit mode" read as broken.*

**OQ-3 — `Edit this record` always opens a new tab.** §5.1 refuses to reuse an open tab on the same
table because re-filtering it would discard its staged edits (`clearPending`). Consequence: editing
five FK targets in a row leaves five tabs. *Recommendation: ship as written. The honest fix is a
"this tab has unsaved changes" prompt before reuse, which is its own piece of work and belongs to
whoever wants tab reuse generally, not to this row.*

**OQ-4 — how many rows the preview shows.** §4.2 shows row 0 plus a count when the filtered read
returns more than one. *Recommendation: keep it. A non-unique FK target is legal but rare, and a
popover that grows into a second grid is the second UI §9 rules out — the count plus
`Open in new tab` is the honest escape hatch.*
