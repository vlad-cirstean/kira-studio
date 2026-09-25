# P110 Tailwind migration quality audit

Report only. Nothing fixed. Tree audited: `621c6f68` (branch `claude/p108-v1-9-continue-ijmvko`).
Phase start: `6f6853c1`. Reference plan: `docs/v1.9/plans/P110-css-tailwind-migration.md`.

Question: does the code use Tailwind's own value system and idioms, or is it legacy CSS re-wrapped
in Tailwind syntax?

Severity key:

- **defect**: wrong output today, a plan rule broken, or a default/existing token ignored in
  favour of a literal.
- **judgment**: defensible, but inconsistent or weaker than the idiomatic form.
- **fine**: checked, holds up.

Method:

- CodeGraph `codegraph_explore` for the theme layer, the settings field vocabulary and the settings
  panes.
- A repo-wide grep of arbitrary values (`-[`) and a diff against §1.2.
- Class-order claims were checked by compiling test inputs with `@tailwindcss/node` 4.3.3. Emit
  order was checked on the real `@layer utilities` output, not assumed.
- `git show 6f6853c1:` diffs to confirm what predates the phase.

## 1. Arbitrary values vs §1.2 allowlist

§1.2 allows 9 entries. §1.1 sets the ladder: default step, then an existing token, then a new token
(3+ recurrences or a design seam), then an arbitrary value.

### 1a. Existing token ignored (defect)

A named utility for the same token already exists at each of these sites:

- `font-[family-name:var(--kira-font-data)]` ×9. `font-data` exists.
  - `views/shared/MonacoHost.vue:627`
  - `views/definition/DefinitionView.vue:330`
  - `views/grid/DataView.vue:397`, `:408`
  - `views/httprequest/CookiesPane.vue:137`, `:173`, `:189`
  - `views/documents/DocumentRow.vue:63`
  - `views/documents/DocumentTree.vue:46`
- `font-[family-name:var(--kira-font-ui)]` ×2 at `views/shared/celleditor/CellEditorView.vue:573`,
  `:620`. `font-ui` exists.
- `text-[length:var(--kira-font-size)]` at `MonacoHost.vue:627`. Use `text-kira-md`.
- `text-[var(--kira-accent)]` at `views/console/ConsoleSavedMenu.vue:115`, `:117`. Use
  `text-primary`.
- `bg-[var(--kira-state-on)]` at `views/grid/DataToolbar.vue:331`. Use `bg-state-on`.
- `z-[var(--kira-z-autocomplete)]` (`AutocompleteField.vue:567`) and `z-[var(--kira-z-popover)]`
  use the long form. §1.2 allowlists the `z-(--kira-z-*)` shorthand. Judgment; spelling only.
- `w-[var(--total-width)]` should use the `w-(--total-width)` shorthand. Judgment.

### 1b. Default step exists (defect)

Default spacing is 4px with any 0.25 multiple. Each equivalent below was compile-checked.
Most sites are git-ui (`kv:`) or kira-ui, the §6 work.

- `kv:max-w-[480px]` becomes `max-w-120`: `App.vue:1814`, `GitBlockedPanel.vue:33`.
- `kv:max-w-[420px]` becomes `max-w-105`: `NoRepositoryPanel.vue:67`, `:86`, `:91`, `:101`;
  `EmptyRepositoryPanel.vue:25`.
- `max-w-[260px]` becomes `max-w-65`: `AppToolbar.vue:462`, `:483`.
- `w-[5px]` becomes `w-1.25`: `App.vue:1936`; `CommitGrid.vue:1276`, `:1286`, `:1296`.
- `px-[3px]` becomes `px-0.75`: `KuiButton.vue:102`; `KuiSegmented.vue:17`, `:72`.
- `top-[3px] right-[3px]` becomes `top-0.75 right-0.75`: `RefreshButton.vue:83`.
- `max-h-[70%]` becomes `max-h-7/10`: `CommitMeta.vue:323`.
- `saturate-[1.6] contrast-[1.15]` becomes `saturate-160 contrast-115`: `FileTree.vue:613`, `:740`.
- `leading-[1.4]` becomes `leading-snug` (1.375; nearest step, §6.4 rule): `KuiTooltip.vue:10`,
  `:57`.
