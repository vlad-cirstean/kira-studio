# P19 — connection dialog sizing, Mongo console fixes, query-result selection, and SQL tooling

> **What this phase is.** `docs/v1.2/SPEC.md`'s P19 row: a fifth user-driven batch, this one
> entirely **Studio mode** — the database client — kept in this chapter rather than reopening v1.1
> (closed out through P29), the same way P16's SQL-grid item already crossed over. Items 4 and 5 are
> named in the row as regressions/gaps against v1.1's own shipped work (P13's Format button, P18's
> SQL language service, P27's indicator colour) and the row asks for each to be **root-caused
> against what actually shipped**, not treated as a fresh feature. That is what §1 does.
>
> **The SPEC row's own factual premises, checked against the tree — four are wrong, and every
> correction changes what this phase builds.** The row was written from chat, before anyone read
> the code:
>
> 1. *"the console's filter input … while the adjacent order/sort input actually applies"* — **the
>    query console has no filter or order input at all.** v1.1 P27 §1.4 already read
>    `views/console/ConsoleView.vue` in full and recorded exactly that ("it's a raw query console —
>    the query text itself *is* the filter"). The surface with an adjacent filter + `SORT` pair is
>    the **Mongo collection view**, `views/documents/DocumentView.vue` (F5). Everything item 2 says
>    about the filter lands there; only its "copy as json for a query result" half lands in the
>    console.
> 2. *"the filter input renders **and behaves** as inert placeholder text"* — the *render* half is
>    real and has one exact cause (F6). The *behave* half is **not reproducible**: the filter
>    genuinely applies, and `tests/ui/autocomplete.spec.ts:288-300` has been proving it end to end
>    (type `{ name: 'widget-1' }`, press Enter, assert the list drops to one row) since P18 landed.
>    What is real on the behaviour side is a different, smaller set of three wiring gaps against
>    `FilterToolbar.vue` — the SQL grid's equivalent row — which F8 enumerates and D5 closes.
> 3. *"the SQL formatter … reported broken"* — **not reproducible as a failure of the formatter.**
>    `sql-formatter@15.8.2` was run in this worktree against a twenty-case battery of realistic
>    statements (F16): every one this app can actually reach formats correctly. `tests/ui/
>    console-format.spec.ts`'s four scenarios still describe the shipped behaviour. What genuinely
>    makes Format read as broken is three things P13's own plan **wrote down and deferred**: its
>    §3's declined statement-by-statement alternative (one unparseable fragment makes the whole
>    press a silent no-op — reproduced, F18), its **OQ-2** (the caret jumps to offset 0, which also
>    re-points *Run statement* at statement 1 — still open), and its D4's `keywordCase: 'preserve'`
>    (an already-indented document formats to itself, with no message at all — F19). This phase
>    closes P13's OQ-1 and OQ-2 rather than inventing a bug.
> 4. *"root-cause each against what P13/P18 originally shipped rather than assuming a shared
>    cause"* — the row is right that there is no shared cause, and the autocomplete half is not a
>    regression **at all**. The SQL console's table/column completion is driven **exclusively** by a
>    DDL document the user pastes by hand into a dialog reachable only from a connection row's
>    context menu (F20, F21); with no such document `sqlCompletionSources` returns `undefined` by
>    design, and `tests/ui/sql-schema.spec.ts`'s own *"with no DDL document, the console is
>    unchanged (D5)"* case pins that as correct. Nothing regressed — the feature has never had data
>    to work from, because nothing in the app ever supplies any. The parser is fine (F23, probed
>    against a real `pg_dump` and a `SHOW CREATE TABLE` in this worktree). D14-D16 fix the supply,
>    not the language service.
>
> **Base commit.** Read against `c13b8af` (branch `claude/feature-v1-2`), i.e. P18 landed and its
> row is marked implemented. Every file:line citation points at that commit.
>
> **The precedents this matches.** `docs/v1.2/plans/P16-sql-grid-consistency-search.md` and
> `docs/v1.2/plans/P18-history-grpc-parity-mode-buttons-env-colour.md` (the two prior user-driven
> batches, both of which found their own row's premises partly wrong and corrected them in the plan
> rather than in the implementation), and — for what items 4 and 5 are measured against —
> `docs/v1.1/plans/P13-query-console-format-button.md`,
> `docs/v1.1/plans/P18-sql-language-server-explain.md` and
> `docs/v1.1/plans/P27-active-filter-indicator-color.md`.

---

## 0. Scope

### 0.1 The five items, and where each lands

| # | Item (SPEC row wording, abbreviated) | Findings | Decisions | Commits |
|---|---|---|---|---|
| 1 | The Add Connection dialog changes size as the user switches tabs/sub-tabs — pin it to one static size | F1-F4 | D1, D2, D3 | T1, T2 |
| 2 | Mongo's query console gains "copy as json" for a result; the filter input renders/behaves as inert placeholder text while the order input applies | F5-F10 | D4, D5, D6, D11 | T3, T4, T8, T9 |
| 3 | Query console results become selectable — rows, columns, or a free-form cell range — copyable as multiple values | F11-F15 | D7, D8, D9, D10, D11 | T5, T6, T7 |
| 4 | The SQL formatter and the SQL table/field-name autocomplete are both reported broken — root-cause each separately | F16-F25 | D12, D13, D14, D15, D16 | T10, T11, T12, T13, T14 |
| 5 | P27's active-filter/order-by indicator colour is the same blue the query text is highlighted in | F26-F29 | D17, D18, D19 | T15, T16 |

### 0.2 Files this phase touches

**Item 1**
- `apps/kira-studio/frontend/src/project/ConnectionDialog.vue` — one `width`, one `height`; the
  `.tab-pane` `min-height` floor becomes redundant and goes.
- `apps/kira-studio/tests/ui/connection-dialog-tabs.spec.ts` — the geometry case (new test in an
  existing file; P28 §7 already owns this file).

**Item 2**
- `apps/kira-studio/frontend/src/views/documents/DocumentView.vue` — the filter box gets `prefix`,
  `prefix-active`, a tooltip; both boxes get the no-op guard, `@escape`, and a resync watcher.
- `apps/kira-studio/frontend/src/views/documents/menu.ts` — a `Copy as JSON` item beside
  `Copy document`.
- `apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue` — a context menu for the
  document and key-value branches.
- `apps/kira-studio/frontend/src/views/console/resultMenu.ts` — **new**: the console result grid's
  menu builders (cell / row / column / document / whole-result), mirroring `views/grid/menu.ts`.

**Item 3**
- `apps/kira-studio/frontend/src/views/shared/clipboardFormats.ts` — **moved** from
  `views/grid/clipboardFormats.ts` (mandatory: `biome.json` forbids `views/console/**` importing
  `views/grid/**`, F13).
- `apps/kira-studio/frontend/src/views/shared/slick/selection.ts` — **moved** from
  `views/grid/slick/selection.ts`, and the `Selection` type moves here out of `views/grid/state.ts`.
- `apps/kira-studio/frontend/src/views/grid/{SlickGridHost.vue,menu.ts,state.ts,slick/*}` — import
  paths only, no behaviour change.
- `apps/kira-studio/frontend/src/views/console/ConsoleSlickGrid.vue` — selection model, gutter
  flags, header click, `onCopy`, `onKeydown`, `onContextMenu`.
- `apps/kira-studio/tests/unit/grid-selection.spec.ts` (if it exists under another name — see §4.1)
  — import path only.

**Item 4**
- `apps/kira-studio/frontend/src/views/console/format.ts` — statement-by-statement formatting.
- `apps/kira-studio/frontend/src/views/console/ConsoleView.vue` — the caret-preserving format path,
  the partial-failure strip, the no-DDL hint.
- `apps/kira-studio/frontend/src/editor/CodeMirrorHost.vue` — one opt-in prop
  (`keepSelectionOnExternalSync`) and one new `defineExpose` member (`setCursor`).
- `apps/kira-studio/frontend/src/views/console/completion.ts` — the tree-backed relation source.
- `apps/kira-studio/frontend/src/views/console/sqlLanguageService.ts` — the source is layered, not
  all-or-nothing.
- `apps/kira-studio/frontend/src/project/SchemaDialog.vue` and
  `apps/kira-studio/frontend/src/state/schemas.ts` — the "Fill from this connection" action.
- `apps/kira-studio/frontend/src/bridge/*` — nothing new; `treeDefinition` already exists.

**Item 5**
- `apps/kira-studio/frontend/src/theme/tokens.css` — one new token.
- `apps/kira-studio/frontend/src/theme/primitives.css` — `.ph.ph-active`, `.p-iconbtn.has-indicator`.
- `apps/kira-studio/frontend/src/views/stream/StreamView.vue` — the partition button's inline style.
- `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` — the sort chevron.

**Tests**
- `apps/kira-studio/tests/ui/{connection-dialog-tabs,console,console-format,sql-schema,autocomplete}.spec.ts`
  — new cases in existing files, per §4.3.

### 0.3 Not in scope

- **Any Api-mode surface.** This phase is Studio-only. The one shared file it touches
  (`editor/CodeMirrorHost.vue`) gains an **opt-in, default-off** prop, which is the same additive
  shape `lintSource`/`hoverSource`/`rangeHighlights`/`autoCloseBrackets` already take — every Api
  host is byte-for-byte unchanged (D12).
- **Schema introspection as a background/automatic behaviour.** D15 adds one explicit,
  user-initiated action; nothing fetches a schema on its own. v1.1's SPEC row for P18 said "no
  schema introspection over a real connection", and D15 keeps the language service reading a DDL
  document and nothing else (D14 explains exactly where the line falls).
- **A settings surface for formatter options.** P13 OQ-3 is still open and still belongs to a
  settings phase, not here.
