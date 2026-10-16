# P256 plan: git module design audit

Ask (user): git module (`packages/git-ui`, hosted by Kira Space) still looks off next to the rest
of the app after P245. Answer: does git-ui use the same shadcn-vue elements, tokens, spacing,
density, radii, type and colours as Studio, `packages/workbench`, `packages/docker-ui`,
`packages/theme`? Then fix every real gap. No behaviour removed.

Base: `v2.0` at `23924abcb`. Ordered by user to run now, in parallel with P250/P252/P255 and
ahead of P253/P254. One sequential Sonnet implementer.

Method: `codegraph_explore` for git-ui theme/tokens, `TokenReader`, `MountRoot`, `ViewToolbar`,
`AppToolbar`, host mount (`RepoGraphView`); then greps over every git-ui `.vue`/`.ts` against
the same patterns in Studio/workbench/docker-ui; then real WebKit screenshots (Space `visual`
Playwright project, mocked git stream from `tests/visual/git-module.spec.ts`, fresh
`build:test:space`) beside the Studio visual baselines.

## 1. Verdict

Mostly yes. Primitives, button variants/sizes, icon sizes, menus, dialog shells and tokens match:

- Button: git-ui `size` kira-lg 43 / kira 34 / icon-sm 15; `variant` toolbar 28 / dialog 26 /
  dialog-primary 20. Studio+workbench+docker: same ranking (kira-lg 105, dialog 68, kira 64,
  toolbar 49). No non-app variant.
- `CodiconIcon` 13px dominant in both (57 of 62 vs 176 of 321).
- Row/context menus: `RowContextMenu` + `MenuSections` = workbench `ContextMenu` recipe
  (DropdownMenu, `min-w-45`, size-4 icon slot, 13px muted icon). Screenshot identical.
- Dialog shell: `DialogContent class="flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5"`,
  same as Studio's.
- Colours: only `--kira-*` via app utilities. `git.css` adds only graph scale, 8 lane hues and
  `git-merged` (no app equivalent; keep).

The "looks off" comes from six concrete gaps, all inside git-ui:

- G1 forms: 0 of 53 files use `Field*` (33 app files do). Dialog bodies are `gap-2 px-3 py-2` with
  raw `<label>`, `h3` headings and `<p class="text-error">` prose. App: `gap-3 p-3`, `Field`,
  `FieldLabel` (muted), `FieldDescription` (subtle, small), `FieldSet`/`FieldLegend` (uppercase
  subtle), `Alert` for warnings/errors.
- G2 detail file tree: bold folder names, no folder icon, hand-rolled chevron, colour-filter hack
  on status letters, hand-rolled focus outline. App trees (`RepoTreeRow`, Studio `TreeRow`):
  `TreeTwisty`, folder codicon, normal weight.
- G3 tone: git-ui never uses `text-subtle` (app: 157 uses). Tertiary text is `text-muted-foreground`
  or `opacity-60/80`.
- G4 one-off chips: solid `bg-info text-fg` pill, dashed-border chips, `bg-black/35` strip, all
  instead of `Badge`/`Alert`.
- G5 duplicates of shared parts: search toggle trio (= workbench `SearchOptionToggles`), toolbar
  separators (`bg-border`; Studio `bg-border-strong`), 3 hand-rolled focus outlines (= `focus-ring`).
- G6 mixed scale in popovers: picker rows are `text-kira-md` (`rowVariants` `menu`) but their
  secondary text is `text-graph-sm`. Identical at default settings; diverges once Settings > Git
  graph font size is set.

## 2. Corrections to the pre-measured facts

- Scoped `<style>`: 0. The one hit is the comment "deleted <style>" at `CommitMeta.vue:165`.
- `--kv-*` tokens: gone since P245. `theme/git.css` (102 lines) holds `--kira-graph-*`, `@theme`
  graph/lane/merged entries and SlickGrid rules; lint `check_no_kv_layer` bans `kv:`/`--kv-`.
- Raw `<button>`: 7 files (TagList, StashRows, BaseSelector, ReviewView, BranchPicker,
  UncommittedChangesStrip, StackList); CommitGrid's hit is a comment.
