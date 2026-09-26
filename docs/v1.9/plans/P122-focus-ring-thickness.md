# P122 — Focus ring too thick, both apps: plan

Planning only. One Opus pass, verified at `8f78d94e` (branch tip incl. P119 + P124). Implementer:
one sequential Sonnet subagent (§4). Abbreviations: `PT/` = `packages/theme/src/`, `UI/` =
`PT/components/ui/`, `SF/` = `apps/kira-studio/frontend/src/`, `KF/` =
`apps/kira-space/frontend/src/`, `GU/` = `packages/git-ui/src/`, `KU/` = `packages/kira-ui/src/`.

## §0 Goal, method, acceptance

User ask, verbatim: "when an input is selected, the borders become blue, that's fine but they are
so thick, make them a simple 1px or what's the value for the filter input in sql view. Do this for
any element that has such a marging highlight when clicked."

Method. CodeGraph (`codegraph_explore`) traced the reference field, the shared theme, every shadcn
primitive and their consumers. Its index is built from the main checkout, not this worktree, so
every file:line below was re-checked with `rg`/`sed` against this worktree. Raw `<input>`/
`<textarea>`/`<select>`/`<button>` tags were enumerated by a template-aware script, not a line grep
(multi-line tags). No running app: the sandbox has no GUI and the reference value is fully declared
in source; computed values below are derived from Tailwind 4.3.3's documented utility output and
get asserted for real by the §6.2 guard.

Acceptance (SPEC row):

1. The SQL-view filter input keeps its exact rendered value and is named as source of truth (§1).
2. Every other over-thick focus ring in both apps renders at that value (§2).
3. One shared definition carries it; no component fixed with a local override bypassing it (§3).

## §1 Reference value — the SQL data view's WHERE / ORDER BY filter

Site. `SF/views/grid/FilterToolbar.vue:154-168` (WHERE, `data-testid="filter-where-input"`) and
`:170-183` (ORDER BY). Both render `AutocompleteField`
(`SF/views/shared/AutocompleteField.vue:523-528`): `<InputGroup variant="kira">` around a raw
`<input>` carrying `outline-none` (`:581`), so the box, not the input, draws focus.

Declared style, `UI/input-group/index.ts:50` (`inputGroupVariants`, `kira`):

```
border border-border-strong … focus-within:border-focus focus-within:outline
focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-focus
```

Computed when focused (fieldset `[data-slot=input-group]`):

- `border`: 1px solid `--kira-focus` = `#0078d4` = `rgb(0, 120, 212)` (`PT/tokens.css:16`).
- `outline`: 1px solid `rgb(0, 120, 212)`, `outline-offset: -1px`. The outline sits exactly on the
  1px border, so the visible ring is one 1px `#0078d4` line.
- `box-shadow`: `none`.

Target value everywhere: **1px solid `--kira-focus`, inset over the element's own 1px edge**
(`outline-offset: -1px`), no box-shadow halo.

Same value already lives in other surfaces: every `AutocompleteField` user (Mongo filter, HTTP URL,
gRPC, form-data, field rows); `NativeSelect` (`UI/native-select/index.ts:22`); SlickGrid cell editor
(`SF/views/shared/slick/slickTheme.css:288-291`, `--kira-accent`, same `#0078d4`); every `KU/`
control and the `GU/` sites in §2.3. The thick rings below are the outliers, not the reference.

## §2 Inventory

### §2.1 Over-thick — shadcn-vue `ring-3` halo (root cause of the user's report)

Registry default: `focus-visible:border-focus` + `focus-visible:ring-3 focus-visible:ring-focus/50`.
Renders a 1px `#0078d4` border plus a 3px 50%-alpha `box-shadow` halo outside it: a 4px blue band.
Every consumer inherits it; no consumer overrides it except §2.4.

