# P18 — SQL language server, EXPLAIN analysis, and auto-explain

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:33`, P18 row): *"Build a SQL language
> server (completions, diagnostics, hovers — whatever a language server conventionally provides)
> covering the SQL dialects this app supports, driven purely by user-supplied DDL rather than a live
> database connection — no schema introspection over a real connection, the user provides table/column
> definitions and the language server works from those alone. Separately, add an "Explain" button that
> runs the database's own EXPLAIN (or dialect equivalent) against the current query, parses its output,
> and presents it in a readable, actionable form that calls out real issues — missing indexes, full
> scans, expensive operations — rather than a raw plan dump; this needs a configurable threshold for
> what counts as an "expensive" query, used both to flag a given Explain result and to decide when
> auto-explain (below) should surface a warning. In each connection's edit form, add a toggle to enable
> auto-explain: automatically run Explain against every SELECT query issued on that connection."* Why:
> *"Two related but independently valuable capabilities — offline SQL tooling and real query-plan
> visibility — that make the console meaningfully more useful for understanding and writing correct,
> efficient queries."*
>
> **Headline 1 — the language server should not be a language server, and the reason is not laziness:
> the entire DDL-driven completion engine the SPEC describes is already sitting in a package this app
> has bundled since P5.5.** `@codemirror/lang-sql@6.10.0` exports `schemaCompletionSource(config)` and
> the `SQLNamespace` type it takes — *"You can use this to define the schemas, tables, and their fields
> for autocompletion"* (**[verified in source]**, `node_modules/@codemirror/lang-sql/dist/index.d.ts`) —
> plus `keywordCompletionSource(dialect, upperCase)` as a separately-callable source. It resolves
> `schema.table.column` paths, and it resolves **table aliases**: `getAliases` (`dist/index.js:425-457`)
> walks the statement from the `from` keyword, records `users u` and `users AS u` alike, and
> `completeFromSchema` (`:552-574`) rewrites a single-segment parent through that alias map before
> looking a table up. That is the whole of what an LSP `textDocument/completion` handler for SQL does,
> already written, already in the bundle, already dialect-parameterised.
>
> **Headline 2 — the DDL parser is in the bundle too, and it is the same object.** Each `SQLDialect`
> exposes `dialect.language.parser`, a per-dialect Lezer grammar. **[verified here]** parsing
> `CREATE TABLE public.users (id integer NOT NULL PRIMARY KEY, email varchar(255) UNIQUE, "createdAt"
> timestamptz DEFAULT now());` with `PostgreSQL.language.parser` yields
> `Statement → Keyword("CREATE") Keyword("TABLE") CompositeIdentifier("public.users") Parens(…)`, with
> every column separated by a top-level `Punctuation(",")`, nested type arguments in their own `Parens`
> node, and comments already tokenised out. It does the same for MySQL backtick DDL and for this repo's
> own hand-defined `ClickHouseDialect` — `tags Array(LowCardinality(String))` comes back as
> `Identifier("tags") Type("Array") Parens("(LowCardinality(String))")`. A DDL→schema extractor built
> on that tree costs **zero new dependency bytes** and inherits each dialect's own quoting, comment and
> backslash-escape rules instead of re-deriving them.
>
> **Headline 3 — the real language-server candidates are all worse, and two are disqualifying.**
> **[verified here]** against the npm registry: `sql-language-server@1.7.1` was last published
> **2024-11-14** and its runtime dependencies include `pg`, `mysql2`, `sqlite3` (a native module),
> `@google-cloud/bigquery`, `node-ssh-forward` and `jest` — it is a Node process whose entire value
> proposition is *live-connection introspection*, the one thing this SPEC row forbids, and P58f M10
> deleted the vendored Node runtime it would need. `node-sql-parser@5.4.0` (Apache-2.0, actively
> maintained) is a genuine AST parser, but **[verified here]** its four reachable per-dialect builds
> minify+bundle to **1 085 971 B raw / 237 008 B gzip** — 71 % of the whole current app bundle, six
> times P13's `sql-formatter` chunk — and it **has no ClickHouse dialect at all**
> (`build/` holds athena, bigquery, db2, flinksql, hive, mariadb, mysql, noql, postgresql, redshift,
> snowflake, sqlite, transactsql, trino). `sql-parser-cst@0.42.1` is **GPL-2.0-or-later**, which this
> MIT product cannot take.
>
> **Headline 4 — every dialect's best structured EXPLAIN comes back through the console's existing
> `data:execute` op as an ordinary `TabularPage`, so Half B needs no adapter method, no `Caps` field,
> no `.fbs` edit and no fixture regeneration.** **[verified here]** against real containers: Postgres
> 18 `EXPLAIN (FORMAT JSON)` → 1 row × 1 column `QUERY PLAN`; MySQL 8.4 and MariaDB 11.4
> `EXPLAIN FORMAT=JSON` → 1 × 1; ClickHouse 26.3 `EXPLAIN PLAN json=1, indexes=1` → 1 × 1 column
> `explain` of type `String` **through the adapter's own `JSONCompactStringsEachRowWithNamesAndTypes`
> wire format**; SQLite `EXPLAIN QUERY PLAN` → N rows × 4 columns `(id, parent, notused, detail)`.
>
> **Headline 5 — a cross-dialect *cost* threshold is not definable, and this plan does not pretend
> otherwise.** **[verified here]**, for a comparable full-table scan: MariaDB 11.4 reports
> `"cost": 16.5855622` over 100 175 estimated rows while MySQL 8.4 reports
> `"query_cost": "6304.55"` over 62 643 — the same JSON key name in two forks, three orders of
> magnitude apart, because MariaDB 11.x's cost model is approximately *seconds* and MySQL's is its own
> unit. **SQLite reports no cost and no row estimate at all**, and **ClickHouse's `EXPLAIN PLAN`
> reports no cost either**. So the configurable threshold is an **estimated-rows-read** threshold, in
> one unit that four of the five dialects genuinely report, with each dialect's own native cost still
> *displayed* verbatim and explicitly never compared across engines. §5's D14 carries the full
> argument.
>
> **Headline 6 — `EXPLAIN` without `ANALYZE` is cheap, measured, so auto-explain does not double
> query cost.** **[verified here]** on Postgres 18: the query took **642.5 ms**, its
> `EXPLAIN (FORMAT JSON)` took **0.791 ms** — 800×. On MariaDB 11.4 the same comparison was ~1.18 s
> against ~0.14 s (wall clock including `docker exec` overhead both times, so the real ratio is
> larger). No `ANALYZE`/`ANALYZE FORMAT=JSON`/`EXPLAIN ANALYZE` variant is used anywhere in this
> phase — every one of them executes the statement, which is exactly the cost auto-explain must not
> pay.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `25ccd44` (`test(ui): P9's row-colouring toggle now applies on Save`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1–P17 have landed.

Three recently-landed phases matter here, and only one of them is a constraint:

- **P13 (`docs/v1.1/plans/P13-query-console-format-button.md`) is the phase this one sits beside.**
  It landed `sql-formatter@15.8.2` behind a lazily-imported entry module, `views/console/format.ts`,
  `views/console/mongoStatement.ts`, the `view.format` command through its seven-file path, and a
  `MessageStrip` failure model in the console's `#strips` slot. Its **OQ-5** hands this phase a direct
  question — *"If [P18] brings its own SQL parser into the renderer, that parser and `sql-formatter`'s
  are two grammars for the same five dialects in one bundle. P18 should check whether its parser can
  also produce the formatted text before adding a second one"* — and §3 answers it: **P18 adds no
  parser at all**, so there is no second grammar and nothing of P13's to retire. Its **OQ-2** (the
  caret jumping to offset 0 on every external write) is likewise not made worse here: nothing in this
  phase writes the console document.
- **P17 (`docs/v1.1/plans/P17-settings-apply-on-save.md`) already anticipated this phase's settings
  leaf** and states outright: *"The staging design is written generically over the section objects, so
  P18's own settings (P18's SPEC row wants a configurable 'expensive query' threshold) and every leaf
  after it need no edit here at all."* §5's D20 takes it at its word — and finds it true for the
  mechanism and not quite true for the markup.
- **P14 (`docs/v1.1/plans/P14-credential-reveal-confirmation.md`) is where the connection edit form's
  current shape comes from.** The auto-explain toggle is a fourth control in that form, written in the
  established `<label class="field checkbox">` + `helper-text` shape the *Read-only* and
  *Keep it running…* checkboxes already use (`ConnectionDialog.vue:552-556`, `:571-583`).

### 0.2 Scope

**Half A — an in-editor SQL language service, driven by user-supplied DDL.**

1. A per-connection **DDL document**: a new `connection_ddl` table, a `SchemaService` bridge, and a
   **Schema (DDL)…** dialog reached from the connection's own tree context menu — modelled end to end
   on the existing `connection_filters` / `bridge/filters.go` / `repos/filters.go` /
   `openFiltersDialog` / `FiltersDialog.vue` chain.
2. A **DDL→schema extractor** over `@codemirror/lang-sql`'s own per-dialect Lezer parser, producing
   the `SQLNamespace` shape `schemaCompletionSource` consumes plus an app-side `DdlSchema` model the
   diagnostics and hover providers read.
3. **Completions**: schema-aware table/column/alias completion in the SQL query console, composed with
   the keyword completion that ships today, through the console's existing `completionSources` prop.
4. **Diagnostics**: unknown-relation and unknown-qualified-column **warnings** layered on top of
   today's lexical `lintSql`, offered only while a DDL document exists for that connection.
5. **Hovers**: `hoverTooltip` over an identifier — a table's column list, or a column's declared type
   — using `@codemirror/view`, already a dependency.

**Half B — EXPLAIN analysis and auto-explain.**

6. An **Explain** button in the SQL console toolbar that composes the dialect's best structured
   EXPLAIN for the statement at the cursor, issues it through the existing `data:execute` op, parses
   the result into one normalized plan model, and shows it as a **plan-kind result set** in the
   console's existing result strip.
7. **Issue detection** per dialect, from fields that dialect actually reports — full scans, an index
   that existed but was not chosen, temp-b-tree sorts/groups, a primary key that did not narrow the
   read, and an estimated read above the threshold.
8. A configurable **`advanced.expensiveQueryRows`** settings leaf, used both to flag a plan and to
   decide when auto-explain warns.
9. A per-connection **auto-explain** toggle (a new first-class `connections` column, not an
   `options_json` key — D18), which runs the same EXPLAIN before each SELECT a console run issues and
   surfaces a strip when the threshold is exceeded.

### 0.3 Not in this phase

- **A language-server-protocol process, an LSP client, or a Web Worker.** D1 carries the argument in
  full. Nothing in this phase spawns a process, opens a port, or speaks JSON-RPC.
- **Schema introspection over a live connection, of any kind.** The SPEC row forbids it in so many
  words. Note that the app *already has* live column metadata in reach — `runtime[tabId].meta`, filled
  by `treeDescribe` through the L1 cache, is what `views/grid/filterCompletion.ts:29-41` completes the
  WHERE/ORDER BY boxes from — so this is a deliberate constraint, not an unavailability. §5's D5 states
  where the line falls and why the console does **not** quietly fall back to it.
- **Completion in the WHERE/ORDER BY filter boxes.** They are single-line `AutocompleteField` inputs
  with their own curated vocabulary and their own already-shipped column source
  (`filterCompletion.ts`); pointing them at a DDL document instead would be a regression for every
  connection with no DDL written. OQ-1 records the additive version.
- **Mongo/Redis console changes.** Their completion sources (`views/console/completion.ts:41-81`,
  `:126-141`) and their linters (`lint.ts:84-133`, `:138-184`) are untouched. "SQL language server"
  means the five SQL dialects.
- **Formatting.** P13 shipped it; nothing here replaces or extends it.
- **`EXPLAIN ANALYZE` / `ANALYZE FORMAT=JSON` / `EXPLAIN (ANALYZE)`.** Every one of them executes the
  statement. Postgres' own manual is explicit: *"The `ANALYZE` option causes the statement to be
  actually executed, not only planned … Although `EXPLAIN` will discard any output that a `SELECT`
  would return, other side effects of the statement will happen as usual."* Out of scope; OQ-6.