- git-ui still imports `@kira/kira-ui` `KuiColumnResizeHandle` (App.vue, CommitGrid.vue); Studio
  `StreamView.vue` uses it too, so it is shared vocabulary.

## 3. Inventory

Files: 53 `.vue` (App.vue 1990 lines, CommitGrid 1371, ReviewView 1109, BranchPicker 835,
FileTree 815, then 48 smaller), 1 CSS (`theme/git.css`), class-producing `.ts`: `lib/rowVariants.ts`,
`components/badgeClass.ts`, `refBadges.ts`, `columns.ts`, `graph/rowSvg.ts`, `graph/palette.ts`,
`linkify.ts`, `fileTreeModel.ts`.

Token comparison (git-ui vs `packages/theme`):

- Colours: same tokens. Gap G3 only.
- Radius: `rounded-kira-sm` 10, `rounded-full` 3 (dots), stock `rounded` 0 (P245 cleared it),
  one `rounded-[2px]` (= `--kira-radius-xs`).
- Type: chrome `text-kira-*`; data `text-graph-*` (P245 decision 3, keep). Gap G6.
- Spacing: Tailwind default scale; dialog body gap G1.
- Heights: chrome `h-control*`/`h-bar` = app. Rows `h-graph-row*` = 28px compact / 45px decorated
  at default (`--kira-row-height` 28 = app `h-row`).
- Hover/selected: `bg-hover`/`bg-select` = app trees. HEAD row adds 9% `--kira-focus` tint + 2px
  inset bar + semibold (git-only concept; D5).
- Focus: base `:focus-visible { focus-ring }` applies; G5 lists the hand-rolled copies.
- Scrollbars: inherit host rules; SlickGrid viewport `overflow-x-hidden`. No gap.
- Icons: `CodiconIcon` 13; seti file icons via mask, same helper Space's tree uses. No gap.

## 4. Screenshot findings

Shots (WebKit 1400x820, current `v2.0`): `P256-shots/detail.png`, `branch-picker.png`,
`search.png`, `repo-settings.png`. Compared with Studio baselines
`apps/kira-studio/tests/visual/*-snapshots/` (`workbench-shell`, `data-grid`, `script-dialog`) and
Space's own side panel in the same frame.

- V1 repo settings dialog (`repo-settings.png`): sections are bold `text-kira-lg` h3s, labels sit
  flush on inputs, no gap between sections, a 3-line informational note renders in error red,
  `Input type="number"` with UA spin box. Studio `script-dialog`: uppercase subtle legends, 12px
  gaps, muted labels, small subtle descriptions, `NumberStepperInput`.
- V2 stash dialog (`git-stash-dialog` baseline): "Include untracked files ( -u )" shows gaps inside
  the parentheses: the `Label` is `flex gap-1`, so "(", `<code>`, ")" become separate flex items.
  `<code>` has no `font-data`, so it falls to the UA monospace, not the app data font.
- V3 detail file tree (`detail.png`): folder rows bold with no folder icon; Space's explorer to the
  left uses a folder codicon and normal weight. Status letters boosted by `saturate-160
  contrast-115`.
- V4 detail meta: "3h·0202020" crammed (`gap-0.5` around the middot).
- V5 empty detail pane: "Select a commit to see its details." sits at the top; Studio `Empty`
  (connections sidebar) is vertically centred.
- V6 toolbar: separators are lighter than Studio's (`bg-border` #2b2b2b vs `bg-border-strong`
  #313131).
- V7 branch picker (`branch-picker.png`): matches app popovers except G6 secondary text and the
  dashed "checked out in" chip; force-delete confirm strip is `bg-black/35`, not an `Alert`.
- V8 search (`search.png`): toggle trio labels differ from the app's ("Match whole word" vs "Whole
  word", "Use regular expression" vs "Regular expression"); footers/empty lines muted, app uses
  subtle for this copy.
- V9 row context menu, push menu: no mismatch.
- V10 commit grid: no column headers (Studio grids have them) and HEAD tint beside selection reads
  as two blue bands. Both deliberate git designs: D5, D6.

## 5. Per-item disposition

Raw `<button>`:

- `TagList:99`, `StashRows:99`, `BranchPicker:680,736`, `BaseSelector:148,162,171`,
  `ReviewView:814,832`: keep. List/menu rows built from `rowVariants`; `Button` imposes control
  height and padding a row must not have (P245 decision 11, same as Space `GitPanel` rows).
- `BranchPicker:702`, `StackList:121` PR badge: keep `<button>`; class already from
  `badgeVariants` via `prBadgeClass`.
- `UncommittedChangesStrip:133`: keep (full-width graph row); replace its focus triplet (G5).

Native elements: no `<input>`, `<select>`, `<textarea>`, `<dialog>`, `<table>`. Keep:
`ForcePushDialog:133` `<details>/<summary>` (disclosure, no shadcn primitive in theme; add
`text-kira-md` only if needed). Replace: native `<label>` in BranchDialog 1, ForcePushDialog 1,
RenameRefDialog 1, RepoSettingsDialog 4, ResetDialog 1, StackDialog 1, StashDialog 3, TagDialog 2,
WorktreeDialog 5 with `Field` + `FieldLabel` (keep `for`/`id`). `<code>` in 17 files: add
`font-data` (Studio precedent).

Hand-rolled primitives:

- Toolbar separators (`AppToolbar` 3x `span.w-px h-3.5 bg-border`): `Separator
  orientation="vertical" class="h-3.5 self-center mx-0.5 bg-border-strong"`.
- Search toggles (`SearchBox` 3x `TooltipIconButton`): workbench `SearchOptionToggles`
  (`testid-prefix="search-toggle-"`, `match-case-test-id="search-toggle-case"`; testids unchanged).
- Tree chevron (`FileTree:600,708`): workbench `TreeTwisty` (`:has-children="true"`,
  `@toggle` = existing directory toggle). `ReviewCommitRow:220` chevron: same.
- Force-delete strip (`BranchPicker:717`): `Alert variant="warn"` holding text and both buttons.
- Origin pill (`StashRows`, `bg-info text-fg`): `Badge variant="info"`. Dashed chips
  (`BranchPicker:695`, `SearchResults:104,116`): `Badge` default.
- Dropdowns, popovers, tooltips, tabs, scroll areas: all already shadcn or none hand-rolled.

Hard-coded values:

- `refBadges.ts:33` `max-w-[190px]` -> `max-w-47.5`.
- `refBadges.ts:191` `shadow-[0_0_0_1px_var(--kira-focus)]` -> `ring-1 ring-focus`.
- `columns.ts:245` `rounded-[2px]` -> `rounded-kira-xs`.
- `App.vue:1830` `w-[min(320px,90vw)]` -> `w-80 max-w-[90vw]` (dialog pattern).
- Keep, named reason: `max-w-[90vw]` (14 dialogs; Studio uses the same); `grid-rows-[0_1fr]`,
  `grid-rows-[var(--kira-graph-h-xs)_1fr]`, `grid-cols-[max-content_1fr]` (grid templates, no
  scale step); `min-h-[min(220px,60%)]` (clamp); `max-h-[min(520px,var(--reka-popover-…))]`
  (reka runtime var); `[clip-path:inset(-2px_0)]` (graph SVG overdraw); `min-w-[1ch]` (status
  letter column); `icons/setiFileIcon.ts` hexes (seti brand palette, shared with Space).
- `App.vue:1826` overlay `bg-black/35` -> `bg-black/10` (= `DialogOverlay`; D4).

Overrides and tone:

- Focus triplets `outline-1 outline-focus -outline-offset-1`: `FileTree:265`,
  `UncommittedChangesStrip:136`, `ReviewCommitRow:199` -> `focus-visible:focus-ring`
  (FileTree keeps its `group-focus-within:` scoping with `group-focus-within:focus-ring`).
  `rowVariants` base `focus-visible:outline-none`: keep (rows paint focus via `bg-hover`/the
  container ring), unchanged.
