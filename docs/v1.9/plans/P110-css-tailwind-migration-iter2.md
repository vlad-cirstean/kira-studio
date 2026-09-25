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
   name this iter retires is guarded.
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
  - Expensive suites run once, at I2-33.
- **Resumability.** Every decision is in this file.
  - To resume, run `git log --oneline --grep 'P110 I2-'`. Resume at the first missing tag.
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

**Conditional.** Fix only if I2-1 or I2-21 measures it as real. Report it in the commit body.

- The settings-field regressions (§3.6).
- The DialogFooter overshoot (§3.10).

**Any other visible change stops the implementer.** Write it in the commit body and ask the
orchestrator. §6 lists decisions that need the user and are not part of this iter.

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

- `PT/lib/utils.ts`: add `completion-max-w` to `spacing`. Add `animate: ['kira-spin']` to `theme`.
  In tailwind-merge 3, the `animate` theme key is the group.
- `KU/cn.ts`: add `kui-xs`, `kui-sm` and `kui-base` to `text`.
- Verify with a node one-liner, not by reading:
  - `cn('text-fg text-kira-sm')` keeps both.
  - `twMergeKv('kv:text-kui-fg kv:text-kui-base')` keeps both.
  - `cn('animate-spin animate-kira-spin')` = `animate-kira-spin`.
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
      animate-kira-spin', error: 'border-error' }` on `size-3 shrink-0 rounded-full border-2`.
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

_Empty until I2-1 lands. I2-26 must not start while this section is empty._

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

## 6. Out of scope: user decisions, reported not fixed

Each item below is a visible change or a scope widening. Only the user can approve those
(iter1 §1.4). The orchestrator raises them.

- **Spinner speeds.** `animate-spin` 1s ×10 vs `animate-kira-spin` 0.7s ×12. Both are deliberate:
  `PT/base.css:118-125` keeps 0.7s, and iter1 §1.4 approved git-ui's 1s. Unifying is a timing
  change.
- **Alert `err` vs `destructive`.** They render differently (`PT/components/ui/alert/index.ts:15`,
  `:29`), so unifying is a colour change.
- **Colour-name pairs** (`fg`/`foreground`, `bg`/`background`, …) and `rounded-kira-sm` =
  `rounded-md`. The kira names are the user-settable seam. I2-34 records the canonical rule in
  `docs/ARCHITECTURE.md` instead: kira names in app code, shadcn names inside `components/ui`.
- **Resizable half-adoption** (audit §7): 8 importers use reka `SplitterGroup` directly. Not one of
  the 8 categories.
- **Shared grid templates** (audit §1e, `VariableRow`/`VariableSetView`). Judgment, not in the 8
  categories.
- **M11 view-header chrome ×11.**

## 7. Commit order (tag, subject, done when)

Every subject ends with `(P110 I2-n)`. Every commit passes the hook.

| Tag | Commit | Done when |
|---|---|---|
| I2-1 | `docs(v1.9): record settings field computed styles, pre-phase vs HEAD` | §3.6.4 filled |
| I2-1b | `test(visual): settings baselines for Studio and Space` | both `test:visual:*` pass clean |
| I2-2 | `fix(theme,kira-ui): register missing tailwind-merge groups` | the §3.1 one-liners hold |
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
| I2-33 | `test: full suites, fixes` | §0.11 all green; fixes carry the I2-33 tag |
| I2-34 | `docs: record P110 iter2` | `ARCHITECTURE.md` (conflict check, canonical names, `Empty`, row `class` rule); SPEC P110 row cites this file |

I2-29's `!`: kira-ui's exported theme partial loses tokens. The only host is git-ui's root, so
there is no external consumer. Still, mark it breaking per Conventional Commits.

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
   - `cn('animate-spin animate-kira-spin')` = `animate-kira-spin`
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
8. Guard is real: a scratch copy of a GU file with `class="p-btn"` fails
   `check-theme-classes.sh`. `git stash` or discard it after.
9. Settings: §3.6.4 is filled, and I2-26's commit shows the I2-1b baselines unchanged, or names
   each re-recorded pane.
10. Run-state colour: `ST/ui/data-view.spec.ts` has the colour assertion, and it passes.
