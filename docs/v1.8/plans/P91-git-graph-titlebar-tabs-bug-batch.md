# P91 — git graph column/scroll/labels, titlebar, diff tabs, review nav, tab persistence

`docs/v1.8/SPEC.md`'s P91 row (`:165`), turned into concrete steps. Everything below was read in the
current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `56e0401c`, P71-P90 landed); every line
number is from that tree.

Ten items, ten commits. A bug batch, not a redesign — every fix below is scoped to the mechanism
that is actually wrong. Item 5 is the one that adds a surface (a tab kind and a view), because
"one tab instead of N" cannot be expressed in the existing kind.

No new dependency. One new Go bound method (item 3), one new tab kind (item 5), one new settings
leaf (item 9), one `PersistedViewState` version bump (item 1). No SQLite migration.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Do items 2 and 4 share a root cause? | **No.** Item 2 is column-width arithmetic (`computeMessageWidth` measures the wrong box); item 4 is SlickGrid's row-position index going stale against already-rendered rows. Same file, unrelated mechanisms, two commits | §2, §3 |
| Does the graph column really grow "without bound"? | **No** — `GEOMETRY.maxLanes` caps it at 173px. It still grows with lane count, the user cannot shrink it, and 173px of an 8-lane repo's panel is the complaint. The fix is user control plus a lower default, not a new cap | §4.1 |
| Where does the graph column's width get clipped once the user can narrow it? | `clip-path: inset(-2px 0)` on `.kv-graph-svg` — clips left/right at the element box, leaves `GEOMETRY.overdraw`'s vertical bleed intact. `overflow: hidden` cannot: CSS forces the other axis to `auto` the moment one axis is not `visible` | §4.3 |
| Which tab-creation path leaves `path` unset? | **Exactly one**: `createPinnedRepoGraphTab` (`state/tabs.ts:587`) writes `path: ''`. Every other opener passes a real path | §9.1 |
| Does item 8 clear the unit-test bar? | **No.** One literal, no interacting rules. Coverage goes in Playwright | §12.1 |
| Item 5: extend `repo-diff`, or a new kind? | **New kind** (`repo-multi-diff`). `repo-diff` is one file's two revisions end to end — its title, its `dropResources`, its go-to-file command and `editors.ts`'s per-tab model registry all assume exactly one path | §7.2 |
| Item 7: what is actually missing? | The **affordance**, not the behaviour. P74 shipped `repo.goToFileFromDiff` as a palette command only (`RepoDiffView.vue:203`-`:236`'s own comment says why), and gated it on `right !== null`, so a worktree diff has none at all | §8.1 |
| Item 9: where does a git-graph font size actually land? | One leaf, `git.graphFontSize`, applied as `--kira-graph-font-size` on `documentElement`; `vscode-bridge.css` feeds it into `--vscode-font-size`, whose only consumer in the whole tree is `git-ui`'s own `--kv-font-size` | §10.2 |
| Item 10: is white text safe with no fill? | On the dark theme yes. `--kv-badge-fg` is `var(--vscode-badge-foreground, #ffffff)` (`vscode-tokens.css:65`) — a theme-supplied token, not a literal, so a light theme supplies its own. Verify by eye in both themes (§13) | §11.2 |

Genuinely left out, named rather than half-built (`CLAUDE.md`'s "scope left out stays out"):

- **P87** (the keep-awake control). Deferred, as SPEC says; nothing here touches the status bar.
- **Per-file collapse state persistence** in item 5's multi-diff tab. The open/collapsed set is
  session state on the mounted view, not tab state.
- **A resizable graph column in the VS Code extension's own review diff**. Item 1 is the commit
  grid's column model; nothing else uses `ColumnWidths`.

---

# Item 1 — a resizable, capped graph column

## 1.1 What exists today

`packages/git-ui/src/components/columns.ts:236`-`:247` builds the graph column with
`width: graphColumnWidth(widths.laneCount)` and `resizable: false`. `graphColumnWidth`
(`graph/geometry.ts:49`) is `padLeft + min(laneCount, maxLanes) * laneWidth + gutterPad` —
`11 + min(n,12)*13 + 6`, so 30px at one lane and 173px at twelve, recomputed on every lane-count
growth by `CommitGrid.vue`'s `handleChunkLayout` (`:590`) and its `generation` watcher (`:902`).

`ColumnWidths` (`state/viewState.ts`) holds `author` and `date` only. `CommitGrid.vue` renders its
own two drag handles (`:1063`-`:1092`) — SlickGrid's built-in ones live in the header row this grid
does not show (`showColumnHeader: false`, `:752`).

So the graph column is the one column with no user control and the one whose width moves on its own.

## 1.2 The change

**`graph/geometry.ts`** — one new constant beside `GEOMETRY`:

```ts
/** P91 item 1: the widest a *default* graph column gets — six lanes, not `maxLanes`' twelve.
 *  Only the seed; a user drag is free to go past it, up to `MAX_COLUMN_WIDTH`. */
export const DEFAULT_GRAPH_LANE_CAP = 6;
```

**`state/viewState.ts`**:

- `ColumnWidths` gains `readonly graph: number`.
- `DEFAULT_COLUMN_WIDTHS` gains `graph: graphColumnWidth(DEFAULT_GRAPH_LANE_CAP)` (95).
  `viewState.ts` may import from `../graph/geometry.ts` — `geometry.ts` imports nothing, so no cycle.
- `isColumnWidthsShape` requires `typeof record.graph === 'number'`.
- `PersistedViewState.version` 6 -> **7**, and the `record.version === 7` check. The file's own v5
  entry documents the policy this follows: a shape change bumps the version, `parsePersistedViewState`
  discards the whole stale blob, and the panel re-seeds from `DEFAULT_COLUMN_WIDTHS`. Add a v7 entry
  to the file doc comment in the same voice.

**`components/columns.ts`**:

- `ColumnWidthInputs` keeps `laneCount` (the graph *formatter* still needs it) but the graph
  column's `width` becomes `widths.graph`, and `resizable` stays `false` (this repo's handles are
  its own; the flag only governs SlickGrid's header-row handle, which is not rendered).
- Amend the `buildColumns` doc comment: `graph` is no longer in the "not user-resizable" list.

**`components/CommitGrid.vue`**:

- `computeMessageWidth` (`:228`) subtracts `widths.value.graph` instead of
  `graphColumnWidth(laneCount)`. Same in `updateHandlePositions` (`:304`).
- A third handle, graph|message, at `left: widths.value.graph`, `v-if="!detailOpen"` like the other
  two — *and* rendered in compact mode too, since `compact: true` keeps the graph column. Read that
  carefully: the existing two handles are for `author`/`date`, which compact mode drops; the graph
  handle must render whenever the grid does. Give it its own `v-if` (none), `aria-label="Resize
  graph column"`, and wire `startDrag('graph', $event)`/`handleHandleKeydown('graph', $event)` —
  both already take `keyof ColumnWidths` and need no change.
- `updateHandlePositions`' early `if (props.detailOpen) return` (`:301`) now skips a handle that
  *is* rendered in compact mode. Replace it with: always compute `handleLeftGraph`, and compute the
  other two only when `!props.detailOpen`.
- First-ever-mount seed, in `onMounted` beside the existing `date` seed (`:724`-`:731`), under the
  same `props.initialScrollRow === undefined` guard and for the same stated reason:
  ```ts
  const graphSeed = Math.min(
    graphColumnWidth(props.graphView.laneCount.value),
    DEFAULT_COLUMN_WIDTHS.graph,
  );
  ```
  A one-lane repository opens at 30px, not 95.
- `handleChunkLayout` (`:588`-`:590`) and the `generation` watcher (`:902`) no longer need their
  `laneCount !== lastRebuiltLaneCount` rebuild: the column set no longer depends on `laneCount`.
  **Delete `lastRebuiltLaneCount` and all four of its reads** (`:318`, `:346`, `:590`, `:762`,
  `:902`, `:965`) — a dead guard left in place is the kind of thing a later reader trusts. The rows
  themselves still re-render on a chunk (`invalidateRows`), which is what makes new lanes appear.

## 1.3 Clipping, so a narrowed column stays inside itself

`buildRowSvg` (`graph/rowSvg.ts:370`) sizes the `<svg>` from `graphColumnWidth(slice.laneCount)` —
the column's old, derived width. With a user-set width that is no longer the same number, and with
`.kv-cell-graph`/`.kv-graph-cell`/`.kv-graph-svg` all `overflow: visible` (`CommitGrid.vue:1236`-
`:1251`), a narrowed column would paint its lanes over the message column.

Two edits:

- `createGraphFormatter` (`graph/graphColumn.ts:77`) takes a fourth accessor,
  `columnWidth: () => number`, passed by `CommitGrid.vue` as `() => widths.value.graph` — an
  accessor, not a value, matching this package's own convention (`DateFormatterContext`,
  `MessageSearchContext`) so a drag never rebuilds the formatter. `buildRowSvg` takes it as a
  parameter and uses it for `width`/`viewBox` instead of computing one. Lane x-coordinates
  (`laneX`) are untouched — the drawing is the same, the box around it is the column's.
- `CommitGrid.vue`'s `<style>`, `.kv-graph-svg`:
  ```css
  .kv-graph-svg {
    display: block;
    overflow: visible;
    /* P91 item 1: the column is user-resizable now, so a lane past its right edge must be cut.
       `overflow: hidden` cannot do it — one non-visible axis forces the other to `auto` — and the
       0.5px vertical overdraw (GEOMETRY.overdraw) has to survive, or two rows' runs meet with a
       hairline seam at a fractional DPR. */
    clip-path: inset(-2px 0);
  }
  ```

`rowSvg.test.ts` asserts the emitted `width`/`viewBox` — update those expectations to the width the
test now passes in, not a new test.

## 1.4 Scope

`packages/git-ui/src/graph/geometry.ts`, `graph/graphColumn.ts`, `graph/rowSvg.ts`,
`graph/rowSvg.test.ts`, `components/columns.ts`, `components/CommitGrid.vue`,
`state/viewState.ts`.

---

# Item 2 — the horizontal scrollbar sized by the parent

## 2.1 Root cause

`CommitGrid.vue:268` — `currentColumns()` reads `host.value?.clientWidth` and `computeMessageWidth`
(`:233`) hands the remainder to the message column, so the column widths sum to **exactly**
`host.clientWidth`.

SlickGrid measures a different box. `getCanvasWidth()` (`slickgrid/dist/esm/index.js:9550`) returns
the plain sum of column widths (`fullWidthRows` defaults to `false`, `:7251`), writes it onto
`.grid-canvas` as a pixel width, and `setOverflow()` (`:9664`) gives `.slick-viewport`
`overflow-x: auto`. That viewport's own content box is `host.clientWidth` **minus the vertical
scrollbar's gutter**, and its width is measured with `getBoundingClientRect()` (`Utils.width`,
`:624`) — a fractional number, against `clientWidth`'s rounded integer.

