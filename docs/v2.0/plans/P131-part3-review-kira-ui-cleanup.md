# P131 Part 3 — review view onto shadcn-vue; kira-ui cleanup: plan

Plan for `docs/v2.0/SPEC.md`'s **P131 Part 3** row. Part 1's plan
(`P131-part1-foundation-and-dialogs.md`) §3 host plumbing, §4 call-site rules and §5 component map
are binding. Part 2's plan (`P131-part2-git-graph.md`) §4 call-site rules are binding too. This
document adds only what review and the kira-ui deletion need. Planned against the tree Part 2 left,
`147788d0`.

**Discovery method, disclosed.** Four `codegraph_explore` calls covered the review components,
kira-ui's public surface and its consumers, BaseSelector's popover and focus wiring, and the
tooltip/directive registration in `mount()`. CodeGraph's index belongs to the main checkout, which
sits at the same commit. `rg`/`Read` covered what CodeGraph does not index: CSS, shell scripts,
`package.json`, `knip.json`, `biome.json` and Playwright specs. `node_modules` is not installed in the
planning worktree. §10 lists each reka-ui point the implementer confirms against installed
`reka-ui` 2.10.5.

---

## 0. What the row left open, and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Row says "repoint review's imports of kira-ui's `cn`/`kuiRowVariants`/`contextMenuModel`" | Review imports only `kuiRowVariants` (ReviewView, BaseSelector). No review file imports kira-ui's `cn` or `contextMenuModel`. Both converted row sites also need `cn`, so each imports git-ui's `lib/cn.ts` and `lib/rowVariants.ts`. kira-ui's `cn.ts`, `rowVariants.ts` and `contextMenuModel.ts` then have no consumer outside kira-ui and are deleted. | §5, §7 commit 8 |
| Split Part 3 further? | No. One sequential implementer, no streams. | §2 |
| `KuiSegmented` (3 sites) | `ToggleGroup type="single" variant="outline" size="kira"`, as Part 2's BranchPicker and FileTree did. Each item gets the Part 2 §4.3 trio, a codicon span and, where a badge exists, `Badge variant="count"`. `@update:model-value` guards `null` (reka emits it on re-click of the active item). | §4.2 |
| `KuiSegmentedOption` type | Deleted with kira-ui. Each file declares its own local `interface` for its option list. Three small literal lists do not justify a shared type. | §5 |
| BaseSelector popover | `Popover modal` with `PopoverTrigger as-child`. reka owns focus trap, outside-click, Escape and focus return. `useModalFocus`, `onClickOutside`, the `rootEl` Escape listener and `rootEl` all go. None of them serves a need reka's modal Popover leaves open. | §5.2 |
| `v-kui-tooltip` on the comment anchor warning span, inside a repeated row | `data-kira-tip` plus one `AttributeTooltip` per list container (Part 2 §4.3 shape 2). The span is decorative text inside a repeated row. | §5.3 |
| `KuiTooltip` + `initTooltips()` in ReviewView | Removed. `MountRoot.vue`'s `TooltipProvider` already wraps the review root (Part 2 §3.5). | §5.1 |
| `vKuiTooltip` registration | Removed from `main.ts` once no review file uses the directive (commit 6). | §7 |
| `KuiColumnResizeHandle` | Stays, per the row. Consumers: `App.vue:19`, `CommitGrid.vue:19`, `apps/kira-studio/frontend/src/views/stream/StreamView.vue:2`. | §6 |
| `floatingPosition` | Stays, per the row. Only consumer: `packages/workbench/src/util/floatingPosition.ts`, which always passes `maxVarPrefix: '--kira-float-max-'`. kira-ui's own `DEFAULT_MAX_VAR_PREFIX = '--kui-float-max-'` and `FLOAT_MAX_WIDTH_VAR`/`FLOAT_MAX_HEIGHT_VAR` exports serve only the deleted `Kui*` components. `maxVarPrefix` becomes required; the default and both exports go. This removes the last `--kui-` string. | §6.2 |
| `ARCHITECTURE.md:55` says Studio no longer depends on `@kira/kira-ui` | Wrong today: `StreamView.vue` imports `KuiColumnResizeHandle`. Corrected in the docs commit. | §7 commit 11 |
| Font scale of shadcn controls in Space (Part 1 §4.3) | Unchanged. Review's shadcn controls follow Kira chrome, not `git.graphFontSize`. Recorded in ARCHITECTURE, where Parts 1 and 2 never wrote it down. | §7 commit 11 |
| Lint scripts after kira-ui's theme partial goes | `check-class-conflicts.ts` merges `kv:` through git-ui's `lib/cn.ts` and self-checks git-ui's `theme/tailwind.css` registrations. `check-tokens.sh`'s `kui-` layer becomes a "no `var(--kui-…)` anywhere" guard. `check-theme-classes.sh`'s 30 `check_kui_class` lines collapse to one guard against any `kui-*` class except `kui-column-resize-handle`. | §6.3 |

## 1. Confirmed current state

**Scope files:** the five `packages/git-ui/src/components/review/*.vue` files, plus `main.ts`.

