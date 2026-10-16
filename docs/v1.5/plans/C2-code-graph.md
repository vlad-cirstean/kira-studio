# C2 — Code graph: go-to-definition, go-to-implementation, find references

> **What this phase is.** `docs/v1.5/SPEC.md`'s C2 row turned into steps, from research against the
> real C1 tree (`internal/codeparse`, `internal/codeindex`, the six vendored `tags.scm` files, the
> `0001_c1_init.sql` schema) plus direct probes of each grammar's own `node-types.json` in the module
> cache. Backend only: one new Go package, targeted changes to two existing ones, no renderer code,
> no bound service, no wire contract. Its consumers are C3 (MCP server) and C5 (Monaco).

## 0. What SPEC left open, and how each is resolved

**D1 — One new package, `internal/codegraph`, holding resolution only; every SQL statement stays in
`codeindex`.** `codeindex` owns the schema, so C2's new read queries land in `codeindex/read.go`
beside the existing ones, and `codegraph` imports `codeindex` and never `database/sql`. `Graph` is
constructed from a `*codeindex.Store` plus a `repo_id` — never from an `*Index` — so C3 (a separate
process with no `gitclient.Runner` and no watcher) opens the same cache and gets the same API. §4.

**D2 — The graph is computed live from `symbol`/`reference` rows. No edge table, ever.** §3 states
the reasoning and the one schema change C2 does make.

**D3 — Resolution is name plus scope-tier plus rank, never type inference.** Ordered tiers (same
file, same scope unit, repository-wide), one scope unit per language family, a kind-compatibility
demotion, and a deterministic rank inside the winning tier. Every result carries the rule that
produced it and a confidence value. §5, with the false positives and negatives named in §5.6.

**D4 — `implementationsOf` means "explicit `implements`/`impl`/base-class relationships", per
language, and returns nothing for Go.** Go's structural interfaces are declined on a hard data
ground, not a taste one: C1's Go query captures a `method_declaration`'s *name* only, never its
receiver, so a method set cannot be assembled from stored rows at all. §6.

**D5 — No import resolution.** No language's vendored query emits an `import` reference (Go's
`import_spec` pattern has no top-level capture, so it produces no row), and resolving a TypeScript
specifier needs `tsconfig` `paths`, node resolution, extension and index-file rules — a resolver, not
a graph pass. Consequence: cross-file results are ranked name matches, stated as such. §5.6, §9.

**D6 — The framework line: same-file only.** A Vue/Svelte SFC's `<script setup>` binding referenced
from the same file's template resolves, because both live in one file's rows. Nothing cross-component
resolves: no prop flow, no Angular DI or template wiring, no JSX element-to-component edge. §7 states
what makes each cutoff cheap or speculative.

**D7 — C2 fixes four C1 extraction gaps first.** C1 §9 handed forward "if a language's upstream query
proves thin, a later phase can add to it"; the thinness is load-bearing here, not cosmetic. §2.

**In scope**: the extraction fixes (§2), the one migration (§3), the query API (§4), the resolver
(§5), implementations (§6), the framework line (§7), invalidation (§8), tests (§11), docs (§12).

**Not attempted** (§9): import resolution, type inference, Go structural interface matching, call
hierarchy, rename, any cross-component framework inference, any bound service or renderer code.

## 1. What C1 actually stores, and what that forecloses

Read off the vendored queries and `extract.go`'s closed sets, not off C1's prose. This table is the
plan's backbone: every later decision follows from it.

| Language | Definition kinds produced | Reference kinds produced | Load-bearing gap |
|---|---|---|---|
| Go | `function`, `method`, `type` | `call`, `type` | No receiver on a method. No struct/interface distinction (both are `type`). Every `type_identifier` is a `type` reference, including a definition's own name |
| Java | `class`, `interface`, `method` | `call`, `implementation` | `call`'s stored range is the `argument_list`, not the call. `@reference.class` (`new X`, `extends X`) is dropped by `referenceKinds` |
| Python | `class`, `function`, `constant` | `call` | No type or base-class references at all |
| JavaScript | `class`, `function`, `method`, `constant` | `call` | `@reference.class` dropped, same as Java |
| TypeScript, TSX | `function` (signature only), `method` (signature/abstract), `class` (**abstract only**), `interface`, `module` | `type` (`type_annotation` only) | A plain `class X {}`, `function f() {}`, `const f = () => {}` or any call produces **no row**. `implements` produces no row |
| Rust | `class` (struct/enum/union/alias), `interface` (trait), `function`, `method`, `module`, `macro` | `call`, `implementation` | An `implementation` reference's stored range is the whole `impl_item`; its name is the trait (or, for an inherent impl, the type) — never both |
| HTML, CSS, JSON, Vue template, Svelte markup | none | none | No query is vendored; template regions contribute `file_block` rows only |

