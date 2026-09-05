# P13 — Api module UI check and improvement

> **What this phase is.** `docs/v1.2/SPEC.md`'s P13 row: *"A dedicated pass over every Api-mode
> surface (request builder, response viewer, collections tree, dialogs, empty/error states, and so
> on) checked against the rest of the app's own design system (`docs/design/kira-design-system`,
> `primitives.css`, the shared token scale) rather than each earlier phase's own ad hoc styling —
> brought consistent with Studio mode's spacing/type/color/icon conventions, tightened for
> practical, efficient use (dense enough for a power tool, not sparse for its own sake), and any
> leftover placeholder or rough-edge styling from earlier phases cleaned up. No new functionality —
> a visual/interaction-consistency pass, not a feature phase."*
>
> **The precedent this matches.** v1.1's own UI-facing plans, read before writing this one:
> `docs/v1.1/plans/P28-settings-panel-overhaul.md` (structure, the "current implementation → design
> decision → steps" per item, the `.p-textarea` promotion that is the exact model for §3 D1/D2),
> `P27-active-filter-indicator-color.md` and `P24-connection-auth-error-display.md` (citation
> discipline: every claim carries a file:line read at the base commit), `P9-row-coloring-settings.md`
> and `P17-settings-apply-on-save.md` (decision-with-rationale format). This phase adopts their
> depth, not a new one.
>
> **Base commit.** Everything below was read against `c4dfba5`
> (*"docs(architecture): the Api module, its boundary, and what still couples it to Studio"*, branch
> `claude/feature-v1-2`) — P12's last commit. File:line citations point at that commit's content.
>
> **Eleven phases built this UI, one at a time.** P1 (shell) → P2 (request/response core) → P3
> (payload formats) → P4 (collections) → P5 (variables/environments) → P6 (Faker) → P7 (curl) → P8
> (history) → P9 (raw) → P10 (timeline) → P11 (gRPC) → P12 (rename + modularization). Each made its
> own local spacing/icon/copy calls, each defensible in isolation. This is the first pass that reads
> them side by side, and side by side is where they disagree.

---

## 0. Scope and non-scope

### 0.1 In scope — the files this phase touches

| File | Findings addressed |
|---|---|
| `apps/kira-studio/frontend/src/theme/primitives.css` | F1 (three undefined tokens), D1/D2 (two promotions) |
| `apps/kira-studio/frontend/src/api/ApiStart.vue` | F2, F13 |
| `api/CollectionsPanel.vue` | F3, F14 |
| `api/CollectionRow.vue` | F8 |
| `api/SaveRequestDialog.vue` | F5, F6, F7 |
| `api/ImportCurlDialog.vue` | F5, F6 |
| `api/CopyAsCurlDialog.vue` | F5, F6, F11 |
| `api/EditRawRequestDialog.vue` | F5, F6, F8 |
| `api/VariablesDialog.vue` | F1, F5, F7 |
| `api/VariableRow.vue` | F1, F10 |
| `api/EnvironmentsDialog.vue` | F1, F5, F9, F10, F12 |
| `api/VariableHistoryMenu.vue` | F1, F12, F15 |
| `api/DynamicValuesDialog.vue` | F5, F6, F7 |
| `views/httprequest/HttpRequestView.vue` | F4 |
| `views/httprequest/RequestBodyPane.vue` | F4 |
| `views/httprequest/FormDataTable.vue` | F4 |
| `views/httprequest/ResponsePane.vue` | F13, D2 |
| `views/httprequest/ResponseHistoryList.vue` | F15 |
| `views/httprequest/ResponseDiffDialog.vue` | F7, F11, F16, F17 |
| `views/httprequest/RawExchangePane.vue` | F8, F13 |
| `views/httprequest/TimelinePane.vue` | F1, F8, F13, F17, F18 |
| `views/grpcrequest/GrpcRequestView.vue` | F4, F19 |
| `views/grpcrequest/ResponsePane.vue` | F13, F20, F21, F22, D2 |
| `views/grpcrequest/SchemaBrowser.vue` | F1, F8, F10, F13, F23, F24 |
| `api/EnvironmentSelect.vue` | F4 |
| `frontend/src/format.ts` | F15 (one shared `formatRelative`) |
| `frontend/src/shortcuts/state.ts` | F25 (the missing palette entry) |
| `workbench/panels/StudioStart.vue`, `views/shared/celleditor/CellEditorView.vue`, `project/{FiltersDialog,SchemaDialog,ConnectionDialog}.vue`, `workbench/{SettingsDialog,UploadObjectDialog,GenerateDataDialog,ConfirmDialog}.vue` | D1/D2/F15 only — each loses a duplicated local rule or helper in favour of the promoted shared one; **no visual change to any Studio surface** |
| `apps/kira-studio/tests/ui/*.spec.ts` | the specs §7 enumerates |

### 0.2 Out of scope, explicitly

- **Any new capability.** §5 draws the line item by item and names the three things that look like
  polish but are features, with the verdict for each.
- **Restructuring the module's directories or packages.** P12 settled `api/**` +
  `views/httprequest/**` + `views/grpcrequest/**` and its own OQ-1/OQ-6 hand the further
  consolidation to a future row. Nothing here moves a file.
- **`packages/api-core` / `packages/shared`.** This phase touches renderer presentation only. No
  domain schema, no `@kira/api-core` export, no Go, no bindings regeneration.
- **Widening a shared primitive's props for one Api caller.** Every earlier Api phase held that
  line (P8 §0.2, P9 §3, P10 §3, P11 §0.2's own "no new theme/primitives/ component") and this one
  keeps it. D1/D2 *add two classes to `primitives.css`* — which is the design system's own file,
  not a component's prop surface — following P28 M4's `.p-textarea` precedent exactly.
- **Studio-side visual change.** Studio files appear in §0.1 only to delete a rule the promoted
  class now supplies, with byte-identical computed styles. If a Studio migration cannot be made
  visually inert, it is dropped from the commit rather than accepted.
- **The design-system canvas** (`docs/design/kira-design-system/parts/**`). It documents Studio's
  screens; the Api module has no artboard there and this phase does not draw one. §9 OQ-5.

---

## 1. The surface inventory — everything checked

The SPEC row says *"every Api-mode surface"*, so here is the enumeration, from
`find api views/httprequest views/grpcrequest -name '*.vue'` at the base commit (32 components).
Every row was opened and read; the right column is the verdict, not a plan.

### 1.1 Chrome and navigation

| # | Surface | File | Verdict |
|---|---|---|---|
| 1 | Api mode start page ("No request open") | `api/ApiStart.vue` | **F2** overflow + no scroll; **F13** icon |
| 2 | Collections panel header + actions | `api/CollectionsPanel.vue:104-143` | consistent with `ProjectPanel.vue` — PanelShell, four `IconButton`s, `search` toggle. OK |
| 3 | Collections panel empty state | `api/CollectionsPanel.vue:150-163` | **F3** three buttons duplicating the header; **F14** wrong icon |
| 4 | Collections tree host | `api/CollectionsTree.vue` | a clean `TreeHost` consumer, sticky-row rule identical to `ProjectTree.vue:191`. OK |
| 5 | Collection / folder / request row | `api/CollectionRow.vue` | **F8** two `border-radius: 2px`; the 8+depth×14 indent, twisty, `<mark>` tint all match `project/TreeRow.vue`. Otherwise OK |
| 6 | Collections context menus (row + background) | `api/menus.ts` | eighteen labels, ellipsis convention matches `project/menus.ts`. OK |
| 7 | Import/export report strip | `api/ImportReportStrip.vue` | `gap: 2px` → `--kira-s-1` (**F8**); raw `.p-strip` is justified in its own comment (needs `.strip-action` + dismiss). OK otherwise |
| 8 | Environment switcher | `api/EnvironmentSelect.vue` | **F4** h-md select in a 28px toolbar |
| 9 | Api tab strip icons | `state/tabKinds.ts:215-270` | `globe` / `symbol-interface`, distinct at a glance. OK |
| 10 | Command palette entries | `shortcuts/state.ts:20-50` | **F25** no *New gRPC request* (P12 F24) |

### 1.2 HTTP request builder

| # | Surface | File | Verdict |
|---|---|---|---|
| 11 | Request view chrome (header, badges, two toolbars, splitter) | `views/httprequest/HttpRequestView.vue` | **F4** method `<select>`; splitter/dirty-mark/chip usage OK |
| 12 | Query params table | `QueryParamsTable.vue` → `FieldRowsTable.vue` | OK — one shared table, `s-3`/`s-2`, `IconButton icon="close"` |
| 13 | Headers table | `RequestHeadersTable.vue` | OK (same) |
| 14 | Body mode bar + code-language select + Beautify | `RequestBodyPane.vue` | **F4** select height. `icon="expand-all"` for Beautify **matches** `EditBufferActions.vue:58` — verified, not a finding |
| 15 | urlencoded table | `UrlEncodedTable.vue` | OK |
| 16 | form-data table (text/file rows, per-part content type) | `FormDataTable.vue` | **F4** kind `<select>` inside a `.field-row` beside 22px controls |
| 17 | binary body picker | `BinaryBodyPicker.vue` | OK — `AppButton` + caption + `IconButton icon="close"`, `s-3`/`s-2` |
| 18 | Edit-as-raw dialog | `api/EditRawRequestDialog.vue` | **F5**, **F6**, **F8** |
| 19 | Import-from-curl dialog | `api/ImportCurlDialog.vue` | **F5**, **F6** |
| 20 | Copy-as-curl dialog | `api/CopyAsCurlDialog.vue` | **F5**, **F6**, **F11** |
| 21 | Save-request dialog | `api/SaveRequestDialog.vue` | **F5**, **F6**, **F7** (indent-by-spaces target list) |

### 1.3 HTTP response viewer

| # | Surface | File | Verdict |
|---|---|---|---|
| 22 | Status row (chip, hint, elapsed, bytes, pane toggles) | `ResponsePane.vue:175-207` | dense and good — the model the rest should match |
| 23 | Body pane (Pretty/Raw, binary note, empty state) | `ResponsePane.vue:253-275` | **F13** empty-state icon/copy |
| 24 | Headers pane | `ResponsePane.vue:242-250` | **D2** — third copy of the same three rules |
| 25 | History pane | `ResponseHistoryList.vue` | **F15** local `relativeTime`. Otherwise the best-shaped list in the module |
| 26 | Compare-responses dialog | `ResponseDiffDialog.vue` | **F7** no footer; **F11** raw `<details>`; **F16** `(D5)` leaks into user copy; **F17** unlabelled A/B columns |
| 27 | Raw exchange pane | `RawExchangePane.vue` | **F8** hardcoded border; **F13** a sentence as an `EmptyState` label |
| 28 | Timeline pane | `TimelinePane.vue` | **F1**, **F8**, **F11**, **F13**, **F17**, **F18** — the densest cluster in the module |

### 1.4 gRPC

| # | Surface | File | Verdict |
|---|---|---|---|
| 29 | gRPC request view chrome + method picker | `GrpcRequestView.vue` | **F4**; **F19** `view.format` registered with no visible affordance |
| 30 | Metadata table | `MetadataTable.vue` | OK — a deliberate, documented clone of `FieldRowsTable`'s geometry (its own F18 comment). Verified identical |
| 31 | Schema browser (source row, import paths, service/method list) | `SchemaBrowser.vue` | **F1**, **F8**, **F10**, **F13**, **F23**, **F24** |
| 32 | gRPC response status row | `grpcrequest/ResponsePane.vue:141-162` | OK — mirrors HTTP's |
| 33 | gRPC messages pane | `grpcrequest/ResponsePane.vue:224-245` | **F13** empty-state icon |
| 34 | gRPC metadata pane (header/trailer) | `grpcrequest/ResponsePane.vue:206-223` | **F13**, **F21** two centred empty states stacked; **D2** |
| 35 | gRPC history pane | `grpcrequest/ResponsePane.vue:179-205` | **F20** nested `<button>`; **F22** no Clear (P12 F23); **F15**; **F10** |

### 1.5 Variables and environments

| # | Surface | File | Verdict |
|---|---|---|---|
| 36 | Variables dialog (header row + rows) | `api/VariablesDialog.vue` | **F1**, **F5**, **F7** (no footer) |
| 37 | Variable row (grip, name, value, secret, history, remove) | `api/VariableRow.vue` | **F1**, **F10** |
| 38 | Variable history popover | `api/VariableHistoryMenu.vue` | **F1**, **F12**, **F15** |
| 39 | Environments dialog | `api/EnvironmentsDialog.vue` | **F1**, **F5**, **F9**, **F10**, **F12** |
| 40 | Dynamic values dialog | `api/DynamicValuesDialog.vue` | **F5**, **F6**, **F7** |

### 1.6 Error and empty states, collected

Because the SPEC row names them separately, here is every one, in one place:

**Error surfaces** — `MessageStrip tone="err"`: send error (`ResponsePane.vue:170`), call error
(`grpcrequest/ResponsePane.vue:136`), schema error (`SchemaBrowser.vue:128`), beautify error
(`RequestBodyPane.vue:116`), curl parse error (`ImportCurlDialog.vue:46`), raw parse error
(`EditRawRequestDialog.vue:68`), save error (`SaveRequestDialog.vue:93`), variables error
(`VariablesDialog.vue:223`), history load error (`grpcrequest/ResponsePane.vue:180`), diff load
error (`ResponseDiffDialog.vue:182`), timeline failure note (`TimelinePane.vue:170`). **Eleven, all
through the same primitive with the same tone. This is the module's most consistent axis** and
needs no change. The two exceptions are raw `<div class="p-strip err">` in
`CopyAsCurlDialog.vue:110` and `.p-strip` in `:89` — **F11**.

**Empty states** — sixteen `EmptyState` call sites plus three hand-rolled `.empty` divs. See **F13**
for the full table and **F12** for the hand-rolled three.

---

## 2. Findings

Every finding was read at `c4dfba5`. Nothing here is inferred from a plan doc.

### F1 — Three `--kira-*` custom properties used in Api CSS are defined nowhere in the app

`grep -rn -- '--kira-fg-dim:' frontend/src` and the same for `--kira-bg-inset` and
`--kira-font-mono` return **nothing**. `theme/tokens.css` defines `--kira-fg-muted`,
`--kira-fg-disabled`, `--kira-bg-elevated`, `--kira-bg-input`, `--kira-font-family` — not these.
The eleven declarations, all in Api code and nowhere else in the repo:

| Declaration | Sites | What actually renders |
|---|---|---|
| `color: var(--kira-fg-dim)` | `VariableHistoryMenu.vue:108,128,139`; `EnvironmentsDialog.vue:204,214`; `VariableRow.vue:197,214`; `VariablesDialog.vue:271` | Invalid at computed-value time. `color` **is inherited**, so each of these eight elements silently renders at its parent's full `--kira-fg`, not dimmed |
| `background: var(--kira-bg-inset)` | `TimelinePane.vue:339` (`.hop-track`) | `background` is **not** inherited → `initial` → `transparent`. The waterfall's track has no ground behind its bars |
| `font-family: var(--kira-font-mono)` | `SchemaBrowser.vue:246` (`.method-name`) | Inherited → the method name renders in the UI face, not the mono face it asks for |

This is the sharpest instance of exactly what the SPEC row describes: three tokens *invented by a
phase* instead of taken from the scale, which then silently do nothing. `--kira-fg-dim` in
particular is the module's own coinage for what `primitives.css:13` already calls `.dim`
(`--kira-fg-disabled`) — the intent is unmistakable, the name is not the app's.

**Nothing in `tests/ui/` catches this**: a colour that resolves to the wrong value still passes
every visibility and text assertion.

### F2 — `ApiStart.vue` overflows its own container and cannot scroll

`StudioStart.vue`'s equivalent has two guards this file dropped:

| | `StudioStart.vue` | `ApiStart.vue` |
|---|---|---|
| `.start` | `overflow: auto` (`:118`) | **absent** (`:54-61`) |
| `.start-inner` | `max-width: 100%` (`:123`) | **absent** — `width: 360px` only (`:63-70`) |
| buttons in the first-run block | **one** (`:71-74`) | **four**, `flex-direction` unset so a single non-wrapping row (`:31-48`, `.start-actions` at `:83-87`) |

Four `.p-dlgbtn`s (`primitives.css:102-115`: `padding: 0 var(--kira-s-5)` = 12px each side, plus a
16px `.icon-box` and a `--kira-s-2` gap) carrying *New request*, *New gRPC request*, *Import
collection…*, *Import from curl…* cannot fit 360px; with `flex-wrap` unset and `max-width` unset
they push the row past `.start-inner`, and with no `overflow: auto` on `.start` there is nothing to
scroll. This is visible at any window width in the middle pane, not just a narrow one.

The design system's own note is the other half of it: *"**First run is one button.** The engine
picker lives in the New connection dialog and is not repeated on the empty page"*
(`docs/design/kira-design-system/README.md`, Decisions worth knowing). Api's front door has four.

### F3 — The collections panel's empty state repeats its own header, three actions deep

`CollectionsPanel.vue:150-163` renders, inside a ~240px-wide side panel:

```html
<EmptyState icon="globe" label="No collections yet">
  <button class="p-dlgbtn primary" data-testid="new-request-empty">New request</button>
  <button class="p-dlgbtn"         data-testid="new-collection-empty">New collection</button>
  <button class="p-dlgbtn"         data-testid="import-collection-empty">Import collection…</button>
</EmptyState>
```

`PanelShell.vue:109-119`'s `.side-empty` is `flex-direction: column`, so these stack as three
26px bordered buttons. All three actions are **already** in that same panel's header two rows above
(`:109-133`: `new-request`, `new-collection`, `import-collection`) **and** on `ApiStart.vue` in the
middle pane (F2). On a first run the user sees *New request* three times on one screen.

Studio's equivalent slot, `workbench/panels/ProjectPanel.vue:36-39`, is the counter-example:

```html
<span class="dim"><CodiconIcon name="database" :size="24" /></span>
<span class="p-xs dim side-empty-text">Everything you connect to<br />shows up here.</span>
```

An icon and a sentence. No button — the button lives in the middle pane's start page, once.

### F4 — Five `.p-select.bordered` sit in 28px toolbars, 4px taller than everything beside them, and Studio already fixed this once

`primitives.css:302-309`: `.p-select.bordered { height: var(--kira-h-md) }` = **26px**.
`primitives.css:524-533`: `.p-toolbar { height: 28px }`, under the comment *"LAW: a toolbar is 28px,
holds only h-sm controls"*. `--kira-h-sm` is **22px** (`tokens.css:94`), which is what
`SegmentedControl` (`.p-seg`, `primitives.css:326-333`), `AppButton` (`.p-btn`, `:70-81`),
`IconButton` (`.p-iconbtn`, `:35-45`) and `TextField` (`.p-input`, `:128-140`) all are.

The five, all Api:

| Site | Band |
|---|---|
| `HttpRequestView.vue:270-277` (method) | `ViewChrome` `#toolbar`, a `.p-toolbar` |
| `GrpcRequestView.vue:245-254` (method) | same |
| `RequestBodyPane.vue:91-101` (code language) | `.body-mode-row.p-toolbar` (`:84`) |
| `EnvironmentSelect.vue:32-43` | `ViewChrome` `#toolbar-2`, a `.p-toolbar` |
| `FormDataTable.vue:91-99` (Text/File) | a `.field-row` of 22px `TextField`s and `IconButton`s |

**Studio has exactly one select in a 28px band and it overrides the height, with the reason
written down** — `views/shared/celleditor/CellEditorView.vue:618-623`:

```css
.format-select {
  max-width: 160px;
  /* .p-select.bordered defaults to --kira-h-md (26px) — taller than the IconButtons/28px header
     row it sits in here; match --kira-h-sm like everything else alongside it. */
  height: var(--kira-h-sm);
  font-family: var(--kira-font-family);
}
```

Every other `.p-select.bordered` in the app is in a *dialog* form, where h-md is correct:
`SettingsDialog.vue:287,468`, `GenerateDataDialog.vue:242`, and — correctly —
`api/SaveRequestDialog.vue:84`. So this is not "the select is wrong", it is "five Api call sites put
the dialog variant in a toolbar", against a precedent that already exists three directories away.

### F5 — Seven Api dialogs invented seven body-padding conventions; Studio has one

Studio's form dialogs share a rule, by name and by value, in four files —
`project/FiltersDialog.vue:263-268`, `project/ConnectionDialog.vue:844-849`,
`project/SchemaDialog.vue:156-161`, `workbench/SettingsDialog.vue:613`:

```css
.dialog-body-inner { display: flex; flex-direction: column; padding: var(--kira-s-5); gap: var(--kira-s-4); }
```

12px padding, 8px gap. `DialogFrame.vue:130-134`'s own `.dialog-body` deliberately has none (it is
the scroll container), so this inner wrapper is the convention.

The Api module's seven:

| Dialog | Class | padding | gap |
|---|---|---|---|
| `ImportCurlDialog.vue:85-90` | `.import-curl-body` | `--kira-s-3` (6px) | `--kira-s-2` (4px) |
| `CopyAsCurlDialog.vue:132-137` | `.copy-as-curl-body` | `--kira-s-3` | `--kira-s-2` |
| `EditRawRequestDialog.vue:113-118` | `.edit-raw-body` | `--kira-s-3` | `--kira-s-2` |
| `SaveRequestDialog.vue:114-118` | `.save-form` | **none** | `--kira-s-2` |
| `VariablesDialog.vue:262-265` | `.variables-dialog-body` | **none** | **none** |
| `EnvironmentsDialog.vue:182-187` | `.environments-body` | `--kira-s-2` | `--kira-s-1` (2px) |
| `DynamicValuesDialog.vue:69-75` | `.dynamic-values-body` | `--kira-s-2` | **`1px`** — off the scale entirely |

Seven class names, four padding values, five gaps, one of them a bare `1px`. Against Studio's one
name and one pair. **This is the headline finding of the phase**: it is precisely *"each earlier
phase's own ad hoc styling"*, and it is what makes the Api dialogs feel like a different app's
dialogs when opened back to back with Settings or Filters.

### F6 — Four Api dialog footers gap at 4px where Studio's four form dialogs gap at 6px

`.footer-actions` is defined **eleven** times across the renderer. The values split cleanly:

| Group | Files | `gap` |
|---|---|---|
| Studio form dialogs | `SettingsDialog.vue:843`, `SchemaDialog.vue:199`, `FiltersDialog.vue:424`, `ConnectionDialog.vue:1021` | `--kira-s-3` (6px) |
| Studio action dialogs | `GenerateDataDialog.vue:429` (`s-3`), `ConfirmDialog.vue:51` (`s-2`), `UploadObjectDialog.vue:155` (`s-2`) | mixed, plus `justify-content: flex-end; width: 100%` |
| **Api dialogs** | `CopyAsCurlDialog.vue:147`, `EditRawRequestDialog.vue:135`, `ImportCurlDialog.vue:104`, `SaveRequestDialog.vue:124` | **`--kira-s-2` (4px)**, all four |

All four Api dialogs are form dialogs (Cancel + a primary), so they belong to the first group and
are 2px tighter than it, uniformly. Eleven copies of a three-line rule is also the exact shape P28
M4 promoted `.p-textarea` out of, for the reason it recorded: *"it stops the divergence at one."*

### F7 — Three Api dialogs have no footer at all; all seven Studio dialogs have one

`DialogFrame.vue:95-97` renders `.dialog-footer` only when the slot is filled. Counting its fifteen
consumers:

| | Consumers | With a footer |
|---|---|---|
| Studio | `SettingsDialog`, `GenerateDataDialog`, `UploadObjectDialog`, `ConfirmDialog`, `SchemaDialog`, `FiltersDialog`, `ConnectionDialog` (two, one per step, `:787`/`:796`) | **7 of 7** |
| Api | `SaveRequestDialog`, `ImportCurlDialog`, `CopyAsCurlDialog`, `EditRawRequestDialog`, `EnvironmentsDialog`, `VariablesDialog`, `DynamicValuesDialog`, `ResponseDiffDialog` | **5 of 8** |

`VariablesDialog`, `DynamicValuesDialog` and `ResponseDiffDialog` have none, so ✕, Escape or a
backdrop click are their only exits. `EnvironmentsDialog.vue:173-177` has one, but it holds only
*New environment* and no way out either. Studio's read-only-shaped dialog still carries a pair
(`SchemaDialog.vue:140-151`: Cancel + Save).

`SaveRequestDialog.vue:26-35` has a second, smaller instance of the same "good enough to ship"
quality — the collection/folder target list is indented **with four literal spaces inside the
option label**:

```ts
out.push({ value: `${collection.id}:${folder.id}`, label: `    ${folder.label}` });
```

`primitives.css:289-294` renders `.p-select option` as a real styled element under
`appearance: base-select`, where leading whitespace collapses like any other inline text — so the
hierarchy this is trying to draw does not draw. `SettingsDialog.vue:300-310` is the app's own
answer: real `<optgroup>`s.

### F8 — Nine hardcoded pixel values inside Api CSS where a token exists

`tokens.css:86-97` defines the space scale (`--kira-s-1` 2px … `--kira-s-6` 16px), the radius tiers
(`:33-36`, sm 4px / 6px / lg 8px / pill 10px) and `--kira-border-width` (`:45`).

| Site | Written | Token |
|---|---|---|
| `CollectionRow.vue:230` (`.label mark`) | `border-radius: 2px` | `--kira-radius-sm` |
| `CollectionRow.vue:240` (`.rename-input`) | `border-radius: 2px` | `--kira-radius-sm` |
| `SchemaBrowser.vue:230` (`.method-row`) | `border-radius: 4px` | `--kira-radius-sm` (the same 4px, spelled) |
| `TimelinePane.vue:340` (`.hop-track`) | `border-radius: 3px` | `--kira-radius-sm` |
| `TimelinePane.vue:403` (`.legend-swatch`) | `border-radius: 2px` | `--kira-radius-sm` |
| `TimelinePane.vue:313` (`.timeline-hop`) | `border: 1px solid` | `--kira-border-width` |
| `RawExchangePane.vue:193` (`.raw-editor`) | `border: 1px solid` | `--kira-border-width` |
| `EditRawRequestDialog.vue:122` (`.raw-editor`) | `border: 1px solid` | `--kira-border-width` |
| `ResponseHistoryList.vue:185` (`.history-row`) | `border-bottom: 1px solid` | `--kira-border-width` |

Plus five `gap: 2px` (`VariableHistoryMenu.vue:124`, `ImportReportStrip.vue:85`,
`ImportCurlDialog.vue:101`, `EditRawRequestDialog.vue:132`, `ResponseHistoryList.vue:203`) and one
`margin-top: 2px` (`ResponseHistoryList.vue:194`) that are `--kira-s-1` spelled out, plus
`ResponseDiffDialog.vue:288` `padding: 2px 0` and `TimelinePane.vue:374` `padding: 2px 0`.

None of these is a rendering bug. Together they are the reason the token scale reads as advisory
inside this module and mandatory outside it — `grep -n 'border-radius: [0-9]' project/*.vue
workbench/**/*.vue` returns nothing.

### F9 — A dialog-height bordered button is used as a per-row action

`EnvironmentsDialog.vue:154-160` puts an `AppButton kind="dialog"` — `.p-dlgbtn`, h-md, bordered,
`padding: 0 var(--kira-s-5)` — labelled *Edit variables…* **inside each environment row**
(`.environment-row`, `:189-194`, `padding: var(--kira-s-2) var(--kira-s-3)`). `.p-dlgbtn`'s own
comment (`primitives.css:101`) calls it *"the only bordered button"* and scopes it to dialogs'
footers. Every other row-level action in the app — and in this very row (`IconButton icon="trash"`,
`:161-167`) — is an icon button or a `.p-btn`. Three environments produce three bordered pills down
the middle of a 480px dialog.

### F10 — Four different affordances for "delete this row", inside one module

| Surface | Affordance |
|---|---|
| `VariableRow.vue:171-177` | `IconButton icon="close"`, tooltip *Remove* |
| `FieldRowsTable.vue:94-100`, `MetadataTable.vue:73-79` | `IconButton icon="close"`, tooltip *Remove* |
| `ResponseHistoryList.vue:143-147` | `IconButton icon="trash"`, no tone |
| `EnvironmentsDialog.vue:161-167` | `IconButton icon="trash" tone="danger"` |
| `grpcrequest/ResponsePane.vue:195-202` | a text `<button class="p-xs dim remove-link">Delete</button>` |
| `SchemaBrowser.vue:115` | a text `<button class="p-xs dim remove-link">Remove</button>` |

Two of those six are bare text links with a locally-defined reset (`SchemaBrowser.vue:194-202`,
`grpcrequest/ResponsePane.vue:359-364`) — and `SchemaBrowser.vue:194`'s selector list still names
`.add-link`, **which no element in that file uses**: dead CSS left from an earlier shape.

The distinction that *is* real and worth keeping: `close` = "take this row out of a list I am
editing" (reversible, nothing persisted), `trash` = "delete a persisted record". By that reading
`ResponseHistoryList`'s and `EnvironmentsDialog`'s `trash` are right, `VariableRow`'s `close` is
**wrong** (a variable row is a persisted record — `commitDraft` writes through `VariablesRepo.Upsert`
on blur, `VariablesDialog.vue:100-124`), and the two text links are wrong regardless.

### F11 — Raw `<div class="p-strip">` and raw `<details>` where the module's own primitives exist

**`.p-strip` by hand:** `MessageStrip.vue` exists and the Api module uses it eleven times (§1.6).
Two Api sites bypass it: `CopyAsCurlDialog.vue:87-104` and `:110-112`. Its own header comment cites
`ImportReportStrip.vue`'s technique, but `ImportReportStrip` has a *stated* reason (it needs the
dismiss `IconButton` in `.strip-action` and a computed tone) and `CopyAsCurlDialog` has the same
`.strip-action` need — which `MessageStrip` handles fine, as `ResponsePane.vue:209-215` proves by
putting `<AppButton class="strip-action">` inside a `MessageStrip` slot.