So the canvas is wider than the viewport it sits in by (vertical scrollbar width) + (up to 1px of
rounding), permanently, on any platform whose scrollbars take layout space. A horizontal scrollbar
appears whose scroll range is that difference — "size dictated by its parent rather than its own
content", exactly.

## 2.2 Fix

Measure the box SlickGrid actually lays out into.

```ts
/** P91 item 2: the width the column model must sum to — SlickGrid's own viewport content box, not
 *  the host's. `clientWidth` already excludes the vertical scrollbar's gutter; `host.clientWidth`
 *  does not, and the difference is a permanent horizontal scrollbar. Floored because the canvas is
 *  sized in whole pixels against a fractional `getBoundingClientRect()` measurement. `host` is the
 *  fallback for the one call before the grid exists (`onMounted`'s own first `currentColumns()`). */
function availableWidth(): number {
  const viewport = grid?.getViewportNode();
  return Math.floor(viewport?.clientWidth ?? host.value?.clientWidth ?? 0);
}
```

- `computeMessageWidth(hostWidth, ...)` and `updateHandlePositions` take `availableWidth()` in place
  of `host.value?.clientWidth ?? 0` (`:268`, `:302`).
- `scheduleResize`'s `lastRebuiltHostWidth` dedupe (`:624`-`:625`) and `rebuildColumns`' write
  (`:347`) both switch to `availableWidth()`, so the two compare the same number. Rename the
  variable `lastRebuiltWidth` and amend its doc comment's "host width" wording.

