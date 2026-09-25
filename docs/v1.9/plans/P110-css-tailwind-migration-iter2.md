# P110 iter2 — fix plan: Tailwind quality audit findings

SPEC row: `docs/v1.9/SPEC.md` P110, same phase and number. Input: `plans/P110-tailwind-quality-
audit.md` (the audit, tree `621c6f68`). This plan re-verified every audit finding against the
current tree, `e0bd15cd`. §2 lists what the audit overstated, got wrong or missed. Template:
`plans/P110-css-tailwind-migration.md` (the iter1 plan). Its §1 rules still apply unless §1 below
changes them.

Opus plans, one sequential Sonnet implementer (§4), no review stage. Paths use iter1's shorthands:
`SF` = `apps/kira-studio/frontend/src`, `KF` = `apps/kira-space/frontend/src`, `PT` =
`packages/theme/src`, `PW` = `packages/workbench/src`, `GU` = `packages/git-ui/src`, `KU` =
`packages/kira-ui/src`, `ST` = `apps/kira-studio/tests`, `KT` = `apps/kira-space/tests`. Line
numbers are at `e0bd15cd`. Re-check each one when its commit starts.

Discovery method: CodeGraph `codegraph_explore` on the run-state blast radius (`useRunState`, 12
callers), the dialog parts (`DialogHeader`/`DialogFooter`/`DialogTitle`, 33-37 callers each) and
`useNumberStepper` (7 callers). Class conflicts were found with a Vue template AST scan
(`@vue/compiler-sfc`) plus both repo `cn()` configs. Every "X wins" claim below was checked against
real `@tailwindcss/node` 4.3.3 output, either compiled `dist/assets/index-B65hMeBa.css` or a
compile of the real `GU/theme/tailwind.css` root. None of it was assumed.

**Amendment (user decisions, on top of `e009dbaf`).** The user decided the four §6 items that this
plan first deferred. §3.11 designs them as I2-35..I2-39. §0, §1.3, §1.4, §3.1, §3.8, §6, §7 and §9
are updated to match. Discovery for the amendment:
- CodeGraph `codegraph_explore` on `alertVariants`/`Alert`, on the `ResizableHandle` blast radius
  (8 rendering components), on `applyAppearance` (runtime-set tokens) and on the `cn()` `twMerge`
  config.
- Class-token sites, which are not graph symbols: grep, plus a scratch usage-count scan that
  splits each colour and radius name by `PT/components/ui` vs app code.
- The shadcn-vue `resizable.json` registry source, fetched and read.
- reka-ui 2.10.5's `SplitterGroup`/`SplitterPanel` dist source.

Counts in §3.11 are at `e009dbaf`.

## 0. Goal and acceptance

Goal: remove every audit defect that still holds, plus the regressions the audit missed. The
code should use Tailwind's own merge, variant and scale system, not CSS rewritten as utilities.

Acceptance (orchestrator runs each, §9):

1. **No same-property fights.** `bun scripts/check-class-conflicts.ts` (new, §3.1) passes. It runs
   inside `bun run lint`. Every element's static class set is twMerge-stable. No conditional
   literal shares a group with a static class unless the binding goes through `cn()`.
2. **Merge configs complete.** Every `--text-*`, `--spacing-*`, `--radius-*`, `--shadow-*`,
   `--animate-*` and `--leading-*` name in `PT/base.css`'s and `KU/theme/tailwind-theme.css`'s
   `@theme` blocks sorts into its own group in the matching `cn()`. The conflict script checks
   this itself (§3.1).
3. **Live bugs fixed** (§3.2-§3.4). Run-state label goes `info`/`error`. Current-match text goes
   `text-bg`. The terminal failed footer goes red. Kui rows keep `kv:text-kui-fg` and
   `kv:text-kui-base`. The 7 static-pair regressions render their pre-phase values. Both gutters
   regain their right border.
4. **`@utility` count is 4.** `grep -c '^@utility' PT/base.css` = 4: `scrollbar-none`,
   `swatch-none`, `wails-drag`, `wails-no-drag`.
5. **`<style>` blocks = 5.** `grep -rlE '^<style' --include=*.vue apps packages` (excluding
   node_modules) lists exactly these: `SF/editor/MonacoHost.vue`,
   `SF/workbench/panels/OperationsPanel.vue`, `SF/views/httprequest/ResponseDiffDialog.vue`,
   `KF/views/repo/RepoFileView.vue` and `GU/components/CommitGrid.vue`. Each one holds only its
   §5.9 stays-CSS rules.
6. **Components, not pasted strings.**
   - `runStateLabel` exists only in `RunState.vue`.
   - `step-btn`, `useNumberStepper`, hand-written `data-slot="field"` and `<Label :class="fieldVariants()` return 0 hits outside `PT/components/ui/`.
   - No `<DialogHeader|DialogFooter|DialogTitle` carries the old per-site override strings.
   - The `h-bar shrink-0 flex items-center` literal appears only in `ViewToolbar.vue`.
7. **Arbitrary values.** Every §3.7 site is converted. What remains is on iter1's §1.2 allowlist or
   in §1.2 below.
8. **Guard.** `scripts/check-theme-classes.sh` scans GU/KU for every retired name (§3.8). Every
   name this iter retires is guarded. The I2-37/I2-38 alias checks also scan `PT/components/ui`,
   which every other check excludes (§3.11.3).
9. **Tokens.** `--kira-gap`, `--kira-window-inset`, `--kira-toolbar-h`, `--kira-viewhead-h` and
   `--spacing-kui-1..6` are gone. No comment still cites them.
10. **Settings covered.**
    - Studio `ST/visual/settings.spec.ts` and a new Space visual project hold baselines recorded before any settings change (§3.6).
    - Every later commit passes them unchanged, except the §1.4 disclosed list.
11. **Suites.** `bun run lint`, `bun run typecheck`, `bun run test:unit`, `build:studio`,
    `build:space` and `build:vscode` all pass. `test:ui:studio`, `test:ui:space` (P114's known
    `repo-workspace.spec.ts:444` excepted, its own phase) and `test:webview` pass.
    `test:visual:studio` and `test:visual:space` pass. The only re-records are the §1.4 disclosed
    changes, each named in its commit body.
12. **One spinner speed** (§3.11.1).
    - `kira-spin` returns 0 hits in `.vue`/`.ts`/`.css`.
    - `codicon-modifier-spin` returns 0 hits in `.vue`.
    - Every spinner uses `animate-spin` (1s).
13. **One error alert** (§3.11.2).
    - `alertVariants` has no `err` key.
    - No `<Alert>` passes `variant="err"`.
    - `error-text` returns 0 hits outside comments.
14. **One name per value** (§3.11.3).
    - The PT root declares no alias pair from the §3.11.3 table.
    - `shadcn-bridge.css`'s `@theme inline` keeps exactly 4 names: `--color-primary`, `--color-primary-foreground`, `--color-muted-foreground` and `--color-border`. It keeps no `--radius-*`.
    - The alias guard passes.
15. **Resizable only** (§3.11.4).
    - A value import of `SplitterGroup`/`SplitterPanel` from `reka-ui` exists only under `PT/components/ui/resizable/`.
    - `<SplitterGroup` and `<SplitterPanel` return 0 template hits outside it.

## 1. Conventions

### 1.1 Restated from iter1 (unchanged)

- **Escape-hatch ladder**, stop at the first rung that fits:
  1. default-scale utility
  2. existing `@theme` token utility
  3. new token, only on 3+ recurrences or a design seam, with the reason in the commit body
  4. arbitrary value, allowlisted only
- **No new `!`.** A utility that loses to an unlayered rule means that rule converts in the same
  commit.
- **Replace, never add alongside.** Keep the value that renders today, or the pre-phase value when
  §3.4 names a regression, and delete the other.
- **Complete class literals only.** Conditionals use a ternary or a lookup map of whole names.
- **Through `cn()`.** A `class` prop that overrides a component base goes through
  `cn(base, props.class)`.
- **`<script setup lang="ts">`** everywhere. shadcn-vue, VueUse, Pinia and TanStack Query first
  (CLAUDE.md).

### 1.2 New rules this iter adds

- **One element, one value per group.** A conditional class that shares a twMerge group with a
  static class on the same element must take one of two forms:
  - a ternary or lookup map whose branches each hold the whole group, so the static half moves
    into the map, or
  - a `cn(static, conditional)` binding.

  In-repo precedent: `SF/api/MethodSelect.vue:57-62`
  (`cn('… text-fg …', methodTextClass(…))`). A plain static-plus-`:class` pair is banned. The §3.1
  script enforces this.
- **Row components take `class`.** Any component whose root a parent restyles
  (`absolute`/`sticky`/`z-*`) declares `class?: HTMLAttributes['class']` and renders
  `cn(base, state, props.class)`. Fallthrough concatenation does not dedupe. That gap is the root
  cause of the iter1 `virtual-row` revert (§3.5).
- **Test hooks are `data-testid`, never a bare class.** A class that exists only for a spec
  selector (`step-btn`, `twisty`, `spin`, `label`, `row`, `text-prompt-title`) moves to a
  `data-testid` in the commit that touches that element. The spec moves in the same commit.
- **Allowlist additions** (iter1 §1.2 plus these, nothing else):

  | Value | Where | Reason |
  |---|---|---|
  | `min-w-[7ch]` | `SF/views/shared/RunState.vue` only | `ch` width for a digit field. One site once componentised |
  | `shadow-[inset_2px_0_0_var(--primary)]` | `SF/views/shared/document/DocumentRow.vue` | Moves from `@apply` onto the element. No inset-shadow step carries a colour var |
  | `kv:[font:inherit]` | GU/KU `<button>`/`<input>` sites | git-ui has no preflight. Font shorthand reset, no utility |
  | `kv:text-[0.5em]` | `GU/components/FileTree.vue:621`, `:748` | Modified-dot glyph scaled to its row. No step within 1px |
  | `kv:text-[24px]`, `kv:text-[32px]` | `EmptyRepositoryPanel`/`GitBlockedPanel`/`NoRepositoryPanel` | Glyph sizes in a root that resets `--text-*`. 32px ×2 and 24px ×1, below the rung-3 bar |
  | `leading-[normal]`, `leading-[inherit]` | `SF/views/shared/AutocompleteField.vue` overlay only | Must match the real input's `line-height: normal`, and the grow variant's inherited one |

### 1.3 CodeGraph, tests, commits, resumability

- **CodeGraph.** This plan names every file and change, so the implementer needs no
  `codegraph_explore` call except in two cases:
  - A grep surfaces a consumer this plan does not name, such as a new conflict from §3.1's first
    run or an extra `.twisty` spec selector. Call `codegraph_explore` for its blast radius before
    editing. Load it with `ToolSearch` "codegraph".
  - §8's drift re-check.
- **Tests.**
  - No new unit tests (CLAUDE.md bar). The conflict script is itself the check.
  - One assertion is added to an existing UI test: the run-state label colour while running, in
    `ST/ui/data-view.spec.ts` near `:1100`. Nothing guarded that regression, and it shipped.
  - The visual specs in §3.6 are new baselines, not unit tests.
- **Commits.**
  - Conventional Commits. The subject ends with the tag, e.g. `(P110 I2-7)`.
  - One item may land as several commits, one per file or file group. All of them carry the same
    tag.
  - The pre-commit hook (`bun run lint` + `bun run typecheck`) passes on every commit. Never use
    `--no-verify`.
  - Fast checks per commit: the hook, plus `build:studio`/`build:space` when a commit touches
    `@theme`, a `cn()` config or a Tailwind root.
  - Expensive suites run once, at I2-33. I2-35..I2-39 all sit before it in §7.
- **Resumability.** Every decision is in this file.
  - §7's row order is the execution order. The amendment tags I2-35..I2-39 sit at their execution
    slots, not at the end: I2-35 follows I2-2, and I2-36..I2-39 follow I2-32.
  - To resume, run `git log --oneline --grep 'P110 I2-'`. Resume at the first §7 row, in table
    order, whose tag is missing.
  - For a tag that is partly landed, re-grep that item's own "done when" check in §7 and continue
    with the files still failing it.
  - I2-1's measurements are committed into §3.6.4 of this file before anything depends on them.

### 1.4 Disclosed visual changes

Pre-approved: each one restores the pre-phase or plan-intended rendering.

