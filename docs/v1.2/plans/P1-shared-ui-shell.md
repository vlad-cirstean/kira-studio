# P1 — Shared UI shell: title bar, left panel, and tab/content area, modularized

> **What this phase is.** The structural first step of v1.2 (`docs/v1.2/SPEC.md`): a custom title bar
> carrying two top-level mode tabs (**Studio** / **Http**), and the generalization of the two
> surfaces Http mode will reuse — the left-hand panel and the tab strip + content area — so that a
> different left panel and a different tab kind can be hosted through the *same* machinery Studio
> already uses, without Studio's behaviour, performance or existing tests changing.
>
> **No HTTP functionality lands here.** No request sending, no collections format, no storage, no
> curl, no protocols. What lands is the shell, plus an Http mode that is genuinely empty — an empty
> left panel and an empty content area, both built from the existing `EmptyState` primitive. That is
> the proof the seam works, not a stub of a feature (`AGENTS.md`: *"Scope left out of a phase is left
> out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inferred from `SPEC.md`'s prose.** Base:
> branch `claude/feature-v1-2` at `2724563`. File:line citations point at that content.
>
> **The one-sentence design.** The title bar is new UI on top of a window option Wails already has;
> the left panel splits into a mode-agnostic *shell* plus mode-owned *content*; the tab strip and
> content area become registry-driven instead of switch-driven; and **mode is a derived view over the
> single existing tab list**, which is what lets all of the above land with no storage migration, no
> bindings regeneration, and no new dependency.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/shell/window.go` | `Mac.TitleBar` = full-size-content; window background aligned to the app's own chrome token |
| `apps/kira-studio/internal/shell/window_test.go` | assertion on the new option values |
| `apps/kira-studio/frontend/src/App.vue` | title-bar + workbench frame |
| `apps/kira-studio/frontend/src/workbench/TitleBar.vue` | **new** — the custom title bar and the two mode tabs |
| `apps/kira-studio/frontend/src/workbench/WorkbenchShell.vue` | becomes a flex child of the frame; left-panel slot is mode-driven |
| `apps/kira-studio/frontend/src/workbench/modes.ts` | **new** — mode → left panel / empty-content components |
| `apps/kira-studio/frontend/src/workbench/tabViews.ts` | **new** — tab kind → view component |
| `apps/kira-studio/frontend/src/workbench/panels/LeftPanel.vue` | **new** — the mode-agnostic panel shell |
| `apps/kira-studio/frontend/src/workbench/panels/ProjectPanel.vue` | keeps only Studio's own content |
| `apps/kira-studio/frontend/src/workbench/panels/StudioStart.vue` | **new** — Studio's two empty states, moved out of `MainView.vue` |
| `apps/kira-studio/frontend/src/workbench/panels/MainView.vue` | dispatch chain → `<component :is>` |
| `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` | registry-driven icon/title/rail/menu |
| `apps/kira-studio/frontend/src/theme/primitives/TreeHost.vue` | **new** — the virtualized tree host |
| `apps/kira-studio/frontend/src/theme/primitives/PanelSearchBox.vue` | **new** — `project/SearchBox.vue`, `v-model`-driven |
| `apps/kira-studio/frontend/src/theme/primitives/stickyBand.ts` | **moved** from `project/stickyBand.ts`, content unchanged |
| `apps/kira-studio/frontend/src/theme/tokens.css` | two title-bar tokens |
| `apps/kira-studio/frontend/src/project/ProjectTree.vue` | mounts `TreeHost`; keeps Studio's own behaviour |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | **new** — the tab-kind registry (component-free) |
| `apps/kira-studio/frontend/src/state/mode.ts` | **new** — the mode seam |
| `apps/kira-studio/frontend/src/state/tabs.ts` | per-mode active tab; registry-driven duplicate/drop |
| `apps/kira-studio/frontend/src/http/{CollectionsPanel,HttpStart}.vue` | **new** — the empty Http mode |
| `packages/shared/domain/{mode.ts,tabs.ts}` | `AppMode`; `TAB_KIND_MODE` beside `RENDERABLE_TAB_KINDS` |
| `biome.json` | a layering override for the new `http/` tree |
| `apps/kira-studio/tests/ui/mode-switch.spec.ts` | **new** |
| `docs/ARCHITECTURE.md` | the mode seam, the panel shell, the tab-kind registry |

### 0.2 Out of scope, explicitly

- **Every HTTP capability in `docs/v1.2/SPEC.md`'s P2–P9 rows.** No request builder, no response
  viewer, no collections file format, no import/export, no curl, no history, no raw inspector, no
  timeline, no gRPC. P1 adds **zero** new tab kinds — `tabKindSchema`
  (`packages/shared/domain/tabs.ts:5-13`) and Go's `model.RenderableTabKinds`
  (`internal/storage/model/tabs.go:26-29`) are byte-identical after this phase.
- **Any storage change.** No migration, no new column, no `TabsRepo` change. §2 F17/F18 establish
  why none is needed rather than deferring one.
- **Any bridge/bindings change.** No bound-service method is added or altered, so
  `wails3 task common:generate:bindings` output is unchanged and `tests/ui/support/mockRuntime.ts`'s
  `CHANNEL_TO_FQN` table needs no new entry (`AGENTS.md`'s `-names` warning has no subject here).
- **A second persisted panel width for Http.** Both modes share
  `layoutState.panel.project` in P1 (§2 F20, §8 OQ-1).
- **Renaming the View menu's "Toggle Project Panel"** (`internal/shell/menutemplate.go:74`) or adding
  a mode-switch accelerator. §8 OQ-3.
- **A Windows/Linux custom title bar.** v1 targets macOS (`docs/ARCHITECTURE.md:25`); §8 OQ-4.

### 0.3 Ground rules

- **Studio's rendered output does not change.** Every commit in §5 up to and including C4 is a pure
  refactor whose regression guard is the existing suite, not a new one.
- **No new dependency** (§4 D1 states the library-first reasoning rather than skipping it).
- **`views/**` may not import `workbench/**`, and `project/**` may not import `views/**`**
  (`biome.json:66-103`, `:104-123`). Every new module's placement in §4 is decided by that, not by
  taste.

---

## 1. What the code does today

### 1.1 The title bar: there isn't one

The app has **native window chrome and no custom title bar of any kind**. `shell.Options`
(`internal/shell/window.go:64-89`) builds `application.WebviewWindowOptions` with a `Title`, a size,
`BackgroundColour`, `Permissions`, `EnableFileDrop: false` and `Mac: application.MacWindow{WebviewPreferences: sec.Webview}`
— **no `Frameless`, no `Mac.TitleBar`, no `Mac.InvisibleTitleBarHeight`**. `main.go:262` is the single
caller (`app.Window.NewWithOptions(shell.Options(shell.Harden(), rec, primaryWorkArea))`).
`docs/ARCHITECTURE.md:25` records the same fact from the other side: *"Shell | Wails v3 … | native
title bar, macOS 14+, arm64 only"*.

On the renderer side there is no title-bar component: `App.vue:58-67` mounts `<WorkbenchShell />`
plus seven overlay components (dialogs, context menu, palette, tooltip) and nothing above the
workbench. `WorkbenchShell.vue:73-90` is a four-area CSS grid (`project splitproj main` / `splitops`
/ `ops` / `status`) padded `var(--kira-window-inset) var(--kira-window-inset) var(--kira-gap)` on a
`--kira-bg-chrome` background, `height: 100%`.

**What the pinned Wails does offer**, read from the installed module rather than the (403-blocked)
docs site:

- `WebviewWindowOptions.Frameless` (`pkg/application/webview_window_options.go:102-103`).
- `MacWindow.TitleBar MacTitleBar` and `MacWindow.InvisibleTitleBarHeight`
  (`webview_window_options.go:617-622`).
- `MacTitleBar{AppearsTransparent, Hide, HideTitle, FullSizeContent, UseToolbar, HideToolbarSeparator, ShowToolbarWhenFullscreen, ToolbarStyle}`
  (`:788-806`), with four ready-made presets (`:808-852`) — `MacTitleBarHidden` (`:823-830`) and
  `MacTitleBarHiddenInset` (`:833-841`) are the two that keep the traffic lights while extending
  content to the full window.
- Drag regions are a **CSS custom property**, not an API call: `isDraggableEvent` reads
  `window.getComputedStyle(target).getPropertyValue("--wails-draggable").trim() === "drag"`
  (`internal/runtime/desktop/@wailsio/runtime/src/drag.ts:98-108`), and `suppressEvent` (`:76-88`)
  turns a macOS double-click on such a region into `invoke("wails:drag:doubleclick")` — the native
  zoom/minimise-on-double-click behaviour, for free.

### 1.2 The left panel

`WorkbenchShell.vue:24-40` puts `ProjectPanel` in `grid-area: project` behind
`data-testid="project-panel"`, with a `PanelSplitter` bound to `layoutState.panel.project.width`
(min 180, max 480) and visibility from `layoutState.panel.project.visible`.

`ProjectPanel.vue` is **two things in one file**:

- *Generic panel shell*: a 34px `.p-panel-head` (`:103-105`, deliberately taller than the shared
  26px primitive so it lines up with `WorkbenchShell.vue:112-129`'s tab-strip row), a
  hidden-by-default search box revealed by a toggle or by typing (`:15-25`, `:71-74`), and a
  VS-Code-style type-ahead redirect that catches a single printable character bubbling up from a
  focused tree row and pushes it into the search field (`:32-59`).
- *Studio content*: the literal title `Connections` (`:65`), an **Add connection** button
  (`:75-81`), the `connectionsState.records.length > 0` gate (`:83`), the empty text *"Everything you
  connect to shows up here."* (`:91-94`), and two Studio dialogs mounted inline (`:95-96`).

`ProjectTree.vue` is likewise two things:

- *Generic tree host*: `VirtualList` with `:items="visibleRows"` and `:row-height` (`:209-214`), a
  `#default` scoped slot rendering one row (`:215-224`), a `#sticky` slot rendering the pinned
  ancestor band (`:225-241`), `onScrollState` republishing `VirtualList`'s `scrollstate` emit
  (`:65-70`), the band's own row cap clamped to the panel height (`:74-80`), and a
  `pendingScrollKey` watch that waits an animation frame, finds the row index, computes the band
  inset and calls `scrollToIndex` (`:85-96`).
- *Studio behaviour*: five hardcoded openable-kind sets and a caps-driven key-browser predicate
  (`:35-53`), `onOpen`'s five-way dispatch into `openDataTab`/`openDocumentTab`/`openKeyValueTab`/
  `openStreamTab`/`openBrowseTab` with a `reloadTab` on reuse (`:118-154`), the row/background
  context menus (`:156-167`), and six tree keyboard shortcuts (`:169-198`).

`project/state/tree.ts` is the row model. `TreeRowVm` (`:11-32`) carries `depth`, `hasChildren`,
`expanded`, `name`, `badges`, `detail` — plus `connectionId`, `color`, `status`, `statusDetail`.
`treeState` (`:58-70`) holds a `shallowReactive` children cache keyed `connectionId|path`, plus
`expanded`/`loading` Sets, per-connection visibility, the search string, the selection and
`pendingScrollKey`. `visibleRows` (`:531`) is a computed flattening of that cache through
`buildRows`/`buildNodeRow` (`:344-454`) with a 150 ms debounce on the query (`:463-479`).

`TreeRow.vue` renders one row: a connection colour rail resolved per row via `connectionRecord`
(`:42`, `:111`), a twisty (`:118-128`), a status dot for connection rows (`:130-132`), an
`EngineIcon` for the connection's engine (`:133-135`), `columnTypeIcon(detail)` for column rows
(`:29`), search-match `<mark>` splitting (`:53-73`), badges, and an `ErrorPopover`.

`project/stickyBand.ts` is the pinned-ancestor geometry: pure, DOM-free and Vue-free by its own
header comment (`:1-4`), generic over `T extends StickyRowLike` where `StickyRowLike` is exactly
`{depth, hasChildren, expanded}` (`:6-11`), capped at three rows (`:24`), plus `stickyInsetFor`
(`:123-132`).

### 1.3 The tab strip and content area

`WorkbenchShell.vue:42-45` stacks `<TabStrip />` in a fixed 34px row above `<MainView />`.

`TabStrip.vue` renders `tabsState.tabs` (`:113`) as `.p-tab` buttons with a per-tab connection colour
rail (`:24-26`, `:179`), an icon derived by branching on `tab.kind` and then falling through to
`pathTail(tab.path)?.kind` (`:28-44`), `tabTitle(tab)` (`:190`), a close affordance, middle-click
close (`:50-52`), an eight-item context menu (`:61-111`), drag-reorder calling `moveTab(from, index)`
live on every `dragover` (`:144-157`), wheel-to-horizontal scrolling (`:138-140`), and an
auto-scroll-into-view watch on the active tab (`:113-133`). With no tabs it renders an empty strip
that keeps its height (`:202-205`).

`MainView.vue` is a **nine-branch `v-if` / `v-else-if` chain** (`:67-144`): seven tab-kind views, each
statically imported (`:16-22`) and keyed `:key="activeTab.id"`, then two Studio empty states — the
first-run panel gated on `connectionsState.records.length > 0` (`:100-113`) and the "Recent tables"
start page driven by `recentTablesState` (`:115-144`).

`state/tabs.ts` is the store. `tabsState` (`:67-72`) is `{tabs: TabRecord[], activeId: string|null,
hydrated: Set<string>}`. `openTab` (`:201-246`) is already a generic helper behind the six public
openers (`:251-351`). Everything else branches per kind: `dropPageStoresForTab` calls five
view-owned page stores imported at module scope (`:32-37`, `:47-53`); `duplicateTab` is a
seven-branch if/else reconstructing a record per kind (`:354-437`); seven `patch*TabState` wrappers
sit over one generic `patchTabState` (`:560-602`). Persistence is a 1 s debounce plus an
identical-snapshot skip (`:97-124`) writing the whole array through `control.tabsSave`.

Storage: `tabs(id, connection_id, path, kind, state_json, "order", active, window_key)` —
`connection_id` has **no** `NOT NULL` (`migrations/0001_init.sql:87-95`), `window_key` was added by
`0002_p8_windows.sql`. `TabsRepo.Save` (`repos/tabs.go:80-113`) deletes and re-inserts the window's
whole set, writing `order` as the array index and `active` per row. `model.TabRecord.Validate`
(`model/tabs.go:51-64`) checks a non-empty id/path-kind envelope only.

### 1.4 Mode: there is no such concept

Nothing in the tree distinguishes "which top-level area am I in". `tabsState.activeId` is a single
value; `TabRecord.active` is a single boolean with exactly one `true` (`activateTab`, `:505-511`);
`hydrateTabs` picks `tabs.find(t => t.active) ?? tabs[0]` (`:177`).

---

## 2. Findings

### F1 — The title bar is genuinely new UI, but the window option it needs already exists
`window.go:64-89` sets no title-bar option at all, and there is no title-bar component in
`frontend/src`. What is *not* new is the enabling mechanism: `MacTitleBarHiddenInset`
(`webview_window_options.go:833-841`) and the `--wails-draggable` CSS protocol (`drag.ts:98-108`)
are both present in the pinned `v3.0.0-beta.16`. So this is one Go option plus one Vue component,
not a window-manager project.

### F2 — `Frameless: true` would cost the traffic lights
`effectiveMacWindowButtonStates` (`webview_window_options.go:58-71`) forces `minimise`, `close` and
`zoom` to `ButtonHidden` whenever `options.Frameless && usesNativeMacFramelessFrame(options.Mac)`,
and `usesNativeMacFramelessFrame` (`:53-55`) is true for the default `CornerType`/`CornerRadius`.
A frameless window would therefore need the app to draw its own window controls. `MacTitleBarHiddenInset`
keeps AppKit's, inset, with `FullSizeContent: true` — exactly the Electron `titleBarStyle:
'hiddenInset'` shape this design wants.

### F3 — The window's background colour already disagrees with the app's own chrome token
`window.go:72` sets `BackgroundColour: application.NewRGB(24, 24, 27)` = `#18181B`;
`tokens.css:5` sets `--kira-bg-chrome: #181818`. Invisible today (the webview covers the whole
client area). It stops being invisible the moment the title-bar strip is the app's own paint over a
transparent AppKit title bar, where any seam shows during a live resize.

### F4 — `project/state/tree.ts` is a connection cache, not a tree renderer
Every one of its load-bearing behaviours is about database connections, not about trees:
`expand()` **connects a disconnected connection** before fetching (`:153-160`); `loadChildren` calls
`control.treeChildren` (`:114`); `dropConnectionState` purges six collections keyed by connection
identity (`:252-272`); `initTreeSync` subscribes to `onConnectionMetadataInvalidated`,
`onConnectionsChanged` and `onConnectionState` (`:296-326`); `buildRows` filters through
per-connection visibility sets and groups children into folders labelled by *engine*
(`labelForGroup(group.kind, connectionKind)`, `:445`); `searchResult` iterates
`connectionsState.records` and reads `state?.caps?.keyBrowser` (`:486-494`).
An HTTP collections tree has no connect step, no metadata invalidation channel, no visibility rules,
no engine-dependent group labels and no capability flags. An adapter interface spanning both would be
a ten-method interface on which the Http side returns a constant for seven of them.

### F5 — `TreeRow.vue` is DB-shaped in its content, generic only in its layout
Connection colour rail via `connectionRecord(row.connectionId)` (`:42`, `:111`), a status dot with
four connection statuses (`:130-132`, `:220-249`), an `EngineIcon` keyed on the connection's engine
kind (`:46-49`, `:133-135`), a column-type icon derived from `row.detail` (`:29`), and a
connect-failure detail line (`:156-162`). What *is* generic: the indent (`:100`), the twisty, the
label + search highlighting, badges, and the trailing detail.

### F6 — The subtle, expensive half of the panel is **already** parameterized
`stickyBand()` is `<T extends StickyRowLike>` where `StickyRowLike` is three fields
(`stickyBand.ts:6-11`, `:69`), explicitly DOM-free and Vue-free (`:1-4`). `VirtualList.vue` is
`generic="T"` (`:1`) with an overscan window, optional per-row heights, a `#sticky` overlay slot
(`:161-163`), a `#header` slot, `scrollstate`/`visible-range` emits (`:26-29`) and an exposed
`scrollToIndex(index, inset)` (`:132-146`). And `ProjectTree.vue` **already** renders each row
through a scoped slot (`:215-224`). Any "generalize the tree" work that rewrites these is
re-deriving what exists; the real gap is only that the *wiring between them* lives inside a file
called `ProjectTree.vue`.

### F7 — `ProjectPanel.vue` mixes a generic shell with Studio content, in one 123-line file
Generic: the header row's geometry (`:103-105`), the search reveal/toggle (`:15-25`), the type-ahead
redirect (`:32-59`). Studio-specific: the title (`:65`), the add-connection action (`:75-81`), the
records gate (`:83`), the empty copy (`:91-94`), the two mounted dialogs (`:95-96`).

### F8 — `SearchBox.vue` writes Studio state directly
`SearchBox.vue:11` is `v-model="treeState.search"` and `:23` clears the same field. A search box
shared by two modes cannot import `project/state/tree` at all.

### F9 — `MainView.vue` is switch-driven, and both of its empty states are Studio's
`:67-98` is a seven-way chain over `activeTab.kind`; adding a kind edits it. `:100-113` is
first-run copy about *connections*; `:115-144` says *"Pick something from the tree on the left"* and
renders "Recent tables" from `recentTablesState` (`state/tabs.ts:85-95`). Neither is meaningful in
Http mode, and neither can simply be hidden — a mode with nothing open still needs *something* there.

### F10 — Two tab-level helpers assume a tab addresses a *tree node*
`TabStrip.iconFor` falls through to `pathTail(tab.path)?.kind` and a `table/view/matview` icon map
(`TabStrip.vue:37-43`), and `tabTitle(record)` is `pathTail(record.path)?.name`
(`packages/shared/domain/tabs.ts:271-277`). An HTTP request tab's title is a request name and its
`path` is not a `${kind}:${name}` node path at all. Both must become per-kind, not per-path.

### F11 — `TabStrip.vue` reaches into `project/` for a Studio-only menu item
`:7` imports `revealPath` from `../../project/state/tree`, used by the hardcoded
*"Reveal in project panel"* item (`:102-109`). That item makes no sense for a tab whose mode has no
project tree.

### F12 — `state/tabs.ts` grows a branch per tab kind, in three places
Five view-owned page stores imported at module scope and called unconditionally
(`:32-37`, `:47-53`); a seven-branch `duplicateTab` (`:354-437`); seven thin `patch*TabState`
wrappers (`:574-602`). The first is the worst: a *generic* tab store that names every view module.

### F13 — `reloadTab` throws for an unregistered kind
`state/viewCommands.ts:24-28` throws `viewCommands: no reload registered for tab kind "…"`, and
`reloadTabsForTarget` (`:93-109`) switches on four kinds. A future Http tab kind must either
register a reloader or never reach these — worth stating now, since the registry is where that
obligation should be declared.

### F14 — One active tab, app-wide — the single thing that genuinely must change
`tabsState.activeId` is one value (`:68`) and `activateTab` sets `t.active = t.id === id` across the
whole array (`:505-511`). Two modes need one active tab each.

### F15 — `moveTab` takes array indices
`moveTab(from, to)` splices `tabsState.tabs` by index (`:517-526`), and `TabStrip.vue:149-153` passes
the `v-for` index. The instant the strip renders a *filtered* list, those indices stop addressing the
same array.

### F16 — The renderable-kind vocabulary is maintained twice
`RENDERABLE_TAB_KINDS` (`packages/shared/domain/tabs.ts:20-28`) and `model.RenderableTabKinds`
(`internal/storage/model/tabs.go:26-29`) are two hand-written lists of the same seven strings; a row
of any other kind is dropped on read with a `warn` (`repos/tabs.go:56-60`). P1 adds no kind, so this
is inert here — recorded because P2 will edit both, and because it is the reason P1 must **not**
invent a placeholder `'http'` kind just to prove the seam.

### F17 — *Verified safe*: a connectionless tab already round-trips, end to end
`connectionId` is `z.string().nullable()` (`packages/shared/domain/tabs.ts:154`), `*string` in Go
(`model/tabs.go:15`), and a plain nullable column in SQL (`0001_init.sql:89`); `TabsRepo.List`
already reconstructs the null case (`repos/tabs.go:61-65`). Both connection-driven cleanup handlers
already guard: `onConnectionsChanged` filters on `t.connectionId && !liveIds.has(...)`
(`state/tabs.ts:151-153`), and `onConnectionState` compares `t.connectionId !== state.connectionId`
(`:168`), which a `null` never satisfies. `connectionRecord(null)` returns `undefined` by design
(`state/connections.ts:38-41`) and `connColorVar(undefined)` returns `undefined`
(`theme/connColor.ts:11-13`), so `TabStrip`'s rail resolves to `transparent`
(`primitives.css:572-578`). **Nothing needs to change for a tab with no connection.**

### F18 — *Verified safe*: nothing enforces a single active tab
`TabsRepo.Save` writes `rec.Active` per row with no uniqueness constraint (`repos/tabs.go:97-103`);
`0001_init.sql:94` is `active INTEGER NOT NULL DEFAULT 0`; `model.TabRecord.Validate`
(`model/tabs.go:51-64`) never looks at it; `hydrateTabs` reads `tabs.find(t => t.active)`
(`state/tabs.ts:177`). So **one active tab per mode persists and restores with no Go change and no
migration** — the whole reason §4 D5's mode design costs nothing at the storage layer.

### F19 — The lint rules decide where the registries live
`biome.json:66-103` forbids `views/** → workbench/**` and cross-`views/<kind>` imports;
`:104-123` forbids `project/** → views/**`. `state/tabs.ts` already imports `views/*/page`
(`:32-37`), so `state/ → views/` is an established, lint-permitted edge, while `state/ → workbench/`
would be a new upward one. Therefore the registry must split: everything component-free in
`state/`, the component map in `workbench/`. (`docs/v1/plans/P41-…md:212-217` records the same
constraint biting a previous phase from the other direction.)

### F20 — The left panel's width and visibility are one app-wide pair
`layoutSchema.panel.project` is `{visible, width}` (`packages/shared/domain/layout.ts:3`, `:31-37`),
applied app-wide to every window on a broadcast (`state/layout.ts:16-20`). Two modes sharing one
panel slot therefore share one width unless the schema grows a second entry.

### F21 — The View menu and the palette name Studio's panel
`internal/shell/menutemplate.go:74` is *"Toggle Project Panel"*, `shortcuts/state.ts:22` is
*"Toggle project panel"*, and `SHORTCUTS['view.toggleProjectPanel']` is ⌘B
(`packages/shared/domain/shortcuts.ts:27`). Correct in Studio, mildly wrong in Http.

---

## 3. Checked, and not fired

- **`stickyBand.ts` needs no change.** F6: already generic over three structural fields. It is
  *moved*, not edited (§5 C1). `docs/v1/plans/P41-…md:110-114` reached the same conclusion about the
  same module for a different reason.
- **`VirtualList.vue` needs no change.** F6: overscan, sticky slot, `scrollToIndex(index, inset)` and
  the `scrollstate` emit are exactly what a second tree would need. `:9-17`'s own comment names its
  existing callers as the regression guard for that claim.
- **No migration, no `TabsRepo` change, no Go model change.** F17 + F18.
- **No bindings regeneration.** No bound-service method changes, so
  `tests/ui/support/mockRuntime.ts`'s `CHANNEL_TO_FQN` gains no entry and the `-names` failure mode
  `AGENTS.md` warns about has no subject here.
- **The data plane is untouched.** No edit to `internal/adapterhost/`, `bridge/stream.go` or
  `frontend/src/bridge/`. If a commit in §5 seems to need one, re-read §2.
- **A second left panel is not being added.** `docs/v1/plans/P41-…md:225-231` (F15) established that
  the app has exactly three layout panels and that adding a fourth costs a schema field, a patcher, a
  splitter and a persisted size. P1 does not add one: Http *replaces* the content of the existing
  panel slot, it does not sit beside it.
- **The `p-tab` primitive already exists** (`primitives.css:358-376`, with `.is-active`), and it is
  what `TabStrip.vue:172` already uses — so the mode tabs need no new visual language.
- **`EmptyState.vue`** (`theme/primitives/EmptyState.vue:7-19`, icon + label + optional slot) is
  exactly the placeholder Http mode needs, so P1 ships no bespoke placeholder styling.

---

## 4. Decisions

### D1 — No new library, and here is the check rather than the assertion
`AGENTS.md` requires reaching for a maintained library before hand-rolling non-trivial
infrastructure, and requires naming the requirement when declining one.

- **A docking/tab-layout library** (`dockview`, `golden-layout`, `rc-dock` — all MIT, so the decline
  is on requirements, not licence). Declined: the requirement is not new layout capability. The
  existing strip's behaviour is entirely app-specific — a per-tab connection colour rail
  (`TabStrip.vue:179`), close-others/close-to-the-right (`state/tabs.ts:459-491`), duplicate-with-fresh-state
  (`:354-437`), a reconnect gate per tab (`docs/ARCHITECTURE.md`'s session-restore rule), and
  persistence into this app's own `tabs` table scoped by `window_key`. Every candidate brings its own
  layout model *and its own persistence model*, which would replace `TabsRepo` semantics wholesale
  for a phase whose entire point is to change nothing about Studio.
- **A tree/virtualizer library** (`@headless-tree/core`, `vue-virtual-scroller`). Declined: F6 —
  the virtualizer and the ancestor-band geometry already exist, are budgeted (`docs/PERF.md:50`:
  cached tree expand ≤ 50 ms p95, measured 1.3–1.4 ms) and are covered by `tests/ui/tree.spec.ts:360-383`.
  `@tanstack/vue-virtual` was *removed* as a dependency in v1.1 (`docs/ARCHITECTURE.md:40`); re-adding a
  virtualizer would reverse a measured decision to satisfy a refactor.
- **Vue itself supplies the dispatch primitive** (`<component :is>`), which is what replaces
  `MainView.vue`'s chain. Nothing is hand-rolled.

### D2 — The title bar: `MacTitleBarHiddenInset` + a DOM strip, not `Frameless`
`shell.Options` gains `Mac.TitleBar: application.MacTitleBarHiddenInset` (F1) and **not**
`Frameless: true` (F2 — that would hide the traffic lights and oblige the app to draw window
controls, which `docs/v1.2/SPEC.md` never asked for). `Title: "Kira Studio"` stays, since AppKit
still uses it for the window list and Mission Control even with `HideTitle: true`.
`BackgroundColour` moves to `NewRGB(24, 24, 24)` to match `--kira-bg-chrome` (F3).

`workbench/TitleBar.vue` draws the bar itself:

- root element carries `--wails-draggable: drag` (`drag.ts:98-108`) and gets the native macOS
  double-click-to-zoom behaviour for free (`drag.ts:76-88`);
- **every interactive child overrides it** — CSS custom properties inherit, and `isDraggableEvent`
  reads the *event target's* computed style, so a mode-tab button inside a `drag` region is itself
  draggable unless it declares `--wails-draggable: none`. This is the one detail that will silently
  break the mode tabs if missed;
- two `.p-tab` buttons (`primitives.css:358-376`), `data-testid="mode-tab"` `data-mode="studio|http"`;
- a left inset clearing the traffic lights, expressed as a token (`--kira-titlebar-inset-left`) so
  the real-Mac measurement lands in one place, and a height token `--kira-titlebar-h`.

On Linux (`wails3 task dev` here) and under `tests/ui` (a static file server in WebKit with no Wails
window at all) the property is inert and the bar renders as ordinary DOM — which is precisely what
makes §6's mode-switch spec runnable in this sandbox.

`App.vue` wraps `<TitleBar />` and `<WorkbenchShell />` in one `.app-frame` (`height: 100%`, flex
column) and `.workbench-shell` swaps `height: 100%` for `flex: 1; min-height: 0`. Its padding and
grid are untouched, so `tests/ui/workbench.spec.ts:14-37` still holds.

### D3 — The left panel is a **shell with pluggable content**, not one adapter-parameterized tree
Justified by F4/F5 against F6/F7: what the two modes share is the *panel* (header, title, actions,
search reveal, type-ahead, empty slot, resize, collapse) and the *tree mechanics* (virtualization,
the sticky ancestor band, reveal-scroll with band inset, roving focus, background context menu).
What they do not share is the row model or the row itself. So P1 extracts two components and leaves
`project/state/tree.ts` and `TreeRow.vue` **exactly where they are, unchanged**:

- `workbench/panels/LeftPanel.vue` — the shell. Slots: `#title`, `#actions`, `#body`, `#empty`.
  Owns the search reveal/toggle (`ProjectPanel.vue:15-25`) and the type-ahead redirect (`:32-59`),
  both moved verbatim, and mounts `theme/primitives/PanelSearchBox.vue` with `v-model:search` so the
  mode owns the string (F8). Keeps `data-testid` values `toggle-search` and `tree-search`.
- `theme/primitives/TreeHost.vue` — the tree mechanics. Generic over `T extends StickyRowLike &
  {key: string}`; props `rows`, `rowHeight`, `selectedKey`; a `#row="{ row, sticky }"` scoped slot;
  emits `background-contextmenu`; exposes `revealKey(key)` which does the animation-frame wait, the
  index lookup, `stickyInsetFor` and `scrollToIndex` (today `ProjectTree.vue:85-96`). `rowHeight` is
  a **prop**, not a `settingsState` read, so the primitive stays app-state-free — even though
  `ViewChrome.vue:4-5` shows a primitive importing `state/` is precedented.
- `project/stickyBand.ts` moves to `theme/primitives/stickyBand.ts`, content unchanged, so a
  primitive never imports from `project/`. It has no unit test to update (`tests/unit/` has no
  sticky spec); `tests/ui/tree.spec.ts:360-383` is the guard.
- `ProjectPanel.vue` keeps only Studio's content: the `Connections` title, the add-connection
  action, the records gate, the side-empty copy, the two dialogs, and `<ProjectTree />` in `#body`.
- `ProjectTree.vue` keeps everything in F4/F5's second half and renders through `TreeHost`.
- `http/CollectionsPanel.vue` is Http's `#body`: an `EmptyState` reading *"Collections arrive in a
  later phase"*. It mounts no tree at all — a tree with nothing to show would be a stub.

**Why not one generic tree parameterized by a data adapter.** Because the adapter's surface would
have to cover: connect-before-expand, an IPC children call, per-connection visibility filtering,
engine-dependent group folders, capability-driven leaf-ness, three connection event subscriptions and
a per-connection state purge (F4) — of which a collections tree needs none. The generic thing here
is *how rows are virtualized, pinned and revealed*, and that is what `TreeHost` captures.

### D4 — The tab area is a **registry**, split in two by the lint rules
Per F19:

- `state/tabKinds.ts` (component-free) — `TAB_KINDS: { [K in TabKind]: TabKindDef<K> }` with
  `mode`, `title(tab)`, `icon(tab)`, `railColor(tab)`, `defaultState()`, `duplicateState(tab)`,
  `dropResources(tabId)`, `menuExtras(tab)`. Studio's seven entries carry today's behaviour verbatim:
  `title` is `tabTitle` (F10), `icon` is `TabStrip.iconFor`'s existing body, `railColor` is
  `connectionRecord(tab.connectionId)?.color`, `dropResources` calls that kind's own page store, and
  `menuExtras` supplies *"Reveal in project panel"* for the studio kinds only (F11). The five
  `views/*/page` imports move here out of `state/tabs.ts` (F12).
- `workbench/tabViews.ts` — `Record<TabKind, Component>`, the only place view components are named.
  `workbench/ → views/` is permitted; `state/ → workbench/` would not be.

Consumers: `MainView.vue` becomes `<component :is="TAB_VIEWS[activeTab.kind]" :key="activeTab.id"
:tab="activeTab" />`; `TabStrip.vue` reads `title`/`icon`/`railColor` and appends `menuExtras` to its
six generic items; `state/tabs.ts`'s `duplicateTab` and `dropAllPagesForTab` read the registry.

`TAB_VIEWS` uses **static** imports, so the bundle keeps exactly the two dynamic chunks
`docs/ARCHITECTURE.md:28` records (`sql-formatter`, `@faker-js/faker`) and launch cost is unchanged.

Typing: `TabKindDef<K>` is keyed on `Extract<TabRecord, {kind: K}>`, so each entry's `duplicateState`
receives its own record type. Where the union genuinely cannot be expressed generically, the
existing precedent is `openTab`'s own `as unknown as TabRecord` (`state/tabs.ts:227-237`) — use the
same, in one place, with the same kind of comment.

### D5 — **Mode is a derived view over the one tab list**, not a second state tree
This is the seam, and it is deliberately the smallest thing that works.

- `packages/shared/domain/mode.ts`: `export type AppMode = 'studio' | 'http'`.
- `packages/shared/domain/tabs.ts` gains `TAB_KIND_MODE: Record<TabKind, AppMode>` beside
  `RENDERABLE_TAB_KINDS` (`:20-28`) — today all seven map to `'studio'`.
- **A tab's mode is a total function of its `kind`.** So there is no mode column, no migration, no
  Go change (F16/F17/F18): `tabs.mode` would be derivable data, and this repo's own rule is that a
  view is chosen by the record's kind, never by a parallel discriminator
  (`docs/ARCHITECTURE.md`'s *"A view is chosen by page kind, never by database type"* is the same
  shape of decision).
- `state/mode.ts`: `modeState = reactive({ active: 'studio' as AppMode })`, `setMode(mode)`, and two
  computeds — `tabsForMode(mode)` (a filter over `tabsState.tabs`) and `activeTab`.
- `state/tabs.ts`: `activeId` becomes `activeIdByMode: Record<AppMode, string | null>`;
  `activateTab(id)` deactivates only tabs of the *same* mode, records the per-mode active id, and
  sets `modeState.active` to that tab's mode — so activating a tab from anywhere (the palette, a
  future reveal) brings its mode forward. `closeTab`/`closeOthers`/`closeToTheRight`/`closeAll` and
  `stepTab` all operate on the current mode's slice. `moveTab` changes signature from `(from, to)`
  indices to `(fromId, toId)` and splices the global array (F15) — one caller, `TabStrip.vue:149-153`.
