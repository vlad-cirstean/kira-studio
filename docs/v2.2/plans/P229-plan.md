# P229 plan: Git module looks like the rest of the app

Source: `SPEC.md` row P229. User request (verbatim): "the git graph section overall still looks very
different than the rest of the app, try to make it look more in line with the rest of the app."
Scope: the whole `packages/git-ui` UI (App.vue, AppToolbar, CommitGrid rows/cells/badges/resize
handles, UncommittedChangesStrip, detail panes, file lists, stash, pickers, review panes, dialogs)
as hosted in Kira Space (`RepoGraphView.vue`, Git panel Review tab, ADE review window). The VS Code
webview (`apps/kira-space-vscode`) also mounts `packages/git-ui`; it must keep working and keep its
VS Code look.

Base: `v22-fix-H` at `f63b45c0f` (v2.0 + P228). Worktree `/home/user/kira-v22-B`.

## 0. Rules for the implementer

- `CLAUDE.md` in full: terse, Conventional Commits, `<script setup lang="ts">`, shadcn-vue/Tailwind/
  VueUse first, no `--no-verify`, fix any red hook on the spot.
- One sequential implementer. No stream split: commit 1 changes the tokens every later commit is
  judged against, and `rowVariants`/`badgeClass.ts` feed files in commits 2-4.
- Stage only P229 files by path. Never `git add -A`, never `git stash`.
- P230 runs concurrently in another worktree. Never touch `apps/kira-space/internal/ade/**`,
  `apps/kira-space/frontend/src/ade/**`, `apps/kira-space/main.go`, `docs/v2.2/SPEC.md`,
  `docs/ARCHITECTURE.md`. Results, deviations and proposed `ARCHITECTURE.md` text go to
  `docs/v2.2/plans/P229-notes.md`, committed with each group (resumable from disk).
- P229 owns: `packages/git-ui/src/**`, `packages/theme/src/vscode-bridge.css`,
  `apps/kira-space-vscode/src/webview/kira-bridge.css`, `apps/kira-space/tests/visual/git-module.spec.ts`
  and its snapshots, `docs/v2.2/plans/P229-*.md`. Anything else needs a note in `P229-notes.md` first.
- Do not regress P226 (`colorMarkClass` rails in `GitPanel.vue`, `ReposDialog.vue`; P229 edits
  neither) or P228 (`columnFit.ts` rules, graph lane floor, handle `:min`/`:max`, forced
  `overflow-x: hidden`). `columnFit.ts` is not edited.
- Markup a commit rewrites moves to unprefixed app utilities (`bg-hover`, `h-row`, `text-kira-md`,
  `border-border`, …). Both hosts compile them: Kira Space's root `@source`s `packages/git-ui/src`,
  the webview's own root does too and bridges `--kira-*` onto `--kv-*`. One exception: font size on
  data surfaces (grid cells, detail meta, `FileTree` rows, review lists) stays `kv:text-*`, so
  Settings > Git > graph font size (`--kira-graph-font-size` -> `--vscode-font-size` ->
  `--kv-font-size`) keeps reaching them. Untouched `kv:` markup stays; no mass prefix migration
  (see DD5).
- Class strings merge through `@theme/lib/utils` `cn` once unprefixed (the `badgeClass.ts`
  precedent); `packages/git-ui/src/lib/cn.ts` stays for remaining `kv:` merges.
