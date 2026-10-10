# P258 plan: git module in Kira Studio's design language

Ask (user, after P245 and P256): git module still looks very different from the app. Use the SAME
elements, spacing and design language as Kira Studio (`apps/kira-studio/frontend`,
`packages/theme`, shared `packages/workbench` parts). Take nothing from the Agents/ADE module or
Space's own explorer. Re-ground what earlier passes copied from there.

Base: `v2.0` at `50e97c1b4`. One sequential Sonnet implementer.

**Start only after P257 lands** (P257, `/home/user/kira-sG`, edits `packages/git-ui` FileTree,
`fileTreeModel.ts`, deletes `countFormat.*`, edits `tests/visual/git-module.spec.ts` `FILES`,
`tests/ui/support/gitUiPortFixtures.ts`, `repo-workspace.spec.ts`, and re-records
`git-graph-detail`). This plan targets the tree P257 leaves: no `+a -d` spans, no `isBinary`,
directory rows keep `N files`. Rebase on `v2.0` first; if P250 (`/home/user/kira-sW`, tests/docs)
landed, rebase on it too before touching `tests/ui/*`.

## 1. Method

- `codegraph_explore` (main checkout index) for git-ui toolbar/rows/badges/menus/grid row height,
  Studio `TreeRow`/`TreeTwisty`/`PanelHeader`/`ViewToolbar`/`StatusBar`/`SettingsShell`,
  `RowContextMenu` vs workbench `ContextMenu`. Rest by grep/Read over the worktree.
- Real WebKit screenshots and computed-style probes (Playwright `visual` project, fresh
  `build:test:space` and `build:test:studio`, 1400x820): Space git graph + detail + row menu +
  branch picker + stash dialog (mocks from `tests/visual/git-module.spec.ts`), Studio tree + data
  grid + tree row menu (mocks from `tests/visual/data-view.spec.ts`). Probe specs deleted after.
  Kept: `P258-shots/graph-vs-grid.png` (main pane, git left, Studio right),
  `P258-shots/detail-vs-tree.png` (detail file tree vs Studio tree), `P258-shots/menus.png`
  (row context menus). Studio baselines `connection-dialog`, `script-dialog`, `settings-*`,
  `http-request-view-at-rest` read beside the git ones.

## 2. Audit of what earlier passes borrowed outside Studio

- P256 G2/D2 folder rows: "RepoTreeRow recipe" = Space explorer. Folder codicon 16px, seti icon
  `size-4` mask. Studio `TreeRow`: every icon 13px `text-muted-foreground`. Re-ground (§4.3).
- P256 `<button>` rows "same as Space `GitPanel` rows". Studio popover lists (`SavedListMenu`) are
  also plain `<button>` rows, so the shape stays; the recipe changes (§4.4).
- `TreeTwisty`, `Badge`, `ViewToolbar`, `SearchOptionToggles`, `KuiColumnResizeHandle`,
  `text-kira-sm` secondary text: all used by Studio itself (`TreeRow`, `DataView`,
  `StreamView`, `TreeRow` detail). Keep.
- `git.css` import beside `./ade/v2/tones.css`: placement only, no visual effect. Keep.
- No ADE component, class or token is imported by `packages/git-ui` (grep for `ade/`, `Ade*`:
  none).

The real gap is not tokens (P256 fixed those) but Studio's composition and weight/density habits,
measured below.

## 3. Studio recipe per git screen (measured)

Computed at default settings (12px font, comfortable density). "=" means already identical.

