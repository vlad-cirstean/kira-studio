# P26 — The cell editor moves inside the data view

> **SPEC.md §10, the P26 row, verbatim:** *"The cell editor panel is a workbench-global singleton
> today, mounted once outside any per-tab component tree; it is not scoped to the view showing it,
> so switching tabs can leave it rendering the previous tab's cell until a new cell is clicked in
> the new tab. It becomes owned by each data-shaped view instead — mounted and torn down with the
> view, like every other per-tab piece of state — so a tab switch cannot leave it stale, and a view
> kind can opt out of it entirely (Mongo's document view has no real use for it in its current
> form, see P27)."*
>
> **The user's own words:** *"The cell view is tightly linked to the view there is. It should
> actually be moved inside the data view. Right now i change the dab but cell virew shows me data
> from the previous one. And for smth like mongo it doesn t even make sense to be there."*
>
> **What this phase is.** A renderer-only ownership/lifecycle fix. No adapter, no IPC, no storage,
> no engine, no protocol change — `tests/db/` is untouched end to end. The panel keeps every
> feature P3/P5/P24 gave it (format autodetect and override, beautify, translate panes, staging on
> blur, the read-only reasons); the only thing that changes is *who mounts it* and *how the
> selection it renders is keyed*.
>
> **What this phase is not.** It is not P27. Mongo's document view keeps its cell editor working
> exactly as it does today (D9) — this phase makes it non-stale, and nothing else. Hiding,
> removing or relocating it for Mongo is P27's plan's job, and D9 states the seam so the two plans
> cannot silently disagree.

## 0. Ground rules for this phase

- **Do not invent a lifecycle pattern — the repo already has one.** `MainView.vue:67-92` keys every
  view by `tab.id`; `DataView.vue:18-20` writes the rule down in its own header comment. The cell
  editor becomes one more thing a keyed view mounts. Nothing in this phase may reach for a
  `Teleport`, a shell-level slot, a `provide`/`inject` chain, or a second global mount point — all
  three are the singleton this phase exists to delete, wearing a different hat.
- **One seam stays one seam.** `state/cellSelection.ts` remains the only thing that crosses between
  a view and the cell editor (§11: `views/celleditor/` may not import `views/grid/`, and no view
  may import another). This phase re-keys that module; it does not add a second channel and does
  not move it out of `state/`.
- **Behaviour parity except for the bug.** After this phase, every interaction that works today
  works identically: the same testids, the same `data-cell-key`/`data-format`/`data-dirty`
  attributes, the same staging-on-blur, the same session-only format overrides sticking per
  (connection, path, column) across tabs. The single intended behaviour change is that a tab switch
  can no longer show another tab's cell.
- **No half-move.** When the panel is view-owned, the shell keeps *nothing* of it: no grid rows, no
  `cellVisible` computed, no `CellEditorPanel.vue` pass-through, no import of `cellSelection` in
  `WorkbenchShell.vue`. Leaving a dormant shell slot "in case" is exactly the half-implementation
  AGENTS.md forbids.
- **No dead code left behind.** `CellEditorView.vue`'s unreachable "No cell selected" branch (F9)
  goes with the move rather than being carried forward into a component that can no longer be
  mounted without a cell.
- **Comments per AGENTS.md** — only where the code cannot say it for itself. Three comments in the
  current code exist purely to explain the singleton's ordering hazard (`DataGrid.vue:278-281`,
  `DocumentView.vue:413-415`, `cellSelection.ts:39-40`); this phase **deletes** them along with the
  hazard rather than editing them to describe a new one.
