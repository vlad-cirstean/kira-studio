# P15 — request-builder UX, part 1: layout, primitives and body mode

> **What this phase is.** `docs/v1.2/SPEC.md`'s P15 row — a user-driven polish pass over the
> request builder, twelve concrete pieces of reported friction rather than a self-directed audit.
> The row itself hands this plan two decisions: whether the `{{variable}}` colouring/autocomplete
> work extends `AutocompleteField.vue`'s existing mechanism or warrants a different one, and
> *"whether the full list lands as one phase or is split into a follow-up, given its range from
> small layout fixes to real editor-behaviour work."*
>
> **This plan splits it, and §0.3 says why.** Part 1 (this file) is presentation: eight items that
> are CSS, markup, one new shared primitive, and one UI-level mode promotion over unchanged
> storage. Part 2 (`P15b-request-builder-editor-behavior.md`) is input machinery: four items that
> all land in the same three files (`AutocompleteField.vue`, `CodeMirrorHost.vue`,
> `FieldRowsTable.vue`) and share one mechanism.
>
> **Base commit.** Everything below was read against `a4c8e4d` (*"docs(v1.2): add P15, a
> user-driven request-builder input/editor UX pass"*, branch `claude/feature-v1-2`) — the SPEC
> commit sitting on top of P14's second review round (`1f18fc6`..`05c4824`). Every file:line
> citation points at that commit's content.
>
> **The precedent this matches.** `docs/v1.2/plans/P13-api-ui-check.md` (the finding →
> decision → commit-sequence shape, its §5 polish/feature line, its §9 open questions),
> `docs/v1.1/plans/P27-active-filter-indicator-color.md` (citation discipline: every claim carries
> a file:line read at the base commit, and a finding that turns out to be *already fixed* says so),
> `docs/v1.1/plans/P28-settings-panel-overhaul.md` (the `.p-textarea` promotion that D5's
> `Checkbox` follows).
>
> **The one line P13 held that this phase deliberately crosses.** P13 §0.2: *"Widening a shared
> primitive's props for one Api caller — every earlier Api phase held that line and this one keeps
> it."* The SPEC's P15 row asks for *"a new shared Checkbox primitive … replacing every raw
> `<input type="checkbox">` app-wide (Studio included, since primitives already live in the shared
> theme layer — `AppButton`/`TextField`/`SegmentedControl` are precedent)"*. That is not one Api
> caller widening a primitive for itself; it is fourteen call sites across both modes converging on
> one. D5 states the case in full.

---

## 0. Scope

### 0.1 The twelve items, and where each lands

| # | Item (user's own framing) | Phase | Commit |
|---|---|---|---|
| 1 | Response panel present from tab-open, not only after a send | **part 1** | M4 |
| 2 | A status code's meaning without a hover | **part 1** | M5 |
| 3 | Studio/Api mode-switch buttons bigger | **part 1** | M9 |
| 4 | Headers/params/form-data tables fill their width | **part 1** | M3 |
| 5 | A shared Checkbox primitive, used everywhere | **part 1** | M1, M2 |
| 6 | JSON its own top-level body mode | **part 1** | M6 |
| 7 | Header-name autocomplete | part 2 | N4 |
| 8 | Body-present indicator on a request tab | **part 1** | M8 |
| 9 | Save beside the name; URL field much wider | **part 1** | M7 |
| 10 | `{{variable}}` colouring, hover value, autocomplete | part 2 | N1–N3 |
| 11 | Auto-closing bracket/quote pairs | part 2 | N5 |
| 12 | Arrow-key navigation across table rows | part 2 | N6 |

### 0.2 Files this phase touches

| File | Items |
|---|---|
| `apps/kira-studio/frontend/src/theme/primitives/Checkbox.vue` *(new)* | 5 |
| `theme/primitives.css` | 5 (`.p-check`) |
| `theme/primitives/TextField.vue` | — (read only; F4 is a call-site fix, not a primitive change) |
| `views/httprequest/FieldRowsTable.vue` | 4, 5 |
| `views/httprequest/FormDataTable.vue` | 4 |
| `views/grpcrequest/MetadataTable.vue` | 4, 5 |
| `views/httprequest/ResponsePane.vue` | 1, 2 |
| `views/httprequest/RequestBodyPane.vue` | 6 |
| `views/httprequest/ResponseHistoryList.vue` | 5 |
| `views/httprequest/HttpRequestView.vue` | 6 (badge label), 9 |
| `packages/api-core/src/http/body.ts` | 6, 8 |
| `packages/api-core/src/index.ts` | 6, 8 (exports) |
| `packages/shared/domain/http.ts` | 6 (a comment only — see D6) |
| `workbench/panels/TabStrip.vue` | 8 |
| `state/tabKinds.ts` | 8 |
| `workbench/TitleBar.vue` | 3 |
| `workbench/SettingsDialog.vue`, `views/grid/ColumnsMenu.vue`, `views/documents/ProjectionMenu.vue`, `views/stream/StreamView.vue`, `project/FiltersDialog.vue`, `project/ConnectionDialog.vue`, `api/VariableRow.vue` | 5 (Studio + Api checkbox call sites) |
| `apps/kira-studio/tests/ui/*.spec.ts` | §4's list |

### 0.3 Why this is split, and why *here*

Three reasons, in order of weight:

1. **The two halves fail differently.** Everything in part 1 is verifiable by reading the rendered
   markup and the token scale: a rule is present or absent, a slot holds a control or does not.
   Everything in part 2 is *interaction* — a caret position, a key that must not be swallowed by
   two handlers at once, a decoration range that must stay inside the document it decorates. A
   review that reads both at once reads them at the wrong altitude for one of them.
2. **Part 2 has a foundation commit that part 1 does not need** (N1: template spans grow offsets,
   and one shared reference classifier lands in `@kira/api-core`). Sequencing part 1 behind it
   would hold eight one-file fixes behind a package change they have nothing to do with.
3. **Part 1 touches Studio; part 2 does not.** D5's Checkbox rewrites nine Studio call sites and
   M9 restyles the title bar — the two places in this whole batch where a regression lands outside
   the Api module, and the reason `tests/ui`'s Studio specs are part of §4. Part 2's blast radius
   is the Api request builder plus two shared editor seams that stay backwards-compatible by
   construction. Keeping the Studio-touching work in its own phase means one review pass carries
   the Studio risk instead of two.

**Not split by size.** Part 1 is the larger diff. It is split by kind.

### 0.4 Out of scope, explicitly

- **Any storage/wire change.** D6 promotes JSON in the UI only; `HttpBodyMode`, `HttpBodyModeWire`,
  Go's `httpclient.BodyMode` and `internal/postman`'s translation table are all untouched. §5 gives
  the full argument, including what a real storage-level promotion would cost.
- **Go, the bindings, `packages/shared`'s schemas.** The one `packages/shared/domain/http.ts` edit
  is a comment (D6) that keeps the P2-legacy-alias breadcrumb honest.
- **`docs/design/kira-design-system/parts/**`.** P13 OQ-5 already records that the Api module has
  no artboard there and that drawing one is its own piece of work. D5's Checkbox is implemented
  *from* `parts/_dlgcss.html:21-23`'s existing `.box`/`.box.on` spec — it consumes that canvas, it
  does not extend it.
- **A per-mode left-panel width, a gRPC compare, TLS error classification** — P13 §5 declined each
  and nothing here revisits them.
- **The gRPC request view's own layout.** It appears twice below (F4's `MetadataTable`, D5's
  checkbox) because it holds a literal copy of a file being fixed. Nothing else about it changes.

