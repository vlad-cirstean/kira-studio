# P40 — Query console UX and a read-only mode for the cell editor

> **A single-pass phase.** Unlike P39 (three iterations) and P42 (three planned), this is one
> Opus plan and one Sonnet implementation pass. The branch tip when this plan was written is
> `02eea0b` on `feature/kickoff`; `git status --porcelain` over the repo is empty apart from this
> file.
>
> **Scope is the user's own list, verbatim, and nothing else** — a toolbar toggle for opening a run
> in a new result set vs. reusing the current one; the shared find toolbar over console results; a
> result-set strip whose entries close with an ×; the empty band between the last result row and
> the panel's bottom edge when the cell editor is closed; a real read-only mode for the cell editor
> (Format/Beautify, the primary-key label and "many things" hidden where nothing is editable); and
> the console's SQL result view brought in line with the main grid's, dropping the data-type badge
> from its header. Nothing is added to that list and nothing is dropped from it.
>
> **Unlike P39, this phase is allowed to change behavior — and it does.** Four of the six items are
> behavior changes by construction. The discipline that replaces "zero behavior change" here is:
> every behavior change is named in a decision, every one of them updates the Playwright spec that
> asserted the old behavior **in the same commit**, and nothing outside the six items moves. Two
> real defects found on the way (a dead cache-pruning export, F22; the four other cell-editor dock
> mounts that would want the same read-only flag, F14) are written up and **not** touched, because
> the user did not ask for them and P42 is the phase that owns them.
>
> **Two of the user's six items already exist in the code in a broken or half form**, which is why
> they read as complaints rather than feature requests: the "1 result set" bar the user describes
> is `ConsoleView.vue:255`'s existing status line (F3), and the empty band is one `height: 260px`
> declaration (F1). Neither is new work; both are corrections.

---

## 0. Ground rules for this phase

- **Every finding carries a `file:line` read at `02eea0b`.** Where a claim depends on library
  semantics rather than this repo's code, the library's own typings are quoted (F11 quotes
  `node_modules/@codemirror/state/dist/index.d.ts:1230-1240`).
- **Behavior changes are declared, not discovered.** §3 names each one; §5 names the spec that
  proves it; §7's checklist is the phase's own acceptance test.
- **A spec that asserts the old behavior is edited in the commit that changes it**, never left red
  across several commits. Two existing assertions are known to be invalidated by this phase
  (F18) and are named with their line numbers.
- **No new dependency, no new build step, no protocol change.** One new renderer module
  (`views/console/search.ts`), one new optional prop on two existing components, one new Zod field
  with a `.default()`. Nothing in `src/engine/`, `src/main/`, `src/preload/` or `src/shared/protocol/`
  is touched.
- **P39's layering rules stand** (`biome.json`'s seven `overrides`, re-read in full for this plan).
  Every import this phase adds is `views/console/* → views/shared/*`, `views/console/* → state/*`,
  `views/console/* → theme/*` or `views/shared/celleditor/* → state/*` — none is a
  `views/<kind>/* → views/<kind>/*` edge, none reaches `workbench/*`, and nothing under
  `project/**` is touched, so no override needs changing and none may be weakened.
- **`views/shared/page/` is the current home** of the seven paged-view modules (P39 iter3 D10).
  Every path in this plan is post-move: `views/shared/page/SearchToolbar.vue`,
  `views/shared/page/search.ts`, `views/shared/page/searchFilter.ts`, `views/shared/page/scan.ts`,
  `views/shared/page/columns.ts`.
- **`data-testid`s are added, never removed or renamed.** Every existing `console-*` and
  `cell-editor-*` testid still exists after this phase and still identifies the same thing; the
  new ones follow the `console-<thing>` / `<prefix>search-<thing>` conventions already in
  `views/console/` and `views/grid/` (F19).