| File | Kui* call sites (tags, directives, helpers) |
|---|---|
| `ReviewView.vue` | `KuiTooltip` 1 (`:799`), `KuiButton` 8 (boot retry `:813`, two row lists `:852,:869`, back `:895`, swap `:920`, filter toggle `:955`, stale Refresh `:1023`, load-more `:1065`, reveal-more `:1078`), `KuiSearchInput` 1 (`:843`), `KuiSegmented` 2 (`:944,:971`), `KuiTextInput` 1 (`:963`), `v-kui-tooltip` 4, `kuiRowVariants` 2, `initTooltips` (`:463-477,:495`), `KuiSegmentedOption` (`:609,:615`) |
| `ReviewCommentsPane.vue` | `KuiButton` 5 (`:76,:86,:97,:100,:141`), `v-kui-tooltip` 4 (`:81,:91,:138,:145`) |
| `BaseSelector.vue` | `KuiButton` 4 (`:118,:145,:158,:166`), `KuiPopoverPanel` 1 (`:130`), `KuiSearchInput` 1 (`:136`), `kuiRowVariants` 3, `useModalFocus` (`:64`) |
| `ReviewCommitRow.vue` | `KuiButton` 2 (`:252,:263`), `v-kui-tooltip` 2 |
| `ReviewFilesPane.vue` | `KuiSegmented` 1 (`:100`), `KuiSegmentedOption` (`:41`) |
| `main.ts` | `vKuiTooltip` import (`:2`) and `app.directive('kui-tooltip', …)` (`:110`); `./theme/kui-bridge.css` import (`:19`) |

No raw form control in review: `rg -n '<input|<select|<textarea|type="checkbox"' packages/git-ui/src/components/review`
finds only a comment.

**kira-ui today.** `src/` holds 12 `Kui*.vue` files, `cn.ts`, `contextMenuModel.ts`,
`floatingPosition.ts`, `index.ts`, `modalFocus.ts`, `optionTypes.ts`, `rowVariants.ts`,
`tooltip.ts`, `tooltip.test.ts` and `theme/tailwind-theme.css`. Consumers outside kira-ui, after
review converts:
- `KuiColumnResizeHandle`: `App.vue`, `CommitGrid.vue`, `StreamView.vue`. It imports only `vue`.
  Its one class, `kui-column-resize-handle`, is an unstyled hook: no CSS or selector reads it.
- `floatingPosition`: workbench's `util/floatingPosition.ts` (`autoUpdate`, `FloatOptions`,
  `computeFloatPosition`, `pointReference`, `ReferenceElement`). It imports only
  `@floating-ui/dom`.
- Nothing else. `--kui-*` appears only in kira-ui itself and the two bridges.

**kira-ui's footprint outside `src/`:**
- `packages/kira-ui/package.json`: `exports["./theme/tailwind-theme.css"]`; deps `@vueuse/core`,
  `class-variance-authority`, `clsx`, `tailwind-merge` serve only deleted modules. git-ui's
  `lib/cn.ts`/`lib/rowVariants.ts` resolve those three through the root `package.json`'s own
  dependencies (`:109-118`), not through kira-ui.
- `packages/git-ui/src/theme/tailwind.css`: `@source "../../../kira-ui/src"` (`:34`),
  `@import "@kira/kira-ui/theme/tailwind-theme.css"` (`:157`, comment `:152-156`), header comment
  `:5-6`, comment `:130`.
- `packages/git-ui/src/theme/kui-bridge.css`: imported by `main.ts:19` and
  `apps/kira-space-vscode/tests/interaction/support/commitMetaHarness.entry.ts:36`.
- `packages/theme/src/kui-bridge.css`: imported by `base.css:6` (comment `:4`, `:9`). Named in
  comments in `vscode-bridge.css` (`:7,:11,:47`) and `shadcn-bridge.css:2`.
- `scripts/check-class-conflicts.ts`: `cnKv` import (`:50`), `SCAN_DIRS` entry (`:61`), registration
  self-check (`:498`), comments (`:24,:33`).
- `scripts/check-tokens.sh`: `KIRA_UI_SRC` and the `kui-` layer (`:55,:69`), header (`:7-13`).
- `scripts/check-theme-classes.sh`: `check_kui_class` (`:76-103`) and its calls (`:475-508`);
  `_gu_ku_hits` and the kv font-scale pass exclude `${KIRA_UI_SRC}/cn.ts` (`:119,:324`);
  replacement strings naming `KuiSegmented.vue` (`:605,:622`).
- `biome.json:22` (`!packages/kira-ui/src/theme/tailwind-theme.css`).
- `knip.json:131-135` (kira-ui `entry: src/**/*.test.ts`).
- Root `package.json`: `test:unit` lists `packages/kira-ui/src`; `typecheck:git` runs kira-ui's
  `vue-tsc`.

**git-ui's own helpers still carry kui vocabulary.** `lib/cn.ts` registers `kui-control`,
`kui-control-sm`, `kui-icon-box` (spacing), `kui`, `kui-float` (radius), `kui-float` (shadow),
`kui-icon`, `kui-sm`, `kui-base` (text) and `kui-control-sm` (leading). Its doc comment names
`Kui*` and `tailwind-theme.css`. `lib/rowVariants.ts:32`, `lib/menuModel.ts`,
`components/rowMenuModel.ts:15-16` and `components/BranchPicker.vue:199-200` describe kira-ui in
comments. Part 2 left these for Part 3.

**Things the swap has to respect:**
- Webview specs read these review hooks. Every one is kept:
  - `button[aria-label="Open all changes"]` and `…"Open in graph"` (`review-interaction.spec.ts`);
  - `.kv-review-toolbar [aria-label^="Files"]`;
  - `data-testid` values `review-back-button`, `review-no-branch`, `review-branch-name`, `boot-retry`;
  - `.kv-review-load-more-button` (`review-commit-list-cap.spec.ts`), `.kv-review-view`
    (`webview-layout.spec.ts`);
  - `getByRole('button', { name: 'Flat view' })` (`file-tree-open.spec.ts:58`), which targets
    ReviewView's own list-mode toggle.
