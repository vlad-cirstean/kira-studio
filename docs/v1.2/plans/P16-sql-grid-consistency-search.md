# P16 — SQL grid polish, cross-cutting dropdown/input consistency, and Api search

> **What this phase is.** `docs/v1.2/SPEC.md`'s P16 row — the second user-driven batch of this
> chapter, and the one that deliberately mixes three scopes rather than one surface: **(Studio
> only)** three SQL-grid fixes, **(cross-cutting)** two design-system-level control-consistency
> fixes that land in both modes at once, and **(Api)** a search affordance across that module's
> list-shaped surfaces.
>
> **Base commit.** Everything below was read against `bf7faa5` (*"docs(v1.2): mark P15b
> implemented, and check off its plan's checklist"*, branch `claude/feature-v1-2`) — the commit
> that closes P15b out. Every file:line citation points at that commit's content.
>
> **The precedent this matches.** `docs/v1.2/plans/P15-request-builder-ux.md` (the finding →
> decision → commit-sequence shape, its §5 polish/feature line, its explicit
> "the-report-is-partly-wrong-as-stated" findings), `docs/v1.2/plans/P13-api-ui-check.md` (§0.2's
> "don't widen a shared primitive for one Api caller" line, and its OQ-2, which this phase's D6
> is the direct answer to), `docs/v1.1/plans/P27-active-filter-indicator-color.md` (citation
> discipline: every claim carries a file:line read at the base commit; a finding that turns out
> to be *already done* says so).
>
> **Three inheritances this phase is explicitly the destination for.** They are not new
> judgements; three earlier plans named P16 or named the trigger condition, and this plan honours
> all three rather than re-deriving them:
>
> 1. **P15 OQ-1**, verbatim: *"`.p-input`'s own rules … **P16's own row is where it belongs** —
>    its cross-cutting half is 'inline text inputs' crowding/padding and muted text contrast fixed
>    at the design-system level' … D3 deliberately leaves `.p-input`'s own rules untouched so that
>    phase inherits a clean one."* → D7/D8.
> 2. **P13 OQ-2**, verbatim: *"five local `height: var(--kira-h-sm)` overrides, or a
>    `.p-select.sm`? … **If a sixth appears, `.p-select.sm` is correct and this decision should be
>    reversed rather than extended.**"* F5 finds the sixth. → D6.
> 3. **v1.1 P22 Pass B §14.2**, which left the grid's elastic-overscroll asymmetry as the one
>    item of five *"applied, not re-verified"* and explicitly **still open**. → D3.

---

## 0. Scope

### 0.1 The eight items, and where each lands

| # | Item (SPEC row's own framing) | Mode | Decision | Commit |
|---|---|---|---|---|
| 1 | SQL grid: pager/nav arrows closer to the grid's right edge | Studio | D1, D2 | Q1, Q2 |
| 2 | SQL grid: a real per-column minimum width so content stops being cropped | Studio | D4, D5 | Q3 |
| 3 | SQL grid: elastic/overscroll consistent on all four edges | Studio | D3 | Q4 |
| 4 | Every dropdown's closed-state height in line with its row | both | D6 | Q5, Q6 |
| 5 | Inline text inputs' crowding/padding | both | D7 | Q7 |
| 6 | Muted text contrast | both | D8, D9 | Q8, Q9 |
| 7 | Api: a search affordance in the request/response viewer | Api | D10, D11, D12 | Q10–Q12 |
| 8 | Api: the same for the module's other list-shaped surfaces | Api | D13, D14, D15 | Q13–Q15 |

### 0.2 Files this phase touches

| File | Items |
|---|---|
| `views/grid/DataToolbar.vue`, `views/grid/DataView.vue` | 1 |
| `theme/primitives/RunState.vue`, `theme/primitives.css` (`.p-run-state`) | 1 |
| `views/shared/page/columns.ts` | 2 |
| `views/grid/SlickGridHost.vue`, `views/console/ConsoleSlickGrid.vue` | 2 |
| `views/shared/slick/slickTheme.css` | 3, 6 |
| `theme/primitives.css` (`.p-select`, `.p-input`, `.p-textarea`, `.dim`, tertiary rules) | 4, 5, 6 |
| `theme/tokens.css` (`--kira-fg-subtle`) | 6 |
| `views/shared/celleditor/CellEditorView.vue`, `views/httprequest/{FormDataTable,HttpRequestView,RequestBodyPane}.vue`, `views/grpcrequest/GrpcRequestView.vue`, `api/EnvironmentSelect.vue` | 4 (six local overrides deleted) |
| `workbench/SettingsDialog.vue` (`md`), `workbench/GenerateDataDialog.vue`, `api/SaveRequestDialog.vue` | 4 |
| `docs/design/kira-design-system/parts/_style.css` + `parts/bodies/Console.html` + regenerated `*.dc.html` | 4 |
| the fifteen scoped `--kira-fg-disabled` call sites F9 enumerates | 6 |
| `theme/primitives/PanelSearchBox.vue` | 7, 8 |
| `editor/CodeMirrorHost.vue`, `editor/theme.ts`, `editor/findRanges.ts` *(new)* | 7 |
| `views/httprequest/ResponseFindBar.vue` *(new)* | 7 |
| `views/httprequest/{ResponsePane,RawExchangePane,ResponseHistoryList,FieldRowsTable,FormDataTable}.vue`, `views/grpcrequest/{MetadataTable,SchemaBrowser}.vue` | 7, 8 |
| `api/{VariablesDialog,EnvironmentsDialog,DynamicValuesDialog}.vue` | 8 |
| `apps/kira-studio/tests/ui/*.spec.ts` | §4's list |

### 0.3 Why the three scopes stay in one phase

The SPEC row already answers this (*"captured here rather than opening a separate chapter for a
handful of concrete, small fixes"*), and reading the code makes the case sharper rather than
weaker: **item 4 and item 6 are not three-file fixes with an Api half and a Studio half; they are
one rule each, in `theme/primitives.css`, that every surface in both modes reads.** Splitting them
by mode would mean editing the same four rules twice and reviewing the same cascade twice. Items
1–3 are genuinely Studio-only and 7–8 genuinely Api-only, and they touch disjoint files — the
commit sequence (§3) keeps them in separate, bisectable commits rather than pretending they are
one change.

### 0.4 Out of scope, explicitly

- **Everything in P17, P18 and P19.** In particular: the method `<select>`'s *colour-coding* per
  HTTP verb (P17), a Description field on variables (P17), the Faker catalogue's `fake.`
  re-namespacing and autocomplete (P17 — this phase adds only a **filter box** to the existing
  dialog, D15), the history list's live-refresh bug and 30-entry cap (P18), the gRPC view's
  P15/P15b parity pass (P18), and every Studio item in P19. Where this phase touches a file P17/P18
  will also touch, §6 says so.
- **`substitute.ts`, `internal/apivars`, `internal/bridge`'s masking, or any Go file.** §5 is the
  secret-masking analysis and its conclusion is that *nothing* in this phase reaches a surface
  that carries a secret's plaintext — deliberately, and provably from where the masking runs.
- **Studio's own search surfaces.** `views/shared/page/SearchToolbar.vue` and its
  `PageSearchApi`/chunked-scan machinery are read here (D11 explains why the Api find bar does not
  reuse them) and changed nowhere.
- **The collections tree's search** — F13 finds it already exists.
- **`--kira-fg-disabled`'s own value, and the raw `<input type="radio">` in
  `EnvironmentsDialog.vue:139`.** D9 keeps the token's value exactly as it is; the radio is
  P15's Checkbox story repeated for a different element type and belongs to whoever does that
  (OQ-7).
- **A new dependency.** `@codemirror/search` is *not* added — D11 says why, and what is used
  instead.

---

## 1. Findings

Every finding was read at `bf7faa5`. Three of the eight items turn out to be **partly wrong as
reported** (F2, F3, F8) and one is **already done** (F13); each is recorded as what the code
actually does before what the residual friction really is.

### F1 — The pager sits at the *left* of the data toolbar, and the toolbar's right end already has a reflow bug

`ViewChrome.vue:66-92` lays the toolbar out as: `.group`(Refresh · Stop) → `#toolbar` slot →
`<span class="p-push">` → `.group`(`#toolbar-end` slot) → `<RunState>`. `DataToolbar.vue:168-253`
fills `#toolbar` with `sep · PagerControls · SegmentedControl(page size) · sep · Σ · Columns · sep ·
add · wand · trash · search`, and `DataView.vue:210-241` fills `#toolbar-end` with the
pending-changes group. So the pager is the *third* thing on a row of thirteen, at the far left,
while the grid's right edge is ~8 px (`.p-toolbar`'s own `padding: 0 var(--kira-s-4)`,
`primitives.css:627`) inside the panel's right border.

Two facts decide D1 and D2:

- **`p-push` is `margin-left: auto` (`primitives.css:22-24`)**, so `#toolbar-end` and `RunState`
  are right-aligned *as one block*. `RunState`'s own label (`RunState.vue:13-19`) is `'—'` /
  `'996 ms'` / `'1.2 s'` / `'12.4 s'` — four different widths — and `.p-run-state`
  (`primitives.css:709-716`) sets no `min-width`. **Every tick of a running query therefore shifts
  everything in `#toolbar-end` horizontally.** That is a live violation of the LAW
  `ViewChrome.vue:88-90` states in its own comment (*"its label's width changes as elapsed time
  ticks up, and it must never be able to reflow controls to its left"*) — the ordering it relies on
  is necessary but not sufficient. It does not matter much for a chip and three icon buttons that
  only appear while edits are staged; it matters a great deal for a five-control pager the user
  clicks repeatedly.
- **The design system's own artboard puts the pager on the left** —
  `parts/bodies/Toolbars.html:22-28`, band *"01 · Data toolbar"*, `refresh/stop · sep · pager ·
  sep · Columns/Preview SQL · push · idle`. So this item is a deliberate departure from a drawn
  artboard, not a correction toward one. D1 owns that.

### F2 — `MIN_WIDTH` is already 64 px and already clamps a stored width; what is missing is that the *header* has ~42–54 px of furniture nothing measures

`views/shared/page/columns.ts:11-14` and `:76-98`:

```ts
export const MIN_WIDTH = 64;
const MAX_WIDTH = 480;
const CELL_PADDING = 20;   // px, both sides combined plus a little breathing room
const SAMPLE_ROWS = 50;
…
widths.push(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(max + CELL_PADDING))));
```

and `SlickGridHost.vue:427-436` clamps a *stored* width to the same floor, with a comment recording
that this was itself a real bug fix. So "there is no minimum width" is not true, and the naïve
reading of the item ("raise `MIN_WIDTH`") would repeat a fix that already landed.

The real mechanism, all arithmetic over rules read at the base commit:

1. **`max` is measured on a canvas at `--kira-font-size`** (`columns.ts:36-39`, `--kira-t-md`,
   12 px) over the column **name** and up to 50 sampled cell texts (`:85-93`). For a column whose
   data is short — an `id`, a status flag, a boolean — the name *is* the maximum.
2. **`CELL_PADDING = 20` is a body-cell budget.** `.slick-cell`'s own padding is
   `0 var(--kira-s-4)` (`slickTheme.css:219`) = 16 px, so 20 leaves 4 px of slack — correct, for a
   body cell.
3. **The header cell is a flex row with three more items in it.** `.slick-header-column.ui-state-
   default` (`slickTheme.css:133-168`) is `display: flex; gap: var(--kira-s-2); padding: 0
   var(--kira-s-4); font-size: var(--kira-t-sm)`. Its flex children, in flex order, are
   `.slick-column-name` (`:172-185`, `flex: 1; min-width: 0; overflow: hidden; text-overflow:
   ellipsis`), the optional `.header-key` PK/FK badge (`SlickGridHost.vue:1093-1098`;
   `slickTheme.css:675-680`, `margin-left: var(--kira-s-2)`, `--kira-t-xs`),
   `.slick-sort-indicator` (`slickTheme.css:563-581`, **`width: 14px; flex-shrink: 0`**) and
   `.slick-sort-indicator-numbered` (`:633-662`, 0 px at rest, up to ~18 px under multi-column
   sort). `.header-select-zone` is `position: absolute; inset: 0` (`:695-700`) and so costs no
   layout width.
4. **Arithmetic**: 16 (padding) + 14 (sort indicator) + 3 × 4 (gaps between four flex items) = **42
   px** before the name gets a pixel, **+ ~16 px** when a PK/FK badge is present ("PK" at
   `--kira-t-xs` in the monospace stack plus its own 4 px margin) = **~58 px**. Against a flat 64 px
   floor, a PK column named `id` has ~6 px for its name.
5. **This is not hypothetical, and the codebase already knows it.** `slickTheme.css:530-532`:
   *"confirmed the hard way: at rest they otherwise silently starved `.slick-column-name` down to 0
   width on `order_items`' own `id` column (64px, PK badge, real capture) before this fix."* And
   `:546-552` records the previous round's reasoning: the flat `MIN_WIDTH` 40 → 64 bump was
   accepted as the fix precisely because *"with every column now at least 64px, the header text and
   PK/FK badge have real room to spare"*. **That claim is 42–58 px of furniture short of true**,
   which is exactly why the crop came back for anything longer than two characters.

So: the item's real content is *"the minimum is flat and body-shaped; make it per-column and
header-aware."* D4.

One scoping fact that matters: `ConsoleSlickGrid.vue:148/:175` sets `sortable: false` for every
column, and SlickGrid builds `.slick-sort-indicator` **only** under `m.sortable`
(`slickgrid@5.20.0/dist/esm/index.js`, `createColumnHeaders`: `m.sortable && (…createDomElement("div",
{ className: "slick-sort-indicator …" })…)`). The console result grid also has no `.header-key`
badge (`onHeaderCellRendered`'s badge is `SlickGridHost.vue`-local). Its header furniture is
therefore 16 px of padding only, which `CELL_PADDING = 20` already covers — so a shared,
chrome-parameterised helper leaves the console grid byte-identical by construction (D5).

### F3 — Only one branch of the SPEC's own either/or is expressible; and one edge asymmetry *is* visible in the DOM

`slickTheme.css:20-46` is the standing record. Restated as facts re-checked at this commit:

- **`overscroll-behavior: contain` is already on `.slick-viewport`** (`:44-46`), landed by
  `5a26897` and documented in `docs/v1.1/plans/P22-slickgrid-pass-b.md:1686-1710`, which closes
  with *"**Still open**: whether this actually makes the bounce symmetric on real hardware."*
- Nothing in the frontend intercepts `wheel`/`touchmove` on the grid. `wheelScroll.ts:10-14` is a
  wheel→horizontal translator, and its only callers are `workbench/` and `views/console/` (its own
  header comment), never the grid. `SlickGridHost.vue:1856` sets
  `enableMouseWheelScrollHandler: false`, which *removes* SlickGrid's own JS wheel quantisation and
  leaves the viewport's native `overflow: auto` in charge (`:1850-1855` says exactly that, as a
  real-Mac finding).
- The Go/native layer sets no gesture option — re-checked by the P22 pass across `main.go`'s
  `MacOptions`, `internal/shell/security.go` and `internal/shell/window.go`.

**The new finding this phase adds, which no prior round recorded: the four edges are not one
element's.** `SlickGridHost.vue:1848` sets `frozenColumn: 0`, so `hasFrozenColumns()` is true
(`frozenColumn > -1`) while `hasFrozenRows` is false. SlickGrid's `updateViewportOverflow`
(same bundle) then writes, for that exact combination:

| pane | `overflow-x` | `overflow-y` |
|---|---|---|
| `.slick-viewport` top-**left** (the frozen row-number gutter) | `scroll` | **`hidden`** |
| `.slick-viewport` top-**right** (the data columns) | `scroll` | `auto` |

Two consequences, both readable without a compositor:

1. **The left pane is a horizontal scroll container that can never scroll.** Its canvas is exactly
   `GUTTER_WIDTH` (56 px, `columns.ts:19`) wide inside a 56 px pane, and `overflow-x: scroll`
   makes it a scrollport regardless. A horizontal gesture that starts over the row-number gutter
   and one that starts 60 px to its right are therefore, structurally, gestures on two different
   scrollers with two different scrollabilities.
2. **The vertical axis exists only on the right pane.** The gutter is `overflow-y: hidden`, so
   whatever the data pane does at the top or bottom edge, the row numbers beside it do not do.

That is a genuine, in-code, four-edge inconsistency — and it is the part of the report this
sandbox can actually act on. What it cannot act on is the compositor: **there is no CSS property,
and no JS API, that *adds* an elastic bounce to an edge where the engine declines one.**
`overscroll-behavior` has exactly three values and all three are subtractive — `auto` (chain),
`contain` (do not chain), `none` (do not chain and suppress the overscroll affordance). So of the
SPEC row's own two branches — *"either enabled everywhere or disabled everywhere"* — **only
"disabled everywhere" is a change this repo can make**; "enabled everywhere" is a hope that some
unrelated change happens to fix WebKit's asymmetry. D3.

### F4 — `.p-select`'s only live variant defaults to the wrong height, and six call sites plus the design system's own artboard already say so

`primitives.css:360-419` defines two variants:

```css
.p-select          { height: var(--kira-h-sm); … no border, no background … }
.p-select.bordered { height: var(--kira-h-md); border: …; background-color: var(--kira-bg-input); … }
```

`grep -rn 'p-select' apps/kira-studio/frontend/src --include=*.vue` at the base commit returns **ten
call sites, and every one of them is `.p-select.bordered`.** The borderless base variant — the one
the design system's own artboards actually draw in toolbars (`parts/bodies/{Main,Toolbars,Stream,
Ddl,CellEditor}.html`) — has **zero consumers in the app**.

Of those ten, **six carry a local `height: var(--kira-h-sm)` override**, each with a near-verbatim
copy of the same comment:

| Call site | Override | The comment's own reason |
|---|---|---|
| `views/shared/celleditor/CellEditorView.vue:620-623` | `height: var(--kira-h-sm)` | *"taller than the IconButtons/28px header row it sits in here"* |
| `views/httprequest/FormDataTable.vue:168-173` | same | *"taller than the 22px TextFields/IconButtons beside it in this `.field-row`"* |
| `views/httprequest/HttpRequestView.vue:381-386` | same | *"taller than the h-sm controls the 28px `.p-toolbar` it sits in holds (primitives.css's own LAW)"* |
| `views/httprequest/RequestBodyPane.vue:183-188` | same | same |
| `views/grpcrequest/GrpcRequestView.vue:345-350` | same | same |
| `api/EnvironmentSelect.vue:47-52` | same | same, for `#toolbar-2` |

**Six is the sixth.** P13 D4 (`P13-api-ui-check.md:725-728`) wrote *"If a fourth Api caller of this
override appears, it becomes a `.p-select.sm` in `primitives.css`"*, and P13 OQ-2 (`:1213-1217`)
wrote *"If a sixth appears, `.p-select.sm` is correct and this decision should be reversed rather
than extended."* The condition that decision set for itself is met exactly.

And a seventh copy exists **inside the design system itself**:
`docs/design/kira-design-system/parts/bodies/Console.html:27` is
`<span class="p-select bordered" style="height:var(--h-sm)">search_path: public…</span>` — the
artboard hand-patches its own primitive the moment it puts one in a toolbar.

### F5 — Two of the four un-patched call sites are the reported bug, and two are correct

The four `.p-select.bordered` sites without an override, checked against what actually sits beside
them in the same row:

| Call site | Neighbour in the same row | Heights | Verdict |
|---|---|---|---|
| `workbench/SettingsDialog.vue:287` (font family) | `TextField … size="md"` at `:347` and the section's other fields | 26 / 26 | **correct** |
| `workbench/SettingsDialog.vue:466` (default page size) | same | 26 / 26 | **correct** |
| `workbench/GenerateDataDialog.vue:242` (recipe) | `TextField` at `:256` and `:263`, **the next cell of the same `.recipe-row`**, no `size` → `sm` (`TextField.vue:40`) | **26 / 22** | **the reported bug** |
| `api/SaveRequestDialog.vue:86` (target collection) | `TextField` at `:83`, the field directly above it in the same dialog form, no `size` → `sm` | **26 / 22** | **the reported bug** |

So the item is not "dropdowns are the wrong height" in general — it is that the primitive's default
is right for four call sites and wrong for six, and two of the four that never noticed are in fact
the two visible mismatches. D6 fixes all eight with one rule flip plus two call-site opt-ins.

### F6 — `.p-input`'s padding is 6 px where every other text gutter in the app is 8 px, and the textarea disagrees with it

`primitives.css:128-140`:

```css
.p-input { height: var(--kira-h-sm); display: inline-flex; align-items: center;
           gap: var(--kira-s-2); padding: 0 var(--kira-s-3); … font-size: var(--kira-t-sm); }
```

6 px (`--kira-s-3`) of horizontal padding inside a 22 px box with a 1 px visible border. Compared
against every other place this app insets text from an edge:

| Rule | Horizontal inset |
|---|---|
| `.p-toolbar` (`:627`) | `--kira-s-4` = **8 px** |
| `.p-view-head` (`:691`) | `--kira-s-4` = **8 px** |
| `.p-th` / `.p-td` (`:783`, `:803`) | `--kira-s-4` = **8 px** |
| `.slick-cell` / `.slick-header-column` (`slickTheme.css:219`, `:137`) | `--kira-s-4` = **8 px** |
| `.p-dlgbtn` (`:108`) | `--kira-s-5` = 12 px |
| **`.p-input`** (`:133`) | `--kira-s-3` = **6 px** |
| **`.p-textarea`** (`:247`) | `--kira-s-2` = **4 px** |

The input is the tightest single-line text surface in the app, and the textarea — its own multiline
sibling, promoted into this file by v1.1 P28 — is tighter still by another 2 px. Two further
crowding points inside the same rule set:

- **`.p-input.has-stepper input { padding-right: var(--kira-s-1) }`** (`:196-198`) puts a number
  field's digits **2 px** from the stepper's own border-left divider (`:204`).
- With an `icon` or a `prefix`, the leading run is `6 px padding + 16 px icon-box + 4 px gap`
  before the caret — `TextField.vue:74-75`. The 6 px is the only part of that a rule change can
  recover.

**The constraint that decides the shape of D7**, and the reason this is not "add padding to the
`<input>`": `AutocompleteField.vue:347-380` paints a read-only CodeMirror overlay *behind* the real
`<input>`, both inside `.input-wrap` (`:437-444`), with `.highlight-overlay { position: absolute;
inset: 0 }` (`:446-460`) and `CodeMirrorHost.vue:391-404` zeroing `.cm-content`'s and `.cm-line`'s
own padding so the two engines' first glyph lands on the same pixel. Padding on `.p-input` is
outside `.input-wrap` and cannot disturb that. Padding on `.p-input input` would break it in every
field P15b's `{{variable}}` colouring runs in.

### F7 — `--kira-fg-muted` is fine; `--kira-fg-disabled` is the contrast problem, and it is used for text that is not disabled

Measured contrast ratios (WCAG 2.x relative luminance, computed from `tokens.css:3-11`'s own hex
values):

| foreground | on `--kira-bg` `#1f1f1f` | on `--kira-bg-elevated` `#202020` | on `--kira-bg-chrome` `#181818` | on `--kira-bg-input` `#313131` |
|---|---|---|---|---|
| `--kira-fg` `#cccccc` | 10.26 | 10.15 | 11.06 | 8.10 |
| `--kira-fg-muted` `#9d9d9d` | **6.08** | **6.01** | **6.55** | **4.80** |
| `--kira-fg-disabled` `#6e6e6e` | **3.23** | **3.20** | **3.48** | **2.55** |

So the report's own wording ("muted text contrast") points at the wrong token: `muted` clears
4.5:1 on every background in the app. **`--kira-fg-disabled` clears it on none of them**, and the
worst case — 2.55:1 — is `.p-input .ph` and `.p-input input::placeholder` (`primitives.css:167-170`),
i.e. **the placeholder and the always-present prefix label of every text input in both modes**, at
`--kira-t-sm` (11 px). That is precisely the surface the SPEC row pairs with the padding item, and
it is the single most-read low-contrast text in the app.

Two things make this a *reserved-word* problem rather than a colour problem:

- **`.dim` (`primitives.css:13-15`) maps a general-purpose utility class straight onto the
  disabled colour**, and it is used across both modes for ordinary informational text at
  `--kira-t-xs` (10 px): `ResponsePane.vue:185`/`:191` (elapsed, bytes), `RawExchangePane.vue:108`,
  `ResponseHistoryList.vue:127-133`, `SearchToolbar.vue:327`, `TimestampPane.vue:93`,
  `StudioStart.vue:76`/`:93`, `ProjectPanel.vue:38`, `CommandPalette.vue:87`, `SavedListMenu.vue:58`,
  `ResponseDiffDialog.vue:208-220`, and more. 10 px at 3.23:1.
- WCAG 1.4.3 explicitly exempts *disabled* controls from the contrast minimum. So `#6e6e6e` is a
  perfectly good disabled colour and a bad tertiary-text colour — the token is not wrong, its
  **second job** is.

### F8 — Fifteen scoped rules borrow the disabled colour for text that is not disabled; seven genuinely mean "disabled"

`grep -rn -B3 "color: var(--kira-fg-disabled)"` over `apps/kira-studio/frontend/src` at the base
commit, classified by the selector that owns each:

**Genuinely disabled — keep `--kira-fg-disabled` (7):** `primitives.css:55-57`
(`.p-iconbtn:disabled/.is-disabled`), `:95-97` (`.p-btn`), `:411-413` (`.p-select:disabled`),
`workbench/ContextMenu.vue:358-359` and `:405-406` (`.row.is-disabled`, `.row.is-disabled
.shortcut`), `views/shared/celleditor/CellEditorView.vue:632-633` (`.format-select:disabled`).

**Non-interactive tertiary text — the set D9 moves (15 scoped + 6 in `primitives.css` + 2 in
`slickTheme.css`):**

| File:line | Selector | What it is |
|---|---|---|
| `primitives.css:13-15` | `.dim` | the utility itself |
| `primitives.css:167-170` | `.p-input .ph`, `::placeholder` | → `muted`, not `subtle` (D8) |
| `primitives.css:586` | `.p-menu-label` | menu section headings |
| `primitives.css:701-703` | `.p-view-target .path` | breadcrumb prefix |
| `primitives.css:715` | `.p-run-state` | elapsed time |
| `primitives.css:813-815` | `.p-td.gutter` | row numbers |
| `primitives.css:821-823` | `.p-td.null` | `NULL` markers |
| `primitives.css:863` | `.p-empty` | empty-state body |
| `slickTheme.css:295` | `.kira-gutter` | the SlickGrid row-number column |
| `slickTheme.css:448-449` | `.slick-cell.cell-null` | the SlickGrid `NULL` marker |
| `workbench/StatusBar.vue:118-119` | `.metric-sep` | separator |
| `workbench/SettingsDialog.vue:658`, `:743`, `:767`, `:816` | `.sec-label`, `.helper-text`, `.muted-note`, `.row-preview-gutter` | labels and help |
| `views/shared/SavedListMenu.vue:129` | empty-row note | |
| `views/shared/DateTimePicker.vue:391`, `:426` | `.dim` cell / `.dtp-clock-sep` | |
| `views/shared/celleditor/CellEditorView.vue:703`, `:714` | pane notes | |
| `views/httprequest/ResponseDiffDialog.vue:351` | `.diff-header-head` | |
| `views/keyvalue/KeyValueView.vue:999` | caption | |
| `views/definition/ColumnsSection.vue:118`, `PropertiesSection.vue:40` | `.type-info`, `.def-prop-detail` | |
| `views/browse/BrowseView.vue:285` | `.crumb-sep` | |
| `views/grid/ColumnsMenu.vue:187` | `.drag-handle` | |
| `views/stream/StreamView.vue:964` | `.path` | |
| `views/console/ExplainResultView.vue:236-237`, `:278` | `.no-issues`/`.no-plan`, `.plan-detail` | |
| `api/VariableHistoryMenu.vue:113`, `:124` | `.entry-time`, `.entry-value.masked` | |
| `api/VariableRow.vue:212` | `.masked-value` | the `••••••••` dots |
| `api/VariablesDialog.vue:277`, `EnvironmentsDialog.vue:202` | list header rows | |
| `project/SchemaDialog.vue:160`, `:190`, `FiltersDialog.vue:263`, `:340-341`, `:374`, `ConnectionDialog.vue:969` | help/notes/counts | |

Three uses are **not** `color` and are left exactly as they are: `primitives.css:666`
(`.p-conn-dot.none`'s border), `workbench/ContextMenu.vue:390` (a border), `project/TreeRow.vue:225`
(a background).

### F9 — The Api module has no search anywhere, except the collections tree, which already has one

`grep -rn 'PanelSearchBox|SearchToolbar|placeholder="Search|placeholder="Filter'` over `api/**`,
`views/httprequest/**` and `views/grpcrequest/**` returns **nothing**. Every `filter` hit in those
directories is `Array.prototype.filter`.

The one exception is already done: `CollectionsPanel.vue:36-38` implements `onSearch` and
`PanelShell.vue:87` renders `PanelSearchBox` for it — the Api collections tree has had exactly
Studio's own tree filter since P4. So the SPEC's "collections tree" half of *"and similar"* needs
no work, and the precedent it names is *literally the component to reuse*, not merely a pattern to
imitate.

### F10 — The two search precedents in this app are a filter box and a find bar, and they are not interchangeable

- **`theme/primitives/PanelSearchBox.vue`** (70 lines): a `TextField` with `icon="search"`,
  `placeholder="Search"`, `ui` (system font), an overlaid clear `IconButton`, inside a
  `.search-box-row` that is `padding: var(--kira-s-2) var(--kira-s-3)` with a bottom hairline.
  Filters a list by hiding non-matching entries. **Its `data-testid` is hardcoded to `tree-search`
  (`:20`) and its placeholder is a literal (`:19`)** — both blockers for a second call site, both
  one optional prop away from not being.
- **`views/shared/page/SearchToolbar.vue`** (373 lines): a `.p-toolbar` find bar with
  case/word/regex toggles, a filter-rows mode, prev/next, `N of M`, and a **chunked, cancellable,
  budget-capped scan** driven through a `PageSearchApi<M>` over a tab-scoped page store
  (`:62-155`). Nothing in the Api module has a `PageSearchApi`, a `tabId`-keyed page store, a
  `pageVersion` counter, or a row count worth chunking.

Two more facts that shape D11:

- **`@codemirror/search` is not a dependency.** `package.json:41-50` lists ten `@codemirror/*`
  packages and it is not among them.
- **`CodeMirrorHost.vue` already has a data-driven decoration seam** — `rangeHighlights?: (doc:
  string) => readonly RangeHighlight[]` (`:63`), a compartment (`:202-205`), a watch (`:335-338`)
  and `editor/variableHighlight.ts`'s plugin behind it, all landed by P15b D2. And
  `tokens.css:26-27` already defines `--kira-search-match` / `--kira-search-match-current`, *"the
  grid/document/keyvalue/stream search toolbars' match tint + solid current-match pair"*, with five
  existing consumers.

The one thing the seam does **not** have is a way to bring a match into view:
`CodeMirrorHost.vue:267-275`'s `defineExpose` offers `focus` and `posAtCoords` only.

### F11 — Three Api list surfaces are index-addressed, and a naïve filter would corrupt them

- **`FieldRowsTable.vue`** (the one component behind Params, Headers, urlencoded and form-data —
  `:11-15`) renders `displayRows = [...props.rows, props.blankRow()]` (`:49`) and writes back
  through `updateField(index, …)` / `toggleEnabled(index)` (`:51-60`), where `index` is the
  position in `displayRows` and `index === rows.length` means *the trailing blank row*. Hiding a row
  without carrying its original index through would write to the wrong row.
- **`FieldRowsTable.vue:100-148`** is P15b's arrow-key navigation, which walks
  `container.children` and moves focus by DOM position. A filtered DOM is still self-consistent
  there (it moves between *visible* rows), which is the correct behaviour — worth stating so nobody
  "fixes" it.
- **`VariablesDialog.vue:243-245`** passes `:index="i"` to each `VariableRow` and
  `onDragOver(index)` / `onMove(id, dir)` (`:181-206`) splice `order.value` by that index; the same
  is true of `EnvironmentsDialog.vue:126-137`. **Reordering a filtered list is not merely
  index-fragile, it is meaningless** — "move up" past a hidden neighbour has no defined result.

### F12 — The response viewer's searchable text is one in-memory string per pane, and the response body's `rangeHighlights` seam is free

`ResponsePane.vue:249-278` renders, per selected segment: the **Headers** pane as a `v-for` of
`.p-kv-row` over `response.headers`; **History** as `ResponseHistoryList`; **Raw** as
`RawExchangePane`; **Timeline** as `TimelinePane`; and **Body** as a single
`<CodeMirrorHost :doc="bodyText" :read-only="true" />` (`:265`) with **no `rangeHighlights`
prop** — the seam is unused there. `RawExchangePane.vue:124` and `:146` are two more read-only
`CodeMirrorHost`s (request wire text and response wire text), likewise with the seam free.

By contrast the **request** body editor and the request fields *do* use `rangeHighlights` (P15b D2,
via `views/httprequest/variableCompletion.ts:23-34`), and the host has exactly one such
compartment. That is the reason D11 scopes the find bar to the response side (§6).

### F13 — `ResponseHistoryList` and the dialogs are plain `v-for`s over small arrays

`ResponseHistoryList.vue:109-133` (`v-for` over `entries`, each row a checkbox plus
time/method/status/ms/bytes/environment), `EnvironmentsDialog.vue:126` (`v-for` over
`orderedEnvironments`), `DynamicValuesDialog.vue:49-51` (`v-for` over `DYNAMIC_NAMES`, **58
entries** per its own comment at `:11`), `SchemaBrowser.vue:140-145` (services, each with a method
list). None is virtualised, none is chunk-scanned; a `computed` filter over each is a two-line
change per file.

---

## 2. Decisions

### D1 — The pager moves to the toolbar's right group, last, and the page-size picker stays put (F1, item 1)

`DataToolbar.vue` stops rendering `PagerControls` in `#toolbar`; `DataView.vue` renders it in
`#toolbar-end`, **after** the pending-changes group:

```html
<template #toolbar-end>
  <template v-if="tabHasPending"> …chip, preview, discard, commit… </template>
  <PagerControls … />          <!-- last: nothing to its right can move it -->
</template>
```

Three properties this ordering buys, each answering something F1 found:

1. **The pager is the right-most control in the toolbar**, ~8 px from the grid's right edge
   (`.p-toolbar`'s own padding) — which is the item as asked.
2. **Nothing appearing or disappearing can shift it.** The pending-changes group is conditional
   (`v-if="tabHasPending"`); putting it *before* the pager would slide a five-control click target
   sideways the moment an edit is staged. After the pager, it would push the pager off the edge.
   Before, with the pager last, it grows leftward into the free space `p-push` was absorbing.
3. **`RunState` is then the only thing left that can still move it** — which D2 fixes.

**The page-size `SegmentedControl` (`DataToolbar.vue:187-192`) does not move.** It is a setting the
user changes once per tab, not navigation used repeatedly; the item names *"pager/nav arrows"*; and
a five-option segmented control on the right would make that half of a 28 px row wider than the
left half. Recorded as OQ-1 because the pager's *"page 3 of 47"* and *"200 / page"* do read as one
sentence today, and separating them is a real cost.

**This is a deliberate departure from a drawn artboard** (`parts/bodies/Toolbars.html:22-28`, F1).
It is taken because the row asks for it in the user's own words, and because the artboard's own
pager is a different control — an absolute row range (`1–200 of 9 412`) with no page-jump input —
drawn before D7's cursor/offset paging made that display impossible (`DataToolbar.vue:170-171`
already records that divergence). No artboard is redrawn here; OQ-2.

### D2 — `RunState`'s label gets a fixed character width, closing the LAW-12 reflow it was ordered to prevent (F1, item 1)

`RunState.vue` wraps its label in an element and `primitives.css` gives it a monospace-character
minimum:

```html
<span class="p-run-state" …><span class="label">{{ label }}</span><span class="ring" /></span>
```
```css
.p-run-state .label { min-width: 7ch; text-align: right; }
```

- **7 `ch`, not a pixel value.** `.p-run-state` already sets `font-family: var(--kira-font-family)`
  (`primitives.css:713`), a monospace stack, so `1ch` is exactly one character advance and the
  reservation tracks the user's Appearance font-size setting with no token and no magic number.
  Seven is the longest label the component can produce: `9999 ms` (`RunState.vue:16-18` switches to
  seconds at 1000 ms, and `failed` is six).
- `text-align: right` keeps the number's own right edge fixed, so the *digits* do not shuffle
  either — only the reserved gutter to their left changes.
- **Every existing `RunState` consumer benefits**; none regresses. The component gets at most 7
  characters of width where it previously took between 1 and 7, inside a right-aligned group.

This is stated as its own decision rather than folded into D1 because it is a real latent bug in a
shared primitive that `ViewChrome.vue:88-90` already claimed to have prevented, and it wants its
own commit and its own line in the log.

### D3 — Overscroll is **disabled on all four edges**: `overscroll-behavior: none` on every `.slick-viewport` (F3, item 3)

`slickTheme.css:44-46` becomes `overscroll-behavior: none`, replacing `contain`.

**Why "disabled everywhere" rather than "enabled everywhere":** F3's finding, restated as the
decision it forces — of the SPEC row's two branches, exactly one is expressible. `overscroll-
behavior` is subtractive in all three of its values; no CSS property and no JS API adds an elastic
bounce to an edge where the engine declines one. Choosing "enabled everywhere" would mean writing a
plan whose deliverable is a hope. Choosing `none` produces the asked-for property — *the four edges
agree* — **by construction**, on every pane, with no dependency on trackpad physics this
environment cannot observe and this repo has twice recorded as unobservable.

**Why it also fixes the asymmetry that is genuinely in the DOM:** F3's table shows the frozen
gutter pane is `overflow-y: hidden` and horizontally unscrollable-but-scrollport, while the data
pane is `auto`/`scroll`. Under `contain`, those two panes can behave differently at the same
perceived edge of the same grid. Under `none`, neither produces an overscroll affordance at any
edge, so the perceived difference cannot exist regardless of which pane a gesture starts on.

**This deliberately re-opens a reverted instruction, and says so.** `slickTheme.css:37-40` and
`P22-slickgrid-pass-b.md:1697-1701` both record that `contain` was chosen partly *because* it is
**not** the earlier, reverted *"disable overscroll entirely"* instruction — *"`overscroll-behavior:
none` would be that"*. This plan writes that exact declaration, on purpose, because the P16 row
explicitly puts both branches on the table and only one is real. Two things make the re-opening
honest rather than sneaky:

- **Scope.** It applies to `.slick-viewport` only — SlickGrid's own scrollports in the data grid and
  the console result grid. Not `html`/`body` (already `overflow: hidden`, `base.css:48-54`), not
  CodeMirror, not the trees, not any panel. The earlier instruction was a global one.
- **Reversibility, stated up front.** If the user sees it on real hardware and wants the bounce
  back, the revert is one word: `none` → `contain`. The comment that replaces
  `slickTheme.css:20-46` will say that in those terms, and OQ-3 records it.

The long comment block at `:20-46` is rewritten rather than extended: it currently argues for
`contain` at length, and leaving that argument in place above a `none` would be actively
misleading. The new comment keeps the two negative findings (nothing intercepts wheel/touch;
nothing in the native layer sets a gesture option), adds F3's frozen-pane table, and states the
"only one branch is expressible" argument plus the one-word revert.

### D4 — A per-column minimum that knows what the header renders (F2, item 2)

`views/shared/page/columns.ts` gains one exported function and the header-furniture constants it
needs:

```ts
/** What a header cell spends before its name gets a pixel — read off slickTheme.css's own rules
 *  for `.slick-header-column` (padding + flex gaps) and `.slick-sort-indicator` (a fixed 14px
 *  box, built only for a sortable column). */
export interface HeaderChrome {
  /** `.slick-header-column`'s own `padding: 0 var(--kira-s-4)`, both sides. */
  padding: number;          // 16
  /** `.slick-sort-indicator`'s `width: 14px` + one `gap: var(--kira-s-2)`, or 0 when the
   *  column is not sortable (SlickGrid builds the div only under `m.sortable`). */
  sortControl: number;      // 18 | 0
  /** The PK/FK `.header-key` badge plus its own `margin-left: var(--kira-s-2)`, or 0. */
  keyBadge: number;         // 16 | 0
}

/** The narrowest this column may ever be drawn without its own header name ellipsising —
 *  the flat MIN_WIDTH floor when that is already enough, and never more than MIN_WIDTH_CAP. */
export function headerAwareMinWidth(name: string, chrome: HeaderChrome): number;
```

Implementation, in full:

```ts
const MIN_WIDTH_CAP = 200;
headerText = measureCtx('--kira-t-sm').measureText(name).width
return Math.min(MIN_WIDTH_CAP,
       Math.max(MIN_WIDTH,
                Math.ceil(headerText + chrome.padding + chrome.sortControl + chrome.keyBadge)));
```

Four things this gets right that a flat floor cannot:

1. **It measures the header at the header's own font size.** `getMeasureCtx` (`columns.ts:31-42`)
   is generalised from one memoised context to a small `Map` keyed by the size token, so the header
   name is measured at `--kira-t-sm` (11 px) and the body sample stays at `--kira-t-md`. Measuring
   the header at the body's larger size would over-reserve by ~9 % on every column — cheap, but
   wrong, and the two-context version is five lines. `resetMeasureCtx` (`:48-52`) clears the whole
   map, so P31 D11's font-change invalidation keeps working unchanged.
2. **It is capped.** Without `MIN_WIDTH_CAP`, a column named
   `customer_subscription_renewal_reason` would become undraggable below ~280 px. 200 px is the
   ceiling: it is under `MAX_WIDTH`'s 480 and above the 42–58 px of chrome plus ~20 characters of
   name, which covers the overwhelming majority of real column names; past it, ellipsising is the
   right answer and the tooltip (`columnHeaderTooltip`, `:297-309`) already carries the full name.
3. **It answers both halves of "cropped".** The same number feeds the column's `width` **and** its
   `minWidth` in `SlickGridHost.vue:427-436`:
   `width: Math.max(floor, storedWidths[name] ?? measured[name] ?? DEFAULT_COLUMN_WIDTH)` and
   `minWidth: floor`. Fixing only the initial width would leave a drag able to crop the header
   again — which is exactly the state the "already clamps a stored width" comment at `:427-430` was
   written about.
4. **The PK/FK badge is asynchronous, and the existing rebuild already covers it.**
   `chrome.keyBadge` is derived from the same `keyLabelFor(descriptor, name, foreignKeyNamesFor(meta))`
   the badge itself uses (`SlickGridHost.vue:1092`), and `buildColumns` already takes `meta`
   (`:373-377`) and is already re-run by the `meta` watch when `treeDescribe` resolves. So a column
   widens for its badge at the same moment the badge appears, with no new watcher.

**Why not simply raise `CELL_PADDING`.** It is the *body* cell's budget, used for the sampled data
widths too; raising it would widen every column by the header's furniture whether or not the header
is the maximum, and would still be flat rather than per-column. The item asks for a *per-column*
minimum, and the two numbers genuinely answer different questions.

### D5 — The console result grid consumes the same helper and comes out byte-identical (F2)

`ConsoleSlickGrid.vue:159-175` passes `{ padding: 16, sortControl: 0, keyBadge: 0 }` — its columns
are `sortable: false` (`:175`) so SlickGrid never builds a sort indicator (F2), and it renders no
PK/FK badge. `headerAwareMinWidth` then reduces to `max(MIN_WIDTH, ceil(headerText + 16))`, which
for every name short enough to matter is `MIN_WIDTH` — the number that file already uses.

This is deliberate: the alternative (a helper only `SlickGridHost.vue` calls) would leave the
console grid with a *different* rule for the same visual object, which is the class of divergence
`columns.ts:16-22`'s own comment exists to record having already cleaned up once. Two call sites,
one function, one set of constants, and the console's rendering provably unchanged — `slick-grid.
spec.ts`/`console.spec.ts` passing unedited is the guard (§4).

### D6 — `.p-select.bordered` is `h-sm`; `.p-select.md` is the opt-in (F4, F5, item 4)

`primitives.css:398-405` loses its `height` declaration and one rule is added:

```css
.p-select          { height: var(--kira-h-sm); … }              /* unchanged */
.p-select.bordered { /* height inherited from .p-select */ … }  /* was --kira-h-md */
.p-select.md       { height: var(--kira-h-md); }                /* new */
```

Then:

- **Six local overrides are deleted** — `CellEditorView.vue:620-623`, `FormDataTable.vue:168-173`,
  `HttpRequestView.vue:381-386`, `RequestBodyPane.vue:183-188`, `GrpcRequestView.vue:345-350`,
  `EnvironmentSelect.vue:47-52`, comment included. Each file keeps whatever *else* its local rule
  said (`CellEditorView`'s `max-width: 160px` and `font-family`, for instance).
- **`SettingsDialog.vue:287` and `:466` gain `md`** — F5 shows both sit beside `size="md"`
  TextFields; they are the call sites the old default was right for.
- **`GenerateDataDialog.vue:242` and `SaveRequestDialog.vue:86` gain nothing**, which is the fix:
  both drop from 26 px to 22 px and finally match the `sm` TextFields in the same row (F5).

**Why this shape and not `.p-select.sm`.** P13 OQ-2 proposed `.sm`; six-of-ten call sites wanting
the non-default is not a modifier, it is a wrong default. And the app already has this exact
two-step idiom on both of its other box controls — `.p-input` / `.p-input.md`
(`primitives.css:128-143`) and `.p-seg` / `.p-seg.md` (`:422-432`), both `h-sm` by default with an
`md` opt-in. `.p-select` is the only one of the three that inverted it. Adopting `.md` makes the
three agree and adds no new vocabulary; adopting `.sm` would have made `.p-select` the one control
with a *shrinking* modifier.

**The design system's own stylesheet is fixed too.** `parts/_style.css:78`'s
`.p-select.bordered { height: var(--h-md); … }` gets the same treatment, `.p-select.md` is added
beside it, and `parts/bodies/Console.html:27`'s inline `style="height:var(--h-sm)"` — the seventh
copy of the override, F4 — is deleted. `node build.mjs` then regenerates the sixteen `*.dc.html`
files. P15 §0.4 held `parts/**` out of scope on the grounds that the Api module has no artboard
there; that reasoning does not apply to a primitive's own height, which the artboards *do* draw and
*do* hand-patch. The SPEC row's own words are *"fixed at the design-system level"*, and this file is
that level.

**The divergence this does not close, named rather than hidden:** the artboards draw a *borderless*
`.p-select` in toolbars while the app uses `.p-select.bordered` at all ten call sites and the
borderless variant has zero consumers (F4). This phase changes the height, not the border. OQ-4.

### D7 — `.p-input` and `.p-textarea` adopt the app's own 8 px text gutter (F6, item 5)

Three edits in `primitives.css`, and nothing else:

| Rule | Before | After |
|---|---|---|
| `.p-input` (`:133`) | `padding: 0 var(--kira-s-3)` (6 px) | `padding: 0 var(--kira-s-4)` (8 px) |
| `.p-textarea` (`:247`) | `padding: var(--kira-s-2)` (4 px all round) | `padding: var(--kira-s-2) var(--kira-s-4)` (4 / 8) |
| `.p-input.has-stepper input` (`:196-198`) | `padding-right: var(--kira-s-1)` (2 px) | `padding-right: var(--kira-s-2)` (4 px) |

- **8 px is not a new number.** F6's table shows it is the inset `.p-toolbar`, `.p-view-head`,
  `.p-th`, `.p-td`, `.slick-cell` and `.slick-header-column` all already use. The input was the
  outlier; the textarea was the outlier's outlier.
- **No height changes.** `--kira-h-sm` / `--kira-h-md` are untouched, so nothing reflows vertically
  and no row's control heights move (which is item 4's whole subject and must not be perturbed by
  item 5).
- **The padding goes on `.p-input`, never on `.p-input input`** — F6's `AutocompleteField` overlay
  constraint. A one-line comment at the rule records why, because "just pad the input" is the
  obvious wrong fix and the next reader will think of it.
- **Nothing opts out that should not.** `PagerControls.vue:113-116` already overrides
  `.page-input :deep(.p-input) { padding: 0 var(--kira-s-2) }` for its 46 px page box and keeps
  doing so; that override becomes *more* necessary, not less, and is left exactly as written.
- **Fixed-width wrappers absorb the change.** `SearchToolbar.vue:354-361` (200 px),
  `PanelSearchBox.vue:49-56` (100 %), and the ten other `:deep(.p-input) { width: 100% }` call
  sites P15 F3 enumerated all set the box's *outer* width, so those fields keep their footprint and
  spend 4 px of it on breathing room. An *unwrapped* `.p-input` (`inline-flex`, shrink-to-fit) grows
  by 4 px — the intended effect, and the reason §4 runs the full UI suite rather than a subset.

**Not done: `.p-input { display: flex; width: 100% }`.** P15 OQ-1 floated it as the "right" fix for
the fourteen `:deep(.p-input)` wrappers. It is a change to the sizing of every input in the app,
it needs a screenshot pass this environment cannot take, and it is orthogonal to *crowding* — which
is what this item is. Left for whoever gets a real screen; OQ-5.

### D8 — A placeholder and a prefix label are `muted`, not `disabled` (F7, item 6)

`primitives.css:167-170`:

```css
.p-input .ph,
.p-input input::placeholder { color: var(--kira-fg-muted); }   /* was --kira-fg-disabled */
```

2.55:1 → **4.80:1** on `--kira-bg-input` (F7's table). This one rule reaches every text input in
both modes — Studio's WHERE/ORDER BY prefixes (`FilterToolbar.vue`), Mongo's filter/sort prefixes
(`DocumentView.vue`), the stream offset field, every `TextField` placeholder in the Api request
builder and every dialog in the app.

**`--kira-fg-muted`, not a new value, and not `--kira-fg`.** `#9d9d9d` is a clear step below
`--kira-fg` `#cccccc` (7.78:1 vs 10.26:1 against the same input background), so "this is a hint, the
value is the real text" still reads. And P27's `.ph.ph-active` accent state (`:178-180`) still
contrasts against it as sharply as before — the active/inactive distinction is a hue change, not a
lightness one.

### D9 — `--kira-fg-subtle`, and `--kira-fg-disabled` reserved for disabled controls (F7, F8, item 6)

`tokens.css` gains one token beside the existing foreground ramp:

```css
--kira-fg: #cccccc;
--kira-fg-muted: #9d9d9d;
/* Tertiary, non-interactive text: separators, captions, row numbers, NULL markers, empty-state
   copy. Not a disabled control — WCAG 1.4.3 exempts those, which is why --kira-fg-disabled below
   may stay under 4.5:1 and this may not. 4.77:1 on --kira-bg, 4.72:1 on --kira-bg-elevated. */
--kira-fg-subtle: #8a8a8a;
--kira-fg-disabled: #6e6e6e;   /* :disabled / .is-disabled only */
```

Then F8's classification is applied: the **seven** genuinely-disabled rules keep
`--kira-fg-disabled`; every rule in F8's second table moves to `--kira-fg-subtle`. `.dim`
(`primitives.css:13-15`) moving is what carries the change to ~40 call sites without touching
them.

Three notes on the value:

- **`#8a8a8a` is the lightest step that is still visibly below `--kira-fg-muted` while clearing
  4.5:1** on `--kira-bg` (4.77) and `--kira-bg-elevated` (4.72) — the two backgrounds every
  consumer in F8's table sits on. It does **not** clear 4.5:1 on `--kira-bg-input` (3.77), which is
  why D8 sends the placeholder/prefix pair to `muted` instead: they are the only members of the
  set that live on an input background.
- **The ramp stays three steps for text, plus one for disabled.** `fg` → `muted` → `subtle` →
  (`disabled`). Nothing is flattened: a `.dim` caption is still visibly quieter than a `muted` one.
- **`scripts/check-tokens.sh` passes by construction** — it only checks that every referenced
  `--kira-*` resolves to a definition in `theme/{tokens,base,primitives}.css`, and the new token is
  defined there. `theme/base.css:15`'s Tailwind bridge gains the matching `--color-subtle` so the
  utility layer stays complete.

### D10 — `PanelSearchBox` gains two optional props and becomes the Api module's one filter affordance (F9, F10, items 7 and 8)

```ts
defineProps<{ modelValue: string; placeholder?: string; testid?: string }>();
```
with `placeholder = 'Search'` and `testid = 'tree-search'` as defaults, so `PanelShell.vue:87`'s
existing call site is byte-identical in behaviour and `tree.spec.ts`'s `tree-search` selector is
untouched.

**Why this rather than a new primitive.** The SPEC's own instruction is *"consistent with how
search/filter already works elsewhere in this app (Studio's own tree search is a precedent to
match, not reinvent)"*, and F9 finds that the Api collections tree **already renders this exact
component**. Reusing it means the filter box in the Variables dialog and the one above the
collections tree are the same 70 lines of markup and the same visual object, not two things that
look alike. Two optional props for six new callers is not P13 §0.2's "widening a shared primitive
for one Api caller" — it is the case that line was reserving room for.

**The rule every filter in this phase follows, stated once:** a filter *hides non-matching entries*
and is a plain case-insensitive substring test over the fields named per surface. No regex, no
case/word toggles, no match-navigation — that vocabulary belongs to `SearchToolbar` and its
chunked scan (F10), and none of these lists is large enough to need it.

### D11 — A find bar for the response body and raw panes, built on P15b's own seam (F10, F12, item 7)

New `views/httprequest/ResponseFindBar.vue` — a `.p-toolbar` docked **below** the pane it searches
(`SearchToolbar.vue:212-213`'s own LAW 03 placement, and `DataView.vue:247-260`'s precedent), with:

- a `TextField` (`http-find-input`), autofocused on mount;
- `N of M` (`http-find-count`), prev/next `IconButton`s (`http-find-prev`, `http-find-next`), a
  close `IconButton` (`http-find-close`);
- `Enter` / `Shift+Enter` to step, `Escape` to close — the exact key handling
  `SearchToolbar.vue:184-192` uses.

Opened by a `search` `IconButton` in the response status row (`ResponsePane.vue:201-206`, beside
the pane switcher), and by `view.find` — `registerCommand('view.find', …)` while an http-request tab
is active, mirroring `DataView.vue:140`.

Three supporting pieces, each the smallest thing that works:

1. **`editor/findRanges.ts`** *(new, ~20 lines)*: `findRanges(doc, query): RangeHighlight[]` — a
   case-insensitive `indexOf` walk returning `{from, to, class}` in the shape
   `variableHighlight.ts:14-19` already defines, with `class` `'cm-kira-find-match'` or
   `'cm-kira-find-match-current'` for the active one. Empty query → `[]`.
2. **`editor/theme.ts`** gains the two classes, using
   `--kira-search-match` / `--kira-search-match-current` — the pair `tokens.css:26-27` already
   defines and five other surfaces already consume (F10). **No new token.**
3. **`CodeMirrorHost.vue:267-275`** gains one exposed method:
   `scrollRangeIntoView(from, to)` → `view?.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }) })`.
   Additive, read-only-safe, and the one capability F10 found missing.

**Multiple documents, one bar.** The bar takes
`targets: { doc: string; host: { scrollRangeIntoView(f: number, t: number): void } }[]` — one entry
for the Body pane, **two** for the Raw pane (`RawExchangePane.vue:124` and `:146`, request wire and
response wire). Matches are numbered across the targets in order, and `goTo` calls that target's
own `scrollRangeIntoView`. Splitting them into two independent bars would give the Raw pane two
"1 of 3" counters for one document the user reads as one.

**Why not `@codemirror/search`.** It is not a dependency (F10), and AGENTS.md's library-first rule
asks for the requirement no library meets to be named rather than the reverse: the requirement here
is *this app's own toolbar chrome and its own `--kira-search-match` pair* — `@codemirror/search`
ships its own panel DOM, its own keymap and its own `.cm-searchMatch` styling, all of which would
have to be suppressed and re-skinned, and the search half of it would then be doing what
`indexOf` does. The seam that makes the hand-rolled version ~20 lines already exists because P15b
built it.

**Why the response side only.** F12: the request body editor and request fields already occupy
`CodeMirrorHost`'s single `rangeHighlights` compartment with P15b's `{{variable}}` colouring, and
multiplexing two decoration sources through one compartment is a real design question, not a
find-bar detail. The response body and both raw panes have the seam free. OQ-6.

### D12 — The response headers pane filters by name or value (F12, item 7)

`ResponsePane.vue:259-266`'s headers branch gains a `PanelSearchBox` above the `.p-kv-row` list
(`testid="http-response-headers-filter"`, `placeholder="Filter headers"`), a `computed` over
`response.headers` matching **name or value**, and a `p-xs subtle` count line reading
`N of M headers` while the filter is non-empty. The filter state is component-local `ref`, not tab
state: it is a lens, not a setting, and P24 D7's rule for `SearchToolbar` — *"a closed toolbar must
never leave rows hidden with no visible cause"* — is satisfied trivially because the box is always
visible while the pane is.

Response headers are the one Api list where matching **values** is right: a header's value is the
thing being hunted (`Location`, a content type, a cache directive), it is server-provided, and §5
shows it can never be a secret's plaintext.

### D13 — The request tables filter behind a toolbar toggle, carrying original indices (F11, items 7 and 8)

`FieldRowsTable.vue` — and therefore all four of Params, Headers, urlencoded and form-data —
changes shape in exactly one way:

```ts
// was: displayRows = [...props.rows, props.blankRow()]
const displayRows = computed(() => [
  ...props.rows.map((row, index) => ({ row, index })).filter(({ row }) => matches(row)),
  { row: props.blankRow(), index: props.rows.length },
]);
```

and every `updateField(i, …)` / `toggleEnabled(i)` / `removeRow(i)` call site in the template passes
`entry.index` instead of the `v-for` position. Three rules:

1. **The trailing blank row is never filtered.** It is the add affordance, not data; hiding it
   would make a filtered table un-appendable.
2. **P15b's arrow-key navigation needs no change.** `FieldRowsTable.vue:100-148` walks
   `container.children`, so it moves between *visible* rows — which is the correct behaviour under a
   filter, not a bug to work around.
3. **The filter matches name or value** (both are user-authored request content; §5).

`FormDataTable.vue` and `views/grpcrequest/MetadataTable.vue` hold their own copies of the same
row shape (`FormDataTable.vue:135-138` and `MetadataTable.vue:9-12` each say why) and get the same
treatment.

**The affordance is a `search` `IconButton` in `#toolbar-2`**, between the request-pane
`SegmentedControl` and `EnvironmentSelect` (`HttpRequestView.vue:338-345`), toggling a
`PanelSearchBox` row above the table — which is precisely Studio's own idiom
(`DataToolbar.vue:246-252`'s `toolbar-search` button toggling `SearchToolbar` in `DataView.vue`'s
`#strips`). An always-present filter row above a three-row headers table would be chrome for its
own sake; a toggle that the user reaches for on a twenty-header request is the same gesture Studio
already teaches. The button is `:active` while the filter row is open and clearing it on close is
required (rule 1's spirit): closing the row must restore every hidden row.

### D14 — The variables and environments dialogs filter by **name only**, and reordering is disabled while filtered (F11, item 8, §5)

`VariablesDialog.vue` and `EnvironmentsDialog.vue` each gain a `PanelSearchBox` directly under the
dialog title (`variables-filter`, `environments-filter`) and filter their row list.

Two rules, both load-bearing:

1. **The predicate reads the row's `name` and nothing else.** For variables this is a secret-safety
   rule, not a convenience: §5 works through why matching on `value` would turn the filter box into
   an oracle. For environments it is simply what a name filter means.
2. **While the filter is non-empty, reordering is off.** The drag handle gets `draggable="false"`
   and a `v-tooltip` reading *"Clear the filter to reorder"*, and `onMove` (`VariablesDialog.vue:200-206`)
   returns early. F11 shows both dialogs splice `order` by the *rendered* index; but the deeper
   reason is semantic — "move up" past a hidden neighbour has no defined result, and silently
   reordering against the unfiltered list would move a row the user cannot see. Refusing is the
   honest answer; carrying original indices through a reorder would implement a behaviour nobody
   can predict.

### D15 — The remaining three list surfaces get the same box, and nothing else (F13, item 8)

| Surface | File | Filter matches | testid |
|---|---|---|---|
| Response history | `ResponseHistoryList.vue:109` | method, URL, status text, environment name | `http-history-filter` |
| Dynamic values (58 entries) | `DynamicValuesDialog.vue:49` | the `$name` and its generated sample | `dynamic-values-filter` |
| gRPC schema browser | `SchemaBrowser.vue:140-145` | service name and method name | `grpc-schema-filter` |

Each is a `computed` filter plus one `PanelSearchBox`, with an `EmptyState`-shaped
*"No matches"* line when the filter empties the list (`ResponseHistoryList` and
`DynamicValuesDialog` already render an `EmptyState` for the genuinely-empty case — the filtered
case gets its own copy so *"nothing here yet"* and *"nothing matches"* stay different sentences).

**`DynamicValuesDialog` gets a filter and nothing more.** P17's row already owns the `fake.`
re-namespacing and the catalogue's autocomplete; adding a filter box to today's flat 58-name list
neither helps nor blocks that, and touching the names themselves here would be scope-creep into a
phase that has its own migration story to work out.

---

## 3. Commit sequence

Shared theme/token work first (the rest consumes it), then Studio's grid, then Api's search. Per
`AGENTS.md`: `bun run lint`, `bun run typecheck` and `bun run build` per commit; `tests/ui` runs
**once** at the end (§4), with fixes as follow-up commits.

| # | Commit | Item | Touches | Risk |
|---|---|---|---|---|
| Q5 | `fix(theme): a dropdown is the height of the row it sits in` | 4 | `theme/primitives.css` (`.p-select`), the six override files, `SettingsDialog.vue` (×2 `md`) | **medium** — one rule flip reaching ten call sites in both modes |
| Q6 | `style(design-system): the select primitive's own height, and the artboard that patched it` | 4 | `parts/_style.css`, `parts/bodies/Console.html`, regenerated `*.dc.html` | low — docs only; the 16-file regenerated diff is expected |
| Q7 | `fix(theme): inline text controls get the app's own 8px text gutter` | 5 | `theme/primitives.css` (`.p-input`, `.p-textarea`, `.has-stepper`) | medium — every input in the app widens by 4px |
| Q8 | `fix(theme): a placeholder is muted text, not disabled text` | 6 | `theme/primitives.css` (`:167-170`) | low |
| Q9 | `refactor(theme): --kira-fg-subtle, and --kira-fg-disabled means disabled` | 6 | `theme/tokens.css`, `theme/base.css`, `theme/primitives.css`, `slickTheme.css`, F8's scoped call sites | low per file, wide — mechanical, guarded by F8's own classification |
| Q1 | `fix(theme): the run-state label reserves its own width` | 1 | `theme/primitives/RunState.vue`, `theme/primitives.css` | low |
| Q2 | `feat(grid): the pager sits at the toolbar's right edge` | 1 | `views/grid/DataToolbar.vue`, `views/grid/DataView.vue` | low — same testids, same events; must follow Q1 |
| Q3 | `fix(grid): a column's minimum width knows what its header renders` | 2 | `views/shared/page/columns.ts`, `views/grid/SlickGridHost.vue`, `views/console/ConsoleSlickGrid.vue` | **medium** — changes default column layout; `slick-grid.spec.ts` is the guard |
| Q4 | `fix(grid): overscroll behaves the same on all four edges of the grid` | 3 | `views/shared/slick/slickTheme.css` | low mechanically, **user-visible on real hardware only** (D3, OQ-3) |
| Q10 | `feat(theme): PanelSearchBox takes its own placeholder and testid` | 7, 8 | `theme/primitives/PanelSearchBox.vue` | trivial — two optional props, defaults preserve today |
| Q11 | `feat(editor): a range can be scrolled into view, and find ranges have a class` | 7 | `editor/CodeMirrorHost.vue`, `editor/theme.ts`, `editor/findRanges.ts` *(new)* | low — additive; nothing consumes it yet |
| Q12 | `feat(api): find in the response body and the raw exchange` | 7 | `views/httprequest/ResponseFindBar.vue` *(new)*, `ResponsePane.vue`, `RawExchangePane.vue` | medium; must follow Q11 |
| Q13 | `feat(api): the response headers pane filters` | 7 | `ResponsePane.vue` | low; must follow Q10 |
| Q14 | `feat(api): the request tables filter, without losing a row's identity` | 7, 8 | `FieldRowsTable.vue`, `FormDataTable.vue`, `MetadataTable.vue`, `HttpRequestView.vue`, `GrpcRequestView.vue` | **highest in the Api half** — D13's index carry-through touches every write path in four tables |
| Q15 | `feat(api): variables, environments, history, dynamic values and the gRPC schema filter` | 8 | `VariablesDialog.vue`, `EnvironmentsDialog.vue`, `ResponseHistoryList.vue`, `DynamicValuesDialog.vue`, `SchemaBrowser.vue` | medium — D14's reorder gate is the part to review |
| Q16 | `test(p16): the specs §4 enumerates` | — | `apps/kira-studio/tests/ui/*.spec.ts` | low |

**Ordering that matters**: Q6 after Q5 (the artboard follows the primitive); Q2 after Q1; Q12 after
Q11; Q13/Q14/Q15 after Q10. Q3 and Q4 are independent of everything else. The cross-cutting theme
commits (Q5–Q9) come first because Q14's request tables and Q2's toolbar are read in review against
the heights and paddings those commits settle.

---

## 4. Verification plan

**Per commit**: `bun run lint` (biome + `scripts/check-tokens.sh` — Q9's new token is defined in
`tokens.css`, so the script stays green by construction), `bun run typecheck` (tests, web, unit,
api-core), `bun run build`. **No Go, no bindings regeneration** — nothing in this phase touches a
bridge method's signature, a schema, or a wire type.

**`bun run test:unit`** after Q3: nothing in `packages/api-core` changes, so the whole unit suite
passing unedited is the proof that the grid work stayed in the renderer.

**`tests/ui`, once at the end.** Specs that must be *checked and not edited* — each is a guard for a
specific decision, and a failure means the decision is wrong, not the spec:

| Spec | Guards |
|---|---|
| `data-view.spec.ts:1227-1340` | every `pager-*` testid and the `data-pagination` attribute survive D1's slot move unchanged |
| `slick-grid.spec.ts:1500-1590` | D4 did not disturb the column-resize drag or its `columnWidths` echo |
| `console.spec.ts` | D5's claim that the console result grid is byte-identical |
| `tree.spec.ts` | `tree-search` still resolves after D10's prop addition |
| `http-request.spec.ts`, `http-request-body.spec.ts`, `http-curl.spec.ts`, `http-dynamic-values.spec.ts`, `collections.spec.ts`, `grpc-request.spec.ts` | every `page.fill` into a `.p-input` still works after D7's padding change and D13's index carry-through |
| `http-history.spec.ts:356-361` | `.check()` on `http-history-checkbox` after D15 filters the list around it |
| `api-secret-reveal-isolation.spec.ts` (all three) | D14's filter did not disturb the reveal gate |
| `settings-apply-on-save.spec.ts`, `connection-dialog-tabs.spec.ts`, `fake-data.spec.ts` | the Studio regression guard for D6's height flip and D9's retint |
| `tooltips.spec.ts` | `v-tooltip` call sites in every file D9 touches |
| `budgets.spec.ts`, `perf.spec.ts` | D4 changes default column widths, therefore how many columns are mounted at rest |

**New coverage.** Studio cases go in `data-view.spec.ts` / `slick-grid.spec.ts`; Api cases go in
`api-ui-consistency.spec.ts`, the Api-only file P13 created and the SPEC's module-boundary rule
requires (*"a single test file covering both is not"*).

1. **D1** — with a data tab open, the pager's bounding box is to the right of `toolbar-search`'s,
   and `pager-next` is still clickable and still advances the page. (Asserted as a relative
   position, not a pixel, so a token change cannot break it.)
2. **D2** — `.p-run-state .label` reports the same `offsetWidth` for a tab showing `—` and for one
   showing an elapsed time. This is the LAW-12 assertion, and it is the only one that can catch the
   reflow returning.
3. **D4** — a table with a short-data, long-named PK column renders its header name **without**
   `text-overflow` truncation: `scrollWidth <= clientWidth` on that column's `.slick-column-name`.
   This is the item's own success condition stated as a measurement rather than a screenshot.
4. **D4** — dragging that column's resize handle to the far left leaves its width at the
   header-aware floor, not at 64.
5. **D3** — every `.slick-viewport` reports `overscroll-behavior: none` in computed style, and a
   `page.mouse.wheel(0, -400)` at `scrollTop === 0` leaves `scrollTop === 0`. (The bounce itself is
   not assertable here and §4's "not run" list says so.)
6. **D6** — in an http-request tab, `http-method-select` and `http-url`'s `.p-input` report the same
   `offsetHeight`; in the Generate-data dialog, the recipe `<select>` and the constant `TextField`
   in the same row do too; in Settings, the font-family select is 26 px.
7. **D8/D9** — `.p-input input`'s computed `::placeholder` colour is `--kira-fg-muted`'s value, and
   a `.dim` element's colour is `--kira-fg-subtle`'s. Cheap, and it pins the two tokens against a
   future well-meaning revert.
8. **D11** — open a request tab, send, open the find bar from the response status row, type a string
   present twice in the body: `http-find-count` reads `1 of 2`, `http-find-next` moves it to
   `2 of 2`, `Escape` closes the bar and removes every `.cm-kira-find-match` from the DOM.
9. **D12/D13** — filtering the response headers pane to a header name shows one `.p-kv-row`;
   filtering the request headers table and then editing the **one visible row** writes to that row
   and not to another (the D13 index-carry assertion, and the single most important new test in
   this phase).
10. **D14, and §5's own invariant** — in the Variables dialog with one secret variable whose
    plaintext the mock backend holds, typing that plaintext into the filter box matches **nothing**;
    typing the variable's *name* matches it. Plus: with a non-empty filter, the drag handle reports
    `draggable="false"` and Alt+↑ does not change the order. This case belongs in
    `api-secret-reveal-isolation.spec.ts`, beside the three reveal-gate cases it extends.

**Not run, and named rather than glossed:**

- **The elastic bounce itself (D3).** Real-Mac trackpad physics are unobservable here — the same
  limit `P22-slickgrid-pass-b.md` §7.3/§9.3/§14.2 records three times. What §4 asserts is the CSS
  declaration and the scroll position, which is everything this environment can honestly claim.
- **A pixel diff of D7's padding change or D9's retint.** No such harness exists in this repo (P13
  §7 and P15 §4 both said so). The guards are the computed-colour assertions in case 7 and the full
  UI suite passing.
- **A real screenshot of the toolbar after D1.** The bounding-box assertion in case 1 is the
  substitute; whether the pager *reads* better on the right is a judgement the user makes, and
  OQ-1/OQ-2 record the two ways back.

---

## 5. Secret masking — the analysis this phase owes, and its conclusion

The SPEC's standing invariant (*"a secret's plaintext must never reach a copyable surface ungated,
nor `kira.sqlite` outside `api_variables.secret_value`"*, `internal/bridge/http.go:108-115`) has been
reinforced by P5 D6, P9 D6, P10 D14/F16 and **two separate P14 review rounds** that each found a
re-encoded form leaking (`http.go:143-180`: `url.QueryEscape` in round 1's finding 6,
`url.PathEscape` in round 2's finding 4). A phase that adds *search over the response viewer* has to
answer whether searching can reveal what looking cannot. The answer is no, for three independent
reasons, each verified at this commit.

**1. The plaintext is not in the renderer for any surface a find bar reaches.** Masking runs in Go,
on the response object, *before* it crosses the bridge: `bridge/http.go:115` calls
`maskSecrets(&resp, usedSecrets)` on the success path and `:102` calls `maskSendErrTimeline` on the
failure path, both inside `RunOp`'s closure where `usedSecrets` is still in scope, and both
*before* `ResponseHistory.Record` (`:120-131`). `maskSecrets` (`:192-224`) rewrites
`resp.Wire.Request`, every `Timeline.Hops[].URL` and `.Headers[].Value`, every `Redirects[].URL` and
`FinalURL` back to `{{name}}`. So `ResponsePane`'s Raw pane, Timeline pane and redirect caption
render placeholder text; a search over them can only ever match a placeholder. The renderer-side
engine agrees by construction — `substitute.ts:28-30`: *"deferring any name in `secretNames` (D6: a
secret's plaintext never reaches this function on the renderer side — the caller simply never puts
one in `values`)"*.

**2. The response *body* is server-provided, is already fully rendered, and search adds no
exposure.** `ResponsePane.vue:265` mounts the whole `bodyText` in a `CodeMirrorHost` the user can
already read, scroll and select. A secret can appear there (an echo endpoint returns what was sent),
and it is deliberately *not* masked — masking a server's own response would be lying about what the
server said. D11's find bar highlights a substring of text that is on screen either way; it reveals
nothing that reading does not. Stated explicitly so the next reviewer does not have to re-derive it.

**3. The one place a search genuinely could have become an oracle is closed by D14.** A secret
variable's `row.value` is `''` in the renderer until an explicit, system-authenticated reveal —
`VariableRow.vue:43-48` states the contract (*"D5's projection guarantee: List/Upsert never hand
this component a secret's real value any other way"*) and `:131` renders `••••••••` for the
unrevealed case. A filter over the **value** column would therefore match nothing for an unrevealed
secret — but it would match a *revealed* one, and, more subtly, it would let a user type a guess and
read the answer off whether a row appeared. **D14 matches on `name` only**, which removes the
question by construction rather than by careful handling. Two supporting rules follow from it:

- **`VariableRow.vue:212`'s `.masked-value` dots are not searchable text** — a name-only predicate
  never reads them, so a filter can never surface the `••••••••` row *because of its value*.
- **The Copy-as-curl deferred-name list (`CopyAsCurlDialog.vue:22`) gets no filter.** It is short,
  and it is the one Api list whose entries are secret *names* adjacent to a reveal action; adding a
  filter there would buy nothing and would need this same analysis again.

**What this phase must not do, recorded as a hard line for the implementer:** no filter, find bar,
count, tooltip or `data-*` attribute added by this phase may read `revealedValues`,
`revealedHistoryValues`, or a `VariableRow`'s `value` for a row whose `isSecret` is true. §4 case 10
is the test that pins it.

---

## 6. The polish/feature line

The SPEC row calls this a user-driven batch, which makes the line worth drawing as explicitly as
P13 §5 and P15 §5 drew theirs.

**In scope — an affordance or a value that already exists, corrected:** D1/D2 (the pager and
`RunState` both exist; one moves, one stops moving its neighbours), D3 (a declaration changes one
word), D4/D5 (a minimum width exists; it becomes per-column and header-aware), D6 (a height
modifier idiom exists on `.p-input` and `.p-seg`; `.p-select` adopts it), D7 (a spacing scale
exists; the input joins it), D8/D9 (a foreground ramp exists; it gains its missing step and its
tokens get one job each).

**In scope, and genuinely new, because the SPEC row asks for it by name:** D11's find bar and the
`scrollRangeIntoView` seam it needs; D10's two props; D12–D15's seven filters. This is the Api half,
and it is new capability rather than polish — named as such rather than smuggled in under "search
affordance".

**Out of scope — flagged, not fixed:**

1. **`.p-input { display: flex; width: 100% }`** and the fourteen `:deep(.p-input)` wrappers — P15
   OQ-1's other half, orthogonal to crowding (D7, OQ-5).
2. **A find bar over the *request* body editor** — the `rangeHighlights` compartment is taken
   (D11, OQ-6).
3. **`EnvironmentsDialog.vue:139`'s raw `<input type="radio">`** — an unstyled native control of
   exactly the kind P15 D5 fixed for checkboxes, but a radio, and not a dropdown or a text input
   (OQ-7).
4. **The method `<select>`'s colour-coding** — P17's row owns it by name. D6 changes that select's
   *height* and nothing else, and leaves the file in the state P17 wants to find it in.
5. **`ResponseHistoryList`'s live-refresh bug and its 30-entry cap** — P18 items 1 and 2. D15 adds a
   filter *over* that list and changes neither its data source nor its store.
6. **`GrpcRequestView`'s own P15/P15b parity pass** — P18 item 3. D6 and D13 touch two rules in that
   file's neighbourhood (a select height, `MetadataTable`'s filter); nothing else about the gRPC
   view changes.
7. **The `overflow-x: scroll` scrollbar gutter on the frozen gutter pane** — F3 observes that
   SlickGrid makes a 56 px pane a horizontal scrollport that can never scroll. It is a real
   oddity; it is not an overscroll question, and chasing it would mean overriding a pane style
   SlickGrid writes inline on every `resizeCanvas`. Recorded, not fixed.

---

## 7. What this phase deliberately does not do

- **Does not change `--kira-fg-disabled`'s value, or any existing token's value.** D9 adds one
  token and re-points rules; every other colour, size and space in `tokens.css` is untouched.
- **Does not change a control's height token.** D6 flips which token a rule reads;
  `--kira-h-sm`/`--kira-h-md` themselves are untouched, and `--kira-titlebar-h`'s standing warning
  (`tokens.css:51-64`) is not approached.
- **Does not add a dependency.** D11 says why `@codemirror/search` is declined and what replaces it.
- **Does not touch Go, the bindings, `packages/shared`'s schemas or `packages/api-core`.** §5 is an
  analysis of Go code, not an edit to it.
- **Does not change any `data-testid`.** Every existing one is preserved verbatim, including
  through D1's slot move and D13's index carry-through; every new one is additive.
- **Does not remove an affordance.** D6 deletes six local CSS overrides that a shared rule now
  makes redundant; D3 replaces one CSS value with another. Nothing a user can click goes away.
- **Does not draw an Api artboard.** P13 OQ-5 still stands; D6 edits `parts/_style.css` because a
  *primitive's* height is wrong there, not because the Api module gained a canvas.

---

## 8. Open questions

**OQ-1 — should the page-size picker follow the pager to the right?** D1 moves the pager alone, on
the "navigation is used repeatedly, a setting is not" argument. The counter-argument is that
*"page 3 of 47"* and *"200 / page"* read as one sentence and this phase splits them across a 13-control
row. Cheap to reverse: one more element moves between two slots.

**OQ-2 — the artboard now disagrees with the app about where a pager lives.**
`parts/bodies/Toolbars.html:22-28` draws it on the left. D1 does not redraw it, because that
artboard's pager is a *different control* (an absolute row range, which D7's cursor paging cannot
produce) and redrawing it properly means redrawing the whole data toolbar band. Recorded so the next
person to open that file knows the divergence is known.

**OQ-3 — `none` or back to `contain`?** D3 takes `none` because it is the only expressible branch of
the SPEC's own either/or, and because it makes the four edges agree by construction. It is also a
deliberate re-opening of a previously-reverted instruction (F3). If the user sees it on real
hardware and misses the bounce, the revert is one word in `slickTheme.css`, and the honest position
then is that the asymmetry is a WebKit property this app cannot address from CSS at all.

**OQ-4 — bordered or borderless selects in toolbars?** F4 finds the design system draws borderless
`.p-select` in toolbars while the app uses `.p-select.bordered` at all ten call sites and never uses
the borderless variant. D6 fixes the height and leaves the border alone: ten call sites agreeing
with each other is worth more than ten call sites agreeing with an artboard, and un-bordering them
is a visual change nobody asked for. But one of the two should eventually give, and this is the
record that they disagree.

**OQ-5 — 8 px padding, or `.p-input { display: flex; width: 100% }`?** D7 takes the padding fix
because that is the item; P15 OQ-1's structural fix is still open, still wants a real screenshot
pass, and is now the *only* thing left in that OQ.

**OQ-6 — two decoration sources in one `rangeHighlights` compartment?** D11 scopes the find bar to
the response side because the request body's compartment is taken by P15b's `{{variable}}`
colouring. A `rangeHighlights` prop that accepts an *array* of sources, merged, would let a find bar
run over the request body too. That is a change to a shared editor seam and belongs to whoever next
has a real reason to want it.

**OQ-7 — the environment dialog's raw `<input type="radio">`.** `EnvironmentsDialog.vue:139` is an
unstyled platform radio, the same gap P15 D5's `Checkbox` closed for the fourteen raw checkboxes. A
`Radio.vue` beside it would be ~40 lines and one call site — arguably too few call sites to justify
a primitive, arguably exactly the inconsistency this phase's cross-cutting half is about. Left out
because it is neither a dropdown nor a text input, which is what the row names.

**OQ-8 — should the filters remember themselves?** Every filter in D12–D15 is component-local state
that resets when its pane, dialog or toggle closes. Persisting a request-table filter into tab state
would survive a reload and would then need P24 D7's *"never leave rows hidden with no visible
cause"* treatment on restore. Deliberately not done; the affordance is a lens, not a setting.

---

## Checklist

- [x] **Q1** `RunState` label wrapped and given `min-width: 7ch; text-align: right`; the LAW-12
      reflow `ViewChrome.vue:88-90` claims to prevent is actually prevented *(item 1a)*
- [x] **Q2** `PagerControls` moves from `DataToolbar`'s `#toolbar` to `DataView`'s `#toolbar-end`,
      **last**; page-size picker stays; every `pager-*` testid unchanged *(item 1b)*
- [x] **Q3** `headerAwareMinWidth` + `HeaderChrome` in `columns.ts`; `getMeasureCtx` keyed by size
      token; `MIN_WIDTH_CAP = 200`; consumed as both `width` floor and `minWidth` in
      `SlickGridHost.vue`; `ConsoleSlickGrid.vue` passes zero sort/badge chrome and renders
      unchanged *(item 2)* — the header-chrome constants were corrected in a follow-up commit once
      `tests/ui`'s own new D4 case (against a real captured FK column) caught them 8px short: the
      container's own `gap` between flex children is a separate spacing from a child's own margin,
      not the same one counted twice
- [x] **Q4** `.slick-viewport { overscroll-behavior: none }`; `slickTheme.css:20-46`'s comment
      rewritten with F3's frozen-pane table, the "only one branch is expressible" argument and the
      one-word revert *(item 3)*
- [x] **Q5** `.p-select.bordered` loses its `height`; `.p-select.md` added; six local overrides
      deleted (`CellEditorView`, `FormDataTable`, `HttpRequestView`, `RequestBodyPane`,
      `GrpcRequestView`, `EnvironmentSelect`); `SettingsDialog`'s two selects gain `md`;
      `GenerateDataDialog` and `SaveRequestDialog` gain nothing and thereby match their rows
      *(item 4a)*
- [x] **Q6** `parts/_style.css` mirrors Q5; `parts/bodies/Console.html:27`'s inline height patch
      deleted; `node build.mjs` re-run *(item 4b)*
- [x] **Q7** `.p-input` `--kira-s-3` → `--kira-s-4`; `.p-textarea` → `var(--kira-s-2)
      var(--kira-s-4)`; `.has-stepper input` `--kira-s-1` → `--kira-s-2`; a comment recording why
      the padding may not move onto the inner `<input>` *(item 5)*
- [x] **Q8** `.p-input .ph` / `::placeholder` → `--kira-fg-muted` *(item 6a)*
- [x] **Q9** `--kira-fg-subtle: #8a8a8a` in `tokens.css` (+ `--color-subtle` in `base.css`); F8's
      second table retinted; F8's seven genuinely-disabled rules untouched; the three non-`color`
      uses untouched — plus two `.drag-handle` sites (`api/VariableRow.vue`,
      `api/EnvironmentsDialog.vue`) F8's own table didn't spell out by line but which match the
      same pattern as `ColumnsMenu.vue`'s own drag handle, already in F8's list *(item 6b)*
- [x] **Q10** `PanelSearchBox` gains optional `placeholder` and `testid`, defaults preserving
      `PanelShell`'s call *(items 7, 8)*
- [x] **Q11** `CodeMirrorHost.scrollRangeIntoView`; `.cm-kira-find-match(-current)` in
      `editor/theme.ts` on the existing `--kira-search-match` pair; `editor/findRanges.ts`
      *(item 7a)*
- [x] **Q12** `ResponseFindBar.vue` over multi-target docs (Body ×1, Raw ×2); opened from the
      response status row and from `view.find`; Enter/Shift+Enter/Escape *(item 7b)*
- [x] **Q13** response headers pane filters on name or value, with an `N of M` line *(item 7c)*
- [x] **Q14** `FieldRowsTable`/`FormDataTable`/`MetadataTable` filter with original indices carried
      through every write path; trailing blank row never filtered; `search` toggle in `#toolbar-2`
      *(items 7d, 8a)*
- [x] **Q15** Variables + Environments filter **by name only** with reordering disabled while
      filtered; History, Dynamic values and the gRPC schema browser filter *(item 8b)*
- [x] **Q16** §4's spec updates and the ten new cases, including case 9 (D13's index carry-through)
      and case 10 (§5's secret-oracle invariant, in `api-secret-reveal-isolation.spec.ts`)
- [x] full `bun run test:ui` once, after Q16; fixes land as follow-up commits (172/173 pass; the
      one failure, `budgets.spec.ts`'s own "interaction budgets — scroll…" case, is the
      pre-existing cross-file-worker-contention flake its own comment already documents — confirmed
      unrelated by re-running it in isolation, where it passes)

---

## 9. Sources

**Read in full at `bf7faa5`:** `views/grid/{DataView,DataToolbar,SlickGridHost}.vue`,
`views/shared/page/{columns.ts,PagerControls.vue,SearchToolbar.vue}`,
`views/shared/slick/slickTheme.css`, `theme/{tokens.css,base.css,primitives.css}`,
`theme/primitives/{TextField,AutocompleteField,PanelSearchBox,ViewChrome,RunState}.vue`,
`editor/{CodeMirrorHost.vue,theme.ts,variableHighlight.ts}`,
`views/httprequest/{ResponsePane,FieldRowsTable,ResponseHistoryList,RawExchangePane,HttpRequestView}.vue`,
`api/{VariablesDialog,EnvironmentsDialog,DynamicValuesDialog,VariableRow,CollectionsPanel,SaveRequestDialog,EnvironmentSelect}.vue`,
`workbench/{SettingsDialog,GenerateDataDialog}.vue`, `internal/bridge/http.go`,
`packages/api-core/src/http/substitute.ts`, `biome.json`, `scripts/check-tokens.sh`, `AGENTS.md`.

**Read for a specific claim:** `slickgrid@5.20.0/dist/styles/css/slick.grid.css` and
`dist/esm/index.js` (`createColumnHeaders`' `m.sortable` gate, `updateViewportOverflow`'s
frozen-column overflow table), `views/console/ConsoleSlickGrid.vue:136-176`,
`views/shared/celleditor/CellEditorView.vue:600-640`, `views/grpcrequest/{MetadataTable,GrpcRequestView,SchemaBrowser}.vue`,
`views/httprequest/{FormDataTable,RequestBodyPane,variableCompletion.ts}`,
`theme/primitives/PanelShell.vue`, `wheelScroll.ts`, `package.json` (the `@codemirror/*` list),
every file in F8's table, `docs/design/kira-design-system/{README.md,build.mjs,parts/_style.css,parts/bodies/{Toolbars,Console,SettingsDialog}.html}`,
`apps/kira-studio/tests/ui/{data-view,slick-grid,api-ui-consistency,api-secret-reveal-isolation,http-history,tree}.spec.ts`.

**Prior plans consulted:** `docs/v1.2/plans/P15-request-builder-ux.md` (structure, §5's line, and
OQ-1, which names P16 as its destination), `docs/v1.2/plans/P15b-request-builder-editor-behavior.md`
(the `rangeHighlights` seam D11 builds on), `docs/v1.2/plans/P13-api-ui-check.md` (D4/OQ-2, the
`.p-select` override count and its own stated trigger), `docs/v1.1/plans/P22-slickgrid-pass-b.md`
§14.2 (the overscroll item, still open), `docs/v1.1/plans/P27-active-filter-indicator-color.md`
(citation discipline). `docs/v1.2/SPEC.md`'s P16 row, its P17/P18/P19 rows (§0.4's boundaries) and
its Studio/Api module-boundary section.