---

## 1. Findings

Every finding was read at `a4c8e4d`. Two of the eight items turn out to be **partly wrong as
reported** (F2, F1) — both are recorded as what the code actually does, then as what the residual
friction really is, rather than restated as the user framed them.

### F1 — The response pane *is* mounted from tab-open; what appears only after a send is its **chrome**

`HttpRequestView.vue:332-351` renders the split unconditionally: `.request-pane`,
`PanelSplitter`, then `.response-pane-slot` holding `<ResponsePane :tab="tab" />`. Nothing gates
that slot on a response. `ResponsePane.vue:288` renders `<EmptyState icon="arrow-right" label="Send
a request to see the response" />` for an idle tab, and `.p-empty` (`primitives.css:806-815`) is
`flex: 1` and centred — so a freshly opened tab does show *something* in the lower half.

What is genuinely absent until a first send is everything that makes that half read as a *panel*:

- **`ResponsePane.vue:184`**: `<template v-if="response || hasHistory || hasFailureTimeline">`
  wraps the status row **and the five-segment pane switcher** (`:211-216`,
  `RESPONSE_PANE_OPTIONS` at `:74-83`: Body · Headers · History · Raw · Timeline). Before the first
  send there is no Body/Headers/History/Raw/Timeline control on screen at all, so the response
  half has no visible structure, no border, no affordance — one centred grey sentence in an
  unlabelled region.
- The same sentence renders in three different branches for three different reasons
  (`:259`, `:274`, `:288`), which is why the state reads as "nothing here yet" rather than as
  "this is the response panel, and it is empty."

So the user's report is right about the experience and wrong about the mechanism: the panel is
mounted, its chrome is not. That distinction decides the fix (D1 unhides the chrome; it does not
mount anything new), and it is why this is a five-line template change rather than a layout
rework.

### F2 — The status-code hint is already inline; it is 10 px, dim, and truncatable to nothing

`ResponsePane.vue:190`:

```html
<span class="p-xs muted status-hint" v-tooltip="hint" data-testid="http-status-hint">{{ hint }}</span>
```

with `:135-138`'s own comment already claiming the win: *"D11: the hint is always shown inline, not
tooltip-only — the case that matters (4xx/5xx) is exactly the case where the user should not have
to discover a hover."* `packages/shared/domain/http.ts:342-381` (`STATUS_HINTS` + `statusHint`)
supplies the sentence. So "requires a hover" is not literally true today.

Three things make it *effectively* true, all visible in the same six lines:

1. **`.status-hint` (`:306-311`) is `white-space: nowrap; overflow: hidden; text-overflow:
   ellipsis; min-width: 0`.** `min-width: 0` removes the flex default that would otherwise stop a
   flex item shrinking below its content, so this span is the *first* thing in the status row to
   collapse. The row also carries the status chip, `p-push`, the elapsed-ms button, the byte count,
   the Pretty/Raw toggle and the five-segment pane switcher (`:185-217`) — at a narrow window, or
   with the collections panel open, the sentence ellipses away and the tooltip is all that is left.
   That is precisely "you have to hover".
2. **`p-xs` is 10 px and `muted` is `--kira-fg-muted`** (`tokens.css:110`, `:8`) — the smallest step
   on the type scale, one step below the elapsed/bytes captions beside it. It reads as decoration.
3. **`v-tooltip="hint"` duplicates the same string** onto the same element, which is what a
   truncating caption needs and also what teaches the reader the text is hover-material.

The honest fix is not "show it inline" (it is) — it is "give it a line it cannot lose". D2.

### F3 — One root cause explains items 4 and 9: `.p-input` is `inline-flex`, and `TextField` never forwards a width

`primitives.css:128-140`:

```css
.p-input {
  height: var(--kira-h-sm);
  display: inline-flex;
  ...
}
```

`inline-flex` shrink-to-fits. Its only flexible child is the real `<input>` (`:158-166`,
`flex: 1; min-width: 0`), and an `<input>`'s intrinsic width comes from its `size` attribute —
default 20 — not from its container. So a `.p-input` is ~20 characters wide **wherever it is
placed**, unless a call site explicitly gives it a width.

`TextField.vue:9` is `inheritAttrs: false`, and `:70` spreads `v-bind="$attrs"` onto the inner
`<input>`. In Vue 3, `$attrs` includes `class` and `style` when `inheritAttrs` is off, so a
`class`/`style` written on the `<TextField>` tag lands on the **inner input**, never on the
`.p-input` box that CSS actually sizes. `FilterToolbar.vue:176-180` and `SearchToolbar.vue:350-353`
both already document this in comments, and the app has one established idiom for it — a wrapper
element carrying the width plus `:deep(.p-input) { width: 100% }`. It appears at **ten** call sites:
`OperationsPanel.vue:289`, `SettingsDialog.vue:720`, `SearchToolbar.vue:359`,
`PagerControls.vue:113`, `DateTimePicker.vue:422`, `TimestampPane.vue:177`, `BrowseView.vue:294`,
`FilterToolbar.vue:190`/`:199`, `StreamView.vue:1049`/`:1069`, `StreamSearchToolbar.vue:151`,
`DocumentView.vue:888`/`:901`, `PanelSearchBox.vue:54`, `FiltersDialog.vue:402`,
`ConnectionDialog.vue:870`/`:919`.

The four request tables and the URL field are the call sites that **do not** have it:

- **`FieldRowsTable.vue:121-124`** — `.field-cell { flex: 1; min-width: 0 }` stretches the *cell*,
  and the `.p-input` inside it stays ~20 characters. This one component backs **all four** row
  tables: Params (`QueryParamsTable.vue:29-37`), Headers (`RequestHeadersTable.vue:21-30`),
  x-www-form-urlencoded (`UrlEncodedTable.vue`) and form-data (`FormDataTable.vue:68-129`), so one
  missing rule is four reported tables.
- **`FormDataTable.vue:135-138`** repeats `.field-cell` verbatim for its slotted cells (with a
  comment explaining why: Vue scopes slotted content to the *passing* component).
- **`MetadataTable.vue:100-103`** — gRPC's own copy of the same shape (`:9-12` says why it is a
  copy), same missing rule.
- **`HttpRequestView.vue:278-285`** — the URL field is written as
  `<TextField … style="flex: 1" data-testid="http-url" />`. By the mechanism above that
  `flex: 1` lands on the inner `<input>`, which already has `flex: 1` from `primitives.css:165`,
  and the `.p-input` in the toolbar row keeps `flex: 0 1 auto` with a ~20-character basis. **The
  URL field has never grown with the window.** That is item 9's "the URL field should get much more
  width", and it is a bug rather than a layout preference.