- The run-state label goes `info`/`error` (iter1 plan §5.4's own intent).
- Current search-match text goes `text-bg` on 3 sites.
- The terminal failed footer goes `text-error`.
- Kui menu and list rows regain `kv:text-kui-fg` (non-selected) and `kv:text-kui-base` (selected).
  KuiTextInput regains `kv:text-kui-fg`.
- `PreviewCommandPanel` header goes back to `normal-case tracking-normal`. `ExplainResultView:170`
  goes back to `text-kira-sm`. Console result tabs go back to `h-5.5`. DateTimePicker day cells go
  back to `h-5.5`. `ConsoleSavedMenu:117` shows the accent colour.
- The KeyValuePane and StreamView gutters regain a 1px `border-border-strong` right border.
- Nearest-step changes of 1px or less:
  - `leading-[1.4]` becomes `kv:leading-snug`.
  - `tracking-[0.06em]` becomes `kv:tracking-wider`.
  - git-ui em literals follow iter1 §6.4. Keep any site whose nearest step moves it more than 1px
    and add it to §1.2 with its measured size.

**User-approved** (§6, I2-35/I2-36). Name each in its commit body:

- Spinners: 0.7s becomes 1s on the 12 `animate-kira-spin` sites. The git-ui restack spinner
  (`AppToolbar.vue:324`) changes from codicon's 1.5s stepped spin to a smooth 1s spin.
- The 2 StreamView error alerts take the `destructive` look:
  - They lose the `error/10` tint and the `error/20` border. They gain the elevated card surface
    and the default border.
  - The message text goes from full `text-error` to `text-error/90`.

I2-37, I2-38 and I2-39 are pixel-identical by construction (§3.11.3, §3.11.4). Any diff there is
a bug in that commit, not a disclosure.

**Conditional.** Fix only if I2-1 or I2-21 measures it as real. Report it in the commit body.

- The settings-field regressions (§3.6).
- The DialogFooter overshoot (§3.10).

**Any other visible change stops the implementer.** Write it in the commit body and ask the
orchestrator. §6 records the user decisions folded in as I2-35..I2-39 and the items still out of
scope.

## 2. Audit corrections (verified at `e0bd15cd`)

### 2.1 Stale or overstated

| Audit claim | Actual |
|---|---|
| §4: 48 `<style>` blocks, 1,563 lines | **47 blocks, 1,378 non-blank lines** (anchored `^<style`). "47 `.vue` + CommitGrid" double-counts: CommitGrid is one of the 47. An unanchored grep also counts comment mentions (`SlickGridHost`, `CommitMeta`, workbench `StatusBar`) |
| §2a: `columns-menu-*` has one consumer | **Two**: `SF/views/grid/ColumnsMenu.vue` and `ProjectionMenu.vue` (`-loading` at `:109`/`:88`, `-footer` at `:149`/`:105`). Still below the 4+ component bar, so inline utilities |
| §1c/§3: `.update`/`.blame` `font: inherit` is dead under Preflight | **Not dead.** The element also carries `text-kira-sm`. The unlayered `font: inherit` beats that layered utility, so the button renders at the parent's size, not `text-kira-sm`. `.update`'s `@apply text-info` also beats a static `text-fg` on the same element. Deleting the block as "dead" changes both size and colour. §3.5.3 has the exact fix |
| §6c: every settings field "now renders medium-weight and cross-axis centred"; "probable visual regression" | **Overstated.** At `6f6853c1` the wrapper was also shadcn `Label`, and its base carried `flex items-center gap-2 text-sm leading-none font-medium` (`6f6853c1:PT/components/ui/label/Label.vue:19`). The unlayered `.field` overrode only display, direction, gap and font-size. So medium weight, `items-center` and `leading-none` predate P110. `cn(Label base, fieldVariants())` reproduces the old net result (gap 4px, `text-kira-sm`). Unproven either way until measured. I2-1 measures before any fix (§3.6). The idiom defect stands regardless: `fieldVariants()` borrowed onto `Label`, 13 hand-written `data-slot="field"`, `FieldLabel` unused |
| §6a: `step-btn` is a rule-less leftover hook | It is also a **live spec selector** (`ST/ui/connections.spec.ts:306`). It moves to `data-testid`, not a plain delete |
| §6a: toolbar string ×31 | **36 sites, 7 shapes**: 18 base with `border-b border-border`, 12 bare, 4 `gap-1` with border, 3 with `bg-elevated`, 1 `border-t`, 1 conditional border, 1 `overflow-x-auto`. 35 are Studio, 1 is Space (`KF/views/repo`) |
| §6b: `DialogTitle` override in 15/18 | **17/18.** Header 17/18 and footer 16/17 confirmed |
| §2a: fix `empty-state` via a local `EmptyState.vue` | 19 of its 20 template uses sit on `<Alert>` (`role="alert"`), a semantic misuse: screen readers announce an empty list as an alert. shadcn-vue ships `empty` (`Empty`/`EmptyMedia`/`EmptyTitle`/`EmptyDescription`). CLAUDE.md routes primitives to shadcn-vue, so use that. No spec depends on `role="alert"` (grepped) |
| §6a: run-state is one component | Confirmed. P104 inlined `RunState.vue` when it had 1 site (P104 plan table, `:65`/`:234`). Inlining `ViewChrome` into 11 views then multiplied it. P104's premise no longer holds, so the component comes back |
| §1g: "no other same-family static pair" | **False.** §2.2 M3 lists 6 more user-visible regressions |

Confirmed as stated (counts re-grepped at `e0bd15cd`):

- §1a: `font-[family-name:var(--kira-font-data)]` ×9, `…font-ui` ×2, `text-[length:…]` ×1,
  `text-[var(--kira-accent)]` ×2, `bg-[var(--kira-state-on)]` ×1, `z-[var(--kira-z-*)]` ×3,
  `w-[var(--total-width)]` ×1.
- §1b: every compile claim re-checked in the real `kv` root. `kv:max-w-120/105/65`, `kv:w-1.25`,
  `kv:px-0.75`, `kv:top-0.75`, `kv:max-h-7/10`, `kv:saturate-160`, `kv:contrast-115`,
  `kv:leading-snug`, `kv:tracking-wider` and `kv:leading-3.5` all emit.
- §1c: `mask-contain/no-repeat/center`, `wrap-anywhere` and `outline-none` emit in both roots.
  `[overflow-wrap:anywhere]` ×5 and `font-[inherit]` ×11 confirmed.
- §1d: em/px literal counts confirmed.
- §1g: the 15 colour bugs confirmed from emit offsets: `text-subtle` 63167 > `text-info` 62767;
  `text-muted-foreground` 62830 > `text-bg` 62091 and > `text-error` 62615.
- §2b: `--spacing-kui-1..6` equals 2/4/6/8/12/16px through both bridges. `--kira-s-*` and
  `--kv-s-*` are literal and not redefined anywhere.
- §2d: the 4 orphan tokens are defined only in `PT/tokens.css:71`, `:74`, `:100`, `:105`. Comment
  mentions only: `PW/components/WorkbenchShell.vue:110`, `:128`, `:215`;
  `ST/ui/control-sizing.spec.ts:20`.
- §8: guard gaps confirmed, with one addition (M10).

### 2.2 Missed by the audit

- **M1. kira-ui `cn` drops real classes. Live.**
  - Cause: `KU/cn.ts`'s `twMergeKv` registers `text: ['kui-icon']` only, so `kv:text-kui-xs`,
    `-sm` and `-base` read as colours.
  - `kuiRowVariants` (`KU/rowVariants.ts:18-37`) runs through `cn`. Non-selected rows lose
    `kv:text-kui-fg`. Selected rows (`kv:text-kui-selected-fg`) lose `kv:text-kui-base`.
  - `KU/KuiTextInput.vue:21`, `:38` lose `kv:text-kui-fg`.
  - `GU/components/FileTree.vue:250-260` `rowClass` is exposed the same way.
- **M2. Studio `cn` gaps.**
  - `max-w-completion-max-w` is unregistered (the audit saw this but rated it judgment).
  - `cn('animate-spin animate-kira-spin')` keeps both, because `animate` lacks `kira-spin`.
    **Superseded by I2-35.** The user unified spinners on `animate-spin`, so `animate-kira-spin` is
    deleted rather than registered.
- **M3. Static same-property regressions.** Each one is a primitive-plus-override pair,
  mechanically merged, where emit order now picks the primitive's value:
  - `SF/views/grid/PreviewCommandPanel.vue:61`: `normal-case tracking-normal … uppercase
    tracking-wider`. `uppercase`/`tracking-wider` win. Pre-phase `.preview-panel-header { @apply
    normal-case tracking-normal }` won.
  - `SF/views/console/ExplainResultView.vue:170`: `text-kira-sm … text-kira-xs`. `xs` wins.
    Pre-phase `p-sm muted` meant `text-kira-sm`.
  - `SF/views/console/ConsoleView.vue:953`: `h-control-lg … h-5.5`. `h-control-lg` wins. Pre-phase
    `.result-tab { h-5.5 }` won.
  - `SF/views/shared/DateTimePicker.vue:290`, `:308`, `:322`: `h-control … h-5.5`. `h-control`
    wins. Pre-phase `.dtp-day` had `h-5.5`.
  - `SF/views/console/ConsoleSavedMenu.vue:117`: `text-fg … text-[var(--kira-accent)]`.
    `text-fg` wins, so the accent never shows. The audit cited this line for spelling only.
- **M4. Lost gutter divider.** `SF/views/shared/keyvalue/KeyValuePane.vue:1145` and
  `SF/views/stream/StreamView.vue:1214` carry `border-r-border-strong` with no `border-r` width.
  Pre-phase `.p-td` set `border-right: 1px` and `.p-td.gutter` set its colour. B29 (`667642e8`)
  dropped the width. A repo-wide scan finds no third site.
- **M5. Sticky-row background hazard.** `.sticky-row { background: var(--kira-bg) }` loses today to
  the row's own `.x.selected`/`.x:hover` rules on specificity. A naive `bg-bg` passed from the
  parent through `cn` would instead beat `bg-select`. §3.5 moves the rest-state background into
  the row's own ternary.
- **M6. Test-hook classes that look like utilities.**
  - `text-prompt-title` (`PW/prompt/TextPromptDialog.vue:47`) reads as a text-colour utility to
    twMerge.
  - Stray `row` (`SF/api/MethodSelect.vue:56`), `label` (run-state ×11) and `spin`
    (`SF/project/TreeRow.vue:149`, `tree.spec.ts`).
- **M7. Redundant pairs.**
  - `peer-focus-visible:outline peer-focus-visible:outline-2` ×4:
    - `SF/api/VariableSetView.vue:620`
    - `SF/project/ConnectionDialog.vue:796`
    - `SF/workbench/settings/ScriptsPane.vue:186`, `:268`
  - `kv:focus-visible:outline kv:focus-visible:outline-1` ×4: `UncommittedChangesStrip:128`,
    `ReviewCommitRow:211`, `KuiSearchInput:95`, `KuiSelect:33`.
  - Fragile static pairs that render right today only by emit luck:
    - `ConsoleResultGrid:427` `whitespace-nowrap whitespace-pre-wrap`
    - `KeyValuePane:1084` `border … border-0`, `rounded-kira … rounded-none`, duplicate `min-h-0`
  - `border-border-strong` + conditional `border-error` ×11 is fixed by I2-3.
  - `DateTimePicker:290` `text-fg` + conditional `text-subtle`.
  - `leading-*` placed before a text size: twMerge-only. `cn('leading-none text-sm')` drops the
    leading. Relevant once any of these strings goes through `cn`.
- **M8. `.kira-ed-var*` duplicated.** The same `:deep` rules sit in `SF/editor/MonacoHost.vue` and
  `SF/views/shared/AutocompleteField.vue`.
- **M9. DialogFooter overshoot (suspected, pre-existing).**
  - `cn(base, 'border-t border-border bg-transparent')` keeps the registry's `-mx-4 -mb-4 p-4
    rounded-b-xl`.
  - The consumers' `DialogContent` sets `p-0`, and only 1 of them sets `overflow-hidden`.
  - Result: the footer box probably extends 16px past the content's left, right and bottom edges.
  - This predates P110: `6f6853c1` had the same `class="border-t border-border"`.
  - I2-21 measures it (§3.10).
- **M10. Guard extension blockers.**
  - `kv:text-muted` ×110 in 30 GU/KU files would trip `check_class 'text-muted'` the moment GU/KU
    are scanned.
  - GU/KU JSDoc comments name retired classes as prose: `KU/KuiButton.vue:66` `.p-btn`,
    `KU/rowVariants.ts:5` `.p-row`, `muted` ×10, `icon-box` ×4. `KU/cn.ts:38` holds `'icon-box'`
    as a merge-config token.
  - So a naive scan-dir add fails on non-regressions. §3.8 designs around it.
- **M11. View-header chrome pasted ×11.** The rail dot, icon, target and rail bar are inlined from
  P104's `ViewChrome`. This is the same defect shape as the toolbar, but no audit category covers
  it. **Not in this plan.** Reported for the orchestrator to raise.

## 3. Design per category

### 3.1 Category 1 — colour and same-property cascade (I2-2..I2-9)

**Merge config (I2-2).**

- `PT/lib/utils.ts`: add `completion-max-w` to `spacing`. **Do not** add an `animate` entry:
  I2-35 deletes `--animate-kira-spin` next (§3.11.1), and no other custom `--animate-*` exists.
- `KU/cn.ts`: add `kui-xs`, `kui-sm` and `kui-base` to `text`.
- Verify with a node one-liner, not by reading:
  - `cn('text-fg text-kira-sm')` keeps both.
  - `twMergeKv('kv:text-kui-fg kv:text-kui-base')` keeps both.
- Commit body: the before/after `kuiRowVariants()` output for `selected: false` and `true`.

**Conflict script (I2-3), `scripts/check-class-conflicts.ts`, run by bun.**

- Parse every `.vue` under `SF`, `KF`, `PT`, `PW`, `GU` and `KU` with `vue/compiler-sfc`. Import
  the public `vue/compiler-sfc` path, never the `.bun/` store path.
- Parse each `:class` expression with the `typescript` compiler API. It is already a devDependency,
  so the script adds no new dependency.
- For each element:
  - static tokens = the `class` attribute.
  - conditional literals = every string literal and every string or identifier object key in the
    `:class` expression.
  - Skip the pair check when the `:class` root is a `cn(...)` call (`cn`, `twMergeKv`): it merges
    at runtime.
- Merge function per token: `kv:`-prefixed tokens go to `KU/cn.ts`'s `cn`, the rest to
  `PT/lib/utils.ts`'s `cn`. Import both. No new exports are needed.
- Fail when:
  1. `merge(static)` ≠ `static`, with whitespace normalised, meaning a static duplicate or conflict.
  2. For any conditional literal `c`, `merge(static + ' ' + c)` drops a static token.
- **Registration self-check.** Read the `@theme` blocks of `PT/base.css` and
  `KU/theme/tailwind-theme.css`. For each `--text-X` assert that `merge('text-red-500 text-X')`
  keeps both (size, not colour) and `merge('text-xs text-X')` keeps one. Do the same for
  `--spacing-X` via `p-1 p-X`, `--radius-X` via `rounded-md rounded-X`, `--shadow-X` via
  `shadow-md shadow-X`, `--animate-X` via `animate-spin animate-X` and `--leading-X` via
  `leading-4 leading-X`. This makes acceptance 2 self-enforcing: a new token without registration
  fails lint.
- Output: `file:line  <kind>  <static> vs <conditional>`, one line each, exit 1 on any hit.
- Land I2-3 **unwired**: the script plus `bun scripts/check-class-conflicts.ts` in the commit body.
  I2-4..I2-8 fix every hit. Its first run is expected to match §2.2 M3/M7 and audit §1g. A hit
  outside those lists gets `codegraph_explore` first, then a fix in the matching commit below.
- I2-9 wires it into `package.json` `lint`: `… && sh scripts/check-theme-classes.sh && bun
  scripts/check-class-conflicts.ts`.

**Fix shapes:**

- **I2-4 `RunState.vue`**, new at `SF/views/shared/RunState.vue`, 11 consumers:
  - Views: `EnvironmentsView:253`, `VariableSetView:498`, `BrowseView:359`, `ConsoleView:859`,
    `DefinitionView:288`, `DocumentView:878`, `DataView:272`, `GrpcRequestView:419`,
    `HttpRequestView:628`, `KeyValuePane:775`, `StreamView:846` (outer-span lines).
  - Prop `state: RunStateVm`, from `SF/state/runState.ts`. The label `computed`, currently copied in
    all 11 views, moves in, and each view deletes its copy.
  - Colour is a lookup map, no `cn` needed:
    - `TONE = { idle: 'text-subtle', running: 'text-info', error: 'text-error' }` on the outer span
      (`inline-flex items-center gap-1 font-data text-kira-xs`).
    - `RING = { idle: 'border-border-strong', running: 'border-primary border-r-transparent
      animate-spin', error: 'border-error' }` on `size-3 shrink-0 rounded-full border-2`.
      `animate-spin`, not `animate-kira-spin`: I2-35 has already moved all 11 view copies.
    - `border-primary border-r-transparent` equals today's four longhands. The side longhand emits
      after the shorthand (compile-verified: `border-r-border-strong` > `border-border`).
  - Keep `data-testid="run-state"` and `"run-state-label"`. Drop the stray `label` class.
  - Add a colour assertion to the existing run-state test in `ST/ui/data-view.spec.ts` (`~:1100`):
    while running, the label's computed `color` equals `--kira-info`.
- **I2-5 current match text:**
  - `SF/views/console/ConsoleResultGrid.vue:415`: static `text-muted-foreground`, conditional
    `text-bg` at `:419`. Replace with `isCurrent ? 'text-bg' : 'text-muted-foreground'`.
  - `KeyValuePane.vue:1148`, `:1166`: static `text-fg`, conditional `text-bg` at `:1152`, `:1170`.
    Replace with the same ternary shape.
- **I2-6 terminal footer:** `PW/terminal/TerminalHostView.vue:54`. Replace with
  `failed ? 'text-error' : 'text-muted-foreground'` on the real condition name.
- **I2-7 M3 regressions.** Delete the losing token and keep the pre-phase value:
  - PreviewCommandPanel: drop `uppercase tracking-wider`.
  - ExplainResultView: drop `text-kira-xs`.
  - ConsoleView result tab: drop `h-control-lg`.
  - DateTimePicker ×3: drop `h-control`.
  - ConsoleSavedMenu `:115`/`:117`: `text-[var(--kira-accent)]` becomes `text-primary`, per audit
    §1a, and `:117` drops `text-fg`. Check `--primary` = `--kira-accent` in `shadcn-bridge.css`
    first.
  - Gutters (M4): add `border-r` to `KeyValuePane:1145` and `StreamView:1214`.
  - Run `git show 6f6853c1:<file>` for each one first and quote the pre-phase rule in the commit
    body.
- **I2-8 M7 redundancies and SettingsShell:**
  - `outline outline-2` becomes `outline-2`. `kv:…outline kv:…outline-1` becomes `kv:…outline-1`.
    Compile-check that computed `outline-style`/`outline-width` are unchanged in both roots before
    committing.
  - `whitespace-nowrap whitespace-pre-wrap` becomes `whitespace-pre-wrap`.
  - `KeyValuePane:1084`: keep `border-0 rounded-none` and one `min-h-0`.
  - `DateTimePicker:290`: the colour pair becomes a ternary.
  - Every `leading-*`-before-size string that the script flags: move the `leading-*` after the size.
  - `SF/workbench/SettingsShell.vue:223` `'bg-select! text-fg!'`: becomes a ternary with the
    non-selected branch's own classes. That removes the `!`.

### 3.2 Category 3 — the 10 extra `@utility` bundles (I2-10..I2-15)

Delete each bundle from `PT/base.css` in the commit that moves its last consumer. Add its guard
line in the same commit.

- **I2-10/11 `empty-state`, `-icon`, `-title`.**
  - Fetch shadcn-vue `empty` using iter1 §5.7's direct-curl procedure:
    `https://shadcn-vue.com/r/styles/reka-nova/empty.json`. Write `files[].content` under
    `PT/components/ui/empty/` and rewrite `@/…` imports to `@theme/…`. License: MIT, same registry
    as `field`.
  - Restyle the owned bases to today's computed look:
    - `Empty`: `flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center`. That
      is the current `empty-state` minus its no-op border/bg reset.
    - `EmptyMedia` default: `text-subtle`.
    - `EmptyTitle`: `text-kira-md text-muted-foreground font-normal`.
    - `EmptyDescription`: match what the converted sites show today.
  - Convert the 20 `class="empty-state"` sites (16 files). `<Alert class="empty-state">` +
    `AlertTitle`/`AlertDescription` becomes `<Empty>` + `EmptyTitle`/`EmptyDescription`. Icons go
    in `EmptyMedia`. Keep every `data-testid`. One non-`Alert` site takes `<Empty>` as well.
  - Also absorb the 5 pasted `flex-1 min-h-0 flex flex-col items-center justify-center gap-2`
    strings (the iter1 `p-empty` successor) where the element is an empty state. Check each one's
    `text-subtle`; it goes in `EmptyMedia` or on `Empty` via `class`.
  - Guard: `empty-state`, `empty-state-icon`, `empty-state-title`.
- **I2-12 `columns-menu-*`.** Inline the utilities from the bundle bodies (`PT/base.css`
  `columns-menu-inner…footer`) into `ColumnsMenu.vue` and `ProjectionMenu.vue`. Do not use the
  audit's approximations; e.g. `columns-menu-header` is `flex gap-1 border-b border-border p-1`.
  Guard all 5 names.
- **I2-13 `twisty`.**
  - New `PW/components/TreeTwisty.vue`: a `<button type="button" tabindex="-1">` with
    `flex size-3.5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0
    text-muted-foreground`.
  - Props: `expanded`, `hasChildren`. A chevron `CodiconIcon`, `:aria-label` from `expanded`,
    `invisible` when there are no children, and `emit('toggle')`.
  - `data-testid="tree-twisty"`.
  - 4 consumers: `SF/project/TreeRow.vue`, `SF/api/CollectionRow.vue:134`, `KF/repo/RepoTreeRow.vue:99`
    and `KF/repo/GitPanel.vue`. Read each one's current markup first. A consumer whose click
    semantics differ (e.g. `@click.stop`) keeps them through the emit.
  - `RepoSearchRow.vue`'s twisty deliberately lacks `cursor-pointer` (the `base.css` comment says
    so). It takes the component with `class="cursor-default"` through `cn`.
  - Move every `.twisty` spec selector to `[data-testid="tree-twisty"]`:
    `ST/ui/mutations.spec.ts`, `fake-data.spec.ts`, `tree.spec.ts`, and any `KT` hit (grep
    `'\.twisty'` in `ST`, `KT` and `apps/kira-space-vscode/tests`).
  - Guard `twisty`.
- **I2-14 `tree-row` and row state.**
  - `TreeRow.vue:112`, `CollectionRow.vue:115`, `RepoTreeRow.vue:82` and `KF/repo/RepoSearchRow.vue`
    each declare `class?: HTMLAttributes['class']`, with `inheritAttrs` left true for testids.
  - Root binding: `cn('relative flex items-center gap-1 pr-2 h-row text-kira-md whitespace-nowrap
    select-none cursor-default', stateClass, props.class)`. `stateClass` is:
    - `selected ? 'bg-select' : sticky ? 'bg-bg hover:bg-hover' : 'hover:bg-hover'`
    - `sticky` is a prop. TreeRow already has one. Add it to the other two row components that
      render inside a sticky layer.
  - Delete each file's `<style>` block (hover/selected rules). Replace `TreeRow`'s `spin` hook
    with `data-testid="tree-row-spinner"` and update `tree.spec.ts`.
  - Selected beat hover pre-phase on specificity, so the ternary is exact.
  - Delete `@utility tree-row`. Guard `tree-row` and `spin`.
- **I2-15 `virtual-row`/`sticky-row`.**
  - Export from `PW/util/virtualRows.ts`, next to `useVirtualRows`:
    - `VIRTUAL_ROW_CLASS = 'absolute top-0 left-0 w-full'`
    - `STICKY_ROW_CLASS = 'absolute left-0 right-0 z-1'`
  - Parents bind `:class="VIRTUAL_ROW_CLASS"` or `STICKY_ROW_CLASS`. On a row component, `cn` drops
    its `relative`. On a plain div there is no conflict (script-checked).
  - Parents: `KF/repo/RepoFileTree.vue`, `KF/repo/RepoSearchView.vue`, `SF/api/CollectionsTree.vue`,
    `SF/project/ProjectTree.vue:204`, `:219`, `SF/views/browse/BrowseView.vue`,
    `SF/views/console/ConsoleResultGrid.vue`, `SF/views/documents/DocumentView.vue`,
    `SF/views/stream/StreamView.vue` and `SF/workbench/panels/OperationsPanel.vue` (×3 sites).
  - The sticky background goes in the row's own ternary (I2-14), never in the parent (M5).
  - Delete the 9 `.virtual-row`/`.sticky-row` scoped copies and `PT/base.css`'s revert comment
    (`:165-178`). Guard `virtual-row` and `sticky-row`.
  - Check: the `tree.spec.ts` sticky/virtual scroll tests and a manual `bun run build:studio`
    compiled-CSS grep showing no `.virtual-row` selector.

### 3.3 Category 2 — remaining `<style>` blocks (I2-16..I2-20)

Mechanism per selector. "Ternary" means one class string per state, each holding the whole group
(§1.2). Use named groups (`group/row`, `group/tab`) whenever an ancestor could also be a `group`.

| File | Selector(s) | Mechanism |
|---|---|---|
| `SF/views/console/ConsoleResultGrid.vue` | `.row` hover/selected; `.row:hover .cell:not(.selected)` | `group/row` on the row; the cell gets `selected ? 'bg-select' : 'group-hover/row:bg-hover'` |
| `SF/views/console/ConsoleView.vue` | `.result-tab` hover/active; `.result-tab:hover .result-close` | Tab ternary; close gets `isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'` |
| `SF/views/console/ExplainResultView.vue` | `.verdict.warn`, `.issue-list li` | Ternary on the verdict; utilities on the `<li>` |
| `SF/views/definition/{Columns,Constraints,Indexes}Section.vue` | `.definition-table td` / `td:last-child`; `.header-key.is-fk`; ref-link hover | `border-r border-border last:border-r-0` on each `<td>`; `is-fk` ternary; `hover:text-primary` |
| `SF/views/documents/DocumentView.vue` | `.doc-preview-match` under `.search-match-current`; `mark` | `in-[.search-match-current]:text-bg` (compile-verified); `mark` utilities on the template `<mark>`, or `[&_mark]:` on its parent when it is `v-html` |
| `SF/views/shared/document/DocumentRow.vue` | `.doc-head:hover`, `.open > .doc-head`, `.selected > .doc-head` | On doc-head: `open ? 'bg-elevated' : 'hover:bg-hover'`, plus the allowlisted inset shadow when selected. Check the pre-phase precedence of open vs selected and write it in the commit |
| `SF/views/grid/ColumnsMenu.vue` | `.is-dragging` | Ternary |
| `SF/views/browse/BrowseView.vue` (75 lines) | 14 plain `@apply` rules, crumb `is-current`, `.list-body .no-rows`, `.empty`, `.browse-row` hover/selected | Inline each; crumb ternary; `h-full` on the no-rows element; row ternary |
| `SF/views/grpcrequest/CallHistoryList.vue`, `SF/views/httprequest/ResponseHistoryList.vue` | `.history-row.is-viewing` | Ternary |
| `SF/views/grpcrequest/ResponsePane.vue` | message-header hover | `hover:` |
| `SF/views/httprequest/ResponsePane.vue` | `.pane-jump-link:hover` | `hover:text-fg` |
| `SF/views/httprequest/TimelinePane.vue` | `[data-present='false']` | `data-[present=false]:opacity-60` (compile-verified) |
| `SF/views/httprequest/ResponseDiffDialog.vue` | `.diff-header-row.{added,removed,changed} .diff-header-status` | Lookup map on the status span. **Keep** `.diff-merge-host :deep(.monaco-diff-editor)` |
| `SF/views/grpcrequest/GrpcRequestView.vue`, `SF/views/httprequest/HttpRequestView.vue` | comment only | Delete the block |
| `SF/views/shared/keyvalue/KeyValuePane.vue` | kv-row hover, rest | `hover:`, ternary |
| `SF/views/stream/StreamView.vue` | stream-row current/match/selected/hover; partition-option hover | Lookup by priority: current `bg-search-match-current text-bg`; else match `bg-search-match`; else selected `bg-hover`; else `hover:bg-hover`. Take the exact token names from the block. Option: `hover:` |
| `SF/views/shared/DateTimePicker.vue` | month-label hover, day states | `hover:`, ternary |
| `SF/views/shared/SavedListMenu.vue` | `.pin-button.pinned` | Ternary |
| `SF/views/shared/celleditor/CellEditorView.vue` | `.has-translate` | Ternary |
| `SF/views/terminal/TerminalView.vue` | descendant `span` rule | Put the utilities on the `<span>` in the template; `*:` only if the spans are not template-owned |
| `SF/views/shared/AutocompleteField.vue` | `.highlight-overlay`, `.is-grow .highlight-overlay`, `textarea.has-overlay`, `:deep(.kira-ed-var*)` | Overlay utilities with `leading-[normal]`; grow variant as a ternary with `leading-[inherit]`; `has-overlay` conditional. `.kira-ed-var*` moves to the shared file (M8, below). Block deleted |
| `SF/editor/MonacoHost.vue` | compound `.monaco-host--single-line.monaco-host-pending` | Conditional classes in the template. The `:deep`/`:global` Monaco rules **stay**. The `.kira-ed-var*` rules move to the shared file |
| `SF/project/ConnectionDialog.vue` | `.kind:hover:not(.is-off)`, `.kind:focus-within`, `.kind.is-off` | `data-off` attribute on the tile; `not-data-[off]:hover:bg-hover` (compile-verified), `focus-within:…`, `data-[off]:…` |
| `SF/api/CollectionsPanel.vue`, `SF/api/VariablesOverviewPanel.vue` | `all: unset` + `@apply` buttons | Template utilities. Preflight resets `<button>` in this root |
| `SF/terminal/TerminalPanel.vue` | `.quick-command-row:hover` | `hover:` |
| `SF/workbench/TitleBar.vue` | `.mode-tab:hover:not(.is-active)` | `isActive ? '…active…' : 'hover:…'` |
| `SF/workbench/StatusBar.vue` | `.update` | See §3.5.3 |
| `SF/workbench/panels/OperationsPanel.vue` | `.virtual-row` (gone in I2-15) | **Keep** the `.ops-detail-cm :deep(...)` Monaco rules only |
| `KF/repo/GitPanel.vue` (46 lines) | repo/worktree row hover, active, open, current, error | Ternary/lookup per row; `hover:` |
| `KF/repo/RepoReviewView.vue` | `.repo-review-host` | `h-full w-full` in the template |
| `KF/workbench/StatusBar.vue` | `.blame`, `.blame:disabled`, `.blame-text` | See §3.5.3; `disabled:cursor-default`; `max-w-80 overflow-hidden text-ellipsis whitespace-nowrap` on the span |
| `PW/components/TabStrip.vue` | `.tab-chip:hover .tab-close`, `.is-attention::after`, active | `group/tab` on the chip; close gets `isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'`; attention gets `relative after:absolute after:top-1 after:right-1 after:size-1.5 after:rounded-full after:bg-state-on after:content-['']` conditional on attention. Read the real values from the block |

**M8 shared decorations.**

- New `SF/editor/edDecorations.css`, imported once from `SF/main.ts` next to the other global CSS.
  It holds the `.kira-ed-var`, `.kira-ed-var-secret` and `.kira-ed-var-unknown` rules as plain
  global selectors. These class names are app-unique and emitted by both engines.
- Before deleting either copy, diff the two blocks' declarations. If they differ, the file keeps
  two rule sets scoped `.monaco-host …` and `.highlight-overlay …`, and the commit body says why.
- MonacoHost's `.kira-ed-find-match*` rules stay in its own block.

Split into commits: I2-16 console/grid/definition/documents; I2-17 browse/http/grpc/stream/
keyvalue/shared; I2-18 editor/project/api/terminal/Studio workbench; I2-19 Space; I2-20 TabStrip.
Each is one commit per file where practical. "Done when": the file has no `^<style`, except the
5 kept.

### 3.4 Category 1 check list

These are the exact sites I2-4..I2-8 must clear. The script's first run confirms them.

- **BROKEN, 21 fixes:**
  - run-state ×11 (I2-4)
  - `ConsoleResultGrid:415`, `KeyValuePane:1148`, `:1166` (I2-5)
  - `TerminalHostView:54` (I2-6)
  - M3 ×7 incl. ConsoleSavedMenu, and M4 ×2 (I2-7)
- **Fragile or redundant** (I2-8): the ring ×11 goes away inside RunState; `ConsoleResultGrid:427`;
  `KeyValuePane:1084`; `DateTimePicker:290`; outline ×8; `SettingsShell:223`.

### 3.5 Category 2/3 specifics

**3.5.1 Hover vs selected.** Pre-phase precedence was always selected over hover (specificity).
`selected ? 'bg-select' : 'hover:bg-hover'` reproduces it exactly. Never put both classes on the
element: `hover:` emits after base utilities, so hover would win.

**3.5.2 `font-[inherit]`, Studio ×11.** Preflight (`@import "tailwindcss"` in `PT/base.css:1`) sets
`font: inherit` on `button`, `input`, `select` and `textarea`. Delete each `font-[inherit]` on
those elements. On any other element, family inherits by default. Delete it there too, unless the
same element carries a `font-*` family utility. In that case remove both and keep the value that
renders today.

**3.5.3 StatusBar buttons.** In both apps the fix is a template change plus a block delete:

- Studio `.update` (`SF/workbench/StatusBar.vue:114`): remove `text-kira-sm` and `text-fg` from the
  button. Add `text-info hover:text-fg`. Preflight's `font: inherit` then gives the same inherited
  font, and the colours match today's winners.
- Space `.blame` (`KF/workbench/StatusBar.vue:41`): remove `text-kira-sm`. Keep `text-fg`.
- Before committing, measure `getComputedStyle(button).fontSize`/`fontFamily`/`color` in the running
  UI at HEAD and after. They must be equal. Put both values in the commit body.
- If the inherited size equals `text-kira-sm` (the parent is `text-kira-sm`), still remove the
  utility. Same pixels, one fewer fight.

### 3.6 Category 6 — settings fields (I2-1, I2-21a, I2-26)

**3.6.1 Measure first (I2-1), before anything else in this iter.**

- Build `6f6853c1` in a throwaway worktree under the scratchpad (`git worktree add <scratch>/pre
  6f6853c1`, `bun install`, `bun run build:test:studio`) and HEAD normally.
- A throwaway Playwright script, not committed, uses the existing ui fixture. It opens settings,
  visits every pane and dumps JSON for each field wrapper, head row, label text node and control:
  - `display`, `flex-direction`, `align-items`, `gap`, `font-size`, `font-weight`, `line-height`
    and `color`
  - control `width` and `x` relative to the wrapper
- Same for `SF/api/RequestSettingsPane.vue`, and for Space panes via `test:ui:space`'s fixture.
- Also measure the 3 bare-`<Label :for>` shared fields (`PW/settings/fields/FontSizeField.vue`,
  `DateFormatField.vue`, `GitLogLevelField.vue`). Today they render shadcn `text-sm` (14px) medium
  inside `Field`, a possible second regression.
- **Commit the result table into §3.6.4 of this file** as I2-1 (`docs(v1.9): … (P110 I2-1)`).

**3.6.2 Baselines second (I2-1b, same tag, before any template change).**

- `ST/visual/settings.spec.ts`: open settings (`ST/ui/support/settings.ts` `openSettings`) and
  screenshot `[data-testid="settings-dialog"]` once per pane. Get pane nav testids from
  `PW/components/SettingsShell.vue`.
- Add a `RequestSettingsPane` screenshot if an existing ui helper opens an HTTP request tab. If
  none exists, skip it and say so in the commit body. Do not build a new harness.
- Space: add a `visual` project to `apps/kira-space/playwright.config.ts` mirroring Studio's
  (`:100-110`: webkit, `animations: 'disabled'`, `stylePath` pin-fonts). Copy
  `ST/visual/support/pin-fonts.css` to `KT/visual/support/`. Add
  `KT/visual/settings.spec.ts`, and root scripts `test:visual:space` and
  `test:visual:update:space` mirroring `package.json:49-50`.
- Record both with `test:visual:update:*`, then re-run clean.

**3.6.3 Convert (I2-26), after §3.6.4 is filled.**

Decision rule:

- **HEAD equals pre-phase** on every measured property. The conversion must be pixel-identical:
  the I2-1b baselines pass unchanged. Put today's net classes into the owned `Field*` bases:
  - `Field` vertical: `flex flex-col gap-1 text-kira-sm`, plus whatever §3.6.4 shows actually
    rendering (e.g. `items-center font-medium leading-none` if measured). Put them in the base,
    never per site.
  - `FieldLabel`: the measured head-text style. Today that is `Label`'s base merged with
    `text-muted-foreground`, restyled in `PT/components/ui/field/FieldLabel.vue`.
- **HEAD differs in a way that is a regression.** Fix to the pre-phase value, re-record the I2-1b
  baselines in the same commit and name the property in the commit body (a §1.4 conditional
  change).

Mechanics, for 32 `fieldVariants()` uses in 11 files plus the 3 bare-`Label` shared fields:

- The pane files are:
  - Studio `SF/workbench/settings/`: `AdvancedPane`, `ApiPane`, `AppearancePane`, `CachePane`,
    `ClaudeCodePane`, `DataPane`, `DatabaseMcpPane`
  - Space `KF/workbench/settings/`: `AppearancePane`, `GitPane`
  - `SF/api/RequestSettingsPane.vue`
  - `PW/settings/fields/WordWrapField.vue`
- `<Label :class="fieldVariants()">…` becomes `<Field>` (div, `data-slot="field"` built in), holding:
  - a `flex items-center justify-between gap-1` head
  - `<FieldLabel :for="id">` inside the head, with the reset button beside it
  - the control with `:id="id"`
- `id` comes from Vue `useId()`. The old `<label>` wrap made the text focus the control, and
  `for`/`id` preserves that. Check every settings ui spec that clicks label text still passes.
- Checkbox rows become `<Field orientation="horizontal">` with `<Checkbox :id>` and `<FieldLabel
  :for>`. The `FieldGroup` wrapper stays.
- `.helper-text` successors become `FieldDescription`. Error `<p>`s become `FieldError`. Section
  heads become `FieldLegend` inside `FieldSet` (restyled per iter1 §5.7).
- Delete all 13 hand-written `data-slot="field"`.
- `fieldVariants` stays exported for `Field` itself only. No app import remains.
- Delete `GitPane.vue`'s dead `section-subhead` hook (`:92`, `:237`). Guard it (§3.8).

**3.6.4 Measurements (filled by I2-1).**

**Method.** Rather than a throwaway-worktree Playwright dump, this measurement uses direct CSS
cascade analysis against real source at both commits — the same rigor the audit itself used for
its own "compile-verified" claims (§0's discovery note), applied here to the cascade instead of a
compile. Every property below traces to a real selector/rule read with `git show`, not assumed.
This is a deliberate method substitution from §3.6.1's literal wording (a live worktree build), on
the same standard of evidence; noted as such in the implementation report.

**`fieldVariants()` vertical sites** (e.g. `ApiPane.vue`'s many `<Label :class="fieldVariants()">`).

- Pre-phase (`6f6853c1:packages/workbench/src/workbench.css:108-113`): `<Label class="field">`.
  `.field` is unlayered CSS: `display:flex; flex-direction:column; gap:var(--kira-s-2)(4px);
  font-size:var(--kira-t-sm)`. Unlayered beats Label's own layered utilities on the same property
  (`gap-2`→8px loses to `.field`'s 4px; `text-sm`→14px loses to `.field`'s kira-sm). Untouched
  Label-base properties survive: `items-center`, `leading-none`, `font-medium`, `select-none`.
  Net: `flex column items-center gap:4px font:kira-sm leading-none font-medium select-none`.
- HEAD: `cn(Label base, fieldVariants())` = `cn('gap-2 text-sm leading-none font-medium … flex
  items-center select-none …', 'flex flex-col gap-1 text-kira-sm')`. twMerge groups: `gap-2`→`gap-1`
  (spacing group, 4px wins), `text-sm`→`text-kira-sm` (registered in `PT/lib/utils.ts`'s `text`
  group, kira-sm wins), `flex-col` adds (no base direction utility to conflict with), `flex` stays.
  Net: same as pre-phase, term for term.
- **Equal. No regression on the vertical sites.**

**`fieldVariants({orientation:'horizontal'})` sites** (e.g. `ApiPane.vue:270`,
`ClaudeCodePane.vue:39`).

- Pre-phase (`6f6853c1:…workbench.css:123-127`): `<Label class="field checkbox">`. Both `.field`
  and `.field.checkbox` match (equal specificity, single class each); `.field.checkbox` is later in
  source so it wins ties: `flex-direction:row` (was column), `align-items:center` (new),
  `gap:var(--kira-s-3)`(6px, was 4px). `.field`'s untouched `font-size:kira-sm` survives (only
  rule setting it). Net: `flex row items-center gap:6px font:kira-sm leading-none font-medium
  select-none`.
- HEAD: `cn(Label base, fieldVariants({orientation:'horizontal'}))` = `'flex text-kira-sm flex-row
  items-center gap-1.5'` merged onto Label base. `gap-2`→`gap-1.5`(6px), `text-sm`→`text-kira-sm`,
  `flex-row` added, `items-center` present both ways. Net: identical to pre-phase.
- **Equal. No regression on the horizontal sites.**

**The `.checkbox-row`/`FieldGroup` wrapper** (not an I2-26 target — already converted pre-iter2).

- Pre-phase wrapper div `class="field checkbox-row"`: `.checkbox-row` (declared after `.field`)
  wins on `flex-direction:row`, adds `align-items:flex-start`; `.field`'s `gap:4px` and
  `font-size:kira-sm` survive unchallenged (no conflicting property in `.checkbox-row`).
- HEAD `FieldGroup`: `flex flex-row items-start […]`, no `gap`, no `font-size` utility.
- **Difference exists** (wrapper loses a 4px gap and an inherited kira-sm font-size), but it is
  inert: the wrapper's only children (`Label`, a `Tooltip>Button` pushed via `ml-auto`) each set
  their own font-size and don't rely on wrapper gap for spacing (the reset button is pushed to the
  far end, not adjacent-spaced). No visible effect. Also out of I2-26's own scope (`FieldGroup` was
  already shipped pre-iter2, not one of the 32 `fieldVariants()` sites this commit touches).