- Space's `repo-workspace.spec.ts:340` reads `review-no-branch` and `getByText('main', { exact: true })`.
- `floating-geometry.spec.ts:136-172` tests BaseSelector's popover through
  `[data-testid="base-selector-trigger"]` and `[role="dialog"][aria-label="Choose a comparison base"]`.
- `fakeReviewHost.ts` never answers `review.comment.list`. Live comment rows are unreachable in the
  sandbox without a scratch shim (§8).
- Part 2's result confirmed reka's single-mode `ToggleGroupItem` resolves as role `button` here:
  `branch-picker.spec.ts` and `file-tree-open.spec.ts` pass with `getByRole('button', …)`.

## 2. Split

**No further split, no streams.** Review is five files, about 45 call sites, all under rules Parts
1 and 2 already settled. The kira-ui deletion depends on every review conversion landing first, and
the lint and docs edits depend on the deletion. That is one order-dependent chain. Per-file commits
keep an interrupted run resumable from `git log` alone.

## 3. Rules reused, not re-derived

Prefix discipline is unchanged. shadcn tags take unprefixed classes only (lint-enforced). Plain
markup, including children inside a shadcn control, keeps `kv:`. Literal hook classes
(`kv-review-load-more-button`, `kv-review-toolbar`) are not utilities; they stay on either kind of
tag.

| Old | New | Source |
|---|---|---|
| `KuiButton variant="icon"` + `v-kui-tooltip` + `aria-label` | `TooltipIconButton icon="x" label="…"`; `icon` takes the codicon name without `codicon-` | Part 2 §4.1 |
| `KuiButton :active` | the above plus `:aria-pressed="…"` and `class="aria-pressed:bg-field aria-pressed:text-fg"` | Part 2 §4.1 |
| `KuiButton` with text | `Button variant="toolbar" size="kira"` | Part 2 §4.1 |
| row-shaped `KuiButton :class="[kuiRowVariants(), …]"` | `<button type="button" :class="cn(rowVariants(), '<kv: extras>')">`; `icon` prop becomes `<span class="codicon codicon-x" aria-hidden="true">` | Part 2 §4.2 |
| `KuiSearchInput` | `InputGroup variant="kira"` > `InputGroupAddon` (search codicon) + `InputGroupInput` + clear `InputGroupButton` in the trio | Part 2 §5.2 (BranchPicker) |
| `KuiTextInput` | `Input size="kira"` | Part 1 §5 |
| `KuiSegmented` | `ToggleGroup type="single" variant="outline" size="kira"`, trio per item | Part 2 §5.2, §5.6 |
| `KuiPopoverPanel` | `Popover modal` + `PopoverContent align="start"` | Part 2 §5.2 |
| `v-kui-tooltip` on decorative text in a repeated row | `data-kira-tip` + one `AttributeTooltip :container` per list | Part 2 §4.3 |
| a `ref` used for `.focus()` on a shadcn input | `useTemplateRef`, focus through `.$el` | Part 2 §4.1 |

Imports: `@theme/components/ui/<name>` for primitives, `@theme/components/TooltipIconButton.vue`,
`@theme/components/AttributeTooltip.vue`, `../../lib/cn.ts`, `../../lib/rowVariants.ts`.

## 4. Shared shapes in review

### 4.1 Tooltip trio

`Tooltip` > `TooltipTrigger as-child` > control, then `TooltipContent`. `MountRoot.vue`'s
`TooltipProvider` covers it.

### 4.2 ToggleGroup item

```vue
<ToggleGroup
  type="single"
  variant="outline"
  size="kira"
  :model-value="current"
  aria-label="…"
  @update:model-value="(v) => v && onChange(v as Kind)"
>
  <Tooltip v-for="o in options" :key="o.id">
    <TooltipTrigger as-child>
      <ToggleGroupItem :value="o.id" :aria-label="o.ariaLabel ?? o.label">
        <span :class="['codicon', o.icon]" aria-hidden="true" />
        <Badge v-if="o.badge !== undefined" variant="count">{{ o.badge }}</Badge>
      </ToggleGroupItem>
    </TooltipTrigger>
    <TooltipContent>{{ o.label }}</TooltipContent>
  </Tooltip>
</ToggleGroup>
```

Match whatever KuiSegmented rendered for each option: icon-only items keep icon-only, labelled ones
keep their label text. Read `KuiSegmented.vue` before deleting it and copy its per-option rendering
rule (icon, label, badge, `aria-label`) into the items.

## 5. Per-file map

### 5.1 `ReviewView.vue`

**Script.**
- Imports: drop the kira-ui block (`:33-49`) and its biome comment (`:34-40`). Add `Button`,
  `Input`, `InputGroup*`, `ToggleGroup*`, `Tooltip*`, `Badge`, `TooltipIconButton`, `cn`,
  `rowVariants`.
- Tooltips: delete `stopTooltips`/`initTooltips()` (`:461-477`) and `stopTooltips?.()` (`:495`).
- Toolbar filter focus (`:305-311`): replace `toolbarEl` plus `querySelector('.kv-review-toolbar-filter')`
  with `useTemplateRef('toolbarFilter')` on the `Input` and `toolbarFilter.value?.$el.focus()`. Keep
  whatever `nextTick` the current code awaits.