| Git screen | Studio counterpart | Studio recipe | Git today |
|---|---|---|---|
| Toolbar | `DataView` `ViewToolbar` + console toolbar | `h-bar` 34px, `gap-1.5 px-2`, `border-b`, `Button variant=toolbar`, 13px icons, separators | = (34px, gap 6px, pad 0 8px) |
| View head (none in git) | `DataView` `ViewToolbar data-testid=view-head` | colour dot, engine icon `size-4`/13px, `text-kira-md text-fg truncate` name with `text-subtle` path prefix, `Badge` chips, right `Badge variant=info`, then `colorMarkClass('band')` rail | missing: toolbar is the first row |
| Commit rows | `TreeRow` (list) / SlickGrid data rows | single line `h-row` 28px, `text-kira-md`, weight 400, `hover:bg-hover`, selected `bg-select` | plain 28px; decorated 45px two-line; HEAD row 9% focus tint + 2px inset bar + `font-semibold` |
| Ref/PR badges | `Badge` (view head chips, `PK id`) | `h-control-sm` 18px, `rounded-kira-sm px-1`, `font-data text-kira-sm`, no border; `default` = `bg-field text-muted-foreground`, tones `bg-x/16 text-x` | 17px, 1px kind/lane-coloured border, 15% tint, `text-fg`, `font-normal` |
| Lane colours | connection palette `--kira-conn-*` (11 hues + grey, one lightness/chroma) | soft categorical hues | 8 hard-coded hexes in `git.css` |
| Secondary columns | `TreeRow` detail ("~3 rows") | `text-muted-foreground text-kira-sm` | author/date `text-fg`, HEAD row bold |
| Detail header | `ViewToolbar` head (`DataView`, `KeyValuePane`, `CellEditorView`) | one `h-bar` line, `text-kira-md`, weight 400, `Badge` chips | subject `text-graph-lg font-semibold` (13px/600) + meta line below |
| Detail file tree | `TreeRow` | 28px, `gap-1`, `pl 8+14*depth`, `pr-2`, twisty 13, icons 13 muted, detail `ml-auto text-muted-foreground text-kira-sm` | = geometry (28px, gap 4px, 36px at depth 2); folder icon 16, seti `size-4`, status letter `font-semibold`, `N files` `text-subtle` |
| Context menus | workbench `ContextMenu` | `DropdownMenuContent class="min-w-45"`, label `flex-1 overflow-hidden text-ellipsis`, content-sized | = item 26px/pad 4 6/gap 6; but `max-w-80` + label `min-w-0 whitespace-nowrap` shrink the menu to 180px: "Checkout this commit …", "Cherry-pick this com…" truncate (`menus.png`) |
| Picker popovers (branch, tags, stashes, worktrees, stacks, search results, base selector) | `SavedListMenu` | `PopoverContent class="w-80 gap-0 p-0"`; section head `h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider` (400); row `h-control` 22px `gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md hover:bg-hover`; icon slot `size-4` + 13px; empty `text-kira-sm text-subtle py-1 px-1.5`; `Separator my-1` | rows `rowVariants` `menu` = `py-1 gap-1.5` (26px); section head `font-semibold text-muted-foreground`; HEAD branch `font-semibold`; empty lines `py-0.5 px-2` |
| Dialogs | `ConnectionDialog`, `ScriptDialog` | header/footer `px-3 py-2` borders, title `text-kira-lg` 400; body `gap-3 p-3`; inputs 26px (`h-control-lg`, ConnectionDialog) or 32px (ScriptDialog default); notes as `FieldDescription` ("Credentials are encrypted…"); `Alert` only for errors | = header/footer/title; inputs `size="kira"` 22px; `WorktreeDialog` body still `gap-2 px-3 py-2`; repo-settings auto-stash note is a warn `Alert` box |
| Banners | `DataView` error/mask strips | `Alert variant=destructive|note` + leading 16px `CodiconIcon` + `AlertDescription`, no radius/border overrides | `FailureBanner`/`ConflictBanner`: `rounded-none border-x-0 border-t-0` overrides, `font-semibold` titles, no leading icon on failure |
| Empty states | `KeyValuePane` empty, `StudioStart` | `Empty` + `EmptyMedia` (default variant) with 24px codicon + `EmptyTitle` unstyled | `EmptyMedia variant="icon"`, `EmptyTitle class="font-semibold text-fg"`; Space `views/repo/*` and `GitStart` fake it with `Alert ... border-0 bg-transparent` |
| Settings | `SettingsShell` (shared) | — | Space settings Git pane already on `SettingsShell` = no change |
| Status bar | workbench `StatusBar` (shared) | — | = (Space uses the same base) |
| Scrollbars | host rules | — | = (inherited, no git override) |
| Splitters | `StreamView` `KuiColumnResizeHandle` | — | = |
| Diff header (Space `RepoDiffView`) | `ViewToolbar` | `h-bar gap-1.5 px-2 border-b` | `flex border-b py-1 px-1.5` |
| Multi-diff file header (Space `RepoMultiDiffView`) | `DataView` head target | `text-kira-md text-fg` name + `text-subtle` dir, 400 | name `font-semibold`, dir `text-muted-foreground text-kira-sm` |
| Commit panel / message box | — | — | none exists in the git module; nothing to align |