**`<details>` by hand:** `grep -rn '<details' frontend/src` returns exactly three hits, all Api:
`TimelinePane.vue:246`, `:253`, `ResponseDiffDialog.vue:215`. None styles `summary::marker` or
`list-style`, so all three render the browser's default ▶/▼ triangle — the one disclosure glyph in
the app that is not a Codicon `chevron-right`/`chevron-down` (`CollectionRow.vue:123`,
`project/TreeRow.vue`, `ExplainResultView.vue`, `DocumentTree.vue` all use those).

### F12 — Three hand-rolled empty states beside sixteen `EmptyState` ones

`EnvironmentsDialog.vue:169-171` + `:212-216`, `VariableHistoryMenu.vue:61-63` + `:106-110`, and
(implicitly) `SchemaBrowser`'s import-paths block each render:

```css
.empty { padding: var(--kira-s-4); color: var(--kira-fg-dim); text-align: center; }
```

— the same three declarations, twice, with F1's dead colour, where `EmptyState`
(`theme/primitives/EmptyState.vue`, `.p-empty` at `primitives.css:759-776`) is what the other
sixteen Api call sites use. The copy is also mid-register: *"No environments yet."* and *"No
previous values."* carry terminal periods that no `EmptyState` label in Studio does (F13).

### F13 — The empty-state icon and copy vocabulary does not match Studio's, and is not internally consistent either