- `RefreshButton:82` `disabled:opacity-70`: drop (Button's 50).
- `opacity-60/80` text: `StackList:112,131`, `WorktreeList:133-138`, `StashRows:119`,
  `StashDetailPane:78`, `TagList` unannotated tag icon -> `text-subtle`.
- Empty-state and footer copy -> `text-subtle` (token comment: captions, empty-state copy):
  SearchResults 69,123,128,133,138,141,146; BranchPicker "No branches"/"No remote branches";
  BaseSelector 183; FileTree directory "N files" count. Metadata (author, date, track, reason)
  stays `text-muted-foreground`.
- `FileTree` status letter: drop `saturate-160 contrast-115`.
- `CommitMeta:331` facts row `gap-0.5` -> `gap-1`.
- Empty detail (`App.vue` both detail regions, `DetailPane` loading state): `Empty` gets `h-full` so it
  centres like Studio's.
- `git.css`: no override duplicates a shared token. SlickGrid rules stay (P245; DOM built by
  SlickGrid, no template). Keep all.
- `RefSectionHeader`: keep (same recipe as workbench `PanelHeader`).
- `KuiColumnResizeHandle` (detail pane, grid columns): keep. Px widths persisted in view state
  (v8) and three breakpoints; shadcn `Resizable` is percent-based. Studio `StreamView` uses it too.

## 6. Commit groups (one sequential Sonnet implementer)

Fast checks per commit (`bun run typecheck`, lint, Space build). Expensive suites once, step 6.

1. `refactor(git-ui): dialog forms on Field primitives` — all 14 `components/dialogs/*.vue` plus
   `PreflightPrediction.vue`. Body `flex min-h-0 flex-col gap-3 overflow-auto p-3`. Each
   label/control pair -> `Field` + `FieldLabel`. Checkbox/radio lines -> `Field
   orientation="horizontal"` with the label text in one inline span (fixes V2). Validation lines
   -> `FieldError`. Explanatory prose under a control -> `FieldDescription`. Consequence warnings
   (StashDialog partial stash, RepoSettings auto-stash note, Reset/ForcePush data-loss lines) ->
   `Alert variant="warn"`; operation failures -> `Alert variant="destructive"` (SaveRequestDialog
   precedent). RepoSettingsDialog: `h3` sections -> `FieldSet` + `FieldLegend`; page size ->
   `@theme/NumberStepperInput.vue` (same min/max/validation). `<code>` -> `<code
   class="font-data">`. Keep every testid, `role="alert"`, `aria-invalid`, `for`/`id`.
2. `refactor(git-ui): detail tree and meta match the app tree` — FileTree (both modes):
   `TreeTwisty`, folder `CodiconIcon` `folder`/`folder-opened` 16px muted (RepoTreeRow recipe),
   folder name normal weight, status-letter filters dropped, focus ring, counts tone.
   ReviewCommitRow chevron + focus. CommitMeta gap. Empty centring (App.vue, DetailPane).
3. `refactor(git-ui): toolbar and search on shared workbench parts` — AppToolbar `Separator`;
   SearchBox `SearchOptionToggles`; RefreshButton opacity.
4. `refactor(git-ui): chips, notices and secondary text on app primitives` — StashRows `Badge`,
   dashed chips `Badge`, force-delete `Alert`, opacity/subtle tone sweep, popover secondary text
   `text-graph-sm` -> `text-kira-sm` in BranchPicker, BaseSelector, SearchResults, ReviewView
   branch list (D1), arbitrary values (refBadges, columns, App overlay width and colour).
5. `chore(lint): guard git-ui against raw labels and focus triplets` — extend
   `scripts/check-theme-classes.sh` (or the git-ui section P245 added) to fail on `<label` and
   `outline-focus` under `packages/git-ui/src`. Skip if the script has no per-package hook that
   fits; say so in the result.
6. `test(space): git visual baselines and UI specs` — `git-module.spec.ts`: add
   `git module: repository settings dialog (P256)` (`git-repo-settings-dialog.png`) and
   `git module: branch picker (P256)` (`git-branch-picker.png`); re-record `git-graph.png`
   (separators), `git-graph-detail.png` (tree, meta), `git-stash-dialog.png` (Field layout). Run
   `bun run test:visual:space` once, inspect every diff is one this plan names, then update
   only this spec: `bun run build:test:space && playwright test
   --config=apps/kira-space/playwright.config.ts --project=visual git-module --update-snapshots`.
   Never `test:visual:update:space` (it re-records P255's `ade-workflow-graph` too). Studio visual: untouched (no `packages/theme`/workbench edits); run
   `test:visual:studio` once only if step 3 touched workbench. UI: run Space `ui` project
   repo-* specs (`repo-branch-picker`, `repo-commit-detail`, `repo-commit-meta`, `repo-file-tree`,
   `repo-floating-geometry`, `repo-graph-*`, `repo-review-interaction`, `repo-workspace`) then the
   full `test:ui:space` once; fix fallout in follow-up commits. Unit: `bun test
   packages/git-ui/src`. New behaviour: none, so no new flow/UI pair (CLAUDE.md split applies to
   features).
7. `docs: P256 result` — `plans/P256-result.md`, SPEC row Done + result section, ARCHITECTURE
   "Two font-size settings" (picker lists move to chrome, D1) and "Git module follows the app
   look" (forms on `Field`, tree twisty/folder icon). ARCHITECTURE is P250's file: rebase first.

Machine: one heavy process at a time (`DEV_ENVIRONMENT.md` "Run one heavy suite at a time").
Visual baselines are recorded in this container (P227/P229/P245 precedent).

## 7. File ownership and concurrency

P256 owns:

- `packages/git-ui/src/**` (`.vue`, class-producing `.ts`; `theme/git.css` read-only unless a
  finding needs it).
- `apps/kira-space/tests/visual/git-module.spec.ts` and its `-snapshots/` (3 re-recorded, 2 new).
- `scripts/check-theme-classes.sh` (step 5 only).
- `docs/v2.2/plans/P256-*`, P256 row/result in `docs/v2.2/SPEC.md`, the two ARCHITECTURE
  paragraphs above.

Not touched: `packages/theme`, `packages/workbench` (imported only), `packages/kira-ui`,
Space `repo/*` host code.

Overlap check:

- P252 (`packages/docker-ui`, docker Go/UI specs): zero overlap.
- P255 (ADE v2 workflow editor, `apps/kira-space/frontend/src/ade/v2/**` + its specs): zero
  overlap. Both re-record Space visual baselines: P256 touches only `git-module.spec.ts*`,
  P255 only `ade-workflow-graph.spec.ts*`. `ade/v2/review/AdeReviewFiles.vue` imports git-ui; P256 changes no git-ui export or
  prop, so it is unaffected.
- P250 (`tests/**`, contract fixtures, ARCHITECTURE/DEV_ENVIRONMENT): its branch already edits
  `apps/kira-space/tests/ui/repo-workspace.spec.ts`, `tests/ui/support/*`, `tests/contract/git-*`.
  P256 edits none of those unless step 6 fallout forces a `repo-workspace.spec.ts` fix: rebase on
  P250 first, then edit. ARCHITECTURE: P250 may rewrite; P256's edit is two paragraphs, rebase
  before step 7. If P250 lands git visual baselines, re-record after rebasing, never merge PNGs.

## 8. Deferred decisions (defaults)

- D1 picker popovers (BranchPicker, BaseSelector, SearchResults, review branch list) on the chrome
  scale `text-kira-*`, overriding P245's "picker lists read text-graph-*". Default yes: a popover
  is chrome, and its primary text already is. No change at default settings.
- D2 folder rows: normal weight plus folder icon, like Space's explorer. Default yes (visible).
- D3 consequence warnings in dialogs move from red text to `Alert variant="warn"`. Default yes
  (visible: red prose becomes an amber notice box).
- D4 narrow-width detail overlay scrim `bg-black/35` -> `bg-black/10` (DialogOverlay). Default yes.
- D5 HEAD row tint + inset bar + semibold: keep (git-only "you are here" cue). Default keep.
- D6 grid column headers: none added. Default keep (git log convention; space for graph).
- D7 search toggle labels adopt the app's ("Whole word", "Regular expression"). Default yes.
- D8 Added-file colour: git-ui green (`text-ok`), Space explorer amber for both M and A. Default
  keep (git diff convention; explorer shows working-tree state, different meaning).
