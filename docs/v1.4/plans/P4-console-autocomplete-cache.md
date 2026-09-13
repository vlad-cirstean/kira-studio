# P4 — SQL editor autocomplete: close the root-console cache-key gap

> **What this phase is.** `docs/v1.4/SPEC.md`'s P4 row, turned into concrete steps from one Opus
> research pass (full report kept out of this file per `docs/v1.4/plans/`'s discipline). **Session
> override, this chapter only** (same as P1/P3): plan and implementation both done by the
> orchestrating session directly, not a Sonnet implementer subagent.

## 0. The bug, precisely, and what's in/out of scope

A console opened at a connection's **root** (`path === ''` — the ordinary "right-click a connection
→ Open query console" action, `project/menus.ts`'s `connectionMenu`, and `OperationsPanel.vue`'s
re-run action) gets none of the schema-aware completion every other console gets. Root cause:
`containerPathFor`/`consoleRelationNames` (`state/schemaColumns.ts`, `views/console/completion.ts`)
both walk a path back to its last `database:`/`schema:` segment — an empty path has no segments to
walk, so both return `null`/`[]` immediately, before ever consulting anything else. Everything
downstream (the cache-fill watch, `cachedRelationsFor`, `effectiveSchema`, lint, hover) keys off
that one `containerPath`, so one fixed function fixes all of them.

**This is not a scope-less case at runtime.** Research confirmed every SQL adapter's `Execute`
resolves a root path to the connection's own configured database (`postgres/client.go`,
`mysqlfamily`/`sqlite`/`clickhouse` adapters all do the equivalent) — a root console already runs
against one real database, on the default search path. The fix is to make the renderer resolve the
same container the backend already runs against, from data already in the tree cache — **no new IPC
call, no Go change, no connection-level cache tier** (ruled out: every SQL adapter's `SchemaColumns`
hard-rejects a non-container path with `CodeNotFound`, and a connection-wide cache would mean one
round trip per database × schema, well past the 200-row-per-connection `metadata_cache` budget the
existing per-container design was built to protect).

**In scope**: the root-container resolver, the relation-names union fallback, adding
`relationCompletionSource` to the cached-columns branch, routing console completions through the
same identifier-quoting rule the grid already uses, a small shared `ColumnMeta → completion`
projection helper, flipping `SchemaDialog.vue`'s `:autocomplete` on, and one negative-result
memoization fix in `ensureSchemaColumns`.