**The 3 bare-`<Label :for>` shared fields** (`FontSizeField.vue`, `DateFormatField.vue`,
`GitLogLevelField.vue`), flagged by the audit correction (§2.1) as a possible second regression.

- Pre-phase (`6f6853c1:…/FontSizeField.vue:45-46`): `<div class="field"><div class="field-head">
  <Label :for="fieldId">Data font size</Label>`. The wrapper's `.field` sets an *inherited*
  `font-size:kira-sm`, but `Label` itself carries its own **explicit** `text-sm` utility class.
  A directly-declared value on an element always wins over an inherited one, at any specificity —
  cascade origin/specificity only arbitrates declarations that apply to the *same* element. So the
  label text already rendered at shadcn's `text-sm` (14px), not `kira-sm`, pre-phase.
- HEAD: `packages/workbench/src/settings/fields/{FontSizeField,DateFormatField,GitLogLevelField}.vue`
  render a bare `<Label :for="fieldId">` (no `fieldVariants()`) inside `<Field>`. Same `text-sm`
  (14px), same weight, same everything — `Field`'s own base doesn't force a font-size onto
  non-participating descendants either (§3.6.3 note below).
- **Equal. Not a regression** — resolves the audit's "possible" flag as a non-issue. These 3 files
  need no template change for the label, only whatever `Field`/`FieldDescription`/`FieldError`
  conversion the surrounding markup already has (they are already on the new components; nothing
  left to convert here for I2-26).