| # | Site | Current | Consumers (inherit) |
|---|---|---|---|
| T1 | `UI/input/index.ts:12` (`inputVariants` base) | 1px border + 3px halo, `outline-none` | 64 `<Input>` in 30 files, e.g. grid find box `SF/views/shared/page/SearchToolbar.vue:271`, pager `SF/views/shared/page/PagerControls.vue:94`, every `ConnectionDialog` field (`:818-919`), `packages/workbench/src/prompt/TextPromptDialog.vue:48`, `KF/repo/RepoSearchView.vue:106` |
| T2 | `UI/textarea/Textarea.vue:24` | same | 8 `<Textarea>` in 6 files |
| T3 | `UI/input-group/index.ts:49` (`default` variant) | same, keyed `has-[[data-slot=input-group-control]:focus-visible]:` on the fieldset | 20 default `<InputGroup>` sites (collections/project/terminal/git tree search, history lists, cookies, schema browser, definition filter, field rows) plus `PT/NumberStepperInput.vue:40` (14 callers: every settings stepper, ConnectionDialog port, GenerateDataDialog) |
| T4 | `UI/button/index.ts:7` (`buttonVariants` base) | same, `outline-none` | 170 `<Button>` in 71 files + `PT/components/TooltipIconButton.vue` (238 uses in 66 files) + `InputGroupButton` |
| T5 | `UI/button/index.ts:19` (`destructive`) | `focus-visible:ring-error/20 dark:focus-visible:ring-error/40 focus-visible:border-error/40` (3px red-tint halo, rides T4's `ring-3`) | 37 `variant="destructive"` uses |
| T6 | `UI/toggle/index.ts:7` (`toggleVariants`) | same, `outline-none` | 1 `<Toggle>`, 28 `<ToggleGroupItem>` in 18 files (`UI/toggle-group/ToggleGroupItem.vue:37`) |
| T7 | `UI/checkbox/Checkbox.vue:22` | same, `outline-none` | 38 `<Checkbox>` in 16 files |

Keyboard-only for T4-T7 (a mouse click on a button never matches `:focus-visible`). T1-T3 show on
every click: text fields match `:focus-visible` on mouse focus. T1-T3 are what the user saw.

### §2.2 Over-thick — browser default ring, never overridden

No rule anywhere in `PT/` sets a default focus outline (`rg -n outline PT/*.css` returns none).
Tailwind preflight sets none either. Any focusable element without its own outline utility gets the
engine's UA ring: WebKit (WKWebView/WebKitGTK, and the Playwright `ui`/`visual` projects)
`outline: auto 5px -webkit-focus-ring-color`; WebView2/Chromium `outline: auto 1px`, drawn as a
~2px double ring. Both thicker than §1, and neither is `#0078d4`.

| # | Scope | Sites |
|---|---|---|
| U1 | Raw `<button>` with no outline utility | 73 buttons in 44 files. Studio: `SF/project/{FiltersDialog(5),ConnectionDialog(5),ErrorPopover}`, `SF/views/shared/{DateTimePicker(4),SavedListMenu,FilterHistoryMenu:170}`, `SF/api/{EnvironmentSelect(4),MethodSelect(2),VariablesOverviewPanel(3),DynamicValuesDialog,CollectionsPanel}`, `SF/views/{httprequest/ResponsePane(3),httprequest/CookiesPane(2),httprequest/RequestSettingsPane,grpcrequest/ResponsePane(2),grpcrequest/SchemaBrowser,console/ConsoleView(3),console/ExplainResultView,console/ConsoleSavedMenu,shared/celleditor/CellEditorView(2),shared/document/DocumentTree,shared/document/DocumentRow,definition/ConstraintsSection,browse/BrowseView}`, `SF/workbench/{WorkbenchShell,TitleBar,GenerateDataDialog,panels/StudioStart,panels/OperationsPanel}`, `SF/terminal/TerminalPanel`. Shared: `packages/workbench/src/components/{TabStrip(3),SettingsShell:218,TreeTwisty,UpdateAvailableItem}`. Space: `KF/workbench/{WorkbenchShell,StatusBar}`; `GU/components/{CommitMeta(3),CommitGrid(2),StackList,BranchPicker}` in Space's document |
| U2 | `tabindex` rows/regions (roving focus, keyboard nav) | 27 attrs in 18 files: `SF/project/{TreeRow,ProjectTree}`, `SF/api/{CollectionRow,CollectionsTree}`, `SF/views/{console/ConsoleResultGrid,stream/StreamView,httprequest/ResponseHistoryList,grpcrequest/CallHistoryList,browse/BrowseView,shared/document/DocumentRow,shared/SavedListMenu,shared/keyvalue/KeyValuePane}`, `SF/workbench/panels/OperationsPanel`, `KF/repo/{RepoTreeRow,GitPanel,RepoSearchRow}`, `packages/workbench/src/components/TreeTwisty`, `UI/tooltip/TooltipDisabledTrigger` |
| U3 | Raw git-ui dialog fields (Kira Space desktop) | no outline rule: `GU/components/WorktreeList.vue:194`; `GU/components/dialogs/BranchDialog.vue:63`, `ForcePushDialog.vue:97`, `RenameRefDialog.vue:59`, `RepoSettingsDialog.vue:209,257`, `ResetDialog.vue:171`, `StackDialog.vue:133`, `StashDialog.vue:260,293,315`, `TagDialog.vue:68,99`, `WorktreeDialog.vue:263,288,302,312,322` — 18 fields |

U3 note: git-ui mounts into Kira Space's own document (`GU/theme/tailwind.css:1-6`), lazily, after
the host's `@theme/base.css` root. So a base-layer rule in `PT/base.css` reaches these fields in
Space with no git-ui edit, and host's `@layer theme, base, components, utilities;` order (declared
first) keeps every `kv:` utility above it.