- `hydrateTabs` sets the boot mode from the restored active tab's kind. In P1 Http has no kinds, so
  boot is always Studio — and it stays correct for free once P2 adds one.
- **Switching mode writes nothing.** `setMode` touches no `TabRecord`, schedules no save, and issues
  no IPC. It is a selection, so the two modes cannot drift, cannot double-persist, and cannot leak
  each other's tabs across a window (`tabs.window_key` scoping, `repos/tabs.go:11`, is untouched).

Persistence consequence, stated plainly: one tab per mode carries `active: true`, which
`TabsRepo.Save` accepts and `hydrateTabs` reads back per mode (F18). Nothing else about session
restore changes, including the never-auto-reconnect rule.

### D6 — Mode content comes from a mode registry, mirroring D4
`workbench/modes.ts`: `MODES: Record<AppMode, {label, icon, panel: Component, start: Component}>`.
Studio → `ProjectPanel` + `StudioStart` (the two empty states extracted verbatim from
`MainView.vue:100-144`, testids `first-run` and `no-tab-open` preserved). Http →
`http/CollectionsPanel` + `http/HttpStart`, both `EmptyState`-based (F9, §3).
`WorkbenchShell.vue` mounts `MODES[modeState.active].panel` inside `LeftPanel`; `MainView.vue` falls
back to `MODES[modeState.active].start` when the mode has no active tab.