Weight: Studio frontend has `font-semibold` in 3 files (FK preview, method select, filters
dialog); git-ui has 18 occurrences in 16 files. Studio's scale is 400 + 500 (labels, buttons).

## 4. Changes (prefer delete)

### 4.1 Badges and palette (`badgeClass.ts`, `refBadges.ts`, `theme/git.css`, `graph/palette.ts`)

- `REF_BADGE_CLASS` = `badgeVariants({ variant })` only, plus `h-graph-h-xs text-graph-sm`
  (grid text still follows Settings > Git graph font size, D12). Delete `border border-transparent
  font-normal text-fg appearance-none`, `BADGE_KIND_CLASS` borders, `LANE_BORDER_CLASS`,
  `laneBorderClass`, `BADGE_STACKED_CLASS` border.
- Kind to variant: local branch `ok`, remote `info`, tag `default`, stash `default`, overflow
  `default`, stacked `info`, detached HEAD `warn`. PR: open `ok`, draft `default`, closed `err`,
  merged `chip` + `bg-conn-violet/16 text-conn-violet` (no Badge tone; Studio palette hue).
  `StackList` `refBadgeClass('bg-warn text-bg')` becomes `warn`.
- `git.css`: `--kira-graph-h-xs: calc(var(--kira-graph-t-md) + 6px)` (18px = `h-control-sm` at
  default). Lanes `--color-graph-lane-0..7` = `var(--kira-conn-blue|orange|green|violet|teal|red|
  amber|cyan)`; delete `--color-git-merged` (use `conn-violet`). Fix the "no app hue ramp" comment
  (false: the connection palette has 11). `DEFAULT_PALETTE_SIZE` stays 8.

### 4.2 Commit rows (`columns.ts`, `CommitGrid.vue`, `graph/graphColumn.ts`, `graph/rowSvg.ts`, `theme/readTokens.ts`, `git.css`, `App.vue`)

- D1 single-line rows: message cell is one flex row `flex items-center gap-1 min-w-0`: badge strip
  (`flex gap-1 shrink min-w-0 max-w-1/2 overflow-hidden`, existing overflow chip kept) then subject
  (`truncate`). Delete `CELL_MESSAGE_BADGES_CLASS`/`BADGES_ROW_CLASS` grid rows,
  `enableVariableRowHeight`, `getItemMetadata` `height`, `rowMetadata`'s badge check,
  `expandedRowHeight`, `rowHeightPx`, `--kira-graph-row-h`, `--spacing-graph-row`,
  `min-h-graph-row` (use `min-h-graph-row-compact`). `graphColumn`/`rowSvg`: one `rowHeight()`;
  `nodeCenterY = rowHeight / 2`; drop the two-regime formula and its doc comments.
- D2 HEAD row: delete `.kv-row-head` rule and the class; no tint, bar or bold. HEAD stays visible
  through the HEAD branch badge's check glyph and the filled node.
- D6 author/date/SHA cells `text-muted-foreground` (Studio tree detail tone); size stays grid scale.
- Keep (no Studio counterpart, or it is Studio's own choice): SlickGrid itself (Studio's data grid
  uses SlickGrid; same virtualization, same app-local stylesheet approach as Studio
  `views/shared/slick/slickTheme.css`); per-row graph SVG (no Studio graph); `KuiColumnResizeHandle`
  columns; no column headers (D14: Studio's list recipe is the tree, not the data grid; headers
  would cost a 28px row of space the G-UX pass reclaimed).

### 4.3 Detail panes (`CommitMeta.vue`, `DetailPane.vue`, `StashDetailPane.vue`, `WorkingDetailPane.vue`, `FileTree.vue`, `App.vue`)

- D7 head: `ViewToolbar data-testid="detail-head"`: subject `text-kira-md text-fg truncate` (400)
  with `Tooltip` on truncation (TreeRow label pattern), short SHA `Badge` (default, `font-data`),
  relative date `text-subtle text-kira-sm`, copy button `ml-auto` (`TooltipIconButton`). Same head
  for stash and working detail (title text there). Body, Show more, trailers, refs unchanged in
  structure; `text-graph-lg` gone.