`getViewportNode()` is public (`slick.grid.d.ts`). It returns `_viewportTopL` for this grid's
unfrozen configuration — the element `setOverflow` puts `overflow-x: auto` on.

`MIN_MESSAGE_WIDTH` (120) stays. Below `graph + 120 + author + date` the grid genuinely has more
column than panel, and a horizontal scrollbar there is honest.

## 2.3 Scope

`packages/git-ui/src/components/CommitGrid.vue` only.

---

# Item 4 — glyphs unreadable mid-scroll

Listed here, out of numeric order, because §3's header is item 2 and this shares the file. It is
still its own commit.

## 3.1 Root cause: the row-position index and the rendered rows disagree

With `enableVariableRowHeight: true` (`CommitGrid.vue:748`) SlickGrid keeps a `RowPositionIndexer`
holding every row's top. Three facts, read from `slickgrid/dist/esm/index.js`:

1. The index is rebuilt in **exactly one place** — `ensureRowPositionIndexer` (`:10175`), called
   **only** from `updateRowCount()` (`:10209`), and only when `rowHeightsDirty` is set or the row
   count changed.
2. `invalidateRows(rows)` sets `rowHeightsDirty = true` **unconditionally** (`:10022`) and removes
   those rows from the cache. `render()` does not call `updateRowCount()`.
3. A cached row's `transform: translateY()` is written once, when the row is appended
   (`appendRowHtml`, `:9914`). `updateRowPositions()` (`:10390`) is the only thing that rewrites a
   cached row's transform, and it is called from exactly one place — `scrollTo()`, and only when the
   virtual page offset changes (`:10512`), which for any history under `maxSupportedCssHeight`
   never happens.

Now the two call sites in `CommitGrid.vue`:

- `handleChunkLayout` (`:588`-`:594`): `invalidateRows(rows)` + `render()`. Marks heights dirty,
  rebuilds nothing.
- the `loadedRows` watcher (`:876`-`:888`): `updateRowCount()` + `render()`. Rebuilds the index —
  with whatever heights `getItemMetadaWhenExists` answers **now** — and repositions nothing.

So: a chunk lands, heights are marked dirty; the next `loadMore` rebuilds the index against current
metadata; every row already in the cache keeps the transform it was given under the *old* index.
Any row whose height changed in between (`rowMetadata`'s `height` flips with `rowHasBadges`,
`columns.ts:328` — a decoration or a resolved PR) shifts every row below it in the new index, and
the cached rows below do not move. Two rows then occupy one band and both paint their text into it.

That is the reported symptom precisely: not flicker (nothing is being cleared and redrawn), but two
sets of glyphs in one place — unreadable. And it is mid-scroll because scrolling is what delivers
chunks, grows `loadedRows`, and appends fresh rows positioned by the new index beside stale ones.

`.kv-commit-grid .slick-row.ui-widget-content` carries `background-color: transparent` (`:1166`),
which is why the overlap reads as doubled ink rather than one row simply covering the other.

## 3.2 Fix

Use the library's own "index and rows are both stale" entry point wherever the index can be rebuilt.
`invalidate()` is `updateRowCount()` + `invalidateAllRows()` + `render()` (`:10002`);
`invalidateRowHeights()` is `rowHeightsDirty = true` + `invalidate()` (`:10199`). Both are public.

- `handleChunkLayout` (`:588`-`:600`): replace the `invalidateRows(rows)` + `render()` pair with
  `grid.invalidateRowHeights()`. The `range` loop building the `rows` array goes with it; the
  `layoutCompleteMarked` block below stays exactly as it is.
- the `loadedRows` watcher (`:876`-`:888`): `grid?.updateRowCount(); grid?.render();` becomes
  `grid?.invalidate();`. The `scheduleAncestryRebuild()` call after it is unchanged.

Cost: `invalidateAllRows()` drops the **cached** rows — the viewport plus `minRowBuffer`, ~40 — not
the loaded history. For a chunk covering the viewport that is the same work `invalidateRows` already
did; for a chunk far below the viewport it is ~40 rows of DOM this used to skip. That is the price
of every rendered row's transform being right, and it is bounded by the viewport, not the repo.
State this in the comment at the call site so the next performance pass does not "optimise" it back.

Second edit, so a future overlap covers instead of doubling:

```css
.kv-commit-grid .slick-row.ui-widget-content {
  /* P91 item 4: opaque, not transparent — the canvas already paints this exact token underneath
     (`.grid-canvas`, above), so nothing changes visually, but a repainted row now erases the band
     it owns instead of compositing over whatever was there. */
  background-color: var(--kv-panel-bg);
  ...
}
```

`.kv-row-head`'s `color-mix(..., transparent)` tint, `:hover` and `.kv-row-selected` are all later
rules at equal specificity and still win — the ordering comment already above those rules stays true.

## 3.3 Scope

`packages/git-ui/src/components/CommitGrid.vue` only.

---

# Item 3 — a "New window" titlebar button

## 4.1 What exists

`shell.BuildMenu`'s `ItemNewWindow` (`internal/shell/menu.go:68`-`:73`) calls `MenuDeps.NewWindow`,
which `main.go:662` wires to `openNewWindow` (`main.go:612`-`:628`). Nothing reaches it from the
renderer: `grep` finds no `NewWindow` in `internal/bridge` and none in `frontend/src`.

## 4.2 Go

`internal/bridge/windows.go` — one field and one method on the existing service:

```go
// OpenNew is main.go's own openNewWindow closure (the ⇧⌘N menu command's action), assigned after
// the service is constructed because that closure needs the application this service is registered
// on. nil in a `-tags server` build, where there is no native shell to open a window at all.
OpenNew func()
```

```go
func (s *WindowsService) OpenNew() error {
	if s.OpenNew == nil {
		return ipcerr.BadRequest("windows: this build cannot open a window")
	}
	s.OpenNew()
	return nil
}
```

A field and a method cannot share a name — call the field `Open` and the method `OpenNew`, or the
field `OpenNewWindow` and the method `OpenNew`. Pick one and keep the doc comment honest.

