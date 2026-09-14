# P64b — Repo-map MCP: index the Go and JavaScript declarations the vendored queries miss

One mandate (`docs/v1.6/SPEC.md`'s P64b row): P64 closed a missing-capture defect for TypeScript
only. The same defect class exists in Go and plain JavaScript. Close it there, after measuring how
much of this repository it actually costs.

Everything below was read directly, parsed with the pinned grammars, or measured against the live
`codeindex.db` and a live server. Nothing is inferred from P64's prose.

Measurement harness, so a claim here can be re-checked: a scratchpad Go module linking
`go-tree-sitter@v0.25.0` plus `tree-sitter-go@v0.25.0`, `tree-sitter-javascript@v0.25.0` and
`tree-sitter-typescript@v0.23.2` — the exact modules `go.mod` pins — compiling a composed query and
running it over this repository's own files with `extract.go`'s own dedup key
(`{kind, name, startByte, endByte}`, `extract.go:141`). Its counts for every *existing* kind match
the live index exactly (Go `function` 4210, `method` 1813, `type` 1276; JavaScript `class` 2,
`function` 20, `method` 2), which is what makes its counts for the *new* kinds trustworthy.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| How many top-level Go const/var exist here? | **1195** names — 845 const, 350 var — across 816 Go files. Two independent counts agree exactly: `go/parser` over the AST, and the proposed tree-sitter query | §1.4 |
| Do they matter for navigation? | Yes. 435 const + 51 var are exported. `adapters.CodeUnsupported` has 73 use sites, `CodeNotFound` 70, `CodeConnect` 64, `ErrPathEscapesRoot` 20 — none reachable by any tool today | §1.4, §1.5 |
| What definition kind? | `constant` for const, `variable` for var. `definitionKinds` (`extract.go:64`) already admits both; `kindCompatibility` (`resolve.go:20`) lists neither, so each is demoted — never dropped — as a candidate for a call/type reference. No resolver change | §2.2, §2.8 |
| Do iota const blocks need special handling? | **No.** A valueless `const_spec` inside a `const ( … )` block is still a `const_spec` with a `name` field; the one pattern captures it. Verified on a fixture: `KindA/KindB/KindC` all captured. This repo's dominant enum idiom is typed *string* consts anyway — 135 grouped const blocks against 7 iota ones | §2.2, §8.1 |
| Capture unexported (package-scoped) declarations too? | **Yes.** 709 of the 1195 are unexported, and the Go query already captures unexported `func`/`type` with no export filter. Excluding them would be a new rule, not a consistent one | §2.2 |
| Does this repository have standalone `.js` source worth fixing for its own sake? | Barely. **6** `.js`/`.mjs` files, 24 indexed symbols total. The JS fix adds **27** symbols. The case for doing it is the composed base and the next repository, not this one's `.js` tree | §1.7, §2.6 |
| Add the JS pattern to `javascript/tags.scm` so TypeScript inherits it by composition? | **No.** It would duplicate P64's own patterns for TS/TSX (the same matches, saved only by `extract.go`'s dedup) and would edit a vendored file. A repo-authored `queries/javascript/p64b_declarations.scm` registered on JavaScript alone has no overlap | §2.6 |
| Does P64's own query conflict with anything here? | No conflict. But it has a **gap**: its value enumeration misses 47 real TypeScript constants — 40 regex-valued, 5 ternary, 2 await. Same defect class, same file, fixed here | §1.8, §2.7 |
| Migration for the query change? | No. `Fingerprint` (`fingerprint.go:41`) hashes every file named in `querySourcePaths`, so registering a new file rebuilds the cache by itself. `extractionVersion` stays at 2 (`fingerprint.go:33`) — `extract.go` is untouched | §1.9 |
| Second Go defect found while reading | `(var_declaration (var_spec …))` cannot match a parenthesized `var ( … )` block at all: those specs sit under a `var_spec_list`. 26 such blocks here | §1.3 |

### 0.1 Sequencing gate — read before starting

`docs/v1.6/mcp-repo-map-issues.md` carries one **open** non-trivial entry (line 144): a bare-symbol
ambiguous listing orders candidates by path, not language family. The log's own process rule is
that the next phase does not start until every open non-trivial entry from the phase before it is
closed.

P64b is not that fix, and this plan does not silently absorb it. Flagging it for the orchestrator
with the cheapest correct resolution: the entry itself already argues a bare `{"symbol": X}` call
is *structurally* anchor-free — there is no referring file, so there is no "caller's own language"
to rank by — and that `languages` already gives a one-call escape. So the likely right close is
option (a) in the entry: correct P64's §2.7 expectation and close the entry as "not a defect",
which is a documentation edit, not code. Decide it deliberately before or as step 0 of P64b; do
not port `sameLanguageFamily` into `codegraph/search.go`'s `less()` without deciding, since that
would invent a language preference where no anchor exists.

## 1. Confirmed current state

### 1.1 Go — the two patterns, quoted in full

`queries/go/tags.scm` is 43 lines. Its last four patterns (lines 32, 34, 36, 38, 40, 42) are the
ones with no `@definition`/`@reference` capture at all:

```scheme
(package_clause "package" (package_identifier) @name)

(type_declaration (type_spec name: (type_identifier) @name type: (interface_type)))

(type_declaration (type_spec name: (type_identifier) @name type: (struct_type)))

(import_declaration (import_spec) @name)

(var_declaration (var_spec name: (identifier) @name))

(const_declaration (const_spec name: (identifier) @name))
```

`extract.go:168-169` states the consequence in the code itself:

> A match with neither a `@definition.x` nor a `@reference.x` top-level capture (e.g. Go's bare
> `(package_clause "package" (package_identifier) @name)`) produces no row at all.

The two `type_declaration` lines are harmless duplicates — `(type_spec name: … ) @definition.type`
on line 27 already captures those nodes. `import_declaration` is the subject of P64 §5.2's own
declined import-graph section. `var_declaration` and `const_declaration` are the defect: they are
the only two shapes in the file whose *only* pattern lacks a definition capture.

This file was **not** touched by P64 (P64 changed `queries.go`, `queries/typescript/`,
`queries/tsx/` and `internal/{codegraph,codeindex,repomap}` only), so the quotation above is stable
against anything P64 landed.

### 1.2 Live proof, not just the code path

Against a server built from `2d005723` (P64 fully landed) on a completed reindex of this worktree:

```
search_symbols  {"query":"CodeConnect"}       -> no symbols matching "CodeConnect"
find_definition {"symbol":"PaginationKeyset"} -> no symbol named "PaginationKeyset" found
find_definition {"symbol":"ErrStreamFull"}    -> no symbol named "ErrStreamFull" found
```

All three exist: `adapters/errors.go:17`, `adapters/caps.go:9`, `adapterhost/session.go:16`.

`outline_file {"file":"apps/kira-studio/internal/adapters/errors.go"}` returns 15 nodes — 2 types,
2 methods, 11 functions. The file's real top-level declarations are 25: the missing 10 are the
eight `ErrorCode` constants (`CodeConnect` … `CodeEngineDown`, lines 17-24) and the two regexp vars
in the `var (` block at line 74. `outline_file`'s own tool description calls itself the cheapest
way to see what a file contains; on the file that defines this codebase's error vocabulary it shows
60% of it and omits the vocabulary.

Symbol counts from the live `codeindex.db`, `repo_id` `/home/user/kira-studio`:

| language | function | method | type | interface | class | constant | variable | enum |
|---|---|---|---|---|---|---|---|---|
| go | 4210 | 1813 | 1276 | — | — | **0** | **0** | — |
| typescript | 3243 | 1088 | 352 | 647 | 112 | 1270 | — | 9 |
| vue | 1208 | 13 | 30 | 22 | — | 1554 | — | — |
| javascript | 20 | 2 | — | — | 2 | **0** | — | — |

TypeScript/Vue `constant` is non-zero because P64 landed. Go and JavaScript are zero for the same
reason they were zero for TypeScript before P64: no pattern produces the kind.

### 1.3 A second Go defect in the same pattern

`var_declaration`'s own rule, from the pinned grammar (`tree-sitter-go@v0.25.0`, `grammar.js`):

```js
var_declaration: $ => seq('var', choice($.var_spec, $.var_spec_list)),
var_spec_list:   $ => seq('(', repeat(seq($.var_spec, terminator)), ')'),
```

`node-types.json` agrees: `var_declaration`'s children are `var_spec` **or** `var_spec_list`. So
`(var_declaration (var_spec …))` requires `var_spec` as a *direct* child and cannot match a
parenthesized block. 26 such blocks exist here (including `adapters/errors.go:74`). Even with a
`@definition` capture bolted onto the existing line, grouped `var` would still produce nothing.

`const_declaration` differs and needs no equivalent handling — it inlines its specs with no list
node:

```js
const_declaration: $ => seq('const', choice($.const_spec, seq('(', repeat(seq($.const_spec, terminator)), ')'))),
```

### 1.4 Measured: what Go is missing

816 Go files. Counted twice, by `go/parser` over the AST and by running the proposed query with the
pinned grammar. Both give 1195.

| | count |
|---|---|
| package-level `const` names | **845** (435 exported) |
| package-level `var` names | **350** (51 exported) |
| …of which `Err*`/`err*` sentinels | 27 |
| grouped `const ( … )` blocks | 135 |
| grouped `var ( … )` blocks | 26 |
| iota const blocks / names in them | 7 / 25 |
| blank `_` names at package level | **0** |
| multi-name specs (`const A, B = …`) at package level | **0** |
| function-local `var` names | 1752 |
| function-local `const` names | 155 |

The last two rows are the anchoring budget, not the prize — see §2.3.

That 1195 sits against Go's existing 7299 indexed symbols: **+16%** for Go, **+7.1%** for the
whole index (16894 today).

Whether they matter, measured rather than asserted — repository-wide use sites by `grep`:

| name | kind | use sites |
|---|---|---|
| `adapters.CodeUnsupported` | const | 73 |
| `adapters.CodeNotFound` | const | 70 |
| `adapters.CodeConnect` | const | 64 |
| `codeworkspace.ErrPathEscapesRoot` | var | 20 |
| `adapters.PaginationKeyset` | const | 6 |
| `adapterhost.ErrStreamFull` | var | 5 |

This codebase's error-code vocabulary, pagination-strategy vocabulary and sentinel errors are all
package-level `const`/`var`. They are exported API surface by any reading, and none of them is
reachable by `find_definition`, `search_symbols`, `outline_file` or `read_symbol`.

### 1.5 One honest limit: `find_references` will still return nothing for these

Unlike P64's TypeScript case — where `type_annotation` already produced `@reference.type` rows, so
indexing the definition unlocked references too — Go has **no** reference rows for a constant. From
the live index: `TreeNode` has 113 `type` reference rows; `CodeConnect` and `ErrStreamFull` have
**0** rows of any kind.