- Branch filter focus (`:529-548`): `branchFilterInputRef` becomes
  `useTemplateRef('branchFilter')` on the `InputGroupInput`; its watch focuses `.$el`. Delete the
  stale G21 D2 comment (`:541-544`).
- Option lists (`:609-618`): a local `interface ReviewToggleOption { id; icon; label; ariaLabel?; badge? }`.
  `panelOptions` keeps its computed badge counts. Pane items keep `aria-label` as
  `` `${label} (${badge})` ``, the string `[aria-label^="Files"]` matches today.
- `onPaneChange` (`:620`) is called behind §4.2's null guard.

**Template.**
- `<KuiTooltip />` (`:799`): delete.
- Boot retry (`:813-819`): `Button variant="dialog" size="kira" class="self-start"`. Keep
  `data-testid="boot-retry"`. Drop the kv overrides the variant now covers; keep any layout class
  under its unprefixed spelling.
- No-branch filter (`:843-848`): §3's `InputGroup`, `aria-label="Filter branches"`, bound to the same
  model.
- Branch and remote rows (`:852-876`): raw row buttons,
  `:class="cn(rowVariants(), 'kv:w-full kv:text-left')"`. Keep every `data-testid` and handler.
- Back (`:895-901`): `TooltipIconButton icon="chevron-left" label="Back to branch selection"
  data-testid="review-back-button"`.
- Swap (`:920-926`): `TooltipIconButton icon="arrow-swap" label="Swap branch and base"
  data-testid="review-swap-button"`.
- Toolbar div (`:941`): drop `ref="toolbarEl"`; keep class `kv-review-toolbar`.
- Pane switcher (`:944`): §4.2, `aria-label="Review pane"`.
- Filter toggle (`:955`): `TooltipIconButton icon="search" label="Filter files"
  :aria-pressed="filterVisible || filter.length > 0" class="aria-pressed:bg-field aria-pressed:text-fg"
  data-testid="review-filter-toggle"`.
- Filter input (`:963`): `Input size="kira" ref="toolbarFilter" class="flex-1 min-w-0"
  aria-label="Filter files"`. Class `kv-review-toolbar-filter` goes: its only reader was the
  `querySelector` above. Confirm with `rg -n kv-review-toolbar-filter packages apps` before deleting.
- List-mode switcher (`:971`): §4.2, `aria-label="File list display"`. Item labels stay
  "Tree view"/"Flat view" (`file-tree-open.spec.ts:58`).
- Stale-banner Refresh (`:1023`): `TooltipIconButton icon="refresh" label="Refresh"`, plus the
  banner's placement classes unprefixed (`ml-auto`, and `text-fg` if the banner's colour needs it).
- Load-more (`:1065`) and reveal-more (`:1078`): `Button variant="toolbar" size="kira"
  class="kv-review-load-more-button"`. Rewrite the comment at `:1073` to drop `KuiButton`.

### 5.2 `BaseSelector.vue`

```vue
<Popover modal :open="isOpen" @update:open="(o) => (o ? open() : close())">
  <PopoverTrigger as-child>
    <Button variant="toolbar" size="kira" class="max-w-full" data-testid="base-selector-trigger">…</Button>
  </PopoverTrigger>
  <PopoverContent
    align="start"
    class="w-70 p-0 gap-0"
    aria-label="Choose a comparison base"
    @open-auto-focus="onOpenAutoFocus"
  >
    <!-- InputGroup filter, Suggested and All-branches sections, raw row buttons -->
  </PopoverContent>
</Popover>
```

- `open()`/`close()` stay the component's own state functions. `pick()` keeps calling `close()`
  then emitting `select-base`.
- Trigger: drop `aria-haspopup`/`aria-expanded`; `PopoverTrigger` sets both.
- Content: `w-70` is 280px (`KuiPopoverPanel :width="280"`). Keep the inner `kv:max-h-80` scroll
  container as plain markup. Drop the inner `role="dialog"`: theme's `PopoverContent` has
  `inheritAttrs: false` and binds `$attrs` onto reka's content, which already renders
  `role="dialog"`. So `aria-label` lands on the dialog element and the spec selector still matches.
- `onOpenAutoFocus(e)`: `e.preventDefault()`, then focus the filter through
  `useTemplateRef('filter').value?.$el.focus()`.
- Close focus: reka returns focus to the trigger on close, which is what W17 asked of
  `useModalFocus`. No `@close-auto-focus` handler is needed unless §10 finds otherwise.
- Filter: §3's `InputGroup`, `aria-label="Filter branches"`.
- Rows: raw row buttons, `:class="cn(rowVariants(), 'kv:w-full')"`. Remote rows lead with
  `<span class="codicon codicon-cloud" aria-hidden="true">`.
- Delete `rootEl`, `useModalFocus`/`onModalKeydown`, `onClickOutside`, the Escape listener, and
  their comments (`:62-64` onward). reka's modal content covers focus trap, outside-click and
  Escape.
- Same commit: `floating-geometry.spec.ts`'s popover case (`:136-172`) is retitled "BaseSelector
  Popover shifts back on-screen near a horizontal viewport edge". Its selectors are unchanged. The
  file's doc comment (`:11-22`) now says every case runs on reka Popper.

### 5.3 `ReviewCommentsPane.vue`