- **Green after every commit:** `bun run lint`, `bun run typecheck`, `bun run build`, plus the four
  container-free UI specs that actually run in this environment (`smoke`, `startup`, `workbench`,
  `connections` — AGENTS.md's Electron-binary note). `bun run test:db` is untouched by this phase
  and must stay green. The container-backed specs (`cell-editor`, `data-view`, `budgets`,
  `definition`, `interaction`, `console`, `mongo`, `redis`, `kafka`, `sqs`) need a real run in CI or
  the macOS/Colima box before this phase is called verified — same caveat P24 recorded for itself.

## 1. Findings (verified against the tree, not assumed)

### The singleton and how it goes stale

**F1 — the panel is mounted once, outside every per-tab component tree.**
`WorkbenchShell.vue:71-78` renders `<CellEditorPanel />` into its own CSS-grid area (`grid-area:
cell`), a sibling of `.editor-area` (`:56-59`) rather than a descendant of it.
`workbench/panels/CellEditorPanel.vue` is a **seven-line pass-through** — it imports
`views/celleditor/CellEditorView.vue` and renders it with no props at all. It exists only because
the shell needed something to name in that grid area.

**F2 — the selection seam is a single unkeyed slot.** `state/cellSelection.ts:37`:

```ts
export const cellSelectionState = reactive<{ current: SelectedCell | null }>({ current: null });
```

`SelectedCell` *carries* a `tabId` (`:8`), but that field is used for exactly two things today:
`cellKey()` (`:51-53`, which feeds the `data-cell-key` attribute several specs assert on) and the
guard inside `clearSelectedCellFor()` (`:46-48`). The slot itself is keyed by nothing — whoever
published last wins, regardless of which tab they belong to. `CellEditorView.vue:30` reads it
directly (`const cell = computed(() => cellSelectionState.current)`), and `WorkbenchShell.vue:23`
derives the panel's visibility from the same slot.

**F3 — there are five publishers, and only two of them maintain the slot across a tab switch.**

| Publisher | Publishes on mount? | Clears on unmount? |
|---|---|---|
| `views/grid/DataGrid.vue:467-512` | yes — `watch([selection, pageVersion, tabId], …, { immediate: true })`, and publishes `null` at `:474`/`:479` when there is no single-cell target | yes — `clearSelectedCellFor(props.tabId)` at `:285` |
| `views/documents/DocumentView.vue:371-400` | yes — same `immediate` watch shape, `null` at `:377` | yes — `:419` |
| `views/keyvalue/KeyValueView.vue:284-309` | **no** — publishes only from `onRowClick` | **no** — `onUnmounted` (`:371-374`) unregisters commands and nothing else |
| `views/stream/StreamView.vue:136-160` | **no** — publishes only from `onCellClick` | **no** — `onUnmounted` (`:384-387`) |
| `views/console/ConsoleResultGrid.vue:68-77` | **no** — publishes from `selectTabularCell`/its document and key-value siblings | **no** — the component has no `onUnmounted` at all |

**F4 — the exact staleness mechanism, and why the two "correct" views are only correct by
accident.** Vue queues `onUnmounted` through `queuePostRenderEffect`, so on a tab switch the
**new** view mounts and its `immediate` watch runs *before* the **old** view's unmount hook fires.
Both files already say so in their own words — `DataGrid.vue:278-281` ("switching tabs unmounts one
grid and mounts another in an order that is not safe to rely on. The guard means a late unmount
here cannot clobber the freshly mounted tab's publication") and `DocumentView.vue:413-415`. So the
grid and the document view stay correct only because (a) they republish immediately on mount and
(b) `clearSelectedCellFor` is tab-id-guarded. The other three publishers have neither half.
Concretely, the panel keeps rendering the **previous** tab's cell whenever the tab being left is a
`keyvalue`, `stream` or `console` tab and the tab being entered is anything that does not publish
on mount — another `keyvalue`/`stream`/`console` tab, or a `definition` tab. That is the user's
report, reproducible without Mongo: click a Redis field, switch to a definition tab, and the panel
still shows the Redis field.

**F5 — a fifth, quieter symptom of the same cause: KeyValue's selection has nowhere else to live.**
`views/keyvalue/state.ts` has no selected-row field at all (grep for `select` in that file: no
matches) — unlike `views/grid/state.ts:29` (`selection: Selection | null`),
`views/stream/state.ts:32` (`selectedRow`) and the document view's own runtime. For a Redis/S3 tab,
the published `SelectedCell` **is** the only record that a row was ever clicked. This is why a
naive fix ("clear the slot whenever a view unmounts") would make things worse for that view kind
rather than better — see D6.

### The pattern this phase is supposed to copy

**F6 — `MainView.vue` already keys every view by tab id, and `DataView.vue` documents what that
buys.** `MainView.vue:67-92` is a six-branch `v-if`/`v-else-if` chain, every branch
`:key="activeTab.id"`. `DataView.vue:18-20`:

> *"MainView.vue keys this component by tab.id, so one instance <-> one tab: onMounted below fires
> fresh on every tab switch, which is what makes per-tab load-on-activate and scroll restore
> (DataGrid's own onMounted) work without a manual watcher."*

**F7 — moving shell chrome into the views is not a new idea here; it is the established direction.**
`DataView.vue:42-45` and `:162-164` record that P16 moved the toolbars out of a shell-level
`Toolbar.vue` into each view ("only who mounts them changed"). `views/*/…View.vue` also mount
`ViewChrome.vue`, `VirtualList.vue` and the context-menu service from `workbench/` today
(`KeyValueView.vue:21-22`, `StreamView.vue:20-21`, `DocumentView.vue:23-24`,
`ConsoleView.vue:15`, `ConsoleResultGrid.vue:7`, `DataGrid.vue:19`). §11's "never sideways or
upward" sentence describes *state* dependencies; shared workbench **components** are imported by
views as a matter of routine. The cell editor panel is the last piece of per-tab chrome still
mounted by the shell.

**F8 — `ViewChrome` renders a fragment, so a view's root is a plain flex column.** Its template
(`ViewChrome.vue:40-89`) emits header + rail + toolbar(s) + `<slot name="strips" />` + `<slot />`
with no wrapper element, and every view root is `display: flex; flex-direction: column;
min-height: 0` (`KeyValueView.vue:639-644`, `DocumentView.vue:729-734`, `DataView.vue:207-212`).
A panel added as the last child of that column needs no layout scaffolding beyond its own height
and `flex-shrink: 0`.

### Layout, persistence and visibility

**F9 — visibility is already selection-driven, and the height is already a persisted global.**
`WorkbenchShell.vue:19-23` derives `cellVisible` from the selection and says the old manual
`layoutState.panel.cellEditor.visible` flag was *removed* rather than kept. `shared/layout.ts:11-15`
confirms it at the schema level: `panelCellEditorSchema` is `{ height: number }` with a comment
explaining the missing `visible`. `defaultLayout` is `{ height: 180 }`; `workbench/state/layout.ts:59-61`
is `setCellEditorHeight`, debounced 150 ms into `control.layoutSet`.

**F10 — the splitter has no size of its own.** `workbench/PanelSplitter.vue` is pointer math plus a
`background: transparent` / hover-`--kira-focus` rule (`:51-59`); its dimensions come entirely from
the grid row it is placed in (`WorkbenchShell.vue:118-120` sizes that row `var(--cell-split-h)` →
`var(--kira-gap)`). `tokens.css:31-36` records the tuning: the visible separation between two
workbench panels is `gap + track + gap` = 2 + 2 + 2, of which only the middle 2 px is draggable.
Inside a view there is no grid gap, so the dock must give the splitter an explicit height.

**F11 — the panel's own unreachable branch, and its dead testid.** `CellEditorView.vue:358` renders
`<EmptyState v-if="!cell" … data-testid="cell-editor-empty" />`. The shell only mounts the panel
when `cellSelectionState.current !== null`, so that branch cannot render today. `cell-editor-empty`
appears nowhere in `tests/` (verified by grep across the repo).

**F12 — the format-override map must stay module-scope.** `views/celleditor/state.ts:16-33` keys
overrides by `(connectionId, path, column.name)` — deliberately *not* by tab —
and `tests/ui/cell-editor.spec.ts:377` asserts that an override set in one tab is still in force in
a second tab on the same table (`// sticks across tabs, same (conn, path, column)`). Nothing about
this file changes in this phase; a "move the panel's state into the dock" reflex that swept it up
would break that assertion. (Note for whoever edits it: `overrideKey`'s separator at `:22` is a
literal control character, which is why `grep` reports the file as binary — don't retype the line,
edit around it.)

**F13 — closing a tab already frees the selection, through two mechanisms that both still apply.**
`state/tabs.ts:449, 469, 485, 500` call `clearSelectedCellFor(id)` beside `dropAllPagesForTab(id)`
on `closeTab`/`closeOthers`/`closeToTheRight`/`closeAll`, and `dropAllPagesForTab` (`:44-51`) also
runs `cleanupTabRuntime(id)` — the leaf-registry pattern in `state/tabRuntime.ts:1-14` that every
view's `state.ts` registers into. The per-tab selection map added by this phase is freed by the
existing `clearSelectedCellFor` calls; no new registration is needed.

### Tests and budgets that constrain the move

**F14 — every existing assertion about the panel's presence survives a not-mounted dock.**
`tests/ui/smoke.spec.ts:23`, `interaction.spec.ts:262`, `definition.spec.ts:364` and `:380` assert
`[data-testid="cell-editor"]` `toHaveCount(0)` in states where no cell is selected (no tab open, a
fresh grid, a definition tab). `cell-editor.spec.ts:441, 451, 571, 581` assert `toBeHidden()` — in
Playwright, `toBeHidden()` passes for an element that is not in the DOM, so a dock that is simply
not mounted satisfies both forms. `budgets.spec.ts:245-249` and every `cell-editor.spec.ts`
assertion address `[data-testid="cell-editor-panel"]`, which is `CellEditorView.vue`'s own root
(`:362`) and moves with the component; because `MainView.vue` renders exactly one view at a time,
that selector stays unique.

**F15 — the tab-switch budget will now include a CodeMirror construction, and the existing
measurement already covers the worst case.** `budgets.spec.ts:229-272` (cell → editor, p95 ≤ 50 ms)
selects 20 cells in the `big_rows` tab, leaving that tab with a live selection. Scenario 3
(`:298-317`, cached tab switch, p95 ≤ 50 ms) then bounces 20 times between `big_rows` and
`wide_table`; `wide_table` has no selection, `big_rows` does. After this phase, every switch back to
`big_rows` mounts a dock and constructs an `EditorView`. `measureClickToDom` observes
`[data-testid="main-view"]` and resolves on a mutation, so that construction lands **inside** the
measured window (it happens synchronously in the same patch, before the observer's callback). This
is the phase's perf guard and it already exists — no new budget test is needed, but scenario 3 must
be re-run and its logged numbers compared (see §5).

**F16 — a dirty buffer is already staged before a tab switch that happens by mouse, and already
lost when one happens by keyboard.** `CellEditorView.vue:298-300` stages on `focusout` (bubbling,
on the wrapping div). Clicking a tab in the tab strip moves focus on `pointerdown`, so `focusout`
fires and stages **before** the click handler switches tabs. `shared/shortcuts.ts:34-35` also binds
`tab.next`/`tab.prev` to Ctrl+Tab / Ctrl+Shift+Tab, which move no focus — but today the buffer is
destroyed anyway the moment the new tab's view publishes its own cell (`CellEditorView.vue:122-139`
resets `doc` on any new `cellKey`). The one case where today's buffer survives is precisely the
stale case this phase deletes. So per-mount buffer lifetime is parity, not a regression — with one
narrow exception raised as OQ1.

## 2. Shapes introduced in this plan

### 2.1 `state/cellSelection.ts` — one record per tab instead of one slot

The interface `SelectedCell` is **unchanged** (all five publishers keep building it exactly as they
do now, `tabId` field included — it is the record's own identity and `cellKey()` at `:51-53` needs
it). Only the container and the two mutators change:

```ts
// One record per tab, not one global slot (P26 D2): the panel is mounted by the view that owns
// the tab, so "which cell is selected" is per-tab state like every other piece of tab state.
const cellSelectionState = reactive<{ byTab: Record<string, SelectedCell> }>({ byTab: {} });

export function selectedCellFor(tabId: string): SelectedCell | null {
  return cellSelectionState.byTab[tabId] ?? null;
}

// Replaces the tab's record wholesale — never mutates the existing object. CellEditorView compares
// on `cellKey` plus `value`, so an in-place mutation would be invisible to it.
export function publishSelectedCell(cell: SelectedCell): void {
  cellSelectionState.byTab[cell.tabId] = cell;
}

/** No cell is selected in this tab any more — a cleared selection, a row/column selection with no
 *  single cell in it, a page whose rows no longer reach the selected index, or a closed tab
 *  (state/tabs.ts's four close paths). All the same operation. */
export function clearSelectedCellFor(tabId: string): void {
  delete cellSelectionState.byTab[tabId];
}
```

`cellSelectionState` stops being exported (nothing outside the module needs the container once
`selectedCellFor` exists); `cellKey()` is unchanged and stays exported.

The three `publishSelectedCell(null)` call sites (`DataGrid.vue:474`, `:479`,
`DocumentView.vue:377`) become `clearSelectedCellFor(props.tabId)` / `clearSelectedCellFor(props.tab.id)`.
Every non-null publish site is untouched.

### 2.2 `views/celleditor/CellEditorDock.vue` — the new, and only, mount point

One shared component, mounted by each data-shaped view. It owns the three things the shell used to
own — whether the panel is on screen, how tall it is, and the splitter that resizes it — and
nothing else:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { selectedCellFor } from '../../state/cellSelection';
import PanelSplitter from '../../workbench/PanelSplitter.vue';
import { layoutState, setCellEditorHeight } from '../../workbench/state/layout';
import CellEditorView from './CellEditorView.vue';

// Mounted by the view that owns the tab (P26 D1), so one dock <-> one tab, torn down with it.
const props = defineProps<{ tabId: string }>();

const cell = computed(() => selectedCellFor(props.tabId));
</script>

<template>
  <template v-if="cell">
    <PanelSplitter
      class="cell-splitter"
      orientation="row"
      reverse
      :size="layoutState.panel.cellEditor.height"
      :min="120"
      :max="480"
      @resize="setCellEditorHeight"
    />
    <div
      class="cell-dock"
      data-testid="cell-editor"
      :data-tab-id="tabId"
      :style="{ height: `${layoutState.panel.cellEditor.height}px` }"
    >
      <CellEditorView :cell="cell" />
    </div>
  </template>
</template>

<style scoped>
/* The workbench grid gave the splitter its size (a `--kira-gap` row between two gap-separated
   panels, tokens.css:31-36); inside a view there is no gap band to aim at, so the track carries
   its own height and the dock's border is the visible boundary. */
.cell-splitter {
  height: var(--kira-s-2);
  flex-shrink: 0;
}

.cell-dock {
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--kira-bg);
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
```

Two notes the implementing session needs:
- The root is a `<template v-if>` **fragment**, so the splitter and the dock are direct flex
  children of the view's own column (F8). Do not wrap them in a `<div>` — that would need
  `display: contents` or a nested flex context to behave, for no gain.
- Scoped styles apply to a child component's root element, which is how `.cell-splitter` sizes
  `PanelSplitter`'s own root `div` from here. This is the same mechanism `ConsoleView.vue` already
  relies on for `.result-grid`.

### 2.3 `views/celleditor/CellEditorView.vue` — takes its cell as a prop

```ts
const props = defineProps<{ cell: SelectedCell }>();
const cell = computed(() => props.cell);
```

Everything downstream of `cell` (the detector, the override lookup, the buffer watch at `:122-139`,
the translate panes, staging) is unchanged, because they all already read through that one
`computed`. What goes away: the import of `cellSelectionState`, the `v-if="!cell"` `EmptyState`
branch (`:358`, F11) and its now-unused `EmptyState` import, and every `cell.value ?` null-guard
that existed only for the unmountable no-cell case. The `cellKey` import stays (`data-cell-key`,
and the buffer watch's no-op guard).

The prop is **required and non-nullable** — the dock's `v-if` is the single place that decides
whether there is a cell to render, which is exactly the invariant the shell used to hold.

### 2.4 The mount line, in each view

```html
<CellEditorDock :tab-id="tab.id" />
```

Placement per view (F8 — all of these are direct children of the view's own flex column):

| View | Where |
|---|---|
| `views/grid/DataView.vue` | last child of `.data-view`, after the `<template v-else>` grid block |
| `views/documents/DocumentView.vue` | last child of `.document-view`, after `</ViewChrome>` |
| `views/keyvalue/KeyValueView.vue` | last child of `.keyvalue-view`, after `</ViewChrome>` |
| `views/stream/StreamView.vue` | last child of `.stream-view`, after `</ViewChrome>` |
| `views/console/ConsoleView.vue` | inside `ViewChrome`'s default slot, **after** `.results-body` and **before** `.status-line` — the console is the one view with a bottom status strip of its own (`:271`), and that strip stays the view's last row |

### 2.5 `WorkbenchShell.vue` — what is deleted

The `cellSelectionState` import (`:3`), the `cellVisible` computed (`:19-23`), the `--cell-h` /
`--cell-split-h` custom properties (`:29-30`), the `setCellEditorHeight` import (`:14`), the
`CellEditorPanel` import (`:5`) and both of its grid children (`:61-78`). The grid template
collapses to:

```css
grid-template-areas:
  'project splitproj main'
  'splitops splitops splitops'
  'ops ops ops'
  'status status status';
grid-template-columns: var(--project-w) var(--project-split-w) 1fr;
grid-template-rows: 1fr var(--ops-split-h) var(--ops-h) var(--kira-statusbar-h);
```

`workbench/panels/CellEditorPanel.vue` is deleted outright (F1 — it is a seven-line pass-through
that exists only to fill a grid area that no longer exists).

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | The cell editor becomes **one shared `CellEditorDock.vue`, mounted internally by each data-shaped view**, keyed implicitly by `MainView.vue`'s existing `:key="activeTab.id"` on the view itself. Not a per-view-kind wrapper, not a Teleport, not a shell slot. | This is exactly the pattern `DataView.vue` mounts `DataGrid`/`DataToolbar`/`SearchToolbar` with, and `KeyValueView`/`StreamView`/`DocumentView` mount `ViewChrome` with (F7). One shared component means the panel's chrome (visibility rule, height, splitter) has one definition; five thin wrappers would be five places to drift. The per-tab lifetime comes free from the view's own key (F6) — no new mechanism at all. |
| **D2** | "Which cell is selected, and what's in its buffer" is split: **selection moves to a per-tab-id record** in `state/cellSelection.ts` (`byTab`, §2.1), **the edit buffer stays per-mount** inside `CellEditorView.vue` (`doc`, `formattedForDoc`, `decodedDoc`). | The selection is per-tab state (it is *about* a tab's page) and must survive that tab being backgrounded, so it belongs in the same layer as `views/*/state.ts`'s per-tab runtimes. The buffer is per-mount view state, exactly like `DataGrid`'s inline editor's own draft, and hoisting it into module state would be new state to invalidate on page refresh, on commit, and on tab close for no behaviour the user asked for (F16 shows parity; OQ1 raises the one narrow gap). |
| **D3** | Keep `publishSelectedCell(cell)`'s single-argument signature and route the "nothing selected" case through **`clearSelectedCellFor(tabId)`**, rather than widening to `publishSelectedCell(tabId, cell \| null)`. | The record already carries its own `tabId` (F2), so a second argument would be a second source of truth for the same key. Three call sites change (`DataGrid.vue:474`, `:479`, `DocumentView.vue:377`) instead of eight, and "no cell is selected in this tab" and "this tab is gone" are genuinely the same operation on the map — one function, one doc comment saying so. |
| **D4** | The **dock's `v-if` on `selectedCellFor(tabId)`** is the only thing that decides whether the panel is on screen. `CellEditorView` takes a required, non-nullable `cell` prop, and its `EmptyState` branch is deleted. | Preserves today's rule exactly (F9: visibility follows selection, there is no toggle) while moving the decision to the one component that owns the mount. The empty branch is already unreachable and referenced by no test (F11); carrying it forward would mean shipping a state that is now doubly impossible. |
| **D5** | **Height and the splitter stay global and persisted** — `layoutState.panel.cellEditor.height`, `setCellEditorHeight`, `shared/layout.ts` unchanged, no schema or migration. Every tab's dock reads the same number. | Panel size is chrome preference, not tab content: a user who drags the panel to 300 px means "this panel is 300 px", not "this panel is 300 px *for the customers table*". Keeping the existing store also means the height survives a tab switch and an app restart exactly as it does today, so the panel cannot visually "reset" — which was the explicit risk in the phase brief. A per-tab height would additionally need a persistence story (`tabs.state_json`) for something no one asked to vary per tab. |
| **D6** | A view's **unmount no longer clears its tab's selection**: delete `clearSelectedCellFor` from `DataGrid.vue`'s `onUnmounted` (`:285`) and `DocumentView.vue`'s (`:419`), along with the two "load-bearing guard" comments (`:278-281`, `:413-415`). Tab **close** still clears, via `state/tabs.ts`'s four existing call sites. | Those clears exist solely to stop one tab's view clobbering another's publication in a shared slot (F4); with per-tab records there is nothing to clobber, and keeping them would actively hurt — a backgrounded tab would lose its selection, and for KeyValue that selection has nowhere else to live (F5). Removing them also deletes the ordering hazard rather than documenting it, and makes every view kind behave the same on switch-back: the panel returns showing the same cell. Memory is bounded by open tabs (one record, `value` capped at the engine's 64 KB truncation, closures over ids only) and freed on close (F13). |
| **D7** | **`KeyValueView`, `StreamView` and `ConsoleView` keep the cell editor**, unchanged apart from mounting the dock. No publisher gains an `immediate` republish watch. | Only Mongo was called out as not needing it; a Redis value, a Kafka message body and a console result cell are all things the panel usefully renders (and the two view files say so themselves — `KeyValueView.vue:281-283`, `StreamView.vue:132-135`). They need no mount-time republish because D6 keeps their record alive: remounting the dock re-reads it. Adding a republish watch to `StreamView` would additionally require storing the clicked *column* in `views/stream/state.ts` (today only `selectedRow` exists, `:32`) — new per-tab state for no gain. |
| **D8** | The **`console` tab counts as a data-shaped view** for this phase and mounts the dock. | `ConsoleResultGrid.vue:68-77` is a real publisher today (read-only, no `onEdit`, `:87-89`), so excluding the console would silently *remove* working behaviour under the banner of a lifecycle fix. It is also the cheapest reproduction of the stale bug in a Postgres-only spec (§5). |
| **D9** | **Mongo's `DocumentView.vue` keeps mounting the dock in P26, with its publisher (`:371-400`) untouched.** P26's boundary is ownership and lifetime; **P27 owns** hiding/removing/replacing the panel for Mongo. | Stated explicitly so the two plans cannot conflict: after P26, a Mongo tab's panel behaves exactly as today except it can no longer show another tab's cell. P27's plan already scopes "the cell editor panel (P26) is hidden by default for Mongo, its useful pieces … relocated into the expanded document's own edit area" (SPEC §10, P27 row) — and P26 is what makes that a **one-line deletion in one file** (the `<CellEditorDock>` line in `DocumentView.vue`, plus its publisher watch) instead of a special case threaded through shell-level state. Doing it here would half-build P27's replacement UI, which AGENTS.md forbids. |
| **D10** | The `definition` tab and the two no-tab states mount **no dock at all** — nothing to opt out of, because opting in is now a line in a view file. | This is the "a view kind can opt out of it entirely" half of the SPEC row, and it falls out of the design rather than needing a mechanism. It also keeps `interaction.spec.ts:262` / `definition.spec.ts:364, 380`'s `toHaveCount(0)` assertions true by construction (F14). |
| **D11** | Visually, the panel stops being its own rounded `panel-surface` below the editor area and becomes a **band inside the view**, separated by a 1 px `--kira-border` top border, with a 4 px (`--kira-s-2`) transparent splitter track above it. | It is now inside `.editor-area`'s bordered, radius-clipped box, so a second border+radius would be a box drawn inside a box. A flush border matches the rhythm the shell already documents for this stack — `WorkbenchShell.vue:147-152`: *"Every other boundary in this stack (breadcrumb / toolbar-rail / toolbar / grid) sits flush with zero gap"*. The 4 px track is deliberately **wider** than the workbench's 2 px one (F10): there, `gap + track + gap` gave the pointer a 6 px band to aim at; here there is no gap, so the draggable strip carries the whole target itself. |
| **D12** | The `data-testid="cell-editor"` moves onto the dock's root element; `data-testid="cell-editor-panel"` stays on `CellEditorView`'s root. A `:data-tab-id` is added to the dock. | Keeps all eight existing presence/visibility assertions working unchanged (F14) and gives the new coverage a way to assert *which* tab's dock is on screen and that it lives inside `[data-testid="main-view"]` — the structural statement that the move actually happened. |
| **D13** | `views/celleditor/state.ts` (format overrides, read-only reasons) is **not touched**. Overrides stay module-scope and keyed by (connection, path, column). | F12: `cell-editor.spec.ts:377` asserts an override set in one tab applies in another tab on the same table. The override is a property of a *column*, not of a tab or of a panel instance; per-tab keying would be a behaviour regression disguised as tidying. |
| **D14** | `CellEditorDock.vue` lives in **`views/celleditor/`**, and imports `PanelSplitter.vue` and `state/layout.ts` from `workbench/`. | §11 gives `views/celleditor/` as the folder that owns this view kind, and the dock is its outermost component. The `workbench/` imports match established practice for shared workbench components and services (F7) — `ConsoleResultGrid.vue:7` imports `workbench/VirtualList.vue` the same way. No new primitive is introduced for a splitter that already exists. |
| **D15** | No new perf test. The **existing** `budgets.spec.ts` scenario 3 (cached tab switch, p95 ≤ 50 ms) is the guard, and its logged numbers before/after are recorded in the phase's commit message or handoff notes. | F15: that scenario already bounces between a tab with a live selection and one without, so it measures the exact new cost (a per-switch `EditorView` construction) inside its measured window. Adding a second measurement of the same click would be duplicate coverage; what is needed is that the existing one is *run* and its numbers compared, not more assertions. |
| **D16** | `views/celleditor/`'s other files — `detect.ts`, `formats.ts`, `beautify.ts`, `binary.ts`, `timestamp.ts`, `DateTimePicker.vue`, `TimestampPane.vue` — are **not touched**. | They are pure functions and leaf components fed by `CellEditorView`'s props and buffer; none of them reads the selection slot (verified by grep: `cellSelectionState` appears only in `WorkbenchShell.vue` and `CellEditorView.vue`). A phase about ownership should produce a diff about ownership. |

## 4. Implementation order

Five commits. Each one leaves `bun run lint`, `bun run typecheck`, `bun run build` green and the
four container-free specs (`smoke`, `startup`, `workbench`, `connections`) passing; the app must be
launchable and the panel usable after every single one.

---

### Commit 1 — `refactor(cell-editor): key the selected-cell seam by tab id`

**Files:** `src/renderer/state/cellSelection.ts`, `src/renderer/views/grid/DataGrid.vue`,
`src/renderer/views/documents/DocumentView.vue`, `src/renderer/views/celleditor/CellEditorView.vue`,
`src/renderer/workbench/panels/CellEditorPanel.vue`, `src/renderer/workbench/WorkbenchShell.vue`.

1. `cellSelection.ts` → §2.1: `byTab` record, `selectedCellFor(tabId)`, `publishSelectedCell(cell)`
   writing `byTab[cell.tabId]`, `clearSelectedCellFor(tabId)` deleting it. Stop exporting
   `cellSelectionState`.
2. Rewrite the three null-publish sites as `clearSelectedCellFor(…)` (D3).
3. `CellEditorView.vue` → §2.3: required `cell` prop, drop the `cellSelectionState` import, delete
   the `EmptyState` branch and its import.
4. `CellEditorPanel.vue` becomes the temporary adapter that feeds the prop from the **active** tab:
   `selectedCellFor(tabsState.activeId)`. `WorkbenchShell.vue`'s `cellVisible` reads the same.

**Why this ordering:** this commit alone already fixes the reported bug — a tab whose record is
absent renders nothing instead of the previous tab's cell — while the panel is still shell-mounted,
so the change to the selection model can be reviewed and exercised in isolation from the change to
where the panel lives. The active-tab lookup in `CellEditorPanel.vue` is scaffolding with a
one-commit life; commit 2 deletes the file.

**Must stay green additionally:** manual check that selecting a cell in a grid still populates the
panel and that switching to a definition tab now hides it.

---

### Commit 2 — `feat(cell-editor): mount the cell editor inside each data-shaped view`

**Files:** new `src/renderer/views/celleditor/CellEditorDock.vue`; deleted
`src/renderer/workbench/panels/CellEditorPanel.vue`; edited `WorkbenchShell.vue`,
`views/grid/DataView.vue`, `views/documents/DocumentView.vue`, `views/keyvalue/KeyValueView.vue`,
`views/stream/StreamView.vue`, `views/console/ConsoleView.vue`.

1. Add `CellEditorDock.vue` (§2.2).
2. Add the one mount line to each of the five views, at the placement in §2.4.
3. Delete `CellEditorPanel.vue`; strip the shell (§2.5) — grid areas, rows, both custom properties,
   the splitter, the surface, and the three now-unused imports.

**Must stay green additionally:** the panel appears below the grid inside the view's own box, the
splitter drags and the height persists across a relaunch; a Redis/Kafka/console tab shows its own
cell; switching tabs never shows another tab's cell. `workbench.spec.ts` (panel toggles, project and
operations splitters) must pass unchanged — it does not touch the cell editor, and this commit
changes the grid rows around the ops panel.

---

### Commit 3 — `refactor(cell-editor): drop the unmount clears now that selection is per tab`

**Files:** `views/grid/DataGrid.vue`, `views/documents/DocumentView.vue`.

Remove `clearSelectedCellFor(props.tabId)` from both `onUnmounted` hooks and delete the two
comments that exist only to explain the mount/unmount ordering hazard (D6). `state/tabs.ts` is
**not** touched — its four close-path clears are still the thing that frees a closed tab's record.

**Why separate:** this is the one behaviour change beyond the bug fix — a backgrounded tab now keeps
its selection, so switching back restores the panel for every view kind, including KeyValue, which
has no other record of it (F5). It deserves its own commit and its own line in the log.

**Must stay green additionally:** select a cell in tab A, switch to B, switch back → the panel
returns showing the same cell, with `data-cell-key` unchanged. Close tab A → its record is gone
(no leak; verifiable in the devtools by the absence of a `byTab` entry).

---

### Commit 4 — `test(cell-editor): cover per-view ownership and cross-tab isolation`

**Files:** `tests/ui/cell-editor.spec.ts` (one new scenario, §5.2), plus the one stale code comment
at `tests/ui/budgets.spec.ts:245` that still points at "CellEditorView.vue's `v-else`".

**Must stay green additionally:** nothing new in this environment (the spec is Postgres-container
backed); the scenario must be written so it is skipped, not failed, when Docker is unavailable —
`cell-editor.spec.ts:15-22`'s existing `beforeAll` already does this for the whole file.

---

### Commit 5 — `docs(spec): record the view-owned cell editor in §8.6, §11 and the P26 row`

**Files:** `docs/v1/SPEC.md`.

- §8.6's heading and opening line ("Cell editor panel (bottom of the main area)") become the
  view-owned description: the panel is mounted by the view that owns the tab, appears while that
  tab has a selected cell, and a view kind opts out by not mounting it.
- §11's `views/` annotation gains `celleditor/`'s `CellEditorDock.vue` beside the P24 entries.
- The §10 P26 row gains its "Implemented …" note, in the style P22/P23/P24 use, including the
  explicit P27 boundary from D9.

**Must stay green additionally:** docs-only, but re-run `bun run lint` (Biome formats Markdown in
this repo's `biome.json` scope).

## 5. Tests

### 5.1 Existing specs — what must change, and what must not

| Spec | Status |
|---|---|
| `tests/ui/cell-editor.spec.ts` | **Unchanged assertions, plus one new scenario.** Every `[data-testid="cell-editor-panel"]` assertion addresses `CellEditorView`'s own root, which moves with the component and stays unique (F14). `:441, :451, :571, :573, :581`'s `toBeHidden()`/`toBeVisible()` on `[data-testid="cell-editor"]` now address the dock; `toBeHidden()` passes for a not-mounted element. `:377`'s cross-tab format-override assertion is protected by D13. |
| `tests/ui/budgets.spec.ts` | **No assertion changes.** Scenario 2 (cell → editor, p95 ≤ 50 ms) and scenario 3 (cached tab switch, p95 ≤ 50 ms) both stand; scenario 3 is this phase's perf guard (D15/F15). The stale comment at `:245` is corrected in commit 4. |
| `tests/ui/smoke.spec.ts:23`, `interaction.spec.ts:262`, `definition.spec.ts:364, :380` | **Unchanged and load-bearing.** All four assert `toHaveCount(0)` in states that now mount no dock at all (D10). |
| `tests/ui/data-view.spec.ts` | **Unchanged.** Grepped for tab-switch-plus-cell-editor scenarios: it has none — the only cross-tab cell-editor coverage in the suite lives in `cell-editor.spec.ts` (scenarios 5-8), and all of it is about the format override, not about staleness. |
| `tests/ui/mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts`, `sqs.spec.ts`, `console.spec.ts` | **Unchanged, must stay green.** These exercise the four non-grid publishers; they assert on their own views' testids and never on the cell editor's. Their passing is the regression signal that mounting a dock inside those views broke none of their layout or selection behaviour. |
| `tests/ui/workbench.spec.ts` | **Unchanged, must stay green.** It covers the panel toggles and the project/operations splitters — the grid rows this phase edits (§2.5). |
| `tests/db/**` | **Untouched.** No engine, adapter, protocol or storage code is in this phase's diff. |

### 5.2 New coverage — one scenario in `tests/ui/cell-editor.spec.ts`

Named for what it guards: *"cell editor — owned by the view, never shows another tab's cell"*.
Postgres-only, so it runs in the same `beforeAll` fixture as the rest of the file. It uses a
**console tab** as the second tab deliberately: `ConsoleResultGrid` is a publisher that neither
republishes on mount nor clears on unmount (F3), i.e. exactly the class of publisher that produces
the reported bug, and it needs no second engine container.

1. Open a data tab on `formats`; select `row 0 / sample`; assert
   `[data-testid="cell-editor-panel"]` has `data-cell-key` = `${dataTabId}:0:sample`.
2. **Ownership.** Assert `[data-testid="main-view"] [data-testid="cell-editor"]` has count 1 — the
   panel is inside the tab's view subtree, not a sibling of it. (This is the assertion that fails
   against today's code and is the structural statement of the whole phase.) Assert the dock's
   `data-tab-id` equals `dataTabId`.
3. Open a query console on the same connection, run a `SELECT`, click a result cell; assert the
   panel's `data-cell-key` starts with the **console** tab's id.
4. **The bug.** Switch back to the data tab. Assert the panel's `data-cell-key` is
   `${dataTabId}:0:sample` again — never the console tab's key. (Today this fails: the console's
   publication is still in the slot until the grid's `immediate` watch happens to overwrite it, and
   for a non-publishing target it is never overwritten at all.)
5. Switch to the console tab again; assert the console's own cell is back, unchanged
   (D6: a backgrounded tab keeps its selection).
6. Open a **definition** tab on the same table and switch to it; assert
   `[data-testid="cell-editor"]` has count 0 — a view kind that mounts no dock shows no panel,
   whichever tab was in front of it (D10). This is the minimal reproduction of the user's report.
7. Switch back to the data tab; assert the panel is visible with `${dataTabId}:0:sample`, and that
   its `data-format` still reflects any override set earlier in the file's session (D13 — the
   override map is untouched by the move).
8. Close the data tab; assert `[data-testid="cell-editor"]` count 0 and no console errors
   (`consoleErrors` is already collected by the fixture and asserted at the end of the file's
   other scenarios — assert `toEqual([])` here too).

**Height persistence** is already covered indirectly (`cell-editor.spec.ts:576-581` relaunches and
asserts the panel starts hidden, after a 300 ms wait for `layout.ts`'s 150 ms write debounce). Add
one assertion inside this scenario rather than a new test: drag nothing, but read the dock's
`clientHeight` on the data tab, switch tabs, and assert the console tab's dock has the same height
(D5 — the panel does not visually reset across a switch).

### 5.3 What is deliberately not added

- No unit tests — SPEC §9 is "no unit tests, two suites only".
- No new spec file. The cell editor has one home spec and this belongs in it.
- No Redis/Kafka/Mongo variants of the cross-tab scenario: the mechanism is identical for all five
  publishers and the console variant exercises it without a second container, so per-engine copies
  would be four more 5-minute container starts buying one code path's worth of confidence.

## 6. Explicitly out of scope

- **Everything P27 owns**: hiding or removing the panel for Mongo, the document preview reshape, the
  per-document edit area, `ObjectId` handling, document render perf. P26 leaves `DocumentView.vue`'s
  publisher and its dock mount in place (D9).
- **Any change to the panel's contents or behaviour**: no new formats, no new panes, no new buttons,
  no change to detection, beautify, staging, or the read-only reasons (D16).
- **A per-tab panel height, or persisting selection across a relaunch.** Height stays global (D5);
  selection stays session-only, as `cell-editor.spec.ts:576-581` asserts.
- **A collapse/hide toggle for the panel.** Visibility follows selection (F9/D4); adding a toggle
  would resurrect the `layoutState.panel.cellEditor.visible` flag P24 deliberately removed.
- **Making `StreamView`/`KeyValueView`/`ConsoleResultGrid` publish on mount.** Unnecessary under D6,
  and for the stream it would require new per-tab state (D7).
- **Redrawing `docs/v1/design/kira-design-system/parts/bodies/CellEditor.html`**, which still shows
  the panel as a separate surface below the editor (see OQ2). The design canvas is a built artifact
  with its own build step; updating it is a design-system task, not a renderer one.
- **`§11`'s "views never depend upward into `workbench/`" wording.** The tree has said one thing and
  done another since P16 (F7); reconciling that sentence is a docs question for a later sweep, not
  something to settle by refusing an import every sibling view already makes.
- **`tests/db/` and Docker.** Nothing in this phase reaches the engine process.

## 7. Target tree at the end of P26

```
src/renderer/
  workbench/
    WorkbenchShell.vue          ← cell rows/splitter/surface + cellSelection import removed (§2.5)
    PanelSplitter.vue             unchanged — now also used from views/celleditor/
    panels/
      CellEditorPanel.vue       ← DELETED (7-line pass-through, F1)
      MainView.vue                unchanged
      OperationsPanel.vue         unchanged
      ProjectPanel.vue            unchanged
      TabStrip.vue                unchanged
      ViewChrome.vue              unchanged
    state/layout.ts               unchanged — setCellEditorHeight now called from the dock
  state/
    cellSelection.ts            ← byTab record + selectedCellFor(); publish/clear re-keyed (§2.1)
    tabs.ts                       unchanged — its four clearSelectedCellFor calls still apply
    tabRuntime.ts                 unchanged
  views/
    celleditor/
      CellEditorDock.vue        ← NEW: v-if on the tab's selection, splitter, height, mounts the view
      CellEditorView.vue        ← takes a required `cell` prop; EmptyState branch removed (§2.3)
      DateTimePicker.vue          unchanged
      TimestampPane.vue           unchanged
      beautify.ts binary.ts detect.ts formats.ts state.ts timestamp.ts   all unchanged (D13/D16)
    grid/
      DataView.vue              ← + <CellEditorDock :tab-id="tab.id" />
      DataGrid.vue              ← 2 null-publishes → clearSelectedCellFor; unmount clear removed
    documents/DocumentView.vue  ← + dock mount; 1 null-publish → clear; unmount clear removed (D9: publisher stays)
    keyvalue/KeyValueView.vue   ← + dock mount
    stream/StreamView.vue       ← + dock mount
    console/ConsoleView.vue     ← + dock mount (above .status-line)
    definition/DefinitionView.vue  unchanged — mounts no dock (D10)
tests/ui/
  cell-editor.spec.ts           ← + one scenario (§5.2)
  budgets.spec.ts               ← one stale comment corrected
docs/v1/
  SPEC.md                       ← §8.6, §11, §10's P26 row
  plans/P26-cell-editor-in-data-view.md   ← this file
```

Net: **one file added, one file deleted**, nine files edited, one spec extended.

## 8. Acceptance checklist

- [ ] `[data-testid="cell-editor"]` is a descendant of `[data-testid="main-view"]` whenever it
      exists, and there is never more than one in the DOM.
- [ ] Selecting a cell in a grid, a document, a Redis/S3 field, a Kafka/SQS message column, or a
      console result cell populates the panel exactly as before, with the same
      `data-cell-key` / `data-format` / `data-detected` / `data-read-only-reason` / `data-dirty`
      attribute values.
- [ ] Switching from **any** tab to **any** other tab never leaves the panel showing the previous
      tab's cell — checked for at least: keyvalue → definition, keyvalue → keyvalue,
      stream → console, console → definition, data → keyvalue, document → data.
- [ ] Switching away from a tab and back restores that tab's panel, with the same cell, for all five
      view kinds (D6).
- [ ] A `definition` tab, the first-run screen and the no-tab-open screen mount no panel at all.
- [ ] Mongo behaves exactly as before this phase apart from staleness — a clicked document still
      publishes its EJSON body to the panel (D9).
- [ ] Dragging the splitter resizes the panel, the height persists across a tab switch and across an
      app relaunch, and no tab shows a different height from another (D5).
- [ ] Editing a cell in the panel still stages into the same pending-change set — on blur and on
      Ctrl/Cmd+Enter — and Revert still un-stages, in the grid (the only view that sets `onEdit`).
- [ ] A manual format override still sticks per (connection, path, column) across tabs
      (`cell-editor.spec.ts:377`).
- [ ] `WorkbenchShell.vue` contains no reference to `cellSelection`, `cellEditor` height, or a cell
      grid area; `workbench/panels/CellEditorPanel.vue` no longer exists.
- [ ] `DataGrid.vue` and `DocumentView.vue` contain no `clearSelectedCellFor` in an unmount hook, and
      none of the three ordering-hazard comments survives.
- [ ] `views/celleditor/state.ts`, `detect.ts`, `beautify.ts`, `binary.ts`, `timestamp.ts`,
      `TimestampPane.vue`, `DateTimePicker.vue` are byte-identical to their pre-phase versions.
- [ ] `bun run lint`, `bun run typecheck`, `bun run build` clean; `smoke`, `startup`, `workbench`,
      `connections` pass locally.
- [ ] `budgets.spec.ts` scenario 2 (cell → editor) and scenario 3 (cached tab switch) both still
      report p95 ≤ 50 ms in a real run, with the logged numbers compared against a pre-phase run
      (D15).
- [ ] `cell-editor`, `data-view`, `console`, `definition`, `interaction`, `mongo`, `redis`, `kafka`,
      `sqs` specs pass in CI or on the macOS/Colima box; if they could not be run, the phase's
      hand-off says so explicitly (the caveat P24 recorded for itself).
- [ ] `tests/db/` untouched and still green.
- [ ] SPEC §8.6, §11 and the §10 P26 row describe the view-owned panel and name P27's boundary.

## 9. Open questions for the user

**OQ1 — should an in-flight edit be staged when the view unmounts?**
Today the panel stages a dirty buffer on `focusout` (`CellEditorView.vue:298-300`), and clicking a
tab in the tab strip moves focus first, so a mouse-driven tab switch stages before it switches
(F16). A **keyboard** switch (`Ctrl+Tab`, `shared/shortcuts.ts:34-35`) moves no focus — today the
buffer is destroyed anyway by the incoming tab's publication, *except* in the buggy case this phase
removes, so this is parity rather than a regression. Still, after the move the destruction is
unconditional, and the fix is two lines:

```ts
onBeforeUnmount(() => { if (isEditable.value && isDirty.value) saveEdit(); });
```

**Recommendation: add it.** Staging is not committing — a staged edit is visible in the grid's
pending-changes chip and reversible via Revert/Discard — so this converts a silent loss into the
same reversible outcome every other "leave the editor" gesture already produces. It is called out
here rather than decided silently because it is the one behaviour this phase would add beyond the
bug fix, and it fires on a gesture (switching tabs) that a user might not read as "commit my edit".
**The implementing session must either implement it or state in the commit that it deliberately
did not.**

**OQ2 — the panel stops being its own floating surface (D11); the design canvas still shows the old
shape.** `docs/v1/design/kira-design-system/parts/bodies/CellEditor.html:90-92` draws the panel as a
separate `p-panel` below the editor panel, matching today's shell layout. After this phase it is a
band inside the editor surface. The reasoning is in D11 (a bordered box inside a bordered box, and
the flush-boundary rule the shell already states at `WorkbenchShell.vue:147-152`), and the mockup is
a built artifact with its own build step — but this repo treats the design canvas as law, so the
divergence should be acknowledged rather than discovered later. **Recommendation: proceed with the
band, and log the canvas redraw as a design-system follow-up** (it also has to be redrawn for P27's
Mongo changes, so doing both at once is cheaper).

**OQ3 — is the console in or out?** D8 keeps the cell editor for `console` tabs, because
`ConsoleResultGrid` publishes today and dropping it would be a silent feature removal inside a
lifecycle fix. If the intent behind "data-shaped views" was the four *page-kind* views only
(grid/documents/keyvalue/stream), say so and the console's dock mount plus its publisher
(`ConsoleResultGrid.vue:68-77` and its two document/key-value siblings) come out together — but that
is a feature deletion and should be an explicit decision, not a side effect.