- Icons stay codicons (the app's icon set too). Size them like the app: `CodiconIcon :size="13"` in
  buttons and menus, `16` for tree-row file/folder icons, `24` for empty states. Raw
  `<span class="codicon …">` in Vue templates becomes `CodiconIcon`; DOM-built cells (`columns.ts`,
  `refBadges.ts`) keep class strings.

## 1. Method and evidence

Discovery: `codegraph_explore` x4 on the main checkout index (git-ui shell/toolbar/grid/strip;
`--kv-*` token layer and `TokenReader`; `TooltipIconButton`/`buttonVariants`/`KuiColumnResizeHandle`;
host mounting in the VS Code webview). The worktree has no index and the index lacks post-P212
files, so `apps/kira-space/**`, the theme bridges, `vscode-tokens.css`, `density.css`,
`kira-structure.css`, `tailwind.css`, Studio's `slickTheme.css`, `ViewToolbar.vue`, `ContextMenu.vue`
and the shadcn sets were read directly.

Screenshots: a throwaway Playwright spec (not committed) against `bun run build:test:space`,
WebKit, 1400x820: Git module with a 10-commit fixture (merge, `main` + `origin/main`, branch and tag
badges, dirty status), the same with the detail pane, branch picker, row menu, Stash dialog, Git
panel repo menu; reference areas ADE plan, Repositories dialog, Settings > Git, Terminal module.
Computed styles probed on the same pages. Values below are measured, Space dark theme, 12px app
font, comfortable density.

## 2. Deviations (ordered by visual impact)

1. **Surface colour.** Graph region, detail pane, toolbar, search row, uncommitted strip: `#181818`
   (`--kv-panel-bg` -> `--vscode-panel-background` -> `--kira-bg-chrome`; toolbar via
   `--vscode-editorGroupHeader-tabsBackground` -> `--kira-bg-chrome`). Every other module's content
   (Terminal, ADE, Git panel left side) is `#1f1f1f` (`--kira-bg`). The graph reads as a dark
   inset panel.
2. **Row height and density.** Commit rows 19px (`--kv-row-height-compact` = `--kv-h-xs` + 2 =
   17 + 2), badge rows 36px; they ignore Appearance > row density. App rows: `h-row` = 28px
   comfortable / 22px compact (Git panel repo rows, `RepoTreeRow`, Studio grid).
3. **Ref badges.** 2px lane-coloured outline, 12px mono, inherits row weight (600 on HEAD row),
   loud blue boxes. App `Badge`: 11px `font-data`, `h-control-sm`, tinted fill, no heavy border.
4. **Icon size.** 140 codicon uses in 23 files; raw `codicon` spans and size-less `CodiconIcon`
   render 16px (codicon.css default). App controls and menus: 13px (`TooltipIconButton` default,
   `ContextMenu.vue`), muted in menus.
5. **Lists and pickers.** `rowVariants`: `kv:min-h-control` (21px), `kv:rounded-sm`, `kv:px-1.5`,
   selected text white. App tree rows: `h-row`, flush (no radius), `gap-1`, selected `bg-select`
   with `text-fg`. App menu items (`DropdownMenuItem`): `gap-1.5 rounded-kira-sm px-1.5 py-1
   text-kira-md`. `FileTree` rows 22px rounded; app tree: `h-row`, 13px chevron twisty, 16px muted
   icons, indent `8 + depth * 14`.
6. **Selection foreground.** Selected commit row text `#ffffff`
   (`--vscode-list-activeSelectionForeground` -> `--kira-accent-fg`); app selected rows keep
   `#cccccc` (`text-fg` on `bg-select`).
7. **Context and dropdown menus.** `MenuSections.vue`: raw 16px icons in fg colour, labels in a
   `flex-col min-w-0` span so they wrap ("Checkout this commit (detached HEAD)" on two lines). App
   `ContextMenu.vue`: `CodiconIcon` 13 `text-muted-foreground`, `flex-1 overflow-hidden
   text-ellipsis`, no wrap.
8. **Dialogs (14 files in `dialogs/` + `WorktreeList.vue`'s).** `DialogContent class="flex flex-col gap-0 p-3 …"`,
   no close button, body `min-h-0 overflow-y-auto` with no padding, so focus rings overflow and the
   Stash dialog body shows a scrollbar; footer `justify-end gap-1`; primary before Cancel (Stash).
   App recipe (`GitCredentialDialog.vue`, `AdeClaudeDialog.vue`): `p-0 gap-0 w-N max-h-4/5`,
   `DialogHeader` (title + ghost `icon-sm` close `ml-auto`), body `flex flex-col gap-2 px-3 py-2
   overflow-auto`, `DialogFooter` with `Cancel` (`dialog`, `kira-lg`) then primary
   (`dialog-primary`/`dialog-danger`, `kira-lg`), right-aligned.
9. **Toolbar.** `kv:h-bar` 33px (`--kv-font-size` + 21), `kv:bg-toolbar` chrome fill,
   `kv:bg-border-strong` separators. App `ViewToolbar`: `h-bar` 34px, `flex items-center gap-1.5
   px-2 border-b border-border`, no fill. Buttons already use `Button variant="toolbar"` and
   `TooltipIconButton` (no change beyond icon size). Same for the search row and the review toolbar.
10. **Detail pane.** Meta block `kv:p-2`; "Show more" `text-kira-lg text-focus` (13px blue link);
    "Select a commit to see its details." plain `p`. App panes: `px-3 py-2`; app's own "Show N
    more" (`ShowMoreButton.vue`) is `variant="link"` `text-muted-foreground`; empty text uses `Empty`.
11. **Empty and blocked panels.** `NoRepositoryPanel`, `EmptyRepositoryPanel`, `GitBlockedPanel`:
    32px/24px icon, `h2` `kv:text-lg font-semibold`. App: `Empty`/`EmptyMedia`/`EmptyTitle`/
    `EmptyDescription` (the documented one empty-state component).
12. **Banners.** `ConnectionBanner`, `ConflictBanner`: hand-rolled `kv:` bars. `FailureBanner` and
    the app use shadcn `Alert` (`rounded-none border-x-0 border-t-0`).
13. **Cell padding.** Grid cells `kv:px-1` (4px). Studio grid cells 8px (`--kira-s-4`).
14. **Section headers.** `RefSectionHeader` `kv:h-control-sm px-2 text-sm font-semibold uppercase
    tracking-wider` vs `PanelHeader` same type recipe at `h-bar`. Close already; only prefix and
    `px-1.5` differ.
15. **Token heights.** `--kv-h-*` derive from `--kv-font-size` (12px in Space): `h-xs` 17, `h-sm`
    21, `bar` 33 vs app 18/22/34. Visible only through `kv:` markup; rewritten markup takes app
    heights.

No deviation: font family (both `--kira-font-ui`, 12px), scrollbars (Space's global
`::-webkit-scrollbar` rules in `base.css` reach git-ui), tooltips (shared `TooltipProvider` + theme
`TooltipContent`), popover/dropdown surfaces (`bg-elevated`, shadcn), resize handles (`hover:bg-focus`,
same as `DockResizeHandle`), hover colour (`--kira-hover` both).

`kv:` prefix and `--kv-*` tokens: 1781 `kv:` tokens in 44 `.vue` files. In Space every `--kv-*`
colour resolves to a `--kira-*` value through `vscode-bridge.css`, so the prefix itself is not
visible; the visible gaps are the bridge mappings in items 1 and 6 and the font-derived heights in
item 15.

Stays git-specific: graph lanes, lane palette (`--kv-graph-lane-*`), node shapes, two-line badge
rows, HEAD row tint plus inset accent bar, merge/collapsed-row cues, no column header row (DD2).

## 3. Commits (6)

Run after each: `bun run typecheck`, `bun run lint`, `bun run lint:dead` (pre-commit hook covers
most). Expensive suites once, at the end (§4).

### Commit 1 `feat(git-ui): graph surfaces and rows follow app tokens and row density`

Files: `packages/theme/src/vscode-bridge.css`, `packages/git-ui/src/theme/density.css`,
`apps/kira-space-vscode/src/webview/kira-bridge.css`, `packages/git-ui/src/components/columns.ts`,
`CommitGrid.vue`, `UncommittedChangesStrip.vue`.

- `vscode-bridge.css`: `--vscode-panel-background: var(--kira-bg)`,
  `--vscode-editorGroupHeader-tabsBackground: var(--kira-bg)`,
  `--vscode-list-activeSelectionForeground: var(--kira-fg)`. Add
  `--vscode-kiraSpace-rowHeight: var(--kira-row-height)` (host hook in the `kiraSpace` id
  namespace, like `graphLane*`). Update the header comment.
- `density.css`: `--kv-row-height-compact: max(var(--vscode-kiraSpace-rowHeight, 0px),
  calc(var(--kv-h-xs) + 2px))`; `--kv-row-height: calc(var(--kv-row-height-compact) +
  var(--kv-h-xs))`. VS Code: unset hook gives today's 20/36px at 13px, byte-identical. Space: 28/45
  comfortable, 22/39 compact; never below font + 7 when graph font size is large. `TokenReader`
  already probes both through a real `height`, so `max()`/`calc()` resolve; its `MutationObserver`
  on `documentElement` `style` already sees the density write (`applyAppearance`). Verify the grid
  re-lays out on a live density change (Settings > Appearance); if not, note it and fix in this commit.
- `kira-bridge.css` (webview): `--kira-row-height: var(--kv-h-sm)` (22px at 13px, VS Code's list
  row), not `--kv-row-height` (two-line badge row, 36px). Needed once rewritten git-ui markup uses
  `h-row`/`min-h-row`.
- `columns.ts`: message grid tracks `[0_var(--kv-h-xs)]` -> `[0_1fr]` and
  `[var(--kv-h-xs)_var(--kv-h-xs)]` -> `[var(--kv-h-xs)_1fr]`, so the subject centres in the
  compact band. `rowSvg.ts`'s `nodeCenterY = rowHeight - compactRowHeight / 2` then still lands on
  the subject. Do not touch `rowSvg.ts` geometry.
- `CommitGrid.vue` style block: `.slick-cell` `kv:px-1` -> `kv:px-2`; `CELL_PADDING_PX` 4 -> 8
  (date-width probe). `.kv-row-selected` keeps `kv:bg-selected kv:text-selected-fg` (now `--kira-fg`
  through the bridge).
- `UncommittedChangesStrip.vue`: height `kv:h-5.5` -> `kv:h-row-compact`; SVG `height`/`cy` from the
  same compact height (`compactRowHeightPx(tokenReader)` or the strip's own measured height) instead
  of literal 18/9, so its node keeps lining up with row 0's lane (P228 C).
- Run `repo-graph-*` and `git-panel-tab` specs plus `packages/git-ui` unit tests now (cheap, catch a
  geometry break before later commits stack on it).

### Commit 2 `feat(git-ui): ref badges use the app badge look`

Files: `badgeClass.ts`, `refBadges.ts`, `CommitGrid.vue` (badge font rules), `CommitMeta.vue`,
`BranchPicker.vue` (PR badge call sites only if their markup needs it).

- `REF_BADGE_CLASS`: `border-2` -> `border`; drop `font-[inherit]`; add `font-normal`; text
  `text-kira-sm` via the `.kv-badge` rule (`font-size: var(--kv-t-sm)`, keeps
  `check_font_scale` happy and graph font size reaching it). Height stays `h-(--kv-h-xs)`.
- Fill: one literal tint per lane and per kind, next to the existing border maps (full literals,
  P213 rule), e.g. `bg-(--kv-graph-lane-0)/15`, `bg-(--kv-badge-remote-fg)/15`. Text stays
  `--kv-badge-fg`. Check contrast of `--kira-fg` on each tinted lane fill over `--kira-bg` and on
  `bg-select` (selected row); WCAG 4.5:1 for 11px text. If a lane fails, lower that tint; record
  ratios in `P229-notes.md`.
- `.kv-badge-icon` and `.kv-badge-current-glyph` keep their steps relative to the new label size.
- `graph-columns.spec.ts` (webview) reads `kv-badge-tag`; markers stay.

### Commit 3 `feat(git-ui): toolbars, banners and icons follow the app chrome`

Files: `AppToolbar.vue`, `App.vue` (search rows, graph/detail region classes), `RefreshButton.vue`,
`PullStrategyPicker.vue`, `UndoButton.vue`, `BranchPicker.vue` (trigger only), `SearchBox.vue`,
`ConnectionBanner.vue`, `ConflictBanner.vue`, `review/ReviewView.vue` (toolbar row only),
`LoadMoreButton.vue`.

- Toolbar root: ViewToolbar recipe, unprefixed: `h-bar shrink-0 flex items-center gap-1.5 px-2
  border-b border-border`, no fill. `ViewToolbar.vue` itself lives in `@workbench`, which the VS
  Code build does not alias (git-ui imports only `@theme`); moving it to `@theme` touches 17
  importers outside scope. So the recipe is restated, with a one-line comment naming
  `ViewToolbar.vue` as the source.
- Separators: `w-px h-control-inline self-center mx-0.5 bg-border shrink-0`.
- Search rows (`App.vue` x2) and `kv-review-toolbar`: same recipe, `h-bar` for the review toolbar,
  `py-1` rows keep their own height.
- Every `CodiconIcon` without `:size` in toolbar buttons -> `:size="13"`; raw codicon spans in
  `Button`s (BranchPicker trigger, spinners in progress chips) -> `CodiconIcon :size="13"` with
  `animate-spin` where spinning.
- `ConnectionBanner`, `ConflictBanner` -> shadcn `Alert` with `FailureBanner`'s classes
  (`shrink-0 rounded-none border-x-0 border-t-0`), `AlertTitle`/`AlertDescription`/`AlertAction`;
  conflict tone `variant="default"` with a warn icon, disconnect `variant="destructive"`. Keep every
  `data-testid`.
- `LoadMoreButton`: unchanged shape; prefix only if the line is rewritten anyway.

### Commit 4 `feat(git-ui): lists and menus use the app row and menu recipes`

Files: `lib/rowVariants.ts`, `MenuSections.vue`, `RowContextMenu.vue`, `RefSectionHeader.vue`,
`FileTree.vue`, `fileTreeModel.ts` (indent only), `BranchPicker.vue`, `TagList.vue`, `StashRows.vue`,
`StashList.vue`, `GlobalStashList.vue`, `StackList.vue`, `WorktreeList.vue` (rows only),
`SearchResults.vue`, `review/BaseSelector.vue`, `review/ReviewView.vue` (branch lists),
`review/ReviewCommitRow.vue`, `review/ReviewFilesPane.vue`.

- `rowVariants`: unprefixed, theme `cn`, new `layout` variant:
  - `menu` (pickers in popovers: BranchPicker, TagList, StashRows, StackList, BaseSelector):
    `DropdownMenuItem`'s recipe `flex items-center gap-1.5 rounded-kira-sm px-1.5 py-1 text-kira-md
    text-fg cursor-pointer whitespace-nowrap hover:bg-hover focus-visible:bg-hover
    focus-visible:outline-none`; selected `bg-hover`.
  - `tree` (panes: FileTree, SearchResults, review branch/commit/file lists):
    `RepoTreeRow`'s recipe `relative flex items-center gap-1 pr-2 min-h-row whitespace-nowrap
    select-none cursor-default`, no radius; selected `bg-select` (text stays `text-fg`), else
    `hover:bg-hover`. Font size `kv:text-base` (data surface, §0).
  - `disabled`/`danger` keep their meaning: `text-muted-foreground cursor-default
    hover:bg-transparent`, `text-error`.
  - `min-h-row` not `h-row`: a large graph font size must not clip.
- `FileTree.vue`: rows `layout: 'tree'`; indent `8 + depth * 14` px (app tree); chevron
  `CodiconIcon` 13 muted in a `size-3.5` box (TreeTwisty's shape; TreeTwisty itself is `@workbench`,
  not importable); file icons 16px muted (seti mask stays); folder icon 16 muted; status letter and
  `+N -N` counts unchanged.
- `MenuSections.vue`: icon `CodiconIcon :size="13" class="text-muted-foreground"` in the `size-4`
  box (keep the box when no icon); label `flex-1 overflow-hidden text-ellipsis whitespace-nowrap`;
  `item.detail` as `DropdownMenuShortcut`-style trailing muted text, not a second line (if a detail
  is long, ellipsis). `RowContextMenu` keeps `min-w-45 max-w-80`.
- `RefSectionHeader`: `PanelHeader` type recipe unprefixed: `flex items-center justify-between
  h-control-sm px-1.5 text-kira-sm font-semibold text-muted-foreground uppercase tracking-wider`.
- Review rows (`ReviewCommitRow`, `ReviewFilesPane`): `tree` layout; keep sha `font-data`.
- Run `bun run test:unit` (fileTreeModel, rowMenuModel, pickerModel tests).

### Commit 5 `feat(git-ui): detail panes, empty states and dialogs use the app layout`

Files: `CommitMeta.vue`, `DetailPane.vue`, `WorkingDetailPane.vue`, `StashDetailPane.vue`, `App.vue`
(detail placeholder), `NoRepositoryPanel.vue`, `EmptyRepositoryPanel.vue`, `GitBlockedPanel.vue`,
`review/ReviewView.vue` (status/empty paragraphs), `review/ReviewCommentsPane.vue`, all 14 dialog
files in `components/dialogs/` plus `WorktreeList.vue`'s dialog, `dialogs/PreflightPrediction.vue`.

- Detail meta: `px-3 py-2 gap-1`; subject `text-kira-lg font-semibold` stays `kv:text-lg` (data
  surface); "Show more/less": `ShowMoreButton`'s look (`variant="link" size="kira"`
  `h-auto p-0 justify-start text-muted-foreground hover:text-fg`), not focus blue, not `text-lg`.
- "Select a commit to see its details." and "Loading…": `Empty` + `EmptyDescription` (`p-6`), as
  `MemoryPanel.vue`.
- Empty/blocked panels: `Empty`, `EmptyMedia variant="icon"` with `CodiconIcon :size="24"`,
  `EmptyTitle`, `EmptyDescription`, actions in `EmptyContent`. Keep testids and copy.
- Dialogs, one recipe for all:
  - `DialogContent :show-close-button="false" class="flex flex-col p-0 gap-0 w-120 max-w-[90vw]
    max-h-4/5"`.
  - `DialogHeader`: `DialogTitle` + `DialogClose as-child` ghost `icon-sm` close button `ml-auto`
    with `CodiconIcon name="close" :size="13"`, `aria-label="Close"` (`GitCredentialDialog.vue`).
    Close runs the dialog's existing cancel path (`@update:open` already does; verify per dialog).
  - Body: `flex min-h-0 flex-col gap-2 overflow-auto px-3 py-2`; drop per-field `my-1`; labels via
    `Label` + `Field` where the dialog already pairs them.
  - `DialogFooter`: one right-aligned group, `Cancel` (`dialog`, `kira-lg`) first, then the primary
    (`dialog-primary`) or destructive (`dialog-danger`) action. Footer-left content (Force push
    details, Reset mode hints) stays left of the group.
  - Rewritten `kv:` classes in dialogs -> unprefixed (`text-diff-deleted` warnings -> `text-error`;
    `text-muted-foreground` stays).
  - Every dialog's tests key on testids/roles; keep them. `floating-geometry.spec.ts` and
    `graph-dialog-reconnect.spec.ts` (webview) cover the VS Code host.

### Commit 6 `test(space): git module visual baseline`

Files: `apps/kira-space/tests/visual/git-module.spec.ts`, its `-snapshots/*.png`,
`docs/v2.2/plans/P229-notes.md` (final result).

- Fixture in the spec file (single consumer): 10 commits with a merge, `main` (HEAD) +
  `origin/main` on row 0, a branch badge mid-graph, a tag lower, dirty `status.get` (uncommitted
  strip), `commit.detail` with 4 files and a trailer, `working.detail`, `stash.list` empty. Restored
  `repo-graph` tab (`IPC.tabsList` + `gitStream` option, as `repo-graph-lines.spec.ts`'s second
  case), `clockTime` fixed so relative dates are stable, viewport 1400x820.
- Snapshots: `git-graph.png` (detail closed, author/date columns), `git-graph-detail.png` (row
  clicked, detail pane with file tree), `git-stash-dialog.png` (toolbar Stash). Snapshot the
  `[data-testid="repo-graph-host"]` element, or the dialog element for the dialog, not the whole
  window, so title bar and Git panel changes elsewhere do not churn it.
- `P229-notes.md`: result in the `SPEC.md` result style (done, deviations from this plan, checks
  run, contrast ratios, unverified), plus proposed `ARCHITECTURE.md` edits: Theme section (git-ui
  surfaces and row density follow Space through `vscode-bridge.css`; `--vscode-kiraSpace-rowHeight`
  hook; webview `--kira-row-height`), Styling row (git-ui rewritten markup uses unprefixed app
  utilities, data-surface font size stays `kv:`).

## 4. Verification (once, near the end)

- `bun run test:unit` (incl. `columnFit.test.ts`, `lanes.test.ts`, file tree and menu models).
- Space UI: `repo-graph-*` (lines, paging R1/R2, lifecycle, failures, PR badge, rewalk),
  `git-panel-tab`, `repo-workspace`, `color-rails`, `repos-dialog`, `operations`; then the full
  `bun run test:ui:space` once.
- `bun run test:webview` (VS Code host: graph columns, context menu, dialogs, layout).
- `bun run test:visual:space`: existing 5 Settings baselines must not change (no git-ui inside
  them); record the 3 new ones (`--update-snapshots` on `git-module.spec.ts` only).
  `bun run test:visual:studio`: no change expected (Studio mounts no git-ui; `vscode-bridge.css`
  names are read only by git-ui; Monaco scopes its own `--vscode-*`). Any other diff is a bug, not
  a re-record.
- Re-run the throwaway screenshot pass (or the new visual spec) and compare against §2: content
  `#1f1f1f`, commit rows 28px comfortable / 22px compact, 13px toolbar/menu icons, menu labels on
  one line, dialogs with header close and padded body.
- Live density switch: Settings > Appearance > compact, graph rows go 22px without remount.
- Graph font size setting (Settings > Git) still scales grid text, detail meta and file tree.
- VS Code webview look unchanged except the shared recipe changes (badges, menus, dialogs, lists,
  empty states, banners); row heights there unchanged (hook unset).

Regression guards: no new lint rule. The two cheap candidates (forbid `kv:bg-panel`; forbid mixed
`kv:`/unprefixed tokens on one element) are either wrong (the bridge already fixes `bg-panel`) or
imprecise (marker classes like `kv-badge` are plain tokens). The new visual baseline is the guard.

## 5. Deferred decisions (default taken; user may veto)

- **DD1 Commit row height follows Appearance row density** (28px comfortable, 22px compact, floor
  font + 7). Default: yes. Cost: about 30% fewer commits visible at comfortable density than today's
  19px rows. Alternative: fixed 22px (app compact step) regardless of density.
- **DD2 No column header row on the commit grid.** Default: keep none (the graph mirrors a list;
  adding one changes P228's viewport and handle geometry). Alternative: a Studio-style header
  (`bg-elevated`, `text-kira-sm` muted, Graph/Message/Author/Date) carrying the resize handles.
- **DD3 Ref badge look.** Default: 1px lane-coloured border plus 15% lane tint, 11px mono, normal
  weight. Alternative: tint only, no border (closest to app `Badge`), or keep today's outline-only
  at 1px.
- **DD4 Graph surface colour.** Default: `--kira-bg` (`#1f1f1f`) like every module's content.
  Alternative: keep the darker `--kira-bg-chrome` for the graph only.
- **DD5 `kv:` prefix.** Default: no mass migration in P229 (1781 tokens, not visible; rewritten
  markup goes unprefixed). Alternative: a follow-up phase retiring the `kv:` root and `--kv-*`
  structural tokens in favour of the app's root in both hosts.
- **DD6 HEAD row emphasis.** Default: keep the 9% accent tint, 2px inset bar and semibold text
  (git-specific cue). Alternative: drop the bold, keep tint and bar.
- **DD7 Graph font size scope.** Default: keeps reaching grid, detail meta, file tree and review
  lists; toolbar, menus and dialogs follow the app font size (already true for shadcn controls).