That is structural, not an oversight, and §8.2 declines fixing it with the measurement.
`find_definition`, `search_symbols`, `outline_file` and `read_symbol` all start working; expect
`find_references` on a Go constant to stay empty, and say so in the docs rather than let a caller
read empty as "unused".

### 1.6 JavaScript — the query read in full

`queries/javascript/tags.scm` is 99 lines. Relevant parts:

- Lines 41-61: `lexical_declaration` (`const`/`let`) and `variable_declaration` (`var`) whose
  declarator value is an `arrow_function` or `function_expression` → `@definition.function`.
  Deliberate and correct; a function is a function however it is bound.
- Lines 90-99, the file's only `@definition.constant`:

```scheme
(export_statement value: (assignment_expression left: (identifier) @name right: ([
 (number)
 (string)
 (identifier)
 (undefined)
 (null)
 (new_expression)
 (binary_expression)
 (call_expression)
]))) @definition.constant
```

`export_statement`'s `value` field is `export default <expr>`. Combined with an
`assignment_expression` right-hand side, this matches `export default (X = 1)` — a CommonJS-era
shape. It matches nothing in this repository: the JavaScript `constant` count is 0 and the baseline
run of the composed query produces no `constant` key at all.

There is no pattern for ESM `export const X = {…}`, and none for a bare module-level
`const X = …` with a non-function value.

`queries.go:61-69` confirms the composition: `JavaScript` compiles
`javascript/tags.scm` + `javascript/c2_implements.scm`; `TypeScript` compiles
`javascript/tags.scm` + `typescript/tags.scm` + `typescript/c2_implements.scm` +
`typescript/p64_declarations.scm`; `TSX` the same with its own last two. So the JavaScript file is
the base of all three — which is what makes §2.6's placement decision a real decision.

This file was also untouched by P64.

### 1.7 Measured: what JavaScript is missing, and how little it is here

Every `.js`/`.mjs`/`.cjs` file in the tree outside `node_modules`/`dist`:

| file | lines | new constants the fix adds |
|---|---|---|
| `docs/design/kira-design-system/build.mjs` | 114 | 16 |
| `scripts/demo-dbs/mongo/seed.js` | 250 | 11 |
| `scripts/demo-dbs/mongo/init.js` | 85 | 0 |
| `apps/kira-studio/tests/ui/support/mockStreamBrowser.js` | 177 | 0 |
| `apps/kira-studio/frontend/wails/runtime.js` | 21 | 0 |
| `apps/kira-studio/internal/codeparse/testdata/extract/sample.js` | 15 | 0 |

**27** symbols, on a current JavaScript total of 24. `outline_file` on `build.mjs` returns 3 nodes
today (`P`, `row`, `b` — the arrow-valued ones); the file has 19 top-level declarations.

Two reach questions, both measured and both negative:

- **HTML injected scripts.** `resolveScriptLang` (`inject.go:186`) maps a `<script>` with no
  `lang` to JavaScript, so a `.html` file's inline script uses this query. 53 HTML files here
  contain **4** non-`src` inline script blocks between them, with **0** top-level constants. No
  reach.
- **Svelte.** 1 file, 1 symbol. No reach.

So the JavaScript half is worth ~27 symbols in this repository. §2.6 states why it is still worth
doing, without inflating that number.

### 1.8 A third finding: P64's value enumeration misses 47 TypeScript constants

SPEC asks this row to check P64's own new query for duplication or conflict. There is neither — but
there is a gap of exactly the same class.

P64's pattern enumerates the *value* node kinds it accepts, because a tree-sitter query cannot
negate a child (its own comment says so). Probing every `program`-level `const` declarator across
764 `.ts` files with the pinned TypeScript grammar, grouped by value node kind:

| value kind | count | in P64's list |
|---|---|---|
| `call_expression` | 354 | yes |
| `object` | 203 | yes |
| `string` | 169 | yes |
| `number` | 154 | yes |
| `array` | 124 | yes |
| `new_expression` | 96 | yes |
| `template_string` | 49 | yes |
| `as_expression` | 43 | yes |
| **`regex`** | **40** | **no** |
| `member_expression` | 37 | yes |
| `binary_expression` | 24 | yes |
| `identifier` | 13 | yes |
| `unary_expression` | 5 | yes |
| **`ternary_expression`** | **5** | **no** |
| `arrow_function` | 5 | correctly excluded — already `@definition.function` |
| **`await_expression`** | **2** | **no** |
| `satisfies_expression` | 2 | yes |

47 real constants invisible. Confirmed live:
`find_definition {"symbol":"OPERATOR_RE"}` → `no symbol named "OPERATOR_RE" found`, though
`packages/shared/domain/sql-tokens.ts:179` declares it and `sql-tokens.ts:280` uses it. The
regex-valued names are exactly the shape an agent looks up by name —
`OPERATOR_RE`, `URL_UNSAFE_PATTERN`, `TRAILER_LINE`.

### 1.9 Cache invalidation is automatic — with one correction to P64 §1.7

`Fingerprint` (`fingerprint.go:41`) hashes every linked grammar module version,
`extractionVersion`, and each query file's bytes. The correction worth carrying: it walks
**`querySourcePaths`** (`fingerprint.go:59`), not the `//go:embed` list. A file added to the embed
line but not to a language's `querySourcePaths` entry changes neither the fingerprint nor any
parse — it is simply dead weight. Register in both.

Consequences: no migration, no `extractionVersion` bump, and the next `Sync` after a rebuilt binary
truncates and reindexes this repository by itself (~1800 files, under 30s on this container — a
tool call during that window correctly answers "index is still building").