This is the finding the SPEC row warned against guessing at (*"don't just guess 'add width:100%'
without finding the real cause, since a wrong guess could break column proportions"*): the fix is
not on the columns at all, and the column proportions (`flex: 1` per cell, fixed-width checkbox and
remove button) are already correct — they are just proportions of a box the field declines to fill.

### F4 — Fourteen raw checkboxes, three different treatments, none of them the design system's

`grep -rn 'type="checkbox"' apps/kira-studio/frontend/src` at the base commit returns 14 hits in 9
files:

| Call site | Contract | Extras |
|---|---|---|
| `SettingsDialog.vue:408-413`, `:432-437` | `:checked` + `@change` | inside `<label class="field checkbox">`, helper text |
| `ResponseHistoryList.vue:117-125` | `:checked` + `@change` | `:disabled`, **`@click.stop`** (row is itself clickable) |
| `FieldRowsTable.vue:61-68` | `:checked` + `@change` | `:disabled` on the trailing blank row |
| `MetadataTable.vue:50-56` | `:checked` + `@change` | `:disabled` |
| `ColumnsMenu.vue:136-143` | `:checked` + `@change` | `:disabled`, **`v-tooltip`**, inside `<label>` |
| `StreamView.vue:709-713` | `:checked` + `@change` | inside `<label>` |
| `ProjectionMenu.vue:66-71` | `:checked` + `@change` | inside `<label>` |
| `VariableRow.vue:150-156` | `:checked` + `@change` | `:disabled`, inside a `v-tooltip`'d `<label>` |
| `FiltersDialog.vue:173-177` | `:checked` + `@change` | inside `<label>` |
| `FiltersDialog.vue:222-228` | `:checked` + `@change` | `:disabled`, **`:indeterminate.prop`** — the only indeterminate checkbox in the app |
| `ConnectionDialog.vue:672`, `:678`, `:735-739` | **`v-model`** | inside `<label class="field checkbox">` |

Styling, at the same commit:

- `SettingsDialog.vue:709-713` and `FiltersDialog.vue:331-338` give theirs
  `width/height: 14px; accent-color: var(--kira-accent); cursor: pointer` — five of the fourteen.
- The other nine are **entirely unstyled**: Chromium's native checkbox, at the platform default
  size and colour, including every checkbox in the Api module.
- `theme/primitives.css` and `theme/base.css` contain **no** checkbox rule at all
  (`grep -n "checkbox\|accent-color" theme/*.css` → nothing).

And the design system already specifies one, unused by any of them —
`docs/design/kira-design-system/parts/_dlgcss.html:21-23`:

```css
/* one checkbox object, used by the connection dialog and the tree filters alike */
.box { width: 14px; height: 14px; margin-top: 2px; border-radius: 3px;
       border: var(--bw) solid var(--border-strong); background: var(--bg-input);
       flex-shrink: 0; display: flex; align-items: center; justify-content: center;
       color: var(--accent-fg); }
.box.on { background: var(--accent); border-color: var(--accent); }
```

Two Playwright constraints on any replacement, both real at the base commit:
`http-history.spec.ts:360-361` calls `.check()` on `[data-testid="http-history-checkbox"]`, and
`tooltips.spec.ts:159` selects `.columns-menu-item.is-pk input[type="checkbox"]`. Both require a
**real `<input type="checkbox">` element** to still exist in the DOM (Playwright's `check()` accepts
an `input[type=checkbox]`, an `input[type=radio]`, or `[role=checkbox]`; the tooltip spec's selector
accepts nothing else at all).

### F5 — JSON is a sub-language of `code`, and the mode vocabulary is pinned in four places

`packages/shared/domain/http.ts:207-215`:

```ts
export const HTTP_BODY_MODES = ['none','raw','code','urlencoded','formdata','file'] as const;
export const CODE_LANGUAGES = ['javascript','json','html','xml'] as const;
```

The selector is `BODY_MODE_OPTIONS` (`packages/api-core/src/http/body.ts:12-49`) rendered through
`SegmentedControl` (`RequestBodyPane.vue:85-90`), with a second `<select>` for `codeLanguage`
shown only while `bodyMode === 'code'` (`:91-101`). JSON therefore costs two controls and one
piece of knowledge ("JSON lives under Code") to reach, and `codeLanguage`'s own default is already
`'json'` (`http.ts:298`) — the app's own schema agrees JSON is the dominant case.

What a **storage-level** promotion would have to move, all verified:

1. `HTTP_BODY_MODES` / `httpBodyModeSchema` (`http.ts:207-209`) and `HttpBodyModeWire`
   (`:26`) — the wire vocabulary, which is *mirrored*, not re-validated (`:3-6`).
2. Go: `httpclient.BodyMode`'s consts and `validBodyModes`
   (`apps/kira-studio/internal/httpclient/body.go:19-36`) plus `buildCode`'s dispatch (`:126-130`).
3. `packages/api-core/test/go-ts-api-parity.spec.ts:54-63`, which asserts Go's `validBodyModes`
   equals `HTTP_BODY_MODES` exactly — a guard that exists precisely to catch this kind of drift.
4. `internal/postman`'s import/export translation, whose rules `http.ts:198-206` spells out as a
   breadcrumb ("a Postman `raw` body with `language: 'json'` becomes this app's `code` mode with
   `codeLanguage: 'json'`").

And one collision that is easy to miss: **`bodyMode: 'json'` is already a value with a meaning.**
`http.ts:328-335` is a `z.preprocess` that rewrites any restored tab whose `bodyMode === 'json'`
(P2's original spelling) into `{bodyMode: 'code', code: <the old body>, codeLanguage: 'json'}`.
Re-introducing `'json'` as a live mode would mean every newly-saved JSON tab is rewritten into
`code` on the next restore, silently, unless that preprocess is removed — and removing it drops
the migration path for genuinely-pre-P3 tabs, which `http-request-body.spec.ts:225-249` still
exercises. Any storage-level promotion has to deal with a value that means "old data" and "new
data" at once.

### F6 — A tab flags exactly two things today, and neither mechanism generalises

`TabStrip.vue:157-189` renders each tab as `p-tab-rail` + kind icon + title + close. Everything
comes from the tab-kind registry (`state/tabKinds.ts:66-88`): `icon(tab)`, `title(tab)`,
`railColor(tab)`. That is the entire vocabulary — an icon for the kind, a 2 px rail for the
connection colour (`undefined` for both Api kinds, `tabKinds.ts:216-219`, `:245`). There is **no**
badge, dot or indicator slot.

Two things worth being precise about, because the SPEC row's *"mirroring how a tab already flags
its other state"* over-promises:

- **P4 deliberately declined to put the dirty mark on the tab strip.** `HttpRequestView.vue:255-257`:
  *"D15: the dirty mark sits beside the name here and deliberately not on the tab strip, which
  renders purely from TAB_KINDS — a `dirty(tab)` registry member that seven of the eight kinds
  would answer false to is shared machinery for a cosmetic gain (§8 OQ-8)."* So the precedent is an
  explicit **no**, not a pattern to copy.
- **v1.1's P27 is not a tab precedent either.** `docs/v1.1/plans/P27-active-filter-indicator-color.md`
  colours the *prefix label inside a filter/sort field* (`.ph` → `.ph-active`,
  `primitives.css:167-179`) when the tab's persisted filter is genuinely applied. Same instinct
  ("make an invisible piece of state visible"), different surface. Nothing in it touches
  `TabStrip.vue`.

So item 8 needs a mechanism that does not exist, and the phase that could have built it said no
for a reason worth answering rather than ignoring. D8 answers it.

### F7 — The URL field shares its row with five controls and a growth bug

`HttpRequestView.vue:269-320` fills `ViewChrome`'s `#toolbar`: method `<select>`, URL `TextField`,
**Save** (`AppButton`, `:286-294`), copy-as-curl `IconButton` (`:295-301`), edit-raw `IconButton`
(`:302-309`), Send (`:310-319`). `ViewChrome.vue:66-92` puts its own Refresh/Stop group before that
slot and a `p-push` + `#toolbar-end` group + `RunState` after it. So the row is: refresh · stop ·
method · **url** · Save · curl · raw · Send · (push) · run-state.

Where "the request's name" actually renders: `ViewChrome.vue:49-63` → `ViewHeader.vue:42-46`'s
`.p-view-target`, fed by `:name="title"` = `httpRequestTitle(tab.state)`
(`HttpRequestView.vue:242-251`). The head is a 28 px row (`primitives.css` `.p-view-head`) with a
`#badges` slot right after the name — today carrying the method chip, the dirty dot and the
unresolved-refs chip (`:253-267`) — and a `#head-trailing` slot pushed right.

Two facts that decide D7:

- **`.p-btn` is `--kira-h-sm` (22 px)** (`primitives.css` `.p-btn`), and `.p-view-head` is 28 px —
  the same height ratio a `.p-toolbar` holds. A button fits the head without touching either.
- **No view in the app currently puts a control in the head.** `#badges`/`#head-trailing` hold
  `p-badge`/`p-chip` spans only (`DataView.vue:182-200`, `StreamView.vue:552-560`,
  `DefinitionView.vue:147`, `KeyValueView.vue:621`, `DocumentView.vue:544`,
  `GrpcRequestView.vue:228`). Moving Save there is a first, and D7 owns that as a deliberate
  departure rather than an accident.

### F8 — The mode switcher is deliberately a size *below* the app's tab scale, and its icon is dead code

`TitleBar.vue:122-130`:

```css
.mode-tab {
  --wails-draggable: none;
  /* .p-tab's own height/font-size (--kira-h-md/--kira-t-sm) are sized for the main editor tab
     strip, not a ~36px native macOS title bar … here because the title bar is shorter still. */
  height: var(--kira-h-sm);   /* 22px, down from .p-tab's 26px */
  font-size: var(--kira-t-xs); /* 10px, down from .p-tab's 11px */
}
```

`.p-tab` itself (`primitives.css`) is `height: var(--kira-h-md)` (26 px), `font-size:
var(--kira-t-sm)` (11 px), `padding: 0 var(--kira-s-3)` (6 px). `--kira-titlebar-h` is **38 px**
(`tokens.css:88`), so the two overrides shrink a 26 px control to 22 px inside a 38 px bar — 8 px of
clearance either side, spent on nothing. The comment's own premise ("a ~36px native macOS title
bar") predates the 38 px value the token settled on after the history `tokens.css:76-88` records at
length.

Also: **`MODES[mode].icon` is declared and never rendered.** `workbench/modes.ts:20-23` gives
`studio: {icon: 'database'}` and `api: {icon: 'globe'}`; the only three `MODES[...]` reads in the
app are `TitleBar.vue:30` (`.label`), `MainView.vue:9` (`.start`) and `WorkbenchShell.vue:15`
(`.panel`). The field is dead — and it is exactly what would make the two buttons read as bigger
targets rather than merely taller ones, with no new vocabulary invented.

**One standing warning applies to this finding and no other in this phase.** `tokens.css:76-88`
records three reverted attempts at guessing a title-bar height and ends: *"Do not change this again
without a real screenshot (or better, a real measurement) confirming it first."* D9 therefore
changes **no token** and moves the mode tab onto `.p-tab`'s own existing metrics rather than
inventing a size.

---

## 2. Decisions

### D1 — The response pane's chrome renders from tab-open; only the response-dependent parts stay conditional (F1, item 1)

`ResponsePane.vue`'s `v-if="response || hasHistory || hasFailureTimeline"` (`:184`) moves off the
whole block and onto only the pieces that genuinely need a response:

- **The status row (`.response-status-row`) always renders**, carrying the five-segment pane
  switcher unconditionally. Its response-only contents (status chip, hint, elapsed, bytes,
  Pretty/Raw toggle) keep their existing `<template v-if="response">` (`:186-209`) — that branch
  already exists and already has an `else` (`:210`, a bare `p-push`), so an empty row is a shape the
  component already renders today whenever a tab has history but no live response.
- **Each pane keeps its own empty state.** Body (`:274-284`), Headers (`:259`), Raw
  (`RawExchangePane.vue:166`) and Timeline (`TimelinePane.vue`, P13 D10's vocabulary) all already
  have one; `ResponseHistoryList` renders its own for an empty list. So switching to any segment
  before a first send lands on a correct empty state with no new code.
- **`:288`'s standalone `EmptyState` is deleted** — it was the "no chrome at all" branch, and there
  is no longer a state that reaches it.

Nothing new is mounted: `ensureHistoryLoaded` already runs `onMounted` for every tab (`:38-40`), and
`RESPONSE_PANE_OPTIONS` is a module constant. The change is which subtree a `v-if` wraps.

**Why not a "response panel" header band instead** (a titled band saying *Response*): the app's own
design system gives a view three rows (LAW 09) and the response half is not a view; a second header
inside it would be the fourth stacked band in the request tab. The pane switcher *is* the panel's
identity, the same way the request half's `SegmentedControl` in `#toolbar-2` is.

### D2 — The status-code hint gets its own caption line, and loses its tooltip (F2, item 2)

The hint moves out of the crowded status row onto a full-width caption line directly beneath it —
the `.body-caption` idiom `RequestBodyPane.vue:112-114` + `:160-163` already established for
"a sentence stating what the control above it will do":

```html
<div v-if="hint" class="p-sm muted status-hint" data-testid="http-status-hint">{{ hint }}</div>
```

- `p-xs` → `p-sm` (10 px → 11 px, `tokens.css:110-111`), the same step the elapsed/bytes captions
  beside it already use. Not larger than that: this is a hint, not a heading.
- **`white-space: nowrap` / `text-overflow: ellipsis` / `min-width: 0` all go away.** On its own
  full-width line the longest sentence in `STATUS_HINTS` ("the server understood the request but
  refuses to authorize it", 62 characters) fits at any pane width this app supports, and wraps
  rather than vanishes if it ever does not.
- **`v-tooltip="hint"` is removed.** A tooltip that repeats a fully visible caption is exactly the
  hover the item asks to remove, and P13's own D-list treats duplicated affordances as the thing to
  delete, not to keep as insurance.
- The `data-testid` is preserved verbatim, so `http-request.spec.ts:158`'s `toContainText`
  assertion holds unchanged.

Cost: one ~16 px row, present only when a response exists. Explicitly weighed against P13 F18's
density argument ("the timeline pane spends up to five full-width message strips per hop") — one
caption for the single most-read fact in the pane is not that.

### D3 — The four request tables adopt the app's own `:deep(.p-input)` idiom (F3, item 4)

In `FieldRowsTable.vue`, `FormDataTable.vue` and `MetadataTable.vue`, each cell wrapper gains the
second half of the idiom the other ten call sites already use:

```css
.field-cell { flex: 1; min-width: 0; }
.field-cell :deep(.p-input) { width: 100%; }   /* NEW */
```

Column proportions are untouched: the checkbox column, the remove `IconButton`, form-data's kind
`<select>`/file controls are all `flex-shrink: 0` or intrinsically sized already, and each
`.field-cell` keeps `flex: 1`. What changes is only that the field inside a cell stops being 20
characters wide inside a cell that was always the right width.

**Why not a `block` prop or a `.p-input.block` variant** (which would fix all fourteen call sites at
once): tempting, and P13 OQ-2 already flagged this exact "five local copies vs. one shared variant"
tension for `.p-select.sm`. Declined here for the reason P13 gave in reverse — a shared variant is
right once someone is allowed to migrate *all* of them, and migrating ten working Studio call sites
to prove a point is a bigger, riskier change than the four-line fix the reported bug needs. Recorded
as OQ-1 so the next phase that touches `.p-input` inherits the argument rather than rediscovering
it.

### D4 — The URL field gets the wrapper it never had, and the toolbar sheds two icons (F3, F7, item 9)

`HttpRequestView.vue`'s `style="flex: 1"` (`:281`) is deleted — it was landing on the inner
`<input>` and doing nothing — and the field is wrapped:

```html
<div class="url-field"><TextField … data-testid="http-url" /></div>
```
```css
.url-field { flex: 1; min-width: 0; }
.url-field :deep(.p-input) { width: 100%; }
```

Combined with D7 (Save leaves the row) and the two `IconButton`s moving into `ViewChrome`'s
existing `#toolbar-end` group, the row becomes: refresh · stop · method · **url (all remaining
space)** · Send · … · curl · raw · run-state. The `data-testid` stays on the real input
(`inheritAttrs: false` puts it there), so every `page.fill('[data-testid="http-url"]', …)` in
`http-curl.spec.ts`, `http-dynamic-values.spec.ts`, `collections.spec.ts` keeps working.

### D5 — `theme/primitives/Checkbox.vue`, styling the real `<input>` rather than hiding it (F4, item 5)

A new primitive beside `AppButton`/`TextField`/`SegmentedControl`, implemented from the design
system's own `.box`/`.box.on` spec (`parts/_dlgcss.html:21-23`) and promoted into `primitives.css`
as `.p-check` — the same "the design system's own stylesheet is where a shared class lives"
precedent P28 M4 (`.p-textarea`) and P13 D1/D2 (`.p-dialog-body`, `.p-kv-row`) both set.

**Shape** — the real `<input type="checkbox">` *is* the styled box:

```html
<span class="p-check" :class="{ 'is-disabled': disabled }">
  <input type="checkbox" v-bind="$attrs" :checked="modelValue" :indeterminate.prop="indeterminate"
         :disabled="disabled" @change="onChange" />
  <CodiconIcon v-if="modelValue || indeterminate" :name="indeterminate ? 'dash' : 'check'" :size="10" class="glyph" />
</span>
```

with `appearance: none` on the input, `--kira-bg-input` + `--kira-border-strong` + 3 px radius at
rest, `--kira-accent` fill + accent border when on, and the codicon glyph absolutely positioned over
it at `pointer-events: none` in `--kira-accent-fg`.

Six properties this shape buys, each of which a hidden-input-plus-fake-box shape would cost:

1. **`.check()` and `input[type="checkbox"]` selectors keep working** — F4's two Playwright
   constraints, satisfied by construction rather than by a `role="checkbox"` retrofit.
2. **`data-testid`, `:disabled`, `@click.stop` and every other attribute land on the input**, via
   `inheritAttrs: false` + `v-bind="$attrs"` — `TextField.vue:6-9`'s exact, already-documented
   technique, for the same reason.
3. **Keyboard and focus are native**: Space toggles, Tab reaches it, `:focus-visible` styles it. No
   `tabindex`, no `@keydown`, no ARIA to keep in sync.
4. **`<label>`-wrapping keeps working** at the nine call sites that use it — a native input inside a
   label is still click-target-forwarded by the browser.
5. **`:indeterminate.prop`** (`FiltersDialog.vue:225`, the app's only indeterminate checkbox) stays a
   real DOM property; the primitive takes it as an `indeterminate?: boolean` prop and forwards it,
   and the glyph switches to `dash`.
6. **The codicon comes from `CodiconIcon.vue`**, not a CSS `content:` codepoint — P13 OQ-4 records
   that reaching into the icon font from CSS has no precedent in this repo, and this primitive is
   not the place to set one.

**Contract**: `modelValue: boolean` + `update:modelValue`, so both existing shapes migrate
mechanically — `v-model` (`ConnectionDialog.vue`'s three) stays `v-model`, and `:checked` +
`@change` becomes `:model-value` + `@update:model-value`. `disabled` and `indeterminate` are real
props (not just attrs) because both drive the *visual* state, not only the DOM.

**Migration is one-for-one and visual-only.** Five call sites lose a local `width/height/accent-color`
rule (`SettingsDialog.vue:709-713`, `FiltersDialog.vue:331-338`); nine gain a look they never had.
No behaviour changes anywhere — same events, same disabled semantics, same label wrapping.

### D6 — JSON becomes a top-level segment over unchanged storage (F5, item 6)

`RequestBodyPane.vue` gains a **UI-level** selection type, and nothing below it moves:

```ts
type BodySelection = HttpBodyMode | 'json';
const selection = computed<BodySelection>(() =>
  tab.state.bodyMode === 'code' && tab.state.codeLanguage === 'json' ? 'json' : tab.state.bodyMode);
```

- Choosing **JSON** patches `{ bodyMode: 'code', codeLanguage: 'json' }`.
- Choosing **Code** patches `{ bodyMode: 'code', codeLanguage: 'javascript' }` when the current
  language is `json` — otherwise the derived `selection` above would snap straight back to JSON and
  the segment would be unclickable.
- `CODE_LANGUAGE_OPTIONS` (`body.ts:53-58`) drops `json` from the Code mode's `<select>`; the
  select itself now shows for `bodyMode === 'code' && codeLanguage !== 'json'`.
- `BODY_MODE_OPTIONS` (`body.ts:12-49`) gains a `json` entry between `raw` and `code`
  (`{value:'json', label:'JSON', title:'A JSON body', testid:'http-body-mode-json'}`) and Code's
  title drops JSON from its list. `SegmentedControl` is generic over `T extends string`
  (`SegmentedControl.vue:1-14`), so the widened union types cleanly with no primitive change.
- **Beautify keeps working unchanged** — `beautifyFormat` (`RequestBodyPane.vue:50-54`) keys off
  `codeLanguage`, which is still `'json'`.
- `contentTypeCaption` / `defaultContentTypeFor` (`body.ts:87-116`) are untouched: mode `code` +
  language `json` still resolves `application/json` through the same table Go mirrors.
- `bodyBadgeLabel` (`body.ts:120-139`) learns one case — `code` + `json` → `Body (JSON)`, other
  `code` languages keep `Body (code)` — so the request-pane segment names what is actually there.

**Why not the storage-level promotion**, restated as a decision rather than a dodge: F5 lists four
places the vocabulary is pinned (TS schema, Go consts, the Go↔TS parity test, Postman translation)
plus a real data migration for `api_items` rows and restored tabs, plus the `'json'`-means-legacy
collision in `http.ts:328-335`. All of that buys **zero** user-visible difference from the change
above — the segmented control looks and behaves identically either way. When the entire delta is
internal representation and the entire cost is migration risk across two languages, the honest call
is the UI-level promotion. `http.ts:190-206`'s breadcrumb comment gains two sentences recording that
`code` + `codeLanguage: 'json'` is now *presented* as a top-level mode, so the next reader of that
comment is not surprised by a JSON segment that is not in `HTTP_BODY_MODES`.

**The one honest wart**: JSON and Code share the single `state.code` buffer, so switching
JSON → Code(JavaScript) carries the text across. That is exactly what switching `codeLanguage`
does today (`http.ts:288-290`: buffers are per *mode*, languages share one), so this introduces no
new behaviour — it makes an existing one reachable one click sooner. Named rather than hidden.

### D7 — Save moves into the view head, beside the name (F7, item 9)

`HttpRequestView.vue`'s Save `AppButton` (`:286-294`) moves from `#toolbar` into `#badges`, after
the method chip / dirty mark / unresolved chip that already sit beside the name. No change to
`ViewChrome.vue` or `ViewHeader.vue`: `#badges` renders inside `.p-view-head` immediately after
`.p-view-target` (`ViewHeader.vue:42-47`), which is literally "next to the request's name", and
`.p-btn`'s 22 px fits the 28 px head (F7).

The button keeps its `data-testid="http-save"`, its `:disabled="canSave && !dirty"` and its
tooltip, so `collections.spec.ts:168-174`'s enable/disable/click sequence is unaffected by the move.

**Api-specific by choice, not by limitation.** `ViewChrome` is shared by every view, but this puts
nothing new *in* `ViewChrome` — only in the slot content Api's own view passes. Studio views render
exactly what they rendered before. Whether an editor's primary action *belongs* in the head is a
design-system question (LAW 09 says the head "names the target"), and OQ-2 records it as one rather
than pretending the departure is invisible.

### D8 — A tab-kind `badge()` member, answered by one kind (F6, item 8)

`TabKindDef` (`state/tabKinds.ts:66-88`) gains one optional member:

```ts
/** A small state mark after the tab's title — null for a kind with nothing to flag. */
badge?(tab: TabRecord): { icon: string; tooltip: string } | null;
```

`'http-request'` answers `{icon: 'symbol-namespace', tooltip: 'This request has a body'}` when
`hasRequestBody(tab.state)` — a new pure predicate in `packages/api-core/src/http/body.ts` beside
`bodyBadgeLabel`, which already encodes "what counts as a body" per mode
(`raw`/`code` → non-empty buffer; `urlencoded`/`formdata` → at least one enabled, named row;
`file` → a chosen file; `none` → false). Every other kind omits the member, and `TabStrip.vue`
renders `<CodiconIcon v-if="badge" …>` between `.tab-title` and `.tab-close`.

**This is the thing P4 D15 declined, so here is the answer to it.** P4's objection was that a
`dirty(tab)` member is *shared machinery seven kinds would answer false to, for a cosmetic gain*.
Two things differ now: (a) the member is **optional**, so seven kinds answer nothing rather than
`false` — no registry entry grows a line; and (b) the gain is not cosmetic. The dirty mark it
declined has a live equivalent on screen whenever the tab is active (the `•` in the view head); a
body-present mark answers a question about a tab you are *not* looking at, which is the only kind of
question a tab strip exists to answer. The registry is exactly where the answer belongs, because
`TabStrip.vue:22-34`'s whole design is "the strip knows nothing about any kind".

**gRPC is deliberately left out.** A gRPC call always has a message body, so the mark would be on
every `grpc-request` tab always, which is not information. Recorded in OQ-3 rather than silently
skipped.

### D9 — The mode switcher takes `.p-tab`'s own metrics, plus the icon `modes.ts` already declares (F8, item 3)

`TitleBar.vue`:

- **Delete both overrides** (`:128-129`): `.mode-tab` stops shrinking `.p-tab` to 22 px/10 px and
  renders at the app's own tab scale — `--kira-h-md` (26 px) and `--kira-t-sm` (11 px). 26 px inside
  a 38 px bar leaves 6 px of clearance, the same `--kira-s-3` the bar already uses as its right
  padding.
- **Widen the target**: `padding: 0 var(--kira-s-5)` (12 px, up from `.p-tab`'s 6 px) and
  `gap: var(--kira-s-2)`.
- **Render the icon**: `<CodiconIcon :name="MODES[mode].icon" :size="13" />` before the label —
  `modes.ts:20-23` has declared `database`/`globe` since P1 with no reader (F8), and 13 px is the
  size every other icon in a tab uses (`TabStrip.vue:178`).
- `--wails-draggable: none` and the `:hover` rule (`:135-137`) stay exactly as they are; both are
  load-bearing (`:119-121`, `:131-134`).

**No token changes, no new size.** `tokens.css:76-88`'s warning is about guessing title-bar
*heights*; this changes none, and every value used is one the app already renders elsewhere. If the
user wants bigger still after seeing it, `--kira-h-lg` (30 px) is the next existing step and still
clears 38 px — OQ-4.

---

## 3. Commit sequence

Shared theme work first (it is what the rest consumes), then the Api surfaces, then workbench
chrome. Per `AGENTS.md`: `bun run lint`, `bun run typecheck` and `bun run build` per commit;
`tests/ui` runs **once** at the end (§4), with fixes as follow-up commits.

| # | Commit | Item | Touches | Risk |
|---|---|---|---|---|
| M1 | `feat(theme): a Checkbox primitive, from the design system's own checkbox object` | 5 | new `theme/primitives/Checkbox.vue`, `theme/primitives.css` (`.p-check`) | low — nothing consumes it yet |
| M2 | `refactor(theme): every checkbox in the app is the Checkbox primitive` | 5 | the 9 files / 14 call sites in F4 | **highest in this phase** — the only commit touching Studio behaviour-adjacent markup; `tests/ui`'s tooltip/history/filters specs are the guard |
| M3 | `fix(api): the request tables' fields fill the cells they sit in` | 4 | `FieldRowsTable.vue`, `FormDataTable.vue`, `views/grpcrequest/MetadataTable.vue` | trivial — 6 lines of CSS |
| M4 | `fix(api): the response panel is a panel from the moment a tab opens` | 1 | `ResponsePane.vue` | low — one `v-if` moves, one dead `EmptyState` goes |
| M5 | `fix(api): a status code's meaning gets its own line, and loses its tooltip` | 2 | `ResponsePane.vue` | trivial; must follow M4 (same block) |
| M6 | `feat(api): JSON is a top-level body mode` | 6 | `packages/api-core/src/http/body.ts`, `RequestBodyPane.vue`, `packages/shared/domain/http.ts` (comment), `HttpRequestView.vue` (badge label) | medium — the one commit a restored-tab spec asserts against (§4) |
| M7 | `feat(api): Save sits with the request's name; the URL field takes the toolbar` | 9 | `HttpRequestView.vue` | low |
| M8 | `feat(workbench): a request tab shows when it carries a body` | 8 | `state/tabKinds.ts`, `workbench/panels/TabStrip.vue`, `packages/api-core/src/http/body.ts` (+ `index.ts` export) | low; must follow M6 (same file) |
| M9 | `style(workbench): the mode switcher is a real target, with the icon modes.ts already declares` | 3 | `workbench/TitleBar.vue` | low — Studio-visible, screenshot-adjacent |
| M10 | `test(p15): the specs §4 enumerates` | — | `apps/kira-studio/tests/ui/*.spec.ts` | low |

**Ordering that matters**: M2 after M1; M5 after M4; M8 after M6. Everything else is order-free.

---

## 4. Verification plan

**Per commit**: `bun run lint` (biome + `scripts/check-tokens.sh` — D5's `.p-check` uses only
existing tokens, so this stays green), `bun run typecheck` (four projects: tests, web, unit,
api-core), `bun run build`. No Go, no bindings regeneration — nothing in this phase touches a
bridge method's signature.

**`bun run test:unit`** after M6 and M8: `packages/api-core/test/go-ts-api-parity.spec.ts:54-63`
asserts Go's `validBodyModes` equals `HTTP_BODY_MODES` exactly. D6 changes neither, so this test
passing **unchanged** is the proof that the JSON promotion really is UI-level.

**`tests/ui`, once at the end.** The specs that must change:

| Spec | Why |
|---|---|
| `http-request-body.spec.ts:225-249` | the pre-P3 legacy-alias restore now selects the **JSON** segment, and there is no `http-body-code-language` select to assert on — rewrite as `expect(locator('[data-testid="http-body-mode-json"]')).toHaveClass(/on/)` plus `expect(locator('[data-testid="http-body-code-language"]')).toHaveCount(0)`; the editor-content assertion (`:242`) is unchanged, which is the point of the rewrite (same stored state, new presentation) |
| `http-request-body.spec.ts:69-70`, `:189-190` | `selectOption(…, 'xml')`/`'javascript'` still work (both stay in `CODE_LANGUAGE_OPTIONS`); confirm, don't rewrite |
| `http-history.spec.ts:356-361` | `.check()` on `http-history-checkbox` — must still pass **without edit** after M2. If it does not, D5's shape is wrong, not the spec |
| `tooltips.spec.ts:156-160` | `.columns-menu-item.is-pk input[type="checkbox"]` + its tooltip — same "must pass unedited" guard for the `v-tooltip`-carrying call site |
| `http-request.spec.ts:158` | `http-status-hint` moves element but keeps its testid and text — confirm |
| `collections.spec.ts:168-174` | `http-save` moves from the toolbar into the view head — same testid, same enabled/disabled logic; confirm |
| `settings-apply-on-save.spec.ts`, `connection-dialog-tabs.spec.ts`, `tree.spec.ts`, `workbench.spec.ts`, `tabs.spec.ts`, `mode-switch.spec.ts` | **the Studio regression guard for M2 and M9** — these are the specs that would notice a checkbox that stopped toggling or a mode tab that stopped switching |

**New coverage, in the Api-only file P13 already created** (`api-ui-consistency.spec.ts`, kept
Api-only per the SPEC's module-boundary rule — *"a single test file covering both is not"*):

1. a freshly opened request tab renders `[data-testid="http-response-pane-toggle"]` **before any
   send** (D1, asserted as a presence so a future refactor cannot quietly re-hide it);
2. clicking `http-response-pane-headers` on that never-sent tab shows the headers empty state
   rather than throwing (D1's "each pane owns its own empty state");
3. the body-mode segmented control renders a `http-body-mode-json` segment, and selecting it leaves
   `Body (JSON)` on the request-pane segment (D6 end to end, without asserting storage);
4. an `http-request` tab with a non-empty body renders a badge in the tab strip and one with
   `bodyMode: 'none'` does not (D8).

**Not run, and named rather than glossed:**

- **A real macOS render of the title bar (M9).** Every measurement in D9 is arithmetic over
  `tokens.css` (26 px in 38 px), and D9 changes no token precisely because `tokens.css:76-88` says a
  plausible-sounding figure has been wrong here twice. If M9 reads wrong on real hardware, the fix
  is `--kira-h-lg` on `.mode-tab` (OQ-4), not a token edit.
- **A pixel diff of the fourteen checkboxes.** No such harness exists in this repo (P13 §7 said the
  same). Nine of them currently render as unstyled platform defaults, so "different" is the
  intended outcome; the guard is that they still *toggle*, which the specs above cover.

---

## 5. The polish/feature line

The SPEC row calls this a polish pass driven by user reports, which makes the line worth drawing as
explicitly as P13 §5 drew its own.

**In scope — an affordance for behaviour that already ships:** D1 (the pane switcher exists; it was
hidden), D2 (the sentence exists; it was truncatable), D3/D4 (the fields exist; they were not
filling their boxes), D7 (Save exists; it moves), D9 (the icon exists in `modes.ts`; it was never
rendered).

**In scope, and genuinely new, because the SPEC row asks for it by name:** D5's `Checkbox.vue` (a
new shared primitive — the line P13 §0.2 held, crossed deliberately, see the header) and D8's
`badge()` registry member (new machinery, answering P4 D15's explicit refusal — see D8).

**Out of scope — flagged, not fixed:**

1. **A body-present badge for gRPC tabs** — always true, therefore not information (D8, OQ-3).
2. **Migrating the ten existing `:deep(.p-input)` call sites onto a shared `.p-input.block`** —
   right eventually, not while fixing four (D3, OQ-1).
3. **Anything about the response *body* renderer, history, raw or timeline panes** — P13 restyled
   all four and this phase reads them only to confirm each has an empty state (D1).
4. **Making the request name editable in the head.** D7 puts Save beside a name that is still
   `httpRequestTitle`-derived display text. Inline rename is a feature; Save-as… already covers
   naming.

---

## 6. What this phase deliberately does not do

- **Does not change a value in `tokens.css`** — every fix moves a call site onto an existing token.
- **Does not change any schema, wire type, Go constant or bindings.** D6 is the one item that
  looked like it would, and §5/D6 record why it does not.
- **Does not touch `AutocompleteField.vue`, `CodeMirrorHost.vue`, `completion.ts`,
  `theme/wrapSelection.ts` or `editor/wrapSelection.ts`** — those five files are part 2's whole
  subject, and splitting edits to them across two phases is how a merge conflict becomes a
  behaviour regression.
- **Does not restyle Studio beyond the two places it must**: nine checkbox call sites (M2, which
  gains them the design system's look for the first time) and the title bar's mode tabs (M9). No
  other Studio surface changes.
- **Does not remove an affordance.** D2 deletes a tooltip whose text is fully visible one line
  below it; D1 deletes an `EmptyState` branch that becomes unreachable. Nothing else goes.
- **Does not draw an Api artboard** in `docs/design/kira-design-system/` — P13 OQ-5 still stands.

---

## 7. Open questions

**OQ-1 — `:deep(.p-input) { width: 100% }` at fourteen call sites, or a `.p-input.block` variant?**
D3 takes the fourteenth copy of the existing idiom rather than introducing a variant mid-phase, on
P13 OQ-2's own reasoning. The counter-argument is that fourteen copies of a two-line workaround for
`display: inline-flex` is the definition of a missing primitive, and that the *right* fix might be
`.p-input { display: flex; width: 100% }` with the handful of genuinely-intrinsic call sites opting
out. That is a change to every input in the app and wants its own phase and its own screenshot pass.
**P16's own row is where it belongs** — its cross-cutting half is *"inline text inputs' crowding/
padding and muted text contrast fixed at the design-system level, since both read as inconsistent
app-wide rather than confined to one surface"*, which is this exact file and this exact argument.
D3 deliberately leaves `.p-input`'s own rules untouched so that phase inherits a clean one.

**OQ-2 — is a button allowed in the view head?** D7 puts the first one there. LAW 09 says the head
"names the target", and F7 confirms no view does this today. The alternative that keeps the head
pure is Save at the *far left of the toolbar*, immediately after Refresh/Stop — which still frees
the URL field's width but does not put Save "with the name" as asked. Taken as asked; reversible in
one slot name.

**OQ-3 — should the body badge extend to gRPC tabs?** D8 says no (always true → no information). If
a later phase gives `grpc-request` tabs a genuinely varying piece of state (a selected method, a
streaming call in flight), `badge()` is already the seam for it.

**OQ-4 — 26 px mode tabs, or 30 px?** D9 lands on `.p-tab`'s own `--kira-h-md`, deliberately
choosing the app's existing tab metric over a bespoke title-bar size. `--kira-h-lg` (30 px) is the
next existing step and still clears the 38 px bar. "Bigger" is a judgement about a bar this
environment cannot screenshot, so the smaller of the two defensible steps is the one that ships
first.

**OQ-5 — does the `JSON` segment want its own Beautify affordance?** Today Beautify is an
`IconButton` that appears for `code` + json/xml (`RequestBodyPane.vue:103-109`), and it keeps
working unchanged under D6. Arguably a top-level JSON mode should surface formatting more
prominently than a 22 px icon on the right of the mode row. Not changed here — it would be a new
affordance in a phase whose other seven items are fixes.

---

## Checklist

Every item is either checked off against a commit or explicitly deferred to part 2 — nothing in the
SPEC row is left unaccounted for.

- [ ] **M1** `Checkbox.vue` + `.p-check` in `primitives.css`, from `parts/_dlgcss.html`'s `.box`
      spec; real `<input>` retained; `indeterminate`, `disabled`, `$attrs` forwarding, codicon glyph
      *(item 5a)*
- [ ] **M2** all 14 raw checkboxes replaced (9 files: `SettingsDialog`, `ResponseHistoryList`,
      `FieldRowsTable`, `MetadataTable`, `ColumnsMenu`, `StreamView`, `ProjectionMenu`,
      `VariableRow`, `FiltersDialog`, `ConnectionDialog`); five local `accent-color` rules deleted
      *(item 5b)*
- [ ] **M3** `:deep(.p-input) { width: 100% }` in `FieldRowsTable`, `FormDataTable`, `MetadataTable`
      — all four request tables plus gRPC metadata *(item 4)*
- [ ] **M4** `ResponsePane`'s status row + pane switcher render from tab-open; dead `EmptyState`
      branch removed *(item 1)*
- [ ] **M5** status hint on its own `p-sm` caption line, no ellipsis, no tooltip, same testid
      *(item 2)*
- [ ] **M6** `json` segment in `BODY_MODE_OPTIONS`; `CODE_LANGUAGE_OPTIONS` drops json;
      `selection`/setter mapping in `RequestBodyPane`; `bodyBadgeLabel` says `Body (JSON)`;
      `http.ts` breadcrumb comment updated; **no** schema/Go/wire change *(item 6)*
- [ ] **M7** Save into `#badges`; URL wrapped in `.url-field`; `style="flex: 1"` deleted; curl/raw
      icons into `#toolbar-end` *(item 9)*
- [ ] **M8** optional `badge()` on `TabKindDef`, answered by `http-request` via
      `hasRequestBody()` in api-core; `TabStrip` renders it *(item 8)*
- [ ] **M9** `.mode-tab` height/font-size overrides deleted; `--kira-s-5` padding; `MODES[].icon`
      rendered *(item 3)*
- [ ] **M10** spec updates and the four new `api-ui-consistency.spec.ts` cases (§4)
- [ ] full `bun run test:ui` once, after M10; fixes land as follow-up commits
- [ ] *(items 7, 10, 11, 12 — part 2, `P15b-request-builder-editor-behavior.md`)*

---

## 8. Sources

**Read in full at `a4c8e4d`:** `views/httprequest/{HttpRequestView,ResponsePane,RequestBodyPane,
FieldRowsTable,RequestHeadersTable,QueryParamsTable,FormDataTable,ResponseHistoryList}.vue`,
`views/grpcrequest/MetadataTable.vue`, `theme/primitives/{TextField,AutocompleteField,ViewChrome,
ViewHeader,SegmentedControl,EmptyState}.vue`, `theme/{primitives.css,tokens.css,base.css,
wrapSelection.ts}`, `workbench/{TitleBar.vue,modes.ts}`, `workbench/panels/TabStrip.vue`,
`state/tabKinds.ts`, `workbench/state/tooltip.ts`, `packages/shared/domain/http.ts`,
`packages/api-core/src/http/{body,substitute,url}.ts`, `packages/api-core/src/index.ts`,
`packages/api-core/test/go-ts-api-parity.spec.ts`, `api/state/variables.ts`, `biome.json`.

**Read for a specific claim:** every file in F4's checkbox table (each checkbox and its local CSS),
`internal/httpclient/body.go:19-36` (`validBodyModes`), `docs/design/kira-design-system/README.md`
and `parts/{_dlgcss.html,_style.css}` (the `.box` spec, LAW 01/07/09/12),
`apps/kira-studio/tests/ui/{http-request,http-request-body,http-history,collections,tooltips}.spec.ts`.

**Prior plans consulted:** `docs/v1.2/plans/P13-api-ui-check.md` (structure, §5's line, OQ-2/OQ-4/
OQ-5), `docs/v1.2/plans/P12-studio-api-modularization.md` (the import boundaries `biome.json`
enforces), `docs/v1.1/plans/P27-active-filter-indicator-color.md` (F6's precedent check, citation
discipline), `docs/v1.1/plans/P28-settings-panel-overhaul.md` (the `.p-textarea` promotion D5
follows). `docs/v1.2/SPEC.md`'s P15 row and its Studio/Api module-boundary section. `AGENTS.md`'s
comment, unit-test-bar, library-first and implement-then-test-at-the-end rules drive §3 and §4.