- Comments per AGENTS.md: only where the code cannot say it for itself. Four existing comments
  become false as a result of this phase's changes and are rewritten in the same commits
  (`ConsoleView.vue:234-237`, `ConsoleResultGrid.vue:11-22` and `:107-110`, `state.ts:23-31`).
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` stay green
  after **every** commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. The results area

**F1 — the empty band between the last row and the panel's bottom edge is one CSS declaration, and
the main grid does not have it because it sizes its body with `flex: 1`.**
`ConsoleView.vue:293-299`:

```css
.result-panel {
  flex-shrink: 0;
  height: 260px;
  ...
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}
```

inside `.results-body` (`:285-291`), which is `flex: 1 1 60%; min-height: 0; overflow-y: auto`.
Every child of `.console-view` is a flex item in one column (`ViewChrome` renders a fragment —
`ViewChrome.vue:39-90` — so `.editor-body`, `.results-body`, `CellEditorDock`'s own dock and
`.status-line` are all direct children of `ConsoleView.vue:261-266`'s flex column). With one result
set and no cell editor, `.results-body` is ~60% of the view but its only child is pinned at 260px:
the remainder is empty background below a border — exactly the artefact reported. Opening the cell
editor takes that remainder away (the dock is `flex-shrink: 0` at
`layoutState.panel.cellEditor.height`, `CellEditorDock.vue:29,45-51`), which is why the band
"disappears when the cell editor is on."

The grid has no equivalent: `DataView.vue:209-213` is `.grid-area { flex: 1; min-height: 0 }` and
`DataGrid.vue:1419-1425` is `height: 100%; overflow: auto`. The fix is the grid's own shape, not a
new one.

**F2 — the console stacks every statement's result at a fixed height; the design system's own
console body shows exactly one result at a time, selected by a strip.**
`ConsoleView.vue:233-252` renders `v-for="(page, i) in rt.results"`, each with its own
`.result-head` (`Result N` + row count) and its own `ConsoleResultGrid`. The file says why:

> `ConsoleView.vue:234-237`: *"Console.html's Result/Messages/Plan segmented switcher and
> per-statement text/SELECT badge assume one active result at a time; this view stacks every
> statement's page instead."*

`docs/v1/design/kira-design-system/parts/bodies/Console.html:79-98` is the other half of that
sentence: one `.result-head` band carrying `<span class="p-seg"><span class="on">Result
1</span>…</span>` plus a row-count line, and **one** `.p-panel` grid below it at
`flex: 1; min-height: 0`. The user's "open the result in a new result table, or in the same" and
"I should be able to close a result with an x" are asking for that model plus a lifetime for each
result — not for a different one.

**F3 — the bar reading "1 result set" already exists; it is the console's bottom status line, and
it is the only thing in the view that still uses it.** `ConsoleView.vue:134-143`:

```ts
if (r.status === 'idle' && r.results.length > 0) {
  return `${r.results.length} result set${r.results.length === 1 ? '' : 's'}`;
}
```

rendered at `:255` into `.status-line` (`:321-333`), whose own comment already records that it
should not exist:

> *"D: 'there is no editor status line' law folds this into the toolbar's run-state above; kept
> here (`data-testid="console-status"`) only because it is still asserted on directly."*

Its other two states are redundant with chrome the view already has: `'Running…'` duplicates
`ViewChrome`'s `RunState` (`ViewChrome.vue:82`, driven by `useRunState`, `state/runState.ts:34-46`,
which reads the op log for this tab id), and `'Cancelled'` duplicates the operations panel's own
row status. So the user's "another bar where it's written 1 result set" is a complaint about a bar
that is 90% dead — not a request for a second one. The strip this phase adds replaces it; it is not
added on top of it.

**F4 — a result set is addressed by its position, so nothing can be closed without renumbering
everything after it.** `state.ts:34-36`:

```ts
export function resultPageKey(tabId: string, index: number): string {
  return `${tabId}:result:${index}`;
}
```

`state.ts:41` drops pages by looping `0..results.length`, `state.ts:73-75` sets them by
`forEach((page, i) => setPage(resultPageKey(tabId, i), page))`, and `ConsoleView.vue:245` binds
`:page-key="resultPageKey(tab.id, i)"`. Closing result 0 of 3 with position-as-identity means
re-keying two pages in `resultPages.ts`'s `Map` — that is, copying entries so that a *closed*
result silently renames two *open* ones. Identity has to stop being position before an × can exist.
Note that `resultPages.dropForTab` (`resultPages.ts:48-58`) prefix-matches `${tabId}:`, so any
suffix scheme keeps tab-close cleanup working unchanged.

**F5 — `run()` always replaces; there is no "keep the previous result" path to toggle between.**
`state.ts:72-78`: `dropResults(tabId)` then `rt.results = response.pages`. `dropResults` (`:38-43`)
drops each page from the store and clears the array. The toggle the user asks for is therefore
"skip `dropResults` and append", plus somewhere to remember which mode the tab is in.

**F6 — the runtime holds a second, direct reference to every result `Page`, and the code says so.**
`state.ts:12` (`results: Page[]`) and `state.ts:23-31`:

> *"`dropAllPagesForTab` already frees this tab's entries in `resultPages.ts`'s own `pages` map, but
> `rt.results` holds a second, direct reference to those same Page objects (F5) — clearing it
> before the record itself is dropped is what actually releases them."*

Two owners for one object is what makes the per-result close path delicate. Since the only fields
`ConsoleView.vue:240-241` reads off those pages are `rowCount` (and, implicitly, the page kind via
`ConsoleResultGrid`, which re-reads it from the store anyway through `getPage(pageKey)` at
`ConsoleResultGrid.vue:32-36`), the runtime can hold `{ key, rowCount }` and leave `resultPages.ts`
the single owner.

### B. Search over console results

**F7 — the console is the one view that mounts no find widget at all, and `Cmd/Ctrl+F` on a console
tab is a silent no-op.** `ConsoleView.vue:123-128` registers only `view.run` and `view.run-all`;
`shortcuts/commands.ts:14-18` no-ops for an unregistered id *by design* (*"A no-op, not an error …
e.g. Find on a definition tab, which has no search box"*). `grep -rn "SearchToolbar"
src/renderer/views` returns `grid/DataView.vue:12,153`, `documents/DocumentView.vue`,
`keyvalue/KeyValueView.vue:28,768` and `stream/StreamSearchToolbar.vue` (its own, simpler widget) —
never `console/`. Adding the widget therefore also means registering `view.find`, or `Cmd+F` will
keep doing nothing while a button in the toolbar does something.

**F8 — what the shared toolbar needs is exactly six functions, and the console can supply all six
without touching `views/shared/page/`.** `views/shared/page/search.ts:10-21`:

```ts
export interface PageSearchApi<M extends { row: number }> {
  runSearch(tabId, q, onProgress): SearchHandle<M>;
  clearSearchState(tabId): void;
  searchState: Record<string, { matches: M[]; index: number }>;
  matchedRows(tabId): number[] | null;
  pageVersion: { n: number };
  loadedRowCount(tabId): number;
}
```

`createPageSearch` (`:49-73`) assembles five of the six from one `runSearch` plus a `pageVersion`
and a `loadedRowCount`; `views/grid/search.ts:47-57`, `views/keyvalue/search.ts:52-60` and
`views/documents/search.ts:55-63` are three existing three-line call sites. The console needs a
fourth. **Every parameter named `tabId` in that interface is only ever used as a `Record` key and
as the argument to the view's own `getPage`** — nothing in `views/shared/page/` requires it to be a
real tab id.

**F9 — but the console has N pages per tab, so the scope has to be resolved somewhere, and there
are only two honest places to do it.** `searchFilterState` (`searchFilter.ts:8-23`) and
`createSearchState`'s record (`search.ts:26-43`) are both keyed by that same string, and both
register a `registerTabRuntimeCleanup` handler that deletes **exactly** that key on tab close. So
keying console search state by a *result* key (`${tabId}:result:N`) would leak one record and one
boolean per console result past tab close unless both cleanups learn a prefix rule — a change to
two shared modules, plus a rename of the `tabId` parameter across four view modules and three
components to stop the name lying. The alternative is to keep the tab id as the key and resolve
"which page" inside `views/console/`, which is one function in one new file. D9 takes the second.

**F10 — the shared toolbar's re-scan trigger is `pageVersion.n`, which the console store already
has and already bumps on exactly the events that mean "the page under this key changed."**
`SearchToolbar.vue:103-108` re-runs the scan (with `autoScroll=false`) whenever `api.pageVersion.n`
changes; `resultPages.ts:32` declares `pageVersion` and `:37,45,57` bump it in `setPage`, `drop`
and `dropForTab`. Under D9, switching the active result set is that same event from the toolbar's
point of view, so an open find re-scans the newly visible result instead of pointing at rows that
are no longer on screen.

### C. The cell editor

**F11 — the affordances the user calls "buttons that do nothing" are three different states, and
only one of them is literally a no-op. Stating them precisely matters, because the fix differs.**

| Affordance | Site | What it actually does in the console |
|---|---|---|
| **UUID generate** | `CellEditorView.vue:331-337` | **Literally inert.** `canGenerateUuid = effectiveFormat === 'uuid' && isEditable` (`:135`), and `isEditable` is false for every console cell (below), so the button is permanently `disabled`. Its disabled tooltip (`:136-138`) reads *"Available when the format is UUID."* — which is a **false statement** on a console cell whose format *is* UUID. |
| **Beautify indented / compact** | `EditBufferActions.vue:53-69` | **Not** a no-op. `applyBeautify` writes `doc.value` (`useEditBuffer.ts:69-82`) and `CodeMirrorHost`'s `props.doc` watcher dispatches it (`CodeMirrorHost.vue:191-206`); `EditorState.readOnly` is *"consulted by commands and extensions that implement editing functionality"* (`node_modules/@codemirror/state/dist/index.d.ts:1230-1240`) and does not block a programmatic dispatch. They **are** disabled whenever the effective format has no lossless formatter (`canBeautify`, `useEditBuffer.ts:50`) — which is every non-JSON/XML value, i.e. most console cells. |
| **Revert / `modified` chip** | `EditBufferActions.vue:43-49,70-76` | Reachable only via Beautify, since the editor itself is read-only. `reset()` calls `opts.onRevert?.()` (`useEditBuffer.ts:84-89`), which is `selectedCell.value.onRevert?.()` (`CellEditorView.vue:111`) — never set by the console (`ConsoleResultGrid.vue:95-104,122-129,143-150` set neither `onEdit` nor `onRevert`). |
| **Byte badge** | `EditBufferActions.vue:50-52` | **A duplicate.** `buffer.byteLabel` is `formatBytes(encode(doc).length)` (`useEditBuffer.ts:49`); the status badge two elements to its left (`CellEditorView.vue:314-316`, from `statusLine` at `:277-287`) opens with `formatBytes(statusEncoder.encode(value).length)` over the same buffer. The panel header shows the same byte count twice, in both modes. |

**F12 — the "No primary key" label the user names is `readOnlyReasonFor`'s third branch, and in the
console it is a statement about a table that does not exist.** `celleditor/state.ts:38-44`:

```ts
if (record?.readOnly) return 'connection-read-only';
if (cell.truncated) return 'value-truncated';
if (!cell.hasPrimaryKey) return 'no-primary-key';
```

`ConsoleResultGrid.vue:101` publishes `hasPrimaryKey: column.isPrimaryKey`, and the adapter sets
that flag to `false` for every console column with its own reason — `postgres/console.ts:93-96`:
*"execute() never consults the catalog (no target relation to describe), so nullability and PK-ness
are unknowable here — console results are always read-only regardless."* So every SQL console cell
renders `CellEditorView.vue:342-345`'s warn chip with a lock icon reading **"No primary key"**, and
its tooltip (`:95`) reads *"This table has no primary key, so a row can't be identified to write."*
about a `SELECT 1 AS x`. A console **document** result escapes it (`ConsoleResultGrid.vue:128` sets
`hasPrimaryKey: true` deliberately); a console **key/value** result does not (`:149`).

**F13 — `!cell.onEdit` cannot be the signal for read-only mode, because the grid also omits `onEdit`
on a read-only connection and on a truncated value — where the reason chip is required.**
`DataGrid.vue:523-532` sets `onEdit`/`onRevert` only when `canEditTable.value && !isDeleted(row)`.
`CellEditorView.vue:73` is `isEditable = readOnlyReason === null && !!onEdit`. So the four cases
collapse into one boolean today:

| Case | `onEdit` | Reason chip required? |
|---|---|---|
| grid, writable connection, PK present | set | no |
| grid, **read-only connection** | absent | **yes** — §8.6: *"The panel is forced read-only when the connection is marked read-only"*, asserted by `cell-editor.spec.ts:505` |
| grid, **truncated value** | absent | **yes** — §8.6, asserted by `cell-editor.spec.ts:376,806` |
| **console / stream / documents** | absent | **no** — nothing was ever editable to explain |

The distinction the component is missing is not "can this cell be written" (it has that) but
"**does this mount have a write path at all**". That is a property of the *view that mounts the
dock*, known at mount time, and it is what has to become a prop.

**F14 — five views mount `CellEditorDock`; three of them never publish `onEdit`, and only the
console is in this phase's scope.** `grep -rn "CellEditorDock" src/renderer --include=*.vue`:
`grid/DataView.vue:187`, `keyvalue/KeyValueView.vue:849`, `stream/StreamView.vue:823`,
`documents/DocumentView.vue:818`, `console/ConsoleView.vue:254`. Of these, `grep -n "onEdit"` finds
publishers only in `grid/DataGrid.vue` and `keyvalue/KeyValueView.vue:404,454` (the S3 object body,
P33) — `stream/` and `documents/` publish none at all, and `keyvalue/KeyValueView.vue:438-439`
already documents that its Redis rows *"[have] no onEdit at all, so the panel stays read-only for
them by cellSelection.ts's own 'no onEdit -> read-only' rule."* Stream and the non-S3 key/value
rows therefore show the same nonsense "No primary key" chip the console does. **They are out of
scope** (the user asked about the query console) and are handed to P42 in §8 — but this is why the
prop is designed as a general capability rather than a console branch inside the component.

### D. The console result grid against the data grid

**F15 — the data-type badge in the console's result header has no counterpart in the data grid.**
`ConsoleResultGrid.vue:174-175`:

```html
<span class="name">{{ col.name }}</span>
<span class="p-badge" v-tooltip="col.dataType">{{ col.dataType }}</span>
```

`DataGrid.vue:1264-1283`'s header cell renders the label, an optional PK/FK key label and an
optional sort indicator — **no type badge**; the type lives in the cell's tooltip instead
(`headerTitleFor`, `DataGrid.vue:101-107`: name, dataType, `typeDescription(dataType)`, column
comment, newline-joined). The console's badge came straight from the mockup
(`Console.html:92-96` renders `<span class="p-badge">date</span>` in every `th`); the app's own
grid deliberately did not follow it. Dropping it and adopting the tooltip is the "look like the
normal cell view" the user asks for, stated as a diff.

**F16 — three other differences, all small, all in the same direction.** Read side by side:

| | `DataGrid.vue` | `ConsoleResultGrid.vue` |
|---|---|---|
| header tooltip | `headerTitleFor` — name/type/description/comment (`:1256`) | none |
| row hover | `.grid-row:hover .grid-cell:not(.selected)` → `--kira-hover` (`:1541-1544`) | none |
| numeric cells | `.grid-cell.align-right { justify-content: flex-end; font-variant-numeric: tabular-nums }` (`:1644-1647`) | `.cell.align-right { justify-content: flex-end }` only (`:279-281`) |
| gutter width | `GUTTER_WIDTH = 56` (`:56`) | `56px` (`:267-270`) — **already identical** |
| selection | `--kira-select` + `--kira-focus` outline (`:1653-1657`) | identical, and says so (`:283-289`) |
| cell classes | `cellClass()` (`theme/cellClass.ts`) | `cellClass()` — **already shared** |
| PK/FK key label | `keyLabelFor` from the tab's column metadata | nothing to show: `isPrimaryKey` is always `false` for a console column (F12) |

So "make it look like the normal cell view" is four lines, not a rewrite — and the two views
already share `columns.ts`'s width/alignment helpers and `cellClass`'s vocabulary, which is what
makes it four lines.

### E. What the specs assert today

**F17 — Playwright coverage of the console's results is four assertions in three files, and two of
them pin the stacked-panel model directly.**

| Site | Assertion |
|---|---|
| `console.spec.ts:218-236` | run statement → `console-result-grid` count **1**; run all → count **2**, `nth(0)` contains `10`, `nth(1)` contains `20`, and `console-status` contains `'2 result sets'` |
| `interaction.spec.ts:714-717` | View ▸ Run All → `console-result-grid` count **2** |
| `leaks.spec.ts:158` | after a 5 000-row run → count **1**, then `closeAllTabs` returns `__kiraRetainedBytes` to baseline |
| `sqlite.spec.ts:112-115`, `mysql.spec.ts:130`, `clickhouse.spec.ts:151`, `mongo.spec.ts:229`, `redis.spec.ts:156`, `cell-editor.spec.ts:883` | single-result runs → count **1** or a text match |

Only the two "count 2" assertions are invalidated by D2; everything else survives untouched. There
is **no** assertion anywhere on `.result-panel`, `.result-head`, `Result 1`, or the console's
per-result markup, and **no** console find-widget coverage at all (`grep -rl "console-search"
tests/ui` → nothing).

**F18 — `tests/ui/sqlite.spec.ts` is the one console-touching UI spec that actually runs in this
sandbox, and it already opens a console and runs a statement.** AGENTS.md's SQLite section:
*"`tests/ui/sqlite.spec.ts` runs unconditionally (no Docker gate at all) — the one DB-backed UI
spec that actually executes in Claude Code's own Linux web container."* Its console paragraph is
`sqlite.spec.ts:105-115`. Every other console spec is Postgres/MySQL/ClickHouse/Mongo/Redis-backed
and Docker-gated, and Docker image pulls return `403` through this environment's proxy (AGENTS.md),
so **`console.spec.ts` cannot be run here at all**. That is a fact about where this phase's
verification can and cannot happen, not a reason to skip it (§5).

**F19 — the `data-testid` conventions to follow, taken from the two folders this phase touches.**
`views/console/`: `console-view`, `console-target`, `console-stop`, `console-run-statement`,
`console-run-all`, `console-saved-toggle`, `console-error`, `console-results`, `console-status`,
`console-result-grid`, `console-result-row`, `console-result-cell`, `console-result-doc-row`,
`console-result-kv-row`. `views/grid/`: `data-grid`, `grid-header-cell`, `grid-row`, `grid-cell`,
`toolbar-search`, `pager-first`, plus the find widget's own `""`-prefixed set from
`SearchToolbar.vue` (`search-toolbar`, `search-input`, `search-filter-rows`, …). `KeyValueView.vue`
is the precedent for a prefixed mount: button `keyvalue-search`, `testid-prefix="keyvalue-"` →
`keyvalue-search-toolbar`. The console follows it exactly.

### F. Persistence and memory

**F20 — `consoleTabStateSchema` has one field, and the schema already documents how to add a second
without a migration.** `shared/domain/tabs.ts:56-58`: `z.object({ text: z.string() })`, with
`defaultConsoleTabState()` at `:191-193`. `documentTabStateSchema:66-76`'s own comment states the
rule: *"`.default()` on the four added fields keeps a tab saved before they existed parsing
successfully on restore, rather than being dropped by `tabRecordSchema`'s `safeParse`."*
`definitionTabStateSchema:46-48` is a second instance (`pane: z.enum([...]).default('structure')`).
`patchConsoleTabState` (`state/tabs.ts:498-500`) already passes `skipUnchanged: true`.

**F21 — accumulating result sets is opt-in and bounded, and the existing memory guard already
covers it.** `main.ts:13,50` sums `views/console/resultPages.ts`'s `totalRetainedBytes()` into
`window.__kiraRetainedBytes`, which `leaks.spec.ts` asserts returns to baseline after
`closeAllTabs`. Since the × path drops the page from the same `Map` and `dropForTab`
(`resultPages.ts:48-58`) still prefix-matches `${tabId}:`, the guard holds for both new lifetimes
this phase introduces without a new mechanism.

**F22 — `resultPages.setVisibleWindow` has no caller anywhere, so the console's decode cache is
never pruned.** `resultPages.ts:67-75` exports it; `grep -rn "setVisibleWindow" src/renderer`
returns only that declaration plus `views/grid/page.ts:48` and its one caller
`DataGrid.vue:40,377`. The console grid never calls it, so `entry.decodeCache` grows to hold every
cell the user has scrolled past for the life of the result. It is bounded by the page (a console
page is one `execute` response with no fetch-more path), and this phase makes it *possible* to hold
several such pages at once — but wiring a cache hint the user did not ask for, into a view with no
`budgets.spec.ts` coverage of its own scroll path, is precisely the unrequested behavior change
§0 forbids. **Left alone; §8 hands it to P42** (wire it or delete it — one of the two, not neither).

---

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/console/state.ts — CHANGED (F4/F5/F6).
/** One result set of a run. `key` is identity and never changes while the result is open;
 *  the "Result N" the strip prints is its *position*, which renumbers when a sibling closes. */
export interface ConsoleResult {
  key: string;      // resultPageKey(tabId, seq) — the key its Page is stored under in resultPages
  rowCount: number; // denormalized at run time: the page is frozen, so this can never drift
}

export interface ConsoleViewRuntime {
  status: 'idle' | 'running' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null;
  results: ConsoleResult[];   // was Page[] — resultPages.ts is now the only owner of a Page (F6)
  activeKey: string | null;   // which result the single mounted grid shows
  searchOpen: boolean;        // mirrors views/{grid,documents,keyvalue}/state.ts's own flag
  nextSeq: number;            // per-tab monotonic; never reused, so a key is never recycled
}

/** Unchanged shape, new meaning: `seq` is the tab's own monotonic counter, not an array index. */
export function resultPageKey(tabId: string, seq: number): string;   // `${tabId}:result:${seq}`

/** The page the tab's active result set holds — the console's answer to the other three views'
 *  `getPage(tabId)`, and the one place "which of this tab's N pages" is resolved (D9). */
export function activePage(tabId: string): Page | null;

/** Selects a result set. Bumps resultPages' pageVersion: to every reader of that store — the find
 *  toolbar above all (F10) — "the page this scope resolves to has changed" is the same event as a
 *  page being replaced under a key. */
export function setActiveResult(tabId: string, key: string): void;

/** The strip's ×. Drops the page (so the retained-byte guard sees it, F21), removes the entry, and
 *  re-selects the next result set, else the previous, else none. */
export function closeResult(tabId: string, key: string): void;
```