- **Explaining anything but a `SELECT`/`WITH`.** D12. Auto-explain's own SPEC wording is "every SELECT
  query", and holding the manual button to the same rule means one explainability test, not two.
- **A plan diff, a plan history, or saving a plan.** Nothing is persisted; a plan is runtime-only, like
  every other console result set.
- **Any change to the FlatBuffers wire schema.** F18/D11: every dialect's structured EXPLAIN already
  crosses the wire as an ordinary `TabularPage`, so `packages/shared/protocol/wire.fbs`,
  `bun run generate:wire` and the six committed `tests/ipc/*.fixture.ts` files are all untouched.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim below is **[verified in source]** against this
  tree at the cited `file:line`, **[verified here]** where it was executed in this sandbox (against
  real Postgres 18.x, MySQL 8.4.11, MariaDB 11.4.13 and ClickHouse 26.3.28.5 containers, and against a
  real `modernc.org/sqlite` database), or **[docs]** with the source named.
- **No new dependency.** Half A adds none (F1–F5, F9). Half B adds none (F18). If either half turns
  out to need one at implementation time, that is a finding to bring back, not a decision to make in
  passing.
- **No new abstraction where one exists.** The DDL surface is `FiltersDialog.vue`'s shape; the failure
  strip is P13's `MessageStrip` in `#strips`; the diagnostic type is `ConsoleDiagnostic`; the plan
  result set is `ConsoleResult` with one more field; the settings leaf is one more key in an existing
  section object.
- **A false positive is worse than a missing diagnostic.** A language service that underlines valid
  SQL will be turned off and never turned back on. Every diagnostic rule in D7 is bounded by what the
  DDL can actually prove, and every one of them is a **warning**, never an error.
- **Unit tests only where `AGENTS.md`'s bar is genuinely met.** Two are earned and named in D21; the
  rest of the phase is covered by `tests/ui/`.
- **Comments only where the code cannot say it for itself.** Five are owed and each is named at its
  decision.

### 0.5 This phase should be implemented in two sequential Sonnet passes, not one

The two halves share exactly three files — `ConsoleView.vue` (a toolbar button and a strip each),
`views/console/state.ts` (a runtime field each) and `packages/shared/domain/…` (one schema each) — and
nothing else. Everything else is disjoint: Half A is `connection_ddl` + a dialog + three CodeMirror
providers; Half B is a statement composer + five parsers + a plan view + a settings leaf + a
connections column.

**The recommendation is two sequential Sonnet subagent runs against this one plan document**, not two
plan documents and not two parallel agents:

- **Pass 1 = §6.1, commits C1–C7** (the language service). Ends on a green tree with every check in
  §7.4 passing.
- **Pass 2 = §6.2, commits C8–C15** (EXPLAIN, the threshold, auto-explain). Written against whatever
  pass 1 actually landed — in particular against pass 1's final `ConsoleView.vue` toolbar, which pass 2
  adds a second button to.

Sequential, not parallel, because both passes edit `ConsoleView.vue`'s `#toolbar` and `#strips` slots
and both add a field to `ConsoleViewRuntime` — `AGENTS.md`'s own rule (*"never split a single
continuous, order-dependent piece of work across subagents just to run it concurrently"*) applies to
exactly this. The split earns its keep for a different reason: each pass is independently shippable
and independently revertible, and a Sonnet subagent carrying fifteen commits' worth of context across
two unrelated subsystems is where a phase this size goes wrong.

---

## 1. What the code does today

### 1.1 The console's editor stack, end to end

**[verified in source]** One component hosts every CodeMirror surface in the app:
`editor/CodeMirrorHost.vue`. It takes `doc`, `language`, `sqlDialect`, `readOnly`, `autocomplete`,
`completionSources`, `lintSource` and `singleLine`, and owns five `Compartment`s (language, read-only,
autocomplete, lint, word wrap) reconfigured from five `watch`es (`:230-268`). Everything below is
reached only through those props.

| Concern | Where | Shape today |
|---|---|---|
| Grammar | `editor/languages.ts:143-174` | `languageExtension(id, dialect)` → `sql({dialect, upperCaseKeywords: true})` for the four SQL dialects; a hand-written `StreamLanguage` for mongo/redis |
| ClickHouse grammar | `languages.ts:112-136` | `SQLDialect.define({backslashEscapes, hashComments, doubleQuotedStrings:false, identifierQuotes:'`"', keywords, types})` — defined in-repo because lang-sql vendors none |
| Completion | `CodeMirrorHost.vue:125-143` | `autocompletion({activateOnTypingDelay:0, interactionDelay:0, maxRenderedOptions:25, defaultKeymap:false, override: completionSources?.length ? [...] : undefined})` |
| SQL completion source | — | **none of this app's own.** `consoleCompletionSources` (`views/console/completion.ts:145-153`) returns `undefined` for the five SQL kinds, which leaves `override` undefined, which leaves lang-sql's own language-data keyword source in charge |
| Diagnostics | `CodeMirrorHost.vue:149-164` | `linter(view => lintSource(doc).map(…), {delay: 400})`; no gutter, no panel, underline + hover tooltip only |
| SQL diagnostics | `views/console/lint.ts:9-12`, `:188-195` | `lintSql(text, {backslashEscapes})` from `packages/shared/domain/sql-lint.ts` |
| Hovers | — | **none anywhere in the app.** `hoverTooltip` is never imported |

### 1.2 What SQL completion exists today, and what it is not

**[verified in source]** For a Postgres/MariaDB/MySQL/SQLite/ClickHouse console, `sql()` is called
with `{dialect, upperCaseKeywords: true}` and **no `schema` key**. `sql()`'s own implementation
(`dist/index.js:699`) returns a schema completion source *only* `if (config.schema)` — so today the
console offers **the dialect's keyword and type-name list and nothing else**. There is no table
completion, no column completion, no alias resolution and no hover in any SQL console. That is the
whole gap this half fills.

