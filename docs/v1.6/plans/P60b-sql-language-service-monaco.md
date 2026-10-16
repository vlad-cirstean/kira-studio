# P60b — The SQL language service on Monaco, and the last of CodeMirror

Second half of the P60 split (see `P60a-monaco-host-and-general-surfaces.md` §0 for why). Plans
against the tree **P60a leaves**, not against today's.

## 0. What P60a leaves

- `editor/MonacoHost.vue` exists and is mounted by 15 components, with the same prop/emit/exposed
  surface `CodeMirrorHost.vue` had (P60a §3).
- `editor/monaco.ts`, `monacoTheme.ts`, `monacoLanguages.ts`, `completion.ts`, `paintSpans.ts` exist.
- `@codemirror/merge` is gone.
- **Still on CodeMirror**: `views/console/ConsoleView.vue` and `project/SchemaDialog.vue` — the only
  two `CodeMirrorHost` mounts left — plus everything holding them up:
  `editor/{CodeMirrorHost.vue,theme.ts,languages.ts,hover.ts,variableHighlight.ts,wrapSelection.ts}`
  and the nine remaining `@codemirror/*` packages plus `@lezer/highlight`.

## 1. The real problem: a parse tree, not an editor

The console's three language-service providers are **not** thin CodeMirror wrappers. They are ~1 137
lines of analysis walking a **Lezer parse tree produced by `@codemirror/lang-sql`**:

| File | Lines | What it needs from the tree |
| --- | --- | --- |
| `views/console/lezerNodes.ts` | 101 | the `LNode` shape itself: `name`/`from`/`to`/`firstChild`/`nextSibling`, plus `TokenCursor` |
| `views/console/ddl.ts` | 462 | DDL extraction: `CREATE TABLE/VIEW/INDEX`, `ALTER TABLE ADD`, `COMMENT ON COLUMN` → `DdlSchema` |
| `views/console/sqlRefs.ts` | 191 | FROM/JOIN table refs + aliases + CTE names per statement |
| `views/console/sqlDiagnostics.ts` | 120 | unknown-relation / unknown-qualified-column warnings |
| `views/console/sqlHover.ts` | 146 | table and column hover cards, alias- and CTE-aware |
| `views/console/sqlLanguageService.ts` | 117 | composes lang-sql's `schemaCompletionSource` + `keywordCompletionSource` + a relation source |

Plus `editor/languages.ts:146`'s `dialectObjectFor` (the `SqlDialect` string → `SQLDialect` object
map) and `state/schemas.ts:85`'s memoised `parseDdl` call.

**Monaco has no SQL parse tree.** Its `sql` contribution is a Monarch tokenizer for colouring only —
`monacoEntry.ts:41` registers it, and `monacoEntry.ts:60` deliberately imports no `vs/language/*`
service. So P60b must supply the parse layer.

### 1.1 What that tree actually is

Read `lezerNodes.ts` and every consumer in full. The tree lang-sql produces, *as this app uses it*,
is **shallow**:

- root → `Statement` nodes
- `Statement` → a flat sibling list of tokens, with exactly two groupings:
  - `Parens` (balanced, nestable), children including the literal `'('` / `')'` nodes
  - `CompositeIdentifier` (`name ('.' name)+`), children being name nodes and literal `'.'` nodes
- token node names consumed anywhere: `Keyword`, `Identifier`, `QuotedIdentifier`, `String`,
  `Null`, `Punctuation`, `LineComment`, `BlockComment`, `Parens`, `CompositeIdentifier`,
  `Statement`, and the literals `';'`, `'.'`, `'('`, `')'`.

**Every piece of real grammar is already hand-written in this repo**, over that flat token list:
`ddl.ts`'s `TokenCursor` walk, `sqlRefs.ts`'s `refsInStatement`/`collectCteNames`. lang-sql supplies
a *tokenizer plus two groupings* — nothing more.

That is the finding this whole phase turns on.

---

## 2. What replaces it — library survey, then the decision

CLAUDE.md requires reaching for a maintained library before hand-rolling, and requires naming the
real requirement when declining one. The requirements, stated before the survey:

