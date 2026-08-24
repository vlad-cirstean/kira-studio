# P24 — Search-as-filter, the cell editor's translate panel, and a design-cohesion sweep

> Not an original SPEC.md §10 deliverable line — P24 is user-directed, reported against shipped
> work, the same way P13's, P16's and P22's rows exist despite not mapping to one original spec
> sentence. Three asks, verbatim:
>
> 1. *"When searching it should have a button to actually only show the rows that match."*
> 2. *"Fix the cell editor. Move dates to the translate panel as well that parses in both
>    directions what I change in real time. Improve the date picker to be much more expressive."*
> 3. *"Check if there are design discrepancies and where it could be improved to be more cohesive
>    or better looking, then implement them."*
>
> **Why one phase and not three.** They are not independent. (2) and (3) meet at the same place:
> the timestamp picker is the last piece of **system** chrome left in `src/renderer` after P22
> removed the native tooltip — a bare `<input type="datetime-local">` whose only concession to the
> theme is a `color-scheme: dark` hack (`CellEditorView.vue:549-554`), so "make the picker
> expressive" and "make the app cohesive" are the same edit. (1) and (3) meet at LAW 15, which
> names *"no matching rows"* as one of the four empty states the design already specifies and the
> app does not yet have. And all three land in the renderer only: nothing in this phase touches an
> adapter, the engine host, IPC, storage, or any tab schema. There is one **shared** vocabulary
> change (`formatBytes`, `EmptyState`'s slot, `SegmentedControl`'s generic, `.p-def-*`) and
> splitting it across three phases would mean writing it three times.

## 0. Ground rules for this phase

- **Search never issues a query, and must not start looking like it does.** LAW 16 is explicit:
  *"Filter narrows the query; search walks what you already have."* The new toggle hides rows the
  client already has. It resets no paging, invalidates no cache, produces no op-log row, and the
  toolbar keeps saying *"in the N loaded rows"* next to the field. `FilterToolbar.vue`'s
  `WHERE`/`ORDER BY` is a different feature on a different row and is **not touched** (D13).
- **No second copy of any row data.** §2.2's columnar/frozen-page discipline (`views/grid/page.ts`'s
  own *"NOT reactive — a Proxy around 600 000 cells is the frame budget"*) holds. The filter is a
  list of row **indices**, never a rebuilt page (D3).
- **The cell editor's buffer stays the single source of what Save stages.** Every new control writes
  `doc` and nothing else; staging remains `onEditorBlur` / `Ctrl+Enter` / an explicit action. The
  translate panel does not stage per keystroke (D15).
- **No new dependency.** No date library, no `Intl` polyfill, no calendar component from npm. The
  app already computes local/UTC readings by hand (`detect.ts:389-397`) and already owns a stepper
  (`primitives.css:179-206`), a popover (`PopoverPanel.vue`) and a floating surface (`.p-float`).
- **The design work is a sweep against a written source, not taste.** Every item in §1's F7–F16 is
  a measurable divergence from `docs/v1/design/kira-design-system/parts/_style.css` or from one of
  its sixteen numbered LAWs (`parts/bodies/System.html:420-437`). Anything that is only an opinion
  goes in §9, not in §3.
- **No half-implementations.** A discrepancy that is fixed is fixed everywhere it occurs — four
  hand-rolled page-size pickers, five duplicated definition-section stylesheets, three byte
  formatters — or it is named in §6 and left entirely alone.