`main.go`: hoist the service out of the `application.NewService(...)` list (`:395`) into a
`windowsSvc := &bridge.WindowsService{Deps: deps}` local above `application.New`, register
`application.NewService(windowsSvc)`, and assign `windowsSvc.OpenNewWindow = openNewWindow` right
after `openNewWindow` is defined (`:628`). A renderer cannot call it before then — the window's page
does not exist until `openWindow` runs.

Regenerate bindings: `wails3 task common:generate:bindings`, never a hand-typed flag list
(`docs/DEV_ENVIRONMENT.md`'s own section — `-names` is load-bearing). Commit `frontend/bindings/**`
with it; they are real Vite import targets.

## 4.3 Frontend

- `bridge/control.ts` (beside the other `Windows*` calls): `windowsOpenNew(): Promise<void>`,
  `unwrap(...)` like its neighbours.
- Test-harness registration, or every `tests/ui` spec that reaches it fails at the bound call:
  `tests/ui/support/ipcChannels.ts` (`kira:windows:openNew`) and `tests/ui/support/mockRuntime.ts`'s
  `CHANNEL_TO_FQN` (`WindowsService.OpenNew`).
- `workbench/TitleBar.vue` — a first child of `.title-bar-actions`, **before** the three icon
  buttons, with visible text per SPEC:

  ```html
  <button
    type="button"
    class="title-action title-action--labelled"
    data-testid="new-window"
    @click="onNewWindow"
  >
    <CodiconIcon name="empty-window" :size="15" />
    <span>New window</span>
  </button>
  ```

  `.title-action` is a fixed `--kira-h-sm` square (`:194`-`:209`); the labelled variant overrides
  `width: auto`, adds `padding: 0 var(--kira-s-2)`, `gap: var(--kira-s-2)` and
  `font-size: var(--kira-t-sm)`. It must keep `--wails-draggable: none` — `.title-action` already
  declares it, and the file's own CRITICAL comment (`:131`) says why.

  `onNewWindow` calls `control.windowsOpenNew()` and logs a rejection to the console; there is no
  toast channel in the titlebar.

## 4.4 Scope

`apps/kira-studio/main.go`, `internal/bridge/windows.go`, `frontend/bindings/**` (generated),
`frontend/src/bridge/control.ts`, `frontend/src/workbench/TitleBar.vue`,
`tests/ui/support/ipcChannels.ts`, `tests/ui/support/mockRuntime.ts`.

---

# Item 6 — Repos, Files, Review on one line

## 5.1 What exists

`repo/GitPanel.vue` has two segmented controls:

- the panel title's own (`:353`-`:359`): `tab`, a component-local `ref<'repos' | 'files'>` (`:67`),
  labelled "Repositories" / "Files";
- a strip inside the Files body (`:488`): `view`, a computed over
  `repoSearchView`/`setRepoSearchView` (`repo/state/search.ts:68`/`:72`), with
  `files | search | review`.

## 5.2 The change

- `tab` becomes `ref<'repos' | 'files' | 'review'>`, and the title control's options become
  `Repos` / `Files` / `Review` (the SPEC's own labels — "Repositories" shortens to "Repos" to make
  room for the third). Test ids `git-panel-tab-repos` / `-files` / `-review` — the third is new, the
  first two unchanged.
- `view` and `viewOptions` (`:284`-`:293`) lose `'review'`; the union in `repo/state/search.ts`
  (`:21`, `:68`, `:72`) narrows to `'files' | 'search'`. That state is in-memory per repo, never
  persisted, so a stale `'review'` cannot survive a reload — no coercion needed. Confirm that while
  editing `search.ts`; if any writer does persist it, coerce a read of `'review'` to `'files'`.
- `RepoReviewView` moves out of the Files branch (`:516`-`:522`) to a sibling of it, shown by
  `tab === 'review'` instead of `view === 'review'`. Its `reviewActivatedRepoIds` keep-alive
  (`:295`-`:315`) is unchanged in shape — the set entry is now added when `tab` becomes `'review'`.
- `ensureReviewPanelWidth(320)` (`:314`) moves onto the same trigger.
- The `repoId` watcher (`:68`-`:73`) keeps its rule: no repo, `tab = 'repos'`; first repo,
  `tab = 'files'`.
- `PanelShell`'s `search`/`@update:search` (`:344`-`:348`) read `tab === 'repos'`; a third value now
  falls to `fileSearch`, which is wrong for Review. Pass `:searchable="tab !== 'review'"` and leave
  the two-way binding as it is.
- The `.view-strip` (`:486`-`:490`) still renders, now with two segments. Keep it — Search is a real
  mode of the Files body and has nowhere else to go.

## 5.3 Scope

`apps/kira-studio/frontend/src/repo/GitPanel.vue`,
`apps/kira-studio/frontend/src/repo/state/search.ts`.

---

# Item 9 — a git-graph font size setting

## 6.1 Why one leaf is enough

`git-ui`'s whole type and control scale hangs off one token:
`vscode-tokens.css:144` — `--kv-font-size: var(--vscode-font-size, 13px)`, feeding `--kv-t-*`,
`--kv-h-*`, `--kv-bar-h` (`kira-structure.css:24`-`:51`) and, through `--kv-h-xs`,
`--kv-row-height`/`--kv-row-height-compact` (`density.css`).

`--vscode-font-size` has **exactly one consumer in the tree** (that line) and exactly one writer:
`apps/kira-studio/frontend/src/theme/vscode-bridge.css:94`, `var(--kira-t-md)`. So overriding it
reaches every embedded git-ui surface and nothing else in Kira Studio.

`TokenReader` (`packages/git-ui/src/theme/readTokens.ts`) measures the length tokens through probes
appended to `document.body`, resolving against `document.documentElement` — so the override must go
on `documentElement`, not on the mount container, or row heights would be computed from the app font
size while cells rendered at the graph one. Its `MutationObserver` already watches
`documentElement`'s `style` attribute (P72 §6.2(ii)), so a live change re-renders rows with no extra
wiring.

## 6.2 The leaf, end to end

Value semantics: **whole pixels, `0` = follow the app's own font size.** `0` writes no custom
property at all and the CSS fallback applies, so "follow the app" is not a second copy of the app's
number.

1. `packages/shared/domain/settings.ts` — in `gitSettingsSchema` (`:92`):
   ```ts
   // P91 item 9: 0 = follow appearance.fontSize. Reaches every embedded git-ui surface (graph,
   // diff, review) through --vscode-font-size, which nothing else in this app consumes.
   graphFontSize: z.number().int().min(0).max(FONT_SIZE_RANGE.max).default(0),
   ```
   `FONT_SIZE_RANGE` is already exported (`:9`, `{min: 9, max: 24}`); the floor here is `0`, not
   `min`, because `0` is the sentinel. Reject `1..8` in the Settings control's own `min`, not in the
   schema — a stored out-of-range value must hydrate, not drop the section.
2. `internal/storage/model/settings.go` — `GraphFontSize int` on `GitSettings`, the `*int` twin on
   `GitSettingsPatch`, the entry in `DefaultSettings()`, and a bound check in
   `SettingsPatch.Validate()` matching the schema.
3. `internal/storage/repos/settings.go` — one `leaf`/`leafValid` line in `GetAll` and one
   `upsertSettingsLeaf` branch in `Set`.
4. `frontend/src/state/settings.ts` — `applyAppearance()` gains:
   ```ts
   const graph = settingsState.git.graphFontSize;
   if (graph > 0) root.setProperty('--kira-graph-font-size', `${graph}px`);
   else root.removeProperty('--kira-graph-font-size');
   ```
   `applySettings` already `Object.assign`s `settings.git` before calling `applyAppearance()`
   (`:69`-`:75`) — check that ordering holds and leave it alone if it does.
5. `frontend/src/theme/vscode-bridge.css:94` —
   `--vscode-font-size: var(--kira-graph-font-size, var(--kira-t-md));`
6. `frontend/src/workbench/SettingsDialog.vue` — a `<label class="field">` in the
   `activeSection === 'Git'` block (`:1330`), under its own `<h3 class="section-subhead">Graph</h3>`,
   with the `IconButton icon="discard"` reset wired to `isAtDefault('git', 'graphFontSize')` /
   `resetLeaf('git', 'graphFontSize')` like every other leaf. `data-testid="settings-git-graphFontSize"`,
   `settings-reset-git-graphFontSize`. A `TextField type="number"` with `:min="FONT_SIZE_RANGE.min"`,
   `:max="FONT_SIZE_RANGE.max"` and a "0 = match the app font size" helper line; the control writes
   `0` for an emptied field.

   The Git section's existing "Server-owned" note (`:1332`-`:1335`) is about the remote-operations
   trio and must not be read as covering this one — put the new subhead and field **after** that
   block, not inside it.

## 6.3 Scope

`packages/shared/domain/settings.ts`, `internal/storage/model/settings.go`,
`internal/storage/repos/settings.go`, `frontend/src/state/settings.ts`,
`frontend/src/theme/vscode-bridge.css`, `frontend/src/workbench/SettingsDialog.vue`.

---

# Item 7 — a visible "go to file" on a diff

## 8.1 Root cause

P74 built the behaviour and gave it no affordance. `RepoDiffView.vue:203`-`:236` registers
`repo.goToFileFromDiff` as a command — its own comment says "this app has no toolbar there, so a
command instead" — reachable only from the palette (`shortcuts/state.ts:68`-`:71`). And it is
registered only when `gitRepoId !== undefined && right !== null` (`:208`), so C6's plain
worktree-vs-HEAD diff (`openRepoDiffTab`) has no entry point at all, by palette or otherwise.

## 8.2 Fix

`RepoDiffView.vue` gains a one-row header above the editor and keeps the command registration
exactly as it is (the palette entry stays valid):

```html
<div class="diff-actions">
  <AppButton icon="go-to-file" data-testid="repo-diff-go-to-file" @click="onGoToFile">
    Go to file
  </AppButton>
</div>
```

Layout: the root becomes a flex column, `.diff-actions` `flex: 0 0 auto`, `.monaco-host`
`flex: 1 1 auto; min-height: 0`. `min-height: 0` is load-bearing — without it the Monaco host
refuses to shrink below its content height and overflows the tab body (P89 §3's own note, same
mechanism).

`onGoToFile` is the existing command body, lifted out of the `registerCommand` callback into a named
function that the callback now also calls — one implementation, two entry points, no duplication.

Two behaviour corrections in that body:

- **The worktree case.** When `right === null` there is nothing to resolve through the transport: the
  modified pane *is* the file on disk. Call
  `openRepoFileTab(repoId, props.tab.path, { preview: false, reveal: { line } })` directly. That is
  the same landing behaviour, with no round trip.
- The button renders in both cases; only the branch behind it differs.

`registerCommand('repo.goToFileFromDiff', ...)` moves out from under the `right !== null` guard so
the palette entry works for a worktree diff too.

## 8.3 Scope

`apps/kira-studio/frontend/src/views/repo/RepoDiffView.vue`.

---

# Item 5 — one multi-file diff tab

Lands **after** item 7: this view renders item 7's per-file "Go to file" action, and lifting it out
of `RepoDiffView.vue` first is what makes it reusable.

## 7.1 What happens today

`repo/git/hostHandlers.ts`'s `editor.openAllChanges` (`:283`-`:319`) loops
`detail.files.forEach(... openRepoCommitDiffTab(...))` — one `repo-diff` tab per changed file, all
in one preview cohort. Its own comment cites "§6.1: 'N tabs instead' of a single multi-diff editor
(§13) — the native workspace has none". This item builds that one.

## 7.2 A new tab kind, not a widened `repo-diff`

`repo-diff` is one path end to end: `tabTitle` reads `record.path`, `repoDiffTitle`
(`state/tabKinds.ts:195`-`:199`) labels the revision pair against it, `editors.ts` registers the
tab's Monaco models under two URIs derived from it, and item 7's action resolves that one path.
Overloading it with an optional file list would put an `if (files)` in every one of those.

**`packages/shared/domain/tabs.ts`**:

```ts
// P91 item 5: one commit's whole changed-file set, in one tab (VS Code's multi-file diff). `files`
// is the commit's own file order, captured at open time — a re-resolve on restore would be a
// different commit's answer if the ref moved.
export const repoMultiDiffTabStateSchema = /*#__PURE__*/ z.object({
  left: z.string(),
  right: z.string(),
  leftLabel: z.string(),
  rightLabel: z.string(),
  files: z.array(z.string()).default([]),
  review: reviewRefSchema.nullable().default(null),
});
```

`reviewRefSchema` is whatever `repoDiffTabStateSchema`'s own `review` field already uses — reuse it,
do not restate the shape. Plus: `'repo-multi-diff'` in `RENDERABLE_TAB_KINDS` (`:36`), in
`TAB_KIND_MODE` (`:96`, `'repo'`), a `tabRecordSchema` member, a `RepoMultiDiffTabRecord` alias, an
`asRepoMultiDiffTab` guard, and `defaultRepoMultiDiffTabState`.

**`internal/storage/model/tabs.go`**: `"repo-multi-diff": true` in `RenderableTabKinds` **and** in
`repoTabKinds` (it is workspace-scoped). The file's own F8 warning applies — a missed line here is a
row silently dropped on restore, and `tests/unit/go-ts-vocabulary-parity.spec.ts` is what catches it.

**`state/tabKinds.ts`**: a `'repo-multi-diff'` entry — `title` reads the revision pair the same way
`repoDiffTitle` does plus the file count (`"a1b2c3d…e4f5 · 12 files"`), `icon: () => 'diff-multiple'`,
`defaultState`/`duplicateState`, `dropResources` disposing every model this tab registered,
`menuExtras: () => []`, `parseState: parseStateWith(repoMultiDiffTabStateSchema)`.

**`state/repoTabs.ts`**: `openRepoMultiDiffTab(repoId, files, left, right, labels, review?)`. Its
dedupe key is `(workspaceId, kind, path)` where `path` is the tab's identity — use `right` (the
commit sha) as the tab's `path`, so a second "See commit changes" on the same commit reuses the tab
and a different commit opens a second one. `openTab('repo-multi-diff', null, right, ...)` with
`reuse: true`, `preview: false`.