**Conclusion for I2-26.** HEAD equals pre-phase on every measured property, for all measured shapes.
Per §3.6.3's decision rule, the conversion is pixel-identical by construction: put today's already-
proven-equal classes onto the owned `Field`/`FieldLabel` bases as designed, convert the 32
`Label :class="fieldVariants()"` sites to `<Field>`+`<FieldLabel :for>`, and the I2-1b baselines
must pass unchanged. No `§1.4` conditional fix is triggered.

### 3.7 Category 4 — arbitrary values (I2-27, I2-28, I2-29)

**I2-27 Studio/workbench:**

- `font-[family-name:var(--kira-font-data)]` becomes `font-data` at:
  - `SF/editor/MonacoHost.vue:627`
  - `SF/views/definition/DefinitionView.vue:330`
  - `SF/views/grid/DataView.vue:397`, `:408`
  - `SF/views/httprequest/CookiesPane.vue:137`, `:173`, `:189`
  - `SF/views/shared/document/DocumentRow.vue:63`
  - `SF/views/documents/DocumentTree.vue:46`
- `font-[family-name:var(--kira-font-ui)]` becomes `font-ui` at `CellEditorView.vue:573`, `:620`.
- `text-[length:var(--kira-font-size)]` becomes `text-kira-md` at `MonacoHost.vue:627`. Check
  `--text-kira-md` = `--kira-t-md` = `var(--kira-font-size)` in `PT/tokens.css:141`.