- Comments per AGENTS.md: only where the code cannot say it for itself. Every `D` below that
  encodes a non-obvious constraint gets one line at its implementation site, never a paraphrase.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` throughout;
  `xvfb-run -a bun run test:ui` from step 3 on. `bun run test:db` is untouched — no adapter,
  engine, protocol or SQL change anywhere in this phase.
- Commits follow Conventional Commits, one per step of §4: `feat(grid): …`, `fix(cell editor): …`,
  `refactor(theme): …`, `test(ui): …`, `docs: …`.

## 1. Findings (verified against the tree, not assumed)

### Search / grid

**F1 — the find widget has no filter mode, and everything it needs already exists.**
`views/grid/search.ts:46-103`'s `runSearch` produces `Match[]` **in ascending row order** (outer
loop `row`, inner loop `col`, `:76-89`), so the distinct set of matching rows is a de-duplication of
`matches[].row` and needs no second scan. `searchState` (`:28`) is already `reactive` and already
shared with `DataGrid.vue` (`DataGrid.vue:462-482` reads it for highlighting), and already
self-cleans through `registerTabRuntimeCleanup` (`:35`). The toolbar is mounted only while
`runtime[tabId].searchOpen` is true (`DataView.vue:142-147`), which is the state a filter must be
scoped to.

**F2 — the grid is virtualized on the identity `display position === page row index`, in seven
places.** Every one of them has to go through one indirection for filtering to work, and none of
them is subtle: `totalHeight` (`DataGrid.vue:182-184`), `rowRange` (`:256-264`), `visibleRowIndices`
(`:271-275`), the row's `top` style (`:1043`), the gutter number `rowNumberBase + r + 1` (`:1057`),
`scrollCellIntoView`'s `rowTop` (`:867`), and the pending-insert rows' `top`
(`:1129-1132`). Two more consume `p.rowCount` as "every row there is": `columnValuesFor`
(`:690-699`, the header menu's *Copy column values*) and `onCopy`'s column branch (`:801-812`).
Keyboard nav clamps against `p.rowCount - 1` (`:936`).

**F3 — `setVisibleWindow` is a cache-clearing hint, not a correctness contract.**
`page.ts:63-71` clears the decoded-string cache when the `${startRow}:${endRow}` key changes;
`cell()` (`:79-93`) decodes lazily per cell regardless. Passing the min/max page row of a
*non-contiguous* visible slice is therefore correct — it can only make the cache live slightly
longer, never decode a cell nobody rendered.

**F4 — the grid's empty state is the one LAW 15 case the app already has, and the design names a
second one it does not.** `DataGrid.vue:979-985` renders `EmptyState icon="table" label="No rows"`.
LAW 15 reads: *"Every empty region says what is missing and offers the one action that fills it —
no tabs, no connections, no results **and no matching rows** all use the same centred object."*
`EmptyState.vue` today has no way to offer an action (its own comment: *"No current call site puts
anything besides icon+label inside it"*), and `ReconnectGate.vue` is the separate button-bearing
sibling. This phase creates the first call site that needs both.

**F5 — the four in-page search toolbars have already drifted.** `views/grid/SearchToolbar.vue` (212
lines), `views/documents/DocumentSearchToolbar.vue` (189), `views/keyvalue/KeyValueSearchToolbar.vue`
(188) are near-identical clones — same three matcher toggles, same counter, same *"in the N loaded
rows"* label. `views/stream/StreamSearchToolbar.vue` (95) is a reduced variant with **no**
case/word/regex toggles and no inline regex-error reporting. Only the grid's autofocuses its input
on open (`SearchToolbar.vue:104-110`); the other three require a click into the field before typing.

**F6 — the grid's Search toolbar button has no pressed state.** `DataToolbar.vue`'s
`icon="search" data-testid="toolbar-search"` never binds `:active`, although `IconButton` supports
it and every other toggle in the app uses it (`SearchToolbar.vue:139-159`, `ColumnsMenu`'s trigger).
Pressing it twice looks like nothing happened, because the toolbar it opens is below the fold of a
short viewport.

### Cell editor

**F7 — six real defects, found by reading, each reproducible.**

| # | Site | Defect |
|---|---|---|
| a | `CellEditorView.vue:143-145` | `resetDisabledTitle` returns `undefined` when `isDirty` — so the **enabled** Reset button has no hover hint at all. This is character-for-character the bug the file's own comment at `:130-132` records having fixed *for the two beautify buttons* (*"these two buttons previously had no title at all once enabled"*); Reset was missed in the same pass. |
| b | `CellEditorView.vue:199-226` | `skipNextDecode` is a one-shot flag armed **before** the write that is supposed to consume it. When `encodeFromText` returns a string equal to the current `doc` (edit the decoded pane to text that re-encodes identically), the watcher at `:209-219` never fires, the flag stays armed, and the **next** genuine edit of the encoded pane is silently swallowed — the decoded pane goes stale with no way back except reselecting the cell. |
| c | `detect.ts:459-464` | `encodeTimestamp(format:'iso8601')` is `d.toISOString()` unconditionally. Postgres's own `timestamptz` text output is `2024-01-15 10:23:45+00` (that exact shape is why `parseIso8601` at `:421-427` exists and carries a nine-line comment about V8's two parsers). Picking the *same moment* the cell already holds therefore rewrites `2024-01-15 10:23:45+00` into `2024-01-15T10:23:45.000Z` — a different separator, a different offset spelling, and three digits of precision the column never had. The picker cannot round-trip its own input. |
| d | `CellEditorView.vue:228-241` + `beautify.ts:519-529` | Beautify is applied to `c.value`, the **stored** value, never the buffer. Hand-edit the JSON, press Beautify, and the edit is discarded without a word. Worse, `if (formatted.value === mode) return;` (`:231`) means that after one Beautify the same button is inert, so there is no way to re-format your own edit at all. |
| e | `CellEditorView.vue:311-323` | `statusLine` measures `c.value` (stored) while `timestampReading` (`:328-331`) reads `doc` (buffer). Two readings a few pixels apart disagree the moment you type. It also allocates a `new TextEncoder()` per recompute, on the 50 ms selection path (§2.1). |
| f | `CellEditorView.vue:512-532` / `celleditor/state.ts:8` | A value the engine cut at `MAX_CELL_BYTES` is fully editable in both the panel and the grid's inline editor (`DataGrid.vue:519-524` seeds `editingBuffer` from the truncated text). Editing it and committing writes the **truncated** value over the full one. `ReadOnlyReason` already anticipates this exact case in its own doc comment: *"A future phase may add `'value-truncated'` for a cell whose full value was never fetched."* |

**F8 — the timestamp affordance is a single-line strip, not a pane, and it commits on `change`.**
`CellEditorView.vue:423-443` renders `.timestamp-row` (a `.p-strip note`) with a local reading, a
UTC reading and a bare `<input type="datetime-local" step="1">`. It fires `onTimestampPick`
(`:176-187`) on `change` only — i.e. on blur or on the browser's own commit — and because the strip
sits **outside** `.editor-body`, no `focusout` ever reaches `onEditorBlur`, so the handler calls
`saveEdit()` itself (`:186`), staging a pending edit from what was meant to be an exploratory pick.
Contrast the hex/base64 path (`:449-488`): a real second pane *inside* `.editor-body`, in
bidirectional lockstep on every keystroke, staged by the same blur rule as the main editor. The ask
is that dates behave the way hex/base64 already do.

**F9 — the picker is the last piece of system chrome in the renderer.** After P22 removed all 123
native `title` attributes, `CellEditorView.vue:549-554` is the only remaining place that renders
OS-drawn UI and then apologises for it in a comment (*"Chromium's own datetime-local chrome … doesn't
inherit `color` for every part no matter what `.p-input` does — color-scheme is the one lever"*).
`.p-select` had the same problem and was solved the app-owned way (`primitives.css:208-274`'s
`appearance: base-select` + `::picker(select)`), which is the standing precedent.

**F10 — the panel never says it is modified, though the mockup does.**
`parts/bodies/CellEditor.html:105-109` shows the panel's trailing group as
`<span class="p-chip warn">modified</span>` plus Cancel/Apply. The implementation deliberately
dropped Cancel/Apply for blur-to-stage (a good call — `cell-editor.spec.ts:460` asserts there is
no Save button) but dropped the chip with them, so `isDirty` (`:262`) exists purely to enable one
icon button. There is no visible signal that the buffer diverges from the stored value.

### Design system

**F11 — the icon scale has ten steps in the implementation and two in the design.** LAW 02: *"Every
icon occupies a 16px box with a 13px glyph inside it. Icons are never sized to their control."*
`_style.css:46` is `.icon { width: 13px; height: 13px }`; the only other size in the whole system is
`.p-empty .big` at 24px (`:227`). Measured in `src/renderer`, `:size="…"` resolves to: **12** (39
sites), **14** (29), **13** (19), **24** (3), **11** (3), **10** (2), **9** (2), and one each of 16,
22 and 32. `IconButton.vue:16`'s own default is `size: 14`, so every call site that omits `:size`
renders 14. `ViewChrome.vue:61,68` passes `:size="13"`; `DataToolbar.vue`'s Refresh/Stop right next
to it in the same visual slot pass nothing and render 14.

**F12 — eleven raw font-sizes against a five-step scale, in five files.** `font-size` values in
`src/renderer`: `var(--kira-t-sm)` ×31, `--kira-t-xs` ×26, `--kira-t-md` ×19, `--kira-t-lg` ×3,
`--kira-t-xl` ×1 — and then `9px` ×4 (`DataGrid.vue:1223,1230`, `TreeRow.vue:236`,
`IconButton.vue:53`), `11px` ×4 (`OperationsPanel.vue:266,301,414`, `TreeRow.vue:251`), `12px` ×2
(`TabStrip.vue:202`, plus `tokens.css:44`'s own default) and `10px` ×1 (`ProjectTree.vue:202`).
`9px` is off the bottom of the scale entirely (`--kira-t-xs` is 10px).

**F13 — four hand-rolled copies of a primitive that exists, each with the same four-line CSS
override, each with a comment saying why it wasn't fixed.** The page-size picker is
`<div class="p-seg">` + `v-for` + `:class="{ active: … }"` in `DataToolbar.vue:289-299`,
`KeyValueView.vue:454`, `StreamView.vue:463`, `DocumentView.vue:504`, each followed by
`.p-seg > button.active { background: var(--kira-bg-input); color: var(--kira-fg); }`
(`DataToolbar.vue:437-441`, `KeyValueView.vue:709-713`, `StreamView.vue:826-830`,
`DocumentView.vue:804-808`) restating what `primitives.css:303-306`'s `.p-seg > .on` already says.
`DataToolbar.vue:285-288` records the reason verbatim: *"tabs.spec.ts/leaks.spec.ts assert
`toHaveClass(/active/)` on these buttons, and `SegmentedControl.vue` … only ever applies `.on` —
swapping components here would silently break those tests (rule 3: correctness over consistency)."*
The blocking assertions are exactly **two**, both in `leaks.spec.ts:263` and `:273`.
`SegmentedControl.vue` is generic over `T extends string` only, which is the one real (one-word)
obstacle, since page sizes are numbers.

**F14 — the definition view's five sections duplicate ~40 lines of stylesheet, five times.**
`ColumnsSection.vue`, `IndexesSection.vue`, `ConstraintsSection.vue`, `ValidationSection.vue` and
`PropertiesSection.vue` each define their own `.def-section`, `.def-section-head`,
`.def-section-title`, `.def-table`, `.def-row`, `.def-table td`, `.mono`, and four of them also
`.def-head-row th` — byte-identical between files. All five carry `font-weight: 600` on the section
title (`ColumnsSection.vue:96`, `IndexesSection.vue:53`, `ConstraintsSection.vue:96`,
`ValidationSection.vue:68`, `PropertiesSection.vue:48`) and four carry `font-weight: 400` on the
table head to undo it. **`parts/_style.css` declares `font-weight` exactly zero times** — the design
builds hierarchy from colour, size, case and letter-spacing only (`.p-panel-head`,
`primitives.css:461-473`, is the system's one section-label idiom). The remaining `font-weight`
sites in the app are `OperationsPanel.vue:319` (`600`) and `MainView.vue:168` (`500`).

**F15 — three byte formatters, two unit conventions.** `StatusBar.vue:21` and
`SettingsDialog.vue:94` divide by `1024*1024` and print `MB`; `KeyValueView.vue:126-129` prints
`B` / `KiB` / `MiB`. The cell editor prints a raw `${n} bytes` (`CellEditorView.vue:318`) where the
mockup shows `1.2 KB` (`parts/bodies/CellEditor.html:97`). No shared helper exists;
`src/renderer/clipboard.ts` is the precedent for a small renderer-root utility module.

**F16 — assorted, each one line.**
- `TabStrip.vue:191-215` re-implements `.p-tab` (`primitives.css:309-327`) locally: same height,
  padding, radius, transparent border, hover and active rules, but `font-size: 12px` instead of
  `--kira-t-sm` and `max-width: 220px` instead of the primitive's 210, plus raw `gap: 2px` /
  `padding: 2px 4px 0` on the strip itself.
- `TreeRow.vue:234-242`'s `.badge` re-implements `.p-count` with `font-size: 9px` and
  `border-radius: 3px` — neither value is on any scale (`--kira-radius-sm` is 4px). `.detail:251`
  is `font-size: 11px` = `--kira-t-sm`.
- `ProjectTree.vue:199-206`'s `.search-incomplete-note` uses `padding: 4px 8px` / `font-size: 10px`
  where `--kira-s-2 --kira-s-4` / `--kira-t-xs` say the same thing, and is a *note* in LAW 13's
  sense (`.p-strip.note`) rendered as a bare div.
- `OperationsPanel.vue` is the single largest off-scale file: `font-size: 11px` ×3, `gap: 8px` ×3,
  `padding: 4px 8px` / `2px 8px`, `gap: 4px` ×2, `height: 20px` ×4, and a hand-rolled
  `.clear-button` (`:344-352`) with its own border/radius/padding instead of `<AppButton>` —
  using `--kira-radius` (6px, the *panel* tier) on a button the scale puts at `--kira-radius-sm`.
- `DataToolbar.vue:441-443` re-declares `.p-iconbtn.is-live`, which `primitives.css:60-67` already
  defines globally (and whose comment says it was hoisted there *from this file*).
- `TextField.vue:58` and `AutocompleteField.vue:208` both apply an `is-invalid` class that **no
  stylesheet defines**; the actual red border comes from an inline `:style` next to it
  (`TextField.vue:59`). A dead class and an inline style doing one job.
- `DocumentView.vue:654` and `KeyValueView.vue:600` render `<EmptyState :label="rt ? '…' : ''" />`
  with no `icon` — before the first load lands, both draw a **literally blank** centred box. LAW 15:
  *"Empty is a state, not a blank."*
- `DataView.vue:123-131` passes `ViewHeader` no badges at all, so the grid — the app's primary view,
  and the one the mockup specifies in the most detail (`parts/bodies/CellEditor.html:16-21`: kind,
  row count, column count, read-write, plus a trailing primary-key chip) — has the least
  informative header in the app. KeyValue has four badges, Definition two, Documents one.

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/grid/search.ts — additions only; runSearch/searchState/Match unchanged.

/** Per-tab "hide non-matching rows" toggle. Separate from `searchState` because it must survive
 *  the query being cleared and retyped, which deletes that entry (clearSearchState). */
export const searchFilterState = reactive({} as Record<string, boolean>);

export function isSearchFiltering(tabId: string): boolean;
export function setSearchFiltering(tabId: string, on: boolean): void;

/** Ascending, de-duplicated page-row indices that contain at least one match — or `null` when the
 *  filter is off or there is no completed scan to filter by (an empty query shows every row, D7).
 *  Cheap: `runSearch` already emits matches in ascending row order, so this is one pass with no
 *  sort and no Set. Reads `entry.matches` and never `entry.index`, so prev/next does not
 *  invalidate it. */
export function matchedRows(tabId: string): number[] | null;
```