- `tracking-[0.06em]` becomes `tracking-wider` (0.05em): `KuiMenuList.vue:138`. The plan already
  made this choice for Studio's `.sec-label`.
- `leading-[var(--kira-control-inline-h)]` (14px) becomes `leading-3.5`, or a token: `TitleBar.vue:88`,
  `:92`.
- `leading-[var(--kui-control-h-sm,14px)]`: `KuiSegmented.vue:18`, `:72`. It recurs, so it needs a
  theme token.

### 1c. Arbitrary property where v4 ships a utility (defect)

- `[mask-size:contain] [mask-repeat:no-repeat] [mask-position:center]` (and the `-webkit-` twins)
  at `FileTree.vue:582`, `:706`. Use `mask-contain mask-no-repeat mask-center`. `RepoTreeRow.vue`
  and `TabStrip.vue` already do, so the treatment is split.
- `[overflow-wrap:anywhere]` should be `wrap-anywhere`:
  - `ResponseDiffDialog.vue:311`, `:312`, `:328`, `:329`
  - `AutocompleteField.vue:600`
- `focus-visible:[outline:none]` should be `focus-visible:outline-none`: `App.vue:1936`;
  `CommitGrid.vue:1276`, `:1286`, `:1296`.
- Font-family inherit is written three ways:
  - `font-[inherit]` in Studio.
  - `kv:font-inherit`, a token (`--font-inherit: inherit`), in git-ui.
  - `kv:[font-family:inherit]`/`kv:[font:inherit]` in kira-ui ×4, `CommitMeta.vue`,
    `UncommittedChangesStrip.vue` and linkify.

  Pick one. Judgment.
- 11 `font-[inherit]` on `<button>`/`<input>`/`<textarea>`, plus 2 raw `font: inherit` rules
  (`apps/kira-space/.../StatusBar.vue` `.blame`, Studio `StatusBar.vue` `.update`). All are dead:
  Preflight already sets `font: inherit` on those elements. Defect (noise).

### 1d. §6.4 em literals left in git-ui (defect)

§6.4 maps em literals to the nearest step. These survive:

- `text-[0.8em]`: `BranchPicker.vue:678`; `StashRows.vue:107`, `:113`.
- `text-[0.75em]`: `TagList.vue:121`, `KuiButton.vue:102`.
- `text-[0.5em]`: `FileTree.vue:621`, `:748`.
- `text-[1.05em]`: `KuiDialog.vue:23`, `:80`.
- `w-[8em]`: `RepoSettingsDialog.vue:214`.

Pixel literals remain too:

- `text-[12px]` at `FileTree.vue:550`, `:674` and `ReviewCommitRow.vue:234`. git-ui maps
  `--text-xs` to `--kv-t-*`, so use a mapped step.
- `text-[24px]`/`text-[32px]` in `EmptyRepositoryPanel`, `GitBlockedPanel` and
  `NoRepositoryPanel`. git-ui reset the text namespace, so no step exists; recurring ×3+ means a
  token (rung 3). Judgment.

### 1e. Not on §1.2 but legitimate (judgment)

- Grid templates with no default:
  - `VariableRow.vue:143`, `:148` and `VariableSetView.vue:642`, `:645` repeat the same template.
    Share a const or use subgrid.
  - Others: `VariablesOverviewPanel.vue:124`, `:131`, `ResponseDiffDialog`, `GenerateDataDialog`,
    `OperationsPanel` and `CommitMeta` (`max-content_1fr`).
- Viewport values:
  - `h-[60vh]` at `SchemaDialog.vue:142` and `RepoMultiDiffView.vue:162`
  - `kv:max-h-[85vh]` at `KuiDialog`
  - `kv:w-[min(320px,90vw)]`
  - `kv:min-h-[min(220px,60%)]`
- `ch` widths:
  - `min-w-[7ch]` ×12. The run-state label accounts for 11; see §6a. At 12 recurrences it meets
    the rung-3 token/component bar.
  - `min-w-[4ch]`/`min-w-[9ch]` at `StatusBar.vue`.
- Runtime vars: `kv:z-[var(--kui-z-*,N)]`, `--kui-float-max-*`.
- One-offs:
  - `leading-[inherit]`, `list-[revert]`, `[&::-webkit-details-marker]:hidden`
  - `group-open:before:content-['\eab4']`, the natural pair of an allowlisted codicon entry
  - `kv:shadow-[-2px_0_8px_var(--kv-widget-shadow)]`
