# P22 Pass B — finishing the SlickGrid migration: parity, cutover, and deleting the incumbent

> **The user's decision, already made, and the standing instruction for this pass.** Two sentences,
> verbatim: *"clean up and finish the migration to slickgrid"* and *"use as much functionality from
> slickgrid as possible and remove our custom one."* Plus one concrete UI change: *"move the pk and
> fk buttons to the left."*
>
> This document does not re-open the library choice (settled in
> `P22-grid-library-survey.md` / `P22-slickgrid-migration-plan.md`), does not re-litigate the
> scroll-performance work (`-iter2-scroll-gaps.md`, `-iter2-pacing.md` and its §11 onset postscript —
> landed, verified on real macOS hardware, **not to be touched**), and does not re-run the bundle
> survey. It is the parity + cutover + deletion plan Pass A's §8 sketched and deliberately left for
> a later Opus pass to write *against the post-Pass-A tree* (`P22-slickgrid-migration-plan.md`
> §0.5, §8.6).
>
> **What it adds that Pass A's §8 could not.** Pass A's §8 was a design written before any of the
> plugin sources had been read at the level this pass needed, and before the tree it targets existed.
> Reading `slickgrid@5.20.0`'s **`src/`** (the package ships TypeScript sources, not only `dist/`)
> this session turns up **eight things Pass A's §8 did not know**, five of them load-bearing:
>
> 1. **`SlickHybridSelectionModel` exists and is a near-exact match for this app's four selection
>    kinds.** Pass A's §4 evaluated `SlickCellSelectionModel` + `SlickCellRangeSelector` and deferred
>    the question. It never mentions the hybrid model, which is *"CellSelectionModel except when
>    selecting specific columns, which behave as RowSelectionModel"*
>    (`src/plugins/slick.hybridselectionmodel.ts:30-31`) — with `rowSelectColumnIds`
>    (`:271-275`), i.e. **"clicking this column selects the row"**, which is precisely this app's
>    gutter. Cell range drag, edge auto-scroll, shift-click extend, ctrl/cmd disjoint row selection
>    and shift+arrow range extension all come with it. §2 F1.
> 2. **`SlickGrid.handleSelectedRangesChanged` builds an O(rows × cells) CSS hash on every selection
>    change** (`src/slick.grid.ts:4336-4359`), unconditionally, whatever `selectedCellCssClass` is
>    set to. Today's `onSelectAll` is O(1) per rendered cell (`isSelected` on a `range`). A
>    select-all on a 10 000-row × 61-column page therefore costs ~610 000 property writes *inside the
>    library*. This is the single place where "use SlickGrid's own mechanism" has a measurable price,
>    and §5 D6 gates it with a named fallback rather than assuming either way. §2 F2.
> 3. **`Column.cellAttrs` / `Column.headerCellAttrs` are per-column static attribute bags**
>    (`src/models/column.interface.ts:48,54`, applied at `src/slick.grid.ts:5860-5866` and
>    `:1920-1926`). Pass A's D10 assumed the `data-testid`/`data-*` surface needed a per-cell
>    `onRendered` pass — *"the one place where a testability convenience could eat the performance
>    win the whole phase exists for"* (that plan's §11). It does not: `data-testid`, `data-column`
>    and `data-col-index` are all **per-column constants** and cost zero per rendered cell. Only the
>    row's own `data-row` correction needs a pass, and rows are ~200, not ~2 400. §5 D10.
> 4. **`enableCellNavigation` gives display-position-correct arrows for free.** The app's
>    `onKeydown` juggles `displayPositionOf`/`rowAtDisplayPosition` on every arrow
>    (`DataGrid.vue:1762-1779`) because its virtualizer indexes display positions while its selection
>    indexes page rows. Under §5 D1's data source SlickGrid *is* indexed in display-position space,
>    so `navigateUp/Down/Left/Right` (`src/slick.grid.ts:4530-4540`) are correct by construction and
>    that whole block is deleted, not ported. §4 item 21.
> 5. **`SlickCellExternalCopyManager` is structurally incompatible with this app's data bridge** —
>    it calls `(grid.getData() as any[]).length`, `d.push({})` and `grid.setData(d)`
>    (`src/plugins/slick.cellexternalcopymanager.ts:224-232`) against what is a `CustomDataView`
>    here, and its copy path emits **TSV only** (`:427-446`), never CSV/JSON/INSERT. Declined with
>    the citation, not with a preference. §3.
> 6. **`SlickContextMenu` is a second menu *renderer*, not a menu *trigger*.** It appends its own
>    `.slick-context-menu` DOM to `document.body` (`src/plugins/slick.contextmenu.ts:272-276`,
>    `:311-312`, `:729-731`) with its own item model and its own CSS. The *trigger* this app
>    actually wants is `grid.onContextMenu`/`onHeaderContextMenu` — core, not the plugin. §3.
> 7. **`tristateMultiColumnSort: true` + `multiColumnSort: false` is exactly this app's
>    asc → desc → none header cycle** (`src/slick.grid.ts:1772-1786`, `:1808-1816`), and
>    `setSortColumns` renders indicators for any number of columns regardless of that option
>    (`:3477-3520`) — so the ORDER BY box's multi-term sort still gets its numbered badges via
>    `numberedMultiColumnSort` + `sortColNumberInSeparateSpan` (`:1930-1934`). §4 items 7/9.
> 8. **A frozen pane clones the row div, not the cells.** `appendRowHtml` clones `rowDiv` for the
>    right pane (`src/slick.grid.ts:5719-5723`) and then routes each cell to one pane or the other
>    (`:5772-5776`). So `.slick-row` appears **twice** per row and `.slick-cell` appears **once**.
>    Every `tests/ui/` row query has to account for that; no cell query does. §7 F-test-1.
>
> **And the number that decides whether the pass pays for itself.** Measured in this session, with a
> real `bun run build` on this tree, not projected: deleting `DataGrid.vue`/`GridRow.vue`/`rowVm.ts`
> recovers **10.58 KB gzip of JS and 0.73 KB gzip of CSS**; adding `SlickHybridSelectionModel` plus
> an editor costs **5.80 KB gzip**. **Pass B ships ~5.5 KB gzip smaller than the tree it starts
> from**, and the whole migration ends **+42.83 KB gzip** over the pre-SlickGrid baseline — inside
> Pass A's own ≤ 45 000 B exit criterion. §8.

---

## 0. What this pass is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt` at **`dd0e062`**, clean, read **2026-09-03**.
- **Pass A landed and its scroll-performance follow-ups landed and were verified on real macOS
  hardware.** `docs/PERF.md` §2.1c carries the verification history; `-iter2-pacing.md` §11.4 records
  the user's own verdict on the pacing pass (*"feels really good"*, ~30 ms/frame) and the residual
  gesture-onset artifact the onset commits (`1e90c7f`, `a2bfabe`, `dbc8e02`, `dd0e062`) addressed.
  **Nothing in this pass may modify `KiraSlickGrid.getRenderedRange`'s runway/budget/chase logic,
  `scheduleChase`, the velocity sampler, or `slickTheme.css`'s `contain: layout` on `.slick-row`**,
  except where §5 names the case explicitly and says why.
- The tree this pass targets:
  - **Keeps and extends**: `views/grid/SlickGridHost.vue` (518), `views/grid/slick/dataSource.ts`
    (203), `views/grid/slick/kiraSlickGrid.ts` (440), `views/grid/slick/slickTheme.css` (172).
  - **Deletes at the end**: `views/grid/DataGrid.vue` (2 146), `views/grid/GridRow.vue` (335),
    `views/grid/rowVm.ts` (108), `tests/unit/row-sig.spec.ts`.
  - **Keeps untouched**: `views/grid/menu.ts` (425), `views/grid/clipboardFormats.ts` (158),
    `views/grid/pendingChanges.ts` (232), `views/grid/state.ts` (340), `views/grid/page.ts` (42),
    `views/grid/search.ts` (53), `views/grid/sortTerms.ts` (23), `views/grid/scrollTrace.ts` (368),
    `views/grid/DataToolbar.vue`, `FilterToolbar.vue`, `ColumnsMenu.vue`, `PreviewCommandPanel.vue`,
    `filterCompletion.ts`, `state/contextMenu.ts`, `state/cellSelection.ts`, `theme/cellClass.ts`,
    and `views/shared/page/*` (`columns.ts`, `store.ts`, `search.ts`, `searchFilter.ts`, `scan.ts`,
    `visibleRows.ts`, `sizes.ts`).
  - **Stays on the old renderer**: `views/console/ConsoleResultGrid.vue` (703). §6 rules on it, and
    that ruling is a decision with reasons, not a punt.
- **`slickgrid@5.20.0`**, MIT. Every claim below is cited by file and line from the package's own
  **`src/`** directory as installed at
  `node_modules/.bun/slickgrid@5.20.0/node_modules/slickgrid/src/`, read in this session. Pass A
  cited `dist/esm/index.js` line numbers; this document cites `src/` because the package ships it
  and it is the readable form. Where a Pass A citation is restated it is re-cited against `src/`.
- Every bundle number in §8 was measured **in this session**, either by a real
  `bun run build` on this tree (with the file under test temporarily removed or added, then
  restored — the tree is clean at `dd0e062`) or by `esbuild@0.28.2 --bundle --minify --format=esm` +
  `gzip -9`, the same method Pass A F9 used.

### 0.2 Scope

1. Apply the standing instruction feature by feature, deciding **mechanism vs content** explicitly
   for each — never as a blanket rule (§1, §4).
2. Read every SlickGrid extension point this pass depends on, from source, and cite it (§2).
3. Say what is *not* adopted and why, with real numbers where the reason is cost (§3).
4. Resolve every one of Pass A's 31 parity items, including all fifteen it deferred (§4).
5. Decide `ConsoleResultGrid.vue` (§6).
6. Sequence the cutover and the deletion so nothing dies before its replacement is proven (§7, §9).
7. Give every existing `tests/ui/` and `tests/unit/` spec an explicit fate (§7).
8. Report the real bundle delta (§8) and say exactly which docs change (§10).

### 0.3 Not in this pass

- **Anything in the confirmed-good scroll mechanism.** §0.1. Two places genuinely interact with it
  and are flagged where they arise: the editor's DOM inside a `contain: layout` row (§5 D8) and the
  insert row's `<input>` inside the cell formatter (§5 D9). Both are argued, not incidental.