```ts
// src/renderer/views/celleditor/timestamp.ts — NEW. Everything timestamp-shaped moves out of
// detect.ts, which is about *detection* and today carries 130 lines of unrelated date math.

/** The spelling a value already uses, so re-encoding is byte-shape-preserving (F7c/D16). */
export interface TimestampShape {
  kind: 'epochSeconds' | 'epochMillis' | 'iso8601';
  /** iso8601 only: ' ' or 'T' — Postgres emits a space, JSON emits 'T'. */
  separator: ' ' | 'T';
  /** iso8601 only: how the original spelled its offset. 'none' = a bare local/UTC clock time. */
  offset: 'none' | 'Z' | '+HH' | '+HH:MM' | '+HHMM';
  /** iso8601 only: the offset's own minutes from UTC, so re-encoding keeps the original zone. */
  offsetMinutes: number;
  /** iso8601 only: digits of sub-second precision in the original (0-9). */
  fractionDigits: number;
  /** iso8601 only: true when the original had no time part at all (a `date` column). */
  dateOnly: boolean;
}

export function parseTimestamp(format: CellFormat, text: string):
  { date: Date; shape: TimestampShape } | null;

/** Exact inverse of parseTimestamp for every shape it can produce — `parse ∘ encode` and
 *  `encode ∘ parse` are both identity on a value the cell already held (D16). */
export function encodeTimestamp(shape: TimestampShape, date: Date): string;

export interface TimestampReading { local: string; utc: string; relative: string }
export function describeTimestamp(format: CellFormat, text: string): TimestampReading | null;

/** 'YYYY-MM-DD HH:mm:ss' in the chosen zone — what the translate pane's editable field shows. */
export function toEditableText(date: Date, zone: 'local' | 'utc', fractionDigits: number): string;
/** Its inverse; `null` for anything that isn't a complete, in-range datetime (D15's invalid state). */
export function fromEditableText(text: string, zone: 'local' | 'utc'): Date | null;

/** "3 days ago" / "in 2 hours" / "just now" — Intl.RelativeTimeFormat, no dependency (D18). */
export function relativeTime(date: Date, now: Date): string;
```

```vue
<!-- src/renderer/views/celleditor/TimestampPane.vue — NEW. The translate pane for the three
     timestamp formats, the sibling of the hex/base64 decoded pane. Bidirectional, live, and
     inside `.editor-body` so it inherits the existing focusout/Ctrl+Enter staging (D15). -->
<!-- props: { doc: string; format: CellFormat; readOnly: boolean }
     emits:  { 'update:doc': [string] } -->
```

```vue
<!-- src/renderer/views/celleditor/DateTimePicker.vue — NEW. The app-owned calendar + clock,
     opened from TimestampPane's calendar button, hosted in the existing PopoverPanel (D18).
     No native input anywhere; the `color-scheme: dark` hack goes with it. -->
<!-- props: { modelValue: Date; zone: 'local' | 'utc' }
     emits:  { 'update:modelValue': [Date] } -->
```

```ts
// src/renderer/format.ts — NEW, sibling of clipboard.ts (F15/D35).
/** '842 bytes' / '1.2 KB' / '3.4 MB'. Decimal KB/MB, one convention app-wide. Under 1024 the
 *  word stays "bytes" — it reads as a count there, not a unit. */
export function formatBytes(n: number): string;
```

**The `.p-def-*` block** (F14/D31) moves verbatim into `theme/primitives.css` under a
`/* ---------- definition-view sections ---------- */` heading, with `font-weight` dropped and the
title adopting `.p-panel-head`'s own idiom (`--kira-t-sm`, `--kira-fg-muted`, uppercase,
`letter-spacing: 0.05em`). The five components delete their `<style scoped>` duplicates and keep
only what is genuinely theirs (`ColumnsSection`'s `.def-col-icon`, `ConstraintsSection`'s
`.header-key`, `ValidationSection`'s `.def-raw`, `PropertiesSection`'s `.def-prop-detail`).

## 3. Decisions

