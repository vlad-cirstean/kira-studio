# P21 — Context-menu shortcut hints + the single binding table

> Plan for SPEC.md §10 phase **P21**. Deliverable, from the user request: *every item in the app's
> own right-click context menus prints its keyboard shortcut alongside the label, the way VS Code
> and every native desktop menu does; the audit covers every shortcut the app already supports; and
> new shortcuts are added for context-menu actions that deserve one, following VS Code's own
> keybinding conventions.*
>
> The native menu bar (`src/main/menu.ts`) already displays its accelerators — Electron does that
> for free from the `accelerator` field. The gap is entirely in the renderer's own custom menu
> system (`workbench/ContextMenu.vue`), which today has no shortcut slot in its markup, its CSS, or
> its `MenuItem` type.
>
> This phase also makes SPEC §8.16's existing promise true. §8.16 says *"the binding table is a
> single data file so remapping is a later feature, not a rewrite."* Today there is no such file:
> the bindings live as 13 literal accelerator strings in `main/menu.ts` plus a dozen hand-rolled
> `e.key === …` comparisons scattered across renderer components. §1 creates the file the spec
> already describes and points every consumer at it.

## 0. Ground rules for this phase

- **A displayed shortcut must be the shortcut that actually runs, or it must not be displayed.**
  This rules out the naive design (a free-text `shortcut: '⌘C'` string per call site), which would
  let the label drift from the handler with nothing to catch it. §1's decision is driven entirely
  by this rule. Where a menu item's action and a nearby key look similar but are *not* the same
  command — the tree's per-row **Refresh** vs. the global `F5` "refresh the active tab" — the
  correct answer is to print nothing, not to print something plausible. See D8.