- **`ConsoleResultGrid.vue`.** §6.
- **Column header drag-reorder.** §3, declined on a measured 12 905 B gzip.
- **Deleting `@tanstack/vue-virtual`.** It has exactly one remaining consumer after this pass
  (`ConsoleResultGrid.vue`'s column axis) plus a type-only import in `columns.ts`. §6.
- **Any Go-side work.** `frontend/`, `tests/`, `docs/` only.
- **Re-running the real-Mac A/B.** The pacing/onset work is verified. Pass B's own real-hardware
  obligation is narrower and named in §9.3: confirm that the *parity* work (editor DOM in cells,
  insert-row inputs, the CSS layers) did not regress the frame pacing that was verified good.

### 0.4 Ground rules

- **Read the library's source, cite the line.** Carried from Pass A §0.4, and it earned its keep
  again here: Pass A's §8.1 table proposed `grid.onDragInit`/`onDragStart` for drag-select. Those
  events exist, but the plugin that consumes them (`SlickCellRangeSelector`) needs a
  `SelectionModel` registered to do anything (`src/plugins/slick.cellrangeselector.ts:159,176,225`
  all read `this._grid.getSelectionModel()`), and the drag interaction itself is only created inside
  `finishInitialization`/`setSelectionModel` (`src/slick.grid.ts:991,1525`). Subscribing to those
  events by hand, as §8.1 implied, would have produced a drag with no ranges.
- **Mechanism from the library, content from the app — decided per feature, never assumed.** §1.
- **Nothing is deleted before its replacement is proven.** §9's stage 3 is the only place a line of
  `DataGrid.vue` is removed, and it lands after §9's stage 2 has the whole `tests/ui/` suite green
  against the SlickGrid DOM at unchanged thresholds.
- **`docs/ARCHITECTURE.md`'s "No Vue reactivity on row data" invariant holds throughout.** §5 D0
  restates it as a checkable rule for this pass specifically, because Pass B adds several new
  read-during-render call sites.
- **No feature is dropped silently.** §4 has a row for all 31 of Pass A's items plus the four this
  pass adds, and §4.1 names every genuine behaviour change before a line is written.

---

## 1. The standing instruction, applied

The user's instruction is *"use as much functionality from slickgrid as possible and remove our
custom one"*, and it is a deliberate reversal of the position taken earlier in this same
investigation (which had leaned toward keeping the app's own DOM-event code against whichever
renderer). It is taken here as binding.

It is also not self-applying, because SlickGrid's plugins mix two different things:

- **Mechanism** — *detect a right-click and work out which cell it was over; track a drag into a
  range; notice a copy keystroke; move a focus ring with the arrow keys; know that a column got
  wider.* None of this is app-specific. Every line of it in `DataGrid.vue` exists only because there
  was no library underneath. **All of it goes.**
- **Content** — *what a cell menu contains for a foreign-key column; how a row serialises to CSV vs
  an `INSERT`; that a staged edit shadows the page value; that a paste past the last row becomes a
  `PendingInsert` and skips generated columns; that a truncated cell is not editable.* No library can
  supply any of this. **All of it stays, unchanged.**

The instruction therefore reads: **delete the app's DOM-event glue, keep the app's domain
functions.** Concretely, these die:

| Dying, from `DataGrid.vue` | Replaced by |
|---|---|
| `matchedGridElement` (`:991-995`), `rowColOf` (`:997-1002`) | `grid.getCellFromEvent(e)` (`src/slick.grid.ts:4865`) |
| `onDataGridMouseDown` / `onDataGridMouseOver` / `onDataGridClick` / `onDataGridDblClick` / `onDataGridContextMenu` (`:1004-1063`) | `grid.onClick` / `onDblClick` / `onContextMenu` / `onMouseEnter` (`src/slick.grid.ts:4592`, `:4652`, `:4634`, `:4785`) |
| `onCellMouseDown` / `onCellMouseEnter` / `onGutterMouseDown` / `onGutterMouseEnter` / `extendSelectionTo` / `extendRowSelectionTo` / `extendFromPoint` / `dragMode` / `dragProducedRange` / `rowDragProducedRange` / `cellDownRow` / `cellDownCol` / `cellDragActive` (`:900-1178`) | `SlickHybridSelectionModel` + its `SlickCellRangeSelector` |
| `autoScrollTick` / `onDragMouseMove` / `onDragMouseUp` / `AUTO_SCROLL_EDGE` / `AUTO_SCROLL_STEP` (`:1083-1128`) | `SlickCellRangeSelector.handleDragOutsideViewport` (`src/plugins/slick.cellrangeselector.ts:290-350`) |
| `onKeydown`'s arrow / Enter block (`:1753-1797`) | `enableCellNavigation` + `grid.navigateUp/Down/Left/Right` (`src/slick.grid.ts:4530-4545`) and the Enter → edit path (`:4543-4556`) |
| `onResizeStart/Move/End` (`:621-640`) | `column.resizable` + `grid.onColumnsResized` (`src/slick.grid.ts:1963`) |
| `isSelected` / `isSelectedNeighbor` / `buildRowVm` / `renderRows` / `rowVmCache` / `RowVM` / `CellVM` / `RowSig` / `sameRowSig` | the formatter + three `setCellCssStyles` layers (§5 D5/D6) |
| `editingCell` / `editingBuffer` / `editingCellRect` / `startEdit` / `commitEdit` / `cancelEdit` / `onEditKeydown` (`:803-863`) | a `KiraCellEditor implements Editor` (§5 D8) |
| the two `useVirtualizer` calls, `rowStart`/`rowEnd`/`colStart`/`colEnd`, `visibleRows`, `visiblePageRowBounds`, `visibleColumnIndices`, `offsets`, `totalWidth`, `totalHeight`, `syncScrollState`, `onScroll` | already replaced in Pass A |

And these stay, byte-for-byte where possible:

`menu.ts` in full (`cellMenu`, `rowMenu`, `headerMenu`, `foreignKeyNavItems`, `referencedByItems`,
`navigateForeignKey`, `fkNavItem`, `foreignKeyValueFilter`); `clipboardFormats.ts` in full
(`rangeToTsv`, `rowsToTsv`, `columnsToTsv`, `rowsToCsv`, `rowsToJson`, `rowsToInsert`,
`parseDelimited`); `pendingChanges.ts` in full; `state.ts`'s `Selection` type and `runtime`;
`state/contextMenu.ts`'s `openContextMenu`/`runMenuShortcut`; `theme/cellClass.ts`;
`state/cellSelection.ts`'s publish contract; `shortcuts/keys.ts`'s `shortcutFor`. Roughly
**1 200 lines of domain logic that never belonged to the renderer** survive the migration untouched
— which is the test that the mechanism/content line was drawn in the right place.

---

## 2. Findings — `slickgrid@5.20.0`, read from `src/` this session

### F1 — `SlickHybridSelectionModel` maps this app's four selection kinds almost exactly. **Load-bearing; Pass A never saw it.**

`src/plugins/slick.hybridselectionmodel.ts`. Its options
(`src/models/selectionModelOption.interface.ts:14-50`):

| option | what it does | this app |
|---|---|---|
| `selectionType: 'mixed'` | cell selection normally, row selection over designated columns (`:80-84`, `:265-278`) | **yes** |
| `rowSelectColumnIds: ['__kira_gutter']` | *which* columns switch it into row mode (`:271-275`) | **the gutter, exactly** |
| `dragToSelect: true` | creates the range selector with `selectionCss: { border: 'none' }` (`:86-100`) — an invisible drag decorator | **yes**: the app's own cell fill/perimeter is the affordance |
| `selectActiveCell: true` | a click sets a one-cell range (`:299-309`) | **yes** — matches `onCellClick`'s plain-click branch |
| `selectActiveRow: true` | a gutter click sets a full-width row range (`:294-297`) | **yes** — matches `onGutterMouseDown`/`onGutterClick` |
| `enableMultiSelection` | ctrl/cmd toggles *disjoint cell ranges* (`:526-536`, `:660-673`) | **no** — §5 D4 explains why `false` is the parity-preserving choice |
| `autoScrollWhenDrag: true` | passes through to the range selector's own auto-scroll | **yes** |
| `showDragHandle: false` | suppresses the Excel-style fill handle (`src/slick.grid.ts:4276`, `:5874-5886`) | **yes** — the app has no fill semantics |

What it delivers, all of it code this app currently owns by hand:

- **Cell range drag with edge auto-scroll.** `SlickCellRangeSelector.handleDrag` →
  `getMouseOffsetViewport` → `handleDragOutsideViewport` runs a `setInterval` that accelerates with
  distance-outside-viewport and re-hit-tests via `getCellFromPoint`
  (`src/plugins/slick.cellrangeselector.ts:216-350`). That is `DataGrid.vue:1083-1115`'s
  `autoScrollTick` + `extendFromPoint`'s `document.elementFromPoint(...).closest(...)`, done better:
  no DOM hit-test, and it re-targets while the pointer is stationary, which is the exact case the
  app's own comment at `:956-958` says it had to hand-build.
- **Gutter row drag.** In row mode, `handleCellRangeSelected` widens the dragged range to
  `new SlickRange(fromRow, 0, toRow, columns.length - 1)` (`:653`). `handleDragTo`'s frozen-pane
  guard (`src/plugins/slick.cellrangeselector.ts:369-371`) keeps a left-pane (gutter) drag inside
  the left pane and a right-pane (data) drag out of the gutter — the same separation
  `dragMode: 'cell' | 'row'` encodes today, for free.
- **Shift-click extend** (`:522-531`), **ctrl/cmd disjoint row selection** (`:539-556`, gated on the
  grid's own `multiSelect`, default `true` at `src/slick.grid.ts:298`), **shift+arrow range
  extension, Ctrl+A, Page Up/Down, Home/End** (`:334-455`).

What it does **not** deliver, and stays app-owned: **column selection** (the header's 10 px select
zone). §5 D4 says how the app pushes column ranges into the model so the paint agrees.

### F2 — `handleSelectedRangesChanged` builds an O(rows × cells) hash, unconditionally. **The one measurable price of adopting the model.**

`src/slick.grid.ts:4336-4359`, verbatim shape:

```js
const hash = Object.create(null);
for (let i = 0; i < ranges.length; i++) {
  for (let j = ranges[i].fromRow; j <= ranges[i].toRow; j++) {
    if (!hash[j]) { this.selectedRows.push(j); hash[j] = Object.create(null); }
    for (let k = ranges[i].fromCell; k <= ranges[i].toCell; k++) {
      if (this.canCellBeSelected(j, k)) { hash[j][this.columns[k].id] = this._options.selectedCellCssClass; }
    }
  }
}
this.setCellCssStyles(this._options.selectedCellCssClass || '', hash);
```

Three consequences:

1. The loop runs over the **whole range**, not the rendered window, and `canCellBeSelected`
   (`:9393`) itself calls `getItemMetadaWhenExists(row)` per cell — which, through this app's data
   source, is `getItemMetadata` → `pageRowAt` (`dataSource.ts:144-150`). For select-all on a
   10 000-row × 61-column page that is ~610 000 iterations plus 610 000 metadata calls.
2. It runs **whatever `selectedCellCssClass` is** — the option only decides the layer key, not
   whether the hash is built. Pass A's `selectedCellCssClass: ''` does not avoid it; it only makes
   the layer key `''`.
3. `setCellCssStyles` then merges every keyed layer into `cellCssClassesByCell`
   (`src/slick.grid.ts:8046` and its implementation) — the F5 caveat Pass A already flagged, now
   with a concrete worst case.

§5 D6 turns this into a measured gate with a named fallback rather than an assumption in either
direction.

### F3 — `Column.cellAttrs` / `headerCellAttrs` make the whole `data-*` surface per-column and free

`src/models/column.interface.ts:48,54`. Applied per cell at `src/slick.grid.ts:5860-5866`:

```js
if (Object.prototype.hasOwnProperty.call(m, 'cellAttrs') && m.cellAttrs instanceof Object) {
  Object.keys(m.cellAttrs).forEach(key => { cellDiv.setAttribute(key, m.cellAttrs[key]); });
}
```

and per header at `:1920-1926`. `data-testid`, `data-column` and `data-col-index` are constants of a
column definition, so they cost one `setAttribute` per cell *build* (which SlickGrid is already
doing for `role`, `tabIndex` and `aria-describedby` at `:5836-5840`) and **nothing per retained
row**. This retires Pass A's D10 concern and its §11 watch item outright.

`data-null` is per-cell and comes from the formatter's `addClasses` as `.cell-null` (already true at
Pass A) — §7 retires the two `data-null` assertions in favour of the class.

### F4 — The row div is cloned per frozen pane; cells are not

`src/slick.grid.ts:5716-5723` clones `rowDiv` into `rowDivR` when `hasFrozenColumns()`, *before* any
cell is appended; `:5772-5776` then routes cell `i` to `rowDivR` when `i > frozenColumn` and to
`rowDiv` otherwise. With `frozenColumn: 0`:

- `.slick-row[data-row="N"]` matches **two** elements — the left (gutter) clone and the right (data)
  clone, both carrying the same `dataset.row`.
- `.slick-cell` matches **once** per cell: the gutter cell in the left row div, every data cell in
  the right one.

§5 D10 and §7 both depend on this.

### F5 — The edit lifecycle: veto, construct-in-cell, `applyValue`, `updateRow`

- `makeActiveCellEditable` (`src/slick.grid.ts:4004-4070`): `isCellPotentiallyEditable` (`:3922`,
  which requires `getEditor(row, cell)` to be non-null), then **`onBeforeEditCell` is vetoable** —
  `if (this.trigger(this.onBeforeEditCell, {...}).getReturnValue() === false) { this.setFocus();
  return; }` (`:4022`). The editor is constructed with `container: this.activeCellNode` (`:4048`),
  i.e. **inside the cell div**, and `loadValue(item)` is called with the `RowHandle` (`:4062`).
- `getEditor` (`:3778-3790`) resolves **row metadata first**
  (`getItemMetadata(row).columns[columnId].editor`), then `column.editor`, then
  `options.editorFactory`. So a per-row editor override — exactly what the insert-row region needs —
  is a first-class seam.
- `commitCurrentEdit` (`:4108-4160`): `isValueChanged()` → `validate()` → an `editCommand` whose
  `execute()` calls `editor.applyValue(item, serializedValue)` then `self.updateRow(row)` then
  `onCellChange`. `options.editCommandHandler`, when set, receives the command instead and the
  grid does **not** execute it (`:4148-4151`).
- Defaults that must change: `editable: false` (`:258`) → bound to `canEditTable`; `autoEdit: true`
  (`:259`) → **`false`**, or a single click opens an editor; `autoCommitEdit: false` (`:261`) →
  `true`, so a click elsewhere commits rather than re-prompting.
- Escape → `cancelEditAndSetFocus`, Enter → `commitEditAndSetFocus`, both in the grid's own
  `handleKeyDown` (`:4522-4556`).

### F6 — `handleKeyDown` fires `onKeyDown` first and honours `stopImmediatePropagation`

`src/slick.grid.ts:4485-4492`: the grid triggers `onKeyDown`, then `let handled =
retval.isImmediatePropagationStopped()`, and every built-in branch below is gated on `!handled`. So
the app's own handler runs **first** and takes precedence simply by calling
`e.stopImmediatePropagation()` on the events it owns. Pass A's §5 item 21 watch item ("display-
position-aware arrows must win over SlickGrid's own row stepping") dissolves: under §5 D1's data
source the two are the same space, so the app hands the arrows *to* SlickGrid (F-header item 4).

### F7 — `handleContextMenu` resolves nothing and prevents nothing

`src/slick.grid.ts:4634-4646`:

```js
protected handleContextMenu(e) {
  const cell = e.target.closest('.slick-cell');
  if (!cell) { return; }
  if (this.activeCellNode === cell && this.currentEditor !== null) { return; }
  this.trigger(this.onContextMenu, {}, e);
}
```

Three facts the handler must know: the event args are `{}` (resolve the cell with
`getCellFromEvent`), the native menu is **not** prevented (the app must call `preventDefault`), and a
right-click on the cell currently being edited is deliberately swallowed. Headers go to
`onHeaderContextMenu` instead, with `{ column }` in args (`:4729-4735`), bound on the header
container at `:948`.

### F8 — Sort: `tristateMultiColumnSort` is the app's exact cycle

`setupColumnSort` (`src/slick.grid.ts:1738-1832`) binds one delegated `click` per header container.
With `tristateMultiColumnSort: true` (`:1772`) and `multiColumnSort: false` (`:1781-1786`), a click
on an unsorted column pushes `asc`; on an `asc` column flips to `desc` (`:1766`); on a `desc` column
**removes it** (`:1776-1780`). `onSort` then fires with
`{ multiColumnSort: false, columnId: <id|null>, sortAsc }` (`:1808-1816`). That is
`DataGrid.vue:611-619`'s `onHeaderClick` cycle, term for term.

`setSortColumns(cols)` (`:3477-3520`) is independent of those options: it clears and re-applies
`.slick-header-column-sorted` and `.slick-sort-indicator-asc/-desc` for **any** number of columns,
and writes the order number into `.slick-sort-indicator-numbered` when `numberedMultiColumnSort` and
`sortColumns.length > 1`. With `sortColNumberInSeparateSpan: true` that number lives in its own div
(`:1931-1933`) — which is `DataGrid.vue:1880-1882`'s `.sort-order` badge.

The indicator divs are only created for a column with `sortable: true` (`:1928-1934`), so every data
column gets `sortable: true` and the gutter stays `sortable: false`.

### F9 — Column resize is built in; the only wiring is persistence

`setupColumnResize()` runs unconditionally after headers are built (`:1963`) and honours
`column.resizable` (default `true`, `src/slick.grid.ts:356`) and `column.minWidth` (default `30`,
`:352`). `onColumnsResized` fires on release (`:1963`'s installer). The `.slick-resizable-handle`
element is `width: 9px; right: -5px; z-index: 2` in the shipped `slick.grid.css` — wider than
`DataGrid.vue`'s own 4 px handle, and a purely visual difference to retokenise.

### F10 — Formatter results: `addClasses` and `toolTip` land on the cell, DOM results are allowed

`appendCellHtml` (`src/slick.grid.ts:5820-5850`): a `FormatterResultObject`'s `addClasses` is folded
into the cell's `className` and its `toolTip` becomes a `title` attribute; `onBeforeAppendCell`'s
string return adds further classes. `applyHtmlCode` accepts `HTMLElement | DocumentFragment` and
`appendChild`s it (Pass A F6, re-confirmed). Pass A's `-iter2-pacing` D5 made the formatter return
**text, never DOM**, for a measured reason. §5 D9 is the one place this pass returns DOM from a
formatter, for the pending-insert region only, with its own gate.

### F11 — `getItemMetadata` can supply `cssClasses`, `focusable`, `selectable` and per-column `editor`

`canCellBeActive` (`:9355-9386`) and `canCellBeSelected` (`:9393-9414`) both consult row metadata
first, then per-column metadata, then the column's own flag. `appendRowHtml` folds
`metadata.cssClasses` into the row's `className` (`:5711-5714`). `getEditor` consults
`metadata.columns[columnId].editor` (`:3782-3788`). Together these cover the row rails, the
pending-delete row state and the insert region's editor override, all without a formatter.

### F12 — `onMouseEnter` / `onMouseLeave` fire per cell, with `{}` args

`handleCellMouseOver`/`handleCellMouseOut` (`:4785-4790`, bound at `:987-988`) trigger
`onMouseEnter`/`onMouseLeave` with empty args; the handler resolves the cell with
`getCellFromEvent`. This is the hover mechanism the FK/PK nav affordance needs (§5 D11), replacing
`DataGrid.vue:1016-1024`'s hand-rolled `mouseover` + `relatedTarget` reconstruction of `mouseenter`.

### F13 — `handleClick` deliberately does not steal focus from a focused cell child

`src/slick.grid.ts:4592-4604`:

```js
if (e.target !== document.activeElement || e.target.classList.contains('slick-cell')) {
  const selection = this.getTextSelection(); this.setFocus(); this.setTextSelection(selection);
}
```

So an `<input>` rendered *inside* a cell keeps focus when clicked. This is what makes §5 D9's
pending-insert inputs work at all, and it is a deliberate library behaviour, not an accident.

### F14 — `SlickRange` normalises its corners

`src/slick.core.ts`'s `SlickRange` constructor takes `min`/`max` of each pair. A range therefore has
no anchor/focus distinction — a drag from bottom-right to top-left produces the same range as the
reverse. `handleCellRangeSelected` then sets the active cell to `range.fromRow, range.fromCell`
(`src/plugins/slick.hybridselectionmodel.ts:670`), i.e. the top-left. §4.1 item 2 names the one
user-visible consequence.

---

## 3. Checked, and not adopted — with the reason each was declined

- **`SlickContextMenu`** (`src/plugins/slick.contextmenu.ts`, 839 lines, **+2 950 B gzip** measured).
  It is a *renderer*: `createParentMenu` builds `.slick-context-menu` divs and appends them to
  `document.body` (`:272-276`), sub-menus likewise (`:729-731`), with `.slick-context-menu-item`,
  `-icon`, `-content`, `-divider`, `-disabled`, `-hidden` classes (`:588-628`) that the app would
  have to theme from zero (the shipped `slick.grid.css` styles none of them). Its item model is
  `MenuCommandItem { command, title, iconCssClass, commandItems, divider, itemUsabilityOverride }` —
  a different shape from `MenuItem` (`state/contextMenu.ts:4-25`), which additionally carries
  `swatch`, `danger`, `checked`, `hint` and a typed `shortcut: ShortcutId`. Adopting it would mean
  a second popup renderer, a second theme, and losing `runMenuShortcut`'s P21 D5 guarantee that a
  printed shortcut and the action it runs are literally the same object. **The mechanism this app
  wants — "a right-click happened, over this cell" — is `grid.onContextMenu`, which is core, not
  the plugin** (F7). Declined: adopt the trigger, keep the renderer.
- **`SlickCellExternalCopyManager`** (546 lines, **+2 284 B gzip**). Declined on two structural
  grounds, both cited:
  1. **It assumes an array-backed data view.** `_decodeTabularData` does
     `const availableRows = (grid.getData() as any[]).length - activeRow`, then `d.push({})` and
     `grid.setData(d)` (`:224-232`). This app's `getData()` is a `CustomDataView` over frozen pages
     (`dataSource.ts`), whose `.length` is `undefined` and which cannot be pushed to. The
     `dataItemColumnValueSetter` hook redirects *writes*, but not this row-count arithmetic.
  2. **Copy is TSV-only.** `handleKeyDown`'s Ctrl+C branch joins cells with `'\t'` and rows with
     `'\r\n'` (`:427-446`), over the bounding box of the selected ranges. The app's `onCopy`
     branches on selection kind and produces TSV *or* CSV *or* JSON *or* `INSERT`
     (`clipboardFormats.ts`), and its column-selection branch walks only the *visible* rows while
     filtering (`DataGrid.vue:1487-1492`'s P24 D10 rule).
  It also copies through a hidden `<textarea>` + `execCommand`-era focus dance (`:452-462`) rather
  than `navigator.clipboard.writeText` (`clipboard.ts`), and keys off the deprecated `e.which`.
  **The mechanism it wraps is `grid.onKeyDown`** (F6), which the app subscribes to directly.
- **`SlickCellSelectionModel`** (312 lines, **+4 010 B gzip**). Superseded by
  `SlickHybridSelectionModel` (**+5 618 B gzip**, i.e. 1 608 B more) which additionally gives row
  selection over the gutter column and disjoint row selection — both of which the app has today and
  the cell-only model would force back into hand-rolled code. The 1 608 B buys back roughly 270
  lines of `DataGrid.vue`.
- **Header drag-reorder (`enableColumnReorder`)**, revisited as the brief asked. `setupColumnReorder`
  needs a global `Sortable` (`src/slick.grid.ts:1966-1971`, and Pass A F7's hard-throw). Measured
  this session: `sortablejs@1.15.7` bundles to **37 180 B raw / 12 905 B gzip** — **2.2× the entire
  cost of the selection model plus the editor**, for a capability `ColumnsMenu.vue:66-102` already
  provides with an HTML5 drag list and `setColumnOrder`. **The decline stands, and now stands on a
  number rather than on Pass A's "this app doesn't drag headers".** If it is ever wanted, the wiring
  is one line (`onColumnsReordered` → `setColumnOrder`) and the cost is the 12.9 KB.
- **`SlickDataView`** (+5 945 B gzip, Pass A F9). Unchanged: it materialises rows, which P5 C1 and
  the reactivity invariant forbid.
- **`SlickCellRangeDecorator` as the selection perimeter.** Tempting — one element instead of a
  per-cell class layer — but `show()` positions itself from `getCellNodeBox(fromRow, fromCell)` and
  `getCellNodeBox(toRow, toCell)` and silently skips the position update when either is `null`
  (`src/plugins/slick.cellrangedecorator.ts:82-92`). A selection whose corners are scrolled out of
  view therefore draws nothing or draws stale. Adopted only for its intended job — the **live drag**
  preview — and made invisible there (`dragToSelect: true` → `border: none`), because the cells'
  own fill is already the preview. The committed perimeter stays app-drawn (§5 D6).
- **`autosizeColumns` / `forceFitColumns`.** Unchanged from Pass A: the app measures widths itself
  (`columns.ts:57-79`, memoised per frozen page and covered by
  `tests/unit/column-widths-cache.spec.ts`) and persists user overrides. `autosizeColsMode:
  LegacyOff` stays, which also keeps `getCellValue` off the render path.
- **`SlickCompositeEditor`, `SlickCustomTooltip`, `SlickAutoTooltips`, `SlickHeaderMenu`,
  `SlickCellMenu`, `SlickRowDetailView`, `SlickDraggableGrouping`, `SlickResizer`, `SlickState`.**
  No counterpart in §4's inventory. `SlickCustomTooltip`/`SlickAutoTooltips` in particular would be
  a third tooltip system beside `workbench/state/tooltip.ts`'s attribute-driven controller, which
  Pass A already showed reproduces `v-tooltip` exactly via `data-kira-tip` (§4 item 8).
- **`enableAddRow` / SlickGrid's own "Add New" row.** It appends *one* synthetic row past the end
  and commits through `onAddNewRow` with a fresh `{}` (`src/slick.grid.ts:4143-4147`). The app's
  insert region is N rows with positional identity into `pending.inserts`
  (`DataGrid.vue:1638-1644`), reachable by paste and by Duplicate-row, not just by typing in the
  last row. Declined; §5 D9 keeps the app's model.

---

## 4. The parity map, resolved

Pass A's §5 table, with every deferred row now decided. `L` = SlickGrid configuration; `M` = a
SlickGrid seam plus app glue; `A` = app-owned by decision (with the reason); `✓` = already done in
Pass A and untouched here.

| # | Feature | Verdict | Mechanism (SlickGrid) | Content (app) |
|---|---|---|---|---|
| 1 | Row virtualization in display-position space | **✓** | `getLength`/`getItem` | `dataSource.ts` |
| 2 | Column virtualization, pixel-budgeted, 12-col cap | **✓** | `getRenderedRange` | `clampColumnOverscan` |
| 3 | Velocity-adaptive, direction-biased runway + chase | **✓ do not touch** | — | `kiraSlickGrid.ts` |
| 4 | Sticky header row | **✓** | `.slick-header` pane | — |
| 5 | Sticky gutter, page-global numbering | **✓** | `frozenColumn: 0` | `gutterFormatter` |
| 6 | Select-all corner cell | **L/M** | `onHeaderClick` + `column.id === GUTTER_FIELD`; `headerCellAttrs` supplies `role`/`aria-label`/`data-testid` | `onSelectAll` (§5 D6's bypass) |
| 7 | Header label, PK/FK badge, sort chevron + order badge | **L/M** | `sortable: true` → `.slick-sort-indicator` + `.slick-sort-indicator-numbered` (F8); `onHeaderCellRendered` for the badge span | `keyLabelFor`, `sortTerms`, `setSortColumns` mirror |
| 8 | Header structured tooltip | **L** | `headerCellAttrs: { 'data-kira-tip-parts': … }` — the app's tooltip controller is attribute-driven (`workbench/state/tooltip.ts:110-165`), so **zero** new machinery and no `onHeaderCellRendered` pass | `columnHeaderTooltip` |
| 9 | Header click cycles asc → desc → none, mirrored to ORDER BY | **L/M** | `tristateMultiColumnSort: true`, `multiColumnSort: false`, `onSort` (F8) | `setSort(tabId, …)` |
| 10 | Column resize, persisted | **L/M** | `resizable: true`, `minWidth: 40`, `onColumnsResized` (F9) | `patchDataTabState({ columnWidths })`, with §5 D3's echo guard |
| 11 | Column select zone (10 px strip) | **M** | `onHeaderCellRendered` appends the span; removed in `onBeforeHeaderCellDestroy` | `onHeaderSelectClick`'s shift/ctrl semantics |
| 12 | Column order / projection (external menu) | **✓** | `setColumns` | `ColumnsMenu.vue`, `resolveColumnOrder` |
| 13 | Cell body: text, NULL italic, truncated marker + tooltip | **✓** | `addClasses` / `toolTip` (F10) | `cellFormatter` |
| 14 | FK/PK nav button — **moved to the left** | **M** | `onMouseEnter`/`onMouseLeave` + `onActiveCellChanged` for placement; `onClick` for the hit (F12, F13) | `cellNavEntry`, `foreignKeyNavItems`, `referencedByItems`, `openContextMenu`. §5 D11 |
| 15 | Type-based cell colour + priority rule | **✓** | `column.cssClass` | `slickTheme.css` cascade |
| 16 | Numeric right-alignment + tabular numerals | **✓** | `column.cssClass` | — |
| 17 | Cell state classes incl. 4 perimeter edges | **M** | `setCellCssStyles` × 4 keyed layers | `cellClass()`, perimeter arithmetic. §5 D5/D6 |
| 18 | Row state: pending-delete, dirty/deleted/inserted rails | **M** | `getItemMetadata().cssClasses` (F11) | `pendingRowClasses` (extended) |
| 19 | Four selection kinds | **M** | `SlickHybridSelectionModel` (F1) | `Selection`, `selectionFromRanges`. §5 D4 |
| 20 | Range drag on cells and gutter + edge auto-scroll | **L** | `SlickCellRangeSelector` via the hybrid model (F1) — **the single largest deletion in the pass** | — |
| 21 | Keyboard: Ctrl+C/V, Enter→edit, arrows, shift+arrows, Delete/Duplicate | **L/M** | `enableCellNavigation: true` + the grid's own nav/Enter/Escape/Tab/Page/Home/End (F6); `grid.onKeyDown` for the app's own | `onCopy`, `onPaste`, `runMenuShortcut(rowMenu(…))` |
| 22 | Inline cell editor, gated on writable ∧ PK ∧ canUpdate ∧ ¬deleted ∧ ¬truncated | **M** | `Editor` interface, `onBeforeEditCell` veto, `editable`, `autoEdit: false` (F5) | `KiraCellEditor`, `stageEdit`, `wrapSelectionOnType`. §5 D8 |
| 23 | Cell-editor dock publish, suppressed during a drag | **A** | — (pure app state; the drag-suppression hack **dies**, see §4.1 item 3) | the existing `watch` on `rt().selection` |
| 24 | Three context menus | **M** | `onContextMenu` / `onHeaderContextMenu` + `getCellFromEvent` (F7) | `cellMenu`/`rowMenu`/`headerMenu` + `openContextMenu`. §5 D7 |
| 25 | Clipboard: 4 copy formats, paste → stageEdit/stageInsertValue/addInsertRow | **A on content, L on trigger** | `grid.onKeyDown` | `clipboardFormats.ts` unchanged. §3, §5 D7 |
| 26 | Pending insert rows, own inputs, `+` gutter, positional identity | **M** | data-source rows + `getItemMetadata().columns[].editor` + a formatter-built `<input>` (F5, F10, F13) | `pendingChanges.ts` unchanged. §5 D9 |
| 27 | Search: match index, current match, hide-non-matching, go-to-match, priority window | **M** | `getLength`/`getItem` for the filter; `setCellCssStyles` for the highlight; `scrollCellIntoView` | `matchedRows`, `createMatchIndex`, `setVisibleRows`. §5 D12 |
| 28 | Decode-on-entry + window-pruned retention (P5 C1) | **✓** | `onRendered` + `lastRenderedRowBounds` | `setVisibleWindow` |
| 29 | Scroll-position persistence + restore | **✓** | viewport `scroll` listener | `patchDataTabState` |
| 30 | Empty states: "No rows" / "No matching rows" + *Show all rows* | **M** | — | overlaid, not swapped (§5 D13) |
| 31 | Density (22/28) + font/appearance re-measure | **✓** | `setOptions({ rowHeight })`, `setColumns` | `resetMeasureCtx` |
| 32 *(new)* | `data-testid`/`data-*` surface for `tests/ui/` | **L/M** | `cellAttrs`/`headerCellAttrs` (F3) + one row-only `onRendered` pass (F4) | §5 D10 |
| 33 *(new)* | `active` cell ring, `.slick-cell.editable`, resize handle, drag decorator — SlickGrid's own visual classes | **M** | the shipped `slick.grid.css` | retokenised in `slickTheme.css`. §5 D14 |
| 34 *(new)* | `__kiraGridEngine` retirement | **M** | — | §7 |

### 4.1 The genuine behaviour changes, named before implementation

1. **A range's anchor is normalised to its top-left (F14).** Today a drag from bottom-right to
   top-left leaves `anchorRow/anchorCol` at the bottom-right, and `onPaste` uses the anchor as the
   paste origin (`DataGrid.vue:1623-1625`). After the migration the origin is always the range's
   top-left, which is what every spreadsheet does. **Accepted as a fix, not a regression** — but it
   is a change, and `interaction.spec.ts`'s paste-into-a-range case must be read against it.
2. **The selected-cells fill is drawn by SlickGrid's own layer.** `selectedCellCssClass:
   'kira-cell-selected'` replaces `isSelected`'s per-cell evaluation. Visually identical (same class,
   same rule); different cost profile (F2), gated in §5 D6.
3. **`cellDragActive` and its whole reason for existing disappear.** `DataGrid.vue:703-712`'s
   reactive drag flag exists solely because `extendSelectionTo` re-writes `rt().selection` on every
   pointer move, transiently producing a degenerate one-cell range that flashes the cell-editor dock
   open and shut. Under the hybrid model, cell-mode drags publish **only on drag end**
   (`handleCellRangeSelected` returns early for `caller === 'onCellRangeSelecting'`,
   `src/plugins/slick.hybridselectionmodel.ts:666-668`), so there is nothing transient to suppress.
   Row-mode drags *do* publish per move, but a `row` selection never satisfies `selectionTarget()`
   anyway. **A hand-rolled workaround deleted because the library made it unnecessary** — the
   clearest single example of what the standing instruction is for.
4. **Ctrl/Cmd-click no longer builds a disjoint *cell* selection.** It does not today either
   (`DataGrid.vue:869-871`'s comment says so explicitly); `enableMultiSelection: false` preserves
   that. Recorded so nobody "fixes" it by flipping the option without reading §5 D4.
5. **`.has-nav`'s padding reserve becomes slightly over-eager.** §5 D11: the class is applied from a
   cheap per-cell predicate (the column is in the FK/PK set ∧ the value is non-NULL), while the
   button itself is placed only after the exact `cellNavEntry` check. On a *composite* FK whose other
   source column is NULL, the cell reserves 18 px it never uses. No visual artifact beyond slightly
   earlier text truncation on that one cell; named rather than discovered.
6. **`__kiraGridRowUpdates` and `__kiraGridTuning.incrementalRows` disappear.** Both are
   `GridRow.vue`-specific (`GridRow.vue:31-33`; `DataGrid.vue:1436`). Their replacement — a
   `MutationObserver` on the canvas — is already in `slick-grid.spec.ts` (Pass A C6). §7.
7. **`.data-grid`'s `data-pagination` attribute is dropped.** Grepped: no spec reads it from the
   grid; `data-view.spec.ts:1333` reads it from `[data-testid="pager"]`. Dead weight.
8. **Cell text selection stays off.** `enableTextSelectionOnCells: false` is SlickGrid's default
   (`src/slick.grid.ts:300`) and matches `.grid-cell { user-select: none }`. No change; recorded so
   it is not mistaken for one.

---

## 5. Decisions

### D0 — The reactivity rule, restated as something checkable

`docs/ARCHITECTURE.md`: *"No Vue reactivity on row data."* Pass B adds several new functions that run
**inside** SlickGrid's synchronous render (`cellFormatter`, `gutterFormatter`, `extractValue`,
`getItemMetadata`, `getEditor`) and several that run inside a Vue `watch` callback and then call
imperatively into the grid. Two rules, both stated at their declaration site:

1. **Nothing called from inside `render()` may create a Vue reactive dependency.** `stagedValue`
   (`pendingChanges.ts:70`) reads a `reactive` store and is already on this path in Pass A. It is
   safe *because* no Vue effect is active when SlickGrid renders — a `watch` **callback** is
   untracked, and a scroll listener is not an effect at all. The rule is therefore: **every
   imperative call into the grid happens from a `watch` callback or a DOM event handler, never from
   inside a `computed` and never from a `watchEffect` getter.** A `computed` that called
   `grid.render()` would register the whole page as a dependency of that computed.
2. **No `ref`/`reactive`/`shallowRef` may ever hold a `RowHandle`, a `CellView`, a `TabularPage`, a
   `SlickRange`, the grid, the selection model, or any DOM node the grid owns.** Pass A already
   states this for the grid instance (`SlickGridHost.vue:158`); Pass B extends it to the selection
   model, the editor instance and the nav-button element, all of which are plain `let`s.

`tests/ui/perf.spec.ts`'s retained-bytes check and `__kiraRetention().decodeCacheRows` remain the
gate on (2); (1) has no automated gate and is a review item plus a comment at each declaration.

### D1 — The data source grows the four things Pass B needs, and nothing else

`views/grid/slick/dataSource.ts` keeps its shape (`RowHandle`, `GridDataSourceState`,
`createGridDataSource`, `createDisplayValueExtractor`, `pendingRowClasses`) and gains:

```ts
export interface GridDataSourceState {
  index: DisplayRowIndex;
  inserts: readonly PendingInsert[];              // was Pick<PendingInsert,'id'>[] — D9 needs `values`
  rowClasses?: (row: number) => string | undefined;
  /** D9: per-row column metadata — the insert region's editor override, and its focusable/
   *  selectable flags. `undefined` for a normal row, which is the overwhelming majority. */
  rowColumns?: (handle: RowHandle) => ItemMetadata['columns'] | undefined;
  extractValue: (item: RowHandle, field: string) => unknown;
}
```

`getItemMetadata(pos)` composes `cssClasses` and `columns` from those two callbacks, still
allocating **no second `RowHandle`** for the `cssClasses` path (`-iter2-pacing` D6's
`pageRowAt` split stays). `rowColumns` needs the handle (it keys on `insertId`), so it takes one —
but it is only called when `state.rowColumns` is set *and* returns non-`undefined`, i.e. for the
handful of insert rows; the normal path is unchanged and still allocates one handle per built row.

`pendingRowClasses` gains the third case Pass A's stale comment already promised:

```ts
if (insert) return 'kira-row-inserted';
if (p.deletes.has(row)) return 'kira-row-deleted';
if (p.edits.has(row)) return 'kira-row-dirty';
```

### D2 — Columns are rebuilt from one function, and `setColumns` is called for exactly four reasons

`buildColumns(page, order, widths, meta, sortTerms)` in `SlickGridHost.vue` gains, per data column:

```ts
{
  id: name, field: name, name,
  width, minWidth: 40,                             // F9 — the app's own resize floor
  resizable: true,                                 // F9
  sortable: true,                                  // F8 — creates the indicator divs
  focusable: true, selectable: true,               // defaults, stated (src/slick.grid.ts:350,357)
  cssClass: `tc-${category}${alignRight ? ' kira-align-right' : ''}`,
  formatter: cellFormatter,
  editor: KiraCellEditor,                          // D8 — gated by onBeforeEditCell, not by presence
  cellAttrs: {                                     // F3 — per-column constants, zero per-cell cost
    'data-testid': 'grid-cell',
    'data-column': name,
    'data-col-index': String(displayIndex),
  },
  headerCellAttrs: {
    'data-testid': 'grid-header-cell',
    'data-column': name,
    'data-col-index': String(displayIndex),
    'data-kira-tip-parts': JSON.stringify(columnHeaderTooltip(...)),   // item 8
  },
}
```

and, for the gutter column, `sortable: false`, `resizable: false`, `focusable: true`,
`selectable: true` (**changed from Pass A's `false`/`false`** — F1's row-select-on-gutter requires
`canCellBeActive(row, 0)`, and `handleClick`'s row branch checks it at
`src/plugins/slick.hybridselectionmodel.ts:497`), `cellAttrs: { 'data-testid': 'grid-gutter-cell' }`,
`headerCellAttrs: { 'data-testid': 'grid-select-all', role: 'button', 'aria-label': 'Select all cells' }`.

**Making the gutter focusable has one side effect worth pricing**: Tab and Left-arrow can now land
on it. `onBeforeEditCell` vetoes editing there (D8), and a gutter *active cell* immediately becomes a
row selection via the hybrid model, which is the intended behaviour. Accepted.

`setColumns` is called on, and only on: (a) `pageVersion` change, (b) `columnOrder`/`projection`
change, (c) `appearanceVersion` change (after `resetMeasureCtx`), (d) a `columnWidths` change that
did **not** originate from a resize drag (D3). It is *not* called on a sort change — `setSortColumns`
handles that without rebuilding headers (F8).

### D3 — Column resize: SlickGrid drags, the app persists, and the echo is suppressed

`onColumnsResized` → read each column's `width` off `grid.getColumns()` → `patchDataTabState(tabId,
{ columnWidths })`. The `columnWidths` watch would then call `setColumns` and rebuild every header
and every rendered row mid-interaction. A single plain `let suppressWidthEcho = false` around the
patch is the whole fix, and it is the same shape as `DataGrid.vue`'s own `dragProducedRange` guard.
Stated as a rule because the loop is invisible at either call site.

### D4 — Selection: `SlickHybridSelectionModel` owns the geometry, `rt().selection` owns the meaning

New file `views/grid/slick/selection.ts`, pure functions, unit-testable without a DOM.

**Configuration** (F1):

```ts
grid.setSelectionModel(new SlickHybridSelectionModel({
  selectionType: 'mixed',
  rowSelectColumnIds: [GUTTER_FIELD],
  selectActiveCell: true,
  selectActiveRow: true,
  dragToSelect: true,          // -> selectionCss { border: 'none' }: an invisible drag decorator
  autoScrollWhenDrag: true,
  enableMultiSelection: false, // §4.1 item 4 — parity, not a limitation of the model
  showDragHandle: false,       // no Excel fill handle; the app has no fill semantics
}));
```

with `selectedCellCssClass: 'kira-cell-selected'` on the grid (replacing Pass A's `''`, which only
renamed the layer key, F2) and `multiSelect: true` (SlickGrid's default — this is what enables
ctrl/shift disjoint *row* selection at `:539-556`).

**Mapping, both directions.** `SlickRange[]` is geometry; `Selection` carries a `kind` that copy,
the three menus, the cell-editor publish and the Delete shortcut all branch on. Neither side can be
the sole authority, so:

```ts
// slick/selection.ts
export function selectionFromRanges(
  ranges: readonly SlickRange[],
  rowMode: boolean,
  pendingKind: 'column' | null,
): Selection | null
```

- `pendingKind === 'column'` → `{ kind: 'column', cols }` (set by the header select-zone handler
  immediately before it pushes ranges into the model, consumed once — the same one-shot-flag shape
  `dragProducedRange` uses today).
- `rowMode` (`selectionModel.currentSelectionModeIsRow()`,
  `src/plugins/slick.hybridselectionmodel.ts:...`) → `{ kind: 'row', rows: ascending union }`.
- one range, `isSingleCell()` → `{ kind: 'cell', row, col }`.
- one range, multi-cell → `{ kind: 'range', anchorRow: fromRow, anchorCol: fromCell, row: toRow,
  col: toCell }` (F14: normalised; §4.1 item 1).
- empty → `null`.

and the reverse, `rangesFromSelection(sel, rowCount, colCount): SlickRange[]`, used when app code
sets the selection (the header select zone, the row/cell context menus' "replace the selection
first" rule at `DataGrid.vue:1517-1518` and `:1537`, `scrollCellIntoView` from search/FK-nav).

**Column indices.** `Selection.col` is a *display* column index; SlickGrid's `cell` is a column
array index that includes the gutter at 0. The offset is exactly `+1`, in one place each direction,
and both are named constants in `selection.ts` — Pass A's `defineExpose({ scrollCellIntoView })`
already has this `col + 1` and its comment.

**Row indices.** `SlickRange` rows are *display positions*; `Selection` rows are *page rows*.
`selectionFromRanges` translates through the data source's `getItem(pos).row` and
`rangesFromSelection` through `displayPositionOf`. Those two functions move out of `DataGrid.vue`
into `dataSource.ts` (they are already the data source's own arithmetic — `pageRowAt` is one half of
the pair) so the deletion in §9 stage 3 has nothing to salvage.

`isSelected` and `isSelectedNeighbor` do **not** move: nothing outside rendering calls them, and
rendering is D6's job.

### D5 — Four keyed CSS layers, and what each is allowed to cost

| key | owner | scope | recomputed when |
|---|---|---|---|
| `kira-cell-selected` | **SlickGrid** (`selectedCellCssClass`) | the whole selection | any selection change (F2) |
| `kira-sel-edges` | the app | the selection's **perimeter only**, intersected with the rendered range | selection change, or the rendered range leaving the previous band |
| `kira-search` | the app | every match | the search result or current match changes |
| `kira-staged` | the app | staged rows only | a cell is staged or un-staged |

Two properties make this affordable and both are consequences of §4.1 item 4:

- **The committed selection is at most one rectangle** (or, in row mode, a set of full-width row
  rectangles). The *perimeter* of a rectangle is `2·(rows + cols)` cells, not `rows × cols`. Clipped
  to the rendered range it is at most a few hundred entries even for a select-all. So
  `kira-sel-edges` is **O(perimeter ∩ rendered)**, never O(area) — which is why the four-edge
  `--sel-t/-r/-b/-l` mechanism (P42 D21/F15, pure CSS, `GridRow.vue:240-267`) can move across
  unchanged instead of being replaced.
- **`kira-staged` is bounded by what the user staged** (`pendingFor(tabId).edits`, a `Map`), which is
  a handful of rows in every real session.

`kira-search` is the one layer that can genuinely be large, and F2's merge-cost caveat means a large
`kira-search` taxes *every other layer's* update. Pass A §8.6 item 2 asked for this to be measured
rather than reasoned about; §9.2 T7 is that measurement, and the named fallback — if it bites — is
to scope `kira-search` to a **hysteresis band** (rendered range ± `SEARCH_BAND_ROWS`, re-set from
`onRendered` only when the rendered range leaves the band), which is a strictly local change to one
function.

### D6 — Select-all, and the O(area) hash that comes with the selection model. **The one place adopting SlickGrid's mechanism has a price.**

F2: pushing a whole-page range into the selection model costs ~`rows × columns` iterations inside
`handleSelectedRangesChanged`, each with a `canCellBeSelected` call that reaches this app's
`getItemMetadata`. Today `onSelectAll` is free.

**Decision: adopt the model for select-all too, gate the cost, and keep a named bypass ready.**

- The gate (§9.2 T6, sandbox-provable): on the 1 000-row × 61-column `spike_grid` fixture, and again
  on a 10 000-row fixture, clicking the select-all corner must complete within **150 ms** measured
  from the click to `onSelectedRangesChanged` returning. 150 ms, not the 12/50 ms scroll budget,
  because this is a one-shot explicit user action, not a frame.
- The bypass, if it fails: `onSelectAll` sets `rt().selection` directly, calls
  `selectionModel.setSelectedRanges([])`, and toggles a `.kira-select-all` class on the host root
  whose CSS paints every `.slick-cell` with the selection background. The perimeter layer then
  covers only the four outer edges of the page, clipped to the rendered range — which D5's algorithm
  already computes. Copy, the menus and Delete read `rt().selection`, so nothing else changes.
  **This bypass is written down here, not discovered later**, and its cost is one CSS rule plus one
  branch.
- Whichever way the gate falls, `canCellBeSelected`'s per-cell `getItemMetadata` call is worth one
  cheap defence regardless: `getItemMetadata` returns `null` early when neither `rowClasses` nor
  `rowColumns` has anything to say for that row (already true in `dataSource.ts:144-150`), so the
  inner loop's cost is a function call and a `pageRowAt` add, not an allocation.

### D7 — Menus and clipboard: SlickGrid triggers, `menu.ts`/`clipboardFormats.ts` supply

**Context menus** (item 24). Three subscriptions replace `onDataGridContextMenu` +
`matchedGridElement` + `rowColOf`:

```
grid.onContextMenu       -> e.preventDefault() (F7 does not)
                         -> cell = grid.getCellFromEvent(e)
                         -> cell.cell === 0 ? onGutterContextMenu(pageRow, e) : onCellContextMenu(pageRow, cell.cell - 1, e)
grid.onHeaderContextMenu -> args.column.id === GUTTER_FIELD ? nothing : onHeaderContextMenu(displayCol, e)
```

The gutter-vs-cell split is `cell.cell === 0`, replacing today's `.gutter-cell[data-row]` vs
`.grid-cell[data-row]` class test. `onGutterContextMenu`/`onCellContextMenu`/`onHeaderContextMenu`
themselves — the functions that build the selection-aware `rows` list and call `rowMenu`/`cellMenu`/
`headerMenu` + `openContextMenu` — move from `DataGrid.vue` into `SlickGridHost.vue` **unchanged in
body**, minus their `displayCell`/`rowSnapshot` helpers which move to a new
`views/grid/slick/rowValues.ts` (see below).

**Clipboard** (item 25). `grid.onKeyDown` → the app's handler runs first (F6) → on Ctrl/Cmd+C or
Ctrl/Cmd+V it calls the existing `onCopy`/`onPaste` verbatim and
`e.stopImmediatePropagation(); e.preventDefault()`. Nothing in `clipboardFormats.ts` changes. The
row shortcuts (`grid.duplicateRows`, `grid.deleteRows`) dispatch through `runMenuShortcut(rowMenu(…))`
exactly as today (P21 D5), from the same handler.

**`rowValues.ts`** is the small module that `DataGrid.vue` currently keeps inline and that both the
menus and the clipboard need: `displayCell(tabId, page, order, row, col)`, `rowSnapshot`,
`columnValuesFor`, `rowsForColumnOps`, `navValuesFor`, `navColumns`, `cellNavEntry`. Extracting it
is what lets `DataGrid.vue` be deleted in one commit rather than picked apart, and it is *content*
by §1's line — no SlickGrid API appears in it.

### D8 — Editing: a `KiraCellEditor` in the cell, and the overlay `<input>` goes away

New file `views/grid/slick/editor.ts`.

```ts
export class KiraCellEditor implements Editor {
  init(args)          // <input class="cell-input" data-testid="grid-cell-input"> in args.container,
                      // + wrapSelectionOnType on keydown; focus(); select()
  loadValue(item)     // displayCell(item.row, col).text, '' for NULL  (P24 D14's scope limit)
  serializeValue()    // the buffer, verbatim
  applyValue(item, s) // stageEdit(tabId, item.row, columnName, s) — NEVER writes to item or page
  isValueChanged()    // buffer !== loaded
  validate()          // { valid: true, msg: null } — no client-side validation in this phase
  destroy(); focus()
}
```

Grid options: `editable` bound to `canEditTable`, `autoEdit: false`, `autoCommitEdit: true`,
`asyncEditorLoading: false`, `editorCellNavOnLRKeys: false`.

`onBeforeEditCell` vetoes (returns `false`, F5) when **any** of: the column is the gutter; the row is
`isPendingDelete`; the cell's value is `truncated` (P24 D27 — committing the buffer would write the
truncated text over the real value); the row is a pending insert (D9 owns that surface). Those five
predicates are exactly `startEdit`'s guards at `DataGrid.vue:810-818` plus the two new ones, and they
live in one function so the veto and the cell menu's `Edit` item (`disabled: editDisabled`) cannot
drift.

**Three consequences worth stating:**

1. **`applyValue` must never write to `item`.** `RowHandle` is `Object.freeze`d
   (`dataSource.ts:71,73`) and the page behind it is frozen with a tripwire (`store.ts`). A write
   would throw — which is the *correct* behaviour and is worth an assertion in the editor's own
   test.
2. **The single overlay `<input>` that `-iter2-pacing` D4 introduced disappears**, along with
   `editingCellRect`, `editingCell`, `editingBuffer`, `isEditing`, `.cell-input-overlay` and
   `RowSig.editingCol`. SlickGrid puts the editor in the cell, which is where it lived before P22
   iter2 — a return to the earlier shape, not a new one.
3. **`.slick-cell.editable` carries `z-index: 11; overflow: visible` in the shipped
   `slick.grid.css`, and `slickTheme.css`'s own header comment warns that `contain: layout` on
   `.slick-row` makes that z-index unable to escape the row.** It does not need to: a single-line
   input sized to the cell never paints outside it. The rule this pass adds, at that comment: **the
   grid's editor must fit inside its cell.** If a future editor needs to be taller, the sanctioned
   escape is the `Editor` interface's own `position()`/`hide()`/`show()` hooks with a
   `document.body`-level container (`src/models/editor.interface.ts:36-42`), not a z-index fight
   with the row's containment. **This is the first of the two places §0.3 said would touch the
   confirmed-good mechanism, and it touches it only by adding a comment.**

### D9 — Pending insert rows keep their inputs, and Pass A's `!` turns out not to be a behaviour change

Pass A §5.1 item 1 flagged this as the one genuine regression: insert rows would become ordinary
editable rows, so *"an insert row's inputs are no longer all simultaneously focusable."* Reading
`appendCellHtml` (F10) and `handleClick` (F13) says that trade is avoidable.

**Design.** Insert rows stay real data-source rows (`getLength()` already includes them,
`dataSource.ts:39-41`), so they scroll, position and virtualize correctly. Their *cells* are built by
the same formatter, which — for a handle with `insertId !== undefined` **only** — returns a real
`HTMLElement`:

```ts
if (handle.insertId !== undefined) {
  const input = document.createElement('input');
  input.className = 'cell-input';
  input.dataset.testid = 'grid-cell-insert-input';
  input.value = insertValue(tabId, handle.insertId, field) ?? '';
  return input;                       // -> applyHtmlCode appendChild's it (Pass A F6)
}
```

with `cellAttrs` already supplying `data-testid="grid-cell"`; the *row* gets
`data-testid="grid-row-insert"` and `data-insert-id` from D10's row pass, and
`kira-row-inserted` from `getItemMetadata().cssClasses`. The `input`/`keydown` handlers are **one
delegated listener each on the grid canvas** (`stageInsertValue`, `wrapSelectionOnType`), not per
element — the same delegation discipline `-iter2-pacing` established, applied to the one place this
pass adds DOM.

`getItemMetadata(pos).columns` gives every column of an insert row `{ editor: null, focusable: false }`
so SlickGrid never opens its own editor over the input and cell-navigation skips the region (F11);
`onBeforeEditCell` vetoes it too, belt and braces.

**Three rules, each a real hazard:**

1. **Never `invalidateRow` an insert row while one of its inputs has focus.** SlickGrid's
   `updateRow`/`invalidateRow` empties and rebuilds the cell, destroying the focused input. Values
   survive (every keystroke stages into `pendingChanges`), the caret does not. The host's
   pending-changes watch therefore excludes insert rows from its invalidation set unless the change
   came from outside the grid (a discard, a commit, a `duplicateAsInsert`).
2. **This is the one place a formatter returns DOM**, against `-iter2-pacing` D5's measured
   "text, never DOM" rule. It is bounded to the insert region (typically 1-5 rows, never scrolled
   past in bulk) and the normal path is untouched. **This is the second of §0.3's two places, and it
   gets its own gate**: §9.2 T8 re-runs the pacing invariant (`renderCountHistogram` all-1,
   `renderMs` p95) on a fixture *with* staged insert rows, and the commit that lands it is separate
   so it is bisectable.
3. **Positional identity is unchanged.** `pending.inserts[row - page.rowCount]`
   (`DataGrid.vue:1643`) is already what `rowHandleAt` implements (`dataSource.ts:56-74`).
   `mutations.spec.ts`'s insert scenarios are the regression guard, unmodified.

**Net: item 26 ships at full parity, `grid-row-insert`/`grid-cell-insert` keep working, and Pass A's
only `!` is retired.**

### D10 — The `data-*` surface: static where it can be, one row-only pass where it cannot

Per F3, everything except two things is a column constant and costs nothing per cell:

| attribute | where | cost |
|---|---|---|
| `data-testid="grid-cell"` / `"grid-gutter-cell"` | `cellAttrs` | per cell build, alongside SlickGrid's own three |
| `data-column`, `data-col-index` | `cellAttrs` | ditto |
| `data-testid="grid-header-cell"` / `"grid-select-all"`, `data-column`, `data-col-index`, `data-kira-tip-parts`, `role`, `aria-label` | `headerCellAttrs` | once per `setColumns` |
| `data-null` | **retired** — `.cell-null` (formatter `addClasses`) carries it | — |
| `data-sort` | `onHeaderCellRendered` / `setSortColumns` mirror | once per sort change |

The two that cannot be static are both on the **row**, and there are ~200 rows, not ~2 400 cells:

```
grid.onRendered -> for each .slick-row in the newly rendered range, in BOTH panes (F4):
    row.dataset.row = String(handle.row)          // correct display position -> PAGE row
    if (right pane) row.dataset.testid = 'grid-row'  // only once per row (F4) so counts stay exact
    if (handle.insertId) { testid = 'grid-row-insert'; row.dataset.insertId = handle.insertId }
```

**The `data-row` asymmetry is a trap and gets a comment at both ends** (Pass A's D10 already said
so): SlickGrid writes the *display position* there at `src/slick.grid.ts:5726`; this pass overwrites
it with the *page row*, which differ only while the search filter is hiding rows. Tagging
`data-testid="grid-row"` on the right pane only is what keeps `[data-testid="grid-row"]` counts
identical to today's (F4).

The pass is skipped entirely when the rendered range did not change (`lastRenderedRowBounds` is
already tracked, `kiraSlickGrid.ts:150`), so a sub-row scroll writes nothing — which
`slick-grid.spec.ts`'s existing zero-mutation gate will enforce for free.

### D11 — The FK/PK nav affordance: **one** button, hover-driven, **on the left**

Three changes, in order of the user's own emphasis.

**(a) Position — the user's explicit request.** Confirmed from source, not assumed:
`GridRow.vue:298-315` has `.cell-nav-btn { position: absolute; right: 4px; top: 50%; transform:
translateY(-50%); width: 16px; height: 16px }`, and `GridRow.vue:227-229` reserves space for it with
`.grid-cell.has-nav { padding-right: calc(var(--kira-s-4) + 18px) }`. The port to `slickTheme.css`
is the same rule with `right: 4px` → **`left: 4px`** and `padding-right` → **`padding-left`** on
`.slick-cell.has-nav`. `.slick-cell` is `position: absolute` in the shipped `slick.grid.css`, so it
is a containing block and no `position: relative` is needed. On a right-aligned numeric column the
left placement is strictly better — the button no longer sits where the value's last digits are.

**(b) One button, not one per nav cell.** Today every cell with a nav affordance renders its own
`<button>` + `<CodiconIcon>` subtree and CSS hides all but the hovered/selected ones
(`GridRow.vue:95-104`, `:322-325`). Under SlickGrid the host owns **a single** button element,
created once in `onMounted` and moved into whichever cell currently wants it:

```
grid.onMouseEnter        -> cell = getCellFromEvent(e); place(cell)
grid.onMouseLeave        -> place(activeCellIfNav())
grid.onActiveCellChanged -> place(activeCellIfNav())
grid.onRendered          -> re-place (the previous host node may have been rebuilt)
grid.onClick             -> if (e.target.closest('.cell-nav-btn')) { run the entry; stopImmediatePropagation() }
```

`place(cell)` runs the **exact** `cellNavEntry(row, displayCol)` from `rowValues.ts` (D7) — the
`foreignKeyNavItems`/`referencedByItems` content, the fk-over-pk precedence, the `disabled` filter —
and appends the button (with `data-nav-kind`, `aria-label`, `data-testid="cell-nav-button"` and the
`<span class="codicon codicon-arrow-right|references">`) only when it returns non-null. Otherwise it
removes it. `onClick` runs `only.run()` for a single candidate or `openContextMenu(e, entry.items)`
for several — `onCellNavClick`'s body, verbatim.

**Cost**: `cellNavEntry` (which builds `navValuesFor` for the row) runs **once per hover**, not once
per rendered cell per render. Today `buildRowVm` calls it for every cell of every rebuilt row
(`DataGrid.vue:1366`). This is a strict reduction, and it removes `navCache` and the per-render
`colorByCol`/`navCache` maps with it.

**(c) `.has-nav`'s padding reserve** still needs to be per-cell, from the formatter, and must be
cheap — so it uses the *cheap precheck* only: the column is in `navColumns.fk ∪ navColumns.pk` (a
`Set` lookup, already computed once per meta change) **and** the cell is not NULL. That is exactly
`isForeignKeyDisplayCol(c) && !dc.isNull` from `buildRowVm:1368`, widened to the PK set. §4.1 item 5
names the resulting micro-delta.

The `.fk` colour class (`GridRow.vue:221-223`) rides along on the same predicate, unchanged.

### D12 — Search: the filter is the data source, the highlight is a layer, the jump is `scrollCellIntoView`

Pass A deliberately read `matchedRows` once at mount and on page reload
(`SlickGridHost.vue:57-64`'s comment). Pass B makes it live:

- **Filter**: a `watch` on `matchedRows(tabId)` → `dataSource.setState({ index: { displayRows, … } })`
  → `grid.updateRowCount(); grid.invalidateAllRows(); grid.render()`. `getLength`/`getItem` already
  do the rest (`dataSource.ts:34-74`).
- **Highlight**: the `kira-search` layer (D5), built from `createMatchIndex`'s `has`/`isCurrent`
  (`views/shared/page/search.ts:107-130`) mapped through `cellClass({ searchMatch,
  searchMatchCurrent })` so the class names are the ones `GridRow.vue` already draws and
  `theme/cellClass.ts` already owns.
- **Go-to-match**: `DataView.vue`'s `onGoToMatch` already calls the host's `scrollCellIntoView(row,
  col)` through a template ref; the host translates page row → display position and `col + 1`, then
  calls `grid.scrollCellIntoView`. Pass A's `defineExpose` comment about the identity pass-through
  being *"exact, not an approximation, for as long as [no live filter] stays true"* is exactly the
  thing this decision retires; the comment is replaced by the real translation.
- **Search-priority window**: unchanged — `setVisibleRows` from `onGridRendered`
  (`SlickGridHost.vue:274-285`), which already fires on mount.

### D13 — Empty states overlay the grid; they never replace it

`DataGrid.vue:1817-1837` swaps the whole grid out for an `EmptyState`. The host cannot do that: its
root div *is* the grid's container, and `v-if`-ing it away would unmount the element SlickGrid holds
references to. So the two empty states become absolutely-positioned siblings **inside** the host's
template, over the always-mounted grid root — which `.no-rows { position: absolute; inset: 0 }`
(`DataGrid.vue:2142-2145`) already is. `grid-no-rows`, `grid-no-matching-rows` and
`grid-show-all-rows` keep their testids and `data-view.spec.ts:1437-1450` keeps working.

### D14 — Theme: retokenise the six SlickGrid classes Pass B newly exposes

`slickTheme.css` gains rules for classes Pass A never reached, each replacing a hardcoded colour from
the shipped `slick.grid.css` (4 355 B raw / 1 252 B gzip, still the only SlickGrid stylesheet
imported):

| class | shipped | Pass B |
|---|---|---|
| `.slick-cell.editable` | `z-index: 11; overflow: visible; background: #fff; border-color: #000` | transparent background, `--kira-accent` outline — `DataGrid.vue`'s `.cell-input` look (`:2113-2124`), and D8's fit-inside-the-cell rule as a comment |
| `.slick-cell.active` | (none — `showCellSelection` adds the class only) | no rule: the app's own `kira-cell-selected` + perimeter is the selection affordance; an extra ring would double-draw |
| `.slick-sort-indicator{,-asc,-desc}` | CSS triangles in `#3490dc` | the codicon glyphs (`codicon-arrow-up`/`-down`) at `--kira-accent`, matching `CodiconIcon`'s own output — Pass A §5.1 item 3's "a `<span class="codicon">` renders identically" finding, applied to a pseudo-element |
| `.slick-sort-indicator-numbered` | `Arial`, `#6190cd` | `DataGrid.vue`'s `.sort-order` badge rule (`:2062-2075`) |
| `.slick-resizable-handle` | `width: 9px; right: -5px` | `width: 4px; right: -2px`, `cursor: col-resize` — `DataGrid.vue:2090-2098` |
| `.slick-header-column-sorted` | `font-style: italic` | neutralised (the app signals sort with the chevron, not italics) |
| `.slick-range-decorator` | (no rule; inline `border: none` via `dragToSelect`) | `pointer-events: none` for safety — the decorator's own source TODO admits it blocks events (`src/plugins/slick.cellrangedecorator.ts:11-13`) |

Plus the moved `.cell-nav-btn` (D11a), `.slick-row.kira-row-inserted`,
`.slick-row.kira-row-deleted` (strike-through + 50 % opacity, `GridRow.vue:327-330`), the
`.kira-row-inserted .kira-gutter::before` green rail, and the four `--sel-*` perimeter rules moved
verbatim from `GridRow.vue:240-267`. **No literal colour, radius or spacing** — the existing rule.

### D15 — Instrumentation after the incumbent is gone

- `scrollTrace.registerGrid(el, rowSelector)`'s second parameter loses its reason to exist once
  `[data-testid="grid-row"]` is written onto `.slick-row` (D10) — but it stays, defaulted to
  `'[data-testid="grid-row"]'`, because that is now correct for the only grid there is. One-line
  comment update, no signature change, so `scroll-trace.spec.ts` is untouched.
- `__kiraGridRowUpdates` and `__kiraGridTuning.incrementalRows` are deleted with `GridRow.vue` and
  `DataGrid.vue` (§4.1 item 6). `main.ts`'s `declare global` block, `tests/ui/global.d.ts` and
  `kiraSlickGrid.ts`'s own mirrored declaration all drop `incrementalRows`.
- Every other `__kiraGridTuning` key (`leadFramesOverride`, `maxLeadPxOverride`,
  `maxNewCellsPerRenderOverride`, `forceSyncScrollingOverride`, `chaseQuietMsOverride`,
  `maxNewLeadCellsPerRenderOverride`, `chaseFrameGateOverride`, `freshVelocitySampleOverride`)
  **stays exactly as it is** — these are the live A/B dials `docs/PERF.md` §2.1c's protocol depends
  on, and several are documented as provisional pending further real-hardware readings.

---

## 6. `ConsoleResultGrid.vue` — the decision Pass A punted, made

**It stays on `VirtualList` + `@tanstack/vue-virtual`. It is not migrated in Pass B.**

Pass A §2.3 gave five reasons. All five were re-checked against the current source this session
(`views/console/ConsoleResultGrid.vue`, read at `dd0e062`) and all five still hold:

1. **Still three page kinds through one template.** `page.kind === 'tabular'` (`:378`),
   `'document'` (`:449`, a `DocumentRow` + expandable `DocumentTree`) and key-value. SlickGrid can
   host the first only, so any migration is a partial replacement of one branch, never a file swap.
2. **Still shares only the column helpers.** Its imports from `views/shared/page/columns` are
   `alignmentFor`, `columnHeaderTooltip`, `columnOffsets`, `columnRangeExtractor`,
   `DEFAULT_COLUMN_WIDTH`, `GUTTER_WIDTH`, `initialWidths`, `MAX_OVERSCAN_COLUMNS`, `OVERSCAN_PX`,
   `observeScrollElementOffset`, `observeScrollElementRect`, `resetMeasureCtx` (`:23-36`) — every one
   of which survives this pass untouched. Its rows come from `VirtualList` (`:377`, `:449`), never
   from a row virtualizer. It has no `rowRangeExtractor`, no `RowVM`, no velocity sampler, no chase.
3. **Still read-only.** No editing, no pending changes, no row/column selection kinds, no context
   menus, no clipboard, no FK nav, no sort. Roughly 70 % of §4's map does not apply.
4. **Still not the reported symptom.** Console results are capped
   (`tests/unit/console-result-cap.spec.ts`) and have never been reported as laggy.
5. **Its own `<style scoped>` block owns its `.gutter-cell`/`.cell-null`/`.truncated-marker` rules**
   (`:530`, `:573`, `:623`, `:638`) — verified this session, because if it had depended on
   `GridRow.vue`'s *unscoped* global rules, deleting that file in §9 stage 3 would silently restyle
   the console. **It does not.** This is the one concrete dependency the deletion could have had, and
   it is absent.

And one reason Pass A could not have had, which is the strongest of the six:

6. **Pass B's entire value is that it *removes* a rendering surface.** Net −5.5 KB gzip, −2 589
   lines, one grid instead of two. Migrating the console in the same pass would mean writing a
   *second* SlickGrid host — read-only, three-branch, `VirtualList`-shaped — at the exact moment the
   phase is deleting one. That is the opposite of "clean up and finish the migration", and it would
   put the cutover's own risk and a brand-new component in the same commit range.

**What reopens it, precisely** (unchanged from Pass A, plus the economics): Pass B has been stable
for a release **and** someone reports console-result scrolling as slow — or the team decides the
~6 911 B gzip of `@tanstack/vue-virtual` (measured this session, `vue` external) is worth recovering,
since after Pass B that dependency has exactly **one** runtime consumer: `ConsoleResultGrid.vue`'s
column axis. (`columns.ts:3` imports only the `Range` *type* — zero runtime.) Either way it is a
third pass with its own plan, and its honest scope is the **tabular branch only**.

---

## 7. The cutover, and every test's fate

### 7.1 `DataView.vue`'s engine selection — the end state

**The flag is removed entirely, in §9 stage 3, and not before.**

Reasoning, stated because the brief asked for it:

- Keeping `__kiraGridEngine` as a permanent escape hatch would require keeping `DataGrid.vue` alive
  to escape *to*, which is precisely what the user asked to remove — an escape hatch to a deleted
  component is a dead branch.
- Keeping it for a *transition window* has a real cost and no proven benefit here: the incumbent's
  own scroll behaviour is the thing the whole P22 investigation set out to improve, and the real-Mac
  verdict on the SlickGrid engine is already positive (`-iter2-pacing` §11.4). Nobody is going to
  ask to go back to the slower grid; they are going to report a *parity* bug, and a parity bug is
  fixed forward.
- The staging in §9 gives the safety a flag would have given, without the dead branch: the whole
  `tests/ui/` suite runs against **both** engines from stage 1 (§7.2), the default flips in its own
  commit (stage 2), and the deletion is a separate, later, revertible commit (stage 3). If the
  default flip goes wrong, reverting **one commit** restores the incumbent — with its tests still
  green, because they never stopped running against it.

End state, exactly:

```vue
<div class="grid-area">
  <SlickGridHost ref="dataGridRef" :tab-id="tab.id" />
</div>
```

with `window.__kiraGridEngine`, `DataView.vue`'s `engine` computed, `tests/ui/global.d.ts`'s
declaration and `main.ts`'s entry all deleted, and `docs/PERF.md` §2.1c's protocol rewritten (§10).

### 7.2 How the whole suite runs against both engines from stage 1

New file `tests/ui/support/grid.ts`, landed in §9 C1. It exports the ~7 locator helpers every
grid-touching spec currently redefines locally, resolved for whichever engine the fixture booted:

```ts
export function gridCell(page, row, column): Locator
export function gutterCell(page, row): Locator
export function headerCell(page, column): Locator
export function gridRow(page, row): Locator
export function cellNavButton(page, row, column): Locator
export function insertRow(page): Locator
export function gridScroller(page): Locator   // '.data-grid' | '.slick-viewport-top.slick-viewport-right'
export const ENGINE: 'tanstack' | 'slick'     // from process.env.KIRA_GRID_ENGINE, default 'tanstack'
```

For the SlickGrid engine, `gridCell` is
`` `${RIGHT_PANE} [data-testid="grid-row"][data-row="${row}"] [data-testid="grid-cell"][data-column="${column}"]` ``
(F4: scope to the right pane, or a two-pane row match makes Playwright's strict mode throw), and
`gutterCell` is the left pane's row plus `[data-testid="grid-gutter-cell"]`. For the tanstack engine
they are today's selectors verbatim.

`tests/ui/fixtures.ts` reads `ENGINE` and, when it is `'slick'`, installs
`page.addInitScript(() => { window.__kiraGridEngine = 'slick' })` before the first navigation — the
exact pattern `slick-grid.spec.ts:234-241`'s `forceSlickEngine` already proves works.

**This is what makes the whole plan safe**: from C1 onward, `KIRA_GRID_ENGINE=slick bun run test:ui`
is a full-suite parity check, and the default run still gates the incumbent. Neither engine ever runs
uncovered. At stage 3 the indirection collapses to the SlickGrid form and `ENGINE` is deleted.

### 7.3 Every spec, with its fate

**`tests/ui/` — ported (helper import only, zero call-site changes):**

| spec | grid surface | fate |
|---|---|---|
| `interaction.spec.ts` (1 440) | menus, selection, drag-select, copy/paste, shortcuts, FK nav, insert rows | **ported.** Its 6 local helpers (`gridCell`, `cellText`, `cellNavButton`, `clickCellNav`, `gutterCell`, `headerCell`, `:915-945`) become imports. **The single most important spec in the pass** — it is the behavioural gate on §5 D4/D7/D8/D9/D11. Two assertions get real review: the paste-into-a-range origin (§4.1 item 1) and `clickCellNav`'s comment about the pure-CSS hover gate (now a moved element, D11b) |
| `mutations.spec.ts` (376) | edit, add, delete, preview, commit, discard, read-only | **ported.** The insert-row block (`:260-330`) is D9's gate |
| `data-view.spec.ts` (1 577) | pagination, count, projection, sort, filter, search, stop, NULLs, insert rows, empty states | **ported.** Two `data-null` assertions (`:1567-1569`) become `.cell-null` class assertions (D10) — an implementation-detail rewrite, not a coverage loss |
| `cell-editor.spec.ts` (1 264) | the dock, driven by grid selection | **ported.** Exercises D4's `selectionFromRanges` → `publishSelectedCell` path end to end; §4.1 item 3's deletion of `cellDragActive` is guarded here |
| `budgets.spec.ts` (919) | scroll response, overscan coverage, DOM-cell bounds, mutation counts | **ported at unchanged thresholds** (§9.2). Its `[data-testid="data-grid"]` scroll target becomes `gridScroller(page)`; its `measure*` calls take that instead |
| `perf.spec.ts` (222) | rAF p95, retained bytes, mounted-cell count | **ported at unchanged thresholds.** The retained-bytes half is P5 C1's gate through the new bridge |
| `row-coloring.spec.ts` (148) | per-column type colour, on/off, live repaint | **ported unchanged in substance.** Verified this session that it asserts `getComputedStyle(el).color` and `el.style.color === ''` (`:78-84`) — both hold under Pass A's per-column-class design, and the inline-colour assertion becomes *stronger* (there is no inline colour anywhere now) |
| `fake-data.spec.ts` (312) | generated rows visible in the grid | **ported** (2 helper lines) |
| `leaks.spec.ts` (436) | tab/store symmetry | **ported** (1 poll selector). Its symmetry assertion is the same one `slick-grid.spec.ts`'s teardown test makes; both stay |
| `tooltips.spec.ts` (236) | the header tooltip | **ported** (1 selector). Item 8's `headerCellAttrs` route is what keeps it green |
| `autocomplete.spec.ts` (783) | `grid-row` counts after a filter | **ported** (2 selectors). F4: the right-pane-only `data-testid` is what keeps `toHaveCount(2)` correct |
| `definition.spec.ts`, `tabs.spec.ts` | `[data-testid="data-grid"]` visibility only | **ported** (0 changes — the host already carries that testid) |
| `scroll-trace.spec.ts` (154) | `__kiraScrollTrace` | **ported** (1 selector). D15 keeps `registerGrid`'s signature |
| `slick-grid.spec.ts` (825) | Pass A's + iter2's own gates | **kept and extended, never rewritten.** Its four existing tests — the eight §7.4(a) criteria, the pacing invariant, the teardown-with-armed-chase test, and the iter2-onset runway test — **must keep passing at every commit in this pass**. §9.2 adds T5-T9 to it |
| every other `tests/ui/` spec | no grid surface | **untouched** |

**`tests/unit/` — fates:**

| spec | fate |
|---|---|
| `row-range.spec.ts` | **kept, unchanged.** It covers `rowRangeBounds`, which `kiraSlickGrid.ts` still calls. The thin `rowRangeExtractor` wrapper it also exercises is deleted in stage 3, so its import narrows by one symbol — the assertions do not change |
| `column-range.spec.ts` | **kept, unchanged.** `columnRangeExtractor` still serves `ConsoleResultGrid.vue` (§6) |
| `column-widths-cache.spec.ts` | **kept, unchanged.** `initialWidths`' memoisation still serves both grids |
| `kira-slick-grid.spec.ts` | **kept, unchanged.** `clampColumnOverscan` is untouched by this pass |
| `slick-data-source.spec.ts` | **kept and extended.** D1 adds the insert-region `values` and the `rowColumns` metadata path; D4 adds `displayPositionOf`/`rowAtDisplayPosition` moving into this module — display ↔ page translation across a filter is exactly AGENTS.md's *"cursor/pagination arithmetic with real boundary cases"* bar |
| `match-index.spec.ts` | **kept, unchanged.** `createMatchIndex` is D12's content source |
| `page-store-cell-cache.spec.ts` | **kept, unchanged.** It names `DataGrid.vue` in a comment; the comment updates |
| **`row-sig.spec.ts`** | **retired, in the same commit that deletes `rowVm.ts`.** It tests `sameRowSig`, the memo key for `renderRows`' reference-stable `RowVM` reuse — an optimisation for Vue's `shouldUpdateComponent` bail-out that has no counterpart once there is no per-row Vue component. It is testing an implementation detail that ceases to exist; there is no behaviour underneath it to re-home. **Retired with the reason, not silently deleted** |
| **new: `slick-selection.spec.ts`** | **added.** `selectionFromRanges`/`rangesFromSelection` — four kinds, the ±1 gutter offset, the display↔page row translation, the empty case, the row-mode union. Interacting rules over index arithmetic; earns its keep by AGENTS.md's bar |

**No behavioural coverage is lost anywhere.** The only two removals are `row-sig.spec.ts` (an
implementation detail that stops existing) and two `data-null` attribute assertions (rewritten as
class assertions in the same file).

---

## 8. Bundle — real numbers, measured this session

**Method.** `bun run build` (Vite 8.2.2 / Rolldown) on this tree, with the file under test
temporarily removed or added and the tree restored afterward (`git status` clean at `dd0e062`
before and after). Isolated import-set figures by `esbuild@0.28.2 --bundle --minify --format=esm` +
`gzip -9`, Pass A F9's method.

**Whole-app builds:**

| build | `index-*.js` raw | gzip | `index-*.css` raw | gzip |
|---|---:|---:|---:|---:|
| pre-SlickGrid baseline (P21 `62c7e84`, `docs/PERF.md` §2.12) | 1 115 990 | **351.31 KB** | 120 067 | **21.77 KB** |
| **today, `dd0e062`** (both grids in the graph) | 1 302 300 | **398.47 KB** | 126 180 | **22.95 KB** |
| incumbent deleted (`DataGrid.vue` + `GridRow.vue` + `rowVm.ts`), tanstack kept for the console | 1 269 990 | **387.89 KB** | 120 960 | **22.22 KB** |
| incumbent deleted **+** `SlickHybridSelectionModel` + an editor | 1 294 790 | **393.69 KB** | 120 960 | **22.22 KB** |

**The three deltas that matter:**

- **Deleting the incumbent recovers −10.58 KB gzip of JS and −0.73 KB gzip of CSS** (−32.3 KB raw
  JS, −5.2 KB raw CSS). The CSS is `GridRow.vue`'s unscoped block plus `DataGrid.vue`'s scoped one.
- **The Pass-B plugins cost +5.80 KB gzip** (+24.8 KB raw). Measured with `SlickHybridSelectionModel`
  and the stock `TextEditor`; the real `KiraCellEditor` (§5 D8) replaces `TextEditor`'s ~140 B gzip
  with roughly the same amount of app code, so this figure is accurate to within noise.
- **Net for Pass B: −4.78 KB gzip JS, −0.73 KB gzip CSS = −5.51 KB gzip.** Pass B ships *smaller*
  than the tree it starts from.
- **Net for the whole migration vs. the pre-SlickGrid baseline: +42.38 KB gzip JS, +0.45 KB gzip
  CSS = +42.83 KB gzip** — **inside Pass A §7.4(a) item 7's own ≤ 45 000 B budget**, which was set
  before the deletion was priced.

**Isolated import sets** (esbuild + `gzip -9`, reproducing and extending Pass A F9):

| import set | raw | gzip | Δ vs. core |
|---|---:|---:|---:|
| `{ SlickGrid, SlickEventHandler }` — Pass A's set | 172 987 | 41 947 | — |
| `+ SlickCellSelectionModel` | 189 324 | 45 957 | +4 010 |
| `+ SlickHybridSelectionModel` — **Pass B's set** | 196 044 | 47 565 | **+5 618** |
| `+ SlickHybridSelectionModel + TextEditor` | 197 762 | 47 705 | +5 758 |
| `+ SlickHybridSelectionModel + SlickContextMenu` | 208 285 | 50 515 | +8 568 |
| `+ SlickHybridSelectionModel + SlickCellExternalCopyManager` | 203 983 | 49 849 | +7 902 |
| all four plugins | 216 225 | 52 848 | +10 901 |
| `sortablejs@1.15.7` alone (header reorder, §3) | 37 180 | **12 905** | — |
| `@tanstack/vue-virtual@3.13.36` alone, `vue` external (§6) | 22 741 | 6 911 | — |

Two readings: **the hybrid selection model costs 1 608 B gzip more than the cell-only one and buys
back ~270 lines of `DataGrid.vue`**; and **the two declined plugins would have cost 5 234 B gzip
between them** for capabilities §3 shows they cannot actually provide here.

`slick.grid.css` stays the only SlickGrid stylesheet imported (4 355 B raw / 1 252 B gzip); neither
theme sheet is added.

---

## 9. Implementation order

Eighteen commits in three stages. Every commit ends on a green tree:
`bun run typecheck && bun run lint && bun run build && bun test apps/kira-studio/tests/unit`, plus
the full `tests/ui/` suite **on both engines** (`bun run test:ui` and
`KIRA_GRID_ENGINE=slick bun run test:ui`) from C1 onward.

### Stage 1 — parity, with the incumbent still the default (C1-C14)

**C1 — `test(ui): engine-agnostic grid locators, and the SlickGrid data-* surface`**
§5 D10 + §7.2. `cellAttrs`/`headerCellAttrs` on every column; the `onRendered` row pass;
`tests/ui/support/grid.ts` and the `KIRA_GRID_ENGINE` fixture switch; every grid-touching spec's
local helpers replaced by imports. **Behaviour-neutral for the incumbent by construction** — the
tanstack run must pass unmodified in substance, which is the proof the helper extraction is faithful.
Nothing else in this stage is reachable without it.

**C2 — `feat(grid): header parity — sort, PK/FK badge, tooltip, resize, select zone, select all`**
§4 items 6-11, §5 D2/D3/D14. `sortable: true`, `tristateMultiColumnSort`, `numberedMultiColumnSort` +
`sortColNumberInSeparateSpan`, `onSort` → `setSort`, `setSortColumns` mirror from `sortTerms`;
`onHeaderCellRendered` for the PK/FK badge span and the 10 px select zone (+ `onBeforeHeaderCellDestroy`
cleanup); `resizable`/`minWidth: 40`/`onColumnsResized` + D3's echo guard; the gutter header's
select-all; `data-kira-tip-parts`. The retokenised sort/resize CSS.

**C3 — `feat(grid): cell navigation, and the app's own shortcuts on grid.onKeyDown`**
§4 item 21, §2 F6. `enableCellNavigation: true`; `grid.onKeyDown` subscription running Ctrl/Cmd+C,
Ctrl/Cmd+V and `runMenuShortcut(rowMenu(…))` first and stopping propagation; `DataGrid.vue`'s arrow
block **not** ported (F-header item 4). Copy/paste bodies land in C7; this commit wires the key
routing and the row shortcuts only.

**C4 — `feat(grid): selection via SlickHybridSelectionModel`**
§5 D4. `views/grid/slick/selection.ts` + `tests/unit/slick-selection.spec.ts`;
`grid.setSelectionModel(...)`; `onSelectedRangesChanged` → `rt().selection`; the header select
zone's `pendingKind` push; `displayPositionOf`/`rowAtDisplayPosition` moved into `dataSource.ts`.
**The largest single deletion**: `DataGrid.vue`'s drag/auto-scroll state machine has no counterpart
here — but `DataGrid.vue` itself is not touched until stage 3, so this commit only *adds*.

**C5 — `feat(grid): the selection, search and staged cell-class layers`**
§5 D5. `kira-cell-selected` via `selectedCellCssClass`; the perimeter layer (perimeter-only,
clipped to the rendered range) built through `theme/cellClass.ts`; `kira-staged`; the `--sel-*` CSS
moved from `GridRow.vue` into `slickTheme.css`. Pass A's `applyStaticCssLayers` demo is deleted here.

**C6 — `feat(grid): select-all, and its cost gate`**
§5 D6, its own commit specifically so F2's price is bisectable. Lands T6.

**C7 — `feat(grid): the three context menus and the clipboard, on SlickGrid's own events`**
§5 D7. `views/grid/slick/rowValues.ts` (extracted content: `displayCell`, `rowSnapshot`,
`columnValuesFor`, `rowsForColumnOps`, `navColumns`, `navValuesFor`, `cellNavEntry`);
`onContextMenu`/`onHeaderContextMenu` handlers; `onCopy`/`onPaste` bodies moved verbatim.
`menu.ts` and `clipboardFormats.ts` are **not modified** — a diff that touches either is a sign the
mechanism/content line moved.

**C8 — `feat(grid): inline cell editing`**
§5 D8. `views/grid/slick/editor.ts`; `editable`/`autoEdit`/`autoCommitEdit`; the `onBeforeEditCell`
veto with its five predicates; the `.slick-cell.editable` retokenisation and its
fit-inside-the-cell comment.

**C9 — `feat(grid): pending insert rows, with their own inputs`**
§5 D9. The formatter's insert branch, the delegated `input`/`keydown` listeners, `rowColumns`
metadata, the never-invalidate-a-focused-insert-row rule. Lands T8 (the pacing re-check) **in this
same commit**, because it is the gate on the one place this pass returns DOM from a formatter.

**C10 — `feat(grid): row rails, pending-delete, and the inserted gutter`**
§4 item 18, §5 D1. `pendingRowClasses`' third case; `.kira-row-inserted`; the strike-through/opacity
`pending-delete` rule; the pending-changes watch's `invalidateRows` set.

**C11 — `feat(grid): the PK/FK nav affordance, moved to the left of the cell`**
§5 D11 — **the user's item 3.** The single host-owned button, its hover/active placement, its click
handling, `.has-nav`'s `padding-left` reserve, `.cell-nav-btn { left: 4px }`. Its own commit because
it is the one visually-noticeable deliberate change in the pass.

**C12 — `feat(grid): live search filtering, highlighting and go-to-match`**
§5 D12. The `matchedRows` watch, the `kira-search` layer, the real `scrollCellIntoView` translation
replacing Pass A's identity pass-through.

**C13 — `feat(grid): empty states, density, appearance and scroll persistence`**
§5 D13 + §4 items 29/31. The overlaid `EmptyState`s; the `rowHeight`/`appearanceVersion` watches
extended to re-measure; the scroll-restore path exercised by `tabs.spec.ts`.

**C14 — `test(ui): the whole suite, green on the SlickGrid engine`**
Whatever C1's helper extraction did not already cover: the two `data-null` → `.cell-null` rewrites,
the paste-origin assertion (§4.1 item 1), `budgets.spec.ts`/`perf.spec.ts`'s scroll-target
arguments. **Exit condition for stage 1: `KIRA_GRID_ENGINE=slick bun run test:ui` is fully green at
unchanged thresholds, and the default run is still fully green too.**

### Stage 2 — the cutover (C15-C16)

**C15 — `feat(grid)!: SlickGrid is the default data grid`**
One line: `__kiraGridEngine === 'tanstack' ? 'tanstack' : 'slick'`. The flag still selects the
incumbent, so this commit is revertible on its own and the incumbent's own coverage still runs
(`KIRA_GRID_ENGINE=tanstack`).

**C16 — `test(ui): the budget and perf gates on the SlickGrid DOM`**
`budgets.spec.ts`'s scroll response (p50 ≤ 12 ms / max ≤ 50 ms), both overscan-coverage invariants,
both DOM-cell bounds (< 2 500 / < 1 500), `perf.spec.ts`'s rAF p95 and retained bytes, and
`leaks.spec.ts`'s symmetry — all re-pointed at the default engine at **their existing thresholds.
No threshold is loosened.** If one fails, this commit does not land and the failure is a Pass-B bug,
not a budget to renegotiate.

### Stage 3 — deletion (C17-C18)

**C17 — `refactor(grid)!: delete DataGrid.vue, GridRow.vue and rowVm.ts`**
2 589 lines plus `tests/unit/row-sig.spec.ts`. Also removed in this commit: `__kiraGridEngine`
(source, `main.ts`, `tests/ui/global.d.ts`, `tests/ui/fixtures.ts`, `tests/ui/support/grid.ts`'s
`ENGINE` branch, `slick-grid.spec.ts`'s `forceSlickEngine`), `__kiraGridRowUpdates`,
`__kiraGridTuning.incrementalRows`, `columns.ts`'s `rowRangeExtractor` wrapper (`rowRangeBounds`
stays), and `.data-grid`'s `data-pagination`. `@tanstack/vue-virtual` **stays** (§6).

**C18 — `docs: the SlickGrid cutover`**
§10, in one commit so the doc state and the code state land together.

### 9.1 Why this order, and not another

- **C1 first** because nothing downstream is testable on the SlickGrid engine without the locator
  surface, and because it is the only commit in the pass that is behaviour-neutral by construction —
  the ideal first step when the tanstack run is the regression guard for the extraction itself.
- **C4 before C5-C8** because selection is the input to the CSS layers, the menus' "replace the
  selection first" rule, the clipboard's kind branch and the editor's target.
- **C6 alone** because F2 is the one adopted mechanism with a measurable price, and it must be
  bisectable from everything around it.
- **C9 and C11 alone** because each is the single commit in its area that adds DOM on a hot-ish path
  (C9) or changes something the user will see immediately (C11).
- **C15 before C16** so that if a budget fails on the new DOM, `git bisect` lands on the flip, not on
  a spec change.
- **C17 last** because it is the only irreversible-in-spirit commit, and because every stage-1 and
  stage-2 commit before it keeps the incumbent green — which is the whole reason the incumbent is
  allowed to stay in the tree for seventeen commits.

### 9.2 Sandbox-provable gates

`slick-grid.spec.ts` keeps its four existing tests (Pass A's eight §7.4(a) criteria, the pacing
invariant, the armed-chase teardown, the iter2-onset runway test) **passing unchanged at every
commit**. It gains:

- **T5 (C4/C5)** — a cell drag across three rows produces one range, `rt().selection` is
  `{ kind: 'range' }` with normalised corners, exactly three cells carry `kira-cell-selected`, and
  the perimeter layer marks exactly the perimeter (no interior `sel-*` class).
- **T6 (C6)** — select-all on `spike_grid` (1 000 × 61) and on a 10 000-row fixture completes within
  **150 ms** from click to `onSelectedRangesChanged`. Fails → §5 D6's bypass lands in the same commit.
- **T7 (C12)** — the F5 merge cost: with a 10 000-match search active, a selection change must not
  exceed the same 150 ms bound. Fails → D5's hysteresis-band fallback lands in the same commit.
  **This is Pass A §8.6 item 2, discharged with a measurement instead of an argument.**
- **T8 (C9)** — with N staged insert rows on screen, the pacing invariant still holds:
  `renderCountHistogram` all-1 during a wheel fling and `renderMs` p95 within the pre-C9 reading on
  the same fixture. **The gate on the one formatter-returns-DOM exception.**
- **T9 (C11)** — exactly one `[data-testid="cell-nav-button"]` exists in the document at any time;
  it sits within the left 24 px of its cell; it is absent for a non-nav cell and for a composite FK
  whose source is NULL.
- **T10 (C17)** — the teardown assertion re-run after the flag is gone: five open/close cycles leave
  zero `.slick-viewport`, no extra SlickGrid `<style>` element, and `__kiraRetention()` /
  `__kiraRetainedBytes()` back at their pre-open values.

Plus, at C16, `budgets.spec.ts` / `perf.spec.ts` / `leaks.spec.ts` at unchanged thresholds, and at
every commit `bun run typecheck && bun run lint && bun run build && bun test apps/kira-studio/tests/unit`.

### 9.3 Real-Mac obligation — narrow, and named

The scroll mechanism is verified good (`-iter2-pacing` §11.4). Pass B's obligation is **not** to
re-run that verification but to confirm it survived parity. One run, after C14 and before C15,
against `docs/PERF.md` §2.1c's existing protocol, on a table with **an FK column, a staged edit, a
staged insert row and an active search** — i.e. every Pass-B feature simultaneously live:

Report `summary.frameMs` `{mean, stddev, p50, p95, max}`, `summary.renderCountHistogram`,
`summary.renderMs`, `summary.uncoveredPx`, `summary.staleVelocityFrames`, and one sentence on whether
the motion felt different from the pre-Pass-B build.

**PASS** = `renderCountHistogram` still ~all-1 during the fling, `frameMs.stddev` and `renderMs` p95
within noise of the pre-Pass-B reading, and no perceptual change. **FAIL** = any of those moved, in
which case the two suspects are named in advance and in order: the `kira-search`/perimeter layer
rebuild per render (D5's fallback) and the insert-row formatter DOM (D9's rule 2). Nothing else in
this pass touches the per-frame path.

---

## 10. Docs

- **`docs/ARCHITECTURE.md`** — three edits.
  1. The Stack table row at `:40` currently reads *"Data grid rendering (P22 spike, Pass A only)"*
     and says the production grid stays `DataGrid.vue`/`@tanstack/vue-virtual`. Rewrite it: SlickGrid
     is the data grid; the imports are `SlickGrid`, `SlickEventHandler` and
     `SlickHybridSelectionModel` and nothing else; `SlickDataView`, `SlickContextMenu`,
     `SlickCellExternalCopyManager` and `sortablejs` are declined with §3's one-line reasons and
     §8's real numbers; `@tanstack/vue-virtual` remains for `ConsoleResultGrid.vue` only.
  2. `:657` — *"decided by exactly one function (`DataGrid.vue`'s `colorForColumn`)"*. That file is
     gone; the sentence points at `SlickGridHost.vue`'s `buildColumns` and says the mechanism is now
     a per-column CSS class, not a per-cell inline style.
  3. A short paragraph in the same section on the **mechanism/content line** (§1) — that the app
     deliberately owns menu content, clipboard formats and the staged-mutation pipeline while
     SlickGrid owns every DOM interaction, and that a future plugin adoption is measured against
     that line. This is an app-level design fact, which is what that file is for.
- **`docs/PERF.md`** — three edits.
  1. §2.1c is written as *"the SlickGrid A/B, and how to run it on real hardware"* against
     `__kiraGridEngine` and an incumbent to A/B against. Rewrite its framing: the A/B is done, the
     flag is gone, and the protocol survives as **the** grid fling protocol (the `__kiraGridTuning`
     dials it depends on all survive — §5 D15). Its "the result of this A/B is not yet known"
     paragraph is replaced by the recorded verdict.
  2. Add §9.3's Pass-B parity reading beside it, with its own PASS/FAIL criteria.
  3. A new `### 2.13 P22 Pass B — bundle after the cutover` carrying §8's four whole-app rows and
     the two headline deltas, in the same shape §2.12 uses.
- **`docs/v1.1/SPEC.md`** — the P22 row (`:37`) describes the phase as two problems (rendering lag,
  memory churn) and predicts the work will land *"likely in the virtualizer's overscan/windowing
  behavior"*. Append one sentence recording what it actually became: a full renderer migration onto
  SlickGrid, delivered as Pass A (spike) → three scroll-performance iterations → Pass B (parity,
  cutover, deletion of the incumbent), with the plan files named. The table is the phase index, so it
  should say where P22 ended up.
- **`AGENTS.md`** — **no change, deliberately.** Its "Known open items" list is `None.` and its own
  rule is that a one-off result from finishing a phase *"goes elsewhere or nowhere."* The two things
  a reader might want carried forward — the deferred console grid and §9.3's real-Mac reading — are
  plan-doc and `docs/PERF.md` items respectively, exactly where that rule sends them. Adding either
  here would be the drift the file explicitly warns against.
- **This file** — §9.3's reading and T6/T7's outcomes get written back into it once known, the same
  way `-iter2-pacing` §11 was appended after its own commits landed.

---

## 11. Acceptance checklist

1. `views/grid/DataGrid.vue`, `views/grid/GridRow.vue`, `views/grid/rowVm.ts` and
   `tests/unit/row-sig.spec.ts` do not exist. `window.__kiraGridEngine` appears nowhere in the tree.
2. The **only** `slickgrid` named imports anywhere are `SlickGrid`, `SlickEventHandler` and
   `SlickHybridSelectionModel` (plus types). No `SlickDataView`, no `SlickContextMenu`, no
   `SlickCellExternalCopyManager`, no `import * as`, no `sortablejs`.
3. `menu.ts`, `clipboardFormats.ts`, `pendingChanges.ts`, `theme/cellClass.ts`,
   `state/contextMenu.ts` and `state/cellSelection.ts` are **unmodified** by this pass. A diff
   touching any of them is a mechanism/content line violation and must be justified in the commit
   message.
4. `DataGrid.vue`'s own DOM-event glue is gone, not re-homed: no `closest()` on a grid event target
   anywhere in `views/grid/slick/` except the nav button's own hit test (§5 D11) and D9's delegated
   insert-input listeners; no `document.elementFromPoint`; no rAF auto-scroll loop; no
   `mousedown`/`mouseover`/`mouseup` drag state machine.
5. The FK/PK nav button is **on the left** of the cell, there is exactly **one** of them in the
   document at any time, and `.slick-cell.has-nav` reserves its space with `padding-left`.
6. `enableColumnReorder: false`, `enableHtmlRendering: false`, `autosizeColsMode: 'LegacyOff'`,
   `enableMouseWheelScrollHandler: false`, `autoEdit: false`, `autoCommitEdit: true`,
   `tristateMultiColumnSort: true`, `multiColumnSort: false`, `showDragHandle: false`,
   `enableMultiSelection: false` — each with a one-line comment naming the finding it answers.
7. No `ref`/`shallowRef`/`reactive` holds the grid, the selection model, the editor, a `RowHandle`,
   a `CellView`, a `SlickRange` or a grid-owned DOM node. No imperative grid call is made from inside
   a `computed` (§5 D0).
8. `KiraSlickGrid.getRenderedRange`, `scheduleChase`, `countNewRows`, `clampColumnOverscan`, the
   velocity sampler and `slickTheme.css`'s `contain: layout` on `.slick-row` are **unchanged**,
   except for the two comments §5 D8 and §5 D9 add.
9. `slick-grid.spec.ts`'s four pre-existing tests pass unchanged at every commit; T5-T10 pass; the
   whole `tests/ui/` and `tests/unit/` suite passes; **no budget threshold is loosened**.
10. `ConsoleResultGrid.vue` is unmodified and still renders correctly with `GridRow.vue` gone
    (§6 reason 6 — its `<style scoped>` block owns its own classes).
11. The measured `bun run build` delta is recorded in `docs/PERF.md` §2.13 and in C17's commit
    message as a real number.
12. No colour, spacing or radius literal in `slickTheme.css`; neither SlickGrid theme sheet imported.
13. **Nothing in this pass claims a performance improvement.** Pass B's claim is: one grid, at
    parity, smaller than the two it replaces, with the verified-good scroll behaviour intact.

---

## 12. Open questions, handed forward

- **F2's O(area) selection hash is a property of SlickGrid, not of this app's use of it.** §5 D6
  gates and bounds it; if a future page size grows past 10 000 rows, the gate is the thing that will
  notice, and the bypass is the thing that will answer. A version bump should re-read
  `handleSelectedRangesChanged` before assuming the cost is unchanged.
- **`SlickHybridSelectionModel` is the newest and least-exercised of the plugins adopted here.** It
  is the only one whose behaviour this pass depends on for a *core* interaction (drag-select). Its
  own `handleCellRangeSelected` distinguishes `onCellRangeSelecting` from `onCellRangeSelected` in
  cell mode but not in row mode (`src/plugins/slick.hybridselectionmodel.ts:648-673`), which is why
  §4.1 item 3's deletion of `cellDragActive` is safe for cell drags and irrelevant for row drags —
  a version bump must re-check that asymmetry.
- **`enableMultiSelection: false` is a parity choice, not a limitation.** Turning it on gives
  disjoint cell selection for free, but `Selection` has no shape for it — that would need a fifth
  kind and a decision from every consumer (copy format, menus, Delete). Written down as the cheapest
  future feature in the grid, not as a defect.
- **The `data-row` asymmetry survives** (display position from SlickGrid, page row after D10's
  pass). If that pass is ever dropped, the specs silently start asserting on the wrong index. It is
  commented at both ends and it is the single remaining trap in the DOM surface.
- **`@tanstack/vue-virtual` has one runtime consumer after this pass.** §6's reopen trigger prices
  it at 6 911 B gzip. That is not a reason to migrate the console; it is the number the decision
  should be made against when there *is* a reason.
- **`docs/PERF.md`'s Chromium-derived scroll/rAF ordering claim at `:98-102` is still unverified
  against real WebKit** — carried forward unchanged from `-iter2-pacing` §10. Nothing in this pass
  depends on it, and nothing in this pass answers it.
- **The general lesson, fourth time in this phase.** Pass A's §8 was a careful design written from
  `dist/esm/index.js` and a reasonable reading of the plugin *names*. It missed a plugin that exists
  (F1), assumed a per-cell cost that does not (F3), flagged a behaviour regression that is avoidable
  (§5 D9), and did not see a real cost that is (F2). Every one of those was found the same way: by
  opening `src/` and reading the file, not the export list. **Find the call site, not the
  description.**

---

## 13. Sources

**Library source, read in this session** at
`node_modules/.bun/slickgrid@5.20.0/node_modules/slickgrid/src/`, cited by file and line:
`slick.grid.ts` (the option defaults at `:258-320`, `_columnDefaults` at `:346-358`, event
construction at `:611-660`, listener binding at `:945-991`, `createDraggable` at `:1000-1020`,
`setSelectionModel` at `:1509-1527`, `setupColumnSort` at `:1738-1832`, header build at
`:1895-1970`, `setSortColumns` at `:3477-3520`, `getEditor` at `:3778-3790`,
`isCellPotentiallyEditable` at `:3922-3936`, `makeActiveCellEditable` at `:4004-4070`,
`commitCurrentEdit` at `:4108-4160`, `getDragHandleVisibility` at `:4276`,
`handleSelectedRangesChanged` at `:4288-4364`, `handleKeyDown` at `:4485-4580`, `handleClick` at
`:4592-4628`, `handleContextMenu` at `:4634-4646`, `handleDblClick` at `:4652-4666`,
`handleHeaderContextMenu` at `:4729-4735`, `handleHeaderClick` at `:4741-4750`,
`handleCellMouseOver` at `:4785-4790`, `getCellFromEvent` at `:4865-4895`, `appendRowHtml` at
`:5700-5790`, `appendCellHtml` at `:5800-5890`, `canCellBeActive` at `:9355-9386`,
`canCellBeSelected` at `:9393-9414`); `plugins/slick.hybridselectionmodel.ts` (full);
`plugins/slick.cellselectionmodel.ts` (full); `plugins/slick.cellrangeselector.ts` (full);
`plugins/slick.cellrangedecorator.ts` (full); `plugins/slick.cellexternalcopymanager.ts` (`:73-232`,
`:380-500`); `plugins/slick.contextmenu.ts` (`:184-460`, `:588-760`); `slick.editors.ts` (`:14-105`);
`slick.core.ts` (`SlickRange`, `SlickDragExtendHandle` at `:403-431`);
`models/column.interface.ts`; `models/editor.interface.ts`;
`models/selectionModelOption.interface.ts`; `dist/styles/css/slick.grid.css`.

**Measured in this session**: four full `bun run build` runs on this tree (tree restored to a clean
`dd0e062` afterward, verified with `git status`); `esbuild@0.28.2 --bundle --minify --format=esm` +
`gzip -9` over nine per-import-set entry files.

**In-repo, read in full for §1, §4, §5 and §7**: `views/grid/DataGrid.vue`, `views/grid/GridRow.vue`,
`views/grid/DataView.vue`, `views/grid/SlickGridHost.vue`, `views/grid/slick/dataSource.ts`,
`views/grid/slick/kiraSlickGrid.ts`, `views/grid/slick/slickTheme.css`, `views/grid/menu.ts`,
`views/grid/clipboardFormats.ts`, `views/grid/pendingChanges.ts`, `views/grid/state.ts`,
`views/grid/search.ts`, `views/grid/scrollTrace.ts`, `views/shared/page/columns.ts`,
`views/shared/page/search.ts`, `views/console/ConsoleResultGrid.vue`, `theme/cellClass.ts`,
`state/contextMenu.ts`, `state/cellSelection.ts`, `clipboard.ts`, `tests/ui/support/measure.ts`,
`tests/ui/slick-grid.spec.ts`, `tests/ui/interaction.spec.ts`, `tests/ui/budgets.spec.ts`,
`tests/ui/perf.spec.ts`, `tests/ui/row-coloring.spec.ts`, and the headers of every
`tests/unit/*.spec.ts` this pass touches.

**Prior plans, cited throughout**: `docs/v1.1/plans/P22-slickgrid-migration-plan.md`,
`docs/v1.1/plans/P22-slickgrid-migration-plan-iter2-scroll-gaps.md`,
`docs/v1.1/plans/P22-slickgrid-migration-plan-iter2-pacing.md` (including its §11 onset postscript),
`docs/v1.1/plans/P22-grid-library-survey.md`, `docs/v1.1/plans/P22-grid-library-evaluation.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md`,
`docs/v1.1/plans/P5-ram-usage.md`, `docs/ARCHITECTURE.md`, `docs/PERF.md`,
`docs/WEBVIEW-SCROLL-MEMORY.md`, `docs/v1.1/SPEC.md`, `AGENTS.md`.
