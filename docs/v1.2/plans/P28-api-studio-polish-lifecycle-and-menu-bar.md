# P28 — Seventh user-driven batch: Api/Studio polish, floating-surface hardening, the menu bar, and the window's webview process

Twenty concrete items reported from real use of the two shipped modules — **Studio** (SQL data view,
query console, Mongo documents) and **Api** (request/response, environments, variables) — plus one
process-lifecycle defect on the Go/Wails side. This is not a feature phase: nothing here adds a
capability the chapter's spec did not already promise. It is the same shape as P16/P17/P18/P19/P22
— a mixed batch of reported defects and UX corrections, grouped by theme rather than by surface.

## 0. What this phase is, and what it is not

### 0.1 Where this plan lives, and why

`AGENTS.md` gives each phase in `docs/v1.2/SPEC.md`'s phasing table its own Opus-authored plan under
`docs/v1.2/plans/` before implementation starts. This batch is not part of the v1.3 git chapter: every
item lands in Studio or Api code that predates it (`views/grid/`, `views/console/`,
`views/documents/`, `views/httprequest/`, `api/`, `packages/api-core/`, `theme/`), plus one fix in
`internal/shell/`. The v1.2 table already numbers seven such user-driven batches (P15, P15b, P16,
P17, P18, P19, P22/P22b/P22c) and ends at P27, so this is **P28**, with a matching row added to
`docs/v1.2/SPEC.md`'s phasing table. It is deliberately *not* filed as a "code review" round:
`AGENTS.md` reserves that name for the three-parallel-Opus-agents process, and these items came from
a person using the app, not from a review pass.

### 0.2 Ground rules

- **Root cause first.** Every item below was checked against the real source. Where the code already
  does what the report asks (items 2 and 10 in part, item 3), the finding says so plainly and names
  the surface that actually lacks it, rather than inventing a change to look busy.
- **Several of these items reverse an earlier deliberate decision** (items 1, 6, 7, 15, 16d). Each
  such reversal names the commit or plan decision it undoes, so the next reader does not "fix" it
  back. A reversal is not evidence the earlier decision was wrong — it is a later user preference.
- **No item is allowed to grow into a feature.** Item 11 (search in the request panel) and item 16c
  (environment management as a tab) are the two with real structural weight; both are scoped in D11
  and D16c to reuse machinery that already exists rather than build a parallel one.
- Tests only where `AGENTS.md`'s bar is genuinely met — see D19.

### 0.3 Not in this phase

- The document view's and key-value view's own pager placement (item 7 is scoped to the SQL data
  view, which is the only view the offending commit touched — see F7).
- Any change to `@codemirror/search` adoption; item 11 extends the existing `ResponseFindBar`
  (P16 D11's own deliberate non-adoption of that package stands).
- Verifying item 20 on macOS. The Go/Wails half is implemented and reasoned about here; the
  Activity-Monitor observation itself needs a Mac and a packaged build (§5.3).

---

## 1. Findings

### F1 — The HTTP status hint is rendered as a permanent line, by an explicit earlier decision

`views/httprequest/ResponsePane.vue:138-141` computes `hint` from `statusHint(...)` and line 318
renders it as `<div v-if="hint" class="p-sm muted status-hint">`. Its own comment says so: *"D11: the
hint is always shown inline, not tooltip-only — the case that matters (4xx/5xx)…"*. Every **other**
consumer of `statusHint` in the app already uses it as a tooltip on the chip — `ResponseHistoryList.vue:174`,
`ResponseDiffDialog.vue:220,238`, `TimelinePane.vue:242` all bind `v-tooltip="statusHint(...)"`.

`views/grpcrequest/ResponsePane.vue:117,276` carries the identical always-visible line for the gRPC
status code (P18 D13), for the same reason.

So the inline line is the odd one out in its own module, not the norm — item 1 makes the two response
panes match the four surfaces that already do what the user is asking for.

### F2 — The live drag highlight exists in the SQL data view and does not exist in the console

The report names both grids. Only one of them is missing it.

`views/grid/SlickGridHost.vue` subscribes the cell-range selector's in-progress event and paints
from it:

```
1865  const cellRangeSelector = selectionModel.getCellRangeSelector();
1866  if (cellRangeSelector) {
1867    eventHandler.subscribe(cellRangeSelector.onCellRangeSelecting, onCellRangeSelecting);
```

`onCellRangeSelecting` (line 788) recomputes the perimeter layer and writes the fill layer under the
same `'kira-cell-selected'` key SlickGrid itself uses at commit, so a cell-range drag paints live.

`views/console/ConsoleSlickGrid.vue`'s `onMounted` (lines 728-736) subscribes six events and **never
calls `getCellRangeSelector()` at all**. It has no `onCellRangeSelecting` handler and no fill-hash
builder. `SlickHybridSelectionModel.handleCellRangeSelected` returns early for
`caller === 'onCellRangeSelecting'` (verified in `node_modules/slickgrid/dist/esm/index.js`), and
`dragToSelect: true` zeroes the stock decorator's border — so in the console nothing at all is
painted between mousedown and mouseup, which is exactly the reported symptom.

**Conclusion:** the fix is porting the data view's already-working mechanism into the console grid,
not re-fixing the data view. Stated as a deviation from the report's literal wording in D2.

### F3 — Right-click *does* already select the column, in both grids

`SlickGridHost.vue:1550-1560` (`onHeaderContextMenuHandler`) sets `pendingSelectionKind = 'column'`
and pushes `rangesFromSelection({kind:'column', cols:[displayCol]}, …)` **before** opening the menu.
`ConsoleSlickGrid.vue:571-585` (`onGridHeaderContextMenu`) does the identical thing. Both are reached
from `grid.onHeaderContextMenu`, which both files subscribe.

`slickTheme.css:697-707` records that this was checked once already: *"item 9's 'right-click also
selects the column' was already true (`onHeaderContextMenuHandler` already pushes a column selection
before opening the menu)"*.

What is **not** true is that the selection stays visible. Both handlers push the ranges and then call
`openContextMenu(...)`, and `workbench/ContextMenu.vue:132-133,197` installs a **capture-phase**
`document` `mousedown` listener that closes the menu when the press lands outside it. The press that
opens a context menu is `mousedown` (button 2) → `contextmenu`; the listener is added on *mount*, so
it is live for every subsequent press. The next left-click anywhere — including the click that picks
a menu item's neighbour, or a click on the grid to dismiss — lands on the grid and moves the active
cell, which `SlickHybridSelectionModel.handleActiveCellChange` turns into a fresh single-cell
selection, discarding the column selection the right-click had made. See F8: this is the same
mechanism.

**Conclusion:** the column selection is made and is then immediately replaceable. The user-visible
fix is the same one item 8 needs — a right-click must not let the subsequent interaction silently
collapse the selection it just established — plus making the column selection actually *paint*
under the open menu. Covered by D3/D8 together.

### F4 — The sort control is already at the header's right edge; what it costs is the flex chrome around it