## 2. The fix

### 2.1 Root cause, stated once

Two vendored `tags.scm` files describe declarations they never file under a definition kind. Go's
`const_declaration`/`var_declaration` patterns capture `@name` and stop; JavaScript's only
`@definition.constant` pattern describes a shape this decade's code does not write. Nothing
downstream is wrong: the kind vocabulary admits `constant` and `variable`, the writer stores what
it is handed, the resolver ranks what exists.

### 2.2 Go — `queries/go/p64b_declarations.scm`

New repo-authored file, not an edit to the vendored one — the split `c2_implements.scm` established
and `p64_declarations.scm` followed. Every node kind, field name and child relationship below was
checked against `tree-sitter-go@v0.25.0`'s own `node-types.json` and `grammar.js`, and the file
compiles and runs: composed with `go/tags.scm` it yields 14 patterns and produces
`constant:845 variable:350` while leaving `function:4210 method:1813 type:1276` byte-identical to
the live index.

```scheme
; P64b-authored (docs/v1.6/plans/P64b-repo-map-go-and-javascript-constants.md §2.2) — not vendored.
; The vendored tree-sitter-go tags.scm captures a package-level const/var name with no @definition
; wrapper, so extract.go produces no row for either; and its var pattern cannot match a
; parenthesized `var ( … )` block at all, whose specs sit under a var_spec_list rather than
; directly under var_declaration.

; Package-level `const`. Anchored at source_file so a function-local const never becomes a symbol.
; @definition.constant sits on the const_spec, not the const_declaration, so each name in a
; `const ( … )` block gets its own span — the same choice the vendored file already makes for
; type_spec rather than type_declaration. A valueless spec (an iota block's 2nd and later names)
; still has a `name` field, so it is captured by the same pattern.
(source_file
  (const_declaration
    (const_spec
      name: (identifier) @name) @definition.constant))

; Package-level `var`, single-spec form.
(source_file
  (var_declaration
    (var_spec
      name: (identifier) @name) @definition.variable))

; Package-level `var ( … )`, whose specs sit one level deeper.
(source_file
  (var_declaration
    (var_spec_list
      (var_spec
        name: (identifier) @name) @definition.variable)))
```

Facts the implementer should not have to rediscover:

- `const_spec.name` and `var_spec.name` are both `multiple: true` — `const A, B = 1, 2` is one spec
  with two names, producing two matches with the same definition span and different names. Both
  survive `extract.go`'s dedup key. `linkParents` would then file the second under the first
  (identical ranges, stable sort), the same benign artefact its own doc comment already records for
  Rust. **Zero such specs exist in this repository**, so this is a note, not a risk to design
  around.
- Blank `_` names: zero at package level here. No `(#not-eq? @name "_")` predicate — do not add a
  guard for a case this repository does not have; if a future repository shows one, a `_` symbol is
  ugly but not wrong.
- Registration: add the path to the `//go:embed` line (`queries.go:11`), append it to `Go`'s
  `querySourcePaths` entry (`queries.go:67`), and add one `Provenance` row with
  `UpstreamModule: thisRepo` (`queries.go:34-52`). All three, per §1.9.

### 2.3 Why `source_file`-anchored, measured

Unanchored, the same three patterns yield **3095** symbols across this repository. Anchored, they
yield **1195**. The 1900 difference is function-local `var`/`const` — noise that would outnumber the
real declarations 1.6:1, pollute every `search_symbols` prefix match, and add nothing: a local is
found by reading the function you are already in.

P64 anchored TypeScript's const at `program` for the same reason. Go's own `type_spec` pattern is
*not* anchored, which is defensible there — a type declared inside a function body is rare and
genuinely a definition. A local `var` is neither.

Verified on a fixture containing an iota block, a string-const block, a grouped `var` block, a
single `var`, a single `const`, and one `const` plus one `var` inside a function body: 9 symbols
captured, the two locals excluded.

### 2.4 Why `@definition` sits on the spec, not the declaration

Putting it on `const_declaration` would give every name in a `const ( … )` block the same span —
the whole block. `outline_file` would then print eight identical positions for `errors.go`'s eight
codes, `read_symbol {"symbol":"CodeConnect"}` would return all eight lines, and `linkParents` would
nest seven of them under the first.

On the spec, each name carries its own one-line span. The cost is that a *single* `const X = 1`
declaration's span excludes the `const` keyword — which is exactly the trade the vendored file
already makes by capturing `type_spec` rather than `type_declaration`, so this follows an
established precedent rather than inventing one.

### 2.5 JavaScript — `queries/javascript/p64b_declarations.scm`

P64's TypeScript file with two node kinds removed and four added. `as_expression` and
`satisfies_expression` **do not exist** in `tree-sitter-javascript@v0.25.0` — including them fails
the compile. `regex`, `ternary_expression`, `await_expression` and `subscript_expression` all do
exist, and are added here and in §2.7 together, so the two files stay one list.

Verified: composed with `javascript/tags.scm` + `javascript/c2_implements.scm` it compiles (14
patterns) and adds `constant:27` while leaving `class:2 function:20 method:2` identical to the live
index.

