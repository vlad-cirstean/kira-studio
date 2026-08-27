# P49 — Vue/Node ecosystem library spike: what P47's "go" actually bought, and what nothing else in the ecosystem would

## Conclusions

**P47's `@tanstack/vue-virtual` adoption in the SQL grid stays, and should not be extended anywhere else.** Re-read against P47's own ±15% noise band, only one of its three metrics actually moved — the wide-table vertical scroll, 6.2 → 5.1 ms — so the "go" holds on one leg rather than the three `docs/PERF.md` and SPEC's P47 row imply, but a working, tested migration is not worth reverting for a net six lines. Extending it to the shared `VirtualList.vue` primitive (project tree, operations panel, browse panel, document view, all three console result branches) is a clear no: those consumers are single-axis, and the column axis is the only part TanStack earned its place on; `VirtualList` also carries three things the library has no equivalent for, and there is no symptom and no baseline to judge a migration by.

**Two real defects turned up while looking, and neither needs a dependency.** The query console windows rows but renders every column, on a result set with no row cap at all — the fix is the column axis the SQL grid already has, reusing the already-extracted, already-unit-tested `columnRangeExtractor`. And the key/value and stream views virtualize nothing whatsoever, rendering every loaded row at a page size of up to 10 000 — the fix is `VirtualList.vue`, already mounted at six other call sites. SPEC's own P49 text assumes both views already use it; they do not.

**Of the libraries surveyed, none is worth adopting.** Pinia, TanStack Query, TanStack Form, VueUse, vue-router, a third-party component kit, `drizzle-kit` and `lru-cache` are each a no for a reason specific to this architecture — most sharply TanStack Query, whose whole model is wrong here because the cache already lives in the engine process, every read is a logged user-visible database operation, cancellation is server-side, and a cursor-paged page has no stable key. `zod` is already the validation library and needs no decision, and there is no library gap anywhere in `src/main/` or `src/engine/`. The one "revisit later" is `@floating-ui/vue`, where five hand-rolled overlay positioners already disagree with each other — real duplication, but twenty-five lines with no live bug, so the trigger is a third positioning bug or a sixth overlay, not this phase. **If you greenlight anything here, greenlight the console's column axis and the key/value/stream row virtualization, and leave the ecosystem alone.**

## 0. Ground rules for this phase

> **Origin.** SPEC §10's queued P49 row (`docs/v1/SPEC.md:1072`), verbatim in scope: *"(1) revisit
> P47's own 'go' verdict now that it's had time to prove out only on the SQL grid — decide whether
> the other views' shared `VirtualList.vue` primitive (document, keyvalue, stream, console results)
> should also move to `@tanstack/vue-virtual`, with outright removal of the existing adoption back
> on the table if a fresh look finds it doesn't hold up even there; (2) broaden into a general
> survey of well-known libraries in the Vue ecosystem (TanStack Query, TanStack Form, Pinia,
> VueUse, and others surfaced during the spike itself, not limited to those named up front) and
> their Node.js backend equivalents, each judged against this codebase's actual needs. The
> deliverable is a written per-library analysis — why it would help or why it wouldn't — not a
> mandate to add any of them."*
>
> **P47 is the direct predecessor** (`docs/v1/plans/P47-tanstack-virtual-spike.md`) and this phase
> inherits its discipline literally: an evidence-based per-item go/no-go with the criteria written
> before the answer (P47 D14), and an explicit statement that "we looked, here is why we did not"
> is a legitimate planned outcome, not a failure (P47 D15). P47 itself ended "go" for exactly one
> thing and left everything else alone; this phase ends "no" for everything and names two
> dependency-free defects instead. That asymmetry is the finding, not a shortfall.

- **This phase writes a document and nothing else.** No dependency is added or removed, no
  `package.json` edit, no source file touched. The deliverable *is* the analysis. Where a verdict
  would imply work, §5 sketches what that work is and labels it **if greenlit** — it does not
  commit to it.
- **Every claim is grounded in something read in this tree**, cited by path and line. Where a
  library's own behaviour is asserted it is either already in `node_modules` and in use
  (`@tanstack/vue-virtual@3.13.36`, `package.json:57`, whose internals P47 §1 already read from the
  published dist and whose findings F5–F13 are not re-derived here) or the claim is confined to
  what the app would have to do rather than what the library does internally.
- **A verdict of "no clear win, not worth the dependency" is the expected default**, and this plan
  does not manufacture a recommendation to look productive. Ten libraries were considered; one
  earns a "revisit later" and none earns an adopt. That is the honest count.
- **Removal of P47's adoption is genuinely on the table** per SPEC's own wording, and §1.A
  re-derives the decision from the recorded numbers rather than deferring to the recorded verdict.
- Conventional Commits: this phase is one `docs:` commit for this file, and — if it is treated as
  closed — one more for SPEC §10's P49 outcome column (D18).

## 1. Findings

### A. P47, re-litigated against its own criteria

**F1 — of the three metrics P47's "go" rested on, exactly one moved outside the noise band P47
itself declared.** `docs/PERF.md:78-82` records the before/after table:

| Metric | Baseline (work p50) | After (work p50) | Delta | Inside D14's ±15% band? |
|---|---|---|---|---|
| `big_rows`, vertical | 2.4 ms | 2.2 ms | −8.3% | **yes — noise** |
| `scroll_grid`, horizontal | 6.3 ms | 6.2 ms | −1.6% | **yes — noise** |
| `scroll_grid`, vertical (wide table) | 6.2 ms | 5.1 ms | −17.7% | no — a real signal |

P47 D14 set its no-go regression threshold at "more than 15%" and gave the reason explicitly:
*"15% rather than 0% because `PERF.md:71-101` establishes that this measurement's run-to-run spread
on this class of machine is roughly a frame."* A band declared symmetric for regressions is
symmetric for improvements too. `PERF.md:84`'s sentence — *"All three are flat-to-improved"* — is
defensible; SPEC §10's P47 row's *"all three D13 work-p50 metrics improved"*
(`docs/v1/SPEC.md:1070`) overstates it. One metric improved; two did not measurably change.

This does **not** flip the verdict. D14's go clause required "at least one of: a measurable
improvement on any of D13's three metrics, or a strictly simpler `DataGrid.vue` by the F18
accounting" — and 17.7% on the wide-table axis is precisely the case the whole `scroll_grid`
fixture (60 columns × 5 000 rows, P29 D14) was built to expose. The go clause is satisfied by one
leg. It is worth recording that it was one leg and not three, because the next person weighing a
similar trade will read `PERF.md` and SPEC's row, not this paragraph.

**F2 — the second go-clause leg, re-counted against the tree as it stands today, is a smaller win
than the record implies but still a win.** SPEC's row claims `columns.ts` *"loses
`visibleColumnRange`'s 43-line binary-search-plus-expansion-loop for the much smaller
`columnRangeExtractor` seam"*. Re-measured:

| Gone | Added |
|---|---|
| `visibleColumnRange` — binary search + forward walk + two-sided expansion, 43 lines | `columnRangeExtractor` — expansion only, 33 lines (`columns.ts:83-115`) |
| `rowRange` / `colRange`, ~19 lines (`DataGrid.vue`, pre-migration `:338-356`) | two `useVirtualizer` blocks, 27 lines (`DataGrid.vue:372-398`) |
| `viewportWidth`/`viewportHeight` + the component's own `ResizeObserver`, ~9 lines | `observeScrollElementRect`, 12 lines (`DataGrid.vue:333-344`) |
| — | two `measure()` watchers, 2 lines (`:420-421`) |
| — | `markScrollWork`, 3 lines (`:322-324`) |

Net roughly −6 lines of application code, plus one dependency and its transitive
`@tanstack/virtual-core`. What genuinely left is the *binary search* — the one piece of that code
with an off-by-one surface — and it left in exchange for a pure loop that now has a dedicated unit
spec (`tests/unit/column-range.spec.ts`, seven cases). "Strictly simpler" is a stretch; "the
tricky part is gone and the remaining part is tested" is accurate and is a real improvement in
maintainability rather than in line count.

**F3 — the cost side accrued one item P47 did not predict, and it is a load-bearing one.**
`DataGrid.vue:326-344`'s `observeScrollElementRect` exists because TanStack's default
`observeElementRect` measures the border box, which does not subtract a visible scrollbar's
thickness, and that ~12–15 px discrepancy failed `budgets.spec.ts`'s zero-mutation assertion by
putting the vertical overscan boundary on a knife's edge (recorded at `PERF.md:88-92` and in SPEC's
P47 row). This is the shape of thing that argues *for* keeping the adoption now rather than
reverting: the sharp edge has already been found, hit, diagnosed and fenced. A revert would throw
away that work and reinstate code whose equivalent sharp edges (P29's own overscan-coverage
invariants) took a whole phase to establish.

**F4 — removal would be a net loss and there is no evidence for it.** Everything that would have to
be true for a removal case is false: the migration is not failing (`budgets.spec.ts` and
`perf.spec.ts` needed no edit at all — D17, confirmed by an empty diff), no metric regressed, the
grid's DOM-cell bound and both overscan-coverage invariants pass, and no user complaint has been
attributed to it. The only genuine argument against the adoption is F2's honest accounting — a wash
in lines for one dependency — and that argument was already weighed and answered by D14's go clause
before the numbers existed. Re-answering it the other way now, with no new evidence, would be
exactly the retrofitting D14 was written to prevent.

### B. `VirtualList.vue` and its real call sites

**F5 — `VirtualList.vue` is 197 lines, of which the index math is about 45, and it is single-axis by
construction.** `src/renderer/theme/primitives/VirtualList.vue`:

| Piece | Where | What it is |
|---|---|---|
| props | `:9-17` | `items`, `rowHeight`, `overscan` (default **8**, an item count), optional `rowHeights` |
| emits | `:26-29` | `scrollstate` (P28 D2, for `project/stickyBand.ts`) and `visible-range` (P42 D39, for the find toolbar's priority window) |
| viewport tracking | `:36-38`, `:46-53` | one `scroll` handler, one `ResizeObserver` reading `clientHeight` |
| prefix sums | `:59-66` | `offsets[i]` built from `rowHeights` when present; `null` otherwise |
| binary search | `:68-79` | `rowIndexAtOffset` — the variable-height path's index lookup |
| `startIndex`/`endIndex` | `:81-98` | uniform division, or binary search, ± `overscan` |
| `visible` | `:106-110` | `items.slice(start, end)` mapped to `{ item, index }` |
| spacers | `:111-124` | `topSpacer`/`bottomSpacer` divs — **flow layout, not absolute placement** |
| `scrollToIndex(index, inset)` | `:132-144` | top/bottom-aligned, no-op if visible, with a **pixel inset** (P28 D6) for a caller whose sticky slot occludes the scrollport top |
| `#sticky` slot | `:161-163`, CSS `:191-196` | zero-height `position: sticky; top: 0` overlay, required to be the **first** child of the scroll content (P41 D1) |
| `#header` slot | `:168-170`, CSS `:185-189` | in-flow sticky header row (the console result grid's column headers) |

There is no horizontal axis anywhere in the file. Every consumer scrolls one direction.

**F6 — seven mount sites, and their realistic row counts, read from the code that feeds them.**
`grep -rn "VirtualList" src/renderer` finds four importers and seven `<VirtualList>` elements:

| Site | Line | Row model | Realistic upper bound |
|---|---|---|---|
| `project/ProjectTree.vue` | `:207` | uniform `rowHeight`, `#sticky` ancestor band | thousands of nodes (`tests/ui/tree.spec.ts:381` notes one schema alone "outgrows VirtualList's" window) |
| `workbench/panels/OperationsPanel.vue` | `:199` | uniform, `:row-height="18"` | **500**, hard-capped (`state/ops.ts:5`, `MAX_RECORDS`) |
| `views/browse/BrowseView.vue` | `:219` | uniform | the largest list in the app — S3 lists up to 20 rounds × 1 000 keys (`engine/adapters/s3/catalog.ts:15`), Redis up to 200 SCAN rounds (`redis/catalog.ts:12`) |
| `views/documents/DocumentView.vue` | `:716-726` | **variable**, `:row-heights="rowHeights"` (`:358-370`) | page size, up to 10 000 (`shared/protocol/data-ops.ts:44`) |
| `views/console/ConsoleResultGrid.vue` (tabular) | `:299` | uniform + `#header` slot | uncapped — see F9 |
| `views/console/ConsoleResultGrid.vue` (document) | `:364` | **variable**, `:row-heights="documentRowHeights"` | uncapped |
| `views/console/ConsoleResultGrid.vue` (other) | `:404` | uniform | uncapped |

**F7 — SPEC's own P49 description is wrong about two of the four views it names: `KeyValueView.vue`
and `StreamView.vue` do not use `VirtualList` and are not virtualized at all.** Neither file
imports it (the `grep` above returns no `import VirtualList` for either), and both render every
loaded row directly:

- `views/keyvalue/KeyValueView.vue:849` — `v-for="i in rowIndices"`, where `rowIndices`
  (`:120-124`) is `Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i)` or the filtered
  subset. Each row is three `<div>`s (gutter, field, value) plus a conditional truncation chip.
- `views/stream/StreamView.vue:823` — the same `v-for="i in rowIndices"` over the same shape
  (`:110-114`).

This is not an oversight discovered here; it is recorded in the tree already.
`views/keyvalue/search.ts:48-51`: *"P42 D39: KeyValueView.vue renders every loaded row directly (no
VirtualList), so nothing ever calls setVisibleRows for this tab and this always resolves to
`undefined`"*. It is also consistent with the documented invariant — `docs/ARCHITECTURE.md:57` says
*"Long lists (tree, log panel, document view) are virtualized too"* and names neither view.

The consequence is measurable rather than theoretical. Both views offer a 10 000-row page size:
`KeyValueView.vue:144` calls `pageSizeOptions('keyvalue-')` with **no** ceiling, so all four options
(10/100/1 000/10 000, `shared/page/sizes.ts:12-17`) are always offered; `StreamView.vue:208` filters
by `caps.maxPageSize`, which only RabbitMQ sets (500 — `engine/adapters/rabbitmq/caps.ts:44`,
`rabbitmq/read.ts:17`), leaving Kafka and SQS uncapped. A Redis hash browsed at 10 000 rows is
roughly 30 000 DOM nodes in one scroll container, built in one render pass, with no windowing.

**F8 — what `VirtualList.vue` would lose in a migration, item by item.** These are the specific
reasons a swap is not the mechanical exercise P47's own §9 question 5 assumed when it called
`VirtualList.vue` "the obvious next candidate":

1. **The `rowHeights` path is a *precomputed* prefix sum, not dynamic measurement.**
   `DocumentView.vue:358-370` computes every row's height analytically from `rowHeight(tabId, index,
   editingId, expanded, isSearchMatch)` and re-computes on `pageVersion`/`rowsVersion`. Under
   TanStack this becomes `estimateSize: (i) => rowHeights[i]` — which walks straight into P47 F10's
   footgun: `estimateSize` is read during a measurements recompute but is not a dependency that
   *triggers* one, so every expand/collapse toggle would need an explicit `measure()` call, exactly
   the discipline `DataGrid.vue:417-421` had to add by hand. The current code has no such footgun:
   `offsets` is a plain `computed` (`VirtualList.vue:59-66`) and invalidates by construction.
2. **Two sticky slots live *inside* the scroll content and are load-bearing.** `#sticky`
   (`:161-163`) must be the first child of the scroll content — `:151-160` records the CSS reason at
   length (a `position: sticky; top: 0` box at the *end* of the content never pins) — and it is
   zero-height specifically so the spacer arithmetic keeps its meaning. `#header` (`:168-170`) is
   in-flow and deliberately offsets `scrollTop`-based indexing by its own height, absorbed by the
   default overscan. Under TanStack both would have to be reconciled against `paddingStart`, which
   is the same class of correctness problem P47 D6 had to solve for the grid's gutter and sticky
   header — solvable, but it is new correctness risk bought for nothing.