`slickTheme.css:575-612`: `.slick-sort-indicator` is `order: 2; margin-left: auto; width: 14px`, so it
already sits last. But `.slick-header-column` is a flex row with `gap: var(--kira-s-2)` (4px) and
`padding: 0 var(--kira-s-4)`, and there are **two** elements after the name:
`.slick-sort-indicator` and the always-present `.slick-sort-indicator-numbered` (line 645, `width: 0`
at rest but still a flex child, so it still takes a preceding 4px gap). Sorted, the indicator adds
`margin-left: var(--kira-s-2)` on top (line 627-628).

Total reserved right-side chrome at rest: 4 (gap) + 14 (indicator) + 4 (gap) + 0 + 8 (padding-right)
= **30px**, of which only 14px is the control. `views/shared/page/columns.ts`'s `HeaderChrome.sortControl`
hard-codes `22` for this, and `SlickGridHost.vue:452` feeds it into every column's `minWidth`.

### F5 — The column floor is 64px, and 64px is genuinely narrow once the header chrome is subtracted

`views/shared/page/columns.ts:11` `MIN_WIDTH = 64`, applied in two places: `measuredWidths` (line 139)
clamps every *measured* width to it, and `headerAwareMinWidth` (line 88-97) uses it as the lower
bound of the per-column `minWidth`/initial `width` (`SlickGridHost.vue:447-455`).

A column whose values are all short ("id", "qty", a boolean) measures below the floor and lands at
exactly 64px. Subtract F4's 30px of header chrome and 20px of `CELL_PADDING` and the visible text
column is very narrow indeed — which matches the report. `DEFAULT_COLUMN_WIDTH` is already `96`
(line 28), i.e. the file's own answer to "no information at all" is 50% wider than its answer to
"short values".

Note the floor is doing two different jobs at once today: it is the **resize** floor (what a drag may
not go below) *and* the **initial** width floor. Those want different numbers — D5.

### F6 — The in-cell FK/PK button was *deliberately* made to overlay the text, and that is the complaint

`slickTheme.css:369-401` says it outright:

> Deliberate redesign, not the original port (item 12, a later coordinator round): "always
> visible… overlay on top of the cell's text… rather than reserving padding that pushes/
> truncates the text" — `padding-left` (this rule used to reserve `calc(--kira-s-4 + 18px)` for
> the button, pushing/truncating the cell's own text to make room for it) is dropped entirely;
> `.cell-nav-btn`'s own opaque `background` is what keeps the icon legible sitting directly on
> top of the text now, rather than beside it.

`SlickGridHost.vue:936-960` (`placeNavButtonsForRenderedCells`) appends one real `<button>` per
nav-eligible rendered cell; the button is `position: absolute; left: 4px` inside the (already
absolutely-positioned) `.slick-cell`. The text node behind it is not offset at all.

The user is reversing that decision. This is a straight revert of the `padding-left` half of it — the
"always visible, one real button per cell" half stays.

### F7 — The pager's move is one commit, and it touched only the SQL data view

`d2892f49 feat(grid): the pager sits at the toolbar's right edge` (P16 D1) moved `PagerControls` out
of `DataToolbar.vue`'s `#toolbar` slot — where it sat immediately before the page-size
`SegmentedControl` — into `DataView.vue`'s `#toolbar-end`. `--stat` shows exactly two files:
`DataToolbar.vue` and `DataView.vue`. `DataToolbar.vue:143-146` still carries the note.

`views/documents/DocumentView.vue:724` has had its pager in `#toolbar-end` since
`e9f2c784` (the Wails-slot move) and was never touched by `d2892f49` — see D7 for the consistency
trade-off this creates.

### F8 — A row selection survives the right-click and is then destroyed by the next click; the toolbar's delete reads the destroyed selection

Two halves, one root cause.

**(a) `onGutterContextMenu` is correct in isolation.** `SlickGridHost.vue:1387-1417` explicitly keeps
a multi-row selection when the right-click lands inside it (`inSelection` → no `setActiveCell` call).

**(b) Everything after it collapses the selection.** `SlickHybridSelectionModel.handleActiveCellChange`
(`node_modules/slickgrid/dist/esm/index.js`, verified) is:

```js
this._activeSelectionIsRow = this.rowSelectionModelIsActive(args),
this._activeSelectionIsRow
  ? this._options?.selectActiveRow && isRowDefined && this.setSelectedRanges([new SlickRange5(args.row, 0, args.row, cols-1)], void 0, "")
  : …this.setSelectedRanges([new SlickRange5(args.row, args.cell)], void 0, "")
```

so **any** subsequent active-cell change replaces the whole selection with one row or one cell. The
context menu itself makes that happen: `ContextMenu.vue` adds a capture-phase document `mousedown`
listener (line 197) and every menu item's `run()` fires from a click that also reaches the grid.
`onCellContextMenu` (line 1419-1428) additionally calls `grid.setActiveCell(...)` unconditionally,
so a right-click on a *cell* inside a multi-row selection destroys it immediately.

**(c) The toolbar delete then has nothing to act on.** `DataToolbar.vue:112-135` `onDeleteRow` opens
with `const sel = r?.selection; if (!sel) return;`. After the selection has collapsed to one cell it
stages a delete for one row; after it has been cleared entirely it silently returns. That is the
reported "deleting selected rows doesn't work at all" — the button is enabled
(`canDeleteRows` is `isWritable && caps.canDelete`, line 44 — it does not consult the selection at
all), so the user gets an enabled button that does nothing.

Note also that `DataToolbar.onDeleteRow`'s enablement disagrees with `SlickGridHost.canDeleteRows()`
(line 228-230), which additionally requires `hasPrimaryKey()`. Without a primary key `toggleDelete`
stages an op that can never resolve — a second, independent reason the button can appear to do
nothing.

### F9 — Mongo's copy affordances have no "plain JSON" default; the one that is plain is the *console*'s

`views/documents/menu.ts:71-101` and `views/console/resultMenu.ts:265-290` both expose one
`Copy document ▸` submenu with three explicitly named formats (Shell mode / Canonical Extended JSON /
Relaxed Extended JSON). Neither has an unlabelled "copy".

The unlabelled one is `views/console/resultMenu.ts:218-235` `rowAsJsonMenu` — `Copy as JSON` /
`Copy all as JSON`, both `prettyJson(ctx.json)`, i.e. **plain** JSON with no type information. Its own
comment scopes it to the key-value (Redis) branch — *"a Redis pair has no shell/EJSON format of its
own"* — but `ConsoleResultGrid.vue` also reaches it for a Mongo result whose rows arrive as plain
JSON rather than as documents.

So the item is real, and the surface is the console's row menu, not the document tree's.

### F10 — The resolved-value hover already exists, and covers every editor surface but the field-name column

`api/state/variableCompletion.ts:126-176` `hoverAt` already returns the **resolved plaintext** (piped
through any transform chain, truncated at `HOVER_VALUE_MAX_LENGTH`) for a `resolved` reference, and
for a `deferred` (secret) one returns only `'secret — resolved when the request is sent'`. The
security assertion is explicit: *"a secret's plaintext never enters the renderer to begin with"*.

It is wired into the URL field (`HttpRequestView.vue:343`), the body editors
(`RequestBodyPane.vue:162,174`), the header/param/url-encoded/form-data **value** cells
(`FieldRowsTable.vue:300`, `FormDataTable.vue:105`), and the gRPC target/metadata/body
(`GrpcRequestView.vue:311,407`, `MetadataTable.vue:235`).