- **No new focus or selection concepts.** A new keybinding is proposed only where the surface it
  acts on *already* has a focusable container and a selection model: the SQL grid
  (`DataGrid.vue`'s `tabindex="0"` container + `runtime.selection`) and the project tree
  (`TreeRow.vue`'s `:tabindex="selected ? 0 : -1"` + `treeState.selected`). The document, key/value,
  stream, definition and operations views have no focusable row container, and giving them one
  means focus rings, arrow-key row navigation and a focus-restoration story — a separate feature,
  not a line item here. §5 says so explicitly rather than half-building it.
- **No chords.** Several of VS Code's own bindings for these actions are two-stroke chords
  (`Ctrl+K Ctrl+W` = Close All Editors, `Ctrl+K Ctrl+0` = Fold All). Electron accelerators do not
  support chords and this app has no chord dispatcher. Those actions get no shortcut, and the audit
  says "chord, unsupported" rather than inventing a single-stroke substitute.
- **Widget-internal keys stay out of the table.** Enter-to-submit, Escape-to-close, arrow-key
  navigation inside a search toolbar, popover, dialog or autocomplete dropdown are universal widget
  behaviour, are never printed in a menu anywhere (VS Code does not print them either), and are not
  menu-reachable. §3.3 lists every one of them found so the audit is complete, and D3 explains why
  none of them enters the binding table.
- **Scope is menus and bindings.** No adapter changes, no engine changes, no IPC changes beyond the
  one channel `Ctrl/Cmd+N` needs. Exactly one new *menu row* is added in the whole phase (D12's
  grid-cell **Paste**, which surfaces a handler that already exists and already has a key).
- Comments per AGENTS.md: only where the code cannot say it for itself.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `xvfb-run -a bun run
  test:ui` from step 4 on. `bun run test:db` is untouched — no adapter changes in this phase.

### Realities this phase works with (verified against the tree)

1. **`MenuItem` has no shortcut field and `ContextMenu.vue` has no slot for one.**
   `workbench/state/contextMenu.ts:3-17` is a three-member union (`item` / `submenu` / `separator`);
   the `item` variant carries `icon`, `swatch`, `danger`, `disabled`, `checked`, `run`. The
   component (`ContextMenu.vue:86-105` for a top-level row, `:117-137` for a submenu row) renders
   `icon-box → .label (flex: 1) → optional check icon`. There is no third slot and no `.shortcut`
   rule in the `<style>` block.
2. **There are 21 menu-builder functions across 8 files.** `project/menus.ts` (13:
   `connectionMenu`, `containerMenu`, `relationMenu`, `collectionMenu`, `groupMenu`,
   `namespaceMenu`, `keyMenu`, `objectMenu`, `streamNodeMenu`, `simpleObjectMenu`,
   `savedFiltersSubmenu`, `columnsSectionMenu`, `emptyBackgroundMenu`), `views/grid/gridMenu.ts`
   (3: `cellMenu`, `rowMenu`, `headerMenu`), `views/documents/documentMenu.ts`,
   `views/keyvalue/keyValueMenu.ts`, `views/stream/streamMenu.ts`, and two inline builders —
   `TabStrip.vue:58`'s `onContextMenu` and `OperationsPanel.vue:107`'s `onRowContextMenu`. §3
   audits all 21; the total is **104 menu rows**.
3. **Every explicit global binding is a literal string in `main/menu.ts`.** `CmdOrCtrl+,` (:19),
   `CmdOrCtrl+B` (:51), `CmdOrCtrl+J` (:56), `CmdOrCtrl+Shift+P` (:62), `CmdOrCtrl+F` (:67), `F5`
   (:73), `CmdOrCtrl+Return` (:77), `CmdOrCtrl+Shift+Return` (:82), `Control+Tab` (:100),
   `Control+Shift+Tab` (:105), `CmdOrCtrl+W` (:110), `CmdOrCtrl+Shift+W` (:118), plus dev-only
   `reload`/`toggleDevTools`. Each `click`s `sendToFocusedWindow(IPC.x)`; `App.vue:24-37` maps each
   channel to either a direct action or `runCommand(id)` against `shortcuts/commands.ts`'s registry.
4. **`role`-based Edit-menu items supply their own OS accelerators** (`menu.ts:36-43`: undo, redo,
   cut, copy, paste, selectAll). These are not strings this phase owns and must stay untouched —
   they are what makes text editing work inside every `<input>` in the app.
5. **`user-select: none` is app-wide.** `theme/base.css:61` sets it on `body`; only
   `input, textarea, [contenteditable], .cm-editor` (`:64-68`) opt back into `text`, plus
   `OperationsPanel.vue:330`. This is the load-bearing fact behind P6's D1: the native
   `role: 'copy'` accelerator has nothing to act on outside a text field, so `Cmd/Ctrl+C` keydowns
   reach the page and a local handler can own them. `DataGrid.vue:886-891` already proves this
   empirically. `TreeRow.vue:139` sets `user-select: none` too, so the same reasoning extends to the
   tree — but **not** to the operations panel, whose rows are deliberately selectable text.
6. **The grid's local handler already binds three of the audited menu rows.**
   `DataGrid.vue:879-940`'s `onKeydown`: `Cmd/Ctrl+C` → `onCopy()`, `Cmd/Ctrl+V` → `onPaste()`,
   `Enter` → `startEdit()`, plus arrows/Shift+arrows for selection. `onCopy` (`:771-811`) branches
   on selection kind — `cell` copies the cell, `range` a TSV block, `row` `rowsToTsv(...)`, and the
   final branch handles a **column** selection by copying that column's loaded values. Since
   `onHeaderContextMenu` (`:750`) sets `selection = { kind: 'column', … }` before opening the header
   menu, `headerMenu`'s **Copy column values** is *already* bound to `Cmd/Ctrl+C` — an existing
   binding that has never been surfaced anywhere.
7. **`Cmd/Ctrl+V` has a working grid handler but no menu row.** `onPaste` (`:816`) is guarded by
   `canEditTable` and handles cell/range/row selections, staging edits and pending inserts. §8.10's
   Grid cell row lists no Paste item, so the capability is undiscoverable. D12 adds the row.
8. **`view.find` (`Cmd/Ctrl+F`) is registered by exactly one view.** Only `DataView.vue:98`
   registers it, yet `DocumentView.vue:264`, `KeyValueView.vue:318` and `StreamView.vue:320` each
   own a `searchOpen` flag and a search toolbar reached only by a toolbar button. `Cmd/Ctrl+F` is
   therefore dead in three of the five searchable views. D14 fixes it — three registrations, ~4
   lines each, and it is squarely inside "cover every existing shortcut the app supports".
9. **The tree's selected row is already focusable and has a primary action.**
   `TreeRow.vue:84` is `:tabindex="selected ? 0 : -1"`; `treeState.selected` (`state/tree.ts:54`)
   holds its key; `ProjectTree.vue:80-110`'s `onOpen(row)` is the double-click handler and is
   exactly "the row's primary action" for every kind. `ProjectPanel.vue:15-34` already binds a
   container-level keydown for type-ahead and deliberately ignores anything with Ctrl/Meta/Alt held
   and anything whose `e.key.length !== 1` — so `F2`, `Delete`, `Enter` and every Cmd-combo pass
   straight through it untouched.
10. **The renderer has no platform detection at all.** No `navigator.platform`, no `process.platform`
    bridge, no `isMac`, and not one `⌘`/`Ctrl` string literal anywhere in `src/renderer/`.
    `AppInfo` (`shared/protocol/ipc.ts:82-88`) carries versions and `kiraHome` but no platform, and
    `appInfo()` is async — useless to a synchronous menu builder. D4 settles this.
11. **Right-clicking a tree row does not select it.** `ProjectTree.vue:112`'s `onContextMenu` opens
    the menu without calling `selectRow`. This matters for D6: the keyboard path acts on
    `treeState.selected` (set by left-click), which is a different row from the one a right-click
    targets. That is the same split VS Code has and is not a bug to fix here.

---

## 1. Where a menu item's shortcut comes from — decided

**Decision (D1): one shared, typed binding table in `src/shared/shortcuts.ts`; a `MenuItem` names a
binding by id, never by display string.**

Rejected: `shortcut?: string` set ad-hoc per call site. It is three lines of work and it makes the
one failure this phase exists to prevent — a menu that prints `⌘D` next to an action `⌘D` does not
perform — invisible to the compiler, to lint, and to both test suites. A doc-comment convention
does not catch it. AGENTS.md's "no shortcuts" rule applies to the plan as much as the code.

The shape:

```ts
// src/shared/shortcuts.ts
export interface Chord {
  /** Electron accelerator key name: 'C', 'F2', 'Return', 'Delete', 'Backspace', 'Tab', ','. */
  key: string;
  cmdOrCtrl?: true;
  /** Literal Control on every platform, unlike cmdOrCtrl — what Control+Tab needs. */
  ctrl?: true;
  shift?: true;
  alt?: true;
}

export interface Binding {
  chord: Chord;
  /** Platform override. Only ever set on global: false bindings — see D2. */
  mac?: Chord;
  /** true => main/menu.ts emits it as an Electron accelerator; false => a local keydown owns it. */
  global: boolean;
}

export const SHORTCUTS = { /* … 22 entries, §2 */ } satisfies Record<string, Binding>;
export type ShortcutId = keyof typeof SHORTCUTS;

/** 'CmdOrCtrl+Shift+P'. Called only by main/menu.ts, only over global bindings. */
export function accelerator(id: ShortcutId): string;
```

Three derivations, one table:

| Consumer | Function | Lives in |
|---|---|---|
| Native menu bar | `accelerator(id)` | `src/shared/shortcuts.ts` (no DOM types) |
| Context-menu display | `formatShortcut(id)` | `src/renderer/shortcuts/keys.ts` |
| Local keydown handlers | `matchesShortcut(id, event)` | `src/renderer/shortcuts/keys.ts` |

`shared/` is already imported by both `main/` (`menu.ts:2` imports `IPC`) and `renderer/`, so one
file genuinely serves both. The renderer half is split out so `shared/shortcuts.ts` never needs the
DOM lib in `tsconfig.node.json`.

`MenuItem` then gains one field on the `item` variant only:

```ts
shortcut?: ShortcutId;
```

A typo is a type error. A submenu trigger never carries one (D2). This is the same
"small deliberate registry over scattered strings" discipline `shortcuts/commands.ts`'s D11 and
`shortcuts/state.ts`'s D12 already set.

**Decision (D5): where a new local binding is added, dispatch *through* the menu, not around it.**

```ts
// workbench/state/contextMenu.ts
export function runMenuShortcut(items: MenuItem[], id: ShortcutId): boolean;
```

It walks `items` (one level into submenus, since `copy-rows-tsv` lives in one), finds the first
`type: 'item'` that is not `disabled` and whose `shortcut === id`, runs it, and returns whether it
did. The tree's and grid's new keydown handlers then read:

```ts
const id = shortcutFor(e, TREE_SHORTCUTS);
if (id && runMenuShortcut(menuForRow(row), id)) e.preventDefault();
```

The displayed shortcut and the executed action become the *same object*: drift is not merely caught,
it is unrepresentable, and the `disabled` gating (`canEdit`, missing record, …) is honoured for free
without being restated in the handler. Both builders are pure and synchronous — `menuForRow` reads
only cached state (`ProjectTree.vue:112` awaits `loadSavedQueries` *before* calling it, and the
keyboard path needs no saved filters), and `rowMenu` snapshots only the selected rows.

The two pre-existing grid handlers (`onCopy`, `onPaste`) stay exactly where they are and are *not*
routed through `runMenuShortcut`: `onCopy`'s behaviour varies across four selection kinds, which a
single `copy` menu row cannot express. Those two menu rows are tagged for **display only**. This
exception is one line of comment at the tag site.

---

## 2. The binding table

`global: true` rows are emitted by `main/menu.ts`; `global: false` rows are owned by a local,
DOM-focus-scoped keydown handler and must **never** become an accelerator (P6 D1).

| id | chord | mac override | global | Owner | Status |
|---|---|---|---|---|---|
| `app.settings` | `Cmd/Ctrl+,` | — | ✔ | `menu.ts` app menu | existing |
| `app.newConnection` | `Cmd/Ctrl+N` | — | ✔ | `menu.ts` app menu | **new** |
| `view.toggleProjectPanel` | `Cmd/Ctrl+B` | — | ✔ | `menu.ts` View | existing |
| `view.toggleOperationsPanel` | `Cmd/Ctrl+J` | — | ✔ | `menu.ts` View | existing |
| `view.commandPalette` | `Cmd/Ctrl+Shift+P` | — | ✔ | `menu.ts` View | existing |
| `view.find` | `Cmd/Ctrl+F` | — | ✔ | `menu.ts` View | existing |
| `view.refresh` | `F5` | — | ✔ | `menu.ts` View | existing |
| `view.run` | `Cmd/Ctrl+Return` | — | ✔ | `menu.ts` View | existing |
| `view.runAll` | `Cmd/Ctrl+Shift+Return` | — | ✔ | `menu.ts` View | existing |
| `tab.next` | `Control+Tab` | — | ✔ | `menu.ts` Window | existing |
| `tab.prev` | `Control+Shift+Tab` | — | ✔ | `menu.ts` Window | existing |
| `tab.close` | `Cmd/Ctrl+W` | — | ✔ | `menu.ts` Window | existing |
| `window.close` | `Cmd/Ctrl+Shift+W` | — | ✔ | `menu.ts` Window | existing |
| `grid.copy` | `Cmd/Ctrl+C` | — | ✘ | `DataGrid.vue` `onKeydown` | existing |
| `grid.paste` | `Cmd/Ctrl+V` | — | ✘ | `DataGrid.vue` `onKeydown` | existing |
| `grid.edit` | `Enter` | — | ✘ | `DataGrid.vue` `onKeydown` | existing |
| `grid.duplicateRows` | `Cmd/Ctrl+D` | — | ✘ | `DataGrid.vue` `onKeydown` | **new** |
| `grid.deleteRows` | `Delete` | `Cmd+Backspace` | ✘ | `DataGrid.vue` `onKeydown` | **new** |
| `tree.open` | `Enter` | — | ✘ | `ProjectTree.vue` `onTreeKeydown` | **new** |
| `tree.copyName` | `Cmd/Ctrl+C` | — | ✘ | `ProjectTree.vue` `onTreeKeydown` | **new** |
| `tree.copyUri` | `Shift+Alt+C` | `Alt+Cmd+C` | ✘ | `ProjectTree.vue` `onTreeKeydown` | **new** |
| `tree.rename` | `F2` | — | ✘ | `ProjectTree.vue` `onTreeKeydown` | **new** |
| `tree.duplicate` | `Cmd/Ctrl+D` | — | ✘ | `ProjectTree.vue` `onTreeKeydown` | **new** |
| `tree.delete` | `Delete` | `Cmd+Backspace` | ✘ | `ProjectTree.vue` `onTreeKeydown` | **new** |

**Decision (D2): every platform-divergent binding is `global: false`.** Electron accelerators are a
single string per platform-independent binding, and `CmdOrCtrl` covers the only split the global set
needs. The two divergent bindings (`Delete` vs `⌘⌫`) are both local, so `accelerator()` never has to
reconcile a `mac` override and stays a pure `chord → string` join.

**Decision (D3): the table holds bindings that are either global or printed in a menu — nothing
else.** Widget-internal Enter/Escape/Tab/arrow conventions (§3.3) are not menu-reachable, are not
shown in any menu in VS Code or anywhere else, and would add ~15 entries that no consumer reads.
They stay in their components, unchanged.

### VS Code justification for each new binding

| New binding | VS Code command it mirrors | Note |
|---|---|---|
| `Cmd/Ctrl+N` → New connection | `workbench.action.files.newUntitledFile` (`Ctrl/Cmd+N`) | The app's "new thing" is a connection. Needs a visible menu item to hang the accelerator on — D11. |
| `Enter` → open the selected tree row | Explorer `list.select` / `explorer.openAndPassFocus` (`Enter` on Win/Linux) | VS Code's macOS explorer maps `Enter` to rename instead; that divergence is deliberately **not** copied (D7). |
| `Cmd/Ctrl+C` → Copy name (tree) | Explorer `filesExplorer.copy` (`Ctrl/Cmd+C`) | VS Code copies the *file* for a paste; this tree has no paste, so the unambiguous textual meaning is the name. Mirrors the grid's own `⌘C`. |
| `Shift+Alt+C` / `⌥⌘C` → Copy URI | `copyFilePath` (`Shift+Alt+C`, `⌥⌘C` on mac) | The closest true analog in the whole audit: a connection URI *is* its path. Lowest-confidence proposal — see §8 Q1. |
| `F2` → Edit… (connection) | `renameFile` (`F2`) | The Edit… dialog is where a connection is renamed. |
| `Cmd/Ctrl+D` → Duplicate (connection / rows) | *none exists* | VS Code's `Ctrl/Cmd+D` is `addSelectionToNextFindMatch`, editor-scoped, and never fires with the tree or grid focused. Its file-duplicate has no default binding at all. This is the one binding taken from general desktop convention (Finder/Explorer duplicate) rather than VS Code — stated plainly rather than dressed up. |
| `Delete` / `⌘⌫` → Delete | `deleteFile` (`Delete` on Win/Linux, `Cmd+Backspace` on mac) | Exact match, including the platform split. Connection delete is already `window.confirm`-guarded (`menus.ts:231`); grid row delete is a reversible pending change (`toggleDelete`), not a commit. |

---

## 3. The audit — all 104 menu rows

Legend for the **Today** column: `—` no binding; otherwise the binding and the file:line that
implements it. **Proposed**: `—` means no shortcut, with the reason. Display strings shown in the
non-mac form; the mac form is derived by `formatShortcut`.

### 3.1 `src/renderer/project/menus.ts` — 55 rows

**`connectionMenu`** (`:117`, target *Connection*) — 12 rows

| id | Label | Today | Proposed | Reason |
|---|---|---|---|---|
| `disconnect` | Disconnect | — | — | No VS Code analog; a session-lifecycle action that should stay explicit. |
| `connect` | Connect | — | — | Same. Double-click already expands-and-connects. |
| `refresh` | Refresh | — | — | **Not F5** — see D8. |
| `edit` | Edit… | — | **F2** | VS Code `renameFile`. |
| `duplicate` | Duplicate | — | **Ctrl/Cmd+D** | Desktop duplicate convention; see D9's collision analysis. |
| `copy-name` | Copy name | — | **Ctrl/Cmd+C** | Explorer copy. |
| `copy-uri` | Copy URI | — | **Shift+Alt+C** | VS Code `copyFilePath`. |
| `filters` | Filters… | — | — | No VS Code analog (its explorer filter is unbound). |
| `open-console` | Open query console | — | — | D10. |
| `color` | Color ▸ | — | n/a | Submenu trigger — never carries a shortcut (D2). |
| `readonly` | Read-only ✓ | — | — | A per-connection toggle with a confirm on live connections; no analog. |
| `delete` | Delete | — | **Delete** / `⌘⌫` | VS Code `deleteFile`. Already confirm-guarded. |

`color-<swatch>` submenu rows (one per `connectionColorSchema.options` member): — / — — user data.

**`containerMenu`** (`:256`, target *Database / schema / bucket*) — 5 rows

| id | Today | Proposed | Reason |
|---|---|---|---|
| `refresh` | — | — | D8. |
| `copy-name` | — | **Ctrl/Cmd+C** | — |
| `filters` | — | — | No VS Code analog. |
| `open-console` | — | — | D10. |
| `set-as-default` | — | — | Postgres-only console default; no analog. |

**`relationMenu`** (`:285`, target *Table / view / matview*) — 9 rows

| id | Today | Proposed | Reason |
|---|---|---|---|
| `open-data` | — | **Enter** | `tree.open` → `ProjectTree.onOpen`, the same action double-click performs. |
| `open-data-new-tab` | — | — | VS Code's "Open to the Side" is `Ctrl/Cmd+Enter` — **already claimed globally** by `view.run` (D9). |
| `open-definition` | — | — | No analog; the row above already carries the tree's one open binding. |
| `open-console` | — | — | D10. |
| `refresh` | — | — | D8. |
| `copy-name` | — | **Ctrl/Cmd+C** | — |
| `copy-qualified-name` | — | — | Only one copy key can be the obvious one in a scope; `copy-name` has it. |
| `count-rows` | — | — | No analog. |
| `saved-filters` | — | n/a | Submenu trigger. |

`savedFiltersSubmenu` rows (`saved-filter-<id>`, or `saved-filters-empty` when there are none):
— / — — user data, and the empty row is `disabled`.

**`collectionMenu`** (`:367`, target *Collection*) — 8 rows: `open-document` **Enter**;
`open-document-new-tab` — (same `Ctrl+Enter` collision); `open-definition`, `open-console`,
`refresh`, `copy-qualified-name`, `count-documents` all —; `copy-name` **Ctrl/Cmd+C**.

**`groupMenu`** (`:441`, target *Object-kind folder*) — 2 rows: `refresh` — (D8);
`collapse-all` — (VS Code's Collapse All has no default binding; it is a toolbar button there too).

**`namespaceMenu`** (`:463`, *namespace / prefix*) — 2 rows: `refresh` —; `copy-name` **Ctrl/Cmd+C**.

**`keyMenu`** (`:485`, *Redis key*) — 3 rows: `open-keyvalue` **Enter**; `open-keyvalue-new-tab` —;
`copy-name` **Ctrl/Cmd+C**.

**`objectMenu`** (`:520`, *S3 object*) — 3 rows: identical to `keyMenu`.

**`streamNodeMenu`** (`:552`, *topic / queue*) — 3 rows: `open-stream` **Enter**;
`open-stream-new-tab` —; `copy-name` **Ctrl/Cmd+C**.

**`simpleObjectMenu`** (`:611`, *sequence / function / partition / consumerGroup*) — 2 rows:
`copy-name` **Ctrl/Cmd+C**; `copy-qualified-name` —.

**`columnsSectionMenu`** (`:641`, target *Column (definition view)*) — 3 rows:
`copy-name`, `add-to-projection`, `sort-by` — all —. The definition view's Columns section has no
focusable row container and no selection model, so a binding would have nothing to act on
(ground rule 2 / D6).

**`emptyBackgroundMenu`** (`:683`, target *Empty tree background*) — 3 rows:
`new-connection` **Ctrl/Cmd+N** (D11); `refresh-all` —; `collapse-all` —.

### 3.2 The other 6 files — 49 rows

**`TabStrip.vue:58`** (target *Tab*) — 7 rows

| id | Today | Proposed | Reason |
|---|---|---|---|
| `close` | **`Cmd/Ctrl+W`** — `main/menu.ts:110` → `IPC.tabClose` → `App.vue:32` `closeActiveTab()` | display it | The key closes the *active* tab, the menu row closes the *clicked* tab. VS Code prints `⌘W` on this exact row under the same discrepancy — see D13. |
| `close-others` | — | — | No VS Code default. |
| `close-to-the-right` | — | — | No VS Code default. |
| `close-all` | — | — | VS Code's is the chord `Ctrl+K Ctrl+W`; chords unsupported. |
| `duplicate-tab` | — | — | `Ctrl/Cmd+D` is owned by two *local* scopes; a global accelerator would swallow both (D9). |
| `copy-name` | — | — | Same reasoning for `Ctrl/Cmd+C`. The tab strip has no focus/selection concept, so any binding here must be global. |
| `reveal-in-project-panel` | — | — | VS Code's "Reveal in Explorer View" has no default binding. |

**`OperationsPanel.vue:107`** (target *Operations log row*) — 5 rows: `reveal-tab`,
`copy-command`, `copy-error`, `re-run`, `cancel` — all —. Two independent reasons: no focusable row
container (D6), and the panel's rows are deliberately `user-select: text` (`:330`), so `Ctrl/Cmd+C`
there is the native text-copy — hijacking it would break selecting part of a SQL string, which is
the whole point of that rule.

**`gridMenu.ts` `cellMenu`** (`:147`, target *Grid cell*) — 8 rows + dynamic FK rows

| id | Today | Proposed | Reason |
|---|---|---|---|
| `copy` | **`Cmd/Ctrl+C`** — `DataGrid.vue:886-891` → `onCopy()` cell branch (`:775`) | display it | Display-only tag (D5). |
| `copy-with-header` | — | — | No analog. |
| `copy-as-json` | — | — | VS Code's Copy-as variants are chords or unbound. |
| `paste` | **`Cmd/Ctrl+V`** — `DataGrid.vue:892-896` → `onPaste()` (`:816`) | **new menu row**, display it | D12 — an existing, guarded handler with no menu row today. |
| `edit` | **`Enter`** — `DataGrid.vue:899-903` → `startEdit()` | display it | — |
| `set-null` | — | — | `Delete` is claimed by row-delete in this same scope, and "clear to NULL" vs "clear to empty string" is exactly the ambiguity a bare Delete key would introduce on a nullable column. |
| `filter-by-value` | — | — | No analog. |
| `go-to-referenced-<fk>` | — | — | Dynamic, one row per FK edge. |
| `referenced-by` | — | n/a | Submenu trigger. |

**`gridMenu.ts` `rowMenu`** (`:225`, target *Grid row*) — 7 rows

| id | Today | Proposed | Reason |
|---|---|---|---|
| `copy-rows` | — | n/a | Submenu trigger. |
| `copy-rows-tsv` | **`Cmd/Ctrl+C`** — `DataGrid.vue:796` `onCopy()` row branch → `rowsToTsv` | display it | The row-selection branch produces byte-identical output to this item. |
| `copy-rows-csv` / `-json` / `-insert` | — | — | One copy key per scope; TSV is the default the handler already produces. |
| `duplicate-row` | — | **Ctrl/Cmd+D** | Acts on the whole row selection, exactly as the menu row does. |
| `delete-row` | — | **Delete** / `⌘⌫` | VS Code `deleteFile`. Safe: `toggleDelete` stages a reversible pending change, it does not commit. |

**`gridMenu.ts` `headerMenu`** (`:292`, target *Grid header*) — 7 rows

| id | Today | Proposed | Reason |
|---|---|---|---|
| `sort-asc` / `sort-desc` / `clear-sort` | — | — | No VS Code analog; header click already cycles sort. |
| `hide-column` / `show-all-columns` | — | — | No analog. |
| `copy-column-name` | — | — | See below — `⌘C` in this scope means *values*. |
| `copy-column-values` | **`Cmd/Ctrl+C`** — `onHeaderContextMenu` (`:750`) sets a `column` selection; `onCopy`'s final branch (`:798-810`) copies that column's loaded values | display it | Reality 6. An already-working binding that has never been shown anywhere. |

**`documentMenu.ts`** (`:7`, target *Document*) — 7 rows: `expand-all`, `collapse-all`,
`toggle-expanded`, `copy-document`, `copy-id`, `edit-document`, `delete-document` — all —.
Fold/unfold-all in VS Code are chords (`Ctrl+K Ctrl+0` / `Ctrl+K Ctrl+J`), and the remaining four
run into ground rule 2: `DocumentView.vue` has a `selectedRow` but no focusable container, so
`Delete`/`⌘C`/`Enter` would have no focus scope to fire in. §5 names this as the follow-up.

**`keyValueMenu.ts`** (`:11`, target *Key/value row*) — 4 rows: `copy-field`, `copy-value`,
`edit-value`, `delete-key` — all —, same reason (`KeyValueView.vue` has neither a focusable
container nor a row selection).

**`streamMenu.ts`** (`:7`, target *Stream row*) — 2 rows: `copy-key`, `copy-body` — all —, same
reason.

### 3.3 Keyboard handling found that stays out of the table

Every `keydown` site in `src/renderer/`, confirmed not menu-reachable and left untouched (D3):

`DataGrid.vue:541` edit-input Enter/Escape · `DataGrid.vue:905-935` arrow/Shift+arrow selection ·
`CellEditorView.vue:181` `Cmd/Ctrl+Enter` save (see D9's note) · `SearchToolbar.vue:94`,
`DocumentSearchToolbar.vue:84`, `KeyValueSearchToolbar.vue:87`, `StreamSearchToolbar.vue:45`
Escape/Enter/Shift+Enter · `ProjectPanel.vue:15` printable-char type-ahead ·
`CommandPalette.vue:35` arrows/Enter/Escape · `DialogFrame.vue:38` Escape + Tab focus trap ·
`Popover.vue:56`, `ErrorPopover.vue:50`, `ContextMenu.vue:39` Escape ·
`AutocompleteField.vue:133` completion navigation · `KeyValueView.vue:499/533`,
`FilterHistoryMenu.vue:193-194`, `ConsoleSavedMenu.vue:138`, `TextField.vue:70` Enter/Escape.

**Totals: 104 menu rows audited across 21 builders. 5 already-bound rows surfaced for the first
time, 14 rows receive a newly proposed binding, 9 new bindings in total (one covers 10 menus'
`copy-name` rows, one covers 4 menus' `open-*` rows), 1 new menu row.**

---

## 4. Rendering

**Decision (D14 — layout).** A `.shortcut` span between `.label` and the optional check icon, in
both the top-level row (`ContextMenu.vue:103`) and the submenu row (`:133`):

```html
<span class="label">{{ item.label }}</span>
<span v-if="item.shortcut" class="shortcut" :data-testid="`menu-item-${item.id}-shortcut`">
  {{ formatShortcut(item.shortcut) }}
</span>
<span v-if="item.checked" class="icon-box">…</span>
```

```css
.shortcut {
  margin-left: var(--kira-s-4);
  color: var(--kira-fg-muted);
  flex-shrink: 0;
  white-space: nowrap;
}
.row.is-disabled .shortcut { color: var(--kira-fg-disabled); }
```

- `--kira-fg-muted` (`tokens.css:8`, `#9d9d9d`) is the token `.item-icon` and `.caret` already use
  in this exact component — the same muted register, not a new one.
- `.label` is already `flex: 1`, so the shortcut right-aligns with no extra rule. Same font size as
  the label, dimmed — VS Code's own treatment.
- Explicit muted colour on danger rows too (`.row.danger` sets `color: var(--kira-error)`; the
  shortcut must not go red — VS Code keeps it dimmed on its Delete row).
- Disabled rows dim the shortcut with the row (`--kira-fg-disabled`) rather than inheriting.
- No shortcut ever co-occurs with a checkmark in the audited set (`Read-only`, `Set as default` and
  the colour swatches are the only `checked` rows and none carries a binding), so the ~20px the
  check box would steal from the right edge never happens in practice.
- `.context-menu`'s `min-width: 180px` and `white-space: nowrap` on `.row` already make the surface
  grow to fit; no width change needed.

**Decision (D4 — platform display).** `export const isMac = navigator.userAgent.includes('Mac');`
evaluated once at module load in `renderer/shortcuts/keys.ts`. `AppInfo` is async and menus build
synchronously (reality 10), so extending it is the wrong shape; the UA string is fixed for the
process lifetime and needs no bridge. Format, matching VS Code exactly:

| | Modifier order | Separator | Examples |
|---|---|---|---|
| macOS | `⌃ ⌥ ⇧ ⌘` (Apple HIG) | none | `⌘C`, `⇧⌘P`, `⌥⌘C`, `⌘⌫`, `⏎`, `F2`, `⌃⇥` |
| Windows / Linux | `Ctrl+ Alt+ Shift+` | `+` | `Ctrl+C`, `Ctrl+Shift+P`, `Shift+Alt+C`, `Delete`, `Enter`, `F2`, `Ctrl+Tab` |

Key glyph map — mac: `Return→⏎`, `Backspace→⌫`, `Delete→⌦`, `Tab→⇥`, `Escape→⎋`, letters upper-case.
Non-mac: `Return→Enter`, `Escape→Esc`, everything else verbatim.

`matchesShortcut(id, e)` compares against the resolved chord (`mac ?? chord`), maps the accelerator
key names to DOM ones (`Return→Enter`), compares letters case-insensitively, treats `cmdOrCtrl` as
`isMac ? e.metaKey : e.ctrlKey` **and requires the other one to be false**, and requires
`e.shiftKey`/`e.altKey` to match exactly — so `⌘C` does not fire on `⇧⌘C`.

---

## 5. Collisions found, and how each was resolved

- **D8 — `F5` vs. the tree's per-row Refresh.** `F5` is `view.refresh`, a *global* accelerator that
  `runCommand`-dispatches to whichever view is mounted (`DataView.vue:102`, `DefinitionView.vue:76`,
  `KeyValueView.vue:369`, `StreamView.vue:380`, `DocumentView.vue:406`) — i.e. it refreshes the
  **active tab**. Every tree menu's `refresh` calls `refresh(connectionId, path)`, a different
  action on a different object. Printing `F5` on those 8 rows would be a lie, and scoping `F5` to
  the tree is impossible without removing it from the native menu (a global accelerator fires
  regardless of DOM focus). Resolution: **the tree's Refresh rows print nothing.**
- **D9 — `Ctrl/Cmd+Enter`, `Ctrl/Cmd+C`, `Ctrl/Cmd+D` across scopes.**
  - `Ctrl/Cmd+Enter` is VS Code's "Open to the Side" and would fit *Open in new tab* — but it is
    already `view.run` (`menu.ts:77`), a global accelerator. **Declined**, all four `*-new-tab` rows
    print nothing.
  - `Ctrl/Cmd+C` is claimed by the native Edit menu's `role: 'copy'`. Reality 5 is why the grid's
    local handler already works despite that, and why the tree can do the same. Both are
    `global: false` and mutually exclusive by DOM focus. The operations panel is explicitly excluded
    because its rows *are* selectable text. **No global `Ctrl/Cmd+C` is added**, which is also why
    the tab strip's `copy-name` gets nothing.
  - `Ctrl/Cmd+D` is unbound everywhere in this app today (checked against every accelerator in
    `menu.ts` and every keydown site in §3.3). It is taken by two local scopes (tree, grid) that
    can never both have focus. It must **not** also become a global accelerator for *Duplicate tab*
    — an accelerator fires before the renderer keydown and would swallow both local handlers. That
    is precisely why `duplicate-tab` gets no shortcut.
  - `Ctrl/Cmd+Enter` in the cell editor (`CellEditorView.vue:181`) coexists with the global
    `view.run` today: on a data tab `view.run` has no registrant and no-ops, and on a console tab
    the cell editor is not showing. Unchanged by this phase; recorded so it is not re-discovered.
- **`Delete` / `⌘⌫`.** Unbound in both target scopes today — `DataGrid.onKeydown` ignores it
  entirely, and `ProjectPanel.vue`'s type-ahead explicitly skips any `e.key.length !== 1`. In the
  grid it must fire **only** when `selection.kind === 'row'`; a cell or range selection must leave
  it inert, so `Delete` never silently deletes a row you were only reading. `runMenuShortcut`
  gives this for free — `rowMenu` is only built for a row selection.
- **`F2`.** Unbound app-wide. Applies to connection rows only (only `connectionMenu` has `edit`).
- **`Ctrl/Cmd+N`.** Unbound app-wide.
- **`Shift+Alt+C` / `⌥⌘C`.** Unbound app-wide.
- **Ordering inside the project panel.** The new `ProjectTree` handler is a descendant of
  `ProjectPanel`'s type-ahead handler, so it runs first on the bubble path; and the type-ahead
  handler ignores every key the new one claims anyway. It must still bail when the event originates
  inside an `input, textarea, [contenteditable="true"]` — the same guard `ProjectPanel.vue:27`
  already uses — so typing `d` in the tree search box never duplicates a connection.

**Decision (D6): a keydown scope is added only where a focusable container and a selection already
exist.** That is the grid and the tree. The document, key/value, stream, definition-Columns and
operations surfaces are excluded — §6.

**Decision (D7): `Enter` opens, it does not rename.** VS Code's macOS explorer maps `Enter` to
rename and `⌘↓` to open; its Windows/Linux explorer maps `Enter` to open. A DB client that renames
a connection on `Enter` on one platform and opens a table on another is worse than either. This app
takes the non-divergent meaning on every platform, and `F2` is rename everywhere.

**Decision (D10): "Open query console" gets no binding.** VS Code's nearest analog is
`Ctrl+Shift+\`` (New Terminal), but a console tab needs a *connection*, which the menu row gets from
the right-clicked row. A global New-Terminal-style key would have to silently pick the tree's
current selection — surprising whenever the tree is not what you are looking at.

**Decision (D13): a tab-scoped shortcut prints on the tab menu even though the key acts on the
active tab.** `⌘W` closes the active tab; right-clicking an inactive tab and choosing Close closes
that one. VS Code prints `⌘W` on this exact row under this exact discrepancy: the printed key is
"the keyboard route to this command", targeted at whatever is active. Copying that is correct, and
the alternative (print nothing) hides the app's single most-used binding.

---

## 6. Explicitly out of scope

- **User-configurable / rebindable shortcuts.** §8.16 says "not remappable in v1" and this phase
  does not change that. What it *does* deliver is the precondition §8.16 names — the single data
  file — so remapping stays a later feature rather than a rewrite.
- **A shortcut cheat-sheet or help overlay.** Not implied by the ask (which is specifically about
  menus), and it would be a new surface with its own layout, search and scroll behaviour. The
  command palette already lists the named global commands.
- **Shortcut hints in the command palette.** VS Code shows them there too and this phase's
  `formatShortcut` would make it a few lines — but `paletteCommands` (`shortcuts/state.ts:18`) keys
  on its own ids, not `ShortcutId`, and reconciling those two id spaces is a separate decision.
  Named here so it is a deliberate omission, not an oversight.
- **Making the document / key/value / stream / operations views keyboard-actionable.** This is the
  single largest thing left out, and D6 is why: each needs a focusable container, a focus ring, and
  arrow-key row navigation before `Delete`/`⌘C`/`Enter` mean anything there. Doing it half-way —
  a keydown handler on a container nothing can focus — is exactly the stubbing AGENTS.md forbids.
  Follow-up phase, named.
- **Arrow-key navigation in the project tree.** Same reason; `tree.open` is reachable after a click
  selects a row, which is the flow the tree already has.
- **Chord bindings.** No dispatcher exists and Electron accelerators cannot express them, so every
  action whose VS Code binding is a chord (Close All Editors, Fold All, Unfold All, Copy Relative
  Path) gets nothing rather than a single-stroke invention.
- **Touching the `role`-based Edit-menu items** (undo/redo/cut/copy/paste/selectAll). Their OS
  accelerators are what makes text editing work in every `<input>`; they stay literal (reality 4).
- **Any adapter, engine or storage change.**

---

## 7. Implementation order

Each step is independently verifiable; `bun run lint && bun run typecheck && bun run build` after
every one.

1. **`src/shared/shortcuts.ts`** — `Chord`, `Binding`, the 22-entry `SHORTCUTS` table from §2,
   `ShortcutId`, `accelerator(id)`. Nothing imports it yet. *Verify:* typecheck passes; the table
   compiles under `satisfies Record<string, Binding>`.
2. **`src/renderer/shortcuts/keys.ts`** — `isMac`, `formatShortcut(id)`, `matchesShortcut(id, e)`,
   and `shortcutFor(e, ids)` (first id in `ids` that matches, else `null`).
3. **`main/menu.ts` reads the table.** Replace the 13 literal accelerator strings with
   `accelerator('…')`. No behaviour change. *Verify:* `bun run dev`, every menu-bar item still shows
   the same key it showed before.
4. **`MenuItem.shortcut` + `runMenuShortcut`** in `workbench/state/contextMenu.ts`, and the
   `.shortcut` span + CSS in `ContextMenu.vue` (both the item row and the submenu row). Nothing sets
   the field yet, so nothing renders — the component must be unchanged on screen at this point.
5. **Tag every already-bound row (display only)** — `TabStrip.vue` `close` → `tab.close`;
   `gridMenu.ts` `copy` → `grid.copy`, `edit` → `grid.edit`, `copy-rows-tsv` → `grid.copy`,
   `copy-column-values` → `grid.copy`. *Verify:* right-click a tab and a grid cell/row/header —
   `⌘W` / `⌘C` / `⏎` appear right-aligned and dimmed; `bun run test:ui` still green.
6. **`Ctrl/Cmd+N` → New connection.** `IPC.newConnection` channel + `KiraApi.onNewConnection`
   (`shared/protocol/ipc.ts`), preload relay, `bridge/control.ts` passthrough,
   `App.vue` `control.onNewConnection(() => openCreateDialog())`, a `New Connection` item with
   `accelerator('app.newConnection')` in `menu.ts`'s app menu above `Settings…`, and
   `shortcut: 'app.newConnection'` on `emptyBackgroundMenu`'s `new-connection` row.
   *Verify:* `⌘N` opens the connection dialog from anywhere; the item shows `⌘N` in the app menu and
   in the empty-background context menu.
7. **The grid's two new bindings.** Tag `duplicate-row` → `grid.duplicateRows` and `delete-row` →
   `grid.deleteRows` in `rowMenu`; in `DataGrid.onKeydown`, after the existing copy/paste branches
   and before the selection branch, resolve `shortcutFor(e, ['grid.duplicateRows',
   'grid.deleteRows'])` and, when the current selection is `kind: 'row'`, dispatch it through
   `runMenuShortcut(rowMenu({…}), id)` with the same arguments `onGutterContextMenu` (`:715`) passes.
   *Verify:* select rows, press `Delete` → the same strikethrough pending-delete the menu produces,
   and `Ctrl/Cmd+D` → the same pending inserts; both inert on a read-only or PK-less table
   (`canEdit: false` disables the rows and `runMenuShortcut` skips disabled items) and inert with a
   cell selection.
8. **D12's Paste row.** Add `onPaste` and `canEdit` to `CellMenuContext`, a `paste` item
   (`icon: 'clippy'`, `disabled: !ctx.canEdit`, `shortcut: 'grid.paste'`) after `copy-as-json` and
   before the separator, and pass the callbacks from `DataGrid.onCellContextMenu` (`:725`).
   *Verify:* the row runs the same paste `⌘V` does, and is disabled where `⌘V` no-ops.
9. **The tree's keydown scope.** Tag the 14 tree menu rows from §3.1 (`open-data`,
   `open-document`, `open-keyvalue` ×2, `open-stream`, the 10 `copy-name` rows, `edit`, `duplicate`,
   `copy-uri`, `delete`). Add `onTreeKeydown` to `ProjectTree.vue`'s `.tree-body`: bail if the event
   came from `input, textarea, [contenteditable="true"]`; resolve the selected `TreeRowVm` from
   `visibleRows` by `treeState.selected`; `Enter` calls `onOpen(row)` directly (it is the
   double-click action, not a menu item — comment that at the call site); every other id goes
   through `runMenuShortcut(menuForRow(row), id)`. `preventDefault()` only when something ran.
   *Verify:* click a table row → `Enter` opens it, `⌘C` copies its name; click a connection row →
   `F2` opens Edit…, `⌘D` duplicates, `⌥⌘C`/`Shift+Alt+C` copies the URI, `Delete`/`⌘⌫` prompts and
   deletes. Typing in the tree search box does none of these.
10. **D14's `view.find` gap.** Register `view.find` alongside the existing `view.refresh`
    registration in `DocumentView.vue:406`, `KeyValueView.vue:369` and `StreamView.vue:380`,
    each toggling that view's own `rt.searchOpen` exactly as `DataView.vue:98` does.
    *Verify:* `⌘F` opens the search toolbar in all five searchable views.
11. **`docs/SPEC.md`** — §8.10, §8.16, §10 (§8).
12. **`tests/ui/interaction.spec.ts`** — §9's assertions.

---

## 8. File-by-file diff shape

| File | Change |
|---|---|
| `src/shared/shortcuts.ts` | **new**, ~90 lines — types, 22-entry table, `accelerator()` |
| `src/renderer/shortcuts/keys.ts` | **new**, ~70 lines — `isMac`, `formatShortcut`, `matchesShortcut`, `shortcutFor` |
| `src/renderer/workbench/state/contextMenu.ts` | `shortcut?: ShortcutId` on the `item` variant; `runMenuShortcut()` (~12 lines) |
| `src/renderer/workbench/ContextMenu.vue` | two `<span class="shortcut">` (item row + submenu row), one import, 2 CSS rules |
| `src/main/menu.ts` | 13 literals → `accelerator(…)`; one new `New Connection` item |
| `src/shared/protocol/ipc.ts` | `newConnection` channel + `onNewConnection` on `KiraApi` |
| `src/preload/index.ts` | `onNewConnection` relay (5 lines, same shape as its 10 neighbours) |
| `src/renderer/bridge/control.ts` | `onNewConnection` passthrough (1 line) |
| `src/renderer/App.vue` | one `control.onNewConnection(…)` subscription |
| `src/renderer/project/menus.ts` | `shortcut:` on 15 rows; no structural change |
| `src/renderer/project/ProjectTree.vue` | `onTreeKeydown` (~20 lines) + `@keydown` on `.tree-body` |
| `src/renderer/views/grid/gridMenu.ts` | `shortcut:` on 5 rows; `paste` row + 2 `CellMenuContext` fields |
| `src/renderer/views/grid/DataGrid.vue` | 2 args into `cellMenu`; one dispatch branch in `onKeydown` (~8 lines) |
| `src/renderer/workbench/panels/TabStrip.vue` | `shortcut: 'tab.close'` on one row |
| `src/renderer/views/documents/DocumentView.vue` | `registerCommand('view.find', …)` |
| `src/renderer/views/keyvalue/KeyValueView.vue` | same |
| `src/renderer/views/stream/StreamView.vue` | same |
| `docs/SPEC.md` | §8.10 items annotated with their keys + a notation note; §8.16 rewritten to name the binding table and list the set; §10 P21 row |
| `tests/ui/interaction.spec.ts` | §9's new assertions |

### SPEC.md changes

- **§8.10** — annotate each item that has a binding, e.g. `Copy name \`Ctrl/Cmd+C\``,
  `Edit \`F2\``, `Delete \`Delete\`/\`Cmd+⌫\``, `Close \`Ctrl/Cmd+W\``, with one notation line above
  the table ("keys are shown Windows/Linux-first; macOS renders the ⌘/⇧/⌥ glyph form"). Add
  **Paste** to the Grid cell row (the only item-set change). This makes §8.10 the canonical
  "what's in the menu *and* what key it has" table, which is a concrete deliverable in its own right.
- **§8.16** — rewrite to name `src/shared/shortcuts.ts` as the single binding table §8.16 already
  promises, state the global/local split and why it exists (P6 D1), and list the added set.
- **§10** — the P21 row (§10 below).

### The §10 phasing row

> | **P21 Menu shortcut hints** | Every context-menu item that has a keyboard shortcut prints it alongside its label, VS Code style — muted and right-aligned. A single shared binding table (`src/shared/shortcuts.ts`) becomes the one source of truth §8.16 already promised, feeding the native menu bar's accelerators, the context menus' displayed keys, and the local DOM-scoped keydown handlers alike, so a printed key and the key that runs can no longer drift. Audits all 104 context-menu rows across 21 builders, surfaces 5 bindings that already worked but were never shown, and adds 9 new ones following VS Code's own conventions (F2 rename, Delete/⌘⌫ delete, Ctrl/Cmd+C copy, Ctrl/Cmd+N new, Enter open, Shift+Alt+C copy path, plus duplicate on Ctrl/Cmd+D) scoped to the two surfaces that already have focus and selection — the project tree and the SQL grid | The right-click matrix (P6) and every view that feeds it are complete, so the audit can be exhaustive rather than provisional; and the binding table has to exist before shortcuts can be shown, let alone remapped |

---

## 9. Acceptance checklist

**Automated**

- [ ] `bun run lint`, `bun run typecheck` (all three projects), `bun run build` clean.
- [ ] `xvfb-run -a bun run test:ui` green — in particular the ~30 existing
      `[data-testid="menu-item-…"]` click assertions across `connections`, `tree`, `tabs`,
      `data-view`, `console`, `autocomplete`, `budgets`, `definition`, `cell-editor` specs, none of
      which may change.
- [ ] New assertions in `tests/ui/interaction.spec.ts`:
      - a tab's context menu row `menu-item-close` contains a `-shortcut` span whose text matches
        `/^(⌘W|Ctrl\+W)$/`;
      - a grid cell menu's `menu-item-copy` and `menu-item-edit` likewise (`⌘C`/`Ctrl+C`, `⏎`/`Enter`);
      - `menu-item-paste` exists in the cell menu and is disabled on a read-only connection;
      - a row-menu `menu-item-delete-row` shows the Delete key, and pressing `Delete` with a row
        selection produces the same pending-delete state the menu item does;
      - `Ctrl/Cmd+D` on a selected connection row creates a duplicate (asserted via the tree's row
        count), and `F2` opens the connection dialog;
      - `menu-item-refresh` on a tree row has **no** `-shortcut` span (D8's guard against the
        regression this phase is most likely to introduce later);
      - `Ctrl/Cmd+F` opens the search toolbar in the document, key/value and stream views.

**Manual (not catchable by the suites)**

- [ ] Shortcut text is right-aligned, vertically centred, one row height, and does not wrap or
      clip in any of: the connection menu (longest labels), the grid row menu, and the `Copy row(s)`
      submenu.
- [ ] Shortcut stays muted grey — not red — on the `Delete` row, and dims with the row when the
      item is disabled.
- [ ] On macOS the glyph form renders (`⌘C`, `⇧⌘P`, `⌘⌫`, `⏎`) with the correct `⌃⌥⇧⌘` order and no
      `+` separators; on Linux the `Ctrl+C` / `Delete` / `Enter` form renders. Both checked against
      the same menu.
- [ ] Every menu-bar accelerator is unchanged after step 3's refactor (compare against `git stash`
      of the old menu, item by item).
- [ ] `Delete` with a *cell* selection in the grid does nothing; with a *row* selection it stages
      the delete. `Ctrl/Cmd+D` likewise.
- [ ] Typing `d`, `n` or `f2`-adjacent characters into the tree search box never triggers a tree
      shortcut.
- [ ] `Ctrl/Cmd+C` still copies selected *text* inside every `<input>`, the cell editor, the console
      editor and the operations panel's log rows (the `role: 'copy'` path is untouched).

---

## 10. Open questions for the user

1. **`Shift+Alt+C` / `⌥⌘C` for Copy URI** is the most faithful VS Code mapping in the whole audit
   (`copyFilePath`) but also the most obscure key in the proposed set, and it is useful only on
   connection rows. Keep it, or trim the new set to eight? The plan assumes keep.
2. **`Ctrl/Cmd+D` for Duplicate** is the one binding with no true VS Code equivalent — VS Code's
   `Ctrl/Cmd+D` is `addSelectionToNextFindMatch` (editor-scoped, never fires in the tree or grid)
   and its file-duplicate has no default binding at all. The proposal takes it from Finder/Explorer
   convention instead. Accept the convention swap, or leave Duplicate unbound?
3. **The grid-cell Paste row** (D12) is the only *new menu row* in the phase and changes §8.10's
   item list. It surfaces a paste handler that has existed since P6 and is otherwise
   undiscoverable. Assumed in.
