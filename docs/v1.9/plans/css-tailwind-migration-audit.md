# CSS to Tailwind migration audit

Audit only; no source changed. Written against `05ec1cd`. The user asked: "look again at css and
non tailwind default css and see what can be moved to tailwind. Even if it means changing the
styles." Every visual change below is named. Nothing here is scheduled. Turning any section into
work needs its own `SPEC.md` row and plan.

Categories:

- **1**: trivially convertible. Exact same computed style.
- **2**: convertible with a disclosed visual change, or blocked on a named prerequisite.
- **3**: stays CSS. The reason is given per item.

---

## 1. Summary

Surveyed: `apps/kira-studio/frontend/src`, `apps/kira-space/frontend/src`, `packages/theme`,
`packages/workbench`, `packages/kira-ui`, `packages/git-ui`. `apps/kira-space-vscode` has no
frontend CSS of its own; it hosts the git-ui build.

| Source | Files | Lines | Category split |
|---|---|---|---|
| Static inline `style="…"` | 19 | 22 attributes | all 1 (one optional 2) |
| Constant `:style` bindings | 7 | 8 bindings | all 1 |
| Vue `<style>` blocks, Studio/Space/workbench | 106 | 4,024 | 59 `@apply`-only (1,268 lines), 47 with 508 raw declarations; ~95% 1, residual 3 |
| Vue `<style>` blocks, git-ui | 44 | 2,731 | 1,440 raw declarations; all 2 (no Tailwind build) |
| `packages/theme/src/primitives.css` | 1 | 1,013 | ~620 lines 1, ~250 lines 2, ~140 lines 3 |
| `packages/workbench/src/workbench.css` | 1 | 164 | all 1 |
| `packages/kira-ui/src/theme/controls.css` | 1 | 549 | 2 (no Tailwind build) |
| git-ui `app-shell.css` | 1 | 109 | ~40 lines 2, rest 3 |
| Token, bridge, `base.css`, `slickTheme.css`, Monaco decoration and `@font-face` files | 13 | 1,927 | 3 (one small 2 exception, §6) |

**Top candidates, lowest risk first:**

1. 15 dialog-root inline widths (§3.1). Exact.
2. 7 other static inline styles and 8 constant `:style` bindings (§3.2, §3.3). Exact.
3. Two live bugs caused by unlayered `primitives.css` beating template utilities (§2). The fix is
   deleting the rule the templates already duplicate.
4. `workbench.css` (164 lines) folded into its templates (§3.5).
5. 7 single-utility alias classes, 426 attributes in 110 files (§3.6).
6. 508 raw declarations in 47 Studio/Space/workbench blocks. Nearly all are one `var(--kira-*)`
   reference with a direct utility (§3.7).

Stays CSS: token/bridge files, `slickTheme.css`, Monaco-owned DOM, `v-html` markdown, global
scrollbar theming, the `p-input.is-grow` auto-grow trick, number-input spin-button resets (until
`.p-input` is a component), `@font-face`, and the git-ui checkbox pseudo-elements (§6).

---

## 2. Live bugs found: unlayered CSS beats layered utilities

`primitives.css`, `workbench.css` and every `<style>` block are unlayered. Tailwind utilities
live in `@layer utilities`. An unlayered declaration wins over any layered one, whatever its
specificity. So a template utility that conflicts with a primitive rule on the same element is
silently dead. Two instances are live today.

### 2.1 Run-state ring never shows its running or error colour

11 call sites (e.g. `apps/kira-studio/frontend/src/views/console/ConsoleView.vue:842-853`) write:

```html
<span class="p-run-state inline-flex items-center gap-1 font-data text-kira-xs text-subtle"
      :class="{ 'text-info': running, 'text-error': error }">
  <span class="ring h-3 w-3 shrink-0 rounded-full border-2 border-border-strong"
        :class="{ 'animate-kira-spin border-t-accent border-r-transparent border-b-accent border-l-accent': running,
                  'border-error': error }" />
```

`primitives.css:754-791` sets `.p-run-state { display: flex; color: var(--kira-fg-subtle) }` and
`.p-run-state .ring { width: 11px; height: 11px; border: 2px solid var(--kira-border-strong) }`.
These override `inline-flex`, `text-info`/`text-error`, `h-3 w-3` and every `border-*` colour. The
animation still runs, but on a uniformly grey circle, so it looks static. The label never turns
blue or red. `.is-running`/`.is-error` (the old state classes) have no consumer left.

A second, independent bug: `border-*-accent` resolves to shadcn's `--accent` (hover grey), not
`--kira-accent`. P104 §7.2 warns about this. The brand colour is `primary`.

Fix: delete `.p-run-state*` (lines 754-791) from `primitives.css`, keep `@keyframes p-spin`
(it backs `animate-kira-spin`), and in the 11 templates swap `border-*-accent` for
`border-*-primary`. After the fix, the ring is 12px, not 11px, because the templates say `h-3 w-3`.
The running label turns `info` blue and the error label turns red, as the templates intended.

### 2.2 Four panel heads render at 26px instead of 34px

`p-panel-head h-bar` sits at `apps/kira-studio/frontend/src/project/ProjectPanel.vue:35`,
`terminal/TerminalPanel.vue:142`, `api/CollectionsPanel.vue:127` and
`apps/kira-space/frontend/src/repo/GitPanel.vue:334`. Commit `92f3462` converted them from
`h-[34px]`, so 34px is the intent. `.p-panel-head { height: var(--kira-control-h-lg) }` (26px)
wins. Fix: convert `.p-panel-head` to template utilities (§3.8) so `h-bar` takes effect. The
change is visible: these four heads grow 8px taller, matching the tab bar they sit beside.

### 2.3 Systemic hazard

The same failure recurs anywhere a primitive class and a conflicting utility share an element.
There are two ways to remove the hazard:

- **Migrate the rules into the templates.** The rest of this doc does this.
- **Import `primitives.css` and `workbench.css` with `layer(components)`.** Utilities would then
  win. Before doing this, audit for rules that win on purpose today (e.g. `.p-input` inner-input
  resets, which use the unlayered cascade against shadcn's `Input`). This is one line in
  `base.css` plus that audit. It is the cheapest step that stops new instances. It does not fix
  §2.1's accent-vs-primary bug.

### 2.4 Colour-name collision (side finding, not verified per call site)

`base.css`'s `@theme` redefines `--color-muted`, `--color-input` and `--color-border` after
`shadcn-bridge.css`'s `@theme inline` defines them. The compiled output has
`--color-muted: var(--kira-fg-muted)` (#9d9d9d). shadcn's variants use `bg-muted` as a background
(`ToggleGroupItem`'s `data-[state=on]:bg-muted`, 63 usages; `Button` ghost/outline
`hover:bg-muted`, 20). Those surfaces get a light-grey fill meant to be foreground text colour,
unless a consumer overrides it via `cn()`. `border-input` also resolves to `--kira-bg-input`
(#313131). That value equals `border-strong`, so it is harmless. Check the `bg-muted` sites
separately before any rename.

---

## 3. Prioritized conversions

Ordered by value over risk. Each item is independent unless noted.

### 3.1 Dialog-root inline widths (15 files, category 1)

Every one follows the same pattern, from commit `2717a49`:

```html
<!-- before: apps/kira-studio/frontend/src/project/ConnectionDialog.vue:589 -->
<DialogContent style="width: 620px; max-width: min(620px, calc(100% - 2rem)); height: 544px">
<!-- after -->
<DialogContent class="w-155 sm:max-w-[calc(100%-2rem)] h-136">
```

`DialogContent`'s base classes already include `w-full max-w-[calc(100%-2rem)] sm:max-w-sm`, merged
by `cn()`/tailwind-merge. `sm:max-w-[calc(100%-2rem)]` replaces `sm:max-w-sm`. The fixed width
together with the base `max-w-[calc(100%-2rem)]` equals `min(W, calc(100% - 2rem))` exactly.
`max-height: 80vh` becomes `max-h-4/5`, which is exact because `DialogContent` is `position: fixed`
(its containing block is the viewport). `max-h-[80vh]` is the explicit alternative.

| File:line | Width | Height rule | Classes |
|---|---|---|---|
| `apps/kira-space/frontend/src/workbench/GitPairingDialog.vue:73` | 420 | max 80vh | `w-105 … max-h-4/5` |
| `apps/kira-space/frontend/src/workbench/GitCredentialDialog.vue:59` | 440 | max 80vh | `w-110 … max-h-4/5` |
| `apps/kira-studio/frontend/src/api/DynamicValuesDialog.vue:72` | 480 | max 80vh | `w-120 … max-h-4/5` |
| `apps/kira-studio/frontend/src/workbench/UploadObjectDialog.vue:106` | 480 | max 80vh | `w-120 … max-h-4/5` |
| `apps/kira-studio/frontend/src/api/SaveRequestDialog.vue:79` | 480 | none | `w-120 …` |
| `apps/kira-studio/frontend/src/workbench/DbMcpApprovalDialog.vue:116` | 520 | max 80vh | `w-130 … max-h-4/5` |
| `apps/kira-studio/frontend/src/project/FiltersDialog.vue:148` | 560 | max 80vh | `w-140 … max-h-4/5` |
| `apps/kira-studio/frontend/src/api/ImportCurlDialog.vue:56` | 560 | max 80vh | `w-140 … max-h-4/5` |
| `apps/kira-studio/frontend/src/project/ConnectionDialog.vue:589` | 620 | h 544 | `w-155 … h-136` |
| `apps/kira-studio/frontend/src/api/EditRawRequestDialog.vue:75` | 680 | max 80vh | `w-170 … max-h-4/5` |
| `apps/kira-studio/frontend/src/api/CopyAsCurlDialog.vue:73` | 680 | max 80vh | `w-170 … max-h-4/5` |
| `apps/kira-studio/frontend/src/workbench/GenerateDataDialog.vue:237` | 680 | max 82vh | `w-170 … max-h-[82vh]` (see below) |
| `apps/kira-studio/frontend/src/project/SchemaDialog.vue:122` | 720 | max 80vh | `w-180 … max-h-4/5` |
| `apps/kira-studio/frontend/src/project/DataGripImportDialog.vue:144` | 720 | h 560 | `w-180 … h-140` |
| `apps/kira-studio/frontend/src/views/httprequest/ResponseDiffDialog.vue:227` | 900 | h 640 | `w-225 … h-160` |

`GenerateDataDialog`'s 82vh has no scale step. Either keep `max-h-[82vh]` (exact) or use
`max-h-4/5`, which is category 2 (2vh shorter, about 18px on a 900px window).

Related bug: `packages/workbench/src/components/ConfirmDialog.vue:40` uses
`class="w-100 max-w-100 sm:max-w-100"`. It overflows a viewport narrower than 432px, the bug
`2717a49` fixed elsewhere. Same fix: `w-100 sm:max-w-[calc(100%-2rem)]`.

A wider alternative: drop `sm:max-w-sm` from `DialogContent`'s base. Every call site then needs
only `w-N`. That is a shadcn component edit touching every dialog; check the dialogs that rely on
the `sm` 384px cap first.

### 3.2 Other static inline styles (category 1)

| File:line | Before | After |
|---|---|---|
| `apps/kira-studio/frontend/src/views/definition/DefinitionView.vue:241` | `style="background: var(--kira-bg-input); color: var(--kira-fg-muted)"` | `class="bg-input text-muted"` |
| `apps/kira-studio/frontend/src/views/stream/StreamView.vue:1105`, `:1192` | `style="width: 40px"` | `class="w-10"` |
| `apps/kira-studio/frontend/src/views/stream/StreamView.vue:1166`, `:1252` | `style="flex: 1"` | `class="flex-1"` |
| `packages/workbench/src/components/WorkbenchShell.vue:133` | `style="padding: 0 var(--kira-window-inset) var(--kira-gap); background: var(--kira-bg-chrome)"` | `class="px-1.5 pb-0.5 bg-chrome"` |
| `packages/git-ui/src/components/UncommittedChangesStrip.vue:150` | `style="fill: none"` | `class="fill-none"`, after §5 only |

The `DefinitionView` chip: `.p-chip` is unlayered and also sets `background`/`color`, so utility
classes lose to it. Either convert `.p-chip` first (§3.8) or use `bg-input! text-muted!` (v4 important suffix). That is
why the inline style exists today.

`WorkbenchShell`: `--kira-window-inset` (6px) and `--kira-gap` (2px) are both static tokens, so
`px-1.5 pb-0.5` is exact.

### 3.3 Constant `:style` bindings (category 1)

| File:line | Before | After |
|---|---|---|
| `packages/workbench/src/components/StatusBar.vue:11` | `:style="{ color: 'var(--kira-fg-muted)' }"` | `class="text-muted"` |
| `apps/kira-studio/frontend/src/views/httprequest/TimelinePane.vue:224` | `RESIDUE_COLOR = 'var(--kira-conn-grey)'` bound as a background | `bg-conn-grey` class |
| `apps/kira-studio/frontend/src/project/DataGripImportDialog.vue:265` | ok/error colour ternary | `:class="ok ? 'text-ok' : 'text-error'"` |
| `apps/kira-studio/frontend/src/views/documents/DocumentView.vue:757` | error colour | `:class` with `text-error` |
| `apps/kira-studio/frontend/src/views/stream/StreamView.vue:707` | error colour | `:class` with `text-error` |
| `apps/kira-studio/frontend/src/views/shared/page/SearchToolbar.vue:262` | error colour | `:class` with `text-error` |
| `apps/kira-studio/frontend/src/views/stream/StreamView.vue:919` | state-on colour | `:class` with `text-state-on` |
| `apps/kira-studio/frontend/src/workbench/StatusBar.vue:161` | engine ok/error ternary | `:class` |

### 3.4 Runtime bindings that stay inline (category 3)

These values are computed at runtime. A class cannot carry them.

- Virtualizer `transform`/`height`, tree depth padding, and column widths.
- floating-ui `left`/`top` from `@floating-ui/dom` (`packages/kira-ui/src/floatingPosition.ts`).
- `--kira-rail` and `var(--kira-conn-${color})` connection colours. A 13-entry class lookup is
  possible but adds a map for no behaviour change.
- `fileIconStyle` and AppearancePane's font previews.
- `FkPreviewPopover.vue:163` `typeClassColor(col.typeClass)`.
- `SettingsShell`'s `width`/`height` props.

### 3.5 `packages/workbench/src/workbench.css` (164 lines, category 1)

This file is global and unlayered. The reason for plain CSS (its header, lines 22-26) was to avoid
`@apply` in a shared package file. Template utilities have no such problem, because the file's own
`@source "./"` already scans this package.

```html
<!-- before: apps/kira-studio/frontend/src/workbench/WorkbenchShell.vue:79-85 -->
<div class="tab-strip-actions"><button class="tab-new">
<!-- after -->
<div class="h-full flex items-center shrink-0 pt-0.5 pr-1 pl-0.5">
  <button class="flex items-center justify-center size-5.5 bg-transparent border-0 cursor-pointer
                 rounded-kira-sm text-muted hover:bg-hover hover:text-fg">
```

- `.title-bar-actions` becomes `flex items-center gap-0.5 ml-auto [--wails-draggable:none]`.
- `.title-action` becomes a `Button` variant (`variant="title"`, `size="title"`) in
  `packages/theme/src/components/ui/button`, since both apps render it: `inline-flex items-center
  justify-center size-5.5 rounded-kira-sm border border-transparent bg-transparent text-muted
  cursor-pointer hover:bg-hover [--wails-draggable:none]`, plus
  `aria-pressed:bg-elevated aria-pressed:border-border-strong aria-pressed:text-fg` in place of
  `.is-on`. Swapping `.is-on` for `aria-pressed` also fixes accessibility: the toggle state is
  currently not exposed.
- `.title-action--labelled` becomes `w-auto px-1 gap-1 text-kira-sm`.
- The settings-field vocabulary (`.field`, `.field-head`, `.field.checkbox`, `.checkbox-row`,
  `.sec-label`, `.helper-text`, `.field-error`) is used by 5 shared field components
  (`packages/workbench/src/settings/fields/*`, 2 callers each per CodeGraph), both apps' panes,
  and `SettingsShell` (2 callers).
  - Convert these to a small `SettingsField`/`FieldHelp` component pair in
    `packages/workbench/src/settings/fields/`, or to inline utilities.
  - `.field` becomes `flex flex-col gap-1 text-kira-sm [&>span:first-child]:text-muted`.
  - `.sec-label` becomes `uppercase text-kira-sm text-subtle tracking-[0.06em] pt-1`.
  - `.helper-text` becomes `leading-normal text-subtle text-kira-xs`.
  - `.field-error` becomes `leading-normal text-error text-kira-xs`.
- `.settings-pane` becomes `contents`.

**Disclosed side effect:** the global `.field`/`.helper-text`/`.field-error` rules currently also
reach three non-settings components: `ConnectionDialog.vue`, `RequestSettingsPane.vue` and
`StreamComposeMessage.vue`. Deleting them removes the leak. Each of these three needs a visual
check. ConnectionDialog redeclares most properties in its own scoped `.field`. The other two may
lose `gap`/`font-size`.

`.checkbox-row` depends on source order after `.field`, per the file's comment. Utilities have no
such ordering hazard.

### 3.6 Single-utility alias classes in `primitives.css` (category 1)

| Class | Equals | Attributes | Files |
|---|---|---|---|
| `.mono` | `font-data` | 72 | 34 |
| `.muted` | `text-muted` | 62 | 30 |
| `.dim` | `text-subtle` | 75 | 24 |
| `.p-sm` | `text-kira-sm` | 43 | 23 |
| `.p-xs` | `text-kira-xs` | 67 | 22 |
| `.p-push` | `ml-auto` | 65 | 41 |
| `.icon-box` | `size-4 flex items-center justify-center shrink-0` | 42 | 27 |

Total: 426 attributes across 110 files, and about 35 lines of CSS removed.

Mechanical replace. Test selectors depend on three of these:

- `apps/kira-studio/tests/ui/api-ui-consistency.spec.ts` uses `.dim`.
- `mode-switch.spec.ts` uses `.icon-box`.
- `font-roles.spec.ts` uses `.mono`.

11 spec files in total select on some `p-*`/alias class (about 23 selectors). Move those to
`data-testid` in the same pass.

`.p-push` is often a bare `<span class="p-push" />` spacer. Where it is, the spacer can go and
`ml-auto` moves onto the next element. That is a template simplification, not required.

### 3.7 Raw declarations in Studio/Space/workbench `<style>` blocks (category 1)

47 blocks, 508 declarations. Nearly every declaration is one `var(--kira-*)` reference with a
direct utility:

| Declaration | Utility |
|---|---|
| `gap/padding/margin: var(--kira-s-1..6)` | `*-0.5/1/1.5/2/3/4` |
| `height: var(--kira-h-xs/sm/md)` | `h-4.5/5.5/6.5` |
| `height: var(--kira-row-height)` | `h-row` |
| `font-size: var(--kira-t-xs..xl)` | `text-kira-xs..xl` |
| `color: var(--kira-fg/-muted/-subtle)` | `text-fg/muted/subtle` |
| `color: var(--kira-accent)` | `text-primary` (not `text-accent`, see §2.4) |
| `background: var(--kira-bg-input/-elevated/-chrome/hover/select)` | `bg-input/elevated/chrome/hover/select` |
| `border: var(--kira-border-width) solid var(--kira-border[-strong])` | `border border-border[-strong]` |
| `border-radius: var(--kira-radius-sm/radius)` | `rounded-kira-sm/rounded-kira` |
| `font-family: var(--kira-font-data/ui)` | `font-data/font-ui` |
| `z-index: var(--kira-z-*)` | `z-(--kira-z-*)` |
| `rgba(55, 148, 255, 0.16)` | `bg-info/16` |

Largest blocks, in value order:

- `apps/kira-studio/frontend/src/project/ConnectionDialog.vue`: 234 lines, 123 declarations. All
  map exactly. `width: 96px` becomes `w-24` and `max-height: 220px` becomes `max-h-55`. The
  `.swatch.none` gradient is shared with two other files (§3.9).
- `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue`: 157 lines, 47 declarations,
  unscoped. It is unscoped because it styles `SettingsShell` slot content and pane markup.
  Convert by moving the utilities onto the pane elements themselves. `flex: 0 0 150px` becomes
  `flex-none basis-37.5`, and `flex: 0 0 36px` becomes `flex-none basis-9`.
- `apps/kira-space/frontend/src/workbench/SettingsDialog.vue`: 60 lines, 15 declarations,
  unscoped. Same approach. Its `.segmented` duplicates Studio's and ConnectionDialog's (§3.9).
- `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue` (26 declarations),
  `StudioStart.vue` (17), `FiltersDialog.vue` (22), `TreeRow.vue` (20), `TabStrip.vue` (20),
  `WorkbenchShell.vue` (23), `AutocompleteField.vue` (24), `DataGripImportDialog.vue` (13),
  `ErrorPopover.vue` (10), `packages/workbench/src/components/TitleBar.vue` (10).

Literal-px notes (exact on the scale):

- `TabStrip.vue`'s `padding: 2px 0 0 4px` becomes `pt-0.5 pl-1`, and `margin: 4px 2px 4px 0`
  becomes `my-1 mr-0.5`.
- `GitPanel.vue`'s `calc(var(--kira-s-3) + 14px + var(--kira-s-2))` is 24px, so `pl-6`. The
  derivation from the icon size (14px) is lost; keep a one-line comment if that matters.
- `RepoSearchRow.vue`'s `calc(var(--kira-s-2) + 20px)` also becomes `pl-6`.
- `MonacoHost.vue`'s `padding: 4px 6px` becomes `py-1 px-1.5`.
- `ErrorPopover.vue`'s `max-width: calc(100vw - 8px)` becomes `max-w-[calc(100vw-8px)]`.
- `workbench/.../TitleBar.vue`'s `--wails-draggable: drag` becomes `[--wails-draggable:drag]`.

Pseudo-elements with a utility equivalent:

- The `scrollbar-width: none` plus `::-webkit-scrollbar` pairs in `ConsoleView.vue`,
  `DocumentTree.vue` and `TabStrip.vue` become `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`.
- `TabStrip.vue`'s `.p-tab.is-attention::after` becomes `after:content-[''] after:bg-state-on …`.
- The mask triple with `-webkit-` prefixes (`RepoSearchRow`, `RepoTreeRow`, `TabStrip`) becomes
  `mask-contain mask-no-repeat mask-center`. Tailwind emits both prefixed and unprefixed forms.

`@keyframes`:

- `FkPreviewPopover.vue`'s `fk-preview-spin` (1s linear, rotate 0 to 360) equals `animate-spin`
  exactly (category 1). It deletes 11 lines.
- `TreeRow.vue`'s `tree-row-pulse` (1s ease-in-out, opacity 1 to 0.35) is category 2.
  `animate-pulse` is 2s `cubic-bezier(0.4,0,0.6,1)`, opacity 1 to 0.5, so the pulse is half the
  speed and shallower. Alternatively, add `--animate-kira-pulse` to `@theme` with the current
  keyframes (exact, but keeps the keyframes as CSS).

Scoped selectors that reach child components (`:deep(.p-input)` in `DocumentView`,
`FilterToolbar`, `GrpcRequestView`, `HttpRequestView`, `FormDataTable`, `FieldRowsTable`, and
`:deep(input)` in `PagerControls`) exist because the styled element belongs to a child component.
Pass a `class` prop through the child instead once `.p-input` is a component (§3.8). Until then
these stay as `:deep` blocks.

### 3.8 `primitives.css` component classes (category 1 and 2)

1,013 lines, 107 class names. Beyond §3.6:

**Dead selectors (delete, category 1).** None has a consumer, and none is built dynamically:
`.p-btn.is-hover`, `.p-input.is-focus`, `.p-input.has-stepper`, `.p-row.is-hover`,
`.p-status.is-hover`, `.p-run-state.is-running`, `.p-run-state.is-error`, `.p-td.num`.

**Few consumers, convert to template utilities (category 1):**

| Class | Files |
|---|---|
| `p-btn` | 4 |
| `p-dlgbtn` | 2 |
| `p-tab` | 4 |
| `p-count` | 2 |
| `p-method` | 4 |
| `p-status` | 4 |
| `p-menu-label` | 1 |
| `p-completion*` | 1 (AutocompleteField) |
| `p-panel` | 2 |
| `p-tab-rail` | 2 |
| `p-tree-rail` | 1 |
| `p-thead`/`p-th` | 2 |
| `p-td` | 3 |
| `p-statusbar` | 1 |
| `p-disclosure` | 2 (its `summary::before` codicon becomes `[&>summary]:before:content-['\eab6'] [&>summary]:before:font-[codicon]`, compile-verified) |
| `p-kv-*` | 4 |
| `def-*` | 5-7 |

`p-btn` and `p-dlgbtn` belong on shadcn `Button` variants, not utility strings. `KuiButton.vue`
and git-ui's `ReviewView.vue:1332` reference `.p-btn` geometry in comments; update them.

**Many consumers, convert to a shared component or a cva variant (category 1 in computed style,
larger diff):**

| Class | Files | Target |
|---|---|---|
| `p-input` | 10 | shadcn `Input`/`InputGroup` variant, except the `.is-grow` trick (§6) |
| `p-select` | 16 | shadcn-vue `NativeSelect` (not yet in `components/ui/`; add it). Its `appearance: base-select`, `::picker(select)` and `::picker-icon` rules move into the component's class list as `[appearance:base-select] [&::picker(select)]:… [&::picker-icon]:…` (compile-verified). Keep the P61 WebKit min-height workaround (`primitives.css:343`) intact. |
| `p-row` | 11 | utilities |
| `p-badge` | 15 | shadcn-vue `Badge` (not yet in `components/ui/`; add it) |
| `p-chip` | 25 | shadcn `Badge` variants `warn/err/ok/info` |
| `p-float` | 5 | utilities |
| `p-panel-head` | 8 | utilities; fixes §2.2 |
| `p-toolbar` | 26 | utilities |
| `p-toolbar-rail` | 11 | utilities |
| `p-conn-dot` | 13 | utilities |
| `p-view-head`/`p-view-target` | 12 | utilities |
| `p-run-state` | 11 | delete; fixes §2.1 |
| `p-strip` | 11 | shadcn `Alert` variants; see below |
| `p-empty` | 5 | utilities |
| `p-dialog-body` | 11 | utilities |
| `p-dialog-actions` | 8 | shadcn `DialogFooter` |

`p-chip` before and after:

```html
<!-- before -->  <span class="p-chip warn">truncated</span>
<!-- after -->   <Badge variant="warn">truncated</Badge>
```

The variant is `bg-warn/16 text-warn rounded-kira-sm px-1 text-kira-xs`. The rgba literals in
`.p-chip` equal `bg-warn/16`, `bg-error/16`, `bg-ok/14` and `bg-info/16` exactly.

**Category 2 colour literals with no token:**

- `.p-strip.err` text `#f3a3a3`. Either add `--color-error-text` (a sibling to the existing
  `warn-text`/`note-text`; exact) or use `text-error` (disclosed: a more saturated red).
- `.p-count` text `#f0f0f0`. `text-fg` is `--kira-fg` (#cccccc), which is dimmer. Either accept
  that (disclosed) or add a token.
- `.p-strip` backgrounds equal `bg-error/10`, `bg-warn/10` and `bg-info/8` (exact).

**Strip-tone duplication.** Fold these in when `.p-strip` becomes an `Alert` variant.
`.strip-warn/-note/-err` plus a `-text` class are re-declared as scoped `@apply` in about 10
files, e.g. `FkPreviewPopover.vue:246-253`. Before and after:

```html
<!-- before --> <Alert class="strip-note"><AlertDescription class="strip-note-text">…
<!-- after -->  <Alert variant="note"><AlertDescription>…
```

### 3.9 Repeated scoped patterns worth one shared home (category 1)

- **Splitter handle**, 7 files: `ConsoleView`, `DataView`, `KeyValuePane`, `StreamView`,
  `HttpRequestView`, `GrpcRequestView`, and `BrowseView` (horizontal).
  - The scoped rule is `hover:bg-focus data-[state='drag']:bg-focus`, plus
    `box-shadow: inset 0 calc(var(--kira-border-width) * -1) 0 0 var(--kira-border)`, plus
    `box-shadow: none` on hover and drag.
  - The equivalent classes are
    `shadow-[inset_0_-1px_0_0_var(--kira-border)] hover:shadow-none data-[state=drag]:shadow-none hover:bg-focus data-[state=drag]:bg-focus`.
  - Add shadcn-vue's `resizable` set under `packages/theme/src/components/ui/` (it wraps reka's
    `SplitterResizeHandle`, already in use) and put them on its `ResizableHandle`, so all 7 files
    drop their block.
  - The `-1px` assumes `--kira-border-width` stays 1px. Use `calc(var(--kira-border-width)*-1)`
    inside the arbitrary value to keep it indirect.
- **`.swatch.none` diagonal slash**, 3 files: `ConnectionDialog`, `ScriptsPane`, `VariableSetView`.
  Add one `@utility swatch-none` in `base.css`. A multi-stop gradient with `calc` offsets is
  unreadable as an arbitrary value, so this is `@utility`, not inline classes.
- **`.segmented`**: `ConnectionDialog` and both `SettingsDialog`s. This is what shadcn
  `ToggleGroup` already provides, and the app already uses it 63 times. Replacing it is
  category 2. The visual difference is `ToggleGroup`'s item padding and pressed fill (currently
  `bg-muted`, see §2.4).
- **`.search-match`/`-current`**, 5 files, and `.virtual-row`, about 10 files. `.empty-state`
  (about 12), `.sticky-row` (3) and `.twisty`/`.tree-row` (`CollectionRow`, `TreeRow`,
  `RepoTreeRow`) are already `@apply`. After the §4 theme entries they are one-line utilities;
  inline them into templates.
- **`.columns-menu-*`**: `ColumnsMenu` and `ProjectionMenu` declare the same rules; only
  `ColumnsMenu` adds drag-reorder rules. Inline the utilities, or extract a shared list component.

### 3.10 `@apply`-only blocks (59 blocks, 1,268 lines, category 1, lowest value)

These blocks are already Tailwind. Moving their class lists into templates matches the
CLAUDE.md rule for new surfaces ("Tailwind utility classes, not a scoped `<style>` block") and
deletes the `@reference` indirection. It changes no pixel. The gain is smaller than every item
above, so do it last, file by file, when a file is touched anyway. Classes used in more than
about 3 places in one file (e.g. `.tree-row`) are clearer as an extracted child component than
as a repeated long class string.

---

## 4. Theme extensions (`base.css` `@theme`)

These tokens appear in raw CSS but have no utility today. Adding them enables the conversions
above.

| Entry | Maps to | Uses |
|---|---|---|
| `--color-search-match` | `var(--kira-search-match)` | 7 |
| `--color-search-match-current` | `var(--kira-search-match-current)` | 5 |
| `--color-var-resolved` | `var(--kira-var-resolved)` | 4 |
| `--color-syntax-property/string/number/keyword/function/meta` | `var(--kira-syntax-*)` | `DocumentTree`, `MonacoHost`, `AutocompleteField` |
| `--color-error-text` | new `--kira-error-text: #f3a3a3` in `tokens.css` | `.p-strip.err` |
| `--spacing-titlebar` | `var(--kira-titlebar-h)` | `workbench/.../TitleBar.vue` |
| `--spacing-tabbar` | `var(--kira-tabbar-h)` | `WorkbenchShell.vue` |
| `--spacing-statusbar` | `var(--kira-statusbar-h)` | `WorkbenchShell.vue` |
| `--spacing-titlebar-inset` | `var(--kira-titlebar-inset-left)` | `TitleBar.vue` |

`titlebar-h`, `tabbar-h` and `toolbar-h` all alias `bar-h` (34px) today. `tokens.css` keeps them
separate as deliberate per-bar seams. Named entries keep each seam. `h-bar`, `h-5` and `pl-19.5`
would be exact today but would collapse the seams (disclosed).

`z-index` stays var-based per P104. `z-(--kira-z-tooltip)` is the v4 shorthand for the current
`z-[var(--kira-z-tooltip)]`. The change is cosmetic, so it is optional.

All utilities named in this doc were compiled against the repo's `@theme` with Tailwind 4.3.3 in
a scratch harness, and all resolved. Negative controls (`bg-search-match`, `text-syntax-string`,
`h-titlebar`) correctly produced nothing before these entries existed.

---

## 5. git-ui and kira-ui: prerequisite phase (category 2 for all of it)

`packages/git-ui` (44 blocks, 2,731 lines, 1,440 raw declarations, zero `@apply`) and
`packages/kira-ui` (`controls.css`, 549 lines) have **no Tailwind build**.

- `packages/git-ui/vite.config.ts` (the VS Code webview build) has only `vue()`.
- In Kira Space, git-ui loads via `loadGitUi()` (dynamic import). It mounts its own `createApp`
  into a container with class `kv-mount-root`. It imports its own CSS in
  `packages/git-ui/src/main.ts`.
- Colours are `--kv-*`, read from `--vscode-*`. In Space, `vscode-bridge.css` maps those onto
  `--kira-*`.
- `--kv-t-*`, `--kv-h-*` and `--kv-control-h*` are runtime `calc`s from `--kv-font-size`.

P104 scoped git-ui out for this reason. No git-ui utility class can work until this prerequisite
lands:

1. Add `@tailwindcss/vite` to `packages/git-ui/vite.config.ts`.
2. Add `packages/git-ui/src/theme/tailwind.css`, imported from `main.ts`:
   `@import "tailwindcss/theme" layer(theme) prefix(kv); @import "tailwindcss/utilities"
   layer(utilities) prefix(kv);`, with no preflight. The VS Code webview relies on its defaults,
   and Space already ships preflight. Add `@source` for `../` and `../../kira-ui/src`.
   - Add an `@theme` block mapping `--color-*` to `--kv-*` colours, `--spacing-*` to the runtime
     `--kv-h-*`/`--kv-control-h*`, and `--text-*` to `--kv-t-*`.
   - `--kv-s-*` already equals the default scale.
3. Use the `kv` prefix. git-ui mounts into the same document as Kira Space's app. Unprefixed
   utilities from two separate compiled roots would duplicate and could order differently.
   Space's own vite already runs the Tailwind plugin, so it compiles this entry as a second root.
4. Convert `controls.css` into cva variants inside the `Kui*` components (the shadcn
   extension-point pattern): `.kui-button` and its `--active/--icon/--primary/--danger` modifiers,
   `.kui-row`, `.kui-text-input`, `.kui-menu-*`, `.kui-tooltip`, `.kui-popover*`, `.kui-modal*`,
   `.kui-segmented*`, `.kui-search-input*`, `.kui-select*`.
   - git-ui templates use `kui-*` classes directly in 22 files: `kui-row` 17 times, `kui-button`
     6 times, plus tooltip-directive markup. Those move to the components or to prefixed
     utilities.
5. Convert the 44 git-ui blocks. `CommitGrid.vue` (146 declarations), `ReviewView.vue` (134),
   `App.vue` (105), `CommitMeta.vue` (96) and `FileTree.vue` (96) account for 40%.
6. Visual changes to disclose:
   - `AppToolbar.vue`'s `kv-remote-progress-spin` and `RefreshButton.vue`'s `kv-refresh-spin`
     (1.5s `steps(30)`) versus `animate-spin` (1s linear). The stepped rotation becomes smooth
     and faster. Alternatively, add an exact `@theme` animation.
   - `StashList.vue` and similar use em-based literals (`font-size: 0.8em; padding: 0 0.4em;
     border-radius: 3px`) with no token. The nearest `--kv-t-*`/`--kv-s-*`/`--kv-radius` step
     differs by 1-2px.

After this phase, what stays in git-ui: the token files, `app-shell.css`'s checkbox
pseudo-elements, `@font-face` in `codicon.css`, and `App.vue:2217`'s `width: v-bind(detailWidthPx)`
(runtime; it could become an inline `:style` but not a class).

A cheaper interim for the VS Code build: none. Without a Tailwind pass over git-ui's own sources,
a utility in its templates generates nothing in the webview.

---

## 6. Do not migrate (category 3)

| Item | Reason |
|---|---|
| `packages/theme/src/tokens.css` (238), `kui-bridge.css` (69), `vscode-bridge.css` (109), `shadcn-bridge.css` (93) | Custom-property definitions and cross-vocabulary mappings. A utility sets a property on an element; it cannot define a token. |
| git-ui `vscode-tokens.css` (269), `kira-structure.css` (82), `density.css` (26), `kui-bridge.css` (65) | Same. They also read `--vscode-*`, set by the VS Code host at runtime. |
| `base.css` `@theme`, `html/body/#app` rules, `::-webkit-scrollbar*` theming | `@theme` is Tailwind config. The scrollbar rules style browser pseudo-elements on every scroller app-wide, and no utility applies globally. `margin: 0` on html/body duplicates preflight (body only); the rest (`height: 100%`, `overflow: hidden`, `user-select: none`, font/colour) is app-specific. Dropping `margin: 0` saves one line. |
| `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` (740) | Themes SlickGrid's JS-built DOM and must override `slick.grid.css`, which is unlayered. Layered utilities would lose to it, and the grid's cells are not Vue templates. |
| `packages/theme/src/review-decorations.css` glyph and line rules, `blame-annotation.css` (9) | Monaco decoration classes, applied by `glyphMarginClassName`/`inlineClassName` inside Monaco's DOM. Monaco's own stylesheet is unlayered and targets the same nodes. The class names also serve as test selectors (`.kira-blame-inline` in `repo-workspace.spec.ts`). Exception: `.kira-review-load-error*` is a plain `domNode` built in `reviewDecorations.ts:211-218`. Its `className` string could carry utilities (category 2: `12px` becomes `text-kira-md`, which scales with the Appearance font size). |
| `MonacoHost.vue`, `OperationsPanel.vue`, `ResponseDiffDialog.vue` `:deep`/`:global(.monaco-*)` rules | Monaco-owned DOM (`.monaco-hover`, `.suggest-widget`, `.monaco-diff-editor`). No template to put classes on. |
| `.kira-ed-var*` decoration rules in `MonacoHost.vue`/`AutocompleteField.vue` | Decoration class names consumed by Monaco and by a mirrored overlay rendered from strings. The colours could use §4 theme entries inside the CSS, but the selectors stay. |
| `apps/kira-space/frontend/src/views/repo/RepoFileView.vue` 28 `:deep` rules | Style `v-html` markdown output, which has no template. `@tailwindcss/typography` (MIT) with a `prose` override is the Tailwind path. It is category 2 at best: its defaults differ in every heading size, list indent and code block, and it adds a dependency. |
| `primitives.css` `.p-input.is-grow` grid-replica auto-grow (`::after { content: attr(data-value) }`) | The utility replacement, `field-sizing-content`, is Chromium-only (`primitives.css:152`); the app also ships on WebKitGTK/WKWebView. The replica trick also needs a custom property ladder (`--grow-lh`, `--grow-rows`) and a `max(0px, calc(…))` padding that would be an unreadable arbitrary value. Revisit when WebKit ships `field-sizing`. |
| `primitives.css` `.p-input input[type=number]::-webkit-*-spin-button` | Vendor pseudo-elements. `[&::-webkit-inner-spin-button]:appearance-none` would compile, but only on the inner input, which belongs to a child component. Keep it in CSS until `.p-input` is a component (§3.8); then it moves into that component's class list. |
| `primitives.css` `@keyframes p-spin` | Backs `--animate-kira-spin` in `@theme`. Keyframes are CSS by definition. |
| git-ui `app-shell.css` checkbox `::after`, `:indeterminate`, `:checked` styling | A drawn checkmark on a native checkbox needs a pseudo-element with `content`, per state. That is possible with `after:` utilities, but at about 12 stacked variants per element it is less readable than the CSS, and it only exists until git-ui adopts a `KuiCheckbox`. |
| git-ui `codicon.css` `@font-face` | Font registration. Not a style on an element. |
| git-ui `App.vue` `v-bind(detailWidthPx)` | Runtime width. |
| `docs/design/kira-design-system/parts/_style.css`, `apps/kira-studio/tests/visual/support/pin-fonts.css` | Out of scope: a design reference and test support, not shipped UI. |

---

## 7. Inventory

### 7.1 Plain CSS files

| File | Lines | Kind | Category |
|---|---|---|---|
| `packages/theme/src/primitives.css` | 1,013 | global, unlayered | 1 (~620), 2 (~250), 3 (~140); §3.6, §3.8, §6 |
| `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` | 740 | global, third-party DOM | 3 |
| `packages/kira-ui/src/theme/controls.css` | 549 | global | 2 (needs git-ui build) |
| `packages/git-ui/src/theme/vscode-tokens.css` | 269 | tokens | 3 |
| `packages/theme/src/tokens.css` | 238 | tokens | 3 |
| `packages/workbench/src/workbench.css` | 164 | global, unlayered | 1; §3.5 |
| `packages/theme/src/base.css` | 147 | Tailwind root, `@theme`, globals | 3 (one preflight duplicate) |
| `packages/git-ui/src/theme/app-shell.css` | 109 | global | 2 (~40 lines), 3 (checkbox) |
| `packages/theme/src/vscode-bridge.css` | 109 | tokens | 3 |
| `packages/theme/src/shadcn-bridge.css` | 93 | tokens, `@theme inline` | 3 |
| `packages/git-ui/src/theme/kira-structure.css` | 82 | tokens | 3 |
| `packages/theme/src/kui-bridge.css` | 69 | tokens | 3 |
| `packages/theme/src/review-decorations.css` | 65 | Monaco decorations | 3 (load-error part 2) |
| `packages/git-ui/src/theme/kui-bridge.css` | 65 | tokens | 3 |
| `packages/git-ui/src/theme/density.css` | 26 | tokens | 3 |
| `packages/git-ui/src/icons/codicon.css` | 15 | `@font-face` | 3 |
| `packages/theme/src/blame-annotation.css` | 9 | Monaco decoration | 3 |

### 7.2 Vue `<style>` blocks

Lines are non-blank lines in the block. "Raw decls" counts declarations outside `@apply`. Path
prefixes: `studio/` is `apps/kira-studio/frontend/src/`, `space/` is
`apps/kira-space/frontend/src/`, and the rest are under `packages/`. "1 (@apply)" means already
Tailwind; only the move into the template remains (§3.10).

| Block | Lines | Raw decls | Kind | Category |
|---|---|---|---|---|
| `git-ui/src/App.vue` | 155 | 105 | global, raw; v-bind | 2 (needs git-ui build) + 3 (v-bind width) |
| `git-ui/src/components/AppToolbar.vue` | 100 | 52 | global, raw; @keyframes | 2 (needs git-ui build; spin timing) |
| `git-ui/src/components/BranchPicker.vue` | 130 | 67 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/CommitGrid.vue` | 422 | 146 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/CommitMeta.vue` | 183 | 96 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/ConflictBanner.vue` | 52 | 22 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/ConnectionBanner.vue` | 19 | 11 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/DetailPane.vue` | 40 | 21 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/EmptyRepositoryPanel.vue` | 20 | 14 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/FileTree.vue` | 197 | 96 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/GitBlockedPanel.vue` | 25 | 17 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/GlobalStashList.vue` | 6 | 3 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/LoadMoreButton.vue` | 14 | 7 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/NoRepositoryPanel.vue` | 44 | 30 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/PullStrategyPicker.vue` | 19 | 8 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/RefreshButton.vue` | 25 | 13 | global, raw; @keyframes | 2 (needs git-ui build; spin timing) |
| `git-ui/src/components/SearchBox.vue` | 56 | 27 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/SearchResults.vue` | 77 | 45 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/StackList.vue` | 52 | 32 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/StashDetailPane.vue` | 28 | 15 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/StashList.vue` | 41 | 26 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/TagList.vue` | 21 | 13 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/UncommittedChangesStrip.vue` | 39 | 27 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/UndoButton.vue` | 14 | 7 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/WorkingDetailPane.vue` | 21 | 13 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/WorktreeList.vue` | 35 | 21 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/BranchDialog.vue` | 25 | 14 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/CheckoutDialog.vue` | 11 | 7 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/CherryPickDialog.vue` | 27 | 13 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/ForcePushDialog.vue` | 35 | 21 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/PullDialog.vue` | 3 | 1 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/RenameRefDialog.vue` | 20 | 12 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/RepoSettingsDialog.vue` | 40 | 24 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/ResetDialog.vue` | 55 | 33 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/RevertDialog.vue` | 35 | 19 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/StackDialog.vue` | 28 | 17 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/StashDialog.vue` | 38 | 22 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/TagDialog.vue` | 25 | 14 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/dialogs/WorktreeDialog.vue` | 41 | 26 | scoped, raw | 2 (needs git-ui build) |
| `git-ui/src/components/review/BaseSelector.vue` | 57 | 28 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/review/ReviewCommentsPane.vue` | 93 | 51 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/review/ReviewCommitRow.vue` | 107 | 56 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/review/ReviewFilesPane.vue` | 25 | 14 | global, raw | 2 (needs git-ui build) |
| `git-ui/src/components/review/ReviewView.vue` | 231 | 134 | global, raw | 2 (needs git-ui build) |
| `space/repo/GitPanel.vue` | 93 | 2 | scoped, mixed | 1 |
| `space/repo/GitStart.vue` | 10 | 0 | scoped, @apply only | 1 (@apply) |
| `space/repo/RepoFileTree.vue` | 10 | 0 | scoped, @apply only | 1 (@apply) |
| `space/repo/RepoReviewView.vue` | 4 | 0 | scoped, @apply only | 1 (@apply) |
| `space/repo/RepoSearchRow.vue` | 43 | 8 | scoped, mixed | 1 + theme ext (search-match) |
| `space/repo/RepoSearchView.vue` | 25 | 0 | scoped, @apply only | 1 (@apply) |
| `space/repo/RepoTreeRow.vue` | 41 | 6 | scoped, mixed | 1 |
| `space/views/repo/RepoDiffView.vue` | 10 | 0 | scoped, @apply only | 1 (@apply) |
| `space/views/repo/RepoFileView.vue` | 96 | 0 | scoped, @apply only; :deep | 3 (v-html markdown) |
| `space/views/repo/RepoGraphView.vue` | 4 | 0 | scoped, @apply only | 1 (@apply) |
| `space/views/repo/RepoMultiDiffView.vue` | 19 | 0 | scoped, @apply only | 1 (@apply) |
| `space/views/repo/ReviewThread.vue` | 20 | 0 | scoped, @apply only | 1 (@apply) |
| `space/workbench/SettingsDialog.vue` | 60 | 15 | global, mixed | 1 (global; move to panes) |
| `space/workbench/StatusBar.vue` | 18 | 2 | scoped, mixed | 1 |
| `studio/api/BulkVariablesEditor.vue` | 13 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/CollectionRow.vue` | 36 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/CollectionsPanel.vue` | 29 | 1 | scoped, mixed | 1 |
| `studio/api/CollectionsTree.vue` | 16 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/DynamicValuesDialog.vue` | 18 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/EditRawRequestDialog.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/EnvironmentSelect.vue` | 22 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/EnvironmentsView.vue` | 23 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/ImportCurlDialog.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/ImportReportStrip.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/MethodSelect.vue` | 22 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/VariableHistoryMenu.vue` | 25 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/api/VariableRow.vue` | 33 | 1 | scoped, mixed | 1 |
| `studio/api/VariableSetView.vue` | 40 | 3 | scoped, mixed | 1 + swatch @utility |
| `studio/api/VariablesOverviewPanel.vue` | 48 | 3 | scoped, mixed | 1 |
| `studio/editor/MonacoHost.vue` | 58 | 18 | scoped, mixed; :deep | 1 + 3 (Monaco DOM) |
| `studio/project/ConnectionDialog.vue` | 234 | 123 | scoped, mixed | 1 + swatch @utility |
| `studio/project/DataGripImportDialog.vue` | 57 | 13 | scoped, mixed | 1 |
| `studio/project/ErrorPopover.vue` | 35 | 10 | scoped, mixed | 1 |
| `studio/project/FiltersDialog.vue` | 86 | 22 | scoped, mixed | 1 |
| `studio/project/ProjectTree.vue` | 25 | 2 | scoped, mixed | 1 |
| `studio/project/SchemaDialog.vue` | 29 | 9 | scoped, mixed | 1 |
| `studio/project/TreeRow.vue` | 76 | 20 | scoped, mixed; @keyframes | 2 (pulse timing) |
| `studio/shortcuts/CommandPalette.vue` | 10 | 1 | scoped, mixed | 1 |
| `studio/terminal/TerminalPanel.vue` | 40 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/terminal/TerminalStart.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/browse/BrowseView.vue` | 89 | 3 | scoped, mixed | 1 |
| `studio/views/console/ConsoleResultGrid.vue` | 66 | 2 | scoped, mixed; :deep | 1 + theme ext (search-match) |
| `studio/views/console/ConsoleSavedMenu.vue` | 6 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/console/ConsoleView.vue` | 116 | 5 | scoped, mixed; pseudo-el | 1 |
| `studio/views/console/ExplainResultView.vue` | 66 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/definition/ColumnsSection.vue` | 36 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/definition/ConstraintsSection.vue` | 26 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/definition/DefinitionView.vue` | 16 | 1 | scoped, mixed | 1 |
| `studio/views/definition/IndexesSection.vue` | 12 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/definition/PropertiesSection.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/definition/ValidationSection.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/documents/DocumentView.vue` | 81 | 1 | scoped, mixed; :deep | 1 |
| `studio/views/documents/ProjectionMenu.vue` | 19 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/grid/ColumnsMenu.vue` | 25 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/grid/DataToolbar.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/grid/DataView.vue` | 44 | 4 | scoped, mixed | 1 |
| `studio/views/grid/FilterToolbar.vue` | 21 | 0 | scoped, @apply only; :deep | 1 (@apply) + 3 (:deep into child) |
| `studio/views/grid/FkPreviewPopover.vue` | 56 | 3 | scoped, mixed; @keyframes | 1 |
| `studio/views/grid/PreviewCommandPanel.vue` | 17 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/grpcrequest/CallHistoryList.vue` | 29 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/grpcrequest/GrpcRequestView.vue` | 52 | 3 | scoped, mixed; :deep | 1 |
| `studio/views/grpcrequest/ResponsePane.vue` | 57 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/grpcrequest/SchemaBrowser.vue` | 47 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/httprequest/CookiesPane.vue` | 39 | 1 | scoped, mixed | 1 |
| `studio/views/httprequest/FormDataTable.vue` | 12 | 0 | scoped, @apply only; :deep | 1 (@apply) + 3 (:deep into child) |
| `studio/views/httprequest/HttpRequestView.vue` | 50 | 3 | scoped, mixed; :deep | 1 |
| `studio/views/httprequest/RawExchangePane.vue` | 19 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/httprequest/RequestBodyPane.vue` | 10 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/httprequest/RequestSettingsPane.vue` | 28 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/httprequest/ResponseDiffDialog.vue` | 56 | 2 | scoped, mixed; :deep | 1 + 3 (Monaco diff DOM) |
| `studio/views/httprequest/ResponseHistoryList.vue` | 38 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/httprequest/ResponsePane.vue` | 39 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/httprequest/TimelinePane.vue` | 62 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/keyvalue/KeyValueView.vue` | 4 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/AutocompleteField.vue` | 67 | 24 | scoped, raw; :deep | 1 + 3 (decoration spans) |
| `studio/views/shared/DateTimePicker.vue` | 44 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/EditBufferActions.vue` | 4 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/FilterHistoryMenu.vue` | 6 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/ResponseFindBar.vue` | 10 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/SavedListMenu.vue` | 27 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/celleditor/CellEditorDock.vue` | 4 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/celleditor/CellEditorView.vue` | 65 | 2 | scoped, mixed | 1 |
| `studio/views/shared/celleditor/TimestampPane.vue` | 30 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/shared/document/DocumentRow.vue` | 40 | 3 | scoped, mixed | 1 + theme ext (search-match) |
| `studio/views/shared/document/DocumentTree.vue` | 47 | 8 | scoped, mixed; pseudo-el | 1 + theme ext (syntax-*) |
| `studio/views/shared/fields/FieldRowsTable.vue` | 22 | 0 | scoped, @apply only; :deep | 1 (@apply) + 3 (:deep into child) |
| `studio/views/shared/keyvalue/KeyValuePane.vue` | 98 | 5 | scoped, mixed | 1 + theme ext (search-match) |
| `studio/views/shared/page/PagerControls.vue` | 21 | 0 | scoped, @apply only; :deep | 1 (@apply) + 3 (:deep into child) |
| `studio/views/shared/page/SearchToolbar.vue` | 13 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/stream/StreamComposeMessage.vue` | 22 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/stream/StreamSearchToolbar.vue` | 10 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/views/stream/StreamView.vue` | 142 | 5 | scoped, mixed | 1 + theme ext (search-match) |
| `studio/views/terminal/TerminalView.vue` | 7 | 0 | scoped, @apply only | 1 (@apply) |
| `studio/workbench/DbMcpApprovalDialog.vue` | 24 | 9 | scoped, mixed | 1 |
| `studio/workbench/GenerateDataDialog.vue` | 51 | 9 | scoped, mixed | 1 |
| `studio/workbench/SettingsDialog.vue` | 157 | 47 | global, mixed | 1 (global; move to panes) |
| `studio/workbench/StatusBar.vue` | 27 | 4 | scoped, mixed | 1 |
| `studio/workbench/TitleBar.vue` | 32 | 6 | scoped, mixed | 1 |
| `studio/workbench/panels/OperationsPanel.vue` | 99 | 26 | scoped, mixed; :deep | 1 + 3 (Monaco DOM) |
| `studio/workbench/panels/StudioStart.vue` | 57 | 17 | scoped, mixed | 1 |
| `studio/workbench/settings/ScriptsPane.vue` | 12 | 2 | scoped, raw | 1 + swatch @utility |
| `workbench/src/components/TabStrip.vue` | 93 | 20 | scoped, mixed; pseudo-el | 1 |
| `workbench/src/components/TitleBar.vue` | 16 | 10 | scoped, raw | 1 + theme ext (titlebar-h) |
| `workbench/src/components/WorkbenchShell.vue` | 35 | 23 | scoped, raw | 1 + theme ext (tabbar/statusbar-h) |
| `workbench/src/prompt/TextPromptDialog.vue` | 14 | 1 | scoped, mixed | 1 |
| `workbench/src/terminal/TerminalHostView.vue` | 13 | 0 | scoped, @apply only | 1 (@apply) |

---

## 8. Scope estimate

A rough estimate for the full migration, all categories 1 and 2:

| Work | Files touched | CSS lines removed |
|---|---|---|
| §3.1-3.3 inline styles and bindings | 24 | 30 attributes (no CSS lines) |
| §2 bug fixes (delete `.p-run-state*`, convert `.p-panel-head`) | 16 | ~50 |
| §3.5 `workbench.css` | ~20 | 164 (whole file, bar the two `@import`/`@source` lines) |
| §3.6 alias classes | 110 + 11 specs | ~35 |
| §3.7 raw-declaration blocks, Studio/Space/workbench | 47 | ~2,400 of 2,756 (residual 3: Monaco, `v-html`) |
| §3.8 primitive components | ~120 | ~850 of 1,013 |
| §3.9 shared patterns | ~35 | ~200, overlapping §3.7 |
| §3.10 `@apply`-only blocks | 59 | 1,268 |
| §4 theme entries | 2 (`base.css`, `tokens.css`) | adds ~15 |
| §5 git-ui/kira-ui prerequisite plus conversion | ~70 | ~2,700 of 2,731 in blocks, plus ~500 of 549 in `controls.css` and ~40 in `app-shell.css` |

Total: about 250 distinct files and about 8,000 CSS lines removed. Template class strings grow by
roughly half that in characters, so this is a net reduction but not a free one.

Suggested phasing, each phase its own `SPEC.md` row:

1. §2 bugs plus §3.1-3.3 (small, exact, fixes real defects).
2. §3.5 plus §3.6 plus §4.
3. §3.7 plus §3.9.
4. §3.8.
5. §5 prerequisite.
6. §5 conversion.
7. §3.10 opportunistically.

The `layer(components)` import (§2.3) fits in phase 1 if its audit is quick.

---

## 9. Method

- Every `<style>` block in the surveyed trees was parsed by a script. It recorded block size,
  scoped or global, `@apply` count, raw declarations, `:deep`/`:global`, `@keyframes`,
  pseudo-elements and `v-bind`. That gave 150 blocks and 6,755 lines. An awk pass that had
  counted a commented-out `<style` string in `SlickGridHost.vue` as a 444-line block was
  discarded.
- Class-consumer counts come from a scripted grep over templates and TS. Generic names (e.g.
  `list`, `key`) were not counted. CodeGraph resolves component-level blast radius but does not
  index CSS class strings, so the class counts above are grep-based.
- CodeGraph (`codegraph_explore`, 5 calls) was used for:
  - primitive-class consumer components;
  - git-ui's mount path into Kira Space (`loadGitUi`, `main.ts`, `GitPanel`);
  - the floating-position helpers, to confirm runtime positioning is library-backed;
  - the git-ui module entry and host options;
  - the blast radius of the shared settings-field components, `SettingsShell`, `TitleBar` and
    `WorkbenchShell`, before recommending the removal of `workbench.css`'s shared classes.
- Every utility named here was compiled in a scratch Tailwind 4.3.3 harness against the repo's
  `@theme` blocks.
