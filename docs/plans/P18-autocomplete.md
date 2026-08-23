# P18 — Autocomplete

> Plan for SPEC.md §10 phase **P18**. Deliverable, verbatim from the phasing table: *"Field/
> identifier autocomplete in each connection kind's filter surface (the WHERE-clause-style input,
> and whatever the equivalent filter/query input is per engine), plus the same in the query console,
> plus basic SQL syntax (keyword) completion there."* Listed as *"user-requested, to be researched
> and planned in detail when picked up"* — this document is that research.
>
> Nothing in this phase touches an adapter, the engine host, IPC, storage or the tab schema. Every
> change is renderer-side and reads data the renderer already holds.

## 0. Ground rules for this phase

- **Completion is a typing aid, never a gate.** Every surface must behave exactly as it does today
  for a user who ignores the popup entirely: same Enter semantics, same blur semantics, same text
  reaching `setFilter`/`setSort`/`setSearch`. This is not a style preference — it is what keeps the
  existing UI suite (which drives these boxes with `page.fill(...)` + `press('Enter')`, e.g.
  `tests/ui/data-view.spec.ts:278-291`) passing without a single edit, and the reason for D6 below.
- **No new engine round trips.** Every candidate list is derived from data already in renderer
  memory (`runtime[tabId].meta`, the loaded page, a static table in the module). No new `control.*`
  or `data.*` call, no new op-log rows, no new cache.
- **Curated vocabularies, not exhaustive ones.** A WHERE box has no use for `CREATE`/`ALTER`;
  a Mongo filter box has no use for aggregation-stage operators. See D8/D9.