```ts
// src/renderer/views/console/search.ts — NEW (F8/F9). The fourth three-line createPageSearch call
// site, after grid/documents/keyvalue.
/** `col` is the page column index for a tabular result; for the two non-tabular result kinds the
 *  page has fixed semantic columns and no index to point at, so: a document row is always 0, and a
 *  key/value row is 0 for the field and 1 for the value. Keeps ConsoleResultGrid's match lookup the
 *  same `${row}:${col}` Set the grid and key/value views already build. */
export interface Match { row: number; col: number; start: number; end: number; }

export function runSearch(tabId, q, onProgress): SearchHandle<Match>;  // scans activePage(tabId)
export const pageSearchApi: PageSearchApi<Match>;
export { matchedRows, searchState };
```

```ts
// src/renderer/views/console/resultPages.ts — one addition (F10).
/** The `pageVersion.n++` setPage/drop/dropForTab each wrote inline, named — so state.ts can raise
 *  the same signal when the active result changes without reaching into the counter. */
export function bumpPageVersion(): void;
```

```vue
<!-- src/renderer/views/shared/celleditor/CellEditorDock.vue — one prop (F13). -->
defineProps<{
  tabId: string;
  /** The view mounting this dock has no write path for its cells at all — a viewer, not an editor
   *  that happens to be refusing this cell. Forwarded to CellEditorView, where it hides every
   *  affordance that exists only to serve staging a write, and suppresses the "why is this
   *  read-only" chip (there is no promise to explain away). Distinct from a *cell* being
   *  uneditable: a read-only connection or a truncated value publish no `onEdit` either, and those
   *  must keep their reason chip (§8.6). Default false — the four other mounts are unchanged. */
  readOnly?: boolean;
}>();
```

