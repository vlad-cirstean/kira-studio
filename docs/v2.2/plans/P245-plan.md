# P245 plan: git module visual alignment

SPEC row P245: "make the git module look exactly like the rest of the app, using only Tailwind and
mostly default values (drop `kv:` prefix indirection and custom styles)". User's words: "git module
must look exactly like the rest of the app, only Tailwind, mostly default values."

Base: `v2.0` at `bb9f55fd0` or later. Frontend only: `packages/git-ui`, `packages/theme`, Kira Space
root CSS and settings comments, lint guards, Space UI/visual specs, docs. No Go behaviour, no bridge,
no wire change, no new dependency, no `package.json`/`bun.lock` edit.

P243 Part 2 left exactly this to P245 (`P243-part2-result.md`, "Intentional leftovers"):
`vscode-bridge.css`, the `--vscode-*` tokens, and comments naming the extension in theme code. With
the extension gone, git-ui has one host (Kira Space, plus the ADE review mount in the same app), so
the second Tailwind root, its `kv` prefix and the VS Code token layer have no remaining reason.

Discovery: `codegraph_explore` over the git-ui theme layer (`TokenReader`, `readTokens.ts`,
`tailwind.css`/`vscode-tokens.css`), `CommitGrid`/`columns.ts`/`refBadges`/`badgeClass`/`palette`/
`laneClass`, `BranchPicker`/`BaseSelector`/`UncommittedChangesStrip`, `TooltipIconButton`/
`ViewToolbar`/`SearchToolbar`, `TreeRow` indent, `RowContextMenu`/`useRowMenu`. Counts below are
`grep -c` over the current tree.

## 1. Current state

### 1.1 Two Tailwind roots, one document

- Kira Space's root: `apps/kira-space/frontend/src/styles.css` imports `@workbench/workbench.css`
  (`@theme/base.css`: tokens, `vscode-bridge.css`, `tailwind-core.css`) and already `@source`s
  `packages/git-ui/src`. Unprefixed utilities used in git-ui markup compile here today.
- git-ui's own root: `packages/git-ui/src/theme/tailwind.css`, `prefix(kv)`, no preflight,
  `@theme inline reference` mapping 70 names onto `--kv-*`. Imported by `src/main.ts` together
  with `vscode-tokens.css`, `density.css`, `kira-structure.css`, `icons/codicon.css`.
- Token chain for every git colour: `--kira-*` (tokens.css) to `--vscode-*` (`vscode-bridge.css`,
  `:root`, 50 names) to `--kv-*` (`vscode-tokens.css`, `var(--vscode-X, <VS Code Dark literal>)`)
  to `kv:` utility. Light/high-contrast blocks key on `body.vscode-light`/`body.vscode-high-contrast*`,
  which nothing in the app ever sets: dead.