### D7 — `http/` is a new top-level tree with its own layering rule
Http's UI is neither `project/` (Studio's connection panel) nor `views/<kind>/` (a tab view), so it
gets `apps/kira-studio/frontend/src/http/`. P1 adds a `biome.json` override forbidding
`http/** → project/**` and `http/** → views/**`, mirroring the rule `project/` already carries
(`:104-123`), so P2–P9 cannot quietly grow the coupling P1 exists to prevent.

### D8 — Both modes share one left-panel width and one visibility toggle, in P1
F20. A per-mode width means a `layoutSchema` field, a `LayoutPatch` branch, a Go model field and a
broadcast — for a preference nobody has expressed. ⌘B keeps toggling "the left panel", whichever mode
owns it. Revisited in §8 OQ-1 when Http's panel actually has content worth sizing differently.

---

## 5. Implementation order

Ten commits. C1–C4 are pure refactors of Studio with no rendered-output change; C5–C8 add the mode
seam and the title bar; C9–C10 are the test and the docs. Per `AGENTS.md`, run the fast checks
(`lint`, `typecheck`, `build`) per commit and the expensive suites once at the end.

### C1 — `refactor(theme): TreeHost, with the sticky band moved beside it`
Move `project/stickyBand.ts` → `theme/primitives/stickyBand.ts` (content unchanged). Add
`theme/primitives/TreeHost.vue` per D3 — VirtualList wiring, `scrollstate` capture, the `stickyMaxRows`
clamp (`ProjectTree.vue:74-80`), the band `computed` and the `#sticky` render, `revealKey()`, the
background-contextmenu emit, and `.sticky-row`'s positioning CSS (`ProjectTree.vue:271-277`).
`ProjectTree.vue` mounts it and keeps everything else. **Guard:** `tests/ui/tree.spec.ts` (sticky band
geometry, `:360-383`) and `tests/unit/tree-state.spec.ts`.

