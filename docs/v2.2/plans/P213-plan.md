# P213 plan: Tailwind audit

Base commit `363cb6622` (branch `v2.1-stream-C`, worktree `/home/user/kira-v21-C`). Stream C, run
alongside P210 (stream A) and P212 (stream B) at the user's request.

## 1. Ask

User, verbatim intent: audit every frontend (`apps/kira-studio/frontend`, `apps/kira-space/frontend`,
`packages/*` UI: theme, workbench, git-ui, kira-ui, docker-ui; plus the VS Code webview root under
`apps/kira-space-vscode/src/webview`). Wherever hand-written CSS (scoped `<style>`, `.css` files,
inline `style`/`:style`) could be Tailwind utilities, use Tailwind. Partial matches count: snap to
the nearest scale step or repo token and accept small visual drift for consistency. Keep CSS that
Tailwind genuinely cannot express, and name why per kept block.

## 2. Discovery (how this plan was built)

`codegraph_explore` over the style-bearing components and the colour helpers (`connColorVar`,
`typeClassColor`, `fileIconStyle`, `CATEGORY_COLOR`), plus counting greps over the five trees.
Read: `packages/theme/src/tailwind-core.css`, `base.css`, `shadcn-bridge.css`, `tokens.css` header,
`packages/git-ui/src/theme/tailwind.css`, `apps/kira-space-vscode/src/webview/tailwind.css`,
`scripts/check-tokens.sh`, `check-theme-classes.sh` (incl. `check_font_scale`, `check_focus_width`),
`check-ade-colours.sh`, `check-class-conflicts.ts`, `packages/theme/src/lib/utils.ts`, `biome.json`
(no Tailwind class-sort rule; `css.parser.tailwindDirectives: true`), `docs/ARCHITECTURE.md`
Styling row (P110 escape-hatch ladder), `docs/v2.0/plans/P138-ade-theme-tokens.md`,
`docs/DEV_ENVIRONMENT.md` visual-baseline section.

P110 (v1.9) already did the bulk migration. This phase is the residue audit.

### 2.1 Inventory at base

| Kind | Count | Notes |
|---|---|---|
| Real `<style>` blocks | 5 | `MonacoHost.vue` (6 rules), Studio `panels/OperationsPanel.vue` (3), `ResponseDiffDialog.vue` (1), Space `RepoFileView.vue` (15), git-ui `CommitGrid.vue` (unscoped, ~57 rules). Grep also hits `SlickGridHost.vue`, `HttpRequestView.vue`, `GrpcRequestView.vue`, `CommitMeta.vue`: comment mentions only. |
| `.css` files | 20 (2,494 lines) | Largest: `views/shared/slick/slickTheme.css` 825 lines / 75 rules. Rest: token/bridge files, Monaco decoration files, `primitives.css` residue, roots. |
| `:style` bindings | 253 | Classified in §2.2. |
| Static `style="…"` | 2 | `GrpcRequestView.vue:348` (comment), `proto/grid/TooltipProxy.vue:51` (proto). |
| Imperative `el.style.x = '…'` (static value) | 14 | of 37 total `el.style`/`setProperty` writes; rest runtime. |

### 2.2 `:style` classification (253)

| Class | Count | Action |
|---|---|---|
| A. Runtime geometry (virtual-row `translateY`/height, resize widths, depth padding, x/y, `%`, `gridTemplateColumns`, floating position) | 80 | Keep binding. Move static keys inside the object to classes (§4 C2). |
| B. Custom-property channel (`--kira-rail`, `--kv-tree-indent`) feeding `bg-(--kira-rail)` etc. | 32 | Keep: Tailwind-idiomatic runtime-value channel, one var feeds several descendant utilities. |
| C. Connection colour painted directly (`connColorVar(...)`, `var(--kira-conn-${…})`, `iconColor`) | 14 | Convert to literal class maps (C1). |
| D. Type-category colour (`columnTypeColor`/`typeClassColor`/`dataTypeColor`) | 5 | Convert to literal class map (C1). |
| E. ADE tone colours (`TONE`, `tagStyle`, `solidStyle`, `actionStyle`, `TONE_INK`, tone-derived computeds) | 90 lines, 30 files | Convert to `@theme` tone tokens plus class maps (C3-C5, Deferred D1). ~8 lines mix in data colour (`card.color`, `repoColor`) and keep that part. |
| F. Data-driven values (font-stack preview, repo/task/work palette colour, seti file-icon mask, ANSI log colours, `metaColor` data channel, `CodiconIcon` size, registry `ToggleGroup` `--gap`, SettingsShell width/height) | 28 | Keep. Values come from user data or props at runtime; a literal class cannot exist for them. |
| G. `apps/kira-studio/frontend/proto/**` | 3 | Out of scope (Deferred D4). |
| X. Comment false positive | 1 | none |

