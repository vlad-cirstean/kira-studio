# P22b — the Api and Studio surface items, and the search sweep

> **What this phase is.** Part 2 of `docs/v1.2/SPEC.md`'s P22 row (see
> `plans/P22-shared-primitives-and-tokens.md` §0.1 for the split and its justification). This
> document owns every item that lives in one view: the Api request builder's own surfaces, the
> collections panel, the two protocol views, the Mongo copy formats, the SQL Format follow-up, and
> the app-wide search sweep.
>
> **It depends on part 1** and must land after it: D3 of that plan closes half of this row's gRPC
> item, and D8's shared completion-popup block is what several of the fields here render through.
>
> **Four more of the row's premises are corrected here** (§0.3), on top of part 1's five. As in
> `P19-connection-dialog-mongo-console-sql-tooling.md`, each was checked against the real source
> before any decision was written, and each correction changes what gets built.
>
> **Base commit.** `b52fd72` (branch `claude/feature-v1-2`). Every `file:line` points at it.

---

## 0. Scope

### 0.1 The items this document owns

| # | Item (SPEC row wording, abbreviated) | Findings | Decisions | Commits |
|---|---|---|---|---|
| K | The response status code's meaning shows only on hover — make it visible by default (re-check P15 §2 / P18 S9) | F1, F2 | D1 | U1 |
| L | Header **value** autocomplete: canned values for `Content-Type` &c., prefixes for `Authorization` | F3, F4 | D2 | U2, U3 |
| M | The request builder's Save button is right-aligned | F5 | D3 | U4 |
| N | `{{variable}}` gets a clear resolves/does-not-resolve colour, a value on hover, and name autocomplete (re-check P15b) | F6, F7, F8 | D4, D5 | U5, U6 |
| O | Every configurable row — headers, params, form-data, and whatever else — gains a Description field (P17's own shape) | F9, F10 | D6, D7 | U7, U8, U9 |
| P | Environments become a collapsible category at the bottom of the collections tree; clicking one opens a tab (re-check P17 N4) | F11, F12 | D8 | U10 |
| Q | The variables/environments views get a layout pass — "all over the place", inputs not filling width | F13 | D9 | U11 |
| R | gRPC: the method select is too short beside the address field; the Call button's label is invisible grey | F14 | D10 | U12 |
| S | Mongo: add Shell Mode and Canonical Extended JSON as selectable copy formats | F15, F16 | D11 | U13, U14 |
| T | The SQL Format button is reported broken again — re-investigate against the real current tree | F17-F20 | D12, D13 | U15, U16 |
| U | A search affordance on the Api request panel, then a sweep of every panel that could support one | F21, F22 | D14, D15 | U17-U20 |
| V | Adding a row to a row-insertable table does not scroll the new row into view | F23, F24, F25 | D16, D17 | U21, U22 |

### 0.2 Files this document touches

**Api / protocol views** — `views/httprequest/{ResponsePane,ResponseHistoryList,TimelinePane,
ResponseDiffDialog,RequestHeadersTable,QueryParamsTable,UrlEncodedTable,FormDataTable,
FieldRowsTable,RequestBodyPane,HttpRequestView}.vue`,
`views/grpcrequest/{GrpcRequestView,MetadataTable,ResponsePane,CallHistoryList}.vue`.

**Api module** — `api/{CollectionsPanel,CollectionsTree,CollectionRow,VariableSetView,
VariableRow,VariablesOverviewPanel,EnvironmentsDialog}.vue`, `api/state/{collections,variables}.ts`,
`api/tabs.ts`.

**Studio** — `views/grid/{SlickGridHost.vue,DataToolbar.vue}`, `views/documents/{DocumentView.vue,menu.ts}`, `views/console/{ConsoleView.vue,
resultMenu.ts,format.ts}`, `views/definition/DefinitionView.vue`, `views/browse/BrowseView.vue`,
`views/shared/celleditor/CellEditorView.vue`, `views/shared/document/ejson.ts`,
`workbench/panels/OperationsPanel.vue`.

**Shared / wire / Go** — `packages/shared/domain/{http,grpc}.ts`, `packages/api-core/src/http/
headers.ts`, `packages/api-core/src/postman/*`, `internal/storage/model/{collections,grpc}.go`,
`internal/postman/*`.

### 0.3 Corrections this investigation makes to the SPEC row's own premises

1. **"the response status code's meaning currently shows only on hover" — it has not been
   hover-only since P15, in either protocol** (F1). `views/httprequest/ResponsePane.vue:135-138`
   carries P15 D11's own comment — *"the hint is always shown inline, not tooltip-only … `v-tooltip`
   still carries the full sentence"* — and renders `<div v-if="hint" class="p-sm muted status-hint"
   data-testid="http-status-hint">` on its own line (`:322`); the tooltip on the chip was removed
   outright in commit `37716b1 fix(api): a status code's meaning gets its own line, and loses its
   tooltip`. gRPC's equivalent is `views/grpcrequest/ResponsePane.vue:109-110`/`:201`, added by P18
   D13. `statusHint`/`grpcCodeHint` return a non-empty sentence for **every** code
   (`packages/shared/domain/http.ts:377-386`). **What is genuinely still bare is every *secondary*
   status surface** — the history list, the timeline hops and the diff dialog each render a bare
   `<span class="p-chip">{{ status }} {{ statusText }}</span>` with no meaning and no tooltip (F2).
   D1 fixes that instead.
2. **"the Environments list becomes its own collapsible category … and clicking an environment
   opens it in a new tab (re-check P17 N4, which already made environment editing open as a tab)" —
   the tab half is correct and already shipped; the *entry point* is a modal dialog, not the tree**
   (F11). `api/CollectionsPanel.vue:139-147` puts Environments behind a `settings-gear`
   `IconButton` that opens `EnvironmentsDialog`, whose own row click calls `openVariableSetTab
   ('environment', …)` (`EnvironmentsDialog.vue:88-91`). So this item is purely about moving the
   *list* out of a dialog into the panel; nothing about the editor surface changes, and D8 says so.
3. **"the console/collection 'copy' action only emits plain JSON" — it already emits two of the
   three formats the row asks for** (F15). `views/documents/menu.ts:72-90` has *Copy document*
   (shell form — `ObjectId(…)`/`ISODate(…)`, P27 D12) **and** *Copy as JSON* (canonical extended
   JSON, P19 D6, i.e. `{"$oid": …}`), and `views/console/resultMenu.ts:221-231` has the same pair
   for a console document result. What is missing is not the formats but **their presentation**:
   neither is labelled with the name the row uses, they are two flat sibling items rather than the
   `Copy row(s) ▸ TSV / CSV / JSON` submenu the SQL grid already uses (`resultMenu.ts:116-140`), and
   the *multi-document* action offers only one of them (`:228`, `Copy all as JSON`). D11 makes the
   set explicit and symmetric rather than adding encoders that exist.
4. **"the SQL Format button is reported broken again … since behaviour may have shifted" — the
   three causes P19 diagnosed are all still fixed, and the mechanism is intact; one *new*, genuine
   defect was introduced by P19's own D13** (F17-F19). `formatConsoleText` rejoins statements with
   `out.join(';\n\n')` (`views/console/format.ts:198`) while `splitSqlStatements` excludes the
   terminator from `stmt.text` (`packages/shared/domain/sql-split.ts:35-38`) — so **the document's
   final semicolon is silently deleted on every press**, and P13's whole-document `formatDialect`
   call never did that. Combined with `keywordCase: 'preserve'` (P13 D4, still correct), the most
   common single-statement press either destroys a `;` or reports "Already formatted." — both of
   which read as a broken button. D12 fixes the terminator; D13 addresses the second.

### 0.4 Not in scope

- Every shared-primitive item — `plans/P22-shared-primitives-and-tokens.md`.
- Schema-driven table/column completion — `plans/P22c-schema-aware-completion.md`.
- **The gRPC Call button's contrast**, which is a `.p-btn:disabled` defect affecting ten call sites
  and is closed by part 1's D3. Item R here is reduced to the method-select width (D10).
- **Reversing `keywordCase: 'preserve'`.** P13 D4/F6's ClickHouse identifier hazard is real and
  unchanged; D13 makes the resulting no-op legible, exactly as P19 D13 already did for the
  byte-identical case.
- **A description field on the *response* headers pane.** It is a read-only view of what a server
  sent; there is nothing configurable to describe.

---

## 1. Findings

### F1 — Both response panes already show the code's meaning on their own line (item K)

`views/httprequest/ResponsePane.vue`:

```ts
// D11: the hint is always shown inline, not tooltip-only — the case that matters (4xx/5xx) is
// exactly the case where the user should not have to discover a hover.                    (:135-137)
const hint = computed(() => (response.value ? statusHint(response.value.status) : ''));   // :138
```
```html
<span class="p-chip" :class="statusClass(response.status)" data-testid="http-status">   <!-- :274 -->
  {{ response.status }} {{ response.statusText }}
</span>
…
<div v-if="hint" class="p-sm muted status-hint" data-testid="http-status-hint">{{ hint }}</div>  <!-- :322 -->
```

There is no `v-tooltip` on that chip. `views/grpcrequest/ResponsePane.vue:198-201` is the exact
sibling, with `data-testid="grpc-status-hint"` and the server's own `statusMessage` on a second line
below it (`:202`). `statusHint` never returns `''` for a real status
(`packages/shared/domain/http.ts:377-386`: a table lookup, then a per-class fallback sentence, then
`'unrecognised status code'`), and `.status-hint` is `--kira-fg-muted` (`#9d9d9d`, 4.5 : 1 on
`--kira-bg`), i.e. muted but not disabled-grey. `response` is the same object whether the pane is
showing a live response or a history entry (`:66-67`), so the hint is present in both.