- Registry-authored values inside `packages/theme/src/components/ui/` are shadcn-vue's own, not
  migration output:
  - button/toggle `rounded-[min(...)]` and `text-[0.8rem]`
  - checkbox `rounded-[4px]`
  - input-group calc radii
  - ToggleGroup gap
  - DialogContent `max-w-[calc(100%-2rem)]`
  - DropdownMenuSubContent `min-w-[96px]`

  Fine.

### 1f. Allowlisted and used as intended (fine)

- `GenerateDataDialog` `max-h-[82vh]`
- `ErrorPopover` `max-w-[calc(100vw-8px)]`
- codicon `before:content-[...]`/`before:font-[codicon]`
- NativeSelect `[appearance:base-select]`/`[&::picker(...)]`
- ResizableHandle inset shadow
- spin-button resets
- `bg-(--kira-rail)` ×28

No new `!` in P110 app code.

### 1g. §1.3: one element, two same-property utilities (defect)

This is the most consequential finding. Tailwind emits same-property utilities in a fixed order
unrelated to class-attribute order. A static colour class can therefore beat its own conditional
override. Compile-checked emit order: `text-bg` < `text-error` < `text-fg` < `text-info` <
`text-muted-foreground` < `text-subtle`. The later one wins.

- **Run-state label colour never changes** (11 sites, B7 `61f2db05`). Static `text-subtle` with
  conditional `text-info` (running) / `text-error` (error): `text-subtle` always wins.
  - `api/EnvironmentsView.vue:254`
  - `api/VariableSetView.vue:499`
  - `views/browse/BrowseView.vue:360`
  - `views/console/ConsoleView.vue:860`
  - `views/definition/DefinitionView.vue:289`
  - `views/documents/DocumentView.vue:879`
  - `views/grid/DataView.vue:273`
  - `views/grpcrequest/GrpcRequestView.vue:420`
  - `views/httprequest/HttpRequestView.vue:629`
  - `views/shared/keyvalue/KeyValuePane.vue:776`
  - `views/stream/StreamView.vue:847`

  Plan §9.6 expects the label in `--kira-info` while running. The only test on this widget
  (`data-view.spec.ts:1100`) asserts `min-width`, not colour, so nothing catches it.
- **Current search match text never flips to `text-bg`**:
  - `views/console/ConsoleResultGrid.vue:416`: static `text-muted-foreground`, conditional `text-bg`
    at `:419`. B34/B40e.
  - `views/shared/keyvalue/KeyValuePane.vue:1149`, `:1167`: static `text-fg`, conditional `text-bg`
    at `:1152`, `:1170`. B34/B40l.

  Result: muted/fg text sits on the bright current-match fill.
- **Terminal failed footer never turns red**: `packages/workbench/src/terminal/TerminalHostView.vue:56`.
  Static `text-muted-foreground`, conditional `text-error` at `:57`. B39c `32109590`.
- `ConsoleResultGrid.vue:428`: static `whitespace-nowrap whitespace-pre-wrap`. It renders as
  intended only because `pre-wrap` sorts later. The plan forbids the pattern. A scan of every
  static class attribute in `apps/`/`packages/` (display, position, whitespace, flex-direction,
  overflow, align, justify, weight, cursor families) finds no other same-family pair.
- `SettingsShell.vue:223`: `'bg-select! text-fg!'` uses `!` to win the same fight. It predates
  P110 (`d84a7c4a`), but it is the anti-pattern §1.3 exists to kill. Use a ternary. Judgment.

Fix shape for all of these: a ternary or lookup map picks exactly one colour utility, per §1.3.

## 2. `@theme` / `@utility` shadowing defaults

### 2a. Composite `@utility` bundles outside §5.3 (defect)

§5.3 allows 4 `@utility` additions. `packages/theme/src/base.css` has 14. The extra 10 are named
CSS classes in `@utility` syntax. Several are pasted compiled Tailwind output (`--tw-border-style`,
`--tw-font-weight` declarations written by hand).