Expected after phase: ~145-150 `:style` bindings, every one class A/B/F/G. Implementer records the
real count in the result section.

## 3. Ownership and exclusions

One sequential Sonnet implementer. No split: C1 and C3 both touch `check-*` scripts and shared
`packages/theme` files; areas are small enough that a second worktree costs more than it saves; the
2-stream cap is already exceeded by user override.

### 3.1 Excluded (owned by P210/P211/P212, or out of scope). Never edit.

- `packages/workbench/src/memory/**` (MemoryPanel, MemoryStart, AddMemoryDialog,
  ConnectClaudeDialog, module/queries/store). P210/P211.
- `apps/kira-space/frontend/src/workbench/memoryModule.ts`, `apps/kira-space/frontend/src/App.vue`
  (provides the memory module). P210/P211.
- Any file whose path or name contains `memory`/`Memory` in any frontend tree, and any new memory UI
  file that appears on rebase. P210/P211.
- Any new mobile agents app file (whatever P212 creates: a new app dir, mobile entry, PWA manifest,
  service worker, device-approval dialog) and the Space web server Go code. P212.
- `apps/kira-space/frontend/vite.config.ts`, `apps/kira-space/frontend/index.html` (P212 may add an
  entry). P213 has no reason to touch them.
- Go code anywhere. Not a CSS concern.
- `apps/kira-studio/frontend/proto/**` (D4).
- `packages/theme/src/components/ui/**` (shadcn registry files stay registry-verbatim past the
  P110 alias renames; `ToggleGroup.vue`'s `--gap` binding is registry code).
- Generated blocks: `packages/git-ui/src/theme/vscode-tokens.css` lane rules
  (`scripts/gen-lane-palette.ts`, "do not hand-edit").
- Every `*-snapshots/**` baseline directory (§6.3).

### 3.2 Owned by P213

Files listed per commit in §4. Shared, conflict-prone files P213 touches minimally:
`apps/kira-space/frontend/src/styles.css` (one `@import` line), `scripts/check-ade-colours.sh`
(one `--include`), `docs/ARCHITECTURE.md` (Styling row, one sentence), `docs/v2.2/SPEC.md` (P213
result section, last commit). A rebase conflict on any of these is a textual merge, not an
ownership error.

## 4. Commits, in order

Each commit passes the pre-commit hook (`bun run lint`, `bun run typecheck`) without `--no-verify`.
Each lists its files; nothing outside §3.2 plus that list.

### C1 `refactor(ui): class maps for connection and type colours`

19 bindings, plus TimelinePane's legend colour.

- `packages/theme/src/connColor.ts`: add `connBgClass(color)`, `connTextClass(color)` (and
  `connBorderClass` only if a site needs it) backed by `Record<PaletteColor, string>` maps with one
  literal per entry (`'bg-conn-red'`, …). `'none'`/`null`/`undefined` return `undefined`. Palette
  list from `packages/shared/domain/color.ts` (`paletteColorSchema`, the storable set, not the
  offered subset). Keep `connColorVar`: B-class sites and `--kira-rail` still use it.
- Sites: `StudioStart.vue:116,118`, Studio `panels/OperationsPanel.vue:163`,
  `KeyValuePane.vue:726`, `DataView.vue:202`, `StreamView.vue:700`, `DocumentView.vue:737`
  (`iconColor` computeds become class computeds; fallback `var(--kira-fg-muted)`/`var(--kira-info)`
  becomes `text-muted-foreground`/`text-info`), `DataGripImportDialog.vue:197`,
  `ConnectionDialog.vue:630,690`, `packages/workbench/src/components/ContextMenu.vue:82,122`,
  `packages/workbench/src/terminal/TerminalPanel.vue:224`, `packages/theme/src/SwatchRadio.vue:37`.
- `apps/kira-studio/frontend/src/theme/icons.ts`: add `CATEGORY_TEXT_CLASS` beside
  `CATEGORY_COLOR` (`text-syntax-number`, `text-syntax-keyword`,
  `text-(--kira-syntax-control)` — no `--color-syntax-control` token exists, single site family,
  rung 4 —, `text-fg`), plus `columnTypeTextClass`/`typeClassTextClass`. Keep `CATEGORY_COLOR`:
  `columns.ts:395` passes it as `metaColor` data into `AttributeTooltip` (class F).
  Sites: `ColumnsSection.vue:79,88`, `CellEditorView.vue:532,536` (`:class` on `Badge` merges
  through its `cn`), `FkPreviewPopover.vue:171` (static `text-muted-foreground` sits beside it:
  make both conditional or drop the static one, see rule R7).
- `TimelinePane.vue`: `PHASES[].colorVar` becomes `bgClass` literal (`bg-conn-violet`, …);
  `:220` drops `:style`; `:257` keeps only `width`.
- Use `codegraph_explore` on `connColorVar` first: 24 callers; confirm none outside this list paints
  `background`/`color` directly.

### C2 `refactor(ui): static style keys to utilities`

- `position: 'relative'` in 10 objects becomes `class="relative"`; the binding keeps the runtime
  height: `BrowseView.vue:449`, `StreamView.vue:1218`, `DocumentView.vue:1092`,
  `ConsoleResultGrid.vue:369,416`, `CollectionsTree.vue:214`, `ProjectTree.vue:267`,
  `RepoFileTree.vue:117`, `RepoSearchView.vue:168`, `OpLogPanel.vue:217`.
- `SettingsShell.vue:192`: `maxHeight: '80vh'` becomes conditional class `max-h-[80vh]` (rung 4,
  viewport value); width/height stay.
- `packages/docker-ui/src/components/ListState.vue:19`: opacity `1 - n*0.14` becomes a literal
  5-entry array `['opacity-86','opacity-72','opacity-58','opacity-44','opacity-30']`; binding gone.
- `packages/workbench/src/terminal/terminalRenderer.ts:82-83`: `host.style.height/width = '100%'`
  becomes `host.classList.add('h-full', 'w-full')` (file under `packages/workbench/src`, scanned
  by `workbench.css`'s `@source "./"`).
- Kept static imperative writes, reason each: `rowSvg.ts:338,364,377` (`fill='none'` inline must
  beat `.kv-lane-N { fill }`; inline wins by design), `readTokens.ts:66-69` (token probe must not
  depend on the utility sheet having loaded), `AutocompleteField.vue:431-438` (pointer-events
  toggled per interaction state), `SlickGridHost.vue:1080` (codicon glyph size, data-view fixed size,
  `check_font_scale` would reject `text-[13px]`).

### C3 `feat(ade): tone theme tokens and class maps` (Deferred D1)

- New `apps/kira-space/frontend/src/ade/v2/tones.css`: one `@theme` block. Per tone
  (`amber, red, green, blue, purple, grey`): `--color-tone-<t>-tint` (TONE[0]),
  `--color-tone-<t>` (TONE[1], text), `--color-tone-<t>-solid` (TONE[2]); plus
  `--color-tone-ink: #15161a`, `--color-tone-ink-light: #ffffff`, `--color-claude: #d97757`.
  Values copied byte-for-byte from `tones.ts`. File lives under `ade/` so the literals stay inside
  the guard's scan root.
- `apps/kira-space/frontend/src/styles.css`: `@import "./ade/v2/tones.css";` after the existing
  `@import`, before `@source`. Space root only; Studio and the webview never load ADE.
- `scripts/check-ade-colours.sh`: add `--include='*.css'` to the grep. Allowlist unchanged (same
  values, now in `tones.css`). If a value leaves `tones.ts` and still appears in `tones.css`, the
  allowlist stays valid (hits are deduplicated by value).
- `tones.ts`: add literal class maps: `TONE_TEXT_CLASS`, `TONE_TAG_CLASS` (`bg-tone-<t>-tint
  text-tone-<t>`), `TONE_SOLID_CLASS` (`bg-tone-<t>-solid text-tone-ink` / purple `text-tone-ink-light`),
  `ACTION_CLASS` (tones plus `claude: 'bg-claude text-tone-ink'`), `TONE_BORDER_CLASS` as sites need.
  Every entry spelled in full.
- Convert first batch (all ADE files outside `plan/` and `panel/`): `AdeChip.vue`, `AdeRepoTag.vue`,
  `AdeActivityIcon.vue` (green halo: `shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-tone-green-solid)_28%,transparent)]`,
  rung 4, single site), `shell/AdeShell.vue`, `run/AdeRunDialog.vue` (SVG `stroke` becomes
  `stroke-claude`), `run/AdeTaskActionButton.vue`, `sessions/*` (3), `backlog/*` (2),
  `needs/*` (4: `AdeNeedsRow`, `AdeAllSessionRow`, `AdeNeedsPage`; `AdeAllSessions:88` stays, data),
  `workflows/*` (2), `dialog/AdeClaudeDialog.vue`. ~30 bindings.
- `ade-v2-plan.spec.ts:193` asserts `rgb(240, 184, 92)` computed colour: unchanged value, must
  still pass.

### C4 `refactor(ade): plan views onto tone utilities`

`plan/AdeDayBand.vue` (12; `:131` focus tint becomes `bg-focus/10`; `:110` keeps only the
data-driven part), `AdeBranchRow.vue` (10; `:125` depth width stays), `AdeTaskCard.vue` (5;
`:120` `card.color` stays), `AdeRepoChip.vue`, `AdeActionCell.vue`, `AdePlanHeader.vue`,
`AdeAttention.vue` (3px tint halo: `shadow-[0_0_0_3px_var(--color-tone-amber-tint)]`, never `ring-3`,
see R9). ~35 bindings. Tone-derived computeds (`rowBg`, `rulerBorder`, `labelColor`, `subColor`,
`elbowColor`, `progColor`, `segColor`, `boxStyle`, `headStyle`, `labelStyle`, `nameStyle`) become
class computeds returning literals.

### C5 `refactor(ade): panel views onto tone utilities; drop style helpers`

`panel/AdeStageBlock.vue` (13; `GLYPH_BOX` becomes a class map; `1.5px solid` ring snaps to
`border` 1px, D5), `AdeChangesTab.vue` (5 plus `:104`), `AdeBranchPanel.vue` (5; `:202` keeps
`card.color` branch as style, review branch as class), `AdeTaskTab.vue:224` (`:220` repo palette
stays), `AdeTaskPanel.vue:130` (`:110` stays), `AdeSetupProgress.vue`, `AdeRunLog.vue:36`
(default `'240px'` becomes class `max-h-60` when prop unset; explicit prop stays style).
Then delete `tagStyle`/`solidStyle`/`actionStyle`/`TONE_INK` and any `TONE` entry with no
remaining TS consumer (`grep -rn` over `apps/kira-space/frontend/src`; knip runs pre-push). Keep
`TONE` itself if any TS consumer remains (e.g. a value handed to a non-DOM API).

### C6 `refactor(git-ui): commit grid cell and badge CSS to utilities`

`CommitGrid.vue`'s unscoped block styles two kinds of DOM. App-built DOM (formatters, badges, SVG)
moves to class strings at the `className`/`classList` site. SlickGrid-owned DOM stays (C7).

- Move to `kv:` utilities at the creation site: `.kv-graph-cell` (`graph/graphColumn.ts`),
  `.kv-graph-svg` (`graph/rowSvg.ts`; `clip-path: inset(-2px 0)` becomes
  `kv:[clip-path:inset(-2px_0)]`, rung 4), `.kv-graph-head-ring`/`-halo` (`kv:stroke-…`,
  `kv:fill-…/18`) if the kv root has a colour token for `--kv-focus-border`, else
  `kv:stroke-(--kv-focus-border)`, `.kv-cell-message` and its `--has-badges`/`--collapsed`
  variants, `.kv-message-badges-row`, `.kv-message-subject` (italic/muted set in the formatter
  branch that already knows collapsed/stash state; keep the descendant rule only if the stash flag
  is unknown at format time), `.kv-cell-author`, `.kv-search-hit` (`searchHighlight.ts`),
  `.kv-cell-date` (`dateFormat.ts`, `columns.ts`).
- Badges (`refBadges.ts`, `badgeClass.ts`): follow `badgeClass.ts`'s existing convention exactly
  (unprefixed utilities with `--kv-*` arbitrary values, merged by theme `cn`; compiled by the Space
  root and the webview root, which both `@source` git-ui). Kind border colours, dashed,
  stacked/stale, current ring (`shadow-[0_0_0_1px_var(--kv-focus-border)]`), lane tint
  (`border-(--kv-graph-lane-N)`, 8 literals in a map), label truncation (`max-w-[190px]`, rung 4,
  spec'd value), `.kv-ref-badges` strip. Order inside `refBadgeClass(...)`: base, kind, lane, so
  `cn` reproduces the old specificity win of lane over kind.
- PR badge (`.kv-badge-pr`, `--open/draft/merged/closed`, `button.kv-badge-pr` cursor): add
  `PR_BADGE_CLASS` map in `badgeClass.ts`, use it in `refBadges.ts`, `CommitMeta.vue:426`,
  `BranchPicker.vue`, `StackList.vue`.
- Stay in the block, reason: `.kv-badge`, `.kv-badge-icon`, `.kv-badge-current-glyph`,
  `.kv-collapsed-chevron` font sizes (R5: `CommitGrid.vue` is `check_font_scale`'s exempt zone;
  the same size as a class trips the kv guard).
- Marker names stay on the elements (R6): `kv-cell-message`, `kv-message-subject`, `kv-cell-date`,
  `kv-cell-graph`, `kv-graph-svg`, `kv-badge`, `kv-badge-icon`, `kv-badge-pr`, `kv-row-*`,
  `kv-search-hit` (each has a test or TS selector reader; re-grep before dropping any other name).
- Files: `CommitGrid.vue`, `columns.ts`, `refBadges.ts`, `badgeClass.ts`, `graph/rowSvg.ts`,
  `graph/graphColumn.ts`, `searchHighlight.ts`, `dateFormat.ts`, `CommitMeta.vue`,
  `BranchPicker.vue`, `StackList.vue`. ~30 rules leave the block.

### C7 `refactor(git-ui): commit grid SlickGrid overrides via @apply` (Deferred D2)

Remaining `.kv-commit-grid .slick-*` rules (pane, viewport, canvas, row, row head/hover/selected/
focus/collapsed, cell, graph-cell padding): selectors and source order unchanged; add
`@reference "../theme/tailwind.css";` and express each single-declaration, var-free property with
`@apply kv:…` (R8). Raw stays: `contain: layout paint` (P162), `color-mix` head tint, inset
box-shadow accent, `grid-template-rows` with `var()`, `outline` focus recipe (kv root's own 1px
`--kv-focus-border`, P122 exception).

### C8 `refactor(studio): slick grid app-built DOM to utilities`

From `slickTheme.css` into class strings:
- `.slick-grid-host` base box (`h-full relative text-kira-md font-data text-fg`) onto both host
  roots (`SlickGridHost.vue:2694`, `ConsoleSlickGrid.vue:863`); class name stays (scoping ancestor
  for every kept rule). `.slick-grid-mount` (`h-full w-full`) onto both mounts.
- `.no-rows` (`absolute inset-0`): first confirm where `slickTheme.css` is loaded. It is imported
  only by `SlickGridHost.vue:108` and `ConsoleSlickGrid.vue:63`; if those are lazy chunks, the
  rule currently applies to `StreamView.vue:1113,1120,1129` and `ConsoleResultGrid.vue:343,346`
  only after a grid has mounted. Reproduce today's effective layout per site (add `absolute
  inset-0` only where it applies in practice; check with the relevant UI spec), then delete the
  rule. Marker `no-rows` stays (tests poll it).
- `.cell-nav-btn` (`SlickGridHost.vue:1074`), `.header-key`/`.is-fk` colour and margin
  (`:1208`; font-size stays in CSS, R5), `.header-select-zone` (`:1230`), `.cell-input` variants
  (`:207` insert input, `slick/editor.ts:71` editor input) where the creation site alone decides
  the variant.
- R3 check per element: grep `node_modules/slickgrid/dist/styles/css/slick.grid.css` for a
  selector reaching the element first; an unlayered vendor rule on the same property keeps that
  property in `slickTheme.css`.
- Files: `slickTheme.css`, `SlickGridHost.vue`, `ConsoleSlickGrid.vue`, `slick/editor.ts`,
  possibly `StreamView.vue`, `ConsoleResultGrid.vue`, `FkPreviewPopover.vue` (it reuses
  `.slick-grid-host .header-key` styling, `:164-165`; keep its look).

### C9 `refactor(studio): slickTheme overrides via @apply` (Deferred D2)

Every kept rule in `slickTheme.css`: add `@reference "@theme/base.css";`, `@apply` the safe
subset (R8), selectors and order untouched. Geometry that `kiraSlickGrid.ts` mirrors in JS
(`--sg-row-h`, `cellHeightDiff`, cell padding, gutter width) stays exact (R4). Font sizes stay raw
(R5; this file is exempt from `check_font_scale`).

### C10 `refactor(space): review load-error zone to utilities`

`reviewDecorations.ts:211,218`: Monaco view-zone `domNode` is app-built DOM; Monaco only positions
it with inline style. `kira-review-load-error` becomes utilities (`flex items-center gap-2 h-full
px-3 bg-error/12 text-error text-kira-md`); retry button becomes `buttonVariants(...)` from
`@theme/components/ui/button` (nearest variant, D5 drift) or utilities if no variant fits. Delete
both rules from `packages/theme/src/review-decorations.css`. Glyph/line rules stay (§5).

### C11 `refactor(theme): last raw declarations in kept blocks to @apply` (Deferred D2)

`MonacoHost.vue:751-757` (`bg-search-match`, `bg-search-match-current`), `base.css` `body`
(`font-ui text-kira-md text-fg bg-chrome antialiased select-none`) and `html, body, #app`
(`h-full m-0 overflow-hidden`). Scrollbar pseudo-element rules stay raw (sizing, `background-clip`
and transparent-border trick have no utility).

### C12 `docs: P213 result`

`docs/v2.2/SPEC.md`: P213 result section (counts before/after per §2.1 row, accepted drift list,
visual-diff notes, kept-block table final state). `docs/ARCHITECTURE.md` Styling row: one sentence
for the class-map rule (R1) and ADE tone tokens. Status column of the P213 row stays for the
orchestrator.

Fix commits from §6 land between C11 and C12, grouped by root cause.

## 5. Kept CSS, reason per block

| Block | Reason |
|---|---|
| `MonacoHost.vue` scoped block | `:deep()` into Monaco's editor DOM and `:global()` for hover/suggest widgets reparented to `document.body`; no template element to carry a class. Already `@apply` except C11's two declarations. |
| Studio `panels/OperationsPanel.vue` scoped block | `:deep()` into Monaco's DOM (`.monaco-editor`, `.monaco-scrollable-element`, `.view-line`). Already `@apply`. |
| `ResponseDiffDialog.vue` scoped block | `:deep(.monaco-diff-editor)` child Monaco renders. Already `@apply`. |
| `RepoFileView.vue` scoped block | `v-html` markdown output; no template element per heading/list. Already `@apply` (D3). |
| `CommitGrid.vue` residue | SlickGrid-owned row/cell/pane DOM, row-state classes via `getItemMetadata`, specificity/order-sensitive hover/selected/head layering; plus badge font sizes (R5). |
| `slickTheme.css` residue | SlickGrid-owned DOM; must beat unlayered `slick.grid.css`; `setCellCssStyles` layer classes with order-dependent cascade (§6 D6 comment); sort-indicator pseudo-elements; data-view font sizes (R5). |
| `edDecorations.css` | Monaco tokenizer/decoration classes; must tie-break Monaco's runtime-injected unlayered `.mtk*` rules at (0,2,0). A layered utility loses. |
| `review-decorations.css` glyph/line rules, `blame-annotation.css` | Monaco decoration `className`/`glyphMarginClassName`/`inlineClassName` on Monaco-built DOM, same cascade contest as `edDecorations.css`; `::before` codicon colour. |
| `primitives.css` `.p-input.is-grow` | Auto-grow grid replica with clamped `padding-block` calc; must stay unlayered to beat the `kira` variant (P110 B31). |
| `tokens.css`, `vscode-bridge.css`, `shadcn-bridge.css`, `tailwind-core.css`, git-ui `kira-structure.css`/`density.css`/`vscode-tokens.css`/`theme/tailwind.css`, webview `tailwind.css`/`kira-bridge.css`, Space `styles.css`, `workbench.css` | Token definitions, `@theme`/`@utility`/`@custom-variant` config, bridges, roots. These are Tailwind's own config surface. `vscode-tokens.css` lane rules are generated. |
| git-ui `icons/codicon.css` | `@font-face`. |
| `base.css` scrollbar rules | `::-webkit-scrollbar*` sizing and `background-clip` trick; no utility. |
| `tw-animate-css` / keyframes | None hand-written remain; `animate-spin`/`animate-pulse` already used. |

## 6. Rules for the implementer

### 6.1 Mechanical rules

- R1 Literal classes only. A dynamic choice is a `Record<Enum, string>` map whose every value is a
  full literal (`'bg-conn-red'`). Never `` `bg-conn-${c}` ``: Tailwind emits only scanned literals.
  Precedent: `PR_ICON_CLASS` (`CommitMeta.vue:165`), P110 `HEADER_STATUS_CLASS`.
- R2 Escape-hatch ladder (ARCHITECTURE Styling row): default-scale utility, then existing token
  utility, then new `@theme` token (3+ uses or a design seam), then arbitrary value with the reason
  in the commit message.
- R3 Cascade. Move a declaration to a layered utility only when no unlayered rule (`slick.grid.css`,
  Monaco runtime CSS, `codicon.css`, a kept override) sets the same property on the same element.
  Otherwise it stays in the unlayered rule (C7/C9 may `@apply` it there).
- R4 JS-mirrored geometry is exact-only: row height, `--sg-row-h`, cell padding feeding width
  measurement, gutter width, `--kv-h-xs` tracks. Grep the value or token in `.ts` before changing.
- R5 Font sizes in `slickTheme.css` and `CommitGrid.vue` never move. Both are
  `check_font_scale`-exempt; the same size as a class elsewhere fails lint. Elsewhere only
  `text-kira-sm/md/lg/xl` (kv: `text-sm/base/lg`).
- R6 Marker classes stay. Before dropping a class name, grep `apps/*/tests`, `packages/*/src`
  (`querySelector`, `closest`, descendant selectors) and test support files. A name with a reader
  stays as a bare marker; only its declarations go.
- R7 No same-group static-vs-conditional pair on one element (`check-class-conflicts.ts`). When a
  conditional colour replaces a `:style`, make both branches conditional or merge with `cn()`.
- R8 `@apply` safe subset in kept vendor blocks: single-declaration, var-free utilities (colour
  tokens, display, position, inset, overflow, size, spacing, font family, scale font sizes outside
  R5 files, cursor, whitespace, text-overflow, font-style/weight). Composite utilities stay raw
  (`border` shorthand with `--tw-border-style`, shadow/ring, transform/translate, filters,
  gradients): their `--tw-*` vars depend on `@property` rules a `@reference` file never emits.
- R9 No `ring-N` and no >1px coloured focus outline (`check_focus_width`, P122). Tint halos use
  `shadow-[0_0_0_Npx_…]`.
- R10 New `@theme` colour names never redeclare a `shadcn-bridge.css` name. A new
  spacing/radius/text/shadow token also registers in `packages/theme/src/lib/utils.ts` (and
  `packages/git-ui/src/lib/cn.ts` for kv) or `check-class-conflicts.ts`'s self-check fails. This
  plan adds colour tokens only.
- R11 Components stay `<script setup lang="ts">`; no new `<style>` block anywhere; no new
  dependency.

### 6.2 Partial-match snapping (user-accepted drift)

- Spacing/size px: nearest 4px-unit step (`p-1.5` = 6px valid); a tie rounds down. Not for R4
  values.
- Radius: nearest `rounded-kira-xs/sm/kira/lg/pill` by `tokens.css` value.
- Border width: `border` (1px, `--kira-border-width`); `1.5px` snaps to 1px (D5).
- Alpha: `color-mix(in srgb, X N%, transparent)` becomes `X/N` (Tailwind v4 mixes in oklab: tiny
  hue drift, D5). `color-mix(… N%, var(--kira-bg))` on an element painted over `--kira-bg`
  becomes `/N` too.
- Colour literal with no token outside ADE: nearest same-role `--kira-*` token. None found at base;
  `check-tokens.sh` and `check-ade-colours.sh` already pin both sides.
- z-index: existing `z-(--kira-z-*)` only.

### 6.3 Verification

Per commit (cheap): pre-commit hook (`bun run lint` = biome + `check-tokens.sh` +
`check-theme-classes.sh` + `check-ade-colours.sh` + `check-class-conflicts.ts`; `bun run
typecheck`). Plus the affected build: `bun run build:studio` (C1, C2, C8, C9, C11), `bun run
build:space` (C2-C7, C10, C11), `bun run build:vscode` (C6, C7, C11).

Emission check after each class-map commit (C1, C3-C6): grep the built CSS
(`apps/*/frontend/dist/**/*.css`, webview bundle for C6) for every new map literal (e.g.
`bg-tone-amber-solid`, `bg-conn-teal`, `border-(--kv-graph-lane-7)` escaped form). A missing rule
means a non-literal or an unscanned file; fix before the next commit.

Phase end, once (expensive tier, CLAUDE.md "implement first, test once"):
1. `bun run test:unit`.
2. `bun run test:ui:studio`, `bun run test:ui:space`, `bun run test:webview`. Targeted reruns while
   fixing: Studio `slick-grid`, `console`, `data-view`, `interaction`, `cell-editor`,
   `mask-preview`, `row-coloring`, `http-request`, `connections`, `connection-dialog-tabs`,
   `api-ui-consistency`, `tabs`, `mode-switch`, `autocomplete`, `terminal-module`; Space every
   `ade-v2-*`, `repo-workspace`, `repo-graph-*`, `modules`; webview `graph-columns`,
   `graph-branch-order`, commit-meta harness.
3. Visual before/after, never touching the committed baselines (sandbox fonts differ from CI,
   `docs/DEV_ENVIRONMENT.md` "tests/visual/* pixel diffs"):
   1. `git worktree add <scratchpad>/p213-visual 363cb6622`, run `scripts/prepare-worktree.sh`
      there if needed.
   2. In that worktree run `bun run test:visual:update:studio` and `bun run
      test:visual:update:space`. This writes sandbox-font "before" snapshots inside the scratch
      worktree only.
   3. In the same worktree: `git checkout <P213 tip> -- . ':(exclude)**/*-snapshots/**'`. This
      takes the P213 tree and keeps the "before" snapshots.
   4. Run `bun run test:visual:studio` and `bun run test:visual:space`. Each failing diff is real
      P213 drift. Review every diff image; accept only drift §6.2 allows; fix anything else.
   5. `git worktree remove --force <scratchpad>/p213-visual`.
   6. In `/home/user/kira-v21-C`, `git status` must show no `*-snapshots/` change. Never run
      `--update-snapshots` there.
   Record accepted drifts (spec, element, cause) in the C12 result section.
4. Counts: rerun §2.1/§2.2 greps; result section reports before/after per row.
5. Every hook green on every commit that ships. A failure found here, pre-existing or not, gets fixed
   in this pass (CLAUDE.md rule), committed by root cause.

## 7. Deferred decisions (recommended defaults; implementer applies the default unless the user overrides)

- D1 ADE tones become `@theme` tokens plus class maps (C3-C5). Default: yes. P129/P138 keep tones as
  literal data, not theme: that holds, since literals stay byte-identical and stay pinned by
  `check-ade-colours.sh` (extended to `.css`). Risk: P212's mobile agents module may import
  `tagStyle`/`solidStyle`/`actionStyle`; C5 deletes them. Mitigation: the orchestrator tells the
  P212 stream before P213 lands; whichever lands second switches to the class maps. Alternative:
  keep the `:style` helpers (about 90 bindings stay inline).
- D2 `@apply` the safe subset (R8) in kept vendor-override blocks (C7, C9, C11). Default: yes,
  P110 precedent (`MonacoHost.vue`, `RepoFileView.vue`). Alternative: leave those blocks raw;
  it is lower risk on the two most perf-tuned files, but they keep hand-written values.
- D3 `RepoFileView.vue` markdown block. Default: keep the existing `@apply` block. Alternatives:
  `@tailwindcss/typography` (`prose`), a new dependency with its own type and spacing opinions to
  override back onto `--kira-*`; or ~40 arbitrary descendant variants (`[&_h1]:…`) on one element,
  which reads worse than the block.
- D4 `apps/kira-studio/frontend/proto/**` (dev-only Cheetah/Slick grid prototype, not shipped).
  Default: out of scope.
- D5 Accepted drift classes: oklab vs srgb alpha mixing, `1.5px` borders to 1px, px to nearest
  4px step, nearest shadcn button variant for the review retry button. Default: accept; each
  instance listed in the result section.

## 8. Done when

- Every §4 commit landed (or a D-decision default recorded as the reason it did not), hooks green,
  no `--no-verify` on any shipped commit.
- No `:style` binding outside classes A/B/F/G; every `<style>`/`.css` block left is in §5 with its
  reason.
- §6.3 phase-end suites green; visual drift reviewed and listed; no baseline file changed.
- Excluded paths (§3.1) untouched: `git diff --stat 363cb6622.. -- packages/workbench/src/memory
  apps/kira-space/frontend/src/workbench/memoryModule.ts apps/kira-space/frontend/src/App.vue` is
  empty.
