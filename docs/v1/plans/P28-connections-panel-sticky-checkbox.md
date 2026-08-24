# P28 — The connections panel: sticky ancestor headers and a checkbox filter

> **SPEC.md §10, the P28 row, verbatim:** *"Two independent connections-panel fixes. (1) Scrolling
> the panel keeps the currently-open connection's group header stuck at the top, like a sticky
> section header, until scroll passes into the next connection's group. (2) The panel's filter
> changes from a regex/text match over the flat list to an expandable checkbox tree — filtering by
> kind/tag/whatever the tree's own grouping already exposes, checked rather than typed."*
>
> **The user's own words:** *"When scrolling in the connections panel, the opened db should stick to
> the top as a header untill scrolled to the next one"* and *"Connection panel filter should be with
> expandable checkboxes, not regex filters as it s now"*.
>
> **What this phase is.** One renderer-side scroll/geometry feature, and one replacement of the
> tree's persisted filter model — from ordered glob/regex show-hide rules to a set of hidden kinds
> and hidden node paths, authored by ticking boxes. The second half is the only part that reaches
> past the renderer: it changes `shared/domain`, the two `kira:filters:*` IPC payloads, the
> `connection_filters` table and its repo. No adapter, no engine, no cache, no page protocol —
> `tests/db/` is untouched end to end.
>
> **What this phase is not.** It is not a redesign of the tree's *content* (P19/P23 own the grouping
> taxonomy and this phase consumes it unchanged), and it does not touch the transient search box.
> The search box is a substring match over cached nodes (F7b) — it is neither a regex nor a filter
> in the persisted sense, SPEC §8.3 already separates the two, and the user's "not regex filters as
> it s now" names the thing that literally has a **Regex** checkbox in it: the filters dialog
> (`FiltersDialog.vue:134-137`).
>
> **Two halves, one phase, and why.** They are genuinely independent — no file is edited by both
> except `tests/ui/tree.spec.ts` and SPEC §8.3 — so §4 keeps them in two blocks that can land in
> either order. They share a phase because they share one acceptance surface (the panel, its single
> Playwright spec, and one §8.3 rewrite), and because both are gated on the same prerequisite
> cleanup: **the twenty duplicated copies of the tree's Playwright navigation helpers** (F6), which
> the sticky band makes actively unsafe and which no single-half phase would have paid to fix.

## 0. Ground rules for this phase

- **The tree stays virtualized, and nothing here may quietly un-virtualize it.** `ProjectTree.vue:167`
  renders `visibleRows` through `workbench/VirtualList.vue`; off-screen rows are not in the DOM, and
  `tests/ui/tree.spec.ts:92-94` writes that contract down. Every sticky-header design that assumes
  "the ancestor row exists somewhere above in the DOM" is therefore wrong here, including the
  obvious one (`position: sticky` on the rows themselves — D1/F2).
- **One virtualizer, widened — never a second one.** The same rule P27 D18 applied to variable row
  heights: `VirtualList.vue` gains additive props/slots that its three other call sites
  (`OperationsPanel.vue:201`, `ConsoleResultGrid.vue:146/197/210`) do not pass and do not notice.
  No copy of it lands in `project/`.
- **The filter model must be a *set*, not a program.** Today's model is an ordered rule list with
  action semantics that the dialog itself documents incorrectly (F8). The replacement must be
  something whose meaning is readable off the screen with no evaluation order in the user's head —
  that is the entire point of the ask, and the design system already wrote it down (F9).
