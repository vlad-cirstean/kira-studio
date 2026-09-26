# P123 — Font sizes inconsistent across both apps: plan

Planning only. One Opus pass, verified at `907c8204` (branch tip incl. P120, P122, P125).
Implementer: one sequential Sonnet subagent (§4). Runs concurrently with P121 on the user's explicit
override (§4). Abbreviations: `PT/` = `packages/theme/src/`, `UI/` = `PT/components/ui/`, `SF/` =
`apps/kira-studio/frontend/src/`, `KF/` = `apps/kira-space/frontend/src/`, `WB/` =
`packages/workbench/src/`, `GU/` = `packages/git-ui/src/`, `KU/` = `packages/kira-ui/src/`.

Per-site list: `P123-font-size-sites.md` (this directory), committed with this plan. It is part of
this plan.

## §0 Goal, method, acceptance

SPEC row, verbatim: "font sizes vary by location almost arbitrarily across both apps. Scope is UI
chrome only (labels, buttons, menus, panel headers, status bar, dialogs, tree/list rows) — the
data-view surfaces (SQL results grid, document/JSON viewers, diff/blame views) stay
user-customizable exactly as today, explicitly out of scope."

Method.

- CodeGraph first. Four `codegraph_explore` calls traced the type tokens, the settings path that
  writes `--kira-font-size`, every cva primitive, and the data-view hosts (§7).
- The CodeGraph index is built from the main checkout, so every file:line below was re-checked
  against this worktree.
- A scratch script enumerated every font-size-bearing site in the six roots: `text-<size>` with any
  variant chain (incl. `kv:`), CSS `font-size:`, `<CodiconIcon size>` and `.style.fontSize`. Its
  output is the appendix.
- Each chrome row got a role (§1.2) by rule, then by hand where the rule was wrong. 119 rows carry
  a hand decision; the appendix's Role column names each one.
- No running app was needed. Every size is declared in source. Computed values come from the
  tokens (§1.3) and Tailwind 4's documented stock scale. §6 checks them for real.

Acceptance (SPEC row):

1. A committed inventory of every distinct font-size value found pre-fix (§2, appendix).
2. A stated 3-4-value scale with named purpose per value (§1).
3. Every non-data-view surface in both apps uses only those values, grep-verifiable (§3, §6.2).
4. Data-view surfaces are provably untouched (§2.3, §6.4).

## §1 Scale — four values

### §1.1 The values

| Token (host / `kv:` / `kui`) | px at default | Purpose |
|---|---|---|
| `text-kira-sm` / `kv:text-sm` / `kv:text-kui-sm` | 11 | **Secondary.** Text that annotates other text. |
| `text-kira-md` / `kv:text-base` / `kv:text-kui-base` | 12 | **Default.** Everything the user reads or acts on. |
| `text-kira-lg` / `kv:text-lg` | 13 | **Heading.** Titles that name a dialog or a section. |
| `text-kira-xl` | 20 | **Display.** Start-page hero titles only. |

Rationale.

- **Default equals the data size.** A row, a label and a button all show the same 12px. Today they
  do not: buttons 11, rows 12, stock shadcn menus and dialogs 14, a mobile-width `Input` 16. That
  mix is the user's "almost arbitrary" report. VS Code uses the same model: one base size for body,
  controls and list rows.
- **Secondary is one step down (−1px).** It covers captions, counts, badges, the status bar and
  uppercase panel headers. VS Code puts status bar, badges and descriptions one step below body
  too. One step keeps secondary text readable.
- **Heading is one step up (+1px)**, as in the P16 design system (`t-lg`, `docs/design/kira-design-
  system/parts/_style.css`). Chrome headings are short. Weight (`font-semibold` where it already
  exists) does the rest. Weight is out of scope.
- **Display (20px)** appears three times: the Studio and API start pages. It stays as the fourth,
  "at most one more" value, because a hero title is neither a heading nor body. Dropping it would
  shrink those titles by 7px. That is a visual change the user did not ask for.
- **10px (`xs`) is retired from chrome.** Today it is the second-most-used size (249 chrome sites).
  It overlaps "secondary" in role: captions, counts, badges and hints sit at 10 in one place and 11
  in the next. That split is the largest single source of the inconsistency. At the default size,
  10px is also below comfortable legibility. Merging it into `sm` removes a step instead of
  spending the scale's fourth slot on it.
- **No new tokens.** All four values already exist, backed by `--kira-t-sm/md/lg/xl`. The kv root
  has its own equivalents (`--kv-t-sm/md/lg`). The migration only removes names.

### §1.2 Role rules (which value a surface gets)

| Surface | Value |
|---|---|
| Control text: Button, Toggle, ToggleGroup, Input, Textarea, NativeSelect, InputGroup (incl. `kira` filter box), AutocompleteField input and overlay, link-style buttons, tabs, title-bar items | md |
| Labels (`Label`, `FieldTitle`, field-label spans) | md |
| Menu, command, completion, tree and list rows | md |
| Dialog, popover, tooltip and alert body text | md |
| Full-pane empty/loading/error message | md |
| Description, help, hint, caption, inline validation error | sm |
| Counts, sizes, durations, timestamps, relative dates, paths shown beside a name | sm |
| Badges, chips, pills, keyboard shortcuts | sm |
| Inline empty/loading line inside a menu, list or popover | sm |
| Uppercase panel/section/group headers, table column headers (chrome tables) | sm |
| Status-bar items, toolbar status chips, search counts, pager text | sm |
| `DialogDescription`, `DropdownMenuLabel`, command group heading | sm |
| Dialog title (`DialogTitle`, `KuiDialog` title), settings/dialog section heading (`h2`/`h3`) | lg |
| Start-page hero title | xl |

