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

## 9. Addendum — the console follow-ups: undo/redo, completion latency, uppercase keywords, Mongo/Redis completion, linting

> Filed under P18, not as a new phase: every item below is either a defect in what §4 step 4
> shipped or the other half of a line this plan already owns ("plus the same in the query console").
> D10/D11 and §5's "Mongo shell / Redis command completion in the console" bullet are the entries
> this addendum revisits by name; §3's D1–D14 otherwise stand unchanged, and nothing here touches
> the four plain-text boxes. The ask, verbatim: *"cmd z doesn't work in query console, and the
> autocomplete is slow. not only this, but keywords should be uppercase. also add autocomplete for
> the rest of the connections that have a query console too. make sure all of these are fast and
> smooth. add linting too"*.

### 9.1 Findings (verified against the tree and `node_modules`, not assumed)

**F1 — undo has two independent things wrong with it, and one fix covers both.**
`CodeMirrorHost.vue`'s `onMounted` extension list is `lineNumbers`, `highlightSpecialChars`,
`lineWrapping`, `keymap.of(defaultKeymap)`, the autocomplete compartment, `syntaxHighlighting`,
`kiraEditorTheme`, two more compartments and one `updateListener` — no `history()` state field
anywhere, and `defaultKeymap` contains no `Mod-z`: undo/redo live in a *separate* export,
`historyKeymap` (`@codemirror/commands/dist/index.js:569-575` — `Mod-z`, `Mod-y`/`Mod-Shift-z`,
`Mod-u`). Both come from `@codemirror/commands@6.11.0`, already a direct devDependency, so no new
package. Nothing else supplies a history: `theme.ts` is `EditorView.theme` + `HighlightStyle` only,
`languages.ts` is four grammars, and the renderer registers no global `keydown` handler that could
be swallowing the key (the only four are `ContextMenu.vue`, `Popover.vue`, `DialogFrame.vue` and
`ErrorPopover.vue`, all Escape/arrow handlers on open overlays). The second problem is that
`main/menu.ts:36-37` carries `{ role: 'undo' }` / `{ role: 'redo' }`, which on macOS claim
Cmd+Z/Cmd+Shift+Z as menu key equivalents *before* the keystroke reaches the page — so
`historyKeymap` alone would not be reached there. It does not need to be: `history()` itself
installs `EditorView.domEventHandlers({ beforeinput })` that maps `inputType: "historyUndo"` /
`"historyRedo"` onto its own `undo`/`redo` and calls `preventDefault()`
(`@codemirror/commands/dist/index.js:262-275`), and `webContents.undo()` — what the `undo` role
invokes — is exactly what produces that `beforeinput` in a contenteditable. Adding `history()`
therefore fixes the menu path and the direct-key path at once, with no change to `main/menu.ts`.
This has gone unnoticed because every other host in the app is `read-only: true` (the file's own
comment at line 23 says so).

**F2 — the completion latency is not compute. It is `autocompletion()`'s own debounce.**
Measured on this machine against the real word lists: PostgreSQL's dialect has 831 entries (MySQL
559, StandardSQL 295); for the worst realistic case — a one-character prefix, 311 matches — a full
scan costs 0.055 ms and the `localeCompare` sort of the matches costs 0.039 ms. That is two orders
of magnitude inside §2.1's budgets; the source is not the problem. The delay is
`activateOnTypingDelay: 100` (`@codemirror/autocomplete/dist/index.js:379`), and the completion
plugin **clears and re-arms that timer on every editor update** (ibid. 1176-1182), so for as long
as you keep typing the source never runs at all — the popup appears 100 ms after you *stop*. That
is precisely the reported feel. Only the first open pays it: `completeFromList` returns
`validFor: /\w*$/` (ibid. 121-127), so subsequent keystrokes refilter synchronously without
re-querying. Two secondary knobs contribute: `interactionDelay: 75` makes ArrowUp/ArrowDown and
accept return `false` for 75 ms after the popup opens (ibid. 1077, 1099), and
`maxRenderedOptions: 100` rebuilds up to 100 `<li>` nodes on each re-open (`rangeAroundSelected`,
ibid. 521 and 571).