### Topic 1 — search that filters

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **A filter *mode* on the existing find widget — one toggle button in `SearchToolbar.vue` — not a new toolbar, not a new state module, not a change to `runSearch`.** | The ask is one button. The scan already produces exactly the data a filter needs, in the order it needs (F1), so the whole feature is a derived selector plus a render indirection. A second toolbar would also break LAW 09's fixed three-row opening and put a second thing on screen that looks like the `WHERE` row. |
| D2 | **The flag lives in `views/grid/search.ts` as `searchFilterState`, beside `searchState`, and registers its own `registerTabRuntimeCleanup`** — not in `DataViewRuntime` (`views/grid/state.ts:19-31`). | `searchState` is deleted every time the query goes empty (`SearchToolbar.vue:39-42` → `clearSearchState`), so the toggle cannot live inside it and survive a retype. `DataViewRuntime` is the *data-loading* record (status, opId, tokens, count, meta) that `load()` owns; a find-widget mode has nothing to do with it, and `search.ts` is already the module both the toolbar and the grid import. Cleanup registration is the pattern that module already uses (`search.ts:35`). |
| D3 | **`DataGrid.vue` gains one computed, `displayRows: number[] \| null`, and renders positions through it. `page.ts`, `getPage`, `setPage`, `TabularPage` and the pending-change set are untouched.** `null` means "unfiltered", and every derived expression short-circuits to today's arithmetic in that case. | §2.2 forbids materialising rows; a filtered *page* would be a second copy of up to 10 000 rows' worth of structure per tab. An index list is `matches.length` numbers at worst and is dropped the moment the toggle goes off. Keeping `null` as the unfiltered sentinel — rather than always building `[0..rowCount)` — means the common path allocates nothing at all and the frame budget in `budgets.spec.ts` is unchanged by construction, not by measurement. |
| D4 | **The gutter keeps showing the row's real number** (`rowNumberBase + row + 1`), so a filtered grid reads `3, 17, 84, …`. | The jump in the numbers *is* the affordance that says rows are hidden — the same reason the design keeps the row-number gutter at all. Renumbering 1..N would make a filtered grid indistinguishable from a short table, which is precisely the failure LAW 16's *"closing it hid the reason a table looked short"* is written against. |
| D5 | **Pending insert rows are never hidden**, whatever the filter says; they render after the last *visible* row. | An unsaved row the user just added is not a search result, it is work in progress. Hiding it would read as data loss, and `runSearch` cannot match it anyway (it walks the frozen page, not the pending set). Their positions move from `page.rowCount + idx` to `displayRowCount + idx`; their *identity* (the pseudo row index the gutter click and `pendingChanges` use) stays `page.rowCount + idx`. |
| D6 | **The match counter, prev and next are unchanged while filtering.** `n of m` still counts every match, and next/prev still cycle all of them. | Every match is by definition inside a visible row, so there is no such thing as "jumping to a hidden match" — nothing to special-case. `goToMatch` is the one call that needs translating: `DataView.vue:112-114` → `scrollCellIntoView(row, col)` → the row's `top` must be computed from its *display position*, which `displayPositionOf(row)` provides. |
| D7 | **An empty query shows every row, with the toggle still lit; closing the toolbar (or unmounting it) turns the toggle off.** | Hiding every row because the field is empty would be a trap. Keeping the toggle lit means clearing and retyping resumes filtering, which is what a mode means. Turning it off on close is non-negotiable: a closed toolbar that leaves rows hidden is a grid lying about its contents with no visible cause. Implemented in `close()` and `onUnmounted` next to the existing `clearSearchState` calls (`SearchToolbar.vue:88-92`, `:112-115`), plus the `registerTabRuntimeCleanup` of D2. |
| D8 | **Filter on, zero matches ⇒ `EmptyState icon="search" label="No matching rows"` with a *Show all rows* action that turns the toggle off.** `EmptyState.vue` gains a default slot for that action. | LAW 15 names *"no matching rows"* as one of its four cases and requires *"the one action that fills it"*. `EmptyState.vue`'s comment declining a slot (*"no current call site puts anything besides icon+label inside it"*) was accurate and is now out of date — this is that call site. The slot is additive: all six existing call sites keep rendering exactly as they do. |
| D9 | **Icon `filter`; `data-testid="search-filter-rows"`; sits in its own group between the matcher toggles and the counter, separated by `.sep` on both sides; tooltip `Show only matching rows` / `Showing only matching rows — click to show all`.** The trailing scope label gains a filtered form: `showing N of M loaded rows` (`data-testid="search-scope"`). | `filter` is the one filter glyph verified present in the pinned codicon build — three existing call sites render it (`OperationsPanel.vue:161`, `StreamView.vue:545`, `FiltersDialog.vue:109`). VS Code's own tree find widget uses the `list-filter` variant for exactly this Highlight/Filter mode switch, which is the interaction being copied, but that name cannot be verified against this repo's `node_modules` and is not worth guessing at for a glyph difference. The testid follows the three siblings' `search-<what>` convention (`search-match-case` / `search-whole-word` / `search-regex`), not a `search-toggle-` prefix that exists nowhere in the tree. Placement encodes the meaning: `case/word/regex` say *how to match*, the filter and prev/next say *what to do with the matches*. |
| D10 | **While filtering, *Copy column values* (`columnValuesFor`, `DataGrid.vue:690-699`) and a column selection's copy (`onCopy`'s branch at `:801-812`) walk the visible rows only.** | Both are "copy this column" from the user's point of view, and the column they can see has N rows. Copying 10 000 values from a grid showing 12 is the kind of silent mismatch that turns into a bad paste into a spreadsheet. Row and cell/range copy are unaffected — they already address explicit selections. |
| D11 | **Arrow-key navigation moves within the visible rows.** `ArrowUp`/`ArrowDown` (`DataGrid.vue:931-937`) step by display position and clamp to `displayRowCount - 1`. | Otherwise ArrowDown walks into rows that are not drawn: the selection vanishes, `publishSelectedCell` fires for an invisible cell, and the cell editor shows a value with nothing highlighted anywhere. Left/Right are untouched (columns are not filtered). |
| D12 | **Scope: the SQL grid only.** `DocumentSearchToolbar`, `KeyValueSearchToolbar` and `StreamSearchToolbar` do not get the toggle in this phase. | The grid is the surface named in the ask, and it is the only one where the feature has real design content — virtualization by absolute row offset, a row-number gutter, keyboard navigation, pending inserts. The other three render a plain `v-for` over an index array (`DocumentView.vue:287-289,657`), where the same feature is one `.filter()` and no decisions; adding it there later is a five-line change against the exact `matchedRows()` shape D2 introduces. Doing it now would also mean first bringing `StreamSearchToolbar` up to the other three's feature level (F5), which is unrelated work. §6 records this. |
| D13 | **The filter is never mistaken for the `WHERE` row: no server call, no paging reset, no `filter_history` entry, no change to `FilterToolbar.vue`, and the scope label keeps saying "loaded rows".** | LAW 16 and README's *"Search walks the loaded rows only and never issues a query"* are the whole reason these are two separate toolbars. The one behavioural guarantee that must be *tested*, not just intended, is that toggling the filter adds zero rows to the op log — §5 asserts it. |

### Topic 2 — the cell editor

