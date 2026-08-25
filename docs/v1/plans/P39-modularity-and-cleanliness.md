# P39 — Code modularity, reusability and overall cleanliness

> **Not a SPEC.md §10 phase.** §10's table ends at **P38 Catppuccin themes** (`SPEC.md:878`), which
> is being **skipped entirely** by user direction — nothing in this plan touches themes,
> `theme/tokens.css`'s palette, or `docs/v1/plans/P38-catppuccin-themes.md`'s subject matter. P39 is
> a new, post-v1, user-directed phase in the tradition of P16 and P31 (*"Not a planned deliverable —
> a batch of user-directed work … grouped into one phase rather than reopening"* the eight phases
> that produced it). The ask, in the user's own framing: **reorganize classes, folders and modules
> for modularity, reusability and cleanliness** — a real restructuring, not a cosmetic pass.
>
> **What that means here, precisely.** After 38 phases the app works; what has accumulated is
> *structure debt*: 18 imports that break §11's own dependency rule, three near-verbatim copies of a
> 253-line component, five page stores where three are the same file, ten adapters repeating the
> same one-line stub, six dead exports (one of which its own comment says should have been deleted
> in P24), and three different module-naming conventions across four sibling view folders. Every one
> of those is cited below with a file and a line.
>
> **This phase changes no behavior.** Not a rendered pixel, not a `data-testid`, not a wire payload,
> not a persisted row. Every finding is answered by a move, a merge, a rename or a deletion of
> something provably unreachable. Where a merge *would* change behavior — and §1's F16 found exactly
> one such case, a real drift inside `state/tabs.ts` — the plan preserves today's behavior verbatim
> and hands the divergence to P40 (the functionality-review phase) rather than smuggling a fix into
> a refactor commit.

---

## 0. Ground rules for this phase

- **No behavior change, and that is the acceptance criterion, not an aspiration.** Every touched
  call site must produce identical output, identical DOM (including every `data-testid`), identical
  IPC traffic and identical persisted state before and after. Each step in §4 names the suites that
  re-confirm it. A step whose diff cannot be argued to be behavior-identical does not belong in this
  phase.
- **Every finding below was read in the tree**, and each carries a `file:line`. Where a claim is
  about *absence* (nothing imports X, nothing calls Y) it was produced by a repo-wide grep over
  `src/` **and** `tests/`, and the exact absence is stated rather than implied. This box has no
  `node_modules` (`ls node_modules/.bin` → no such directory), so unlike P31 nothing here was
  verified by running the built app; every claim is a source claim, and §5 is written accordingly.
- **Move before merge; merge only where the duplication is real.** Three of the four page stores are
  the same file (F9) and get one factory; the fourth and fifth are not (D7). Three of the four
  search scanners are the same algorithm (F10); the stream's is deliberately a different, simpler
  one and stays (D8, §6). Eleven adapters share a capability-stub shape (F18) and a projection
  resolver (F19); they do **not** share error classification or type mapping, and those stay eleven
  separate files (D15, §6).