- Unmapped in the bridge, so the literal fallback is what renders today: lane palette (8 hex),
  `--kv-badge-pr-merged-fg` (#b180d7), `--kv-stack-stale-fg` (#1e1e1e), `--kv-overlay-bg`
  (rgba(0,0,0,.35)), `--kv-line-highlight-bg`, connection/syntax palettes (unused by git markup).
- Graph font size: `--vscode-font-size: var(--kira-graph-font-size, var(--kira-t-md))` feeds
  `--kv-font-size`, which drives `--kv-t-*`, `--kv-h-*`, row heights and every `kv:text-*`.
  `applyAppearance` (Space `state/settings.ts`) sets `--kira-graph-font-size` only when
  `git.graphFontSize > 0`. Chrome markup (unprefixed `text-kira-*`) follows Appearance font size.
- Row height: `--kv-row-height-compact: max(--vscode-kiraSpace-rowHeight (= --kira-row-height),
  --kv-h-xs + 2px)`, `--kv-row-height = compact + --kv-h-xs`. `TokenReader` (`readTokens.ts`)
  measures `--kv-row-height`, `--kv-row-height-compact`, `--kv-font-size` through probes and reads
  `--kv-font-family`, for SlickGrid's `rowHeight` and `rowSvg.ts` geometry.
- Mixed state today: dialogs, toolbar, banners, empty panels already use shadcn-vue primitives and
  unprefixed app utilities (P131, P229). Data surfaces (grid, detail meta, file tree, review rows,
  pickers' list bodies) still speak `kv:`.

### 1.2 Inventory

`packages/git-ui/src`, non-test files. Columns: `kv:` utility tokens; `--kv-` references (incl.
arbitrary values like `h-(--kv-h-xs)`); style blocks; raw `<button>` elements. `--vscode-` refs are
zero in every component; they live only in the CSS files listed after the table.

| File | `kv:` | `--kv-` | style | raw button |
|---|---|---|---|---|
| `App.vue` | 80 | 2 | 0 | 0 |
| `main.ts` | 14 | 0 | 0 | 0 |
| `components/CommitGrid.vue` | 73 | 13 | 1 (global, `.slick-*`) | 0 |
| `components/CommitMeta.vue` | 101 | 0 | 0 | 3 |
| `components/FileTree.vue` | 107 | 2 | 0 | 0 |
| `components/BranchPicker.vue` | 47 | 0 | 0 | 4 |
| `components/SearchResults.vue` | 61 | 2 | 0 | 0 |
| `components/UncommittedChangesStrip.vue` | 28 | 0 | 0 | 2 |
| `components/StashRows.vue` | 4 | 0 | 0 | 1 |
| `components/StashDetailPane.vue` | 1 | 0 | 0 | 0 |
| `components/StackList.vue` | 0 | 4 | 0 | 1 |
| `components/TagList.vue` | 0 | 0 | 0 | 1 |
| `components/AppToolbar.vue` | 0 | 3 | 0 | 0 |
| `components/ConflictBanner.vue` | 0 | 1 | 0 | 0 |
| `components/review/ReviewView.vue` | 139 | 0 | 0 | 2 |
| `components/review/BaseSelector.vue` | 34 | 0 | 0 | 3 |
| `components/review/ReviewCommentsPane.vue` | 4 | 0 | 0 | 1 |
| `components/review/ReviewCommitRow.vue` | 1 | 1 | 0 | 0 |
| `components/review/ReviewFilesPane.vue` | 1 | 0 | 0 | 0 |
| `components/columns.ts` | 37 | 1 | 0 | 0 |
| `components/badgeClass.ts` | 0 | 38 | 0 | 0 |
| `components/refBadges.ts` | 4 | 3 | 0 | 0 |
| `components/fileTreeModel.ts` | 8 | 1 | 0 | 0 |
| `components/linkify.ts` | 8 | 0 | 0 | 0 (2 in comments) |
| `components/searchHighlight.ts` | 1 | 0 | 0 | 0 |
| `graph/rowSvg.ts` | 7 | 3 | 0 | 0 |
| `graph/graphColumn.ts` | 4 | 1 | 0 | 0 |
| `graph/palette.ts` | 0 | 2 | 0 | 0 |
| `theme/readTokens.ts` | 0 | 22 | 0 | 0 |
| `icons/setiFileIcon.ts` | 0 | 1 | 0 | 0 |
| `lib/rowVariants.ts` | 2 | 0 | 0 | 0 |
| `lib/cn.ts` | 2 | 0 | 0 | 0 |

Totals: 772 `kv:` tokens in 24 files, 422 `--kv-` refs, 148 `--vscode-` refs. Theme CSS:
`theme/tailwind.css` (151 lines, 82 `--kv-`), `theme/vscode-tokens.css` (303 lines, 143 `--kv-`,
89 `--vscode-`), `theme/kira-structure.css` (105), `theme/density.css` (29), `icons/codicon.css`
(duplicate of `base.css`'s codicon import), `packages/theme/src/vscode-bridge.css` (109 lines, 50
`--vscode-`). `lib/cn.ts` (`twMergeKv`) has no importer left in git-ui; only
`scripts/check-class-conflicts.ts` imports it.

Other files naming the layer: `packages/theme/src/base.css` (import + comment),
`shadcn-bridge.css`/`tailwind-core.css` (comments), Space `state/settings.ts:29`,
`state/settingsDomain.ts:41-42`, `internal/storage/model/settings.go:51` (comments),
`scripts/check-tokens.sh`, `scripts/check-theme-classes.sh`, `scripts/check-class-conflicts.ts`,
`docs/ARCHITECTURE.md` (§ Theme, Two-host shadcn plumbing, Two font-size settings, P229 section,
line 3059 layer-order note, Known open item "vscode-bridge.css ... ties with Monaco").

Unaffected: Monaco's own `--vscode-*` (scoped to `.monaco-editor` by Monaco itself,
`workbench/src/editor/monaco.ts`); `KeyValuePane.vue`/`ConsoleResultGrid.vue` `kv-` names (Studio
key-value, unrelated); `packages/kira-ui` (no `kv`, no `--vscode`).

`.kv-*` plain class names (no `kv:` prefix) appear as DOM hooks: test locators in 15 Space specs
(~55 sites: `.kv-cell-message`, `.kv-graph-svg`, `.kv-branch-trigger`, `.kv-meta-*`, ...) and JS
hooks (`CommitGrid.vue` click delegation on `.kv-badge-pr`, `.kv-cell-date`). Styled ones today:
`.kv-commit-grid` tree, `.kv-row-head/-selected/-collapsed`, `.kv-cell-graph`, `.kv-badge`,
`.kv-badge-icon`, `.kv-badge-current-glyph`, `.kv-collapsed-chevron` (CommitGrid style block),
`.kv-lane-0..7`, `.kv-node` (vscode-tokens.css).

### 1.3 Hand-rolled primitives left

Already shadcn: every dialog, toolbar buttons (`Button variant="toolbar"`), popovers
(`Popover`), row context menu (`DropdownMenu`), tooltips, inputs (`InputGroup`), badges
(`badgeVariants`), banners (`Alert`), empty panels (`Empty`). Left:

- `CommitMeta.vue` 3 inline link-style `<button>`s (sha copy, parent link, PR link) and
  `ReviewCommentsPane.vue` 1: raw button with `bg-transparent border-0 p-0 hover:underline`.
- Row buttons using `rowVariants` (`TagList`, `StashRows`, `BranchPicker` x2, `BaseSelector` x3,
  `ReviewView` x2): `rowVariants` is the app's own row recipe (`menu` = `DropdownMenuItem`'s,
  `tree` = app tree row). Keep.