| # | Decision | Rationale |
|---|----------|-----------|
| D14 | **The "decoded pane" generalises into a **translate pane**: one head strip (`.translate-head`), one body, chosen by format. Hex/base64 keep the plaintext CodeMirror they have; the three timestamp formats get `TimestampPane.vue`.** `.editor-body`'s modifier class becomes `has-translate` (was `has-decoded`), and the 55/45 split, the divider and the head styling are shared verbatim. | This is the ask read literally: *"move dates to the translate panel as well"*. It is also the only structural change that makes the timestamp path inherit everything the hex path already got right — living inside `.editor-body` means `@focusout`/`@keydown` (`CellEditorView.vue:449-454`) cover it, which is what makes D15 possible. Two panes with one head, one split and one staging rule is strictly less code than the strip-plus-pane arrangement it replaces. |
| D15 | **`TimestampPane` is bidirectional and live, keystroke by keystroke, and stages nothing itself.** Typing in the pane rewrites `doc` on `input`; editing `doc` rewrites the pane. The eager `saveEdit()` call in `onTimestampPick` (`CellEditorView.vue:186`) is **deleted** along with the native input, because `focusout` now reaches `onEditorBlur` on its own. | *"parses in both directions what I change in real time"* is the ask, and it is what `onDecodedInput`/`syncDecodedFromDoc` already do for bytes. Deleting the eager stage is the point, not a side effect: today, touching the picker at all stages a pending change, so the panel cannot be used to *look* at a date. With the pane inside `.editor-body`, the file ends up with exactly one staging rule (blur or Ctrl+Enter) instead of one rule plus two exceptions — `generateUuid` (`:153-160`) keeps its own call because its button genuinely does sit in the header, and that is then the only documented exception. |
| D16 | **Re-encoding preserves the value's own shape.** `parseTimestamp` returns a `TimestampShape` alongside the `Date`; `encodeTimestamp` takes that shape. A cell holding `2024-01-15 10:23:45+00` gets back `2024-01-15 11:00:00+00`, never `…T…000Z`. | F7c is a real defect: the picker cannot round-trip its own input on the app's single most common temporal value. `parseIso8601`'s existing nine-line comment already establishes that this codebase treats Postgres's exact text output as authoritative rather than normalising it, and that reasoning applies just as hard on the way out. `epochSeconds`/`epochMillis` have no shape to preserve beyond the unit, which `kind` carries. |
| D17 | **All timestamp code moves from `detect.ts` into a new `views/celleditor/timestamp.ts`.** `detect.ts` keeps `ISO8601_RE` for `detectIso8601` and keeps `describeValue`; `parseIso8601`, `parseTimestampValue`, `describeTimestamp`, `encodeTimestamp`, `toDatetimeLocalValue`, `fromDatetimeLocalValue`, `formatUtcAndLocal`, `MONTH_ABBR`, `pad` and `TimestampReading` move out. | `detect.ts` is 517 lines of which 130 have nothing to do with detection, and this phase roughly doubles that half. The module's own doc comments say what it is for (*"a scored guess"*); date arithmetic, zone conversion, shape preservation and relative formatting are a second subject that two new components both import. The split is mechanical and has no behavioural content. |
| D18 | **The picker is app-owned: `DateTimePicker.vue`, a month grid plus hour/minute/second steppers plus a *Now* button, inside the existing `PopoverPanel`. No `<input type="datetime-local">` survives, and `color-scheme: dark` goes with it.** Relative time (`"3 days ago"`) comes from `Intl.RelativeTimeFormat`, which needs no dependency. | *"Much more expressive"* against a control that is one opaque OS widget means: see the month you are picking in, see today, see the selected day, step the clock, and read back what the moment means in words. It is also the direct continuation of P22's ruling — *"show them in an app owned element, not with the system one"* — applied to the one place it was still true (F9), and `.p-select`'s `::picker(select)` work is the standing precedent for refusing to live with native chrome. Every piece is already in the toolbox: `PopoverPanel` anchors and closes it, `TextField type="number"` already draws app-owned steppers (`primitives.css:179-206`), `.p-float` is the surface, `.p-row` is the day cell. |
| D19 | **The editable field has an explicit `Local | UTC` zone switch (a `SegmentedControl`), and the switch changes only how the field is *displayed and parsed* — never the stored value.** Both readings stay visible; the inactive one is muted. | An epoch column is UTC and a `timestamp without time zone` is whatever the backend meant; the current picker offers local wall-clock only and never says so, which is how you set a value an hour off and never notice. Making the zone a visible, switchable property of the *editor* rather than an invisible property of the *widget* is what turns a picker into a translator. Flipping the switch must be provably value-preserving — §5 asserts `doc` is byte-identical across a toggle. |
| D20 | **The encode↔decode loop guard becomes value equality, not a one-shot flag, and both panes use the same helper.** `if (next === doc.value) return;` before arming, so the flag can never outlive the write it was armed for. | F7b is a latent stale-state bug today and would be duplicated verbatim by the new pane, since a timestamp round-trip is *far* more likely than a byte one to re-encode to an identical string (any edit inside a sub-second component that the shape rounds away). One helper in `CellEditorView.vue`, used by `onDecodedInput` and by the timestamp pane's update handler, is the smallest correct form. |
| D21 | **Beautify acts on the buffer (`doc`), not on the stored value, and the `formatted === mode` early return is deleted.** `beautify.ts`'s own doc comment (`:519-524`) is updated to match. | F7d: silently discarding a hand-edit is the worst possible response to a formatting button. Reversibility — the stated reason for the stored-value rule — is preserved anyway, because both modes are lossless and Reset still restores `cell.value` outright; indented→compact→indented is a round trip whether it starts from the buffer or the store. Removing the early return is what makes Beautify usable more than once per cell. |
| D22 | **`formatted` resets to `'none'` whenever `doc` changes by any path other than `applyBeautify`.** | Otherwise the Beautify button stays lit (`:active`) over text that is no longer beautified, and `data-formatted` — which `cell-editor.spec.ts:318,323,327` asserts on — reports a formatting the buffer no longer has. |
| D23 | **`statusLine` reads the buffer, not the stored value, and its byte count goes through `formatBytes` (D35).** The `TextEncoder` is hoisted to module scope. | F7e: two readings that disagree while you type is worse than either alone, and the timestamp reading already picked the buffer as the right answer. `1.2 KB` is what the mockup shows (`parts/bodies/CellEditor.html:97`). Hoisting the encoder takes one allocation off the 50 ms selection path §2.1 budgets. |
| D24 | **`resetDisabledTitle` becomes `resetTitle`: `'Reset to the stored value'` when enabled, `'Already showing the stored value.'` when not.** | F7a, and it is the same fix the file already applied to its two neighbours for the same reason (`:130-132`). `tooltips.spec.ts`'s own disabled-control scenario covers the shape; §5 adds the enabled half. |
| D25 | **The panel shows a `modified` chip and carries `data-dirty` on its root.** | F10, mockup parity, and `isDirty` already computes it. It is also the only way, today, to know that Ctrl+Enter did anything — the feedback is a tint on a grid cell that may be scrolled out of view. |
| D26 | **Escape inside the editor body reverts the buffer** (calls `resetBuffer`, i.e. also un-stages via `onRevert`), mirroring `DataGrid.vue`'s inline editor (`:544-553`). | The panel currently has no keyboard way to abandon an edit, and its one Revert affordance is a mouse-only icon in the header. CodeMirror's `defaultKeymap` binds Escape to `simplifySelection`, which calls `preventDefault` but does not stop propagation, so the handler on the wrapping div (`:449-454`) receives it — the same mechanism `Ctrl+Enter` already relies on. |
| D27 | **A truncated value is not editable.** `ReadOnlyReason` gains `'value-truncated'`; `readOnlyReasonFor` returns it after `connection-read-only` and before `no-primary-key`; the chip reads `truncated — not editable`. `DataGrid.vue`'s `startEdit` (`:519-524`) refuses on a truncated cell for the same reason. | F7f is a silent data-loss path: the buffer holds the first 64 KB, `stageEdit` takes it verbatim, and Commit writes it over the full value. `celleditor/state.ts:6-8` already names this exact reason as the anticipated fix, so this is completing a documented gap rather than inventing a restriction. The `truncated` badge stays; the value stays readable and copyable; only writing is refused, and the chip says why. Fixing the panel without the grid's inline editor would leave the same hole one double-click away, which is what "no half-implementations" rules out. |

### Topic 3 — design cohesion