| `@utility` | Line | Default equivalent |
|---|---|---|
| `empty-state` | `:185` | `flex min-h-0 flex-1 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center` |
| `empty-state-icon` | `:202` | `text-subtle` |
| `empty-state-title` | `:205` | `text-kira-md text-muted-foreground font-normal` |
| `tree-row` | `:217` | a composite |
| `twisty` | `:240` | a composite |
| `columns-menu-inner` | `:261` | `max-h-80 flex flex-col` |
| `columns-menu-header` | `:266` | `flex gap-1 border-b border-border p-1` |
| `columns-menu-loading` | `:274` | `p-2` |
| `columns-menu-list` | `:277` | `overflow-y-auto p-0.5` |
| `columns-menu-footer` | `:281` | `px-1.5 pb-1.5` |

Cost: tailwind-merge can't see inside a bundle. A consumer adding `relative` or `gap-1` next to
`tree-row` gets two same-property declarations, sorted by name. `tree-row` also carries
`position: relative`. That is the root of the `virtual-row` regression described at
`base.css:165-178`, and the reason 12 files each keep a private unlayered `.virtual-row` copy (§4).
§5.14 says a pattern used 4+ times becomes a local component: `EmptyState.vue`, `TreeRow`
markup, `ColumnsMenu`. `columns-menu-*` has one consumer, so it should be inline utilities.

### 2b. Parallel scales equal to defaults (defect)

- `--spacing-kui-1..6` (`packages/kira-ui/src/theme/tailwind-theme.css`) resolves through both
  bridges (`packages/theme/src/kui-bridge.css:45-50`, `packages/git-ui/src/theme/kui-bridge.css:44-49`)
  to 2/4/6/8/12/16px. That equals default `0.5/1/1.5/2/3/4`. 22 uses (`kui-1` ×3, `kui-2` ×7,
  `kui-3` ×5, `kui-4` ×3, `kui-5` ×2, `kui-6` ×2) need a second vocabulary for the same numbers.
  git-ui's own `tailwind.css` says `--kv-s-*` equals the default steps and maps nothing, which is
  the right call. kira-ui should match.
- Studio's `--kira-s-1..6` (`tokens.css`) holds the same 2/4/6/8/12/16px. It feeds only CSS, never a
  utility, so it is fine as a raw token.

### 2c. Named tokens equal to defaults (judgment)

- `text-kira-xl` (20px) equals `text-xl`.
- `rounded-kira-sm` (4px) equals `rounded-md`, and `rounded-kira` (6px) equals `rounded-lg`, via
  `shadcn-bridge.css` (`--radius` = 6px, so `-sm` 2px, `-md` 4px, `-lg` 6px).

Both spellings live side by side: registry components use `rounded-md`, app code uses
`rounded-kira-sm`. The `kira` names are a user-settable seam (radius tracks `--kira-radius`), so
keeping them is defensible. Two names for one value still invite drift.

Colour pairs map to one value with two names: `fg`/`foreground`, `bg`/`background`,
`elevated`/`popover`/`card`, `error`/`destructive`, `focus`/`ring`, `hover`/`accent`. App code
uses both halves of each pair. Pick the shadcn name in app code, or document which half is
canonical. Judgment.

git-ui's `--color-muted: var(--kv-description-fg)` revives the name Studio retired
(`text-muted`, now `text-muted-foreground`). The same meaning has a different name per package.
Judgment.

### 2d. Tokens outside §5.3 or with drifted comments

- `--spacing-completion-max-w` (`base.css:104`, B30) is not in §5.3's token list. It is also not
  registered in `cn()`'s `extendTailwindMerge` (`packages/theme/src/lib/utils.ts`), so twMerge
  treats `max-w-completion-max-w` as unknown. Judgment.
- Seam tokens are orphaned, but their comments still say they drive geometry:
  - `--kira-gap` (`tokens.css:71`). The comment says it drives the WorkbenchShell gap and splitter
    track. `WorkbenchShell.vue:132` hard-codes `gap-0.5 px-1.5 pb-0.5`. `:110` hard-codes `+ 2`
    and cites `--kira-gap` in a comment only.
  - `--kira-window-inset` (`:74`), now `px-1.5`.
  - `--kira-toolbar-h` (`:100`) and `--kira-viewhead-h` (`:105`). No consumer;
    `control-sizing.spec.ts:20` mentions `--kira-viewhead-h` in a comment only.

  B6 kept `titlebar`/`tabbar`/`statusbar` as spacing seams. Toolbar and view-head collapsed onto
  `h-bar`. Either delete the orphans or wire them up. As-is, a user or theme override of them does
  nothing, while the comments claim otherwise. Defect.
