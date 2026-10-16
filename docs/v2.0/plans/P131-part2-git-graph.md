# P131 Part 2 — git graph onto shadcn-vue: plan

Plan for `docs/v2.0/SPEC.md`'s **P131 Part 2** row. Builds on Part 1's plan
(`P131-part1-foundation-and-dialogs.md`): its §3 host plumbing, §4 call-site rules and §5 component
map are binding here and not re-derived. This document refines §5 where the graph's own files need
it (§0) and adds Part 2's own work. Planned against the tree Part 1 left, chapter branch
`claude/unfinished-phases-ru3wo4` at `c92bf687`.

**Discovery method, disclosed.** CodeGraph was not available to this planning pass: `ToolSearch`
for `codegraph` returned no tool, and the MCP server reported `ENOENT: codegraph not found in
$PATH` (same failure the orchestrating session hit). No `codegraph_explore` call was made. Every
symbol, caller and blast-radius question below was answered with `rg`/`Grep`/`Read` over the
source instead: every kira-ui call site and template in the 26 in-scope files, plus the scripts
around each non-trivial one (BranchPicker, SearchBox, SearchResults, AppToolbar, FileTree,
refBadges, App's force-delete and tooltip wiring), `packages/kira-ui/src/*`, `packages/theme/src/
components/**`, `packages/workbench/src/components/{AttributeTooltip,TooltipAnchorBridge,
ContextMenu,SearchOptionToggles}.vue`, `scripts/check-*`, `biome.json`, `knip.json`, every
`apps/kira-space-vscode/tests/interaction/*.spec.ts` and `apps/kira-space/tests/ui/*.spec.ts`
selector touching git-ui. `node_modules` was not installed in the planning worktree, so reka-ui
behaviour is cited from its documented Radix-parity semantics; §10 lists each point the
implementer confirms against the installed `reka-ui` 2.10.5.

---

## 0. What the row left open, and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Split Part 2 further? | No. One sequential implementer, no streams. | §2 |
| Row's gate "no kira-ui import except `KuiColumnResizeHandle`" vs Part 1 §5 putting `cn`, `kuiRowVariants` and the menu model's move in Part 3 | Part 2 needs those helpers after its swap (8 in-scope files import them), so the gate cannot pass unless they move now. Part 2 **creates** git-ui's own copies under `packages/git-ui/src/lib/` and repoints every in-scope file. kira-ui's originals stay: review files and kira-ui's own components still import them. Part 3 repoints review and deletes the originals. **Deviation from Part 1 §5's "Part" column; Part 3's row wording needs a matching edit (orchestrator's call).** | §3.3 |
| Row-shaped `KuiButton :class="[kuiRowVariants(), …]"` (BranchPicker, TagList, StashRows) | Plain `<button type="button">` carrying git-ui's `rowVariants()`, not shadcn `Button`. A list row is not a button primitive. Studio precedent: `views/shared/SavedListMenu.vue:80`, `document/DocumentRow.vue:53`, `FilterHistoryMenu.vue:170` all render list rows as raw `<button>` with utilities. Both hosts now run preflight, so a raw button needs no reset. **Interpretation call.** | §4.2 |
| Pressed-state buttons (`KuiButton :active`, 5 sites) | `TooltipIconButton` + `:aria-pressed` + `class="aria-pressed:bg-field aria-pressed:text-fg"`. Follows Studio's `SearchOptionToggles.vue` (TooltipIconButton plus a pressed class) and Part 1 §5 ("`active` becomes `aria-pressed`"). Styling keys off the attribute, so state has one source. Not `Toggle`: no git-ui or Studio call site uses it. | §4.1 |
| `v-kui-tooltip` on decorative text inside repeated list rows | `data-kira-tip` on the element, read by one hoisted `AttributeTooltip` per list container. Controls keep the Part 1 §5 trio. Requirements named in §4.3: nested row+span tips need innermost-wins, and FileTree's 500-row cap makes a Tooltip root per span a real mount cost. **Deviation from Part 1 §5's `v-kui-tooltip` row, and an extension of P104 §6.6's "exception". Interpretation call; the user can narrow it.** | §4.3 |
| AttributeTooltip is pointer-only; kira-ui's controller also opened on keyboard focus | Add `focusin`/`focusout` to the hoisted `AttributeTooltip`, opening through the bridge's `onOpen()`/`onClose()` like reka's own `TooltipTrigger` does on focus. Its own commit. Studio's header cells are not focusable, so Studio behaviour is unchanged. | §3.2 |
| Badge font size | `check_font_scale` rejects `text-(length:…)` in unprefixed git-ui markup (`scripts/check-theme-classes.sh:273`). The graph scale has no unprefixed utility. `.kv-badge { font-size: var(--kv-t-md) }` stays CSS (the `kv_css` pass allows `var(--kv-t-md)`). Every other badge declaration moves onto `badgeVariants`. | §5.1 |
| Badge spacing | Adopt `badgeVariants`' own `gap-1`/`px-1`/`rounded-kira-sm`. Deltas: gap 3px to 4px, padding 5px to 4px; radius unchanged (4px both hosts). Override only what must track the graph scale or the kind colours. **Visible 1px changes, disclosed.** | §5.1 |
| Stack "stale" badge text colour | Today `.kv-badge`'s unlayered `color` beats the badge's own layered `kv:text-stack-stale-fg`, so the intended stale colour never applied. Once colour moves into one merged class list, the stale badge shows `--kv-stack-stale-fg`. **Visible change, disclosed as a latent bug fixed.** | §5.1 |
| `badgeVariants` for `bun test` | New `packages/theme/src/components/ui/badge/variants.ts`, re-exported from `badge/index.ts` (Part 1 §5). | §3.1 |
| AttributeTooltip's `TooltipContent` shape type | Inlined into `AttributeTooltip.vue`. `packages/workbench/src/state/tooltip.ts` is deleted: its only importer moves, and `toPlainText` has zero callers (`rg -n toPlainText apps packages`). | §3.2 |
| `TooltipProvider` "wrapping both roots in `mount()`" | New `packages/git-ui/src/MountRoot.vue` (`<script setup>`), created by `mount()` with the chosen root. No inline render-function component (CLAUDE.md's `<script setup>` rule). | §3.5 |
| KuiSegmented's `kui-segmented-badge` test id | Renamed `picker-tab-badge` (Part 1 §5: "renamed"). | §5.2 |
| Search dropdown and search error (hand-positioned via `computeFloatPosition`) | One non-modal `Popover` in `SearchBox.vue`, anchored to the search row, showing whichever of the two applies (they are mutually exclusive: results need `compiled.kind === 'ok'`, the error needs it failed). Dismissal is wired explicitly so the two-stage Escape and input focus survive. | §5.3 |
| BranchPicker popover modality | `Popover modal`. `KuiPopoverPanel` was already modal in effect (full-viewport backdrop, `SearchBox.vue:87-96`'s own description). reka's modal content suppresses focus-outside dismissal. Without that, `WorktreeList`'s remove `Dialog`, opened inside the panel, would close the panel on focus move. | §5.2 |
| Force-delete popup | `Popover` anchored to a point span. It gains outside-click and Escape dismissal it did not have. Open auto-focus lands on **Cancel**, never on the destructive button. **Behaviour change, disclosed.** | §5.5 |
| `app-shell.css` checkbox rule | After FileTree's two checkboxes move to `Checkbox`, no raw checkbox is left in `packages/git-ui/src`. Review has none (`rg -n 'type="checkbox"' packages/git-ui/src/components/review` finds only a comment). The rule goes. The file then holds only comments, so the file, its `main.ts` import and the now-unused `kv-mount-root` class go too. | §5.6 |
| `kui-floating-geometry.spec.ts` | Renamed `floating-geometry.spec.ts`. Tooltip and context-menu cases move onto reka surfaces Part 2 owns (FileTree, rendered in review). The `BaseSelector` popover case stays on `KuiPopoverPanel` until Part 3 converts `BaseSelector.vue`. | §6 |
| One touch per file (P104 §9) | Held for every component. One exception, plumbing: `main.ts` (provider in commit 5, `app-shell.css` import removal in commit 12, when the last raw checkbox goes). `CommitGrid.vue`'s `.kv-badge` CSS goes in commit 14, after every other badge emitter has moved onto the shared class, so no emitter loses its geometry mid-chain. | §7 |
| Font scale of shadcn controls in Space | Unchanged from Part 1 §4.3: controls follow Kira chrome, grid and `kv:` text follow `git.graphFontSize`. Ref badges stay on the graph scale (height and font size read `--kv-*`). | §4 |

## 1. Confirmed current state

**Scope files** (`packages/git-ui/src`, non-dialog, non-review): `App.vue`, 23 of the 30
`components/*.vue` files, `components/refBadges.ts` and `components/rowMenuModel.ts` (26 files).
The other 7 `.vue` files carry no kira-ui token and no raw form control: `DetailPane`,
`WorkingDetailPane`, `RefSectionHeader`, `EmptyRepositoryPanel`, `GitBlockedPanel`,
`ConnectionBanner` and `StashList`. Confirm with §9's gate commands. Part 1 left all 26
untouched: none imports `@theme/*` yet (`rg -l "@theme/" <the 26 files> packages/git-ui/src/main.ts`
is empty).

**Real template usages**, comments excluded (`^\s*<Kui…` tag lines, `v-kui-tooltip=` attributes):

| Kind | Count | Files |
|---|---|---|
| `KuiButton` | 56 | App 4, AppToolbar 9, BranchPicker 6, CommitMeta 2, ConflictBanner 4, FileTree 2, GlobalStashList 1, LoadMoreButton 2, NoRepositoryPanel 2, PullStrategyPicker 2, RefreshButton 1, RowActionsButton 1, SearchBox 4, SearchResults 1, ShowMoreButton 1, StackList 4, StashRows 1, TagList 1, UndoButton 2, WorktreeList 6 |
| `v-kui-tooltip` | 68 | AppToolbar 8, BranchPicker 4, CommitMeta 4, FileTree 16, GlobalStashList 1, LoadMoreButton 1, PullStrategyPicker 1, RefreshButton 1, RowActionsButton 1, SearchBox 4, StackList 9, StashDetailPane 1, StashRows 5, TagList 1, UncommittedChangesStrip 1, UndoButton 2, WorktreeList 8 |
| `data-kui-tip` | 3 | `refBadges.ts:198,239,303` |
| `KuiPopoverPanel` / `KuiMenuList` | 3 / 2 | AppToolbar, PullStrategyPicker (both); BranchPicker (panel only) |
| `KuiContextMenu` | 3 | RowContextMenu 1, FileTree 2 |
| `KuiSearchInput` / `KuiSegmented` / `KuiSelect` | 3 / 2 / 2 | SearchBox, BranchPicker, FileTree / BranchPicker, FileTree / SearchBox, FileTree |
| `KuiDialog` / `KuiTextInput` / `KuiTooltip` | 1 / 1 / 1 | WorktreeList / BranchPicker / App |
| `KuiColumnResizeHandle` (stays) | 4 | App 1, CommitGrid 3 (`:1275,1284,1294`) |
| raw checkbox | 2 | FileTree `:571,694` |
| `computeFloatPosition` | 3 | App `:973` (force-delete), SearchBox `:108` (error), SearchResults `:60` (listbox) |

**Non-component kira-ui imports in scope**: `kuiRowVariants` (TagList, StashRows, BranchPicker,
FileTree, SearchResults), kv `cn` (FileTree, SearchResults), `MenuItem`/`MenuSection` (rowMenuModel,
StashRows, PullStrategyPicker, AppToolbar, BranchPicker), `enabledNeighbour`/`firstEnabled`
(BranchPicker), `KuiSegmentedOption`/`KuiSelectOption` types (BranchPicker, FileTree, SearchBox),
`initTooltips`/`pointReference`/`computeFloatPosition` (App, SearchBox, SearchResults).

**Things the swap has to respect:**
- `RowContextMenu.vue` has 8 git-ui consumers, `review/ReviewCommitRow.vue` among them. Its props/
  emits API stays byte-identical, so review needs no edit in Part 2.
- `commitMetaHarness.entry.ts` mounts `DetailPane.vue` (CommitMeta + FileTree) through a bare
  `createApp`, outside `mount()`. It needs its own `TooltipProvider` once those files use reka
  Tooltip (reka's tooltip root throws without a provider).
- `review/*` renders `FileTree.vue` and `RowContextMenu.vue`. So the review root needs the
  `TooltipProvider` in Part 2 already, not Part 3.
- `App.vue:1644`'s `onClickOutside(overlayDetailRegionEl)` closes the overlay drawer on any click
  outside it. Menus and tooltips now portal to `body`, so a click inside a menu opened from the
  drawer would count as outside. It must ignore reka popper content (§5.5).
- `BranchPicker.vue` queries rows, the rename input and focus targets through `rootEl` (`:243,
  :465`) and closes on `onClickOutside(rootEl)` (`:559`) and a `rootEl` Escape listener (`:355`).
  A portaled `PopoverContent` is no longer inside `rootEl`.
- `SearchBox.vue:233`'s `onClickOutside(rootEl)` has the same portal problem.
- Space's `test:ui:space` reads `[data-testid="search-input"] input`
  (`repo-workspace.spec.ts:1225`) and `graph-collapse-toggle`'s `aria-pressed`
  (`:1182-1203`). The webview suite reads `.kv-branch-trigger`, `.kv-branch-tabs
  [data-testid="kui-segmented-badge"]`, `getByRole('dialog')` after opening the picker,
  `getByRole('button', { name: /^Stashes/ })`, `input[aria-label="Filter branches"]`
  (`branch-picker.spec.ts`), `getByRole('button', { name: 'Flat view' })`
  (`file-tree-open.spec.ts:58`), `input[type="checkbox"]` with `:indeterminate`
  (`review-interaction.spec.ts:129-140`), `getByRole('menu')` (`graph-context-menu-refresh.spec.ts:51`,
  `kui-floating-geometry.spec.ts:110`), `.kv-badge-tag`/`.kv-badge-icon` computed colours
  (`graph-columns.spec.ts:593-610`).
- After Part 2, `KuiContextMenu`, `KuiMenuList`, `KuiSelect` and `KuiDialog` have no consumer.
  They stay in kira-ui until Part 3's deletion pass. knip does not flag them: `@kira/kira-ui`'s
  index is a package entry.

## 2. Split

**No further split.** Part 1 split because plumbing had to land before any component moved. Graph
and review were each "a full pass on their own" (Part 1 §2). Part 2 is that graph pass. It is
larger than Part 1's component work: about 1.5-2 times the call sites, under an already-settled
map. It carries no new plumbing design. Three pieces are not plain swaps: badges plus grid
tooltip, the menus, and the two popovers. Each gets its own subsection and commit. The chain is
order-dependent: foundation commits 1-6 precede every consumer. Per-file commits keep an
interrupted run resumable from `git log` alone. Nothing in the evidence shows the work exceeds one
Sonnet pass.

**No stream split.** After the foundation lands, the consumer commits touch disjoint files. But
the webview and Space suites and the live check must run over the combined tree anyway. Several
spec files are shared across would-be streams (`branch-picker.spec.ts` covers BranchPicker and its
lists). The only gain would be wall-clock. CLAUDE.md defaults to one sequential implementer
without a real independence case.

## 3. Foundation (commits 1-6)

### 3.1 `badgeVariants` in a `.vue`-free module

- New `packages/theme/src/components/ui/badge/variants.ts` holds `badgeVariants` and
  `BadgeVariants`, moved verbatim from `badge/index.ts:11-31`.
- `badge/index.ts` keeps `export { default as Badge }` and adds
  `export { badgeVariants, type BadgeVariants } from './variants'`. Every existing importer is
  unchanged.
- Why: `refBadges.ts` (a `bun test` target through `refBadges.test.ts`) must import it without
  pulling `Badge.vue` into bun.

### 3.2 Hoist `AttributeTooltip` into `packages/theme`

- `git mv packages/workbench/src/components/AttributeTooltip.vue packages/theme/src/components/AttributeTooltip.vue`.
- `git mv packages/workbench/src/components/TooltipAnchorBridge.vue packages/theme/src/components/TooltipAnchorBridge.vue`.
- In `AttributeTooltip.vue`, replace `import type { TooltipContent as TooltipContentShape } from
  '../state/tooltip'` with a local `interface TipParts { title: string; meta?: string; metaColor?:
  string; body?: string }`. The same fields, moved verbatim.
- Delete `packages/workbench/src/state/tooltip.ts`. Confirm first: `rg -n "state/tooltip'"
  apps packages` shows only the moved file, and `rg -n "toPlainText\(" apps packages` shows only
  the definition.
- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:12` imports
  `@theme/components/AttributeTooltip.vue`. Fix the path in its own comment at `:451-453`.
- Pure move, no behaviour change. Commit 2.

**Focus support, commit 3** (`feat(theme): AttributeTooltip opens on keyboard focus too`):
- Add `useEventListener(containerRef, 'focusin', …)`: resolve `closest('[data-kira-tip]')` from the
  event target. On a hit, call `enter(el)` then `bridge.value?.onOpen()`, which skips the delay the
  way reka's `TooltipTrigger` does on focus.
- Add `focusout`: call `leave()` when the related target is outside the hovered element.
- Why: git-ui's StashRows rows and FileTree checkboxes are focusable and showed their tips on
  focus under kira-ui's controller (`kui-floating-geometry.spec.ts:67` opens one with `focus()`).
- Studio's header cells take no focus, so Studio is unaffected. `test:ui:studio`'s
  `tooltips.spec.ts` stays the guard.

### 3.3 git-ui's own helpers (`packages/git-ui/src/lib/`)

All created in commit 4, each consumer repointed in its own file commit (one touch per file):

| New file | Content | Replaces |
|---|---|---|
| `lib/cn.ts` | `cn` (kv-prefixed `extendTailwindMerge`), copied verbatim from `packages/kira-ui/src/cn.ts`, config included. Part 3 prunes the `kui-*` names once kira-ui is gone. | `cn` from `@kira/kira-ui` |
| `lib/rowVariants.ts` | `rowVariants` cva, retokened from `kuiRowVariants` onto git-ui's own `@theme` names: `kv:min-h-kui-control`→`kv:min-h-control`, `kv:rounded-kui`→`kv:rounded-sm`, `kv:text-kui-fg`→`kv:text-fg`, `kv:text-kui-base`→`kv:text-base`, `kv:hover:bg-kui-hover`/`kv:focus-visible:bg-kui-hover`→`…bg-hover`, `kv:bg-kui-selected`→`kv:bg-selected`, `kv:text-kui-selected-fg`→`kv:text-selected-fg`, `kv:text-kui-fg-muted`→`kv:text-muted-foreground`, `kv:text-kui-danger-fg`→`kv:text-diff-deleted`. Every pair resolves to the same `--kv-*` value through `theme/kui-bridge.css:20-40` and `theme/tailwind.css:44-126`, so the output is pixel-identical. | `kuiRowVariants` |
| `lib/menuModel.ts` | `MenuItem`, `MenuSection`, `flattenItems`, `enabledNeighbour`, `firstEnabled`, copied verbatim from `packages/kira-ui/src/contextMenuModel.ts` | the same names from `@kira/kira-ui` |
| `lib/menuModel.test.ts` | `git mv packages/kira-ui/src/contextMenuModel.test.ts packages/git-ui/src/lib/menuModel.test.ts`, import repointed. The test follows the surviving copy. kira-ui's original loses its test for one part, then Part 3 deletes it. Not duplicated: CLAUDE.md's "when torn between two similar tests, delete". | — |

`KuiSegmentedOption`/`KuiSelectOption` go away with their components. Callers inline the option
shape as a local type or a literal array.

`components/rowMenuModel.ts` switches its type import to `../lib/menuModel.ts` in commit 4 (a
type-only change). Its comment at `:15` and `:139` naming kira-ui is rewritten.

`scripts/check-class-conflicts.ts:50` keeps importing kira-ui's `cn`. The configs are identical,
so the merge result is the same. Part 3 repoints it when kira-ui's copy goes.

### 3.4 Shared ref-badge class

New `packages/git-ui/src/components/badgeClass.ts`, `.vue`-free, created in commit 4:

```ts
import { badgeVariants } from '@theme/components/ui/badge/variants';
import { cn } from '@theme/lib/utils';

// Graph-scale height and the kind-colour border; font size stays in CommitGrid.vue's `.kv-badge`
// rule (check_font_scale rejects an arbitrary text size on unprefixed markup).
export const REF_BADGE_CLASS = cn(
  badgeVariants({ variant: 'chip' }),
  'kv-badge h-(--kv-h-xs) leading-(--kv-h-xs) border-2 border-transparent font-[inherit] text-(color:--kv-badge-fg) appearance-none m-0',
);

export function refBadgeClass(...extra: string[]): string {
  return cn(REF_BADGE_CLASS, ...extra);
}
```

- Emitters: `refBadges.ts` (grid and CommitMeta refs), plus StackList, BranchPicker and CommitMeta
  template badges.
- Theme `cn` here, not git-ui's: every token is unprefixed.
- Both unprefixed roots scan `packages/git-ui/src`, so the arbitrary utilities compile in both
  hosts: Space via `apps/kira-space/frontend/src/styles.css`, the webview via
  `apps/kira-space-vscode/src/webview/tailwind.css`.
- The kind classes stay as they are (`kv-badge-local`/`-remote`/`-tag`/`-stash`/`-overflow`/
  `-pr--*`/`-branch--stacked`/`-branch--stale`/`-dashed`/`-current`/`-lane-tinted`). They are
  unlayered CSS, so their `border-color` beats `border-transparent`. That keeps
  `graph-columns.spec.ts`'s transparent-background, coloured-border assertion true.

### 3.5 `TooltipProvider` around both roots

New `packages/git-ui/src/MountRoot.vue`:

```vue
<script setup lang="ts">
import { TooltipProvider } from '@theme/components/ui/tooltip';
import type { Component } from 'vue';

defineProps<{ root: Component; rootProps: Record<string, unknown> }>();
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300" disable-hoverable-content>
    <component :is="root" v-bind="rootProps" />
  </TooltipProvider>
</template>
```

- `main.ts`'s `mount()` becomes `createApp(MountRoot, { root: view === 'review' ? ReviewView :
  AppRoot, rootProps: … })`, with the same prop objects as today.
- `app.provide(GRAPH_VISIBLE_KEY, …)` and the `vKuiTooltip` registration stay. Review still uses
  the directive until Part 3.
- The values match both apps' own `App.vue` providers
  (`apps/kira-studio/frontend/src/App.vue:106`, `apps/kira-space/frontend/src/App.vue:64`).
- `commitMetaHarness.entry.ts` wraps its `h(DetailPaneVue, …)` in `h(TooltipProvider, { …same
  props }, () => …)` in the same commit. It is a test harness, not a component, so the render
  function is fine there.

### 3.6 Menus on `DropdownMenu`

**New `components/MenuSections.vue`.** It renders a `MenuSection[]` as `DropdownMenuItem`s. It is
a model renderer, not a wrapper around a shadcn component: the same role `KuiMenuList` held for
three consumers (`RowContextMenu`, AppToolbar's push menu, PullStrategyPicker).
- Props: `sections`, optional `title`.
- Emit: `select(id)`.
- `title`: a `DropdownMenuLabel` first line.
- A `DropdownMenuSeparator` goes between sections.
- Per item: `DropdownMenuItem` with `:disabled`, `:variant="item.danger ? 'destructive' :
  'default'"` and `:data-testid="item.id"`. Keep the test id: `pull-strategy-*`/
  `force-push-trigger` ids flow through it.
- Item body:
  - a `size-4` icon box holding `<span :class="['codicon', item.icon]" aria-hidden="true">` when
    `icon` is set, empty otherwise, so labels align (KuiMenuList's G34 D9 rule);
  - the label, plus `item.detail` as a muted second line (`text-kira-sm text-muted-foreground`);
  - when `disabledReason` is set, an `sr-only` span with an id wired through `aria-describedby`.
- `@select` emits `select(item.id)`.

**`RowContextMenu.vue` rewritten on the P104 §5.2 point-anchored pattern**
(`packages/workbench/src/components/ContextMenu.vue`), public API unchanged:
- A local `open` ref starts `true`, since consumers mount it with `v-if`.
- `<DropdownMenu :open="open" @update:open="onOpenChange">`. On `false`: emit `close`.
- `<DropdownMenuTrigger as-child>` wraps a `fixed size-0` span at `(x, y)`, `aria-hidden`.
- `<DropdownMenuContent align="start" :side-offset="0" class="min-w-45 max-w-80"
  :aria-label="title ?? label">`. reka's collision handling flips it above the point when there is
  no room below, which is KuiContextMenu's `flip: true`.
- Focus return: capture `document.activeElement` in `onMounted` (the invoker, as KuiContextMenu
  did). On `@close-auto-focus`, `preventDefault()` and focus the invoker. Without this, reka would
  focus the 0×0 span. W20's "focus lands somewhere real" relies on the invoker.
- `MenuSections` goes inside, with `@select="(id) => emit('select', id)"`.

## 4. Call-site rules added for Part 2

These are on top of Part 1 §4. Prefix discipline is unchanged: shadcn tags take unprefixed classes
only (lint-enforced); plain markup, including children inside a shadcn control, keeps its existing
`kv:` classes.

### 4.1 Buttons

| Old | New |
|---|---|
| `KuiButton` default, with text | `Button variant="toolbar" size="kira"`; `icon="codicon-x"` becomes a leading `<CodiconIcon name="x" />` (`@theme/CodiconIcon.vue`, 13px default) |
| `KuiButton variant="danger"` | `Button variant="danger" size="kira"` |
| `KuiButton variant="primary"` (only WorktreeList's dialog) | `Button variant="dialog-primary" size="kira-lg"` (dialog map, Part 1 §5) |
| `KuiButton variant="icon"` + `v-kui-tooltip` + `aria-label` | `TooltipIconButton icon="x" label="…"` (`@theme/components/TooltipIconButton.vue`; `data-testid`/`@click`/`:disabled` fall through) |
| icon button whose tooltip explains its disabled state | `TooltipIconButton … disabled-trigger` (only AppToolbar's `remote-cancel`) |
| `KuiButton :active` / `:aria-pressed` | `TooltipIconButton … :aria-pressed="x" class="aria-pressed:bg-field aria-pressed:text-fg"` |
| `KuiButton` that looks like a link (CommitMeta "Show more/less", FileTree "Show all N files", ShowMoreButton) | `Button variant="link" size="kira"` + `text-focus` (CommitMeta, FileTree) or `text-muted-foreground` (ShowMoreButton), plus `h-auto`/`p-0`/`justify-start` as the old layout needs |
| icon button with extra children (RefreshButton's pending dot) | the trio by hand: `Tooltip` > `TooltipTrigger as-child` > `Button variant="toolbar" size="kira-icon" aria-label` |
| a `ref` used for `.focus()` (`BranchPicker` trigger) | `useTemplateRef` on the `Button`, focus through `.$el` (Button renders a single `Primitive` root) |

Classes that were `kv:`-prefixed on a `KuiButton` move to their unprefixed spelling on the
`Button`, for example `kv:max-w-50` to `max-w-50`. Split-button corners use `rounded-r-none` and
`rounded-l-none border-l-0 px-0.5`. Never `rounded-*-sm`: `check_alias` bans it.

### 4.2 Rows

- A row-main `KuiButton` becomes `<button type="button" :class="cn(rowVariants(), '<its existing
  kv: extras>')">`, with git-ui's own `cn`/`rowVariants`.
- A row button's `icon` prop becomes an explicit `<span class="codicon codicon-x"
  aria-hidden="true">` first child.
- `.kv-branch-row-main` stays: `onRowsKeydown` clicks it on Enter.

### 4.3 Tooltips

Two shapes, chosen by what carries the tip:

1. **A focusable control** (button, trigger, checkbox outside a row, toggle item, input-group
   button): the Part 1 §5 trio (`Tooltip` > `TooltipTrigger as-child` > control + `TooltipContent`),
   or `TooltipIconButton` for an icon button. Multi-line text keeps its newlines through
   `class="whitespace-pre-line"` on `TooltipContent` (UncommittedChangesStrip's dirty-path list).
2. **Decorative text inside a repeated row**, and SlickGrid DOM: a `data-kira-tip="…"` attribute,
   read by one `AttributeTooltip` (`@theme/components/AttributeTooltip.vue`) mounted per list
   container:

   | Container | Owner | Covers |
   |---|---|---|
   | grid host (`ref="host"`) | CommitGrid | ref and PR badges in cells |
   | refs `dd` (`decorationEl`) | CommitMeta | ref badges in the detail pane |
   | tree/list element (`treeEl`) | FileTree | every per-row tip, the review checkbox included |
   | rows scroll element (`rowsScrollEl`) | BranchPicker | row tips in its own rows and in TagList, StashRows, StackList, WorktreeList, GlobalStashList (all render inside it) |

Why shape 2 exists (the requirement no per-element Tooltip meets):
- **Innermost wins.** StashRows puts a tip on the row div *and* on spans inside it. Pointer events
  bubble, so nested reka triggers open both tooltips at once. `closest('[data-kira-tip]')` picks the
  innermost one, which is what kira-ui's delegated controller did.
- **Mount cost at the cap.** FileTree renders up to `FILE_TREE_ROW_CAP = 500` rows with 2-5 tips
  each. A reka Tooltip is about 7 component instances (root, popper root, trigger, popper anchor,
  primitive, content, portal). That is roughly 15,000 extra instances per max-size list, against
  zero today. Estimate, not measured: no plausible per-instance cost changes the call.
- **Parity.** These tips were hover-only on non-focusable spans. Focusable rows and checkboxes
  still get focus tips through §3.2's `focusin` support.

Rows capped at 50 per section (BranchPicker's lists) would survive per-element Tooltips. But they
still carry innermost-wins nesting (StashRows), so they use shape 2 too, for one rule per list.

### 4.4 Portals

- Floating content (menus, popovers, tooltips) now portals to `body`. Any DOM query or
  outside-click check that assumed the panel sat inside a component's own root must change.
- Query through a template ref on an element *inside* the portaled content, never through the
  `PopoverContent` component's `$el`: theme's `PopoverContent` has `inheritAttrs: false` and a
  portal root.
- Outside-click logic that must tolerate portaled content ignores `[data-reka-popper-content-wrapper]`.
  Confirm the attribute name in the installed reka (§10).

## 5. Per-file map

"Trio" is §4.3 shape 1; "tip-attr" is shape 2. Button mappings follow §4.1.

| File | Kui* / raw → replacement | Notes |
|---|---|---|
| `RowActionsButton.vue` | icon `KuiButton` + tip → `TooltipIconButton icon="ellipsis" label="More actions"` | drop the `:8-9` comment about kira-ui |
| `ShowMoreButton.vue` | `KuiButton` → `Button variant="link" size="kira" class="w-full justify-start px-2 py-0.5 h-auto text-muted-foreground"` | |
| `LoadMoreButton.vue` | 2 `KuiButton` → toolbar `Button`; the first keeps its trio tip; Cancel gets `class="underline"` | |
| `RefreshButton.vue` | icon `KuiButton` → hand trio (§4.1) with `<CodiconIcon name="refresh" :class="{ 'animate-spin': isRefreshing }" />` plus the dot span; `class="relative disabled:opacity-70"` | the `[&_.codicon]` descendant-variant workaround goes, since the icon is now a direct child |
| `UndoButton.vue` | 2 `KuiButton` → toolbar `Button` + trio each; the SHA button gets `class="font-data text-kira-sm text-muted-foreground cursor-copy"` | |
| `ConflictBanner.vue` | 3 default → toolbar; Abort → `danger` | keep `:aria-describedby` |
| `NoRepositoryPanel.vue` | candidate `KuiButton` → `Button variant="toolbar" size="kira" class="w-full justify-start truncate"`; Retry → toolbar | keep `data-testid`s |
| `GlobalStashList.vue` | icon `KuiButton` → `TooltipIconButton icon="add" label="Save to global stash…"` | |
| `TagList.vue` | row-main `KuiButton` → row `<button>` (§4.2); annotation span tip → tip-attr | `RowContextMenu` usage unchanged |
| `StashRows.vue` | row-main → row `<button>` with the archive codicon span; the row div's tip and 4 span tips → tip-attr; `MenuSection` type from `../lib/menuModel.ts` | |
| `StackList.vue` | Restack → toolbar; 3 icon buttons → `TooltipIconButton` (`list-tree`/`close`); 6 span/badge tips → tip-attr; stale badge → `:class="refBadgeClass('bg-(--kv-stack-stale-bg) text-(color:--kv-stack-stale-fg)')"`; PR button/span → `:class="[REF_BADGE_CLASS, 'kv-badge-pr', `kv-badge-pr--${row.pr.state}`]"` | `kv-badge-pill` is dropped (§5.1) |
| `WorktreeList.vue` | Create → toolbar; 3 icon buttons → `TooltipIconButton` (`arrow-swap`/`empty-window`/`trash`); 5 span tips → tip-attr; `KuiDialog` → Part 1 §6.1 `Dialog` shell; raw `<input>` → `Input size="kira" v-model="typedToken" aria-label="Confirmation token"`; buttons → `dialog-primary`/`dialog`, `kira-lg` | the dialog opens inside BranchPicker's modal popover (§5.2) |
| `PullStrategyPicker.vue` | main `KuiButton` → toolbar + trio, `rounded-r-none`; chevron → `DropdownMenuTrigger as-child` over `Button` (`aria-label`, `data-testid="pull-strategy-trigger"` kept); `KuiPopoverPanel`+`KuiMenuList` → `DropdownMenuContent align="start" class="w-65" aria-label="Pull strategy"` + `MenuSections` | drop `rootEl`, `menuListRef`, `toggle`/`nextTick` focus code; `isOpen` becomes `v-model:open` |
| `AppToolbar.vue` | Fetch, Stash → toolbar + trio; Push + chevron → as PullStrategyPicker (`align="end" class="w-40" aria-label="Push options"`); collapse toggle → `TooltipIconButton icon="list-tree" label="Collapse other branches" :aria-pressed="collapseBranches"` + pressed class; search → same with `icon="search"`, `:aria-pressed="searchOpen"`; settings → `TooltipIconButton icon="gear"`; remote-cancel → `TooltipIconButton icon="close" :label="cancellable ? 'Cancel' : cancelDisabledReason" disabled-trigger`; worktree-prepare-cancel → `TooltipIconButton icon="close" label="Cancel"` | drop `pushMenuListRef`/`focusFirst`; keep every `data-testid` |
| `SearchBox.vue` + `SearchResults.vue` | §5.3 | |
| `BranchPicker.vue` | §5.2 | |
| `FileTree.vue` | §5.6 | |
| `CommitMeta.vue` | open-all → `TooltipIconButton icon="diff-multiple" label="Open all changes"`; date span, SHA button, PR icon button → trio; Show more/less → link `Button` with `text-focus`; template PR badge → `REF_BADGE_CLASS` + kind classes; `<AttributeTooltip :container="decorationEl" />` | §5.1 |
| `StashDetailPane.vue` | date span tip → trio | |
| `UncommittedChangesStrip.vue` | label span tip → trio, `TooltipContent class="whitespace-pre-line"` | the strip stays a native `<button>` (a row, §4.2) |
| `refBadges.ts` + `CommitGrid.vue` | §5.1 | |
| `rowMenuModel.ts` | type import → `../lib/menuModel.ts` (commit 4) | |
| `RowContextMenu.vue` | §3.6 | |
| `App.vue` | §5.5 | |

### 5.1 Ref badges and the grid tooltip

**`refBadges.ts`:**
- `buildBadgeElement` sets `badge.className = [REF_BADGE_CLASS, spec.colorClass,
  …modifiers].join(' ')`, keeping `kv-badge-dashed`, `-lane-tinted`, `kv-lane-N`,
  `-branch--stacked`/`--stale` and `-current`. A plain join, not `cn`: every added token is a CSS
  hook with no utility conflict, and this runs once per badge per rendered row.
- `buildOverflowBadge` and `buildPrBadge` do the same.
- `data-kui-tip` becomes `data-kira-tip`, 3 places. Rewrite the `:191-198` comment: the badge is
  now read by `AttributeTooltip`, not kira-ui's controller.
- Drop the `kv-badge-${spec.shape}` token. Drop `BadgeSpec.shape` if nothing else reads it: check
  with `rg -n "\.shape\b" packages/git-ui/src`.
- `bun test packages/git-ui/src/components/refBadges.test.ts` must still load. It pulls
  `badgeClass.ts`, which pulls `@theme/components/ui/badge/variants` and `@theme/lib/utils` through
  `packages/git-ui/tsconfig.json`'s `@theme/*` path. That confirms Part 1 §3.3's open "`bun test`
  resolves `@theme`" question.

**`CommitGrid.vue` template:** add `<AttributeTooltip :container="host" />` as a child of the
`.kv-commit-grid` root, a sibling of `host`, never inside it. SlickGrid's `init()` empties `host`.

**`CommitGrid.vue` `<style>`:**
- Delete from `.kv-badge` everything except `font-size: var(--kv-t-md)`: display, gap, padding,
  height, line-height, white-space, color, border, box-sizing, appearance, font-family, margin.
- Delete `.kv-badge-pill, .kv-badge-square`: the radius now comes from `badgeVariants`.
- Keep `.kv-ref-badges`, `.kv-badge-icon`, `.kv-badge-label`, every kind rule, `button.kv-badge-pr`,
  `.kv-badge-current(-glyph)`, `.kv-badge-dashed` and the eight lane rules.
- Rewrite the P7/P72/P92 comments above `.kv-badge` so they describe the split: shape from
  `badgeVariants`, graph-scale font size here.

**`CommitMeta.vue`:** its `dd` badges come from `buildRefBadges`. Its own template PR badge takes
`REF_BADGE_CLASS`. Its `AttributeTooltip` covers the `dd`.

### 5.2 `BranchPicker.vue`

**Structure:**

```
<Popover v-model:open="isOpen" modal>          ← @update:open(false) runs close()
  <Tooltip><TooltipTrigger as-child><PopoverTrigger as-child>
    <Button ref="triggerEl" variant="toolbar" size="kira" class="kv-branch-trigger max-w-50">…</Button>
  </PopoverTrigger></TooltipTrigger><TooltipContent>…</TooltipContent></Tooltip>
  <PopoverContent align="start" class="w-95 p-0 gap-0" :aria-label="`${TAB_LABELS[activeTab]} picker`"
                  @open-auto-focus="onOpenAutoFocus" @close-auto-focus="onCloseAutoFocus">
    <div ref="panelEl" class="kv:flex kv:flex-col kv:min-h-0 kv:max-h-[min(520px,var(--reka-popover-content-available-height))]">
      ToggleGroup / InputGroup / rows (rowsScrollEl) / AttributeTooltip :container="rowsScrollEl"
    </div>
  </PopoverContent>
</Popover>
```

**The panel:**
- Drop the inner div's `role="dialog"` and `aria-label`. reka's `PopoverContent` already carries
  `role="dialog"`, and the label moves onto it. Otherwise `branch-picker.spec.ts:30`'s
  `getByRole('dialog')` sees two dialogs and fails strict mode.
- `w-95` is 380px, the old `:width`. The `--kui-float-max-*` arbitrary values go; reka's
  `--reka-popover-content-available-height` replaces them. That is rung 4, a runtime value.
- **Modal.** This matches `KuiPopoverPanel`'s full-viewport backdrop. More importantly, reka's modal
  content prevents focus-outside dismissal, so `WorktreeList`'s remove `Dialog` and the row
  `DropdownMenu` (both portaled, both higher layers) do not close the panel under them.
- Delete `onClickOutside(rootEl)` (`:559`) and the `rootEl` Escape listener (`:355`). reka owns both
  now. `close()`'s resets (refMenu, renaming, forceDeleteCandidate, filter, capSteps) run from
  `@update:open(false)`.

**Tabs:**
- `KuiSegmented` becomes `ToggleGroup type="single" variant="outline" size="kira" class="kv-branch-tabs
  mx-1 mt-1" aria-label="Picker section" :model-value="activeTab" @update:model-value="(v) => v &&
  (activeTab = v as PickerTab)"`. The null guard stops reka's deselect-on-reclick from emptying it
  (P104 §3.1).
- One `ToggleGroupItem :value="tab.id"` per tab, each wrapped in the trio for its label tip.
- Content: the codicon span, then the count badge `<Badge variant="count"
  data-testid="picker-tab-badge">`, the theme's own count shape (`@theme/components/ui/badge`).
- Accessible name: `` :aria-label="`${label} (${badge})`" `` as KuiSegmented had.

**Filter:**
- `KuiSearchInput` becomes `InputGroup variant="kira" class="m-1"`, holding:
  - an `InputGroupAddon` with `<CodiconIcon name="search" />`;
  - `InputGroupInput ref="filterEl" v-model="filter" :placeholder :aria-label
    @keydown="onFilterKeydown"`;
  - when `filter` is non-empty, `InputGroupAddon align="inline-end"` > trio >
    `InputGroupButton aria-label="Clear filter" @click="filter = ''"`.
- Studio precedent: `workbench/panels/ProjectPanel.vue:57-67`.
- Focus goes through `filterEl.value?.$el.focus()`.

**Rows:**
- Every `rootEl.value?.querySelector` (`:243`, `:465`) becomes `panelEl.value?.querySelector`.
- Row-main buttons follow §4.2.
- The rename field: `Input size="kira" class="kv-branch-rename-input flex-1" v-model aria-label="Rename branch"`
  with the same key handlers. Its submit button becomes `TooltipIconButton icon="check" label="Rename branch"`,
  which adds the accessible name the old icon button lacked.
- In-panel force-delete strip: `danger` and toolbar `Button`s.
- PR badge and worktree chip tips: tip-attr.
- PR badges take `REF_BADGE_CLASS` + kind classes. The worktree chip keeps its `kv:` classes, since
  it is not a ref badge.

**Focus:**
- `onOpenAutoFocus(e)`: `e.preventDefault()`, then focus the filter input. This matches `open()`'s
  "filter focused on open" (P77 §7.2) for both the click and palette routes.
- `closeForCheckout()`: keep W20's synchronous trigger focus (`triggerEl.value?.$el.focus()`),
  set `suppressCloseAutoFocus = true`, then close. `onCloseAutoFocus(e)` calls `e.preventDefault()`
  while the flag is set, then clears it. Reason: reka's close auto-focus fires after the exit
  animation, so it could steal focus back from a `CheckoutDialog` that `runCheckout` opened in the
  meantime.

**Types:** `enabledNeighbour`, `firstEnabled` and `MenuItem` come from `../lib/menuModel.ts`.
`KuiSegmentedOption` becomes a local `interface PickerTabOption`.

### 5.3 `SearchBox.vue` + `SearchResults.vue`

**SearchBox:**
- Root wrapper: `<Popover :open="popoverOpen" @update:open="onPopoverOpenChange">` with
  `<PopoverAnchor as-child>` around the existing `rootEl` row div.
- `popoverOpen = computed(() => !!search.error.value || dropdownVisible.value)`: the old `v-if`
  conditions of the error div and `<SearchResults>`, OR-ed. Inside the content, a `v-if` on the
  error and a `v-else` on `<SearchResults>` keep exactly one visible.
- `KuiSearchInput` becomes an `InputGroup variant="kira" class="flex-1 min-w-0"
  data-testid="search-input"`, so `repo-workspace.spec.ts:1225`'s `[data-testid="search-input"]
  input` still resolves.
- It holds a search-icon addon, then `InputGroupInput ref="searchInputEl" :model-value
  @update:model-value="onInput" @keydown="onKeydown"`. That input carries `role="combobox"`,
  `aria-haspopup="listbox"`, `:aria-expanded`, `:aria-controls`, `:aria-activedescendant`,
  `:aria-describedby`, `:aria-invalid`, `aria-label="Search"` and `placeholder="Search"`. All of
  them now land on the real `<input>` directly (Input has a single `<input>` root), so the
  camelCase `ariaActivedescendant` workaround goes. Then a clear button as in BranchPicker.
- Three option toggles: `TooltipIconButton` with `icon` `case-sensitive`/`whole-word`/`regex` and
  `label` "Match case"/"Match whole word"/"Use regular expression". Each gets `:aria-pressed` + the
  pressed class and keeps its `data-testid`.
- Scope: `KuiSelect` becomes `NativeSelect variant="bordered" size="kira" aria-label="Search scope"
  data-testid="search-scope"` with three `<option>`s.
- Close: `TooltipIconButton icon="close" label="Close search"`.
- `defineExpose({ focus: () => searchInputEl.value?.$el.focus() })`.
- Delete `computeFloatPosition`, `errorEl`/`errorStyle`, the error `watch` and `onClickOutside(rootEl)`.

**PopoverContent** (non-modal, `align="start" :side-offset="2"`, `class="p-0 gap-0 w-105"`):
- The error branch: `<div :id="ERROR_ID" role="alert" data-testid="search-error"
  class="kv:py-0.5 kv:px-1 kv:text-error kv:text-sm">`.
- Otherwise `<SearchResults …>`. Its outer box classes (`w-105 max-h-90 overflow-y-auto py-0.5`)
  move onto `PopoverContent`, so SearchResults renders only the inner content.
- `@open-auto-focus.prevent` and `@close-auto-focus.prevent`: focus never leaves the input, the
  ARIA combobox contract.
- `@escape-key-down="(e) => e.preventDefault()"`. reka's capture-phase Escape handler must not
  dismiss by itself. The same keydown still reaches the input's `onKeydown`, which runs the
  existing two-stage dismiss-then-clear and stops propagation. That handler never reads
  `defaultPrevented`.
- `@interact-outside` and `@focus-outside`: `preventDefault()` when the original event's target
  is inside `rootEl` (clicks and tabbing within the search row). Otherwise let reka dismiss.
- `onPopoverOpenChange(false)`: set `dropdownDismissed = true`. When the error is showing, ignore
  it: the error is passive and clears only when the query changes.

**SearchResults:** drop the positioning code, the `resultsEl` fixed box and `--kui-z-popover`.
`optionClass` uses git-ui's `cn`/`rowVariants`. "Search message bodies" becomes
`Button variant="toolbar" size="kira" class="w-full justify-start" data-testid="search-body-button"`.

### 5.4 Push and pull menus

In §5's table: AppToolbar and PullStrategyPicker, each `DropdownMenu` + `MenuSections`. reka
focuses the first item on keyboard open, replacing `focusFirst()`. `DropdownMenuTrigger` sets
`aria-expanded`/`aria-haspopup`, so the manual `:aria-expanded` binding goes.

### 5.5 `App.vue`

- Drop `<KuiTooltip />` (`:1741`), `initTooltips`/`stopTooltips` (`:1695-1707`) and the kira-ui
  import (`:19-26`), except `KuiColumnResizeHandle`.
- The boot-error Retry (`:1777`) and banner Retry (`:1798`) become
  `Button variant="dialog" size="kira"` with their `data-testid`s. `dialog` is the bordered
  neutral variant, the closest match to their panel-bg/border override. Their override classes and
  the `:1772-1776` comment go.
- **Force-delete popup** (`:1995-2004`):

  ```vue
  <Popover :open="!!forceDeleteRefCandidate" @update:open="(v) => !v && (forceDeleteRefCandidate = undefined)">
    <PopoverAnchor as-child><span class="fixed size-0" aria-hidden="true" :style="{ left: `${x}px`, top: `${y}px` }" /></PopoverAnchor>
    <PopoverContent align="start" :side-offset="0" class="w-auto flex-row items-center gap-1 px-2 py-1"
                    @open-auto-focus="(e) => { e.preventDefault(); cancelEl?.$el.focus(); }">
      <span>“{{ name }}” is not fully merged.</span>
      <Button variant="danger" size="kira" @click="confirmForceDeleteRef">Force delete</Button>
      <Button ref="cancelEl" variant="toolbar" size="kira" @click="forceDeleteRefCandidate = undefined">Cancel</Button>
    </PopoverContent>
  </Popover>
  ```

  `forceDeletePanelEl`, `forceDeletePanelStyle` and the positioning `watch` (`:961-977`) go.
- `onClickOutside(overlayDetailRegionEl, …)` (`:1644`) gains `{ ignore:
  ['[data-reka-popper-content-wrapper]'] }` (VueUse's `ignore` option). Picking an item from a
  FileTree menu opened inside the overlay drawer then does not close the drawer, as it did not
  before (KuiContextMenu rendered in place).
- Rewrite `:1670-1675`'s comment only if it names a removed symbol. `KuiColumnResizeHandle` stays.

### 5.6 `FileTree.vue`

- "Diffing against": `<span>` + `KuiSelect` becomes `Label :for="parentSelectId"` +
  `NativeSelect :id="parentSelectId" variant="bordered" size="kira"` with `<option v-for>`.
  `parentSelectId = useId()`, Part 1's biome-safe pairing.
- Filter: `InputGroup` as in BranchPicker (`aria-label="Filter files"`, `placeholder`).
- List mode: `KuiSegmented` becomes `ToggleGroup type="single" variant="outline" size="kira"
  aria-label="File list display"` with two items, `tree`/`flat`, and the null guard. Each item gets
  the trio with its label and `:aria-label` "Tree view"/"Flat view".
- **Review checkbox, both `<input type="checkbox">`s:**
  - Becomes `<Checkbox :model-value="state" …>`, where `state` is `true` for full,
    `'indeterminate'` for partial, `false` otherwise.
  - `@update:model-value="() => emit('toggleReviewed', path)"`. It stays controlled: the display
    changes only when `reviewStates` answers, the old `.prevent` semantics.
  - `@click.stop` keeps the row click from firing. Carry `:aria-label` and `:data-kira-tip`, plus
    `class="shrink-0"`.
  - Indeterminate glyph: theme's `Checkbox` default slot renders `CheckIcon`. Pass the slot and
    render lucide `MinusIcon` when `state === 'indeterminate'`, `CheckIcon` otherwise.
- Every row span tip (16) becomes tip-attr. Add `<AttributeTooltip :container="treeEl" />` once at
  the FileTree root.
- `rowClass` uses git-ui's `cn`/`rowVariants`.
- "Show all N files" → link `Button` with `text-focus w-full border-t border-border p-1 h-auto`.
- Both `KuiContextMenu`s become `RowContextMenu` with the same props.
- `app-shell.css` goes in this commit (the last raw checkbox): delete the file, drop its
  `main.ts` import and `kv-mount-root` from `container.classList.add/remove`, and rewrite
  `main.ts:111-127`'s comment. Fix `apps/kira-space-vscode/src/webviewDocument.ts:57`'s stale
  pointer and `commitMetaHarness.entry.ts:29`'s comment.

## 6. Tests

Each test edit lands in the same commit as the component change that requires it.

| File | Change | Commit |
|---|---|---|
| `commitMetaHarness.entry.ts` | wrap in `TooltipProvider` (§3.5) | 5 |
| `branch-picker.spec.ts` | `:37` `kui-segmented-badge` → `picker-tab-badge`; `:48,:59` `getByRole('button', { name: /^Stashes/ })` → the role reka's single-mode `ToggleGroupItem` renders (`radio` in Radix parity; confirm, §10); `:30` `getByRole('dialog')` stays valid once the inner role is dropped | BranchPicker |
| `file-tree-open.spec.ts` | `:58` `getByRole('button', { name: 'Flat view' })` → the same role change | FileTree |
| `review-interaction.spec.ts` | `:129-140`: `input[type="checkbox"]` → `[role="checkbox"]`; `toBeChecked()`/`not.toBeChecked()` stay (Playwright reads `aria-checked`); `toHaveJSProperty('indeterminate', …)` → `toHaveAttribute('aria-checked', 'mixed' \| 'false' \| 'true')`; rewrite the P75 comment | FileTree |
| `kui-floating-geometry.spec.ts` → `floating-geometry.spec.ts` | `git mv`, describe renamed. **Tooltip case:** append a synthetic `button[data-kira-tip]`, fixed near the viewport bottom, *inside* `[data-testid="file-tree"] [role="tree"]` (FileTree's `AttributeTooltip` container); `focus()` it (§3.2) and assert `[data-slot="tooltip-content"]` renders above the trigger. This mirrors Studio's `tooltips.spec.ts:303-353` synthetic-cell approach. **Context-menu case:** unchanged steps; the menu is now reka's (`getByRole('menu')` still resolves); the title says DropdownMenu. **Popover case:** unchanged, still `KuiPopoverPanel` on `BaseSelector` until Part 3; the comment says so. File doc comment rewritten: one case per positioning mechanism, reka Popper now for tooltip and menu. | FileTree |

No new unit test: nothing here is complex logic (CLAUDE.md). `menuModel.test.ts` moves, it is not
added. `graph-context-menu-refresh.spec.ts`, `graph-columns.spec.ts`, `graph-branch-order.spec.ts`
and `repo-workspace.spec.ts` need no edit if §5 keeps every `data-testid`, `aria-pressed` and
`.kv-badge-*` hook named. They are the regression guard.

## 7. Steps and commits

Order is binding. Each commit passes the pre-commit hook. Run `bun run typecheck:git`, `bun run
lint` and `bun run build:vscode` per commit; add `build:space` on commits 5 and 14, and
`build:studio` on commits 2-3. The expensive suites run once, at §8.

1. `refactor(theme): move badgeVariants into a .vue-free module` (§3.1).
2. `refactor(theme): hoist AttributeTooltip and TooltipAnchorBridge from workbench` (§3.2 move; Studio import; delete `workbench/src/state/tooltip.ts`).
3. `feat(theme): AttributeTooltip opens on keyboard focus too` (§3.2).
4. `refactor(git-ui): own cn, rowVariants, menu model and ref-badge class` (§3.3, §3.4; `rowMenuModel.ts` type import; `menuModel.test.ts` move). Run `bun test packages/git-ui/src/lib packages/git-ui/src/components/rowMenuModel.test.ts`.
5. `feat(git-ui): TooltipProvider around both mount roots` (§3.5; harness wrap).
6. `refactor(git-ui): row context menus onto DropdownMenu` (§3.6: `MenuSections.vue`, `RowContextMenu.vue`).
7. `refactor(git-ui): small graph buttons onto shadcn Button` (RowActionsButton, ShowMoreButton, LoadMoreButton, RefreshButton, UndoButton, ConflictBanner, NoRepositoryPanel, GlobalStashList).
8. `refactor(git-ui): toolbar, push and pull menus onto shadcn` (AppToolbar, PullStrategyPicker).
9. `refactor(git-ui): search box and results onto Popover and InputGroup` (SearchBox, SearchResults).
10. `refactor(git-ui): ref list rows onto shadcn and data-kira-tip` (TagList, StashRows, StackList, WorktreeList).
11. `refactor(git-ui): branch picker onto Popover, ToggleGroup and InputGroup` (BranchPicker, `branch-picker.spec.ts`).
12. `refactor(git-ui): file tree onto shadcn controls; drop app-shell.css` (FileTree, `app-shell.css`, `main.ts`, `webviewDocument.ts` comment, harness comment, `file-tree-open.spec.ts`, `review-interaction.spec.ts`, `floating-geometry.spec.ts`).
13. `refactor(git-ui): detail panes onto shadcn tooltips and buttons` (CommitMeta, StashDetailPane, UncommittedChangesStrip).
14. `refactor(git-ui): ref badges on badgeVariants with the shared grid tooltip` (refBadges.ts, CommitGrid.vue template + CSS). Run `bun test packages/git-ui/src/components/refBadges.test.ts`.
15. `refactor(git-ui): App shell off kira-ui tooltips; force-delete onto Popover` (App.vue).
16. Follow-up `fix(…)` commits for whatever §8 finds, one per finding.
17. `docs: ARCHITECTURE records git-ui's graph on shadcn (P131 Part 2)`. Covers four things:
    - the frontend-baseline row's "`components/graph/*` … unconverted" sentence;
    - AttributeTooltip's new home in `packages/theme` and git-ui's four containers;
    - `TooltipProvider` in `mount()`;
    - the "Checkboxes (P67c)" paragraph and its `app-shell.css` continuation, rewritten: the file
      is gone, and the height chain lives in `mount()`.

    kira-ui's package-row description stays for Part 3.
18. `docs(v2.0): P131 Part 2 result`.

Intermediate states are allowed between commits 7 and 15. Example: list-row tips set by commit 10
render no tooltip until commit 11 mounts BranchPicker's `AttributeTooltip`. Only commit 15's tree
is verified.

## 8. Verification

Run once, after commit 15:

- `bun run typecheck` (all eight projects), `bun run lint`, `bun run build:space`, `bun run build:vscode`, `bun run build:studio`.
- `bun run test:unit`: `menuModel.test.ts` in its new home, `refBadges.test.ts` resolving `@theme/*`.
- `bun run test:webview`: every `interaction` and `layout` spec, `floating-geometry.spec.ts` included.
- `bun run test:ui:space`.
- `bun run test:ui:studio`: SlickGridHost's moved import, and `tooltips.spec.ts` over the hoisted `AttributeTooltip` with focus support.
- A failure in a file this part never touched still gets fixed, per CLAUDE.md. Confirm it predates
  the part (`git diff --stat c92bf687 -- <file>`), then fix it. A repeat of a known cross-file
  worker-contention timing flake (P117/P127/P128/P131 Part 1/P133 results) is re-run in isolation
  before being called one, and the result section says so.

**Live, VS Code webview (sandbox form).**
- Serve the built webview through `apps/kira-space-vscode/tests/interaction/support/server.ts` with
  `fakeGraphHost.ts`'s init script (`/graph`) and `fakeReviewHost.ts` (`/review`). Drive it with a
  scratch Playwright script outside the repo, never committed, once under `body.vscode-dark` and
  once under `body.vscode-light`.
- Screenshot and check each of these:
  - toolbar: Fetch/Pull/Push with their chevron menus, Stash, collapse and search toggles, settings;
  - ref badges in the grid, and their hover tip;
  - BranchPicker open on each of the five tabs, with filter, a row context menu, an inline rename,
    and the worktree remove dialog over the open panel;
  - search: results dropdown, arrow-key highlight, first Escape dismisses, second Escape clears;
    an invalid regex shows the error popover;
  - the detail pane: CommitMeta tips, the refs `dd` badge tip, FileTree toggle, filter and menu;
  - the review sidebar's FileTree checkbox in all three states.
- Resolve `getComputedStyle` on a toolbar `Button`'s `color` and an `InputGroup`'s
  `background-color`. Each must match the `--kv-*` host value, for example `--kv-input-bg`'s light
  literal under `vscode-light`, not Kira's palette.
- Where a real VS Code install exists, repeat with `code --extensionDevelopmentPath=apps/kira-space-vscode`
  under a dark and a light theme. Otherwise say so plainly, as Part 1 did, and leave that check to
  the user.

**Live, Kira Space.**
- Run `bun run dev:space` (or the `run` skill) against a real repository and open the graph tab.
  Walk the same checklist in Space's `.dark` document.
- Where no display exists, use the built test app through `apps/kira-space/tests/ui/fixtures.ts`'s
  `relaunch` plus `support/graphStreamFixture.ts` (the path `repo-workspace.spec.ts`'s
  `bootMultiBranchGraph` uses). Drive it from a scratch Playwright script and take screenshots.
- Record which form ran.
- Also check `Graph > Font size` at a non-default value: grid text and badges resize; shadcn
  toolbar controls do not (Part 1 §4.3).

## 9. Closing audit

Report each row as a real check, with its command and result, in the result section. `$SCOPE` is
`packages/git-ui/src/App.vue packages/git-ui/src/components/*.vue packages/git-ui/src/components/*.ts`
(the shell glob excludes `dialogs/` and `review/`).

| Check | Command | Expect |
|---|---|---|
| Only `KuiColumnResizeHandle` imported from kira-ui | `rg -n "@kira/kira-ui" $SCOPE` | exactly 2 hits, `App.vue` and `CommitGrid.vue`, each `import { KuiColumnResizeHandle } from '@kira/kira-ui'` |
| No other kira-ui token, comments included | `rg -nP "Kui(?!ColumnResizeHandle)[A-Z]\w*\|v-kui-tooltip\|data-kui-tip\|kuiRowVariants\|computeFloatPosition\|pointReference\|initTooltips\|kui-" $SCOPE` | empty, or each remaining hit a history-only comment (naming no current code), listed in the result section |
| No raw form control left | `rg -n '<input\|<select\|<textarea\|type="checkbox"' $SCOPE` | empty |
| `app-shell.css` gone | `test ! -e packages/git-ui/src/theme/app-shell.css && rg -n "app-shell\|kv-mount-root" packages apps --glob '!docs/**'` | file absent; no hit |
| `main.ts` kira-ui residue is Part 3's only | `rg -n "kira-ui\|Kui" packages/git-ui/src/main.ts` | `vKuiTooltip` import + registration and the `kui-bridge.css` import comment only |
| shadcn really used | `rg -l "@theme/components/(ui/(button\|tooltip\|popover\|dropdown-menu\|toggle-group\|input-group\|native-select\|input\|checkbox\|dialog\|label\|badge)\|TooltipIconButton\|AttributeTooltip)" $SCOPE` | every file with a `Kui*` call site in §1's table, except `TagList.vue` and `StashRows.vue` (rows become raw `<button>`s, tips become attributes), `refBadges.ts` (reaches theme through `badgeClass.ts`) and `rowMenuModel.ts` (types only) |
| Grid tooltip wired | `rg -n "AttributeTooltip" packages/git-ui/src/components` | CommitGrid, CommitMeta, FileTree, BranchPicker |
| `data-kira-tip` really read | `rg -n "data-kira-tip" packages/git-ui/src` | refBadges.ts (3) plus the list-row sites; no `data-kui-tip` anywhere in `$SCOPE` |
| Badges on `badgeVariants` | `rg -n "badgeVariants\|REF_BADGE_CLASS\|refBadgeClass" packages/git-ui/src` | `badgeVariants` in `badgeClass.ts` only; `REF_BADGE_CLASS`/`refBadgeClass` in refBadges.ts, CommitMeta, StackList, BranchPicker |
| Hoist complete | `test ! -e packages/workbench/src/components/AttributeTooltip.vue && test ! -e packages/workbench/src/state/tooltip.ts && rg -n "@workbench/components/AttributeTooltip" apps packages` | both absent; no hit |
| Helpers owned by git-ui | `rg -n "from '@kira/kira-ui'" packages/git-ui/src/lib $SCOPE` | only the 2 `KuiColumnResizeHandle` lines |
| No `kv:` on a shadcn tag, no alias drift | `bun run lint` | green |
| No wrapper layer | `rg -n "defineComponent" $SCOPE packages/git-ui/src/MountRoot.vue` and `rg -Pn "^<script>(?! setup)" $SCOPE`; no new `Git*Button`-style file | empty |
| Suites | §8 | all green |

## 10. Risks, and what the implementer confirms against installed `reka-ui` 2.10.5

- **ToggleGroupItem role in `type="single"`.** Radix renders `role="radio"` + `aria-checked`. Read
  `node_modules/reka-ui/dist/ToggleGroup/ToggleGroupItem.js` before editing the two specs, and use
  whatever it renders.
- **Popper wrapper attribute.** `[data-reka-popper-content-wrapper]` (§4.4, §5.5) is Radix's
  `data-radix-popper-content-wrapper` renamed. Confirm the name in `dist/Popper/PopperContent.js`.
- **`interact-outside`/`focus-outside` event target.** Use
  `(e.detail.originalEvent.target as Node)`, not `e.target`. Confirm in `dist/DismissableLayer`.
- **Mounting a `DropdownMenu` already open** (`RowContextMenu` is `v-if`-mounted by its consumers)
  on the same `contextmenu` event. `graph-context-menu-refresh.spec.ts` and `floating-geometry`'s
  menu case cover it. If reka treats the originating pointer sequence as an outside interaction,
  open on `nextTick` instead of initialising `open` to `true`.
- **Nested layers.** A row `DropdownMenu` over the modal picker, and the worktree `Dialog` over it,
  must not dismiss the picker. reka's DismissableLayer stack handles pointer and Escape, and modal
  content handles focus (§5.2). The live check exercises both.
- **Checkbox indeterminate slot.** Confirm `CheckboxRoot`'s slot exposes `state` or `modelValue`
  for the icon switch.
- **`bun test` and `@theme/*`.** If bun does not honour `packages/git-ui/tsconfig.json`'s `paths`
  for a `.ts` importer, `badgeClass.ts` imports `../../../theme/src/...` relatively instead.
  Record it.
- **Two roots, one document (Space).** Nothing new. Part 2 adds only unprefixed utilities in
  git-ui source, which Space's root already scans.
- **Pre-existing nested `<button>`** (BranchPicker's PR badge button inside the row-main button,
  `:664`). This is invalid HTML that predates this phase. It is kept as-is: it is not a failing
  check, and changing it is an interaction redesign outside this row. Noted so no one reads it as
  introduced here.

## 11. Acceptance

| SPEC row wording (Part 2) | Where met |
|---|---|
| "`App.vue` and every non-dialog, non-review `components/*.vue` … per Part 1 plan §4-§5" | §5 table, every file in §1; §0 lists each refinement of Part 1 §5 |
| "Button/ToggleGroup/InputGroup/NativeSelect/Input/Checkbox swaps" | §4.1, §5.2, §5.3, §5.6, WorktreeList row |
| "`KuiMenuList`/`KuiPopoverPanel`/`KuiContextMenu` and the force-delete popup onto DropdownMenu/Popover (point-anchored per P104 §5.2)" | §3.6, §5.2-§5.5 |
| "a `TooltipProvider` wrapping both roots in `mount()`" | §3.5 |
| "`refBadges.ts` badges on `badgeVariants` (moved to a `.vue`-free module for `bun test`)" | §3.1, §3.4, §5.1 |
| "grid tooltips through `AttributeTooltip`/`TooltipAnchorBridge` hoisted into `packages/theme/src/components/` (`data-kui-tip` becomes `data-kira-tip`; Studio's `SlickGridHost.vue` import updated, so `test:ui:studio` runs too)" | §3.2, §5.1, §8 |
| "`app-shell.css`'s raw-checkbox rule deleted once unused" | §5.6 |
| "webview test selectors (`kui-segmented-badge`, `kui-tooltip`, `data-kui-tip`, `kui-floating-geometry.spec.ts`) moved onto reka surfaces" | §6 (BaseSelector's popover case stays on kira-ui until Part 3, §0) |
| "no kira-ui import in those files except `KuiColumnResizeHandle`" | §3.3 helper move, §9 rows 1-2 and "Helpers owned by git-ui" |
| "`test:ui:space`, `test:webview`, `test:unit`, `test:ui:studio` green" | §8 |
| "graph shown live in both hosts" | §8 live checks, webview under both theme kinds |