- **The dialog may only offer what the tree already has.** Filters are evaluated in the renderer at
  render time over cached nodes (`filter.ts:30-38`'s own comment, applied at `state/tree.ts:353`);
  the checkbox tree is built from the same `treeState.children` cache the preview strip already
  reads (`FiltersDialog.vue:71-77`). No new IPC call, no fetch, no op-log row — asserted, not
  assumed (§5).
- **Nothing a user has not ticked is ever hidden.** The persisted set stores *exclusions* only
  (D10), so an object created tomorrow shows up tomorrow. Today's `show` rules can do the opposite
  (`filter.ts:43-46`: one `show` rule for a kind hides every non-matching node of that kind,
  including ones fetched later) and that behaviour leaves with them.
- **No unit-test tier.** SPEC §9 line 618 is explicit — *"No unit tests. Two suites only."* The pure
  modules this phase adds are covered through `tests/ui/`, with the geometry exposed as DOM
  attributes so a Playwright assertion can be exact rather than impressionistic (D9).
- Comments per AGENTS.md: only where the code cannot say it for itself. The band's `min(...)`
  formula (D4) and the "kept candidates are always a prefix" invariant (D3) each get one line.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every step;
  `xvfb-run -a bun run test:ui` from step 1 on. `bun run test:db` is unaffected but must still be
  green at the end. Per `AGENTS.md`, container-backed suites cannot run in Claude Code's Linux web
  container — `tests/ui/tree.spec.ts` is Postgres-backed and must be run on the macOS/Colima box
  before this phase is called done.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings (verified against the tree, not assumed)

### The panel and its list

**F1 — the panel is three components over one flat, virtualized row array.**
`workbench/panels/ProjectPanel.vue:50-55` stacks `SearchBox` over `ProjectTree`;
`ProjectTree.vue:160-179` wraps one `VirtualList` in `.tree-body[data-testid="tree-background"]`,
passing `visibleRows` and a uniform `rowHeight` computed from the density setting
(`ProjectTree.vue:41`, 22px compact / 28px comfortable — the same literal pair as
`DataGrid.vue:54`, `ConsoleResultGrid.vue:30` and `state/settings.ts:17-18`'s `--kira-row-height`).
`TreeRow.vue:76-88` renders one row, indented purely by inline `padding-left`
(`TreeRow.vue:79`: `8 + depth * 14`).

**F2 — there is no per-connection DOM container, so CSS `position: sticky` cannot express the ask.**
`searchResult` (`state/tree.ts:394-439`) pushes the connection row and then *splices its whole
subtree into the same flat array* (`:435` `rows.push(...childOut)`); `buildNodeRow`
(`:323-338`) and `buildRows` (`:376-388`) do the same at every level. `visibleRows`
(`:441`) is therefore a flat `TreeRowVm[]` whose only nesting information is the numeric `depth`
field (`state/tree.ts:11-14`). A sticky header scoped to "this connection's section" needs the
section to be a containing block; there is none, and creating one is incompatible with virtualizing
a single flat window (`VirtualList.vue:36-44` slices one contiguous index range). The design
system's own sidebar mockup *does* have `<div class="conn-group">` wrappers
(`design/…/parts/_sb_sql.html:1`), which is exactly the shape the real, virtualized tree cannot
have.

**F3 — `VirtualList` already has a sticky header region, and it is deliberately for one static
row.** `VirtualList.vue:66-72` renders an optional `#header` slot inside
`.virtual-list-header { position: sticky; top: 0; z-index: 1 }` (`:87-91`), and its comment records
the trade: *"Sticky, not fixed: it stays in normal flow (so scrollTop-based indexing below is only
off by its own height, well inside the default overscan)"*. `ConsoleResultGrid.vue:153` is the only
caller that passes it. That in-flow trade is fine for a fixed-height column header and wrong for a
band whose height changes from 0 to 3 rows *while you scroll* — it would shift every row's offset
mid-gesture and desynchronise `startIndex` from what is painted.

**F4 — `VirtualList` publishes no scroll position, and `scrollToIndex` has no notion of an
occluded top.** `scrollTop` and `viewportHeight` are private refs (`VirtualList.vue:10-11`); the
only exposed method is `scrollToIndex(index)` (`:49-59`, `defineExpose` at `:61`), which
top-aligns with `el.scrollTop = rowTop`. `ProjectTree.vue:50-59` drives it from
`treeState.pendingScrollKey`, i.e. §8.10's *Reveal in project panel*. A sticky band that overlays
the first rows makes that top-alignment land the revealed row **behind the band**.

**F5 — `TreeRow`'s testid and its roving tabindex are both hardcoded, and twenty specs select on
them.** `TreeRow.vue:80-84` emits `data-testid="tree-row"`, `data-path`, `data-kind`,
`data-status` and `:tabindex="selected ? 0 : -1"`. Every UI spec addresses rows as
`[data-testid="tree-row"][data-path="…"]` or `[data-testid="tree-row"][data-kind="connection"]`,
and `interaction.spec.ts:601` asserts a `toHaveCount` on the latter. A pinned copy of a row that
reuses that testid would break strict-mode locators app-wide and inflate that count; a second
element with `tabindex="0"` would also duplicate the tree's single tab stop.

**F6 — the tree's Playwright navigation helpers exist twenty times, in three divergent variants.**
`treeContainer` / `findRow` / `expandRow` / `openRowMenu` are redeclared in
`autocomplete, budgets, cell-editor, console, data-view, definition, interaction, kafka, leaks,
mariadb, memory, mongo, mutations, perf, redis, s3, sqs, tabs, tooltips, tree` — twenty spec files.
`tree.spec.ts:66-90` has the good version (`scrollAndSettle`, whose 10-line comment explains
exactly why the naive one is flaky under load), `budgets.spec.ts:48` has a third
(`settleScroll`), and the remaining seventeen carry a byte-identical copy that scrolls and then
`await page.waitForTimeout(30)` (e.g. `redis.spec.ts:52-70`, `perf.spec.ts:40-58`). Any change to
how a tree row is reached — which a sticky band *is*, since a row under the band cannot be clicked
— has to be made twenty times or not at all.

### The filter that exists today

**F7 — the current filter is glob-by-default with regex opt-in, scoped to three node kinds, and it
is not the search box.** `filter.ts:6-12` compiles a pattern by escaping regex metacharacters and
expanding `*`/`?` (glob); `filter.ts:20` switches to `new RegExp(rule.pattern)` when
`rule.isRegex`; `FiltersDialog.vue:134-137` is that opt-in checkbox, labelled **Regex**.
`FILTERABLE_KINDS` (`filter.ts:30`) is `{database, schema, table}` — three of the nineteen kinds in
`shared/domain/tree.ts:3-23` — and `evaluate` returns `true` unconditionally for every other kind
(`filter.ts:39`). Rules persist per connection (`connection_filters`, `0001_init.sql:27-34`) and are
evaluated in the renderer at render time (`state/tree.ts:353`).
**F7b** — the *search* box is separate and is a plain case-insensitive substring test:
`state/tree.ts:293` `node.name.toLowerCase().includes(query)`, bound to `treeState.search` by
`SearchBox.vue:10-16`, transient, never persisted, and already documented as distinct in SPEC §8.3.

**F8 — the dialog documents semantics the code does not implement.** `FiltersDialog.vue:117-120`
tells the user *"Rules run top to bottom; the last matching rule wins"*, and its inline comment
repeats it (`:114-116`). `filter.ts:38-51` does something else entirely and order-independently:
select the rules for this node's kind; if **any** `show` rule exists for that kind, drop the node
unless it matches at least one; then drop it if it matches **any** `hide` rule. Rule order is never
read. A filter model whose own dialog cannot describe it in one sentence is the strongest argument
in this plan for replacing it rather than restyling it.

**F9 — the design system already specifies the replacement, and it is checkboxes.**
`design/kira-design-system/parts/bodies/FiltersDialog.html:22-27` opens with the comment
*"Checkboxes, not rules. The old dialog asked you to compose glob/regex show-and-hide rules that ran
top to bottom with last-match-wins — you could not tell what the tree would look like without saving
and staring at it."* The body is two columns: **Object types** (`:31`, one checkbox per kind with a
count, `All`/`None` links) and **Schemas** (`:46`, one checkbox per name with a count, plus a
*"Filter schemas"* text input at `:49` whose own comment says *"Long lists get a filter of their own
rather than forcing a pattern rule"*), over a live-consequence strip: *"The tree will show 32 of 612
cached nodes"* (`:65`). The mockup predates the ask, exactly as `Documents.html` predated P27's.

**F10 — the mockup's `system` rows describe objects this app's tree never lists.** `:51-56` show
`pg_catalog`, `information_schema` and `pg_toast` with a muted `system` badge. The Postgres adapter
excludes them at the catalog query (`postgres/catalog.ts:52`: `WHERE nspname NOT IN ('pg_catalog',
'information_schema')`) and MariaDB does the same for four schemas (`mariadb/catalog.ts:18,27`). So
there is nothing to badge, and no "hide system objects" preset to build.

**F11 — the filter's plumbing is small and entirely mechanical.** `treeState.filters` is the only
consumer (`state/tree.ts:52`, loaded once per connection inside `expand()` at `:142` via
`loadFilters` `:107-110`, written by `saveFilters` `:112-117`, purged by `dropConnectionState`
`:232` and enumerated by `knownConnectionIds` `:253`). Below it: `control.filtersList/filtersReplace`
(`bridge/control.ts:110-115`), `IPC.filtersList/filtersReplace` (`shared/protocol/ipc.ts:60-61`,
typed at `:182-186`), `preload/index.ts:159-162`, `main/ipc/filters.ts:15-21`, and
`storage/repos/filters.ts`'s `listFilters`/`replaceFilters` (a delete-all-then-insert whose own
comment notes the set is small enough not to diff). Nothing else in the app imports `./filter` or
reads `treeState.filters`.

**F12 — the taxonomy the checkboxes need already exists, except for its labels.**
`grouping.ts:10-25`'s `GROUPED_KINDS` carries a curated label per foldered kind (with MariaDB's
`function` → *"Routines"* override at `:20`), and `labelForGroup` (`:29-32`) resolves it per
connection kind — but only for the five foldered kinds. `table`, `collection`, `topic`, `queue`,
`key`, `object`, `database`, `schema`, `namespace`, `prefix`, `bucket` have no display label
anywhere; `FiltersDialog.vue:17-21` hardcodes its own three-entry `NODE_KIND_LABEL` map instead.
`isLeafKind` (`grouping.ts:63-65`) already names the kinds that never expand.