- git-ui `tailwind.css` converges `--text-xs/sm/base/lg` and `--radius-sm` on default names.
  Idiomatic. Fine.

## 3. `@apply`-only blocks

§5.14 says to fold `@apply` rules onto the template. Stragglers:

- `views/browse/BrowseView.vue:568` (95-line block): 14 plain single-selector `@apply` rules
  (`.browse-view`, `.breadcrumb`, `.crumb`, `.crumb-sep`, `.browse-body`, `.list-pane`,
  `.detail-pane`, `.body-panel`, `.body`, `.empty`, `.preview-empty`, `.browse-row`, `.row-name`,
  `.row-detail`). Each is used once. §5.14 was not applied to this file at all. Defect.
- `RepoReviewView.vue:77`: `.repo-review-host { @apply h-full w-full }` on one element. Defect.
- `apps/kira-space/.../StatusBar.vue:57`: plain `.blame-text` `@apply`. `.blame { font: inherit }`
  is dead under Preflight. Defect.
- Studio `StatusBar.vue:174`: `.update { font: inherit }` is dead under Preflight. Defect.
- `CollectionsPanel.vue:247`, `VariablesOverviewPanel.vue:208`: `all: unset` + `@apply`. The reset
  exists to undo UA button styles Preflight already neutralises. Judgment.
- `ColumnsSection.vue:103`, `ConstraintsSection.vue:97`, `IndexesSection.vue:48`: the identical
  `.definition-table td { border-r }` / `td:last-child` block ×3. Put `border-r last:border-r-0`
  on the `<td>` template, or share one table component. Defect.
- `DocumentRow.vue:78`: `shadow-[inset_2px_0_0_var(--primary)]` inside `@apply`. It belongs on
  the element. Judgment.
- Comment-only `<style>` blocks: `GrpcRequestView.vue:579`, `HttpRequestView.vue:840`. No rules,
  but each triggers a Tailwind `@reference` compile per SFC. Defect (dead).

## 4. Remaining `<style>` blocks vs §5.15/§6.5

§9.4 expects the `<style>` count to equal the stays-CSS list: Monaco `:deep`/`:global` in
`MonacoHost`, `OperationsPanel` and `ResponseDiffDialog`; `.kira-ed-var*`; `RepoFileView` v-html;
`CommitGrid`. That's about 8. The tree has **48 blocks** (47 `.vue` + `CommitGrid`), 1,563 lines.

### 4a. Justified (fine)

- `MonacoHost.vue:634` (Monaco `:deep`/`:global`; one compound rule should move)
- `OperationsPanel.vue:394` (Monaco part)
- `ResponseDiffDialog.vue:358` (Monaco `:deep` part)
- `RepoFileView.vue:340` (v-html `:deep`)
- `AutocompleteField.vue:608` (mostly `.p-input.is-grow` support)
- `CommitGrid` (§6.5)
- git-ui `app-shell.css` checkbox pseudo-elements (89 lines, §6.5)

### 4b. Kept for hover/state/compound/`::after` rules (defect, systematic)

About 35 blocks survive only for these. Their comments repeat one reason: "no static class can
stand in for a live pointer state". That is false. `hover:`, `group-hover:`, `data-[state=…]:`,
`aria-selected:`, `after:` and ternary/lookup classes cover every case below.

- `.x:hover` / `.x.selected` / `.x.is-active` → `hover:`, a `data-`/`aria-` variant, or a ternary:
  - `GitPanel.vue:651` (48 lines: hover/active/open/current/error)
  - `RepoSearchRow.vue:131`, `RepoTreeRow.vue:128`
  - `CollectionRow.vue:195`, `TreeRow.vue:202`
  - `TerminalPanel.vue:284` (`.quick-command-row:hover`)
  - `TitleBar.vue:182` (`.mode-tab:hover:not(.is-active)`)
  - `ColumnsMenu.vue:156` (`.is-dragging`)
  - `CallHistoryList.vue:196`, `ResponseHistoryList.vue:250`, `DocumentView.vue:1203`
  - `DateTimePicker.vue:375`, `SavedListMenu.vue:131`, `CellEditorView.vue:759`
  - `KeyValuePane.vue:1202`, `StreamView.vue:1302`, `TerminalView.vue:99`
  - grpc `ResponsePane.vue:493`, http `ResponsePane.vue:524`