Two consequences worth stating before anything else. TypeScript is the repo's own primary language and
the base of every framework in scope, and today it indexes almost nothing. And a `reference` row
stores the *reference node's* range, never the identifier's — so "what is under the cursor" is
answerable only coarsely, and for Java and JavaScript member calls, wrongly (the stored range starts
after the method name).

## 2. Extraction gaps C2 closes first

Four changes in `codeparse`, all narrow, all verified against the grammars in the module cache.

**2.1 TypeScript and TSX compile `javascript/tags.scm` ahead of `typescript/tags.scm`.** Upstream
ships the TS file as an *addition* to the JS one (it carries only signature/abstract/interface
patterns and no `; inherits:` header, which editors supply themselves); using it alone is what makes
a `.ts` file index nothing. `querySourcePaths` becomes `map[ID][]string`, and the two sources are
concatenated before compiling. This vendors no new query text — it composes two files already in the
tree, so C1's "only upstream queries" rule holds.

Verified: every node kind javascript's tags.scm names (`class`, `class_declaration`,
`function_declaration`, `function_expression`, `generator_function`,
`generator_function_declaration`, `method_definition`, `lexical_declaration`, `variable_declaration`,
`variable_declarator`, `arrow_function`, `assignment_expression`, `member_expression`,
`new_expression`, `call_expression`, `pair`, `export_statement`, `number`, `string`, `undefined`,
`null`, `binary_expression`, `property_identifier`, `identifier`, `comment`) exists in both
`typescript/src/node-types.json` and `tsx/src/node-types.json` at v0.23.2. A missing kind would fail
the query compile loudly at first use, and S1's golden test asserts the result either way.

**2.2 `class` joins `referenceKinds`.** `@reference.class` is `new X(...)` in JavaScript, TypeScript
and Java, plus Java's `extends` superclass — dropped today by a four-value closed set. Adding one map
entry recovers them. `reference.kind` is `TEXT`; no schema change.

**2.3 One C2-authored query file per language for the `implements` relationship.** `implementationsOf`
is this phase's named deliverable, and for TypeScript, TSX, JavaScript and Python no vendored pattern
expresses it at all. Each language gets a `queries/<lang>/c2_implements.scm`, kept separate so the
vendored `tags.scm` stays byte-identical to upstream, reusing the existing `@reference.implementation`
capture so nothing in `extract.go` or the schema changes:

- TypeScript, TSX: `(implements_clause (type_identifier) @name) @reference.implementation`,
  `(implements_clause (generic_type name: (type_identifier) @name)) @reference.implementation`,
  `(extends_type_clause type: (type_identifier) @name) @reference.implementation`,
  `(extends_clause value: (identifier) @name) @reference.implementation`.
- JavaScript: `(class_heritage (identifier) @name) @reference.implementation`.
- Python: `(class_definition superclasses: (argument_list (identifier) @name)) @reference.implementation`.
- Java, Rust, Go: nothing added. Java and Rust already emit `implementation`; Go cannot (§6).

Every node and field name above was read out of the matching `node-types.json` at the pinned version.
This is a deliberate, narrow exception to C1 §9's "no hand-written queries", taken because the
alternative is an advertised operation that answers nothing for four of six languages.

**2.4 A `reference` row gains the identifier's own range.** `Reference` gains `NameStartByte`,
`NameEndByte`, `NameStartPoint`, filled from the `@name` node `extract.go` already holds. This is
what makes `definitionOf(file, position)` exact rather than a guess, and it is the one thing that
cannot be worked around above the parse: for Java `method_invocation` and JavaScript member calls the
stored reference range *excludes* the method name, so a cursor on the name matches nothing today.
Schema change in §3.