- PR badge buttons (`BranchPicker`, `StackList`): `<button>` styled by `prBadgeClass`
  (`badgeVariants`). Keep.
- `UncommittedChangesStrip.vue` root `<button>` (whole-strip activator) and its inner graph glyph.
  Keep the element; restyle only.
- Toolbar: `AppToolbar.vue` restates `ViewToolbar`'s recipe because "`@workbench` is not importable
  here". It is: git-ui's `tsconfig.json` already maps `@workbench/*`, and `docker-ui` imports
  `@workbench/components/*` the same way with no package dependency.

## 2. Target design

One Tailwind root (Kira Space's), app utilities and tokens only, `kv` prefix gone, VS Code token
layer gone, git-ui shaped like `packages/docker-ui` (no CSS of its own except one file for what
Tailwind cannot express).

### 2.1 `packages/git-ui/src/theme/git.css` (new, the only git-ui CSS)

Imported by Space's root: `apps/kira-space/frontend/src/styles.css` gains
`@import "../../../../packages/git-ui/src/theme/git.css";` after the existing imports (relative
path, same as its `@source` line and the `./ade/v2/tones.css` precedent). Not imported by
`main.ts`: it must compile inside the Space root to use `@theme`/`@apply`. Contents, nothing else:

1. `:root` graph scale. Real requirement: Settings > Git graph font size must scale grid text and
   row geometry independently of Appearance font size (P92 item 9); no app token does that.
   Names under `--kira-graph-*`:
   - `--kira-graph-t-md: var(--kira-graph-font-size, var(--kira-font-size))`;
     `-t-xs/-t-sm/-t-lg` = `calc(md - 2px/-1px/+1px)` (same offsets as `--kira-t-*`).
   - `--kira-graph-h-xs: calc(var(--kira-graph-t-md) + 5px)` (today's `--kv-h-xs`).
   - `--kira-graph-row-h-compact: max(var(--kira-row-height), calc(var(--kira-graph-h-xs) + 2px))`;
     `--kira-graph-row-h: calc(var(--kira-graph-row-h-compact) + var(--kira-graph-h-xs))`.
   Same formulas as today, so grid pixels stay put at every setting.
2. `@theme` entries (app root, unprefixed):
   - `--text-graph-xs/-sm/-md/-lg: var(--kira-graph-t-*)`.
   - `--spacing-graph-row: var(--kira-graph-row-h)`, `--spacing-graph-row-compact`,
     `--spacing-graph-h-xs: var(--kira-graph-h-xs)` (badge height/leading).
   - `--color-graph-lane-0..7`: today's 8 dark literals (the only values that ever render in-app;
     `scripts/gen-lane-palette.ts` does not exist any more, the comment pointing at it goes).
   - `--color-git-merged: #b180d7` (PR merged; no app hue).
   Every other git colour maps onto an existing app utility (§2.3); no other new token.
3. SlickGrid structural rules, moved from `CommitGrid.vue`'s global `<style>`: `.slick-pane`,
   `.slick-viewport`, `.grid-canvas`, `.slick-row.ui-widget-content`, row state classes,
   `.slick-cell`, `.kv-cell-graph`. Real requirement: SlickGrid builds these nodes itself and
   rewrites their inline styles; no template exists to carry utilities. Written with `@apply` of app
   utilities (`bg-bg`, `bg-hover`, `bg-select`, `text-muted-foreground`, `font-semibold`), raw
   declarations only where today's comments already justify them (`outline: 0`, `border: 0`,
   `contain`, the head tint `color-mix(in srgb, var(--kira-focus) 9%, transparent)` plus inset
   accent, the focus outline uses the app's `focus-ring` utility). Same precedent as Studio's
   `views/shared/slick/slickTheme.css`.

`.kv-badge`/`.kv-badge-icon`/`.kv-badge-current-glyph`/`.kv-collapsed-chevron` font-size rules do
not move: they become `text-graph-sm`/`text-graph-xs`/`text-graph-md` utilities in `badgeClass.ts`/
`columns.ts`/`refBadges.ts`. `.kv-lane-N`/`.kv-node` rules do not move: `palette.ts` returns
literal utility strings (P213 `Record`-of-literals rule), e.g. `'kv-lane-0 stroke-graph-lane-0
fill-graph-lane-0'`; `NODE_CLASS` loses its high-contrast outline (dead: needs
`body.vscode-high-contrast`) and keeps only its marker name if a test or `rowSvg.test.ts` reads it.

### 2.2 Removed

`theme/tailwind.css`, `theme/vscode-tokens.css`, `theme/density.css`, `theme/kira-structure.css`,
`icons/codicon.css`, `lib/cn.ts`, `packages/theme/src/vscode-bridge.css` and its `base.css` import.
`main.ts` imports no CSS; `mount()` adds plain `h-full m-0 p-0 overflow-hidden` (and `w-full` on
the container) instead of `kv:` classes. `CommitGrid.vue` has no `<style>` block. `TokenReader`
measures `--kira-graph-row-h`, `--kira-graph-row-h-compact`, `--kira-graph-t-md` and reads
`--kira-font-ui` (today's `--kv-font-family` resolves to the same `--kira-font-ui` stack); its doc
comments drop the VS Code theme-switch narrative; fallbacks keep today's numbers.

### 2.3 Utility mapping (apply per site; `cn` from `@theme/lib/utils` everywhere)

Surfaces: `kv:bg-bg`/`bg-panel`/`bg-toolbar` to `bg-bg`; `kv:text-fg`/`text-row-fg` to `text-fg`;
`border-panel-border`/`toolbar-border`/`field-border` to `border-border`; `bg-field` to `bg-field`;
`border-border-strong` stays; `*-focus` to `*-focus`; `text-muted-foreground`, `text-error`,
`bg-search-match` stay (same names in the app root); `bg-overlay` to `bg-black/35` (default
palette, same value); `bg-line-highlight` to `bg-hover`; scrollbar tokens dropped (`base.css` owns
scrollbars).

Rows: `bg-hover` stays; `bg-selected` to `bg-select`; `text-selected-fg` to `text-fg`;
`bg-inactive-selected` to `bg-hover` (the bridge's own mapping).

Status (bridge values today): added/renamed/copied/untracked to `ok`; modified/typechanged to
`warn`; deleted/conflict/unmerged to `error`; inserted/removed fill to `bg-ok/20`/`bg-error/20`.
Badges: local/tag/pr-open to `ok`; remote/branch-stacked/stash-origin to `info`; stash/pr-draft/
stash-auto to `muted-foreground`; pr-closed to `error`; pr-merged to `git-merged`; stack-stale fill
to `warn` with `text-bg` label; badge fill to `bg-field`, label to `text-fg`; overflow badge border
to `border-border`; lanes to `graph-lane-N`. Arbitrary forms like `border-(color:--kv-badge-tag-fg)
bg-(color:--kv-badge-tag-fg)/15` become `border-ok bg-ok/15`.

Type and size: data `kv:text-sm/base/lg` to `text-graph-sm/md/lg` (grid cells, detail meta, file
tree rows, review rows, search results, picker list bodies: everywhere `kv:text-*` is today);
chrome stays/turns `text-kira-*`. `font-data`/`font-ui` stay; `kv:[font-family:var(--kv-font-family)]`
to `font-ui`; `font-inherit` to `[font-family:inherit]` only where a raw form control remains (none
expected). `text-codicon` (12px raw codicon spans) to `CodiconIcon :size="13"` (P229's app
standard). `rounded-sm` to `rounded-kira-sm`, `rounded-lg` to `rounded-kira`; `shadow-float` to
`shadow-kira-dialog`, `shadow-widget` to `shadow-kira`.

Heights: chrome `h-control/-lg/-sm`, `h-bar` resolve to the app's own (`--kira-control-h*`, fixed
22/26/18, `--kira-bar-h` 34). Today's `kv` values are font-derived (21/25/17 at 12px): chrome moves
by 1px to match the app. `h-control-inline` to `h-3.5`; `size-icon-box` to `size-4`;
`h-row`/`min-h-row`/`h-row-compact` in data surfaces to `h-graph-row`/`min-h-graph-row`/
`h-graph-row-compact`; `h-row-comfortable` (26px) to `h-6.5`; `h-(--kv-h-xs)`/
`leading-(--kv-h-xs)` to `h-graph-h-xs`/`leading-(--kira-graph-h-xs)`.

Tree indent: `FileTree.vue` `calc(8px + var(--kv-tree-indent) * depth)` (VS Code
`workbench.tree.indent`, 8px default, no Space setting) to `` `${8 + row.depth * 14}px` ``, the app
tree's formula (`RepoTreeRow.vue:100`, Studio `TreeRow.vue:133`); `FALLBACK_TREE_INDENT` and the
root override go.

### 2.4 shadcn-vue replacements

- `AppToolbar.vue` root: `ViewToolbar` from `@workbench/components/ViewToolbar.vue` (with
  `role="toolbar"`/`aria-label` passed through); drop the restated recipe and its comment.
- Inline link buttons (`CommitMeta.vue` x3, `ReviewCommentsPane.vue` x1): `Button variant="link"`
  with `class="h-auto p-0 font-data text-inherit"` (keeps today's colour; `text-primary` on
  `--kira-bg` is 3.9:1, under AA for small text). The PR icon button keeps its codicon glyph via
  `CodiconIcon`.
- Everything in §1.3 marked Keep stays a `<button>`/`rowVariants`/`badgeVariants` site: those are
  the app's own recipes, not hand-rolled styles. `RowContextMenu` stays on shadcn `DropdownMenu`;
  the app's `useContextMenuStore` needs the host Pinia, which git-ui's own `createApp` does not have.
- No `Command` swap for `BaseSelector`/`ReviewView` branch lists: it changes keyboard behaviour,
  out of a no-behaviour-change phase.

### 2.5 Lint guards

`check-tokens.sh`: drop the `kv-` layer pass. `check-theme-classes.sh`: drop every `kv:`-specific
pass and exclusion (`(?!kv:)` second/third passes, `kv_class`/`kv_css`); its unprefixed checks now
simply include `packages/git-ui/src`; `check_font_scale` accepts `text-graph-(xs|sm|md|lg)` and
stops exempting `CommitGrid.vue`. `check-class-conflicts.ts`: drop `cnKv`/`twMergeKv`, the
`kv-on-theme-component` rule and the git-ui registration self-check against the deleted root; scan
git-ui with the theme `cn`. New guard (in `check-theme-classes.sh`): fail on `kv:`, `--kv-` or
`--vscode-` under `packages/git-ui/src` and `packages/theme/src`. `packages/theme/src/lib/utils.ts`
registers `text: graph-xs..graph-lg`, `spacing: graph-row, graph-row-compact, graph-h-xs`.

## 3. Streams

One sequential implementer. A split fails the CLAUDE.md test: every component edit depends on
`git.css` tokens and the theme `cn` registration landing first (ordering dependency), the root
deletion needs every file converted, and the guards span all of it.

## 4. Overlap with in-flight streams

Checked by `git diff --name-only v2.0...<branch>`:

- P246 (`p246-O`, prompts router, settings advanced tab, status bar): touches Space `App.vue`,
  `bridge/index.ts`, `repo/git/transport.ts`, `state/gitCredential.ts`, `state/settingsDomain.ts`
  (hunks at lines 50, 151, 208), settings `AdvancedPane.vue`, `workbench/*Dialog.vue`,
  `tests/ui/git-credential-relay.spec.ts`. P245 shares only `state/settingsDomain.ts`, a comment at
  lines 41-42, outside every P246 hunk. No git-ui, theme, `styles.css`, guard or visual file in P246.
  P246's plan regenerates only baselines it changes (settings-advanced); P245 regenerates only git
  ones. Whichever lands second rebases; a real conflict there means re-check, not a blind take.
- P251 (`p251-Q`, Wails upgrade): `go.mod`, `go.sum`, `package.json`, `bun.lock`. P245 touches none
  (D9).

## 5. Visual regression

Baselines under `apps/kira-space/tests/visual/`:

- Regenerate intentionally, after review of each diff image: `git-module.spec.ts-snapshots/
  git-graph-visual-linux.png`, `git-graph-detail-visual-linux.png`. Expected deltas: chrome
  control/bar heights (1px), file tree indent (8 to 14px per level), codicon 12 to 13px, row
  inactive-selection/line-highlight tones, any `bg-overlay` region.
- `git-stash-dialog-visual-linux.png`: already shadcn; expect unchanged. Regenerate only if the diff
  is a named intentional delta from §2.3.
- Must stay unchanged: `settings.spec.ts-snapshots/*` (4), `ade-workflow-graph-visual-linux.png`,
  every Studio baseline (`base.css` loses an import shared with Studio). A diff there is a bug.

Procedure: run `bun run test:visual:space` and `test:visual:studio` on the base first (green), then
after the change; for each failing git baseline open the diff, list what moved in the result file,
then `bun run test:visual:update:space -- --grep "git module"` (never a blanket update).

## 6. Test plan

No behaviour change: same DOM hooks, same events, same IPC. CLAUDE.md's split-at-IPC rule targets
new features; here no flow test is added or changed. Space UI specs plus visuals cover it.

- Per commit: `bun run typecheck`, `bun run lint` (hook).
- Once at the end: `bun run test:unit` (`rowSvg.test.ts`/`graphColumn.test.ts`/`refBadges.test.ts`
  class-string assertions updated in the commit that changes those strings),
  `bun run test:ui:space`, `bun run test:ui:studio` (shared `base.css`), both visual suites (§5),
  `bun run test:e2e-real:space` git specs (graph, checkout-stash, commit-detail, remote, review;
  they locate `.kv-*` hooks, so they confirm the hooks survived).
- One added assertion (D8): `repo-graph-columns.spec.ts` sets `git.graphFontSize` through the
  mocked settings (`support/mockRuntime.ts` already answers `SettingsService.GetAll`) and asserts `.kv-cell-message` font size and row height grow. Real reason: this
  phase rewires the only path that setting takes into the grid, and no spec covers it today.
- Manual check in the real app (`run` skill or `wails dev`): graph, detail, review, picker, a
  dialog, Appearance font size and Git graph font size both changed live.

## 7. Risks

1. CSS order. Today git-ui's `kv` root loads with the lazy chunk; now everything is in the Space
   root, so the ARCHITECTURE line 3059 ordering caveat disappears. Risk is the reverse: a rule in
   `git.css` outside `@layer` beats utilities. Keep `git.css` slick rules in `@layer components`.
2. tailwind-merge. New `graph-*` keys unregistered would let `cn` keep conflicting classes. Covered
   by the `utils.ts` registration and `check-class-conflicts.ts`'s registration self-check.
3. Live font size. `--kira-graph-t-md` is declared at `:root` and reads `--kira-font-size`, which
   `applyAppearance` writes inline on `<html>`; both resolve on the same element, so a live change
   recomputes. `TokenReader.watch` already observes `<html>` style; keep it.
4. Dropping the bridge from `base.css` affects Studio. Nothing outside git-ui reads
   `var(--vscode-*)` (grep: zero hits); Monaco defines its own. Studio visuals confirm.
5. Axe contrast in UI specs. Status colours move from VS Code literals to `--kira-ok/warn/error`
   (already what renders in-app via the bridge), so no new contrast pair; `git-merged` keeps its
   literal.
6. Marker classes kept (D4): a later reader may take `kv-*` hooks for leftovers. The new guard only
   bans `kv:`/`--kv-`/`--vscode-`, and the result file records why `.kv-*` hooks stay.
7. Size: ~770 class edits in one pass. Commit per surface group (section 9) so an interruption
   resumes from the last commit; `lint` stays green at each.

## 8. Decisions (defaults)

1. One root: delete git-ui's `kv` Tailwind root; git-ui markup compiles in Space's root. Default yes.
2. Git-only tokens live in `packages/git-ui/src/theme/git.css`, imported by Space `styles.css`, not
   in shared `packages/theme` (Studio never mounts git-ui). Default yes.
3. Keep a separate graph type/row scale (`text-graph-*`, `graph-row*`) tied to Settings > Git graph
   font size; chrome uses `text-kira-*` and app control heights. Default yes (preserves P92 and the
   ARCHITECTURE "two font-size settings" split).
4. Keep unstyled `.kv-*` DOM hooks (test locators, JS delegation) unchanged; no CSS may target them
   except `git.css`'s slick rules. Default keep (renaming is ~55 locator edits for zero visual
   effect, outside the row's ask).
5. SlickGrid structural CSS moves from `CommitGrid.vue` `<style>` to `git.css` with `@apply`.
   Default yes.
6. Lane palette and PR-merged stay literal (no app hue); light/high-contrast overrides deleted
   (dead in-app). Default yes.
7. File tree indent becomes the app tree's `8 + depth * 14`. Default yes (visible delta, intended).
8. Add one UI assertion for graph font size reaching the grid. Default yes.
9. No `package.json`/`bun.lock` edit: git-ui keeps its `tailwindcss` devDependency (docker-ui
   precedent) and imports `@workbench/*` through the existing tsconfig path. Default yes (avoids the
   P251 lock overlap).
10. Inline link buttons become `Button variant="link"` with today's colour kept. Default yes.
11. Row/picker lists keep `rowVariants`; no `Command` conversion. Default yes.
12. Drop git-ui's duplicate `icons/codicon.css` (`base.css` already imports codicons). Default yes.

## 9. Commits

1. `feat(git-ui): app theme tokens for the git module` — `theme/git.css` (§2.1 items 1-2 only),
   `styles.css` import, `packages/theme/src/lib/utils.ts` registration, `check_font_scale` accepts
   `text-graph-*`. Nothing consumes it yet; both vocabularies coexist.
2. `refactor(git-ui): commit grid on app utilities` — `CommitGrid.vue` (style block to `git.css`
   §2.1 item 3), `columns.ts`, `refBadges.ts`, `badgeClass.ts`, `graph/palette.ts`, `rowSvg.ts`,
   `graphColumn.ts`, `theme/readTokens.ts`, `UncommittedChangesStrip.vue`, their unit tests.
3. `refactor(git-ui): detail pane, file tree and search on app utilities` — `CommitMeta.vue`
   (link buttons), `FileTree.vue` (indent), `fileTreeModel.ts`, `SearchResults.vue`,
   `searchHighlight.ts`, `linkify.ts`, `StashDetailPane.vue`, `StashRows.vue`, `StackList.vue`,
   `TagList.vue`, `ConflictBanner.vue`, `AppToolbar.vue` (`ViewToolbar`), `icons/setiFileIcon.ts`.
4. `refactor(git-ui): pickers and review on app utilities` — `BranchPicker.vue`, `review/*.vue`,
   `lib/rowVariants.ts`.
5. `refactor(git-ui)!: drop the kv Tailwind root and VS Code token layer` — `App.vue`, `main.ts`;
   delete `theme/tailwind.css`, `vscode-tokens.css`, `density.css`, `kira-structure.css`,
   `icons/codicon.css`, `lib/cn.ts`; guards (§2.5, all three scripts plus the new ban) in the same
   commit so lint stays green.
6. `refactor(theme)!: drop vscode-bridge.css` — delete it and its `base.css` import; comments in
   `base.css`, `shadcn-bridge.css`, `tailwind-core.css`, Space `state/settings.ts`,
   `state/settingsDomain.ts:41-42`, `internal/storage/model/settings.go:51`; extend the new ban to
   `packages/theme/src`.
7. `test(space): graph font size reaches the grid` — D8 assertion; any locator fix the end-of-phase
   run finds.
8. `test(space): regenerate git visual baselines` — only the §5 git PNGs whose diffs were reviewed.
9. `docs: git module on app theme` — ARCHITECTURE (§ Theme, Two-host plumbing, Two font-size
   settings, P229 paragraph, line 3059 caveat, delete the vscode-bridge/Monaco Known open item,
   lines 34-35 Styling and library-baseline rows), `SPEC.md` row Done plus result pointer, `plans/P245-result.md`
   (delivered, checks, baseline deltas, why `.kv-*` hooks stay).