**F2b — the only per-keystroke Vue work in the editable path is pure waste.** `onDocChange` →
`setText` → `patchConsoleTabState` → `Object.assign(target.state, patch)` on the reactive tab
record. `ConsoleView.vue`'s template reads `tab.state.text` at line 172, so its render effect
re-runs on *every* keystroke, re-diffing the toolbar, the strips, the status line and every mounted
`ConsoleResultGrid`. `CodeMirrorHost`'s own `doc` watcher then hits its equality guard and returns
— the editor is untouched. Persistence is already debounced separately (`saveDebounced`, 1 s,
`state/tabs.ts:107-113`), so the reactive write buys nothing per keystroke that the render costs.

**F3 — uppercase is a single documented config flag.** `sql()` forwards `config.upperCaseKeywords`
into `keywordCompletionSource(lang, upperCase, build)` → `completeKeywords(words, upperCase, build)`
→ `build(upperCase ? keyword.toUpperCase() : keyword, …)`
(`@codemirror/lang-sql/dist/index.js:598-601, 691-692, 717`; the option is typed at
`index.d.ts:166`). Note that `dialect.words` is built from `spec.keywords + spec.types +
spec.builtin` (ibid. 674), so the flag uppercases type names and builtins too, not only reserved
words. CodeMirror's `FuzzyMatcher` case-folds (with a `Penalty.CaseFold` score, ibid. 360-371), so
typing `sel` still matches `SELECT`. The four plain-text boxes P18 already shipped are uppercase by
construction (`WHERE_KEYWORDS` / `ORDER_BY_KEYWORDS` in `views/grid/filterCompletion.ts`) — the
console is the only lowercase completion surface left in the app.