- Parent hover reveals a child → `group` on the parent plus `group-hover:` on the child:
  - `ConsoleResultGrid.vue:445` (`.row:hover .cell:not(.selected)`)
  - `ConsoleView.vue:1060` (`.result-tab:hover .result-close`)
  - `TabStrip.vue:345` (`.tab-chip:hover .tab-close`)
- `::after` badge: `TabStrip.vue:345` `.tab-chip.is-attention::after { @apply … content-[''] }`.
  §1.2 allowlists `after:content-['']` for exactly this. It should be `after:` variants on the
  chip, conditional on `is-attention`.
- Compound state and descendant selectors:
  - `ConnectionDialog.vue:1438`: `.kind:hover:not(.is-off)`, `.is-selected`, `:focus-within`,
    `.is-off`. Use `hover:not-data-[off]:`, `focus-within:` and a ternary.
  - `ExplainResultView.vue:180`: `.verdict.warn`, `.issue-list li`. Use a ternary; `*:` or li
    utilities.
  - `ResponseDiffDialog.vue:358`: `.diff-header-row.added .diff-header-status` ×3. Use a lookup
    map, keeping the Monaco `:deep` part.
  - `TimelinePane.vue:327`: `[data-present='false']` becomes the `data-[present=false]:` variant.
  - `ColumnsSection`/`ConstraintsSection`: `.header-key.is-fk` becomes a ternary.

### 4c. `.virtual-row`/`.sticky-row` duplicated in ~12 files (defect)

Byte-identical `.virtual-row` rules live in `RepoFileTree.vue:135`, `RepoSearchView.vue:235`,
`CollectionsTree.vue:220`, `ProjectTree.vue:245`, `BrowseView.vue`, `ConsoleResultGrid.vue`,
`OperationsPanel.vue` and others. Three of them also carry `.sticky-row`.

`base.css:165-178` records why the shared `@utility` was reverted: `TreeRow.vue`'s unlayered
`.tree-row { @apply … relative }` beat the layered `absolute`. That is a symptom of §2a and §4b,
not a reason for CSS. With `tree-row` as plain template utilities and no unlayered rule,
`cn('relative', 'absolute …')` dedupes via twMerge, and one shared class string (or a `VirtualRow`
wrapper) serves all 12 files.

## 5. `primitives.css` residue

`packages/theme/src/primitives.css` is 75 lines, only `.p-input.is-grow`. It holds a CSS-grid
sizing replica with `attr(data-value)` `::after` content and a clamped `padding-block` calc, and
must stay unlayered to beat the `kira` InputGroup variant. No utility expresses `content:
attr()` + grid-area replica cleanly. Fine.

`packages/workbench/src/workbench.css` is 2 real lines (`@import`, `@source`). Fine.

## 6. Component consistency

### 6a. Pasted markup where a component belongs (defect)

- **Run-state widget ×11** (sites in §1g). The outer span, the `min-w-[7ch]` label and the
  `h-3 w-3 border-2 border-border-strong` ring with a conditional `animate-kira-spin
  border-t-primary`/`border-error` are pasted identically. It's one component (`RunState.vue`).
  Having one copy would also have made the §1g bug a single-site fix.
- **Number stepper ×14 pairs in 7 files**. About 28 lines of `InputGroupAddon` + 2 `Tooltip`-wrapped
  `InputGroupButton class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"`:
  - `ConnectionDialog.vue:880`, `:893`, `:1045`, `:1058`
  - `GenerateDataDialog.vue` ×6
  - settings `ApiPane.vue` ×6, `AdvancedPane.vue` ×4, `CachePane.vue` ×2
  - Space `GitPane.vue` ×4
  - `FontSizeField.vue` ×2

  `step-btn` has no rule anywhere now; it is a leftover hook. Use one `NumberStepper`/`NumberField`
  component (reka-ui ships `NumberField`).