**F13 — there is no tag concept in the app.** `shared/domain/connection.ts` gives a connection a
`kind` and a `color` (`:4-12`, `:26-40`) and nothing else; `grep -rn "\btag\b" src/shared/domain`
matches only SQL dollar-quoting in `sql-lint.ts`/`sql-split.ts`. The §10 row's *"kind/tag/whatever
the tree's own grouping already exposes"* therefore resolves to exactly two axes: **node kind** and
**node identity (path)**.

**F14 — the panel head has no Filters button; the mockup's does.**
`ProjectPanel.vue:39-49` renders only *Connections* and the `add-connection` button. The dialog is
reachable solely from a row's context menu (`menus.ts:189-192` on a connection row, `:279-282` on a
database/schema row), and `tree.spec.ts:268-291` pins the exact menu item lists that contain
`filters`. The mockup's head (`design/…/parts/_sb_head.html:5`) has a filter icon button beside the
plus.

### Tests

**F15 — `tests/ui/tree.spec.ts:412-431` is the filter's only coverage, and it drives the rule UI by
CSS class.** It opens the dialog from the connection menu, clicks `.add-rule`, takes
`.rule-row:last`, sets the kind `<select>`, fills `.pattern-input` with `analytics`, saves, then
asserts (a) the `analytics` schema row is gone, (b) **no new op-log rows** were produced, and (c)
the hide survives `relaunch()`. All three assertions stay meaningful under the new model; the six
lines that author the rule do not. The same file's search coverage (`:400-410`) and its exact
context-menu id lists (`:268-291`, which include `filters`) must keep passing unchanged.

## 2. Shapes introduced in this plan

```ts
// src/renderer/project/stickyBand.ts — NEW. Pure geometry for the pinned ancestor band: which rows
// are stuck, and where each one sits. DOM-free and Vue-free on purpose — its inputs are the flat
// row array the tree already builds (F2), the scroll offset VirtualList now publishes (D2), and the
// row height ProjectTree already computes (ProjectTree.vue:41).

/** All the band needs from a row. TreeRowVm satisfies it structurally. */
export interface StickyRowLike {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export interface StickySlot<T> {
  row: T;
  /** Index in the flat row array — the band's rows are real rows, not synthesized ones. */
  index: number;
  /** Offset from the top of the scrollport, in px. Negative while a header is being pushed out
   *  by the next section (D4). */
  top: number;
}

/** Connection + database + schema. Deeper ancestors (a group folder, P19) are not worth a third
 *  of a narrow panel; the outermost levels are the ones that answer "where am I" (D5). */
export const STICKY_MAX_ROWS = 3;

export function stickyBand<T extends StickyRowLike>(
  rows: readonly T[],
  scrollTop: number,
  rowHeight: number,
  maxRows?: number,
): StickySlot<T>[];

/** How much room a reveal must leave above `index` so the row does not land behind the band —
 *  `min(depth, maxRows) * rowHeight`, since a row at depth d has exactly d ancestors in the flat
 *  list (D6). */
export function stickyInsetFor(
  rows: readonly StickyRowLike[],
  index: number,
  rowHeight: number,
  maxRows?: number,
): number;
```

```ts
// src/renderer/workbench/VirtualList.vue — additive only (D2). The three existing call sites pass
// none of this and behave byte-for-byte as they do today.
//
// emits:  'scrollstate': [{ scrollTop: number; viewportHeight: number }]
//           -- fired immediately on mount and whenever either value changes.
// slots:  #sticky   -- rendered into `.virtual-list-sticky` (position: sticky; top: 0; height: 0;
//                      z-index: 2), a zero-height overlay inside the scroll container's content
//                      box, so it never occupies flow (F3) and never covers the scrollbar.
// exposed: scrollToIndex(index: number, inset?: number)
//           -- `inset` px are kept clear above the row when it is top-aligned (F4).
```

```vue
<!-- src/renderer/project/TreeRow.vue — one additive prop (D7). -->
<!-- props: { row: TreeRowVm; selected: boolean; sticky?: boolean } -->
<!-- sticky === true  =>  data-testid="tree-sticky-row", tabindex="-1", and a `data-depth`
     attribute for §5's geometry assertions. Every emit, every child element, the colour rail
     (TreeRow.vue:89) and the twisty behave identically. -->
```

```ts
// src/shared/domain/tree-filter.ts — NEW, replaces connection-filter.ts (D11/D12).

/** One connection's tree filter, as a set of exclusions. Everything not named here is visible,
 *  including objects fetched for the first time after this was saved (D10). */
export const treeVisibilitySchema = z.object({
  hiddenKinds: z.array(nodeKindSchema),
  /** Encoded node paths, relative to the connection — the same strings `TreeNode.path` and
   *  `rowKey()` already use. A hidden container hides its subtree implicitly, because its row is
   *  never rendered and its children are never walked (D13). */
  hiddenPaths: z.array(z.string()),
});
export type TreeVisibility = z.infer<typeof treeVisibilitySchema>;

export const EMPTY_VISIBILITY: TreeVisibility;
```

```ts
// src/renderer/project/filter.ts — REWRITTEN. 52 lines of regex compilation and cache (F7) become
// two set lookups. No compiled-pattern cache, no glob translation, no FILTERABLE_KINDS gate.

export interface VisibilitySets {
  kinds: ReadonlySet<NodeKind>;
  paths: ReadonlySet<string>;
}
export function toSets(v: TreeVisibility): VisibilitySets;
export function isVisible(node: TreeNode, sets: VisibilitySets): boolean;
```

```ts
// src/renderer/project/filterTree.ts — NEW. The dialog's model, derived from the same
// treeState.children cache the tree renders from — no IPC, no fetch (§0, F9's "cached nodes").

export interface FilterKindRow {
  kind: NodeKind;
  label: string;      // labelForKind(), plural (D14)
  count: number;      // cached nodes of this kind under this connection
  hidden: boolean;
}

/** One row of the expandable object tree. Flat + `depth`, the same shape the real tree uses
 *  (F1) — so the dialog needs no recursive component and no second indentation convention. */
export interface FilterNodeRow {
  path: string;
  name: string;
  kind: NodeKind;
  depth: number;
  hasChildren: boolean;
  childCount: number;                 // cached children, shown as the trailing count
  state: 'on' | 'off' | 'partial';    // 'partial' => visible, but something under it is hidden
  /** True when this node is already hidden by its *kind*: the checkbox is disabled and says so,
   *  rather than silently disagreeing with the tree (D16). */
  kindHidden: boolean;
}

export function kindRows(connectionId: string, v: TreeVisibility): FilterKindRow[];

export function nodeRows(
  connectionId: string,
  v: TreeVisibility,
  expandedPaths: ReadonlySet<string>,
  nameFilter: string,
): FilterNodeRow[];

/** The mockup's live-consequence strip (F9:65): nodes the tree will show, of nodes cached. */
export function previewCounts(
  connectionId: string,
  v: TreeVisibility,
): { shown: number; total: number };

/** Ticking/unticking one node, returning the next set — hiding a container drops the now-redundant
 *  entries beneath it, so the persisted set stays minimal (D15). */
export function toggleNode(v: TreeVisibility, row: FilterNodeRow): TreeVisibility;
export function toggleKind(v: TreeVisibility, kind: NodeKind): TreeVisibility;
```