## 7.3 The view

`views/repo/RepoMultiDiffView.vue`, rendered by whatever maps kind to component today (the same
place `RepoDiffView` is registered).

Structure: a scrolling column of per-file sections, each a header row (the path, an expand/collapse
chevron, item 7's "Go to file" button, and the file's own +/- counts if `commit.detail` supplied
them) over a `.monaco-host` that is **only mounted while the section is expanded**. First section
expanded on mount, the rest collapsed — a 60-file commit must not construct 60 diff editors.

Each expanded section reuses `RepoDiffView.vue`'s own loading path verbatim rather than a second
copy: extract its content-resolution + editor-construction body (`file.read` per side, the
binary/tooLarge/bothMissing classification, `createDiffEditor`, `registerDiffEditor`) into a
composable, `views/repo/useDiffEditor.ts`, keyed by a `(tabId, path)` pair instead of `tabId` alone.
`RepoDiffView.vue` then calls it with its single path. Both views keep one implementation of the
five-state classification — duplicating it is exactly the drift this repo's "one term per concept"
rule exists against.

`editors.ts`'s per-tab registry is keyed by tab id; a multi-diff tab registers several model pairs
under the same id. Check `registerDiffEditor`'s signature (it already takes a URI array) and widen
the registry value to a list if it is not one already, so `dropResources` disposes all of them.