**Explicitly not attempted** (§9): a connection-level cache tier; a bespoke DDL-aware completion
source for `SchemaDialog.vue` (tables/columns declared earlier in the same buffer); merging the
console's and the data-grid's completion *builders* into one function — research's own conclusion,
confirmed here: they're keyed at different granularities (container-wide vs. single-relation),
typed differently (CodeMirror `Completion` vs. `theme/primitives/completion`'s), and
`biome.json`'s `views/<kind>/*` isolation rule forbids them sharing code directly regardless.

## 1. `containerPathFor` gains a root branch

`state/schemaColumns.ts`'s `containerPathFor(connectionId, path)` returns `null` today whenever the
path-walk finds no `database:`/`schema:` segment — true for every path, not just the root, but the
root is the one common case research confirmed actually has a resolvable answer. Add a **separate**
`rootContainerPathFor(connectionId)` that resolves from `treeState.children[rowKey(connectionId,
'')]` (the root's already-loaded child list — empty if the connection row was never expanded, which
is fine, see below) in this order, each step free (no I/O, already-cached data):

1. The root child whose `detail === 'connected'` — correct for postgres and mysqlfamily, which both
   stamp this on the database node matching the live connection.
2. Else the root child whose `name` matches `connectionRecord(connectionId)?.database` — covers
   ClickHouse (no `connected` marker).
3. Else, if the root has exactly one `database:` child, that one — covers SQLite, where `database`
   is an absolute file path and the tree node is named `main`.
4. For **postgres only**, append a schema to whatever step 1-3 resolved: `schema:public` if it's
   among that database's already-loaded children, else the sole non-system schema if there's
   exactly one, else stop (no schema segment — `effectiveSchema`/lint/hover degrade to
   `EMPTY_DDL_SCHEMA`, same as today).
5. Nothing resolves (root never expanded, ambiguous multi-schema/multi-database with no
   `connected` marker) → `null`, same as today. Honest degradation, not a new failure mode.

`containerPathFor` itself calls this only when the ordinary walk finds nothing **and** `path ===
''`, so every non-root call site (relation rows, container rows) is byte-for-byte unchanged.
Reactive for free: `containerPath` in `ConsoleView.vue` is already a `computed`, so a console opened
before the connection is expanded re-resolves and self-warms the moment the user expands it — the
existing single-flight guard in `ensureSchemaColumns` makes repeated re-tries safe.

## 2. `consoleRelationNames` gets its own root branch — a superset, not the resolved container alone

`consoleRelationNames` (`views/console/completion.ts`) is `containerPathFor`'s intentional twin and
fails the same way for the same reason. Its root branch is **not** "relations under the one resolved
container" — it's the union of relation names (`table`/`view`/`matview` node kinds) across **every**
already-loaded container for this connection: scan `treeState.children` keys by the
`'<connectionId>|'` prefix. This is the layer that survives even when §1 can't resolve a single
container (ambiguous root) — a user who expanded `database:x/schema:app` in the tree before opening
a root console gets those relation names offered, which the tree already had and today's code
discards purely because of the path-walk shortcut. Pure tree-cache read, no round trip, strict
superset of current behavior everywhere else.

## 3. Add `relationCompletionSource` to the cached-columns branch

`sqlLanguageService.ts`'s three-branch `sqlCompletionSources` has `relationCompletionSource` in the
DDL-document branch but not the cached-columns branch, for no stated reason research could find. Add
it — one line, `relations` is already threaded into that function's signature. This is what actually
surfaces §2's relation names after a `FROM`/`JOIN` keyword for a root console with no resolvable
single container.

## 4. Route console completions through the same identifier-quoting rule the grid already uses

Real, small, shippable convergence research identified: `views/grid/filterCompletion.ts` quotes an
accepted column identifier dialect-correctly (`views/shared/sqlIdent.ts`'s `identNeedsQuoting`/
`quoteIdent`) on accept; the console's cached-columns and relation-name completions emit bare labels
and rely on lang-sql's own `identifierQuotes` handling, which does not quote on accept. A column
named `order` or `Total` completes bare in the console today and produces invalid SQL. Wire
`ddl.ts`'s `namespaceFromCached` and `relationCompletionSource`'s own label construction through
`sqlIdent.ts` the same way the grid does — same helper, two call sites, no new logic invented.

## 5. Shared `ColumnMeta → completion` projection helper

Both `ddl.ts` (`toSqlNamespace`/`namespaceFromCached`) and `filterCompletion.ts`
(`columnCompletions`) independently do `{name, dataType} → {label, detail}` with a PK boost. Extract
a small `views/shared/` helper returning a neutral `{label, detail, boost}` tuple; each side adapts
it to its own `Completion` type (CodeMirror's vs. `theme/primitives/completion`'s — genuinely
different types, not worth unifying, per §0's "not a shared builder" call). ~15 lines, closes one
concrete drift class (the two sides' PK-boost/detail-field logic silently diverging over time)
without pretending the two completion systems are more alike than they are.

## 6. `SchemaDialog.vue`: flip `:autocomplete` on

`project/SchemaDialog.vue`'s DDL-document editor mounts `CodeMirrorHost` with `language="sql"` and
`:sql-dialect="dialect"` already set, but `:autocomplete="false"`. Flipping it to `true` costs
nothing else — with no `completionSources` prop, `CodeMirrorHost` falls through to lang-sql's own
`keywordCompletionSource`/type-name completion, dialect-correct for free, useful in a surface where
a user hand-types `VARCHAR`, `NUMERIC(10,2)`, `REFERENCES`, `NOT NULL`. A bespoke DDL-aware source
(complete a table/column declared earlier in the same pasted document) is real but separately-scoped
work — needs a new dispatch export in `state/schemas.ts` to cross `project/` → `views/` (`biome.json`
forbids `project/` importing `views/` directly, which is why `SchemaDialog.vue` today only reaches
the SQL surface through `schemaDialectFor`/`ddlParseSummary`) — and is explicitly deferred, §9.

## 7. Small fix while in this code: memoize a negative `ensureSchemaColumns` result

`ensureSchemaColumns`'s catch block (`state/schemaColumns.ts`) is empty — a container the adapter
rejects (or any other failure) is never marked as tried, so it re-fires the same doomed fetch on
every tab activation/reconnect. Store a sentinel (e.g. an empty array, matching the "no columns"
shape the rest of the code already treats as absent) on failure so a genuinely-unsupported container
is asked about once, not forever. Small, self-contained, touches only this function's error path.

## 8. Doc correction

`docs/ARCHITECTURE.md`'s console-language-service section still says the language service is
"DDL-driven, never introspective… with no DDL document, a SQL console stays byte-for-byte what it
was before this phase" — already false as of P22c (the cached-columns branch), and more so after
this phase's root-console fix. Correct it in the same pass; `ARCHITECTURE.md` is authoritative for
current behavior per `docs/v1.4/README.md`'s own rule, so a stale claim there is a real defect, not
housekeeping.

## 9. Explicitly out of scope

- **A connection-level schema-columns cache tier.** Every SQL adapter's `SchemaColumns` rejects a
  non-container path outright; building one means a Go/adapter change this phase doesn't need, for a
  case (§1) that's fully solvable from data the renderer already has cached.
- **A DDL-aware completion source for `SchemaDialog.vue`** (self-referential: tables/columns
  declared earlier in the same document, after `REFERENCES`). Real value, meaningfully more work (a
  new `state/schemas.ts` dispatch export, a per-rebuild `parseDdl` re-run whose cost is already
  measured around 58ms on a large document) for a dialog most users open rarely. §6's one-line flip
  captures most of the value at near-zero cost; this is a candidate for its own later phase.
- **Merging the console's and the data-grid's completion builders.** Not a hedge — resolved: they
  don't converge as functions (different key granularity, different output type, `biome.json`'s
  `views/<kind>/*` isolation forbids direct sharing regardless). §4/§5 are the real, narrow overlap;
  nothing more is being left on the table.
- **Feeding the data view's filter completion from `schemaColumnsState`** instead of its own
  `treeDescribe` call. `loadMeta` also supplies `primaryKey`/`foreignKeys`/`indexes`/`rowEstimate`,
  which the container-cache's `RelationColumns` deliberately omits (`packages/shared/domain/tree.ts`)
  — the `describe` call can't be eliminated, so sharing would only be the completion-feeding half,
  for no round-trip saving. Not worth the coupling.

## 10. Testing

1. **New unit tests** (cheap, per P1's own "the Bun tier is not a speed problem" — put real coverage
   here, not only in the WebKit tier): `containerPathFor`/`rootContainerPathFor`'s resolution-order
   table (each of the 5 steps in §1, including the SQLite/ClickHouse/no-`connected`-marker cases) and
   `consoleRelationNames`'s root-union behavior, both pure functions over `treeState.children` + a
   path string — no UI harness needed. Today's test census (research) found **zero** existing
   coverage of either function; `tests/unit/autocomplete-tokenizers.spec.ts`'s name is misleading —
   it covers `theme/primitives/completion.ts`'s plain-field tokenizers only, nothing in
   `views/console/`.
2. **One new UI test** in `tests/ui/sql-schema.spec.ts`, modelled directly on its existing
   `'with no DDL document, table names and columns complete from the cache (D4/D5/D14)'` case:
   `openRowMenu(page, '')` → the connection row's own *Open query console* item (today's tests never
   exercise this open path — `openConsoleFromMenu(page, '')` works as-is once the fixture is right).
   Use a second `treeSchemaColumns` snapshot (not just the single-snapshot wildcard shortcut
   `mockRuntime.ts` provides) so the test asserts the *resolved* container path was actually
   requested, not merely that some cached answer came back — research flagged this as a real
   "passing but lying" risk otherwise.
3. **One negative UI case**: a root console opened on an **unexpanded** connection (no tree children
   loaded at all) gets keywords only — pins the honest-degradation boundary rather than leaving it
   implicit.
4. **Re-run `tests/ui/budgets.spec.ts`** — the completion source array now depends on a
   `treeState.children` key-scan at root; confirm the console keystroke → completion popup budget
   (`docs/PERF.md`'s ≤50ms p50, currently the tightest margin in the app) still holds. No I/O is
   added to the keystroke path itself (the scan happens at source-rebuild time via the existing
   `computed`, same as every other input to that computed), but the budget gets re-measured, not
   assumed.
5. **`SchemaDialog.vue` flip**: one assertion added to `tests/ui/sql-schema.spec.ts`'s existing
   Schema-dialog coverage — a keyword/type-name suggestion appears while typing in the DDL editor.

## 11. Verification

Fast checks per commit (`go build`/`vet` N/A this phase — frontend-only; `bun run typecheck`,
`bun run lint`), CLAUDE.md's default. `bun test` for the new pure-function unit coverage, `bun run
test:ui` for the new/updated Playwright cases plus the full existing `console`/`autocomplete`/
`sql-schema` suites (no regression in what already passes), and `budgets.spec.ts`'s own number
re-recorded against `docs/PERF.md` if it moves.