```ts
// src/renderer/project/grouping.ts — one addition, and GROUPED_KINDS is rewired onto it (D14).

/** The display label for any node kind, per connection kind. Plural for a folder or a checkbox
 *  row ("Views"), singular where a single object is named. The one place a kind gets a human
 *  name — GROUPED_KINDS' own labels now derive from it rather than duplicating it. */
export function labelForKind(
  kind: NodeKind,
  connectionKind: ConnectionKind,
  form?: 'singular' | 'plural',
): string;
```

```sql
-- src/main/storage/migrations/0005_p28_tree_filters.sql — the set that replaces the rule list
-- (D12). No synthetic id and no ordering: a set has neither, and the ordering the old table
-- carried was never read (F8).
CREATE TABLE connection_tree_filters (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,           -- 'kind' | 'path'
  value         TEXT NOT NULL,
  PRIMARY KEY (connection_id, scope, value)
);
DROP TABLE connection_filters;
```

## 3. Decisions

### Topic A — the sticky ancestor band

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The band is a JS-computed overlay of real rows, not CSS `position: sticky` on the rows themselves.** | F2: the rendered list is one flat array of siblings inside one scroll container, so a `position: sticky` row would stick until the *whole list* ends, not until its section does — and F1's virtualization means the ancestor is usually not in the DOM at all to stick with. Nesting the DOM per section (the mockup's `conn-group`, `_sb_sql.html:1`) is the only way CSS alone could do it, and it is incompatible with virtualizing a single contiguous window. Every desktop implementation of this feature (VS Code's sticky scroll, iOS section headers) computes the band for the same reason. |
| D2 | **`VirtualList` gains exactly two additive things: a `scrollstate` emit and a zero-height `#sticky` overlay slot.** The band's *content and geometry* are decided by `ProjectTree`, which is the only component that understands `depth`. | The scroll offset lives in `VirtualList` (`:10-11`) and the row semantics live in `ProjectTree`; splitting on that line keeps `VirtualList` generic (it never learns what an ancestor is) and keeps the tree's knowledge out of the workbench. Zero-height is what makes it an overlay rather than F3's in-flow header: it contributes no layout, so `startIndex`/`topSpacer` (`:27-44`) keep their meaning exactly, and being *inside* the scroll container's content box means it spans the rows and stops short of the scrollbar. |
| D3 | **The band's candidates are the anchor row's ancestors, plus the anchor itself when it is an expanded parent; a candidate is rendered only while its real row has passed above its slot, and the kept candidates are always a prefix.** Anchor = `clamp(floor(scrollTop / rowHeight), 0, n-1)`. | Including the anchor itself is what removes the visible jump: without it, a connection row scrolled 20px up would slide away and then snap back into the band when the *next* row became the anchor. The "only once it has passed its slot" test is CSS-sticky's own semantics, and it is what keeps a row from being drawn twice — once in place and once pinned. The prefix property is not an assumption: ancestor indices strictly increase, so `naturalTop` grows by at least one row height per level while the slot grows by exactly one, and once a candidate fails the test every deeper one fails too. |
| D4 | **Slot `k` of an `L`-row band sits at `top = min(k·H, boundaryY(k) − (L−k)·H)`**, where `boundaryY(k)` is the viewport offset of the first row after the candidate's subtree (`depth <= candidate.depth`), and the band is rendered with per-row `top`, not one container transform. | This is the "until scrolled to the next one" half of the ask, and the formula is what makes the handoff correct at *every* level. At an inner boundary (one schema's tables ending) only the innermost term binds, so only that header slides up. At a shared boundary (a connection's last schema is also the connection's end) all the terms bind at once and resolve to a stack sitting immediately above the boundary, one row height apart — the whole band slides out together and the next connection's header takes the slot. A single container transform gets the second case right and the first case wrong (it would drag the connection header up at every schema boundary). |
| D5 | **The band is capped at `STICKY_MAX_ROWS = 3`, outermost first, and further clamped to `floor(viewportHeight / rowHeight) − 2` rows.** | Three is the chain that answers the question the ask asks — connection, database, schema — and it is where the value stops: the fourth level is a P19 group folder ("Tables"), whose label is already implied by the rows beneath it. 3 × 28px = 84px of a full-height sidebar is acceptable; the viewport clamp is what keeps that true in a deliberately shrunken window, and it is why `scrollstate` carries `viewportHeight` and not just `scrollTop`. |
| D6 | **`scrollToIndex` takes an optional `inset`, and `ProjectTree`'s reveal watcher passes `stickyInsetFor(...)`.** | F4: without it, §8.10's *Reveal in project panel* would top-align the revealed row into the exact strip the band covers, i.e. reveal it invisibly. The inset is `min(depth, cap) · rowHeight` — exact, because in this tree a row at depth *d* has exactly *d* ancestors present in the flat list, so no scroll-and-remeasure pass is needed. |
| D7 | **A pinned row is a `TreeRow` with `sticky: true`: `data-testid="tree-sticky-row"`, `tabindex="-1"`, everything else identical — including the colour rail, the twisty, and all four emits.** | F5 is the hard constraint: reusing `tree-row` would double every `[data-testid="tree-row"][data-path=…]` locator in twenty specs and inflate `interaction.spec.ts:601`'s count. Everything else being identical is deliberate: a pinned header the user cannot click, collapse or right-click is a decoration, and the alternative (a bespoke "breadcrumb" component) would be a second renderer for a row that already has one. Forcing `tabindex="-1"` keeps the tree's single roving tab stop single. |
| D8 | **The band is interactive, therefore it occludes the rows under it — and the twenty Playwright helpers are unified into `tests/ui/support/tree.ts` first, so that becomes one fact in one file.** The shared `findRow` scrolls a located row clear of `[data-testid="tree-sticky-band"]`'s measured height before returning it. | This is the consequence D7 buys, and it is not optional: Playwright's actionability check fails a click whose hit-test lands on the band, and it will not resolve itself by retrying (the row is already inside the scrollport, so `scrollIntoViewIfNeeded` is a no-op). Fixing that in twenty places is not a plan; extracting the helper is, and it pays for itself independently — seventeen of the twenty copies still use the naive `waitForTimeout(30)` that `tree.spec.ts:56-65`'s own comment documents as the flaky one (F6). Same argument P24 D30 made when it collapsed four hand-rolled page-size pickers into one. |
| D9 | **The band's geometry is asserted through the DOM: the band carries `data-testid="tree-sticky-band"`, each slot carries `data-path`, `data-depth` and its resolved `top`.** No unit spec is added. | SPEC §9 line 618 forbids a unit tier outright, and this phase does not get to relitigate that. Exposing the numbers the pure function produced is what lets a Playwright scenario assert the handoff exactly (§5) instead of screenshotting and hoping. |