Collapsing a section disposes its editor widget and leaves its models in `editors.ts` — the same
split `RepoDiffView.vue`'s `onUnmounted` comment already documents ("the models survive in
editors.ts until an actual close calls dropResources").

## 7.4 The call site

`repo/git/hostHandlers.ts`'s `editor.openAllChanges` (`:283`) replaces the `forEach` with one
`openRepoMultiDiffTab(codeRepoId, detail.files.map((c) => c.path), leftRev, sha, {left: leftLabel,
right: rightLabel})` call and returns `{ opened: detail.files.length, failed: 0, mode: 'tabs' }`
unchanged — the result shape is `detailActions.ts`'s own contract and no caller cares how many tabs
actually opened.

`editor.openDiff` (single file, `:273`) is **untouched**: clicking one file in the detail pane still
opens one `repo-diff` tab.

The `previewCohort` machinery (`state/tabs.ts:82`, `openRepoCommitDiffTab`'s trailing parameter,
`evictPreviewCohort`) existed for this loop and now has one caller left — `openRepoCommitDiffTab`
itself, still reachable from `editor.openDiff`. Leave it; it is not dead.

## 7.5 Scope

`packages/shared/domain/tabs.ts`, `internal/storage/model/tabs.go`,
`frontend/src/state/tabKinds.ts`, `frontend/src/state/repoTabs.ts`,
`frontend/src/views/repo/RepoMultiDiffView.vue` (new),
`frontend/src/views/repo/useDiffEditor.ts` (new), `frontend/src/views/repo/RepoDiffView.vue`,
`frontend/src/views/repo/editors.ts`, `frontend/src/repo/git/hostHandlers.ts`, and wherever the
kind-to-component map lives.

---

# Item 8 — `path is required` on every tab save

## 9.1 Root cause

`state/tabs.ts:582`-`:600`, `createPinnedRepoGraphTab`:

```ts
  const record = {
    id,
    connectionId: null,
    path: '',
    ...
```

`model.TabRecord.Validate` (`internal/storage/model/tabs.go:88`-`:92`) rejects an empty `Path`, and
`TabsRepo.Save` validates **every** record before opening its transaction and returns on the first
failure (`repos/tabs.go:100`-`:105`, `"repos/tabs: record %d: %w"`). So the reported string is this
record, and the consequence is worse than a toast: **no tab in that window persists at all** for as
long as a repo workspace is open, because one bad record aborts the whole batch.