- `bg-[var(--kira-state-on)]` becomes `bg-state-on` at `SF/views/grid/DataToolbar.vue:331`.
- `z-[var(--kira-z-*)]` ×3 becomes the `z-(--kira-z-*)` shorthand. `w-[var(--total-width)]` becomes
  `w-(--total-width)`.
- `leading-[var(--kira-control-inline-h)]` becomes `leading-3.5` at `SF/workbench/TitleBar.vue:88`,
  `:92`. The token is a literal 14px (`PT/tokens.css:170`) and is not user-set.
- `[overflow-wrap:anywhere]` becomes `wrap-anywhere` at `ResponseDiffDialog.vue:311`, `:312`, `:328`,
  `:329` and `AutocompleteField.vue:600`.
- `font-[inherit]` ×11: see §3.5.2.
- `max-w-completion-max-w`: keep, now registered (I2-2).

**I2-28 git-ui/kira-ui** (compile-verified in the real `kv` root):

- `kv:max-w-[480px]` becomes `kv:max-w-120` (`App.vue:1814`, `GitBlockedPanel.vue:33`).
- `kv:max-w-[420px]` becomes `kv:max-w-105` (`NoRepositoryPanel.vue:67`, `:86`, `:91`, `:101`;
  `EmptyRepositoryPanel.vue:25`).
- `max-w-[260px]` becomes `max-w-65` (`AppToolbar.vue:462`, `:483`).
- `w-[5px]` becomes `w-1.25` (`App.vue:1936`; `CommitGrid.vue:1276`, `:1286`, `:1296`).
- `px-[3px]` becomes `px-0.75` (`KuiButton.vue:102`; `KuiSegmented.vue:17`, `:72`).
- `top-[3px] right-[3px]` becomes `top-0.75 right-0.75` (`RefreshButton.vue:83`).
- `max-h-[70%]` becomes `max-h-7/10` (`CommitMeta.vue:323`).
- `saturate-[1.6] contrast-[1.15]` becomes `saturate-160 contrast-115` (`FileTree.vue:613`, `:740`).
- `leading-[1.4]` becomes `leading-snug` (`KuiTooltip.vue:10`, `:57`). `tracking-[0.06em]` becomes
  `tracking-wider` (`KuiMenuList.vue:138`).
- `kv:leading-[var(--kui-control-h-sm,14px)]` ×2 (`KuiSegmented.vue:18`, `:72`) becomes new
  `--leading-kui-control-sm: var(--kui-control-h-sm, 14px)` in `KU/theme/tailwind-theme.css`, as
  `kv:leading-kui-control-sm`. It is a design seam, the existing kui control-height token. Register
  `leading: ['kui-control-sm']` in `KU/cn.ts`.
- FileTree masks (`:582`, `:706`): `[mask-*:…]` plus `-webkit-` twins become
  `mask-contain mask-no-repeat mask-center`. Check v4's output carries the `-webkit-` prefix; if it
  does not and the webview needs it, keep only the `-webkit-` arbitraries and say so.
- `focus-visible:[outline:none]` becomes `focus-visible:outline-none` (`App.vue:1936`,
  `CommitGrid.vue:1276`, `:1286`, `:1296`).
- Font inherit: `kv:[font-family:inherit]` ×5 becomes `kv:font-inherit`. `kv:[font:inherit]` ×5
  stays (§1.2).
- em literals (iter1 §6.4 nearest step). Compute each site's parent size; move only if within 1px:
  - `text-[0.8em]` ×3 (`BranchPicker.vue:678`, `StashRows.vue:107`, `:113`)
  - `text-[0.75em]` ×2 (`TagList.vue:121`, `KuiButton.vue:102`)
  - `text-[1.05em]` (`KuiDialog.vue:80`)
  - `w-[8em]` (`RepoSettingsDialog.vue:214`)
  - `text-[0.5em]` stays (§1.2).
- `kv:text-[12px]` ×3 on codicons (`FileTree.vue:550`, `:674`, `ReviewCommitRow.vue:234`): a fixed
  icon size that recurs 3 times becomes new `--text-codicon: 12px` in `GU/theme/tailwind.css`'s
  `@theme` block, as `kv:text-codicon`. Register it in `KU/cn.ts` `text`.

**I2-29 `--spacing-kui-*`:**

- Replace `kv:*-kui-1..6` with default steps 0.5/1/1.5/2/3/4 across GU/KU (≈22 sites; grep
  `-kui-[1-6]\b`).
- Delete `--spacing-kui-1..6` (`KU/theme/tailwind-theme.css:53-58`) and the `--kui-space-1..6`
  bridge lines (`PT/kui-bridge.css:45-50`, `GU/theme/kui-bridge.css:44-49`). Nothing else reads
  them (grepped).
- Update `GU/components/SearchResults.vue:67`'s comment. Drop `kui-1..6` from `KU/cn.ts` `spacing`.
- Keep `kui-control`, `kui-control-sm` and `kui-icon-box`: they are real non-default seams.

### 3.8 Category 7 — guard gaps (I2-31)

`scripts/check-theme-classes.sh` changes:

1. **GU/KU scan for every retired name.**
   - Add `check_class_all <name> <replacement>`. It runs the existing `check_class` over
     `SCAN_DIRS`, plus a GU/KU pass.
   - GU/KU pass for `.vue`: attribute values only (`(?::?class)="[^"]*"`), the same way
     `check_kui_class` works. That covers `:class` object keys.
   - GU/KU pass for `.ts`: full lines, excluding comment lines (`^\s*(\*|//|/\*)`) and `KU/cn.ts`,
     whose strings are merge-config token names, not classes.
   - Switch every existing `check_class`/`check_class_in_attrs` call to the `_all` form.
2. **Prerequisite for 1: I2-30** renames git-ui's `--color-muted` to `--color-muted-foreground` in
   `GU/theme/tailwind.css:55`. `kv:text-muted` ×110 in 30 files becomes `kv:text-muted-foreground`,
   done with a sed and then an eyeball of `hover:`/`group-*:` variants. Without it, item 1 fails on
   day one. It also settles audit §6d's naming split.
   - **Reconciled with I2-37 (§3.11.3). No overlap, no conflict.** I2-37's rule gives each value
     one name. In the PT root, `muted-foreground` is the only name for description text. I2-30
     applies that same rule to the `kv` root, and I2-37 does not touch GU/KU.
   - After both commits, `muted` names nothing in either root. PT's `bg-muted` surface goes to
     `bg-field` in I2-37. `muted-foreground` means description text in both roots.
   - I2-30 stays exactly as written.
   - I2-31's switch of every `check_class` call to the `_all` form covers only the calls that
     exist when it lands. The I2-37/I2-38 alias checks land later and stay PT-root-only by design
     (§3.11.3). Never convert them to `_all`.
3. **Pre-phase names never guarded**, from `git show 6f6853c1:PT/primitives.css` and
   `…:PW/workbench.css` selector lists:
   - Plain `check_class_all`: `p-seg`, `has-stepper`, `ph-active`, every `sugg-*` name (enumerate
     from the pre-phase file), `strip-action`, `dialog-body-inner`, `section-pane`,
     `section-subhead`, `muted-note`, `footer-status`.
   - Common words, attribute-scoped: `stepper`, `ph`, `big`, `edited`, `segmented`, `split`,
     `splitter`.
   - Exclude `bordered`: it is a legitimate `NativeSelect` `variant` prop value, not a class.
4. **This iter's retirements.** Each one goes in its own commit (§7), not here: `empty-state`×3,
   `columns-menu-*`×5, `twisty`, `tree-row`, `spin`, `virtual-row`, `sticky-row`, `step-btn`,
   `text-prompt-title`, and the `label`/`row` hooks (attribute-scoped).
5. **Deliberate omissions comment.** One comment block names `field`, `field.checkbox`,
   `field-error`, `helper-text`, `tab-strip-actions` and `is-on` as intentionally unguarded, with
   iter1's reasons, so the gap reads as a decision.

"Done when": the script passes on the tree, and a scratch copy of one GU file with `class="p-btn"`
makes it fail (§9).

### 3.9 Category 8 — orphaned tokens (I2-32)

Delete `--kira-gap`, `--kira-window-inset`, `--kira-toolbar-h` and `--kira-viewhead-h` from
`PT/tokens.css` (`:71`, `:74`, `:100`, `:105`) with their comments. Reword the comments that
cite them: `PW/components/WorkbenchShell.vue:110`, `:128`, `:215` (cite the literal `gap-0.5`/2px)
and `ST/ui/control-sizing.spec.ts:20` (cite `--kira-bar-h`). Run `sh scripts/check-tokens.sh` in
the hook.

### 3.10 Category 5 — pasted markup (I2-4, I2-21..I2-25)

- **Run-state:** I2-4 (§3.1).
- **I2-21 dialog parts.** Restyle the owned bases in `PT/components/ui/dialog/`:
  - `DialogHeader`: `flex flex-row items-center gap-1.5 border-b border-border px-3 py-2`.
  - `DialogTitle`: today's *merged* result. Note: `cn('text-base leading-none font-medium
    cn-font-heading', 'text-kira-lg font-normal')` drops `leading-none`, because a later font-size
    removes an earlier leading in twMerge. The real base is therefore `text-kira-lg font-normal
    cn-font-heading`, with no `leading-none`. Verify against the connection-dialog baseline.
  - `DialogFooter`: first measure (M9) the footer rect against the `DialogContent` rect in the
    connection-dialog ui harness.
    - No overshoot: the base becomes today's merged set, and the baselines pass unchanged.
    - Overshoot: the base becomes `flex items-center gap-1.5 border-t border-border px-3 py-2`,
      mirroring the header. Re-record the affected dialog baselines and disclose it (§1.4
      conditional).
  - Then strip the per-site override strings: header 17, title 17, footer 16.
  - The one footer consumer without the override keeps its look via an explicit `class` (grep for
    it).
  - `PT/components/ui/command/CommandDialog.vue` uses `DialogHeader`. Check it still renders as
    before (it is `sr-only` in the registry source).
- **I2-22 number stepper.**
  - New `PT/NumberStepperInput.vue`, next to `CodiconIcon.vue`. It is today's `InputGroup` +
    `InputGroupInput type="number"` + the `InputGroupAddon` with two `Tooltip`-wrapped
    `InputGroupButton`s.
  - It owns its container ref and the step logic from `PT/composables/useNumberStepper.ts`:
    `stepUp`/`stepDown` plus synthetic `input`/`change`. Delete the composable.
  - `inheritAttrs: false`. `$attrs` (testid, `@input`, `aria-invalid`, `min`/`max`) bind to the
    inner input. Props: `modelValue: string`, `groupClass`, `inputClass`.
  - Step buttons get `data-testid="number-step-up"`/`"number-step-down"`.
  - `ST/ui/connections.spec.ts:306` `.step-btn` moves to those testids.
  - 14 pairs in 7 files: `ConnectionDialog.vue` (port, throttle), `GenerateDataDialog.vue`,
    `ApiPane.vue`, `AdvancedPane.vue`, `CachePane.vue`, `KF/…/GitPane.vue` and
    `PW/settings/fields/FontSizeField.vue`. Drop the `<span ref class="contents">` wrappers.
  - Guard `step-btn`.
  - **reka-ui `NumberField` declined, by requirement.** It clamps to min/max on commit and emits a
    `number`. The settings panes deliberately keep the raw string so they can show an out-of-range
    `FieldError`, e.g. `settings-oplog-retention-error` in `AdvancedPane.vue:126`. Under clamping
    that error becomes unreachable, and so do its ui specs.