- Copy for AI: `TooltipIconButton icon="copy" label="Copy for AI" class="ml-auto"`, same `v-if`,
  `:disabled` and `@click`.
- Clear all: `TooltipIconButton icon="clear-all" label="Clear all comments"
  :class="capabilities.clipboard ? '' : 'ml-auto'"`, same `v-if`, `:disabled` and `@click`.
- Confirm clear and Cancel: `Button variant="toolbar" size="kira"`.
- Anchor warning span (`:135-140`): replace `v-kui-tooltip` with `:data-kira-tip="anchorTitle(c)"`;
  keep `:aria-label`.
- Mount one `AttributeTooltip :container="listEl"`, with `listEl = useTemplateRef('list')` on the
  `role="listbox"` div. Put it as a sibling after the listbox, never inside it: a listbox may own
  only options.
- Delete comment (`:141-149`): `TooltipIconButton icon="trash" label="Delete comment" class="ml-auto"
  :disabled @click.stop`. It is a focusable control, so it takes the trio through
  `TooltipIconButton`, not `data-kira-tip`.

### 5.4 `ReviewCommitRow.vue`

- `:252`: `TooltipIconButton icon="diff-multiple" label="Open all changes"`.
- `:263`: `TooltipIconButton icon="git-commit" label="Open in graph"`.
- Both stay inside `.kv-review-row-actions`, with the same `@click.stop` handlers.
- Rewrite the comments at `:61-65` and `:259-262` so none names `KuiButton`.

### 5.5 `ReviewFilesPane.vue`

- `diffModeOptions`: a local option interface; icons `codicon-diff` (`ACTION_ICONS.diffSingle`) and
  `codicon-diff-multiple` (`ACTION_ICONS.diffMultiple`).
- `KuiSegmented` becomes §4.2 with `aria-label="What to compare"` and
  `@update:model-value="(v) => v && reviewFiles.setDiffMode(v as ReviewDiffMode)"`.

### 5.6 `main.ts`

Delete the `vKuiTooltip` import (`:2`), the directive registration and its comment (`:108-110`).
The `kui-bridge.css` import goes in commit 10. Rewrite the `:119` comment so it no longer names
`kira-ui/src` as a scanned `@source` (commit 8, when that `@source` goes).

## 6. kira-ui cleanup

### 6.1 Delete

From `packages/kira-ui/src`: `KuiButton.vue`, `KuiContextMenu.vue`, `KuiDialog.vue`,
`KuiIconBox.vue`, `KuiMenuList.vue`, `KuiPopoverPanel.vue`, `KuiSearchInput.vue`,
`KuiSegmented.vue`, `KuiSelect.vue`, `KuiTextInput.vue`, `KuiTooltip.vue`, `cn.ts`,
`contextMenuModel.ts`, `modalFocus.ts`, `optionTypes.ts`, `rowVariants.ts`, `tooltip.ts`,
`tooltip.test.ts`, `theme/tailwind-theme.css` (and the empty `theme/` directory).

Left: `KuiColumnResizeHandle.vue`, `floatingPosition.ts`, `index.ts`. Before deleting, run
`rg -n "<name>" packages apps scripts --glob '!packages/kira-ui/**'` for each exported symbol and
confirm zero hits outside comments.

### 6.2 Trim

- `index.ts`: exports `KuiColumnResizeHandle`, and `autoUpdate`, `computeFloatPosition`,
  `pointReference`, `FloatOptions`, `ReferenceElement`. Nothing else. Rewrite its doc comment.
- `floatingPosition.ts`: `FloatOptions.maxVarPrefix` becomes required. Delete
  `DEFAULT_MAX_VAR_PREFIX`, `FLOAT_MAX_WIDTH_VAR` and `FLOAT_MAX_HEIGHT_VAR`. Rewrite the doc
  comments that name `--kui-float-max-*` (`:20,:35,:43`). Workbench already passes the prefix; its
  own comment at `util/floatingPosition.ts:3-4` changes from "takes that prefix as an option" to
  "requires it".
- `package.json`: drop the `./theme/tailwind-theme.css` export and the `@vueuse/core`,
  `class-variance-authority`, `clsx`, `tailwind-merge` dependencies. Keep `vue` and
  `@floating-ui/dom`. Run `bun install` and commit the `bun.lock` change.
- `knip.json`: kira-ui's `entry` glob matches no file once `tooltip.test.ts` goes. Drop the
  `entry` line, keep `project`. Run `bun run lint:dead` to confirm knip accepts it.
- Root `package.json`: drop `packages/kira-ui/src` from `test:unit`: no test is left there. Keep kira-ui's `vue-tsc` in `typecheck:git`.
- `biome.json:22`: drop the `tailwind-theme.css` ignore.
- `packages/git-ui/src/theme/tailwind.css`: drop `@source "../../../kira-ui/src"` (`:34`). No
  surviving kira-ui file carries a utility class: `kui-column-resize-handle` is a literal hook. Drop
  the `@import` and its comment (`:152-157`). Fix the header comment (`:5-6`).

### 6.3 Lint scripts

- `check-class-conflicts.ts`:
  - `cnKv` imports from `../packages/git-ui/src/lib/cn`.
  - Drop `packages/kira-ui/src` from `SCAN_DIRS`.
  - Replace `checkRegistration('packages/kira-ui/src/theme/tailwind-theme.css', true, hits)` with
    `checkRegistration('packages/git-ui/src/theme/tailwind.css', true, hits)`. That file's
    `@theme inline reference` block defines git-ui's real custom names, and nothing self-checks
    them today.
  - Rewrite the comments at `:24,:33`.
  - This lands in commit 7, **before** the deletion. Any registration hit it reports is a real gap
    in git-ui's `lib/cn.ts`. Fix it in the same commit.