| # | Decision | Rationale |
|---|----------|-----------|
| D28 | **One icon size. `IconButton`'s `size` default drops from 14 to 13, `CodiconIcon` gets no default (callers stay explicit), and every `:size` in `src/renderer` is normalised to **13** except the three deliberate 24s (`EmptyState`'s `.big`), `MainView.vue`'s 32px first-run mark, and `DialogFrame`/`ConnectionDialog`'s 22px dialog marks — which are documented as the display tier, not the icon tier.** | LAW 02 is unambiguous and this is the single most visible incoherence in the app: `ViewChrome`'s Refresh renders at 13 and `DataToolbar`'s Refresh, in the identical slot of the identical toolbar, renders at 14 (F11). Ten sizes across 100 call sites is exactly the *"every component invented its own"* problem the design system README says it exists to end. The 11px/10px/9px sites are the same bug seen from the other end: a glyph shrunk to fit its control, which LAW 02 forbids by name. |
| D29 | **The eleven raw `font-size` px values (F12) become scale tokens; `9px` sites go to `--kira-t-xs`.** `IconButton.vue:53`'s `.corner-count` keeps its explicit size but as `--kira-t-xs`, dropping the 9. | A five-step scale with eleven exceptions is not a scale. `9px` has no token because the design has no such step — a badge that needs to be smaller than `--kira-t-xs` is a badge with too much in it, and the two grid sites (`.sort-chevron`, `.sort-order`) render single characters that read fine at 10. |
| D30 | **All four hand-rolled page-size pickers (F13) become `<SegmentedControl>`. `SegmentedControl.vue`'s generic widens from `T extends string` to `T extends string \| number`. The four `.p-seg > button.active` overrides are deleted. `leaks.spec.ts:263,273` move from `/active/` to `/on/`.** | The comments in all four files say the swap was skipped only because two assertions read `.active` — that is a two-line test change standing in the way of deleting four duplicated components and sixteen lines of duplicated CSS. `T extends string` is the one genuine obstacle and it is a one-word fix; stringifying page sizes at four call sites to satisfy a generic would be the tail wagging the dog. Every `data-testid="page-size-*"` is preserved through `options[].testid`, so the eleven other specs that click them are untouched. |
| D31 | **The definition view's five duplicated stylesheets collapse into one `.p-def-*` block in `primitives.css`, and `font-weight` leaves `src/renderer` entirely** — the five section titles, `OperationsPanel.vue:319` and `MainView.vue:168` adopt colour/size/case instead. | F14: ~200 lines of byte-identical scoped CSS across five files is the definition of the drift this design system was written to stop, and `<style scoped>` gives them no other way to share. `parts/_style.css` declares `font-weight` zero times in 228 lines; `.p-panel-head` is the system's one and only section-label idiom (uppercase, `--kira-t-sm`, muted, `letter-spacing: 0.05em`) and these are section labels. §9 flags this as the one item in the sweep with a genuine taste component. |
| D32 | **`TabStrip.vue`'s local `.tab` rules are replaced by `.p-tab`** (`primitives.css:309-327`), keeping only what the strip genuinely adds (the close button's hover reveal, the drag affordance). `font-size: 12px` → the primitive's `--kira-t-sm`; `max-width: 220px` → the primitive's 210. | F16. The tab is P7 in the system; a second definition of it that differs by 1px of type and 10px of width is how two screens stop looking like one app. |
| D33 | **`TreeRow.vue`'s `.badge` becomes `.p-count`; `.detail`'s `11px` becomes `--kira-t-sm`.** | F16: `background: var(--kira-badge)` + pill shape + tiny mono type *is* `.p-count` (`primitives.css:363-376`), re-typed by hand with an off-scale font size and an off-scale radius. |
| D34 | **`OperationsPanel.vue` moves onto the scales** (three `font-size`, five spacing pairs, four `height: 20px` → `--kira-h-xs`) **and its `.clear-button` becomes `<AppButton>`.** `ProjectTree.vue`'s `.search-incomplete-note` becomes a `.p-strip note` on the same sweep. | F16: it is the single largest off-scale file, and its hand-rolled button uses `--kira-radius` — the *panel* tier — on a control the scale puts two tiers down, which is why it reads as too round next to everything around it. The tree's search note is a LAW 13 note rendered as a bare div. |
| D35 | **One `formatBytes` in `src/renderer/format.ts`, used by `StatusBar.vue:21`, `SettingsDialog.vue:94`, `KeyValueView.vue:126-129` and the cell editor's status badge.** Decimal `KB`/`MB`; under 1024 the word stays "bytes". | F15: three formatters and two unit conventions (`MB` in the status bar, `MiB` two panels away). Keeping "bytes" below 1024 is not cosmetic — `cell-editor.spec.ts:406` asserts the byte reading contains `bytes`, and a count of eight bytes reads as a count, not a magnitude. |
| D36 | **`.p-input.is-invalid` and `.p-select.is-invalid` become real rules in `primitives.css`; the inline `:style="{ borderColor: … }"` in `TextField.vue:59` and `AutocompleteField.vue` is deleted.** | F16: a class that no stylesheet defines is dead code that reads as live, and the working half is an inline style — the one place in the app that can never be themed, overridden or seen in the stylesheet. |
| D37 | **`DataView.vue` gives `ViewHeader` its badges**: the object kind, `N columns`, `read-only`/`read-write`, and — when a count has actually been run — `Σ N rows`; plus a trailing primary-key chip when `rt.meta` names one. | F16 and `parts/bodies/CellEditor.html:16-21`. The row count is gated on `rt.count` existing precisely because §7 forbids computing one automatically — the badge appears when the user presses Σ and not before, which is also why it must not be the *first* badge. |
| D38 | **`DataToolbar.vue`'s Search button binds `:active="!!rt?.searchOpen"`; its duplicate `.p-iconbtn.is-live` rule is deleted** (`primitives.css:60-67` already defines it globally). | F6/F16. Every other toggle in the app shows its state; this one opens a toolbar that a short viewport can hide below the fold, so it is the toggle that most needs to. |
| D39 | **`DocumentView.vue:654` and `KeyValueView.vue:600` always pass an icon and a real label** (`icon="loading"` + `Loading…` before the first page, `icon="json"` + `No documents` / `icon="database"` + `No data` after). | LAW 15: *"Empty is a state, not a blank."* Both currently render a genuinely empty box before the first load resolves. |
| D40 | **The three other search toolbars autofocus their input on open**, matching `SearchToolbar.vue:104-110`. | F5. `Cmd+F` that requires a subsequent click into the field is a broken `Cmd+F`, and the grid already proves the fix is five lines. This is the only *behavioural* item in the design sweep and it is included because the four toolbars are meant to be the same object. |
| D41 | **SPEC.md is edited by the implementing session, not by this plan**: §8.5's search-toolbar bullet gains the filter mode and the "no matching rows" state; §8.6's timestamp bullet is rewritten for the translate pane and records that a truncated value is read-only; §11's tree gains `renderer/format.ts` and the three new `celleditor/` files; the §10 phasing row for P24 is added **only once the phase is implemented**, matching how P20–P23's rows read. | Standing practice (P22 D11, P19, P21 §8). The phasing table is a record of what shipped; a row added ahead of the work would be the first one in the table that is not. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` and `bun run build`
green. Steps 1–3 are the search feature, 4–7 the cell editor, 8–11 the design sweep, 12 the docs.

1. **`feat(grid): derive the matching-row set from a completed search`** — `search.ts` only:
   `searchFilterState`, `isSearchFiltering`, `setSearchFiltering`, `matchedRows`, and the
   `registerTabRuntimeCleanup` that clears the flag. No UI yet, nothing renders differently.
2. **`feat(grid): show only matching rows while the find widget filters`** — `SearchToolbar.vue`
   (the toggle, the scope label, the reset in `close()`/`onUnmounted`) and `DataGrid.vue`
   (`displayRows`, `displayRowCount`, `displayPositionOf`, and the nine sites of F2 routed through
   them; D10's two copy paths; D11's arrow clamp). `EmptyState.vue` gains its default slot and
   `DataGrid.vue` gains D8's no-matching-rows state. `DataToolbar.vue` gets D38's `:active` here,
   since it is the same interaction.
3. **`test(ui): cover the find widget's filter mode`** — §5's grid additions. `xvfb-run -a bun run
   test:ui` green.
4. **`refactor(cell editor): move timestamp parsing into its own module`** — D17's pure move plus
   D16's `TimestampShape`/`parseTimestamp`/`encodeTimestamp` and `relativeTime`. `CellEditorView.vue`
   updates its imports and nothing else; the native picker still works, now shape-preservingly.
   This step alone fixes F7c and is independently verifiable.
5. **`feat(cell editor): app-owned date and time picker`** — `DateTimePicker.vue` against
   `PopoverPanel`, not yet wired into the panel. Reviewable in isolation.
6. **`feat(cell editor): move timestamps into the translate pane`** — `TimestampPane.vue`; the
   `.decoded-*` CSS generalises to `.translate-*`; `.timestamp-row`, the native input, the
   `color-scheme: dark` hack and the eager `saveEdit()` are deleted (D14/D15/D18/D19). The
   value-equality loop guard (D20) lands here and `onDecodedInput` adopts it.
7. **`fix(cell editor): buffer-aware beautify, status and reset; refuse truncated writes`** —
   D21, D22, D23, D24, D25, D26, D27. `DataGrid.vue`'s `startEdit` guard is part of D27 and belongs
   in this commit, not step 2.
8. **`refactor(theme): one icon size, one type scale`** — D28 and D29 across every file F11/F12
   names. Purely visual; run `test:ui` after it, because several specs locate controls by
   `data-testid` inside icon buttons whose box does not change but whose glyph does.
9. **`refactor(theme): use the segmented-control and definition-section primitives`** — D30 and D31,
   including `leaks.spec.ts`'s two assertions and the `font-weight` removal.
10. **`refactor(theme): put the remaining components on the scales`** — D32, D33, D34, D35, D36.
11. **`feat: view-header badges for the data grid; honest empty states`** — D37, D39, D40.
12. **`docs: SPEC.md §8.5/§8.6/§11 for P24`** — D41's spec edits (not the phasing row), and this
    plan's own commit if it is not already landed.

## 5. Tests

`tests/db/` is untouched: no adapter, engine, protocol or SQL change exists in this phase.

### Existing specs that must change

| Spec | Why | Change |
|---|---|---|
| `tests/ui/leaks.spec.ts:263,273` | D30 swaps the page-size picker to `SegmentedControl`, which paints `.on`. | `toHaveClass(/active/)` → `toHaveClass(/on/)`. Nothing else in the file moves; every `data-testid="page-size-*"` is preserved. |
| `tests/ui/cell-editor.spec.ts:640-666` | D18 deletes the native `datetime-local` input, so `picker.fill('2030-06-15T12:30:15')` and the whole comment about Chromium trimming `:00` no longer apply. | Rewritten against the new pane: type into `cell-editor-timestamp-field`, assert the encoded box updates **per keystroke** (not on blur), then open `cell-editor-timestamp-calendar` and pick a day. The round-trip assertion against `Date.UTC(2030, 5, 15, 12, 30, 15)` and the `pending-edit` assertion survive verbatim — but the `pending-edit` check must now follow an explicit blur or `Ctrl+Enter`, because D15 stops the pane staging by itself. |
| `tests/ui/cell-editor.spec.ts:285-291` | `cell-editor-timestamp-local` / `-utc` keep their testids and their content rules (letter month, no `UTC` in the local half), so these assertions stand. | No change — this is the regression guard that D14's restructuring moved nothing the user reads. Verify, do not assume. |
| `tests/ui/cell-editor.spec.ts:295` | D23/D35 reformat the status badge's byte count. | The `bytea_a` cell decodes to a handful of bytes, so `toContainText('bytes')` still holds by D35's under-1024 rule — assert it explicitly rather than relying on it, and add a `KB` assertion on the truncated `big_text` cell. |
| `tests/ui/cell-editor.spec.ts:409-410` | D27 makes a truncated value read-only. | `toContainText('64 KB')` stands (that string comes from the truncation note, not the byte count); **add** `toHaveAttribute('data-read-only-reason', 'value-truncated')` and assert the editor is read-only. |
| `tests/ui/cell-editor.spec.ts:317-329` | D21 beautifies the buffer; D22 resets `formatted` on a hand-edit. | The existing sequence (indented → compact → reset) passes unchanged, because both modes are lossless and the buffer starts equal to the stored value. **Add** the case that used to fail: hand-edit, press Beautify, assert the edit survived and `data-formatted` is `indented`. |
| `tests/ui/data-view.spec.ts:319-336` | The search block gains a control. | Unchanged assertions; the filter scenarios are appended in the same block so the fixture and tab are reused. |
| `tests/ui/budgets.spec.ts` | D3 adds an indirection to `visibleRowIndices`; D28/D29 change glyph sizes across the grid. | **No source change**, but it must be re-run and shown green rather than assumed — the unfiltered path is `displayRows === null` and short-circuits, which is what makes the budget unchanged *by construction*. |
| `tests/ui/tooltips.spec.ts` | D24 gives the enabled Reset button a hint. | No change required; the new assertion lives in `cell-editor.spec.ts` beside the other beautify-tooltip check at `:705-708`. |