**2.5 The fingerprint learns about extraction.** `codeparse.Fingerprint` hashes grammar module
versions and query bytes only — so 2.2's change to `referenceKinds` would alter extraction while
leaving the fingerprint identical, and stale rows would survive. Add a
`const extractionVersion = 2` to `codeparse` and hash it, and make the query-file walk cover every
path in the widened `querySourcePaths` map. Bumping it is then the standing mechanism for any future
extraction change that is not a query or grammar change.

## 3. Storage: no edge table, one migration

**No persisted edges.** An edge table is worth its cost only when a query against it is meaningfully
cheaper than the live equivalent, and here the live equivalent is one lookup on an index C1 already
built: `symbol_name (repo_id, name)` and `reference_name (repo_id, name)`. Against C1's own real run
on this repository (7,737 symbols, 83,329 references), a `definitionOf` is one file-scoped read plus
one indexed name lookup, and a `referencesTo` is one indexed name lookup over a set two orders of
magnitude smaller than the table.

Invalidation is what settles it. A persisted edge is cross-file derived state: saving one file can
change which definition a reference in an *unrelated* file resolves to, because resolution falls back
repository-wide (§5.2). Keeping 83k edges correct under that would mean recomputing far more than the
changed file on every save, against a watcher whose `ChangedRanges` is best-effort and sometimes empty
(C1 §7.2). Rows stay the single source of truth; the graph is a function over them, evaluated per
query. §8.

**One migration, `0002_c2_reference_name_range.sql`**, for §2.4's four columns:

```sql
DELETE FROM file;            -- derived cache; the next Sync rebuilds it. Cascades to blocks,
                             -- symbols and references.
DROP TABLE reference;
CREATE TABLE reference (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  repo_id    TEXT    NOT NULL,
  block_id   INTEGER REFERENCES file_block(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,   -- 'call' | 'type' | 'implementation' | 'import' | 'class'
  name       TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  name_start_byte INTEGER NOT NULL,
  name_end_byte   INTEGER NOT NULL,
  name_start_row  INTEGER NOT NULL,
  name_start_column INTEGER NOT NULL
);
CREATE INDEX reference_file ON reference (file_id, start_byte);
CREATE INDEX reference_name ON reference (repo_id, name);
```

`DELETE FROM file` rather than `ALTER TABLE ... ADD COLUMN ... DEFAULT 0`: a defaulted column would
mean every pre-existing row claims an identifier at byte 0. §2.5's fingerprint bump would rebuild
those rows at the next `Sync` anyway, but a cache that is briefly *wrong* is worse than one that is
briefly *empty*, and this is derived data whose rebuild is exactly what `Sync` does.

**No new index.** Position lookups load one file's rows through the existing `(file_id, start_byte)`
index and pick in Go (§4.3) — a file carries tens of references at this repository's own ratio, and
loading them whole is also what C5 needs for decoration.

## 4. `internal/codegraph`

### 4.1 Construction

```go
func New(store *codeindex.Store, repoID string) *Graph
```