- **Extend the homes this codebase already has.** `views/shared/` (P31 D12/D16), `renderer/state/`
  (§11's own rationale), `theme/primitives/`, `engine/adapters/sql-text.ts` (*"the genuinely shared,
  driver-agnostic glue … kept out of the adapter folders because duplicating it would guarantee they
  drift"*, `sql-text.ts:5-7`) and `mysql-family/` (P34's shared-core-plus-thin-profile precedent) are
  all existing answers to exactly the questions §1 asks. No new architectural concept is introduced
  by this phase.
- **No half-migrations (AGENTS.md).** A module that moves takes *every* importer with it in the same
  commit; a helper that is hoisted leaves **no** copy behind. If a finding cannot be fixed
  everywhere it occurs, it is named in §6 and left entirely alone.
- **No new dependency, no new build step, no new lint mechanism.** Every step is a file move, an
  import-path edit, a deletion, or a factoring-out with the same public shape.
- Comments per AGENTS.md: only where the code cannot say it for itself. A moved file keeps its
  existing comments verbatim; a new shared module gets one header comment naming what it replaced,
  the way `views/shared/searchFilter.ts:4-9` does.
- `bun run lint`, `bun run typecheck` (node, web, db) and `bun run build` stay green after **every**
  commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. The renderer's dependency graph is not the one §11 describes

SPEC §11's own rationale (`SPEC.md:1037-1039`): *"**`renderer/state/`** exists so `views/*` are
siblings that depend downward on shared state, **never sideways on each other or upward into
`workbench/`** — the dependency graph stays a tree as more view kinds are added."* Both halves of
that sentence are false today.

**F1 — eighteen `views/* → workbench/*` imports.** Complete list, from
`grep -rn "from '\.\./\.\./workbench/" src/renderer/views`:

| Target | Importers |
|---|---|
| `workbench/state/contextMenu` | `grid/DataGrid.vue:20`, `grid/gridMenu.ts:5`, `documents/DocumentView.vue:22`, `documents/documentMenu.ts:1`, `keyvalue/KeyValueView.vue:27`, `keyvalue/keyValueMenu.ts:3`, `stream/StreamView.vue:21`, `stream/streamMenu.ts:2`, `definition/ColumnsSection.vue:7` |
| `workbench/panels/ViewChrome.vue` | `documents/DocumentView.vue:21`, `keyvalue/KeyValueView.vue:26`, `stream/StreamView.vue:20`, `definition/DefinitionView.vue:21`, `console/ConsoleView.vue:15` |
| `workbench/VirtualList.vue` | `documents/DocumentView.vue:23`, `console/ConsoleResultGrid.vue:7` |
| `workbench/state/layout` | `celleditor/CellEditorDock.vue:5` |
| `workbench/PanelSplitter.vue` | `celleditor/CellEditorDock.vue:4` |

**F2 — `workbench/state/contextMenu.ts` is app state living in a feature folder.** It has fourteen
importers and **eleven of them are outside `workbench/`**: the nine in F1 plus
`project/ProjectTree.vue:10` and `project/menus.ts:31`. Its content is `MenuItem`, a reactive
`contextMenuState`, `openContextMenu`, `closeContextMenu` and `runMenuShortcut`
(`contextMenu.ts:1-40`) — a global service and its vocabulary, which is exactly what
`renderer/state/` is described as holding (*"cross-view app state … promoted out of `workbench/` so
`views/` doesn't have to reach into `workbench/` to read it"*, `SPEC.md:991-993`). Its sibling
`workbench/state/layout.ts` is the same story at smaller scale: six importers, three of them outside
`workbench/` (`shortcuts/state.ts:5`, `celleditor/CellEditorDock.vue:5`, plus `App.vue:15` /
`main.ts:17` at the root).

**F3 — `workbench/panels/ViewChrome.vue` has zero importers inside `workbench/`.** All five are
views (F1), and it imports nothing from `workbench/` itself — only `state/connections`,
`state/runState`, `theme/connColor` and three `theme/primitives/*`
(`ViewChrome.vue:1-9`). Its own doc comment describes it as *"the view-head + rail + toolbar +
run-state trio **every non-grid view** opens with"* (`ViewChrome.vue:11-16`). It is a view primitive
filed under the workbench's panel folder, and nothing holds it there.

**F4 — `VirtualList.vue` and `PanelSplitter.vue` are generic primitives with mixed-folder
callers.** `VirtualList.vue` is a `generic="T"` SFC over `items`/`rowHeight`/`rowHeights`
(`VirtualList.vue:1-17`) called from `workbench/panels/OperationsPanel.vue`, `project/ProjectTree.vue:11`,
`documents/DocumentView.vue:23` and `console/ConsoleResultGrid.vue:7` — three folders, one of them
`workbench/`. `PanelSplitter.vue` takes `orientation/size/min/max/reverse` and emits `resize`
(`PanelSplitter.vue:1-14`) with no app coupling at all; its callers are `WorkbenchShell.vue` and
`celleditor/CellEditorDock.vue:4`. `theme/primitives/` already holds exactly this class of thing,
including two components that are pure view chrome (`ViewHeader.vue`, `ReconnectGate.vue`).

**F5 — six sideways `views/* → views/*` imports**, the rule P31 F18 quoted (*"§11 forbids a sideways
`views/*` → `views/*` import"*) when it moved `DateTimePicker.vue` into `views/shared/`:

- `../celleditor/CellEditorDock.vue` from `grid/DataView.vue:12`, `documents/DocumentView.vue:24`,
  `keyvalue/KeyValueView.vue:28`, `stream/StreamView.vue:22`, `console/ConsoleView.vue:16`
- `../grid/columns` from `console/ConsoleResultGrid.vue:8`, whose own comment states the reuse
  plainly: *"This keeps only what both share: `columns.ts`'s width/alignment helpers"*
  (`ConsoleResultGrid.vue:14-15`)

**F6 — `views/celleditor/` is not a view kind.** `tabKindSchema` has six members
(`shared/domain/tabs.ts:5-12`) and `MainView.vue:66-92` dispatches exactly six components. The
cell editor is a *panel* five of those six views mount (P26), and it is a clean leaf: every one of
its imports goes to `state/`, `theme/`, `editor/`, `../shared/` or `workbench/` — **not one to
another view** (`celleditor/*.vue`, `*.ts` import lists). Nothing about it depends on it living
beside its consumers.

**F7 — two `project/` modules have no `project/` consumer, or only half of one.**
`project/typeGlossary.ts` is imported by `views/definition/ColumnsSection.vue:5` and
`views/grid/DataGrid.vue:6` and by **nothing in `project/`** at all. `project/icons.ts` exports
`nodeIcon` (project-only) and `columnTypeIcon`, which `TreeRow.vue:8` and
`views/definition/ColumnsSection.vue:3` share — P19 D9's deliberate relocation of the tree's column
affordances into the definition view, which moved the data but left the vocabulary behind.
`theme/` already holds two modules of exactly this kind: `theme/cellClass.ts` and
`theme/connColor.ts`, both "app value → visual token" maps.

**F8 — `shared/`'s root files contradict §11's own tree.** §11 lists `protocol/  ipc.ts, port.ts,
engine-ops.ts` (`SPEC.md:1008`), but `port.ts` is at `src/shared/port.ts` — pure wire-message shapes
(`PortRequest`/`PortResponse`/`PortEvent`/`PingPayload`, `port.ts:1-20`) with six importers across
`engine/`, `main/` and `renderer/bridge/`. Beside it sit three more root files that are domain
vocabularies with Zod schemas — `layout.ts` (window bounds, panel sizes), `settings.ts` (appearance/
data/cache/advanced) and `shortcuts.ts` (the §8.16 binding table) — while `shared/domain/` is
described as the home for *"types + Zod schemas for domain concepts, independent of any one
transport"* (`SPEC.md:1009-1010`). §11's listing is also silently short two protocol files that do
exist: `protocol/data-ops.ts` and `protocol/page.ts`. Only `caps.ts` is a documented root member
(`SPEC.md:1013`).

### B. The four data views repeat themselves

**F9 — five page stores; three of them are one file.** `views/documents/docPage.ts`,
`views/keyvalue/kvPage.ts` and `views/stream/streamPage.ts` are identical from their `interface
Entry` through `totalRetainedBytes()` — same `pages` Map, same `decoder`, same `pageVersion`, same
`setPage`/`getPage`/`drop`/`dropForTab`/`totalRetainedBytes` bodies — differing only in the page type
and the row accessor below them (`docPage.ts:8-44`, `kvPage.ts:7-40`, `streamPage.ts:7-40`). Their
own headers say so: *"Mirrors `views/documents/docPage.ts` **exactly**"* (`kvPage.ts:4`), *"Mirrors
`views/keyvalue/kvPage.ts` **exactly**"* (`streamPage.ts:4`). `views/grid/page.ts` and
`views/console/resultPages.ts` share the same skeleton but genuinely diverge below it (a row×col
decode cache and a visible-window pruner, `page.ts:61-101`; a `windowKey` and a `Page` union,
`resultPages.ts:9-13`).

**F10 — three chunked search scanners, one algorithm.** `grid/search.ts`, `documents/docSearch.ts`
and `keyvalue/kvSearch.ts` each declare their own `SearchQuery`, `SearchHandle`, `CHUNK_ROWS = 2000`,
`searchState`, `clearSearchState`, `registerTabRuntimeCleanup(...)`, `matchedRows`, `escapeRegExp`,
the same three-line pattern compilation, and the same `requestAnimationFrame` chunk driver with the
same cancel/zero-width-match/`onProgress`/resolve semantics (`search.ts:17-119`, `docSearch.ts:6-112`,
`kvSearch.ts:11-111`). The only genuine difference is the per-row body: all columns of a
`TabularPage`, one preview line, or two fixed chunks. `escapeRegExp` is byte-identical in all three
(`search.ts:54`, `docSearch.ts:42`, `kvSearch.ts:47`).

**F11 — three search toolbars that differ in three things.** Normalising testid prefixes and the
`doc`/`kv` module names away, `documents/DocumentSearchToolbar.vue` and
`keyvalue/KeyValueSearchToolbar.vue` diff to **comments only, plus the `col` in `goToMatch` and the
word "documents" vs "rows"**; `grid/SearchToolbar.vue` adds only longer comments over the same
script and the same template. Same `startSearch(autoScroll)`, same `watch([query, matchCase,
wholeWord, regex])`, same `watch(() => pageVersion.n)` re-scan (P31 D22), same `goNext`/`goPrev`,
same `close()`/`onUnmounted` filter reset (P31 D18), same markup down to `.sep` placement and
`.search-input { width: 200px }` (`SearchToolbar.vue:1-276`, `DocumentSearchToolbar.vue:1-254`,
`KeyValueSearchToolbar.vue:1-253`). P24 §6 rejected consolidating these *"for reasons that still
hold (three different match shapes, four different page stores)"* — and P31 D16 then unified the
filter state, P31 D22 unified the page dependency, and P31 D17 unified the toggle. What is left of
"three different match shapes" is one optional `col` field. `stream/StreamSearchToolbar.vue` (158
lines) is **not** in this set: it has no case/word/regex toggles and drives a different scanner.

**F12 — the disconnect classifier exists five times.** `const DISCONNECTED_CODES = new
Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT'])` at `grid/state.ts:82`, `documents/state.ts:56`,
`keyvalue/state.ts:51`, `stream/state.ts:63`, `console/state.ts:57`, each followed by the same catch
block — `code ?? 'E_QUERY'` → `E_CANCELLED` ⇒ `status = 'cancelled'` → `DISCONNECTED_CODES.has(code)`
⇒ `unmarkHydrated(tabId)` → else `status = 'error'` (`grid/state.ts:135-153`, `documents/state.ts:100-113`,
`keyvalue/state.ts:90-105`, `stream/state.ts:117-133`, `console/state.ts:90-113`). The console's copy
additionally sets `rt.status = 'idle'` before `unmarkHydrated` and documents why
(`console/state.ts:52-58`) — a real, deliberate difference inside otherwise-copied code.

**F13 — `runCount` and `stop` are copied four and five times.** `stop(tabId)` is byte-identical in
all five (`grid/state.ts:201`, `documents/state.ts:144`, `keyvalue/state.ts:133`, `stream/state.ts:160`,
`console/state.ts:116`). `runCount` differs only in the tab finder and the `filter` argument —
`null` for keyvalue/stream (`keyvalue/state.ts:115-131`, `stream/state.ts:142-158`), the tab's own
search text for documents (`documents/state.ts:125-142`), the tab's filter for the grid
(`grid/state.ts:181-199`) — around an identical try/catch whose comment is the same sentence in four
files.

**F14 — the page-size table is written out four times.** Four literal arrays of the same
`10/100/1000/10000` + `'10'/'100'/'1k'/'10k'` pairs, differing only in the testid prefix:
`grid/DataToolbar.vue:39-44`, `documents/DocumentView.vue:230-236`, `keyvalue/KeyValueView.vue:142-148`,
`stream/StreamView.vue:200-205`. A fifth page size would have to be added in four places.

**F15 — the search-match colours are declared in four scoped stylesheets.**
`background: color-mix(in srgb, var(--kira-warn) 25%, transparent)` and the solid
`var(--kira-warn)` current-match pair appear at `grid/DataGrid.vue:1700-1707`,
`keyvalue/KeyValueView.vue:928-935`, `stream/StreamView.vue:893-900` and
`documents/DocumentView.vue:989-995` — three of them added by P31 D20/D21 *to make the four views
agree*, with the agreement expressed as four copies of the same two declarations.

**F16 — `state/tabs.ts` holds six copies of two functions, and three of them have already
drifted.** Six `openXTab` functions repeat the same "find existing → activate and return → else
create record → `deactivateAll()` → push → `activeId` → `hydrated.add` → `recordRecent` → `saveNow`"
sequence (`tabs.ts:166`, `:204`, `:238`, `:260`, `:296`, `:332`), and six `patchXTabState` functions
repeat the same four-line body (`tabs.ts:543`, `:551`, `:559`, `:567`, `:574`, `:581`). **The first
three call `patchChanged(target.state, patch)` and return early when nothing changed; the last three
do not** — so a no-op patch on a document, key/value or stream tab still schedules a debounced save
while the same no-op on a data, console or definition tab does not. This is a behavior difference,
not a formatting one, and P39 must not silently erase it (D12).

### C. The adapters

**F17 — driver-error mapping lives in three places under five names.** Nine adapters have
`errors.ts`; two do not. The exported mapper is `mapError` in `clickhouse/errors.ts:31` and
`sqlite/errors.ts:21`, `mapPgError` in **`postgres/query.ts:24`**, `mapError` in
**`mysql-family/query.ts:35`**, `mapMongoError` in `mongo/errors.ts:8`, `mapRedisError` in
`redis/errors.ts:7`, `mapS3Error` in `s3/errors.ts:6`, `mapSqsError` in `sqs/errors.ts:7`,
`mapKafkaError` in `kafka/errors.ts:48`, and `mapHttpError`/`mapNetworkError` in
`rabbitmq/errors.ts:16,34`. Three of these files' comments point at each other as the pattern to
follow (*"Mirrors `mysql-family/query.ts`'s mapError"*, `mongo/errors.ts:4`; *"Mirrors
`mysql-family/query.ts`'s mapError / `mongo/errors.ts`'s mapMongoError"*, `redis/errors.ts:4`;
*"Mirrors `sqs/errors.ts`'s mapSqsError exactly"*, `s3/errors.ts:3`) while sitting under three
different names in two different files.

**F18 — the same capability stub, twenty times.** `downloadObject()` throws
`` `file transfer is not supported for <kind>` `` in every adapter but `s3/`:
`postgres/index.ts:336`, `mysql-family/index.ts:340`, `sqlite/index.ts:257` (which uses
`` `${this.kind}` ``), `clickhouse/index.ts:208`, `mongo/index.ts:202`, `redis/index.ts:149`,
`kafka/index.ts:133`, `sqs/index.ts:136`, `rabbitmq/index.ts:181` — nine one-line copies of one
sentence. `execute()` throws `` `<kind> has no query console` `` four more times
(`kafka/index.ts:124`, `sqs/index.ts:129`, `s3/index.ts:137`, `rabbitmq/index.ts:176`), and
`describe()`/`definition()` seven more (`kafka/index.ts:85`, `sqs/index.ts:85`,
`rabbitmq/index.ts:131`, `redis/index.ts:93,98`, `s3/index.ts:106,111`) — twenty in all.

**F19 — two read-path helpers are byte-identical across the SQL adapters.**
`resolveProjection(target, requested)` — the `Set`-dedup, `E_NOT_FOUND` on an unknown column,
ordinal re-sort — is character-for-character the same in `postgres/read.ts:56`,
`mysql-family/read.ts:56`, `sqlite/read.ts:57` and `clickhouse/read.ts:95` (Postgres's copy carries
two extra comment lines). `safeInt(value, label)` is identical in `mysql-family/read.ts:49`,
`sqlite/read.ts:50`, `clickhouse/read.ts:88` and `mongo/read.ts:14`. Both are exactly what
`adapters/sql-text.ts` says it exists for (`sql-text.ts:5-7`), and neither is dialect-shaped:
`resolveProjection` reads only `ColumnMeta.name`/`.position`, `safeInt` reads only a number.

**F20 — the adapter folder shape drifts from the "fixed internal shape" §11 promises.** §11:
*"Adapters keep one fixed internal shape (`index.ts`/`client.ts`/`query.ts`/`definition.ts`/`read.ts`)
so `tests/db/` can mirror `engine/adapters/` 1:1 and a reviewer already knows where MongoDB's
`read.ts` will be before it exists"* (`SPEC.md:1034-1036`). In the tree: `postgres/` has no
`errors.ts` (nine others do); `mongo/`, `redis/`, `s3/` and `sqs/` have no `query.ts`; `kafka/` has
`produce.ts` where the other write-capable adapters have `mutate.ts`; `redis/` and `s3/` have no
`definition.ts`. Most of those are honest consequences of the engine (`caps.definition` is false for
Redis and S3), but the error-mapper placement is not — it is the only one that puts the *same*
concern in two different files. One import path is also out of step:
`postgres/catalog.ts:10` imports `'../../adapters/errors'` where all eight of its siblings write
`'../errors'`.

### D. God files

**F21 — `DataGrid.vue` is 1795 lines, 1250 of them script** (`DataGrid.vue:1-1251` script,
`:1253-1458` template, `:1460-1795` style), covering at least nine responsibilities: viewport
virtualization and scroll coalescing (`:263-390`), column widths/order/offsets (`:56-122`), sort-term
parsing and header cycling (`:405-459`), selection and anchors (`:480-737`), the inline cell editor
(`:609-662`), clipboard copy/paste (`:1016-1111`), context menus (`:944-1015`), FK navigation
(`:750-923`) and the per-row render VM (`:830-910`). Three of those are already *pure and named* —
`parseTextSortTerms` (`:412`), the copy payload builders inside `onCopy` (`:1018-1059`) and
`columnValuesFor` (`:933`) — and the folder already has the right home for the last two:
`views/grid/clipboardFormats.ts`, which holds `rowsToTsv`/`rowsToCsv`/`rowsToJson`/`rowsToInsert`
over a `RowSnapshot` (`clipboardFormats.ts:1-45`).

**F22 — the other three view components are large mostly because of §1B.** `DocumentView.vue` (1083),
`StreamView.vue` (1014) and `KeyValueView.vue` (962) have script halves of 495/439/553 lines; the
page-size table (F14), the match-highlight CSS (F15), the toolbar/pager scaffolding and the
`runCount`/`stop`/error-classifier plumbing (F12/F13) account for a large part of the excess. They do
not need splitting on their own once §1B's shared modules exist.

**F23 — `project/menus.ts` (856 lines) is one concern with one misplaced export.** It is a per-node-kind
menu-builder dispatch (`menuForRow` at `:63`, thirteen `*Menu` builders below it) — cohesive, and its
size is the size of §8.10's right-click matrix. Its one odd export is `columnsSectionMenu`
(`:789-827`), used only by `views/definition/ColumnsSection.vue:4` and built out of `openDataTab`,
`setProjection` and `setSort` — i.e. `views/grid/state.ts`'s API. It is P19 D9's relocation of the
tree's column-row affordances, and moving it into `views/definition/` would replace one
`views/ → project/` edge with a `views/definition/ → views/grid/` sideways edge, which is worse
(D23).

### E. Dead code and leftovers

**F24 — six exported functions have no caller anywhere in `src/` or `tests/`.** Verified by a
repo-wide word-boundary search per name:

| Symbol | Site | Note |
|---|---|---|
| `parseTimestampValue` | `views/celleditor/timestamp.ts:298` | Under a header that says it outright: *"kept for the transitional native `<input type="datetime-local">` path (**deleted in P24 step 6**, when TimestampPane/DateTimePicker replace it)"* (`timestamp.ts:295-296`). The path was deleted; these were not. |
| `toDatetimeLocalValue` | `views/celleditor/timestamp.ts:303` | same block |
| `fromDatetimeLocalValue` | `views/celleditor/timestamp.ts:312` | same block (plus its private `DATETIME_LOCAL_RE`, `:307`) |
| `hexPreview` | `engine/adapters/sql-text.ts:83` | *"the one convention both the grid and P3 rely on"* — neither reaches for it; every adapter normalises binary in its own `read.ts` (e.g. `postgres/read.ts:51-54`). |
| `countCached` | `main/storage/repos/metadata-cache.ts:101` | no IPC handler, no caller |
| `objectIdCreatedAt` | `views/documents/ejson.ts:611` | *"for the type tooltip (F16's NoSQLBooster precedent)"* — the tooltip was not built |

**F25 — `views/celleditor/state.ts` is not a text file.** It contains three literal `NUL` bytes, at
lines 16, 22 and 22 (`file` reports `data`, not `ASCII text`), used as a separator inside a template
literal: `` `${cell.connectionId ?? ''}\0${cell.path}\0${cell.column.name}` `` (`state.ts:22`, with
the rationale at `:15-21`). The choice of separator is right; **writing it as a raw byte is not** —
`grep`/`ripgrep` classify the file as binary and skip it, so `grep -rn "from '../../" src/renderer/views`
prints `grep: src/renderer/views/celleditor/state.ts: binary file matches` **instead of that file's
imports**. Every repo-wide search in this plan had to work around it. The `\0` escape produces a
byte-identical string at runtime.

**F26 — `views/grid/page.ts`'s `dropForTab` carries generality that became unreachable in P8.** Its
comment (`page.ts:37-42`) explains the prefix scan as serving *"a console tab (P5.5) [which] has N
of the latter (one per result set, keyed by `views/console/state.ts`'s `resultPageKey`)"* — but
console result pages have lived in their own store since P8 (`console/state.ts:84` calls
`setPage(resultPageKey(...))` from `./resultPages`, and `views/console/resultPages.ts:34` has its own
`dropForTab`). The only caller of `views/grid/page.ts`'s `setPage` is `views/grid/state.ts:10`, which
passes a bare `tabId`, so no `${tabId}:` key can exist in that map and the loop at `page.ts:43-53`
can only ever match the exact key.

### F. Naming and organization

**F27 — four sibling view folders use three module-naming conventions**, and one folder uses two of
them at once:

| Concern | `grid/` | `documents/` | `keyvalue/` | `stream/` |
|---|---|---|---|---|
| page store | `page.ts` | `docPage.ts` | `kvPage.ts` | `streamPage.ts` |
| search | `search.ts` | `docSearch.ts` | `kvSearch.ts` | `streamSearch.ts` |
| context menus | `gridMenu.ts` | `documentMenu.ts` | `keyValueMenu.ts` | `streamMenu.ts` |
| pending writes | `pendingChanges.ts` | `documentMutations.ts` | `keyValueMutations.ts` | `streamMutations.ts` |
| find widget | `SearchToolbar.vue` | `DocumentSearchToolbar.vue` | `KeyValueSearchToolbar.vue` | `StreamSearchToolbar.vue` |

`grid/` alone holds both `page.ts` (unprefixed) and `gridMenu.ts` (folder-prefixed). The prefixes are
redundant with the folder name in every case, and the abbreviations (`doc`, `kv`) match neither the
folder (`documents`, `keyvalue`) nor the long forms used in the same folder (`documentMenu.ts`
beside `docPage.ts`).

**F28 — the same drift inside the search modules' exported names.** Three export `searchState` /
`clearSearchState` / `matchedRows` (`search.ts:39,41,50`, `docSearch.ts:28,30,38`,
`kvSearch.ts:33,35,43`); the fourth exports `streamSearchState` / `clearStreamSearchState` /
`matchedRows` (`streamSearch.ts:20,22,52`) — one of the three names re-prefixed, one not, in a module
that is already reached only through its own folder.

---

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/shared/pageStore.ts — NEW. F9's three identical stores, once.
// The grid's and the console's stores keep their own files (D7): both extend `Entry` with state
// this factory has no notion of (a row×col decode cache and a visible-row window; a `windowKey`).
export interface PageStore<P extends { rowCount: number; byteSize: number }> {
  readonly pageVersion: { n: number };
  setPage(tabId: string, page: P): void;
  getPage(tabId: string): P | null;
  drop(tabId: string): void;
  totalRetainedBytes(): number;
  /** Decoded-text memo for one row's field, keyed `${field}:${row}` exactly as today. */
  cached(tabId: string, key: string, decode: (decoder: TextDecoder) => string): string | null;
}

/** `onSet` runs after the page is stored and `pageVersion` is bumped — documents/ passes
 *  `resetRows` (docPage.ts:24's P27 D21 invalidation), the other two pass nothing. */
export function createPageStore<P extends { rowCount: number; byteSize: number }>(
  opts?: { onSet?(tabId: string): void },
): PageStore<P>;
```

```ts
// src/renderer/views/shared/pageScan.ts — NEW. F10's shared scanner, minus the per-row body.
export interface SearchQuery { text: string; matchCase: boolean; wholeWord: boolean; regex: boolean }
export interface SearchHandle<M> { cancel(): void; done: Promise<M[]> }

/** Throws SyntaxError synchronously for an invalid regex, before any scan starts — the contract
 *  all three toolbars already depend on (SearchToolbar.vue:76-81 and its two copies). */
export function compilePattern(q: SearchQuery): RegExp;

/** The rAF-chunked driver: 2 000 rows per frame, cancellable, `onProgress(found, scanned, total)`
 *  after each chunk, resolves with everything found. `scanRow` pushes into `out`. */
export function runChunkedScan<M>(
  totalRows: number,
  scanRow: (row: number, pattern: RegExp, out: M[]) => void,
  q: SearchQuery,
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle<M>;

/** The per-tab match record + its tab-close cleanup registration, once per view module. */
export function createSearchState<M extends { row: number }>(): {
  searchState: Record<string, { matches: M[]; index: number }>;
  clearSearchState(tabId: string): void;
  matchedRows(tabId: string): number[] | null;   // delegates to searchFilter.ts's matchedRowsOf
};
```

```ts
// src/renderer/views/shared/pageSearch.ts — NEW. What PageSearchToolbar.vue is bound to; each
// view folder exports one literal of this over its own modules.
export interface PageSearchApi<M extends { row: number }> {
  runSearch(tabId: string, q: SearchQuery, onProgress: (f: number, s: number, t: number) => void): SearchHandle<M>;
  clearSearchState(tabId: string): void;
  searchState: Record<string, { matches: M[]; index: number }>;
  matchedRows(tabId: string): number[] | null;
  pageVersion: { n: number };
  loadedRowCount(tabId: string): number;
}
```

```vue
<!-- src/renderer/views/shared/PageSearchToolbar.vue — NEW, generic over the match type the way
     workbench/VirtualList.vue is already generic over its item type. Replaces
     grid/SearchToolbar.vue, documents/DocumentSearchToolbar.vue and
     keyvalue/KeyValueSearchToolbar.vue verbatim — same markup, same classes, same testids.
     `testidPrefix` is '' for the grid, 'document-' and 'keyvalue-' for the other two, so every
     existing data-testid string is produced unchanged (D9).
     props: { tabId: string; testidPrefix: string; rowNoun: string; api: PageSearchApi<M> }
     emits: { goToMatch: [match: M]; close: [] } -->
```

```ts
// src/renderer/views/shared/viewOp.ts — NEW. F12/F13's copied plumbing.
export interface LoadFailure { kind: 'cancelled' | 'disconnected' | 'error'; code: string; message: string }

/** The five-way classification every view's load() catch does today, as a value the caller acts
 *  on — deliberately NOT a handler: console/state.ts:52-58's extra `status = 'idle'` before
 *  unmarkHydrated is a real difference this must preserve, not absorb (D11). */
export function classifyLoadError(err: unknown): LoadFailure;

/** `control.opsCancel(rt.opId)` when there is one — the body all five `stop()` functions share. */
export function stopOp(rt: { opId: string | null } | undefined): void;
```

```ts
// src/renderer/views/shared/pageSizes.ts — NEW. F14's one table, four testid prefixes.
export function pageSizeOptions(
  testidPrefix: '' | 'document-' | 'keyvalue-' | 'stream-',
): { value: PageSize; label: string; testid: string }[];
```

```ts
// src/engine/adapters/errors.ts — additions only.
/** The E_UNSUPPORTED stub F18 found ten times, once. `unsupported('kafka', 'file transfer')`
 *  reproduces today's message byte for byte, including each adapter's own wording. */
export function unsupported(kind: ConnectionKind, what: string): never;
```

```ts
// src/engine/adapters/sql-text.ts — additions only (F19).
/** Ordinal-ordered, de-duplicated projection resolution; E_NOT_FOUND for a column the catalog
 *  result doesn't hold (Adapter rule 7). Takes the column list, not a per-adapter ReadTarget —
 *  the four copies read nothing else off it. */
export function resolveProjection(columns: ColumnMeta[], requested: string[] | null): ColumnMeta[];

/** App-generated integers only (pageSize+1, a port-validated offset) — inlined into SQL rather
 *  than bound, per each adapter's own note. */
export function safeInt(value: number, label: string): number;
```

```css
/* theme/tokens.css — two tokens, replacing four copies of the same two declarations (F15).
   Values are the exact expressions in use today, so every computed colour is unchanged. */
--kira-search-match: color-mix(in srgb, var(--kira-warn) 25%, transparent);
--kira-search-match-current: var(--kira-warn);
```

---

## 3. Decisions

### Layering — make §11's sentence true

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`workbench/state/contextMenu.ts` → `renderer/state/contextMenu.ts`** and **`workbench/state/layout.ts` → `renderer/state/layout.ts`**, with all fourteen and six importers updated. `workbench/state/tooltip.ts` and `workbench/state/engine.ts` **stay** where they are. | F2: eleven of contextMenu's fourteen importers are outside `workbench/`, and §11 already says why that is wrong and where it belongs. The two that stay have three importers each, all of them `workbench/`, `App.vue` or `main.ts` (`AppTooltip.vue`, `StatusBar.vue`) — moving them would be motion without a reason, and this phase moves things because of who imports them, not for symmetry. |
| D2 | **`workbench/panels/ViewChrome.vue`, `workbench/VirtualList.vue` and `workbench/PanelSplitter.vue` → `theme/primitives/`.** | F3/F4. ViewChrome has *no* workbench importer and imports nothing from workbench; `theme/primitives/` already holds `ViewHeader.vue` (ViewChrome's own dependency), `ReconnectGate.vue` and `EmptyState.vue`, which are the same class of view-agnostic chrome. VirtualList and PanelSplitter are prop-in/event-out primitives with callers in three folders. After D1+D2 the `views/* → workbench/*` edge count is **zero**. |
| D3 | **`views/celleditor/` → `views/shared/celleditor/`** (all eight files, unchanged), and **`views/grid/columns.ts` → `views/shared/columns.ts`**. | F5/F6: these are the only two sideways targets, and P31 D12 set the precedent for exactly this move for exactly this reason. The cell editor is not a tab kind (F6) and imports no view, so `views/shared/` is where it already belonged; `columns.ts` is `TabularPage`-shaped, not grid-shaped, and its second consumer is a console component. After D3 the `views/* → views/*` edge count is **zero**, and §11's "the dependency graph stays a tree" is a fact rather than an intention. |
| D4 | **`project/typeGlossary.ts` → `views/shared/typeGlossary.ts`; `project/icons.ts` → `theme/icons.ts`.** | F7: the glossary has no `project/` consumer at all and two view consumers — the definition of a `views/shared/` module (§11: *"cross-view Vue helpers with a second consumer"*). The icon vocabulary keeps consumers in both `project/` and `views/`, so neither folder can own it; `theme/` already owns the two other "value → visual" maps (`cellClass.ts`, `connColor.ts`) and is below both. |
| D5 | **`shared/port.ts` → `shared/protocol/port.ts`; `shared/layout.ts`, `shared/settings.ts`, `shared/shortcuts.ts` → `shared/domain/`.** `shared/caps.ts` stays at the root. | F8: §11 already lists `protocol/port.ts` — this makes the tree match the document rather than the document match a drift. The other three are Zod-schema domain vocabularies sitting beside the folder described as holding exactly that, and their transports differ (settings and layout ride IPC; shortcuts rides nothing) which is the very reason §11 separates "what the concepts mean" from "bytes on the wire". `caps.ts` is a documented root member (`SPEC.md:1013`) and the adapter contract's own anchor. |
| D6 | **No lint rule, no import-boundary checker, no new script is added to enforce any of this.** | Inventing a mechanism is out of scope for a phase whose whole promise is "no behavior change, no new machinery", and it could not be verified here (no `node_modules` in this box; the exact capability of Biome 2.5.9's `noRestrictedImports` for relative-path globs is unconfirmed). §9 asks the user whether they want it as its own small follow-up. |

### The four data views

| # | Decision | Rationale |
|---|----------|-----------|
| D7 | **One `createPageStore()` factory (`views/shared/pageStore.ts`) backs `documents/`, `keyvalue/` and `stream/`.** `views/grid/page.ts` and `views/console/resultPages.ts` keep their own files and are **not** forced onto it. | F9: the three are the same file by their own admission, and the row accessors that differ sit on top of the store rather than inside it. The grid's store owns a two-level decode cache and P29 D7's visible-window pruning (`page.ts:61-101`); the console's holds a `Page` union and a `windowKey`. Bending the factory to cover them would make it the union of five stores instead of the intersection of three — and `budgets.spec.ts`'s scroll budget lives on the grid's path. |
| D8 | **One `runChunkedScan`/`compilePattern`/`createSearchState` (`views/shared/pageScan.ts`) backs `grid/search.ts`, `documents/docSearch.ts` and `keyvalue/kvSearch.ts`.** Each keeps its own `Match` type and its own per-row body. **`stream/streamSearch.ts` is not touched.** | F10, and the stream module's own header explains why it is excluded: it is *"deliberately simpler … one case-insensitive substring match across all five columns (no whole-word/regex toggles, no requestAnimationFrame chunking)"* (`streamSearch.ts:8-13`). Folding it in would either give Kafka/SQS search new matching behaviour (a feature, and P24 §6/P31 §6 both refused it) or force the shared helper to carry a second mode. Three real copies collapse; the fourth stays a different thing. |
| D9 | **One `views/shared/PageSearchToolbar.vue` replaces `grid/SearchToolbar.vue`, `documents/DocumentSearchToolbar.vue` and `keyvalue/KeyValueSearchToolbar.vue`,** parameterized by `testidPrefix`, `rowNoun` and a `PageSearchApi`. Every `data-testid` it renders is byte-identical to today's. **`stream/StreamSearchToolbar.vue` stays as it is.** | F11. P24 §6's reasons for keeping them apart were "three different match shapes, four different page stores"; P31 D16/D22 removed both, and what remains is one optional `col` on the match (handled by making the component generic, exactly as `VirtualList.vue` is already generic over `T`) and one noun. Keeping the testids identical is what makes this reviewable: `data-view.spec.ts` and `mongo.spec.ts` are the regression guard and neither line changes. The stream toolbar is a different widget (no matcher toggles) and is out of scope by D8's same logic. |
| D10 | **`views/shared/pageSizes.ts` exports one `pageSizeOptions(prefix)`;** the four views call it. | F14. The list is a product decision (§8.5's page sizes), not a per-view one; four copies mean a fifth size is a four-file change with three chances to typo a testid. |
| D11 | **`views/shared/viewOp.ts` exports `classifyLoadError()` (returning a `LoadFailure`) and `stopOp()`; the five view state modules call them.** `classifyLoadError` **returns** a classification — it does not perform the reaction. | F12/F13. The reaction genuinely differs: the console additionally sets `status = 'idle'` before `unmarkHydrated` for a documented reason (`console/state.ts:52-58`), and the grid's cancelled branch carries its own comment about not blanking the page. A "handle it for me" helper would have to grow flags for those; a classifier lets each caller keep its exact two or three lines while the `DISCONNECTED_CODES` set and the `code ?? 'E_QUERY'` extraction exist once. `runCount` is deliberately **not** merged (D25). |
| D12 | **`state/tabs.ts`'s six openers collapse onto one internal `openTab(kind, connectionId, path, makeState, opts)`, and its six patchers onto one internal `patchTabState(id, kind, patch, opts)` — with `{ skipUnchanged: true }` passed by exactly the three call sites that check `patchChanged` today and omitted by the other three.** The six exported functions and their signatures stay. | F16. This is the one finding where merging naively would change behavior (three tab kinds would stop scheduling a debounced save for a no-op patch). Encoding the divergence as an explicit flag makes it visible at every call site instead of implicit in six copied bodies — and turns "is this drift or a decision?" into a one-line question for **P40**, which §9 asks. The exported API is untouched, so no caller and no test moves. |
| D13 | **`DataGrid.vue` gives up three pure pieces and nothing else:** `parseTextSortTerms` → `views/grid/sortTerms.ts`, and the range/column TSV builders inside `onCopy` → `views/grid/clipboardFormats.ts` beside `rowsToTsv`. Virtualization, selection, the inline editor, menus and the render VM **stay in the component**. | F21. The three extracted pieces are functions of their arguments with no reactive or DOM dependency, and `clipboardFormats.ts` is already their stated home. The rest is not: P29 tuned the scroll/render path against `budgets.spec.ts` and `perf.spec.ts` with primitive-computed dependencies chosen deliberately (`DataGrid.vue:344-351`), and pulling that into a composable would be a rewrite of the most performance-sensitive file in the app for no structural gain this phase can name. Splitting a 1795-line file for the sake of the number is not a decision this plan makes (§6). |

### The adapters

| # | Decision | Rationale |
|---|----------|-----------|
| D14 | **Every adapter maps driver errors from its own `errors.ts`, under one exported name: `mapError`.** `postgres/query.ts:24`'s `mapPgError` moves to a new `postgres/errors.ts`; `mysql-family/query.ts:35`'s `mapError` moves to a new `mysql-family/errors.ts`; `mongo`/`redis`/`s3`/`sqs`/`kafka` rename their exports to `mapError`. `rabbitmq/errors.ts` keeps **both** `mapHttpError` and `mapNetworkError`. | F17/F20: the same concern in two files under five names, in a codebase whose §11 sells "one fixed internal shape" as the reason a reviewer knows where to look. The name is unqualified because the folder already qualifies it (`redis/errors.ts`'s `mapError` cannot be confused with `mongo/errors.ts`'s), and it is the majority spelling already (clickhouse, sqlite, mysql-family). RabbitMQ keeps two because it maps two genuinely different inputs — an HTTP status plus a management-API body, and a `fetch` rejection (`rabbitmq/errors.ts:10-15,30-33`) — and collapsing them would lose the `notFoundHint` distinction P37 D5 built. |
| D15 | **The bodies of those mappers are not touched, and no shared classification helper is introduced.** | Every one of them is a fact about its driver: librdkafka's numeric codes (`kafka/errors.ts:11-40`), ClickHouse's `ErrorCodes.cpp` numbers (`clickhouse/errors.ts:12-26`), ioredis's `ReplyError` prefixes (`redis/errors.ts:18-21`), the AWS SDK's `name` strings (`s3/errors.ts:11-21`). ARCHITECTURE.md's per-engine section exists because these differ; a common helper would have exactly one line in it (`err instanceof AdapterError → return err`) and would invite the next adapter to classify by message text, which every one of these files explicitly refuses to do. The same reasoning applies to `typeClassFor`, which is four dialect type systems (`postgres/read.ts:31`, `mysql-family/read.ts:31`, `clickhouse/read.ts:75`, plus sqlite's) and stays four functions. |
| D16 | **`unsupported(kind, what)` in `adapters/errors.ts`; the twenty `E_UNSUPPORTED` capability stubs call it.** Each keeps its exact message text. | F18. Twenty throws of a two-part sentence, one of which (`sqlite/index.ts:257`) already templated the kind. The helper is `never`-returning so the call sites stay one line and TypeScript still narrows after them. Message text is preserved verbatim because it reaches the user through the op log (`main/oplog.ts`) — this is a refactor, not a copy edit. |
| D17 | **`resolveProjection` and `safeInt` move into `engine/adapters/sql-text.ts`;** the four (respectively four) copies are deleted. `resolveProjection` takes `ColumnMeta[]` rather than each adapter's own `ReadTarget`. | F19, and `sql-text.ts:5-7` already commissions exactly this: *"The genuinely shared, driver-agnostic glue both SQL adapters' `read.ts` call — kept out of the adapter folders because duplicating it would guarantee they drift."* They drifted anyway, in the harmless direction (Postgres's copy grew two comment lines the others lack). Taking the column list instead of `ReadTarget` is required — the four `ReadTarget`s genuinely differ (`postgres/catalog.ts:261`, `mysql-family/catalog.ts:307`, `sqlite/catalog.ts:291`, `clickhouse/catalog.ts:260`) — and costs one argument at four call sites. |
| D18 | **`postgres/catalog.ts:10`'s `'../../adapters/errors'` becomes `'../errors'`.** | F20's last line: it resolves to the same module and differs from all eight siblings for no reason. |
| D19 | **No adapter folder gains or loses a file to satisfy the "fixed shape"** beyond D14's two new `errors.ts`. `kafka/produce.ts` keeps its name; `redis/`/`s3/` still have no `definition.ts`; `mongo`/`redis`/`s3`/`sqs` still have no `query.ts`. | F20. The remaining shape differences are facts about the engines — `caps.definition` is permanently false for Redis and S3 (ARCHITECTURE.md), a Kafka write *is* a produce and naming it `mutate.ts` would make the file lie about what it does, and an adapter with no SQL has no `query.ts` to write. §11's sentence describes the shape where the shape applies; inventing empty files to satisfy a table is the kind of shortcut AGENTS.md rules out. |

### Cleanup and naming

| # | Decision | Rationale |
|---|----------|-----------|
| D20 | **Delete the six dead exports of F24** (and `timestamp.ts:295-296`'s now-empty section header and `DATETIME_LOCAL_RE`). | Nothing imports them; three of them are explicitly labelled as scaffolding for a path P24 deleted, which is precisely "leftover scaffolding a later phase superseded". Deleting an unreachable function cannot change behavior, and P31 §5's own acceptance line — *"No `<input type="datetime-local">` exists anywhere in `src/renderer`"* — is what these three were built for. |
| D21 | **`views/celleditor/state.ts`'s three raw `NUL` bytes become `\0` escapes.** | F25. Identical string at runtime, and the file stops being invisible to every `grep`/`rg` invocation in the repo — including the ones a future session will run to find its callers. This is the smallest change in the phase and the one with the largest effect on how findable the code is. |
| D22 | **`views/grid/page.ts`'s `dropForTab` becomes the same body as its siblings** (delete the key, bump the version), and its stale console comment goes with it. | F26: the prefix scan cannot match anything — the store's only writer passes a bare `tabId` — and the comment describes an arrangement P8 replaced. Keeping unreachable generality "just in case" is how the comment came to describe the wrong module in the first place. |
| D23 | **`project/menus.ts`'s `columnsSectionMenu` stays exactly where it is.** | F23. Its three actions are `views/grid/state.ts`'s API, so moving it into `views/definition/` would trade a `views → project` edge (which §11 does not forbid) for a `views/definition → views/grid` edge (which §11 does forbid). P19 D9 put it here on purpose. A finding whose only available fix is worse than the finding is recorded and left alone. |
| D24 | **One module-naming scheme across the view folders**, applied as the last code step: `docPage.ts`/`kvPage.ts`/`streamPage.ts` → `page.ts`; `docSearch.ts`/`kvSearch.ts`/`streamSearch.ts` → `search.ts`; `gridMenu.ts`/`documentMenu.ts`/`keyValueMenu.ts`/`streamMenu.ts` → `menu.ts`; `documentMutations.ts`/`keyValueMutations.ts`/`streamMutations.ts` → `mutations.ts`. `grid/pendingChanges.ts` keeps its name. `streamSearch.ts`'s `streamSearchState`/`clearStreamSearchState` become `searchState`/`clearSearchState`. | F27/F28: the folder already says `documents`, so `documents/docPage.ts` says it twice, in an abbreviation the folder does not use. Three conventions across four siblings is exactly the "a reviewer already knows where X will be" property §11 claims and this does not have. `pendingChanges.ts` is the one exception because it is not the grid's mutation *executor* — it is the staged-change model (`pendingChanges.ts:11-27`), a genuinely different noun from the other three files, and P5's vocabulary throughout §8.14. |
| D25 | **`runCount` stays four separate functions.** | F13. The bodies differ in the tab finder *and* the filter argument, and the useful part (the try/catch that keeps a stale count rather than blanking it) is three lines. A shared helper would take a finder, a filter extractor and a runtime — more parameters than the code it replaces. §6 lists it as consciously left. |
| D26 | **`views/shared/` stays flat** — the six new modules are prefix-grouped (`pageStore.ts`, `pageScan.ts`, `pageSearch.ts`, `pageSizes.ts`, `PageSearchToolbar.vue`, `viewOp.ts`) rather than filed under a `views/shared/page/` subfolder. | A subfolder would also want `searchFilter.ts` and `columns.ts` moved into it, which means churning files P31 just touched to gain one directory level in a folder of fourteen. The prefix already groups them in every listing and every editor's quick-open. |
| D27 | **SPEC.md and ARCHITECTURE.md are edited by the implementing session, not by this plan** (standing practice, P19/P21/P24/P31 D41): §10 gains a P39 row; §11's tree is rewritten to match the result (the `state/`, `theme/primitives/`, `views/shared/` and `shared/protocol|domain/` moves, and the new shared modules); §11's "fixed internal shape" bullet gains `errors.ts`; ARCHITECTURE.md's "Adapter contract" section notes that every adapter maps driver errors from `errors.ts` under one name. | The phasing table is a record of what shipped, and §11 is explicitly *"the tree as built"* — a phase that changes the tree and not that sentence leaves the same drift F8 and F20 are findings about. |

---

## 4. Implementation order

Eighteen commits. Each is one focused sitting, independently reviewable, leaves `lint`/`typecheck`/
`build` green, and is behavior-identical on its own. The moves (1–5) come first because the merges
(6–11) are easier to read against a tree whose folders are already right; the rename (16) comes last
among the code steps so every earlier diff reads against today's file names.

1. **`chore: delete dead exports and de-binary the cell editor's state module`** — D20/D21/D22.
   `timestamp.ts` (three functions + section header + `DATETIME_LOCAL_RE`), `sql-text.ts`
   (`hexPreview`), `metadata-cache.ts` (`countCached`), `ejson.ts` (`objectIdCreatedAt`),
   `celleditor/state.ts` (`\0` escapes), `grid/page.ts` (`dropForTab` + comment). Six files, all
   deletions or one-character escapes.
2. **`refactor(state): promote the context menu and layout state out of workbench/`** — D1. Two
   `git mv`s into `renderer/state/`, twenty import lines.
3. **`refactor(theme): ViewChrome, VirtualList and PanelSplitter become primitives`** — D2. Three
   `git mv`s into `theme/primitives/`, eleven import lines. After this commit no file under
   `src/renderer/views/` imports from `src/renderer/workbench/` — assert it in the commit message
   with the grep.
4. **`refactor(views): the cell-editor panel and the column metrics move to views/shared`** — D3.
   `views/celleditor/` → `views/shared/celleditor/` (eight files), `views/grid/columns.ts` →
   `views/shared/columns.ts`. After this commit no file under `src/renderer/views/<kind>/` imports
   from another `views/<kind>/`.
5. **`refactor(renderer): typeGlossary and the icon vocabulary move to their shared homes`** — D4.
   `views/shared/typeGlossary.ts`, `theme/icons.ts`, five import lines.
6. **`refactor(views): one page store behind the document, key/value and stream page modules`** —
   D7. `views/shared/pageStore.ts` (new); the three modules shrink to their row accessor plus one
   `createPageStore` call. `main.ts:48-53`'s five-way retained-bytes sum and `state/tabs.ts:28-45`'s
   five `dropForTab` calls stay exactly as they are (no registry — see D7's note).
7. **`refactor(views): one chunked page scanner behind the three search modules`** — D8.
   `views/shared/pageScan.ts` (new); `search.ts`/`docSearch.ts`/`kvSearch.ts` keep their `Match`
   types, their `runSearch` signatures and their per-row bodies and lose everything else.
8. **`refactor(views): one find widget for the grid, document and key/value views`** — D9.
   `views/shared/PageSearchToolbar.vue` + `views/shared/pageSearch.ts` (new); three components
   deleted; three view components bind the shared one with their own prefix/noun/api. No testid
   changes — that is the reviewable claim.
9. **`refactor(views): share the page-size table`** — D10. `views/shared/pageSizes.ts`, four call
   sites.
10. **`refactor(views): one load-error classifier and stop helper for the view state modules`** —
    D11. `views/shared/viewOp.ts`, five state modules; each keeps its own reaction lines verbatim.
11. **`refactor(state): one opener and one patcher inside state/tabs.ts`** — D12. Internal only; the
    twelve exported functions keep their names, signatures and — via `skipUnchanged` — their exact
    current behavior.
12. **`refactor(grid): move the sort-term parser and copy formatters out of DataGrid.vue`** — D13.
    `views/grid/sortTerms.ts` (new), two builders into `clipboardFormats.ts`.
13. **`refactor(engine): every adapter maps its driver errors from errors.ts, under one name`** —
    D14/D18. Two new `errors.ts` (postgres, mysql-family), six renamed exports, one corrected import
    path. Bodies untouched — the diff is moves and names only.
14. **`refactor(engine): one unsupported() helper for capability stubs`** — D16. `adapters/errors.ts`
    plus twenty call sites across nine `index.ts` files; every message string preserved.
15. **`refactor(engine): hoist resolveProjection and safeInt into sql-text.ts`** — D17. Four (and
    four) copies deleted, four call sites gain one argument.
16. **`refactor(shared): port.ts joins protocol/, layout/settings/shortcuts join domain/`** — D5.
    Four `git mv`s; import churn across `engine/`, `main/`, `preload/`, `renderer/` and `tests/`.
    Mechanical, and the widest-reaching commit in the phase — kept alone for that reason.
17. **`refactor(views): one module-naming scheme across the view folders`** — D24. Thirteen `git mv`s
    plus the two `streamSearch` export renames. Pure renames, no content change.
18. **`refactor(theme): the search-match colours become tokens`** *and* **`docs: SPEC §10/§11 and
    ARCHITECTURE for P39`** — D15's CSS tokens (four scoped blocks reference
    `--kira-search-match`/`--kira-search-match-current`) and D27's documentation edits, including
    this plan if it is not already committed.

---

## 5. Verification

**Nothing in this phase is verified by a new test.** Adding tests to prove a refactor is the wrong
instrument here: the existing suites already assert the behavior these steps must not change, and a
new assertion written alongside a refactor proves only that the new code does what the new code
does. What each step owes is *which existing suite re-confirms its area, run green*. (Sparse unit
tests are their own queued phase.)

Per AGENTS.md, only `smoke`, `startup`, `workbench`, `connections`, `secrets` and `sqlite` run
without Docker; everything else needs the macOS/Colima box or CI, and this authoring box has no
`node_modules` at all. **The phase is not done until the full `test:ui` and `test:db` suites have
been run green in an environment that can run them** — not step by step, but before the phase is
called finished.

| Step | Suites that must be re-run green | What they pin |
|---|---|---|
| 1 | `cell-editor.spec.ts`, `mongo.spec.ts`, `console.spec.ts` | The format-override key (D21) still identifies a cell; nothing referenced the deleted exports. `bun run typecheck` is the real proof for the deletions. |
| 2 | `interaction.spec.ts`, `tree.spec.ts`, `tabs.spec.ts`, `data-view.spec.ts`, `mutations.spec.ts` | Every right-click surface still opens the same menu with the same items and shortcut labels; panel toggles still work. |
| 3 | `definition.spec.ts`, `console.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts`, `tree.spec.ts`, `budgets.spec.ts` | ViewChrome's refresh/stop testids unchanged in five views; VirtualList's callers still virtualize (the tree and console budgets are the sharp end). |
| 4 | `cell-editor.spec.ts` (934 lines — the largest single guard in the suite), `data-view.spec.ts`, `console.spec.ts` | The dock mounts, resizes and persists its height from its new path; the console grid's column widths/alignment are unchanged. |
| 5 | `definition.spec.ts`, `data-view.spec.ts`, `tree.spec.ts` | Type descriptions in the Columns section and the grid header tooltip (P31 D28/D29), and the tree's own icons. |
| 6 | `leaks.spec.ts` (`:103`/`:146` read `window.__kiraRetainedBytes`), `perf.spec.ts:55` (`__kiraGridRetainedBytes`), `memory.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts` | The retained-bytes sum still totals the same five stores, and closing a tab still frees every page. |
| 7 | `data-view.spec.ts` (search block), `mongo.spec.ts`, `redis.spec.ts` | Match counts, prev/next cycling, invalid-regex inline error, the page-replaced re-scan (P31 D22). |
| 8 | `data-view.spec.ts`, `mongo.spec.ts` | Every `search-*`, `document-search-*`, `keyvalue-search-*` testid resolves and behaves as before. **Note:** the Redis/Kafka/SQS specs do not assert the P31 D17 toggle at all (`grep -rl "search-filter-rows" tests/ui` → `data-view.spec.ts`, `mongo.spec.ts` only), so the key/value toolbar's coverage is thinner than the grid's — recorded in §9 for the tests phase, not patched here. |
| 9 | `data-view.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts` | All four `page-size-*` testids and the page-size change behavior. |
| 10 | `data-view.spec.ts`, `console.spec.ts`, `mutations.spec.ts`, plus the reconnect scenarios in `redis.spec.ts`/`kafka.spec.ts`/`mariadb.spec.ts` | Cancel leaves the page up; a disconnect swaps in the Reconnect gate; the console's Stop button still leaves `status` idle after a disconnect (`console/state.ts:52-58`'s documented case). |
| 11 | `tabs.spec.ts`, `data-view.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts`, `console.spec.ts` | Open/reuse/duplicate/close semantics per kind, and session restore after a relaunch (the persisted `state_json` must be identical). |
| 12 | `data-view.spec.ts`, `interaction.spec.ts`, `budgets.spec.ts` | Header sort indicators from a typed `ORDER BY`; copy of a cell/range/row/column; no regression in the scroll budget. |
| 13–15 | `bun run test:db` in full (`postgres`, `mariadb`, `mysql`, `sqlite`, `clickhouse`, `mongo`, `redis`, `s3`, `sqs`, `rabbitmq`) plus `bun run test:db:kafka` | Error codes still classify identically (the specs assert `E_AUTH`/`E_NOT_FOUND`/`E_CANCELLED` codes directly), unsupported operations still throw `E_UNSUPPORTED` with the same message, projections still resolve and refuse unknown columns. `tests/db/postgres.spec.ts:10` imports from `postgres/query` — step 13 must keep that import compiling or update it in the same commit. |
| 16 | `bun run typecheck` (all four projects) + full `test:ui` + `test:db` | `tests/ui/*` and `tests/db/*` both import `@shared/...`; the moved modules must resolve from every tsconfig (`tsconfig.node.json`, `tsconfig.web.json`, `tests/db/tsconfig.json`, `tests/electron-db/tsconfig.json`). |
| 17 | Full `test:ui` | Renames only — any spec that imports a renderer module by path is the guard. |
| 18 | `data-view.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts` | The match tint and current-match colours resolve to the same computed values. |

---

## 6. Explicitly out of scope

- **Anything about themes** — `theme/tokens.css`'s palette, a theme picker, Catppuccin. P38 is
  skipped by user direction; step 18 adds two tokens whose values are the expressions already in use
  and changes no colour.
- **Splitting `DataGrid.vue`'s virtualization, selection, inline editor, menus or render VM** (D13).
  The file stays large. P29 tuned this path against `budgets.spec.ts`/`perf.spec.ts` with
  deliberately primitive-valued computeds (`DataGrid.vue:344-351`); restructuring it is a
  performance change wearing a refactor's clothes.
- **Merging `stream/streamSearch.ts` into the shared scanner, or `StreamSearchToolbar.vue` into the
  shared toolbar** (D8/D9), and **giving Kafka/SQS search case/word/regex parity** — P24 §6 and
  P31 §6 both refused it as a feature, and it would change what a Kafka search finds.
- **Merging the five `runCount` functions** (D25) or the four `load()` bodies. `load()` differs in
  cursor construction, page-kind assertion, per-view runtime fields and (grid only) `clearPending` —
  a shared `load` would be a switch statement over four views.
- **Any change to `engine/` outside `adapters/`.** `control.ts` (170), `data.ts` (186),
  `scheduler/ops.ts` (106), `rpc.ts` (87) and `cache/*` (≤115 each) are already split along the lines
  §11 describes and have no findings against them.
- **Any change to `main/`'s file layout.** `main/ipc/` is one file per domain with a registry,
  `main/storage/` is `schema/` + `repos/` + `migrations/` as specified, and `main/window.ts`'s
  single-file shape is a documented §11 exception. The only `main/` change in this phase is deleting
  one dead export (step 1).
- **Adapter internals**: error-classification logic, `typeClassFor`, catalog SQL, pagination
  strategy, `caps` literals, or any adapter's folder contents beyond D14/D16/D17/D18 (D15/D19).
- **Migrating `engine/`/`main/` to the `@shared/*` alias.** The renderer uses it 133 times and
  `engine/` uses relative paths 197 times, but `electron.vite.config.ts:37-41` declares the alias for
  the **renderer build only** — `main`/`preload` have no `resolve.alias` — while `tsconfig.node.json`
  declares the path mapping for typecheck. Writing `@shared/...` in engine code would typecheck and
  then have to resolve through Rollup and through Bun's own tsconfig-path resolution for
  `tests/db/` (which imports engine files directly, `tests/db/postgres.spec.ts:7-12`). That is a
  build-configuration change with a real chance of breaking `test:db`, and it is not what "modularity"
  was asked for. §9 raises it.
- **Any lint rule or CI check to enforce §11's layering** (D6) — §9 asks whether it is wanted.
- **`RENDERABLE_TAB_KINDS`** (`shared/domain/tabs.ts:19-26`), which now lists all six members of
  `tabKindSchema` and so can no longer reject anything. It is a deliberate second gate for a future
  seventh kind; leaving it is cheaper than re-deriving it later.
- **New tests** (§5), **new dependencies**, **any migration**, **any change to a persisted tab's
  `state_json` shape or the wire protocol**, and **`docs/design/kira-design-system/`**.

---

## 7. Target tree at the end of P39

```
src/
  shared/
    port.ts            MOVED -> protocol/port.ts                    (D5)
    layout.ts settings.ts shortcuts.ts   MOVED -> domain/           (D5)
    caps.ts            --  UNCHANGED, stays at the root             (D5)
  engine/adapters/
    errors.ts                        MOD  + unsupported()           (D16)
    sql-text.ts                      MOD  + resolveProjection, safeInt; − hexPreview (D17/D20)
    postgres/errors.ts               NEW  mapError, moved out of query.ts (D14)
    mysql-family/errors.ts           NEW  mapError, moved out of query.ts (D14)
    mongo|redis|s3|sqs|kafka/errors.ts   MOD  export renamed to mapError (D14)
    clickhouse|sqlite/errors.ts      --  UNCHANGED (already mapError)
    rabbitmq/errors.ts               --  UNCHANGED (two mappers, D14)
    */index.ts                       MOD  capability stubs call unsupported() (D16)
    postgres|mysql-family|sqlite|clickhouse/read.ts  MOD  − local copies (D17)
    postgres/catalog.ts              MOD  import path corrected      (D18)
  main/storage/repos/metadata-cache.ts   MOD  − countCached          (D20)
  renderer/
    state/
      contextMenu.ts                 MOVED from workbench/state/     (D1)
      layout.ts                      MOVED from workbench/state/     (D1)
      tabs.ts                        MOD  one opener, one patcher    (D12)
    theme/
      icons.ts                       MOVED from project/             (D4)
      tokens.css                     MOD  two search-match tokens    (D15)
      primitives/
        ViewChrome.vue               MOVED from workbench/panels/    (D2)
        VirtualList.vue              MOVED from workbench/           (D2)
        PanelSplitter.vue            MOVED from workbench/           (D2)
    workbench/
      state/tooltip.ts state/engine.ts   --  UNCHANGED               (D1)
    views/
      shared/
        celleditor/                  MOVED from views/celleditor/ (8 files, unchanged) (D3)
        columns.ts                   MOVED from views/grid/          (D3)
        typeGlossary.ts              MOVED from project/             (D4)
        pageStore.ts                 NEW  the three identical stores (D7)
        pageScan.ts                  NEW  the shared chunked scanner (D8)
        pageSearch.ts                NEW  PageSearchApi              (D9)
        PageSearchToolbar.vue        NEW  replaces three toolbars    (D9)
        pageSizes.ts                 NEW  one page-size table        (D10)
        viewOp.ts                    NEW  classifyLoadError, stopOp  (D11)
        searchFilter.ts DateTimePicker.vue …   --  UNCHANGED         (D26)
      grid/
        page.ts search.ts state.ts   MOD  factories; dropForTab simplified (D7/D8/D11/D22)
        SearchToolbar.vue            DELETED -> views/shared/        (D9)
        sortTerms.ts                 NEW  parseTextSortTerms         (D13)
        clipboardFormats.ts          MOD  + range/column TSV builders (D13)
        DataGrid.vue                 MOD  − three pure helpers; search-match tokens (D13/D15)
        DataToolbar.vue              MOD  pageSizeOptions()          (D10)
        gridMenu.ts                  RENAMED -> menu.ts              (D24)
        pendingChanges.ts            --  UNCHANGED name              (D24)
      documents/
        docPage.ts docSearch.ts      RENAMED -> page.ts search.ts, on the factories (D7/D8/D24)
        DocumentSearchToolbar.vue    DELETED -> views/shared/        (D9)
        documentMenu.ts documentMutations.ts   RENAMED -> menu.ts mutations.ts (D24)
        DocumentView.vue state.ts    MOD  shared toolbar/pageSizes/viewOp/tokens
        ejson.ts                     MOD  − objectIdCreatedAt        (D20)
      keyvalue/  stream/             same renames and factories      (D7/D8/D10/D11/D24)
        KeyValueSearchToolbar.vue    DELETED -> views/shared/        (D9)
        StreamSearchToolbar.vue      --  UNCHANGED                   (D9)
        streamSearch.ts              RENAMED -> search.ts; two exports un-prefixed (D24)
      console/
        state.ts resultPages.ts      MOD  viewOp; store kept separate (D7/D11)
        ConsoleResultGrid.vue        MOD  imports views/shared/columns (D3)
      definition/                    MOD  import paths only          (D1/D2/D4)
    project/
      icons.ts typeGlossary.ts       MOVED out                       (D4)
      menus.ts                       MOD  import path only; columnsSectionMenu stays (D23)
docs/
  v1/SPEC.md                         MOD  §10 row, §11 tree, §11 shape bullet (D27)
  v1/ARCHITECTURE.md                 MOD  adapter error-mapper sentence (D27)
  v1/plans/P39-modularity-and-cleanliness.md   NEW  this document
```

---

## 8. Acceptance checklist

- [ ] `grep -rn "from '\.\./\.\./workbench/" src/renderer/views` returns **nothing**.
- [ ] `grep -rn "from '\.\./\(grid\|documents\|keyvalue\|stream\|definition\|celleditor\|console\)/" src/renderer/views`
      returns **nothing**.
- [ ] `file src/renderer/views/shared/celleditor/state.ts` reports text, and no file under `src/`
      is reported as binary by `grep -r`.
- [ ] Every `data-testid` in the app is unchanged: `test:ui` passes with **zero** selector edits in
      `tests/ui/`, and the diff of `tests/` for this phase is empty except for import paths.
- [ ] One page-store implementation backs documents/key/value/stream; `window.__kiraRetainedBytes`
      still sums five stores and `leaks.spec.ts` is green.
- [ ] One find-widget component serves the grid, document and key/value views; the stream's is
      untouched; all three prefixed testid families still resolve.
- [ ] `DISCONNECTED_CODES` appears **once** in `src/renderer`; `escapeRegExp` appears **once**;
      `PAGE_SIZE_OPTIONS`' value table appears **once**; `resolveProjection`/`safeInt` appear
      **once** in `src/engine`.
- [ ] Every adapter's driver-error mapper is exported from that adapter's `errors.ts` as `mapError`
      (RabbitMQ's two excepted), and `bun run test:db` asserts the same error codes as before.
- [ ] No `E_UNSUPPORTED` message text changed anywhere (diff the strings).
- [ ] The six dead exports of F24 are gone and nothing imports them.
- [ ] Each of the four view folders holds `page.ts`, `search.ts`, `menu.ts` and (where it has one)
      `mutations.ts`, with no folder-name prefixes.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db) and `bun run build` clean after **every**
      commit; the full `test:ui` and `test:db` suites green in an environment that can run them
      before the phase is called done.
- [ ] SPEC §10 has a P39 row, §11's tree matches the tree that exists, and ARCHITECTURE.md's adapter
      section names the `errors.ts` convention.

---

## 9. Open questions for the user

1. **Should the §11 layering rule be enforced by a check, in a follow-up?** D6 deliberately adds no
   mechanism this phase. The eighteen violations of F1 accumulated silently over ~20 phases because
   nothing but review catches them, and after this phase the count is zero — which is the cheapest
   moment to add a guard. The options are a Biome `noRestrictedImports` block (capability for
   relative-path globs unverified here) or a ten-line script wired into `lint`. Say the word and it
   becomes its own small phase.
2. **`state/tabs.ts`'s `patchChanged` divergence (F16) — drift or decision?** D12 preserves today's
   behavior exactly and marks the difference. If it is drift, the fix ("every tab kind skips a no-op
   patch") is one flag and belongs in P40, where a behavior change is allowed and testable.
3. **Do you want the `@shared/*` alias to work in `engine/` and `main/` too?** Today it is a
   renderer-only alias (§6), which is why one half of the codebase writes `@shared/domain/tree` and
   the other writes `../../../shared/domain/tree`. Making it uniform is a build-config change with a
   real `test:db` resolution risk, so this phase does not attempt it — but it is the single largest
   remaining inconsistency in how modules refer to each other.
4. **How far should the view-module rename go (D24)?** The plan renames the four repeated concerns
   and leaves component names (`DataGrid.vue`, `DocumentView.vue`, …) and `pendingChanges.ts` alone.
   The more aggressive option — every view folder exposing exactly `View.vue`/`state.ts`/`page.ts`/
   `search.ts`/`menu.ts`/`mutations.ts` — would make the folders isomorphic but would rename the six
   components five specs and `MainView.vue` refer to by name.
5. **The key/value and stream find widgets have no test coverage for P31 D17's filter toggle**
   (`grep -rl "search-filter-rows" tests/ui` → two files). That is a gap this phase must not fill
   (§5), but it is the first thing the queued tests phase should pick up, and it means step 8's
   guarantee for the key/value toolbar rests on `typecheck` plus review rather than on a spec.
