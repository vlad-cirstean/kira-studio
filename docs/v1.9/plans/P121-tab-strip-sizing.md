# P121 — Tab-strip sizing, corners and spacing, both apps: plan

Planning only. One Opus pass, verified at `88943a7a` (branch tip incl. P120 + P122). Implementer:
one sequential Sonnet subagent (§4). Path prefixes: `PT/` = `packages/theme/src/`, `UI/` =
`PT/components/ui/`, `WB/` = `packages/workbench/src/`, `SF/` = `apps/kira-studio/frontend/src/`,
`KF/` = `apps/kira-space/frontend/src/`, `KU/` = `packages/kira-ui/src/`.

## §0 Goal, method, acceptance

SPEC row (`docs/v1.9/SPEC.md:65`): tab-strip pattern in both apps (named: Studio's SQL/page tabs,
Space's repo/file-switcher tabs) does not fit surrounding sizing/spacing and has no rounded corners
where the rest of the UI does. Planning must run both apps, screenshot every tab-strip instance
beside a correct non-tab control, and name the exact classes/tokens responsible. It must not
assume one tab component covers every instance.

Method.

- Discovery through CodeGraph (`codegraph_explore`, 5 calls, §8). Its index is built from the main
  checkout, so every file:line below was re-checked with `rg`/`sed` in this worktree.
- Both apps ran for real: `bun run build:test:studio` / `bun run build:test:space` bundles, driven
  by the Playwright `ui` project (WebKit, same engine family as WKWebView/WebKitGTK) with the
  existing mocked-bridge fixtures, `deviceScaleFactor: 2`. No GUI in this sandbox, so no `wails3
  dev` window. Prerequisite: `wails3 task common:generate:bindings` in each app dir, or the build
  fails on unresolved `@bindings/*`.
- A throwaway spec per app (`tests/ui/zz-p121-shots.spec.ts`, deleted before commit) cropped each
  instance with its neighbour control and dumped `getBoundingClientRect` plus computed
  `border-radius`, `padding`, `gap`, `font-size`, `border`, `letter-spacing` and the class string.
  Crops and JSON: scratchpad `p121/before/` (19 PNG, 10 JSON). Numbers below come from those dumps.
- After-state screenshots were not taken. A prototype edit plus rebuild was refused by this
  session's permission guard (shared build output), so every prototype edit was reverted. §6.3
  makes after-state capture the implementer's job. Recipe for the capture script is in §6.3.
- Selector behaviour of Tailwind 4.3.3 was probed by compiling the candidate classes in isolation
  (results quoted in §2.2).

Acceptance (SPEC row, verbatim): "every tab-strip instance in both apps matches the surrounding
UI's corner radius and spacing scale, verified visually (screenshot or `test:visual` if a relevant
spec already exists)".

## §1 Reference scale — what "surrounding UI" is

From `PT/tokens.css` and measured neighbours.

- Radius tier (`PT/tokens.css:59-72`): `--kira-radius-xs` 2px; `--kira-radius-sm` 4px, commented
  "for interactive controls (buttons, tabs, inputs, chips)"; `--kira-radius` 6px, panels;
  `-lg` 8px; `-pill` 10px. Utilities: `rounded-kira-xs/-sm/(bare)/-lg/-pill`.
- Spacing: Tailwind default numeric scale, 4px step (`gap-0.5` 2px, `gap-1` 4px, `px-1.5` 6px,
  `px-2` 8px).
- Heights: `--kira-control-h` 22px (`h-control`, toolbar density: input, segmented, icon button);
  `--kira-control-h-lg` 26px (`h-control-lg`, dialog density and document tabs); `--kira-bar-h`
  34px (`h-bar`, `h-tabbar`).
- Font: `text-kira-sm` 11px for every control label; `text-kira-xs` 10px for secondary captions.

Measured correct non-tab controls (the "looks right" side of every crop):

| Control | Classes (source) | Rendered |
|---|---|---|
| Toolbar icon button | `Button variant="toolbar" size="kira-icon"` (`UI/button/index.ts:27,59`) | 22x22, radius 4px |
| Toolbar text button | `Button size="kira"` | 22px, radius 4px, `px-3` |
| Dialog button | `Button size="kira-lg"` | 26px, radius 4px, 11px |
| Dialog input | `h-control-lg rounded-kira-sm border-border-strong bg-field px-2` | 26px, radius 4px |
| Settings section row | `SettingsShell.vue:222` `rounded-kira-sm ... h-5.5 px-1.5` | radius 4px |
| Panel chrome | `rounded-kira` | 6px |
| Panel head bar | `ViewToolbar.vue:10` `h-bar ... gap-1.5 px-2`; GitPanel/Connections header | 34px, 22px controls centred (y 41 in a bar at y 35, 33px inside `border-b`) |