```scheme
; P64b-authored (docs/v1.6/plans/P64b-repo-map-go-and-javascript-constants.md §2.5) — not vendored.
; javascript/tags.scm captures an arrow/function-valued const as @definition.function (correct) and
; has one @definition.constant pattern for `export default (X = …)` only, which matches no ESM
; `export const X = …` and no bare module-level const. Same shape as P64's own
; typescript/p64_declarations.scm, minus (as_expression)/(satisfies_expression), which exist only
; in the TypeScript grammar.

; Module-level `const` bound to a non-function value. Anchored at `program` (and at an
; export_statement directly under it) so a local inside a function body never becomes a symbol.
; The value list enumerates non-function expression kinds rather than excluding function ones:
; tree-sitter queries cannot negate a child.
(program
  (lexical_declaration
    kind: "const"
    (variable_declarator
      name: (identifier) @name
      value: [
        (call_expression) (object) (array) (string) (template_string) (number)
        (new_expression) (member_expression) (identifier) (binary_expression)
        (unary_expression) (regex) (ternary_expression) (await_expression)
        (subscript_expression)
        (true) (false) (null) (undefined)
      ])) @definition.constant)

(program
  (export_statement
    declaration: (lexical_declaration
      kind: "const"
      (variable_declarator
        name: (identifier) @name
        value: [
          (call_expression) (object) (array) (string) (template_string) (number)
          (new_expression) (member_expression) (identifier) (binary_expression)
          (unary_expression) (regex) (ternary_expression) (await_expression)
          (subscript_expression)
          (true) (false) (null) (undefined)
        ]))) @definition.constant)
```

`lexical_declaration`'s `kind` field exists in the JavaScript grammar exactly as in TypeScript's
(`node-types.json`: required, types `const`/`let`), so the `kind: "const"` field-plus-anonymous-node
form P64 uses compiles here too — confirmed, not assumed.

`let` and `var` at module scope stay uncaptured, matching P64 §2.2's own decision.

Registration: embed line, `JavaScript`'s `querySourcePaths` entry (`queries.go:64`), one
`Provenance` row. **Do not** add it to the TypeScript or TSX entries — §2.6.

### 2.6 The composition decision, and why the vendored file stays untouched

Three placements were possible. Measured, not argued:

| Placement | Effect on TS/TSX | Verdict |
|---|---|---|
| Patterns inside `javascript/tags.scm` | Compiled into TS/TSX too, where P64's file already has them. Every module const matches twice, identical `{kind, name, startByte, endByte}`, saved only by `extract.go`'s dedup. Also edits a vendored file, against the repo's own convention | No |
| New file registered on JavaScript **and** TypeScript/TSX | Same duplicate matches, same reliance on dedup, and the TS version would be the weaker list (no `as_expression`/`satisfies_expression`) | No |
| New file registered on **JavaScript only**, with P64's own file widened in place | No overlap. Each language compiles exactly one module-const pattern pair. Vendored files untouched | **Yes** |

The residual is that two repo-authored files now carry near-identical value lists that must be kept
in step. §4's golden fixtures are what catch a drift, and the two files' header comments should
name each other.

Why do the JavaScript half at all, given §1.7's 27 symbols: the same reason P64 updated the TSX
query for a repository with zero `.tsx` files — this server is pointed at other repositories
(`bun run mcp:repo-map --repo <path>`), and a plain-JavaScript repository would today get functions
and classes and no constants at all. 27 symbols is the honest local number; correctness for the next
repository is the actual case.

### 2.7 Widen P64's own value list

Edit `queries/typescript/p64_declarations.scm` and `queries/tsx/p64_declarations.scm` (both
repo-authored, both editable) to add `(regex) (ternary_expression) (await_expression)
(subscript_expression)` to each of the two value lists, so all three files carry one list.

Measured on 764 `.ts` files: `constant` 1273 → **1320** (+47), every other kind unchanged
(`class:112 enum:11 function:3360 interface:844 method:1088 type:358` before and after). Compiles
against the pinned TypeScript grammar.

`subscript_expression` contributes 0 here and is included only to keep the three lists identical;
it can never hold a function literal, so it cannot produce a duplicate `function`/`constant` pair.

`parenthesized_expression` was considered for the same reason and **excluded**: it can wrap an arrow
(`const f = (() => {})`), which would produce exactly that duplicate pair. Zero occurrences measured
here either way.

Scope call, stated rather than smuggled: SPEC's row names Go and JavaScript. This is a third file.
It is in scope because it is the same defect (a non-function const with no capture), in files P64
itself created, fixed by the same rebuild with no additional risk surface — and because P65 measures
this server against a no-MCP baseline, so shipping a knowingly half-populated constant index wastes
that measurement. Same reasoning P64 §2.3 used to pull consts and enums into a type-alias row.

### 2.8 Cost, measured

| | |
|---|---|
| New symbols | 1195 (Go) + 27 (JS) + 47 (TS/TSX) = **1269** |
| Index growth | 16894 → 18163, **+7.5%** |
| Distinct new Go names colliding with an existing indexed name | **10** of 1092 (`Cancelled`, `Exact`, `Resolved`, `Unsupported`, `caps`, `cellAt`, `files`, `names`, `notImplemented`, `strp`) |
| New Go names colliding with each other across packages | 48 |

So an existing unambiguous lookup becomes ambiguous in 10 cases repository-wide — and ambiguity is
returned as a candidate list with a source line under each (`renderAmbiguous`), never a silent wrong
answer. The 48 intra-set collisions are same-named constants in different packages, which is what a
candidate list is for.

Resolution noise, checked rather than assumed: `kindCompatibility` (`resolve.go:20-25`) lists
neither `constant` nor `variable` under `call`, `type`, `class` or `implementation`, so every new
symbol is demoted — never dropped — as a candidate for any of those references. That is the existing
design absorbing the change, not a change.

### 2.9 What the fix does not change

