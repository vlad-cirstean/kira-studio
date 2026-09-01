# P13 — Query console format button

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:28`, P13 row): *"Add a "Format" button to
> every query console this app ships — each SQL dialect's console (Postgres, MySQL/MariaDB, SQLite,
> ClickHouse) and any non-SQL query/command surface the current adapter set exposes (Mongo's query
> console, Redis' command console, Kafka's, and whatever else the tree actually has a query/command
> input for) — that reformats the console's current query text in place, using a real formatter for
> that console's language rather than a cosmetic no-op."* Why: *"A real editing quality-of-life gap in
> the console surfaces that every phase up to now has left untouched."*
>
> **The headline, in one line: there are seven console-bearing connection kinds, not ten, and they
> reduce to exactly three formatting stories — five SQL dialects that one maintained library covers
> outright, one Mongo console this repo already owns every parser for, and one Redis console with
> nothing to format.** `caps.sql` is what puts an "Open console" item in the tree menu
> (`project/menus.ts:95`) and what mounts `ConsoleView.vue` at all; it is `true` for postgres,
> mariadb, mysql, sqlite, clickhouse, mongodb and redis, and `false` for kafka, sqs and s3
> (`internal/adapters/*/caps.go`, one line each — see §1.1's table). **Kafka, named in the SPEC row,
> has no query console and never did**: `kafka/adapter.go:197` answers `Execute` with
> `adapters.NoQueryConsole("kafka")`, and so do `sqs/adapter.go:212` and `s3/adapter.go:178`.
>
> **`sql-formatter` covers all five SQL dialects by name, including ClickHouse.** v15.8.2 (MIT,
> released 2026-06-21, eight releases in 2026) exports `postgresql`, `mysql`, `mariadb`, `sqlite` and
> `clickhouse` as first-class dialect objects — **[verified here]**, `Object.keys(require('sql-formatter'))`.
> Nothing like it is a dependency today (`package.json` has no formatter of any kind).
>
> **The Mongo console needs no new dependency at all, because the two parsers it would need are
> already in the tree and already used by the console's own linter.**
> `views/shared/document/ejson.ts:601`'s `beautifyShellText` reindents Mongo shell-literal text
> losslessly (it is the document editor's Beautify button), and `views/console/lint.ts`'s
> `MONGO_STATEMENT_RE` (`:16`), `findMatchingParen` (`:81`) and `splitTopLevelArgs` (`:105`) already
> split `db.<coll>.<method>(a, b)` into its parts. A Mongo Format is those four pieces composed —
> extracted from `lint.ts` into a module both files import, not reimplemented.
>
> **The Redis console gets no button, deliberately.** A Redis statement is a flat, whitespace-
> separated token list (`internal/adapters/redis/console.go:16-56`'s `tokenize`); there is no nesting,
> no clause structure and no maintained Redis-command formatter to depend on. The only transformation
> available is collapsing runs of whitespace, which is not formatting — see D6, which records the
> narrow alternative in case the trade is ever wanted.
>
> **The bundle cost is measured, and it is why the formatter loads lazily.** **[verified here]**
> Tree-shaken to `formatDialect` plus the five dialects the app can reach, `sql-formatter` bundles to
> **142 314 B raw / 38 036 B gzip**; imported through the package's default `format` entry (all 21
> dialects) it is **293 771 B / 75 447 B**. Against the current single chunk (1 053 028 B / 333 298 B),
> a static import is **+13.5 % raw / +11.4 % gzip on every launch** for a button most sessions never
> press. The renderer has **zero** dynamic `import()` today (`editor/languages.ts:139` states the one
> place it was considered and declined); P13 introduces the first one, and P5's own D8 already
> anticipated exactly this kind of split (`docs/v1.1/plans/P5-ram-usage.md:466`).

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `69377dd` (`test(ui): the row-colouring toggle, and strings render plain`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1-P11 have landed; P12 has not.

Nothing P9 landed touches this phase's subject — its edits are `theme/icons.ts`, `DataGrid.vue`, the
`appearance.*` settings path and one `tests/ui/` spec, none of which the console or the editor host
reads. What P9 *does* hand P13 for free is a freshly-exercised worked example of the repo's
plan-shaped commit sequence, which §5 follows.

### 0.2 Scope

1. A **Format** button in the query console's toolbar, on every console where formatting is a real
   operation: the five SQL dialects and MongoDB. It reformats the whole console document in place.
2. `sql-formatter` as a new dependency, loaded through a **lazily-imported chunk** so it costs
   nothing at boot, mapped per connection kind to its own dialect (MariaDB and MySQL get *different*
   dialects, unlike the app's own `SqlDialect` union — D3).
3. A Mongo console formatter built from parsers already in the tree, with the three helpers it shares
   with the console linter extracted into one module instead of duplicated.
4. A `view.format` command: the shared shortcut table, the Go accelerator table, a View-menu item, an
   event channel, the App-level subscription, the command-palette entry — the same seven-file path
   `view.run`/`view.run-all` already take.
5. A format failure surfaces as a message strip naming the reason, and leaves the document untouched.
6. One new `tests/ui/` spec.

### 0.3 Not in this phase

- **A Format button on the Redis console.** D6. There is no formatter for a flat command line and no
  library to depend on; the console's own linter already warns about the one whitespace hazard that
  exists there (`lint.ts:235-249`).
- **A Format button for Kafka, SQS or S3.** They have no console: `caps.SQL` is `false` and the
  adapter refuses `Execute` outright (F2). The only free-text surface any of them has — a new stream
  message's value — is the shared cell editor, which has carried **Beautify/Minify** since P24
  (`views/shared/EditBufferActions.vue:57-73`). Nothing is missing there.
- **The filter boxes.** The grid's WHERE/ORDER BY row (`views/grid/FilterToolbar.vue`) and the Mongo
  document filter (`views/documents/DocumentView.vue`) are single-line `AutocompleteField` inputs
  mounted with `singleLine` (`CodeMirrorHost.vue:39-43`) — one line has no indentation to produce.
  Kafka's stream filter is a structured offset/partition/timestamp form
  (`packages/shared/domain/streamFilter.ts:8-21`), not a language.
- **Format-selection.** VS Code's second verb. The SPEC row asks for "the console's current query
  text"; a selection-scoped variant is an additive follow-up, recorded as OQ-1.
- **Preserving the caret across a format.** Writing the document back moves the caret to offset 0 and
  scrolls to the top, because `CodeMirrorHost.vue:213-228` does that for every external write. This is
  the existing, shipped behaviour of the cell editor's Beautify button; matching it is deliberate (D8),
  and OQ-2 hands the improvement forward.
- **A settings leaf for formatter options** (indent width, keyword case, line width). One fixed,
  stated configuration ships (D4); a settings surface for it is OQ-3, and P17 rewrites that dialog
  anyway.
- **Any Go-side change beyond the accelerator/menu/channel table rows.** Formatting is pure text
  editing in the renderer; no adapter, no wire op, no cache tier is involved.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim below is **[verified in source]** against this
  tree at the cited `file:line`, or **[verified here]** where it was executed in this sandbox.
- **One new dependency, and its cost is measured before it is added, not after** (§1.5, F8).
- **No new abstraction where one exists.** The failure shape is `beautify.ts`'s existing
  `BeautifyResult` (`:3-9`); the toolbar button is `AppButton`; the strip is `MessageStrip`; the
  command is `registerCommand`. Nothing new is invented that the console already has a spelling for.
- **No unit test for the SQL path** — calling a library and mapping five kinds onto five dialect
  objects is a lookup table, explicitly below `AGENTS.md`'s bar. **One unit test for the Mongo
  formatter** is genuinely earned: it is a composed parser/emitter over a hand-written grammar with
  real boundary cases (nested constructor calls, an empty argument list, a trailing comma). D10.
- **Comments only where the code cannot say it for itself.** Three are owed: why the dialect map is
  keyed on `ConnectionKind` and not `SqlDialect` (D3), why `keywordCase` is left at `preserve`
  (D4/F6), and why the formatter entry module exists at all (D2).

---

## 1. What the code does today

### 1.1 Which consoles exist, and what language each one accepts

**[verified in source]** `caps.sql` is the single gate. `project/menus.ts:95` returns no menu items at
all when `caps.sql !== true`, so the *Open console* entry — and therefore the console tab — exists for
exactly seven kinds:

| Kind | `caps.SQL` | Console language, as the adapter actually parses it | CodeMirror mode (`editor/languages.ts:143-174`) |
|---|---|---|---|
| PostgreSQL | `postgres/caps.go:16` `true` | real SQL | `sql({dialect: PostgreSQL})` |
| MariaDB | `mariadb/caps.go:17` `true` | real SQL | `sql({dialect: MySQL})` |
| MySQL | `mysql/caps.go:16` `true` | real SQL | `sql({dialect: MySQL})` |
| SQLite | `sqlite/caps.go:24` `true` | real SQL | `sql({dialect: SQLite})` |
| ClickHouse | `clickhouse/caps.go:21` `true` | real SQL | `sql({dialect: ClickHouseDialect})` — defined in-repo, `languages.ts:112-136`, because lang-sql vendors none |
| MongoDB | `mongo/caps.go:18` `true` | `db.<collection>.<method>(<args>)` shell syntax, ten methods, arguments in a JSON5-lite BSON grammar (`internal/adapters/mongo/console.go:17-19`, `:83-120`; `mongo/literal.go` is the parser) | a hand-written `StreamLanguage` (`languages.ts:64-68`) |
| Redis | `redis/caps.go:18` `true` | real Redis CLI syntax — flat whitespace-separated tokens with optional quoting (`internal/adapters/redis/console.go:14-56`) | a hand-written `StreamLanguage` (`languages.ts:100-104`) |
| Kafka | `kafka/caps.go:19` **`false`** | **no console** — `kafka/adapter.go:197` returns `adapters.NoQueryConsole("kafka")` | — |
| SQS | `sqs/caps.go:17` **`false`** | **no console** — `sqs/adapter.go:212` | — |
| S3 | `s3/caps.go:17` **`false`** | **no console** — `s3/adapter.go:178` | — |

**The five SQL dialects are genuinely dialect-aware, not one generic SQL mode.** `sqlIdent.ts:25`
declares `SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'clickhouse'` and `sqlDialectFor` (`:28-35`)
maps kinds onto it; that dialect then drives three separate behaviours — the CodeMirror grammar
(`languages.ts:154-166`), identifier quoting (`sqlIdent.ts`'s `quoteIdent`, backtick vs double-quote),
and the statement splitter's backslash-escape regime (`BACKSLASH_ESCAPE_DIALECTS`, consumed by
`packages/shared/domain/sql-split.ts:14-19`). **MariaDB and MySQL deliberately collapse to one member**
of that union — `sqlIdent.ts:6-15` records why (quoting-and-grammar *family*, not product) — which is
correct for quoting and wrong for a formatter that ships both dialects separately (D3).

**Statements are `;`-separated on every console, including the non-SQL ones.**
`ConsoleView.vue:142-151`'s `runAll` calls `splitSqlStatements` regardless of connection kind, and
`lint.ts:236` splits Redis text on `;` for its own multi-line warning. So "the console's current query
text" is always a possibly-multi-statement document.

### 1.2 How a console toolbar button is built today

**[verified in source]** `ConsoleView.vue:283-347` is the whole toolbar, mounted into
`ViewChrome.vue:80`'s `#toolbar` slot (the component every non-grid view opens with, and the one the
grid's own `DataToolbar` was folded into in P48 — `docs/ARCHITECTURE.md:580-583`). The established
shapes, in order down that slot:

| Control | Lines | Primitive | Pattern |
|---|---|---|---|
| Run | `:284-293` | `AppButton` `icon="play"` `variant="primary"` | `data-testid`, `:disabled="running"`, `v-tooltip` |
| Run all | `:294-302` | `AppButton` `icon="run-all"` | same |
| (separator) | `:303` | `<div class="sep">` | groups the toolbar |
| new-result toggle | `:308-318` | `IconButton` with `:active` | a state toggle, no label |
| Saved queries | `:320-335` | `AppButton` inside a `.saved-anchor` | a popover anchored to its own trigger |
| Find | `:337-343` | `IconButton` `icon="search"` `:active` | |

`AppButton` (`theme/primitives/AppButton.vue:8-17`) takes `icon`/`variant`/`kind`/`active`/`count` and
forwards everything else to the `<button>`, which is how `:disabled="running"` already works on Run.
The **`#strips` slot** (`ConsoleView.vue:349-353`) currently mounts one `MessageStrip` for a run error.

**Commands are registered per-view, not branched centrally.** `shortcuts/commands.ts` is a
`Map<string, () => void>` that the mounted view writes into (`ConsoleView.vue:189-195` registers
`view.run`, `view.run-all`, `view.find`) and clears on unmount. A global shortcut reaches it through
the **native menu only**: `internal/shell/accel.go:37-52` holds the chord, `menutemplate.go:74-82`
builds the View menu item, `menu.go:55` emits `bridge.Events.Signal(channel)` to the focused window,
`packages/shared/protocol/events.ts:17` names the channel, `bridge/control.ts:120-123` subscribes, and
`App.vue:42-45` calls `runCommand`. `shortcuts/state.ts:18-36` lists the same ids in the command
palette. `packages/shared/domain/shortcuts.ts:24-38` is the one table both the Go accelerator map and
the displayed shortcut text derive from.

### 1.3 How the console's document is written, and what happens to the caret

**[verified in source]** `ConsoleView.vue:107-121`: the editor is bound to a `shallowRef` (`localDoc`),
not to `tab.state.text`, with a `lastEmitted` guard so a self-echo never round-trips. A write from
outside the editor goes `setText(tab.id, next)` (`views/console/state.ts:210-212`) →
`patchConsoleTabState` → the `props.tab.state.text` watcher (`:115-121`) → `localDoc` →
`CodeMirrorHost.vue:213-228`, which dispatches the replacement **with `selection: {anchor: 0}` and
`view.scrollDOM.scrollTop = 0`**. That is how a saved query loads today, and how the cell editor's
Beautify already behaves.

### 1.4 The app already has a Format button — for JSON, XML and Mongo documents

**[verified in source]** This is the precedent to match, not a new idea:

- `beautify.ts:241` `beautifyJson` / `:502` `beautifyXml` — lossless scanners (never
  `JSON.parse`/`stringify`; a number is reproduced from its exact raw slice) returning
  `BeautifyResult { text, ok, reason? }` (`:3-9`).
- `views/shared/document/ejson.ts:601` `beautifyShellText` — the same discipline over **Mongo shell
  literal text**, i.e. JSON plus constructor calls (`ObjectId("…")`, `ISODate("…")`), with the call's
  own argument captured whole and never interpreted. Built on `tryParseShellText` (`:521`), which
  `views/console/lint.ts` already imports to validate Mongo console arguments (`lint.ts:5`, `:184`).
- `views/shared/useEditBuffer.ts:69-81` `applyBeautify` — on success it writes the buffer; **on
  failure it leaves the buffer and the formatted-state flag alone and stores `result.reason`**.
- `views/shared/EditBufferActions.vue:57-73` — the two `IconButton`s, `:disabled="!canBeautify"`, with
  a tooltip that changes to explain *why* when disabled.

So the failure model, the result type and the "leave the text alone" rule all already exist and are
already shipped. P13 reuses them rather than inventing a second vocabulary.

### 1.5 The bundle discipline P5 established

**[verified in source]** `docs/v1.1/plans/P5-ram-usage.md:177-206` (F3) measured the production bundle
by sourcemap attribution and recorded that `vite.config.ts` sets no `manualChunks` and the app uses no
dynamic `import()`, so the entire chunk is parsed and compiled before first paint on every launch.
P5's **D8** (`:466`) proposed splitting CodeMirror into an async chunk *only if* a measurement showed a
boot-heap win, and is explicit that this is "the one step in the plan gated on its own measurement."
**[verified here]** the current build is one chunk: `frontend/dist/assets/index-BeyMb6Io.js`,
**1 053 028 B raw / 333 298 B gzip** — within 0.4 % of P5's own figure, so P5's composition table is
still the right frame of reference. **[verified in source]** `grep` for `import(` over
`apps/kira-studio/frontend/src` returns exactly one hit, and it is a comment
(`editor/languages.ts:139`) explaining why the language grammars are *not* dynamically imported.

---

## 2. Findings

### F1 — Seven consoles, not ten; and the SPEC row names one that does not exist
**[verified in source]** §1.1's table. `caps.SQL` is `false` for kafka/sqs/s3 and each adapter's
`Execute` returns `adapters.NoQueryConsole(kind)` (`errors.go:60-61` is the shared sentence). The SPEC
row's *"Kafka's [console]"* has no subject in this tree. The row's own escape hatch — *"whatever else
the tree actually has a query/command input for"* — is what §0.3 answers: the cell editor, which
already has Beautify.

### F2 — `sql-formatter` covers all five dialects this app can reach, ClickHouse included
**[verified here]** `sql-formatter@15.8.2`, MIT, `sideEffects: false`, a proper `exports` map with an
ESM entry and sibling `.d.ts` files. Its exported dialect objects include `postgresql`, `mysql`,
`mariadb`, `sqlite` and `clickhouse` (plus sixteen this app cannot reach). Release cadence: eight
releases between 2026-01-14 and 2026-06-21 — actively maintained, not a 2019 artifact. It is the only
candidate that covers ClickHouse: this repo already had to hand-define a ClickHouse dialect for
CodeMirror because lang-sql vendors none (`languages.ts:106-136`), so "does the formatter know
ClickHouse" was the real risk, and the answer is yes by name.

### F3 — The tree-shaken cost is 38 KB gzip; the naive cost is twice that
**[verified here]** esbuild `--bundle --minify --format=esm` (Vite 7's own minifier), against
`sql-formatter@15.8.2`:

| What is imported | Raw | gzip -9 | vs. today's 333 298 B gzip chunk |
|---|---|---|---|
| `formatDialect` + `postgresql` only | 72 607 | 19 902 | +6.0 % |
| `formatDialect` + all five reachable dialects | **142 314** | **38 036** | **+11.4 %** |
| `format` (the default entry, all 21 dialects) | 293 771 | 75 447 | +22.6 % |

The engine and grammar core is ~55 KB raw; each further dialect adds ~17 KB raw / ~4.5 KB gzip. The
three-line difference between the second and third rows is entirely down to which entry point is
imported — the package tree-shakes cleanly, but only if `format` (which pulls `allDialects`) is never
referenced.

### F4 — First format costs ~180 ms; every format after that is a few milliseconds
**[verified here]** Node/V8 in this container, `sql-formatter@15.8.2`, a 140-character
join+where+group+order statement repeated N times:

| | Time |
|---|---|
| `await import('sql-formatter')` (cold) | 82.3 ms |
| first `formatDialect` call (nearley grammar construction + JIT warmup) | 92.1 ms |
| warm, 1 statement | 4.3 ms |
| warm, 5 / 10 / 20 statements | 20.1 / 18.2 / 25.5 ms |
| warm, 50 statements (7 KB) | 62.0 ms |
| warm, 200 statements (28 KB) | 250.7 ms |
| warm, 1 000 statements (141 KB) | 1 155.1 ms |

So a realistic console document (a handful of statements) formats an order of magnitude inside
`docs/ARCHITECTURE.md:70`'s ~150 ms progress threshold, and only a pathologically large script — a
28 KB pasted migration or bigger — crosses it. The one-time ~180 ms is paid on the first Format press
per window, not at boot. These are V8 numbers; the shipped renderer is JavaScriptCore, which is why
§6.2 re-measures the warm case on the WebKit tier rather than trusting this row.

### F5 — `sql-formatter` **throws** on unparseable SQL, with an unusable message
**[verified here]** `formatDialect("sel ect from where (((", {dialect: postgresql})` throws an `Error`
whose message is a full nearley expectation dump — 3 400+ characters of grammar states. Every call
must therefore be wrapped, and the raised message must **not** be shown to the user verbatim; the
first line (`Parse error at token: «EOF» at line 1 column 23`) is the only usable part. Two other
inputs behave well: empty/whitespace-only text returns `""` rather than throwing, and a Postgres
dollar-quoted function body (`AS $$ BEGIN RETURN 1; END $$`) survives intact on one line, with its
inner `;` *not* treated as a statement break.

### F6 — `keywordCase: 'upper'` rewrites an unquoted identifier that collides with a keyword
**[verified here]** `formatDialect("select count() from system.tables where database='default'",
{dialect: clickhouse, keywordCase: 'upper'})` produces `WHERE\n  DATABASE = 'default'` — the column
name `database` uppercased because `DATABASE` is in that dialect's keyword list. This is harmless in
Postgres (unquoted identifiers fold to lower case), MySQL/MariaDB (case-insensitive column names) and
SQLite (case-insensitive identifiers), and **not** harmless in **ClickHouse, whose identifiers are
case-sensitive**. Quoted identifiers (`"MyCol"`, `` `t` ``) are never touched in any dialect. The
default, `keywordCase: 'preserve'`, produces `where\n  database = 'default'` and has no such hazard.

This cuts against the house style `languages.ts:150-153` records for completion (*"uppercases
keywords, type names and builtins alike — conventional SQL house style"*), which is why D4 states the
trade explicitly rather than picking silently.

### F7 — Everything a Mongo formatter needs is already in the tree, and three pieces of it are
private to `lint.ts`
**[verified in source]** `lint.ts:16` `MONGO_STATEMENT_RE`, `:81` `findMatchingParen`, `:105`
`splitTopLevelArgs` are module-private, and `lintMongoConsole` (`:149`) already composes exactly the
walk a formatter needs — match the statement shape, find the closing paren, split top-level arguments,
run each through `tryParseShellText`. The only step it does not take is emitting the result, which
`beautifyShellText` (`ejson.ts:601`) already does for one argument. A second copy of those three
helpers in a new `format.ts` would be precisely the divergence
`docs/ARCHITECTURE.md:571-575` ("shared machinery, not four reimplementations") exists to prevent.

### F8 — There is no bundle-size assertion anywhere, so a regression would be silent
**[verified in source]** `tests/ui/budgets.spec.ts` asserts interaction latencies only (scroll frame,
cell selection, tab switch, tree expand, completion popup — `docs/PERF.md:21-30`); nothing asserts a
byte size, and `docs/PERF.md:273`'s bundle-weight lever L-D is recorded as **"not re-measured for the
Wails bundle … unknown"**. So the 38 KB figure in F3 has to be *checked at implementation time against
the emitted chunk* (C2's own step) rather than assumed to hold: if the emitted chunk lands near
294 KB, the tree-shake silently failed and nothing in CI would say so.

### F9 — A dynamically-imported chunk is served correctly by every tier that matters
**[verified in source]** `apps/kira-studio/main.go:52` embeds `all:frontend/dist` and `:344-352`
serves it with `application.AssetFileServerFS` — a plain file server over the whole tree, so an extra
`assets/*.js` chunk needs no registration. `tests/ui/support/server.ts:8`/`:50-60` reads any path under
`DIST_DIR` and maps `.js` to `text/javascript`. `vite.config.ts:10` sets `base: './'`, so chunk URLs
stay relative to the importing chunk. The one path this does **not** prove is the packaged desktop
build's custom `wails://` URI scheme, which no tier in this repo exercises
(`AGENTS.md`'s Wails section: `/wails/*` is unreachable over plain HTTP from a desktop build) — §6.3
makes that a named manual check on a real Mac rather than an assumption.

### F10 — The existing menu test already guards a new accelerator, so the chord needs no new test
**[verified in source]** `internal/shell/menu_wails_test.go:28-62`'s
`TestBuildMenuAcceleratorsAllParse` walks the real built `*application.Menu` and fails if any template
item with a non-empty `Accelerator` came back with an empty `GetAccelerator()` — the guard against
Wails' `SetAccelerator` silently dropping an unparseable string. **[verified here]** in the pinned
module source, `pkg/application/keys.go:55-65`'s `modifierMap` accepts `"alt"` and `:149-174`'s
`parseKey` accepts any single printable character, so `Alt+Shift+F` (D7) parses — and the existing test
proves it at build time without a line being added to it.

### F11 — The console runtime has no `actionError` field, unlike the other four views
**[verified in source]** `views/shared/viewOp.ts:51-94`'s `createRuntimeStore` returns
`setActionError` only for a runtime type that has the field, and the comment at `:58-59` states the
split outright: *"browse's runtime has actionError but no searchOpen …, console's has searchOpen but
no actionError (nothing to mutate)"*. `ConsoleViewRuntime` (`views/console/state.ts:17-30`) confirms
it. So a format failure has nowhere to go in the shared runtime, and the existing `#strips` slot only
renders while `rt.status === 'error'` (`ConsoleView.vue:350`) — a status that means *the run failed*
and must not be borrowed for a client-side text operation. D9 resolves this with a component-local
ref, not a runtime-shape change.

---

## 3. Checked, and not fired

- **A second query/command input hiding somewhere.** `grep` for `CodeMirrorHost` across the renderer
  returns six mounts: the console (`ConsoleView.vue:364`), the cell editor, the definition Source
  pane, the document view, the op-log detail row, and `AutocompleteField.vue`'s single-line overlay.
  Only the first is a query console; the rest are read-only viewers, single-line fields, or the cell
  editor that already has Beautify.
- **A Kafka produce console.** `grep -rn "produce"` over the renderer returns only prose in comments.
  Producing goes through the stream view's ordinary immediate-mutation insert
  (`views/shared/immediateMutation.ts`), whose value editor is the cell editor.
- **`prettier` + `prettier-plugin-sql` as the SQL candidate.** The plugin delegates to
  `sql-formatter`/`node-sql-parser` anyway, and Prettier's standalone build plus a parser plugin is
  several hundred KB — strictly worse than F3's row 2 for the same output.
- **Doing the SQL formatting in Go instead.** It would put a pure text edit behind a data-plane round
  trip, and no Go library covers this app's five dialects (the ClickHouse hand-rolled adapter exists
  precisely because Go's ClickHouse tooling was not worth a dependency). The one genuine advantage —
  no renderer bytes — is already answered by the lazy chunk costing zero at boot.
- **Reusing `packages/shared/domain/sql-split.ts` to format statement-by-statement.**
  Unnecessary: `sql-formatter` handles a multi-statement document itself, keeping each `;`, separating
  statements with a blank line, and (F5) leaving a dollar-quoted body's inner `;` alone — better than
  the app's own splitter would, since the splitter is deliberately not a parser (`sql-split.ts:1-6`).
- **`NOTICES.md`.** It covers **icon assets only** (`NOTICES.md:1-3`); MIT code dependencies —
  CodeMirror, Vue, zod, flatbuffers — are not listed, so an MIT formatter adds no entry. No change.
- **Moving the dependency between `package.json` buckets.** P1's D1
  (`docs/v1.1/plans/P1-cutover-closeout-dependency-audit.md:638`) settled that the
  `dependencies`/`devDependencies` split has no effect post-Electron and that nothing moves. Every
  renderer library — all twelve CodeMirror packages, `vue`, `@tanstack/vue-virtual` — sits in
  `devDependencies`; the new one joins them there.
- **A migration or a settings row.** Nothing is persisted. Format is a text edit on the tab's existing
  `state.text`, which `patchConsoleTabState` already saves through the ordinary tab-state path.
- **Multi-window.** Formatting mutates one tab's text in the window that owns it; tabs are per-window
  (`docs/ARCHITECTURE.md:789-790`) and there is nothing to broadcast.

---

## 4. Decisions

**D1 — Format ships on six of the seven consoles: the five SQL dialects and MongoDB.** Redis is
excluded (D6); Kafka/SQS/S3 have no console to put it on (F1). The SPEC row's "for all languages"
intent is honoured as *every console where formatting is a real operation*, and this plan states the
two exclusions plainly rather than shipping a button that rearranges whitespace to look busy.

**D2 — `sql-formatter` is loaded through a lazily-imported local entry module, never a static
import.** Two files:

- `views/console/sqlFormatterEntry.ts` — nothing but
  `export { formatDialect, postgresql, mysql, mariadb, sqlite, clickhouse } from 'sql-formatter';`
  A static re-export Rollup tree-shakes normally, so the emitted chunk carries the five dialects and
  not the other sixteen (F3).
- `views/console/format.ts` — `await import('./sqlFormatterEntry')` inside the format function, with
  the resolved module memoised in a module-scope variable so the second press pays nothing.

Doing the `await import('sql-formatter')` inline instead would leave tree-shaking to Rollup's
analysis of a dynamic namespace, which is the difference between F3's 38 KB row and its 75 KB row —
a determinism worth one three-line file, and the reason that file needs the one comment D-rule §0.4
allows.

**D3 — The dialect map is keyed on `ConnectionKind`, not on the app's `SqlDialect` union.**
`sqlDialectFor` collapses MariaDB and MySQL into `'mysql'` for good reasons of its own
(`sqlIdent.ts:6-15`: a quoting-and-grammar *family*), but `sql-formatter` ships `mariadb` and `mysql`
as separate dialects, and `ConsoleView.vue:54-56` already has `connectionKind` in hand. So
`format.ts` exports `formatterDialectFor(kind: ConnectionKind)` returning the library's own dialect
object, and the union is left exactly as it is — widening `SqlDialect` to five members to serve one
consumer would break the three behaviours it correctly drives today (§1.1).

**D4 — One fixed configuration, and `keywordCase` stays at the library default `'preserve'`.**
`{ tabWidth: 2, useTabs: false, keywordCase: 'preserve', identifierCase: 'preserve',
linesBetweenQueries: 1 }`. Two spaces matches every other emitter in this repo (`beautify.ts:183`,
`ejson.ts:305`). `preserve` is chosen over the app's uppercase completion house style because of F6:
uppercasing rewrites an unquoted ClickHouse identifier that collides with a keyword, and ClickHouse
identifiers are case-sensitive — a formatter that can change what a query *means* is not one this app
should ship by default. This is the second of the three comments §0.4 budgets. If the uppercase house
style is later wanted, the narrow correct form is `keywordCase: 'upper'` for the four
case-insensitive dialects and `'preserve'` for ClickHouse — recorded here so the trade is visible,
not built now.

**D5 — Mongo formatting is composed from what the tree already has, and the three shared helpers move
into one module.** New `views/console/mongoStatement.ts` holds `MONGO_STATEMENT_RE`,
`findMatchingParen` and `splitTopLevelArgs`, moved verbatim out of `lint.ts` (F7); `lint.ts` imports
them, and so does `format.ts`. The formatter walks each `;`-separated statement:

1. `MONGO_STATEMENT_RE` must match, and the method must be in `MONGO_CONSOLE_METHODS`
   (`packages/shared/domain/console.ts:15-27`) — otherwise fail with the same wording the linter
   already uses, so a diagnostic and a format refusal never contradict each other.
2. Each top-level argument goes through `beautifyShellText(arg, 'indented')`. A failure fails the
   whole format.
3. Emit: **one argument** → `db.<coll>.<method>(<beautified>)` with the beautified text's own lines
   at their natural indent, which is exactly how `mongosh` renders an `aggregate([...])` pipeline;
   **two or more** → one argument per line at indent 2, each argument's continuation lines shifted by
   the same two spaces.

Statements are rejoined with `;\n\n`, matching `sql-formatter`'s own `linesBetweenQueries: 1`.

**D6 — The Redis console gets no Format button, and the button is hidden rather than disabled there.**
A Redis statement is a flat token list; there is no nesting to indent, no clause to break on, and no
maintained Redis-command formatter on npm to depend on. The only operations available are collapsing
whitespace runs and putting one command per line — the second of which the console's own linter
already *warns* about rather than performs (`lint.ts:235-249`: *"statements are separated by ; not
newlines"*), because silently rewriting a user's line breaks is a change of meaning on this surface,
not a formatting. Hidden, not disabled: a permanently-grey button in the rail is exactly what
`ConsoleView.vue:276-282` already argues against for Refresh, and `activeResultIsDocument`
(`:174-176`, `:420-433`) is the in-file precedent for `v-if`-ing a toolbar control that only applies
to some consoles. *The narrow alternative, if it is ever wanted:* a ~20-line no-dependency normaliser
that collapses inter-token whitespace outside quotes and puts one `;`-separated command per line.
It is not built, because it is a whitespace pass wearing a formatter's name.

**D7 — The command id is `view.format`, bound to `Alt+Shift+F`.** VS Code's own Format Document chord,
so it is the one a user already has in their fingers; ⌥⇧F on macOS. It collides with nothing —
`packages/shared/domain/shortcuts.ts:24-38` has no other `alt` global binding, and the two `alt`
locals (`tree.copyUri`) are `global: false` keydown handlers on the tree. F10 proves Wails parses it
and that the existing menu test guards it.

**D8 — The formatted text is written through `setText`, and the caret going to offset 0 is accepted.**
Any other route means changing `CodeMirrorHost.vue:213-228`'s external-write dispatch, which is shared
with the cell editor, the definition viewer, the document editor and the op-log rows. The cell
editor's Beautify has moved the caret to the start since P24 by that same path, so P13 is matching
shipped behaviour rather than introducing a wart. The one visible consequence — *Run statement* after
a format targets the first statement, because `cursorPos` resets with it — is real and is handed
forward as OQ-2.

**D9 — A format failure renders a `MessageStrip` in the console's own `#strips` slot, driven by a
component-local `ref`, and never touches `rt.status`.** F11: the console runtime has no `actionError`
field and `rt.status === 'error'` means *the run failed*. A `const formatError = ref<string | null>`
in `ConsoleView.vue`, cleared on the next successful format and on every `onDocChange`, is the whole
mechanism — one ref, one strip, no runtime-shape change and no fifth store field for four other views
to ignore. The message is `BeautifyResult.reason`, and for the SQL path that reason is **the first
line of the library's error only** (F5): the full nearley dump is never shown.

**D10 — One unit test, for the Mongo formatter only.** `AGENTS.md`'s bar: a per-kind dialect lookup
and a library call are plumbing; a composed statement parser + argument splitter + emitter with
nested-constructor, empty-argument-list and trailing-comma boundaries is the "parser or splitter with
several interacting lexical rules" the bar names explicitly. `tests/unit/` is where
`ejson.ts`'s own parser tests already live. The SQL path is covered by the `tests/ui/` spec alone.

---

## 5. Implementation order

Six commits. C1 is deliberately first and separately revertible: it is a pure move with no behaviour
change, and it is what lets C3 exist without duplicating anything.

### C1 — `refactor(console): the Mongo statement helpers move out of the linter`

- New `frontend/src/views/console/mongoStatement.ts`: `MONGO_STATEMENT_RE` (`lint.ts:16`),
  `findMatchingParen` (`:81-101`) and `splitTopLevelArgs` (`:104-137`) moved **verbatim**, exported,
  with their existing comments carried across intact (the P42 D12 note on `findMatchingParen`'s
  well-nested precondition is load-bearing and must not be dropped).
- `lint.ts` imports the three and loses its own copies. Nothing else changes; no behaviour moves.

### C2 — `chore(deps): sql-formatter, in its own lazily-loaded chunk`

- Root `package.json` `devDependencies`: `"sql-formatter": "15.8.2"` (exact, like every other entry).
  Not `dependencies` — §3, P1 D1.
- New `frontend/src/views/console/sqlFormatterEntry.ts`: the six-name re-export and nothing else,
  with the one comment saying why it is not an inline `await import('sql-formatter')` (D2).
- **Measure the emitted chunk before moving on.** `bun run build`, then confirm `dist/assets/` now
  contains a second `.js` chunk and that it is **~142 KB raw / ~38 KB gzip**, not ~294 KB (F3, F8).
  A number near 294 KB means the tree-shake failed and the entry module is wrong. Record the actual
  figure in the commit body.

### C3 — `feat(console): format the current query text`

- New `frontend/src/views/console/format.ts`:
  - `canFormatConsole(kind: ConnectionKind | undefined): boolean` — true for the five SQL kinds and
    `mongodb`, false otherwise (D1/D6).
  - `formatConsoleText(kind, text): Promise<BeautifyResult>` — reusing `beautify.ts`'s existing
    result type (§0.4). Whitespace-only input returns `{ text, ok: true }` unchanged.
  - The SQL branch: memoised `await import('./sqlFormatterEntry')`, `formatterDialectFor(kind)` (D3),
    `formatDialect(text, { dialect, ...OPTIONS })` inside a `try` that maps a thrown error to
    `{ ok: false, reason: firstLine(err.message) }` (F5, D9).
  - The Mongo branch: synchronous, D5's walk over `mongoStatement.ts` + `beautifyShellText`.
- `ConsoleView.vue`:
  - `const canFormat = computed(() => canFormatConsole(connectionKind.value))`,
    `const formatError = ref<string | null>(null)`, and an `async function onFormat()` that calls
    `formatConsoleText`, then either `setText(props.tab.id, result.text)` and clears `formatError`, or
    sets `formatError.value = result.reason ?? 'could not format this query'` and writes nothing.
  - Clear `formatError` in `onDocChange` (`:110-113`), so a strip never outlives the text that caused
    it.
  - The button, in `#toolbar` immediately after **Run all** (`:302`) and before the existing separator
    at `:303`, so the two start verbs and the editor action read as one group:
    `<AppButton v-if="canFormat" icon="indent" data-testid="console-format" :disabled="!localDoc.trim()" v-tooltip="'Format the query text'" @click="onFormat">Format</AppButton>`.
    `indent` is a real codicon (**[verified here]** in `@vscode/codicons`' own CSS) and is used nowhere
    else in the renderer.
  - A second `MessageStrip` in `#strips` (`:349-353`), `v-if="formatError"`, `tone="err"`,
    `data-testid="console-format-error"`.
  - `registerCommand('view.format', onFormat)` in the `onMounted` array (`:189-195`).

### C4 — `feat(shortcuts): Format is a menu command and a palette entry`

The same seven-file path `view.run-all` takes, plus the tests' channel mirror:

- `packages/shared/protocol/events.ts` — `viewFormat: 'kira:menu:view-format'`.
- `packages/shared/domain/shortcuts.ts` — `'view.format': { chord: { key: 'F', shift: true, alt: true }, global: true }`.
- `internal/bridge/events.go` — `ChannelViewFormat = "kira:menu:view-format"` (beside `:24`).
- `internal/shell/accel.go` — `"view.format": {Key: "F", Shift: true, Alt: true}` (beside `:48`).
- `internal/shell/menutemplate.go` — a **Format** `ItemEmit` after **Run All** (`:81`).
- `frontend/src/bridge/control.ts` — `onViewFormat` (beside `:123`).
- `frontend/src/App.vue` — `control.onViewFormat(() => runCommand('view.format'))` (beside `:45`).
- `frontend/src/shortcuts/state.ts` — `{ id: 'view.format', label: 'Format query', run: () => runCommand('view.format') }` (beside `:26`).
**Not touched:** `apps/kira-studio/tests/ui/support/ipcChannels.ts`. Its `IPC` table looks like a
mirror of `events.ts` but its own header (`:1-8`) says what it actually is — the *legacy* channel-name
namespace this tier mocks against, kept for continuity with `tests/ipc/`'s committed fixtures, with
nothing under `frontend/src` importing it. Its `kira:menu:*` rows (`:19-29`) have **zero** consumers in
any spec (**[verified here]**, `grep -rn "IPC.viewFind\|IPC.tabNext\|IPC.viewRefresh"` over
`apps/kira-studio/tests/` returns nothing). Adding a row nothing reads, to a table explicitly labelled
as no longer describing the live protocol, would be padding.

No test is added here: `menu_wails_test.go`'s `TestBuildMenuAcceleratorsAllParse` already covers the
new accelerator by construction (F10).

### C5 — `test(unit): the Mongo console formatter`

`apps/kira-studio/tests/unit/console-format.spec.ts`. D10's single earned test, over
`formatConsoleText('mongodb', …)` only — no dynamic import, no library, no DOM. Cases:
`db.c.find({a:1})`; an `aggregate([{$match:{…}},{$group:{…}}])` pipeline (the case the feature exists
for); two arguments (`updateOne({…},{$set:{…}})`); no arguments (`db.c.countDocuments()`); a nested
constructor argument (`{_id: ObjectId("…")}`) proving the call is carried whole and never re-parsed; a
trailing comma; two `;`-separated statements; an unsupported method and an unbalanced brace, each
returning `ok: false` with the linter's own wording. A one-line comment above the file states which
rule it guards, per `AGENTS.md`.

### C6 — `test(ui): the console Format button`

The spec described in §6.1. New file, `apps/kira-studio/tests/ui/console-format.spec.ts`.

**`docs/ARCHITECTURE.md`:** one edit is genuinely owed and it is not about the button. The Stack
table's *Renderer build* row (`:28`) states the bundle shape, and P5's F3 recorded "one chunk, no code
splitting" as a property of this app. C2 makes that false. Add one clause to that row naming the
formatter chunk as the app's only dynamically-imported chunk and why. Everything else — the toolbar,
the command, the dialect map — is per-feature detail that belongs in this plan, not in the
architecture reference.

---

## 6. Verification

### 6.1 The `tests/ui/` spec

`tests/ui/` drives the real built bundle in real WebKit with both wire planes mocked, which is the
right tier: a Format press is pure renderer work with no data-plane op at all, so nothing needs a
container or a real backend. The pattern to follow is `tests/ui/console.spec.ts:132-260` (open a
console from the tree menu, `typeInto(view, page, text)` at `:84-87`, click a
`[data-testid="console-*"]` toolbar button) and `tests/ui/autocomplete.spec.ts:492`/`:554`/`:593` for
the Mongo and Redis console tests, whose fixtures already exist (`support/mongoFixture.ts`,
`support/redisFixture.ts`) and already open a console from the connection root.

No new fixture capture is needed — **no scenario runs a statement**, so no `execute` port snapshot is
required at all; the boot/connect control snapshots those helpers already export are the whole setup.
This matters: `AGENTS.md` records that there is no one-off capture tool in the tree right now, so a
phase that needed a fresh capture would be blocked.

Four scenarios:

1. **Postgres (SQL) — the button formats, in place.** Open a console on the existing
   `orderItemsFixture` connection, type `select a,b from t where a=1 and b in (select x from y)`,
   click `[data-testid="console-format"]`, and assert `.cm-content` now contains `SELECT` on its own
   line with `a,`/`b` indented — asserted on the text content, not on an exact byte-for-byte string,
   so a patch release of the library that changes one space does not fail the suite.
2. **Postgres — unparseable text fails visibly and changes nothing.** Type `select from where (((`,
   press Format, assert `[data-testid="console-format-error"]` is visible, that its text is a single
   short line (`expect(text.split('\n')).toHaveLength(1)` — the F5 guard against pasting the nearley
   dump into the UI), and that `.cm-content` still holds the original text. Then type one more
   character and assert the strip disappears (D9's clear-on-edit rule).
3. **Mongo — the pipeline case.** Using `mongoConnectionSummary`/`mongoConnectAndExpandControl`, open
   a console, type `db.widgets.aggregate([{$match:{a:1}},{$group:{_id:"$a"}}])`, press Format, and
   assert the result contains `$match` and `$group` on separate, indented lines and still starts with
   `db.widgets.aggregate(`.
4. **Redis — no button at all.** Using `redisConnectionSummary`/`redisConnectControl`, open a console
   and assert `[data-testid="console-format"]` has count 0 while `[data-testid="console-run-statement"]`
   is visible — i.e. the toolbar mounted and the button is deliberately absent, not the whole view
   missing. This is D6's guard, and it is the assertion most likely to be quietly deleted later by
   someone who thinks it is an oversight, so its comment must say why it exists.

**Not covered by any tier, and stated rather than papered over:** the ⌥⇧F accelerator and the View ▸
Format menu item. Global shortcuts reach the renderer only through the native menu
(`menu.go:55` → `Events.Signal` → `App.vue`), there is no native menu in `tests/ui`, and **[verified in
source]** no existing spec drives any `kira:menu:*` channel — `tests/ui/support/ipcChannels.ts:19-29`'s
menu rows have no consumer. `console.spec.ts:17-25` already records the identical gap for undo/redo's
menu path. The Go side is covered instead: `TestBuildMenuAcceleratorsAllParse` proves the chord parses
and the item is built (F10).

### 6.2 Measurements to take, and record

Two, both cheap, both required by the discipline this phase inherits rather than optional colour:

1. **The emitted chunk** (C2's own step): raw and gzip bytes of the new `dist/assets/*.js`, against
   F3's 142 314 / 38 036 expectation, plus a confirmation that `index-*.js` did **not** grow.
2. **Warm format latency on the WebKit tier**, since F4's numbers are V8's. Inside scenario 1, wrap
   the Format click in `performance.now()` either side of the `.cm-content` assertion and log it (do
   **not** assert a threshold — `docs/PERF.md:143-165` is explicit that this tier's timings carry a
   scheduling artifact and that new hard budgets on it are earned, not assumed). If the warm figure is
   within an order of magnitude of F4's 4-25 ms, the ~150 ms invariant is comfortably met and the
   synchronous implementation stands; if it is not, OQ-4's worker escape hatch becomes real work
   rather than a hypothetical.

Add a short subsection to `docs/PERF.md` §2 only if figure 1 lands materially away from F3 — otherwise
this plan is the record, per `AGENTS.md`'s "a discovery from finishing one phase belongs in that
phase's own plan doc."

### 6.3 The one thing a human must run on a real Mac

**Confirm the lazy chunk loads in the packaged desktop build.** F9 proves the chunk is served by the
Go asset handler and by `tests/ui`'s static server, but neither exercises the custom `wails://` URI
scheme the shipped app actually uses, and no tier in this repo can (`AGENTS.md`, Wails section). The
check is thirty seconds: open a console in a `bun run dev` or packaged build, press Format once, and
confirm the text reformats rather than nothing happening. A failure here would be a
`import()`-resolution problem under the custom scheme, and the fallback is a static import at F3's
+11.4 % gzip — worth knowing before shipping, not after.

### 6.4 Running the rest here

```
bun run lint && bun run typecheck && bun run build
bun run test:unit
bun run test:ui
go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...
```

`typecheck:web` is the check that `sql-formatter`'s types resolve under `moduleResolution: "Bundler"`
(`frontend/tsconfig.json:5`) — the package has no `types` condition in its `exports` map, only sibling
`.d.ts` files next to the ESM entry (**[verified here]**, `dist/esm/index.d.ts` exists), so this is
worth watching on the first build rather than assuming. **[verified here]** this container has no
Playwright browsers cached, so `bunx playwright install webkit` plus the system libraries its
post-install warning names must run before the first `test:ui` — the procedure
`apps/kira-studio/playwright.config.ts:12-16` already documents. No Docker, no container, no `xvfb`.

### 6.5 What must not regress

- `tests/ui/console.spec.ts` (three tests), `autocomplete.spec.ts`'s console cases, and
  `cell-editor.spec.ts:1187-1195`'s console path all pass unchanged. C1 is a pure move and C3 adds a
  sibling button; a failure in any of these means something moved that should not have.
- `bun test tests/unit`'s existing `ejson`/`beautify` specs pass unchanged — `beautifyShellText` gains
  a caller, not an edit.
- `dist/assets/index-*.js` does not grow. If it did, the dynamic import collapsed back into the main
  chunk and D2's whole justification is gone.
- The console's completion-popup budget (`budgets.spec.ts`, ≤ 50 ms p50, `docs/PERF.md:30`) is
  untouched: nothing in this phase runs on the keystroke path, and the formatter module is not even
  fetched until the first Format press.

---

## 7. Acceptance checklist

1. A **Format** button appears in the console toolbar for postgres, mariadb, mysql, sqlite, clickhouse
   and mongodb consoles, and is **absent** on a redis console.
2. Pressing it reformats the whole console document in place, through a real formatter: `sql-formatter`
   for the five SQL kinds (each mapped to its own dialect, MariaDB and MySQL distinctly), and the
   in-repo shell-literal formatter for Mongo.
3. An unparseable document leaves the text untouched and shows a **single-line** reason in a message
   strip that clears on the next edit; the library's raw parse dump never reaches the UI.
4. `sql-formatter` is in the root `devDependencies` at an exact version, is reached only through
   `sqlFormatterEntry.ts`, and `format` (the all-dialects entry) is referenced nowhere.
5. `bun run build` emits a second JS chunk of roughly 142 KB raw / 38 KB gzip, and `index-*.js` is no
   larger than it was before the phase. Both figures are recorded in C2's commit body.
6. `MONGO_STATEMENT_RE`, `findMatchingParen` and `splitTopLevelArgs` exist in exactly one file, which
   both `lint.ts` and `format.ts` import.
7. `view.format` exists in `SHORTCUTS`, `accel.go`, the View menu, `events.ts`, `events.go`,
   `control.ts`, `App.vue` and the command palette; `TestBuildMenuAcceleratorsAllParse` passes,
   proving `Alt+Shift+F` parsed rather than being silently dropped.
8. `tests/unit/console-format.spec.ts` covers D10's cases; `tests/ui/console-format.spec.ts` covers
   §6.1's four scenarios; every other spec in every tier passes unchanged.
9. `docs/ARCHITECTURE.md`'s Renderer-build row names the formatter chunk as the app's one
   dynamically-imported chunk.
10. `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
    `go build`/`go test ./apps/kira-studio/internal/...` all clean.

---

## 8. Open questions, handed forward

- **OQ-1 — Format Selection.** VS Code's second verb, and the natural companion to *Run statement*:
  format only the statement under the cursor. `statementAtCursor` (`sql-split.ts`) already returns
  that statement's exact offsets, so it is a small additive change — but it needs a second toolbar
  affordance or a modifier-click, which is a UI decision nobody has asked for yet.
- **OQ-2 — The caret jumps to offset 0 on every format** (D8), which also resets what *Run statement*
  targets. Fixing it properly means teaching `CodeMirrorHost`'s external-write path to preserve a
  selection, which changes behaviour for the cell editor, the document editor and the definition
  viewer too. Worth doing once, deliberately, for all five surfaces — not as a side effect of this
  phase. **For P17/P18:** P18's language server will want the same thing.
- **OQ-3 — Formatter options as settings.** Indent width, keyword case and a max line width are the
  three knobs users of other clients expect. D4 ships one fixed configuration; if these become
  settings, the honest shape is per-dialect for `keywordCase` specifically (F6), not one app-wide
  value. **For P17**, which rewrites the settings dialog's commit model anyway.
- **OQ-4 — A very large document formats synchronously.** F4 measures 251 ms for a 28 KB script and
  1.16 s for 141 KB, against `docs/ARCHITECTURE.md:70`'s ~150 ms progress rule. Nothing in this phase
  handles that: there is no progress indicator and no stop button on a Format press. If §6.2's WebKit
  measurement or a real user shows it biting, the escape hatch is a Web Worker (the formatter is a
  pure text→text function with no DOM dependency, so it moves cleanly) — recorded here so the next
  session does not rediscover the ceiling from scratch.
- **OQ-5 — For P18.** P18 builds a SQL language server over these same five dialects from
  user-supplied DDL. If it brings its own SQL parser into the renderer, that parser and
  `sql-formatter`'s are two grammars for the same five dialects in one bundle. P18 should check
  whether its parser can also produce the formatted text before adding a second one — the answer may
  retire this phase's dependency entirely, and the decision is much cheaper made then than unwound
  later.
