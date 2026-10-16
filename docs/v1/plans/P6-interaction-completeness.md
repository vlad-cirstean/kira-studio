# P6 — Interaction completeness

> Plan for SPEC.md §10 phase **P6**. Deliverable: *Full right-click matrix, copy/paste rows,
> keyboard shortcuts.* "Needs all views to exist" — the grid, cell editor, DDL view, mutations and
> console (P2–P5.5) are all in place; this phase closes the remaining interaction gaps across them
> rather than building a new view.

## 0. Ground rules for this phase

- Build only what §8.10/§8.13/§8.15 list, scoped to the views that exist today. The §8.10 matrix's
  **Document** row (Mongo) has no view to attach to yet — that lands with the document view itself
  in P8, not here. Every other row in the matrix is in scope.
- No unit tests — same two suites as always. New UI-test coverage follows the exact
  `openRowMenu`/`menuItemIds` local-helper convention already used by `tree.spec.ts`/`tabs.spec.ts`.
- No engine/adapter changes. Every item in this phase is renderer-side (clipboard formatting,
  selection, menus, keybindings) except one: "Set as default" (D9 below), which is also
  renderer-only — no `Adapter` interface change, no new `DATA_OP`/`ENGINE_OP`.
- Grid row/cell copy (Ctrl+C) and paste (Ctrl+V) are **local, DOM-focus-scoped keydown handlers on
  the grid itself** — not routed through the native Electron menu/accelerator system that every
  other shortcut in this phase uses. Reason in D1 below; this is a deliberate, documented exception
  to "the binding table is a single data file," not an oversight.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `bun run test:db` is
  untouched by this phase (no adapter changes); `xvfb-run -a bun run test:ui` for every UI change.

### Realities this phase works with (verified against the tree)

1. **The tree context menus, tab context menu, and empty-background menu are already complete**
   per §8.10 — `project/menus.ts`'s `connectionMenu`/`relationMenu`/`columnMenu`/
   `emptyBackgroundMenu` and `TabStrip.vue`'s `onContextMenu` already carry every item the spec
   lists for those five targets. The two gaps in the *tree* side of the matrix are: **Database /
   schema**'s "(Postgres) Set as default" (P1/P2 both explicitly deferred it to "P5.5's console,
   the first consumer" — P5.5 shipped without it, so it lands here) and the **grid**'s entire
   cell/row/header menu, which does not exist at all yet.
2. **The shared `ContextMenu` service (`workbench/state/contextMenu.ts`) already supports
   everything this phase's menus need**: checkbox items (`checked`, used today for Read-only and
   the Color submenu), one level of submenu (used today for Color ▸ and Saved filters ▸), and
   `danger` styling (used today for Delete). No changes to the service itself.
3. **`copyText` (`navigator.clipboard.writeText` wrapped) is duplicated verbatim** in
   `project/menus.ts` and `TabStrip.vue`. A third and fourth copy (grid, ops panel) would make
   four — this phase extracts one shared `src/renderer/clipboard.ts`.
4. **The Operations panel already has a context menu**, just a one-item one (`reveal-tab`) — P2's
   plan doc explicitly deferred `Re-run` to P5.5 ("Re-run (P5.5)"), and P5.5 shipped without
   implementing it. It is overdue, not new scope; §8.11's `copy-command`/`copy-error` are new.
5. **`views/grid/state.ts`'s `Selection` union already models `row: {rows: number[]}` and
   `column: {cols: number[]}`**, but `DataGrid.vue`'s `onGutterClick`/`onHeaderSelectClick` always
   *replace* the selection with a single-element array — there is no shift-range or ctrl-toggle
   accumulation for rows/columns today (cell/range selection already has both, via `onCellClick`
   and arrow+Shift in `onKeydown`). Row/cell copy needs a real multi-row selection to copy more
   than one row at a time.
6. **`pendingChanges.ts` already has every primitive P6's paste and "Duplicate row" need**:
   `stageEdit` (existing-row overwrite), `addInsertRow`/`stageInsertValue` (new pending rows). No
   new pending-change kind — paste and duplicate both resolve to sequences of these same calls.