- No schema migration, no `extractionVersion` bump (§1.9).
- No change to `extract.go`, `definitionKinds`, `referenceKinds`, or any `codegraph`/`codeindex`/
  `repomap` Go file. The whole fix is query text plus `queries.go` registration.
- No vendored `tags.scm` is edited.
- No new reference kinds, and no reference rows for Go constants (§1.5, §8.2).
- Java, Python, Rust, HTML, CSS, JSON, Svelte queries untouched.

### 2.10 Required results, against the exact cases above

Rebuild, restart, let the fingerprint-driven reindex finish, then:

| Call | Required result |
|---|---|
| `find_definition {"symbol":"CodeConnect"}` | 1 definition, `apps/kira-studio/internal/adapters/errors.go:17`, kind `constant` |
| `find_definition {"symbol":"PaginationKeyset"}` | 1 definition, `apps/kira-studio/internal/adapters/caps.go:9` |
| `find_definition {"symbol":"ErrStreamFull"}` | 1 definition, `apps/kira-studio/internal/adapterhost/session.go:16`, kind `variable` |
| `search_symbols {"query":"Pagination","kinds":["constant"]}` | the six `Pagination*` strategy constants |
| `outline_file {"file":"apps/kira-studio/internal/adapters/errors.go"}` | **25** nodes, not 15 |
| `read_symbol {"symbol":"CodeConnect"}` | the single `CodeConnect ErrorCode = "E_CONNECT"` line with its range header, not the whole `const (` block |
| `find_references {"symbol":"CodeConnect"}` | empty — expected, §1.5. Not a regression |
| `outline_file {"file":"docs/design/kira-design-system/build.mjs"}` | **19** nodes, not 3 |
| `find_definition {"symbol":"OPERATOR_RE"}` | 1 definition, `packages/shared/domain/sql-tokens.ts:179` |
| `find_definition {"symbol":"treeNodeSchema"}` | unchanged from P64 — 1 definition, `packages/shared/domain/tree.ts:88` |
| `outline_file {"file":"packages/shared/domain/tree.ts"}` | still 23 nodes — no regression from the widened list |

## 3. Work order

One Sonnet subagent, sequential. Order-dependent: each query change is gated by the golden table
before the index is rebuilt on top of it.

0. Settle §0.1's open dogfooding entry (or confirm the orchestrator has). Not a code step in this
   plan; do not start step 1 while it is unresolved.
1. Add `queries/go/p64b_declarations.scm`; register in the embed line, `querySourcePaths[Go]` and
   `Provenance`. `go build ./...` — a query that fails to compile fails here, loudly, because
   `queryFor` returns the error and every `codeparse` test fails.
2. Extend `testdata/extract/sample.go` and `extract_test.go`'s Go golden table (§4.1).
   **Gate:** `go test ./internal/codeparse/...`.
3. Rebuild `kira-repo-map`, restart, let the reindex finish, run §2.10's Go rows.
   Commit: `fix(repomap): index package-level Go const and var declarations`.
4. Add `queries/javascript/p64b_declarations.scm`; register the same three places for `JavaScript`
   only. Extend `testdata/extract/sample.js` and its golden row (§4.2).
   **Gate:** `go test ./internal/codeparse/...`.
   Commit: `fix(repomap): index module-level JavaScript constants`.
5. Widen the value list in `queries/typescript/p64_declarations.scm` and
   `queries/tsx/p64_declarations.scm`. Extend `testdata/extract/sample.ts` and its golden row
   (§4.3). **Gate:** `go test ./internal/codeparse/...`.
   Commit: `fix(repomap): index regex-, ternary- and await-valued TypeScript constants`.
6. Rebuild, restart, reindex, run §2.10 in full, then §5's dogfooding.
7. Docs (§6). Commit: `docs(repomap): P64b — Go and JavaScript constant coverage`.

`go build ./...` and `go vet ./...` per commit. The full `go test ./...` and the live pass run once
at the end, per `CLAUDE.md`'s "implement the whole plan first, then test once".

## 4. Tests

`CLAUDE.md`'s bar is a test only for genuinely hard logic. Nothing here is new *logic* — it is
declarative query text. But `TestExtractGoldenFixtures` is the anti-drift guard its own doc comment
describes, and it is the only thing between a grammar bump and a silently empty index. Extend it;
add nothing else.

### 4.1 `sample.go` + the Go golden row

The fixture must exercise every decision §2.2-§2.4 made, so a later change that breaks one fails
here:

- an iota `const ( … )` block whose 2nd and 3rd names carry no value — asserts all three captured;
- a grouped string-`const` block — asserts the typed-string enum idiom;
- a grouped `var ( … )` block — asserts `var_spec_list` traversal (§1.3);
- a single `var X = …` and a single `const X = …` — asserts the non-list form;
- one `const` and one `var` **inside a function body** — asserts **no** row, the `source_file`
  anchor (§2.3).

Golden rows are `{kind, name, parentIndex}` sorted by start byte, with `parentIndex` `-1` for all of
them (a package-level spec has no enclosing symbol).

### 4.2 `sample.js` + the JavaScript golden row

- one `export const` bound to an object, one bare `const` bound to a call expression — asserts both
  patterns;
- one arrow-valued `export const` — asserts **one** `function` row and **no** `constant` row, i.e.
  no duplicate with `javascript/tags.scm`'s lines 41-61;