What it is **not** wired into: `FieldRowsTable.vue`'s **name** column. Line 293's
`v-if="valueVariableSupport"` guards only the value cell; the name `<AutocompleteField>` above it gets
`:candidates` but no `:range-highlights`/`:hover-at`. A header name like `X-{{tenant}}-Id` is a legal
and common thing to write, and today it is neither coloured nor hoverable.

### F11 — The response panel has a find bar; the request panel has none, and the two are different widgets

`views/shared/ResponseFindBar.vue` (152 lines) is a `targets: readonly FindBarTarget[]` bar over
`editor/findRanges.ts`, mounted **inside** `ResponsePane.vue:416` and gated to the Body/Raw panes.
Its own header comment states what it deliberately lacks: *"no case/word/regex, no chunked scan, no
filter mode"*.

`views/shared/page/SearchToolbar.vue` (403 lines) is the data views' bar and has exactly the "more
options" the report names — `matchCase`/`wholeWord`/`regex` (lines 48, 265-276) plus a
filter-to-matches toggle — but it is built on `PageSearchApi` (`props.api.runSearch`,
`matchedRows`, `pageVersion`), a paged-row-set abstraction a request form has no analogue of.

The request panel has no find at all. It does have a per-table filter box
(`HttpRequestView.vue`'s `#toolbar-2`, P16 D13) that already covers the header/param tables — so the
genuinely missing surface is the **request body editor**.

### F12 — A complete, tested curl parser already exists and is reachable only from a dialog

`packages/api-core/src/http/curl/{tokenize,flags,parse}.ts` with `packages/api-core/test/http-curl.spec.ts`
(P7). `api/state/curl.ts:88-153` exposes `previewCurl(text)` and `submitImportCurl(text)`, both pure
and synchronous, driving `api/ImportCurlDialog.vue`. There is no paste path: `HttpRequestView.vue:336-347`
renders the URL as `<AutocompleteField>` with no `@paste` handling, and `AutocompleteField.vue:388`
owns the real `<input>`.

Nothing needs writing from scratch — item 12 is a paste handler plus a reuse of `submitImportCurl`.

### F13 — The Variables button uses `symbol-variable`, the same glyph as a single variable row

`HttpRequestView.vue:406` and `GrpcRequestView.vue:385` use `icon="symbol-variable"` for a control that
opens a **list** of variables (`VariablesOverviewPanel`). The same glyph is used for one variable in
`CollectionsPanel.vue:203` (the empty state) and `VariableSetView.vue:402` (a collection variable set's
tab icon). `@vscode/codicons` ships `variable-group`, which is the "several variables" glyph and is
already available to this app (verified in `node_modules/@vscode/codicons/dist/codicon.csv`).

### F14 — The Api module's dropdowns disagree about which edge they hang from

`theme/primitives/PopoverPanel.vue:16-21` — `anchor?: 'left' | 'right'`, **defaulting to `'right'`**.
In the Api module:

| Surface | anchor |
|---|---|
| `api/MethodSelect.vue:48` | `left` |
| `api/EnvironmentSelect.vue:69` | `right` |
| `api/VariablesOverviewPanel.vue:73` | *(none → `right`)* |
| `api/VariableHistoryMenu.vue:43` | *(none → `right`)* |

So the method picker opens left-aligned to its trigger and every other Api dropdown opens
right-aligned. That is the reported inconsistency.

### F15 — `fake.` references are reported as unresolved, and Postman's `$name` spellings are still offered first-class in autocomplete

Two separate defects in one item.

**(a) The false "unresolved" warning.** `packages/api-core/src/http/substitute.ts:111-116`:

```ts
return name.startsWith('$') || name.startsWith('fake.');
```

— both spellings classify as `kind: 'dynamic'`. But `views/httprequest/HttpRequestView.vue:175` filters:

```ts
.filter((r) => r.kind === 'unknown' || (r.kind === 'dynamic' && !isDynamicName(r.name)))
```

`isDynamicName` (`catalog.ts:88`) only matches the 58 `$`-prefixed `DYNAMIC_NAMES`. Every one of the
57 `FAKE_NAMES` therefore satisfies `dynamic && !isDynamicName` and is counted into the
`{{n}} unresolved` chip with the tooltip `"fake.person.firstName — unknown dynamic value"`.
`views/grpcrequest/GrpcRequestView.vue:177` is character-identical and has the identical bug. This is
precisely the reported "Faker-based variable references currently trigger a 'variable not found'
error… they're dynamically generated at request time".

**(b) The aliases are still promoted.** `api/state/variableCompletion.ts:194-198` builds
`dynamicCandidates` from all 58 `DYNAMIC_NAMES` with `detail: 'postman alias'` and offers them in
autocomplete after the `fake.` names. `api/DynamicValuesDialog.vue:26-27` lists both sets in the
reference dialog.

**(c) The mapping the import needs already exists.** `catalog.ts:181-243` `ALIAS_TO_FAKE` is a
compiler-checked `Record<DynamicName, FakeName>` — total, exhaustive, and already correct. Item 15's
import half is a call to it, not a new table.

### F16 — Five separate defects in the variables/environments surface

**(a) The Refresh and Stop buttons are always rendered.** `theme/primitives/ViewChrome.vue:85-97`
renders both `IconButton`s unconditionally and uses `canRefresh`/`canStop` only for `:disabled`.
`api/VariableSetView.vue:404-405` passes `:can-refresh="false" :can-stop="false"`, so a variables tab
shows two permanently-dead buttons for operations that do not exist in that context.

**(b) The environment name/description fields carry only placeholders.**
`VariableSetView.vue:463-477` — two `TextField`s with `placeholder="name"` / `placeholder="description"`
and no label element. The placeholder vanishes the moment either has a value, so a populated
environment editor shows two unlabelled text boxes. (The report says "collection name"; in the code
these fields exist only on the *environment* branch, `v-if="scope === 'environment'"` — the collection
branch has no name/description row at all. Reconciled in D16b.)

**(c) Environment *management* is still a dialog.** `api/EnvironmentsDialog.vue` (304 lines) owns
create / rename / duplicate / delete / reorder / colour. `VariableSetView.vue` is already a real tab
(`ViewChrome`, keyed by `tab.id`) for *editing one set*, and `CollectionsPanel.vue:189-192` records
the split explicitly: *"EnvironmentsDialog stays (OQ-3): it owns create/rename/duplicate/delete/reorder,
a management surface this navigation-only category does not attempt."*

**(d) The sidebar environments list was added on purpose, one phase ago.**
`CollectionsPanel.vue:185-227` — *"P22b D8: the environments list, moved out of the gear-icon dialog and
into its own collapsible category (F11)"*. The user is reversing P22b D8.

**(e) The environment icon is a gear.** `CollectionsPanel.vue:162` (`icon="settings-gear"`, the
"Environments…" action) and `VariableSetView.vue:402` (an environment tab's icon) both use the
settings glyph, which reads as "preferences", not "environment". `server-environment` exists in the
installed codicon set.

### F17 — Two independent clipping mechanisms, both in shared code

**(a) No `size()` middleware — nothing can shrink.** `theme/floatingPosition.ts:45-47` composes
`offset` → `flip` → `shift` only. `shift()` slides a floating element back inside the viewport; it
**cannot** shrink one. A context menu or submenu taller than the viewport (the grid row menu with its
`Copy row(s) ▸` submenu, the cell-editor format picker) therefore hangs off the bottom edge with no
scroll — the reported "cut off by the window edge".

**(b) `PopoverPanel` and the autocomplete popup are not teleported.**
`PopoverPanel.vue:120-133` renders inline, inside whatever subtree its trigger lives in, with
`.menu-backdrop { position: fixed; z-index: 20 }`. `position: fixed` escapes `overflow` clipping only
while **no ancestor establishes a containing block** — any ancestor with `transform`, `filter`,
`perspective`, `contain`, `backdrop-filter` or `will-change` turns `fixed` back into
ancestor-relative and re-subjects it to that ancestor's clip and stacking order.
`AutocompleteField.vue:141` states the same choice for the completion popup: *"a `position: fixed` list
positioned from the input's own rect, not Teleported"*.

`DialogFrame`, `ContextMenu` and `AppTooltip` **are** teleported (`DialogFrame.vue:65`,
`ContextMenu.vue:236`, `AppTooltip.vue:50`), which is why those three are the ones that mostly work.

**(c) The z-index ladder has a collision and an inversion.** Observed rungs:
`PopoverPanel` 20 · `DialogFrame` 100 · `ContextMenu` 200 · `AutocompleteField` popup 200 ·
`AppTooltip` 300. Two problems: `ContextMenu` and the autocomplete popup **share** rung 200, so a
context menu opened while a completion popup is up is ordered by DOM position, not intent; and
`PopoverPanel` at 20 is **below** `DialogFrame` at 100, so a popover opened from inside a dialog
(e.g. `EnvironmentsDialog`'s colour picker) is painted under the dialog it belongs to. The ladder is
also spelled as five bare literals in five files with no token.

### F18 — Both imports are prominent panel actions, and the menu bar has no request/import entries

`api/CollectionsPanel.vue:148-157` — the Postman import is an always-visible `IconButton` in the
collections panel header. `workbench/panels/ProjectPanel.vue:26-29` — the DataGrip import is an
always-visible `IconButton` in the project panel header. `CollectionsPanel.vue:134-140` — "New request"
is a third.

The menu bar is Go-side and template-driven: `internal/shell/menutemplate.go:39-108` `BuildTemplate`
emits `{Kind: ItemEmit, Label, Accelerator, Channel}` rows; each `Channel` is a constant in
`internal/bridge/events.go:14-36` that the frontend subscribes to via `bridge/index.ts`'s `on(...)`
helpers. Adding a menu command is three small edits (a channel constant, a template row, a frontend
listener) plus wiring to an already-existing frontend action. There is no "File" section today; the
app-name section (line 41-56) holds *New Connection* and *Settings…*, which is where a *New Request*
and the two imports belong.

### F19 — `--kira-statusbar-h` is 26px, defined once

`theme/tokens.css:101` `--kira-statusbar-h: 26px;`. Consumed by
`theme/primitives.css:975` (`height:`) and `workbench/WorkbenchShell.vue:92`
(the shell's last `grid-template-rows` track). Both read the token, so one edit moves both.

### F20 — Nothing in the app releases a closing window's web content, and Wails never destroys the webview

Traced end to end through `wails/v3@v3.0.0-beta.16` in the module cache.

1. `WebviewWindow.Close()` (`webview_window.go:1248-1255`) does not close anything — it re-emits
   `events.Common.WindowClosing`.
2. `HandleWindowEvent` (`webview_window.go:989-1017`) runs **hooks** first and `return`s outright if a
   hook cancels; **listeners** only run when no hook cancelled.
3. Wails' own teardown is a *listener*, registered in `NewWithOptions`
   (`webview_window.go:366-371`): `markAsDestroyed` → `impl.close` → `Window.Remove`.
4. This app's `internal/shell/closeflush.go:84-99` registers a **hook** that cancels the first
   `WindowClosing`, waits up to 2s for the renderer's flush ack, then calls `win.Close()` — a second
   emit, on which the hook no-ops and Wails' listener finally runs. That sequence is correct and does
   reach `impl.close`.
5. `impl.close` on macOS (`webview_window_darwin.go:1329-1337`) is `C.windowClose` →
   `[nativeWindow(window) close]` (line 854-857). The only other teardown entry point,
   `macosWebviewWindow.destroy()` (line 1890-1903), is **called from nowhere in the library** — and
   its C body `windowDestroy` (line 838-840) is *byte-identical* to `windowClose`: also just
   `[window close]`.

So there is no API on `*application.WebviewWindow` that tears a webview down harder than
`[NSWindow close]`, and `[NSWindow close]` does not by itself guarantee the WKWebView is deallocated
or that its `com.apple.WebKit.WebContent` process exits. Compounding it, `main.go:329` sets
`ApplicationShouldTerminateAfterLastWindowClosed: false` (deliberately — the Go process must outlive
its windows), so nothing else reaps the process either. That is exactly the report.

**What is in this app's control:** the page itself. Nothing anywhere navigates the closing window's
webview away from the app, so at `[NSWindow close]` the document is still fully live — the whole Vue
tree, every SlickGrid instance, every CodeMirror instance, the data-plane stream reader, timers — all
resident in that WebContent process. The app can drop all of it before the native close.

**What is not in this app's control, and must not be faked:** whether macOS then reaps the process.
That is a WebKit lifetime question about a native object this app cannot reach, on a platform this
container is not. Recorded honestly in D20 and §5.3 rather than claimed.

---

## 2. Decisions

### D1 — The status hint becomes the chip's tooltip, in both response panes

`views/httprequest/ResponsePane.vue`: delete the `.status-hint` div (line 318) and bind
`v-tooltip="hint"` on the existing `[data-testid="http-status"]` chip. Keep the `hint` computed —
it is now the tooltip's source. `views/grpcrequest/ResponsePane.vue` gets the identical treatment for
`codeHint` / `[data-testid="grpc-status"]`.

**Judgment call, flagged:** the report says "Api module — status code" without naming HTTP or gRPC.
Both panes carry the same always-visible line, from the same original decision lineage (D11 → P18 D13),
and leaving gRPC alone would leave the module internally inconsistent for no reason. Both change.

The `http-status-hint` / `grpc-status-hint` testids disappear; any spec asserting them moves to
asserting the chip's `title`/tooltip instead (§5.1).

### D2 — The console grid gets the data view's live drag highlight, verbatim

In `views/console/ConsoleSlickGrid.vue`:
- give `refreshSelEdges()` the same optional override parameter `SlickGridHost.vue:711` has
  (`selOverride?: Selection | null`), defaulting to today's `currentSelection` read;
- add `computeCellFillHash(sel)` — the exact shape of `SlickGridHost.vue:741-765`, clipped to
  `grid.lastRenderedRowBounds`, writing the class `'kira-cell-selected'` (the same key
  `selectedCellCssClass` uses at line 703, so commit cleanly replaces preview);
- add `onCellRangeSelecting(_e, args)` — early-return in row mode, else translate
  `selectionFromRanges([args.range], false, null)` → `toPageRowSelection`, call
  `refreshSelEdges(pageSel)` and `grid.setCellCssStyles('kira-cell-selected', computeCellFillHash(pageSel))`;
  **never** write `currentSelection` (the data view's own reasoning: a drag crossing back over its
  anchor would transiently look like a completed one-cell selection);
- subscribe it in `onMounted` via `selectionModel.getCellRangeSelector()`.

**Deviation from the report, flagged:** the report says the drag highlight is missing "in both the SQL
data view and the query console's SQL results". F2 shows the data view already has the fix (landed as
"D4 (fix)") and the console does not. Only the console changes. If the data view still misbehaves in
practice it is a different defect from the one described and needs its own report.

### D3 — A column right-click paints its selection immediately

Both `SlickGridHost.onHeaderContextMenuHandler` and `ConsoleSlickGrid.onGridHeaderContextMenu` already
push the ranges; what neither does is force the paint before the menu covers the header. Add a
`grid.render()` (data view) / `refreshSelEdges()` (console, whose `onSelectedRangesChanged` already
runs synchronously) immediately after `setSelectedRanges` and before `openContextMenu`, so the column
is visibly selected under the menu rather than only in the model.

Combined with D8's guard, the selection then also survives the menu.

### D4 — The sort control moves to the header's true right edge and gets 8px narrower

In `slickTheme.css`:
- `.slick-sort-indicator`: `width: 14px` → `12px`; add `margin-right: calc(-1 * var(--kira-s-2))` so the
  4px flex gap that follows it is cancelled and the control sits against the header's own padding edge.
- `.slick-sort-indicator-asc, .slick-sort-indicator-desc`: drop `margin-left: var(--kira-s-2)` — the
  sorted state no longer costs 4px the at-rest state does not.
- `.slick-sort-indicator-numbered`: add `margin-left: 0` at rest so its preceding gap is the only
  spacing (the `:not(:empty)` rule keeps its own 2px when a badge is actually showing).

Reserved right-side chrome falls from 30px to **20px** at rest, all of it either the control or the
header's existing padding.

`views/shared/page/columns.ts`'s `HeaderChrome.sortControl` doc comment and `SlickGridHost.vue:449`'s
literal both move `22` → `16` (4px gap + 12px control) so `headerAwareMinWidth` stays honest about
what the header actually spends. The `keyBadge: 20` and `padding: 16` figures are unchanged.

### D5 — The initial-width floor and the resize floor become two constants

In `views/shared/page/columns.ts`:
- `MIN_WIDTH` stays `64` and keeps its **only** remaining job: the interactive-resize floor
  (`headerAwareMinWidth`'s lower bound, and so every column's `minWidth`). A user who deliberately
  drags a column narrow may still do so.
- add `export const MIN_INITIAL_WIDTH = 96;` — the same number `DEFAULT_COLUMN_WIDTH` already uses for
  "nothing measurable" — and clamp `measuredWidths` (line 139) to it instead of `MIN_WIDTH`.

`SlickGridHost.vue:454`'s `width: Math.max(floor, storedWidths[name] ?? measured[name] ?? DEFAULT_COLUMN_WIDTH)`
needs no change: `measured[name]` now already carries the higher floor, and a *stored* width
(a real user drag) is deliberately still allowed down to `floor`.

This is why the two constants must be separate: clamping stored widths up to 96 would silently undo
every deliberate narrow drag on every reload, which is the mirror image of the bug the `MIN_WIDTH`
clamp was added to fix.

### D6 — The in-cell nav button gets its space back

`slickTheme.css`: add to the `.slick-grid-host .slick-cell.has-nav` rule

```css
padding-left: calc(var(--kira-s-4) + 18px);
```

(the exact reservation the comment records as having been dropped: 8px of gutter + 16px of button +
2px). Right-aligned numeric cells keep `justify-content: flex-end`, so the padding pushes the value
away from the button rather than into it. The comment block at lines 369-381 is rewritten to record
that item 12's overlay redesign is reverted by user request and why, so the next reader does not
re-apply it.

### D7 — The SQL data view's pager returns to `DataToolbar`, immediately before the page-size picker

A targeted revert of `d2892f49`: `PagerControls` (and the `goFirst`/`goPrev`/`goNext`/`goLast`/
`goToPage` imports and the five handlers it needs) move back into `DataToolbar.vue`'s `#toolbar`
content, rendered before the `SegmentedControl`, and out of `DataView.vue`'s `#toolbar-end`. Every
`pager-*` testid and every prop/event on `PagerControls` is unchanged, so no spec moves.

**Judgment call, flagged.** This *re-creates* an inconsistency: `DocumentView.vue` keeps its pager in
`#toolbar-end` (F7 — it was never moved, and the report does not mention it). I am following the
report literally and changing only the view named, because "wherever it made sense before" has a
single unambiguous answer for that view and none for the others. If the intent was app-wide, that is
a one-line follow-up in `DocumentView.vue`, deliberately not taken here.

### D8 — A context menu may not destroy the selection it was opened on

One guard, applied in both grids, and it is the shared root cause of items 3 and 8.

In `SlickGridHost.vue`:
- `onCellContextMenu` (line 1419) currently calls `grid.setActiveCell(...)` unconditionally. Gate it
  the way the gutter handler already gates its own: if the clicked cell lies inside the current
  `range`/`row`/`column` selection, leave the selection alone.
- add a module-scoped `suppressSelectionCollapse` flag set for the duration of the open menu (set in
  the three `on*ContextMenu` handlers, cleared from `openContextMenu`'s close path via the existing
  `contextMenuState.open` watch) and consulted in `onSelectedRangesChanged`: while it is set, a
  single-cell/single-row range arriving from an active-cell change **restores** the previous
  selection instead of replacing it.

The console grid gets the same guard around its own `onGridContextMenu`/`onGridHeaderContextMenu`.

And the second half of item 8, in `DataToolbar.vue`:
- `canDeleteRows` (line 44) additionally requires a non-empty selection and a primary key, matching
  `SlickGridHost.canDeleteRows()` — `isWritable && !!caps?.canDelete && hasPrimaryKey && !!selection`.
  A button that cannot act must be visibly disabled, not enabled and inert.
- `deleteRowTooltip` (line 45) gains the two new negative branches ("Select one or more rows first" /
  "This table has no primary key") so the disabled state explains itself, per the app's own convention
  (`KeyValueView.vue:227`: *"the actual number or the actual condition, never a silently-disabled
  control with no explanation"*).

### D9 — The console's unlabelled Mongo copy carries types

`views/console/resultMenu.ts`'s `rowAsJsonMenu` keeps its `Copy as JSON` / `Copy all as JSON` items
for the key-value branch, and gains an optional `typed?: boolean` on `RowJsonMenuContext`. When set —
which `ConsoleResultGrid.vue` does for a Mongo result — the two `run()`s go through
`toShellText(...)` / `jsonArrayOf(bodies.map(toShellText))` instead of `prettyJson(...)`, matching the
`Copy document ▸ Shell mode` leaf that already exists one menu over, and the labels become
`Copy as JSON (with types)` / `Copy all as JSON (with types)` so the clipboard's contents are not a
surprise.

Shell mode, not Canonical Extended JSON, because it is what the tree already displays and what
`saveDocumentEdit`/`parseDocumentLiteral` accept back (P27 D12's own reasoning) — "the typed variant"
in this app means the shell form.

### D10 — The field-name column joins the variable-hover surface

`views/httprequest/FieldRowsTable.vue`: the name `<AutocompleteField>` gains
`:range-highlights="valueVariableSupport?.rangeHighlights"` and `:hover-at="valueVariableSupport?.hoverAt"`,
the same two bindings the value cell has at lines 299-300. No new machinery: `hoverAt` already
returns the resolved value for a non-secret and the masked sentence for a secret (F10), and
`AutocompleteField` already renders both.

`api/VariableRow.vue`'s value cell is deliberately **not** given a hover: it *is* the definition, so a
tooltip repeating the value beside it would be noise, and it already has the reveal/secret machinery.

### D11 — One find bar above both panels, with the data views' three option toggles

`views/shared/ResponseFindBar.vue` is renamed in place to keep its `FindBarTarget`/`FindBarHost`
contract and grows exactly what F11 says it lacks and the report asks for:

- three `IconButton` toggles — `case-sensitive`, `whole-word`, `regex` — copied from
  `SearchToolbar.vue:265-290` (same icons, same labels, same "three independent toggles" semantics);
- `editor/findRanges.ts` gains the matching options argument (`{matchCase, wholeWord, regex}`),
  defaulting to today's behaviour so no existing caller changes meaning. A `regex` that fails to
  compile yields zero matches and marks the input invalid — never throws.

`HttpRequestView.vue` then hosts **one** instance, in the `#strips` band above the request/response
split rather than inside `ResponsePane`, with a two-option scope control (Request / Response). Its
`targets` are computed from the scope: Response → today's body/raw targets; Request → the request
body document. The `ResponsePane` keeps its own find toggle button, which now drives the hoisted bar
with the scope pre-set to Response.

**The one genuinely new wire:** `RequestBodyPane.vue:161,174` already binds `:range-highlights` to
`variables?.rangeHighlights`, so the compartment is occupied. It becomes a merge of the two sources —
variable ranges and find ranges — in one function, find ranges last so a match's class wins on
overlap. This is a real behaviour decision, not a mechanical port, and is the reason item 11 is
scoped to the *body* editor only: the header/param tables already have P16 D13's filter box and do
not need a second, differently-shaped search over the same rows.

**Deviation from the report, flagged:** the report asks for "the standard search toolbar… used in the
data views". `SearchToolbar` cannot be reused literally — it is `PageSearchApi`-shaped (F11) and a
request form has no paged row set. What is reused is its *option vocabulary and chrome*, on the find
bar that already understands documents. The user-visible result is the requested one.

### D12 — Pasting a curl command into the URL field builds the request

`AutocompleteField.vue` gains an optional `@paste-text` emit carrying the pasted string and the
event, so the primitive stays generic (it does not learn what curl is).

`HttpRequestView.vue` handles it: if the pasted text's first token is `curl` (after trimming leading
whitespace and an optional `$ ` prompt), `preventDefault()` and route it through
`api/state/curl.ts`'s existing `submitImportCurl(text)` — which already applies method, URL, headers,
body and auth to the active tab and returns `false` on a parse failure. A parse failure falls through
to the ordinary paste, so nothing is ever silently swallowed.

No new dependency and no new parser: F12's `packages/api-core/src/http/curl/parse.ts` is the parser,
and it already has `packages/api-core/test/http-curl.spec.ts`. The new logic is the **detection**
predicate, which does get a test (D19).

### D13 — `symbol-variable` → `variable-group` on the Variables button

`HttpRequestView.vue:406` and `GrpcRequestView.vue:385` only. The single-variable uses of
`symbol-variable` (`CollectionsPanel.vue:203`, `VariableSetView.vue:402`'s collection branch) stay —
the point of the change is that a list and an item stop sharing one glyph.

### D14 — Every Api dropdown anchors left

`api/EnvironmentSelect.vue:69` `anchor="right"` → `"left"`; `api/VariablesOverviewPanel.vue:73` and
`api/VariableHistoryMenu.vue:43` gain an explicit `anchor="left"` rather than inheriting
`PopoverPanel`'s `'right'` default. `MethodSelect` is already `left` and does not change.

`PopoverPanel`'s own default stays `'right'`: five Studio-side callers
(`ColumnsMenu`, `PreviewCommandPanel`, `StreamComposeMessage`, `ProjectionMenu`, and the cell
editor's picker) are right-anchored on purpose because their triggers sit at a toolbar's right edge.
Changing the default would silently move all of them; item 14 is scoped to the Api module.

### D15 — Faker becomes the only offered spelling; Postman aliases survive only as an import mapping

Three edits, matching F15's three parts.

**(a) The false warning.** `HttpRequestView.vue:175` and `GrpcRequestView.vue:177` change
`!isDynamicName(r.name)` to `!(isDynamicName(r.name) || isFakeName(r.name))`, importing `isFakeName`
alongside. A `{{fake.*}}` reference is generated at send time and is not a missing variable.

**(b) Autocomplete.** `api/state/variableCompletion.ts` drops `dynamicCandidates` (lines 194-198) from
the offered list entirely. `DYNAMIC_NAMES` stays exported and `isDynamicName` stays in use — an
already-stored `{{$randomEmail}}` must keep resolving, keep painting as a known dynamic reference
(`classFor`, line 50) and keep its hover (line 165). It simply stops being *offered*.
`api/DynamicValuesDialog.vue:27` likewise stops listing the alias half; the dialog is the app's own
reference sheet for what to type, and it should now teach one vocabulary.

**(c) Import.** The Postman collection importer rewrites `{{$name}}` → `{{ALIAS_TO_FAKE[$name]}}`
in every imported request's URL, header values, query/form values and body, for every name in the
already-exhaustive `ALIAS_TO_FAKE` table (F15c). A `$name` outside the table is left verbatim
(it has no faker equivalent by construction — `catalog.ts`'s own exclusion list) and still resolves,
since `substitute.ts` and `generate` both continue to accept the `$` spelling. This rewrite is pure
string mapping over parsed request fields and is the second thing in this batch that earns a test
(D19).

### D16 — The variables/environments surface, five fixes

**(a) `ViewChrome` learns to omit the run controls.** A new `showRunControls?: boolean` prop,
defaulting `true`. `VariableSetView.vue` passes `:show-run-controls="false"` and drops its now-dead
`:can-refresh="false" :can-stop="false"`. Every other view is untouched — `canRefresh: false` keeps
meaning "temporarily cannot refresh" for views where refreshing is a real, currently-unavailable
operation, which is a different statement from "this view has nothing to refresh".

**(b) Labels.** The environment name/description fields get real `<label>` elements
("Name", "Description"), following the header row's existing `.cell` label convention two blocks
below (`VariableSetView.vue:493-495`). *Reconciling the report's wording:* it says "collection name
and description"; in the code these two fields exist only under `v-if="scope === 'environment'"`.
The fields the user saw are the environment ones, and they are what gets labelled. No name/description
row is added to the collection branch — that would be new surface, not a label.

**(c) Environment management becomes a tab.** `api/EnvironmentsDialog.vue`'s body — the list with
create / rename / duplicate / delete / reorder / colour — moves into a new
`api/EnvironmentsView.vue`, hosted by a new `'environments'` tab kind in `api/tabs.ts` alongside the
existing `openVariableSetTab`, rendered through `ViewChrome` with `:show-run-controls="false"`.
`openEnvironmentsDialog()` becomes `openEnvironmentsTab()`; its three call sites
(`CollectionsPanel.vue`'s header action, `EnvironmentSelect.vue:43-46`'s *Manage…* row, and
`ApiDialogs.vue`'s mount) follow. The dialog component is deleted, not left orphaned. Row click still
opens the per-environment `VariableSetView` tab, exactly as the dialog's rows did.

**(d) The sidebar environments category is removed.** `CollectionsPanel.vue:185-227` (the whole
`.environments-category` block), its `environmentsExpanded` ref, its `onOpenEnvironment` handler,
`variablesState`/`connColorVar` imports if they become unused, and the `.environments-category` /
`.environment-list-row` / `.environment-list-name` styles. This reverses P22b D8; the plan's own
comment block is replaced with a note recording that reversal. The collections category's
collapsible wrapper stays (it is now the only category, but removing the wrapper would be an
unrelated restructure).

**(e) `settings-gear` → `server-environment`** on `CollectionsPanel.vue:162` and
`VariableSetView.vue:402`'s environment branch.

### D17 — Floating surfaces: shrink, teleport, and one z-index ladder

Three fixes in shared code, matching F17's three parts.

**(a) `size()` middleware.** `theme/floatingPosition.ts` adds `size()` after `shift()`, applying
`maxHeight: availableHeight - padding` and `maxWidth: availableWidth - padding` to the floating
element. `ContextMenu.vue`'s menu and submenu, and `PopoverPanel`'s panel, add
`overflow-y: auto` so a capped surface scrolls instead of clipping. A menu that fits is
pixel-identical to today — `size()` only ever writes a *max*.

**(b) Teleport.** `PopoverPanel.vue` wraps its backdrop in `<Teleport to="body">`. Because
`autoUpdate`'s anchor is resolved today as `backdropEl.value?.parentElement` (line 99) — which
teleporting invalidates — the component takes the anchor element explicitly: a new
`anchorEl` prop, passed by each of its callers from the `ref` on the trigger they already wrap in an
anchor div. `AutocompleteField.vue`'s completion popup gets the same treatment, positioned from the
`<input>`'s own rect, which it already holds.

**(c) The ladder becomes tokens.** `theme/tokens.css` gains
`--kira-z-popover: 100; --kira-z-dialog: 200; --kira-z-menu: 300; --kira-z-autocomplete: 350; --kira-z-tooltip: 400;`
and the five literals in `PopoverPanel.vue`, `DialogFrame.vue`, `ContextMenu.vue` (×2),
`AutocompleteField.vue` and `AppTooltip.vue` become token reads. The ordering change that matters:
a popover now sits **above** a dialog (fixing a popover opened from inside one being painted under
it), and the context menu sits **above** the autocomplete popup instead of tying with it.

This is deliberately one shared fix in the primitives, not per-instance patches — the report asks for
exactly that.

### D18 — Three menu-bar commands; the two import buttons leave the panels

`internal/bridge/events.go` gains `ChannelNewRequest = "kira:menu:new-request"`,
`ChannelImportPostman = "kira:menu:import-postman"`, `ChannelImportDataGrip = "kira:menu:import-datagrip"`.

`internal/shell/menutemplate.go` `BuildTemplate` gains, in the app-name section after
*New Connection*, a *New Request* item and a separated pair *Import Postman Collection…* /
*Import DataGrip Connections…*. No accelerators — none of the three is frequent enough to spend one,
and `internal/shell/accel.go`'s `Shortcuts` map stays untouched.

`frontend/src/bridge/index.ts` gains `onNewRequest` / `onImportPostman` / `onImportDataGrip` in the
shape of the existing `onNewConnection` (line 75), subscribed once at the workbench level and wired
to the three functions that already exist: `openApiRequestTab`, `CollectionsPanel`'s `onImport`
(hoisted into `api/state/collections.ts` so the menu can call it without the panel being mounted),
and `state/datagripImport.ts`'s `pickAndScanDataGripProject`.

Then `api/CollectionsPanel.vue:148-157` (the Postman import button) and
`workbench/panels/ProjectPanel.vue:24-30` (the DataGrip import button) are removed.
`StudioStart.vue:71-75`'s first-run *Import from DataGrip* button **stays** — it is a first-run empty
state, which is exactly when a menu-bar-only affordance is hardest to find. `CollectionsPanel`'s
*New request* `+` button also stays: the report asks for the action to be *added* to the menu bar,
not moved off the panel.

### D19 — Exactly two tests, and why every other item gets none

Against `AGENTS.md`'s bar ("advanced, complex or deeply nested logic… default to *no* dedicated unit
test"):

**Gets a test:**
1. **D12's curl detection predicate** (`packages/api-core`, alongside `http-curl.spec.ts`). It is a
   real recogniser with interacting rules — leading whitespace, an optional `$`/`#` prompt,
   `curl` vs `curling` vs a URL that merely contains "curl", a multi-line continued command — and it
   sits on a *destructive* path: a false positive silently replaces the user's whole request instead
   of pasting text. The parser it guards is already tested; the guard is not.
2. **D15c's alias→faker rewrite** (`packages/api-core`, alongside `http-dynamic-fake.spec.ts`). It
   rewrites user data at import across five different field families, must leave an unmapped `$name`
   untouched, must not touch a `{{plain}}` variable or a `{{$name}}` inside a larger string
   incorrectly, and is exactly the "mapping table applied by a walker" shape the bar names.

**Gets nothing, and why:** items 1, 4, 5, 6, 7, 13, 14, 16b, 16e, 19 are CSS/markup/token edits with
no logic. Items 2, 3, 8, 17, 18, 20 are event-wiring and lifecycle changes whose only meaningful
assertion is a live DOM or a live window — the existing `tests/ui/` tier is where those belong, and
§5.1 lists the specs that must be updated there rather than new ones invented. Items 9, 10, 15a, 15b
are one-line predicate/format swaps that would restate their own bodies. Item 11's find-options
plumbing threads through `findRanges`, whose existing behaviour is unchanged by construction
(defaults preserved).

### D20 — The closing window releases its page; the native reap is named as unverified

`internal/shell/closeflush.go` only. Inside `AttachCloseFlush`'s goroutine, immediately before the
final `win.Close()`:

```go
win.SetURL("about:blank")
```

By that point the flush ack has already arrived (or timed out), so nothing in the page still has work
to do. Navigating away tears the document down inside WebKit — the Vue tree, every SlickGrid and
CodeMirror instance, the data-plane stream reader, every timer — so the WebContent process is left
holding an empty document rather than the app's full heap when `[NSWindow close]` runs a moment later.
It is safe on every platform and on every path into a close, including the quit handshake.

**`apps/kira-studio/main.go` is not touched at all.** F20's trace shows the whole close sequence is
already routed through `internal/shell/closeflush.go`, so there is nothing this fix needs from
`main.go` — which matters because a concurrent effort is editing that file for unrelated
(native-notification) reasons and this batch must merge cleanly behind it.

**What this does not claim.** F20 established that Wails v3 beta.16 exposes no window-destroy API
(`macosWebviewWindow.destroy()` is dead code and is byte-identical to `close()` anyway), so this app
cannot force the WKWebView to deallocate or the `com.apple.WebKit.WebContent` process to exit.
Whether macOS reaps the now-empty process, and how quickly, is a WebKit lifetime question observable
only in Activity Monitor on a Mac running a packaged build. §5.3 records that as unverified rather
than asserting the item is closed.

---

## 3. The frontend, file by file

### 3.1 `views/httprequest/ResponsePane.vue` — edited (D1, D11)
Status hint becomes the chip's tooltip; the find bar moves out to `HttpRequestView` and this pane
keeps only the toggle that drives it.

### 3.2 `views/grpcrequest/ResponsePane.vue` — edited (D1)
Same status-hint change.

### 3.3 `views/console/ConsoleSlickGrid.vue` — edited (D2, D3, D8)
`refreshSelEdges` override parameter, `computeCellFillHash`, `onCellRangeSelecting` + its
subscription, the header-context-menu paint, the selection-collapse guard.

### 3.4 `views/grid/SlickGridHost.vue` — edited (D3, D8)
Header-context-menu paint; `onCellContextMenu`'s in-selection gate; the selection-collapse guard.
`sortControl: 22` → `16` in the `headerAwareMinWidth` call (D4).

### 3.5 `views/shared/slick/slickTheme.css` — edited (D4, D6)
Sort-indicator geometry; `.has-nav` padding restored, with its comment block rewritten to record the
reversal.

### 3.6 `views/shared/page/columns.ts` — edited (D4, D5)
`MIN_INITIAL_WIDTH`; `measuredWidths`' clamp; the `HeaderChrome.sortControl` doc figure.

### 3.7 `views/grid/DataToolbar.vue` — edited (D7, D8)
`PagerControls` and its five handlers return; `canDeleteRows`/`deleteRowTooltip` gain the selection
and primary-key conditions.

### 3.8 `views/grid/DataView.vue` — edited (D7)
`PagerControls` leaves `#toolbar-end`.

### 3.9 `views/console/resultMenu.ts` + `views/console/ConsoleResultGrid.vue` — edited (D9)
`RowJsonMenuContext.typed`; the two shell-mode branches; the Mongo call site.

### 3.10 `views/httprequest/FieldRowsTable.vue` — edited (D10)
Name column gains `range-highlights` / `hover-at`.

### 3.11 `views/shared/ResponseFindBar.vue` + `editor/findRanges.ts` — edited (D11)
Three option toggles; `findRanges` options argument with today's behaviour as the default.

### 3.12 `views/httprequest/HttpRequestView.vue` — edited (D11, D12, D13, D15a)
Hosts the single find bar with its scope control; handles `@paste-text`; `variable-group`;
`isFakeName` in the unresolved filter.

### 3.13 `views/httprequest/RequestBodyPane.vue` — edited (D11)
`rangeHighlights` becomes a merge of the variable and find sources.

### 3.14 `views/grpcrequest/GrpcRequestView.vue` — edited (D13, D15a)
Icon; `isFakeName` in the unresolved filter.

### 3.15 `theme/primitives/AutocompleteField.vue` — edited (D12, D17b, D17c)
`@paste-text` emit; the completion popup teleports; z-index token.

### 3.16 `api/state/variableCompletion.ts` — edited (D15b)
`dynamicCandidates` dropped from the offered list.

### 3.17 `api/DynamicValuesDialog.vue` — edited (D15b)
Alias half dropped from the reference list.

### 3.18 `api/state/collections.ts` — edited (D15c, D18)
The alias→faker rewrite applied on Postman import; `onImport` hoisted so the menu bar can call it.

### 3.19 `api/VariableSetView.vue` — edited (D16a, D16b, D16e)
`show-run-controls`; name/description labels; environment icon.

### 3.20 `theme/primitives/ViewChrome.vue` — edited (D16a)
`showRunControls` prop.

### 3.21 `api/EnvironmentsView.vue` — **new**; `api/EnvironmentsDialog.vue` — **deleted** (D16c)
### 3.22 `api/tabs.ts`, `api/ApiDialogs.vue`, `api/EnvironmentSelect.vue` — edited (D14, D16c)
### 3.23 `api/CollectionsPanel.vue` — edited (D16c, D16d, D16e, D18)
### 3.24 `api/VariablesOverviewPanel.vue`, `api/VariableHistoryMenu.vue` — edited (D14)
### 3.25 `theme/floatingPosition.ts` — edited (D17a)
### 3.26 `theme/primitives/PopoverPanel.vue` — edited (D17a, D17b, D17c)
### 3.27 `workbench/ContextMenu.vue`, `theme/primitives/DialogFrame.vue`, `workbench/AppTooltip.vue` — edited (D17a, D17c)
### 3.28 `workbench/panels/ProjectPanel.vue` — edited (D18)
### 3.29 `frontend/src/bridge/index.ts` + the workbench subscription site — edited (D18)
### 3.30 `theme/tokens.css` — edited (D17c, item 19)
`--kira-statusbar-h: 26px` → `20px`; the five z-index tokens added.

## 4. The Go side, file by file

### 4.1 `internal/bridge/events.go` — edited (D18)
Three channel constants.

### 4.2 `internal/shell/menutemplate.go` — edited (D18)
Three menu rows. `internal/shell/menu_wails_test.go` already walks the built template, so it covers
the new rows without a new test.

### 4.3 `internal/shell/closeflush.go` — edited (D20)
One `win.SetURL("about:blank")` before the final `win.Close()`.

### 4.4 `apps/kira-studio/main.go` — **not touched** (D20)

## 5. Verification

### 5.1 Existing specs that must move with the code
- `tests/ui/` assertions on `[data-testid="http-status-hint"]` / `grpc-status-hint` → assert the
  chip's tooltip instead (D1).
- Any spec opening the environments **dialog** → opens the environments **tab** (D16c).
- Any spec asserting the sidebar's `environments-category-*` testids → deleted with the category (D16d).
- Any spec asserting `import-collection` / `import-datagrip` panel buttons → the menu path (D18).
- `pager-*` testids are unchanged by D7 (the component moves, its API does not).

### 5.2 Commands
`bun run lint` · `bun run typecheck` · `bun run build` · `bun run test:unit` ·
`go build ./apps/kira-studio/internal/...` · `go test ./apps/kira-studio/internal/...` ·
`bun run test:ui` where the environment supports it.

### 5.3 Explicitly unverifiable here
**Item 20's Activity Monitor behaviour.** D20's change is verifiable only as "the Go builds and the
close path still runs"; the actual process reap is macOS-only, packaged-build-only, and cannot be
observed from a Linux container. Reported as implemented-and-reasoned, not as confirmed.