7. **`ColumnsMenu.vue` already *is* the projection picker** (§8.5's toolbar Projection item,
   P2). The header menu's "Hide column"/"Show all columns" are not a second, competing
   display-only mechanism — they read as one-click shortcuts into the *same* `setProjection()`
   call `ColumnsMenu.vue` already makes (D8 below). This avoids a second, overlapping notion of
   "which columns are shown."
8. **Panel-toggle keyboard shortcuts already exist and already use the pattern this phase extends
   for everything else**: `src/main/menu.ts`'s Electron `Menu` template already binds
   `CmdOrCtrl+B`/`CmdOrCtrl+J`/`CmdOrCtrl+,` to `IPC.toggleProjectPanel`/`toggleOperationsPanel`/
   `openSettings`, pushed to the renderer and consumed in `App.vue`'s `onMounted`. `menu.ts` is
   already, literally, §8.15's "single data file" for every keybinding it carries — this phase
   adds to it rather than building a second, parallel renderer-side dispatcher.
9. **`console` tabs are gated on `caps.sql`, and `execute()` is call-level all-or-nothing, not
   transactional** (P5.5 D2) — relevant to "Re-run" (D6 below), which resolves to opening a
   console and running the historical command through the exact same path a human would.

## 1. Shapes introduced in this plan