```vue
<!-- src/renderer/views/shared/celleditor/CellEditorView.vue — the same prop, plus: -->
const viewerMode = computed(() => props.readOnly === true);
const readOnlyReason = computed(() => (viewerMode.value ? null : readOnlyReasonFor(props.cell)));
const isEditable = computed(
  () => !viewerMode.value && readOnlyReason.value === null && !!props.cell.onEdit,
);
<!-- root gains :data-read-only="viewerMode || undefined"; data-read-only-reason is absent in
     viewer mode because readOnlyReason is null there. -->
```

```ts
// src/shared/domain/tabs.ts — one field (F20).
export const consoleTabStateSchema = z.object({
  text: z.string(),
  /** P40: run into a new result set instead of replacing the current one. `.default(false)` keeps
   *  a console tab saved before this field existed restorable (documentTabStateSchema's rule), and
   *  false is today's behavior, so an existing tab restores behaving exactly as it did. */
  newResultSet: z.boolean().default(false),
});
```

```
ConsoleView.vue's results area, after this phase:

  .results-body            flex 1 1 60%, min-height 0, column   (no overflow-y: auto — nothing stacks)
    .result-strip          .p-toolbar, flex-shrink 0            [Result 1 ×][Result 2 ×] … status
    SearchToolbar          v-if searchOpen, flex-shrink 0        testid-prefix "console-"
    .result-grid           flex 1, min-height 0                  one ConsoleResultGrid, active result
  CellEditorDock           :read-only="true"
  (the .status-line bar is gone — F3)
```