### Topic B — the checkbox filter

| # | Decision | Rationale |
|---|----------|-----------|
| D10 | **The persisted model is a set of exclusions — `{ hiddenKinds, hiddenPaths }` — not a rule list, not an allowlist.** | Exclusions are the only model where a box that is *not* ticked has no consequence, which is what makes "everything you have not touched is visible, including objects created tomorrow" true. Today's `show` rules do the reverse (`filter.ts:43-46`), and that surprise — one `show` rule silently hiding every future table of that kind — is unrepresentable here. It also keeps the stored set proportional to what the user actually clicked rather than to the size of the database. |
| D11 | **A checkbox hides a node by its *path*, not its name.** | The dialog shows a tree; a name-based hide would fire on the `public` schema of every database when the user unticked one of them, which is visibly not what they clicked. Paths are already the tree's identity everywhere (`TreeNode.path`, `rowKey()`, `treeState.expanded`), so this needs no new key and no new escaping — and unlike a glob it cannot be confused by an object whose name legitimately contains `*` or `?` (a Mongo collection or an S3 prefix can). |
| D12 | **`connection_filters` is replaced by `connection_tree_filters (connection_id, scope, value)` in migration `0005`, and existing rows are dropped, not migrated.** | A pattern is a matcher over names; a checkbox entry is an identity. There is no honest conversion between them without resolving every pattern against a tree the migration cannot see. v1 has not shipped (`package.json` `"version": "0.1.0"`, one feature branch for all of v1 per AGENTS.md), the data is a per-connection view preference, and the alternative — keeping the pattern evaluator alive beside the set so old rows still apply — would ship exactly the two-filter-systems outcome this phase exists to end. Reusing the old table by stuffing a path into a column named `pattern` beside a meaningless `is_regex` was rejected for the same reason: the column names would lie. |
| D13 | **Hiding a container hides its subtree implicitly; no descendant entries are written.** | `buildRows` only walks the children of rows it emits (`state/tree.ts:307-318`), so a hidden node's subtree is never reached — the containment is a property of the renderer, not something the model has to encode. Writing descendants would make the set unbounded for no behavioural gain. |
| D14 | **`grouping.ts` gains `labelForKind(kind, connectionKind, form)` and becomes the single source of kind labels; `GROUPED_KINDS`' own labels derive from it.** | F12: the app currently knows how to name five kinds, in a table that also encodes folder order, plus a hardcoded three-entry map inside the dialog (`FiltersDialog.vue:17-21`). The checkbox list needs a name for every kind present. One function, consumed by the folders and the dialog alike, is the P27-D26 rule applied to labels: the second consumer is what forces the extraction, and MariaDB's `function` → *"Routines"* override (`grouping.ts:20`) is precisely the per-connection-kind case that must not be duplicated. |
| D15 | **Unticking a container removes every now-redundant hidden path beneath it; re-ticking it restores the whole subtree.** | Keeps the set minimal (D10) and, more importantly, keeps it *legible*: a tri-state parent whose children secretly remember an older selection is the classic checkbox-tree trap, where re-ticking a box does not restore what you saw a moment ago. |
| D16 | **Kind and object are two controls over one model, and where they collide the dialog says so:** a node whose kind is hidden renders with a disabled, unticked checkbox and a tooltip naming the type filter that is hiding it. | Both axes are real (F13 gives exactly these two) and they genuinely overlap. The alternative — silently unticking the node rows when a kind is hidden — would write path entries the user never asked for and would not survive re-ticking the kind. P22's tooltip machinery exists so a disabled control can explain itself. |
| D17 | **The dialog is one scrollable body with two sections — *Object types* (flat) then *Objects* (expandable, flat-plus-`depth`, with its own name filter) — rather than the mockup's two side-by-side columns.** | The mockup's right-hand column is *Schemas*, a single level; the real tree has databases above schemas (Postgres, MariaDB, Mongo) and namespaces/prefixes below (Redis, S3), so a one-level column cannot address a node in the general case. Stacking and indenting is also literally what the user asked for — *"expandable checkboxes"* — and it lets the dialog reuse the tree's own flat-plus-`depth` rendering convention (F1) instead of inventing a second one. Everything else in the mockup is kept: the per-row counts, the `All`/`None` links, the name filter over the long list (`FiltersDialog.html:49`) and the live-consequence strip (`:65`). |
| D18 | **The object tree lists leaf objects too (tables, views, collections, topics), not just containers** — with a per-level cap of 500 listed rows and a *"showing 500 of N — type to narrow"* note, and `All`/`None` acting on the listed subset only. | Dropping per-object hiding would be a real capability regression against today's `hide table pg_*` rule, and it would make "expandable" stop one level short of where a user expects to land. The cap is what keeps a Redis namespace with 20 000 cached keys from rendering 20 000 rows; the name filter above it is the intended way through such a level, exactly as the mockup's comment says. |
| D19 | **The transient search box is untouched.** | F7b: it is a substring match, not a regex, it is documented as a different thing in §8.3, and it is the only way to find a node whose ancestors are collapsed. The ask names the dialog with the **Regex** checkbox in it. |
| D20 | **The dialog stays a per-connection dialog reached from the row context menu (`menus.ts:189-192`, `:279-282`), and gains one thing: it opens focused on the row it was invoked from** — that node's ancestors pre-expanded and the row scrolled into view. | Filters are per-connection state (`connection_filters.connection_id`), so a panel-head button would have to pick a connection out of many (F14 — deferred, §6). Meanwhile the *Filters…* item on a schema row currently opens a dialog with no relationship to that schema, which is the smallest possible fix with the largest ratio of usefulness to diff. `tree.spec.ts:268-291`'s menu-id lists stay valid because no item is added or removed. |
| D21 | **The dialog offers only cached nodes, and says so** — reusing the search-incomplete wording (`ProjectTree.vue:180-186`: *"expand more of the tree to include it"*). | The tree itself is lazy (§7 L1) and the filter is evaluated over cached nodes at render time; a dialog that pretended otherwise would have to fetch a whole database's catalog to draw a checkbox list, which is the one thing §8.3 promises the panel never does. Saying it out loud is the same honesty P24 D-series applied to empty states. |
| D22 | **Saving still writes the whole set in one `filtersReplace` round trip, and the channel names (`kira:filters:list` / `:replace`) do not change — only their payloads.** | `replaceFilters`' delete-then-insert is already whole-set (`storage/repos/filters.ts`'s own comment) and the set is small. Renaming the channels would touch protocol, preload, bridge and main for zero behavioural gain; the domain concept — *this connection's tree filter* — is unchanged, and `saved filters` already lives on `kira:queries:*`, so nothing collides. |