**Studio's, all of it** (`grep -rn -A3 '<EmptyState'`, excluding Api): the icon is the *content
kind* or `search`, the label is a terse noun phrase with **no terminal punctuation** —
`table`/"No rows", `json`/"No documents", `database`/"No data", `inbox`, `checklist`/"No operations
yet", `arrow-swap`, `search`/"No matching rows", `loading`/"Loading…".

**Api's nineteen:**

| Icon | Label | File | Reads as |
|---|---|---|---|
| `arrow-right` | Send a request to see the response | `ResponsePane.vue:249,264,278`, `RawExchangePane.vue:156`, `TimelinePane.vue:283` | fine, ×5 |
| `arrow-right` | Call this method to see its response here | `grpcrequest/ResponsePane.vue:234,248` | fine, ×2 |
| `arrow-right` | **No header metadata** | `grpcrequest/ResponsePane.vue:213` | wrong — this is an *empty list*, not a "go do something"; `arrow-right` points at nothing |
| `arrow-right` | **No trailer metadata** | `grpcrequest/ResponsePane.vue:221` | same |
| `globe` | No collections yet | `CollectionsPanel.vue:152` | wrong icon — `globe` is the *HTTP request tab*'s mark (`tabKinds.ts:218`); a collection's own is `folder-library` (`CollectionRow.vue:33`) |
| `history` | No past responses yet. Sending this request will record one. | `ResponseHistoryList.vue:107-108` | two sentences in a centred 24px-icon slot |
| `history` | No past calls yet | `grpcrequest/ResponsePane.vue:181` | the same state, a quarter the words — the gRPC/HTTP asymmetry in one line |
| `watch` | This response has no timeline. | `TimelinePane.vue:276` | terminal period |
| `warning` | This request failed before any timeline data was captured. | `TimelinePane.vue:277-281` | terminal period |
| `symbol-interface` | Choose a source above to browse this server's services. | `SchemaBrowser.vue:157-161` | terminal period |
| `file-binary` | `:label="emptyReason"` | `RawExchangePane.vue:155` | a **runtime-computed 110-character sentence** (`:59-66`) passed as a label |