**F4 — what the Mongo and Redis consoles actually accept.** Read, not guessed:
`engine/adapters/mongo/console.ts`'s `parseStatement` requires literally
`db.<collection>.<method>(<args>)` — `expectIdent('db')`, `.`, ident, `.`, ident, `(`, a
comma-separated `parseValue()` list, `)`, then end-of-input — with `method` drawn from a
ten-element `SUPPORTED_METHODS` set (`find`, `findOne`, `insertOne`, `insertMany`, `updateOne`,
`updateMany`, `deleteOne`, `deleteMany`, `countDocuments`, `aggregate`); anything else is
`E_UNSUPPORTED`. `engine/adapters/redis/console.ts`'s `tokenize` is flat whitespace-separated
tokens with `'`/`"` quoting and backslash escapes inside quotes, then `conn.call(command, ...args)`
— i.e. **any** command the server accepts, with a generic RESP-to-page formatter. Neither is SQL,
and `ConsoleView.vue:173` hard-codes `language="sql"` for both (realities #10's wart, still there).

**F5 — Mongo collection names are already in renderer memory; Redis key names are not, and must
not be.** `project/state/tree.ts`'s `treeState.children[rowKey(connectionId, 'database:<db>')]`
holds the collection `TreeNode[]` whenever that database node has been expanded, and P19's group
rows are a pure view over that same array (`toggleGroup`'s own comment), so the flat list is still
there. A console opened from a collection node also names its target in `tab.path`. Redis has no
cheap equivalent: `redis/index.ts`'s `children()` is a SCAN-family walk per namespace level
(`catalog.listNamespaceChildren`), so key-name completion would be an unbounded scan per keystroke
— ruled out by this plan's ground rule #2 and by §2.1.

**F6 — a Mongo/Redis highlighting mode needs no new package, and a per-tab completion source needs
no language surgery.** `StreamLanguage` and `StreamParser` (including `StreamParser.languageData`)
are exported from the already-installed `@codemirror/language@6.12.4` (`index.d.ts:1194`, `1170`).
Separately, `autocompletion({ override })` (config key at `@codemirror/autocomplete/dist/index.js:381`)
replaces language-data sources entirely — which is what lets a tab-specific source (this console's
collection names) arrive as a prop instead of being baked into a language definition that would
then have to be redefined whenever the tree loads.

**F7 — `@codemirror/lint` is not installed at any depth.** `node_modules/@codemirror/` contains
exactly `autocomplete`, `commands`, `lang-json`, `lang-sql`, `lang-xml`, `language`, `state`,
`view`; `bun.lock` has no entry. Latest is `6.9.7`, and its only dependencies are
`@codemirror/state ^6.0.0`, `@codemirror/view ^6.42.0` and `crelt ^1.0.5` — all satisfied by the
pinned `6.7.1` / `6.43.9`. It is a genuine new direct dependency, not a promotion like D10's.

**F8 — Enter currently means two things in the console, and the wrong one wins.** `completionKeymap`
binds `Enter` to `acceptCompletion` at `Prec.highest`
(`@codemirror/autocomplete/dist/index.js:2063-2073`) and `selectOnOpen` defaults to `true`
(ibid. 380), so a popup standing open turns the next Enter into an insertion instead of a newline —
in a *multi-line* editor, which the four plain-text boxes are not. D6 deliberately chose the
opposite rule for those boxes; the console shipped with the library default and is inconsistent with
its own plan. `Tab` is free: `indentWithTab` is a separate `@codemirror/commands` export
(`dist/index.js:1824`) and is not part of `defaultKeymap`.

**F9 — one existing assertion is about to become wrong on purpose.**
`tests/ui/autocomplete.spec.ts:261-287` asserts a Mongo console shows **no** popup, citing D10. D19
below reverses that deliberately; the test is rewritten, not deleted.

**F10 — a pre-existing splitter bug, found here and deliberately not fixed here.**
`ConsoleView.vue` splits *every* engine's console text with `splitSqlStatements`, which splits on
`;`. Two Redis commands on two lines therefore arrive at `redis/console.ts` as a single statement,
and `tokenize` (whose whitespace class includes `\n`) flattens them into one `conn.call` with the
wrong arity. §9.5 records it as out of scope; D24's Redis rule set is shaped so it warns about the
shape rather than pretending to fix it.

### 9.2 Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D15 | **Add `history()` and `keymap.of(historyKeymap)` to `CodeMirrorHost.vue`, inside the existing `readOnlyCompartment`** — that compartment's contents become `[EditorState.readOnly.of(ro), ...(ro ? [] : [history(), keymap.of(historyKeymap)])]`. `main/menu.ts` is **not** touched. | History is a general editor capability, not a console special case, so it belongs in the host (F1). Gating it on `readOnly` is not cosmetic: undo is already inert under `EditorState.readOnly` (`cmd()` bails on `state.readOnly`), but the state field would still accumulate one `ChangeSet` per programmatic doc swap in the definition viewer, the cell editor and the op-log rows — each retaining the previous document — against §2.2's 350 MB target. Reusing the compartment that already exists (rather than a fifth one) keeps one watcher for one concept; the console never flips `readOnly`, so the reset-on-flip is unreachable in practice. Leaving `main/menu.ts` alone is also what keeps this addendum clear of the concurrent P21/P22 menu work. |
| D16 | **Contingency, only if step 1's manual check fails:** if Cmd+Z is still dead on macOS because Blink's own undo stack was empty and `webContents.undo()` dispatched no `beforeinput`, replace `{ role: 'undo' }` / `{ role: 'redo' }` with explicit items that `sendToFocusedWindow(IPC.editUndo / IPC.editRedo)`, add the two channels to `shared/protocol/ipc.ts` and the preload bridge, and route them through `runCommand('edit.undo' / 'edit.redo')`, which `CodeMirrorHost.vue` registers on mount exactly as `ConsoleView.vue` already registers `view.run` / `view.run-all`. | F1's `beforeinput` path is the documented mechanism and is why D15 should be enough, but "should" is not "verified on a Mac", and this environment cannot verify it. Naming the fallback in full — rather than implementing it speculatively — keeps the common case a two-line change and keeps `main/menu.ts` (owned this cycle by the concurrent context-menu-shortcut phase) untouched unless it must be. If it must be, coordinate with that phase before editing the file. |
| D17 | **Tune `autocompletion()` explicitly rather than taking its defaults**: `{ activateOnTypingDelay: 0, interactionDelay: 0, maxRenderedOptions: 25, defaultKeymap: false }`. | Each knob answers a measured cost from F2. `activateOnTypingDelay: 0` is the fix for the actual complaint — the debounce exists to keep *expensive or async* sources off the keystroke path, and every source this app registers is a synchronous lookup over a static array or an already-loaded `TreeNode[]` (0.055 ms + 0.039 ms measured at the worst prefix), with no I/O of any kind. `interactionDelay: 0` is safe only because D18 moves accept off Enter onto Tab: the mis-accept the delay guards against needs a *printing* key to have been in flight, and Tab is not one. `maxRenderedOptions: 25` cuts the per-open DOM build 4× at no cost to the user (the option list is a scrolling window either way, and nobody reads past the 25th SQL keyword). If schema-aware completion is ever added (D11, still out of scope), `activateOnTypingDelay` must be revisited in the same commit — one line at the config site says so. |
| D18 | **`defaultKeymap: false` plus a curated `consoleCompletionKeymap`**: `completionKeymap` minus its `Enter` entry, with `{ key: 'Tab', run: acceptCompletion }` added. Enter keeps meaning newline; Escape, Ctrl-Space/Alt-i, Arrow and Page keys are unchanged. | This is D6 applied to the fifth surface. The console is multi-line — Enter is a text-editing key there in a way it is not in a one-line filter box — and with `selectOnOpen` there is *always* a highlighted option, so the library default silently converts a newline into an insertion after any typing pause (F8). Tab is unbound in the console today (F8), reads as "complete" in every editor a user of this app has met, and matches the `Tab` accept the four plain-text boxes already ship (D6). `Cmd+Return` / `Cmd+Shift+Return` (Run / Run all) are unaffected — they are menu accelerators, not editor keys. |
| D19 | **`languages.ts`'s `sql()` call gains `upperCaseKeywords: true`.** One option, applied for every dialect including `undefined`/StandardSQL. | F3: this is the documented API for exactly this request, it changes both the rendered label and the inserted text, and it is the only place `sql()` is constructed. It uppercases type names and builtins too (`VARCHAR`, `NOW`), which is conventional SQL house style and is what the four plain-text boxes already do. The `keywordCompletion` build callback is the escape hatch if keyword-only uppercasing is ever wanted; noted, not taken. `sql()` is also used by the read-only definition viewer and cell editor, where completion is off (D10), so the flag is inert there. |
| D20 | **`ConsoleView.vue` stops rendering off `tab.state.text`**: `:doc` binds a local `shallowRef` seeded from `tab.state.text`; `onDocChange` writes through `setText` as it does today *and* records the emitted string in a plain module-scope `let`; a `watch(() => props.tab.state.text)` assigns the shallowRef only when the incoming value differs from that last-emitted string. `runStatement`/`runAll` keep reading `props.tab.state.text`. | F2b. The write to tab state stays synchronous, so persistence, `onFlushBeforeClose`, session restore and `ConsoleSavedMenu`'s "save current text" are all bit-for-bit unchanged — the only thing removed is the render effect's dependency on a value that changes on every keystroke. This is §0's no-reactivity rule (D4) applied to the one editable host in the app; a debounced `setText` was considered and rejected because it would put the last few hundred milliseconds of typing at risk on window close for a smaller win. The watcher still exists (external writers — `ConsoleSavedMenu`'s load at line 65, hydration — must still reach the editor) but its callback early-returns, which costs a comparison instead of a subtree diff. |
| D21 | **Mongo console completion**, via a new `'mongo'` `EditorLanguageId` (a `StreamLanguage` for highlighting only) plus a tab-specific source passed as a prop. Candidates are **contextual, in three positions**: after `db.` → collection names; after `db.<collection>.` → the ten supported methods; inside an argument document, on a `$`-prefixed token → the query-operator vocabulary. | The grammar is small, closed and already written down twice (F4), so the completion can be exactly as narrow as the parser — offering a method the engine will reject with `E_UNSUPPORTED` would be worse than offering nothing. Collection names come from `treeState.children` (F5), so there is no new round trip and no new cache; when the database node has not been expanded the source simply returns the methods and operators, which is the honest degradation. The method list moves to `shared/domain/console.ts` as `MONGO_CONSOLE_METHODS` and `engine/adapters/mongo/console.ts` builds `SUPPORTED_METHODS` from it, so the popup and the parser cannot drift. The `$`-operator table moves from `views/documents/filterCompletion.ts` into `views/shared/mongoVocabulary.ts` (the `views/shared/sqlIdent.ts` precedent) and gains a second consumer rather than a second copy. |
| D22 | **Redis console completion**: a new `'redis'` `EditorLanguageId` (`StreamLanguage`, highlighting only) plus a static curated `REDIS_COMMANDS` table — command name, plus a short argument-shape hint as `detail` (`GET key`, `SETEX key seconds value`) — offered **only for the first token of a statement**. **No key-name completion, and no argument completion.** | Commands are the whole vocabulary a `conn.call(command, ...args)` console has (F4), and the arity hint is the part a user actually cannot remember. Restricting to the first token is what keeps the popup out of the way while typing a key or a value — the tokenizer position is trivially derivable from the text before the caret, and it is the difference between a helpful list and a popup over every word. Key names are excluded on measured grounds, not taste: Redis's own tree children are a SCAN walk (F5), and this plan's ground rule #2 forbids the round trip; §9.5 records it. |
| D23 | **Both new modes are `StreamLanguage`s carrying highlighting only** — token classes for strings, numbers, comments, the `db` root, method/command names and `$`-operators — and both are wired **through the same `languageCompartment` that already exists**, by replacing `ConsoleView.vue`'s hard-coded `language="sql"` with a computed that maps the connection kind to `'sql' \| 'mongo' \| 'redis' \| 'plain'`. Completion sources arrive separately, as a new `completionSources?: readonly CompletionSource[]` prop feeding `autocompletion({ override })`. | Fixes realities #10's wart as a side effect of needing per-engine behaviour at all: a Mongo shell command has been coloured by the SQL grammar since P5.5, which mis-highlights `find`/`count` as keywords. `StreamLanguage` needs no new package (F6) and a ~30-line tokenizer per engine is proportionate to grammars this small. Keeping completion *out* of `StreamParser.languageData` and in a prop is what lets the Mongo source depend on the tab's own collection list without redefining a language every time the tree loads (F6); the SQL path keeps using language data (`override` absent), so D10's wiring is untouched. |
| D24 | **Linting means inline CodeMirror diagnostics for the console's own statement text, scoped per engine and deliberately lexical/shape-level only.** New direct dependency `@codemirror/lint@6.9.7`. A new `lintSource?: (doc: string) => ConsoleDiagnostic[]` prop on `CodeMirrorHost.vue` (plain strings in, `{from, to, severity, message}` out — the host wraps it in `linter(..., { delay: 400 })` in a fourth compartment). Rules: **SQL** — unterminated `'…'`, `"…"`, `` `…` ``, `$tag$…$tag$` and `/* … */`; unbalanced parentheses within a statement. **Mongo** — statement must match `db.<ident>.<ident>( … )`; method must be in `MONGO_CONSOLE_METHODS`; brackets/quotes balanced. **Redis** — unterminated quoted string; a warning when one `;`-separated statement spans more than one non-empty line. | This is a query editor, so "linting" can only mean "tell me my statement is broken before I run it" — biome already lints the app's own source (`bun run lint`) and has nothing to do with the text in this box. The rules are drawn from what the engines themselves reject (`redis/console.ts` throws exactly `unterminated quoted string`; `mongo/console.ts` throws exactly `unsupported console method: db.x.y()`, and the diagnostic reuses that wording so the inline message and the error strip agree), so a diagnostic can never contradict the adapter. **Deliberately not used: the Lezer SQL tree's error nodes.** One grammar serves every dialect — `SQLDialect.define` varies only the tokenizer's word list (`lang-sql/dist/index.js:668-684`) — so error nodes would flag valid dialect-specific syntax the grammar does not model, and a false red squiggle on working SQL is worse than no squiggle at all. A purely lexical check cannot false-positive on valid SQL of any dialect. **Also deliberately not done: validating Mongo argument documents.** That parser is `engine/adapters/mongo/literal.ts`, which the renderer must not import (§2.1's "the renderer never imports a database driver and never parses a wire protocol" and the process boundary generally); re-implementing it renderer-side would be a second grammar to keep in sync, which is exactly the drift D21 avoids for methods. |
| D25 | **No lint gutter** (`lintGutter()` is not used) and **no lint panel/keymap**; diagnostics show as an underline plus a hover tooltip. Both are themed by extending `kiraEditorTheme` with `.cm-lintRange-error` / `.cm-lintRange-warning` / `.cm-diagnostic*` / `.cm-tooltip-lint` rules bound to `--kira-error`, `--kira-warn` and `--kira-bg-elevated`, using `textDecoration: underline wavy` with `backgroundImage: none` rather than the library's hard-coded SVG data-URI squiggle. | Same reasoning as D12, and as the "there is no editor status line" law: a second gutter beside `lineNumbers()` costs permanent horizontal space for information an underline already carries, and the library's default squiggle is a fixed-colour raster that would be the one piece of un-themed chrome in the editor. Verify the exact base-theme selectors against the installed package when the dependency lands — they are the one thing here that could not be read ahead of time (F7). |
| D26 | **A fifth block in `tests/ui/budgets.spec.ts`: "console keystroke → completion popup visible"**, measured the same way as the existing four (last keypress → `.cm-tooltip-autocomplete` present in the DOM, 20 samples), asserted at **p50 ≤ 50 ms** against §2.1's interaction class, with p95 logged for `docs/PERF.md` and a max-sample regression guard. | "Fast and smooth" is only a requirement if it is a number someone can fail. This is the one assertion that would have caught the 100 ms debounce, and it is the one that stops a future schema-aware source from quietly reintroducing it. It belongs in `budgets.spec.ts` (real §2.1 measurements) rather than `perf.spec.ts` (cheap tripwires), per that file's own P12 D7 split. |

### 9.3 Shapes introduced

```ts
// src/renderer/editor/CodeMirrorHost.vue — three new props, all defaulting off
/** Replaces language-data sources when non-empty (autocompletion({ override })) — the Mongo/Redis
 *  consoles pass a tab-specific source here; SQL passes nothing and keeps lang-sql's own. */
completionSources?: readonly CompletionSource[];
/** Pure text in, diagnostics out. The host owns linter()/compartment/theming — callers never see
 *  an EditorView. */
lintSource?: (doc: string) => ConsoleDiagnostic[];
```

```ts
// src/renderer/editor/diagnostics.ts
export interface ConsoleDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}
```

```ts
// src/shared/domain/console.ts  (additions — engine and renderer share one list, D21)
/** The shell methods mongo/console.ts dispatches. Its SUPPORTED_METHODS is built from this, so a
 *  completion can never offer a method the parser rejects. */
export const MONGO_CONSOLE_METHODS: readonly string[];
```

```ts
// src/renderer/views/shared/mongoVocabulary.ts   ($-operators move here from views/documents/)
export const MONGO_QUERY_OPERATORS: readonly string[];
```

```ts
// src/renderer/views/console/completion.ts
/** null for postgres/mariadb (lang-sql's own language-data source stays in charge, D23). */
export function consoleCompletionSources(
  kind: ConnectionKind, connectionId: string | null, path: string,
): readonly CompletionSource[] | undefined;
```

```ts
// src/renderer/views/console/lint.ts        dispatches on engine kind
// src/shared/domain/sql-lint.ts             lexical SQL checks (D24) — sibling of sql-split.ts,
//                                           same lexical states, no grammar
```

### 9.4 Implementation order

Each step is independently verifiable; run `bun run lint`, `bun run typecheck` and `bun run build`
after every one, and `xvfb-run -a bun run test:ui` from step 6 on. No adapter behaviour changes, so
`bun run test:db` stays green throughout — but step 5 edits `mongo/console.ts`, so run it there.

1. **Undo/redo (D15).** `CodeMirrorHost.vue` only: import `history`, `historyKeymap` from
   `@codemirror/commands`, fold them into `readOnlyCompartment`'s contents and its `watch`.
   *Verify by hand:* type in a console, Cmd+Z (menu **and** keystroke), Cmd+Shift+Z; confirm the
   definition viewer and cell editor are unaffected. If the menu path is dead, stop and take D16
   before continuing — and coordinate on `main/menu.ts` first.
2. **Completion tuning + keymap (D17/D18).** `resolveAutocomplete()` in `CodeMirrorHost.vue`: the
   config object, `defaultKeymap: false`, and `consoleCompletionKeymap`. Still SQL-only at this
   point. *Verify by hand:* the popup now tracks typing instead of trailing it; Enter inserts a
   newline with the popup open; Tab accepts; Escape dismisses; Cmd+Return still runs.
3. **Uppercase (D19).** One line in `languages.ts`.
4. **Console render decoupling (D20).** `ConsoleView.vue` only.
5. **Per-engine language + completion (D21/D22/D23).** In order: `MONGO_CONSOLE_METHODS` into
   `shared/domain/console.ts` and `mongo/console.ts` rebuilt on it (no behaviour change — assert
   with `bun run test:db`); `views/shared/mongoVocabulary.ts` extracted and
   `views/documents/filterCompletion.ts` re-pointed at it (no behaviour change); the two
   `StreamLanguage`s and the two new `EditorLanguageId`s in `languages.ts`; the
   `completionSources` prop and its compartment in `CodeMirrorHost.vue`;
   `views/console/completion.ts`; `ConsoleView.vue`'s `language` computed replacing the hard-coded
   `"sql"`.
6. **Tests for steps 1–5.** Rewrite `tests/ui/autocomplete.spec.ts`'s fourth block (F9) from "Mongo
   shows no popup" to "Mongo completes collection names and methods"; add a Redis block; add an
   undo/redo block to `tests/ui/console.spec.ts`. `mongo.spec.ts` and `redis.spec.ts` need no edits
   — both drive the console with `.type()` + a Run **click**, never Enter (checked).
7. **Lint (D24/D25).** Add `@codemirror/lint@6.9.7` to `devDependencies`; `editor/diagnostics.ts`;
   `shared/domain/sql-lint.ts`; `views/console/lint.ts`; the `lintSource` prop, its compartment and
   the `linter(..., { delay: 400 })` wiring in `CodeMirrorHost.vue`; the theme rules in `theme.ts`
   (verify the base-theme selectors against the newly installed package). Then a lint block in
   `tests/ui/autocomplete.spec.ts` per engine.
8. **The budget assertion (D26)** in `tests/ui/budgets.spec.ts`, and a line in `docs/PERF.md` if
   that file records the other four.
9. **Docs.** SPEC.md §8.15 and the P18 phasing row edited **in place** (the row currently claims
   the console's completion is "gated to connections with a resolved SQL dialect so a Mongo/Redis
   shell console never offers SQL keywords", which D21/D22 make false). No new phasing row, no new
   plan file.

### 9.5 Explicitly out of scope

- **Schema-aware `table.column` completion in the console.** D11 and §8's open question 3 stand
  unchanged; nothing here forecloses it, and D17 names the one knob that must be revisited with it.
- **Redis key-name completion** (D22/F5) and **Mongo field-name completion inside a console filter
  document.** The first needs a SCAN walk per keystroke; the second needs a loaded page, which a
  console tab does not have (`runtime[tabId]` holds result `Page[]`, not a described collection) —
  the document *view*'s filter box already has it (D9) because it does.
- **`ConsoleView.vue`'s SQL-only statement splitter (F10).** Redis commands on separate lines are
  flattened into one wrong-arity `conn.call`; Mongo's `;` splitting happens to be right. Fixing it
  means a per-engine `splitStatements(kind, text)` and a matching `statementAtCursor`, which
  changes what Run/Run all *execute* — a behaviour change with its own test surface, and not what
  was asked for. D24's Redis warning tells the user about the shape without pretending to fix it.
- **Any adapter, IPC, storage or tab-schema change.** Step 5's `mongo/console.ts` edit rebuilds
  `SUPPORTED_METHODS` from a shared constant containing the same ten strings; nothing else in
  `src/engine` or `src/main` is touched (D16's contingency excepted, and only if forced).
- **Undo history that survives a tab switch.** `MainView.vue` keys the console by `tab.id`, so the
  editor remounts and the history starts fresh. Persisting it would mean serialising `historyField`
  into `ConsoleTabState` — a tab-schema change, and one nobody asked for.
- **Linting anything but the console.** The `lintSource` prop defaults to undefined, so the
  definition viewer, cell editor, document editors and op-log rows stay exactly as they are.
- **Semantic SQL validation of any kind** (unknown table/column, type checking, "did you mean"),
  Mongo argument-document validation, and Redis unknown-command/arity checks (D24). The server is
  the authority on all three, and a curated Redis command list would flag valid module and
  version-specific commands as errors.
- **A Settings toggle for completion or linting.** Neither is configurable; if that is wanted it is
  a settings-schema change, not part of this.
- **The four plain-text boxes.** `AutocompleteField.vue`, both `filterCompletion.ts` files and
  `completion.ts` change only where step 5 moves `MONGO_QUERY_OPERATORS` out of one of them, with
  no behaviour change.

### 9.6 Verification checklist

- [ ] Cmd+Z / Ctrl+Z undoes in the query console, from **both** the keystroke and the Edit ▸ Undo
      menu item; Cmd+Shift+Z (and Ctrl+Y on non-mac) redoes; undo is grouped sanely (a run of typed
      characters is one step, not one per character).
- [ ] Undo after loading a saved query restores the previous console text, and does not leave the
      cursor at 0 in a document it did not reset.
- [ ] The definition viewer, cell editor, document editors and op-log detail rows are unchanged —
      no history field, no popup, no diagnostics.
- [ ] The completion popup appears **while** typing, not after a pause, on Postgres and MariaDB;
      `budgets.spec.ts`'s new block reports p50 ≤ 50 ms.
- [ ] ArrowDown/ArrowUp respond immediately on the first frame the popup is visible (D17's
      `interactionDelay`).
- [ ] Keyword and type completions insert **UPPERCASE** (`SELECT`, `VARCHAR`), and typing lowercase
      `sel` still matches `SELECT`.
- [ ] With the popup open, **Enter inserts a newline**; Tab accepts; Escape dismisses; Ctrl-Space
      opens explicitly; `Cmd+Return` / `Cmd+Shift+Return` still run.
- [ ] A **Mongo** console completes collection names after `db.`, the ten supported methods after
      `db.<collection>.`, and `$`-operators on a `$` token — and offers **no SQL keywords anywhere**.
- [ ] A Mongo console whose database node was never expanded still completes methods and operators
      (F5's degradation), with no error and no round trip.
- [ ] A **Redis** console completes command names on the first token of a statement only, with the
      argument hint as detail, and offers nothing on later tokens.
- [ ] Mongo and Redis console text is highlighted by its own mode — `find` is no longer coloured as
      a SQL keyword.
- [ ] Diagnostics: an unterminated `'` and an unbalanced `(` are flagged in SQL; `db.x.fnid(` and
      `db.x.upsert({})` are flagged in Mongo, with `upsert` reported in the same words the adapter
      uses; an unterminated quote is flagged in Redis and a two-line statement warns.
- [ ] No diagnostic appears on any statement that then runs successfully — checked against the
      statements `console.spec.ts`, `mongo.spec.ts` and `redis.spec.ts` already execute.
- [ ] The lint underline and its tooltip follow the app's colour tokens and the Settings font; there
      is exactly one gutter (line numbers).
- [ ] `tests/ui/autocomplete.spec.ts`'s Mongo block asserts the new behaviour (F9); `mongo.spec.ts`,
      `redis.spec.ts`, `console.spec.ts` and `data-view.spec.ts` need no edits beyond the new
      console.spec.ts undo block.
- [ ] `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` and `bun run test:db` green.
- [ ] `package.json`/`bun.lock` show exactly one added dependency (`@codemirror/lint`).

### 9.7 Open questions for the user

1. **Tab, not Enter, accepts a completion in the console (D18) — confirm.** It is what makes the
   console obey this plan's own D6 and what keeps Enter usable as a newline in a multi-line editor,
   but it is one keystroke different from VS Code's default, where Enter also accepts.
2. **`upperCaseKeywords: true` uppercases type names and builtins too** (`VARCHAR`, `NOW`, `COALESCE`),
   not only reserved words (F3). That is conventional SQL style and matches the WHERE box, but if
   only reserved words should be uppercased, say so — it is a custom `keywordCompletion` build
   callback rather than a flag, and worth deciding before it ships rather than after.
3. **Is the Redis splitter bug (F10) wanted as a follow-up?** Today a Redis console only works with
   `;` between commands, and a newline silently produces a wrong-arity call. It is a real defect,
   it is adjacent to this work, and it is deliberately left alone here because fixing it changes
   what Run executes.
4. **Should the console's diagnostics be surfaceable as a list**, not just as underlines? D25 says
   no gutter and no lint panel. For a query box that is almost always a handful of lines that seems
   right; for a long "Run all" script it may not be.