### Topic C — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D23 | **No change to the tree's fetching, caching, op-log behaviour or `TreeNode` shape.** Both halves are pure renderer work over data that is already there, plus one storage table swap. | It is what makes `tests/db/` untouched and lets `tree.spec.ts`'s "zero new op rows" assertions (`:243-248`, `:425`) stay exactly as they are — they become the guard that this phase added no round trip. |
| D24 | **`ProjectTree.vue`'s density literal is left alone.** | The `rowDensity === 'compact' ? 22 : 28` pair is duplicated four times (F1) and the band adds no fifth copy — it reads the same computed. Collapsing the existing four is a separate, unrelated cleanup and is not smuggled in here. |
| D25 | **SPEC.md is edited by the implementing session, not by this plan**: §8.3's *Search box* / *Filters* bullets rewritten (sticky ancestor headers; filters as a checkbox set over kinds and objects, no patterns, exclusions only), §9.2's coverage list gains the sticky band, §11's `project/` line gains `stickyBand.ts` and `filterTree.ts`. The §10 phasing row for P28 is updated **only once the phase is implemented**. | Standing practice (P27 D34, P24 D41, P22 D11). The phasing table records what shipped. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and
`bun run build` green, with `xvfb-run -a bun run test:ui` green from step 1 onward. Steps 1–4 are
the sticky band, 5–8 the filter, 9 the docs. The two blocks are independent and may be swapped;
within a block the order is load-bearing.

1. **`test(ui): share the project-tree navigation helpers`** — new `tests/ui/support/tree.ts`
   exporting `treeContainer`, `scrollAndSettle`, `findRow`, `expandRow`, `openRowMenu` and
   `connectionRow`, seeded from `tree.spec.ts:53-135`'s scroll-settling variants (the good ones).
   All twenty specs of F6 drop their local copies and import instead; `budgets.spec.ts`'s
   `settleScroll` and `console`/`definition`'s own `scrollAndSettle` go with them. No app change —
   the whole UI suite must pass unchanged, which is this step's acceptance criterion (D8).
2. **`feat(workbench): publish scroll state and a sticky overlay slot from VirtualList`** — the
   `scrollstate` emit (immediate on mount), the zero-height `.virtual-list-sticky` region behind a
   `#sticky` slot, and `scrollToIndex(index, inset)`. The three existing call sites are untouched
   and are the regression guard (D2).
3. **`feat(project): pin the tree's ancestor chain while scrolling`** — `project/stickyBand.ts`
   (`stickyBand`, `stickyInsetFor`), `ProjectTree.vue` rendering the band into `#sticky` and wiring
   the existing `onSelect`/`onToggle`/`onOpen`/`onContextMenu` handlers to it, `TreeRow.vue`'s
   `sticky` prop, and the reveal watcher passing the inset. **`tests/ui/support/tree.ts` gains its
   band-clearing scroll in this same commit** — the band exists from here on, so the helper cannot
   lag it by even one commit (D1, D3–D8).
4. **`test(ui): cover the tree's sticky headers`** — §5's sticky scenarios in `tree.spec.ts`,
   including the two-connection handoff (D9).
5. **`refactor(project): one label source for every node kind`** — `grouping.ts`'s `labelForKind`,
   with `GROUPED_KINDS` labels and `labelForGroup` derived from it. Pure refactor; the folder labels
   `tree.spec.ts:226-239` asserts must not move (D14).
6. **`feat(project): filter the tree with checkboxes instead of pattern rules`** — the vertical
   slice, deliberately one commit because the model and its only UI cannot compile apart:
   `shared/domain/tree-filter.ts` (replacing `connection-filter.ts`), migration
   `0005_p28_tree_filters.sql` + `migrations/index.ts` + `schema/connection-tree-filters.ts` +
   `storage/repos/filters.ts`, `main/ipc/filters.ts`, `shared/protocol/ipc.ts`,
   `preload/index.ts`, `bridge/control.ts`, `project/filter.ts` (rewritten), `project/state/tree.ts`
   (`filters` → `visibility`), `project/filterTree.ts`, and `FiltersDialog.vue` rewritten as the two
   checkbox sections (D10–D19, D21, D22).
7. **`feat(project): open the tree filters focused on the row they were invoked from`** —
   `openFiltersDialog(connectionId, focusPath?)`, `menus.ts`'s two call sites, and the dialog
   pre-expanding that path (D20).
8. **`test(ui): cover the checkbox tree filter`** — §5's rewrite of `tree.spec.ts:412-431` plus the
   new kind/tri-state/name-filter scenarios.
9. **`docs: SPEC.md §8.3/§9.2/§11 for P28`** — D25's edits (not the phasing row), and this plan's
   own commit if it is not already landed.

## 5. Tests

### Existing specs that must change

| Spec | Why | Change |
|---|---|---|
| all twenty of F6 | Step 1 extracts their shared helpers; step 3 makes reaching a row band-aware. | Delete the local `treeContainer`/`findRow`/`expandRow`/`openRowMenu`/`scrollAndSettle`/`settleScroll` definitions, import from `tests/ui/support/tree.ts`. No assertion in any of them changes — that is the acceptance criterion for step 1. |
| `tests/ui/tree.spec.ts:412-431` | The rule-authoring UI it drives (`.add-rule`, `.rule-row`, `.pattern-input`) no longer exists (D10/D17). | Rewritten to tick boxes (below). The three assertions it makes — the `analytics` row disappears, **no new op-log rows**, the hide survives `relaunch()` — are kept verbatim as the new scenario's assertions. |
| `tests/ui/tree.spec.ts:268-291` | D20 changes what *Filters…* opens *to*, not whether it exists. | **No change** — the exact menu-id lists must still match, and they are the guard that D20 added no menu item. |
| `tests/ui/tree.spec.ts:400-410` | Search is untouched (D19). | **No change** — the guard that the filter rewrite did not disturb the substring search or the incomplete note. |
| `tests/ui/interaction.spec.ts:601` | Counts `[data-testid="tree-row"][data-kind="connection"]`; a pinned copy under the same testid would inflate it. | **No change** — with D7's separate testid it must still read the same number, which is exactly why it is worth naming here. |
| `tests/ui/tooltips.spec.ts:139-185` | Hovers a connection row and asserts one app-owned tooltip. | **No change**; re-run as the guard that a pinned duplicate of a hovered row does not produce a second tooltip. |
| `tests/ui/budgets.spec.ts:327-332`, `tests/ui/perf.spec.ts` | Frame budgets while scrolling the tree; the band now recomputes on every scroll event. | **No source change**, but both must be re-run and shown green — a regression here would mean the band is doing more per frame than the O(depth) walk D3 specifies. |

### New coverage — sticky headers (`tests/ui/tree.spec.ts`, in the existing test)

The spec already builds a Postgres connection with `kira_test` → `app`/`analytics` and enough
tables to overflow the panel; a second connection against the same container is created through
`connectionsCreate` (the pattern `mutations.spec.ts:263-269` already uses) for the handoff case.

- **Nothing is pinned at the top of the list** (D3): with `scrollTop === 0`,
  `[data-testid="tree-sticky-band"]` has zero `tree-sticky-row` children.