Four labels end in a period, seven do not; `arrow-right` — which appears nowhere in Studio — carries
nine of the nineteen and is used for two meanings.

### F14 — see F13's `globe` row (folded in; kept as its own id because it is a one-token fix in a different file)

### F15 — `relativeTime` exists four times, in two formats, and the gRPC pane has none

| Implementation | Output | Note |
|---|---|---|
| `workbench/panels/StudioStart.vue:44-52` | `just now` / `5 m ago` / `3 h ago` / `yesterday` / `2 d ago` | **spaces** |
| `views/httprequest/ResponseHistoryList.vue:44-52` | `just now` / `5m ago` / `3h ago` / `yesterday` / `2d ago` | **no spaces** |
| `api/VariableHistoryMenu.vue:23-31` | identical to the above, byte for byte | |
| `views/shared/celleditor/timestamp.ts:232-235` | `Intl.RelativeTimeFormat` | the "right" one, but scoped to timestamp cells |
| `grpcrequest/ResponsePane.vue:193` | `new Date(...).toLocaleTimeString([], { hour12: false })` | **absolute**, in a list whose HTTP twin is relative |

Both Api copies carry a comment explaining why they are copies (*"No shared 'relative time' helper
reaches http/**"*). That was true when written. `frontend/src/format.ts` is exactly the home for it
— its own header calls itself *"a small renderer-root utility module"* created by v1.1 P24 D35 to
collapse *"three near-identical formatters"* into one `formatBytes`, which the Api module already
imports in six files. The same argument, the same file, the second function.

### F16 — A plan-decision id is printed in the product's UI

`ResponseDiffDialog.vue:232`:

```html
At least one response's body was not kept in history (D5), so it can't be compared.
```

`(D5)` is P8's own decision number. `grep -rn -E "'[^']*\b(D|F|C)[0-9]+\b" api views/httprequest
views/grpcrequest` finds no second instance, so this is the only leak — and it is the textbook
example of *"good enough to ship the feature, not good enough to live in the app."*

### F17 — Two comparison surfaces do not say which side is which

- `ResponseDiffDialog.vue:184-200` draws two `.diff-summary-col`s separated by a bare `→`
  (`:192`), and `.diff-header-row`'s grid (`:286`, `72px 160px 1fr 1fr`) has two value columns with
  no header row. The dialog *knows* which is older — `:38-46` sorts A/B by `sentAt` and the comment
  says so — but never tells the reader. Two 200-response bodies with no timestamp above either
  column is a real usability hole in a compare view.
- `TimelinePane.vue:266-273`'s legend is drawn once at the pane's foot, after every hop, so on a
  three-hop redirect chain the key to the colours is two screens below the bars.

### F18 — The timeline pane spends up to five full-width message strips per hop

`TimelinePane.vue:230-244` renders five conditional `MessageStrip`s **inside each
`.timeline-hop`** — reuse, connection attempts, 1xx, unattributed residue, elided headers. Each is
`.p-strip` (`primitives.css:648-657`): `padding: var(--kira-s-3) var(--kira-s-4)`, full width,
`line-height: 1.45`, its own tinted background. A reused-connection hop on a 2-redirect chain can
therefore push ~180px of tinted banner between a 10px bar and the next hop's caption.

Every sentence in them is genuinely worth having — the phase that wrote them argued that explicitly
(P10 D13's "report, never hide"). The problem is the *container*: a "note" that fires on the common
case (a reused connection is the common case) is a caption, not a banner. This is the module's
clearest instance of the SPEC row's *"not sparse for its own sake"* half.

### F19 — gRPC registers a Format command with no button behind it

`GrpcRequestView.vue:193` registers `view.format` → `onBeautify` (`:183-186`, `beautifyJson` over
the message editor). There is **no Beautify affordance in the gRPC toolbar**. Its HTTP twin has one:
`RequestBodyPane.vue:103-109`, `IconButton icon="expand-all"` tooltip *Beautify*, shown whenever the
body is JSON/XML. So the same operation is a visible button on one protocol and a palette-only entry
on the other — and the palette's label for it is `'Format query'` (`shortcuts/state.ts:57`), Studio
console copy, on a JSON request message.

### F20 — The gRPC history row nests a `<button>` inside a `<button>`

`grpcrequest/ResponsePane.vue:183-203`:

```html
<button v-for="entry in historyRt.entries" class="history-row" @click="viewGrpcHistoryEntry(...)">
  …
  <button class="p-xs dim remove-link" @click.stop="deleteGrpcHistoryEntry(...)">Delete</button>
</button>
```

Nested interactive content is invalid HTML; the parser's own recovery hoists the inner button out of
the outer one, so the delete control ends up a *sibling* of the row in the real DOM, outside the
clickable row it is drawn inside. The `@click.stop` only papers over what survives.

Its HTTP twin does it correctly — `ResponseHistoryList.vue:117-151` uses a `<div class="history-row"
@click>` with an `IconButton` inside.

### F21 — The gRPC metadata pane stacks two centred `flex: 1` empty states

`grpcrequest/ResponsePane.vue:206-223` renders a Header group and a Trailer group in a
`flex-direction: column` container (`.metadata-groups`, `:300-308`), each falling back to
`<EmptyState icon="arrow-right" label="No header metadata" />`. `.p-empty`
(`primitives.css:759-768`) is `flex: 1; justify-content: center` — so a call with neither header nor
trailer metadata (the common case for an unauthenticated unary call) shows **two vertically-centred
24px arrows** stacked down the pane. A one-line `p-xs dim` caption per group is the same information
in 5% of the space.

### F22 — The gRPC history pane has no Clear action, though `clearGrpcHistory` is implemented, bound, and exported

`views/grpcrequest/history.ts:40-44`:

```ts
// F23: implemented and bound, wired to nothing (the gRPC response pane has no Clear action) — a
// protocol-parity gap this phase's row ("no new user-facing behaviour") leaves for P13 (§8 OQ-3).
export async function clearGrpcHistory(tabId: string): Promise<void> { await clearAll(tabId); }
```

`clearAll` comes from `createHistoryStore` (P12 D12) over `control.grpcHistoryClear(itemId, tabId)`
(`:23`), the same factory HTTP's `clearHistory` (`views/httprequest/history.ts:54-58`) rides. The
gRPC pane imports `deleteGrpcHistoryEntry`, `ensureGrpcHistoryLoaded`, `viewGrpcHistoryEntry` and
`backToLatestGrpc` — not `clearGrpcHistory`.

The wider asymmetry, since a Clear button alone would land in an empty band: HTTP's history pane has
a real `.history-toolbar` (`ResponseHistoryList.vue:85-103`) with a count, *Compare* and *Clear
history*; gRPC's has no toolbar at all.

### F23 — The gRPC method list re-implements `.p-row`, missing its states

`SchemaBrowser.vue:221-243`'s `.method-row` hand-writes `display:flex / align-items / gap /
padding / background:none / border:none / cursor / text-align / font:inherit / color`, plus
`:hover { background: var(--kira-hover) }` and `.active { background: var(--kira-select) }`.
`primitives.css:379-396`'s `.p-row` **is** that, complete with `.is-hover`/`.is-selected`, at
`height: var(--kira-h-sm)` and `font-size: var(--kira-t-md)`. `DynamicValuesDialog.vue:50` already
consumes `.p-row` inside this same module.

`.service-name` (`:215-219`) likewise approximates the group-label idiom `primitives.css:484-493`
(`.p-menu-label`) and `:797-802` (`.def-section-title`) already carry — muted, `t-sm`, uppercase,
`letter-spacing: 0.05em` — without the case or tracking, so a service name and a method name read at
almost the same weight in a list where the whole point is the hierarchy between them.

### F24 — The `.proto` import-paths block is placeholder-grade

`SchemaBrowser.vue:111-126`, the surface P11 §6.5 item 3 explicitly handed here (*"whether the
import-paths UI is usable for [a large real .proto tree] is a P13 question as much as a P11 one"*):

- a bare `<span class="p-xs muted">Import paths</span>` label with no group-label idiom (F23's
  sibling);
- one `.import-path-row` per path, `justify-content: space-between` (`:187-192`), so a short path's
  *Remove* link floats to the far right and a long one's sits mid-row — a ragged action column;
- the path itself in `p-xs mono` with **no truncation** (`overflow`/`text-overflow` unset), so a
  real 80-character absolute path wraps and breaks the row's own height;
- **no cap and no scroll** on the container (`:179-185`), so ten import paths push the source row
  and the whole service list off the pane;
- *Remove* as a text link (F10), and an *Add* `AppButton` beside a `TextField` with no empty state
  when the list is empty.

### F25 — The palette offers *New request* but not *New gRPC request*

`shortcuts/state.ts:23` registers `api.newRequest` → *New request*. There is no gRPC entry, though
the action exists in three other places: `ApiStart.vue:36-39`, `api/menus.ts:98` (*New gRPC
request*, in the tree's row menu) and `:169`-adjacent background menu. P12 recorded this as its F24
and handed it here.

---

## 3. Decisions

### D1 — `.p-dialog-body` is promoted into `primitives.css`; the seven Api dialogs adopt it (F5)

New, in `theme/primitives.css` beside `.p-textarea` (which P28 M4 promoted for exactly this reason
— *"it stops the divergence at one"*), carrying Studio's four-file values verbatim so **no Studio
dialog changes by a pixel**:

```css
/* ---------- P13 dialog body ---------- */
/* The column wrapper every DialogFrame consumer puts inside .dialog-body (which is the scroll
   container and deliberately has no padding of its own). Promoted from the identical
   `.dialog-body-inner` in FiltersDialog/ConnectionDialog/SchemaDialog/SettingsDialog. */
.p-dialog-body {
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-5);
  gap: var(--kira-s-4);
}
/* A dialog whose body is a LIST of rows, not a form of fields — the rows carry their own
   padding, so the wrapper only insets them from the frame. */