3. **`scrollToIndex(index, inset)` has no library equivalent.** TanStack's `scrollToIndex` takes
   `align: 'start' | 'center' | 'end' | 'auto'`; there is no pixel inset. `ProjectTree.vue` needs
   one because its own ancestor band occludes the top of the scrollport (P28 D6), and
   `DocumentView.vue:381-386`'s go-to-match calls it. This would have to be reimplemented on top of
   the library anyway.
4. **The placement model is different.** `VirtualList` renders `topSpacer` → rows → `bottomSpacer`
   in normal flow (`:171-175`). TanStack's model is absolute placement off `item.start` inside a
   `getTotalSize()`-tall container. Converting means touching the CSS of all seven call sites at
   once — the exact opposite of P47 §0's "one variable at a time", and unattributable if anything
   regresses.
5. **The win TanStack actually delivered on the grid does not exist here.** P47's measurable
   improvement was on `scroll_grid`, the wide-table *horizontal/column* axis, and its structural
   win was replacing a binary search over column offsets with `columnRangeExtractor`. Every
   `VirtualList` consumer is single-axis. P29 D12's original reasoning — *"different component,
   single axis, no reported symptom"* — is unchanged, and P47 §6 restated it verbatim.

**F9 — the one real virtualization defect in the tree: `ConsoleResultGrid.vue` windows rows and
renders every column, and the console has no row cap.** Two independent facts, which compound:

- `ConsoleResultGrid.vue:332-334` renders data cells with `v-for="(col, c) in page.columns"` — every
  column, for every row `VirtualList` has on screen — and `:311-320` does the same for the header
  row. There is no `colStart`/`colEnd`, no `columnRangeExtractor`, no horizontal windowing of any
  kind. The SQL grid, by contrast, has had both axes since P29 and now runs them through
  `DataGrid.vue:372-398`.
- `shared/protocol/data-ops.ts:162-168`'s `executeRequestWireSchema` carries `opId`, `tabId`,
  `connectionId`, `path`, `statements` — and **no `pageSize`**. `views/console/state.ts:225-231`
  sends exactly those five fields. A console `SELECT * FROM app.scroll_grid` (the repo's own
  60-column × 5 000-row fixture) returns all 5 000 rows and all 60 columns to the renderer, and
  the result grid will build ~60 cells per visible row against them.

At ~40 visible rows that is ~2 400 cells — under the SQL grid's own `< 2500` bound
(`budgets.spec.ts:316-317`) only by accident, and unbounded above it as columns grow. This is the
single most defensible piece of work this spike found, and notably it is **not** a dependency
question: the column axis it needs already exists, extracted and unit-tested, in
`views/shared/page/columns.ts:83-115` with `GUTTER_WIDTH` and `DEFAULT_COLUMN_WIDTH` alongside it
(`:14`, `:17`) — P48 put them there precisely so both grids could share them.

**F10 — no DOM-node bound is asserted anywhere outside the SQL grid.** `tests/ui/perf.spec.ts:148`
counts `[data-testid="grid-cell"]`; `budgets.spec.ts:316-317` bounds the same selector. A repo-wide
grep for `console-result-cell` in `tests/` finds two hits, both in `cell-editor.spec.ts:1015` and
`sqlite.spec.ts:387` and both `.first().click()` — no count assertion. There is no assertion of any
kind on `keyvalue-row` or stream row counts. So F7's and F9's gaps are invisible to the suite: they
cannot regress a test because no test looks.

### C. The renderer's state and data-fetching layers

**F11 — state is module-level `reactive()` singletons, hydrated *before* the Vue app exists.**
`src/renderer/main.ts:60-70`:

```ts
async function bootstrap(): Promise<void> {
  initCacheStats();
  initAppMetrics();
  await Promise.all([hydrateLayout(), hydrateSettings(), hydrateConnections(), hydrateOps(), hydrateTabs()]);
  createApp(App).directive('tooltip', vTooltip).mount('#app');
}
```

Fifteen modules under `src/renderer/state/` (1 553 lines, `tabs.ts` alone 641) plus seven
`views/*/state.ts` (1 534 lines) all export plain `reactive(...)`/`ref(...)` objects and functions
over them. None of them touches a Vue app instance. That is what makes the bootstrap order above
legal, and it is also what makes `tests/unit/view-state.spec.ts` possible: it imports
`state/tabs.ts`, `views/browse/state.ts` and `views/keyvalue/state.ts` directly under Bun
(`:19-27`) behind a 22-line `globalThis.window` stub (`tests/unit/support/window.ts`) with no Vue
application anywhere, and drives a two-in-flight-loads race that no Playwright test can force.

**F12 — the two hand-rolled store factories are not shaped like anything a store library sells.**

- `views/shared/viewOp.ts:61-95`'s `createRuntimeStore<R>(makeDefault)` is a **per-tab keyed record**
  factory: `runtime: Record<string, R>` plus `ensureRuntime(tabId)`, with conditional
  `setActionError`/`toggleSearchOpen`/`setSearchOpen` present in the return type only when `R`
  actually carries the field (`:64-69`). Its own comment at `:42-50` records why `ensureRuntime`
  re-reads through the proxy rather than returning the object it just made. Seven view modules use
  it. This is an instance-per-key registry; `defineStore` is a singleton.