- **The connection and database pin as soon as they leave** (D3/D5): scroll so a table row is the
  first row; assert exactly three `tree-sticky-row`s whose `data-path` are ``, `database:kira_test`
  and `database:kira_test/schema:app`, in that order, with `data-depth` 0/1/2 and `top` 0/H/2H.
- **The band never exceeds the cap** (D5): expand the *Sequences* folder (depth 3) and scroll into
  it; assert the band is still three rows and that the group folder is **not** among them.
- **The handoff** (D4, the "until scrolled to the next one" clause): with two connections both
  expanded, scroll until the second connection's row enters the band region; assert that the first
  connection's slot reports a negative `top` before it disappears, and that once it does, the band's
  first row is the second connection.
- **A pinned row is a real row** (D7): click the pinned schema's twisty — the schema collapses and
  the band shrinks to two rows; right-click the pinned connection — the context menu opens with the
  connection's own item list; assert the pinned connection row carries the colour rail
  (`.p-tree-rail`).
- **The band does not duplicate anything the specs count** (D7/F5): with the band showing three
  rows, `[data-testid="tree-row"][data-kind="connection"]` still has exactly the connection count,
  and `[data-testid="tree-sticky-row"][tabindex="0"]` has zero matches.
- **Reveal lands below the band** (D6): open a deep table in a tab, run *Reveal in project panel*
  from the tab menu, and assert the revealed `tree-row`'s bounding box top is **≥** the band's
  bottom.
- **A row under the band is still reachable** (D8): the shared `findRow` returns a row clear of the
  band — asserted by calling it for a row that would otherwise land at offset 0 and then clicking
  it without a retry.

### New coverage — the checkbox filter (`tests/ui/tree.spec.ts`, replacing `:412-431`)

- **Unticking one schema hides exactly it, costs no query, and survives a relaunch** (D10/D11/D23):
  open *Filters…* from the connection row, expand `kira_test` in the *Objects* section, untick
  `analytics`, save. Assert the `analytics` row is gone, `app` is still there, `getOps()` is
  unchanged, and after `relaunch()` it is still gone. (The three assertions inherited from
  `:424-431`.)
- **Unticking a type hides every object of that kind, and its P19 folder with it** (D10/D14): untick
  *Sequences* in *Object types*; assert both `${APP_PATH}#sequence` and `SEQUENCE_PATH` have zero
  rows, while *Views* and *Functions* folders remain.
- **A node hidden by its kind says so rather than silently unticking** (D16): with *Sequences*
  hidden, the sequence's own row in the *Objects* section is unticked, `disabled`, and carries a
  non-empty `data-kira-tip`.
- **Tri-state** (D15): untick both schemas of `kira_test`; assert the database row reports
  `data-state="partial"`. Tick the database row; assert both schemas come back and the persisted
  set is empty (both rows `data-state="on"`).
- **The name filter is a substring, not a pattern** (D17/D19): type `analyt` into the Objects
  section's filter and assert only the matching row and its ancestors are listed; type `.*` and
  assert **zero** rows — the visible proof that no pattern language is left in this dialog.
- **The live consequence strip counts what the tree will show** (D17): assert it reads *"will show N
  of M"* with the same N the tree renders after saving.
- **The dialog opens focused on the invoking row** (D20): open *Filters…* from the `app` schema's
  context menu; assert the `app` row is listed and scrolled into view with its ancestors expanded.
- **The dialog issues no query** (D21/D23): `getOps()` around opening, expanding two levels inside
  the dialog, and cancelling is unchanged; the cached-only note is visible.
- **Cancel discards** (baseline parity): untick a schema, press Cancel, assert the tree is unchanged
  and reopening the dialog shows the box still ticked.

**No new spec file, and no new fixture.** Everything above runs inside `tree.spec.ts`'s existing
Postgres connection and seed; the second connection is created through the same IPC call the spec
already uses for the first.

## 6. Explicitly out of scope