### §1.3 Derivation (unchanged)

The scale keeps tracking the user's Appearance "Data font size" setting. This is the P26 D6 design
(`docs/v1.2/plans/P26-interface-font-split.md`): chrome and data share one scale.

- `applyAppearance` (`WB/state/createSettingsStore.ts`) writes `--kira-font-size`. The range is
  9–24 (`FONT_SIZE_RANGE`).
- `PT/tokens.css:104-136` derives `--kira-t-sm` (−1), `-md` (0) and `-lg` (+1). `-xl` is a
  literal 20px.
- The kv root derives from `--kv-font-size` (`GU/theme/kira-structure.css:27-30`). In Kira Space
  that is `--vscode-font-size`, which resolves to `var(--kira-graph-font-size, var(--kira-t-md))`
  (`PT/vscode-bridge.css:98`). In the VS Code extension it is VS Code's own font size.

This phase normalizes which step each surface uses. It does not change what a step resolves to.
Decoupling chrome from the Data font size is Q1 (§8).

### §1.4 Not text sizes (outside the scale, untouched)

- **Icons** (320 sites): glyph sizing, not text. `<CodiconIcon size>`, `before:font-[codicon]` with
  `before:text-kira-lg`, `kv:text-codicon`, `kv:text-kui-icon`, codicon `kv:text-[32px]`/`[24px]`,
  and `GU/theme/app-shell.css:57` (the checkbox check glyph, 11px). Normalizing icons is Q2 (§8).
- **Data views** (63 sites, §2.3).

## §2 Inventory (pre-fix, `907c8204`)

### §2.1 Counts

| | Sites | Files |
|---|---|---|
| All font-size-bearing sites | 1033 | 215 |
| Chrome (in scope) | 650 | 189 |
| Data view (untouched) | 63 | 14 |
| Icon (untouched) | 320 | 111 |