### §2.3 Over-thick — other declared widths

| # | Site | Current | Disposition |
|---|---|---|---|
| W1 | `PT/SwatchRadio.vue:32` | `peer-focus-visible:outline-2 outline-offset-2 outline-fg` (2px, `--kira-fg`, outside) | Named exception, §3.5 |

### §2.4 No ring at all — hand-rolled copies of the reference box

Five Studio fields hand-roll the `kira` InputGroup box (`h-control rounded-kira-sm border
border-border-strong bg-field px-2 gap-1`, same classes) around a borderless `<Input>` that
suppresses its own ring with `focus-visible:ring-0`. Net: no focus indicator on either element.
Not over-thick, but §3.3 removes `ring-3` from `Input`, which makes `focus-visible:ring-0` dead and
lets the §3.1 base rule paint an inset outline on the borderless inner input, inside the box. So
these must change in this phase; §3.4 moves them onto the reference primitive itself.

| # | Wrapper | Inner `<Input>` |
|---|---|---|
| H1 | `SF/project/ConnectionDialog.vue:659-667` (`h-control-lg`, engine search) | `:661`, `focus-visible:ring-0` at `:664` |
| H2 | `SF/views/browse/BrowseView.vue:340-350` (tree filter) | `:344`, `:347` |
| H3 | `SF/views/stream/StreamView.vue:825-840` (Kafka `offset`) | `:833`, `:836` |
| H4 | `SF/views/stream/StreamView.vue:902-918` (Kafka `since`; `:904` toggles `border-error`) | `:911`, `:914` |
| H5 | `SF/workbench/panels/OperationsPanel.vue:225-232` (ops filter) | `:227`, `:230` |

### §2.5 Already at target (1px, focus colour) — untouched

- Reference and its `AutocompleteField` consumers (§1).
- `UI/native-select/index.ts:22` — 1px outline, -1px, `outline-focus`. Moves onto §3.1 in §5 commit
  2, rendered identical.
- `SF/views/shared/slick/slickTheme.css:288-291` — cell editor, 1px `--kira-accent` (`#0078d4`),
  -1px. Unlayered scoped rule on SlickGrid-built DOM; no template to carry a utility.
