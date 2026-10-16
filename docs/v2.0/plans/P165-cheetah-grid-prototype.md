# P165 plan: Cheetah Grid prototype for the SQL data grid

Plan only. Base: `83a9932b` (v2.0). SPEC row: P165. Inputs: `P162-canvas-grid-investigation.md`
§2-§5, `docs/PERF.md` §2.1a, `docs/v1.1/WEBVIEW-SCROLL-MEMORY.md` §6 and Appendix A, perf probe suite
(`tests/perf/`, `perfProbe.ts`).

Goal: a standalone Cheetah Grid page that renders the `NCOLS=20` data with Studio's cell semantics,
tries every parity feature, drives Playwright over it, and measures it against SlickGrid. Output is
numbers, a verified parity table and a go/no-go. Not a migration. Accessibility overlay is out of
scope (user decision).

## 0. Gate before any commit

**G0: perf probe suite committed.** `tests/perf/`, `playwright.perf.config.ts`, `perfProbe.ts` and
their hunks in `package.json`, `.gitignore`, `tsconfig.tests.json` and `docs/DEV_ENVIRONMENT.md` are
uncommitted user work. This phase edits four of those files. The implementer never stages them on
its own. The orchestrator gets them committed first (user's call; P160's row already says "commit it
with or before this phase"). No commit of this phase lands before G0.

## 1. Libraries, verified 2026-10-05

| Package | Version | Released | License | Notes |
|---|---|---|---|---|
| `cheetah-grid` | 2.2.0 | 2026-08-20 | MIT (package `LICENSE`, Future Corporation) | No deps. `dist/main.mjs` 412 KB, 85 KB gzip. No bundled fonts, images or icon sets (tarball checked: only `dist/`, `src/`, `LICENSE`). Icon support takes caller-supplied fonts/SVG; we supply none. |
| `vue-cheetah-grid` | 2.1.0 | 2025-08-15 | MIT, same copyright | Peer `vue ^3.0.0`, dep `cheetah-grid ^2.1.0`. Ships Options-API SFCs (`lib/*.vue`); exposes `rawGrid`. |
| `cheetah-grid-playwright` | 0.1.0 | 2026-08-20 | MIT | Official (cheetah-grid monorepo, `packages/cheetah-grid-playwright`, maintainer ota-meshi). Peer `playwright-core >=1.40`. README marks it experimental: breaking changes in minors. |

Upstream repo: MIT, 36 open issues, monorepo (`pnpm-workspace`), no package with another license.
Every feature used is in the MIT packages; there is no paid tier. Full CLAUDE.md library-licence
check passes at package and feature level.

`cheetah-grid-playwright` (asked by the user, found on npm): locates cells through
`ListGrid.getInstanceByElement` (needs cheetah-grid >= 2.2 and `window.cheetahGrid` exposed by the
page, same module instance as the grid), then drives real mouse/keyboard events. API:
`gridLocator(locator)`, `grid.cell(field, recordIndex)`, `grid.cellAt(col, row)` (headers
included), cell `click()`, `dblclick()`, `fill(value)` (F2, fill, Enter, checks commit), `value()`,
`rect()` (scrolls into view, viewport rect). It throws clearly on covered, clipped, zoomed or
cross-origin cells. It uses `page.mouse`/`page.keyboard` only, no engine-specific API, so WebKit
should work, but upstream does not state WebKit coverage: this phase verifies it (§7 sample specs).

It does not expose selection, active cell, editor state, hover, right-click, rendered markers
(NULL, truncated, masked, staged, search, type colour), header sort/badge state, or the scroller.
It requires `field` to be the column's string field: `getCellRangeByField` compares `col.field ===
field`, so columns use string fields (§3.2).

**Decision.** Adopt it for cell location, geometry, click, double-click, fill and raw value. Keep
our own debug hook, shrunk to the state the library cannot see (§5). Both stay behind our own thin
helper so spec bodies keep `support/grid.ts`'s shape. Pin exact (`bunfig.toml` `exact = true`). Its
experimental status is acceptable for a prototype; a migration phase re-checks release cadence.

## 2. Where the prototype lives

**A dev-only Vite multi-page build inside the Studio frontend package, never in the app's entry
graph.**

- Sources: `apps/kira-studio/frontend/proto/grid/` (outside `src/`). Entries:
  `proto/grid/cheetah.html`, `proto/grid/slick.html`, `proto/grid/empty.html` (Mac control).
- Own config `apps/kira-studio/frontend/vite.proto.config.ts`: calls `defineAppViteConfig` for the
  same aliases, plugins and `__KIRA_DEBUG_HOOKS__` define, then overrides `build.outDir` to
  `dist-proto`, `rolldownOptions.input` to the three HTML files, `resolve.dedupe` to
  `['vue', 'cheetah-grid']`. The shipped build (`vite build`, `index.html` only) never reaches
  `proto/`, and Go embeds only `frontend/dist`.
- Why here, not `tools/` (precedent `tools/mutation/`): the prototype must reuse Studio's real
  grid-agnostic code to make parity verdicts honest: `createTabularPageBuilder`, the page store and
  decode cache (`views/grid/page.ts` `setPage`/`cell`), `maskPreview.ts`, `clipboardFormats.ts`
  (`columnsToTsv`, `rowsToTsv`, `parseDelimited`), `columns.ts` (`initialWidths`, `alignmentFor`,
  `headerAwareMinWidth`, `columnHeaderTooltip`, `tooltipAttrs`), `theme/icons.ts`
  `categoryForTypeClass`, workbench `useContextMenuStore` + `ContextMenu.vue`, theme
  `AttributeTooltip.vue`, shadcn-vue `Popover`, `kiraSlickGrid.ts` for the baseline. Several import
  `vue`/`pinia`; a separate `tools/` package would load a second Vue copy. Same package means one Vue,
  one Pinia, the real aliases and Tailwind.
- Dependencies: root `package.json` `devDependencies` (where `@playwright/test` lives; root holds all
  frontend deps today): `cheetah-grid@2.2.0`, `vue-cheetah-grid@2.1.0`, `cheetah-grid-playwright@0.1.0`.
  devDependencies say "not runtime"; the release check below proves it.
- Release check (verification §10): `bun run build:studio`, then
  `grep -rlE "cheetah|__kiraGridProto" apps/kira-studio/frontend/dist` returns nothing.
- Typecheck: new `apps/kira-studio/frontend/tsconfig.proto.json` (extends the app's options and
  paths, includes `proto/**/*.{ts,vue}` plus the app/shared/theme/workbench globs it imports and
  `../tests/perf/support/wideTable.ts`). New script `typecheck:proto:studio` (`vue-tsc --noEmit -p
  ...`) added to the root `typecheck` fan-out, so the pre-commit hook covers it. The app's own
  `tsconfig.json` is untouched.
- Lint: biome already covers `**`; `dist-proto/` goes in `.gitignore` (biome reads it).
  `scripts/check-tokens.sh` scans only `src/` trees; the proto must still use only defined
  `--kira-*` names (it reads them, it defines none except §3.6's scoped override).
- knip: add `proto/grid/*.html` to the `apps/kira-studio/frontend` workspace `entry` and
  `proto/**/*.{ts,vue}` to its `project`. It is a real entry. Run `bun run lint:dead`; if
  `cheetah-grid-playwright` or the peer is flagged because `apps/kira-studio/tests/` is in no knip
  project, fix with the narrowest real entry, and only fall back to `ignoreDependencies` with the
  reason written next to it.
- Peer `playwright-core`: Bun installs it at 1.63.0 alongside `@playwright/test` 1.63.0. If
  `typecheck:tests:studio` reports `Locator` type mismatches across two copies, pin `playwright-core`
  `1.63.0` in root `devDependencies` and say why in the commit.

**How a user runs it on a Mac** (also goes into `docs/DEV_ENVIRONMENT.md`, §9):

```sh
bun install
bun run proto:build:grid          # dist-proto, debug hooks OFF (release-like, for perf/footprint)
bun run proto:build:grid:hooks    # dist-proto, debug hooks ON (HUD, trace, tests)
bun run proto:preview:grid        # vite preview on 127.0.0.1:9246, prints URLs
# open http://127.0.0.1:9246/proto/grid/cheetah.html in Safari, or via wkhost (§8.3)
bun run proto:dev:grid            # live dev server, hooks ON, for poking at features
```

**How Playwright runs it locally (no CI):** `apps/kira-studio/playwright.proto.config.ts`, project
`proto`, `browserName: 'webkit'`, `testDir: './tests/proto'`, a fixture serving `dist-proto` through
`@workbench/testing/ui/server` `serveStatic`. Script `test:proto:studio` = `build:proto:test` (hooks
ON) then `playwright test --config=...proto.config.ts`. Perf probes for the prototype live in
`tests/perf/` and run through the existing perf config (§8). No workflow file changes; nothing joins
the normal `ui` tier.

## 3. Page design (`cheetah.html`)

### 3.1 Data

- Move `WIDE_TEMPLATE` out of `tests/perf/grid-scroll.spec.ts` into
  `apps/kira-studio/tests/perf/support/wideTable.ts`, exporting `WIDE_TEMPLATE`, `ROWS = 10_000` and
  `wideColumns(ncols): ColumnDescriptor[]` + `wideRows(ncols, rows)` (the column/row mapping now
  inline in `widePage`). `grid-scroll.spec.ts` imports it; behaviour unchanged. The prototype imports
  the same module, so data is identical by construction.
- `proto/grid/data.ts`: builds a real `TabularPage` with `createTabularPageBuilder` (NCOLS=20,
  10 000 rows), `setPage(PROTO_SCOPE, page)` into `views/grid/page.ts`'s store, and reads cells
  through `cell(PROTO_SCOPE, row, col)` (real decode cache, real `CellView`).
- Query params: `?fixture=perf` (default; exact template, nothing added) and `?fixture=features`.
  `features` adds, deterministically: `''` in `email` every 17th row (NULL vs empty), a 70 KB value in
  `notes` every 500th row (builder truncates at `MAX_CELL_BYTES`, real `truncated` flag), a mask rule
  on `email` run through `createMaskPreviewTransform` (real `masked` flag), FK metadata on `country`
  (synthetic `ForeignKeyMeta` to `countries.code`), `id` as PK (already), 3 staged edits and 1
  staged delete in a prototype pending map, a search term matching ~1 % of rows. `?w=&h=` sizes the
  grid container (§8.1). `?rowHeight=22|28`.

### 3.2 Grid host

- `proto/grid/CheetahProto.vue` (`<script setup lang="ts">`) hosts `vue-cheetah-grid`'s `<CGrid>`
  with 21 `<CGridColumn>` children (gutter + 20). Grid instance taken from `rawGrid` for imperative
  calls (theme, invalidate, listeners), held in a plain `let`, never reactive (SlickGridHost's own
  rule). Record the wrapper verdict: if more than two needed knobs go through `rawGrid`, the
  migration should skip the wrapper.
- Records: a `DataSource` whose `get(index)` returns a per-row record object
  `{ [columnName]: CellView }` built lazily from `cell()` and dropped outside the visible window
  (`setVisibleWindow`). Column `field` = column name string (required by `cheetah-grid-playwright`).
- Record index vs page row: with "hide non-matching rows" or client sort, record index differs from
  page row. One `rowOrder: Uint32Array` maps index to page row; the hook exposes the inverse.
- `proto/grid/cellColumn.ts`: one custom column type (subclass of cheetah-grid `Column`, MIT API,
  `drawInternal`) drawing a `CellView`: plain text; `NULL` in `--kira-fg-subtle` italic; `''` blank;
  truncated text plus `…` in `--kira-fg-muted`; masked text in `--kira-fg-muted`; type colour per
  `categoryForTypeClass` (`--kira-syntax-number`/`-keyword`/`-control`); right-align when
  `alignmentFor` says so; FK/PK nav glyph at cell left (≤ 24 px, as `C11 T9` asserts today). No
  per-cell allocations in the draw path (font strings and colours cached on theme change).
- Layers drawn in the same pass, in SlickGridHost's cascade order: selection fill, staged
  (`kira-staged` tint), search match, current match, four-sided selection edges. Row rail for
  inserted/deleted/dirty in the gutter. Zebra: the app has none (`slickTheme.css` "No zebra
  striping"); the prototype implements it behind `?zebra=1` only to prove a row layer costs nothing
  measurable, verdict recorded, not a parity item.
- Gutter: `frozenColCount: 1`, row numbers with page offset, `+` for insert rows, select-all corner.

### 3.3 Interaction

- Selection: Cheetah's native model is one range plus a focus cell. Studio needs cell, range,
  shift-range rows, ctrl-toggle disjoint rows, gutter drag, column select. Expected: native for cell
  and range; **custom M** for disjoint rows and column select: a pure `proto/grid/selection.ts`
  (rows set + ranges + active cell, shift/ctrl rules ported from `SlickHybridSelectionModel`'s
  behaviour), drawn as a layer, native selection fill set transparent via theme.
- Keyboard: native arrows, Tab, Enter (`keyboardOptions.moveCellOnTab/Enter`), Esc. Copy/paste
  shortcuts and Delete routed like SlickGridHost's `onKeydown`.
- Context menus: `contextmenu_cell` event to workbench `useContextMenuStore().openContextMenu` with
  a prototype item list reusing the real menu ids (`copy`, `copy-with-header`, `copy-as-json`,
  `paste`, `edit`, `set-null`, `delete-row`, `copy-rows` submenu, header `sort-asc`/`sort-desc`/
  `clear-sort`/`hide-column`/`show-all-columns`/`copy-column-name`/`copy-column-values`). The real
  `ContextMenu.vue` renders it.
- Copy/paste: cheetah `copydata` hook and `paste_cell` overridden to go through
  `columnsToTsv`/`rowsToTsv`/`parseDelimited` and the real `copyText` path.
- Inline edit: cheetah `InlineInputEditor` with `readOnly` as a per-record function = the veto rule
  (same reasons as `onBeforeEditCell`: generated, truncated, deleted, masked, no PK, read-only).
  Commit writes the prototype pending map, invalidates the cell.
- Insert row: Studio renders every insert cell as a live `<input>`. Cheetah opens one editor at a
  time. **Expected: identical behaviour impossible; equivalent custom M** (drawn insert row, editor
  opens on focus/typing, value staged per keystroke). State this plainly in the verdict.
- FK/PK nav: hit-test on `click_cell` against the glyph rect (cell rect from `getCellRect`, left
  24 px). Click opens a prototype preview popover (shadcn-vue `Popover`, anchored to a 0x0 fixed
  span at the cell's viewport rect, same virtual-anchor shape as `ContextMenu.vue`) showing a canned
  referenced row. Popover follows the cell on scroll or closes; record which.
- Column resize: native (`disableColumnResize: false`), min width from `headerAwareMinWidth`.
  Hide/reorder: data level (rebuild columns from an order array), as Studio's `ColumnsMenu.vue`
  already does; no header drag reorder today either.
- Sort: header click cycles asc, desc, none; shift-click adds a term; numbered badge drawn in a
  custom header type (cheetah `SortHeader` holds one `sortState`). **Expected custom M.** Sorting
  itself reorders `rowOrder` client-side (Studio re-queries; the visual is what is tested).
- Header badges and tooltips: PK/FK badge drawn in the header type. Tooltips reuse
  `AttributeTooltip.vue` unchanged: on `mouseenter_cell` of a header cell, a transparent proxy
  `<div>` is placed over the cell rect carrying `tooltipAttrs(columnHeaderTooltip(...))`; the proxy
  is the tooltip container. **Expected custom S.**
- Find: search input, highlight layers, `goToMatch` via `makeVisibleGridCell` + focus. Hide
  non-matching rows via `rowOrder`.
- Truncation tooltip: same proxy mechanism over a truncated body cell, text "value truncated at 64
  KB". **Expected custom S.**
- Hover row: `mouseenter_cell`/`mouseleave_cell` set `hoverRow`, invalidate the two rows. Cheetah's
  `highlightBgColor` is selection highlight, not hover. **Expected custom S.**

### 3.4 Theme

`proto/grid/theme.ts`: builds a cheetah theme object from `getComputedStyle(documentElement)`
`--kira-*` values (bg, fg, fg-muted, fg-subtle, border, select, hover, focus, accent, search-match,
-current, syntax colours, `--kira-font-data`, `--kira-font-size`, `--kira-row-height`). Rebuilt and
`invalidate()`d when the root `style`/`class`/`data-*` changes (VueUse `useMutationObserver`).
`color-mix()` tokens (`--kira-search-match`) are resolved through a 1x1 probe element's computed
colour, since canvas cannot parse `color-mix`.

**Dark mode note.** The app ships one palette (VS Code Dark Modern, `tokens.css` single `:root`,
`<html class="dark">`). There is no light token set to switch to. The prototype proves re-theming
two ways: (a) Appearance tokens change live (font size, row height 22/28); (b) a prototype-only
`proto/grid/theme-alt.css` overrides the ~15 grid-relevant `--kira-*` names under
`[data-proto-theme="alt"]` (a light variant) and a toggle flips it. Pass = grid repaints with no
reload and no stale colours. Not a design proposal.

## 4. Baseline page (`slick.html`)

Same data module, same container size. `?variant=stock`: plain `SlickGrid` (`slickgrid` 5.20.0,
already a root dependency), default options plus `frozenColumn: 0`,
`enableMouseWheelScrollHandler: false` (Studio's native-momentum setting). `?variant=kira`:
`KiraSlickGrid` from `kiraSlickGrid.ts` with `slickTheme.css` and a formatter equivalent to
`cellFormatter` (class-based markers), i.e. Studio's real per-cell cost without the app shell. Before
building `kira`, run `codegraph_explore` on `KiraSlickGrid` constructor dependencies; if it cannot be
constructed without app stores or the bridge, ship `stock` + `slickTheme.css` and say so in the
Result. Cross-check: `kira` numbers vs the real app probe (`NCOLS=20 grid-scroll`) in the same
container should agree within about 10 %; report the gap.

## 5. Debug hook (shrunk by `cheetah-grid-playwright`)

Compiled out like the app's: everything below sits inside `if (__KIRA_DEBUG_HOOKS__)`, so
`proto:build:grid` (hooks off) tree-shakes it. File `proto/grid/debugHook.ts`.

- `window.cheetahGrid = cheetahGrid` (the library's requirement; same module instance as the
  wrapper, guaranteed by `resolve.dedupe`).
- `window.__kiraGridProto`:
  - `recordIndex(pageRow): number | null`, `pageRow(recordIndex)`.
  - `cellState(pageRow, column)`: `{ text, isNull, truncated, masked, staged, search: 'none' |
    'match' | 'current', category, align, nav: 'fk' | 'pk' | null, navRect }` (viewport rects).
  - `selection()`: `{ ranges, rows, columns, active }` in page rows and column names.
  - `editor()`: `{ open, pageRow, column, value, vetoReason }` (`vetoReason` from the last refused
    edit attempt).
  - `header(column)`: `{ sort: 'asc' | 'desc' | null, sortOrder, key: 'PK' | 'FK' | null }`.
  - `rowState(pageRow)`: `{ inserted, deleted, dirty, hovered, gutterLabel }`.
  - `insertRowCount()`, `scroller()` returns nothing: specs use the real DOM
    `.cheetah-grid .grid-scrollable`.
  - `trace.start()` / `trace.stop()`: late-data metrics (§8.2).
- Dropped versus P162 §2's sketch: `cellBounds` and `cellText` (library `rect()`/`value()`).

## 6. Test helper: `apps/kira-studio/tests/proto/support/grid.ts`

Mirrors `tests/ui/support/grid.ts` (15 exports; callers found with `codegraph_explore`: `gridCell` 17
files incl. `interaction`, `data-view`, `cell-editor`, `mutations`, `mask-preview`, `slick-grid`,
`budgets`, ipc `mysql`/`clickhouse` frontend specs; `cellText` 3 files; P162 §2 counts 94 `gridCell`,
38 `cellText`, 23 `headerCell`, 23 `gutterCell`, 14 `cellNavButton` call sites). Built on
`gridLocator(page.locator('[data-testid="data-grid"]'))` plus the hook.

| Today (`support/grid.ts`) | Prototype helper | Basis |
|---|---|---|
| `gridCell(page, row, col)` → `Locator` | → `ProtoCell` (`click`, `dblclick`, `rightClick`, `hover`, `rect`, `value`, `state`) | library `cell(col, recordIndex(row))` + hook |
| `cellText` | same signature; display text (`'NULL'` for null) | library `value()` |
| `gutterCell(page, row)` | `ProtoCell` at col 0 | library `cellAt` |
| `headerCell(page, col)` | `ProtoHeader` (`click`, `rightClick`, `rect`, `state`) | library `cellAt(col, 0)` + hook `header` |
| `gridRow(page, row)` | `ProtoRow` (`state`) | hook `rowState` |
| `cellNavButton`, `clickCellNav` | `navButton(...)`: `rect`, `click`, `kind` | hook `navRect` |
| `fkPreview(page)` | unchanged DOM locator | popover is DOM |
| `insertRow(page)` | `insertRowCount(page)` | hook |
| `gridScroller`, `GRID_SCROLLER_SELECTOR` | `.cheetah-grid .grid-scrollable` | real DOM |
| `sortIndicators(page)` | `sortedColumns(page)` | hook `header` |
| `nullMarker(cell)` | `cell.state()` → `isNull` | hook |
| `gridCellSelector` | none (string selector has no canvas meaning) | budgets.spec only |
| `mutationsForScroll` | none (DOM-mutation specific) | slick-grid/budgets only |

Assertions change shape where a class was asserted: `expect(cell).toHaveClass(/pending-edit/)`
becomes `await expect.poll(() => cell.state()).toMatchObject({ staged: true })`. Count these.

## 7. Sample specs (`apps/kira-studio/tests/proto/`)

Reproduce five real excerpts against `cheetah.html?fixture=features`, setup (connect/expand/IPC
fixtures) replaced by `page.goto`. Report per spec: excerpt lines, lines changed in the asserting
body (scratch diff of the extracted excerpt vs the new body, `git diff --no-index --numstat`),
pass/fail over 3 consecutive runs.

1. `null-vs-empty.spec.ts` from `tests/ui/data-view.spec.ts` "NULL vs ''" block
   (`nullMarker(nullCell)`, `toContainText('NULL')`, empty cell `toHaveText('')`).
2. `row-selection-copy.spec.ts` from `tests/ui/interaction.spec.ts` row selection block: gutter click,
   Shift range, Control toggle, gutter drag, row context menu, `copy-rows-tsv`/`-csv`/`-json` via
   `installClipboardSpy`/`lastClipboardWrite` (`tests/ui/support/clipboard.ts`).
3. `edit-veto.spec.ts` from `tests/ui/mutations.spec.ts` `editCell` helper and the context-menu
   `edit`/Escape step of `interaction.spec.ts`, plus a veto case (masked or no-PK cell refuses edit,
   `editor().vetoReason`), using library `fill()` for the happy path.
4. `header-sort.spec.ts` from `interaction.spec.ts` header menu (`sort-asc`, `sort-desc`,
   `clear-sort`, `data-sort` attribute) and `data-view.spec.ts` sort-arrow cycle; adds a shift-click
   second term and asserts badge order `1`, `2`.
5. `nav-button.spec.ts` from `tests/ui/slick-grid.spec.ts` "P22 Pass B C11 T9" (button on every nav
   cell, absent off one, `data-nav-kind`, left offset ≤ 24 px) plus `fkPreview` open and its anchor
   within the cell rect.

Plus `parity.spec.ts`: one `test.step` per §11 feature, asserting through the hook or the DOM
(menus, popover, tooltip). This is the "verified by trying it" evidence for each verdict.

## 8. Measurements

### 8.1 Same viewport

The app probe's grid viewport is smaller than the page. Add one log line to
`tests/perf/grid-scroll.spec.ts`: `PERF viewport WxH` (from the existing `box`). Prototype probes pass
the same `?w=&h=` and the same Playwright page viewport. Row height 28 (comfortable) everywhere.

### 8.2 Probes (`tests/perf/`, existing perf config)

- `proto-grid-scroll.spec.ts`: serves `dist-proto` (hooks OFF build for fps; hooks ON build only for
  the late-data pass), loops `GRID=cheetah|slick-stock|slick-kira` (env, default all three), mouse
  over the grid, `RssSampler` + `measureFlick` over `FLICK_LADDER`. Logs the standard `PERF` lines
  with the variant in the label. Reuses `perfProbe.ts` unchanged.
- App reference: existing `NCOLS=20 grid-scroll.spec.ts`, plus a `TRACE=1` knob added to it that
  wraps each flick in `__kiraScrollTrace.start()`/`stop()` and logs `uncoveredPx` p50/p95/max.
- Runs: headless WPE (`bun run perf:probe:proto`) and headed WebKitGTK
  (`PERF_HEADED=1 xvfb-run -a bun run perf:probe:proto`). Three runs each, report the range.

**Late-data metric for canvas.** DOM grids show a blank leading edge when the compositor scrolls
past mounted rows (`uncoveredPx`). Cheetah's canvas is a sibling of the native scroller
(`.grid-scrollable` holds only an invisible sizer); `_onScroll` blits the old image and redraws the
exposed strip synchronously on each `scroll` event. So the canvas never scrolls ahead of its own
content; the failure mode is content lagging the scroll offset, or a strip left undrawn. Two
numbers, both from `trace`:

- `lagPx` per rAF: `|scrollable.scrollTop - drawnTop|`, `drawnTop` = `scrollTop` captured in a grid
  `scroll` listener (runs right after cheetah's own redraw). Direct analogue of `uncoveredPx`: how far
  painted content is from where the user scrolled.
- `blankRows` per rAF (pixel truth): `getImageData` of a 1 px column through the `id` column's text
  area for the visible rows; a row whose strip has no pixel differing from the cell background is
  blank (`id` is never NULL, so every visible row must have ink). Reported as `blankPx = blankRows *
  rowHeight`. Readback cost distorts timing, so this runs in a separate ladder pass, never in the fps
  pass.

SlickGrid side keeps `uncoveredPx` (mounted band vs viewport) for the `slick-*` variants (same
formula as `scrollTrace.ts`, computed in the probe) and the app (`TRACE=1`). Compare frames with any
gap (%) and p95/max px. Not identical metrics; the Result says so.

### 8.3 macOS protocol (user-run)

Files committed under `apps/kira-studio/frontend/proto/grid/mac/`: `wkhost.swift` (Appendix A's
harness, plus an in-process 4 Hz `proc_pid_rusage(WEBPID, RUSAGE_INFO_V2)` poll printing
`FOOTPRINT <t> <tag> <ri_phys_footprint MB>`, tag = last `document.title` mark) and `driver.js`
(waits 4 s, `MARK-idle`, then three sustained velocity bands, 40/100/200 px per frame, 60 rAF steps
each on `.grid-scrollable` or the SlickGrid viewport, `MARK-<band>` titles, `MARK-done`).

1. `bun run proto:build:grid && bun run proto:preview:grid`.
2. `swiftc -O -o /tmp/wkhost apps/kira-studio/frontend/proto/grid/mac/wkhost.swift`.
3. For each page (`empty.html`, `slick.html?variant=kira`, `slick.html?variant=stock`,
   `cheetah.html`): `/tmp/wkhost <url> 90 apps/.../driver.js 2> <name>.log`. Window 1440x960 as in
   Appendix A; DPR 2 on a Retina panel.
4. Report per page and band: idle footprint, peak, delta. Never `vmmap` for the series.
5. Frame cost and late data with a real trackpad: open `cheetah.html` (hooks build) in Safari, press
   the HUD's Trace button (calls `trace.start()`), one hard two-finger flick, Stop, paste the copied
   JSON. Same on `slick.html?variant=kira` (uncoveredPx) and in the real app
   (`__kiraScrollTrace`, `docs/PERF.md` §2.1a). One sentence on perceived smoothness and blank edges
   per page.
6. Optional: Web Inspector Timelines, one flick each, frame p95.

The plan's `## Result

Implemented at `4d08c7be` (commits e0577fcc to 4d08c7be, plus `77ea5a93` knip fix). Container
numbers ran while another agent ran WebKit clip tests on the same machine: ranges are noisy, rank
engines only.

### Commits

e0577fcc deps; 73499f6d shared wide template; 48765efb Cheetah page; 9641d9eb SlickGrid baselines;
3e403d6a selection, menus, clipboard; 3c72d75c edit, insert, layers, find, nav; d0f41e37 sort and
header; efdd9d09 hook, helper, specs; e74b84a8 perf probes; 77ea5a93 knip; 4d08c7be Mac harness.

### Gates

| Gate | Result | Status |
|---|---|---|
| G1 headless WPE, 15 flicks x3 runs | Cheetah 44-62 fps (mean 57), p95 18-38 ms, 0-1 frames over 50 ms. Slick stock 36-43 fps, kira 36-40. App 23-35 (mean 33), p95 59-111. | Fail on "every flick" (worst 44 fps, p95 38). Mean is +24 fps over app. Noisy. |
| G1 headed WebKitGTK | Cheetah 51-60 fps (mean 59), p95 19-27. App 56-59, p95 21-25. Slick kira 58-60. | Borderline: worst flick misses 58 fps and 24 ms |
| G2 late data, 40/100/200 px per frame | Cheetah lagPx 0, blankRows 0 on all 60 frames x3 bands x6 runs. Slick uncoveredPx 0. | Pass, but vacuous: programmatic scroll cannot lag. Trackpad run decides. |
| G3 Mac footprint | Not run. Harness: `proto/grid/mac/`. | Pending user |
| G4 parity | 0 impossible except live-input insert rows (equivalent works); 0 items at L | Pass |
| G5 tests | 5 sample specs + parity pass 3/3 in WebKit; unit spec 7 pass. Asserting lines changed: 78 of 88 (89 %). | Fail on changed-line bound |

Other facts: `proto:build:grid` release build holds no `__kiraGridProto`, `cheetahGrid` hook,
trace or HUD. App `dist` holds no cheetah code (one word-list false positive, "cheetah" the animal in
`en-*.js`). Bundle: Cheetah page chunk 121 KB gzip vs Slick page 50 KB. Wrapper: events, selection,
invalidate and `dataSource` all go through `rawGrid` (about 25 distinct members); only column and
theme props bind through `vue-cheetah-grid`. Its undefined `mousedown_cell` return did not break
native selection; our own `false` returns do (they also cancel column resize, so a header press on a
border returns `true`).

### Parity (verified by `tests/proto/parity.spec.ts` unless noted)

| Feature | Verdict |
|---|---|
| NULL vs empty, masked, truncated, type colour, right-align | custom S |
| Staged, search match and current layers, hover row | custom S |
| Frozen gutter, row numbers by position, row rail (dirty, deleted, inserted) | native freeze, custom S |
| Live re-theme from `--kira-*` | custom M (repaint verified, no reload) |
| Cell and range selection, keyboard nav | native |
| Row select (shift, ctrl disjoint, gutter drag), column select, select all | custom M |
| Inline edit with veto (read-only, deleted, generated, truncated, masked) | native editor, custom S veto and Escape restore |
| Insert row | live inputs per cell impossible; equivalent custom M (one editor, staged per keystroke) |
| FK/PK glyph and preview popover | custom M (preview anchored to the cell, collision-shifted at edge) |
| Context menus (cell, range, row, header, column) | custom S |
| Copy TSV, multi-cell paste | native hooks, custom S routing (`parseDelimited`) |
| Column resize | native, header border needs `mousedown_cell` pass-through |
| Column hide and show-all | custom S |
| Sort cycle, numbered multi-sort badge, PK/FK header badge | custom M |
| Header and truncation tooltips | custom S (pointermove replay at a proxy element for `AttributeTooltip`) |
| Find, go to match, hide non-matching | custom S |
| Playwright drive | native library plus custom S hook |

Known gaps: Delete key on a range clears cells to empty (native range delete), not row delete;
`paste` menu item cannot read the clipboard in Playwright (key paste verified); IME in the editor
untested; header resize floor asserted at 40 px only; DPR and fonts differ from Mac.

### Verdict

Conditional, not GO. Parity (G4) holds with one accepted impossible item. Frame cost (G1) favours
Cheetah over the app and the Slick baselines in the container, but not to the 55 fps and 25 ms bar on
every flick, and the run was contended; rerun on a quiet machine before deciding. G2 and G3 need
the Mac (trackpad lag, footprint). G5 fails as defined: the mechanical call-shape change (canvas cells
are not Locators, assertions move to `state()`) touches 89 % of asserting lines. Per section 12 that
alone is GO with a test-surface follow-up (migration phase 6).

### Final verdict: NO-GO (user decision, Mac run)

The user compared `cheetah.html` and `slick.html` on a real Mac. No visible smoothness difference.
Memory was worse on Cheetah: a larger spike that also returned to baseline more slowly. This is a
user-reported observation, not a footprint number; G3 (`wkhost`) was never run, and `wkhost.swift`
was never compiled. It matches the expected cost of canvas backing buffers (about 23 MB each at
1600x900 CSS px, DPR 2) on top of the native scroller's tile memory. The container's headless WPE
frame-rate gap did not carry over: headed WebKitGTK already ran the app at 56-59 fps against Cheetah's
51-60. SlickGrid stays; the canvas migration is dropped. P162 ships the layer fix instead. The
prototype code under `proto/grid/` stays as a comparison tool.

### Deviations

- Hooks build writes `dist-proto-hooks`, release `dist-proto` (probe serves both).
- Trace is `window.__kiraProtoTrace`, shared by both pages, not on `__kiraGridProto`; HUD hook-gated.
- Added hook `gridCol`. Toolbar (find, add row) shows only for `fixture=features`.
- Probe viewport copied from the app probe: 1104x729. Slick scroller reports 1048x700 inside it.
- `knip` `lint:dead` fails on pre-existing unused exports (`packages/shared/protocol/page.ts`, git-ui
  row menu, repo schemas); not touched, outside scope. No proto finding remains.
- `codegraph_explore` calls in this implementer run: 2.

### What the user runs on the Mac

`docs/DEV_ENVIRONMENT.md` "Grid prototype (P165)": wkhost footprint for the four pages (G3), and a
trackpad flick with the HUD on `cheetah.html?fixture=features` and `slick.html?variant=kira` (G2).
`wkhost.swift` is not compiled in the sandbox. Open both pages in two windows on the same data.