No root path, no `gitclient.Runner`, no file reads: every position in and out is derived from stored
rows. That is what lets C3 open the cache read-write (C1 §5.1's WAL `-shm` note) and answer without a
worktree present.

One companion in `codeindex`, for C3's benefit: `Sync` starts writing `meta.repo_root`, and
`Store.ListRepos(ctx)` returns each `(repo_id, root, last_used_at)`. Without it a second process
cannot map a path to a `repo_id` at all — `gitclient`'s identity function is not reachable from there.

### 4.2 Types

```go
type Point struct{ Row, Column int }          // byte column, C1's convention
type Span struct {
    StartByte, EndByte int
    Start, End         Point
}

type Confidence string
const (
    Exact    Confidence = "exact"     // one candidate, inside the reference's own file or scope unit
    Scoped   Confidence = "scoped"    // several candidates, all inside the scope unit
    RepoWide Confidence = "repoWide"  // no scoped candidate; a repository-wide name match
)

type Target struct {
    SymbolID   int64
    Path       string   // repository-relative, git's own bytes
    Language   string
    Kind, Name string
    Container  string   // parent chain, joined with "."
    Span       Span     // the whole definition
    NameSpan   Span     // the identifier: what a jump targets
    Rule       string   // which rule placed it, e.g. "sameFile.enclosing", "samePackage"
    Confidence Confidence
}

type Site struct {
    Path, Language string
    Kind, Name     string
    Span, NameSpan Span
    Enclosing      string   // innermost enclosing definition's name, "" at file top level
}

type Query struct {
    Path  string
    Byte  int     // -1 when unset
    Point *Point  // alternative to Byte
    Name  string  // required when neither is set; otherwise the caller's word-under-cursor hint (§7)
}
```

### 4.3 Operations

```go
func (g *Graph) DefinitionOf(ctx context.Context, q Query) ([]Target, error)
func (g *Graph) ImplementationsOf(ctx context.Context, q Query) ([]Target, error)
func (g *Graph) ReferencesTo(ctx context.Context, q Query, opt RefOpts) (Refs, error)
func (g *Graph) SymbolAt(ctx context.Context, q Query) (Target, bool, error)
func (g *Graph) Outline(ctx context.Context, path string) ([]Node, error)
func (g *Graph) SearchSymbols(ctx context.Context, s SymbolSearch) ([]Target, error)
func (g *Graph) SearchFiles(ctx context.Context, s FileSearch) ([]FileHit, error)

type RefOpts struct {
    Mode               RefMode // Resolved (default) | NameOnly
    Kinds              []string
    IncludeDefinition  bool
    Limit              int     // default 500, max 2000
}
type Refs struct {
    Sites     []Site
    Total     int
    Truncated bool
}
type SymbolSearch struct {
    Text      string   // prefix match by default; Substring widens it
    Substring bool
    Kinds     []string
    Languages []string
    Limit     int      // default 50, max 200
}
```

`SymbolAt`, `Outline`, `SearchSymbols` and `SearchFiles` exist because SPEC's C3 row says the server
exposes "definitions, references, implementations, symbol/file search" — every one of those is
answerable here, so C3 never reaches into `codeindex` directly. `Outline` is the token-reduction
primitive the chapter's own motivation names: a file's definition tree without the file's bytes.

**Resolving a `Query` to a name and a kind** (§11 test 2):

1. Load the file row by path; load its references and symbols (two indexed reads).
2. With `Point` set, convert to a byte: an identifier never spans a line in any language in scope, so
   a name span's own end column is `name_start_column + (name_end_byte - name_start_byte)`. Match
   against reference name spans first, then symbol name spans.
3. With `Byte` set, prefer a reference whose **name span** contains it; otherwise the innermost
   reference whose node span contains it (largest `start_byte` with `end_byte > byte`); otherwise the
   innermost symbol whose name span contains it.
4. With neither set, use `Query.Name` and treat the file as the scope origin.

`SearchSymbols` uses `name LIKE ? || '%'` against `symbol_name (repo_id, name)` for the prefix case
and a bounded `LIKE '%' || ? || '%'` scan for the substring case, ranked in Go (exact, then prefix,
then earliest match offset, then shorter name, then path). No fuzzy-match dependency is added: this is
substring ranking over a bounded result set, not infrastructure, and C7's interactive quick-open is a
renderer-side concern with its own existing precedent.

## 5. Resolution

### 5.1 Pipeline

For a reference with name `N`, kind `K`, in file `F`:

1. Candidates: every symbol in the repository named exactly `N` (one indexed read).
2. Drop self-references: a candidate whose name span equals the reference's name span in the same
   file. Go's `(type_identifier) @name @reference.type` makes every type definition its own reference,
   so without this rule `type Person struct{}` resolves to itself and reports itself as a use.
3. Assign each candidate a tier (§5.2). Keep only the best non-empty tier.
4. Rank inside that tier (§5.4). Cap at 16.
5. Confidence: `Exact` for a single candidate in tier 0 or 1, `Scoped` for several in tier 0 or 1,
   `RepoWide` for tier 2.

### 5.2 Tiers

- **Tier 0, same file.** Ordered inside itself: a candidate whose span contains the reference (an
  enclosing definition) first; then a candidate sharing the reference's innermost enclosing symbol as
  its parent; then any other same-file candidate. This is real lexical preference derived from C1's
  containment parents alone, without `locals.scm`.
- **Tier 1, same scope unit**, per §5.3.
- **Tier 2, repository-wide.**

### 5.3 Scope unit and the one rule per language family

| Language | Scope unit | Tier 1 rule | Extra rule |
|---|---|---|---|
| Go | directory (a Go package is a directory) | same directory | An identifier whose first rune is lower-case is package-private: it **never reaches tier 2**. No same-directory candidate means no result, which is correct rather than a miss |
| Java | directory (package, under any standard layout) | same directory | For `type`, `class` and `implementation` references, a candidate whose file basename equals `N` ranks first — Java requires it for a public type |
| Python | directory (sibling modules and the package `__init__.py`) | same directory | none |
| JavaScript, TypeScript, TSX, Vue, Svelte | file (a module) | same file, then same directory | A candidate whose file basename minus extension equals `N` ranks first, `index` excluded — the default-export convention (`Button.tsx` exporting `Button`) |
| Rust | file, then directory (`mod.rs`/`lib.rs` siblings) | same directory | none |

Go's case rule is the single highest-value rule in the table: it converts the most common Go
false-positive (a `helper` in one package resolving to a `helper` in another) into no answer at all,
which a caller can render honestly.

### 5.4 Ranking inside a tier

In order, each a tiebreak for the one above:

1. Kind compatibility with the reference kind. Compatible pairs:
   `call` with `function`, `method`, `constructor`, `macro`, `class`;
   `type` with `class`, `interface`, `struct`, `enum`, `type`, `module`;
   `class` with `class`, `struct`, `type`, `interface`;
   `implementation` with `interface`, `class`, `type`.
   An incompatible candidate is demoted, never dropped — the kind vocabulary is uneven across
   languages (Go has no `struct` kind, Rust files a struct under `class`), so dropping would turn an
   uneven vocabulary into a missing answer.
2. The language-specific basename rule, where §5.3 names one.
3. Longest shared directory prefix with `F`.
4. A non-test file over a test file. Test paths: `_test.go`, `.test.`/`.spec.` in the basename,
   a `test`/`tests`/`__tests__`/`testdata` path segment, a `Test.java`/`Tests.java` basename suffix.
5. `has_error = 0` over `has_error = 1`.
6. Path, then `start_byte`. Purely for determinism — two runs must never disagree.

### 5.5 `referencesTo`

`Resolved` (default): take every reference row named `N`, run §5.1 for each, keep it when its winning
target set intersects the query's target. Cost is bounded by a per-call memo keyed by
`(directory of the referring file, name, reference kind)` — the only inputs the tiers depend on — so a
name used 2,000 times across 40 directories costs 40 resolutions, not 2,000.

`NameOnly`: every reference row named `N`, no resolution. Cheaper, and the right mode for a
grep-shaped MCP tool that wants recall over precision. Both modes report `Total` and `Truncated`.

`IncludeDefinition` adds the target's own `NameSpan` as a `Site`.

### 5.6 What this gets wrong, stated plainly

- **Two same-named methods on unrelated types resolve to both.** `Run` on `Server` and `Run` on
  `Migration` are indistinguishable: no reference carries a receiver, and no symbol carries a type.
  Result: `Scoped` or `RepoWide` with several targets, never a wrong single answer dressed as certain.
- **Cross-file results are name matches, not import-resolved facts** (D5). A repository with two
  unrelated `Client` types gets both.
- **Java and JavaScript member calls attribute to the method name only** — `a.b.parse()` and
  `c.parse()` are one name.
- **Go method calls through an interface resolve to every implementation's method** with that name,
  which is arguably the more useful answer and is labelled `RepoWide` either way.
- **A builtin or external name resolves to nothing.** Go's `string`, React's `useState` from
  `node_modules` (never enumerated): zero targets, not an error.
- **Python decorators, dynamic attribute access and `getattr` are invisible.** So is anything behind
  a string: no framework does string-keyed lookup resolution here.
- **A same-name shadowing local is not distinguished from the outer binding** beyond tier 0's
  containment preference — no `locals.scm`, so a parameter named `config` is not a symbol at all.

## 6. `implementationsOf`, per language

The operation answers "which concrete implementations exist for this interface/trait/base type", and
its honest content differs by language because the stored evidence does.

- **Java — real, both directions.** `implements A, B` produces an `implementation` reference per
  interface, whose stored range is the `type_list`. The implementing class is recovered by
  containment: the innermost `class` symbol in the same file whose span contains that range. So
  `implementationsOf(Greeter)` returns class `Person`, a genuine `Target`. With §2.2, `extends`
  superclasses resolve the same way through `class` references.
- **Rust — real, as impl sites.** `impl Greeter for Person` produces one `implementation` reference
  named `Greeter` spanning the whole `impl_item`; the concrete type is not captured anywhere. So a
  result is the impl block's own location (path and span), with `Name` set to the trait and
  `Container` empty. Useful and honest; naming `Person` would require re-parsing, which this package
  does not do. An inherent `impl Person` produces a reference named `Person` and is reported for
  `implementationsOf(Person)` as that type's own impl blocks.
- **TypeScript, TSX, JavaScript, Python — real, via §2.3's added patterns.** The implementing class is
  recovered by the same containment rule Java uses.
- **Go — returns no results, deliberately.** Go interfaces are structural, so the only correct
  implementation is a method-set comparison, and C1's `method_declaration` capture is the method
  *name* only: no receiver type is stored, so the method set of a type cannot be assembled at all,
  let alone compared. This is a data limit, not an effort estimate. `ImplementationsOf` on a Go target
  returns an empty slice; callers render "not supported for Go" from the target's language rather than
  from a sentinel error. Recorded in `docs/ARCHITECTURE.md`'s Known open items (§12), since it is a
  currently-true limitation of a shipped operation.

Reverse direction: `implementationsOf` on a *concrete* type returns the interfaces it declares, from
the same rows read the other way, for every language above except Go.

## 7. Frameworks: exactly where the line falls

**Resolved.**

- **Vue and Svelte SFC script blocks are first-class.** A definition in `<script setup>` is an
  ordinary symbol with a `block_id`, and every operation works inside a script block exactly as in a
  `.ts` file. An SFC participates in cross-file resolution like any other module file.
- **Template to same-file script binding.** A position inside a `template` `file_block` has no
  reference row to hit (§7's reason below), so `DefinitionOf` falls back to `Query.Name` — the word
  under the cursor, which Monaco has for free and an MCP caller can pass — and resolves it against the
  same file's symbols first, script-setup block preferred. This is SPEC's own stated example, and it
  costs one optional field and zero new parsing precisely because both sides are already rows of one
  file.
- **React hooks and function components resolve as ordinary calls.** `useThing()` is a `call`
  reference; `function Button()` and `const Button = () => {}` are `function` symbols (the latter only
  after §2.1, in TypeScript).
- **Angular decorators resolve as ordinary calls.** `@Component({...})` is a `call_expression`, so the
  decorator itself resolves to its import-site definition when one is indexed.

**Not resolved, and why the cutoff is here.**

- **Any template-side reference in Vue, Svelte or Angular.** C1 stores no reference rows for template
  regions at all: HTML and Svelte have no vendored `tags.scm`, and even injecting `{{ }}` as
  JavaScript would not help, because the JS query captures calls and `new` expressions, never a bare
  identifier. Getting `{{ count }}` into the graph needs a hand-written identifier query plus a
  per-framework binding model. Speculative for one framework's benefit; the name-hint path above
  covers the common navigation case at a fraction of the cost.
- **JSX element to component.** `<Button/>` matches no pattern in javascript's tags.scm. Same cost
  shape as above, same decision. Calls and imports of the same component still resolve.
- **Cross-component prop flow** (Vue, Svelte, React). Needs a type system: a prop's declared shape,
  its binding site and its consumer are three separate files with no name in common.
- **Angular DI and template wiring.** `templateUrl` is a string literal inside a decorator argument;
  C1 already declined inline `template:` injection for the same reason (its §3.1), and a DI graph is a
  provider/injector model, not a name lookup.
- **Any framework-specific ranking boost.** No "prefer a `.vue` file for a PascalCase name" rule: it
  would help one convention and silently mis-rank every repository that does not follow it.

## 8. Invalidation and concurrency

**Nothing to invalidate.** The rows are the graph. C1 replaces a file's symbols, blocks and references
wholesale inside one transaction, so under WAL a query sees a file's old rows or its new ones, never
half of either. No resolution result is cached across calls, deliberately: a save in file `A` changes
how references in unrelated files resolve whenever tier 2 is in play, so any cross-call cache would
need repository-wide invalidation on every save. The only memo is §5.5's, whose lifetime is one call.

**`ChangedRanges` is not consumed by C2.** It exists for C5's decoration refresh; a graph that stores
no derived state has nothing to narrow with it.

**Two honest gaps, both handed forward rather than papered over.** A query issued during a full `Sync`
can observe a partially-reconciled repository, since `Sync` commits in 256-file batches — already true
for every C1 consumer, and self-correcting within one pass. And a dirty editor buffer is not indexed:
the watcher fires on save, so C2 answers against the last saved state. C5 owns that gap, and C1 §7.2
already left the seam for it.

**Concurrency.** `Graph` holds no mutable state; every method is safe for concurrent use and takes the
caller's `context.Context` through to `database/sql`. The shared `Store` pool (`SetMaxOpenConns(4)`)
is what bounds parallelism, unchanged.

## 9. Explicitly out of scope

- **Import resolution and any module-specifier handling** (D5).
- **Type inference of any kind**, including Go structural interface matching (§6).
- **Call hierarchy, type hierarchy, rename, code actions.** C5 and C3 ask for three operations;
  building a fourth speculatively is the trap `CLAUDE.md` names.
- **Cross-component framework inference** (§7).
- **A bound service, wire contract or renderer code.** No `internal/bridge` change, no bindings
  regeneration, no `frontend/` file.
- **A settings key.** Every bound in §4.3 is a constant.
- **Any caller.** Like C1, this is a library phase; C3 is its first consumer.

## 10. Implementation steps

Each step builds, passes `go vet`, and carries its own tests where §11 calls for them. The expensive
verification runs once at S6, per `CLAUDE.md`.

**S1 — `codeparse` extraction fixes.** §2 in full: `querySourcePaths` to `map[ID][]string` with
javascript ahead of typescript for `TypeScript`/`TSX`; `class` added to `referenceKinds`; the four
`c2_implements.scm` files with their own `Provenance` rows marked as this repo's own; `Reference`'s
name range; `extractionVersion` in `Fingerprint` plus the widened query-file walk. Golden tables in
`extract_test.go` updated to the new expected sets (TypeScript gains real classes, functions, methods
and calls; Java, JavaScript and TypeScript gain `class` references; four languages gain
`implementation` references). `NOTICES.md` untouched — no new upstream file is vendored.

**S2 — `codeindex` schema and reads.** `migrations/0002_c2_reference_name_range.sql` plus its `names`
entry; `replaceOneFileTx` writes the four new columns; `Sync` writes `meta.repo_root`. New
`codeindex/read.go`: `SymbolsInFile`, `ReferencesInFile`, `ReferencesByName`, `SymbolByID`,
`FileByID`, `FilesByIDs`, `SearchSymbols`, `SearchFiles`, `ListRepos`. `FindSymbolsByName` stays as
is; `ReferenceRow` mirrors `SymbolRow`'s shape.

**S3 — `codegraph` skeleton.** Package doc, types (§4.2), `New`, the `Query`-to-name resolution of
§4.3, `SymbolAt`, `Outline`, `SearchSymbols`, `SearchFiles`. Working increment: every file-scoped
question answerable, no cross-file resolution yet. Tests for position lookup.

**S4 — the resolver and `DefinitionOf`.** §5's tiers, per-language rules, kind matrix, ranking and
confidence. Table tests.

**S5 — `ReferencesTo` and `ImplementationsOf`.** Both modes with the memo (§5.5), §6's per-language
implementation semantics including Go's empty result, §7's name-hint template fallback. Tests.

**S6 — docs and verification.** §12's doc updates, then §13's full pass.

## 11. Testing

Against `CLAUDE.md`'s bar, file by file. Every test below seeds a real `codeindex.Store` over
`t.TempDir()` through `ReplaceFile` — no git, no parsing, no fixtures on disk — so the resolver is
exercised against exactly the rows it will see in production.

What earns a test:

1. **The resolver** (`codegraph/resolve.go`). Tier selection, the same-file enclosing/sibling order,
   Go's unexported-name rule refusing tier 2, Java's basename rule, the JS/TS basename rule, kind
   demotion, the test-file and `has_error` tiebreaks, the self-reference drop, determinism across two
   runs of a deliberately tied candidate set, and the confidence value each path yields. Several
   interacting rules over a decision structure too large to hold in your head: the bar's own wording.
2. **Position lookup** (`codegraph/position.go`). Name-span hit preferred over node-span containment;
   the Java/JavaScript case where the node span excludes the name; innermost-of-nested references;
   boundaries at exactly `start_byte` and exactly `end_byte`; a `Point` inside an injected block; a
   position in a template block falling through to the name hint. Boundary arithmetic with interacting
   rules.
3. **`ImplementationsOf` per language.** Java's containment recovery of the implementing class, Rust's
   impl-site result, TypeScript's `implements` via S1's added query, Go's empty result. Each is a
   different rule, not a repetition of one.
4. **`ReferencesTo`'s resolved mode and its memo.** A Go unexported name referenced in two packages
   must return only its own package's sites; the memo must not collapse two directories into one.
5. **`codeparse` goldens, extended** (existing file). The anti-drift guard C1 built now also guards
   S1's composition and added patterns — a grammar upgrade that stops matching `implements_clause`
   shows as a table diff, not a silently empty `implementationsOf`.

What gets nothing: `codeindex/read.go`'s query methods (CRUD reads, covered incidentally by every
test above), migration 0002 (one forward step against a schema no seeded data survives), `Outline`
(a parent-id tree walk over rows C1 already linked), `SearchFiles` ranking (substring scoring, one
obvious case), and every `Graph` method that is a thin wrapper over the resolver.

No Playwright work: this phase has no renderer surface.

## 12. Documentation to update

- **`docs/ARCHITECTURE.md`**, a new subsection after the `codeindex.db` storage paragraph: the graph
  is computed live with no edge table and why, `internal/codegraph`'s three operations plus its search
  and outline companions, §5.3's scope-unit table in one compact form, and §5.6's honest limits.
- **`docs/ARCHITECTURE.md` storage paragraph**: `reference` now carries the identifier's own range,
  and schema version is 2.
- **`docs/ARCHITECTURE.md` Stack table, code-parsing row**: TypeScript and TSX compile javascript's
  vendored query ahead of their own, and four small repo-authored `implements` queries exist beside
  the vendored ones.
- **`docs/ARCHITECTURE.md` Known open items**: one entry — `implementationsOf` returns nothing for Go,
  because no receiver type is stored, so a method set cannot be assembled for a structural match.
- No `docs/DEV_ENVIRONMENT.md` change: no new tool, no new build requirement.

## 13. Verification

Fast checks per commit: `go build ./apps/kira-studio/internal/...`, `go vet` on the three touched
packages, `bun run lint`.

Once at S6: `go test ./apps/kira-studio/internal/codeparse/... ./apps/kira-studio/internal/codeindex/...
./apps/kira-studio/internal/codegraph/...`, `go test ./apps/kira-studio/internal/` for the layering
test, `go test -race` on `codegraph` and `codeindex`, and `bun run test:go` as the backstop.

Then one real end-to-end run against this repository, recorded in the commit message rather than
asserted as a threshold (C1 §13's posture): full `Sync` after the fingerprint bump, row counts per
language compared against C1's own 7,737 symbols and 83,329 references to show what S1's extraction
fixes actually recovered, wall time for `DefinitionOf`, `ReferencesTo` and `ImplementationsOf` on a
hot cache, and a manual spot-check of twenty known definitions across Go, TypeScript, Vue and Java
with each result's rule and confidence printed — the honest measure of whether §5's heuristics
earn their place before C3 builds on them.