- one `const` inside a function body — asserts no row (the `program` anchor);
- one `let` at module scope — asserts no row (§2.5's deliberate exclusion).

### 4.3 `sample.ts` + the TypeScript golden row

One regex-valued module `const` is enough to pin §2.7's widening. P64 already put an arrow-valued
const and a function-body const in this fixture; do not duplicate them.

### Deliberately no test for

The `queries.go` registration (three list literals; a missing entry fails the golden test or the
build), `Provenance` (a documentation table with no behaviour), the fingerprint change (already
covered by `TestSync_FingerprintMismatchTruncatesRepo`, `sync_test.go:274`), and anything in
`codegraph`/`codeindex`/`repomap` — none of which this phase touches.

## 5. Dogfooding

Per `CLAUDE.md`'s "Repo-map MCP server" and `docs/v1.6/mcp-repo-map-issues.md`'s own header.

**From this planning session, to transcribe.** The entries below were produced by this pass and
belong in the log. They are recorded here rather than written into
`docs/v1.6/mcp-repo-map-issues.md` directly because this was a plan-only task running alongside
P64's implementation agent on the same branch, and that file was uncommitted-modified for part of
the session. The implementing session should transcribe them under the existing trivial section:

- **P64b (planning)** — the server was `ConnectionRefused` at session start, same as every prior
  entry. Started it per the headless steps. The existing hashed token under `/root/.kira-studio/`
  cannot be read back, and deleting it would have broken the concurrently-running P64 agent's own
  registration, so this session pointed `KIRA_HOME` at a scratchpad directory instead to mint a
  fresh token against an isolated index — a cleaner workaround than remint-and-break, worth
  recording. One nit: the server does not create `KIRA_HOME` if the directory is absent; it exits
  with `mcpauth: write …: no such file or directory`. `mkdir -p` first. Trivial, no fix filed.
- **P64b (planning)** — the tool answers themselves were correct in every call made. The three
  wrong-looking answers (`CodeConnect`, `PaginationKeyset`, `ErrStreamFull` all "not found") are
  this phase's own subject, already logged as the P64b SPEC row, so they are not a new entry.

**For the implementing session.** Navigate with the server as usual, and after step 6 run at least:
`find_definition` on a Go const in a grouped block and on a Go sentinel `var`; `read_symbol` on
both, checking the range covers the one spec line and not the enclosing block; `outline_file` on
`apps/kira-studio/internal/adapters/errors.go` and on `docs/design/kira-design-system/build.mjs`;
`search_symbols` with `kinds:["constant"]` and with `kinds:["variable"]`. Log whatever that finds
under the trivial/non-trivial split — a non-trivial finding in P64b's own new surface is logged and
**not** fixed in P64b, per the process.

Two setup notes not to rediscover: the server must be **rebuilt** before dogfooding or it serves the
old query set, and the first `Sync` after that rebuild reindexes the whole repository (fingerprint
mismatch, §1.9).

## 6. Documentation to update

- **`docs/ARCHITECTURE.md` line 49** (the code-parsing row) says C2 adds *"four small repo-authored
  `queries/<lang>/c2_implements.scm` files … the only hand-written query text in the package"*.
  That has been false since P64 landed two `p64_declarations.scm` files (the file mentions neither —
  `grep -c p64_declarations docs/ARCHITECTURE.md` returns 0 at `2d005723`), and P64b adds two or
  three more. Correct the sentence once, naming the repo-authored query set as a set rather than
  re-counting files that will keep growing.
- **`docs/ARCHITECTURE.md`, the C3 paragraph (~944-960)** — no tool count change (still seven).
  Worth one clause: Go package-level `const`/`var` are indexed as definitions but have no reference
  rows, so `find_references` on a Go constant is empty by construction (§1.5). Without it, a caller
  reads empty as "unused".
- **`CLAUDE.md`** — no change. No new tool, no new process rule.
- **`docs/DEV_ENVIRONMENT.md`** — no change expected; check its repo-map section for a query-file
  list before assuming so.
- **Known open items** — nothing opens or closes. Go's missing `find_implementations` entry is
  unrelated and stays.

## 7. Verification

Mechanical, from `apps/kira-studio`:

- `go build ./...`, `go vet ./...`, `go test ./...`.
- `bun run mcp:repo-map:build` succeeds (cgo).
- `internal/layering_test.go` still passes.

Live, against a restarted server on a completed reindex:

- §2.10's table, every row.
- Language/kind totals from `codeindex.db` for this `repo_id`: go `constant` **845**, go `variable`
  **350**, javascript `constant` **27**, and typescript+vue `constant` **up from 2824 by 40-47**
  (the §1.8 probe covered `.ts` files only, so the exact split across the typescript and vue rows is
  not predicted here — only that it rises and that `OPERATOR_RE` resolves).
- Go `function`/`method`/`type` **unchanged at 4210/1813/1276**, typescript `function`/`interface`/
  `type`/`class`/`enum` unchanged, javascript `function`/`method`/`class` unchanged at 20/2/2. This
  is the real regression check — a new pattern that perturbs an existing count is matching something
  it should not.
- `tools/list` still returns seven tools.

## 8. Considered and declined

### 8.1 Special handling for iota const blocks — declined, with the fixture

The intuition is that `const ( A Kind = iota; B; C )` is an enum and deserves `@definition.enum`, or
a block-level grouping symbol. Both declined:

- **No special pattern is needed to capture them.** A valueless `const_spec` still has a `name`
  field, so §2.2's single pattern captures `B` and `C`. Verified on a fixture: `KindA`, `KindB`,
  `KindC` all returned.
- **`enum` would be a worse label.** Go has no enum. `kindCompatibility` lists `enum` under `type`
  and `class` references, so filing a Go constant as `enum` would make it a ranked candidate for
  every type reference in the repository — actively wrong.
- **It is not even the dominant idiom here.** 7 iota blocks against 135 grouped const blocks; the
  repository's real enums are typed string constants (`ErrorCode = "E_CONNECT"`,
  `PaginationStrategy = "keyset"`), which need nothing special.