Chrome outcome: 380 change, 81 delete (a primitive's base supplies the size), 184 keep, 5 comment
rewrites.

### §2.2 Every distinct value

52 distinct spellings. Chrome uses 21 of them: 8 absolute sizes (10, 11, 12, 12.8, 13, 14, 16,
20px) plus 3 relative ones (`0.5em`, `0.75em`, `inherit`). After P123, chrome uses four sizes
(11, 12, 13, 20px). px values are at the default Data font size (12), with no graph font size set.

Chrome:

| Value | px | Chrome sites | Files |
|---|---|---|---|
| `text-kira-sm` | 11 | 214 | 83 |
| `text-kira-xs` | 10 | 172 | 53 |
| `text-kira-md` | 12 | 76 | 53 |
| `kv:text-xs` | 10 | 74 | 19 |
| `kv:text-sm` | 11 | 38 | 15 |
| `text-sm` (stock; incl. `md:`/`file:`, 1 comment) | 14 | 26 | 24 |
| `text-kira-lg` | 13 | 8 | 7 |
| `text-xs` (stock; incl. `**:[[cmdk-group-heading]]:`) | 12 | 7 | 7 |
| `kv:text-kui-sm` | 11 | 6 | 6 |
| `kv:text-lg` | 13 | 5 | 5 |
| `kv:text-base` | 12 | 4 | 4 |
| `text-base` (stock; 2 comment lines) | 16 | 4 | 3 |
| `text-kira-xl` | 20 | 3 | 2 |
| `kv:text-kui-xs` | 10 | 3 | 2 |
| `font-size: 12px` (`PT/review-decorations.css:50,58`) | 12 | 2 | 1 |
| `text-[0.8rem]` (Button/Toggle `sm`) | 12.8 | 2 | 2 |
| `kv:text-[0.5em]` (`GU/components/FileTree.vue:621,748`) | ~5.5 | 2 | 1 |
| `text-[length:inherit]` (`SF/views/console/ConsoleView.vue:830`) | inherit | 1 | 1 |
| `font-size: var(--kira-font-size)` (`PT/base.css:212`, body) | 12 | 1 | 1 |
| `kv:text-[0.75em]` (`KU/KuiButton.vue:102`) | ~8.3 | 1 | 1 |
| `kv:text-kui-base` | 12 | 1 | 1 |

Stock `text-base` on `Input`/`Textarea` renders 16px below a 768px viewport and 14px at or above
(`md:text-sm`).

Data view (untouched):

| Value | Sites |
|---|---|
| `text-kira-sm` | 20 |
| `text-kira-md` | 17 |
| `text-kira-xs` | 5 |
| `font-size: var(--kira-t-xs)` | 3 |
| `font-size: 13px` | 2 |
| `font-size: 7px` | 2 |
| `font-size: var(--kv-t-md)` | 2 |
| `font-size: var(--kira-t-md)`, `var(--kira-t-sm)`, `var(--kv-t-sm)`, `var(--kv-t-xs)` | 1 each |
| `text-[1.6em]`, `[1.4em]`, `[1.2em]`, `[1.05em]`, `[1em]` | 1 each |
| `kv:text-base` | 1 |
| `style.fontSize='13px'` (`SF/views/grid/SlickGridHost.vue:1060`) | 1 |
| ``style.fontSize=`var(${token})` `` (`GU/theme/readTokens.ts`, token probe) | 1 |

Icon (untouched): `CodiconIcon size` 13 x169, 24 x59, 10 x37, 12 x17, 14 x7, 16 x7, 15 x3, 9 x2,
32 x2, 11 x1, `iconSize` x2. Also `before:text-kira-lg` x3, `kv:text-codicon` x3,
`kv:text-kui-icon` x3, `kv:text-[32px]` x2, `kv:text-[24px]` x1, `kv:text-lg` x1
(`GU/components/CommitMeta.vue:345`, a github codicon) and `font-size: 11px` x1
(`GU/theme/app-shell.css:57`).

### §2.3 Data-view boundary (untouched, byte-identical)

Whole files:

- `SF/views/shared/slick/slickTheme.css`, `SF/views/grid/SlickGridHost.vue`: SQL/result grid.
- `SF/views/console/ConsoleResultGrid.vue`: console result grid.
- `SF/views/shared/document/DocumentTree.vue`, `DocumentRow.vue`: document/JSON viewer.
- `GU/components/CommitGrid.vue`: commit graph (its own graph font size setting).
- `GU/theme/readTokens.ts`: token probe behind the canvas graph.
- `PT/blame-annotation.css`: blame view.

Monaco (editor, diff views) and xterm are sized by options from settings, not classes. P123 edits
no Monaco or xterm option.

Anchors in mixed files. These are result grids and previews rendered in the data font at data size.

| File | Lines | What |
|---|---|---|
| `SF/views/shared/keyvalue/KeyValuePane.vue` | 1027-1110 | key/value result grid: header, gutter, cells |
| `SF/views/stream/StreamView.vue` | 1042-1194 | stream message grid: header, gutter, cells, "(truncated)" |
| `SF/views/documents/DocumentView.vue` | 1057 | document search-hit snippet |
| `SF/workbench/settings/AppearancePane.vue` | 102, 136-170 | data-font and data-row previews |
| `KF/views/repo/RepoFileView.vue` | 303, 360-417 | markdown reading view (`.md-reading`, em headings) |
| `SF/editor/MonacoHost.vue` | 627 | editor fallback `<pre>` |
| `SF/workbench/panels/OperationsPanel.vue` | 406-408 | op-detail Monaco editor |

Chrome inside data areas is in scope. Each of these moves:

- `SF/views/console/ExplainResultView.vue`: plan tree text.
- `SF/views/shared/celleditor/CellEditorView.vue:683,710`: header strips.
- `SF/editor/MonacoHost.vue:672`: hover-widget prose.
- `KF/views/repo/ReviewThread.vue:60`: review thread body.
- `PT/review-decorations.css:50,58`: load-error banner and its retry button.
- `SF/views/grid/FkPreviewPopover.vue`: popover.
- `SF/views/httprequest/ResponseDiffDialog.vue`: its chrome only.

## §3 Fix

The appendix gives the per-site Before/After. This section states the rules and every
non-mechanical change.

### §3.1 Theme roots

- `PT/base.css` `@theme`. Add `--text-*: initial;` directly above `--text-kira-xs` (`:108`). This
  removes Tailwind's stock `text-xs`…`text-9xl` from the host root, as `GU/theme/tailwind.css:39`
  already does for kv.
  - Keep `--text-kira-xs`: the data anchors use `text-kira-xs`.
  - `scripts/check-class-conflicts.ts`'s `themeTokenNames` regex (`--text-([a-z0-9-]+):`) cannot
    match `*`, so the registration self-check is unaffected. Confirm with `bun run lint`.
- `PT/base.css:212`, body: `font-size: var(--kira-font-size)` becomes `var(--kira-t-md)`. Same
  value, now named by the scale.
- `PT/review-decorations.css:50,58`: `12px` becomes `var(--kira-t-md)`. At default that is the
  same 12px. It now follows the setting like all chrome.
- `PT/kui-bridge.css:47` and `GU/theme/kui-bridge.css:44`: delete `--kui-font-size-xs`.
- `KU/theme/tailwind-theme.css:41`: delete `--text-kui-xs`.
- `KU/cn.ts:56`: drop `'kui-xs'`, and reword the `:51` comment (§3.7).
- `GU/theme/tailwind.css:110`: delete `--text-xs`.
  - Keep `--kv-t-xs` (`CommitGrid.vue:1698` uses it) and `--kira-t-xs` (`slickTheme.css`).
- `PT/lib/utils.ts`: keep `'kira-xs'` in the tailwind-merge `text` group. The data anchors still
  merge it.

Order: land §3.1's `--text-*: initial` last (commit 7). Until every stock class is gone, the stock
names must still resolve, or intermediate commits render wrong.

### §3.2 shadcn primitives (`UI/`)

The base carries the size. Size variants carry none, so every size variant renders md.

| File:line | Before | After |
|---|---|---|
| `button/index.ts:7` base | `text-sm` | `text-kira-md` |
| `button/index.ts:44,45,56,58,62` (`xs`, `sm`, `kira`, `kira-lg`, `title-labelled`) | `text-xs` / `text-[0.8rem]` / `text-kira-sm` | delete |
| `toggle/index.ts:7` base | `text-sm` | `text-kira-md` |
| `toggle/index.ts:17,22` (`sm`, `kira`) | `text-[0.8rem]` / `text-kira-sm` | delete |
| `input/index.ts` base string | (none) | add `text-kira-md` |
| `input/index.ts:12` | `file:text-sm` | `file:text-kira-md` |
| `input/index.ts:16,17,18` (`default`, `kira`, `kira-lg`) | `text-base md:text-sm` / `text-kira-sm` | delete |
| `textarea/Textarea.vue:24` | `text-base md:text-sm` | `text-kira-md` |
| `input-group/index.ts:14` addon | `text-sm` | `text-kira-md` |
| `input-group/index.ts:50` `kira` | `text-kira-sm` | `text-kira-md` |
| `input-group/index.ts:60` button | `text-sm` | `text-kira-md` |
| `input-group/InputGroupText.vue:13` | `text-sm` | `text-kira-md` |
| `native-select/index.ts:22` | `text-kira-sm` | `text-kira-md` |
| `field/index.ts:6` root | `text-kira-sm` | `text-kira-md` |
| `field/FieldTitle.vue:14` | `text-sm` | `text-kira-md` |
| `field/FieldSeparator.vue:16` | `text-sm` | `text-kira-sm` |
| `field/FieldLegend.vue:13` | `text-kira-sm` | keep |
| `field/FieldDescription.vue:13`, `FieldError.vue:39` | `text-kira-xs` | `text-kira-sm` |
| `label/Label.vue:19` | `text-sm` | `text-kira-md` |
| `dropdown-menu/DropdownMenuItem.vue:27`, `RadioItem:27`, `CheckboxItem:26`, `SubTrigger:24` | `text-sm` | `text-kira-md` |
| `dropdown-menu/DropdownMenuLabel.vue:19`, `Shortcut:13` | `text-xs` | `text-kira-sm` |
| `dialog/DialogContent.vue:36` | `text-sm` | `text-kira-md` |
| `dialog/DialogDescription.vue:19` | `text-sm` | `text-kira-sm` |
| `dialog/DialogTitle.vue:19` | `text-kira-lg` | keep; reword `:23-27` comment (§3.7) |
| `popover/PopoverContent.vue:37`, `PopoverHeader.vue:13` | `text-sm` | `text-kira-md` |
| `alert/index.ts:10`, `AlertDescription.vue:13` | `text-sm` | `text-kira-md` |
| `empty/EmptyContent.vue:14` | `text-sm` | `text-kira-md` |
| `empty/EmptyTitle.vue:13` | `text-kira-md` | keep |
| `empty/EmptyDescription.vue:14` | `text-kira-xs` | `text-kira-sm` |
| `command/CommandEmpty.vue:24`, `CommandInput.vue:37`, `CommandItem.vue:70` | `text-sm` | `text-kira-md` |
| `command/CommandGroup.vue:37` | `**:[[cmdk-group-heading]]:text-xs` | `**:[[cmdk-group-heading]]:text-kira-sm` |
| `command/CommandShortcut.vue:13` | `text-xs` | `text-kira-sm` |
| `tooltip/TooltipContent.vue:27` | `text-xs` (12px) | `text-kira-md` (12px) |
| `badge/index.ts:12` | `text-kira-xs` | `text-kira-sm` |
| `PT/RunState.vue:41` | `text-kira-xs` | `text-kira-sm` |

Reach. Button: 170 tags, of which 96 `size="kira"`, 80 `kira-lg`, 19 `icon-sm`, 7 `title`, 6
`kira-icon`, 1 `sm` (`ConnectionDialog.vue:801`) and 1 `title-labelled`. Input: 59. Label: 82.
Alert: 121. TooltipContent: 124. Badge: 76. FieldDescription: 41. DialogContent: 18.
DialogTitle: 19. PopoverContent: 15. The unused primitives (FieldTitle, FieldSeparator,
DropdownMenuLabel/RadioItem/CheckboxItem, DialogDescription, InputGroupText, PopoverHeader,
EmptyContent, CommandGroup, CommandShortcut) move anyway, so a later consumer gets the scale.

Visible effect.

- Every control, menu item and dialog body moves 11px or 14px to 12px.
- Stock `text-sm` carried a 20px line height. Kira tokens set none and inherit 1.5 (18px). Rows
  and controls with a fixed height (`h-control` 22px, `h-row`) keep their height. Free-flowing
  menu, dialog and popover text gets 2px tighter per line.

### §3.3 Call sites

The appendix lists every row. The rules, applied in this order:

1. `text-kira-xs` becomes `text-kira-sm`, and `kv:text-xs` becomes `kv:text-sm`. The appendix's
   hand overrides move a few to md: buttons, tabs, `<summary>` toggles, hover-popover bodies.
2. `text-kira-sm` on a `<Label>` is deleted, because the Label base supplies md (68 sites, mostly
   settings panes and `ConnectionDialog.vue`).
3. `text-kira-sm` / `kv:text-sm` on a control, row or body surface becomes `text-kira-md` /
   `kv:text-base`. On a §1.2 secondary surface it stays.
4. A `text-kira-lg` that is not a heading becomes md: `SF/workbench/panels/StudioStart.vue:99`
   (list row) and `SF/project/ConnectionDialog.vue:695`.
5. A heading not at lg becomes lg:
   - `SF/project/FiltersDialog.vue:178,208`: `text-kira-sm` to `text-kira-lg`.
   - `GU/components/dialogs/RepoSettingsDialog.vue:192,206,229,242,254,266,274,291`: `kv:text-sm`
     to `kv:text-lg`.
   - `GU/components/CommitMeta.vue:314`: `kv:text-base` to `kv:text-lg`.
   - `KF/workbench/settings/GitPane.vue:85,172`: bare `<h3>`, which renders at body size after
     preflight. Add `class="text-kira-lg"`.
6. `SF/views/console/ConsoleView.vue:830`: delete `text-[length:inherit]`. Preflight already gives
   `<button>` `font: inherit`.

Chrome sites on the P121 file list (TitleBar, TabStrip, ConnectionDialog tabs, ConsoleView result
tabs): tabs are md (§1.2). See §4 for how that interacts with P121's new `UI/tabs`.

### §3.4 kira-ui (`KU/`)

| File:line | Before | After |
|---|---|---|
| `KuiButton.vue:38`, `KuiSelect.vue:35`, `KuiTextInput.vue:21`, `KuiSearchInput.vue:97`, `KuiSegmented.vue:26`, `KuiTooltip.vue:57` | `kv:text-kui-sm` | `kv:text-kui-base` |
| `KuiMenuList.vue:138` (group header), `:170` (detail), `KuiSegmented.vue:72` (count) | `kv:text-kui-xs` | `kv:text-kui-sm` |
| `KuiButton.vue:102` (count badge) | `kv:text-[0.75em]` | `kv:text-kui-sm` |
| `KuiDialog.vue:83` (title) | `kv:text-lg` | keep |

### §3.5 FileTree dirty dot (`GU/components/FileTree.vue:621,748`)

Today it is an `aria-hidden` "●" glyph at `kv:text-[0.5em]`. It is a shape, not text. Replace the
glyph span with an empty span: `kv:shrink-0 kv:size-1 kv:rounded-full kv:bg-diff-modified`. Drop
`kv:text-diff-modified` and the character. Match the before-screenshot's position and diameter
(~5px). If `kv:size-1` (4px) looks visibly off, use `kv:size-1.25`. Record which one in the commit
body. This removes the only arbitrary text size left in kv chrome, with no guard exception.

### §3.6 Guard hint text (`scripts/check-theme-classes.sh`)

- `:266` `check_class_all 'p-xs' 'text-kira-xs'`: the hint becomes `'text-kira-sm'`.
- `:311` `p-tab` hint: `… text-kira-sm …` becomes `… text-kira-md …`.
- `:229` `p-panel-head` hint keeps `text-kira-sm` (secondary).

### §3.7 Comments

Reword these. The guard (§6.2) skips comment-marker lines, but not continuation lines, and these
name retired or wrong tokens.

- `UI/dialog/DialogTitle.vue:23-27`: drop the `text-base` history. Keep one line: "`text-kira-lg`
  replaces shadcn's `leading-none` base; twMerge drops `leading-none` once a later font-size lands."
- `SF/api/VariableHistoryMenu.vue:52-54`: the inherited size is now `text-kira-md` (12px), so
  `tracking-widest` is 1.2px.
- `SF/views/shared/AutocompleteField.vue:560`: `text-kira-sm` becomes `text-kira-md`.
- `SF/views/httprequest/TimelinePane.vue:174`: `text-kira-xs` becomes `text-kira-sm`.
- `KU/cn.ts:51`: drop `kv:text-kui-xs`.
- `KF/workbench/StatusBar.vue:74` stays: the blame button still inherits the status bar's `sm`.

### §3.8 Not touched

- Every §2.3 data-view file and anchor.
- Every §1.4 icon site.
- Font weight, family, letter-spacing, line-height utilities (`leading-*`) and control heights.
- `--kira-t-xs`, `--kv-t-xs`, `--text-kira-xs` and `'kira-xs'` in `PT/lib/utils.ts`. Data views
  still use them.
- The Appearance settings UI and `applyAppearance`.

## §4 Split call, overlap, implementer

No stream split. Commit 1 (primitives) sets the base that commits 2-6 delete call-site sizes
against, and commit 7 needs every stock class gone. That is one dependency chain. One sequential
Sonnet implementer on branch `p123-font-size-normalization`, off the chapter branch tip.

P121 runs concurrently (user override). P121's plan is `docs/v1.9/plans/P121-tab-strip-sizing.md`.
File overlap with this plan:

- `UI/button/index.ts`, `UI/toggle/index.ts`, `UI/toggle-group/*`: P121 adds a `kira-lg` toggle size
  (`text-kira-sm`). P123 removes size-variant text.
- `WB/components/TabStrip.vue`, `SF/workbench/TitleBar.vue`, `SF/project/ConnectionDialog.vue`,
  `SF/views/console/ConsoleView.vue`: P121 moves their tab chips onto a new `UI/tabs`
  `tabChipVariants` (`text-kira-sm`, plus an `xs` chip for console result tabs). P123 moves tab
  text to md.
- `KF/repo/GitPanel.vue:335`: P121 edits the panel header. P123 keeps it sm and moves `:471` to md.
- `KU/KuiSegmented.vue`, `PT/tokens.css`, `PT/kui-bridge.css`, `KF/views/repo/RepoFileView.vue`,
  `SF/views/shared/keyvalue/KeyValuePane.vue`, `SF/views/stream/StreamView.vue`,
  `SF/views/documents/DocumentView.vue`, `SF/views/httprequest/*`, `SF/views/grpcrequest/*`,
  `SF/workbench/panels/OperationsPanel.vue`: different lines. A rebase should apply.

Landing rule for the orchestrating session. Whichever phase lands second rebases. On any conflict,
keep P121's structure and apply §1.2 to the resulting class string. The results:

- Tab chips are `text-kira-md` in `tabChipVariants` and every size of it.
- The P121 `kira-lg` toggle size carries no text size.
- No `text-kira-xs` or stock size survives in `UI/tabs`.

After the rebase, `sh scripts/check-theme-classes.sh` (§6.2) must pass. It flags any P121 string
that still carries `xs` or a stock size. Also check that
`rg -n 'text-kira-(xs|sm)' packages/theme/src/components/ui/tabs` prints nothing. Never hand-pick a
side on a PNG conflict; re-run §6.5.

## §5 Commit sequence

Each commit leaves the tree building and rendering correctly. Run the fast checks (§6.1) per
commit.

1. `refactor(theme): put shadcn primitives on the four-size type scale` — every §3.2 row, `UI/` and
   `PT/RunState.vue`.
2. `refactor(ui): drop redundant text size from Label call sites` — appendix rows `delete` with Role
   "Label base supplies md" (SF, KF, WB).
3. `refactor(studio): move Studio chrome onto the four-size type scale` — remaining `SF/` appendix
   rows, §3.3 items 4-6.
4. `refactor(space): move Kira Space chrome onto the four-size type scale` — `KF/` rows, GitPane
   headings, ReviewThread.
5. `refactor(workbench): move shared workbench chrome onto the four-size type scale` — `WB/` rows.
6. `refactor(git-ui): move git-ui and kira-ui chrome onto the four-size type scale` — `GU/`, `KU/`
   rows, §3.4, §3.5.
7. `refactor(theme): retire stock and xs text sizes from chrome tokens` — all of §3.1:
   `--text-*: initial`, body, review-decorations, the kui/kv xs deletions, `cn.ts`.
8. `refactor: reword comments naming retired text sizes` — §3.7.
9. `chore(lint): guard chrome font sizes to the four-size scale` — §6.2 guard plus §3.6 hints.
10. `test(ui): assert the chrome type scale and the data font` — §6.3.
11. One `test(visual): re-record <spec> baseline for P123 type scale` per diffing spec (§6.5).
12. `docs: record the four-size chrome type scale` — `docs/ARCHITECTURE.md` Styling row (`:34`).
    Append one bold sentence in its existing style: chrome uses exactly `text-kira-sm/md/lg/xl`
    (kv `text-sm/base/lg`, kui `text-kui-sm/base`) with the §1.2 roles; stock sizes and `xs` are
    reset or guarded; data views keep their own sizes.

Resume rule: every commit is self-contained. An interrupted run resumes from the last commit on
`p123-font-size-normalization`. Re-read §5 for the next number and the appendix for the next row;
already-applied rows show their After value in source.

## §6 Verification

### §6.1 Per commit (fast)

`bun run lint`, `bun run typecheck`, `bun run lint:dead`, `bun run build:test:studio`,
`bun run build:test:space`.

### §6.2 Guard (new, commit 9)

Add `check_font_scale` to `scripts/check-theme-classes.sh`, before the final `STATUS` block.

- Host pass: shaped like `check_focus_width`, over `$SCAN_DIRS` *including* `components/ui`.
- kv pass: `_gu_ku_hits`'s file set (`GU/`, `KU/`, `.vue` + `.ts`, `KU/cn.ts` excluded).
- Both passes skip comment-marker lines, as `_gu_ku_hits` already does:
  `^[^:]+:[0-9]+:\s*(\*|//|/\*|<!--)`.

Patterns, tested against `907c8204`:

```sh
HOST_CLASS='(?<![-\w])text-(?:xs|sm|base|lg|[2-9]?xl|kira-xs|\[(?!#|rgb|hsl|color:|var\()[^\]\s]+\]|\(length:[^)\s]+\))(?![-\w])'
HOST_CSS='(?<![-\w])font-size\s*:(?!\s*var\(--kira-t-(?:sm|md|lg|xl)\)\s*[;}])'   # .vue + .css
KV_CLASS='(?<![-\w])kv:text-(?:xs|kui-xs|\[(?!#|rgb|hsl|color:|var\()[^\]\s]+\])(?![-\w])'
KV_CSS='(?<![-\w])font-size\s*:(?!\s*var\(--kv-t-(?:sm|md|lg)\)\s*[;}])'          # .vue + .css
```

Exemptions. These are the complete list, and each is named in a comment in the script.

- Whole files: `SF/views/shared/slick/slickTheme.css` (HOST_CSS) and `GU/components/CommitGrid.vue`
  (KV_CSS). Both are data views.
- KV_CLASS hits on a line that also contains `codicon` (icon glyphs, §1.4).
- Counted anchors, as (file, token, expected count). While the count matches, the hits are
  suppressed. On a mismatch, report every hit of that token in that file.
  - `KeyValuePane.vue` `text-kira-xs` 1.
  - `StreamView.vue` `text-kira-xs` 2.
  - `settings/AppearancePane.vue` `text-kira-xs` 2.
  - `RepoFileView.vue` `text-[<n>em]` 5.
  - `GU/theme/app-shell.css` KV_CSS 1.

Replacement text: `text-kira-sm/md/lg/xl (kv: text-sm/base/lg) per docs/v1.9/plans/P123-font-size-normalization.md §1.2`.

Expected hit counts:

| Tree | HOST_CLASS | HOST_CSS | KV_CLASS | KV_CSS |
|---|---|---|---|---|
| `907c8204`, before exemptions | 223 | 10 | 80 (+3 codicon) | 2 |
| After commit 9, reported | 0 | 0 | 0 | 0 |

At `907c8204`, HOST_CSS hits are slickTheme ×7, `base.css:212` and `review-decorations.css:50,58`.
KV_CSS hits are `CommitGrid.vue:1698` and `app-shell.css:57`.

Prove it bites: run the new function once against a `907c8204` checkout. Expect a non-zero exit
listing the §5 commit 1-8 sites.

### §6.3 UI assertion (commit 10)

Extend `apps/kira-studio/tests/ui/control-sizing.spec.ts`. It already opens a Postgres data view
and the settings dialog. This is a UI guard on a cross-cutting token, like P122's. It adds no unit
test.

Test 1. Read `--kira-t-sm/md/lg` from `:root`, then assert computed `fontSize`:

| Element | Expected |
|---|---|
| `size="kira"` Button: FilterToolbar "Clear" (`SF/views/grid/FilterToolbar.vue:188`, by role and name) | md |
| Workbench tab (`[data-testid="tab"]`, `WB/components/TabStrip.vue`) | md |
| Settings `Label` (the label for `settings-font-size`) | md |
| Status-bar item (`[data-testid="engine-status"]`) | sm |
| Settings `DialogTitle` (`WB/components/SettingsShell.vue:202`) | lg |

Test 2, data stays customizable. Set Data font size to 16 through `settings-font-size`. Assert:

- A grid `.slick-cell` renders 16px.
- The grid header (`.slick-header-column`, `slickTheme.css:147` `var(--kira-t-sm)`) renders 15px.

Rows that change must fail at `907c8204` (Button 11px, tab 11px, Label 11px); confirm once before
keeping them. The status and title rows plus the whole of Test 2 must pass at both commits: that is
the "unchanged" proof.

Kira Space: `apps/kira-space-vscode/tests/interaction/file-tree-open.spec.ts:182-195` already
asserts status letter < row. After P123 the status letter is `kv:text-sm` and the row inherits
`kv:text-base`, so it still holds. Run it.

### §6.4 Data views provably untouched (phase end)

Whole files must diff empty:

```sh
git diff 907c8204 -- \
  apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css \
  apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue \
  apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue \
  apps/kira-studio/frontend/src/views/shared/document/DocumentTree.vue \
  apps/kira-studio/frontend/src/views/shared/document/DocumentRow.vue \
  packages/git-ui/src/components/CommitGrid.vue \
  packages/git-ui/src/theme/readTokens.ts \
  packages/theme/src/blame-annotation.css      # empty
```

Anchored blocks must be byte-identical. Line numbers can shift, so compare by content:

```sh
python3 - <<'EOF'
import subprocess
A = [("apps/kira-studio/frontend/src/views/shared/keyvalue/KeyValuePane.vue", 1027, 1110),
     ("apps/kira-studio/frontend/src/views/stream/StreamView.vue", 1042, 1194),
     ("apps/kira-studio/frontend/src/views/documents/DocumentView.vue", 1057, 1057),
     ("apps/kira-studio/frontend/src/workbench/settings/AppearancePane.vue", 102, 102),
     ("apps/kira-studio/frontend/src/workbench/settings/AppearancePane.vue", 136, 170),
     ("apps/kira-space/frontend/src/views/repo/RepoFileView.vue", 303, 303),
     ("apps/kira-space/frontend/src/views/repo/RepoFileView.vue", 360, 417),
     ("apps/kira-studio/frontend/src/editor/MonacoHost.vue", 627, 627),
     ("apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue", 406, 408)]
for f, a, b in A:
    old = "\n".join(subprocess.check_output(["git", "show", f"907c8204:{f}"], text=True).split("\n")[a-1:b])
    print("OK     " if old in open(f).read() else "CHANGED", f, a, b)
EOF
# every line OK
```

If P121 legitimately edits a line inside an anchor, that line is P121's change, not P123's. Check
with `git log -L`.

Token chain unchanged: `git diff 907c8204 -- packages/theme/src/tokens.css
packages/git-ui/src/theme/kira-structure.css packages/theme/src/vscode-bridge.css
packages/workbench/src/state/createSettingsStore.ts` shows no `--kira-t-*`, `--kv-t-*`,
`--kira-font-size` or `--vscode-font-size` line. (P121 may touch other `tokens.css` lines.)

Runtime probe. Build both apps at `907c8204` and at the phase tip. Run a throwaway Playwright
script (scratchpad, not committed). It records computed `fontSize`, `lineHeight` and `fontFamily`
for:

- Studio: SQL grid `.slick-cell` and `.slick-header-column`, a document tree row, a console result
  grid cell, a key/value grid cell, a stream grid cell. Run once at Data font size 12 and once at 16.
- Space: a commit graph `.slick-cell`. Run with no graph font size set and with it set to 15.

Every pair must be identical.

### §6.5 Phase end (once)

- `bun run test:ui:studio`, `bun run test:ui:space`: full suites.
- Grep proofs, each expected after commit 9:

```sh
sh scripts/check-theme-classes.sh                                             # passes
rg -n '(?<![-\w])text-(xs|sm|base|lg|[2-9]?xl)(?![-\w])' -P apps/kira-studio/frontend/src apps/kira-space/frontend/src packages/theme/src packages/workbench/src -g '!**/node_modules/**' | rg -v '^\S+:\d+:\s*(\*|//|/\*|<!--)'   # none
rg -c 'text-kira-xs' apps packages -g '*.{vue,ts,css}' -g '!**/node_modules/**' -g '!**/tests/**'   # KeyValuePane 1, StreamView 2, settings/AppearancePane 2, PT/base.css 1 (the @theme entry)
rg -n 'kv:text-xs|kv:text-kui-xs|--text-kui-xs|--kui-font-size-xs' packages -g '!**/node_modules/**'   # none
rg -n -- '--text-\*: initial' packages/theme/src/base.css packages/git-ui/src/theme/tailwind.css   # one each
```

- Visual baselines, in P122 §6.4's order. First run `bun run test:visual:studio` and
  `bun run test:visual:space` at `907c8204`, untouched.
  - If they pass, re-recording here is safe.
  - If they show `docs/DEV_ENVIRONMENT.md`'s uniform glyph drift, do not re-record. Report it and
    leave re-recording to CI.
- Then run both at the phase tip. Every Studio spec (`connection-dialog`, `console`, `data-view`,
  `http-request-view`, `schema-dialog`, `settings`, `workbench`) and Space `settings` will diff.
  Chrome text changes size everywhere.
- Re-record per spec, one commit each. Before each re-record, open the diff image. A grid cell,
  document row or graph row that moved is a regression, not a re-record. Fix it.

## §7 CodeGraph discovery record

Four real `codegraph_explore` calls, all before any file read of the areas they covered.

1. "typography font-size tokens --kira-font-size text-kira-sm text-kira-xs theme tokens.css
   base.css @theme". Returned `PT/tokens.css` type tokens, `PT/base.css` `@theme` text entries,
   and the kui/vscode bridges.
2. "applyAppearance createSettingsStore --kira-font-size FONT_SIZE_RANGE AppearanceSettings
   fontSize". Returned the one writer of `--kira-font-size` and the 9–24 range. This confirmed that
   chrome and data share one runtime source (§1.3).
3. "buttonVariants inputVariants toggleVariants inputGroupVariants nativeSelectVariants
   badgeVariants fieldVariants alertVariants". Returned every cva primitive's size strings (§3.2).
4. "readTokens graph font size --kira-graph-font-size CommitGrid SlickGridHost fontSize data view
   font". Returned the CommitGrid, TokenReader, RepoGraphView and FontSizeField blast radius. This
   confirmed the graph font size reaches every git-ui surface, not only the grid (§1.3, Q3).

## §8 Open questions for the user (none block implementation)

- **Q1.** Chrome and data share one scale that tracks "Data font size" (P26 D6). Raising it to 16
  makes buttons 16 too. Decouple chrome onto a fixed or separate "Interface font size"? If yes,
  that is a follow-up phase row, not a P123 addition.
- **Q2.** Icon sizes also vary: `CodiconIcon` 9–32px across 11 values (§2.2). Out of this row's
  scope (glyphs, not text). Normalize them in a follow-up?
- **Q3.** In Kira Space, "Git graph font size" (`git.graphFontSize`) resizes every embedded git-ui
  surface, not only the graph (`PT/vscode-bridge.css:98`, P92 item 9). So git-ui chrome can sit on
  a different base than host chrome. Scope that setting to the commit grid only?
- **Q4.** The key/value and stream message grids are treated as data views (§2.3), like the SQL
  grid. Confirm.