### New coverage

**`tests/ui/data-view.spec.ts`, appended to the existing search block** (Postgres fixture, the tab
already open — no new connection, no new container):

- **Filter hides non-matching rows.** With a query matching a known subset, click
  `search-filter-rows`; assert `grid-row` count drops to the matching set, that every rendered
  `grid-cell` in the search column carries `.search-match`, and that `search-count` is unchanged
  (D6).
- **Row numbers stay real** (D4): assert the visible `grid-gutter-cell` texts are non-contiguous and
  each equals its row's true 1-based index.
- **Zero matches** (D8): type a string present nowhere; assert `grid-no-matching-rows` is visible
  with a *Show all rows* button, click it, assert the toggle is off and every row is back.
- **Empty query keeps the toggle lit and shows everything** (D7); clearing the field must not empty
  the grid.
- **Closing the toolbar unfilters** (D7): with the filter on, click `search-close`; assert the full
  row count returns and that reopening `Cmd+F` starts with the toggle off.
- **Zero operations** (D13): capture the op-log length before the whole filter sequence and assert
  it is identical after — the single assertion that proves the filter never reached the server.
- **Prev/next and the current-match highlight still work while filtering** (D6): press
  `search-next` twice, assert `.search-match-current` moved and the target row is on screen.
- **Keyboard navigation stays inside the visible set** (D11): select a filtered row's cell, press
  ArrowDown, assert the selection landed on the next *visible* row, not the next page row.
- **Copy column values follows the filter** (D10): with the filter on, run the header menu's *Copy
  column values* and assert the clipboard has one line per visible row.
- **Pending inserts survive the filter** (D5): stage an Add row, turn the filter on with a query
  matching nothing in it, assert `grid-row-insert` is still rendered.

**`tests/ui/cell-editor.spec.ts`, extending the existing `UUID generate, timestamp picker,
hex/base64 decoded pane` test** (renamed to `…, timestamp translate pane, hex/base64 decoded pane`):

- **Live bidirectional parsing** (D15): on the `epochSeconds` row, type in the pane's field and
  assert the encoded box changes **without** blurring; then edit the encoded box and assert the
  pane's field, both readings and the relative chip follow, again without blurring.
- **Shape preservation** (D16): on an `iso8601` cell holding Postgres's `… +00` spelling, change the
  hour through the pane and assert the encoded value still uses a space separator, the same offset
  spelling and the same sub-second precision — i.e. it differs from the original in the hour digits
  and nowhere else.
- **Zone switch preserves the value** (D19): read `doc`, toggle `Local`/`UTC` twice, assert `doc` is
  byte-identical and that the field's text changed by exactly the zone offset.
- **Exploring stages nothing** (D15): open the calendar, move a month, close it without choosing;
  assert the grid cell has **no** `pending-edit` class. Then choose a day, blur, and assert it does.
- **The calendar is app-owned** (D18): assert `input[type="datetime-local"]` has zero matches
  anywhere in the panel, and that the popover renders `.p-float`.
- **The decoded pane's loop guard** (D20): in the base64 decoded pane, select-all and retype the
  *identical* text, then edit the encoded box; assert the decoded pane still follows. This is the
  scenario that fails against today's `skipNextDecode` and is the reason D20 exists.
- **`modified` chip and `data-dirty`** (D25), and **Escape reverts** (D26): type, assert the chip
  and attribute appear, press Escape, assert both are gone, the buffer is the stored value, and no
  `pending-edit` remains.
- **Reset's tooltip when enabled** (D24): `cell-editor-beautify-reset` carries a non-empty
  `data-kira-tip` while `isDirty`.
- **A truncated value refuses both editors** (D27): on `nulls_and_unicode.big_text` row 3, assert
  `data-read-only-reason="value-truncated"`, that the panel's CodeMirror is read-only, and that
  double-clicking that cell in the grid opens no `grid-cell-input`.

**No new spec file.** Both features live inside tabs and fixtures the two existing specs already
start; a third Postgres container would add minutes to every run for no isolation gain. The design
sweep (steps 8–11) is covered by the whole suite continuing to pass plus
`test-results/screenshots/` — it changes no behaviour except D40's autofocus, which
`data-view.spec.ts`'s and `mongo.spec.ts`'s existing find-widget blocks exercise by typing
immediately after opening the toolbar.

## 6. Explicitly out of scope

- **The filter toggle in the document, key/value and stream search toolbars** (D12). The shape
  `matchedRows()` establishes makes each a five-line follow-up; doing them here would first require
  bringing `StreamSearchToolbar.vue` up to the other three's feature level (F5), which is a feature,
  not a design fix.
- **Consolidating the four search toolbars into one component.** They are 80% identical (F5) and it
  is tempting, but each binds a different match shape (`{row,col}` / `{row}` / `{row,col:'field'|'value'}`)
  to a different page store, and the one that would need the most reshaping (stream) is the one this
  phase is not otherwise touching. Named here so the next reader knows it was considered.
- **Any server-side interaction for search.** No `WHERE` generation from a search term, no
  "filter by this value" shortcut wired into the find widget, no change to `FilterToolbar.vue`,
  `filterCompletion.ts`, `filter_history` or `saved_queries` (D13).
- **A `datetime` type-aware picker driven by the column's SQL type.** The pane keys off the detected
  *cell format* (`epochSeconds`/`epochMillis`/`iso8601`), exactly as today. Reading `column.dataType`
  to know that a `date` column has no time part would be a real refinement and is a different
  feature with its own detection questions.
- **Time zones other than local and UTC** (D19). No IANA zone picker, no per-column zone memory. Two
  zones cover what a DB client's cell editor is for; a zone list is a settings feature.
- **Editing a truncated value** (D27). Refused, not partially supported. Raising `MAX_CELL_BYTES` or
  adding a "fetch the whole value" round trip is an engine change and belongs to whoever wants it.
- **`FilterToolbar.vue`'s missing *Apply* button.** The mockup
  (`parts/bodies/CellEditor.html:58-62`) shows a primary *Apply* beside *Clear*; the implementation
  applies on Enter/blur and shows *Clear* only. That is a behaviour question, not a cohesion one —
  §9 asks it rather than this plan answering it.
- **Light mode, a second theme, or any token *value* change.** This phase changes which token a rule
  uses, never what a token is worth. `tokens.css`'s values are untouched.
- **`main/menu.ts`, the native menu bar, and any native chrome.** As in P22: not the app's DOM, not
  in question.
- **`docs/v1/design/kira-design-system/`.** The mockups are the source of truth being compared
  *against*; nothing under `parts/` or any `.dc.html` is edited, and `build.mjs` is not run.

## 7. Target tree at the end of P24

