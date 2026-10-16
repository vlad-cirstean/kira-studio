# P22 — shared primitives, sizing tokens, and the cross-cutting chrome fixes

> **What this phase is.** `docs/v1.2/SPEC.md`'s P22 row is a ~20-item user batch. Following the
> P15/P15b precedent the row itself names, it is split into **three** plan documents (§0.1 justifies
> the split and the ordering). **This document is part 1**: everything that lives in
> `theme/tokens.css`, `theme/primitives.css`, `theme/primitives/*`, `editor/theme.ts`,
> `views/shared/**` and `workbench/**` — the shared layer both modes sit on. The two per-mode
> batches are `P22b-api-and-studio-polish.md`; the architectural item is
> `P22c-schema-aware-completion.md`.
>
> **Six of the row's items are "re-checks" against a prior phase.** Per the row's own instruction —
> and following `P19-connection-dialog-mongo-console-sql-tooling.md`'s header, which corrected four
> of its own row's premises against the real tree — every one was root-caused against the source at
> the base commit before any decision was written. **Five of the row's factual premises turned out
> to be wrong, and each correction changes what gets built.** They are stated in §0.3 and carried
> into the SPEC row.
>
> **Base commit.** Read against `b52fd72` (branch `claude/feature-v1-2`) — P21's three review rounds
> landed, P22-P26 are recorded as rows, and a short run of hand-made chrome-height commits
> (`cf4228e`, `fb7476e`, `fa494f2`, `54b785f`) landed **during** this investigation. Those four
> matter to item A and are not cosmetic background: they introduce `--kira-bar-h` /
> `--kira-titlebar-h` / `--kira-tabbar-h` / `--kira-toolbar-h` / `--kira-statusbar-h`, take
> `.p-toolbar` from a hard-coded 28 px to 34 px, and claim the exact token name this plan's first
> draft had reserved. F2 and D1 are written against the tree **after** them, and F2(c) is a finding
> that exists only because of them. Every `file:line` citation below points at `b52fd72`.
>
> **Precedents this matches.** `docs/v1.2/plans/P19-…md` (the premise-correction discipline and the
> findings/decisions/commits shape), `docs/v1.2/plans/P16-sql-grid-consistency-search.md` (the last
> phase to touch the toolbar and the pager), `docs/v1.2/plans/P18-…md` (the last phase to touch the
> mode tabs and `--kira-state-on`'s predecessor).

---

## 0. Scope

### 0.1 Why this is three plans, not one

P15's own row set the precedent: *"part 1: layout, primitives and body mode"* / *"part 2: input and
editor behaviour"*, split because one batch mixed shared-primitive work with per-surface work and
the two have different blast radii and different verification surfaces. P22 is materially larger
than P15 was, and it mixes **three** kinds of work whose risks do not resemble each other:

| Part | File | What it is | Blast radius | Verification surface |
|---|---|---|---|---|
| 1 | `P22-shared-primitives-and-tokens.md` (this) | tokens, primitives, `ViewChrome`, `PanelSplitter`, `editor/theme.ts`, window state | **every view in both modes** | `tests/ui` geometry/contrast cases + `scripts/check-tokens.sh` |
| 2 | `P22b-api-and-studio-polish.md` | per-surface Api and Studio items | one view each | `tests/ui` per-surface specs |
| 3 | `P22c-schema-aware-completion.md` | a new adapter capability, a new bridge method, a SQLite migration | **Go + wire + frontend** | `tests/e2e-real` + adapter conformance + `tests/ui` |

Part 1 must land **first**: parts 2 and 3 both consume tokens and primitives it introduces (the
control-height alias layer D1, the disabled-primary fix D3, the shared completion-popup block D8).
Parts 2 and 3 are independent of each other and may land in either order.

The alternative — one 20-item document — was rejected for the same reason P15 was split: a single
commit sequence mixing "recolour a token app-wide" with "add a Go adapter method" cannot be reviewed
or reverted at a useful granularity, and the row itself invites the split (*"this phase's own plan
may re-split into sub-phases, e.g. P22b, the way P15/P15b did"*).

### 0.2 The items this document owns

| # | Item (SPEC row wording, abbreviated) | Findings | Decisions | Commits |
|---|---|---|---|---|
| A | Global sizing tokens: the page-number input is taller than its neighbours; expose control height as global custom properties | F1-F4 | D1, D2 | T1, T2 |
| B | gRPC Call button's label is a low-contrast/invisible grey (the shared half — the gRPC half is P22b) | F5 | D3 | T3 |
| C | The SQL grid's pager arrows sit closer to the right edge | F6, F7 | D4 | T4 |
| D | Mode-switch icons still not aligned with their labels (**third** report) | F8, F9, F10 | D5, D6 | T5, T6 |
| E | Method select: coloured text on a neutral background, not a coloured fill | F11, F12 | D7 | T7 |
| F | Every autocomplete popup renders through one uniform style | F13, F14 | D8 | T8 |
| G | `--kira-state-on` re-picked from teal to gold/amber | F15, F16 | D9 | T9 |
| H | Console result selection matches the SQL grid's own selection look | F17, F18 | D10 | T10 |
| I | The CPU/memory status-bar tooltip trimmed to the numbers | F19 | D11 | T11 |
| J | On close, remember which module a window was in and reopen into it | F20, F21 | D12 | T12, T13 |
| K | The request/response divider is not visibly rendered — give it a real border/divider treatment | F22 | D13 | T14 |

### 0.3 Corrections this investigation makes to the SPEC row's own premises

Stated here, and mirrored into the row itself, the way P19's row records its four.

1. **"expose control height as a small set of global CSS custom properties … instead of each
   needing its own fix" — that scale already exists and every form primitive already reads it**
   (F1). `--kira-h-xs/sm/md/lg` are declared in `theme/tokens.css:105-108` and consumed by
   `.p-iconbtn`, `.p-btn`, `.p-dlgbtn`, `.p-input`, `.p-select`, `.p-seg`, `.p-tab`, `.p-row`,
   `.p-chip`, `.p-badge`, `.p-thead`, `.p-panel-head`. And the *bar* half of the same idea landed
   by hand during this investigation (`fb7476e`: `--kira-bar-h` plus four per-bar aliases, F2(a)),
   which also claims the token name this plan's first draft had reserved. What is genuinely missing
   is different and smaller: a **role** layer over the control scale, the one bar that new family
   missed, and four remaining literals that would break the moment a token is raised (F2). D1
   builds that instead.
1b. **A new inconsistency arrived with those commits, and it is a better candidate for the report
   than anything about the controls themselves** (F2(c)). `.p-toolbar` went from a hard-coded 28 px
   to `var(--kira-toolbar-h)` = 34 px; `.p-view-head` stayed at a literal 28 px. Every view now
   opens with a 28 px identity band directly above a 34 px toolbar, and the 22 px controls in the
   taller one float in twice the clearance. D1 closes the split.
2. **"the page-number input … is visibly taller than the controls beside it" — not reproducible
   from the stylesheet** (F3). Every control in that toolbar row resolves to `--kira-h-sm` (22 px)
   under one `box-sizing: border-box` (Tailwind v4 preflight, `theme/base.css:1`). The visible
   difference has a different cause — a bordered, filled 22 px box beside borderless icon buttons
   whose only ink is a 13 px glyph in a 16 px slot — and D2 both names it and ships the measurement
   that would catch a real px difference if one exists on hardware this sandbox cannot render.
3. **"the SQL grid pager … re-check against P16, which already claimed this" — P16's claim was
   wrong by ~76 px, and the cause is P16's own D2** (F6). D1 of that plan states the pager ends up
   *"~8 px from the grid's right edge"*; `ViewChrome.vue:105-109` renders `RunState` **after** the
   `#toolbar-end` group, and P16 D2 gave `RunState`'s label a permanent `min-width: 7ch` reservation
   — so the pager's last chevron sits behind ~76 px of always-present run-state chrome. A real gap,
   introduced by the same phase that claimed to close it.
4. **"the Api method select's coloured background … with the identical treatment applied to
   Studio's connections panel wherever a method/kind chip currently uses a background fill" — Studio
   has no such chip** (F12). `project/TreeRow.vue:130-147` renders a connection's engine as an
   `EngineIcon`, not a coloured chip; the only filled pill in that tree is `.p-count`, a count badge
   with no method/kind meaning. The counterpart surfaces are both in **Api** (`api/CollectionRow.vue`
   and `views/httprequest/ResponseHistoryList.vue`). D7 lands there; nothing in Studio changes.
5. **"the query console's result-selection visuals … don't match the SQL data view's" — true, and
   the cause is one specific missing layer, not a theme divergence** (F17). Both grids carry
   `.slick-grid-host` and therefore share the `--kira-select` fill; what the console lacks is the
   `sel-t/-r/-b/-l` perimeter layer, which `SlickGridHost.vue` computes itself and P19's port
   deliberately dropped along with the rest of the `setCellCssStyles` bookkeeping
   (`ConsoleSlickGrid.vue:375-377`). D10 promotes that one computation rather than restyling
   anything.

Additionally, and not a correction but worth recording: item B ("the Call button's label text is a
low-contrast/invisible grey, apparently unstyled") is **not** a gRPC bug. It is a defect in
`.p-btn:disabled` that makes **every disabled primary button in the app** render `#6e6e6e` on
`#0078d4` — a measured **1.13 : 1** contrast ratio (F5). gRPC is simply the one place a primary
button is disabled *by default*, so it is where a user finally saw it.

### 0.4 Not in scope for this document

- Every per-surface Api and Studio item — `P22b-api-and-studio-polish.md`.
- Schema-driven SQL/Mongo completion — `P22c-schema-aware-completion.md`.
- **Changing `--kira-accent`.** Item G re-picks `--kira-state-on` only, exactly as the row asks
  ("re-pick the token's value … rather than reopening the whole indicator mechanism").
- **Replacing the codicon icon font with inline SVG.** D6 records why the mode-tab fix stops short
  of that, and OQ-3 carries it forward.
- **Raising the default control height.** D1 builds the mechanism the row asks for; it does not
  change a single rendered pixel by itself (every alias resolves to today's value).

---

## 1. Findings

### F1 — The control-height scale the row asks for already exists, and everything reads it (item A)

`theme/tokens.css:105-109`:

```css
--kira-h-xs: 18px;
--kira-h-sm: 22px;
--kira-h-md: 26px;
--kira-h-lg: 30px;
--kira-icon-box: 16px;
```

with `tokens.css:87-91`'s own header calling it *"one type scale, one space scale, **one
control-height scale**, shared verbatim by every primitive in primitives.css instead of each
component inventing its own."* Consumers, read off `primitives.css` at `b52fd72`:

| Token | Selectors |
|---|---|
| `--kira-h-xs` | `.p-badge:514`, `.p-count:528`, `.p-chip:541`, `.p-status:609`, `.p-menu-label:638` |
| `--kira-h-sm` | `.p-iconbtn:36`, `.p-btn:71`, `.p-input:129`, `.p-select:374`, `.p-seg:442`, `.p-row:494` |
| `--kira-h-md` | `.p-dlgbtn:103`, `.p-input.md:147`, `.p-select.md:422`, `.p-seg.md:449`, `.p-tab:473`, `.p-panel-head:664`, `.p-thead:837` |

So the row's *"instead of each needing its own fix"* premise is already satisfied at the primitive
level. F2 is what is actually missing.

### F2 — Five heights bypass the scale, the chrome bars just got their own family, and the type scale's own comment is false (item A)

**(a) A chrome-bar token family landed mid-investigation, and it is the right half of the answer.**
`fb7476e`/`fa494f2`/`54b785f` added to `tokens.css:76-83`:

```css
--kira-bar-h: 34px;                        /* "loosely coupled … each bar can diverge later" */
--kira-titlebar-h: var(--kira-bar-h);      /* was 38px */
--kira-tabbar-h:   var(--kira-bar-h);      /* was a literal 34px in WorkbenchShell.vue */
--kira-toolbar-h:  var(--kira-bar-h);      /* was a literal 28px in .p-toolbar */
--kira-statusbar-h: 26px;                  /* was 22px */
```

with `.p-toolbar { height: var(--kira-toolbar-h) }` (`primitives.css:677-679`) and
`WorkbenchShell.vue:134`'s tab strip following. **This is exactly the shape D1 needs for the
*container* half of the problem, and it already exists** — so D1 does not invent it, it extends it,
and it must not re-claim the name `--kira-bar-h`, which now means "the chrome bars' shared height",
not "a bar tall enough to hold a control".

**(b) Five literals still bypass every scale.**

| Line | Selector | Value | Why it matters |
|---|---|---|---|
| 742 | `.p-view-head` | `28px` | the identity band, **the one chrome bar the new family missed** — see (c) |
| 277/285 | `.p-check` / its `input` | `14px` | a checkbox stays 14 px however tall its row grows |
| 698 | `.p-toolbar .sep` | `14px` | a separator sized against the old 28 px bar |
| 727 | `.p-tab-rail` | `14px` | ditto |
| 931 | `.p-empty .big` | `24px` | an empty-state glyph box |

Plus `--kira-icon-box: 16px`, which is a token but is not a *step* of the height scale and does not
move with it.

**(c) The just-landed change split two bands that were identical, and it is very likely the report.**
Before `fb7476e`, `.p-toolbar` and `.p-view-head` were both `28px` — the two horizontal bands every
view stacks, drawn to one rhythm. After it, `.p-toolbar` is **34 px** and `.p-view-head` is still
**28 px**, so every view now opens with a 28 px identity band directly above a 34 px toolbar, and a
22 px control sits with 3 px of clearance in one and 6 px in the other. A 22 px filled input floating
in 6 px of space in a 34 px bar, beside 22 px transparent icon buttons, is a far better candidate for
*"visibly taller than the controls beside it"* than any height difference between the controls
themselves — F3 shows there is none. D1 closes the split; D2 measures whether anything is left.

The separator (`.p-toolbar .sep`, 14 px) is the same story one level down: a 14 px hairline drawn for
a 28 px bar now sits in a 34 px one, at 41 % of its height instead of 50 %.

**(d) The type scale does not track the Appearance setting the way its own comment claims.**
`tokens.css:95-98` says *"`--kira-t-md` tracks the user's Appearance font-size setting; **the other
three steps are fixed offsets from it** so the scale never falls out of sync with that setting."*
They are not offsets — they are absolute literals (`--kira-t-xs: 10px`, `--kira-t-sm: 11px`,
`--kira-t-lg: 13px`), and only `--kira-t-md: var(--kira-font-size)` moves. `state/settings.ts:20-27`
writes `--kira-font-size`, `--kira-font-family` and `--kira-row-height` and nothing else. So a user
who raises Appearance → font size from 12 px to 18 px grows grid cells, tree rows and view targets
(`--kira-t-md`) while every button, input, select, chip and tab label stays at 10/11/13 px inside a
22/26 px box. **That is the real "raising one token should raise the family together" gap** on the
*control* side, and it is the one D1 closes alongside (a)-(c).

### F3 — Every control in the pager's own toolbar row is the same height (item A)

Measured from the stylesheet, at the default 12 px font, for the row `DataView.vue:235-283` renders:

| Control | Rule | Height | Box model |
|---|---|---|---|
| `IconButton` ×4 (pager arrows) | `.p-iconbtn` `primitives.css:36` | `--kira-h-sm` = 22 | border-box, no border |
| page-number `TextField` | `.p-input` `primitives.css:129` | `--kira-h-sm` = 22 | border-box, 1 px border **inside** the 22 |
| `p-chip` (pending) | `.p-chip` `primitives.css:541` | `--kira-h-xs` = 18 | border-box |
| `SegmentedControl` (page size) | `.p-seg` `primitives.css:442` | `--kira-h-sm` = 22 | border-box, 1 px border inside |

`box-sizing: border-box` applies to every element: `theme/base.css:1` is `@import "tailwindcss"`
(v4.3.3, `package.json:54`/`:69`), whose preflight sets it on `*, ::before, ::after, ::backdrop`.
`PagerControls.vue`'s own `.page-input :deep(.p-input)` overrides only `width` and `padding`
(`PagerControls.vue:130-137`), never `height`.

So the two boxes are the same 22 px, in a bar that is now 34 px (F2(a)) rather than the 28 px it was
designed for. What *is* different is visual mass: `.p-input` paints a
`--kira-bg-input` fill and a `--kira-border-strong` border across its whole 22 px, while
`.p-iconbtn` at rest is fully transparent and its only ink is a 13 px codicon centred in a 16 px
`.icon-box`. **This sandbox cannot render the app** to settle it (no `wails3`, no `node_modules`, no
Playwright browser), so D2 ships a measurement rather than a guessed pixel change.

### F4 — `scripts/check-tokens.sh` is what constrains how a new token may be introduced (item A)

Run by `bun run lint`: every `var(--kira-*)` reference under `frontend/src` must resolve to a
definition in `theme/{tokens,base,primitives}.css`. So D1's alias layer has to be declared in
`tokens.css`, not inlined at a call site — the same constraint P19 D17 recorded for
`--kira-state-on`.

### F5 — A disabled primary button renders at 1.13 : 1 contrast, app-wide (item B)

`primitives.css:91-98`, in source order:

```css
.p-btn.primary            { background: var(--kira-accent); color: var(--kira-accent-fg); }
.p-btn:disabled,
.p-btn.is-disabled        { color: var(--kira-fg-disabled); cursor: default; }
```

`.p-btn.primary` and `.p-btn:disabled` have **identical specificity** (0,2,0) and `:disabled` is
declared later, so on a disabled primary button the cascade keeps `background: var(--kira-accent)`
(`#0078d4`) and takes `color: var(--kira-fg-disabled)` (`#6e6e6e`, `tokens.css:13`). Relative
luminances: `#6e6e6e` → 0.156; `#0078d4` → 0.182. Contrast = (0.182 + 0.05) / (0.156 + 0.05) =
**1.13 : 1**. The label is invisible, not merely low-contrast.

`.p-dlgbtn` does **not** have this problem: `primitives.css:118-121` disables with
`opacity: 0.45`, which dims the fill and the label together.

Every `<AppButton variant="primary">` in the app is affected the moment it is disabled — ten call
sites (`grep -rn 'variant="primary"'`): `workbench/{GenerateDataDialog:356,ConfirmDialog:33,
UploadObjectDialog:127,SettingsDialog:599}`, `views/shared/FilterHistoryMenu:213`,
`views/httprequest/HttpRequestView:335`, `views/keyvalue/KeyValueView:{724,763,831}`,
`views/grpcrequest/GrpcRequestView:317`. `IconButton`'s `tone="primary"` (`IconButton.vue:11,31`)
takes the same shape and needs the same check.

**Why gRPC is where it was reported.** `GrpcRequestView.vue:319` disables Call on
`running || !tab.state.service || !tab.state.method` — a freshly opened gRPC tab has neither, so the
button is disabled *from the moment the tab opens*. `HttpRequestView.vue:336`'s Send is
`:disabled="running"`, i.e. disabled only for the duration of a request. Same defect, one surface
shows it permanently.

### F6 — `RunState` sits to the pager's right and reserves ~76 px unconditionally (item C)

`ViewChrome.vue:100-110`:

```html
<slot name="toolbar" />
<span class="p-push" />
<div class="group"><slot name="toolbar-end" /></div>
<RunState :status="…" :elapsed-ms="…" />      <!-- after toolbar-end -->
```

and `DataView.vue:266-283` puts `PagerControls` last inside `#toolbar-end`. So the render order at
the right edge is `… pager-last ▸ RunState ▸ .p-toolbar padding-right`.

`RunState`'s own width, from `primitives.css:766-787`: `.p-run-state` is a flex row of
`.label` + `.ring` with `gap: var(--kira-s-2)` (4 px); `.label` carries `min-width: 7ch` (P16 D2's
own reservation, so an elapsed figure ticking from `1 ms` to `9999 ms` cannot reflow), and `.ring`
is 11 px. `--kira-font-family` is a monospace stack, so `7ch` ≈ 7 × 7.2 px ≈ 50 px at the 11 px
`--kira-t-xs`. Plus `.p-toolbar`'s own `gap: var(--kira-s-3)` (6 px) before it and
`padding: 0 var(--kira-s-4)` (8 px) after it: **≈ 76 px between the last pager chevron and the
grid's right edge, always, whether or not anything has ever run.** P16 D1's *"~8 px from the grid's
right edge"* counted only `.p-toolbar`'s padding and did not account for the `RunState` its own D2
had just given a fixed reservation to, in the same phase.

### F7 — The pager's position is inconsistent between the two views that host it (item C)

`views/shared/page/PagerControls.vue` has exactly two consumers:

- `views/grid/DataView.vue:268` — `#toolbar-end` (right group), P16 D1.
- `views/documents/DocumentView.vue:635` — `#toolbar` (left group), never moved.

So the SQL grid and the Mongo collection view disagree about where paging lives. The row names the
SQL grid; leaving the document view behind would create the second half of the same complaint.

### F8 — The mode-tab fix and its guard both operate on the *box*, and the ink is what a user sees (item D)

`workbench/TitleBar.vue:30-31` (P18 D15):

```html
<span class="icon-box"><CodiconIcon :name="MODES[mode].icon" :size="13" /></span>
<span class="mode-label">{{ MODES[mode].label }}</span>
```

with `.icon-box` a 16 × 16 flex-centred box (`primitives.css:25-32`) and `.mode-label` given
`line-height: 1` (`TitleBar.vue:145-147`). P18 D15's own comment states the trade-off explicitly:
*"A 16px flex-centred icon-box centres **the advance, not the ink**, making the slot
glyph-independent."*

`tests/ui/mode-switch.spec.ts:171-192` is P18's guard, and it asserts:

```ts
const iconBox = await tab.locator('.icon-box').boundingBox();
const labelBox = await tab.locator('.mode-label').boundingBox();
expect(Math.abs(iconCentre - labelCentre)).toBeLessThanOrEqual(1);          // (a)
const studioGap = studio.labelBox.x - (studio.iconBox.x + studio.iconBox.width);
expect(Math.abs(studioGap - apiGap)).toBeLessThanOrEqual(0.5);              // (b)
```

Both hold **by construction**: `.icon-box` is a fixed 16 × 16 element centred by
`align-items: center`, and the gap is measured from that fixed box's edge, so it is identical on
both tabs whatever glyph is inside. Neither assertion can observe the glyph's ink. **A third report
of the same complaint after two box-level fixes and a by-construction guard is exactly what this
predicts** — the item is not closed, and its guard cannot tell anyone so.

### F9 — Two mechanisms can leave the ink off-centre, both citable (item D)

**(a) Horizontal.** `@vscode/codicons`' own `codicon.css` sets
`font: normal normal normal 16px/1 codicon` on `.codicon[class*='codicon-']`;
`theme/CodiconIcon.vue:9` overrides only `font-size`, to 13 px here. The codicon glyph set is drawn
on a 16-unit grid, so at 13 px a glyph's advance is ~13 px inside a 16 px box — 1.5 px of slack per
side — and each glyph's ink is not symmetric within its own advance. P18 F18's own measurement is
the evidence: `database`'s right side bearing is 2.4 px and `globe`'s is 0.8 px. Centring the
advance leaves those bearings untouched, so the *visible* ink-to-label distance still differs
between the two tabs by ~0.8 px, and neither matches the declared 4 px gap.

**(b) Vertical.** `.mode-label`'s `line-height: 1` makes the label box exactly `--kira-t-sm`
(11 px) tall with the font box centred in it, so the label's *ink* centre sits wherever Menlo's
ascent/descent asymmetry puts it; the icon's 13 px line box is centred in the 16 px `.icon-box`,
and where the codicon ink sits inside *that* depends on the icon font's own ascent/descent. Two
different fonts, two different ink offsets, one shared `align-items: center` — the classic
icon-font baseline problem, and nothing in the current CSS compensates for it.

Neither can be measured in this sandbox (F3's own constraint), which is why D5 ships a measurement
that can, before D6 changes a number.

### F10 — The same `.icon-box` + 13 px pairing is used app-wide (item D)

`grep -c ':size="13"'` across `frontend/src`: 60+ call sites, every one of them an icon beside text
inside an `.icon-box` — `AppButton.vue:29`, `IconButton.vue`, `ViewHeader.vue:35-39`,
`TreeRow.vue:127-135`, `MethodSelect.vue:44`. So whatever D6 decides is a decision about the app's
one icon convention, not about two buttons. This is why D6 stops where it does and OQ-3 exists.

### F11 — `.p-method` paints a tinted background *and* the text (item E)

`primitives.css:570-605`: eight rules of the shape

```css
.p-method.get { background: color-mix(in srgb, var(--kira-method-get) 16%, transparent);
                color: var(--kira-method-get); }
```

with the header comment (`:571-573`) placing it *"at the same weight a status chip does"*, i.e.
deliberately matching `.p-chip.warn/.err/.ok/.info` (`:551-568`), which are also 16 %-tinted fills.

`MethodSelect.vue:36` composes `.p-method` onto `.p-select.bordered`, whose own
`background-color: var(--kira-bg-input)` (`primitives.css:414`) is then overridden by the tint,
because `.p-method.get` is declared later at equal specificity. So the trigger button is a tinted
pill, which is precisely the treatment the row reports as the problem.

### F12 — Studio has no method/kind chip to convert (item E)

`.p-method`'s four consumers, by grep: `MethodSelect.vue:36` (the select trigger), `MethodSelect
.vue:58` (each menu row), `views/httprequest/HttpRequestView.vue:288` (the head chip),
`views/httprequest/ResponseHistoryList.vue:170` (each history row), `api/CollectionRow.vue:134`
(each tree row). **All five are Api.**

Studio's connections panel is `project/ProjectTree.vue` → `project/TreeRow.vue`, whose connection
row renders a status dot plus an `EngineIcon` (`TreeRow.vue:130-135`) — P16's design-system LAW
already moved connection identity to a 2 px rail and an icon, explicitly *"not a badge on one row"*
(`TreeRow.vue:38-41`). The only filled pill in that tree is `.p-count` (`TreeRow.vue:146`), a
solid `--kira-badge` count with no method or kind meaning. Nothing there is in scope.

### F13 — There are two autocomplete popups with two different looks (item F)

| | `AutocompleteField.vue` (plain fields) | CodeMirror (`editor/theme.ts`) |
|---|---|---|
| Container | `.autocomplete-suggestions p-float` (`:415`) → `.p-float` chrome (`primitives.css:630-636`: `bg-elevated`, `border-strong`, `--kira-radius`, `--kira-shadow-dialog`) **plus** `padding: var(--kira-s-1)`, `min-width: 200px`, `max-width: min(480px,90vw)`, `max-height: 240px` (`:507-518`) | `.cm-tooltip.cm-tooltip-autocomplete` (`theme.ts:52-58`) — same four chrome properties, **no padding, no min/max width, no max height** |
| Row | `display:flex; gap:s-2; padding: s-2 s-3; border-radius: radius-sm; font-size: t-sm` (`:519-528`) | `> ul` gets only `font-family` + `font-size: t-sm` (`theme.ts:59-62`); rows are the library's own `li` — no padding rule, no radius |
| Selected row | `.is-active` (`:530`) | `li[aria-selected]` → `--kira-select` (`theme.ts:63-66`) — same token, different metrics |
| Icon | `<CodiconIcon :size="13" class="sugg-icon">`, `--kira-fg-muted` (`:415-425`, `:534-537`) | **none themed.** `.cm-completionIcon-*` is unstyled, so CodeMirror's own default `::after` glyphs (`ƒ`, `○`, …) render in the library's default sizing |
| Detail | `.sugg-detail { margin-left: auto }` — right-aligned (`:540+`) | `.cm-completionDetail` (`theme.ts:67-70`) — inline after the label, `font-style: normal` |
| Match highlight | none | `.cm-completionMatchedText` → `--kira-syntax-function` (`theme.ts:71-74`) |

So: the same tokens, genuinely different metrics, a different icon vocabulary in one and none in the
other, and detail on opposite sides of the row. Both are reachable from the same request builder
within two keystrokes of each other (a header-name field and the body editor).

### F14 — CodeMirror draws its own list, so "one component" is not available (item F)

`@codemirror/autocomplete`'s tooltip renders its own `<ul>/<li>` inside the editor's own tooltip
layer; there is no seam to hand it a Vue component. `optionClass` and `addToOptions` can add classes
and DOM to each row, and `type` maps to `.cm-completionIcon-<type>`. So the achievable goal is *one
set of tokens, metrics and icons*, expressed twice — which is what D8 specifies, and D8 says so
rather than promising a single component.

### F15 — `--kira-state-on` today, and every colour a gold/amber re-pick has to clear (item G)

`tokens.css:32-39` (P19 D17): `--kira-state-on: #4ec9b0`, chosen at ≈168° because *"the one region
no syntax token, and no other state colour occupies."* Four consumers:
`primitives.css:190` (`.ph.ph-active`), `IconButton.vue:87` (`.has-indicator` dot),
`views/stream/StreamView.vue:709` (partition button). (`slickTheme.css:531` explicitly records that
the sort chevron was **excluded** from P19 D19's sweep.)

Occupied warm hues, with values:

| Token | Value | Hue | Meaning today |
|---|---|---|---|
| `--kira-warn` | `#cca700` | ≈78° | warning **and** `--kira-search-match`(`:30`) **and** `--kira-search-match-current`(`:31`) **and** the unresolved-`{{variable}}` colour (`editor/theme.ts:139`) **and** the "editing" chip |
| `--kira-syntax-function` | `#dcdcaa` | ≈60° | function names, and `.cm-completionMatchedText` |
| `--kira-conn-amber` | `#bca260` | ≈44°, low chroma | connection identity (LAW 07) **and** `--kira-method-put` (`:138`) |
| `--kira-conn-orange` | `#d1966d` | ≈26°, low chroma | connection identity **and** nothing else |
| `--kira-syntax-string` | `#ce9178` | ≈22° | string literals |

**So a naive "make it `--kira-warn`" is not available**: three of `--kira-state-on`'s consumers sit
inside or beside a search-highlight surface, and `--kira-warn` is already the search-match colour.
P19 F29 recorded the same objection for the same reason.

### F16 — What a gold/amber re-pick has to satisfy, and one value that does (item G)

Constraints: ≥ 4.5 : 1 on both `--kira-bg-input` (`#313131`) and `--kira-bg` (`#1f1f1f`); ≥ 25° of
hue separation from `--kira-warn` and from `--kira-syntax-string`; visibly more saturated than
`--kira-conn-amber`/`--kira-conn-orange`, which LAW 07 reserves for connection identity; and not a
value already present in the repo.

`#e0a33c` (hue ≈ 34°) satisfies all of them. Relative luminance 0.4257; against `#313131`
(L 0.0301) that is **5.94 : 1**, against `#1f1f1f` (L 0.0129) **7.56 : 1**. It is 44° from
`--kira-warn`, 12° from `--kira-syntax-string`'s hue but far above it in chroma and lightness, and
does not appear anywhere under `apps/`, `packages/`, `docs/` or `scripts/` (grepped). OQ-2 records
that the exact hex is the user's judgement, not this plan's.

### F17 — What the console's selection is missing, exactly (item H)

Both grids' roots carry `class="slick-grid-host"` (`SlickGridHost.vue:2393`,
`ConsoleSlickGrid.vue:798`), so both pick up `views/shared/slick/slickTheme.css`'s
`.slick-grid-host .kira-cell-selected { background: var(--kira-select); }` (`:468-470`). The fill
matches.

What does not: `slickTheme.css:472-500` defines a four-sided inset-box-shadow perimeter switched on
by the classes `sel-t` / `sel-r` / `sel-b` / `sel-l`, drawn in `--kira-focus`, so a multi-cell
selection reads as one outlined block rather than a flat wash. Those classes are put on cells by
**`SlickGridHost.vue`'s own `computeSelEdgesHash` + `setCellCssStyles` layer**, which
`ConsoleSlickGrid.vue:375-377` explicitly removed in P19's port: *"the one-cell `kira-cell-selected`
bookkeeping this used to carry (selectedRow/selectedField/setCellCssStyles) is gone —
`selectedCellCssClass` now makes SlickGrid itself paint the selection."*

So today: data grid = fill **+** focus-coloured perimeter; console = fill only. That is the whole
divergence, and it is one computation, not a stylesheet difference.

### F18 — The promotion has a precedent and a lint rule behind it (item H)

`biome.json:78-100` makes `views/<kind>/*` importing another `views/<kind>/*` an error
(*"SPEC §11: views/&lt;kind&gt;/* must not import another views/&lt;kind&gt;/* — use views/shared/
instead"*). P19 D7 already moved `clipboardFormats.ts` and `slick/selection.ts` into
`views/shared/slick/` for exactly this reason. The edge computation follows the same path.

### F19 — The metrics tooltip is three sentences, two of which are an essay (item I)

`workbench/StatusBar.vue:34-42`:

```
`${cpu} of ${logicalCPUs} CPU cores · ${mem} memory footprint across ${processCount} processes ·
 updated every 5s. Activity Monitor's own per-process "% CPU" column is not normalized and reads
 up to ${logicalCPUs}x higher for the same load.`
```

At 8 logical cores that renders as ~200 characters in a hover panel whose `max-width` is 360 px
(`editor/theme.ts:117` for the editor's own; the workbench tooltip is `AppTooltip.vue`) — four to
five wrapped lines. The comment above it (`:30-33`) explains the second sentence exists as a
cross-check against Activity Monitor. The numbers are the part a user reads; the essay is the part
the row asks to drop.

### F20 — Mode is derived, deliberately, and is not persisted anywhere (item J)

`state/mode.ts:10-14`: `modeState = reactive({ active: 'studio' })`, with P1 D5's own note —
*"mode is a derived view over the one tab list, not a second state tree … Switching mode touches no
TabRecord, schedules no save, issues no IPC: it is a selection."* `tests/ui/mode-switch.spec.ts:
117-122` asserts that invariant explicitly (no `tabsSave` fires from two mode clicks). So every
window opens in `studio`, always. D12 must add persistence **without** making a mode *switch* write
— the invariant that test pins is about the switch, not about the shutdown.

### F21 — `ui_layout` is global; `windows` is the per-window table (item J)

- `storage/repos/layout.go:11-14`: `ui_layout` is a flat `(key, value)` table with no window
  column; `packages/shared/domain/layout.ts` carries only the three panel sizes. **Layout is not
  per-window**, so the row's *"per window"* cannot be served from there.
- `storage/migrations/0002_p8_windows.sql:7-11`: `windows (key TEXT PRIMARY KEY, "order" INTEGER
  NOT NULL, bounds_json TEXT)`, with `model.WindowRecord{Key, Order, Bounds}`
  (`storage/model/window.go:16-20`) and `repos/windows.go`'s `List/Exists/Create/EnsureExists/
  SetBounds/Delete`.
- `tabs` is already window-scoped (`repos/tabs.go:13`, `WHERE window_key = ?`).

Precedent for the migration shape: `0011_p17_variable_description.sql` and
`0012_p18_environment_color.sql` are both single-column additions to an existing table.

### F22 — Every `PanelSplitter` in the app is fully transparent at rest (item K)

`theme/primitives/PanelSplitter.vue`'s entire stylesheet:

```css
.splitter        { background: transparent; }
.splitter:hover,
.splitter:active { background: var(--kira-focus); }
```

There is no border, no hairline, and no rest state of any kind — the track is visible **only while
the pointer is over it or dragging it**. Five consumers:

| Consumer | Track | Is the boundary visible at rest? |
|---|---|---|
| `workbench/WorkbenchShell.vue:38` (project panel) | a grid gap column, `--kira-gap` | yes — the gap is a groove between two `.panel-surface` boxes on the shell's own ground |
| `workbench/WorkbenchShell.vue:53` (operations panel) | a grid gap row | yes, same |
| `views/shared/celleditor/CellEditorDock.vue:22` | `height: var(--kira-s-2)`, 4 px | yes — but **not from the splitter**: `.cell-dock` below it carries `border-top: var(--kira-border-width) solid var(--kira-border)` (`:56`) |
| **`views/httprequest/HttpRequestView.vue:420`** | `.request-splitter { height: var(--kira-s-2) }` (`:480-483`) | **no** |
| **`views/grpcrequest/GrpcRequestView.vue:392`** | the same rule (`:446-449`) | **no** |

`.request-pane` (`HttpRequestView.vue:470-475`) has no `border-bottom` and `.response-pane-slot`
(`:491-494`) has no `border-top`. So the Api request/response boundary is **4 px of nothing** — the
two panes share one background and simply abut, with no line, no shading and no grab affordance
until the cursor happens to cross it. That is the item, exactly, and it is a shared-primitive gap
that `CellEditorDock` happened to work around locally and the two request views did not.

The `.request-splitter` comment in both views already names the asymmetry that caused it — *"the
workbench grid gives a splitter its size from a gap row; inside a view there is no gap band, so the
track carries its own explicit height"* — and stops at height, never reaching colour.

---

## 2. Decisions

### D1 — A control-role layer beside the bar-role layer that just landed, and the leftover literals move onto both (item A, F1, F2)

`fb7476e` already built the **bar** half of what the row asks for (F2(a)): a `--kira-bar-h` root and
four per-bar aliases pointed at it, each free to diverge later. D1 does the **control** half in the
same shape, and finishes the bar half's own two gaps.

`theme/tokens.css` gains one block, declared immediately after the `--kira-h-*` steps so the scale
and its roles read as one unit:

```css
/* P22 D1: the *control* half of the role layer --kira-bar-h (above) is the *bar* half of. The
   --kira-h-* scale is the vocabulary of sizes that exist; these name which size each family of
   controls uses, so "make every form control one step taller" is one edit here rather than
   re-picking a step in a dozen rules (tokens.css's own scale comment already claimed this
   property; it was true of the steps and not of the roles). Every alias resolves to exactly what
   its consumers used at b52fd72 — this commit changes no rendered pixel. */
--kira-control-h: var(--kira-h-sm);          /* toolbar density: input, select, segmented, button, icon button, row */
--kira-control-h-lg: var(--kira-h-md);       /* dialog density: .md variants, dialog button, tab, panel head, table head */
--kira-control-h-sm: var(--kira-h-xs);       /* chip / badge / count / status density */
--kira-control-inline-h: 14px;               /* drawn inside a control or a bar: checkbox box, toolbar separator, tab rail */
```

and the bar family gains the one bar it missed, in `fb7476e`'s own idiom:

```css
--kira-viewhead-h: var(--kira-bar-h);        /* .p-view-head — was a literal 28px (F2(c)) */
```

`primitives.css` then swaps consumers onto the roles:

- `--kira-h-sm` → `var(--kira-control-h)` in `.p-iconbtn:36`, `.p-btn:71`, `.p-input:129`,
  `.p-select:374`, `.p-seg:442`, `.p-row:494` (and `.p-iconbtn`'s `width`).
- `--kira-h-md` → `var(--kira-control-h-lg)` in `.p-dlgbtn:103`, `.p-input.md:147`,
  `.p-select.md:422`, `.p-seg.md:449`, `.p-tab:473`, `.p-panel-head:664`, `.p-thead:837`.
- `--kira-h-xs` → `var(--kira-control-h-sm)` in `.p-badge:514`, `.p-count:528`, `.p-chip:541`,
  `.p-status:609`, `.p-menu-label:638`.
- `.p-view-head:742`'s `28px` → `var(--kira-viewhead-h)`. **This is the one place D1 changes a
  rendered pixel** — 28 → 34 — and it is deliberate: F2(c) shows `fb7476e` split two bands that had
  been identical, and leaving the identity band 6 px shorter than the toolbar directly beneath it is
  the inconsistency, not the fix. Called out on its own line in T1's commit body, and pinned by a
  `tests/ui` case asserting the two bands report the same height (§4.3 case 2b).
- `.p-check:277`/`:285`, `.p-toolbar .sep:698` and `.p-tab-rail:727` → `var(--kira-control-inline-h)`.
- `.p-empty .big:931`'s 24 px stays a literal and gets a one-line comment saying why (it is an
  empty-state illustration, not a control — the one place the row's "same family" does not reach).

**`--kira-bar-h` is not redefined.** The first draft of this plan proposed the same name for
`calc(--kira-control-h + --kira-s-3)`; `fb7476e` claimed it first, for a different and reasonable
meaning ("the chrome bars' shared height"), and two meanings on one name is worse than either. The
relationship between the two families — *a bar must be taller than the tallest control it hosts* —
is recorded as a comment on `--kira-bar-h` rather than as a `calc()`, because `fb7476e`'s own comment
is explicit that each bar should stay free to diverge to a literal, and a derived root would take
that away.

**And the type scale's comment is made true** (F2(d)): `--kira-t-xs`/`-sm`/`-lg` become real offsets
from the Appearance setting rather than literals, so raising the font size raises control labels
with it:

```css
--kira-t-xs: calc(var(--kira-font-size) - 2px);   /* 10px at the 12px default — unchanged */
--kira-t-sm: calc(var(--kira-font-size) - 1px);   /* 11px — unchanged */
--kira-t-md: var(--kira-font-size);
--kira-t-lg: calc(var(--kira-font-size) + 1px);   /* 13px — unchanged */
--kira-t-xl: var(--kira-t-lg);                    /* NO: see below */
```

`--kira-t-xl` (20 px) stays a literal: it is used for empty-state headings, not controls, and
deriving it would make a font-size bump grow a heading by the same absolute amount as body copy,
which is the wrong ratio. Recorded in a comment rather than left as an inconsistency.

**At the 12 px default every value above is byte-identical to today's, with the single, stated
exception of `.p-view-head`.** That is the property this commit is required to have, and T1's test is
what pins it.

*Alternative considered and rejected:* redefining `--kira-h-sm` itself to `calc()` off the font
size. It couples "how tall is a control" to "how big is the text", which is only sometimes the
relationship the design wants (a 22 px control with 11 px text is a deliberate 2:1), and it would
change every rendered height the moment the user touches Appearance — a much larger behaviour change
than the row asks for. The alias layer keeps the two independent and makes each one editable.

### D2 — The height complaint is measured before it is fixed (item A, F3)

Two things land, in this order:

1. **A `tests/ui` measurement, `control-sizing.spec.ts` (new file).** Open a data tab; for the
   toolbar row that hosts the pager, read `getBoundingClientRect().height` for
   `[data-testid="pager-page-input"]`'s closest `.p-input`, each `[data-testid^="pager-"]`
   `.p-iconbtn`, and `[data-testid="toolbar-search"]`; assert all are equal to within 0.5 px, and
   that each equals the computed value of `--kira-control-h` on `:root`. Repeat inside
   `SettingsDialog` for the `.md` family against `.p-dlgbtn`.
2. **Only what that test finds.** If the heights are equal (which F3's reading of the cascade
   predicts), **no height changes** — the honest answer is that the boxes match and the perceived
   difference is visual weight, which D2's second half addresses. If they are not equal, the test
   names the offender and the fix is whatever that rule is.

**The visual-weight half, which lands either way:** in a toolbar, the page-number box is the only
bordered, filled control in a row of transparent icon buttons. `PagerControls.vue` gets a
`.page-input :deep(.p-input)` rule that drops the fill and border at rest and restores both on
`:focus-within` / `:hover` —

```css
.page-input :deep(.p-input:not(:focus-within):not(:hover)) {
  background: none;
  border-color: transparent;
}
```

— so at rest the pager reads as five controls of one weight, and the moment a user reaches for it
the affordance is fully there. This is the same "engaged control" idiom `.p-select` (borderless by
default, `.bordered` opt-in, `primitives.css:373-419`) already establishes; it is not a new
convention.

*Why not simply shrink the input:* nothing to shrink — F3 shows it is already 22 px. Guessing a
pixel change against an unmeasured complaint is what produced P16's own 8-px correction (recorded in
the P16 SPEC row); this phase measures first, deliberately.

### D3 — A disabled control never keeps a filled background it can no longer be read on (item B, F5)

`primitives.css`:

```css
/* P22 D3: was `color: var(--kira-fg-disabled)` alone, which on a .primary button left #6e6e6e on
   the accent fill — 1.13:1, an invisible label (P22 F5). .p-dlgbtn's own :disabled has always
   used opacity for exactly this reason; this brings .p-btn/.p-iconbtn onto the same rule, which
   dims the fill and the label together and can never invert a contrast ratio whatever the tone. */
.p-btn:disabled,
.p-btn.is-disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}
.p-btn.primary:disabled,
.p-btn.primary.is-disabled {
  color: var(--kira-accent-fg);
  opacity: 0.45;
}
```

and the identical pair for `.p-iconbtn.is-primary` (`IconButton.vue:31`'s class). Two rules rather
than one blanket `opacity` on every disabled button, because a *borderless* disabled button already
reads correctly with `--kira-fg-disabled` and dimming it further would push it under 3:1 against the
toolbar; only the filled variants have the inversion.

`0.45` is not a new number — it is `.p-dlgbtn:disabled`'s own (`primitives.css:118-121`), which has
been the app's disabled-filled-button treatment since P3.

**This is a shared-primitive fix and it lands here, not in the gRPC view.** P22b's gRPC item is
reduced to the method-select width alone; its Call-button half is closed by this commit, which is
recorded in that plan.

### D4 — `RunState` moves ahead of `#toolbar-end`, so the pager really is last (item C, F6, F7)

`ViewChrome.vue`'s toolbar row is reordered:

```html
<slot name="toolbar" />
<span class="p-push" />
<RunState :status="runState.status" :elapsed-ms="runState.elapsedMs" />
<div class="group"><slot name="toolbar-end" /></div>
```

- **LAW 12 is preserved, not weakened.** Its requirement is that work-in-progress is *"a ring and an
  elapsed time in the toolbar that started it"* and that it *"must never be able to reflow controls
  to its left"*. After this move it has nothing to its left but the push, and P16 D2's `7ch`
  reservation keeps it from reflowing what is now to its *right* either. `ViewChrome.vue:105-109`'s
  comment is rewritten to say this rather than deleted.
- **Every `#toolbar-end` consumer gains the same property**, not just the grid: the pending-changes
  group, the console's own trailing controls, and the document view's after D4's second half.
- **Second half:** `DocumentView.vue` moves its `PagerControls` from `#toolbar` to `#toolbar-end`
  (F7), so both consumers of the shared pager agree. Its `#toolbar` keeps everything else.

After this the last chevron sits `--kira-s-4` (8 px) from the view's right edge — which is what P16
D1 said and did not deliver.

*Alternative considered and rejected:* hiding `RunState` when idle. It reintroduces exactly the
reflow LAW 12 exists to prevent (the pager would shift left by ~65 px the instant a query starts),
and P16 D2 fixed that same class of bug two phases ago.

### D5 — The mode-tab guard is replaced with one that can actually fail (item D, F8, F9)

`tests/ui/mode-switch.spec.ts`'s P18 D15 case is rewritten rather than deleted, since its subject
(mode-tab alignment) is the item. Both of its assertions are replaced with an **ink** measurement:

```ts
// Clip a screenshot to each tab, then find the ink: for each column of pixels, the topmost and
// bottommost pixel that differs from the tab's own background. The icon's ink column range and
// the label's ink column range are separated by the widest all-background gap in the middle of
// the tab; their vertical ink centres are what a user reads as "aligned".
```

Playwright's `locator.screenshot()` plus a PNG decode is the mechanism (`tests/ui` already runs a
real Chromium against a static build; no new dependency — `pngjs` is not present, so the decode uses
the raw `ImageData` obtained by drawing the buffer into an `OffscreenCanvas` inside
`page.evaluate`, which needs no package at all). Assertions:

1. `|iconInkCentreY − labelInkCentreY| ≤ 1` on both tabs.
2. `|studioInkGap − apiInkGap| ≤ 1`, where the ink gap is the icon's right-most ink column to the
   label's left-most ink column.

**This test is expected to fail at `b52fd72`.** That is the point: it is written before D6 and it is
what tells the implementer which of F9's two mechanisms is real, and by how much. D6 is applied
against its output, not against a guess.

### D6 — The icon is rendered at its own design size, and the label stops fighting its line box (item D, F9)

Two changes, both minimal, both applied only after D5's measurement says which axis is off:

1. **Horizontal (F9(a)):** the mode-tab icon renders at `--kira-icon-box` (16 px) rather than 13 px
   — `<CodiconIcon :size="16">` — so the codicon's own 16-unit design grid and its 16 px slot
   coincide and there is no sub-scaled slack for a side bearing to sit unevenly in. This is a
   **mode-tab-local** change (`TitleBar.vue:30`), not an app-wide one: F10 counts 60+ other
   `:size="13"` call sites, and re-sizing the app's whole icon vocabulary on the strength of one
   title-bar complaint is not proportionate. OQ-3 carries the general question.
2. **Vertical (F9(b)):** `.mode-label`'s `line-height: 1` is replaced with
   `line-height: var(--kira-control-inline-h)` — a shared, even line box for both flex items — and
   the `.icon-box` gets `line-height: var(--kira-control-inline-h)` too, so the two children are
   centred on one line box rather than each on its own font metrics. If D5's measurement shows a
   residual offset after that, it is absorbed by a single documented token,
   `--kira-icon-optical-y` (default `0`), applied as `transform: translateY(var(--kira-icon-optical-y))`
   on `.p-tab .icon-box` — declared in `tokens.css` with the measurement that set it written into
   the comment, so a future codicon version bump has an obvious place to be re-measured.

**Why not inline SVG.** It would make the ink box *be* the element box and close the whole class of
problem — and it is a change to every icon in the app, a new build step to inline the codicon set,
and a bundle-size decision. That is OQ-3, not a side effect of a title-bar item.

### D7 — `.p-method` becomes colour-only; the fill is dropped everywhere it appears (item E, F11, F12)

`primitives.css`'s eight `.p-method.*` rules lose their `background` line and keep their `color`:

```css
/* P22 D7: colour only, no fill. P17 D19 gave these a 16% tint to match `.p-chip`'s four status
   variants; the user reports the fill itself as the problem on the method *select*, where a
   tinted pill inside a bordered control reads as a second, competing control. Coloured text on
   the control's own neutral ground is the treatment asked for, and it is applied to all five
   `.p-method` sites (F12: they are all Api — Studio's tree has no method/kind chip, only an
   EngineIcon and a `.p-count`) so a method never has two looks in one window. */
.p-method.get { color: var(--kira-method-get); }
```

Consequences, each checked against the call site:

- `MethodSelect.vue:36` — the trigger keeps `.p-select.bordered`'s own `--kira-bg-input` ground and
  its `font-weight: 600` (`MethodSelect.vue:81-84`); the method now reads as coloured text in a
  neutral select, which is the item.
- `MethodSelect.vue:58` — each menu row is `.p-row .p-method`; with no fill, the row's own
  `:hover` background is no longer competing, so the scoped
  `.method-menu-item:hover { filter: brightness(1.2) }` workaround (`MethodSelect.vue:103-107`,
  which existed *because* the tint beat `.p-row:hover`) is **deleted** and the row gets the plain
  `background: var(--kira-hover)` every other menu row has.
- `HttpRequestView.vue:288`, `ResponseHistoryList.vue:170`, `CollectionRow.vue:134` — these compose
  `.p-chip .p-method`. `.p-chip` itself carries no background (`primitives.css:540-549`); only its
  `.warn/.err/.ok/.info` variants do. So dropping `.p-method`'s fill leaves a pill-shaped,
  `--kira-h-xs`-tall run of coloured text with no ground — correct, and the same shape
  `ResponseHistoryList`'s own time/URL text already has beside it.
- **`.p-chip.warn/.err/.ok/.info` are NOT changed.** They are status, not method; the row scopes
  this to the method select and its siblings, and P17 D19's own "same weight as a status chip"
  reasoning is what is being reversed for methods, not for statuses.

### D8 — One completion-popup block in `primitives.css`, consumed twice (item F, F13, F14)

`primitives.css` gains a `P13-completion` section — the popup's container, row, icon, label, detail
and selected-row rules, hoisted out of `AutocompleteField.vue`'s scoped style verbatim:

```css
.p-completion            { /* .p-float chrome + padding: var(--kira-s-1); min-width: 200px;
                              max-width: min(480px, 90vw); max-height: 240px; overflow-y: auto */ }
.p-completion-row        { /* flex; gap s-2; padding s-2 s-3; radius-sm; font-size t-sm; nowrap */ }
.p-completion-row.is-on  { background: var(--kira-select); color: var(--kira-fg); }
.p-completion-icon       { flex-shrink: 0; color: var(--kira-fg-muted); }
.p-completion-label      { overflow: hidden; text-overflow: ellipsis; }
.p-completion-detail     { margin-left: auto; padding-left: var(--kira-s-3);
                           color: var(--kira-fg-muted); }
.p-completion-match      { color: var(--kira-syntax-function); }
```

Then:

1. **`AutocompleteField.vue`** drops its five scoped rules and uses the classes
   (`:415`, `:519-545`). No visual change — this is a pure hoist, and it lands as its own commit so
   the diff is legibly a move.
2. **`editor/theme.ts`** rewrites its five completion rules to reproduce the same metrics on
   CodeMirror's own DOM: container padding `--kira-s-1` and the three size caps on
   `.cm-tooltip.cm-tooltip-autocomplete`; `padding`/`border-radius`/`gap`/`display:flex` on
   `.cm-tooltip-autocomplete ul li`; `margin-left: auto` on `.cm-completionDetail` so it
   right-aligns like the plain popup's; `--kira-syntax-function` already matches
   `.p-completion-match`.
3. **Icons.** Every `CompletionSource` in the app already sets `type` (`completion.ts`'s
   `'variable' | 'method' | 'keyword' | 'function' | 'class'`;
   `sqlLanguageService.ts`'s sources set theirs through `@codemirror/lang-sql`). `editor/theme.ts`
   gains a `.cm-completionIcon-<type>::after` rule per type whose `content` is the **same codicon
   glyph** `theme/icons.ts` maps for that concept, in `codicon` at 13 px and `--kira-fg-muted` — so
   a `variable` completion shows `symbol-variable` in both popups. Codepoints are read out of the
   installed `@vscode/codicons/dist/codicon.css`, never from memory (`primitives.css:939-940` states
   that rule for the two chevrons already in the file).

**This is two expressions of one specification, not one component** (F14), and the section's header
comment says so, with a pointer to `editor/theme.ts` so the next person to change one changes both.

### D9 — `--kira-state-on` becomes `#e0a33c`, and nothing else moves (item G, F15, F16)

`tokens.css:32-39`'s value changes and its comment gains the re-pick's own reasoning:

```css
/* P19 D17 chose #4ec9b0 (teal, ~168deg) as the one hue no syntax token and no other state colour
   occupied. P22 D9 re-picks it as gold/amber at the user's request. #e0a33c (~34deg): 5.94:1 on
   --kira-bg-input and 7.56:1 on --kira-bg; 44deg clear of --kira-warn (#cca700), which is NOT
   available for this because it is simultaneously --kira-search-match, --kira-search-match-current
   and the unresolved-{{variable}} colour, and three of this token's own call sites sit inside or
   beside a search-highlight surface; and clearly above --kira-conn-amber/--kira-conn-orange in
   chroma, which LAW 07 reserves for connection identity (P19 D17 declined that palette for the
   same reason). */
--kira-state-on: #e0a33c;
```

- **No second token.** The row offers the option (*"or introduce a differently-named token if a
  genuine second 'on' state is needed"*); there is not one — F15 counts three consumers, all
  meaning "this view is narrowed/reordered/selected right now".
- **`--kira-warn` is untouched**, and so is every consumer of it.
- **`slickTheme.css:531` stays excluded**, per its own comment (the sort chevron is shape-over-
  colour and P19 D19 explicitly did not sweep it) — reversing that here would be a second, unasked
  change riding on a colour commit.
- **One new collision to note and accept:** `--kira-method-put` is `--kira-conn-amber` (`#bca260`).
  A PUT chip and an active-filter label are both amber-ish, but they never appear in one control,
  they differ by ~20 points of lightness and a large chroma step, and the alternative (moving PUT)
  reopens P17 D19's twelve-colour method palette for a colour the row did not mention.

### D10 — The selection-edge layer is promoted to `views/shared/slick/` and the console uses it (item H, F17, F18)

1. **New `views/shared/slick/selectionEdges.ts`** — `computeSelEdgesHash` and the
   `setCellCssStyles` payload builder, moved verbatim out of `views/grid/SlickGridHost.vue` with no
   behaviour change. Pure: takes the selection ranges and the visible range, returns the
   `{row: {columnId: 'sel-t sel-l', …}}` map SlickGrid's `setCellCssStyles` takes. Mandatory
   location, per F18's lint rule.
2. **`SlickGridHost.vue`** imports it. Pure move; every existing `tests/ui` grid case is the guard.
3. **`ConsoleSlickGrid.vue`** subscribes `selectionModel.onSelectedRangesChanged` to the same
   builder and applies one `setCellCssStyles('kira-sel-edges', …)` layer, exactly as the data grid
   does. It already owns the selection model (`:681`) and already sets
   `selectedCellCssClass: 'kira-cell-selected'` (`:668`), so this is the one missing call.
4. **Nothing in `slickTheme.css` changes.** The rules are already there and already scoped to
   `.slick-grid-host`, which the console root already carries — which is precisely why this is a
   wiring fix and not a theming one.

### D11 — The metrics tooltip keeps the numbers and drops the essay (item I, F19)

`StatusBar.vue:34-42` becomes:

```ts
const metricsTooltip = computed(() => {
  const sample = appMetricsState.sample;
  if (!sample) return undefined;
  // P22 D11: numbers only. The Activity-Monitor cross-check this used to spell out (P7 F6) is
  // still true and still the reason the CPU figure is normalized — it now lives in this comment
  // and in docs/ARCHITECTURE.md's Metrics note, not in a five-line hover panel.
  return `${cpuLabel.value} of ${sample.logicalCPUs} cores · ${memLabel.value} across ` +
         `${sample.processCount} processes · every 5s`;
});
```

The dropped sentence is added to `docs/ARCHITECTURE.md`'s metrics paragraph in the same commit, so
the fact survives the trim rather than being deleted — `CLAUDE.md`'s own rule that an app fact
belongs in `ARCHITECTURE.md`.

### D12 — The active module is a column on `windows`, written on shutdown, not on switch (item J, F20, F21)

**Storage.** `storage/migrations/0014_p22_window_mode.sql`:

```sql
ALTER TABLE windows ADD COLUMN mode TEXT NOT NULL DEFAULT 'studio';
```

`model.WindowRecord` gains `Mode string \`json:"mode"\``, validated against
`packages/shared/domain/mode.ts`'s two values with an unknown value normalising to `'studio'` (the
same drop-and-default posture `ValidateObjectDefinition` takes for an unknown enum).
`repos/windows.go` gains `SetMode(key, mode string) error`, mirroring `SetBounds` exactly, and
`List`/`Create` carry the field.

**Bridge.** `bridge/windows.go` gains `SetMode(args {WindowKey, Mode})`, and whatever the frontend
already reads to learn its own window's record carries `mode` through. `frontend/bindings/**` is
regenerated with `wails3 task common:generate:bindings` (`CLAUDE.md`: `-names` is load-bearing).

**Frontend.**

- `state/mode.ts` gains `hydrateMode(mode: AppMode)`, called from the boot sequence beside
  `hydrateLayout()`, which sets `modeState.active` **once** before the first render.
- `setMode` is **unchanged** — it still writes nothing (F20's invariant, and
  `tests/ui/mode-switch.spec.ts:117-122` still passes untouched).
- The write happens exactly where the window's other shutdown state is written: whatever path
  already calls `SetBounds` on close/move gains a `SetMode(modeState.active)` alongside it. If that
  path is Go-side only (the window close handler in `main.go`/`bridge/windows.go`), the frontend
  instead pushes `mode` on every change through the same debounced writer the layout patcher uses —
  the implementer picks whichever of the two the existing bounds path already is, and says so in
  the commit body. **What must not happen is a synchronous IPC per mode click**; that is the
  invariant F20 names.

**Default.** A window with no stored mode (a fresh install, an older row) opens in `studio` — the
migration's own `DEFAULT 'studio'` and `defaultMode` agree, so there is exactly one place the
default lives on each side.

### D13 — `PanelSplitter` draws its own hairline, behind an opt-in prop (item K, F22)

The fix goes in the shared primitive, not in the two views that happen to have reported it — five
consumers, one of which already works around the same gap locally (F22).

`theme/primitives/PanelSplitter.vue` gains one prop and one rest state:

```ts
/** P22 D13: draw a visible hairline down the middle of the track at rest. Off by default:
 *  WorkbenchShell's two splitters sit in a grid GAP between `.panel-surface` boxes, so the
 *  boundary is already a groove on the shell's own ground and a second line there would read as
 *  a double rule. On by default nowhere — a splitter inside a view has no gap band behind it
 *  (both request views' own `.request-splitter` comments already say exactly this about height),
 *  so it is the caller who knows which situation it is in. */
divider?: boolean;
```

```css
/* The line is drawn as a centred inset box-shadow, not a border: a border would change the
   track's own box size and shift the panes it separates, and the track is a pointer target whose
   4px height is load-bearing for grabbing it. --kira-border (not --kira-border-strong) is the
   weight every other in-view boundary uses (.p-toolbar, .p-view-head, .cell-dock). */
.splitter.has-divider {
  box-shadow: inset 0 calc(var(--kira-border-width) * -1) 0 0 var(--kira-border);   /* orientation: row */
}
.splitter.has-divider.cursor-col-resize {
  box-shadow: inset calc(var(--kira-border-width) * -1) 0 0 0 var(--kira-border);   /* orientation: col */
}
.splitter.has-divider:hover,
.splitter.has-divider:active { box-shadow: none; }   /* the --kira-focus fill takes over whole */
```

Consumers:

- **`HttpRequestView.vue:420` and `GrpcRequestView.vue:392` pass `divider`.** That is the item.
- **`CellEditorDock.vue:22` passes `divider`, and `.cell-dock`'s own `border-top` (`:56`) is
  removed** in the same commit — one mechanism for "a splitter inside a view is visible", not two
  that happen to agree. Its rendered result is unchanged: a 1 px `--kira-border` line in the same
  place.
- **`WorkbenchShell.vue:38` and `:53` do not pass it**, for the reason the prop's own comment gives.

*Alternative considered and rejected:* putting `border-top: … --kira-border` on
`.response-pane-slot` in both views, mirroring `.cell-dock`. It is two lines instead of one prop, it
leaves the grab target itself invisible (the line would sit *below* the 4 px track rather than in
it), and it would make three views express one idea three ways. The prop makes the affordance and
the boundary the same element, which is what a splitter is.

---

## 3. Commit sequence

Conventional Commits, one concern each. `bun run lint` (including `scripts/check-tokens.sh`),
`bun run typecheck` and `bun run build` per commit; `bun run test:ui` runs once near the end per
`CLAUDE.md`'s cadence rule.

| # | Commit | Covers |
|---|---|---|
| T1 | `refactor(theme): control height and text size are named roles over the size scale` | D1 |
| T2 | `test(theme): every control in a toolbar row is one height` + `fix(grid): the page-number box carries a toolbar control's own weight` | D2 |
| T3 | `fix(theme): a disabled primary button's label stays readable` | D3 |
| T4 | `fix(views): the run-state ring no longer sits between the pager and the edge` | D4 |
| T5 | `test(workbench): a mode tab's icon and label ink share a centre line` | D5 (expected red at `b52fd72`) |
| T6 | `fix(workbench): the mode-tab icon is drawn at its own design size` | D6 |
| T7 | `style(api): a method is coloured text, not a coloured fill` | D7 |
| T8 | `refactor(theme): the completion popup's chrome is one block` → `style(editor): the editor's completion popup matches every other one` | D8 (two commits: hoist, then mirror) |
| T9 | `style(theme): the applied-filter colour is gold` | D9 |
| T10 | `refactor(views): selection edges move to views/shared/slick` → `fix(console): a console selection is outlined like the grid's` | D10 (two commits: move, then wire) |
| T11 | `style(workbench): the metrics tooltip is numbers, not prose` | D11 |
| T12 | `feat(storage): a window remembers which module it was in` | D12, storage + bridge half |
| T13 | `feat(workbench): a window reopens into the module it was closed in` | D12, frontend half |
| T14 | `fix(theme): a splitter inside a view draws a visible divider` | D13 |
| T15 | `test(p22): the specs §4 enumerates` | §4.3 |
| T16 | `docs(spec): P22 part 1 implemented` | the SPEC row |

Ordering notes: T1 before everything (every later commit reads its roles). T5 **must** precede T6
— the measurement is what tells T6 which axis to change and by how much. T8's and T10's first
commits are pure moves and must precede their second. T12 before T13 (the bindings have to exist).
T14 is independent of everything else and may land at any point.

---

## 4. Verification plan

### 4.1 Unit (`bun run test:unit`)

- **`views/shared/slick/selectionEdges.ts`** carries whatever unit coverage
  `SlickGridHost.vue`'s edge computation has today, with its import path updated and no case
  changed. If it has none, none is added — `CLAUDE.md`'s bar; the function is geometry the grid's
  own `tests/ui` cases already exercise end to end.
- **No new unit test for D1, D3, D7, D9, D11.** Each is a CSS value or a string; there is nothing
  with interacting rules to guard, and `CLAUDE.md` names exactly this class as "gets nothing".
- **`model.WindowRecord.Validate`** (Go, `bun run test:go`) gets one case for the unknown-mode
  normalisation, since it is a real drop-and-default branch on a persisted row.

### 4.2 Go (`bun run test:go`)

- `storage/repos/windows_test.go` (extend, or create alongside the existing repo tests): a window
  round-trips its mode; a row written before the migration reads back `'studio'`; `SetMode` on a
  missing key behaves like `SetBounds` does.
- `storage/migrations` — the existing migration tests' shape (`migrate_environment_color_test.go`)
  is the model for a `0014` test asserting the column exists with the right default on an upgraded
  database.

### 4.3 UI (`bun run test:ui`) — the cases this part owes

1. **`control-sizing.spec.ts`** (new) — D2's measurement: every control in the data toolbar's pager
   row is one height, and that height equals `getComputedStyle(document.documentElement)
   .getPropertyValue('--kira-control-h')`. Plus a second case inside `SettingsDialog` for the `.md`
   family.
2. **`control-sizing.spec.ts`** — D1's no-op guard: with the role layer in, the computed height of
   a `.p-input`, a `.p-iconbtn`, a `.p-dlgbtn` and a `.p-chip` are 22/22/26/18, i.e. exactly the
   pre-T1 values. This is what makes T1 provably render-identical for the control family.
2b. **`control-sizing.spec.ts`** — D1's one deliberate pixel change: `.p-view-head` and `.p-toolbar`
   report the **same** height (F2(c)'s split, closed), and that height equals `--kira-bar-h`.
3. **`api-ui-consistency.spec.ts`** (existing) — D3: open a gRPC tab with no method chosen, read
   `[data-testid="grpc-call"]`'s computed `color` and `opacity`, and assert the label is not
   `--kira-fg-disabled` over `--kira-accent`. Asserted as "the disabled primary path uses opacity",
   not as a contrast number computed in the test.
4. **`data-view.spec.ts`** (existing, already owns every `pager-*` testid) — D4: `pager-last`'s
   right edge is within 12 px of `[data-testid="data-toolbar"]`'s right edge, and is to the **right**
   of the run-state element. Plus the same relative assertion in `documents.spec.ts` after the
   pager move.
5. **`mode-switch.spec.ts`** — D5's ink measurement, replacing P18's box measurement (the existing
   mode-switch behaviour case in the same file is untouched).
6. **`http-request.spec.ts`** / **`collections.spec.ts`** — D7: `[data-testid="http-method-select"]`
   and `[data-testid="http-method-chip"]` have a non-neutral computed `color` and a
   `background-color` that is either transparent or `--kira-bg-input` — never a `color-mix` tint.
7. **`autocomplete.spec.ts`** (existing) — D8: open the header-name popup and the console's SQL
   popup in the same run, and assert both containers report the same computed `padding`,
   `border-radius`, `max-width` and `background-color`, and that a row in each reports the same
   `padding` and `border-radius`.
8. **`console.spec.ts`** (existing, owns the console selection cases P19 added) — D10: drag a
   two-by-two cell range in a console result and assert the four perimeter cells carry
   `sel-t`/`sel-r`/`sel-b`/`sel-l` exactly as `data-view.spec.ts` already asserts for the grid.
9. **`mode-switch.spec.ts`** — D12: switch to Api, relaunch, and assert the Api tab is active on
   boot; then switch to Studio, relaunch, and assert Studio. Plus the existing
   *"mode switching writes nothing"* case (`:117-122`) still passing unchanged, which is what proves
   D12 did not turn a selection into a mutation.
10. **`http-request.spec.ts`** / **`grpc-request.spec.ts`** — D13: the request/response splitter has
    a non-`none` computed `box-shadow` at rest, and the request pane's bottom edge and the response
    pane's top edge are separated by a visible line. Plus **`cell-editor.spec.ts`**: the cell dock's
    own boundary still renders after `.cell-dock`'s `border-top` is removed in favour of the prop.

### 4.4 What is deliberately not verified

- **The exact hex of `--kira-state-on`.** F16's contrast figures are arithmetic; `bun run lint`
  (`check-tokens.sh`) proves the token resolves. No test asserts a colour value — P19 D17 set that
  precedent for the same token.
- **How the mode tabs look on a real Mac.** D5's test is the substitute, and it is written to fail
  loudly rather than to confirm a guess. This sandbox cannot build or render the app: `wails3` is
  not installed here and `frontend/bindings/**` is generated by it (`CLAUDE.md`).
- **A real font-size sweep of D1's `calc()` type scale.** T1's own no-op case pins the 12 px
  default; a full 10-to-20 px visual sweep is a judgement call for a human at the app, and OQ-1
  records it.

---

## 5. What this part deliberately does not do

- **Does not change any rendered control height.** D1 is a role layer over the existing scale; T2's
  second case proves it. Its one deliberate *bar* change (`.p-view-head` 28 → 34, closing F2(c)'s
  split) is stated in D1, in T1's commit body and in case 2b.
- **Does not raise `--kira-control-h`.** The mechanism the row asks for is built; using it is a
  design decision nobody has made yet (OQ-1).
- **Does not redefine `--kira-bar-h`**, which `fb7476e` introduced with a different meaning while
  this plan was being written (D1).
- **Does not give the two `WorkbenchShell` splitters a divider** (D13) — their grid gap already
  reads as a groove between two `.panel-surface` boxes.
- **Does not touch `--kira-accent`, `--kira-warn`, or `--kira-search-match`.**
- **Does not restyle `.p-chip`'s four status variants** — only `.p-method` loses its fill (D7).
- **Does not replace the codicon font with SVG** (OQ-3).
- **Does not make a mode switch write to storage** (D12, F20).
- **Does not touch `slickTheme.css`'s sort chevron**, which P19 D19 deliberately left on
  `--kira-accent` for a shape-over-colour reason its own comment records.

---

## 6. Open questions, with their resolutions

**OQ-1 — Should `--kira-control-h` actually be raised, now that raising it is one edit?**
*Resolved: not in this phase.* The row asks for the mechanism ("so that raising one token raises
inputs, dropdowns, and other form controls together"), not for a specific new height. D1 makes the
edit a one-liner and D2's test makes a wrong value fail loudly; picking the number is a design
judgement that wants somebody looking at the app on a real display. If the answer is "22 → 24", the
change is `--kira-control-h: var(--kira-h-md)` minus a step, or a new `--kira-h-*` step, plus
re-running T2.

**OQ-2 — Is `#e0a33c` the right gold?**
*Resolved for implementation; explicitly open for the user.* The plan pins the *constraints* (F16:
contrast on both grounds, hue separation from `--kira-warn`, chroma above the connection palette,
absent from the repo) and offers one value that satisfies them. Any other hex that clears the same
four constraints is a drop-in substitute and needs no other change — which is the property that
makes this safe to decide late.

**OQ-3 — Should the app's icons become inline SVG?**
*Resolved: not here, and recorded so it is not rediscovered.* It would make an icon's element box
*be* its ink box, closing F9(a) and F9(b) by construction and removing the whole class of optical
nudge D6 falls back to. It is also: a build step to inline or subset the codicon set, a bundle-size
question, a change to 60+ call sites (F10), and a decision about whether `EngineIcon`'s
simple-icons SVGs and the codicon set become one mechanism. That is its own row, not a title-bar
item's side effect. D6's `--kira-icon-optical-y` is deliberately a single documented token so this
is a clean thing to delete later.

**OQ-4 — Should `DocumentView`'s pager really move to the right too?**
*Resolved: yes (D4's second half).* The row names the SQL grid, but the two views share one
`PagerControls` component and today disagree about where it lives (F7). Fixing one and not the other
converts a general complaint into a specific inconsistency, which is what P16 did and what produced
this re-report. The cost is one moved slot in a file this phase already touches.

**OQ-5 — Does D3's `opacity` approach hide a real disabled-state signal?**
*Resolved: no, and it restores one.* At `b52fd72` a disabled primary button keeps its full-strength
accent fill and loses only its label, so it reads as *enabled with no text*. At 0.45 opacity the
whole control dims, which is the signal, and it is the treatment `.p-dlgbtn` has used since P3
without complaint.

**OQ-6 — Where exactly does the mode get written on close?**
*Open, and named as such (D12).* It depends on whether the existing window-bounds write is driven
from Go's window close handler or from a frontend debounced patcher — the implementer reads that
path and follows it rather than adding a second, parallel shutdown mechanism. The **constraint** is
fixed regardless: no synchronous IPC on a mode click (F20).

---

## Checklist

- [x] T1 `refactor(theme): control height and text size are named roles over the size scale`
- [x] T2 `test(theme): every control in a toolbar row is one height`
- [x] T2b `fix(grid): the page-number box carries a toolbar control's own weight` (one commit with T2)
- [x] T3 `fix(theme): a disabled primary button's label stays readable`
- [x] T4 `fix(views): the run-state ring no longer sits between the pager and the edge`
- [x] T5 `test(workbench): a mode tab's icon and label ink share a centre line` (red at `b52fd72`)
- [x] T6 `fix(workbench): the mode-tab icon is drawn at its own design size`
- [x] T7 `style(api): a method is coloured text, not a coloured fill`
- [x] T8a `refactor(theme): the completion popup's chrome is one block`
- [x] T8b `style(editor): the editor's completion popup matches every other one`
- [x] T9 `style(theme): the applied-filter colour is gold`
- [x] T10a `refactor(views): selection edges move to views/shared/slick`
- [x] T10b `fix(console): a console selection is outlined like the grid's`
- [x] T11 `style(workbench): the metrics tooltip is numbers, not prose`
- [x] T12 `feat(storage): a window remembers which module it was in`
- [x] T13 `feat(workbench): a window reopens into the module it was closed in`
- [x] T14 `fix(theme): a splitter inside a view draws a visible divider`
- [x] T15 `test(p22): the specs §4 enumerates` — no separate commit; each §4.3 case landed inside its
      own D-item's commit (confirmed present against the real tree: `control-sizing.spec.ts` 1/2/2b,
      `api-ui-consistency.spec.ts` D3, `data-view.spec.ts`/`document-view-readonly.spec.ts` D4,
      `mode-switch.spec.ts` D5/D12, `http-request.spec.ts`/`collections.spec.ts` D7,
      `autocomplete.spec.ts` D8, `console.spec.ts` D10, `http-request.spec.ts`/`grpc-request.spec.ts`/
      `cell-editor.spec.ts` D13), the same distributed-verification precedent P19's own SPEC note
      records for its T17
- [x] `wails3 task common:generate:bindings` re-run after T12
- [x] `bun run lint` / `typecheck` / `build` clean
- [x] `bun run test:unit` green; `bun run test:go` green (new windows-repo and migration cases)
- [x] `bun run test:ui` run once at the end; failures fixed as follow-up commits
- [x] `docs/ARCHITECTURE.md` metrics note carries D11's dropped sentence
- [x] `docs/v1.2/SPEC.md`'s P22 row updated

---

## 7. Sources

**Read in this worktree at `b52fd72`** (every citation above points at that commit):
`theme/{tokens,base,primitives}.css`,
`theme/primitives/{AppButton,IconButton,TextField,AutocompleteField,PanelSearchBox,PanelShell,PanelSplitter,SegmentedControl,ViewChrome,ViewHeader,RunState,DialogFrame,completion.ts}`,
`theme/CodiconIcon.vue`, `editor/{theme.ts,CodeMirrorHost.vue,variableHighlight.ts}`,
`workbench/{TitleBar,StatusBar,SettingsDialog,modes.ts}.vue/.ts`,
`views/shared/page/PagerControls.vue`, `views/shared/slick/slickTheme.css`,
`views/grid/{DataView,DataToolbar,SlickGridHost}.vue`, `views/console/ConsoleSlickGrid.vue`,
`views/documents/DocumentView.vue`, `views/grpcrequest/GrpcRequestView.vue`,
`views/shared/celleditor/CellEditorDock.vue`, `workbench/WorkbenchShell.vue`,
`views/httprequest/{HttpRequestView,ResponsePane,ResponseHistoryList}.vue`,
`api/{MethodSelect,CollectionRow,CollectionsPanel}.vue`, `project/TreeRow.vue`,
`state/{mode,settings,layout}.ts`, `packages/shared/domain/{layout,mode,http}.ts`,
`internal/storage/{repos/{layout,windows,tabs}.go,model/window.go,migrations/*}`,
`internal/bridge/{layout,windows}.go`, `tests/ui/mode-switch.spec.ts`, `biome.json`,
`package.json`, `scripts/check-tokens.sh`.

**Not run**: `bun run build`, `bun run test:ui`, `bun run test:unit`. `frontend/bindings/` is
generated by `wails3`, which is not installed in this Linux sandbox, and `node_modules` is not
populated in this worktree. Every claim above is a reading of committed source or arithmetic over
committed values; §4.4 names what stays unverified and D2/D5 are written specifically so that the
two claims a rendering would have settled are settled by a test instead.

**Prior plans**: `docs/v1.2/plans/P16-sql-grid-consistency-search.md` (D1, D2, D6, D7, D8 — the
pager move and the `RunState` reservation this corrects), `docs/v1.2/plans/P17-…md` (D18, D19 — the
method palette D7 reverses the fill of), `docs/v1.2/plans/P18-…md` (D13, D14, D15/F18 — the
mode-tab work D5/D6 reopen), `docs/v1.2/plans/P19-…md` (D7, D8, D17-D19 — the selection-model port
D10 completes and the `--kira-state-on` token D9 re-picks), `docs/v1.2/plans/P15-…md` and
`P15b-…md` (the split precedent §0.1 follows).