.p-dialog-body.list {
  padding: var(--kira-s-2);
  gap: var(--kira-s-1);
}
```

**Why two variants, not one.** Four of the seven Api dialogs are forms (Save request, Import curl,
Copy as curl, Edit as raw) and take the base. Three are lists whose rows already own their vertical
rhythm (Variables' `VariableRow` at `s-2 s-3`, Environments' `.environment-row` at `s-2 s-3`,
Dynamic values' `.p-row` at `s-2 s-3`); giving them 12px padding and an 8px gap between rows would
make a 58-row catalogue three screens tall. `.list` codifies what `EnvironmentsDialog` had already
converged on (`s-2`/`s-1`) rather than inventing a third number — the only change to those three is
that `DynamicValuesDialog`'s `1px` becomes `--kira-s-1` (2px) and `VariablesDialog`/`SaveRequest`
gain the inset they had none of.

**Studio migration is included and is inert.** The four `.dialog-body-inner` rules are deleted and
their `class="dialog-body-inner"` renamed to `class="p-dialog-body"`; the declarations are
identical, so the computed style is unchanged. Doing it in the same commit is what makes the
promotion honest rather than a fifth copy that happens to live in `primitives.css`.

### D2 — `.p-dialog-actions` and `.p-kv-row` are promoted too; Api's footers move to the 6px gap (F6, D2's own duplication)

Two more promotions, same file, same commit:

```css
.p-dialog-actions { display: flex; align-items: center; gap: var(--kira-s-3); }
.p-dialog-actions.end { justify-content: flex-end; width: 100%; }
```

Eleven local copies collapse to one. **Api's four move from `--kira-s-2` to `--kira-s-3`** (F6) —
they are form dialogs and this is the group they belong to; `ConfirmDialog`/`UploadObjectDialog`
keep their tighter `s-2` by taking `.end` with a local `gap` override, since their footers are a
different shape (`justify-content: flex-end; width: 100%`) and this phase must not restyle Studio.
If any Studio footer cannot be migrated inertly, it keeps its local rule and the commit says so —
the Api four are the required half.

And the name/value row, which exists **three times** in Api alone
(`views/httprequest/ResponsePane.vue:345-359`, `views/grpcrequest/ResponsePane.vue:314-328`,
`views/httprequest/TimelinePane.vue:370-385`) with byte-identical declarations:

```css
.p-kv-row  { display: flex; gap: var(--kira-s-3); font-size: var(--kira-t-xs); }
.p-kv-name { color: var(--kira-fg-muted); flex-shrink: 0; min-width: 160px; }
.p-kv-value{ overflow-wrap: anywhere; }
```

This one is Api-only, so no Studio file is touched. `ResponseDiffDialog.vue:304-310`'s
`.diff-header-name`/`.diff-header-value` deliberately stay local — they sit in a four-column grid,
not a two-column flex row, and forcing them onto the same class would be the "shared rule that draws
a divider where it isn't wanted" `primitives.css:786` already warns about.

### D3 — The three phantom tokens resolve to the real ones (F1)

| Phantom | Replacement | Why that one |
|---|---|---|
| `--kira-fg-dim` (8 sites) | `--kira-fg-disabled` | `primitives.css:13`'s `.dim` is `--kira-fg-disabled`, and "dim" is that class's own name. Every author of the eight meant `.dim` |
| `--kira-bg-inset` (`TimelinePane.vue:339`) | `--kira-bg-input` | `tokens.css:6` — the app's one "recessed surface" colour (`#313131`), what `.p-input`/`.p-badge`/`.p-seg > .on` all sit on. `--kira-bg-elevated` is for things floating *above* the page, which a track inset into it is not |
| `--kira-font-mono` (`SchemaBrowser.vue:246`) | drop the declaration; add `class="mono"` to the element | `primitives.css:7-9`'s `.mono` is the app's mono affordance and every other Api mono span already uses it (`ResponsePane.vue:245`, `TimelinePane.vue:249`, `VariableHistoryMenu.vue:75`) |

**Six of the eleven change what renders**, which is the point: they are being fixed, not renamed.
The eight `--kira-fg-dim` sites go from inherited full-strength `--kira-fg` to real `#6e6e6e`; the
timeline track gains its ground; the method name gains its face. Every one is the appearance the
code already asked for.

**Guard, so this cannot recur.** A one-line check added to the existing lint step — every
`var(--kira-…)` in `frontend/src/**/*.{vue,css}` must match a `--kira-…:` definition in
`theme/{tokens,base,primitives}.css` or an `:root`-level declaration. It is a `grep`-and-`comm`
script (`scripts/check-tokens.sh`), not a dependency, and it catches the whole class of bug F1 is
one instance of. §9 OQ-1 records the alternative (a stylelint plugin) and why it is not taken.

### D4 — The five toolbar selects take `--kira-h-sm`, using `CellEditorView`'s own recipe (F4)

Not a new `.p-select.toolbar` variant in `primitives.css` — **`CellEditorView.vue:618-623` already
solved this with a local `height: var(--kira-h-sm)`**, and a phase whose row forbids new
functionality should reuse the precedent rather than mint a vocabulary Studio would then have one
non-consumer of. Each of the five gets:

```css
/* .p-select.bordered is --kira-h-md (26px); the .p-toolbar it sits in holds only h-sm controls
   (primitives.css's own LAW), the same fix views/shared/celleditor/CellEditorView.vue makes. */
.method-select { height: var(--kira-h-sm); }
```

`SaveRequestDialog.vue:84`'s select is **not** touched: it is in a dialog form beside
`SettingsDialog`'s and `GenerateDataDialog`'s, where h-md is the convention.

**If a fourth Api caller of this override appears, it becomes a `.p-select.sm` in `primitives.css`.**
Five is already four; §9 OQ-2 records why the plan still chooses local overrides — the alternative
changes a shared primitive's class vocabulary in a phase whose whole job is to stop this module from
inventing vocabulary.

### D5 — `ApiStart` becomes one primary action plus a secondary row, sized and scrollable (F2)

No affordance is removed — all four buttons stay, since removing one is removing a feature (§5).
What changes is the container and the hierarchy, matching `StudioStart.vue`'s own two guards:

```css
.start        { overflow: auto; }                 /* was absent — StudioStart.vue:118 */
.start-inner  { width: 420px; max-width: 100%; }  /* was 360px, no max — StudioStart.vue:122-124 */
.start-actions{ flex-wrap: wrap; justify-content: center; }
```

and the markup splits: *New request* stays `.p-dlgbtn.primary` on its own line; *New gRPC request*,
*Import collection…* and *Import from curl…* become a second wrapping row of plain `.p-dlgbtn`s.
Every `data-testid` is preserved verbatim (`new-request-start`, `new-grpc-request-start`,
`import-collection-start`, `import-curl-start`) — four specs click them.

**Why not obey the design system's "first run is one button" literally?** Because Studio's own
first-run has one *door* (New connection) and the other three here are not doors to the same place:
importing a Postman collection and pasting a curl command are how most users will arrive at this
mode with work already in hand, and neither is reachable in one click anywhere else on that screen.
The law is about not repeating the *engine picker*; keeping four distinct entry points while making
the primary one visually primary is the honest reading. Recorded rather than silently diverged from.

### D6 — The collections panel's empty state drops its three buttons and adopts Studio's shape (F3, F14)

`CollectionsPanel.vue:150-163` becomes:

```html
<template #empty>
  <ImportReportStrip />
  <EmptyState icon="folder-library" label="No collections yet">
    <span class="p-xs dim side-empty-text">Create one from the <b>+</b> above, or import a Postman collection.</span>
  </EmptyState>
</template>
```

with `folder-library` replacing `globe` (F14: it is the icon `CollectionRow.vue:33` already gives a
collection) and the three `p-dlgbtn`s deleted. **Nothing becomes unreachable**: all three actions
remain in the panel header immediately above (`:109-133`), where they are in Studio, and on
`ApiStart` in the middle pane. This is deleting a *third* copy of an affordance, not the affordance
— which is why it stays inside "no new functionality" rather than crossing into feature removal.
`b` is used because the `+` glyph names the header button; §9 OQ-3 records the alternative of
inlining a `CodiconIcon` instead.

**The three `-empty` testids go with the buttons.** `grep -rn 'new-request-empty\|
new-collection-empty\|import-collection-empty' tests/ui` — §7 confirms which specs reference them
and rewrites those assertions onto the header's own `new-request`/`new-collection`/
`import-collection` ids rather than deleting coverage.

### D7 — `close` vs `trash`, settled by whether the row is persisted (F10)

The rule, written down once so a twelfth phase does not re-guess it:

> **`IconButton icon="close"`** removes a row from a list the user is *composing* — nothing is
> persisted until the request is sent or saved. **`IconButton icon="trash"`** deletes a record that
> already exists on disk. Neither is ever a text link.

Applied:

| Site | Today | After |
|---|---|---|
| `FieldRowsTable.vue:94` (params/headers/urlencoded/form-data) | `close` | `close` — unchanged |
| `MetadataTable.vue:73` | `close` | `close` — unchanged |
| `BinaryBodyPicker.vue:43`, `FormDataTable.vue:107` (clear a chosen file) | `close` | `close` — unchanged; these clear a field, not a row |
| `VariableRow.vue:171` | `close` | **`trash`** — a variable is a `VariablesRepo` row, deleted through `deleteVariable` |
| `ResponseHistoryList.vue:143` | `trash` | `trash` — unchanged |
| `EnvironmentsDialog.vue:161` | `trash tone="danger"` | `trash` — **`tone="danger"` dropped**, so the module has one delete colour; the `confirmDialog` at `:66-69` is the danger gate, and `ResponseHistoryList`'s trash is the precedent |
| `grpcrequest/ResponsePane.vue:195` (*Delete* link) | text link | **`IconButton icon="trash"`**, matching its HTTP twin |
| `SchemaBrowser.vue:115` (*Remove* link) | text link | **`IconButton icon="close"`** — an import path is tab state, not a record |