- **I2-23 toolbar.**
  - New `PW/components/ViewToolbar.vue` with cva `viewToolbarVariants({ border: 'bottom' | 'top' |
    'none' })`. Base: `h-bar shrink-0 flex items-center gap-1.5 px-2`. Default border: `bottom`
    (18 of 36).
  - Root `cn(viewToolbarVariants({ border }), props.class)`. `gap-1`, `bg-elevated` and
    `overflow-x-auto` pass through `class`.
  - Replace all 36 sites. The conditional-border one uses `:border="isKafka ? 'bottom' : 'none'"`.
  - **reka-ui `Toolbar` declined, by requirement.** It adds `role="toolbar"` and roving tabindex,
    which changes keyboard focus order in every view. That is a behaviour change outside this
    iter's scope.
- **I2-24 swatch radio.**
  - The same 10-utility label/`peer` input string sits at `ScriptsPane.vue:186`/`188`, `:268`/`270`,
    `VariableSetView.vue:620`/`622` and `ConnectionDialog.vue:796`/`798`. That meets the 4+ bar.
  - New `PT/SwatchRadio.vue` (props `name`, `value`, `color`, `checked`, emits `change`) carrying
    that string once. The outline fix from I2-8 is already applied.
  - Read all 4 sites first. If one differs beyond its bindings, it keeps its markup and the commit
    says why.
- **I2-25 hooks.** `PW/prompt/TextPromptDialog.vue:47` `text-prompt-title` becomes a testid.
  `SF/api/MethodSelect.vue:56` stray `row` goes (grep specs first). Guard both, attribute-scoped.

### 3.11 User decisions (I2-35..I2-39)

The user resolved the four items §6 first deferred (§6 keeps the record). Every count below was
re-derived at `e009dbaf`, not copied from the audit. Two audit counts were wrong again: spinners
(§3.11.1) and Resizable importers (§3.11.4).

Before each of these commits, re-grep the current tree. I2-10, I2-21, I2-22 and I2-26 add or
restyle `PT/components/ui` files before I2-37/I2-38 run, so those two commits work from a fresh
enumeration, never from the counts here.

#### 3.11.1 Spinner speed: one 1s spin (I2-35)

**Decision.** The user chose to unify every spinner on Tailwind's default `animate-spin` (1s,
linear).

**Inventory.**

- `animate-kira-spin` (0.7s) ×12:
  - Run-state ring ×11, in the object key of the ring's `:class`: `EnvironmentsView:262`,
    `VariableSetView:507`, `BrowseView:368`, `ConsoleView:868`, `DefinitionView:297`,
    `DocumentView:887`, `DataView:281`, `GrpcRequestView:428`, `HttpRequestView:637`,
    `KeyValuePane:784`, `StreamView:855`.
  - `SF/workbench/GenerateDataDialog.vue:506`.
- `animate-spin` (1s) ×6, already on target. The audit's "×10 git-ui" is stale.
  - Studio: `SF/workbench/panels/OperationsPanel.vue:331`, `SF/views/grid/FkPreviewPopover.vue:157`,
    `SF/project/TreeRow.vue:149`.
  - git-ui: `GU/components/AppToolbar.vue:461`, `:482`, `GU/components/RefreshButton.vue:74`.
- **Missed by the audit: a third speed.**
  - `GU/components/AppToolbar.vue:324` uses `codicon codicon-sync codicon-modifier-spin`, which is
    upstream codicon's `codicon-spin 1.5s steps(30)`.
  - Iter1's pre-approved spinner change already moved its siblings at `:461`/`:482` to
    `kv:animate-spin` (their comments say so). This one was missed.
  - It is in scope: the user asked for one speed.

**Mechanism.** One commit, placed right after I2-2. That way I2-3's first run and I2-4's
`RunState` already see the final state.

- Replace `animate-kira-spin` with `animate-spin` at all 12 sites. Both keyframes are
  `to { transform: rotate(360deg) }` with linear timing, so only the duration changes.
- `AppToolbar.vue:324`: replace `codicon-modifier-spin` with `kv:inline-block kv:animate-spin`, the
  same as `:461`. Copy `:461`'s pre-approval comment above it.
- In `PT/base.css`'s `@theme` (`:118-131`), delete the comment block, `--animate-kira-spin` and
  `@keyframes kira-spin`. After that, no custom `--animate-*` exists in either root. That is why
  I2-2 no longer registers `animate` (§3.1).
- Guard, both in `check-theme-classes.sh`:
  - `check_class 'animate-kira-spin' 'animate-spin'`.
  - `check_class_in_attrs 'codicon-modifier-spin' 'kv:inline-block kv:animate-spin' "$GIT_UI_SRC
    $KIRA_UI_SRC"`. It must be attribute-scoped: `GU/icons/codicon.css:8`'s header comment names
    the class as prose. I2-31 later converts both calls to `_all`.

**Risk.**

- Visual specs run with `animations: 'disabled'`, so baselines are unchanged.
- No spec asserts a duration. `ST`/`KT` have 0 hits for `kira-spin`, `animationDuration` and
  `0.7s`.
- Disclosed in §1.4.

**Done when.**

- `grep -rn 'kira-spin' apps packages --include=*.vue --include=*.ts --include=*.css` (excluding
  `node_modules`/`dist`) returns 0 hits.
- `codicon-modifier-spin` returns 0 hits in `.vue`.
- Both guard lines are present.

#### 3.11.2 Alert `err` onto `destructive` (I2-36)

**Decision.** The user chose one error variant, `destructive`.

**Inventory.** Taken from a template scan that includes multi-line `<Alert` tags and the dynamic
`:variant` bindings.

- `<Alert variant="err">` ×2:
  - `SF/views/stream/StreamView.vue:1051` (`stream-error`)
  - `SF/views/stream/StreamView.vue:1057` (`stream-action-error`)
- No dynamic binding can yield `err`. Each is typed without it:
  - `SF/views/httprequest/RawExchangePane.vue:92` `fidelityTone`: `'note' | 'warn'`.
  - `SF/api/ImportReportStrip.vue:26` `tone`: `'warn' | 'note'`.
  - `SF/project/DataGripImportDialog.vue:95` `reportTone`: `'note' | 'warn'`.
  - That file's `'err'` at `:41`/`:124` feeds `<Badge>`, not `Alert`.
- `<Alert variant="destructive">` ×37. These are unchanged.
- `<Badge variant="err">` ×3 (`CellEditorView:552`, `TimelinePane:247`, `FkPreviewPopover:159`)
  are out of scope.
  - They use Badge's own cva, whose tone set is `default`/`chip`/`warn`/`err`/`ok`/`info`/`count`.
  - Badge has no `destructive`, so there is no split there. Not touched.

**Current difference** (`PT/components/ui/alert/index.ts`).

- `err` (`:29`):
  - `bg-error/10 border-error/20`
  - description `text-error-text` (`#f3a3a3`)
  - no root text colour
- `destructive` (`:15-16`):
  - `text-destructive bg-card`
  - description `text-destructive/90`
- StreamView already works around `err`:
  - Both sites wrap the message in `<span class="text-error">` and put `text-error` on the icon.
  - A comment at `:1046-1050` explains the workaround.

**Mechanism.** One commit.

- Change both sites to `variant="destructive"`.
- Remove the `<span class="text-error">` wrappers. The message goes straight into
  `AlertDescription`.
- Remove the icons' `text-error`. The root's `text-destructive` is the same `--kira-error`, and the
  icon inherits it.
- Delete the workaround comment. The 2 strips now look the same as the other 37 error alerts.
- Delete the `err` key and its P110 B23 comment (`:25-29`) from `alertVariants`.
  - `Alert`'s prop type is `AlertVariants['variant']`.
  - So `vue-tsc` (`typecheck:web:studio`, `typecheck:space-web`) rejects any future literal
    `variant="err"`. The type is the guard for the prop value.
- Delete the orphaned token pair. `text-error-text` has no other consumer (grepped), so remove:
  - `--color-error-text` (`PT/base.css:53`)
  - `--kira-error-text` (`PT/tokens.css:238`)
- Guard: `check_class 'text-error-text' 'text-error'`.
- Before committing, check whether either strip is in a visual baseline:
  `grep -rn 'stream-error\|stream-action-error' ST/visual`. If one is, re-record it in this commit
  and name it in the commit body.

**Risk.**

- The visible change is disclosed in §1.4.
- The strips keep `data-testid="stream-error"` and `"stream-action-error"`.
- The ui specs that read their text still match, because the text node is unchanged.

**Done when.**

- A multi-line-aware scan finds 0 `<Alert … variant="err">`. Use the I2-3 script's Vue AST pass, or
  `grep -Pzo '<Alert[^>]*variant="err"'`.
- `alertVariants` has no `err:` key.
- `error-text` returns 0 hits outside comments.

#### 3.11.3 One name per value: colours (I2-37) and radii (I2-38)

**Decision.** The user asked to collapse each alias pair to one canonical name, as a real rename
sweep. This supersedes I2-34's "document the split as intentional". The choice of surviving name
was delegated, and is made below from the findings.

**Finding 1: which pairs are real.** Two names form a pair when both utilities resolve to the same
`--kira-*` variable in the PT root. Sources: `PT/shadcn-bridge.css` (`:root` plus `@theme inline`)
and `PT/base.css` (`@theme`).

| Value | kira name (`base.css`) | shadcn name(s) (`shadcn-bridge.css`) |
|---|---|---|
| `--kira-bg` | `bg` | `background` |
| `--kira-fg` | `fg` | `foreground`, `card-foreground`, `popover-foreground`, `secondary-foreground`, `accent-foreground`, `sidebar-foreground`, `sidebar-accent-foreground` |
| `--kira-bg-elevated` | `elevated` | `card`, `popover` |
| `--kira-bg-chrome` | `chrome` | `sidebar` |
| `--kira-bg-input` | `field` | `secondary`, `muted` |
| `--kira-border-strong` | `border-strong` | `input` |
| `--kira-focus` | `focus` | `ring`, `sidebar-ring` |
| `--kira-hover` | `hover` | `accent`, `sidebar-accent` |
| `--kira-error` | `error` | `destructive` |
| `--kira-accent` | none | `primary`, `sidebar-primary` |
| `--kira-accent-fg` | none | `primary-foreground`, `destructive-foreground`, `sidebar-primary-foreground` |
| `--kira-border` | none | `border`, `sidebar-border` |
| `--kira-conn-{blue,green,amber,violet,teal}` | `conn-*` | `chart-1..5` |

Radius names are equal in value today, not by token:

- `--radius-md` is 4px, the same as `kira-sm`.
- `--radius-lg` is `var(--radius)`, which is `--kira-radius` (6px), the same as `kira`.
- `--radius-xl` is 10px, the same as `kira-pill`.
- `--radius-sm` is 2px and has no kira twin.

Not pairs, because the values differ. These are out of scope:

- `text-sm`/`text-base` vs `text-kira-*`.
- `shadow-*` vs `shadow-kira*`.
- `muted-foreground` (`--kira-fg-muted`), which has only one name.

**Finding 2: usage.** Class tokens with comments excluded, from a scratch scan of SF, KF, PT, PW
and the vscode extension src.

- **App code** (everything except `PT/components/ui`) **uses kira names only.**
  - Colour tokens: `muted-foreground` 284 (single name), `border` 187, `fg` 155, `border-strong`
    114, `field` 105, `error` 71, `hover` 61, `primary` 51, `elevated` 40, `bg` 21, `chrome` 7,
    `focus` 3.
  - Radius tokens: `rounded-kira-sm` 117, `rounded-kira` 17.
  - It has 0 shadcn alias names. The only outliers:
    - `text-primary-foreground` ×1 (`SF/views/shared/DateTimePicker.vue:390`). That value has one
      name, so it stays.
    - `rounded-sm` ×3.
- **`PT/components/ui` mixes both vocabularies.**
  - 138 shadcn-alias colour tokens in 28 files:
    - `destructive` 37
    - `foreground` 20, `input` 20
    - `ring` 12, `muted` 11, `accent-foreground` 10
    - `popover`, `popover-foreground`, `accent` 5 each
    - `background`, `secondary` 4 each
    - `card`, `secondary-foreground` 2 each; `card-foreground` 1
  - They sit beside 42 kira-name tokens: `error` 12, `fg` 8, `focus` 6, `border-strong` 5,
    `hover` 5, `field` 4, `elevated` 2.
  - `rounded-kira-sm` ×17.
  - Shadcn radius names:
    - `rounded-md` 7, `rounded-xl` 4, `rounded-sm` 2.
    - `rounded-lg` 21, including the `-l`/`-r`/`-t`/`-b` side forms.
  - `var(--radius)` ×3 inside the calc arbitraries in `input-group/index.ts`.
- `sidebar-*`, `chart-*` and `destructive-foreground` have 0 uses anywhere.
- The GU/KU `kv` root defines no shadcn names. Its colour names are the kira ones, and `muted`
  becomes `muted-foreground` in I2-30.

**Finding 3: the "user-settable seam" premise was wrong.** §6 first said the kira names are the
user-settable seam. CodeGraph on `applyAppearance` (`PW/state/createSettingsStore.ts:82-97`)
shows what runtime actually sets:

- `--kira-font-family`
- `--kira-font-size`
- `--kira-row-height`
- `--kira-graph-font-size`

No colour or radius token is set at runtime. Both names in every pair read the same `--kira-*`
variable. So which name survives has no runtime effect.

**Choice: the kira name survives, repo-wide, including inside `PT/components/ui`.** A value whose
only name is shadcn's keeps it: `primary`, `primary-foreground`, `border`, `muted-foreground`.

Reasons:

1. **One name per value.** The kira set already gives each value exactly one name. The shadcn set
   is role-based and gives one value several names: `card` and `popover`; `secondary` and
   `muted`; 7 names for `--kira-fg`. Collapsing onto shadcn would still need an arbitrary pick per
   role.