- **R1.** Covers all five SQL kinds this app supports: postgres, mysql, mariadb, sqlite, clickhouse
  (`sqlIdent.ts`'s `SqlDialect`).
- **R2.** Error-tolerant over half-typed text. A console document is almost always mid-edit;
  `lint.ts:20` states the current guarantee outright — *"Lezer's own error recovery (F4) never
  throws"* — and `ddl.ts:352` promises the extractor *"never throws"*.
- **R3.** Byte-accurate source offsets on every token (every diagnostic, hover span and completion
  `from` in §1's files is an absolute offset).
- **R4.** Agrees with `@shared/domain/sql-split.ts` about statement boundaries and about each
  dialect's quoting rules (`backslashEscapes`, `dollarQuoting`) — otherwise Format, Run all and
  diagnostics disagree about what a statement is.
- **R5.** Small. This lands in a chunk a DB session fetches.

| Candidate | License | Verdict |
| --- | --- | --- |
| `sql-parser-cst` 0.42.1 | **GPL-2.0-or-later** | **Declined on license.** This repo is MIT and ships a packaged desktop binary; a GPL parser linked into it is a copyleft obligation across the whole app. Otherwise the best technical fit (CST with positions, sqlite + mysql/mariadb + postgresql). Not a CLAUDE.md "paid tier" problem — a distribution problem, which is worse. |
| `node-sql-parser` 5.4.0 | Apache-2.0 | Declined. AST, not CST; **throws** on unparseable input (fails R2 outright); no reliable per-token offsets (fails R3). |
| `dt-sql-parser` 4.5.1 | MIT | Declined. Supports hive/spark/flink/mysql/postgresql/trino/impala — **no sqlite, no clickhouse** (fails R1 for two of five kinds). ANTLR runtime + per-dialect grammars are megabytes (fails R5) for a token stream we need 15 node kinds from. |
| `monaco-sql-languages` 1.2.1 | MIT | Declined — wraps `dt-sql-parser`, inherits R1 and R5. |
| Keep `@codemirror/lang-sql` as a parser-only dependency | MIT | Declined: SPEC's P60 row says remove `@codemirror/*` **entirely**, and keeping one would keep `@codemirror/language` + `@lezer/*` with it for the `syntaxTree`/`Tree` types. |

### 2.1 Decision (D1): a third sibling of the two lexers this repo already owns

`packages/shared/domain/` already contains **two** dialect-aware SQL lexical scanners sharing one
state machine:

- `sql-split.ts` (112 lines) — quote/comment/dollar-quote-aware statement splitting.
- `sql-lint.ts` (144 lines) — the same lexical states, reused for unterminated-quote and
  unbalanced-paren diagnostics. Its own header says so: *"Sibling of sql-split.ts: same lexical
  states (quotes, dollar-quotes, comments), reused here"*.

P60b adds the third: **`packages/shared/domain/sql-tokens.ts`**, producing exactly the `LNode` shape
§1.1 describes. This is not hand-rolling a parser — the parser (`ddl.ts`, `sqlRefs.ts`) is already
hand-written and stays untouched. It is extending an existing in-house lexer family by one function,
and it is the only option that satisfies R1-R5 together.

It also **removes** a real hazard: today `sql-split`'s dialect rules and lang-sql's grammar are two
independent lexers over the same text that can disagree (R4). After P60b there is one.

**No new dependency. P60b's `package.json` change is nine deletions and zero additions.**

---

## 3. `packages/shared/domain/sql-tokens.ts`

```
export interface LNode {
  readonly name: string; readonly from: number; readonly to: number;
  readonly firstChild: LNode | null; readonly nextSibling: LNode | null;
}
export function tokenizeSql(source: string, options: SqlTokenOptions): LNode;  // the root
export interface SqlTokenOptions { backslashEscapes: boolean; dollarQuoting: boolean;
                                   keywords: ReadonlySet<string>; identifierQuotes: string; }
```

`LNode` moves here verbatim from `lezerNodes.ts:9` — **every consumer's type is unchanged**, which
is what keeps `ddl.ts`, `sqlRefs.ts`, `sqlHover.ts` and `sqlDiagnostics.ts` byte-for-byte identical
apart from their dialect parameter (§4).

### 3.1 Scanning

One forward pass, reusing `sql-split.ts`'s exact rules (copy the state machine into a shared helper
both files call, rather than a third independent copy — `sql-lint.ts` should be pulled onto the same
helper in the same commit, closing the duplication those two already carry):

| Input | Emitted node |
| --- | --- |
| `-- …` to EOL | `LineComment` |
| `/* … */` (unterminated → to EOF) | `BlockComment` |
| `'…'`, `$tag$…$tag$` (when `dollarQuoting`) | `String` |
| `"…"` / `` `…` `` — per `identifierQuotes` | `QuotedIdentifier`, else `String` (MySQL's `doubleQuotedStrings`) |
| digits (incl. `1.5`, `1e6`, `0x…`) | `Number` |
| `null` / `NULL` | `Null` |
| word in `keywords` | `Keyword` |
| other `[A-Za-z_][\w$]*` | `Identifier` |
| `;` | `;` |
| `.` | `.` |
| `(` … `)` balanced | `Parens` (children include the literal `'('` / `')'` nodes) |
| `,` `:` and other separators | `Punctuation` |
| `= < > + - * / % \|\| !` runs | `Operator` |

**Unterminated anything is not an error** (R2): an unterminated string runs to EOF and emits a
`String`; an unclosed `(` emits a `Parens` ending at EOF. Never throws. `sql-lint.ts` is what
*reports* those, unchanged.

### 3.2 Grouping

Two passes over the flat token list, in this order:

1. **`CompositeIdentifier`** — any maximal run `name ('.' name)+`, where *name* is
   `Identifier | QuotedIdentifier | Keyword` (`isNameNode`'s existing set, `lezerNodes.ts:31`).
   Children are the name nodes and the literal `'.'` nodes, in order — `splitComposite` (`:54`) and
   `sqlDiagnostics.ts:67` both depend on that exact shape.
2. **`Statement`** — split on top-level `;` (never inside a `Parens`, a `String` or a comment,
   which the scanner has already resolved). Each `Statement` spans from its first token to its
   terminator; the `;` itself is a child (`ddl.ts:329` and `sqlRefs.ts:170` both filter it out).
   Empty runs emit no `Statement`.

`Parens` nesting is produced by the scanner, not a pass — a stack, as `sql-lint.ts` already keeps.

### 3.3 Keywords (`packages/shared/domain/sql-keywords.ts`)

`keywordsFor(dialect: SqlDialect): ReadonlySet<string>` — one curated set per dialect, in the same
spirit as `languages.ts:116`'s hand-curated `ClickHouseDialect` keyword string (moved here, not
rewritten) and `sqlIdent.ts`'s own `COMMON_RESERVED`.

**Correctness requirement, not a nice-to-have.** Several consumers branch on `name === 'Keyword'`:
`ddl.ts:232` (`TABLE_CONSTRAINT_LEADING`), `ddl.ts:97` (`TYPE_STOP_WORDS`, which *also* accepts
`Identifier`, so it degrades safely), `sqlRefs.ts:35,119` (`END_FROM`, `joinStart`),
`lezerNodes.ts:60` (`isKeyword`). A word missing from the set silently changes behaviour — e.g.
without `primary`, `PRIMARY KEY (a, b)` would be parsed as a *column* named `PRIMARY`, the exact
phantom `ddl.ts:55` exists to prevent.

So: every dialect's set **must** contain the union of `TABLE_CONSTRAINT_LEADING` (9),
`TYPE_STOP_WORDS` (15), `END_FROM` (13), `joinStart` (7), and the statement/clause words the walkers
consume (`create or replace unique table view index alter add column comment on is if not exists as
with recursive from join using set values insert update delete select`). Enforce it with a unit test
asserting set membership for all five dialects — cheap, and it catches the one failure mode that is
invisible at runtime.

`isNameNode` keeping `Keyword` (`lezerNodes.ts:37`, F5.1: a column literally named `id`) stays
correct and stays necessary regardless of how narrow the set is.

### 3.4 Caching — preserving the hover perf fix

`editor/hover.ts:44`'s `syntaxTree(view.state)` handoff exists because re-parsing on every hover
measured **up to ~51 ms on a 191 KB document**, over the 50 ms budget with no debounce. Monaco keeps
no parse tree, so that handoff has no equivalent.

**D2: a module-level memo in `sql-tokens.ts`** — key `(dialect, source)` compared by *reference* for
the string, size 2, evicting FIFO. Exactly the technique `findRanges.ts:38` already uses for the
same reason (several callers, same immutable string, one keystroke) and `state/schemas.ts:83` uses
for `parseDdl`. A hover, a lint run and a completion over the same untouched document then share one
tokenize.

This must be demonstrated, not assumed — §8 rewrites `sql-hover-no-reparse.spec.ts` to count
`tokenizeSql` scans instead of monkeypatching lang-sql's parser.

---

## 4. Changes to the analysis modules — small, by construction

Because `LNode` is preserved, these files change only in how they *obtain* a tree and how they name
a dialect. `dialectObjectFor` and the `SQLDialect` type are deleted; every signature takes
`SqlDialect` (the plain string union from `views/shared/sqlIdent.ts`) instead.

| File | Change |
| --- | --- |
| `lezerNodes.ts` | `LNode` re-exported from `@shared/domain/sql-tokens`; `childrenOf`/`text`/`isNameNode`/`unquotedName`/`splitComposite`/`isKeyword`/`keywordText`/`TokenCursor` **unchanged**. Rename the file `sqlNodes.ts` (nothing about it is Lezer any more) |
| `ddl.ts` | `parseDdl(dialect: SqlDialect, source)`; `:357` becomes `tokenizeSql(source, tokenOptionsFor(dialect))`. `toSqlNamespace`/`namespaceFromCached` (`:378,405`) no longer return lang-sql's `SQLNamespace` — they return the app's own `SchemaNamespace` (§5.1). Everything between is untouched |
| `sqlRefs.ts` | `statementsWithRefs(dialect: SqlDialect, source, root?)`; `:166` becomes `tokenizeSql(...)`. The walkers are untouched |
| `sqlHover.ts` | `sqlHoverSource(dialect: SqlDialect, schema)` returns the new pure `(doc, offset) => ConsoleHoverInfo \| null` (P60a §3.1) instead of a `HoverTooltipSource`. `resolveHover` (`:61`) loses its `tree` parameter and calls the memoised `tokenizeSql` directly — D2 is what makes that free. Its CTE-shadow logic, `MAX_TABLE_COLUMNS`, `columnFlags`, both hover-info builders: untouched |
| `sqlDiagnostics.ts` | `ddlDiagnostics(dialect: SqlDialect, text, schema, root?)`. Body untouched |
| `lint.ts` | `:27` drops `dialectObjectFor`; passes `dialect` straight through. Body untouched |
| `state/schemas.ts` | `:80-86`, `:103-107` drop `dialectObjectFor`; `parseDdl(dialect, text)`. The memo (`parsedCache`) is unchanged |

---

## 5. Completion without `lang-sql`

`sqlLanguageService.ts:73` composes three sources. Two come from the library and must be rebuilt:

### 5.1 `schemaCompletionSource` → `views/console/sqlSchemaCompletion.ts`

What the library gave, as this app configures it (`:84-88`): table names at an identifier position,
`table.`/`alias.` column completion, alias resolution within the current statement, qualified
`schema.table.column` paths, and a `defaultSchema` that flattens one level.

**Rebuilt on machinery this repo already owns, and better connected than today.** `sqlRefs.ts`'s
`statementsWithRefs` already resolves FROM/JOIN refs, aliases and CTE names — and `sqlRefs.ts:12`
records that it was written from scratch *because* lang-sql's own `getAliases` was not reusable. So
today the console has **two** alias resolvers that can disagree: lang-sql's (completion) and this
repo's (hover + diagnostics). After P60b there is one, shared by all three. That is a genuine
consolidation, not a consolation.

Positions, in order (each a plain regex over `doc.slice(0, offset)` — the same technique
`relationCompletionSource` (`:41`) and `mongoCompletionSource` (`completion.ts:132`) already use):

1. `<qualifier>.` where `qualifier` resolves via `statementsWithRefs` to a table/alias (and is not a
   CTE name) → that table's columns, `boost` on primary keys, `insertText` quoted via
   `identNeedsQuoting`/`quoteIdent` (`ddl.ts:419`'s existing rule).
2. `<schema>.` where `schema` is a known schema qualifier → that schema's tables.
3. after `FROM|JOIN|UPDATE|INTO|TABLE ` → relation names — `relationCompletionSource`
   (`sqlLanguageService.ts:35`) ports nearly verbatim.
4. bare word → table names + the keyword source below.

`SchemaNamespace` replaces `SQLNamespace`: `{ [name: string]: SchemaNamespace | EditorCompletion[] }`
— the same recursive object `toSqlNamespace` (`ddl.ts:378`) already builds, typed by this app.
`defaultSchemaFor` (`:451`) is unchanged and still decides whether a schema level is flattened.

### 5.2 `keywordCompletionSource(dialect, true)` → `sqlKeywordCompletion.ts`

Offers each dialect's keywords **and type names, uppercased** (`languages.ts:173`'s
`upperCaseKeywords: true`, whose reasoning — house style, and `FuzzyMatcher` case-folds so `sel`
still matches `SELECT` — stays true). Reads `keywordsFor(dialect)` (§3.3) plus a new
`typesFor(dialect)` in the same file, seeded from `ClickHouseDialect.types` (`languages.ts:134`) and
the standard type vocabulary. `type: 'keyword'`.

### 5.3 Wiring

`sqlCompletionSources` (`:73`) keeps its exact three-branch layering — DDL document wins, else the
metadata cache (`state/schemaColumns.ts`'s `cachedRelationsFor`), else tree-cached relation names,
else `undefined` — and its long doc comment (`:56-72`) stays true word for word. Only the two source
constructors change.

`completion.ts`'s Mongo and Redis sources (`:123`, `:215`) move to the new
`EditorCompletionSource` shape: `context.matchBefore(re)` → a regex over `ctx.doc.slice(0, ctx.offset)`,
`context.state.sliceDoc(0, from)` → `ctx.doc.slice(0, from)`, `snippet('…#{}…')` (`:24`) →
`insertText` with `$0` + `InsertAsSnippet`. Their *positions and vocabularies* are untouched.

---

## 6. The two remaining mounts

### 6.1 `ConsoleView.vue`

Swap `CodeMirrorHost` → `MonacoHost`. Props are identical names; three carry new (pure) types:
`completionSources`, `lintSource` (already pure), `hoverSource`.

Everything else in the file is editor-agnostic and stays: `localDoc`/`lastEmitted` echo guard
(`:200`), `splitStatementsForText` (`:113`, the P21 perf fix — keep it, `update:cursor` still fires
on bare caret moves), `statementAtCursorText` (`:123`), `runStatement`/`runAll`, `onFormat`
(`:366`), the three format strips, auto-explain.

Two things to verify rather than assume:

- **`onFormat`'s caret mapping** (`:387-391`) calls `editorHost.setCursor(target.start)` after
  `setText`. `MonacoHost`'s `setCursor` plus `keepSelectionOnExternalSync` must reproduce it, **and
  the undo boundary of P60a §4.7 must hold here specifically** — this console is where the v1.4
  Format-then-undo bug actually happened.
- **`focus()` after the saved-queries popover closes** (`:189`).

### 6.2 `SchemaDialog.vue`

Swap the mount (`:135`). It passes `:autocomplete="true"` with **no** `completionSources` and today
relies on lang-sql's own language-data keyword source (`:129-134`). With `override` gone that
implicit source has no equivalent — so pass the §5.2 keyword source explicitly, through a new
`state/schemas.ts` dispatch export (SPEC §11 forbids `project/` importing `views/`; `schemaDialectFor`
and `ddlParseSummary` (`:95,102`) are the existing precedent for exactly this).

Behaviour is then identical to today's and the comment at `:129` stays accurate. The 400 ms
parse-summary debounce (`:39`) stays; its comment's reference to `@codemirror/lint` becomes the
host's own marker debounce.

---

## 7. Removal

Once §6 lands, delete:

- `editor/CodeMirrorHost.vue`, `editor/theme.ts`, `editor/languages.ts`, `editor/wrapSelection.ts`
- `editor/hover.ts`'s `buildHoverSource` (keep `ConsoleHoverInfo`, `formatHoverValue` — move both
  into `editor/hoverInfo.ts`)
- `editor/variableHighlight.ts`'s `rangeHighlightPlugin` (keep `RangeHighlight` — move into
  `editor/ranges.ts`)
- From root `package.json` `devDependencies`: `@codemirror/autocomplete`, `@codemirror/commands`,
  `@codemirror/lang-json`, `@codemirror/lang-sql`, `@codemirror/lang-xml`, `@codemirror/language`,
  `@codemirror/lint`, `@codemirror/state`, `@codemirror/view`, `@lezer/highlight`. Then
  `bun install`.

Final gate: `grep -rn "codemirror\|@lezer\|CodeMirror\|\.cm-" apps/ packages/ --include=*.ts
--include=*.vue` returns **only** historical prose in plan docs. Comments in live source that say
"CodeMirror" (there are ~30, listed in P60a §1) get rewritten to name what the code now does, not
deleted wholesale — several carry a *reason* (e.g. `wrapSelection.ts:8`'s "the console's lint must
see an unterminated string literal", which survives as the reason `autoClosingBrackets` stays off in
the console).

---

## 8. Testing

### 8.1 `ddl-schema.spec.ts` is the golden test — reuse it, don't rewrite it

`tests/unit/ddl-schema.spec.ts` (343 lines) is the DDL extractor's behavioural contract across four
dialects: qualified vs. unqualified names, quoted/bare/keyword-shaped column names, nested type
parens, table constraints that are not columns, `IF NOT EXISTS`, silently-skipped statements.

**Change only its dialect arguments** (`PostgreSQL` → `'postgres'`, etc.; delete its local
`ClickHouseDialect` copy at `:18`) and leave every input and every expected `DdlSchema` untouched.
If the new tokenizer passes all 343 lines unchanged, §3 is right. **Run this first**, before the
console is migrated — it is the cheapest possible proof the tokenizer replacement works.

### 8.2 The other three unit specs

- `sql-cte-shadow.spec.ts` — swap dialect args; assertions unchanged.
- `sql-hover-no-reparse.spec.ts` — rewritten: instead of monkeypatching lang-sql's parser, count
  `tokenizeSql` invocations across a hover + a lint + a second hover over the same document string,
  asserting **one** scan (D2's memo). Same property, honest mechanism.
- `console-root-completion.spec.ts` — the root-console relation-name branch; swap to the new
  source shape.

### 8.3 New unit tests

Two, both clearing CLAUDE.md's bar (interacting rules, boundary arithmetic):

- `sql-tokens.spec.ts` — the scanner and the two grouping passes: nested `Parens`; `;` inside a
  string / a comment / a dollar-quote; unterminated string, comment and paren (must not throw);
  `CompositeIdentifier` runs of 2 and 3 segments; MySQL `"x"` as a String vs Postgres `"x"` as a
  QuotedIdentifier; `backslashEscapes` on and off.
- `sql-keywords.spec.ts` — the §3.3 membership assertion for all five dialects.

Nothing else added in P60b gets a test: the providers are thin adapters over these.

### 8.4 UI specs

`console.spec.ts` (4 selectors), `console-format.spec.ts` (9), `console-explain.spec.ts` (3),
`sql-schema.spec.ts` (22), `autocomplete.spec.ts` (41). Same selector map and the same two
behavioural rules as P60a §9.1 (virtualised lines; `fill()` does not work on Monaco).

`autocomplete.spec.ts` is the heaviest and mostly exercises `AutocompleteField`'s **native `<input>`**
— P60a leaves that element native, so most of its `fill()` calls need no change; only its
`.cm-tooltip-autocomplete` assertions move to `.suggest-widget.visible`.

`budgets.spec.ts:41` explicitly measures the **console autocomplete popup** against 50 ms. Re-run
and record; this is the one budget P60b is most likely to move, in either direction.

---

## 9. Implementation steps

1. `packages/shared/domain/sql-keywords.ts` — per-dialect keyword and type sets (§3.3) + its unit
   test. Nothing consumes it yet.
2. Hoist `sql-split.ts`'s quote/comment/dollar-quote scanner into a shared helper; point
   `sql-split.ts` and `sql-lint.ts` at it. **No behaviour change** — their existing tests must pass
   untouched. `refactor:`.
3. `packages/shared/domain/sql-tokens.ts` — scanner, grouping, memo (§3) + `sql-tokens.spec.ts`.
4. Move `LNode` there; rename `lezerNodes.ts` → `sqlNodes.ts`, re-exporting. `refactor:`.
5. Repoint `ddl.ts`, `sqlRefs.ts`, `sqlDiagnostics.ts`, `sqlHover.ts`, `lint.ts`, `state/schemas.ts`
   onto `SqlDialect` + `tokenizeSql`; delete `dialectObjectFor`. **Run §8.1 here** — the gate.
6. `sqlKeywordCompletion.ts` (§5.2).
7. `sqlSchemaCompletion.ts` (§5.1) + rewire `sqlLanguageService.ts`.
8. Port `completion.ts`'s Mongo/Redis sources to the new shape (§5.3).
9. `ConsoleView.vue` → `MonacoHost` (§6.1).
10. `SchemaDialog.vue` → `MonacoHost` + explicit keyword source (§6.2).
11. Delete the CodeMirror modules and the ten packages (§7); `bun install`.
12. Unit + UI test rework (§8).
13. Docs (§10).

---

## 10. Documentation to update

- `docs/ARCHITECTURE.md:32` — rewrite the "Text editing / viewing" row to a single engine (P60a
  starts this; P60b finishes it and removes the last CodeMirror sentence).
- `docs/ARCHITECTURE.md:29` — the lazy-chunk inventory, with the final measured `index-*.js` size.
- `docs/ARCHITECTURE.md` — add a short section on the in-house SQL tokenizer: the three siblings in
  `packages/shared/domain/`, and *why* no library was taken (§2's table, compressed). This is an app
  fact and belongs there, not in a plan doc.
- `docs/ARCHITECTURE.md` "Known open items" — add anything §11 leaves genuinely open; delete
  nothing that is still true.
- `docs/PERF.md` §2.1 — the console-keystroke budget, re-measured.
- `docs/v1.6/mcp-repo-map-issues.md` — dogfooding findings.

---

## 11. Explicitly out of scope

- A *real* SQL binder. `sqlDiagnostics.ts:8` already declines ambiguous-unqualified-column for
  stated reasons (USING, natural joins, lateral scopes); that stays declined. The new tokenizer must
  not tempt anyone to widen the analysis — P60b changes *how the tree is produced*, never what is
  inferred from it.
- Subquery walking (`sqlRefs.ts:155`: "Subqueries are not walked — this is a best-effort binder").
- New SQL dialects.
- Relation/column completion **inside** the DDL document itself — `SchemaDialog.vue:131` records it
  as "a separate, larger piece of work… left for a later phase". Still later.
- Monaco language services / a second worker. The one-worker invariant (`monacoEntry.ts:60`) holds.

---

## 12. Verification

### 12.1 Feature checklist — the acceptance bar

**SQL completion** (Postgres console, connection with a saved DDL document)
- [ ] Bare word offers keywords and type names, **uppercased**; typing `sel` still matches `SELECT`.
- [ ] `FROM ` offers table names.
- [ ] `FROM users u WHERE u.` offers `users`' columns.
- [ ] `FROM users WHERE users.` offers the same.
- [ ] `public.` offers the `public` schema's tables.
- [ ] Primary-key columns sort first.
- [ ] A column needing quotes (`order`, a case-sensitive name) inserts **quoted**.
- [ ] A relation needing quotes inserts quoted; the label stays bare so matching works.
- [ ] Tab accepts; **Enter inserts a newline** and does not accept.
- [ ] With **no** DDL document but cached metadata: identical table/column/alias completion, no manual step.
- [ ] With neither, but tree-loaded relations: table names only, plus keywords.
- [ ] Root-opened console: the union of every loaded container's relation names.
- [ ] With all three empty: no popup, no error.

**SQL diagnostics**
- [ ] `SELECT * FROM nosuchtable` → warning squiggle on the table name, message `unknown table "nosuchtable" — not in this connection's DDL`.
- [ ] `SELECT u.nosuch FROM users u` → warning on the column, `"users" has no column "nosuch"`.
- [ ] A CTE shadowing a real table name → **no** diagnostic (false positive is worse than missing).
- [ ] A table-valued function (`FROM generate_series(1,10)`) → no diagnostic.
- [ ] An unterminated quote → the lexical error from `sql-lint`, **and** DDL warnings still computed for the rest.
- [ ] Unbalanced paren → lexical error.
- [ ] Warnings are warning-coloured, errors error-coloured; no gutter marker, no lint panel.
- [ ] Diagnostics settle ~400 ms after typing stops, not per keystroke.

**SQL hover**
- [ ] Hover a table name → qualified name + column list, capped at 40 with `+N more`.
- [ ] Hover a view name → `(view)` suffix, no columns.
- [ ] Hover `u.id` → `users.id — integer` plus flags (`PRIMARY KEY`, `NOT NULL`, `UNIQUE`, `INDEXED`) and the `COMMENT ON COLUMN` description.
- [ ] Hover a bare column referenced by exactly one table in the statement → resolves; by two → **nothing**.
- [ ] Hover a CTE-shadowed qualifier → nothing.
- [ ] No DDL document → no hover at all (not an empty card).
- [ ] Hover on a ~190 KB document stays responsive (D2's memo).

**DDL document (`SchemaDialog`)**
- [ ] Paste `pg_dump --schema-only` output → "N tables, M columns" after ~400 ms.
- [ ] Paste `SHOW CREATE TABLE` output (MySQL, backticks) → recognised.
- [ ] Paste `.schema` output (SQLite) → recognised.
- [ ] ClickHouse DDL → recognised.
- [ ] Unrecognisable text → "No tables recognised in this text — check the paste", no crash.
- [ ] Typing in the editor offers keyword/type completion (`VARCHAR`, `NUMERIC`, `REFERENCES`, `NOT NULL`).
- [ ] Save → the console's completion/hover/diagnostics pick it up.

**Console editing**
- [ ] Mongo console: `db.` offers collections, `db.x.` offers methods, `$` offers operators, a bare word offers sampled fields + BSON constructors with the caret landing **inside** the parens.
- [ ] Redis console: the first token of each `;`-separated statement offers commands with arity hints; nothing elsewhere.
- [ ] Mongo/Redis/SQL colouring in the console matches the pre-change build.
- [ ] Run statement runs the statement under the caret, after a bare caret move with no edit.
- [ ] Run all runs every statement; the split agrees with Format's.
- [ ] Format reformats every statement; a broken one is emitted verbatim in place; the trailing `;` is preserved iff the source had one.
- [ ] **After Format, the caret is in the same statement it was in.**
- [ ] **After Format, one ⌘Z undoes only the reformat.**
- [ ] Loading a saved query replaces the text, scrolls to top, and returns focus to the editor.
- [ ] Explain is enabled only for a SELECT/WITH under the caret.
- [ ] Auto-explain strip clears on the next edit.

### 12.2 Mechanical

```
bun run typecheck && bun run lint && bun run build
bun run test:unit && bun run test:ui && bun run test:visual
grep -rn "codemirror\|@lezer" apps/ packages/ --include=*.ts --include=*.vue --include=*.json
```

The `grep` must return nothing outside `docs/`. Record the final `index-*.js` raw + gzip against
P60a's baseline (1 723.09 kB / 520.66 kB before the phase). Confirm `dist/assets/` still has exactly
one `editor.worker-*.js` and no language-service worker.

### 12.3 Manual recipe

1. `bun run dev`; Postgres connection; connection menu → **Schema (DDL)**; paste a real `pg_dump
   --schema-only`; confirm the summary; Save.
2. Open a SQL console on that connection. Walk every completion, diagnostic and hover box in §12.1.
3. Type a multi-statement script, one deliberately broken. Format. Check the caret, the warn strip,
   the trailing `;`. ⌘Z.
4. Run statement, Run all, Explain.
5. Repeat 1-4 against MySQL (backtick identifiers, `"x"` as a *string*), SQLite, ClickHouse.
6. Open a Mongo console and a Redis console; check colouring, completion and lint on each.
7. Close every connection; reopen; confirm the DDL document and its completions survive.

---

## 13. Open questions for a human

**OQ-1 — where the tokenizer lives.** §3 puts it in `packages/shared/domain/`, beside its two
lexical siblings, so all three share one quote/comment scanner and a unit test needs no renderer
import. The alternative is `views/console/`, keeping a renderer-only concern out of a package `main`
and `engine` also import (it is tree-shaken either way, but the *package* gains a file neither uses).
*Recommendation: `shared/domain`. The shared scanner (step 2) is the real payoff, and it closes an
existing duplication between `sql-split.ts` and `sql-lint.ts`.*

**OQ-2 — keyword-set breadth.** Postgres's lang-sql list is 763 words; §3.3 proposes curated
per-dialect sets with an enforced minimum. Curated risks a missing word changing a parse silently
(mitigated by the membership test and by `TYPE_STOP_WORDS` accepting `Identifier` too); exhaustive
risks the opposite — more words classified `Keyword`, which `isNameNode` already tolerates but which
widens `END_FROM`-style false matches. *Recommendation: curated + the membership test. This repo
already curates ClickHouse's list for the same reason.*

**OQ-3 — `sql-hover-no-reparse.spec.ts`'s replacement.** §8.2 rewrites it to count `tokenizeSql`
scans. That tests D2's memo rather than the original property (reusing the editor's own incremental
tree, which no longer exists). Is asserting "one scan per document per interaction burst" the right
successor property, or should this spec be deleted as testing a mechanism that is gone?
*Recommendation: keep the rewrite — the underlying requirement (no redundant full parse on the
hover path) is still real and still the thing that broke the 50 ms budget once.*

**OQ-4 — GPL, re-confirmed.** §2 declines `sql-parser-cst` (the best technical fit) purely on
GPL-2.0-or-later. If this app's distribution posture ever permits GPL, that decision is worth
revisiting — it would delete §3 entirely. Flagged for an explicit human ruling now rather than an
assumption. *Recommendation: decline, as planned. A packaged MIT desktop binary and a GPL parser is
not a call to make implicitly.*
