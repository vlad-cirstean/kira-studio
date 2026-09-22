# P104 — delete every hand-rolled UI primitive; normalize spacing onto Tailwind's scale

Plan for `docs/v1.9/SPEC.md`'s P104 row. Written against the tree at `c11cebc` (P103 Part 4
landed). Implementation runs as **two parallel Sonnet streams** (§8), which is the only split the
user authorized — never one, never three.

One rule governs everything below: **no hand-rolled fallback, for any component.** Scale of effort
and "functionality must be reimplemented, not ported" are never grounds to defer a call site or
keep an old implementation. The three cases P99 declined (`Checkbox`, `ContextMenu`, `AppTooltip`)
are reopened and solved here on reka-ui/shadcn-vue primitives (§4, §5, §6).

---

## 0. What SPEC leaves open, and how each is resolved

| Open point | Resolution | Where |
|---|---|---|
| Which `components/ui/*` set replaces which primitive | Full 20-primitive map; every set gets a real app-level importer or is deleted from the repo | §3 |
| `Checkbox` vs Playwright | `CheckboxRoot` adopted; 25 `input[type=checkbox]` selectors and 21 `check/uncheck/toBeChecked` calls migrate to `[role=checkbox]` + `getByRole` | §4 |
| Point-anchored singleton `ContextMenu` | `DropdownMenuRoot` controlled, anchored by a 0×0 fixed `DropdownMenuTrigger` at (x, y) — the shape reka's own `ContextMenuTrigger` uses | §5 |
| Tooltip directive + disabled-element hover | Directive deleted; per-call-site `Tooltip`/`TooltipTrigger`/`TooltipContent`; disabled controls wrapped in a focusable `<span tabindex="0">`; SlickGrid's non-Vue header cells keep an attribute path driven by the same reka `TooltipRoot` context | §6 |
| "Extend `@theme` as needed" | Raw scale steps convert to Tailwind's default numeric scale (exact px, no `@theme` entry); role/runtime tokens get named `@theme` entries so they stay indirect | §7 |
| Two-way split | By subsystem, not by app — 89/63 files, 143/148 tooltip sites, 225/285 bracket utilities | §8 |

---

## 1. Confirmed current state (measured, not inherited from P99)

### 1.1 Method

Every count below comes from a grep over the tree at `c11cebc`, across
`apps/kira-studio/frontend/src`, `apps/kira-space/frontend/src`, `packages/workbench/src` and
`packages/theme/src`. P99's own figures (425 utilities / 115 files) are stale: P100 extracted Kira
Space, P103 hoisted the shared base, and both moved and deduped files since.

### 1.2 Twenty hand-rolled primitives, in two directories

`packages/theme/src/primitives/` — shared, both apps (12 `.vue`, 992 lines):

| Primitive | Lines | Importer files (studio / space / workbench / theme) |
|---|---|---|
| `IconButton.vue` | 51 | 53 / 7 / 0 / 2 |
| `AppButton.vue` | 77 | 47 / 8 / 1 / 0 |
| `TextField.vue` | 146 | 30 / 5 / 0 / 1 |
| `EmptyState.vue` | 22 | 22 / 6 / 0 / 0 |
| `Checkbox.vue` | 57 | 15 / 1 / 0 / 0 |
| `SegmentedControl.vue` | 45 | 14 / 2 / 0 / 0 |
| `DialogFrame.vue` | 80 | 13 / 2 / 2 / 0 |
| `PanelSearchBox.vue` | 55 | 13 / 0 / 0 / 1 |
| `VirtualList.vue` | 184 | 7 / 1 / 0 / 2 |
| `PanelSplitter.vue` | 85 | 4 / 0 / 1 / 0 |
| `PanelShell.vue` | 110 | 3 / 1 / 0 / 0 |
| `TreeHost.vue` | 80 | 2 / 1 / 0 / 0 |

`apps/kira-studio/frontend/src/theme/primitives/` — Kira Studio only, never hoisted (8 `.vue`):

| Primitive | Importer files |
|---|---|
| `MessageStrip.vue` | 26 |
| `PopoverPanel.vue` | 14 |
| `ViewChrome.vue` | 11 |
| `AutocompleteField.vue` | 7 |
| `ReconnectGate.vue` | 6 |
| `ColorPicker.vue` | 3 |
| `RunState.vue` | 1 |
| `ViewHeader.vue` | 1 |

Under them sits `packages/theme/src/primitives.css` — **1,173 lines** of global `.p-*` rules (57
classes) carrying the real geometry and colour for `.p-btn`, `.p-dlgbtn`, `.p-iconbtn`, `.p-input`,
`.p-check`, `.p-seg`, `.p-empty`, `.p-float`, `.p-row`, `.p-sep` and the rest. This file is the
other half of the hand-rolled layer: P99 added Tailwind utilities *beside* these rules without
deleting them.