- **Toolbar string ×31**. `.p-toolbar` became `h-bar shrink-0 flex items-center gap-1.5 px-2
  border-b border-border` at 18 sites, plus 13 without the border. Other `h-bar` bars use `gap-1`.
  No shared component. Judgment trending defect: the old primitive's single source of truth is
  gone.
- **Swatch radio ×4**: `ScriptsPane.vue:188`, `:270`; `VariableSetView.vue:622`;
  `ConnectionDialog.vue:798`. Same 10-utility string. Judgment.

### 6b. shadcn bases overridden per call site instead of restyled (judgment)

The registry bases were never restyled to the app's look. Each consumer overrides them instead:

- `DialogFooter`: `border-t border-border bg-transparent` in 16/17 consumers. The base carries
  `bg-muted/50 -mx-4 -mb-4 rounded-b-xl border-t p-4`.
- `DialogHeader`: `flex-row items-center gap-1.5 border-b border-border px-3 py-2` in 17/18. The
  base is `flex flex-col gap-2`.
- `DialogTitle`: `text-kira-lg font-normal` in 15/18. The base is `text-base leading-none
  font-medium`.

shadcn-vue's model is "you own the source". Edit `components/ui/dialog/*` once.

### 6c. Settings field vocabulary (defect)

- `<Field>` is used by the 4 shared field components only (5 call sites). `FieldLabel` has 0 uses.
- `fieldVariants()` is borrowed as a class string on `<Label>` 32 times in 11 files. It merges
  with Label's own base (`flex items-center gap-2 font-medium select-none …`). Computed via the
  repo's `cn`, vertical: `flex flex-col gap-1 text-kira-sm items-center font-medium
  select-none …`.
- The pre-phase `.field` was `flex column gap 4px font-size t-sm`: weight 400, stretch alignment.
  So every settings field wrapper now renders medium-weight and cross-axis centred. The header row
  and `NativeSelect` inside it carry no `w-full`, so they shrink-wrap and centre instead of
  stretching.
- `data-slot="field"` is hand-written 13 times so `FieldGroup`'s `[&>[data-slot=field]]` selector
  matches. That is scaffolding worn as a costume.
- No settings visual baseline exists (`tests/visual` covers connection-dialog, console, data-view,
  schema-dialog). B12 `5aeb5986` records no computed-style check, which §5.9 required.

Probable visual regression across every settings pane, unverified.

### 6d. Other inconsistencies (judgment)

- Alert error intent is split: `variant="destructive"` ×29 vs `variant="err"` at
  `FkPreviewPopover`, `TimelinePane`, `CellEditorView` and `StreamView`. 33 `<Alert>` tags also
  carry a class override.
- Spinner speed is split: `animate-spin` (1s) ×10 vs `animate-kira-spin` (0.7s) ×12. Same
  affordance, two speeds.
- The muted-text name differs per package: git-ui `kv:text-muted` vs Studio `text-muted-foreground`
  (§2c).

## 7. shadcn-vue depth

- **Badge**: used through its cva variants, no per-site restyle. Real use. Fine.
- **NativeSelect**: 15 importers, variant-driven (`variant="bordered"`); `nativeSelectVariants()`
  reused on raw `<select>` in `MethodSelect.vue:41`, `EnvironmentSelect.vue:77` and
  `CellEditorView.vue:573`. Real use. Fine.
- **ToggleGroup**: 17 files. Real use. Fine.
- **Resizable**: only `ResizableHandle` is used. 8 importers drive reka-ui `SplitterGroup` /
  `SplitterPanel` directly instead of `ResizablePanelGroup`/`ResizablePanel`. Half-adopted.
  Judgment.
- **Field**: scaffolding (see §6c). `Field` is used at 5 sites, `FieldLabel` at 0; the variant
  string is borrowed onto `Label` with a hand-written `data-slot`. Defect.

## 8. Retired-class guard coverage (`scripts/check-theme-classes.sh`)

Covered: text-muted, text-fg-muted, bg-input; every `p-*` primitive the plan names (run-state,
panel-head, badge/chip/count, strip-*, select, btn, dlgbtn, dialog-body/actions, toolbar(-rail),
view-head/target, float, panel, tab, row, method, conn-dot, tab-rail, tree-rail, thead/th/td,
statusbar, status, empty, menu-label, completion*, disclosure, kv-*); settings/title-bar names
(field-head, checkbox-row, sec-label, settings-pane, title-action(--labelled), title-bar-actions,
tab-new); aliases (mono, attribute-scoped muted/dim, p-sm, p-xs, p-push, icon-box); `def-*`;
`kui-*` A3-A7.

Gaps. Found by diffing every class selector in `6f6853c1:packages/theme/src/primitives.css` and
`6f6853c1:packages/workbench/src/workbench.css` against the script:

- **Unguarded pre-phase primitive names**: `p-seg`, `p-input`'s `stepper`/`step-btn`/
  `has-stepper`, `ph`/`ph-active`, `sugg-*`, `strip-action`, `dialog-body-inner`, `p-select`'s
  `bordered`, `p-empty`'s `big`, `p-td`'s `edited`. Most have 0 live uses. Two are live:
  - `step-btn` is live ×28 as a rule-less hook (§6a).
  - `bordered` survives legitimately as a `NativeSelect` variant *prop value*, not a class.

  Defect: nothing stops `p-seg` or `class="stepper"` from being reintroduced.
- **Unguarded workbench.css names**: `section-pane` (0 live) and `section-subhead`, live at
  `apps/kira-space/.../settings/GitPane.vue:92`, `:237`. It had no rule even pre-phase (see the
  old workbench.css comment), so it is a pre-existing dead hook, not a P110 regression.
  Judgment.
- **Unguarded scoped names retired in B-commits**: `muted-note`, `footer-status`, `segmented`
  (B33), `split`/`splitter` (B32), `spin`. `spin` is still live at `TreeRow.vue:149` as a test
  hook (`tree.spec.ts`), so it is a deliberate exception.
- **Scan-directory gap**: `check_class` scans Studio, Space, `packages/theme` and
  `packages/workbench` only. It never scans `GIT_UI_SRC`/`KIRA_UI_SRC`. `check_kui_class` scans
  those two, but only for `kui-*` names inside class attributes. A retired Studio name (`p-btn`,
  `mono`) pasted into git-ui or kira-ui goes undetected, and so does any name in a `:class`
  object key or a TS class-string const there. Defect.
- **Intentionally unguarded** (still live, by design): `field`, `field.checkbox`, `field-error`,
  `helper-text`, `tab-strip-actions`, `is-on`. Fine, but the script should list them in a comment
  so the omission reads as deliberate.

## Verdict

**Not native Tailwind yet. The shortfall is systematic, not a handful of stragglers.**

Genuine wins:

- Every global primitive is retired. `primitives.css` is true residue.
- `workbench.css` is empty.
- git-ui converged on default text/radius names.
- Badge/NativeSelect/ToggleGroup are real adoptions.
- No new `!`.

The re-wrap pattern still shows in five places:

1. **Live bugs from ignoring utility sort order (§1g).** 11 run-state labels, 3 search-match cells
   and the terminal failed footer set a static colour and a conditional colour on one element, so
   the conditional never shows. A mechanical translation of cascade-order CSS into utilities
   would produce exactly this.
2. **CSS kept where idioms exist (§4).** 48 `<style>` blocks against ~8 expected. About 35 exist
   only for hover/selected/group-hover/`::after`, justified by a recurring false premise.
3. **Named CSS classes in `@utility` clothing (§2a).** 10 composite bundles outside §5.3, some
   pasted compiled output. They defeat twMerge and directly caused the `virtual-row` regression
   and its 12-file duplication.
4. **Parallel scales and literal values instead of the default scale (§1, §2b).** About 55
   arbitrary-value sites have a default step, an existing token utility or a native v4 utility.
   §6.4's em rule was left undone in git-ui. `--spacing-kui-*` restates the defaults.
5. **Pasted strings instead of components (§6).** Run-state ×11, stepper ×14 pairs, toolbar ×31,
   dialog part overrides ×15-17. Field is borrowed as a class string instead of used.

Priority order for a fix phase:

1. §1g colour conflicts (user-visible bugs).
2. §6c settings field regression: verify visually, then fix.
3. §2a bundles and §4c `virtual-row`, together.
4. §4b hover/state blocks.
5. §6a components.
6. §1 arbitrary-value sweep.
7. §8 guard gaps.