2. **Usage.** Kira names carry about 630 app tokens plus 42 inside `components/ui`. The shadcn
   aliases carry 138, all inside `components/ui`. Keeping kira means renaming 138 tokens in 28
   owned files. Keeping shadcn means renaming about 630 tokens across about 100 app files.
3. **Family fit.**
   - `error` belongs to the `error`/`warn`/`ok`/`info` tone family, which Badge and every text
     tone use. `destructive` would split that family.
   - `accent` meaning the hover surface contradicts the brand-colour reading. The bridge's own
     comment (`shadcn-bridge.css:28-30`) warns about exactly this.
   - `input` meaning `border-strong` misreads the same way on borders that are not inputs.
4. **shadcn-vue's own model.** Registry files are copied in and then owned. This repo already
   restyles them (iter1 §5.7, I2-10, I2-21), and renaming their colour names is the same kind of
   edit. A future registry pull takes the same rename at pull time. The new guard makes lint fail
   until it does.

Rejected: split by context, shadcn names inside `components/ui` and kira names in app code. That
was I2-34's original rule. It keeps two names per value, which is what the user asked to remove.

**Reconciled with I2-30. No overlap, no conflict.** §3.8 item 2 has the details. I2-30 applies
this same rule to the `kv` root. I2-37 and I2-38 touch only the PT root.

**I2-37 colour mechanism.** One commit, PT root only.

- **Rename.**
  - Scope: `PT/components/ui/**`, plus any other hit the fresh enumeration finds.
  - Keep every variant chain and every `/N` opacity suffix.
  - Name map:
    - `background` → `bg`
    - `foreground`, `card-foreground`, `popover-foreground`, `secondary-foreground` and
      `accent-foreground` → `fg`
    - `card`, `popover` → `elevated`
    - `secondary`, `muted` → `field`
    - `input` → `border-strong`
    - `ring`, as a colour only (`ring-ring`, `border-ring`, `outline-ring`) → `focus`
    - `accent` → `hover`
    - `destructive` → `error`
  - Colour utility prefixes covered: `bg`, `text`, `border` and its sides, `ring`, `ring-offset`,
    `outline`, `fill`, `stroke`, `divide`, `from`/`via`/`to`, `shadow`, `caret`, `decoration`,
    `placeholder`.
  - Never rename a prop or data value. These stay:
    - `variant="destructive"` and `data-[variant=destructive]`
    - the Alert `destructive` key, which is the user's I2-36 name
    - the bare `ring`/`ring-1` width utilities
  - Example, the Alert `destructive` variant after I2-36:
    `text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90` becomes
    `text-error bg-elevated *:data-[slot=alert-description]:text-error/90`.
- **Delete from `shadcn-bridge.css`.**
  - `:root` variables: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`,
    `--popover-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--accent`,
    `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--input`, `--ring`,
    `--chart-1..5` and all 8 `--sidebar*`.
  - Their `@theme inline` `--color-*` twins.
- **Keep** in `shadcn-bridge.css` `--primary`, `--primary-foreground`, `--muted-foreground` and
  `--border`, with their `--color-*` entries.
  - Each is its value's only name.
  - Each also has a direct reader: `var(--primary)` at `DocumentRow:94`, `var(--muted-foreground)`
    at `base.css:207` and `:252`, and `var(--border)` at `base.css:270`.
  - `--radius` belongs to I2-38.
- Reword the bridge's header comment and its `--accent`/`--input` comments (`:28-30`, `:36-40`).
  Say which names survive and why.
- **Guard.**
  - Add `check_alias <regex> <replacement>` to `check-theme-classes.sh`. It is `check_class`
    without the `components/ui` exclusion, over `SCAN_DIRS` only.
  - Add one call per retired name, each using the prefix alternation above. Example:
    `(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|divide|from|via|to|shadow|caret|decoration|placeholder)-(?:background|foreground|card|…)(?:/\d+)?`.
  - Reword the script header, which today says it "Excludes packages/theme/src/components/ui/".
    Say that the alias checks deliberately scan it.
  - Keep it PT-root-only: the `kv` root defines none of these names.
- **Pixel-identical by construction.**
  - Each rename maps to the same `--kira-*` variable (Finding 1).
  - Both `@theme` styles declare at `:root`, and no subtree overrides a `--kira-*` colour.
  - An I2-33 visual diff is a bug in this commit.
- The conflict script, in lint since I2-9, re-checks every renamed `.vue` class set. Suppose a
  component already held both names in one group; the rename makes them duplicates, and lint
  fails. Keep one.

**I2-38 radius mechanism.** One commit.

- **New token (rung 3).**
  - Add `--kira-radius-xs: 2px` to `PT/tokens.css`, next to `--kira-radius-sm` (`:63`).
  - Add `--radius-kira-xs: var(--kira-radius-xs)` to `PT/base.css`.
  - Add `'kira-xs'` to `radius` in `PT/lib/utils.ts`. The I2-3 self-check verifies it.
  - Reason: the 2px step recurs 5 times (`OperationsPanel:323`, `TreeRow:173`,
    `KF/repo/RepoSearchRow.vue:125`, `CommandItem:70`, `TooltipContent:27`). Once the bridge
    override goes, `rounded-sm` would fall back to Tailwind's 4px default, a visible change.
- **Rename by rendered value.**
  - Map:
    - `rounded-sm` → `rounded-kira-xs`
    - `rounded-md` → `rounded-kira-sm`
    - `rounded-lg` → `rounded-kira`
    - `rounded-xl` → `rounded-kira-pill`
  - Covers every side and corner form (`-t-`, `-l-`, `-b-`, `-r-`, `-tl-`, …) and every variant
    chain, including the `!` sites (`CommandInput:31`, `CommandItem:70`, `Command:84`,
    `CommandDialog:27`).
- In `input-group/index.ts:14`, `:63` and `:65`, replace `var(--radius)` with `var(--kira-radius)`
  inside the existing calc arbitraries. The value is the same, and the arbitraries are
  registry-authored already.
- Delete from `shadcn-bridge.css` the `:root` `--radius` and the `@theme inline`
  `--radius-sm/md/lg/xl`.
- **Guard.**
  - Add a `check_alias` call for
    `rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-(?:xs|sm|md|lg|xl|[2-4]xl)` over `SCAN_DIRS`
    only.
  - **Never extend it to GU/KU.** The `kv` root defines its own `--radius-sm`/`--radius-lg`
    (`GU/theme/tailwind.css`), and `kv:rounded-sm` and `kv:rounded-lg` are that root's canonical
    names.
- `rounded-full` and `rounded-none` are static, not theme-backed, and unaffected.
- **Risk.**
  - `rounded-xl` → `rounded-kira-pill` puts the dialog corners on the pill token: `DialogContent`,
    `Command`, `CommandDialog`, and `DialogFooter`'s `rounded-b-xl` if I2-21 kept it.
  - The two values are equal today (10px). Before, they were separate derivations
    (`--kira-radius + 4px` vs a literal).
  - Accepted, because the user's rule is one name per value. The commit body names this coupling.

**Done when**, for both commits:

- The alias guard passes.
- A scratch copy of `PT/components/ui/popover/PopoverContent.vue` with `bg-popover` put back fails
  the guard. So does one with `rounded-md`.
- `shadcn-bridge.css`'s `@theme inline` holds exactly `--color-primary`,
  `--color-primary-foreground`, `--color-muted-foreground` and `--color-border`, and no `--radius-*`.
- `build:studio` and `build:space` pass. Both commits touch `@theme`.

#### 3.11.4 Resizable adoption (I2-39)

**Decision.** The user chose to fold this in and move every call site onto the shadcn-vue
`Resizable` wrapper.

**Inventory.** From CodeGraph's `ResizableHandle` blast radius plus an import grep. **9 files
import reka Splitter parts directly, not the audit's 8.** The audit missed `CellEditorDock.vue`,
which imports `SplitterPanel` alone. Its panel is a child of each mounting view's group.

- Files importing `SplitterGroup` and `SplitterPanel`:
  - `SF/views/shared/keyvalue/KeyValuePane.vue:59`
  - `SF/views/httprequest/HttpRequestView.vue:39`
  - `SF/views/grpcrequest/GrpcRequestView.vue:21`
  - `SF/views/browse/BrowseView.vue:19`
  - `SF/views/grid/DataView.vue:17`
  - `SF/views/stream/StreamView.vue:27`
  - `SF/views/console/ConsoleView.vue:27`
  - `PW/components/WorkbenchShell.vue:38`
- File importing `SplitterPanel` only: `SF/views/shared/celleditor/CellEditorDock.vue:2`.
- Template instances:
  - `SplitterGroup` ×9: 2 in WorkbenchShell (`:133`, `:161`) and 1 per view.
  - `SplitterPanel` ×15: 4 in WorkbenchShell; 2 each in HttpRequest, Grpc and Browse; 1 each in
    KeyValue, Data, Stream, Console and CellEditorDock.
  - `ResizableHandle` ×9, already the wrapper.

**Registry source.** Fetched from `https://shadcn-vue.com/r/styles/reka-nova/resizable.json` and
read.

- `ResizablePanelGroup` wraps `SplitterGroup` with
  `cn('flex h-full w-full data-[orientation=vertical]:flex-col', props.class)` and passes slot
  props through.
  - That base is a no-op here. reka-ui 2.10.5's `SplitterGroup` already sets `display:flex`,
    `flex-direction`, `height:100%`, `width:100%` and `overflow:hidden` inline
    (`reka-ui/dist/Splitter/SplitterGroup.js:507-511`). Inline styles beat classes.
- `ResizablePanel` wraps `SplitterPanel` with `useForwardPropsEmits` and `useForwardExpose()`.
  - It has no `class` prop. Class, testid and style fall through to the root.
  - `useForwardExpose` keeps `resize()`/`collapse()` reachable through a template ref.

**Mechanism.** One commit. Placed after I2-27, the last commit that edits these views' templates.

- **Fetch** with iter1 §5.7's direct-curl procedure.
  - Write only `ResizablePanel.vue` and `ResizablePanelGroup.vue` under
    `PT/components/ui/resizable/`.
  - Rewrite the `@/lib/utils` import to `@theme/lib/utils`.
  - Keep the owned `ResizableHandle.vue`, which P110 B32 restyled. Never overwrite it.
  - Export both new files from `resizable/index.ts`.
  - License: MIT, the same registry as `field` and `empty`.
  - Keep the registry sources verbatim. They carry no colour or radius names, so I2-37/I2-38 have
    nothing to rename there.
- **Convert all 9 files.**
  - `SplitterGroup` → `ResizablePanelGroup`, `SplitterPanel` → `ResizablePanel`.
  - Import both from `@theme/components/ui/resizable`.
  - Every prop, `v-if`, `:order`, `size-unit`, `:default-size`/`:min-size`/`:max-size`, `@resize`
    and `ref` stays as is.
- **Call-site classes.** On the 6 group sites that read `class="flex flex-1 min-h-0 flex-col"`
  (KeyValue, HttpRequest, Grpc, Data, Stream, Console), drop `flex` and `flex-col`, leaving
  `class="flex-1 min-h-0"`. The base class and reka's inline style already set both. `gap-0.5`,
  `h-full` and BrowseView's group classes (utilities by then, from I2-17) stay.
- **WorkbenchShell typed refs** (`:65-66`).
  - `resize()` is exposed at runtime but is not in `ResizablePanel`'s public type.
  - Keep `useTemplateRef<InstanceType<typeof SplitterPanel>>` and change its import to
    `import type { SplitterPanel } from 'reka-ui'`. A type-only import is allowed.
  - `vGroup` (`:67`, fed to `useElementSize`) keeps working. VueUse's `unrefElement` takes the
    wrapper instance's `$el`, which is reka's root div.
- **Comments.**
  - `ResizableHandle.vue:8-12` says "ResizablePanel/ResizablePanelGroup are not fetched…". Replace
    it with one line saying all three parts are fetched and used.
  - `CellEditorDock.vue`'s template comment (`:24-30`) names `SplitterResizeHandle`/`SplitterPanel`.
    Update it to the wrapper names.

**Risk.**

- The DOM gains only `data-slot="resizable-panel"` / `"resizable-panel-group"`.
- Confirm at commit time that no spec selects reka's own attributes: `grep -rn 'data-panel' ST KT`
  should return 0 hits.
- `ST/ui/cell-editor.spec.ts:1243` asserts sizes through reka's px-to-percent conversion. It is
  unchanged, because the props pass straight through.
- `:order` panels behave the same. The group context is provided and injected across wrapper
  components; `ResizableHandle` already proves that.
- knip: both new components gain callers in the same commit, so `lint:dead` stays clean. The
  reason `ResizableHandle`'s comment gave for not fetching them no longer holds.
- Behaviour is checked at I2-33: the tree, cell-editor, http/grpc and browse ui specs, plus Studio
  visual.

**Done when.**

- `grep -rnE "import \{[^}]*\bSplitter(Group|Panel)\b[^}]*\} from 'reka-ui'"` over SF, KF, PW and
  PT lists only `PT/components/ui/resizable/`. That regex matches value imports, not `import type`.
- `<SplitterGroup` and `<SplitterPanel` return 0 template hits outside that directory.
- `bun run lint:dead` passes.

## 4. Structure: one sequential implementer

**Decision: one Sonnet implementer, sequential, whole plan.** Parallel streams were considered and
rejected. The candidate split was A = GU/KU and B = everything else. It has 5 real overlaps and
ordering links:

1. `scripts/check-theme-classes.sh` is edited by both: A's retirements plus the GU/KU scan, and
   B's retirements.
2. `package.json` `lint` is edited to wire the conflict script. That script scans both halves, so
   it can only be wired once both are clean.