- **Multi-row selection in the console's *document* and *key-value* result branches.** OQ-3.
- **`FiltersDialog.vue`** (the tree's object-visibility filter) — a different feature, as P27 §1.4
  already established, with no size complaint attached to it.
- **The `keywordCase` decision itself.** P13 D4/F6 chose `'preserve'` for a real reason
  (ClickHouse's case-sensitive identifiers). D13 makes the resulting no-op *legible* rather than
  reversing the choice.
- **Retiring `sql-formatter` in favour of `@codemirror/lang-sql`'s parser.** P13 OQ-5 raised it for
  v1.1 P18, which did not take it. Reopening a bundler/dependency question in the middle of a
  five-item user batch is the wrong place; recorded as OQ-5 below.

---

## 1. Findings

Every claim below was read against `c13b8af` in this worktree. Where a claim is a behaviour rather
than a citation, the paragraph says how it was checked.

### F1 — The dialog has two steps with two different widths, and that is by design (item 1)

`project/ConnectionDialog.vue:399` sets `:width="step === 'engine' ? 620 : 560"` and `:max-height=
"80vh"`. The two numbers come straight out of two separate design-system artboards:
`docs/design/kira-design-system/parts/bodies/NewConnection.html:6` (`max-width: 620px`) and
`.../ConnectionDialog.html:3` (`max-width: 560px`). They were drawn as two screens, never as two
states of one live dialog a user flips between in place — which is what step 1 → step 2 → "Change
engine" → step 1 actually is (`:190`, `:416`, `:431`). **This is the single largest size change the
dialog makes**, and no amount of pinning the tabs removes it.

### F2 — Step 2's tabs, sub-tabs and per-engine bodies, enumerated (item 1)

`activeTab` is `'General' | 'Advanced' | 'Pre-connect'` (`:89-93`, added by P28 §4.2). `.tab-pane`
carries `min-height: 240px` with a comment that already names this exact problem — *"Keeps the
dialog from resizing under the cursor when switching tabs — the same concern DialogFrame.vue's own
fixed height records for SettingsDialog"* (`:949-956`). A **floor is not a fix**: any pane taller
than 240px still sets its own height.

The full combination surface, read off the template rather than guessed:

| Step | Tab | Sub-tab / variant | What is in the pane |
|---|---|---|---|
| 1 Engine | — | — | search field + a 3-column grid of 10 tiles (4 rows). **Also varies within the step**: `filteredKinds` (`:206-210`) shrinks the grid to 1-4 rows as the user types in the search box (`:437-444`). |
| 2 Details | General | Fields · network (postgres/mariadb/mysql/clickhouse/mongodb/redis/kafka) | name+colour row, min-version note, Mode switch, host+port row, database, user+password row |
| 2 | General | Fields · file (`FILE_KINDS` = sqlite, `:355`) | name+colour row, Mode switch, one Database-file row with a Browse button. **No** host/port/user/password. |
| 2 | General | Fields · AWS (`AWS_STYLE_KINDS` = sqs, s3, `:350`) | name+colour row, Mode switch, Region + AWS-profile row. **No** min-version note (`MIN_SERVER_VERSION` is absent for these two, `:201-204`), no database, no password. |
| 2 | General | **Connection URI** (the `.segmented` Fields/URI switch, `:527-546`) | name+colour row, Mode switch, one URI field + a one-line parse note |
| 2 | Advanced | SQL kinds | Read-only checkbox + 1-line helper, **auto-explain checkbox + a 4-line helper** (`:678-687`), throttle field + 3-line helper |
| 2 | Advanced | non-SQL kinds | the same minus auto-explain (`isSqlKind`, `:362`) |
| 2 | Pre-connect | no text typed | label, 4-row textarea, 2-line helper |
| 2 | Pre-connect | text typed | the above **plus** a warning line (`:728-731`) **plus** a `preconnectSidecar` checkbox with a 3-line helper (`:735-744`) — three elements that appear only once the textarea is non-empty |

So: **two steps × three tabs × two General sub-tabs × three engine families**, plus one pane that
grows as you type into it. Advanced-on-a-SQL-kind is the tallest of the step-2 panes (~234px of
content at the default 12px font, by the block arithmetic in D2); Pre-connect-with-text is the
second; the URI sub-tab is the shortest.

### F3 — Four more height-varying elements that are not tab content (item 1)

All of them sit in the same scrolling `.dialog-body`, so each also moves the dialog's own height
today:

1. `fieldErrors.*` lines (`:520`, `:566`, `:590`, `:704`, `:733`) — appear on a failed Save.
2. `connectionsState.dialog.error` (`:747-752`) — appears on a failed save round trip.
3. The credential note (`:760-780`) — one `<p>` line, a 2-line `MessageStrip`, or a 3-line one,
   depending on `secretStatus`; **and nothing at all for a file kind**.
4. `minVersionNote` (`:522-524`) — present for eight kinds, absent for SQS and S3.

### F4 — `DialogFrame` already has the mechanism, and one dialog already uses it (item 1)

`theme/primitives/DialogFrame.vue:11-12` documents the two modes in its own header comment:
*"`height` vs `maxHeight`: most dialogs size themselves to their content up to a cap (`maxHeight`);
SettingsDialog's two-pane layout instead needs a constant height so switching sections never
resizes the window (`height`, in px). Pass exactly one."* `workbench/SettingsDialog.vue:247-248`
passes `:width="780" :height="560"`. So item 1 needs **no new primitive** — only the right two
numbers on the existing props.

### F5 — The filter/order pair the row describes is in the Mongo *collection* view, not the console (item 2)

`views/console/ConsoleView.vue` (806 lines, read in full) has a toolbar of Run / Run all / Format /
Explain / a new-result toggle / Saved queries / Find, a CodeMirror editor, a result strip and a
result grid. **There is no filter input and no order input anywhere in it.** v1.1 P27's own §1.4
recorded the same conclusion from the same file.

The adjacent filter + `SORT` pair is `views/documents/DocumentView.vue:640-686` — the Mongo
collection view's `#toolbar-2` slot: a history button, a filter `AutocompleteField`
(`data-testid="document-search"`, `:659-667`), a `SORT` `AutocompleteField`
(`data-testid="document-sort"`, `:670-681`), and a Clear button. This is the surface item 2 is
about. (The SQL equivalent is `views/grid/FilterToolbar.vue`'s WHERE/ORDER BY pair, which is the
reference F8 measures against.)

### F6 — The render half is real, and P27 §1.2 is where it comes from (item 2)

The two boxes, side by side, at `c13b8af`:

```html
<!-- DocumentView.vue:659-667 -->
<AutocompleteField
  v-model="searchText"
  placeholder="Filter (e.g. { name: 'a' })"
  data-testid="document-search"
  :candidates="filterCandidates" language="mongo"
  @enter="onSearchInput" @blur="onSearchInput" />

<!-- DocumentView.vue:670-681 -->
<AutocompleteField
  v-model="sortText"
  prefix="SORT"                          <!-- ← -->
  :prefix-active="!!tab.state.sort"      <!-- ← -->
  placeholder="{ createdAt: -1, name: 1 }"
  v-tooltip="'Mongo sort document: 1 = ascending, -1 = descending'"   <!-- ← -->
  data-testid="document-sort"
  :candidates="sortCandidates" language="mongo"
  @enter="onSortInput" @blur="onSortInput" />
```

The filter box has **no `prefix` label at all**, so there is nothing on it that can light up. It is
the *only* filter/sort surface in the whole app in that state, and it is that way on purpose: v1.1
P27's plan §1.2 checked this exact box and wrote *"the filter box genuinely has no label to
recolour today … so per this phase's own rule … that box is left alone. Only `SORT` gets the fix."*

The user's words — *"renders … as inert placeholder text"* — describe precisely what is left: a box
whose only visible chrome is a grey `Filter (e.g. { name: 'a' })` placeholder, rendered in
`--kira-fg-disabled` by `primitives.css:167-169`, sitting next to a box that has a real label which
turns blue when its value is applied. It reads as a hint, not as a control. Two aggravating
factors, both checked in source:

- Once you type into it, the value is **not** drawn by the `<input>` at all. `language="mongo"`
  makes `AutocompleteField`'s `showOverlay` true (`:78-80`), which puts `color: transparent` on the
  real input (`:496-501`) and paints the text through a read-only `CodeMirrorHost` behind it. For
  `{ name: 'a' }`, `editor/languages.ts`'s hand-written `mongoToken` classifies `{`/`}`/`:` as
  brackets/punctuation (`--kira-syntax-punctuation`, `#cccccc`) and `name` as a `variableName`
  (`--kira-syntax-name`, `#9cdcfe`) — i.e. the applied filter is painted in the same greys and pale
  blues as ordinary chrome, with no state cue anywhere in the box.
- `tab.state.search` is a `string` with `''` for "no filter" (`packages/shared/domain/tabs.ts`'s
  `documentTabStateSchema`; `state.ts:98` reads `tab.state.search.trim() === '' ? null : …`), not
  the `SortSpec | null` the sort field has. So even the *shape* of "is it on" differs between the
  two boxes today, which is why nothing was ever wired.

### F7 — The behave half is not reproducible (item 2)

Traced end to end and checked against the suite:

- `@enter`/`@blur` → `onSearchInput` (`DocumentView.vue:144-147`) → `setSearch(tab.id, text)`
  (`views/documents/state.ts:241-251`) → `resetTokens`, clears `rt.count`, `patchDocumentTabState({
  search, pageIndex: 0 })`, `void load(tabId, …)`.
- `load` sends `filter: tab.state.search.trim() === '' ? null : tab.state.search`
  (`state.ts:98`, and again for the count at `:147`).
- Go side: `internal/adapters/mongo/read.go:59` → `ParseFilterObject(req.Filter)`, whose own header
  comment (`read.go:19`) says it must accept whatever the UI emits and which goes through
  `ParseJSON5Literal` — so the placeholder's own `{ name: 'a' }` (unquoted key, single quotes) is
  valid input, not a silently-dropped parse failure. A genuinely unparseable filter fails the load
  and surfaces in `document-error` (`DocumentView.vue:689-691`), so there is no silent path either.
- **A passing end-to-end test already covers it**: `tests/ui/autocomplete.spec.ts:288-300` fills
  `[data-testid="document-search"]` with `{ name: 'widget-1' }`, presses Enter, and asserts
  `document-row` has count 1.

This phase says so plainly rather than inventing a mechanism to match the report's wording.

### F8 — Three real wiring gaps, measured against `FilterToolbar.vue` (item 2)

`views/grid/FilterToolbar.vue` is the same row for SQL, and it has three things the Mongo row does
not. Each one produces behaviour a user can reasonably describe as the filter "doing its own thing":

1. **No no-op guard on blur.** `FilterToolbar.applyWhere` (`:73-80`) opens with *"A blur fires on
   every focus loss, not just an edit — re-applying an unchanged WHERE would reset paging/count for
   no reason (and, worse, race an in-flight runCount for this same filter)"* and returns early when
   the value is unchanged. `DocumentView.onSearchInput` has no such check, and `setSearch`
   unconditionally resets `pageIndex` to 0, throws away `rt.count`, issues a fresh `load()` and
   writes a `queriesHistoryRecord` entry. So clicking into the Mongo filter and clicking away
   again — typing nothing — silently repages the collection, discards a just-run exact count, and
   duplicates a history entry. The same is true of `onSortInput`/`setSort`.
2. **No `@escape` revert.** `FilterToolbar` binds `@escape` on *both* boxes (`:150`, `:164`) to
   restore the field from `tab.state` and blur. Neither Mongo box binds it, so Escape inside them
   does nothing after the completion popup has closed.
3. **No resync watcher.** `FilterToolbar` watches `tab.state.filter` and `tab.state.sort` with
   `immediate: true` and a five-line comment explaining that `patchDataTabState` mutates
   `tab.state` **in place**, so a non-deep watch on `tab` itself never sees it (`:43-64`) — the bug
   that let a header-click sort be clobbered by a stale ORDER BY box. `DocumentView` seeds
   `searchText`/`sortText` **once** (`:142`, `:162`) and only re-writes them from its own two
   handlers (`onClearFilter`, `applyFromFilterHistory`). Today no third writer exists, so this is
   latent rather than live — but it is the same divergence, one code path away.

Gaps 1 and 2 affect **both** Mongo boxes equally; only F6's label/tooltip asymmetry is
filter-specific. D5 fixes all of it, because "parity with the order input's own wiring" is what the
row asks for and the order input is itself short of the SQL row it was copied from.

### F9 — What "copy" already means in this app, and what the console has (items 2, 3)

| Surface | Copy affordances today | Where |
|---|---|---|
| SQL data grid — cell | Copy, Copy with header, **Copy as JSON** (`JSON.stringify(text)`) | `views/grid/menu.ts:177-199` |
| SQL data grid — rows | Copy rows ▸ TSV / CSV / **JSON** / INSERT | `menu.ts:276-307`, formats in `views/grid/clipboardFormats.ts` (`rowsToTsv`/`rowsToCsv`/`rowsToJson`/`rowsToInsert`) |
| SQL data grid — column | Copy column name; column-selection copy via `columnsToTsv` | `menu.ts:408-411`, `SlickGridHost.vue:1614` |
| SQL data grid — keyboard | ⌘/Ctrl+C over the current selection, all four selection kinds | `SlickGridHost.vue:1584-1615`, `:1707-1722` |
| Mongo collection view — row | Copy document (**shell** form: `ObjectId(…)`, not JSON), Copy _id | `views/documents/menu.ts:55-71` |
| **Console result grid — any branch** | **nothing** | — |

Two things follow. First, **`rowsToJson` already exists** — "copy as json" is a promotion of an
existing format to a new surface, not a new formatter. Second, the console result grid has no
context menu and no clipboard path at all, in any of its three branches; the only thing a click
does there is publish one cell into the read-only cell-editor dock (`ConsoleSlickGrid.vue:334-369`,
`ConsoleResultGrid.vue:209-232`).

Note also that *"Copy document"* in the Mongo collection view deliberately copies the **shell**
form (`menu.ts:59-61`, P27 D12), which is not JSON. So there is no canonical-JSON copy for a Mongo
document anywhere in the app today, in either surface.

### F10 — A document result's body is already canonical extended JSON (item 2)

`views/shared/document/ejson.ts:1-4`: *"Parses one document body — canonical extended JSON,
`read.ts`'s `EJSON.stringify(doc, {relaxed: false})`"*. `toShellText(body)` (`:328`) is the
conversion *away* from JSON. So "copy as JSON" is the body verbatim; the only decision left is
whether to re-indent it (D6).

### F11 — What the console's tabular grid has instead of a selection model (item 3)

`views/console/ConsoleSlickGrid.vue:330-333` states the decision it inherited:

> `§3.4: no SlickHybridSelectionModel (a console result never has more than one cell selected at
> once — P43 iter2 D22's own finding, carried over) — enableCellNavigation: true (below) plus this
> click handler plus a single-entry setCellCssStyles layer give the same visual result at O(1)`

Concretely, the console grid has: `enableCellNavigation: true` (`:459`), one `onClick` handler
(`:334-369`) that tracks `selectedRow`/`selectedField` as plain `let`s and paints a one-entry
`kira-cell-selected` layer, a gutter that is explicitly `focusable: false, selectable: false`
(`:150-151`, commented *"the gutter alone is unselectable/unfocusable ('nothing selects a row
here')"*), every column `sortable: false` (`:180`), and **no** `onContextMenu`, `onKeyDown` or
`onHeaderClick` subscription (`:475-478` lists all three subscriptions: `onRendered` ×2 and
`onClick`).

### F12 — What the data grid has, and how much of it is reusable (item 3)

`views/grid/SlickGridHost.vue:1922-1955`:

```ts
selectionModel = new SlickHybridSelectionModel({
  selectionType: 'mixed', rowSelectColumnIds: [GUTTER_FIELD],
  selectActiveCell: true, selectActiveRow: true,
  dragToSelect: true, autoScrollWhenDrag: true,
  enableMultiSelection: false, showDragHandle: false,
});
grid.setSelectionModel(selectionModel);
… eventHandler.subscribe(selectionModel.onSelectedRangesChanged, onSelectedRangesChanged);
const cellRangeSelector = selectionModel.getCellRangeSelector();
if (cellRangeSelector) eventHandler.subscribe(cellRangeSelector.onCellRangeSelecting, onCellRangeSelecting);
```

plus `selectedCellCssClass: 'kira-cell-selected'` and `multiSelect: true` in the grid options
(`:1852-1855`), the pure `selectionFromRanges`/`rangesFromSelection` pair in
`views/grid/slick/selection.ts` (132 lines, already documented as *"pure functions, unit-testable
without a DOM"*), and `onCopy` (`:1584-1615`) which branches on the four `Selection` kinds. Nothing
in `selection.ts` or `clipboardFormats.ts` knows anything about a data tab: `selection.ts` is pure
geometry, and `clipboardFormats.ts` takes a `cellAt(row, col)` callback rather than reaching into a
page cache. **Both are reusable as-is.**

The parts that are *not* reusable are the data-tab-shaped ones: `rt().selection` lives in
`views/grid/state.ts` and round-trips through pending edits, paste, delete and duplicate; the
header select-zone exists because a header body click means *sort*; `rowSnapshot` reads staged
values. The console needs none of them.

### F13 — The promotion is mandatory, not stylistic (item 3)

`biome.json:78-100` makes `views/<kind>/*` importing another `views/<kind>/*` an **error**, with
the message *"SPEC §11: views/<kind>/* must not import another views/<kind>/* — use views/shared/
instead."* The pattern list names `../grid/**` and `../../grid/**` explicitly. Confirmed by grep:
nothing outside `views/grid/` imports from it today. So `clipboardFormats.ts` and
`slick/selection.ts` must **move** to `views/shared/` before the console can use them — `bun run
lint` will fail otherwise. This is the same "promote when a second consumer appears" move P18 made
for `ColorPicker` (→ `theme/primitives/`) and `variableCompletion.ts` (→ `api/state/`).

### F14 — The console's gutter has to change flags for row selection (item 3)

`SlickGridHost.vue:388-393` records why, and the reason transfers verbatim: *"changed from Pass A's
false/false: F1's row-select-on-gutter (§5 D4, C4) requires `canCellBeActive(row, 0)`, which
`handleClick`'s row branch checks (slick.hybridselectionmodel.ts:497). Tab/Left-arrow landing on
the gutter is the one side effect."* The console gutter is currently `focusable: false, selectable:
false` (F11) and must become `true/true`.

### F15 — Column selection is *simpler* in the console than in the data grid (item 3)

The data grid needs a dedicated `.header-select-zone` element, built in `onHeaderCellRendered`,
because a plain header body click already means "cycle this column's sort"
(`SlickGridHost.vue`'s `onHeaderClick`/`cycleSortFor`). The console grid has **no sort at all** —
every column is `sortable: false` (`ConsoleSlickGrid.vue:180`) and there is no re-query path — so
`grid.onHeaderClick` is free and a plain header click can be the column-select gesture, with no new
DOM and no `onHeaderCellRendered` subscription. Recorded so the implementation does not port
machinery it does not need.

### F16 — `sql-formatter@15.8.2` works; a twenty-case battery was run in this worktree (item 4a)

`bun install` in this worktree, then `formatDialect(sql, { dialect, tabWidth: 2, useTabs: false,
keywordCase: 'preserve', identifierCase: 'preserve', linesBetweenQueries: 1 })` — the exact options
`views/console/format.ts:52-58` passes — over twenty statements. Results:

| Input | Result |
|---|---|
| `select id from users` | ✅ |
| `select id from ` (mid-typing, incomplete) | ✅ |
| `select data->>'name' from events where data @> '{"a":1}'` | ✅ |
| `select id::text from users` | ✅ |
| `create function f() returns int as $$ begin return 1; end $$ language plpgsql` | ✅ (dollar-quoted body kept whole) |
| `with x as (select 1) select * from x` | ✅ |
| `select row_number() over (partition by a order by b) from t` | ✅ |
| `insert into t (a) values (1) on conflict (a) do update set a = 2` | ✅ |
| `select array[1,2,3]` · `select * from a, lateral (select 1) b` | ✅ |
| `-- just a note` (comment only) | ✅ |
| `select a, from t` (trailing-comma typo) | ✅ |
| `delete … returning *` · `explain analyze select 1` · `select distinct on (a) …` · `count(*) filter (where a)` · `tablesample bernoulli (10)` | ✅ |
| MySQL/ClickHouse: backticks, `limit/offset`, `FINAL`, `SETTINGS` | ✅ (all four, both dialects) |
| **`\dt`** (a psql meta-command) | ❌ `Parse error: Unexpected "\dt" at line 1 column 1.` |
| **`select 'abc`** (unterminated string) | ❌ `Parse error: Unexpected "'abc" at line 1 column 8.` |
| **`select 1; \dt`** | ❌ `Parse error: Unexpected "\dt" at line 1 column 11.` |

The last row is the important one and F18 is about it. The library itself is not the problem.

### F17 — Three "the formatter is broken" theories, each checked and excluded (item 4a)

1. **The lazily-imported chunk stopped resolving after the Rolldown migration.** `git log` order:
   `62258b8` (the dependency + chunk) and `05b9206` (P13's Format button) landed 2026-09-01;
   `a490874 chore(deps): move the frontend build to Vite 8 (Rolldown)` landed 2026-09-02, i.e.
   after. So the ordering makes the theory *possible*. It is excluded on a different ground: the
   only difference between the build `tests/ui` runs (`build:test`) and the packaged build is the
   `__KIRA_DEBUG_HOOKS__` define (`frontend/vite.config.ts:16`, `:36-38`) — same bundler, same
   `rolldownOptions`, same `base: './'`. If the chunk failed to resolve, `tests/ui/
   console-format.spec.ts:171-207` would fail, not just the packaged app. (A full build could not
   be run here to double-check: `frontend/bindings/` is generated by `wails3`, which is not
   installed in this Linux sandbox; `go` is.)
2. **A command-id collision.** Both `views/console/ConsoleView.vue:347` and
   `views/grpcrequest/GrpcRequestView.vue:228` call `registerCommand('view.format', …)`, and
   `shortcuts/commands.ts` is a bare `Map` where the last registration wins. Excluded:
   `workbench/panels/MainView.vue:13` mounts **one** `<component :is="TAB_VIEWS[activeTab.kind]"
   :key="activeTab.id">`, so exactly one view is ever mounted, across both modes — which is the
   invariant `commands.ts`'s own header comment already states. Only one handler can be registered
   at a time.
3. **`setText` not reaching the editor.** `views/console/state.ts:250-252` → `patchConsoleTabState`
   → `patchTabState` (`state/tabs.ts:566-577`), which `Object.assign`s into the existing reactive
   `state` object in place, so `ConsoleView.vue:229-236`'s `watch(() => props.tab.state.text)`
   fires, `localDoc` updates, and `CodeMirrorHost.vue:293-308`'s `doc` watcher dispatches. Excluded.

**Honest conclusion: no literal "Format does nothing" state was reproduced.** What was found is
F18 and F19 — two of them written down by P13 itself and deferred.

### F18 — Format is all-or-nothing across the whole document, and P13 declined the alternative (item 4a)

`format.ts:130-140`: `formatConsoleText` hands the **entire** console text to `formatDialect` in one
call. P13 §3's "Checked, and not fired" list contains:

> **Reusing `packages/shared/domain/sql-split.ts` to format statement-by-statement.** Unnecessary:
> `sql-formatter` handles a multi-statement document itself, keeping each `;`, separating statements
> with a blank line, and (F5) leaving a dollar-quoted body's inner `;` alone — better than the app's
> own splitter would.

That is true of the *output* and wrong about the *failure mode*, which the plan did not consider: a
console document is a scratchpad, and one fragment the grammar rejects — a psql meta-command, a
half-typed statement, a vendor construct — takes the whole press down with it (F16's last row: `\dt`
after a perfectly good `select 1` fails both). The user sees the document unchanged and a one-line
strip about a token at a column number they may not even be looking at. That is the shape of "the
Format button doesn't work".

For Mongo the same all-or-nothing rule is *explicit*: `formatMongo` (`format.ts:118-127`) returns
`{ ok: false }` on the first statement that isn't `db.<collection>.<method>(…)`.

### F19 — Two more silent no-ops on the same button (item 4a)

- **`keywordCase: 'preserve'`** (P13 D4/F6, `format.ts:52-58`, kept for a good reason — `'upper'`
  rewrites an unquoted identifier that collides with a keyword, which is wrong for ClickHouse). The
  consequence is that Format only ever changes *whitespace*. Pressing it on an already-indented
  document produces byte-identical text, and `ConsoleView.onFormat` (`:276-292`) then takes the
  `ok` branch and says nothing at all. Nothing distinguishes "already formatted" from "the button
  is dead".
- **The caret jumps to offset 0**, and with it `cursorPos`, and with *that* what *Run statement*
  targets. This is `CodeMirrorHost.vue:301-306`'s external-sync dispatch (`selection: { anchor: 0 }`
  plus `view.scrollDOM.scrollTop = 0`), accepted knowingly by **P13 D8** and handed forward as
  **P13 OQ-2**:

  > **OQ-2 — The caret jumps to offset 0 on every format** (D8), which also resets what *Run
  > statement* targets. Fixing it properly means teaching `CodeMirrorHost`'s external-write path to
  > preserve a selection, which changes behaviour for the cell editor, the document editor and the
  > definition viewer too. Worth doing once, deliberately, for all five surfaces — not as a side
  > effect of this phase. **For P17/P18:** P18's language server will want the same thing.

  Neither v1.1 P17 nor v1.1 P18 picked it up. `git log -L 293,308:editor/CodeMirrorHost.vue` shows
  the last three commits to touch that block are `faea116`, `1d93a81` and `83a02c7` — all of them
  **before** P13 (`05b9206`), so this is a standing gap rather than a regression, and the plan says
  so.

### F20 — What actually feeds SQL table/column completion (item 4b)

The chain, read top-down:

1. `ConsoleView.vue:96-108` → `consoleCompletionSources(kind, connectionId, path, ddlSchema.value,
   database)`.
2. `views/console/completion.ts:150-162` — for a SQL kind: `if (dialect && schema) return
   sqlCompletionSources(dialect, schema, database); return undefined;`.
3. `views/console/sqlLanguageService.ts:29-49` — **`if (schema.tables.length === 0) return
   undefined;`**, else `[schemaCompletionSource({…toSqlNamespace(schema)…}),
   keywordCompletionSource(dialectObject, true)]`.
4. `undefined` reaches `CodeMirrorHost.vue:171` as `override: undefined`, so `autocompletion()`
   falls back to `@codemirror/lang-sql`'s language-data keyword source — **keywords only, no table
   names, no column names**.
5. `schema` is `ddlSchemaFor(connectionId, dialect)` (`state/schemas.ts:79-88`), which reads
   `schemasState.byConnection[connectionId]` — the connection's **DDL text**.

### F21 — Nothing in the app ever supplies that DDL text (item 4b)

`schemasState.byConnection` has exactly three writers (`state/schemas.ts`): `ensureDdl` (fetches
whatever the backend has stored, `:37-65`), `saveDdl` (`:67-70`), and `applyRemote` (another
window's broadcast, `:115-117`). `saveDdl`'s only caller is `project/SchemaDialog.vue`, whose only
entry point is `project/menus.ts:194-196` — a **"Schema (DDL)…"** item on a connection row's
context menu. The dialog itself says *"Paste this connection's own schema … Nothing here ever reads
from the connection itself"* and suggests the user run `pg_dump --schema-only` / `SHOW CREATE
TABLE` / `.schema` themselves (`SchemaDialog.vue:116-137`).

So on a connection where nobody has hand-pasted a schema dump — which is every connection by
default — **there is no table or column completion, at all**, and there is nothing anywhere in the
console saying why. `tests/ui/sql-schema.spec.ts:273` pins exactly this as the correct behaviour:
*"with no DDL document, the console is unchanged (D5)"*.

### F22 — The constraint is a product decision from v1.1's SPEC row, not a technical one (item 4b)

`docs/v1.1/SPEC.md`'s P18 row: *"driven purely by user-supplied DDL rather than a live database
connection — **no schema introspection over a real connection**, the user provides table/column
definitions and the language server works from those alone."* `sqlLanguageService.ts:23-28` restates
it as D5 and adds *"This is deliberate, not a gap to patch by falling back to the tree's own live
metadata cache (`runtime[tabId].meta`)"* — and, notably, ends with *"a silent fallback here would
make the DDL surface look broken whenever it's simply empty"*, which is the inverse of what actually
happened.

### F23 — The DDL parser is not the problem (item 4b)

`views/console/ddl.ts`'s `parseDdl` was run in this worktree (`bun run` against the real module,
with `dialectObjectFor` from `editor/languages.ts`) over two realistic inputs:

- A `pg_dump --schema-only` fragment — `SET`, two `CREATE TABLE public.…`, `ALTER TABLE … OWNER
  TO`, `CREATE SEQUENCE`, `ALTER TABLE ONLY … ADD CONSTRAINT … PRIMARY KEY`, an inline `REFERENCES`
  → parsed as `public.users[id,email,created_at]`, `public.orders[id,user_id,total]`; namespace keys
  `['public','users','orders']`.
- A `SHOW CREATE TABLE` fragment with backticks, `AUTO_INCREMENT`, a table-level `PRIMARY KEY`, and
  a trailing `ENGINE=InnoDB DEFAULT CHARSET=…` → parsed as `widgets[id,name]`.

Both correct, including the table-level constraint being skipped rather than emitted as a phantom
column. The autocomplete works whenever it has input.

### F24 — The app already holds, and can already produce, exactly what the parser eats (item 4b)

Two independent supplies exist today and neither is used by the language service:

1. **The project tree's own cache.** `project/state/tree.ts:59` `treeState.children` is a
   `Record<rowKey, TreeNode[]>` populated by `control.treeChildren` for every node the user has
   expanded — which, for a console opened from a table or a schema, always includes that container.
   `views/console/completion.ts:34-39` **already reads it**, for Mongo: `mongoCollectionNames` pulls
   the collection list out of `treeState.children[rowKey(connectionId, segment)]`, with the header
   comment *"F5: reads the tree's own cache — no new round trip, no new cache. Empty … is the honest
   degradation."* The SQL branch three functions below does not.
2. **`TreeService.Definition`.** `internal/bridge/tree.go:41-46` → `model.ObjectDefinition`
   (`internal/storage/model/definition.go:43-57`) whose `Statements []string` field is, for
   Postgres, literally `CREATE SEQUENCE …`, `CREATE TABLE <qname> ( … )`, `ALTER TABLE … ADD
   CONSTRAINT …`, `CREATE <VIEW|MATERIALIZED VIEW> … AS …`, `COMMENT ON TABLE/COLUMN … IS …`
   (`internal/adapters/postgres/definition.go:200-272`). That is **exactly** the statement
   vocabulary `parseDdl` handles (`ddl.ts:327-348`: CREATE TABLE / CREATE VIEW / CREATE INDEX /
   ALTER TABLE ADD / COMMENT ON COLUMN, everything else skipped silently). The definition view
   already calls it per object.

### F25 — Columns are *not* in the tree (item 4b)

`project/state/tree.ts:355-357`: *"P19 D5: a table/view/matview is a leaf regardless of what a
cached node's own hasChildren says — **its columns moved into the definition view**"*. `NodeKind`
still lists `'column'` (`packages/shared/domain/tree.ts:16`) but nothing expands into one any more.
So F24's supply 1 yields **relation names only**; column names need supply 2. This is what makes D14
a two-layer design rather than one.

### F26 — Where P27's blue collides, with the actual values (item 5)

`theme/primitives.css:183-193` (P27 §2.2):

```css
.p-input .ph.ph-active { color: var(--kira-accent); }   /* #0078d4 */
```

Five call sites (P27 §2.4). Three of them are `AutocompleteField`s that also pass a `language`,
which turns on the read-only-CodeMirror overlay painting the field's own text through
`kiraHighlightStyle` **inside the same `.p-input` box, immediately to the right of the label**:

| Call site | Label | Overlay grammar | Colours painted beside the label |
|---|---|---|---|
| `FilterToolbar.vue:144` | `WHERE` | `language="sql"` + dialect | keyword `--kira-syntax-keyword` **#569cd6**, identifier `--kira-syntax-name` **#9cdcfe**, string #ce9178, number #b5cea8 |
| `FilterToolbar.vue:159` | `ORDER BY` | same | same |
| `DocumentView.vue:672` | `SORT` | `language="mongo"` | `--kira-syntax-name` **#9cdcfe**, punctuation #cccccc, string #ce9178 |

`#0078d4` is hue ≈ 207°; `#569cd6` is ≈ 210°; `#9cdcfe` is ≈ 202°. **All three within 8° of each
other** — the label is the same hue family as the query text it labels, which is precisely the
report: "a filter is active" is indistinguishable from "this is part of the query".

### F27 — The other two `ph-active` sites don't collide, but mean the same thing (item 5)

`StreamView.vue:666` (`offset`) and `:720` (`since`) are plain `TextField`s with no `language` and
no overlay, so accent-blue there sits against nothing. They carry the same *meaning* though — "this
view is filtered right now" — so leaving them blue while the other three change would split one
convention across two colours.

### F28 — The rest of the "this view is narrowed right now" family, also on accent (item 5)

- `theme/primitives.css:76-85` — `.p-iconbtn.has-indicator::after`, the 5px corner dot, whose own
  comment reads *"'is this deviating from default?' doesn't need a count"*. Two call sites:
  `views/grid/DataToolbar.vue:173` (columns hidden) and `views/documents/DocumentView.vue:588`
  (a projection is active).
- `views/stream/StreamView.vue:681` — the partition button's inline `color: var(--kira-accent)`
  (P27 §2.5).
- `views/shared/slick/slickTheme.css:527-529` — `.slick-sort-indicator`, the header sort chevron,
  which P27 §2.1 explicitly cited as *the* precedent for choosing accent and §0 held out of scope
  because a concurrent phase (the SlickGrid migration) owned that directory. That migration landed
  long ago; the exclusion's reason no longer exists.

`--kira-accent` is *also* `--kira-focus`'s value, the primary-button background
(`primitives.css:91-94`), the active-cell outline (`slickTheme.css:289`) and the row-header
selection fill (`:651`) — i.e. it means **"primary action / focus / selection"** everywhere else.
Overloading it with "a filter is applied" is the deeper problem; the syntax-blue collision is where
it finally became visible.

### F29 — What hue is actually free, and what the token guard requires (item 5)

Occupied by `kiraHighlightStyle` inside these same boxes: green ≈95° (#6a9955), light-green ≈95°
(#b5cea8), orange ≈22° (#ce9178), blue ≈207-210° (#569cd6, #0078d4), pale blue ≈202° (#9cdcfe),
magenta ≈305° (#c586c0), yellow ≈60° (#dcdcaa), red ≈0° (#f14c4c), greys. Also spoken for
app-wide: `--kira-warn` #cca700 (= `--kira-search-match`, the unresolved-variable colour, the
"editing" chip), `--kira-error`, `--kira-ok` #23d18b, `--kira-info` #3794ff (another blue).

The one genuinely free region is **teal/mint, ≈160-180°**. `#4ec9b0` sits at ≈168°, is VS Code Dark
Modern's own type/class token colour (so it is in the same family every other token in
`tokens.css:1` derives from), and — checked by grep across `apps/`, `packages/`, `docs/`, `scripts/`
— **appears nowhere in this repo**. Contrast against `--kira-bg-input` #313131 is ≈6.4:1 and against
`--kira-bg` #1f1f1f ≈8.4:1, both comfortably over 4.5:1.

`scripts/check-tokens.sh` (run by `bun run lint`) requires every `var(--kira-*)` reference in
`frontend/src` to resolve to a definition in `theme/{tokens,base,primitives}.css`, so a new token
must be declared in `tokens.css`, not inlined.

---

## 2. Decisions

### D1 — One width and one height for the whole dialog, both steps included (item 1)

`ConnectionDialog.vue` passes `:width="620"` and `:height="520"` — constants, no ternary, no
`max-height`. `DialogFrame` already forbids passing both `height` and `maxHeight` (F4), and
`SettingsDialog`'s `780 × 560` is the precedent.

**620, not 560.** The row asks for *one* static size, and the 620→560 jump on entering step 2 is the
largest size change the dialog makes (F1). The two numbers came from two artboards drawn as separate
screens, never as two states of one live dialog — that is the premise being reopened, deliberately,
and it is recorded here rather than left as an accident. Step 2 at 620 is strictly roomier: every
field but the port (fixed `flex: 0 0 96px`) and the colour picker is `flex: 1`, and the helper texts
wrap one line less.

*Alternative considered and rejected:* keep 560 for step 2 and pin only the step-2 tabs. It satisfies
the row's literal words ("tabs and sub-tabs") while leaving the biggest jerk in place; a user who
reports "the dialog changes size" is not going to accept "but not when you switch tabs".

### D2 — 520px, derived from the tallest pane, and pinned by a test that can move it (item 1)

The arithmetic, at the default 12px font, from the real CSS (`DialogFrame.vue:119-145`,
`primitives.css:316-321`, `:470-482`, `ConnectionDialog.vue:940-956`):

| Band | Step 1 (engine) | Step 2 (Advanced, a SQL kind) |
|---|---|---|
| title (`--kira-h-lg` 30 + 1px border) | 31 | 31 |
| body padding (`--kira-s-5` ×2) | 24 | 24 |
| tab strip (`--kira-h-md` 26 + `--kira-s-3` 6 + 1px) | — | 33 |
| body gap (`--kira-s-4`) | — | 8 |
| pane content | search 26 + gap 12 + 4 tile rows (4×74 + 3×6) = **352** | read-only block 39 + auto-explain block 84 + throttle block 95 + 2 gaps 16 = **234** |
| credential note / MessageStrip + gap | 0 | 8 + 15…34 |
| footer (46 + 1px) | 47 | 47 |
| **total** | **≈454** | **≈411** |

So step 1 is the taller of the two, at ≈454, and 520 leaves ≈66px of headroom for the elements F3
lists (a save error, a field error, the 3-line keychain-unavailable strip) without any pane
scrolling. Where content *does* exceed it, `DialogFrame`'s `.dialog-body { overflow: auto }`
(`:131-135`) scrolls — the dialog still does not resize, which is the property being bought.

This arithmetic is a starting number, not a measurement: this sandbox cannot render the app (F17).
T2's test is what pins it, and it asserts **both** halves — that the rect is identical across every
combination, *and* that no pane's `scrollHeight` exceeds its `clientHeight` — so an off-by-a-few-px
constant is caught by the test rather than shipped. This is exactly what happened in P16, where
*"a header-chrome constant `tests/ui`'s own new D4 case caught 8px short"*.

`.tab-pane`'s `min-height: 240px` (`ConnectionDialog.vue:949-956`) is **removed**: with a fixed
dialog height it is a floor under a constant, and leaving it in would hide a future pane growing
past 240px behind a rule that no longer does anything.

### D3 — The engine grid stops changing height as you search (item 1)

`filteredKinds` (`:206-210`) shrinks the tile grid from four rows to one as the user types. With a
fixed dialog height that no longer resizes anything, but it does leave the grid jumping around
inside a fixed box. The grid gets `align-content: start` and the `.engine-body` gets `flex: 1;
min-height: 0` so filtering collapses upward from a stable top edge rather than re-centring. No
placeholder tiles, no reserved rows — the empty space below is honest.

### D4 — The Mongo filter box gets the order box's own label wiring, and `FILTER` is the word (item 2)

```html
<AutocompleteField
  v-model="searchText"
  prefix="FILTER"
  :prefix-active="tab.state.search.trim() !== ''"
  placeholder="{ name: 'a' }"
  v-tooltip="'Mongo filter document — the query find() runs'"
  … />
```

Four points:

- **`FILTER`, not `FIND` or `WHERE`.** `FilterToolbar` labels the SQL row's boxes with the SQL
  clause names (`WHERE`, `ORDER BY`); `DocumentView` labels its sort box `SORT`, not `ORDER BY`,
  because the value is a Mongo sort document. The same logic gives the other box `FILTER`: it is a
  Mongo filter document, and `db.c.find(<filter>)` is what it becomes.
- **`prefix-active` reads the persisted field**, not the live buffer — P27 §1.1's own rule, and the
  same reason its five call sites all read `tab.state.*`. `tab.state.search` is a `string`, so the
  test is `.trim() !== ''` rather than `!!` (F6): a filter of `'   '` is not an applied filter, and
  `state.ts:98` already treats it that way when building the request.
- **The placeholder loses its `Filter (e.g. …)` prefix**, because the label now says that. This
  matches every other box in the app: `WHERE`'s placeholder is `status = 'paid'`, not
  `Filter (e.g. status = 'paid')`.
- **A tooltip**, mirroring the sort box's own, so the two are symmetric in every respect a user can
  see.

`data-testid="document-search"` is **kept** — `tests/ui/autocomplete.spec.ts:281` uses it, and
renaming it for tidiness would churn a passing spec for nothing.

### D5 — Both Mongo boxes get the three behaviours `FilterToolbar` has (item 2, F8)

The row asks for "parity with the order input's own wiring"; the order input is itself short of the
SQL row it was copied from, so parity is taken as *the shape both boxes should have had*:

1. **A no-op guard.** `onSearchInput` returns early when the trimmed value equals
   `tab.state.search`; `onSortInput` returns early when `parseSortText(sortText)` serialises to the
   same text as `sortSpecToText(tab.state.sort)` (comparing the *text* form, not the object, since
   `SortSpec` is a structure and `Object.is` would never match). This is `FilterToolbar
   .applyWhere`'s own guard and its own reason: a blur is not an edit, and re-applying an unchanged
   value throws away `rt.count` and repages for nothing.
2. **`@escape`.** Both boxes bind `@escape` to restore the field from `tab.state` and blur the
   active element — `FilterToolbar.onWhereEscape`/`onOrderByEscape` verbatim, including their
   comment about `AutocompleteField`'s `@escape` only firing once the popup has already closed.
3. **A resync watcher.** Two `watch(() => props.tab.state.search / .sort, …, { immediate: true })`
   blocks replacing the one-shot `ref(…)` seeds, carrying `FilterToolbar:43-51`'s own explanation of
   why a non-deep watch on `tab` cannot work. `onClearFilter` and `applyFromFilterHistory` then stop
   assigning the text refs by hand — the watcher does it — which also removes the one place the two
   could drift.

### D6 — "Copy as JSON" copies the document body verbatim, pretty-printed; the whole result copies as an array (item 2)

For the console's **document** result branch (a Mongo `find()`/`aggregate()` result) and, for
parity, the Mongo collection view's own row menu:

| Item | Copies |
|---|---|
| `Copy document` (existing, collection view only) | `toShellText(body)` — unchanged, P27 D12 |
| **`Copy as JSON`** (new, both surfaces) | the row's `body` — already canonical extended JSON (F10) — re-indented through `beautify.ts`'s JSON scanner, falling back to the raw body if it does not scan |
| **`Copy all as JSON`** (new, console result only) | `[` + every row's body in the result's current display order, comma-joined, indented + `]` |
| `Copy _id` (existing) | unchanged |

Two decisions inside that:

- **Canonical extended JSON, not relaxed and not shell.** It is what the app already has in hand
  (no re-encode, no `bson` import — `ejson.ts`'s own header rule), it round-trips losslessly, and it
  is what `mongoimport`/`mongosh` accept. A "copy as relaxed JSON" variant would need a second
  encoder for a format that loses `$numberLong` precision; not built.
- **"All" means the rows currently displayed**, i.e. `rowIndices` / `documentRows` — which under an
  active find-filter is the filtered subset. Same rule `columnsToTsv`'s own callers already follow
  ("only the rows actually visible under the current filter", round-2 finding 3 in
  `clipboardFormats.ts:20-24`). Copying rows the user cannot see would be the surprise.

Every copy goes through `documents/menu.ts`'s existing `copyOrReportError` shape — `copyText` is a
promise `ContextMenu.vue` never awaits, so a rejection must be caught at the item (its own comment
says so). The console has no `actionError` field, so its failures land in the same
component-local strip pattern `formatError` uses (P13 D9's precedent).

### D7 — `clipboardFormats.ts` and `slick/selection.ts` move to `views/shared/`, unchanged (item 3)

Mandatory, not stylistic (F13). Both move verbatim; the `Selection` type moves from
`views/grid/state.ts` into `views/shared/slick/selection.ts` (the file that already owns its
geometry, and whose doc comment already describes the type). `views/grid/state.ts` re-exports
`Selection` so nothing outside the move has to change its import. This is one pure-refactor commit
(T5) with no behaviour change, landing before anything consumes it — the same discipline P18 used
for `variableCompletion.ts`.

`rowsToInsert` moves with the rest even though only the data grid uses it: splitting one small module
in half to keep an unused export behind would leave two files where the app has one clipboard
vocabulary.

### D8 — The console's tabular result gets the data grid's selection model, configured identically (item 3)

`ConsoleSlickGrid.vue` gains, mirroring `SlickGridHost.vue:1852-1855` and `:1922-1932`:

```ts
// grid options
selectedCellCssClass: 'kira-cell-selected',
multiSelect: true,
// after construction
selectionModel = new SlickHybridSelectionModel({
  selectionType: 'mixed', rowSelectColumnIds: [GUTTER_FIELD],
  selectActiveCell: true, selectActiveRow: true,
  dragToSelect: true, autoScrollWhenDrag: true,
  enableMultiSelection: false, showDragHandle: false,
});
grid.setSelectionModel(selectionModel);
```

plus the gutter flipping to `focusable: true, selectable: true` (F14, carrying that finding's own
comment), plus `eventHandler.subscribe(selectionModel.onSelectedRangesChanged, …)`.

**Identical configuration, deliberately.** The row's own words are "rows, columns, or an arbitrary
free-form cell range" — which is exactly the four-kind `Selection` model the data grid already has,
and the SPEC's framing ("so the query console doesn't reinvent a different selection model than the
app's main grid uses") is the constraint. `enableMultiSelection: false` carries over for the same
reason it was chosen there: `Selection` has no shape for a disjoint multi-cell selection.

Three console-specific consequences:

1. **`selectionFromRanges`'s `rowMode`/`pendingKind` arguments are in *display-position* space**,
   and the console already has the translation (`dataSource.getItem(pos).row`, `displayPositionOf`).
   The console's existing `matchedRows` filter watch (`:534-545`) must clear the selection when the
   filter changes, for the same reason `ConsoleResultGrid.vue:164-167` already clears the one-cell
   highlight: a row index into a page that has been replaced identifies nothing.
2. **The existing one-cell `kira-cell-selected` layer and `refreshSelectionLayer` are removed.**
   `selectedCellCssClass` makes SlickGrid's own selection layer *be* the paint (the same swap
   `SlickGridHost.vue:1851-1853` records). Keeping both would paint two overlapping highlights.
   The `onClick` handler keeps its other job — publishing into `cellSelection` for the read-only
   cell-editor dock — and drops its `selectedRow`/`selectedField`/`setCellCssStyles` bookkeeping.
3. **Column selection is a plain header click** (F15): `grid.onHeaderClick` sets a one-shot
   `pendingKind = 'column'` and calls `selectionModel.setSelectedRanges(rangesFromSelection({kind:
   'column', cols:[i]}, …))`, exactly the one-shot-flag shape `selection.ts:22-25` documents. No
   `.header-select-zone`, no `onHeaderCellRendered` subscription.

### D9 — Copy is ⌘/Ctrl+C plus a context menu, and it is format-aware (item 3)

`ConsoleSlickGrid` subscribes `grid.onKeyDown` and `grid.onContextMenu`, mirroring
`SlickGridHost.vue:1707-1722` and `:1560-1574`:

| Selection kind | ⌘C copies | Context menu offers |
|---|---|---|
| `cell` | the cell's text (`''` for NULL) | Copy · Copy with header · **Copy as JSON** (`JSON.stringify(text)`) |
| `range` | `columnsToTsv(visible rows in span, cols, cellAt)` | Copy (TSV) · Copy as CSV · **Copy as JSON** |
| `row` | `rowsToTsv(snapshots)` | Copy rows ▸ TSV / CSV / **JSON** |
| `column` | `columnsToTsv(all visible rows, sel.cols, cellAt)` | Copy column · Copy column name |

`cellAt` is a thin wrapper over the console's existing `cell(pageKey, row, col)`
(`resultPages.ts`), which is the same `{text, isNull, truncated}` shape `clipboardFormats.ts`'s
`CellText` already takes. A row snapshot is `{ columns: page.columns.map(c => c.name), values }` —
the console has no staged edits, so unlike the data grid's `rowSnapshot` there is no
pending-changes layer to consult.

**No `Copy as INSERT`.** `rowsToInsert` needs a qualified table name to write into; a console result
comes from ad-hoc SQL with no addressable table (the same reason `ConsoleSlickGrid`'s own
`publishSelectedCell` call leaves `onEdit` unset, `:365-368`). Offering it would produce a statement
naming a table that does not exist.

**No paste, no delete, no duplicate.** A console result is read-only by construction — the whole
`editable: false / autoEdit: false` block at `:461-465` — and every one of those verbs writes.

The menu builders live in a new `views/console/resultMenu.ts`, mirroring `views/grid/menu.ts`'s own
split (builders in a plain module, the host only opens them). That is also where D6's document and
key-value menus go, so the console has one menu file rather than three inline `openContextMenu`
calls.

### D10 — The gutter's row-number click selects the row, and the header's click selects the column — both without a new testid convention (item 3)

`ConsoleSlickGrid` already writes `data-testid="console-result-gutter-cell"`,
`"console-result-cell"`, `"console-result-header-cell"` and `"console-result-row"`
(`:153`, `:184`, `:189`, `:271`). Every new gesture is expressible against those, so T7's spec needs
no new attributes — only the two menus' own item ids, which follow `views/grid/menu.ts`'s naming
(`copy`, `copy-with-header`, `copy-as-json`, `copy-rows`, `copy-rows-tsv`, …) so a reader comparing
the two surfaces sees the same vocabulary.

### D11 — The document and key-value result branches get menus, not a selection model (item 3, scope)

`ConsoleResultGrid`'s other two branches render Vue component trees over `VirtualList`, not cells on
a column axis (its own §3 header comment). "Columns" and "cell range" have no meaning for either.
They get D6's copy menu on a row (`@contextmenu` on `DocumentRow` / the kv row) and the
whole-result copy, and nothing else. Multi-row selection over `VirtualList` is a genuinely separate
piece of work with no precedent in this app; recorded as OQ-3, not smuggled in.

### D12 — Format keeps the caret in the statement it was in — closing P13 OQ-2, at one opt-in seam (item 4a)

Three small pieces:

1. **`CodeMirrorHost.vue` gains one optional prop**, `keepSelectionOnExternalSync?: boolean`,
   default `false`. When true, the external-sync dispatch (`:301-306`) omits `selection: { anchor: 0
   }` and the `scrollDOM.scrollTop = 0`, clamping the existing selection instead
   (`EditorSelection.cursor(Math.min(head, doc.length))`). Off by default means the cell editor, the
   definition viewer, the document editor and the op-log rows are byte-for-byte unchanged — which is
   precisely the concern P13 OQ-2 raised as the reason not to do it as a side effect. This is the
   same additive shape `lintSource`, `hoverSource`, `rangeHighlights` and `autoCloseBrackets` all
   already have, each with an "every existing host stays exactly as it was" note.
2. **`defineExpose` gains `setCursor(pos: number)`** — one dispatch with `selection: {anchor: pos}`
   and `EditorView.scrollIntoView`. `scrollRangeIntoView` (P16 D11) is the precedent for adding a
   caller-driven imperative like this.
3. **`ConsoleView.onFormat` maps the caret across the reformat.** Before formatting it computes
   `before = splitSqlStatements(text, …)` and finds the index `i` of the statement containing
   `cursorPos`; after `setText` it computes `after = splitSqlStatements(result.text, …)` and calls
   `editorHost.setCursor(after[i]?.start ?? 0)` on `nextTick`. `SqlStatement` already carries
   `start`/`end` (`packages/shared/domain/sql-split.ts:7-12`), and `statementAtCursor` already
   exists for the containment test — no new parsing.

Statement **index**, not offset: formatting rewrites every offset in the document, so an offset is
meaningless afterwards, whereas the statement the user was working in is exactly what they expect to
still be under the caret — and it is also what *Run statement* reads. Index mapping is exact
whenever the statement count is preserved, which D13 guarantees (a statement that cannot be
formatted is emitted verbatim, never dropped or merged).

### D13 — Format becomes per-statement, and says what it could not format (item 4a, reopening P13 §3)

`formatConsoleText` splits with `splitSqlStatements(text, { backslashEscapes: backslashEscapesFor
(dialect) })` — the same splitter *and the same options* `ConsoleView.runAll` already uses
(`:260-264`), so "what Format treats as a statement" and "what Run all treats as a statement" cannot
disagree — formats each statement independently, and rejoins with `;\n\n`, which is what
`formatMongo` already does (`format.ts:126`) and what `sql-formatter`'s own `linesBetweenQueries: 1`
produces.

The result shape changes from `BeautifyResult` to `{ text, ok, failures: Array<{ index: number;
reason: string }> }`:

- **Every statement that formats, formats.** A statement the grammar rejects is emitted **verbatim**,
  in place, with its original text.
- **`ok: false` only when *nothing* formatted** — the P13 behaviour, preserved for the
  all-broken case that `tests/ui/console-format.spec.ts:213-249` asserts (text untouched, one-line
  reason in `console-format-error`).
- **A partial failure is a `warn` strip, not an `err` one**: `Formatted 3 of 4 statements —
  statement 2 could not be parsed: <first line>`. It uses the same component-local-ref +
  `#strips` slot mechanism P13 D9 chose, cleared by `resetStalePreviewState` like the other three.
- **A byte-identical result gets a `note` strip**: `Already formatted.` This closes F19's first
  silent no-op — the one where nothing changes and nothing is said — without touching P13 D4's
  `keywordCase: 'preserve'`, which stays for the ClickHouse reason F6 of that plan recorded.

P13's §3 declined this on the grounds that `sql-formatter` handles multi-statement documents
"better than the app's own splitter would". That is still true of the *output* — and this design
keeps it: a statement that formats is still formatted by the library, exactly as before. What
changes is only the *blast radius of a failure*, which P13 did not weigh. The dollar-quoted-body
case P13 cited as the splitter's weakness is covered: `sql-split.ts` is the same splitter *Run all*
already trusts with those documents, and F16 confirms a dollar-quoted `CREATE FUNCTION` formats
correctly as a single statement.

This also delivers P13 **OQ-1** ("Format Selection") for free in the only sense that matters: the
statement under the cursor is now formatted independently of every other, so a broken neighbour
never blocks it. A separate *Format Selection* verb is still not built — no second toolbar
affordance, per OQ-1's own "a UI decision nobody has asked for yet".

### D14 — SQL completion becomes two layers: the DDL document, then the tree's own relation names (item 4b)

`sqlLanguageService.sqlCompletionSources` stops being all-or-nothing:

```ts
export function sqlCompletionSources(
  dialect, schema, database, relations: readonly string[],
): readonly CompletionSource[] | undefined
```

- `schema.tables.length > 0` → today's two sources, unchanged (`schemaCompletionSource` +
  `keywordCompletionSource`), **plus** the relation source below, ranked after them.
- `schema.tables.length === 0` and `relations.length > 0` → the relation source +
  `keywordCompletionSource(dialectObject, true)`. The explicit keyword source is required for the
  same reason D5/F3 of v1.1 P18 gives: `override` replaces language-data sources wholesale.
- both empty → `undefined`, exactly today.

`relations` comes from a new `consoleRelationNames(connectionId, path)` in
`views/console/completion.ts`, built the same way `mongoCollectionNames` is (`:34-39`) and carrying
its own comment: **read the tree's own cache, no new round trip, no new cache, and an empty list is
the honest degradation.** It resolves the console's own container by walking `decodePath(tab.path)`
back to the last `database:`/`schema:` segment, re-encodes it, and reads
`treeState.children[rowKey(connectionId, containerPath)]`, keeping nodes of kind `table` / `view` /
`matview`. A console opened from a connection root has no such segment and yields `[]`.

The completion itself is context-gated rather than offered everywhere: it fires only when the token
before the caret is a relation position — after `FROM`, `JOIN`, `UPDATE`, `INTO`, `TABLE` — using
the same "look at the text before the word" technique `mongoCompletionSource` uses (`:50-52`). Bare
identifier positions are left to the keyword source, so this never floods an expression with table
names.

**Why this is not the "schema introspection" v1.1 forbade.** The prohibition (F22) is about the
language service building its own picture of the database by querying it. This source issues **no
query at all**: it reads rows the project tree already fetched to draw itself, in the same window,
for the same connection the console is attached to — the identical justification `mongoCollectionNames`
has been shipping under since v1.1 P18's own addendum D21. The comment in `sqlLanguageService.ts`
that declines *"the tree's own live metadata cache (`runtime[tabId].meta`)"* is about a *different*
cache (a data tab's column metadata, which is a real per-table describe) and is left standing —
D15 is what addresses columns, and it does so by supplying the DDL document rather than bypassing
it.

### D15 — The Schema (DDL) dialog can fill itself from the connection (item 4b)

`SchemaDialog.vue` gains one button beside Save: **"Fill from connection"**, and `state/schemas.ts`
gains the function behind it.

- It lists the connection's relations the same way D14 does — from `treeState.children`, per
  database/schema container, using whatever the tree has already loaded, and expanding nothing.
- For each, it calls the **existing** `control.treeDefinition(connectionId, path, false, null)`
  (`internal/bridge/tree.go:41`) and appends `definition.statements.join(';\n')`. F24 established
  that those statements are `CREATE TABLE` / `ALTER TABLE … ADD CONSTRAINT` / `CREATE VIEW` /
  `COMMENT ON …` — the exact vocabulary `parseDdl` consumes (`ddl.ts:327-348`).
- It **stages into the dialog's draft**, never saves — the dialog's own D3 staging contract
  (`SchemaDialog.vue:18`: *"silently (DialogFrame's own @close); only Save writes"*). The user sees
  the fetched text, the live parse summary (`ddlParseSummary`, `:129-136`) updates to "N tables, M
  columns", and Save is still their decision. Nothing is ever written behind their back.
- It is **sequential with a progress label** ("Fetching 12 of 47…") and a Cancel, because it is one
  round trip per relation and a large schema is a real wait. `--kira-shadow`-level polish is not
  needed; the existing footer is where the label goes.
- A relation whose definition fails is **skipped with a note** at the end (`-- could not read
  public.foo: <reason>` as a SQL comment in the document, which `parseDdl` ignores by construction),
  not an abort — one permission-denied view must not lose the other forty-six tables.

This is the honest reading of v1.1's constraint: **the user still supplies the DDL** — they press
the button, they see the text, they press Save — the app just stops making them run `pg_dump` in a
terminal and paste the output. The language service still reads a DDL document and only a DDL
document, so P18 D5's architecture is untouched.

*Alternative considered and rejected:* a `Describe`-backed column source that fires a round trip
when the user types `<table>.`. It is less code, but it makes the language service query the
database on a keystroke — genuinely the thing v1.1's row forbade — and it produces completions that
are invisible to the diagnostics and hover providers, which read the same `DdlSchema`. One supply,
three consumers, is the better shape.

### D16 — A SQL console with no schema document says so, once, where it matters (item 4b)

`ConsoleView` shows a dismissible `note` strip on a SQL console whose `ddlSchema.tables` is empty:
*"No schema for this connection — table and column completion is off. Set one up ▸"*, where the
action opens `SchemaDialog` for the tab's connection (through `state/schemas.ts`'s
`openSchemaDialog`, which `project/menus.ts` already calls — `views/console/` may import
`state/`, and this avoids `views/` reaching into `project/` for a dialog).

Dismissal is per connection, in the same `schemasState` module (a `Set<connectionId>`, runtime-only —
a console tab is not the place to grow a new persisted preference). Without this, D14/D15 are two
features nobody can find, which is how the current one ended up reported as broken.

### D17 — One new token, `--kira-state-on: #4ec9b0` (item 5)

Added to `theme/tokens.css` beside `--kira-search-match` (the other purpose-named state colour
hoisted out of component styles), with a comment naming the constraint it exists to satisfy:

```css
/* P19 D17: "a filter/sort/projection is applied right now". Deliberately NOT --kira-accent:
   that token means primary action / focus / selection everywhere else, and the three filter
   fields that carry this cue paint their own value through a CodeMirror overlay in
   --kira-syntax-keyword (#569cd6) and --kira-syntax-name (#9cdcfe) — within 8 degrees of hue of
   --kira-accent's own #0078d4, so "this filter is on" was indistinguishable from "this is part of
   the query". #4ec9b0 is ~168 degrees: the one region no syntax token, and no other state colour
   (--kira-warn/--kira-error/--kira-ok/--kira-info), occupies. */
--kira-state-on: #4ec9b0;
```

`--kira-accent` itself is **not** changed — every primary button, focus ring and selection fill in
both modes depends on it, and none of them is the reported problem.

*Alternatives considered and rejected:* `--kira-ok` (means "success"; also within ~25° of the
number/comment greens); `--kira-warn` (already three other meanings — search match, unresolved
variable, the "editing" chip); a connection-palette hue (`--kira-conn-teal` etc. — LAW 07 reserves
that palette for connection identity, and a teal connection rail can sit in the very same toolbar);
a chip/filled-background treatment with no hue change (the app's "engaged control" idiom, and P27
§1.4 already noted it — but the row asks for a colour, and a filled pill on a 4-character label
inside an input box crowds a `--kira-h-md` row).

### D18 — `.ph-active` moves to the new token (item 5)

`theme/primitives.css:191-193` becomes `color: var(--kira-state-on);`, and P27's comment above it
gains a line recording why the colour changed and pointing here. All five `prefix-active` call sites
(now six, with D4's) follow automatically — including the two Stream fields that do not themselves
collide (F27), because one meaning gets one colour.

### D19 — The three sibling indicators follow, as their own commit (item 5)

`.p-iconbtn.has-indicator::after` (`primitives.css:76-85`), `StreamView.vue:681`'s partition-button
inline style, and `.slick-sort-indicator` (`slickTheme.css:527-529`) all mean "this view is narrowed
or reordered right now" and all currently use `--kira-accent` (F28). They move to
`--kira-state-on` too, so a user cannot see two different colours claiming the same thing in one
toolbar — most acutely in the SQL data view, where the ORDER BY label and the sorted column's
chevron sit inches apart and would otherwise disagree.

P27 §0 held `slickTheme.css` out of scope because a concurrent phase owned that directory; that
phase landed in v1.1 and the exclusion has no remaining basis, which is stated in the commit body.

This lands as **T16, separate from T15**, so the reported bug (the label) and the consistency sweep
are independently revertable. If a reviewer wants the minimal change, T15 alone is it.

---

## 3. Commit sequence

Conventional Commits, one concern each, in dependency order. `bun run lint`, `bun run typecheck`
and `bun run build` per commit; the UI suite runs once near the end per `AGENTS.md`'s cadence rule.

| # | Commit | Covers |
|---|---|---|
| T1 | `fix(studio): the connection dialog is one size, whatever tab is open` | D1, D2, D3 |
| T2 | `test(studio): the connection dialog's box never moves` | §4.3 case 1 |
| T3 | `fix(studio): the Mongo filter box says when a filter is applied` | D4 |
| T4 | `fix(studio): an idle blur no longer refetches a Mongo collection` | D5 |
| T5 | `refactor(views): clipboard formats and selection geometry move to views/shared` | D7 (pure move) |
| T6 | `feat(console): a result set's rows, columns and cell ranges select` | D8, D10 |
| T7 | `feat(console): a selection copies as TSV, CSV or JSON` | D9 |
| T8 | `feat(console): a document result copies as JSON` | D6, D11 |
| T9 | `feat(studio): a Mongo document copies as JSON from the collection view too` | D6 (parity half) |
| T10 | `feat(editor): an external write can keep the caret where it was` | D12 (1) and (2) |
| T11 | `fix(console): Format leaves the caret in the statement it was in` | D12 (3) |
| T12 | `fix(console): one unformattable statement no longer blocks the rest` | D13 |
| T13 | `feat(console): a SQL console completes the tables it was opened beside` | D14 |
| T14 | `feat(studio): the schema document can be filled from the connection` | D15, D16 |
| T15 | `feat(theme): an applied filter or sort has its own colour` | D17, D18 |
| T16 | `refactor(theme): every applied-filter indicator uses that one colour` | D19 |
| T17 | `test(p19): the specs §4 enumerates` | §4.3 cases 2-9 |
| T18 | `docs(spec): mark P19 implemented` | the SPEC row |

Ordering notes: T5 must precede T6/T7 (lint fails otherwise, F13). T10 must precede T11. T13 and
T14 are independent of each other but T14's value depends on T13 existing only in the sense that
both feed the same completion surface — either can land first. T15 must precede T16 (the token has
to exist).

---

## 4. Verification plan

### 4.1 Unit (`bun run test:unit`)

- **`tests/unit/console-format.spec.ts`** (exists, P13 D10) gains D13's cases: a document where
  statement 2 is unparseable formats 1 and 3 and returns one `failures` entry with index 1; a
  document where *every* statement fails returns `ok: false` and the original text; a
  byte-identical result is reported as such; the statement **count** is preserved in every case
  (which is what D12's index mapping depends on).
- **Selection geometry**: whatever unit coverage `views/grid/slick/selection.ts` has today follows
  the file to `views/shared/slick/` in T5 with its import path updated and no case changed. If it
  has none, none is added — `AGENTS.md`'s bar, and these are the same functions the data grid has
  been exercising through `tests/ui` since P22.
- **No new unit test for the clipboard formats** — `rowsToJson` already exists and is unchanged;
  D6's "copy all as JSON" is a `map`+`join` over it.

### 4.2 Go (`bun run test:go`)

Nothing in this phase touches Go. `go build`, `go vet` and `go test ./internal/...` run once as a
regression check and are expected to be untouched-clean.

### 4.3 UI (`bun run test:ui`) — the cases this phase owes

1. **`connection-dialog-tabs.spec.ts`** (existing file, P28 §7) — *the dialog's box never moves*:
   open the engine picker, record `boundingBox()`; pick Postgres; record; switch to Advanced,
   Pre-connect, back to General; switch General's Mode to Connection URI and back; type into
   Pre-connect so its warning + sidecar checkbox appear; press "Change engine" and pick SQLite (file
   family), then SQS (AWS family). Assert every recorded box is identical to the first, **and** that
   `.dialog-body`'s `scrollHeight <= clientHeight` at each stop. This is what pins D2's 520.
2. **`connection-dialog-tabs.spec.ts`** — typing in the engine search filters the tile grid without
   changing the dialog box (D3).
3. **`autocomplete.spec.ts`** (already owns the Mongo filter row) — the `FILTER` label is present
   and carries `ph-active` only once a filter is applied; the `SORT` label behaves the same; the
   existing "filter applies and the list drops to one row" case still passes unchanged (D4).
4. **`autocomplete.spec.ts`** — focus the filter box with a filter already applied, blur it without
   typing, and assert **no** `IPC.dataLoad`-equivalent round trip fires and the exact count survives
   (D5's no-op guard); press Escape after typing and assert the field reverts.
5. **`console.spec.ts`** — a tabular result: click the gutter → the whole row highlights and ⌘C
   yields a tab-separated line with every column; drag a cell range → ⌘C yields the range as TSV;
   click a header → the column highlights and ⌘C yields that column's values; right-click a cell →
   Copy as JSON writes `JSON.stringify(text)`. Uses `autocomplete.spec.ts`'s own
   `installClipboardSpy`/`lastClipboardWrite` helpers (`:310-330`), which already exist for exactly
   this and avoid a real OS clipboard round trip under WebKit (D9, D10).
6. **`console.spec.ts`** — a Mongo document result: right-click a row → Copy as JSON writes the
   canonical EJSON body; Copy all as JSON writes a JSON array whose length equals the displayed row
   count, and, with the find-filter toggle on, equals the *filtered* count (D6).
7. **`console-format.spec.ts`** — put the caret in the second of three statements, press Format,
   and assert *Run statement* runs the second statement (not the first). This is the case that
   fails on `c13b8af` and is the guard for D12/P13 OQ-2.
8. **`console-format.spec.ts`** — a document of `SELECT a,b FROM t;` + `\dt` formats the first and
   leaves the second verbatim, with `console-format-error` absent and a warn strip naming statement
   2 (D13). Plus: pressing Format twice in a row shows "Already formatted" the second time.
9. **`sql-schema.spec.ts`** — with **no** DDL document, typing `select * from ` in a console opened
   under a schema whose tables are in the tree offers those table names (D14); the existing *"with
   no DDL document, the console is unchanged (D5)"* case is **updated**, not deleted, since its
   subject (the language service's own behaviour with an empty schema) is exactly what D14 changes —
   its keyword-completion assertions stay, its "no table completion" assertion becomes "table names
   from the tree, no column completion". The no-schema hint strip and its action are asserted here
   too (D16).

Not verified automatically, and named as such: the "Fill from connection" action end to end
(D15) — it needs a real adapter round trip per relation, which is `tests/e2e-real`'s tier, not
`tests/ui`'s mocked IPC. What *is* asserted in `tests/ui` is the mocked shape: N `treeDefinition`
calls for N tree relations, the concatenated text landing in the dialog's draft, the parse summary
updating, and Save not firing until pressed.

### 4.4 What is deliberately not verified

- **The 520 constant's exactness on a real Mac.** This sandbox cannot render the app (F17); case 1
  is written so that a wrong constant fails loudly rather than shipping, which is the property that
  matters.
- **The colour choice itself.** `#4ec9b0` against `#313131` is arithmetic (F29), not a rendering
  question. `bun run lint` proves the token resolves (`check-tokens.sh`); no test asserts a hex.

---

## 5. What this phase deliberately does not do

- **Does not change `--kira-accent`.** Only the four rules that misuse it as a state colour move
  (D17-D19).
- **Does not reverse P13 D4's `keywordCase: 'preserve'`.** D13 makes the resulting no-op legible
  instead; the ClickHouse identifier hazard F6 of that plan recorded is real and unchanged.
- **Does not build a *Format Selection* verb.** P13 OQ-1's own "a UI decision nobody has asked for
  yet" still holds; D13 delivers the useful half (a broken neighbour no longer blocks your
  statement) with no new affordance.
- **Does not make the language service query the database.** D15 supplies the DDL document through
  an explicit, user-confirmed action; `sqlLanguageService.ts` still reads a `DdlSchema` and nothing
  else, so the diagnostics and hover providers keep the same single source as completion.
- **Does not add multi-row selection to the console's document/key-value branches** (D11, OQ-3).
- **Does not add paste/delete/duplicate to the console result grid** (D9) — every one of them writes,
  and a console result has no addressable table.
- **Does not touch any Api-mode file.** The one shared component gains a default-off prop (D12).
- **Does not rename `data-testid="document-search"`** despite the box now being labelled `FILTER`
  (D4) — churning a passing spec for tidiness.
- **Does not persist the console's selection or the no-schema-hint dismissal across a restart** —
  both are runtime state, matching `ConsoleViewRuntime`'s own "runtime-only, never saved" rule
  (`views/console/state.ts:52`).

---

## 6. Open questions, with their resolutions

**OQ-1 — Should the two connection-dialog steps really share a width, when the design system gives
them different ones?**
*Resolved: yes, 620 for both (D1).* The two artboards were drawn as separate screens and never as
two states of one dialog a user toggles in place; the 620→560 jump is the biggest size change the
dialog makes, and pinning only the tabs would leave the loudest instance of the reported problem
untouched. The cost is that step 2's form is 60px roomier than its mockup, which is a gain
(helper texts wrap less), not a regression. If a future design pass wants 560 back for step 2, the
honest way is to narrow the *engine grid* to two columns so both steps fit 560 — not to reintroduce
the jump.

**OQ-2 — Is the Mongo filter's missing label a bug at all, given P27 §1.2 deliberately skipped it?**
*Resolved: yes, and P27's rule is why.* P27's own rule was "confirm it's actually
grey-regardless-of-state, don't add a label that doesn't exist" — a scoping rule for a
colour-only phase, not a finding that the box should stay unlabelled. Two phases later a user has
reported exactly the gap that rule left behind, in exactly those terms ("inert placeholder text").
Adding the label is the completion of P27, not a contradiction of it.

**OQ-3 — Should the console's document result support multi-row selection, so several documents copy
at once?**
*Resolved: not in this phase.* The useful outcome — "give me these results as JSON" — is served by
D6's *Copy all as JSON*, which is what a user actually wants from a `find()` result and costs one
menu item. Real multi-row selection over `VirtualList` (shift/ctrl ranges, a selection model, a
keyboard contract) has no precedent in this app outside SlickGrid, and building a second selection
model is precisely what the SPEC row warns against. If a user asks for it, the right answer is
probably to render document results through SlickGrid too — which is a migration, and its own row.

**OQ-4 — Does D15's "Fill from connection" reopen v1.1's "no schema introspection" rule?**
*Resolved: it touches the rule's edge, deliberately, and stays inside it.* The rule's subject is the
**language service**: it must not build a schema picture by querying the database. After D15 it
still cannot — it reads a `DdlSchema` parsed from a document the user saved. What changed is who
types the `pg_dump` command. The call D15 makes (`TreeService.Definition`) is one the app already
makes every time a user opens a table's Definition tab, on the same connection, with the same
permissions; and it happens only when a person presses a button and then presses Save. If that still
reads as too much, the fallback that keeps every letter of the rule is D14 alone (table names from
the tree, no columns) — which is a strictly smaller commit and a strictly smaller improvement.

**OQ-5 — Should `sql-formatter` be retired in favour of `@codemirror/lang-sql`'s parser, now that
both are in the bundle?**
*Resolved: no, and not here.* P13 OQ-5 raised it for v1.1 P18, which did not take it, and the
reason has only got stronger: `lang-sql`'s Lezer grammar is a *tokenizer* good enough for
highlighting and for `ddl.ts`'s statement walk, not a formatter — it has no notion of clause
breaking or indentation, so "reuse it" means writing an emitter. That is a dependency/bundle
decision with its own measurement, in the middle of a five-item user batch. Recorded again so the
next session does not rediscover it.

**OQ-6 — Should the console's tabular selection publish into `cellSelection` for a *range*, the way
a single click does for a cell?**
*Resolved: no.* The cell-editor dock shows one value; a range has no single value to show, and the
data grid does not publish one either (`SlickGridHost`'s publish path is its `onClick` cell branch).
A range selection leaves whatever cell was last clicked in the dock, which is the data grid's own
behaviour and therefore the one a user already has.

---

## Checklist

- [ ] T1 `fix(studio): the connection dialog is one size, whatever tab is open`
- [ ] T2 `test(studio): the connection dialog's box never moves`
- [ ] T3 `fix(studio): the Mongo filter box says when a filter is applied`
- [ ] T4 `fix(studio): an idle blur no longer refetches a Mongo collection`
- [ ] T5 `refactor(views): clipboard formats and selection geometry move to views/shared`
- [ ] T6 `feat(console): a result set's rows, columns and cell ranges select`
- [ ] T7 `feat(console): a selection copies as TSV, CSV or JSON`
- [ ] T8 `feat(console): a document result copies as JSON`
- [ ] T9 `feat(studio): a Mongo document copies as JSON from the collection view too`
- [ ] T10 `feat(editor): an external write can keep the caret where it was`
- [ ] T11 `fix(console): Format leaves the caret in the statement it was in`
- [ ] T12 `fix(console): one unformattable statement no longer blocks the rest`
- [ ] T13 `feat(console): a SQL console completes the tables it was opened beside`
- [ ] T14 `feat(studio): the schema document can be filled from the connection`
- [ ] T15 `feat(theme): an applied filter or sort has its own colour`
- [ ] T16 `refactor(theme): every applied-filter indicator uses that one colour`
- [ ] T17 `test(p19): the specs §4 enumerates`
- [ ] `bun run lint` (including `scripts/check-tokens.sh`), `bun run typecheck`, `bun run build` clean
- [ ] `bun run test:unit` green; `bun run test:go` unchanged-clean
- [ ] `bun run test:ui` run once at the end; failures fixed as follow-up commits
- [ ] `docs/v1.2/SPEC.md`'s P19 row marked implemented

---

## 7. Sources

**Read in this worktree, at `c13b8af`** (every file:line citation above points at this commit):
`project/{ConnectionDialog,SchemaDialog,menus}.vue/.ts`,
`theme/primitives/{DialogFrame,AutocompleteField,TextField,IconButton}.vue`,
`theme/{tokens,primitives}.css`, `theme/primitives/completion.ts`,
`editor/{CodeMirrorHost.vue,languages.ts,theme.ts}`,
`views/console/{ConsoleView,ConsoleResultGrid,ConsoleSlickGrid}.vue`,
`views/console/{state,format,sqlFormatterEntry,completion,sqlLanguageService,ddl,mongoStatement,resultPages}.ts`,
`views/documents/{DocumentView.vue,menu.ts,state.ts}`,
`views/grid/{SlickGridHost.vue,FilterToolbar.vue,menu.ts,clipboardFormats.ts,slick/selection.ts}`,
`views/shared/{slick/*,document/ejson.ts,targetPath.ts}`, `views/stream/StreamView.vue`,
`state/{schemas,tabs,connections}.ts`, `project/state/tree.ts`, `shortcuts/commands.ts`,
`workbench/{panels/MainView.vue,SettingsDialog.vue}`, `packages/shared/domain/{tree,sql-split}.ts`,
`internal/bridge/tree.go`, `internal/tree/service.go`, `internal/storage/model/definition.go`,
`internal/adapters/postgres/definition.go`, `internal/adapters/mongo/read.go`,
`frontend/vite.config.ts`, `package.json`, `biome.json`, `scripts/check-tokens.sh`,
`tests/ui/{autocomplete,console-format,connection-dialog-tabs,sql-schema}.spec.ts`,
`docs/design/kira-design-system/parts/{_dlgcss.html,bodies/ConnectionDialog.html,bodies/NewConnection.html}`.

**Run in this worktree** (`bun install`, 574 packages):
- `sql-formatter@15.8.2`'s `formatDialect` over the twenty-case battery in F16, with
  `format.ts`'s exact option object, across postgres/mysql/mariadb/sqlite/clickhouse.
- `views/console/ddl.ts`'s `parseDdl` over a `pg_dump --schema-only` fragment and a
  `SHOW CREATE TABLE` fragment (F23).
- `git log --oneline --reverse` ordering of `62258b8` / `05b9206` / `a490874` / `6876177`, and
  `git log -L 293,308:editor/CodeMirrorHost.vue` (F17, F19).

**Not run**: `bun run build` and `bun run test:ui`. Both need `frontend/bindings/`, generated by
`wails3`, which is not installed in this Linux sandbox (`go` is). Every claim above that would
otherwise have wanted a build is stated as a reading of the source or excluded on a structural
argument, and §4.4 names what stays unverified.

**Prior plans**: `docs/v1.1/plans/P13-query-console-format-button.md` (§3's declined
statement-by-statement alternative, D4, D8, D9, OQ-1, OQ-2, OQ-3, OQ-5),
`docs/v1.1/plans/P18-sql-language-server-explain.md` and its addendum (D5, D21, the console's
completion/lint/hover wiring), `docs/v1.1/plans/P27-active-filter-indicator-color.md` (§1.2, §1.4,
§2.1-§2.5, and its `c8ba47f` landing), `docs/v1.1/plans/P22-slickgrid-pass-b.md`'s §5 D4/D14 as
cited inline by `views/grid/slick/selection.ts` and `slickTheme.css`,
`docs/v1.2/plans/P16-sql-grid-consistency-search.md` and
`docs/v1.2/plans/P18-history-grpc-parity-mode-buttons-env-colour.md` (this plan's structural
models), `docs/v1.1/SPEC.md`'s P13 and P18 rows, `docs/v1.2/SPEC.md`'s P19 row, and `AGENTS.md`'s
test-bar and verification-cadence rules.