Target per tab instance: radius 4px (`rounded-kira-sm`); height 26px (`h-control-lg`) for document
and dialog tabs, 22px (`h-control`) for toolbar segmented tabs; label 11px; gap between tabs 2px
(`gap-0.5`, the main tab strip's own value); vertically centred in its bar.

## §2 Inventory

Every instance found (CodeGraph `§8` queries 1-5, then `rg` for class-string copies). Four
separate implementations, not one component.

### §2.1 Chip tabs — hand-rolled copies of one class string (radius already 4px)

**T1 — `WB/components/TabStrip.vue` scrolling chip (`:273`)**. Main document tab strip, shared by
both apps via `WB/components/WorkbenchShell.vue:179,212` (bar: `h-tabbar ... border-b border-border
bg-chrome`). Studio SQL/data/HTTP tabs; Space file tabs (`a.ts`, `README.md`).

- Classes: `h-control-lg inline-flex items-center gap-1 px-1.5 rounded-kira-sm border
  cursor-pointer max-w-52 shrink-0 text-kira-sm group/tab`; active `bg-elevated
  border-border-strong text-fg`; inactive `border-transparent text-muted-foreground hover:bg-hover`.
- Measured: 26px tall, radius 4px, padding 6px, gap-between 2px, 11px. Radius/height/font match.
- **Mismatch — vertical centring.** Row (`:262`) `h-full flex items-center gap-0.5 overflow-x-auto
  overflow-y-hidden min-w-0 scrollbar-none pt-0.5 px-1`. `pt-0.5` (2px) pushes the chip down:
  chip at y 40 in a bar at y 35 (33px inside border) leaves 5px above, 2px below. Neighbouring
  panel-head controls sit centred (3.5px/5.5px split of their own bar). `pt-0.5` predates P110 and
  was migrated faithfully (`91c26966`, P110 B36e) — an old offset, not a new regression.

**T2 — `TabStrip.vue` pinned chip (`:232`)** (Space's repo-graph tab): same string with `px-1`.
Wrapper `:225` `h-full flex items-center gap-0.5 shrink-0 pt-0.5 pl-1` — same `pt-0.5` offset.
Measured 23x26, radius 4px, y 40.

**T3 — new-tab `+` wrapper**, `SF/workbench/WorkbenchShell.vue:81` and
`KF/workbench/WorkbenchShell.vue:71`: `h-full flex items-center shrink-0 pt-0.5 pr-1 pl-0.5`. Same
`pt-0.5` offset (button measured y 42, 22px).

**T4 — `SF/views/console/ConsoleView.vue:874-915` SQL console result tabs** ("Result 1", "Result
2").

- Bar `:874` `h-bar shrink-0 flex items-center gap-1 px-2 border-b border-border` — correct.
- Strip `:877` `flex items-center flex-1 min-w-0 overflow-x-auto gap-1 scrollbar-none`.
- Chip `:884` `group/tab inline-flex items-center gap-1 px-1.5 rounded-kira-sm border
  cursor-pointer shrink-0 max-w-36 h-5.5 text-kira-xs` + same active/inactive pair as T1.
- Close `:908` `... w-3.5 h-3.5 ... rounded-kira-sm ...`, icon `:size="11"`.
- Measured: 22px (literal `h-5.5`, no token), **10px label** (every other tab and the status text
  beside it: 11px), **gap 4px** (T1: 2px), close box 14px (T1: 16px, icon 13).

**T5 — `SF/project/ConnectionDialog.vue:705-761` connection detail tabs**
(General/Advanced/Pre-connect/MCP/Privacy).

- Hand-rolled tablist `:705` `<div class="flex gap-1 border-b border-border pb-1.5" role="tablist"
  aria-label="Connection detail tabs">` with five copy-pasted `<button role="tab">` (`:706-761`),
  each `:class="(activeTab === 'X') ? 'is-active bg-elevated border-border-strong text-fg' :
  'border-transparent text-muted-foreground'"`, `data-testid="connection-tab-{general,advanced,
  preconnect,mcp,privacy}"`.
- Panels: `<div v-if/v-else-if="activeTab === '…'" class="flex flex-col gap-2" role="tabpanel">`
  at `:763`, `:932`, `:987`, `:1027`, `v-else` Privacy `:1142`. Wrapper `:704` `flex flex-col
  gap-2 p-3`, which also holds the credential-note block after the panels.
- `activeTab` `ref<DetailTab>` (`:137-140`); `TAB_FOR_FIELD` (`:374`) jumps tabs on a validation
  error; Privacy query `:468` `enabled: activeTab.value === 'Privacy'`.
- Measured: 26px, radius 4px, 11px — matches. **Mismatch: gap 4px** (T1: 2px) and inactive chips
  have **no `hover:bg-hover`** (T1/T6 do). No arrow-key navigation (hand-rolled `role="tab"`
  without roving focus).

**T6 — `SF/workbench/TitleBar.vue:62-85` mode tabs** (Data/API/…): `h-control-lg inline-flex
items-center gap-1 px-3 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm
wails-no-drag` + T1 pair. Measured 26px, radius 4px, padding 12px. **Already matches**; fourth copy
of the same string.

### §2.2 Segmented pane tabs — shared `ToggleGroup` primitive (root cause of "no rounded corners")

23 call sites, both apps plus workbench. Every one renders **0px radius** on every item.

Primitive classes at `88943a7a`:

- `UI/toggle/index.ts:7` base: `... rounded-kira ...` (6px, panel tier — wrong tier for a
  control). Sizes `:15-22`: `default` `h-8 min-w-8 px-2.5`; `sm` `h-7 min-w-7
  rounded-[min(var(--kira-radius-sm),12px)] px-2.5 text-[0.8rem]`; `lg`; `kira` `h-control
  min-w-control px-2 text-kira-sm [&_svg:not([class*=size-])]:size-3.5`. `defaultVariants` size
  `default`.
- `UI/toggle-group/ToggleGroup.vue:13-20` `withDefaults(..., { spacing: 0 })`; root `:45`
  `rounded-kira data-[size=sm]:rounded-kira-sm group/toggle-group flex w-fit flex-row items-center
  gap-[--spacing(var(--gap))] data-vertical:flex-col data-vertical:items-stretch`.
- `UI/toggle-group/ToggleGroupItem.vue:36`: `group-data-[spacing=0]/toggle-group:rounded-none ...
  group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-kira ... :last:rounded-r-kira
  ... group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 ...
  :first:border-l` (+ `group-data-vertical/` twins).

Root cause, three parts:

1. **Dead selectors.** The registry string targets Base UI's `data-horizontal`/`data-vertical`
   attributes. reka-ui 2.10.5 `ToggleGroupRoot` never emits either; it emits `data-orientation`
   only when `orientation` is passed (no call site passes it). Probe: `group-data-horizontal/
   toggle-group:` compiles to a `[data-horizontal]` match — never true. So the unconditional
   `group-data-[spacing=0]:rounded-none` stands alone: every item square.
2. **Default `spacing: 0`** makes every group a connected segment row. Borderless default-variant
   items then show a square `bg-field` block for the active item (measured: Structure/Source,
   Params/Headers/…, 10/100/1k/10k).
3. **Outline `border-l-0` is dead too** (same selector), so outline groups draw a doubled 2px
   border between segments (RowDensity: measured `border 1px` on every item, no collapse).

Probe result for the fix: `group-not-data-[orientation=vertical]/toggle-group:` compiles to
`:is(:where(.group\/toggle-group):not([data-orientation="vertical"]) *)` — true for every current
group. Chained with `data-[spacing=0]:first:` it has specificity 0,4,0, beating
`group-data-[spacing=0]/toggle-group:rounded-none` (0,2,0).

Call sites (all `type="single"`; none passes `orientation` or `spacing`):

| # | Site | Variant / size | Measured |
|---|---|---|---|
| S1 | `KF/repo/GitPanel.vue:338` Repos/Files/Review (Space repo switcher) | default / kira | 22px, radius 0, gap 0 |
| S2 | `KF/repo/GitPanel.vue:545` Files/Search | default / kira | same |
| S3 | `KF/views/repo/RepoFileView.vue:276` Source/Reading | default / kira | same |
| S4 | `WB/settings/fields/RowDensityField.vue:36` | outline / kira | 22px, radius 0, doubled 2px divider |
| S5 | `SF/project/ConnectionDialog.vue:798` mode Fields/URI | outline / **sm** | **28px, 12.8px** beside 26px/11px dialog inputs |
| S6-S8 | `ConnectionDialog.vue:1080,1099,1118` MCP read/write/DDL | default / **none** (cva `default`) | **32px, 14px**, radius 0 |
| S9 | `SF/workbench/panels/OperationsPanel.vue:234` | default / kira | 22px, radius 0 |
| S10-S11 | `SF/views/httprequest/ResponsePane.vue:336,361` | default / kira | same |
| S12 | `SF/views/shared/celleditor/TimestampPane.vue:119` | default / kira | same |
| S13 | `SF/views/httprequest/RequestBodyPane.vue:157` | default / kira | same |
| S14 | `SF/views/httprequest/HttpRequestView.vue:656` Params/Headers/Body/Settings/Cookies | default / kira | measured: 22px, radius 0, padding 8px, 11px |
| S15 | `SF/views/documents/DocumentView.vue:710` | default / kira | same |
| S16 | `SF/views/grpcrequest/SchemaBrowser.vue:110` | default / kira | same |
| S17 | `SF/views/grpcrequest/ResponsePane.vue:318` | default / kira | same |
| S18-S19 | `SF/views/grpcrequest/GrpcRequestView.vue:374,429` | default / kira | same |
| S20 | `SF/views/shared/keyvalue/KeyValuePane.vue:826` | default / kira | same |
| S21 | `SF/views/stream/StreamView.vue:738` | default / kira | same |
| S22 | `SF/views/definition/DefinitionView.vue:254` Structure/Source | default / kira | measured: 22px, radius 0 |
| S23 | `SF/views/grid/DataToolbar.vue:264` page size 10/100/1k/10k ("page tabs") | default / kira | 22px, radius 0 |

No `<Toggle>` (non-group) consumer exists; `UI/toggle/Toggle.vue` has no caller outside the group.

### §2.3 Space GitPanel header leaks text styling into S1

`KF/repo/GitPanel.vue:335`: `flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border
text-kira-sm text-muted-foreground uppercase tracking-wider`. This is the retired `p-panel-head`
recipe (`scripts/check-theme-classes.sh:229`) from when the header held a repo title; P84 replaced
the title with S1 (comment `:336`). Toggle items set no colour or letter-spacing of their own, and
Tailwind preflight gives `<button>` `letter-spacing: inherit`. Result: Repos/Files/Review render
muted and with wide `tracking-wider` spacing; Files/Search (S2) directly below render fg with
normal spacing. `text-transform` does not reach them (buttons reset it), so they stay mixed-case.
Header's `TooltipIconButton`s set their own `text-muted-foreground` (`UI/button/index.ts:27`), so
they do not depend on the header colour.

### §2.4 Already correct — no change

- **K1 `KU/KuiSegmented.vue`** (git-ui `kv:` root; FileTree, ReviewView x2, ReviewFilesPane,
  BranchPicker): `kv:inline-flex kv:h-kui-control ... kv:border kv:border-kui-border-strong
  kv:rounded-kui kv:overflow-hidden kv:divide-x`, `--kui-radius` 4px (`PT/kui-bridge.css:37`).
  Rounded, connected, single divider — the in-repo precedent for §3.2's connected outline group.
  Not rendered by the Space ui fixture (review host needs a selected branch); verified from source.
- **T6** TitleBar mode tabs (values match; §3.4 only moves it onto the shared definition).

## §3 Fix

Two shared definitions: the `ToggleGroup` primitive (fixed once, 23 sites follow) and one tab-chip
`cva` (replaces four copies). Same shape as P122: fix the primitive, move hand-rolled copies onto
it, guard with lint and a UI test.

### §3.1 `UI/toggle/index.ts`

| | Before | After |
|---|---|---|
| base radius | `rounded-kira` | `rounded-kira-sm` |
| new size | — | `'kira-lg': 'h-control-lg min-w-control-lg px-2 text-kira-sm [&_svg:not([class*=size-])]:size-3.5'` |

Everything else unchanged. `kira-lg` mirrors `Button`'s `kira-lg` (dialog density).

### §3.2 `UI/toggle-group/ToggleGroup.vue`

- Replace `withDefaults(...)` with plain `defineProps<...>()`.
- `const resolvedSpacing = props.spacing ?? (props.variant === 'outline' ? 0 : 0.5)`. Outline groups
  stay connected (K1 precedent). Default-variant groups become separate chips 2px apart (T1's
  `gap-0.5`). No call site passes `spacing`, so no call-site edit.
- `provide('toggleGroup', { variant, size, spacing: resolvedSpacing })`; bind
  `:data-spacing="resolvedSpacing"` and `'--gap': resolvedSpacing`. Name it `resolvedSpacing`, not
  `spacing`, so the template never shadows the prop.
- `reactiveOmit(props, 'class', 'size', 'variant', 'spacing')` — stops `spacing` leaking to the DOM
  as an attribute.
- Root class before: `rounded-kira data-[size=sm]:rounded-kira-sm group/toggle-group flex w-fit
  flex-row items-center gap-[--spacing(var(--gap))] data-vertical:flex-col
  data-vertical:items-stretch`.
  After: `rounded-kira-sm group/toggle-group flex w-fit flex-row items-center
  gap-[--spacing(var(--gap))] data-[orientation=vertical]:flex-col
  data-[orientation=vertical]:items-stretch`.

### §3.3 `UI/toggle-group/ToggleGroupItem.vue:36`

Mechanical rewrite of the one class string:

- every `group-data-horizontal/toggle-group:` becomes `group-not-data-[orientation=vertical]/toggle-group:`;
- every `group-data-vertical/toggle-group:` becomes `group-data-[orientation=vertical]/toggle-group:`;
- `rounded-l-kira`/`rounded-r-kira`/`rounded-t-kira`/`rounded-b-kira` become `-kira-sm`.

Resulting rendering:

| Group | Before | After |
|---|---|---|
| default variant (S1-S3, S6-S23) | items 0px radius, gap 0, active = square `bg-field` block | each item 4px radius, 2px gap |
| outline (S4, S5) | items 0px, doubled 2px divider | outer corners 4px, inner 0, single 1px divider |

### §3.4 One tab-chip definition — shadcn-vue `tabs`

Fetch registry set `tabs` per `docs/DEV_ENVIRONMENT.md` §"shadcn-vue — adding a component set":

1. `curl -sS https://shadcn-vue.com/r/styles/reka-nova/tabs.json` (deps `reka-ui`, `@vueuse/core`;
   MIT; both already dependencies).
2. Write each `files[].content` under `UI/tabs/`, path stripped of `styles/reka-nova/ui/`:
   `Tabs.vue`, `TabsContent.vue`, `TabsList.vue`, `TabsTrigger.vue`, `index.ts`.
3. Rewrite `@/lib/utils` to `@theme/lib/utils` (and `@/components/ui/` to `@theme/components/ui/`).
4. `bun run format`.

Registry strings are not usable verbatim: `Tabs.vue` uses the same dead `data-horizontal:` shape as
§2.2; `TabsTrigger` carries `ring-3`, `text-foreground`, `rounded-md`, `bg-background` (fail
`check_alias`/`check_focus_width`); `TabsList` `bg-muted rounded-lg` (fail `check_alias`). Rewrite:

| File | Class after |
|---|---|
| `Tabs.vue` | `flex flex-col gap-2 data-[orientation=vertical]:flex-row` (keep registry's `data-orientation` binding) |
| `TabsList.vue` | `inline-flex w-fit items-center gap-0.5` |
| `TabsTrigger.vue` | `inline-flex items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50` — no colour/border/radius; the chip look comes from `tabChipVariants` at the call site |
| `TabsContent.vue` | none beyond `props.class` (P122's base `:focus-visible` ring covers keyboard focus) |

Add to `UI/tabs/index.ts`, beside the component re-exports:

```ts
export const tabChipVariants = cva(
  'inline-flex items-center gap-1 h-control-lg rounded-kira-sm border cursor-pointer shrink-0 max-w-52 text-kira-sm',
  {
    variants: {
      active: {
        true: 'is-active bg-elevated border-border-strong text-fg',
        false: 'border-transparent text-muted-foreground hover:bg-hover',
      },
      size: { default: 'px-1.5', icon: 'px-1', wide: 'px-3' },
    },
    defaultVariants: { active: false, size: 'default' },
  },
);
```

`is-active` stays in the output: Studio `tests/ui/connection-dialog-tabs.spec.ts`,
`mode-switch.spec.ts`, `console.spec.ts`, `data-view.spec.ts` and
`tests/visual/connection-dialog.spec.ts` (among others) select or assert on it.

### §3.5 Call sites

**T5 ConnectionDialog onto shadcn `Tabs`** (hand-rolled `role="tablist"` is a component primitive
shadcn-vue ships; gains roving focus and arrow keys).

- `:704` `<div class="flex flex-col gap-2 p-3">` becomes `<Tabs :model-value="activeTab"
  class="flex flex-col gap-2 p-3" @update:model-value="(v) => (activeTab = v as DetailTab)">`
  (reka emits `string | number`; keep `DetailTab` narrowing). `TAB_FOR_FIELD` and the Privacy query
  keep reading `activeTab` unchanged.
- `:705-761` becomes one `<TabsList class="w-full border-b border-border pb-1.5" aria-label="Connection
  detail tabs">` with `v-for` over a module const `DETAIL_TABS: readonly { value: DetailTab; testid:
  string }[]` (five entries, same labels and `data-testid`s), each `<TabsTrigger :value="t.value"
  :class="tabChipVariants({ active: activeTab === t.value })" :data-testid="t.testid">`.
- The five panels become `<TabsContent value="General" class="flex flex-col gap-2">` etc. Drop
  their `role="tabpanel"` (reka sets it). Credential note stays after the last `TabsContent`,
  inside `Tabs`.
- reka `TabsContent` unmounts inactive panels, same as today's `v-if` chain — the spec's
  `toHaveCount(0)` checks keep passing.
- Classes before/after per chip: before `h-control-lg inline-flex items-center gap-1 px-1.5
  rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm` + `border-transparent
  text-muted-foreground` inactive; after `tabChipVariants({active})` (adds `hover:bg-hover`). List
  gap `gap-1` (4px) becomes `gap-0.5` (2px, from `TabsList`).

**S5-S8 ConnectionDialog toggle sizes.** `:798` `size="sm"` becomes `size="kira-lg"`. Add
`size="kira-lg"` to `:1080`, `:1099`, `:1118`. Result: 26px / 11px, matching the dialog's inputs
and `kira-lg` buttons.

**T1/T2 TabStrip onto `tabChipVariants`.**

- `:273` before: static string above + active/inactive ternary + `{ 'is-active': tab.active }`.
  After: `class="group/tab"` plus `:class="[tabChipVariants({ active: tab.active }),
  isAttention(tab) ? ATTENTION_CLASS : '', { 'opacity-50': dragId === tab.id }]"`.
- `:232` pinned: `:class="tabChipVariants({ active: tab.active, size: 'icon' })"`.
- `:225` drop `pt-0.5`: `h-full flex items-center gap-0.5 shrink-0 pl-1`.
- `:262` drop `pt-0.5`: `h-full flex items-center gap-0.5 overflow-x-auto overflow-y-hidden
  min-w-0 scrollbar-none px-1`.

**T3 new-tab wrapper** (`SF/workbench/WorkbenchShell.vue:81`, `KF/workbench/WorkbenchShell.vue:71`):
`h-full flex items-center shrink-0 pt-0.5 pr-1 pl-0.5` becomes `h-full flex items-center shrink-0
pr-1 pl-0.5`. After T1-T3: 26px chip centred in the 33px bar interior (3.5px each side), `+` centred
too, matching adjacent panel heads.

**T4 ConsoleView result tabs.**

- Chip `:884` before `group/tab inline-flex items-center gap-1 px-1.5 rounded-kira-sm border
  cursor-pointer shrink-0 max-w-36 h-5.5 text-kira-xs` + ternary. After `class="group/tab"`
  `:class="cn(tabChipVariants({ active: result.key === rt.activeKey }), 'max-w-36')"` (`cn` so
  `max-w-36` wins over the cva's `max-w-52`). Result: 26px, 11px.
- Strip `:877` `gap-1` becomes `gap-0.5`.
- Close `:908` `w-3.5 h-3.5` becomes `w-4 h-4`; icon `:size="11"` becomes `:size="13"` (T1's close).
- 26px chip in a 34px `h-bar`: 3.5px each side, centred by the bar's `items-center`.

**T6 TitleBar.** `:65-69` becomes `class="wails-no-drag"` + `:class="tabChipVariants({ active:
modeStore.active === mode, size: 'wide' })"`. Rendered identical.

**S1 GitPanel header** `:335`: drop `text-kira-sm text-muted-foreground uppercase tracking-wider`.
After: `flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border`. Repos/Files/Review
then render like Files/Search (fg, normal letter-spacing).

### §3.6 Declined, with the requirement each fails

- **shadcn `Tabs` for T1/T2 (TabStrip) and T4 (console results).** These are closable,
  drag-reorderable document tabs: each chip wraps a sibling close `<button>` (P105 §11 — invalid
  nested in a `role="tab"` button), handles middle-click close and drag, and scrolls horizontally.
  Their content lives in `MainView`'s keep-alive / the console result pane, not a `TabsContent`
  panel. reka `TabsTrigger` is a `<button>` with a single activation contract; it cannot host a
  sibling control. They take `tabChipVariants` only.
- **shadcn `Tabs` for T6.** Mode switch with no tab panel; `role="tab"` without `tabpanel` would be
  wrong ARIA. Takes `tabChipVariants` only.
- **Changing TabStrip height to 22px.** `--kira-control-h-lg` (26px) is the token role for tabs
  (`PT/tokens.css` comment); every document tab and dialog tab already uses it. Kept.

### §3.7 Not touched

- `KU/KuiSegmented.vue` (§2.4).
- Toggle item colour (inherits; default-variant inactive items are fg, TabStrip inactive is muted)
  — §7 Q1.
- Font sizes beyond the two named mismatches (T4 10px, S5-S8): P123's scope.

## §4 Split call, overlap, implementer

No stream split. §3.2/§3.3 change the primitive every S site renders through, and §3.5's
ConnectionDialog edit depends on §3.1's new `kira-lg` size and §3.4's `tabChipVariants`. TabStrip,
ConsoleView, TitleBar and ConnectionDialog all import `UI/tabs`, so the chip work is one chain.
One sequential Sonnet implementer.

Overlap:

- P122 landed; builds on it. `check_focus_width`/`focus-ring` must stay green — §3.4 drops the
  registry `ring-3` for that reason.
- P123 (font sizes) edits every primitive string, including `UI/toggle/index.ts` and the files in
  §3.5. Sequence P123 after P121 lands, never concurrently. §3.4's `tabChipVariants` gives P123 one
  place to change the tab label size.

## §5 Commit sequence

Fast checks per commit (§6.1). Each commit leaves both apps rendering correctly.

1. `fix(theme): key ToggleGroupItem corner/border rules on reka's data-orientation` — §3.3 plus
   §3.2's root-class selector swap. Outline groups gain 4px outer corners and a single divider;
   default groups still connected (spacing 0) at this commit.
2. `fix(theme): toggle radius onto the control tier, default groups spaced 2px` — §3.1 radius and
   §3.2 `resolvedSpacing`/`reactiveOmit`/`withDefaults` removal.
3. `feat(theme): add Toggle kira-lg size` — §3.1 size.
4. `fix(studio): connection dialog toggles at dialog density` — S5-S8 (§3.5).
5. `fix(space): stop GitPanel header styling its tabs` — §3.5 S1.
6. `feat(theme): add shadcn-vue tabs set and the shared tab-chip variants` — §3.4 (fetch, rewrite,
   `tabChipVariants`). Has no caller yet; if `bun run lint:dead` flags the unused exports, fold
   commit 7 into this one rather than suppressing.
7. `refactor(studio): connection detail tabs onto shadcn Tabs` — T5 (§3.5).
8. `refactor(workbench): TabStrip chips onto tabChipVariants, centred in the bar` — T1, T2, T3
   (both `WorkbenchShell.vue` files in the same commit; they share the `pt-0.5` offset).
9. `fix(studio): console result tabs at tab-strip size` — T4.
10. `refactor(studio): title-bar mode tabs onto tabChipVariants` — T6.
11. `chore(lint): guard tab chips and toggle-group selectors` — §6.2 lint half.
12. `test(ui): assert tab and segmented-tab radius, spacing and centring` — §6.2 UI half.
13. One `test(visual): re-record <spec> baseline for P121 tab styling` per diffing spec (§6.4),
    naming the changed element.
14. `docs: record the one tab-chip definition and ToggleGroup spacing rule` —
    `docs/ARCHITECTURE.md` Styling row (`:34`), one bold sentence in its style:
    `tabChipVariants` (`UI/tabs/index.ts`) is the only tab-chip class definition; `ToggleGroup`
    defaults outline groups to connected (spacing 0) and default groups to 2px-spaced chips, every
    item `rounded-kira-sm`; toggle-group selectors key on reka's `data-orientation`, never Base UI's
    `data-horizontal`/`data-vertical`.

Resume rule: every commit is self-contained. An interrupted run resumes from the last commit on the
P121 implementation branch; re-read this §5 for the next number.

## §6 Verification

### §6.1 Per commit (fast)

`bun run lint`, `bun run typecheck`, `bun run lint:dead`, `bun run build:test:studio`,
`bun run build:test:space`. Bindings must exist first (§0 Method).

### §6.2 Guards (new)

Lint — `scripts/check-theme-classes.sh`, modelled on `check_focus_width` (scans `$SCAN_DIRS`
including `components/ui`):

- `check_toggle_orientation`: fail on `(?<![-\w])(?:[a-z0-9-]+:)*(?:group-)?data-(?:horizontal|vertical)(?:/[\w-]+)?:`
  — Base UI's attributes reka never emits. Replacement text: `data-[orientation=…] /
  group-not-data-[orientation=vertical]/<name>`. Expected at `88943a7a`: hits in
  `ToggleGroup.vue` (2) and `ToggleGroupItem.vue` (8). Expected after commit 1: zero. Run once at
  base to prove it bites.
- Chip copy guard: fail on `h-control-lg inline-flex items-center gap-1 px-` in any `.vue` (the
  hand-rolled chip prefix). Expected at base: 8 hits (TabStrip x2, ConnectionDialog x5, TitleBar
  x1). Expected after commit 10: zero. Replacement text: `tabChipVariants
  (packages/theme/src/components/ui/tabs)`.
- Toggle radius: fail on `rounded-kira(?![-\w])` in `UI/toggle/` and `UI/toggle-group/`.
  Expected at base: 2 hits (`toggle/index.ts:7`, `ToggleGroup.vue:45`); after commit 2: zero.

UI — extend `apps/kira-studio/tests/ui/control-sizing.spec.ts` (P117/P122 precedent; its
`connectAndOpenGrid` opens a Postgres data view) and add to `apps/kira-space/tests/ui/repo-workspace.spec.ts`
(its existing repo/file fixture flow). Assertions on computed style:

| Instance | Element | Assert |
|---|---|---|
| S23 page size | `DataToolbar` group items | each `borderRadius` `4px`; adjacent item `x` gap 2px |
| S14 HTTP panes | `http-request-pane-*` items | `borderRadius` `4px`; height 22px |
| S4 row density | `settings-appearance-rowDensity-*` | first item top-left radius `4px`, top-right `0px`; last mirrored; middle-divider: second item `borderLeftWidth` `0px` |
| S5, S6 | `connection-mcp-read-*`, mode toggle | height 26px, `fontSize` `11px` |
| T5 | `connection-tab-advanced` | hover changes `backgroundColor`; list gap 2px; `ArrowRight` from focused General activates Advanced |
| T4 | `console-result-tab` (run a two-statement query, `console.spec.ts`'s own flow) | height 26px, `fontSize` `11px`, strip gap 2px |
| T1 Studio | first `tab` in `tab-strip-row` | `top - barTop` equals `barBottom - bottom` within 0.5px (bar = `tab-strip` minus its 1px `border-b`) |
| T1/T2 Space | file `tab` and pinned `tab` | same centring check |
| S1 Space | `git-panel-tab-repos` | `letterSpacing` equals `git-panel-files-*`'s (`normal`); `borderRadius` `4px` |

Confirm every row fails at `88943a7a` before keeping it (P117's rule). A UI guard on shared
tokens, not a unit test; no new unit test.

### §6.3 Phase end (once)

- `bun run test:ui:studio`, `bun run test:ui:space` — full suites. Watch `connection-dialog-tabs`,
  `tabs`, `mode-switch`, `repo-workspace`, `definition`, `http-request`, `data-view`.
- After-state screenshots (acceptance's "verified visually"). Recreate the throwaway capture spec
  per app (`tests/ui/zz-p121-shots.spec.ts`, never committed): for each §2 instance, locate it,
  screenshot a crop that includes its neighbouring non-tab control (panel-head icon buttons, dialog
  inputs, toolbar buttons), and log `getBoundingClientRect` + computed radius/padding/gap/
  font-size/letter-spacing. Capture at `88943a7a` and at the final commit; compare pairs. Run:
  `P121_OUT=<scratch dir> bunx playwright test --config=apps/<app>/playwright.config.ts --project=ui
  zz-p121-shots --reporter=line`. Delete the spec afterwards. Record the pass/fail per instance in
  the phase result section.
- Grep proofs (expected after commit 10):

```sh
rg -n 'group-data-(horizontal|vertical)/|data-(horizontal|vertical):' packages apps --glob '*.{vue,ts}' -g '!**/node_modules/**'   # none
rg -n 'h-control-lg inline-flex items-center gap-1 px-' packages apps --glob '*.vue' -g '!**/node_modules/**'                     # none
rg -n 'tabChipVariants\(' packages apps --glob '*.vue' -g '!**/node_modules/**'                                                    # TabStrip x2, ConnectionDialog x1, ConsoleView x1, TitleBar x1
rg -n "from '@theme/components/ui/tabs'" apps packages --glob '*.vue' -g '!**/node_modules/**'                                     # TabStrip, ConnectionDialog, ConsoleView, TitleBar
rg -n '<TabsTrigger|<TabsContent' apps --glob '*.vue'                                                                               # ConnectionDialog only: 1 TabsTrigger (v-for), 5 TabsContent
rg -n 'role="tablist"|role="tab"' apps packages --glob '*.vue' -g '!**/node_modules/**'                                            # none left hand-rolled
rg -n 'pt-0\.5' packages/workbench/src/components/TabStrip.vue apps/*/frontend/src/workbench/WorkbenchShell.vue                    # none
rg -n 'size="sm"' apps/kira-studio/frontend/src/project/ConnectionDialog.vue                                                       # none on a ToggleGroup
rg -n 'rounded-kira(?![-\w])' -P packages/theme/src/components/ui/toggle packages/theme/src/components/ui/toggle-group              # none
```

### §6.4 Visual baselines

Run `bun run test:visual:studio` and `bun run test:visual:space` at `88943a7a` first, untouched. If
they pass, this sandbox renders like the baselines and re-recording is safe. If they show the
uniform whole-page glyph drift `docs/DEV_ENVIRONMENT.md` §"`tests/visual/*` pixel diffs"
describes, do not re-record here; report it and leave re-recording to CI.

Then run both after commit 12. Re-record only a spec whose diff is confined to §2 instances, one
commit each, naming the element. Expected diffs (every Studio visual spec shows the tab strip, so
T1's 1.5px shift reaches all of them):

- Studio `workbench`, `data-view` (T1 + S23), `http-request-view` (T1 + S14/S10-S11), `console`
  (T1; T4 only if the capture has results), `connection-dialog` (T5 gap, S5 size), `schema-dialog`
  (T1 behind dialog, if visible), `settings` (S4 row density; T1 if the strip shows).
- Space `settings` — only if it captures S4 or the tab strip.
- A diff anywhere outside a §2 instance is a regression, not a re-record: fix it.

## §7 Open questions for the user (none block implementation)

- **Q1.** Toggle items inherit colour, so inactive default-variant items are fg while inactive
  TabStrip/dialog tabs are muted (`text-muted-foreground`). Give the toggle base
  `text-muted-foreground data-[state=on]:text-fg` to match? Colour, not radius/spacing, so outside
  this row; a follow-up row if yes.
- **Q2.** Document tabs are 26px (`--kira-control-h-lg`, the token's stated tab role) while toolbar
  segmented tabs are 22px (`--kira-control-h`). Kept as the tokens define. Unify on one height?

## §8 CodeGraph discovery record

Five `codegraph_explore` calls, all before any file `Read` of the sites they found:

1. "TabStrip tab strip component tabs Studio page tabs Space file switcher tabs" — found
   `TabStrip.vue`, both `WorkbenchShell.vue` hosts, `WB/components/WorkbenchShell.vue` wiring.
2. "Tabs TabsList TabsTrigger shadcn tabs …" — confirmed no `UI/tabs` set exists; surfaced the
   hand-rolled `role="tablist"` in `ConnectionDialog.vue` and `ConsoleView.vue`'s result strip.
3. "Kira Space repo switcher workspace tabs WorkbenchShell TabStrip …" — traced Space's repo/file
   tabs to the shared TabStrip and GitPanel's Repos/Files/Review `ToggleGroup`.
4. "ToggleGroupItem ToggleGroup callers usages pane tabs …" — primitive source plus caller list
   (cross-checked to 23 with `rg`).
5. "git-ui segmented control tab bar component KuiSegmented …" — `KuiSegmented.vue` and its
   consumers (§2.4).