---

## 3. Decisions

### The results area

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **A result set gets a stable key.** `rt.results` becomes `ConsoleResult[]` (`{ key, rowCount }`); `resultPageKey(tabId, seq)` takes the tab's own monotonic `nextSeq` instead of an array index; the runtime stops holding `Page` objects. | F4/F6. Position-as-identity makes "close result 1 of 3" a re-key of two *other* results in `resultPages.ts`'s map — a closed result renaming open ones. `nextSeq` is never reused, so a key is never recycled onto a different page. Dropping `Page[]` from the runtime leaves `resultPages.ts` the single owner (F6's own comment is the argument), and `rowCount` is safe to denormalize because `setPage` freezes the page (`resultPages.ts:35`). `dropForTab`'s `${tabId}:` prefix rule is unchanged, so tab-close cleanup and `leaks.spec.ts` are untouched. |
| D2 | **One result set is visible at a time, chosen by a strip of chips at the top of the results body.** The `v-for` of 260px `.result-panel`s goes; one `ConsoleResultGrid` is mounted, bound to `rt.activeKey`. | F2, and the design system's own console body (`Console.html:79-98`), which this view's own comment records it deviated from. It is also what makes the other four items in this phase tractable: one find toolbar instead of N, one grid to fill the panel (D7), and a chip per result to hang the × on. **This is the phase's largest behavior change** and it invalidates exactly two assertions (F17), both edited in the same commit. |
| D3 | **The strip is a `.p-toolbar` band; each entry is a `.p-tab` chip with a nested `role="button"` close span; the trailing text keeps `data-testid="console-status"`.** New testids: `console-result-strip`, `console-result-tab` (with `:data-active`), `console-result-close`. | Both classes are existing primitives (`primitives.css:319-337`, `:486-497`) and the chip-with-nested-close markup is `TabStrip.vue:151-179`'s exactly — a result set *is* a tab, so it reads and behaves like one, with no new CSS vocabulary. Keeping `console-status` on the strip's status text means `console.spec.ts:232`'s `'2 result sets'` assertion keeps its meaning rather than being deleted, which is the cheapest possible proof that the count did not change meaning when the bar moved. |
| D4 | **The bottom `.status-line` bar is deleted.** `'Running…'`, `'Cancelled'` and `'N result sets'` move into the strip's trailing status text, which renders whenever the strip does. | F3, and the file's own comment asking for exactly this. `Running…` is already on screen twice (`ViewChrome`'s `RunState`, `ViewChrome.vue:82`). The one thing genuinely lost is a transient `'Cancelled'` label in the case where a cancelled run had **no** previous results to keep the strip on screen — recorded here rather than glossed: the Stop button returning to disabled and the operations panel's own `cancelled` row (which `interaction.spec.ts:635-639` is the assertion for) are what report it in that case, and no spec asserts the label. |
| D5 | **× closes one result set:** `closeResult` drops its page from `resultPages`, removes the entry, and re-selects the next result, else the previous, else none (the strip and the grid disappear together, as they do today when a tab has no results). Labels are positional, so the remaining chips renumber. | The user's *"Ofc I should be able to close a result with an x."* Dropping the page — not just the entry — is what keeps `window.__kiraRetainedBytes` honest (F21) and is the reason D1's split ownership matters. Positional labels renumber rather than leaving a gap ("Result 1, Result 3") because the label is a position, and D1 already separates that from identity. |
| D6 | **A toolbar toggle — `IconButton icon="layers"`, `:active`, `data-testid="console-new-result-toggle"` — decides whether a run appends a new result set or replaces the current ones. Persisted per tab as `consoleTabStateSchema.newResultSet`, `.default(false)`.** `run()` calls `dropResults` only when it is off. | The user's first sentence. Per-tab (not app-wide) because every other console/grid working preference is per-tab state, and `.default(false)` means both that no migration is needed (F20's documented rule) and that an existing console tab restores behaving exactly as it does today — the toggle is opt-in, so accumulation can never surprise someone who never pressed it. `IconButton` + `:active` + a tooltip is the shape every other toolbar toggle in the app uses (`keyvalue-search`, `toolbar-search`, `search-filter-rows`); `layers` is in the bundled codicon set (verified against `node_modules/@vscode/codicons/dist/codicon.css`). |
| D7 | **`.result-panel`'s `height: 260px` is deleted; the grid host becomes `flex: 1; min-height: 0` and `.results-body` loses `overflow-y: auto`.** | F1 — the reported bug, and its fix is `DataView.vue:209-213`'s own rule, which is why the grid never had it. Landing it in D2's commit rather than its own is deliberate: it is the same CSS block being rewritten, and a separate commit would write those declarations twice. The commit message names the bug. |

### Search over console results

| # | Decision | Rationale |
|---|----------|-----------|
| D8 | **`views/shared/page/SearchToolbar.vue` is mounted in the console with `testid-prefix="console-"` and `row-noun="rows"`, above the result grid, gated on a new `rt.searchOpen`; a `console-search` `IconButton` toggles it and `registerCommand('view.find', …)` binds `Cmd/Ctrl+F` to the same flag.** | The user's second sentence, and F7 — without the command registration the menu's Find and `Cmd+F` would keep silently doing nothing while a new button beside them worked, which is worse than not having the button. Placement above the grid (not floating over it) is `DataView.vue:150-161`'s own documented choice. The prefix follows `KeyValueView.vue`'s precedent exactly (F19), so the toolbar's whole testid set comes out as `console-search-*` with no collision against the `console-search` button itself. |
| D9 | **The search scope stays the *tab id*. `views/console/search.ts` resolves it to the tab's **active** result through a new `activePage(tabId)`, and `setActiveResult` bumps `pageVersion` so an open find re-scans.** No file under `views/shared/page/` changes. | F9/F10, and this is **the judgment call in the phase**. The alternative — keying search state by result — is more literally accurate but forces a prefix rule into two shared cleanup handlers (`searchFilter.ts:19-23`, `search.ts:33-36`), a rename of the `tabId` parameter through `PageSearchApi`, `SearchToolbar.vue` and four view modules to stop the name lying, and a new leak class if either half is missed. This way, `tabId` keeps meaning a tab id everywhere, the console's "which of my N pages" question is answered in one function in `views/console/`, and the re-scan mechanism is the one the toolbar already implements for a replaced page (`SearchToolbar.vue:103-108`). The cost is that the find is per *tab*, not per result: switching result sets re-scans the same query against the newly visible one instead of remembering a separate match list per result. That is the better behavior anyway — a match count pointing at rows that are not on screen is the bug P31 D22/D23 fixed for the other three views. |
| D10 | **`ConsoleResultGrid` gains match filtering, match tinting and go-to-match:** `rowIndices` falls back to `matchedRows(tabId)` when filtering, `cellClass` gains `searchMatch`/`searchMatchCurrent`, and `goToMatch` calls `VirtualList`'s exposed `scrollToIndex(rowIndices.indexOf(match.row))`. Rows gain `:data-row`. | The shared toolbar's three affordances (filter toggle, prev/next, count) are inert without them, and shipping a widget whose filter button does nothing would recreate exactly the complaint this phase exists to fix. Every piece already exists: `cellClass`'s `searchMatch`/`searchMatchCurrent` flags (`theme/cellClass.ts:19-22`) are already this grid's own vocabulary, `VirtualList.scrollToIndex` is already exposed (`VirtualList.vue:119-133`), and the `indexOf` step is `DocumentView.vue:363-372`'s own precedent for a filtered list. Gutter numbering stays `r + 1` on the true page row, so filtered rows keep their real number exactly as the other three views do. |

### The cell editor

| # | Decision | Rationale |
|---|----------|-----------|
| D11 | **`CellEditorDock` and `CellEditorView` gain `readOnly?: boolean` — "this mount is a viewer" — defaulting to `false`. `ConsoleView.vue` passes `:read-only="true"`.** | F13 is the whole argument: the component already knows whether *this cell* can be written and cannot distinguish that from *this surface never writes*, because a read-only connection and a truncated value also arrive with no `onEdit`. The missing fact is known at mount time by the view that owns the tab — which is exactly what a prop is for, and exactly the shape P26 D1 already chose when it made the dock per-view-mounted. It is a real capability, not a console branch: `stream/` and `documents/` are the next two callers whenever someone is allowed to touch them (F14, §8). |
| D12 | **In viewer mode the read-only *reason* chip is not rendered and `data-read-only-reason` is absent; the panel root instead carries `data-read-only="true"`.** | F12 — "No primary key" is a claim about a table that does not exist for a `SELECT 1 AS x`, and its tooltip (*"This table has no primary key, so a row can't be identified to write"*) is a sentence about a write that was never on offer. A reason exists to explain a refusal; in a viewer there is no refusal, only a viewer. The replacement attribute keeps the state assertable (`§7`) and keeps `cell-editor.spec.ts:376,505,806`'s three `data-read-only-reason` assertions — all on *grid* cells — meaning exactly what they meant. |
| D13 | **In viewer mode the UUID-generate button and the whole `EditBufferActions` row (the `modified` chip, the byte badge, Beautify indented/compact, Revert) are not rendered.** `EditBufferActions.vue` itself is not modified. | F11, one row at a time. UUID-generate is permanently disabled there and its disabled tooltip is a false statement (*"Available when the format is UUID"* on a UUID). The byte badge is a duplicate of the status badge inches away. `modified` and Revert describe a buffer whose only possible edit is the Beautify beside them and whose `onRevert` is `undefined`. Beautify itself is the one real loss — it *does* work in a read-only panel (F11 quotes CodeMirror's own typing to that effect), and pretty-printing a JSON result you are only reading is worth something. It goes anyway, for two reasons: the user named "format" first among the things that should be hidden, and the four controls are one row with one meaning — an edit buffer — so hiding three and keeping one leaves a control whose undo button just disappeared. §6 records the mitigation (the value stays fully readable, wrapped, copyable, syntax-highlighted, and the same cell in a data tab keeps the full row) and §8 hands "auto-pretty-print in viewer mode" to P42 as the honest follow-up if the loss bites. |
| D14 | **Viewer mode keeps: the identity line, the data-type badge, the NULL/empty/truncated chips, the status badge, the format `<select>`, both translate panes (timestamp, hex/base64 decoded text) and the close button.** | These are *facts about the value* and *ways to read it*, not ways to write it. The format select still drives syntax highlighting and still decides which translate pane opens — which is how you read an epoch-millis or hex value at all — and both panes already bind `:read-only="!isEditable"` (`CellEditorView.vue:372,388,412`), so they are already correct in a viewer. The data-type badge stays for the same reason: it is the column's own type, the same fact the grid's dock shows, and hiding facts was never the request. |
| D15 | **The other four `CellEditorDock` mounts are not touched**, and `readOnly` defaults to `false` so their rendered output is byte-identical. | F14, and scope. `grid/` must keep its reason chip (§8.6, three spec assertions); `keyvalue/` genuinely publishes `onEdit` for an S3 object body (P33). `stream/` and `documents/` are real candidates for the same flag and are named in §8 rather than smuggled in here — the user asked about the query console. |

### The console result grid's look

| # | Decision | Rationale |
|---|----------|-----------|
| D16 | **The `p-badge` data-type element is deleted from `ConsoleResultGrid`'s header cell, and the cell gains `v-tooltip="headerTitleFor(col)"` — name, dataType, `typeDescription(dataType)`, newline-joined.** | F15 — the user's *"make sure to drop the data types from the header"*, and it is also the single biggest visual difference from the grid, whose header has never carried the badge and has carried the tooltip since P31 D29. `typeDescription` comes from `views/shared/typeGlossary.ts:273`, which `views/console/` may import (it is `shared/`, not a sibling view — biome's second pattern group forbids only `../<kind>/**`). The grid's fourth tooltip line (the column comment) has no console equivalent: `execute()` never consults the catalog (F12's quote from `postgres/console.ts:93-96`), so there is no comment to print. |
| D17 | **Two more parity fixes and no others: a `:hover` row highlight, and `font-variant-numeric: tabular-nums` on right-aligned cells.** Sort affordances, PK/FK key labels, resize handles, column reordering and the header select-zone are **not** added. | F16's table. The first two are three lines of scoped CSS with the grid's exact tokens. The rest all exist to serve something a console result does not have: there is no server round trip to re-sort with, no persisted column state (`ConsoleResultGrid.vue:11-16` says exactly this and stays true), and no key metadata to label (`isPrimaryKey` is always false, F12). Adding an affordance that looks like the grid's and cannot do what the grid's does would be worse than the badge this phase is removing. |

### Tests and documentation

| # | Decision | Rationale |
|---|----------|-----------|
| D18 | **Each behavior commit edits the specs it invalidates; one final commit adds the new coverage.** Invalidated: `console.spec.ts:229-236` and `interaction.spec.ts:714-717` (both `console-result-grid` → `console-result-tab` counts, plus a chip click to reach the second result). New: console result-set scenarios in `console.spec.ts`, a read-only-panel block in `cell-editor.spec.ts`'s existing console step (`:872-886`), and **a short addition to `sqlite.spec.ts`'s existing console paragraph** (`:105-115`). | F17/F18. The `sqlite.spec.ts` addition is the deliberate one: it is the only console coverage that runs without Docker (AGENTS.md), so without it every new behavior in this phase is unverifiable in this environment and in any CI box without a working image pull. It stays short — toggle on, run twice, two chips, close one, one chip, open Find and see a count — and does not duplicate `console.spec.ts`'s deeper scenarios. |
| D19 | **SPEC.md is edited by the implementing session; ARCHITECTURE.md is not.** §8.6 gains the viewer-mode sentence; §8.15 gains the result-set strip, the new/reuse toggle and the find toolbar; §10's P40 row moves from "Not yet planned — queued" to what was built; §11's `views/` block names `console/search.ts` and the console's now-shared find widget. | Standing practice (P19/P21/P24/P31/P39). ARCHITECTURE.md is explicitly *"facts about the app itself — driver/dependency choices, protocol-level constraints, capability quirks"* (its own §1) and has no renderer section; nothing in this phase is an engine, storage or process fact, so adding one would be the first exception to that split rather than a documentation improvement. Said plainly so a reader does not think it was forgotten. |
| D20 | **Nothing under `views/shared/page/`, `theme/primitives/`, `src/engine/`, `src/main/`, `src/preload/` or `src/shared/protocol/` is modified**, and `biome.json` is unchanged. | §0. The one shared-folder change in the whole phase is the two new props on `views/shared/celleditor/`'s two components (D11), both optional and both defaulting to today's behavior. |

---

## 4. Implementation order

Eight commits. Each is one sitting, independently reviewable, leaves `lint`/`typecheck`
(node, web, db, electron-db)/`build` green, and carries the spec edits for the behavior *it*
changes. The two structural commits (1–2) come first so every later diff reads against the final
result model; the cell editor (5) is independent of them and could land anywhere, and is placed
after the console work so a reviewer meets the console's own read-only wiring last.

1. **`refactor(console): a result set gets a stable key and row count`** — D1. `state.ts`'s
   `ConsoleResult`/`ConsoleViewRuntime`, `resultPageKey(tabId, seq)`, `nextSeq`, `dropResults`
   iterating `rt.results` rather than `0..length`; `ConsoleView.vue:238-251` binds
   `:page-key="result.key"` and `{{ result.rowCount }}`; `state.ts:23-31`'s comment rewritten
   (`rt.results` no longer holds `Page` objects, so the sentence explaining why it must be cleared
   is now false). **No visual change** — the stack still renders — which is what makes this
   reviewable on its own.
2. **`feat(console): one result set at a time, with a closable result-set strip`** — D2/D3/D4/D5/D7.
   `ConsoleView.vue`'s results block and its `<style>`; `setActiveResult`/`closeResult`/
   `activePage`/`bumpPageVersion`; the `.status-line` bar deleted and `console-status` moved into
   the strip. **Carries the fix for the empty band below the last row (F1) — same CSS block.**
   Spec edits: `console.spec.ts:229-236`, `interaction.spec.ts:714-717`.
3. **`feat(console): run into a new result set or reuse the current one`** — D6.
   `consoleTabStateSchema.newResultSet` + `defaultConsoleTabState()`; `run()`'s conditional
   `dropResults`; the `console-new-result-toggle` `IconButton`. Restore-path check: a tab row saved
   before this field parses (that is what `.default(false)` is for) — exercised by
   `startup.spec.ts`'s own restore, which must be run.
4. **`feat(console): the shared find toolbar over the active result set`** — D8/D9/D10.
   `views/console/search.ts` (new); `rt.searchOpen`; the `console-search` button; `view.find`
   registration; `ConsoleResultGrid`'s filtered `rowIndices`, match tint, `:data-row` and
   `scrollToMatch` expose. `ConsoleResultGrid.vue:11-22`'s "no search" framing corrected.
5. **`feat(celleditor): a read-only mode, used by the query console's dock`** — D11–D15.
   `CellEditorDock.vue`/`CellEditorView.vue` gain `readOnly`; `viewerMode` gates the reason chip,
   the UUID button and `EditBufferActions`; `data-read-only` added; `ConsoleView.vue:254` passes
   it. `EditBufferActions.vue` untouched. Spec edit: `cell-editor.spec.ts`'s console step gains the
   viewer-mode assertions.
6. **`fix(console): the result grid's header drops the data-type badge`** — D16/D17.
   `ConsoleResultGrid.vue`'s header cell, `headerTitleFor`, the hover rule and `tabular-nums`.
   `ConsoleResultGrid.vue:107-110`'s comment about the cell editor "opening JSON pretty-printed by
   default" is corrected while here — it does not (D13's finding: nothing beautifies on seed).
7. **`test(ui): console result sets, the find toolbar and the read-only cell editor`** — D18. The
   *new* scenarios only (each earlier commit already carries its own edits): `console.spec.ts`
   (toggle → two result sets, × closes one, the strip's chip switches the grid, find counts and
   filters), the `sqlite.spec.ts` Docker-free addition, and `cell-editor.spec.ts`'s viewer-mode
   block if not already complete from step 5.
8. **`docs: SPEC §8.6/§8.15/§10/§11 for P40`** — D19, including this plan file if it is not already
   committed.

---

## 5. Verification

**Say plainly what this box can and cannot do.** Per AGENTS.md: `bun run lint`, `bun run typecheck`
and `bun run build` all run here. `bunx playwright test` runs here **only after** the Electron
binary is installed by hand with `curl` (AGENTS.md's "Electron binary" section — `bun install` does
not fetch it in this environment), and even then every Docker-backed spec self-skips, because image
pulls return `403` through this environment's proxy. Concretely for this phase:

| Spec | Runs in this sandbox? |
|---|---|
| `tests/ui/sqlite.spec.ts` | **Yes, for real, unconditionally** — the only console-touching spec that does (F18). This is why D18 puts a short console-UX block in it. |
| `console.spec.ts`, `interaction.spec.ts`, `cell-editor.spec.ts`, `leaks.spec.ts`, `budgets.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `mysql.spec.ts`, `clickhouse.spec.ts` | **No** — Postgres/MySQL/ClickHouse/Mongo/Redis containers; they `test.skip()` cleanly rather than fail. |
| `smoke`, `startup`, `workbench`, `connections`, `secrets` | Yes (no DB), and `startup.spec.ts` is the one that exercises step 3's tab-state restore path. |

**The phase is not done until the full `test:ui` suite has been run green on a box that can run it**
(the macOS/Colima machine or CI) — before the phase is called finished, not step by step.

| Step | What must be re-run green | What it pins |
|---|---|---|
| 1 | `typecheck` (all four) + `console.spec.ts`, `sqlite.spec.ts`, `leaks.spec.ts` | A result set still renders the same rows under a differently-derived key, and `__kiraRetainedBytes` still returns to baseline on tab close (`dropForTab`'s prefix rule survives the key change). |
| 2 | `console.spec.ts` (edited), `interaction.spec.ts` (edited), `leaks.spec.ts`, `cell-editor.spec.ts`, `mongo.spec.ts`/`redis.spec.ts` (their console scenarios), `budgets.spec.ts` | One grid mounted, N chips; `console-status` still reads `2 result sets`; the console's cell-editor publication still works through the single grid; closing a result frees its bytes. **The sharpest step in the phase.** |
| 3 | `console.spec.ts`, `startup.spec.ts` | Appending vs. replacing; and a console tab saved *before* `newResultSet` existed still restores (the `.default(false)` claim, F20). |
| 4 | `console.spec.ts`, `sqlite.spec.ts`, `data-view.spec.ts` + `mongo.spec.ts` + `redis.spec.ts` | The console's find widget filters, counts, cycles and closes — **and the other three views' widgets are unchanged**, which is what proves D9 kept `views/shared/page/` out of the diff. |
| 5 | `cell-editor.spec.ts` **in full** | The grid's panel is byte-identical: beautify, Revert, `modified`, the UUID button, and all three `data-read-only-reason` values (`value-truncated` `:376,806`, `connection-read-only` `:505`) still behave exactly as asserted — the console's is the only panel that changed. |
| 6 | `console.spec.ts`, `sqlite.spec.ts`, `clickhouse.spec.ts`, `mysql.spec.ts`, `mongo.spec.ts` | Result cells still carry their text and `data-null`; only the header's badge is gone. No spec asserts the badge (verified: `grep -rn "p-badge" tests/ui` has no console hit). |
| 7 | the three edited specs | The new coverage itself. |
| 8 | read against the tree | §8.15 describes the console that exists. |

**Manual click-through afterwards (a human or an agent on a box with a real database)** — headless
coverage cannot see layout, and three of this phase's six items are layout:

1. Open a console, run one statement, **with the cell editor closed**: the result grid must reach
   the bottom edge of the view — no empty band, no stray border (F1, the reported bug).
2. Click a cell, so the cell editor opens: the grid shrinks, still no band; close the panel with its
   × and the grid grows back to the edge.
3. In that panel: **no** Beautify pair, **no** Revert, **no** `modified` chip, **no** byte badge
   beside the status badge, **no** UUID button, **no** "No primary key" chip. Still present: the
   type badge, the status badge, the format select, the close button — and picking `hex` or
   `epochMillis` in the select must still open the translate pane below, read-only.
4. Open a **data** tab on the same table, click a cell: the full editing row is back, unchanged.
   Then open a data tab on a **read-only connection**: the "Connection is read-only" chip is still
   there (this is the one D11 exists to protect).
5. Run all with three statements: three chips, the first active; click each; × the middle one and
   watch the remaining two renumber; × the last one and watch the whole results area disappear.
6. Toggle the new-result button on, run twice: two result sets, both kept. Toggle it off, run
   again: back to one.
7. `Cmd/Ctrl+F` in the console: the find toolbar opens over the active result; type a term, check
   the count, the filter toggle, prev/next scrolling and Escape to close. Switch result sets with
   the find open: the count re-computes for the newly visible result.
8. Compare the console's result header with the data grid's side by side: no type badge, same
   tooltip on hover, same row hover, same numeric alignment.

---

## 6. Explicitly out of scope

- **Beautify in a viewer panel, and auto-pretty-printing to compensate** (D13). The value stays
  fully readable, wrapped, copyable and syntax-highlighted, and the same cell opened from a data
  tab keeps the whole edit row. Auto-formatting a viewer's buffer is new behavior nobody asked for;
  §8 hands the question to P42.
- **A `readOnly` dock for `stream/` and `documents/`** (F14/D15) — the same nonsense "No primary
  key" chip appears there, and the flag this phase adds is exactly what fixes it, but the user's
  request was about the query console. §8.
- **Wiring or deleting `resultPages.setVisibleWindow`** (F22). §8.
- **Per-result search state** (D9's rejected alternative), and any change at all to
  `views/shared/page/`'s seven modules.
- **Sorting, resizing, reordering or persisting columns in a console result grid**, and PK/FK key
  labels there (D17) — every one of them needs state or metadata a console result does not have.
- **Statement text or a SELECT/DDL verb on a result chip.** `ExecuteResponse` is
  `{ pages: Page[] }` (`shared/protocol/data-ops.ts:170-172`) with no per-page provenance;
  `postgres/console.ts:132-155` happens to return one page per statement, but nothing in the
  protocol says so and Mongo/Redis were not audited for it. A chip that labels a result with the
  wrong statement is worse than one that labels it "Result 2".
- **`Console.html`'s Messages/Plan tabs, the autocommit segmented control and the schema/search_path
  picker** — `ConsoleView.vue:165-169,207-209` already records why each is absent (no tracked data
  behind them), and none is in the user's list.
- **The console's editor/results split ratio and any splitter between them** (`flex 1 1 40%` /
  `60%`, unchanged) — not reported, not requested.
- **Anything in `src/engine/`, `src/main/`, `src/preload/`, `tests/db/`, `biome.json`, or
  `docs/v1/design/kira-design-system/`.**

---

## 7. Acceptance checklist

- [ ] With one result set and the cell editor closed, the result grid's last row is followed by the
      grid's own background to the panel's bottom edge — **no fixed-height panel, no stray border**.
      `grep -n "260px" src/renderer/views/console/ConsoleView.vue` returns nothing.
- [ ] `ConsoleView.vue` mounts exactly **one** `ConsoleResultGrid`, and `console-result-tab` chips
      equal `rt.results.length`.
- [ ] Clicking a chip's × drops that result's page: `window.__kiraRetainedBytes` falls, the
      remaining chips renumber from 1, and the grid shows a neighbour.
- [ ] `console-status` still exists, still reads `N result sets`, and there is **no second bar** at
      the bottom of the console view.
- [ ] The toolbar toggle is persisted: set it, close and reopen the app, the tab restores with it
      still set; and a console tab saved before P40 restores with it **off**.
- [ ] `Cmd/Ctrl+F` and the `console-search` button open the same toolbar; its filter toggle hides
      non-matching rows; prev/next scrolls the virtual list; Escape closes it and leaves no rows
      hidden.
- [ ] `git diff` for this phase touches **no file** under `src/renderer/views/shared/page/`,
      `src/engine/`, `src/main/`, `src/preload/`, `src/shared/protocol/` or `biome.json`.
- [ ] In the console's cell editor: `cell-editor-uuid-generate`, `cell-editor-beautify-indented`,
      `cell-editor-beautify-compact`, `cell-editor-beautify-reset`, `cell-editor-modified` and
      `cell-editor-byte-badge` all have **count 0**; the panel carries `data-read-only="true"` and
      **no** `data-read-only-reason`; `cell-editor-format`, `cell-editor-status` and
      `cell-editor-close` are still there.
- [ ] In a **data** tab's cell editor, all six of those testids are present and behave exactly as
      `cell-editor.spec.ts` already asserts — including on a read-only connection, where
      `data-read-only-reason="connection-read-only"` and its chip must still appear.
- [ ] `grep -n "col.dataType" src/renderer/views/console/ConsoleResultGrid.vue` returns only the
      tooltip helper, never a rendered badge.
- [ ] **No `data-testid` was removed or renamed anywhere.** Diff the testid strings across the whole
      phase: the set only grows.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` clean
      after **every** commit; full `test:ui` green on a box that can run it before the phase is
      called done.
- [ ] SPEC §8.15 describes the strip, the toggle and the find toolbar; §8.6 states the viewer-mode
      rule and how it differs from a forced-read-only cell; §10's P40 row records what was built.

---

## 8. What is left, and who owns it

**Handed to P42 (functionality review — three iterations, allowed to change behavior):**

1. **`stream/` and `documents/` mount the cell editor with no write path either** (F14), so a Kafka
   message and a Mongo document both show the same "No primary key" chip this phase removes from
   the console. The fix is one prop per mount — `:read-only="true"` — using the capability D11
   adds. Left undone here only because the user's request named the query console.
2. **`views/console/resultPages.ts:67`'s `setVisibleWindow` has no caller anywhere** (F22), so the
   console's decode cache is never pruned while the grid's is. Either wire it (the shape is
   `DataGrid.vue:377`'s one-line watch over `VirtualList`'s `scrollstate` emit) or delete it — the
   current state is a dead export that reads as a live guarantee.
3. **Beautify is unavailable in a viewer panel after this phase** (D13). If reading a one-line
   `jsonb` result turns out to be the common case, the answer is auto-pretty-printing on seed in
   viewer mode — a real decision with a real trade-off (it changes what "the stored value" looks
   like on screen), not a button to put back.
4. **`clickhouse/read.ts:9-11` still has no NUL-byte guard where its three SQL siblings do**, and
   **`state/tabs.ts`'s `patchChanged` divergence** is still preserved behind `skipUnchanged` —
   both handed forward by P39 iteration 3's §8, both untouched here, both still P42's.

**Handed to P43 (sparse unit tests):**

5. `views/console/search.ts`'s per-kind column mapping (tabular index / document 0 / key-value 0–1)
   is the kind of pure function that is cheaper to pin with a unit test than with a Playwright
   scenario, and this phase leaves it covered only end-to-end.

**Decided here, not deferred:**

6. **The console's find scope is the tab, resolved to its active result** (D9) — not one search
   state per result set. Recorded so a later reader does not re-open it: the alternative was
   measured (a prefix rule in two shared cleanup handlers plus a rename through seven files) and
   rejected on cost, not on taste.
7. **A result set's identity is a monotonic key, its label is a position** (D1/D5). Renumbering on
   close is intentional; stable "Result 3 with no Result 1" numbering was considered and dropped as
   the more confusing of the two.
8. **The design system's one-result-at-a-time console body is the model** (D2), three phases after
   `ConsoleView.vue:234-237` recorded that it had not been followed.