- **A Filters button in the panel head** (F14, the mockup's `_sb_head.html:5`). Filters are
  per-connection; a head button needs a rule for which connection it targets when several are
  present, and every answer (the selected row's, the only one, a picker inside the dialog) is a
  product decision the ask does not make. D20's focused-open covers the same reachability complaint
  from the entry point that already exists. Open question 3.
- **Sticky headers anywhere else** — the grid's row groups, the operations panel, the console result
  list. `VirtualList`'s new slot makes them possible; none of them is asked for, and each would need
  its own notion of a section.
- **A configurable sticky depth in Settings → Appearance.** D5 fixes it at three; a setting is a
  second thing to test and migrate for a number nobody has yet complained about. Open question 1.
- **Collapsing the four copies of the `22 : 28` density literal** (D24) — a real cleanup, unrelated
  to this ask, and it would touch the grid and console on a branch where other phases are landing.
- **Restoring system schemas to the tree so they can be filtered out** (F10). They are excluded at
  the adapter (`postgres/catalog.ts:52`, `mariadb/catalog.ts:18`); making them visible-but-filtered
  is an adapter change with its own performance and correctness questions.
- **Migrating existing glob/regex rules into checkbox selections** (D12). There is no honest
  conversion, and the compatibility shim to keep both alive is the outcome the phase exists to
  avoid.
- **Filtering by connection, colour or tag.** F13: no tag concept exists, and a per-connection
  dialog cannot meaningfully filter *by* connection. Hiding a whole connection is what collapsing
  or deleting it is for.
- **Persisting which nodes are expanded inside the filters dialog.** It is a transient authoring
  aid, keyed to a dialog session, and persisting it would put an unbounded path set into storage for
  no user-visible gain (the same call P27 D4 made for nested document expansion).
- **A unit-test tier for `stickyBand.ts` / `filterTree.ts`.** SPEC §9 line 618. D9 covers them
  through the UI suite instead.
- **`docs/v1/design/kira-design-system/`.** Compared against, never edited.

## 7. Target tree at the end of P28

```
src/renderer/
  workbench/
    VirtualList.vue                 MOD  + scrollstate emit, + zero-height #sticky overlay slot,
                                         + scrollToIndex(index, inset) (D2/D6)
    panels/ProjectPanel.vue          --  UNCHANGED (no head button — §6)
  project/
    stickyBand.ts                   NEW  pure band geometry: candidates, slots, handoff, inset
                                         (D1/D3/D4/D5/D6)
    ProjectTree.vue                 MOD  renders the band into #sticky, reuses its own row
                                         handlers, passes the reveal inset (D3/D7)
    TreeRow.vue                     MOD  + sticky prop -> tree-sticky-row testid, tabindex -1,
                                         data-depth (D7)
    filter.ts                       MOD  rewritten: two set lookups, no regex, no glob, no
                                         FILTERABLE_KINDS (D10/D11)
    filterTree.ts                   NEW  the dialog's model over treeState.children: kind rows,
                                         node rows, tri-state, counts, toggles (D15-D18, D21)
    FiltersDialog.vue               MOD  rewritten: Object types + expandable Objects, counts,
                                         All/None, name filter, consequence strip (D17)
    grouping.ts                     MOD  + labelForKind(); GROUPED_KINDS labels derive from it
                                         (D14)
    state/tree.ts                   MOD  filters -> visibility (load/save/purge/enumerate), the
                                         evaluate() call site, openFiltersDialog(focusPath) (D20)
    menus.ts                        MOD  two Filters… call sites pass the row's path (D20)
    SearchBox.vue                    --  UNCHANGED (D19)
  bridge/control.ts                 MOD  filtersList/filtersReplace payload types (D22)
src/shared/
  domain/tree-filter.ts             NEW  treeVisibilitySchema, EMPTY_VISIBILITY (D10)
  domain/connection-filter.ts       DEL  replaced by the above (D12)
  domain/tree.ts                     --  UNCHANGED (D23)
  protocol/ipc.ts                   MOD  the two filters signatures; channel names unchanged (D22)
src/preload/index.ts                MOD  the two filters signatures (D22)
src/main/
  ipc/filters.ts                    MOD  parses TreeVisibility instead of a rule array
  storage/schema/connection-tree-filters.ts  NEW  (connection_id, scope, value), composite PK
  storage/schema/connection-filters.ts       DEL  (D12)
  storage/repos/filters.ts          MOD  set <-> rows, whole-set replace kept (D22)
  storage/migrations/0005_p28_tree_filters.sql  NEW  create the set table, drop the rule table
  storage/migrations/index.ts       MOD  + version 5
src/engine/                          --  UNTOUCHED (D23)
tests/
  ui/support/tree.ts                NEW  the one copy of treeContainer/scrollAndSettle/findRow/
                                         expandRow/openRowMenu/connectionRow, band-aware (D8)
  ui/tree.spec.ts                   MOD  filter scenario rewritten; sticky scenarios added (§5)
  ui/{autocomplete,budgets,cell-editor,console,data-view,definition,interaction,kafka,leaks,
      mariadb,memory,mongo,mutations,perf,redis,s3,sqs,tabs,tooltips}.spec.ts
                                    MOD  local helper copies deleted, import support/tree (§5)
  db/**                              --  UNTOUCHED (D23)
docs/
  v1/SPEC.md                        MOD  §8.3, §9.2, §11 (D25) — phasing row once implemented
  v1/plans/P28-connections-panel-sticky-checkbox.md   NEW  this document
```

## 8. Acceptance checklist

**Sticky headers**

- [ ] Scrolling the panel pins the current connection, database and schema rows at the top, in that
      order, and unpins them when the list is scrolled back to the top.
- [ ] Scrolling from one connection's section into the next slides the first connection's header out
      and the next one into the same slot — no flicker, no two headers at the same offset, no gap.
- [ ] Scrolling past the end of one schema into the next replaces only the schema row; the
      connection and database rows do not move.
- [ ] A pinned row can be clicked, double-clicked, twisty-toggled and right-clicked, and does exactly
      what the real row does; it shows the connection's colour rail.
- [ ] Never more than three rows are pinned, and never more than the panel can spare in a short
      window.
- [ ] *Reveal in project panel* scrolls the target row into view **below** the band, not behind it.
- [ ] `[data-testid="tree-row"]` counts anywhere in the suite are unchanged by the band, and the
      tree still has exactly one `tabindex="0"` row.
- [ ] Scrolling the tree stays inside the frame budgets `budgets.spec.ts`/`perf.spec.ts` already
      assert.

**The checkbox filter**

- [ ] The filters dialog contains no pattern input, no `Regex` checkbox and no rule list —
      `grep -rn "isRegex\|globToRegExp\|FILTERABLE_KINDS" src` returns nothing.
- [ ] *Object types* lists every kind present under the connection, with its cached count, and
      unticking one removes every node of that kind — and its P19 folder — from the tree.
- [ ] *Objects* is an expandable tree; expanding a database shows its schemas, expanding a schema
      shows its objects, each with a checkbox and a count.
- [ ] Unticking a container hides its whole subtree; re-ticking it brings the subtree back exactly
      as it was.
- [ ] A container with some descendants hidden renders as partial, and ticking it clears them.
- [ ] A node whose kind is hidden shows a disabled checkbox that says which type filter is hiding it.
- [ ] The name filter narrows the listed rows by substring; `.*` matches nothing.
- [ ] The consequence strip's *"will show N of M cached nodes"* matches what the tree renders after
      saving.
- [ ] Opening, expanding and cancelling the dialog issues zero queries and writes zero op-log rows.
- [ ] Selections persist per connection across a relaunch, and deleting a connection removes them.
- [ ] An object created after the filter was saved appears in the tree without being ticked
      anywhere.
- [ ] The transient search box behaves exactly as it did, including the incomplete-search note.

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean.
- [ ] `xvfb-run -a bun run test:ui` green on the macOS/Colima box, `bun run test:db` green and
      untouched (per `AGENTS.md`, neither container-backed suite can run in Claude Code's Linux web
      container).
- [ ] No spec file declares its own `findRow`/`expandRow`/`openRowMenu` any more.
- [ ] SPEC.md §8.3, §9.2 and §11 describe what shipped.

## 9. Open questions for the user

1. **Three pinned rows, or two?** D5 pins connection → database → schema, because that is the chain
   whose names you lose while scrolling a long schema. Two (connection → database) is quieter and
   costs 28px less, and for Mongo or Redis — where the third level is already the objects
   themselves — it may be all that is wanted. This is the one number in the sticky half that is a
   preference rather than a consequence.
2. **Should the pinned header stack be interactive at all?** D7 makes a pinned row behave exactly
   like the real one (click, collapse, right-click), which is what VS Code and every file manager
   do — and it is what forces D8's helper work, because an interactive band occludes the rows it
   covers. A purely decorative band (pointer-events: none, clicks falling through to the row
   underneath) would need none of that, at the cost of a header that looks clickable and is not,
   and clicks that land on something other than what they appear to hit. The plan takes the
   standard, more expensive road; say if you would rather have the cheap one.
3. **Should the panel head get the mockup's Filters button?** §6 leaves it out because it needs a
   rule for which connection it targets. If the answer is simply *"the selected row's connection,
   disabled when nothing is selected"*, it is a ten-line addition to step 7 and it matches
   `_sb_head.html:5` exactly.
4. **Are there tree filters in your local `kira.sqlite` you care about?** D12's migration drops the
   `connection_filters` rows rather than pretending a glob can become a checkbox. If you have rules
   set up on a real connection, say so before step 6 and they can be re-ticked by hand after the
   upgrade — there is no way to convert them automatically, but there is a way to warn first.
5. **Should unticking a *type* be per connection, or app-wide?** D10 keeps every exclusion
   per-connection, matching today's table. "I never want to see sequences anywhere" is plausibly a
   global preference (Settings → Appearance) rather than something to repeat per connection; it is
   also a second storage location and a second precedence rule, so it is deliberately not in this
   plan.