### C2 — `refactor(workbench): LeftPanel, with Studio's content in a slot`
Add `theme/primitives/PanelSearchBox.vue` (from `project/SearchBox.vue`, `modelValue` instead of the
`treeState.search` binding at `:11`/`:23`) and `workbench/panels/LeftPanel.vue` per D3. Reduce
`ProjectPanel.vue` to Studio's content. Delete `project/SearchBox.vue`. Testids `project-panel`,
`toggle-search`, `tree-search`, `add-connection` unchanged.

### C3 — `refactor(state): a tab-kind registry replaces the per-kind branching`
Add `state/tabKinds.ts` (D4, component-free) and `TAB_KIND_MODE` to `packages/shared/domain/tabs.ts`.
Rewrite `state/tabs.ts`'s `dropPageStoresForTab` (`:47-53`) and `duplicateTab` (`:354-437`) to read
it; move the five `views/*/page` imports (`:32-37`) into the registry. No behaviour change.

### C4 — `refactor(workbench): the strip and the main view mount from the registry`
Add `workbench/tabViews.ts`. Extract `workbench/panels/StudioStart.vue` from `MainView.vue:100-144`
verbatim; reduce `MainView.vue` to `<component :is>` plus the start fallback. Rewrite `TabStrip.vue`'s
`colorFor`/`iconFor`/title to registry lookups and its context menu to six generic items plus
`menuExtras`, dropping the `project/state/tree` import (`:7`). **Guard:** `tests/ui/tabs.spec.ts`
(three scenarios: independent state/context menu/colours, submenu edge flip, strip overflow scroll).