- `views/shared/page/store.ts:40-116`'s `createPageStore<P>` is deliberately **outside** Vue's
  reactivity for the bulk data: `pages` is a plain `Map`, each page is `Object.freeze`d on insert
  (`:57`, with the comment *"A tripwire: any code that tries to mutate this fails loudly in dev"*),
  and the only reactive handle is a single `pageVersion.n` counter. That is a direct implementation
  of `docs/ARCHITECTURE.md:55`'s invariant — *"No Vue reactivity on row data. Rows live in plain
  frozen typed structures; the grid reads them imperatively and re-renders on an explicit version
  counter."* It also carries a two-level decode cache with visible-window pruning (`:89-114`).
- Alongside those, `viewOp.ts:107-114`'s `beginOp` and `:127-148`'s `applyLoadFailure` are the
  op-start preamble and failure tail shared by five views, both stamping and checking `rt.opId` for
  supersession.

**F13 — data arrives over a bespoke `MessagePort` channel with server-push invalidation, server-side
cancellation, and a cache that already lives in the engine process.** The full path, read end to
end:

- `renderer/bridge/port.ts` — one `MessagePort` handed in by the main process (`:29-42`), an
  integer-keyed `pending` map (`:13`, `:44-60`), a topic-keyed event fan-out for server pushes
  (`:62-70`), a 30 s default timeout (`:3`) and an explicit `timeoutMs: null` for data ops.
- `renderer/bridge/data.ts:21-23` — *"Data ops have no client-side timeout (D25) — cancellation via
  `control.opsCancel` is the only escape hatch, never an abandoned-but-still-running server query."*
- `engine/scheduler/ops.ts:31-87` — every operation gets a `crypto.randomUUID()` id, an
  `AbortController` held server-side (`:42-43`), an `op:start` event on entry (`:46-52`) and an
  `op:end` on exit (`:76`, `:82`). `main/oplog.ts:33` persists both to SQLite;
  `renderer/state/ops.ts:16-28` subscribes and renders them in the operations panel, newest first,
  ring-buffered at 500.
- `engine/cache/index.ts:49-114` — the result-page and count caches, byte-budgeted
  (`engine/cache/lru.ts`, which refuses any entry larger than half the budget, `:56-63`), keyed by
  `(connectionId, path, filter)`, with four distinct invalidation verbs: `dropTarget` (explicit
  refresh), `invalidateAfterMutation` (drops pages, marks counts *stale but present*, `:82-90`),
  `dropPagesOnly`, `dropConnection`.
- The renderer's own supersession is a per-tab slot, not a key: `keyvalue/state.ts:89` stamps
  `beginOp(rt)` and `:103` checks `if (rt.opId !== opId) return`, with the same shape in the other
  four views.
- Pagination is frequently **not** addressable by a stable key. `keyvalue/state.ts:82-88` records
  that a hash/set/zset/stream key is cursor-paged and an `offset` cursor *"is neither honoured nor
  rejected… it falls through and silently restarts the scan from the beginning"*, so a no-cursor
  load on such a key must honestly reset the pager to page one. Forward and backward moves carry
  opaque `nextToken`/`prevToken` values (`:164`, `:176`).

**F14 — there is exactly one real form in the application.** `project/ConnectionDialog.vue` (806
lines, most of it per-engine field layout). Its entire form machinery is: parse the draft against
the shared zod schema, project the issues onto a flat error record —

```
:205  const parsed = connectionInputSchema.safeParse(d);
:207-212  const errors: Record<string, string> = {}; for (const issue of parsed.error.issues) …
:228  draft.value ? connectionInputSchema.safeParse(draft.value).success : false
```

— and render `fieldErrors.<name>` beside each control (`:360`, `:402`, `:426`, `:500`). The other
three dialogs (`SettingsDialog.vue`, `UploadObjectDialog.vue`, `FiltersDialog.vue`) are effectively
single-control. The validating schema is `@shared/domain/connection`'s, the same one the main
process's IPC handler parses against — one source of truth across the process boundary.