- `check-tokens.sh`: replace the `kui-` `check_layer` line with a zero-use guard. Fail if
  `grep -rnE --include='*.vue' --include='*.css' --include='*.ts' -- '--kui-' packages/git-ui/src packages/kira-ui/src packages/theme/src packages/workbench/src`
  finds anything. Drop `KIRA_UI_SRC` if nothing else reads it. Rewrite the header (`:7-13`).
- `check-theme-classes.sh`:
  - Replace `check_kui_class` and its 30 calls with one guard, `check_no_kui_class`. It uses the
    same attribute scope and comment exclusion. It fails on any `kui-[a-z-]+` token in a
    `class`/`:class` value except `kui-column-resize-handle`. Replacement text: "a shadcn-vue
    component from `@theme/components/ui`".
  - `_gu_ku_hits` and the kv font-scale pass exclude `${GIT_UI_SRC}/lib/cn.ts` instead of
    `${KIRA_UI_SRC}/cn.ts`. The reason is the same: tailwind-merge group names, not classes.
  - `:605,:622`: replacement text becomes `ToggleGroup (packages/theme/src/components/ui/toggle-group)`.
  - Keep `KIRA_UI_SRC` in the scan lists: `KuiColumnResizeHandle.vue` is still source.

### 6.4 git-ui helpers pruned

- `lib/cn.ts`: delete every `kui-*` registration listed in §1. None matches a name git-ui's
  `theme/tailwind.css` still defines once the kira-ui partial is gone. Rewrite the doc comment
  without `Kui*` or `tailwind-theme.css`. Re-run `bun scripts/check-class-conflicts.ts`: it must
  stay clean.
- Rewrite these comments so none describes kira-ui as current code: `lib/rowVariants.ts`
  (`:32` and the `kui-bridge.css` mention), `lib/menuModel.ts` (`KuiIconBox`),
  `components/rowMenuModel.ts:15-16` and `components/BranchPicker.vue:199-200`. A comment may still
  say a helper "replaced kira-ui's" as history.
  - `SearchResults.vue:44-52` stays. Its note is history-only, and §9 lists it.

### 6.5 Both `kui-bridge.css` copies

After commits 1-9, nothing reads `--kui-*` (§9 checks it). Delete:
- `packages/git-ui/src/theme/kui-bridge.css`. Also remove its import in `main.ts:16-19` (comment
  included) and in `commitMetaHarness.entry.ts:36`. Fix the `tailwind.css:130` comment.
- `packages/theme/src/kui-bridge.css`. Also remove its import and comment in `base.css:4-9`. Fix
  the comments in `vscode-bridge.css:7,11,47` and `shadcn-bridge.css:2`.

## 7. Steps and commits

Order is binding. Each commit passes the pre-commit hook. Run `bun run typecheck:git`, `bun run
lint` and `bun run build:vscode` per commit. Add `build:space` on commits 8 and 10, and
`build:studio` on commits 8 and 10: `StreamView.vue` and `packages/theme/src/base.css` sit on
Studio's path. The expensive suites run once, at §8.

1. `refactor(git-ui): review comments pane onto shadcn` (§5.3).
2. `refactor(git-ui): review commit row actions onto TooltipIconButton` (§5.4).
3. `refactor(git-ui): review files pane diff-mode onto ToggleGroup` (§5.5).
4. `refactor(git-ui): BaseSelector onto Popover and InputGroup` (§5.2 and `floating-geometry.spec.ts`).
5. `refactor(git-ui): ReviewView onto shadcn; drop KuiTooltip` (§5.1, plus any spec change §10
   forces).
6. `refactor(git-ui): drop the v-kui-tooltip directive` (§5.6).
7. `chore(lint): class-conflict check merges through git-ui's own cn` (§6.3 first bullet, plus any
   `lib/cn.ts` registration fix it surfaces).
8. `refactor(kira-ui)!: keep only KuiColumnResizeHandle and floatingPosition` (§6.1, §6.2,
   `check-theme-classes.sh` from §6.3, `main.ts:119` comment). Footer: `BREAKING CHANGE:
   @kira/kira-ui exports only KuiColumnResizeHandle and floatingPosition; maxVarPrefix is required.`
9. `refactor(git-ui): prune kui vocabulary from own helpers` (§6.4).
10. `refactor(theme): delete both kui-bridge.css copies` (§6.5 and `check-tokens.sh` from §6.3).
11. `docs: ARCHITECTURE records kira-ui reduced to two modules (P131 Part 3)`. It covers these:
    - the frontend-baseline row (`:35`): git-ui is fully on shadcn; the review sentence goes;
    - `:55`: Studio still imports `@kira/kira-ui`, for `KuiColumnResizeHandle` only;
    - `:1495`, `:2622` and the package-table row (`:3155`): kira-ui is `KuiColumnResizeHandle` plus
      `floatingPosition`, nothing else;
    - the Theme / two-host plumbing section (`:3586-3629`): no `kui-bridge.css`, no `--kui-*` layer;
    - Part 1 §4.3's font-scale rule: in Space, shadcn controls in git-ui follow Kira chrome, while
      grid and `kv:` text follow `git.graphFontSize`;
    - "Known open items" (`:4300`): delete any entry this part resolves; add none.
    - `apps/kira-space/README.md:191,244`: the same kira-ui description fix.