```
src/renderer/
  format.ts                         NEW  formatBytes — one convention app-wide (D35)
  theme/
    primitives.css                  MOD  .p-input/.p-select .is-invalid (D36); .p-def-* block (D31)
    primitives/
      IconButton.vue                MOD  size default 14 -> 13 (D28); .corner-count 9px -> t-xs (D29)
      EmptyState.vue                MOD  default slot for LAW 15's action (D8)
      SegmentedControl.vue          MOD  generic widens to string | number (D30)
      TextField.vue                 MOD  inline invalid style deleted (D36)
      AutocompleteField.vue         MOD  same (D36)
      ViewHeader.vue                 --  UNCHANGED
  views/grid/
    search.ts                       MOD  searchFilterState, matchedRows, cleanup (D2)
    SearchToolbar.vue               MOD  the toggle, the scope label, reset on close (D7/D9)
    DataGrid.vue                    MOD  displayRows/displayPositionOf and F2's nine sites (D3-D6,
                                         D10, D11); no-matching-rows state (D8); truncated-cell
                                         inline-edit guard (D27)
    DataToolbar.vue                 MOD  search :active (D38); duplicate is-live deleted (D38);
                                         SegmentedControl (D30)
    DataView.vue                    MOD  ViewHeader badges (D37)
    FilterToolbar.vue                --  UNCHANGED (D13)
    page.ts / state.ts / pendingChanges.ts / columns.ts   --  UNCHANGED (D3)
  views/celleditor/
    timestamp.ts                    NEW  parse/encode/shape/readings/relative (D16/D17)
    TimestampPane.vue               NEW  the live bidirectional translate pane (D14/D15/D19)
    DateTimePicker.vue              NEW  app-owned calendar + clock in PopoverPanel (D18)
    CellEditorView.vue              MOD  translate-pane generalisation, loop guard, beautify,
                                         status, reset tooltip, modified chip, Escape (D14, D20-D26)
    detect.ts                       MOD  timestamp code removed; detection untouched (D17)
    state.ts                        MOD  ReadOnlyReason += 'value-truncated' (D27)
    beautify.ts                     MOD  doc comment only — the buffer is now the input (D21)
    formats.ts / binary.ts           --  UNCHANGED
  views/definition/
    {Columns,Indexes,Constraints,Validation,Properties}Section.vue
                                    MOD  duplicated <style scoped> deleted (D31)
  views/documents/
    DocumentView.vue                MOD  SegmentedControl (D30); honest EmptyState (D39)
    DocumentSearchToolbar.vue       MOD  autofocus on open (D40)
  views/keyvalue/
    KeyValueView.vue                MOD  SegmentedControl (D30); formatBytes (D35); EmptyState (D39)
    KeyValueSearchToolbar.vue       MOD  autofocus on open (D40)
  views/stream/
    StreamView.vue                  MOD  SegmentedControl (D30)
    StreamSearchToolbar.vue         MOD  autofocus on open (D40)
  workbench/
    StatusBar.vue                   MOD  formatBytes (D35)
    SettingsDialog.vue              MOD  formatBytes (D35)
    panels/OperationsPanel.vue      MOD  scales, AppButton, font-weight (D29/D31/D34)
    panels/TabStrip.vue             MOD  .p-tab instead of local rules (D32)
    panels/MainView.vue             MOD  font-weight (D31)
  project/
    TreeRow.vue                     MOD  .p-count instead of .badge; t-sm (D33)
    ProjectTree.vue                 MOD  .p-strip note, scale tokens (D34)
tests/ui/
  data-view.spec.ts                 MOD  ten filter-mode scenarios (§5)
  cell-editor.spec.ts               MOD  timestamp pane rewrite + nine new scenarios (§5)
  leaks.spec.ts                     MOD  /active/ -> /on/, two lines (D30)
  budgets.spec.ts                    --  UNCHANGED (re-run and shown green, §5)
docs/
  v1/SPEC.md                        MOD  §8.5, §8.6, §11 (D41) — phasing row only once implemented
  v1/plans/P24-search-filter-celleditor-dates-design.md   NEW  this document
```

## 8. Acceptance checklist

**Search**

- [ ] With the find widget open and a query typed, one click on `search-filter-rows` hides every row
      with no match; a second click brings them all back. The match counter reads the same number
      either way.
- [ ] The gutter shows the hidden rows' real numbers, so a filtered grid reads `3, 17, 84, …`.
- [ ] Filtering to zero matches shows the *No matching rows* empty state with a working
      *Show all rows* button — not a blank grid, and not "No rows" (LAW 15).
- [ ] Emptying the query shows every row again with the toggle still lit; closing the toolbar
      (button or Escape) turns the filter off and returns every row.
- [ ] Prev/next still cycle every match, the current match still scrolls into view, and its cell
      still carries `.search-match-current`.
- [ ] ArrowUp/ArrowDown move between *visible* rows; the selection never lands on a hidden one.
- [ ] A staged Add row stays visible while filtering, at the end of the visible rows.
- [ ] The whole filter sequence adds **zero** rows to the operations panel and issues no query.
- [ ] `FilterToolbar.vue`'s `WHERE`/`ORDER BY` behaves exactly as before, and nothing in the search
      toolbar looks like it.
- [ ] `budgets.spec.ts`'s grid-scroll budget passes unchanged, measured — not assumed.

**Cell editor**

- [ ] An `epochSeconds`, `epochMillis` or `iso8601` cell opens a translate pane below the raw value,
      in the same slot and with the same head treatment the hex/base64 decoded pane uses.
- [ ] Typing in either pane updates the other on **every keystroke**, with no blur and no commit.
- [ ] A Postgres `timestamptz` value re-encodes with its original separator, offset spelling and
      sub-second precision — changing the hour changes the hour digits and nothing else.
- [ ] The `Local`/`UTC` switch changes only what the field shows and parses; the stored value is
      byte-identical across a toggle.
- [ ] Opening the calendar, paging a month and closing it stages nothing; picking a day and blurring
      stages exactly one pending edit.
- [ ] No `<input type="datetime-local">` exists anywhere in `src/renderer`, and no
      `color-scheme` declaration survives.
- [ ] The pane reads back local time, UTC and a relative phrase ("3 days ago"), and says so plainly
      when the buffer is not a parseable timestamp instead of disappearing.
- [ ] Hand-editing JSON and then pressing Beautify formats **the edit**; pressing the same Beautify
      button twice in a row is not a dead click.
- [ ] Editing the decoded pane to identical text does not break the encoded → decoded direction
      afterwards.
- [ ] The status badge follows the buffer, reads `1.2 KB` rather than `1234 bytes`, and the panel
      shows a `modified` chip whenever the buffer differs from the stored value.
- [ ] Escape reverts the buffer and un-stages any pending edit for that cell.
- [ ] The enabled Reset button has a hover hint.
- [ ] A truncated value is read-only in both the panel and the grid's inline editor, with the reason
      shown — and is still fully readable and copyable.

**Design**

- [ ] `grep -rno ':size="[0-9]*"' src/renderer` yields only `13`, the three `24`s, and the two
      documented display-tier sizes.
- [ ] `grep -rn "font-size: *[0-9]" src/renderer` matches only `tokens.css:44`'s own default.
- [ ] `grep -rn "font-weight" src/renderer` returns nothing.
- [ ] `grep -rn 'class="p-seg"' src/renderer` returns nothing outside `theme/`, and no
      `.p-seg > button.active` rule survives.
- [ ] The five definition sections share one stylesheet; no `<style scoped>` block among them
      redefines `.def-table`, `.def-row` or `.def-section-head`.
- [ ] `KB`/`MB` mean the same thing in the status bar, the settings dialog, the Redis key panel and
      the cell editor.
- [ ] `is-invalid` is a real CSS rule and no primitive sets a colour through an inline `:style`.
- [ ] The data grid's view header carries its kind, column count and read-only state, and its Search
      button looks pressed while the find widget is open.
- [ ] No `EmptyState` in the app can render as a blank box.
- [ ] `Cmd+F` in the grid, document, key/value and stream views all put the caret in the find field.
- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` green, including the rewritten timestamp scenarios.

## 9. Open questions for the user

1. **Should the filter mode be remembered per tab across a close/reopen of the find widget?** D7
   turns it off on close, on the grounds that a closed toolbar must never leave rows hidden. The
   alternative — remember it in `DataViewRuntime` and re-apply on reopen — is defensible if you use
   it constantly, and is a two-line change either way. It is the one decision here that is genuinely
   a preference rather than a correctness argument.
2. **Definition-section titles: uppercase-muted, or keep them bold?** D31 removes `font-weight`
   because the design system declares it zero times in 228 lines and `.p-panel-head` is its only
   section-label idiom. That is a real reading of the source, but it is also the one item in the
   sweep where "match the system" and "looks better" might genuinely disagree — five bold titles are
   easier to scan than five uppercase muted ones. Worth a look at the screenshot before it lands.
3. **Should the filter toolbar get its *Apply* button back?** The mockup shows a primary *Apply*
   beside *Clear*; the implementation applies on Enter and on blur and shows only *Clear*, so the
   `WHERE` box has no visible verb — which is arguably why it is not obvious that typing and
   tabbing away just ran a query. §6 leaves it out because it is a behaviour change, not a
   discrepancy in how something is drawn. Say the word and it becomes a D.
4. **Relative time in the timestamp pane: always, or only when it is useful?** D18 always shows it.
   For a row written five seconds ago "just now" is the most useful thing on screen; for a
   `date_of_birth` column, "42 years ago" is noise. The alternative is to show it only within some
   window (say, ±1 year), which is one condition — but picking that window is a guess, so the plan
   shows it unconditionally rather than inventing a rule.