### 8.2 Reference rows for Go constant use sites — declined, with the number

This would make `find_references` work for Go constants (§1.5). It cannot be done at acceptable
cost. Go's grammar has no node kind distinguishing a constant use from any other identifier use —
`type_identifier` exists, which is why `@reference.type` works; there is no `const_identifier`. The
only available capture is every `identifier` and `field_identifier`.

Measured over this repository's 816 Go files: **192,770** `identifier` nodes and **65,201**
`field_identifier` nodes — **257,971** reference rows for one language, against a current whole-repo
reference table of **134,068**. A 2.9x blowup of the entire index, for a name-based resolver that
would then rank every local variable named `err` as a candidate.

`grep` answers "where is this constant used" in one call today. Decline.

### 8.3 Fixing `javascript/tags.scm`'s dead CommonJS constant pattern — declined

Lines 90-99 match `export default (X = …)` and produce zero rows here (§1.6). Tempting to repair it
to mean ESM `export const`. But it is a **vendored** file, §2.5's new file covers ESM properly, and
editing upstream's text would break the one-to-one `Provenance` claim that a vendored row is
verbatim. Leaving a dead-but-harmless vendored pattern in place costs nothing.

### 8.4 Capturing module-level `let`/`var` in JavaScript, and function-local Go `var` — declined

Both are P64 §2.2's decision re-tested, not re-litigated from scratch. Module-level `let` is rare
here and a mutable module binding is a poor navigation target. Function-local Go `var` is measured
at 1752 names, 1.6x the entire package-level set (§2.3) — it would make `search_symbols` worse for
every caller to serve a lookup that reading the enclosing function already answers.

### 8.5 Renaming Rust's `@definition.class` for structs/enums/type aliases — declined

SPEC leaves this to judgement. `queries/rust/tags.scm` files `struct_item`, `enum_item`,
`union_item` and `type_item` all under `@definition.class` (lines 4, 7, 10, 15). It is a labelling
quirk, and it is not cheap to fix: the file is **vendored**, so the choices are editing upstream's
text (breaking the verbatim `Provenance` claim, §8.3's own reason) or adding an overriding file —
which tree-sitter cannot do, since a second pattern *adds* a match rather than replacing one, giving
every Rust struct two symbols under two kinds.

The payoff is also near zero. `kindCompatibility` already treats `class`, `struct` and `type` as
interchangeable for `type`/`class`/`implementation` references, so nothing resolves wrongly today;
only the printed kind word is off. This repository has 1 Rust file and 5 Rust symbols. Not worth a
vendored-file edit. Not logged as a dogfooding entry either, since nothing returns a wrong answer.

### 8.6 A `constant`/`variable` hint in the `kinds` argument description — declined

`search_symbols`'s `kinds` schema description reads *"e.g. function, method, class"*
(`repomap/tools.go:265`). It is an open string list with an illustrative example, not a closed
enum, so nothing breaks. Rewording it is a `repomap` edit for zero behaviour change, in a phase
whose whole point is that it touches no Go outside `queries.go`. Leave it.

### 8.7 Python — not investigated

Explicitly out of this row per SPEC, and left genuinely unexamined rather than waved through: this
repository has **1** Python file and 5 Python symbols, so no measurement here would say anything
about `queries/python/tags.scm`'s real coverage. Java's missing-enum gap is likewise deferred,
already logged elsewhere.

## 9. Out of scope

- Every language other than Go and JavaScript, except §2.7's two-node-kind widening of P64's own
  TypeScript/TSX files.
- Any `codegraph`, `codeindex` or `repomap` change. No new tool, no new argument, no ranking change.
- HTML/CSS/JSON/Svelte symbol extraction — correctly symbol-free by design (`languages.go`'s
  `symbolLanguages` comment).
- The Settings dialog's Code intelligence tab. Product surface, and a query change needs no UI.
- The open P64 dogfooding entry (§0.1) — flagged, not absorbed.

## 10. Files

New:

- `apps/kira-studio/internal/codeparse/queries/go/p64b_declarations.scm`
- `apps/kira-studio/internal/codeparse/queries/javascript/p64b_declarations.scm`

Changed:

- `codeparse/queries.go` — `//go:embed` line (11), `querySourcePaths` `JavaScript` (64) and `Go`
  (67) entries, two `Provenance` rows (34-52)
- `codeparse/queries/typescript/p64_declarations.scm` — four node kinds added to both value lists
- `codeparse/queries/tsx/p64_declarations.scm` — the same
- `codeparse/testdata/extract/sample.go` — iota block, string-const block, grouped `var` block,
  single `var`, single `const`, one local `const` and one local `var`
- `codeparse/testdata/extract/sample.js` — `export const` object, bare `const` call-expression,
  arrow-valued `export const`, function-body `const`, module-level `let`
- `codeparse/testdata/extract/sample.ts` — one regex-valued module `const`
- `codeparse/extract_test.go` — the Go, JavaScript and TypeScript golden rows

Docs: `docs/ARCHITECTURE.md` (line 49, and one clause in the C3 paragraph),
`docs/v1.6/mcp-repo-map-issues.md` (§5's two trivial entries, plus whatever implementation finds).