### F2 — Four secondary status surfaces show a bare code (item K)

| Surface | Markup | Has meaning? |
|---|---|---|
| `views/httprequest/ResponseHistoryList.vue:171` | `<span class="p-chip" :class="statusClass(entry.status)">{{ entry.status }} {{ entry.statusText }}</span>` | no, and no tooltip |
| `views/httprequest/TimelinePane.vue:238-240` | same shape, per redirect hop | no |
| `views/httprequest/ResponseDiffDialog.vue:217-231` | same shape, twice | no |
| `views/grpcrequest/CallHistoryList.vue` | the code name per row | no |

Each is a dense list row where a full sentence would not fit — which is exactly the case P15 D11's
own comment reserved the tooltip for (*"the full sentence for when the caption itself is truncated
by the row's width"*), and then the tooltip was removed from the one place it was not needed while
never being added to the four places it was.

### F3 — Header **name** completion exists; there is no value vocabulary anywhere (item L)

`views/httprequest/RequestHeadersTable.vue:38` passes `:name-candidates="WELL_KNOWN_REQUEST_HEADERS"`
into `FieldRowsTable`, which renders the name cell as an `AutocompleteField` over that list with
`wholeFieldToken` (`FieldRowsTable.vue:195`, and `:38-42`'s comment explaining why the default word
tokenizer would produce `Content-Content-Type`). The vocabulary lives in
`packages/api-core/src/http/headers.ts` as `WELL_KNOWN_REQUEST_HEADERS: readonly HeaderCompletion[]`
— `{label, insert?, detail?, icon?}`, structurally identical to `theme/primitives/completion.ts`'s
`Completion` and deliberately declared independently because `packages/api-core` may not import from
`apps/**` (`headers.ts:5-13`).

The **value** cell (`FieldRowsTable.vue:216-226`) is an `AutocompleteField` whose `:candidates` is
`valueVariableSupport.candidates` — the `{{variable}}` list and nothing else. `grep` finds no
per-header value list anywhere in `packages/` or `apps/`.

### F4 — Two shapes of value vocabulary are needed, not one (item L)

The row asks for *"full canned values for headers like `Content-Type`, and a prefix-only vocabulary
(`Bearer`, `Basic`, `Digest`, …) for `Authorization`"* — which is a real distinction, not a wording
nicety:

- A **whole-value** vocabulary (`Content-Type: application/json`) replaces the field. `FieldRowsTable`
  already has the right tokenizer for that: `wholeFieldToken`, the one the name cell uses.
- A **prefix** vocabulary (`Authorization: Bearer <token>`) must insert `Bearer ` and leave the caret
  after it, then get out of the way so the `{{variable}}` source can complete the token. `Completion`
  already carries `insert` and `caretOffsetFromEnd` for exactly this
  (`theme/primitives/completion.ts`; `views/shared/mongoVocabulary.ts`'s BSON constructors are the
  existing consumer of that pair).

So one map with two entry kinds, and a value cell whose candidate list is a **function of the row's
own name**, not a constant.

### F5 — Save is in `#badges`, which renders before the push (item M)

`theme/primitives/ViewHeader.vue:41-49`:

```html
<span class="p-view-target" …>…</span>
<slot />                                                    <!-- ViewChrome's #badges -->
<span class="p-push" style="display:flex; align-items:center; gap: var(--kira-s-2)">
  <slot name="trailing" />                                  <!-- ViewChrome's #head-trailing -->
</span>
```

`views/httprequest/HttpRequestView.vue:287-311` puts the method chip, the dirty mark, the unresolved
chip **and the Save `AppButton`** in `#badges`; `views/grpcrequest/GrpcRequestView.vue:252-275` does
the same. So Save renders immediately after the request's own name, mid-row, and its horizontal
position moves whenever the title, the dirty mark or the unresolved chip changes width.
`#head-trailing` — the slot inside `.p-push` — is **empty in both views**. The affordance the item
asks for already exists and is simply unused.

### F6 — P15b's variable machinery is complete, and is wired into every field except the body editors (item N)

`api/state/variableCompletion.ts` exports a `VariableSupport` with all three members
(`:93-101`): `rangeHighlights` (colour), `hoverAt` (the value, the scope, the pipeline), and
`candidates` (names, then `fake.` names, then `$` aliases, and transforms after a `|`). Wiring, by
grep:

| Surface | `range-highlights` | `hover-at` | `candidates` |
|---|---|---|---|
| HTTP URL field (`HttpRequestView.vue:325-328`) | ✅ | ✅ | ✅ |
| header/param/urlencoded value cells (`FieldRowsTable.vue:220-223`) | ✅ | ✅ | ✅ |
| form-data value cells (`FormDataTable.vue:97-100`) | ✅ | ✅ | ✅ |
| gRPC target (`GrpcRequestView.vue:291-294`) | ✅ | ✅ | ✅ |
| gRPC metadata value cells (`MetadataTable.vue:166-169`) | ✅ | ✅ | ✅ |
| **HTTP request body — `raw`** (`RequestBodyPane.vue:148-155`) | ✅ | ❌ | ❌ |
| **HTTP request body — `code`/JSON** (`RequestBodyPane.vue:156-164`) | ✅ | ❌ | ❌ |
| **gRPC message editor** (`GrpcRequestView.vue:368-377`) | ✅ | ❌ | ❌ |

`CodeMirrorHost.vue` has the seams for both — `hoverSource` (`:60`, `:211-213`) and
`completionSources` (`:51`, `:178`) — and `RequestBodyPane.vue:31-34`'s own prop comment scopes
itself to colouring only (*"rangeHighlights colours both editable editor hosts below … the rest is
forwarded to the urlencoded/form-data value cells"*). So in the **request body — the single largest
place a user writes `{{variables}}`** — hovering one shows nothing and typing `{{` offers nothing.
That is two-thirds of the reported item, and it is real.

### F7 — A "resolves" reference is painted the same colour as an ordinary JSON key (item N)

`editor/theme.ts:124-141` (P15b D2):

```
.cm-kira-var          → color: var(--kira-syntax-name)                     /* resolved, and a catalogued dynamic */
.cm-kira-var-secret   → var(--kira-syntax-name) + underline dotted meta    /* a secret, resolved at send */
.cm-kira-var-unknown  → var(--kira-warn) + underline wavy warn             /* not defined */
```

and `theme/tokens.css:152-153`:

```css
--kira-syntax-name: #9cdcfe;
--kira-syntax-property: #9cdcfe;      /* the same value */
```

`editor/theme.ts:166-167` maps `tags.propertyName` → `--kira-syntax-property` and
`tags.variableName` → `--kira-syntax-name`. **In a JSON body — `bodyMode: 'code'`,
`codeLanguage: 'json'`, the app's default and the mode `RequestBodyPane` promotes to its own segment
— a resolved `{{token}}` is painted in exactly the same `#9cdcfe` as every JSON key around it.**
There is no "this resolves" cue at all in the surface where it matters most: only a *failure* has a
colour of its own.

The user's words — *"a clear correct/incorrect binary"* — describe precisely that gap. P15b D2's own
constraint was *"no new tokens (P13's 'does not change a value in tokens.css') — reuses the syntax
name colour and the app's existing warn colour"*, which is why it landed this way; two phases later
the cost of that constraint is the report.

### F8 — `--kira-warn` is doing four jobs, and part 1's D9 does not add a fifth (item N)

`--kira-warn` (`#cca700`) is simultaneously: the warning tone, `--kira-search-match` and
`--kira-search-match-current` (`tokens.css:30-31`), the unresolved-variable colour
(`editor/theme.ts:139`), and the "editing" chip. So an unresolved `{{name}}` inside a body that also
has a find bar open is painted the same colour as a search hit. Part 1's D9 moves
`--kira-state-on` to `#e0a33c`, a *different* amber (44° from `--kira-warn`, F16 of that plan), so it
does not add to this pile — but it does mean the "unresolved" colour is now the only warm colour in
the editor that is not a state indicator, which D4 takes into account.

### F9 — P17's Description is the exact shape to copy, on both sides of the wire (item O)

`internal/storage/model/variables.go:16-25` and `:32-42` carry `Description string
\`json:"description"\`` with the comment *"Description is P17 D14 — app-local free text, no wire
counterpart"*, and `storage/migrations/0011_p17_variable_description.sql` is the single-column
migration that introduced it. So: a plain string, defaulted, never sent, with a migration of exactly
one `ALTER TABLE`.

The row-shaped configurable fields, and where each is defined:

| Row | Tab-state schema | Saved-request schema (Go) | Wire type |
|---|---|---|---|
| HTTP header | `httpHeaderSchema` (`packages/shared/domain/http.ts:183-188`) | `model.SavedHeader` (`collections.go:83-87`) | `httpclient.Header` (`client.go:60`) |
| urlencoded field | `httpUrlEncodedFieldSchema` | `model.SavedField` (`collections.go:90-94`) | `HttpFieldWire` |
| form-data field | `httpFormDataFieldSchema` | `model.SavedFormField` (`collections.go:98-108`) | multipart part |
| gRPC metadata row | `grpcMetaRowSchema` (`domain/grpc.ts`) | `model.SavedGrpcMetaRow` (`grpc.go:24-32`) | metadata pair |
| **query param** | **none — there is no `params` array** | — | — |

### F10 — Query params have nowhere to store a description, by design (item O)

`packages/shared/domain/http.ts:290-292`: *"There is deliberately no `params` array: the URL is the
single source of truth for the query string (D9), and the Params table is a derived editor over
it."* `views/httprequest/QueryParamsTable.vue:9-12` and `:22` restate it — `pairs` is a pure
`computed` over `parseQuery(splitUrl(tab.state.url).query)`, and an edit rewrites the URL.

So a per-param description cannot live on the row: the row does not exist between keystrokes. This
is the one place the row's *"every configurable row"* runs into a real structural constraint, and
D7 is the explicit decision about it rather than a silent omission.

### F11 — Environments are behind a gear icon and a modal, and the tab already works (item P)

`api/CollectionsPanel.vue:106-158`: a `PanelShell` whose `#actions` carries four icon buttons, the
last of which is `settings-gear` → `onEnvironments()` → `ApiDialogs`' `EnvironmentsDialog`; and
whose `#body` is `<ImportReportStrip /> <CollectionsTree class="tree-body" />` — one tree, no
categories.

`api/EnvironmentsDialog.vue:88-91` calls `openVariableSetTab('environment', id, name)`, i.e. P17 N4
is genuinely done. `api/CollectionsTree.vue:94` shows the same call already reachable from a
collection row's own context menu for collection variables
(`variables: (row) => openVariableSetTab('collection', row.id, row.name)`).

### F12 — There is no collapsible-category primitive in the panel today (item P)

`PanelShell.vue`'s `#body` is one slot; `CollectionsTree.vue` is a flat `TreeHost` over
`collectionsState`. The nearest existing idiom for "a titled, collapsible section inside a panel" is
`views/definition/DefinitionView.vue`'s section components and `primitives.css:964-982`'s
`.p-panel-head`-derived section-title rule (*"section title adopts .p-panel-head's own idiom
(uppercase/muted/t-sm/letter-spacing)"*). So D8 has a vocabulary to reuse, and does not need a new
primitive — but it does need to decide where the two categories' heights come from.

### F13 — What is actually "all over the place" in the variable views (item Q)

Read against `api/VariableSetView.vue`, `api/VariableRow.vue` and `api/VariablesOverviewPanel.vue`:

- `VariableSetView` is a `ViewChrome` consumer with a `PanelSearchBox`, an add button, and a list of
  `VariableRow`s. Each row is a flex line of: drag handle, enabled checkbox, name field, value
  field, description field, secret toggle, history menu, delete. Nothing in the row declares a
  **shared column grid** — each field is an independent flex item with its own `flex` value, so the
  name/value/description columns of adjacent rows do not align when one row's controls differ (a
  secret row renders a reveal affordance the others do not).
- The same is true of `FieldRowsTable`'s rows in the request builder, which is the surface D6 is
  about to add a fourth column to — so the two problems are one problem, and fixing the alignment
  before adding a column is the cheaper order.
- `VariablesOverviewPanel` is a popover list with its own row markup again, a third copy.

So item Q is: **one row grid, three consumers**, plus the "inputs not filling available width"
complaint, which is the `inheritAttrs: false` trap `GrpcRequestView.vue:280-286` already documents
in full (a `style="flex:1"` on a `TextField`/`AutocompleteField` lands on the inner `<input>`, which
is already `flex: 1`, and never on the `.p-input` box that sizes it — the fix is a wrapper plus
`:deep(.p-input) { width: 100% }`, the idiom "used at ten other call sites").

### F14 — The gRPC method select has no width at all; the Call button's problem is elsewhere (item R)

`views/grpcrequest/GrpcRequestView.vue:279-324`, the `#toolbar` slot in order: a
`.grpc-target-field` wrapper around the address `AutocompleteField` (the wrapper exists precisely
because of F13's `inheritAttrs` trap, and its own comment says so, `:280-286`); a `SegmentedControl`
for TLS; then

```html
<select class="p-select bordered" data-testid="grpc-method-select" …>
  <option value="" disabled>Choose a method…</option>
  …
</select>
```

with **no wrapper and no width rule anywhere** — so it shrinks to its widest `<option>` label,
which for a service with short method names is a fraction of the address field beside it. That is
the item, exactly as reported.

The Call button (`:315-324`) is `<AppButton icon="play" variant="primary" :disabled="running ||
!tab.state.service || !tab.state.method">`. `variant` **is** the correct prop name
(`AppButton.vue:11`), so `.p-btn.primary` does apply — the invisible label is
`.p-btn:disabled`'s cascade defect, which part 1 F5 measures at 1.13 : 1 and part 1 D3 fixes for all
ten `variant="primary"` call sites. gRPC is where it is visible because its Call button is disabled
*from the moment a tab opens* (no service, no method) while HTTP's Send is disabled only while a
request is in flight. **Nothing about this half is a gRPC change.**

### F15 — The Mongo copy formats already exist; their presentation does not (item S)

`views/documents/menu.ts:72-90`, the collection view's row menu:

```ts
{ id: 'copy-document', label: 'Copy document',   run: () => copyOrReportError(tabId, toShellText(body)) },
{ id: 'copy-as-json',  label: 'Copy as JSON',    run: () => copyOrReportError(tabId, prettyJson(body)) },
{ id: 'copy-id',       label: 'Copy _id',        run: () => copyOrReportError(tabId, parseIdLabel(id).text) },
```

with `:76-78` recording that *Copy document* is deliberately **the shell form**
(`ObjectId(…)`, P27 D12) and `:83-85` that *Copy as JSON* is deliberately **canonical extended
JSON** (`{"$oid": …}`, P19 D6, taken verbatim from the body since `views/shared/document/ejson.ts:1-4`
already parses that exact encoding). `views/console/resultMenu.ts:221-231` mirrors the pair for a
console document result, plus `Copy all as JSON` (`:228`).

So the row's *"only emits plain JSON"* is wrong: both requested formats ship. What does not:

1. Neither is **named** as the format it is — a user reading "Copy document" cannot know it is
   `mongosh` syntax, and "Copy as JSON" does not say *canonical extended*.
2. They are **flat siblings**, while the SQL grid — three files away, in the same app — puts its
   own format choice behind a submenu: `Copy row(s) ▸ TSV / CSV / JSON` (`resultMenu.ts:116-140`,
   D9 of P19).
3. The **multi-document** action offers only one of the two (`Copy all as JSON`, `:228`), so a
   `find()` result cannot be copied as shell text at all.

### F16 — `toShellText` is already the whole shell encoder, and it round-trips (item S)

`views/shared/document/ejson.ts:328` exports `toShellText(body: string): string` — the conversion
away from canonical extended JSON — and `:521` `tryParseShellText` is its inverse, already used by
`saveDocumentEdit`/`parseDocumentLiteral` to accept the shell form back. `:601`
`beautifyShellText(text, mode)` is the pretty-printer. So D11 composes existing functions; it writes
no encoder.

### F17 — Format's mechanism is intact; P19's three causes are all still fixed (item T)

Checked one by one against the current tree:

| P19's cause | Its fix | Still present at `b52fd72`? |
|---|---|---|
| all-or-nothing across the document (P19 F18) | per-statement formatting, failures emitted verbatim | ✅ `format.ts:180-198` |
| caret jumps to offset 0, re-pointing *Run statement* (P13 OQ-2) | `keepSelectionOnExternalSync` + `setCursor` + index mapping | ✅ `ConsoleView.vue:347-370` and `:711` |
| a byte-identical result says nothing (P19 F19) | an `Already formatted.` note strip | ✅ `ConsoleView.vue:381-390` |

And the plumbing: `canFormat` gates on `canFormatConsole(connectionKind)` (`ConsoleView.vue:171`);
the button is `:disabled="!tab.state.text.trim()"` (`:566`); `registerCommand('view.format',
onFormat)` (`:447`) is unambiguous because `MainView.vue:13` mounts exactly one view at a time.
Nothing here is broken.

### F18 — Format deletes the document's final semicolon, every time (item T)

`packages/shared/domain/sql-split.ts:35-38`:

```ts
const pushIfNonEmpty = (end: number): void => {
  const text = source.slice(stmtStart, end).trim();   // `end` is the index OF the ';'
  if (text.length > 0) statements.push({ text, start: stmtStart, end });
};
```

so `stmt.text` never contains its terminator. `views/console/format.ts:198`:

```ts
return { text: out.join(';\n\n'), ok: true, failures };
```

`join` puts a `;` **between** statements and none after the last. So:

- `select 1;` → one statement → `join` emits `SELECT\n  1` — **the `;` is gone**.
- `select 1; select 2;` → `SELECT 1;\n\nSELECT 2` — the trailing `;` is gone.
- P13's whole-document `formatDialect(text, {linesBetweenQueries: 1})` preserved every `;` it was
  given, so this is a regression introduced by P19 D13 and not present before it.

A user who writes `select * from t;`, presses Format, and watches their semicolon disappear is
reporting a broken Format button, and is right to.

### F19 — With `keywordCase: 'preserve'`, the *only* other visible effect is whitespace (item T)

`format.ts:47-58` keeps `keywordCase: 'preserve'` and `identifierCase: 'preserve'` for P13 D4/F6's
ClickHouse reason (an `'upper'` pass rewrites an unquoted identifier that collides with a keyword).
Correct, and not reopened here. But it means a user pressing Format on an already-tidy statement
sees **only** F18's semicolon vanish, and pressing it a second time gets `Already formatted.` — a
sequence that reads, end to end, as "this button damages my query and then tells me it did nothing".

### F20 — Two smaller Format facts, checked and excluded (item T)

- **Mongo goes through the SQL splitter.** `formatConsoleText` calls `splitSqlStatements`
  regardless of kind (`format.ts:167-170`), with `sqlDialectFor('mongodb')` → `undefined` →
  `backslashEscapes`/`dollarQuoting` at their permissive defaults. It handles `'`/`"` runs, so a
  filter string containing `;` is safe; it does **not** understand `//` line comments, which Mongo
  allows. Narrow enough not to be the reported problem, but recorded so it is not rediscovered:
  OQ-4.
- **`splitOptionsFor(dialect)` in `ConsoleView.onFormat:350` and `format.ts:167-170`'s own options
  are computed from the same two helpers** (`backslashEscapesFor`, `dollarQuotingFor` over
  `sqlDialectFor(kind)`), so `before.length` and the formatter's own statement count cannot
  disagree, and D12 of P19's index mapping stays exact. Checked, not a defect.

### F21 — Search is far more widely deployed than the row assumes; four real gaps remain (item U)

`PanelSearchBox` / `PanelShell`'s toggle is already in: the project panel and the collections panel
(via `PanelShell.vue:73-90`), the HTTP request tables (`HttpRequestView.vue:370-377`), the HTTP
response body/raw find bar (`ResponsePane.vue:296-305`), the HTTP response headers filter, the HTTP
history list (`ResponseHistoryList.vue:145`), the gRPC metadata table
(`GrpcRequestView.vue:341-348`), the gRPC schema browser (`SchemaBrowser.vue:190`), the SQL grid
(`DataToolbar.vue:207`), the console (`ConsoleView.vue:624`), the key-value view, the stream view,
the document view, the environments dialog, the variables overview, the variable-set view and the
dynamic-values dialog.

**So "add a search affordance to the Api request panel" is already done** (`HttpRequestView.vue:372`,
P16 D13), and **"gRPC is named as a known gap" is only half right** — gRPC's *metadata table* and
*schema browser* both have one. Grepping every view for `icon="search"` / `PanelSearchBox` /
`SearchToolbar` leaves these with none:

| Surface | What it is | Why it wants one |
|---|---|---|
| `views/grpcrequest/ResponsePane.vue` | the response message list | HTTP's own response pane has find-in-body (P16 D11); the gRPC sibling does not — **this is the gRPC gap the row means** |
| `views/grpcrequest/CallHistoryList.vue` | the call history list | HTTP's `ResponseHistoryList` has one (`:145`); its gRPC sibling does not |
| `views/definition/DefinitionView.vue` | a whole DDL document plus columns/indexes/constraints sections | the single largest searchable document in Studio |
| `workbench/panels/OperationsPanel.vue` | the op log | a long append-only list |
| `views/shared/celleditor/CellEditorView.vue` | one cell's full value, often a large JSON blob | the console's own result cells land here |

### F22 — One surface has a search that is *not* the shared component (item U)

`views/browse/BrowseView.vue:68-83`, `:169` — an always-visible `.filter-field` with its own
`filterText` computed over `rt.filter`, its own `filteredNodes`, and its own `N of M` caption. It
predates `PanelSearchBox`'s toggle idiom and is the one place in the app where "search" looks
different from everywhere else. The row's *"matching whatever the app's one shared search component
already is"* applies to it directly.

---

## 2. Decisions

### D1 — The four secondary status surfaces gain the meaning as a tooltip (item K, F1, F2)

The two response panes are **unchanged** — they already satisfy the item (F1), and adding a tooltip
back to the chip would undo `37716b1` for no gain.

Each surface in F2's table gets `v-tooltip="statusHint(entry.status)"` (or `grpcCodeHint(entry.code)`
for the gRPC history list) on its existing chip. Nothing else changes: no new line, no layout shift
in a dense list row. This is what P15 D11's own comment reserved a tooltip for, applied where the
caption genuinely has no room.

`grpcCodeHint` lives in `packages/shared/domain/grpc.ts:152` and `statusHint` in
`domain/http.ts:377`; both are already imported by their protocol's own history list for
`statusClass`/`grpcCodeClass`, so this adds no import graph edges.

### D2 — A header-value vocabulary keyed by header name, with two entry kinds (item L, F3, F4)

**`packages/api-core/src/http/headers.ts`** gains, beside `WELL_KNOWN_REQUEST_HEADERS`:

```ts
/** P22b D2: the value vocabulary, keyed by the header's own canonical name (lookup case-folds, so
 *  a user's `content-type` matches). Two entry kinds, distinguished by `insert`:
 *   - a complete value (`application/json`) — accepting it replaces the field;
 *   - a prefix (`Bearer `, with caretOffsetFromEnd 0) — accepting it leaves the caret after the
 *     space so the {{variable}} source takes over for the credential itself.
 *  `Completion`-shaped (HeaderCompletion), for the same api-core-may-not-import-apps reason
 *  WELL_KNOWN_REQUEST_HEADERS is. */
export function headerValueCompletions(name: string): readonly HeaderCompletion[];
```

Contents, chosen as "what a person types into a request builder", the same editorial rule
`WELL_KNOWN_REQUEST_HEADERS`'s own doc comment states:

| Header | Kind | Entries |
|---|---|---|
| `Content-Type` | complete | `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, `text/html`, `application/xml`, `text/xml`, `application/octet-stream`, `application/graphql-response+json`, `text/csv`, `application/pdf` |
| `Accept` | complete | the above plus `*/*`, `application/json, text/plain, */*` |
| `Accept-Encoding` | complete | `gzip, deflate, br`, `gzip`, `identity` |
| `Accept-Language` | complete | `en-US,en;q=0.9`, `*` |
| `Cache-Control` | complete | `no-cache`, `no-store`, `max-age=0`, `must-revalidate` |
| `Connection` | complete | `keep-alive`, `close` |
| `Content-Encoding` / `Transfer-Encoding` | complete | `gzip`, `deflate`, `br` / `chunked` |
| `X-Requested-With` | complete | `XMLHttpRequest` |
| `Authorization` | **prefix** | `Bearer `, `Basic `, `Digest `, `Token `, `ApiKey ` |
| `Prefer` | complete | `return=representation`, `return=minimal` |

**`FieldRowsTable.vue`** gains one prop:

```ts
/** P22b D2: the value cell's own vocabulary as a function of this row's name — composed with, not
 *  replacing, valueVariableSupport.candidates (a header value is very often `Bearer {{token}}`,
 *  which needs both lists live at once). Absent for every caller but the headers table and the
 *  gRPC metadata table. */
valueCandidatesFor?: (rowName: string) => readonly Completion[];
```

and the value cell's `:candidates` becomes a per-row computed that returns
`[...valueCandidatesFor(row.name), ...valueVariableSupport.candidates]` when the caret is **not**
inside a `{{…}}` token, and `valueVariableSupport.candidates` alone when it is — decided with
`templateToken`, which `FieldRowsTable` already imports (`:7`) and which already tells the field
where the current token starts. A header-name-specific list is offered at a bare position; the
variable list wins inside a reference. This is the same "position decides the list" rule
`variableCompletion.ts`'s own `isAfterPipe` (`:103-109`) already applies.

**Call sites:** `RequestHeadersTable.vue` passes `headerValueCompletions`;
`views/grpcrequest/MetadataTable.vue` passes a gRPC-specific one covering the two metadata keys with
real vocabularies (`authorization` → the same prefixes, lower-cased; `grpc-accept-encoding` →
`identity`, `gzip`), since `MetadataTable.vue:155` already carries
`WELL_KNOWN_REQUEST_METADATA` for names and this is its value sibling. Params/urlencoded/form-data
pass nothing and are unchanged.

### D3 — Save moves to `#head-trailing` in both protocol views (item M, F5)

`HttpRequestView.vue` and `GrpcRequestView.vue` each move their Save `AppButton` out of `#badges`
into a new `<template #head-trailing>`. The method chip, the dirty mark and the unresolved chip stay
in `#badges` — they are badges, which is what the slot is for, and P15 D7's own comment
(`HttpRequestView.vue:301-302`: *"the first control ever placed in a view head — LAW 09's 'the head
names the target' holds everywhere else"*) is updated to record that the control has now moved to
the slot the header already reserved for exactly this.

Both `data-testid="http-save"` / `"grpc-save"` and both `:disabled`/`v-tooltip` expressions are
carried across verbatim, so every existing spec keeps passing.

### D4 — "Resolves" gets a colour of its own, and the binary becomes legible (item N, F7, F8)

`theme/tokens.css` gains one token, beside `--kira-state-on`:

```css
/* P22b D4: "this {{reference}} will produce a value". P15b D2 painted it --kira-syntax-name under
   a no-new-tokens constraint; --kira-syntax-name is byte-identical to --kira-syntax-property
   (#9cdcfe), so in a JSON body — the default body mode — a resolved reference was indistinguishable
   from the keys around it and only a FAILURE had a colour. #4ec9b0 is the hue P19 D17 measured as
   free of every syntax token and every state colour; it is available again now that P22 D9 has
   moved --kira-state-on to gold. */
--kira-var-resolved: #4ec9b0;
```

`editor/theme.ts:124-141` becomes:

| Class | Was | Becomes |
|---|---|---|
| `.cm-kira-var` (resolved, catalogued dynamic) | `--kira-syntax-name` | `--kira-var-resolved` |
| `.cm-kira-var-secret` | `--kira-syntax-name` + dotted `--kira-syntax-meta` | `--kira-var-resolved` + dotted `--kira-syntax-meta` (unchanged shape — a secret *does* resolve) |
| `.cm-kira-var-unknown` | `--kira-warn` + wavy `--kira-warn` | **unchanged** |

Two properties this buys:

- The **binary the row asks for**: teal = will produce a value, amber-wavy = will not. Nothing else
  in an editor paints teal (P19 F29's measurement, re-checked: `--kira-state-on` has vacated it and
  no `kiraHighlightStyle` tag uses it).
- **No collision with the search highlight.** F8's pile-up on `--kira-warn` is unchanged for
  "unresolved", which is correct — an unresolved reference genuinely is a warning — while the
  *resolved* case, which is the common one, moves off the syntax palette entirely.

`--kira-state-on`'s own comment gains a back-reference so the two amber/teal swaps are legible as one
decision rather than two coincidences.

*Alternative considered and rejected:* a background chip behind each reference. It is the strongest
possible cue and it is unusable in practice — a body full of `{{…}}` becomes a wall of pills, and
`RangeHighlight` is a `Decoration.mark` (`editor/variableHighlight.ts:31`), i.e. an inline span,
which cannot carry a chip's padding without shifting the character grid the `AutocompleteField`
overlay depends on (`AutocompleteField.vue:496-501`'s own alignment note).

### D5 — The three body editors get the hover and the completion they never had (item N, F6)

`RequestBodyPane.vue`'s two `CodeMirrorHost`s and `GrpcRequestView.vue`'s message editor each gain:

```html
:hover-source="variables ? variableHoverSource(variables.hoverAt) : undefined"
:completion-sources="variables ? [variableCompletionSource(variables.candidates)] : undefined"
```

Two small adapters are needed, and they belong in **`api/state/variableCompletion.ts`** beside the
data they adapt (it may not import `views/**`, and `views/httprequest/**` may not import
`views/grpcrequest/**` — `biome.json`; `api/state/` is the shared home P18 D11 already moved this
module to for that exact reason):

1. `variableHoverSource(hoverAt): HoverTooltipSource` — maps CodeMirror's `(view, pos, side)` to
   `hoverAt(view.state.doc.toString(), pos)` and renders the returned `string[]` through the
   `.cm-kira-hover` / `.cm-kira-hover-line` chrome `editor/hover.ts` already defines for the SQL
   hover (`editor/theme.ts:105-123`). No new floating-panel style.
2. `variableCompletionSource(candidates): CompletionSource` — fires only when the caret is inside an
   unclosed `{{`, using the same `templateToken` rule `AutocompleteField` uses, and maps
   `Completion` → CodeMirror's option shape (`label`, `detail`, `type`), so part 1 D8's
   `.cm-completionIcon-*` rules give it the same icons the plain popup shows.

**`completionSources` replaces language-data sources wholesale** (`CodeMirrorHost.vue:178`'s
`override`), so for the `code`/JSON editor the variable source must be **composed with** the JSON
language's own, not substituted for it. `sqlLanguageService.ts:64-67` records the identical hazard
and its fix (re-add the displaced source explicitly); D5 follows it: for a `code` body the array is
`[variableCompletionSource(...), jsonLanguageCompletionSource]`, and for `raw` (plain text, no
language data) it is the variable source alone.

### D6 — Description is a fourth column on every row-shaped field that has a row (item O, F9)

**Schema** — one added field per shape, all `.default('')` so an older stored tab or saved request
restores unchanged (`domain/http.ts:285-289`'s own restore-through-schema discipline):

- `httpHeaderSchema`, `httpUrlEncodedFieldSchema`, `httpFormDataFieldSchema` (`domain/http.ts`)
- `grpcMetaRowSchema` (`domain/grpc.ts`)

**Go** — `model.SavedHeader`, `model.SavedField`, `model.SavedFormField`
(`internal/storage/model/collections.go:83-108`) and `model.SavedGrpcMetaRow`
(`grpc.go:24-32`) each gain `Description string \`json:"description"\``, with the same
*"app-local free text, no wire counterpart"* comment `model/variables.go:16` carries.
**No migration is needed**: these are fields inside an existing JSON blob column, not columns —
unlike P17's variables, which are real rows. Stated explicitly in the commit body so nobody looks
for an `0015_`.

**Wire** — nothing. `httpclient.Header` (`client.go:60`), the multipart builder and the gRPC
metadata pair are untouched, and a `tests/e2e-real` assertion that a described header sends exactly
`Name: Value` is what pins it (§4.3 case 6).

**Postman** — `packages/api-core/src/postman/*` gains the mapping in both directions. Postman's own
`header`, `url.query` and `body.formdata` entries all carry a `description` field, so this is a
straight 1:1 win and closes a real import/export data loss that exists today.

**UI** — `FieldRowsTable.vue` gains a description cell, rendered as a plain `TextField` (no
autocomplete, no `{{variable}}` colouring — it is prose about the field, not a value). It is behind
a per-table toggle rather than always on: see D7.

### D7 — Query params get a description too, stored beside the URL, not in it (item O, F10)

F10's constraint is real: there is no `params` array to add a column to, and inventing one would
give the query string two sources of truth — exactly what `domain/http.ts:290-292` and P2 D9 forbid.
Three options were weighed:

| Option | Verdict |
|---|---|
| Add a `params` array | **Rejected.** Reopens D9. Two writers for one string is the bug D9 exists to prevent, and the Params table is a *derived editor* precisely so it cannot drift from the URL. |
| Skip params | **Rejected.** The row says "every configurable row"; a Params tab that alone has no Description column is the inconsistency the row is complaining about, one level down. |
| A side-car map keyed by param name | **Chosen.** |

`httpRequestTabStateShape` gains `paramDescriptions: z.record(z.string()).default({})`, and
`model.SavedRequest` gains `ParamDescriptions map[string]string`. `QueryParamsTable.vue` reads
`tab.state.paramDescriptions[row.name] ?? ''` for the cell and writes it back on edit; a param
renamed in the table carries its description with it (the rename handler moves the key), and a
param deleted from the URL leaves an orphan key that the same handler prunes on every write.

**Why a name key is acceptable here and a second array is not:** the map is *annotation*, never
input to `buildQuery` — the URL remains the only thing `send()` reads, so the two cannot disagree
about what is sent. A duplicate param name (`?a=1&a=2`) shares one description; that is a real
limitation and it is named rather than papered over (OQ-2).

**The column is behind a toggle, in every table.** `FieldRowsTable` gains a `showDescriptions`
boolean driven by one persisted per-tab flag (`httpRequestTabStateShape`'s
`fieldDescriptions: z.boolean().default(false)`), toggled from an `IconButton` in the request
builder's `#toolbar-2` beside the existing filter toggle. Three columns of `AutocompleteField` in a
26-px row is already tight at a narrow window; a fourth, always on, would make the value column
unusable for the majority of users who never write a description. Postman's own behaviour is the
precedent (its description column is a per-table toggle too).

### D8 — Environments become the second category in the collections panel (item P, F11, F12)

`api/CollectionsPanel.vue`'s `#body` becomes two stacked, collapsible categories:

```
▾ COLLECTIONS            <- CollectionsTree, flex: 1, the default-expanded one
▸ ENVIRONMENTS           <- a flat list of environments, collapsed by default
```

- **The category header** reuses `primitives.css:964-982`'s existing section-title idiom
  (uppercase, `--kira-t-sm`, `--kira-fg-muted`, letter-spaced) plus a `chevron-down`/`chevron-right`
  twisty — the same two glyphs `TreeRow.vue:126-127` uses. **No new primitive**; a scoped
  `.panel-category` in `CollectionsPanel.vue`, promoted to `primitives.css` only if a second panel
  wants it (P18's own "promote when a second consumer appears" rule).
- **Sizing.** Collections keeps `flex: 1; min-height: 0`; the environments list is
  `flex: 0 0 auto` with a `max-height: 40%` and its own scroll, so a long environment list can never
  squeeze the tree to nothing. Collapse state is a `ref` in the panel — runtime only, not persisted
  (`ConsoleViewRuntime`'s own "runtime-only, never saved" rule; a panel section is not a preference
  worth a storage round trip).
- **A row click calls `openVariableSetTab('environment', id, name)`** — the *same* function
  `EnvironmentsDialog.vue:88-91` calls, so P17 N4's behaviour is reached by a second entry point
  rather than reimplemented.
- **Each row carries the environment's colour dot** (P18's `--kira-conn-*` environment colour) and
  the active-environment marker `EnvironmentSelect.vue` already renders, so the panel and the
  request builder's own selector agree at a glance.
- **`EnvironmentsDialog` stays**, and so does the gear button. It owns create/rename/duplicate/
  delete/reorder, which is a management surface, not a list; the tree category is navigation. Both
  reading from `api/state/variables.ts` means they cannot disagree. Removing the dialog is
  explicitly not this item (OQ-3).

### D9 — One row grid, shared by the three surfaces that draw a variable row (item Q, F13)

1. **A shared grid.** `api/VariableRow.vue`'s row becomes a CSS grid with named, fixed-fraction
   columns (`grid-template-columns: auto auto 1.2fr 2fr 1.5fr auto auto auto` — handle, checkbox,
   name, value, description, secret, history, delete), so every row's columns line up whether or not
   an individual row renders its optional affordances (a secret row's reveal button occupies its
   column; a non-secret row leaves it empty rather than collapsing it). `VariablesOverviewPanel`'s
   own row markup adopts the same template, minus the columns a read-only popover does not have.
2. **Inputs fill their column.** Every `TextField`/`AutocompleteField` in those rows is wrapped and
   given `:deep(.p-input) { width: 100% }` — the `inheritAttrs: false` idiom
   `GrpcRequestView.vue:280-286` documents and "ten other call sites" already use. This is the
   literal *"inputs not filling available width"* half of the report.
3. **`VariableSetView`'s header and toolbar** adopt `ViewChrome`'s standard bands rather than their
   own spacing: the search box in `#toolbar`, add/import in `#toolbar-end`. Uneven spacing goes away
   because the spacing stops being hand-written.
4. **`FieldRowsTable`** adopts the same grid approach for the request builder's rows — which is what
   makes D6's fourth column land in something that can hold it. **This is why D9 lands before D6 in
   the commit order**, even though the row lists them the other way round.

### D10 — The gRPC method select gets the address field's own wrapper treatment (item R, F14)

`GrpcRequestView.vue`'s `<select data-testid="grpc-method-select">` is wrapped in a
`.grpc-method-field` div with `flex: 1` and `:deep(.p-select) { width: 100% }`, mirroring
`.grpc-target-field` exactly — the same fix, the same reason, and the same comment pointing at
`inheritAttrs: false`.

Because both are now `flex: 1` in one 28-px toolbar row that also holds the TLS segmented control
and the Call button, the two share the free space evenly, which is what *"bring it to the same
length"* means in a flex row that must also stay responsive. A hard pixel width would be wrong at
either extreme of window size.

**The Call button is not touched here** — part 1 D3 fixes it for all ten `variant="primary"` call
sites (F14), and duplicating that fix in this view would leave two rules claiming the same thing.

### D11 — Mongo copy becomes one named format submenu, everywhere a document can be copied (item S, F15, F16)

In both `views/documents/menu.ts` (the collection view's row menu) and `views/console/resultMenu.ts`
(the console's document-result menu), the two flat items become one submenu with the row's own
vocabulary, mirroring `resultMenu.ts:116-140`'s `Copy row(s) ▸` shape:

```
Copy document ▸  Shell mode            -> toShellText(body)                    (today's "Copy document")
                 Canonical Extended JSON -> the body verbatim, pretty-printed  (today's "Copy as JSON")
                 Relaxed Extended JSON  -> EJSON relaxed
Copy _id
```

and, for a whole result:

```
Copy all ▸       Shell mode            -> documents joined by `\n`
                 Canonical Extended JSON -> a JSON array           (today's "Copy all as JSON")
                 Relaxed Extended JSON  -> a JSON array
```

Three points:

- **Two of the three encoders already exist** (F16): `toShellText` and the verbatim body.
  *Relaxed* is the only new one and it is one call — the parse side already round-trips both
  (`ejson.ts:521`), and relaxed is what a person pastes into a blog post or a bug report, which is
  the third thing users ask for after the other two. If it turns out to need more than a wrapper, it
  is dropped and the submenu ships with two entries (OQ-5).
- **The labels are the format names**, because that is the item: a user choosing between
  `mongosh` syntax and `{"$oid": …}` has to be told which is which.
- **`data-testid`s and the existing menu ids are preserved** where a test uses them
  (`copy-document`, `copy-as-json`, `copy-all-as-json` become the submenu's leaf ids), so P19's own
  console cases keep passing with a path change and no assertion change.

### D12 — Format preserves the document's terminator (item T, F18)

`views/console/format.ts`:

```ts
// P22b D12: `stmt.text` never carries its own ';' (sql-split.ts's pushIfNonEmpty slices up to, not
// through, the terminator), so a plain join(';\n\n') emitted N-1 semicolons for N statements and
// silently deleted the document's last one on every press — a regression against P13's
// whole-document formatDialect call, which preserved every ';' it was given. The terminator is now
// a property of the SOURCE, not of the join: a document that ended in ';' still does, one that did
// not still does not.
const endedWithTerminator = /;\s*$/.test(text);
const joined = out.join(';\n\n');
return { text: endedWithTerminator ? `${joined};` : joined, ok: true, failures };
```

The same rule applies to the all-failed branch, which already returns `text` untouched and is
therefore correct by construction.

### D13 — An unchanged press says what it did, not just that it did nothing (item T, F19)

`ConsoleView.vue`'s `Already formatted.` note (`:381-390`) stays, and is reworded to name the reason
rather than assert a null result:

> `Already formatted — indentation only; keywords keep the case you typed (ClickHouse identifiers).`

This is P19 D13's own strip, one sentence longer. It costs nothing, and it is the difference between
"the button is dead" and "the button ran and there was nothing to change" — which, per F19, is the
whole remaining substance of the re-report once D12 lands.

`keywordCase: 'preserve'` is **not** reversed (P13 D4/F6; §0.4).

### D14 — The five surfaces with no search get the shared one (item U, F21)

Each gets the toggle-plus-`PanelSearchBox` idiom its own sibling already uses, and nothing else:

| Surface | Model it copies | What it filters |
|---|---|---|
| `views/grpcrequest/ResponsePane.vue` | `views/httprequest/ResponsePane.vue:296-305` (find bar over the body, P16 D11) | the selected message's JSON, through the same `editor/findRanges.ts` `rangeHighlights` seam |
| `views/grpcrequest/CallHistoryList.vue` | `views/httprequest/ResponseHistoryList.vue:145` + `:57` | method, status name, and time, case-folded substring |
| `views/definition/DefinitionView.vue` | `ConsoleView.vue:624`'s find over an editor | the statements document, plus a plain substring filter over each section's rows |
| `workbench/panels/OperationsPanel.vue` | `PanelShell.vue:73-90` | the op label and its connection name |
| `views/shared/celleditor/CellEditorView.vue` | `ResponsePane.vue`'s find bar | the cell's own text, `rangeHighlights` again |

**No new search mechanism.** Every one of these is either `PanelSearchBox` + a substring filter, or
`ResponseFindBar` + `editor/findRanges.ts` — both already exist, and which of the two applies is
decided by whether the surface is a list or a document.

### D15 — `BrowseView`'s hand-rolled filter adopts the shared component (item U, F22)

`views/browse/BrowseView.vue`'s always-visible `.filter-field` becomes an `IconButton icon="search"`
toggle plus a `PanelSearchBox`, with `rt.filter`, `filteredNodes` and the `N of M` caption all
unchanged — the state and the filtering logic are fine; only the affordance moves. `data-testid`s
are preserved.

This is the *"matching whatever the app's one shared search component already is"* half of the item,
and it is the only surface where "already has search" and "uses the shared one" disagree.

---

## 2b. Item V — adding a row does not scroll to it

### F23 — There are two "add a row" idioms in this app, not one (item V)

The row's wording (*"clicking 'add row'"*) matches only one of them. The sweep it asks for finds
both:

**(a) A trailing blank row.** No button at all — the last row of the table *is* the add affordance,
and typing into it materialises a real row plus a fresh blank below it.

- `views/httprequest/FieldRowsTable.vue:63-79` — `displayRows` appends
  `{ row: props.blankRow(), index: props.rows.length }` unconditionally (its own comment: *"the
  trailing blank row is appended last and unconditionally … it is the add affordance, not data"*),
  and `updateField` does `if (index === next.length) next.push(props.blankRow())`. Four consumers:
  `RequestHeadersTable`, `QueryParamsTable`, `UrlEncodedTable`, `FormDataTable`.
- `views/grpcrequest/MetadataTable.vue` — this table's literal copy, per
  `FieldRowsTable.vue:95-99`'s own note (*"MetadataTable.vue is `views/grpcrequest`'s own literal
  copy of this table (F18's own trade, accepted deliberately)"*).
- `api/VariableSetView.vue:125-213` — `trailingDraft` / `trailingRow`, the same idiom for variables
  and environments.

**(b) A real button that appends.**

- `views/grid/DataToolbar.vue:186-191` → `onAddRow` → `addInsertRow(tabId, columns)`
  (`views/grid/pendingChanges.ts:203-210`), which pushes onto `p.inserts` — the SQL grid's staged
  insert row, rendered by SlickGrid **after** the loaded page's real rows.

Everything else that carries `icon="add"` is not an append into a visible list and is out of scope:
`ProjectPanel:24` (new connection dialog), `CollectionsPanel:112` (new request tab),
`KeyValueView:700` and `StreamView:645` and `DocumentView:699` (a popover form whose commit is a
server write followed by a reload, not an append) — D17 records the reasoning rather than leaving
them silently skipped.

### F24 — In idiom (a) the row that ends up off-screen is the *next* blank, and that is the report (item V)

The sequence, traced through `FieldRowsTable`: the user types into the trailing blank at
`index === rows.length` → `updateField` pushes a fresh blank and emits → `displayRows` recomputes
with one more entry → the new blank renders **below** the row the user is looking at. On a long
headers table the scroll container (`.request-pane`, `HttpRequestView.vue:470-475`,
`overflow: hidden` with the table's own scroller inside) is already at its bottom edge, so the new
blank is the first thing past the fold: the user commits a row and the place to type the *next* one
is invisible, with no cue that the table grew at all. Same in `MetadataTable` and in
`VariableSetView`, whose `.p-dialog-body.list` is the scroller (`:493-497`).

Nothing anywhere in those three files calls `scrollIntoView`.

### F25 — In idiom (b) the grid already knows how, and simply does not (item V)

`views/grid/SlickGridHost.vue:2166-2180` watches `pendingFor(tabId)?.inserts.length` and, on a
change, calls `dataSource.setState(...)`, `grid.updateRowCount()`, `grid.invalidateRow(pos)` for the
touched range and `grid.render()` — **and stops there.** `grid.scrollRowIntoView(pos)` is not called,
even though `views/console/ConsoleSlickGrid.vue:622` uses that exact API three files away. So
pressing *Add a row* on a 200-row page stages an insert at virtual row 200 and leaves the viewport
wherever it was; the visible effect is that the button does nothing.

The watcher's own comment already establishes the property that makes the fix safe: *"the only thing
that CAN change `inserts.length` is a user action outside any insert row's own input (a toolbar
click, a menu item), so the 'never invalidate a focused insert row' rule (D9) has nothing to protect
against on this path."* An insert-count change is always a deliberate user action, never a
keystroke — so scrolling on it can never yank the viewport out from under someone who is typing.

### D16 — Each trailing-blank table scrolls its new last row into view, in three lines, per file (item V, F23(a), F24)

`FieldRowsTable.vue`, `MetadataTable.vue` and `VariableSetView.vue` each gain:

```ts
// P22b D16: the trailing blank row IS the add affordance (displayRows' own comment), so the row a
// user needs next is the one that appears BELOW the one they just filled in — off the fold on any
// list long enough to scroll. `block: 'nearest'` never moves the viewport when the row is already
// visible, which is the common case and must stay a no-op. TabStrip.vue:121 and
// FiltersDialog.vue:58 are the app's two existing precedents for this exact call.
watch(
  () => props.rows.length,
  (next, prev) => {
    if (next <= prev) return;                       // a removal must not scroll anywhere
    void nextTick(() => {
      containerRef.value?.querySelector('.field-row:last-child')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
);
```

Three points:

- **Not extracted into a shared module.** `views/grpcrequest/**` may not import
  `views/httprequest/**` (`biome.json`), `api/**` is a third directory again, and
  `FieldRowsTable.vue:88-92` already decided this exact question for the arrow-key handler these
  three files also duplicate: *"this handler is small enough that duplicating it costs less than the
  coupling a shared module would create."* Applying the opposite rule to a smaller function in the
  same three files would be inconsistent for no gain. **If a fourth consumer appears, promote it** —
  the app's own "promote when a second (here, fourth) consumer appears" rule.
- **Guarded on growth only.** A removal shrinks `rows.length` and must leave the viewport alone;
  without the `next <= prev` guard, deleting the second row of forty would jump to the fortieth.
- **`block: 'nearest'`, not `'center'`.** When the new row is already on screen — every short table,
  which is most of them — `'nearest'` does nothing at all. `'center'` would jerk the list on every
  single keystroke-that-creates-a-row. `FiltersDialog.vue:58` uses `'center'` deliberately for a
  *search hit*; this is not that.

`VariableSetView`'s selector is its own row class rather than `.field-row`, and the watched
expression is its real-row count (`allRealRows.value.length`) rather than a `rows` prop — otherwise
identical.

### D17 — The SQL grid's insert watcher scrolls to the row it just staged (item V, F23(b), F25)

`views/grid/SlickGridHost.vue`'s `inserts.length` watcher gains one line, after `grid.render()`:

```ts
// P22b D17: the insert is staged at the end of the virtual list, past the loaded page — on any
// page taller than the viewport, "Add a row" previously staged a row nobody could see. Safe on
// this path specifically, for the reason this watcher's own comment already gives: inserts.length
// can only change from a deliberate user action (a toolbar click, a menu item), never from a
// keystroke inside an insert row, so this can never yank the viewport away from someone typing.
if (count > lastInsertCountBefore) grid.scrollRowIntoView(end);
```

using the `end` this watcher already computes, and guarded on growth for D16's reason (a discard
shrinks the count and must not scroll). `grid.scrollRowIntoView` is SlickGrid's own API and is
already used by `ConsoleSlickGrid.vue:622`, so this introduces nothing new.

**Deliberately not extended to** `KeyValueView`, `StreamView`, `DocumentView` or the connection/
collection panels (F23): each of those "add" buttons opens a form whose commit is a server write
followed by a reload, so there is no appended row to scroll to — where the new record lands depends
on the engine's own ordering and the current page, and scrolling to a guessed position would be
worse than not scrolling. Stated here so the sweep reads as complete rather than partial.

---

## 3. Commit sequence

Conventional Commits, one concern each, in dependency order. **This whole document lands after
`plans/P22-shared-primitives-and-tokens.md`.** `bun run lint`, `bun run typecheck`,
`bun run build` per commit; the UI suite runs once near the end.

| # | Commit | Covers |
|---|---|---|
| U1 | `fix(api): a status code's meaning is reachable from every list that shows one` | D1 |
| U2 | `feat(api-core): a value vocabulary for the headers a person actually fills in` | D2, api-core half |
| U3 | `feat(api): a header's value completes from its own name` | D2, UI half |
| U4 | `fix(api): Save sits at the right of the request head` | D3 |
| U5 | `fix(theme): a resolved {{variable}} has a colour of its own` | D4 |
| U6 | `feat(api): the request body hovers and completes {{variables}} like every other field` | D5 |
| U7 | `refactor(api): one row grid for variables, environments and request fields` | D9 |
| U8 | `feat(api): every configurable field row carries a description` | D6 |
| U9 | `feat(api): a query parameter carries a description too` | D7 |
| U10 | `feat(api): environments are a category in the collections panel` | D8 |
| U11 | `style(api): the variable and environment views fill their width` | D9's remainder |
| U12 | `fix(grpc): the method select is as wide as the address beside it` | D10 |
| U13 | `feat(studio): a Mongo document copies as shell, canonical or relaxed EJSON` | D11, single-document half |
| U14 | `feat(studio): a whole Mongo result copies in any of those three formats` | D11, multi half |
| U15 | `fix(console): Format keeps the document's last semicolon` | D12 |
| U16 | `style(console): an unchanged format says why nothing moved` | D13 |
| U17 | `feat(grpc): the response pane and the call history search` | D14, gRPC half |
| U18 | `feat(studio): the definition view, the op log and the cell editor search` | D14, Studio half |
| U19 | `refactor(browse): the object browser's filter is the app's own search box` | D15 |
| U20 | `fix(api): a new field row scrolls into view when it appears` | D16 |
| U21 | `fix(grid): a staged insert row scrolls into view` | D17 |
| U22 | `test(p22b): the specs §4 enumerates` | §4.3 |
| U23 | `docs(spec): P22 part 2 implemented` | the SPEC row |

Ordering notes: U7 **must** precede U8 (the grid is what holds the fourth column). U2 before U3.
U5 depends on part 1's D9 having vacated `#4ec9b0`. U15 before U16 (the note's wording assumes the
semicolon no longer disappears). U20 after U7 (the row grid) — the watcher's selector targets the
row element that commit reshapes. U20 and U21 are otherwise independent of everything else.

---

## 4. Verification plan

### 4.1 Unit (`bun run test:unit`)

- **`headerValueCompletions`** — no dedicated test. It is a table lookup with a case-fold;
  `CLAUDE.md` names exactly this class ("thin pass-through wrappers", "format round-trips with no
  edge case") as getting nothing. Its behaviour is covered end to end by §4.3 case 2.
- **No unit test for D16/D17.** Both are a three-line watcher over a length, and the behaviour that
  matters (did the viewport move?) is only observable in a real layout — §4.3 cases 13 and 14 are
  the guards.
- **`formatConsoleText`'s terminator rule (D12)** — **yes**, added to the existing
  `tests/unit/console-format.spec.ts` (P13 D10, extended by P19). Four cases: a document ending in
  `;` still does; one that does not still does not; a multi-statement document keeps every internal
  `;` and its trailing one; a document where every statement fails is returned byte-identical. This
  earns its keep: it is boundary arithmetic over a splitter's own contract, which is on the right
  side of `CLAUDE.md`'s bar and is exactly the class of thing that regressed here.
- **The param-description key maintenance (D7)** — **yes**, one case: renaming a param moves its
  description; deleting one prunes the orphan; a duplicate name shares one entry (the documented
  limitation, pinned so it cannot silently change).
- Nothing else. D1, D3, D4, D10, D13, D15 are a tooltip, a slot, a token, a CSS wrapper, a string
  and a component swap.

### 4.2 Go (`bun run test:go`)

- `internal/storage/model` — one case per shape that a saved request with descriptions round-trips
  and that a pre-P22b blob (no `description` key) parses with `""`, matching
  `ValidateObjectDefinition`'s own missing-field posture.
- `internal/postman` — import and export carry a header/param/form-field description through both
  directions.
- `internal/httpclient` — unchanged, and expected to stay so. §4.3 case 6 is the real guard that
  nothing new reaches the wire.

### 4.3 UI (`bun run test:ui`)

1. **`http-history.spec.ts`** — a history row's status chip carries the code's meaning as a title;
   the response pane's own `http-status-hint` line is **still present and still not a tooltip**
   (D1's no-regression half, guarding F1).
2. **`http-request.spec.ts`** — typing in a `Content-Type` row's value cell offers
   `application/json`; accepting it replaces the field. In an `Authorization` row, accepting
   `Bearer ` leaves the caret after the space and typing `{{` then offers variable names (D2).
3. **`http-request.spec.ts`** / **`grpc-request.spec.ts`** — `http-save`/`grpc-save`'s bounding box
   is to the right of the request title's, and its left edge does not move when the dirty mark
   appears (D3).
4. **`http-variables.spec.ts`** — in a JSON body, a resolved `{{name}}` and a JSON key have
   **different** computed colours; an unresolved one is `--kira-warn` (D4). Hovering a resolved
   reference in the body editor shows its value; typing `{{` in the body offers names (D5).
5. **`http-request.spec.ts`** — the description toggle reveals a description cell on headers,
   params, urlencoded and form-data; a value typed there survives a tab reload (D6, D7).
6. **`tests/e2e-real`** — a request with a described header sends exactly `Name: Value` over the
   wire, with no description anywhere in the raw exchange (D6's wire guarantee). This is the one
   case that belongs in the real-backend tier rather than the mocked one.
7. **`collections.spec.ts`** — the Environments category expands, lists environments with their
   colour dots, and a click opens the same variable-set tab the dialog opens; collapsing it does not
   resize the collections tree's scroll position (D8).
8. **`api-ui-consistency.spec.ts`** — in a variable-set view, the name/value/description cells of
   three consecutive rows share left edges, and each fills its column (D9).
9. **`grpc-request.spec.ts`** — `grpc-method-select`'s width is within 10 % of `grpc-target`'s
   (D10).
10. **`console.spec.ts`** / **`documents.spec.ts`** — the copy submenu offers all three formats; the
    shell entry writes `ObjectId("…")`, the canonical entry writes `{"$oid":"…"}` (D11). Uses
    `autocomplete.spec.ts:310-330`'s existing `installClipboardSpy` helpers.
11. **`console-format.spec.ts`** — `select 1;` formats to text that still ends in `;`; pressing
    Format twice shows the reworded note (D12, D13).
12. **`grpc-request.spec.ts`**, **`definition.spec.ts`**, **`operations.spec.ts`**,
    **`cell-editor.spec.ts`**, **`browse.spec.ts`** — each new search toggle opens a
    `PanelSearchBox`/find bar, filters, and closes on Escape (D14, D15).
13. **`http-request.spec.ts`** — D16: fill a headers table past the pane's height, type into the
    trailing blank, and assert the newly appeared blank row is inside the scroller's client rect;
    then delete a middle row and assert the scroll position did **not** move (the growth guard).
    Repeated in **`grpc-request.spec.ts`** for the metadata table and in **`http-variables.spec.ts`**
    for the variable set view.
14. **`data-view.spec.ts`** — D17: with a full page loaded and the viewport scrolled to the top,
    press `toolbar-add-row` and assert the staged insert row is visible; press *Discard* and assert
    the viewport does not jump.

### 4.4 What is deliberately not verified

- **The exact contents of the header-value vocabulary.** It is editorial, the same way
  `WELL_KNOWN_REQUEST_HEADERS` is; case 2 proves the mechanism with two entries.
- **`#4ec9b0`'s appearance.** Arithmetic (P19 F29, re-checked in part 1 F15); `check-tokens.sh`
  proves it resolves.
- **Whether the environments category reads better than the dialog.** A judgement the user makes;
  the dialog survives (D8), so the change is additive and reversible.

---

## 5. What this part deliberately does not do

- **Does not add a tooltip back to the two response panes' status chips** (D1, F1) — `37716b1`
  removed it deliberately and the inline line is what the row asks for.
- **Does not reverse `keywordCase: 'preserve'`** (D13, §0.4).
- **Does not remove `EnvironmentsDialog`** (D8, OQ-3).
- **Does not add a `params` array** (D7, F10) — the URL stays the single source of truth for the
  query string.
- **Does not put a description on the wire**, in any protocol (D6).
- **Does not touch the gRPC Call button** — part 1 D3 owns it (F14).
- **Does not persist the collections panel's category collapse state** (D8).
- **Does not scroll on a row *removal*, and does not scroll for the add buttons whose commit is a
  server write plus a reload** (D16's guard, D17's exclusion list).
- **Does not add search to `TimelinePane`, `RawExchangePane` or the tab strip** — the first two are
  already reachable through the response pane's own find bar, and a tab strip with a search box is
  a different feature (a command palette) nobody has asked for.

---

## 6. Open questions, with their resolutions

**OQ-1 — Should the description column be on by default?**
*Resolved: no (D7).* Four `AutocompleteField` columns in a `--kira-control-h` row is unusable below
about 900 px of pane width, and the majority of rows in a real request have no description. The
toggle is persisted per tab, so a user who wants it always has it always. Postman's own column
behaves the same way.

**OQ-2 — What happens to a description when two query params share a name?**
*Resolved: they share one description, and that is documented rather than fixed.* `?a=1&a=2` is
legal and the app supports it (`parseQuery`/`buildQuery` are exact inverses, `81e5f3d`), but a
name-keyed side-car cannot tell the two apart. The alternatives are a positional key (which breaks
the moment a param moves) or a real `params` array (which reopens D9, F10). A shared description on
a repeated param is a small, legible limitation; a second source of truth for the query string is
not. Pinned by a unit case so it cannot change silently.

**OQ-3 — Should `EnvironmentsDialog` be retired now that the panel lists environments?**
*Resolved: not in this phase.* The dialog owns create/rename/duplicate/delete/reorder; the category
owns navigation. Folding management into a tree category means inventing a context menu, a rename-in-
place affordance and a reorder gesture for a surface that has none — that is a feature, not a
polish item, and the row asks only for the list's presentation. Both read one store, so they cannot
disagree.

**OQ-4 — Should the Mongo console use a Mongo-aware splitter for Format?**
*Resolved: not here, and recorded so it is not rediscovered (F20).* `formatConsoleText` splits every
kind with `splitSqlStatements`, which does not understand `//` line comments. A `//` inside a Mongo
console document therefore joins its neighbour rather than being a comment. Nobody has reported it,
the failure mode is a formatting oddity rather than data loss, and a second splitter is a real piece
of machinery. If it is reported, the fix is a `lineComment` option on `splitSqlStatements` rather
than a new splitter.

**OQ-5 — Is Relaxed Extended JSON worth a third copy format?**
*Open, with a default.* D11 includes it because the encoder is a wrapper over machinery that already
round-trips both directions, and because it is the format a person pastes outside the app. If it
turns out to need more than a wrapper — an EJSON dependency, or a hand-written relaxer — it is
dropped and the submenu ships with the two formats the row actually names. The implementer decides
on the evidence and says which in the commit body.

**OQ-6 — Does D5's body-editor completion fight the JSON language's own?**
*Resolved by construction, and named because it is the exact trap `sqlLanguageService.ts` records.*
`completionSources` is CodeMirror's `override`, which replaces language-data sources wholesale;
D5 therefore composes rather than substitutes for the `code`/JSON editor. §4.3 case 4 asserts both
still fire (a `{{` offers variables; a bare position still offers whatever JSON's own source does).

---

## Checklist

- [ ] U1 `fix(api): a status code's meaning is reachable from every list that shows one`
- [ ] U2 `feat(api-core): a value vocabulary for the headers a person actually fills in`
- [ ] U3 `feat(api): a header's value completes from its own name`
- [ ] U4 `fix(api): Save sits at the right of the request head`
- [ ] U5 `fix(theme): a resolved {{variable}} has a colour of its own`
- [ ] U6 `feat(api): the request body hovers and completes {{variables}} like every other field`
- [ ] U7 `refactor(api): one row grid for variables, environments and request fields`
- [ ] U8 `feat(api): every configurable field row carries a description`
- [ ] U9 `feat(api): a query parameter carries a description too`
- [ ] U10 `feat(api): environments are a category in the collections panel`
- [ ] U11 `style(api): the variable and environment views fill their width`
- [ ] U12 `fix(grpc): the method select is as wide as the address beside it`
- [ ] U13 `feat(studio): a Mongo document copies as shell, canonical or relaxed EJSON`
- [ ] U14 `feat(studio): a whole Mongo result copies in any of those three formats`
- [ ] U15 `fix(console): Format keeps the document's last semicolon`
- [ ] U16 `style(console): an unchanged format says why nothing moved`
- [ ] U17 `feat(grpc): the response pane and the call history search`
- [ ] U18 `feat(studio): the definition view, the op log and the cell editor search`
- [ ] U19 `refactor(browse): the object browser's filter is the app's own search box`
- [ ] U20 `fix(api): a new field row scrolls into view when it appears`
- [ ] U21 `fix(grid): a staged insert row scrolls into view`
- [ ] U22 `test(p22b): the specs §4 enumerates`
- [ ] `bun run lint` / `typecheck` / `build` clean
- [ ] `bun run test:unit` green (new console-format and param-description cases)
- [ ] `bun run test:go` green (new model round-trip and postman-mapping cases)
- [ ] `bun run test:ui` run once at the end; failures fixed as follow-up commits
- [ ] `tests/e2e-real` case 6 (a described header does not reach the wire) run once
- [ ] `docs/v1.2/SPEC.md`'s P22 row updated

---

## 7. Sources

**Read in this worktree at `b52fd72`:**
`views/httprequest/{ResponsePane,ResponseHistoryList,TimelinePane,ResponseDiffDialog,RequestBodyPane,RequestHeadersTable,QueryParamsTable,FieldRowsTable,FormDataTable,HttpRequestView}.vue`,
`views/grpcrequest/{GrpcRequestView,MetadataTable,ResponsePane,CallHistoryList,SchemaBrowser}.vue`,
`views/console/{ConsoleView.vue,format.ts,resultMenu.ts,ConsoleSlickGrid.vue}`,
`views/grid/{SlickGridHost.vue,DataToolbar.vue,pendingChanges.ts}`,
`views/documents/{DocumentView.vue,menu.ts}`, `views/browse/BrowseView.vue`,
`views/definition/DefinitionView.vue`, `views/shared/celleditor/CellEditorView.vue`,
`views/shared/document/ejson.ts`, `workbench/panels/OperationsPanel.vue`,
`api/{CollectionsPanel,CollectionsTree,CollectionRow,EnvironmentsDialog,VariableSetView,VariableRow,VariablesOverviewPanel,MethodSelect}.vue`,
`api/state/{variableCompletion,variables}.ts`,
`theme/primitives/{ViewChrome,ViewHeader,AutocompleteField,TextField,PanelShell,PanelSearchBox,AppButton,completion.ts}`,
`theme/{tokens,primitives}.css`, `editor/{theme.ts,CodeMirrorHost.vue,variableHighlight.ts,hover.ts}`,
`packages/shared/domain/{http,grpc,sql-split}.ts`, `packages/api-core/src/{index.ts,http/headers.ts}`,
`internal/storage/model/{collections,grpc,variables}.go`, `internal/httpclient/client.go`,
`internal/storage/migrations/0011_p17_variable_description.sql`,
`tests/ui/{mode-switch,autocomplete,console-format}.spec.ts`, `biome.json`.

**Not run**: `bun run build`, `bun run test:ui`, `bun run test:unit` — `frontend/bindings/` is
generated by `wails3`, absent from this Linux sandbox, and `node_modules` is not populated in this
worktree. Every claim is a reading of committed source; §4.4 names what stays unverified.

**Prior plans**: `docs/v1.2/plans/P15-request-builder-ux.md` (D1, D2, D7, D11 — the status hint and
the head's first control), `P15b-request-builder-editor-behavior.md` (D2, D4, D7 — the variable
seams D4/D5 extend), `P16-sql-grid-consistency-search.md` (D10-D15 — the search idiom D14/D15
apply), `P17-variable-environment-overhaul.md` (D14 the description shape, D18/D19 the method
palette, N4 the environment tab), `P18-…md` (D10, D11, D13, D14 — the gRPC parity work),
`P19-…md` (D6, D13, D14 — the Mongo copy formats and the Format button), and
`plans/P22-shared-primitives-and-tokens.md` (D3, D8, D9 — the three decisions this part depends on).