- `KF/views/repo/ReviewThread.vue:76-78` — `focus:outline-none focus:border-focus` (1px border).
- `SF/api/CollectionRow.vue:176` — rename input, persistent 1px `border-primary`, not a focus ring.
- `KU/KuiButton.vue:38`, `KuiTextInput.vue:21`, `KuiSelect.vue:35`, `KuiSearchInput.vue:97`;
  `GU/components/UncommittedChangesStrip.vue:131`, `FileTree.vue:257`,
  `review/ReviewCommitRow.vue:201` (-2px offset); `GU/components/CommitGrid.vue:1403-1406`
  (`.slick-row:focus-visible`); `GU/theme/app-shell.css:81-84` (checkbox, +1px). All 1px
  `--kv-focus-border`, which resolves to `--kira-focus` in Space
  (`PT/vscode-bridge.css:61`). Separate `kv:`-prefixed Tailwind root with its own host-agnostic
  token vocabulary (it also ships in the VS Code webview, where `--kira-*` does not exist), so
  `PT/base.css`'s utility is unreachable there by design. Not migrated: already at target, and the
  SPEC row asks to fix over-thick rings, not re-home correct ones.
- Vendor CSS: SlickGrid `.grid-canvas/.slick-pane/.slick-viewport{outline:0}`,
  `.slick-cell:focus{outline:none}`; Monaco `.inputarea{outline:none!important}`; xterm
  `.xterm:focus{outline:none}`. Unlayered, so §3.1's base-layer rule never reaches them.

### §2.6 Not focus rings — out of scope

- `aria-invalid:ring-3` + `ring-error/20|/40` in T1-T4, T7 and `has-[[data-slot][aria-invalid=true]]:ring-3`
  in T3: a persistent 3px red validation halo, not triggered by clicking. Live on 13 call sites
  (settings steppers, `SearchToolbar.vue:277` regex error, `ConnectionDialog.vue:970`,
  `KF/repo/RepoSearchView.vue:111`, …). Left exactly as-is; see §7 Q1.
- `ring-1` on `UI/dialog/DialogContent.vue:36`, `UI/dropdown-menu/DropdownMenuContent.vue:35`,
  `DropdownMenuSubContent.vue:23`, `UI/popover/PopoverContent.vue:37`: static 1px panel edge.
- `focus:bg-hover` menu items (`UI/dropdown-menu/*Item.vue`), `kv:focus-visible:bg-focus` resize
  handles (`GU/App.vue:1893`, `CommitGrid.vue:1276-1296`): fill, not ring.
- `.kv-badge-current` (`CommitGrid.vue:1704-1706`) and `.kv-row-head` inset bar: state markers.
- `SwatchRadio.vue:34` checked-state `outline-2`: selection indicator (§3.5).

## §3 Fix — one definition

### §3.1 The definition (`PT/base.css`)

One `@utility`, beside the file's existing `@utility` block (`base.css:121+`), plus one base-layer
rule that applies it to every natively focused element:

```css
/* P122: the one focus ring — the SQL filter field's own value (FilterToolbar/AutocompleteField):
   1px of --kira-focus laid over the element's own 1px edge. */
@utility focus-ring {
  outline: var(--kira-border-width) solid var(--kira-focus);
  outline-offset: calc(var(--kira-border-width) * -1);
}

@layer base {
  :focus-visible {
    @apply focus-ring;
  }
}
```

- `--kira-border-width` (`PT/tokens.css:73`, `1px`): the ring is the border's own width by
  definition (it overlays the border), so it reads the border token instead of a second literal.
  No new token.
- Base layer: author-origin, so it replaces every UA ring (§2.2) on exactly the elements the UA
  would ring — same trigger (`:focus-visible`), new width/colour. Any utility (layer `utilities`)
  or unlayered vendor/scoped rule still beats it. That is the opt-out: `outline-none` keeps
  working wherever an element draws focus some other way.