`.remove-link`/`.add-link` are deleted from both files (F10's dead `.add-link` included).

### D8 — Every hardcoded pixel takes its token (F8)

Mechanical, no judgement: the nine borders/radii and the eight sub-token spacings in F8 become
`--kira-border-width`, `--kira-radius-sm` and `--kira-s-1`. Three change by a pixel
(`TimelinePane`'s 3px→4px track radius, `CollectionRow`'s two 2px→4px), which is the point of a
tier system. `DynamicValuesDialog`'s `gap: 1px` is the one with no nearest token — it becomes
`--kira-s-1` (2px) under D1's `.list` variant.

### D9 — Studio's `<details>` gap is closed with the app's own chevron (F11)

The three `<details>` stay `<details>` — a native disclosure is the right element and this phase is
not writing a widget — but gain the app's glyph, as a shared rule in `primitives.css` since three
call sites in two files is already the P28 threshold:

```css
.p-disclosure > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: var(--kira-s-2); }
.p-disclosure > summary::-webkit-details-marker { display: none; }
.p-disclosure > summary::before { content: '\eab6'; font-family: codicon; font-size: 13px; }  /* chevron-right */
.p-disclosure[open] > summary::before { content: '\eab4'; }                                    /* chevron-down */
```

**Verification required before this lands** (§7): the two codepoints must be read out of the
installed `@vscode/codicons` mapping at the pinned version, not from memory. If reading them cleanly
is not possible, the fallback is a `<CodiconIcon>` inside each `<summary>` and a plain
`list-style: none` — three extra elements, same result, no font-internals dependency. §9 OQ-4.

### D10 — The empty-state vocabulary is fixed as a table (F13, F12, F21)

**Two rules**, matching Studio: the icon names *the thing that is absent* (or `search`/`arrow-right`
when the state is genuinely "do something"), and the label is a terse phrase with **no terminal
punctuation** and at most one sentence.

| Site | Icon → | Label → |
|---|---|---|
| `ResponsePane.vue:249,264,278`, `RawExchangePane.vue:156`, `TimelinePane.vue:283` | `arrow-right` (kept) | *Send a request to see the response* (kept) |
| `grpcrequest/ResponsePane.vue:234,248` | `arrow-right` (kept) | *Call this method to see its response* |
| `grpcrequest/ResponsePane.vue:213,221` | — | **not an `EmptyState` at all**: a `p-xs dim` caption *No header metadata* / *No trailer metadata* inside the group (F21) |
| `CollectionsPanel.vue:152` | `globe` → **`folder-library`** | *No collections yet* (kept) |
| `ResponseHistoryList.vue:107` | `history` (kept) | *No past responses yet* — the second sentence moves into the existing scratch-note slot below it (`:111-113`) |
| `grpcrequest/ResponsePane.vue:181` | `history` (kept) | *No past calls yet* (kept) |
| `TimelinePane.vue:276` | `watch` (kept) | *No timeline for this response* |
| `TimelinePane.vue:279` | `warning` (kept) | *This request failed before any timeline was captured* |
| `SchemaBrowser.vue:159` | `symbol-interface` (kept) | *Choose a source above to browse this server's services* |
| `RawExchangePane.vue:155` | `file-binary` (kept) | `emptyReason`'s two sentences (`:59-66`) shorten to *No raw view for a stored response* / *The raw exchange could not be rendered*, with the long explanation moving to a `MessageStrip tone="note"` above — a sentence belongs in a strip, a label belongs in a label |
| `EnvironmentsDialog.vue:169`, `VariableHistoryMenu.vue:61` | hand-rolled `.empty` → **`EmptyState`** (F12) | `settings-gear` / *No environments yet*; `history` / *No previous values* |

The two `.empty` rules and their `text-align: center` are deleted with the divs.

### D11 — The timeline's per-hop notes become captions; the legend moves to the top (F18, F17)

`TimelinePane.vue:230-244`'s five `MessageStrip`s become one `.hop-notes` block of `p-xs dim`
lines, directly under `.hop-phases`, keeping every sentence verbatim:

```html
<div v-if="hopNotes(hop).length" class="hop-notes p-xs dim">
  <div v-for="(n, i) in hopNotes(hop)" :key="i">{{ n }}</div>
</div>
```

```css
.hop-notes { display: flex; flex-direction: column; gap: var(--kira-s-1); }
```

`hopNotes(hop)` is a `computed`-shaped helper collecting the four existing string builders
(`reuseNote`, `attemptsNote`, `info1xxNote`, `residueNote`) plus the elided-headers sentence, in
that order — no new text, no removed text, and the five `data-testid`s are preserved by putting them
on the per-line `<div>`s so the existing `http-timeline.spec.ts` assertions keep resolving.

**The failure strip (`:170-177`) and the stored-timeline note (`:178-180`) stay `MessageStrip`s** —
they are about the *whole* timeline, appear once, and one of them is an error. The distinction the
phase draws: pane-level state is a strip, per-row detail is a caption.

The legend (`:266-273`) moves **above** `.timeline-hops`, beside `.timeline-summary` on the same
row, so a multi-hop timeline shows its key before the bars it explains (F17).

### D12 — The gRPC history pane gets HTTP's toolbar, and with it the Clear button P12 deferred (F22, F20, F15)

This is the one place where a control genuinely appears that was not there before, and §5 argues at
length why it is polish rather than a feature: `clearGrpcHistory` is implemented
(`views/grpcrequest/history.ts:42-44`), bound (`control.grpcHistoryClear`), backed by a real Go
method, and reachable from nowhere. Shipping code with no way to invoke it is precisely the
"rough edge from an earlier phase" this row exists to clean up, and P12's own OQ-3 assigned it here
by name.

The block at `grpcrequest/ResponsePane.vue:179-205` is **extracted into
`views/grpcrequest/CallHistoryList.vue`**, mirroring `ResponseHistoryList.vue`'s shape and file
position, with:

- a `.history-toolbar.p-toolbar`: `{n} calls` count, `p-push`, `AppButton icon="trash"` *Clear
  history* → `confirmDialog('Clear this request's call history? This cannot be undone.', { danger:
  true })` → `clearGrpcHistory(tab.id)`. Copy and gate copied verbatim from
  `ResponseHistoryList.vue:75-80` / `:95-102`;
- rows as `<div class="history-row" @click>` with an `IconButton icon="trash"` inside, fixing F20's
  nested `<button>`;
- `is-viewing` highlighting keyed off `historyRt.viewing?.id`, which HTTP has
  (`ResponseHistoryList.vue:121`) and gRPC does not;
- `formatRelative` from `format.ts` (F15/D13) replacing the absolute `toLocaleTimeString`, with the
  ISO string in a `v-tooltip` exactly as `ResponseHistoryList.vue:136` does.

**No `Compare`.** HTTP's compare rides `@codemirror/merge` over two response *bodies*; a gRPC call
is a message *sequence* and comparing two is a genuinely different design. §5 flags it out of scope.

### D13 — One `formatRelative` in `format.ts`, in the no-space form (F15)

```ts
/** 'just now' / '5m ago' / '3h ago' / 'yesterday' / '2d ago'. Sibling of formatBytes: one
 *  relative-time convention app-wide, replacing three copies (StudioStart, ResponseHistoryList,
 *  VariableHistoryMenu) that had already drifted into two spellings. */
export function formatRelative(at: number | string): string
```

Accepts both an epoch number (`StudioStart`'s `openedAt`) and an ISO string (both Api callers), so
all three sites collapse without a per-caller adapter. **The no-space form wins** (`5m ago`, not
`5 m ago`): two of the three copies already use it, and it is what fits `ResponseHistoryList`'s
`.history-time { min-width: 64px }` column (`:212-214`). `StudioStart.vue:44-52` is deleted and its
one call site rewired — a visible one-character change on Studio's start page, the only Studio
*visual* change this phase makes, and it is a convergence rather than a divergence.

`views/shared/celleditor/timestamp.ts:232-235`'s `Intl.RelativeTimeFormat` version is **left alone**
— it formats absolute timestamps in a cell that may be years old and in either direction, which this
minutes/hours/days helper deliberately is not.

### D14 — The `.proto` import-paths block is rebuilt on the module's own row idiom (F24)

`SchemaBrowser.vue:111-126` keeps every control; only its geometry changes:

- the *Import paths* label adopts `.def-section-title`'s idiom (`primitives.css:797-802`: `t-sm`,
  muted, uppercase, `letter-spacing: 0.05em`) — the app's group label, already shared;
- each row becomes `.p-row` with the path in `.mono` + `overflow: hidden; text-overflow: ellipsis`
  and `v-tooltip="p"` for the full value, and the *Remove* text link becomes `IconButton
  icon="close"` on `p-push` (D7) — a straight action column, not `space-between`;
- the container gains `max-height: 132px; overflow: auto` (roughly six `--kira-h-sm` rows), so a
  large tree's import list can never push the service browser off the pane;
- an `EmptyState`-free `p-xs dim` caption *No import paths — the .proto file's own directory is
  used* when the list is empty, which is what Go's `resolveProto` actually does (`SchemaBrowser.vue`
  D4's own comment).

This is the answer to P11 §6.5 item 3's handed-forward question. It is answered by making the UI
survive a large tree, not by testing one — §7 records that a real multi-import `.proto` tree is
still not exercised here and why.

### D15 — gRPC gets the Beautify button its command already implies (F19)

`GrpcRequestView.vue` gains, in `#toolbar-2` beside the pane `SegmentedControl`:

```html
<IconButton
  v-if="tab.state.requestPane === 'message'"
  icon="expand-all"
  v-tooltip="'Beautify'"
  data-testid="grpc-beautify"
  @click="onBeautify"
/>
```

Identical icon, tooltip and placement logic to `RequestBodyPane.vue:103-109`. `onBeautify` already
exists (`:183-186`) and is already registered as `view.format` (`:193`); this is the missing
affordance for a command that ships, the same class of gap as D12 and in scope for the same reason.

`shortcuts/state.ts:57`'s `'Format query'` label is **not** changed — it is Studio's console
command, shared by three views, and rewording it for one Api consumer is a Studio-copy change in an
Api phase. §9 OQ-6.

### D16 — The method list and service label adopt `.p-row` and the group-label idiom (F23)

`SchemaBrowser.vue:136-154`'s `<button class="method-row">` becomes `<button class="p-row
method-row">` keeping only what `.p-row` does not supply (`width: 100%`, `justify-content:
space-between`, `border: none; background: none; font: inherit; text-align: left`), with
`:class="{ 'is-selected': … }"` replacing the local `.active`. `.service-name` adopts
`.def-section-title`. Twenty-two lines of scoped CSS become six.

### D17 — Two `AppButton kind="dialog"`s in list rows become `.p-btn` (F9)

`EnvironmentsDialog.vue:154-160`'s *Edit variables…* drops `kind="dialog"`, becoming a 22px `.p-btn`
that matches the `IconButton` beside it and the row's own `--kira-h-sm` `TextField`. Same label,
same handler, same testid.

### D18 — Copy fixes: the leaked decision id, and the diff dialog's column labels (F16, F17)

- `ResponseDiffDialog.vue:232` → *"At least one response's body was not kept in history, so it can't
  be compared."* — `(D5)` deleted, nothing else.
- `ResponseDiffDialog.vue:184-200` gains a `p-xs dim` caption above each `.diff-summary-col`
  carrying that side's `formatRelative(entry.sentAt)` with the ISO in a tooltip, and the header grid
  gains a `.diff-header-head` row labelling the two value columns *before* / *after*. Both read from
  `snapA`/`snapB`, which `:32-52` already sorted by `sentAt` — no new data, no new call, no new
  state. This is labelling data already on screen, which is why it is copy and not a feature (§5).

### D19 — Dialog sizes converge on the app's existing set (F5's sibling)

`DialogFrame` widths in use app-wide: 400, 440, 480, 560, 620, 640, 680, 720, 780, 900.
`max-height`s: 70vh, 80vh (×7), 82vh, 85vh. Three Api outliers move to the nearest value already in
use elsewhere; nothing else changes.

| Dialog | Today | After | Why |
|---|---|---|---|
| `SaveRequestDialog.vue:74` | `440` | `480` | matches `UploadObjectDialog`/`EnvironmentsDialog`/`DynamicValuesDialog`; two fields need no bespoke width |
| `CopyAsCurlDialog.vue:72` | `640` | `680` | matches `EditRawRequestDialog`/`GenerateDataDialog`, and a curl command wants the extra 40px |
| `EditRawRequestDialog.vue:50` | `85vh` | `80vh` | the app's cap, seven dialogs deep |
| `DynamicValuesDialog.vue:41` | `70vh` | `80vh` | ditto; a 58-row catalogue is the one dialog that benefits most from the height |

`ResponseDiffDialog`'s `900`×`640` stays — a side-by-side merge view is genuinely the widest thing
in the app, and `SettingsDialog` already establishes the fixed-`height` idiom for a dialog that must
not resize.

### D20 — Four Api dialogs gain a dismiss button (F7)

`VariablesDialog`, `DynamicValuesDialog` and `ResponseDiffDialog` gain a `#footer` holding a single
`AppButton kind="dialog"` *Close* on `.p-dialog-actions.end`; `EnvironmentsDialog` gains the same
button to the right of the *New environment* it already has. All four commit as you edit (or are
read-only), so there is no Save and *Close* is the honest word — the same word
`CopyAsCurlDialog.vue:117` already uses for exactly this role in this module. That brings all
fifteen `DialogFrame` consumers to parity with Studio's seven-of-seven, which is a smaller claim
than it sounds: it is one button in four files.

`SaveRequestDialog`'s target `<select>` moves to real `<optgroup>`s (F7):

```html
<optgroup v-for="c in collectionTargets" :key="c.id" :label="c.name">
  <option :value="`${c.id}:`">(collection root)</option>
  <option v-for="f in c.folders" :key="f.id" :value="`${c.id}:${f.id}`">{{ f.label }}</option>
</optgroup>
```

`SettingsDialog.vue:300-310`'s own optgroup usage is the precedent. The `value` encoding is
unchanged, so `splitTarget` (`:63-68`) and every spec assertion on `save-request-target` still hold.

### D21 — The palette gains *New gRPC request* (F25)

`shortcuts/state.ts`, one entry beside `api.newRequest`:

```ts
{ id: 'api.newGrpcRequest', label: 'New gRPC request', run: () => void openGrpcRequestTab() },
```

`openGrpcRequestTab` is already exported from `api/tabs.ts` and already called by
`ApiStart.vue:36` and `api/menus.ts:98`. P12 F24's own words: *"one wire-up each."*

---

## 4. The three items P11 and P12 explicitly handed to this phase

Accounted for one by one, as the task requires — fixed, or declined with a reason.

| Handed over | Source | Verdict |
|---|---|---|
| **`clearGrpcHistory` is implemented, bound and wired to nothing** | P12 F23 / §8 OQ-3 (`docs/v1.2/plans/P12-studio-api-modularization.md:437-441`, `:1096-1100`), restated in `views/grpcrequest/history.ts:40-41` | **Fixed** — D12. The Clear button lands inside a real history toolbar, so the gRPC pane gains HTTP's shape rather than a lone button in an empty band |
| **The palette has no *New gRPC request* entry** | P12 F24 / §8 OQ-3 (`P12…:443-445`) | **Fixed** — D21, one entry |
| **"Whether the import-paths UI is usable for [a large real `.proto` tree] is a P13 question"** | P11 §6.5 item 3 (`docs/v1.2/plans/P11-grpc-support.md:1381-1383`) | **Fixed as far as this phase can** — D14 caps, scrolls, truncates and re-idioms the block so a large tree does not break the pane. The underlying *question* (does a real multi-import tree compile) is a Go/`protocompile` matter P11 already reasoned about; §7 records that no such tree is exercised here |
| **"A TLS-inspecting proxy … the UI cannot distinguish — worth one look before P13 styles the note"** | P11 §6.5 item 2 (`P11…:1376-1379`) | **Declined, with a reason.** The "note" is `SchemaBrowser.vue:128-130`'s `MessageStrip tone="err"` carrying Go's own error text. Making a MITM-proxy failure *distinguishable* means classifying `x509` errors and adding a hint — new behaviour, and P11's own D6 CA-file field is the mechanism. This phase confirms the strip is styled correctly (it is: the same `MessageStrip tone="err"` as the module's other ten error surfaces) and flags classification as out of scope (§5) |
| **P12 §8 OQ-1: `packages/api-ui` must land *after* P13** | `P12…:1085-1087` | **Respected.** No file moves; §0.2. This phase's promotions go into `theme/primitives.css`, which is exactly the file OQ-1 says a later `@kira/ui-kit` extraction will take wholesale — so they travel with it rather than blocking it |
| **P12 F21/F22: dead exports (`grpc/target.ts`, eleven unused exports)** | `P12…:425-434` | **Declined — not this phase.** Dead *code*, not dead styling; the SPEC row scopes this phase to visual/interaction consistency, and P14 (the code review) is where an unused export belongs. The one exception is `SchemaBrowser.vue:194`'s dead `.add-link` **CSS selector**, which is styling and is deleted in D7 |