**Measured consequence, load-bearing for this phase.** `AppButton`'s primary variant emits
`bg-accent text-accent-fg`. `--color-accent` resolves through `shadcn-bridge.css` to
`--kira-hover` (shadcn's menu-hover surface, not the brand colour — that file's own comment says
so), and `--color-accent-fg` **exists nowhere**, so `text-accent-fg` (8 usages) generates no CSS at
all. Today `.p-btn.primary`/`.p-dlgbtn.primary` in `primitives.css` supply the real
`--kira-accent`/`--kira-accent-fg` and mask both faults. Deleting those rules exposes them. Brand
accent converts to `bg-primary` / `text-primary-foreground` (the bridge's own `--primary`), never
`bg-accent`.

### 1.3 The `components/ui/*` set: 17 directories, zero app-level importers

`grep -rn "components/ui" apps packages` outside `packages/theme/src/components/ui/` itself returns
**nothing**. One file in the whole repo imports reka-ui directly: `primitives/DialogFrame.vue`. The
SPEC row's premise holds exactly.

The set is 17 directories (`alert`, `button`, `checkbox`, `command`, `context-menu`, `dialog`,
`dropdown-menu`, `input`, `input-group`, `label`, `popover`, `scroll-area`, `separator`, `textarea`,
`toggle`, `toggle-group`, `tooltip`), not the 18 the SPEC row states — the row counted files or
sub-parts. Use 17.

### 1.4 Arbitrary-bracket utilities: 510 occurrences across 98 files

By token, inside `[...]` only:

| Token group | Occurrences | Disposition (§7) |
|---|---|---|
| `--kira-s-1` … `--kira-s-6` | 346 | Tailwind default scale, exact px |
| `--kira-t-xs` … `--kira-t-xl` | 70 | `@theme --text-kira-*` (runtime-adjustable, stays indirect) |
| `--kira-font-data` / `--kira-font-ui` | 20 | `@theme --font-data` / `--font-ui` |
| `--kira-radius-sm` | 15 | `rounded-kira-sm` (already in `@theme`) |
| `--kira-accent` / `--kira-accent-fg` / `--kira-focus` / `--kira-state-on` / `--kira-bg-chrome` / `--kira-search-match` | 21 | existing colour utilities |
| `--kira-h-*` / `--kira-icon-box` / `--kira-control-inline-h` | 11 | Tailwind default scale, exact px |
| `--kira-control-h` / `--kira-control-h-lg` / `--kira-row-height` | 15 | `@theme --spacing-control*` / `--spacing-row` |
| `--kira-z-*` | 6 | stays bracketed (§2.2) |
| `--kira-shadow-dialog` | 2 | `@theme --shadow-kira-dialog` |
| `--kira-border-width` / `--kira-font-size` | 2 | `border` / `text-kira-md` |

### 1.5 The tooltip directive

`v-tooltip` is registered once per app in `main.ts` from `useTooltipStore().vTooltip`
(`packages/workbench/src/state/tooltip.ts`, 328 lines). Usage:

| Tree | Files | `v-tooltip` occurrences |
|---|---|---|
| `apps/kira-studio/frontend/src` | 74 | 249 |
| `apps/kira-space/frontend/src` | 12 | 33 |
| `packages/workbench/src` | 2 | 4 |
| `packages/theme/src` | 4 | 5 |
| **Total** | **92** | **291** |

Two further writers set `data-kira-tip`/`data-kira-tip-parts` **by hand on non-Vue DOM**:
`views/grid/SlickGridHost.vue`'s and `views/console/ConsoleSlickGrid.vue`'s `tooltipAttrs()`,
spread into SlickGrid's `headerCellAttrs` — a static attribute bag on DOM SlickGrid owns. No Vue
component can wrap those cells. §6.4 handles them.

50 of the 92 files also contain `disabled`; 85 `v-tooltip` occurrences sit within four lines of a
`disabled` binding — an upper bound on how many triggers need §6.3's focusable wrapper.

### 1.6 Test-selector exposure (the real migration cost, measured)

| Selector | Occurrences in `apps/*/tests` |
|---|---|
| `data-kira-tip` attribute assertions | ~60 across 17 spec files |
| `input[type=checkbox]` | 25 |
| `.check()` / `.uncheck()` / `toBeChecked()` | 21 |
| `.p-input` | 8 |
| `.icon-box` | 8 |
| `.p-btn` / `.p-dlgbtn` / `.p-iconbtn` / `.p-empty` | 5 |
| `.p-check` / `.p-seg` / `.p-count` / `.p-float` | 0 |

The SPEC row's "~331 class-based Playwright selectors" figure is P103's count of **settings-pane**
selectors, not primitive-marker selectors. Marker-class exposure is 21 occurrences total. The real
volume is the tooltip attribute assertions and the checkbox selectors.

### 1.7 Files this phase opens

152 files match at least one of the three triggers (primitive import, bracket utility, `v-tooltip`):

| Tree | Files |
|---|---|
| `apps/kira-studio/frontend/src` | 111 |
| `apps/kira-space/frontend/src` | 23 |
| `packages/theme/src` | 10 |
| `packages/workbench/src` | 8 |

`packages/theme` does render UI — it holds all 12 shared primitives, `CodiconIcon.vue` and the
whole `components/ui/*` set. It is not tokens-only. `packages/git-ui` and `packages/kira-ui` are
out of scope: neither has a Tailwind build, neither imports `@theme/primitives/*`, and P99 already
excluded both for the same reason.

---

## 2. Scope decision

### 2.1 In scope

1. Delete all 20 hand-rolled primitive components; repoint every call site at `components/ui/*`.
2. Delete every `.p-*` rule in `primitives.css` that only existed to style a deleted primitive.
3. Convert all 510 arbitrary-bracket utilities per §7, in the same edit as the file's primitive swap.
4. Extend `packages/theme/src/base.css`'s `@theme` block (§7.2).
5. Solve the three reopened hard cases (§4, §5, §6).
6. Migrate every test selector §1.6 names.
7. Re-record the five `test:visual` baselines with a per-spec reason.

### 2.2 Declined, each with the requirement named

- **`--kira-z-*` stays bracketed** (6 occurrences). Tailwind v4 has no `z-index` theme namespace —
  `--z-*` is not a namespace it reads — so a named utility is not expressible. The five-tier z
  ladder (`popover` 100 → `tooltip` 400) is a real ordering contract. `z-[var(--kira-z-tooltip)]`
  stays. Not a spacing/sizing utility, so outside the SPEC row's own conversion axis either way.
- **Type, row-height and control-density tokens stay var-backed** (`--kira-t-*`, `--kira-row-height`,
  `--kira-control-h*`). `--kira-font-size` and `--kira-row-height` are **overwritten at runtime from
  the Appearance settings** (`tokens.css`'s own comment; `--kira-t-*` are `calc()` offsets from
  `--kira-font-size`). A static Tailwind step would freeze the user's font-size and density
  settings. They become named `@theme` entries instead, so call sites use `text-kira-sm` / `h-row` /
  `h-control` — real utilities, no brackets, indirection intact.
- **Native `<select>` (20 files) stays native.** No `select` set was fetched into
  `components/ui/`, and a platform control is not a hand-rolled primitive. Its `.p-select` styling
  moves to utilities; the element does not change. Same for the `<input>` inside `Input.vue` and
  `<textarea>` inside `Textarea.vue`.
- **`components/ui/scroll-area` is deleted, not adopted.** Its whole job is replacing native
  scrollbars with a JS-driven overlay; this app scrolls through SlickGrid's own scroll engine,
  `VirtualList`'s viewport and Monaco, each owning its own scrolling, and `base.css` already themes
  `::-webkit-scrollbar` globally. Deleting an unused fetched set satisfies the row's "nothing
  fetched-but-unused left behind" as directly as adopting it does, and leaves no hand-rolled
  fallback behind (nothing is hand-rolled here — the native scrollbar stays native).

### 2.3 Not in scope, confirmed not forgotten

- P105's a11y findings. This phase records what its component choices change for P105 (§10.4); it
  fixes no finding and does not touch `biome.json`'s `a11y: off` override.
- `packages/git-ui` / `packages/kira-ui` (§1.7).
- Go, bridge and store code. This phase is `.vue`, `.css`, `.ts` view-layer only.

---

## 3. The primitive → `components/ui/*` map

Every row states the current public API and what it maps onto. Where the mapping is not 1:1, the
adaptation is named. shadcn-vue's own extension point for variants is the set's `index.ts` `cva`
call (`button/index.ts` already ships one) — extending *that* is standard shadcn practice and is
not a new wrapper layer.

| Primitive | Replacement | API mapping |
|---|---|---|
| `AppButton` | `ui/button` `Button` | `kind: 'toolbar' \| 'dialog'` and `variant: 'default' \| 'primary' \| 'danger'` collapse into `buttonVariants`' own `variant`; add `toolbar`, `toolbar-primary`, `dialog`, `dialog-primary`, `danger` variants plus `kira` / `kira-lg` sizes carrying `h-control` / `h-control-lg`. `icon` prop → a `<CodiconIcon>` in the default slot. `count` → a `<span>` in the slot. `active` → `data-active` + a variant class. |
| `IconButton` | `ui/button` `Button` | `size="kira-icon"` (`size-control`). `icon`/`size` → `<CodiconIcon :size>` slot child. `active`/`tone`/`count`/`indicator` → variant + slot children. Fallthrough attrs already land on the `<button>` via `Primitive`. |
| `Checkbox` | `ui/checkbox` `Checkbox` | §4. `modelValue` → `v-model`; `indeterminate` → reka's `'indeterminate'` model value; `disabled` → `disabled`. |
| `TextField` | `ui/input` + `ui/input-group` | `icon`/`prefix` → `InputGroupAddon` + `InputGroupText`; number stepper → two `InputGroupButton`s (keep `stepUp`/`stepDown` + synthetic `input`/`change` dispatch); `grow` → `InputGroupTextarea`; `size`/`ui`/`invalid` → classes/`aria-invalid`. `wrapSelectionOnType`/`autoClosePairsOnType` stay — they are app keystroke behaviour, not a primitive. |
| `SegmentedControl` | `ui/toggle-group` | §3.1. |
| `DialogFrame` | `ui/dialog` | `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter`. Already reka-backed internally; this swaps to the real set. |
| `EmptyState` | `ui/alert` composition | `Alert` + `AlertTitle` + `AlertAction`, centred; icon via `CodiconIcon`. 28 call sites. |
| `MessageStrip` | `ui/alert` | Direct: `Alert`/`AlertTitle`/`AlertDescription`/`AlertAction`. 26 call sites. |
| `PopoverPanel` | `ui/popover` | `Popover`/`PopoverAnchor`/`PopoverContent`. Point/element anchoring via `PopoverAnchor :reference`. |
| `AutocompleteField` | reka `AutocompleteRoot` set | §3.2. |
| `PanelSearchBox` | `ui/input-group` composition | `InputGroup` + `InputGroupInput` + `InputGroupAddon`(search icon) + `InputGroupButton`(clear). Keeps `data-testid="tree-search"`. |
| `PanelSplitter` | reka `SplitterGroup`/`SplitterPanel`/`SplitterResizeHandle` | §3.3. |
| `VirtualList` | `@tanstack/vue-virtual` | §3.4. |
| `TreeHost` | `@tanstack/vue-virtual` + app row markup | Same virtualizer as `VirtualList`; `stickyBand.ts` and reveal-scroll stay (app behaviour over the virtualizer's own `scrollToIndex`). |
| `PanelShell` / `ViewChrome` / `ViewHeader` / `ReconnectGate` | inline composition | Layout containers, no library counterpart. Their markup inlines at call sites as Tailwind utilities over `components/ui` parts — nothing hand-rolled survives as a component. |
| `RunState` (1 site) / `ColorPicker` (3 sites) | inline composition | `RunState` is a status dot + label; `ColorPicker` is a swatch grid of `Button`s. |
| `workbench/ContextMenu.vue` | `ui/dropdown-menu` | §5. |
| `workbench/AppTooltip.vue` + directive | `ui/tooltip` | §6. |
| `shortcuts/CommandPalette.vue` | `ui/command` | `Command`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`/`CommandEmpty`. Its own ranking stays; the list chrome and keyboard model come from the set. |
| `.p-sep` | `ui/separator` | `Separator` with `orientation`. |
| `<label>` in dialogs (34 files) | `ui/label` | `Label` with `for`. Directly helps P105's `noLabelWithoutControl`. |
| `.p-textarea` (5 files) | `ui/textarea` | `Textarea`. |
| `IconButton` with `active` used as a toggle | `ui/toggle` | Where the call site is genuinely a two-state toggle, `Toggle` with `v-model:pressed`; otherwise `Button` + `data-active`. Decide per site. |
| `ui/scroll-area` | deleted | §2.2. |

### 3.1 `SegmentedControl` → `ToggleGroup`, keeping the generic

P99 declined `ToggleGroup` because `ToggleGroupItem`'s `value` is typed `string`, which would widen
every caller off its own literal union. That is a typing problem, not a capability gap, and it is
solved at the boundary rather than by keeping the component:

- Call sites keep their literal-union arrays. At the `ToggleGroupItem`, bind `:value="String(opt.value)"`.
- On `update:modelValue`, look the original option back up
  (`options.find(o => String(o.value) === next)`) and emit the **original, typed** value.
- `type="single"` plus a guard that ignores a `null` next value preserves the current
  "always exactly one selected" behaviour (reka allows deselect by clicking the active item).

No caller's type changes. If a call site's `value` set is not injective under `String()` (none is
today — check at conversion time), that site uses the option index as the item value instead.

### 3.2 `AutocompleteField` → reka `AutocompleteRoot`

P99 declined shadcn's `combobox` because its Listbox+Popover shape assumes single-select from a
closed list, while this field is free text with suggestions. reka-ui 2.10.5 ships a distinct
`Autocomplete*` family (`AutocompleteRoot`/`AutocompleteInput`/`AutocompleteContent`/
`AutocompleteItem`/`AutocompleteEmpty`/`AutocompletePortal`) whose `AutocompleteInput` is a real
text input and whose root supports free text — that is this field's own model. Use it directly (no
`components/ui` set exists for it; reka is the same dependency the whole set is built on). 7 call
sites, all Kira Studio.

### 3.3 `PanelSplitter` → reka Splitter

The current component hand-rolls pointer-drag maths and writes pixel sizes into the workbench grid
template. reka's `SplitterGroup`/`SplitterPanel`/`SplitterResizeHandle` own drag, keyboard resize,
min/max and collapse, and persist through `@update:layout` percentages. The conversion is a real
reimplementation: `WorkbenchShell.vue`'s CSS-grid column template becomes a `SplitterGroup` with
`SplitterPanel`s, and the persisted pixel sizes in the layout store migrate to percentages
(read old pixel values once, convert against the measured container width, write back percentages).
Stream A owns it end to end (§8), because both apps' shells and the layout store are involved.

### 3.4 `VirtualList` / `TreeHost` → `@tanstack/vue-virtual`

CLAUDE.md names "a virtualizer" as exactly the thing to take from a library. `@tanstack/vue-virtual`
is MIT, from the same family as the already-adopted `@tanstack/vue-query`, and has no paid tier —
it clears the open-source rule at package and feature level. Add it to root `package.json`'s
`dependencies` (P102's reachability rule: it is imported by shipped app code).

Both components keep their own row markup and their app-specific behaviour (`stickyBand.ts`'s
sticky group band, reveal-scroll with band inset, the tree's keyboard model) layered over the
virtualizer's `getVirtualItems()`/`scrollToIndex()`. Nothing about the virtualizer's own windowing
maths is re-implemented.

---

## 4. Hard case 1 — `Checkbox`

### 4.1 Decision

Adopt `components/ui/checkbox` (`CheckboxRoot` + `CheckboxIndicator`). No native
`<input type="checkbox">` anywhere — a hand-written styled `<input>` is itself the hand-rolled
primitive this phase removes, so it is not an option, not even as a fallback.

`CheckboxRoot` renders `<button role="checkbox" aria-checked>`. **This is not a Playwright
capability gap**: `.check()`, `.uncheck()`, `.toBeChecked()` and `getByRole('checkbox')` all act on
ARIA `role=checkbox` elements. Native `<form>` semantics (FormData, `:checked`) are irrelevant here
— this is a Vue SPA driving Wails RPC, with no form POST anywhere in the tree.

The real cost is narrower and entirely in the test suite.

### 4.2 Test migration, concretely

| What | Count | Change |
|---|---|---|
| `input[type=checkbox]` CSS selectors | 25 | `[role=checkbox]`, or the existing `data-testid` where the site already has one |
| `.check()` / `.uncheck()` | 5 | unchanged — they work on `role=checkbox` |
| `toBeChecked()` | 16 | unchanged — reads `aria-checked` |
| `:checked` CSS assertions / `.isChecked()` | 0 | none exist |

Preferred replacement is `getByRole('checkbox', { name })` where the site has an accessible name,
which is also Playwright's own recommendation; `[role=checkbox]` attribute selectors are the
mechanical fallback where a test targets a checkbox inside a known container.

### 4.3 Indeterminate

`FiltersDialog`'s object tree is the app's only indeterminate checkbox. reka models it as the model
value `'indeterminate'` rather than a DOM property, so `:indeterminate.prop` disappears and the call
site binds `:model-value="allOn ? true : someOn ? 'indeterminate' : false"`. `data-state` becomes
`indeterminate`; any test asserting the DOM property migrates to `toHaveAttribute('data-state',
'indeterminate')`.

### 4.4 Glyph

`components/ui/checkbox/Checkbox.vue` renders a lucide `CheckIcon` by default but exposes the
indicator's default slot. Pass `<CodiconIcon name="check" :size="10" />` (and `dash` for
indeterminate) so the app keeps one icon family. Same rule everywhere a fetched set defaults to a
lucide glyph.

### 4.5 P105 note

`role=checkbox` with `aria-checked` and a real focus ring is strictly better than the current
`<span>`-wrapped input for `useSemanticElements`/`useFocusableInteractive`. Flagged in §10.4.

---

## 5. Hard case 2 — `workbench/ContextMenu.vue`

### 5.1 The constraint

One shared singleton, opened imperatively from `useContextMenuStore()` at an arbitrary (x, y) —
a right-click on any of thousands of grid cells. Mounting a per-cell trigger component is a real
cost this app will not pay. reka's `ContextMenuRoot`/`DropdownMenuRoot` anchor to a trigger element.

### 5.2 The solve: reka's own point-anchor shape

Read `node_modules/reka-ui/dist/ContextMenu/ContextMenuTrigger.js`: reka's own context menu anchors
by rendering `MenuAnchor :reference="virtualEl"`, where `virtualEl` is
`{ getBoundingClientRect: () => ({ width: 0, height: 0, left: x, right: x, top: y, bottom: y }) }`.
The point-anchored model is reka's, not a foreign idea — it is simply reached through
`ContextMenuTrigger`, which needs a trigger element.

`MenuAnchor` is not a public export. The public equivalent is `DropdownMenuTrigger`, which renders
`MenuAnchor as-child` around whatever element it wraps. So the singleton becomes:

```vue
<DropdownMenu :open="menu.open" @update:open="menu.setOpen">
  <DropdownMenuTrigger as-child>
    <span class="fixed size-0" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" aria-hidden="true" />
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" :side-offset="0" data-testid="context-menu"> … </DropdownMenuContent>
</DropdownMenu>
```

A 0×0 fixed span at the click point is the same anchor geometry reka's virtual element produces,
expressed with public components only. One span per open menu, not per cell.

### 5.3 Rows, submenus, keyboard

Each of P99's three stated reasons is answered, not worked around:

1. **Custom row content** — `DropdownMenuItem`'s default slot takes arbitrary children. The
   swatch, `CodiconIcon`, label, `DropdownMenuShortcut` and check glyph go in as children exactly
   as they are today. `:disabled` and `data-testid="menu-item-<id>"` bind straight through, so every
   existing menu selector keeps working.
2. **Submenus** — `DropdownMenuSub` / `DropdownMenuSubTrigger` / `DropdownMenuSubContent` inside the
   `v-for`, one per `type: 'submenu'` row. reka owns open state, hover-open delay and placement
   (including the flip that `floatingPosition.ts` was added for), so
   `openSubmenuId`/`submenuStyle`/`startSubmenuTimer` all delete.
3. **Keyboard model** — reka's Menu ships roving focus, typeahead, Escape and outside-close.
   `activeIndex`/`activeSubIndex`/`navigable`/`navigableSub` and
   `packages/workbench/src/util/contextMenuKeys.ts` (92 lines) **delete**. This is the point of the
   swap: the tuned hand-rolled keyboard model is replaced by the library's, not preserved beside it.
   Behaviour differences (typeahead is new, arrow-key wrap may differ) are accepted — the SPEC row
   allows functionality to be re-found through the library.

`floatingPosition.ts`'s `pointReference()` loses its last consumer once §6 also converts the
tooltip; delete whatever of that module has no caller left (`lint:dead` will say).

### 5.4 Tests

`tests/ui/` specs select `[data-testid=context-menu]`, `[data-testid=context-submenu]` and
`menu-item-<id>` — all preserved. Keyboard-navigation assertions written against the old roving
model get re-pointed at reka's focus behaviour; expect edits in `tabs.spec.ts`, `tree.spec.ts`,
`data-view.spec.ts`, `collections.spec.ts`, `row-coloring.spec.ts` and `connections.spec.ts`. Stream
ownership per §8.4.

---

## 6. Hard case 3 — `AppTooltip.vue` + the `v-tooltip` directive

### 6.1 Timing comes from `TooltipProvider`, not from us

`packages/workbench/src/state/tooltip.ts` hand-runs a 400 ms open delay and a 300 ms rearm window.
reka's `TooltipProvider` already owns exactly this pair: `delayDuration` (per-trigger open delay)
and `skipDelayDuration` (the window during which the next trigger opens instantly). Its source
confirms the semantics — `onOpen()` clears the skip timer and sets `isOpenDelayed = false`;
`onClose()` restarts it. Mount one provider per app at the shell root:

```vue
<TooltipProvider :delay-duration="400" :skip-delay-duration="300" disable-hoverable-content>
```

`disable-hoverable-content` matches today's `pointer-events: none` tooltip. No timer code survives
in app source.

### 6.2 Call sites: the directive is deleted

`v-tooltip` is removed from both `main.ts` registrations and from `state/tooltip.ts`. Each of the
291 usages becomes the real trio:

```vue
<Tooltip>
  <TooltipTrigger as-child>
    <Button size="kira-icon" @click="copy"><CodiconIcon name="copy" :size="13" /></Button>
  </TooltipTrigger>
  <TooltipContent>Copy row</TooltipContent>
</Tooltip>
```

Structured tips (`TooltipContent { title, meta, metaColor, body }`) pass the same three parts as
slot markup — a bold title, the coloured type badge, the body paragraph — carrying the classes
`AppTooltip.vue` styles today. `state/tooltip.ts`'s `TooltipContent` interface stays as the shared
shape where a call site computes its tip in script; only its rendering moves.

**Accessible names.** The directive wrote `aria-label` from the tip text whenever the element had no
other accessible name. `TooltipContent` does not do that. Every icon-only trigger converted here
therefore gains an explicit `aria-label` equal to its tip text. This is not optional — dropping it
would regress exactly the findings P105 is about to fix. It is part of the per-file conversion, not
a follow-up.

### 6.3 Disabled controls: the designed pattern

Blink dispatches no pointer or focus events on a `disabled` form control, which is precisely why the
current controller hit-tests at document level with `elementFromPoint`. Several tips exist only to
explain why a control is disabled, so a stock `TooltipTrigger` wrapping `<button disabled>` would
never fire.

Pattern, applied at every disabled-capable trigger (upper bound 85 sites, §1.5):

```vue
<Tooltip>
  <TooltipTrigger as-child>
    <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
      <Button :disabled="!canRun" class="pointer-events-none">Run</Button>
    </span>
  </TooltipTrigger>
  <TooltipContent>Connect before running</TooltipContent>
</Tooltip>
```

- The wrapper `<span>` is never disabled, so it receives `pointermove`/`focus` normally. Hit testing
  retargets to it because the disabled child is not a valid event target.
- `tabindex="0"` makes the tip reachable by keyboard, which the disabled button never is.
- `class="inline-flex"` keeps layout identical to the bare button.
- `pointer-events-none` on the disabled child is only needed where the child's own CSS would
  otherwise swallow the pointer; apply it when the button is disabled, not unconditionally, so the
  enabled state keeps its own hover/active behaviour.

Where the trigger can never be disabled, no wrapper — `TooltipTrigger as-child` merges onto the
control directly.

### 6.4 SlickGrid header cells: the one attribute-driven residue

`SlickGridHost.vue` and `ConsoleSlickGrid.vue` put `data-kira-tip`/`data-kira-tip-parts` into
SlickGrid's `headerCellAttrs`. That DOM is created by SlickGrid, not Vue, so no `TooltipTrigger`
can wrap it. This is a named requirement, not a convenience: the row's instruction is that
functionality must be preserved.

Solution, built from the same reka primitives — a shared
`packages/workbench/src/components/AttributeTooltip.vue` plus a one-file child
`TooltipAnchorBridge.vue`:

- `AttributeTooltip.vue` renders `TooltipProvider` → `TooltipRoot` → `TooltipContent`, with a
  `PopoverAnchor`-style virtual reference driven by the element currently under the pointer.
- `TooltipAnchorBridge.vue` sits inside `TooltipRoot`'s slot and calls reka's **public**
  `injectTooltipRootContext()`, exposing `onTriggerChange(el)`, `onTriggerEnter()`,
  `onTriggerLeave()`, `onOpen()`, `onClose()` and `contentId` to its parent.
- A `pointermove` listener **scoped to the grid's own header row element** (not `document`), via
  VueUse's `useEventListener`, resolves the hovered `[data-kira-tip]` cell with `closest()` and
  calls `onTriggerEnter()`/`onTriggerLeave()`. Delay and rearm therefore still come from
  `TooltipProvider`, not from app code; only "which element is hovered" is app code, and only
  because SlickGrid owns that DOM.
- `aria-describedby` on the hovered cell is set from reka's own `contentId`.

Scope: mounted twice (once per grid host), reading the two existing `tooltipAttrs()` bags unchanged.
Every `data-kira-tip` assertion in `data-view.spec.ts` and `console*.spec.ts` that targets a **grid
header** keeps passing untouched. Assertions targeting a **Vue** element migrate (§6.5).

`packages/workbench/src/state/tooltip.ts` shrinks to the `TooltipContent` type plus
`toPlainText()`; the store, the directive, the document listener set, `initTooltips()` and its
manual-teardown contract all delete. `App.vue`'s `initTooltips()` call and `leaks.spec.ts`'s
assertion on it go with them.

### 6.5 Test migration

~60 `data-kira-tip` attribute assertions across 17 spec files. Two outcomes:

- **Grid-header tips** (`data-view.spec.ts`, `console*.spec.ts`) — unchanged, §6.4 keeps the attribute.
- **Vue-element tips** (the majority: `mutations.spec.ts`, `fake-data.spec.ts`, `http-*.spec.ts`,
  `grpc-request.spec.ts`, `preconnect.spec.ts`, `cell-editor.spec.ts`, `tree.spec.ts`,
  `http-request-body.spec.ts`, `api-secret-reveal-isolation.spec.ts`, `leaks.spec.ts`) — migrate to
  either `toHaveAccessibleDescription(...)` / `toHaveAttribute('aria-label', ...)` (for the
  "what does this control say" assertions, which is most of them) or a hover-then-assert against
  `[data-slot=tooltip-content]` where the test genuinely exercises the popup.
- `tooltips.spec.ts` is rewritten against the new structure: delay/rearm timing (unchanged
  observable behaviour), structured title/meta/body rendering, and the §6.3 disabled-control case,
  which gains a dedicated test since it is the behaviour most at risk.

### 6.6 Declined alternative, named

Keeping the directive as the authoring surface and rebuilding only the renderer on
`TooltipProvider`/`TooltipRoot` (via the §6.4 bridge, applied app-wide) would cost zero call-site
churn and keep all ~60 attribute assertions. Declined: the SPEC row states the rearm/singleton
behaviour is built on `TooltipRoot`/`TooltipProvider` **instead of the directive**, and the user's
instruction for this phase is explicit that the directive's call sites migrate. The bridge is
therefore used only where no Vue element exists to wrap (§6.4), not as a general path.

---

## 7. The Tailwind scale

### 7.1 The arithmetic

No `html { font-size }` override exists anywhere in the repo, so `1rem = 16px` and Tailwind v4's
default `--spacing: 0.25rem` = 4px. Utilities are generated as `calc(var(--spacing) * N)` for any
N, decimals included. The app's raw scale therefore maps **exactly**, with no `@theme` spacing
entry needed:

| Token | Value | Tailwind step | Example |
|---|---|---|---|
| `--kira-s-1` | 2px | `0.5` | `gap-[var(--kira-s-1)]` → `gap-0.5` |
| `--kira-s-2` | 4px | `1` | `p-1` |
| `--kira-s-3` | 6px | `1.5` | `px-1.5` |
| `--kira-s-4` | 8px | `2` | `gap-2` |
| `--kira-s-5` | 12px | `3` | `px-3` |
| `--kira-s-6` | 16px | `4` | `pr-4` |
| `--kira-gap` | 2px | `0.5` | `gap-0.5` |
| `--kira-window-inset` | 6px | `1.5` | `p-1.5` |
| `--kira-h-xs` | 18px | `4.5` | `h-4.5` |
| `--kira-h-sm` | 22px | `5.5` | `h-5.5` |
| `--kira-h-md` | 26px | `6.5` | `h-6.5` |
| `--kira-h-lg` | 30px | `7.5` | `h-7.5` |
| `--kira-icon-box` | 16px | `4` | `size-4` |
| `--kira-control-inline-h` | 14px | `3.5` | `size-3.5` |
| `--kira-statusbar-h` | 20px | `5` | `h-5` |
| `--kira-bar-h` | 34px | `8.5` | `h-8.5` |
| `--kira-titlebar-inset-left` | 78px | `19.5` | `pl-19.5` |

Every value lands on a real step. Nothing needs rounding, so there is no "doesn't cleanly map" case
to resolve — that was the open question and it resolves to zero exceptions.

### 7.2 What still needs `@theme`, and why

Add to `packages/theme/src/base.css`'s existing `@theme` block:

```css
  /* Runtime-settable (Appearance) or a deliberate one-edit design seam — must stay indirect. */
  --spacing-control: var(--kira-control-h);
  --spacing-control-lg: var(--kira-control-h-lg);
  --spacing-control-sm: var(--kira-control-h-sm);
  --spacing-row: var(--kira-row-height);
  --spacing-bar: var(--kira-bar-h);

  --text-kira-xs: var(--kira-t-xs);
  --text-kira-sm: var(--kira-t-sm);
  --text-kira-md: var(--kira-t-md);
  --text-kira-lg: var(--kira-t-lg);
  --text-kira-xl: var(--kira-t-xl);

  --font-data: var(--kira-font-data);
  --font-ui: var(--kira-font-ui);

  --shadow-kira: var(--kira-shadow);
  --shadow-kira-dialog: var(--kira-shadow-dialog);
```

That yields `h-control`, `size-control`, `px-control-lg`, `h-row`, `h-bar`, `text-kira-sm`,
`font-data`, `shadow-kira-dialog` — real utilities, no brackets, indirection preserved. Density and
Appearance settings keep working because the right-hand sides remain `var()`.

**Colour**: use `bg-primary` / `text-primary-foreground` / `border-primary` for brand accent (the
bridge's `--primary` → `--kira-accent`). Never `bg-accent`/`text-accent-fg` — §1.2 measured that
`accent` is the menu-hover grey and `accent-fg` resolves to nothing. Fix the 8 existing
`text-accent-fg` usages and audit the 17 `bg-accent` / 21 `text-accent` / 3 `border-accent` usages
during conversion: each is either a genuine hover surface (keep) or a mis-mapped brand accent (fix).

### 7.3 Token cleanup

After conversion, grep each `--kira-s-*` / `--kira-h-*` / `--kira-icon-box` /
`--kira-control-inline-h` for remaining references (including `.css` files and
`packages/git-ui`/`kira-ui` bridges). Delete from `tokens.css` only those with zero references
left; `scripts/check-tokens.sh` only catches *undefined references*, never unused definitions, so
this is a manual grep, and it is part of Stream A's final step.

---

## 8. The split: two streams, disjoint files

### 8.1 Why not by app

Kira Studio is 111 of 152 files; Kira Space is 23. A by-app split is 4.8:1 imbalanced. The split is
by subsystem instead, with Kira Space folded whole into Stream A (it is small, it is entirely
chrome-and-repo-views, and it shares Stream A's shell work).

### 8.2 The two halves

**Stream A — shared base, chrome, and Kira Space**

| Area | Files | `v-tooltip` | Brackets | Primitive imports |
|---|---|---|---|---|
| `packages/theme/src` | 10 | 5 | ~19 | 2 |
| `packages/workbench/src` | 8 | 4 | ~19 | 6 |
| studio `workbench/` | 18 | 34 | 6 | 38 |
| studio `theme/` | 8 | 4 | 19 | 2 |
| studio `project/` | 7 | 14 | 4 | 20 |
| studio `terminal/`, `editor/`, `views/terminal`, `views/browse` | 5 | 3 | 29 | 14 |
| studio `views/console`, `views/documents`, `views/stream` | 10 | 43 | 65 | 39 |
| all of `apps/kira-space/frontend/src` | 23 | 33 | 64 | 35 |
| **Total A** | **89** | **143** | **225** | **156** |

**Stream B — Kira Studio's API client and data views**

| Area | Files | `v-tooltip` | Brackets | Primitive imports |
|---|---|---|---|---|
| `api/` | 19 | 22 | 74 | 50 |
| `views/shared` | 14 | 52 | 57 | 32 |
| `views/httprequest` | 12 | 36 | 89 | 49 |
| `views/grid` | 8 | 15 | 20 | 18 |
| `views/grpcrequest` | 5 | 18 | 33 | 31 |
| `views/definition` | 5 | 5 | 12 | 7 |
| **Total B** | **63** | **148** | **285** | **187** |

Balance: files 89/63, tooltip sites 143/148, bracket utilities 225/285, primitive imports 156/187.
Stream A carries fewer edits per file but all three hard cases, the `@theme` work and both apps'
shells; Stream B carries the higher mechanical volume. **No file appears in both columns.**

### 8.3 Sequencing: one gate, one join

The streams are disjoint in files but not independent in time, because Stream A owns the components
Stream B calls. Three steps:

- **A0 — the gate (Stream A alone, Stream B waits).** Additive only, nothing deleted:
  extend `@theme` (§7.2); extend `button/index.ts`'s `cva` with the app's variants and sizes; add
  the `@tanstack/vue-virtual` dependency; land `AttributeTooltip.vue`/`TooltipAnchorBridge.vue`
  (§6.4); mount `TooltipProvider` in both shells; delete `components/ui/scroll-area`. Stream A
  commits A0 and pushes; Stream B starts from that commit. Every primitive still exists and still
  compiles, so the tree is green throughout.
- **A1…An and B1…Bn — parallel.** Each stream converts its own files, one touch per file, both
  changes (primitive swap + bracket conversion) in the same edit.
- **A-final — the join (Stream A alone, after B reports done).** Delete all 20 primitive `.vue`
  files, delete the now-dead `.p-*` rules from `primitives.css`, delete `contextMenuKeys.ts` and the
  dead half of `floatingPosition.ts`, prune unreferenced `--kira-*` tokens (§7.3), update `knip.json`
  if an `ignoreDependencies` entry is now wrong, and update `docs/ARCHITECTURE.md`.

The deletion cannot move earlier: primitives live in Stream A's files but are called from Stream B's,
so deleting at A0 would leave the tree red until B finished. Splitting the deletion across the two
streams is worse — it would make `primitives.css` a shared-file edit, which the no-shared-file rule
forbids.

### 8.4 Test-file ownership

Same rule: a spec file belongs to the stream owning the surface it tests. Named assignments for the
cross-cutting ones, so neither stream guesses:

- **Stream A**: `tooltips.spec.ts`, `workbench.spec.ts`, `tabs.spec.ts`, `tree.spec.ts`,
  `collections.spec.ts`, `connections.spec.ts`, `connection-dialog-tabs.spec.ts`,
  `settings-*.spec.ts`, `control-sizing.spec.ts`, `font-roles.spec.ts`, `interaction.spec.ts`,
  `leaks.spec.ts`, `smoke.spec.ts`, `mode-switch.spec.ts`, `operations.spec.ts`,
  `terminal-module.spec.ts`, `console*.spec.ts`, `document-view-readonly.spec.ts`,
  `update-banner.spec.ts`, all five `tests/visual/*`, and all of `apps/kira-space/tests`.
- **Stream B**: `api-ui-consistency.spec.ts`, `api-secret-reveal-isolation.spec.ts`,
  `autocomplete.spec.ts`, `http-*.spec.ts`, `grpc-request.spec.ts`, `data-view.spec.ts`,
  `cell-editor.spec.ts`, `slick-grid.spec.ts`, `mutations.spec.ts`, `fake-data.spec.ts`,
  `mask-preview.spec.ts`, `row-coloring.spec.ts`, `definition.spec.ts`, `sql-schema.spec.ts`,
  `secrets.spec.ts`, `credential-reveal.spec.ts`, `preconnect.spec.ts`, `datagrip-import.spec.ts`,
  `budgets.spec.ts`, `perf.spec.ts`, `scroll-trace.spec.ts`, `fixtures.ts` only if untouched by A.

If a stream must edit a spec the other owns, it stops and hands the edit to the owner rather than
touching it — the no-shared-file rule covers tests too.

### 8.5 The tradeoff, named

The split is not free of coordination: A0 is a hard gate Stream B waits on, and A-final is a join
Stream A waits on. Total serialized work is roughly A0 (small) plus the longer of the two parallel
halves plus A-final (small). That is the price of exactly two streams with zero shared-file edits;
a three-way split would balance the volume better but the user fixed the count at two, and any
split that lets both streams edit `primitives.css` or `base.css` is worse than the imbalance it
fixes.

---

## 9. Conversion rules and sequencing

1. **One touch per file.** Every file in §1.7's inventory is opened exactly once, and both changes
   land in that edit. Never a primitive-swap commit followed by a spacing commit over the same file.
2. **Functionality is preserved; DOM shape and pixels are not.** Where a library component renders
   different markup, that is the expected outcome. Never keep old markup to hold a pixel.
3. **No hand-rolled fallback, anywhere.** If a swap looks impossible, the answer is a different
   composition of reka/shadcn primitives, or the surface stays native (`<select>`, `<textarea>`) —
   never a re-written custom component. If a case genuinely resists both, stop and report rather
   than inventing a wrapper.
4. **No wrapper layer is recreated.** Variants belong in the `components/ui/<set>/index.ts` `cva`
   call, which is shadcn-vue's own extension point. A new `.vue` file that only forwards props to a
   `components/ui` component is exactly what this phase deletes.
5. **`<script setup lang="ts">` only**, Composition API, confirmed per file on the way past.
6. **VueUse for DOM work** (`useEventListener`, `useTimeoutFn`, `useDebounceFn`, `useResizeObserver`)
   — no raw `addEventListener`/`setTimeout` in converted code.
7. **Comments**: delete every P99-era comment that declines a library ("declined reka-ui's
   CheckboxRoot…", "stays hand-rolled…") — they become false the moment the swap lands. Add a
   comment only where the code cannot say it, per CLAUDE.md.
8. **No new unit test.** Nothing here clears CLAUDE.md's bar; the UI suites are the coverage. The
   one exception is the disabled-control tooltip case (§6.5), which is a Playwright test, not a unit
   test, and guards the single most breakable behaviour in this phase.
9. **Commit granularity**: one commit per directory, or per primitive when a primitive's call sites
   span one stream's directories. Conventional Commits, `refactor:` for the swaps, `feat:` where a
   component genuinely gains behaviour (reka keyboard models), `test:` for selector migrations.
10. **Fast checks per commit** (`typecheck`, `lint`, the stream's own `build`); the expensive suites
    run once per stream near its end and once combined (§10).

---

## 10. Verification

### 10.1 Per stream, before reporting done

- `bun run typecheck` (all eight projects).
- `bun run lint` — Biome 0/0/0, `check-tokens.sh` clean.
- `bun run build` (Stream B and A), `bun run build:space` (Stream A).
- `bun run test:unit` — baseline 1535 passed.
- The stream's own UI specs (§8.4) via a filtered `playwright test` run.

### 10.2 Combined, after A-final

- `bun run typecheck`, `bun run lint`, `bun run lint:dead`, `bun run build`, `bun run build:space`.
- `bun run test:unit`, `bun run test:webview` (baseline 55 — `packages/git-ui` is untouched, so any
  change here is a real regression).
- `bun run test:ui` (baseline 311 total) and `bun run test:ui:space`. P99's result section
  documents a cross-file-worker timing flake class: a failure counts as pre-existing only if it
  passes in isolation **and** `git diff --stat` against this phase's start commit touches none of
  its files. Anything else gets fixed in this phase, pre-existing or not.
- `bun run test:visual` — see §10.3.

### 10.3 Visual baselines

All five specs change, deliberately, and each gets its reason recorded in the P104 result section:

| Spec | Why it changes |
|---|---|
| `workbench.spec.ts` | Title bar, tab strip, status bar and context menu all move to shadcn/reka components; splitter becomes reka's |
| `console.spec.ts` | Toolbar buttons, segmented control and empty state swap; spacing normalizes |
| `data-view.spec.ts` | Grid toolbar, checkbox glyph and tooltip surface swap |
| `connection-dialog.spec.ts` | `DialogFrame` → `ui/dialog`, `TextField` → `ui/input`+`input-group`, `Checkbox` → `ui/checkbox` |
| `schema-dialog.spec.ts` | Same dialog/field/checkbox swap, plus tree rows on the new virtualizer |

Re-record with `bun run test:visual:update`. `docs/ARCHITECTURE.md` already documents that baselines
captured outside the CI `ubuntu-latest` image differ by ~0.01 ratio on glyph rendering; that caveat
is unchanged by this phase and is not a reason to skip re-recording. Do not chase a diff back to
zero — the visual output is *supposed* to change.

### 10.4 Notes handed to P105 (measured, never fixed here)

P105 runs immediately after and depends on this phase. Record, do not act on:

- `role=checkbox` replaces `<input type=checkbox>`: changes `useSemanticElements` and
  `noNoninteractiveElementToInteractiveRole` findings.
- Every `components/ui` component ships `type="button"`, focus rings and correct roles, which should
  retire most `useButtonType` and `useFocusableInteractive` findings outright.
- `ui/label` adoption across 34 files targets `noLabelWithoutControl` directly.
- §6.2's explicit `aria-label` on every converted icon-only trigger is a11y-load-bearing: if it were
  skipped, P105 would inherit a *larger* finding count than P99 left.
- §6.3's `<span tabindex="0">` wrappers introduce focusable non-interactive elements — expect new
  `noNoninteractiveTabindex`-class findings there, with the disabled-hover requirement as the
  documented reason.
- Re-count `biome check` with the `a11y: off` override removed once A-final lands, and record the
  number in the P104 result section so P105 starts from a real figure rather than P99's 255/86.

### 10.5 Closing audit (Stream A, after A-final)

Each check is a real command, not a re-read of a result section:

1. `find packages/theme/src/primitives apps/kira-studio/frontend/src/theme/primitives -name '*.vue'` → no such paths.
2. `grep -rn "primitives/" --include=*.vue --include=*.ts apps packages` → 0 hits.
3. For each of the 16 surviving `components/ui/*` sets, `grep -rn "components/ui/<set>" apps packages`
   returns at least one importer outside `packages/theme/src/components/ui/` → all 16 pass, and
   `scroll-area` no longer exists.
4. `grep -rnE "\[[^]]*var\(--kira-(s|h|icon-box|control-inline|gap|window-inset|bar|statusbar|titlebar)[^]]*\]"`
   → 0 hits (the spacing/sizing axis is fully converted).
5. `grep -rn "v-tooltip\|vTooltip"` → 0 hits.
6. `grep -rn "data-kira-tip"` → only the two `tooltipAttrs()` writers, `AttributeTooltip.vue`, and
   the grid-header assertions §6.5 keeps.
7. `grep -rn "text-accent-fg"` → 0 hits.
8. `grep -c "^\." packages/theme/src/primitives.css` → only classes with a live consumer remain;
   every remaining one is named in the result section.
9. `bun run lint:dead` → no new finding beyond the 6 pre-existing `duplicates` warnings.
10. `bun run typecheck && bun run lint && bun run build && bun run build:space` → clean.
11. `docs/ARCHITECTURE.md`'s Stack row (line 35) updated: P104 replaced the hand-rolled primitive
    layer with shadcn-vue's own components and normalized spacing onto Tailwind's scale. Remove the
    stale `theme/primitives/*` references at lines 939, 1497-1508, 1657-1660 and 2094, and the
    `.p-check` description at 3161.
12. `docs/v1.9/SPEC.md` gains a `## P104 result` section with the per-baseline visual reasons
    (§10.3) and the §10.4 numbers.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tooltip conversion silently drops accessible names on icon-only buttons | High | High — regresses the exact findings P105 must fix | §6.2 makes `aria-label` part of the per-site conversion; audit check 5 plus §10.4's recount catch omissions |
| Disabled-control tips stop firing (the §6.3 wrapper applied inconsistently) | Medium | High — several tips exist only to explain a disabled state | Dedicated Playwright test in `tooltips.spec.ts` (§6.5); grep the 85 `v-tooltip`-near-`disabled` sites as a checklist |
| `primitives.css` deletion exposes the `bg-accent`/`text-accent-fg` fault (§1.2) as a visible regression | High (the fault is real and measured) | Medium | §7.2's colour rule; audit check 7 |
| reka's context-menu keyboard model differs enough to fail existing specs | High | Medium | Expected and accepted (§5.3); specs are re-pointed, not the component re-tuned |
| `PanelSplitter` → reka Splitter changes persisted layout values (pixels → percentages) | Medium | Medium — a user's saved panel sizes | §3.3's one-time conversion against measured container width; verify in `workbench.spec.ts` |
| `@tanstack/vue-virtual` swap regresses scroll behaviour in `TreeHost`/`VirtualList` | Medium | Medium | `scroll-trace.spec.ts` and `perf.spec.ts` are the guards; `stickyBand.ts` behaviour tested via `tree.spec.ts` |
| Stream B blocked longer than planned on A0 | Medium | Low | A0 is additive and small (§8.3); Stream B can pre-read its files while waiting |
| Two streams both want to edit one spec file | Medium | Low | §8.4 names every cross-cutting spec's owner; the non-owner hands the edit over |
| Visual baselines re-recorded in this container diverge from CI | Certain | Low | Already documented in `docs/ARCHITECTURE.md`; unchanged by this phase, stated per baseline |
| Bracket conversion changes a computed value by a pixel somewhere | Low | Low | §7.1's mapping is exact at every step; a mismatch would be a typo, caught by the visual specs |
| A `components/ui` set turns out to have no honest consumer | Low | Low | §2.2's precedent: delete the set rather than invent a call site or keep a hand-rolled one |