- File tree: folder icon `:size="13"` `text-muted-foreground` (was 16); seti mask `size-3.25` in a
  `size-4` box (13px glyph, Studio icon size); status letter `font-data text-kira-sm` without
  `font-semibold`, colour kept (D15); directory `N files` `text-muted-foreground text-kira-sm`
  (Studio tree detail, was `text-subtle`).
- Empty states (`App.vue` detail placeholders, `DetailPane`, `StashDetailPane`,
  `NoRepositoryPanel`, `EmptyRepositoryPanel`, `GitBlockedPanel`): `EmptyMedia` default variant
  with 24px `CodiconIcon`, `EmptyTitle` with no class. Keep `role`, testids.

### 4.4 Popovers and menus (`lib/rowVariants.ts`, `RefSectionHeader.vue`, `BranchPicker.vue`, `TagList.vue`, `StashRows.vue`, `WorktreeList.vue`, `StackList.vue`, `SearchResults.vue`, `review/BaseSelector.vue`, `MenuSections.vue`, `RowContextMenu.vue`)

- `rowVariants` `menu`: `h-control gap-1 px-1.5 rounded-kira-sm text-kira-md cursor-pointer
  focus-visible:bg-hover` (22px, SavedListMenu). `tree` unchanged (= TreeRow).
- Section heads (`RefSectionHeader`, StackList group head, SearchResults group head, BaseSelector
  uppercase heads): `h-control-sm flex items-center px-1.5 text-kira-sm text-subtle uppercase
  tracking-wider`, no `font-semibold`. Empty lines: `text-kira-sm text-subtle py-1 px-1.5`.
- HEAD branch row: drop `font-semibold`; keep the `text-focus` dot.
- `MenuSections` label `flex-1 overflow-hidden text-ellipsis` (drop `min-w-0 whitespace-nowrap`);
  `RowContextMenu` content `min-w-45` (drop `max-w-80`): menus size to content like Studio.

### 4.5 Dialogs (`components/dialogs/*.vue`, `WorktreeList.vue` dialog)

- D9 every dialog `Input` `size="kira-lg"` (26px, ConnectionDialog); `NativeSelect`
  `variant="bordered" size="kira-lg"`; `Textarea` unchanged.
- `WorktreeList` dialog body `flex min-h-0 flex-col gap-3 overflow-auto p-3` (P256 missed it);
  its `text-error` `<p>` becomes `FieldError`.
- D10 explanatory notes back to `FieldDescription`: RepoSettings auto-stash note, StashDialog
  partial-stash note when it explains rather than warns. `Alert` stays only for operation
  failures (`destructive`) and data-loss/blocker lists (`warn`), as Studio `UploadObjectDialog`.
- `RevertDialog` `font-semibold`: drop.

### 4.6 Banners (`FailureBanner.vue`, `ConflictBanner.vue`, `UncommittedChangesStrip.vue`)

- Alert as `DataView`: leading `CodiconIcon` 16 (`error`/`warning`), `AlertTitle` no
  `font-semibold`, delete `rounded-none border-x-0 border-t-0` and `py-1 px-2`/`pr-18` overrides
  (Alert base already pads for `alert-action`); wrap in a `p-1.5` container in `App.vue` if the
  box needs inset, matching DataView's placement. Strip: unchanged except text tone check.

### 4.7 View head (`App.vue`, `main.ts`, Space `views/repo/RepoGraphView.vue`)

- D4 add Studio's view head above `AppToolbar`: `ViewToolbar data-testid="git-view-head"`:
  `colorMarkClass('dot', repoColor)` when set, `source-control` 13px in `size-4`, repo name
  `text-kira-md text-fg truncate` with parent dir `text-subtle` prefix, `Badge` HEAD (branch name or
  `detached`), `Badge` upstream sync (`↑a ↓b`, only with upstream), `Badge variant=warn` for an
  in-progress operation. Then `colorMarkClass('band', repoColor)` rail. New mount option
  `repoColor?: PaletteColor` from the Space repo record (RepoGraphView already has it via
  `useCodeReposStore`). All data already in `status.get`/`repo.open`: no new IPC.
- Review view (`view === 'review'`) gets the same head.

### 4.8 Review (`review/ReviewView.vue`, `ReviewCommitRow.vue`, `ReviewFilesPane.vue`, `ReviewCommentsPane.vue`)