12. Follow-up `fix(…)` commits for whatever §8 finds, one per finding.
13. `docs(v2.0): P131 Part 3 result` in `SPEC.md`, with §9's audit and the whole-phase acceptance.

Commits 1-5 may leave review in a mixed state. The directive stays registered until commit 6, so
no intermediate tree loses a tooltip. Only commit 10's tree is verified.

## 8. Verification

Run once, after commit 10:

- `bun run typecheck` (all eight projects), `bun run lint`, `bun run lint:dead`, `bun run build:space`, `bun run build:vscode`, `bun run build:studio`.
- `bun run test:unit` (kira-ui path gone; git-ui's `lib/menuModel.test.ts` and `refBadges.test.ts` still run).
- `bun run test:webview`: every `interaction` and `layout` spec, `floating-geometry.spec.ts`,
  `review-interaction.spec.ts`, `review-commit-list-cap.spec.ts`, `review-target-race.spec.ts`,
  `file-tree-open.spec.ts` and `webview-layout.spec.ts` included.
- `bun run test:ui:space` (`repo-workspace.spec.ts`'s review and `repo-graph-lifecycle.spec.ts`'s
  `boot-retry` cases included).
- `bun run test:ui:studio` (`StreamView.vue`'s resize handle, and theme's `base.css` without the
  bridge).
- Built CSS carries no kui vocabulary: `rg -c -e '--kui-' <each build's emitted .css>` is 0 for
  Space, the webview and Studio.
- A failure in a file this part never touched still gets fixed, per CLAUDE.md. Confirm it predates
  the part (`git diff --stat 147788d0 -- <file>`), then fix it. A repeat of the known cross-file
  worker-contention timing flake (P117/P127/P128/P131 Parts 1-2/P133 results) is re-run in
  isolation (`--workers=1`, named tests only) before being called one, and the result section says
  so.

**Live, VS Code webview (sandbox form).**
- Serve the built webview through `apps/kira-space-vscode/tests/interaction/support/server.ts`,
  `/review` with `fakeReviewHost.ts`. Drive it with a scratch Playwright script outside the repo,
  never committed. Run it once under `body.vscode-dark` and once under `body.vscode-light`.
- Screenshot and check:
  - the no-branch state: filter, branch and remote rows, keyboard pick;
  - the review header: back and swap tips, the BaseSelector popover (filter autofocus, Suggested and
    All sections, remote cloud icon, Escape and outside-click close, focus back on the trigger);
  - the toolbar: pane switcher with badges, filter toggle pressed state, filter input focus on
    toggle, list-mode switcher;
  - the Commits pane: row action tips, load-more and reveal-more;
  - the Files pane: the diff-mode switcher and the delta status line;
  - the Comments pane: header buttons, confirm/cancel, and row tips. `fakeReviewHost.ts` never
    answers `review.comment.list`, so either add a scratch, uncommitted init-script shim that
    answers it with two comments (one `stale`, one `exact`), or state in the result that comment
    rows were not reached live.
  - the stale banner Refresh, if the fake host can emit a stale event; otherwise say so.
- Graph smoke check at `/graph`: toolbar, a ref-badge tip, BranchPicker open. This confirms the
  deletion did not reach the graph.
- Resolve `getComputedStyle` on a review toolbar `Button`'s `color` and the filter `Input`'s
  `background-color`. Each must match its `--kv-*` host value under `vscode-light`, not Kira's
  palette.
- Where a real VS Code install exists, repeat with `code --extensionDevelopmentPath=apps/kira-space-vscode`
  under a dark and a light theme. Otherwise say so plainly and leave that check to the user.

**Live, Kira Space.**
- Run `bun run dev:space` (or the `run` skill) against a real repository and open the review tab.
  Walk the same checklist in Space's `.dark` document, and a graph smoke check.
- Where no display exists, use the built test app through `apps/kira-space/tests/ui/fixtures.ts`'s
  `relaunch`, as Part 2 did. Drive it from a scratch Playwright script and take screenshots.
- Record which form ran.
- Check `Graph > Font size` at a non-default value. Review's `kv:` text resizes; its shadcn
  controls do not (Part 1 §4.3).

## 9. Closing audit

Report each row in the result section as a real check, with its command and result. `$REVIEW` is
`packages/git-ui/src/components/review`.

| Check | Command | Expect |
|---|---|---|
| Only `KuiColumnResizeHandle` imported from kira-ui, package-wide | `rg -n "@kira/kira-ui" packages/git-ui/src` | exactly 2 hits, `App.vue:19` and `CommitGrid.vue:19`, each `import { KuiColumnResizeHandle } from '@kira/kira-ui'` |
| kira-ui consumers repo-wide | `rg -n "from '@kira/kira-ui'" packages apps scripts --glob '!packages/kira-ui/**'` | the 2 above, `StreamView.vue:2`, and workbench's `util/floatingPosition.ts` |
| No kira-ui token left anywhere | `rg -nP "Kui(?!ColumnResizeHandle)[A-Z]\w*\|v-kui-tooltip\|vKuiTooltip\|data-kui-tip\|kuiRowVariants\|useModalFocus\|initTooltips\|KuiSegmentedOption\|contextMenuModel\|tailwind-theme\.css" packages apps scripts --glob '!docs/**'` | empty, or each hit a history-only comment naming no current code, listed in the result (expected: `SearchResults.vue:44-52` and the ones §6.4 keeps as history) |
| Review clean, comments included | `rg -n "kira-ui\|Kui\|kui" $REVIEW` | empty |
| No raw form control in review | `rg -n '<input\|<select\|<textarea\|type="checkbox"' $REVIEW` | no markup hit |
| kira-ui reduced | `ls packages/kira-ui/src` | exactly `KuiColumnResizeHandle.vue`, `floatingPosition.ts`, `index.ts` |
| Both bridges gone | `test ! -e packages/git-ui/src/theme/kui-bridge.css && test ! -e packages/theme/src/kui-bridge.css && rg -n "kui-bridge" packages apps scripts` | both absent; no hit |
| No `--kui-` token | `rg -n -e '--kui-' packages apps scripts` | empty |
| Directive gone | `rg -n "kui-tooltip\|vKuiTooltip" packages/git-ui/src` | empty |
| shadcn really used | `rg -l "@theme/components/(ui/(button\|tooltip\|popover\|toggle-group\|input-group\|input\|badge)\|TooltipIconButton\|AttributeTooltip)" $REVIEW` | all 5 review files |
| Popover really used | `rg -n "<Popover\b\|<PopoverContent" $REVIEW/BaseSelector.vue` | both present |
| Row helpers from git-ui | `rg -n "lib/(cn\|rowVariants)" $REVIEW` | ReviewView and BaseSelector |
| No wrapper layer | `rg -n "defineComponent" $REVIEW` and `rg -Pn "^<script>(?! setup)" $REVIEW` | empty |
| Lint | `bun run lint && bun run lint:dead` | green |
| Suites | §8 | all green |

## 10. Risks, and what the implementer confirms against installed `reka-ui` 2.10.5

- **Popover position near the viewport edge.** `floating-geometry.spec.ts`'s popover case asserts
  a shift back on-screen. reka's `PopoverContent` defaults `avoidCollisions` to on with a
  `sticky="partial"` shift. If the case fails, set `sticky="always"` on BaseSelector's
  `PopoverContent`; do not relax the assertion.
- **`aria-label` on `PopoverContent`.** Confirm in theme's `popover/PopoverContent.vue` that
  `$attrs` land on reka's `role="dialog"` element, not on the portal wrapper. If not, keep a
  labelled inner div and adjust the spec selector in commit 4.
- **`ToggleGroupItem` role.** Part 2's specs pass with role `button`. Confirm the review specs'
  `getByRole('button', { name: 'Flat view' })` and `[aria-label^="Files"]` still resolve after
  commit 5. If reka renders `radio`, change the selector, not the component.
- **`@open-auto-focus` timing.** If `.$el.focus()` runs before the portaled input mounts, wrap it
  in `nextTick`. Confirm with the live check.
- **Modal Popover and `pick()`.** A row click inside modal content must not count as outside
  interaction. It is inside `PopoverContent`, so it does not.
- **`check-class-conflicts` on git-ui's `tailwind.css`.** `themeTokenNames` reads
  `--<group>-<name>:` lines. If git-ui's `@theme inline reference` block uses a shape the regex
  misses, extend the regex in the same commit rather than dropping the self-check.

## 11. Acceptance

| SPEC row wording (Part 3) | Where met |
|---|---|
| "`components/review/*.vue` per Part 1 plan §4-§5" | §3 rule table, §5 per-file map |
| "`vKuiTooltip` registration removed from `packages/git-ui/src/main.ts`" | §5.6, commit 6; §9 "Directive gone" |
| "retarget every remaining `review/*.vue` import from kira-ui's copies onto git-ui's own `lib/` copies" | §0 row 1, §5.1, §5.2; §9 "Row helpers from git-ui" |
| "then delete kira-ui's now-unused originals (… `cn.ts`/the `kuiRowVariants` source …)" | §6.1 (`cn.ts`, `rowVariants.ts`, `contextMenuModel.ts`) |
| "Every kira-ui module left with no consumer deleted" | §6.1; §9 "kira-ui reduced" |
| "both `kui-bridge.css` copies included once unused" | §6.5, commit 10; §9 "Both bridges gone", "No `--kui-` token" |
| "kira-ui keeps `KuiColumnResizeHandle` and `floatingPosition`" | §6.1, §6.2; §9 "kira-ui consumers repo-wide" |
| "`check-class-conflicts.ts`/`check-tokens.sh`/`check-theme-classes.sh` … updated" | §6.3, commits 7, 8, 10 |
| "`docs/ARCHITECTURE.md` updated" | commit 11 |
| "re-verify the `lib/` file names and kira-ui's remaining consumers against Part 2's own result" | §1, checked against `147788d0` |

| Whole-phase acceptance (Part 1 row), package-wide | Where met |
|---|---|
| "no `Kui*` import left in `git-ui` except `KuiColumnResizeHandle`" | §9 rows 1 and 3 |
| "`test:ui:space`, `test:webview` and `test:unit` pass" | §8 (plus `test:ui:studio`, since `StreamView.vue` and `base.css` change) |
| "a live Kira Space run and a VS Code webview run of graph and review both show shadcn controls, each in its own host's theme" | §8 live checks: review in full plus a graph smoke check, webview under both theme kinds, `getComputedStyle` host-token check |
| "Delete each `Kui*` component left with no consumer" | §6.1 |