Two SQL surfaces in the app *do* have identifier completion, and neither is the console: the grid's
WHERE/ORDER BY boxes (`views/grid/filterCompletion.ts`, from `runtime[tabId].meta?.columns`) and the
Mongo console (`completion.ts:41-81`, from the tree's own cached children).

### 1.3 The three constants a DDL-driven service must respect

**[verified in source]** `views/shared/sqlIdent.ts` is the one place a kind becomes a dialect and the
one place an identifier gets quoted:

- `SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'clickhouse'` (`:25`) — **MariaDB and MySQL
  deliberately collapse into `'mysql'`** (`:6-15`: a quoting-and-grammar *family*, not a product).
- `quoteIdent(dialect, name)` — backtick for `mysql`/`clickhouse` (`BACKTICK_DIALECTS`, `:47`),
  double-quote otherwise.
- `identNeedsQuoting(dialect, name)` — false for a bare lowercase non-reserved identifier, so a
  completion accept inserts `status`, not `"status"`.
- `backslashEscapesFor(dialect)` — the lexical regime `sql-split.ts` and `sql-lint.ts` share.

`lang-sql`'s own `schemaCompletionSource` does its own quoting from `dialect.spec.identifierQuotes`
(`maybeQuoteCompletions`, `dist/index.js:458-460`), which is the same answer `quoteIdent` gives for
all four dialects — see D6 for why that is checked rather than assumed.

### 1.4 The console execute path, end to end

**[verified in source]**, renderer → server and back:

```
ConsoleView.runStatement()          statementAtCursor(text, cursorPos, {backslashEscapes})
  → views/console/state.ts run()    one data.execute({opId, tabId, connectionId, path, statements})
  → bridge/data.ts:46               DATA_OP.execute, NO_TIMEOUT
  → adapterhost/dataframe.go:~178   case "data:execute" → decodeAndValidate → Dispatcher.Execute
  → adapterhost/data.go:197-225     Host.RunOp{Kind:"execute"} → adapter.Execute(ConsoleRequest)
  → <adapter>/console.go            one Page per statement, all-or-nothing
  → adapterhost/frame.go:53-62      ExecuteResponse → FlatBuffers `pages` vector
  → state.ts run()                  setPage(resultPageKey(tabId, seq++), page) per page
```

Two properties of that path this phase depends on:

- **`Execute` is all-or-nothing and returns one `Page` per statement, in order** (`adapter.go:72-76`),
  and the console already relies on it for *Run all*. A two-statement EXPLAIN batch (ClickHouse needs
  `PLAN` and `ESTIMATE`) is therefore one call returning two pages.
- **A read-only Postgres connection wraps the whole batch in `BEGIN READ ONLY`**
  (`postgres/console.go:174-188`). **[verified here]** `BEGIN READ ONLY; EXPLAIN (FORMAT JSON) SELECT
  count(*) FROM t; COMMIT;` returns the plan normally — EXPLAIN without ANALYZE is a read.

### 1.5 There is no EXPLAIN anywhere, and one adapter already half-expects it

**[verified in source]** `grep -rni explain` over `apps/` and `packages/` returns prose comments and
exactly one substantive hit: `clickhouse/console.go:19`'s `rowReturningRE` already lists `EXPLAIN`
among the leading keywords that mean "this statement streams rows back", alongside
`SELECT|WITH|SHOW|DESCRIBE|DESC|EXISTS`. So a ClickHouse `EXPLAIN` typed by hand into the console
already works today and already renders as a result grid. Nothing else in the tree knows the word.

### 1.6 The per-connection configuration precedent

**[verified in source]** `connection_filters` is the existing answer to "per-connection settings that
are not connection *credentials*", and it is a complete four-layer chain this phase copies:
`internal/storage/migrations/0001_init.sql` (the table) → `internal/storage/repos/filters.go` →
`internal/bridge/filters.go` → `state/…` + `project/FiltersDialog.vue`, reached from
`project/menus.ts:183-186`'s **Filters…** context-menu item on both a connection row and a database
row. P8's `0002_p8_windows.sql` is the precedent for adding a table in a later migration.

The `connections` row itself has two first-class columns that could each have been an `options_json`
key and deliberately were not — `preconnect` and `preconnect_sidecar`. The stated reason
(`packages/shared/domain/connection.ts`, the `preconnect` comment) is that **`options` round-trips
through the connection URI and the *Copy URI* menu item**, so anything that must not be settable by
pasting a URI needs its own column. D18 applies that rule to auto-explain.

---

## 2. Findings — Half A, the language service

### F1 — `@codemirror/lang-sql` already exports the DDL-driven completion engine, by name
**[verified in source]**, `node_modules/@codemirror/lang-sql/dist/index.d.ts` (v6.10.0, already in
`package.json` `devDependencies`):

```ts
type SQLNamespace = { [name: string]: SQLNamespace }
                  | { self: Completion; children: SQLNamespace }
                  | readonly (Completion | string)[];

interface SQLConfig {
  dialect?: SQLDialect;
  schema?: SQLNamespace;   // "You can use this to define the schemas, tables, and their
                           //  fields for autocompletion."
  defaultTable?: string;   // "columns from the named table can be completed directly at the top level"
  defaultSchema?: string;
  upperCaseKeywords?: boolean;
  keywordCompletion?: (label: string, type: string) => Completion;
}

declare function keywordCompletionSource(dialect: SQLDialect, upperCase?: boolean,
                                         build?: (label: string, type: string) => Completion): CompletionSource;
declare function schemaCompletionSource(config: SQLConfig): CompletionSource;
```

`schema` being a plain data structure with **no connection, no async, no introspection hook** is the
exact shape the SPEC row asks for. It is also why nothing in this phase needs a "language server" in
the process sense: the server's whole state is one object.

### F2 — It resolves qualified paths *and* table aliases, which is the part a hand-rolled source gets wrong
**[verified in source]**, `dist/index.js`:

- `sourceContext(state, pos)` (`:409-422`) resolves the syntax node at the cursor and returns
  `{from, quoted, parents, aliases}`, where `parents` is the dotted path before the cursor
  (`parentsFor`, `:398-408`) — so `public.users.` completes columns, and `"My Schema".` completes
  tables inside a quoted schema.
- `getAliases(doc, at)` (`:425-457`) climbs to the enclosing `Statement`, scans forward from the
  `from` keyword, stops at any of `where group having order union intersect except all distinct limit
  offset fetch for` (`EndFrom`, `:424`), and records both `users u` and `users AS u`.
- `completeFromSchema` (`:552-574`) rewrites a one-segment parent through that alias map
  (`if (aliases && parents.length == 1) parents = aliases[parents[0]] || parents`), and — at the top
  level — offers the aliases themselves as `type: "constant"` completions.

Writing that by hand, correctly, per dialect, is the single largest piece of work this phase would
otherwise carry, and it is already done.

### F3 — Both sources are separately callable, so the console's existing `completionSources` prop is the whole wiring
**[verified in source]** `CodeMirrorHost.vue:133` passes `override: props.completionSources?.length ?
[...props.completionSources] : undefined`. `override` **replaces** language-data sources, so a SQL
console that supplies a schema source must also supply the keyword source it is displacing —
`keywordCompletionSource(dialect, /* upperCase */ true)` is exactly today's `upperCaseKeywords: true`
behaviour, callable directly (F1). So the entire completion change is `consoleCompletionSources`
returning a two-element array for a SQL kind with a DDL document, and `undefined` (today's behaviour,
unchanged) for one without. **`CodeMirrorHost.vue` and `languages.ts` are not edited at all.**

### F4 — The Lezer SQL parser each dialect already carries is a usable DDL extractor
**[verified here]**, `PostgreSQL.language.parser.parse(ddl)` over a real `CREATE TABLE` + `CREATE
INDEX` script produced, in order:

```
Script → Statement → Keyword "CREATE" · Keyword "TABLE" · CompositeIdentifier "public.users"
                     ( Identifier "public" · "." · Identifier "users" )
                   · Parens "(…)"
                       ( "(" · <column defs, separated by top-level Punctuation "," > · ")" )
                   · ";"
       → Statement → Keyword "CREATE" · Keyword "INDEX" · Identifier "users_email_idx"
                   · Keyword "ON" · CompositeIdentifier "public.users" · Parens "(email)" · ";"
```

and the same run over MySQL backtick DDL and over a replica of this repo's own `ClickHouseDialect`
gave, respectively:

```
QuotedIdentifier "`total`" · Type "DECIMAL" · Parens "(10,2)" · Keyword "DEFAULT" · String "'0.00'"
Punctuation "," · LineComment "-- money"                      ← comments already tokenised out
Keyword "PRIMARY" · Keyword "KEY" · Parens "(`id`)"           ← a table constraint, distinguishable
Identifier "tags" · Type "Array" · Parens "(LowCardinality(String))"   ← nested type args nest
```

Every property a DDL extractor needs is there: dialect-correct identifier quoting, comments removed,
nested `Parens` for type arguments, and top-level `Punctuation ","` as the column separator.

### F5 — …with two real gotchas, both cheap once known
**[verified here]**:

1. **The Postgres dialect's keyword list contains `id` and `name`** — 763 keywords, and
   `kw.includes('id') === true`, `kw.includes('name') === true` (MySQL 485, MariaSQL 492 and SQLite 292
   contain neither). So `id integer PRIMARY KEY` tokenises its column name as **`Keyword`**, not
   `Identifier`. Any extractor that only accepts `Identifier`/`QuotedIdentifier` in a column-name
   position silently drops the most common column in every Postgres schema. lang-sql's own
   `sourceContext` already accepts all three (`:412`), which is why completion works regardless; the
   extractor must do the same.
2. **`Type` vs `Identifier` classification is driven by the dialect's curated `types` string**, so a
   type name outside that list (this repo's `ClickHouseDialect` lists ~40, `languages.ts:130-135`)
   comes back as `Identifier`. The extractor must therefore take a column's **declared type as the raw
   source slice** between the name token and the next top-level comma, never by collecting `Type`
   nodes. That is also the right answer for display: `numeric(20,6)` and `Enum8('a'=1,'b'=2)` survive
   verbatim, matching the discipline `ColumnDescriptor.dataType` already follows
   (`docs/v1.1/plans/P15-fake-data-generator.md`, its own §"What the generator can know").

### F6 — `sql-language-server` is the wrong shape, the wrong runtime, and stale
**[verified here]** against `https://registry.npmjs.org/sql-language-server`: latest **1.7.1**, last
publish **2024-11-14** (~22 months stale as of this writing), MIT. Its declared runtime dependencies
are `@google-cloud/bigquery, @joe-re/sql-parser, @types/pg, @types/yargs, cardinal, jest, log4js,
mysql2, node-ssh-forward, pg, sqlite3, vscode-languageclient, vscode-languageserver,
vscode-languageserver-protocol, vscode-languageserver-textdocument, yargs`. Three of those are
database drivers and one (`sqlite3`) is a **native module**; `jest` is a test runner shipped as a
runtime dependency. Its own reason to exist is connecting to a database and introspecting it — the
thing this SPEC row rules out. Running it would additionally mean re-introducing a Node runtime into
the bundle, which `docs/ARCHITECTURE.md`'s Stack section records P58f M10 as having deleted.

### F7 — `node-sql-parser` is a real parser and still the wrong trade
**[verified here]** `node-sql-parser@5.4.0`, Apache-2.0, published **2026-01-12** — genuinely
maintained, and it does produce a proper DDL AST (`astify` on a Postgres `CREATE TABLE` returned
`{type:'create', keyword:'table', table:[{db:'public',table:'users'}], create_definitions:[{column:
{…column_ref…}, definition:{dataType:'INTEGER'}, nullable:{type:'not null'}, primary_key:'primary
key'}, …]}`). Two facts decide it:

| | |
|---|---|
| Per-dialect build sizes, unminified | postgresql 308 145 B · mysql 275 999 B · mariadb 265 819 B · sqlite 205 904 B |
| **Four dialects, esbuild `--bundle --minify --format=esm`** | **1 085 971 B raw / 237 008 B gzip** |
| Against P13's landed `sql-formatter` chunk | 142 314 B / **38 036 B** gzip — this is **6.2×** that |
| Against the whole current app bundle | 1 053 028 B / 333 298 B gzip — this is **+71 % gzip** |
| ClickHouse | **absent.** `build/` has no `clickhouse.js`; the fourteen dialects are athena, bigquery, db2, flinksql, hive, mariadb, mysql, noql, postgresql, redshift, snowflake, sqlite, transactsql, trino |

Even lazily loaded (P13's D2 pattern), it is a 237 KB chunk that would have to be fetched before the
first completion popup on the keystroke path — against a `docs/PERF.md:30` completion-popup budget of
≤ 50 ms p50 — and it would still leave ClickHouse with no schema completion at all.

### F8 — `sql-parser-cst` is GPL-2.0-or-later
**[verified here]** `sql-parser-cst@0.42.1`, `"license": "GPL-2.0-or-later"`, published 2026-06-02, no
runtime dependencies. Technically the closest fit after `node-sql-parser` (it is by the same author as
`sql-formatter`, and produces a concrete syntax tree with full source positions), and it covers
sqlite/mysql/mariadb/postgresql/bigquery. The licence is disqualifying for this MIT product and the
evaluation stops there.

### F9 — Hovers need no new dependency
**[verified in source]** `@codemirror/view@6.43.9` exports `hoverTooltip` and `HoverTooltipSource`
(`dist/index.d.ts:2078`, and the export list at `:2416`). It is already a direct dependency and
already imported by `CodeMirrorHost.vue` for `EditorView`/`keymap`/`lineNumbers`.

### F10 — P13's OQ-5 resolves to "no second grammar, and nothing to retire"
P13 asked whether P18's parser could also produce formatted text, in which case `sql-formatter` could
be dropped. The answer is the other way round: **P18 brings no parser**, so there is no candidate to
replace `sql-formatter` with, and no duplicate grammar in the bundle. lang-sql's Lezer parser is a
*tokeniser with statement boundaries*, not a structural parser — F4's own tree has no notion of a
`SELECT` list or a `WHERE` clause — so it could not emit formatted SQL even in principle. `sql-formatter`
stays exactly as P13 landed it.

---

## 3. Findings — Half B, EXPLAIN

Every row below was executed against a real server in this sandbox. Versions:
PostgreSQL **18** (`postgres:18-alpine`), MySQL **8.4.11**, MariaDB **11.4.13**, ClickHouse
**26.3.28.5**, SQLite via `modernc.org/sqlite` (the driver the app actually ships).

### F11 — Postgres: `EXPLAIN (FORMAT JSON)` is one row, one column, and a real tree
**[verified here]**. `EXPLAIN (FORMAT JSON) SELECT 1;` returns **1 row × 1 column named
`QUERY PLAN`**, whose text is a JSON array of one `{ "Plan": … }`. A real join plan nests through
`"Plans": [ … ]`:

```json
[{ "Plan": {
  "Node Type": "Limit", "Startup Cost": 7814.39, "Total Cost": 7814.41, "Plan Rows": 10, "Plan Width": 15,
  "Plans": [{ "Node Type": "Sort", "Sort Key": ["(count(*)) DESC"], "Plan Rows": 46038,
    "Plans": [{ "Node Type": "Aggregate", "Strategy": "Hashed", "Group Key": ["t.name"],
      "Plans": [{ "Node Type": "Hash Join", "Join Type": "Inner", "Hash Cond": "(t.id = c.t_id)",
        "Total Cost": 6128.95, "Plan Rows": 46038,
        "Plans": [
          { "Node Type": "Seq Scan", "Relation Name": "t", "Alias": "t",
            "Total Cost": 3582.00, "Plan Rows": 184153, "Filter": "(cat > 3)" },
          { "Node Type": "Hash", "Plans": [
            { "Node Type": "Seq Scan", "Relation Name": "c", "Total Cost": 771.00, "Plan Rows": 50000 }]}]}]}]}]}}]
```

The fields available **without `ANALYZE`** are `Node Type`, `Relation Name`, `Alias`, `Index Name`
(on index nodes), `Startup Cost`, `Total Cost`, `Plan Rows`, `Plan Width`, `Filter`, `Index Cond`,
`Hash Cond`, `Join Type`, `Strategy`, `Sort Key`, `Group Key`, `Parallel Aware`, `Disabled`. What is
**not** available without `ANALYZE`: `Actual Rows`, `Actual Total Time`, `Rows Removed by Filter`,
`Sort Method`, `Shared Hit Blocks` — the fields most "plan analyser" write-ups lean on. §5's D15
detects only from the first list.

### F12 — MySQL 8.4: `FORMAT=JSON` carries cost and index candidates; `FORMAT=TREE` is a one-liner
**[verified here]**. `EXPLAIN FORMAT=JSON SELECT * FROM t WHERE name='n5'` → 1 row × 1 column:

```json
{"query_block": {"select_id": 1, "cost_info": {"query_cost": "6304.55"},
  "table": {"table_name":"t", "access_type":"ALL", "rows_examined_per_scan":62643,
            "rows_produced_per_join":6264, "filtered":"10.00",
            "cost_info":{"read_cost":"5678.12","eval_cost":"626.43","prefix_cost":"6304.55","data_read_per_join":"1M"},
            "used_columns":["id","cat","name"], "attached_condition":"(`app`.`t`.`name` = 'n5')"}}}
```

`possible_keys` / `key` / `key_length` / `used_key_parts` / `ref` appear on an indexed access,
`materialized_from_subquery` with `using_temporary_table: true` on a derived table (**[verified
here]** on `SELECT * FROM (SELECT cat, count(*) c FROM t GROUP BY cat) d WHERE d.c > 1`), and
`ordering_operation`/`using_filesort` on a sort. `EXPLAIN FORMAT=TREE` returns a single text line
(`-> Index lookup on t using cat (cat=1)  (cost=3253 rows=31321)`) — strictly less structure than
JSON. **[docs]** the manual: *"`EXPLAIN ANALYZE` always uses the `TREE` output format … formats other
than `TREE` remain unsupported"* — and `EXPLAIN ANALYZE` executes, so it is out (§0.3).

### F13 — MariaDB 11.4: same statement, **different JSON schema**, and no `FORMAT=TREE` at all
**[verified here]**:

```json
{"query_block": {"select_id":1, "cost":16.5855622,
  "nested_loop":[{"table":{"table_name":"t","access_type":"ALL","loops":1,"rows":100175,
                           "cost":16.5855622,"filtered":100,"attached_condition":"t.`name` = 'n5'"}}]}}
```

and with an index and a sort, the table object is wrapped:

```json
{"query_block":{"select_id":1,"cost":2.22612952,
  "nested_loop":[{"read_sorted_file":{"filesort":{"sort_key":"t.`name`",
    "table":{"table_name":"t","access_type":"ref","possible_keys":["cat"],"key":"cat",
             "key_length":"5","used_key_parts":["cat"],"ref":["const"],"loops":1,"rows":2000,
             "cost":2.22612952,"filtered":100,"attached_condition":"t.cat <=> 3"}}}}]}}
```

**`EXPLAIN FORMAT=TREE` fails outright**: `ERROR 1791 (HY000): Unknown EXPLAIN/ANALYZE format name:
'TREE'`. So MySQL and MariaDB share a statement spelling and *not* a response schema: MariaDB nests
tables under `nested_loop`/`read_sorted_file`/`filesort`/`block-nl-join` wrappers and names its scalar
`cost`; MySQL puts one `table` object directly under `query_block` and names its scalar
`cost_info.query_cost`. **Two parsers, not one** — and therefore, as in P13's D3, the dispatch map is
keyed on `ConnectionKind`, not on `SqlDialect` (which collapses them).

**[docs]** MariaDB's manual on `ANALYZE FORMAT=JSON`: *"produces output like `EXPLAIN FORMAT=JSON`,
but amended with the data from query execution"* — i.e. it executes. **[verified here]** its output
adds `r_loops`, `r_rows`, `r_total_time_ms`, `r_filtered`, `r_engine_stats`. Out of scope (§0.3), but
recorded because it is exactly what an OQ-6 follow-up would use.

### F14 — SQLite: four columns, a parent pointer, and **no cost and no row estimate whatsoever**
**[verified here]** against `modernc.org/sqlite` on a real file with `ANALYZE` run:

```
columns: [id parent notused detail]
select * from t where name='n5'
  id=2  parent=0 notused=156 detail="SCAN t"
select * from t where cat=3 order by name
  id=4  parent=0 notused=109 detail="SEARCH t USING INDEX t_cat (cat=?)"
  id=15 parent=0 notused=0   detail="USE TEMP B-TREE FOR ORDER BY"
select t.name, count(*) from t join c on c.t_id=t.id group by t.name order by 2 desc limit 10
  id=9  parent=0 notused=138 detail="SCAN c"
  id=11 parent=0 notused=40  detail="SEARCH t USING INTEGER PRIMARY KEY (rowid=?)"
  id=14 parent=0 notused=0   detail="USE TEMP B-TREE FOR GROUP BY"
  id=54 parent=0 notused=0   detail="USE TEMP B-TREE FOR ORDER BY"
```

**[docs]** sqlite.org/eqp.html: the four fields are *"an integer node id, an integer parent id, an
auxiliary integer field that is not currently used, and a description of the node"*; `SCAN` means a
full scan of a table or index, `SEARCH` means a subset; the vocabulary also includes `USING COVERING
INDEX`, `USE TEMP B-TREE FOR {ORDER BY, GROUP BY, DISTINCT}`, `CORRELATED SCALAR SUBQUERY`,
`CO-ROUTINE`, `MATERIALIZE`, `COMPOUND QUERY`, `UNION USING TEMP B-TREE`, `MERGE (EXCEPT)`. The same
page warns: *"The output format may change between SQLite releases. Applications should not depend on
the output format of the `EXPLAIN QUERY PLAN` command."* D16 treats that warning as binding: the
detail string is matched on a small set of leading tokens and otherwise **shown verbatim**, never
re-rendered from a parse.

Also note **`parent` is 0 for every row above** — the tree only nests for subqueries and compound
queries, so a normaliser that assumes nesting produces a flat list most of the time and must handle
both.

### F15 — ClickHouse: a real JSON plan with index selectivity, **no cost**, and no `EXPLAIN ANALYZE`
**[verified here]** on 26.3.28.5. `EXPLAIN PLAN json = 1, indexes = 1 SELECT count() FROM t WHERE id
BETWEEN 10 AND 20`, requested through **the adapter's own wire format**
(`FORMAT JSONCompactStringsEachRowWithNamesAndTypes`), returns exactly:

```
["explain"]
["String"]
["[\n  {\n    \"Plan\": { ... } }\n]"]
```

— one column named `explain`, type `String`, one row holding the whole JSON. The plan itself:

```json
[{"Plan": {"Node Type":"Expression","Node Id":"Expression_8","Description":"(Project names + Projection)",
  "Plans":[{"Node Type":"Aggregating","Node Id":"Aggregating_4",
    "Plans":[{"Node Type":"Expression","Description":"Before GROUP BY",
      "Plans":[{"Node Type":"Filter","Description":"(WHERE + Change column names to column identifiers)",
        "Plans":[{"Node Type":"ReadFromMergeTree","Node Id":"ReadFromMergeTree_0","Description":"default.t",
          "Indexes":[{"Type":"PrimaryKey","Keys":["id"],
                      "Condition":"and((id in (-Inf, 20]), (id in [10, +Inf)))",
                      "Search Algorithm":"binary search",
                      "Initial Parts":1,"Selected Parts":1,
                      "Initial Granules":62,"Selected Granules":1}]}]}]}]}}]
```

and for a query the primary key cannot narrow (`WHERE cat = 3`, `ORDER BY id`), the same `Indexes`
entry comes back as `{"Type":"PrimaryKey","Condition":"true","Initial Parts":1,"Selected Parts":1,
"Initial Granules":62,"Selected Granules":62}` — **`Selected Granules == Initial Granules` and
`Condition: "true"` is ClickHouse's own "no index was used" signal**, and it is the only one available,
because there is **no cost field anywhere in the plan**.

`EXPLAIN ESTIMATE` supplies the size figure the plan does not: **[verified here]** it returns 1 row ×
5 columns `database, table, parts, rows, marks` — `("default","t",1,500000,62)` for the unfiltered
predicate and `("default","t",1,8192,1)` for `id > 100` (one granule).

**[verified here]** `EXPLAIN ANALYZE SELECT count() FROM t` is a **syntax error** on this version
(`Code: 62 … Expected one of: token sequence, Dot, token, Equals`), so there is no execute-and-annotate
variant to accidentally reach for.

### F16 — `EXPLAIN` without `ANALYZE` is cheap, measured
**[verified here]**:

| | Run the query | `EXPLAIN` it |
|---|---|---|
| PostgreSQL 18, `SELECT count(*) FROM t a JOIN t b ON a.cat=b.cat WHERE a.id<3000` (5 998 000-row join) | **642.538 ms** | **0.791 ms** |
| MariaDB 11.4, same query | ~1.18 s wall | ~0.14 s wall |

(The MariaDB figures are `time docker exec …` and so carry a fixed per-invocation overhead on both
sides; the Postgres figures are `psql \timing`, server-side, and are the honest ratio.) SQLite's
`EXPLAIN QUERY PLAN` only prepares a statement, and ClickHouse's `EXPLAIN PLAN`/`ESTIMATE` read part
metadata. This is what makes auto-explain viable at all, and it is the reason §0.3 excludes every
`ANALYZE` variant rather than offering it as an option.

### F17 — The cost scalars are not comparable across dialects, and two of the five have none
Collecting F11–F15 into the table the threshold decision (D14) turns on:

| Kind | Cost scalar available without ANALYZE | Unit | Row estimate available |
|---|---|---|---|
| postgres | `Total Cost` per node (root = whole query) | planner units anchored to `seq_page_cost = 1.0` — unitless | `Plan Rows` per node |
| mysql | `query_block.cost_info.query_cost` | MySQL cost units | `rows_examined_per_scan` per table |
| mariadb | `query_block.cost` | **≈ seconds** (11.x cost model) | `rows` per table |
| sqlite | **none** | — | **none** |
| clickhouse | **none** | — | `EXPLAIN ESTIMATE`'s `rows` |

The empirical proof that the two `cost`-named fields are not the same unit: **[verified here]** a
100 175-row full scan on MariaDB scored **16.59**; a 62 643-row full scan on MySQL scored **6304.55**.
Nothing about those two numbers can share a threshold.

### F18 — Nothing about Half B touches the wire
**[verified in source]**. Every EXPLAIN in F11–F15 returns rows, so every one of them is an ordinary
`page.TabularPage` built by the adapter's existing `console.go` and encoded by
`adapterhost/frame.go:53-62`'s existing `ExecuteResponse` case. The renderer already receives it as a
`Page` and already stores it under a result key. Therefore: no `Adapter` method, no `Caps` field, no
`data:` op, no `wire.fbs` edit, no `bun run generate:wire`, and none of the six committed
`tests/ipc/<adapter>/<adapter>.fixture.ts` files need regenerating — which matters, because
`AGENTS.md` records that there is **no one-off fixture-capture tool in the tree right now**, so a phase
that needed a fresh capture would be blocked on building one first.

---

## 4. Checked, and not fired

- **Reusing the live L1 metadata cache for console completion.** `runtime[tabId].meta` (grid tabs) and
  `treeState.children` (the Mongo console) are both already in the renderer, and pointing the SQL
  console at them would give better completion with no DDL at all. The SPEC row rules it out in so
  many words (*"no schema introspection over a real connection"*), and D5 keeps the line clean rather
  than shipping a silent fallback that makes the DDL surface look broken when it is empty.
- **A Web Worker for the language service.** The three providers are synchronous lookups over one
  parsed object; `CodeMirrorHost.vue:118-124` already zeroes the completion debounce *because* every
  source this app registers is synchronous. A worker would add a message hop to the keystroke path to
  buy nothing. (P13's OQ-4 keeps the worker escape hatch open for `sql-formatter`, which is genuinely
  CPU-bound; this is not that.)
- **Making `EXPLAIN` an `Adapter` method with a `Caps.explain` flag.** Architecturally the tidier
  answer — Adapter rule 7 says an adapter owns its own identifier and statement text — but it costs a
  method on all ten adapters, a `Caps` field mirrored in two files, a new `data:` op, a new
  FlatBuffers payload plus `generate:wire`, and a plan model that must then exist in Go as well as
  TypeScript. F18 says the console path already carries the result unmodified. D11 takes the cheap
  route and states the one thing it gives up.
- **Parsing the plan in Go.** Same trade as P13's "doing the SQL formatting in Go instead": it would
  put a pure text transform behind a wire round trip, and would need the plan model duplicated in two
  languages.
- **`EXPLAIN (FORMAT XML|YAML)` on Postgres, `FORMAT=TRADITIONAL` on MySQL, `EXPLAIN PLAN` without
  `json=1` on ClickHouse.** All available (**[docs]**/**[verified here]**), all strictly less
  structured than the JSON each engine also offers. The one place a non-JSON form is used is SQLite,
  which has no JSON form at all.
- **`EXPLAIN ESTIMATE` as ClickHouse's *only* explain.** It answers "how much will this read" but says
  nothing about the plan shape, index usage or the operations performed. D13 issues both statements in
  one `Execute` call, which the all-or-nothing contract already supports.
- **A settings leaf for the DDL text itself.** `settings` stores app-wide leaves by key; a DDL document
  is per-connection and can be tens of kilobytes. D2 gives it its own table with an `ON DELETE
  CASCADE`, so deleting a connection cannot leave an orphan — which is exactly the failure mode
  `docs/ARCHITECTURE.md`'s Storage section already documents twice for inert `settings`/`ui_layout`
  leaves.
- **Putting auto-explain in `options_json`.** Rejected by the rule the `preconnect` column's own
  comment states: `options` round-trips through the connection URI and *Copy URI*, so a pasted URI
  could silently turn a behaviour on. D18.
- **`NOTICES.md`.** It covers icon assets only (`NOTICES.md:1-3`). This phase adds no dependency at
  all, so there is nothing to add even under a broader reading.
- **Multi-window.** The DDL document is app-wide per connection (like connections, filters and
  settings — `docs/ARCHITECTURE.md`'s Multi-window section), so a save must broadcast the same way
  `FiltersService` already does; a plan result set is per-tab and therefore per-window, with nothing to
  broadcast. D4 and D17 each say which side of that line they are on.
- **The op log.** Every EXPLAIN this phase issues goes through `data:execute` and therefore produces a
  normal `execute` op-log row with the EXPLAIN text as its `command`. That is deliberate: auto-explain
  must be visible in the Operations panel, not a hidden second query per run.

---

## 5. Decisions

### Half A — the language service

**D1 — An in-editor language service on CodeMirror's own extension model. No language-server process,
no LSP transport, no worker.**

The SPEC row asks for "a SQL language server (completions, diagnostics, hovers — whatever a language
server conventionally provides)". Those three verbs are `textDocument/completion`,
`textDocument/publishDiagnostics` and `textDocument/hover`, and CodeMirror's extension model exposes
each one directly as `CompletionSource`, `linter()` and `hoverTooltip()` — two of which this app is
already wired for (`CodeMirrorHost.vue`'s `completionSources` and `lintSource` props). What the LSP
buys a general-purpose editor is *process isolation and editor-independence*: one server binary serving
VS Code, Neovim and Emacs, keeping a heavy analysis out of the editor's UI thread. This app has exactly
one editor, one renderer, and an analysis whose entire state is one parsed object.

Against this specific architecture the LSP shape is not merely unnecessary, it is obstructed:

1. **There is no runtime to host it.** `docs/ARCHITECTURE.md` records that P58f M10 deleted the
   vendored Node runtime and the engine child process along with it. `sql-language-server` is a Node
   program with a native `sqlite3` dependency (F6).
2. **There is no transport for it.** The shipped desktop build deliberately has **no local listener at
   all** — `docs/ARCHITECTURE.md`'s Process model: the data plane is a held poll/send pair over a
   custom URI scheme *"deliberately, so that no local TCP port is open for another process on the
   machine to reach."* An LSP over a socket is the exact thing that design exists to avoid, and an LSP
   over stdio needs the child process (1) removed.
3. **The server's job is the thing the SPEC forbids.** `sql-language-server`'s dependency list *is*
   its feature list: connect to Postgres/MySQL/SQLite/BigQuery and introspect. Driven purely from DDL,
   it is a JSON-RPC wrapper around a schema object.
4. **The library that would replace it costs 237 KB gzip and cannot do ClickHouse** (F7), against
   0 KB for the one already in the bundle (F1–F5).

So: `views/console/sqlLanguageService.ts` composes three providers over one `DdlSchema`, and the
console passes them through props that already exist. The *name* "language server" is honoured as
*language service* — the same providers, in-process. This is the single most important decision in the
phase and it gets a comment at its module head saying so, so nobody re-litigates it from the SPEC's
wording alone.

**D2 — The DDL document is per connection, stored in a new `connection_ddl` table.**

Per connection, not global (two Postgres connections have different schemas) and not per tab (a tab is
per-window and disposable; `docs/ARCHITECTURE.md`'s Multi-window section puts connection-scoped state
on the app-wide side of the line).

`0003_p18_connection_ddl.sql`:

```sql
CREATE TABLE connection_ddl (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  ddl           TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

One row per connection, absent until the user writes one. `ON DELETE CASCADE` matches
`connection_filters` and `saved_queries`, so deleting a connection cannot leave an orphan.
`internal/storage/repos/connection_ddl.go` + `internal/bridge/schema.go` (`Get(connectionId)`,
`Set(connectionId, ddl)`) mirror `repos/filters.go` + `bridge/filters.go` method for method, and the
row is decoded through a `internal/storage/model` type like every other row
(`docs/ARCHITECTURE.md`'s Storage section: *"a hand-edited or stale-shape row fails loudly"*).

**D3 — It is edited in a `SchemaDialog.vue`, reached from the connection's tree context menu, and it
stages until Save.**

`project/menus.ts` gains **Schema (DDL)…** on the connection row, one item below the existing
**Filters…** (`:183-186`), gated on `sqlDialectFor(row.kind) !== undefined` — a SQL-only surface, and
the same gate the console's own SQL behaviours use (D6). The dialog is `DialogFrame` + one
`CodeMirrorHost` (`language: 'sql'`, the connection's `sqlDialect`, `readOnly: false`,
`autocomplete: false`) + a footer.

The footer follows **P17's landed model exactly** — the draft is component-local, cloned at open;
*Cancel*, Escape, ✕ and the backdrop all discard silently; only *Save* writes (P17 D1/D3/D5). Reusing
that shape rather than inventing a second one is the whole reason this phase does not need a settings
decision of its own here.

Two affordances the dialog owes, and no more:

- A **live parse summary** under the editor: *"12 tables, 148 columns"* or the first parse problem,
  recomputed on a debounce. This is the only feedback that tells a user their DDL is being understood.
- A **paste hint** in the empty state naming where DDL comes from — `pg_dump --schema-only`,
  `SHOW CREATE TABLE`, `.schema`, `SHOW CREATE TABLE` — because the app already knows the connection's
  kind and can say the right one.

*Not* offered: a "load from the connection" button. That is introspection, and §0.3 rules it out.

**D4 — Saving a DDL document broadcasts, exactly like a filters change.**

`SchemaService.Set` emits on the same app-wide channel discipline `FiltersService` uses, so a console
open in window B picks up window A's edit. The renderer keeps one `Map<connectionId, DdlSchema>` in
`state/schemas.ts`, invalidated on that event and on connection delete. This is the app-wide half of
`docs/ARCHITECTURE.md`'s multi-window line, and it is where a DDL document belongs.

**D5 — With no DDL document, the console behaves exactly as it does today.**

`consoleCompletionSources` returns `undefined` for a SQL kind whose `DdlSchema` is empty, which leaves
`override` undefined, which leaves lang-sql's language-data keyword source in charge — byte for byte
today's behaviour. Diagnostics likewise fall back to `lintSql` alone. The empty state is *the current
product*, not a degraded one, and there is no silent fallback to live metadata (§4). One comment at the
call site says why, because "just use `runtime[tabId].meta` here" is the obvious-looking edit a later
reader will otherwise make.

**D6 — The service is keyed on `ConnectionKind` for MariaDB/MySQL, and reuses `sqlDialectFor`
everywhere else.**

`schemaCompletionSource` takes the same `SQLDialect` object `languages.ts` already picks (`PostgreSQL`,
`MySQL`, `SQLite`, in-repo `ClickHouseDialect`), so the four-member `SqlDialect` union is exactly right
for it and stays untouched — *unlike* P13, which needed five formatter dialects and therefore keyed on
kind. Half B does need the kind (D13). To keep one spelling, `views/console/sqlLanguageService.ts`
exports `dialectObjectFor(dialect: SqlDialect): SQLDialect` and `languages.ts` is refactored to call it
rather than holding the ternary chain twice — a pure move, no behaviour change.

**One thing to verify at implementation time rather than assume**: `schemaCompletionSource` does its own
quoting from `dialect.spec.identifierQuotes` (`dist/index.js:458-460`), where the app quotes through
`quoteIdent`. For all four dialects those agree (`identifierQuotes` is `"` for PostgreSQL/SQLite and
includes a backtick for MySQL and this repo's ClickHouse dialect), but a completion that inserts
`` `col` `` where `quoteIdent` would insert `"col"` is a real bug on a case-sensitive engine.
Assert it once in the C4 unit test rather than trusting the reading.

**D7 — Three diagnostics, all warnings, all bounded by what the DDL can prove.**

`views/console/sqlDiagnostics.ts` runs *after* `lintSql` and only when a non-empty `DdlSchema` exists.
Its rules, and nothing else:

1. **Unknown relation.** An identifier in a `FROM`/`JOIN` position that is not a known table (and is
   not itself an alias, a CTE name declared in the same statement's `WITH`, or a function call) →
   `warning: unknown table "orders" — not in this connection's DDL`.
2. **Unknown qualified column.** `alias.column` or `table.column` where the alias/table *is* known and
   the column is not → `warning: "users" has no column "emial"`. **Only qualified references** — an
   unqualified `emial` in a multi-table statement cannot be resolved without a real binder, and
   guessing produces exactly the false positive §0.4 forbids.
3. **Ambiguous unqualified column** — deliberately **not implemented**. It needs the same binder rule 2
   avoids, and gets it wrong on `USING`, natural joins and lateral scopes.

All three are computed off the same Lezer tree the completion source already parses, reusing lang-sql's
own `getAliases` semantics rather than a second alias walker (the implementation re-derives it from the
tree; the function itself is not exported).

Diagnostics are attached through the existing `lintSource` prop, so `consoleLintSource(kind)` becomes
`consoleLintSource(kind, schema)` and the host is untouched.

**D8 — Hovers show what the DDL says, and nothing it does not.**

`hoverTooltip` over an `Identifier`/`QuotedIdentifier`/`Keyword` token (F5's gotcha applies here too):

- resolves to a **table** → its name, and its column list as `name  type`, capped at the first 40
  columns with a `+N more` tail;
- resolves to a **column** (qualified, or unambiguous because exactly one known table in the statement
  declares it) → `table.column — <declared type verbatim>`, plus `PRIMARY KEY` / `NOT NULL` / `UNIQUE`
  when the DDL said so;
- resolves to nothing → **no tooltip at all**, never an empty box.

The tooltip is plain DOM built by hand, styled with the `.cm-diagnostic*`-adjacent rules
`editor/theme.ts` already owns — no markdown renderer, no new primitive.

**D9 — The extractor understands five DDL statements and ignores the rest, silently.**

`views/console/ddl.ts` walks the Lezer `Script` and reads:

| Statement | What it contributes |
|---|---|
| `CREATE TABLE [IF NOT EXISTS] [<schema>.]<name> ( … )` | the table, its columns (name + verbatim type slice), and inline `PRIMARY KEY`/`NOT NULL`/`UNIQUE`/`REFERENCES` flags |
| `CREATE [OR REPLACE] VIEW [<schema>.]<name> …` | the name only, as a completable relation with no columns |
| `CREATE [UNIQUE] INDEX <name> ON [<schema>.]<table> ( … )` | marks those columns indexed (Half B's issue text reads better for it; no completion effect) |
| `ALTER TABLE <t> ADD [COLUMN] <c> <type>` | one more column on an existing table |
| `COMMENT ON COLUMN <t>.<c> IS '…'` | the hover's description line (Postgres only; harmless elsewhere) |

Anything else — `CREATE FUNCTION`, `GRANT`, `SET`, `INSERT`, a `--` header, the noise a `pg_dump`
carries — is skipped without a diagnostic. A schema file is pasted, not authored, and refusing to parse
one because it contains a `SET search_path` line would make the feature unusable.

Table-level constraints (`PRIMARY KEY (a, b)`, `KEY idx (x)`, `CONSTRAINT … FOREIGN KEY …`) are
recognised as *not columns* by their leading keyword and consumed, not emitted as a phantom column
named `PRIMARY`.

**D10 — The `SQLNamespace` handed to lang-sql, stated once.**

- Unqualified `CREATE TABLE users (…)` → `{ users: [{label:'id', type:'property', detail:'integer'}, …] }`.
- Qualified `CREATE TABLE public.users (…)` → `{ public: { users: [...] } }`, and
  `defaultSchema: 'public'` when the connection is Postgres so `users` completes at the top level too.
  For MySQL/MariaDB/ClickHouse the qualifier is a *database*, and `defaultSchema` is set to the
  connection's own `database` field when the DDL qualifies with it.
- A table is emitted **both** ways when it is qualified, so `users` and `public.users` both complete —
  `SQLNamespace` is a plain object and duplicating a reference costs nothing.
- Column `Completion.type` is `'property'`, `detail` is the verbatim declared type, and `boost` is
  raised for primary-key columns so `id` sorts first.

### Half B — EXPLAIN, the threshold, auto-explain

**D11 — The EXPLAIN statement is composed in the renderer and issued through the existing
`data:execute` op.**

`views/console/explain.ts` exports `explainStatementsFor(kind, sql): string[]`, and the console calls
`data.execute({..., statements})` with it — the same call *Run statement* already makes. Justified by
F18 (every dialect's structured EXPLAIN is already an ordinary `TabularPage`), by the precedent that
the renderer already composes dialect-specific SQL text (`sqlIdent.ts`'s `quoteIdent`, `grid/menu.ts`'s
generated *Filter by this value* predicates), and by the cost of the alternative (§4).

**What this gives up, stated rather than buried:** an adapter-side `Explain` would let `Caps` gate the
button, which is `docs/ARCHITECTURE.md`'s stated rule (*"the UI reads only `Caps`, never a
`connection.kind` check"*). Instead the button is gated on `sqlDialectFor(connectionKind)` being
defined — a kind check. That is the same exception `sqlIdent.ts` already documents at length and the
same one P13's `canFormatConsole(kind)` already takes: **dialect selection is a kind decision by
design**, because no capability flag can express "which SQL grammar is this". The exception is named
here so it is a decision and not a drift.

**D12 — Explain targets the statement at the cursor, and only a `SELECT`/`WITH`.**

`statementAtCursor(text, cursorPos, {backslashEscapes})` — the same call *Run statement* makes
(`ConsoleView.vue:137-145`) — picks the statement. `isExplainable(sql)` strips leading comments with
`clickhouse/console.go:18`'s own `leadingCommentRE` shape and requires a leading `SELECT` or `WITH`.
The button is **disabled with an explaining tooltip** when the statement at the cursor is not
explainable, not hidden — unlike P13's Redis case, where the button never applies at all; here it
applies to this console and not to this statement, which is a state, not a capability.

DML explains (`EXPLAIN UPDATE …`) are genuinely safe without `ANALYZE` on Postgres/MySQL/MariaDB/SQLite
and are still excluded, because auto-explain's SPEC wording is "every SELECT query" and one
explainability rule is better than two. OQ-4.

**D13 — Per-dialect EXPLAIN, decided.**

| Kind | Statement(s) issued | Result shape | Why this form |
|---|---|---|---|
| **postgres** | `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, SETTINGS FALSE, BUFFERS FALSE) <sql>` | 1×1 `QUERY PLAN`, JSON `[{Plan:…}]` | The only fully structured form; `COSTS TRUE` is the default but stated so a server-side `explain_*` GUC cannot strip the fields the parser needs. `VERBOSE`/`SETTINGS` add noise the panel does not render. **No `ANALYZE`, no `BUFFERS`** — both require execution. |
| **mysql** | `EXPLAIN FORMAT=JSON <sql>` | 1×1, `{query_block:{cost_info:{query_cost},table:{…}}}` | F12. `FORMAT=TREE` is one text line; `FORMAT=TRADITIONAL` is the flat legacy table. `explain_format` can be set server-side (**[docs]**, MySQL 8.4), which is exactly why `FORMAT=JSON` is always stated explicitly. |
| **mariadb** | `EXPLAIN FORMAT=JSON <sql>` | 1×1, `{query_block:{cost, nested_loop:[…]}}` | F13. Same spelling as MySQL, **different response schema**, and `FORMAT=TREE` is an error (`ERROR 1791`). Two parsers, one statement composer branch each. |
| **sqlite** | `EXPLAIN QUERY PLAN <sql>` | N×4 `(id, parent, notused, detail)` | F14. The only plan form SQLite has; plain `EXPLAIN` emits VDBE opcodes, which is a debugger's tool, not a plan. |
| **clickhouse** | **two statements, one `Execute` call:** `EXPLAIN PLAN json = 1, indexes = 1, description = 1 <sql>` then `EXPLAIN ESTIMATE <sql>` | page 1: 1×1 `explain` `String`; page 2: 1×5 `database, table, parts, rows, marks` | F15. `json=1` is the only structured form; `indexes=1` supplies the *only* index-usage signal ClickHouse has; `ESTIMATE` supplies the *only* size figure, since the plan carries no cost and no row count. `Execute`'s one-page-per-statement contract makes this one round trip. |

The map is keyed on `ConnectionKind` (mariadb ≠ mysql), per F13 and P13's own D3.

**D14 — The "expensive query" threshold is an estimated-rows-read threshold, not a cost threshold.**

F17 is the argument: two of the five dialects report no cost at all, and the two that share the field
*name* `cost` differ by three orders of magnitude for a comparable scan because MariaDB 11.x's model is
approximately seconds and MySQL's is not. A cost threshold would therefore be five settings, four of
which the user has no intuition for.

**One setting, `advanced.expensiveQueryRows`, default `100000`, range 1 000 … 1 000 000 000.** It is
compared against `estimatedRowsRead`, defined per dialect as:

| Kind | `estimatedRowsRead` |
|---|---|
| postgres | **max `Plan Rows` over all scan-type nodes** (`Seq Scan`, `Index Scan`, `Index Only Scan`, `Bitmap Heap Scan`, `CTE Scan`, `Function Scan`, `Foreign Scan`) |
| mysql | max `rows_examined_per_scan` over all `table` objects |
| mariadb | max `rows` over all `table` objects |
| clickhouse | sum of `EXPLAIN ESTIMATE`'s `rows` over its rows |
| sqlite | **absent** — no estimate exists (F14) |

**Why the max over scan nodes and not the root's own estimate**: **[verified here]**, the join plan in
F11 has a root `Limit` reporting `"Plan Rows": 10` over a `Seq Scan` reporting `"Plan Rows": 184153`.
A root-estimate threshold would call that query cheap. The widest single read is the figure a user
actually wants flagged.

**Why 100 000 as the default**: the app's own default page size is 100 (`dataSettingsSchema`), so a
console query estimated to read six orders of magnitude more than one page is worth a heads-up, while
the number is high enough that ordinary lookups and small aggregates never trip it. The `docs/PERF.md`
frame of reference is the fixture corpus's ≥ 1 M-row table (`docs/ARCHITECTURE.md`'s Testing section) —
a default of 1 M would only ever fire on that one table, and a default of 10 000 would fire constantly.

**On SQLite the threshold is inapplicable and the panel says so**, in one line
(*"SQLite's query planner reports no row estimates, so the expensive-query threshold does not apply
here"*) rather than showing a silent zero. SQLite still gets every structural issue in D15, and
auto-explain on a SQLite connection still surfaces a strip when a structural issue fires — the strip's
trigger is *any* issue at or above `warn`, of which the threshold is one.

**Each dialect's own native cost is still shown**, verbatim, labelled with its dialect (`Postgres
planner cost 7 814.41`, `MySQL cost 6 304.55`, `MariaDB cost 16.59`) and with a tooltip stating it is
not comparable to any other engine's. Displaying it is useful; thresholding on it is not.

**D15 — Issue detection, per dialect, from fields that dialect actually reports.**

Every rule below was written from F11–F15's verified output, not from a generic "plan analyser"
checklist. Severity is `warn` unless marked.

| Kind | Rule | Trigger, exactly |
|---|---|---|
| postgres | full scan with a predicate | `Node Type == "Seq Scan"` **and** a `Filter` key is present |
| postgres | wide scan | any scan node's `Plan Rows` ≥ the threshold |
| postgres | nested loop over a wide inner side | `Node Type == "Nested Loop"` and the inner child's `Plan Rows` ≥ 10 000 |
| postgres | *(info)* index-only scan | `Node Type == "Index Only Scan"` — reported as a good sign, so the panel is not only bad news |
| mysql | full scan | `access_type == "ALL"` |
| mysql | an index existed and was not chosen | `possible_keys` non-empty **and** `key` null |
| mysql | temporary table | `using_temporary_table == true` anywhere in the tree |
| mysql | filesort | `using_filesort == true` |
| mysql | wide scan | any table's `rows_examined_per_scan` ≥ the threshold |
| mariadb | full scan | `access_type == "ALL"` |
| mariadb | an index existed and was not chosen | `possible_keys` non-empty **and** no `key` |
| mariadb | filesort | a `read_sorted_file`/`filesort` wrapper node is present |
| mariadb | wide scan | any table's `rows` ≥ the threshold |
| sqlite | full scan | `detail` starts with `SCAN ` (as opposed to `SEARCH `) |
| sqlite | temp b-tree | `detail` contains `USE TEMP B-TREE FOR ` |
| sqlite | *(info)* covering index | `detail` contains `USING COVERING INDEX` |
| clickhouse | the primary key did not narrow the read | a `ReadFromMergeTree` node whose `Indexes[]` has a `Type == "PrimaryKey"` entry with `Selected Granules == Initial Granules` |
| clickhouse | every part read | that same entry with `Selected Parts == Initial Parts` **and** more than one initial part |
| clickhouse | wide read | `EXPLAIN ESTIMATE`'s summed `rows` ≥ the threshold |

Each issue carries a short, concrete message naming the relation (`full table scan on "orders" with a
filter on cat — no index was used`), and the panel groups them above the tree. **A node with no
matching rule produces no issue**; nothing invents a severity from a heuristic the dialect cannot
support.

**D16 — One normalized plan model; every dialect's own fields survive it verbatim.**

```ts
type CostUnit = 'postgres-planner' | 'mysql-cost' | 'mariadb-cost' | 'none';

interface PlanIssue { severity: 'warn' | 'info'; code: string; message: string }

interface PlanNode {
  label: string;                       // "Seq Scan on t"  /  "SCAN t"  /  "ReadFromMergeTree default.t"
  relation?: string;
  detail?: string;                     // the dialect's own condition text, verbatim
  estimatedRows?: number;
  cost?: { total: number; startup?: number };
  metrics: Array<{ label: string; value: string }>;  // whatever else that dialect reported, verbatim
  issues: PlanIssue[];
  children: PlanNode[];
}

interface QueryPlan {
  kind: ConnectionKind;
  root: PlanNode;
  estimatedRowsRead?: number;          // D14; absent on sqlite
  nativeCost?: { value: number; unit: CostUnit };
  issues: PlanIssue[];                 // whole-plan roll-up, deduplicated
  overThreshold: boolean;
  raw: string;                         // the exact EXPLAIN text the server returned
}
```

`metrics` is what keeps this honest: the normaliser projects the fields it *understands* into typed
slots and carries everything else through as label/value pairs shown under the node when it is
expanded. Nothing the server said is discarded, and `raw` is one toggle away — F14's own warning that
SQLite's format may change between releases is answered by never claiming the parse is authoritative.

**D17 — A plan is a result set in the console's existing result strip, not a new panel.**

`ConsoleResult` (`views/console/state.ts:12-15`) gains `kind: 'page' | 'plan'`; a new
`views/console/explainResults.ts` holds `Map<resultKey, QueryPlan>` exactly as `resultPages.ts` holds
pages; `releaseResult` (`state.ts:122-127`) drops from both. The strip's chip gets a `list-tree`
codicon via the existing `RESULT_KIND_ICON` map (`ConsoleView.vue:225-230`), and the result body
renders `ExplainResultView.vue` instead of `ConsoleResultGrid.vue` when the active result is a plan.

This reuses close / close-others / close-to-the-right / `MAX_RESULTS_PER_TAB` eviction / tab-close
cleanup rather than inventing a second lifecycle for a second kind of result — the same
"shared machinery, not four reimplementations" rule `docs/ARCHITECTURE.md`'s UI-architecture section
states. Two things do **not** apply to a plan result and are gated off rather than left to misbehave:
the find toolbar (`pageSearchApi` resolves a `Page`, and a plan is not one) and the expand/collapse-all
pair (already gated on `activeResultIsDocument`).

`ExplainResultView.vue` renders: a header row (verdict chip — *"Estimated to read 184 153 rows"* /
*"No issues found"*, native cost, statement excerpt), the issue list, the indented plan tree with
per-node expand, and a **Raw** toggle showing `plan.raw` in a read-only `CodeMirrorHost`. A plan tree is
tens of nodes — Postgres's own `max_parallel_workers`-shaped plans top out in the low hundreds — so it
is **not virtualized**, and that bound is stated in a comment beside the `v-for`, because
`docs/ARCHITECTURE.md`'s invariants make un-virtualized lists a thing that must be justified rather
than assumed (P15's own headline is a case where the assumption failed).

**D18 — Auto-explain is a first-class `connections` column, not an `options_json` key.**

`0004_p18_auto_explain.sql`: `ALTER TABLE connections ADD COLUMN auto_explain INTEGER NOT NULL DEFAULT 0;`
(a plain non-`REFERENCES` column, so P8's rebuild-and-swap dance is not needed —
`0002_p8_windows.sql`'s comment records that SQLite only refuses `ADD COLUMN` for a `REFERENCES` column
with a non-NULL default). `connectionFieldsSchema` gains `autoExplain: z.boolean().default(false)`,
mirroring `preconnectSidecar`'s own shape so an older stored row still parses.

The reason it is a column and not an option is the one `preconnect`'s comment already gives: `options`
round-trips through the connection URI and *Copy URI*, so an `options_json` key can be switched on by
pasting a URI. Turning on a behaviour that issues an extra statement per run is not something a pasted
string should be able to do.

In the form it is a fourth checkbox in `ConnectionDialog.vue`, immediately after *Read-only*
(`:552-556`), in the same `<label class="field checkbox">` + `helper-text` shape, and `v-if`-ed on
`sqlDialectFor(draft.kind)` so it is absent — not disabled — on the five non-SQL kinds, matching
`isFileStyle`'s own precedent in that file:

> **Auto-explain SELECT queries**
> Runs the database's own EXPLAIN before each SELECT this connection issues from a query console, and
> warns when a query is estimated to read more than *N* rows. EXPLAIN only plans the query — it never
> runs it — so this costs one extra planning round trip, not a second execution.

**D19 — What auto-explain actually does, and the four things it refuses to do.**

On `run(tabId, statements)` with auto-explain on and a SQL dialect:

1. Filter `statements` to those passing `isExplainable` (D12). If none, run normally — no extra call.
2. If more than **`AUTO_EXPLAIN_MAX_STATEMENTS = 10`** qualify, skip auto-explain entirely for that
   run. A pasted 200-statement script must not become 200 EXPLAINs.
3. Issue **one** `data.execute` carrying every qualifying statement's EXPLAIN, before the real run.
4. Parse each returned page. If any plan has `overThreshold` or a `warn`-severity issue, set
   `rt.autoExplain = { plans, worst }`.
5. **Run the batch regardless.** Auto-explain warns; it never blocks and never asks. (OQ-5 records the
   blocking variant, which is a real product decision nobody has asked for.)
6. If the EXPLAIN call **fails for any reason**, swallow it and run normally. A statement the planner
   refuses must never stop the statement the server would have accepted.

The warning is a `MessageStrip` in the console's `#strips` slot — P13's D9 pattern, `tone="warn"`,
`data-testid="console-auto-explain"` — reading e.g. *"Estimated to read 184 153 rows · full table scan
on "orders" with a filter"*, with a **Show plan** action that pushes the already-parsed `QueryPlan` in
as a plan result set. **No second round trip**: the plan is already in hand. The strip clears on the
next run and on the next document edit, exactly as `formatError` does (`ConsoleView.vue:116-120`).

**Cost, stated:** one extra round trip and one extra planning pass per run, measured at 0.791 ms
server-side on Postgres against a 642 ms query (F16). The op-log gets one extra `execute` row per run
whose `command` is the EXPLAIN text — visible, not hidden (§4).

**D20 — The threshold leaf lives in `advanced`, and P17's generic staging carries it for free.**

`advancedSettingsSchema` gains
`expensiveQueryRows: z.number().int().min(1000).max(1_000_000_000).default(100_000)` plus an exported
`EXPENSIVE_QUERY_ROWS_RANGE` beside the three ranges P17's D6 already introduced for exactly this
purpose, `defaultSettings.advanced.expensiveQueryRows = 100_000`, and the Go
`model.DefaultSettings()` mirror. The Settings dialog's **Advanced** section gains one number field
written in the shape P17 landed (draft-backed, inline error, Save disabled while out of range —
P17 D6), and *Revert to Defaults* picks it up with no edit because P17 D4 stages the whole
`defaultSettings` object generically. **P17's own claim that "P18's own settings … need no edit here at
all" is therefore true for the mechanism and false for the markup** — one field is still added. Worth
saying plainly rather than discovering it mid-implementation.

**D21 — Two unit tests, both genuinely earned; everything else is `tests/ui/`.**

`AGENTS.md`'s bar names *"a parser or splitter with several interacting lexical rules"* and *"a
decision structure large enough that no one can hold it in their head"*. Two things here clear it, and
nothing else does:

1. **`tests/unit/ddl-schema.spec.ts`** — the DDL extractor (D9). It is a tree walk over four dialects'
   grammars with interacting rules: qualified vs. unqualified names, quoted vs. bare vs.
   keyword-shaped column names (F5's `id`), nested type-argument parens, table constraints that are not
   columns, `IF NOT EXISTS`, and statements it must skip silently. Cases: one table per dialect; a
   Postgres `id`/`name` column proving F5; `numeric(20,6)` and `Array(LowCardinality(String))` proving
   the verbatim-type-slice rule; `PRIMARY KEY (a, b)` proving no phantom column; a `pg_dump` preamble
   proving silent skipping; an unterminated `CREATE TABLE` proving no throw.
2. **`tests/unit/explain-plan.spec.ts`** — the five plan normalisers + issue rules (D13/D15/D16). Five
   dialects × several node shapes is precisely a decision structure too large to hold in one's head,
   and its inputs are free: the **verified real outputs in F11–F15 are the fixtures**, pasted verbatim,
   which is this repo's "capture, don't hand-write" discipline applied where a capture tool is not
   needed because the capture is already in the plan.

Not tested in isolation: the completion source (it is lang-sql's, F1/F2), the hover (a lookup), the
statement composer (a lookup table), the settings leaf, the migration, the repo (a CRUD round trip —
`AGENTS.md` names that category explicitly).

---

## 6. Implementation order

Fifteen commits in two sequential Sonnet passes (§0.5). Every commit leaves the tree green
(`bun run lint && bun run typecheck && bun run build`, plus the suites §7.4 names).

### 6.1 Pass 1 — the SQL language service

#### C1 — `refactor(editor): one dialect-object lookup, shared by the language and the service`
Pure move, no behaviour change, first so C3/C4 have one spelling to import. Extract
`languages.ts:154-166`'s ternary chain into `dialectObjectFor(dialect: SqlDialect): SQLDialect`,
exported from `editor/languages.ts`, called by `languageExtension` unchanged. The in-repo
`ClickHouseDialect` and its P36 comment block stay exactly where they are.

#### C2 — `feat(storage): a per-connection DDL document`
- `internal/storage/migrations/0003_p18_connection_ddl.sql` (D2), with a comment stating the cascade.
- `internal/storage/model/` — the row type + decoder.
- `internal/storage/repos/connection_ddl.go` — `Get`/`Upsert`/(cascade handles delete), mirroring
  `repos/filters.go`.
- `internal/bridge/schema.go` — `SchemaService{Get, Set}`, registered in `apps/kira-studio/main.go`'s
  service list (the fourteenth), emitting on Set the way `FiltersService` does (D4).
- `packages/shared/domain/schema.ts` — the wire shape + zod schema.
- Regenerate bindings (`wails3 generate bindings -b -i -ts` from `apps/kira-studio/`) — required before
  any frontend build, per `AGENTS.md`.
- `frontend/src/bridge/control.ts` + `frontend/src/state/schemas.ts` — the renderer-side store and its
  event subscription.

#### C3 — `feat(console): parse user-supplied DDL into a schema`
- `frontend/src/views/console/ddl.ts` — D9's extractor and D10's `SQLNamespace` builder, over
  `dialectObjectFor(dialect).language.parser`. Exports `parseDdl(dialect, text): DdlSchema` and
  `toSqlNamespace(schema): SQLNamespace`.
- Three comments owed here and nowhere else: why a column name may arrive as a `Keyword` (F5.1), why
  the declared type is a raw source slice rather than collected `Type` nodes (F5.2), and why unknown
  statements are skipped silently (D9).
- Memoised per `(connectionId, textHash)` in `state/schemas.ts`, so a keystroke in the console never
  re-parses the DDL.

#### C4 — `test(unit): the DDL schema extractor`
D21's first test. Written before the providers so C5/C6 build on a proven extractor.

#### C5 — `feat(console): schema-aware completion in the SQL console`
- `frontend/src/views/console/sqlLanguageService.ts` — the module head carries D1's comment (why this
  is not an LSP), and exports `sqlCompletionSources(dialect, schema)` returning
  `[schemaCompletionSource({dialect, schema: ns, defaultSchema}), keywordCompletionSource(dialect, true)]`.
- `views/console/completion.ts`'s `consoleCompletionSources` gains the SQL branch, returning
  `undefined` when the schema is empty (D5, with its comment).
- `ConsoleView.vue`: the `completionSources` computed (`:75-81`) drops its `language.value === 'sql'`
  exclusion and passes the connection's schema through. **`CodeMirrorHost.vue` and `languages.ts` are
  not edited** (F3).
- Verify the quoting agreement D6 names, and assert it in C4's spec.

#### C6 — `feat(console): DDL-aware diagnostics and hovers`
- `frontend/src/views/console/sqlDiagnostics.ts` — D7's two rules, warnings only, layered after
  `lintSql`. `consoleLintSource(kind)` becomes `consoleLintSource(kind, schema)`.
- `frontend/src/editor/hover.ts` + a `hoverSource?: HoverTooltipSource`-shaped prop on
  `CodeMirrorHost.vue` in its own compartment, following the existing `lintSource` prop's contract
  exactly (pure data in, no `EditorView` at the call site) — this is the one host edit the phase makes,
  and it is additive.
- `views/console/sqlHover.ts` — D8's resolution and rendering.

#### C7 — `feat(project): a Schema (DDL) dialog per connection` + `test(ui)`
- `project/SchemaDialog.vue` (D3), `project/menus.ts`'s new item, `state/schemas.ts`'s open/close.
- `apps/kira-studio/tests/ui/sql-schema.spec.ts` — §7.1's scenarios.
- `docs/ARCHITECTURE.md`: one edit owed — the Storage section's schema block gains the
  `connection_ddl` line, and one sentence in UI architecture naming the console's DDL-driven language
  service and that it never introspects.

### 6.2 Pass 2 — EXPLAIN, the threshold, auto-explain

Planned and implemented against pass 1's landed tree, not against this document's description of it.

#### C8 — `feat(settings): a configurable expensive-query row threshold`
D20: the schema leaf + range constant, `defaultSettings`, the Go `model.DefaultSettings()` mirror, and
the Advanced-section field in P17's staged shape.

#### C9 — `feat(console): compose each dialect's own EXPLAIN`
`views/console/explain.ts` — D13's per-`ConnectionKind` statement map and D12's `isExplainable`. Text
only; no UI, no parsing.

#### C10 — `feat(console): normalize every dialect's EXPLAIN into one plan model`
`views/console/planModel.ts` (D16) + `views/console/planParsers/{postgres,mysql,mariadb,sqlite,clickhouse}.ts`
(D13's shapes) + `views/console/planIssues.ts` (D15's rules, threshold-aware).

#### C11 — `test(unit): the five EXPLAIN plan normalizers`
D21's second test, with F11–F15's verified outputs as fixtures.

#### C12 — `feat(console): an Explain button and a plan result set`
- `ConsoleResult.kind`, `views/console/explainResults.ts`, `releaseResult` (D17).
- `ExplainResultView.vue`.
- The toolbar button in `ConsoleView.vue`'s `#toolbar` immediately after **Format** (`:328-334`),
  `icon="list-tree"`, `data-testid="console-explain"`, disabled-with-tooltip per D12.
- `registerCommand('view.explain', …)` alongside the existing four (`:211-216`). **No global chord and
  no menu item** — P13's `view.format` took the seven-file accelerator path because *Format Document*
  has a chord users already have in their fingers; *Explain* has no such convention, and adding a
  chord nobody expects is the padding §0.4 forbids. The command palette entry
  (`shortcuts/state.ts`) is still added, since that is where a chord-less command is discovered.

#### C13 — `feat(connections): a per-connection auto-explain toggle`
D18: `0004_p18_auto_explain.sql`, the `connections` model/repo/bridge fields, the zod field, the
`ConnectionDialog.vue` checkbox, and regenerated bindings.

#### C14 — `feat(console): warn before a SELECT that is estimated to be expensive`
D19: the pre-run EXPLAIN in `views/console/state.ts`'s `run()`, `rt.autoExplain`, the `#strips`
warning with its **Show plan** action.

#### C15 — `test(ui): the Explain button, the plan view, and auto-explain` + docs
- `apps/kira-studio/tests/ui/console-explain.spec.ts` — §7.2's scenarios.
- `docs/ARCHITECTURE.md`: the per-database mapping table gains an **EXPLAIN form** column naming each
  SQL engine's statement (the table is already the home for exactly this kind of per-engine fact), and
  the Storage section's `connections` column list gains `auto_explain`.

---

## 7. Verification

### 7.1 Pass 1's `tests/ui/` spec — `sql-schema.spec.ts`

`tests/ui/` is the right tier: everything in pass 1 is renderer work over mocked wire planes, and the
control-plane mock already answers arbitrary channels through `CHANNEL_TO_FQN`. The postgres fixture
(`orderItemsFixture`) and `console.spec.ts:132-260`'s open-a-console-from-the-tree flow are the pattern
to follow, and P13's own `console-format.spec.ts` is the closest sibling. **No new port fixture capture
is needed** — no scenario runs a statement — which matters, per `AGENTS.md`'s note that there is no
one-off capture tool in the tree.

1. **The dialog round-trips.** Open **Schema (DDL)…** from the connection context menu, type a two-table
   DDL script, assert the parse summary reads `2 tables`, press *Cancel*, reopen, assert the editor is
   empty (P17's discard rule); type it again, press *Save*, reopen, assert it is there.
2. **Completion offers tables, then columns, then aliases.** With that DDL saved, open a console, type
   `select * from ` and assert both table names appear in `.cm-tooltip-autocomplete`; type
   `select u. from users u` with the caret after the dot and assert the columns of `users` appear; type
   `select * from users u where u.` and assert the same.
3. **Keyword completion still works, and still uppercases.** Type `sel` and assert `SELECT` is offered
   — the guard that C5's `override` array did not drop lang-sql's keyword source (F3).
4. **With no DDL, nothing changed.** On a second connection with no DDL document, assert `from ` offers
   no table completions and `sel` still offers `SELECT` — D5's guard, and the assertion most likely to
   be deleted later by someone who thinks it is an oversight, so its comment must say why it exists.
5. **A diagnostic fires, and only where it should.** Type `select * from oredrs` and assert one
   `.cm-lintRange-warning` over `oredrs`; type `select * from users u join orders o on o.user_id = u.id`
   and assert **zero** diagnostics — the false-positive guard §0.4 makes the binding rule.
6. **A hover shows the declared type.** Hover a known column and assert the tooltip contains its
   verbatim DDL type.

### 7.2 Pass 2's `tests/ui/` spec — `console-explain.spec.ts`

Also `tests/ui/`, because an Explain press is one `data:execute` call and the data plane is mocked —
the mock returns a `TabularPage` whose single cell is **F11's verified Postgres JSON, verbatim**. That
is the point: the spec asserts the real rendering of a real server's real output without needing a
server.

1. **Explain produces a plan result set.** Type F11's join query, press `[data-testid="console-explain"]`,
   assert a new result chip appears with the plan icon and that the panel shows `Seq Scan on t`,
   `Hash Join` and an issue reading *full table scan*.
2. **The threshold flags.** With `advanced.expensiveQueryRows` booted at 100 000 (`bootSnapshots`,
   P17's F9), assert the header reports `184 153` and the over-threshold chip; reboot at 1 000 000 and
   assert the same plan is not flagged.
3. **Raw is one toggle away.** Press *Raw* and assert the JSON the mock returned appears verbatim.
4. **Not explainable → disabled with a reason.** Put the caret in an `UPDATE` statement and assert the
   button is disabled and its tooltip names why (D12).
5. **Auto-explain warns and still runs.** Boot a connection with `autoExplain: true`, press *Run*,
   assert `[data-testid="console-auto-explain"]` appears **and** that the result set from the real run
   is present — the guard that D19's rule 5 (warn, never block) holds.
6. **Auto-explain off issues one call, not two.** Assert `control.log()`/the port log holds exactly one
   `execute` for a run on a connection with the toggle off — the same "count the calls" technique
   P17's F6 and `credential-reveal.spec.ts:83` already use.
7. **A failed EXPLAIN does not fail the run.** Make the mock error the EXPLAIN call and succeed the run;
   assert no strip, and a normal result (D19 rule 6).

### 7.3 What must be checked against a real server, and how

Everything in F11–F16 was verified against real containers *while writing this plan*, so the
implementation does not need to rediscover the formats. Two things should still be re-run once at
implementation time, because they are the two that would silently produce a wrong-looking panel rather
than an error:

1. **The Postgres plan against a server with `ANALYZE`-only fields absent.** Confirm the normaliser
   never reads `Actual Rows`/`Sort Method` (F11's second list) — a `grep` over `planParsers/postgres.ts`
   for those key names returning nothing is the whole check.
2. **ClickHouse's two-page response ordering.** `Execute` returns one page per statement in order
   (`adapter.go:72-76`), so page 0 is the plan and page 1 is the estimate. Assert it in the unit test
   rather than trusting the order at runtime.

The full end-to-end path (real adapter, real container, real Explain) is `tests/e2e-real/`'s territory
and is **deliberately not extended here** — that tier is *"deliberately small — three specs, five
tests"* (`docs/ARCHITECTURE.md`'s Testing section) and exists to prove wiring, which the console's
`execute` path already has proven for postgres, mariadb and sqlite. Adding an Explain case would be a
fourth spec proving the same wire.

### 7.4 Running the rest here

```
bun run lint && bun run typecheck && bun run build
bun run test:unit
bun run test:ui
go build ./apps/kira-studio/... && go test ./apps/kira-studio/internal/...
```

Both passes need `wails3 generate bindings -b -i -ts` from `apps/kira-studio/` before the first
frontend build (C2 and C13 each change a bound service's method set) — `AGENTS.md`'s Wails section is
explicit that missing bindings fail the Vite build with an unresolvable import, not a stale-bindings
surprise. `bunx playwright install webkit` plus the libraries its post-install warning names must run
before the first `test:ui` in a fresh container.

### 7.5 What must not regress

- **`dist/assets/index-*.js` and the `sql-formatter` chunk are both unchanged in size**, because this
  phase adds no dependency to either. If the main chunk grows materially, something imported a parser
  that was not supposed to exist.
- **The completion-popup budget** (`tests/ui/budgets.spec.ts`, ≤ 50 ms p50, `docs/PERF.md:30`) holds.
  This is the one budget pass 1 can plausibly break: the schema completion source runs on the keystroke
  path with `activateOnTypingDelay: 0` and `interactionDelay: 0` (`CodeMirrorHost.vue:129-130`). The
  DDL parse is memoised outside it (C3), so what runs per keystroke is lang-sql's own tree resolve plus
  a map lookup — but this budget is the guard, and if it moves, the memoisation is wrong.
- **`tests/ui/console.spec.ts`, `autocomplete.spec.ts`'s console cases, `console-format.spec.ts` and
  `cell-editor.spec.ts:1187-1195` all pass unchanged.** C5 replaces `override: undefined` with a real
  array only when a schema exists; every existing spec runs without one.
- **`tests/ipc/` regenerates nothing and asserts unchanged.** F18: no adapter, no wire, no fixture.
- **The Go suite passes with two new migrations applied.** The migration runner is forward-only and
  applied on startup; a fresh `KIRA_HOME` and an existing one must both come up.

---

## 8. Acceptance checklist

1. A **Schema (DDL)…** item appears on a SQL connection's tree context menu and on no other kind; it
   opens a dialog whose edits stage until *Save* and discard on Cancel/Escape/✕/backdrop.
2. The DDL document persists in `connection_ddl`, survives a relaunch, is dropped with its connection,
   and a save in one window reaches a console open in another.
3. With a DDL document, a SQL console completes **table names** after `FROM`/`JOIN`, **column names**
   after a known table or a resolved alias, and **aliases** themselves; without one, completion is
   byte-for-byte what it is today.
4. Keyword completion still fires and still uppercases on all five SQL kinds.
5. An unknown relation and an unknown qualified column each raise exactly one **warning**; a correct
   multi-table statement with aliases raises **zero** diagnostics.
6. Hovering a known table shows its columns; hovering a known column shows its verbatim declared type;
   hovering anything unresolved shows no tooltip.
7. **No new npm dependency was added** — `package.json` is unchanged by pass 1, and unchanged by pass 2.
8. An **Explain** button appears in the SQL console toolbar, is disabled with a reason when the
   statement at the cursor is not a `SELECT`/`WITH`, and produces a plan result set in the existing
   result strip that closes, evicts and cleans up like any other result.
9. Each dialect issues exactly the statement D13's table names — Postgres
   `EXPLAIN (FORMAT JSON, …)`, MySQL and MariaDB `EXPLAIN FORMAT=JSON` parsed by **two different**
   parsers, SQLite `EXPLAIN QUERY PLAN`, ClickHouse `EXPLAIN PLAN json = 1, indexes = 1, description = 1`
   **plus** `EXPLAIN ESTIMATE` in one call — and **no `ANALYZE` variant appears anywhere in the tree**
   (`grep -rn "ANALYZE" apps/kira-studio/frontend/src` returns nothing).
10. The plan view calls out full scans, unused-but-available indexes, temp b-trees/filesorts, and
    ClickHouse's un-narrowed primary key, per D15 — and shows every unrecognised field verbatim rather
    than dropping it, with the raw EXPLAIN one toggle away.
11. `advanced.expensiveQueryRows` exists, defaults to 100 000, stages and saves through P17's dialog,
    is reachable by *Revert to Defaults*, and drives both the plan flag and the auto-explain warning.
    On SQLite the panel states the threshold does not apply rather than showing a zero.
12. A per-connection **auto-explain** checkbox exists in the edit form for SQL kinds only, is stored in
    a `connections` column (not `options_json`), and defaults off; with it on, a console run issues one
    extra EXPLAIN call before the batch, warns when the threshold or a `warn` issue fires, offers
    **Show plan** without a second round trip, **still runs the query**, and degrades to a normal run
    if the EXPLAIN fails.
13. `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
    `go build`/`go test ./apps/kira-studio/...` all clean, at the end of **each** pass.

---

## 9. Open questions, handed forward

- **OQ-1 — DDL-driven completion in the WHERE/ORDER BY boxes.** They complete from live metadata today
  (`filterCompletion.ts`), which is better where it exists. The additive answer is to *merge* the DDL's
  columns in where live metadata is absent (a disconnected tab, a describe that errored), not to
  replace it. Small, and nobody has asked.
- **OQ-2 — Generating the DDL document from the connection.** The single most-requested-shaped
  follow-up, and the one this SPEC row explicitly forbids. If it is ever wanted, the honest shape is a
  *separate, explicit* "Import schema from this connection" action in the dialog that writes real DDL
  text into the same document the user can then edit — the document stays the single source of truth,
  and the language service never talks to a server. Worth stating so the next session does not
  reintroduce introspection by the back door.
- **OQ-3 — Snippet completion (`SELECT … FROM …`) and `JOIN` condition suggestions from the DDL's
  foreign keys.** D9 already extracts `REFERENCES`, so `ON a.b = c.d` is derivable. Deferred because it
  is a UX decision (when does a snippet fire without being annoying) rather than a data problem.
- **OQ-4 — Explaining DML.** Safe without `ANALYZE` on four of the five dialects (F11's docs quote
  covers Postgres). Excluded by D12 for one-rule simplicity; the change is one regex.
- **OQ-5 — Auto-explain that *blocks*.** *"This query is estimated to read 40 M rows. Run anyway?"* is a
  real product option and a real annoyance; D19 rule 5 chose warn-and-run. If it is ever wanted, the
  threshold leaf is already the trigger and the strip is already the surface.
- **OQ-6 — `ANALYZE`-grade plans, opt-in.** Postgres `EXPLAIN (ANALYZE, BUFFERS)`, MySQL
  `EXPLAIN ANALYZE` (TREE-format only, F12) and MariaDB `ANALYZE FORMAT=JSON` (F13) all add
  actual-vs-estimated rows, real timings and buffer counts — by *executing the statement*. That is a
  genuinely different feature with a genuinely different consent model (it must never be automatic, and
  never on a write). The plan model's `metrics` array (D16) already has room for the extra fields.
- **OQ-7 — A cost threshold *in addition to* the row threshold, per dialect.** D14 rejected it as *the*
  threshold; as a second, optional, per-dialect knob it would be defensible once users report that rows
  alone miss a case. Recorded so the reasoning is not relitigated from scratch: the blocker is that
  MariaDB's and MySQL's identically-named `cost` are three orders of magnitude apart (F17).
- **OQ-8 — P13's OQ-2, again.** *"P18's language server will want the same thing"* — preserving the
  caret across an external write to the console document. It turns out P18 does **not** want it: nothing
  in this phase writes the document. The open question stands where P13 left it, for whichever phase
  first needs a code action or a quick fix.
