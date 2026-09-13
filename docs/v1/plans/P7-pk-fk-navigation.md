# P7 — PK/FK navigation

> Plan for SPEC.md §10 phase **P7**. Deliverable: *FK metadata graph, cell buttons, filtered tabs.*
> "Needs mutations-era metadata and tabs" — P5's `ObjectMeta`/L1 cache and P6's tab/filter/menu
> machinery are both in place; this phase wires a new consumer onto them rather than building new
> plumbing.

## 0. Ground rules for this phase

- Build only what §8.5's "PK/FK navigation" paragraph describes: a small per-cell button on a PK
  or FK cell, and the mirrored "Go to referenced row" / "Referenced by ▸" context-menu items
  P6's `gridMenu.ts` doc comment explicitly left for this phase. Nothing else in §8.5 is touched.
- **No engine/adapter changes.** Both SQL adapters already query and return both FK directions on
  every `describe()` call (realities #1, #2 below) — this phase is entirely renderer-side.
- **Mongo is explicitly out of scope** — SPEC.md §8.5 says so verbatim ("Mongo has no FK
  navigation in v1"), and no Mongo adapter exists yet (P8), so `ObjectMeta` can never be non-null
  for a Mongo tab in the first place. No dialect gate is needed beyond what already falls out of
  `meta` staying `null` for unsupported engines.
- No unit tests — same two suites as always. New UI-test coverage extends `interaction.spec.ts`
  (P6's own file, not a new one — this is one more slice of the interaction matrix, not a new
  surface) using a fresh describe block, plus reuses the FK-graph fixture tables
  (`regions → customers → orders → order_items`, `employees` self-FK) that
  `tests/db/fixtures/0001_seed.sql` already seeded with a comment naming this exact phase.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `bun run test:db` is
  untouched (no adapter changes); `xvfb-run -a bun run test:ui` for every UI change.

### Realities this phase works with (verified against the tree)

1. **`ObjectMeta` already carries both FK directions**, and has since P1 —
   `src/shared/domain/tree.ts`'s `objectMetaSchema` has `foreignKeys: ForeignKeyMeta[]` (outbound:
   FKs defined *on* this table) and `referencedBy: ForeignKeyMeta[]` (inbound: FKs on *other*
   tables pointing at this one), each entry shaped `{ name, columns, referencedPath,
   referencedColumns, onDelete, onUpdate }`. `referencedPath`'s own doc comment literally says
   `// encoded path of the referenced table (P7)` — this phase is what it was reserved for.
2. **Both SQL adapters already populate both directions on every `describe()` call.** Postgres's
   `catalog.ts` `queryForeignKeyEdges()` is one query parameterized by direction
   (`conrelid`/`confrelid`), called once each way by `listForeignKeys()`/`listReferencedBy()`;
   MariaDB's `catalog.ts` has two `information_schema.KEY_COLUMN_USAGE`-based queries with the
   same split. `describe()` in both adapters calls both and merges the results into one
   `ObjectMeta`. Nothing here needs a new engine op.
3. **The current tab's `ObjectMeta` is already loaded and reactive** — `views/grid/state.ts`'s
   `loadMeta()` fetches it once per tab via `control.treeDescribe()` (cache-aside through the L1
   metadata cache) and stores it at `runtime[tabId].meta`. `DataGrid.vue` already has a local
   `rt()` helper reading that same `runtime` map for selection state, so `rt()?.meta` needs zero
   new plumbing to reach from the grid.
4. **The "open a tab pre-filtered to a value" mechanic already exists twice over.** `state/tabs.ts`
   `openDataTab(connectionId, path, { newTab })` opens (or, without `newTab`, reuses) a data tab
   for an arbitrary `(connectionId, path)` pair; `views/grid/state.ts` `setFilter(tabId, where)`
   pushes a WHERE clause server-side. P6's saved-filters tree submenu
   (`project/menus.ts`'s `savedFiltersMenu`) already composes exactly these two calls back-to-back
   to open a table pre-filtered — PK/FK navigation is the same composition aimed at a *different*
   table's path with a value-equality clause instead of a saved filter body.
5. **`gridMenu.ts`'s `cellMenu()` already reserves the slot.** Its D4 doc comment reads *""Go to
   referenced row" is deliberately omitted — it needs FK metadata, P7's deliverable"* — this phase
   fills that in, plus adds the PK-side mirror the comment doesn't mention (the spec's "lists
   every column known to reference it" behavior, i.e. a `referencedBy`-driven submenu).
6. **Identifier quoting and value-literal escaping for a generated WHERE clause already exist**,
   local to `gridMenu.ts`: `quoteIdent(dialect, name)` (backtick vs double-quote per dialect) and
   the literal-escape (`'`  →  `''`) already used by `cellMenu()`'s own "Filter by this value" item
   (D5's `= '<value>'` shape). This phase reuses both for a (possibly multi-column, for a composite
   key) `AND`-joined equality clause instead of `filter-by-value`'s single-column one.
7. **`rowSnapshot(row)` (P6's D6, used by row-copy) already returns every display column's
   effective value for a row** as `{ columns, values: Record<string, string | null> }` — exactly
   the shape needed to read *other* columns' values than the one that was clicked (a composite
   FK/PK spans more than one column). If a needed column isn't in `values` (hidden by projection)
   `values[name]` is `undefined`, which this phase treats the same as `null` — the cell can't be
   navigated on, so the affordance for that entry is left out rather than shown disabled.
8. **The hover-affordance-inside-an-absolutely-positioned-cell pattern already exists** —
   `DataGrid.vue`'s header cell has a `.header-select-zone` strip and a `.resize-handle` strip,
   both `position: absolute` children of a `position: absolute` header cell, shown unconditionally;
   `.grid-row:hover .grid-cell:not(.selected)` is the existing precedent for a pure-CSS `:hover`
   affordance with no JS-tracked hover state. This phase's cell button follows the same two
   patterns combined: `position: absolute` inside the (already `position: absolute`) `.grid-cell`,
   shown via `:hover`/`.selected` CSS rather than a tracked hover ref.
9. **`ContextMenu`'s service (`workbench/state/contextMenu.ts`) takes a plain `MenuItem[]` and a
   `MouseEvent`** (`openContextMenu(ev, items)`) — it doesn't care whether `ev` came from a
   `contextmenu` event or a plain `click`, so the same `MenuItem[]`-building functions serve both
   the right-click cell menu and a left-click on the new nav button (opened via `openContextMenu`
   when there's more than one candidate target, invoked directly when there's exactly one).

## 1. Shapes introduced in this plan

```ts
// src/renderer/views/grid/gridMenu.ts

// Builds "<col> = '<val>' AND <col2> = '<val2>' ..." for a (possibly composite) FK edge, reusing
// the file's own quoteIdent/escape discipline (realities #6). Returns null — not a best-effort
// partial clause — if any needed source value is null/undefined (realities #7): there is nothing
// sound to navigate to.
function foreignKeyValueFilter(
  dialect: Dialect,
  columns: string[],
  referencedColumns: string[],
  rowValues: Record<string, string | null>,
): string | null;

// Opens (always a *new* tab — §8.5 says "spawns a new tab") the edge's referenced table,
// pre-filtered to this row's value(s) on it. No-ops if foreignKeyValueFilter can't build a clause.
function navigateForeignKey(
  connectionId: string,
  dialect: Dialect,
  entry: ForeignKeyMeta,
  rowValues: Record<string, string | null>,
): void;

// One "Go to referenced row (<qualified target>)" item per outbound FK whose own columns include
// columnName — i.e. this cell is part of that FK. Disabled (not omitted) when the row value is
// missing, matching cellMenu()'s existing disabled-item convention.
export function foreignKeyNavItems(
  columnName: string,
  meta: ObjectMeta | null,
  ctx: { connectionId: string; dialect: Dialect; rowValues: Record<string, string | null> },
): MenuItem[];

// Flat "<qualified referencing table>.<col(s)>" items, one per meta.referencedBy entry — shown
// only when columnName is part of meta.primaryKey. Flat (no submenu wrapper) so the cell button's
// own popup can use it directly; referencedByMenuItems below wraps it for the right-click menu.
export function referencedByItems(
  columnName: string,
  meta: ObjectMeta | null,
  ctx: { connectionId: string; dialect: Dialect; rowValues: Record<string, string | null> },
): MenuItem[];

// referencedByItems, wrapped in a "Referenced by ▸" submenu MenuItem — [] (no separator/empty
// submenu) when referencedByItems is empty, so cellMenu() can always splice this in unconditionally.
export function referencedByMenuItems(
  columnName: string,
  meta: ObjectMeta | null,
  ctx: { connectionId: string; dialect: Dialect; rowValues: Record<string, string | null> },
): MenuItem[];

// CellMenuContext gains three fields cellMenu() needs to build the above:
export interface CellMenuContext {
  // ...existing fields unchanged...
  meta: ObjectMeta | null;
  connectionId: string;
  rowValues: Record<string, string | null>;
}
```

```ts
// src/renderer/views/grid/DataGrid.vue (script setup additions)

// Resolves, for one cell, which nav affordance (if any) applies and the MenuItem(s) it would
// offer — the single function both the button's v-if/icon and its click handler read, so the two
// can never disagree about whether a button is showing. 'fk' takes priority over 'pk' on the rare
// cell that is somehow both (realities #7 — this phase doesn't special-case that combination
// beyond "pick one deterministically"). null when editing, no meta yet, or no candidate items.
function cellNavEntry(
  row: number,
  displayCol: number,
): { kind: 'fk' | 'pk'; items: MenuItem[] } | null;

// Direct-navigates on a single candidate; opens the same ContextMenu popup the right-click menu
// uses (realities #9) when there's more than one.
function onCellNavClick(row: number, displayCol: number, e: MouseEvent): void;
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | Navigation logic is direction-agnostic: one `foreignKeyValueFilter`/`navigateForeignKey` pair serves both `meta.foreignKeys` (outbound) and `meta.referencedBy` (inbound) entries, because both share the same `ForeignKeyMeta` shape with the same "my `columns`, their `referencedPath`/`referencedColumns`" convention (realities #1) regardless of which direction populated the list. Building the WHERE clause is just `referencedColumns[i] = rowValues[columns[i]]` ANDed across `i`, joined with the target table's own dialect quoting. | Avoids two near-identical code paths that would drift; matches the catalog layer's own symmetric convention (realities #2) instead of fighting it. |
| D2 | A missing or `null` source value makes `foreignKeyValueFilter` return `null` (not an `IS NULL` clause, unlike D5's `filter-by-value`), and the caller either disables the menu item or omits the button entirely. | "Filter by this value" on a NULL cell is a legitimate, deliberate query (D5 in P6). "Jump to the row this NULL FK points at" is not a query anyone means to run — there is no row. Treating the two the same would produce a working-but-meaningless 0-row filtered tab instead of just not offering the action. |
| D3 | `foreignKeyNavItems`/`referencedByItems`/`referencedByMenuItems` live in `gridMenu.ts`, not a new file, and are exported for `DataGrid.vue`'s button handler to reuse directly (not re-derived). | `gridMenu.ts` already owns `cellMenu()`'s D4 slot reserved for exactly this (realities #5); the button and the right-click menu must never disagree about what's navigable for a given cell, so they call the same functions rather than two independent builders. |
| D4 | `cellMenu()` appends the new items after `filter-by-value`, behind a separator, only when non-empty (`foreignKeyNavItems(...)`, then `referencedByMenuItems(...)`, both already returning `[]` when nothing applies — no extra "is there anything to show" branch needed at the call site). | Matches the file's existing convention of building an unconditional array and letting empty sub-arrays disappear on their own (see `rowMenu()`'s always-present `copy-rows` submenu, which is never conditionally omitted either) — one shape, no special-casing. |
| D5 | The per-cell nav button is CSS-`:hover`/`.selected`-gated (`display: none` → `flex`), not a JS-tracked hover ref, and is a plain `<button>` absolutely positioned at the cell's right edge, reusing the `.header-select-zone`/`.resize-handle` precedent (realities #8). | No new reactive state, no extra per-frame work during scroll — §2.1's frame-budget discipline (already invoked by this file's own comments elsewhere) stays intact. A JS hover ref would re-render on every pointer move across the grid for no behavioral gain over pure CSS. |
| D6 | Clicking the button with exactly one candidate item navigates immediately (`item.run()`); with more than one, it opens the exact same `ContextMenu` popup the right-click path uses, anchored at the click (`openContextMenu(e, items)`), rather than a bespoke inline dropdown. | §8.5 only requires a *list* when there's a real choice ("pressing it lists every column known to reference it") — a table referenced by exactly one other table has nothing to choose between, so a menu there would be a needless extra click. Reusing `ContextMenu` (realities #9) avoids a second popup implementation/CSS surface for what is, structurally, the same "list of navigable targets" the right-click menu already renders. |
| D7 | When a cell is simultaneously part of an outbound FK *and* the table's primary key (an unusual but legal schema shape — e.g. a composite FK-as-PK join table), the button shows the FK affordance (`kind: 'fk'`) and the PK affordance is only reachable via the right-click menu's separate "Referenced by ▸" submenu, which `cellMenu()` always includes regardless of what the button shows. | The button can only show one icon/target set at a time (D5's single absolutely-positioned element); FK wins because "go to the specific row this points at" is a more specific, more common intent than "list who references my key" for a column that is itself borrowed from elsewhere. Nothing is actually lost — the right-click menu still offers both, unconditionally. |
| D8 | The nav button is omitted (not merely disabled) while a cell is mid-edit (`isEditing`), reusing the existing `isEditing(row, col)` check. | The inline `<input>` already occupies the cell's interior; overlaying a second interactive element on top of it during editing has no correct click target and no precedent elsewhere in this file. |
| D9 | Menu item ids are `go-to-referenced-<fk.name>` (outbound) and `referenced-by-<fk.name>` (inbound, inside the `referenced-by` submenu), using the constraint's own name rather than a synthetic counter. | Constraint names are already unique per table by definition (both catalogs return them), stable across reloads, and match the file's existing convention of deriving ids from real identifiers (`saved-filter-${entry.id}`, `menu-item-${col}`) rather than positional indices. |
| D10 | Test coverage is a new `describe`-free block appended to `tests/ui/interaction.spec.ts` (not a new spec file), driving the existing FK-graph fixture (`orders.customer_id → customers.id`, `customers.region_id → regions.id`, `order_items` with two outbound FKs, `employees.manager_id` self-FK including a NULL case). | P6 established the one-big-scenario-per-file convention for this exact matrix; this is one more slice of "interaction completeness," not a new surface deserving its own file. The fixture tables were seeded in P1 with a comment naming this phase, so no fixture changes are needed. |

## 3. Target tree at the end of P7

```
src/renderer/views/grid/
  gridMenu.ts        MOD  — foreignKeyValueFilter, navigateForeignKey, foreignKeyNavItems,
                             referencedByItems, referencedByMenuItems; CellMenuContext gains
                             meta/connectionId/rowValues; cellMenu() splices the new items in.
  DataGrid.vue        MOD  — cellNavEntry/onCellNavClick; per-cell <button class="cell-nav-btn">
                             in the grid-cell template; onCellContextMenu passes the three new
                             CellMenuContext fields; CSS for .cell-nav-btn.
tests/ui/
  interaction.spec.ts MOD  — new PK/FK navigation scenario block covering: FK cell → filtered new
                             tab on the referenced table; PK cell with one referencing table →
                             direct navigation; PK cell with a self-referencing FK → "Referenced
                             by" listing itself; NULL FK cell → no button/disabled item; composite-
                             column FK (order_items) → both outbound buttons independently correct.
docs/plans/
  P7-pk-fk-navigation.md NEW — this document.
```