```ts
// src/renderer/clipboard.ts
export function copyText(text: string): void; // navigator.clipboard.writeText, extracted once

// src/renderer/views/grid/clipboardFormats.ts
export function rowsToTsv(rows: RowSnapshot[]): string;
export function rowsToCsv(rows: RowSnapshot[]): string;
export function rowsToJson(rows: RowSnapshot[]): string;
export function rowsToInsert(qualifiedName: string, rows: RowSnapshot[]): string;
export function parseDelimited(text: string): string[][]; // TSV if it contains a tab, else CSV

// src/renderer/shortcuts/commands.ts
export function registerCommand(id: string, handler: () => void): () => void; // unregister fn
export function runCommand(id: string): void; // no-op if nothing registered for id

// src/renderer/state/consoleDefaults.ts
export function setConsoleDefault(connectionId: string, path: string): void;
export function consoleDefaultFor(connectionId: string): string | null;
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Grid row/cell copy (Ctrl+C) and paste (Ctrl+V) are a **local `keydown` handler on `DataGrid.vue`'s own container** (already the target of `onKeydown` for arrow-nav), not a new Electron `Menu` accelerator. Grid cells also get `user-select: none` (they didn't have it before). | Electron's existing `editMenu` already carries `role: 'copy'`/`role: 'paste'`, which ship with an implicit `CmdOrCtrl+C`/`CmdOrCtrl+V` accelerator and act on the page's native text *selection* — needed as-is for every plain `<input>` in the app (connection dialog, saved-query rename, etc.). Adding a second, explicit accelerator for the same chord would either conflict or require guarding every text field against it. `user-select: none` guarantees the native role has nothing to act on while the grid has focus, so the two mechanisms coexist without a race: native copy/paste keeps working in every text field, and the grid's own listener is the only thing that fires when the grid itself has DOM focus. |
| D2 | Row/column selection (`onGutterClick`/`onHeaderSelectClick`) grows Shift (contiguous range from the last anchor) and Ctrl/Cmd (toggle one row/column into a disjoint set) accumulation, matching the existing cell-selection precedent (`onCellClick` already does this for cells). A plain click still replaces the selection with a single row/column, as today. | Copying more than one row, or acting on more than one row via "Delete row"/"Copy row(s)", needs an actual multi-row selection — today's `rows: [row]`-only replace makes that impossible. Mirroring the already-shipped cell/range Shift-click behavior keeps the interaction model consistent across all four selection kinds rather than inventing a second convention. |
| D3 | Right-clicking a **row** that is *not* already part of the current selection replaces the selection with just that row before opening the menu; right-clicking *inside* an existing multi-row selection leaves it untouched. Right-clicking a **cell** always sets a single-cell selection (cell-level actions — Edit, Set NULL — only ever target one cell). Right-clicking a **header** always sets a single-column selection. | Standard file-manager/spreadsheet convention: right-click-to-act-on-selection when there is one, right-click-to-select-and-act when there isn't. Cell and header menus have no multi-target actions in §8.10's matrix, so their selection is always singular. |
| D4 | Grid **cell** menu: `Copy`, `Copy with header`, `Copy as JSON`, `Edit`, `Set NULL`, `Filter by this value`. **`Go to referenced row` is omitted** — it needs the FK metadata graph, which is explicitly P7's deliverable ("Needs mutations-era metadata and tabs"). `Edit` calls the existing `startEdit()`; `Set NULL` calls `stageEdit(tabId, row, column, null as unknown as string)`'s sibling — a new `stageNull()` in `pendingChanges.ts` that stores `changes[column] = null` directly, skipping the inline `<input>` (which can only ever produce a string, per P5's D14 note that a NULL affordance was deferred to "P6+"). Both are disabled when `!canEditTable` or the row is pending-delete, matching the existing inline-edit gate. | Faithful to the matrix minus the one item that structurally belongs to a later, metadata-dependent phase; reuses the exact staging primitives P5 already built rather than adding a parallel edit path. |
| D5 | `Filter by this value`: builds `"<column>" = '<escaped>'` (Postgres) / `` `<column>` = '<escaped>' `` (MariaDB) — or `IS NULL` for a null cell — from the connection's `kind`, and **replaces** (not appends to) the tab's current filter via the existing `setFilter()`. | Matches the toolbar filter's own free-text nature (P2/P5 ground rule: Kira never parses/validates a value against its column type — this generates literal SQL text once, the same trust boundary the WHERE box already has) and common DB-GUI convention (a deliberate narrowing action, not an accumulating AND-chain a user would have to notice and undo). |
| D6 | Grid **row** menu: `Copy row(s) ▸` (submenu: TSV/CSV/JSON/INSERT), `Duplicate row`, `Delete row`. All three act on the full current row selection (falling back to the row that was right-clicked, per D3). `Duplicate row` calls a new `duplicateAsInsert(tabId, row)` in `pendingChanges.ts`: one `addInsertRow` + `stageInsertValue` per **non-primary-key** column, copied from the row's current *effective* value (staged edit if present, else the page's own cell) — primary-key columns are left blank for the user to fill in. `Delete row` calls the existing `toggleDelete`. | Duplicating a PK verbatim would only ever produce a guaranteed-collision insert on commit; leaving PK columns blank mirrors `toolbar-add-row`'s own all-blank starting point while still saving the user from retyping every other column. Copying the *effective* (possibly-staged) value keeps what you copy consistent with what you see on screen. |
| D7 | Grid **header** menu: `Sort asc`, `Sort desc`, `Clear sort`, `Hide column`, `Show all columns`, `Copy column name`, `Copy column values`. Sort items call the existing `setSort()` explicitly (no cycling — the header click's toggle-cycle stays as is for a plain click). `Copy column values` copies only the **currently loaded page's** values for that column, one per line. | "Loaded page only" mirrors the search toolbar's own already-established scope boundary (§8.5: "Searches the loaded page only — never the server") — copying every row of a filtered/unfiltered table server-side is a different, much larger feature this phase does not build. |
| D8 | `Hide column` removes that column from the tab's projection (materializing the full column list first if `state.projection` was `null`) via the existing `setProjection()`; `Show all columns` calls `setProjection(tabId, null)`. **No new `DataTabState` field.** | Per realities #7 above — a second, independent "hidden columns" list would let a column be simultaneously projected-out and not-hidden or vice versa, two mechanisms answering the same question. Reusing projection also means "Hide column" already gets P2's existing server-side-when-possible behavior for free. |
| D9 | **"Set as default" (Postgres-only, database and schema tree rows)**: a new renderer-only, session-only (not persisted, not sent to the engine) `Record<connectionId, string>` in `state/consoleDefaults.ts`, storing the row's own encoded `path` verbatim. `openConsoleTab(connectionId, path)` substitutes the stored default when called with `path === ''` (i.e. opened from the bare connection root) and a default exists for that connection; otherwise behavior is unchanged. The menu item shows `checked: true` when the row's own path equals the current default. | Postgres has no session-level `USE`-equivalent (D-plan realities #9's precedent, P5.5's own `ClientSet`: one `pg.Client` per database, fixed at connect for the primary one) — a console opened at the bare connection root is otherwise permanently stuck on whichever database was configured at connect time, with no way to change it from inside the console script itself. MariaDB doesn't need this: `USE other_db;` as the console's own first statement achieves the same thing natively, which is why §8.10 parenthesizes the item "(Postgres)". Because the substitution happens purely in `openConsoleTab`'s path argument — before it ever reaches the engine — `execute()`'s existing database-segment resolution (already correct for any explicit database) handles it with no engine change at all. |
| D10 | **Operations panel row menu** grows `Copy command`, `Copy error` (disabled when the field is empty/null), `Cancel` (disabled unless `status === 'running'`, reusing the existing `onCancel`), and `Re-run` (disabled unless `record.command` is non-null **and** the owning connection's `caps.sql` is true). `Re-run` calls `openConsoleTab(connectionId, '')` then `run(tabId, splitSqlStatements(record.command).text)` — i.e. it re-opens the *exact* command text through the query console and runs it immediately, reusing `sql-split.ts` (P5.5) to re-split a possibly-multi-statement `command` the same way "Run all" would. | `Re-run` was P2's own deferred item, explicitly assigned to P5.5 ("nothing consumes a default yet... P5.5's console is the first consumer" reasoning applies again here) and missed there — this phase is where it's finally due. Routing it through a real console tab (rather than blindly re-invoking whatever op kind produced the row — `read`/`count`/`mutate`/`execute`) keeps "re-run something historical" on the one execution path that's designed for arbitrary, operator-supervised statement replay, and gives the user a visible tab (with Stop available) instead of a silent background re-execution of what could be a destructive statement. |
| D11 | **Keyboard shortcuts** extend `src/main/menu.ts`'s existing accelerator pattern (native `Menu` → `IPC` channel → `App.vue` subscription), the same mechanism panel toggles already use: Command Palette `CmdOrCtrl+Shift+P`, Next/Previous tab `Control+Tab`/`Control+Shift+Tab`, Close tab `CmdOrCtrl+W`, Find `CmdOrCtrl+F`, Refresh `F5`, Run `CmdOrCtrl+Enter`, Run all `CmdOrCtrl+Shift+Enter`. Tab next/prev/close act on `tabsState` directly (global, no per-view registration needed). Find/Refresh/Run/Run-all dispatch through a new tiny renderer-side registry, `shortcuts/commands.ts` (`registerCommand`/`runCommand`), which `DataView.vue` (`view.find`→toggle `searchOpen`, `view.refresh`→`reload()`), `DdlView.vue` (`view.refresh`→`load(tabId,{refresh:true})`) and `ConsoleView.vue` (`view.run`→`runStatement()`, `view.run-all`→`runAll()`) register into on mount and unregister on unmount — exactly one of these three is ever mounted at a time (`MainView.vue`'s existing `v-else-if` chain), so "the active tab's own command" falls out for free with no explicit active-tab-kind branching in the dispatcher itself. `runCommand()` on an id nothing has registered is a documented no-op, not an error. | Reuses a proven, already-shipped mechanism instead of building a second, parallel keydown-based dispatcher (which would also have to solve the native-text-field-conflict problem D1 already had to solve once). The mount/unmount registration pattern needs no tab-kind switch statement anywhere in the shortcut-handling code — each view declares only the commands it supports, which stays correct automatically as more tab kinds are added in P8–P10. |
| D12 | **Command palette** is new: `shortcuts/state.ts` (`paletteOpen`, a fixed, minimal command list) + `shortcuts/CommandPalette.vue` (centered overlay, text input, substring-filtered list, Enter/click to run and close, Escape to close) mounted once in `App.vue` alongside `ContextMenu`. Its command list is deliberately small and 1:1 with existing, already-reachable actions — every global shortcut this phase adds (palette excluded), plus `New connection`, `Toggle project panel`, `Toggle operations panel`, `Toggle cell editor panel`, `Open settings`. **No fuzzy scoring, no "go to table/connection" navigation.** | §8.15 explicitly calls for "a minimal, VS Code-flavoured set only" — a full fuzzy command matcher or a "go to anything" navigator is a materially bigger feature than "minimal," and nothing in the matrix or the deliverable line asks for one. Plain substring filtering over a short, fixed list is enough for a command palette whose entire command set fits on one screen. |
| D13 | Paste (Ctrl+V, grid-focused, a cell/row selection present): clipboard text is parsed as **TSV if it contains a tab character, else CSV** (`parseDelimited`, D-shape above) into rows of string cells. Starting at the selection's anchor row/column, values are applied column-by-column across the tab's current display column order; rows landing within the currently loaded page's row range become `stageEdit` calls (pending **edits**); rows beyond it become new `addInsertRow`/`stageInsertValue` calls (pending **inserts**) — matching §8.13's literal "stages new/edited rows." No parsing beyond splitting on the delimiter and unescaping quoted CSV fields — every pasted value lands as pending text, same as typing it into the inline editor (P5's own "never a typed JS value" ground rule applies unchanged). | Directly implements §8.13's paste sentence with the simplest anchor-and-fill semantics that still distinguishes "overwrite what's already there" from "add what extends past it," reusing the exact same staging primitives (D6, D4) rather than a third one. |
| D14 | UI-test coverage for the grid menus/copy-paste/paste and the ops-panel menu additions lives in **`tests/ui/interaction.spec.ts`** (new file) rather than growing `data-view.spec.ts` further — it is already large and scoped to pagination/filter/search. Keyboard-shortcut and command-palette coverage lives in the same file. `tree.spec.ts` grows one assertion for `Set as default`'s new checked-item behavior on the existing Postgres fixture. | Keeps each spec file scoped to one coherent slice, matching the existing one-spec-per-feature-area convention (`ddl.spec.ts`, `mutations.spec.ts`, `console.spec.ts`, …) rather than piling every new assertion into whichever file happens to already touch the grid. |

## 3. Target tree at the end of P6

```
src/main/menu.ts                                    MOD  + command palette / tab nav / find / refresh / run accelerators
src/shared/protocol/ipc.ts                           MOD  + new IPC channels for the above
src/preload/index.ts                                 MOD  + subscriptions for the above
src/renderer/App.vue                                  MOD  wires new IPC subscriptions, mounts CommandPalette
src/renderer/bridge/control.ts                        MOD  + on* subscription wrappers
src/renderer/clipboard.ts                             NEW  copyText(), extracted from menus.ts/TabStrip.vue
src/renderer/project/menus.ts                         MOD  copyText import; containerMenu() += Set as default
src/renderer/workbench/panels/TabStrip.vue             MOD  copyText import (dedup)
src/renderer/workbench/panels/OperationsPanel.vue      MOD  onRowContextMenu += copy-command/copy-error/re-run/cancel
src/renderer/state/consoleDefaults.ts                  NEW  per-connection console default path (D9)
src/renderer/state/tabs.ts                              MOD  openConsoleTab() consults consoleDefaults
src/renderer/shortcuts/commands.ts                      NEW  registerCommand/runCommand
src/renderer/shortcuts/state.ts                         NEW  paletteOpen + fixed command list
src/renderer/shortcuts/CommandPalette.vue                NEW  overlay UI
src/renderer/views/grid/clipboardFormats.ts              NEW  rowsToTsv/Csv/Json/Insert, parseDelimited
src/renderer/views/grid/gridMenu.ts                       NEW  builds cell/row/header MenuItem[]
src/renderer/views/grid/pendingChanges.ts                  MOD  + stageNull(), duplicateAsInsert()
src/renderer/views/grid/DataGrid.vue                        MOD  multi-row/column selection, context menus, Ctrl+C/V, user-select:none
src/renderer/views/grid/DataView.vue                         MOD  registers view.find/view.refresh
src/renderer/views/ddl/DdlView.vue                            MOD  registers view.refresh
src/renderer/views/console/ConsoleView.vue                     MOD  registers view.run/view.run-all
tests/ui/interaction.spec.ts                                   NEW  grid menus, copy/paste, ops-panel menu, shortcuts, palette
tests/ui/tree.spec.ts                                            MOD  Set as default checked-state assertion
```