### C5 — `feat(state): mode is a view over one tab list`
Add `packages/shared/domain/mode.ts` and `state/mode.ts`. Convert `tabsState.activeId` →
`activeIdByMode`, scope activate/close/step to the current mode, change `moveTab` to ids (F15), and
set the boot mode in `hydrateTabs`. `TabStrip`/`MainView` read the mode's slice. With one registered
mode this is behaviourally identical; C6 is what makes it observable.

### C6 — `feat(http): an empty Http mode`
Add `http/CollectionsPanel.vue` and `http/HttpStart.vue` (both `EmptyState`), `workbench/modes.ts`
(D6), and the `biome.json` override (D7). `WorkbenchShell.vue`/`MainView.vue` mount from the registry.

### C7 — `feat(shell): a full-size-content window, so the app can draw its own title bar`
`shell.Options` gains `Mac.TitleBar: application.MacTitleBarHiddenInset` and the corrected
`BackgroundColour` (D2, F2, F3). Extend `internal/shell/window_test.go` with an assertion on the
returned option values — the same "a posture value is asserted so a revert is never silent" shape
`security_test.go` already uses.

### C8 — `feat(workbench): a custom title bar carrying the Studio / Http mode tabs`
Add `workbench/TitleBar.vue`, the `.app-frame` wrapper in `App.vue`, the `.workbench-shell` flex
change, and `--kira-titlebar-h` / `--kira-titlebar-inset-left` in `tokens.css`. Drag regions per D2,
including the `--wails-draggable: none` override on every button.