- `@utility`: for the two cases where the ring belongs on an ancestor, not the focused element —
  the InputGroup box (`focus-within:` / `has-[…:focus-visible]:`). Same declarations, one source.

No `extendTailwindMerge` registration needed (`PT/lib/utils.ts`): no call site merges `focus-ring`
against another outline class (§3.3's suppression uses layer order, not twMerge).

### §3.2 Reference onto the definition, value unchanged

`UI/input-group/index.ts:50` (`kira`): replace `focus-within:outline focus-within:outline-1
focus-within:-outline-offset-1 focus-within:outline-focus` with `focus-within:focus-ring`. Keep
`focus-within:border-focus` (visually covered by the outline, but it keeps the corner arcs blue if
anti-aliasing differs). Computed value identical to §1; §6.2 asserts it.

`UI/native-select/index.ts:22`: delete `focus-visible:outline focus-visible:-outline-offset-1
focus-visible:outline-focus` (the base rule now draws it; `<select>` is natively focused and the
string has no `outline-none`). Keep `focus-visible:border-focus`.

### §3.3 shadcn primitives — drop the halo, inherit the base rule

For each of T1, T2, T4, T6, T7: delete `focus-visible:ring-3`, `focus-visible:ring-focus/50` and
`outline-none` from the cva/base string. Keep `focus-visible:border-focus`. The element is the
focused node, so §3.1's base rule draws the ring; nothing per-component.

- T5 (`destructive`): delete `focus-visible:ring-error/20 dark:focus-visible:ring-error/40` (dead
  once `ring-3` is gone) and `focus-visible:border-error/40` (covered by the outline). Add
  `focus-visible:outline-error`: colour only, keeps the registry's own "destructive focus is
  error-tinted" meaning; width, style and offset still come from §3.1. This is the one variant-level
  colour override; it overrides no width.
- T3 (InputGroup `default`, `:49`): replace `has-[[data-slot=input-group-control]:focus-visible]:ring-3`
  and `has-[[data-slot=input-group-control]:focus-visible]:ring-focus/50` with
  `has-[[data-slot=input-group-control]:focus-visible]:focus-ring`. Keep its `border-focus`
  sibling. `in-data-[slot=combobox-content]:focus-within:ring-0` /
  `…:focus-within:border-inherit`: `rg 'combobox-content'` finds no element carrying that slot
  outside this string (dead registry clause); delete both rather than translate.
- `UI/input-group/InputGroupInput.vue:15` and `InputGroupTextarea.vue:15`: replace `ring-0
  focus-visible:ring-0` with `outline-none` (the box owns the ring; utility layer beats the base
  rule). Keep `aria-invalid:ring-0` (§2.6 stays as-is). This is the primitive's own existing
  suppression, translated — not a new per-consumer override.
- `ToggleGroupItem.vue:36`'s `focus:z-10 focus-visible:z-10` stays: it lifts the focused segment
  so its inset outline is not covered by a neighbour.

Leave the rest of each registry string untouched (P110 B25's own rule for `components/ui`).

### §3.4 Hand-rolled boxes onto the reference primitive (H1-H5)

Each wrapper `<div>` becomes `<InputGroup variant="kira">` (the §1 primitive) and its `<Input>`
becomes `<InputGroupInput>`. Carry over only what differs from the variant:

- H1: `class="flex h-control-lg font-ui"`; H2: `class="flex w-full font-ui"`; H3: `class="flex
  w-full"`; H4: `class="flex w-40"` plus `:aria-invalid="!!timestampError"` (replaces the `:904`
  `border-error` ternary with the variant's own `aria-invalid:border-error`); H5: `class="flex-none
  flex w-40"`. `flex` replaces the variant's `inline-flex` through `cn()` so no parent gains an
  inline line box.
- Inner: keep `h-full p-0` and the font class; drop `w-full border-0 bg-transparent
  focus-visible:ring-0` (`InputGroupInput` carries `border-0 bg-transparent flex-1` itself).
- Prefix spans and icons stay as the box's first children, unchanged.
- The variant also sets `font-data text-kira-sm text-fg`; H1/H2 override font to `font-ui`. The
  inner `Input` keeps its own `text-base md:text-sm`, as today. Confirm each box renders
  pixel-identical at rest (§6.3) — only the focus ring may change.

### §3.5 Named exception — `PT/SwatchRadio.vue:32`

Colour swatch (16px round chip) radio. Its keyboard-focus ring (`peer-focus-visible:outline-2
outline-offset-2 outline-fg`) is byte-identical to its checked-state ring (`:34`), white, drawn
outside the chip. Not changed, because:

- An inset 1px ring (§3.1's offset) disappears into the chip's own fill; this element genuinely
  needs an outside offset the shared utility does not have.
- Overriding `outline-offset` on top of `focus-ring` is an ordering fight between two same-variant
  utilities in one layer — no guaranteed winner. Parameterising the utility for one call site is
  not worth a second knob.
- It is the selection indicator doubling as focus, not the blue highlight the user reports.

Flagged for the user (§7 Q2) rather than silently left.

### §3.6 What is not touched

`GU/`/`KU/` source (§2.5); the VS Code host (§7 Q3); `aria-invalid` halos (§7 Q1); every consumer
of T1-T7 (inherits). Zero `packages/workbench` edits.

## §4 Split call, overlap, implementer

No stream split. §3.2-§3.4 are order-dependent on §3.1 (the base rule must exist before `Input`
drops `outline-none`) and on each other (H1-H5 must move before `Input` changes, or they briefly
paint an inner ring). One sequential Sonnet implementer.

File overlap with the concurrent P120 stream (`.claude/worktrees/stream-b-p120`, plan
`docs/v1.9/plans/P120-studio-git-audit.md`), checked against that plan's own site tables:

- `SF/views/stream/StreamView.vue` — P120 edits a comment at `:392-393`; P122 edits `:825-918`.
- `SF/views/browse/BrowseView.vue` — P120 edits a comment at `:198`; P122 edits `:340-350`.
- `docs/ARCHITECTURE.md` — P120 edits `:2210,3555-3562,4078-4087`; P122 edits the Styling row
  (`:34`).
- Studio `tests/visual/settings.spec.ts-snapshots/*.png` — P120 removes three Studio settings
  fields, so it will re-record these; P122 re-records only if §6.4 shows a focus-ring diff. PNGs
  never text-merge: whichever stream lands second re-runs `bun run test:visual:update:studio` for
  the conflicting files after rebase, never hand-picks a side.
- `OperationsPanel.vue`: P120 lists it as a keep (false positive), no edit. No P120 file in `PT/`
  or `packages/workbench/src/`.

Text hunks are disjoint, so a rebase should apply cleanly; the orchestrating session confirms.

P121/P123 (SPEC rows' own note): P121 (tab strips) likely touches `UI/toggle/index.ts` /
`UI/button/index.ts`; P123 (font sizes) touches every primitive string. Sequence them after P122
lands, not concurrently.

## §5 Commit sequence

Each commit leaves every focus state correct. Fast checks per commit (§6.1).

1. `feat(theme): add the shared focus-ring utility and base :focus-visible rule` — `PT/base.css`
   (§3.1). Fixes U1-U3 outright.
2. `refactor(theme): move InputGroup kira and NativeSelect onto focus-ring` — `UI/input-group/index.ts:50`,
   `UI/native-select/index.ts:22` (§3.2). Rendered identical.
3. `refactor(studio): replace hand-rolled filter boxes with InputGroup kira` — H1-H5 (§3.4):
   `ConnectionDialog.vue`, `BrowseView.vue`, `StreamView.vue`, `OperationsPanel.vue`. At this commit
   `InputGroupInput` still carries `ring-0 focus-visible:ring-0`, so the inner input stays ringless.
4. `fix(theme): drop the shadcn ring-3 focus halo from field primitives` — T1, T2, T3 plus
   `InputGroupInput.vue`/`InputGroupTextarea.vue` (§3.3). One commit: `Input` losing `outline-none`
   and `InputGroupInput` gaining it must land together.
5. `fix(theme): drop the shadcn ring-3 focus halo from Button, Toggle, Checkbox` — T4, T5, T6, T7.
6. `chore(lint): guard focus rings against halo widths` — §6.2's lint half.
7. `test(ui): assert the shared focus ring on every primitive shape` — §6.2's UI half.
8. One `test(visual): re-record <spec> baseline for the P122 focus ring` per diffing spec (§6.4),
   each naming the element whose ring changed.
9. `docs: record the one-focus-ring rule` — `docs/ARCHITECTURE.md` Styling row (`:34`), one bold
   sentence in its existing style: `focus-ring` (`PT/base.css`) is the only focus-ring definition;
   the base `:focus-visible` rule applies it to every natively focused element; a component opts
   out only with `outline-none` when an ancestor draws the ring (InputGroup); `kv:` roots keep their
   own 1px `--kv-focus-border` recipe by design.

Resume rule: every commit is self-contained; an interrupted run resumes from the last commit on
`p122-focus-ring-thickness`, re-reading this plan's §5 for the next number.

## §6 Verification

### §6.1 Per commit (fast)

`bun run lint`, `bun run typecheck`, `bun run lint:dead`, `bun run build:test:studio`,
`bun run build:test:space`. After commit 1, also confirm the built CSS carries the rule in the base
layer (not unlayered):

```sh
grep -o '@layer base{[^@]*:focus-visible{outline:1px solid var(--kira-focus)' \
  apps/kira-studio/frontend/dist/assets/*.css    # adjust dist path to build:test:studio's output
```

(Tailwind may inline the `var()`/`calc()`; assert on the selector + layer, then read the rule.)

### §6.2 Guards (new)

Lint — add to `scripts/check-theme-classes.sh` a `check_focus_width` function modelled on
`check_alias` (scans `$SCAN_DIRS` *including* `components/ui`) plus `_gu_ku_hits` for `GU/`/`KU/`,
failing on any match of:

- `(?:focus-visible|focus-within|focus|has-\[[^\s"']*focus-visible\]):ring-(?:[1-9][0-9]*|focus|error)`
- `(?:focus-visible|focus-within|focus|group-focus-within):outline-[2-9]`

Replacement text: `focus-ring (packages/theme/src/base.css)`. Allow exactly one pre-existing hit:
`SwatchRadio.vue`'s `peer-focus-visible:outline-2` does not match (`peer-` prefix is outside the
alternation) — keep it that way deliberately, §3.5. Expected after commit 5: zero hits. Expected at
`8f78d94e`: 17 hits (T1-T7, T3's two `has-` classes); run it there once to prove it bites.

UI — extend `apps/kira-studio/tests/ui/control-sizing.spec.ts` (P117 extended the same file; its
`connectAndOpenGrid` fixture already opens a Postgres data view). One test per shape, each
asserting on the element that draws the ring: `outlineStyle === 'solid'`, `outlineWidth === '1px'`,
`outlineOffset === '-1px'`, `outlineColor === 'rgb(0, 120, 212)'`, `boxShadow === 'none'`:

| Shape | Focus action | Element asserted |
|---|---|---|
| Reference | click `filter-where-input` | its `ancestor::fieldset[@data-slot="input-group"][1]` |
| Stock `Input` (T1) | click `pager-page-input` | the input |
| InputGroup `default` (T3) | click `settings-font-size` (existing locator, `:132-133`) | its fieldset |
| `Button` (T4) | keyboard-focus `toolbar-search` (focus a preceding control, `Tab`) | the button |
| Raw `<button>` (U1) | keyboard-focus `settings-section-<first>` (`SettingsShell.vue:218`) | the button |

The reference row is the "value unchanged" proof: it must pass on `8f78d94e` too. Every other row
must fail on `8f78d94e` (WebKit reports `auto`/`5px` for U1, a `box-shadow` for T1/T3/T4) — confirm
each once before keeping it, P117's own rule. Per CLAUDE.md's testing bar this is a UI guard on a
cross-cutting token, not a unit test; no new unit test.

### §6.3 Phase end (once)

- `bun run test:ui:studio`, `bun run test:ui:space` — full suites.
- H1-H5 at rest: screenshot each box before commit 3 and after (connection dialog engine step,
  browse filter, Kafka stream filter row, operations panel) with the `run` skill or a throwaway
  Playwright script; diff must be empty at rest, and focused must show the §1 ring on the box.
- Grep proofs (expected results after commit 5):

```sh
rg -n 'focus-visible:ring-[1-9]|:focus-visible\]:ring-[1-9]|focus-visible:ring-focus' packages apps --glob '*.{vue,ts}' -g '!**/node_modules/**'   # none
rg -n 'focus-visible:ring-0' apps packages --glob '*.vue' -g '!**/node_modules/**'            # none
rg -n 'focus-ring' packages/theme/src                                                          # base.css (def + @apply), input-group/index.ts x2
rg -n 'focus-within:outline|focus-visible:outline-focus' packages/theme/src                     # none
rg -c 'variant="kira"' apps/kira-studio/frontend/src --glob '*.vue' | grep -E 'ConnectionDialog|BrowseView|StreamView|OperationsPanel'   # 1,1,2,1 more than 8f78d94e
```

- `aria-invalid` untouched: `git diff 8f78d94e -- packages/theme/src/components/ui | grep '^-.*aria-invalid'`
  shows only lines whose `aria-invalid` tokens reappear verbatim on the matching `+` line.

### §6.4 Visual baselines

First run `bun run test:visual:studio` and `bun run test:visual:space` at `8f78d94e`, untouched.
If they pass, this sandbox renders like the baselines and re-recording here is safe (P117 did the
same). If they show the uniform whole-page glyph drift `docs/DEV_ENVIRONMENT.md` §"`tests/visual/*`
pixel diffs" describes, do not re-record from here; report it and leave re-recording to CI.

Then run both after commit 7. Re-record only a spec whose diff is confined to a focus ring, one
commit each, naming the element. Expected:

- Studio `connection-dialog` — likely diffs: the last `page.fill` (`connection-username`, a T1
  `Input`) is still focused at capture.
- Studio `data-view`, `console`, `schema-dialog`, `workbench`, `http-request-view`, `settings` ×8,
  Space `settings` ×4 — expected unchanged (mouse clicks never match `:focus-visible` on buttons;
  the console captures Monaco focus; the HTTP URL field is already the reference). Re-record only
  if one actually diffs, and name the §2 row that caused it.
- A diff anywhere outside a focused element is a regression, not a re-record: fix it.

## §7 Open questions for the user (none block implementation)

- **Q1.** The red `aria-invalid` halo is also 3px (§2.6). Not a focus highlight, so out of this
  row's scope. Thin it to the reference too? If yes, a follow-up phase row, not a P122 addition.
- **Q2.** `SwatchRadio`'s focus ring is 2px white, identical to its checked ring (§3.5). Keep, or
  give it a 1px `--kira-focus` outside ring (needs a second, offset form of the utility)?
- **Q3.** The Kira Space VS Code extension renders git-ui outside Kira's document: no `PT/base.css`
  there. Its raw fields get VS Code's own webview defaults (1px `outline` on `input/select/
  textarea:focus` in VS Code's injected stylesheet — not verifiable in this sandbox), its raw
  buttons the Chromium UA ring. Treated as VS Code-owned chrome, outside "both apps". Extend P122's
  rule into git-ui's own `kv:` root for that host?