- `text-graph-lg` headings to `text-kira-md`; every `font-semibold` dropped; ad-hoc header rows
  (`py-1 px-1.5 border-b`, `py-0.5 px-2 border-b`) to `ViewToolbar` (border bottom); the
  `bg-hover` sub-header (ReviewView ~1010) to `ViewToolbar` without fill.

### 4.9 Space git host (`apps/kira-space/frontend/src/views/repo/*`, `repo/GitStart.vue`, `repo/RepoTreeRow.vue`)

- Fake empty states (`Alert ... border-0 bg-transparent text-center` + `AlertTitle`): `Empty` +
  `EmptyMedia` + 24px icon + `EmptyTitle` in `RepoDiffView` (4), `RepoFileView` (4),
  `RepoMultiDiffView` (3), `RepoGraphView` (1), `GitStart` (1).
- `RepoDiffView` header: `ViewToolbar`. `RepoMultiDiffView` file header: `ViewToolbar` with name
  `text-kira-md text-fg` (400) and dir `text-subtle` prefix.
- `RepoTreeRow`: Studio `TreeRow` geometry: `pl 8+14*depth`, `pr-2`, icons 13px (codicon) and
  13px seti glyph. `GitPanel` header (ToggleGroup tabs + icon buttons) stays: Studio uses
  `ToggleGroup` for view tabs (HTTP request view); P259 owns the rest of the repo panel.

### 4.10 `kv-` marker layer (all git-ui, git.css, Space specs)

- 71 `kv-*` names remain (markers for tests or SlickGrid hooks). Studio convention (P110 B35,
  `TreeRow`): test hooks are `data-testid`, runtime grid state classes are `kira-*`
  (`slickTheme.css`). Template markers become `data-testid` (keep existing testids; new ids
  kebab-case from the old name without `kv-`). DOM built in formatters sets `dataset.testid`.
  SlickGrid runtime classes: `kv-commit-grid` to `kira-commit-grid`, `kv-row-selected` to
  `kira-row-selected`, `kv-row-collapsed` to `kira-row-collapsed`, `kv-cell-*` to `kira-cell-*`,
  `kv-lane-N` dropped (utility classes already carry the colour). `kv-skin-kira`/`kv-app` root
  markers: delete if no selector reads them.
- Update every selector in: `tests/ui/repo-branch-picker`, `repo-commit-meta`, `repo-file-tree`,
  `repo-floating-geometry`, `repo-graph-branch-order`, `repo-graph-columns`, `repo-graph-lines`,
  `repo-graph-paging`, `repo-graph-pr-badge`, `repo-graph-refresh`, `repo-graph-rewalk`,
  `repo-review-interaction`, `repo-workspace` (`.spec.ts`), `tests/ui/support/gitUiPortFixtures.ts`,
  `tests/visual/git-module.spec.ts`, plus git-ui unit tests (`refBadges.test.ts` etc.).
- Lint (`scripts/check-theme-classes.sh`): `check_no_kv_layer` also bans `(?<![\w-])kv-[a-z]` in
  git-ui and theme; `check_git_ui_primitives` also bans `font-semibold|font-bold|text-graph-lg` in
  git-ui `.vue`/`.ts`.

## 5. Commit groups (one sequential Sonnet implementer)

Fast checks per commit: `bun run typecheck`, `bun run lint`, `bun test packages/git-ui/src`.
Expensive suites once, in group 9.

1. `refactor(git-ui): ref badges on Studio Badge tones, lanes on the connection palette` (§4.1).
2. `refactor(git-ui): single-line commit rows, no HEAD band` (§4.2); unit tests `graphColumn.test.ts`,
   `rowSvg` tests, `refBadges.test.ts`, `columns`-related tests updated.
3. `refactor(git-ui): detail panes on the Studio view head and tree recipe` (§4.3).
4. `refactor(git-ui): popovers and menus on Studio list recipes` (§4.4).
5. `refactor(git-ui): dialogs on Studio control scale, banners on DataView Alert` (§4.5, §4.6, §4.8).
6. `feat(git-ui): Studio view head above the git toolbar` (§4.7, Space mount option).
7. `refactor(space): git host views on Empty and ViewToolbar` (§4.9).
8. `refactor(git-ui)!: drop the kv- marker layer` (§4.10) with spec selector updates and lint.
   `!` only if a public export name changes; otherwise plain `refactor`.