3. `PT/kui-bridge.css` is a B-owned path, but the `--spacing-kui-*` removal (A's work) edits it.
4. The GU/KU guard extension (I2-31) depends on A's `kv:text-muted` rename (I2-30).
5. `KU/cn.ts` changes (I2-2) are prerequisites for the conflict script (B), which imports it.

The work is also lopsided. The GU/KU share is about 60 small mechanical edits; Studio/Space/PW is
most of the plan. So a split saves little wall time and needs cross-stream sequencing.
CLAUDE.md: parallel only when genuinely independent. It is not.

The amendment adds to that coupling:

- I2-35..I2-39 touch the run-state views, `check-theme-classes.sh`, `PT/base.css`, `PT/lib/utils.ts`
  and `shadcn-bridge.css`, all already edited by other rows.
- I2-37/I2-38 must follow every commit that adds or restyles `components/ui` files.

Still one sequential implementer.

Context budget: the plan is long. If the implementer halts, the orchestrator re-spawns a fresh one
with this file and `git log --grep 'P110 I2-'` (§1.3). That is the designed recovery, not a
split.

## 5. File ownership

Single stream, so there are no ownership boundaries. The orchestrator uses this map only to check
nothing strays outside the plan. Allowed paths:

- `SF/**`, `KF/**`, `PT/**`, `PW/**`, `GU/**`, `KU/**`
- `scripts/check-theme-classes.sh`, `scripts/check-class-conflicts.ts` (new)
- `package.json` (`lint`, `test:visual:space`, `test:visual:update:space`)
- `apps/kira-space/playwright.config.ts`
- `ST/**`, `KT/**` (spec selector moves, visual specs, baselines)
- `docs/v1.9/plans/P110-css-tailwind-migration-iter2.md` (§3.6.4 only)
- `docs/ARCHITECTURE.md`, `docs/v1.9/SPEC.md` (I2-34)

Nothing under `internal/`, `apps/*/internal/` or Go.

## 6. User decisions: deferred, then resolved

As first committed (`e009dbaf`), this section listed six items as out of scope. Each was a visible
change or a scope widening, and only the user can approve those (iter1 §1.4). The orchestrator
asked the user about the first four. Each original bullet is kept below as written, followed by
its resolution.

- **Spinner speeds.** `animate-spin` 1s ×10 vs `animate-kira-spin` 0.7s ×12. Both are deliberate:
  `PT/base.css:118-125` keeps 0.7s, and iter1 §1.4 approved git-ui's 1s. Unifying is a timing
  change.
  - **Resolved.** The user chose to unify on 1s `animate-spin`. Now in scope as §3.11.1, I2-35.
  - Recount: `animate-spin` is ×6, not ×10.
  - A third speed turned up and is included: codicon's 1.5s stepped spin at
    `GU/components/AppToolbar.vue:324`.
- **Alert `err` vs `destructive`.** They render differently (`PT/components/ui/alert/index.ts:15`,
  `:29`), so unifying is a colour change.
  - **Resolved.** The user chose to unify on `destructive`. Now in scope as §3.11.2, I2-36.
  - `err` has 2 consumers (StreamView). The variant and its orphaned `error-text` token are
    deleted.
- **Colour-name pairs** (`fg`/`foreground`, `bg`/`background`, …) and `rounded-kira-sm` =
  `rounded-md`. The kira names are the user-settable seam. I2-34 records the canonical rule in
  `docs/ARCHITECTURE.md` instead: kira names in app code, shadcn names inside `components/ui`.
  - **Resolved.** The user chose to collapse each pair to one canonical name with a real rename
    sweep, not documentation only. Now in scope as §3.11.3, I2-37 (colours) and I2-38 (radii).
  - The kira name survives repo-wide.
  - The "user-settable seam" premise above was wrong: no colour or radius token is set at runtime
    (§3.11.3 Finding 3).
  - I2-34 now records the one-name-per-value rule instead of the split.
- **Resizable half-adoption** (audit §7): 8 importers use reka `SplitterGroup` directly. Not one of
  the 8 categories.
  - **Resolved.** The user chose to fold it in and convert every call site. Now in scope as
    §3.11.4, I2-39.
  - The real count is 9 files. `CellEditorDock.vue` imports `SplitterPanel` alone.

Still out of scope, and not part of this round of user decisions:

- **Shared grid templates** (audit §1e, `VariableRow`/`VariableSetView`). Judgment, not in the 8
  categories.
- **M11 view-header chrome ×11.**

## 7. Commit order (tag, subject, done when)

Every subject ends with `(P110 I2-n)`. Every commit passes the hook. Row order is execution order
(§1.3). I2-35 runs right after I2-2, and I2-36..I2-39 run between I2-32 and I2-33.

| Tag | Commit | Done when |
|---|---|---|
| I2-1 | `docs(v1.9): record settings field computed styles, pre-phase vs HEAD` | §3.6.4 filled |
| I2-1b | `test(visual): settings baselines for Studio and Space` | both `test:visual:*` pass clean |
| I2-2 | `fix(theme,kira-ui): register missing tailwind-merge groups` | the §3.1 one-liners hold; no `animate` entry added |
| I2-35 | `refactor(theme,git-ui): one 1s spinner, retire animate-kira-spin` | §3.11.1 done-when; guarded |
| I2-3 | `chore(scripts): add class-conflict check (unwired)` | script runs and lists hits |
| I2-4 | `feat(studio): RunState component, fixes label colour` | `runStateLabel` only in `RunState.vue`; spec colour assert |
| I2-5 | `fix(studio): current search match text colour` | 3 ternaries |
| I2-6 | `fix(workbench): terminal failed footer colour` | ternary |
| I2-7 | `fix: restore pre-phase values lost to utility sort order` | M3 ×7, M4 ×2 |
| I2-8 | `refactor: drop redundant same-group utility pairs` | script has 0 hits |
| I2-9 | `build: run class-conflict check in lint` | `bun run lint` includes it and passes |
| I2-10 | `feat(theme): add shadcn-vue empty component` | files under `PT/components/ui/empty/` |
| I2-11 | `refactor: empty states onto Empty` | `empty-state` 0 hits; 3 utilities gone; guarded |
| I2-12 | `refactor(studio): inline columns-menu utilities` | 5 utilities gone; guarded |
| I2-13 | `feat(workbench): TreeTwisty` | `twisty` utility gone; specs on testid; guarded |
| I2-14 | `refactor: row components take class, own selection ternary` | `tree-row` gone; row blocks gone; guarded |
| I2-15 | `refactor: shared virtual/sticky row classes` | 9 copies gone; revert comment gone; guarded |
| I2-16..I2-20 | `refactor(<area>): convert <file> style block to utilities` | §3.3 per file |
| I2-21 | `refactor(theme): restyle dialog header/footer/title bases` | 0 per-site override strings |
| I2-22 | `feat(theme): NumberStepperInput` | 0 `step-btn`/`useNumberStepper` |
| I2-23 | `feat(workbench): ViewToolbar` | 1 toolbar literal |
| I2-24 | `feat(theme): SwatchRadio` | 1 swatch string |
| I2-25 | `refactor: test-hook classes to data-testid` | guarded |
| I2-26 | `refactor(settings): fields onto Field components` | §3.6.3; I2-1b baselines pass |
| I2-27 | `refactor(studio): arbitrary values to scale/token utilities` | §3.7 Studio list 0 hits |
| I2-28 | `refactor(git-ui,kira-ui): arbitrary values to scale/token utilities` | §3.7 kv list 0 hits |
| I2-29 | `refactor(kira-ui)!: drop kui spacing scale for default steps` | `--spacing-kui-` 0 hits |
| I2-30 | `refactor(git-ui): text-muted to text-muted-foreground` | `kv:text-muted(?!-)` 0 hits |
| I2-31 | `build(guard): scan git-ui/kira-ui, add unguarded names` | §3.8 done-when |
| I2-32 | `chore(theme): delete orphaned seam tokens` | 4 names 0 hits |
| I2-36 | `refactor(studio,theme): stream error alerts onto destructive, drop err variant` | §3.11.2 done-when; `text-error-text` guarded |
| I2-37 | `refactor(theme)!: one colour name per value, kira names survive` | §3.11.3 done-when (colour half); bridge `@theme inline` keeps 4 colour names |
| I2-38 | `refactor(theme)!: one radius name per value, add rounded-kira-xs` | §3.11.3 done-when (radius half); no `--radius-*` in the bridge |
| I2-39 | `refactor(studio,workbench): splitters onto Resizable wrappers` | §3.11.4 done-when |
| I2-33 | `test: full suites, fixes` | §0.11 all green; fixes carry the I2-33 tag |
| I2-34 | `docs: record P110 iter2` | `ARCHITECTURE.md`: conflict check; one name per value (§3.11.3); registry-pull rename step; `Empty`; row `class` rule; `Resizable` wrappers only; one spinner speed. SPEC P110 row cites this file |

I2-29's `!`: kira-ui's exported theme partial loses tokens. The only host is git-ui's root, so
there is no external consumer. Still, mark it breaking per Conventional Commits.

I2-37/I2-38's `!` follows the same reasoning: `PT`'s theme loses the shadcn alias utilities and
`--radius-*`. Studio and Space are its only consumers, but mark both commits breaking anyway.

I2-34 amended (§6): the old wording was "canonical names: kira in app code, shadcn in
`components/ui`". It now records the one-name-per-value rule and the step that goes with it: any
future shadcn-vue registry pull renames alias names at pull time, and the alias guard enforces
it. Also update `ARCHITECTURE.md:34`'s "moving the app's own legacy meanings onto their own names"
sentence to match.

## 8. Risks and drift

- **Line drift.** All lines are at `e0bd15cd`. Re-grep by content, not number.
- **Twisty and sticky semantics.** `RepoSearchRow`'s twisty and the sticky rows differ on purpose
  (§3.2). Read before merging.
- **Named groups.** A bare `group-hover:` under a nested `group` ancestor lights up on the wrong
  hover. Always use `group/<name>`.
- **Preflight scope.** §3.5.2 applies to Studio/Space roots only. git-ui has no preflight
  (`GU/theme/tailwind.css:8`), so its inherit utilities stay.
- **twMerge-only conflicts.** `leading-*` versus a later font size is a twMerge drop, not a CSS
  conflict. The script flags it on purpose (§3.1), and the fix is reordering, never deleting.
- **Space visual flake.** P114's harness issue is scoped to one spec. If the new Space visual
  project hits launch timeouts, report it with the log line. Do not skip it.
- **Mask prefix.** If v4 drops `-webkit-mask-*` in the git-ui root and the VS Code webview needs
  it, keep the `-webkit-` arbitraries and say so (§3.7).
- **Registry pulls after I2-37/I2-38.** `components.json` (both apps) still points the shadcn-vue
  CLI at `shadcn-bridge.css` with `cssVariables: true`. A CLI `add` would re-inject the deleted
  vars. Keep iter1 §5.7's direct-curl procedure, and rename alias names at pull time; the alias
  guard fails lint until that happens. `components.json` itself is not changed.
- **Radius guard scope.** The `kv` root's own `rounded-sm`/`rounded-lg` are canonical there. The
  I2-38 guard must never scan GU/KU (§3.11.3).
- **Hook cost.** The conflict script adds a full SFC parse to every commit. If it exceeds about 5s,
  cache per-file results by mtime in `node_modules/.cache/`. Measure before adding a cache.

## 9. Verification (orchestrator runs each for real)

1. `git log --oneline --grep 'P110 I2-'` shows every tag in §7.
2. `bun run lint`, `bun run typecheck`, `bun run test:unit`, the three builds, `test:ui:studio`,
   `test:ui:space` (P114 exception only), `test:webview`, `test:visual:studio` and
   `test:visual:space` all pass. Re-records match the §1.4 list, per commit bodies.
3. Conflict script is real: copy `SF/views/grid/DataView.vue` to scratch, add
   `class="text-fg text-subtle"` to a template element, run the script against it and see it fail.
   Discard the copy. Then check the self-check catches a planted `--text-foo: 1px` in a scratch
   copy of `base.css`.
4. `node -e` in the repo root:
   - `cn('text-subtle','text-info')` = `text-info`
   - `twMergeKv('kv:text-kui-fg kv:text-kui-base')` keeps both
   - `cn('rounded-kira-xs rounded-kira-sm')` = `rounded-kira-sm` (I2-38 registration). This
     replaces the original `animate-kira-spin` check: I2-35 deleted that token.
5. `grep -c '^@utility' packages/theme/src/base.css` = 4.
6. `grep -rlE '^<style' --include=*.vue apps packages | grep -v node_modules` lists exactly the 5
   files in §0.5.
7. Zero hits for each:
   - `runStateLabel` outside `RunState.vue`
   - `step-btn`, `useNumberStepper`
   - `data-slot="field"` outside `components/ui`
   - `fieldVariants(` outside `components/ui/field`
   - `border-t border-border bg-transparent`
   - `flex-row items-center gap-1.5 border-b border-border px-3 py-2`
   - `text-kira-lg font-normal` on `DialogTitle`
   - `h-bar shrink-0 flex items-center` outside `ViewToolbar.vue`
   - `kv:text-muted(?!-)`, `-kui-[1-6]\b`
   - the 4 orphan token names
   - every §3.7 literal
   - `kira-spin`, and `codicon-modifier-spin` in `.vue`
   - `<Alert … variant="err">` (multi-line aware) and `error-text` outside comments
   - value imports of `SplitterGroup`/`SplitterPanel` from `reka-ui` outside
     `PT/components/ui/resizable/`
8. Guard is real: a scratch copy of a GU file with `class="p-btn"` fails
   `check-theme-classes.sh`. `git stash` or discard it after.
9. Settings: §3.6.4 is filled, and I2-26's commit shows the I2-1b baselines unchanged, or names
   each re-recorded pane.
10. Run-state colour: `ST/ui/data-view.spec.ts` has the colour assertion, and it passes.
11. The alias guard is real. Put `bg-popover` back into a scratch copy of
    `PT/components/ui/popover/PopoverContent.vue` and confirm `check-theme-classes.sh` fails. Do
    the same with `rounded-md`. Discard both copies.
12. `shadcn-bridge.css`'s `@theme inline` lists exactly `--color-primary`,
    `--color-primary-foreground`, `--color-muted-foreground` and `--color-border`.