- **Surfaces with no free-text identifier input get nothing.** Forcing a completion affordance onto
  Redis/Kafka/SQS/S3 would mean inventing a query surface this app deliberately does not have
  (realities #5, #6). §5 records that as an explicit non-goal, not an omission.
- Comments per AGENTS.md: only where the code cannot say it for itself. Every `D` below that
  encodes a non-obvious constraint gets one line at its implementation site, not a paraphrase of
  this document.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `xvfb-run -a bun run
  test:ui` from step 2 on. `bun run test:db` is untouched — no adapter changes in this phase.

### Realities this phase works with (verified against the tree)

1. **SQL column names are already loaded, reactive, and already have a consumer.**
   `views/grid/state.ts`'s `DataViewRuntime.meta: ObjectMeta | null` is filled by `loadMeta()`
   (one `control.treeDescribe()` per tab, cache-aside through L1) and read reactively by
   `views/grid/ColumnsMenu.vue` as `meta.value?.columns.map((c) => c.name)`. `ObjectMeta.columns`
   is `ColumnMeta[]` (`shared/domain/tree.ts`'s `columnMetaSchema`: `name`, `dataType`, `nullable`,
   `isPrimaryKey`, …) — name *and* type, so a completion entry can show a type hint for free.
2. **There is a second, independent column source for the same tab.** `views/grid/page.ts`'s
   `getPage(tabId)` returns the loaded `TabularPage`, whose `columns: ColumnDescriptor[]`
   (`shared/protocol/page.ts`) also carries `name`/`dataType`/`typeClass`. It is available even when
   `loadMeta()` failed (its `catch` is deliberately silent — "a failure here must not block reading
   rows"). Used as the fallback in D7.
3. **Mongo field names already have a shared helper with two consumers.** `views/documents/
   docPage.ts`'s `fieldNamesOnPage(tabId)` parses every loaded document body and returns the sorted
   set of top-level keys; `ProjectionMenu.vue` and `DocumentView.vue`'s `projectionCountLabel` both
   read it. It is **not** reactive on its own — callers depend on `pageVersion.n` explicitly
   (`void pageVersion.n;` immediately before the call, see `projectionCountLabel`). It deliberately
   **excludes `_id`** ("it is always returned regardless of projection … so it is never a real
   projection choice") — correct for a projection picker, wrong for a filter box, where `_id` is the
   single most-filtered field. D9 handles that.
4. **Mongo's filter/sort boxes have their own hand-written syntax on both ends.** The renderer
   parses the sort box with `DocumentView.vue`'s `SORT_TERM_RE`/`parseSortText`; the engine parses
   the filter box with `engine/adapters/mongo/literal.ts`'s hand-written JSON5-lite tokenizer
   (no `eval`, no `Function`). That tokenizer's bare-identifier rule is exactly
   `/[A-Za-z_$][A-Za-z0-9_$]*/` — anything outside it must be quoted. D9's insertion rule is that
   regex, not a guess.
5. **Redis, S3 and SQS have no query-language filter surface at all.** `KeyValueView.vue`'s only
   text input beyond the add/edit popovers is `KeyValueSearchToolbar.vue`, which "filters the
   already-loaded page only, never a new query" (its own comment, mirroring `views/grid/search.ts`);
   `engine/adapters/redis/read.ts` and `s3/read.ts` take no `filter` argument whatsoever, and
   `sqs/read.ts` likewise. S3 objects reuse the `keyvalue` page kind (P17), so they inherit exactly
   the same non-surface. There is nothing here to complete against.
6. **Kafka's filter row is structured, not free text.** `StreamView.vue`'s Kafka-only row is an
   offset box (a number), a partition **multiselect popover** (task #61 replaced the old free-text
   field), and a timestamp box; the engine parses it as a JSON-encoded `KafkaStreamFilter`
   (`kafka/read.ts`'s "D-filter" comment). SQS shows no filter row at all
   (`StreamView.vue`'s own comment: "queue-based, no topic/partition/offset concept to filter by").
   No identifiers exist in any of those three inputs.
7. **`@codemirror/autocomplete` is already installed but never activated.** `bun.lock` has
   `@codemirror/autocomplete@6.20.3` as a transitive dependency of both `@codemirror/lang-sql@6.10.0`
   and `@codemirror/lang-xml`. `sql()` already registers a keyword completion source —
   `lang.language.data.of({ autocomplete: keywordCompletionSource(lang, …) })`, plus a schema source
   when `config.schema` is set (`node_modules/@codemirror/lang-sql/dist/index.js:712-720`) — but a
   language-data completion source only does anything when the `autocompletion()` extension is in
   the editor's extension list. `editor/CodeMirrorHost.vue` builds its extensions by hand
   (`lineNumbers`, `highlightSpecialChars`, `lineWrapping`, `keymap.of(defaultKeymap)`,
   `syntaxHighlighting`, `kiraEditorTheme`, two compartments, one `updateListener`) and does not
   include it. **The console's SQL keyword completion is therefore one extension away.**
8. **`autocompletion()`'s defaults are the behaviour we want, and its keymap does not fight ours.**
   `activateOnTyping: true` and `defaultKeymap: true` (`@codemirror/autocomplete/dist/index.js:377,
   384`); `completionKeymap` (ibid. 2063-2073) binds Ctrl-Space, Escape, Arrow/Page Up/Down and
   Enter, at `Prec.highest`, and every one of those commands returns `false` when no completion is
   active, so plain Enter still inserts a newline. `main/menu.ts` binds no `Space` accelerator, and
   Run/Run all are `CmdOrCtrl+Return`/`CmdOrCtrl+Shift+Return` — neither collides.
9. **The console tracks no schema metadata and needs none for this deliverable.**
   `ConsoleView.vue` holds `tab.state.text`, `cursorPos`, and a `dialect` computed derived from
   `connectionsState.records.find(...)?.kind` (`'postgres' | 'mariadb' | undefined`). There is no
   table/column catalog anywhere in console state. D11 draws the scope line there deliberately.
10. **`language="sql"` is hard-coded in `ConsoleView.vue`, for every engine.** `caps.sql` is `true`
    for postgres, mariadb, **mongo and redis** (`adapters/*/caps.ts`), and §8.14 says a non-SQL
    console "takes that engine's native command form" — but the view passes `language="sql"` with
    `:sql-dialect="dialect"`, which is `undefined` for mongo/redis, i.e. `StandardSQL`. That is a
    pre-existing wart this phase does not fix, but it directly constrains D10: switching completion
    on inside `CodeMirrorHost` unconditionally would offer SQL keywords inside a Mongo shell console.
11. **`TextField.vue` cannot host a completion popup safely — this was checked, not assumed.**
    See §1 below; it is the single most consequential finding in this research and drives D2.
12. **`Popover.vue` is the wrong chrome for a completion list, also for a checkable reason.** Its
    root is `.menu-backdrop { position: fixed; inset: 0; z-index: 20 }` with `@click="emit('close')"`
    — a full-viewport click-catcher that sits *above the input that would own the popup*. Clicking
    into the text field to keep typing would hit the backdrop and close the list. Its `reposition()`
    technique (measure the trigger's `getBoundingClientRect()`, position `fixed` against the
    viewport — task #58's fix for menus resolving their anchor to a window corner) is still exactly
    right and is reused in D3; the component is not.
13. **`@mousedown.prevent` on a control inside a field is an established pattern here.**
    `TextField.vue`'s own stepper buttons use it (`@mousedown.prevent="stepBy(1)"`) precisely so the
    input never loses focus. D5 reuses it for suggestion rows, which matters because both SQL boxes
    and both Mongo boxes apply their value on `@blur`.
14. **`gridMenu.ts` already owns dialect-correct identifier quoting** — `quoteIdent(dialect, name)`
    (backtick-doubling for mariadb, double-quote-doubling otherwise), module-private today, with the
    same "generated as literal SQL text once, never validated against the column's type" trust
    boundary the WHERE box itself has. D7 gives it a second consumer.

## 1. The `TextField.vue` question, answered

The task is to decide whether the plain-input surfaces should **extend** `TextField.vue`, **wrap**
it, or **own a dedicated input**. The deciding factor is what a caller can and cannot layer onto
`TextField`'s inner `<input>` from outside. What is actually true, verified against
`node_modules` at the pinned `vue@3.5.41`:

- `TextField.vue` sets `defineOptions({ inheritAttrs: false })` and spreads `v-bind="$attrs"` onto
  its inner `<input>`, **before** its own three inline handlers (`@input`, `@keydown.enter`,
  `@blur`). The compiler emits `mergeProps(_ctx.$attrs, { …, onKeydown: withKeys(…), … })`.
- `mergeProps` (`@vue/runtime-core/dist/runtime-core.cjs.js:7979-8005`) concatenates same-named
  `onX` props into an array **in argument order**, so a caller's `@keydown.esc` handler ends up
  *first* in the array and `TextField`'s own `enter` emit *second*. This is why
  `FilterToolbar.vue`'s `@keydown.esc` and `TextField`'s `@enter` coexist today.
- A caller therefore **can** add keydown handling, but **cannot** run after the component's, and
  can only suppress it via `e.stopImmediatePropagation()` — which does work
  (`@vue/runtime-dom/dist/runtime-dom.cjs.js:676-694` wraps the array invoker and breaks on a
  private `e._stopped` flag), but only by relying on three facts that no part of `TextField`'s API
  documents or promises: the `$attrs`-before-handlers ordering inside someone else's template,
  Vue's array-concat merge order, and Vue's array-invoker stop semantics. Reordering one attribute
  in `TextField.vue` would silently break every wrapper built on it.

Two further blockers make the point moot anyway:

- **Enter is already spoken for, in two different dialects.** `FilterToolbar.vue` listens on
  `@enter` (TextField's own emit); `DocumentView.vue` listens on `@keyup.enter` (a fallthrough attr,
  on *keyup*, which a `keydown`-time `preventDefault`/`stopImmediatePropagation` cannot reach at
  all). A wrapper cannot give Enter a completion meaning in both boxes by the same mechanism.
- **A completion popup needs the `<input>` element itself** — `selectionStart` to find the token
  under the caret, `setSelectionRange` after insertion, `getBoundingClientRect()` to place the list,
  `focus()` to restore focus. `TextField.vue` exposes none of it (`inputRef` is local; there is no
  `defineExpose`), so a wrapper would have to `querySelector('input')` into another component's
  DOM.

**Conclusion (D2): own a dedicated input.** A new `AutocompleteField.vue` primitive renders the same
`.p-input` chrome (`theme/primitives.css:128+` — the classes are global, so the two components are
visually identical by construction, not by copied CSS) around an `<input>` it owns, and exposes
`enter`/`escape`/`blur` as **explicit emits** so it — not Vue's merge order — decides whether a
keystroke means "accept a suggestion" or "the thing this box did before". `TextField.vue` is left
completely untouched: 41 `<TextField>` uses across 17 files today, of which this phase swaps
exactly four (two in `FilterToolbar.vue`, two in `DocumentView.vue`) — every other call site keeps
the simpler primitive, unchanged.

## 2. Shapes introduced in this plan

```ts
// src/renderer/theme/primitives/AutocompleteField.vue

/** One suggestion. `insert` defaults to `label` — they differ when the label is the human-readable
 *  name and the insertion needs quoting (D7) or a trailing token (D9's `field: `). */
export interface Completion {
  label: string;
  insert?: string;
  /** Right-aligned dim text: a column's dataType, or "keyword" / "operator". Never required. */
  detail?: string;
  /** A codicon name (`symbol-field`, `symbol-keyword`, `symbol-operator`) — the same set
   *  `project/icons.ts` already draws from. */
  icon?: string;
}

// Props: modelValue, candidates: Completion[], plus TextField's own presentational passthroughs
//   (prefix?, placeholder?, invalid?, size?). No `type` — a completing field is always text.
// Emits: 'update:modelValue' [string], enter [], escape [], blur [FocusEvent],
//        accept [Completion]  (fired after an insertion, so a caller can re-run its parser)
```

```ts
// src/renderer/theme/primitives/completion.ts   (pure, no Vue — the primitive's own helpers)

/** The token under the caret: the run of [A-Za-z0-9_$.] characters ending at `caret`.
 *  One rule serves both surfaces — it captures `stat` in `status = 'p'`, `$g` in `{ a: { $g`,
 *  and `created` in `{ created` (realities #4's ident rule plus `$` and `.`). */
export function tokenAt(text: string, caret: number): { from: number; to: number; word: string };

/** Case-insensitive: exact-prefix matches first (stable within the group), then substring
 *  matches. Capped at MAX_VISIBLE (12) — a wider list is a scrollbar nobody reads. */
export function rankCandidates(candidates: Completion[], word: string): Completion[];
```

```ts
// src/renderer/views/shared/sqlIdent.ts   (quoteIdent moves here from gridMenu.ts — D7)
export type Dialect = 'postgres' | 'mariadb' | undefined;
export function quoteIdent(dialect: Dialect, name: string): string;
/** False for a bare-safe, non-reserved lowercase identifier — those are inserted unquoted. */
export function identNeedsQuoting(dialect: Dialect, name: string): boolean;
```

```ts
// src/renderer/views/grid/filterCompletion.ts
/** meta.columns (realities #1), falling back to the loaded page's columns (realities #2),
 *  plus WHERE_VOCABULARY. Columns first, keywords after — a user types a field far more often
 *  than they type `BETWEEN`. */
export function whereCandidates(tabId: string, dialect: Dialect): Completion[];
/** The same columns plus ORDER_BY_VOCABULARY (ASC/DESC, and Postgres's NULLS FIRST/LAST). */
export function orderByCandidates(tabId: string, dialect: Dialect): Completion[];
```

```ts
// src/renderer/views/documents/filterCompletion.ts
/** ['_id', ...fieldNamesOnPage(tabId)] (realities #3) as `field: ` insertions, plus
 *  MONGO_QUERY_OPERATORS — the operator entries are what a `$`-prefixed token matches. */
export function mongoFilterCandidates(tabId: string): Completion[];
/** The same field list, inserted bare (the sort box's own `key: value` grammar supplies the
 *  rest), with no operators — `parseSortText` has no use for one. */
export function mongoSortCandidates(tabId: string): Completion[];
```

```ts
// src/renderer/editor/CodeMirrorHost.vue  (one new prop)
/** Off everywhere by default. On only for the query console on a SQL connection (D10) —
 *  the cell editor, DDL viewer, document editor and op-log rows must not sprout a popup. */
autocomplete?: boolean;
```

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Scope is exactly four plain-text inputs plus the console editor**: SQL's `WHERE` and `ORDER BY` (`views/grid/FilterToolbar.vue`), Mongo's filter and `SORT` (`views/documents/DocumentView.vue`), and the query console (`views/console/ConsoleView.vue`). Redis, Kafka, SQS and S3 get nothing. | The SPEC line says "whatever the equivalent filter/query input is per engine" — and for four of the seven engines the honest answer is *there isn't one* (realities #5, #6): Redis/S3 have local-page search over an already-fetched page, Kafka has a structured offset/partition/timestamp triple whose only list-shaped input is already a real multiselect, SQS has no filter row at all. Adding a completion popup there would require inventing a query language first, which is a different phase in a different spec section. |
| D2 | **A new `theme/primitives/AutocompleteField.vue` that owns its own `<input>`** — not an extension of, wrapper around, or fork of `TextField.vue`. `TextField.vue` is not modified. | §1, in full. In short: a wrapper can only intercept Enter by depending on three undocumented Vue/`TextField` internals; it cannot reach `@keyup.enter` (Mongo's boxes) at all; and it has no access to `selectionStart`/`setSelectionRange`/the element's rect without reaching into another component's DOM. Owning the input makes accept-vs-apply an explicit, testable branch in one place. Both components share the global `.p-input` classes, so they stay visually identical without duplicated CSS. |
| D3 | The suggestion list is a **`position: fixed` element positioned from the input's own `getBoundingClientRect()`**, rendered inside the component (no `Teleport`), with no backdrop; it closes on selection, Escape, blur, or `window` resize/scroll. | Reuses `Popover.vue`'s hard-won positioning lesson (task #58: an absolutely-positioned menu resolves against whichever ancestor happens to be positioned, not its trigger) while avoiding the component itself, whose full-viewport `.menu-backdrop` sits above the input and would close the list on the next click into the very field being typed in (realities #12). `fixed` also sidesteps every ancestor-`overflow` question in the toolbar chain. |
| D4 | The list **opens only when the token under the caret is non-empty and matches ≥1 candidate**, or on explicit **Ctrl+Space** (which lists everything). It never opens on an empty box on focus. | An unconditional popup over an empty `WHERE` box covers the grid header on every click into the toolbar. Ctrl+Space matches `completionKeymap`'s own explicit-open binding (realities #8), so the console and the plain fields share one muscle memory, and `main/menu.ts` binds no Space accelerator to collide with. |
| D5 | Suggestion rows commit on **`@mousedown.prevent`**, not `@click`. | All four boxes apply their value on `@blur` (`applyWhere`/`applyOrderBy`/`onSearchInput`/`onSortInput`). A plain click would blur the input first, applying the *pre-completion* text and firing a query, then insert into a field that had already been submitted. `TextField.vue`'s stepper buttons already solve exactly this with `@mousedown.prevent` (realities #13). |
| D6 | **Nothing is highlighted when the list opens. Enter with no highlight emits `enter` (apply/run) and leaves the text untouched; Enter with a highlight accepts it and emits nothing. `Tab` always accepts the top (or highlighted) suggestion. ArrowDown/ArrowUp move the highlight.** | This is the decision that makes completion a pure addition. These four boxes have meant "Enter = run this query" since P2/P8, and the UI suite drives them that way (`data-view.spec.ts:278-291` fills `id <= 5` and presses Enter — with a preselected first suggestion that would silently become `id <= 5` + a column name). Requiring one deliberate ArrowDown/Tab before Enter can mean "complete" keeps every existing behaviour, and every existing test, exactly as it was. |
| D7 | SQL candidates come from **`runtime[tabId].meta?.columns`, falling back to `getPage(tabId)?.columns`** when meta is null. Column names are inserted **unquoted when bare-safe**, else quoted via `quoteIdent`, which **moves from `gridMenu.ts` into a new `views/shared/sqlIdent.ts`** (gridMenu.ts imports it back). | `meta.columns` is the authoritative list — it includes columns hidden by the current projection, which the page's own `columns` does not — and `ColumnsMenu.vue` already reads it exactly this way (realities #1). The fallback covers `loadMeta()`'s deliberately silent failure path (realities #2), so completion still works on a connection whose `describe()` errored. The quoting helper gets a second consumer; one shared definition beats two that can drift on the backtick/double-quote split (realities #14). Auto-quoting *every* identifier would produce `"status" = 'paid'` for a user who typed `stat` + Tab — correct SQL, but not what they would have written. |
| D8 | The SQL vocabulary is a **curated static table per box**, not `@codemirror/lang-sql`'s dialect word list: `WHERE` gets `AND OR NOT IS NULL IS NOT NULL LIKE IN BETWEEN EXISTS TRUE FALSE` (plus `ILIKE` and `SIMILAR TO` for Postgres); `ORDER BY` gets `ASC DESC` (plus `NULLS FIRST`/`NULLS LAST` for Postgres). | The dialect word lists contain hundreds of entries — `CREATE`, `GRANT`, `VACUUM` — none of which can legally appear in a WHERE fragment, and all of which would crowd out the column names that are the actual deliverable. Two short tables are also self-documenting about what these boxes accept. |
| D9 | Mongo candidates are **`['_id', ...fieldNamesOnPage(tabId)]`** (note the explicit `_id`, which the helper deliberately omits) plus a curated `$`-operator table: `$eq $ne $gt $gte $lt $lte $in $nin $exists $type $regex $options $and $or $nor $not $all $elemMatch $size`. A field is inserted as `<name>: ` when bare-safe per `literal.ts`'s `/[A-Za-z_$][A-Za-z0-9_$]*/` rule, else `'<name>': `; an operator is inserted bare. The `SORT` box gets fields only, inserted bare. | `fieldNamesOnPage`'s `_id` exclusion is correct for the projection picker it was written for and wrong here (realities #3) — `_id` is the field a Mongo user filters on most. Quoting follows the engine's own tokenizer rather than a guess about what Mongo accepts (realities #4). Aggregation-stage operators (`$group`, `$lookup`, …) are left out: `find()`'s filter document is the only thing these boxes reach. The trailing `: ` on a filter-box field is the one place the insertion usefully exceeds the label — a filter document is always `key: value`. |
| D10 | The console gets keyword completion by adding **`autocompletion()` to `CodeMirrorHost.vue`, behind a new `autocomplete?: boolean` prop that defaults to off**, and `ConsoleView.vue` passes it **only when its `dialect` computed resolves to `'postgres' \| 'mariadb'`**. `@codemirror/autocomplete` is promoted from a transitive dependency to an explicit `devDependencies` entry (pinned to the installed `6.20.3`) since the app now imports it directly. | `sql()` already ships the keyword source; it is inert only because no `autocompletion()` extension is present (realities #7). Defaulting the prop off keeps the cell editor, DDL viewer, document JSON editors and op-log detail rows exactly as they are — a popup in the cell editor would fight the value the user is typing. Gating on a resolved SQL dialect is what stops a **Mongo or Redis console** (both `caps.sql: true`, both currently handed `language="sql"`, realities #10) from offering `SELECT`/`GROUP BY` for a shell command. |
| D11 | **Schema-aware `table.column` completion in the console is explicitly out of scope**, even though `sql({ schema })` would accept it. Only keyword completion ships. | The SPEC line scopes itself — "basic SQL **syntax (keyword)** completion there" — and the gap between the two is not a small one: a useful schema source needs the console's target database/schema resolved, a catalog fetch per connection (an engine round trip this phase otherwise has none of), a cache with an invalidation story against DDL run *in that same console*, and a `SQLNamespace` rebuild on every `search_path`/`USE` change. `sql()` takes `schema`/`defaultTable`/`defaultSchema` config (`lang-sql/dist/index.d.ts:130-170`), so the door stays open for a later phase at the cost of one config object — nothing here forecloses it. |
| D12 | The completion tooltip is themed by extending **`editor/theme.ts`'s `kiraEditorTheme`** with `.cm-tooltip-autocomplete` rules bound to the same `--kira-*` tokens, rather than importing the library's default look. | Every other CodeMirror surface in the app is themed from those tokens (`kiraEditorTheme`, `kiraHighlightStyle`); a default-styled popup would be the only piece of un-themed chrome in the editor, and would ignore the Settings font entirely (the exact class of bug P16 §6 fixed twice). |
| D13 | Candidate lists are **`computed()` per surface**, and the Mongo ones read **`void pageVersion.n;`** before calling `fieldNamesOnPage`. Ranking runs on every keystroke over a list that is at most a few hundred entries. | `fieldNamesOnPage` is a plain function over a non-reactive `Map` — `DocumentView.vue`'s own `projectionCountLabel` already carries this exact `void pageVersion.n;` line for the same reason (realities #3). Without it, the candidate list would freeze at whatever the first loaded page happened to contain. The ranking cost is a linear scan of a few hundred short strings, nowhere near §2.1's budgets, so no memoisation is warranted. |
| D14 | UI coverage is **one new `tests/ui/autocomplete.spec.ts`** with three blocks (SQL filter row, Mongo filter row, console), not additions to `data-view.spec.ts`/`mongo.spec.ts`/`console.spec.ts`. | This is one feature crossing three views, the same shape as `console.spec.ts` (one file for one feature across its surfaces). Splitting it three ways would triple the fixture/connection setup and scatter the D6 Enter-semantics assertions — the single most important thing to test — across three files that each only see one third of them. |

## 4. Implementation order

1. **The primitive.** `theme/primitives/completion.ts` (`tokenAt`, `rankCandidates`, `Completion`)
   then `theme/primitives/AutocompleteField.vue`: `.p-input` chrome, owned `<input>`, `fixed`
   suggestion list (D3), keyboard model (D4/D6), `@mousedown.prevent` rows (D5),
   `inheritAttrs: false` + `v-bind="$attrs"` on the input so `data-testid`/`title` land where
   `TextField`'s do. `role="combobox"`/`aria-expanded`/`aria-autocomplete="list"` on the input,
   `role="listbox"`/`role="option"` + `aria-activedescendant` on the list. Nothing consumes it yet.
2. **SQL filter row.** Create `views/shared/sqlIdent.ts` (move `quoteIdent` out of `gridMenu.ts`,
   add `identNeedsQuoting`; update `gridMenu.ts`'s import — no behaviour change there). Add
   `views/grid/filterCompletion.ts` (D7/D8). In `FilterToolbar.vue`, swap both `<TextField>`s for
   `<AutocompleteField>`, keeping `data-testid="filter-where-input"`/`"filter-orderby-input"` and
   the `:invalid="hasError"` binding, moving `@keydown.esc="onWhereEscape"` → `@escape=` (and the
   ORDER BY mirror), and adding a local `dialect` computed off `connectionsState.records` (the same
   three-line computed `PreviewCommandPanel.vue` and `CellEditorView.vue` already each carry).
   `applyWhere`/`applyOrderBy`/`onClear`/`recordHistory` are untouched.
3. **Mongo filter row.** Add `views/documents/filterCompletion.ts` (D9/D13). In `DocumentView.vue`,
   swap the `document-search` and `document-sort` `<TextField>`s for `<AutocompleteField>`;
   `@keyup.enter="onSearchInput"` becomes `@enter="onSearchInput"` (the component now owns Enter —
   this is the change that makes D6 hold for these two boxes), `@blur` unchanged. `parseSortText`,
   `sortSpecToText`, `onClearFilter` and the history menu are untouched.
4. **Console.** Add `@codemirror/autocomplete@6.20.3` to `devDependencies`. Add the
   `autocomplete?: boolean` prop to `CodeMirrorHost.vue`, appending `autocompletion()` to the
   extension list when set — via a third `Compartment` reconfigured by a `watch`, matching the
   `languageCompartment`/`readOnlyCompartment` pattern already in that file, so the flag can flip
   with the connection kind without recreating the view. Extend `kiraEditorTheme` with the
   `.cm-tooltip-autocomplete` rules (D12). In `ConsoleView.vue`, pass
   `:autocomplete="dialect !== undefined"` (D10).
5. **Tests.** `tests/ui/autocomplete.spec.ts` per D14 — see the checklist in §7.
6. **Docs.** `docs/SPEC.md` status line + the P18 phasing row rewritten from "Not yet implemented"
   to what shipped (the same treatment P17's row got), plus this plan committed alongside.

## 5. Explicitly out of scope

- **Redis, Kafka, SQS and S3 surfaces** (D1) — no free-text identifier input exists in any of them.
  If one is ever added (a Redis `SCAN MATCH` pattern box, say), it inherits `AutocompleteField.vue`
  for free; nothing in this phase needs revisiting first.
- **Schema-aware `table.column` completion in the query console** (D11), and with it: `USE`/
  `search_path` tracking, catalog prefetch, and any completion of table names anywhere.
- **Mongo shell / Redis command completion in the console** — §8.14's "native command form" for
  those engines is not implemented as its own language in the first place (realities #10). This
  phase deliberately turns completion *off* there rather than offering SQL keywords by accident;
  giving them real completion means first giving them a real grammar, which is its own phase.
- **The cell editor, the DDL viewer, the document JSON editors and the op-log detail rows** — all
  keep `autocomplete` at its default `false` (D10).
- **Value completion** (distinct values for a column, enum members, `_id` samples) — the deliverable
  says "field/identifier autocomplete", and value completion would need a real engine query per
  keystroke, which ground rule #2 rules out.
- **Completion inside the pending-changes grid's inline cell editor**, the connection dialog, the
  settings dialog, or any other `TextField` call site. `TextField.vue` is not modified at all.
- **Persisting or ranking by usage history.** The `saved_queries`-backed history menu
  (`views/shared/FilterHistoryMenu.vue`) is the existing answer to "what did I type last time" and
  stays the only one; completion ranking is pure prefix/substring (D-`rankCandidates`).

## 6. Target tree at the end of P18

```
src/renderer/theme/primitives/
  completion.ts               NEW  Completion, tokenAt(), rankCandidates()
  AutocompleteField.vue       NEW  the completing input (D2–D6)
  TextField.vue                --  UNCHANGED (deliberately — §1)
  Popover.vue                  --  UNCHANGED (D3 reuses its technique, not the component)
src/renderer/views/shared/
  sqlIdent.ts                 NEW  quoteIdent (moved from gridMenu.ts) + identNeedsQuoting
src/renderer/views/grid/
  filterCompletion.ts         NEW  whereCandidates/orderByCandidates + the two vocabularies (D7/D8)
  FilterToolbar.vue           MOD  both fields -> AutocompleteField; @escape; local dialect computed
  gridMenu.ts                 MOD  imports quoteIdent from views/shared/sqlIdent.ts (no behaviour change)
src/renderer/views/documents/
  filterCompletion.ts         NEW  mongoFilterCandidates/mongoSortCandidates + operator table (D9)
  DocumentView.vue            MOD  filter + SORT fields -> AutocompleteField; @keyup.enter -> @enter
  docPage.ts                   --  UNCHANGED (fieldNamesOnPage read as-is; _id added by the caller)
src/renderer/editor/
  CodeMirrorHost.vue          MOD  `autocomplete` prop + a third Compartment (D10)
  theme.ts                    MOD  .cm-tooltip-autocomplete rules on kiraEditorTheme (D12)
  languages.ts                 --  UNCHANGED (sql() already registers the keyword source)
src/renderer/views/console/
  ConsoleView.vue             MOD  :autocomplete="dialect !== undefined" (D10)
package.json, bun.lock        MOD  @codemirror/autocomplete promoted to an explicit devDependency
tests/ui/
  autocomplete.spec.ts        NEW  three blocks: SQL filter row, Mongo filter row, console (D14)
docs/
  SPEC.md                     MOD  status line + P18 phasing row
  plans/P18-autocomplete.md   NEW  this document
```

## 7. Acceptance checklist

- [ ] Typing a column-name prefix in `WHERE` lists matching columns (with their `dataType` as
      detail) ahead of matching keywords; Tab inserts one; the resulting filter runs.
- [ ] **`fill('id <= 5')` + `press('Enter')` still applies the filter and inserts nothing** — the
      D6 guarantee — on both SQL boxes and both Mongo boxes, with no edits to
      `tests/ui/data-view.spec.ts` or `tests/ui/mongo.spec.ts`.
- [ ] ArrowDown then Enter accepts a suggestion and does **not** run the query; a second Enter runs
      it.
- [ ] Escape with the list open closes the list and leaves the text alone; Escape with it closed
      still reverts + blurs (`onWhereEscape`'s existing behaviour).
- [ ] Clicking a suggestion inserts it without first applying the pre-completion text (D5).
- [ ] `ORDER BY` completes column names plus `ASC`/`DESC`, and `NULLS FIRST`/`NULLS LAST` only on a
      Postgres connection.
- [ ] A column needing quotes (`"user name"` / `` `user name` ``) is inserted quoted, dialect-
      correctly; a plain lowercase one is inserted bare (D7).
- [ ] Mongo's filter box completes `_id` (D9) and page field names as `name: `, and `$`-tokens
      complete to query operators; the `SORT` box completes field names only and its
      `parseSortText` round-trip still holds.
- [ ] Mongo field candidates refresh after paging to a page with different fields (D13's
      `pageVersion.n` dependency).
- [ ] The console shows SQL keyword completions while typing and on Ctrl+Space, on Postgres and
      MariaDB; `CmdOrCtrl+Return` (Run) still runs with the popup open.
- [ ] A **Mongo or Redis** console shows **no** completions (D10).
- [ ] The cell editor, DDL viewer and document JSON editors show no completion popup.
- [ ] The completion tooltip follows the Settings font and the app's colour tokens (D12).
- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` green including the new spec.

## 8. Open questions for the user

1. **Should `AutocompleteField` eventually replace `TextField` in the connection/settings dialogs?**
   This plan says no (§5) and leaves `TextField.vue` untouched. If the intent is one input primitive
   long-term, the cheaper path is to merge them *after* this phase proves the interaction model,
   not before.
2. **Is D6's "Enter never completes unless you deliberately highlighted something" the wanted
   feel?** It is the compatibility-preserving choice and it is what keeps the existing suite green,
   but it is one keystroke slower than a DataGrip-style preselected first suggestion. Worth
   confirming, since flipping it later means revisiting several existing tests.
3. **How much does schema-aware console completion matter (D11)?** It is the single biggest thing
   this phase leaves on the table, and it is a real feature with a real cost (catalog fetch + cache
   + invalidation). If it is wanted soon it deserves its own phase rather than being smuggled in
   here.
4. **`ILIKE`/`SIMILAR TO`, `NULLS FIRST/LAST` — are dialect-conditional vocabularies worth it (D8),
   or should both SQL dialects share one list?** Splitting them is more correct and slightly more
   code; sharing risks suggesting `ILIKE` on MariaDB, where it is a syntax error.