---

## 5. The polish/feature line, drawn explicitly

The SPEC row forbids new functionality. Three things surfaced that sit on the line, plus five that
are clearly over it.

**In scope — an affordance for behaviour that already ships:**

1. **The gRPC Clear-history button (D12).** `clearGrpcHistory` → `control.grpcHistoryClear` → a real
   Go method, all shipped and all unreachable. Adding the button changes no behaviour that does not
   already exist; it makes shipped behaviour reachable. P12 assigned it here by name.
2. **The gRPC Beautify button (D15).** `onBeautify` ships and is already bound to `view.format`;
   the button is the affordance a keyboard-only command lacks, and its HTTP twin has one.
3. **The palette's *New gRPC request* (D21).** The action exists in three other places.
4. **The diff dialog's column captions (D18).** Labelling two values already loaded, already sorted,
   already on screen. No new call, no new state.

**Out of scope — flagged, not fixed:**

1. **A gRPC *Compare calls* action.** HTTP's compare diffs two response bodies through
   `@codemirror/merge`; a gRPC call is a message *sequence* with metadata, so comparing two is a
   design, not a restyle. Flagged for a future row.
2. **Classifying TLS/proxy failures in the schema-browser error strip** (P11 §6.5 item 2). New
   behaviour; §4.
3. **A gRPC Timeline or Raw pane.** P11 D14 answered this deliberately (`httptrace` fires nothing
   for gRPC; `stats.Handler` reports no DNS/connect/TLS split), and its OQ-3 records what a real one
   would be built from. Not a styling gap — an absent pane, correctly absent.
4. **Removing any `ApiStart` button (D5).** Four entry points is a lot for a start page, but each is
   the only one-click route to its action from that screen. Restyled, not removed.
5. **A per-mode left-panel width.** P5 §8 OQ-8 re-handed this and P11 §1.6 declined it again; the
   Api panel and the Studio panel share `WorkbenchShell`'s one persisted width. Genuinely shared
   chrome, genuinely a feature, genuinely not this phase's.

**The one deletion, and why it is not a removal:** D6 deletes three buttons from the collections
panel's empty state. All three actions stay reachable in one click from the panel header directly
above them and from `ApiStart` in the same window. Deleting the third copy of an affordance is
de-duplication; it would only be feature removal if it were the last copy.

---

## 6. Commit sequence

Shared-primitive promotions first (they are what everything else consumes), then the mechanical
fixes, then the per-surface work, protocol by protocol. Per `AGENTS.md`, `bun run lint`,
`bun run typecheck` and `bun run build` run per commit; `tests/ui` runs once at the end (§7).