**F15 — the composable-shaped surface a general utility library would target, counted.** In the
whole renderer: **two** `new ResizeObserver(` sites (`VirtualList.vue:48`, `DataGrid.vue:341`), 23
`addEventListener(` calls, 12 `setTimeout` calls. There is **no** `localStorage`/`sessionStorage`
use at all — settings persist through IPC into SQLite (`state/settings.ts:39` onward,
`main/storage/repos/settings.ts`) and are re-applied to CSS custom properties by
`applyAppearance()` (`:19-27`). There is no HTTP in the renderer (the only `fetch` in the codebase
is RabbitMQ's management API, engine-side). Click-outside is solved deliberately and differently:
`PopoverPanel.vue`'s full-viewport transparent backdrop, whose own comment (`:4-8`) explains why.
Keyboard chords go through `shortcuts/keys.ts`, whose `matchesShortcut` (`:48-61`) resolves against
`@shared/domain/shortcuts` — the *same* table Electron's native menu accelerators are built from,
so the chord model cannot be replaced by a renderer-only key matcher without splitting that source
of truth.

**F16 — five hand-rolled anchored-overlay positioners, and they already disagree.** Every one does
its own flip-and-clamp arithmetic against `window.innerWidth`/`innerHeight`:

| Site | Lines | Behaviour |
|---|---|---|
| `theme/primitives/PopoverPanel.vue` | `:47-77` | flips vertically *and* clamps both axes, re-measures on `nextTick` once the panel has a height (`:60-62`) |
| `workbench/AppTooltip.vue` | `:16-20` | clamps horizontally, flips vertically |
| `project/ErrorPopover.vue` | `:22-27` | clamps horizontally, flips vertically (a near-copy of the above) |
| `workbench/ContextMenu.vue` | `:63-68` | clamps **both** axes, flips neither — mouse-anchored, a deliberately different model (`PopoverPanel.vue:10-11` says so) |
| `theme/primitives/AutocompleteField.vue` | `:105` | measures the trigger rect only |

`PopoverPanel.vue:28-34` records that this class of bug has already been shipped and fixed once
(task #58: every menu's "anchor" was silently resolving to the viewport corner). P48's audit never
covered any of this — `grep -n "PopoverPanel\|floating\|AppTooltip\|ErrorPopover"` over
`docs/v1/plans/P48-cross-view-reusability-audit.md` returns nothing, because P48 was scoped to the
six data views, their toolbars, and the adapters.

### D. `src/main/` and `src/engine/` — the Node.js side

**F17 — the validation library question is closed: `zod@4.4.3` is already in `dependencies`
(`package.json:92`) and is used in 26 files.** It is the IPC boundary validator (every handler in
`main/ipc/` parses its payload — `queries.ts:17-48` declares seven schemas for eight handlers), the
domain layer (all 12 files under `shared/domain/`), the wire protocol (all four files under
`shared/protocol/`), the capability descriptor (`shared/caps.ts`) — and, non-obviously, the
**schema-migration mechanism for persisted settings**: `shared/domain/settings.ts:35-42` puts
`.default(...)` on every section with the comment *"an older kira.sqlite has a settings row with no
`data`/`cache`/`advanced` keys, and that row must still parse on next launch."* There is no gap
here to fill and nothing to compare against.

**F18 — persistence is Drizzle over `node:sqlite` with hand-written numbered migrations, and the
hand-written part carries a guarantee `drizzle-kit` does not offer.** `main/storage/db.ts:1-2`
constructs `drizzle('drizzle-orm/sqlite-proxy')` over a `node:sqlite` handle fronted by a capped
prepared-statement cache (`:15-30`, `STMT_CACHE_MAX = 200`, capped because `repos/ops.ts`'s
`pruneOps` generates a distinct SQL string per parameter count). Nine schema modules, ten repos.
Migrations are five numbered `.sql` files imported with Vite's `?raw`
(`storage/migrations/index.ts`) and applied transactionally against a `schema_version` integer
(`migrate.ts:5-32`) — including an explicit downgrade refusal (`:16-21`): *"Database schema_version
(N) is newer than this build knows about — refusing to run against a downgraded app."*

**F19 — the backend's own structural patterns are each deliberate, and each would be damaged by the
library that superficially matches it.**

- **The adapter registry** (`engine/adapters/registry.ts:13-25`) is a
  `Partial<Record<ConnectionKind, (deps) => Promise<Adapter>>>` of lazy `import()` calls, and
  `:5-12` records exactly why: eager static imports meant every driver was resident from boot,
  *"measured: >100MB of the engine's baseline RSS"*. A plugin/DI framework that resolves eagerly
  would undo that measurement.
- **The IPC registry** (`main/ipc/registry.ts:16-28`) is a flat list of eleven
  `registerXHandlers(deps)` calls, and `main/ipc/deps.ts` is 11 lines. There is no container to
  replace.
- **The utility-process host** (`main/engine-host.ts:38-42`) is `utilityProcess.fork` — Electron's
  own API, not a generic worker pool — with a deliberate no-auto-respawn policy on exit (`:65-78`:
  *"No auto-respawn (§13.2 of the P1 plan): the user reconnects manually"*), which removes the case
  a supervisor or retry library would exist for.
- **`ByteLru`** (`engine/cache/lru.ts:19-115`) carries two app-specific behaviours that any
  replacement would have to re-add as adapter code: `deleteWhere(pred)` over
  `{connectionId, path, label}` metadata (`:82-92`), which is the *entire* invalidation vocabulary
  `cache/index.ts:76-101` is built from, and the half-budget refusal with its warning (`:56-63`),
  which exists so *"one 40 MB page must not evict every other page in a 64 MB budget."*
- **Logging** is `electron-log@5.4.4` (`package.json:87`) behind a three-line `log(level, scope,
  message)` façade (`main/log.ts:16-18`) with date-rotated files and a 30-day mtime sweep
  (`:24-45`). A structured-logging library would be a second one.

**F20 — non-finding: there is no HTTP surface in this application.** No server, no framework, no
router, no middleware, no request validation beyond IPC. The one `fetch` in the codebase is
RabbitMQ's management API client, engine-side, with no dependency at all (P37 D1). The entire
"Node.js backend equivalents" half of SPEC's P49 brief therefore resolves to the storage, caching,
process and validation surfaces above, and each of those already has its answer.

## 2. Shapes introduced in this plan

**N/A — deliberately, and stated rather than omitted.** This is a plan-only phase: the deliverable
is this document. No code lands from it, so there is no new interface, type, module or component to
declare. Every shape referenced above already exists in the tree; every shape a "go" *would*
introduce is described in §5 as a conditional, not as a commitment.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **P47's `@tanstack/vue-virtual` adoption in `DataGrid.vue` stays. No revert.** | F4: nothing that would have to be true for a removal case is true — no failing assertion, no regressed metric, no attributed complaint, and F3's one genuine sharp edge (the border-box vs. `clientWidth` scrollbar discrepancy) has already been found, diagnosed and fenced by `observeScrollElementRect`. A revert would discard that and reinstate a binary search whose invariants took P29 an entire phase to pin. The only honest argument against is F2's line accounting, and D14 answered it in advance with its go clause; re-answering it now with no new evidence is precisely the retrofitting D14 existed to prevent. |
| D2 | **The recorded justification is overstated and this plan says so.** One of three metrics moved outside P47 D14's own ±15% band; `PERF.md:84` and `SPEC.md:1070` read as though three did. | F1. D14 declared the band symmetric and gave its reason (run-to-run spread is roughly a frame on this class of machine); a band that disqualifies a −14% regression disqualifies a +8% improvement. The verdict survives on the wide-table axis alone — 17.7%, on the fixture built to expose exactly that axis — but the record should not imply three independent confirmations where there is one. Written down rather than fixed, because this phase is plan-only (D18). |
| D3 | **`VirtualList.vue` does not move to `@tanstack/vue-virtual`. No-go, on five independent grounds.** | F8, each ground load-bearing on its own: (a) the win P47 measured was on the *column* axis and every `VirtualList` consumer is single-axis — P29 D12's original reasoning, restated verbatim by P47 §6, is unchanged; (b) `rowHeights`' precomputed prefix sum would become `estimateSize`, walking straight into P47 F10's non-triggering-dependency footgun that `DataGrid.vue:420-421` had to close by hand, where `VirtualList.vue:59-66` has no such footgun by construction; (c) the `#sticky` and `#header` slots live inside the scroll content with documented CSS constraints (`:151-160`) that would have to be reconciled against `paddingStart`, new correctness risk bought for nothing; (d) `scrollToIndex(index, inset)`'s pixel inset has no library equivalent and would be reimplemented on top regardless; (e) the placement model differs — spacers in flow vs. absolute off `item.start` — so a migration touches the CSS of all seven call sites simultaneously, which is unattributable if anything moves. Decisive on top of all five: there is **no reported symptom and no measurable baseline**. P47 had `budgets.spec.ts`, the `scroll_grid` fixture and a same-session before/after (D13); no equivalent exists for any `VirtualList` consumer, so a migration could not be evaluated by P47's own standard. That makes it the thing P47 D1 explicitly forbade — landing the library because it was landed. |
| D4 | **`ConsoleResultGrid.vue`'s missing column axis is a real defect and the one item most worth greenlighting — and it is not a dependency question.** | F9: `:332-334` renders every column of every visible row, and `executeRequestWireSchema` (`data-ops.ts:162-168`) has no row cap at all, so a console `SELECT *` on a wide table is unbounded in both directions. The SQL grid has solved this since P29 and now runs it through `columnRangeExtractor`, which P48 already hoisted into `views/shared/page/columns.ts:83-115` alongside `GUTTER_WIDTH`/`DEFAULT_COLUMN_WIDTH` (`:14`, `:17`) *specifically so both grids could share them*, and which already has a seven-case unit spec. The fix reuses existing, tested code and adds nothing to `package.json`. §5.1 sketches it. |
| D5 | **`KeyValueView.vue` and `StreamView.vue` virtualize nothing, SPEC's P49 text assumes they do, and the fix — if greenlit — is `VirtualList.vue`, not a library.** | F7: both render `v-for="i in rowIndices"` over the full loaded page (`KeyValueView.vue:849`, `StreamView.vue:823`), both offer a 10 000-row page size with no ceiling for most engines, and the behaviour is already recorded deliberately in `keyvalue/search.ts:48-51`. Roughly 30 000 DOM nodes at the top page size, invisible to the suite (F10). `VirtualList.vue` is the primitive six other sites already mount, both views' rows are uniform-height and single-axis — the exact shape it serves — and adopting it here would also close the `setVisibleRows` hole `search.ts:48-51` names, since the `visible-range` emit already exists (`VirtualList.vue:102-104`). Counter-evidence recorded honestly: no user has reported it, and `ARCHITECTURE.md:57`'s invariant does not name these views, so this is a latent risk rather than a live bug. |
| D6 | **Pinia — do not adopt.** | Four app-specific reasons, none of them "we prefer hand-rolled". (a) **Bootstrap order**: `main.ts:60-70` hydrates five state modules *before* `createApp()`; Pinia stores need an active pinia instance, so every hydrate would move inside or after app creation, restructuring startup for no user-visible gain. (b) **The unit suite**: `tests/unit/view-state.spec.ts:19-27` imports `state/tabs.ts` and two view state modules directly under Bun with a 22-line `window` stub and no Vue app, to force an interleaving Playwright cannot; every such spec would need `setActivePinia(createPinia())` wiring. (c) **Shape mismatch**: what the app hand-rolls is not what `defineStore` replaces — `createRuntimeStore` (`viewOp.ts:61-95`) is a per-tab *keyed record* factory, not a singleton, and `createPageStore` (`page/store.ts:40-116`) is deliberately *outside* reactivity, with `Object.freeze` as a tripwire (`:57`), because `ARCHITECTURE.md:55` forbids Vue reactivity on row data. Wrapping that in a store is an invitation to violate the invariant. (d) **The genuine Pinia wins have no user here**: no SSR, no store HMR need in a desktop app rebuilt per run, and devtools are unreachable outside development since P46. Cost of adoption: ~3 000 lines of state rewritten for zero behaviour change plus one dependency. |
| D7 | **TanStack Query (`@tanstack/vue-query`) — do not adopt. The sharpest "no" in this survey.** | Every pillar of its model is either already provided or actively wrong here (F13). (a) **The cache already exists, on the other side of the port**: `engine/cache/index.ts:49-114`, byte-budgeted (`lru.ts`), keyed by `(connectionId, path, filter)`, with four distinct invalidation verbs including a mutation path that drops pages but keeps counts *stale-not-blank* (`:82-90`) so the pager greys a total instead of losing it. The renderer additionally has five page stores. A query cache would be a third layer over the same bytes with its own key space and its own eviction. (b) **Refetch-on-mount/focus/reconnect is a user-visible action here, not a free round-trip**: every read emits `op:start`/`op:end` (`scheduler/ops.ts:46`, `:76`), is persisted by `main/oplog.ts:33`, and appears in the operations panel (`state/ops.ts:16-28`). P47's own acceptance checklist asserts "the whole scroll sequence adds **zero** rows to the operations panel". A background refetch is a row in the user's op log and a real query against their production database. (c) **Cancellation is server-side**: `control.opsCancel(opId)` aborts an `AbortController` held inside the engine process (`scheduler/ops.ts:42-43`, `:89`); a client `AbortSignal` only abandons a promise, which `bridge/data.ts:21-23` explicitly refuses as a model. (d) **Supersession is already solved and is not key-based**: `beginOp`/`rt.opId` (`viewOp.ts:107-114`, `keyvalue/state.ts:89,103`) is last-write-wins on a per-tab slot, which is what a tab UI wants. (e) **There is often no stable key to cache under**: a cursor-paged Redis/Kafka page is addressed by opaque single-use tokens (`keyvalue/state.ts:164`, `:176`), and `:82-88` documents that re-sending an offset to a cursor-paged key silently restarts the scan — "page 3 of this hash" is not a cacheable identity. |
| D8 | **TanStack Form — do not adopt.** | F14: the application has exactly one real form. `ConnectionDialog.vue`'s entire form machinery is one `safeParse` projected onto a flat `fieldErrors` record (`:205-212`) plus a `canSave` computed (`:228`) — roughly fifteen lines. The other three dialogs are effectively single-control. TanStack Form's value is per-field async validation, field arrays and a submit lifecycle; none of the three has a user here. And the validating schema is `@shared/domain/connection`'s, shared verbatim with the main process's own IPC parse, so a form library would either duplicate that source of truth or wrap it — both worse than reading it directly. |
| D9 | **VueUse — do not adopt.** | F15: the surface it would actually cover is two `ResizeObserver` sites, 23 `addEventListener` calls and 12 `setTimeout`s — call it thirty lines. Everything else in its catalogue has no user: no `useStorage` (settings go through IPC to SQLite, not web storage — there is *no* `localStorage` in the renderer at all), no `useFetch` (no HTTP in the renderer), no `useRouter` (D10), no `useDark` (themes are CSS custom properties set by `applyAppearance`, `state/settings.ts:19-27`), no `onClickOutside` (`PopoverPanel.vue:4-8`'s backdrop is a deliberate different answer). Its own `useVirtualList` is strictly weaker than either implementation here. And one of the two `ResizeObserver` sites is *specifically* not interchangeable: `DataGrid.vue:326-344` exists because it must read `clientWidth`/`clientHeight` rather than the border box — `useResizeObserver` would hand back exactly the P47 regression F3 records. A dependency for thirty lines, one of which it would get wrong. |
| D10 | **vue-router — do not adopt; not applicable.** | There is no URL, no history stack and no deep-link surface in a single-window Electron app that loads one `file://` document. Navigation *is* the tab model: `state/tabs.ts` (641 lines) holds tab records, `main/storage/repos/tabs.ts` persists them, and `hydrateTabs()` restores them at boot (`main.ts:66`). There is no route for a router to route to, and P46 already closed top-level navigation off deliberately (`src/main/security.ts`). |
| D11 | **A third-party component library (PrimeVue / Naive UI / Element Plus / Radix Vue / shadcn-vue) — do not adopt.** | `theme/primitives/` is fifteen components and they are not generic: `ViewChrome`, `ReconnectGate`, `RunState`, `PanelSplitter`, `VirtualList` are app-shaped, and the four genuinely generic ones (`AppButton`, `TextField`, `IconButton`, `DialogFrame`) are already the single implementation behind every call site — P48 spent eighteen commits driving the last holdout (`DataView.vue`) onto `ViewChrome`. Introducing a kit would re-scatter what P48 just unified, and would fight P38's Catppuccin theming, which is built on CSS custom properties the app owns end to end. The one place a kit would genuinely have helped — accessible overlay positioning — is D12's item, and is available without the kit. |
| D12 | **`@floating-ui/vue` — revisit later, if and only if X changes.** The only non-"no" in the survey, and still not an adopt. | F16 is real duplication: five positioners, each with its own flip/clamp arithmetic, already disagreeing about which axis flips and which clamps, in a codebase that has *already shipped and fixed* one bug of exactly this class (`PopoverPanel.vue:28-34`, task #58). Floating UI's `flip`/`shift`/`autoUpdate` is precisely this problem's library, and P48's audit never looked here (its scope was the six data views and the adapters — the grep returns nothing). But the total is about twenty-five lines, nothing is reported broken today, and some of the divergence is deliberate rather than drift (`PopoverPanel.vue:10-11` carves out the mouse-anchored context menu as a genuinely different model). **X** = either a third positioning bug of that class, or a sixth anchored-overlay surface. The cheaper interim move, if anyone wants one before X: hoist the flip/clamp into one shared function under `theme/` — same consolidation, no dependency. |
| D13 | **`zod` — already adopted; no decision to make.** | F17: 26 files, spanning the IPC boundary (`main/ipc/queries.ts:17-48`), the domain layer, the wire protocol and the capability descriptor — and doing double duty as the persisted-settings migration mechanism via `.default()` on every section (`shared/domain/settings.ts:35-42`). Recorded as a decision only because SPEC's P49 brief asks the question explicitly; the answer is that the gap it imagines does not exist. |
| D14 | **`drizzle-kit` — do not adopt.** | F18: five hand-written numbered `.sql` files over the app's entire life, loaded with Vite's `?raw` and applied transactionally against a `schema_version` integer (`migrate.ts:5-32`). drizzle-kit generates migrations by diffing the schema against a live database and maintains its own journal — so adopting it means a build-time step, a second migration ledger to keep consistent with the first, and unpicking the `?raw` import path, for a file count that grows about once a year. It also would not reproduce what the hand-rolled path already guarantees: `migrate.ts:16-21`'s refusal to run at all against a database written by a *newer* build, which is the one failure mode that silently corrupts a user's data. |
| D15 | **`lru-cache` — do not adopt.** | F19: `lru-cache` does support `maxSize`/`sizeCalculation`, so the byte budgeting is a fair match. What it does not carry is the two things `ByteLru` exists for: `deleteWhere(pred)` over `{connectionId, path, label}` metadata (`lru.ts:82-92`), which *is* the entire invalidation vocabulary — `cache/index.ts:76-101` is four different predicate shapes over it — and the half-budget refusal with its own warning (`lru.ts:56-63`), which exists so one 40 MB page cannot evict a 64 MB cache. Both would come back as adapter code around the library, so the 115 lines do not go away, they just move and gain a dependency underneath. |
| D16 | **No library gap exists in `src/main/` or `src/engine/`, and the patterns that superficially invite one are each deliberate.** | F19/F20, as one decision because each sub-case has the same shape — the obvious library would undo a measured decision. The adapter registry's lazy `import()` map exists because eager imports cost >100 MB of engine RSS (`registry.ts:5-12`), so any eagerly-resolving plugin/DI framework regresses it. The IPC registry is eleven function calls and an 11-line `deps.ts`; there is no container to introduce. `utilityProcess.fork` is Electron's own API and the no-auto-respawn policy (`engine-host.ts:70-71`) removes the case a supervisor or retry library serves. `electron-log` already covers logging behind a three-line façade. There is no HTTP surface at all (F20), so the entire framework/middleware/request-validation family is inapplicable. |
| D17 | **"No clear win" is this spike's expected and accepted outcome, and this plan does not manufacture one to justify itself.** | P47 D15's reasoning, generalised: the failure mode of a survey phase is a session that has read ten library docs deciding it would be embarrassing to recommend none of them. Ten were considered; the outcome is eight "no", one "already adopted", one "revisit later", and two dependency-free defects found by reading the code they would have replaced (D4, D5). That second half is the actual value of the exercise — the survey found real work, just not the work it was nominally looking for. |
| D18 | **This phase produces no code and edits no file but its own; `docs/PERF.md`'s overstated wording (D2) is recorded here and handed on, not fixed here.** | AGENTS.md's "scope left out of a phase is left out entirely, not half-implemented", plus the standing practice (P47 D18, P29 D17) that the phasing table is a record of what shipped. A plan-only phase that quietly edits `PERF.md` in passing would be doing implementation under a `docs:` commit and would make its own scope statement false. The correction belongs to whichever phase next has a legitimate reason to touch `PERF.md` §2.1 — most likely §5.1's, if that is greenlit and re-measures the console. |

## 4. Verdict table

| Library | Verdict | One-line reason |
|---|---|---|
| `@tanstack/vue-virtual` — **keep in `DataGrid.vue`** | **keep (no revert)** | The go clause holds on one measured leg rather than three, and reverting a working, tested migration to reclaim ~6 net lines would cost more than it returns (D1/D2). |
| `@tanstack/vue-virtual` — **extend to `VirtualList.vue`** | **no-go** | Single-axis consumers gain nothing the library is good at, three `VirtualList` features have no library equivalent, and there is no symptom and no baseline to judge a migration by (D3). |
| **Pinia** | **don't adopt** | State hydrates before `createApp()`, the unit suite imports state modules with no Vue app, and the two store factories are a per-tab keyed registry and a deliberately non-reactive page cache — neither is what `defineStore` replaces (D6). |
| **TanStack Query** | **don't adopt** | The cache already lives in the engine process with its own invalidation verbs, every read is a logged user-visible database op, cancellation is server-side, and cursor-paged pages have no stable key (D7). |
| **TanStack Form** | **don't adopt** | One real form in the app, ~15 lines of machinery, already validated by a zod schema shared with the main process (D8). |
| **VueUse** | **don't adopt** | Covers ~30 lines here, and the one composable it would most obviously replace (`useResizeObserver`) reads the wrong box and would reinstate P47's scrollbar regression (D9). |
| **vue-router** | **don't adopt** | No URL, no history, no deep links — navigation is the persisted tab model (D10). |
| **PrimeVue / Naive UI / Element Plus / Radix Vue / shadcn-vue** | **don't adopt** | `theme/primitives/` is app-shaped and P48 just finished consolidating onto it; a kit would re-scatter that and fight the CSS-custom-property theming (D11). |
| **`@floating-ui/vue`** | **revisit later if X changes** | Five overlay positioners already disagree and one bug of that class has shipped — but it is ~25 lines with no live bug; X = a third such bug or a sixth overlay (D12). |
| **`zod`** | **already adopted** | 26 files; the IPC/domain/protocol validator and the persisted-settings migration mechanism (D13). |
| **`drizzle-kit`** | **don't adopt** | Five hand-written migrations total, and the hand-rolled path already refuses to run against a newer schema, which drizzle-kit does not do (D14). |
| **`lru-cache`** | **don't adopt** | `deleteWhere` over entry metadata *is* the invalidation vocabulary, and the half-budget refusal is app-specific; both come back as adapter code (D15). |
| **pino / winston, an HTTP framework, a DI container, a retry/supervisor library** | **don't adopt (N/A)** | `electron-log` is already wired; there is no HTTP surface; `deps.ts` is 11 lines; auto-respawn is deliberately absent (D16). |

## 5. If greenlit — what each "go" would actually require

Framed conditionally throughout. Nothing below is committed by this plan; the deliverable is §1–§4.

### 5.1 The console's column axis (D4) — the recommended one, if any

A rough step list, each step one commit, each leaving `bun run lint`, `bun run typecheck` (four
projects) and `bun run build` green:

1. **Measure first.** Extend `tests/ui/budgets.spec.ts` or add to `perf.spec.ts` a DOM-cell bound on
   `[data-testid="console-result-cell"]` against the existing `app.scroll_grid` fixture
   (`tests/ui/support/pg.ts`, 60 columns × 5 000 rows) run through the query console. Record the
   number **before** any change — F10 means there is no baseline today, and P47 D13's
   same-machine/same-session rule applies.
2. **Give `ConsoleResultGrid.vue` a horizontal virtualizer**, mirroring `DataGrid.vue:385-398`:
   `useVirtualizer` with `horizontal: true`, `overscan: 0`, `paddingStart: GUTTER_WIDTH`,
   `rangeExtractor: (range) => columnRangeExtractor(range, offsets, OVERSCAN_PX,
   MAX_OVERSCAN_COLUMNS)` and `observeElementRect` measuring `clientWidth`/`clientHeight` (F3 —
   hoist `observeScrollElementRect` out of `DataGrid.vue` into `views/shared/page/` rather than
   copying it, or the two grids will drift the way P48 found everything else had). Derive
   `colStart`/`colEnd` as primitive computeds (P47 D3) so the header and body loops read numbers,
   not item arrays.
3. **The row axis is the open design question, and it should be decided explicitly rather than by
   default.** `ConsoleResultGrid` uses `VirtualList` for rows (`:299`) with an in-flow `#header`
   slot; the SQL grid uses a virtualizer with absolute placement. Mixing a `VirtualList` row axis
   with a TanStack column axis in one component is possible (they share a scroll element) but the
   spacer-vs-absolute mismatch has to be reasoned about, not assumed. The conservative option is to
   leave rows on `VirtualList` and add columns only; the coherent option is to align the two grids.
   Either way this is where the phase's real risk lives, and it needs a decision with a reason.
4. **Consider a console row cap** (`executeRequestWireSchema` gaining a limit, F9's second half) —
   but note it changes observable behaviour and every other console phase has treated "the console
   shows what the statement returned" as a contract. Probably a separate question.
5. **Re-run step 1's measurement** and record before/after in `docs/PERF.md` §2.1, in the format the
   P47 block already uses — and correct D2's overstated "all three improved" wording while in the
   file, since that is the legitimate occasion D18 hands it to.

### 5.2 Row virtualization for key/value and stream (D5)

1. Mount `VirtualList` in `KeyValueView.vue` around the `v-for` at `:849` and in `StreamView.vue`
   at `:823`, passing `:items="rowIndices"` and the settings-driven `rowHeight`. Both row shapes
   are uniform-height, so neither needs `rowHeights`.
2. Wire the `visible-range` emit into `visibleRowsOf`/`setVisibleRows` for each tab — this closes
   the hole `keyvalue/search.ts:48-51` documents, so the find toolbar's priority window starts
   working for these two views the way it already does for documents and the console.
3. Verify the search-filter path: both views keep real row numbers in the gutter under an active
   filter (`KeyValueView.vue:117-118`, `StreamView.vue:108-109`), so `rowIndices` is already the
   display-position array `VirtualList` should window — but this is the P24 D4 / P29 D11 failure
   mode and must be checked by hand, not assumed.
4. Add a DOM-node bound for `[data-testid="keyvalue-row"]` at the 10 000-row page size (F10 — no
   such assertion exists), or the change is unfalsifiable.
5. `tests/ui/redis.spec.ts`, `kafka.spec.ts`, `sqs.spec.ts` and `rabbitmq.spec.ts` locate rows by
   `data-testid`, so they become the regression guard for free — but they are Docker-gated and
   cannot run in this sandbox (AGENTS.md), which must be recorded as verification debt rather than
   glossed.

### 5.3 The overlay-positioning consolidation (D12) — only when X fires

One commit: a shared `anchoredPosition(triggerRect, panelSize, opts)` under `src/renderer/theme/`,
adopted by `PopoverPanel.vue:47-77`, `AppTooltip.vue:16-20` and `ErrorPopover.vue:22-27`, leaving
`ContextMenu.vue` alone (deliberately a different, mouse-anchored model). Unit-testable in
`tests/unit/` with no browser — it is pure arithmetic over four numbers, the same argument P47 D16
made for `columnRangeExtractor`. Only if that consolidation proves insufficient does
`@floating-ui/vue` become the answer.

### 5.4 What a "go" on any adopt-verdict would have required — recorded, since none fired

For completeness, so a future reader knows the bar was defined and not merely missed: adopting any
surveyed library would have needed (a) a named problem in this codebase that the library solves and
the current code does not, cited by file and line; (b) a before/after measurement or a strict
simplification by the F2-style accounting, per P47 D14's go clause; and (c) no existing assertion
weakened to accommodate it, per P47 D17. None of the ten cleared (a).

## 6. Explicitly out of scope

- **Any code change at all.** This phase is the analysis (D18). §5's step lists are conditional
  sketches, not a plan of record; if either is greenlit it gets its own phase and its own
  Opus-authored plan per AGENTS.md.
- **Editing `docs/PERF.md` to correct D2's wording.** Handed on, not done here (D18).
- **Re-running P47's measurements.** D1's verdict rests on the numbers already recorded at
  `PERF.md:78-82` read against D14's own threshold, which is a reading exercise, not a measuring
  one. A fresh run would be a different phase with a different purpose, and this sandbox cannot
  produce macOS numbers anyway.
- **P47's own unfinished business** — complaint (b), the "silky scroll velocity" question P47 F1
  ruled out of any virtualizer's reach; `transform: translateY` placement (P47 D4); `measureElement`
  / dynamic row heights; routing `scrollCellIntoView` through `scrollToIndex`. All four are named in
  P47 §6 and none is part of what SPEC's P49 row asks for.
- **The console row cap** (§5.1 step 4). It changes what the query console shows, which is a product
  decision, not a virtualization one.
- **`ContextMenu.vue`'s positioning.** Mouse-anchored rather than trigger-anchored, deliberately a
  different model (`PopoverPanel.vue:10-11`), and out of D12's scope even if D12 ever fires.
- **Libraries with no plausible surface here**, not enumerated one by one: charting, i18n, form-data
  upload, animation, date manipulation (33 `Date`/`Intl` call sites across the whole renderer, all
  formatting), state machines, DnD (two HTML5 `draggable` reorder lists, ~10 lines each —
  `TabStrip.vue:180-185`, `ColumnsMenu.vue:130-132`). Named collectively so it is clear they were
  considered and dismissed for want of a problem rather than overlooked.

## 7. Open questions for the user

1. **The headline: nothing in the ecosystem survey is worth adopting, and the two things worth doing
   need no dependency at all** (D4, D5). Is that an acceptable outcome for a phase framed as a
   library survey, or would you like a specific library re-examined against evidence you have that
   this plan does not?
2. **P47's recorded justification is stronger than its measurements support** (D2) — one of three
   metrics moved outside the noise band the plan itself declared. The verdict still holds. Do you
   want that correction made to `docs/PERF.md` and `SPEC.md`'s P47 row now, as its own small `docs:`
   commit, or left for whichever phase next touches those files (this plan assumes the latter, D18)?
3. **`ConsoleResultGrid.vue` renders every column of every visible row and the console has no row
   cap** (D4). This is the most defensible piece of work the spike found. Worth queuing as its own
   phase, or is a wide `SELECT *` in the console rare enough in practice that it can wait for
   someone to notice?
4. **Key/value and stream virtualize nothing, at up to 10 000 rows** (D5). SPEC's own P49 text
   assumed otherwise. Same question: queue it, or leave it as a recorded latent risk? Note it is
   invisible to the test suite either way until a DOM-node bound is added (F10).
5. **`@floating-ui/vue` is the one honest "maybe"** (D12), and the cheaper first move is a shared
   flip/clamp function with no dependency (§5.3). Do you want that consolidation now on the strength
   of "five positioners already disagree", or is "no live bug" enough to leave it?