9. `test(space): git visual baselines and UI specs`:
   - `repo-graph-columns.spec.ts`: "decorated row taller" becomes "decorated and plain rows share
     one height"; "Git graph font size scales…" asserts compact height (`max(28, t+8)`; 13px gives
     28, recompute from the token formula and say so in the test comment).
   - `repo-workspace.spec.ts` (or `repo-commit-meta.spec.ts`): view head shows repo name, branch
     badge, upstream badge from the mocked `status.get`; detail head shows subject and SHA badge.
     Frontend half only: data comes from existing IPC already covered by gitflow flow tests, so no
     new flow test (CLAUDE.md split applies to new features; this adds no backend behaviour).
   - Visual: re-record the `git-module` spec only:
     `bun run build:test:space && bunx playwright test --config=apps/kira-space/playwright.config.ts
     --project=visual git-module --update-snapshots`. All five baselines change
     (`git-graph`, `git-graph-detail`, `git-stash-dialog`, `git-repo-settings-dialog`,
     `git-branch-picker`). Add `git module: row context menu (P258)` (`git-row-menu.png`, row 4
     right-click; proves content-sized menu). Read every PNG by hand against `P258-shots/`. Never
     `test:visual:update:space` (re-records ADE/settings baselines). Studio and Space `settings`,
     `ade-workflow-graph` visual: run once, must pass unchanged (no theme/workbench edits).
   - UI: `--project=ui repo-` and `git-panel-tab`, `ade-v2-review`, `ade-v2-review-open`
     (ADE review embeds git-ui `FileTree`), then full `test:ui:space` once. One heavy suite at a time.
10. `docs: P258 result` — `plans/P258-result.md`, SPEC row Done + result section, ARCHITECTURE
    "Git module follows the app look" rewritten to "Git module uses Studio's recipes" (single-line
    rows, Badge tones, connection palette lanes, view head, no semibold, `kv-` gone) and "Two
    font-size settings" (graph scale: grid, detail tree, review rows only; no `text-graph-lg`).

## 6. Ownership and concurrency

P258 owns `packages/git-ui/src/**`, `apps/kira-space/frontend/src/views/repo/*.vue`,
`apps/kira-space/frontend/src/repo/{GitStart,RepoTreeRow}.vue`, the spec/fixture files in §4.10
and group 9, `scripts/check-theme-classes.sh` (two checks), ARCHITECTURE two paragraphs,
`docs/v2.2/plans/P258-*`, P258 row/result in SPEC. Not touched: `packages/theme`,
`packages/workbench`, Studio app, Go.

- P257: same files (`FileTree.vue`, `fileTreeModel.ts`, `git-module.spec.ts`,
  `gitUiPortFixtures.ts`, `repo-workspace.spec.ts`, `git-graph-detail` PNG). Hard order: P257
  first. Never merge PNGs; re-record after rebase.
- P250: `tests/**` and ARCHITECTURE. Rebase on it before group 8/9 if landed; on conflict keep both.
- P259 (next): `GitPanel`/repo registry; runs after P258.

## 7. Deferred decisions (defaults applied unless the user objects)

- D1 single-line commit rows, badges inline before the subject (capped at half the cell).
  Reverses the G-UX two-row badge layout (badges above the subject). Default yes.
- D2 HEAD row tint, inset bar and bold removed (reverses P256 D5). Default yes.
- D3 ref badges lose the lane-coloured border; Studio tones per ref kind. Default yes.
- D4 Studio view head row (repo dot, name, branch, upstream, operation) plus colour band above the
  toolbar. Default yes.
- D5 lane colours from the connection palette (softer hues). Default yes.
- D6 author/date/SHA columns muted. Default yes.
- D7 commit subject in a one-line head (truncate + tooltip), weight 400. Default yes.
- D8 popover list rows 22px (Studio `SavedListMenu`), down from 26px. Default yes.
- D9 dialog inputs 26px. Default yes.
- D10 explanatory dialog notes back to `FieldDescription` (partly reverses P256 D3). Default yes.
- D11 no `font-semibold` anywhere in git-ui, lint-enforced. Default yes.
- D12 Settings > Git graph font size kept (grid, detail tree, review rows); `text-graph-lg` gone.
  Default keep the setting.
- D13 seti file-type icons kept, at 13px (no Studio file tree). Default keep.
- D14 no grid column headers. Default keep none.
- D15 status letter colours kept (git meaning; Studio colours PK/FK chips the same way). Default keep.