| # | Commit | Touches | Risk |
|---|---|---|---|
| M1 | `refactor(theme): promote the dialog body, footer actions and key/value row to primitives` (D1, D2) | `primitives.css`; the four Studio `.dialog-body-inner` files + seven Studio `.footer-actions` files (deletions only, computed styles identical); three Api `.p-kv-*` consumers | low — **must be visually inert on every Studio surface**; if any Studio migration is not, it is dropped and its local rule kept |
| M2 | `fix(theme): three Api custom properties that were defined nowhere` (D3) | `SchemaBrowser.vue`, `TimelinePane.vue`, `VariableHistoryMenu.vue`, `EnvironmentsDialog.vue`, `VariableRow.vue`, `VariablesDialog.vue`; new `scripts/check-tokens.sh` + its `package.json` hook | **medium — the only commit that changes what renders in eleven places.** Screenshot-adjacent review warranted |
| M3 | `style(api): the token scale, everywhere a pixel was written instead` (D8) | the nine files in F8 | trivial |
| M4 | `style(api): the eight dialogs adopt one body, one footer and one size scale` (D1 adoption, D19, D20, F7's optgroups) | the seven `api/*Dialog.vue` + `views/httprequest/ResponseDiffDialog.vue` | low–medium — `save-request-target` gains optgroups; §7 |
| M5 | `style(api): five toolbar selects match the 28px band they sit in` (D4) | `HttpRequestView`, `GrpcRequestView`, `RequestBodyPane`, `FormDataTable`, `EnvironmentSelect` | trivial |
| M6 | `style(api): one delete affordance, and one disclosure chevron` (D7, D9) | `VariableRow`, `EnvironmentsDialog`, `grpcrequest/ResponsePane`, `SchemaBrowser`, `TimelinePane`, `ResponseDiffDialog`, `primitives.css` | low; D9's codepoints verified first (§7) |
| M7 | `style(api): one empty-state vocabulary` (D10, D6, F12, F21) | `CollectionsPanel`, both `ResponsePane`s, `RawExchangePane`, `TimelinePane`, `SchemaBrowser`, `ResponseHistoryList`, `EnvironmentsDialog`, `VariableHistoryMenu` | medium — three `-empty` testids retire; §7 rewires their specs |
| M8 | `refactor(format): one relative-time helper, replacing three copies` (D13) | `format.ts`, `StudioStart.vue`, `ResponseHistoryList.vue`, `VariableHistoryMenu.vue` | low; one visible Studio change (`5 m` → `5m`) |
| M9 | `style(api): the start page fits its container` (D5) | `ApiStart.vue` | low |
| M10 | `style(http): the timeline reads as a waterfall, not a stack of banners` (D11, F17) | `TimelinePane.vue` | medium — five testids move onto caption lines; §7 |
| M11 | `feat(grpc): the call-history pane gains the Clear action its store already implements` (D12) | new `views/grpcrequest/CallHistoryList.vue`, `grpcrequest/ResponsePane.vue` | **highest** — the one new control and one extracted component |
| M12 | `style(grpc): the schema browser adopts the row and group-label primitives` (D14, D16, D17, D15) | `SchemaBrowser.vue`, `GrpcRequestView.vue`, `EnvironmentsDialog.vue` | low |
| M13 | `feat(shortcuts): New gRPC request in the palette` (D21) + `docs(diff): drop the leaked decision id` (D18) | `shortcuts/state.ts`, `ResponseDiffDialog.vue` | trivial |
| M14 | `test(p13): …` | the specs §7 enumerates | low |

M1 must precede M4 and M6. M2 is independent and could land first. M11 must follow M8 (its rows use
`formatRelative`). Everything else is order-free.

---

## 7. Verification plan

**Per commit:** `bun run lint`, `bun run typecheck`, `bun run build`. No Go, no bindings — §0.2.

**Before M6 lands:** read the two Codicon codepoints out of the installed
`@vscode/codicons/src/template/mapping.json` at the pinned version and confirm `chevron-right` /
`chevron-down` — never from memory. If the font-family name reachable from `primitives.css` is not
`codicon`, D9 falls back to its `<CodiconIcon>`-in-`<summary>` variant (D9's own second paragraph).

**After M2, a token audit that then runs forever:** `scripts/check-tokens.sh` must report zero
undefined `var(--kira-…)` across `frontend/src`. This is the guard, not a one-off check — it is what
turns F1 from a fixed bug into a closed class.

**`tests/ui/`, once at the end** (`AGENTS.md`'s implement-then-test cadence). The specs that must
change, from `grep`ping the retiring testids:

| Spec | Why |
|---|---|
| `collections.spec.ts` | `new-request-empty` / `new-collection-empty` / `import-collection-empty` retire with D6's buttons — rewire onto the panel header's `new-request` / `new-collection` / `import-collection`, which is where the actions live |
| `http-history.spec.ts` | `formatRelative`'s output is unchanged for the Api side (D13 keeps the no-space form), so only a `save-request-target` optgroup assertion may need adjusting if one exists |
| `http-timeline.spec.ts` | the five per-hop note testids move from `MessageStrip` roots onto caption `<div>`s (D11) — the ids are preserved deliberately so the assertions hold; verify each still resolves |
| `grpc-request.spec.ts` | new coverage: the Clear button confirms and clears (D12); the delete control is now an `IconButton` and no longer a nested `<button>`; the Beautify button formats the message (D15) |
| `http-request-body.spec.ts`, `http-curl.spec.ts`, `http-raw.spec.ts`, `http-variables.spec.ts`, `http-dynamic-values.spec.ts` | no testid changes expected — run to confirm the restyles are inert |
| `settings-apply-on-save.spec.ts`, `connection-dialog-tabs.spec.ts`, `tree.spec.ts`, `workbench.spec.ts`, `tabs.spec.ts` | **Studio regression guard for M1 and M8** — the migrations must be inert, and these are the specs that would notice |

Then a full `--project=ui` run.

**New spec, `tests/ui/api-ui-consistency.spec.ts`** — small, and only for the things a restyle can
genuinely regress rather than for the restyle itself:

1. the collections panel's empty state renders no `.p-dlgbtn` (D6's de-duplication, asserted as an
   absence so a future phase cannot quietly re-add a fourth copy);
2. the gRPC history row's delete control is not a descendant of a `<button>` (F20, asserted
   structurally so the invalid nesting cannot come back);
3. `Clear history` on the gRPC pane is disabled with no entries and enabled with some (D12).

Kept in its own file per the SPEC's module-boundary rule (*"a single test file covering both is
not"* — this file is Api-only).

**Not run, and named rather than glossed:**

- **A large real `.proto` tree with many import paths** (P11 §6.5 item 3). D14 makes the block
  survive one by construction — a scroll cap, truncation and a straight action column are correct
  for ten paths whether or not ten are tested — but no such tree is compiled here. The remaining
  question is `protocompile`'s, not the UI's.
- **A real macOS render.** Every measurement above is read out of CSS against the token scale; the
  three findings that are *height* claims (F4's 26-in-28, F9's h-md-in-a-row, F21's stacked
  `flex: 1` empties) are arithmetic over `tokens.css`, not screenshots. `AGENTS.md`'s own note about
  `--kira-titlebar-h` — *"a plausible-sounding 'standard' figure … has been wrong here"* — is why
  this phase changes **no** token value and only moves call sites onto existing ones.
- **A visual diff of the Studio migrations in M1/M8.** The declarations are compared textually and
  are identical; `tests/ui`'s Studio specs are the behavioural guard. A pixel diff harness does not
  exist in this repo and building one is not this phase's job.

---

## 8. What this phase deliberately does not do

- **Does not change a single value in `tokens.css`.** Every fix moves a call site onto an existing
  token; none moves a token. (`AGENTS.md`'s `--kira-titlebar-h` history is the standing warning.)
- **Does not add a component to `theme/primitives/`.** D1/D2/D9 add *classes to `primitives.css`*,
  which is the design system's own stylesheet and the file P28 M4 set the precedent in. No `.vue`
  primitive is created or has a prop added — the line every Api phase from P8 onward has held.
- **Does not remove an affordance.** D6's three deleted buttons are a third copy (§5); everything
  else is restyled in place.
- **Does not add a feature.** §5 names the five things it declined and why, including the two P11
  handed forward that turn out to be behaviour rather than styling (§4).
- **Does not move, rename or re-package a file** — beyond extracting `CallHistoryList.vue` out of a
  354-line component into the sibling position its HTTP twin already occupies. P12 §8 OQ-1 owns the
  package split and says it must land after this phase.
- **Does not touch Go, `packages/api-core`, `packages/shared`, or the bindings.**
- **Does not restyle Studio.** Studio files appear only to delete a rule the promoted class supplies
  (M1) or a helper the promoted function supplies (M8). One visible Studio change exists and is
  named: `StudioStart`'s `5 m ago` becomes `5m ago` (D13).
- **Does not draw an Api artboard in `docs/design/kira-design-system/`.** §9 OQ-5.
- **Does not fix P12's dead exports (F21/F22)** — dead code is P14's, not a styling pass's (§4).

---

## 9. Open questions

**OQ-1 — the undefined-token guard: a script, or stylelint?** D3 adds
`scripts/check-tokens.sh` (grep + comm, no dependency). A real stylelint plugin
(`stylelint-value-no-unknown-custom-properties`) would be more correct — it understands cascade and
fallbacks, which a grep does not — but stylelint is not in this repo's toolchain (biome is), and
adding a second CSS linter for one rule is a bigger decision than a phase like this should make
alone. The script's known blind spot: it cannot see a `var()` with a fallback
(`var(--x, red)`), which is legitimate. Recorded so whoever adds stylelint later knows the script is
meant to be replaced, not extended.

**OQ-2 — five local `height: var(--kira-h-sm)` overrides, or a `.p-select.sm`?** D4 chooses five
local overrides on `CellEditorView`'s precedent. Five is enough copies that a shared variant is
arguably right, and the counter-argument is only that this phase's whole thesis is *stop inventing
vocabulary inside this module*. If a sixth appears, `.p-select.sm` is correct and this decision
should be reversed rather than extended. Genuinely a judgement call, recorded as one.

**OQ-3 — the empty-state copy for the collections panel names the `+` glyph.** D6's *"Create one
from the + above"* refers to an `IconButton icon="add"` two rows up. A `<CodiconIcon name="add">`
inlined in the sentence would be unambiguous; a bold `+` is what Studio's own equivalent sentence
would do if it had one, and Studio's has no action reference at all. Weak preference for the text,
open to the icon.

**OQ-4 — `::before`-with-a-codepoint versus a real `<CodiconIcon>` in `<summary>`.** D9 prefers the
CSS route (no markup change in three files) but depends on the icon font's family name and two
codepoints being stable. The repo has no precedent for reaching into the codicon font from CSS —
every other icon goes through `CodiconIcon.vue`. If M6's verification is at all uncomfortable, take
the fallback; it is three extra elements and zero risk.

**OQ-5 — should the Api module get artboards in `docs/design/kira-design-system/`?** That canvas
covers sixteen Studio screens and is generated from `parts/`; the Api module has none, which is part
of why eleven phases each made their own calls. Adding `ApiRequest`/`ApiCollections`/`ApiGrpc`
bodies would be genuinely useful for whoever styles this module next — and is a design deliverable,
not a code one, sized like a phase of its own. Out of scope here; recorded as the structural reason
this phase was needed at all.

**OQ-6 — `'Format query'` in the palette now covers a JSON request message.** D15 declines to
reword it: three views share `view.format` and two of them really are queries. *'Format'* alone
would serve all three, and is a one-word Studio-copy change. Left for whoever is next allowed to
touch `shortcuts/state.ts`'s Studio half.

**OQ-7 — the timeline's phase colours are the connection palette.** `TimelinePane.vue:69-76` maps
DNS/Connect/TLS/Wait/Download onto `--kira-conn-violet/blue/teal/amber/green` and the residue onto
`--kira-conn-grey`. `docs/design/kira-design-system/README.md` is explicit that connection colour
*"appears as a rail … and a dot … **nowhere else**"*, and these five bars have nothing to do with a
connection. **This plan does not change them**, for two reasons: the palette is the only
evenly-spaced, equal-lightness five-hue set in the token file (its whole design goal —
`tokens.css:99-101`), and inventing `--kira-phase-*` tokens is exactly the "change a token value"
move §8 forbids. But it is a real design-system violation and the honest fix is a five-token
`--kira-chart-*` set aliased to the same hues, which would also serve any future chart. Flagged
rather than silently accepted; the alternative — leave it and note it in
`docs/ARCHITECTURE.md` — is the fallback if a reviewer disagrees.

**OQ-8 — four Api dialogs gaining a *Close* button makes the app 100% footer-bearing; is that
right?** D20 says yes on consistency grounds. The counter-argument is that a dismiss-only footer is
46px of chrome (`DialogFrame.vue:136-144`) carrying one redundant button, in a phase whose other
half is about density. The tiebreaker taken: a modal with no footer at all reads as unfinished next
to seven that have one, and ✕-only dismissal is the least discoverable of the four exits. Reversible
in one line each if disagreed with.

---

## 10. Sources

**Read in full at `c4dfba5`.** All 32 Api-mode `.vue` files (§1's inventory is the list), plus
`api/{menus.ts,tabs.ts,reveal.ts}`, `api/state/*.ts`, `views/httprequest/{state,history,files,
mergeEntry}.ts`, `views/grpcrequest/{state,history}.ts`.

**Design system and tokens:** `docs/design/kira-design-system/README.md`,
`docs/design/kira-design-system/parts/_style.css` (LAWs 01/07/12), `theme/tokens.css`,
`theme/primitives.css`, `theme/base.css`.

**Studio comparison surfaces, read to establish the conventions this module is checked against:**
`theme/primitives/{AppButton,IconButton,EmptyState,MessageStrip,DialogFrame,PanelShell,
SegmentedControl,TextField,ViewChrome,ViewHeader,PopoverPanel,TreeHost}.vue`;
`workbench/panels/{StudioStart,ProjectPanel,TabStrip,OperationsPanel}.vue`;
`workbench/{SettingsDialog,GenerateDataDialog,UploadObjectDialog,ConfirmDialog}.vue`;
`project/{ProjectTree,TreeRow,FiltersDialog,SchemaDialog,ConnectionDialog}.vue`;
`views/console/ConsoleView.vue`; `views/shared/EditBufferActions.vue`;
`views/shared/celleditor/{CellEditorView,timestamp}.ts|vue`; `views/definition/DefinitionView.vue`;
`state/{tabKinds,tabs}.ts`; `shortcuts/state.ts`; `format.ts`.

**Prior plans consulted:** `docs/v1.1/plans/P28-settings-panel-overhaul.md` (structure, the
`.p-textarea` promotion precedent D1/D2 follow), `P27-active-filter-indicator-color.md` and
`P24-connection-auth-error-display.md` (citation discipline), `P17-settings-apply-on-save.md` and
`P9-row-coloring-settings.md` (decision format). `docs/v1.2/plans/P11-grpc-support.md` (§6.5's two
handed-forward items, D14's Schema-pane reasoning, D15's caps) and
`P12-studio-api-modularization.md` (F21–F25, §8 OQ-1/OQ-3, D12's history-store factory).
`docs/v1.2/SPEC.md`'s P13 row and its Studio/Api module-boundary section. `AGENTS.md`'s
comment, unit-test-bar, library-first and implement-then-test-at-the-end rules drive §7 and §6.