`createPinnedRepoGraphTab` is the only creator with an empty path — every other opener
(`openRepoFileTab`, `openRepoDiffTab`, `openRepoCommitDiffTab`, `openRepoReviewDiffTab`,
`openRepoTerminalTab`, and `openTab`'s own callers) passes a real one, confirmed by grep across
`frontend/src`.

It surfaces now, and repeatedly, because P82/P84 made a second repo workspace (a worktree) an
ordinary thing to open, so `ensureWorkspaceShell` runs more often and `saveNow()` fires from
`createPinnedRepoGraphTab` itself each time.

## 9.2 Fix, at the creation site

```ts
    // P91 item 8: a repo-graph tab has no file behind it, but `path` is a required column
    // (model.TabRecord.Validate) and an empty one aborts the whole window's tab save, not just this
    // row. The workspace key is this tab's real identity — stable, unique per workspace, and
    // already what `title` resolves the repo name from.
    path: workspaceId,
```

Do **not** relax `Validate`. `path` is the identity half of `openTab`'s own dedupe key
`(workspaceId, kind, connectionId, path)`; a kind allowed to have none would make that key
ambiguous for every future kind too.

Nothing reads a repo-graph tab's `path`: its `title` reads `workspaceId` (`tabKinds.ts:421`-`:422`),
its `menuExtras` is empty (`:431`), and it has no project-panel reveal. So the value is free and the
workspace key is the honest one.

**Consequence to verify, not just assume**: with the save fixed, a repo workspace's tabs actually
persist for the first time. `hydrateTabs` restores the `repo-graph` row, and
`ensureWorkspaceShell`'s `!tabs.some((t) => t.kind === 'repo-graph')` guard (`repoTabs.ts:258`) then
correctly skips creating a second one. Exercise a real restart in §13.

## 9.3 Scope

`apps/kira-studio/frontend/src/state/tabs.ts` — one line plus its comment.

---

# Item 10 — outlined ref/tag badges

## 11.1 What exists

Every badge kind fills its own background. `CommitGrid.vue`'s `<style>`:
`.kv-badge-local` (`:1416`), `-remote` (`:1421`), `-tag` (`:1426`), `-stash` (`:1431`),
`-overflow` (`:1436`), the four `.kv-badge-pr--*` (`:1453`-`:1471`), and the eight
`.kv-badge-local.kv-badge-lane-tinted.kv-lane-N` rules (`:1529`-`:1552`). The block's own comment
records P7 deliberately moving *to* fills so a fixed `--kv-badge-fg` label stayed legible.

The icon is lane-tinted, not white: `.kv-badge-lane-tinted.kv-lane-N .kv-badge-icon { color: … }`
(`:1502`-`:1516`, eight rules).

## 11.2 The change

Border and icon keep their colour; the fill goes; the label and icon go to `--kv-badge-fg`.

- Delete `background-color` from `.kv-badge-remote`, `-tag`, `-stash`, `-overflow` and the four
  `.kv-badge-pr--*`. Keep every `border-color`.
- Delete the eight `.kv-badge-local.kv-badge-lane-tinted.kv-lane-N` background rules outright, and
  `.kv-badge-local`'s own `background-color` — its `border-color: var(--kv-badge-local-bg)` stays,
  and the lane-tinted border rules above (`:1501`-`:1516`) already override it when a lane is known.
- Delete the eight `.kv-badge-lane-tinted.kv-lane-N .kv-badge-icon` colour rules — the icon is white
  now. `.kv-badge-icon` (`:1400`) keeps its `font-size` and inherits `--kv-badge-fg` from
  `.kv-badge`.
- `.kv-badge-overflow` keeps `border-color: var(--kv-panel-border)`; it has no kind colour.
- `.kv-badge-current`'s ring and `.kv-badge-current-glyph`'s `--kv-focus-border` are unchanged —
  "this is the current branch" stays its own signal.
- Rewrite the block's P7 comment. It currently argues *for* fills; it must now say the badge is an
  outline with a white label, and that the label's own legibility comes from the row background,
  which is why `--kv-badge-fg` has to stay theme-supplied rather than a literal `#fff`.

`refBadges.ts` is untouched — every class it emits already exists; only what those classes paint
changes. Its `refBadges.test.ts` asserts class names, not colours, and stays green.

`§7`'s "no colour-only meaning" rule still holds: each kind keeps its own shape/glyph
(`badgeSpecFor`), and the border keeps the kind colour.

## 11.3 Scope

`packages/git-ui/src/components/CommitGrid.vue`'s `<style>` block only.

---

## 12. Tests

### 12.1 No dedicated unit test

Per `CLAUDE.md`'s bar, item by item:

- **Item 8** — one literal at one creation site, guarded by one required-field check. No interacting
  rules, nothing to get subtly wrong; a test would restate the assignment. Called out explicitly
  because SPEC asked.
- **Items 1, 2, 4, 10** — CSS and DOM layout in a real engine. `bun test` cannot reach any of it.
- **Items 3, 6, 7, 9** — wiring and markup.
- **Item 5** — the only one with real logic, and it is Monaco lifecycle, not a decision structure.

One existing unit test changes rather than a new one: `graph/rowSvg.test.ts`'s `width`/`viewBox`
expectations, since `buildRowSvg` now takes the column width as a parameter (§1.3).

### 12.2 `apps/kira-studio-vscode/tests/interaction/graph-columns.spec.ts`

The DOM-level home for everything in the git-ui bundle — its own doc comment already states why
(the column model is pure data; how SlickGrid lays it out is a fact about the real bundle).
`fakeGraphHost.ts`'s fixture and `bootGraph` are already there.

- **Item 1** — a `.kv-resize-handle` exists for the graph column; dragging it narrows
  `.kv-cell-graph`'s computed width and widens the message cell by the same amount; the default
  width on a fresh mount is `<= 95`; every `.kv-graph-svg`'s `getBoundingClientRect().right` stays
  within its own cell's right edge after a narrowing drag (the clip assertion).
- **Item 2** — the one assertion that fails on the current tree:
  `viewport.scrollWidth <= viewport.clientWidth` for
  `[data-testid="commit-grid"] .slick-viewport`, at the default width and after closing the detail
  pane. Add a vertical-scrollbar case (enough fixture rows to overflow) — that is the shape that
  reproduces it.
- **Item 4** — after driving a scroll that lands a new chunk, read every rendered
  `.slick-row`'s `data-row` and its `getBoundingClientRect().top`, sort by `data-row`, and assert
  `top` is strictly increasing and no two rows overlap. Needs a fixture where a row's badge presence
  arrives after the first render — `fakeGraphHost.ts` already models decoration delivery; if it
  cannot, drive it through a PR resolution instead, which is the other height-flipping input.
- **Item 10** — a tag badge's computed `background-color` is fully transparent, its `border-color`
  is not, and its `.kv-badge-icon`'s computed `color` equals the badge's own `color`.

### 12.3 `apps/kira-studio/tests/ui/`

- `repo-workspace.spec.ts` — **item 8**: open a repo workspace, assert the mocked `tabsSave` call
  carries a non-empty `path` on the `repo-graph` record and that no binding error surfaces; then
  `relaunch` and assert the workspace's tabs come back. **Item 6**: three top-level segments labelled
  Repos/Files/Review, the Review segment shows `RepoReviewView`, and the inner strip has two
  segments. **Item 5**: "Open all changes" on a multi-file commit produces exactly one new tab, whose
  body lists every changed path.
- `workbench.spec.ts` (or `tabs.spec.ts`, wherever the titlebar is already driven) — **item 3**: the
  button renders with its text, sits before `toggle-project-panel` in DOM order, and one click
  issues exactly one `WindowsService.OpenNew` call.
- `settings-apply-on-save.spec.ts` — **item 9**: set the graph font size, Save, assert one
  `settingsSet` carrying `{ git: { graphFontSize: N } }` and nothing else, and that
  `documentElement`'s `--kira-graph-font-size` reads `Npx`; reset it and assert the property is gone.
- **Item 7**: assert `repo-diff-go-to-file` is visible on a commit diff and on a worktree diff, and
  that clicking it lands a `repo-file` tab for the same path.

### 12.4 Go

None. Item 3's method is a nil check and a call; item 5's vocabulary addition is covered by
`tests/unit/go-ts-vocabulary-parity.spec.ts`, which already exists for exactly this; item 9's leaf is
a CRUD round-trip through an already-tested repo shape.

---

## 13. Order of work

Ten commits. Three real dependencies, nothing else ordered:

- **8 first** — until tab saves succeed, nothing else in this batch can be verified across a restart.
- **2 before 1** — item 1's column arithmetic is written against item 2's `availableWidth()`.
- **7 before 5** — item 5's view renders item 7's action, and §8.2 is what makes it reusable.

1. `fix(tabs): give the pinned repo-graph tab a real path` — §9.
2. `fix(git-ui): stop the commit grid overlapping rows after a height change` — §3.
3. `fix(git-ui): size the commit grid's columns to its own viewport, not its host` — §2.
4. `feat(git-ui): make the graph column resizable, with a capped default width` — §1.
5. `fix(git-ui): render ref badges as outlines, not filled chips` — §11.
6. `feat(settings): add a git graph font size` — §6.
7. `feat(workbench): add a New window button to the title bar` — §4.
8. `refactor(git): put Repos, Files and Review on one tab row` — §5.
9. `feat(repo): add a visible go-to-file action to the diff view` — §8.
10. `feat(repo): open a commit's changes as one multi-file diff tab` — §7.

Conventional Commits; each message ends with the two attribution lines this session uses.
Regenerate bindings (§4.2) in commit 7 and commit the generated `frontend/bindings/**` with it.

## 14. Verification

Per commit (fast, cheap):

- `bun run typecheck`, `bun run lint`, `bun run build`
- `go build ./... && go vet ./...` on commits 1 (no Go change — skip), 6, 7, 10
- `wails3 task common:generate:bindings` before commit 7's build; a missing binding fails the Vite
  build with an unresolvable import

Once, near the end of the phase (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `go test ./apps/kira-studio/internal/storage/...`
- `bun test packages/git-ui` — `rowSvg.test.ts`/`refBadges.test.ts` are the two this batch can break
- `bun run build:test`, then the two interaction/UI suites: the extension's
  `graph-columns.spec.ts` and `apps/kira-studio`'s `repo-workspace.spec.ts` plus the settings and
  workbench specs. The `ui` project runs **webkit** (`playwright.config.ts:49`), which this container
  does not preinstall — `docs/DEV_ENVIRONMENT.md` has `bunx playwright install webkit` and the system
  libraries it needs. Run the full `bun run test:ui` if time allows.
- Manual, in `bun run dev`, for what Playwright cannot assert:
  1. Open a repository with a wide history. Drag the graph column narrower and wider; lanes clip at
     its right edge with no bleed into the message column, and the width survives a tab switch and a
     restart.
  2. Scroll that history fast, top to bottom and back, on a repository large enough to stream several
     chunks. No doubled or unreadable text at any point. Check at font size 9 and 24 — the row-height
     delta between a badged and an unbadged row scales with the font, so a fix that only holds at 13
     is not a fix.
  3. No horizontal scrollbar under the graph at any panel width above the column minimums, with and
     without the detail pane open.
  4. Ref/tag/PR badges: outline only, white icon and label, in **both** the dark and the light theme.
     This is the one item whose correctness is a judgement about contrast, not an assertion.
  5. Set the graph font size to 9, then 20: rows, badges and the toolbar all rescale, live, with no
     reload; set it to 0 and it follows the app font size again.
  6. "See commit changes" on a 20-file commit: one tab, every file listed, the first expanded and the
     rest collapsed, expanding a file shows its diff, "Go to file" on a row opens that file at the
     cursor's line.
  7. Open two repo workspaces and several tabs, quit, reopen: every tab comes back and no binding
     error appears.

Do not commit a screenshot or a findings document; the commit log is the record.

## 15. Out of scope

- P87. Deferred by SPEC; the status bar is untouched.
- `GEOMETRY`'s lane geometry, `layoutStore`/`layout.worker` and the graph's own drawing. Item 1
  changes the box around the drawing, not the drawing.
- SlickGrid's own `updateRowPositions` (`protected` in its `.d.ts`). §3.2 reaches the same outcome
  through `invalidate()`/`invalidateRowHeights()`, both public — no cast.
- `openRepoCommitDiffTab`, `openRepoReviewDiffTab` and the preview-cohort mechanism. Item 5 adds a
  kind beside them and leaves the single-file path exactly as it is.
- Persisting a multi-diff tab's expanded-file set, and any review layer on it — a review diff is
  still opened per file by `editor.openRangeDiff`.
- The app-wide `appearance.fontSize` leaf. Item 9 adds a second, git-scoped one; it does not change
  how the first behaves.