### C9 — `test(ui): the mode switch`
`tests/ui/mode-switch.spec.ts` — see §6.2.

### C10 — `docs(architecture): the mode seam, the shared left panel, the tab-kind registry`
Update `docs/ARCHITECTURE.md`: the Stack table's *"native title bar"* (`:25`) becomes the
hidden-inset custom bar; a new UI-architecture paragraph for the mode seam ("a tab's mode is a
function of its kind; mode switching writes nothing"), the `LeftPanel`/`TreeHost` split, and the
tab-kind registry as the successor to `MainView.vue`'s dispatch chain.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`
(the Go side of this phase is one file plus its test and needs no GTK/WebKit headers —
`AGENTS.md`'s fast-loop note). `scripts/setup.sh` first in a fresh container.

### 6.2 The new spec — and why it is real here, not a mock of a mock
`tests/ui/` drives the real built bundle in real WebKit over a static file server, with both wire
planes mocked (`docs/ARCHITECTURE.md`'s Testing section). There is no Wails window, so
`--wails-draggable` is inert — but the title bar, the mode tabs, the left panel and the tab strip are
all ordinary DOM. `tests/ui/mode-switch.spec.ts` asserts:

1. two `[data-testid="mode-tab"]` elements, `studio` active by default;
2. with a data tab open in Studio, clicking **Http** leaves `[data-testid="tab-strip-empty"]` and
   Http's own empty content, and the left panel's title is no longer `Connections`;
3. clicking **Studio** restores the same tab, still active, with its state intact (page size,
   filter) — the "mode switching writes nothing" property, observed;
4. `[data-testid="project-panel"]` keeps its width across the switch (D8);
5. ⌘B still collapses the panel in either mode.

### 6.3 What only a real Mac can settle
1. The traffic lights are visible, inset, and clear of the mode tabs — this is what
   `--kira-titlebar-inset-left`'s value is for; adjust it once, here.
2. Dragging the bar moves the window; dragging a mode tab does **not** (the inherited-custom-property
   trap, D2).
3. Double-clicking the bar zooms/minimises per System Settings (`drag.ts:76-88`).
4. Entering and leaving fullscreen leaves no gap where the title bar was.
5. No colour seam between the bar and the workbench during a live resize (F3's fix).
6. A second window (⇧⌘N) gets its own title bar and its own mode, independently.

### 6.4 What must not regress
- **Studio renders identically through C4.** `tests/ui/tree.spec.ts`, `tabs.spec.ts`,
  `workbench.spec.ts`, `interaction.spec.ts`, `data-view.spec.ts`, `console*.spec.ts` pass **with no
  spec edits**. A spec edit before C5 is a signal the refactor changed behaviour.
- **The sticky ancestor band's geometry is byte-identical** — `tree.spec.ts:360-383` asserts three
  pinned rows with exact `data-path`/`data-depth` values.
- **Tree-expand stays inside its budget** (`docs/PERF.md:50`, ≤ 50 ms p95, measured 1.3–1.4 ms):
  `TreeHost` introduces no reactive wrapper the current code doesn't have — row rendering already
  goes through a scoped slot (`ProjectTree.vue:215-224`) — and `treeState.children` stays
  `shallowReactive` with the 150 ms search debounce, both guarded by `tests/unit/tree-state.spec.ts:30-70`.
- **`bun run test:ipc:fe` passes unedited** — no bound call changes.
- **The bundle keeps exactly two dynamic chunks** (`docs/ARCHITECTURE.md:28`); `TAB_VIEWS` is a
  static map.
- **No file under `views/**` imports `workbench/**`, and no file under `project/**` imports
  `views/**`** — `bun run lint` is the check (`biome.json:66-123`).
- **`git diff` touches no file under `internal/adapterhost/`, `internal/adapters/`,
  `internal/storage/migrations/` or `frontend/bindings/`.**

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [x] C1 — `stickyBand.ts` moved with zero content diff; `TreeHost.vue` added; `tree.spec.ts` green
      unedited.
- [x] C2 — `LeftPanel.vue` + `PanelSearchBox.vue`; `ProjectPanel.vue` reduced to Studio content;
      `project/SearchBox.vue` deleted; all four testids preserved.
- [x] C3 — `state/tabKinds.ts`; `duplicateTab`'s seven branches gone (reads the registry). The five
      `views/*/page` module-scope imports F12 named (grid/console/documents/keyvalue/stream) moved
      into the registry, as specified. One narrower nuance against this line's literal wording:
      `state/tabs.ts` still imports `clearPending` from `views/grid/pendingChanges` — pre-existing,
      unrelated to page-kind dispatch (it's the grid's own staged-edit cleanup on tab close, called
      unconditionally the same way `clearSelectedCellFor` is), and never one of F12's five. Moving
      it was outside D4/C3's actual scope, so it was left alone rather than force this line's exact
      wording.
- [x] C4 — `workbench/tabViews.ts`; `MainView.vue` is one `<component :is>`; `StudioStart.vue`
      extracted verbatim (testids `first-run`, `no-tab-open`); `TabStrip.vue` no longer imports
      `project/state/tree`.
- [x] C5 — `activeIdByMode`; mode-scoped activate/close/step; `moveTab(fromId, toId)`; boot mode
      derived from the restored active tab.
- [x] C6 — `workbench/modes.ts`; `http/` with two `EmptyState` components; `biome.json` override
      added and proven by `bun run lint` (a deliberate `http/ -> project/` import was introduced,
      caught by the new rule, then reverted).
- [x] C7 — `Mac.TitleBar` set; background aligned to `#181818`; `window_test.go` asserts both
      (`TestOptions_CustomTitleBarPosture`).
- [x] C8 — `TitleBar.vue`; `.app-frame`; two new tokens; `--wails-draggable: none` on every
      interactive child of the bar.
- [x] C9 — `tests/ui/mode-switch.spec.ts`, five assertions, passing twice in a row.
- [x] C10 — `docs/ARCHITECTURE.md` updated (Stack row `:25`, plus the three new UI-architecture
      paragraphs).
- [x] §6.1's full command set green — `bun run lint`, `bun run typecheck`, `bun run build`,
      `bun run test:unit` (248/248), `bun run test:ui` (99/99, one perf tripwire flake reproduced
      as pre-existing environmental noise — see the implementing session's own final report),
      `go build ./...`, `go vet ./...`, `go test ./apps/kira-studio/internal/...` (all green).
      `bun run test:ipc:fe`: 2/6 pass; the other 4 (clickhouse/mysql/kafka/sqs) fail identically at
      the pre-P1 baseline commit (`809e4fb`, reproduced in an isolated worktree) — pre-existing
      sandbox flakiness this phase neither caused nor was asked to fix.
- [x] §6.3's six manual macOS steps — **none could actually run in this Linux sandbox** (no
      display, no Wails window; confirmed expected per this line's own note). All six were checked
      by reading the pinned Wails source instead: `--wails-draggable`'s mechanism
      (`drag.ts:98-108`), `MacTitleBarHiddenInset`'s effect (`webview_window_options.go:832-841`)
      and `effectiveMacWindowButtonStates`'s Frameless-only trigger (`:58-71`) were all read
      directly, not inferred. `--kira-titlebar-inset-left` ships as an estimate (`78px`, tokens.css)
      with no real-Mac measurement to record — flagged for whoever first runs this build on real
      hardware to adjust in that one place.

---

## 8. Open questions, handed forward

**OQ-1 — A per-mode left-panel width.** D8/F20 share one `layoutState.panel.project`. If Http's
collections tree (P4) wants a different default width, the change is a second `layoutSchema` entry
plus its Go model field and patcher — mechanical, but a schema change, so it should be decided when
there is real content to size, not now.

**OQ-2 — Mode persistence when the active mode has no tabs.** D5 derives the boot mode from the
restored active tab, so switching to an empty Http mode and quitting returns to Studio. Correct-ish
and free today; if it grates once Http has content, the honest fix is a per-window `windows` column,
not an `ui_layout` leaf (which is app-wide, `docs/ARCHITECTURE.md`'s per-window/app-wide split).

**OQ-3 — Menu and shortcut wording.** F21: *"Toggle Project Panel"* (`menutemplate.go:74`) and the
palette's *"Toggle project panel"* (`shortcuts/state.ts:22`) name Studio's panel. A rename to
*"Toggle Left Panel"* and a mode-switch accelerator (⌃1 / ⌃2, or ⌘1 / ⌘2) both belong to a phase that
has a second mode worth switching to. Deliberately not done in P1 so the diff stays a refactor.

**OQ-4 — Windows/Linux title bar.** `Mac.TitleBar` is macOS-only and v1 targets macOS
(`docs/ARCHITECTURE.md:25`). On Linux the bar renders but the OS decorations stay, so the app shows
two bars in `wails3 task dev`. Acceptable for a dev-only platform; a real cross-platform title bar
needs `Frameless` plus an app-drawn control cluster plus `WindowMaskDraggable`
(`webview_window_options.go:371-380`).

**OQ-5 — The operations panel and the status bar are Studio-shaped.** The op log records
adapter ops (`internal/oplog/`), and the status bar reports cache size and the engine pid. When Http
requests become real ops in P2, the question is whether they join the same op log (one funnel, one
history) or get their own. Recorded so P2 decides it deliberately rather than by default.

**OQ-6 — The kind vocabulary is maintained twice.** F16: `RENDERABLE_TAB_KINDS` and Go's
`model.RenderableTabKinds`. P2 will edit both, in two languages, to add one string. Worth considering
a generated Go constant from the TypeScript source (the repo already generates FlatBuffers types both
ways) — but only once there is a second kind to justify the machinery.

**OQ-7 — `reloadTab` throws for an unregistered kind** (F13, `state/viewCommands.ts:24-28`). P1 adds
no kind, so nothing can hit it. P2's first Http tab kind must either register a reloader or the
registry must declare it as `reloadable: false` and `reloadTab` must consult that instead of
throwing. Flagged here because the throw is easy to trip and hard to attribute.
